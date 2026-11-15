import assert from 'node:assert/strict';

// Browser-test helper: inspect public hit targets, then send real pointer input.
// No game-state setter or direct command submission is used.
export async function assertDirectTargets(page) {
  assert.equal(await page.locator('#targets select, #targets input').count(), 0, 'Coordinate picker must not exist');
  assert.equal(await page.getByRole('button', { name: 'Use target', exact: true }).count(), 0, 'Coordinate confirmation must not exist');
}
export async function boardTargetIds(page) {
  return page.evaluate(() => document.querySelector('#board')?.dataset.renderer === '3d'
    ? [...(window.__hex3D?.inspect().targets ?? [])]
    : Array.from(document.querySelectorAll('#board [data-target-id]'), node => node.getAttribute('data-target-id')));
}
export async function boardTargetPoint(page, id) {
  await page.locator('#board').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(id => {
    if (document.querySelector('#board')?.dataset.renderer === '3d') return window.__hex3D.point(id);
    const target = Array.from(document.querySelectorAll('#board [data-target-id]')).find(node => node.getAttribute('data-target-id') === id);
    if (!target) return null;
    const surface = target.querySelector('.island-cell') ?? target;
    const bounds = surface.getBBox(), matrix = surface.getScreenCTM();
    if (!matrix) return null;
    const point = surface.ownerSVGElement.createSVGPoint();
    point.x = bounds.x + bounds.width / 2; point.y = bounds.y + bounds.height / 2;
    const screen = point.matrixTransform(matrix); return { x: screen.x, y: screen.y };
  }, id);
}
export async function clickBoardTarget(page, id) {
  await assertDirectTargets(page);
  id ??= (await boardTargetIds(page))[0];
  assert.ok(id, 'Expected a legal on-board target');
  const point = await boardTargetPoint(page, id);
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y), 'Expected a visible target point');
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#game-error').textContent(), '', 'Board click must pass normal game validation');
  return id;
}
