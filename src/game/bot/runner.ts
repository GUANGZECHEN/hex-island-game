import { applySetupCommand, type GameState } from '../rules/state.ts';
import { applyTurnCommand } from '../rules/turn.ts';
import { applyBuildCommand } from '../rules/build.ts';
import { applyEconomyCommand } from '../rules/economy.ts';
import type { BotCommand } from './policy.ts';

const setup=new Set(['place-settlement','place-road']);
const turn=new Set(['roll','discard','move-robber','steal','end-turn']);
const build=new Set(['build-road','build-settlement','build-city']);

/** Apply a local bot command through the same reducers used by human actions. */
export function applyBotCommand(state:GameState,command:BotCommand):GameState {
 if(setup.has(command.type))return applySetupCommand(state,command as Parameters<typeof applySetupCommand>[1]);
 if(turn.has(command.type))return applyTurnCommand(state,command as Parameters<typeof applyTurnCommand>[1]);
 if(build.has(command.type))return applyBuildCommand(state,command as Parameters<typeof applyBuildCommand>[1]);
 return applyEconomyCommand(state,command as Parameters<typeof applyEconomyCommand>[1]);
}
