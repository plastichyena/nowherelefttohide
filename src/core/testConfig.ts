import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
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
    specialZombieWeights: { zombie: 100, policeZombie: 0, soldierZombie: 0, riotZombie: 0, hunterZombie: 0, gasZombie: 0, screamerZombie: 0 },
    riotZombieCapPerDirection: 1,
    hunterZombieCapPerDirection: 1,
    movementNoiseRadius: 8,
  };
}

/** Focused regression stage: two actors, six owned sites, 100 civilians and unmanaged roads. Default deployment
 * is tested separately; this keeps combat/placement scenarios independent of it.
 * All actions still execute through the real current GameEngine. */
export class TwoUnitScenarioEngine extends GameEngine {
  constructor(seed: number, config = createDefaultConfig()) {
    super(seed, config);
    const state = this.getState() as GameState;
    state.units = state.units.filter(unit => !unit.isPlayerUnit || ['police-1', 'national-guard-1'].includes(unit.id));
    state.facilities.find(facility => facility.id === 'capital')!.workers = 41;
    for (const id of ['city-1', 'military-factory-1']) {
      const facility = state.facilities.find(candidate => candidate.id === id)!;
      facility.owner = 'none'; facility.status = 'unowned';
      facility.securedOrder = null; facility.populationOperationalTurn = Number.MAX_SAFE_INTEGER;
      facility.firstCaptureRewardClaimed = false;
      facility.earlyCaptureSurvivorStatus = facility.workers > 0 ? 'available' : 'lost';
    }
    clearScenarioCheckpoints(state);
    state.nextUnitNumber = 2;
    prepareTestSnapshot(state, true);
    const result = this.step({ type: 'LoadSnapshot', snapshot: state });
    if (result.error) throw new Error(result.error.message);
  }
}

/** Explicitly stage an unmanaged-road scenario, including branch references. */
export function clearScenarioCheckpoints(state: GameState): void {
  state.checkpoints = [];
  state.nextCheckpointNumber = 1;
  for (const branch of state.roadBranches) {
    branch.activeCheckpointId = null;
    branch.standbyCheckpointIds = [];
    branch.hasBuiltCheckpoint = false;
  }
}
