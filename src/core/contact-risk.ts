import type { GameState, HexCoord } from './types';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { findShortestPath, pathMovementCost } from './path';
import { createMovementCostResolver } from './terrain';
import { getPlayerVisibleTileKeys } from './visibility';
import { effectiveZombieMovement } from './zombie-movement';
import { isAirborne } from './unit-capabilities';

/** Public, conditional reachability. No target, pursuit memory or hidden obstacle reads. */
export function destinationContactRisk(state: Readonly<GameState>, unitId: string, destination: HexCoord) {
  const visible = getPlayerVisibleTileKeys(state);
  const mover = state.units.find(u => u.id === unitId && u.isPlayerUnit);
  const terrain = createMovementCostResolver(state);
  const wires = new Set(state.barbedWire.filter(w => w.hp > 0 && visible.has(hexKey(w.position))).map(w => hexKey(w.position)));
  const enemies = state.units.filter(u => !u.isPlayerUnit && visible.has(hexKey(u.position))).sort((a,b) => a.id.localeCompare(b.id)).map(enemy => {
    const maximumNextMovement = enemy.movement + state.config.zombiePursuitMovementBonus;
    const distance = hexDistance(enemy.position, destination);
    const targets = [...hexNeighbors(destination), ...(mover && isAirborne(mover) ? [destination] : [])];
    const paths = distance <= maximumNextMovement + enemy.range ? targets.map(target => findShortestPath(state.map,enemy.position,target,new Set(),p => terrain(p) === null ? null : 1)).filter((p):p is HexCoord[] => p !== null) : [];
    paths.sort((a,b) => a.length-b.length || a.at(-1)!.q-b.at(-1)!.q || a.at(-1)!.r-b.at(-1)!.r);
    const path = paths[0] ?? null;
    const movementCost = path ? pathMovementCost(path,terrain) : null;
    const crossesVisibleWall = path?.slice(1).some(p => wires.has(hexKey(p))) ?? false;
    const crossesUnseenHex = path?.some(p => !visible.has(hexKey(p))) ?? false;
    const canTarget = !mover || !isAirborne(mover) || state.config.units[enemy.type].canTargetAir;
    return { enemyId:enemy.id, distance, baseMovement:enemy.movement, latestEffectiveMovement:effectiveZombieMovement(enemy), maximumNextMovement, attackRange:enemy.range,
      contactPossible:canTarget && movementCost !== null && movementCost <= maximumNextMovement,
      movementCost, crossesVisibleWall, crossesUnseenHex,
      basis:!canTarget?'cannot_target_air':!path?'outside_reachable_terrain':movementCost!>maximumNextMovement?'insufficient_terrain_mp':crossesVisibleWall?'requires_prior_wall_destruction':crossesUnseenHex?'unseen_obstacles_unknown':'possible_if_targeted_and_route_stays_open',
    };
  });
  return { destination:{...destination}, enemies, possibleVisibleEnemyCount:enemies.filter(e=>e.contactPossible).length, guaranteedSafe:false as const,
    conditions:'Visible enemies only. Next movement uses the possible pursuit bonus, not private target or memory. Actual order, interception, wall destruction, hidden enemies and target changes may alter contact. This advice never prohibits a legal Move.' };
}
