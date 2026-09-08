import { hexDistance, hexKey, hexNeighbors, parseHexKey } from './hex';
import type { FacilityDefinition, FixedMap, HexCoord, HexTile } from './types';

export type RoadRole = 'trunk' | 'collector' | 'access';
export interface RoadSegment { id: string; role: RoadRole; path: HexCoord[] }
export interface RoadNetwork {
  generatorVersion: 'connector-roads-v1'; layoutSeed: number; settingsId: string; inputHash: string;
  segments: RoadSegment[];
}
export interface RoadStyle {
  districtRadius: number; optionalRatio: number; plain: number; forest: number; mountain: number;
  shared: number; turn: number; offAxis: number; parallel: number;
}
export const ROAD_STYLE: RoadStyle = { districtRadius: 6, optionalRatio: .30, plain: 10, forest: 25, mountain: 80, shared: 3, turn: 3, offAxis: 2, parallel: 8 };
export interface RoadInput {
  width: number; height: number; tiles: readonly HexTile[];
  facilities: readonly Pick<FacilityDefinition, 'id' | 'type' | 'position'>[];
  trunks: readonly RoadSegment[]; forbidden: readonly { position: HexCoord; reason: string }[];
  layoutSeed: number; style: RoadStyle;
}
const order = (a: HexCoord, b: HexCoord) => a.q - b.q || a.r - b.r;
const edgeKey = (a: HexCoord, b: HexCoord) => [hexKey(a), hexKey(b)].sort().join('|');
/** Stable content identifier, independent of gameplay RNG. Integrity at storage boundaries uses SHA-256. */
export function roadHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  let h = 2166136261;
  for (const c of JSON.stringify(canonical(value))) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function roadEdges(network: RoadNetwork): Array<{ a: HexCoord; b: HexCoord; role: RoadRole }> {
  const edges = new Map<string, { a: HexCoord; b: HexCoord; role: RoadRole }>();
  const rank = { trunk: 0, collector: 1, access: 2 };
  for (const segment of network.segments) for (let i = 1; i < segment.path.length; i++) {
    const a = segment.path[i - 1]!, b = segment.path[i]!;
    if (hexDistance(a, b) !== 1) throw new Error(`Nonadjacent road: ${segment.id}`);
    const key = edgeKey(a, b), existing = edges.get(key);
    if (!existing || rank[segment.role] < rank[existing.role]) edges.set(key, order(a, b) < 0 ? { a, b, role: segment.role } : { a: b, b: a, role: segment.role });
  }
  return [...edges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => e);
}
export function roadConnections(network: RoadNetwork): Map<string, Array<{ position: HexCoord; role: RoadRole }>> {
  const result = new Map<string, Array<{ position: HexCoord; role: RoadRole }>>();
  for (const e of roadEdges(network)) for (const [a, b] of [[e.a, e.b], [e.b, e.a]] as const) {
    const list = result.get(hexKey(a)) ?? []; list.push({ position: b, role: e.role }); result.set(hexKey(a), list);
  }
  return result;
}
class Heap<T> {
  private values: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  push(value: T) { const a = this.values; a.push(value); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.compare(a[p]!, value) <= 0) break; a[i] = a[p]!; i = p; } a[i] = value; }
  pop(): T | undefined { const a = this.values, first = a[0], last = a.pop(); if (a.length && last !== undefined) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && this.compare(a[c + 1]!, a[c]!) < 0) c++; if (this.compare(last, a[c]!) <= 0) break; a[i] = a[c]!; i = c; } a[i] = last; } return first; }
}
interface Route { path: HexCoord[]; cost: number; turns: number; fresh: number }
function planner(input: RoadInput, network: RoadNetwork) {
  const tiles = new Map(input.tiles.map(t => [hexKey(t), t]));
  const forbidden = new Set(input.forbidden.map(f => hexKey(f.position)));
  const graph = roadConnections(network);
  const existing = new Set(roadEdges(network).map(e => edgeKey(e.a, e.b)));
  const sites = new Set(input.facilities.filter(f => !['capital', 'city'].includes(f.type)).map(f => hexKey(f.position)));
  const allowed = (p: HexCoord) => { const t = tiles.get(hexKey(p)); return !!t && t.terrain !== 'water' && t.playerOccupancyAllowed && !forbidden.has(hexKey(p)); };
  const route = (start: HexCoord, targets: ReadonlySet<string>, aesthetic = true): Route | null => {
    type Node = { p: HexCoord; direction: number; cost: number; fresh: number; turns: number; previous: Node | null; serial: number };
    let serial = 0;
    const compare = (a: Node, b: Node) => a.cost - b.cost || a.fresh - b.fresh || a.turns - b.turns || order(a.p, b.p) || a.direction - b.direction || a.serial - b.serial;
    const heap = new Heap<Node>(compare), best = new Map<string, Node>();
    if (!allowed(start)) return null;
    heap.push({ p: start, direction: -1, cost: 0, fresh: 0, turns: 0, previous: null, serial: serial++ });
    let node: Node | undefined;
    while ((node = heap.pop())) {
      const key = `${hexKey(node.p)}:${node.direction}`;
      if (best.has(key) && compare(best.get(key)!, node) < 0) continue;
      if (targets.has(hexKey(node.p))) { const path: HexCoord[] = []; let n: Node | null = node; while (n) { path.push(n.p); n = n.previous; } return { path: path.reverse(), cost: node.cost, fresh: node.fresh, turns: node.turns }; }
      // A non-city site can only be a terminal, unless the edge already existed.
      for (const [direction, p] of hexNeighbors(node.p).entries()) {
        if (node.direction >= 0 && direction === (node.direction + 3) % 6) continue;
        if (!allowed(p)) continue;
        const shared = existing.has(edgeKey(node.p, p));
        if (!shared && sites.has(hexKey(p)) && !targets.has(hexKey(p))) continue;
        if (!shared && sites.has(hexKey(node.p)) && hexKey(node.p) !== hexKey(start)) continue;
        if (!shared && ((graph.get(hexKey(p))?.length ?? 0) >= 4 || (graph.get(hexKey(node.p))?.length ?? 0) >= 4)) continue;
        const bend = node.direction < 0 ? 0 : Math.min((direction - node.direction + 6) % 6, (node.direction - direction + 6) % 6);
        const terrain = tiles.get(hexKey(p))!.terrain as 'plain' | 'forest' | 'mountain';
        const nearRoad = !targets.has(hexKey(p)) && !graph.has(hexKey(p)) && hexDistance(p, start) > 2 && hexNeighbors(p).some(n => graph.has(hexKey(n)));
        const cost = (shared && aesthetic ? input.style.shared : input.style[terrain]) + (aesthetic ? bend * input.style.turn + (direction === 1 || direction === 4 ? input.style.offAxis : 0) + (nearRoad ? input.style.parallel : 0) : 0);
        const next: Node = { p, direction, cost: node.cost + cost, fresh: node.fresh + (shared ? 0 : 1), turns: node.turns + (bend > 0 ? 1 : 0), previous: node, serial: serial++ };
        const k = `${hexKey(p)}:${direction}`, prior = best.get(k);
        if (!prior || compare(next, prior) < 0) { best.set(k, next); heap.push(next); }
      }
    }
    return null;
  };
  return { graph, allowed, route: (start: HexCoord, targets: ReadonlySet<string>) => {
    const preferred = route(start, targets), plain = route(start, targets, false);
    return preferred && (!plain || preferred.path.length - 1 <= (plain.path.length - 1) * 1.5) ? preferred : plain;
  } };
}
interface District { id: string; center: HexCoord; importance: number; members: RoadInput['facilities'][number][] }
export function extractRoadDistricts(input: RoadInput): District[] {
  const sorted = [...input.facilities].sort((a, b) => order(a.position, b.position) || a.id.localeCompare(b.id));
  const districts: District[] = sorted.filter(f => ['capital', 'city'].includes(f.type)).map(f => ({ id: f.id, center: f.position, importance: f.type === 'capital' ? 4 : 3, members: [f] }));
  const network: RoadNetwork = { generatorVersion: 'connector-roads-v1', layoutSeed: input.layoutSeed, settingsId: roadHash(input.style), inputHash: '', segments: [...input.trunks] };
  const plan = planner(input, network), remaining = [];
  for (const f of sorted.filter(f => !['capital', 'city'].includes(f.type))) {
    const nearest = [...districts].filter(d => hexDistance(f.position, d.center) <= input.style.districtRadius)
      .sort((a, b) => hexDistance(f.position, a.center) - hexDistance(f.position, b.center) || order(a.center, b.center) || a.id.localeCompare(b.id))
      .find(d => plan.route(f.position, new Set([hexKey(d.center)])));
    if (nearest) nearest.members.push(f); else remaining.push(f);
  }
  while (remaining.length) {
    const members = [remaining.shift()!];
    for (let i = 0; i < remaining.length;) { const f = remaining[i]!; if (members.every(m => hexDistance(m.position, f.position) <= input.style.districtRadius)) { members.push(f); remaining.splice(i, 1); } else i++; }
    const sum = (p: HexCoord) => members.reduce((n, f) => n + hexDistance(p, f.position), 0);
    const sites = new Set(input.facilities.map(f => hexKey(f.position)));
    const candidates = input.tiles.filter(t => plan.allowed(t) && !sites.has(hexKey(t))).sort((a, b) => sum(a) - sum(b) || order(a, b));
    const center = candidates.find(t => members.every(f => plan.route(f.position, new Set([hexKey(t)]))));
    if (!center) throw new Error(`Road district has no reachable connection point: ${members.map(f => f.id).join(',')}`);
    districts.push({ id: `district-${members[0]!.id}`, center: { q: center.q, r: center.r }, importance: members.length > 1 ? 2 : 1, members });
  }
  return districts;
}
function graphDistance(graph: ReturnType<typeof roadConnections>, start: HexCoord, end: HexCoord): number {
  const queue = [{ key: hexKey(start), distance: 0 }], seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) { const n = queue[i]!; if (n.key === hexKey(end)) return n.distance; if (seen.has(n.key)) continue; seen.add(n.key); for (const e of graph.get(n.key) ?? []) if (!seen.has(hexKey(e.position))) queue.push({ key: hexKey(e.position), distance: n.distance + 1 }); }
  return Infinity;
}
export function generateRoadNetwork(input: RoadInput, optional = true): RoadNetwork {
  const normalized = { ...input, tiles: [...input.tiles].sort(order).map(t => ({ q: t.q, r: t.r, terrain: t.terrain, playerOccupancyAllowed: t.playerOccupancyAllowed })), facilities: [...input.facilities].sort((a, b) => order(a.position, b.position) || a.id.localeCompare(b.id)), trunks: [...input.trunks].sort((a, b) => a.id.localeCompare(b.id)), forbidden: [...input.forbidden].sort((a, b) => order(a.position, b.position)) };
  const network: RoadNetwork = { generatorVersion: 'connector-roads-v1', layoutSeed: input.layoutSeed, settingsId: roadHash(input.style), inputHash: roadHash(normalized), segments: structuredClone(normalized.trunks) };
  const districts = extractRoadDistricts(input), pending = [...districts];
  while (pending.length) {
    const plan = planner(input, network), targets = new Set([...plan.graph.keys()].filter(k => plan.allowed(parseHexKey(k))));
    const candidates = pending.map(d => ({ d, route: plan.route(d.center, targets) })).filter((x): x is { d: District; route: Route } => x.route !== null)
      .sort((a, b) => a.route.cost - b.route.cost || a.route.fresh - b.route.fresh || a.route.turns - b.route.turns || order(a.d.center, b.d.center) || a.d.id.localeCompare(b.d.id));
    const next = candidates[0];
    if (!next) throw new Error(`Road connection failed (water/reserve/forbidden/sites): ${pending.map(d => d.id).join(',')}`);
    if (next.route.path.length > 1) network.segments.push({ id: `collector-${next.d.id}`, role: 'collector', path: next.route.path });
    pending.splice(pending.indexOf(next.d), 1);
  }
  for (const f of normalized.facilities) connectRoadAccess(input, network, f.position, `access-${f.id}`);
  const trunkEdges = roadEdges({ ...network, segments: [...input.trunks] }).length;
  let budget = Math.floor((roadEdges(network).length - trunkEdges) * input.style.optionalRatio);
  if (optional) while (budget > 0) {
    const plan = planner(input, network), candidates: Array<{ route: Route; score: number; id: string }> = [];
    for (let i = 0; i < districts.length; i++) for (let j = i + 1; j < districts.length; j++) {
      const a = districts[i]!, b = districts[j]!;
      if (hexDistance(a.center, b.center) > Math.max(6, Math.floor(Math.min(input.width, input.height) / 4))) continue;
      const route = plan.route(a.center, new Set([hexKey(b.center)]));
      if (!route || route.fresh === 0 || route.fresh > budget) continue;
      const before = graphDistance(plan.graph, a.center, b.center);
      const segment: RoadSegment = { id: `loop-${a.id}-${b.id}`, role: 'collector', path: route.path };
      const trial = roadConnections({ ...network, segments: [...network.segments, segment] });
      const after = graphDistance(trial, a.center, b.center);
      if (before < after * 1.5 || before - after < 3 || [...trial.values()].some(v => v.length > 4)) continue;
      // Every new edge must have no existing alternate path shorter than five edges.
      let shortCycle = false;
      const growing = { ...network, segments: [...network.segments] };
      for (let k = 1; k < route.path.length; k++) {
        const u = route.path[k - 1]!, v = route.path[k]!;
        const distance = graphDistance(roadConnections(growing), u, v);
        if (distance > 1 && distance < 5) { shortCycle = true; break; }
        growing.segments.push({ id: 'trial', role: 'collector', path: [u, v] });
      }
      if (!shortCycle) candidates.push({ route, score: (before - after) * (a.importance + b.importance) / route.fresh, id: segment.id });
    }
    candidates.sort((a, b) => b.score - a.score || a.route.fresh - b.route.fresh || a.id.localeCompare(b.id));
    const best = candidates[0]; if (!best) break;
    network.segments.push({ id: best.id, role: 'collector', path: best.route.path }); budget -= best.route.fresh;
  }
  return network;
}
export function connectRoadAccess(input: RoadInput, network: RoadNetwork, position: HexCoord, id: string): void {
  const plan = planner(input, network); if (plan.graph.has(hexKey(position))) return;
  const targets = new Set([...plan.graph.keys()].filter(k => plan.allowed(parseHexKey(k)) && !input.facilities.some(f => !['capital', 'city'].includes(f.type) && hexKey(f.position) === k && !(plan.graph.get(k) ?? []).some(e => e.role === 'trunk'))));
  const route = plan.route(position, targets);
  if (!route) throw new Error(`Road access failed: ${id} at ${hexKey(position)} (water/reserve/forbidden/sites)`);
  network.segments.push({ id, role: 'access', path: route.path });
}
export function fixedRoadInput(map: Pick<FixedMap, 'tiles' | 'facilities' | 'roadBranches' | 'width' | 'height'>): RoadInput {
  return { width: map.width, height: map.height, tiles: map.tiles, facilities: map.facilities.map(f => ({ id: f.id, type: f.type, position: f.position })),
    trunks: map.roadBranches.map(b => ({ id: `trunk-${b.id}`, role: 'trunk', path: [b.capitalConnection, ...b.roadTiles] })), forbidden: [], layoutSeed: 0, style: { ...ROAD_STYLE } };
}
