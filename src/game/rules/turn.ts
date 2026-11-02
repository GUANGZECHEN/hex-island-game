import { createIslandBoard } from '../board/geometry.ts';
import { drawIndex, secureIndex, RESOURCES, type GameState, type Hand } from './state.ts';

export type TurnCommand =
  | { type: 'roll'; playerId: string }
  | { type: 'discard'; playerId: string; cards: Hand }
  | { type: 'move-robber'; playerId: string; hexId: string }
  | { type: 'steal'; playerId: string; victimId: string }
  | { type: 'end-turn'; playerId: string };
const size = (hand: Hand) => RESOURCES.reduce((sum, resource) => sum + hand[resource], 0);

/** Resolve production by resource, including the single-recipient shortage exception. */
export function produce(state: GameState, total: number): void {
  const geometry = createIslandBoard();
  for (const resource of RESOURCES) {
    const owes = new Map<string, number>();
    for (const hex of geometry.hexes) {
      const setup = state.board.hexes.find(item => item.hexId === hex.id)!;
      if (setup.resource !== resource || setup.token !== total || state.board.robberHexId === hex.id) continue;
      for (const vertex of hex.vertexIds) {
        const building = state.buildings[vertex];
        if (building) owes.set(building.playerId, (owes.get(building.playerId) ?? 0) + (building.kind === 'city' ? 2 : 1));
      }
    }
    const totalOwed = [...owes.values()].reduce((a, b) => a + b, 0);
    if (owes.size > 1 && totalOwed > state.bank[resource]) continue;
    for (const [id, amount] of owes) {
      const player = state.players.find(p => p.id === id)!;
      const quantity = Math.min(amount, state.bank[resource]);
      state.bank[resource] -= quantity; player.hand[resource] += quantity;
    }
  }
}
export function applyTurnCommand(original: GameState, command: TurnCommand, secureRandom?: () => number): GameState {
  const state = structuredClone(original), active = state.players[state.currentSeat];
  if (!command || (!state.discards[command.playerId] && active.id !== command.playerId)) throw new Error('Not an authorized player.');
  if (command.type === 'roll' && state.phase === 'roll' && active.id === command.playerId) {
    const first = secureRandom ? secureIndex(secureRandom, 6) : drawIndex(state.randomState, 6), second = secureRandom ? secureIndex(secureRandom, 6) : drawIndex(first.state!, 6);
    state.randomState = second.state ?? state.randomState; state.dice = [first.index + 1, second.index + 1];
    if (state.dice[0] + state.dice[1] === 7) {
      state.discards = Object.fromEntries(state.players.filter(player => size(player.hand) > 7).map(player => [player.id, Math.floor(size(player.hand) / 2)]));
      state.phase = Object.keys(state.discards).length ? 'discard' : 'robber';
    } else { produce(state, state.dice[0] + state.dice[1]); state.phase = 'action'; }
  } else if (command.type === 'discard' && state.phase === 'discard') {
    const required = state.discards[command.playerId], player = state.players.find(p => p.id === command.playerId);
    if (!required || !player || !command.cards || Object.keys(command.cards).sort().join(',') !== [...RESOURCES].sort().join(',') || RESOURCES.some(r => !Number.isInteger(command.cards[r]) || command.cards[r] < 0 || command.cards[r] > player.hand[r]) || size(command.cards) !== required) throw new Error('Invalid discard.');
    for (const r of RESOURCES) { player.hand[r] -= command.cards[r]; state.bank[r] += command.cards[r]; }
    delete state.discards[player.id]; if (!Object.keys(state.discards).length) state.phase = 'robber';
  } else if (command.type === 'move-robber' && state.phase === 'robber' && active.id === command.playerId) {
    const hex = createIslandBoard().hexes.find(hex => hex.id === command.hexId);
    if (!hex || hex.id === state.board.robberHexId) throw new Error('Robber must move to a different hex.');
    state.board = { ...state.board, robberHexId: hex.id };
    state.victims = [...new Set(hex.vertexIds.map(id => state.buildings[id]?.playerId).filter((id): id is string => !!id && id !== active.id && size(state.players.find(p => p.id === id)!.hand) > 0))];
    state.phase = state.victims.length ? 'steal' : state.resumePhase ?? 'action'; if (!state.victims.length) state.resumePhase = null;
  } else if (command.type === 'steal' && state.phase === 'steal' && active.id === command.playerId) {
    if (!state.victims.includes(command.victimId)) throw new Error('Invalid victim.');
    const victim = state.players.find(player => player.id === command.victimId)!;
    const draw = secureRandom ? secureIndex(secureRandom, size(victim.hand)) : drawIndex(state.randomState, size(victim.hand)); state.randomState = draw.state ?? state.randomState;
    let index = draw.index;
    for (const resource of RESOURCES) { if (index < victim.hand[resource]) { victim.hand[resource]--; active.hand[resource]++; break; } index -= victim.hand[resource]; }
    state.victims = []; state.phase = state.resumePhase ?? 'action'; state.resumePhase = null;
  } else if (command.type === 'end-turn' && state.phase === 'action' && active.id === command.playerId) {
    state.currentSeat = (state.currentSeat + 1) % state.players.length; state.turn++; state.dice = null; state.playedDevelopment = false; state.offer = null; state.phase = 'roll';
  } else throw new Error('Command is not allowed in this phase.');
  return state;
}
