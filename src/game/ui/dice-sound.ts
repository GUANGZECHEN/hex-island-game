/** Locally synthesized dice clatter: no audio download and no game RNG. */
export class DiceSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  constructor(private button: HTMLButtonElement) {
    try { this.muted = localStorage.getItem('hex-dice-muted-v1') === 'true'; } catch { /* private mode */ }
    this.paint();
    button.addEventListener('click', () => {
      this.muted = !this.muted;
      try {localStorage.setItem('hex-dice-muted-v1',String(this.muted));}catch{}
      this.paint();
      if(!this.muted)this.unlock();
    });
    const unlock=()=>this.unlock();
    document.addEventListener('pointerdown',unlock,{passive:true});
    document.addEventListener('keydown',unlock);
  }
  private paint():void {
    this.button.textContent=this.muted?'🔇 Sound off':'🔊 Sound on';
    this.button.setAttribute('aria-pressed',String(this.muted));
    this.button.setAttribute('aria-label',this.muted?'Unmute dice sounds':'Mute dice sounds');
    if(this.master)this.master.gain.value=this.muted?0:.52;
  }
  private unlock():void {
    if(this.muted)return;
    try{
      if(!this.context){
        const context=new AudioContext();
        this.context=context;
        this.master=context.createGain();this.master.gain.value=.52;this.master.connect(context.destination);
        const count=Math.floor(context.sampleRate*.055);
        this.noise=context.createBuffer(1,count,context.sampleRate);
        const samples=this.noise.getChannelData(0);
        let seed=1907;
        for(let i=0;i<count;i++){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;
          samples[i]=seed/0xffffffff*2-1;
        }
      }
      if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
    }catch{ /* Unsupported or locked audio is optional. */ }
  }
  playRoll():void {
    if(this.muted)return;
    this.unlock();
    const ctx=this.context,output=this.master,noise=this.noise;
    if(!ctx||!output||!noise||ctx.state!=='running')return;
    // Several progressively shorter wooden-table collisions.
    for(const [delay,loudness,frequency] of [[.06,.28,850],[.21,.25,730],[.40,.32,670],[.61,.19,940],[.82,.36,590],[.99,.25,810]]){
      const start=ctx.currentTime+delay;
      const source=ctx.createBufferSource();source.buffer=noise;
      const filter=ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.72;
      const gain=ctx.createGain();gain.gain.setValueAtTime(.001,start);
      gain.gain.exponentialRampToValueAtTime(loudness,start+.003);
      gain.gain.exponentialRampToValueAtTime(.001,start+.045);
      source.connect(filter);filter.connect(gain);gain.connect(output);
      source.start(start);source.stop(start+.052);
    }
  }
}
