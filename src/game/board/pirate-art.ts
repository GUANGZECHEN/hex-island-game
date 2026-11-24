// Original blockade insignia, in a 100-unit square, shared by both board views.
export const PIRATE_COLORS = { hull: '#222d38', sail: '#303c48', trim: '#fff2cf', pennant: '#cf3734' };
export const PIRATE_CLOTH = 'M17 30 Q51 35 85 29 Q74 54 86 84 Q55 77 16 84 Z';
export const PIRATE_PENNANT = 'M17 5 L83 11 L62 17 L76 23 L17 20 Z';
export const PIRATE_CROSS = 'M38 42 L64 60 M63 42 L38 60';

export function portDescription(type: string, closed: boolean): string {
  const name = type === 'generic' ? 'Any resource 3:1 port' : `${type} 2:1 port`;
  return closed ? `${name}, pirate blockade, port trade closed` : name;
}
