import { createCityPopulationSnapshot, populationLedgerTotal, synchronizePopulation } from './state';
import type { GameState, HordeComposition, HordeConfig } from './types';

/** Rebuild derived population fields after a focused test mutates a scenario. */
export function prepareTestSnapshot(state: GameState, preserveNeutralSurvivors = false): void {
  if (!preserveNeutralSurvivors) {
    for (const facility of state.facilities) {
      if (facility.owner === 'none' && facility.earlyCaptureSurvivorStatus === 'available') {
        facility.workers = 0;
        facility.earlyCaptureSurvivorStatus = 'lost';
        if (facility.armyBase) facility.armyBase.interceptionsRemaining = 0;
      }
    }
  }
  for (const checkpoint of state.checkpoints) {
    checkpoint.grandfatheredWaiting ??= 0;
    checkpoint.grandfatheredPolicy ??= null;
    checkpoint.waitingRiskPercent ??= 0;
  }
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state)
    - state.population.cumulativeArrivals
    + state.population.cumulativeDepartures
    - state.population.cumulativeReinforcements;
  createCityPopulationSnapshot(state);
}

/** Compact valid v1.5 schedule for focused Core tests. */
export function singleFinalWave(
  turn: number,
  composition: HordeComposition = { hordeZombie: 1, zombie: 0 },
  directionCount: 1 | 2 | 3 | 4 = 1,
): HordeConfig {
  return {
    warningLeadTurns: 1,
    waves: [{ turn, directionCount, compositionPerDirection: { ...composition }, final: true }],
    specialZombieWeights: { zombie: 100, policeZombie: 0, soldierZombie: 0, riotZombie: 0, hunterZombie: 0, gasZombie: 0 },
    riotZombieCapPerDirection: 1,
    gasZombieCapPerDirection: 1,
    hunterZombieCapPerDirection: 1,
    movementNoiseRadius: 8,
  };
}
