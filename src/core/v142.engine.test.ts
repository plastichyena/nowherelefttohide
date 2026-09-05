import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createUnit, populationLedgerTotal, synchronizePopulation } from './state';
import { singleFinalWave } from './testConfig';
import type { GameState } from './types';

function cloneState(state: Readonly<GameState>): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function reserveEngine(seed: number): GameEngine {
  return new GameEngine(seed, createDefaultConfig({
    horde: singleFinalWave(100),
    economy: {
      initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 },
      initialResources: { food: 10_000, civilianGoods: 10_000, militaryGoods: 10_000, fuel: 10_000 },
    },
  }));
}

function rebalance(state: GameState): void {
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state);
}

describe('v1.4.2 Horde Spawn Reserve', () => {
  it('rejects a player Move before pathfinding and preserves the complete state and RNG', () => {
    const engine = reserveEngine(14201);
    const before = engine.getState();
    const result = engine.step({ type: 'Move', unitId: 'police-1', destination: { q: 15, r: 0 } });
    expect(result.error?.code).toBe('horde_spawn_reserve');
    expect(engine.getState()).toEqual(before);
    expect(engine.getLegalActions()).not.toContainEqual({
      type: 'Move',
      unitId: 'police-1',
      destination: { q: 15, r: 0 },
    });
  });

  it('allows a Reserve Zombie to intercept and damage a player on an inner Hex', () => {
    const engine = reserveEngine(14202);
    const state = cloneState(engine.getState());
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    police.position = { q: 2, r: 15 };
    police.vision = 4;
    const zombie = createUnit(state, 'reserve-interceptor', 'zombie', { q: 0, r: 15 });
    zombie.movement = 0;
    zombie.attack = 5;
    zombie.vision = 0;
    state.units.push(zombie);
    rebalance(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();

    const result = engine.step({ type: 'Move', unitId: police.id, destination: { q: 1, r: 15 } });
    expect(result.error).toBeNull();
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'interception',
      payload: expect.objectContaining({ attackerId: zombie.id, defenderId: police.id }),
    }));
    expect(result.state.units.find((unit) => unit.id === police.id)?.hp).toBeLessThan(police.hp);
    expect(result.state.units.find((unit) => unit.id === zombie.id)?.position).toEqual({ q: 0, r: 15 });
  });

  it('allows attacks into the Reserve and counterattacks against a Reserve attacker', () => {
    const directEngine = reserveEngine(14203);
    const direct = cloneState(directEngine.getState());
    const guard = direct.units.find((unit) => unit.id === 'national-guard-1')!;
    guard.position = { q: 1, r: 15 };
    const target = createUnit(direct, 'reserve-target', 'zombie', { q: 0, r: 15 });
    target.hp = 1;
    direct.units.push(target);
    rebalance(direct);
    expect(directEngine.step({ type: 'LoadSnapshot', snapshot: direct }).error).toBeNull();
    const attack = directEngine.step({ type: 'Attack', attackerId: guard.id, targetId: target.id });
    expect(attack.error).toBeNull();
    expect(attack.state.units.some((unit) => unit.id === target.id)).toBe(false);

    const counterEngine = reserveEngine(14204);
    const counter = cloneState(counterEngine.getState());
    const defender = counter.units.find((unit) => unit.id === 'national-guard-1')!;
    defender.position = { q: 1, r: 15 };
    const attacker = createUnit(counter, 'reserve-attacker', 'zombie', { q: 0, r: 15 });
    attacker.movement = 0;
    attacker.attack = 1;
    counter.units.push(attacker);
    rebalance(counter);
    expect(counterEngine.step({ type: 'LoadSnapshot', snapshot: counter }).error).toBeNull();
    const phase = counterEngine.step({ type: 'EndTurn' });
    expect(phase.error).toBeNull();
    expect(phase.events).toContainEqual(expect.objectContaining({
      type: 'attack',
      payload: expect.objectContaining({ attackerId: defender.id, defenderId: attacker.id, counterattack: true }),
    }));
  });
});
