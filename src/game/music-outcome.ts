/** A null listener is watching the match without occupying a seat. */
export function matchMusicScene(
  state: { phase: string; winner: string | null; harbor?: { outcome: 'playing' | 'won' | 'lost' } | null },
  listenerId: string | null,
): 'match' | 'win' | 'loss' | 'spectator-end' {
  if (state.phase !== 'finished') return 'match';
  if (listenerId === null) return 'spectator-end';
  if (state.harbor) return state.harbor.outcome === 'won' ? 'win' : 'loss';
  return listenerId === state.winner ? 'win' : 'loss';
}
