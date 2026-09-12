import { writeFileSync, mkdirSync } from 'node:fs';
import type { GameAction } from '../core/types';
import { GameEngine } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import { wireCandidates } from '../core/barbed-wire';
import { encodeSaveCode, exportSaveJson } from '../persistence/save';
import { hexDistance } from '../core/hex';
// Visual QA uses expanded public vision/supply, without changing map topology.
const engine = new GameEngine(1, createDefaultConfig({ checkpoint: { initialSupplyRadius: 40 }, units: { police: { vision: 40 } }, refugees: { arrivalIntervalMin: 100, arrivalIntervalMax: 100 }, economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialResources: { food: 10000, civilianGoods: 10000, militaryGoods: 10000, fuel: 10000 } }, horde: { waves: [{ turn: 100, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] } }));
const mountain = engine.getState().map.tiles.filter(t => t.terrain === 'mountain').sort((a,b) => hexDistance(a,{q:25,r:25})-hexDistance(b,{q:25,r:25}))[0]!;
for (const target of [{q:25,r:25}, mountain]) {
  const drone = engine.getLegalActions().filter((a): a is Extract<GameAction, { type: 'BuildConstructibleFacility' }> => a.type === 'BuildConstructibleFacility' && a.facilityType === 'civilianDroneBase').sort((a,b) => hexDistance(a.position,target)-hexDistance(b.position,target))[0];
  if (!drone) throw new Error('Drone construction unavailable');
  for (const action of [drone, { type: 'EndTurn' as const }]) { const result = engine.step(action); if(result.error) throw new Error(result.error.message); }
  const facility = engine.getState().facilities.find(f => f.type === 'civilianDroneBase' && f.position.q === drone.position.q && f.position.r === drone.position.r)!;
  for (const action of [{ type: 'AssignWorkers' as const, facilityId: facility.id, workers: 5 }, { type: 'EndTurn' as const }]) { const result = engine.step(action); if(result.error) throw new Error(result.error.message); }
}
const built = [];
for (const category of ['road', 'plain', 'forest', 'mountain']) {
  const state = engine.getState();
  const candidate = wireCandidates(state).filter(c => c.legal).sort((a,b) => hexDistance(a.position,{q:25,r:25})-hexDistance(b.position,{q:25,r:25})).find(c => {
    const tile = state.map.tiles.find(t => t.q === c.position.q && t.r === c.position.r)!;
    return category === 'road' ? tile.road : tile.terrain === category;
  });
  if (!candidate) { built.push({category,available:false}); continue; }
  const result = engine.step({type:'BuildBarbedWire',position:candidate.position});
  if(result.error) throw new Error(result.error.message);
  built.push({category,position:candidate.position,hp:20});
}
const road = built.find(b => b.category === 'road' && 'position' in b);
const move = engine.getLegalActions().find(a => a.type === 'Move' && road && a.destination.q === road.position!.q && a.destination.r === road.position!.r);
if (move) { const result = engine.step(move); if (result.error) throw new Error(result.error.message); }
mkdirSync('output/playwright',{recursive:true});
writeFileSync('output/playwright/v157-walls-save.json',exportSaveJson(engine.getState()));
writeFileSync('output/playwright/v157-walls.save.txt',encodeSaveCode(engine.getState()));
writeFileSync('output/playwright/v157-walls.json',JSON.stringify(built,null,2));
console.log(JSON.stringify(built));
