// Replay recorded accepted actions for exact queue peaks, without asking the AI to decide again.
import fs from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deepStrictEqual} from 'node:assert';
const [bundle,reports,out]=process.argv.slice(2);
const original=fs.readFileSync(bundle,'utf8');
if(!original.includes('function emit(state, type, payload) {'))throw Error('Expected one engine event helper');
const instrumented=original.replace('function emit(state, type, payload) {','function emit(state, type, payload) { benchmarkObserve(state);')+`
let benchmarkPeaks={};
export function benchmarkObserve(state){for(const c of state.checkpoints)benchmarkPeaks[c.id]=Math.max(benchmarkPeaks[c.id]??0,c.waiting);}
export function benchmarkReset(){benchmarkPeaks={};}
export function benchmarkResult(){return {...benchmarkPeaks};}
export {GameEngine as BenchmarkEngine};
`;
const instrumentedPath=resolve(out+'.runtime.mjs');fs.writeFileSync(instrumentedPath,instrumented);
const m=await import(pathToFileURL(instrumentedPath)),results=[];
for(const seed of [1,5,7]){
 const report=JSON.parse(fs.readFileSync(resolve(reports,`seed-${seed}.json`),'utf8'));
 m.benchmarkReset();const engine=new m.BenchmarkEngine(seed,report.metrics.config);let state=engine.getState();m.benchmarkObserve(state);
 let endTurnIndex=0;
 for(const action of report.actions){const result=engine.step(action);if(result.error)throw Error(JSON.stringify({seed,action,error:result.error}));state=result.state;m.benchmarkObserve(state);
   if(action.type==='EndTurn')deepStrictEqual(result.state.statistics,report.turns[endTurnIndex++].statistics);
 }
 // A player Attack can end a game after its last EndTurn snapshot.
 // Metrics are a public projection, not the private Statistics schema: sparse
 // dictionaries can be zero-filled or omit policies. Compare direct acceptance
 // counters here; the full raw Statistics were compared at every EndTurn above.
 for(const key of ['refugeeArrivalsByBranch','refugeesAccepted','refugeesDeparted','barbedWireBuilt','barbedWireDestroyed','infectionLosses','resourceShortageLosses'])deepStrictEqual(state.statistics[key],report.metrics[key],`final statistic ${key}`);
 deepStrictEqual(state.turn,report.finalTurn);
 const peaks=m.benchmarkResult();results.push({seed,version:report.version,actions:report.actions.length,finalTurn:state.turn,statisticsMatched:true,maximumWaiting:Math.max(0,...Object.values(peaks)),maximumWaitingByPost:peaks});
 fs.writeFileSync(out,JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
}
