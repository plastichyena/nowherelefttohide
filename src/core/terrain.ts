import { roadConnections } from './roads';
import { hexKey } from './hex';
import { createMapReference, getTile } from './map-reference';
import type { MovementCostResolver } from './path';
import type {
  GameState,
  HexCoord,
  TerrainDefenseSource,
  UnitState,
} from './types';

const movementRoadCache = new WeakMap<object, Set<string>>();
export function hasMovementRoad(map: GameState['map'], position: HexCoord): boolean {
  if (getTile(map, position)?.road) return true;
  if (!map.roads) return false;
  let keys = movementRoadCache.get(map.roads);
  if (!keys) { keys = new Set(roadConnections(map.roads).keys()); movementRoadCache.set(map.roads, keys); }
  return keys.has(hexKey(position));
}

type TerrainState = Pick<GameState, 'map' | 'facilities' | 'checkpoints' | 'config'> & Partial<Pick<GameState, 'barbedWire'>>;

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
  playerMovement = true,
): number | null {
  const tile = getTile(state.map, position);
  if (!tile || state.config.terrain.movementCost[tile.terrain] === null) return null;
  if (playerMovement && state.barbedWire?.some(w => w.hp > 0 && hexKey(w.position) === hexKey(position))) return 5;
  if (hasMovementRoad(state.map, position) || isUrbanHex(state, position)) return 1;
  return state.config.terrain.movementCost[tile.terrain];
}

/** Snapshot lookup costs for one search; rebuild after facilities/checkpoints change. */
export function createMovementCostResolver(
  state: Readonly<TerrainState>,
  playerMovement = false,
  visible?: ReadonlySet<string>,
): MovementCostResolver {
  const reference = createMapReference(state.map);
  const urban = new Set([
    ...state.facilities.map((facility) => hexKey(facility.position)),
    ...state.checkpoints.map((checkpoint) => hexKey(checkpoint.position)),
  ]);
  const roads = new Set(state.map.roads ? roadConnections(state.map.roads).keys() : []);
  const wires = new Set(state.barbedWire?.filter(w => w.hp > 0 && (!visible || visible.has(hexKey(w.position)))).map(w => hexKey(w.position)) ?? []);
  return (position) => {
    const tile = reference.getTile(position);
    if (!tile || (playerMovement && !reference.canPlayerOccupyHex(position))) return null;
    if (state.config.terrain.movementCost[tile.terrain] === null) return null;
    if (playerMovement && wires.has(hexKey(position))) return 5;
    if (tile.road || roads.has(hexKey(position)) || tile.facilityId || urban.has(hexKey(position))) return 1;
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
