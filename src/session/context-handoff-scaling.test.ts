import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSessionReleaseFixtureFactory } from '../testing/session-release-fixture';
import { resolveSessionIdentity } from './agent-adapter';
import { SessionService } from './service';
import { SessionStore } from './store';
import type { SessionPayloadReference } from './types';

class MeasuredStore extends SessionStore {
  readonly snapshotReads: string[] = [];
  override readPayload<T>(reference: SessionPayloadReference, subject = 'Session payload'): T {
    if (/^Decision \d+ Snapshot$/u.test(subject)) this.snapshotReads.push(subject);
    return super.readPayload<T>(reference, subject);
  }
}

it('builds current handoff during continued Core actions without rereading historical snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-handoff-scaling-'));
  const identity = resolveSessionIdentity();
  const store = new MeasuredStore(root, undefined, { gzipLevel: 0 });
  const service = new SessionService(store, createSessionReleaseFixtureFactory(identity.buildId), identity, { publicSnapshotInterval: 1 });
  service.newSession({ sessionId: 'scaling', seed: 1511, checkpointInterval: 1 });
  for (let decision = 1; decision <= 3; decision++) {
    store.snapshotReads.length = 0;
    const stepped = service.step('scaling', { action: { type: 'EndTurn' }, expectedRevision: decision - 1, decisionSummary: `Intent ${decision}` });
    expect(stepped.accepted).toBe(true);
    expect(stepped.contextHandoff).toMatchObject({ sourceRevision: decision, authoritativeState: { turn: decision + 1 }, contextCheckpoint: { completedTurns: decision }, agentIntent: { latestAcceptedEndTurn: { decision, summary: `Intent ${decision}` } } });
    if (decision === 3) expect(store.snapshotReads).not.toContain('Decision 1 Snapshot');
  }
  store.snapshotReads.length = 0;
  expect(service.playTurnStatus('scaling').contextHandoff.sourceRevision).toBe(3);
  expect(store.snapshotReads).toEqual([]);
}, 120_000);

it('rebuilds the same handoff on resume, follows new commits, and excludes a parent future from branches', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-handoff-resume-'));
  const identity = resolveSessionIdentity();
  const factory = createSessionReleaseFixtureFactory(identity.buildId);
  const store = new MeasuredStore(root, undefined, { gzipLevel: 0 });
  const service = new SessionService(store, factory, identity, { publicSnapshotInterval: 1 });
  service.newSession({ sessionId: 'parent', seed: 1511, preferredCommentLocale: 'ja' });
  const first = service.step('parent', { action: { type: 'EndTurn' }, decisionSummary: '分岐前' });
  const checkpoint = service.saveCheckpoint('parent');
  expect(first.contextHandoff.agentIntent.recent).toEqual([{ decision: 1, summary: '分岐前' }]);
  service.step('parent', { action: { type: 'EndTurn' }, decisionSummary: '親の未来' });
  const child = service.loadCheckpoint('parent', checkpoint.checkpointId, 'child');
  expect(child.contextHandoff.contextCheckpoint.completedTurns).toBe(1);
  expect(child.contextHandoff.agentIntent.recent).toEqual([{ decision: 1, summary: '分岐前' }]);
  const rejected = service.step('child', { action: { type: 'Wait', unitId: 'missing' }, expectedRevision: 1, decisionSummary: '拒否された操作' });
  expect(rejected.accepted).toBe(false);
  expect(rejected.contextHandoff.sourceRevision).toBe(2);
  expect(rejected.contextHandoff.agentIntent.recent).toEqual(child.contextHandoff.agentIntent.recent);

  const external = new SessionService(new SessionStore(root), factory, identity);
  expect(external.step('parent', { action: { type: 'EndTurn' }, expectedRevision: 2, decisionSummary: '別Callerの操作' }).accepted).toBe(true);
  const fourth = service.step('parent', { action: { type: 'EndTurn' }, expectedRevision: 3, decisionSummary: '新しいheadを継続' });
  expect(fourth.contextHandoff.contextCheckpoint.completedTurns).toBe(4);
  expect(fourth.contextHandoff.agentIntent.recent.map(item => item.summary)).toEqual(['分岐前', '親の未来', '別Callerの操作', '新しいheadを継続']);
  const expected = structuredClone(fourth.contextHandoff);
  fourth.contextHandoff.agentIntent.recent[0]!.summary = 'Callerの編集';
  fourth.contextHandoff.authoritativeState.resources.food = -1;
  expect(service.playTurnStatus('parent').contextHandoff).toEqual(expected);

  // A full resume validates each stored snapshot once, then projects the same
  // facts without a second pass through all public payloads.
  store.snapshotReads.length = 0;
  const resumed = service.status('parent');
  expect(resumed.contextHandoff).toEqual(expected);
  expect(store.snapshotReads.filter(subject => subject === 'Decision 1 Snapshot')).toHaveLength(1);
  const beforeQuery = store.readCurrentHead('parent').active;
  expect(service.query('parent', { target: 'context-handoff', expectedRevision: 4 }).value).toEqual(expected);
  expect(store.readCurrentHead('parent').active).toEqual(beforeQuery);
  expect(external.status('child').contextHandoff).toEqual(rejected.contextHandoff);

  // Failure of a full disk validation must invalidate the warm continuation.
  const tracePath = join(root, 'parent', 'trace.ndjson');
  const trace = readFileSync(tracePath, 'utf8');
  writeFileSync(tracePath, '{"tampered":true}\n');
  expect(() => service.status('parent')).toThrow(/trace.ndjson/);
  expect(() => service.step('parent', { action: { type: 'EndTurn' }, expectedRevision: 4 })).toThrow(/trace.ndjson/);
  expect(store.readCurrentHead('parent').active.decision).toBe(4);
  writeFileSync(tracePath, trace);
  expect(service.status('parent').contextHandoff).toEqual(expected);
}, 120_000);
