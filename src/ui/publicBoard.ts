import type { AgentMapObservation, AgentObservation } from '../agent/types';
import type { SessionPublicDocument } from '../session/types';
import type { HexCoord } from '../core/types';
import { hexDistance, hexKey } from '../core/hex';
import { roadEdges } from '../core/roads';
import { BOARD_ASSET_REGISTRY, resolveBoardAssetUrl, resolveUnitAssetPath, mapFacilityAssetLayers, mapCheckpointAssetLayers, mapUnitAssetLayers } from './boardAssets';
import { createTranslator, type Locale } from './i18n';

export interface PublicBoardFrame {
  map: AgentMapObservation;
  observation: SessionPublicDocument['observation'];
}
export function publicBoardFrame(observation: AgentObservation | SessionPublicDocument['observation'], map?: AgentMapObservation): PublicBoardFrame {
  const resolved = map ?? ('map' in observation ? observation.map as AgentMapObservation : undefined);
  if (!resolved) throw new Error('Public board requires its public map');
  if ('map' in observation) {
    const { map: _map, ...document } = observation;
    return { map:resolved, observation:{ ...document, mapId:resolved.id, visibleTileKeys:resolved.tiles.filter(t=>t.visibleToPlayer).map(hexKey) } };
  }
  return { map: resolved, observation };
}
export interface PublicBoardEntity { key: string; kind: 'unit'|'facility'|'checkpoint'; position: HexCoord; data: Record<string,unknown> }
export function publicBoardEntities(frame: PublicBoardFrame): PublicBoardEntity[] {
  const visible=new Set(frame.observation.visibleTileKeys);
  return [
    ...[...frame.observation.units.filter(u=>!u.transportedByUnitId),...frame.observation.zombies.filter(u=>visible.has(hexKey(u.position)))].map(u=>({key:`unit:${u.id}`,kind:'unit' as const,position:u.position,data:u as unknown as Record<string,unknown>})),
    ...frame.observation.facilities.map(f=>({key:`facility:${f.id}`,kind:'facility' as const,position:f.position,data:f as unknown as Record<string,unknown>})),
    ...frame.observation.checkpoints.map(c=>({key:`checkpoint:${c.id}`,kind:'checkpoint' as const,position:c.position,data:c as unknown as Record<string,unknown>})),
  ].sort((a,b)=>(a.kind==='unit'?(a.data.flightState==='airborne'?2:1):0)-(b.kind==='unit'?(b.data.flightState==='airborne'?2:1):0));
}

/** Shared Live/Replay renderer: accepts only public projections, never GameState. */
export class PublicBoardRenderer {
  private frame: PublicBoardFrame | null=null;
  private entities: PublicBoardEntity[]=[];
  private selected: string|null=null;
  private zoom=1; private panX=0; private panY=0;
  private images=new Map<string,HTMLImageElement>();
  private disposed=false;
  private resize: ResizeObserver;
  private pointers=new Map<number,{x:number;y:number;startX:number;startY:number;dragged:boolean}>();
  constructor(private canvas: HTMLCanvasElement, private details: HTMLElement, private locale: Locale) {
    canvas.style.touchAction='none';canvas.tabIndex=0;
    canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,dragged:false});};
    canvas.onpointermove=e=>{
      const old=this.pointers.get(e.pointerId);if(!old)return;
      const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];
      if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>0)this.zoom=Math.max(.5,Math.min(16,this.zoom*after/before));old.dragged=other.dragged=true;}
      else {this.panX+=e.clientX-old.x;this.panY+=e.clientY-old.y;old.dragged ||= Math.hypot(e.clientX-old.startX,e.clientY-old.startY)>5;}
      old.x=e.clientX;old.y=e.clientY;this.draw();
    };
    canvas.onpointerup=e=>{const pointer=this.pointers.get(e.pointerId);this.pointers.delete(e.pointerId);if(pointer&&!pointer.dragged)this.selectAt(e.clientX,e.clientY);};
    canvas.onpointercancel=e=>{this.pointers.delete(e.pointerId);};
    canvas.onwheel=e=>{e.preventDefault();this.zoom=Math.max(.5,Math.min(16,this.zoom*Math.exp(-e.deltaY*.001)));this.draw();};
    canvas.onkeydown=e=>{if(e.key==='Escape'){this.selected=null;this.renderDetails();this.draw();}};
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(canvas);
  }
  setFrame(frame: PublicBoardFrame): void {
    this.frame=frame;this.entities=publicBoardEntities(frame);
    if(!this.entities.some(e=>e.key===this.selected))this.selected=null;
    this.renderDetails();this.draw();
  }
  setLocale(locale: Locale): void { this.locale=locale; }
  fit(): void {this.zoom=1;this.panX=this.panY=0;this.draw();}
  clear(): void {this.frame=null;this.entities=[];this.selected=null;this.details.replaceChildren();this.draw();}
  dispose(): void {this.disposed=true;this.resize.disconnect();this.images.clear();this.pointers.clear();}
  private geometry() {
    const rect=this.canvas.getBoundingClientRect(), width=Math.max(1,rect.width),height=Math.max(1,rect.height),map=this.frame?.map;
    const columns=map?.width??51,rows=map?.height??51;
    const spanX=Math.sqrt(3)*(columns-1+(rows-1)/2)+2,spanY=1.5*(rows-1)+2;
    const scale=Math.min(width/spanX,height/spanY)*.94*this.zoom;
    return {rect,width,height,scale,transform:(p:HexCoord)=>({x:width/2+(Math.sqrt(3)*(p.q+p.r/2)-(spanX-2)/2)*scale+this.panX,y:height/2+(1.5*p.r-(spanY-2)/2)*scale+this.panY})};
  }
  private sprite(ctx:CanvasRenderingContext2D,path:string,x:number,y:number,size:number):boolean {
    let img=this.images.get(path);
    if(!img){img=new Image();img.onload=()=>{if(!this.disposed)this.draw();};img.src=resolveBoardAssetUrl(path);this.images.set(path,img);}
    if(img.complete&&img.naturalWidth){ctx.drawImage(img,x-size/2,y-size/2,size,size);return true;}return false;
  }
  private selectAt(clientX:number,clientY:number):void {
    const g=this.geometry(),x=clientX-g.rect.left,y=clientY-g.rect.top;
    const candidates=this.entities.map(e=>({entity:e,at:g.transform(e.position)})).filter(e=>Math.hypot(e.at.x-x,e.at.y-y)<=Math.max(14,g.scale)).sort((a,b)=>Math.hypot(a.at.x-x,a.at.y-y)-Math.hypot(b.at.x-x,b.at.y-y));
    const at=candidates[0]?.entity.position,coLocated=candidates.filter(c=>at&&hexKey(c.entity.position)===hexKey(at));
    const index=coLocated.findIndex(c=>c.entity.key===this.selected);
    this.selected=coLocated.length?coLocated[(index+1)%coLocated.length]!.entity.key:null;this.renderDetails();this.draw();
  }
  private renderDetails():void {
    this.details.replaceChildren();const e=this.entities.find(e=>e.key===this.selected);
    this.details.dataset.selection=e?.key??'';
    if(!e){this.details.textContent=this.locale==='ja'?'盤面の部隊・施設・検問所を選択すると詳細を表示します。':'Select a unit, facility or checkpoint for details.';return;}
    const d=e.data,heading=document.createElement('strong');
    heading.textContent=e.kind==='unit'?createTranslator(this.locale)(String(d.type),String(d.type)):e.kind==='facility'?createTranslator(this.locale)(`facility.${d.type}`,String(d.type)):this.locale==='ja'?'検問所':'Checkpoint';
    this.details.append(heading);
    const rows:Array<[string,unknown]>=[['ID',d.id],['Hex',`${e.position.q}, ${e.position.r}`]];
    const label=(ja:string,en:string)=>this.locale==='ja'?ja:en;
    const t=createTranslator(this.locale);
    if(this.frame?.observation.militaryDrone?.active){const drone=this.frame.observation.militaryDrone;rows.push([label('軍用ドローン','Military Drone'),`${drone.center?.q},${drone.center?.r} · ${label('半径','Radius')} ${drone.radius} · Turn ${(drone.expiresBeforeTurn??0)-1}`]);}
    if(e.kind==='unit'){
      rows.push(['HP',`${d.hp} / ${d.maxHp}`],[label('状態','Mode'),d.mode==='packed'?label('梱包','Packed'):d.mode==='deployed'?label('展開','Deployed'):undefined],[label('熟練度','Proficiency'),d.proficiency? t(`proficiency.${d.proficiency}`,String(d.proficiency)):undefined],[label('攻撃 / 射程','Attack / Range'),`${d.attack} / ${d.artillery?(d.artillery as {minRange:number}).minRange+'–':''}${d.range}`],[label('燃料','Fuel'),`${d.currentFuel} / ${d.maxFuel}`],[label('軍需品','Military Goods'),`${d.currentMilitaryGoods} / ${d.maxMilitaryGoods}`],[label('攻撃回数','Charges'),`${d.attackChargesRemaining} / ${d.maxAttackCharges}`],[label('補給','Supply'),d.inSupply?label('補給内','In supply'):label('補給外','Out of supply')],[label('行動解禁ターン','Unlock turn'),d.modeLockedUntilTurn]);
      rows.push([label('飛行状態','Flight'),d.flightState?label(d.flightState==='airborne'?'飛行中':'着陸中',String(d.flightState)):undefined],[label('搭乗部隊','Cargo'),d.cargoUnitId],[label('対空攻撃','Anti-air'),d.canTargetAir?label('可能','Yes'):label('不可','No')]);
      const production=d.production as {completed:number;reserved:number;remaining:number|null}|undefined;
      if(production?.remaining!==null&&production)rows.push([label('生涯生産 / 予約 / 残枠','Lifetime / Reserved / Remaining'),`${production.completed} / ${production.reserved} / ${production.remaining}`]);
      const capabilities=d.capabilities as Record<string,boolean>|undefined;
      if(capabilities)rows.push([label('確保 / 復旧 / 鎮圧 / 封じ込め','Capture / Recover / Suppress / Contain'),['capture','recoverCheckpoint','suppress','contain'].map(k=>capabilities[k]?'✓':'—').join(' / ')]);
    } else if(e.kind==='facility'){
      rows.push([label('所有 / 稼働状態','Owner / Operation'),`${d.owner==='player'?label('自国','Owned'):label('未確保','Unsecured')} / ${t(String(d.operationalStatus),String(d.operationalStatus))}`],[label('健康人口 / 感染者','Healthy / Infected'),d.owner==='player'?`${d.healthyPopulation} / ${d.infectedPopulation}`:label('非公開','Not public')],[label('補給','Supply'),d.inSupply?label('補給内','In supply'):label('補給外','Out of supply')],[label('停止理由','Stopped reason'),(d.production as {stoppedReason?:string})?.stoppedReason]);
      const base=d.armyBase as {militaryGoods:number;interceptionsRemaining:number;rewardStatus:string;pendingRecruitment?:{unitType:string;readyTurn:number;status:string}}|undefined;
      if(base){rows.push([label('基地軍需品 / 迎撃残数','Base ammunition / Interceptions'),`${base.militaryGoods} / ${base.interceptionsRemaining}`],[label('確保報酬','Capture reward'),base.rewardStatus]);if(base.pendingRecruitment)rows.push([label('生産予約','Reservation'),`${t(base.pendingRecruitment.unitType)} · Turn ${base.pendingRecruitment.readyTurn} · ${base.pendingRecruitment.status}`]);}
    } else {
      rows.push([label('役割 / 状態','Role / Status'),`${t(String(d.role),String(d.role))} / ${t(String(d.status),String(d.status))}`],[label('待機 / 審査 / 承認済み','Waiting / Screening / Approved'),`${d.waiting} / ${d.screening} / ${d.approved}`],[label('感染者','Infected'),d.infected]);
      const recovery=d.recovery as {ready:boolean;missing:string[]}|undefined;
      if(recovery)rows.push([label('自動復旧','Automatic recovery'),recovery.ready?label('条件成立','Ready'):recovery.missing.map(k=>({not_ruined:label('陥落していません','Not ruined'),suppress_infection:label('感染者あり','Infection'),clear_visible_enemy:label('同Hexに敵','Enemy on Hex'),station_recovery_capable_unit:label('復旧可能な部隊が必要','Capable garrison required')}[k]??k)).join(' / ')]);
    }
    const dl=document.createElement('dl');for(const [name,value] of rows){if(value===undefined||value===null)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=String(value);dl.append(dt,dd);}this.details.append(dl);
  }
  draw(): void {
    if(this.disposed)return;
    const g=this.geometry(),dpr=Math.min(window.devicePixelRatio||1,2,Math.sqrt(2048*2048/(g.width*g.height)));
    this.canvas.width=Math.max(1,Math.floor(g.width*dpr));this.canvas.height=Math.max(1,Math.floor(g.height*dpr));this.canvas.dataset.backingPixels=String(this.canvas.width*this.canvas.height);
    this.canvas.dataset.zoom=String(this.zoom);this.canvas.dataset.pan=`${this.panX},${this.panY}`;
    const ctx=this.canvas.getContext('2d');if(!ctx)throw new Error('canvas_context_unavailable');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#121b19';ctx.fillRect(0,0,g.width,g.height);
    if(!this.frame)return;const {map,observation}=this.frame,visible=new Set(observation.visibleTileKeys);
    const tiles=new Map(map.tiles.map(t=>[hexKey(t),t]));
    for(const tile of map.tiles){const p=g.transform(tile);if(p.x < -g.scale||p.y < -g.scale||p.x>g.width+g.scale||p.y>g.height+g.scale)continue;
      ctx.beginPath();for(let k=0;k<6;k++){const a=(60*k-30)*Math.PI/180,x=p.x+Math.cos(a)*g.scale,y=p.y+Math.sin(a)*g.scale;k?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fillStyle=tile.terrain==='forest'?'#355447':tile.terrain==='mountain'?'#5d615d':tile.terrain==='water'?'#345569':'#6b7053';ctx.globalAlpha=visible.has(hexKey(tile))?1:.3;ctx.fill();if(this.zoom>=1.5){ctx.save();ctx.clip();this.sprite(ctx,BOARD_ASSET_REGISTRY.terrain[tile.terrain],p.x,p.y,g.scale*2);ctx.restore();}ctx.globalAlpha=1;const drone=observation.militaryDrone;if(drone?.active&&drone.center&&hexDistance(tile,drone.center)===drone.radius){ctx.strokeStyle='#77ddff';ctx.lineWidth=1.5;ctx.stroke();}if(drone?.active&&drone.center&&hexDistance(tile,drone.center)===0){ctx.fillStyle='#77ddff';ctx.font=`${Math.max(11,g.scale)}px sans-serif`;ctx.fillText('D',p.x,p.y-g.scale);}
    }
    if(map.roads)for(const edge of roadEdges(map.roads)){const a=g.transform(edge.a),b=g.transform(edge.b);ctx.strokeStyle=edge.role==='trunk'?'#b5a98d':edge.role==='collector'?'#968e7b':'#777467';ctx.lineWidth=Math.max(.5,g.scale*(edge.role==='trunk'?.28:.13));ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();if(this.zoom>=1.5)for(const [tile,at,other] of [[edge.a,a,b],[edge.b,b,a]] as const){if(tiles.get(hexKey(tile))?.terrain!=='water')continue;ctx.save();ctx.translate(at.x,at.y);ctx.rotate(Math.atan2(other.y-at.y,other.x-at.x));this.sprite(ctx,BOARD_ASSET_REGISTRY.overlays.bridge,0,0,Math.hypot(other.x-at.x,other.y-at.y));ctx.restore();}}
    for(const wire of observation.barbedWire){const p=g.transform(wire.position);ctx.strokeStyle='#e4e9ed';ctx.strokeRect(p.x-g.scale*.7,p.y-g.scale*.7,g.scale*1.4,g.scale*1.4);if(this.zoom>=1.5)this.sprite(ctx,BOARD_ASSET_REGISTRY.obstacles.barbedWire,p.x,p.y,g.scale*2);}
    // Facilities first, Units last. Selection remains independent of draw order.
    for(const e of this.entities){const p=g.transform(e.position),d=e.data;if(d.flightState==='airborne'){p.x+=g.scale*.35;p.y-=g.scale*.35;}const path=e.kind==='unit'?resolveUnitAssetPath({type:d.type as never,mode:d.mode as never,flightState:d.flightState as never}):e.kind==='checkpoint'?BOARD_ASSET_REGISTRY.facilities.checkpoint:BOARD_ASSET_REGISTRY.facilities[d.type as keyof typeof BOARD_ASSET_REGISTRY.facilities];ctx.fillStyle=e.kind==='unit'?(observation.units.some(u=>u.id===d.id)?'#67d5c7':'#e8796b'):e.kind==='checkpoint'?'#d7a14d':d.owner==='player'?'#dfce85':'#8d8b80';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,g.scale*.5),0,Math.PI*2);ctx.fill();if(path&&this.zoom>=1.5){
      const size=Math.max(14,g.scale*2);this.sprite(ctx,path,p.x,p.y,size);
      const overlays=e.kind==='facility'?mapFacilityAssetLayers({type:d.type as never,owner:d.owner as never,status:d.status as never,operationalStatus:d.operationalStatus as never,infected:Number(d.infectedPopulation??0)}).overlays:e.kind==='checkpoint'?mapCheckpointAssetLayers({status:d.status as never,infected:Number(d.infected??0)}).overlays:mapUnitAssetLayers({type:d.type as never,mode:d.mode as never,flightState:d.flightState as never,hordeKind:d.isFinalWaveMember?'final':d.isScheduledWaveMember?'periodic':null}).overlays;
      for(const overlay of overlays)this.sprite(ctx,overlay,p.x,p.y,size);
    }if(d.flightState==='airborne'||d.cargoUnitId){ctx.fillStyle='#efffff';ctx.font=`${Math.max(10,g.scale*.65)}px sans-serif`;ctx.fillText(`${d.flightState==='airborne'?'▲':''}${d.cargoUnitId?'▣':''}`,p.x,p.y-g.scale*.7);}if(this.selected===e.key){ctx.strokeStyle='#ffe28a';ctx.lineWidth=2;ctx.strokeRect(p.x-g.scale,p.y-g.scale,g.scale*2,g.scale*2);}}
  }
}
