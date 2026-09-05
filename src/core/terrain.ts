import { hexKey } from './hex';
import { createMapReference, getTile } from './map-reference';
import type { MovementCostResolver } from './path';
import type {
  GameState,
  HexCoord,
  TerrainDefenseSource,
  UnitState,
} from './types';

type TerrainState = Pick<GameState, 'map' | 'facilities' | 'checkpoints' | 'config'>;

export interface TerrainDefense {
  source: TerrainDefenseSource;
  multiplier: number;
}

export function isUrbanHex(state: Readonly<TerrainState>, position: HexCoord): boolean {
  const tile = getTile(state.map, position);
  if (tile?.facilityId) return true;
  const key = hexKey(position);
  if (state.facilities.some((facility) => hexKey(facility.position) === key)) return true;
  return state.checkpoints.some((checkpoint) => hexKey(checkpoint.position) === key);
}

/** Entering an Urban or Road overlay always costs one movement point. */
export function effectiveMovementCost(
  state: Readonly<TerrainState>,
  position: HexCoord,
): number | null {
  const tile = getTile(state.map, position);
  if (!tile) return null;
  if (tile.road || isUrbanHex(state, position)) return 1;
  return state.config.terrain.movementCost[tile.terrain];
}

/** Snapshot lookup costs for one search; rebuild after facilities/checkpoints change. */
export function createMovementCostResolver(
  state: Readonly<TerrainState>,
  playerMovement = false,
): MovementCostResolver {
  const reference = createMapReference(state.map);
  const urban = new Set([
    ...state.facilities.map((facility) => hexKey(facility.position)),
    ...state.checkpoints.map((checkpoint) => hexKey(checkpoint.position)),
  ]);
  return (position) => {
    const tile = reference.getTile(position);
    if (!tile || (playerMovement && !reference.canPlayerOccupyHex(position))) return null;
    if (tile.road || tile.facilityId || urban.has(hexKey(position))) return 1;
    return state.config.terrain.movementCost[tile.terrain];
  };
}

export function terrainDefenseAt(
  state: Readonly<TerrainState>,
  target: Pick<UnitState, 'type' | 'position' | 'isPlayerUnit'>,
): TerrainDefense {
  if (isUrbanHex(state, target.position)) {
    return { source: 'urban', multiplier: state.config.terrain.damageMultiplier.urban };
  }
  const tile = getTile(state.map, target.position);
  if (
    tile?.terrain === 'forest' &&
    !target.isPlayerUnit
  ) {
    return { source: 'forest', multiplier: state.config.terrain.damageMultiplier.forestZombie };
  }
  return { source: 'none', multiplier: 1 };
}

export function terrainAdjustedDamage(
  state: Readonly<TerrainState>,
  target: Pick<UnitState, 'type' | 'position' | 'isPlayerUnit'>,
  baseDamage: number,
): { baseDamage: number; finalDamage: number; defense: TerrainDefense } {
  const normalizedBase = Math.max(0, Math.floor(baseDamage));
  const defense = terrainDefenseAt(state, target);
  return {
    baseDamage: normalizedBase,
    finalDamage: normalizedBase === 0 ? 0 : Math.max(1, Math.ceil(normalizedBase * defense.multiplier)),
    defense,
  };
}
