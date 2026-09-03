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
import { hexDistance, hexKey, hexWithinBounds } from './hex';
import { SeededRng } from './rng';

/**
 * The v1.4.4 map is intentionally data-only and deterministic. Keep the
 * identifier here rather than deriving it from caller config: map validation
 * and save loading must reject a different fixed-map contract.
 */
export const FIXED_MAP_ID = 'fixed-51x51-v1' as const;
export const FIXED_MAP_WIDTH = 51 as const;
export const FIXED_MAP_HEIGHT = 51 as const;
export const FIXED_FACILITY_COUNT = 29 as const;
export const FIXED_INITIAL_ZOMBIE_COUNT = 25 as const;

/** Starting human unit locations belong to the initial-state contract rather
 * than the FixedMap shape, but exporting them keeps state creation and tests
 * on the same canonical coordinates. */
export const FIXED_INITIAL_UNIT_POSITIONS = {
  police: { q: 24, r: 25 },
  nationalGuard: { q: 26, r: 25 },
} as const;

/**
 * Initial Zombies are seed-selected at new-game creation. This exported
 * value is populated below with a canonical seed-0 template for FIXED_MAP;
 * a GameState's map.initialZombiePositions is replaced for its own seed.
 */
export const STARTING_FACILITY_IDS = [
  'capital',
  'farm-1',
  'civilian-factory-1',
  'refinery-1',
  'power-plant-1',
  'wind-power-plant-1',
] as const;

const CENTER = 25;
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
  { id: 'capital', type: 'capital', position: { q: 25, r: 25 }, startingOwned: true, startingWorkers: 41 },
  { id: 'city-1', type: 'city', position: { q: 25, r: 20 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-2', type: 'city', position: { q: 24, r: 8 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-3', type: 'city', position: { q: 33, r: 25 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-4', type: 'city', position: { q: 43, r: 24 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-5', type: 'city', position: { q: 25, r: 34 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-6', type: 'city', position: { q: 26, r: 43 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-7', type: 'city', position: { q: 16, r: 25 }, startingOwned: false, startingWorkers: 0 },
  { id: 'city-8', type: 'city', position: { q: 7, r: 26 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-1', type: 'farm', position: { q: 23, r: 25 }, startingOwned: true, startingWorkers: 23 },
  { id: 'farm-2', type: 'farm', position: { q: 21, r: 11 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-3', type: 'farm', position: { q: 39, r: 20 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-4', type: 'farm', position: { q: 29, r: 39 }, startingOwned: false, startingWorkers: 0 },
  { id: 'farm-5', type: 'farm', position: { q: 10, r: 29 }, startingOwned: false, startingWorkers: 0 },
  { id: 'civilian-factory-1', type: 'civilianFactory', position: { q: 27, r: 25 }, startingOwned: true, startingWorkers: 23 },
  { id: 'civilian-factory-2', type: 'civilianFactory', position: { q: 29, r: 13 }, startingOwned: false, startingWorkers: 0 },
  { id: 'civilian-factory-3', type: 'civilianFactory', position: { q: 22, r: 38 }, startingOwned: false, startingWorkers: 0 },
  { id: 'civilian-factory-4', type: 'civilianFactory', position: { q: 11, r: 28 }, startingOwned: false, startingWorkers: 0 },
  { id: 'military-factory-1', type: 'militaryFactory', position: { q: 21, r: 25 }, startingOwned: false, startingWorkers: 0 },
  { id: 'military-factory-2', type: 'militaryFactory', position: { q: 22, r: 10 }, startingOwned: false, startingWorkers: 0 },
  { id: 'military-factory-3', type: 'militaryFactory', position: { q: 28, r: 40 }, startingOwned: false, startingWorkers: 0 },
  { id: 'refinery-1', type: 'refinery', position: { q: 25, r: 23 }, startingOwned: true, startingWorkers: 10 },
  { id: 'refinery-2', type: 'refinery', position: { q: 38, r: 21 }, startingOwned: false, startingWorkers: 0 },
  { id: 'refinery-3', type: 'refinery', position: { q: 25, r: 39 }, startingOwned: false, startingWorkers: 0 },
  { id: 'refinery-4', type: 'refinery', position: { q: 11, r: 30 }, startingOwned: false, startingWorkers: 0 },
  { id: 'power-plant-1', type: 'powerPlant', position: { q: 25, r: 27 }, startingOwned: true, startingWorkers: 3 },
  { id: 'power-plant-2', type: 'powerPlant', position: { q: 40, r: 22 }, startingOwned: false, startingWorkers: 0 },
  { id: 'power-plant-3', type: 'powerPlant', position: { q: 10, r: 28 }, startingOwned: false, startingWorkers: 0 },
  { id: 'wind-power-plant-1', type: 'windPowerPlant', position: { q: 26, r: 24 }, startingOwned: true, startingWorkers: 0 },
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
  addRange(keys, 4, 14, 18);
  addRange(keys, 5, 13, 18);
  addRange(keys, 6, 12, 17);
  addRange(keys, 6, 36, 39);
  addRange(keys, 7, 11, 16);
  addRange(keys, 7, 35, 39);
  addRange(keys, 8, 10, 15);
  addRange(keys, 8, 34, 38);
  addRange(keys, 9, 9, 14);
  addRange(keys, 9, 34, 37);
  addRange(keys, 10, 8, 13);
  addRange(keys, 10, 33, 36);
  addRotated(keys);
  return keys;
}

function createForestSeedKeys(): Set<string> {
  const keys = new Set<string>();
  addRange(keys, 1, 2, 9);
  addRange(keys, 1, 38, 48);
  addRange(keys, 2, 2, 11);
  addRange(keys, 2, 36, 48);
  addRange(keys, 3, 3, 13);
  addRange(keys, 3, 35, 47);
  addRange(keys, 4, 3, 12);
  addRange(keys, 4, 34, 46);
  addRange(keys, 5, 4, 12);
  addRange(keys, 5, 33, 45);
  addRange(keys, 6, 4, 11);
  addRange(keys, 6, 32, 44);
  addRange(keys, 7, 3, 10);
  addRange(keys, 7, 31, 43);
  addRange(keys, 8, 4, 9);
  addRange(keys, 8, 31, 44);
  addRange(keys, 9, 3, 8);
  addRange(keys, 9, 32, 45);
  addRange(keys, 10, 4, 7);
  addRange(keys, 10, 32, 46);
  addRange(keys, 11, 33, 45);
  addRange(keys, 12, 34, 44);
  addRange(keys, 13, 5, 11);
  addRange(keys, 14, 4, 12);
  addRange(keys, 15, 5, 13);
  addRange(keys, 16, 6, 14);
  addRange(keys, 17, 7, 15);
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
        playerOccupancyAllowed: q !== 0 && q !== FIXED_MAP_WIDTH - 1 && r !== 0 && r !== FIXED_MAP_HEIGHT - 1,
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
  const hordeSpawnReserve = tiles
    .filter((tile) => !tile.playerOccupancyAllowed)
    .map((tile) => coord(tile.q, tile.r));

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
    hordeSpawnReserve,
    roadBranches,
    // Initial positions are selected from this static map at game creation
    // time. A seed-0 template is attached to FIXED_MAP below for callers that
    // inspect the map without creating a GameState.
    initialZombiePositions: [],
  };
}

/**
 * Return the stable candidate list used by initial-zombie placement. Roads
 * remain valid candidates; only the explicit fixed-map exclusions are
 * applied. Coordinates are sorted q/r so PRNG selection is auditable and
 * independent of array construction order.
 */
export function getInitialZombieCandidates(map: FixedMap): HexCoord[] {
  const capital = map.facilities.find((facility) => facility.type === 'capital');
  if (!capital) throw new Error('Fixed map requires a Capital for initial Zombie placement');
  const facilityKeys = new Set(map.facilities.map((facility) => hexKey(facility.position)));
  const humanKeys = new Set(Object.values(FIXED_INITIAL_UNIT_POSITIONS).map(hexKey));
  return map.tiles
    .filter((tile) => {
      if (tile.movementCost === null || isHordeSpawnReserve(map, tile)) return false;
      if (facilityKeys.has(tile.key) || humanKeys.has(tile.key)) return false;
      return hexDistance(capital.position, tile) >= 9;
    })
    .map((tile) => ({ q: tile.q, r: tile.r }))
    .sort((left, right) => left.q - right.q || left.r - right.r);
}

/**
 * Select distinct initial Normal Zombie positions from a deterministic RNG.
 * The partial Fisher-Yates sequence consumes exactly one RNG draw per
 * selected position and preserves the selected order for stable Unit IDs.
 */
export function generateInitialZombiePositions(
  map: FixedMap,
  rngOrSeed: SeededRng | number,
  count = FIXED_INITIAL_ZOMBIE_COUNT,
): HexCoord[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Initial Zombie count must be a non-negative safe integer');
  }
  const candidates = getInitialZombieCandidates(map);
  if (count > candidates.length) {
    throw new Error(`Initial Zombie count ${count} exceeds ${candidates.length} valid map candidates`);
  }
  const rng = typeof rngOrSeed === 'number' ? new SeededRng(rngOrSeed) : rngOrSeed;
  const available = candidates.map((position) => ({ ...position }));
  const selected: HexCoord[] = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = rng.nextInt(index, available.length - 1);
    [available[index], available[selectedIndex]] = [available[selectedIndex]!, available[index]!];
    selected.push({ ...available[index]! });
  }
  return selected;
}

/** Validate the seed-bound initial Zombie list at snapshot trust boundaries. */
export function initialZombiePositionsMatchSeed(map: FixedMap, seed: number): boolean {
  if (!Number.isSafeInteger(seed)) return false;
  const expected = generateInitialZombiePositions(map, seed);
  return map.initialZombiePositions.length === expected.length
    && map.initialZombiePositions.every((position, index) => {
      const expectedPosition = expected[index];
      return expectedPosition !== undefined
        && position.q === expectedPosition.q
        && position.r === expectedPosition.r;
    });
}

const mapWithoutInitialZombies = buildFixedMap();

/** Canonical seed-0 positions are only a template; new games reseed them. */
export const FIXED_INITIAL_ZOMBIE_POSITIONS: readonly HexCoord[] = generateInitialZombiePositions(
  mapWithoutInitialZombies,
  0,
);

const baseFixedMap: FixedMap = {
  ...mapWithoutInitialZombies,
  initialZombiePositions: FIXED_INITIAL_ZOMBIE_POSITIONS.map((position) => ({ ...position })),
};

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

/** Initial Zombie coordinates are seed-dependent state, not static map data. */
const canonicalStaticMapJson = (map: FixedMap): string =>
  canonicalMapJson({ ...map, initialZombiePositions: [] });

const FIXED_MAP_CANONICAL_JSON = canonicalStaticMapJson(baseFixedMap);

/** Return a fresh JSON-compatible copy for a new GameState. */
export function createFixedMap(
  capacities: Readonly<Record<string, number>> = capacityByType,
): FixedMap {
  const map = buildFixedMap(capacities);
  map.initialZombiePositions = FIXED_INITIAL_ZOMBIE_POSITIONS.map((position) => ({ ...position }));
  return cloneMap(map);
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

/** Static public Map Rule shared by movement, placement, UI, and Agent APIs. */
export function isHordeSpawnReserve(map: FixedMap, position: HexCoord): boolean {
  const key = hexKey(position);
  return map.hordeSpawnReserve.some((candidate) => hexKey(candidate) === key);
}

export function canPlayerOccupyHex(map: FixedMap, position: HexCoord): boolean {
  return getTile(map, position) !== undefined && !isHordeSpawnReserve(map, position);
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
    errors.push('map must be exactly 51x51');
  }
  if (!Array.isArray(map?.tiles) || map.tiles.length !== FIXED_MAP_WIDTH * FIXED_MAP_HEIGHT) {
    errors.push('map must contain 2601 tiles');
  }
  if (!Array.isArray(map?.facilities) || map.facilities.length !== FIXED_FACILITY_COUNT) {
    errors.push('map must contain exactly 29 facilities');
  }

  const seenTiles = new Set<string>();
  for (const tile of map?.tiles ?? []) {
    if (!hexWithinBounds(tile, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`tile outside bounds: ${tile.key}`);
    }
    if (typeof tile.playerOccupancyAllowed !== 'boolean') {
      errors.push(`tile ${tile.key} must declare playerOccupancyAllowed`);
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
  const reserve = Array.isArray(map?.hordeSpawnReserve) ? map.hordeSpawnReserve : [];
  const reserveKeys = new Set(reserve.map(hexKey));
  if (reserve.length !== 200 || reserveKeys.size !== 200) {
    errors.push('map must contain the 200 unique outer-ring Horde Spawn Reserve hexes');
  }
  for (const tile of map?.tiles ?? []) {
    const expectedReserve = tile.q === 0 || tile.q === FIXED_MAP_WIDTH - 1 || tile.r === 0 || tile.r === FIXED_MAP_HEIGHT - 1;
    if (reserveKeys.has(tile.key) !== expectedReserve || tile.playerOccupancyAllowed === expectedReserve) {
      errors.push(`tile ${tile.key} has inconsistent Horde Spawn Reserve metadata`);
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
    errors.push('map terrain must cover all 2601 hexes with no Water');
  }
  if (terrainCounts && (
    terrainCounts.plain !== 1961
    || terrainCounts.forest !== 514
    || terrainCounts.mountain !== 126
    || terrainCounts.water !== 0
  )) {
    errors.push('map terrain counts must be Plain 1961, Forest 514, Mountain 126, Water 0');
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
      if (branch.roadTiles.length !== CENTER) errors.push(`road branch must contain 25 tiles: ${branch.id}`);
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
        errors.push(`${entrance.direction} Horde entrance must contain 25 road tiles`);
      }
      for (const position of entrance.roadTiles) {
        if (!isRoad(map, position)) errors.push(`${entrance.direction} entrance has non-road tile: ${hexKey(position)}`);
      }
    }
    for (const direction of cardinalDirections) {
      if (!entranceDirections.has(direction)) errors.push(`map must contain one ${direction} Horde entrance`);
    }
  }

  if (!Array.isArray(map?.initialZombiePositions) || map.initialZombiePositions.length !== FIXED_INITIAL_ZOMBIE_COUNT) {
    errors.push(`map must contain ${FIXED_INITIAL_ZOMBIE_COUNT} initial zombie positions`);
  }
  const mapFacilityKeys = new Set((map?.facilities ?? []).map((facility) => hexKey(facility.position)));
  const initialZombieKeys = new Set<string>();
  const initialHumanKeys = new Set(Object.values(FIXED_INITIAL_UNIT_POSITIONS).map((position) => hexKey(position)));
  for (const [index, position] of (map?.initialZombiePositions ?? []).entries()) {
    const key = hexKey(position);
    if (!hexWithinBounds(position, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT)) {
      errors.push(`initial zombie outside bounds: ${hexKey(position)}`);
    }
    if (initialZombieKeys.has(key)) errors.push(`duplicate initial zombie position: ${key}`);
    initialZombieKeys.add(key);
    if (mapFacilityKeys.has(key)) {
      errors.push(`initial zombie overlaps facility: ${key}`);
    }
    if (reserveKeys.has(key)) errors.push(`initial zombie overlaps Horde Spawn Reserve: ${key}`);
    if (initialHumanKeys.has(key)) errors.push(`initial zombie overlaps initial Human Unit: ${key}`);
    const capital = map?.facilities.find((facility) => facility.type === 'capital');
    if (capital && hexDistance(position, capital.position) < 9) {
      errors.push(`initial zombie is within Capital safety distance: ${key}`);
    }
    const tile = map?.tiles.find((candidate) => candidate.key === key);
    if (tile?.movementCost === null) errors.push(`initial zombie is on impassable terrain: ${key}`);
  }

  const expectedFacilityIds = new Set(FIXED_FACILITY_IDS);
  const actualFacilityIds = new Set((map?.facilities ?? []).map((facility) => facility.id));
  if (expectedFacilityIds.size !== actualFacilityIds.size || [...expectedFacilityIds].some((id) => !actualFacilityIds.has(id))) {
    errors.push('map facilities must match the fixed 29-facility template');
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
  if (canonicalCandidate && canonicalStaticMapJson(canonicalCandidate) !== FIXED_MAP_CANONICAL_JSON) {
    errors.push('map must match the fixed 51x51 map template');
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidFixedMap(map: FixedMap): void {
  const result = validateFixedMap(map);
  if (!result.valid) throw new Error(`Invalid fixed map: ${result.errors.join('; ')}`);
}
