/** Live, best-effort mono audio. Each frame spans 150 ms and fits one room relay message. */
export const ROOM_MUSIC_SAMPLE_RATE = 24_000;
export const ROOM_MUSIC_FRAME_SAMPLES = 3_600;
export const ROOM_MUSIC_BASE64_LENGTH = ROOM_MUSIC_FRAME_SAMPLES / 3 * 4;
// Allow a delayed cumulative ACK during a 1.5 s capture burst. The socket still
// rejects media when its ordinary send buffer is full.
const ACK_WINDOW = 12;
const RECENT_FRAMES = 10;
const RECENT_MS = RECENT_FRAMES * ROOM_MUSIC_FRAME_SAMPLES / ROOM_MUSIC_SAMPLE_RATE * 1000;

export function isRoomMusicFrame(value: unknown): value is string {
  return typeof value === 'string' && value.length === ROOM_MUSIC_BASE64_LENGTH && !/[^A-Za-z0-9+/]/.test(value);
}

type Message = Record<string, unknown> & { type: 'room-music' };
/** Dispatch this namespace before game command parsing, including malformed media envelopes. */
export function isRoomMusicMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === 'room-music';
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function encode(action: string, generation: number, fields: Record<string, string | number | boolean>): string {
  return JSON.stringify({ protocol: 1, type: 'room-music', action, generation, ...fields });
}

type HostSend = (peer: string, text: string, frame?: boolean) => void | boolean;
type Listener = { subscription: number; listening: boolean; outstanding: number[]; next: number };

/** Membership is supplied by the host session only after it admits a seat or spectator. */
export class RoomMusicHost {
  private readonly peers = new Map<string, Listener>();
  private sharing = false;
  private generation = 1;
  private sequence = 0;
  private recent: { sequence: number; captured: number; data: string }[] = [];
  private fanoutStart = 0;
  private draining = false;
  private readonly now: () => number;
  private notifiedListeners = false;
  private readonly send: HostSend;
  private readonly listenersChanged?: (listening: boolean) => void;

  constructor(send: HostSend, listenersChanged?: (listening: boolean) => void, now: () => number = () => performance.now()) {
    this.now = now;
    this.send = send;
    this.listenersChanged = listenersChanged;
  }
  get hasListeners(): boolean {
    for (const peer of this.peers.values()) if (peer.listening) return true;
    return false;
  }
  private notify(): void {
    const listening = this.hasListeners;
    if (!listening) this.recent.length = 0;
    if (listening !== this.notifiedListeners) {
      this.notifiedListeners = listening;
      this.listenersChanged?.(listening);
    }
  }
  private transmit(id: string, text: string, frame = false): boolean {
    try { return this.send(id, text, frame) !== false; }
    catch { return false; } // The normal room lifecycle handles transport loss.
  }
  private offer(id: string): void {
    this.transmit(id, encode('offer', this.generation, { enabled: this.sharing }));
  }
  admit(id: string): void {
    if (this.peers.has(id)) return;
    this.peers.set(id, { subscription: 0, listening: false, outstanding: [], next: this.sequence + 1 });
    this.offer(id);
  }
  remove(id: string): void {
    this.peers.delete(id);
    this.notify();
  }
  setSharing(enabled: boolean): void {
    if (enabled === this.sharing) return;
    this.sharing = enabled;
    this.generation++;
    this.sequence = 0;
    this.recent.length = 0;
    for (const peer of this.peers.values()) {
      peer.listening = false;
      peer.subscription = 0;
      peer.next = 1;
      peer.outstanding.length = 0;
    }
    this.notify();
    for (const id of this.peers.keys()) this.offer(id);
  }
  receive(id: string, message: unknown): void {
    const peer = this.peers.get(id);
    if (!peer || !this.sharing || !isRoomMusicMessage(message) || message.protocol !== 1 ||
        message.generation !== this.generation || !positive(message.subscription)) return;
    if (message.action === 'listen' && Object.keys(message).length === 6 &&
        typeof message.enabled === 'boolean' && message.subscription > peer.subscription) {
      peer.subscription = message.subscription;
      peer.listening = message.enabled;
      peer.next = this.sequence + 1;
      peer.outstanding.length = 0;
      this.notify();
    } else if (message.action === 'ack' && Object.keys(message).length === 6 && peer.listening &&
        message.subscription === peer.subscription && positive(message.sequence)) {
      const index = peer.outstanding.indexOf(message.sequence);
      if (index >= 0) {
        peer.outstanding.splice(0, index + 1);
        this.flush();
      }
    }
  }

  frame(data: string): void {
    if (!this.sharing || !this.hasListeners || !isRoomMusicFrame(data)) return;
    this.recent.push({ sequence: ++this.sequence, captured: this.now(), data });
    if (this.recent.length > RECENT_FRAMES) this.recent.shift();
    this.flush();
  }

  /** Brief socket congestion can clear before playout reaches the affected frame.
   * Keep one shared, bounded copy until every interested peer has accepted it. */
  private flush(): void {
    if (this.draining || !this.recent.length) return;
    const cutoff = this.now() - RECENT_MS;
    while (this.recent.length && this.recent[0].captured < cutoff) this.recent.shift();
    if (!this.recent.length) return;
    const peers = [...this.peers.entries()].filter(([, peer]) => peer.listening);
    if (!peers.length) { this.recent.length = 0; return; }

    this.draining = true;
    try {
      const first = this.fanoutStart % peers.length;
      this.fanoutStart = (first + 1) % peers.length;
      const oldest = this.recent[0].sequence;
      const newest = this.recent[this.recent.length - 1].sequence;
      const blocked = new Set<string>();
      // Give each listener one frame per pass before sending any peer a second.
      for (let pass = 0; pass < this.recent.length; pass++) {
        let progressed = false;
        for (let offset = 0; offset < peers.length; offset++) {
          const [id, peer] = peers[(first + offset) % peers.length];
          if (!peer.listening || this.peers.get(id) !== peer || blocked.has(id) || peer.outstanding.length >= ACK_WINDOW) continue;
          if (peer.next > newest) continue;
          // Once the missing audio ages out, return straight to live sound.
          const sequence = peer.next < oldest ? newest : peer.next;
          const frame = this.recent[sequence - oldest];
          if (!frame || frame.sequence !== sequence) continue;
          const text = encode('frame', this.generation, { subscription: peer.subscription, sequence, data: frame.data });
          peer.outstanding.push(sequence);
          if (this.transmit(id, text, true)) {
            peer.next = sequence + 1;
            progressed = true;
          } else {
            const index = peer.outstanding.indexOf(sequence);
            if (index >= 0) peer.outstanding.splice(index, 1);
            blocked.add(id);
          }
        }
        if (!progressed) break;
      }
      const next = Math.min(...peers.map(([, peer]) => peer.next));
      while (this.recent.length && this.recent[0].sequence < next) this.recent.shift();
    } finally { this.draining = false; }
  }

  /** An intentional pause, seek or track change invalidates captured and scheduled sound. */
  resetPlayback(): void {
    if (!this.sharing) return;
    this.recent.length = 0;
    const sequence = ++this.sequence;
    for (const [id, peer] of this.peers) {
      peer.next = sequence + 1;
      peer.outstanding.length = 0;
      if (peer.listening) this.transmit(id, encode('reset', this.generation, { subscription: peer.subscription, sequence }));
    }
  }
  reset(): void {
    this.setSharing(false);
    this.peers.clear();
    this.notify();
  }
}

export interface RoomMusicGuestEvents {
  availability: (available: boolean) => void;
  frame: (base64: string, sequence: number, generation: number) => void;
  reset: () => void;
}

/** Feed only messages from the authenticated host. Listening is private to this browser. */
export class RoomMusicGuest {
  private generation = 0;
  private subscription = 0;
  private sequence = 0;
  private available = false;
  private listening: boolean;
  private readonly send: (text: string) => void | boolean;
  private readonly events: RoomMusicGuestEvents;

  constructor(send: (text: string) => void | boolean, events: RoomMusicGuestEvents, initialListening = true) {
    this.send = send;
    this.events = events;
    this.listening = initialListening;
  }
  private transmit(action: string, fields: Record<string, string | number | boolean>): void {
    try { this.send(encode(action, this.generation, fields)); }
    catch { /* A fresh offer follows normal room re-admission. */ }
  }
  private announceListening(): void {
    this.subscription++;
    this.transmit('listen', { subscription: this.subscription, enabled: this.listening });
  }
  setListening(enabled: boolean): void {
    if (enabled === this.listening) return;
    this.listening = enabled;
    if (!enabled) this.events.reset();
    if (this.available) this.announceListening();
  }
  receive(message: unknown): void {
    if (!isRoomMusicMessage(message) || message.protocol !== 1 || !positive(message.generation)) return;
    if (message.action === 'offer' && Object.keys(message).length === 5 && typeof message.enabled === 'boolean') {
      if (message.generation <= this.generation) return;
      this.generation = message.generation;
      this.subscription = 0;
      this.sequence = 0;
      this.available = message.enabled;
      this.events.reset();
      this.events.availability(this.available);
      if (this.available) this.announceListening();
      return;
    }
    if (!this.available || !this.listening || message.generation !== this.generation ||
        message.subscription !== this.subscription || !positive(message.sequence) || message.sequence <= this.sequence) return;
    if (message.action === 'reset' && Object.keys(message).length === 6) {
      this.sequence = message.sequence;
      this.events.reset();
      return;
    }
    if (message.action !== 'frame' || Object.keys(message).length !== 7 || !isRoomMusicFrame(message.data)) return;
    this.sequence = message.sequence;
    this.events.frame(message.data, this.sequence, this.generation);
    this.transmit('ack', { subscription: this.subscription, sequence: this.sequence });
  }
  reset(): void {
    this.generation = 0;
    this.subscription = 0;
    this.sequence = 0;
    this.available = false;
    this.events.reset();
    this.events.availability(false);
  }
}
