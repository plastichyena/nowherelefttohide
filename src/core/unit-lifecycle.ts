import type { GameState, UnitState } from './types';
import type { SeededRng } from './rng';
import { createUnit, isHumanUnit, getUnit } from './state';
import { isHexSupplied } from './supply';
import { terrainAdjustedDamage } from './terrain';
import { emit } from './events-internal';

export interface SpawnOccupancyEntry {
  unitId: string;
  chainRootEventId: string;
  chainDepth: number;
}


export interface UnitLifecycleHooks {
  applyGeneratedZombieOccupancy(state: GameState, zombie: UnitState, rng: SeededRng, queue: SpawnOccupancyEntry[], root: string, depth: number): void;
  processSpawnOccupancyQueue(state: GameState, rng: SeededRng, queue: SpawnOccupancyEntry[]): void;
}
/** Engine-owned effects retain death, credit, reanimation and FIFO occupancy order. */
export function createUnitLifecycle({ applyGeneratedZombieOccupancy, processSpawnOccupancyQueue }: UnitLifecycleHooks) {
function destroyUnit(state: GameState, unit: UnitState, cause: string, rng: SeededRng): void {
  const index = state.units.findIndex((candidate) => candidate.id === unit.id);
  if (index < 0) {
    return;
  }
  state.units.splice(index, 1);
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
  if (isHumanUnit(unit)) {
    const reanimatedType = state.config.units[unit.type].reanimationUnitType;
    const prefix = reanimatedType === 'policeZombie'
      ? 'police-zombie'
      : reanimatedType === 'soldierZombie' ? 'soldier-zombie' : 'riot-zombie';
    let id = `${prefix}-${state.nextUnitNumber}`;
    while (state.units.some((candidate) => candidate.id === id)) {
      state.nextUnitNumber += 1;
      id = `${prefix}-${state.nextUnitNumber}`;
    }
    state.nextUnitNumber += 1;
    const reanimated = createUnit(state, id, reanimatedType, unit.position);
    reanimated.canMove = false;
    reanimated.canAttack = false;
    state.units.push(reanimated);
    if (reanimatedType === 'policeZombie') {
      state.statistics.policeZombiesSpawned += 1;
      state.statistics.policeReanimations += 1;
    } else {
      if (reanimatedType === 'soldierZombie') {
        state.statistics.soldierZombiesSpawned += 1;
        state.statistics.nationalGuardReanimations += 1;
      } else {
        state.statistics.riotZombiesSpawned += 1;
        state.statistics.riotPoliceReanimations += 1;
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

function creditZombieKill(state: GameState, sourceId: string, target: UnitState, cause: string): void {
  if (!!target.isPlayerUnit || !['attack', 'interception', 'counterattack'].includes(cause)) return;
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
  if (target.hp <= 0) {
    creditZombieKill(state, sourceId, target, cause);
    destroyUnit(state, target, cause, rng);
  }
}

  return { dealDamage };
}
