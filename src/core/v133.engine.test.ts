import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { deriveCheckpointRole, isHexSupplied } from './supply';
import { createUnit, synchronizePopulation } from './state';
import { GameEngine } from './engine';
import type {
  BuildCheckpointAction,
  CheckpointState,
  GameAction,
  GameConfig,
  GameState,
  HexCoord,
  RoadBranchState,
  UnitState,
} from './types';

/** Keep v1.3.3 scenarios deterministic and independent of normal economy noise. */
function safeConfig(overrides: Parameters<typeof createDefaultConfig>[0] = {}): GameConfig {
  return createDefaultConfig({
    finalHordeTurn: 100,
    horde: { cycle: 100 },
    economy: {
      initialZombieCount: 0,
      initialResources: {
        food: 100_000,
        civilianGoods: 100_000,
        militaryGoods: 100_000,
        fuel: 100_000,
      },
    },
    refugees: {
      arrivalIntervalMin: 99,
      arrivalIntervalMax: 99,
      arrivalPeopleMin: 1,
      arrivalPeopleMax: 1,
    },
    units: {
      zombie: { movement: 0, attack: 0, vision: 0 },
      hordeZombie: { movement: 0, attack: 0, vision: 0 },
    },
    ...overrides,
  });
}

function cloneState(state: Readonly<GameState>): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function action(value: GameAction): GameAction {
  return value;
}

function stepOk(engine: GameEngine, gameAction: GameAction): ReturnType<GameEngine['step']> {
  const result = engine.step(action(gameAction));
  expect(
    result.error,
    `${gameAction.type} should be accepted (${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''})`,
  ).toBeNull();
  return result;
}

function endTurn(engine: GameEngine): ReturnType<GameEngine['step']> {
  const result = stepOk(engine, { type: 'EndTurn' });
  expect(result.gameOver).toBe(false);
  return result;
}

function branch(state: Readonly<GameState>, branchId = 'east'): RoadBranchState {
  const found = state.roadBranches.find((candidate) => candidate.branchId === branchId);
  if (!found) throw new Error(`Missing branch ${branchId}`);
  return found;
}

function checkpointAt(state: Readonly<GameState>, position: HexCoord): CheckpointState {
  const found = state.checkpoints.find(
    (checkpoint) => checkpoint.position.q === position.q && checkpoint.position.r === position.r,
  );
  if (!found) throw new Error(`Missing checkpoint at ${position.q},${position.r}`);
  return found;
}

function checkpointRole(state: Readonly<GameState>, position: HexCoord): string {
  return deriveCheckpointRole(state, checkpointAt(state, position));
}

function buildCheckpoint(engine: GameEngine, position: HexCoord): CheckpointState {
  const build: BuildCheckpointAction = { type: 'BuildCheckpoint', branchId: 'east', position };
  const result = stepOk(engine, build);
  return checkpointAt(result.state, position);
}

/** Build one active and one or two rear posts, advancing the turn between branch actions. */
function prepareEastBranch(engine: GameEngine, positions: readonly HexCoord[]): CheckpointState[] {
  const checkpoints: CheckpointState[] = [];
  positions.forEach((position, index) => {
    checkpoints.push(buildCheckpoint(engine, position));
    if (index < positions.length - 1) endTurn(engine);
  });
  return checkpoints;
}

function resetHuman(unit: UnitState): void {
  unit.actionState = 'ready';
  unit.canMove = true;
  unit.canAttack = true;
  unit.activity = { moved: false, attacked: false, intercepted: false, suppressed: false };
}

function addZombie(state: GameState, id: string, position: HexCoord, type: 'zombie' | 'hordeZombie' = 'zombie'): UnitState {
  const zombie = createUnit(state, id, type, position);
  zombie.movement = 0;
  zombie.attack = 0;
  zombie.vision = 0;
  if (type === 'hordeZombie') {
    zombie.spawnGroupId = 'periodic-v133-test';
    zombie.hordeKind = 'periodic';
  }
  state.units.push(zombie);
  return zombie;
}

function putCheckpointPeople(state: GameState, checkpoint: CheckpointState, people = 1): void {
  const capital = state.facilities.find((facility) => facility.type === 'capital');
  if (!capital || capital.workers < people) throw new Error('Capital lacks scenario population');
  capital.workers -= people;
  checkpoint.waiting += people;
  synchronizePopulation(state);
}

/** Make an active checkpoint fail through the normal zombie-infection path. */
function overrunActiveCheckpoint(engine: GameEngine, position: HexCoord): ReturnType<GameEngine['step']> {
  const setup = cloneState(engine.getState());
  const checkpoint = checkpointAt(setup, position);
  putCheckpointPeople(setup, checkpoint, 1);
  setup.units = setup.units.filter((unit) => unit.isPlayerUnit);
  const overrunZombie = addZombie(setup, 'zombie-overrun', position);
  overrunZombie.attack = 1;
  synchronizePopulation(setup);
  stepOk(engine, { type: 'LoadSnapshot', snapshot: setup });
  return endTurn(engine);
}

function makeNoiseScenario(
  unitType: 'police' | 'nationalGuard',
  receiverPosition: HexCoord,
  receiverVision = 0,
): { engine: GameEngine; human: UnitState; receiver: UnitState; target: UnitState; center: HexCoord } {
  const config = safeConfig({
    units: {
      police: { vision: 2 },
      nationalGuard: { vision: 2 },
      zombie: { movement: 0, attack: 0, vision: 0 },
      hordeZombie: { movement: 0, attack: 0, vision: 0 },
    },
  });
  const engine = new GameEngine(700, config);
  const state = cloneState(engine.getState());
  const center: HexCoord = { q: 7, r: 7 };
  const human = state.units.find((unit) => unit.type === unitType)!;
  const otherHuman = state.units.find((unit) => unit.id !== human.id && unit.isPlayerUnit)!;
  human.position = { ...center };
  human.vision = 2;
  resetHuman(human);
  otherHuman.position = { q: 0, r: 0 };
  otherHuman.vision = 0;
  resetHuman(otherHuman);
  const target = addZombie(state, 'zombie-combat-target', { q: 8, r: 7 });
  target.hp = 1;
  const receiver = addZombie(state, 'zombie-noise-receiver', receiverPosition);
  receiver.vision = receiverVision;
  synchronizePopulation(state);
  stepOk(engine, { type: 'LoadSnapshot', snapshot: state });
  return {
    engine,
    human,
    receiver,
    target,
    center,
  };
}

describe('v1.3.3 Checkpoint Role / Fallback / Supply', () => {
  it('builds a rear Standby directly, keeps Active, and exposes Build and Relocate candidates together', () => {
    const engine = new GameEngine(501, safeConfig());
    const active = buildCheckpoint(engine, { q: 14, r: 7 });
    endTurn(engine);

    const candidates = engine.getCheckpointPositionCandidates().filter(
      (candidate) => candidate.branchId === 'east' && candidate.position.q === 12 && candidate.position.r === 7,
    );
    expect(candidates.map((candidate) => candidate.actionType)).toEqual(
      expect.arrayContaining(['BuildCheckpoint', 'RelocateCheckpoint']),
    );

    const before = engine.getState();
    const rear = buildCheckpoint(engine, { q: 12, r: 7 });
    const after = engine.getState();
    expect(after.resources.civilianGoods).toBe(
      before.resources.civilianGoods - after.config.checkpoint.constructionCivilianGoods,
    );
    expect(after.actionsTakenThisTurn).toBe(1);
    expect(branch(after).activeCheckpointId).toBe(active.id);
    expect(branch(after).standbyCheckpointIds).toContain(rear.id);
    expect(checkpointRole(after, { q: 14, r: 7 })).toBe('active');
    expect(checkpointRole(after, { q: 12, r: 7 })).toBe('standby');
    expect(after.statistics.standbyCheckpointsCreated).toBeGreaterThanOrEqual(1);
    expect(engine.getCheckpointPositionCandidates()
      .filter((candidate) => candidate.branchId === 'east' && candidate.position.q === 12 && candidate.position.r === 7)
      .map((candidate) => candidate.actionType))
      .toEqual(['BuildCheckpoint', 'RelocateCheckpoint', 'ActivateCheckpoint']);
  });

  it('blocks only visible zombies at a Standby destination and keeps hidden candidates legal', () => {
    for (const visible of [true, false]) {
      const config = safeConfig({
        checkpoint: { initialSupplyRadius: 0 },
        vision: { operationalCheckpoint: 0 },
        units: {
          police: { vision: visible ? 4 : 0 },
          nationalGuard: { vision: 0 },
        },
      });
      const engine = new GameEngine(502, config);
      buildCheckpoint(engine, { q: 14, r: 7 });
      endTurn(engine);
      const state = cloneState(engine.getState());
      const police = state.units.find((unit) => unit.type === 'police')!;
      police.position = { q: 9, r: 7 };
      police.vision = visible ? 4 : 0;
      const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
      guard.position = { q: 0, r: 0 };
      guard.vision = 0;
      addZombie(state, `zombie-${visible ? 'visible' : 'hidden'}-post`, { q: 12, r: 7 });
      synchronizePopulation(state);
      stepOk(engine, { type: 'LoadSnapshot', snapshot: state });

      const candidate = engine.getCheckpointPositionCandidates().find(
        (entry) => entry.actionType === 'BuildCheckpoint' && entry.position.q === 12 && entry.position.r === 7,
      );
      expect(candidate).toBeDefined();
      expect(candidate?.legal).toBe(!visible);
      expect(candidate?.reasonCode).toBe(visible ? 'checkpoint_supply_zombie_blocked' : null);
      if (!visible) {
        expect(engine.getLegalActions()).toContainEqual({
          type: 'BuildCheckpoint',
          branchId: 'east',
          position: { q: 12, r: 7 },
        });
      }
    }
  });

  it('enforces the Active plus Standby prepared-post limit without removing physical posts', () => {
    const engine = new GameEngine(503, safeConfig());
    prepareEastBranch(engine, [{ q: 14, r: 7 }, { q: 13, r: 7 }, { q: 12, r: 7 }]);
    const before = engine.getState();
    const rejected = engine.step({ type: 'BuildCheckpoint', branchId: 'east', position: { q: 10, r: 7 } });
    expect(rejected.error?.code).toBe('checkpoint_prepared_post_limit_reached');
    expect(engine.getState().checkpoints.map((checkpoint) => checkpoint.id)).toEqual(
      before.checkpoints.map((checkpoint) => checkpoint.id),
    );
    expect(engine.getState().statistics.checkpointsRemoved).toBe(before.statistics.checkpointsRemoved);
  });

  it('activates a Standby atomically, consumes only action budgets, and preserves branch Policy', () => {
    const engine = new GameEngine(504, safeConfig());
    const [active, standby] = prepareEastBranch(engine, [{ q: 14, r: 7 }, { q: 12, r: 7 }]);
    const policy = stepOk(engine, { type: 'SetCheckpointPolicy', branchId: 'east', policy: 'strict' });
    expect(policy.state.resources.civilianGoods).toBe(engine.getState().resources.civilianGoods);
    expect(branch(policy.state).currentPolicy).toBe('strict');
    endTurn(engine);

    const before = engine.getState();
    const result = stepOk(engine, {
      type: 'ActivateCheckpoint',
      branchId: 'east',
      checkpointId: standby.id,
    });
    expect(result.state.resources.civilianGoods).toBe(before.resources.civilianGoods);
    expect(result.state.actionsTakenThisTurn).toBe(1);
    expect(branch(result.state).activeCheckpointId).toBe(standby.id);
    expect(branch(result.state).standbyCheckpointIds).toContain(active.id);
    expect(branch(result.state).currentPolicy).toBe('strict');
    expect(checkpointRole(result.state, { q: 12, r: 7 })).toBe('active');
    expect(checkpointRole(result.state, { q: 14, r: 7 })).toBe('standby');
    expect(result.state.statistics.checkpointActivations).toBe(1);
  });

  it('rejects branch Policy changes while a branch has no Active, without resetting the remembered value', () => {
    const engine = new GameEngine(505, safeConfig());
    const before = engine.getState();
    const rejected = engine.step({ type: 'SetCheckpointPolicy', branchId: 'north', policy: 'strict' });
    expect(rejected.error).not.toBeNull();
    expect(engine.getState()).toEqual(before);
    expect(branch(engine.getState(), 'north').currentPolicy).toBe('normal');
  });

  it('falls back to the frontmost Standby, then to Dormant, immediately on Active loss', () => {
    const config = safeConfig();
    const source = new GameEngine(506, config);
    prepareEastBranch(source, [{ q: 14, r: 7 }, { q: 13, r: 7 }, { q: 12, r: 7 }]);
    const prepared = source.getState();

    const standbyEngine = new GameEngine(506, config);
    stepOk(standbyEngine, { type: 'LoadSnapshot', snapshot: prepared });
    const standbyLoss = overrunActiveCheckpoint(standbyEngine, { q: 14, r: 7 });
    expect(branch(standbyLoss.state).activeCheckpointId).toBe(checkpointAt(standbyLoss.state, { q: 13, r: 7 }).id);
    expect(checkpointRole(standbyLoss.state, { q: 12, r: 7 })).toBe('standby');
    expect(standbyLoss.state.statistics.checkpointFallbacksFromStandby).toBe(1);
    expect(isHexSupplied(prepared, { q: 14, r: 7 })).toBe(true);
    expect(isHexSupplied(standbyLoss.state, { q: 14, r: 7 })).toBe(false);
    expect(isHexSupplied(standbyLoss.state, { q: 7, r: 7 })).toBe(true);

    const dormantSnapshot = cloneState(prepared);
    const dormantBranch = branch(dormantSnapshot);
    dormantBranch.standbyCheckpointIds = [];
    synchronizePopulation(dormantSnapshot);
    const dormantEngine = new GameEngine(507, config);
    stepOk(dormantEngine, { type: 'LoadSnapshot', snapshot: dormantSnapshot });
    const dormantLoss = overrunActiveCheckpoint(dormantEngine, { q: 14, r: 7 });
    expect(branch(dormantLoss.state).activeCheckpointId).toBe(checkpointAt(dormantLoss.state, { q: 13, r: 7 }).id);
    expect(dormantLoss.state.statistics.checkpointFallbacksFromDormant).toBe(1);
  });

  it('resolves fallback before the next refugee arrival and sends new arrivals to the replacement Active', () => {
    const config = safeConfig();
    const engine = new GameEngine(508, config);
    prepareEastBranch(engine, [{ q: 14, r: 7 }, { q: 13, r: 7 }]);
    const failed = overrunActiveCheckpoint(engine, { q: 14, r: 7 });
    const afterFallback = cloneState(failed.state);
    const replacement = branch(afterFallback).activeCheckpointId!;
    const oldZombies = afterFallback.units.filter((unit) => unit.type === 'zombie' || unit.type === 'hordeZombie');
    afterFallback.units = afterFallback.units.filter((unit) => unit.isPlayerUnit);
    const east = branch(afterFallback);
    east.nextArrivalTurn = afterFallback.turn;
    synchronizePopulation(afterFallback);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: afterFallback });
    const before = engine.getState();
    const arrived = endTurn(engine);
    const active = arrived.state.checkpoints.find((checkpoint) => checkpoint.id === replacement)!;
    expect(active.waiting + active.screening + active.approved).toBeGreaterThan(0);
    expect(arrived.state.statistics.unmanagedPassThrough).toBe(before.statistics.unmanagedPassThrough);
    expect(oldZombies.length).toBeGreaterThan(0);
  });

  it('keeps a Relocation Remnant with people, then returns an empty safe Remnant as Standby', () => {
    const engine = new GameEngine(509, safeConfig());
    const active = buildCheckpoint(engine, { q: 14, r: 7 });
    endTurn(engine);
    const setup = cloneState(engine.getState());
    const old = checkpointAt(setup, { q: 14, r: 7 });
    putCheckpointPeople(setup, old, 1);
    synchronizePopulation(setup);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: setup });
    const relocated = stepOk(engine, {
      type: 'RelocateCheckpoint',
      checkpointId: active.id,
      branchId: 'east',
      position: { q: 12, r: 7 },
    });
    const remnant = checkpointAt(relocated.state, { q: 14, r: 7 });
    expect(remnant.status).toBe('remnant');
    expect(remnant.waiting).toBe(1);
    expect(branch(relocated.state).activeCheckpointId).toBe(checkpointAt(relocated.state, { q: 12, r: 7 }).id);

    const empty = cloneState(relocated.state);
    const emptyRemnant = checkpointAt(empty, { q: 14, r: 7 });
    const capital = empty.facilities.find((facility) => facility.type === 'capital')!;
    capital.workers += emptyRemnant.waiting + emptyRemnant.screening + emptyRemnant.approved;
    emptyRemnant.waiting = 0;
    emptyRemnant.screening = 0;
    emptyRemnant.approved = 0;
    emptyRemnant.infected = 0;
    synchronizePopulation(empty);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: empty });
    const resolved = endTurn(engine);
    const resolvedRemnant = checkpointAt(resolved.state, { q: 14, r: 7 });
    expect(resolvedRemnant.status).toBe('operational');
    expect(checkpointRole(resolved.state, { q: 14, r: 7 })).toBe('standby');
    expect(resolved.state.checkpoints.some((checkpoint) => checkpoint.id === resolvedRemnant.id)).toBe(true);
  });

  it('recovers a Ruined Post without stealing the current Active or advancing Supply', () => {
    const engine = new GameEngine(510, safeConfig());
    prepareEastBranch(engine, [{ q: 14, r: 7 }, { q: 12, r: 7 }]);
    const setup = cloneState(engine.getState());
    const ruined = checkpointAt(setup, { q: 12, r: 7 });
    branch(setup).standbyCheckpointIds = [];
    ruined.status = 'ruined';
    ruined.infected = 5;
    ruined.waiting = 0;
    ruined.screening = 0;
    ruined.approved = 0;
    const guard = setup.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { ...ruined.position };
    resetHuman(guard);
    const capital = setup.facilities.find((facility) => facility.type === 'capital')!;
    capital.workers -= 5;
    synchronizePopulation(setup);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: setup });
    const recovered = endTurn(engine);
    expect(recovered.state.checkpoints.find((checkpoint) => checkpoint.id === ruined.id)?.status).toBe('operational');
    expect(branch(recovered.state).activeCheckpointId).toBe(checkpointAt(recovered.state, { q: 14, r: 7 }).id);
    expect(branch(recovered.state).standbyCheckpointIds).toContain(ruined.id);
    expect(checkpointRole(recovered.state, { q: 12, r: 7 })).toBe('standby');
    expect(recovered.state.statistics.checkpointsRecovered).toBe(1);
    expect(isHexSupplied(recovered.state, { q: 14, r: 7 })).toBe(true);
  });
});

describe('v1.3.3 Combat Noise / Priority / FoW', () => {
  it.each([
    ['police', { q: 11, r: 7 }, { q: 12, r: 7 }] as const,
    ['nationalGuard', { q: 12, r: 7 }, { q: 13, r: 7 }] as const,
  ])('uses the internal %s Radius boundary while publishing only medium Noise Class', (unitType, inside, outside) => {
    const scenario = makeNoiseScenario(unitType, inside);
    const stateBefore = scenario.engine.getState();
    expect(stateBefore.config.noise[unitType]).toBe(unitType === 'police' ? 4 : 5);
    expect(stateBefore.config.noise.publicClass[unitType]).toBe('medium');
    // Use a second isolated scenario for the outside boundary so the first pulse cannot target it.
    const outsideScenario = makeNoiseScenario(unitType, outside);
    const outsideState = cloneState(outsideScenario.engine.getState());
    outsideState.units = outsideState.units.filter((unit) => unit.id !== outsideScenario.receiver.id);
    const boundary = addZombie(outsideState, 'zombie-noise-outside', outside);
    boundary.vision = 0;
    synchronizePopulation(outsideState);
    stepOk(outsideScenario.engine, { type: 'LoadSnapshot', snapshot: outsideState });

    const emitted = stepOk(scenario.engine, {
      type: 'Attack',
      attackerId: scenario.human.id,
      targetId: scenario.target.id,
    });
    const noise = emitted.events.find((event) => event.type === 'noise_emitted');
    expect(noise).toMatchObject({
      type: 'noise_emitted',
      payload: expect.objectContaining({
        sourceUnitId: scenario.human.id,
        sourceUnitType: unitType,
        q: 7,
        r: 7,
        noiseClass: 'medium',
      }),
    });
    expect(noise?.payload).not.toHaveProperty('radius');
    expect(noise?.payload).not.toHaveProperty('affectedZombieIds');
    expect(noise?.payload).not.toHaveProperty('affectedCount');
    expect(emitted.state.units.find((unit) => unit.id === scenario.receiver.id)?.noiseTarget).toEqual({ q: 7, r: 7 });
    const outsideResult = stepOk(outsideScenario.engine, {
      type: 'Attack',
      attackerId: outsideScenario.human.id,
      targetId: outsideScenario.target.id,
    });
    expect(outsideResult.state.units.find((unit) => unit.id === boundary.id)?.noiseTarget).toBeNull();
    expect(emitted.state.statistics.noisePulsesEmitted).toBe(1);
    expect(emitted.state.statistics[unitType === 'police' ? 'policeNoisePulses' : 'nationalGuardNoisePulses']).toBe(1);
    expect(emitted.state.statistics.normalZombiesNoiseTargeted).toBe(1);
    expect(outsideResult.state.statistics.normalZombiesNoiseTargeted).toBe(0);
  });

  it('uses Combat start location and emits exactly one Pulse for a counterattack, while Move and Wait stay silent', () => {
    const scenario = makeNoiseScenario('police', { q: 11, r: 7 });
    scenario.target.hp = 10;
    const setup = cloneState(scenario.engine.getState());
    const target = setup.units.find((unit) => unit.id === scenario.target.id)!;
    target.hp = 10;
    synchronizePopulation(setup);
    stepOk(scenario.engine, { type: 'LoadSnapshot', snapshot: setup });
    const attack = stepOk(scenario.engine, {
      type: 'Attack',
      attackerId: scenario.human.id,
      targetId: scenario.target.id,
    });
    expect(attack.events.filter((event) => event.type === 'noise_emitted')).toHaveLength(1);
    expect(attack.events.filter((event) => event.type === 'attack')).toHaveLength(2);
    expect(attack.state.statistics.noisePulsesEmitted).toBe(1);

    const silent = makeNoiseScenario('police', { q: 11, r: 7 });
    const moved = stepOk(silent.engine, { type: 'Move', unitId: silent.human.id, destination: { q: 6, r: 7 } });
    expect(moved.state.statistics.noisePulsesEmitted).toBe(0);
    const waited = stepOk(silent.engine, { type: 'Wait', unitId: silent.engine.getState().units.find((unit) => unit.type === 'nationalGuard')!.id });
    expect(waited.state.statistics.noisePulsesEmitted).toBe(0);
  });

  it('freezes Zombie Phase decisions before combat Noise, then uses the preserved memory next phase', () => {
    const config = safeConfig({
      units: {
        police: { attack: 0, vision: 0 },
        nationalGuard: { attack: 0, vision: 0 },
        zombie: { movement: 0, attack: 5, vision: 0 },
        hordeZombie: { movement: 0, attack: 0, vision: 0 },
      },
    });
    const engine = new GameEngine(512, config);
    const state = cloneState(engine.getState());
    const center: HexCoord = { q: 7, r: 7 };
    const police = state.units.find((unit) => unit.type === 'police')!;
    police.position = { ...center };
    police.vision = 0;
    resetHuman(police);
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 0, r: 0 };
    guard.vision = 0;
    resetHuman(guard);
    const source = addZombie(state, 'zombie-a-noise-source', { q: 8, r: 7 });
    source.attack = 5;
    const receiver = addZombie(state, 'zombie-z-late-receiver', { q: 11, r: 7 });
    receiver.movement = 1;
    synchronizePopulation(state);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: state });

    const firstPhase = endTurn(engine);
    const firstReceiver = firstPhase.state.units.find((unit) => unit.id === receiver.id)!;
    expect(firstPhase.events.some(
      (event) => event.type === 'attack' && event.payload.attackerId === source.id && event.payload.defenderId === police.id,
    )).toBe(true);
    expect(firstPhase.events.some((event) => event.type === 'noise_emitted')).toBe(true);
    // The receiver had an idle decision in the phase-start snapshot, so late Noise
    // can only persist as memory and cannot change this phase's movement.
    expect(firstReceiver.position).toEqual({ q: 11, r: 7 });
    expect(firstReceiver.noiseTarget).toEqual(center);
    expect(firstPhase.state.statistics.normalZombieIdleCount).toBeGreaterThanOrEqual(1);

    const secondPhase = endTurn(engine);
    const secondReceiver = secondPhase.state.units.find((unit) => unit.id === receiver.id)!;
    expect(secondReceiver.position).not.toEqual(firstReceiver.position);
    expect(secondReceiver.noiseTarget).toEqual(center);
    expect(secondPhase.state.statistics.noiseTargetsReached).toBe(0);
  });

  it('does not let an existing Horde memory accept Noise, and Horde Zombies ignore Pulse entirely', () => {
    const scenario = makeNoiseScenario('police', { q: 11, r: 7 });
    const setup = cloneState(scenario.engine.getState());
    const receiver = setup.units.find((unit) => unit.id === scenario.receiver.id)!;
    receiver.inheritedTarget = { q: 1, r: 1 };
    const horde = addZombie(setup, 'horde-noise-immune', { q: 11, r: 6 }, 'hordeZombie');
    horde.vision = 0;
    synchronizePopulation(setup);
    stepOk(scenario.engine, { type: 'LoadSnapshot', snapshot: setup });
    const result = stepOk(scenario.engine, {
      type: 'Attack',
      attackerId: scenario.human.id,
      targetId: scenario.target.id,
    });
    expect(result.state.units.find((unit) => unit.id === receiver.id)?.noiseTarget).toBeNull();
    expect(result.state.units.find((unit) => unit.id === receiver.id)?.inheritedTarget).toEqual({ q: 1, r: 1 });
    expect(result.state.units.find((unit) => unit.id === horde.id)?.noiseTarget).toBeNull();
    expect(result.state.statistics.normalZombiesNoiseTargeted).toBe(0);
  });

  it('lets Inherited Horde and Visible Population override Noise and permanently clears the Noise memory', () => {
    const inherited = makeNoiseScenario('police', { q: 11, r: 7 }, 2);
    const inheritedState = cloneState(inherited.engine.getState());
    const horde = addZombie(inheritedState, 'horde-source', { q: 10, r: 7 }, 'hordeZombie');
    horde.vision = 0;
    const receiver = inheritedState.units.find((unit) => unit.id === inherited.receiver.id)!;
    receiver.vision = 2;
    receiver.noiseTarget = { q: 7, r: 7 };
    synchronizePopulation(inheritedState);
    stepOk(inherited.engine, { type: 'LoadSnapshot', snapshot: inheritedState });
    const inheritedResult = endTurn(inherited.engine);
    const inheritedAfter = inheritedResult.state.units.find((unit) => unit.id === receiver.id)!;
    expect(inheritedAfter.inheritedTarget).toEqual({ q: 7, r: 7 });
    expect(inheritedAfter.noiseTarget).toBeNull();
    expect(inheritedResult.state.statistics.noiseTargetsOverriddenByHorde).toBeGreaterThanOrEqual(1);

    const visible = makeNoiseScenario('police', { q: 11, r: 7 }, 2);
    const visibleState = cloneState(visible.engine.getState());
    const visibleReceiver = visibleState.units.find((unit) => unit.id === visible.receiver.id)!;
    visibleReceiver.noiseTarget = { q: 7, r: 7 };
    const guard = visibleState.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 10, r: 7 };
    guard.vision = 0;
    synchronizePopulation(visibleState);
    stepOk(visible.engine, { type: 'LoadSnapshot', snapshot: visibleState });
    const visibleResult = endTurn(visible.engine);
    expect(visibleResult.state.units.find((unit) => unit.id === visible.receiver.id)?.noiseTarget).toBeNull();
    expect(visibleResult.state.statistics.noiseTargetsOverriddenByVisiblePopulation).toBeGreaterThanOrEqual(1);
  });

  it('keeps the first of multiple Noise Pulses and clears a target on arrival', () => {
    const config = safeConfig({ units: { police: { vision: 4 }, nationalGuard: { vision: 4 } } });
    const engine = new GameEngine(511, config);
    const state = cloneState(engine.getState());
    const police = state.units.find((unit) => unit.type === 'police')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    police.position = { q: 7, r: 7 };
    guard.position = { q: 13, r: 7 };
    resetHuman(police);
    resetHuman(guard);
    const firstTarget = addZombie(state, 'zombie-noise-a', { q: 8, r: 7 });
    firstTarget.hp = 1;
    const secondTarget = addZombie(state, 'zombie-noise-b', { q: 12, r: 7 });
    secondTarget.hp = 1;
    const receiver = addZombie(state, 'zombie-noise-multi', { q: 11, r: 7 });
    receiver.vision = 0;
    synchronizePopulation(state);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: state });
    stepOk(engine, { type: 'Attack', attackerId: police.id, targetId: firstTarget.id });
    const second = stepOk(engine, { type: 'Attack', attackerId: guard.id, targetId: secondTarget.id });
    expect(second.state.units.find((unit) => unit.id === receiver.id)?.noiseTarget).toEqual({ q: 7, r: 7 });
    expect(second.state.statistics.noisePulsesEmitted).toBe(2);

    const arrived = cloneState(second.state);
    const atCenter = arrived.units.find((unit) => unit.id === receiver.id)!;
    atCenter.position = { q: 9, r: 7 };
    atCenter.noiseTarget = { q: 9, r: 7 };
    // Keep the state legal by moving the police away from the arrival center.
    arrived.units.find((unit) => unit.id === police.id)!.position = { q: 0, r: 0 };
    synchronizePopulation(arrived);
    stepOk(engine, { type: 'LoadSnapshot', snapshot: arrived });
    const cleared = endTurn(engine);
    expect(cleared.state.units.find((unit) => unit.id === receiver.id)?.noiseTarget).toBeNull();
    expect(cleared.state.statistics.noiseTargetsReached).toBeGreaterThanOrEqual(1);
  });

  it('keeps Noise hidden from player visibility and makes replay of Pulse / Target memory deterministic', () => {
    const first = makeNoiseScenario('police', { q: 11, r: 7 });
    const second = makeNoiseScenario('police', { q: 11, r: 7 });
    const firstAttack = stepOk(first.engine, { type: 'Attack', attackerId: first.human.id, targetId: first.target.id });
    const secondAttack = stepOk(second.engine, { type: 'Attack', attackerId: second.human.id, targetId: second.target.id });
    const project = (state: Readonly<GameState>) => ({
      units: state.units.map((unit) => ({ id: unit.id, position: unit.position, hp: unit.hp, noiseTarget: unit.noiseTarget })),
      rngState: state.rngState,
      stats: {
        noisePulsesEmitted: state.statistics.noisePulsesEmitted,
        normalZombiesNoiseTargeted: state.statistics.normalZombiesNoiseTargeted,
      },
    });
    expect(project(firstAttack.state)).toEqual(project(secondAttack.state));
    const noiseEvent = firstAttack.events.find((event) => event.type === 'noise_emitted');
    expect(noiseEvent?.payload).not.toHaveProperty('radius');
    expect(noiseEvent?.payload).not.toHaveProperty('affectedZombieIds');
    expect(noiseEvent?.payload).not.toHaveProperty('affectedCount');
    expect(firstAttack.state.units.find((unit) => unit.id === first.receiver.id)?.noiseTarget).toEqual({ q: 7, r: 7 });
  });
});
