import { validateFixedMap, initialArmyBaseMatchesSeed, initialAirBaseMatchesSeed, generateInitialZombiePositions, generateInitialHunterPositions, generateInitialGasPositions } from './map';
import { mapContentHash, validateRandomMap, validateMapDescriptor, mapDomainSeed, MAP_GENERATION_LIMITS } from './map-generation';
import { SeededRng } from './rng';
import type { GameState } from './types';

const recent=new Map<string,{valid:boolean;errors:string[]}>();
export function validateInitialMap(state: GameState): { valid: boolean; errors: string[] } {
  const key=mapContentHash({map:state.map,descriptor:state.mapDescriptor,seed:state.seed,config:state.config,attempt:state.initialEnemyAttempt,hunters:state.initialHunterPositions,gas:state.initialGasPositions});
  const hit=recent.get(key);if(hit)return structuredClone(hit);
  const fixed=state.config.mapMode==='fixed';
  const errors=(fixed?validateFixedMap(state.map):validateRandomMap(state.map,state.config)).errors;
  errors.push(...validateMapDescriptor(state));
  const mapped={...state,seed:state.config.mapSeed??state.seed};
  if(fixed && (!initialArmyBaseMatchesSeed(mapped)||!initialAirBaseMatchesSeed(mapped))) errors.push('seeded_base_placement');
  if(!Number.isInteger(state.initialEnemyAttempt)||state.initialEnemyAttempt<0||state.initialEnemyAttempt>=MAP_GENERATION_LIMITS.enemyAttempts||(fixed&&state.initialEnemyAttempt!==0))errors.push('initial_enemy_attempt');
  try {
    const seed=state.config.gameplaySeed??state.seed;
    const rng=new SeededRng(fixed?seed:mapDomainSeed(seed,state.initialEnemyAttempt?'gameplay/init-enemies':'gameplay/init',state.initialEnemyAttempt));
    if(fixed){rng.nextInt(0,3);rng.nextInt(0,3);}
    const map={...state.map,initialZombiePositions:generateInitialZombiePositions(state.map,rng,fixed?undefined:state.config.economy.initialZombieCount,state.config.units.zombie.vision)};
    const hunters=generateInitialHunterPositions(map,rng,state.config.economy,state.config.units.hunterZombie.vision);
    const gas=generateInitialGasPositions(map,rng,hunters,state.config.economy,state.config.units.gasZombie.vision);
    if(JSON.stringify(map.initialZombiePositions)!==JSON.stringify(state.map.initialZombiePositions)||JSON.stringify(hunters)!==JSON.stringify(state.initialHunterPositions)||JSON.stringify(gas)!==JSON.stringify(state.initialGasPositions))errors.push('seeded_enemy_placement');
  }catch{errors.push('seeded_enemy_placement');}
  const result={valid:errors.length===0,errors};recent.set(key,structuredClone(result));if(recent.size>8)recent.delete(recent.keys().next().value!);return result;
}
