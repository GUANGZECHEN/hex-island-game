/** A local match playlist. Track numbers always index the original music library. */
export class MusicQueue {
  private tracks: number[];
  private playing = -1;
  private heard = new Set<number>();
  private random: () => number;

  constructor(count: number, random: () => number = Math.random, avoidFirst?: number) {
    this.random = random;
    this.tracks = Array.from({ length: count }, (_, index) => index);
    this.newPass(avoidFirst);
  }

  get order(): readonly number[] { return this.tracks; }
  get current(): number { return this.playing; }

  private shuffled(tracks: number[]): number[] {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    return tracks;
  }

  private newPass(avoidFirst?: number): void {
    const tracks = this.shuffled([...this.tracks]);
    if (tracks.length > 1 && tracks[0] === avoidFirst) {
      const next = 1 + Math.floor(this.random() * (tracks.length - 1));
      [tracks[0], tracks[next]] = [tracks[next], tracks[0]];
    }
    this.tracks = tracks;
    this.heard.clear();
    if (tracks.length) this.select(tracks[0]);
  }

  advance(): void {
    if (!this.tracks.length) return;
    if (this.heard.size === this.tracks.length) {
      this.newPass(this.playing);
      return;
    }
    const start = this.tracks.indexOf(this.playing);
    for (let step = 1; step < this.tracks.length; step++) {
      const track = this.tracks[(start + step) % this.tracks.length];
      if (!this.heard.has(track)) {
        this.select(track);
        return;
      }
    }
  }

  select(track: number): void {
    if (!Number.isInteger(track) || track < 0 || track >= this.tracks.length) return;
    this.playing = track;
    this.heard.add(track);
  }

  move(track: number, direction: -1 | 1): void {
    const from = this.tracks.indexOf(track);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= this.tracks.length) return;
    const tracks = [...this.tracks];
    [tracks[from], tracks[to]] = [tracks[to], tracks[from]];
    this.tracks = tracks;
  }

  shuffle(): void {
    if (this.playing < 0) return;
    const upcoming = this.tracks.filter(track => track !== this.playing);
    this.shuffled(upcoming);
    // Make a press of Shuffle visible even if the random draw kept every row in place.
    if (upcoming.length > 1 && this.tracks[0] === this.playing && upcoming.every((track, i) => track === this.tracks[i + 1])) {
      const next = 1 + Math.floor(this.random() * (upcoming.length - 1));
      [upcoming[0], upcoming[next]] = [upcoming[next], upcoming[0]];
    }
    this.tracks = [this.playing, ...upcoming];
    this.heard.clear();
    this.heard.add(this.playing);
  }
}
