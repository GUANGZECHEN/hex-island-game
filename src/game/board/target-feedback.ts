import type { Board } from './geometry.ts';
import type { TargetMode } from '../rules/legal.ts';

export type PlacementKind = Exclude<TargetMode, 'robber'>;

export function isPlacement(mode: TargetMode | null): mode is PlacementKind {
  return mode !== null && mode !== 'robber';
}

export function adjacentPlacementHexes(board: Board, kind: PlacementKind, id: string): readonly string[] {
  if (kind === 'road') return board.edges.find(edge => edge.id === id)?.hexIds ?? [];
  return board.hexes.filter(hex => hex.vertexIds.includes(id)).map(hex => hex.id);
}

/** Local presentation only: a preview never validates or submits a game command. */
export const TARGET_COLORS = Object.freeze({ legal: '#fff3a0', active: '#ff981f' });

export class TargetFeedback {
  private scope = '';
  private legal = new Set<string>();
  private chosen: string | null = null;
  private pointed: string | null = null;

  update(scope: string, legal: readonly string[]): void {
    if (scope !== this.scope) { this.chosen = null; this.pointed = null; }
    this.scope = scope;
    this.legal = new Set(legal);
    this.chosen = this.valid(this.chosen);
    this.pointed = this.valid(this.pointed);
  }
  private valid(id: string | null): string | null {
    return id !== null && this.legal.has(id) ? id : null;
  }
  select(id: string | null): void { this.chosen = this.valid(id); this.pointed = null; }
  hover(id: string | null): void { this.pointed = this.valid(id); }
  get selected(): string | null { return this.chosen; }
  get active(): string | null { return this.pointed ?? this.chosen; }
}
