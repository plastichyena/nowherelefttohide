import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSessionReleaseFixtureFactory } from '../testing/session-release-fixture';
import { resolveSessionIdentity } from './agent-adapter';
import { SessionService } from './service';
import { SessionStore } from './store';
import type { SessionPayloadReference } from './types';

// Count actual payload validations without replacing any disk/hash checks.
class MeasuredStore extends SessionStore {
  readonly validatedHashes: string[] = [];
  override validatePayload(reference: SessionPayloadReference): void {
    this.validatedHashes.push(reference.contentHash);
    super.validatePayload(reference);
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nlth-checkpoint-scaling-'));
  const identity = resolveSessionIdentity();
  const store = new MeasuredStore(root, undefined, { gzipLevel: 0 });
  const factory = createSessionReleaseFixtureFactory(identity.buildId);
  const service = new SessionService(store, factory, identity, { publicSnapshotInterval: 1 });
  service.newSession({ sessionId: 'scaling', seed: 1511, checkpointInterval: 1 });
  return { root, store, service, factory, identity };
}

it('does not reread inactive checkpoint payloads on every accepted Core action', () => {
  const { store, service } = fixture();
  const first = service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: 0 });
  const oldest = first.checkpointsCreated[0]!;
  expect(oldest.checkpointId).toBe('after-turn-001');
  for (let revision = 1; revision < 3; revision++) {
    expect(service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: revision }).accepted).toBe(true);
  }
  store.validatedHashes.length = 0;
  const fourth = service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: 3 });
  expect(fourth.accepted).toBe(true);
  expect(fourth.checkpointsCreated.map(checkpoint => checkpoint.checkpointId)).toEqual(['after-turn-004']);
  expect(store.validatedHashes).not.toContain(oldest.privateState.contentHash);
  expect(store.validatedHashes).not.toContain(oldest.publicState.contentHash);
  expect(service.listCheckpoints('scaling')).toHaveLength(4);
  expect(service.loadCheckpoint('scaling', oldest.checkpointId, 'old-branch').active.revision).toBe(1);
}, 120_000);

it('still rejects a corrupt current automatic checkpoint without advancing the Session', () => {
  const { root, store, service } = fixture();
  const stepped = service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: 0 });
  const checkpoint = stepped.checkpointsCreated[0]!;
  const path = join(root, 'scaling', 'checkpoints', `${checkpoint.checkpointId}.meta.json`);
  const original = readFileSync(path, 'utf8');
  const corrupted = JSON.parse(original);
  corrupted.publicDocumentHash = '0'.repeat(64);
  writeFileSync(path, JSON.stringify(corrupted));
  expect(() => service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: 1 })).toThrow(/integrity hash mismatch/);
  expect(store.readCurrentHead('scaling').active.revision).toBe(1);
  expect(() => service.listCheckpoints('scaling')).toThrow(/integrity hash mismatch/);
  expect(() => service.loadCheckpoint('scaling', checkpoint.checkpointId, 'corrupt-branch')).toThrow(/integrity hash mismatch/);
  writeFileSync(path, original);
  expect(service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: 1 }).accepted).toBe(true);
}, 120_000);
