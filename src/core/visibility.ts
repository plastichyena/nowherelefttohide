import { hexDistance, hexKey, hexLine } from './hex';
import { deriveCheckpointRole } from './supply';
import type { GameState, HexCoord, UnitState } from './types';

export type VisionMode = 'ground' | 'aerial';

export interface VisionCoverage {
  visible: Set<string>;
  groundPotential: Set<string>;
  groundVisible: Set<string>;
  groundBlocked: Set<string>;
  aerialVisible: Set<string>;
}

export interface GroundVisionCoverage {
  potential: Set<string>;
  visible: Set<string>;
  blocked: Set<string>;
}

function addRadius(state: Readonly<GameState>, visible: Set<string>, origin: HexCoord, radius: number): void {
  for (const tile of state.map.tiles) {
    if (hexDistance(origin, tile) <= radius) visible.add(tile.key);
  }
}

/** Unblocked radius used by one Aerial source. */
export function getAerialVisibleTileKeys(
  state: Readonly<GameState>,
  origin: HexCoord,
  radius: number,
): Set<string> {
  const visible = new Set<string>();
  addRadius(state, visible, origin, radius);
  return visible;
}

function tileTerrain(state: Readonly<GameState>, position: HexCoord): string | null {
  const indexed = state.map.tiles[position.r * state.map.width + position.q];
  if (indexed?.q === position.q && indexed.r === position.r) return indexed.terrain;
  return state.map.tiles.find((tile) => tile.q === position.q && tile.r === position.r)?.terrain ?? null;
}

/** Ground LOS is blocked after the first Forest or Mountain on the canonical hexLine. */
export function isGroundVisibleFrom(
  state: Readonly<GameState>,
  origin: HexCoord,
  target: HexCoord,
  radius: number,
): boolean {
  if (hexDistance(origin, target) > radius) return false;
  const line = hexLine(origin, target);
  for (const position of line.slice(1, -1)) {
    const terrain = tileTerrain(state, position);
    if (terrain === 'forest' || terrain === 'mountain') return false;
  }
  return true;
}

export function getGroundVisibleTileKeys(
  state: Readonly<GameState>,
  origin: HexCoord,
  radius: number,
): Set<string> {
  return new Set(
    state.map.tiles
      .filter((tile) => isGroundVisibleFrom(state, origin, tile, radius))
      .map((tile) => tile.key),
  );
}

/** LOS decomposition for one selected Ground source. */
export function getGroundVisionCoverageFrom(
  state: Readonly<GameState>,
  origin: HexCoord,
  radius: number,
): GroundVisionCoverage {
  const potential = new Set(
    state.map.tiles
      .filter((tile) => hexDistance(origin, tile) <= radius)
      .map((tile) => tile.key),
  );
  const visible = getGroundVisibleTileKeys(state, origin, radius);
  const blocked = new Set([...potential].filter((key) => !visible.has(key)));
  return { potential, visible, blocked };
}

function addGroundSource(
  state: Readonly<GameState>,
  potential: Set<string>,
  visible: Set<string>,
  origin: HexCoord,
  radius: number,
): void {
  const source = getGroundVisionCoverageFrom(state, origin, radius);
  for (const key of source.potential) potential.add(key);
  for (const key of source.visible) visible.add(key);
}

/** Complete public visibility decomposition shared by UI, Observation, Metrics and legal actions. */
export function getPlayerVisionCoverage(state: Readonly<GameState>): VisionCoverage {
  const groundPotential = new Set<string>();
  const groundVisible = new Set<string>();
  const aerialVisible = new Set<string>();
  for (const unit of state.units) {
    if (unit.isPlayerUnit) addGroundSource(state, groundPotential, groundVisible, unit.position, unit.vision);
  }
  for (const facility of state.facilities) {
    if (facility.owner !== 'player' || facility.status === 'ruined') continue;
    if (['building', 'disabled', 'recovering'].includes(facility.operationalStatus)) continue;
    if (facility.type === 'civilianDroneBase') {
      if (facility.workers > 0 && facility.powerSupplyEnabled && facility.lastPowerSupplied === true) {
        addRadius(state, aerialVisible, facility.position, facility.workers * 3);
      }
      continue;
    }
    addGroundSource(
      state,
      groundPotential,
      groundVisible,
      facility.position,
      facility.type === 'capital' ? state.config.vision.capital : state.config.vision.ownedFacility,
    );
  }
  for (const checkpoint of state.checkpoints) {
    if (deriveCheckpointRole(state, checkpoint) === 'active') {
      addGroundSource(
        state,
        groundPotential,
        groundVisible,
        checkpoint.position,
        state.config.vision.operationalCheckpoint,
      );
    }
  }
  const visible = new Set([...groundVisible, ...aerialVisible]);
  const groundBlocked = new Set([...groundPotential].filter((key) => !groundVisible.has(key)));
  return { visible, groundPotential, groundVisible, groundBlocked, aerialVisible };
}

/** Single source of truth for Human UI, Agent Observation and legal actions. */
export function getPlayerVisibleTileKeys(state: Readonly<GameState>): Set<string> {
  return getPlayerVisionCoverage(state).visible;
}

/**
 * Checkpoint expansion requires a currently visible road corridor from the
 * capital-side end of a branch through the requested destination. The
 * optional set lets candidate enumeration reuse one visibility projection.
 */
export function getCheckpointRouteVisibility(
  state: Readonly<GameState>,
  branchId: string,
  target: HexCoord,
  visibleTileKeys: ReadonlySet<string> = getPlayerVisibleTileKeys(state),
): { targetVisible: boolean; routeVisible: boolean } {
  const branch = state.map.roadBranches.find((candidate) => candidate.id === branchId);
  const targetIndex = branch?.roadTiles.findIndex((tile) => hexKey(tile) === hexKey(target)) ?? -1;
  if (!branch || targetIndex < 0) return { targetVisible: false, routeVisible: false };
  const targetVisible = visibleTileKeys.has(hexKey(target));
  return {
    targetVisible,
    routeVisible: targetVisible && branch.roadTiles
      .slice(0, targetIndex + 1)
      .every((tile) => visibleTileKeys.has(hexKey(tile))),
  };
}

export function isVisibleToPlayer(state: Readonly<GameState>, position: HexCoord): boolean {
  return getPlayerVisibleTileKeys(state).has(hexKey(position));
}

export function getVisibleEnemyUnits(state: Readonly<GameState>): UnitState[] {
  const visible = getPlayerVisibleTileKeys(state);
  return state.units
    .filter((unit) => !unit.isPlayerUnit && visible.has(hexKey(unit.position)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function canUnitSee(observer: Pick<UnitState, 'position' | 'vision'>, target: HexCoord): boolean {
  return hexDistance(observer.position, target) <= observer.vision;
}
