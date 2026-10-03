import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {platform,arch,cpus} from 'node:os';
import {createInitialState} from '../src/core/state';
import {createDefaultConfig} from '../src/core/config';
import {generateRandomMap,MAP_GENERATION_LIMITS,mapDomainSeed} from '../src/core/map-generation';
import {hexDistance,hexKey,hexNeighbors} from '../src/core/hex';
import {roadConnections} from '../src/core/roads';
import {getSectorBranchIds} from '../src/core/supply';
import {validateInvariants} from '../src/core/invariants';
import {findShortestPath,pathMovementCost} from '../src/core/path';
import {createMovementCostResolver} from '../src/core/terrain';
import {unitMoveFuelCost} from '../src/core/movement-query';

const args=process.argv.slice(2),value=(key:string,fallback:string)=>args.find(a=>a.startsWith(`--${key}=`))?.split('=')[1]??fallback;
const out=value('out','output/v170/map-validation'), count=Number(value('count','100')), scattered=Number(value('scattered','0'));
const start=Number(value('start','1'));
mkdirSync(out,{recursive:true});
if(args.includes('--capture-fallback')){
  const result=generateRandomMap(1,createDefaultConfig(),{rejectCandidate:()=>true});
  writeFileSync('src/core/random-fallback.json',JSON.stringify(result.map)+'\n');
  console.log('Captured dedicated fallback');
}else{
  // Preregistered sequential and scattered groups; no exclusion of failed seeds.
  const seeds=[...Array.from({length:count},(_,i)=>i+start),...Array.from({length:scattered},(_,i)=>mapDomainSeed(i+1,'acceptance-scattered'))];
  const boundaries=[0,-1,4294967295,4294967296,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER];
  const results:any[]=[],maps:string[]=[];
  for(const [index,seed] of [...seeds,...boundaries].entries()){
    const started=performance.now(),rejections:unknown[]=[],stageMs:Record<string,number>={};let lastStage='bootstrap',stageStart=started;
    try{
      const s=createInitialState(seed,createDefaultConfig({scenarioId:'una'}),p=>{const now=performance.now();stageMs[lastStage]=(stageMs[lastStage]??0)+now-stageStart;lastStage=p.stage;stageStart=now;if(p.stage==='rejected')rejections.push({attempt:p.attempt,reason:p.reason});});
      stageMs[lastStage]=(stageMs[lastStage]??0)+performance.now()-stageStart;const invariant=validateInvariants(s);if(!invariant.valid)throw new Error(invariant.errors.join(';'));
      const counts=Object.fromEntries(['plain','forest','mountain','water'].map(t=>[t,s.map.tiles.filter(p=>p.terrain===t).length]));
      const roads=roadConnections(s.map.roads!),roadKeys=new Set(roads.keys());
      const components=Object.fromEntries(['plain','forest','mountain','water'].map(terrain=>{
        const rest=new Set(s.map.tiles.filter(t=>t.terrain===terrain).map(t=>t.key)),sizes:number[]=[];
        while(rest.size){const queue=[rest.values().next().value!];rest.delete(queue[0]!);let n=0;for(let j=0;j<queue.length;j++){n++;const [q,r]=queue[j]!.split(',').map(Number);for(const p of hexNeighbors({q:q!,r:r!})){const k=hexKey(p);if(rest.delete(k))queue.push(k);}}sizes.push(n);}
        return [terrain,{components:sizes.length,largest:Math.max(...sizes),isolated:sizes.filter(n=>n===1).length}];}));
      const facilities=s.facilities.map(f=>({id:f.id,position:f.position,distance:hexDistance({q:25,r:25},f.position),sectors:getSectorBranchIds(s.map,f.position)}));
      const cost=createMovementCostResolver(s,true);
      const routeEstimates=s.facilities.filter(f=>['armyBase','airBase','nuclearPowerPlant','oilField'].includes(f.type)).map(f=>{const path=findShortestPath(s.map,{q:26,r:26},f.position,new Set(s.map.hordeSpawnReserve.map(hexKey)),cost)!;return {id:f.id,mp:pathMovementCost(path,cost),reconFuel:unitMoveFuelCost('reconTeam',path.length-1),scope:'static_terrain_only'};});
      const buildablePlain=s.map.tiles.filter(t=>t.terrain==='plain'&&t.playerOccupancyAllowed&&!t.facilityId&&!roadKeys.has(t.key)&&!s.units.some(u=>u.isPlayerUnit&&hexKey(u.position)===t.key)&&hexDistance({q:25,r:25},t)<=s.config.checkpoint.initialSupplyRadius).length;
      results.push({seed,group:index<seeds.length?'normal':'boundary',descriptor:s.mapDescriptor,rejections,stageMs,counts,components,buildablePlain,routeEstimates,bridges:s.map.tiles.filter(t=>t.terrain==='water'&&roadKeys.has(t.key)).length,roadHexes:roadKeys.size,repairs:s.map.generation?.terrainRepairs,facilities,ms:performance.now()-started,memory:process.memoryUsage().rss,outcome:'started',initialEnemyAttempt:s.initialEnemyAttempt});
      if(index<32){
        const colors={plain:'#657850',forest:'#294735',mountain:'#716e66',water:'#448bac'};
        const point=(p:{q:number;r:number})=>`${(p.q*4+p.r*2).toFixed(1)},${(p.r*3.464).toFixed(1)}`;
        const tiles=s.map.tiles.map(t=>`<polygon fill="${colors[t.terrain]}" points="${hexPoints(t.q*4+t.r*2,t.r*3.464)}"/>`).join('');
        const paths=s.map.roads!.segments.map(r=>`<polyline fill="none" stroke="${r.role==='trunk'?'#e7d6a2':'#bfb3a0'}" stroke-width="${r.role==='trunk'?1.7:.7}" points="${r.path.map(point).join(' ')}"/>`).join('');
        const sites=s.map.facilities.map(f=>`<circle cx="${f.position.q*4+f.position.r*2}" cy="${f.position.r*3.464}" r="${f.type==='capital'?3:1.6}" fill="${f.startingOwned?'#55edc0':'#ffd57b'}"/>`).join('');
        maps.push(`<figure><figcaption>Seed ${seed} · attempt ${s.mapDescriptor.attempt}</figcaption><svg viewBox="-4 -4 310 184">${tiles}${paths}${sites}</svg></figure>`);
      }
    }catch(error){results.push({seed,group:index<seeds.length?'normal':'boundary',outcome:'failed',error:String(error),ms:performance.now()-started,rejections});}
    if((index+1)%25===0)console.log(`${index+1}/${seeds.length+boundaries.length}`);
  }
  const normal=results.filter(r=>r.group==='normal'),times=results.map(r=>r.ms).sort((a,b)=>a-b),fallbacks=normal.filter(r=>r.descriptor?.fallback).length;
  const diversity=Object.fromEntries((results.find(r=>r.facilities)?.facilities??[]).filter((f:any)=>f.id!=='capital').map((f:any)=>[f.id,new Set(normal.filter(r=>!r.descriptor?.fallback).flatMap(r=>r.facilities?.filter((x:any)=>x.id===f.id).map((x:any)=>hexKey(x.position))??[])).size]));
  const summary={environment:{platform:platform(),arch:arch(),node:process.version,cpu:cpus()[0]?.model},plan:{start,count,scattered,boundaries,limits:MAP_GENERATION_LIMITS},normalCount:normal.length,fallbacks,fallbackRate:fallbacks/normal.length,failures:results.filter(r=>r.outcome==='failed').length,diversity,timingMs:{p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)}};
  writeFileSync(join(out,'results.json'),JSON.stringify({summary,results},null,2)+'\n');
  writeFileSync(join(out,'maps.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>v1.7.0 generation review</title><style>body{background:#151c21;color:#ddd;font:14px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px}figure{margin:0}svg{width:100%}</style>${maps.join('')}</html>`);
  console.log(JSON.stringify(summary,null,2));
  if(summary.failures||summary.fallbackRate>.1||Object.values(diversity).some(n=>Number(n)<2))process.exitCode=1;
}
function hexPoints(x:number,y:number){return [[-2,-1.155],[0,-2.309],[2,-1.155],[2,1.155],[0,2.309],[-2,1.155]].map(([dx,dy])=>`${x+dx!},${y+dy!}`).join(' ');}
