/** Camera-local projection only; never gameplay or board generation. */
export interface Frustum { left: number; right: number; top: number; bottom: number }
export interface Viewport { width: number; height: number }

/** Preserve world units per CSS pixel across layout changes after manual orbit/pan/zoom.
 * Position, target, orientation and zoom are intentionally left to the camera owner.
 */
export function resizeManualFrustum(frustum: Frustum, previous: Viewport, next: Viewport): Frustum | null {
  if ([previous.width, previous.height, next.width, next.height].some(value => !Number.isFinite(value) || value <= 0) ||
      Object.values(frustum).some(value => !Number.isFinite(value)) || frustum.right <= frustum.left || frustum.top <= frustum.bottom) return null;
  const cx = (frustum.left + frustum.right) / 2, cy = (frustum.top + frustum.bottom) / 2;
  const hw = (frustum.right - frustum.left) * .5 * next.width / previous.width;
  const hh = (frustum.top - frustum.bottom) * .5 * next.height / previous.height;
  return { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh };
}
