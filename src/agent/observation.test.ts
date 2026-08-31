import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { getCheckpointPositionCandidates } from '../core/engine';
import { createInitialState, createUnit } from '../core/state';
import { compactArtifactObservation, createAgentObservation, restoreArtifactObservation } from './observation';
import { createAgentGame } from './game';

describe('Agent Observation 2.0.0 rule projections', () => {
  it('publishes effective range, automatic suppression, recovery, production, and power facts', () => {
    const state = createInitialState(126, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { ...farm.position };
    guard.hp = 30;
    farm.infected = 4;
    farm.operationalStatus = 'infected';
    state.resources.militarySupplyAvailable = false;

    const observation = createAgentObservation(state);
    const publicGuard = observation.units.find((unit) => unit.id === guard.id)!;
    const publicFarm = observation.facilities.find((facility) => facility.id === farm.id)!;
    expect(publicGuard).toMatchObject({
      baseRange: 2,
      effectiveRange: 1,
      rangeModifierReason: 'military_supply_shortage',
      recoveryClassIfTurnEndsNow: 'combat',
      recoveryRateIfTurnEndsNow: 0.1,
      recoveryBaseAmountIfTurnEndsNow: 5,
      suppressionAvailableIfTurnEndsNow: true,
      suppressionTargetId: farm.id,
    });
    expect(publicGuard.suppressionCivilianDamage).toBe(5);
    expect(publicFarm).toMatchObject({
      populationCapacity: 30,
      infectionContained: true,
      containingUnitId: guard.id,
      projectedSuppression: 4,
      projectedCivilianDamage: 5,
    });
    expect(publicFarm.production).toMatchObject({
      inputsPerWorker: {},
      outputsPerWorker: { food: 5 },
      requiresPower: false,
      powerMode: 'boost',
      powerSupplyEnabled: true,
      requiredPowerCapacity: 5,
      stoppedReason: 'infection',
    });
  });

  it('returns deterministic detached JSON without private state', () => {
    const state = createInitialState(127, createDefaultConfig());
    const before = JSON.stringify(state);
    const first = createAgentObservation(state);
    const second = createAgentObservation(state);
    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(first)).not.toContain('rngState');
    first.units[0]!.effectiveRange = 999;
    first.facilities[0]!.production.estimatedPowerGeneration = 999;
    expect(createAgentObservation(state)).toEqual(second);
  });

  it('reports unpowered boost industry at base output instead of stopped', () => {
    const state = createInitialState(128, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const powerPlant = state.facilities.find((facility) => facility.id === 'power-plant-1')!;
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    farm.workers = 12;
    powerPlant.workers = 0;
    wind.operationalStatus = 'disabled';

    const publicFarm = createAgentObservation(state).facilities.find((facility) => facility.id === farm.id)!;
    expect(publicFarm.production).toMatchObject({
      estimatedInputConsumption: {},
      estimatedOutput: { food: 60 },
      estimatedPowerGeneration: 0,
      projectedInputLossIfInfectedOrOverrun: {},
      projectedOutputLossIfInfectedOrOverrun: { food: 60 },
      projectedPowerLossIfInfectedOrOverrun: 0,
      projectedPowerSupplied: false,
      projectedProductionMultiplier: 1,
      stoppedReason: null,
    });
  });

  it('keeps Farm production independent from Fuel while exposing the power-fuel shortage', () => {
    const state = createInitialState(129, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    state.resources.fuel = 0;
    wind.operationalStatus = 'disabled';

    const publicFarm = createAgentObservation(state).facilities.find((facility) => facility.id === farm.id)!;
    expect(publicFarm.production).toMatchObject({
      estimatedInputConsumption: {},
      estimatedOutput: { food: 115 },
      stoppedReason: null,
      projectedPowerSupplied: false,
      projectedPowerReason: 'fuel_shortage',
      projectedInputLossIfInfectedOrOverrun: {},
      projectedOutputLossIfInfectedOrOverrun: { food: 115 },
    });
  });

  it('leaves the stop reason empty for a fully operating facility', () => {
    const state = createInitialState(130, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const capital = state.facilities.find((facility) => facility.id === 'capital')!;
    const publicCapital = createAgentObservation(state).facilities.find((facility) => facility.id === capital.id)!;

    expect(publicCapital.production.estimatedOutput.civilianGoods).toBe(41);
    expect(publicCapital.production.stoppedReason).toBeNull();
  });

  it('publishes the fixed terrain contract and filters enemies by current visibility', () => {
    const state = createInitialState(131, createDefaultConfig({
      checkpoint: { initialSupplyRadius: 1 },
      units: {
        police: { vision: 1 },
        nationalGuard: { vision: 1 },
      },
    }));
    state.units.find((unit) => unit.id === 'zombie-1')!.position = { q: 7, r: 6 };
    const observation = createAgentObservation(state);
    const hiddenEnemyIds = state.units
      .filter((unit) => !unit.isPlayerUnit)
      .map((unit) => unit.id)
      .filter((id) => !observation.zombies.some((unit) => unit.id === id));

    expect(observation.finalHordeTurn).toBe(30);
    expect(observation.map.tiles).toHaveLength(961);
    expect(observation.map.tiles.filter((tile) => tile.terrain === 'forest')).toHaveLength(197);
    expect(observation.map.tiles.filter((tile) => tile.terrain === 'mountain')).toHaveLength(44);
    expect(observation.map.tiles.filter((tile) => tile.terrain === 'water')).toHaveLength(0);
    expect(observation.map.tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        q: 2,
        r: 1,
        terrain: 'forest',
        road: false,
        effectiveMovementCost: 2,
        terrainDefenseSource: 'forest',
        terrainDamageMultiplier: 0.5,
      }),
    ]));
    expect(observation.map.tiles.every((tile) =>
      typeof tile.visibleToPlayer === 'boolean' &&
      typeof tile.urban === 'boolean' &&
      (tile.effectiveMovementCost === null || tile.effectiveMovementCost >= 1),
    )).toBe(true);
    expect(observation.units.every((unit) =>
      unit.unitType === unit.type &&
      unit.vision > 0 &&
      typeof unit.positionTerrain === 'string' &&
      (unit.effectiveMovementCostAtPosition === null || unit.effectiveMovementCostAtPosition >= 1),
    )).toBe(true);
    expect(observation.zombies.every((unit) => unit.type === 'zombie' || unit.type === 'hordeZombie')).toBe(true);
    expect(hiddenEnemyIds.length).toBeGreaterThan(0);
    expect(observation.zombies.map((unit) => unit.id)).not.toEqual(expect.arrayContaining(hiddenEnemyIds));
    expect(observation.horde).toMatchObject({
      warningType: 'periodic',
      warningDirection: observation.horde.direction,
      spawnTurn: 5,
      finalHordeStatus: 'notStarted',
    });
    expect(observation.victory).toEqual({
      finalHordeDefeated: observation.finalHordeDefeated,
      suppliedAreaZombieClear: observation.suppliedAreaZombieClear,
      suppliedAreaInfectionClear: observation.suppliedAreaInfectionClear,
    });
    expect(JSON.stringify(observation)).not.toContain('inheritedTarget');
    expect(JSON.stringify(observation)).not.toContain('noiseTarget');
    expect(JSON.stringify(observation)).not.toContain('spawnGroupId');
  });

  it('publishes the detached Core checkpoint candidates without leaking hidden blockers', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
    });
    const clearState = createInitialState(132, config);
    const clearCandidates = createAgentObservation(clearState).checkpointPositionCandidates;
    expect(clearCandidates).toEqual(getCheckpointPositionCandidates(clearState));
    expect(clearCandidates).toHaveLength(60);

    const hiddenState = createInitialState(132, config);
    hiddenState.units.push(createUnit(hiddenState, 'zombie-secret-blocker', 'zombie', { q: 7, r: 1 }));
    const hiddenObservation = createAgentObservation(hiddenState);
    expect(hiddenObservation.checkpointPositionCandidates).toEqual(clearCandidates);
    expect(JSON.stringify(hiddenObservation)).not.toContain('zombie-secret-blocker');

    expect(JSON.stringify(hiddenObservation.constructibleFacilityPositionCandidates)).not.toContain('zombie-secret-blocker');
  });

  it('projects Fuel, special Facility state, Queue Pressure, and the Core strategic forecast', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 140, configOverrides: { economy: { initialZombieCount: 0 } } });
    const police = observation.units.find((unit) => unit.type === 'police')!;
    expect(police).toMatchObject({ currentFuel: 12, maxFuel: 12, inSupply: true });
    expect(police.fuelCostByLegalMove.length).toBeGreaterThan(0);
    expect(police.fuelCostByLegalMove.every((move) => move.fuelCost >= 1 && move.projectedFuelAfterMove >= 0)).toBe(true);
    const wind = observation.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    expect(wind).toMatchObject({ healthyPopulation: 0, zombieTargetValue: 5, constructible: false });
    expect(observation.strategicForecast.resources.fuel).toHaveProperty('singlePointOfFailure');
    expect(observation.constructibleFacilityPositionCandidates).toHaveLength(31 * 31 * 2);
    expect(observation.roadBranches.every((branch) => branch.currentPolicyTurns === 2)).toBe(true);
    expect(observation.checkpoints.every((checkpoint) => checkpoint.queuePressureClass === 'none' || checkpoint.queuePeople > 0)).toBe(true);
  });

  it('stores map topology once and restores complete Artifact observations', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 141 });
    const trace = compactArtifactObservation(observation);
    expect(trace).not.toHaveProperty('map');
    expect(trace.mapId).toBe(observation.map.id);
    expect(restoreArtifactObservation(trace, observation.map)).toEqual(observation);

    const constructible = game.getLegalActions().find((action) => action.type === 'BuildConstructibleFacility')!;
    const afterBuild = game.step(constructible).observation;
    expect(restoreArtifactObservation(compactArtifactObservation(afterBuild), observation.map)).toEqual(afterBuild);
  });
});
