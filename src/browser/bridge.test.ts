import { afterEach, describe, expect, it } from 'vitest';
import { createAgentGame } from '../agent/game';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, BRIDGE_API_VERSION, OBSERVATION_API_VERSION } from '../agent/types';
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
    expect(info.appVersion).toBe(APP_VERSION);
    expect(info.artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(info.bridgeApiVersion).toBe(BRIDGE_API_VERSION);
    expect(info.observationApiVersion).toBe(OBSERVATION_API_VERSION);
    expect(info.recommendedCallOrder[0]).toBe('getApiInfo');
    expect(info.methodSchemas.step.returns).toBe('AgentStepResult');
    expect(info.prohibited.join(' ')).toContain('localStorage');
    expect(info.minimalExample).toContain('window.NLTH');
    expect(info.rules.recovery).toMatchObject({ combatRate: 0.1, restRate: 0.2 });
    expect(info.rules.infection.stationedUnitsContainSpread).toBe(true);
    expect(info.rules.checkpointPositionCandidates).toMatchObject({
      observationField: 'checkpointPositionCandidates',
      fairPlay: { hiddenEnemiesBlock: false, blockerUnitIdsPublic: false },
    });

    const adapterInfo = createAgentGame({ buildId: 'test-build', bridgeApiVersion: BRIDGE_API_VERSION }).getApiInfo();
    expect(info).toEqual(adapterInfo);

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
    observation.checkpointPositionCandidates[0]!.reasonCode = 'mutated';
    expect(api.getObservation().resources.food).not.toBe(-999);
    expect(api.getObservation().map.tiles[0].q).not.toBe(999);
    expect(api.getObservation().facilities[0].healthyPopulation).not.toBe(-999);
    expect(api.getObservation().checkpointPositionCandidates[0]!.reasonCode).not.toBe('mutated');

    const legal = api.getLegalActions();
    const originalFirst = JSON.stringify(legal[0]);
    legal.pop();
    if (legal[0] && 'type' in legal[0]) legal[0].type = 'EndTurn';
    expect(JSON.stringify(api.getLegalActions()[0])).toBe(originalFirst);

    const artifact = api.getRunArtifact();
    expect(artifact.artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(artifact.initialRoadArrivalSchedule).toHaveLength(4);
    expect(artifact.fixedMap?.id).toBe(artifact.mapId);
    expect(artifact.observationTrace).toHaveLength(1);
    expect(artifact.observationTrace![0]!.checkpointPositionCandidates).toEqual(api.getObservation().checkpointPositionCandidates);
    expect(artifact.observationTrace![0]).not.toHaveProperty('map');
    expect(artifact.observationTrace![0]!.visibleTileKeys.length).toBeGreaterThan(0);
    expect(artifact.metrics).toBeDefined();
    for (const hiddenNoiseMetric of [
      'normalZombiesNoiseTargeted',
      'noiseTargetsReached',
      'noiseTargetsOverriddenByHorde',
      'noiseTargetsOverriddenByVisiblePopulation',
    ]) expect(artifact.metrics).not.toHaveProperty(hiddenNoiseMetric);
    expect(artifact.config.noise).toEqual({ publicClass: { police: 'medium', nationalGuard: 'medium' } });
    expect(artifact.metrics!.config.noise).toEqual({ publicClass: { police: 'medium', nationalGuard: 'medium' } });
    const encodedArtifact = JSON.stringify(artifact);
    expect(encodedArtifact).not.toContain('"police":4');
    expect(encodedArtifact).not.toContain('"nationalGuard":5');
    expect(encodedArtifact).not.toContain('"artifactType"');
    expect('verificationEvents' in artifact).toBe(false);
    artifact.config.finalHordeTurn = 1;
    artifact.acceptedActions.push({ type: 'EndTurn' });
    expect(api.getRunArtifact().config.finalHordeTurn).not.toBe(1);
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

    const retired = api.step({ type: 'SuppressInfection', unitId: 'police-1', facilityId: 'capital' } as never);
    expect(retired.error?.code).toBe('invalid_action_input');
    expect(api.getObservation()).toEqual(before);

    const artifact = api.getRunArtifact();
    expect(artifact.invalidAttempts).toHaveLength(3);
    expect(artifact.invalidAttempts.map((attempt) => attempt.decision)).toEqual([1, 2, 3]);
    expect(artifact.invalidAttempts[0].error.code).toBe('invalid_action_input');

    const malformedRelocate = api.step({
      type: 'RelocateCheckpoint',
      checkpointId: 'checkpoint-north-1',
      position: { q: 0, r: 7 },
      extra: true,
    } as never);
    expect(malformedRelocate.error?.code).toBe('invalid_action_input');
    expect(api.getObservation()).toEqual(before);
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

  it('rejects a checkpoint action whose branch does not match its position', () => {
    const api = bridge();
    api.reset({ seed: 23, configOverrides: { economy: { initialZombieCount: 0 } } });
    const before = api.getObservation();
    const legalBuild = api.getLegalActions().find((action) => action.type === 'BuildCheckpoint');
    expect(legalBuild).toBeDefined();
    const wrongBranch = before.roadBranches.find((branch) => branch.branchId !== legalBuild!.branchId)!.branchId;
    const result = api.step({ ...legalBuild!, branchId: wrongBranch });
    expect(result.error?.code).toBe('invalid_checkpoint_branch');
    expect(api.getObservation()).toEqual(before);
    expect(api.getRunArtifact().acceptedActions).toHaveLength(0);
  });

  it('exposes distinct legal BuildCheckpoint and RelocateCheckpoint actions', () => {
    const api = bridge();
    api.reset({ seed: 23, configOverrides: { economy: { initialZombieCount: 0 } } });
    const build = api.getLegalActions().find((action) => action.type === 'BuildCheckpoint');
    expect(build).toBeDefined();
    const built = api.step(build!);
    expect(built.error).toBeNull();
    const endTurn = api.getLegalActions().find((action) => action.type === 'EndTurn');
    expect(endTurn).toBeDefined();
    const ended = api.step(endTurn!);
    expect(ended.error).toBeNull();
    const relocate = api.getLegalActions().find((action) => action.type === 'RelocateCheckpoint');
    expect(relocate).toBeDefined();
    expect(relocate).toMatchObject({ type: 'RelocateCheckpoint' });
    expect(relocate).not.toHaveProperty('state');
  });

  it('accepts a well-formed legal SetPowerSupply action through the public boundary', () => {
    const api = bridge();
    api.reset({ seed: 127, configOverrides: { economy: { initialZombieCount: 0 } } });
    const action = api.getLegalActions().find(
      (candidate) => candidate.type === 'SetPowerSupply' && candidate.facilityId === 'farm-1',
    );
    expect(action).toEqual({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: false });
    const result = api.step(action!);
    expect(result.error).toBeNull();
    expect(result.observation.facilities.find((facility) => facility.id === 'farm-1')?.production.powerSupplyEnabled).toBe(false);
  });

  it('accepts BuildConstructibleFacility through the same validated public boundary', () => {
    const api = bridge();
    api.reset({ seed: 127, configOverrides: { economy: { initialZombieCount: 0 } } });
    const action = api.getLegalActions().find((candidate) => candidate.type === 'BuildConstructibleFacility');
    expect(action).toBeDefined();
    const result = api.step(action!);
    expect(result.error).toBeNull();
    expect(result.observation.facilities.some((facility) => facility.constructible)).toBe(true);
    expect(result.observation.facilities.find((facility) => facility.constructible)?.operationalStatus).toBe('building');
  });
});
