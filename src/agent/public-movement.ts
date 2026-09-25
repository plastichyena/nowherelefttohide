import { findReachablePaths, findShortestPath, pathMovementCost } from '../core/path';
import { hexDistance, hexKey } from '../core/hex';
import { movementPlan, movementUnavailableReason, previewMovementPath, type MovementActor } from '../core/move-plan';
import type { FixedMap, HexCoord } from '../core/types';
import type { AgentMapObservation } from './types';

export interface PublicMovementSource {
  phase: string; gameOver?: boolean;
  map: Pick<AgentMapObservation, 'width' | 'height' | 'tiles'>;
  units: ReadonlyArray<MovementActor & { position: HexCoord }>;
  zombies: ReadonlyArray<{ id: string; position: HexCoord; canAttack?: boolean; attackChargesRemaining?: number; canTargetAir?: boolean; effectiveRange?: number }>;
}

const decisionCaches = new WeakMap<PublicMovementSource, { geometry: Map<string, ReturnType<typeof makeGeometry>>; candidates: Map<string, ReturnType<typeof publicMoveCandidates>> }>();
export function withPublicMovementCache<T>(source: PublicMovementSource, read: () => T): T {
  decisionCaches.set(source, { geometry: new Map(), candidates: new Map() });
  try { return read(); } finally { decisionCaches.delete(source); }
}
function geometry(source: PublicMovementSource, unit: MovementActor) {
  const cache = decisionCaches.get(source)?.geometry;
  if (!cache) return makeGeometry(source, unit);
  let result = cache.get(unit.id);
  if (!result) { result = makeGeometry(source, unit); cache.set(unit.id, result); }
  return result;
}
function makeGeometry(source: PublicMovementSource, unit: MovementActor) {
  const tiles = new Map(source.map.tiles.map(t => [hexKey(t), t]));
  const flying = unit.flightState === 'airborne';
  const blocked = new Set([
    ...source.units.filter(u => u.id !== unit.id && !u.transportedByUnitId && (flying ? u.flightState === 'airborne' : u.flightState !== 'airborne')),
    ...(flying ? [] : source.zombies),
  ].map(u => hexKey(u.position)));
  const resolver = (p: HexCoord) => {
    const tile = tiles.get(hexKey(p));
    return !tile ? null : flying ? 1 : tile.playerOccupancyAllowed ? tile.effectiveMovementCost : null;
  };
  // Path algorithms use only map dimensions and tile coordinates with an explicit resolver.
  const map: FixedMap = { id: 'public-movement', width: source.map.width, height: source.map.height,
    tiles: source.map.tiles.map(t => ({ ...t, key:hexKey(t), movementCost:t.effectiveMovementCost })),
    roadTiles: [], facilities: [], hordeEntrances: [], hordeSpawnReserve: [], roadBranches: [], initialZombiePositions: [] };
  return { map, resolver, blocked };
}

/** Explicit internal query; never attached to or serialized with an Observation. */
export function publicMoveCandidates(source: PublicMovementSource, unitId: string): Array<ReturnType<typeof movementPlan> & { destination: HexCoord; path: HexCoord[] }> {
  const unit = source.units.find(u => u.id === unitId);
  if (!unit || movementUnavailableReason(unit, source.gameOver ? 'ended' : source.phase)) return [];
  const { map, resolver, blocked } = geometry(source, unit);
  const budget = unit.currentFuel === 0 ? unit.emergencyMovementPoints : unit.movement;
  const cached = decisionCaches.get(source)?.candidates.get(unitId);
  if (cached) return cached;
  const result = findReachablePaths(map, unit.position, budget, blocked, resolver).flatMap(entry => {
    const plan = movementPlan(unit, source.phase, entry.path.length - 1, entry.cost);
    return plan.legal ? [{ ...plan, destination: { ...entry.position }, path: entry.path }] : [];
  });
  decisionCaches.get(source)?.candidates.set(unitId, result);
  return result;
}

/** One destination, with planned full-path values and public interruption values kept distinct. */
export function publicMoveDetails(source: PublicMovementSource, unitId: string, destination: HexCoord, pathOverride?: readonly HexCoord[]) {
  const unit = source.units.find(u => u.id === unitId);
  if (!unit) return null;
  const { map, resolver, blocked } = geometry(source, unit);
  const path = pathOverride ?? (decisionCaches.has(source) ? publicMoveCandidates(source, unitId).find(p => hexKey(p.destination) === hexKey(destination))?.path : undefined) ?? findShortestPath(map, unit.position, destination, blocked, resolver);
  if (!path) return null;
  const plan = movementPlan(unit, source.gameOver ? 'ended' : source.phase, path.length - 1, pathMovementCost(path, resolver));
  const visibleEnemies = [...source.zombies].sort((a,b) => a.id.localeCompare(b.id));
  const preview = previewMovementPath(unit, source.phase, path, p => resolver(p) ?? 0,
    p => visibleEnemies.find(z => z.canAttack && (z.attackChargesRemaining ?? 0) > 0 &&
      (unit.flightState !== 'airborne' || z.canTargetAir) && hexDistance(z.position, p) >= 1 &&
      hexDistance(z.position, p) <= (z.effectiveRange ?? 1))?.id ?? null);
  return { ...plan, destination: { ...destination }, preview: plan.legal ? preview : null };
}
