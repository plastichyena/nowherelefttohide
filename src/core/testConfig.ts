import type { HordeComposition, HordeConfig } from './types';

/** Compact valid v1.4.4 schedule for focused Core tests. */
export function singleFinalWave(
  turn: number,
  composition: HordeComposition = { hordeZombie: 1, zombie: 0 },
  directionCount: 1 | 2 | 3 | 4 = 1,
): HordeConfig {
  return {
    warningLeadTurns: 1,
    waves: [{ turn, directionCount, compositionPerDirection: { ...composition }, final: true }],
  };
}
