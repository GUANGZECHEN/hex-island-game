export type CandidateCounts = { total: number; host: number; srflx: number; prflx: number; relay: number; unknown: number };

// Only aggregate candidate types; never return addresses or raw candidate text.
export function countCandidates(sdp: string | null | undefined): CandidateCounts {
  const counts: CandidateCounts = { total: 0, host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 };
  for (const line of (sdp ?? '').split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    counts.total++;
    const type = /(?:^|\s)typ\s+(host|srflx|prflx|relay)(?:\s|$)/.exec(line)?.[1];
    if (type === 'host' || type === 'srflx' || type === 'prflx' || type === 'relay') counts[type]++;
    else counts.unknown++;
  }
  return counts;
}
export function formatCandidates(sdp: string | null | undefined): string {
  const c = countCandidates(sdp);
  return `${c.total} (host ${c.host}, srflx ${c.srflx}, prflx ${c.prflx}, relay ${c.relay}, unknown ${c.unknown})`;
}
