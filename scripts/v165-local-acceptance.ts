/** Browser fixtures and portable replay made exclusively through public gameplay actions. */
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

const directory=resolve('output/playwright/v165-acceptance'); mkdirSync(directory,{recursive:true});
const config=createDefaultConfig({checkpoint:{initialSupplyRadius:50},facilities:{powerPlant:{production:{powerGeneration:100}}},economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99},horde:{waves:[{turn:99,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]}});
const game=createAgentGame({buildId:'v165-local-acceptance'});game.reset({seed:1,configOverrides:config});
const actions:GameAction[]=[];
function act(action:GameAction){const result=game.step(action);if(result.error)throw new Error(`${JSON.stringify(action)}: ${result.error.code}`);actions.push(action);return result.observation;}
function save(name:string){writeFileSync(resolve(directory,name+'.json'),exportSaveJson(game.exportPrivateSessionState()));}
const base=game.getObservation().facilities.find(f=>f.type==='airBase')!;
const capture=game.getLegalActions().find(a=>a.type==='Move'&&hexKey(a.destination)===hexKey(base.position));
if(!capture)throw new Error('No public Air Base capture route');act(capture);act({type:'EndTurn'});
act({type:'ProduceUnit',unitType:'multipurposeHelicopter',destination:base.position});act({type:'EndTurn'});
save('before-drone');
act({type:'LaunchMilitaryDrone',facilityId:base.id,target:{q:base.position.q+4,r:base.position.r}});
save('landed');
const aircraft=game.getObservation().units.find(u=>u.type==='multipurposeHelicopter')!;
const board=game.getLegalActions().find(a=>a.type==='BoardAircraft'&&a.aircraftId===aircraft.id);
if(!board)throw new Error('No public boarding action');act(board);act({type:'TakeOff',unitId:aircraft.id});
const moves=game.getLegalActions().filter((a):a is Extract<GameAction,{type:'Move'}>=>a.type==='Move'&&a.unitId===aircraft.id);
const ground=game.getObservation().units.find(u=>!u.transportedByUnitId&&u.id!==aircraft.id&&moves.some(m=>hexKey(m.destination)===hexKey(u.position)))!;
act({type:'Move',unitId:aircraft.id,destination:ground.position});save('airborne-cargo-overlap');act({type:'EndTurn'});
const current=game.getObservation();
const destination=game.getLegalActions().filter((a):a is Extract<GameAction,{type:'Move'}>=>a.type==='Move'&&a.unitId===aircraft.id)
  .filter(a=>current.map.tiles.some(t=>hexKey(t)===hexKey(a.destination)&&t.visibleToPlayer&&t.playerOccupancyAllowed&&t.effectiveMovementCost!==null)&&!current.units.some(u=>!u.transportedByUnitId&&u.flightState!=='airborne'&&hexKey(u.position)===hexKey(a.destination)))
  .sort((a,b)=>hexDistance(a.destination,ground.position)-hexDistance(b.destination,ground.position))[0]!;
act(destination);act({type:'Land',unitId:aircraft.id});save('landed-cargo');
const disembark=game.getLegalActions().find(a=>a.type==='DisembarkAircraft'&&a.aircraftId===aircraft.id);if(!disembark)throw new Error('No public disembark action');act(disembark);save('disembarked');
const identity={...resolveSessionIdentity(),buildId:'v165-local-acceptance'};
const service=new SessionService(new SessionStore(resolve(directory,`sessions-${Date.now()}`)),createAgentSessionGameFactory(identity.buildId,config),identity);
service.newSession({sessionId:'aviation',seed:1});
const batch=service.previewBatch('aviation',{expectedRevision:0,actions:[capture,{type:'TakeOff',unitId:'missing'},capture]});
if(JSON.stringify(batch.results[0])!==JSON.stringify(batch.results[2])||batch.revision!==0)throw new Error('Batch items were not independent');
for(const [index,action] of actions.entries()){
  const result=service.step('aviation',{action,expectedRevision:index,decisionSummary:`v1.6.5 public scenario ${index+1}: ${action.type}`});if(!result.decisionRecord.accepted)throw new Error('Portable Session rejected public action');
  if(action.type==='TakeOff'){
    const aircraft=result.observation.units.find(u=>u.id===action.unitId)!;
    const handoff=result.contextHandoff.authoritativeState;
    if(aircraft.flightState!=='airborne'||!aircraft.cargoUnitId||result.observation.units.find(u=>u.id===aircraft.cargoUnitId)?.transportedByUnitId!==aircraft.id||!result.observation.militaryDrone?.active||handoff.units.items.find(u=>u.id===aircraft.id)?.flightState!=='airborne'||!handoff.militaryDrone?.active)throw new Error('Compact/Context Handoff lost aviation state');
  }
}
const artifact=resolve(directory,`aviation-${Date.now()}.nlth-artifact`);service.exportArtifact('aviation',artifact);
const replay=service.replayArtifact(`${artifact}.zip`);if(!replay.matched)throw new Error('Aviation replay mismatch');
writeFileSync(resolve(directory,'report.json'),JSON.stringify({actions,batch,replay,versions:game.getApiInfo(),directory},null,2));
console.log(JSON.stringify({directory,actions:actions.length,replay},null,2));
