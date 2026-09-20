import { writeFileSync } from 'node:fs';
import { GameEngine } from '../src/core/engine';
import { createUnit } from '../src/core/state';
import { prepareTestSnapshot } from '../src/core/testConfig';
import { exportSaveJson } from '../src/persistence/save';
import type { GameState } from '../src/core/types';

// UI-only acceptance fixture: valid state loaded through GameAction before serialization.
const engine=new GameEngine(6),state=engine.getState() as GameState;
const plant=state.facilities.find(f=>f.type==='nuclearPowerPlant')!;
state.units=state.units.filter(u=>u.isPlayerUnit);
state.units.push(createUnit(state,'sf-visual','specialForces',plant.position),createUnit(state,'pack-visual','packZombie',{q:18,r:18}));
state.turn=20;state.nuclearObjective={firstCapturedTurn:20,reward:'claimed',failureSpawn:'none'};
plant.owner='player';plant.status='owned';plant.operationalStatus='operational';plant.workers=5;plant.securedOrder=9;plant.populationOperationalTurn=1;plant.firstCaptureRewardClaimed=true;
state.publicHealthStress={food:0.6,civilianGoods:0.8};state.foodShortageAccumulation=4;state.resources.food=0;state.resources.civilianGoods=0;
state.checkpoints[0]!.waiting=100;
for(const branch of state.roadBranches) branch.nextArrivalTurn=21;
prepareTestSnapshot(state);
const result=engine.step({type:'LoadSnapshot',snapshot:state});if(result.error)throw new Error(result.error.message);
writeFileSync('output/playwright/v163-visual-fixture.json',exportSaveJson(result.state as GameState));
console.log('Valid v1.6.3 visual acceptance fixture written.');
