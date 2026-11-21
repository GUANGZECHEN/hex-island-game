/** Stable board-stage sizing, independent of the current document scroll position. */
export function stableBoardFitHeight(viewportHeight:number,stageDocumentTop:number):number {
 if(!Number.isFinite(viewportHeight)||!Number.isFinite(stageDocumentTop)||viewportHeight<=0)throw new Error('Invalid board viewport.');
 return Math.max(180,Math.floor(viewportHeight-stageDocumentTop-18));
}
