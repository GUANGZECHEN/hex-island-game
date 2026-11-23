/** Live, best-effort mono audio. Each frame spans 150 ms and fits one room relay message. */
export const ROOM_MUSIC_SAMPLE_RATE = 24_000;
export const ROOM_MUSIC_FRAME_SAMPLES = 3_600;
export const ROOM_MUSIC_BASE64_LENGTH = ROOM_MUSIC_FRAME_SAMPLES / 3 * 4;
const ACK_WINDOW = 6;

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
type Listener = { subscription: number; listening: boolean; outstanding: number[] };

/** Membership is supplied by the host session only after it admits a seat or spectator. */
export class RoomMusicHost {
  private readonly peers = new Map<string, Listener>();
  private sharing = false;
  private generation = 1;
  private sequence = 0;
  private notifiedListeners = false;
  private readonly send: HostSend;
  private readonly listenersChanged?: (listening: boolean) => void;

  constructor(send: HostSend, listenersChanged?: (listening: boolean) => void) {
    this.send = send;
    this.listenersChanged = listenersChanged;
  }
  get hasListeners(): boolean {
    for (const peer of this.peers.values()) if (peer.listening) return true;
    return false;
  }
  private notify(): void {
    const listening = this.hasListeners;
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
    this.peers.set(id, { subscription: 0, listening: false, outstanding: [] });
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
    for (const peer of this.peers.values()) {
      peer.listening = false;
      peer.subscription = 0;
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
      peer.outstanding.length = 0;
      this.notify();
    } else if (message.action === 'ack' && Object.keys(message).length === 6 && peer.listening &&
        message.subscription === peer.subscription && positive(message.sequence)) {
      const index = peer.outstanding.indexOf(message.sequence);
      if (index >= 0) peer.outstanding.splice(0, index + 1);
    }
  }
  frame(data: string): void {
    if (!this.sharing || !this.hasListeners || !isRoomMusicFrame(data)) return;
    const sequence = ++this.sequence;
    // A blocked receiver skips live frames. Only sequence numbers are retained for ACKs.
    const encoded = new Map<number, string>();
    for (const [id, peer] of this.peers) {
      if (!peer.listening || peer.outstanding.length >= ACK_WINDOW) continue;
      let text = encoded.get(peer.subscription);
      if (!text) {
        text = encode('frame', this.generation, { subscription: peer.subscription, sequence, data });
        encoded.set(peer.subscription, text);
      }
      peer.outstanding.push(sequence);
      if (!this.transmit(id, text, true)) {
        const index = peer.outstanding.indexOf(sequence);
        if (index >= 0) peer.outstanding.splice(index, 1);
      }
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
    if (!this.available || !this.listening || message.action !== 'frame' || Object.keys(message).length !== 7 ||
        message.generation !== this.generation || message.subscription !== this.subscription ||
        !positive(message.sequence) || message.sequence <= this.sequence || !isRoomMusicFrame(message.data)) return;
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
