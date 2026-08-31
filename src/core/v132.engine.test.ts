import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { deriveVictoryProgress, GameEngine } from './engine';
import { hexDistance, hexKey } from './hex';
import { createUnit } from './state';
import type { BaseTerrain, GameState, HexCoord, UnitState } from './types';

function cloneState(state: Readonly<GameState>): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function safeScenarioConfig(overrides: Parameters<typeof createDefaultConfig>[0] = {}) {
  return createDefaultConfig({
    economy: {
      initialZombieCount: 0,
      initialResources: {
        food: 100_000,
        civilianGoods: 100_000,
        militaryGoods: 100_000,
        fuel: 100_000,
      },
    },
    refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
    ...overrides,
  });
}

function findCombatArena(
  state: Readonly<GameState>,
  targetTerrain: BaseTerrain,
  excluded: ReadonlySet<string> = new Set(),
): { attacker: HexCoord; target: HexCoord } {
  for (const targetTile of state.map.tiles) {
    const target = { q: targetTile.q, r: targetTile.r };
    if (targetTile.terrain !== targetTerrain || targetTile.facilityId !== null || excluded.has(hexKey(target))) continue;
    const attackerTile = state.map.tiles.find((tile) =>
      tile.facilityId === null &&
      !excluded.has(tile.key) &&
      hexDistance({ q: tile.q, r: tile.r }, target) === 2,
    );
    if (attackerTile) return { attacker: { q: attackerTile.q, r: attackerTile.r }, target };
  }
  throw new Error(`No ${targetTerrain} combat arena found`);
}

function resetGuardForAttack(state: GameState): UnitState {
  const guard = state.units.find((unit) => unit.type === 'nationalGuard');
  if (!guard) throw new Error('National Guard is missing');
  guard.actionState = 'ready';
  guard.canAttack = true;
  guard.canMove = true;
  return guard;
}

function createGroupedZombie(
  state: GameState,
  id: string,
  type: 'zombie' | 'hordeZombie',
  position: HexCoord,
  groupId: string,
  kind: 'periodic' | 'final' = 'periodic',
): UnitState {
  const unit = createUnit(state, id, type, position);
  unit.spawnGroupId = groupId;
  unit.hordeKind = kind;
  return unit;
}

describe('v1.4 Horde composition and combat', () => {
  it('keeps Normal Zombie HP at 10 and requires two plain hits or four forest hits for a 20 HP Horde Zombie', () => {
    expect(createDefaultConfig().units.zombie.hp).toBe(10);
    expect(createDefaultConfig().units.hordeZombie.hp).toBe(20);
    expect(new GameEngine(300, createDefaultConfig()).getState().units
      .filter((unit) => unit.type === 'zombie')
      .every((unit) => unit.spawnGroupId === null && unit.hordeKind === null)).toBe(true);

    for (const [terrain, expectedHp] of [
      ['plain', [10, 0]],
      ['forest', [15, 10, 5, 0]],
    ] as const) {
      const engine = new GameEngine(301, safeScenarioConfig());
      const editable = cloneState(engine.getState());
      editable.units = editable.units.filter((unit) => unit.isPlayerUnit);
      const police = editable.units.find((unit) => unit.type === 'police')!;
      const arena = findCombatArena(editable, terrain, new Set([hexKey(police.position)]));
      const guard = resetGuardForAttack(editable);
      guard.position = arena.attacker;
      const horde = createGroupedZombie(editable, `horde-${terrain}`, 'hordeZombie', arena.target, `periodic-${terrain}`);
      editable.units.push(horde);
      expect(engine.step({ type: 'LoadSnapshot', snapshot: editable }).error).toBeNull();

      for (const hp of expectedHp) {
        const result = engine.step({ type: 'Attack', attackerId: guard.id, targetId: horde.id });
        expect(result.error).toBeNull();
        expect(result.state.units.find((unit) => unit.id === horde.id)?.hp ?? 0).toBe(hp);
        if (hp > 0) {
          const reset = cloneState(result.state);
          resetGuardForAttack(reset);
          expect(engine.step({ type: 'LoadSnapshot', snapshot: reset }).error).toBeNull();
        }
      }
    }
  });

  it('spawns the standard 2/0 through 6/4 Periodic groups and the 7/5 Final group', () => {
    const engine = new GameEngine(302, safeScenarioConfig({
      finalHordeTurn: 30,
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    }));
    const expected = [
      { turn: 5, hordeZombie: 2, zombie: 0 },
      { turn: 10, hordeZombie: 3, zombie: 1 },
      { turn: 15, hordeZombie: 4, zombie: 2 },
      { turn: 20, hordeZombie: 5, zombie: 3 },
      { turn: 25, hordeZombie: 6, zombie: 4 },
    ];

    for (const composition of expected) {
      let spawnEvents: ReturnType<GameEngine['step']>['events'] = [];
      while (engine.getState().turn <= composition.turn) {
        const result = engine.step({ type: 'EndTurn' });
        expect(result.error).toBeNull();
        expect(result.gameOver).toBe(false);
        spawnEvents = result.events;
      }
      const groupId = `periodic-horde-${composition.turn}`;
      const group = engine.getState().units.filter((unit) => unit.spawnGroupId === groupId);
      expect(group.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(composition.hordeZombie);
      expect(group.filter((unit) => unit.type === 'zombie')).toHaveLength(composition.zombie);
      expect(group).toHaveLength(composition.hordeZombie + composition.zombie);
      expect(group.every((unit) => unit.hordeKind === 'periodic')).toBe(true);
      expect(group.filter((unit) => unit.type === 'zombie').every((normal) =>
        normal.inheritedTarget === null && group.some((horde) =>
          horde.type === 'hordeZombie' && hexDistance(normal.position, horde.position) <= normal.vision,
        ),
      )).toBe(true);

      const unitSpawnEvents = spawnEvents.filter((event) =>
        event.type === 'horde_spawned' && event.payload.spawnGroupId === groupId && typeof event.payload.unitType === 'string',
      );
      expect(unitSpawnEvents.filter((event) => event.payload.unitType === 'hordeZombie')).toHaveLength(composition.hordeZombie);
      expect(unitSpawnEvents.filter((event) => event.payload.unitType === 'zombie')).toHaveLength(composition.zombie);
    }

    let finalEvents: ReturnType<GameEngine['step']>['events'] = [];
    while (engine.getState().turn <= 30) {
      const result = engine.step({ type: 'EndTurn' });
      expect(result.error).toBeNull();
      expect(result.gameOver).toBe(false);
      finalEvents = result.events;
    }
    const finalGroupId = engine.getState().horde.finalSpawnGroupId!;
    const finalGroup = engine.getState().units.filter((unit) => unit.spawnGroupId === finalGroupId);
    expect(finalGroup.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(7);
    expect(finalGroup.filter((unit) => unit.type === 'zombie')).toHaveLength(5);
    expect(finalGroup).toHaveLength(12);
    expect(finalGroup.every((unit) => unit.hordeKind === 'final')).toBe(true);
    expect(finalGroup.filter((unit) => unit.type === 'zombie').every((normal) =>
      normal.inheritedTarget === null && finalGroup.some((horde) =>
        horde.type === 'hordeZombie' && hexDistance(normal.position, horde.position) <= normal.vision,
      ),
    )).toBe(true);
    const finalProgress = cloneState(engine.getState());
    finalProgress.units = finalProgress.units.filter((unit) => unit.spawnGroupId !== finalGroupId || unit.id === finalGroup[0]!.id);
    expect(deriveVictoryProgress(finalProgress).finalHordeDefeated).toBe(false);
    finalProgress.units = finalProgress.units.filter((unit) => unit.spawnGroupId !== finalGroupId);
    expect(deriveVictoryProgress(finalProgress).finalHordeDefeated).toBe(true);
    expect(finalEvents).toContainEqual(expect.objectContaining({
      type: 'horde_spawned',
      payload: expect.objectContaining({ hordeKind: 'final', spawnGroupId: finalGroupId, direction: expect.any(String) }),
    }));
    expect(engine.getState().horde).toMatchObject({ finalSpawnedCount: 12, totalSpawned: 42 });
    expect(engine.getState().statistics).toMatchObject({
      periodicHordeZombiesSpawned: 20,
      periodicNormalZombiesSpawned: 10,
      finalHordeZombiesSpawned: 7,
      finalNormalZombiesSpawned: 5,
      finalHordeSpawned: 12,
    });
  }, 30_000);

  it('uses custom per-type composition arithmetic for Periodic and Final groups', () => {
    const engine = new GameEngine(303, safeScenarioConfig({
      finalHordeTurn: 3,
      horde: {
        cycle: 1,
        periodicInitial: { hordeZombie: 3, zombie: 2 },
        periodicIncrement: { hordeZombie: 2, zombie: 1 },
        finalComposition: { hordeZombie: 4, zombie: 3 },
      },
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    }));

    for (let index = 0; index < 3; index += 1) expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const state = engine.getState();
    const first = state.units.filter((unit) => unit.spawnGroupId === 'periodic-horde-1');
    const second = state.units.filter((unit) => unit.spawnGroupId === 'periodic-horde-2');
    const final = state.units.filter((unit) => unit.spawnGroupId === state.horde.finalSpawnGroupId);
    expect([first.filter((unit) => unit.type === 'hordeZombie').length, first.filter((unit) => unit.type === 'zombie').length]).toEqual([3, 2]);
    expect([second.filter((unit) => unit.type === 'hordeZombie').length, second.filter((unit) => unit.type === 'zombie').length]).toEqual([5, 3]);
    expect([final.filter((unit) => unit.type === 'hordeZombie').length, final.filter((unit) => unit.type === 'zombie').length]).toEqual([4, 3]);
  });

  it('counts Final Normal Zombies as Final members and in both kill metrics', () => {
    const engine = new GameEngine(304, safeScenarioConfig({
      finalHordeTurn: 1,
      horde: { finalComposition: { hordeZombie: 1, zombie: 1 } },
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    }));
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const spawned = cloneState(engine.getState());
    const finalGroupId = spawned.horde.finalSpawnGroupId!;
    const normal = spawned.units.find((unit) => unit.type === 'zombie' && unit.spawnGroupId === finalGroupId)!;
    const horde = spawned.units.find((unit) => unit.type === 'hordeZombie' && unit.spawnGroupId === finalGroupId)!;

    const normalOnly = cloneState(spawned);
    normalOnly.units = normalOnly.units.filter((unit) => unit.isPlayerUnit || unit.id === normal.id);
    expect(deriveVictoryProgress(normalOnly).finalHordeDefeated).toBe(false);
    normalOnly.units = normalOnly.units.filter((unit) => unit.id !== normal.id);
    expect(deriveVictoryProgress(normalOnly).finalHordeDefeated).toBe(true);

    const police = spawned.units.find((unit) => unit.type === 'police')!;
    const arena = findCombatArena(spawned, 'plain', new Set([hexKey(police.position), hexKey(horde.position)]));
    const guard = resetGuardForAttack(spawned);
    guard.position = arena.attacker;
    normal.position = arena.target;
    normal.hp = 1;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: spawned }).error).toBeNull();
    const normalKill = engine.step({ type: 'Attack', attackerId: guard.id, targetId: normal.id });
    expect(normalKill.error).toBeNull();
    expect(normalKill.state.statistics).toMatchObject({ normalZombiesKilled: 1, finalHordeKilled: 1 });
    expect(normalKill.state.horde.finalHordeStatus).toBe('active');

    const hordeSetup = cloneState(normalKill.state);
    const resetGuard = resetGuardForAttack(hordeSetup);
    const survivingHorde = hordeSetup.units.find((unit) => unit.id === horde.id)!;
    survivingHorde.position = arena.target;
    survivingHorde.hp = 1;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: hordeSetup }).error).toBeNull();
    const hordeKill = engine.step({ type: 'Attack', attackerId: resetGuard.id, targetId: survivingHorde.id });
    expect(hordeKill.error).toBeNull();
    expect(hordeKill.state.statistics).toMatchObject({
      normalZombiesKilled: 1,
      hordeZombiesKilled: 1,
      finalHordeKilled: 2,
      finalHordeDefeated: true,
    });
    expect(hordeKill.state.horde.finalHordeStatus).toBe('defeated');
  });

  it('reproduces Mixed Horde unit IDs, types, groups, positions, and RNG state for the same seed and actions', () => {
    const config = safeScenarioConfig({
      finalHordeTurn: 12,
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    });
    const first = new GameEngine(305, config);
    const second = new GameEngine(305, config);
    for (let turn = 0; turn < 10; turn += 1) {
      expect(first.step({ type: 'EndTurn' }).error).toBeNull();
      expect(second.step({ type: 'EndTurn' }).error).toBeNull();
    }
    const project = (state: Readonly<GameState>) => state.units
      .filter((unit) => unit.hordeKind !== null)
      .map((unit) => ({
        id: unit.id,
        type: unit.type,
        position: unit.position,
        spawnGroupId: unit.spawnGroupId,
        hordeKind: unit.hordeKind,
        inheritedTarget: unit.inheritedTarget,
      }));
    expect(project(first.getState())).toEqual(project(second.getState()));
    expect(first.getState().rngState).toEqual(second.getState().rngState);
  });
});

describe('v1.4 Horde target propagation', () => {
  function targetScenario(): { engine: GameEngine; state: GameState } {
    const engine = new GameEngine(401, safeScenarioConfig({
      finalHordeTurn: 30,
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    }));
    const state = cloneState(engine.getState());
    state.units = state.units.filter((unit) => unit.isPlayerUnit);
    state.units.find((unit) => unit.type === 'police')!.position = { q: 12, r: 8 };
    state.units.find((unit) => unit.type === 'nationalGuard')!.position = { q: 8, r: 13 };
    return { engine, state };
  }

  it('prefers a visible population target over inheritance', () => {
    const { engine, state } = targetScenario();
    const normal = createUnit(state, 'zombie-normal', 'zombie', { q: 11, r: 8 });
    const horde = createGroupedZombie(state, 'horde-source', 'hordeZombie', { q: 10, r: 8 }, 'periodic-source');
    state.units.push(normal, horde);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === normal.id)?.inheritedTarget).toBeNull();
    expect(result.state.statistics.hordeTargetInheritedCount).toBe(0);
  });

  it('chooses the nearest Horde source before Unit ID and uses Unit ID for equal distances', () => {
    for (const [firstPosition, otherPosition, expectedTarget] of [
      [{ q: 8, r: 10 }, { q: 9, r: 8 }, { q: 12, r: 8 }],
      [{ q: 10, r: 8 }, { q: 8, r: 10 }, { q: 12, r: 8 }],
    ] as const) {
      const { engine, state } = targetScenario();
      const normal = createUnit(state, 'zombie-receiver', 'zombie', { q: 8, r: 8 });
      const lexicallyFirst = createGroupedZombie(state, 'horde-a', 'hordeZombie', firstPosition, 'periodic-a');
      const other = createGroupedZombie(state, 'horde-z', 'hordeZombie', otherPosition, 'periodic-z');
      state.units.push(normal, lexicallyFirst, other);
      expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
      const result = engine.step({ type: 'EndTurn' });
      expect(result.error).toBeNull();
      expect(result.state.units.find((unit) => unit.id === normal.id)?.inheritedTarget).toEqual(expectedTarget);
    }
  });

  it('clears inherited memory at its destination and never propagates Normal to Normal', () => {
    const cleared = targetScenario();
    const atTarget = createUnit(cleared.state, 'zombie-at-target', 'zombie', { q: 8, r: 8 });
    atTarget.inheritedTarget = { q: 8, r: 8 };
    cleared.state.units.push(atTarget);
    expect(cleared.engine.step({ type: 'LoadSnapshot', snapshot: cleared.state }).error).toBeNull();
    const clearResult = cleared.engine.step({ type: 'EndTurn' });
    expect(clearResult.state.units.find((unit) => unit.id === atTarget.id)?.inheritedTarget).toBeNull();
    expect(clearResult.state.statistics.hordeTargetClearedCount).toBe(1);

    const noReverse = targetScenario();
    const source = createUnit(noReverse.state, 'zombie-source', 'zombie', { q: 8, r: 9 });
    source.inheritedTarget = { q: 13, r: 8 };
    const receiver = createUnit(noReverse.state, 'zombie-receiver', 'zombie', { q: 8, r: 8 });
    noReverse.state.units.push(source, receiver);
    expect(noReverse.engine.step({ type: 'LoadSnapshot', snapshot: noReverse.state }).error).toBeNull();
    const result = noReverse.engine.step({ type: 'EndTurn' });
    expect(result.state.units.find((unit) => unit.id === receiver.id)?.inheritedTarget).toBeNull();
    expect(result.state.statistics.hordeTargetInheritedCount).toBe(0);
  });
});
