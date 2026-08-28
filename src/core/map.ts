import { DEFAULT_MAP_ID } from './config';
import { hexKey, hexWithinBounds } from './hex';
import type {
  CardinalDirection,
  FacilityDefinition,
  FacilityType,
  FixedMap,
  HexCoord,
  HexTile,
  HordeEntrance,
  RoadBranchDefinition,
} from './types';

export const FIXED_MAP_ID = DEFAULT_MAP_ID;
export const FIXED_MAP_WIDTH = 15 as const;
export const FIXED_MAP_HEIGHT = 15 as const;
export const FIXED_FACILITY_COUNT = 16 as const;
export const STARTING_FACILITY_IDS = [
  'capital',
  'farm-1',
  'civilian-factory-1',
  'refinery-1',
  'power-plant-1',
] as const;

const ROAD_ROW = 7;
const ROAD_COLUMN = 7;

const facilitySpecs: Array<{
  id: string;
  type: FacilityType;
  position: HexCoord;
  startingOwned: boolean;
  startingWorkers: number;
}> = [
  { id: 'capital', type: 'capital', position: { q: 7, r: 7 }, startingOwned: true, startingWorkers: 41 },
  { id: 'city-1', type: 'city', position: { q: 7, r: 3 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-2', type: 'city', position: { q: 11, r: 7 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-3', type: 'city', position: { q: 7, r: 11 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-4', type: 'city', position: { q: 3, r: 7 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-1', type: 'farm', position: { q: 5, r: 7 }, startingOwned: true, startingWorkers: 23 },
  { id: 'farm-2', type: 'farm', position: { q: 6, r: 4 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-3', type: 'farm', position: { q: 9, r: 10 }, startingOwned: false, startingWorkers: 0 },
  {
    id: 'civilian-factory-1',
    type: 'civilianFactory',
    position: { q: 8, r: 7 },
    startingOwned: true,
    startingWorkers: 23,
  },
  {
    id: 'civilian-factory-2',
    type: 'civilianFactory',
    position: { q: 10, r: 5 },
    startingOwned: false,
    startingWorkers: 0,
  },
  {
    id: 'military-factory-1',
    type: 'militaryFactory',
    position: { q: 5, r: 5 },
    startingOwned: false,
    startingWorkers: 0,
  },
  {
    id: 'military-factory-2',
    type: 'militaryFactory',
    position: { q: 9, r: 7 },
    startingOwned: false,
    startingWorkers: 0,
  },
  { id: 'refinery-1', type: 'refinery', position: { q: 7, r: 9 }, startingOwned: true, startingWorkers: 10 },
  { id: 'refinery-2', type: 'refinery', position: { q: 4, r: 10 }, startingOwned: false, startingWorkers: 0 },
  {
    id: 'power-plant-1',
    type: 'powerPlant',
    position: { q: 7, r: 8 },
    startingOwned: true,
    startingWorkers: 3,
  },
  {
    id: 'power-plant-2',
    type: 'powerPlant',
    position: { q: 10, r: 10 },
    startingOwned: false,
    startingWorkers: 0,
  },
];

export const FIXED_FACILITY_IDS = facilitySpecs.map((facility) => facility.id) as readonly string[];

const capacityByType: Record<FacilityType, number> = {
  capital: 100,
  city: 50,
  farm: 25,
  civilianFactory: 25,
  militaryFactory: 25,
  refinery: 25,
  powerPlant: 25,
};

const cardinalDirections: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

function coord(q: number, r: number): HexCoord {
  return { q, r };
}

function roadKeySet(): Set<string> {
  const keys = new Set<string>();
  for (let q = 0; q < FIXED_MAP_WIDTH; q += 1) {
    keys.add(hexKey(coord(q, ROAD_ROW)));
  }
  for (let r = 0; r < FIXED_MAP_HEIGHT; r += 1) {
    keys.add(hexKey(coord(ROAD_COLUMN, r)));
  }
  return keys;
}

function createTiles(roads: Set<string>): HexTile[] {
  const tiles: HexTile[] = [];
  for (let r = 0; r < FIXED_MAP_HEIGHT; r += 1) {
    for (let q = 0; q < FIXED_MAP_WIDTH; q += 1) {
      const position = coord(q, r);
      const key = hexKey(position);
      const road = roads.has(key);
      tiles.push({
        key,
        q,
        r,
        terrain: road ? 'road' : 'land',
        road,
        movementCost: 1,
        facilityId: null,
        hordeEntranceDirections: [],
      });
    }
  }
  return tiles;
}

function createFacilities(): FacilityDefinition[] {
  return facilitySpecs.map((spec) => ({
    id: spec.id,
    type: spec.type,
    nameKey: `facility.${spec.type}`,
    position: { ...spec.position },
    workerCapacity: capacityByType[spec.type],
    startingOwned: spec.startingOwned,
    startingWorkers: spec.startingWorkers,
    startingInfected: 0,
  }));
}

function createEntrances(): HordeEntrance[] {
  return [
    {
      direction: 'north',
      tile: coord(ROAD_COLUMN, 0),
      roadTiles: Array.from({ length: FIXED_MAP_HEIGHT }, (_, index) => coord(ROAD_COLUMN, index)),
    },
    {
      direction: 'east',
      tile: coord(FIXED_MAP_WIDTH - 1, ROAD_ROW),
      roadTiles: Array.from({ length: FIXED_MAP_WIDTH }, (_, index) =>
        coord(FIXED_MAP_WIDTH - 1 - index, ROAD_ROW),
      ),
    },
    {
      direction: 'south',
      tile: coord(ROAD_COLUMN, FIXED_MAP_HEIGHT - 1),
      roadTiles: Array.from({ length: FIXED_MAP_HEIGHT }, (_, index) =>
        coord(ROAD_COLUMN, FIXED_MAP_HEIGHT - 1 - index),
      ),
    },
    {
      direction: 'west',
      tile: coord(0, ROAD_ROW),
      roadTiles: Array.from({ length: FIXED_MAP_WIDTH }, (_, index) => coord(index, ROAD_ROW)),
    },
  ];
}

function createRoadBranches(): RoadBranchDefinition[] {
  const capitalConnection = coord(ROAD_COLUMN, ROAD_ROW);
  return [
    {
      id: 'north',
      direction: 'north',
      capitalConnection,
      roadTiles: Array.from({ length: ROAD_ROW }, (_, index) => coord(ROAD_COLUMN, ROAD_ROW - 1 - index)),
      entrance: coord(ROAD_COLUMN, 0),
    },
    {
      id: 'east',
      direction: 'east',
      capitalConnection,
      roadTiles: Array.from({ length: FIXED_MAP_WIDTH - ROAD_COLUMN - 1 }, (_, index) => coord(ROAD_COLUMN + 1 + index, ROAD_ROW)),
      entrance: coord(FIXED_MAP_WIDTH - 1, ROAD_ROW),
    },
    {
      id: 'south',
      direction: 'south',
      capitalConnection,
      roadTiles: Array.from({ length: FIXED_MAP_HEIGHT - ROAD_ROW - 1 }, (_, index) => coord(ROAD_COLUMN, ROAD_ROW + 1 + index)),
      entrance: coord(ROAD_COLUMN, FIXED_MAP_HEIGHT - 1),
    },
    {
      id: 'west',
      direction: 'west',
      capitalConnection,
      roadTiles: Array.from({ length: ROAD_COLUMN }, (_, index) => coord(ROAD_COLUMN - 1 - index, ROAD_ROW)),
      entrance: coord(0, ROAD_ROW),
    },
  ];
}

function buildFixedMap(): FixedMap {
  const roads = roadKeySet();
  const tiles = createTiles(roads);
  const facilities = createFacilities();
  const hordeEntrances = createEntrances();
  const roadBranches = createRoadBranches();

  const tileByKey = new Map(tiles.map((tile) => [tile.key, tile]));
  for (const facility of facilities) {
    const tile = tileByKey.get(hexKey(facility.position));
    if (!tile) {
      throw new Error(`Facility ${facility.id} is outside the fixed map`);
    }
    if (tile.facilityId !== null) {
      throw new Error(`Facilities overlap on ${tile.key}`);
    }
    tile.facilityId = facility.id;
  }
  for (const entrance of hordeEntrances) {
    const tile = tileByKey.get(hexKey(entrance.tile));
    if (!tile) {
      throw new Error(`Horde entrance is outside the fixed map: ${hexKey(entrance.tile)}`);
    }
    if (!tile.road) {
      throw new Error(`Horde entrance must be on a road: ${hexKey(entrance.tile)}`);
    }
    tile.hordeEntranceDirections.push(entrance.direction);
  }

  return {
    id: FIXED_MAP_ID,
    width: FIXED_MAP_WIDTH,
    height: FIXED_MAP_HEIGHT,
    tiles,
    roadTiles: [...roads].map((key) => {
      const parsed = key.split(',').map(Number);
      return coord(parsed[0]!, parsed[1]!);
    }),
    facilities,
    hordeEntrances,
    roadBranches,
    initialZombiePositions: [coord(4, 4), coord(11, 3), coord(3, 11), coord(11, 10)],
  };
}

const baseFixedMap = buildFixedMap();

function cloneMap(map: FixedMap): FixedMap {
  return JSON.parse(JSON.stringify(map)) as FixedMap;
}

/** A template map for read-only inspection; use createFixedMap for game state. */
export const FIXED_MAP: FixedMap = cloneMap(baseFixedMap);

function canonicalMapJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry !== null && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record).sort().map((key) => [key, normalize(record[key])]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

const FIXED_MAP_CANONICAL_JSON = canonicalMapJson(baseFixedMap);

/** Return a fresh JSON-compatible copy for a new GameState. */
export function createFixedMap(): FixedMap {
  return cloneMap(baseFixedMap);
}

export function getTile(map: FixedMap, position: HexCoord): HexTile | undefined {
  if (!hexWithinBounds(position, map.width, map.height)) {
    return undefined;
  }
  return map.tiles.find((tile) => tile.q === position.q && tile.r === position.r);
}

export function getFacility(
  map: FixedMap,
  facilityId: string,
): FacilityDefinition | undefined {
  return map.facilities.find((facility) => facility.id === facilityId);
}

export function getHordeEntrance(
  map: FixedMap,
  direction: CardinalDirection,
): HordeEntrance | undefined {
  return map.hordeEntrances.find((entrance) => entrance.direction === direction);
}

export function isRoad(map: FixedMap, position: HexCoord): boolean {
  return getTile(map, position)?.road === true;
}

export interface FixedMapValidationResult {
  valid: boolean;
  errors: string[];
}

/** Structural guard used by tests and save loading. */
export function validateFixedMap(map: FixedMap): FixedMapValidationResult {
  const errors: string[] = [];
  if (!map || map.id !== FIXED_MAP_ID) {
    errors.push(`map id must be ${FIXED_MAP_ID}`);
  }
  if (map?.width !== FIXED_MAP_WIDTH || map?.height !== FIXED_MAP_HEIGHT) {
    errors.push('map must be exactly 15x15');
  }
  if (!Array.isArray(map?.tiles) || map.tiles.length !== FIXED_MAP_WIDTH * FIXED_MAP_HEIGHT) {
    errors.push('map must contain 225 tiles');
  }
  if (!Array.isArray(map?.facilities) || map.facilities.length !== FIXED_FACILITY_COUNT) {
    errors.push('map must contain exactly 16 facilities');
  }
  const seenTiles = new Set<string>();
  for (const tile of map?.tiles ?? []) {
    if (!hexWithinBounds(tile, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`tile outside bounds: ${tile.key}`);
    }
    if (seenTiles.has(tile.key)) {
      errors.push(`duplicate tile: ${tile.key}`);
    }
    seenTiles.add(tile.key);
    if (tile.movementCost !== 1) {
      errors.push(`tile movement cost must be 1: ${tile.key}`);
    }
  }
  const facilityPositions = new Set<string>();
  for (const facility of map?.facilities ?? []) {
    const key = hexKey(facility.position);
    if (facilityPositions.has(key)) {
      errors.push(`duplicate facility position: ${key}`);
    }
    facilityPositions.add(key);
    if (!hexWithinBounds(facility.position, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`facility outside bounds: ${facility.id}`);
    }
  }
  if (!Array.isArray(map?.hordeEntrances) || map.hordeEntrances.length !== 4) {
    errors.push('map must contain north/east/south/west Horde entrances');
  }
  if (!Array.isArray(map?.roadBranches) || map.roadBranches.length !== 4) {
    errors.push('map must contain four road branches');
  } else {
    const branchIds = new Set<string>();
    for (const branch of map.roadBranches) {
      if (branchIds.has(branch.id)) errors.push(`duplicate road branch: ${branch.id}`);
      branchIds.add(branch.id);
      if (branch.roadTiles.length === 0) errors.push(`road branch is empty: ${branch.id}`);
      for (const position of branch.roadTiles) {
        if (!isRoad(map, position)) errors.push(`road branch tile is not a road: ${branch.id}:${hexKey(position)}`);
        if (hexKey(position) === hexKey(branch.capitalConnection)) {
          errors.push(`road branch contains the capital intersection: ${branch.id}`);
        }
      }
      if (hexKey(branch.roadTiles.at(-1) ?? branch.capitalConnection) !== hexKey(branch.entrance)) {
        errors.push(`road branch must end at its entrance: ${branch.id}`);
      }
    }
  }
  if (map) {
    for (const direction of cardinalDirections) {
      const entrances = map.hordeEntrances.filter(
        (entrance) => entrance.direction === direction,
      );
      if (entrances.length !== 1) {
        errors.push(`map must contain one ${direction} Horde entrance`);
      } else if (!isRoad(map, entrances[0]!.tile)) {
        errors.push(`${direction} Horde entrance must be on a road`);
      }
    }
  }
  if (!Array.isArray(map?.initialZombiePositions) || map.initialZombiePositions.length !== 4) {
    errors.push('map must contain four initial zombie positions');
  }
  if (map && canonicalMapJson(map) !== FIXED_MAP_CANONICAL_JSON) {
    errors.push('map must match the fixed map template');
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidFixedMap(map: FixedMap): void {
  const result = validateFixedMap(map);
  if (!result.valid) {
    throw new Error(`Invalid fixed map: ${result.errors.join('; ')}`);
  }
}
