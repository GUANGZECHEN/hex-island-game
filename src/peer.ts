import { decodeSignal, encodeSignal } from './signaling';

type Events = { status: (status: string) => void; message: (message: string) => void; error: (message: string) => void; diagnostics: (text: string) => void; ready: (ready: boolean) => void };
export class Peer {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  constructor(private events: Events) {}
  private start(): RTCPeerConnection {
    if (this.pc) throw new Error('Disconnect before starting another session.');
    if (!globalThis.RTCPeerConnection) throw new Error('WebRTC is unavailable in this browser or context.');
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pc = pc;
    const update = () => {
      if (this.pc !== pc) return;
      this.events.status(`Connection: ${pc.connectionState}; channel: ${this.channel?.readyState ?? 'waiting'}`);
      this.events.diagnostics(`Signaling: ${pc.signalingState}\nICE gathering: ${pc.iceGatheringState}\nICE connection: ${pc.iceConnectionState}\nPeer connection: ${pc.connectionState}\nData channel: ${this.channel?.readyState ?? 'waiting'}`);
      this.events.ready(this.channel?.readyState === 'open');
    };
    pc.onconnectionstatechange = update; pc.oniceconnectionstatechange = update; pc.onicegatheringstatechange = update; pc.onsignalingstatechange = update;
    pc.onicecandidateerror = () => { if (this.pc === pc) this.events.error('ICE candidate gathering reported an error. A direct connection may still be possible.'); };
    pc.ondatachannel = event => { if (this.pc === pc) this.bindChannel(event.channel, update); else event.channel.close(); };
    update(); return pc;
  }
  private bindChannel(channel: RTCDataChannel, update: () => void): void {
    this.channel = channel;
    channel.onopen = update; channel.onclose = update;
    channel.onerror = () => this.events.error('Data channel error.');
    channel.onmessage = event => { if (typeof event.data === 'string') this.events.message(event.data); else this.events.error('Received a non-text message.'); };
    update();
  }
  private async complete(pc: RTCPeerConnection): Promise<string> {
    if (pc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); pc.removeEventListener('connectionstatechange', changed); };
      const changed = () => { if (pc.iceGatheringState === 'complete') { cleanup(); resolve(); } else if (this.pc !== pc || pc.connectionState === 'closed') { cleanup(); reject(new Error('Session was reset.')); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('ICE gathering timed out. Reset and try again.')); }, 30000);
      pc.addEventListener('icegatheringstatechange', changed); pc.addEventListener('connectionstatechange', changed); changed();
    });
    if (this.pc !== pc || !pc.localDescription) throw new Error('Session was reset.');
    if (!/^a=candidate:/m.test(pc.localDescription.sdp ?? '')) this.events.error('No ICE candidates were gathered; a connection is unlikely. Check browser and network access, then reset and retry.');
    return encodeSignal(pc.localDescription);
  }
  async create(): Promise<string> {
    const pc = this.start();
    try { this.bindChannel(pc.createDataChannel('messages'), () => this.refresh(pc)); await pc.setLocalDescription(await pc.createOffer()); return await this.complete(pc); } catch (error) { if (this.pc === pc) this.reset(); throw error; }
  }
  async join(input: string): Promise<string> {
    const offer = decodeSignal(input, 'offer'); const pc = this.start();
    try { await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); return await this.complete(pc); } catch (error) { if (this.pc === pc) this.reset(); throw error; }
  }
  async apply(input: string): Promise<void> {
    const answer = decodeSignal(input, 'answer');
    if (!this.pc || this.pc.signalingState !== 'have-local-offer') throw new Error('Create an offer before applying an answer.');
    await this.pc.setRemoteDescription(answer);
  }
  send(text: string): void { if (!this.channel || this.channel.readyState !== 'open') throw new Error('Data channel is not open.'); this.channel.send(text); }
  private refresh(pc: RTCPeerConnection): void { if (this.pc !== pc) return; this.events.status(`Connection: ${pc.connectionState}; channel: ${this.channel?.readyState ?? 'waiting'}`); this.events.diagnostics(`Signaling: ${pc.signalingState}\nICE gathering: ${pc.iceGatheringState}\nICE connection: ${pc.iceConnectionState}\nPeer connection: ${pc.connectionState}\nData channel: ${this.channel?.readyState ?? 'waiting'}`); this.events.ready(this.channel?.readyState === 'open'); }
  reset(): void { const pc = this.pc; this.pc = null; this.channel?.close(); this.channel = null; pc?.close(); this.events.ready(false); this.events.status('Idle'); this.events.diagnostics('No connection'); }
}
