import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { createCityPopulationSnapshot, synchronizePopulation, createUnit } from './state';
import { ARMY_BASE_CANDIDATES, canPlayerOccupyHex, initialArmyBaseMatchesSeed, initialGasPositionsMatchSeed } from './map';
import { hexDistance, hexNeighbors } from './hex';
import { getPlayerVisibleTileKeys } from './visibility';
import { isHexSupplied } from './supply';
import { forecastEndTurn } from './economy-query';
import { findShortestPath, pathMovementCost } from './path';
import { effectiveMovementCost } from './terrain';
import { unitMoveFuelCost } from './movement-query';
import type { GameState, ZombieUnitType } from './types';
const config=()=>createDefaultConfig({economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},horde:{waves:[{turn:99,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]}});
function load(engine:GameEngine,s:GameState) { synchronizePopulation(s); createCityPopulationSnapshot(s); expect(engine.step({type:'LoadSnapshot',snapshot:s}).error?.message??null).toBeNull(); }
function owned(engine:GameEngine,workers=0) { const s=engine.getState() as GameState; const b=s.facilities.find(f=>f.type==='armyBase')!; b.owner='player';b.status='owned';b.operationalStatus='operational';b.populationOperationalTurn=1;b.securedOrder=20;b.workers=workers; s.facilities.find(f=>f.type==='capital')!.workers-=workers; return {s,b}; }
function horde(state: GameState, id: string, position: { q: number; r: number }) {
  const unit = createUnit(state, id, 'hordeZombie', position);
  unit.hordeKind = 'periodic';
  unit.spawnGroupId = `test-${id}`;
  return unit;
}
function replaceUnits(state: GameState, units: GameState['units']) {
  const before = state.units.filter((unit) => unit.isPlayerUnit).reduce((total, unit) => total + unit.population, 0);
  const after = units.filter((unit) => unit.isPlayerUnit).reduce((total, unit) => total + unit.population, 0);
  state.population.cumulativeDeaths += Math.max(0, before - after);
  state.units = units;
}
describe('v1.5.3 integrated rules',()=>{
 it('places one seed-bound base outside initial supply and distinct Gas, without reroll',()=>{const seen=new Set<string>(); const counts=new Set<number>(); for(let seed=1;seed<=40;seed++){const engine=new GameEngine(seed);const s=engine.getState();const b=s.facilities.find(f=>f.type==='armyBase')!; seen.add(JSON.stringify(b.position));counts.add(s.initialGasPositions.length);expect(s.facilities).toHaveLength(30);expect(b).toMatchObject({owner:'none',workers:0,infected:0,armyBase:{militaryGoods:40,reward:'unclaimed'}});expect(isHexSupplied(s,b.position)).toBe(false);expect(hexDistance(b.position,{q:25,r:25})).toBe(6);expect(initialArmyBaseMatchesSeed(s)).toBe(true);expect(initialGasPositionsMatchSeed(s)).toBe(true);expect(new Set(s.units.map(u=>JSON.stringify(u.position))).size).toBe(s.units.length);expect(s.units.filter(u=>u.type==='gasZombie').every(u=>u.hp===35&&hexDistance(u.position,{q:25,r:25})>=9)).toBe(true);}expect(seen.size).toBe(ARMY_BASE_CANDIDATES.length);expect([...counts].sort()).toEqual([1,2]);},20000);
 it('keeps every Army Base candidate on a legal Turn-20-reachable route from the Capital', () => {
  const checked = new Set<string>();
  for (let seed = 1; seed <= 40 && checked.size < ARMY_BASE_CANDIDATES.length; seed += 1) {
   const state = new GameEngine(seed, config()).getState() as GameState;
   const base = state.facilities.find((facility) => facility.type === 'armyBase')!;
   const key = `${base.position.q},${base.position.r}`;
   if (checked.has(key)) continue;
   checked.add(key);
   const path = findShortestPath(
    state.map,
    { q: 25, r: 25 },
    base.position,
    new Set(),
    (position) => effectiveMovementCost(state, position),
   );
   expect(path, `candidate ${key}`).not.toBeNull();
   expect(path!.every((position) => canPlayerOccupyHex(state.map, position)), `candidate ${key}`).toBe(true);
   expect(pathMovementCost(path!, (position) => effectiveMovementCost(state, position)), `candidate ${key}`).toBeLessThanOrEqual(state.config.units.police.movement);
   expect(unitMoveFuelCost('police', path!.length - 1), `candidate ${key}`).toBeLessThanOrEqual(state.config.units.police.maxFuel);
  }
  expect(checked.size).toBe(ARMY_BASE_CANDIDATES.length);
 });
 for(const turn of [19,20,21]) it(`captures the base at Turn ${turn} with the correct one-time reward`,()=>{const engine=new GameEngine(1,config());const s=engine.getState() as GameState; s.turn=turn;s.horde.turnsRemaining=99-turn;for(const branch of s.roadBranches)branch.nextArrivalTurn=turn+2;const b=s.facilities.find(f=>f.type==='armyBase')!;const p=s.units.find(u=>u.type==='police')!; p.position=hexNeighbors(b.position).find(p=>!s.facilities.some(f=>JSON.stringify(f.position)===JSON.stringify(p)))!;load(engine,s);const before=engine.getState();const result=engine.step({type:'Move',unitId:p.id,destination:b.position});expect(result.error?.message??null).toBeNull();const base=result.state.facilities.find(f=>f.id===b.id)!;expect(base.armyBase?.reward).toBe(turn<=20?'claimed':'expired');expect(result.state.units.filter(u=>u.type==='nationalGuard')).toHaveLength(turn<=20?2:1);expect(result.state.resources.militaryGoods).toBe(before.resources.militaryGoods);if(turn<=20){const reward=result.state.units.filter(u=>u.type==='nationalGuard').at(-1)!;expect(reward).toMatchObject({proficiency:'regular',currentFuel:22,currentMilitaryGoods:20,canMove:true,canAttack:true});} });
 for(const type of ['zombie','hordeZombie','policeZombie','soldierZombie','riotZombie','hunterZombie','gasZombie'] as ZombieUnitType[]) it(`pins ${type} beside an exhausted human and attacks it`,()=>{const engine=new GameEngine(9,config()); const s=engine.getState() as GameState;const p=s.units.find(u=>u.type==='police')!;p.position={q:25,r:15};p.attackChargesRemaining=0;p.canAttack=false;p.currentMilitaryGoods=0; const z=createUnit(s,'pin-zombie',type,{q:25,r:14});z.noiseTarget=type==='hordeZombie'?null:{q:25,r:25};if(z.type==='hordeZombie'){z.hordeKind='periodic';z.spawnGroupId='test-horde';}s.units.push(z);load(engine,s);const result=engine.step({type:'EndTurn'});expect(result.error?.message??null).toBeNull();expect(result.state.units.find(u=>u.id===z.id)?.position).toEqual(z.position);expect(result.events.some(e=>e.type==='attack'&&e.payload.attackerId===z.id&&e.payload.defenderId===p.id)).toBe(true);expect(result.events.some(e=>e.type==='interception'&&e.payload.attackerId===p.id)).toBe(false);});
 it('keeps staffed base vision when disabled, and its last workers prevent population defeat',()=>{const engine=new GameEngine(4,config());const {s,b}=owned(engine,1);for(const f of s.facilities)if(f.id!==b.id){s.population.cumulativeDeaths+=f.workers;f.workers=0;}b.operationalStatus='disabled';s.resources.food=10000;load(engine,s);expect(getPlayerVisibleTileKeys(engine.getState()).has(`${b.position.q},${b.position.r}`)).toBe(true);expect(engine.step({type:'EndTurn'}).gameOver).toBe(false);});
 it('fires without Supply or power, stops at range two, and creates a next-phase noise pulse',()=>{const engine=new GameEngine(1,config());const {s,b}=owned(engine,2);s.units=s.units.filter(u=>u.isPlayerUnit);const z=createUnit(s,'base-target','hordeZombie',{q:b.position.q,r:b.position.r-3});if(z.type==='hordeZombie'){z.hordeKind='periodic';z.spawnGroupId='test-horde';}s.units.push(z);load(engine,s);expect(isHexSupplied(s,b.position)).toBe(false);const result=engine.step({type:'EndTurn'});expect(result.error?.message??null).toBeNull();const after=result.state.facilities.find(f=>f.id===b.id)!;expect(result.events.filter(e=>e.type==='interception'&&e.payload.facilityId===b.id)).toHaveLength(1);expect(after.armyBase?.militaryGoods).toBe(38);expect(result.state.pendingNoisePulses.filter(p=>p.sourceKind==='armyBase')).toHaveLength(1);expect(hexDistance(result.state.units.find(u=>u.id===z.id)!.position,b.position)).toBe(2);});

 it('fires continuously at distance zero until the refreshed worker shots are exhausted', () => {
  const engine = new GameEngine(11, config());
  const { s, b } = owned(engine, 3);
  const zombie = horde(s, 'base-zero-range', { q: b.position.q, r: b.position.r - 1 });
  zombie.movement = 1;
  replaceUnits(s, [zombie]);
  load(engine, s);

  const result = engine.step({ type: 'EndTurn' });
  const shots = result.events.filter((event) => event.type === 'interception' && event.payload.facilityId === b.id);
  const afterBase = result.state.facilities.find((facility) => facility.id === b.id)!;
  const survivor = result.state.units.find((unit) => unit.id === zombie.id);
  expect(result.error?.message ?? null).toBeNull();
  expect(shots).toHaveLength(3);
  expect(afterBase.armyBase).toMatchObject({ militaryGoods: 34, interceptionsRemaining: 0 });
  expect(survivor?.position).toEqual(b.position);
  expect(survivor?.hp).toBe(zombie.maxHp - 15);
 });

 it('fires once at distance one and does not fire when movement ends at distance three', () => {
  const rangeOneEngine = new GameEngine(12, config());
  const { s: rangeOneState, b: rangeOneBase } = owned(rangeOneEngine, 3);
  const rangeOneZombie = horde(rangeOneState, 'base-range-one', { q: rangeOneBase.position.q, r: rangeOneBase.position.r - 2 });
  rangeOneZombie.movement = 1;
  replaceUnits(rangeOneState, [rangeOneZombie]);
  load(rangeOneEngine, rangeOneState);
  const rangeOne = rangeOneEngine.step({ type: 'EndTurn' });
  expect(rangeOne.events.filter((event) => event.type === 'interception' && event.payload.facilityId === rangeOneBase.id)).toHaveLength(1);
  expect(hexDistance(rangeOne.state.units.find((unit) => unit.id === rangeOneZombie.id)!.position, rangeOneBase.position)).toBe(1);

  const rangeThreeEngine = new GameEngine(13, config());
  const { s: rangeThreeState, b: rangeThreeBase } = owned(rangeThreeEngine, 3);
  const rangeThreeZombie = createUnit(rangeThreeState, 'base-range-three', 'zombie', { q: rangeThreeBase.position.q, r: rangeThreeBase.position.r - 4 });
  rangeThreeZombie.movement = 1;
  rangeThreeZombie.noiseTarget = { ...rangeThreeBase.position };
  replaceUnits(rangeThreeState, [rangeThreeZombie]);
  load(rangeThreeEngine, rangeThreeState);
  const rangeThree = rangeThreeEngine.step({ type: 'EndTurn' });
  expect(rangeThree.events.filter((event) => event.type === 'interception' && event.payload.facilityId === rangeThreeBase.id)).toHaveLength(0);
  expect(hexDistance(rangeThree.state.units.find((unit) => unit.id === rangeThreeZombie.id)!.position, rangeThreeBase.position)).toBe(3);
 });

 for (const militaryGoods of [0, 1, 2]) it(`requires two dedicated Military Goods to intercept (stock ${militaryGoods})`, () => {
  const engine = new GameEngine(20 + militaryGoods, config());
  const { s, b } = owned(engine, 2);
  b.armyBase!.militaryGoods = militaryGoods;
  const zombie = horde(s, `base-ammo-${militaryGoods}`, { q: b.position.q, r: b.position.r - 2 });
  zombie.movement = 1;
  replaceUnits(s, [zombie]);
  load(engine, s);

  const result = engine.step({ type: 'EndTurn' });
  const shots = result.events.filter((event) => event.type === 'interception' && event.payload.facilityId === b.id);
  expect(shots).toHaveLength(militaryGoods === 2 ? 1 : 0);
  expect(result.state.facilities.find((facility) => facility.id === b.id)?.armyBase?.militaryGoods).toBe(militaryGoods === 2 ? 0 : militaryGoods);
 });

 it('stops Army Base interception after a killed Gas Zombie infects and overruns it', () => {
  const engine = new GameEngine(30, config());
  const { s, b } = owned(engine, 2);
  const gas = createUnit(s, 'base-gas-stop', 'gasZombie', { q: b.position.q, r: b.position.r - 2 });
  gas.hp = 1;
  gas.movement = 1;
  gas.noiseTarget = { ...b.position };
  replaceUnits(s, [gas]);
  load(engine, s);

  const result = engine.step({ type: 'EndTurn' });
  const shots = result.events.filter((event) => event.type === 'interception' && event.payload.facilityId === b.id);
  const afterBase = result.state.facilities.find((facility) => facility.id === b.id)!;
  expect(shots).toHaveLength(1);
  expect(result.state.units.some((unit) => unit.id === gas.id)).toBe(false);
  expect(afterBase).toMatchObject({ owner: 'none', status: 'ruined', operationalStatus: 'ruined', workers: 0 });
  expect(afterBase.infected).toBe(2);
  expect(afterBase.armyBase?.militaryGoods).toBe(38);
 });

 it('resolves Human interception before Army Base interception at the same entered Hex', () => {
  const engine = new GameEngine(31, config());
  const { s, b } = owned(engine, 2);
  const police = createUnit(s, 'human-first-police', 'police', { q: b.position.q + 1, r: b.position.r - 2 });
  const zombie = horde(s, 'human-first-horde', { q: b.position.q, r: b.position.r - 3 });
  zombie.movement = 1;
  replaceUnits(s, [police, zombie]);
  load(engine, s);

  const result = engine.step({ type: 'EndTurn' });
  const interceptionEvents = result.events.filter((event) => event.type === 'interception');
  expect(interceptionEvents).toHaveLength(2);
  expect(interceptionEvents[0]?.payload).toMatchObject({ attackerId: police.id, defenderId: zombie.id });
  expect(interceptionEvents[1]?.payload).toMatchObject({ facilityId: b.id, defenderId: zombie.id });
  expect(result.state.units.find((unit) => unit.id === zombie.id)).toBeDefined();
 });

 it('pins movement at the first entered Hex adjacent to an exhausted Human', () => {
  const engine = new GameEngine(32, config());
  const s = engine.getState() as GameState;
  const capital = s.facilities.find((facility) => facility.type === 'capital')!;
  for (const facility of s.facilities) {
   if (facility.id === capital.id || facility.workers === 0) continue;
   s.population.cumulativeDeaths += facility.workers;
   facility.workers = 0;
  }
  const start = { q: 25, r: 15 };
  const route = findShortestPath(s.map, start, capital.position, new Set(), (position) => effectiveMovementCost(s, position))!;
  expect(route.length).toBeGreaterThanOrEqual(4);
  const stop = route[2]!;
  const humanPosition = hexNeighbors(stop).find((position) =>
   !route.some((step) => step.q === position.q && step.r === position.r) &&
   hexDistance(position, route[0]!) > 1 &&
   hexDistance(position, route[1]!) > 1 &&
   canPlayerOccupyHex(s.map, position) &&
   !s.facilities.some((facility) => facility.position.q === position.q && facility.position.r === position.r)
  )!;
  expect(humanPosition).toBeDefined();
  const human = createUnit(s, 'path-pin-human', 'police', humanPosition);
  human.canAttack = false;
  human.attackChargesRemaining = 0;
  human.currentMilitaryGoods = 0;
  const zombie = horde(s, 'path-pin-horde', start);
  zombie.movement = 20;
  replaceUnits(s, [human, zombie]);
  load(engine, s);

  const result = engine.step({ type: 'EndTurn' });
  const survivor = result.state.units.find((unit) => unit.id === zombie.id)!;
  const moved = result.events.find((event) => event.type === 'unit_moved' && event.payload.unitId === zombie.id);
  expect(survivor.position).toEqual(stop);
  expect(hexDistance(survivor.position, human.position)).toBe(1);
  expect(moved?.payload.hexesMoved).toBe(2);
  expect(result.events.some((event) => event.type === 'interception' && event.payload.attackerId === human.id)).toBe(false);
  expect(result.events.some((event) => event.type === 'attack' && event.payload.attackerId === zombie.id && event.payload.defenderId === human.id)).toBe(true);
 });

 it('recovers an empty disabled Army Base only on the Player Turn after re-securing it', () => {
  const engine = new GameEngine(33, config());
  const { s, b } = owned(engine, 0);
  const neighbors = hexNeighbors(b.position).filter((position) => !s.facilities.some((facility) => facility.position.q === position.q && facility.position.r === position.r));
  const police = createUnit(s, 'base-resecure-police', 'police', neighbors[0]!);
  const guard = createUnit(s, 'base-clear-guard', 'nationalGuard', neighbors[1]!);
  const zombie = createUnit(s, 'base-empty-occupier', 'zombie', { ...b.position });
  zombie.hp = 1;
  zombie.canAttack = false;
  zombie.canMove = false;
  replaceUnits(s, [police, guard, zombie]);
  load(engine, s);

  const occupied = engine.step({ type: 'EndTurn' });
  expect(occupied.state.facilities.find((facility) => facility.id === b.id)).toMatchObject({
    owner: 'player', status: 'owned', operationalStatus: 'disabled', workers: 0, infected: 0,
  });
  expect(engine.step({ type: 'Attack', attackerId: guard.id, targetId: zombie.id }).error?.message ?? null).toBeNull();
  const resecured = engine.step({ type: 'Move', unitId: police.id, destination: b.position });
  expect(resecured.error?.message ?? null).toBeNull();
  expect(resecured.state.facilities.find((facility) => facility.id === b.id)).toMatchObject({
    owner: 'player', status: 'owned', operationalStatus: 'recovering', workers: 0,
  });
  const restored = engine.step({ type: 'EndTurn' });
  expect(restored.state.facilities.find((facility) => facility.id === b.id)).toMatchObject({
    owner: 'player', status: 'owned', operationalStatus: 'operational', workers: 0,
  });
 });

 it('captures a neutral Army Base after empty occupation and completes recovery next Player Turn', () => {
  const engine = new GameEngine(34, config());
  const s = engine.getState() as GameState;
  const b = s.facilities.find((facility) => facility.type === 'armyBase')!;
  const neighbors = hexNeighbors(b.position).filter((position) => !s.facilities.some((facility) => facility.position.q === position.q && facility.position.r === position.r));
  const police = createUnit(s, 'neutral-base-police', 'police', neighbors[0]!);
  const guard = createUnit(s, 'neutral-base-guard', 'nationalGuard', neighbors[1]!);
  const zombie = createUnit(s, 'neutral-base-occupier', 'zombie', { ...b.position });
  zombie.hp = 1;
  zombie.canAttack = false;
  zombie.canMove = false;
  replaceUnits(s, [police, guard, zombie]);
  load(engine, s);

  const occupied = engine.step({ type: 'EndTurn' });
  expect(occupied.state.facilities.find((facility) => facility.id === b.id)).toMatchObject({
    owner: 'none', status: 'unowned', operationalStatus: 'disabled', workers: 0, infected: 0,
  });
  expect(engine.step({ type: 'Attack', attackerId: guard.id, targetId: zombie.id }).error?.message ?? null).toBeNull();
  const captured = engine.step({ type: 'Move', unitId: police.id, destination: b.position });
  const capturedBase = captured.state.facilities.find((facility) => facility.id === b.id)!;
  expect(captured.error?.message ?? null).toBeNull();
  expect(capturedBase).toMatchObject({
    owner: 'player', status: 'owned', operationalStatus: 'recovering', workers: 0,
  });
  expect(capturedBase.securedOrder).not.toBeNull();
  expect(capturedBase.armyBase?.reward).toBe('claimed');
  expect(captured.state.units.filter((unit) => unit.type === 'nationalGuard')).toHaveLength(2);
  const restored = engine.step({ type: 'EndTurn' });
  expect(restored.state.facilities.find((facility) => facility.id === b.id)).toMatchObject({
    owner: 'player', status: 'owned', operationalStatus: 'operational', workers: 0,
  });
 });
 it('accepts unpowered urban recruitment, retains the payment, then completes when power returns',()=>{
  const cfg=config();cfg.checkpoint.initialSupplyRadius=8;const engine=new GameEngine(1,cfg);const {s,b}=owned(engine);for(const f of s.facilities)if(f.type==='powerPlant'||f.type==='windPowerPlant')f.operationalStatus='disabled';load(engine,s);
  const reservation=engine.step({type:'ProduceUnit',unitType:'nationalGuard',destination:b.position});expect(reservation.error?.message??null).toBeNull();const paid=reservation.state;expect(paid.facilities.find(f=>f.id===b.id)?.workers).toBe(0);expect(paid.facilities.find(f=>f.type==='capital')?.workers).toBe(31);expect(forecastEndTurn(paid).electricity.requiredPowerDemand).toBe(25);
  const delayed=engine.step({type:'EndTurn'});expect(delayed.error?.message??null).toBeNull();expect(delayed.state.pendingUnitProductions).toHaveLength(1);expect(delayed.state.pendingUnitProductions[0]?.powerReady).toBe(false);expect(delayed.state.units.filter(u=>u.type==='nationalGuard')).toHaveLength(1);
  const restored=engine.getState() as GameState;for(const f of restored.facilities)if(f.type==='powerPlant'||f.type==='windPowerPlant')f.operationalStatus=f.owner==='player'?'operational':f.operationalStatus;load(engine,restored);
  const completed=engine.step({type:'EndTurn'});expect(completed.error?.message??null).toBeNull();expect(completed.state.pendingUnitProductions).toHaveLength(0);expect(completed.state.units.filter(u=>u.type==='nationalGuard')).toHaveLength(2);expect(completed.state.units.filter(u=>u.type==='nationalGuard').at(-1)).toMatchObject({proficiency:'recruit',currentMilitaryGoods:20});expect(completed.state.facilities.find(f=>f.type==='capital')?.workers).toBe(31);
 });
 it('never substitutes base workers for city recruitment population',()=>{const cfg=config();cfg.checkpoint.initialSupplyRadius=8;const engine=new GameEngine(3,cfg);const {s,b}=owned(engine,10);const capital=s.facilities.find(f=>f.type==='capital')!;s.population.cumulativeDeaths+=capital.workers-9;capital.workers=9;load(engine,s);const before=engine.getState();expect(engine.step({type:'ProduceUnit',unitType:'nationalGuard',destination:b.position}).error?.code).toBe('insufficient_production_cost');expect(engine.getState()).toEqual(before);});
 it('forfeits a paid reservation when Gas infection overruns the base',()=>{const cfg=config();cfg.checkpoint.initialSupplyRadius=8;const engine=new GameEngine(1,cfg);const {s,b}=owned(engine,5);load(engine,s);expect(engine.step({type:'ProduceUnit',unitType:'nationalGuard',destination:b.position}).error?.message??null).toBeNull();const prepared=engine.getState() as GameState;const gasPosition=hexNeighbors(b.position).find(p=>!prepared.units.some(u=>JSON.stringify(u.position)===JSON.stringify(p)))!;const gas=createUnit(prepared,'gas-forfeiture','gasZombie',gasPosition);gas.hp=1;const attacker=prepared.units.find(u=>u.type==='nationalGuard')!;attacker.position=hexNeighbors(gasPosition).find(p=>JSON.stringify(p)!==JSON.stringify(b.position)&&!prepared.units.some(u=>JSON.stringify(u.position)===JSON.stringify(p)))!;prepared.units.push(gas);load(engine,prepared);const result=engine.step({type:'Attack',attackerId:attacker.id,targetId:gas.id});expect(result.error?.message??null).toBeNull();expect(result.state.pendingUnitProductions).toHaveLength(0);expect(result.state.facilities.find(f=>f.id===b.id)).toMatchObject({status:'ruined',armyBase:{militaryGoods:40}});expect(result.events.some(e=>e.type==='production_forfeited'&&e.payload.people===10)).toBe(true);});

});
