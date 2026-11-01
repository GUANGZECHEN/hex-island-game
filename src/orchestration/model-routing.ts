/** Policy only: no agent execution, retry, or model discovery occurs here. */
export type TaskClass = 'simple' | 'complex' | 'decision';
export type CodingRoute = Readonly<{ taskClass: 'simple' | 'complex'; startAgent: true; model: string; reasoning: 'high'; automaticRetry: false }>;
export type DecisionRoute = Readonly<{ taskClass: 'decision'; startAgent: false; model: null; reasoning: null; automaticRetry: false }>;
export type Route = CodingRoute | DecisionRoute;

const routes: Readonly<Record<TaskClass, Route>> = Object.freeze({
  simple: Object.freeze({ taskClass: 'simple', startAgent: true, model: 'gpt-5.6-luna', reasoning: 'high', automaticRetry: false }),
  complex: Object.freeze({ taskClass: 'complex', startAgent: true, model: 'gpt-6.1-terra', reasoning: 'high', automaticRetry: false }),
  decision: Object.freeze({ taskClass: 'decision', startAgent: false, model: null, reasoning: null, automaticRetry: false }),
});

/** Consume the Architect's explicit abstract classification; do not infer or upgrade it. */
export function routeTask(metadata: unknown): Route {
  const value = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).complexity : undefined;
  return value === 'simple' || value === 'complex' || value === 'decision' ? routes[value] : routes.complex;
}

export const simpleConditions = Object.freeze(['fullySpecified', 'localChange', 'noNewBoundary', 'noConsistencyProblem', 'lowBlastRadius', 'explicitAcceptance'] as const);
export const complexTriggers = Object.freeze(['multipleCoreModules', 'networkedState', 'securityBoundary', 'concurrencyOrTiming', 'coreDataOrProtocol', 'newSubsystem', 'unknownRootCause', 'largeContext'] as const);

/** Optional deterministic checklist for the Architect, using explicit boolean assessments. */
export function classifyChecklist(input: unknown): TaskClass {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'complex';
  const value = input as Record<string, unknown>;
  if (value.unapprovedDecision === true) return 'decision';
  const triggers = value.complexTriggers;
  const conditions = value.simpleConditions;
  if (!triggers || typeof triggers !== 'object' || Array.isArray(triggers)) return 'complex';
  const triggerValues = triggers as Record<string, unknown>;
  if (complexTriggers.some(key => triggerValues[key] === true)) return 'complex';
  if (value.unapprovedDecision !== false || !conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return 'complex';
  const conditionValues = conditions as Record<string, unknown>;
  if (Object.keys(value).some(key => !['unapprovedDecision', 'complexTriggers', 'simpleConditions'].includes(key)) ||
      Object.keys(triggerValues).some(key => !complexTriggers.includes(key as typeof complexTriggers[number])) ||
      Object.keys(conditionValues).some(key => !simpleConditions.includes(key as typeof simpleConditions[number]))) return 'complex';
  return complexTriggers.every(key => triggerValues[key] === false) && simpleConditions.every(key => conditionValues[key] === true) ? 'simple' : 'complex';
}
