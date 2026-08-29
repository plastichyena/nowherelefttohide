import { hexDistance, hexKey } from './hex';
import type {
  FixedMap,
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

function stableBranches(map: Readonly<FixedMap>): RoadBranchDefinition[] {
  return [...map.roadBranches].sort((left, right) => left.id.localeCompare(right.id));
}

export function getCapitalPosition(map: Readonly<FixedMap>): HexCoord {
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

export function getBranchIdAt(
  map: Readonly<FixedMap>,
  position: HexCoord,
): RoadBranchId | null {
  const key = hexKey(position);
  return stableBranches(map).find((branch) => branch.roadTiles.some((tile) => hexKey(tile) === key))?.id ?? null;
}

/** Return every equally-near branch so boundary tiles stay shared. */
export function getSectorBranchIds(
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

function operationalCheckpointForBranch(
  state: Readonly<GameState>,
  branchId: RoadBranchId,
) {
  const branchState = getRoadBranchState(state, branchId);
  const byId = branchState?.activeCheckpointId
    ? state.checkpoints.find((checkpoint) => checkpoint.id === branchState.activeCheckpointId)
    : undefined;
  if (byId?.status === 'operational') return byId;
  return state.checkpoints.find(
    (checkpoint) =>
      checkpoint.status === 'operational' &&
      (checkpoint.branchId ?? checkpoint.direction) === branchId,
  );
}

export function getBranchSupplyRadius(
  state: Readonly<GameState>,
  branchId: RoadBranchId,
  candidateCheckpointPosition?: HexCoord,
): number {
  const initialRadius = state.config.checkpoint.initialSupplyRadius;
  const checkpoint = candidateCheckpointPosition
    ? { position: candidateCheckpointPosition }
    : operationalCheckpointForBranch(state, branchId);
  if (!checkpoint) return initialRadius;
  return Math.max(initialRadius, hexDistance(getCapitalPosition(state.map), checkpoint.position));
}

export function isHexSuppliedByBranch(
  state: Readonly<GameState>,
  position: HexCoord,
  branchId: RoadBranchId,
  candidateCheckpointPosition?: HexCoord,
): boolean {
  const distance = hexDistance(getCapitalPosition(state.map), position);
  return getSectorBranchIds(state.map, position).includes(branchId) &&
    distance <= getBranchSupplyRadius(state, branchId, candidateCheckpointPosition);
}

export function isHexSupplied(state: Readonly<GameState>, position: HexCoord): boolean {
  const distance = hexDistance(getCapitalPosition(state.map), position);
  if (distance <= state.config.checkpoint.initialSupplyRadius) return true;
  return getSectorBranchIds(state.map, position).some(
    (branchId) => distance <= getBranchSupplyRadius(state, branchId),
  );
}

export function getSuppliedTileKeys(
  state: Readonly<GameState>,
  override?: { branchId: RoadBranchId; checkpointPosition: HexCoord },
): string[] {
  return state.map.tiles
    .filter((tile) => {
      const position = { q: tile.q, r: tile.r };
      if (hexDistance(getCapitalPosition(state.map), position) <= state.config.checkpoint.initialSupplyRadius) {
        return true;
      }
      return getSectorBranchIds(state.map, position).some((branchId) => {
        const candidate = override?.branchId === branchId ? override.checkpointPosition : undefined;
        return hexDistance(getCapitalPosition(state.map), position) <= getBranchSupplyRadius(state, branchId, candidate);
      });
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
        (unit.type === 'zombie' || unit.type === 'hordeZombie') &&
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
