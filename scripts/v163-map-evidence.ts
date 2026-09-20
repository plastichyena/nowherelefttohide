import { writeFileSync } from 'node:fs';
import { GameEngine } from '../src/core/engine';
import { createDefaultConfig } from '../src/core/config';
import { BAY_CORNERS, bayCornerForSeed, bayLayout } from '../src/core/bay';
import { hexDistance, hexKey } from '../src/core/hex';
import { findShortestPath } from '../src/core/path';
import { createMovementCostResolver } from '../src/core/terrain';
import { isHexSupplied, isHexSuppliedByBranch } from '../src/core/supply';

const evidence=[];
for(const corner of BAY_CORNERS){
 const seed=corner==='topRight'?1:Array.from({length:64},(_,i)=>i).find(s=>bayCornerForSeed(s)===corner)!;
 let e=new GameEngine(seed);const initial=e.getState(),plant=initial.facilities.find(f=>f.type==='nuclearPowerPlant')!;
 const resolve=createMovementCostResolver(initial,true);const capital=initial.facilities.find(f=>f.type==='capital')!;
 const path=findShortestPath(initial.map,capital.position,plant.position,new Set(),resolve)!;
 const frontlines=initial.map.roadBranches.flatMap(branch=>branch.roadTiles.filter(p=>hexDistance(capital.position,p)===16&&isHexSuppliedByBranch(initial,plant.position,branch.id,p)).map(position=>({branchId:branch.id,position,distance:16,reserveMargin:Math.min(position.q-1,49-position.q,position.r-1,49-position.r)})));
 const units=initial.units.filter(u=>u.type==='reconTeam').sort((a,b)=>hexDistance(a.position,plant.position)-hexDistance(b.position,plant.position));
 const unitId=units[0]!.id,actions=[];let captureTurn:number|null=null;
 for(let i=0;i<20&&!e.getState().gameOver;i++){
   const state=e.getState(),unit=state.units.find(u=>u.id===unitId);if(!unit)break;
   const choices=e.getLegalActions().filter(a=>a.type==='Move'&&a.unitId===unitId).map(action=>({action,remaining:hexDistance((action as {destination:{q:number;r:number}}).destination,plant.position)})).sort((a,b)=>a.remaining-b.remaining);
   if(choices[0]){const r=e.step(choices[0].action);actions.push({turn:state.turn,action:choices[0].action,error:r.error});if(r.state.nuclearObjective.firstCapturedTurn!==null){captureTurn=r.state.nuclearObjective.firstCapturedTurn;break;}}
   const ended=e.step({type:'EndTurn'});if(ended.error)throw new Error(JSON.stringify(ended.error));
 }
 const supplyActions=[];
 // Isolate geographical/visibility/construction feasibility from combat:
 // capture above uses the default enemy population; this second legal-action
 // trace suppresses only initial enemies and preserves all supply/cost rules.
 e=new GameEngine(seed,createDefaultConfig({economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0}}}));
 for(const record of actions){if(e.getState().nuclearObjective.firstCapturedTurn!==null)break;while(e.getState().turn<record.turn){const action={type:'EndTurn' as const},result=e.step(action);supplyActions.push({turn:result.state.turn,action,error:result.error});if(result.error)throw new Error(JSON.stringify(result.error));}const result=e.step(record.action);supplyActions.push({...record,error:result.error});if(result.error)throw new Error(JSON.stringify(result.error));}
 const target=frontlines[0]!;
 for(let i=0;i<12&&!isHexSupplied(e.getState(),plant.position)&&!e.isGameOver();i++){
   const scout=e.getState().units.find(u=>u.type==='specialForces');
   const scoutMove=scout&&hexDistance(scout.position,target.position)>1?e.getLegalActions().filter(a=>a.type==='Move'&&a.unitId===scout.id&&hexKey(a.destination)!==hexKey(target.position)).sort((a,b)=>hexDistance((a as {destination:{q:number;r:number}}).destination,target.position)-hexDistance((b as {destination:{q:number;r:number}}).destination,target.position))[0]:undefined;
   if(scoutMove){const result=e.step(scoutMove);supplyActions.push({turn:result.state.turn,action:scoutMove,error:result.error});if(result.error)throw new Error(JSON.stringify(result.error));}
   const candidates=e.getLegalActions().filter(a=>a.type==='RelocateCheckpoint'&&a.branchId===target.branchId).sort((a,b)=>hexDistance((a as {position:{q:number;r:number}}).position,target.position)-hexDistance((b as {position:{q:number;r:number}}).position,target.position));
   const action=candidates[0];if(action){const before=e.getState(),result=e.step(action);supplyActions.push({turn:before.turn,action,error:result.error});if(result.error)throw new Error(JSON.stringify(result.error));}
   if(!isHexSupplied(e.getState(),plant.position)){const action={type:'EndTurn' as const},result=e.step(action);supplyActions.push({turn:result.state.turn,action,error:result.error});if(result.error)throw new Error(JSON.stringify(result.error));}
 }
 evidence.push({corner,seed,nuclear:plant.position,waterCount:bayLayout(corner).water.length,capitalDistance:hexDistance(capital.position,plant.position),groundPathCost:path.slice(1).reduce((n,p)=>n+resolve(p)!,0),groundPath:path.map(hexKey),frontlines,captureTurn,actions,supplyScenario:'default_supply_rules_without_initial_enemies',supplyActions,supplied:isHexSupplied(e.getState(),plant.position)});
}
writeFileSync('output/v163-map-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log(evidence.map(({corner,seed,nuclear,waterCount,capitalDistance,groundPathCost,frontlines,captureTurn})=>({corner,seed,nuclear,waterCount,capitalDistance,groundPathCost,frontlines,captureTurn})));
if(evidence.some(e=>e.frontlines.length===0||e.captureTurn===null||e.captureTurn>20||!e.supplied))process.exitCode=1;
