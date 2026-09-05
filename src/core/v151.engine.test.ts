import { describe, expect, it } from 'vitest';
import { createDefaultConfig, validateGameConfig } from './config';
import { GameEngine } from './engine';
import { hexDistance, hexKey } from './hex';
import { generateInitialHunterPositions, generateInitialZombiePositions, initialHunterPositionsMatchSeed, isHordeSpawnReserve } from './map';
import { SeededRng } from './rng';
import { createInitialState, createUnit } from './state';
import type { GameState } from './types';
import { decodeSaveCode, encodeSaveCode } from '../persistence/save';
import { createAgentObservation } from '../agent/observation';

function quiet() {
  return createDefaultConfig({
    economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialResources: { food: 10000, civilianGoods: 10000, fuel: 10000, militaryGoods: 10000 } },
    refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
    horde: { waves: [{ turn: 100, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
  });
}

function combatFixture() {
  const engine = new GameEngine(151, quiet());
  const state = engine.getState() as GameState;
  const horde = createUnit(state, 'horde-test', 'hordeZombie', { q: 24, r: 24 });
  horde.spawnGroupId = 'periodic-test';
  horde.hordeKind = 'periodic';
  state.units.push(horde);
  return { engine, state, horde };
}
function load(engine: GameEngine, state: GameState) {
  const result = engine.step({ type: 'LoadSnapshot', snapshot: state });
  expect(result.error?.message ?? null).toBeNull();
}

describe('v1.5.1 Hunter, balance and shared Horde charges', () => {
  it('keeps all six zombie configurations separate and derives human ranks', () => {
    const state = createInitialState(1, createDefaultConfig());
    const expected = { zombie: [15, 5, 3, 1], hordeZombie: [40, 5, 3, 2], policeZombie: [10, 5, 3, 1], soldierZombie: [20, 5, 5, 1], riotZombie: [60, 5, 3, 1], hunterZombie: [20, 15, 15, 1] };
    for (const type of Object.keys(expected) as Array<keyof typeof expected>) {
      const unit = createUnit(state, type, type, { q: 20, r: 20 });
      expect([unit.hp, unit.attack, unit.movement, unit.maxAttackCharges]).toEqual(expected[type]);
    }
    for (const [type, recruit, regular] of [['police', 6, 8], ['nationalGuard', 12, 15], ['riotPolice', 9, 12]] as const) {
      expect(createUnit(state, type, type, { q: 20, r: 20 }, 'ready', 'recruit').attack).toBe(recruit);
      expect(createUnit(state, type, type, { q: 20, r: 20 }, 'ready', 'regular').attack).toBe(regular);
      expect(createUnit(state, type, type, { q: 20, r: 20 }, 'ready', 'veteran').attack).toBe(regular);
    }
  });

  it('draws Hunter count after the canonical 25 normal positions, without overlap or private leakage', () => {
    for (const seed of [1, 7, 151]) {
      const state = createInitialState(seed, createDefaultConfig());
      const rng = new SeededRng(seed);
      expect(generateInitialZombiePositions(state.map, rng)).toEqual(state.map.initialZombiePositions);
      expect(generateInitialHunterPositions(state.map, rng, state.config.economy)).toEqual(state.initialHunterPositions);
      expect(state.units.filter((unit) => unit.type === 'zombie')).toHaveLength(25);
      expect(state.initialHunterPositions.length).toBeGreaterThanOrEqual(1);
      expect(state.initialHunterPositions.length).toBeLessThanOrEqual(4);
      expect(initialHunterPositionsMatchSeed(state)).toBe(true);
      const occupied = state.units.map((unit) => hexKey(unit.position));
      expect(new Set(occupied).size).toBe(occupied.length);
      for (const hunter of state.units.filter((unit) => unit.type === 'hunterZombie')) {
        expect(hexDistance(hunter.position, { q: 25, r: 25 })).toBeGreaterThanOrEqual(20);
        expect(isHordeSpawnReserve(state.map, hunter.position)).toBe(false);
        expect(state.facilities.some((facility) => hexKey(facility.position) === hexKey(hunter.position))).toBe(false);
        expect([hunter.spawnGroupId, hunter.hordeKind]).toEqual([null, null]);
      }
      expect(JSON.stringify(createAgentObservation(state))).not.toContain('initialHunterPositions');
    }
  });

  it('rejects unavailable initial placement without reducing count or relaxing distance', () => {
    expect(() => createInitialState(1, createDefaultConfig({ economy: { initialHunterMinDistance: 100 } }))).toThrow(/Hunter.*valid candidates/);
    const state = createInitialState(1, quiet());
    const map = { ...state.map, tiles: state.map.tiles.filter((tile) => hexDistance(tile, { q: 25, r: 25 }) < 20) };
    expect(() => generateInitialHunterPositions(map, new SeededRng(1), { initialHunterCount: { min: 1, max: 1 }, initialHunterMinDistance: 20 })).toThrow();
  });

  it('rejects missing charge, count and cap fields instead of repairing old configs', () => {
    for (const mutate of [
      (config: any) => { delete config.units.hunterZombie.maxAttackCharges; },
      (config: any) => { delete config.economy.initialHunterCount; },
      (config: any) => { config.economy.initialHunterCount = { min: 4, max: 1 }; },
      (config: any) => { delete config.horde.hunterZombieCapPerDirection; },
    ]) {
      const config = createDefaultConfig(); mutate(config);
      expect(validateGameConfig(config).valid).toBe(false);
    }
  });

  it('attacks a surviving adjacent target twice and never moves after attacking', () => {
    const { engine, state, horde } = combatFixture();
    load(engine, state);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error?.message ?? null).toBeNull();
    expect(result.events.filter((event) => event.type === 'attack' && event.payload.attackerId === horde.id && !event.payload.counterattack)).toHaveLength(2);
    expect(result.events.some((event) => event.type === 'unit_moved' && event.payload.unitId === horde.id)).toBe(false);
    expect(result.state.units.find((unit) => unit.id === horde.id)?.attackChargesRemaining).toBe(2);
  });

  it('does not refill a Player-phase counterattack charge at Zombie-phase start', () => {
    const { engine, state, horde } = combatFixture();
    load(engine, state);
    const attacked = engine.step({ type: 'Attack', attackerId: 'police-1', targetId: horde.id });
    expect(attacked.error?.message ?? null).toBeNull();
    expect(attacked.state.units.find((unit) => unit.id === horde.id)?.attackChargesRemaining).toBe(1);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.events.filter((event) => event.type === 'attack' && event.payload.attackerId === horde.id && !event.payload.counterattack)).toHaveLength(1);
  });

  it('stops when the first counterattack kills the Horde', () => {
    const { engine, state, horde } = combatFixture();
    horde.hp = 1;
    load(engine, state);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error?.message ?? null).toBeNull();
    expect(result.state.units.some((unit) => unit.id === horde.id)).toBe(false);
    expect(result.events.filter((event) => event.type === 'attack' && event.payload.attackerId === horde.id)).toHaveLength(1);
  });

  it('re-evaluates a different adjacent target after its first kill', () => {
    const { engine, state, horde } = combatFixture();
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 23, r: 25 }; guard.hp = 1;
    load(engine, state);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error?.message ?? null).toBeNull();
    expect(result.events.filter((event) => event.type === 'attack' && event.payload.attackerId === horde.id && !event.payload.counterattack).map((event) => event.payload.defenderId)).toEqual([guard.id, 'police-1']);
  });

  it('round trips initial Hunter provenance and partly spent Horde charges', () => {
    const { engine, state, horde } = combatFixture();
    horde.attackChargesRemaining = 1;
    load(engine, state);
    const restored = decodeSaveCode(encodeSaveCode(state));
    expect(restored.errors).toEqual([]);
    expect(restored.state).toEqual(state);
    const other = new GameEngine(151, quiet()); load(other, restored.state!);
    expect(other.step({ type: 'EndTurn' })).toEqual(engine.step({ type: 'EndTurn' }));
    const initial = createInitialState(7, createDefaultConfig());
    expect(decodeSaveCode(encodeSaveCode(initial)).state?.initialHunterPositions).toEqual(initial.initialHunterPositions);
    initial.initialHunterPositions[0]!.q += 1;
    expect(() => encodeSaveCode(initial)).toThrow(/initial Zombie/);
  });

  it('uses the specified base 114 total and independent Riot/Hunter caps in an atomic four-direction wave', () => {
    const config = createDefaultConfig();
    expect(config.horde.waves.reduce((sum, wave) => sum + wave.directionCount * wave.compositionPerDirection.hordeZombie, 0)).toBe(41);
    expect(config.horde.waves.reduce((sum, wave) => sum + wave.directionCount * wave.compositionPerDirection.zombie, 0)).toBe(73);
    config.horde.waves = [{ ...config.horde.waves[4]!, turn: 1 }];
    config.horde.specialZombieWeights = { zombie: 1, policeZombie: 0, soldierZombie: 0, riotZombie: 100000, hunterZombie: 100000 };
    const result = new GameEngine(151, config).step({ type: 'EndTurn' });
    expect(result.error?.message ?? null).toBeNull();
    const wave = result.state.units.filter((unit) => unit.hordeKind === 'final');
    expect(wave).toHaveLength(52);
    for (const group of result.state.horde.finalSpawnGroupIds) {
      const units = wave.filter((unit) => unit.spawnGroupId === group);
      expect(units.filter((unit) => unit.type === 'riotZombie')).toHaveLength(1);
      expect(units.filter((unit) => unit.type === 'hunterZombie')).toHaveLength(1);
      expect(units.filter((unit) => unit.type !== 'hordeZombie').every((unit) => unit.maxAttackCharges === 1)).toBe(true);
    }
  });
});
