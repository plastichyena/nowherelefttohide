import { HEX_DIRECTION_ORDER, hexKey, hexNeighbor, hexWithinBounds } from './hex';
import { getTile } from './map';
import type { FixedMap, HexCoord } from './types';

export function compareHexCoordinates(a: HexCoord, b: HexCoord): number {
  return a.q - b.q || a.r - b.r;
}

export type MovementCostResolver = (position: HexCoord) => number | null;

function coordinateSignature(position: HexCoord): string {
  return `${position.q.toString().padStart(2, '0')},${position.r.toString().padStart(2, '0')}`;
}

/** Deterministic weighted shortest path, including both endpoints. */
export function findShortestPath(
  map: FixedMap,
  start: HexCoord,
  destination: HexCoord,
  blocked: ReadonlySet<string> = new Set(),
  resolveCost: MovementCostResolver = (position) => getTile(map, position)?.movementCost ?? null,
): HexCoord[] | null {
  const startKey = hexKey(start);
  const destinationKey = hexKey(destination);
  if (!hexWithinBounds(start, map.width, map.height) || !hexWithinBounds(destination, map.width, map.height)) {
    return null;
  }
  if (blocked.has(destinationKey) && destinationKey !== startKey) {
    return null;
  }
  type Pending = { position: HexCoord; cost: number; signature: string };
  const pending: Pending[] = [{ position: { ...start }, cost: 0, signature: coordinateSignature(start) }];
  const best = new Map<string, { cost: number; signature: string }>([[startKey, { cost: 0, signature: coordinateSignature(start) }]]);
  const previous = new Map<string, string | null>([[startKey, null]]);
  const positions = new Map<string, HexCoord>([[startKey, { ...start }]]);
  while (pending.length > 0) {
    pending.sort((left, right) => left.cost - right.cost || left.signature.localeCompare(right.signature));
    const currentEntry = pending.shift()!;
    const current = currentEntry.position;
    const currentKey = hexKey(current);
    const currentBest = best.get(currentKey);
    if (!currentBest || currentBest.cost !== currentEntry.cost || currentBest.signature !== currentEntry.signature) continue;
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
      const stepCost = resolveCost(next);
      if (
        !hexWithinBounds(next, map.width, map.height) ||
        stepCost === null || stepCost < 1 ||
        (blocked.has(nextKey) && nextKey !== destinationKey)
      ) {
        continue;
      }
      const nextCost = currentEntry.cost + stepCost;
      const nextSignature = `${currentEntry.signature}|${coordinateSignature(next)}`;
      const known = best.get(nextKey);
      if (known && (known.cost < nextCost || (known.cost === nextCost && known.signature <= nextSignature))) continue;
      best.set(nextKey, { cost: nextCost, signature: nextSignature });
      previous.set(nextKey, currentKey);
      positions.set(nextKey, next);
      pending.push({ position: next, cost: nextCost, signature: nextSignature });
    }
  }
  return null;
}

export function pathMovementCost(path: readonly HexCoord[], resolveCost: MovementCostResolver): number {
  return path.slice(1).reduce((total, position) => total + (resolveCost(position) ?? Number.POSITIVE_INFINITY), 0);
}

/** Every tile reachable within a movement-point budget, sorted by coordinate. */
export function findReachableTiles(
  map: FixedMap,
  start: HexCoord,
  budget: number,
  blocked: ReadonlySet<string> = new Set(),
  resolveCost: MovementCostResolver = (position) => getTile(map, position)?.movementCost ?? null,
): HexCoord[] {
  const startKey = hexKey(start);
  const best = new Map<string, number>([[startKey, 0]]);
  const pending: Array<{ position: HexCoord; cost: number }> = [{ position: { ...start }, cost: 0 }];
  while (pending.length > 0) {
    pending.sort((left, right) => left.cost - right.cost || compareHexCoordinates(left.position, right.position));
    const current = pending.shift()!;
    if (best.get(hexKey(current.position)) !== current.cost) continue;
    for (const direction of HEX_DIRECTION_ORDER) {
      const next = hexNeighbor(current.position, direction);
      const key = hexKey(next);
      const stepCost = resolveCost(next);
      if (!hexWithinBounds(next, map.width, map.height) || blocked.has(key) || stepCost === null) continue;
      const total = current.cost + stepCost;
      if (total > budget || total >= (best.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(key, total);
      pending.push({ position: next, cost: total });
    }
  }
  return [...best.keys()]
    .filter((key) => key !== startKey)
    .map((key) => {
      const [q, r] = key.split(',').map(Number);
      return { q: q!, r: r! };
    })
    .sort(compareHexCoordinates);
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
