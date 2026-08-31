import type {
  BaseTerrain,
  CardinalDirection,
  FacilityDefinition,
  FacilityType,
  FixedMap,
  HexCoord,
  HexTile,
  HordeEntrance,
  RoadBranchDefinition,
} from './types';
import { hexKey, hexWithinBounds } from './hex';

/**
 * The v1.4.0 map is intentionally data-only and deterministic. Keep the
 * identifier here rather than deriving it from caller config: map validation
 * and save loading must reject a different fixed-map contract.
 */
export const FIXED_MAP_ID = 'fixed-31x31-v1' as const;
export const FIXED_MAP_WIDTH = 31 as const;
export const FIXED_MAP_HEIGHT = 31 as const;
export const FIXED_FACILITY_COUNT = 17 as const;

/** Starting human unit locations belong to the initial-state contract rather
 * than the FixedMap shape, but exporting them keeps state creation and tests
 * on the same canonical coordinates. */
export const FIXED_INITIAL_UNIT_POSITIONS = {
  police: { q: 14, r: 15 },
  nationalGuard: { q: 16, r: 15 },
} as const;

export const FIXED_INITIAL_ZOMBIE_POSITIONS = [
  { q: 9, r: 9 },
  { q: 21, r: 21 },
  { q: 21, r: 9 },
  { q: 9, r: 21 },
  { q: 15, r: 6 },
  { q: 15, r: 24 },
] as const;

export const STARTING_FACILITY_IDS = [
  'capital',
  'farm-1',
  'civilian-factory-1',
  'refinery-1',
  'power-plant-1',
  'wind-power-plant-1',
] as const;

const CENTER = 15;
const ROAD_ROW = CENTER;
const ROAD_COLUMN = CENTER;
const cardinalDirections: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

const facilitySpecs: Array<{
  id: string;
  type: FacilityType;
  position: HexCoord;
  startingOwned: boolean;
  startingWorkers: number;
}> = [
  { id: 'capital', type: 'capital', position: { q: 15, r: 15 }, startingOwned: true, startingWorkers: 41 },
  { id: 'city-1', type: 'city', position: { q: 15, r: 8 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-2', type: 'city', position: { q: 22, r: 15 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-3', type: 'city', position: { q: 15, r: 22 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-4', type: 'city', position: { q: 8, r: 15 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-1', type: 'farm', position: { q: 13, r: 15 }, startingOwned: true, startingWorkers: 23 },
  { id: 'farm-2', type: 'farm', position: { q: 14, r: 4 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-3', type: 'farm', position: { q: 16, r: 26 }, startingOwned: false, startingWorkers: 0 },
  {
    id: 'civilian-factory-1',
    type: 'civilianFactory',
    position: { q: 17, r: 15 },
    startingOwned: true,
    startingWorkers: 23,
  },
  {
    id: 'civilian-factory-2',
    type: 'civilianFactory',
    position: { q: 25, r: 16 },
    startingOwned: false,
    startingWorkers: 0,
  },
  {
    id: 'military-factory-1',
    type: 'militaryFactory',
    position: { q: 26, r: 15 },
    startingOwned: false,
    startingWorkers: 0,
  },
  {
    id: 'military-factory-2',
    type: 'militaryFactory',
    position: { q: 11, r: 15 },
    startingOwned: false,
    startingWorkers: 0,
  },
  { id: 'refinery-1', type: 'refinery', position: { q: 15, r: 13 }, startingOwned: true, startingWorkers: 10 },
  { id: 'refinery-2', type: 'refinery', position: { q: 14, r: 6 }, startingOwned: false, startingWorkers: 0 },
  { id: 'power-plant-1', type: 'powerPlant', position: { q: 15, r: 17 }, startingOwned: true, startingWorkers: 3 },
  { id: 'power-plant-2', type: 'powerPlant', position: { q: 16, r: 24 }, startingOwned: false, startingWorkers: 0 },
  {
    id: 'wind-power-plant-1',
    type: 'windPowerPlant',
    position: { q: 16, r: 14 },
    startingOwned: true,
    startingWorkers: 0,
  },
];

export const FIXED_FACILITY_IDS = facilitySpecs.map((facility) => facility.id) as readonly string[];

/** Canonical worker capacities for the permanent facilities. */
const capacityByType: Record<string, number> = {
  capital: 100,
  city: 50,
  farm: 30,
  civilianFactory: 30,
  militaryFactory: 30,
  refinery: 30,
  powerPlant: 30,
  windPowerPlant: 0,
};

function coord(q: number, r: number): HexCoord {
  return { q, r };
}

function rotate180(position: HexCoord): HexCoord {
  return coord(FIXED_MAP_WIDTH - 1 - position.q, FIXED_MAP_HEIGHT - 1 - position.r);
}

function addRange(target: Set<string>, y: number, startX: number, endX: number): void {
  for (let x = startX; x <= endX; x += 1) target.add(hexKey(coord(x, y)));
}

function addRotated(target: Set<string>): void {
  for (const key of [...target]) {
    const [q, r] = key.split(',').map(Number);
    target.add(hexKey(rotate180(coord(q!, r!))));
  }
}

/**
 * Terrain seed coordinates are kept separate from the final terrain map so
 * the generation order is auditable: Mountain + rotation first, Forest +
 * rotation second, Mountain precedence, then Road/Facility exclusion.
 */
function createMountainSeedKeys(): Set<string> {
  const keys = new Set<string>();
  addRange(keys, 3, 8, 10);
  addRange(keys, 4, 7, 10);
  addRange(keys, 4, 20, 22);
  addRange(keys, 5, 7, 9);
  addRange(keys, 5, 21, 23);
  addRange(keys, 6, 6, 8);
  addRange(keys, 6, 22, 24);
  addRotated(keys);
  return keys;
}

function createForestSeedKeys(): Set<string> {
  const keys = new Set<string>();
  addRange(keys, 1, 2, 6);
  addRange(keys, 1, 24, 28);
  addRange(keys, 2, 2, 7);
  addRange(keys, 2, 23, 28);
  addRange(keys, 3, 3, 6);
  addRange(keys, 3, 24, 28);
  addRange(keys, 4, 2, 5);
  addRange(keys, 4, 24, 27);
  addRange(keys, 5, 3, 6);
  addRange(keys, 5, 25, 28);
  addRange(keys, 6, 2, 5);
  addRange(keys, 6, 25, 28);
  addRange(keys, 7, 3, 7);
  addRange(keys, 7, 23, 27);
  addRange(keys, 8, 3, 6);
  addRange(keys, 8, 24, 27);
  addRange(keys, 10, 4, 8);
  addRange(keys, 11, 3, 8);
  addRange(keys, 12, 4, 8);
  addRange(keys, 13, 5, 9);
  addRange(keys, 14, 4, 8);
  addRotated(keys);
  return keys;
}

function keyToCoord(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return coord(q!, r!);
}

function sortedCoordinates(keys: Iterable<string>): HexCoord[] {
  return [...keys].map(keyToCoord).sort((left, right) => left.q - right.q || left.r - right.r);
}

const MOUNTAIN_SEED_KEYS = createMountainSeedKeys();
const FOREST_SEED_KEYS = createForestSeedKeys();

/** Raw (pre-exclusion) terrain sets, exposed for deterministic map tests. */
export const FIXED_MOUNTAIN_SEED_COORDINATES = sortedCoordinates(MOUNTAIN_SEED_KEYS);
export const FIXED_FOREST_SEED_COORDINATES = sortedCoordinates(FOREST_SEED_KEYS);

function roadKeySet(): Set<string> {
  const keys = new Set<string>();
  for (let y = 0; y < FIXED_MAP_HEIGHT; y += 1) keys.add(hexKey(coord(ROAD_COLUMN, y)));
  for (let x = 0; x < FIXED_MAP_WIDTH; x += 1) keys.add(hexKey(coord(x, ROAD_ROW)));
  return keys;
}

const FIXED_FACILITY_POSITION_KEYS = new Set(
  facilitySpecs.map((facility) => hexKey(facility.position)),
);

function excludedTerrainKeys(roads: ReadonlySet<string>): Set<string> {
  return new Set([...roads, ...FIXED_FACILITY_POSITION_KEYS]);
}

function createTiles(roads: Set<string>): HexTile[] {
  const mountainKeys = MOUNTAIN_SEED_KEYS;
  const forestKeys = FOREST_SEED_KEYS;
  const excluded = excludedTerrainKeys(roads);
  const tiles: HexTile[] = [];
  for (let r = 0; r < FIXED_MAP_HEIGHT; r += 1) {
    for (let q = 0; q < FIXED_MAP_WIDTH; q += 1) {
      const position = coord(q, r);
      const key = hexKey(position);
      // Exclusions are applied after the rotated sets and before terrain
      // selection, making every road/facility base terrain Plain.
      const terrain: BaseTerrain = excluded.has(key)
        ? 'plain'
        : mountainKeys.has(key)
          ? 'mountain'
          : forestKeys.has(key)
            ? 'forest'
            : 'plain';
      tiles.push({
        key,
        q,
        r,
        terrain,
        road: roads.has(key),
        movementCost: terrain === 'forest' ? 2 : terrain === 'mountain' ? 3 : 1,
        facilityId: null,
        hordeEntranceDirections: [],
      });
    }
  }
  return tiles;
}

function createFacilities(
  capacities: Readonly<Record<string, number>> = capacityByType,
): FacilityDefinition[] {
  return facilitySpecs.map((spec) => ({
    id: spec.id,
    type: spec.type,
    nameKey: `facility.${spec.type}`,
    position: { ...spec.position },
    workerCapacity: capacities[spec.type] ?? capacityByType[spec.type]!,
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
      roadTiles: Array.from({ length: CENTER }, (_, index) => coord(ROAD_COLUMN, index)),
    },
    {
      direction: 'east',
      tile: coord(FIXED_MAP_WIDTH - 1, ROAD_ROW),
      roadTiles: Array.from({ length: CENTER }, (_, index) =>
        coord(FIXED_MAP_WIDTH - 1 - index, ROAD_ROW),
      ),
    },
    {
      direction: 'south',
      tile: coord(ROAD_COLUMN, FIXED_MAP_HEIGHT - 1),
      roadTiles: Array.from({ length: CENTER }, (_, index) =>
        coord(ROAD_COLUMN, FIXED_MAP_HEIGHT - 1 - index),
      ),
    },
    {
      direction: 'west',
      tile: coord(0, ROAD_ROW),
      roadTiles: Array.from({ length: CENTER }, (_, index) => coord(index, ROAD_ROW)),
    },
  ];
}

function createRoadBranches(): RoadBranchDefinition[] {
  const capitalConnection = coord(ROAD_COLUMN, ROAD_ROW);
  return [
    {
      id: 'north',
      direction: 'north',
      capitalConnection: { ...capitalConnection },
      roadTiles: Array.from({ length: CENTER }, (_, index) => coord(ROAD_COLUMN, CENTER - 1 - index)),
      entrance: coord(ROAD_COLUMN, 0),
    },
    {
      id: 'east',
      direction: 'east',
      capitalConnection: { ...capitalConnection },
      roadTiles: Array.from({ length: CENTER }, (_, index) => coord(CENTER + 1 + index, ROAD_ROW)),
      entrance: coord(FIXED_MAP_WIDTH - 1, ROAD_ROW),
    },
    {
      id: 'south',
      direction: 'south',
      capitalConnection: { ...capitalConnection },
      roadTiles: Array.from({ length: CENTER }, (_, index) => coord(ROAD_COLUMN, CENTER + 1 + index)),
      entrance: coord(ROAD_COLUMN, FIXED_MAP_HEIGHT - 1),
    },
    {
      id: 'west',
      direction: 'west',
      capitalConnection: { ...capitalConnection },
      roadTiles: Array.from({ length: CENTER }, (_, index) => coord(CENTER - 1 - index, ROAD_ROW)),
      entrance: coord(0, ROAD_ROW),
    },
  ];
}

function buildFixedMap(
  capacities: Readonly<Record<string, number>> = capacityByType,
): FixedMap {
  const roads = roadKeySet();
  const tiles = createTiles(roads);
  const facilities = createFacilities(capacities);
  const hordeEntrances = createEntrances();
  const roadBranches = createRoadBranches();

  const tileByKey = new Map(tiles.map((tile) => [tile.key, tile]));
  for (const facility of facilities) {
    const tile = tileByKey.get(hexKey(facility.position));
    if (!tile) throw new Error(`Facility ${facility.id} is outside the fixed map`);
    if (tile.facilityId !== null) throw new Error(`Facilities overlap on ${tile.key}`);
    tile.facilityId = facility.id;
  }
  for (const entrance of hordeEntrances) {
    const tile = tileByKey.get(hexKey(entrance.tile));
    if (!tile) throw new Error(`Horde entrance is outside the fixed map: ${hexKey(entrance.tile)}`);
    if (!tile.road) throw new Error(`Horde entrance must be on a road: ${hexKey(entrance.tile)}`);
    tile.hordeEntranceDirections.push(entrance.direction);
  }

  return {
    id: FIXED_MAP_ID,
    width: FIXED_MAP_WIDTH,
    height: FIXED_MAP_HEIGHT,
    tiles,
    roadTiles: sortedCoordinates(roads),
    facilities,
    hordeEntrances,
    roadBranches,
    initialZombiePositions: FIXED_INITIAL_ZOMBIE_POSITIONS.map((position) => ({ ...position })),
  };
}

const baseFixedMap = buildFixedMap();

/** Final terrain sets after Mountain precedence and Road/Facility exclusion. */
const finalTerrainCoordinates = (terrain: BaseTerrain): HexCoord[] =>
  baseFixedMap.tiles
    .filter((tile) => tile.terrain === terrain)
    .map((tile) => coord(tile.q, tile.r));

export const FIXED_MOUNTAIN_COORDINATES = finalTerrainCoordinates('mountain');
export const FIXED_FOREST_COORDINATES = finalTerrainCoordinates('forest');

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
export function createFixedMap(
  capacities: Readonly<Record<string, number>> = capacityByType,
): FixedMap {
  return cloneMap(buildFixedMap(capacities));
}

export function getTile(map: FixedMap, position: HexCoord): HexTile | undefined {
  if (!hexWithinBounds(position, map.width, map.height)) return undefined;
  return map.tiles.find((tile) => tile.q === position.q && tile.r === position.r);
}

export function getFacility(map: FixedMap, facilityId: string): FacilityDefinition | undefined {
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

function uniquePositionKeys(positions: readonly HexCoord[]): Set<string> {
  return new Set(positions.map(hexKey));
}

function countStaticBuildablePlainHexes(map: FixedMap, radius: number): number {
  const facilities = Array.isArray(map.facilities) ? map.facilities : [];
  const capital = facilities.find((facility) => facility.type === 'capital');
  if (!capital) return 0;
  // Axial distance is evaluated directly to keep validation independent from
  // map consumers and avoid introducing a second map rule implementation.
  const distance = (position: HexCoord): number => {
    const dq = position.q - capital.position.q;
    const dr = position.r - capital.position.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  };
  const occupied = new Set(facilities.map((facility) => hexKey(facility.position)));
  occupied.add(hexKey(FIXED_INITIAL_UNIT_POSITIONS.police));
  occupied.add(hexKey(FIXED_INITIAL_UNIT_POSITIONS.nationalGuard));
  return map.tiles.filter(
    (tile) =>
      tile.terrain === 'plain' &&
      !tile.road &&
      !occupied.has(tile.key) &&
      distance({ q: tile.q, r: tile.r }) <= radius,
  ).length;
}

/** Structural guard used by tests and save loading. */
export function validateFixedMap(map: FixedMap): FixedMapValidationResult {
  const errors: string[] = [];
  if (!map || map.id !== FIXED_MAP_ID) errors.push(`map id must be ${FIXED_MAP_ID}`);
  if (map?.width !== FIXED_MAP_WIDTH || map?.height !== FIXED_MAP_HEIGHT) {
    errors.push('map must be exactly 31x31');
  }
  if (!Array.isArray(map?.tiles) || map.tiles.length !== FIXED_MAP_WIDTH * FIXED_MAP_HEIGHT) {
    errors.push('map must contain 961 tiles');
  }
  if (!Array.isArray(map?.facilities) || map.facilities.length !== FIXED_FACILITY_COUNT) {
    errors.push('map must contain exactly 17 facilities');
  }

  const seenTiles = new Set<string>();
  for (const tile of map?.tiles ?? []) {
    if (!hexWithinBounds(tile, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`tile outside bounds: ${tile.key}`);
    }
    if (seenTiles.has(tile.key)) errors.push(`duplicate tile: ${tile.key}`);
    seenTiles.add(tile.key);
    const expectedCost =
      tile.terrain === 'plain'
        ? 1
        : tile.terrain === 'forest'
          ? 2
          : tile.terrain === 'mountain'
            ? 3
            : null;
    if (tile.movementCost !== expectedCost) {
      errors.push(`tile movement cost does not match terrain: ${tile.key}`);
    }
    if (tile.road && tile.terrain !== 'plain') {
      errors.push(`road base terrain must be plain: ${tile.key}`);
    }
    if (tile.facilityId !== null && tile.terrain !== 'plain') {
      errors.push(`facility base terrain must be plain: ${tile.key}`);
    }
  }

  const terrainCounts = Array.isArray(map?.tiles)
    ? map.tiles.reduce<Record<BaseTerrain, number>>(
      (counts, tile) => ({ ...counts, [tile.terrain]: (counts[tile.terrain] ?? 0) + 1 }),
      { plain: 0, forest: 0, mountain: 0, water: 0 },
    )
    : null;
  if (
    terrainCounts &&
    (terrainCounts.water !== 0 ||
      terrainCounts.plain + terrainCounts.forest + terrainCounts.mountain !== FIXED_MAP_WIDTH * FIXED_MAP_HEIGHT)
  ) {
    errors.push('map terrain must cover all 961 hexes with no Water');
  }

  const facilityPositions = new Set<string>();
  for (const facility of map?.facilities ?? []) {
    const key = hexKey(facility.position);
    if (facilityPositions.has(key)) errors.push(`duplicate facility position: ${key}`);
    facilityPositions.add(key);
    if (!hexWithinBounds(facility.position, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`facility outside bounds: ${facility.id}`);
    }
    const minCapacity = facility.type === ('windPowerPlant' as FacilityType) ? 0 : 1;
    if (!Number.isSafeInteger(facility.workerCapacity) || facility.workerCapacity < minCapacity) {
      errors.push(`facility worker capacity must be a ${minCapacity === 0 ? 'non-negative' : 'positive'} integer: ${facility.id}`);
    }
  }

  if (!Array.isArray(map?.hordeEntrances) || map.hordeEntrances.length !== 4) {
    errors.push('map must contain north/east/south/west Horde entrances');
  }
  if (!Array.isArray(map?.roadBranches) || map.roadBranches.length !== 4) {
    errors.push('map must contain four road branches');
  }

  const expectedRoads = roadKeySet();
  if (map && (!Array.isArray(map.roadTiles) || map.roadTiles.length !== expectedRoads.size)) {
    errors.push(`map must contain ${expectedRoads.size} road tiles`);
  }
  if (map) {
    const mapRoads = uniquePositionKeys(Array.isArray(map.roadTiles) ? map.roadTiles : []);
    if (mapRoads.size !== expectedRoads.size || [...expectedRoads].some((key) => !mapRoads.has(key))) {
      errors.push('road tiles must be the fixed four-way cross');
    }
  }

  if (Array.isArray(map?.roadBranches) && map.roadBranches.length === 4) {
    const branchIds = new Set<string>();
    for (const branch of map.roadBranches) {
      if (branchIds.has(branch.id)) errors.push(`duplicate road branch: ${branch.id}`);
      branchIds.add(branch.id);
      if (!cardinalDirections.includes(branch.direction)) {
        errors.push(`invalid road branch direction: ${branch.id}`);
      }
      if (branch.roadTiles.length !== CENTER) errors.push(`road branch must contain 15 tiles: ${branch.id}`);
      if (hexKey(branch.capitalConnection) !== hexKey(coord(CENTER, CENTER))) {
        errors.push(`road branch must connect at capital: ${branch.id}`);
      }
      for (const position of branch.roadTiles) {
        if (!isRoad(map, position)) errors.push(`road branch tile is not a road: ${branch.id}:${hexKey(position)}`);
        if (hexKey(position) === hexKey(branch.capitalConnection)) {
          errors.push(`road branch contains the capital intersection: ${branch.id}`);
        }
      }
      if (hexKey(branch.roadTiles.at(-1) ?? branch.capitalConnection) !== hexKey(branch.entrance)) {
        errors.push(`road branch must end at its entrance: ${branch.id}`);
      }
      if (!isRoad(map, branch.entrance)) errors.push(`road branch entrance is not a road: ${branch.id}`);
    }
    for (const direction of cardinalDirections) {
      if (!branchIds.has(direction)) errors.push(`map must contain ${direction} road branch`);
    }
  }

  if (Array.isArray(map?.hordeEntrances) && map.hordeEntrances.length === 4) {
    const entranceDirections = new Set<string>();
    for (const entrance of map.hordeEntrances) {
      if (entranceDirections.has(entrance.direction)) {
        errors.push(`duplicate Horde entrance direction: ${entrance.direction}`);
      }
      entranceDirections.add(entrance.direction);
      if (!isRoad(map, entrance.tile)) errors.push(`${entrance.direction} Horde entrance must be on a road`);
      if (entrance.roadTiles.length !== CENTER) {
        errors.push(`${entrance.direction} Horde entrance must contain 15 road tiles`);
      }
      for (const position of entrance.roadTiles) {
        if (!isRoad(map, position)) errors.push(`${entrance.direction} entrance has non-road tile: ${hexKey(position)}`);
      }
    }
    for (const direction of cardinalDirections) {
      if (!entranceDirections.has(direction)) errors.push(`map must contain one ${direction} Horde entrance`);
    }
  }

  if (!Array.isArray(map?.initialZombiePositions) || map.initialZombiePositions.length !== 6) {
    errors.push('map must contain six initial zombie positions');
  }
  const mapFacilityKeys = new Set((map?.facilities ?? []).map((facility) => hexKey(facility.position)));
  for (const position of map?.initialZombiePositions ?? []) {
    if (!hexWithinBounds(position, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`initial zombie outside bounds: ${hexKey(position)}`);
    }
    if (mapFacilityKeys.has(hexKey(position))) {
      errors.push(`initial zombie overlaps facility: ${hexKey(position)}`);
    }
  }

  const expectedFacilityIds = new Set(FIXED_FACILITY_IDS);
  const actualFacilityIds = new Set((map?.facilities ?? []).map((facility) => facility.id));
  if (expectedFacilityIds.size !== actualFacilityIds.size || [...expectedFacilityIds].some((id) => !actualFacilityIds.has(id))) {
    errors.push('map facilities must match the fixed 17-facility template');
  }

  if (map && countStaticBuildablePlainHexes(map, 5) < 12) {
    errors.push('initial Supply radius 5 must contain at least 12 static buildable Plain hexes');
  }

  // Normalize only caller-provided capacity overrides before comparing
  // structure, matching the legacy API while preserving one canonical map.
  const canonicalCandidate = map ? cloneMap(map) : null;
  if (canonicalCandidate) {
    for (const facility of canonicalCandidate.facilities) {
      facility.workerCapacity = capacityByType[facility.type] ?? facility.workerCapacity;
    }
  }
  if (canonicalCandidate && canonicalMapJson(canonicalCandidate) !== FIXED_MAP_CANONICAL_JSON) {
    errors.push('map must match the fixed 31x31 map template');
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidFixedMap(map: FixedMap): void {
  const result = validateFixedMap(map);
  if (!result.valid) throw new Error(`Invalid fixed map: ${result.errors.join('; ')}`);
}
