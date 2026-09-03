import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import {
  GameEngine,
  getCheckpointPositionCandidates,
  getConstructibleFacilityPositionCandidates,
} from './engine';
import { hexKey } from './hex';
import { createUnit } from './state';
import { isHexSuppliedByBranch } from './supply';
import { getCheckpointRouteVisibility, getPlayerVisibleTileKeys } from './visibility';
import type { GameAction, GameState } from './types';

function cloneState(state: Readonly<GameState>): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function actionFor(candidate: ReturnType<typeof getCheckpointPositionCandidates>[number]): GameAction {
  return candidate.actionType === 'RelocateCheckpoint'
    ? {
        type: 'RelocateCheckpoint',
        checkpointId: candidate.checkpointId!,
        branchId: candidate.branchId,
        position: { ...candidate.position },
      }
    : { type: 'BuildCheckpoint', branchId: candidate.branchId, position: { ...candidate.position } };
}

function noInitialZombiesConfig(overrides: Parameters<typeof createDefaultConfig>[0] = {}) {
  return createDefaultConfig({
    economy: {
      initialZombieCount: 0,
      initialResources: { food: 5_000, civilianGoods: 5_000, militaryGoods: 5_000, fuel: 5_000 },
    },
    ...overrides,
  });
}

function northPosition(r: number): { q: number; r: number } {
  return { q: 25, r };
}

function checkpointCandidate(
  engine: GameEngine,
  actionType: 'BuildCheckpoint' | 'RelocateCheckpoint',
  position: { q: number; r: number },
  branchId = 'north',
): ReturnType<typeof getCheckpointPositionCandidates>[number] {
  const candidate = engine.getCheckpointPositionCandidates().find(
    (item) => item.actionType === actionType
      && item.branchId === branchId
      && hexKey(item.position) === hexKey(position),
  );
  expect(candidate).toBeDefined();
  return candidate!;
}

function loadSnapshot(engine: GameEngine, snapshot: GameState): void {
  expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
}

function expectRejectedWithoutMutation(
  engine: GameEngine,
  candidate: ReturnType<typeof getCheckpointPositionCandidates>[number],
): void {
  expect(candidate.legal).toBe(false);
  expect(candidate.reasonCode).not.toBeNull();
  const before = engine.getState();
  const result = engine.step(actionFor(candidate));
  expect(result.error?.code).toBe(candidate.reasonCode);
  expect(result.state).toEqual(before);
  expect(engine.getState()).toEqual(before);
  expect(engine.getState().resources).toEqual(before.resources);
  expect(engine.getState().rngState).toEqual(before.rngState);
}

describe('v1.4 position candidates', () => {
  it('returns every branch road tile in a stable order and agrees with legal actions', () => {
    const engine = new GameEngine(41, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = engine.getState();
    const first = getCheckpointPositionCandidates(state);
    const second = engine.getCheckpointPositionCandidates();
    expect(second).toEqual(first);
    expect(first).toHaveLength(state.map.roadBranches.reduce((total, branch) => total + branch.roadTiles.length, 0));
    expect(first.map((candidate) => candidate.branchId)).toEqual(
      [...state.map.roadBranches]
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((branch) => branch.roadTiles.map(() => branch.id)),
    );

    const legalKeys = new Set(engine.getLegalActions().map((action) => JSON.stringify(action)));
    for (const candidate of first) {
      expect(legalKeys.has(JSON.stringify(actionFor(candidate)))).toBe(candidate.legal);
      if (candidate.legal) expect(candidate.reasonCode).toBeNull();
      else expect(candidate.reasonCode).not.toBeNull();
    }
  }, 30_000);

  it('returns the same concrete Core reason as execution and preserves state on failure', () => {
    const engine = new GameEngine(42, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const illegal = engine.getCheckpointPositionCandidates().find((candidate) => !candidate.legal)!;
    expect(illegal).toBeDefined();
    const before = engine.getState();
    const result = engine.step(actionFor(illegal));
    expect(result.error?.code).toBe(illegal.reasonCode);
    expect(engine.getState()).toEqual(before);
  });

  it('does not change candidates or expose identity when the only blocker is hidden', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(43, config);
    const baseline = engine.getCheckpointPositionCandidates();
    const snapshot = cloneState(engine.getState());
    snapshot.units.push(createUnit(snapshot, 'hidden-candidate-zombie', 'zombie', { q: 15, r: 0 }));
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const withHidden = engine.getCheckpointPositionCandidates();
    expect(withHidden).toEqual(baseline);
    expect(JSON.stringify(withHidden)).not.toContain('hidden-candidate-zombie');
  });

  it('offers distinct rear build and relocation candidates for the active checkpoint', () => {
    const engine = new GameEngine(44, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const build = engine.getCheckpointPositionCandidates().find(
      (candidate) => candidate.branchId === 'north' && candidate.legal,
    )!;
    expect(engine.step(actionFor(build)).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const active = engine.getState().checkpoints.find((checkpoint) => checkpoint.status === 'operational')!;
    const north = engine.getCheckpointPositionCandidates().filter((candidate) => candidate.branchId === 'north');
    expect(north.some((candidate) => candidate.actionType === 'BuildCheckpoint')).toBe(true);
    const relocations = north.filter((candidate) => candidate.actionType === 'RelocateCheckpoint');
    expect(relocations.length).toBeGreaterThan(0);
    expect(relocations.every((candidate) => candidate.checkpointId === active.id)).toBe(true);
  });

  it('returns all Constructible Facility candidates in stable coordinate order', () => {
    const engine = new GameEngine(45, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const candidates = getConstructibleFacilityPositionCandidates(engine.getState(), 'simpleFarm');
    expect(candidates).toHaveLength(51 * 51);
    expect(candidates.map((candidate) => `${candidate.position.q},${candidate.position.r}`)).toEqual(
      [...candidates]
        .sort((left, right) => left.position.q - right.position.q || left.position.r - right.position.r)
        .map((candidate) => `${candidate.position.q},${candidate.position.r}`),
    );
    expect(candidates.some((candidate) => candidate.legal)).toBe(true);
    expect(candidates.filter((candidate) => candidate.legal).every((candidate) => candidate.reasonCode === null)).toBe(true);
    expect(candidates.filter((candidate) => !candidate.legal).every((candidate) => candidate.reasonCode !== null)).toBe(true);
    expect(candidates.filter((candidate) =>
      candidate.position.q === 0 || candidate.position.q === 50 || candidate.position.r === 0 || candidate.position.r === 50
    ).every((candidate) => candidate.reasonCode === 'horde_spawn_reserve')).toBe(true);
  });

  it('rejects Reserve placement with the shared reason without changing resources, actions, or RNG', () => {
    // Keep the reserve road itself visible so the structural Reserve reason
    // is not shadowed by the v1.4.5 visibility gate.
    const engine = new GameEngine(47, noInitialZombiesConfig({ vision: { capital: 50 } }));
    const before = engine.getState();
    const checkpoint = engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 0 } });
    expect(checkpoint.error?.code).toBe('horde_spawn_reserve');
    expect(engine.getState()).toEqual(before);
    const facility = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: { q: 0, r: 0 } });
    expect(facility.error?.code).toBe('horde_spawn_reserve');
    expect(engine.getState()).toEqual(before);
  });

  it('does not expose a hidden Zombie in Constructible candidates and accepts hidden co-location', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { capital: 0, ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(46, config);
    const baseline = engine.getConstructibleFacilityPositionCandidates('simpleFarm');
    const visible = getPlayerVisibleTileKeys(engine.getState());
    const legal = baseline.find((candidate) => candidate.legal && !visible.has(hexKey(candidate.position)))!;
    expect(legal).toBeDefined();
    const hidden = createUnit(engine.getState(), 'hidden-build-zombie', 'zombie', legal.position);
    const snapshot = cloneState(engine.getState());
    snapshot.units.push(hidden);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const withHidden = engine.getConstructibleFacilityPositionCandidates('simpleFarm');
    expect(withHidden).toEqual(baseline);
    expect(JSON.stringify(withHidden)).not.toContain(hidden.id);
    expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: legal.position }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.constructible)?.position).toEqual(legal.position);
  });

  it('rejects a Build target that is outside the current Player Vision', () => {
    const engine = new GameEngine(501, noInitialZombiesConfig());
    const target = northPosition(15);
    const visibility = getCheckpointRouteVisibility(engine.getState(), 'north', target);
    expect(visibility).toEqual({ targetVisible: false, routeVisible: false });

    const candidate = checkpointCandidate(engine, 'BuildCheckpoint', target);
    expect(candidate.legal).toBe(false);
    expect(candidate.reasonCode).toBe('checkpoint_target_not_visible');
    expectRejectedWithoutMutation(engine, candidate);
  });

  it('rejects a visible target when one road tile in the capital corridor is hidden', () => {
    const config = noInitialZombiesConfig({
      units: { police: { vision: 1 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(502, config);
    const snapshot = cloneState(engine.getState());
    snapshot.units.find((unit) => unit.type === 'police')!.position = { q: 24, r: 15 };
    loadSnapshot(engine, snapshot);

    const target = northPosition(15);
    const visible = getPlayerVisibleTileKeys(engine.getState());
    expect(visible.has(hexKey(target))).toBe(true);
    expect(getCheckpointRouteVisibility(engine.getState(), 'north', target)).toEqual({
      targetVisible: true,
      routeVisible: false,
    });

    const candidate = checkpointCandidate(engine, 'BuildCheckpoint', target);
    expect(candidate.reasonCode).toBe('checkpoint_route_not_visible');
    expectRejectedWithoutMutation(engine, candidate);
  });

  it('rejects visible checkpoint blockers but accepts a hidden-only blocker', () => {
    const config = noInitialZombiesConfig({ vision: { capital: 50 } });
    const target = northPosition(5);

    const visibleEngine = new GameEngine(503, config);
    const visibleSnapshot = cloneState(visibleEngine.getState());
    visibleSnapshot.units.push(createUnit(visibleSnapshot, 'visible-checkpoint-blocker', 'zombie', target));
    loadSnapshot(visibleEngine, visibleSnapshot);
    expect(getCheckpointRouteVisibility(visibleEngine.getState(), 'north', target)).toEqual({
      targetVisible: true,
      routeVisible: true,
    });
    const blocked = checkpointCandidate(visibleEngine, 'BuildCheckpoint', target);
    expect(blocked.legal).toBe(false);
    expect(blocked.reasonCode).toBe('checkpoint_supply_zombie_blocked');
    expectRejectedWithoutMutation(visibleEngine, blocked);

    const hiddenEngine = new GameEngine(504, config);
    const hiddenSnapshot = cloneState(hiddenEngine.getState());
    const visibleKeys = getPlayerVisibleTileKeys(hiddenSnapshot);
    const occupiedKeys = new Set([
      ...hiddenSnapshot.facilities.map((facility) => hexKey(facility.position)),
      ...hiddenSnapshot.units.map((unit) => hexKey(unit.position)),
    ]);
    const hiddenTile = hiddenSnapshot.map.tiles.find((tile) =>
      !visibleKeys.has(tile.key)
      && !occupiedKeys.has(tile.key)
      && !tile.hordeEntranceDirections.length
      && isHexSuppliedByBranch(hiddenSnapshot, tile, 'north', target),
    );
    expect(hiddenTile).toBeDefined();
    hiddenSnapshot.units.push(createUnit(hiddenSnapshot, 'hidden-checkpoint-blocker', 'zombie', hiddenTile!));
    loadSnapshot(hiddenEngine, hiddenSnapshot);

    const baseline = checkpointCandidate(hiddenEngine, 'BuildCheckpoint', target);
    expect(baseline.legal).toBe(true);
    expect(baseline.reasonCode).toBeNull();
    expect(hiddenEngine.step(actionFor(baseline)).error).toBeNull();
  });

  it('keeps Build and Relocate candidate reasons identical to execution on rejection', () => {
    const engine = new GameEngine(505, noInitialZombiesConfig({ vision: { capital: 50 } }));
    const build = checkpointCandidate(engine, 'BuildCheckpoint', northPosition(15));
    expect(build.legal).toBe(true);
    expect(engine.step(actionFor(build)).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();

    // city-1 is a permanent facility on the north road. Both action kinds
    // must use the same Facility-occupied reason and preserve the snapshot.
    const relocate = checkpointCandidate(engine, 'RelocateCheckpoint', northPosition(20));
    const buildAtFacility = checkpointCandidate(engine, 'BuildCheckpoint', northPosition(20));
    expect(relocate.reasonCode).toBe('checkpoint_facility_occupied');
    expect(buildAtFacility.reasonCode).toBe('checkpoint_facility_occupied');
    expectRejectedWithoutMutation(engine, relocate);
    expectRejectedWithoutMutation(engine, buildAtFacility);
  });

  it('rejects Build and Relocate onto a constructible Facility as well as a permanent one', () => {
    const engine = new GameEngine(506, noInitialZombiesConfig({ vision: { capital: 50 } }));
    const activeBuild = checkpointCandidate(engine, 'BuildCheckpoint', northPosition(15));
    expect(engine.step(actionFor(activeBuild)).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();

    const facilityBuild = engine.getConstructibleFacilityPositionCandidates('simpleFarm').find((candidate) => candidate.legal)!;
    expect(facilityBuild).toBeDefined();
    expect(engine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'simpleFarm',
      position: facilityBuild.position,
    }).error).toBeNull();
    const snapshot = cloneState(engine.getState());
    const constructible = snapshot.facilities.find((facility) => facility.constructible && facility.type === 'simpleFarm')!;
    constructible.position = northPosition(22);
    loadSnapshot(engine, snapshot);

    const buildAtConstructible = checkpointCandidate(engine, 'BuildCheckpoint', northPosition(22));
    const relocateAtConstructible = checkpointCandidate(engine, 'RelocateCheckpoint', northPosition(22));
    expect(buildAtConstructible.reasonCode).toBe('checkpoint_facility_occupied');
    expect(relocateAtConstructible.reasonCode).toBe('checkpoint_facility_occupied');
    expectRejectedWithoutMutation(engine, buildAtConstructible);
    expectRejectedWithoutMutation(engine, relocateAtConstructible);

    // The reverse overlap is rejected by the constructible validation too;
    // the road rule may be the first concrete reason for this same tile.
    const reverseEngine = new GameEngine(507, noInitialZombiesConfig({ vision: { capital: 50 } }));
    const checkpoint = checkpointCandidate(reverseEngine, 'BuildCheckpoint', northPosition(24));
    expect(reverseEngine.step(actionFor(checkpoint)).error).toBeNull();
    const before = reverseEngine.getState();
    const reverse = reverseEngine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'simpleFarm',
      position: northPosition(24),
    });
    expect(reverse.error).not.toBeNull();
    expect(reverseEngine.getState()).toEqual(before);
  });

  it('rejects a loaded snapshot where any Facility shares a Checkpoint tile', () => {
    const engine = new GameEngine(511, noInitialZombiesConfig({ vision: { capital: 50 } }));
    const buildable = engine.getConstructibleFacilityPositionCandidates('simpleFarm').find((candidate) => candidate.legal)!;
    expect(engine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'simpleFarm',
      position: buildable.position,
    }).error).toBeNull();
    const checkpoint = checkpointCandidate(engine, 'BuildCheckpoint', northPosition(24));
    expect(engine.step(actionFor(checkpoint)).error).toBeNull();

    const overlapping = cloneState(engine.getState());
    overlapping.facilities.find((facility) => facility.constructible)!.position = northPosition(24);
    const before = engine.getState();
    const result = engine.step({ type: 'LoadSnapshot', snapshot: overlapping });
    expect(result.error).toMatchObject({ code: 'invalid_snapshot' });
    expect(result.error?.message).toContain('cannot share facility tile');
    expect(engine.getState()).toEqual(before);
  });

  it('allows five prepared posts per direction and rejects the sixth', () => {
    const config = noInitialZombiesConfig({
      horde: {
        waves: [{ turn: 99, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }],
      },
      vision: { capital: 50 },
    });
    expect(config.checkpoint.maxPreparedPostsPerDirection).toBe(5);
    const engine = new GameEngine(508, config);
    // The first post is active; each remaining position is behind it on the
    // north branch and therefore becomes Standby.
    const positions = [15, 24, 22, 21, 19].map(northPosition);
    for (const [index, position] of positions.entries()) {
      // A real turn-end can introduce an unrelated Horde before all five
      // posts are prepared. Reset only this branch's per-turn checkpoint
      // budget through the trusted snapshot boundary so this test remains a
      // focused placement-capacity test.
      if (index > 0) {
        const snapshot = cloneState(engine.getState());
        snapshot.roadBranches.find((item) => item.branchId === 'north')!.checkpointActionsThisTurn = 0;
        loadSnapshot(engine, snapshot);
      }
      const candidate = checkpointCandidate(engine, 'BuildCheckpoint', position);
      expect(candidate.legal, `prepared index ${index}: ${JSON.stringify(candidate)}`).toBe(true);
      expect(engine.step(actionFor(candidate)).error).toBeNull();
    }
    const state = engine.getState();
    const branch = state.roadBranches.find((item) => item.branchId === 'north')!;
    expect(branch.activeCheckpointId).not.toBeNull();
    expect(branch.standbyCheckpointIds).toHaveLength(4);

    const sixth = checkpointCandidate(engine, 'BuildCheckpoint', northPosition(18));
    expect(sixth.reasonCode).toBe('checkpoint_prepared_post_limit_reached');
    expectRejectedWithoutMutation(engine, sixth);
  });

  it('prioritizes target/route visibility over facility and Zombie blocker reasons', () => {
    const hiddenTargetEngine = new GameEngine(509, noInitialZombiesConfig());
    const hiddenBuildable = hiddenTargetEngine.getConstructibleFacilityPositionCandidates('simpleFarm').find((candidate) => candidate.legal)!;
    expect(hiddenTargetEngine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'simpleFarm',
      position: hiddenBuildable.position,
    }).error).toBeNull();
    const hiddenSnapshot = cloneState(hiddenTargetEngine.getState());
    hiddenSnapshot.facilities.find((facility) => facility.constructible)!.position = northPosition(15);
    hiddenSnapshot.units.push(createUnit(hiddenSnapshot, 'hidden-priority-blocker', 'zombie', northPosition(15)));
    loadSnapshot(hiddenTargetEngine, hiddenSnapshot);
    const hiddenCandidate = checkpointCandidate(hiddenTargetEngine, 'BuildCheckpoint', northPosition(15));
    expect(hiddenCandidate.reasonCode).toBe('checkpoint_target_not_visible');
    expectRejectedWithoutMutation(hiddenTargetEngine, hiddenCandidate);

    const routeConfig = noInitialZombiesConfig({
      units: { police: { vision: 1 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const routeEngine = new GameEngine(510, routeConfig);
    const routeBuildable = routeEngine.getConstructibleFacilityPositionCandidates('simpleFarm').find((candidate) => candidate.legal)!;
    expect(routeEngine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'simpleFarm',
      position: routeBuildable.position,
    }).error).toBeNull();
    const routeSnapshot = cloneState(routeEngine.getState());
    routeSnapshot.facilities.find((facility) => facility.constructible)!.position = northPosition(15);
    routeSnapshot.units.find((unit) => unit.type === 'police')!.position = { q: 24, r: 15 };
    routeSnapshot.units.push(createUnit(routeSnapshot, 'route-priority-blocker', 'zombie', northPosition(15)));
    loadSnapshot(routeEngine, routeSnapshot);
    expect(getCheckpointRouteVisibility(routeEngine.getState(), 'north', northPosition(15))).toEqual({
      targetVisible: true,
      routeVisible: false,
    });
    const routeCandidate = checkpointCandidate(routeEngine, 'BuildCheckpoint', northPosition(15));
    expect(routeCandidate.reasonCode).toBe('checkpoint_route_not_visible');
    expectRejectedWithoutMutation(routeEngine, routeCandidate);
  });
});
