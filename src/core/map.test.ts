import { describe, expect, it } from 'vitest';
import { hexDistance } from './hex';
import { FIXED_FACILITY_COUNT, FIXED_MAP, createFixedMap, validateFixedMap } from './map';

describe('fixed map', () => {
  it('is a valid 15x15 map with 16 non-overlapping facilities', () => {
    expect(validateFixedMap(FIXED_MAP)).toEqual({ valid: true, errors: [] });
    expect(FIXED_MAP.tiles).toHaveLength(225);
    expect(FIXED_MAP.facilities).toHaveLength(FIXED_FACILITY_COUNT);
    expect(new Set(FIXED_MAP.facilities.map((facility) => `${facility.position.q},${facility.position.r}`)).size).toBe(16);
  });

  it('contains the specified facility composition and starting five', () => {
    const counts = FIXED_MAP.facilities.reduce<Record<string, number>>((result, facility) => {
      result[facility.type] = (result[facility.type] ?? 0) + 1;
      return result;
    }, {});
    expect(counts.capital).toBe(1);
    expect(counts.city).toBe(4);
    expect(counts.farm).toBe(3);
    expect(counts.civilianFactory).toBe(2);
    expect(counts.militaryFactory).toBe(2);
    expect(counts.refinery).toBe(2);
    expect(counts.powerPlant).toBe(2);
    expect(FIXED_MAP.facilities.filter((facility) => facility.startingOwned)).toHaveLength(5);
    expect(FIXED_MAP.facilities.reduce((sum, facility) => sum + facility.startingWorkers, 0)).toBe(100);
  });

  it('has a four-way road cross and one Horde entrance per cardinal direction', () => {
    expect(FIXED_MAP.roadTiles).toHaveLength(29);
    expect(FIXED_MAP.hordeEntrances.map((entrance) => entrance.direction).sort()).toEqual([
      'east',
      'north',
      'south',
      'west',
    ]);
    for (const entrance of FIXED_MAP.hordeEntrances) {
      const tile = FIXED_MAP.tiles.find(
        (candidate) => candidate.q === entrance.tile.q && candidate.r === entrance.tile.r,
      );
      expect(tile?.road).toBe(true);
      expect(entrance.roadTiles).toHaveLength(15);
    }
  });

  it('places the four initial zombies at least four hexes from every starting facility', () => {
    expect(FIXED_MAP.initialZombiePositions).toEqual([
      { q: 4, r: 4 },
      { q: 11, r: 3 },
      { q: 3, r: 11 },
      { q: 11, r: 10 },
    ]);
    const startingFacilities = FIXED_MAP.facilities.filter((facility) => facility.startingOwned);
    for (const zombie of FIXED_MAP.initialZombiePositions) {
      expect(Math.min(...startingFacilities.map((facility) => hexDistance(zombie, facility.position)))).toBeGreaterThanOrEqual(4);
    }
  });

  it('returns independent map snapshots', () => {
    const copy = createFixedMap();
    copy.tiles[0]!.road = !copy.tiles[0]!.road;
    copy.facilities[0]!.startingWorkers = 99;
    expect(copy.tiles[0]!.road).not.toBe(FIXED_MAP.tiles[0]!.road);
    expect(FIXED_MAP.facilities[0]!.startingWorkers).toBe(41);
  });
});
