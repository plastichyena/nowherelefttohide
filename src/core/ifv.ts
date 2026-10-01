import type { GameState, HexCoord, UnitState } from './types';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { terrainAdjustedDamage, effectiveMovementCost } from './terrain';
import { getPlayerVisibleTileKeys } from './visibility';
import { occupiesGroundLayer } from './unit-capabilities';

/** The entry gate excludes chain explosions, by design. No RNG or state writes. */
export function overrunDamage(state: Readonly<GameState>, mover: UnitState, target: UnitState, position: HexCoord) {
  const impactDamage = target.attack * target.attackChargesRemaining;
  const gasDamage = target.type === 'gasZombie'
    ? terrainAdjustedDamage(state, { ...mover, position }, state.config.units.gasZombie.explosionDamage).finalDamage : 0;
  return { impactDamage, gasDamage, survivesEntry: impactDamage + gasDamage < mover.hp };
}

export interface OverrunProjection {
  targetId: string; position: HexCoord; impactDamage: number; gasDamage: number;
  remainingEnemyCharges: number; executed: boolean; hpAfter: number;
}

export interface IfvPublicActor { hp: number; currentFuel: number; position: HexCoord; cargoUnitId?: string | null }
export interface IfvPublicEnemy { id: string; type: string; hp: number; position: HexCoord; attack: number; attackChargesRemaining: number }
/** Shared deterministic projection. Inputs contain public facts only. */
export function projectIfvPath(unit: IfvPublicActor, path: readonly HexCoord[], facts: {
  enemies: readonly IfvPublicEnemy[]; visible: ReadonlySet<string>; fuelPerHex: number;
  movementCost: (position: HexCoord) => number;
  gasDamage: (position: HexCoord) => number;
  zombieGasDamage: (enemy: IfvPublicEnemy) => number;
}) {
  const visible = facts.visible;
  const enemies = facts.enemies.map(u => ({ ...u }));
  const mover = { ...unit, position: { ...unit.position } };
  const overruns: OverrunProjection[] = [];
  const gasExplosions: { sourceId: string; position: HexCoord }[] = [];
  let fuelCost = 0, effectiveMovementCostTotal = 0;
  let arrivalReason = 'planned_destination';
  for (const position of path.slice(1)) {
    if (mover.currentFuel <= 0) { arrivalReason = 'fuel_exhausted'; break; }
    const target = enemies.find(u => u.hp > 0 && hexKey(u.position) === hexKey(position));
    const impact = target ? target.attack * target.attackChargesRemaining : 0;
    const gas = target?.type === 'gasZombie' ? facts.gasDamage(position) : 0;
    const damage = target ? { impactDamage: impact, gasDamage: gas, survivesEntry: impact + gas < mover.hp } : null;
    if (damage && !damage.survivesEntry) {
      overruns.push({ targetId: target!.id, position: { ...position }, ...damage, remainingEnemyCharges: target!.attackChargesRemaining, executed: false, hpAfter: mover.hp });
      arrivalReason = 'overrun_insufficient_hp'; break;
    }
    const cost = Math.min(mover.currentFuel, facts.fuelPerHex);
    fuelCost += cost; mover.currentFuel -= cost; mover.position = { ...position };
    effectiveMovementCostTotal += facts.movementCost(position);
    if (target && damage) {
      target.hp = 0; mover.hp -= damage.impactDamage;
      const queue = target.type === 'gasZombie' ? [target] : [];
      const exploded = new Set<string>();
      while (queue.length) {
        const gas = queue.shift()!;
        if (exploded.has(gas.id)) continue;
        exploded.add(gas.id); gasExplosions.push({ sourceId: gas.id, position: { ...gas.position } });
        if (gas.id === target.id || hexDistance(gas.position, mover.position) === 1) {
          mover.hp = Math.max(0, mover.hp - facts.gasDamage(mover.position));
        }
        const hit = enemies.filter(e => e.hp > 0 && hexDistance(e.position, gas.position) === 1).sort((a,b) => a.id.localeCompare(b.id));
        for (const e of hit) e.hp = Math.max(0, e.hp - facts.zombieGasDamage(e));
        queue.push(...hit.filter(e => e.hp === 0 && e.type === 'gasZombie'));
      }
      overruns.push({ targetId: target.id, position: { ...position }, ...damage, remainingEnemyCharges: target.attackChargesRemaining, executed: true, hpAfter: mover.hp });
      if (mover.hp === 0) { arrivalReason = 'unit_destroyed'; break; }
    }
  }
  const destinationReached = mover.hp > 0 && hexKey(mover.position) === hexKey(path.at(-1)!);
  if (!destinationReached && arrivalReason === 'planned_destination') arrivalReason = 'fuel_exhausted';
  return { legal: true, reason: null, path: [...path], fuelExhaustionHex: arrivalReason === 'fuel_exhausted' ? mover.position : null, reached: mover.position, interception: null, fuelCost,
    projectedFuelAfterMove: mover.currentFuel, projectedHpAfterMove: mover.hp,
    movementMode: 'normal' as const, effectiveMovementCost: effectiveMovementCostTotal,
    destinationReached, arrivalReason, overruns, gasExplosions,
    cargoDeathRisk: !!unit.cargoUnitId && (mover.hp === 0 || gasExplosions.length > 0),
    hiddenEffectsMayDiffer: path.some(p => [p, ...hexNeighbors(p)].some(h => !visible.has(hexKey(h)))) || gasExplosions.length > 0,
    limitations: ['currently_visible_enemies_only', 'chain_explosions_excluded_from_entry_gate', 'reanimation_and_site_spawn_consequences_not_predicted'],
  };
}

/** Core adapter sanitizes hidden enemies before calling the shared projection. */
export function previewIfvPath(state: Readonly<GameState>, unit: UnitState, path: HexCoord[]) {
  const visible = getPlayerVisibleTileKeys(state);
  return projectIfvPath(unit, path, {
    visible, fuelPerHex: state.config.units.ifv.fuelPerHex,
    enemies: state.units.filter(u => !u.isPlayerUnit && visible.has(hexKey(u.position)) && occupiesGroundLayer(u)),
    movementCost: p => effectiveMovementCost(state, p, true) ?? 0,
    gasDamage: p => terrainAdjustedDamage(state, { ...unit, position: p }, state.config.units.gasZombie.explosionDamage).finalDamage,
    zombieGasDamage: e => terrainAdjustedDamage(state, state.units.find(u => u.id === e.id)!, state.config.units.gasZombie.explosionZombieDamage).finalDamage,
  });
}
