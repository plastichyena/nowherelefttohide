import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { GameEngine } from '../src/core/engine';
import type { GameAction } from '../src/core/types';

// Replay the public actions actually selected by the external LLM in Chrome.
// Internal state is used only for verification after both playtests have ended.
const reports=[];
for(const seed of [1,7]) {
  const artifact=JSON.parse(readFileSync(`output/v163-llm-seed${seed}-public.json`,'utf8'));
  const engine=new GameEngine(seed);
  for(const [index,action] of (artifact.acceptedActions as GameAction[]).entries()){
    const result=engine.step(action);if(result.error)throw new Error(`Seed ${seed} action ${index}: ${JSON.stringify(result.error)}`);
  }
  const actual=engine.getResult();if(!actual)throw new Error(`Seed ${seed} did not finish`);
  const expected=artifact.result;
  for(const key of ['outcome','reason','turn'] as const)if(actual[key]!==expected[key])throw new Error(`Seed ${seed}: ${key} mismatch`);
  for(const [key,value] of Object.entries(expected.statistics))if(!isDeepStrictEqual(actual.statistics[key as keyof typeof actual.statistics],value))throw new Error(`Seed ${seed}: statistic ${key} mismatch`);
  reports.push({seed,acceptedActions:artifact.acceptedActions.length,recordedRejectedInputs:artifact.invalidAttempts.length,outcome:actual.outcome,reason:actual.reason,turn:actual.turn,replayMatched:true,starvationDeaths:actual.statistics.starvationDeaths,screeningInfections:actual.statistics.screeningInfections,waitingInfections:actual.statistics.waitingInfections,livingConditionInfections:actual.statistics.livingConditionInfections});
}
writeFileSync('output/v163-public-playtest-replay.json',JSON.stringify(reports,null,2)+'\n');console.log(reports);
