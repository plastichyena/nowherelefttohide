import { hexKey } from './hex';
import { getTile } from './map';
import type {
  GameState,
  HexCoord,
  TerrainDefenseSource,
  UnitState,
} from './types';

type TerrainState = Pick<GameState, 'map' | 'checkpoints' | 'config'>;

export interface TerrainDefense {
  source: TerrainDefenseSource;
  multiplier: number;
}

export function isUrbanHex(state: Readonly<TerrainState>, position: HexCoord): boolean {
  const tile = getTile(state.map, position);
  if (tile?.facilityId) return true;
  const key = hexKey(position);
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

export function terrainDefenseAt(
  state: Readonly<TerrainState>,
  target: Pick<UnitState, 'type' | 'position'>,
): TerrainDefense {
  if (isUrbanHex(state, target.position)) {
    return { source: 'urban', multiplier: state.config.terrain.damageMultiplier.urban };
  }
  const tile = getTile(state.map, target.position);
  if (
    tile?.terrain === 'forest' &&
    (target.type === 'zombie' || target.type === 'hordeZombie')
  ) {
    return { source: 'forest', multiplier: state.config.terrain.damageMultiplier.forestZombie };
  }
  return { source: 'none', multiplier: 1 };
}

export function terrainAdjustedDamage(
  state: Readonly<TerrainState>,
  target: Pick<UnitState, 'type' | 'position'>,
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
