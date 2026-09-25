import { expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentObservation } from './observation';
import { GameEngine } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import type { GameAction } from '../core/types';

it('Balanced chooses real legal build, staffing and power actions from public forecasts', () => {
  const engine = new GameEngine(3, createDefaultConfig({ facilities: { powerPlant: { production: { powerGeneration: 100 } } }, economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialResources: { food: 3000, civilianGoods: 200, fuel: 1000, militaryGoods: 500 } } }));
  const choose = (types: string[], facilityId?: string) => {
    const legal = engine.getLegalActions().filter(a => a.type === 'EndTurn' || (types.includes(a.type) && (!facilityId || ('facilityId' in a && a.facilityId === facilityId))) && (a.type !== 'BuildConstructibleFacility' || a.facilityType === 'reliefSupplyCenter'));
    expect(legal.length).toBeGreaterThan(1);
    const observation = createAgentObservation(engine.getState());
    const before = JSON.stringify(observation);
    const result = new BalancedAgent().decide(observation, legal);
    expect(JSON.stringify(observation)).toBe(before);
    expect(legal).toContainEqual(result.action);
    return result.action;
  };
  const build = choose(['BuildConstructibleFacility']); expect(build).toMatchObject({ type: 'BuildConstructibleFacility', facilityType: 'reliefSupplyCenter' });
  expect(engine.step(build).error).toBeNull(); expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const id = engine.getState().facilities.find(f => f.type === 'reliefSupplyCenter')!.id;
  const staffing = choose(['AssignWorkers'], id); expect(staffing).toMatchObject({ type: 'AssignWorkers', workers: 5 }); expect(engine.step(staffing).error).toBeNull();
  expect(engine.step({ type: 'SetPowerSupply', facilityId: id, enabled: false }).error).toBeNull();
  const enable = choose(['SetPowerSupply'], id); expect(enable).toMatchObject({ type: 'SetPowerSupply', enabled: true }); expect(engine.step(enable).error).toBeNull();
  // Scarcity is a distinct public scenario; no private information enters decide.
  const observation = createAgentObservation(engine.getState()); observation.resources.food = 0; observation.endTurnForecast.food.shortage = 100;
  const stop: GameAction = { type: 'SetPowerSupply', facilityId: id, enabled: false };
  expect(engine.getLegalActions()).toContainEqual(stop);
  expect(new BalancedAgent().decide(observation, [stop, { type: 'EndTurn' }]).action).toEqual(stop);
}, 120000);
