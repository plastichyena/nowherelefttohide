import Phaser from 'phaser';
import { forecastFacilityProduction } from '../core/engine';
import { HEX_DIRECTION_ORDER, hexDistance, hexKey, hexNeighbor } from '../core/hex';
import { deriveCheckpointRole, getSectorBranchIds } from '../core/supply';
import { effectiveMovementCost, isUrbanHex } from '../core/terrain';
import { getPlayerVisionCoverage, getPlayerVisibleTileKeys, type VisionCoverage } from '../core/visibility';
import type {
  CardinalDirection,
  CheckpointState,
  ConstructibleFacilityType,
  FacilityState,
  FixedMap,
  GameState,
  HexCoord,
  HexDirection,
  HexTile,
  UnitState,
} from '../core/types';
import {
  BOARD_ASSET_PATHS,
  BOARD_ASSET_REGISTRY,
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  BOARD_LOD_ZOOM_THRESHOLD,
  deriveRoadConnectionDirections,
  getFacilityUnitOffset,
  isBoardZombieUnitType,
  mapCheckpointAssetLayers,
  mapFacilityAssetLayers,
  mapTerrainAsset,
  mapUnitAssetLayers,
  resolveBoardAssetUrl,
} from './boardAssets';
import { createTranslator, type Locale } from './i18n';

// Camera bounds are part of the Board UI contract; re-export the Registry's
// single source of truth so direct Board consumers and tests cannot drift.
export { BOARD_MIN_ZOOM, BOARD_MAX_ZOOM } from './boardAssets';

/**
 * Phaser-only board adapter. It reads GameState and sends coordinates back to
 * the controller; all state changes still travel through GameAction/Core.
 */
export interface BoardRenderState {
  state: Readonly<GameState>;
  locale?: Locale;
  selectedPosition?: HexCoord | null;
  selectedUnitId?: string | null;
  /** Visible enemy selection (Human UI only; never a hidden target). */
  selectedZombieId?: string | null;
  legalDestinations?: readonly HexCoord[];
  attackTargetIds?: readonly string[];
  pendingPath?: readonly HexCoord[];
  /** All entrances warned for the next configured wave. */
  hordeDirections?: readonly CardinalDirection[];
  hordeWarningType?: 'periodic' | 'final' | 'none';
  /** Fixed outer-ring Spawn Reserve keys; defaults to the static map field. */
  spawnReserveTileKeys?: readonly string[];
  visibilityOverlay?: boolean;
  /** Core-derived visibility decomposition used by Fog and Vision overlays. */
  visionCoverage?: VisionCoverage;
  /** Shared Core facility forecast for this committed revision. */
  facilityProduction?: readonly ReturnType<typeof forecastFacilityProduction>[number][];
  selectedVision?: BoardVisionSelection | null;
  supplyOverlay?: boolean;
  suppliedTileKeys?: readonly string[];
  checkpointLegalPreviewPositions?: readonly HexCoord[];
  checkpointInvalidPreviewPositions?: readonly HexCoord[];
  checkpointPreviewSelected?: HexCoord | null;
  /** Build previews are local to the selected road Hex; only Relocate draws candidate markers. */
  checkpointPreviewMode?: 'build' | 'relocate' | null;
  blockedZombieIds?: readonly string[];
  /** Core-provided BuildConstructibleFacility candidate preview. */
  constructibleFacilityType?: ConstructibleFacilityType | null;
  constructibleFacilityLegalPreviewPositions?: readonly HexCoord[];
  constructibleFacilityInvalidPreviewPositions?: readonly HexCoord[];
  constructibleFacilityPreviewSelected?: HexCoord | null;
}

/**
 * The selected source metadata is deliberately paired with Core-returned
 * tile sets.  The Phaser adapter must never derive LOS from origin/radius.
 */
export interface BoardVisionSelection {
  origin: HexCoord;
  radius: number;
  visionMode: 'ground' | 'aerial';
  terrainLosBlocking: boolean;
  visibleTileKeys: ReadonlySet<string>;
  potentialTileKeys: ReadonlySet<string>;
  blockedTileKeys: ReadonlySet<string>;
}

export type VisionOverlayState = 'none' | 'ground-potential' | 'ground-visible' | 'ground-blocked' | 'aerial-visible';

/** Pure classification helper for tests and non-Phaser consumers. */
export function visionOverlayState(
  selectedVision: BoardVisionSelection | null | undefined,
  tileKey: string,
): VisionOverlayState {
  if (!selectedVision) return 'none';
  if (selectedVision.visionMode === 'aerial') {
    return selectedVision.visibleTileKeys.has(tileKey) ? 'aerial-visible' : 'none';
  }
  if (selectedVision.blockedTileKeys.has(tileKey)) return 'ground-blocked';
  if (selectedVision.visibleTileKeys.has(tileKey)) return 'ground-visible';
  if (selectedVision.potentialTileKeys.has(tileKey)) return 'ground-potential';
  return 'none';
}

export type BoardAssetFailureKind = 'missing' | 'load' | 'decode' | 'texture-registration';

export interface BoardAssetProgress {
  loading: boolean;
  phase: 'loading' | 'ready';
  progress: number;
  loaded: number;
  total: number;
  failed: number;
}

export interface BoardAssetStatus {
  path: string;
  key: string;
  state: 'pending' | 'loaded' | 'ready' | 'failed';
  failure: BoardAssetFailureKind | null;
  message?: string;
}

export interface BoardAssetLoadSummary {
  total: number;
  loaded: number;
  failed: number;
  assets: readonly BoardAssetStatus[];
}

export interface BoardAssetWarning {
  path: string;
  key: string;
  kind: BoardAssetFailureKind;
  message: string;
}

export interface BoardCallbacks {
  onTileTap(position: HexCoord): void;
  /** Invoked when a short tap lands outside the map's Hexes. */
  onBlankTap?: () => void;
  /** Invoked after camera or board state changes so DOM overlays can reproject. */
  onViewChange?: () => void;
  /** The DOM controller consumes this compact loading object. */
  onLoading?: (status: boolean | string | BoardAssetProgress) => void;
  onProgress?: (progress: BoardAssetProgress) => void;
  onAssetProgress?: (progress: BoardAssetProgress) => void;
  onReady?: (summary: BoardAssetLoadSummary) => void;
  onAssetsReady?: (summary: BoardAssetLoadSummary) => void;
  onAssetReady?: (summary: BoardAssetLoadSummary) => void;
  onWarning?: (warning: BoardAssetWarning) => void;
  onAssetWarning?: (warning: BoardAssetWarning) => void;
}

export const BOARD_RENDER_LAYER_ORDER = [
  'terrain',
  'road',
  'urban',
  'facility-base',
  'facility-state',
  'fog',
  'unit',
  'dynamic',
] as const;

export const BOARD_FALLBACK_LAYER_ORDER = BOARD_RENDER_LAYER_ORDER;
export const BOARD_LOD_THRESHOLD = BOARD_LOD_ZOOM_THRESHOLD;

/** Lightweight counters used by performance tests and development builds. */
export interface BoardRenderCounters {
  stateUpdates: number;
  drawCalls: number;
  staticRebuilds: number;
  dynamicRebuilds: number;
  imageCreates: number;
  imageReuses: number;
  labelCreates: number;
  labelReuses: number;
}

function emptyBoardRenderCounters(): BoardRenderCounters {
  return {
    stateUpdates: 0,
    drawCalls: 0,
    staticRebuilds: 0,
    dynamicRebuilds: 0,
    imageCreates: 0,
    imageReuses: 0,
    labelCreates: 0,
    labelReuses: 0,
  };
}

export interface BoardCameraProjection {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** Camera origin is normalized in Phaser (default: 0.5 / center). */
  originX?: number;
  originY?: number;
  rotation?: number;
}

/**
 * Project a world point into the camera viewport's local screen coordinates.
 *
 * This mirrors Phaser's camera view transform, including zoom around the
 * camera origin.  Keeping it pure also lets DOM overlay tests avoid
 * constructing a Phaser Scene.
 */
export function projectWorldToScreen(
  world: { x: number; y: number },
  camera: BoardCameraProjection,
): { x: number; y: number } | null {
  const values = [world.x, world.y, camera.x, camera.y, camera.width, camera.height, camera.scrollX, camera.scrollY, camera.zoom];
  if (values.some((value) => !Number.isFinite(value)) || camera.zoom <= 0) return null;
  const originX = camera.width * (camera.originX ?? 0.5);
  const originY = camera.height * (camera.originY ?? 0.5);
  const rotation = camera.rotation ?? 0;
  if (!Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(rotation)) return null;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const relativeX = world.x - camera.scrollX - originX;
  const relativeY = world.y - camera.scrollY - originY;
  const x = camera.x + originX + (relativeX * cosine - relativeY * sine) * camera.zoom;
  const y = camera.y + originY + (relativeX * sine + relativeY * cosine) * camera.zoom;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const HEX_SIZE = 30;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT = HEX_SIZE * 2;
const WORLD_PADDING = 120;
const TERRAIN_TEXTURE_SIZE = HEX_SIZE * 2;
const OVERLAY_TEXTURE_SIZE = HEX_SIZE * 1.85;
const FACILITY_TEXTURE_SIZE = HEX_SIZE * 1.75;
const UNIT_TEXTURE_SIZE = HEX_SIZE * 0.95;
const ROAD_TEXTURE_WIDTH = HEX_WIDTH * 2.2;
const ROAD_TEXTURE_HEIGHT = HEX_HEIGHT;

const TERRAIN_FILL: Record<'plain' | 'forest' | 'mountain' | 'water', number> = {
  plain: 0x12222d,
  forest: 0x1d3d34,
  mountain: 0x3c3b49,
  water: 0x112b48,
};

const TERRAIN_LINE: Record<'plain' | 'forest' | 'mountain' | 'water', number> = {
  plain: 0x344b56,
  forest: 0x477c64,
  mountain: 0x777891,
  water: 0x39749b,
};

const ROAD_DIRECTION_ANGLE: Record<HexDirection, number> = {
  east: 0,
  northEast: -Math.PI / 3,
  northWest: -(2 * Math.PI) / 3,
  west: Math.PI,
  southWest: (2 * Math.PI) / 3,
  southEast: Math.PI / 3,
};

const HEX_EDGE_POINT_INDEX: Record<HexDirection, readonly [number, number]> = {
  east: [5, 0],
  northEast: [4, 5],
  northWest: [3, 4],
  west: [2, 3],
  southWest: [1, 2],
  southEast: [0, 1],
};

const FALLBACK_FACILITY_SYMBOL: Record<string, string> = {
  capital: '◆',
  city: '●',
  farm: 'F',
  civilianFactory: '▣',
  militaryFactory: '⚒',
  refinery: '◈',
  powerPlant: '⚡',
  windPowerPlant: '≋',
  simpleFarm: 'f',
  civilianDroneBase: '✈',
  checkpoint: '▤',
};

const FALLBACK_UNIT_SYMBOL: Record<string, string> = {
  police: 'P',
  nationalGuard: 'G',
  riotPolice: 'RP',
  zombie: 'Z',
  hordeZombie: 'H',
  policeZombie: 'PZ',
  soldierZombie: 'SZ',
  hunterZombie: 'HZ',
};

function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A stable Phaser texture key for one Registry path. */
export function boardTextureKey(assetPath: string): string {
  if (typeof assetPath !== 'string' || assetPath.length === 0) {
    throw new Error('Board asset path must be a non-empty string');
  }
  return `board:${assetPath.replace(/[^a-zA-Z0-9_-]+/gu, '_')}`;
}

/** Classify a browser/Phaser loader error for per-asset fallback reporting. */
export function classifyBoardAssetFailure(error: unknown): BoardAssetFailureKind {
  const value = error as { status?: unknown; code?: unknown; message?: unknown; error?: unknown } | null;
  const status = Number(value?.status);
  const text = [value?.code, value?.message, value?.error, error]
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) => String(entry))
    .join(' ')
    .toLowerCase();
  if (status === 404 || /(?:not found|404|missing)/u.test(text)) return 'missing';
  if (/(?:decode|decoding|bitmap|image data|invalid image|corrupt)/u.test(text)) return 'decode';
  if (/(?:texture|register|cache)/u.test(text)) return 'texture-registration';
  return 'load';
}

/**
 * Return unique axes for the Registry's single horizontal road texture.
 * Multiple axes on one Hex form junctions while neighboring tiles connect.
 */
export function roadTextureRotations(directions: readonly HexDirection[]): readonly number[] {
  const rotations: number[] = [];
  const axes = new Set<number>();
  for (const direction of directions) {
    const angle = ROAD_DIRECTION_ANGLE[direction];
    const normalized = ((angle % Math.PI) + Math.PI) % Math.PI;
    const rounded = Math.round(normalized * 1000000) / 1000000;
    if (!axes.has(rounded)) {
      axes.add(rounded);
      rotations.push(angle);
    }
  }
  if (rotations.length === 0) rotations.push(0);
  return rotations;
}

export const getRoadTextureRotations = roadTextureRotations;

/** Limit a Horde warning to the warned capital-outward road branches. */
export function hordeWarningTileKeys(
  map: Readonly<FixedMap>,
  directions: readonly CardinalDirection[],
): readonly string[] {
  const keys = new Set<string>();
  for (const direction of directions) {
    const branch = map.roadBranches.find((candidate) => candidate.direction === direction);
    if (branch) {
      for (const position of branch.roadTiles) keys.add(hexKey(position));
      continue;
    }
    const entrance = map.hordeEntrances.find((candidate) => candidate.direction === direction);
    if (entrance) keys.add(hexKey(entrance.tile));
  }
  return [...keys];
}

/** Public static overlay for the fixed outer-edge Horde Spawn Reserve. */
export function spawnReserveTileKeys(map: Readonly<FixedMap>): readonly string[] {
  return map.tiles.filter((tile) => tile.playerOccupancyAllowed === false).map((tile) => hexKey(tile));
}

export interface SupplyBoundaryEdge {
  tileKey: string;
  direction: HexDirection;
}

/** Return only edges that separate a supplied Hex from a non-supplied Hex. */
export function supplyBoundaryEdges(
  map: Readonly<FixedMap>,
  suppliedTileKeys: ReadonlySet<string> | readonly string[],
): readonly SupplyBoundaryEdge[] {
  const supplied = suppliedTileKeys instanceof Set ? suppliedTileKeys : new Set(suppliedTileKeys);
  const edges: SupplyBoundaryEdge[] = [];
  for (const tile of map.tiles) {
    const tileKey = hexKey(tile);
    if (!supplied.has(tile.key) && !supplied.has(tileKey)) continue;
    for (const direction of HEX_DIRECTION_ORDER) {
      if (!supplied.has(hexKey(hexNeighbor(tile, direction)))) edges.push({ tileKey, direction });
    }
  }
  return edges;
}

function safeString(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) || 'Board asset load failed';
  } catch {
    return 'Board asset load failed';
  }
}

function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function isUnitVisible(unit: UnitState, visibleTileKeys: ReadonlySet<string>): boolean {
  return unit.actionState !== 'destroyed' && (unit.isPlayerUnit || visibleTileKeys.has(hexKey(unit.position)));
}

function unitColor(unit: UnitState): number {
  if (unit.type === 'zombie') return 0xa24c55;
  if (unit.type === 'hordeZombie') return unit.hordeKind === 'final' ? 0xe07a45 : 0xc8674d;
  if (unit.type === 'policeZombie') return 0x7f4f67;
  if (unit.type === 'soldierZombie') return 0x806b49;
  if ((unit.type as string) === 'riotZombie') return 0x8f5367;
  if ((unit.type as string) === 'hunterZombie') return 0xd86c56;
  if ((unit.type as string) === 'riotPolice') return 0xc6a7d9;
  return unit.type === 'nationalGuard' ? 0xb6d8ff : 0x7fc7a0;
}

function unitLineColor(unit: UnitState, selected: boolean, target: boolean, blocked: boolean): number {
  if (blocked) return 0xff6b64;
  if (unit.hordeKind === 'final') return 0xffcf66;
  if (target) return 0xff8c69;
  if (selected) return 0x9ae9ff;
  return 0x071019;
}

function roleLabelColor(role: string): string {
  if (role === 'active') return '#8ff0d4';
  if (role === 'standby') return '#79c7ff';
  if (role === 'dormant') return '#c4a7f5';
  if (role === 'remnant') return '#d7bd76';
  if (role === 'ruined') return '#ff8d82';
  return '#b895af';
}

export interface CheckpointCandidateMarkerStyle {
  color: number;
  symbol: '✓' | '×';
  lineWidth: number;
  alpha: number;
}

/** Keep legal/invalid checkpoint candidates distinguishable without relying on color alone. */
export function checkpointCandidateMarkerStyle(
  legal: boolean,
  selected: boolean,
): CheckpointCandidateMarkerStyle {
  return {
    color: legal ? (selected ? 0xffd36e : 0x72e0c2) : (selected ? 0xff9a8d : 0xc86f68),
    symbol: legal ? '✓' : '×',
    lineWidth: selected ? 4 : legal ? 2 : 3,
    alpha: selected ? 0.38 : legal ? 0.2 : 0.26,
  };
}

export interface ConstructibleCandidateMarkerStyle {
  color: number;
  symbol: '＋' | '×';
  lineWidth: number;
  alpha: number;
}

/** Dynamic marker shown for a player's Required Power facility that is not
 * expected to receive power when the current turn ends. */
export const UNPOWERED_FACILITY_MARKER = '⚡×';

export function shouldShowUnpoweredFacilityMarker(
  facility: Pick<FacilityState, 'owner'>,
  projection: Pick<ReturnType<typeof forecastFacilityProduction>[number], 'powerMode' | 'projectedPowerSupplied'> | null | undefined,
): boolean {
  return facility.owner === 'player'
    && projection?.powerMode === 'required'
    && projection.projectedPowerSupplied === false;
}

/** Keep Build Mode candidates distinguishable without relying on color alone. */
export function constructibleCandidateMarkerStyle(
  legal: boolean,
  selected: boolean,
): ConstructibleCandidateMarkerStyle {
  return {
    color: legal ? (selected ? 0xffd36e : 0x72e0c2) : (selected ? 0xff9a8d : 0xc86f68),
    symbol: legal ? '＋' : '×',
    lineWidth: selected ? 4 : legal ? 2 : 3,
    alpha: selected ? 0.34 : legal ? 0.2 : 0.26,
  };
}

export class HexBoardScene extends Phaser.Scene {
  private readonly callbacks: BoardCallbacks;

  /** Dynamic-layer Graphics remains named `graphics` for old integrations. */
  private graphics!: Phaser.GameObjects.Graphics;
  private terrainFallbackGraphics!: Phaser.GameObjects.Graphics;
  private roadFallbackGraphics!: Phaser.GameObjects.Graphics;
  private urbanFallbackGraphics!: Phaser.GameObjects.Graphics;
  private facilityBaseFallbackGraphics!: Phaser.GameObjects.Graphics;
  private facilityStateFallbackGraphics!: Phaser.GameObjects.Graphics;
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private unitFallbackGraphics!: Phaser.GameObjects.Graphics;
  private terrainLayer!: Phaser.GameObjects.Container;
  private roadLayer!: Phaser.GameObjects.Container;
  private urbanLayer!: Phaser.GameObjects.Container;
  private facilityBaseLayer!: Phaser.GameObjects.Container;
  private facilityStateLayer!: Phaser.GameObjects.Container;
  private fogLayer!: Phaser.GameObjects.Container;
  private unitLayer!: Phaser.GameObjects.Container;
  private dynamicLayer!: Phaser.GameObjects.Container;
  private layersReady = false;

  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly activeLabelKeys = new Set<string>();
  /** Image instances are retained per layer and rebound to the next pass. */
  private readonly imagePools = new Map<Phaser.GameObjects.Container, Phaser.GameObjects.Image[]>();
  private readonly imagePoolCursors = new Map<Phaser.GameObjects.Container, number>();
  private readonly assetStatuses = new Map<string, BoardAssetStatus>();
  private readonly assetPathByKey = new Map<string, string>();
  private readonly warnedAssetPaths = new Set<string>();
  private assetLoadComplete = false;
  private current: BoardRenderState | null = null;
  private dragStart: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private pointerDown: { x: number; y: number; screenX: number; screenY: number } | null = null;
  private readonly pinchPointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private pinchZoom = 1;
  private pendingZoom: { next: number; screenX: number; screenY: number } | null = null;
  private zoomFrameScheduled = false;
  private cameraInitialized = false;
  private readonly zoomMin = BOARD_MIN_ZOOM;
  private readonly zoomMax = BOARD_MAX_ZOOM;
  /** Each layer has its own immutable-input key. Engine commits clone the
   * state tree, so object identity alone cannot decide whether map pixels or
   * a facility/unit base really changed. */
  private mapStaticKey: string | null = null;
  private facilityBaseKey: string | null = null;
  private facilityStateKey: string | null = null;
  private unitKey: string | null = null;
  private fogKey: string | null = null;
  private fogDirty = true;
  private staticLod: boolean | null = null;
  private staticDirty = true;
  private readonly renderCounters = emptyBoardRenderCounters();

  constructor(callbacks: BoardCallbacks) {
    super({ key: 'hex-board' });
    this.callbacks = callbacks;
  }

  /** Queue every Registry path before Scene.create; each file is independent. */
  preload(): void {
    this.initializeAssetTracking();
    this.emitProgress(true, 0);

    const paths = [...this.assetStatuses.keys()];
    if (!this.load || !this.textures) {
      for (const path of paths) this.markAssetFailure(path, 'load', 'Phaser loader is unavailable');
      this.finishAssetLoad();
      return;
    }

    this.load.on('progress', this.handleLoaderProgress, this);
    this.load.on('fileprogress', this.handleFileProgress, this);
    this.load.on('filecomplete', this.handleFileComplete, this);
    this.load.on('loaderror', this.handleLoadError, this);
    this.load.once('complete', this.handleAssetLoadComplete, this);

    let queued = 0;
    for (const path of paths) {
      const key = boardTextureKey(path);
      if (this.hasRegisteredTexture(key)) {
        const status = this.assetStatuses.get(path);
        if (status) status.state = 'ready';
        continue;
      }
      try {
        this.load.image(key, resolveBoardAssetUrl(path));
        queued += 1;
      } catch (error) {
        this.markAssetFailure(path, classifyBoardAssetFailure(error), safeString(error));
      }
    }
    if (queued === 0) this.finishAssetLoad();
  }

  create(): void {
    this.createRenderLayers();
    this.cameras.main.setBackgroundColor('#071019');
    this.events.once('shutdown', this.handleShutdown, this);
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerout', this.handlePointerUp, this);
    this.input.on('wheel', this.handleWheel, this);
    this.scale.on('resize', this.handleResize, this);
    this.handleResize(this.scale.gameSize);
    if (this.current) this.draw(this.current);
  }

  updateState(next: BoardRenderState): void {
    this.current = next;
    this.renderCounters.stateUpdates += 1;
    const lod = this.boardLodActive();
    if (this.staticLod !== lod) this.staticDirty = true;
    if (this.graphics) this.draw(next);
    this.invokeViewChange();
  }

  /** Return a snapshot so callers cannot mutate the board's measurements. */
  public getRenderCounters(): Readonly<BoardRenderCounters> {
    return { ...this.renderCounters };
  }

  public resetRenderCounters(): void {
    Object.assign(this.renderCounters, emptyBoardRenderCounters());
  }

  /**
   * Return a Hex center in board-canvas-relative screen coordinates.
   *
   * DOM controls live above the canvas, while Phaser's world coordinates are
   * affected by camera scroll and zoom.  Keep this conversion on the board so
   * the controller does not need to duplicate camera math.
   */
  public projectHexToScreen(position: HexCoord): { x: number; y: number } | null {
    if (!this.current || !position || !this.cameras?.main) return null;
    const tile = this.current.state.map.tiles.find((candidate) => sameHex(candidate, position));
    if (!tile) return null;
    const camera = this.cameras.main;
    return projectWorldToScreen(this.hexToWorld(this.current.state, tile), {
      x: camera.x,
      y: camera.y,
      width: camera.width,
      height: camera.height,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: camera.zoom,
      originX: camera.originX,
      originY: camera.originY,
    });
  }

  /**
   * Center the camera on a public site coordinate selected from the event
   * history.  Site coordinates are public; this method never accepts or
   * resolves a hidden spawned-unit coordinate.
   */
  public focusHex(position: HexCoord): void {
    if (!this.current || !this.cameras?.main) return;
    const tile = this.current.state.map.tiles.find((candidate) => sameHex(candidate, position));
    if (!tile) return;
    const center = this.hexToWorld(this.current.state, tile);
    this.cameras.main.centerOn(center.x, center.y);
    this.cameraInitialized = true;
    this.invokeViewChange();
  }

  private invokeViewChange(): void {
    try {
      this.callbacks.onViewChange?.();
    } catch {
      // DOM overlay observers cannot stop camera input or rendering.
    }
  }

  private invokeBlankTap(): void {
    try {
      this.callbacks.onBlankTap?.();
    } catch {
      // Optional DOM observers cannot stop Phaser pointer handling.
    }
  }

  private invokeTileTap(position: HexCoord): void {
    try {
      this.callbacks.onTileTap(position);
    } catch {
      // Controller callbacks are observers of Phaser input; an exception must
      // not leave the pointer gesture state active or break the Scene.
    }
  }

  private initializeAssetTracking(): void {
    this.assetStatuses.clear();
    this.assetPathByKey.clear();
    this.warnedAssetPaths.clear();
    this.assetLoadComplete = false;
    for (const path of [...new Set(BOARD_ASSET_PATHS)]) {
      const key = boardTextureKey(path);
      this.assetStatuses.set(path, { path, key, state: 'pending', failure: null });
      this.assetPathByKey.set(key, path);
    }
  }

  private createRenderLayers(): void {
    if (this.layersReady) return;
    const createLayer = (name: string, depth: number): Phaser.GameObjects.Container => this.add.container(0, 0).setName(name).setDepth(depth);
    this.terrainLayer = createLayer(BOARD_RENDER_LAYER_ORDER[0], 10);
    this.roadLayer = createLayer(BOARD_RENDER_LAYER_ORDER[1], 20);
    this.urbanLayer = createLayer(BOARD_RENDER_LAYER_ORDER[2], 30);
    this.facilityBaseLayer = createLayer(BOARD_RENDER_LAYER_ORDER[3], 40);
    this.facilityStateLayer = createLayer(BOARD_RENDER_LAYER_ORDER[4], 50);
    this.fogLayer = createLayer(BOARD_RENDER_LAYER_ORDER[5], 60);
    this.unitLayer = createLayer(BOARD_RENDER_LAYER_ORDER[6], 70);
    this.dynamicLayer = createLayer(BOARD_RENDER_LAYER_ORDER[7], 80);

    this.terrainFallbackGraphics = this.add.graphics();
    this.roadFallbackGraphics = this.add.graphics();
    this.urbanFallbackGraphics = this.add.graphics();
    this.facilityBaseFallbackGraphics = this.add.graphics();
    this.facilityStateFallbackGraphics = this.add.graphics();
    this.fogGraphics = this.add.graphics();
    this.unitFallbackGraphics = this.add.graphics();
    this.graphics = this.add.graphics();
    this.terrainLayer.add(this.terrainFallbackGraphics);
    this.roadLayer.add(this.roadFallbackGraphics);
    this.urbanLayer.add(this.urbanFallbackGraphics);
    this.facilityBaseLayer.add(this.facilityBaseFallbackGraphics);
    this.facilityStateLayer.add(this.facilityStateFallbackGraphics);
    this.fogLayer.add(this.fogGraphics);
    this.unitLayer.add(this.unitFallbackGraphics);
    this.dynamicLayer.add(this.graphics);
    this.layersReady = true;
  }

  private handleLoaderProgress(progress: number): void {
    this.emitProgress(true, clampProgress(progress));
  }

  private handleFileProgress(file: unknown, progress: number): void {
    void file;
    void progress;
  }

  private handleFileComplete(key: unknown, type: unknown): void {
    if (type !== 'image') return;
    const path = this.assetPathByKey.get(String(key));
    if (!path) return;
    const status = this.assetStatuses.get(path);
    if (status && status.state !== 'failed') status.state = 'loaded';
    this.emitProgress(true, this.loadedCount() / Math.max(1, this.assetStatuses.size));
  }

  private handleLoadError(file: unknown): void {
    const payload = file as { key?: unknown; error?: unknown; src?: unknown } | null;
    const key = String(payload?.key ?? '');
    const path = this.assetPathByKey.get(key);
    if (!path) return;
    const error = payload?.error ?? payload?.src ?? 'Board image failed to load';
    this.markAssetFailure(path, classifyBoardAssetFailure(payload ?? error), safeString(error));
  }

  private handleAssetLoadComplete(): void {
    this.finishAssetLoad();
  }

  private finishAssetLoad(): void {
    if (this.assetLoadComplete) return;
    for (const [path, status] of this.assetStatuses) {
      if (status.state === 'failed') continue;
      if (this.hasRegisteredTexture(status.key)) status.state = 'ready';
      else this.markAssetFailure(path, 'texture-registration', 'Image loaded but texture registration failed');
    }
    this.assetLoadComplete = true;
    // A scene may receive its first state while assets are still loading.
    // Rebuild the static pools once textures become ready, while retaining
    // all already allocated instances.
    this.staticDirty = true;
    this.emitProgress(false, 1);
    const summary = this.assetSummary();
    this.invokeReady(this.callbacks.onReady, summary);
    this.invokeReady(this.callbacks.onAssetsReady, summary);
    this.invokeReady(this.callbacks.onAssetReady, summary);
    if (this.current && this.layersReady) this.draw(this.current);
  }

  private invokeReady(callback: ((summary: BoardAssetLoadSummary) => void) | undefined, summary: BoardAssetLoadSummary): void {
    if (!callback) return;
    try {
      callback(summary);
    } catch {
      // Optional observers cannot stop the board from becoming playable.
    }
  }

  private emitProgress(loading: boolean, loaderProgress: number): void {
    const total = this.assetStatuses.size;
    const loaded = this.loadedCount();
    const failed = [...this.assetStatuses.values()].filter((status) => status.state === 'failed').length;
    const progress: BoardAssetProgress = {
      loading,
      phase: loading ? 'loading' : 'ready',
      progress: loading ? clampProgress(loaderProgress) : 1,
      loaded,
      total,
      failed,
    };
    this.invokeProgress(this.callbacks.onProgress, progress);
    this.invokeProgress(this.callbacks.onAssetProgress, progress);
    this.invokeLoading(progress);
  }

  private invokeProgress(callback: ((progress: BoardAssetProgress) => void) | undefined, progress: BoardAssetProgress): void {
    if (!callback) return;
    try {
      callback(progress);
    } catch {
      // Optional observers cannot stop rendering.
    }
  }

  private invokeLoading(progress: BoardAssetProgress): void {
    if (!this.callbacks.onLoading) return;
    try {
      this.callbacks.onLoading(progress);
    } catch {
      // Optional observers cannot stop rendering.
    }
  }

  private loadedCount(): number {
    return [...this.assetStatuses.values()].filter((status) => status.state === 'loaded' || status.state === 'ready').length;
  }

  private assetSummary(): BoardAssetLoadSummary {
    const assets = [...this.assetStatuses.values()].map((status) => ({ ...status }));
    return {
      total: assets.length,
      loaded: assets.filter((status) => status.state === 'ready').length,
      failed: assets.filter((status) => status.state === 'failed').length,
      assets,
    };
  }

  private markAssetFailure(path: string, kind: BoardAssetFailureKind, message: string): void {
    const status = this.assetStatuses.get(path);
    if (!status || status.state === 'failed') return;
    status.state = 'failed';
    status.failure = kind;
    status.message = message;
    if (this.warnedAssetPaths.has(path)) return;
    this.warnedAssetPaths.add(path);
    const warning: BoardAssetWarning = { path, key: status.key, kind, message };
    this.invokeWarning(this.callbacks.onWarning, warning);
    this.invokeWarning(this.callbacks.onAssetWarning, warning);
  }

  private invokeWarning(callback: ((warning: BoardAssetWarning) => void) | undefined, warning: BoardAssetWarning): void {
    if (!callback) return;
    try {
      callback(warning);
    } catch {
      // Warning sinks are informational.
    }
  }

  private hasRegisteredTexture(key: string): boolean {
    try {
      if (!this.textures || !this.textures.exists(key)) return false;
      const texture = this.textures.get(key) as { key?: unknown } | undefined;
      if (!texture) return true;
      const textureKey = String(texture.key ?? '');
      return textureKey.length === 0 || (textureKey !== '__MISSING' && textureKey !== '__DEFAULT');
    } catch {
      return false;
    }
  }

  private assetReady(path: string | null): boolean {
    return Boolean(path && this.assetStatuses.get(path)?.state === 'ready');
  }

  private boardLodActive(): boolean {
    return Boolean(this.cameras.main && Number.isFinite(this.cameras.main.zoom) && this.cameras.main.zoom < BOARD_LOD_ZOOM_THRESHOLD);
  }

  private clearLayer(layer: Phaser.GameObjects.Container, preserved: Phaser.GameObjects.GameObject): void {
    for (const child of [...layer.list]) {
      if (child !== preserved) layer.remove(child, true);
    }
  }

  private clearRenderLayers(): void {
    this.clearStaticRenderLayers();
    this.clearDynamicRenderLayers();
  }

  private clearStaticRenderLayers(): void {
    this.clearLayerRender(this.terrainLayer, this.terrainFallbackGraphics);
    this.clearLayerRender(this.roadLayer, this.roadFallbackGraphics);
    this.clearLayerRender(this.urbanLayer, this.urbanFallbackGraphics);
    this.clearLayerRender(this.facilityBaseLayer, this.facilityBaseFallbackGraphics);
    this.clearLayerRender(this.facilityStateLayer, this.facilityStateFallbackGraphics);
    this.clearLayerRender(this.unitLayer, this.unitFallbackGraphics);
  }

  private clearLayerRender(layer: Phaser.GameObjects.Container, fallback: Phaser.GameObjects.Graphics): void {
    fallback.clear();
    for (const image of this.imagePools.get(layer) ?? []) image.setVisible(false);
    this.imagePoolCursors.delete(layer);
  }

  private clearDynamicRenderLayers(clearFog = true): void {
    if (clearFog) {
      this.fogGraphics.clear();
      this.fogKey = null;
      this.fogDirty = true;
    }
    this.graphics.clear();
    this.activeLabelKeys.clear();
    // Keep Text objects alive.  Rebinding them by key avoids allocating a new
    // label for every selection/overlay update.
    for (const label of this.labels.values()) label.setVisible(false);
  }

  private handleResize(size: { width: number; height: number }): void {
    if (!this.cameras.main) return;
    if (this.current) this.configureCamera(this.current.state, !this.cameraInitialized, size);
    this.invokeViewChange();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    this.pinchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.pinchPointers.size >= 2) {
      const points = [...this.pinchPointers.values()];
      this.pinchDistance = distance(points[0]!, points[1]!);
      this.pinchZoom = this.cameras.main.zoom;
      this.dragStart = null;
      this.pointerDown = null;
      return;
    }
    this.pointerDown = { x: pointer.x, y: pointer.y, screenX: pointer.x, screenY: pointer.y };
    this.dragStart = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.pinchPointers.has(pointer.id)) this.pinchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.pinchPointers.size >= 2 && this.pinchDistance > 0) {
      const points = [...this.pinchPointers.values()];
      this.setZoom(this.pinchZoom * (distance(points[0]!, points[1]!) / this.pinchDistance), pointer.x, pointer.y);
      return;
    }
    if (!this.dragStart || !pointer.isDown) return;
    const zoom = this.cameras.main.zoom;
    const nextScrollX = this.dragStart.scrollX - (pointer.x - this.dragStart.x) / zoom;
    const nextScrollY = this.dragStart.scrollY - (pointer.y - this.dragStart.y) / zoom;
    if (nextScrollX === this.cameras.main.scrollX && nextScrollY === this.cameras.main.scrollY) return;
    this.cameras.main.scrollX = nextScrollX;
    this.cameras.main.scrollY = nextScrollY;
    this.invokeViewChange();
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const wasPinching = this.pinchPointers.size >= 2;
    if (wasPinching) this.flushPendingZoom();
    this.pinchPointers.delete(pointer.id);
    if (this.pinchPointers.size < 2) this.pinchDistance = 0;
    if (wasPinching || !this.pointerDown) {
      if (this.pinchPointers.size === 0) {
        this.dragStart = null;
        this.pointerDown = null;
      }
      return;
    }
    const moved = Math.hypot(pointer.x - this.pointerDown.x, pointer.y - this.pointerDown.y);
    const position = this.worldToHex(pointer.x, pointer.y);
    this.dragStart = null;
    this.pointerDown = null;
    if (moved < 12) {
      if (position) this.invokeTileTap(position);
      else this.invokeBlankTap();
    }
  }

  private handleWheel(pointer: Phaser.Input.Pointer, _gameObjects: unknown, deltaX: number, deltaY: number): void {
    const baseZoom = this.pendingZoom?.next ?? this.cameras.main.zoom;
    this.setZoom(baseZoom * (deltaY > 0 ? 0.9 : 1.1), pointer.x, pointer.y);
    void deltaX;
  }

  private setZoom(next: number, screenX: number, screenY: number): void {
    this.pendingZoom = { next, screenX, screenY };
    if (this.zoomFrameScheduled) return;
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      this.flushPendingZoom();
      return;
    }
    this.zoomFrameScheduled = true;
    globalThis.requestAnimationFrame(() => {
      this.zoomFrameScheduled = false;
      this.flushPendingZoom();
    });
  }

  private flushPendingZoom(): void {
    const pending = this.pendingZoom;
    this.pendingZoom = null;
    if (!pending) return;
    const camera = this.cameras.main;
    const beforeLod = this.boardLodActive();
    const before = camera.getWorldPoint(pending.screenX, pending.screenY);
    camera.setZoom(Phaser.Math.Clamp(pending.next, this.zoomMin, this.zoomMax));
    const after = camera.getWorldPoint(pending.screenX, pending.screenY);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
    if (this.current) {
      this.configureCamera(this.current.state, false, this.scale.gameSize);
      if (beforeLod !== this.boardLodActive()) {
        this.staticDirty = true;
        if (this.graphics) this.draw(this.current);
      }
    }
    this.invokeViewChange();
  }

  private configureCamera(state: Readonly<GameState>, center: boolean, size: { width: number; height: number }): void {
    const camera = this.cameras.main;
    const bounds = this.mapBounds(state);
    camera.setBounds(0, 0, Math.max(bounds.width, size.width / camera.zoom), Math.max(bounds.height, size.height / camera.zoom));
    if (center) {
      const capital = state.facilities.find((facility) => facility.type === 'capital');
      const focus = capital ? this.hexToWorld(state, capital.position) : bounds.center;
      camera.centerOn(focus.x, focus.y);
      this.cameraInitialized = true;
    }
  }

  private mapBounds(state: Readonly<GameState>): { width: number; height: number; center: { x: number; y: number } } {
    const origin = this.mapOrigin(state);
    const maxCenterX = origin.x + HEX_WIDTH * ((state.map.width - 1) + (state.map.height - 1) / 2);
    const maxCenterY = origin.y + HEX_SIZE * 1.5 * (state.map.height - 1);
    const width = maxCenterX + HEX_WIDTH / 2 + WORLD_PADDING;
    const height = maxCenterY + HEX_HEIGHT / 2 + WORLD_PADDING;
    return { width, height, center: { x: width / 2, y: height / 2 } };
  }

  private mapOrigin(_state: Readonly<GameState>): { x: number; y: number } {
    return { x: WORLD_PADDING + HEX_WIDTH / 2, y: WORLD_PADDING + HEX_HEIGHT / 2 };
  }

  private hexToWorld(state: Readonly<GameState>, position: HexCoord): { x: number; y: number } {
    const origin = this.mapOrigin(state);
    return { x: origin.x + HEX_WIDTH * (position.q + position.r / 2), y: origin.y + HEX_SIZE * 1.5 * position.r };
  }

  private worldToHex(screenX: number, screenY: number): HexCoord | null {
    if (!this.current) return null;
    const point = this.cameras.main.getWorldPoint(screenX, screenY);
    let nearest: { position: HexCoord; distance: number } | null = null;
    for (const tile of this.current.state.map.tiles) {
      const candidate = distance(point, this.hexToWorld(this.current.state, tile));
      if (candidate <= HEX_SIZE * 1.08 && (!nearest || candidate < nearest.distance)) nearest = { position: { q: tile.q, r: tile.r }, distance: candidate };
    }
    return nearest?.position ?? null;
  }

  private hexPoints(center: { x: number; y: number }): Phaser.Math.Vector2[] {
    return Array.from({ length: 6 }, (_, index) => {
      const angle = Phaser.Math.DegToRad(60 * index + 30);
      return new Phaser.Math.Vector2(center.x + HEX_SIZE * Math.cos(angle), center.y + HEX_SIZE * Math.sin(angle));
    });
  }

  private mapRenderKey(state: Readonly<GameState>): string {
    // FixedMap is immutable by contract and mapId changes whenever the map
    // definition changes. Include dimensions so test/integration maps with a
    // reused id still invalidate their static terrain layer.
    return `${state.map.id}:${state.map.width}x${state.map.height}`;
  }

  private facilityBaseRenderKey(state: Readonly<GameState>): string {
    const facilities = state.facilities.map((facility) =>
      `${facility.id}:${facility.type}:${facility.position.q},${facility.position.r}`,
    );
    const checkpoints = state.checkpoints.map((checkpoint) =>
      `${checkpoint.id}:${checkpoint.position.q},${checkpoint.position.r}`,
    );
    return `${facilities.join('|')}#${checkpoints.join('|')}`;
  }

  private facilityStateRenderKey(state: Readonly<GameState>): string {
    const facilities = state.facilities.map((facility) =>
      `${facility.id}:${facility.owner}:${facility.status}:${facility.operationalStatus}:${facility.infected}`,
    );
    const checkpoints = state.checkpoints.map((checkpoint) =>
      `${checkpoint.id}:${checkpoint.status}:${checkpoint.infected}`,
    );
    return `${facilities.join('|')}#${checkpoints.join('|')}`;
  }

  private unitRenderKey(state: Readonly<GameState>, visibleTileKeys: ReadonlySet<string>): string {
    const visible = [...visibleTileKeys].sort().join(',');
    const units = state.units
      .filter((unit) => isUnitVisible(unit, visibleTileKeys))
      .map((unit) => `${unit.id}:${unit.type}:${unit.hordeKind ?? ''}:${unit.actionState}:${unit.position.q},${unit.position.r}`)
      .join('|');
    return `${visible}#${units}`;
  }

  private draw(render: BoardRenderState): void {
    if (!this.layersReady) return;
    this.renderCounters.drawCalls += 1;
    const { state } = render;
    const t = createTranslator(render.locale ?? 'ja');
    const legal = new Set((render.legalDestinations ?? []).map((position) => hexKey(position)));
    const path = new Set((render.pendingPath ?? []).map((position) => hexKey(position)));
    const attackTargets = new Set(render.attackTargetIds ?? []);
    const suppliedTiles = new Set(render.suppliedTileKeys ?? []);
    // Build candidate markers were intentionally removed from Human UI in
    // v1.4.5. Keep the board-wide marker pass strictly for Relocate; callers
    // must opt into that mode explicitly, so stale/legacy Build arrays cannot
    // reappear on the board.
    const checkpointPreviewEnabled = render.checkpointPreviewMode === 'relocate';
    const checkpointLegalPreview = checkpointPreviewEnabled
      ? new Set((render.checkpointLegalPreviewPositions ?? []).map((position) => hexKey(position)))
      : new Set<string>();
    const checkpointInvalidPreview = checkpointPreviewEnabled
      ? new Set((render.checkpointInvalidPreviewPositions ?? []).map((position) => hexKey(position)))
      : new Set<string>();
    const selectedCheckpointPreview = render.checkpointPreviewSelected ? hexKey(render.checkpointPreviewSelected) : null;
    const constructibleLegalPreview = new Set((render.constructibleFacilityLegalPreviewPositions ?? []).map((position) => hexKey(position)));
    const constructibleInvalidPreview = new Set((render.constructibleFacilityInvalidPreviewPositions ?? []).map((position) => hexKey(position)));
    const selectedConstructiblePreview = render.constructibleFacilityPreviewSelected ? hexKey(render.constructibleFacilityPreviewSelected) : null;
    const blockedZombies = new Set(render.blockedZombieIds ?? []);
    const selected = render.selectedPosition;
    const hordeDirections = [...new Set(render.hordeDirections ?? [])];
    const hordeWarningType = render.hordeWarningType ?? 'periodic';
    // The visibility union is computed by Core.  Keep the fallback for
    // callers that construct a minimal BoardRenderState in isolation, but do
    // not derive LOS in this Phaser adapter.
    const visionCoverage = render.visionCoverage ?? getPlayerVisionCoverage(state);
    const visibleTileKeys = visionCoverage.visible ?? getPlayerVisibleTileKeys(state);
    const selectedVision = render.selectedVision ?? null;
    const hordeRouteKeys = new Set(hordeWarningTileKeys(state.map, hordeDirections));
    const hordeEntranceKeys = new Set(
      state.map.hordeEntrances
        .filter((candidate) => hordeDirections.includes(candidate.direction))
        .map((candidate) => hexKey(candidate.tile)),
    );
    const reserveKeys = new Set(render.spawnReserveTileKeys ?? spawnReserveTileKeys(state.map));
    const capital = state.facilities.find((facility) => facility.type === 'capital');
    const hordeTarget = capital ? this.hexToWorld(state, capital.position) : null;
    const productionByFacility = this.productionMap(state, render.facilityProduction);
    const facilitiesByTile = new Map<string, FacilityState>();
    for (const facility of state.facilities) facilitiesByTile.set(hexKey(facility.position), facility);
    const checkpointsByTile = new Map<string, CheckpointState>();
    for (const checkpoint of state.checkpoints) checkpointsByTile.set(hexKey(checkpoint.position), checkpoint);
    const unitsByTile = new Map<string, UnitState[]>();
    for (const unit of state.units) {
      const units = unitsByTile.get(hexKey(unit.position)) ?? [];
      units.push(unit);
      unitsByTile.set(hexKey(unit.position), units);
    }

    const lod = this.boardLodActive();
    const mapKey = this.mapRenderKey(state);
    const facilityBaseKey = this.facilityBaseRenderKey(state);
    const facilityStateKey = this.facilityStateRenderKey(state);
    const unitKey = this.unitRenderKey(state, visibleTileKeys);
    const nextFogKey = `${mapKey}:${render.visibilityOverlay !== false}:${[...visibleTileKeys].sort().join(',')}`;
    const lodChanged = this.staticLod !== lod;
    const rebuildMap = this.staticDirty || lodChanged || this.mapStaticKey !== mapKey;
    const rebuildFacilityBase = rebuildMap || lodChanged || this.facilityBaseKey !== facilityBaseKey;
    const rebuildFacilityState = rebuildMap || lodChanged || this.facilityStateKey !== facilityStateKey;
    // A newly built/removed Facility or Checkpoint changes stacked Unit
    // offsets even when no Unit field changed, so keep the Unit layer coupled
    // to the base occupancy key.
    const rebuildUnits = rebuildMap || rebuildFacilityBase || lodChanged || this.unitKey !== unitKey;
    if (rebuildMap || rebuildFacilityBase || rebuildFacilityState || rebuildUnits) {
      this.renderCounters.staticRebuilds += 1;
    }

    // Terrain and overlays are map-static. Engine commits clone the state,
    // but this layer remains untouched when only a Unit or Facility state
    // changes.
    if (rebuildMap) {
      this.clearLayerRender(this.terrainLayer, this.terrainFallbackGraphics);
      this.beginImagePass(this.terrainLayer);
      for (const tile of state.map.tiles) this.drawTerrainPass(state, tile);
      this.endImagePass(this.terrainLayer);

      this.clearLayerRender(this.roadLayer, this.roadFallbackGraphics);
      this.beginImagePass(this.roadLayer);
      for (const tile of state.map.tiles) this.drawRoadPass(state, tile);
      this.endImagePass(this.roadLayer);

      this.clearLayerRender(this.urbanLayer, this.urbanFallbackGraphics);
      this.beginImagePass(this.urbanLayer);
      for (const tile of state.map.tiles) this.drawUrbanPass(state, tile);
      this.endImagePass(this.urbanLayer);
      this.mapStaticKey = mapKey;
    }

    if (rebuildFacilityBase) {
      this.clearLayerRender(this.facilityBaseLayer, this.facilityBaseFallbackGraphics);
      this.beginImagePass(this.facilityBaseLayer);
      for (const tile of state.map.tiles) {
        const key = hexKey(tile);
        const center = this.hexToWorld(state, tile);
        const facility = facilitiesByTile.get(key);
        const checkpoint = checkpointsByTile.get(key);
        if (facility) this.drawFacilityBasePass(facility, center);
        if (checkpoint) this.drawCheckpointBasePass(checkpoint, center);
      }
      this.endImagePass(this.facilityBaseLayer);
      this.facilityBaseKey = facilityBaseKey;
    }

    if (rebuildFacilityState) {
      this.clearLayerRender(this.facilityStateLayer, this.facilityStateFallbackGraphics);
      this.beginImagePass(this.facilityStateLayer);
      for (const tile of state.map.tiles) {
        const key = hexKey(tile);
        const center = this.hexToWorld(state, tile);
        const facility = facilitiesByTile.get(key);
        const checkpoint = checkpointsByTile.get(key);
        if (facility) this.drawFacilityStatePass(facility, productionByFacility.get(facility.id), center);
        if (checkpoint) this.drawCheckpointStatePass(checkpoint, center);
      }
      this.endImagePass(this.facilityStateLayer);
      this.facilityStateKey = facilityStateKey;
    }

    if (rebuildUnits) {
      this.clearLayerRender(this.unitLayer, this.unitFallbackGraphics);
      this.beginImagePass(this.unitLayer);
      for (const tile of state.map.tiles) {
        const key = hexKey(tile);
        const facility = facilitiesByTile.get(key);
        const checkpoint = checkpointsByTile.get(key);
        const units = (unitsByTile.get(key) ?? []).filter((unit) => isUnitVisible(unit, visibleTileKeys));
        units.forEach((unit, index) => this.drawUnitPass(unit, this.hexToWorld(state, tile), getFacilityUnitOffset(Boolean(facility || checkpoint)), index, units.length));
      }
      this.endImagePass(this.unitLayer);
      this.unitKey = unitKey;
    }

    this.staticLod = lod;
    this.staticDirty = false;

    const rebuildFog = this.fogDirty || this.fogKey !== nextFogKey;
    if (rebuildFog) {
      this.fogGraphics.clear();
      for (const tile of state.map.tiles) {
        if (render.visibilityOverlay !== false && !this.tileVisible(tile, visibleTileKeys)) {
          const points = this.hexPoints(this.hexToWorld(state, tile));
          this.fogGraphics.fillStyle(0x02070b, 0.57);
          this.fogGraphics.fillPoints(points, true);
          this.fogGraphics.lineStyle(1, 0x142b34, 0.75);
          this.fogGraphics.strokePoints(points, true);
        }
      }
      this.fogKey = nextFogKey;
      this.fogDirty = false;
    }
    this.renderCounters.dynamicRebuilds += 1;
    this.clearDynamicRenderLayers(false);
    for (const tile of state.map.tiles) {
      const key = hexKey(tile);
      const center = this.hexToWorld(state, tile);
      const facility = facilitiesByTile.get(key);
      const checkpoint = checkpointsByTile.get(key);
      const tileSelected = selected ? sameHex(selected, tile) : false;
      this.drawTileDynamic(state, tile, center, key, tileSelected, legal.has(key), path.has(key), hordeRouteKeys.has(key), hordeEntranceKeys.has(key), reserveKeys.has(key), hordeTarget, hordeWarningType, selectedVision, render, suppliedTiles, checkpointLegalPreview, checkpointInvalidPreview, selectedCheckpointPreview, constructibleLegalPreview, constructibleInvalidPreview, selectedConstructiblePreview);
      if (facility) this.drawFacilityDynamic(facility, productionByFacility.get(facility.id), center, tileSelected, render, suppliedTiles, key, t);
      if (checkpoint) this.drawCheckpointDynamic(state, checkpoint, center, tileSelected, suppliedTiles, key, t);
      const units = (unitsByTile.get(key) ?? []).filter((unit) => isUnitVisible(unit, visibleTileKeys));
      units.forEach((unit, index) => this.drawUnitDynamic(unit, center, getFacilityUnitOffset(Boolean(facility || checkpoint)), index, units.length, tileSelected, render, suppliedTiles, key, attackTargets, blockedZombies, t));
    }
    if (render.supplyOverlay) this.drawSupplyBoundary(state, suppliedTiles);
    if (render.pendingPath && render.pendingPath.length > 1) {
      this.graphics.lineStyle(3, 0xffcf66, 0.9);
      const points = render.pendingPath.map((position) => this.hexToWorld(state, position));
      this.graphics.beginPath();
      this.graphics.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) this.graphics.lineTo(point.x, point.y);
      this.graphics.strokePath();
    }
    for (const [key, label] of this.labels) if (!this.activeLabelKeys.has(key)) label.setVisible(false);
  }

  private productionMap(
    state: Readonly<GameState>,
    projections?: readonly ReturnType<typeof forecastFacilityProduction>[number][],
  ): Map<string, ReturnType<typeof forecastFacilityProduction>[number]> {
    try {
      return new Map((projections ?? forecastFacilityProduction(state)).map((projection) => [projection.facilityId, projection]));
    } catch {
      return new Map();
    }
  }

  private tileVisible(tile: HexTile, visibleTileKeys: ReadonlySet<string>): boolean {
    return visibleTileKeys.has(tile.key) || visibleTileKeys.has(hexKey(tile));
  }

  private drawTerrainPass(state: Readonly<GameState>, tile: HexTile): void {
    const center = this.hexToWorld(state, tile);
    const mapping = mapTerrainAsset(tile.terrain);
    if (this.boardLodActive()) {
      this.drawTerrainFallbackAtLod(center, tile.terrain);
      return;
    }
    if (this.drawTexture(this.terrainLayer, mapping.path, center, TERRAIN_TEXTURE_SIZE, TERRAIN_TEXTURE_SIZE)) return;
    this.terrainFallbackGraphics.fillStyle(TERRAIN_FILL[tile.terrain], 1);
    this.terrainFallbackGraphics.lineStyle(1, TERRAIN_LINE[tile.terrain], 1);
    this.terrainFallbackGraphics.fillPoints(this.hexPoints(center), true);
    this.terrainFallbackGraphics.strokePoints(this.hexPoints(center), true);
    this.drawTerrainPattern(this.terrainFallbackGraphics, center, tile.terrain);
  }

  private drawRoadPass(state: Readonly<GameState>, tile: HexTile): void {
    if (!tile.road) return;
    const center = this.hexToWorld(state, tile);
    const path = BOARD_ASSET_REGISTRY.overlays.road;
    const directions = deriveRoadConnectionDirections(tile, state.map.tiles);
    if (!this.boardLodActive() && this.assetReady(path)) {
      for (const rotation of roadTextureRotations(directions)) this.drawTexture(this.roadLayer, path, center, ROAD_TEXTURE_WIDTH, ROAD_TEXTURE_HEIGHT, rotation);
      return;
    }
    this.drawRoadFallback(center, directions);
  }

  private drawUrbanPass(state: Readonly<GameState>, tile: HexTile): void {
    if (!isUrbanHex(state, tile)) return;
    const center = this.hexToWorld(state, tile);
    const path = BOARD_ASSET_REGISTRY.overlays.urban;
    if (!this.boardLodActive() && this.drawTexture(this.urbanLayer, path, center, OVERLAY_TEXTURE_SIZE, OVERLAY_TEXTURE_SIZE)) return;
    this.drawUrbanFallback(this.urbanFallbackGraphics, center);
  }

  private drawFacilityBasePass(facility: FacilityState, center: { x: number; y: number }): void {
    const path = mapFacilityAssetLayers(facility).base;
    if (!this.boardLodActive() && this.drawTexture(this.facilityBaseLayer, path, center, FACILITY_TEXTURE_SIZE, FACILITY_TEXTURE_SIZE)) return;
    this.drawFacilityFallbackBase(this.facilityBaseFallbackGraphics, center, facility.type);
  }

  private drawCheckpointBasePass(checkpoint: CheckpointState, center: { x: number; y: number }): void {
    const path = mapCheckpointAssetLayers(checkpoint).base;
    if (!this.boardLodActive() && this.drawTexture(this.facilityBaseLayer, path, center, FACILITY_TEXTURE_SIZE, FACILITY_TEXTURE_SIZE)) return;
    this.drawFacilityFallbackBase(this.facilityBaseFallbackGraphics, center, 'checkpoint');
  }

  private drawFacilityStatePass(facility: FacilityState, _projection: ReturnType<typeof forecastFacilityProduction>[number] | undefined, center: { x: number; y: number }): void {
    const mapping = mapFacilityAssetLayers(facility);
    for (const [index, path] of mapping.overlays.entries()) {
      if (!this.boardLodActive() && this.drawTexture(this.facilityStateLayer, path, center, FACILITY_TEXTURE_SIZE, FACILITY_TEXTURE_SIZE)) continue;
      this.drawFacilityStateFallback(this.facilityStateFallbackGraphics, center, mapping.layers[index]!, index);
    }
  }

  private drawCheckpointStatePass(checkpoint: CheckpointState, center: { x: number; y: number }): void {
    const mapping = mapCheckpointAssetLayers(checkpoint);
    for (const [index, path] of mapping.overlays.entries()) {
      if (!this.boardLodActive() && this.drawTexture(this.facilityStateLayer, path, center, FACILITY_TEXTURE_SIZE, FACILITY_TEXTURE_SIZE)) continue;
      this.drawCheckpointStateFallback(this.facilityStateFallbackGraphics, center, mapping.layers[index]!, index);
    }
  }

  private drawUnitPass(unit: UnitState, center: { x: number; y: number }, facilityOffset: { x: number; y: number }, index: number, total: number): void {
    const offset = this.stackUnitOffset(facilityOffset, index, total);
    const position = { x: center.x + offset.x, y: center.y + offset.y };
    const lod = this.boardLodActive();
    const mapping = mapUnitAssetLayers(unit);
    if (lod) {
      this.drawUnitSilhouette(this.unitFallbackGraphics, position, unit);
    } else if (!this.drawTexture(this.unitLayer, mapping.base, position, UNIT_TEXTURE_SIZE, UNIT_TEXTURE_SIZE)) {
      this.drawUnitFallback(this.unitFallbackGraphics, position, unit);
    }
    if (lod) return;
    for (const [markerIndex, path] of mapping.overlays.entries()) {
      if (this.drawTexture(this.unitLayer, path, position, UNIT_TEXTURE_SIZE * 1.12, UNIT_TEXTURE_SIZE * 1.12)) continue;
      this.drawHordeMarkerFallback(this.unitFallbackGraphics, position, markerIndex === 1 || mapping.isFinalHorde);
    }
  }

  private stackUnitOffset(facilityOffset: { x: number; y: number }, index: number, total: number): { x: number; y: number } {
    if (total <= 1) return facilityOffset;
    return { x: facilityOffset.x + (index % 3) * 5, y: facilityOffset.y + Math.floor(index / 3) * 5 };
  }

  private drawTileDynamic(
    state: Readonly<GameState>,
    tile: HexTile,
    center: { x: number; y: number },
    key: string,
    tileSelected: boolean,
    isLegal: boolean,
    isPath: boolean,
    isHordeRoute: boolean,
    isHordeEntrance: boolean,
    isSpawnReserve: boolean,
    hordeTarget: { x: number; y: number } | null,
    hordeWarningType: 'periodic' | 'final' | 'none',
    selectedVision: BoardVisionSelection | null,
    render: BoardRenderState,
    suppliedTiles: ReadonlySet<string>,
    checkpointLegalPreview: ReadonlySet<string>,
    checkpointInvalidPreview: ReadonlySet<string>,
    selectedCheckpointPreview: string | null,
    constructibleLegalPreview: ReadonlySet<string>,
    constructibleInvalidPreview: ReadonlySet<string>,
    selectedConstructiblePreview: string | null,
  ): void {
    if (isSpawnReserve) {
      // Spawn Reserve is public static map information and must remain visible
      // even when Fog of War dims the rest of the tile. The inset hatch keeps
      // the outer 200 Hexes legible without hiding Terrain or other markers.
      const points = this.hexPoints(center);
      this.graphics.fillStyle(0x8b4c76, 0.2);
      this.graphics.fillPoints(points, true);
      this.graphics.lineStyle(2, 0xd5799d, 0.72);
      this.graphics.strokePoints(points, true);
      this.graphics.lineStyle(1, 0xd5799d, 0.42);
      this.graphics.beginPath();
      this.graphics.moveTo(center.x - HEX_SIZE * 0.55, center.y - HEX_SIZE * 0.16);
      this.graphics.lineTo(center.x - HEX_SIZE * 0.16, center.y - HEX_SIZE * 0.55);
      this.graphics.moveTo(center.x + HEX_SIZE * 0.16, center.y + HEX_SIZE * 0.55);
      this.graphics.lineTo(center.x + HEX_SIZE * 0.55, center.y + HEX_SIZE * 0.16);
      this.graphics.strokePath();
      this.addLabel(`spawn-reserve:${key}`, 'R', center.x, center.y, '#f0b6d1', 8, true);
    }
    if (render.supplyOverlay && (suppliedTiles.has(tile.key) || suppliedTiles.has(key))) {
      this.graphics.fillStyle(0x38a9a4, 0.1);
      this.graphics.fillPoints(this.hexPoints(center), true);
      if (getSectorBranchIds(state.map, { q: tile.q, r: tile.r }).length > 1) {
        this.graphics.lineStyle(1, 0xa990d6, 0.48);
        this.graphics.strokePoints(this.hexPoints(center), true);
      }
    }
    if (tileSelected) {
      this.graphics.lineStyle(3, 0x81d4fa, 1);
      this.graphics.strokePoints(this.hexPoints(center), true);
    } else if (isLegal) {
      this.graphics.lineStyle(2, 0x54d7ff, 0.95);
      this.graphics.strokePoints(this.hexPoints(center), true);
    } else if (isPath) {
      this.graphics.lineStyle(2, 0xffcf66, 0.95);
      this.graphics.strokePoints(this.hexPoints(center), true);
    }
    if (isHordeRoute && hordeWarningType !== 'none') {
      const warningColor = hordeWarningType === 'final' ? 0xff8b69 : 0xf0c867;
      this.graphics.lineStyle(3, warningColor, 0.9);
      this.graphics.strokePoints(this.hexPoints(center), true);
      if (isHordeEntrance && hordeTarget) this.drawHordeEntranceArrow(center, hordeTarget, warningColor);
    }
    const visionState = visionOverlayState(selectedVision, key);
    if (visionState !== 'none') {
      const points = this.hexPoints(center);
      if (visionState === 'ground-blocked') {
        // Keep the blocker boundary legible over Fog without revealing the
        // terrain or any hidden unit behind it.
        this.graphics.fillStyle(0x02070b, 0.18);
        this.graphics.fillPoints(points, true);
        this.graphics.lineStyle(2, 0x253541, 0.95);
      } else if (visionState === 'ground-visible') {
        this.graphics.fillStyle(0x77d6d1, 0.045);
        this.graphics.fillPoints(points, true);
        this.graphics.lineStyle(2, 0x8be8ff, 0.78);
      } else if (visionState === 'ground-potential') {
        this.graphics.lineStyle(1, 0x52606b, 0.62);
      } else {
        // Aerial coverage is intentionally blue and filled differently from
        // Ground LOS so the two public visibility modes are distinguishable.
        this.graphics.fillStyle(0x6699e8, 0.09);
        this.graphics.fillPoints(points, true);
        this.graphics.lineStyle(2, 0x9fc5ff, 0.86);
      }
      this.graphics.strokePoints(points, true);
    }
    if (isLegal) this.drawMarker(this.graphics, center, 0x54d7ff, 0.26);
    if (isPath) this.drawMarker(this.graphics, center, 0xffcf66, 0.16);
    if (effectiveMovementCost(state, tile) === null) this.drawMarker(this.graphics, center, 0x5299c0, 0.16);
    const checkpointCandidateLegal = checkpointLegalPreview.has(key);
    const checkpointCandidateInvalid = checkpointInvalidPreview.has(key);
    if (checkpointCandidateLegal || checkpointCandidateInvalid) {
      const previewSelected = selectedCheckpointPreview === key;
      const style = checkpointCandidateMarkerStyle(checkpointCandidateLegal, previewSelected);
      this.graphics.lineStyle(style.lineWidth, style.color, 0.95);
      this.graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.78);
      this.drawMarker(this.graphics, center, style.color, style.alpha);
      this.addLabel(`checkpoint-candidate:${key}`, style.symbol, center.x, center.y, checkpointCandidateLegal ? '#d8f8e8' : '#ffd0ca', 10, true);
    }
    const constructibleCandidateLegal = constructibleLegalPreview.has(key);
    const constructibleCandidateInvalid = constructibleInvalidPreview.has(key);
    if (constructibleCandidateLegal || constructibleCandidateInvalid) {
      const selected = selectedConstructiblePreview === key;
      const style = constructibleCandidateMarkerStyle(constructibleCandidateLegal, selected);
      this.graphics.lineStyle(style.lineWidth, style.color, 0.95);
      this.graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.84);
      this.drawMarker(this.graphics, center, style.color, style.alpha);
      this.addLabel(`constructible-candidate:${key}`, style.symbol, center.x, center.y, constructibleCandidateLegal ? '#d8f8e8' : '#ffd0ca', 10, true);
    }
  }

  private drawFacilityDynamic(
    facility: FacilityState,
    projection: ReturnType<typeof forecastFacilityProduction>[number] | undefined,
    center: { x: number; y: number },
    tileSelected: boolean,
    render: BoardRenderState,
    suppliedTiles: ReadonlySet<string>,
    tileKey: string,
    t: ReturnType<typeof createTranslator>,
  ): void {
    if (!this.boardLodActive() && !this.assetReady(mapFacilityAssetLayers(facility).base)) {
      this.addFallbackLabel(`facility:${facility.id}:fallback`, FALLBACK_FACILITY_SYMBOL[facility.type] ?? '□', center.x, center.y, '#d7e5e6', 12);
    }
    if (facility.infected > 0) {
      this.graphics.lineStyle(3, 0xff665f, 0.95);
      this.graphics.strokeCircle(center.x, center.y, 15);
      this.addLabel(`facility:${facility.id}:infection`, `!${facility.infected}`, center.x + 15, center.y - 17, '#ff8d82', 8, true);
    }
    const currentStopped = facility.operationalStatus === 'stopped';
    const currentRuined = facility.status === 'ruined' || facility.operationalStatus === 'ruined';
    const projectedStopped = Boolean(projection?.stoppedReason) && !currentStopped && !currentRuined && facility.infected === 0;
    if (projectedStopped) this.drawForecastWarning(this.graphics, center, facility.id);
    if (shouldShowUnpoweredFacilityMarker(facility, projection)) {
      // This pass runs after Fog, so the marker remains visible for player
      // facilities even when their Hex is outside current Player Vision.
      this.addLabel(`facility:${facility.id}:projected-power`, UNPOWERED_FACILITY_MARKER, center.x + 17, center.y - 17, '#ffcf66', 9, true);
    }
    if (render.supplyOverlay && facility.owner === 'player' && !suppliedTiles.has(tileKey)) {
      this.graphics.lineStyle(2, 0xef8c7a, 0.85);
      this.graphics.strokeCircle(center.x, center.y, 19);
    }
    if (tileSelected) {
      const facilityLabels: Record<string, string> = {
        capital: t('capital'),
        city: t('city'),
        farm: t('farm'),
        civilianFactory: t('civilianFactory'),
        militaryFactory: t('militaryFactory'),
        refinery: t('refinery'),
        powerPlant: t('powerPlant'),
        windPowerPlant: t('windPowerPlant'),
        simpleFarm: t('simpleFarm'),
        civilianDroneBase: t('civilianDroneBase'),
      };
      const badges: string[] = [];
      if (facility.infected > 0) badges.push(`!${facility.infected}`);
      if (facility.owner !== 'player') badges.push(t('unowned'));
      if (facility.operationalStatus !== 'operational') {
        const statusLabels: Record<string, string> = {
          building: t('stateBuilding'),
          stopped: t('stopped'),
          infected: t('infected'),
          disabled: t('stateDisabled'),
          recovering: t('stateRecovering'),
          ruined: t('ruined'),
        };
        badges.push(statusLabels[facility.operationalStatus] ?? facility.operationalStatus);
      }
      if (facility.owner === 'player' && !suppliedTiles.has(tileKey)) badges.push(t('outOfSupply'));
      this.addLabel(`facility:${facility.id}:detail`, `${facilityLabels[facility.type] ?? facility.type}${badges.length > 0 ? ` · ${badges.join(' · ')}` : ''}`, center.x, center.y + 24, '#f3f7f9', 8, true);
    }
  }

  private drawCheckpointDynamic(
    state: Readonly<GameState>,
    checkpoint: CheckpointState,
    center: { x: number; y: number },
    tileSelected: boolean,
    suppliedTiles: ReadonlySet<string>,
    tileKey: string,
    t: ReturnType<typeof createTranslator>,
  ): void {
    if (!this.boardLodActive() && !this.assetReady(mapCheckpointAssetLayers(checkpoint).base)) {
      this.addFallbackLabel(`checkpoint:${checkpoint.id}:fallback`, FALLBACK_FACILITY_SYMBOL.checkpoint!, center.x, center.y, '#d7e5e6', 11);
    }
    const role = deriveCheckpointRole(state, checkpoint);
    const roleColor = role === 'active'
      ? 0x8ff0d4
      : role === 'standby'
        ? 0x79c7ff
        : role === 'dormant'
          ? 0xc4a7f5
          : role === 'remnant'
            ? 0xd7bd76
            : role === 'ruined'
              ? 0xff8d82
              : 0x9d7f9b;
    // The branch role is public checkpoint state. A subtle role ring keeps it
    // legible at a glance without exposing any hidden checkpoint internals.
    this.graphics.lineStyle(2, roleColor, 0.9);
    this.graphics.strokeCircle(center.x, center.y, 20);
    const roleMark = role === 'active' ? 'A' : role === 'standby' ? 'S' : role === 'dormant' ? 'D' : role === 'remnant' ? 'R' : role === 'ruined' ? 'X' : '∅';
    this.addLabel(`checkpoint:${checkpoint.id}:role`, roleMark, center.x - 18, center.y - 18, roleLabelColor(role), 8, true);
    if (checkpoint.infected > 0) {
      this.addLabel(`checkpoint:${checkpoint.id}:infection`, `!${checkpoint.infected}`, center.x + 15, center.y + 14, '#ff8d82', 8, true);
      this.graphics.lineStyle(2, 0xff665f, 0.9);
      this.graphics.strokeCircle(center.x, center.y, 18);
    }
    if (tileSelected) {
      const roleLabel = t(`checkpointRole.${role}`);
      const badges = [roleLabel].filter(Boolean);
      if (checkpoint.infected > 0) badges.push(`!${checkpoint.infected}`);
      if (!suppliedTiles.has(tileKey)) badges.push(t('outOfSupply'));
      this.addLabel(`checkpoint:${checkpoint.id}:detail`, `${t('checkpoint')}${badges.length > 0 ? ` · ${badges.join(' · ')}` : ''}`, center.x, center.y + 24, '#f3f7f9', 8, true);
    }
  }

  private drawUnitDynamic(
    unit: UnitState,
    center: { x: number; y: number },
    facilityOffset: { x: number; y: number },
    index: number,
    total: number,
    tileSelected: boolean,
    render: BoardRenderState,
    suppliedTiles: ReadonlySet<string>,
    tileKey: string,
    attackTargets: ReadonlySet<string>,
    blockedZombies: ReadonlySet<string>,
    t: ReturnType<typeof createTranslator>,
  ): void {
    const offset = this.stackUnitOffset(facilityOffset, index, total);
    const position = { x: center.x + offset.x, y: center.y + offset.y + 1 };
    if (!this.boardLodActive() && !this.assetReady(mapUnitAssetLayers(unit).base)) {
      this.addFallbackLabel(`unit:${unit.id}:fallback`, FALLBACK_UNIT_SYMBOL[unit.type] ?? '□', position.x, position.y, '#071019', 8);
    }
    const isZombie = isBoardZombieUnitType(unit.type);
    const selected = render.selectedUnitId === unit.id || render.selectedZombieId === unit.id;
    const target = attackTargets.has(unit.id);
    if (selected || target || blockedZombies.has(unit.id)) {
      const color = unitLineColor(unit, selected, target, blockedZombies.has(unit.id));
      this.graphics.lineStyle(blockedZombies.has(unit.id) || target ? 3 : 2, color, 1);
      this.graphics.strokeCircle(position.x, position.y, 11);
    }
    if (unit.hp < unit.maxHp) this.drawHealth(this.graphics, position, unit.hp / Math.max(unit.maxHp, 1));
    if (render.supplyOverlay && !isZombie && !suppliedTiles.has(tileKey)) this.addLabel(`unit:${unit.id}:status`, '⊘', position.x - 15, position.y - 15, '#ef8c7a', 9, true);
    if (!isZombie && (selected || tileSelected)) {
      const unitRecord = unit as unknown as Record<string, unknown>;
      const proficiency = unitRecord.proficiency === 'recruit' || unitRecord.proficiency === 'regular' || unitRecord.proficiency === 'veteran'
        ? String(unitRecord.proficiency)
        : null;
      const proficiencyLabel = proficiency ? t(`proficiency.${proficiency}`) : null;
      const maxCharges = typeof unitRecord.maxAttackCharges === 'number' ? Math.max(1, Math.trunc(unitRecord.maxAttackCharges)) : 1;
      const charges = typeof unitRecord.attackChargesRemaining === 'number' ? Math.max(0, Math.min(maxCharges, Math.trunc(unitRecord.attackChargesRemaining))) : maxCharges;
      const typeLabel = unit.type === 'nationalGuard' ? t('nationalGuard') : (unit.type as string) === 'riotPolice' ? t('riotPolice') : t('police');
      const supplyLabel = suppliedTiles.has(tileKey) ? t('supplied') : t('outOfSupply');
      const details = `${typeLabel}${proficiencyLabel ? ` (${proficiencyLabel})` : ''} HP ${unit.hp}/${unit.maxHp} ⚔ ${charges}/${maxCharges} ${supplyLabel}`;
      this.addLabel(`unit:${unit.id}:detail`, details, position.x, position.y + 23, '#f3f7f9', 8, true);
    } else if (isZombie && render.selectedZombieId === unit.id) {
      const typeLabel = unit.type === 'hordeZombie' ? t('hordeZombie') : unit.type === 'policeZombie' ? t('policeZombie') : unit.type === 'soldierZombie' ? t('soldierZombie') : (unit.type as string) === 'riotZombie' ? t('riotZombie') : (unit.type as string) === 'hunterZombie' ? t('hunterZombie') : t('zombie');
      this.addLabel(`unit:${unit.id}:detail`, `${typeLabel} HP ${unit.hp}/${unit.maxHp}`, position.x, position.y + 23, '#f3f7f9', 8, true);
    }
    void t;
  }

  private beginImagePass(layer: Phaser.GameObjects.Container): void {
    this.imagePoolCursors.set(layer, 0);
  }

  private endImagePass(layer: Phaser.GameObjects.Container): void {
    const cursor = this.imagePoolCursors.get(layer) ?? 0;
    const pool = this.imagePools.get(layer) ?? [];
    for (let index = cursor; index < pool.length; index += 1) pool[index]!.setVisible(false);
  }

  private drawTexture(layer: Phaser.GameObjects.Container, path: string | null, center: { x: number; y: number }, width: number, height: number, rotation = 0): boolean {
    if (!path || !this.assetReady(path)) return false;
    const status = this.assetStatuses.get(path);
    if (!status) return false;
    try {
      const pool = this.imagePools.get(layer) ?? [];
      if (!this.imagePools.has(layer)) this.imagePools.set(layer, pool);
      const index = this.imagePoolCursors.get(layer) ?? 0;
      this.imagePoolCursors.set(layer, index + 1);
      let image = pool[index];
      if (!image) {
        image = this.add.image(center.x, center.y, status.key);
        image.setOrigin(0.5, 0.5);
        layer.add(image);
        pool.push(image);
        this.renderCounters.imageCreates += 1;
      } else {
        this.renderCounters.imageReuses += 1;
      }
      image.setTexture(status.key);
      image.setVisible(true);
      image.setActive(true);
      image.setPosition(center.x, center.y);
      image.setDisplaySize(width, height);
      image.setRotation(rotation);
      return true;
    } catch (error) {
      this.markAssetFailure(path, 'texture-registration', safeString(error));
      return false;
    }
  }

  private drawRoadFallback(center: { x: number; y: number }, directions: readonly HexDirection[]): void {
    const graphics = this.roadFallbackGraphics;
    graphics.lineStyle(4, 0xd5b568, 0.78);
    if (directions.length === 0) {
      graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.25);
      return;
    }
    for (const direction of directions) {
      const angle = ROAD_DIRECTION_ANGLE[direction];
      graphics.lineBetween(center.x, center.y, center.x + Math.cos(angle) * HEX_WIDTH * 0.51, center.y + Math.sin(angle) * HEX_WIDTH * 0.51);
    }
  }

  private drawUrbanFallback(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }): void {
    graphics.lineStyle(2, 0xc7a8ff, 0.82);
    graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.8);
    graphics.fillStyle(0xc7a8ff, 0.26);
    graphics.fillCircle(center.x, center.y, 3);
  }

  private drawTerrainPattern(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, terrain: 'plain' | 'forest' | 'mountain' | 'water'): void {
    graphics.lineStyle(1, TERRAIN_LINE[terrain], 0.5);
    if (terrain === 'forest') {
      for (const offset of [-7, 0, 7]) {
        graphics.fillStyle(0x83bf86, 0.55);
        graphics.fillCircle(center.x + offset * 0.45, center.y + (offset % 2 === 0 ? -3 : 4), 2.1);
        graphics.lineBetween(center.x + offset * 0.45, center.y + 4, center.x + offset * 0.45, center.y + 8);
      }
      return;
    }
    if (terrain === 'mountain') {
      graphics.strokePoints([
        new Phaser.Math.Vector2(center.x - 9, center.y + 6),
        new Phaser.Math.Vector2(center.x, center.y - 7),
        new Phaser.Math.Vector2(center.x + 9, center.y + 6),
      ], false);
      graphics.lineBetween(center.x - 4, center.y + 1, center.x + 1, center.y + 1);
      graphics.lineBetween(center.x + 1, center.y + 1, center.x + 5, center.y + 6);
      return;
    }
    if (terrain === 'water') {
      for (const offset of [-7, 0, 7]) {
        graphics.beginPath();
        graphics.moveTo(center.x - 10, center.y + offset);
        graphics.lineTo(center.x - 3, center.y + offset - 2);
        graphics.lineTo(center.x + 4, center.y + offset);
        graphics.lineTo(center.x + 10, center.y + offset - 2);
        graphics.strokePath();
      }
    }
  }

  private drawTerrainFallbackAtLod(center: { x: number; y: number }, terrain: 'plain' | 'forest' | 'mountain' | 'water'): void {
    const graphics = this.terrainFallbackGraphics;
    graphics.fillStyle(TERRAIN_FILL[terrain], 1);
    graphics.lineStyle(1, TERRAIN_LINE[terrain], 1);
    graphics.fillPoints(this.hexPoints(center), true);
    graphics.strokePoints(this.hexPoints(center), true);
    this.drawTerrainPattern(graphics, center, terrain);
  }

  private drawFacilityFallbackBase(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, type: string): void {
    const color = type === 'checkpoint' ? 0x7ba5b4 : type === 'capital' ? 0xd5c58e : 0xa6c3b2;
    graphics.fillStyle(color, 0.9);
    graphics.lineStyle(2, 0x071019, 0.9);
    if (type === 'capital') {
      graphics.fillTriangle(center.x, center.y - 14, center.x - 15, center.y + 10, center.x + 15, center.y + 10);
      graphics.strokeTriangle(center.x, center.y - 14, center.x - 15, center.y + 10, center.x + 15, center.y + 10);
    } else if (type === 'city') {
      graphics.fillCircle(center.x, center.y, 13);
      graphics.strokeCircle(center.x, center.y, 13);
    } else if (type === 'farm') {
      graphics.fillTriangle(center.x, center.y - 13, center.x - 13, center.y + 11, center.x + 13, center.y + 11);
      graphics.strokeTriangle(center.x, center.y - 13, center.x - 13, center.y + 11, center.x + 13, center.y + 11);
    } else if (type === 'refinery' || type === 'powerPlant' || type === 'windPowerPlant') {
      graphics.fillCircle(center.x, center.y, 12);
      graphics.strokeCircle(center.x, center.y, 12);
      graphics.lineBetween(center.x - 8, center.y, center.x + 8, center.y);
      graphics.lineBetween(center.x, center.y - 8, center.x, center.y + 8);
    } else if (type === 'simpleFarm') {
      graphics.fillTriangle(center.x, center.y - 13, center.x - 13, center.y + 11, center.x + 13, center.y + 11);
      graphics.strokeTriangle(center.x, center.y - 13, center.x - 13, center.y + 11, center.x + 13, center.y + 11);
      graphics.lineBetween(center.x - 7, center.y + 6, center.x + 7, center.y + 6);
    } else if (type === 'civilianDroneBase') {
      graphics.fillRoundedRect(center.x - 13, center.y - 10, 26, 20, 5);
      graphics.strokeRoundedRect(center.x - 13, center.y - 10, 26, 20, 5);
      graphics.strokeCircle(center.x, center.y, 5);
    } else {
      graphics.fillRoundedRect(center.x - 13, center.y - 10, 26, 20, 4);
      graphics.strokeRoundedRect(center.x - 13, center.y - 10, 26, 20, 4);
      if (type === 'militaryFactory') graphics.lineBetween(center.x - 8, center.y + 7, center.x + 8, center.y - 7);
    }
  }

  private drawFacilityStateFallback(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, layer: string, index: number): void {
    const color = layer === 'secured' ? 0x3fc9bc : layer === 'unsecured' ? 0xc9b47b : layer === 'stopped' ? 0x9aa8ae : layer === 'infected' ? 0xff665f : 0xdf8080;
    graphics.lineStyle(layer === 'ruined' ? 3 : 2, color, 0.9);
    if (layer === 'stopped') graphics.lineBetween(center.x - 12, center.y - 12, center.x + 12, center.y + 12);
    else if (layer === 'infected') graphics.strokeCircle(center.x, center.y, 16 + index);
    else if (layer === 'ruined') graphics.lineBetween(center.x - 12, center.y + 12, center.x + 12, center.y - 12);
    else graphics.strokeCircle(center.x, center.y, 17 + index);
  }

  private drawCheckpointStateFallback(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, layer: string, index: number): void {
    const color = layer === 'operational' ? 0xa4e8ff : layer === 'abandoned' ? 0x9e7895 : layer === 'remnant' ? 0xd5c58e : layer === 'infected' ? 0xff665f : 0xdf8080;
    graphics.lineStyle(layer === 'ruined' ? 3 : 2, color, 0.9);
    graphics.strokeRect(center.x - 13 - index, center.y - 10 - index, 26 + index * 2, 20 + index * 2);
  }

  private drawUnitFallback(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, unit: UnitState): void {
    graphics.fillStyle(unitColor(unit), 1);
    graphics.lineStyle(2, unitLineColor(unit, false, false, false), 1);
    graphics.fillCircle(center.x, center.y + 1, 9);
    graphics.strokeCircle(center.x, center.y + 1, 9);
  }

  private drawUnitSilhouette(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, unit: UnitState): void {
    const radius = unit.type === 'hordeZombie' || unit.type === 'soldierZombie' || (unit.type as string) === 'riotZombie' || (unit.type as string) === 'riotPolice' || (unit.type as string) === 'hunterZombie' ? 11 : 9;
    graphics.fillStyle(unitColor(unit), 0.95);
    graphics.lineStyle(unit.hordeKind === 'final' ? 3 : 2, unit.hordeKind === 'final' ? 0xffcf66 : 0x071019, 1);
    if ((unit.type as string) === 'riotZombie') {
      // Heavy riot silhouette: a broad shield with a central bar remains
      // readable at the minimum 0.35 zoom even without dedicated art.
      graphics.fillRoundedRect(center.x - radius, center.y - radius, radius * 2, radius * 2, 6);
      graphics.strokeRoundedRect(center.x - radius, center.y - radius, radius * 2, radius * 2, 6);
      graphics.lineBetween(center.x - radius + 2, center.y, center.x + radius - 2, center.y);
    } else if (unit.type === 'policeZombie') {
      // Distinct shield-like silhouette for a reanimated Police Unit.  It is
      // intentionally drawn without a letter so LOD stays legible at 0.35.
      graphics.fillRoundedRect(center.x - radius, center.y - radius, radius * 2, radius * 2, 4);
      graphics.strokeRoundedRect(center.x - radius, center.y - radius, radius * 2, radius * 2, 4);
      graphics.lineBetween(center.x, center.y - radius + 2, center.x, center.y + radius - 2);
    } else if (unit.type === 'soldierZombie') {
      // A broad chevron communicates the heavier Soldier Zombie silhouette.
      graphics.fillTriangle(center.x, center.y - radius, center.x - radius, center.y + radius - 2, center.x, center.y + radius - 6);
      graphics.fillTriangle(center.x, center.y - radius, center.x, center.y + radius - 6, center.x + radius, center.y + radius - 2);
      graphics.strokeTriangle(center.x, center.y - radius, center.x - radius, center.y + radius - 2, center.x, center.y + radius - 6);
      graphics.strokeTriangle(center.x, center.y - radius, center.x, center.y + radius - 6, center.x + radius, center.y + radius - 2);
    } else if ((unit.type as string) === 'hunterZombie') {
      // Hunter's forward-leaning silhouette and extended claws remain
      // distinguishable at the minimum zoom when its PNG is unavailable.
      graphics.fillTriangle(center.x + 2, center.y - radius, center.x - radius, center.y + radius - 1, center.x + radius, center.y + radius - 1);
      graphics.strokeTriangle(center.x + 2, center.y - radius, center.x - radius, center.y + radius - 1, center.x + radius, center.y + radius - 1);
      graphics.lineBetween(center.x - radius + 1, center.y + 2, center.x - radius - 5, center.y + 8);
      graphics.lineBetween(center.x + radius - 1, center.y + 2, center.x + radius + 5, center.y + 8);
      graphics.lineBetween(center.x - radius - 5, center.y + 8, center.x - radius - 2, center.y + 5);
      graphics.lineBetween(center.x + radius + 5, center.y + 8, center.x + radius + 2, center.y + 5);
    } else if (isBoardZombieUnitType(unit.type)) {
      graphics.fillTriangle(center.x, center.y - radius, center.x - radius, center.y + radius, center.x + radius, center.y + radius);
      graphics.strokeTriangle(center.x, center.y - radius, center.x - radius, center.y + radius, center.x + radius, center.y + radius);
    } else {
      graphics.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
      graphics.strokeRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    }
    if (unit.hordeKind === 'periodic' || unit.hordeKind === 'final') {
      graphics.lineStyle(unit.hordeKind === 'final' ? 3 : 2, unit.hordeKind === 'final' ? 0xffcf66 : 0xffb06b, 0.95);
      graphics.strokeCircle(center.x, center.y, radius + 4);
    }
  }

  private drawHordeMarkerFallback(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, final: boolean): void {
    graphics.lineStyle(final ? 3 : 2, final ? 0xffcf66 : 0xffb06b, 0.95);
    graphics.strokeCircle(center.x, center.y, final ? 14 : 12);
  }

  private drawForecastWarning(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, id: string): void {
    graphics.lineStyle(2, 0xf0c867, 0.9);
    graphics.strokeTriangle(center.x, center.y - 18, center.x - 7, center.y - 6, center.x + 7, center.y - 6);
    this.addLabel(`forecast:${id}:status`, '!', center.x, center.y - 10, '#f0c867', 8, true);
  }

  private drawMarker(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, color: number, alpha: number): void {
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(center.x, center.y, 5);
  }

  private drawHealth(graphics: Phaser.GameObjects.Graphics, center: { x: number; y: number }, ratio: number): void {
    graphics.fillStyle(0x071019, 0.9);
    graphics.fillRect(center.x - 10, center.y + 12, 20, 3);
    graphics.fillStyle(ratio > 0.5 ? 0x7de0a1 : 0xef9a80, 1);
    graphics.fillRect(center.x - 10, center.y + 12, Math.max(0, 20 * Math.max(0, Math.min(1, ratio))), 3);
  }

  private addFallbackLabel(key: string, text: string, x: number, y: number, color: string, size: number): void {
    this.addLabel(key, text, x, y, color, size, true);
  }

  private addLabel(key: string, text: string, x: number, y: number, color: string, size: number, center = false): void {
    if (!this.dynamicLayer || this.boardLodActive()) return;
    let label = this.labels.get(key);
    if (!label) {
      label = this.add.text(x, y, text, {
        color: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${size}px`,
        fontStyle: 'bold',
        stroke: '#071019',
        strokeThickness: 2,
      });
      if (center) label.setOrigin(0.5, 0.5);
      this.dynamicLayer.add(label);
      this.labels.set(key, label);
      this.renderCounters.labelCreates += 1;
    } else {
      this.renderCounters.labelReuses += 1;
      if (label.text !== text) {
        label.setText(text);
      }
    }
    label.setPosition(x, y);
    label.setVisible(true);
    label.setTint(Phaser.Display.Color.HexStringToColor(color).color);
    this.activeLabelKeys.add(key);
  }

  private drawSupplyBoundary(state: Readonly<GameState>, suppliedTiles: ReadonlySet<string>): void {
    const tilesByKey = new Map(state.map.tiles.map((tile) => [hexKey(tile), tile]));
    this.graphics.lineStyle(3, 0x72e0c2, 0.9);
    this.graphics.beginPath();
    for (const edge of supplyBoundaryEdges(state.map, suppliedTiles)) {
      const tile = tilesByKey.get(edge.tileKey);
      if (!tile) continue;
      const points = this.hexPoints(this.hexToWorld(state, tile));
      const [startIndex, endIndex] = HEX_EDGE_POINT_INDEX[edge.direction];
      const start = points[startIndex]!;
      const end = points[endIndex]!;
      this.graphics.moveTo(start.x, start.y);
      this.graphics.lineTo(end.x, end.y);
    }
    this.graphics.strokePath();
  }

  private drawHordeEntranceArrow(
    center: { x: number; y: number },
    target: { x: number; y: number },
    color: number,
  ): void {
    const length = Math.hypot(target.x - center.x, target.y - center.y);
    if (length === 0) return;
    const dx = (target.x - center.x) / length;
    const dy = (target.y - center.y) / length;
    const perpendicularX = -dy;
    const perpendicularY = dx;
    const tip = { x: center.x + dx * 11, y: center.y + dy * 11 };
    const base = { x: center.x - dx * 5, y: center.y - dy * 5 };
    this.graphics.fillStyle(color, 0.9);
    this.graphics.fillTriangle(
      tip.x,
      tip.y,
      base.x + perpendicularX * 7,
      base.y + perpendicularY * 7,
      base.x - perpendicularX * 7,
      base.y - perpendicularY * 7,
    );
  }

  private handleShutdown(): void {
    this.pendingZoom = null;
    this.zoomFrameScheduled = false;
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.activeLabelKeys.clear();
    for (const pool of this.imagePools.values()) {
      for (const image of pool) image.destroy();
    }
    this.imagePools.clear();
    this.imagePoolCursors.clear();
    this.mapStaticKey = null;
    this.facilityBaseKey = null;
    this.facilityStateKey = null;
    this.unitKey = null;
    this.fogKey = null;
    this.fogDirty = true;
    this.staticLod = null;
    this.staticDirty = true;
    if (this.load) {
      this.load.off('progress', this.handleLoaderProgress, this);
      this.load.off('fileprogress', this.handleFileProgress, this);
      this.load.off('filecomplete', this.handleFileComplete, this);
      this.load.off('loaderror', this.handleLoadError, this);
      this.load.off('complete', this.handleAssetLoadComplete, this);
    }
  }
}

export function createBoardGame(parent: HTMLElement, callbacks: BoardCallbacks): Phaser.Game {
  const scene = new HexBoardScene(callbacks);
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: parent.clientWidth || 960,
    height: parent.clientHeight || 640,
    backgroundColor: '#071019',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false, roundPixels: true },
    input: { activePointers: 3 },
    scene,
  });
}
