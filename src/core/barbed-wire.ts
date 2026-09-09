import type { GameState, HexCoord, UnitState } from './types';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { canPlayerOccupyHex, getTile } from './map';
import { getCapitalPosition, isHexSupplied } from './supply';
import { getPlayerVisibleTileKeys } from './visibility';
import { terrainAdjustedDamage } from './terrain';
import { createMapReference } from './map-reference';
import { getSuppliedTileKeys } from './supply';

export const BARBED_WIRE_RULES = {
  maxHp: 10, civilianGoods: 5, militaryGoods: 5, humanEntryMP: 5,
  minimumRadialDistance: 3, repair: false, gasAbsorption: false,
  reanimation: 'same-hex spawn exception; cannot re-enter after exit',
  routeEvaluation: 'terrain MP + attack count + future-charge turns * movement; stable coordinate ties',
} as const;

export function wireAt(state: Pick<GameState, 'barbedWire'>, position: HexCoord) {
  return state.barbedWire.find(w => w.hp > 0 && hexKey(w.position) === hexKey(position));
}

export function radialConflict(capital: HexCoord, a: HexCoord, b: HexCoord): boolean {
  const separation = hexDistance(a, b);
  return separation > 0 && separation < 3 && Math.abs(hexDistance(capital, a) - hexDistance(capital, b)) === separation;
}

/** Visibility requirements are checked before reading enemies or obstacles. */
export function wireBuildReason(state: Readonly<GameState>, position: HexCoord, context?: { map: ReturnType<typeof createMapReference>; visible: ReadonlySet<string>; supplied: ReadonlySet<string> }): string | null {
  if (state.gameOver || state.phase !== 'player') return 'wrong_phase';
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) return 'action_limit';
  if (state.resources.civilianGoods < 5 || state.resources.militaryGoods < 5) return 'insufficient_resources';
  const tileAt = context ? context.map.getTile : (p: HexCoord) => getTile(state.map, p);
  const tile = tileAt(position);
  if (!(context ? context.map.canPlayerOccupyHex(position) : canPlayerOccupyHex(state.map, position)) || !tile || state.config.terrain.movementCost[tile.terrain] === null) return 'impassable';
  const visible = context?.visible ?? getPlayerVisibleTileKeys(state);
  const capital = getCapitalPosition(state.map);
  const inspect = new Map([[hexKey(position), position]]);
  for (const adjacent of hexNeighbors(position)) {
    if (tileAt(adjacent)) inspect.set(hexKey(adjacent), adjacent);
    for (const distant of hexNeighbors(adjacent)) {
      if (tileAt(distant) && radialConflict(capital, position, distant)) inspect.set(hexKey(distant), distant);
    }
  }
  if ([...inspect.keys()].some(key => !visible.has(key))) return 'visibility_required';
  if (!(context ? context.supplied.has(hexKey(position)) : isHexSupplied(state, position))) return 'out_of_supply';
  const key = hexKey(position);
  if (state.facilities.some(f => hexKey(f.position) === key) || state.checkpoints.some(c => hexKey(c.position) === key) || wireAt(state, position) || state.units.some(u => hexKey(u.position) === key)) return 'occupied';
  if (state.units.some(u => !u.isPlayerUnit && hexDistance(u.position, position) === 1)) return 'enemy_adjacent';
  if (state.barbedWire.some(w => radialConflict(capital, position, w.position))) return 'radial_spacing';
  return null;
}

export function wireCandidates(state: Readonly<GameState>) {
  const visible = getPlayerVisibleTileKeys(state);
  const context = { map: createMapReference(state.map), visible, supplied: new Set(getSuppliedTileKeys(state)) };
  return state.map.tiles.filter(tile => visible.has(hexKey(tile))).map(tile => ({ position: { q: tile.q, r: tile.r }, reason: wireBuildReason(state, tile, context) })).map(c => ({ ...c, legal: c.reason === null }));
}

/** Internal atomic damage. Events are emitted only while the wall is visible. */
export function damageWire(state: GameState, position: HexCoord, damage: number, protectingHuman = false): number {
  const wire = wireAt(state, position);
  if (!wire) return 0;
  const absorbed = Math.min(wire.hp, Math.max(0, Math.floor(damage)));
  wire.hp -= absorbed;
  if (getPlayerVisibleTileKeys(state).has(hexKey(position))) {
    state.events.push({ id: `event-${state.nextEventNumber++}`, turn: state.turn, phase: state.phase, type: 'barbed_wire_damaged', payload: { wireId: wire.id, q: position.q, r: position.r, damage: absorbed, protectingHuman, hp: wire.hp, destroyed: wire.hp === 0 } });
  }
  if (wire.hp === 0) {
    state.barbedWire.splice(state.barbedWire.indexOf(wire), 1);
    for (const unit of state.units) if (unit.reanimatedOnBarbedWireId === wire.id) delete unit.reanimatedOnBarbedWireId;
  }
  return absorbed;
}

export function wireRoutePenalty(state: Readonly<GameState>, zombie: UnitState, position: HexCoord): number {
  const wire = wireAt(state, position);
  if (!wire) return 0;
  return wireBreakCost(wire.hp, zombie);
}

export function wireBreakCost(hp: number, zombie: Pick<UnitState, 'attack' | 'attackChargesRemaining' | 'maxAttackCharges' | 'movement'>): number {
  const attacks = Math.ceil(hp / Math.max(1, zombie.attack));
  return attacks + Math.ceil(Math.max(0, attacks - zombie.attackChargesRemaining) / Math.max(1, zombie.maxAttackCharges)) * zombie.movement;
}

export function wireCombatProjection(state: Readonly<GameState>, human: UnitState, attack: number) {
  const wire = human.isPlayerUnit ? wireAt(state, human.position) : undefined;
  const wallDamage = Math.min(wire?.hp ?? 0, attack);
  const humanDamage = Math.min(human.hp, terrainAdjustedDamage(state, human, Math.max(0, attack - wallDamage)).finalDamage);
  return { attack, wireId: wire?.id ?? null, wallDamage, remainingWallHp: Math.max(0, (wire?.hp ?? 0) - wallDamage), humanDamage, remainingHumanHp: human.hp - humanDamage };
}
