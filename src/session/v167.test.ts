import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from './store';
import { SessionService } from './service';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';
import { ReplayPackage, ReplayZip } from '../replay/package';

it('preserves pursuit and null populations across processes, checkpoint branches, compact, handoff and ZIP replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-v167-'));
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v167-session-test', NLTH_GIT_COMMIT: 'a'.repeat(40) });
  const factory = createAgentSessionGameFactory(identity.buildId, { vision: { capital: 50 }, horde: { warningLeadTurns: 1, waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
    economy: { initialZombieCount: 0, initialGasCount: { min: 0, max: 0 }, initialHunterCount: { min: 0, max: 0 }, initialScreamerCount: 0,
      initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } } });
  const service = new SessionService(new SessionStore(root), factory, identity);
  service.newSession({ sessionId: 'pursuit', seed: 4 });
  const candidates = service.query('pursuit', { target: 'worker-assignments' });
  expect(candidates.items!.some((x: any) => x.currentWorkers === null)).toBe(true);
  expect(service.step('pursuit', { action: { type: 'EndTurn' }, expectedRevision: 0 }).accepted).toBe(true);
  expect(service.step('pursuit', { action: { type: 'EndTurn' }, expectedRevision: 1 }).accepted).toBe(true);
  const waiting = service.status('pursuit');
  expect(waiting.observation.visibleEnemies[0]!.appliedMovementBonus).toBe(0);
  const checkpoint = service.saveCheckpoint('pursuit'); service.loadCheckpoint('pursuit', checkpoint.checkpointId, 'branch');
  const resumed = new SessionService(new SessionStore(root), factory, identity);
  expect(resumed.step('pursuit', { action: { type: 'EndTurn' }, expectedRevision: 2 }).accepted).toBe(true);
  expect(service.step('branch', { action: { type: 'EndTurn' }, expectedRevision: 2 }).accepted).toBe(true);
  const current = resumed.status('pursuit');
  expect(current.observation.visibleEnemies).toEqual(service.status('branch').observation.visibleEnemies);
  expect(current.observation.visibleEnemies[0]).toMatchObject({ appliedMovementBonus: 3 });
  const hidden = current.observation.facilities.filter(f => f.owner !== 'player');
  expect(hidden.length).toBeGreaterThan(0); expect(hidden.every(f => f.healthyPopulation === null)).toBe(true);
  const handoff = resumed.query('pursuit', { target: 'context-handoff', expectedRevision: 3 });
  expect(JSON.stringify(handoff)).toContain('"appliedMovementBonus":3');
  expect(JSON.stringify(handoff)).not.toMatch(/pursuitTargetLastPhase|waveCapitalAnchor|noiseTarget|inheritedTarget/);
  const zip = resumed.exportArtifact('pursuit', join(root, 'pursuit.zip'));
  expect(resumed.replayArtifact(zip.artifactPath).matched).toBe(true);
  const replay = await new ReplayPackage(new ReplayZip(new Blob([readFileSync(zip.artifactPath)]), new AbortController().signal)).open();
  const frame = await replay.decision(2);
  expect(JSON.stringify(frame)).toContain('"appliedMovementBonus":3');
  expect(JSON.stringify(frame)).not.toContain('pursuitTargetLastPhase');
}, 120000);
