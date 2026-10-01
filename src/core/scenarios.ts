import { createDefaultConfig } from './config';
import type { DeepPartial, GameConfig } from './types';

export const SCENARIOS = [
  { id: 'una', name: 'UNA(United states of Northern Ameligo)', available: true },
  { id: 'prh', name: 'PRH(People Republic Huajing)', available: false },
  { id: 'ac', name: 'AC(Arembic Coalition)', available: false },
] as const;
export type ScenarioId = 'una' | 'custom';

/** All entry points resolve a preset here before creating or replacing a game. */
export function resolveScenario(input: { scenarioId?: string; seed?: number; configOverrides?: DeepPartial<GameConfig> }) {
  const seed = input.seed ?? 1;
  if (!Number.isSafeInteger(seed)) throw new Error('invalid_seed: seed must be a safe integer');
  const scenarioId = input.scenarioId ?? 'custom';
  if (scenarioId !== 'una' && scenarioId !== 'custom') throw new Error(`scenario_unavailable: ${scenarioId}`);
  if (scenarioId === 'una' && input.configOverrides !== undefined) throw new Error('scenario_config_override_forbidden: UNA accepts only seed');
  if (input.configOverrides?.scenarioId !== undefined && input.configOverrides.scenarioId !== 'custom') throw new Error('scenario_config_override_forbidden: use the scenarioId start argument');
  return { seed, config: createDefaultConfig({ ...input.configOverrides, scenarioId }) };
}
