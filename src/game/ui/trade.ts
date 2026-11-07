import { RESOURCES, type Resource, type TradeOffer } from '../rules/state.ts';

export interface TradeAmount { resource: Resource; count: number }
export interface IncomingTradeView {
  proposer: string;
  receive: TradeAmount[];
  give: TradeAmount[];
}

/** Translate an offer into the recipient's point of view. */
export function incomingTradeView(offer:TradeOffer|null,viewer:string):IncomingTradeView|null {
  if(!offer || offer.proposer===viewer || !offer.targets.includes(viewer))return null;
  const entries=(hand:TradeOffer['give'])=>RESOURCES.filter(resource=>hand[resource]>0).map(resource=>({resource,count:hand[resource]}));
  return {proposer:offer.proposer,receive:entries(offer.give),give:entries(offer.receive)};
}
