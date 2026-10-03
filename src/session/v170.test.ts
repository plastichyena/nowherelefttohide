import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionService} from './service';
import {SessionStore} from './store';
import {createAgentSessionGameFactory,resolveSessionIdentity} from './agent-adapter';
import {ReplayPackage,ReplayZip} from '../replay/package';
import {GameEngine} from '../core/engine';
import {createDefaultConfig} from '../core/config';
import {encodeSaveCode,decodeSaveCode} from '../persistence/save';
import type {GameState} from '../core/types';

it.each(['fixed','random'] as const)('%s Save, Session, resume, branch and public seek preserve the recorded map; executable replay matches separately',async mapMode=>{
  const state=new GameEngine(42,createDefaultConfig({mapMode,mapSeed:1,gameplaySeed:2})).getState() as GameState;
  const loaded=decodeSaveCode(encodeSaveCode(state));
  expect(loaded.valid,JSON.stringify(loaded)).toBe(true);
  if(!loaded.valid)throw new Error('decode failed');
  expect(loaded.state).toEqual(state);
  const root=mkdtempSync(join(tmpdir(),'nlth-v170-'));
  const identity=resolveSessionIdentity({NLTH_BUILD_ID:'v170',NLTH_GIT_COMMIT:'a'.repeat(40)});
  const factory=createAgentSessionGameFactory(identity.buildId);
  const api=new SessionService(new SessionStore(root),factory,identity);
  const initial=api.newSession({sessionId:'map',scenarioId:'una',seed:42,mapMode,mapSeed:1,gameplaySeed:2});
  for(let revision=0;revision<3;revision++)expect(api.step('map',{action:{type:'EndTurn'},expectedRevision:revision}).accepted).toBe(true);
  const before=api.status('map'),checkpoint=api.saveCheckpoint('map');
  expect(new SessionService(new SessionStore(root),factory,identity).status('map').observation).toEqual(before.observation);
  api.loadCheckpoint('map',checkpoint.checkpointId,'branch');
  const artifact=api.exportArtifact('branch',join(root,'public'));
  expect(api.replayArtifact(artifact.artifactPath)).toMatchObject({matched:true,decisionCount:3});
  const replay=await new ReplayPackage(new ReplayZip(new Blob([readFileSync(artifact.artifactPath)]),new AbortController().signal)).open();
  for(const index of [0,1,2]) {
    const frame=await replay.decision(index);
    expect(frame.after.observation.mapDescriptor?.mapHash).toBe(state.mapDescriptor.mapHash);
  }
  expect(initial.observation.map?.id).toBe(state.mapId);
},120000);
