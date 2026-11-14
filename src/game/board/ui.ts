import { generateBoardSetup } from './setup';
import { renderIslandBoard } from './render';

export function initializeBoardUI(): void {
  const container = document.getElementById('board')!;
  const input = document.getElementById('board-seed') as HTMLInputElement;
  const status = document.getElementById('board-seed-status')!;
  const error = document.getElementById('board-error')!;
  let currentSeed = 1;
  const update = (seed: number) => {
    const setup = generateBoardSetup(seed);
    renderIslandBoard(container, setup);
    currentSeed = seed;
    input.value = String(seed);
    status.textContent = `Current seed: ${seed}`;
    error.textContent = '';
  };
  const attempt = (action: () => void) => {
    try { action(); } catch (cause) { error.textContent = cause instanceof Error ? cause.message : 'Unable to generate board.'; }
  };
  document.getElementById('apply-seed')!.addEventListener('click', () => attempt(() => {
    if (!input.value || !input.validity.valid) throw new RangeError('Enter an integer seed from 0 to 4294967295.');
    update(input.valueAsNumber);
  }));
  document.getElementById('new-board')!.addEventListener('click', () => attempt(() => {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random generation is unavailable. Enter a seed instead.');
    const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    update(seed === currentSeed ? (seed + 1) >>> 0 : seed);
  }));
  update(currentSeed);
}
