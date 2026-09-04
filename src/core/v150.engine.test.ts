import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createInitialState, createUnit, populationLedgerTotal, synchronizePopulation } from './state';
import type { GameState } from './types';

type MutableState = GameState;

function quietConfig() {
  return createDefaultConfig({
    economy: {
      initialZombieCount: 0,
      initialResources: { food: 10_000, civilianGoods: 10_000, militaryGoods: 10_000, fuel: 10_000 },
    },
    refugees: {
      arrivalIntervalMin: 99,
      arrivalIntervalMax: 99,
    },
    horde: {
      waves: [{
        turn: 100,
        directionCount: 1,
        compositionPerDirection: { hordeZombie: 1, zombie: 0 },
        final: true,
      }],
    },
    units: {
      zombie: { attack: 1, movement: 0, vision: 0 },
      hordeZombie: { attack: 1, movement: 0, vision: 0 },
    },
  });
}

function load(engine: GameEngine, snapshot: MutableState): void {
  const result = engine.step({ type: 'LoadSnapshot', snapshot });
  expect(result.error, result.error?.message).toBeNull();
}

function rebalance(state: MutableState): void {
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state)
    - state.population.cumulativeArrivals
    - state.population.cumulativeDiscoveredInfected
    + state.population.cumulativeDepartures;
}

describe('v1.5.0 Human Unit progression and Riot defaults', () => {
  it('creates regular initial units, recruit production data, Riot Police, and the configured mixed-Horde rule', () => {
    const config = createDefaultConfig({ economy: { initialZombieCount: 0 } });
    const state = createInitialState(15001, config);
    const police = state.units.find((unit) => unit.type === 'police')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;

    expect(state.gameVersion).toBe('3.0.0');
    expect(config.version).toBe('3.0.0');
    expect(police).toMatchObject({
      proficiency: 'regular', recruitSurvivalTurns: 0, regularZombieKills: 0,
      veteranPromotionPending: false, attack: 5, maxAttackCharges: 1, attackChargesRemaining: 1,
    });
    expect(guard).toMatchObject({
      proficiency: 'regular', attack: 10, maxAttackCharges: 1, attackChargesRemaining: 1,
    });
    expect(config.unitExperience).toMatchObject({
      productionProficiencyByType: { police: 'recruit', nationalGuard: 'recruit', riotPolice: 'recruit' },
      recruitSurvivalTurnsRequired: 5,
      regularAttackMultiplier: 1.25,
      regularAttackRounding: 'ceil',
      veteranZombieKillsRequired: 5,
      veteranAttackCharges: 2,
    });
    expect(config.units).toMatchObject({
      police: { recruitAttack: 4 },
      nationalGuard: { recruitAttack: 8 },
      riotPolice: {
        hp: 75, recruitAttack: 10, movement: 10, range: 1, vision: 5, population: 10,
        maxFuel: 12, emergencyMovementPoints: 2, maxMilitaryGoods: 5,
        productionCivilianGoods: 25, productionMilitaryGoods: 25,
        recruitmentFacilityTypes: ['capital', 'city'],
        reanimationUnitType: 'riotZombie', noiseClass: 'medium', noiseRadius: 5,
      },
      riotZombie: { hp: 50, attack: 5, movement: 3, range: 1, vision: 5 },
    });
    expect(config.horde).toMatchObject({
      specialZombieWeights: { zombie: 70, policeZombie: 15, soldierZombie: 10, riotZombie: 5 },
      riotZombieCapPerDirection: 1,
      movementNoiseRadius: 8,
    });
    expect(config.horde.waves.map((wave) => [wave.turn, wave.compositionPerDirection.hordeZombie, wave.compositionPerDirection.zombie]))
      .toEqual([[5, 2, 3], [10, 1, 5], [20, 4, 7], [35, 2, 7], [50, 4, 8]]);
  });

  it('promotes a surviving Recruit at Player Turn Start with ceiling-rounded Regular attack', () => {
    const engine = new GameEngine(15002, quietConfig());
    const setup = engine.getState() as MutableState;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    police.proficiency = 'recruit';
    police.recruitSurvivalTurns = 4;
    police.regularZombieKills = 0;
    police.veteranPromotionPending = false;
    police.attack = 4;
    police.maxAttackCharges = 1;
    police.attackChargesRemaining = 1;
    rebalance(setup);
    load(engine, setup);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error, result.error?.message).toBeNull();
    const promoted = result.state.units.find((unit) => unit.id === police.id)!;
    expect(promoted).toMatchObject({
      proficiency: 'regular', recruitSurvivalTurns: 5, attack: 5,
      maxAttackCharges: 1, attackChargesRemaining: 1,
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'unit_promoted',
      payload: expect.objectContaining({ unitId: police.id, from: 'recruit', into: 'regular', reason: 'survival' }),
    }));
  });

  it('keeps fifth direct Regular kill pending until the next Player Turn Start, then grants two charges', () => {
    const engine = new GameEngine(15003, quietConfig());
    const setup = engine.getState() as MutableState;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    police.proficiency = 'regular';
    police.regularZombieKills = 4;
    police.veteranPromotionPending = false;
    police.attack = 5;
    police.attackChargesRemaining = 1;
    police.maxAttackCharges = 1;
    const target = createUnit(setup, 'promotion-target', 'zombie', { q: police.position.q + 1, r: police.position.r });
    target.hp = 1;
    target.maxHp = 1;
    target.attack = 0;
    target.movement = 0;
    setup.units.push(target);
    rebalance(setup);
    load(engine, setup);

    const kill = engine.step({ type: 'Attack', attackerId: police.id, targetId: target.id });
    expect(kill.error, kill.error?.message).toBeNull();
    expect(kill.state.units.find((unit) => unit.id === police.id)).toMatchObject({
      proficiency: 'regular', regularZombieKills: 5, veteranPromotionPending: true,
      maxAttackCharges: 1, attackChargesRemaining: 0,
    });
    expect(kill.events).toContainEqual(expect.objectContaining({ type: 'unit_promotion_pending' }));

    const start = engine.step({ type: 'EndTurn' });
    expect(start.error, start.error?.message).toBeNull();
    expect(start.state.units.find((unit) => unit.id === police.id)).toMatchObject({
      proficiency: 'veteran', veteranPromotionPending: false,
      maxAttackCharges: 2, attackChargesRemaining: 2, attack: 5,
    });
  });

  it('does not carry Recruit-era direct Zombie kills into the Regular-to-Veteran counter', () => {
    const engine = new GameEngine(15009, quietConfig());
    const setup = engine.getState() as MutableState;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    police.proficiency = 'recruit';
    police.attack = 4;
    police.regularZombieKills = 0;
    const target = createUnit(setup, 'recruit-kill-target', 'zombie', { q: police.position.q + 1, r: police.position.r });
    target.hp = 1;
    target.maxHp = 1;
    target.attack = 0;
    target.movement = 0;
    setup.units.push(target);
    rebalance(setup);
    load(engine, setup);

    const result = engine.step({ type: 'Attack', attackerId: police.id, targetId: target.id });
    expect(result.error, result.error?.message).toBeNull();
    expect(result.state.units.find((unit) => unit.id === police.id)).toMatchObject({
      proficiency: 'recruit', regularZombieKills: 0, veteranPromotionPending: false,
    });
    expect(result.events.some((event) => event.type === 'unit_promotion_pending')).toBe(false);
  });

  it('allows a Veteran two legal attacks but never lets the first attack restore movement', () => {
    const engine = new GameEngine(15004, quietConfig());
    const setup = engine.getState() as MutableState;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    police.proficiency = 'veteran';
    police.maxAttackCharges = 2;
    police.attackChargesRemaining = 2;
    police.attack = 5;
    police.position = { q: 24, r: 24 };
    const target = createUnit(setup, 'veteran-target', 'zombie', { q: police.position.q + 1, r: police.position.r });
    target.hp = 10;
    target.maxHp = 10;
    target.attack = 0;
    target.movement = 0;
    setup.units.push(target);
    rebalance(setup);
    load(engine, setup);

    const first = engine.step({ type: 'Attack', attackerId: police.id, targetId: target.id });
    expect(first.error, first.error?.message).toBeNull();
    const afterFirst = first.state.units.find((unit) => unit.id === police.id)!;
    expect(afterFirst).toMatchObject({ canMove: false, canAttack: true, attackChargesRemaining: 1, maxAttackCharges: 2 });
    expect(engine.getLegalActions().some((action) => action.type === 'Move' && action.unitId === police.id)).toBe(false);
    expect(engine.getLegalActions()).toContainEqual({ type: 'Attack', attackerId: police.id, targetId: target.id });

    const second = engine.step({ type: 'Attack', attackerId: police.id, targetId: target.id });
    expect(second.error, second.error?.message).toBeNull();
    expect(second.state.units.some((unit) => unit.id === target.id)).toBe(false);
    expect(second.state.units.find((unit) => unit.id === police.id)).toMatchObject({
      canMove: false, canAttack: false, attackChargesRemaining: 0,
    });
  });

  it('commissions Riot Police as Recruits and reserves the specified population and goods', () => {
    const engine = new GameEngine(15007, quietConfig());
    const before = engine.getState();
    const order = engine.step({ type: 'ProduceUnit', unitType: 'riotPolice', destination: { q: 25, r: 25 } });
    expect(order.error, order.error?.message).toBeNull();
    expect(order.state.pendingUnitProductions).toContainEqual(expect.objectContaining({
      unitType: 'riotPolice', population: 10, cityFacilityId: 'capital', readyTurn: 2,
    }));
    expect(order.state.resources.civilianGoods).toBe(before.resources.civilianGoods - 25);
    expect(order.state.resources.militaryGoods).toBe(before.resources.militaryGoods - 25);

    const completed = engine.step({ type: 'EndTurn' });
    expect(completed.error, completed.error?.message).toBeNull();
    expect(completed.state.units.find((unit) => unit.type === 'riotPolice')).toMatchObject({
      proficiency: 'recruit', attack: 10, hp: 75, maxHp: 75, movement: 10,
      range: 1, vision: 5, population: 10, maxAttackCharges: 1, attackChargesRemaining: 1,
    });
    expect(completed.state.statistics).toMatchObject({
      riotPoliceProduced: 1,
      recruitsCommissionedByType: expect.objectContaining({ riotPolice: 1 }),
    });
  });

  it('uses the shared production-proficiency Config override when commissioning', () => {
    const config = quietConfig();
    config.unitExperience.productionProficiencyByType.riotPolice = 'veteran';
    const engine = new GameEngine(15011, config);
    const order = engine.step({ type: 'ProduceUnit', unitType: 'riotPolice', destination: { q: 25, r: 25 } });
    expect(order.error, order.error?.message).toBeNull();

    const completed = engine.step({ type: 'EndTurn' });
    expect(completed.error, completed.error?.message).toBeNull();
    expect(completed.state.units.find((unit) => unit.type === 'riotPolice')).toMatchObject({
      proficiency: 'veteran', attack: 13, maxAttackCharges: 2, attackChargesRemaining: 2,
    });
    expect(completed.state.statistics.recruitsCommissionedByType.riotPolice).toBe(0);
  });

  it('reanimates a defeated Riot Police as an inactive same-hex Riot Zombie', () => {
    const engine = new GameEngine(15005, quietConfig());
    const setup = engine.getState() as MutableState;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    police.position = { q: 22, r: 24 };
    const riot = createUnit(setup, 'riot-1', 'riotPolice', { q: 24, r: 24 });
    riot.hp = 1;
    const target = createUnit(setup, 'riot-counter', 'zombie', { q: 25, r: 24 });
    target.hp = 99;
    target.maxHp = 99;
    target.attack = 5;
    target.movement = 0;
    setup.units.push(riot, target);
    rebalance(setup);
    load(engine, setup);

    const result = engine.step({ type: 'Attack', attackerId: riot.id, targetId: target.id });
    expect(result.error, result.error?.message).toBeNull();
    expect(result.state.units.some((unit) => unit.id === riot.id)).toBe(false);
    expect(result.state.units.find((unit) => unit.type === 'riotZombie')).toMatchObject({
      position: riot.position, hp: 50, maxHp: 50, canMove: false, canAttack: false,
      currentFuel: 0, currentMilitaryGoods: 0, proficiency: null,
      spawnGroupId: null, hordeKind: null,
    });
    expect(result.state.statistics).toMatchObject({ riotPoliceLost: 1, riotPoliceReanimations: 1, riotZombiesSpawned: 1 });
  });

  it('fills scheduled Horde Zombie slots deterministically and applies the per-direction Riot cap', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      horde: {
        waves: [{
          turn: 1,
          directionCount: 1,
          compositionPerDirection: { hordeZombie: 1, zombie: 3 },
          final: true,
        }],
        specialZombieWeights: { zombie: 1, policeZombie: 0, soldierZombie: 0, riotZombie: 100 },
        riotZombieCapPerDirection: 1,
      },
    });
    const first = new GameEngine(15006, config).step({ type: 'EndTurn' });
    const second = new GameEngine(15006, config).step({ type: 'EndTurn' });
    expect(first.error, first.error?.message).toBeNull();
    expect(second.error, second.error?.message).toBeNull();

    const scheduled = first.state.units
      .filter((unit) => unit.spawnGroupId !== null)
      .map((unit) => ({ id: unit.id, type: unit.type, position: unit.position, hordeKind: unit.hordeKind }));
    expect(scheduled).toEqual(second.state.units
      .filter((unit) => unit.spawnGroupId !== null)
      .map((unit) => ({ id: unit.id, type: unit.type, position: unit.position, hordeKind: unit.hordeKind })));
    expect(scheduled).toHaveLength(4);
    expect(scheduled.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(1);
    expect(scheduled.filter((unit) => unit.type === 'riotZombie')).toHaveLength(1);
    expect(scheduled.filter((unit) => unit.type === 'zombie')).toHaveLength(2);
    expect(scheduled.every((unit) => unit.hordeKind === 'final')).toBe(true);
  });

  it('emits a radius-eight shared Noise Pulse for every actual Horde Zombie move', () => {
    const engine = new GameEngine(15008, quietConfig());
    const setup = engine.getState() as MutableState;
    const horde = createUnit(setup, 'horde-noise-source', 'hordeZombie', { q: 20, r: 25 });
    horde.movement = 1;
    horde.vision = 0;
    horde.canMove = true;
    horde.canAttack = false;
    horde.spawnGroupId = 'noise-wave';
    horde.hordeKind = 'periodic';
    setup.units.push(horde);
    rebalance(setup);
    load(engine, setup);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error, result.error?.message).toBeNull();
    const emitted = result.events.filter((event) => event.type === 'noise_emitted'
      && event.payload.sourceKind === 'hordeMovement');
    expect(emitted).toHaveLength(1);
    expect(result.state.units.find((unit) => unit.id === horde.id)?.position).not.toEqual(horde.position);
    expect(result.state.pendingNoisePulses).toContainEqual(expect.objectContaining({
      sourceKind: 'hordeMovement', sourceUnitType: 'hordeZombie', radius: 8, emittedTurn: 1,
    }));
    expect(result.state.statistics).toMatchObject({
      hordeMovementNoisePulses: 1,
      noisePulsesBySourceType: expect.objectContaining({ hordeZombie: 1 }),
    });
  });

  it('preserves a Veteran Wait charge and spends each remaining charge for stationed suppression', () => {
    const engine = new GameEngine(15010, quietConfig());
    const setup = engine.getState() as MutableState;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    const guard = setup.units.find((unit) => unit.type === 'nationalGuard')!;
    const farm = setup.facilities.find((facility) => facility.id === 'farm-1')!;
    police.position = { ...farm.position };
    police.proficiency = 'veteran';
    police.attack = 5;
    police.maxAttackCharges = 2;
    police.attackChargesRemaining = 2;
    police.currentMilitaryGoods = 2;
    guard.position = { q: 20, r: 20 };
    farm.workers = 15;
    farm.infected = 9;
    rebalance(setup);
    load(engine, setup);

    const waited = engine.step({ type: 'Wait', unitId: police.id });
    expect(waited.error, waited.error?.message).toBeNull();
    expect(waited.state.units.find((unit) => unit.id === police.id)).toMatchObject({
      actionState: 'acted', canMove: false, canAttack: true, attackChargesRemaining: 2,
    });
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error, result.error?.message).toBeNull();
    expect(result.events.filter((event) => event.type === 'infection_suppressed'
      && event.payload.unitId === police.id)).toHaveLength(2);
    expect(result.state.facilities.find((facility) => facility.id === farm.id)?.infected).toBe(0);
  });
});
