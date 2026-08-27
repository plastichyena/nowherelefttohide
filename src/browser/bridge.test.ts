import { afterEach, describe, expect, it } from 'vitest';
import { createAgentGame } from '../agent/game';
import { createBrowserBridge, installBrowserBridge, type BrowserBridgeApi } from './bridge';

const PUBLIC_METHODS = [
  'getApiInfo',
  'reset',
  'getObservation',
  'getLegalActions',
  'step',
  'isGameOver',
  'getResult',
  'getRunArtifact',
];

const previousWindow = (globalThis as { window?: unknown }).window;
const previousStorage = (globalThis as { localStorage?: unknown }).localStorage;

afterEach(() => {
  if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = previousWindow;
  if (previousStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage?: unknown }).localStorage = previousStorage;
});

function makeWindow(): Window {
  const target = {} as Window;
  (globalThis as { window?: unknown }).window = target;
  return target;
}

function bridge(): BrowserBridgeApi {
  return createBrowserBridge({ buildId: 'test-build' });
}

describe('Developer / Browser Bridge', () => {
  it('publishes exactly the documented API and self-description', () => {
    const api = bridge();
    expect(Object.keys(api)).toEqual(PUBLIC_METHODS);
    expect(Object.isFrozen(api)).toBe(true);
    expect((api as unknown as Record<string, unknown>).getState).toBeUndefined();
    expect((api as unknown as Record<string, unknown>).LoadSnapshot).toBeUndefined();

    const info = api.getApiInfo();
    expect(info.methods).toEqual(PUBLIC_METHODS);
    expect(info.bridgeApiVersion).toBe('1.0.0');
    expect(info.observationApiVersion).toBe('1.0.0');
    expect(info.recommendedCallOrder[0]).toBe('getApiInfo');
    expect(info.methodSchemas.step.returns).toBe('AgentStepResult');
    expect(info.prohibited.join(' ')).toContain('localStorage');
    expect(info.minimalExample).toContain('window.NLTH');

    // Self-description is also returned as a copy.
    info.methods.pop();
    expect(api.getApiInfo().methods).toEqual(PUBLIC_METHODS);
  });

  it('installs a single global with no persistence access', () => {
    const target = makeWindow();
    let storageReads = 0;
    const storage = {
      getItem: () => { storageReads += 1; return null; },
      setItem: () => { storageReads += 1; },
      removeItem: () => { storageReads += 1; },
      clear: () => { storageReads += 1; },
      key: () => null,
      length: 0,
    } as unknown as Storage;
    (globalThis as { localStorage?: unknown }).localStorage = storage;

    const api = installBrowserBridge({ buildId: 'test-build' });
    expect(target.NLTH).toBe(api);
    expect(storageReads).toBe(0);
    expect(Object.keys(target.NLTH)).toEqual(PUBLIC_METHODS);
  });

  it('keeps returned observations, actions, and artifacts detached from the session', () => {
    const api = bridge();
    const observation = api.reset({ seed: 41, agent: { id: 'clone-test' } });
    observation.resources.food = -999;
    observation.map.tiles[0].q = 999;
    observation.facilities[0].healthyPopulation = -999;
    expect(api.getObservation().resources.food).not.toBe(-999);
    expect(api.getObservation().map.tiles[0].q).not.toBe(999);
    expect(api.getObservation().facilities[0].healthyPopulation).not.toBe(-999);

    const legal = api.getLegalActions();
    const originalFirst = JSON.stringify(legal[0]);
    legal.pop();
    if (legal[0] && 'type' in legal[0]) legal[0].type = 'EndTurn';
    expect(JSON.stringify(api.getLegalActions()[0])).toBe(originalFirst);

    const artifact = api.getRunArtifact();
    artifact.config.maxTurns = 1;
    artifact.acceptedActions.push({ type: 'EndTurn' });
    expect(api.getRunArtifact().config.maxTurns).not.toBe(1);
    expect(api.getRunArtifact().acceptedActions.length).toBe(0);
  });

  it('does not share the normal UI/headless session', () => {
    const api = bridge();
    const uiSession = createAgentGame({ buildId: 'ui-session' });
    const before = api.getObservation();
    const uiTurn = uiSession.getObservation().turn;
    const uiEndTurn = uiSession.getLegalActions().find((action) => action.type === 'EndTurn');
    expect(uiEndTurn).toBeDefined();
    uiSession.step(uiEndTurn!);
    expect(uiSession.getObservation().turn).not.toBe(uiTurn);
    expect(api.getObservation().turn).toBe(before.turn);
    expect(api.getObservation().phase).toBe(before.phase);
  });

  it('rejects malformed and unsupported actions without changing state and records attempts', () => {
    const api = bridge();
    api.reset({ seed: 17, agent: { id: 'validation-test' } });
    const before = api.getObservation();

    const malformed = api.step({ type: 'EndTurn', extra: 'not-allowed' } as never);
    expect(malformed.error?.code).toBe('invalid_action_input');
    expect(api.getObservation()).toEqual(before);

    const unsupported = api.step({ type: 'LoadSnapshot', snapshot: {} } as never);
    expect(unsupported.error?.code).toBe('invalid_action_input');
    expect(api.getObservation()).toEqual(before);

    const artifact = api.getRunArtifact();
    expect(artifact.invalidAttempts).toHaveLength(2);
    expect(artifact.invalidAttempts.map((attempt) => attempt.decision)).toEqual([1, 2]);
    expect(artifact.invalidAttempts[0].error.code).toBe('invalid_action_input');
  });

  it('returns a reason and preserves state for a well-formed but illegal action', () => {
    const api = bridge();
    api.reset({ seed: 19 });
    const before = api.getObservation();
    const result = api.step({ type: 'Wait', unitId: 'missing-unit' });
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('action_not_legal');
    expect(api.getObservation()).toEqual(before);
    expect(api.getRunArtifact().invalidAttempts).toHaveLength(1);
    expect(api.getRunArtifact().invalidAttempts[0].action).toEqual({ type: 'Wait', unitId: 'missing-unit' });
  });
});

