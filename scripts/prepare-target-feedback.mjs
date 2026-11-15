import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

function patch(path, replacements) {
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    assert.equal(text.split(from).length - 1, 1, `Unique source anchor required: ${path}: ${from.slice(0,80)}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text);
}
const methods = `  /** Presentation-only highlight: never changes the camera, scene identity or game. */
  highlightTarget(id: string | null): void {
    this.preview.select(id); this.paintTargets();
  }
  private paintTargets(): void {
    let changed = false;
    for (const object of this.targets.children) {
      if (!(object instanceof THREE.Mesh)) continue;
      const active = object.userData.id === this.preview.active;
      const material = active ? this.activeTargetMaterial : this.targetMaterial;
      if (object.material !== material) { object.material = material; changed = true; }
      object.userData.highlighted = active; object.renderOrder = active ? 9 : 8;
    }
    if (changed) this.invalidate();
  }
  private targetAt(x: number, y: number): string | null {
    if (this.disposed || this.adjustTouch || !this.view.targetMode || document.body.classList.contains('network-resyncing')) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.targets.children, false)[0];
    const id = hit ? String(hit.object.userData.id) : null;
    return id && this.view.legalTargets.includes(id) ? id : null;
  }
  private hover = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    const dragging = (event.buttons & 6) !== 0 || !!this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5;
    const id = dragging ? null : this.targetAt(event.clientX, event.clientY);
    this.preview.hover(id); this.canvas.style.cursor = id ? 'pointer' : ''; this.paintTargets();
  };
  private leaveTarget = (): void => {
    this.down = null; this.preview.hover(null); this.canvas.style.cursor = ''; this.paintTargets();
  };
`;
patch('src/game/board/three/renderer.ts', [
  ["import * as THREE from 'three';", "import * as THREE from 'three';\nimport { TargetFeedback, TARGET_COLORS } from '../target-feedback.ts';"],
  ["private targetMaterial = new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: .8, depthTest: false, depthWrite: false });", "private targetMaterial = new THREE.MeshBasicMaterial({ color: TARGET_COLORS.legal, transparent: true, opacity: .8, depthTest: false, depthWrite: false });\n  private activeTargetMaterial = new THREE.MeshBasicMaterial({ color: TARGET_COLORS.active, transparent: true, opacity: .94, depthTest: false, depthWrite: false });\n  private preview = new TargetFeedback();\n  private ray = new THREE.Raycaster();"],
  ["this.controls.addEventListener('start', () => { this.manualView = true; });", "this.controls.addEventListener('start', () => { this.manualView = true; this.leaveTarget(); });"],
  ["if (event.isPrimary && event.button === 0 && !this.adjustTouch) this.down = { x: event.clientX, y: event.clientY };", "if (event.isPrimary && event.button === 0 && !this.adjustTouch) { this.down = { x: event.clientX, y: event.clientY }; this.hover(event); }"],
  ["this.canvas.addEventListener('pointercancel', () => { this.down = null; }, { signal });", "this.canvas.addEventListener('pointermove', this.hover, { signal });\n    this.canvas.addEventListener('pointerleave', this.leaveTarget, { signal });\n    this.canvas.addEventListener('pointercancel', this.leaveTarget, { signal });"],
  ["const targetKey = JSON.stringify([view.targetMode, view.legalTargets]);", "this.preview.update(`${this.key}:${view.targetMode ?? ''}`, view.legalTargets);\n    const targetKey = JSON.stringify([view.targetMode, view.legalTargets]);"],
  ["    this.resize(); this.invalidate();\n  }\n  private corners()", "    this.paintTargets(); this.resize(); this.invalidate();\n  }\n" + methods + "  private corners()"],
  ["setTouchAdjustment(value: boolean): void { this.adjustTouch = value; this.down = null; this.touchPolicy(); }", "setTouchAdjustment(value: boolean): void { this.adjustTouch = value; this.leaveTarget(); this.touchPolicy(); }"],
  ["const rect = this.canvas.getBoundingClientRect(), ray = new THREE.Raycaster();\n    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);\n    this.scene.updateMatrixWorld(true);\n    const hit = ray.intersectObjects(this.targets.children, false)[0];\n    if (hit && this.view.legalTargets.includes(String(hit.object.userData.id))) { this.pickCount++; this.choose(String(hit.object.userData.id)); }", "const id = this.targetAt(event.clientX, event.clientY);\n    if (id) { this.preview.hover(id); this.paintTargets(); this.pickCount++; this.choose(id); }\n    if (event.pointerType === 'touch') this.leaveTarget();"],
  ["targets: [...this.view.legalTargets], targetMode: this.view.targetMode,", "targets: [...this.view.legalTargets], targetMode: this.view.targetMode, highlightedTarget: this.preview.active, selectedTarget: this.preview.selected,\n      targetColors: this.targets.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh).map(o => ({ id: o.userData.id, color: (o.material as THREE.MeshBasicMaterial).color.getHexString(), active: o.userData.highlighted })),"],
  ["this.targetMaterial.dispose(); this.assets.dispose();", "this.targetMaterial.dispose(); this.activeTargetMaterial.dispose(); this.assets.dispose();"]
]);
patch('src/game-ui.ts', [
  ["line.setAttribute('data-legal-target','road');", "line.setAttribute('data-legal-target','road');line.setAttribute('data-target-id',edge.id);"],
  ["piece.setAttribute('data-legal-target','city');", "piece.setAttribute('data-legal-target','city');piece.setAttribute('data-target-id',vertex.id);"],
  ["node.setAttribute('data-legal-target','settlement');", "node.setAttribute('data-legal-target','settlement');node.setAttribute('data-target-id',vertex.id);"],
  ["group.setAttribute('data-legal-target','robber');", "group.setAttribute('data-legal-target','robber');group.setAttribute('data-target-id',id);"],
  ["const choice=select(targets,'Legal target',choices);button(targets,'Use target',()=>moveTarget(choice.value));", "const choice=select(targets,'Legal target',choices);const preview=()=>boardRenderer?.highlightTarget(choice.value);choice.addEventListener('input',preview);choice.addEventListener('change',preview);preview();button(targets,'Use target',()=>moveTarget(choice.value));"]
]);
