import { it,expect } from 'vitest';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionService } from './service';
import { SessionStore } from './store';
import { createAgentSessionGameFactory,resolveSessionIdentity } from './agent-adapter';
import { createUnit } from '../core/state';
import { prepareTestSnapshot } from '../core/testConfig';
import type { GameState,JsonValue } from '../core/types';
import { ReplayPackage,ReplayZip } from '../replay/package';

it('preserves IFV cargo, lifetime count and summaries across resume, branch, executable Replay and public ZIP',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nlth-v169-'));
  const identity=resolveSessionIdentity({NLTH_BUILD_ID:'v169-contract',NLTH_GIT_COMMIT:'a'.repeat(40)});
  const real=createAgentSessionGameFactory(identity.buildId);
  const factory={...real,createNew:(options:Parameters<typeof real.createNew>[0])=>{
    const runtime=real.createNew(options),s=runtime.exportPrivateState() as unknown as GameState;
    s.units=[createUnit(s,'vehicle','ifv',{q:25,r:25}),createUnit(s,'cargo','police',{q:24,r:25}),createUnit(s,'enemy','zombie',{q:26,r:25})];
    s.completedProductions.ifv=1;prepareTestSnapshot(s);
    return real.restore({privateState:s as unknown as JsonValue,agentId:options.agentId,decision:0,seed:options.seed,sessionId:'fixture',traceHeadHash:'0'.repeat(64)});
  }};
  const api=new SessionService(new SessionStore(root),factory,identity);
  api.newSession({sessionId:'ifv',seed:1});
  expect(api.step('ifv',{action:{type:'BoardTransport',unitId:'cargo',transportId:'vehicle'},expectedRevision:0}).accepted).toBe(true);
  const moved=api.step('ifv',{action:{type:'Move',unitId:'vehicle',destination:{q:27,r:25}},expectedRevision:1});
  expect(moved.summary).toMatchObject({accepted:true,baseRevision:1,resultRevision:2,movement:{actualPosition:{q:27,r:25}}});
  const before=api.status('ifv'),checkpoint=api.saveCheckpoint('ifv');
  expect(new SessionService(new SessionStore(root),factory,identity).status('ifv').observation).toEqual(before.observation);
  api.loadCheckpoint('ifv',checkpoint.checkpointId,'branch');
  expect((api.query('branch',{target:'units',filters:{id:'vehicle'}}).items![0] as any).production).toMatchObject({completed:1,remaining:0});
  const out=api.exportArtifact('branch',join(root,'public'));
  expect(api.replayArtifact(out.artifactPath).matched).toBe(true);
  const replay=await new ReplayPackage(new ReplayZip(new Blob([readFileSync(out.artifactPath)]),new AbortController().signal)).open();
  const d=await replay.decision(1);
  expect(d.after.observation.units.find(u=>u.id==='vehicle')).toMatchObject({cargoUnitId:'cargo',position:{q:27,r:25},currentFuel:80});
  expect(d.after.observation.units.find(u=>u.id==='cargo')).toMatchObject({transportedByUnitId:'vehicle'});
},120000);

it('preserves the resolved UNA preset through executable artifact replay',()=>{
  const root=mkdtempSync(join(tmpdir(),'nlth-v169-una-'));
  const identity=resolveSessionIdentity({NLTH_BUILD_ID:'v169-una',NLTH_GIT_COMMIT:'b'.repeat(40)});
  const api=new SessionService(new SessionStore(root),createAgentSessionGameFactory(identity.buildId),identity);
  api.newSession({sessionId:'una',scenarioId:'una',seed:7});
  expect(api.step('una',{action:{type:'EndTurn'},expectedRevision:0}).accepted).toBe(true);
  const artifact=api.exportArtifact('una',join(root,'public'));
  expect(api.replayArtifact(artifact.artifactPath)).toMatchObject({matched:true,decisionCount:1});
},60000);
