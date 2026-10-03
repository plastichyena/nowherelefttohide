import {writeFileSync,mkdirSync} from 'node:fs';
import {verifyTerrainRoute} from '../src/testing/v170-terrain-routes';
import {createInitialState} from '../src/core/state';
import {createDefaultConfig} from '../src/core/config';
const results=[];
const all=process.argv.includes('--all');
const ids=all?createInitialState(1,createDefaultConfig()).map.facilities.filter(f=>!f.startingOwned).map(f=>f.id):['army-base-1','air-base-1','nuclear-power-plant-1','oilfield-1'];
for(const seed of all?[1,42]:[1,2,3,42,100])for(const id of ids){
  const result=verifyTerrainRoute(seed,id);results.push(result);console.log(seed,id,result.capturedTurn,result.suppliedTurn);
}
mkdirSync('output/v170',{recursive:true});writeFileSync(`output/v170/terrain-routes${all?'-all':''}.json`,JSON.stringify(results,null,2));
