import { occupiesGroundLayer, isAirborne } from './unit-capabilities';
import { effectiveMovementCost, hasMovementRoad } from './terrain';
import { getTile } from './map-reference';
import type { GameState, UnitState } from './types';
import type { SeededRng } from './rng';
import { createUnit, isHumanUnit, getUnit } from './state';
import { isHexSupplied } from './supply';
import { terrainAdjustedDamage } from './terrain';
import { damageWire, wireAt } from './barbed-wire';
import { emit } from './events-internal';
import { hexKey, hexNeighbors, hexWithinBounds, hexDistance } from './hex';

export interface SpawnOccupancyEntry {
  unitId: string;
  chainRootEventId: string;
  chainDepth: number;
}

export interface GasExplosionSiteTarget {
  siteKind: 'facility' | 'checkpoint';
  siteId: string;
}

interface GasExplosionEntry {
  sourceUnitId: string;
  position: UnitState['position'];
}

export interface UnitLifecycleHooks {
  applyGeneratedZombieOccupancy(state: GameState, zombie: UnitState, rng: SeededRng, queue: SpawnOccupancyEntry[], root: string, depth: number): void;
  processSpawnOccupancyQueue(state: GameState, rng: SeededRng, queue: SpawnOccupancyEntry[]): void;
  /** Apply only the direct population conversion. Site falls must wait for the second hook. */
  applyGasExplosionSiteInfection(
    state: GameState,
    target: GasExplosionSiteTarget,
    maxInfection: number,
    sourceGasId: string,
  ): number;
  /** Resolve falls and their shared spawn-occupancy FIFO after every direct effect is complete. */
  resolveGasExplosionSiteFalls(
    state: GameState,
    targets: readonly GasExplosionSiteTarget[],
    rng: SeededRng,
    sourceGasId: string,
  ): void;
}
/** Engine-owned effects retain death, credit, reanimation and FIFO occupancy order. */
export function createUnitLifecycle({
  applyGeneratedZombieOccupancy,
  processSpawnOccupancyQueue,
  applyGasExplosionSiteInfection,
  resolveGasExplosionSiteFalls,
}: UnitLifecycleHooks) {
function destroyUnit(
  state: GameState,
  unit: UnitState,
  cause: string,
  rng: SeededRng,
  explosionQueue: GasExplosionEntry[],
): void {
  const index = state.units.findIndex((candidate) => candidate.id === unit.id);
  if (index < 0) {
    return;
  }
  state.units.splice(index, 1);
  if (unit.transportedByUnitId) {
    const carrier = state.units.find(u=>u.id===unit.transportedByUnitId); if(carrier) delete carrier.cargoUnitId;
    delete unit.transportedByUnitId;
  }
  const cargo = state.units.find(u=>u.id===unit.cargoUnitId);
  delete unit.cargoUnitId;
  if(cargo) { cargo.position={...unit.position}; delete cargo.transportedByUnitId; destroyUnit(state,cargo,cause,rng,explosionQueue); }
  if (isHumanUnit(unit)) {
    state.statistics.unitLosses += 1;
    state.population.cumulativeDeaths += unit.population;
    if (unit.type === 'riotPolice') state.statistics.riotPoliceLost += 1;
  }
  if (unit.type === 'zombie') {
    state.statistics.normalZombiesKilled += 1;
  }
  if (unit.type === 'hordeZombie') {
    state.statistics.hordeZombiesKilled += 1;
  }
  if (unit.type === 'policeZombie') state.statistics.policeZombiesKilled += 1;
  if (unit.type === 'soldierZombie') state.statistics.soldierZombiesKilled += 1;
  if (unit.type === 'riotZombie') state.statistics.riotZombiesKilled += 1;
  if (unit.type === 'hunterZombie') state.statistics.hunterZombiesKilled += 1;
  if (unit.type === 'gasZombie') state.statistics.gasZombiesKilled += 1;
  if (unit.type === 'screamerZombie') state.statistics.screamerZombiesKilled += 1;
  if (unit.type === 'packZombie') state.statistics.packZombiesKilled += 1;
  if (!unit.isPlayerUnit) state.statistics.enemyKillsTotal += 1;
  if (!unit.isPlayerUnit && unit.hordeKind === 'final') state.statistics.finalHordeKilled += 1;
  emit(state, 'unit_destroyed', {
    unitId: unit.id,
    unitType: unit.type,
    isPlayerUnit: unit.isPlayerUnit,
    cause,
    q: unit.position.q,
    r: unit.position.r,
    inSupply: unit.isPlayerUnit ? isHexSupplied(state, unit.position) : false,
    lostFuel: unit.isPlayerUnit ? unit.currentFuel : 0,
    lostMilitaryGoods: unit.isPlayerUnit ? unit.currentMilitaryGoods : 0,
  });
  if (unit.type === 'gasZombie') {
    explosionQueue.push({ sourceUnitId: unit.id, position: { ...unit.position } });
  }
  if (isHumanUnit(unit)) reanimate(state,unit,cause,rng);
}

function reanimate(state: GameState, unit: UnitState, cause: string, rng: SeededRng): void {
  if (isHumanUnit(unit)) {
    const reanimatedType = state.config.units[unit.type].reanimationUnitType;
    if (!reanimatedType) return;
    const deathTile = getTile(state.map,unit.position);
    if (deathTile?.terrain === 'water' && !hasMovementRoad(state.map,unit.position)) return;
    const occupied = new Set(state.units.filter(occupiesGroundLayer).map(u=>hexKey(u.position)));
    const destination = state.map.tiles.filter(t=>!occupied.has(t.key) && effectiveMovementCost(state,t,false)!==null && (!wireAt(state,t) || t.key===hexKey(unit.position)))
      .sort((a,b)=>hexDistance(unit.position,a)-hexDistance(unit.position,b)||a.q-b.q||a.r-b.r)[0];
    if (!destination) { state.pendingReanimations.push({humanUnitId:unit.id,humanUnitType:unit.type,zombieUnitType:reanimatedType,position:{...unit.position},cause}); return; }
    const spawnPosition = {q:destination.q,r:destination.r};
    const prefix = reanimatedType === 'policeZombie'
      ? 'police-zombie'
      : reanimatedType === 'soldierZombie' ? 'soldier-zombie' : reanimatedType === 'packZombie' ? 'pack-zombie' : 'riot-zombie';
    let id = `${prefix}-${state.nextUnitNumber}`;
    while (state.units.some((candidate) => candidate.id === id)) {
      state.nextUnitNumber += 1;
      id = `${prefix}-${state.nextUnitNumber}`;
    }
    state.nextUnitNumber += 1;
    const reanimated = createUnit(state, id, reanimatedType, spawnPosition);
    const survivingWire = wireAt(state, spawnPosition);
    if (survivingWire) reanimated.reanimatedOnBarbedWireId = survivingWire.id;
    reanimated.canMove = reanimatedType === 'packZombie' && state.phase !== 'zombie';
    reanimated.canAttack = reanimated.canMove;
    reanimated.firstZombieActionTurn = state.phase === 'zombie' ? state.turn + 1 : state.turn;
    state.units.push(reanimated);
    if (reanimatedType === 'policeZombie') {
      state.statistics.policeZombiesSpawned += 1;
      state.statistics.policeReanimations += 1;
    } else {
      if (reanimatedType === 'soldierZombie') {
        state.statistics.soldierZombiesSpawned += 1;
        if (unit.type === 'nationalGuard') state.statistics.nationalGuardReanimations += 1;
      } else if (reanimatedType === 'riotZombie') {
        state.statistics.riotZombiesSpawned += 1;
        state.statistics.riotPoliceReanimations += 1;
      } else if (reanimatedType === 'packZombie') {
        state.statistics.packZombiesSpawned += 1;
        state.statistics.specialForcesReanimations += 1;
      }
    }
    const event = emit(state, 'human_unit_reanimated', {
      humanUnitId: unit.id,
      humanUnitType: unit.type,
      zombieUnitId: reanimated.id,
      zombieUnitType: reanimated.type,
      q: reanimated.position.q,
      r: reanimated.position.r,
      cause,
    });
    const beforeImmediate = state.statistics.immediateInfectionsFromSpawn;
    const beforeChains = state.statistics.chainOverruns;
    const beforeOccupancyEventIndex = state.events.length;
    const queue: SpawnOccupancyEntry[] = [];
    applyGeneratedZombieOccupancy(state, reanimated, rng, queue, event.id, 0);
    processSpawnOccupancyQueue(state, rng, queue);
    const occupancyEvents = state.events.slice(beforeOccupancyEventIndex);
    state.statistics.reanimationImmediateInfections +=
      state.statistics.immediateInfectionsFromSpawn - beforeImmediate;
    state.statistics.reanimationFacilityInfections += occupancyEvents.filter(
      (candidate) => candidate.type === 'site_immediate_infection' && candidate.payload.siteKind === 'facility',
    ).length;
    state.statistics.reanimationCheckpointInfections += occupancyEvents.filter(
      (candidate) => candidate.type === 'site_immediate_infection' && candidate.payload.siteKind === 'checkpoint',
    ).length;
    state.statistics.reanimationSiteFalls += occupancyEvents.filter(
      (candidate) => candidate.type === 'site_fallen' || candidate.type === 'site_chain_fallen',
    ).length;
    state.statistics.reanimationChainOverruns += state.statistics.chainOverruns - beforeChains;
  }
}

function applyDamageWithoutDeath(
  state: GameState,
  target: UnitState,
  amount: number,
  sourceId: string,
  cause: string,
): number {
  if ((isAirborne(target) || target.transportedByUnitId) && ['artillery','gas_explosion'].includes(cause)) return 0;
  if (!occupiesGroundLayer(target) && target.transportedByUnitId) return 0;
  if (occupiesGroundLayer(target) && target.isPlayerUnit && ['attack', 'counterattack', 'interception'].includes(cause)) {
    amount -= damageWire(state, target.position, amount, true);
  }
  const adjusted = terrainAdjustedDamage(state, target, amount);
  const damage = Math.max(0, Math.min(target.hp, adjusted.finalDamage));
  target.hp -= damage;
  if (adjusted.defense.source !== 'none') {
    const prevented = Math.max(0, adjusted.baseDamage - adjusted.finalDamage);
    if (adjusted.defense.source === 'urban') {
      state.statistics.urbanDefenseApplications += 1;
      state.statistics.urbanDefenseDamagePrevented += prevented;
    } else {
      state.statistics.forestDefenseApplications += 1;
      state.statistics.forestDefenseDamagePrevented += prevented;
    }
    emit(state, 'terrain_defense_applied', {
      targetId: target.id,
      source: adjusted.defense.source,
      multiplier: adjusted.defense.multiplier,
      baseDamage: adjusted.baseDamage,
      finalDamage: adjusted.finalDamage,
    });
  }
  emit(state, 'damage', {
    sourceId,
    targetId: target.id,
    amount: damage,
    cause,
    baseDamage: adjusted.baseDamage,
    terrainDefenseSource: adjusted.defense.source,
    terrainDamageMultiplier: adjusted.defense.multiplier,
  });
  return damage;
}

function snapshotExplosionSites(state: Readonly<GameState>, adjacentKeys: ReadonlySet<string>): GasExplosionSiteTarget[] {
  const facilities: GasExplosionSiteTarget[] = state.facilities
    .filter((facility) => adjacentKeys.has(hexKey(facility.position)))
    .map((facility) => ({ siteKind: 'facility', siteId: facility.id }));
  const checkpoints: GasExplosionSiteTarget[] = state.checkpoints
    .filter((checkpoint) => adjacentKeys.has(hexKey(checkpoint.position)))
    .map((checkpoint) => ({ siteKind: 'checkpoint', siteId: checkpoint.id }));
  return [...facilities, ...checkpoints].sort(
    (left, right) => left.siteKind.localeCompare(right.siteKind) || left.siteId.localeCompare(right.siteId),
  );
}

function resolveGasExplosions(
  state: GameState,
  rng: SeededRng,
  explosionQueue: GasExplosionEntry[],
): void {
  while (explosionQueue.length > 0) {
    const explosion = explosionQueue.shift()!;
    const adjacentKeys = new Set(
      hexNeighbors(explosion.position)
        .filter((position) => hexWithinBounds(position, state.map.width, state.map.height))
        .map(hexKey),
    );
    const unitSnapshot = state.units
      .filter((unit) => unit.hp > 0 && occupiesGroundLayer(unit) && adjacentKeys.has(hexKey(unit.position)))
      .sort((left, right) => left.id.localeCompare(right.id));
    const siteSnapshot = snapshotExplosionSites(state, adjacentKeys);
    const config = state.config.units.gasZombie;

    state.statistics.gasExplosions += 1;
    emit(state, 'gas_explosion', {
      sourceUnitId: explosion.sourceUnitId,
      q: explosion.position.q,
      r: explosion.position.r,
      radius: 1,
      baseHumanDamage: config.explosionDamage,
      baseZombieDamage: config.explosionZombieDamage,
      maxSiteInfection: config.explosionInfection,
    });

    for (const target of unitSnapshot) {
      state.statistics.gasExplosionUnitDamage += applyDamageWithoutDeath(
        state,
        target,
        target.isPlayerUnit ? config.explosionDamage : config.explosionZombieDamage,
        explosion.sourceUnitId,
        'gas_explosion',
      );
    }
    for (const target of siteSnapshot) {
      applyGasExplosionSiteInfection(
        state,
        target,
        config.explosionInfection,
        explosion.sourceUnitId,
      );
    }

    for (const target of unitSnapshot.filter((unit) => unit.hp <= 0)) {
      destroyUnit(state, target, 'gas_explosion', rng, explosionQueue);
    }
    resolveGasExplosionSiteFalls(state, siteSnapshot, rng, explosion.sourceUnitId);
  }
}

function creditZombieKill(state: GameState, sourceId: string, target: UnitState, cause: string): void {
  if (!!target.isPlayerUnit || !['attack', 'interception', 'counterattack', 'artillery'].includes(cause)) return;
  const source = getUnit(state, sourceId);
  if (!source || !isHumanUnit(source) || source.proficiency === null) return;
  if (source.proficiency === 'recruit') return;
  if (source.proficiency === 'veteran') {
    state.statistics.veteranZombieKillsByType[source.type] += 1;
    emit(state, 'unit_kill_credited', {
      unitId: source.id, unitType: source.type, targetId: target.id, targetType: target.type,
      proficiency: source.proficiency, count: source.regularZombieKills,
    });
    return;
  }
  if (!source.veteranPromotionPending) {
    source.regularZombieKills = Math.min(
      state.config.unitExperience.veteranZombieKillsRequired,
      source.regularZombieKills + 1,
    );
    emit(state, 'unit_kill_credited', {
      unitId: source.id, unitType: source.type, targetId: target.id, targetType: target.type,
      proficiency: source.proficiency, count: source.regularZombieKills,
    });
    if (source.regularZombieKills >= state.config.unitExperience.veteranZombieKillsRequired) {
      source.veteranPromotionPending = true;
      emit(state, 'unit_promotion_pending', {
        unitId: source.id, unitType: source.type, from: 'regular', into: 'veteran',
        turn: state.turn, reason: 'zombie_kills',
      });
    }
  }
}

function dealDamage(
  state: GameState,
  target: UnitState,
  amount: number,
  sourceId: string,
  cause: string,
  rng: SeededRng,
): void {
  applyDamageWithoutDeath(state, target, amount, sourceId, cause);
  if (target.hp <= 0) {
    const explosionQueue: GasExplosionEntry[] = [];
    creditZombieKill(state, sourceId, target, cause);
    destroyUnit(state, target, cause, rng, explosionQueue);
    resolveGasExplosions(state, rng, explosionQueue);
  }
}

  function dealAreaDamage(state: GameState, hits: Array<{ unit: UnitState; damage: number }>, sourceId: string, rng: SeededRng, populations: () => void, falls: () => void): void {
    const explosionQueue: GasExplosionEntry[] = [];
    for (const hit of hits) applyDamageWithoutDeath(state, hit.unit, hit.damage, sourceId, 'artillery');
    populations();
    for (const hit of hits) if (hit.unit.hp <= 0) {
      creditZombieKill(state, sourceId, hit.unit, 'artillery');
      destroyUnit(state, hit.unit, 'artillery', rng, explosionQueue);
    }
    falls();
    resolveGasExplosions(state, rng, explosionQueue);
  }
  function destroyForCrash(state: GameState, unit: UnitState, rng: SeededRng): void {
    const explosions: GasExplosionEntry[] = []; destroyUnit(state,unit,'aircraft_crash',rng,explosions); resolveGasExplosions(state,rng,explosions);
  }
  function retryPendingReanimations(state: GameState, rng: SeededRng): void {
    const pending=state.pendingReanimations; state.pendingReanimations=[];
    for(const entry of pending) reanimate(state,createUnit(state,entry.humanUnitId,entry.humanUnitType,entry.position),entry.cause,rng);
  }
  return { dealDamage, dealAreaDamage, destroyForCrash, retryPendingReanimations };
}
