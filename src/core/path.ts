import { HEX_DIRECTION_ORDER, hexKey, hexNeighbor, hexWithinBounds } from './hex';
import type { FixedMap, HexCoord } from './types';

export function compareHexCoordinates(a: HexCoord, b: HexCoord): number {
  return a.q - b.q || a.r - b.r;
}

/** Breadth-first path on the fixed all-cost-one map, including both endpoints. */
export function findShortestPath(
  map: FixedMap,
  start: HexCoord,
  destination: HexCoord,
  blocked: ReadonlySet<string> = new Set(),
): HexCoord[] | null {
  const startKey = hexKey(start);
  const destinationKey = hexKey(destination);
  if (!hexWithinBounds(start, map.width, map.height) || !hexWithinBounds(destination, map.width, map.height)) {
    return null;
  }
  if (blocked.has(destinationKey) && destinationKey !== startKey) {
    return null;
  }
  const pending: HexCoord[] = [{ ...start }];
  const previous = new Map<string, string | null>([[startKey, null]]);
  const positions = new Map<string, HexCoord>([[startKey, { ...start }]]);
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]!;
    const currentKey = hexKey(current);
    if (currentKey === destinationKey) {
      const result: HexCoord[] = [];
      let cursor: string | null = currentKey;
      while (cursor !== null) {
        result.push({ ...positions.get(cursor)! });
        cursor = previous.get(cursor) ?? null;
      }
      return result.reverse();
    }
    for (const direction of HEX_DIRECTION_ORDER) {
      const next = hexNeighbor(current, direction);
      const nextKey = hexKey(next);
      if (
        !hexWithinBounds(next, map.width, map.height) ||
        previous.has(nextKey) ||
        (blocked.has(nextKey) && nextKey !== destinationKey)
      ) {
        continue;
      }
      previous.set(nextKey, currentKey);
      positions.set(nextKey, next);
      pending.push(next);
    }
  }
  return null;
}

/** Return every nearest empty tile in stable coordinate order. */
export function findNearestOpenTiles(
  map: FixedMap,
  origin: HexCoord,
  occupied: ReadonlySet<string>,
): HexCoord[] {
  let frontier: HexCoord[] = [{ ...origin }];
  const seen = new Set<string>([hexKey(origin)]);
  while (frontier.length > 0) {
    const available = frontier
      .filter((position) => !occupied.has(hexKey(position)))
      .sort(compareHexCoordinates);
    if (available.length > 0) return available.map((position) => ({ ...position }));

    const next: HexCoord[] = [];
    for (const current of frontier) {
      const nexts = HEX_DIRECTION_ORDER.map((direction) => hexNeighbor(current, direction))
        .filter((candidate) => hexWithinBounds(candidate, map.width, map.height))
        .sort(compareHexCoordinates);
      for (const candidate of nexts) {
        const key = hexKey(candidate);
        if (!seen.has(key)) {
          seen.add(key);
          next.push(candidate);
        }
      }
    }
    frontier = next.sort(compareHexCoordinates);
  }
  return [];
}

/** Return the nearest empty tile, resolving equal distances by coordinate. */
export function findNearestOpenTile(
  map: FixedMap,
  origin: HexCoord,
  occupied: ReadonlySet<string>,
): HexCoord | null {
  return findNearestOpenTiles(map, origin, occupied)[0] ?? null;
}
