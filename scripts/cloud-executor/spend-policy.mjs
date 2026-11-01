/** Product Owner-approved per-session Agents API limits, in USD cents. */
export const APPROVED_SESSION_LIMITS_CENTS = Object.freeze({ simple: 50, complex: 200 });

/** No default configuration: missing, malformed, altered or unrecognized values fail closed. */
export function requireSessionLimit(taskClass, config) {
 if (!config || typeof config !== 'object' || Array.isArray(config) ||
     Object.keys(config).sort().join(',') !== 'complex,simple' ||
     config.simple !== APPROVED_SESSION_LIMITS_CENTS.simple ||
     config.complex !== APPROVED_SESSION_LIMITS_CENTS.complex ||
     !Object.hasOwn(config, taskClass) || (taskClass !== 'simple' && taskClass !== 'complex')) {
  throw Error('Invalid or unapproved session spend limit');
 }
 const limit = config[taskClass];
 if (!Number.isSafeInteger(limit) || limit <= 0) throw Error('Invalid session spend limit');
 return limit;
}
