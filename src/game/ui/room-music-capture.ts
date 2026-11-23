/** Optional room audio comes only from the game's existing music element. */
export class RoomMusicCapture {
  private audio: HTMLAudioElement;
  private onFrame: (base64: string) => void;
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

  constructor(audio: HTMLAudioElement, onFrame: (base64: string) => void) {
    this.audio = audio;
    this.onFrame = onFrame;
    this.playing = this.canPlay();
    const started = () => {
      this.playing = this.canPlay();
      this.update();
    };
    const stopped = () => {
      this.playing = false;
      this.update();
    };
    audio.addEventListener('playing', started);
    audio.addEventListener('seeked', started);
    for (const event of ['pause', 'ended', 'waiting', 'seeking', 'emptied', 'error']) {
      audio.addEventListener(event, stopped);
    }
    audio.addEventListener('play', () => {
      // Preserve local playback if the OS suspended the established audio route.
      if (this.source && this.context && this.context.state !== 'running') {
        void this.context.resume().catch(() => {});
      }
    });
  }

  private canPlay(): boolean {
    return !this.audio.paused && !this.audio.ended && !this.audio.seeking
      && this.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }

  async enable(): Promise<void> {
    const request = ++this.enableRequest;
    try {
      if (!this.context) {
        this.context = new AudioContext();
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
          if (!this.connected || data.generation !== this.generation || !this.canPlay()) return;
          if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== 3600) return;
          // Dropping a delayed packet prevents a stalled tab from sending a burst
          // of old music when its main thread resumes.
          if (context.currentTime - data.endTime > .45) return;
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
