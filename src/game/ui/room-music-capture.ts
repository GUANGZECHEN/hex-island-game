// Ten 150 ms packets cover ordinary host frame stalls while bounding wake-up replay.
const MAX_CAPTURE_LAG_SECONDS = 1.5;

/** Optional room audio comes only from the game's existing music element. */
export class RoomMusicCapture {
  private audio: HTMLAudioElement;
  private onFrame: (base64: string) => void;
  private onDiscontinuity?: () => void;
  private trackUrl: string;
  private sentAudio = false;
  private lastMediaTime = 0;
  private lastContextTime = 0;
  private context: AudioContext | null = null;
  private moduleReady: Promise<void> | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private encoder: AudioWorkletNode | null = null;
  private enabled = false;
  private requested = false;
  private connected = false;
  private playing: boolean;
  private enableRequest = 0;
  private generation = 0;

  constructor(audio: HTMLAudioElement, onFrame: (base64: string) => void, onDiscontinuity?: () => void) {
    this.audio = audio;
    this.onFrame = onFrame;
    this.onDiscontinuity = onDiscontinuity;
    this.trackUrl = audio.src;
    this.playing = this.canPlay();
    const started = () => {
      this.checkTrack();
      this.playing = this.canPlay();
      this.update();
    };
    audio.addEventListener('playing', started);
    audio.addEventListener('seeked', started);
    // A replacement can queue old pause/emptied events after the new track
    // starts. Check the element's current state before flushing audible music.
    audio.addEventListener('loadstart', () => this.checkTrack());
    audio.addEventListener('emptied', () => {
      this.checkTrack();
      if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) this.stopMedia(false);
    });
    audio.addEventListener('pause', () => { if (audio.paused) this.stopMedia(!audio.ended); });
    audio.addEventListener('ended', () => { if (audio.ended) this.stopMedia(false); });
    audio.addEventListener('seeking', () => {
      if (audio.seeking && !this.isLoopWrap()) this.stopMedia(true);
    });
    audio.addEventListener('error', () => { if (audio.error) this.stopMedia(false); });
    audio.addEventListener('waiting', () => {
      if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) this.stopMedia(false);
    });
    const resumeLocalAudio = () => {
      const context = this.context;
      if (this.source && context && !audio.paused && !audio.ended
        && context.state !== 'running' && context.state !== 'closed') {
        void context.resume().catch(() => {});
      }
    };
    audio.addEventListener('play', resumeLocalAudio);
    audio.ownerDocument.addEventListener('visibilitychange', () => {
      // Returning to a phone tab can interrupt the context without pausing the
      // media element, so another play event isn't guaranteed.
      if (!audio.ownerDocument.hidden) resumeLocalAudio();
    });
  }

  private checkTrack(): boolean {
    if (this.audio.src === this.trackUrl) return false;
    this.trackUrl = this.audio.src;
    this.stopMedia(true);
    return true;
  }

  private isLoopWrap(): boolean {
    const audio = this.audio;
    if (!this.context || !this.sentAudio || !audio.loop || audio.currentTime > .15) return false;
    // Native looping seeks back to zero. If the captured playhead crossed the
    // end within one packet, keep the guest's already queued tail of this loop.
    const elapsed = (this.context.currentTime - this.lastContextTime) * audio.playbackRate;
    return Math.abs(this.lastMediaTime + elapsed - audio.duration - audio.currentTime) <= .15;
  }

  private stopMedia(discontinuity: boolean): void {
    this.playing = false;
    this.update();
    if (discontinuity && this.sentAudio) {
      this.sentAudio = false;
      this.onDiscontinuity?.();
    }
  }

  private canPlay(): boolean {
    return !this.audio.paused && !this.audio.ended && !this.audio.seeking
      && this.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }

  async enable(): Promise<void> {
    const request = ++this.enableRequest;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'playback' });
        this.context.addEventListener('statechange', () => this.update());
      }
      const context = this.context;
      if (!context.audioWorklet) throw new Error('This browser cannot share room audio.');
      // Called directly from the host's gesture, before awaiting module loading.
      const ready = context.resume();
      this.moduleReady ??= context.audioWorklet.addModule(
        new URL('./room-music-worklet.js?no-inline', import.meta.url).href,
      );
      await Promise.all([ready, this.moduleReady]);
      if (request !== this.enableRequest) return;
      if (!this.encoder) {
        const encoder = new AudioWorkletNode(context, 'hex-room-music', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        });
        // Validate the worklet before rerouting the element. Keep a permanent
        // unprocessed local path even when the independently tapped encoder stops.
        try {
          if (!this.source) {
            const source = context.createMediaElementSource(this.audio);
            source.connect(context.destination);
            this.source = source;
          }
        } catch (error) {
          encoder.port.close();
          throw error;
        }
        this.encoder = encoder;
        encoder.port.onmessage = ({ data }) => {
          if (this.checkTrack() || !this.connected || data.generation !== this.generation || !this.canPlay()) return;
          if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== 3600) return;
          // Worklet messages survive a short main-thread stall. Deliver the
          // recent ordered burst to the guest buffer and discard older backlog.
          if (context.currentTime - data.endTime >= MAX_CAPTURE_LAG_SECONDS) return;
          this.sentAudio = true;
          this.lastContextTime = context.currentTime;
          this.lastMediaTime = this.audio.currentTime;
          this.onFrame(btoa(String.fromCharCode(...new Uint8Array(data.bytes))));
        };
      }
      this.enabled = true;
      this.update();
    } catch (error) {
      if (request !== this.enableRequest) return;
      this.disable();
      throw error;
    }
  }

  disable(): void {
    this.enableRequest++;
    this.enabled = false;
    this.sentAudio = false;
    this.update();
    // A cancelled first enable can release its context. Once bound, the context
    // remains the element's audible route for its lifetime.
    if (!this.source && this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
      this.moduleReady = null;
    }
  }

  setStreaming(value: boolean): void {
    this.requested = value;
    if (!value) this.sentAudio = false;
    this.update();
  }

  private update(): void {
    const { context, source, encoder } = this;
    if (!context || !source || !encoder) return;
    const active = this.enabled && this.requested && this.playing && this.canPlay() && context.state === 'running';
    if (active === this.connected) return;
    if (active) {
      // The worklet's output is silence. Connecting it keeps the input being
      // pulled; the source's direct connection is the only audible route.
      encoder.connect(context.destination);
      try {
        source.connect(encoder);
      } catch (error) {
        encoder.disconnect();
        throw error;
      }
    } else {
      source.disconnect(encoder);
      encoder.disconnect();
    }
    this.connected = active;
    encoder.port.postMessage({ active, generation: ++this.generation });
  }
}
