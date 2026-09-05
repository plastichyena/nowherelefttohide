import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import {
  forecastEndTurn,
  forecastUnitCombatAtDistance,
  getUnitLegalAttackProjections,
  getUnitLegalMoveFuelProjections,
  GameEngine,
  previewMove,
} from './engine';
import { hexNeighbors, hexWithinBounds } from './hex';
import { createUnit, populationLedgerTotal, synchronizePopulation } from './state';
import { singleFinalWave } from './testConfig';

type Snapshot = ReturnType<GameEngine['getState']> extends Readonly<infer State> ? State : never;

function mutableState(engine: GameEngine): Snapshot {
  return engine.getState() as Snapshot;
}

function rebalance(state: Snapshot): void {
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state);
}

function quietEngine(seed = 1): GameEngine {
  return new GameEngine(seed, createDefaultConfig({
    horde: singleFinalWave(30),
    economy: {
      initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 },
      initialResources: { food: 10_000, civilianGoods: 10_000, militaryGoods: 10_000, fuel: 10_000 },
    },
  }));
}

describe('v1.4.1 carried Military Goods combat', () => {
  it('uses one shared distance profile for full and shortage attacks', () => {
    const engine = quietEngine(401);
    const state = mutableState(engine);
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    const guard = state.units.find((unit) => unit.id === 'national-guard-1')!;

    police.currentMilitaryGoods = 1;
    expect(forecastUnitCombatAtDistance(state, police, 1)).toMatchObject({
      canAttack: true,
      militaryGoodsCost: 1,
      projectedMilitaryGoodsAfterAttack: 0,
      effectiveAttack: 8,
    });
    police.currentMilitaryGoods = 0;
    expect(forecastUnitCombatAtDistance(state, police, 1)).toMatchObject({
      canAttack: true,
      militaryGoodsCost: 0,
      effectiveAttack: 2,
    });

    guard.currentMilitaryGoods = 2;
    expect(forecastUnitCombatAtDistance(state, guard, 2)).toMatchObject({
      canAttack: true,
      militaryGoodsCost: 2,
      effectiveAttack: 15,
    });
    guard.currentMilitaryGoods = 1;
    expect(forecastUnitCombatAtDistance(state, guard, 2)).toMatchObject({
      canAttack: false,
      reason: 'insufficient_military_goods',
    });
    expect(forecastUnitCombatAtDistance(state, guard, 1)).toMatchObject({
      canAttack: true,
      militaryGoodsCost: 1,
      effectiveAttack: 15,
    });
    guard.currentMilitaryGoods = 0;
    expect(forecastUnitCombatAtDistance(state, guard, 1)).toMatchObject({
      canAttack: true,
      militaryGoodsCost: 0,
      effectiveAttack: 3,
    });
  });

  it('charges an accepted Attack and rejects a range-two Guard shortage without mutation', () => {
    const engine = quietEngine(402);
    const state = mutableState(engine);
    const guard = state.units.find((unit) => unit.id === 'national-guard-1')!;
    const zombie = createUnit(state, 'zombie-test', 'zombie', { q: 28, r: 25 });
    Object.assign(zombie, { hp: 10, maxHp: 10, attack: 5, movement: 0, range: 1, vision: 3 });
    state.units.push(zombie);
    guard.currentMilitaryGoods = 1;
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const before = engine.getState();
    expect(getUnitLegalAttackProjections(before, guard.id)).toHaveLength(0);
    expect(engine.step({ type: 'Attack', attackerId: guard.id, targetId: zombie.id }).error?.code).toBe('attack_not_legal');
    expect(engine.getState()).toEqual(before);

    const ready = mutableState(engine);
    ready.units.find((unit) => unit.id === guard.id)!.currentMilitaryGoods = 2;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: ready }).error).toBeNull();
    const preview = getUnitLegalAttackProjections(engine.getState(), guard.id)[0]!;
    expect(preview).toMatchObject({ targetUnitId: zombie.id, distance: 2, militaryGoodsCost: 2, effectiveAttack: 15 });
    const result = engine.step({ type: 'Attack', attackerId: guard.id, targetId: zombie.id });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === guard.id)?.currentMilitaryGoods).toBe(0);
    expect(result.events.some((event) => event.type === 'attack' && event.payload.militaryGoodsCost === 2)).toBe(true);
  });

  it('charges carried Military Goods for Human counterattack and interception only when they occur', () => {
    const counterEngine = quietEngine(407);
    const counterState = mutableState(counterEngine);
    counterState.units = counterState.units.filter((unit) => unit.isPlayerUnit);
    const counterGuard = counterState.units.find((unit) => unit.id === 'national-guard-1')!;
    counterGuard.position = { q: 25, r: 25 };
    counterGuard.currentMilitaryGoods = 2;
    counterState.resources.militaryGoods = 0;
    const counterZombie = createUnit(counterState, 'zombie-counter', 'zombie', { q: 25, r: 24 });
    counterZombie.movement = 0;
    counterState.units.push(counterZombie);
    rebalance(counterState);
    expect(counterEngine.step({ type: 'LoadSnapshot', snapshot: counterState }).error).toBeNull();
    const counterResult = counterEngine.step({ type: 'EndTurn' });
    const counterEvent = counterResult.events.find((event) => event.type === 'attack' && event.payload.counterattack === true);
    expect(counterEvent?.payload).toMatchObject({
      attackerId: counterGuard.id,
      distance: 1,
      militaryGoodsCost: 1,
      effectiveAttack: 15,
    });
    expect(counterResult.state.units.find((unit) => unit.id === counterGuard.id)?.currentMilitaryGoods).toBe(0);

    const interceptionEngine = quietEngine(408);
    const interceptionState = mutableState(interceptionEngine);
    interceptionState.units = interceptionState.units.filter((unit) => unit.isPlayerUnit);
    const interceptingGuard = interceptionState.units.find((unit) => unit.id === 'national-guard-1')!;
    interceptingGuard.position = { q: 15, r: 8 };
    interceptingGuard.currentMilitaryGoods = 3;
    interceptionState.resources.militaryGoods = 0;
    interceptionState.units.push(createUnit(interceptionState, 'zombie-intercept', 'zombie', { q: 15, r: 5 }));
    rebalance(interceptionState);
    expect(interceptionEngine.step({ type: 'LoadSnapshot', snapshot: interceptionState }).error).toBeNull();
    const interceptionResult = interceptionEngine.step({ type: 'EndTurn' });
    const interceptionEvent = interceptionResult.events.find((event) => event.type === 'interception'
      && event.payload.attackerId === interceptingGuard.id);
    expect(interceptionEvent?.payload).toMatchObject({
      distance: 2,
      militaryGoodsCost: 2,
      effectiveAttack: 15,
    });
    expect(interceptionResult.state.units.find((unit) => unit.id === interceptingGuard.id)?.currentMilitaryGoods).toBe(0);
  });

  it('does not charge a destroyed defender and reports its carried Military Goods as lost', () => {
    const engine = quietEngine(411);
    const state = mutableState(engine);
    state.units = state.units.filter((unit) => unit.isPlayerUnit);
    const guard = state.units.find((unit) => unit.id === 'national-guard-1')!;
    guard.position = { q: 1, r: 1 };
    state.units.find((unit) => unit.id === 'police-1')!.position = { q: 49, r: 49 };
    guard.hp = 5;
    guard.currentMilitaryGoods = 5;
    state.resources.militaryGoods = 0;
    const zombie = createUnit(state, 'zombie-kill', 'zombie', { q: 1, r: 0 });
    zombie.movement = 0;
    state.units.push(zombie);
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    const destroyed = result.events.find((event) => event.type === 'unit_destroyed'
      && event.payload.unitId === guard.id);
    expect(destroyed?.payload).toMatchObject({ lostMilitaryGoods: 4, lostFuel: guard.currentFuel });
    expect(result.events.some((event) => event.type === 'attack'
      && event.payload.counterattack === true
      && event.payload.attackerId === guard.id)).toBe(false);
    expect(result.state.resources.militaryGoods).toBe(0);
  });
});

describe('v1.4.1 Military Goods economy and suppression', () => {
  it('forecasts and applies fixed upkeep, ID round-robin refill, and post-refill suppression from one plan', () => {
    const engine = quietEngine(403);
    const state = mutableState(engine);
    state.units = state.units.filter((unit) => unit.isPlayerUnit);
    const guard = state.units.find((unit) => unit.id === 'national-guard-1')!;
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    guard.position = { q: 1, r: 1 };
    guard.currentMilitaryGoods = guard.maxMilitaryGoods;
    police.position = { ...farm.position };
    police.currentMilitaryGoods = 0;
    farm.infected = 2;
    state.resources.militaryGoods = 1;
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();

    const before = engine.getState();
    const forecast = forecastEndTurn(before).militaryGoods;
    expect(engine.getState()).toEqual(before);
    expect(forecast).toMatchObject({
      startingStock: 1,
      projectedProduction: 0,
      projectedTotalRefilled: 1,
      projectedEndingStock: 0,
    });
    expect(forecast.units.find((unit) => unit.unitId === guard.id)).toMatchObject({
      fixedConsumption: 1,
      afterFixed: 19,
      inSupply: false,
      projectedRefillAmount: 0,
      suppressionStatus: 'none',
    });
    expect(forecast.units.find((unit) => unit.unitId === police.id)).toMatchObject({
      afterFixed: 0,
      projectedRefillAmount: 1,
      afterRefill: 1,
      suppressionCost: 1,
      suppressionStatus: 'suppression',
      afterSuppression: 0,
    });

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.resources.militaryGoods).toBe(0);
    expect(result.state.units.find((unit) => unit.id === guard.id)?.currentMilitaryGoods).toBe(19);
    expect(result.state.units.find((unit) => unit.id === police.id)?.currentMilitaryGoods).toBe(0);
    expect(result.state.facilities.find((facility) => facility.id === farm.id)?.infected).toBe(0);
    expect(result.events.some((event) => event.type === 'infection_suppressed' && event.payload.militaryGoodsCost === 1)).toBe(true);
  });

  it('contains infection without consuming attack rights when carried Military Goods are zero', () => {
    const engine = quietEngine(404);
    const state = mutableState(engine);
    state.units = state.units.filter((unit) => unit.isPlayerUnit);
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    police.position = { ...farm.position };
    police.currentMilitaryGoods = 0;
    state.resources.militaryGoods = 0;
    farm.workers = 10;
    farm.infected = 3;
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    expect(forecastEndTurn(engine.getState()).militaryGoods.units.find((unit) => unit.unitId === police.id)).toMatchObject({
      suppressionStatus: 'containment_only',
      suppressionCost: 0,
    });
    const result = engine.step({ type: 'EndTurn' });
    const updatedPolice = result.state.units.find((unit) => unit.id === police.id)!;
    expect(result.state.facilities.find((facility) => facility.id === farm.id)).toMatchObject({ workers: 10, infected: 3 });
    expect(updatedPolice.activity.suppressed).toBe(false);
  });

  it('uses current-turn Military Factory production for same-turn ID-round-robin refills', () => {
    const engine = quietEngine(409);
    const state = mutableState(engine);
    state.units = state.units.filter((unit) => unit.isPlayerUnit);
    const guard = state.units.find((unit) => unit.id === 'national-guard-1')!;
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    guard.currentMilitaryGoods = 0;
    police.currentMilitaryGoods = 0;
    state.resources.militaryGoods = 0;
    const factory = state.facilities.find((facility) => facility.id === 'military-factory-2')!;
    factory.owner = 'player';
    factory.status = 'owned';
    factory.operationalStatus = 'operational';
    factory.workers = 1;
    factory.securedOrder = 20;
    factory.populationOperationalTurn = 1;
    factory.powerSupplyEnabled = true;
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const forecast = forecastEndTurn(engine.getState()).militaryGoods;
    expect(forecast.projectedProduction).toBe(4);
    expect(forecast.units.map((unit) => [unit.unitId, unit.projectedRefillAmount])).toEqual([
      [guard.id, 2],
      [police.id, 2],
    ]);
    const result = engine.step({ type: 'EndTurn' });
    const producedIndex = result.events.findIndex((event) => event.type === 'resource_produced'
      && event.payload.resource === 'militaryGoods');
    const refillIndex = result.events.findIndex((event) => event.type === 'resource_consumed'
      && event.payload.reason === 'unit_refill');
    expect(producedIndex).toBeGreaterThanOrEqual(0);
    expect(refillIndex).toBeGreaterThan(producedIndex);
    expect(result.state.units.find((unit) => unit.id === guard.id)?.currentMilitaryGoods).toBe(2);
    expect(result.state.units.find((unit) => unit.id === police.id)?.currentMilitaryGoods).toBe(2);
  });
});

describe('v1.4.1 Fuel-zero Emergency Movement', () => {
  it.each([
    ['police-1', { q: 21, r: 25 }, 3],
    ['national-guard-1', { q: 28, r: 25 }, 2],
  ] as const)('moves %s at Fuel zero within its effective-MP limit', (unitId, destination, expectedMp) => {
    const engine = quietEngine(405);
    const state = mutableState(engine);
    const unit = state.units.find((candidate) => candidate.id === unitId)!;
    unit.currentFuel = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const projection = getUnitLegalMoveFuelProjections(engine.getState(), unitId)
      .find((entry) => entry.destination.q === destination.q && entry.destination.r === destination.r);
    expect(projection).toMatchObject({ movementMode: 'emergency', effectiveMovementCost: expectedMp, fuelCost: 0, projectedFuelAfterMove: 0 });
    expect(previewMove(engine.getState(), unitId, destination)).toMatchObject({
      legal: true,
      movementMode: 'emergency',
      effectiveMovementCost: expectedMp,
      fuelCost: 0,
    });
    const result = engine.step({ type: 'Move', unitId, destination });
    expect(result.error).toBeNull();
    expect(result.state.units.find((candidate) => candidate.id === unitId)).toMatchObject({
      position: destination,
      currentFuel: 0,
      actionState: 'moved',
      canAttack: true,
    });
    expect(result.events.some((event) => event.type === 'unit_moved'
      && event.payload.movementMode === 'emergency'
      && event.payload.effectiveMovementCost === expectedMp
      && event.payload.fuelUsed === 0)).toBe(true);
  });

  it('rejects an Emergency Move above the effective-MP limit without changing State or RNG', () => {
    const engine = quietEngine(406);
    const state = mutableState(engine);
    state.units.find((unit) => unit.id === 'national-guard-1')!.currentFuel = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const before = engine.getState();
    const result = engine.step({ type: 'Move', unitId: 'national-guard-1', destination: { q: 29, r: 25 } });
    expect(result.error?.code).toBe('out_of_range');
    expect(engine.getState()).toEqual(before);
  });

  it('uses existing Forest and Mountain effective costs for Emergency Movement', () => {
    const engine = quietEngine(410);
    const state = mutableState(engine);
    state.units = state.units.filter((unit) => unit.isPlayerUnit);
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    police.currentFuel = 0;
    const findEntryPosition = (terrain: 'forest' | 'mountain') => {
      const destination = state.map.tiles.find((tile) => tile.terrain === terrain && !tile.road && tile.facilityId === null)!;
      const start = hexNeighbors(destination).find((position) => hexWithinBounds(position, state.map.width, state.map.height))!;
      return { destination: { q: destination.q, r: destination.r }, start };
    };

    const forest = findEntryPosition('forest');
    police.position = forest.start;
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    expect(previewMove(engine.getState(), police.id, forest.destination)).toMatchObject({
      legal: true,
      movementMode: 'emergency',
      effectiveMovementCost: 2,
    });

    const mountainState = mutableState(engine);
    const mountainPolice = mountainState.units.find((unit) => unit.id === police.id)!;
    const mountain = findEntryPosition('mountain');
    mountainPolice.position = mountain.start;
    mountainPolice.currentFuel = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: mountainState }).error).toBeNull();
    expect(previewMove(engine.getState(), police.id, mountain.destination)).toMatchObject({
      legal: true,
      movementMode: 'emergency',
      effectiveMovementCost: 3,
    });
  });
});
