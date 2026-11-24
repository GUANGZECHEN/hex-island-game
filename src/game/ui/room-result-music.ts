/** Encodes the other ending from the host's chosen folder without playing it to the host. */
export class RoomResultMusic {
  private context: AudioContext | null = null;
  private file: File | null = null;
  private matchId = '';
  private generation = 0;
  private muted = false;
  private finished = false;
  private sentAudio = false;
  private position = 0;
  private startedAt: number | null = null;
  private source: AudioBufferSourceNode | null = null;
  private encoder: AudioWorkletNode | null = null;
  private volume: GainNode | null = null;
  private tail: ConstantSourceNode | null = null;
  private readonly send: (base64: string) => void;

  private readonly reset?: () => void;

  constructor(send: (base64: string) => void, reset?: () => void) { this.send = send; this.reset = reset; }

  update(context: AudioContext | null, file: File | null, matchId: string, muted = false): void {
    const same = this.context === context && this.file === file && this.matchId === matchId;
    if (same && this.muted === muted) return;
    const generation = ++this.generation;
    if (!same) { this.position = 0; this.finished = false; }
    else if (this.startedAt !== null && this.context) this.position += Math.max(0, this.context.currentTime - this.startedAt);
    this.release();
    this.muted = muted;
    if (this.sentAudio && (muted || !same)) { this.sentAudio = false; this.reset?.(); }
    this.context = context;
    this.file = file;
    this.matchId = matchId;
    if (context && file && !muted && !this.finished) void this.start(context, file, generation);
  }

  private async start(context: AudioContext, file: File, generation: number): Promise<void> {
    try {
      const bytes = await file.arrayBuffer();
      if (generation !== this.generation) return;
      const buffer = await context.decodeAudioData(bytes);
      if (generation !== this.generation) return;
      if (this.position >= buffer.duration) { this.finished = true; return; }
      const encoder = this.encoder = new AudioWorkletNode(context, 'hex-room-music', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      encoder.port.onmessage = ({data}) => {
        if (generation !== this.generation || data.generation !== generation ||
            !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== 3600 ||
            context.currentTime - data.endTime >= 1.5) return;
        this.sentAudio = true;
        this.send(btoa(String.fromCharCode(...new Uint8Array(data.bytes))));
      };
      const source = this.source = context.createBufferSource();
      source.buffer = buffer;
      const volume = this.volume = context.createGain();
      volume.gain.value = .32;
      source.connect(volume);
      volume.connect(encoder);
      // The worklet produces silence at its output. Never connect the other
      // audience's source or volume node directly to the speakers.
      encoder.connect(context.destination);
      encoder.port.postMessage({ active: true, generation });
      // Supply at most one trailing packet of silence so short ending cues and
      // the final fraction of a 150 ms capture packet reach their listeners.
      const tail = this.tail = context.createConstantSource();
      tail.offset.value = 0;
      tail.connect(volume);
      const when = context.currentTime;
      tail.onended = () => { if (generation === this.generation) { this.finished = true; this.release(); } };
      if (context.state !== 'running') void context.resume().catch(() => {});
      this.startedAt = when;
      source.start(when, this.position);
      tail.start(when);
      tail.stop(when + buffer.duration - this.position + .15);
    } catch {
      // An unavailable result is silent; regular music and the opposite result
      // are never substituted for a missing or undecodable ending.
      if (generation === this.generation) this.release();
    }
  }

  private release(): void {
    this.startedAt = null;
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* A graph setup failure may precede start(). */ }
      this.source.disconnect();
    }
    if (this.tail) {
      this.tail.onended = null;
      try { this.tail.stop(); } catch { /* Already ended or never started. */ }
      this.tail.disconnect();
    }
    this.tail = null;
    this.volume?.disconnect();
    if (this.encoder) {
      this.encoder.port.onmessage = null;
      this.encoder.port.close();
      this.encoder.disconnect();
    }
    this.source = null;
    this.volume = null;
    this.encoder = null;
  }
}
