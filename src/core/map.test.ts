import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey } from './hex';
import {
  FIXED_FACILITY_COUNT,
  FIXED_FACILITY_IDS,
  FIXED_FOREST_COORDINATES,
  FIXED_FOREST_SEED_COORDINATES,
  FIXED_INITIAL_ZOMBIE_COUNT,
  FIXED_INITIAL_UNIT_POSITIONS,
  FIXED_INITIAL_ZOMBIE_POSITIONS,
  FIXED_MAP,
  FIXED_MAP_HEIGHT,
  FIXED_MAP_ID,
  FIXED_MAP_WIDTH,
  FIXED_MOUNTAIN_COORDINATES,
  FIXED_MOUNTAIN_SEED_COORDINATES,
  canPlayerOccupyHex,
  createFixedMap,
  generateInitialZombiePositions,
  getInitialZombieCandidates,
  isHordeSpawnReserve,
  validateFixedMap,
} from './map';

const key = ({ q, r }: { q: number; r: number }) => `${q},${r}`;
const at = (q: number, r: number) => FIXED_MAP.tiles.find((tile) => tile.q === q && tile.r === r);
const rotate = ({ q, r }: { q: number; r: number }) => ({ q: 50 - q, r: 50 - r });

describe('v1.4.4 fixed map', () => {
  it('uses the 51x51 fixed map contract and covers every hex exactly once', () => {
    expect(FIXED_MAP_ID).toBe('fixed-51x51-v1');
    expect(FIXED_MAP.width).toBe(FIXED_MAP_WIDTH);
    expect(FIXED_MAP.height).toBe(FIXED_MAP_HEIGHT);
    expect(FIXED_MAP.tiles).toHaveLength(51 * 51);
    expect(new Set(FIXED_MAP.tiles.map((tile) => tile.key)).size).toBe(51 * 51);
    expect(FIXED_MAP.tiles.every((tile) => tile.terrain !== 'water')).toBe(true);

    const counts = FIXED_MAP.tiles.reduce<Record<string, number>>((result, tile) => {
      result[tile.terrain] = (result[tile.terrain] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({ plain: 1961, forest: 514, mountain: 126 });
    expect(new Set(FIXED_MOUNTAIN_COORDINATES.map(key)).size).toBe(126);
    expect(new Set(FIXED_FOREST_COORDINATES.map(key)).size).toBe(514);
    expect(new Set(FIXED_MOUNTAIN_COORDINATES.map(key).filter((coordinate) =>
      FIXED_FOREST_COORDINATES.some((forest) => key(forest) === coordinate),
    ))).toHaveLength(0);
  });

  it('applies the Mountain/Forest seed rotation and exclusion order', () => {
    const mountainSeedKeys = new Set(FIXED_MOUNTAIN_SEED_COORDINATES.map(key));
    const forestSeedKeys = new Set(FIXED_FOREST_SEED_COORDINATES.map(key));
    for (const seed of FIXED_MOUNTAIN_SEED_COORDINATES) {
      expect(mountainSeedKeys.has(key(rotate(seed)))).toBe(true);
    }
    for (const seed of FIXED_FOREST_SEED_COORDINATES) {
      expect(forestSeedKeys.has(key(rotate(seed)))).toBe(true);
    }

    // Road/Facility exclusion wins over the earlier terrain sets.
    for (const tile of FIXED_MAP.tiles) {
      if (tile.road || tile.facilityId !== null) expect(tile.terrain).toBe('plain');
    }
  });

  it('has the fixed center, four entrances, and four 25-hex road branches', () => {
    expect(at(25, 25)).toMatchObject({ road: true, facilityId: 'capital', terrain: 'plain' });
    expect(FIXED_MAP.roadTiles).toHaveLength(101);
    expect(new Set(FIXED_MAP.roadTiles.map(key)).size).toBe(101);
    expect(FIXED_MAP.roadTiles.every(({ q, r }) => q === 25 || r === 25)).toBe(true);

    const branches = new Map(FIXED_MAP.roadBranches.map((branch) => [branch.id, branch]));
    const entrances = new Map(FIXED_MAP.hordeEntrances.map((entrance) => [entrance.direction, entrance]));
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      const branch = branches.get(direction);
      const entrance = entrances.get(direction);
      expect(branch).toBeDefined();
      expect(entrance).toBeDefined();
      expect(branch!.capitalConnection).toEqual({ q: 25, r: 25 });
      expect(branch!.roadTiles).toHaveLength(25);
      expect(entrance!.roadTiles).toHaveLength(25);
      expect(branch!.entrance).toEqual(entrance!.tile);
      expect(branch!.roadTiles.at(-1)).toEqual(entrance!.tile);
      expect(branch!.roadTiles.every((position) => at(position.q, position.r)?.road)).toBe(true);
      expect(entrance!.roadTiles.every((position) => at(position.q, position.r)?.road)).toBe(true);
      expect(hexDistance(entrance!.tile, { q: 25, r: 25 })).toBe(25);
    }
    expect([...entrances.values()].map((entrance) => entrance.tile)).toEqual([
      { q: 25, r: 0 },
      { q: 50, r: 25 },
      { q: 25, r: 50 },
      { q: 0, r: 25 },
    ]);
  });

  it('publishes the 200-hex outer ring as the Horde Spawn Reserve', () => {
    expect(FIXED_MAP.hordeSpawnReserve).toHaveLength(200);
    expect(new Set(FIXED_MAP.hordeSpawnReserve.map(key)).size).toBe(200);
    for (const tile of FIXED_MAP.tiles) {
      const expected = tile.q === 0 || tile.q === 50 || tile.r === 0 || tile.r === 50;
      expect(isHordeSpawnReserve(FIXED_MAP, tile)).toBe(expected);
      expect(tile.playerOccupancyAllowed).toBe(!expected);
    }
  });

  it('uses the map Reserve collection as the single occupancy rule source', () => {
    const replaced = createFixedMap();
    replaced.hordeSpawnReserve = [{ q: 15, r: 15 }];
    expect(isHordeSpawnReserve(replaced, { q: 15, r: 15 })).toBe(true);
    expect(canPlayerOccupyHex(replaced, { q: 15, r: 15 })).toBe(false);
    expect(isHordeSpawnReserve(replaced, { q: 15, r: 0 })).toBe(false);
    expect(canPlayerOccupyHex(replaced, { q: 15, r: 0 })).toBe(true);
  });

  it('contains the 29 permanent facilities at the specified coordinates', () => {
    expect(FIXED_MAP.facilities).toHaveLength(FIXED_FACILITY_COUNT);
    expect(FIXED_MAP.facilities.map((facility) => facility.id)).toEqual(FIXED_FACILITY_IDS);
    const expected = {
      capital: ['capital', 25, 25, true],
      'city-1': ['city', 25, 20, false],
      'city-2': ['city', 24, 8, false],
      'city-3': ['city', 33, 25, false],
      'city-4': ['city', 43, 24, false],
      'city-5': ['city', 25, 34, false],
      'city-6': ['city', 26, 43, false],
      'city-7': ['city', 16, 25, false],
      'city-8': ['city', 7, 26, false],
      'farm-1': ['farm', 23, 25, true],
      'farm-2': ['farm', 21, 11, false],
      'farm-3': ['farm', 39, 20, false],
      'farm-4': ['farm', 29, 39, false],
      'farm-5': ['farm', 10, 29, false],
      'civilian-factory-1': ['civilianFactory', 27, 25, true],
      'civilian-factory-2': ['civilianFactory', 29, 13, false],
      'civilian-factory-3': ['civilianFactory', 22, 38, false],
      'civilian-factory-4': ['civilianFactory', 11, 28, false],
      'military-factory-1': ['militaryFactory', 21, 25, false],
      'military-factory-2': ['militaryFactory', 22, 10, false],
      'military-factory-3': ['militaryFactory', 28, 40, false],
      'refinery-1': ['refinery', 25, 23, true],
      'refinery-2': ['refinery', 38, 21, false],
      'refinery-3': ['refinery', 25, 39, false],
      'refinery-4': ['refinery', 11, 30, false],
      'power-plant-1': ['powerPlant', 25, 27, true],
      'power-plant-2': ['powerPlant', 40, 22, false],
      'power-plant-3': ['powerPlant', 10, 28, false],
      'wind-power-plant-1': ['windPowerPlant', 26, 24, true],
    } as Record<string, [string, number, number, boolean]>;
    for (const facility of FIXED_MAP.facilities) {
      const definition = expected[facility.id]!;
      expect([facility.type, facility.position.q, facility.position.r, facility.startingOwned]).toEqual(definition);
      expect(at(facility.position.q, facility.position.r)?.facilityId).toBe(facility.id);
    }
    expect(FIXED_MAP.facilities.filter((facility) => facility.startingOwned).map((facility) => facility.id)).toEqual([
      'capital',
      'farm-1',
      'civilian-factory-1',
      'refinery-1',
      'power-plant-1',
      'wind-power-plant-1',
    ]);
    expect(FIXED_MAP.facilities.reduce((sum, facility) => sum + facility.startingWorkers, 0)).toBe(100);
    expect(FIXED_MAP.facilities.find((facility) => facility.id === 'wind-power-plant-1')).toMatchObject({
      startingWorkers: 0,
      workerCapacity: 0,
    });
  });

  it('publishes canonical initial Unit positions and seed-selected safe Normal Zombies', () => {
    expect(FIXED_INITIAL_UNIT_POSITIONS).toEqual({
      police: { q: 24, r: 25 },
      nationalGuard: { q: 26, r: 25 },
    });
    expect(FIXED_INITIAL_ZOMBIE_POSITIONS).toHaveLength(FIXED_INITIAL_ZOMBIE_COUNT);
    expect(FIXED_MAP.initialZombiePositions).toEqual(FIXED_INITIAL_ZOMBIE_POSITIONS);
    const occupiedStaticKeys = new Set([
      ...FIXED_MAP.facilities.map((facility) => hexKey(facility.position)),
      ...FIXED_MAP.roadTiles.map(hexKey),
      ...FIXED_MAP.hordeSpawnReserve.map(hexKey),
      ...Object.values(FIXED_INITIAL_UNIT_POSITIONS).map(hexKey),
    ]);
    const capital = { q: 25, r: 25 };
    for (const position of FIXED_INITIAL_ZOMBIE_POSITIONS) {
      expect(occupiedStaticKeys.has(hexKey(position))).toBe(false);
      expect(hexDistance(position, capital)).toBeGreaterThanOrEqual(9);
      expect(at(position.q, position.r)?.movementCost).not.toBeNull();
    }
    expect(new Set(FIXED_INITIAL_ZOMBIE_POSITIONS.map(hexKey)).size).toBe(FIXED_INITIAL_ZOMBIE_COUNT);
    expect(generateInitialZombiePositions(FIXED_MAP, 101)).toEqual(generateInitialZombiePositions(FIXED_MAP, 101));
    expect(generateInitialZombiePositions(FIXED_MAP, 101)).not.toEqual(generateInitialZombiePositions(FIXED_MAP, 102));
    expect(getInitialZombieCandidates(FIXED_MAP).length).toBeGreaterThan(FIXED_INITIAL_ZOMBIE_COUNT);
  });

  it('keeps starting Supply open for construction and extension bands populated', () => {
    const capital = { q: 25, r: 25 };
    const occupied = new Set([
      ...FIXED_MAP.facilities.map((facility) => hexKey(facility.position)),
      hexKey(FIXED_INITIAL_UNIT_POSITIONS.police),
      hexKey(FIXED_INITIAL_UNIT_POSITIONS.nationalGuard),
    ]);
    const staticBuildable = FIXED_MAP.tiles.filter((tile) => {
      const distance = hexDistance(capital, tile);
      return distance <= 5 && tile.terrain === 'plain' && !tile.road && !occupied.has(tile.key);
    });
    expect(staticBuildable.length).toBeGreaterThanOrEqual(12);

    expect(FIXED_MAP.tiles.filter((tile) =>
      tile.terrain === 'plain' && !tile.road && tile.facilityId === null
      && hexDistance(capital, tile) <= 5,
    ).length).toBeGreaterThanOrEqual(12);
  });

  it('validates the canonical map and returns independent snapshots', () => {
    expect(validateFixedMap(FIXED_MAP)).toEqual({ valid: true, errors: [] });
    const copy = createFixedMap();
    copy.tiles[0]!.road = !copy.tiles[0]!.road;
    copy.facilities[0]!.startingWorkers = 99;
    expect(copy.tiles[0]!.road).not.toBe(FIXED_MAP.tiles[0]!.road);
    expect(FIXED_MAP.facilities[0]!.startingWorkers).toBe(41);
  });
});
