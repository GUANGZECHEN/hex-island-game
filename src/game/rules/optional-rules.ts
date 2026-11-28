/** Host-selected, public, match-scoped optional Classic rules. Old saves default to both off. */
export interface OptionalRules {
  catchUp: boolean;
  ships: boolean;
}
export const DEFAULT_OPTIONAL_RULES: Readonly<OptionalRules> = Object.freeze({catchUp:false,ships:false});

export function validateOptionalRules(raw: unknown): OptionalRules {
  if(raw===undefined || raw===null)return {...DEFAULT_OPTIONAL_RULES};
  if(typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid optional rules.');
  const item=raw as Record<string,unknown>;
  if(Object.keys(item).some(key=>key!=='catchUp'&&key!=='ships')||
     (item.catchUp!==undefined&&typeof item.catchUp!=='boolean')||
     (item.ships!==undefined&&typeof item.ships!=='boolean'))throw new Error('Invalid optional rules.');
  return {catchUp:item.catchUp===true,ships:item.ships===true};
}
