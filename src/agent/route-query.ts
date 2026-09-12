import { HEX_DIRECTION_ORDER, hexKey, hexNeighbor, hexWithinBounds } from '../core/hex';
import { findShortestPath, pathMovementCost, type MovementCostResolver } from '../core/path';
import type { RoadRole } from '../core/roads';
import type { FixedMap, HexCoord, HumanUnitType, UnitActionState, UnitType } from '../core/types';
import { unitMoveFuelCost } from '../core/movement-query';
import type { AgentMapObservation, AgentRoadBranchObservation } from './types';
import {
  deriveStrategicMap,
  strategicNodeId,
  type StrategicMapGraph,
  type StrategicMapSource,
} from './strategic-map';

export const DEFAULT_ROUTE_SEQUENCE_LIMIT = 100;
export const MAX_ROUTE_SEQUENCE_LIMIT = 500;

export type RouteEndpoint =
  | { kind: 'facility'; id: string }
  | { kind: 'checkpoint'; id: string }
  | { kind: 'strategic-node'; id: string }
  | { kind: 'coordinate'; position: HexCoord };

export interface RouteSequenceRange {
  offset?: number;
  limit?: number;
}

export interface RouteQueryRanges {
  strategicNodes?: RouteSequenceRange;
  supplyTransitions?: RouteSequenceRange;
  hexPath?: RouteSequenceRange;
}

export interface RouteQueryInput {
  moverUnitId?: string;
  source?: RouteEndpoint;
  destination: RouteEndpoint;
  includeHexPath?: boolean;
  ranges?: RouteQueryRanges;
}

export interface RouteQueryUnit {
  id: string;
  type: UnitType;
  position: HexCoord;
  movement: number;
  actionState: UnitActionState;
  canMove: boolean;
  currentFuel: number;
  emergencyMovementPoints: number;
  fuelCostByLegalMove: Array<{
    destination: HexCoord;
    fuelCost: number;
    projectedFuelAfterMove: number;
    movementMode: 'normal' | 'emergency';
    effectiveMovementCost: number;
  }>;
}

export interface RouteQuerySource extends StrategicMapSource {
  phase: string;
  units: ReadonlyArray<RouteQueryUnit>;
  zombies: ReadonlyArray<{ id: string; position: HexCoord }>;
  barbedWire: ReadonlyArray<{ id: string; position: HexCoord; hp: number }>;
  supply: { suppliedTileKeys: readonly string[] };
}

export type ResolvedRouteEndpoint = {
  kind: RouteEndpoint['kind'] | 'unit';
  id: string | null;
  position: HexCoord;
};

export interface PagedRouteSequence<T> {
  included: boolean;
  items: T[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  omittedCount: number;
  omittedBefore: number;
  omittedAfter: number;
}

export interface RouteSingleActionReachability {
  reachable: boolean | null;
  actionRequired: boolean | null;
  reason: string;
  movementMode: 'normal' | 'emergency' | null;
  movementBudget: number | null;
  effectiveMovementCost: number | null;
  fuelCost: number | null;
  projectedFuelAfterMove: number | null;
}

export interface RouteAdjacentCandidate {
  position: HexCoord;
  effectiveMovementCost: number;
  pathLength: number;
  currentSingleActionReachable: boolean | null;
  currentSingleActionReason: string;
}

export interface RouteQueryResult {
  mode: 'unit' | 'reference';
  moverUnitId: string | null;
  resolvedSource: ResolvedRouteEndpoint;
  resolvedDestination: ResolvedRouteEndpoint;
  terrainPathExists: boolean;
  routeAvailable: boolean;
  unavailableReason: string | null;
  destinationCenterReached: boolean;
  adjacentCandidates: RouteAdjacentCandidate[];
  pathLength: number | null;
  terrainMovementCost: number | null;
  effectiveMovementCost: number | null;
  roadDistance: number | null;
  roadRoles: RoadRole[];
  branchIds: string[];
  hasOffRoadSegments: boolean;
  offRoadDistance: number | null;
  startsAtStrategicNode: boolean;
  endsAtStrategicNode: boolean;
  currentSingleAction: RouteSingleActionReachability;
  publicMovementConditions: {
    publiclyOccupiedHexesConsidered: number;
    visibleBarbedWireHexesEntered: number;
  };
  strategicNodes: PagedRouteSequence<{ pathIndex: number; nodeId: string; position: HexCoord }>;
  supplyTransitions: PagedRouteSequence<{ pathIndex: number; position: HexCoord; inSupply: boolean }>;
  hexPath: PagedRouteSequence<{ pathIndex: number; position: HexCoord }>;
}

export class RouteQueryInputError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RouteQueryInputError';
  }
}

interface PublicRoadLink {
  roles: Set<RoadRole>;
  branchIds: Set<string>;
}

const ROLE_ORDER: readonly RoadRole[] = ['trunk', 'collector', 'access'];

function linkKey(left: HexCoord, right: HexCoord): string {
  return [hexKey(left), hexKey(right)].sort().join('|');
}

function compareCoordinates(left: HexCoord, right: HexCoord): number {
  return left.q - right.q || left.r - right.r;
}

function publicMap(source: RouteQuerySource): FixedMap {
  return {
    id: source.map.id,
    width: source.map.width,
    height: source.map.height,
    roads: source.map.roads ? structuredClone(source.map.roads) : undefined,
    tiles: source.map.tiles.map((tile) => ({
      key: hexKey(tile),
      q: tile.q,
      r: tile.r,
      terrain: tile.terrain,
      road: tile.road,
      movementCost: tile.unobstructedMovementCost ?? tile.effectiveMovementCost,
      facilityId: tile.facilityId,
      hordeEntranceDirections: [...tile.hordeEntranceDirections],
      playerOccupancyAllowed: tile.playerOccupancyAllowed,
    })),
    roadTiles: source.map.tiles.filter((tile) => tile.movementRoad === true || tile.road).map((tile) => ({ q: tile.q, r: tile.r })),
    facilities: source.facilities.map((facility) => ({
      ...facility,
      nameKey: facility.id,
      workerCapacity: 0,
      startingOwned: false,
      startingWorkers: 0,
      startingInfected: 0,
    })),
    hordeEntrances: source.roadBranches.map((branch) => ({
      direction: branch.direction,
      tile: { ...branch.entrance },
      roadTiles: branch.roadTiles.map((position) => ({ ...position })),
    })),
    hordeSpawnReserve: source.map.tiles.filter((tile) => !tile.playerOccupancyAllowed).map((tile) => ({ q: tile.q, r: tile.r })),
    roadBranches: source.roadBranches.map((branch) => ({
      id: branch.branchId,
      direction: branch.direction,
      capitalConnection: { ...branch.capitalConnection },
      roadTiles: branch.roadTiles.map((position) => ({ ...position })),
      entrance: { ...branch.entrance },
    })),
    initialZombiePositions: [],
  };
}

function tileIndex(map: Pick<AgentMapObservation, 'tiles'>): Map<string, AgentMapObservation['tiles'][number]> {
  return new Map(map.tiles.map((tile) => [hexKey(tile), tile]));
}

function endpoint(
  source: RouteQuerySource,
  graph: StrategicMapGraph,
  value: RouteEndpoint,
  label: 'source' | 'destination',
): ResolvedRouteEndpoint {
  if (value.kind === 'coordinate') {
    if (!Number.isSafeInteger(value.position.q) || !Number.isSafeInteger(value.position.r)
      || !hexWithinBounds(value.position, source.map.width, source.map.height)) {
      throw new RouteQueryInputError(`invalid_${label}`, `${label} coordinate is outside the public map`);
    }
    return { kind: value.kind, id: null, position: { ...value.position } };
  }
  const item = value.kind === 'facility'
    ? source.facilities.find((facility) => facility.id === value.id)
    : value.kind === 'checkpoint'
      ? source.checkpoints.find((checkpoint) => checkpoint.id === value.id)
      : graph.nodes.find((node) => node.id === value.id);
  if (!item) throw new RouteQueryInputError(`unknown_${label}`, `Unknown public ${label} ${value.kind}: ${value.id}`);
  return { kind: value.kind, id: value.id, position: { ...item.position } };
}

function page<T>(
  allItems: readonly T[],
  range: RouteSequenceRange | undefined,
  included = true,
): PagedRouteSequence<T> {
  const offset = range?.offset ?? 0;
  const limit = range?.limit ?? DEFAULT_ROUTE_SEQUENCE_LIMIT;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RouteQueryInputError('invalid_range', 'route sequence offset must be a non-negative integer');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ROUTE_SEQUENCE_LIMIT) {
    throw new RouteQueryInputError('invalid_range', `route sequence limit must be an integer from 1 to ${MAX_ROUTE_SEQUENCE_LIMIT}`);
  }
  if (offset > allItems.length) throw new RouteQueryInputError('invalid_range', 'route sequence offset exceeds result size');
  const items = included ? allItems.slice(offset, offset + limit).map((item) => structuredClone(item)) : [];
  const omittedBefore = included ? offset : 0;
  const omittedAfter = included ? Math.max(0, allItems.length - offset - items.length) : allItems.length;
  return {
    included,
    items,
    totalCount: allItems.length,
    offset: included ? offset : 0,
    limit,
    hasMore: included && offset + items.length < allItems.length,
    omittedCount: allItems.length - items.length,
    omittedBefore,
    omittedAfter,
  };
}

function buildPublicRoadLinks(source: RouteQuerySource): Map<string, PublicRoadLink> {
  const result = new Map<string, PublicRoadLink>();
  const add = (left: HexCoord, right: HexCoord, role: RoadRole): void => {
    const key = linkKey(left, right);
    const current = result.get(key) ?? { roles: new Set<RoadRole>(), branchIds: new Set<string>() };
    current.roles.add(role);
    result.set(key, current);
  };
  if (source.map.roads) {
    for (const segment of source.map.roads.segments) {
      for (let index = 1; index < segment.path.length; index += 1) add(segment.path[index - 1]!, segment.path[index]!, segment.role);
    }
  } else {
    const roads = new Map(source.map.tiles.filter((tile) => tile.movementRoad === true || tile.road).map((tile) => [hexKey(tile), tile]));
    for (const tile of roads.values()) {
      for (const direction of HEX_DIRECTION_ORDER) {
        const next = hexNeighbor(tile, direction);
        const other = roads.get(hexKey(next));
        if (!other) continue;
        const roles = [...new Set([...(tile.roadRoles ?? []), ...(other.roadRoles ?? [])])];
        for (const role of roles.length > 0 ? roles : ['trunk' as const]) add(tile, next, role);
      }
    }
  }
  for (const branch of source.roadBranches) {
    const branchPath = [branch.capitalConnection, ...branch.roadTiles];
    for (let index = 1; index < branchPath.length; index += 1) {
      result.get(linkKey(branchPath[index - 1]!, branchPath[index]!))?.branchIds.add(branch.branchId);
    }
  }
  return result;
}

function roadSummary(path: readonly HexCoord[], links: ReadonlyMap<string, PublicRoadLink>) {
  const roles = new Set<RoadRole>();
  const branchIds = new Set<string>();
  let roadDistance = 0;
  for (let index = 1; index < path.length; index += 1) {
    const link = links.get(linkKey(path[index - 1]!, path[index]!));
    if (!link) continue;
    roadDistance += 1;
    for (const role of link.roles) roles.add(role);
    for (const branchId of link.branchIds) branchIds.add(branchId);
  }
  const distance = Math.max(0, path.length - 1);
  return {
    roadDistance,
    roadRoles: ROLE_ORDER.filter((role) => roles.has(role)),
    branchIds: [...branchIds].sort(),
    offRoadDistance: distance - roadDistance,
  };
}

function supplyTransitions(path: readonly HexCoord[], supplied: ReadonlySet<string>) {
  if (path.length === 0) return [];
  const result: Array<{ pathIndex: number; position: HexCoord; inSupply: boolean }> = [];
  let previous: boolean | null = null;
  path.forEach((position, pathIndex) => {
    const inSupply = supplied.has(hexKey(position));
    if (previous === null || inSupply !== previous) result.push({ pathIndex, position: { ...position }, inSupply });
    previous = inSupply;
  });
  return result;
}

function strategicSequence(path: readonly HexCoord[], graph: Readonly<StrategicMapGraph>) {
  const nodes = new Map(graph.nodes.map((node) => [hexKey(node.position), node]));
  return path.flatMap((position, pathIndex) => {
    const node = nodes.get(hexKey(position));
    return node ? [{ pathIndex, nodeId: node.id, position: { ...position } }] : [];
  });
}

function unitSingleAction(
  source: RouteQuerySource,
  unit: RouteQueryUnit,
  path: readonly HexCoord[] | null,
  effectiveCost: number | null,
): RouteSingleActionReachability {
  const movementMode = unit.currentFuel === 0 ? 'emergency' as const : 'normal' as const;
  const movementBudget = movementMode === 'emergency' ? unit.emergencyMovementPoints : unit.movement;
  const unavailable = (reason: string, actionRequired = true): RouteSingleActionReachability => ({
    reachable: false,
    actionRequired,
    reason,
    movementMode,
    movementBudget,
    effectiveMovementCost: effectiveCost,
    fuelCost: path ? (movementMode === 'normal' ? unitMoveFuelCost(unit.type as HumanUnitType, path.length - 1) : 0) : null,
    projectedFuelAfterMove: null,
  });
  if (!path || effectiveCost === null) return unavailable('route_unavailable');
  if (path.length === 1) return {
    reachable: true,
    actionRequired: false,
    reason: 'already_at_destination',
    movementMode,
    movementBudget,
    effectiveMovementCost: 0,
    fuelCost: 0,
    projectedFuelAfterMove: unit.currentFuel,
  };
  if (source.phase !== 'player') return unavailable('not_player_phase');
  if (unit.actionState === 'acted') return unavailable('unit_already_acted');
  if (!unit.canMove) return unavailable('unit_cannot_move');
  if (effectiveCost > movementBudget) return unavailable('out_of_range');
  const fuelCost = movementMode === 'normal' ? unitMoveFuelCost(unit.type as HumanUnitType, path.length - 1) : 0;
  if (movementMode === 'normal' && unit.currentFuel < fuelCost) return unavailable('insufficient_unit_fuel');
  const destination = path.at(-1)!;
  const projection = unit.fuelCostByLegalMove.find((entry) => hexKey(entry.destination) === hexKey(destination));
  if (!projection) return unavailable('not_in_legal_move_projection');
  return {
    reachable: true,
    actionRequired: true,
    reason: 'reachable_now',
    movementMode: projection.movementMode,
    movementBudget,
    effectiveMovementCost: projection.effectiveMovementCost,
    fuelCost: projection.fuelCost,
    projectedFuelAfterMove: projection.projectedFuelAfterMove,
  };
}

function referenceSingleAction(): RouteSingleActionReachability {
  return {
    reachable: null,
    actionRequired: null,
    reason: 'reference_route_has_no_movement_actor',
    movementMode: null,
    movementBudget: null,
    effectiveMovementCost: null,
    fuelCost: null,
    projectedFuelAfterMove: null,
  };
}

function unavailableReason(
  destination: ResolvedRouteEndpoint,
  tiles: ReadonlyMap<string, AgentMapObservation['tiles'][number]>,
  unitMode: boolean,
  blocked: ReadonlySet<string>,
  terrainPath: readonly HexCoord[] | null,
): string {
  const tile = tiles.get(hexKey(destination.position));
  if (!tile || (tile.unobstructedMovementCost ?? tile.effectiveMovementCost) === null) return 'destination_impassable';
  if (unitMode && !tile.playerOccupancyAllowed) return 'destination_not_player_occupiable';
  if (unitMode && blocked.has(hexKey(destination.position))) return 'destination_publicly_occupied';
  return terrainPath ? 'no_public_movement_path' : 'no_terrain_path';
}

/**
 * Pure public route projection. Hidden units cannot affect any branch because the
 * function accepts only the already-sanitized Agent observation surface.
 */
export function queryRoute(source: Readonly<RouteQuerySource>, input: Readonly<RouteQueryInput>): RouteQueryResult {
  const mutableSource = source as RouteQuerySource;
  const graph = deriveStrategicMap(mutableSource);
  let mover: RouteQueryUnit | null = null;
  if (input.moverUnitId !== undefined) {
    mover = mutableSource.units.find((unit) => unit.id === input.moverUnitId) ?? null;
    if (!mover) {
      if (mutableSource.zombies.some((unit) => unit.id === input.moverUnitId)) {
        throw new RouteQueryInputError('enemy_unit_not_allowed', 'Enemy units cannot be route movement actors');
      }
      throw new RouteQueryInputError('unknown_unit', `Unknown player unit: ${input.moverUnitId}`);
    }
    if (mover.type !== 'police' && mover.type !== 'nationalGuard' && mover.type !== 'riotPolice') {
      throw new RouteQueryInputError('enemy_unit_not_allowed', 'Enemy units cannot be route movement actors');
    }
  }
  let resolvedSource: ResolvedRouteEndpoint;
  if (mover) {
    if (input.source) {
      const explicit = endpoint(mutableSource, graph, input.source, 'source');
      if (hexKey(explicit.position) !== hexKey(mover.position)) {
        throw new RouteQueryInputError('source_unit_mismatch', 'Explicit source does not match the movement actor current position');
      }
    }
    resolvedSource = { kind: 'unit', id: mover.id, position: { ...mover.position } };
  } else {
    if (!input.source) throw new RouteQueryInputError('source_required', 'Reference routes require an explicit source');
    resolvedSource = endpoint(mutableSource, graph, input.source, 'source');
  }
  const resolvedDestination = endpoint(mutableSource, graph, input.destination, 'destination');
  const map = publicMap(mutableSource);
  const tiles = tileIndex(mutableSource.map);
  const terrainResolver: MovementCostResolver = (position) => {
    const tile = tiles.get(hexKey(position));
    return tile?.unobstructedMovementCost ?? tile?.effectiveMovementCost ?? null;
  };
  const publiclyOccupied = new Set([
    ...mutableSource.units.filter((unit) => unit.id !== mover?.id).map((unit) => hexKey(unit.position)),
    ...mutableSource.zombies.map((unit) => hexKey(unit.position)),
  ]);
  const unitResolver: MovementCostResolver = (position) => {
    const tile = tiles.get(hexKey(position));
    if (!tile?.playerOccupancyAllowed) return null;
    return tile.effectiveMovementCost;
  };
  const terrainPath = findShortestPath(map, resolvedSource.position, resolvedDestination.position, new Set(), terrainResolver);
  const routePath = mover
    ? findShortestPath(map, resolvedSource.position, resolvedDestination.position, publiclyOccupied, unitResolver)
    : terrainPath;
  const terrainCost = terrainPath ? pathMovementCost(terrainPath, terrainResolver) : null;
  const effectiveCost = routePath ? pathMovementCost(routePath, mover ? unitResolver : terrainResolver) : null;
  const singleAction = mover ? unitSingleAction(mutableSource, mover, routePath, effectiveCost) : referenceSingleAction();
  const adjacentCandidates: RouteAdjacentCandidate[] = [];
  if (!routePath && resolvedDestination.kind === 'facility') {
    for (const position of HEX_DIRECTION_ORDER.map((direction) => hexNeighbor(resolvedDestination.position, direction))) {
      if (!hexWithinBounds(position, map.width, map.height)) continue;
      const candidatePath = mover
        ? findShortestPath(map, resolvedSource.position, position, publiclyOccupied, unitResolver)
        : findShortestPath(map, resolvedSource.position, position, new Set(), terrainResolver);
      if (!candidatePath) continue;
      const candidateCost = pathMovementCost(candidatePath, mover ? unitResolver : terrainResolver);
      const candidateSingle = mover ? unitSingleAction(mutableSource, mover, candidatePath, candidateCost) : referenceSingleAction();
      adjacentCandidates.push({
        position: { ...position },
        effectiveMovementCost: candidateCost,
        pathLength: candidatePath.length - 1,
        currentSingleActionReachable: candidateSingle.reachable,
        currentSingleActionReason: candidateSingle.reason,
      });
    }
    adjacentCandidates.sort((left, right) => left.effectiveMovementCost - right.effectiveMovementCost || compareCoordinates(left.position, right.position));
  }

  const links = buildPublicRoadLinks(mutableSource);
  const road = routePath ? roadSummary(routePath, links) : null;
  const strategic = routePath ? strategicSequence(routePath, graph) : [];
  const supply = routePath ? supplyTransitions(routePath, new Set(mutableSource.supply.suppliedTileKeys)) : [];
  const hexPath = routePath?.map((position, pathIndex) => ({ pathIndex, position: { ...position } })) ?? [];
  const nodeKeys = new Set(graph.nodes.map((node) => hexKey(node.position)));
  const visibleWireKeys = new Set(mutableSource.barbedWire.filter((wire) => wire.hp > 0).map((wire) => hexKey(wire.position)));
  return {
    mode: mover ? 'unit' : 'reference',
    moverUnitId: mover?.id ?? null,
    resolvedSource,
    resolvedDestination,
    terrainPathExists: terrainPath !== null,
    routeAvailable: routePath !== null,
    unavailableReason: routePath ? null : unavailableReason(resolvedDestination, tiles, mover !== null, publiclyOccupied, terrainPath),
    destinationCenterReached: routePath !== null,
    adjacentCandidates,
    pathLength: routePath ? routePath.length - 1 : null,
    terrainMovementCost: terrainCost,
    effectiveMovementCost: effectiveCost,
    roadDistance: road?.roadDistance ?? null,
    roadRoles: road?.roadRoles ?? [],
    branchIds: road?.branchIds ?? [],
    hasOffRoadSegments: (road?.offRoadDistance ?? 0) > 0,
    offRoadDistance: road?.offRoadDistance ?? null,
    startsAtStrategicNode: nodeKeys.has(hexKey(resolvedSource.position)),
    endsAtStrategicNode: nodeKeys.has(hexKey(resolvedDestination.position)),
    currentSingleAction: singleAction,
    publicMovementConditions: {
      publiclyOccupiedHexesConsidered: publiclyOccupied.size,
      visibleBarbedWireHexesEntered: routePath?.filter((position, index) => index > 0 && visibleWireKeys.has(hexKey(position))).length ?? 0,
    },
    strategicNodes: page(strategic, input.ranges?.strategicNodes),
    supplyTransitions: page(supply, input.ranges?.supplyTransitions),
    hexPath: page(hexPath, input.ranges?.hexPath, input.includeHexPath === true),
  };
}

export function routeStrategicNodeIdAt(position: HexCoord): string {
  return strategicNodeId(position);
}
