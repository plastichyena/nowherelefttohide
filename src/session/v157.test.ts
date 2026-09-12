import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from './store';
import { SessionService } from './service';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';
import type { JsonValue } from '../core/types';

it('resumes important changes after later actions, branches without future history, and exposes pinned schemas/graph/route', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-v157-'));
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v157-test', NLTH_GIT_COMMIT: 'a'.repeat(40) });
  const service = () => new SessionService(new SessionStore(root), createAgentSessionGameFactory(identity.buildId), identity);
  const api = service();
  const initial = api.newSession({ sessionId: 'readable', seed: 1 });
  const facility = initial.observation.facilities[0]!;
  expect(facility).toHaveProperty('populationCapacity');
  expect(facility).toHaveProperty('operationalStatus');
  expect(facility.production).toHaveProperty('stoppedReason');
  expect(Object.keys(facility.production)).toHaveLength(2);
  const checkpoint = api.saveCheckpoint('readable');
  const ended = api.step('readable', { action: { type: 'EndTurn' }, decisionSummary: 'Observe the next turn', expectedRevision: 0 });
  expect(ended.accepted).toBe(true);
  expect(ended.importantChanges.totalCount).toBeGreaterThan(0);
  const next = api.step('readable', { action: { type: 'Wait', unitId: ended.observation.units[0]!.id }, decisionSummary: 'Wait after important changes', expectedRevision: ended.revision });
  expect(next.accepted).toBe(true);
  const resumed = service().status('readable');
  expect(resumed.observation.importantChanges.range.fromDecision).toBe(1);
  expect(resumed.observation.importantChanges.items.some(change => change.decision === 1)).toBe(true);
  expect(resumed.observation.importantChanges).toEqual(next.observation.importantChanges);
  const rejected = api.step('readable', { action: { type: 'BuildBarbedWire', position: { q: -1, r: -1 } }, decisionSummary: 'Reject invalid construction' });
  expect(rejected.accepted).toBe(false);
  expect(rejected.importantChanges.totalCount).toBe(0);
  const branched = api.loadCheckpoint('readable', checkpoint.checkpointId, 'branch');
  expect(branched.observation.importantChanges.totalCount).toBe(0);
  expect(branched.observation.importantChanges.range.toDecision).toBe(0);

  const info = api.query('branch', { target: 'api' }).value as Record<string, JsonValue>;
  expect(info.queryContract).toMatchObject({ schemaFormat: 'JSON Schema', schemaVersion: '2020-12' });
  expect(() => api.query('branch', { target: 'units', filters: { filters: { id: 'police-1' } } })).toThrow(/not supported/);
  expect(() => api.query('branch', { target: 'units', filters: [] as never })).toThrow(/object/);
  const first = api.query('branch', { target: 'strategic-map', expectedRevision: 0, pageSize: 1 });
  expect(first.items).toHaveLength(1); expect(first.hasMore).toBe(true);
  const all = [...first.items!]; let cursor = first.nextCursor;
  while (cursor) {
    const page = api.query('branch', { target: 'strategic-map', expectedRevision: 0, cursor, pageSize: 100 });
    all.push(...page.items!); cursor = page.nextCursor;
  }
  expect(all).toHaveLength(first.total);
  expect(new Set(all.map(item => (item as Record<string, JsonValue>).id)).size).toBe(first.total);
  const route = api.query('branch', { target: 'route', expectedRevision: 0, filters: { moverUnitId: initial.observation.units[0]!.id, destination: { kind: 'facility', id: 'capital' } } });
  expect(route.value).toHaveProperty('currentSingleAction');
  expect(api.status('branch').revision).toBe(0);
  api.step('branch', { action: { type: 'EndTurn' }, decisionSummary: 'Advance branch' });
  expect(() => api.query('branch', { target: 'strategic-map', cursor: first.nextCursor! })).toThrow(/revision/);
}, 120000);

it('does not duplicate wall statistics on idempotent play-turn retries or checkpoint branches', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-v157-retry-'));
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v157-retry', NLTH_GIT_COMMIT: 'b'.repeat(40) });
  const store = new SessionStore(root);
  const api = new SessionService(store, createAgentSessionGameFactory(identity.buildId), identity);
  api.newSession({ sessionId: 'wall', seed: 1 });
  const candidate = api.query('wall', { target: 'construction', filters: { facilityType: 'barbedWire', legalOnly: true }, pageSize: 1 }).items![0] as Record<string, JsonValue>;
  const request = { type: 'action' as const, action: { type: 'BuildBarbedWire' as const, position: candidate.position as unknown as { q: number; r: number } }, expectedRevision: 0, requestId: 'build-once', decisionSummary: 'Build a defensive wall' };
  const first = api.playTurnAction('wall', request);
  expect(first.accepted).toBe(true);
  const retry = api.playTurnAction('wall', request);
  expect(retry.replayed).toBe(true);
  expect(retry.originalDecision).toBe(first.originalDecision);
  expect((store.load('wall').privateState as unknown as { statistics: { barbedWireBuilt: number } }).statistics.barbedWireBuilt).toBe(1);
  const checkpoint = api.saveCheckpoint('wall');
  api.loadCheckpoint('wall', checkpoint.checkpointId, 'copy');
  expect((store.load('copy').privateState as unknown as { statistics: { barbedWireBuilt: number } }).statistics.barbedWireBuilt).toBe(1);
  const artifact = api.exportArtifact('copy', join(root, 'artifact'));
  expect(api.replayArtifact(artifact.artifactPath).matched).toBe(true);
}, 120000);
