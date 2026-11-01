export type Signal = { version: 1; type: 'offer' | 'answer'; sdp: string };
export function encodeSignal(description: RTCSessionDescriptionInit): string {
  if ((description.type !== 'offer' && description.type !== 'answer') || !description.sdp) throw new Error('Missing offer or answer SDP.');
  return JSON.stringify({ version: 1, type: description.type, sdp: description.sdp } satisfies Signal);
}
export function decodeSignal(text: string, expected: Signal['type']): Signal {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Connection data is not valid JSON.'); }
  if (!value || typeof value !== 'object') throw new Error('Invalid connection data.');
  const signal = value as Record<string, unknown>;
  if (signal.version !== 1 || signal.type !== expected || typeof signal.sdp !== 'string' || !signal.sdp.trim()) throw new Error(`Expected a valid version 1 ${expected}.`);
  return { version: 1, type: expected, sdp: signal.sdp };
}
