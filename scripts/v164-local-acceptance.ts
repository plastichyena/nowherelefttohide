/** Reproducible public-action scenario and browser fixtures. No private state is used to choose actions. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAgentGame } from '../src/agent/game';
import { createDefaultConfig } from '../src/core/config';
import { hexDistance, hexKey } from '../src/core/hex';
import { exportSaveJson } from '../src/persistence/save';
import { createAgentSessionGameFactory, resolveSessionIdentity } from '../src/session/agent-adapter';
import { SessionService } from '../src/session/service';
import { SessionStore } from '../src/session/store';
import type { GameAction } from '../src/core/types';

const directory=resolve(`output/playwright/v164-${Date.now()}`);mkdirSync(directory,{recursive:true});
const config=createDefaultConfig({checkpoint:{initialSupplyRadius:20},economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99},horde:{waves:[{turn:99,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]}});
const game=createAgentGame({buildId:'v164-local-acceptance'});game.reset({seed:1,configOverrides:config});
const actions:GameAction[]=[];
function act(action:GameAction){const r=game.step(action);if(r.error)throw new Error(`${JSON.stringify(action)}: ${r.error.message}`);actions.push(action);return r.observation;}
let observation=game.getObservation();const base=observation.facilities.find(f=>f.type==='armyBase')!,capital=observation.facilities.find(f=>f.type==='capital')!;
const capture=game.getLegalActions().find(a=>a.type==='Move'&&hexKey(a.destination)===hexKey(base.position));if(!capture)throw new Error('No public capture route');
act(capture);act({type:'EndTurn'});
act({type:'ProduceUnit',unitType:'fieldArtillery',destination:base.position});act({type:'EndTurn'});
observation=game.getObservation();const gun=observation.units.find(u=>u.type==='fieldArtillery');if(!gun)throw new Error('Artillery was not commissioned');
const reposition=game.getLegalActions().filter((a):a is Extract<GameAction,{type:'Move'}>=>a.type==='Move'&&a.unitId===gun.id).filter(a=>hexDistance(a.destination,capital.position)>=10).sort((a,b)=>hexDistance(a.destination,capital.position)-hexDistance(b.destination,capital.position))[0];
if(!reposition)throw new Error('No public artillery firing position');act(reposition);act({type:'EndTurn'});act({type:'ChangeUnitMode',unitId:gun.id,mode:'deployed'});act({type:'EndTurn'});
const aim={type:'AttackHex' as const,attackerId:gun.id,position:capital.position};
const preview=game.previewAction(aim,actions.length);
// Save export is only an output fixture, never input to the action planner above.
writeFileSync(resolve(directory,'artillery-before-fire.json'),exportSaveJson(game.exportPrivateSessionState()));
writeFileSync(resolve(directory,'public-preview.json'),JSON.stringify(preview,null,2));
act(aim);
const identity={...resolveSessionIdentity(),buildId:'v164-local-acceptance'};
const service=new SessionService(new SessionStore(resolve(directory,'sessions')),createAgentSessionGameFactory(identity.buildId,config),identity);
service.newSession({sessionId:'artillery',seed:1});
for(const [index,action] of actions.entries()){const result=service.step('artillery',{action,expectedRevision:index,decisionSummary:`v1.6.4 公開Action検証 ${index+1}: ${action.type}`});if(!result.decisionRecord.accepted)throw new Error('Session rejected scenario action');}
const artifactPath=resolve(directory,'artillery.nlth-artifact');service.exportArtifact('artillery',artifactPath);
const replay=service.replayArtifact(artifactPath);if(!replay.matched)throw new Error('Scenario replay mismatch');
writeFileSync(resolve(directory,'report.json'),JSON.stringify({actions,preview,replay,versions:game.getApiInfo(),directory},null,2));
console.log(JSON.stringify({directory,actionCount:actions.length,replay},null,2));
