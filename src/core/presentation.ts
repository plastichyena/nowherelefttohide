import type { BarbedWireState, GameEvent, GameState, HexCoord, UnitState } from './types';
import { hexKey } from './hex';
import { getPlayerVisibleTileKeys } from './visibility';
import { effectiveZombieMovement } from './zombie-movement';

/** Deliberately excludes targets, RNG, pursuit memory and unseen entities. */
export type PresentationUnit = Pick<UnitState, 'id'|'type'|'position'|'hp'|'maxHp'|'isPlayerUnit'|'actionState'|'proficiency'|'mode'|'flightState'|'transportedByUnitId'|'cargoUnitId'|'movement'|'attack'|'range'|'vision'|'population'|'currentFuel'|'maxFuel'|'currentMilitaryGoods'|'maxMilitaryGoods'|'canMove'|'canAttack'|'attackChargesRemaining'|'maxAttackCharges'|'hordeKind'> & { effectiveMovement: number };
export interface PresentationSite { id: string; position: HexCoord; type?: string; status: string; owner?: string; operationalStatus?: string; healthyPopulation: number | null; infectedPopulation: number; waiting?:number; screening?:number; approved?:number; infected?:number }
export interface PresentationSnapshot { units: PresentationUnit[]; facilities: PresentationSite[]; checkpoints: PresentationSite[]; walls: BarbedWireState[]; visibleTileKeys: string[] }
export interface EntityDelta<T> { upsert: T[]; remove: string[] }
export interface PresentationFrame {
  actorId: string | null;
  units?: EntityDelta<PresentationUnit>; facilities?: EntityDelta<PresentationSite>; checkpoints?: EntityDelta<PresentationSite>; walls?: EntityDelta<BarbedWireState>;
  visibleTileKeys?: string[];
  cue?: { type: string; unitIds: string[]; position?: HexCoord };
}
export interface TurnPresentation { version: 1; turn: number; base: PresentationSnapshot; frames: PresentationFrame[] }
export interface PresentationEffect { position: HexCoord; kind: 'damage'|'appear'|'disappear'|'attack'|'gas_explosion'|'site' }

/** Effects use recorded public changes, including a visible unit's last position. */
export function presentationEffects(before:PresentationSnapshot,after:PresentationSnapshot,frame:PresentationFrame):PresentationEffect[] {
  const effects:PresentationEffect[]=[];
  for(const unit of after.units) {
    const old=before.units.find(u=>u.id===unit.id);
    if(!old)effects.push({position:unit.position,kind:'appear'});
    else if(unit.hp<old.hp)effects.push({position:unit.position,kind:'damage'});
  }
  for(const unit of before.units)if(!after.units.some(u=>u.id===unit.id))effects.push({position:unit.position,kind:'disappear'});
  for(const site of [...(frame.facilities?.upsert??[]),...(frame.checkpoints?.upsert??[]),...(frame.walls?.upsert??[])])effects.push({position:site.position,kind:'site'});
  for(const id of frame.walls?.remove??[]){const wall=before.walls.find(w=>w.id===id);if(wall)effects.push({position:wall.position,kind:'disappear'});}
  if(frame.cue?.type==='gas_explosion'&&frame.cue.position)effects.push({position:frame.cue.position,kind:'gas_explosion'});
  for(const id of frame.cue?.unitIds??[]) {
    const unit=after.units.find(u=>u.id===id)??before.units.find(u=>u.id===id);
    if(unit)effects.push({position:unit.position,kind:frame.cue?.type==='gas_explosion'?'gas_explosion':'attack'});
  }
  return effects;
}
interface Recorder { result: TurnPresentation; previous: PresentationSnapshot; actorId: string | null; visionKey: string; visible: Set<string> }
const recorders = new WeakMap<GameState, Recorder>();

function visionKey(state:Readonly<GameState>):string {
  return JSON.stringify([state.turn,state.units.filter(u=>u.isPlayerUnit).map(u=>[u.id,u.hp>0,u.position,u.vision,u.flightState,u.transportedByUnitId]),state.facilities.map(f=>[f.id,f.owner,f.status,f.operationalStatus,f.workers,f.position]),state.checkpoints.map(c=>[c.id,c.status,c.position]),state.roadBranches.map(b=>b.activeCheckpointId),state.militaryDrone]);
}
function snapshot(state: Readonly<GameState>, previous?: PresentationSnapshot, visible=getPlayerVisibleTileKeys(state)): PresentationSnapshot {
  const units = state.units.filter(u => u.hp > 0 && (u.isPlayerUnit || visible.has(hexKey(u.position)))).map(u => {
    const { id,type,position,hp,maxHp,isPlayerUnit,actionState,proficiency,mode,flightState,transportedByUnitId,cargoUnitId,movement,attack,range,vision,population,currentFuel,maxFuel,currentMilitaryGoods,maxMilitaryGoods,canMove,canAttack,attackChargesRemaining,maxAttackCharges,hordeKind } = u;
    return { id,type,position:{...position},hp,maxHp,isPlayerUnit,actionState,proficiency,mode,flightState,transportedByUnitId,cargoUnitId,movement,attack,range,vision,population,currentFuel,maxFuel,currentMilitaryGoods,maxMilitaryGoods,canMove,canAttack,attackChargesRemaining,maxAttackCharges,hordeKind,effectiveMovement:effectiveZombieMovement(u) };
  });
  const facilities = state.facilities.map(f => {
    if (!visible.has(hexKey(f.position))) return previous?.facilities.find(p => p.id === f.id) ?? { id:f.id,position:{...f.position},type:f.type,status:f.owner==='player'?f.status:'unowned',owner:f.owner,healthyPopulation:f.owner==='player'?f.workers:null,infectedPopulation:0 };
    return { id:f.id,position:{...f.position},type:f.type,status:f.status,owner:f.owner,operationalStatus:f.operationalStatus,healthyPopulation:f.owner==='player'?f.workers:null,infectedPopulation:f.infected };
  });
  const checkpoints = state.checkpoints.map(c => (!visible.has(hexKey(c.position))?previous?.checkpoints.find(p=>p.id===c.id):null)??({ id:c.id,position:{...c.position},status:c.status,waiting:c.waiting,screening:c.screening,approved:c.approved,infected:c.infected,healthyPopulation:c.waiting+c.screening+c.approved,infectedPopulation:c.infected }));
  for(const site of previous?.facilities??[])if(!facilities.some(f=>f.id===site.id)&&!visible.has(hexKey(site.position)))facilities.push(site);
  for(const site of previous?.checkpoints??[])if(!checkpoints.some(c=>c.id===site.id)&&!visible.has(hexKey(site.position)))checkpoints.push(site);
  return { units,facilities,checkpoints,walls:state.barbedWire.filter(w => w.hp > 0 && visible.has(hexKey(w.position))).map(w=>({...w,position:{...w.position}})),visibleTileKeys:[...visible].sort() };
}

export function beginTurnPresentation(state: GameState): void {
  const visible=getPlayerVisibleTileKeys(state),base=snapshot(state,undefined,visible);
  recorders.set(state,{result:{version:1,turn:state.turn,base,frames:[]},previous:base,actorId:null,visionKey:visionKey(state),visible});
}
export function presentationActor(state: GameState, id: string | null): void {
  capturePresentation(state);
  const recorder=recorders.get(state);if(recorder)recorder.actorId=id;
}
function delta<T extends {id:string}>(before:T[],after:T[]):EntityDelta<T>|undefined {
  const byId=new Map(before.map(v=>[v.id,v]));const ids=new Set(after.map(v=>v.id));
  const upsert=after.filter(v=>JSON.stringify(v)!==JSON.stringify(byId.get(v.id)));
  const remove=before.filter(v=>!ids.has(v.id)).map(v=>v.id);
  return upsert.length||remove.length?{upsert,remove}:undefined;
}
export function capturePresentation(state: GameState, event?: GameEvent): void {
  const recorder=recorders.get(state);if(!recorder)return;
  const key=visionKey(state);if(key!==recorder.visionKey){recorder.visionKey=key;recorder.visible=getPlayerVisibleTileKeys(state);}
  const next=snapshot(state,recorder.previous,recorder.visible),previous=recorder.previous;
  const known=new Set([...previous.units,...next.units].map(u=>u.id));
  const frame:PresentationFrame={actorId:recorder.actorId&&known.has(recorder.actorId)?recorder.actorId:null};
  for(const key of ['units','facilities','checkpoints','walls'] as const) {
    const change=delta(previous[key] as Array<{id:string}>,next[key] as Array<{id:string}>);
    if(change)Object.assign(frame,{[key]:change});
  }
  if(previous.visibleTileKeys.join('|')!==next.visibleTileKeys.join('|'))frame.visibleTileKeys=next.visibleTileKeys;
  if(event?.type==='gas_explosion'&&typeof event.payload.q==='number'&&typeof event.payload.r==='number') {
    // The source is already dead and removed from the preceding snapshot.
    // Only an explosion at a currently visible Hex may publish its position.
    const position={q:event.payload.q,r:event.payload.r};
    if(recorder.visible.has(hexKey(position)))frame.cue={type:event.type,unitIds:[],position};
  } else if(event&&['attack','counterattack','interception'].includes(event.type)) {
    const ids=['attackerId','defenderId','sourceUnitId'].map(k=>event.payload[k]).filter((id):id is string=>typeof id==='string');
    if(ids.length&&ids.every(id=>known.has(id)))frame.cue={type:event.type,unitIds:ids};
  }
  if(Object.keys(frame).length>1)recorder.result.frames.push(frame);
  recorder.previous=next;
}
export function finishTurnPresentation(state:GameState):TurnPresentation|null {
  capturePresentation(state);const recorder=recorders.get(state);recorders.delete(state);
  return recorder?.result.frames.length?recorder.result:null;
}

/** Pure display reducer, also shared by all three viewers and tests. */
export function applyPresentationFrame(before:PresentationSnapshot,frame:PresentationFrame):PresentationSnapshot {
  const after={...before,visibleTileKeys:frame.visibleTileKeys??before.visibleTileKeys};
  for(const key of ['units','facilities','checkpoints','walls'] as const) {
    const change=frame[key];if(!change)continue;
    const items=new Map<string,{id:string}>(before[key].map(v=>[v.id,v]));
    for(const id of change.remove)items.delete(id);for(const value of change.upsert)items.set(value.id,value);
    Object.assign(after,{[key]:[...items.values()]});
  }
  return after;
}
