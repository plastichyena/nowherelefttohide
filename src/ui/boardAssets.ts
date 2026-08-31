/**
 * UI-only board asset vocabulary and pure mapping helpers.
 *
 * The game core intentionally knows nothing about these paths.  The registry
 * contains relative paths only; callers resolve them at the edge of the UI
 * with `resolveBoardAssetUrl`, which keeps GitHub Pages/Vite base paths and
 * cache busting out of GameState and the game rules.
 */

import {
  HEX_DIRECTION_ORDER,
  hexDirectionBetween,
  hexKey,
  hexNeighbor,
} from '../core/hex';
import { APP_VERSION } from '../agent/types';
import type {
  BaseTerrain,
  CheckpointState,
  CheckpointStatus,
  FacilityState,
  FacilityType,
  HexCoord,
  HexDirection,
  HexKey,
  HexTile,
  UnitState,
  UnitType,
} from '../core/types';

/** Camera zoom below this value uses the board's low-detail rendering path. */
export const BOARD_LOD_ZOOM_THRESHOLD = 0.75;

/** App/release version used to invalidate cached board images by default. */
export const BOARD_ASSET_APP_VERSION = APP_VERSION;

/** Compatibility aliases for callers that name the cache version directly. */
export const BOARD_ASSET_VERSION = BOARD_ASSET_APP_VERSION;
export const ASSET_CACHE_VERSION = BOARD_ASSET_APP_VERSION;

/**
 * Vite supplies BASE_URL at build time.  Keeping this lookup defensive also
 * lets the pure URL helper run in Vitest/Node, where `import.meta.env` may not
 * exist.
 */
interface ViteRuntimeEnv {
  BASE_URL?: string;
  VITE_BUILD_ID?: string;
}

/*
 * Keep these as direct property reads. Vite statically replaces
 * `import.meta.env.KEY`; reading `env` through a cast leaves the production
 * bundle without BASE_URL/VITE_BUILD_ID and breaks project-scoped Pages URLs.
 */
const VITE_BASE_URL = import.meta.env.BASE_URL;
const VITE_BUILD_ID = import.meta.env.VITE_BUILD_ID;

function viteRuntimeEnv(): ViteRuntimeEnv {
  return {
    BASE_URL: VITE_BASE_URL,
    VITE_BUILD_ID,
  };
}

/** Build-time Vite BASE_URL, exported for UI adapters that need the same base. */
export const BASE_URL = viteRuntimeEnv().BASE_URL ?? '/';

/** Relative directory below the app base containing board runtime assets. */
export const BOARD_ASSET_BASE_PATH = 'assets/board';

export const BOARD_TERRAIN_TYPES = ['plain', 'forest', 'mountain'] as const;
export type BoardTerrainType = (typeof BOARD_TERRAIN_TYPES)[number];

export const BOARD_FACILITY_TYPES = [
  'capital',
  'city',
  'farm',
  'civilianFactory',
  'militaryFactory',
  'refinery',
  'powerPlant',
  'windPowerPlant',
  'simpleFarm',
  'civilianDroneBase',
] as const satisfies readonly FacilityType[];

export const BOARD_FACILITY_ASSET_TYPES = [...BOARD_FACILITY_TYPES, 'checkpoint'] as const;
export type BoardFacilityAssetType = (typeof BOARD_FACILITY_ASSET_TYPES)[number];

export const BOARD_UNIT_TYPES = ['police', 'nationalGuard', 'zombie', 'hordeZombie'] as const satisfies readonly UnitType[];
export type BoardUnitAssetType = (typeof BOARD_UNIT_TYPES)[number];

export const BOARD_COMMON_STATE_LAYERS = ['infected', 'ruined'] as const;
export type BoardCommonStateLayer = (typeof BOARD_COMMON_STATE_LAYERS)[number];

export const BOARD_FACILITY_STATE_LAYERS = ['unsecured', 'secured', 'stopped'] as const;
export type BoardFacilityStateLayer = (typeof BOARD_FACILITY_STATE_LAYERS)[number];

export const BOARD_CHECKPOINT_STATE_LAYERS = ['operational', 'abandoned', 'remnant'] as const;
export type BoardCheckpointStateLayer = (typeof BOARD_CHECKPOINT_STATE_LAYERS)[number];

export const BOARD_UNIT_STATE_LAYERS = ['horde', 'final'] as const;
export type BoardUnitStateLayer = (typeof BOARD_UNIT_STATE_LAYERS)[number];

/**
 * Relative runtime paths.  State images are shared: a single infected or
 * ruined overlay is used for both general facilities and checkpoints.
 */
export const BOARD_ASSET_REGISTRY = {
  terrain: {
    plain: 'terrain/terrain_plain.png',
    forest: 'terrain/terrain_forest.png',
    mountain: 'terrain/terrain_mountain.png',
  },
  overlays: {
    road: 'overlays/terrain_road.png',
    urban: 'overlays/terrain_urban.png',
    unsecured: 'overlays/state_unsecured.png',
    secured: 'overlays/state_secured.png',
    stopped: 'overlays/state_stopped.png',
    infected: 'overlays/state_infected.png',
    ruined: 'overlays/state_ruined.png',
    checkpointOperational: 'overlays/checkpoint_operational.png',
    checkpointAbandoned: 'overlays/checkpoint_abandoned.png',
    checkpointRemnant: 'overlays/checkpoint_remnant.png',
    horde: 'overlays/unit_horde.png',
    final: 'overlays/unit_final_horde.png',
  },
  facilities: {
    capital: 'facilities/facility_capital.png',
    city: 'facilities/facility_city.png',
    farm: 'facilities/facility_farm.png',
    civilianFactory: 'facilities/facility_civilian_factory.png',
    militaryFactory: 'facilities/facility_military_factory.png',
    refinery: 'facilities/facility_refinery.png',
    powerPlant: 'facilities/facility_power_plant.png',
    windPowerPlant: 'facilities/facility_wind_power_plant.png',
    simpleFarm: 'facilities/facility_simple_farm.png',
    civilianDroneBase: 'facilities/facility_civilian_drone_base.png',
    checkpoint: 'facilities/facility_checkpoint.png',
  },
  units: {
    police: 'units/unit_police.png',
    nationalGuard: 'units/unit_national_guard.png',
    zombie: 'units/unit_zombie.png',
    hordeZombie: 'units/unit_horde_zombie.png',
  },
} as const;

/** Registry aliases keep Board and Board Legend call sites descriptive. */
export const BOARD_ASSETS = BOARD_ASSET_REGISTRY;
export const ASSET_REGISTRY = BOARD_ASSET_REGISTRY;

/** Shared overlay groups exposed without duplicating path definitions. */
export const BOARD_COMMON_OVERLAYS = {
  infected: BOARD_ASSET_REGISTRY.overlays.infected,
  ruined: BOARD_ASSET_REGISTRY.overlays.ruined,
} as const;

export const BOARD_FACILITY_OVERLAYS = {
  unsecured: BOARD_ASSET_REGISTRY.overlays.unsecured,
  secured: BOARD_ASSET_REGISTRY.overlays.secured,
  stopped: BOARD_ASSET_REGISTRY.overlays.stopped,
} as const;

export const BOARD_CHECKPOINT_OVERLAYS = {
  operational: BOARD_ASSET_REGISTRY.overlays.checkpointOperational,
  abandoned: BOARD_ASSET_REGISTRY.overlays.checkpointAbandoned,
  remnant: BOARD_ASSET_REGISTRY.overlays.checkpointRemnant,
} as const;

export const BOARD_UNIT_OVERLAYS = {
  horde: BOARD_ASSET_REGISTRY.overlays.horde,
  final: BOARD_ASSET_REGISTRY.overlays.final,
} as const;

export type BoardAssetPath = string;

function isBoardTerrainType(value: string): value is BoardTerrainType {
  return (BOARD_TERRAIN_TYPES as readonly string[]).includes(value);
}

function isBoardFacilityType(value: string): value is BoardFacilityAssetType {
  return (BOARD_FACILITY_ASSET_TYPES as readonly string[]).includes(value);
}

function isBoardUnitType(value: string): value is BoardUnitAssetType {
  return (BOARD_UNIT_TYPES as readonly string[]).includes(value);
}

/** Return a terrain path, or null for Water/unknown terrain (draw fallback). */
export function getTerrainAssetPath(terrain: BaseTerrain | string): string | null {
  return isBoardTerrainType(terrain) ? BOARD_ASSET_REGISTRY.terrain[terrain] : null;
}

/** Alias used by renderers that call mappings rather than path lookups. */
export const terrainAssetPath = getTerrainAssetPath;

/** Return a facility/checkpoint path, or null for a missing mapping. */
export function getFacilityAssetPath(type: FacilityType | 'checkpoint' | string): string | null {
  return isBoardFacilityType(type) ? BOARD_ASSET_REGISTRY.facilities[type] : null;
}

export const facilityAssetPath = getFacilityAssetPath;

/** Return a unit path, or null for a missing mapping. */
export function getUnitAssetPath(type: UnitType | string): string | null {
  return isBoardUnitType(type) ? BOARD_ASSET_REGISTRY.units[type] : null;
}

export const unitAssetPath = getUnitAssetPath;

/** Return a road/urban/state/Horde overlay path, or null for unknown keys. */
export function getBoardOverlayAssetPath(
  overlay: keyof typeof BOARD_ASSET_REGISTRY.overlays | string,
): string | null {
  return Object.prototype.hasOwnProperty.call(BOARD_ASSET_REGISTRY.overlays, overlay)
    ? BOARD_ASSET_REGISTRY.overlays[overlay as keyof typeof BOARD_ASSET_REGISTRY.overlays]
    : null;
}

export const overlayAssetPath = getBoardOverlayAssetPath;
export const getRoadAssetPath = (): string => BOARD_ASSET_REGISTRY.overlays.road;
export const getUrbanAssetPath = (): string => BOARD_ASSET_REGISTRY.overlays.urban;

/** All paths used by the registry, in deterministic category order. */
export function getAllBoardAssetPaths(): readonly string[] {
  return [
    ...Object.values(BOARD_ASSET_REGISTRY.terrain),
    BOARD_ASSET_REGISTRY.overlays.road,
    BOARD_ASSET_REGISTRY.overlays.urban,
    BOARD_ASSET_REGISTRY.overlays.unsecured,
    BOARD_ASSET_REGISTRY.overlays.secured,
    BOARD_ASSET_REGISTRY.overlays.stopped,
    BOARD_ASSET_REGISTRY.overlays.infected,
    BOARD_ASSET_REGISTRY.overlays.ruined,
    BOARD_ASSET_REGISTRY.overlays.checkpointOperational,
    BOARD_ASSET_REGISTRY.overlays.checkpointAbandoned,
    BOARD_ASSET_REGISTRY.overlays.checkpointRemnant,
    BOARD_ASSET_REGISTRY.overlays.horde,
    BOARD_ASSET_REGISTRY.overlays.final,
    ...Object.values(BOARD_ASSET_REGISTRY.facilities),
    ...Object.values(BOARD_ASSET_REGISTRY.units),
  ];
}

/** Compatibility constant for preloaders and manifest tests. */
export const BOARD_ASSET_PATHS = getAllBoardAssetPaths();

export interface BoardAssetUrlOptions {
  /** Vite BASE_URL or an explicit deployment sub-path. */
  baseUrl?: string;
  /** Release version used for cache invalidation. */
  appVersion?: string;
  /** Optional CI/local build id for a second cache-busting dimension. */
  buildId?: string | null;
}

function stripLeadingRelativeMarkers(path: string): string {
  return path.replace(/^\.\//u, '').replace(/^\/+?/u, '');
}

function withBoardAssetBase(path: string): string {
  const boardPrefix = `${BOARD_ASSET_BASE_PATH}/`;
  return path === BOARD_ASSET_BASE_PATH || path.startsWith(boardPrefix) ? path : `${boardPrefix}${path}`;
}

function appendCacheBust(url: string, appVersion: string, buildId: string | null | undefined): string {
  const params = new URLSearchParams();
  if (appVersion.length > 0) params.set('v', appVersion);
  if (buildId) params.set('b', buildId);
  const encoded = params.toString();
  return encoded.length > 0 ? `${url}${url.includes('?') ? '&' : '?'}${encoded}` : url;
}

/**
 * Resolve a registry-relative path against Vite BASE_URL and add cache busting.
 * No DOM, Phaser, GameState, or RNG access occurs here.
 */
export function resolveBoardAssetUrl(
  assetPath: string,
  options: BoardAssetUrlOptions = {},
): string {
  if (typeof assetPath !== 'string' || assetPath.length === 0) {
    throw new Error('Board asset path must be a non-empty string');
  }

  const baseUrl = options.baseUrl ?? BASE_URL;
  const appVersion = options.appVersion ?? BOARD_ASSET_APP_VERSION;
  const buildId = options.buildId === undefined ? viteRuntimeEnv().VITE_BUILD_ID : options.buildId;
  const path = stripLeadingRelativeMarkers(assetPath);
  // An explicitly absolute URL is useful for an integration test or a host
  // supplied CDN.  It must not be prefixed with the local board directory.
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(assetPath)) {
    return appendCacheBust(assetPath, appVersion, buildId);
  }
  const resolvedPath = withBoardAssetBase(path);
  const base = baseUrl.length === 0 ? '/' : baseUrl;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return appendCacheBust(`${normalizedBase}${resolvedPath}`, appVersion, buildId);
}

export const boardAssetUrl = resolveBoardAssetUrl;
export const getBoardAssetUrl = resolveBoardAssetUrl;

export interface TerrainAssetMapping {
  key: BoardTerrainType | 'water' | string;
  path: string | null;
  fallback: boolean;
}

/** Map standard terrain to an asset while explicitly retaining Water fallback. */
export function mapTerrainAsset(terrain: BaseTerrain | string): TerrainAssetMapping {
  const path = getTerrainAssetPath(terrain);
  return { key: terrain, path, fallback: path === null };
}

export type FacilityMappingLayer = BoardFacilityStateLayer | BoardCommonStateLayer;

export interface FacilityAssetMapping {
  base: string | null;
  /** State keys, in a stable visual layering order. */
  layers: readonly FacilityMappingLayer[];
  /** Alias for callers that use the longer name. */
  stateLayers: readonly FacilityMappingLayer[];
  /** Resolved overlay paths in the same order as `layers`. */
  overlays: readonly string[];
  overlayPaths: readonly string[];
  /** Forecast marker is deliberately separate from current stopped state. */
  forecastStopped: boolean;
  /** Forecast is a dynamic warning; it intentionally has no current-state PNG. */
  forecastOverlay: null;
}

export interface FacilityForecastMappingOptions {
  forecastStopped?: boolean;
  projectedStopped?: boolean;
  stoppedForecast?: boolean;
}

function requestedForecastStopped(
  options: FacilityForecastMappingOptions | boolean | undefined,
): boolean {
  if (typeof options === 'boolean') return options;
  return Boolean(options?.forecastStopped ?? options?.projectedStopped ?? options?.stoppedForecast);
}

/**
 * Convert a FacilityState's independent facts to Base + composable overlays.
 * In particular, secured+stopped, unsecured+infected, and ruined+infected
 * remain representable rather than collapsing into an exclusive state.
 */
export function mapFacilityAssetLayers(
  facility: Pick<FacilityState, 'type' | 'owner' | 'status' | 'operationalStatus' | 'infected'>,
  options?: FacilityForecastMappingOptions | boolean,
): FacilityAssetMapping {
  const layers: FacilityMappingLayer[] = [];
  if (facility.owner === 'player' && facility.status === 'owned') layers.push('secured');
  if (facility.owner === 'none' && facility.status === 'unowned') layers.push('unsecured');
  if (facility.operationalStatus === 'stopped') layers.push('stopped');
  if (facility.infected > 0) layers.push('infected');
  if (facility.status === 'ruined' || facility.operationalStatus === 'ruined') layers.push('ruined');

  const overlays = layers.map((layer) => {
    if (layer === 'infected' || layer === 'ruined') return BOARD_COMMON_OVERLAYS[layer];
    return BOARD_FACILITY_OVERLAYS[layer];
  });
  const forecastStopped = requestedForecastStopped(options);
  return {
    base: getFacilityAssetPath(facility.type),
    layers,
    stateLayers: layers,
    overlays,
    overlayPaths: overlays,
    forecastStopped,
    forecastOverlay: null,
  };
}

export const getFacilityAssetLayers = mapFacilityAssetLayers;
export const mapFacilityState = mapFacilityAssetLayers;

export type CheckpointMappingLayer = BoardCheckpointStateLayer | BoardCommonStateLayer | 'ruined';

export interface CheckpointAssetMapping {
  base: string;
  lifecycle: CheckpointStatus;
  layers: readonly CheckpointMappingLayer[];
  stateLayers: readonly CheckpointMappingLayer[];
  overlays: readonly string[];
  overlayPaths: readonly string[];
}

/**
 * Map a checkpoint lifecycle and infection independently.  `ruined` uses the
 * shared facility/checkpoint ruined overlay and does not need a second full
 * checkpoint image.
 */
export function mapCheckpointAssetLayers(
  checkpoint: Pick<CheckpointState, 'status' | 'infected'>,
): CheckpointAssetMapping {
  const status = checkpoint.status;
  if (status !== 'operational' && status !== 'abandoned' && status !== 'remnant' && status !== 'ruined') {
    throw new Error(`Unknown checkpoint status: ${String(status)}`);
  }

  const layers: CheckpointMappingLayer[] = [status];
  if (checkpoint.infected > 0) layers.push('infected');
  const overlays = layers.map((layer) => {
    if (layer === 'infected' || layer === 'ruined') return BOARD_COMMON_OVERLAYS[layer];
    return BOARD_CHECKPOINT_OVERLAYS[layer];
  });
  return {
    base: BOARD_ASSET_REGISTRY.facilities.checkpoint,
    lifecycle: status,
    layers,
    stateLayers: layers,
    overlays,
    overlayPaths: overlays,
  };
}

export const getCheckpointAssetLayers = mapCheckpointAssetLayers;
export const mapCheckpointState = mapCheckpointAssetLayers;

export interface UnitAssetMapping {
  base: string | null;
  layers: readonly BoardUnitStateLayer[];
  stateLayers: readonly BoardUnitStateLayer[];
  overlays: readonly string[];
  overlayPaths: readonly string[];
  isHorde: boolean;
  isFinalHorde: boolean;
}

/**
 * Resolve a unit base and Horde markers.  Final Horde receives both the
 * common Horde threat marker and the distinct Final outer marker.
 */
export function mapUnitAssetLayers(
  unit: Pick<UnitState, 'type' | 'hordeKind'>,
): UnitAssetMapping {
  const isHorde = unit.type === 'hordeZombie' || unit.hordeKind === 'periodic' || unit.hordeKind === 'final';
  const isFinalHorde = unit.hordeKind === 'final';
  const layers: BoardUnitStateLayer[] = [];
  if (isHorde) layers.push('horde');
  if (isFinalHorde) layers.push('final');
  const overlays = layers.map((layer) => BOARD_UNIT_OVERLAYS[layer]);
  return {
    base: getUnitAssetPath(unit.type),
    layers,
    stateLayers: layers,
    overlays,
    overlayPaths: overlays,
    isHorde,
    isFinalHorde,
  };
}

export const getUnitAssetLayers = mapUnitAssetLayers;
export const mapUnitState = mapUnitAssetLayers;

export type BoardLodMode = 'normal' | 'lod';

/** Strictly below 0.75 is LOD; exactly 0.75 remains normal. */
export function shouldUseBoardLod(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom < BOARD_LOD_ZOOM_THRESHOLD;
}

export function boardLodMode(zoom: number): BoardLodMode {
  return shouldUseBoardLod(zoom) ? 'lod' : 'normal';
}

export const getBoardLodMode = boardLodMode;
export const isBoardLodZoom = shouldUseBoardLod;

export interface BoardUnitOffset {
  x: number;
  y: number;
}

/** Pixel offset used to keep a unit visible beside a facility on one Hex. */
export const BOARD_FACILITY_UNIT_OFFSET: Readonly<BoardUnitOffset> = Object.freeze({ x: 10, y: 10 });
export const FACILITY_UNIT_OFFSET = BOARD_FACILITY_UNIT_OFFSET;

function hasFacility(value: boolean | object | null | undefined): boolean {
  return typeof value === 'boolean' ? value : value !== null && value !== undefined;
}

/** Pure layout helper: facility occupants sit down/right; unit-only stays centered. */
export function getFacilityUnitOffset(facility: boolean | object | null | undefined): BoardUnitOffset {
  return hasFacility(facility) ? { ...BOARD_FACILITY_UNIT_OFFSET } : { x: 0, y: 0 };
}

export const facilityUnitOffset = getFacilityUnitOffset;
export const getBoardUnitOffset = getFacilityUnitOffset;

export type RoadSource =
  | readonly HexCoord[]
  | readonly HexTile[]
  | ReadonlySet<HexKey>
  | { readonly tiles: readonly HexTile[] };

function roadKeySet(source: RoadSource): ReadonlySet<HexKey> {
  if (source instanceof Set) return source;
  const entries = 'tiles' in source ? source.tiles : source;
  const keys = new Set<HexKey>();
  for (const entry of entries) {
    // The Set form is handled above.  This guard keeps the helper tolerant of
    // a readonly/custom set implementation whose iteration is not narrowed by
    // TypeScript's `instanceof Set` check.
    if (typeof entry === 'string') {
      keys.add(entry);
    } else if ('road' in entry) {
      if (entry.road) keys.add(hexKey(entry));
    } else {
      keys.add(hexKey(entry));
    }
  }
  return keys;
}

/**
 * Derive connected Road directions from neighboring road Hexes.  Direction
 * ordering is the shared core HEX_DIRECTION_ORDER, making output stable for
 * texture rotation and deterministic tests.
 */
export function deriveRoadConnectionDirections(
  position: HexCoord,
  source: RoadSource,
): readonly HexDirection[] {
  const roads = roadKeySet(source);
  return HEX_DIRECTION_ORDER.filter((direction) => roads.has(hexKey(hexNeighbor(position, direction))));
}

export const getRoadConnectionDirections = deriveRoadConnectionDirections;
export const roadConnectionDirections = deriveRoadConnectionDirections;
export const deriveRoadDirections = deriveRoadConnectionDirections;

/** A compact six-bit mask useful when selecting a rotated/clipped Road texture. */
export function roadConnectionMask(directions: readonly HexDirection[]): number {
  const directionSet = new Set(directions);
  return HEX_DIRECTION_ORDER.reduce(
    (mask, direction, index) => mask | (directionSet.has(direction) ? 1 << index : 0),
    0,
  );
}

/**
 * Convenience wrapper for callers that have a neighboring Hex rather than a
 * direction list.  It is intentionally pure and returns null for non-adjacent
 * coordinates.
 */
export function roadDirectionBetween(from: HexCoord, to: HexCoord): HexDirection | null {
  return hexDirectionBetween(from, to);
}
