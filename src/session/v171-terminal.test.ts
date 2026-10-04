import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentGame } from '../agent/game';
import { GameEngine } from '../core/engine';
import type { GameState } from '../core/types';
import { ReplayPackage, ReplayZip } from '../replay/package';
import { createTerminalSessionFixture, terminalFixtureAction } from '../testing/v171-session-fixture';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';
import { SessionService } from './service';
import { SessionStore } from './store';
import { sha256Json } from './hash';

function fileHashes(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else hashes[relative(root, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  visit(root);
  return hashes;
}

describe('v1.7.1 terminal Session export', () => {
  it.each(['won', 'lost'] as const)('exports a %s Session through a fresh official CLI and preserves real replay and source bytes', async outcome => {
    const root = mkdtempSync(join(tmpdir(), `nlth-v171-${outcome}-`));
    const storeRoot = join(root, 'sessions');
    const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v171-terminal', NLTH_GIT_COMMIT: 'a'.repeat(40) });
    const factory = createTerminalSessionFixture(identity.buildId, outcome);
    const store = new SessionStore(storeRoot);
    const api = new SessionService(store, factory, identity);
    api.newSession({ sessionId: outcome, seed: 1547, mapMode: 'fixed' });
    const initial = store.load(outcome).privateState as unknown as GameState;
    const replayEngine = GameEngine.fromSnapshot(initial);
    const verifyCoreStep = (action: Parameters<GameEngine['step']>[0]) => {
      const priorEvents = replayEngine.getState().events.length;
      const replayed = replayEngine.step(action);
      const saved = store.load(outcome).privateState as unknown as GameState;
      expect(sha256Json(replayed.state)).toBe(sha256Json(saved));
      expect(replayed.events).toEqual(saved.events.slice(priorEvents));
    };
    expect(api.step(outcome, { action: { type: 'Wait', unitId: 'missing' }, expectedRevision: 0 }).accepted).toBe(false);
    verifyCoreStep({ type: 'Wait', unitId: 'missing' });
    expect(api.step(outcome, { action: { type: 'Wait', unitId: 'police-1' }, expectedRevision: 1 }).accepted).toBe(true);
    verifyCoreStep({ type: 'Wait', unitId: 'police-1' });
    const interim = api.exportArtifact(outcome, join(root, 'interim.zip'));
    expect(api.readArtifact(interim.artifactPath).decisionCount).toBe(2);
    const ended = api.step(outcome, { action: terminalFixtureAction(initial, outcome), expectedRevision: 2 });
    expect(ended.accepted).toBe(true);
    expect(ended.gameOver).toBe(true);
    verifyCoreStep(terminalFixtureAction(initial, outcome));
    const terminal = store.load(outcome).privateState as unknown as GameState;
    const publicResult = store.load(outcome).publicState.result;
    expect(terminal.result).toMatchObject({ outcome, reason: outcome === 'won' ? 'stateSecured' : 'capitalLost' });
    const before = fileHashes(storeRoot);
    const output = join(root, 'terminal.zip');
    const cli = spawnSync(process.execPath, ['scripts/run-session.mjs', 'artifact', `--session=${outcome}`,
      `--root=${storeRoot}`, `--out=${output}`], {
      encoding: 'utf8', windowsHide: true, timeout: 90000,
      env: { ...process.env, NLTH_BUILD_ID: identity.buildId, NLTH_GIT_COMMIT: identity.gitCommit },
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ ok: true, command: 'artifact', artifactPath: output });
    expect(fileHashes(storeRoot)).toEqual(before);
    const reader = new SessionService(new SessionStore(storeRoot), createAgentSessionGameFactory(identity.buildId), identity);
    const manifest = reader.readArtifact(output);
    expect(manifest.decisionCount).toBe(3);
    // Artifact statistics are the saved public projection, not private counters.
    expect(api.replayArtifact(output)).toMatchObject({ matched: true, decisionCount: 3, result: publicResult });
    const replay = await new ReplayPackage(new ReplayZip(new Blob([readFileSync(output)]), new AbortController().signal)).open();
    const first = await replay.decision(0);
    expect(first.record.accepted).toBe(false);
    expect(first.after).toEqual(first.before);
    expect((await replay.decision(1)).record.accepted).toBe(true);
    const last = await replay.decision(2);
    expect(last.after.result).toEqual(publicResult);
    expect(last.after.result?.statistics).not.toHaveProperty('rejectedBonusZombiesByDirection');
    expect(last.after.gameOver).toBe(true);
    const restored = createAgentGame({ recordHistory: false });
    expect(restored.restorePrivateSessionState(terminal).gameOver).toBe(true);
    for (const action of [{ type: 'EndTurn' }, { type: 'Move', unitId: 'police-1', destination: { q: 25, r: 25 } },
      { type: 'Attack', attackerId: 'national-guard-1', targetId: 'missing' }] as const) {
      expect(restored.step(action).error?.code).toBe('game_over');
      expect(restored.exportPrivateSessionState()).toEqual(terminal);
      expect(GameEngine.fromSnapshot(terminal).step(action).error?.code).toBe('game_over');
    }
    const bytes = readFileSync(output);
    expect(() => reader.exportArtifact(outcome, output)).toThrow(/overwrite/);
    expect(readFileSync(output)).toEqual(bytes);
    expect(fileHashes(storeRoot)).toEqual(before);
    const invalid = structuredClone(terminal);
    invalid.resources.food = -1;
    expect(() => restored.restorePrivateSessionState(invalid)).toThrow();
    expect(restored.exportPrivateSessionState()).toEqual(terminal);
  }, 120000);
});
