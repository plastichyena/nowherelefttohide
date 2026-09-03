import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { singleFinalWave } from './testConfig';
import { deriveVictoryProgress, GameEngine } from './engine';
import { hexKey, hexNeighbors } from './hex';
import { createUnit } from './state';
import { isHexSuppliedByBranch } from './supply';
import { getPlayerVisibleTileKeys } from './visibility';
import type { GameState } from './types';

describe('v1.4 zombie, Final Horde and victory flow', () => {
  it('rejects corrupted v1.4 Horde and metric snapshot fields without changing the live state', () => {
    const engine = new GameEngine(23, createDefaultConfig());
    const before = engine.getState();
    const corrupted = JSON.parse(JSON.stringify(before)) as GameState;
    (corrupted.horde as unknown as { finalHordeStatus: string }).finalHordeStatus = 'bogus';
    (corrupted.statistics as unknown as { finalHordeDefeated: string }).finalHordeDefeated = 'bogus';
    (corrupted.statistics as unknown as { terrainEntriesByType: object }).terrainEntriesByType = {};
    const result = engine.step({ type: 'LoadSnapshot', snapshot: corrupted });
    expect(result.error?.code).toBe('invalid_snapshot');
    expect(engine.getState()).toEqual(before);
  });

  it('idles normal zombies without visible or inherited targets', () => {
    const engine = new GameEngine(7, createDefaultConfig());
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.events.filter((event) => event.type === 'zombie_idle').length).toBeGreaterThan(0);
    expect(result.state.statistics.normalZombieIdleCount).toBeGreaterThan(0);
  });

  it('spawns the Final Horde after its configured zombie phase and lets it act next turn', () => {
    const config = createDefaultConfig({
      horde: singleFinalWave(1),
    });
    const engine = new GameEngine(3, config);
    const spawn = engine.step({ type: 'EndTurn' });
    expect(spawn.error).toBeNull();
    expect(spawn.gameOver).toBe(false);
    expect(spawn.state.turn).toBe(2);
    expect(spawn.state.horde.finalHordeStatus).toBe('active');
    expect(spawn.state.horde.turnsRemaining).toBe(0);
    const finalUnit = spawn.state.units.find((unit) => unit.hordeKind === 'final')!;
    expect(finalUnit.type).toBe('hordeZombie');
    const origin = { ...finalUnit.position };

    const next = engine.step({ type: 'EndTurn' });
    expect(next.error).toBeNull();
    expect(next.state.units.find((unit) => unit.id === finalUnit.id)?.position).not.toEqual(origin);
    expect(next.state.statistics.turnsAfterFinalHorde).toBe(2);
  });

  it('wins immediately after an accepted action when all three current-supply conditions are met', () => {
    const config = createDefaultConfig({
      horde: singleFinalWave(1),
    });
    const engine = new GameEngine(11, config);
    engine.step({ type: 'EndTurn' });
    const snapshot = engine.getState();
    const editable = JSON.parse(JSON.stringify(snapshot)) as GameState;
    const finalZombie = editable.units.find((unit) => unit.hordeKind === 'final')!;
    editable.units = editable.units.filter((unit) => unit.isPlayerUnit || unit.id === finalZombie.id);
    const guard = editable.units.find((unit) => unit.type === 'nationalGuard')!;
    const occupied = new Set(editable.units.filter((unit) => unit.id !== finalZombie.id).map((unit) => hexKey(unit.position)));
    finalZombie.position = hexNeighbors(guard.position).find((position) =>
      editable.map.tiles.some((tile) => tile.q === position.q && tile.r === position.r) && !occupied.has(hexKey(position)),
    )!;
    finalZombie.hp = 1;
    expect(deriveVictoryProgress(editable)).toMatchObject({
      finalHordeDefeated: false,
      suppliedAreaZombieClear: false,
      suppliedAreaInfectionClear: true,
    });
    expect(engine.step({ type: 'LoadSnapshot', snapshot: editable }).error).toBeNull();
    const result = engine.step({ type: 'Attack', attackerId: guard.id, targetId: finalZombie.id });
    expect(result.error).toBeNull();
    expect(result.result).toMatchObject({ outcome: 'won', reason: 'stateSecured', turn: 2 });
    expect(result.state.horde.finalHordeStatus).toBe('defeated');
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'victory_progress_changed',
      payload: {
        finalHordeDefeated: true,
        suppliedAreaZombieClear: true,
        suppliedAreaInfectionClear: true,
      },
    }));
  });

  it('emits a discovery event when movement expands player visibility', () => {
    const config = createDefaultConfig({ units: { police: { vision: 1 } } });
    const engine = new GameEngine(19, config);
    const editable = JSON.parse(JSON.stringify(engine.getState())) as GameState;
    const police = editable.units.find((unit) => unit.type === 'police')!;
    const zombie = editable.units.find((unit) => unit.id === 'zombie-1')!;
    zombie.position = { q: 31, r: 25 };
    zombie.canAttack = false;
    police.position = { q: 29, r: 25 };
    const guard = editable.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 1, r: 1 };
    guard.vision = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: editable }).error).toBeNull();

    const result = engine.step({ type: 'Move', unitId: police.id, destination: { q: 30, r: 25 } });
    expect(result.error).toBeNull();
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'enemy_spotted',
      payload: expect.objectContaining({ unitId: 'zombie-1', q: 31, r: 25 }),
    }));
  });

  it('does not leak a hidden enemy through legal movement and stops before its occupied hex', () => {
    const config = createDefaultConfig({ units: { police: { vision: 0 } } });
    const engine = new GameEngine(5, config);
    const editable = JSON.parse(JSON.stringify(engine.getState()));
    const police = editable.units.find((unit: { type: string }) => unit.type === 'police');
    const zombie = editable.units.find((unit: { id: string }) => unit.id === 'zombie-1');
    zombie.position = { q: 31, r: 25 };
    zombie.canAttack = true;
    police.position = { q: 29, r: 25 };
    const guard = editable.units.find((unit: { type: string }) => unit.type === 'nationalGuard');
    guard.position = { q: 1, r: 1 };
    guard.vision = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: editable }).error).toBeNull();
    expect(engine.getLegalActions()).toContainEqual({ type: 'Move', unitId: police.id, destination: { q: 31, r: 25 } });
    expect(engine.getLegalActions().some((action) => action.type === 'Attack' && action.targetId === 'zombie-1')).toBe(false);

    const result = engine.step({ type: 'Move', unitId: police.id, destination: { q: 31, r: 25 } });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === police.id)?.position).toEqual({ q: 30, r: 25 });
    expect(new Set(result.state.units.map((unit) => `${unit.position.q},${unit.position.r}`)).size).toBe(result.state.units.length);
  });

  it('snapshots Horde targets and propagates only their target coordinate to normal zombies', () => {
    const config = createDefaultConfig({ horde: singleFinalWave(30) });
    const engine = new GameEngine(13, config);
    const editable = JSON.parse(JSON.stringify(engine.getState()));
    editable.units = editable.units.filter((unit: { isPlayerUnit: boolean }) => unit.isPlayerUnit);
    const normal = createUnit(editable, 'zombie-test', 'zombie', { q: 23, r: 23 });
    normal.vision = 1;
    const horde = createUnit(editable, 'horde-test', 'hordeZombie', { q: 24, r: 23 });
    horde.vision = 0;
    editable.units.find((unit: { type: string }) => unit.type === 'police')!.position = { q: 1, r: 1 };
    editable.units.find((unit: { type: string }) => unit.type === 'nationalGuard')!.position = { q: 48, r: 48 };
    editable.units.find((unit: { type: string }) => unit.type === 'police')!.vision = 0;
    editable.units.find((unit: { type: string }) => unit.type === 'nationalGuard')!.vision = 0;
    horde.spawnGroupId = 'periodic-test';
    horde.hordeKind = 'periodic';
    editable.units.push(normal, horde);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: editable }).error).toBeNull();

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === normal.id)?.inheritedTarget).toEqual({ q: 25, r: 25 });
    expect(result.state.statistics.hordeTargetInheritedCount).toBe(1);
  });

  it('allows checkpoint expansion when its only blocker is a hidden zombie', () => {
    const config = createDefaultConfig({
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { capital: 50 },
    });
    const engine = new GameEngine(17, config);
    const editable = JSON.parse(JSON.stringify(engine.getState()));
    editable.units = editable.units.filter((unit: { isPlayerUnit: boolean }) => unit.isPlayerUnit);
    const target = { q: 25, r: 1 };
    const visible = getPlayerVisibleTileKeys(editable);
    const occupied = new Set([
      ...editable.facilities.map((facility: { position: { q: number; r: number } }) => hexKey(facility.position)),
      ...editable.units.map((unit: { position: { q: number; r: number } }) => hexKey(unit.position)),
    ]);
    const hiddenBlocker = editable.map.tiles.find((tile: {
      key: string;
      playerOccupancyAllowed: boolean;
      hordeEntranceDirections: string[];
      q: number;
      r: number;
    }) => !visible.has(tile.key)
      && tile.playerOccupancyAllowed
      && !occupied.has(tile.key)
      && tile.hordeEntranceDirections.length === 0
      && isHexSuppliedByBranch(editable, tile, 'north', target));
    expect(hiddenBlocker).toBeDefined();
    editable.units.push(createUnit(editable, 'zombie-hidden', 'zombie', hiddenBlocker!));
    expect(engine.step({ type: 'LoadSnapshot', snapshot: editable }).error).toBeNull();
    const action = { type: 'BuildCheckpoint', branchId: 'north', position: target } as const;
    expect(engine.getLegalActions()).toContainEqual(action);
    expect(engine.step(action).error).toBeNull();
  });
});
