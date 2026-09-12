import { describe, it, expect, vi } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState, createUnit, synchronizePopulation, createCityPopulationSnapshot } from './state';
import { GameEngine } from './engine';
import { createMovement } from './movement';
import { createMovementCostResolver, effectiveMovementCost } from './terrain';
import { findShortestPath } from './path';
import { hexKey } from './hex';
import { wireAt, wireRoutePenalty, damageWire, radialConflict, wireBuildReason, wireCandidates } from './barbed-wire';
import { createUnitLifecycle } from './unit-lifecycle';
import { SeededRng } from './rng';
import type { GameState, UnitType } from './types';
import spacing from '../testing/fixtures/v156-spacing.json';
import { validateInvariants } from './invariants';

const fresh = () => createInitialState(1, createDefaultConfig());
const movement = (overrides = {}) => createMovement({ interceptorsAt: () => [], interceptArmyBase: () => false, resolveCombat: () => {}, tryCapture: () => {}, ...overrides });
const addWall = (s: GameState, p = { q: 26, r: 24 }, hp = 10) => s.barbedWire.push({ id: `wall-${s.barbedWire.length}`, position: p, hp, maxHp: 20, builtTurn: 1 });

describe('v1.5.6 obstacle boundaries', () => {
  it('preserves lethal Gas reanimation without damaging the wire, and clears the spawn exception on exit', () => {
    const s = fresh(); const human = s.units.find(u => u.isPlayerUnit)!;
    human.position = wireCandidates(s).find(c => c.legal)!.position;
    const position = { ...human.position }; addWall(s, position);
    const lifecycle = createUnitLifecycle({ applyGeneratedZombieOccupancy: () => {}, processSpawnOccupancyQueue: () => {}, applyGasExplosionSiteInfection: () => 0, resolveGasExplosionSiteFalls: () => {} });
    lifecycle.dealDamage(s, human, human.hp + 100, 'gas', 'gas_explosion', SeededRng.fromState(s.rngState));
    synchronizePopulation(s);
    const zombie = s.units.find(u => !u.isPlayerUnit && hexKey(u.position) === hexKey(position))!;
    expect(zombie.reanimatedOnBarbedWireId).toBe(s.barbedWire[0].id);
    expect(s.barbedWire[0].hp).toBe(10);
    expect(validateInvariants(s).errors).toEqual([]);
    s.units = [zombie]; zombie.canAttack = false; zombie.attackChargesRemaining = 0;
    const exit = { q: position.q + 1, r: position.r };
    movement().applyMovement(s, zombie, [position, exit], 5);
    expect(zombie.position).toEqual(exit); expect(zombie.reanimatedOnBarbedWireId).toBeUndefined();
    movement().applyMovement(s, zombie, [exit, position], 5);
    expect(zombie.position).toEqual(exit);
  });
  it.each(spacing)('uses the displayed spacing fixture: $name', ({ capital, a, b, conflict }) => {
    expect(radialConflict(capital, a, b)).toBe(conflict);
    expect(radialConflict(capital, b, a)).toBe(conflict);
  });

  it.each(['zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie', 'gasZombie'] as UnitType[])('%s spends actual charges and attack damage on an empty wall', type => {
    const s = fresh();
    const z = createUnit(s, 'enemy', type, { q: 25, r: 24 }); s.units = [z];
    addWall(s);
    const charges = z.attackChargesRemaining;
    const attacks = Math.min(charges, Math.ceil(10 / z.attack));
    movement().applyMovement(s, z, [z.position, { q: 26, r: 24 }], 0);
    expect(z.attackChargesRemaining).toBe(charges - attacks);
    expect(wireAt(s, { q: 26, r: 24 })?.hp ?? 0).toBe(Math.max(0, 10 - attacks * z.attack));
    expect(z.position).toEqual({ q: 25, r: 24 }); // Destruction does not teleport with MP0.
    expect(s.events.some(e => e.type === 'noise_emitted')).toBe(false);
  });

  it.each(['plain', 'forest', 'mountain'] as const)('requires entry MP5 on %s and preserves one-Hex fuel and exit costs', terrain => {
    const s = fresh(); const end = { q: 26, r: 24 }; const start = { q: 25, r: 24 };
    const tile = s.map.tiles.find(t => t.q === end.q && t.r === end.r)!; tile.terrain = terrain;
    const human = s.units.find(u => u.isPlayerUnit)!; human.position = start; s.units = [human]; addWall(s, end);
    const fuel = human.currentFuel;
    movement().applyMovement(s, human, [start, end], 4);
    expect(human.position).toEqual(start); expect(human.currentFuel).toBe(fuel);
    movement().applyMovement(s, human, [start, end], 5);
    expect(human.position).toEqual(end); expect(human.currentFuel).toBe(fuel - 1);
    const exitCost = effectiveMovementCost(s, start)!;
    movement().applyMovement(s, human, [end, start], exitCost);
    expect(human.position).toEqual(start);
    human.position = start; human.currentFuel = 0;
    movement().applyMovement(s, human, [start, end], 4, 'emergency');
    expect(human.position).toEqual(start);
  });

  it('allows detours, breaches a complete line, and immediately reprices paths after destruction', () => {
    const s = fresh(); const start = { q: 25, r: 24 }; const end = { q: 27, r: 24 };
    const z = createUnit(s, 'enemy', 'zombie', start); s.units = [z]; addWall(s);
    const terrain = createMovementCostResolver(s);
    const cost = (p: typeof start) => { const base = terrain(p); return base === null ? null : base + wireRoutePenalty(s, z, p); };
    const detour = findShortestPath(s.map, start, end, new Set(), cost)!;
    expect(detour.some(p => hexKey(p) === '26,24')).toBe(false);
    const allowed = new Set(['25,24', '26,24', '27,24']);
    const blocked = new Set(s.map.tiles.map(hexKey).filter(key => !allowed.has(key)));
    const breach = findShortestPath(s.map, start, end, blocked, cost)!;
    expect(breach).toHaveLength(3);
    damageWire(s, { q: 26, r: 24 }, 10);
    expect(findShortestPath(s.map, start, end, new Set(), cost)).toHaveLength(3);
  });

  it('preserves spent MP, stops for base interception after a breach, and blocks following Zombies on a survivor', () => {
    const s = fresh(); const start = { q: 24, r: 24 }; const middle = { q: 25, r: 24 }; const end = { q: 26, r: 24 };
    const z = createUnit(s, 'enemy', 'hordeZombie', start); s.units = [z]; addWall(s, end, 1);
    const budget = effectiveMovementCost(s, middle, false)!;
    movement().applyMovement(s, z, [start, middle, end], budget);
    expect(s.barbedWire).toHaveLength(0); expect(z.position).toEqual(middle);
    const intercept = vi.fn(() => true);
    movement({ interceptArmyBase: intercept }).applyMovement(s, z, [middle, end, { q: 27, r: 24 }], 20);
    expect(z.position).toEqual(end); expect(intercept).toHaveBeenCalledTimes(1);
    const follower = createUnit(s, 'follower', 'zombie', middle); s.units.push(follower);
    movement().applyMovement(s, follower, [middle, end], 20);
    expect(follower.position).toEqual(middle);
  });

  it.each(['attack', 'counterattack', 'interception'])('absorbs %s without a minimum Human damage and allows lethal penetration', cause => {
    const s = fresh(); const human = s.units.find(u => u.isPlayerUnit)!; human.position = { q: 26, r: 24 };
    addWall(s, human.position, 5); const hp = human.hp;
    const lifecycle = createUnitLifecycle({ applyGeneratedZombieOccupancy: () => {}, processSpawnOccupancyQueue: () => {}, applyGasExplosionSiteInfection: () => 0, resolveGasExplosionSiteFalls: () => {} });
    lifecycle.dealDamage(s, human, 5, 'enemy', cause, SeededRng.fromState(s.rngState));
    expect(human.hp).toBe(hp); expect(s.barbedWire).toHaveLength(0);
    addWall(s, human.position, 1);
    lifecycle.dealDamage(s, human, hp + 50, 'enemy', cause, SeededRng.fromState(s.rngState));
    expect(s.units.some(u => u.id === human.id)).toBe(false);
    expect(s.barbedWire).toHaveLength(0);
  });

  it('rejects facilities on walls and rebuilding beside an enemy without mutating state', () => {
    const e = new GameEngine(1, createDefaultConfig()); const c = wireCandidates(e.getState()).find(c => c.legal)!;
    expect(e.step({ type: 'BuildBarbedWire', position: c.position }).error).toBeNull();
    const before = e.getState();
    expect(e.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: c.position }).error).not.toBeNull();
    expect(e.getState()).toEqual(before);
    const s = fresh(); const candidate = wireCandidates(s).find(c => c.legal)!;
    const zombie = createUnit(s, 'enemy', 'zombie', { q: candidate.position.q + 1, r: candidate.position.r });
    s.units.push(zombie); expect(wireBuildReason(s, candidate.position)).toBe('enemy_adjacent');
  });

  it('retains ordinary counterattacks and Human combat noise when a wall takes all counter damage', () => {
    const e = new GameEngine(1, createDefaultConfig()); const s = e.getState() as GameState;
    const human = s.units.find(u => u.type === 'police')!; human.position = wireCandidates(s).find(c => c.legal)!.position;
    s.units = s.units.filter(u => u.isPlayerUnit);
    const z = createUnit(s, 'test-zombie', 'riotZombie', { q: human.position.q + 1, r: human.position.r }); s.units.push(z); addWall(s, human.position);
    synchronizePopulation(s); createCityPopulationSnapshot(s);
    expect(e.step({ type: 'LoadSnapshot', snapshot: s }).error?.message ?? null).toBeNull();
    const result = e.step({ type: 'Attack', attackerId: human.id, targetId: z.id });
    expect(result.error).toBeNull();
    expect(result.events.some(event => event.type === 'attack' && event.payload.counterattack === true)).toBe(true);
    expect(result.events.some(event => event.type === 'noise_emitted')).toBe(true);
    expect(result.state.units.find(u => u.id === human.id)?.attackChargesRemaining).toBe(human.attackChargesRemaining - 1);
    expect(result.state.barbedWire[0]?.hp ?? 0).toBe(Math.max(0, 10 - z.attack));
  });
});
