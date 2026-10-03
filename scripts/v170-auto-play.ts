import {mkdirSync,writeFileSync} from 'node:fs';
import {runAgentGame} from '../src/agent/runner';
import {createDefaultConfig} from '../src/core/config';
import {APP_VERSION,GAME_RULES_VERSION} from '../src/core/versions';
const args=process.argv.slice(2),value=(k:string,d:string)=>args.find(a=>a.startsWith(`--${k}=`))?.slice(k.length+3)??d;
const start=Number(value('start','1')), count=Number(value('count','10')), gameplaySeed=Number(value('gameplay','1'));
const strategy=value('agent','random') as 'random'|'balanced',mode=value('mode','random') as 'random'|'fixed';
const out=value('out','output/v170/auto-play'),maxTurns=Number(value('max-turns','100'));
mkdirSync(out,{recursive:true});
const results=[];
for(let mapSeed=start;mapSeed<start+count;mapSeed++){
  const started=performance.now();
  const run=runAgentGame(mapSeed,{strategy,summaryOnly:true,config:createDefaultConfig({scenarioId:'una',mapMode:mode,mapSeed,gameplaySeed:mode==='fixed'?mapSeed:gameplaySeed}),limits:{maxTurns}});
  const result={mapSeed,gameplaySeed:mode==='fixed'?mapSeed:gameplaySeed,mode,agent:run.agent,descriptor:run.initialObservation?.mapDescriptor,ms:performance.now()-started,outcome:run.technicalFailure?'technical_failure':run.limitReached?'turn_limit':run.result?.outcome??'unknown',result:run.result,technicalFailure:run.failure,metrics:run.metrics,objectiveCaptures:run.events.filter(e=>e.type==='facility_captured'&&['air-base-1','army-base-1','nuclear-power-plant-1','oilfield-1'].includes(String(e.payload.facilityId))).map(e=>({turn:e.turn,...e.payload}))};
  results.push(result);writeFileSync(`${out}/results.json`,JSON.stringify({app:APP_VERSION,rules:GAME_RULES_VERSION,plan:{start,count,gameplaySeed,strategy,mode,maxTurns},results},null,2));
  console.log(mapSeed,strategy,result.outcome,result.ms);
  if(run.technicalFailure)process.exitCode=1;
}
