import { MusicQueue } from './music-queue.ts';

type MusicScene = 'menu' | 'lobby' | 'match';
type MusicLibrary = { lobby: File; match: File[] };

const lobbyName = /^m01001(?:\.[^.]+)?$/i;
const audioName = /\.(?:mp3|wav|ogg|oga|opus|m4a|aac|flac|mp4|webm)$/i;
const muteKey = 'hex-music-muted-v1';

export function selectMusicTracks(files: readonly File[]): MusicLibrary | null {
  const sorted = files.filter(file => file.size > 0 && (
    file.type.startsWith('audio/') || audioName.test(file.name) || /^m\d+$/i.test(file.name)
  )).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  const lobby = sorted.find(file => lobbyName.test(file.name));
  const match = sorted.filter(file => !lobbyName.test(file.name));
  return lobby && match.length ? { lobby, match } : null;
}

async function musicStore<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('hex-background-music-v1', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('tracks'); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('tracks', mode);
      const request = use(transaction.objectStore('tracks'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** Background music is independent of dice sounds and stays on this browser. */
export class GameMusic {
  private scene: MusicScene = 'menu';
  private library: MusicLibrary | null = null;
  private source: string | null = null;
  private matchId = '';
  private queue: MusicQueue | null = null;
  private trackLabels: string[] = [];
  private failedTracks = new Set<File>();
  private muted = false;
  private roomListening = false;
  private blocked = false;
  private savingFailed = false;
  private audio = document.querySelector<HTMLAudioElement>('#music-player')!;
  private input = document.querySelector<HTMLInputElement>('#music-files')!;
  private folder = document.querySelector<HTMLButtonElement>('#music-folder')!;
  private toggle = document.querySelector<HTMLButtonElement>('#music-toggle')!;
  private status = document.querySelector<HTMLElement>('#music-status')!;
  private playlist = document.querySelector<HTMLElement>('#music-playlist')!;
  private list = document.querySelector<HTMLSelectElement>('#music-queue')!;
  private playNow = document.querySelector<HTMLButtonElement>('#music-play-now')!;
  private up = document.querySelector<HTMLButtonElement>('#music-up')!;
  private down = document.querySelector<HTMLButtonElement>('#music-down')!;
  private shuffle = document.querySelector<HTMLButtonElement>('#music-shuffle')!;

  constructor() {
    try { this.muted = localStorage.getItem(muteKey) === 'true'; } catch { /* Storage is optional. */ }
    this.audio.volume = .32;
    if (!('webkitdirectory' in this.input)) this.folder.textContent = 'Choose music files';
    this.folder.addEventListener('click', () => this.input.click());
    this.input.addEventListener('change', () => this.importTracks());
    this.toggle.addEventListener('click', () => {
      this.setMuted(!this.audio.paused);
      if (this.muted) {
        this.blocked = false;
        this.audio.pause();
        this.paint();
      } else {
        this.play();
      }
    });
    this.list.addEventListener('change', () => this.updateQueueButtons());
    this.up.addEventListener('click', () => this.moveSelected(-1));
    this.down.addEventListener('click', () => this.moveSelected(1));
    this.shuffle.addEventListener('click', () => {
      if (this.scene !== 'match' || !this.queue) return;
      this.queue.shuffle();
      this.showQueue(this.queue.current);
    });
    this.playNow.addEventListener('click', () => {
      if (!this.queue || this.scene !== 'match' || this.list.selectedIndex < 0) return;
      const selected = Number(this.list.value);
      const sameTrack = this.queue.current === selected && !!this.source;
      this.queue.select(selected);
      this.failedTracks.clear();
      this.setMuted(false);
      if (sameTrack) this.play();
      else this.loadTrack();
    });
    this.audio.addEventListener('playing', () => {
      this.failedTracks.clear();
      this.blocked = false;
      this.paint();
    });
    this.audio.addEventListener('pause', () => this.paint());
    this.audio.addEventListener('ended', () => this.advance());
    this.audio.addEventListener('error', () => {
      if (this.source && this.audio.error) this.onTrackError();
    });
    const retry = () => { if (this.blocked) this.play(); };
    document.addEventListener('click', retry);
    document.addEventListener('keydown', retry);
    void musicStore<MusicLibrary | undefined>('readonly', store => store.get('library')).then(saved => {
      if (saved && !this.library) {
        this.useLibrary(saved);
      }
    }).catch(() => { /* Keep music optional if storage is unavailable. */ });
  }

  setScene(scene: MusicScene, matchId = ''): void {
    const newMatch = scene === 'match' && matchId !== this.matchId;
    if (this.scene === scene && !newMatch) return;
    this.scene = scene;
    if (scene === 'match' && this.library && (newMatch || !this.queue)) {
      this.queue = new MusicQueue(this.library.match.length, Math.random, this.queue?.current);
    }
    if (scene === 'match') this.matchId = matchId;
    this.failedTracks.clear();
    this.showQueue(this.queue?.current);
    this.loadTrack();
  }

  /** Avoid two soundtracks on a guest device while it listens to its host. */
  setRoomListening(active: boolean): void {
    if (active === this.roomListening) return;
    this.roomListening = active;
    if (active) this.audio.pause();
    else this.play();
    this.paint();
  }

  private setMuted(value: boolean): void {
    this.muted = value;
    try { localStorage.setItem(muteKey, String(value)); } catch { /* Storage is optional. */ }
  }

  private useLibrary(library: MusicLibrary): void {
    this.library = library;
    const counts = new Map<string, number>();
    for (const file of library.match) counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
    this.trackLabels = library.match.map((file, index) => counts.get(file.name) === 1 ? file.name : `${file.name} (${index + 1})`);
    this.queue = this.scene === 'match' ? new MusicQueue(library.match.length) : null;
    this.failedTracks.clear();
    this.showQueue(this.queue?.current);
    this.loadTrack();
  }

  private importTracks(): void {
    const library = selectMusicTracks(Array.from(this.input.files ?? []));
    this.input.value = '';
    if (!library) {
      this.status.textContent = 'Choose a folder with m01001 and at least one gameplay audio track.';
      return;
    }
    this.savingFailed = false;
    this.useLibrary(library);
    void musicStore('readwrite', store => store.put(library, 'library')).catch(() => {
      if (this.library === library) {
        this.savingFailed = true;
        this.paint();
      }
    });
  }

  private currentTrack(): File | undefined {
    if (this.scene === 'lobby') return this.library?.lobby;
    if (this.scene === 'match' && this.queue) return this.library?.match[this.queue.current];
  }

  private showQueue(selected?: number): void {
    const queue = this.queue;
    const visible = this.scene === 'match' && !!queue;
    this.playlist.hidden = !visible;
    if (!queue || !visible) {
      this.list.replaceChildren();
      return;
    }
    const options = queue.order.map(id => new Option(this.trackLabels[id], String(id)));
    this.list.replaceChildren(...options);
    this.list.value = String(selected ?? queue.current);
    this.updateQueueButtons();
  }

  private updateQueueButtons(): void {
    const row = this.list.selectedIndex, count = this.list.length;
    this.playNow.disabled = row < 0;
    this.up.disabled = row <= 0;
    this.down.disabled = row < 0 || row === count - 1;
    this.shuffle.disabled = count < 2;
  }

  private moveSelected(direction: -1 | 1): void {
    if (this.scene !== 'match' || !this.queue || this.list.selectedIndex < 0) return;
    const id = Number(this.list.value);
    this.queue.move(id, direction);
    this.showQueue(id);
  }

  private clearTrack(): void {
    const source = this.source;
    this.source = null;
    this.blocked = false;
    this.audio.pause();
    if (source) {
      this.audio.removeAttribute('src');
      this.audio.load();
      URL.revokeObjectURL(source);
    }
  }

  private loadTrack(): void {
    this.clearTrack();
    const track = this.currentTrack();
    if (track) {
      this.source = URL.createObjectURL(track);
      this.audio.loop = this.scene === 'lobby' || this.library?.match.length === 1;
      this.audio.src = this.source;
    }
    this.paint();
    this.play();
  }

  private play(): void {
    const source = this.source;
    if (!source || this.roomListening || this.muted || !this.audio.paused) return;
    this.blocked = false;
    void this.audio.play().catch((error: DOMException) => {
      if (this.source !== source || this.roomListening || this.muted || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        this.blocked = true;
        this.paint();
      } else {
        this.onTrackError();
      }
    });
  }

  private advance(): void {
    if (!this.queue || !this.library || !this.source || this.scene !== 'match') return;
    const selected = this.list.selectedIndex < 0 ? undefined : Number(this.list.value);
    const previous = this.queue.current;
    do {
      this.queue.advance();
    } while (this.failedTracks.has(this.library.match[this.queue.current]));
    this.showQueue(selected === previous ? this.queue.current : selected);
    this.loadTrack();
  }

  private onTrackError(): void {
    const track = this.currentTrack();
    if (!this.source || !track) return;
    this.failedTracks.add(track);
    if (this.scene === 'match' && this.library && this.failedTracks.size < this.library.match.length) {
      this.advance();
    } else {
      this.clearTrack();
      this.paint();
    }
  }

  private paint(): void {
    this.toggle.hidden = this.source === null;
    const playing = !!this.source && !this.audio.paused;
    this.toggle.textContent = playing ? 'Pause music' : 'Play music';
    const track = this.source ? this.currentTrack() : undefined;
    if (!this.source && this.failedTracks.size) {
      this.status.textContent = 'The browser could not play this music. Try MP3, WAV, or Ogg files.';
      return;
    }
    const title = this.scene === 'match' && this.queue ? this.trackLabels[this.queue.current] : track?.name;
    const suffix = this.savingFailed ? ' Choose the folder again after reloading to keep using it.' : '';
    this.status.textContent = track
      ? (playing ? 'Playing ' + title : this.blocked ? 'Select Play music to start.' : 'Ready to play ' + title) + suffix
      : (this.library ? 'Music loaded.' + suffix : '');
  }
}
