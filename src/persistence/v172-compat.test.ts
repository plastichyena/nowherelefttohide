import { gunzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import legacy from '../testing/fixtures/v171-score-compat.json';
import { createTerminalSessionFixture, terminalFixtureAction } from '../testing/v171-session-fixture';
import { GameEngine } from '../core/engine';
import { createCityPopulationSnapshot, synchronizePopulation } from '../core/state';
import { canonicalMapValue } from '../core/map-generation';
import type { GameState } from '../core/types';
import { calculateTerminalScore, type ScoredTerminal } from '../core/terminal-score';
import { AutoSaveStore, checksum, decodeSaveCode, encodeSaveCode, exportSaveJson, importSaveJson,
  DEFAULT_AUTOSAVE_KEY, V171_AUTOSAVE_KEY, type StorageLike } from './save';

function original(code: string): Record<string, any> {
  return JSON.parse(strFromU8(gunzipSync(Buffer.from(code, 'base64url'))));
}
function resign(value: Record<string, any>): string {
  const { checksum: _old, ...payload } = value;
  return JSON.stringify({ ...payload, checksum: checksum(canonicalMapValue(payload)) });
}
function ended(outcome: 'won' | 'lost'): GameState {
  const state = createTerminalSessionFixture('v172-save-test', outcome).createNew({ seed: 42, agentId: 'score-save' }).exportPrivateState() as unknown as GameState;
  const step = GameEngine.fromSnapshot(state).step(terminalFixtureAction(state, outcome));
  expect(step.error).toBeNull(); expect(step.result?.outcome).toBe(outcome);
  return step.state as GameState;
}

describe('v1.7.3 explicit Save boundary', () => {
  it.each(legacy.cases)('validates actual v1.7.1 $name bytes and migrates only metadata and scoring', ({ name, code }) => {
    const before = original(code), untouched = structuredClone(before);
    const result = decodeSaveCode(code);
    expect(result.errors).toEqual([]); expect(result.valid).toBe(true); expect(result.migrated).toBe(true);
    const state = result.state!;
    const { scoreContext, gameVersion, mapDescriptor, config, result: gameResult, ...world } = state;
    const { gameVersion: _oldVersion, mapDescriptor: oldDescriptor, config: oldConfig, result: oldResult, ...oldWorld } = before.state;
    expect(world).toEqual(oldWorld);
    const { terminalScore: _coefficients, version: _version, ...configRules } = config;
    const { version: _oldConfigVersion, ...oldRules } = oldConfig;
    expect(configRules).toEqual(oldRules);
    const { appVersion: _app, configVersion: _cv, build: _build, ...mapIdentity } = mapDescriptor;
    const { appVersion: _oldApp, configVersion: _oldCv, build: _oldBuild, ...oldIdentity } = oldDescriptor;
    expect(mapIdentity).toEqual(oldIdentity);
    expect(gameVersion).toBe('21.0.0'); expect(scoreContext.initialPersonnelTotal).toBe('45');
    if (name.startsWith('ongoing')) {
      expect(gameResult).toBeNull(); expect(state.units.some(u => u.id === 'police-1')).toBe(false);
      expect(calculateTerminalScore(state, 'lost')).toMatchObject({ status: 'scored', initialPersonnel: '40', initialPersonnelTotal: '45' });
    } else {
      const { terminalScore, ...preserved } = gameResult!;
      expect(preserved).toEqual(oldResult);
      expect(terminalScore).toMatchObject({ status: 'unscored', reason: 'legacy_v1.7.1' });
      expect(GameEngine.fromSnapshot(state).step({ type: 'EndTurn' }).error?.code).toBe('game_over');
    }
    expect(importSaveJson(exportSaveJson(state)).state).toEqual(state);
    expect(original(code)).toEqual(untouched);
  });

  it('can score a migrated ongoing game without shrinking its original personnel denominator', () => {
    const state = decodeSaveCode(legacy.cases[0]!.code).state!;
    // Stage civilian evacuation into an already-counted checkpoint pool; next real action triggers defeat.
    for (const f of state.facilities.filter(f => f.owner === 'player')) { state.checkpoints[0]!.waiting += f.workers; f.workers = 0; }
    synchronizePopulation(state); createCityPopulationSnapshot(state);
    const engine = GameEngine.fromSnapshot(state), step = engine.step({ type: 'Wait', unitId: 'police-2' });
    expect(step.error).toBeNull(); expect(step.result?.reason).toBe('healthyCiviliansLost');
    const score = step.result!.terminalScore as ScoredTerminal;
    expect(score.initialPersonnelTotal).toBe('45'); expect(score.initialPersonnel).toBe('40');
    expect(BigInt(score.healthyPopulation)).toBeGreaterThan(40n); expect(BigInt(score.points.total)).toBeLessThan(0n);
    expect(score.comparison.origin).toBe('v1.7.1-ongoing');
  });

  it.each(['won', 'lost'] as const)('round-trips and validates frozen %s values in code/JSON with no rescore on resume', outcome => {
    const state = ended(outcome), code = encodeSaveCode(state);
    for (const loaded of [decodeSaveCode(code), importSaveJson(exportSaveJson(state))]) {
      expect(loaded.errors).toEqual([]); expect(loaded.state).toEqual(state);
      const engine = GameEngine.fromSnapshot(loaded.state!);
      expect(engine.getResult()).toEqual(state.result);
      expect(engine.step({ type: 'EndTurn' }).error?.code).toBe('game_over');
      expect(encodeSaveCode(engine.getState() as GameState)).toBe(code);
    }
  });

  it('rejects current missing/tampered inputs and score, and does not treat them as legacy', () => {
    const state = ended('won'), envelope = JSON.parse(exportSaveJson(state));
    for (const mutate of [
      (v: any) => { delete v.state.scoreContext; },
      (v: any) => { delete v.state.config.terminalScore; },
      (v: any) => { delete v.state.result.terminalScore; },
      (v: any) => { v.state.result.terminalScore.points.total = '0'; },
      (v: any) => { v.state.result.terminalScore.crowding.excess = '999'; },
      (v: any) => { v.state.scoreContext.initialPersonnelTotal = '1'; },
      (v: any) => { v.state.scoreContext.coefficients.wH = 101; },
      (v: any) => { v.state.result.terminalScore.version = 'unknown'; },
    ]) {
      const bad = structuredClone(envelope); mutate(bad);
      const result = importSaveJson(resign(bad));
      expect(result.valid).toBe(false); expect(result.state).toBeNull();
    }
    expect(GameEngine.fromSnapshot(state).getResult()).toEqual(state.result);
  });

  it('rejects v1.7.0, unknown deployment, corrupt v1.7.1 and forged mixed schemas without modifying input', () => {
    const envelope = original(legacy.cases[0]!.code);
    for (const mutate of [
      (v: any) => { v.state.mapDescriptor.appVersion = '1.7.0'; },
      (v: any) => { v.state.map.facilities[0].id = 'unknown-initial-site'; },
      (v: any) => { v.state.rngState.state = -1; },
      (v: any) => { v.state.scoreContext = {}; },
      (v: any) => { v.state.config.terminalScore = { wH: 100, wF: 300, bMax: 50 }; },
    ]) {
      const bad = structuredClone(envelope); mutate(bad); const text = resign(bad);
      expect(importSaveJson(text).valid).toBe(false); expect(resign(bad)).toBe(text);
    }
  });

  it('preserves old autosave bytes; failed writes preserve the last success and the frozen memory result', () => {
    const values = new Map([[V171_AUTOSAVE_KEY, legacy.cases[0]!.code]]);
    let fail = false;
    const storage: StorageLike = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { if (fail) throw new Error('quota'); values.set(k, v); } };
    const store = new AutoSaveStore({ storage });
    const loaded = store.load(); expect(loaded.migrated).toBe(true); expect(values.size).toBe(1);
    expect(store.save(loaded.state!).ok).toBe(true);
    const previous = values.get(DEFAULT_AUTOSAVE_KEY), terminal = ended('lost'), frozen = structuredClone(terminal.result);
    fail = true; expect(store.save(terminal).ok).toBe(false);
    expect(values.get(DEFAULT_AUTOSAVE_KEY)).toBe(previous); expect(terminal.result).toEqual(frozen);
    fail = false; expect(store.save(terminal).ok).toBe(true);
    expect(store.load().state?.result).toEqual(frozen); expect(values.get(V171_AUTOSAVE_KEY)).toBe(legacy.cases[0]!.code);
  });

  it('resumes the same actions with the saved coefficients and deterministic RNG/result', () => {
    const state = decodeSaveCode(legacy.cases[1]!.code).state!;
    const live = GameEngine.fromSnapshot(state), resumed = GameEngine.fromSnapshot(decodeSaveCode(encodeSaveCode(state)).state!);
    for (const action of [{ type: 'Wait', unitId: 'police-2' }, { type: 'EndTurn' }] as const) {
      expect(resumed.step(action)).toEqual(live.step(action));
    }
    expect(resumed.getState().scoreContext).toEqual(state.scoreContext);
  });
});
