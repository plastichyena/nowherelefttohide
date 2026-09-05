import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { getCheckpointPositionCandidates } from '../core/engine';
import { createInitialState, createUnit } from '../core/state';
import { compactArtifactObservation, createAgentObservation, restoreArtifactObservation } from './observation';
import { createAgentGame } from './game';

describe('Agent Observation 8.0.0 rule projections', () => {
  it('publishes effective range, automatic suppression, recovery, production, and power facts', () => {
    const state = createInitialState(126, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { ...farm.position };
    guard.hp = 30;
    farm.infected = 4;
    farm.operationalStatus = 'infected';
    guard.currentMilitaryGoods = 1;
    state.resources.militaryGoods = 1;

    const observation = createAgentObservation(state);
    const publicGuard = observation.units.find((unit) => unit.id === guard.id)!;
    const publicFarm = observation.facilities.find((facility) => facility.id === farm.id)!;
    expect(publicGuard).toMatchObject({
      baseRange: 2,
      effectiveRange: 1,
      rangeModifierReason: 'carried_military_goods_shortage',
      currentMilitaryGoods: 1,
      maxMilitaryGoods: 20,
      recoveryClassIfTurnEndsNow: 'combat',
      recoveryRateIfTurnEndsNow: 0.1,
      recoveryBaseAmountIfTurnEndsNow: 5,
      suppressionAvailableIfTurnEndsNow: true,
      suppressionStatusIfTurnEndsNow: 'suppression',
      suppressionTargetId: farm.id,
    });
    expect(publicGuard.suppressionCivilianDamage).toBe(8);
    expect(publicFarm).toMatchObject({
      populationCapacity: 30,
      infectionContained: true,
      containingUnitId: guard.id,
      projectedSuppression: 4,
      projectedCivilianDamage: 8,
    });
    expect(publicFarm.production).toMatchObject({
      inputsPerWorker: {},
      outputsPerWorker: { food: 10 },
      requiresPower: true,
      powerMode: 'required',
      powerSupplyEnabled: true,
      requiredPowerCapacity: 5,
      stoppedReason: 'infection',
    });
  });

  it('publishes carried Military Goods and exact legal Attack previews by distance', () => {
    const state = createInitialState(142, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.currentMilitaryGoods = 2;
    state.units.push(createUnit(state, 'zombie-range-2', 'zombie', {
      q: guard.position.q + 2,
      r: guard.position.r,
    }));

    const publicGuard = createAgentObservation(state).units.find((unit) => unit.id === guard.id)!;
    expect(publicGuard).toMatchObject({
      currentMilitaryGoods: 2,
      maxMilitaryGoods: 20,
      fixedMilitaryGoodsUpkeepPerTurn: 1,
      attackMilitaryGoodsCostByRange: { 1: 1, 2: 2 },
      suppressionMilitaryGoodsCost: 1,
    });
    expect(publicGuard.attackPreviews).toEqual([
      expect.objectContaining({
        targetUnitId: 'zombie-range-2',
        distance: 2,
        militaryGoodsCost: 2,
        projectedMilitaryGoodsAfterAttack: 0,
        effectiveAttack: 15,
      }),
    ]);
    expect(publicGuard.attackPreviews[0]!.projectedDamageBeforeTerrain).toBe(15);
    expect(publicGuard.attackPreviews[0]!.projectedDamageAfterTerrain).toBeGreaterThan(0);

    guard.currentMilitaryGoods = 1;
    const shortGuard = createAgentObservation(state).units.find((unit) => unit.id === guard.id)!;
    expect(shortGuard).toMatchObject({
      effectiveRange: 1,
      rangeModifierReason: 'carried_military_goods_shortage',
      attackPreviews: [],
    });
  });

  it('publishes fixed consumption, refill, and post-refill suppression Military Goods projections', () => {
    const state = createInitialState(143, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    const police = state.units.find((unit) => unit.type === 'police')!;
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    guard.position = { q: 0, r: 0 };
    guard.currentMilitaryGoods = guard.maxMilitaryGoods;
    police.position = { ...farm.position };
    police.currentMilitaryGoods = 0;
    farm.infected = 2;
    state.resources.militaryGoods = 1;

    const observation = createAgentObservation(state);
    const publicGuard = observation.units.find((unit) => unit.id === guard.id)!;
    const publicPolice = observation.units.find((unit) => unit.id === police.id)!;
    expect(publicGuard).toMatchObject({
      projectedMilitaryGoodsAfterFixedConsumption: 19,
      projectedMilitaryGoodsAfterRefill: 19,
      projectedMilitaryGoodsAfterSuppression: 19,
      suppressionStatusIfTurnEndsNow: 'none',
    });
    expect(publicPolice).toMatchObject({
      projectedMilitaryGoodsAfterFixedConsumption: 0,
      projectedMilitaryGoodsAfterRefill: 1,
      projectedMilitaryGoodsAfterSuppression: 0,
      suppressionAvailableIfTurnEndsNow: true,
      suppressionStatusIfTurnEndsNow: 'suppression',
    });
    expect(observation.endTurnForecast.militaryGoods).toMatchObject({
      startingStock: 1,
      projectedTotalRefilled: 1,
      totalUnfilledRefillDemand: 5,
      projectedEndingStock: 0,
    });
    expect(observation.endTurnForecast.militaryGoods.units.find((unit) => unit.unitId === police.id)).toMatchObject({
      refillDemand: 5,
      projectedRefillAmount: 1,
      unfilledRefillDemand: 4,
      afterRefill: 1,
      suppressionStatus: 'suppression',
      afterSuppression: 0,
    });
  });

  it('publishes Fuel-zero Emergency Move mode and effective-MP limits', () => {
    const state = createInitialState(144, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    const guard = state.units.find((unit) => unit.id === 'national-guard-1')!;
    police.currentFuel = 0;
    guard.currentFuel = 0;

    const observation = createAgentObservation(state);
    const publicPolice = observation.units.find((unit) => unit.id === police.id)!;
    const publicGuard = observation.units.find((unit) => unit.id === guard.id)!;
    expect(publicPolice).toMatchObject({
      emergencyMovementPoints: 3,
      emergencyMovementAvailable: true,
      currentFuel: 0,
    });
    expect(publicPolice.fuelCostByLegalMove).toContainEqual(expect.objectContaining({
      movementMode: 'emergency',
      effectiveMovementCost: 3,
      fuelCost: 0,
      projectedFuelAfterMove: 0,
    }));
    expect(publicPolice.fuelCostByLegalMove.every((move) =>
      move.movementMode === 'emergency' && move.effectiveMovementCost <= publicPolice.emergencyMovementPoints,
    )).toBe(true);
    expect(publicGuard).toMatchObject({ emergencyMovementPoints: 2, emergencyMovementAvailable: true });
    expect(publicGuard.fuelCostByLegalMove).toContainEqual(expect.objectContaining({
      movementMode: 'emergency',
      effectiveMovementCost: 2,
      fuelCost: 0,
    }));
    expect(publicGuard.fuelCostByLegalMove.every((move) => move.effectiveMovementCost <= 2)).toBe(true);
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

  it('reports unpowered required industry as stopped with zero projected output', () => {
    const state = createInitialState(128, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const powerPlant = state.facilities.find((facility) => facility.id === 'power-plant-1')!;
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    farm.workers = 12;
    powerPlant.workers = 0;
    wind.operationalStatus = 'disabled';

    const publicFarm = createAgentObservation(state).facilities.find((facility) => facility.id === farm.id)!;
    expect(publicFarm.production).toMatchObject({
      estimatedInputConsumption: {},
      estimatedOutput: {},
      estimatedPowerGeneration: 0,
      projectedInputLossIfInfectedOrOverrun: {},
      projectedOutputLossIfInfectedOrOverrun: {},
      projectedPowerLossIfInfectedOrOverrun: 0,
      projectedPowerSupplied: false,
      projectedPowerReason: expect.any(String),
      projectedProductionMultiplier: 1,
      stoppedReason: 'power_unavailable',
    });
  });

  it('stops Farm production when Fuel-limited power is unavailable', () => {
    const state = createInitialState(129, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    state.resources.fuel = 0;
    wind.operationalStatus = 'disabled';

    const publicFarm = createAgentObservation(state).facilities.find((facility) => facility.id === farm.id)!;
    expect(publicFarm.production).toMatchObject({
      estimatedInputConsumption: {},
      estimatedOutput: {},
      stoppedReason: 'power_unavailable',
      projectedPowerSupplied: false,
      projectedPowerReason: 'fuel_shortage',
      projectedInputLossIfInfectedOrOverrun: {},
      projectedOutputLossIfInfectedOrOverrun: {},
    });
  });

  it('leaves the stop reason empty for a fully operating facility', () => {
    const state = createInitialState(130, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
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

    expect(observation.finalHordeTurn).toBe(50);
    expect(observation.map.tiles).toHaveLength(2601);
    expect(observation.map.tiles.filter((tile) => tile.terrain === 'forest')).toHaveLength(514);
    expect(observation.map.tiles.filter((tile) => tile.terrain === 'mountain')).toHaveLength(126);
    expect(observation.map.tiles.filter((tile) => tile.terrain === 'water')).toHaveLength(0);
    expect(observation.map.tiles.find((tile) => tile.terrain === 'forest')).toMatchObject({
      road: false,
      effectiveMovementCost: 2,
      terrainDefenseSource: 'forest',
      terrainDamageMultiplier: 0.5,
    });
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
    expect(observation.zombies.every((unit) =>
      ['zombie', 'hordeZombie', 'policeZombie', 'soldierZombie'].includes(unit.type),
    )).toBe(true);
    expect(hiddenEnemyIds.length).toBeGreaterThan(0);
    expect(observation.zombies.map((unit) => unit.id)).not.toEqual(expect.arrayContaining(hiddenEnemyIds));
    expect(observation.horde).toMatchObject({
      warningType: 'none',
      warningDirections: [],
      nextWaveIndex: 1,
      nextWave: expect.objectContaining({ index: 1, spawnTurn: 5, directionCount: 1 }),
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
      economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
    });
    const clearState = createInitialState(132, config);
    const clearCandidates = createAgentObservation(clearState).checkpointPositionCandidates;
    expect(clearCandidates).toEqual(getCheckpointPositionCandidates(clearState));
    expect(clearCandidates).toHaveLength(100);

    const hiddenState = createInitialState(132, config);
    hiddenState.units.push(createUnit(hiddenState, 'zombie-secret-blocker', 'zombie', { q: 7, r: 1 }));
    const hiddenObservation = createAgentObservation(hiddenState);
    expect(hiddenObservation.checkpointPositionCandidates).toEqual(clearCandidates);
    expect(JSON.stringify(hiddenObservation)).not.toContain('zombie-secret-blocker');

    expect(JSON.stringify(hiddenObservation.constructibleFacilityPositionCandidates)).not.toContain('zombie-secret-blocker');
  });

  it('projects Fuel, special Facility state, Queue Pressure, and the Core strategic forecast', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 140, configOverrides: { economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } } });
    const police = observation.units.find((unit) => unit.type === 'police')!;
    expect(police).toMatchObject({ currentFuel: 12, maxFuel: 12, inSupply: true });
    expect(police.fuelCostByLegalMove.length).toBeGreaterThan(0);
    expect(police.fuelCostByLegalMove.every((move) => move.fuelCost >= 1 && move.projectedFuelAfterMove >= 0)).toBe(true);
    const wind = observation.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    expect(wind).toMatchObject({ healthyPopulation: 0, zombieTargetValue: 5, constructible: false });
    const nearbyMilitaryFactory = observation.facilities.find(
      (facility) => facility.id === 'military-factory-2',
    );
    expect(nearbyMilitaryFactory).toMatchObject({
      position: { q: 22, r: 10 },
      owner: 'none',
      status: 'unowned',
      inSupply: false,
    });
    expect(observation.strategicForecast.resources.fuel).toHaveProperty('singlePointOfFailure');
    expect(observation.constructibleFacilityPositionCandidates).toHaveLength(51 * 51 * 2);
    expect(observation.roadBranches.every((branch) => branch.currentPolicyTurns === 2)).toBe(true);
    expect(observation.checkpoints.every((checkpoint) => checkpoint.queuePressureClass === 'none' || checkpoint.queuePeople > 0)).toBe(true);
  });

  it('includes off-screen public site history without generated Zombie identities or Spawn hexes', () => {
    const state = createInitialState(143, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    state.events.push({
      id: 'event-site-history',
      turn: 3,
      phase: 'infection',
      type: 'site_zombies_spawned',
      payload: {
        siteKind: 'facility', siteId: 'farm-1', siteType: 'farm', q: 2, r: 5,
        cause: 'infection_fall', requestedSpawnCount: 2, actualSpawnCount: 1,
        remainingInfected: 5, chainOriginEventId: 'event-root',
        spawnedUnitIds: ['zombie-secret'], spawnedPositions: [{ q: 1, r: 5 }],
      },
    });
    const observation = createAgentObservation(state);
    expect(observation.importantSiteEvents).toEqual([expect.objectContaining({
      id: 'event-site-history',
      payload: expect.objectContaining({
        siteId: 'farm-1', siteType: 'farm', q: 2, r: 5,
        requestedSpawnCount: 2, actualSpawnCount: 1, remainingInfected: 5,
      }),
    })]);
    expect(JSON.stringify(observation.importantSiteEvents)).not.toContain('zombie-secret');
    expect(observation.importantSiteEvents[0]!.payload).not.toHaveProperty('spawnedPositions');
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
