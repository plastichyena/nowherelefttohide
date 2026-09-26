import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState, createUnit, synchronizePopulation } from './state';
import { GameEngine } from './engine';
import { prepareTestSnapshot, singleFinalWave } from './testConfig';
import { calculateEconomyPlan } from './economy-query';
import { HUMAN_UNIT_TYPES, ZOMBIE_UNIT_TYPES } from './unit-catalog';
import { effectiveZombieMovement, updateZombiePursuit } from './zombie-movement';
import { getPlayerVisibleTileKeys } from './visibility';
import { createPublicUnitProjection } from './public-entities';
import { wireRoutePenalty, wireBreakCost } from './barbed-wire';
import { hexDistance } from './hex';
import { decodeSaveCode, encodeSaveCode, exportSaveJson, importSaveJson } from '../persistence/save';
import type { GameState } from './types';

const quiet = () => createDefaultConfig({ economy: { initialZombieCount: 0, initialScreamerCount: 0,
  initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 },
  initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } },
  refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 }, horde: singleFinalWave(99) });
function load(engine: GameEngine, state: GameState) {
  prepareTestSnapshot(state); const result = engine.step({ type: 'LoadSnapshot', snapshot: state });
  expect(result.error, result.error?.message).toBeNull();
}

describe('v1.6.7 economy', () => {
  it.each(HUMAN_UNIT_TYPES)('charges %s population twice, independently of supply/activity', type => {
    const state = createInitialState(4, quiet());
    state.units = [createUnit(state, 'food-unit', type, { q: 3, r: 3 })];
    const unit = state.units[0]!; unit.canMove = false; unit.canAttack = false;
    synchronizePopulation(state);
    const plan = calculateEconomyPlan(state).forecast;
    const civilians = state.facilities.filter(f => f.owner === 'player').reduce((n, f) => n + f.workers, 0)
      + state.checkpoints.reduce((n, c) => n + c.waiting + c.screening + c.approved, 0);
    expect(plan.populationConsumers).toBe(civilians + unit.population);
    expect(plan.maintenanceBreakdown.food).toMatchObject({ civilians, military: unit.population * 2, base: civilians + unit.population * 2 });
    expect(plan.maintenanceBreakdown.civilianGoods.base).toBe(civilians + unit.population);
  });
  it('counts transported infantry once, independently of helicopter crew and flight', () => {
    const state = createInitialState(4, quiet());
    const helicopter = createUnit(state, 'carrier', 'multipurposeHelicopter', { q: 3, r: 3 });
    const infantry = createUnit(state, 'cargo', 'nationalGuard', helicopter.position);
    helicopter.cargoUnitId = infantry.id; infantry.transportedByUnitId = helicopter.id;
    state.units = [helicopter, infantry]; synchronizePopulation(state);
    for (const flightState of ['landed', 'airborne'] as const) {
      helicopter.flightState = flightState;
      expect(calculateEconomyPlan(state).forecast.maintenanceBreakdown.food.military).toBe(2 * (infantry.population + helicopter.population));
    }
  });
  it('reserves Food through conscription, placement and unit death without changing headcount', () => {
    const engine = new GameEngine(4, quiet());
    const before = calculateEconomyPlan(engine.getState()).forecast;
    const action = engine.getLegalActions().find(a => a.type === 'ProduceUnit' && a.unitType === 'nationalGuard')!;
    expect(action).toBeDefined(); expect(engine.step(action).error).toBeNull();
    const reserved = engine.getState(); const during = calculateEconomyPlan(reserved).forecast;
    const population = reserved.config.units.nationalGuard.population;
    expect(during.populationConsumers).toBe(before.populationConsumers);
    expect(during.maintenanceBreakdown.food.base).toBe(before.maintenanceBreakdown.food.base + population);
    expect(reserved.pendingUnitProductions).toHaveLength(1);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().pendingUnitProductions).toHaveLength(0);
    expect(engine.getState().population.unitPopulation).toBe(reserved.population.unitPopulation);
    const state = structuredClone(engine.getState()) as GameState;
    const unit = state.units.find(u => !reserved.units.some(old => old.id === u.id))!;
    const militaryBefore = calculateEconomyPlan(state).forecast.maintenanceBreakdown.food.military;
    state.units = state.units.filter(u => u.id !== unit.id); synchronizePopulation(state);
    expect(calculateEconomyPlan(state).forecast.maintenanceBreakdown.food.military).toBe(militaryBefore - 2 * unit.population);
  });
  it.each([0, 1, 10])('produces 3 MG per operating worker for %i workers and matches settlement', workers => {
    const engine = new GameEngine(4, quiet()); const state = engine.getState() as GameState;
    const factory = state.facilities.find(f => f.id === 'military-factory-1')!;
    factory.workers = workers; factory.powerSupplyEnabled = true; factory.operationalStatus = 'operational'; state.facilities.find(f => f.type === 'powerPlant')!.workers = 20;
    load(engine, state);
    const plan = calculateEconomyPlan(engine.getState());
    expect(plan.facilities.find(p => p.facilityId === factory.id)!.outputs.militaryGoods ?? 0).toBe(3 * workers);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().resources.food).toBe(plan.forecast.food.endingStock);
    expect(engine.getState().resources.militaryGoods).toBe(plan.forecast.militaryGoods.projectedEndingStock);
  });
  it.each([[9, 0], [10, 1], [19, 1], [20, 2]])('allocates opening CG %i to %i workers after maintenance reservation', (stock, workers) => {
    const state = createInitialState(4, quiet());
    state.config.economy.populationConsumption.civilianGoods = 0;
    state.resources.civilianGoods = stock;
    state.facilities.find(f => f.type === 'powerPlant')!.workers = 20;
    const factory = state.facilities.find(f => f.id === 'military-factory-1')!; factory.workers = 10; factory.powerSupplyEnabled = true; factory.operationalStatus = 'operational';
    const p = calculateEconomyPlan(state).facilities.find(p => p.facilityId === factory.id)!;
    expect(p.operatingWorkers).toBe(workers); expect(p.outputs.militaryGoods ?? 0).toBe(workers * 3);
  });
});

describe('v1.6.7 zombie pursuit', () => {
  it('spends base MP then base+3 on actual consecutive road movement', () => {
    const engine = new GameEngine(4, quiet()); const state = engine.getState() as GameState;
    const unit = createUnit(state, 'road-pursuer', 'hordeZombie', { q: 25, r: 8 });
    unit.vision = 0; unit.spawnGroupId = 'road-test'; unit.hordeKind = 'periodic';
    state.units.push(unit); load(engine, state);
    let position = unit.position;
    for (const budget of [3, 6]) {
      expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
      const moved = engine.getState().units.find(u => u.id === unit.id)!;
      expect(hexDistance(position, moved.position)).toBe(budget);
      expect(moved.movement).toBe(3);
      position = moved.position;
    }
  });
  it.each(ZOMBIE_UNIT_TYPES)('%s delays, preserves, clears and reacquires without stacking', type => {
    const state = createInitialState(4, quiet()); const u = createUnit(state, 'test', type, { q: 3, r: 3 });
    const base = u.movement, rng = structuredClone(state.rngState);
    for (const [reason, bonus] of [['visible_population', 0], ['inherited_horde', 3], ['wave_capital', 3], ['capital', 3], ['noise', 0], ['visible_population', 0], ['capital', 3], ['idle', 0], ['capital', 0]] as const) {
      updateZombiePursuit(u, reason, 3); expect(u.movement).toBe(base); expect(effectiveZombieMovement(u)).toBe(base + bonus);
    }
    expect(state.rngState).toEqual(rng);
  });
  it.each(ZOMBIE_UNIT_TYPES)('%s uses the real phase snapshot and survives Save/Load during waiting and acceleration', type => {
    const engine = new GameEngine(4, quiet()); const state = engine.getState() as GameState;
    const u = createUnit(state, 'pursuer', type, { q: 4, r: 4 });
    u.vision = 0; u.spawnGroupId = 'pursuit-test'; u.hordeKind = 'periodic';
    if (type !== 'hordeZombie') u.waveCapitalAnchor = { q: 25, r: 25 };
    state.units.push(u); load(engine, state);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    for (const expected of [0, 3, 3]) {
      const current = engine.getState().units.find(x => x.id === u.id)!;
      expect(current.pursuitTargetLastPhase).toBe(true); expect(current.pursuitMovementBonus).toBe(expected);
      const saved = decodeSaveCode(encodeSaveCode(engine.getState())); expect(saved.valid, saved.errors.join(',')).toBe(true);
      const restored = new GameEngine(4, quiet()); expect(restored.step({ type: 'LoadSnapshot', snapshot: saved.state! }).error).toBeNull();
      const a = engine.step({ type: 'EndTurn' }), b = restored.step({ type: 'EndTurn' });
      expect(a.error).toBeNull(); expect(b.state).toEqual(a.state);
    }
  }, 30000);
  it('does not start the delay before a new zombie becomes action eligible', () => {
    const engine = new GameEngine(4, quiet()); const state = engine.getState() as GameState;
    const u = createUnit(state, 'pending', 'hordeZombie', { q: 4, r: 4 }); u.spawnGroupId = 'pending-test'; u.hordeKind = 'periodic'; u.firstZombieActionTurn = 2;
    state.units.push(u); load(engine, state);
    for (const [memory, bonus] of [[false, 0], [true, 0], [true, 3]] as const) {
      expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
      expect(engine.getState().units.find(x => x.id === u.id)).toMatchObject({ pursuitTargetLastPhase: memory, pursuitMovementBonus: bonus });
    }
  });
  it.each(['noise', 'idle'] as const)('clears pursuit in a real %s phase, saves the cleared state, and delays reacquisition', reason => {
    const engine = new GameEngine(4, quiet()); const state = engine.getState() as GameState;
    const unit = createUnit(state, 'reset-pursuer', 'zombie', { q: 4, r: 4 });
    unit.vision = 0; unit.pursuitTargetLastPhase = true; unit.pursuitMovementBonus = 3;
    unit.noiseTarget = reason === 'noise' ? { q: 4, r: 20 } : null;
    state.units.push(unit); load(engine, state);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.find(u => u.id === unit.id)).toMatchObject({ pursuitTargetLastPhase: false, pursuitMovementBonus: 0 });
    const saved = decodeSaveCode(encodeSaveCode(engine.getState())); expect(saved.valid).toBe(true);
    const restored = new GameEngine(4, quiet()); load(restored, saved.state!);
    expect(restored.step({ type: 'EndTurn' }).state).toEqual(engine.step({ type: 'EndTurn' }).state);
    const reacquired = engine.getState() as GameState;
    reacquired.units.find(u => u.id === unit.id)!.inheritedTarget = { q: 25, r: 25 };
    load(engine, reacquired);
    for (const bonus of [0, 3]) {
      expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
      expect(engine.getState().units.find(u => u.id === unit.id)).toMatchObject({ pursuitTargetLastPhase: true, pursuitMovementBonus: bonus });
    }
  });
  it('uses effective MP in wall route cost without changing base stats', () => {
    const state = createInitialState(4, quiet()); const u = createUnit(state, 'wire-test', 'zombie', { q: 4, r: 4 });
    state.barbedWire.push({ id: 'wire-test', position: { q: 5, r: 4 }, hp: 50, maxHp: 50, builtTurn: 1 });
    const base = wireRoutePenalty(state, u, { q: 5, r: 4 }); updateZombiePursuit(u, 'capital', 3); updateZombiePursuit(u, 'capital', 3);
    expect(wireRoutePenalty(state, u, { q: 5, r: 4 })).toBe(wireBreakCost(50, { ...u, movement: u.movement + 3 }));
    expect(wireRoutePenalty(state, u, { q: 5, r: 4 })).toBeGreaterThan(base);
  });
  it('rejects earlier saves non-destructively and rejects corrupted continuity', () => {
    const state = createInitialState(4, quiet()); const serialized = JSON.parse(exportSaveJson(state));
    serialized.formatVersion = 23;
    const old = JSON.stringify(serialized); expect(importSaveJson(old).valid).toBe(false); expect(JSON.stringify(serialized)).toBe(old);
    state.units[0]!.pursuitMovementBonus = 3;
    expect(() => encodeSaveCode(state)).toThrow();
  });
});

it('configures the five direction-wise rounded variant counts once', () => {
  const config = createDefaultConfig();
  expect(config.horde.waves.map(w => w.compositionPerDirection)).toEqual([
    { hordeZombie: 5, zombie: 5 }, { hordeZombie: 3, zombie: 8 }, { hordeZombie: 8, zombie: 11 }, { hordeZombie: 5, zombie: 11 }, { hordeZombie: 8, zombie: 12 },
  ]);
  expect(config.horde.waves.reduce((n, w) => n + w.directionCount * (w.compositionPerDirection.hordeZombie + w.compositionPerDirection.zombie), 0)).toBe(179);
  expect(createDefaultConfig(config).horde.waves).toEqual(config.horde.waves);
});
