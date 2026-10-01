import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentGame } from '../agent/game';
import { createAiSession } from '../session/ai-session';
import { GameEngine } from './engine';
import { resolveScenario } from './scenarios';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { previewMove } from './movement-query';
import { publicMoveDetails } from '../agent/public-movement';
import { ifvPolicy } from '../agent/ifv-policy';
import { UNA_INTRO, SYNOPSIS, renderSynopsis } from '../ui/story';
import type { GameAction, GameState } from './types';

describe('v1.6.9 public contracts', {timeout:60000}, () => {
  it('resolves identical UNA initial state for the human engine and API; rejects overrides without reset', () => {
    const preset=resolveScenario({scenarioId:'una',seed:7});
    const human=new GameEngine(preset.seed,preset.config),game=createAgentGame();
    game.reset({scenarioId:'una',seed:7});
    expect(game.getDebugState()).toEqual(human.getState());
    const before=game.getObservation();
    for(const input of [{scenarioId:'prh'},{scenarioId:'ac'},{scenarioId:'una',configOverrides:{}},{scenarioId:'una',seed:1.5}]) expect(()=>game.reset(input)).toThrow();
    expect(game.getObservation()).toEqual(before);
    expect(game.getRunArtifact().config.scenarioId).toBe('una');
    expect(resolveScenario({scenarioId:'una'}).seed).toBe(1);
  });
  it('uses the approved Japanese text and exact bilingual introduction; renders four synopsis sections', () => {
    const req=readFileSync('Doc/Nowhere Left to Hide PoC v1.6.9 アップデート要件 確定版.md','utf8').replace(/\r\n/g,'\n');
    for(const text of [UNA_INTRO.ja,UNA_INTRO.en,SYNOPSIS.ja])expect(req).toContain(text);
    for(const locale of ['ja','en'] as const){const html=renderSynopsis(locale);expect(html.match(/<h3>/g)).toHaveLength(4);expect(html).toContain('<strong>');expect(html).toContain('<br>');expect(html).toContain('The situation is under control.');}
  });
  it('shares IFV route damage with Core and reports actual overrun, fuel, charges and rejection', () => {
    const game=createAgentGame();game.reset({seed:1});const s=game.exportPrivateSessionState();
    s.units=[createUnit(s,'ifv-test','ifv',{q:25,r:25}),createUnit(s,'victim','hordeZombie',{q:26,r:25})];
    Object.assign(s.units[1]!,{spawnGroupId:'fixture',hordeKind:'periodic',attackChargesRemaining:2});
    prepareTestSnapshot(s);game.restorePrivateSessionState(s);
    const action:GameAction={type:'Move',unitId:'ifv-test',destination:{q:27,r:25}};
    const core=previewMove(game.getDebugState(),'ifv-test',action.destination);
    const publicMove=publicMoveDetails(game.getObservation(),'ifv-test',action.destination)!.preview!;
    expect(publicMove).toMatchObject({projectedHpAfterMove:core.projectedHpAfterMove,reached:core.reached,overruns:core.overruns});
    const preview=game.previewAction(action,0) as any;
    expect(preview.summary).toMatchObject({phase:'prediction',accepted:null,legal:true,baseRevision:0,movement:{predictedPosition:{q:27,r:25},destinationReached:true}});
    const result=game.step(action);
    expect(result.error).toBeNull();expect(result.summary).toMatchObject({phase:'result',accepted:true,baseRevision:0,resultRevision:1,movement:{actualPosition:{q:27,r:25},remainingAttackCharges:3,destinationReached:true}});
    expect(result.summary?.movement?.overruns).toHaveLength(1);
    const rejected=game.step({type:'Attack',attackerId:'ifv-test',targetId:'victim'});
    expect(rejected.summary).toMatchObject({accepted:false,resultRevision:2});expect(rejected.error).not.toBeNull();
  });
  it('returns independent batch summaries and the same revision in Session results; diagnoses wrong filter keys', () => {
    const session=createAiSession({initial:{seed:1,scenarioId:'una'}});
    const batch=session.previewActions({generation:1,baseRevision:0,actions:[{type:'EndTurn'},{type:'Wait',unitId:'missing'}]});
    expect(batch.ok).toBe(true);if(!batch.ok)throw new Error(batch.error.message);
    expect(batch.results.map(r=>r.summary?.legal)).toEqual([true,false]);
    expect(batch.results.every(r=>r.summary?.baseRevision===0)).toBe(true);
    for(const [target,key] of [['units','unitId'],['facilities','facilityId']] as const){const r=session.query({generation:1,baseRevision:0,target,filters:{[key]:'id'}});expect(r.ok).toBe(false);if(!r.ok){expect(r.error.code).toBe('invalid_query');expect(r.error.message).toContain('filters.id');}}
    const action=session.act({generation:1,baseRevision:0,requestId:'end-1',action:{type:'EndTurn'}});
    expect(action.ok).toBe(true);if(!action.ok)throw new Error(action.error.message);
    expect(action.record.summary).toMatchObject({accepted:true,baseRevision:0,resultRevision:1,turn:{before:1,after:2}});
    expect(session.previewAction({generation:1,baseRevision:0,action:{type:'EndTurn'}})).toMatchObject({ok:false,error:{code:'stale_revision'}});
  });
  it('Balanced avoids a publicly lethal Gas chain and reserves operating resources for production', () => {
    const game=createAgentGame();const s=game.exportPrivateSessionState() as GameState;
    s.units=[createUnit(s,'vehicle','ifv',{q:25,r:25}),createUnit(s,'gas','gasZombie',{q:26,r:25}),createUnit(s,'chain','gasZombie',{q:26,r:26})];
    s.units[0]!.hp=40;s.units[2]!.hp=1;prepareTestSnapshot(s);game.restorePrivateSessionState(s);
    const o=game.getObservation(),policy=ifvPolicy(o);
    expect(policy({type:'Move',unitId:'vehicle',destination:{q:26,r:25}})?.score).toBeLessThan(-5_000);
    o.resources.fuel=150;expect(ifvPolicy(o)({type:'ProduceUnit',unitType:'ifv',destination:{q:25,r:25}})?.score).toBe(-10_000);
    o.resources={...o.resources,food:1000,civilianGoods:1000,militaryGoods:1000,fuel:1000};o.endTurnForecast.food.shortage=0;o.endTurnForecast.civilianGoods.maintenanceShortage=0;
    expect(ifvPolicy(o)({type:'ProduceUnit',unitType:'ifv',destination:{q:25,r:25}})?.score).toBeGreaterThan(0);
  });
});


it.each([false,true])('summarizes ordinary movement arrival and visible interception without treating reachability as arrival (intercept=%s)',intercept=>{
  const game=createAgentGame();const state=game.exportPrivateSessionState();
  state.units=[createUnit(state,'walker','police',{q:25,r:25})];
  if(intercept){const z=createUnit(state,'flank','hordeZombie',{q:27,r:24});z.hordeKind='periodic';z.spawnGroupId='fixture';state.units.push(z);}
  prepareTestSnapshot(state);game.restorePrivateSessionState(state);
  const action:GameAction={type:'Move',unitId:'walker',destination:{q:28,r:25}};
  const preview=game.previewAction(action,0) as any;expect(preview.legal).toBe(true);
  expect(preview.summary.movement.destinationReached).toBe(!intercept);
  const actual=game.step(action);expect(actual.error).toBeNull();
  expect(actual.summary?.movement?.destinationReached).toBe(!intercept);
  expect(actual.summary?.movement?.actualPosition).toEqual(actual.observation.units.find(u=>u.id==='walker')!.position);
  expect(actual.summary?.remainingAttackCharges).toBe(actual.observation.units.find(u=>u.id==='walker')!.attackChargesRemaining);
  if(intercept)expect(actual.summary?.movement?.interruptionReason).not.toBeNull();
});

it('reports insufficient infantry fuel as an illegal prediction and rejected result with no movement',()=>{
  const game=createAgentGame();const state=game.exportPrivateSessionState();
  state.units=[createUnit(state,'walker','police',{q:25,r:25})];state.units[0]!.currentFuel=1;prepareTestSnapshot(state);game.restorePrivateSessionState(state);
  const action:GameAction={type:'Move',unitId:'walker',destination:{q:26,r:25}};
  const preview=game.previewAction(action,0) as any;expect(preview.summary).toMatchObject({legal:false,movement:{destinationReached:false,predictedPosition:null}});
  const actual=game.step(action);expect(actual.summary).toMatchObject({accepted:false,movement:{destinationReached:false,actualPosition:{q:25,r:25}}});
  expect(actual.observation.units[0]!.currentFuel).toBe(1);
});
