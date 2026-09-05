import { hexKey, hexWithinBounds } from './hex';
import type { CardinalDirection, FacilityDefinition, FixedMap, HexCoord, HexTile, HordeEntrance } from './types';

/** General map reads retain the mutable-map, first-match input contract. */
export function getTile(map: FixedMap, position: HexCoord): HexTile | undefined {
  if (!hexWithinBounds(position, map.width, map.height)) return undefined;
  return map.tiles.find((tile) => tile.q === position.q && tile.r === position.r);
}

export function getFacility(map: FixedMap, facilityId: string): FacilityDefinition | undefined {
  return map.facilities.find((facility) => facility.id === facilityId);
}

export function getHordeEntrance(map: FixedMap, direction: CardinalDirection): HordeEntrance | undefined {
  return map.hordeEntrances.find((entrance) => entrance.direction === direction);
}

export function isRoad(map: FixedMap, position: HexCoord): boolean {
  return getTile(map, position)?.road === true;
}

export function isHordeSpawnReserve(map: FixedMap, position: HexCoord): boolean {
  const key = hexKey(position);
  return map.hordeSpawnReserve.some((candidate) => hexKey(candidate) === key);
}

export function canPlayerOccupyHex(map: FixedMap, position: HexCoord): boolean {
  return getTile(map, position) !== undefined && !isHordeSpawnReserve(map, position);
}

/**
 * A read index for one synchronous query/search. Recreate after geometry changes;
 * never cache this on a mutable GameState or identify geometry by map.id.
 * Coordinate order, sparse arrays and duplicate first-match semantics are preserved.
 */
export function createMapReference(map: Readonly<FixedMap>) {
  const tiles = new Map<string, HexTile>();
  for (const tile of map.tiles) {
    const key = hexKey(tile);
    if (!tiles.has(key)) tiles.set(key, tile);
  }
  const reserves = new Set(map.hordeSpawnReserve.map(hexKey));
  const width = map.width;
  const height = map.height;
  const tileAt = (position: HexCoord): HexTile | undefined =>
    hexWithinBounds(position, width, height) ? tiles.get(hexKey(position)) : undefined;
  return {
    getTile: tileAt,
    canPlayerOccupyHex: (position: HexCoord): boolean => tileAt(position) !== undefined && !reserves.has(hexKey(position)),
  };
}
