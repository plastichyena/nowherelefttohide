import { describe, expect, it } from 'vitest';
import { GameEngine, validateAction } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { calculateEconomyPlan, forecastEndTurn } from './economy-query';
import { getPlayerVisionCoverage } from './visibility';
import { withReadOnlyQueryScope } from './query-cache';
import type { GameState } from './types';

const config = () => createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } });

describe('v1.5.2 committed query isolation', () => {
  it('shares public entity projections without exposing hidden enemies or mutable references', () => {
    const engine = new GameEngine(1);
    const query = engine.getQuery();
    const state = engine.getState();
    const unit = state.units.find(unit => unit.isPlayerUnit)!;
    const hidden = state.units.find(unit => !unit.isPlayerUnit && !query.getVisibleTileKeys().has(`${unit.position.q},${unit.position.r}`))!;
    expect(query.getPublicUnitProjection(hidden.id)).toBeUndefined();
    const first = query.getPublicUnitProjection(unit.id)!;
    first.hp = -1;
    expect(query.getPublicUnitProjection(unit.id)!.hp).toBe(unit.hp);
    const facility = state.facilities[0]!;
    const projection = query.getPublicFacilityProjection(facility.id)!;
    projection.id = 'changed';
    expect(query.getPublicFacilityProjection(facility.id)!.id).toBe(facility.id);
    engine.step({ type: 'EndTurn' });
    expect(() => query.getPublicUnitProjection(unit.id)).toThrow('expired');
  });
  it('detaches fresh and cached vision/economy projections without caching a mutable candidate', () => {
    const state = new GameEngine(152, config()).getState() as GameState;
    const before = structuredClone(state);
    const expectedVision = getPlayerVisionCoverage(state);
    const expectedEconomy = calculateEconomyPlan(state);
    const modifyAndRequery = () => {
      const vision = getPlayerVisionCoverage(state);
      vision.visible.clear(); vision.groundVisible.clear(); vision.groundPotential.clear();
      const economy = calculateEconomyPlan(state);
      economy.facilities.length = 0;
      economy.forecast.food.projectedProduction = -999;
      economy.forecast.militaryGoods.units.length = 0;
      expect(getPlayerVisionCoverage(state)).toEqual(expectedVision);
      expect(calculateEconomyPlan(state)).toEqual(expectedEconomy);
    };
    modifyAndRequery();
    withReadOnlyQueryScope(state, modifyAndRequery);
    expect(state).toEqual(before);
    state.facilities.find(f => f.id === 'farm-1')!.powerSupplyEnabled = false;
    expect(calculateEconomyPlan(state).forecast.food.projectedProduction).toBeLessThan(expectedEconomy.forecast.food.projectedProduction);
    state.units[0]!.position = { q: 0, r: 0 };
    expect(getPlayerVisionCoverage(state).visible).not.toEqual(expectedVision.visible);
  });

  it.each([
    ['Action', false], ['Action', true], ['Load', false], ['Load', true],
    ['reset', false], ['reset', true], ['StartNewGame', false], ['StartNewGame', true],
  ] as const)('expires every old provider after %s, including cached providers (warm=%s)', (operation, warm) => {
    const engine = new GameEngine(152, config());
    const old = engine.getQuery();
    if (warm) { old.getLegalActions(); old.getEndTurnForecast(); old.getVision(); }
    if (operation === 'Action') expect(engine.step({ type: 'Wait', unitId: 'police-1' }).error).toBeNull();
    else if (operation === 'Load') expect(engine.step({ type: 'LoadSnapshot', snapshot: engine.getState() as GameState }).error).toBeNull();
    else if (operation === 'StartNewGame') expect(engine.step({ type: 'StartNewGame', seed: 153, config: config() }).error).toBeNull();
    else engine.reset(153, config());
    for (const provider of Object.values(old)) {
      // The guard runs before argument validation or cache lookup for every API.
      if (typeof provider === 'function') expect(() => (provider as () => unknown)()).toThrow('Query revision has expired');
    }
    expect(engine.getQuery().revision).toBeGreaterThan(old.revision);
  });

  it('shares a revision while detaching all public results and preserving State/RNG/events', () => {
    const engine = new GameEngine(152, config());
    const before = engine.getState();
    const query = engine.getQuery();
    const expectedLegal = engine.getLegalActions();
    const expectedForecast = query.getEndTurnForecast();
    const expectedVision = query.getVision();
    const legal = query.getLegalActions();
    legal.length = 0;
    query.getEndTurnForecast().food.projectedProduction = -100;
    const vision = query.getVision();
    for (const value of Object.values(vision)) if (Array.isArray(value)) value.length = 0;
    const moves = query.getUnitMoveProjections('police-1');
    moves.length = 0;
    expect(query.getLegalActions()).toEqual(expectedLegal);
    expect(query.getEndTurnForecast()).toEqual(expectedForecast);
    expect(query.getVision()).toEqual(expectedVision);
    expect(query.getUnitMoveProjections('police-1').length).toBeGreaterThan(0);
    for (const id of ['police-1', 'national-guard-1']) {
      expect(query.getLegalActionsForUnit(id)).toEqual(expectedLegal.filter(a =>
        ('unitId' in a && a.unitId === id) || ('attackerId' in a && a.attackerId === id)));
    }
    expect(query.getLegalActionsForFacility('farm-1')).toEqual(expectedLegal.filter(a =>
      ('facilityId' in a && a.facilityId === 'farm-1') || ('fromFacilityId' in a && a.fromFacilityId === 'farm-1') || ('toFacilityId' in a && a.toFacilityId === 'farm-1')));
    expect(engine.getState()).toEqual(before);
    expect(engine.getQuery().revision).toBe(query.revision);
  });

  it('keeps rejected Action and invalid Load atomic and invalidates after accepted Action and same-turn Load', () => {
    const engine = new GameEngine(152, config());
    const before = engine.getState();
    const old = engine.getQuery();
    old.getLegalActions(); old.getEndTurnForecast(); old.getVision();
    const rejected = { type: 'Move' as const, unitId: 'police-1', destination: { q: -1, r: 25 } };
    expect(validateAction(before, rejected)).not.toBeNull();
    expect(engine.step(rejected).error).not.toBeNull();
    expect(engine.getState()).toEqual(before);
    expect(engine.getQuery().revision).toBe(old.revision);
    const invalid = structuredClone(before) as GameState;
    invalid.units[0]!.hp = -1;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: invalid }).error).not.toBeNull();
    expect(engine.getState()).toEqual(before);
    expect(engine.getQuery().revision).toBe(old.revision);
    expect(engine.step({ type: 'Wait', unitId: 'police-1' }).error).toBeNull();
    expect(engine.getQuery().revision).toBeGreaterThan(old.revision);
    expect(engine.getQuery().getLegalActionsForUnit('police-1')).toEqual([]);
    const waited = engine.getQuery().revision;
    const loaded = structuredClone(before) as GameState;
    loaded.resources.fuel = 0;
    loaded.facilities.find(f => f.id === 'wind-power-plant-1')!.operationalStatus = 'disabled';
    expect(engine.step({ type: 'LoadSnapshot', snapshot: loaded }).error).toBeNull();
    expect(engine.getQuery().revision).toBeGreaterThan(waited);
    expect(engine.getQuery().getLegalActionsForUnit('police-1').length).toBeGreaterThan(0);
    expect(engine.getQuery().getEndTurnForecast().electricity.availableGenerationCapacity).toBe(0);
    loaded.resources.fuel = 999;
    expect(engine.getQuery().getEndTurnForecast().electricity.availableGenerationCapacity).toBe(0);
  });

  it('does not retain candidate caches after the synchronous read scope, including throws', () => {
    const state = new GameEngine(152, config()).getState() as GameState;
    const before = forecastEndTurn(state);
    withReadOnlyQueryScope(state, () => forecastEndTurn(state));
    state.facilities.find(f => f.id === 'farm-1')!.powerSupplyEnabled = false;
    expect(forecastEndTurn(state).food.projectedProduction).toBeLessThan(before.food.projectedProduction);
    expect(() => withReadOnlyQueryScope(state, () => { forecastEndTurn(state); throw new Error('test'); })).toThrow('test');
    state.facilities.find(f => f.id === 'farm-1')!.powerSupplyEnabled = true;
    expect(forecastEndTurn(state)).toEqual(before);
  });

  it('isolates identical revision numbers across engines and does not disclose hidden enemy positions through queries', () => {
    const first = new GameEngine(152, config());
    const second = new GameEngine(152, config());
    const a = first.getState() as GameState;
    const b = second.getState() as GameState;
    a.units.push(createUnit(a, 'hidden', 'zombie', { q: 0, r: 1 }));
    b.units.push(createUnit(b, 'hidden', 'zombie', { q: 1, r: 0 }));
    expect(first.step({ type: 'LoadSnapshot', snapshot: a }).error).toBeNull();
    expect(second.step({ type: 'LoadSnapshot', snapshot: b }).error).toBeNull();
    expect(first.getQuery().revision).toBe(second.getQuery().revision);
    expect(first.getLegalActions()).toEqual(second.getLegalActions());
    expect(first.getQuery().getUnitMoveProjections('police-1')).toEqual(second.getQuery().getUnitMoveProjections('police-1'));
    expect(first.getQuery().getVision()).toEqual(second.getQuery().getVision());
    expect(first.step({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: false }).error).toBeNull();
    expect(first.getQuery().getEndTurnForecast().food.projectedProduction).toBe(0);
    expect(second.getQuery().getEndTurnForecast().food.projectedProduction).toBeGreaterThan(0);
  });
});
