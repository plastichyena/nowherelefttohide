import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine, validateAction } from './engine';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { forecastUnitCombatAtDistance } from './combat-query';
import { getPlayerVisibleTileKeys } from './visibility';
import { previewMove } from './movement-query';
import { validateInvariants } from './invariants';
import type { GameAction, GameState } from './types';

export const quiet165 = () => createDefaultConfig({economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialScreamerCount:0,initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99}});
function fixture(fuel=500) {
  const engine=new GameEngine(1,quiet165()); const state=engine.getState() as GameState;
  state.units=[createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25},'ready','recruit'),createUnit(state,'troop','police',{q:24,r:25})];
  state.units[0]!.currentFuel=fuel; prepareTestSnapshot(state);
  expect(engine.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull(); return engine;
}
function step(engine: GameEngine,action: GameAction) { const result=engine.step(action); expect(result.error?.message).toBeUndefined(); return result.state; }

describe('v1.6.5 flight and transport',()=>{
  it('starts a valid seeded v1.6.5 game with one Air Base',()=>{
    const state=new GameEngine(1,quiet165()).getState();
    expect(state.facilities.filter(f=>f.type==='airBase')).toHaveLength(1);
    expect(validateInvariants(state as GameState).errors).toEqual([]);
  });
  it('boards, conserves rescue fuel, takes off and moves without spending the helicopter action on boarding',()=>{
    const engine=fixture(0);
    let state=step(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});
    expect(state.units[0]!.currentFuel).toBe(24); expect(state.units[1]!.currentFuel).toBe(0);
    expect(state.units[1]!.transportedByUnitId).toBe('heli');
    state=step(engine,{type:'TakeOff',unitId:'heli'});
    expect(engine.step({type:'Land',unitId:'heli'}).error?.code).toBe('aircraft_took_off_this_turn');
    state=step(engine,{type:'Move',unitId:'heli',destination:{q:27,r:25}});
    expect(state.units[0]!.currentFuel).toBe(14); expect(state.units[1]!.position).toEqual({q:27,r:25});
    expect(state.units[0]!.movementDomain).toBe('air');
  });
  it.each([1,4,5,6])('resolves fuel %s at the exact flight step and keeps previews pure',fuel=>{
    const engine=fixture(fuel); step(engine,{type:'TakeOff',unitId:'heli'});
    const before=engine.getState(); const preview=previewMove(before,'heli',{q:28,r:25});
    expect(engine.getState()).toEqual(before); expect(preview.fuelExhaustionHex).toEqual({q:fuel<=5?26:27,r:25});
    const state=step(engine,{type:'Move',unitId:'heli',destination:{q:28,r:25}});
    const unit=state.units.find(u=>u.id==='heli')!;
    expect(unit.currentFuel).toBe(0); expect(unit.flightState).toBe('landed'); expect(unit.position).toEqual(preview.fuelExhaustionHex);
    expect(engine.step({type:'TakeOff',unitId:'heli'}).error?.code).toBe('aircraft_landed_this_turn');
  });
  it('keeps the cargo through a turn, lands, disembarks with reaction charges but no voluntary action',()=>{
    const engine=fixture(); step(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'}); step(engine,{type:'TakeOff',unitId:'heli'});
    step(engine,{type:'EndTurn'}); step(engine,{type:'Land',unitId:'heli'});
    const state=step(engine,{type:'DisembarkAircraft',aircraftId:'heli',destination:{q:24,r:25}});
    const troop=state.units.find(u=>u.id==='troop')!;
    expect(troop.canMove).toBe(false); expect(troop.canAttack).toBe(true); expect(troop.attackChargesRemaining).toBe(1);
    expect(troop.transportedByUnitId).toBeUndefined(); expect(validateAction(state,{type:'Move',unitId:'troop',destination:{q:23,r:25}})?.code).toBe('unit_cannot_move');
  });
  it('rejects same-turn disembarkation and leaves both fuel pools unchanged on failed boarding',()=>{
    const engine=fixture(); const before=engine.getState();
    expect(engine.step({type:'BoardAircraft',unitId:'heli',aircraftId:'heli'}).error?.code).toBe('unit_not_infantry'); expect(engine.getState()).toEqual(before);
    step(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});
    expect(engine.step({type:'DisembarkAircraft',aircraftId:'heli',destination:{q:24,r:25}}).error?.code).toBe('cargo_boarded_this_turn');
  });
  it('requires full helicopter ammunition at distance zero through two',()=>{
    const engine=fixture(); const state=engine.getState() as GameState; const heli=state.units[0]!;
    heli.flightState='airborne'; heli.currentMilitaryGoods=1;
    for(const distance of [0,1,2]) expect(forecastUnitCombatAtDistance(state,heli,distance).canAttack).toBe(false);
    heli.currentMilitaryGoods=4; expect(forecastUnitCombatAtDistance(state,heli,0).militaryGoodsCost).toBe(2); expect(forecastUnitCombatAtDistance(state,heli,2).militaryGoodsCost).toBe(4);
    expect(getPlayerVisibleTileKeys(state).has('25,15')).toBe(true);
  });
});
