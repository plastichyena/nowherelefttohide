// Uses the saved v1.6.7 bundle or the current bundle, with identical real Core actions.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
const [mode,modulePath,root]=process.argv.slice(2);
let readBytes=0,readCalls=0,inflateBytes=0,inflateMs=0;
const read=fs.readFileSync,readSync=fs.readSync,gunzip=zlib.gunzipSync;
fs.readFileSync=function(...args){const result=read.apply(this,args);readBytes+=Buffer.byteLength(result);readCalls++;return result;};
fs.readSync=function(...args){const bytes=readSync.apply(this,args);readBytes+=bytes;readCalls++;return bytes;};
zlib.gunzipSync=function(...args){const start=performance.now();const result=gunzip.apply(this,args);inflateMs+=performance.now()-start;inflateBytes+=result.length;return result;};
syncBuiltinESMExports();
const m=await import(pathToFileURL(resolve(modulePath)));
const identity=m.resolveSessionIdentity({NLTH_BUILD_ID:'v168-status-benchmark',NLTH_GIT_COMMIT:'controlled-fixture'});
const config={ units:Object.fromEntries(['police','nationalGuard','riotPolice','reconTeam'].map(type=>[type,{movement:1}])), maxActionsPerTurn:100,economy:{ initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:1000000,civilianGoods:1000000,militaryGoods:1000000,fuel:1000000}},refugees:{arrivalIntervalMin:1000000,arrivalIntervalMax:1000000},objectives:{nuclearPowerPlant:{rewardDeadlineTurn:1000000},airBase:{rewardDeadlineTurn:1000000}},horde:{waves:[{turn:1000000,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]} };
const baseFactory=m.createAgentSessionGameFactory(identity.buildId,config);
const factory={...baseFactory,createNew(options){const runtime=baseFactory.createNew(options),state=runtime.exportPrivateState();let removed=0;for(const f of state.facilities)if(f.owner==='none'){removed+=f.workers;f.workers=0;f.earlyCaptureSurvivorStatus='lost';if(f.armyBase)f.armyBase.interceptionsRemaining=0;}state.population.initialPopulation-=removed;return baseFactory.restore({...options,privateState:state,decision:0});}};
const service=new m.SessionService(new m.SessionStore(resolve(root)),factory,identity);
const profile={};
for(const [object,method,label] of [[service.store,'readPrivateState','privateRestoreMs'],[service.store,'readPublicState','publicRestoreMs'],[service,'restoreAndVerify','observationAndLegalVerificationMs']]) {
 const original=object[method];object[method]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{profile[label]=(profile[label]??0)+performance.now()-start;}};
}
const originalIterate=service.store.iterateLocalDecisionRecords;
service.store.iterateLocalDecisionRecords=function*(...args){const start=performance.now();try{yield* originalIterate.apply(this,args);}finally{profile.historyVerificationMs=(profile.historyVerificationMs??0)+performance.now()-start;}};
function measure(kind,fn){readBytes=readCalls=inflateBytes=inflateMs=0;for(const key of Object.keys(profile))profile[key]=0;const start=performance.now();const result=fn();return {kind,ms:performance.now()-start,readBytes,readCalls,inflateBytes,inflateMs,...profile,turn:result.observation.turn,revision:result.revision};}
if(mode==='measure'){
 const measures=[measure('freshProcessStatus',()=>service.status('fixture'))];
 service.closeContinuation('fixture');
 measures.push(measure('residentFirstStatus',()=>service.playTurnStatus('fixture')));
 for(let i=0;i<3;i++)measures.push(measure('residentContinuedStatus',()=>service.playTurnStatus('fixture')));
 console.log(JSON.stringify(measures));
}else{
 fs.mkdirSync(resolve(root),{recursive:true});
 const resumed=mode==='resume';
 let status=resumed?service.status('fixture'):service.newSession({sessionId:'fixture',seed:1511,agentId:'status-benchmark'}),revision=status.revision;
 const report=resumed?JSON.parse(fs.readFileSync(resolve(root,'measurements.json'),'utf8')):{version:identity.appVersion,environment:{platform:process.platform,node:process.version,cpu:os.cpus()[0]?.model},scenario:'51x51 real Core, 7 initial humans with movement1 to bound legal-action generation, quiet custom configuration, 11 checkpoint-policy actions + EndTurn per turn; no synthetic history',samples:[]};
 const runSamples=()=>{for(let i=0;i<3;i++){const child=spawnSync(process.execPath,[import.meta.filename,'measure',modulePath,root],{encoding:'utf8',maxBuffer:16*1024*1024});if(child.status!==0)throw Error(child.stderr||child.stdout);report.samples.push(...JSON.parse(child.stdout));}fs.writeFileSync(resolve(root,'measurements.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({version:identity.appVersion,turn:status.observation.turn,revision,samples:report.samples.slice(-5)}));};
 if(!resumed)runSamples();
 for(let turn=status.observation.turn;turn<84;turn++){
  const handle=service.beginPlayTurn('fixture');
  try { for(let action=revision%12;action<12;action++){
   const input=action===11?{type:'EndTurn'}:{type:'SetCheckpointPolicy',branchId:'north',policy:((turn-1)*11+action)%2===0?'strict':'normal'};
   status=service.playTurnAction('fixture',{type:'action',action:input,expectedRevision:revision,requestId:`status-${revision}`,decisionSummary:'Controlled storage benchmark; no balance claim.'});
   if(!status.accepted)throw Error(JSON.stringify(status.error));revision=status.currentRevision;
  } } finally { handle.close(); }
  if([50,84].includes(status.observation.turn))runSamples();
  else if(turn%10===0)console.log(JSON.stringify({version:identity.appVersion,turn:status.observation.turn,revision}));
 }
}
