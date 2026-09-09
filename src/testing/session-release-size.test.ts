import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createAgentSessionGameFactory, resolveSessionIdentity } from '../session/agent-adapter';
import { SessionService } from '../session/service';
import { SessionStore } from '../session/store';
import { artifactPayloadBytes } from './session-release-size';

function diskBytes(path: string): number {
  const stat = statSync(path);
  return stat.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + diskBytes(join(path, name)), 0) : stat.size;
}

it('counts only exported public chunks, including branch history, without private or unused data', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-release-size-'));
  const store = new SessionStore(root, undefined, { gzipLevel: 0 });
  const identity = resolveSessionIdentity();
  const api = new SessionService(store, createAgentSessionGameFactory(identity.buildId), identity, { publicSnapshotInterval: 1 });
  api.newSession({ sessionId: 'size', seed: 1, checkpointInterval: 1 });
  api.step('size', { action: { type: 'EndTurn' }, decisionSummary: 'Real state transition', expectedRevision: 0 });
  const before = artifactPayloadBytes(store, 'size');
  store.writePayload('private', { unused: 'x'.repeat(2_000_000) });
  store.writePayload('public', { unused: 'y'.repeat(2_000_000) });
  expect(artifactPayloadBytes(store, 'size')).toBe(before);
  const checkpoint = api.saveCheckpoint('size');
  api.loadCheckpoint('size', checkpoint.checkpointId, 'branch');
  const lowerBound = artifactPayloadBytes(store, 'branch');
  expect(lowerBound).toBeGreaterThanOrEqual(before);
  const exported = api.exportArtifact('branch', join(root, 'export'));
  expect(diskBytes(join(exported.artifactPath, 'payloads', 'public', 'chunks'))).toBe(lowerBound);
  expect(diskBytes(exported.artifactPath)).toBeGreaterThan(lowerBound);
  expect(diskBytes(join(root, 'pool'))).toBeGreaterThan(diskBytes(exported.artifactPath));
}, 120000);
