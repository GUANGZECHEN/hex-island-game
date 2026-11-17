import { ThreeBoardRenderer, type BoardCameraView } from './renderer.ts';
import { staticBoardKey, type BoardSceneView } from './model.ts';
import { TargetFeedback } from '../target-feedback.ts';
import '../../../three-board.css';
import '../../../target-feedback.css';

/** Rendering strategy only. All state and target validation belong to the caller. */
export class BoardRendererController {
  private instance: ThreeBoardRenderer | null = null;
  private rememberedCamera: BoardCameraView | null;
  private fallback = false;
  private explicit2D = new URLSearchParams(location.search).get('renderer') === '2d';
  private last: BoardSceneView | null = null;
  private reason = '';
  private abort = new AbortController();
  private preview = new TargetFeedback();
  constructor(private host: HTMLElement, private drawSVG: () => void, private choose: (id: string) => void, previousCamera: BoardCameraView | null = null) {
    this.rememberedCamera = previousCamera;
    const toggle = document.getElementById('board-render-toggle') as HTMLButtonElement;
    const reset = document.getElementById('board-view-reset') as HTMLButtonElement;
    const top = document.getElementById('board-view-top') as HTMLButtonElement;
    const touch = document.getElementById('board-adjust-view') as HTMLInputElement;
    toggle.addEventListener('click', () => { if (this.instance) this.rememberedCamera = this.instance.captureView(); this.explicit2D = !!this.instance; this.fallback = false; this.reason = ''; if (this.last) this.update(this.last); }, { signal: this.abort.signal });
    reset.addEventListener('click', () => this.instance?.resetView(), { signal: this.abort.signal });
    top.addEventListener('click', () => this.instance?.topView(), { signal: this.abort.signal });
    touch.addEventListener('change', () => this.instance?.setTouchAdjustment(touch.checked), { signal: this.abort.signal });
    // Delegation survives SVG redraws without changing the existing click/keyboard handlers.
    const svgTarget = (target: EventTarget | null) => target instanceof Element ? target.closest('[data-target-id]') : null;
    const over = (event: Event) => {
      if (this.instance || document.body.classList.contains('network-resyncing')) return;
      this.preview.hover(svgTarget(event.target)?.getAttribute('data-target-id') ?? null); this.paintSVG();
    };
    const out = (event: Event) => {
      if (this.instance) return;
      const next = svgTarget((event as MouseEvent).relatedTarget);
      this.preview.hover(next?.getAttribute('data-target-id') ?? null); this.paintSVG();
    };
    for (const type of ['pointerover', 'pointerdown', 'focusin']) host.addEventListener(type, over, { signal: this.abort.signal });
    for (const type of ['pointerout', 'focusout', 'pointercancel', 'pointerleave']) host.addEventListener(type, out, { signal: this.abort.signal });
    window.addEventListener('pagehide', () => this.dispose(), { once: true, signal: this.abort.signal });
    if (new URLSearchParams(location.search).has('qa3d')) {
      (window as unknown as Record<string, unknown>).__hex3D = {
        inspect: () => this.instance?.inspect() ?? { mode: '2d', reason: this.reason, highlightedTarget: this.preview.active },
        point: (id: string) => this.instance?.targetPoint(id) ?? null,
        decorativePoint: (kind: string) => this.instance?.decorationPoint(kind) ?? null,
        loseContext: () => this.instance?.simulateContextLoss(),
      };
    }
  }
  private paintSVG(): void {
    for (const target of Array.from(this.host.querySelectorAll<SVGElement>('[data-target-id]'))) {
      const active = target.getAttribute('data-target-id') === this.preview.active;
      target.classList.toggle('target-active', active);
      target.setAttribute('data-target-active', String(active));
    }
  }
  update(view: BoardSceneView): void {
    this.last = view;
    this.preview.update(`${staticBoardKey(view.board)}:${view.targetMode ?? ''}`, view.legalTargets);
    if (!this.explicit2D && !this.fallback) {
      try {
        if (this.instance) this.instance.update(view);
        else {
          this.instance = new ThreeBoardRenderer(this.host, view, this.choose, reason => {
            this.reason = reason; this.fallback = true;
            queueMicrotask(() => { if (this.instance) this.rememberedCamera = this.instance.captureView(); this.instance?.dispose(); this.instance = null; if (this.last) this.update(this.last); });
          });
          this.instance.setTouchAdjustment((document.getElementById('board-adjust-view') as HTMLInputElement).checked);
          if (this.rememberedCamera) this.instance.restoreView(this.rememberedCamera);
        }
        this.instance.highlightTarget(this.preview.selected);
      } catch (error) { this.reason = `3D unavailable: ${error instanceof Error ? error.message : String(error)}. Using 2D.`; this.fallback = true; if (this.instance) this.rememberedCamera = this.instance.captureView(); this.instance?.dispose(); this.instance = null; }
    }
    if (this.explicit2D || this.fallback) {
      if (this.instance) this.rememberedCamera = this.instance.captureView();
      this.instance?.dispose(); this.instance = null; this.host.dataset.renderer = '2d'; this.drawSVG(); this.paintSVG();
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
  cameraView(): BoardCameraView | null { return this.instance?.captureView() ?? this.rememberedCamera; }
  dispose(): void { this.rememberedCamera = this.cameraView(); this.instance?.dispose(); this.instance = null; this.abort.abort(); }
}
