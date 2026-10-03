import { FIXED_MAP_ID } from './map';
import { RANDOM_MAP_ID } from './versions';
import { createDefaultConfig } from './config';
import type { DeepPartial, GameConfig } from './types';

export const SCENARIOS = [
  { id: 'una', name: 'UNA(United states of Northern Ameligo)', available: true },
  { id: 'prh', name: 'PRH(People Republic Huajing)', available: false },
  { id: 'ac', name: 'AC(Arembic Coalition)', available: false },
] as const;
export type ScenarioId = 'una' | 'custom';

/** All entry points resolve a preset here before creating or replacing a game. */
export interface StartOptions { scenarioId?: string; seed?: number; mapMode?: import('./map-generation').MapMode; mapSeed?: number; gameplaySeed?: number; configOverrides?: DeepPartial<GameConfig> }
export function resolveScenario(input: StartOptions) {
  const seed = input.seed ?? 1;
  if (!Number.isSafeInteger(seed)) throw new Error('invalid_seed: seed must be a safe integer');
  const scenarioId = input.scenarioId ?? 'custom';
  if (scenarioId !== 'una' && scenarioId !== 'custom') throw new Error(`scenario_unavailable: ${scenarioId}`);
  if (scenarioId === 'una' && input.configOverrides !== undefined) throw new Error('scenario_config_override_forbidden: UNA accepts seed, mapMode, mapSeed and gameplaySeed');
  if (input.configOverrides?.scenarioId !== undefined && input.configOverrides.scenarioId !== 'custom') throw new Error('scenario_config_override_forbidden: use the scenarioId start argument');
  const mapMode = input.mapMode ?? input.configOverrides?.mapMode ?? 'random';
  if (!['random', 'fixed'].includes(mapMode)) throw new Error('invalid_map_mode: use random or fixed');
  for (const key of ['mapSeed','gameplaySeed'] as const) if (input[key] !== undefined && !Number.isSafeInteger(input[key])) throw new Error(`invalid_seed: ${key} must be a safe integer`);
  return { seed, config: createDefaultConfig({ ...input.configOverrides, scenarioId, mapMode, ...(input.mapMode===undefined?{}:{mapId:mapMode==='fixed'?FIXED_MAP_ID:RANDOM_MAP_ID}),
    ...(input.mapSeed === undefined ? {} : {mapSeed:input.mapSeed}), ...(input.gameplaySeed === undefined ? {} : {gameplaySeed:input.gameplaySeed}) }) };
}
