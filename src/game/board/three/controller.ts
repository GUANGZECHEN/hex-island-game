import { ThreeBoardRenderer, type BoardCameraView } from './renderer.ts';
import { staticBoardKey, svgBoardKey, type BoardSceneView } from './model.ts';
import { BoardRollOverlay } from './roll-overlay.ts';
import type { RollPresentation } from './roll-presentation.ts';
import { TargetFeedback, TAP_MAX_DISTANCE, isPlacement, type PlacementKind } from '../target-feedback.ts';
import '../../../three-board.css';
import '../../../target-feedback.css';

/** Rendering strategy only. All state and target validation belong to the caller. */
export class BoardRendererController {
  private instance: ThreeBoardRenderer | null = null;
  private rollOverlay: BoardRollOverlay | null = null;
  private activeRoll: {event:RollPresentation; complete:()=>void} | null = null;
  private rememberedCamera: BoardCameraView | null;
  private fallback = false;
  private explicit2D = new URLSearchParams(location.search).get('renderer') === '2d';
  private last: BoardSceneView | null = null;
  private reason = '';
  private abort = new AbortController();
  private preview = new TargetFeedback();
  private svgPiece?: (id: string, kind: PlacementKind) => SVGElement | null;
  private svgKey: string | null = null;
  constructor(private host: HTMLElement, private drawSVG: (legalTargets: readonly string[]) => ((id: string, kind: PlacementKind) => SVGElement | null) | void, private choose: (id: string) => void, previousCamera: BoardCameraView | null = null) {
    this.rememberedCamera = previousCamera;
    const toggle = document.getElementById('board-render-toggle') as HTMLButtonElement;
    const reset = document.getElementById('board-view-reset') as HTMLButtonElement;
    const top = document.getElementById('board-view-top') as HTMLButtonElement;
    const touch = document.getElementById('board-adjust-view') as HTMLInputElement;
    toggle.addEventListener('click', () => { this.preview.hover(null); this.rollOverlay?.dispose();this.rollOverlay=null; if (this.instance) this.rememberedCamera = this.instance.captureView(); this.explicit2D = !!this.instance; this.fallback = false; this.reason = ''; if (this.last) this.update(this.last); this.resumeRoll(); }, { signal: this.abort.signal });
    reset.addEventListener('click', () => this.instance?.resetView(), { signal: this.abort.signal });
    top.addEventListener('click', () => this.instance?.topView(), { signal: this.abort.signal });
    touch.addEventListener('change', () => this.instance?.setTouchAdjustment(touch.checked), { signal: this.abort.signal });
    this.bindSvgTargets();
    window.addEventListener('pagehide', () => this.dispose(), { once: true, signal: this.abort.signal });
    if (new URLSearchParams(location.search).has('qa3d')) {
      (window as unknown as Record<string, unknown>).__hex3D = {
        renderedFrames: () => this.instance?.renderedFrames ?? 0,
        inspect: () => this.instance?.inspect() ?? { mode: '2d', reason: this.reason, highlightedTarget: this.preview.active, rollEffect: this.rollOverlay?.inspect()??null },
        point: (id: string) => this.instance?.targetPoint(id) ?? null,
        decorativePoint: (kind: string) => this.instance?.decorationPoint(kind) ?? null,
        loseContext: () => this.instance?.simulateContextLoss(),
      };
    }
  }
  private bindSvgTargets(): void {
    const signal = this.abort.signal;
    const target = (node: EventTarget | null) => node instanceof Element ? node.closest<SVGElement>('[data-target-id]') : null;
    const hover = (element: SVGElement | null) => {
      this.preview.hover(element?.dataset.targetId ?? null);
      this.paintSVG();
    };
    let press: { element: SVGElement; pointer: number; x: number; y: number } | null = null;
    let touchInput = false;
    const cancel = () => {
      if (press) { press = null; hover(null); }
    };
    const blocked = () => this.instance !== null || document.body.classList.contains('network-resyncing');
    this.host.addEventListener('pointerover', event => {
      if (event.pointerType !== 'touch' && !blocked()) hover(target(event.target));
    }, { signal });
    this.host.addEventListener('pointerout', event => {
      if (event.pointerType !== 'touch' && !this.instance) hover(target(event.relatedTarget));
    }, { signal });
    window.addEventListener('keydown', () => { touchInput = false; }, { capture: true, signal });
    this.host.addEventListener('focusin', event => {
      if (!touchInput && !blocked()) hover(target(event.target));
    }, { signal });
    this.host.addEventListener('focusout', event => {
      if (!this.instance && !press) hover(target(event.relatedTarget));
    }, { signal });
    // Even a second finger outside the board invalidates an in-progress tap.
    window.addEventListener('pointerdown', event => {
      touchInput = event.pointerType === 'touch';
      if (press && event.pointerId !== press.pointer) cancel();
    }, { capture: true, signal });
    this.host.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || blocked() || !event.isPrimary || event.button !== 0) return;
      const element = target(event.target);
      const id = element?.dataset.targetId;
      if (!element || !id || !this.last?.legalTargets.includes(id)) return;
      press = { element, pointer: event.pointerId, x: event.clientX, y: event.clientY };
      hover(element);
    }, { signal });
    this.host.addEventListener('pointermove', event => {
      if (press && event.pointerId === press.pointer && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_MAX_DISTANCE) cancel();
    }, { signal });
    this.host.addEventListener('pointerup', event => {
      if (!press || event.pointerId !== press.pointer) return;
      const start = press;
      const id = start.element.dataset.targetId;
      const release = target(document.elementFromPoint(event.clientX, event.clientY));
      cancel();
      if (!blocked() && event.isPrimary && event.button === 0 &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_MAX_DISTANCE &&
          release === start.element && id && this.last?.legalTargets.includes(id)) this.choose(id);
    }, { signal });
    for (const type of ['pointercancel', 'pointerleave', 'lostpointercapture', 'contextmenu']) {
      this.host.addEventListener(type, cancel, { signal });
    }
    window.addEventListener('scroll', cancel, { capture: true, passive: true, signal });
    // Browsers can generate a compatibility click after a touch, including a
    // rejected gesture. Only non-touch clicks reach the SVG mouse/keyboard path.
    this.host.addEventListener('click', event => {
      if (!target(event.target)) return;
      if (event.detail !== 0 && ((event as PointerEvent).pointerType === 'touch' || touchInput)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true, signal });
  }
  private paintSVG(): void {
    for (const target of Array.from(this.host.querySelectorAll<SVGElement>('[data-target-id]'))) {
      const active = target.getAttribute('data-target-id') === this.preview.active;
      target.classList.toggle('target-active', active);
      target.setAttribute('data-target-active', String(active));
    }
    const id = this.preview.active, kind = this.last?.targetMode ?? null;
    const previous = this.host.querySelector<SVGElement>('[data-placement-preview]');
    if (previous && previous.dataset.previewTarget === id && previous.dataset.placementPreview === kind) return;
    previous?.remove();
    for (const hex of Array.from(this.host.querySelectorAll('.placement-neighbor'))) hex.classList.remove('placement-neighbor');
    if (id && isPlacement(kind)) this.svgPiece?.(id, kind);
  }
  update(view: BoardSceneView): void {
    // SVG redraw and renderer switches replace board children; keep live alerts.
    const alerts=Array.from(this.host.querySelectorAll<HTMLElement>('.turn-alert,.activity-alert,.victory-alert,.supplement-alert'));
    let resumeAfterFallback=false;
    this.last = view;
    this.preview.update(`${staticBoardKey(view.board)}:${view.placementPlayerId ?? ''}:${view.targetMode ?? ''}`, view.legalTargets);
    if (!this.explicit2D && !this.fallback) {
      try {
        if (this.instance) this.instance.update(view);
        else {
          this.instance = new ThreeBoardRenderer(this.host, view, this.choose, reason => {
            this.reason = reason; this.fallback = true;
            queueMicrotask(() => { if (this.instance) this.rememberedCamera = this.instance.captureView(); this.instance?.dispose(); this.instance = null; if (this.last) this.update(this.last); this.resumeRoll(); });
          });
          this.instance.setTouchAdjustment((document.getElementById('board-adjust-view') as HTMLInputElement).checked);
          if (this.rememberedCamera) this.instance.restoreView(this.rememberedCamera);
        }
      } catch (error) { this.reason = `3D unavailable: ${error instanceof Error ? error.message : String(error)}. Using 2D.`; this.fallback = true; if (this.instance) this.rememberedCamera = this.instance.captureView(); this.instance?.dispose(); this.instance = null; resumeAfterFallback=true; }
    }
    if (this.explicit2D || this.fallback) {
      if (this.instance) this.rememberedCamera = this.instance.captureView();
      this.instance?.dispose(); this.instance = null; this.host.dataset.renderer = '2d';
      const key = svgBoardKey(view);
      // Discard acknowledgements and snapshots change controls and hands, not
      // the board. Keep the existing SVG (and its focus/animation state).
      if (key !== this.svgKey || !this.host.querySelector('svg.island-board')) {
        this.svgPiece = this.drawSVG(view.legalTargets) || undefined;
        this.svgKey = key;
      }
      this.paintSVG();
      this.rollOverlay?.update(view);
      if(resumeAfterFallback)this.resumeRoll();
    }
    else this.svgKey = null;
    const active = !!this.instance;
    (document.getElementById('board-render-toggle') as HTMLButtonElement).textContent = active ? '2D view' : '3D view';
    (document.getElementById('board-view-reset') as HTMLButtonElement).disabled = !active;
    (document.getElementById('board-view-top') as HTMLButtonElement).disabled = !active;
    (document.getElementById('board-adjust-view') as HTMLInputElement).disabled = !active;
    const label = document.getElementById('board-render-mode')!; label.textContent = active ? '3D · Middle drag to orbit' : this.reason || '2D compatibility view';
    for(const alert of alerts)if(!alert.isConnected)this.host.append(alert);
    this.host.dispatchEvent(new Event('board-layout-ready'));
  }
  /** Gameplay state is already committed before this local display event arrives. */
  playRoll(event: RollPresentation, onComplete:()=>void):void {
    this.clearRoll();
    this.activeRoll={event,complete:onComplete};
    this.resumeRoll();
  }
  private resumeRoll():void {
    const active=this.activeRoll;
    if(!active||this.rollOverlay)return;
    const complete=()=>{if(this.activeRoll!==active)return;this.activeRoll=null;active.complete();};
    if(this.instance)this.instance.playRoll(active.event,complete);
    else if(this.last)this.rollOverlay=new BoardRollOverlay(this.host,active.event,this.last,complete);
  }
  clearRoll():void {this.activeRoll=null;this.rollOverlay?.dispose();this.rollOverlay=null;this.instance?.stopRoll();}
  resetCamera(): void { this.instance?.resetView(); }
  cameraView(): BoardCameraView | null { return this.instance?.captureView() ?? this.rememberedCamera; }
  dispose(): void { this.svgPiece = undefined; this.rememberedCamera = this.cameraView(); this.rollOverlay?.dispose();this.rollOverlay=null;this.instance?.dispose(); this.instance = null; this.abort.abort(); }
}
