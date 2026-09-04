import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { deriveVictoryProgress, GameEngine } from './engine';
import { hexDistance, hexKey } from './hex';
import { createUnit } from './state';
import { isGroundVisibleFrom } from './visibility';
import { singleFinalWave } from './testConfig';
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
    if (!targetTile.playerOccupancyAllowed || targetTile.terrain !== targetTerrain || targetTile.facilityId !== null || excluded.has(hexKey(target))) continue;
    const attackerTile = state.map.tiles.find((tile) =>
      tile.playerOccupancyAllowed &&
      tile.facilityId === null &&
      !excluded.has(tile.key) &&
      hexDistance({ q: tile.q, r: tile.r }, target) === 2 &&
      isGroundVisibleFrom(state, { q: tile.q, r: tile.r }, target, 2),
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
  guard.attackChargesRemaining = guard.maxAttackCharges;
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

  it('spawns the standard five deterministic multi-direction Waves', () => {
    const defaultSchedule = createDefaultConfig().horde.waves;
    expect(defaultSchedule.map((wave) => wave.turn)).toEqual([5, 10, 20, 35, 50]);
    // Preserve the standard wave sizes/directions while moving their turns
    // forward.  The full 50-turn map simulation is intentionally covered by
    // integration tests; this unit test isolates spawn composition.
    const acceleratedSchedule = defaultSchedule.map((wave, index) => ({ ...wave, turn: index + 3 }));
    const engine = new GameEngine(302, safeScenarioConfig({
      horde: { waves: acceleratedSchedule },
      units: {
        zombie: { movement: 0 }, hordeZombie: { movement: 0 }, policeZombie: { movement: 0 },
        soldierZombie: { movement: 0 }, riotZombie: { movement: 0 },
      },
    }));
    const schedule = engine.getState().config.horde.waves;
    let finalEvents: ReturnType<GameEngine['step']>['events'] = [];
    for (let waveIndex = 1; waveIndex <= schedule.length; waveIndex += 1) {
      const wave = schedule[waveIndex - 1]!;
      while (engine.getState().turn <= wave.turn) {
        const result = engine.step({ type: 'EndTurn' });
        expect(result.error).toBeNull();
        expect(result.gameOver).toBe(false);
        if (wave.final) finalEvents = result.events;
      }
      const groupIds = engine.getState().horde.spawnGroupIdsByWave[String(waveIndex)]!;
      expect(groupIds).toHaveLength(wave.directionCount);
      expect(new Set(groupIds).size).toBe(wave.directionCount);
      for (const groupId of groupIds) {
        const group = engine.getState().units.filter((unit) => unit.spawnGroupId === groupId);
        expect(group.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(wave.compositionPerDirection.hordeZombie);
        expect(group.filter((unit) => unit.type !== 'hordeZombie')).toHaveLength(wave.compositionPerDirection.zombie);
        expect(group.filter((unit) => unit.type !== 'hordeZombie').every((unit) =>
          ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie'].includes(unit.type),
        )).toBe(true);
        expect(group.every((unit) => unit.hordeKind === (wave.final ? 'final' : 'periodic'))).toBe(true);
      }
    }
    const finalIds = engine.getState().horde.finalSpawnGroupIds;
    const finalGroup = engine.getState().units.filter((unit) => unit.spawnGroupId !== null && finalIds.includes(unit.spawnGroupId));
    expect(finalIds).toHaveLength(4);
    const expectedFinalSpawned = schedule.filter((wave) => wave.final)
      .reduce((sum, wave) => sum + wave.directionCount * (wave.compositionPerDirection.hordeZombie + wave.compositionPerDirection.zombie), 0);
    const expectedTotalSpawned = schedule
      .reduce((sum, wave) => sum + wave.directionCount * (wave.compositionPerDirection.hordeZombie + wave.compositionPerDirection.zombie), 0);
    const expectedPeriodicHorde = schedule.filter((wave) => !wave.final)
      .reduce((sum, wave) => sum + wave.directionCount * wave.compositionPerDirection.hordeZombie, 0);
    const expectedPeriodicNonHorde = schedule.filter((wave) => !wave.final)
      .reduce((sum, wave) => sum + wave.directionCount * wave.compositionPerDirection.zombie, 0);
    const expectedFinalHorde = schedule.filter((wave) => wave.final)
      .reduce((sum, wave) => sum + wave.directionCount * wave.compositionPerDirection.hordeZombie, 0);
    const expectedFinalNonHorde = schedule.filter((wave) => wave.final)
      .reduce((sum, wave) => sum + wave.directionCount * wave.compositionPerDirection.zombie, 0);
    expect(finalGroup).toHaveLength(expectedFinalSpawned);
    const finalProgress = cloneState(engine.getState());
    finalProgress.units = finalProgress.units.filter((unit) => !unit.spawnGroupId || !finalIds.includes(unit.spawnGroupId) || unit.id === finalGroup[0]!.id);
    expect(deriveVictoryProgress(finalProgress).finalHordeDefeated).toBe(false);
    finalProgress.units = finalProgress.units.filter((unit) => !unit.spawnGroupId || !finalIds.includes(unit.spawnGroupId));
    expect(deriveVictoryProgress(finalProgress).finalHordeDefeated).toBe(true);
    expect(finalEvents).toContainEqual(expect.objectContaining({
      type: 'horde_spawned',
      payload: expect.objectContaining({ hordeKind: 'final', waveIndex: 5, directions: ['north', 'east', 'south', 'west'] }),
    }));
    expect(engine.getState().horde).toMatchObject({ finalSpawnedCount: expectedFinalSpawned, totalSpawned: expectedTotalSpawned });
    const statistics = engine.getState().statistics;
    const finalSpecial = Object.values(statistics.finalSpecialZombiesSpawnedByType).reduce((sum, value) => sum + value, 0);
    const allSpecial = Object.values(statistics.hordeSpecialSpawnedByType).reduce((sum, value) => sum + value, 0);
    expect(statistics).toMatchObject({
      periodicHordeZombiesSpawned: expectedPeriodicHorde,
      finalHordeZombiesSpawned: expectedFinalHorde,
      finalHordeSpawned: expectedFinalSpawned,
    });
    expect(statistics.periodicNormalZombiesSpawned + allSpecial - finalSpecial).toBe(expectedPeriodicNonHorde);
    expect(statistics.finalNormalZombiesSpawned + finalSpecial).toBe(expectedFinalNonHorde);
  }, 60_000);

  it('uses custom per-type composition arithmetic for Periodic and Final groups', () => {
    const engine = new GameEngine(303, safeScenarioConfig({
      horde: {
        warningLeadTurns: 1,
        specialZombieWeights: { zombie: 100, policeZombie: 0, soldierZombie: 0, riotZombie: 0 },
        waves: [
          { turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 3, zombie: 2 }, final: false },
          { turn: 2, directionCount: 1, compositionPerDirection: { hordeZombie: 5, zombie: 3 }, final: false },
          { turn: 3, directionCount: 1, compositionPerDirection: { hordeZombie: 4, zombie: 3 }, final: true },
        ],
      },
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    }));

    for (let index = 0; index < 3; index += 1) expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const state = engine.getState();
    const first = state.units.filter((unit) => unit.spawnGroupId === 'wave-1-north' || unit.spawnGroupId === 'wave-1-east' || unit.spawnGroupId === 'wave-1-south' || unit.spawnGroupId === 'wave-1-west');
    const second = state.units.filter((unit) => unit.spawnGroupId === 'wave-2-north' || unit.spawnGroupId === 'wave-2-east' || unit.spawnGroupId === 'wave-2-south' || unit.spawnGroupId === 'wave-2-west');
    const final = state.units.filter((unit) => unit.spawnGroupId !== null && state.horde.finalSpawnGroupIds.includes(unit.spawnGroupId));
    expect([first.filter((unit) => unit.type === 'hordeZombie').length, first.filter((unit) => unit.type === 'zombie').length]).toEqual([3, 2]);
    expect([second.filter((unit) => unit.type === 'hordeZombie').length, second.filter((unit) => unit.type === 'zombie').length]).toEqual([5, 3]);
    expect([final.filter((unit) => unit.type === 'hordeZombie').length, final.filter((unit) => unit.type === 'zombie').length]).toEqual([4, 3]);
  });

  it('counts Final Normal Zombies as Final members and in both kill metrics', () => {
    const engine = new GameEngine(304, safeScenarioConfig({
      horde: {
        ...singleFinalWave(1, { hordeZombie: 1, zombie: 1 }),
        specialZombieWeights: { zombie: 100, policeZombie: 0, soldierZombie: 0, riotZombie: 0 },
      },
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    }));
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const spawned = cloneState(engine.getState());
    const finalGroupId = spawned.horde.finalSpawnGroupIds[0]!;
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
      horde: singleFinalWave(12, { hordeZombie: 2, zombie: 1 }),
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
      horde: singleFinalWave(30),
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
