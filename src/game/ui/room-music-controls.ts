import type { BrowserGame, RoomMusicState } from '../network/browser';
import type { GameMusic } from './music.ts';
import { RoomMusicCapture } from './room-music-capture.ts';
import { RoomMusicPlayback, type RoomMusicPlaybackStatus } from './room-music-playback.ts';

const listenKey = 'hex-room-music-listen-v1';

export class RoomMusicControls {
  private network: BrowserGame | null = null;
  private state: RoomMusicState = { role: null, offered: false };
  private shareAttempt = 0;
  private sharePending = false;
  private shareError = '';
  private playbackStatus: RoomMusicPlaybackStatus = 'waiting';
  private listen = document.querySelector<HTMLInputElement>('#music-listen-room')!;
  private share = document.querySelector<HTMLInputElement>('#music-share-room')!;
  private enable = document.querySelector<HTMLButtonElement>('#music-enable-room')!;
  private capture: RoomMusicCapture;
  private playback: RoomMusicPlayback;

  private readonly music: GameMusic;

  constructor(music: GameMusic) {
    this.music = music;
    this.capture = new RoomMusicCapture(
      document.querySelector<HTMLAudioElement>('#music-player')!,
      data => this.network?.publishMusicFrame(data),
      () => this.network?.resetMusicPlayback(),
    );
    this.playback = new RoomMusicPlayback(status => {
      this.playbackStatus = status;
      this.paint();
    });
    try { this.listen.checked = localStorage.getItem(listenKey) !== 'false'; } catch { /* Playback needs no storage. */ }
    this.listen.addEventListener('change', () => {
      try { localStorage.setItem(listenKey, String(this.listen.checked)); } catch { /* Device preference is optional. */ }
      if (this.listen.checked) void this.playback.unlock();
      this.updateListening();
    });
    this.share.addEventListener('change', () => { void this.changeSharing(); });
    this.enable.addEventListener('click', () => { void this.playback.unlock(); });
    const unlockBeforeOffer = () => {
      if (this.state.role === 'guest' && !this.state.offered && this.listen.checked) void this.playback.unlock();
    };
    document.addEventListener('click', unlockBeforeOffer, { capture: true });
    document.addEventListener('keydown', unlockBeforeOffer, { capture: true });
  }

  attach(network: BrowserGame): void {
    this.network = network;
    this.updateListening();
  }

  setState = (state: RoomMusicState): void => {
    const previous = this.state;
    this.state = state;
    if (state.role !== 'host' || (previous.offered && !state.offered)) {
      this.shareAttempt++;
      this.sharePending = false;
      this.shareError = '';
      this.capture.disable();
    }
    this.share.checked = state.role === 'host' && (state.offered || this.sharePending);
    this.updateListening();
  };

  setSubscribers = (active: boolean): void => { this.capture.setStreaming(active); };

  receive = (frame: { base64: string; seq: number }): void => {
    if (this.state.role === 'guest' && this.state.offered && this.listen.checked) this.playback.push(frame.seq, frame.base64);
  };

  resetPlayback = (): void => { this.playback.stop(); };

  private updateListening(): void {
    const guest = this.state.role === 'guest';
    const active = guest && this.state.offered && this.listen.checked;
    if (guest) this.network?.setMusicListening(this.listen.checked);
    this.playback.setSubscribed(active);
    this.music.setRoomListening(active);
    this.paint();
  }

  private async changeSharing(): Promise<void> {
    if (this.state.role !== 'host' || !this.network) return;
    const attempt = ++this.shareAttempt;
    this.shareError = '';
    this.sharePending = this.share.checked;
    if (!this.share.checked) {
      this.capture.disable();
      this.network.setMusicSharing(false);
      this.paint();
      return;
    }
    try {
      // Start under the host's click so browsers can unlock their audio graph.
      await this.capture.enable();
      if (attempt !== this.shareAttempt) return;
      this.sharePending = false;
      this.network.setMusicSharing(true);
    } catch {
      if (attempt !== this.shareAttempt) return;
      this.sharePending = false;
      this.capture.disable();
      this.share.checked = false;
      this.shareError = 'Could not start music sharing in this browser. Try a current browser and switch sharing on again.';
    }
    this.paint();
  }

  private paint(): void {
    const guest = this.state.role === 'guest';
    const listening = guest && this.state.offered && this.listen.checked;
    document.getElementById('music-room-host')!.hidden = this.state.role !== 'host';
    document.getElementById('music-room-guest')!.hidden = !guest;
    document.getElementById('music-local-controls')!.hidden = listening;
    this.enable.hidden = !(listening && this.playbackStatus === 'needs-click');
    document.querySelector('#music-controls summary')!.textContent = this.enable.hidden ? 'Music' : 'Music · Tap to listen';
    document.getElementById('music-share-status')!.textContent = this.shareError ||
      (this.sharePending ? 'Starting room audio…' : this.state.offered && this.state.role === 'host' ? 'Your music is shared with everyone in this room.' : '');
    const status = !this.listen.checked ? 'Room music is muted on this device.'
      : !this.state.offered ? 'Waiting for the host to share music.'
      : this.playbackStatus === 'playing' ? 'Playing room music.'
      : this.playbackStatus === 'needs-click' ? 'Tap Play room music to listen.'
      : 'Waiting for the host’s music.';
    document.getElementById('music-listen-status')!.textContent = guest ? status : '';
  }
}
