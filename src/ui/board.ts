import Phaser from 'phaser';
import { forecastFacilityProduction } from '../core/engine';
import { HEX_DIRECTION_ORDER, hexDistance, hexKey, hexNeighbor } from '../core/hex';
import { getSectorBranchIds } from '../core/supply';
import { effectiveMovementCost, isUrbanHex } from '../core/terrain';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import type {
  CardinalDirection,
  CheckpointState,
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
  BOARD_LOD_ZOOM_THRESHOLD,
  deriveRoadConnectionDirections,
  getFacilityUnitOffset,
  mapCheckpointAssetLayers,
  mapFacilityAssetLayers,
  mapTerrainAsset,
  mapUnitAssetLayers,
  resolveBoardAssetUrl,
} from './boardAssets';
import { createTranslator, type Locale } from './i18n';

/**
 * Phaser-only board adapter. It reads GameState and sends coordinates back to
 * the controller; all state changes still travel through GameAction/Core.
 */
export interface BoardRenderState {
  state: Readonly<GameState>;
  locale?: Locale;
  selectedPosition?: HexCoord | null;
  selectedUnitId?: string | null;
  legalDestinations?: readonly HexCoord[];
  attackTargetIds?: readonly string[];
  pendingPath?: readonly HexCoord[];
  hordeDirection?: CardinalDirection | null;
  hordeWarningType?: 'periodic' | 'final' | 'none';
  visibilityOverlay?: boolean;
  selectedVision?: { origin: HexCoord; radius: number } | null;
  supplyOverlay?: boolean;
  suppliedTileKeys?: readonly string[];
  checkpointPreviewPositions?: readonly HexCoord[];
  checkpointPreviewSelected?: HexCoord | null;
  blockedZombieIds?: readonly string[];
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
  checkpoint: '▤',
};

const FALLBACK_UNIT_SYMBOL: Record<string, string> = {
  police: 'P',
  nationalGuard: 'G',
  zombie: 'Z',
  hordeZombie: 'H',
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

/** Limit a Horde warning to the warned capital-outward road branch. */
export function hordeWarningTileKeys(map: Readonly<FixedMap>, direction: CardinalDirection): readonly string[] {
  const branch = map.roadBranches.find((candidate) => candidate.direction === direction);
  if (branch) return branch.roadTiles.map((position) => hexKey(position));
  const entrance = map.hordeEntrances.find((candidate) => candidate.direction === direction);
  return entrance ? [hexKey(entrance.tile)] : [];
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
  return unit.type === 'nationalGuard' ? 0xb6d8ff : 0x7fc7a0;
}

function unitLineColor(unit: UnitState, selected: boolean, target: boolean, blocked: boolean): number {
  if (blocked) return 0xff6b64;
  if (unit.hordeKind === 'final') return 0xffcf66;
  if (target) return 0xff8c69;
  if (selected) return 0x9ae9ff;
  return 0x071019;
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
  private cameraInitialized = false;
  private readonly zoomMin = 0.55;
  private readonly zoomMax = 2.2;

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
    if (this.graphics) this.draw(next);
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
    this.emitProgress(false, 1);
    const summary = this.assetSummary();
    this.invokeReady(this.callbacks.onReady, summary);
    this.invokeReady(this.callbacks.onAssetsReady, summary);
    this.invokeReady(this.callbacks.onAssetReady, summary);
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
    this.clearLayer(this.terrainLayer, this.terrainFallbackGraphics);
    this.clearLayer(this.roadLayer, this.roadFallbackGraphics);
    this.clearLayer(this.urbanLayer, this.urbanFallbackGraphics);
    this.clearLayer(this.facilityBaseLayer, this.facilityBaseFallbackGraphics);
    this.clearLayer(this.facilityStateLayer, this.facilityStateFallbackGraphics);
    this.clearLayer(this.fogLayer, this.fogGraphics);
    this.clearLayer(this.unitLayer, this.unitFallbackGraphics);
    this.clearLayer(this.dynamicLayer, this.graphics);
    this.terrainFallbackGraphics.clear();
    this.roadFallbackGraphics.clear();
    this.urbanFallbackGraphics.clear();
    this.facilityBaseFallbackGraphics.clear();
    this.facilityStateFallbackGraphics.clear();
    this.fogGraphics.clear();
    this.unitFallbackGraphics.clear();
    this.graphics.clear();
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.activeLabelKeys.clear();
  }

  private handleResize(size: { width: number; height: number }): void {
    if (!this.cameras.main) return;
    if (this.current) this.configureCamera(this.current.state, !this.cameraInitialized, size);
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
    this.cameras.main.scrollX = this.dragStart.scrollX - (pointer.x - this.dragStart.x) / zoom;
    this.cameras.main.scrollY = this.dragStart.scrollY - (pointer.y - this.dragStart.y) / zoom;
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const wasPinching = this.pinchPointers.size >= 2;
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
    if (moved < 12 && position) this.callbacks.onTileTap(position);
  }

  private handleWheel(pointer: Phaser.Input.Pointer, _gameObjects: unknown, deltaX: number, deltaY: number): void {
    this.setZoom(this.cameras.main.zoom * (deltaY > 0 ? 0.9 : 1.1), pointer.x, pointer.y);
    void deltaX;
  }

  private setZoom(next: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(screenX, screenY);
    camera.setZoom(Phaser.Math.Clamp(next, this.zoomMin, this.zoomMax));
    const after = camera.getWorldPoint(screenX, screenY);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
    if (this.current) {
      this.configureCamera(this.current.state, false, this.scale.gameSize);
      if (this.graphics) this.draw(this.current);
    }
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

  private draw(render: BoardRenderState): void {
    if (!this.layersReady) return;
    const { state } = render;
    const t = createTranslator(render.locale ?? 'ja');
    this.clearRenderLayers();
    const legal = new Set((render.legalDestinations ?? []).map((position) => hexKey(position)));
    const path = new Set((render.pendingPath ?? []).map((position) => hexKey(position)));
    const attackTargets = new Set(render.attackTargetIds ?? []);
    const suppliedTiles = new Set(render.suppliedTileKeys ?? []);
    const checkpointPreview = new Set((render.checkpointPreviewPositions ?? []).map((position) => hexKey(position)));
    const selectedCheckpointPreview = render.checkpointPreviewSelected ? hexKey(render.checkpointPreviewSelected) : null;
    const blockedZombies = new Set(render.blockedZombieIds ?? []);
    const selected = render.selectedPosition;
    const hordeDirection = render.hordeDirection ?? null;
    const hordeWarningType = render.hordeWarningType ?? 'periodic';
    const visibleTileKeys = getPlayerVisibleTileKeys(state);
    const selectedVision = render.selectedVision ?? null;
    const hordeRouteKeys = new Set(hordeDirection ? hordeWarningTileKeys(state.map, hordeDirection) : []);
    const hordeEntrance = hordeDirection
      ? state.map.hordeEntrances.find((candidate) => candidate.direction === hordeDirection)
      : undefined;
    const hordeEntranceKey = hordeEntrance ? hexKey(hordeEntrance.tile) : null;
    const capital = state.facilities.find((facility) => facility.type === 'capital');
    const hordeTarget = capital ? this.hexToWorld(state, capital.position) : null;
    const productionByFacility = this.productionMap(state);
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

    // Explicit passes preserve terrain -> road -> urban -> facility -> Fog -> unit -> dynamic order.
    for (const tile of state.map.tiles) this.drawTerrainPass(state, tile);
    for (const tile of state.map.tiles) this.drawRoadPass(state, tile);
    for (const tile of state.map.tiles) this.drawUrbanPass(state, tile);
    for (const tile of state.map.tiles) {
      const key = hexKey(tile);
      const center = this.hexToWorld(state, tile);
      const facility = facilitiesByTile.get(key);
      const checkpoint = checkpointsByTile.get(key);
      if (facility) this.drawFacilityBasePass(facility, center);
      if (checkpoint) this.drawCheckpointBasePass(checkpoint, center);
    }
    for (const tile of state.map.tiles) {
      const key = hexKey(tile);
      const center = this.hexToWorld(state, tile);
      const facility = facilitiesByTile.get(key);
      const checkpoint = checkpointsByTile.get(key);
      if (facility) this.drawFacilityStatePass(facility, productionByFacility.get(facility.id), center);
      if (checkpoint) this.drawCheckpointStatePass(checkpoint, center);
    }
    for (const tile of state.map.tiles) {
      if (render.visibilityOverlay !== false && !this.tileVisible(tile, visibleTileKeys)) {
        const points = this.hexPoints(this.hexToWorld(state, tile));
        this.fogGraphics.fillStyle(0x02070b, 0.57);
        this.fogGraphics.fillPoints(points, true);
        this.fogGraphics.lineStyle(1, 0x142b34, 0.75);
        this.fogGraphics.strokePoints(points, true);
      }
    }
    for (const tile of state.map.tiles) {
      const key = hexKey(tile);
      const facility = facilitiesByTile.get(key);
      const checkpoint = checkpointsByTile.get(key);
      const units = (unitsByTile.get(key) ?? []).filter((unit) => isUnitVisible(unit, visibleTileKeys));
      units.forEach((unit, index) => this.drawUnitPass(unit, this.hexToWorld(state, tile), getFacilityUnitOffset(Boolean(facility || checkpoint)), index, units.length));
    }

    for (const tile of state.map.tiles) {
      const key = hexKey(tile);
      const center = this.hexToWorld(state, tile);
      const facility = facilitiesByTile.get(key);
      const checkpoint = checkpointsByTile.get(key);
      const tileSelected = selected ? sameHex(selected, tile) : false;
      this.drawTileDynamic(state, tile, center, key, tileSelected, legal.has(key), path.has(key), hordeRouteKeys.has(key), hordeEntranceKey === key, hordeTarget, hordeWarningType, selectedVision, render, suppliedTiles, checkpointPreview, selectedCheckpointPreview);
      if (facility) this.drawFacilityDynamic(facility, productionByFacility.get(facility.id), center, tileSelected, render, suppliedTiles, key, t);
      if (checkpoint) this.drawCheckpointDynamic(checkpoint, center);
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

  private productionMap(state: Readonly<GameState>): Map<string, ReturnType<typeof forecastFacilityProduction>[number]> {
    try {
      return new Map(forecastFacilityProduction(state).map((projection) => [projection.facilityId, projection]));
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
    if (!this.boardLodActive()) this.addFallbackLabel(`facility:${facility.id}:fallback`, FALLBACK_FACILITY_SYMBOL[facility.type] ?? '□', center.x, center.y, '#d7e5e6', 12);
  }

  private drawCheckpointBasePass(checkpoint: CheckpointState, center: { x: number; y: number }): void {
    const path = mapCheckpointAssetLayers(checkpoint).base;
    if (!this.boardLodActive() && this.drawTexture(this.facilityBaseLayer, path, center, FACILITY_TEXTURE_SIZE, FACILITY_TEXTURE_SIZE)) return;
    this.drawFacilityFallbackBase(this.facilityBaseFallbackGraphics, center, 'checkpoint');
    if (!this.boardLodActive()) this.addFallbackLabel(`checkpoint:${checkpoint.id}:fallback`, FALLBACK_FACILITY_SYMBOL.checkpoint!, center.x, center.y, '#d7e5e6', 11);
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
      this.addFallbackLabel(`unit:${unit.id}:fallback`, FALLBACK_UNIT_SYMBOL[unit.type] ?? '□', position.x, position.y, '#071019', 8);
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
    hordeTarget: { x: number; y: number } | null,
    hordeWarningType: 'periodic' | 'final' | 'none',
    selectedVision: { origin: HexCoord; radius: number } | null,
    render: BoardRenderState,
    suppliedTiles: ReadonlySet<string>,
    checkpointPreview: ReadonlySet<string>,
    selectedCheckpointPreview: string | null,
  ): void {
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
    if (selectedVision && hexDistance(selectedVision.origin, tile) <= selectedVision.radius) {
      this.graphics.lineStyle(2, 0x8be8ff, 0.7);
      this.graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.74);
    }
    if (isLegal) this.drawMarker(this.graphics, center, 0x54d7ff, 0.26);
    if (isPath) this.drawMarker(this.graphics, center, 0xffcf66, 0.16);
    if (effectiveMovementCost(state, tile) === null) this.drawMarker(this.graphics, center, 0x5299c0, 0.16);
    if (checkpointPreview.has(key)) {
      const previewSelected = selectedCheckpointPreview === key;
      this.graphics.lineStyle(previewSelected ? 4 : 2, previewSelected ? 0xffd36e : 0x72e0c2, 0.95);
      this.graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.78);
      this.drawMarker(this.graphics, center, previewSelected ? 0xffd36e : 0x72e0c2, previewSelected ? 0.36 : 0.2);
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
    if (facility.infected > 0) {
      this.graphics.lineStyle(3, 0xff665f, 0.95);
      this.graphics.strokeCircle(center.x, center.y, 15);
      this.addLabel(`facility:${facility.id}:infection`, `!${facility.infected}`, center.x + 15, center.y - 17, '#ff8d82', 8, true);
    }
    const currentStopped = facility.operationalStatus === 'stopped';
    const currentRuined = facility.status === 'ruined' || facility.operationalStatus === 'ruined';
    const projectedStopped = Boolean(projection?.stoppedReason) && !currentStopped && !currentRuined && facility.infected === 0;
    if (projectedStopped) this.drawForecastWarning(this.graphics, center, facility.id);
    if (render.supplyOverlay && facility.owner === 'player' && !suppliedTiles.has(tileKey)) {
      this.graphics.lineStyle(2, 0xef8c7a, 0.85);
      this.graphics.strokeCircle(center.x, center.y, 19);
    }
    if (tileSelected) this.addLabel(`facility:${facility.id}:detail`, `${facility.id} W${facility.workers} I${facility.infected}`, center.x, center.y + 24, '#f3f7f9', 8, true);
    void t;
  }

  private drawCheckpointDynamic(checkpoint: CheckpointState, center: { x: number; y: number }): void {
    if (checkpoint.infected > 0) {
      this.addLabel(`checkpoint:${checkpoint.id}:infection`, `!${checkpoint.infected}`, center.x + 15, center.y + 14, '#ff8d82', 8, true);
      this.graphics.lineStyle(2, 0xff665f, 0.9);
      this.graphics.strokeCircle(center.x, center.y, 18);
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
    const isZombie = unit.type === 'zombie' || unit.type === 'hordeZombie';
    const selected = render.selectedUnitId === unit.id;
    const target = attackTargets.has(unit.id);
    if (selected || target || blockedZombies.has(unit.id)) {
      const color = unitLineColor(unit, selected, target, blockedZombies.has(unit.id));
      this.graphics.lineStyle(blockedZombies.has(unit.id) || target ? 3 : 2, color, 1);
      this.graphics.strokeCircle(position.x, position.y, 11);
    }
    if (unit.hp < unit.maxHp) this.drawHealth(this.graphics, position, unit.hp / Math.max(unit.maxHp, 1));
    if (render.supplyOverlay && !isZombie && !suppliedTiles.has(tileKey)) this.addLabel(`unit:${unit.id}:status`, '⊘', position.x - 15, position.y - 15, '#ef8c7a', 9, true);
    if (selected || tileSelected) this.addLabel(`unit:${unit.id}:detail`, `${unit.id} HP ${unit.hp}/${unit.maxHp}`, position.x, position.y + 23, '#f3f7f9', 8, true);
    void t;
  }

  private drawTexture(layer: Phaser.GameObjects.Container, path: string | null, center: { x: number; y: number }, width: number, height: number, rotation = 0): boolean {
    if (!path || !this.assetReady(path)) return false;
    const status = this.assetStatuses.get(path);
    if (!status) return false;
    try {
      const image = this.add.image(center.x, center.y, status.key);
      image.setOrigin(0.5, 0.5);
      image.setDisplaySize(width, height);
      image.setRotation(rotation);
      layer.add(image);
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
    } else if (type === 'refinery' || type === 'powerPlant') {
      graphics.fillCircle(center.x, center.y, 12);
      graphics.strokeCircle(center.x, center.y, 12);
      graphics.lineBetween(center.x - 8, center.y, center.x + 8, center.y);
      graphics.lineBetween(center.x, center.y - 8, center.x, center.y + 8);
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
    const radius = unit.type === 'hordeZombie' ? 11 : 9;
    graphics.fillStyle(unitColor(unit), 0.95);
    graphics.lineStyle(unit.hordeKind === 'final' ? 3 : 2, unit.hordeKind === 'final' ? 0xffcf66 : 0x071019, 1);
    if (unit.type === 'zombie' || unit.type === 'hordeZombie') {
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
    } else if (label.text !== text) {
      label.setText(text);
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
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.activeLabelKeys.clear();
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
