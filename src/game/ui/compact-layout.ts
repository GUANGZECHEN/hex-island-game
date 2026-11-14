/** Layout-only sizing. Game rules and networking never depend on these values. */
export interface CompactBoardSize {
  stageWidth: number;
  mapWidth: number;
  playerWidth: number;
  controlWidth: number;
  gap: number;
}

/** Remove SVG letterboxing from the center grid track, not by cropping the map. */
export function compactBoardSize(
  availableWidth: number,
  availableHeight: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
): CompactBoardSize | null {
  if (![availableWidth, availableHeight, viewBoxWidth, viewBoxHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const playerWidth = 210, controlWidth = 300, gap = 8;
  const fixedWidth = playerWidth + controlWidth + 2 * gap;
  if (availableWidth <= fixedWidth) return null;
  const mapWidth = Math.floor(Math.min(availableWidth - fixedWidth, availableHeight * viewBoxWidth / viewBoxHeight));
  if (mapWidth < 1) return null;
  return {stageWidth: fixedWidth + mapWidth, mapWidth, playerWidth, controlWidth, gap};
}

/** Preserve the existing height-fit logic; tighten only its horizontal allocation. */
export function installCompactBoardLayout(): () => void {
  const game = document.getElementById('game');
  const stage = game?.querySelector<HTMLElement>('.board-stage');
  const panel = game?.querySelector<HTMLElement>('.board-panel');
  const board = document.getElementById('board');
  if (!game || !stage || !panel || !board) return () => {};
  let frame: number | null = null;
  const properties = ['--compact-stage-width', '--compact-player-width', '--compact-control-width', '--compact-gap'];
  const clear = () => { for (const property of properties) game.style.removeProperty(property); };
  const px = (value: string) => Number.parseFloat(value) || 0;
  const fit = () => {
    frame = null;
    if (window.innerWidth <= 1100 || game.hidden) { clear(); return; }
    const svg = board.querySelector<SVGSVGElement>('svg.island-board');
    if (!svg) { clear(); return; }
    const bounds = svg.viewBox.baseVal;
    const panelStyle = getComputedStyle(panel), boardStyle = getComputedStyle(board);
    const width = panel.clientWidth - px(panelStyle.paddingLeft) - px(panelStyle.paddingRight);
    const height = board.clientHeight - px(boardStyle.paddingTop) - px(boardStyle.paddingBottom);
    const size = compactBoardSize(width, height, bounds.width, bounds.height);
    if (!size) { clear(); return; }
    const values = [size.stageWidth, size.playerWidth, size.controlWidth, size.gap];
    properties.forEach((property, index) => {
      const value = `${values[index]}px`;
      if (game.style.getPropertyValue(property) !== value) game.style.setProperty(property, value);
    });
  };
  const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(fit); };
  // Observe only layout and board replacement; never replace input nodes or reset selections.
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resize?.observe(panel); resize?.observe(stage); resize?.observe(board);
  const mutation = new MutationObserver(schedule);
  mutation.observe(board, {childList: true});
  window.addEventListener('resize', schedule, {passive: true});
  window.visualViewport?.addEventListener('resize', schedule, {passive: true});
  schedule();
  return () => {
    resize?.disconnect(); mutation.disconnect();
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
    clear();
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') installCompactBoardLayout();
