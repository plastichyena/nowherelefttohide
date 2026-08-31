import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey } from './hex';
import {
  FIXED_FACILITY_COUNT,
  FIXED_FACILITY_IDS,
  FIXED_FOREST_COORDINATES,
  FIXED_FOREST_SEED_COORDINATES,
  FIXED_INITIAL_UNIT_POSITIONS,
  FIXED_INITIAL_ZOMBIE_POSITIONS,
  FIXED_MAP,
  FIXED_MAP_HEIGHT,
  FIXED_MAP_ID,
  FIXED_MAP_WIDTH,
  FIXED_MOUNTAIN_COORDINATES,
  FIXED_MOUNTAIN_SEED_COORDINATES,
  createFixedMap,
  validateFixedMap,
} from './map';

const key = ({ q, r }: { q: number; r: number }) => `${q},${r}`;
const at = (q: number, r: number) => FIXED_MAP.tiles.find((tile) => tile.q === q && tile.r === r);
const rotate = ({ q, r }: { q: number; r: number }) => ({ q: 30 - q, r: 30 - r });

describe('v1.4.0 fixed map', () => {
  it('uses the 31x31 fixed map contract and covers every hex exactly once', () => {
    expect(FIXED_MAP_ID).toBe('fixed-31x31-v1');
    expect(FIXED_MAP.width).toBe(FIXED_MAP_WIDTH);
    expect(FIXED_MAP.height).toBe(FIXED_MAP_HEIGHT);
    expect(FIXED_MAP.tiles).toHaveLength(31 * 31);
    expect(new Set(FIXED_MAP.tiles.map((tile) => tile.key)).size).toBe(31 * 31);
    expect(FIXED_MAP.tiles.every((tile) => tile.terrain !== 'water')).toBe(true);

    const counts = FIXED_MAP.tiles.reduce<Record<string, number>>((result, tile) => {
      result[tile.terrain] = (result[tile.terrain] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({ plain: 720, forest: 197, mountain: 44 });
    expect(new Set(FIXED_MOUNTAIN_COORDINATES.map(key)).size).toBe(44);
    expect(new Set(FIXED_FOREST_COORDINATES.map(key)).size).toBe(197);
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

    // Raw Forest contains the civilian factory coordinate; Road/Facility
    // exclusion must win over the earlier terrain sets and leave Plain.
    expect(forestSeedKeys.has('25,16')).toBe(true);
    expect(at(25, 16)).toMatchObject({ terrain: 'plain', road: false, facilityId: 'civilian-factory-2' });
    for (const tile of FIXED_MAP.tiles) {
      if (tile.road || tile.facilityId !== null) expect(tile.terrain).toBe('plain');
    }
  });

  it('has the fixed center, four entrances, and four 15-hex road branches', () => {
    expect(at(15, 15)).toMatchObject({ road: true, facilityId: 'capital', terrain: 'plain' });
    expect(FIXED_MAP.roadTiles).toHaveLength(61);
    expect(new Set(FIXED_MAP.roadTiles.map(key)).size).toBe(61);
    expect(FIXED_MAP.roadTiles.every(({ q, r }) => q === 15 || r === 15)).toBe(true);

    const branches = new Map(FIXED_MAP.roadBranches.map((branch) => [branch.id, branch]));
    const entrances = new Map(FIXED_MAP.hordeEntrances.map((entrance) => [entrance.direction, entrance]));
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      const branch = branches.get(direction);
      const entrance = entrances.get(direction);
      expect(branch).toBeDefined();
      expect(entrance).toBeDefined();
      expect(branch!.capitalConnection).toEqual({ q: 15, r: 15 });
      expect(branch!.roadTiles).toHaveLength(15);
      expect(entrance!.roadTiles).toHaveLength(15);
      expect(branch!.entrance).toEqual(entrance!.tile);
      expect(branch!.roadTiles.at(-1)).toEqual(entrance!.tile);
      expect(branch!.roadTiles.every((position) => at(position.q, position.r)?.road)).toBe(true);
      expect(entrance!.roadTiles.every((position) => at(position.q, position.r)?.road)).toBe(true);
      expect(hexDistance(entrance!.tile, { q: 15, r: 15 })).toBe(15);
    }
    expect([...entrances.values()].map((entrance) => entrance.tile)).toEqual([
      { q: 15, r: 0 },
      { q: 30, r: 15 },
      { q: 15, r: 30 },
      { q: 0, r: 15 },
    ]);
  });

  it('contains the 17 permanent facilities at the specified coordinates', () => {
    expect(FIXED_MAP.facilities).toHaveLength(FIXED_FACILITY_COUNT);
    expect(FIXED_MAP.facilities.map((facility) => facility.id)).toEqual(FIXED_FACILITY_IDS);
    const expected = {
      capital: ['capital', 15, 15, true],
      'city-1': ['city', 15, 8, false],
      'city-2': ['city', 22, 15, false],
      'city-3': ['city', 15, 22, false],
      'city-4': ['city', 8, 15, false],
      'farm-1': ['farm', 13, 15, true],
      'farm-2': ['farm', 14, 4, false],
      'farm-3': ['farm', 16, 26, false],
      'civilian-factory-1': ['civilianFactory', 17, 15, true],
      'civilian-factory-2': ['civilianFactory', 25, 16, false],
      'military-factory-1': ['militaryFactory', 26, 15, false],
      'military-factory-2': ['militaryFactory', 4, 15, false],
      'refinery-1': ['refinery', 15, 13, true],
      'refinery-2': ['refinery', 14, 6, false],
      'power-plant-1': ['powerPlant', 15, 17, true],
      'power-plant-2': ['powerPlant', 16, 24, false],
      'wind-power-plant-1': ['windPowerPlant', 16, 14, true],
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

  it('publishes canonical initial Unit positions and six safe Normal Zombie positions', () => {
    expect(FIXED_INITIAL_UNIT_POSITIONS).toEqual({
      police: { q: 14, r: 15 },
      nationalGuard: { q: 16, r: 15 },
    });
    expect(FIXED_INITIAL_ZOMBIE_POSITIONS).toEqual([
      { q: 9, r: 9 },
      { q: 21, r: 21 },
      { q: 21, r: 9 },
      { q: 9, r: 21 },
      { q: 15, r: 6 },
      { q: 15, r: 24 },
    ]);
    expect(FIXED_MAP.initialZombiePositions).toEqual(FIXED_INITIAL_ZOMBIE_POSITIONS);
    const ownedFacilities = FIXED_MAP.facilities.filter((facility) => facility.startingOwned);
    const ownedKeys = new Set(ownedFacilities.map((facility) => hexKey(facility.position)));
    for (const zombie of FIXED_MAP.initialZombiePositions) {
      expect(ownedKeys.has(hexKey(zombie))).toBe(false);
      expect(Math.min(...ownedFacilities.map((facility) => hexDistance(zombie, facility.position)))).toBeGreaterThanOrEqual(4);
      // Current Zombie movement is three hexes; every initial facility remains
      // unreachable during the first Zombie turn by distance alone.
      expect(Math.min(...ownedFacilities.map((facility) => hexDistance(zombie, facility.position)))).toBeGreaterThan(3);
    }
  });

  it('keeps starting Supply open for construction and extension bands populated', () => {
    const capital = { q: 15, r: 15 };
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

    const branchByDirection = new Map(FIXED_MAP.roadBranches.map((branch) => [branch.direction, branch]));
    for (const branch of branchByDirection.values()) {
      for (let radius = 6; radius <= 15; radius += 1) {
        const candidates = FIXED_MAP.tiles.filter((tile) => {
          if (tile.terrain !== 'plain' || tile.road || tile.facilityId !== null) return false;
          if (hexDistance(capital, tile) !== radius) return false;
          const distances = FIXED_MAP.roadBranches.map((other) =>
            Math.min(...other.roadTiles.map((roadTile) => hexDistance(tile, roadTile))),
          );
          const branchDistance = Math.min(...branch.roadTiles.map((roadTile) => hexDistance(tile, roadTile)));
          return branchDistance === Math.min(...distances);
        });
        expect(candidates.length, `${branch.direction} radius ${radius}`).toBeGreaterThanOrEqual(2);
      }
    }
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
