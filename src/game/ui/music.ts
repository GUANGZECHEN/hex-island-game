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
  private trackIndex = 0;
  private failures = 0;
  private muted = false;
  private blocked = false;
  private savingFailed = false;
  private audio = document.querySelector<HTMLAudioElement>('#music-player')!;
  private input = document.querySelector<HTMLInputElement>('#music-files')!;
  private folder = document.querySelector<HTMLButtonElement>('#music-folder')!;
  private toggle = document.querySelector<HTMLButtonElement>('#music-toggle')!;
  private status = document.querySelector<HTMLElement>('#music-status')!;

  constructor() {
    try { this.muted = localStorage.getItem(muteKey) === 'true'; } catch { /* Storage is optional. */ }
    this.audio.volume = .32;
    if (!('webkitdirectory' in this.input)) this.folder.textContent = 'Choose music files';
    this.folder.addEventListener('click', () => this.input.click());
    this.input.addEventListener('change', () => this.importTracks());
    this.toggle.addEventListener('click', () => {
      this.muted = !this.audio.paused;
      try { localStorage.setItem(muteKey, String(this.muted)); } catch { /* Storage is optional. */ }
      if (this.muted) {
        this.blocked = false;
        this.audio.pause();
        this.paint();
      } else {
        this.play();
      }
    });
    this.audio.addEventListener('playing', () => {
      this.failures = 0;
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
        this.library = saved;
        this.loadTrack();
      }
    }).catch(() => { /* Keep music optional if storage is unavailable. */ });
  }

  setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.trackIndex = 0;
    this.failures = 0;
    this.loadTrack();
  }

  private importTracks(): void {
    const library = selectMusicTracks(Array.from(this.input.files ?? []));
    this.input.value = '';
    if (!library) {
      this.status.textContent = 'Choose a folder with m01001 and at least one gameplay audio track.';
      return;
    }
    this.library = library;
    this.trackIndex = 0;
    this.failures = 0;
    this.savingFailed = false;
    this.loadTrack();
    void musicStore('readwrite', store => store.put(library, 'library')).catch(() => {
      if (this.library === library) {
        this.savingFailed = true;
        this.paint();
      }
    });
  }

  private tracks(): readonly File[] {
    if (!this.library || this.scene === 'menu') return [];
    return this.scene === 'lobby' ? [this.library.lobby] : this.library.match;
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
    const tracks = this.tracks();
    const track = tracks[this.trackIndex];
    if (track) {
      this.source = URL.createObjectURL(track);
      this.audio.loop = tracks.length === 1;
      this.audio.src = this.source;
    }
    this.paint();
    this.play();
  }

  private play(): void {
    const source = this.source;
    if (!source || this.muted || !this.audio.paused) return;
    this.blocked = false;
    void this.audio.play().catch((error: DOMException) => {
      if (this.source !== source || this.muted || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        this.blocked = true;
        this.paint();
      } else {
        this.onTrackError();
      }
    });
  }

  private advance(): void {
    const count = this.tracks().length;
    if (!count) return;
    this.trackIndex = (this.trackIndex + 1) % count;
    this.loadTrack();
  }

  private onTrackError(): void {
    if (++this.failures < this.tracks().length) {
      this.advance();
    } else {
      this.clearTrack();
      this.paint();
      this.status.textContent = 'The browser could not play this music. Try MP3, WAV, or Ogg files.';
    }
  }

  private paint(): void {
    this.toggle.hidden = this.source === null;
    const playing = !!this.source && !this.audio.paused;
    this.toggle.textContent = playing ? 'Pause music' : 'Play music';
    const track = this.source ? this.tracks()[this.trackIndex] : undefined;
    const suffix = this.savingFailed ? ' Choose the folder again after reloading to keep using it.' : '';
    this.status.textContent = track
      ? (playing ? 'Playing ' + track.name : this.blocked ? 'Select Play music to start.' : 'Ready to play ' + track.name) + suffix
      : (this.library ? 'Music loaded.' + suffix : '');
  }
}
