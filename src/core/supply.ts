import { hexDistance, hexKey } from './hex';
import type {
  FixedMap,
  CheckpointRole,
  CheckpointState,
  GameState,
  HexCoord,
  RoadBranchDefinition,
  RoadBranchId,
  RoadBranchState,
} from './types';

export interface SupplySnapshot {
  initialRadius: number;
  suppliedTileKeys: string[];
  branchRadii: Array<{ branchId: RoadBranchId; radius: number }>;
}

interface SupplyGeometry {
  capital: HexCoord;
  tiles: Array<{ key: string; distance: number; branchIds: RoadBranchId[] }>;
  byKey: Map<string, { key: string; distance: number; branchIds: RoadBranchId[] }>;
}

const supplyGeometryByMapId = new Map<string, SupplyGeometry>();

function stableBranches(map: Readonly<FixedMap>): RoadBranchDefinition[] {
  return [...map.roadBranches].sort((left, right) => left.id.localeCompare(right.id));
}

export function getCapitalPosition(map: Readonly<FixedMap>): HexCoord {
  const cached = supplyGeometryByMapId.get(map.id);
  if (cached) return { ...cached.capital };
  const capital = map.facilities.find((facility) => facility.type === 'capital');
  if (!capital) throw new Error('Map does not contain a capital facility');
  return { ...capital.position };
}

export function getRoadBranch(
  map: Readonly<FixedMap>,
  branchId: RoadBranchId,
): RoadBranchDefinition | undefined {
  return map.roadBranches.find((branch) => branch.id === branchId);
}

export function getRoadBranchState(
  state: Readonly<GameState>,
  branchId: RoadBranchId,
): RoadBranchState | undefined {
  return state.roadBranches.find((branch) => branch.branchId === branchId);
}

/** Shared role derivation for Core, UI and public adapters. */
export function deriveCheckpointRole(
  state: Readonly<GameState>,
  checkpoint: Readonly<CheckpointState>,
): CheckpointRole {
  if (checkpoint.status !== 'operational') return checkpoint.status;
  const branch = getRoadBranchState(state, checkpoint.branchId ?? checkpoint.direction);
  if (branch?.activeCheckpointId === checkpoint.id) return 'active';
  if (branch?.standbyCheckpointIds.includes(checkpoint.id)) return 'standby';
  return 'dormant';
}

export function getBranchIdAt(
  map: Readonly<FixedMap>,
  position: HexCoord,
): RoadBranchId | null {
  const key = hexKey(position);
  return stableBranches(map).find((branch) => branch.roadTiles.some((tile) => hexKey(tile) === key))?.id ?? null;
}

/** Return every equally-near branch so boundary tiles stay shared. */
function computeSectorBranchIds(
  map: Readonly<FixedMap>,
  position: HexCoord,
): RoadBranchId[] {
  const branches = stableBranches(map);
  if (branches.length === 0) return [];
  if (branches.length === 1) return [branches[0]!.id];
  const distances = branches.map((branch) => ({
    branchId: branch.id,
    distance: Math.min(...branch.roadTiles.map((tile) => hexDistance(position, tile))),
  }));
  const minimum = Math.min(...distances.map((entry) => entry.distance));
  return distances.filter((entry) => entry.distance === minimum).map((entry) => entry.branchId);
}

function supplyGeometry(map: Readonly<FixedMap>): SupplyGeometry {
  const cached = supplyGeometryByMapId.get(map.id);
  if (cached) return cached;
  const capitalDefinition = map.facilities.find((facility) => facility.type === 'capital');
  if (!capitalDefinition) throw new Error('Map does not contain a capital facility');
  const capital = { ...capitalDefinition.position };
  const tiles = map.tiles.map((tile) => ({
    key: tile.key,
    distance: hexDistance(capital, tile),
    branchIds: computeSectorBranchIds(map, tile),
  }));
  const geometry = { capital, tiles, byKey: new Map(tiles.map((tile) => [tile.key, tile])) };
  supplyGeometryByMapId.set(map.id, geometry);
  return geometry;
}

export function getSectorBranchIds(
  map: Readonly<FixedMap>,
  position: HexCoord,
): RoadBranchId[] {
  const cached = supplyGeometry(map).byKey.get(hexKey(position));
  return cached ? [...cached.branchIds] : computeSectorBranchIds(map, position);
}

export function activeCheckpointForBranch(
  state: Readonly<GameState>,
  branchId: RoadBranchId,
) {
  const branchState = getRoadBranchState(state, branchId);
  const byId = branchState?.activeCheckpointId
    ? state.checkpoints.find((checkpoint) => checkpoint.id === branchState.activeCheckpointId)
    : undefined;
  if (byId?.status === 'operational') return byId;
  return undefined;
}

export function getBranchSupplyRadius(
  state: Readonly<GameState>,
  branchId: RoadBranchId,
  candidateCheckpointPosition?: HexCoord,
): number {
  const initialRadius = state.config.checkpoint.initialSupplyRadius;
  const checkpoint = candidateCheckpointPosition
    ? { position: candidateCheckpointPosition }
    : activeCheckpointForBranch(state, branchId);
  if (!checkpoint) return initialRadius;
  return Math.max(initialRadius, hexDistance(getCapitalPosition(state.map), checkpoint.position));
}

export function isHexSuppliedByBranch(
  state: Readonly<GameState>,
  position: HexCoord,
  branchId: RoadBranchId,
  candidateCheckpointPosition?: HexCoord,
): boolean {
  const tile = supplyGeometry(state.map).byKey.get(hexKey(position));
  const distance = tile?.distance ?? hexDistance(getCapitalPosition(state.map), position);
  const branchIds = tile?.branchIds ?? computeSectorBranchIds(state.map, position);
  return branchIds.includes(branchId) &&
    distance <= getBranchSupplyRadius(state, branchId, candidateCheckpointPosition);
}

export function isHexSupplied(state: Readonly<GameState>, position: HexCoord): boolean {
  const tile = supplyGeometry(state.map).byKey.get(hexKey(position));
  const distance = tile?.distance ?? hexDistance(getCapitalPosition(state.map), position);
  if (distance <= state.config.checkpoint.initialSupplyRadius) return true;
  return (tile?.branchIds ?? computeSectorBranchIds(state.map, position)).some(
    (branchId) => distance <= getBranchSupplyRadius(state, branchId),
  );
}

export function getSuppliedTileKeys(
  state: Readonly<GameState>,
  override?: { branchId: RoadBranchId; checkpointPosition: HexCoord },
): string[] {
  const geometry = supplyGeometry(state.map);
  const branchRadii = new Map(state.map.roadBranches.map((branch) => [
    branch.id,
    getBranchSupplyRadius(
      state,
      branch.id,
      override?.branchId === branch.id ? override.checkpointPosition : undefined,
    ),
  ] as const));
  return geometry.tiles
    .filter((tile) => {
      if (tile.distance <= state.config.checkpoint.initialSupplyRadius) {
        return true;
      }
      return tile.branchIds.some((branchId) => tile.distance <= (
        branchRadii.get(branchId) ?? state.config.checkpoint.initialSupplyRadius
      ));
    })
    .map((tile) => tile.key)
    .sort();
}

export function getBlockingZombiesForCheckpoint(
  state: Readonly<GameState>,
  branchId: RoadBranchId,
  checkpointPosition: HexCoord,
) {
  return state.units
    .filter(
      (unit) =>
        !unit.isPlayerUnit &&
        isHexSuppliedByBranch(state, unit.position, branchId, checkpointPosition),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function deriveSupplySnapshot(state: Readonly<GameState>): SupplySnapshot {
  return {
    initialRadius: state.config.checkpoint.initialSupplyRadius,
    suppliedTileKeys: getSuppliedTileKeys(state),
    branchRadii: stableBranches(state.map).map((branch) => ({
      branchId: branch.id,
      radius: getBranchSupplyRadius(state, branch.id),
    })),
  };
}
