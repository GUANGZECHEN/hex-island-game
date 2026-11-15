import { ThreeBoardRenderer } from './renderer.ts';
import type { BoardSceneView } from './model.ts';
import '../../../three-board.css';

/** Rendering strategy only. All state and target validation belong to the caller. */
export class BoardRendererController {
  private instance: ThreeBoardRenderer | null = null;
  private fallback = false;
  private explicit2D = new URLSearchParams(location.search).get('renderer') === '2d';
  private last: BoardSceneView | null = null;
  private reason = '';
  private abort = new AbortController();
  constructor(private host: HTMLElement, private drawSVG: () => void, private choose: (id: string) => void) {
    const toggle = document.getElementById('board-render-toggle') as HTMLButtonElement;
    const reset = document.getElementById('board-view-reset') as HTMLButtonElement;
    const top = document.getElementById('board-view-top') as HTMLButtonElement;
    const touch = document.getElementById('board-adjust-view') as HTMLInputElement;
    toggle.addEventListener('click', () => { this.explicit2D = !!this.instance; this.fallback = false; this.reason = ''; if (this.last) this.update(this.last); }, { signal: this.abort.signal });
    reset.addEventListener('click', () => this.instance?.resetView(), { signal: this.abort.signal });
    top.addEventListener('click', () => this.instance?.topView(), { signal: this.abort.signal });
    touch.addEventListener('change', () => this.instance?.setTouchAdjustment(touch.checked), { signal: this.abort.signal });
    window.addEventListener('pagehide', () => this.dispose(), { once: true, signal: this.abort.signal });
    if (new URLSearchParams(location.search).has('qa3d')) {
      (window as unknown as Record<string, unknown>).__hex3D = {
        inspect: () => this.instance?.inspect() ?? { mode: '2d', reason: this.reason },
        point: (id: string) => this.instance?.targetPoint(id) ?? null,
        loseContext: () => this.instance?.simulateContextLoss(),
      };
    }
  }
  update(view: BoardSceneView): void {
    this.last = view;
    if (!this.explicit2D && !this.fallback) {
      try {
        if (this.instance) this.instance.update(view);
        else {
          this.instance = new ThreeBoardRenderer(this.host, view, this.choose, reason => {
            this.reason = reason; this.fallback = true;
            queueMicrotask(() => { this.instance?.dispose(); this.instance = null; if (this.last) this.update(this.last); });
          });
          this.instance.setTouchAdjustment((document.getElementById('board-adjust-view') as HTMLInputElement).checked);
        }
      } catch (error) { this.reason = `3D unavailable: ${error instanceof Error ? error.message : String(error)}. Using 2D.`; this.fallback = true; this.instance?.dispose(); this.instance = null; }
    }
    if (this.explicit2D || this.fallback) {
      this.instance?.dispose(); this.instance = null; this.host.dataset.renderer = '2d'; this.drawSVG();
    }
    const active = !!this.instance;
    (document.getElementById('board-render-toggle') as HTMLButtonElement).textContent = active ? '2D view' : '3D view';
    (document.getElementById('board-view-reset') as HTMLButtonElement).disabled = !active;
    (document.getElementById('board-view-top') as HTMLButtonElement).disabled = !active;
    (document.getElementById('board-adjust-view') as HTMLInputElement).disabled = !active;
    const label = document.getElementById('board-render-mode')!; label.textContent = active ? '3D · Middle drag to orbit' : this.reason || '2D compatibility view';
    this.host.dispatchEvent(new Event('board-layout-ready'));
  }
  resetCamera(): void { this.instance?.resetView(); }
  dispose(): void { this.instance?.dispose(); this.instance = null; this.abort.abort(); }
}
