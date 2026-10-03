import {GameEngine,validateAction} from '../core/engine';
import {createInitialState,cloneState} from '../core/state';
import {createDefaultConfig} from '../core/config';
import {findShortestPath} from '../core/path';
import {reachableDestinations,previewMove} from '../core/movement-query';
import {createMovementCostResolver} from '../core/terrain';
import {hexKey,hexDistance,hexNeighbors} from '../core/hex';
import {getSectorBranchIds,isHexSuppliedByBranch,isHexSupplied} from '../core/supply';
import type {GameAction,GameState} from '../core/types';

/** Isolated terrain fixture: remove enemy actors after each turn, retaining
 * every human, resource cost, arrival, visibility, supply and movement rule. */
export function verifyTerrainRoute(seed:number,facilityId:string) {
  const initial=createInitialState(seed,createDefaultConfig());
  initial.units=initial.units.filter(u=>u.isPlayerUnit);
  const engine=GameEngine.fromSnapshot(initial), actions:Array<{turn:number;action:GameAction;mp?:number;fuel?:number}>=[];
  const target=initial.facilities.find(f=>f.id===facilityId)!;
  const branch=initial.map.roadBranches.find(b=>getSectorBranchIds(initial.map,target.position).includes(b.id))!;
  const posts=branch.roadTiles.filter(p=>initial.map.tiles.find(t=>t.key===hexKey(p))?.playerOccupancyAllowed&&!initial.facilities.some(f=>hexKey(f.position)===hexKey(p))&&isHexSuppliedByBranch(initial,target.position,branch.id,p));
  posts.sort((a,b)=>hexDistance({q:25,r:25},a)-hexDistance({q:25,r:25},b));
  if(!posts[0])throw new Error(`No supply post for ${facilityId}`);
  const apply=(action:GameAction)=>{const before=engine.getState(),move=action.type==='Move'?previewMove(before,action.unitId,action.destination):null;const result=engine.step(action);if(result.error)throw new Error(`${facilityId}: ${result.error.code}`);actions.push({turn:before.turn,action,...(move?{mp:move.effectiveMovementCost,fuel:move.fuelCost}:{})});};
  let capturedTurn:number|null=null,suppliedTurn:number|null=null;
  for(let round=0;round<10;round++){
    let s=engine.getState();
    const f=s.facilities.find(f=>f.id===facilityId)!;
    if(f.owner==='player')capturedTurn??=s.turn;
    if(isHexSupplied(s,f.position))suppliedTurn??=s.turn;
    if(capturedTurn!==null&&suppliedTurn!==null)break;
    const unit=s.units.find(u=>u.id==='recon-team-1')!;
    const blocked=new Set(s.units.filter(u=>u.id!==unit.id).map(u=>hexKey(u.position)));
    for(const t of s.map.tiles)if(!t.playerOccupancyAllowed)blocked.add(t.key);
    // Keep the whole capital corridor visible while choosing the remote post;
    // walking straight to a distant site can leave an unobserved gap behind.
    const radius=hexDistance({q:25,r:25},posts[0]!);
    const anchor=radius>15?branch.roadTiles.find(p=>hexDistance({q:25,r:25},p)===radius-8)??posts[0]!:posts[0]!;
    const scout=radius>15&&!blocked.has(hexKey(anchor))?anchor:hexNeighbors(anchor).filter(p=>!blocked.has(hexKey(p))&&!branch.roadTiles.some(r=>hexKey(r)===hexKey(p))&&createMovementCostResolver(s,true)(p)!==null).sort((a,b)=>hexDistance(a,f.position)-hexDistance(b,f.position))[0];
    const destination=isHexSupplied(s,f.position)?f.position:scout??f.position;
    const path=findShortestPath(s.map,unit.position,destination,blocked,createMovementCostResolver(s,true));
    const legal=new Set(reachableDestinations(s as GameState,unit).map(hexKey));
    const next=path?.filter(p=>legal.has(hexKey(p))).at(-1);
    if(next&&hexKey(next)!==hexKey(unit.position))apply({type:'Move',unitId:unit.id,destination:next});
    s=engine.getState();
    const active=s.roadBranches.find(b=>b.branchId===branch.id)?.activeCheckpointId;
    const current=s.checkpoints.find(c=>c.id===active)!;
    const candidates=branch.roadTiles.filter(p=>hexDistance({q:25,r:25},p)>hexDistance({q:25,r:25},current.position)&&hexDistance({q:25,r:25},p)<=hexDistance({q:25,r:25},posts[0]!)+2).reverse();
    candidates.sort((a,b)=>hexDistance({q:25,r:25},b)-hexDistance({q:25,r:25},a));
    const relocation=candidates.map(position=>({type:'RelocateCheckpoint' as const,checkpointId:current.id,branchId:branch.id,position})).find(a=>validateAction(s as GameState,a)===null);
    if(relocation)apply(relocation);
    s=engine.getState();
    if(s.facilities.find(f=>f.id===facilityId)!.owner==='player')capturedTurn??=s.turn;
    if(isHexSupplied(s,target.position))suppliedTurn??=s.turn;
    if(capturedTurn!==null&&suppliedTurn!==null)break;
    apply({type:'EndTurn'});
    const cleaned=cloneState(engine.getState() as GameState);cleaned.units=cleaned.units.filter(u=>u.isPlayerUnit);
    const loaded=engine.step({type:'LoadSnapshot',snapshot:cleaned});if(loaded.error)throw new Error(loaded.error.message);
  }
  if(capturedTurn===null||suppliedTurn===null)throw new Error(`terrain_route_failed:${seed}:${facilityId}:${JSON.stringify(actions)}`);
  return {seed,facilityId,capturedTurn,suppliedTurn,mp:actions.reduce((n,a)=>n+(a.mp??0),0),fuel:actions.reduce((n,a)=>n+(a.fuel??0),0),actions};
}
