import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTerminalSessionFixture, terminalFixtureAction } from '../src/testing/v171-session-fixture';
import { SessionService } from '../src/session/service';
import { SessionStore } from '../src/session/store';
import { resolveSessionIdentity } from '../src/session/agent-adapter';
import type { GameState } from '../src/core/types';
import { APP_VERSION } from '../src/core/versions';

const root=resolve('output/playwright',`v171-terminal-${Date.now()}`);
mkdirSync(root,{recursive:true});
const identity=resolveSessionIdentity({NLTH_BUILD_ID:'v171-terminal',NLTH_GIT_COMMIT:'a'.repeat(40)});
const records=[];
for(const outcome of ['won','lost'] as const) {
  const storeRoot=join(root,outcome),store=new SessionStore(storeRoot);
  const api=new SessionService(store,createTerminalSessionFixture(identity.buildId,outcome),identity);
  api.newSession({sessionId:outcome,seed:1547,mapMode:'fixed'});
  const initial=store.load(outcome).privateState as unknown as GameState;
  api.step(outcome,{action:{type:'Wait',unitId:'missing'},expectedRevision:0});
  api.step(outcome,{action:{type:'Wait',unitId:'police-1'},expectedRevision:1});
  const ended=api.step(outcome,{action:terminalFixtureAction(initial,outcome),expectedRevision:2});
  if(!ended.gameOver)throw Error('Fixture did not end');
  const output=join(root,`${outcome}.zip`);
  const result=spawnSync(process.execPath,['scripts/run-session.mjs','artifact',`--session=${outcome}`,`--root=${storeRoot}`,`--out=${output}`],{encoding:'utf8',windowsHide:true,env:{...process.env,NLTH_BUILD_ID:identity.buildId,NLTH_GIT_COMMIT:identity.gitCommit}});
  if(result.status!==0)throw Error(result.stderr);
  const manifest=api.readArtifact(output);
  const replay=api.replayArtifact(output);
  if(!replay.matched)throw Error('Core replay mismatch');
  records.push({outcome,output,appVersion:APP_VERSION,decisionCount:manifest.decisionCount,coreReplay:replay.matched,result:store.load(outcome).publicState.result,sha256:createHash('sha256').update(readFileSync(output)).digest('hex')});
}
writeFileSync(join(root,'record.json'),JSON.stringify(records,null,2));
writeFileSync(resolve('output/playwright/v171-fixtures-latest.json'),JSON.stringify({root,records},null,2));
console.log(JSON.stringify({root,records:records.map(({result,...record})=>record)},null,2));
