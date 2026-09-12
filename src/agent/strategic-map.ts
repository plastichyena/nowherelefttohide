import { HEX_DIRECTION_ORDER, hexDistance, hexKey, hexNeighbor, parseHexKey } from '../core/hex';
import type { RoadNetwork, RoadRole } from '../core/roads';
import { roadHash } from '../core/roads';
import type { FacilityType, HexCoord } from '../core/types';
import type {
  AgentMapObservation,
  AgentMapTileObservation,
  AgentRoadBranchObservation,
} from './types';

export interface StrategicMapSource {
  map: Pick<AgentMapObservation, 'id' | 'width' | 'height' | 'roads' | 'tiles'>;
  facilities: ReadonlyArray<{ id: string; type: FacilityType; position: HexCoord }>;
  checkpoints: ReadonlyArray<{ id: string; branchId: string; position: HexCoord; direction: string }>;
  roadBranches: ReadonlyArray<Pick<AgentRoadBranchObservation, 'branchId' | 'direction' | 'capitalConnection' | 'roadTiles' | 'entrance'>>;
}

export type StrategicNodeKind =
  | 'capital'
  | 'facility'
  | 'checkpoint'
  | 'entrance'
  | 'junction'
  | 'road-end'
  | 'role-transition'
  | 'loop-anchor'
  | 'isolated-road';

export interface StrategicMapNode {
  id: string;
  position: HexCoord;
  kinds: StrategicNodeKind[];
  facilityIds: string[];
  checkpointIds: string[];
  entranceBranchIds: string[];
  branchIds: string[];
  directionLabels: string[];
  connectedToRoad: boolean;
}

export interface StrategicMapEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  from: HexCoord;
  to: HexCoord;
  length: number;
  roadRoles: RoadRole[];
  branchId: string | null;
}

export interface StrategicMapGraph {
  mapId: string;
  nodes: StrategicMapNode[];
  edges: StrategicMapEdge[];
  unconnectedFacilityIds: string[];
}

interface RoadLink {
  a: HexCoord;
  b: HexCoord;
  roles: Set<RoadRole>;
  branchIds: Set<string>;
}

interface RoadTopology {
  coordinates: Map<string, HexCoord>;
  links: Map<string, RoadLink>;
  adjacency: Map<string, RoadLink[]>;
}

const ROLE_ORDER: readonly RoadRole[] = ['trunk', 'collector', 'access'];
const NODE_KIND_ORDER: readonly StrategicNodeKind[] = [
  'capital',
  'facility',
  'checkpoint',
  'entrance',
  'junction',
  'road-end',
  'role-transition',
  'loop-anchor',
  'isolated-road',
];

function compareCoordinates(left: HexCoord, right: HexCoord): number {
  return left.q - right.q || left.r - right.r;
}

function linkKey(left: HexCoord, right: HexCoord): string {
  return [hexKey(left), hexKey(right)].sort().join('|');
}

export function strategicNodeId(position: HexCoord): string {
  return `strategic-node:${position.q},${position.r}`;
}

function addCoordinate(coordinates: Map<string, HexCoord>, position: HexCoord): void {
  const key = hexKey(position);
  if (!coordinates.has(key)) coordinates.set(key, { ...position });
}

function addLink(
  topology: Pick<RoadTopology, 'coordinates' | 'links'>,
  left: HexCoord,
  right: HexCoord,
  role: RoadRole,
): void {
  if (hexDistance(left, right) !== 1) throw new Error(`Strategic road contains non-adjacent coordinates: ${hexKey(left)} -> ${hexKey(right)}`);
  addCoordinate(topology.coordinates, left);
  addCoordinate(topology.coordinates, right);
  const key = linkKey(left, right);
  const existing = topology.links.get(key);
  if (existing) {
    existing.roles.add(role);
    return;
  }
  const [a, b] = compareCoordinates(left, right) <= 0 ? [left, right] : [right, left];
  topology.links.set(key, { a: { ...a }, b: { ...b }, roles: new Set([role]), branchIds: new Set() });
}

function branchLinkSets(source: StrategicMapSource): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const branch of source.roadBranches) {
    const path = [branch.capitalConnection, ...branch.roadTiles];
    result.set(branch.branchId, new Set(path.slice(1).map((position, index) => linkKey(path[index]!, position))));
  }
  return result;
}

function inferLegacyLinks(topology: Pick<RoadTopology, 'coordinates' | 'links'>, tiles: readonly AgentMapTileObservation[]): void {
  const roadTiles = new Map(
    tiles
      .filter((tile) => tile.movementRoad === true || tile.road)
      .map((tile) => [hexKey(tile), tile] as const),
  );
  for (const tile of roadTiles.values()) addCoordinate(topology.coordinates, tile);
  for (const tile of roadTiles.values()) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const neighbor = hexNeighbor(tile, direction);
      if (!roadTiles.has(hexKey(neighbor))) continue;
      const roles = [...new Set([...(tile.roadRoles ?? []), ...(roadTiles.get(hexKey(neighbor))?.roadRoles ?? [])])];
      addLink(topology, tile, neighbor, roles[0] ?? 'trunk');
      const existing = topology.links.get(linkKey(tile, neighbor))!;
      for (const role of roles.slice(1)) existing.roles.add(role);
    }
  }
}

function buildRoadTopology(source: StrategicMapSource): RoadTopology {
  const topology: RoadTopology = { coordinates: new Map(), links: new Map(), adjacency: new Map() };
  const network: RoadNetwork | undefined = source.map.roads;
  if (network) {
    for (const segment of network.segments) {
      for (const position of segment.path) addCoordinate(topology.coordinates, position);
      for (let index = 1; index < segment.path.length; index += 1) {
        addLink(topology, segment.path[index - 1]!, segment.path[index]!, segment.role);
      }
    }
  } else {
    inferLegacyLinks(topology, source.map.tiles);
  }
  const branches = branchLinkSets(source);
  for (const [key, link] of topology.links) {
    for (const [branchId, keys] of branches) if (keys.has(key)) link.branchIds.add(branchId);
    for (const position of [link.a, link.b]) {
      const list = topology.adjacency.get(hexKey(position)) ?? [];
      list.push(link);
      topology.adjacency.set(hexKey(position), list);
    }
  }
  for (const key of topology.coordinates.keys()) {
    const list = topology.adjacency.get(key) ?? [];
    list.sort((left, right) => {
      const leftOther = hexKey(hexKey(left.a) === key ? left.b : left.a);
      const rightOther = hexKey(hexKey(right.a) === key ? right.b : right.a);
      return leftOther.localeCompare(rightOther);
    });
    topology.adjacency.set(key, list);
  }
  return topology;
}

function otherEnd(link: RoadLink, currentKey: string): HexCoord {
  return hexKey(link.a) === currentKey ? link.b : link.a;
}

function roleSignature(link: RoadLink): string {
  return ROLE_ORDER.filter((role) => link.roles.has(role)).join('|');
}

function coordinateBranchIds(source: StrategicMapSource, position: HexCoord): string[] {
  const key = hexKey(position);
  return source.roadBranches
    .filter((branch) => [branch.capitalConnection, ...branch.roadTiles].some((candidate) => hexKey(candidate) === key))
    .map((branch) => branch.branchId)
    .sort();
}

function findRoadComponents(topology: RoadTopology): string[][] {
  const unseen = new Set(topology.coordinates.keys());
  const components: string[][] = [];
  while (unseen.size > 0) {
    const first = [...unseen].map(parseHexKey).sort(compareCoordinates)[0]!;
    const pending = [hexKey(first)];
    const component: string[] = [];
    unseen.delete(pending[0]!);
    for (let index = 0; index < pending.length; index += 1) {
      const key = pending[index]!;
      component.push(key);
      for (const link of topology.adjacency.get(key) ?? []) {
        const next = hexKey(otherEnd(link, key));
        if (unseen.delete(next)) pending.push(next);
      }
    }
    components.push(component.sort((a, b) => compareCoordinates(parseHexKey(a), parseHexKey(b))));
  }
  return components;
}

function canonicalPath(path: readonly HexCoord[]): HexCoord[] {
  const forward = path.map(hexKey).join('|');
  const reversed = [...path].reverse();
  return forward <= reversed.map(hexKey).join('|') ? path.map((position) => ({ ...position })) : reversed.map((position) => ({ ...position }));
}

function compressedEdges(topology: RoadTopology, nodeKeys: ReadonlySet<string>): StrategicMapEdge[] {
  const visited = new Set<string>();
  const result: StrategicMapEdge[] = [];
  const starts = [...nodeKeys]
    .filter((key) => topology.coordinates.has(key))
    .map(parseHexKey)
    .sort(compareCoordinates);
  for (const start of starts) {
    const startKey = hexKey(start);
    for (const firstLink of topology.adjacency.get(startKey) ?? []) {
      const firstLinkKey = linkKey(firstLink.a, firstLink.b);
      if (visited.has(firstLinkKey)) continue;
      const path: HexCoord[] = [{ ...start }];
      const roles = new Set<RoadRole>();
      let branchIds: Set<string> | null = null;
      let previousKey = startKey;
      let currentLink = firstLink;
      while (true) {
        const currentLinkKey = linkKey(currentLink.a, currentLink.b);
        if (visited.has(currentLinkKey)) break;
        visited.add(currentLinkKey);
        for (const role of currentLink.roles) roles.add(role);
        if (branchIds === null) {
          branchIds = new Set(currentLink.branchIds);
        } else {
          const retained = new Set<string>();
          for (const branchId of branchIds as Set<string>) {
            if (currentLink.branchIds.has(branchId)) retained.add(branchId);
          }
          branchIds = retained;
        }
        const next = otherEnd(currentLink, previousKey);
        const nextKey = hexKey(next);
        path.push({ ...next });
        if (nodeKeys.has(nextKey)) break;
        const continuation = (topology.adjacency.get(nextKey) ?? [])
          .find((candidate) => !visited.has(linkKey(candidate.a, candidate.b)));
        if (!continuation) break;
        previousKey = nextKey;
        currentLink = continuation;
      }
      const end = path.at(-1)!;
      const normalized = canonicalPath(path);
      const normalizedFrom = normalized[0]!;
      const normalizedTo = normalized.at(-1)!;
      const fromNodeId = strategicNodeId(normalizedFrom);
      const toNodeId = strategicNodeId(normalizedTo);
      result.push({
        id: `strategic-edge:${fromNodeId}:${toNodeId}:${roadHash(normalized)}`,
        fromNodeId,
        toNodeId,
        from: { ...normalizedFrom },
        to: { ...normalizedTo },
        length: Math.max(0, path.length - 1),
        roadRoles: ROLE_ORDER.filter((role) => roles.has(role)),
        branchId: branchIds?.size === 1 ? [...branchIds][0]! : null,
      });
      if (!nodeKeys.has(hexKey(end))) throw new Error(`Compressed road ended without a strategic node at ${hexKey(end)}`);
    }
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

/** Derive the transport-independent strategic graph from public map facts only. */
export function deriveStrategicMap(source: Readonly<StrategicMapSource>): StrategicMapGraph {
  const topology = buildRoadTopology(source as StrategicMapSource);
  const kinds = new Map<string, Set<StrategicNodeKind>>();
  const addKind = (position: HexCoord, kind: StrategicNodeKind): void => {
    const key = hexKey(position);
    const current = kinds.get(key) ?? new Set<StrategicNodeKind>();
    current.add(kind);
    kinds.set(key, current);
  };

  for (const facility of source.facilities) {
    addKind(facility.position, 'facility');
    if (facility.type === 'capital') addKind(facility.position, 'capital');
  }
  for (const tile of source.map.tiles) if (tile.facilityId) addKind(tile, 'facility');
  for (const checkpoint of source.checkpoints) addKind(checkpoint.position, 'checkpoint');
  for (const tile of source.map.tiles) if (tile.checkpointId) addKind(tile, 'checkpoint');
  for (const branch of source.roadBranches) addKind(branch.entrance, 'entrance');
  for (const tile of source.map.tiles) if (tile.hordeEntranceDirections.length > 0) addKind(tile, 'entrance');

  for (const [key, position] of topology.coordinates) {
    const adjacent = topology.adjacency.get(key) ?? [];
    if (adjacent.length === 0) addKind(position, 'isolated-road');
    else if (adjacent.length === 1) addKind(position, 'road-end');
    else if (adjacent.length > 2) addKind(position, 'junction');
    else if (roleSignature(adjacent[0]!) !== roleSignature(adjacent[1]!)) addKind(position, 'role-transition');
  }

  for (const component of findRoadComponents(topology)) {
    if (component.some((key) => kinds.has(key))) continue;
    addKind(parseHexKey(component[0]!), 'loop-anchor');
  }

  const nodeKeys = new Set(kinds.keys());
  const facilitiesByKey = new Map<string, string[]>();
  for (const facility of source.facilities) {
    const key = hexKey(facility.position);
    facilitiesByKey.set(key, [...(facilitiesByKey.get(key) ?? []), facility.id]);
  }
  for (const tile of source.map.tiles) if (tile.facilityId) {
    const key = hexKey(tile);
    facilitiesByKey.set(key, [...(facilitiesByKey.get(key) ?? []), tile.facilityId]);
  }
  const checkpointsByKey = new Map<string, string[]>();
  for (const checkpoint of source.checkpoints) {
    const key = hexKey(checkpoint.position);
    checkpointsByKey.set(key, [...(checkpointsByKey.get(key) ?? []), checkpoint.id]);
  }
  for (const tile of source.map.tiles) if (tile.checkpointId) {
    const key = hexKey(tile);
    checkpointsByKey.set(key, [...(checkpointsByKey.get(key) ?? []), tile.checkpointId]);
  }
  const entrancesByKey = new Map<string, string[]>();
  for (const branch of source.roadBranches) {
    const key = hexKey(branch.entrance);
    entrancesByKey.set(key, [...(entrancesByKey.get(key) ?? []), branch.branchId]);
  }
  const tilesByKey = new Map(source.map.tiles.map((tile) => [hexKey(tile), tile]));

  const nodes = [...kinds.entries()]
    .map(([key, nodeKinds]): StrategicMapNode => {
      const position = parseHexKey(key);
      const entranceBranchIds = [...new Set(entrancesByKey.get(key) ?? [])].sort();
      const branchIds = coordinateBranchIds(source as StrategicMapSource, position);
      const directionLabels = [...new Set([
        ...source.roadBranches.filter((branch) => branchIds.includes(branch.branchId)).map((branch) => branch.direction),
        ...source.checkpoints.filter((checkpoint) => hexKey(checkpoint.position) === key).map((checkpoint) => checkpoint.direction),
        ...(tilesByKey.get(key)?.hordeEntranceDirections ?? []),
      ])].sort();
      return {
        id: strategicNodeId(position),
        position,
        kinds: NODE_KIND_ORDER.filter((kind) => nodeKinds.has(kind)),
        facilityIds: [...new Set(facilitiesByKey.get(key) ?? [])].sort(),
        checkpointIds: [...new Set(checkpointsByKey.get(key) ?? [])].sort(),
        entranceBranchIds,
        branchIds,
        directionLabels,
        connectedToRoad: (topology.adjacency.get(key)?.length ?? 0) > 0,
      };
    })
    .sort((left, right) => compareCoordinates(left.position, right.position) || left.id.localeCompare(right.id));
  const unconnectedFacilityIds = nodes
    .filter((node) => node.facilityIds.length > 0 && !node.connectedToRoad)
    .flatMap((node) => node.facilityIds)
    .sort();
  return {
    mapId: source.map.id,
    nodes,
    edges: compressedEdges(topology, nodeKeys),
    unconnectedFacilityIds,
  };
}

export type StrategicMapCollection = 'nodes' | 'edges';

/** A small adapter for Session's existing revision-bound cursor pagination. */
export function strategicMapItems(
  graph: Readonly<StrategicMapGraph>,
  collection: StrategicMapCollection,
): Array<StrategicMapNode | StrategicMapEdge> {
  return collection === 'nodes'
    ? graph.nodes.map((node) => structuredClone(node))
    : graph.edges.map((edge) => structuredClone(edge));
}
