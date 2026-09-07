import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { getHordeSpawnZone } from './map';
import { createCityPopulationSnapshot, createUnit, synchronizePopulation } from './state';
import type { GameState } from './types';

const config = (units: number, final = false) => createDefaultConfig({
  economy: {
    initialZombieCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
    initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 },
  },
  horde: {
    waves: [{
      turn: 1,
      directionCount: 1,
      compositionPerDirection: { hordeZombie: Math.min(5, units), zombie: Math.max(0, units - 5) },
      final,
    }],
  },
});

function load(engine: GameEngine, state: GameState): void {
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
}

describe('v1.5.4 scheduled Wave pending roster', () => {
  it('freezes all 30 entries, exposes committed counts, and drains the 22-Hex zone over multiple Horde phases', () => {
    const engine = new GameEngine(154, config(30, true));
    const first = engine.step({ type: 'EndTurn' });
    expect(first.error).toBeNull();
    const wave = first.state.horde.waves[0]!;
    expect(wave).toMatchObject({ baseWaveUnitCount: 30, committedWaveUnitCount: 30, spawnedSoFar: 22, pendingCount: 8 });
    expect(first.state.horde.pendingWaves[0]?.roster).toHaveLength(8);
    expect(first.events.filter((event) => event.type === 'horde_wave_started')).toHaveLength(1);
    expect(first.events.find((event) => event.type === 'horde_spawn_batch')?.payload).toMatchObject({
      spawnedThisBatch: 22, spawnedSoFar: 22, pendingCount: 8,
    });
    const groupId = wave.groupId;
    const zone = new Set(getHordeSpawnZone(first.state.map, wave.direction).map(({ q, r }) => `${q},${r}`));
    const firstBatch = first.state.units.filter((unit) => unit.spawnGroupId === groupId);
    expect(firstBatch).toHaveLength(22);
    expect(firstBatch.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(3);
    expect(firstBatch.every((unit) => zone.has(`${unit.position.q},${unit.position.r}`))).toBe(true);
    expect(firstBatch.every((unit) => unit.canMove && unit.canAttack)).toBe(true); // armed only at the next Player Turn start
    expect(firstBatch.filter((unit) => unit.type !== 'hordeZombie').every((unit) =>
      unit.waveCapitalAnchor?.q === 25 && unit.waveCapitalAnchor.r === 25 && unit.noiseTarget === null,
    )).toBe(true);
    const firstPositions = new Map(firstBatch.map((unit) => [unit.id, `${unit.position.q},${unit.position.r}`]));

    const second = engine.step({ type: 'EndTurn' });
    expect(second.error).toBeNull();
    expect(second.state.horde.pendingWaves).toHaveLength(0);
    expect(second.state.horde.waves[0]).toMatchObject({ spawnedSoFar: 30, pendingCount: 0 });
    expect(second.state.units.filter((unit) => unit.spawnGroupId === groupId)).toHaveLength(30);
    expect(second.state.units.some((unit) => firstPositions.has(unit.id)
      && firstPositions.get(unit.id) !== `${unit.position.q},${unit.position.r}`)).toBe(true);
  });

  it('starts a Final Wave with zero placements, keeps its roster pending, and does not declare victory', () => {
    const engine = new GameEngine(155, config(5, true));
    const state = engine.getState() as GameState;
    const direction = state.horde.warningDirections[0]!;
    for (const [index, position] of getHordeSpawnZone(state.map, direction).entries()) {
      const blocker = createUnit(state, `zone-blocker-${index}`, 'zombie', position);
      blocker.canMove = false;
      blocker.canAttack = false;
      state.units.push(blocker);
    }
    load(engine, state);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.horde.finalHordeStatus).toBe('active');
    expect(result.state.horde.waves[0]).toMatchObject({ committedWaveUnitCount: 5, spawnedSoFar: 0, pendingCount: 5 });
    expect(result.state.horde.pendingWaves[0]?.roster).toHaveLength(5);
    expect(result.state.units.some((unit) => unit.hordeKind === 'final')).toBe(false);
    expect(result.gameOver).toBe(false);
  });

  it('freezes rejected-refugee bonuses into the participating direction roster and resets its counters', () => {
    const bonusConfig = config(2, true);
    bonusConfig.horde.specialZombieWeights = {
      zombie: 0,
      policeZombie: 1,
      soldierZombie: 0,
      riotZombie: 0,
      hunterZombie: 0,
      gasZombie: 0,
    };
    const engine = new GameEngine(156, bonusConfig);
    const state = engine.getState() as GameState;
    const direction = state.horde.warningDirections[0]!;
    state.rejectedRefugeesByDirection[direction] = { normalRejected: 1, strictRejected: 2, turnedAway: 3 };
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.horde.waves[0]).toMatchObject({
      baseWaveUnitCount: 2,
      committedWaveUnitCount: 4,
      spawnedSoFar: 4,
      pendingCount: 0,
    });
    const groupId = result.state.horde.waves[0]!.groupId;
    expect(result.state.units.filter((unit) => unit.spawnGroupId === groupId).map((unit) => unit.type))
      .toEqual(['hordeZombie', 'hordeZombie', 'policeZombie', 'policeZombie']);
    expect(result.state.rejectedRefugeesByDirection[direction]).toEqual({ normalRejected: 0, strictRejected: 0, turnedAway: 0 });
    expect(result.events.find((event) => event.type === 'horde_rejected_bonus_applied')?.payload)
      .toMatchObject({ direction, rejectedTotal: 6, extraNormalZombies: 2 });
  });

  it('keeps a newer same-direction Wave pending while the older roster still has entries after its batch', () => {
    const multiConfig = createDefaultConfig({
      economy: {
        initialZombieCount: 0,
        initialHunterCount: { min: 0, max: 0 },
        initialGasCount: { min: 0, max: 0 },
        initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 },
      },
      horde: {
        waves: [
          { turn: 1, directionCount: 4, compositionPerDirection: { hordeZombie: 5, zombie: 0 }, final: false },
          { turn: 2, directionCount: 4, compositionPerDirection: { hordeZombie: 5, zombie: 0 }, final: true },
        ],
      },
    });
    const engine = new GameEngine(157, multiConfig);
    const state = engine.getState() as GameState;
    const direction = 'north' as const;
    for (const [index, position] of getHordeSpawnZone(state.map, direction).entries()) {
      const blocker = createUnit(state, `oldest-zone-blocker-${index}`, 'zombie', position);
      blocker.canMove = false;
      blocker.canAttack = false;
      blocker.attackChargesRemaining = 0;
      state.units.push(blocker);
    }
    load(engine, state);
    const first = engine.step({ type: 'EndTurn' });
    expect(first.state.horde.waves.find((wave) => wave.waveIndex === 1 && wave.direction === direction))
      .toMatchObject({ spawnedSoFar: 0, pendingCount: 5 });

    const turnTwo = first.state as GameState;
    turnTwo.units = turnTwo.units.filter((unit) => ![
      'oldest-zone-blocker-0', 'oldest-zone-blocker-1', 'oldest-zone-blocker-2', 'oldest-zone-blocker-3',
    ].includes(unit.id));
    load(engine, turnTwo);
    const second = engine.step({ type: 'EndTurn' });
    expect(second.error).toBeNull();
    expect(second.state.horde.waves.find((wave) => wave.waveIndex === 1 && wave.direction === direction))
      .toMatchObject({ spawnedSoFar: 3, pendingCount: 2 });
    expect(second.state.horde.waves.find((wave) => wave.waveIndex === 2 && wave.direction === direction))
      .toMatchObject({ spawnedSoFar: 0, pendingCount: 5 });

    const turnThree = second.state as GameState;
    const openedBlockers = new Set(Array.from({ length: 8 }, (_, index) => `oldest-zone-blocker-${index + 4}`));
    turnThree.units = turnThree.units.filter((unit) => !openedBlockers.has(unit.id));
    load(engine, turnThree);
    const third = engine.step({ type: 'EndTurn' });
    expect(third.error).toBeNull();
    expect(third.state.horde.waves.find((wave) => wave.waveIndex === 1 && wave.direction === direction))
      .toMatchObject({ spawnedSoFar: 5, pendingCount: 0 });
    expect(third.state.horde.waves.find((wave) => wave.waveIndex === 2 && wave.direction === direction))
      .toMatchObject({ spawnedSoFar: 5, pendingCount: 0 });
  });
});
