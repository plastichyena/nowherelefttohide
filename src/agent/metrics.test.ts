import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState } from '../core/state';
import { collectGameMetrics, aggregateMetrics } from './metrics';
import { createAgentObservation } from './observation';
import { runAgentGame } from './runner';
import type { AgentPublicEvent } from './types';

describe('Agent Metrics', () => {
  it('collects required game-level values and deterministic action counts', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 4 });
    const run = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } });
    expect(run.failure).toBeNull();
    expect(run.technicalFailure).toBe(false);
    expect(run.metrics.seed).toBe(11);
    expect(run.metrics.actionCounts.EndTurn).toBeGreaterThan(0);
    expect(run.metrics.initialPopulation).toBeGreaterThan(0);
    expect(run.metrics.finalFood).toBeTypeOf('number');
    expect(run.metrics.bridgeApiVersion).toBe('3.0.0');
    expect(run.metrics.refugeeArrivalsByBranch).toHaveProperty('north');
    expect(run.metrics.totalRefugeeArrivals).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxWorkersInSingleFacility).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxTotalProductionWorkers).toBeGreaterThanOrEqual(run.metrics.maxWorkersInSingleFacility);
    expect(run.metrics.policeSurvivalRate).toBeGreaterThanOrEqual(0);
    expect(run.metrics.nationalGuardSurvivalRate).toBeGreaterThanOrEqual(0);
    expect(run.metrics.combatRecoverySelections).toBeGreaterThanOrEqual(0);
    expect(run.metrics.restRecoverySelections).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxSupplyRadius).toBeGreaterThan(0);
    expect(run.metrics.terrainEntriesByType).toMatchObject({ plain: expect.any(Number), forest: expect.any(Number), mountain: expect.any(Number), water: 0 });
    expect(run.metrics.finalHordeDefeated).toBeTypeOf('boolean');
    expect(run.metrics.maxVisibleZombies).toBeGreaterThanOrEqual(0);
    expect(run.metrics.normalZombieIdleCount).toBeGreaterThanOrEqual(0);
    for (const key of [
      'finalHordeSpawned', 'finalHordeKilled', 'finalHordeDefeated',
      'periodicHordeZombiesSpawned', 'periodicNormalZombiesSpawned',
      'finalHordeZombiesSpawned', 'finalNormalZombiesSpawned',
      'normalZombiesKilled', 'hordeZombiesKilled', 'maxVisibleZombies', 'turnsAfterFinalHorde',
      'suppliedAreaZombieClearTurn', 'suppliedAreaInfectionClearTurn', 'victoryTurn',
      'terrainEntriesByType', 'urbanDefenseApplications', 'urbanDefenseDamagePrevented',
      'forestDefenseApplications', 'forestDefenseDamagePrevented', 'normalZombieIdleCount',
      'hordeTargetInheritedCount', 'hordeTargetClearedCount',
      'mapWidth', 'mapHeight', 'humanHexesMovedByType', 'maxSingleMoveDistanceByType',
      'longMoves6PlusByType', 'unitFuelConsumedByType', 'unitFuelRefilledByType',
      'stateFuelSpentOnPower', 'stateFuelSpentOnUnits', 'windPowerGenerated',
      'simpleFarmsBuilt', 'droneBasesBuilt', 'guaranteedDefeatWarnings',
      'resourceSinglePointFailureTurnsByResource', 'checkpointQueuePressureTurnsByClass',
      'fixedMilitaryGoodsConsumedByType', 'attackMilitaryGoodsConsumedByType',
      'counterattackMilitaryGoodsConsumedByType', 'interceptionMilitaryGoodsConsumedByType',
      'suppressionMilitaryGoodsConsumedByType', 'militaryGoodsRefilledByType',
      'unfilledMilitaryGoodsRefillByType', 'militaryGoodsLostOnDestructionByType',
      'zeroMilitaryGoodsWeakAttacksByType', 'nationalGuardAttacksByRange',
      'nationalGuardMilitaryGoodsConsumedByRange', 'militaryGoodsRefillShortageTurns',
      'emergencyMovesByType', 'emergencyMovementHexesByType',
      'emergencyMovementPointsByType', 'emergencyReturnsToSupplyByType',
    ]) expect(run.metrics).toHaveProperty(key);
    for (const hiddenNoiseMetric of [
      'normalZombiesNoiseTargeted',
      'noiseTargetsReached',
      'noiseTargetsOverriddenByHorde',
      'noiseTargetsOverriddenByVisiblePopulation',
    ]) {
      expect(run.metrics).toHaveProperty(hiddenNoiseMetric);
      expect(run.result!.statistics).not.toHaveProperty(hiddenNoiseMetric);
    }
    expect(run.result).not.toBeNull();
    expect(run.metrics.periodicHordeZombiesSpawned).toBe(run.result!.statistics.periodicHordeZombiesSpawned);
    expect(run.metrics.periodicNormalZombiesSpawned).toBe(run.result!.statistics.periodicNormalZombiesSpawned);
    expect(run.metrics.finalHordeZombiesSpawned).toBe(run.result!.statistics.finalHordeZombiesSpawned);
    expect(run.metrics.finalNormalZombiesSpawned).toBe(run.result!.statistics.finalNormalZombiesSpawned);
    expect(run.metrics.finalHordeSpawned).toBe(
      run.metrics.finalHordeZombiesSpawned + run.metrics.finalNormalZombiesSpawned,
    );
  }, 20_000);

  it('keeps branch, policy, checkpoint, and supply metrics in the public result', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 1 });
    const run = runAgentGame(4, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 } });
    expect(Object.keys(run.metrics.refugeesScreenedByPolicy).sort()).toEqual(['normal', 'passThrough', 'strict']);
    expect(run.metrics.checkpointsBuilt).toBeGreaterThanOrEqual(0);
    expect(run.metrics.checkpointsRelocated).toBeGreaterThanOrEqual(0);
    expect(run.metrics.supplyRejections).toBeGreaterThanOrEqual(0);
  }, 10_000);

  it('counts policy branch-turns from the Active post only', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 1 });
    const run = runAgentGame(4, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 10 } });
    const observation = structuredClone(run.initialObservation!);
    const baseCheckpoint = {
      branchId: 'west',
      direction: 'west' as const,
      vision: 1,
      status: 'operational' as const,
      waiting: 0,
      screening: 0,
      approved: 0,
      queuePeople: 0,
      screeningCapacity: 10,
      estimatedScreeningThroughput: 5,
      arrivalIntervalMin: 2,
      arrivalIntervalMax: 4,
      arrivalPeopleMin: 5,
      arrivalPeopleMax: 10,
      queuePressureClass: 'none' as const,
      infected: 0,
      remainingTurns: 0,
      nextPolicy: 'normal' as const,
      nextArrivalTurn: null,
      providesSupply: false,
      infectionContained: true,
      containingUnitId: null,
      projectedSuppression: 0,
      projectedCivilianDamage: 0,
    };
    observation.checkpoints = [
      { ...baseCheckpoint, id: 'active', position: { q: 3, r: 7 }, role: 'active', currentPolicy: 'normal', currentPolicyTurns: 2, providesSupply: true },
      { ...baseCheckpoint, id: 'standby', position: { q: 2, r: 7 }, role: 'standby', currentPolicy: 'strict', currentPolicyTurns: 3 },
      { ...baseCheckpoint, id: 'dormant', position: { q: 1, r: 7 }, role: 'dormant', currentPolicy: 'passThrough', currentPolicyTurns: 0 },
    ];
    const metrics = collectGameMetrics({
      initialObservation: observation,
      finalObservation: observation,
      observations: [observation],
      actions: [],
      result: null,
      agent: { id: 'metrics-test', version: '1' },
      config,
    });
    expect(metrics.checkpointNormalBranchTurns).toBe(1);
    expect(metrics.checkpointStrictBranchTurns).toBe(0);
    expect(metrics.checkpointPassThroughBranchTurns).toBe(0);
  });

  it('classifies every Military Goods and Emergency Movement metric from public facts', () => {
    const config = createDefaultConfig({ economy: { initialZombieCount: 0 } });
    const observation = createAgentObservation(createInitialState(145, config));
    const policeForecast = observation.endTurnForecast.militaryGoods.units.find((unit) => unit.unitType === 'police')!;
    policeForecast.unfilledRefillDemand = 3;
    observation.endTurnForecast.militaryGoods.totalUnfilledRefillDemand = 3;
    const suppliedDestination = observation.supply.suppliedTileKeys[0]!.split(',').map(Number);
    const event = (id: string, type: AgentPublicEvent['type'], payload: AgentPublicEvent['payload']): AgentPublicEvent => ({
      id,
      turn: observation.turn,
      phase: observation.phase,
      type,
      payload,
    });
    const events: AgentPublicEvent[] = [
      event('fixed', 'resource_consumed', {
        resource: 'militaryGoods', reason: 'unit_fixed_upkeep', unitType: 'nationalGuard', amount: 1,
      }),
      event('refill', 'resource_consumed', {
        resource: 'militaryGoods', reason: 'unit_refill', unitType: 'police', amount: 4,
      }),
      event('suppression', 'infection_suppressed', { unitType: 'police', militaryGoodsCost: 1 }),
      event('attack-r2', 'attack', {
        unitType: 'nationalGuard', distance: 2, militaryGoodsCost: 2, effectiveAttack: 10,
      }),
      event('counter-r1', 'attack', {
        unitType: 'nationalGuard', counterattack: true, distance: 1, militaryGoodsCost: 1, effectiveAttack: 10,
      }),
      event('interception-r2', 'interception', {
        unitType: 'nationalGuard', distance: 2, militaryGoodsCost: 2, effectiveAttack: 10,
      }),
      event('weak-police', 'attack', {
        unitType: 'police', distance: 1, militaryGoodsCost: 0, effectiveAttack: 1,
      }),
      event('destroyed', 'unit_destroyed', { unitType: 'police', lostMilitaryGoods: 3 }),
      event('emergency-return', 'unit_moved', {
        unitType: 'police', movementMode: 'emergency', hexesMoved: 2, effectiveMovementCost: 3,
        q: suppliedDestination[0], r: suppliedDestination[1],
      }),
      event('emergency-field', 'unit_moved', {
        unitType: 'nationalGuard', movementMode: 'emergency', hexesMoved: 1, effectiveMovementCost: 2,
        q: -1, r: -1,
      }),
    ];

    const metrics = collectGameMetrics({
      initialObservation: observation,
      finalObservation: observation,
      observations: [observation],
      actions: [],
      events,
      result: null,
      agent: { id: 'v141-metrics-test', version: '1' },
      config,
    });
    expect(metrics.fixedMilitaryGoodsConsumedByType).toEqual({ police: 0, nationalGuard: 1 });
    expect(metrics.attackMilitaryGoodsConsumedByType).toEqual({ police: 0, nationalGuard: 2 });
    expect(metrics.counterattackMilitaryGoodsConsumedByType).toEqual({ police: 0, nationalGuard: 1 });
    expect(metrics.interceptionMilitaryGoodsConsumedByType).toEqual({ police: 0, nationalGuard: 2 });
    expect(metrics.suppressionMilitaryGoodsConsumedByType).toEqual({ police: 1, nationalGuard: 0 });
    expect(metrics.militaryGoodsRefilledByType).toEqual({ police: 4, nationalGuard: 0 });
    expect(metrics.unfilledMilitaryGoodsRefillByType).toEqual({ police: 3, nationalGuard: 0 });
    expect(metrics.militaryGoodsLostOnDestructionByType).toEqual({ police: 3, nationalGuard: 0 });
    expect(metrics.zeroMilitaryGoodsWeakAttacksByType).toEqual({ police: 1, nationalGuard: 0 });
    expect(metrics.nationalGuardAttacksByRange).toEqual({ range1: 1, range2: 2 });
    expect(metrics.nationalGuardMilitaryGoodsConsumedByRange).toEqual({ range1: 1, range2: 4 });
    expect(metrics.militaryGoodsRefillShortageTurns).toBe(1);
    expect(metrics.emergencyMovesByType).toEqual({ police: 1, nationalGuard: 1 });
    expect(metrics.emergencyMovementHexesByType).toEqual({ police: 2, nationalGuard: 1 });
    expect(metrics.emergencyMovementPointsByType).toEqual({ police: 3, nationalGuard: 2 });
    expect(metrics.emergencyReturnsToSupplyByType).toEqual({ police: 1, nationalGuard: 0 });
  });

  it('aggregates averages, percentiles, outcomes, and action totals', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 4 });
    const first = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } }).metrics;
    const second = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } }).metrics;
    const aggregate = aggregateMetrics([first, second]);
    expect(aggregate.executions).toBe(2);
    expect(aggregate.completed).toBe(2);
    expect(aggregate.metrics.finalTurn.average).toBeGreaterThan(0);
    expect(aggregate.metrics.finalTurn.p10).toBeLessThanOrEqual(aggregate.metrics.finalTurn.p90);
    expect(aggregate.actionCounts.EndTurn).toBe(first.actionCounts.EndTurn + second.actionCounts.EndTurn);
  }, 45_000);

  it('can collect a technical-failure metric without pretending it is an in-game loss', () => {
    const config = createDefaultConfig();
    const run = runAgentGame(3, {
      strategy: 'random',
      config,
      limits: { maxTurns: 1, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 1 },
    });
    expect(run.metrics.outcome).toBe('technical_failure');
    expect(run.metrics.failure?.code).toBeTruthy();
    expect(run.metrics.gameOverReason).toBeNull();
  });
});
