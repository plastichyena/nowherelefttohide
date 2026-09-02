import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentGame } from '../agent/game';
import { cloneJson } from '../agent/action';
import type {
  AgentGameResult,
  AgentObservation,
  AgentPublicRunArtifact,
  AgentStepResult,
} from '../agent/types';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  GAME_RULES_VERSION,
  OBSERVATION_API_VERSION,
} from '../agent/types';
import { DEFAULT_MAP_ID } from '../core/config';
import type { GameAction, JsonValue } from '../core/types';
import { SAVE_FORMAT_VERSION } from '../persistence/save';
import { createAgentSessionGameFactory } from './agent-adapter';
import { executeSessionCommand } from './session-cli';
import { SessionService } from './service';
import { SessionStore } from './store';
import {
  SessionError,
  type SessionGameFactory,
  type SessionGameRuntime,
  type SessionStepInput,
  type SessionVersionIdentity,
} from './types';
import {
  assertSafeIdentifier,
  canonicalJson,
  normalizeDecisionSummary,
  sha256Text,
} from './hash';

function tempRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), `nlth-session-${name}-`));
}

function identity(): SessionVersionIdentity {
  return {
    appVersion: APP_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    saveFormatVersion: SAVE_FORMAT_VERSION,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    agentApiVersion: AGENT_API_VERSION,
    observationApiVersion: OBSERVATION_API_VERSION,
    bridgeApiVersion: BRIDGE_API_VERSION,
    buildId: 'test-build',
    gitCommit: 'a'.repeat(40),
    mapId: DEFAULT_MAP_ID,
  };
}

const realGame = createAgentGame({ buildId: 'test-build' });
const observationTemplate = (() => {
  const value = realGame.reset({ seed: 1, agent: { id: 'fake' } });
  return {
    ...cloneJson(value),
    map: {
      id: value.map.id,
      width: 1,
      height: 1,
      coordinateSystem: value.map.coordinateSystem,
      tiles: [],
      hordeSpawnReserve: [],
    },
    roadBranches: [],
    facilities: [],
    units: [],
    zombies: [],
    checkpoints: [],
    checkpointPositionCandidates: [],
    constructibleFacilityPositionCandidates: [],
  } as AgentObservation;
})();
const artifactTemplate = realGame.getRunArtifact();

interface FakePrivateState extends Record<string, JsonValue> {
  turn: number;
  gameOver: boolean;
  secretRngState: string;
}

class FakeRuntime implements SessionGameRuntime {
  public constructor(
    private state: FakePrivateState,
    private readonly gameOverAt: number,
  ) {}

  public getObservation(): AgentObservation {
    const result = this.getResult();
    return cloneJson({
      ...observationTemplate,
      turn: this.state.turn,
      phase: this.state.gameOver ? 'gameOver' : 'player',
      gameOver: this.state.gameOver,
      result,
    });
  }

  public getLegalActions(): GameAction[] {
    return this.state.gameOver ? [] : [{ type: 'EndTurn' }];
  }

  public step(input: SessionStepInput): AgentStepResult {
    if (input.action.type !== 'EndTurn') {
      return {
        observation: this.getObservation(),
        events: [],
        error: { code: 'action_not_legal', message: 'Only EndTurn is legal in the fake runtime' },
        gameOver: this.state.gameOver,
        result: this.getResult(),
      };
    }
    if (this.state.turn >= this.gameOverAt) this.state.gameOver = true;
    else this.state.turn += 1;
    return {
      observation: this.getObservation(),
      events: [],
      error: null,
      gameOver: this.state.gameOver,
      result: this.getResult(),
    };
  }

  public isGameOver(): boolean {
    return this.state.gameOver;
  }

  public getResult(): AgentGameResult | null {
    return this.state.gameOver
      ? { ...cloneJson(observationTemplate.result), outcome: 'lost', reason: 'capitalLost', turn: this.state.turn } as unknown as AgentGameResult
      : null;
  }

  public getRunArtifact(): AgentPublicRunArtifact {
    return cloneJson({ ...artifactTemplate, result: this.getResult() });
  }

  public exportPrivateState(): JsonValue {
    return cloneJson(this.state);
  }
}

function fakeFactory(gameOverAt = 999): SessionGameFactory {
  return {
    createNew: () => new FakeRuntime({ turn: 1, gameOver: false, secretRngState: 'private-seed' }, gameOverAt),
    restore: ({ privateState }) => new FakeRuntime(cloneJson(privateState) as FakePrivateState, gameOverAt),
  };
}

function service(root: string, gameOverAt = 999, store?: SessionStore): SessionService {
  return new SessionService(store ?? new SessionStore(root), fakeFactory(gameOverAt), identity());
}

function agentService(root: string): SessionService {
  return new SessionService(new SessionStore(root), createAgentSessionGameFactory('test-build'), identity());
}

describe('Session hash and input boundaries', () => {
  it('uses canonical SHA-256 and validates safe identifiers and Unicode summaries', () => {
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe('{"a":{"b":1,"d":2},"z":1}');
    expect(normalizeDecisionSummary('  🧟 defend  ')).toBe('🧟 defend');
    expect(() => normalizeDecisionSummary('')).toThrow(SessionError);
    expect(() => normalizeDecisionSummary('🧟'.repeat(501))).toThrow(SessionError);
    expect(() => assertSafeIdentifier('../escape', 'sessionId')).toThrow(SessionError);
  });
});

describe('AI Portable Session lifecycle', () => {
  it('restores Wave warnings, Spawn Groups, and RNG exactly through real Agent Session Resume and Checkpoint branching', () => {
    const root = tempRoot('real-wave-resume');
    const api = agentService(root);
    api.newSession({ sessionId: 'real-wave-resume', seed: 71, checkpointInterval: 99 });

    api.step('real-wave-resume', { action: { type: 'EndTurn' }, decisionSummary: 'advance to turn two' });
    api.step('real-wave-resume', { action: { type: 'EndTurn' }, decisionSummary: 'start first warning' });
    const warned = api.status('real-wave-resume');
    expect(warned.observation.horde).toMatchObject({
      warningType: 'periodic',
      warningDirections: expect.any(Array),
      nextWaveIndex: 1,
      nextSpawnTurn: 5,
    });
    expect(warned.observation.horde.warningDirections).toHaveLength(1);

    for (let index = 0; index < 4; index += 1) {
      const privateState = api.store.load('real-wave-resume').privateState as unknown as {
        horde: { spawnGroupIdsByWave: Record<string, string[]> };
      };
      if (privateState.horde.spawnGroupIdsByWave['1']) break;
      api.step('real-wave-resume', { action: { type: 'EndTurn' }, decisionSummary: `advance to first Wave ${index}` });
    }
    const beforeCheckpoint = api.store.load('real-wave-resume').privateState as unknown as {
      horde: { warningDirections: string[]; spawnGroupIdsByWave: Record<string, string[]> };
      rngState: unknown;
    };
    expect(beforeCheckpoint.horde.spawnGroupIdsByWave['1']).toHaveLength(1);
    const checkpoint = api.saveCheckpoint('real-wave-resume');

    const resumed = api.status('real-wave-resume');
    const afterResume = api.store.load('real-wave-resume').privateState as unknown as typeof beforeCheckpoint;
    expect(afterResume.horde).toEqual(beforeCheckpoint.horde);
    expect(afterResume.rngState).toEqual(beforeCheckpoint.rngState);
    expect(resumed.observation.horde.warningDirections).toEqual(beforeCheckpoint.horde.warningDirections);

    const child = api.loadCheckpoint('real-wave-resume', checkpoint.checkpointId, 'real-wave-child');
    const childState = api.store.load('real-wave-child').privateState as unknown as typeof beforeCheckpoint;
    expect(childState.horde).toEqual(beforeCheckpoint.horde);
    expect(childState.rngState).toEqual(beforeCheckpoint.rngState);
    expect(child.observation.horde.warningDirections).toEqual(beforeCheckpoint.horde.warningDirections);
  }, 20_000);

  it('round-trips Active state, records rejected Decisions, and leaves malformed input unnumbered', () => {
    const root = tempRoot('roundtrip');
    const api = service(root);
    const created = api.newSession({ sessionId: 'roundtrip', seed: 7 });
    expect(created.active.decision).toBe(0);

    const accepted = api.step('roundtrip', { action: { type: 'EndTurn' }, decisionSummary: 'advance one turn' });
    expect(accepted.accepted).toBe(true);
    expect(accepted.active.decision).toBe(1);
    const rejected = api.step('roundtrip', { action: { type: 'Wait', unitId: 'missing' }, decisionSummary: 'test rejection' });
    expect(rejected.accepted).toBe(false);
    expect(rejected.active.decision).toBe(2);
    const beforeMalformed = api.status('roundtrip');
    expect(() => api.step('roundtrip', { action: { type: 'EndTurn' }, decisionSummary: '   ' })).toThrow(/decisionSummary/u);
    expect(api.status('roundtrip').active).toEqual(beforeMalformed.active);

    const artifact = api.artifact('roundtrip');
    expect(artifact.decisionTrace).toHaveLength(2);
    expect(artifact.decisionTrace[0]!.previousDecisionHash).toBe('0'.repeat(64));
    expect(artifact.decisionTrace[1]!.previousDecisionHash).toBe(artifact.decisionTrace[0]!.decisionHash);
    expect(JSON.stringify(artifact)).not.toContain('secretRngState');
  });

  it('creates periodic, manual, and final checkpoints at stable states', () => {
    const periodicRoot = tempRoot('periodic');
    const periodic = service(periodicRoot);
    periodic.newSession({ sessionId: 'periodic', checkpointInterval: 5 });
    for (let turn = 1; turn <= 5; turn += 1) {
      periodic.step('periodic', { action: { type: 'EndTurn' }, decisionSummary: `finish turn ${turn}` });
    }
    const periodicList = periodic.listCheckpoints('periodic');
    expect(periodicList.map((checkpoint) => checkpoint.checkpointId)).toContain('after-turn-005');
    expect(periodicList.find((checkpoint) => checkpoint.checkpointId === 'after-turn-005')?.currentTurn).toBe(6);
    const manual = periodic.saveCheckpoint('periodic');
    expect(manual.kind).toBe('manual');

    const finalRoot = tempRoot('final');
    const final = service(finalRoot, 1);
    final.newSession({ sessionId: 'final' });
    const result = final.step('final', { action: { type: 'EndTurn' }, decisionSummary: 'finish game' });
    expect(result.gameOver).toBe(true);
    expect(result.checkpointsCreated).toHaveLength(1);
    expect(result.checkpointsCreated[0]!.kind).toBe('final');
  });

  it('branches without rewinding or modifying the parent Session', () => {
    const root = tempRoot('branch');
    const api = service(root);
    api.newSession({ sessionId: 'parent' });
    api.step('parent', { action: { type: 'EndTurn' }, decisionSummary: 'parent first' });
    const checkpoint = api.saveCheckpoint('parent');
    api.step('parent', { action: { type: 'EndTurn' }, decisionSummary: 'parent second' });
    const parentBefore = api.status('parent');

    const child = api.loadCheckpoint('parent', checkpoint.checkpointId, 'child');
    expect(child.session.parentSessionId).toBe('parent');
    expect(child.session.parentCheckpointId).toBe(checkpoint.checkpointId);
    expect(child.active.decision).toBe(1);
    expect(api.status('parent').active).toEqual(parentBefore.active);
    expect(api.artifact('child').decisionTrace).toHaveLength(1);
  });

  it('keeps the prior Active commit across an interrupted update', () => {
    const root = tempRoot('atomic');
    let inject = false;
    const store = new SessionStore(root, (stage) => {
      if (inject && stage === 'after-trace-append') throw new Error('injected crash');
    });
    const api = service(root, 999, store);
    api.newSession({ sessionId: 'atomic' });
    inject = true;
    expect(() => api.step('atomic', { action: { type: 'EndTurn' }, decisionSummary: 'crash me' })).toThrow('injected crash');
    inject = false;
    expect(api.status('atomic').active.decision).toBe(0);
    expect(api.step('atomic', { action: { type: 'EndTurn' }, decisionSummary: 'crash me' }).active.decision).toBe(1);
  });

  it('rejects active corruption without rollback while checkpoint listing and explicit branching remain available', () => {
    const root = tempRoot('corrupt');
    const api = service(root);
    api.newSession({ sessionId: 'corrupt' });
    api.step('corrupt', { action: { type: 'EndTurn' }, decisionSummary: 'checkpoint this' });
    const checkpoint = api.saveCheckpoint('corrupt');
    const loaded = api.store.load('corrupt');
    writeFileSync(join(loaded.directory, loaded.active.privateState.relativePath), '{}\n', 'utf8');

    expect(() => api.status('corrupt')).toThrow(/SHA-256/u);
    expect(api.listCheckpoints('corrupt').map((entry) => entry.checkpointId)).toContain(checkpoint.checkpointId);
    expect(api.loadCheckpoint('corrupt', checkpoint.checkpointId, 'recovered').active.decision).toBe(1);
  });

  it('detects trace, metadata, and Build identity mismatches without changing Active state', () => {
    const traceRoot = tempRoot('trace-tamper');
    const traceApi = service(traceRoot);
    traceApi.newSession({ sessionId: 'trace-tamper' });
    traceApi.step('trace-tamper', { action: { type: 'EndTurn' }, decisionSummary: 'committed trace' });
    const traceLoaded = traceApi.store.load('trace-tamper');
    writeFileSync(join(traceLoaded.directory, 'trace.ndjson'), '{"tampered":true}\n', 'utf8');
    expect(() => traceApi.status('trace-tamper')).toThrow(/trace\.ndjson/u);

    const metadataRoot = tempRoot('metadata-tamper');
    const metadataApi = service(metadataRoot);
    metadataApi.newSession({ sessionId: 'metadata-tamper' });
    const descriptorPath = join(metadataRoot, 'metadata-tamper', 'session.json');
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as Record<string, unknown>;
    descriptor.buildId = 'tampered-build';
    writeFileSync(descriptorPath, JSON.stringify(descriptor), 'utf8');
    expect(() => metadataApi.status('metadata-tamper')).toThrow(/integrity hash/u);

    const versionRoot = tempRoot('build-mismatch');
    const versionApi = service(versionRoot);
    versionApi.newSession({ sessionId: 'build-mismatch' });
    const otherIdentity = { ...identity(), buildId: 'different-build' };
    const incompatible = new SessionService(new SessionStore(versionRoot), fakeFactory(), otherIdentity);
    expect(() => incompatible.status('build-mismatch')).toThrow(/buildId/u);

    const appVersionOnly = new SessionService(
      new SessionStore(versionRoot),
      fakeFactory(),
      { ...identity(), appVersion: '9.9.9' },
    );
    expect(appVersionOnly.status('build-mismatch').session.appVersion).toBe(APP_VERSION);
  });

  it('rejects concurrent locks and recovers only a definitely dead local PID lock', () => {
    const root = tempRoot('lock');
    const store = new SessionStore(root);
    const first = store.acquireLock('locked');
    expect(() => store.acquireLock('locked')).toThrow(/already being updated/u);
    first.release();

    const staleDirectory = store.sessionDirectory('stale');
    mkdirSync(join(staleDirectory, '.active-lock'), { recursive: true });
    writeFileSync(join(staleDirectory, '.active-lock', 'owner.json'), JSON.stringify({
      pid: 2_147_483_647,
      host: hostname(),
      token: 'dead-owner',
      acquiredAt: new Date(0).toISOString(),
    }));
    const recovered = store.acquireLock('stale');
    recovered.release();
  });

  it('keeps all Session Metrics separate from Active game commits', () => {
    const root = tempRoot('metrics');
    const api = service(root);
    const created = api.newSession({ sessionId: 'metrics', checkpointInterval: 5 });
    const resumed = api.status('metrics');
    expect(resumed.active).toEqual(created.active);
    expect(resumed.sessionMetrics.activeSessionResumes).toBe(1);

    try {
      api.step('metrics', { action: { type: 'EndTurn' }, decisionSummary: '' });
    } catch (error) {
      expect((error as SessionError).details).toMatchObject({ sessionMetrics: { inputFormatRejections: 1 } });
    }
    api.step('metrics', { action: { type: 'Wait', unitId: 'missing' }, decisionSummary: 'illegal decision' });
    api.saveCheckpoint('metrics');
    for (let turn = 1; turn <= 5; turn += 1) {
      api.step('metrics', { action: { type: 'EndTurn' }, decisionSummary: `metrics turn ${turn}` });
    }
    const checkpoint = api.saveCheckpoint('metrics');
    api.loadCheckpoint('metrics', checkpoint.checkpointId, 'metrics-child');
    const metrics = api.artifact('metrics').sessionMetrics as Record<string, number>;
    expect(metrics).toMatchObject({
      activeSessionResumes: 1,
      manualCheckpointsCreated: 2,
      periodicCheckpointsCreated: 1,
      branchedSessionsCreated: 1,
      invalidDecisions: 1,
      inputFormatRejections: 1,
    });

    const finalRoot = tempRoot('metrics-final');
    const final = service(finalRoot, 1);
    final.newSession({ sessionId: 'metrics-final' });
    final.step('metrics-final', { action: { type: 'EndTurn' }, decisionSummary: 'final' });
    expect(final.artifact('metrics-final').sessionMetrics).toMatchObject({ finalCheckpointsCreated: 1 });
  });

  it('diagnoses hash, version, Build, and non-hash corruption rejections', () => {
    const hashRoot = tempRoot('metric-hash');
    const hashApi = service(hashRoot);
    hashApi.newSession({ sessionId: 'metric-hash' });
    const hashLoaded = hashApi.store.load('metric-hash');
    writeFileSync(join(hashLoaded.directory, hashLoaded.active.privateState.relativePath), '{}\n', 'utf8');
    try {
      hashApi.status('metric-hash');
    } catch (error) {
      expect((error as SessionError).details).toMatchObject({ sessionMetrics: { hashRejections: 1 } });
    }

    const versionRoot = tempRoot('metric-version');
    const versionApi = service(versionRoot);
    versionApi.newSession({ sessionId: 'metric-version' });
    const wrongVersion = new SessionService(
      new SessionStore(versionRoot),
      fakeFactory(),
      { ...identity(), gameRulesVersion: '9.9.9' },
    );
    try {
      wrongVersion.status('metric-version');
    } catch (error) {
      expect((error as SessionError).details).toMatchObject({ sessionMetrics: { versionRejections: 1 } });
    }

    const buildRoot = tempRoot('metric-build');
    const buildApi = service(buildRoot);
    buildApi.newSession({ sessionId: 'metric-build' });
    const wrongBuild = new SessionService(
      new SessionStore(buildRoot),
      fakeFactory(),
      { ...identity(), buildId: 'wrong-build' },
    );
    try {
      wrongBuild.status('metric-build');
    } catch (error) {
      expect((error as SessionError).details).toMatchObject({ sessionMetrics: { buildRejections: 1 } });
    }

    const corruptRoot = tempRoot('metric-corrupt');
    const corruptApi = service(corruptRoot);
    corruptApi.newSession({ sessionId: 'metric-corrupt' });
    const commits = join(corruptRoot, 'metric-corrupt', 'commits');
    const commitName = readdirSync(commits).find((name) => name.endsWith('.json'))!;
    writeFileSync(join(commits, commitName), '{broken json', 'utf8');
    try {
      corruptApi.status('metric-corrupt');
    } catch (error) {
      expect((error as SessionError).details).toMatchObject({ sessionMetrics: { corruptionRejections: 1 } });
    }
  });
});

describe('Session JSON CLI', () => {
  it('supports all seven formal commands with file/stdin-style JSON input', () => {
    const root = tempRoot('cli');
    let stdin = '';
    const dependencies = {
      createService: (requestedRoot: string) => service(requestedRoot),
      readStdin: () => stdin,
    };
    const common = `--root=${root}`;
    const created = executeSessionCommand(['new', common, '--session-id=cli-session'], dependencies);
    expect(created.ok).toBe(true);
    expect(executeSessionCommand(['status', common, '--session=cli-session'], dependencies).command).toBe('status');
    stdin = '{broken json';
    try {
      executeSessionCommand(['step', common, '--session=cli-session'], dependencies);
    } catch (error) {
      expect((error as SessionError).details).toMatchObject({ sessionMetrics: { inputFormatRejections: 1 } });
    }
    stdin = JSON.stringify({ action: { type: 'EndTurn' }, decisionSummary: 'CLI step' });
    expect(executeSessionCommand(['step', common, '--session=cli-session'], dependencies).command).toBe('step');
    const saved = executeSessionCommand(['save-checkpoint', common, '--session=cli-session'], dependencies);
    const checkpointId = (saved.checkpoint as { checkpointId: string }).checkpointId;
    expect(executeSessionCommand(['list-checkpoints', common, '--session=cli-session'], dependencies).command).toBe('list-checkpoints');
    expect(executeSessionCommand([
      'load-checkpoint', common, '--session=cli-session', `--checkpoint=${checkpointId}`, '--new-session-id=cli-child',
    ], dependencies).command).toBe('load-checkpoint');
    const artifact = executeSessionCommand(['artifact', common, '--session=cli-child'], dependencies);
    expect(artifact.command).toBe('artifact');
    expect(JSON.stringify(artifact)).not.toContain('secretRngState');
    expect(resolve(root)).toBe(root);
  });
});
