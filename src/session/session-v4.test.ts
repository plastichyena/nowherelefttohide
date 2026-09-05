import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameAction, JsonValue } from '../core/types';
import { DEFAULT_CONFIG } from '../core/config';
import type { AgentMapObservation, AgentObservation, AgentStepResult } from '../agent/types';
import { applyLosslessJsonDiff, createLosslessJsonDiff } from './public-diff';
import { canonicalJson, sha256Bytes, sha256Json } from './hash';
import { SessionService } from './service';
import { SessionStore } from './store';
import { SessionError, type SessionGameFactory, type SessionGameRuntime, type SessionStepInput, type SessionVersionIdentity } from './types';

function root(name: string): string { return mkdtempSync(join(tmpdir(), `nlth-session-v4-${name}-`)); }

const map = {
  id: 'test-map', width: 1, height: 1, coordinateSystem: 'axial-q-r' as const, hordeSpawnReserve: [],
  tiles: [{ q: 0, r: 0, terrain: 'plain' as const, road: false, urban: false, facilityId: null, checkpointId: null, hordeEntrance: null, hordeSpawnReserve: false, playerOccupancyAllowed: true, passable: true, effectiveMovementCost: 1, terrainDefenseSource: 'none' as const, terrainDamageMultiplier: 1, visibleToPlayer: true }],
} as unknown as AgentMapObservation;

function observation(turn: number): AgentObservation {
  return {
    apiVersion: '8.0.0', gameRulesVersion: '4.0.0', turn, finalHordeTurn: 50, phase: 'player', map,
    resources: { food: 10 + turn, civilianGoods: 10, militaryGoods: 10, fuel: 10, electricityCapacity: 0, electricityRequired: 0 },
    population: { healthyCivilians: 1, cityResidents: 1, productionWorkers: 0, unitPopulation: 0, waitingRefugees: 0, screeningRefugees: 0, approvedRefugees: 0, infected: 0 },
    facilities: [], units: [], zombies: [], checkpoints: [], importantSiteEvents: [], checkpointPositionCandidates: [], constructibleFacilityPositionCandidates: [], roadBranches: [],
    supply: { initialRadius: 0, suppliedTileKeys: ['0,0'], branchRadii: [] },
    horde: { warningType: 'none', warningDirections: [], nextWaveIndex: null, nextWave: null, spawnTurn: null, finalHordeStatus: 'notStarted', turnsRemaining: 0, nextSpawnTurn: null },
    victory: { finalHordeDefeated: false, suppliedAreaZombieClear: true, suppliedAreaInfectionClear: true },
    finalHordeDefeated: false, suppliedAreaZombieClear: true, suppliedAreaInfectionClear: true,
    crisisSummary: { items: [], highestSeverity: null } as never,
    endTurnRisk: { confirmationRecommended: false, reasons: [] } as never,
    endTurnForecast: {
      overcrowding: { cities: [], additionalCivilianGoods: 0, additionalFood: 0 },
      food: { shortage: 0 }, civilianGoods: { shortage: 0 },
      militaryGoods: { totalUnfilledRefillDemand: 0, units: [] },
      fuel: { totalFuelShortage: 0, windPowerAvailable: 0 }, electricity: { shortage: 0 },
    } as never,
    strategicForecast: { guaranteedDefeat: { guaranteed: false }, resources: {} } as never,
    gameOver: false, result: null,
  };
}

class Runtime implements SessionGameRuntime {
  public constructor(private turn = 1) {}
  public getObservation(): AgentObservation { return structuredClone(observation(this.turn)); }
  public getLegalActions(): GameAction[] { return [{ type: 'EndTurn' }]; }
  public step(input: SessionStepInput): AgentStepResult {
    if (input.action.type !== 'EndTurn') return { observation: this.getObservation(), events: [], error: { code: 'illegal_action', message: 'Only EndTurn is legal' }, gameOver: false, result: null };
    this.turn += 1;
    return { observation: this.getObservation(), events: [], error: null, gameOver: false, result: null };
  }
  public isGameOver(): boolean { return false; }
  public getResult(): null { return null; }
  public getRunArtifact(): never { return { config: structuredClone(DEFAULT_CONFIG) } as never; }
  public exportPrivateState(): JsonValue { return { turn: this.turn, map: { id: 'private-map', cells: [1, 2, 3] }, events: [] }; }
}

const factory: SessionGameFactory = {
  createNew: () => new Runtime(),
  restore: ({ privateState }) => new Runtime((privateState as { turn: number }).turn),
};
const identity: SessionVersionIdentity = { appVersion: '1.5.1', gameRulesVersion: '4.0.0', saveFormatVersion: 11, artifactSchemaVersion: '7.0.0', agentApiVersion: '8.0.0', observationApiVersion: '8.0.0', bridgeApiVersion: '8.0.0', buildId: 'test-build', gitCommit: 'a'.repeat(40), mapId: 'test-map' };
function service(path: string): SessionService { return new SessionService(new SessionStore(path), factory, identity); }

describe('Session Schema 5 bounded storage and queries', () => {
  it('supports bounded release-fixture compression and snapshot interval overrides', () => {
    const path = root('release-options');
    const store = new SessionStore(path, undefined, { gzipLevel: 0 });
    const api = new SessionService(store, factory, identity, { publicSnapshotInterval: 1 });
    api.newSession({ sessionId: 'options' });
    const step = api.step('options', { action: { type: 'EndTurn' }, decisionSummary: 'full snapshot fixture' });
    expect(step.decisionRecord.publicPayloadKind).toBe('snapshot');
    expect(step.decisionRecord.publicPayload.compressedBytes).toBeGreaterThan(0);
  });

  it('round-trips ordered JSON exactly and rejects hostile or malformed patches', () => {
    const before = { ordered: ['a', 'b', 'd'], nested: { keep: 1, remove: true } } as unknown as JsonValue;
    const after = { ordered: ['a', 'b', 'c', 'd'], nested: { keep: 2, add: null } } as unknown as JsonValue;
    const patch = createLosslessJsonDiff(before, after);
    expect(applyLosslessJsonDiff(before, patch)).toEqual(after);
    expect(() => applyLosslessJsonDiff(before, [{ op: 'set', path: ['__proto__', 'polluted'], value: true }])).toThrow(SessionError);
    expect(() => applyLosslessJsonDiff(before, [{ op: 'splice', path: ['ordered'], index: 99, deleteCount: 0, values: [] }])).toThrow(SessionError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('uses compact responses and revision-bound, stable pagination', () => {
    const path = root('query');
    const api = service(path);
    const created = api.newSession({ sessionId: 'query' });
    expect(created.revision).toBe(0);
    expect(created.observation).not.toHaveProperty('map');
    const full = api.query('query', { target: 'full-snapshot', expectedRevision: 0 });
    expect((full.value as unknown as { observation: AgentObservation }).observation.map).toEqual(map);
    const first = api.query('query', { target: 'map', expectedRevision: 0, pageSize: 1 });
    expect(first.items).toHaveLength(1);
    api.step('query', { action: { type: 'EndTurn' }, decisionSummary: 'advance', expectedRevision: 0 });
    expect(() => api.query('query', { target: 'map', cursor: first.nextCursor ?? undefined, expectedRevision: 0 })).toThrow(/stale_revision|Expected revision/u);
    expect(() => api.step('query', { action: { type: 'EndTurn' }, decisionSummary: 'stale', expectedRevision: 0 })).toThrow(/Expected revision/u);
    expect(api.status('query').active.decision).toBe(1);
  });

  it('keeps a branch-local chain and exports a self-contained readable and replayable package', () => {
    const path = root('branch');
    const api = service(path);
    api.newSession({ sessionId: 'parent' });
    api.step('parent', { action: { type: 'EndTurn' }, decisionSummary: 'one' });
    api.step('parent', { action: { type: 'EndTurn' }, decisionSummary: 'two' });
    const checkpoint = api.saveCheckpoint('parent');
    const child = api.loadCheckpoint('parent', checkpoint.checkpointId, 'child');
    expect(child.session.branchBase).toMatchObject({ baseDecision: 2, baseTraceHeadHash: checkpoint.publicTraceHeadHash });
    expect(readdirSync(join(path, 'child', 'public', 'decisions'))).toEqual([]);
    expect(child.active).toMatchObject({ decision: 2, localDecisionCount: 0, traceHeadHash: checkpoint.publicTraceHeadHash, acceptedActionCount: 2 });
    const childCheckpoint = api.saveCheckpoint('child');
    const grandchild = api.loadCheckpoint('child', childCheckpoint.checkpointId, 'grandchild');
    expect(grandchild.session.branchBase).toMatchObject({ rootSessionId: 'parent', parentSessionId: 'child', baseDecision: 2 });
    expect(grandchild.active).toMatchObject({ decision: 2, localDecisionCount: 0, acceptedActionCount: 2 });
    const grandchildDescriptorPath = join(path, 'grandchild', 'session.json');
    const mismatchedDescriptor = JSON.parse(readFileSync(grandchildDescriptorPath, 'utf8')) as Record<string, unknown> & { branchBase: Record<string, unknown> };
    mismatchedDescriptor.branchBase.basePublicSnapshotHash = 'f'.repeat(64);
    delete mismatchedDescriptor.descriptorIntegrityHash;
    mismatchedDescriptor.descriptorIntegrityHash = sha256Json(mismatchedDescriptor);
    writeFileSync(grandchildDescriptorPath, `${canonicalJson(mismatchedDescriptor)}\n`, 'utf8');
    expect(() => api.status('grandchild')).toThrow(/Ancestor Manifest does not match branchBase/u);
    const stepped = api.step('child', { action: { type: 'EndTurn' }, decisionSummary: 'child three', expectedRevision: 2 });
    expect(stepped.decisionRecord.decision).toBe(3);
    expect(stepped.decisionRecord.previousDecisionHash).toBe(checkpoint.publicTraceHeadHash);
    const out = join(path, 'export.nlth-artifact');
    const manifest = api.exportArtifact('child', out);
    expect(manifest).toMatchObject({ decisionCount: 3, acceptedActionCount: 3 });
    expect(api.readArtifact(out).manifestHash).toBe(manifest.manifestHash);
    expect(api.replayArtifact(out)).toMatchObject({ matched: true, decisionCount: 3 });
    expect(readFileSync(join(out, 'artifact.ndjson'), 'utf8')).not.toContain('private-map');
    const detached = join(root('detached-package'), 'copied.nlth-artifact');
    cpSync(out, detached, { recursive: true });
    expect(api.readArtifact(detached).manifestHash).toBe(manifest.manifestHash);
    expect(api.replayArtifact(detached)).toMatchObject({ matched: true, decisionCount: 3 });
    const manifestPath = join(out, 'manifest.json');
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const changed = JSON.parse(originalManifest) as Record<string, unknown>;
    changed.buildId = 'different-build';
    delete changed.manifestHash;
    changed.manifestHash = sha256Json(changed);
    writeFileSync(manifestPath, `${canonicalJson(changed)}\n`, 'utf8');
    expect(() => api.readArtifact(out)).toThrow(/buildId/u);
    writeFileSync(manifestPath, originalManifest, 'utf8');
    appendFileSync(join(out, 'artifact.ndjson'), '{"kind":"trailing"}\n', 'utf8');
    const trailingManifest = JSON.parse(originalManifest) as Record<string, unknown>;
    trailingManifest.streamHash = sha256Bytes(readFileSync(join(out, 'artifact.ndjson')));
    delete trailingManifest.manifestHash;
    trailingManifest.manifestHash = sha256Json(trailingManifest);
    writeFileSync(manifestPath, `${canonicalJson(trailingManifest)}\n`, 'utf8');
    expect(() => api.readArtifact(out)).toThrow(/after its footer/u);
  });

  it('reconstructs a bounded history page from the nearest periodic snapshot', () => {
    const path = root('history');
    const api = service(path);
    api.newSession({ sessionId: 'history', checkpointInterval: 10_000 });
    for (let decision = 1; decision <= 55; decision += 1) api.step('history', { action: { type: 'EndTurn' }, decisionSummary: `decision ${decision}`, expectedRevision: decision - 1 });
    const page = api.query('history', { target: 'history', expectedRevision: 55, pageSize: 2, filters: { fromDecision: 53, toDecision: 55 } });
    expect(page).toMatchObject({ count: 2, total: 3, hasMore: true });
    const items = page.items as unknown as Array<{ decision: number; observationBefore: AgentObservation; observationAfter: AgentObservation }>;
    expect(items.map((item) => item.decision)).toEqual([53, 54]);
    expect(items[0]!.observationAfter.turn).toBe(items[0]!.observationBefore.turn + 1);
    expect(items[0]!.observationAfter.map).toEqual(map);
    const final = api.query('history', { target: 'history', expectedRevision: 55, cursor: page.nextCursor!, pageSize: 2, filters: { fromDecision: 53, toDecision: 55 } });
    expect((final.items as unknown as Array<{ decision: number }>).map((item) => item.decision)).toEqual([55]);
    const firstDecisionName = readdirSync(join(path, 'history', 'public', 'decisions')).filter((name) => name.endsWith('.json')).sort()[0]!;
    const firstRecord = JSON.parse(readFileSync(join(path, 'history', 'public', 'decisions', firstDecisionName), 'utf8')) as { publicPayload: { domain: string; chunks: Array<{ hash: string }> } };
    const firstChunk = firstRecord.publicPayload.chunks[0]!.hash;
    writeFileSync(join(path, 'pool', firstRecord.publicPayload.domain, 'chunks', firstChunk.slice(0, 2), `${firstChunk}.gz`), 'corrupt', 'utf8');
    expect(() => api.status('history')).toThrow(/hash mismatch/u);
  }, 60_000);
});

describe.runIf(process.env.NLTH_SESSION_DAILY === '1').sequential('Session Schema 5 daily 1000-decision chain', () => {
  const path = root('daily-1000');
  const api = service(path);
  for (let block = 0; block < 10; block += 1) {
    it(`commits decisions ${block * 100 + 1}-${(block + 1) * 100}`, () => {
      if (block === 0) api.newSession({ sessionId: 'daily', checkpointInterval: 10_000 });
      for (let decision = block * 100 + 1; decision <= (block + 1) * 100; decision += 1) api.step('daily', { action: { type: 'EndTurn' }, decisionSummary: `decision ${decision}`, expectedRevision: decision - 1 });
      expect(api.store.readCurrentHead('daily').active.decision).toBe((block + 1) * 100);
    }, 60_000);
  }
  it('validates the complete chain while retaining one bounded page', () => {
    const page = api.query('daily', { target: 'history', expectedRevision: 1_000, pageSize: 3, filters: { fromDecision: 998, toDecision: 1_000 } });
    expect((page.items as unknown as Array<{ decision: number }>).map((item) => item.decision)).toEqual([998, 999, 1_000]);
  }, 60_000);
});
