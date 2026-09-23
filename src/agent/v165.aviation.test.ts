import { describe, expect, it } from 'vitest';
import { GameEngine } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import { createUnit } from '../core/state';
import { prepareTestSnapshot, singleFinalWave } from '../core/testConfig';
import type { GameState, GameAction } from '../core/types';
import { hexDistance } from '../core/hex';
import { BalancedAgent } from './balancedAgent';
import { createAgentObservation } from './observation';

function scenario() {
  const config = createDefaultConfig({
    economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialScreamerCount: 0,
      initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 10000 } },
    facilities: { powerPlant: { production: { powerGeneration: 100 } } },
    refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 }, horde: singleFinalWave(99),
  });
  const engine = new GameEngine(1, config), state = engine.getState() as GameState;
  state.units = [createUnit(state, 'aircraft', 'multipurposeHelicopter', { q: 25, r: 25 }), createUnit(state, 'passenger', 'police', { q: 24, r: 25 })];
  state.completedProductions.multipurposeHelicopter = 1;
  prepareTestSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  return engine;
}
function decideAndApply(engine: GameEngine, agent: BalancedAgent) {
  const before = engine.getState(), observation = createAgentObservation(before);
  const decision = agent.decide(observation, engine.getLegalActions());
  expect(engine.getState()).toEqual(before);
  expect(engine.step(decision.action).error, JSON.stringify(decision)).toBeNull();
  return decision.action;
}

describe('v1.6.5 public-information aviation AI', () => {
  it('uses airborne fire and lands before receiving fuel at EndTurn', () => {
    const engine=scenario(), state=engine.getState() as GameState;
    state.units=[state.units[0]!,createUnit(state,'ground-enemy','zombie',{q:27,r:25})];
    prepareTestSnapshot(state);expect(engine.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull();
    expect(engine.step({type:'TakeOff',unitId:'aircraft'}).error).toBeNull();
    const agent=new BalancedAgent();let attacked=false;const trail:GameAction[]=[];
    for(let i=0;i<12;i++){const action=decideAndApply(engine,agent);trail.push(action);if(action.type==='Attack'&&action.attackerId==='aircraft'){attacked=true;break;}}
    expect(attacked,JSON.stringify(trail)).toBe(true);
    expect(engine.getState().units.find(u=>u.id==='ground-enemy')?.hp??0).toBeLessThan(15);
    expect(engine.getState().units.find(u=>u.id==='aircraft')!.currentMilitaryGoods).toBe(36);
    const depleted=engine.getState() as GameState;
    depleted.units=depleted.units.filter(u=>u.id==='aircraft');depleted.turn=2;
    const aircraft=depleted.units[0]!;
    Object.assign(aircraft,{currentFuel:30,actionState:'ready',canMove:true,canAttack:true,tookOffTurn:1});
    prepareTestSnapshot(depleted);expect(engine.step({type:'LoadSnapshot',snapshot:depleted}).error).toBeNull();
    expect(decideAndApply(engine,new BalancedAgent())).toEqual({type:'Land',unitId:'aircraft'});
    expect(engine.getState().units[0]!.currentFuel).toBe(30);
    expect(engine.step({type:'EndTurn'}).error).toBeNull();
    expect(engine.getState().units[0]).toMatchObject({flightState:'landed',currentFuel:500});
  },120000);

  it('actually boards, flies, lands and delivers infantry using complete legal action sets', () => {
    const engine = scenario(), agent = new BalancedAgent(), actions: GameAction[] = [];
    for (let i = 0; i < 80; i++) {
      const action = decideAndApply(engine, agent); actions.push(action);
      if (action.type === 'DisembarkAircraft') break;
    }
    expect(actions.map(a => a.type), JSON.stringify(actions)).toEqual(expect.arrayContaining(['BoardAircraft', 'TakeOff', 'Move', 'Land', 'DisembarkAircraft']));
    const state = engine.getState(), passenger = state.units.find(u => u.id === 'passenger')!;
    expect(passenger.transportedByUnitId).toBeUndefined();
    expect(passenger.disembarkedTurn).toBe(state.turn);
    expect(passenger.canMove).toBe(false);
    expect(hexDistance(passenger.position, { q: 24, r: 25 })).toBeGreaterThan(1);
  }, 120000);

  it('launches useful reconnaissance and recruits within the lifetime limit', () => {
    const engine = scenario(), state = engine.getState() as GameState;
    state.units = []; state.completedProductions.multipurposeHelicopter = 0;
    state.config.checkpoint.initialSupplyRadius = 50;
    const base = state.facilities.find(f => f.type === 'airBase')!;
    Object.assign(base, { owner: 'player', status: 'owned', operationalStatus: 'operational', workers: 5, infected: 0, securedOrder: 100, populationOperationalTurn: 1, firstCaptureRewardClaimed: true });
    state.airBaseObjective = { firstCapturedTurn: 1, reward: 'expired', failureSpawn: 'none', fellBeforeCapture: false };
    prepareTestSnapshot(state); expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const actions: GameAction[] = [], agent = new BalancedAgent();
    for (let i = 0; i < 12; i++) {
      actions.push(decideAndApply(engine, agent));
      if (actions.some(a => a.type === 'LaunchMilitaryDrone') && actions.some(a => a.type === 'ProduceUnit' && a.unitType === 'multipurposeHelicopter')) break;
    }
    expect(actions.some(a => a.type === 'LaunchMilitaryDrone')).toBe(true);
    expect(actions.filter(a => a.type === 'ProduceUnit' && a.unitType === 'multipurposeHelicopter')).toHaveLength(1);
    expect(engine.getState().militaryDrone).not.toBeNull();
    expect(engine.getLegalActions().some(a => a.type === 'LaunchMilitaryDrone')).toBe(false);
  }, 120000);
});
