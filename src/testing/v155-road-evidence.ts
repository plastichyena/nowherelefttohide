import { unitMoveFuelCost } from '../core/movement-query';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFixedMap, ARMY_BASE_CANDIDATES } from '../core/map';
import { createInitialState } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { connectRoadAccess, fixedRoadInput, generateRoadNetwork, roadConnections, roadEdges, roadHash, type RoadNetwork } from '../core/roads';
import { hexKey } from '../core/hex';
import { findShortestPath, pathMovementCost, findReachableTiles } from '../core/path';
import { createMovementCostResolver } from '../core/terrain';

const output='output/v155-roads';mkdirSync(output,{recursive:true});
const base=createFixedMap(), input=fixedRoadInput(base), rows=[];
const point=(p:{q:number;r:number})=>({x:30+Math.sqrt(3)*(p.q+p.r/2)*7,y:30+p.r*10.5});
for(const stage of ['none','required','optional'] as const){
  const begin=performance.now();
  const roads:RoadNetwork=stage==='none'?{...base.roads!,segments:input.trunks.map(s=>structuredClone(s))}:generateRoadNetwork(input,stage==='optional');
  const generationMs=performance.now()-begin;
  if(stage!=='none')connectRoadAccess(input,roads,ARMY_BASE_CANDIDATES[0]!,'access-army-base-1');
  const edges=roadEdges(roads),graph=roadConnections(roads),degree:Record<string,number>={},terrain:Record<string,number>={};
  for(const connections of graph.values())degree[connections.length]=(degree[connections.length]??0)+1;
  const nonPlain=base.tiles.filter(t=>graph.has(hexKey(t))&&t.terrain!=='plain').map(t=>({q:t.q,r:t.r,terrain:t.terrain}));
  for(const tile of base.tiles.filter(t=>graph.has(hexKey(t))))terrain[tile.terrain]=(terrain[tile.terrain]??0)+1;
  const state=createInitialState(1,createDefaultConfig());state.map.roads=roads;const resolve=createMovementCostResolver(state);
  const paths=[];
  for(const source of base.facilities.filter(f=>f.type==='capital'||f.type==='city'))for(const destination of base.facilities.filter(f=>f.id!==source.id)){
    const p=findShortestPath(state.map,source.position,destination.position,new Set(),resolve);if(p){const mp=pathMovementCost(p,resolve);paths.push({from:source.id,to:destination.id,mp,edges:p.length-1,policeFuel:unitMoveFuelCost('police',p.length-1)});}
  }
  const entrances=base.hordeEntrances.flatMap(e=>base.facilities.filter(f=>['capital','city','farm'].includes(f.type)).map(target=>{const path=findShortestPath(state.map,e.tile,target.position,new Set(),resolve)!;const mp=pathMovementCost(path,resolve);return{direction:e.direction,target:target.id,mp,pathLength:path.length-1,unopposedMovementTurns:Math.ceil(mp/state.config.units.hordeZombie.movement)};}));
  const hunterRange=state.initialHunterPositions.map(p=>({position:p,reachableHexes:findReachableTiles(state.map,p,state.config.units.hunterZombie.movement,new Set(),resolve).length}));
  const body=base.tiles.map(t=>{const p=point(t),fill=t.terrain==='forest'?'#36533e':t.terrain==='mountain'?'#787a72':'#96916d';return`<circle cx="${p.x}" cy="${p.y}" r="6.8" fill="${fill}" opacity="${t.playerOccupancyAllowed?1:.3}"/>`;}).join('')+edges.map(e=>{const a=point(e.a),b=point(e.b);return`<path d="M${a.x},${a.y}L${b.x},${b.y}" stroke="${e.role==='trunk'?'#f0d9a0':e.role==='collector'?'#ddbc6e':'#b99c68'}" stroke-width="${e.role==='trunk'?4:e.role==='collector'?2.5:1.4}"/>`;}).join('')+[...base.facilities,{id:'army-base-1',position:ARMY_BASE_CANDIDATES[0]!}].map(f=>{const p=point(f.position);return`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#80dfe1"/><text x="${p.x+5}" y="${p.y-5}" font-size="8" fill="white">${f.id}</text>`;}).join('');
  writeFileSync(`${output}/${stage}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640" viewBox="0 0 1000 640"><rect width="1000" height="640" fill="#17231f"/><text x="20" y="20" fill="white">v1.5.5 — ${stage} · trunk / collector / access; faded outer reserve</text>${body}</svg>`);
  copyFileSync(`${output}/${stage}.svg`, `src/testing/fixtures/v155-roads-${stage}.svg`);
  const traversedEdges=roads.segments.reduce((sum,s)=>sum+s.path.length-1,0);
  rows.push({stage,generationMs,roles:Object.fromEntries(['trunk','collector','access'].map(role=>[role,edges.filter(e=>e.role===role).length])),trunkShare:edges.filter(e=>e.role==='trunk').length/edges.length,sharedEdgeFraction:(traversedEdges-edges.length)/Math.max(1,traversedEdges),hash:roadHash(roads),roadBytes:Buffer.byteLength(JSON.stringify(roads)),edgeCount:edges.length,hexCount:graph.size,degree,terrain,nonPlain,deadEnds:degree[1]??0,cycleRank:edges.length-graph.size+1,mandatoryNewEdges:roadEdges({...roads,segments:roads.segments.filter(s=>!s.id.startsWith('loop-')&&!s.id.includes('army-base'))}).length-100,optionalNewEdges:edges.length-roadEdges({...roads,segments:roads.segments.filter(s=>!s.id.startsWith('loop-'))}).length,paths,entrances,hunterRange});
}
const candidates=ARMY_BASE_CANDIDATES.map(position=>{const roads=structuredClone(base.roads!);connectRoadAccess(input,roads,position,'access-army-base-1');const graph=roadConnections(roads);const seen=new Set<string>(),queue=[hexKey(base.facilities[0]!.position)];while(queue.length){const p=queue.pop()!;if(seen.has(p))continue;seen.add(p);queue.push(...(graph.get(p)??[]).map(e=>hexKey(e.position)));}return{position,connected:seen.has(hexKey(position))&&base.facilities.every(f=>seen.has(hexKey(f.position))),hash:roadHash(roads)};});
const report={version:'1.5.5',recordedAt:new Date().toISOString(),platform:process.platform,node:process.version,settings:input.style,candidates,rows,notes:['Path and contact-turn values are unopposed static estimates, not combat outcome guarantees.','Fuel quotes the Core distance formula for one uninterrupted path; long routes require multiple turns and their per-move rounding differs.','No physical mobile-device measurement.']};
writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
writeFileSync('src/testing/fixtures/v155-roads.json',JSON.stringify(report,null,2));
writeFileSync('src/testing/fixtures/v155-initial-state.json',JSON.stringify({sourceCommit:'v1.5.5-working-tree',fixtures:[1,17,20260905].map(seed=>({seed,sha256:createHash('sha256').update(JSON.stringify(createInitialState(seed,createDefaultConfig()))).digest('hex')}))},null,2));
console.log(JSON.stringify({output,candidates,rows:rows.map(r=>({stage:r.stage,edges:r.edgeCount,cycles:r.cycleRank,generationMs:r.generationMs,hash:r.hash}))},null,2));
