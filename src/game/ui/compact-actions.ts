/** Presentation only: command names, costs, permissions and handlers stay unchanged. */
const LABELS: Readonly<Record<string, string>> = Object.freeze({
  'Place road': 'Road',
  'Build road': 'Road',
  'Place settlement': 'Settlement',
  'Build settlement': 'Settlement',
  'Upgrade city': 'City',
  'Upgrade house to city': 'City',
  'Place city': 'City',
  'Build trade station': 'Station',
  'Buy development card': 'Develop',
  'Roll dice': 'Roll',
  'Move robber': 'Robber',
  'Finish free roads': 'Done',
  'Claim victory': 'Victory',
  'Make offer': 'Offer',
  'Accept trade': 'Accept',
  'Reject trade': 'Reject',
  'Cancel offer': 'Cancel',
  'Play Knight': 'Knight',
  'Play Road Building': 'Free roads',
  'Play Monopoly': 'Monopoly',
  'Play Year of Plenty': 'Plenty',
});

export function compactActionLabel(fullLabel: string): string {
  const ship=/^Build ship · (\d+)\/2 left · 1 VP$/.exec(fullLabel);
  if(ship)return `Ship · ${ship[1]}/2 (+1 VP)`;
  return Object.hasOwn(LABELS, fullLabel) ? LABELS[fullLabel] : fullLabel;
}

/** Keep the explicit meaning available on hover and to assistive technology. */
export function setCompactActionLabel(button: HTMLButtonElement, text: HTMLElement, fullLabel: string): void {
  text.textContent = compactActionLabel(fullLabel);
  button.title = fullLabel;
  button.setAttribute('aria-label', fullLabel);
}
