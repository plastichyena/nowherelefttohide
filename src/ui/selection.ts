import type { GameState, HexCoord } from '../core/types';
import { hexKey } from '../core/hex';
import { getPlayerVisibleTileKeys } from '../core/visibility';

export type Selection =
  | { kind: 'unit'; id: string }
  | { kind: 'zombie'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'checkpoint'; id: string }
  | { kind: 'road'; position: HexCoord }
  | { kind: 'hex'; position: HexCoord }
  | null;
export type TileTarget = Exclude<Selection, null>;

export function selectionPosition(state: Readonly<GameState>, selection: Selection): HexCoord | null {
  if (!selection) return null;
  if ('position' in selection) return selection.position;
  const entities = selection.kind === 'facility' ? state.facilities
    : selection.kind === 'checkpoint' ? state.checkpoints : state.units;
  return entities.find(entity => entity.id === selection.id)?.position ?? null;
}

export function targetKey(target: Selection): string {
  return !target ? 'none' : `${target.kind}:${'id' in target ? target.id : hexKey(target.position)}`;
}

/** All public targets, including terrain beneath an occupied Hex. */
export function resolveTileTargets(state: Readonly<GameState>, position: HexCoord): TileTarget[] {
  const key = hexKey(position);
  if (!state.map.tiles.some(tile => hexKey(tile) === key)) return [];
  const units = state.units.filter(unit => unit.actionState !== 'destroyed' && !unit.transportedByUnitId && hexKey(unit.position) === key);
  const targets: TileTarget[] = units.filter(unit => unit.isPlayerUnit).map(unit => ({ kind: 'unit', id: unit.id }));
  const facility = state.facilities.find(item => hexKey(item.position) === key);
  const checkpoint = state.checkpoints.find(item => hexKey(item.position) === key);
  if (facility) targets.push({ kind: 'facility', id: facility.id });
  if (checkpoint) targets.push({ kind: 'checkpoint', id: checkpoint.id });
  const visible = getPlayerVisibleTileKeys(state);
  if (visible.has(key)) targets.push(...units.filter(unit => !unit.isPlayerUnit).map(unit => ({ kind: 'zombie' as const, id: unit.id })));
  const road = targets.length === 0 && state.map.roadBranches.some(branch => branch.roadTiles.some(tile => hexKey(tile) === key));
  targets.push({ kind: road ? 'road' : 'hex', position: { ...position } });
  return targets;
}

/** Direct repeat taps cycle only principal targets; the header selects all. */
export function nextPrincipalTarget(state: Readonly<GameState>, position: HexCoord, selected: Selection): Selection {
  const principal = resolveTileTargets(state, position).filter(target => ['unit', 'facility', 'checkpoint'].includes(target.kind));
  if (principal.length < 2) return null;
  const index = principal.findIndex(target => targetKey(target) === targetKey(selected));
  return principal[(index + 1) % principal.length]!;
}

export function selectableSelection(state: Readonly<GameState>, selection: Selection): Selection {
  const position = selectionPosition(state, selection);
  return position && resolveTileTargets(state, position).some(target => targetKey(target) === targetKey(selection)) ? selection : null;
}
