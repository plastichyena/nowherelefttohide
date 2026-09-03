import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createInitialState } from './state';
import { terrainAdjustedDamage, terrainDefenseAt } from './terrain';

describe('v1.4 terrain defense', () => {
  it('gives Urban defense to either side and Forest defense only to zombies', () => {
    const state = createInitialState(1, createDefaultConfig());
    const police = state.units.find((unit) => unit.type === 'police')!;
    const zombie = state.units.find((unit) => unit.type === 'zombie')!;
    police.position = { q: 4, r: 4 };
    zombie.position = { q: 4, r: 4 };
    expect(terrainDefenseAt(state, police)).toEqual({ source: 'none', multiplier: 1 });
    expect(terrainDefenseAt(state, zombie)).toEqual({ source: 'forest', multiplier: 0.5 });
    zombie.position = { q: 25, r: 20 };
    expect(terrainDefenseAt(state, zombie)).toEqual({ source: 'urban', multiplier: 0.5 });
    expect(terrainAdjustedDamage(state, zombie, 5).finalDamage).toBe(3);
    expect(terrainAdjustedDamage(state, zombie, 1).finalDamage).toBe(1);
  });

  it('applies the shared calculation to normal combat and records mitigation', () => {
    const config = createDefaultConfig();
    const snapshot = createInitialState(1, config);
    const police = snapshot.units.find((unit) => unit.type === 'police')!;
    const zombie = snapshot.units.find((unit) => unit.type === 'zombie')!;
    police.position = { q: 4, r: 3 };
    zombie.position = { q: 4, r: 4 };
    const engine = new GameEngine(1, config);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'Attack', attackerId: police.id, targetId: zombie.id });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === zombie.id)?.hp).toBe(7);
    expect(result.state.statistics.forestDefenseApplications).toBe(1);
    expect(result.events.some((event) => event.type === 'terrain_defense_applied')).toBe(true);
  });

  it('counts actual entered base terrain rather than static map composition', () => {
    const engine = new GameEngine(2, createDefaultConfig());
    expect(engine.getState().statistics.terrainEntriesByType).toEqual({ plain: 0, forest: 0, mountain: 0, water: 0 });
    const action = engine.getLegalActions().find((candidate) => candidate.type === 'Move')!;
    const result = engine.step(action);
    expect(result.error).toBeNull();
    expect(Object.values(result.state.statistics.terrainEntriesByType).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
  });
});
