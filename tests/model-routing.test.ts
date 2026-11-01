import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChecklist, routeTask, simpleConditions, complexTriggers } from '../src/orchestration/model-routing.ts';
const complete = () => ({ unapprovedDecision: false, simpleConditions: Object.fromEntries(simpleConditions.map(k => [k, true])), complexTriggers: Object.fromEntries(complexTriggers.map(k => [k, false])) });
test('all simple conditions are required and every complex trigger takes precedence', () => {
  assert.equal(classifyChecklist(complete()), 'simple');
  for (const key of simpleConditions) { const c = complete(); c.simpleConditions[key] = false; assert.equal(classifyChecklist(c), 'complex', key); }
  for (const key of complexTriggers) { const c = complete(); c.complexTriggers[key] = true; assert.equal(classifyChecklist(c), 'complex', key); }
});
test('decision takes precedence and incomplete or ambiguous evidence is complex', () => {
  const c = complete(); c.unapprovedDecision = true; c.complexTriggers.securityBoundary = true; assert.equal(classifyChecklist(c), 'decision');
  assert.equal(classifyChecklist({ unapprovedDecision: true }), 'decision');
  for (const value of [null, {}, { unapprovedDecision: false }, { ...complete(), unexpected: true }, { ...complete(), unapprovedDecision: 'false' }]) assert.equal(classifyChecklist(value), 'complex');
  const missing = complete(); delete missing.simpleConditions.localChange; assert.equal(classifyChecklist(missing), 'complex');
});
test('exact architect class maps centrally and decision never returns an agent route', () => {
  assert.deepEqual(routeTask({ complexity: 'simple' }), { taskClass: 'simple', startAgent: true, model: 'gpt-5.6-luna', reasoning: 'high', automaticRetry: false });
  assert.deepEqual(routeTask({ complexity: 'complex' }), { taskClass: 'complex', startAgent: true, model: 'gpt-6.1-terra', reasoning: 'high', automaticRetry: false });
  assert.deepEqual(routeTask({ complexity: 'decision' }), { taskClass: 'decision', startAgent: false, model: null, reasoning: null, automaticRetry: false });
  for (const value of [null, {}, { complexity: 'Simple' }, { complexity: 'unknown' }]) assert.equal(routeTask(value).taskClass, 'complex');
});
test('failure never switches a tier or starts an automatic retry', () => {
  assert.deepEqual(routeTask({ complexity: 'simple', status: 'failed' }), routeTask({ complexity: 'simple' }));
  for (const complexity of ['simple', 'complex', 'decision']) assert.equal(routeTask({ complexity, status: 'failed' }).automaticRetry, false);
});
