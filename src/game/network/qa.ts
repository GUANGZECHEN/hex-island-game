/** QA mode is deliberately opt-in and never inferred from the number of seats. */
export function isTwoPlayerQa(search: string): boolean {
  const values = new URLSearchParams(search).getAll('qaPlayers');
  return values.length === 1 && values[0] === '2';
}
