import { isRoomMusicFrame, ROOM_MUSIC_FRAME_SAMPLES, ROOM_MUSIC_SAMPLE_RATE } from '../network/room-music.ts';

export type RoomMusicPlaybackStatus = 'waiting' | 'needs-click' | 'playing';

const FRAME_SECONDS = ROOM_MUSIC_FRAME_SAMPLES / ROOM_MUSIC_SAMPLE_RATE;
const START_LEAD = .12;
const MAX_SOURCES = 4;
const MAX_LEAD = FRAME_SECONDS * MAX_SOURCES;
const STALL_MS = MAX_LEAD * 1000;
// A browser waking from throttling can deliver many old relay messages in the same task.
const WAKE_BURST_MS = 40;

const muLaw = Float32Array.from({ length: 256 }, (_, code) => {
  const bits = ~code & 255;
  const magnitude = (((bits & 15) * 8 + 132) << ((bits >> 4) & 7)) - 132;
  // G.711 has two codewords for silence.
  if (magnitude === 0) return 0;
  return (bits & 128 ? -magnitude : magnitude) / 32768;
});

interface PlaybackOptions {
  createContext?: () => AudioContext;
  gestures?: EventTarget;
  now?: () => number;
}

/** Ephemeral room audio. Only a user gesture creates or resumes the guest's audio context. */
export class RoomMusicPlayback {
  private readonly notify: (status: RoomMusicPlaybackStatus) => void;
  private readonly gestures: EventTarget | null;
  private readonly createContext: () => AudioContext;
  private readonly now: () => number;
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private subscribed = false;
  private muted = false;
  private disposed = false;
  private frameSeen = false;
  private previousStatus: RoomMusicPlaybackStatus = 'waiting';
  private lastSeq = 0;
  private lastArrival: number | null = null;
  private dropUntil = 0;
  private nextStart = 0;

  constructor(notify: (status: RoomMusicPlaybackStatus) => void = () => {}, options: PlaybackOptions = {}) {
    this.notify = notify;
    this.gestures = options.gestures ?? (typeof document === 'undefined' ? null : document);
    this.createContext = options.createContext ?? (() => new AudioContext());
    this.now = options.now ?? (() => performance.now());
  }

  get status(): RoomMusicPlaybackStatus {
    if (!this.subscribed || this.muted || !this.frameSeen) return 'waiting';
    if (this.context?.state !== 'running') return 'needs-click';
    return this.sources.size ? 'playing' : 'waiting';
  }

  private publish(): void {
    const current = this.status;
    if (current === this.previousStatus) return;
    this.previousStatus = current;
    this.notify(current);
  }

  private clearScheduled(): void {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextStart = 0;
  }

  private onStateChange = (): void => {
    if (this.context?.state !== 'running') this.clearScheduled();
    else if (this.frameSeen) this.dropUntil = this.now() + WAKE_BURST_MS;
    this.publish();
  };

  /** Call from Join/Ready as well, while the browser still grants user activation. */
  unlock = (): void => {
    if (this.disposed || this.muted) return;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context?.removeEventListener('statechange', this.onStateChange);
        this.output?.disconnect();
        this.clearScheduled();
        this.context = this.createContext();
        this.output = this.context.createGain();
        // The captured signal already contains the host's playback level.
        this.output.connect(this.context.destination);
        this.context.addEventListener('statechange', this.onStateChange);
      }
      if (this.context.state !== 'running') {
        void this.context.resume().catch(() => this.publish());
      }
    } catch { /* A later gesture can retry when the browser permits audio. */ }
    this.publish();
  };

  setSubscribed(subscribed: boolean): void {
    if (this.disposed || this.subscribed === subscribed) return;
    this.subscribed = subscribed;
    if (subscribed) {
      // Capture runs before the clicked control can replace its lobby or match DOM.
      this.gestures?.addEventListener('click', this.unlock, true);
      this.gestures?.addEventListener('keydown', this.unlock, true);
    } else {
      this.gestures?.removeEventListener('click', this.unlock, true);
      this.gestures?.removeEventListener('keydown', this.unlock, true);
    }
    this.stop();
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (this.output) this.output.gain.value = muted ? 0 : 1;
    if (muted) this.clearScheduled();
    this.publish();
  }

  /** Reset between stream generations, or on host pause and disconnect. */
  stop(): void {
    this.clearScheduled();
    this.frameSeen = false;
    this.lastSeq = 0;
    this.lastArrival = null;
    this.dropUntil = 0;
    this.publish();
  }

  push(seq: number, data: string): void {
    if (!this.subscribed || !Number.isSafeInteger(seq) || seq <= this.lastSeq || !isRoomMusicFrame(data)) return;
    const gap = this.lastSeq !== 0 && seq !== this.lastSeq + 1;
    const arrived = this.now();
    if (this.lastArrival !== null && arrived - this.lastArrival > STALL_MS) {
      this.clearScheduled();
      this.dropUntil = arrived + WAKE_BURST_MS;
    }
    this.lastSeq = seq;
    this.lastArrival = arrived;
    this.frameSeen = true;
    const context = this.context;
    if (this.muted || !context || !this.output || context.state !== 'running' || arrived < this.dropUntil) {
      this.publish();
      return;
    }
    const now = context.currentTime;
    if (gap || this.sources.size >= MAX_SOURCES || this.nextStart + FRAME_SECONDS - now > MAX_LEAD) {
      this.clearScheduled();
    }
    const buffer = context.createBuffer(1, ROOM_MUSIC_FRAME_SAMPLES, ROOM_MUSIC_SAMPLE_RATE);
    const samples = buffer.getChannelData(0);
    const bytes = atob(data);
    for (let i = 0; i < samples.length; i++) samples[i] = muLaw[bytes.charCodeAt(i)];
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      this.publish();
    };
    const start = this.nextStart > now ? this.nextStart : now + START_LEAD;
    source.start(start);
    this.sources.add(source);
    this.nextStart = start + FRAME_SECONDS;
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.setSubscribed(false);
    this.disposed = true;
    this.context?.removeEventListener('statechange', this.onStateChange);
    this.output?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
    this.output = null;
  }
}
