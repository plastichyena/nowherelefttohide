import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { allocateUnitId, createInitialState, createUnit } from './state';
import { getBlockingZombiesForCheckpoint } from './supply';
import { calculateEconomyPlan } from './economy-query';
import { createUnitLifecycle } from './unit-lifecycle';
import { SeededRng } from './rng';
import { prepareTestSnapshot } from './testConfig';
import { decodeSaveCode, encodeSaveCode } from '../persistence/save';

describe('v1.6.6 Core regressions', () => {
  it('starts the lifetime allocator above every initial ID, including dead zombie-8', () => {
    const state = createInitialState(3, createDefaultConfig());
    const issued = new Set(state.units.map(u => u.id));
    const rngBefore = structuredClone(state.rngState);
    state.units = state.units.filter(u => u.id !== 'zombie-8');
    for (let i = 0; i < 1001; i++) {
      const id = allocateUnitId(state, ['zombie','horde','police-zombie','soldier-zombie','pack-zombie','special-forces'][i % 6]!);
      expect(issued.has(id), id).toBe(false);
      issued.add(id);
    }
    expect(state.rngState).toEqual(rngBefore);
  });

  it('excludes the fixed initial supply from candidate branch blockers', () => {
    const state = createInitialState(3, createDefaultConfig());
    state.units = [createUnit(state, 'near-zombie', 'zombie', { q: 25, r: 23 }),
      createUnit(state, 'outer-zombie', 'zombie', { q: 25, r: 18 })];
    expect(getBlockingZombiesForCheckpoint(state, 'north', { q: 25, r: 17 }).map(u => u.id))
      .toEqual(['outer-zombie']);
  });

  it('does not consume fixed ammunition even with a config override', () => {
    const state = createInitialState(3, createDefaultConfig());
    state.config.units.police.fixedMilitaryGoodsUpkeepPerTurn = 9;
    for (const unit of calculateEconomyPlan(state).forecast.militaryGoods.units) {
      expect(unit.fixedConsumption).toBe(0);
      expect(unit.afterFixed).toBe(unit.beforeFixed);
    }
  });

  it('preserves lifetime IDs through mixed births, deaths, real reanimation and Save/Load', () => {
    let state = createInitialState(3, createDefaultConfig());
    const ids = new Set(state.units.map(u => u.id));
    const lifecycle = createUnitLifecycle({ applyGeneratedZombieOccupancy: () => {}, processSpawnOccupancyQueue: () => {}, applyGasExplosionSiteInfection: () => 0, resolveGasExplosionSiteFalls: () => {} });
    const rng = SeededRng.fromState(state.rngState);
    const rngBefore = structuredClone(state.rngState);
    for (let i = 0; i < 1001; i++) {
      const human = i % 100 === 0;
      const type = human ? 'police' : i % 2 === 0 ? 'zombie' : 'hordeZombie';
      const id = allocateUnitId(state, human ? 'police' : type === 'zombie' ? 'zombie' : 'horde');
      expect(ids.has(id)).toBe(false); ids.add(id);
      const unit = createUnit(state, id, type, { q: 20, r: 25 }); state.units.push(unit);
      lifecycle.dealDamage(state, unit, 10000, 'test', 'attack', rng);
      const reanimated = state.events.at(-1)?.type === 'human_unit_reanimated' ? state.events.at(-1)!.payload.zombieUnitId : null;
      if (human) { expect(typeof reanimated).toBe('string'); expect(ids.has(reanimated as string)).toBe(false); ids.add(reanimated as string); }
      if (i === 500) {
        prepareTestSnapshot(state, true);
        const saved = decodeSaveCode(encodeSaveCode(state)); expect(saved.errors).toEqual([]); expect(saved.valid).toBe(true); state = saved.state!;
      }
    }
    expect(state.rngState).toEqual(rngBefore);
    prepareTestSnapshot(state, true);
    expect(decodeSaveCode(encodeSaveCode(state)).valid).toBe(true);
    state.nextUnitNumber = 8;
    expect(() => encodeSaveCode(state)).toThrow('cannot rewind');
  }, 120000);
});
