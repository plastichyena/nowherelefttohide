import { Digest } from '../replay/digest';
import fallbackTemplate from './random-fallback.json';
import { FIXED_MAP, FIXED_MAP_ID, getHordeSpawnZone } from './map';
import { INITIAL_HUMAN_DEPLOYMENT, INITIAL_CHECKPOINT_DEPLOYMENT } from './initial-deployment';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { SeededRng } from './rng';
import { roadConnections } from './roads';
import { effectiveMovementCost } from './terrain';
import { getSectorBranchIds, isHexSuppliedByBranch } from './supply';
import { APP_VERSION, CONFIG_VERSION, RANDOM_MAP_ID, GENERATOR_VERSION, MAP_SETTINGS_VERSION, FALLBACK_ID } from './versions';
import type { BaseTerrain, FacilityDefinition, FixedMap, GameConfig, GameState, HexCoord, HexTile } from './types';

export type MapMode = 'random' | 'fixed';
export interface MapDescriptor {
  scenario: GameConfig['scenarioId']; mode: MapMode; rootSeed: number; mapSeed: number; gameplaySeed: number;
  generator: string; generatorVersion: string; settingsId: string; settings: MapSettings;
  attempt: number; fallback: null | { id: string; version: string; reason: string };
  mapHash: string; configVersion: string; appVersion: string; build: string;
}
export interface MapSettings {
  version: string; initialSupplyRadius: number; capacities: Record<string, number>;
  movementCost: GameConfig['terrain']['movementCost'];
}
export interface GenerationProgress { stage: 'terrain' | 'hydrology' | 'layout' | 'roads' | 'validation' | 'fallback' | 'initialization' | 'rejected'; reason?: string; attempt: number; maxAttempts: number }
export const MAP_GENERATION_LIMITS = Object.freeze({ attempts: 64, enemyAttempts: 8, maxTerrainRepairs: 160, buildablePlain: 12 });
const CENTER = { q: 25, r: 25 };
const order = (a: HexCoord, b: HexCoord) => a.q - b.q || a.r - b.r;
export const canonicalMapValue = (value: unknown): string => JSON.stringify(value, function (_key, v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
});
export const mapContentHash = (value: unknown): string => new Digest().update(new TextEncoder().encode(canonicalMapValue(value))).hex();
/** UTF-8, FNV-1a uint32, integer overflow via imul; no locale or floating seed conversion. */
export function mapDomainSeed(seed: number, domain: string, attempt = 0): number {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(`${GENERATOR_VERSION}|${seed}|${attempt}|${domain}`)) h = Math.imul(h ^ b, 16777619);
  return h >>> 0;
}
export function mapSettings(config: GameConfig): MapSettings {
  return { version: MAP_SETTINGS_VERSION, initialSupplyRadius: config.checkpoint.initialSupplyRadius,
    capacities: Object.fromEntries(Object.entries(config.facilities).map(([k, v]) => [k, v.workerCapacity])),
    movementCost: { ...config.terrain.movementCost } };
}
/** Only public initial geography. No population, enemy positions, visibility or RNG snapshots. */
export function publicStaticMap(map: FixedMap) {
  return { id: map.id, width: map.width, height: map.height, tiles: [...map.tiles].sort(order), roads: map.roads,
    roadTiles: map.roadTiles, roadBranches: map.roadBranches, hordeEntrances: map.hordeEntrances, hordeSpawnReserve: map.hordeSpawnReserve,
    facilities: map.facilities.map(({ id, type, position, workerCapacity }) => ({ id, type, position, workerCapacity })),
    ...(map.generation ? {generation:map.generation}: {}) };
}
export function describeMap(map: FixedMap, seed: number, config: GameConfig, attempt = 0, fallback: MapDescriptor['fallback'] = null): MapDescriptor {
  const settings = mapSettings(config);
  return { scenario: config.scenarioId, mode: config.mapMode, rootSeed: seed, mapSeed: config.mapSeed ?? seed,
    gameplaySeed: config.gameplaySeed ?? seed, generator: config.mapMode === 'fixed' ? FIXED_MAP_ID : RANDOM_MAP_ID,
    generatorVersion: config.mapMode === 'fixed' ? FIXED_MAP_ID : GENERATOR_VERSION, settingsId: mapContentHash(settings), settings,
    attempt, fallback, mapHash: mapContentHash(publicStaticMap(map)), configVersion: CONFIG_VERSION, appVersion: APP_VERSION,
    build: `${APP_VERSION}/${GENERATOR_VERSION}/${MAP_SETTINGS_VERSION}` };
}
const reserved = new Set([hexKey(CENTER), ...INITIAL_HUMAN_DEPLOYMENT.map(u => hexKey(u.position)), ...INITIAL_CHECKPOINT_DEPLOYMENT.map(c => hexKey(c.position))]);

function terrainCost(terrain: BaseTerrain) { return terrain === 'water' ? null : terrain === 'mountain' ? 3 : terrain === 'forest' ? 2 : 1; }
function setTerrain(tile: HexTile, terrain: BaseTerrain) { tile.terrain = terrain; tile.movementCost = terrainCost(terrain); }

/** Smooth integer lattice noise: owned implementation, no third-party dependency. */
function field(rng: SeededRng, scale: number) {
  const grid = Array.from({ length: 16 * 16 }, () => rng.nextInt(0, 65535));
  return (q: number, r: number) => {
    const x = Math.floor(q / scale), y = Math.floor(r / scale), u = q % scale, v = r % scale;
    return grid[y * 16 + x]! * (scale-u) * (scale-v) + grid[y * 16+x+1]! * u * (scale-v)
      + grid[(y+1)*16+x]! * (scale-u) * v + grid[(y+1)*16+x+1]! * u * v;
  };
}
function createCandidate(seed: number, config: GameConfig, attempt: number, progress?: (p: GenerationProgress) => void): FixedMap {
  const stage = (stage: GenerationProgress['stage']) => progress?.({ stage, attempt, maxAttempts: MAP_GENERATION_LIMITS.attempts });
  const settingsKey = mapContentHash(mapSettings(config));
  const domain = (name: string) => new SeededRng(mapDomainSeed(seed, `${settingsKey}/${name}`, attempt));
  const map = structuredClone(FIXED_MAP);
  map.id = RANDOM_MAP_ID; map.initialZombiePositions = [];
  const byKey = new Map(map.tiles.map(t => [t.key, t]));
  stage('terrain');
  for (const t of map.tiles) { setTerrain(t, 'plain'); t.facilityId = null; t.road = t.q === 25 || t.r === 25; }
  const noise = field(domain('terrain'), 7);
  const available = map.tiles.filter(t => !reserved.has(t.key) && !t.road);
  const sorted = [...available].sort((a,b) => noise(b.q,b.r)-noise(a.q,a.r) || order(a,b));
  sorted.slice(0, 230).forEach(t => setTerrain(t, 'mountain'));
  sorted.slice(230, 820).forEach(t => setTerrain(t, 'forest'));
  stage('hydrology');
  const waterRng = domain('hydrology');
  const side = waterRng.nextBoolean() ? 1 : -1;
  const baseQ = side === 1 ? waterRng.nextInt(35,39) : waterRng.nextInt(10,14);
  let q = baseQ;
  const river: HexCoord[] = [];
  for (let r = 0; r <= 50; r++) {
    if (r > 0 && r % 5 === 0) {
      const next = Math.max(baseQ-2, Math.min(baseQ+2, q + (waterRng.nextBoolean() ? 1 : -1)));
      if (next !== q) river.push({ q: next, r: r-1 });
      q = next;
    }
    river.push({ q, r });
  }
  // One continuous source-to-outlet river with a connected inland lake.
  const lakeRow=waterRng.nextBoolean()?12:38;
  const lake = river.find(p => p.r === lakeRow)!;
  const water = new Set(river.flatMap(p => [hexKey(p), hexKey({ q: p.q+1, r: p.r })]));
  for (const t of map.tiles) if (hexDistance(t,lake) <= 2) water.add(t.key);
  for (const key of water) setTerrain(byKey.get(key)!, 'water');
  // Fixed trunks remain straight; water survives beneath the bridge overlay.
  map.roads = { generatorVersion: 'connector-roads-v1', layoutSeed: seed, settingsId: settingsKey, inputHash: '', segments:
    map.roadBranches.map(b => ({ id: `trunk-${b.id}`, role: 'trunk', path: [b.capitalConnection, ...b.roadTiles] })) };
  for (const r of [10,40]) {
    const line = Array.from({ length: Math.abs(25-(baseQ+side*5))+1 }, (_,i) => ({ q: 25 + Math.sign(baseQ-25)*i, r }));
    map.roads.segments.push({ id: `river-crossing-${r}`, role: 'collector', path: line });
  }
  stage('layout');
  const layout = domain('layout');
  const facilities: FacilityDefinition[] = structuredClone(FIXED_MAP.facilities);
  const oil = facilities.find(f=>f.type==='oilField')!; oil.id = 'oilfield-1';
  facilities.push(...(['armyBase','airBase'] as const).map((type,i) => ({ id: i ? 'air-base-1' : 'army-base-1', type, nameKey: `facility.${type}`, position: { ...CENTER }, workerCapacity: config.facilities[type].workerCapacity, startingOwned: false, startingWorkers: 0, startingInfected: 0 })));
  const used = new Set(reserved);
  const radius = Math.max(5, config.checkpoint.initialSupplyRadius);
  let repairs = 0;
  for (const f of facilities) {
    f.workerCapacity = config.facilities[f.type].workerCapacity;
    if (f.type !== 'capital') {
      const range = f.startingOwned ? [1,radius] : f.type==='armyBase' ? [Math.max(radius+1,6),9] : f.type==='airBase' ? [Math.max(radius+1,7),10]
        : f.type==='nuclearPowerPlant' ? [Math.max(radius+1,12),18] : f.type==='oilField' ? [Math.max(radius+1,10),18] : [radius+1,22];
      const choices = map.tiles.filter(t => t.playerOccupancyAllowed && t.terrain!=='water' && !used.has(t.key)
        && hexDistance(CENTER,t)>=range[0]! && hexDistance(CENTER,t)<=range[1]!
        && (!['armyBase','airBase','nuclearPowerPlant'].includes(f.type) || Math.min(Math.abs(t.q-25),Math.abs(t.r-25)) <= 1));
      if (!choices.length) throw new Error(`layout_no_candidate:${f.id}:initialSupplyRadius`);
      const t = layout.pick(choices); f.position = { q:t.q, r:t.r };
    }
    const t = byKey.get(hexKey(f.position))!;
    if(t.terrain!=='plain') repairs++;
    setTerrain(t,'plain'); t.facilityId=f.id; used.add(t.key);
  }
  map.facilities = facilities;
  stage('roads');
  // Multi-source BFS connects each actual facility to the current road network.
  // Neighbor order is the stable core hex order. Water is bridged, never erased.
  const roadRng = domain('roads');
  const directionOffset = roadRng.nextInt(0,5);
  for (const f of facilities) {
    const graph = roadConnections(map.roads), targets = new Set(graph.keys());
    const queue = [f.position], previous = new Map<string, HexCoord | null>([[hexKey(f.position),null]]);
    let found: HexCoord | undefined;
    for(let i=0;i<queue.length;i++) {
      const p=queue[i]!;
      if(targets.has(hexKey(p))) { found=p; break; }
      const ns=hexNeighbors(p);
      for(let k=0;k<6;k++) { const n=ns[(k+directionOffset)%6]!, t=byKey.get(hexKey(n));
        if(!t?.playerOccupancyAllowed || previous.has(t.key) || (t.facilityId && t.facilityId!==f.id && !targets.has(t.key))) continue;
        previous.set(t.key,p); queue.push(n);
      }
    }
    if(!found) throw new Error(`road_no_route:${f.id}`);
    const path: HexCoord[]=[];
    for(let p: HexCoord|null=found;p;p=previous.get(hexKey(p))??null) path.push(p);
    if(path.length>1) map.roads.segments.push({ id:`access-${f.id}`,role:'access',path:path.reverse() });
  }
  // Road movement handles all overlays; tile.road marks water crossings as bridges.
  const roadKeys = new Set(roadConnections(map.roads).keys());
  for(const t of map.tiles) if(roadKeys.has(t.key) && t.terrain==='water') t.road=true;
  const buildable = map.tiles.filter(t=>t.playerOccupancyAllowed && hexDistance(CENTER,t)<=config.checkpoint.initialSupplyRadius
    && !used.has(t.key) && !roadKeys.has(t.key));
  const plainCount = buildable.filter(t=>t.terrain==='plain').length;
  for(const t of buildable.filter(t=>t.terrain!=='plain' && t.terrain!=='water').slice(0,Math.max(0,MAP_GENERATION_LIMITS.buildablePlain-plainCount))) { setTerrain(t,'plain'); repairs++; }
  if(repairs>MAP_GENERATION_LIMITS.maxTerrainRepairs) throw new Error('terrain_repair_limit');
  map.generation={terrainRepairs:repairs,river,lake,version:GENERATOR_VERSION};
  map.roads.inputHash = mapContentHash({ seed, attempt, settingsKey, repairs });
  stage('validation');
  const result=validateRandomMap(map,config);
  if(!result.valid) throw new Error(result.errors.join(';'));
  return map;
}

export function generateRandomMap(seed: number, config: GameConfig, options: { onProgress?: (p: GenerationProgress)=>void; rejectCandidate?: (map: FixedMap, attempt: number)=>boolean } = {}) {
  let reason='';
  for(let attempt=1;attempt<=MAP_GENERATION_LIMITS.attempts;attempt++) {
    try { const map=createCandidate(seed,config,attempt,options.onProgress); if(options.rejectCandidate?.(map,attempt)) throw new Error('injected_rejection'); return { map, attempt, fallback: null }; }
    catch(error) { reason=error instanceof Error ? error.message : String(error); options.onProgress?.({stage:'rejected',reason,attempt,maxAttempts:MAP_GENERATION_LIMITS.attempts}); }
  }
  options.onProgress?.({ stage:'fallback', attempt:MAP_GENERATION_LIMITS.attempts,maxAttempts:MAP_GENERATION_LIMITS.attempts });
  // Dedicated inland layout. Its seed/attempt and generator are versioned, never the legacy map.
  try {
    const map=structuredClone(fallbackTemplate) as FixedMap;
    for(const f of map.facilities)f.workerCapacity=config.facilities[f.type].workerCapacity;
    const validation=validateRandomMap(map,config);
    if(!validation.valid)throw new Error(validation.errors.join(';'));
    return {map,attempt:MAP_GENERATION_LIMITS.attempts,fallback:{id:FALLBACK_ID,version:GENERATOR_VERSION,reason}};
  }
  catch(error) { throw new Error(`map_generation_failed:${reason};fallback:${error instanceof Error?error.message:String(error)}`); }
}

export function validateRandomMap(map: FixedMap, config: GameConfig): {valid:boolean;errors:string[]} {
  const errors:string[]=[];
  const fail=(condition:boolean,message:string)=>{if(!condition)errors.push(message);};
  fail(map.id===RANDOM_MAP_ID && map.width===51 && map.height===51,'random_map_identity');
  fail(map.tiles.length===2601 && new Set(map.tiles.map(t=>t.key)).size===2601,'tile_count');
  const byKey=new Map(map.tiles.map(t=>[t.key,t]));
  for(const t of map.tiles) {
    fail(Number.isInteger(t.q)&&Number.isInteger(t.r)&&t.q>=0&&t.q<=50&&t.r>=0&&t.r<=50&&t.key===hexKey(t),'tile_coordinate');
    fail(['plain','forest','mountain','water'].includes(t.terrain)&&t.movementCost===terrainCost(t.terrain),'tile_terrain');
    fail(t.playerOccupancyAllowed===(t.q>=2&&t.q<49&&t.r>=2&&t.r<49),'reserve_occupancy');
  }
  fail(map.hordeSpawnReserve.length===392 && new Set(map.hordeSpawnReserve.map(hexKey)).size===392 && map.hordeSpawnReserve.every(p=>byKey.get(hexKey(p))?.playerOccupancyAllowed===false),'reserve');
  fail(canonicalMapValue(map.roadBranches)===canonicalMapValue(FIXED_MAP.roadBranches)&&canonicalMapValue(map.hordeEntrances)===canonicalMapValue(FIXED_MAP.hordeEntrances)&&canonicalMapValue(map.roadTiles)===canonicalMapValue(FIXED_MAP.roadTiles),'fixed_trunks');
  const templates=[...FIXED_MAP.facilities.map(f=>({...f,id:f.type==='oilField'?'oilfield-1':f.id})),
    {id:'army-base-1',type:'armyBase',startingOwned:false,startingWorkers:0,startingInfected:0}, {id:'air-base-1',type:'airBase',startingOwned:false,startingWorkers:0,startingInfected:0}];
  fail(map.facilities.length===28 && new Set(map.facilities.map(f=>f.id)).size===28,'permanent_facilities_28');
  const occupied=new Set<string>();
  const mock={map,config,facilities:[],checkpoints:[],roadBranches:[]} as unknown as GameState;
  for(const [i,f] of map.facilities.entries()) {
    const template=templates[i], t=byKey.get(hexKey(f.position)), d=hexDistance(CENTER,f.position);
    fail(!!template && f.id===template.id && f.type===template.type && f.startingOwned===template.startingOwned && f.startingWorkers===template.startingWorkers && f.startingInfected===0,'facility_manifest');
    fail(!!t?.playerOccupancyAllowed && t.terrain==='plain' && t.facilityId===f.id && !occupied.has(t.key),'facility_position');
    fail(f.workerCapacity===config.facilities[f.type]?.workerCapacity,'facility_capacity');
    occupied.add(hexKey(f.position));
    fail(f.type==='capital' ? d===0 : !reserved.has(hexKey(f.position)),'reserved_positions');
    fail(f.startingOwned ? d<=Math.max(5,config.checkpoint.initialSupplyRadius) : d>Math.max(5,config.checkpoint.initialSupplyRadius),'initial_supply_composition');
    const band = f.type==='armyBase' ? [6,9] : f.type==='airBase' ? [7,10] : f.type==='nuclearPowerPlant' ? [12,18] : f.type==='oilField' ? [10,18] : null;
    if(band) fail(d>=band[0]! && d<=band[1]!, 'important_facility_distance');
    fail(getSectorBranchIds(map,f.position).some(id=>map.roadBranches.find(b=>b.id===id)!.roadTiles.some(p=>byKey.get(hexKey(p))?.playerOccupancyAllowed && !byKey.get(hexKey(p))?.facilityId && isHexSuppliedByBranch(mock,f.position,id,p))),'facility_supply_extension');
  }
  for(const t of map.tiles) if(t.facilityId) fail(map.facilities.some(f=>f.id===t.facilityId&&hexKey(f.position)===t.key),'orphan_facility');
  for(const p of [...INITIAL_HUMAN_DEPLOYMENT,...INITIAL_CHECKPOINT_DEPLOYMENT]) fail(byKey.get(hexKey(p.position))?.terrain==='plain'&&!byKey.get(hexKey(p.position))?.facilityId,'initial_deployment');
  if(!map.roads) return {valid:false,errors:[...errors,'missing_roads']};
  const ids=new Set<string>();
  for(const s of map.roads.segments) { fail(!ids.has(s.id)&&['trunk','collector','access'].includes(s.role)&&s.path.length>=2,'road_segment'); ids.add(s.id);
    s.path.forEach((p,i)=>fail(byKey.has(hexKey(p))&&(i===0||hexDistance(p,s.path[i-1]!)===1),'road_adjacency')); }
  const graph=roadConnections(map.roads), roadKeys=new Set(graph.keys());
  fail(map.roads.generatorVersion==='connector-roads-v1' && Number.isSafeInteger(map.roads.layoutSeed) && /^[a-f0-9]{64}$/.test(map.roads.inputHash), 'road_metadata');
  const connectedRoads=new Set<string>(), roadQueue=[hexKey(CENTER)];
  for(let i=0;i<roadQueue.length;i++){const key=roadQueue[i]!;if(connectedRoads.has(key))continue;connectedRoads.add(key);for(const next of graph.get(key)??[])roadQueue.push(hexKey(next.position));}
  fail(connectedRoads.size===graph.size && map.facilities.every(f=>connectedRoads.has(hexKey(f.position))), 'road_facility_connectivity');
  for(const t of map.tiles) fail(t.road===(t.q===25||t.r===25||(t.terrain==='water'&&roadKeys.has(t.key))),'bridge_overlay');
  const passable=new Set(map.tiles.filter(t=>effectiveMovementCost(mock,t,false)!==null).map(t=>t.key));
  const flood=(blocked?:string)=>{const seen=new Set<string>(),queue=[hexKey(CENTER)]; for(let i=0;i<queue.length;i++){const key=queue[i]!;if(key===blocked||seen.has(key)||!passable.has(key))continue;seen.add(key);const p=byKey.get(key)!;for(const n of hexNeighbors(p))queue.push(hexKey(n));}return seen;};
  const reached=flood();
  fail(reached.size===passable.size,'ground_connectivity');
  fail(map.facilities.every(f=>reached.has(hexKey(f.position))),'facility_reachability');
  for(const direction of ['north','east','south','west'] as const) fail(getHordeSpawnZone(map,direction).every(p=>reached.has(hexKey(p))),'spawn_escape');
  const bridges=map.tiles.filter(t=>t.terrain==='water'&&roadKeys.has(t.key));
  fail(bridges.length>=2,'multiple_bridges');
  for(const b of bridges) fail(flood(b.key).size===passable.size-1,'single_bridge_dependency');
  const water=map.tiles.filter(t=>t.terrain==='water'), seenWater=new Set<string>(), queue=water[0]?[water[0]]:[];
  for(let i=0;i<queue.length;i++){const t=queue[i]!;if(seenWater.has(t.key))continue;seenWater.add(t.key);for(const n of hexNeighbors(t)){const next=byKey.get(hexKey(n));if(next?.terrain==='water'&&!seenWater.has(next.key))queue.push(next);}}
  fail(seenWater.size===water.length&&water.some(t=>t.r===0)&&water.some(t=>t.r===50),'river_connectivity');
  const g=map.generation;
  fail(!!g&&g.version===GENERATOR_VERSION&&Number.isInteger(g.terrainRepairs)&&g.terrainRepairs>=0&&g.terrainRepairs<=MAP_GENERATION_LIMITS.maxTerrainRepairs,'generation_metadata');
  if(g)fail(g.river[0]?.r===0&&g.river.at(-1)?.r===50&&new Set(g.river.map(hexKey)).size===g.river.length&&g.river.every((p,i)=>byKey.get(hexKey(p))?.terrain==='water'&&(i===0||hexDistance(p,g.river[i-1]!)===1))&&byKey.get(hexKey(g.lake))?.terrain==='water','river_source_outlet');
  const counts=Object.fromEntries(['plain','forest','mountain','water'].map(k=>[k,map.tiles.filter(t=>t.terrain===k).length/2601]));
  fail(counts.plain!>=.55&&counts.plain!<=.75&&counts.forest!>=.15&&counts.forest!<=.30&&counts.mountain!>=.05&&counts.mountain!<=.15&&counts.water!>=.02&&counts.water!<=.08,'terrain_ratios');
  const buildable=map.tiles.filter(t=>t.terrain==='plain'&&t.playerOccupancyAllowed&&!occupied.has(t.key)&&!reserved.has(t.key)&&!roadKeys.has(t.key)&&hexDistance(CENTER,t)<=config.checkpoint.initialSupplyRadius);
  fail(buildable.length>=MAP_GENERATION_LIMITS.buildablePlain,'initial_buildable_plain');
  return {valid:errors.length===0,errors:[...new Set(errors)]};
}

export function validateMapDescriptor(state: Pick<GameState,'map'|'mapDescriptor'|'seed'|'config'>): string[] {
  const d=state.mapDescriptor;
  if(!d||d.mode!==state.config.mapMode||d.rootSeed!==state.seed||d.mapSeed!==(state.config.mapSeed??state.seed)||d.gameplaySeed!==(state.config.gameplaySeed??state.seed))return ['invalid_map_descriptor'];
  const expected=describeMap(state.map,state.seed,state.config,d.attempt,d.fallback);
  const errors=canonicalMapValue(d)===canonicalMapValue(expected)?[]:['map_descriptor_hash_or_config'];
  if(d.mode==='random') {
    if(!Number.isInteger(d.attempt)||d.attempt<1||d.attempt>MAP_GENERATION_LIMITS.attempts)errors.push('invalid_attempt');
    if(d.fallback&&(d.attempt!==64||d.fallback.id!==FALLBACK_ID||d.fallback.version!==GENERATOR_VERSION||typeof d.fallback.reason!=='string'))errors.push('invalid_fallback');
    if(d.fallback){
      const known=structuredClone(fallbackTemplate) as FixedMap;
      for(const f of known.facilities)f.workerCapacity=state.config.facilities[f.type].workerCapacity;
      if(mapContentHash(publicStaticMap(known))!==d.mapHash)errors.push('fallback_content_mismatch');
    }else if(state.map.roads?.layoutSeed!==d.mapSeed || state.map.roads.settingsId!==d.settingsId || state.map.roads.inputHash!==mapContentHash({seed:d.mapSeed,attempt:d.attempt,settingsKey:d.settingsId,repairs:state.map.generation?.terrainRepairs}))errors.push('road_settings_mismatch');
  } else if(d.attempt!==0||d.fallback!==null) errors.push('invalid_fixed_descriptor');
  return errors;
}
