import { readFile, writeFile } from 'node:fs/promises';
const path='src/game/board/three/renderer.ts';let text=await readFile(path,'utf8');
const replace=(a,b)=>{if(!text.includes(a))throw new Error('Renderer source drift: '+a.slice(0,80));text=text.replace(a,b);};
replace("import * as THREE from 'three';", "import * as THREE from 'three';\nimport { resizeManualFrustum } from './camera-layout.ts';");
replace("  private height = 0;", "  private height = 0;\n  private manualView = false;\n  private mapBuilds = 0;");
replace("    this.controls.addEventListener('change', this.invalidate);", "    this.controls.addEventListener('change', this.invalidate);\n    this.controls.addEventListener('start', () => { this.manualView = true; });");
replace("  private rebuildMap(): void {", "  private rebuildMap(): void {\n    this.mapBuilds++;");
replace("  resetView(): void {", "  resetView(): void {\n    this.manualView = false;");
replace("  topView(): void {", "  topView(): void {\n    this.manualView = false;");
replace("    this.width = w; this.height = h; this.renderer.setSize(w, h, false); this.fit(); this.invalidate();", `    // Card notices, hand rows and target controls may resize the surrounding UI.
    // Resizing the canvas must not refit a view that the player deliberately adjusted.
    const preserved = this.manualView ? resizeManualFrustum(this.camera,
      { width: this.width, height: this.height }, { width: w, height: h }) : null;
    this.width = w; this.height = h; this.renderer.setSize(w, h, false);
    if (preserved) { Object.assign(this.camera, preserved); this.camera.updateProjectionMatrix(); }
    else this.fit();
    this.invalidate();`);
replace("return { instanceId: this.instanceId, mode: '3d',", "return { frustum: [this.camera.left, this.camera.right, this.camera.top, this.camera.bottom], projection: this.camera.projectionMatrix.toArray(), quaternion: this.camera.quaternion.toArray(), canvasSize: [this.width, this.height], staticKey: this.key, manualView: this.manualView, mapBuilds: this.mapBuilds, instanceId: this.instanceId, mode: '3d',");
await writeFile(path,text);
