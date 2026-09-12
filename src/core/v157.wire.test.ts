import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState, createUnit } from './state';
import { damageWire, recordWireAttackCharge, wireBreakCost, wireCandidates } from './barbed-wire';
import { createUnitLifecycle } from './unit-lifecycle';
import { SeededRng } from './rng';
import { GameEngine } from './engine';
import { createMovement } from './movement';
import { decodeSaveCode, encodeSaveCode } from '../persistence/save';

describe('v1.5.7 wall and charge accounting', () => {
  it.each([5, 20, 25])('absorbs damage %i into a fresh HP20 wall, with no minimum damage at zero penetration', damage => {
    const state = createInitialState(1, createDefaultConfig());
    const human = state.units.find(u => u.isPlayerUnit)!;
    const tile = state.map.tiles.find(t => t.q === human.position.q && t.r === human.position.r)!;
    tile.terrain = 'plain';
    state.facilities = state.facilities.filter(f => f.position.q !== human.position.q || f.position.r !== human.position.r);
    state.barbedWire.push({ id: 'wall', position: { ...human.position }, hp: 20, maxHp: 20, builtTurn: 1 });
    const hp = human.hp;
    const lifecycle = createUnitLifecycle({ applyGeneratedZombieOccupancy: () => {}, processSpawnOccupancyQueue: () => {}, applyGasExplosionSiteInfection: () => 0, resolveGasExplosionSiteFalls: () => {} });
    lifecycle.dealDamage(state, human, damage, 'enemy', 'attack', SeededRng.fromState(state.rngState));
    expect(human.hp).toBe(hp - Math.max(0, damage - 20));
    expect(state.statistics.barbedWireDamageTaken).toBe(Math.min(20, damage));
    expect(state.statistics.barbedWireAbsorbedDamage).toBe(Math.min(20, damage));
    expect(state.statistics.barbedWireDestroyed).toBe(damage >= 20 ? 1 : 0);
    damageWire(state, human.position, 100);
    damageWire(state, human.position, 100);
    expect(state.statistics.barbedWireDestroyed).toBe(1);
    expect(state.events.filter(e => e.type === 'barbed_wire_damaged').map(e => e.payload.hp)).toEqual(damage < 20 ? [20 - damage, 0] : [0]);
  });

  it('uses four ordinary Horde charges to breach HP20 and still move; damaged walls count actual HP loss', () => {
    const state = createInitialState(1, createDefaultConfig());
    const destination = wireCandidates(state).find(c => c.legal)!.position;
    const start = { q: destination.q - 1, r: destination.r };
    const zombie = createUnit(state, 'horde', 'hordeZombie', start);
    state.units.push(zombie);
    state.barbedWire.push({ id: 'wall', position: destination, hp: 20, maxHp: 20, builtTurn: 1 });
    const movement = createMovement({ interceptorsAt: () => [], interceptArmyBase: () => false, resolveCombat: () => {}, tryCapture: () => {} });
    expect(zombie.maxAttackCharges).toBe(4);
    expect(wireBreakCost(20, zombie)).toBe(4);
    movement.applyMovement(state, zombie, [start, destination], 20);
    expect(zombie.position).toEqual(destination);
    expect(zombie.attackChargesRemaining).toBe(0);
    expect(state.statistics.barbedWireEmptyAttackCharges).toBe(4);
    expect(state.events.filter(e => e.type === 'barbed_wire_damaged').map(e => e.payload.hp)).toEqual([15, 10, 5, 0]);
    expect(state.statistics.barbedWireDamageTaken).toBe(20);
    expect(state.statistics.barbedWireAbsorbedDamage).toBe(0);
    expect(state.statistics.barbedWireDestroyed).toBe(1);
    state.barbedWire.push({ id: 'damaged', position: destination, hp: 3, maxHp: 20, builtTurn: 1 });
    expect(damageWire(state, destination, 5)).toBe(3);
    expect(state.statistics.barbedWireDamageTaken).toBe(23);
  });

  it('counts occupied attack charges once at the actual attack, excluding gas and subsequent attacks after destruction', () => {
    const state = createInitialState(1, createDefaultConfig());
    const human = state.units.find(u => u.isPlayerUnit)!;
    const enemy = createUnit(state, 'horde', 'hordeZombie', { q: human.position.q + 1, r: human.position.r });
    state.barbedWire.push({ id: 'wall', position: { ...human.position }, hp: 20, maxHp: 20, builtTurn: 1 });
    recordWireAttackCharge(state, enemy, human);
    damageWire(state, human.position, 25, true);
    recordWireAttackCharge(state, enemy, human);
    expect(state.statistics.barbedWireOccupiedAttackCharges).toBe(1);
    expect(state.statistics.barbedWireDamageTaken).toBe(20);
    expect(state.statistics.barbedWireAbsorbedDamage).toBe(20);
    expect(state.statistics.barbedWireEmptyAttackCharges).toBe(0);
  });

  it('persists construction statistics and does not count a rejected build or Query', () => {
    const engine = new GameEngine(1, createDefaultConfig());
    const position = wireCandidates(engine.getState()).find(c => c.legal)!.position;
    const action = { type: 'BuildBarbedWire' as const, position };
    expect(engine.step(action).error).toBeNull();
    expect(engine.getState().statistics.barbedWireBuilt).toBe(1);
    expect(engine.step(action).error).not.toBeNull();
    wireCandidates(engine.getState());
    const saved = decodeSaveCode(encodeSaveCode(engine.getState()));
    expect(saved.valid).toBe(true);
    expect(saved.state!.statistics.barbedWireBuilt).toBe(1);
    expect(saved.state!.barbedWire[0]).toMatchObject({ hp: 20, maxHp: 20 });
  });

  it('uses the actual Engine combat path for four occupied-wall attacks and no fifth attack', () => {
    const engine = new GameEngine(1, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 } } }));
    const state = engine.getState();
    const human = state.units.find(u => u.type === 'police')!;
    human.position = { q: 25, r: 24 }; human.canAttack = false; human.attackChargesRemaining = 0;
    const enemy = createUnit(state, 'wire-horde', 'hordeZombie', { q: 24, r: 24 });
    enemy.hordeKind = 'periodic'; enemy.spawnGroupId = 'wire-wave';
    state.units.push(enemy);
    state.barbedWire.push({ id: 'occupied-wall', position: { ...human.position }, hp: 20, maxHp: 20, builtTurn: 1 });
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.events.filter(e => e.type === 'attack' && e.payload.attackerId === enemy.id)).toHaveLength(4);
    expect(result.state.statistics.barbedWireOccupiedAttackCharges).toBe(4);
    expect(result.state.statistics.barbedWireDamageTaken).toBe(20);
    expect(result.state.statistics.barbedWireAbsorbedDamage).toBe(20);
    expect(result.state.statistics.barbedWireDestroyed).toBe(1);
    expect(decodeSaveCode(encodeSaveCode(result.state)).valid).toBe(true);
  });

  it('does not expose damage or consumed charges from a wall outside public vision', () => {
    const state = createInitialState(1, createDefaultConfig());
    const position = { q: 0, r: 0 };
    state.barbedWire.push({ id: 'unobserved-wall', position, hp: 20, maxHp: 20, builtTurn: 1 });
    const statistics = structuredClone(state.statistics);
    const events = state.events.length;
    expect(damageWire(state, position, 20)).toBe(20);
    expect(state.barbedWire).toHaveLength(0);
    expect(state.statistics).toEqual(statistics);
    expect(state.events).toHaveLength(events);
  });
});
