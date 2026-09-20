import { expect, it } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContextHandoff, type HandoffDecision } from './context-handoff';
import { createAgentGame } from '../agent/game';
import { createAiSession } from './ai-session';
import { SessionService } from './service';
import { SessionStore } from './store';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';

it('combines automatic triggers, counts formal rejections, and keeps reads outside canonical history',()=>{
 const observation=createAgentGame({recordHistory:false}).getObservation();
 const records: HandoffDecision[]=Array.from({length:128},(_,i)=>({decision:i+1,accepted:i>=123,inputAction:i>=123?{type:'EndTurn'}:{type:'Wait',unitId:'absent'},stateDelta:{beforeTurn:i-122,afterTurn:i-121},decisionSummary:i>=123?`Intent ${i}`:null}));
 const identity={sessionId:'handoff',revision:128,preferredCommentLocale:'ja' as const,branchLineage:null};
 const result=buildContextHandoff(observation,identity,records);
 expect(result.contextCheckpoint).toEqual({decision:128,reasons:['five_completed_turns','128_decisions'],completedTurns:5});
 expect(result.agentIntent.recent).toHaveLength(5);expect(result.agentIntent.latestAcceptedEndTurn?.decision).toBe(128);expect(result.durableConstraints).toMatchObject({preferredCommentLocale:'ja',fairPlay:true});
 const before=JSON.stringify({observation,records});expect(buildContextHandoff(observation,identity,records)).toEqual(result);expect(JSON.stringify({observation,records})).toBe(before);
 const extra={decision:129,accepted:true,inputAction:{type:'Wait' as const,unitId:'x'},decisionSummary:'Intent 127',importantChanges:[{id:'public-change'}]};
 const latest=buildContextHandoff({...observation,turn:6},{...identity,revision:129},[...records,extra]);expect(latest.sourceRevision).toBe(129);expect(latest.authoritativeState.turn).toBe(6);expect(latest.contextCheckpoint.decision).toBe(128);expect(latest.recentImportantChanges.total).toBe(1);expect(latest.agentIntent.recent).toHaveLength(5);
});

it('bounds every collection without dropping critical reason groups or locale',()=>{
 const o=createAgentGame({recordHistory:false}).getObservation();
 o.units=Array.from({length:200},(_,i)=>({...o.units[0]!,id:`unit-${i}`}));
 o.crisisSummary.alerts=Array.from({length:200},(_,i)=>({...o.crisisSummary.alerts[0]!,reasonCode:'food_starvation_risk',severity:'critical',entityIds:[`facility-${i}`]}));
 const r=buildContextHandoff(o,{sessionId:'large',revision:0,preferredCommentLocale:'en',branchLineage:{parentSessionId:'parent',parentDecision:7}},[]);
 expect(r.authoritativeState.units).toMatchObject({total:200,returned:24,omitted:176});expect(r.authoritativeState.crises.groups).toEqual([{reasonCode:'food_starvation_risk',severity:'critical',alertCount:200,targetCount:200}]);expect(r.authoritativeState.units.detailQuery.expectedRevision).toBe(0);
});

it('persists the 128th formal Decision handoff and leaves manual/query/retry calls read-only',()=>{
 const identity=resolveSessionIdentity({NLTH_BUILD_ID:'v163-handoff',NLTH_GIT_COMMIT:'c'.repeat(40)});const root=mkdtempSync(join(tmpdir(),'nlth-v163-context-'));
 const store=new SessionStore(root),service=new SessionService(store,createAgentSessionGameFactory(identity.buildId),identity);service.newSession({sessionId:'formal',seed:1,preferredCommentLocale:'ja'});
 for(let i=0;i<128;i++){
   const r=service.step('formal',{action:{type:'Wait',unitId:'missing'},expectedRevision:i});expect(r.accepted).toBe(false);
 }
 const before=store.load('formal');const status=service.status('formal');expect(status.contextHandoff.contextCheckpoint).toMatchObject({decision:128,reasons:['128_decisions']});
 const queried=service.query('formal',{target:'context-handoff',expectedRevision:128});expect(JSON.stringify(queried)).toContain('128_decisions');
 service.saveCheckpoint('formal');expect(store.load('formal').active.traceHeadHash).toBe(before.active.traceHeadHash);expect(service.status('formal').contextHandoff.contextCheckpoint.decision).toBe(128);
 expect(readdirSync(root,{recursive:true}).some(p=>String(p).endsWith('context-128.json'))).toBe(true);
},600000);

it('keeps 72 completed Turns of canonical history while handoff size stays bounded',()=>{
 const session=createAiSession({preferredCommentLocale:'ja',initial:{seed:1,configOverrides:{economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:1000000,civilianGoods:1000000,militaryGoods:1000000,fuel:1000000}},refugees:{arrivalIntervalMin:999,arrivalIntervalMax:999},horde:{waves:[{turn:100,directionCount:4,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]},units:{zombie:{movement:0},packZombie:{movement:0}}}}});
 let at10=0;
 for(let i=0;i<72;i++){
   const result=session.act({generation:1,baseRevision:i,requestId:`end-${i}`,action:{type:'EndTurn'},decisionSummary:`供給を維持する。Turn ${i+1}`});expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error.message);expect(result.record.accepted).toBe(true);expect(result.record.gameOver).toBe(false);
   if(i===9)at10=JSON.stringify(session.getContext().contextHandoff).length;
 }
 const context=session.getContext();expect(context.contextHandoff.authoritativeState.turn).toBe(73);expect(context.contextHandoff.contextCheckpoint).toMatchObject({decision:70,completedTurns:72});expect(JSON.stringify(context.contextHandoff).length).toBeLessThan(at10*1.5);
 const history=session.query({target:'history',pageSize:100});expect(history.ok).toBe(true);if(history.ok)expect(history.total).toBe(72);
 const before=session.getContext();session.query({target:'context-handoff'});expect(session.getContext()).toEqual(before);
},600000);
