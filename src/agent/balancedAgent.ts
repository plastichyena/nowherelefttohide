import { hexDistance, hexKey } from '../core/hex';
import type { FacilityType, GameAction, HexCoord } from '../core/types';
import { actionKey, cloneAction, sortActions } from './action';
import { BALANCED_AGENT_VERSION, type AgentCandidateScore, type AgentDecision, type AgentObservation, type AgentPriorityGoal, type GameAgent } from './types';
import { BALANCED_THRESHOLDS, BALANCED_WEIGHTS, type BalancedStrategyWeights } from './strategies';

function nearestDistance(position: HexCoord, targets: readonly HexCoord[]): number {
  if (targets.length === 0) return 99;
  return Math.min(...targets.map((target) => hexDistance(position, target)));
}

function shortage(observation: AgentObservation): number {
  return observation.endTurnForecast.food.shortage +
    observation.endTurnForecast.civilianGoods.shortage +
    observation.endTurnForecast.fuel.shortage +
    observation.endTurnForecast.electricity.shortage;
}

interface ZombieThreat {
  zombieId: string;
  targetFacilityId: string;
  contactNow: boolean;
  contactNextTurn: boolean;
  threatensCapital: boolean;
  threatensCriticalFacility: boolean;
  score: number;
}

const PRODUCTION_TYPES: readonly FacilityType[] = [
  'farm',
  'civilianFactory',
  'militaryFactory',
  'refinery',
  'powerPlant',
];

function ownedOperationalFacilities(observation: AgentObservation) {
  return observation.facilities.filter((facility) =>
    facility.owner === 'player' && facility.status === 'owned' && facility.healthyPopulation > 0,
  );
}

function isSingleSupplyFacility(facilityId: string, observation: AgentObservation): boolean {
  const facility = observation.facilities.find((candidate) => candidate.id === facilityId);
  if (!facility || !PRODUCTION_TYPES.includes(facility.type)) return false;
  return ownedOperationalFacilities(observation).filter((candidate) => candidate.type === facility.type).length <= 1;
}

function isCriticalFacility(facilityId: string, observation: AgentObservation): boolean {
  const facility = observation.facilities.find((candidate) => candidate.id === facilityId);
  return facility?.type === 'capital' || facility?.type === 'militaryFactory' || isSingleSupplyFacility(facilityId, observation);
}

function zombieThreats(observation: AgentObservation): ZombieThreat[] {
  const facilities = ownedOperationalFacilities(observation);
  return observation.zombies.map((zombie) => {
    const candidates = facilities.map((facility) => {
      const distance = hexDistance(zombie.position, facility.position);
      const contactNow = distance === 0;
      const contactNextTurn = distance <= zombie.movement;
      const threatensCapital = facility.type === 'capital';
      const threatensCriticalFacility = isCriticalFacility(facility.id, observation);
      let score = Math.max(0, zombie.movement + 2 - distance) * 35;
      if (contactNextTurn) score += 320;
      if (contactNow) score += 420;
      if (threatensCriticalFacility) score += 220;
      if (threatensCapital) score += 420;
      if (facility.type === 'militaryFactory') score += 180;
      score += Math.min(100, facility.healthyPopulation * 2);
      return { facility, contactNow, contactNextTurn, threatensCapital, threatensCriticalFacility, score };
    });
    const imminent = candidates.filter((candidate) => candidate.contactNextTurn);
    const targetPool = imminent.length > 0 ? imminent : candidates;
    targetPool.sort((left, right) => right.score - left.score || left.facility.id.localeCompare(right.facility.id));
    const target = targetPool[0];
    return {
      zombieId: zombie.id,
      targetFacilityId: target?.facility.id ?? '',
      contactNow: target?.contactNow ?? false,
      contactNextTurn: target?.contactNextTurn ?? false,
      threatensCapital: target?.threatensCapital ?? false,
      threatensCriticalFacility: target?.threatensCriticalFacility ?? false,
      score: target?.score ?? 0,
    };
  }).sort((left, right) => right.score - left.score || left.zombieId.localeCompare(right.zombieId));
}

function militaryReserveDeficit(observation: AgentObservation): number {
  const maintenance = observation.endTurnForecast.militaryGoods.maintenanceRequired;
  const target = maintenance * BALANCED_THRESHOLDS.militaryReserveTurns + BALANCED_THRESHOLDS.militaryProductionCostBuffer;
  return Math.max(0, target - observation.resources.militaryGoods);
}

function primaryGoal(
  observation: AgentObservation,
  legalActions: readonly GameAction[],
  threats: readonly ZombieThreat[],
): AgentPriorityGoal {
  const forecastCivilianLoss = observation.endTurnForecast.food.shortage + observation.endTurnForecast.civilianGoods.shortage;
  if (forecastCivilianLoss >= observation.population.healthyCivilians) return 'avoid_defeat';
  if (threats.some((threat) => threat.contactNextTurn)) return 'prevent_facility_contact';
  if (observation.facilities.some((facility) => facility.infectedPopulation > 0 && isCriticalFacility(facility.id, observation))) {
    return 'rescue_critical_infection';
  }
  if (observation.population.infected > 0) return 'suppress_infection';
  if (observation.horde.turnsRemaining <= BALANCED_THRESHOLDS.hordeUrgentTurns) return 'defend_horde';
  if (shortage(observation) > 0) return 'restore_economy';
  if (!observation.resources.militarySupplyAvailable || militaryReserveDeficit(observation) > 0) return 'restore_military_supply';
  if (observation.endTurnForecast.overcrowding.additionalFood > 0) return 'reduce_overcrowding';
  if (legalActions.some((action) => action.type === 'Attack')) return 'combat';
  if (legalActions.some((action) => action.type === 'ProduceUnit')) return 'build_forces';
  if (legalActions.some((action) => action.type === 'Move') && observation.facilities.some((facility) => facility.owner === 'none')) return 'secure_facilities';
  if (legalActions.some((action) => action.type === 'BuildCheckpoint' || action.type === 'RelocateCheckpoint' || action.type === 'SetCheckpointPolicy')) return 'manage_checkpoint';
  return 'end_turn';
}

function facilityResourceValue(type: FacilityType, observation: AgentObservation): number {
  if (type === 'farm') return observation.endTurnForecast.food.shortage > 0 ? 5 : 2;
  if (type === 'civilianFactory') return observation.endTurnForecast.civilianGoods.shortage > 0 ? 5 : 2;
  if (type === 'refinery') return observation.endTurnForecast.fuel.shortage > 0 ? 5 : 2;
  if (type === 'powerPlant') return observation.endTurnForecast.electricity.shortage > 0 ? 5 : 2;
  if (type === 'militaryFactory') return observation.resources.militarySupplyAvailable ? 1 : 4;
  if (type === 'city') return 3;
  return 4;
}

function hordeEntrancePositions(observation: AgentObservation): HexCoord[] {
  return observation.map.tiles
    .filter((tile) => tile.hordeEntranceDirections.includes(observation.horde.direction))
    .map((tile) => ({ q: tile.q, r: tile.r }));
}

function repeatSensitiveActionFamily(action: GameAction, observation: AgentObservation): string | null {
  if (action.type === 'AssignWorkers') {
    const facility = observation.facilities.find((candidate) => candidate.id === action.facilityId);
    return facility?.type === 'militaryFactory' ? 'AssignWorkers|militaryFactory' : `AssignWorkers|${action.facilityId}`;
  }
  if (action.type === 'TransferPopulation') return 'TransferPopulation';
  if (action.type === 'SetCheckpointPolicy') return `SetCheckpointPolicy|${action.checkpointId}`;
  if (action.type === 'BuildCheckpoint') return `BuildCheckpoint|${action.branchId ?? 'unknown'}`;
  if (action.type === 'RelocateCheckpoint') return `RelocateCheckpoint|${action.checkpointId}`;
  return null;
}

function branchFor(observation: AgentObservation, branchId: string | undefined) {
  return observation.roadBranches.find((branch) => branch.branchId === branchId);
}

function checkpointBranch(observation: AgentObservation, checkpointId: string) {
  return observation.checkpoints.find((checkpoint) => checkpoint.id === checkpointId)?.branchId;
}

function unmanagedRoadUrgency(observation: AgentObservation): number {
  return observation.roadBranches.reduce((score, branch) => {
    if (branch.activeCheckpointId !== null) return score;
    if (branch.turnsUntilArrival <= 0) return score + 5;
    if (branch.turnsUntilArrival <= 1) return score + 3;
    if (branch.turnsUntilArrival <= 2) return score + 1;
    return score;
  }, 0);
}

function scoreAction(
  action: GameAction,
  observation: AgentObservation,
  goal: AgentPriorityGoal,
  weights: Readonly<BalancedStrategyWeights>,
  threats: readonly ZombieThreat[],
  canRespondToThreat: boolean,
  canRespondToInfection: boolean,
): AgentCandidateScore {
  let score = action.type === 'EndTurn' ? weights.endTurn : 0;
  const reasonCodes: string[] = [];
  const facilities = new Map(observation.facilities.map((facility) => [facility.id, facility]));
  const units = new Map(observation.units.map((unit) => [unit.id, unit]));
  const zombies = new Map(observation.zombies.map((unit) => [unit.id, unit]));
  const threatByZombie = new Map(threats.map((threat) => [threat.zombieId, threat]));
  const urgentHorde = observation.horde.turnsRemaining <= BALANCED_THRESHOLDS.hordeUrgentTurns;
  const urgentThreats = threats.filter((threat) => threat.contactNextTurn);
  const reserveDeficit = militaryReserveDeficit(observation);
  const roadUrgency = unmanagedRoadUrgency(observation);

  if (action.type === 'Attack') {
    const attacker = units.get(action.attackerId);
    const target = zombies.get(action.targetId);
    const threat = threatByZombie.get(action.targetId);
    score += weights.attack;
    reasonCodes.push('ATTACK_THREAT');
    if (attacker && target && attacker.attack >= target.hp) {
      score += weights.lethalAttack;
      reasonCodes.push('LETHAL_ATTACK');
    }
    if (threat?.contactNextTurn) {
      score += weights.contactDenial + threat.score;
      reasonCodes.push('DENY_FACILITY_CONTACT');
    }
    if (threat?.threatensCriticalFacility) {
      score += weights.criticalFacilityDefense;
      reasonCodes.push('DEFEND_CRITICAL_FACILITY');
    }
    if (attacker?.type === 'nationalGuard' && target && attacker.attack >= target.hp) {
      score += weights.safeGuardShot;
      reasonCodes.push('STATE_GUARD_CONTACT_DENIAL');
      if (hexDistance(attacker.position, target.position) > target.effectiveRange) {
        score += weights.safeGuardShot * 0.5;
        reasonCodes.push('SAFE_RANGE_ATTACK');
      }
      if (attacker.rangeModifierReason === 'military_supply_shortage') reasonCodes.push('MILITARY_SUPPLY_RANGE_REDUCED');
    }
    if (attacker?.type === 'police' && !threat?.threatensCapital) {
      score -= weights.policePreservation;
      reasonCodes.push('PRESERVE_POLICE_FOR_SUPPRESSION');
    }
    if (attacker && target) {
      const targetWillDie = attacker.attack >= target.hp;
      const followUpThreats = observation.zombies.filter((zombie) =>
        (!targetWillDie || zombie.id !== target.id) &&
        hexDistance(attacker.position, zombie.position) <= zombie.movement + zombie.effectiveRange,
      ).length;
      if (followUpThreats > 0) {
        const exposureWeight = attacker.type === 'police'
          ? weights.policePreservation * 2.5
          : weights.criticalFacilityDefense;
        score -= followUpThreats * exposureWeight;
        reasonCodes.push('AVOID_MULTI_ZOMBIE_EXPOSURE');
      }
    }
    if (attacker && attacker.hp / attacker.maxHp < BALANCED_THRESHOLDS.lowHpRatio && target && target.hp >= attacker.hp) {
      score -= 120;
      reasonCodes.push('AVOID_LOW_HP_RISK');
    }
  } else if (action.type === 'AssignWorkers') {
    const facility = facilities.get(action.facilityId);
    if (facility) {
      const delta = action.workers - facility.healthyPopulation;
      if (delta > 0 && !facility.inSupply) {
        score -= 10_000;
        reasonCodes.push('SUPPLY_OUTSIDE_REJECTS_WORKER_INCREASE');
      } else if (delta < 0 && !facility.inSupply) {
        reasonCodes.push('WORKER_DECREASE_OUTSIDE_SUPPLY');
      }
      let targetWorkers = facility.healthyPopulation;
      let need = facilityResourceValue(facility.type, observation);
      if (facility.type === 'farm') {
        targetWorkers = Math.min(facility.populationCapacity, Math.max(facility.healthyPopulation === 0 ? 8 : facility.healthyPopulation, facility.healthyPopulation + Math.ceil(observation.endTurnForecast.food.shortage / 4)));
      } else if (facility.type === 'civilianFactory') {
        targetWorkers = Math.min(facility.populationCapacity, Math.max(facility.healthyPopulation === 0 ? 8 : facility.healthyPopulation, facility.healthyPopulation + Math.ceil(observation.endTurnForecast.civilianGoods.shortage / 4)));
      } else if (facility.type === 'refinery') {
        targetWorkers = Math.min(facility.populationCapacity, Math.max(facility.healthyPopulation === 0 ? 5 : facility.healthyPopulation, facility.healthyPopulation + Math.ceil(observation.endTurnForecast.fuel.shortage / 4)));
      } else if (facility.type === 'powerPlant') {
        const generationPerWorker = Math.max(1, facility.production.powerGenerationPerWorker);
        targetWorkers = Math.min(facility.populationCapacity, Math.max(facility.healthyPopulation, facility.healthyPopulation + Math.ceil(observation.endTurnForecast.electricity.shortage / generationPerWorker)));
      } else if (facility.type === 'militaryFactory' && reserveDeficit > 0) {
        const immediateCivilianShortage = observation.endTurnForecast.food.shortage + observation.endTurnForecast.civilianGoods.shortage;
        if (immediateCivilianShortage === 0 || !observation.resources.militarySupplyAvailable) {
          const sustainableOutputWorkers = Math.ceil(observation.endTurnForecast.militaryGoods.maintenanceRequired / 2);
          const reserveRecoveryWorkers = Math.min(3, Math.ceil(reserveDeficit / 10));
          targetWorkers = Math.min(facility.populationCapacity, Math.max(facility.healthyPopulation, sustainableOutputWorkers + reserveRecoveryWorkers));
        }
        need = Math.max(need, 5);
      }
      const beforeGap = Math.abs(facility.healthyPopulation - targetWorkers);
      const afterGap = Math.abs(action.workers - targetWorkers);
      const capital = observation.facilities.find((candidate) => candidate.type === 'capital' && candidate.owner === 'player');
      const capitalTarget = urgentThreats.some((threat) => threat.threatensCapital)
        ? BALANCED_THRESHOLDS.capitalPopulationDanger
        : BALANCED_THRESHOLDS.capitalPopulationSafe;
      const capitalDeficit = Math.max(0, capitalTarget - (capital?.healthyPopulation ?? 0));
      score += (beforeGap - afterGap) * weights.economyImprovement * need;
      if (delta > 0) reasonCodes.push(`STAFF_${facility.type.toUpperCase()}`);
      if (delta > 0 && capital) {
        const projectedCapital = Math.max(0, capital.healthyPopulation - delta);
        const projectedDeficit = Math.max(0, capitalTarget - projectedCapital);
        const addedDeficit = Math.max(0, projectedDeficit - capitalDeficit);
        if (addedDeficit > 0) {
          score -= addedDeficit * weights.capitalBuffer * 4;
          reasonCodes.push('PRESERVE_CAPITAL_POPULATION');
        }
      }
      if (delta > 0 && capitalDeficit > 0) {
        score -= Math.min(delta, capitalDeficit) * weights.capitalBuffer;
        reasonCodes.push('PRESERVE_CAPITAL_POPULATION');
      }
      if (delta < 0 && capitalDeficit > 0) {
        score += Math.min(Math.abs(delta), capitalDeficit) * weights.capitalBuffer;
        reasonCodes.push('RESTORE_CAPITAL_POPULATION');
      }
      if (
        delta > 0 &&
        facility.healthyPopulation === 0 &&
        PRODUCTION_TYPES.includes(facility.type) &&
        (shortage(observation) === 0 || facility.type !== 'militaryFactory')
      ) {
        const activeSameType = ownedOperationalFacilities(observation).filter((candidate) => candidate.type === facility.type).length;
        if (activeSameType < 2) {
          const redundancyStaff = Math.min(delta, targetWorkers);
          score += redundancyStaff * weights.redundancy;
          reasonCodes.push('STAFF_PRODUCTION_REDUNDANCY');
        }
      }
      if (facility.type === 'militaryFactory' && delta > 0 && reserveDeficit > 0) {
        const usefulWorkers = Math.min(delta, Math.max(0, targetWorkers - facility.healthyPopulation));
        const immediateCivilianShortage = observation.endTurnForecast.food.shortage + observation.endTurnForecast.civilianGoods.shortage;
        const urgencyMultiplier = immediateCivilianShortage > 0 && observation.resources.militarySupplyAvailable ? 0.2 : 1;
        score += usefulWorkers * weights.militaryReserve * Math.min(12, reserveDeficit) * urgencyMultiplier;
        reasonCodes.push('BUILD_MILITARY_RESERVE');
      }
      if (delta < 0 && observation.endTurnForecast.fuel.shortage > 0 && ['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)) {
        score += Math.abs(delta) * 25;
        reasonCodes.push('REDUCE_INPUT_DEMAND');
      }
      if (facility.type === 'powerPlant' && observation.endTurnForecast.electricity.shortage > 0 && delta > 0) {
        const affectedFacilities = observation.facilities.filter((candidate) =>
          candidate.owner === 'player' &&
          candidate.healthyPopulation > 0 &&
          candidate.production.requiresPower,
        ).length;
        score += 180 + affectedFacilities * 20;
        reasonCodes.push('RESTORE_POWER');
        if (affectedFacilities > 0) reasonCodes.push('PREVENT_POWER_CASCADE');
      }
    }
  } else if (action.type === 'TransferPopulation') {
    const from = facilities.get(action.fromFacilityId);
    const to = facilities.get(action.toFacilityId);
    if (from && to) {
      const fromExcess = Math.max(0, from.healthyPopulation - from.populationCapacity);
      const toRoom = Math.max(0, to.populationCapacity - to.healthyPopulation);
      const relief = Math.min(action.people, fromExcess, toRoom);
      score += relief * weights.overcrowdingRelief;
      if (relief > 0) reasonCodes.push('RELIEVE_OVERCROWDING');
      if (to.type === 'capital') {
        const capitalTarget = urgentThreats.some((threat) => threat.threatensCapital)
          ? BALANCED_THRESHOLDS.capitalPopulationDanger
          : BALANCED_THRESHOLDS.capitalPopulationSafe;
        const capitalDeficit = Math.max(0, capitalTarget - to.healthyPopulation);
        const buffered = Math.min(action.people, capitalDeficit);
        if (buffered > 0) {
          score += buffered * weights.capitalBuffer;
          score -= Math.max(0, action.people - capitalDeficit) * 15;
          reasonCodes.push('RESTORE_CAPITAL_POPULATION');
        }
      }
      if (urgentHorde) {
        const entrances = hordeEntrancePositions(observation);
        const dangerReduction = nearestDistance(from.position, entrances) - nearestDistance(to.position, entrances);
        score += dangerReduction * weights.hordeDefense;
        if (dangerReduction > 0) reasonCodes.push('EVACUATE_HORDE_DIRECTION');
      }
      if (relief === 0 && !urgentHorde && !reasonCodes.includes('RESTORE_CAPITAL_POPULATION')) score -= 80;
    }
  } else if (action.type === 'Move') {
    const unit = units.get(action.unitId);
    if (unit) {
      const infectedFacilities = observation.facilities.filter((facility) => facility.infectedPopulation > 0);
      const infected = infectedFacilities.map((facility) => facility.position);
      const unowned = observation.facilities.filter((facility) => facility.owner === 'none');
      const zombiePositions = observation.zombies.map((zombie) => zombie.position);
      const beforeZombie = nearestDistance(unit.position, zombiePositions);
      const afterZombie = nearestDistance(action.destination, zombiePositions);
      const effectiveRange = unit.effectiveRange;
      const lethalShotsFromDestination = observation.zombies.filter((zombie) =>
        hexDistance(action.destination, zombie.position) <= effectiveRange && unit.attack >= zombie.hp,
      ).length;
      const zombiesReachingDestination = observation.zombies.filter((zombie) =>
        hexDistance(action.destination, zombie.position) <= zombie.movement + zombie.effectiveRange,
      ).length;
      const followUpExposure = Math.max(0, zombiesReachingDestination - Math.min(1, lethalShotsFromDestination));
      if (unit.type === 'nationalGuard' && urgentThreats.length > 0) {
        let bestDenial = Number.NEGATIVE_INFINITY;
        for (const threat of urgentThreats) {
          const zombie = zombies.get(threat.zombieId);
          if (!zombie) continue;
          const before = hexDistance(unit.position, zombie.position);
          const after = hexDistance(action.destination, zombie.position);
          const firingProgress = Math.max(0, before - effectiveRange) - Math.max(0, after - effectiveRange);
          let denial = firingProgress * weights.contactDenial;
          if (after <= effectiveRange && unit.attack >= zombie.hp) {
            denial += threat.score + weights.safeGuardShot;
            if (after > zombie.effectiveRange) denial += weights.safeGuardShot;
          }
          bestDenial = Math.max(bestDenial, denial);
        }
        if (Number.isFinite(bestDenial)) score += bestDenial;
        if (bestDenial > 0) reasonCodes.push('MOVE_TO_CONTACT_DENIAL_SHOT');
      } else if (urgentThreats.length === 0 && zombiePositions.length > 0 && unit.hp / unit.maxHp >= BALANCED_THRESHOLDS.lowHpRatio) {
        score += (beforeZombie - afterZombie) * 25;
        if (afterZombie < beforeZombie) reasonCodes.push('APPROACH_THREAT');
      }
      if (infected.length > 0) {
        const progress = nearestDistance(unit.position, infected) - nearestDistance(action.destination, infected);
        const roleMultiplier = unit.type === 'police' ? 1.5 : 0.6;
        score += progress * weights.suppression * roleMultiplier;
        if (progress > 0) reasonCodes.push(unit.type === 'police' ? 'POLICE_RESPOND_TO_INFECTION' : 'APPROACH_INFECTION');
      } else if (unowned.length > 0 && urgentThreats.length === 0 && !urgentHorde) {
        let bestExpansion = Number.NEGATIVE_INFINITY;
        let bestTarget: typeof unowned[number] | undefined;
        for (const facility of unowned) {
          const ownedSameType = ownedOperationalFacilities(observation).filter((candidate) => candidate.type === facility.type).length;
          let strategicValue = facilityResourceValue(facility.type, observation) * 12;
          if (PRODUCTION_TYPES.includes(facility.type) && ownedSameType < 2) strategicValue += weights.redundancy;
          if (facility.type === 'farm' && ownedSameType < 2) strategicValue += weights.redundancy;
          if (facility.type === 'militaryFactory' && reserveDeficit > 0) strategicValue += weights.militaryReserve * Math.min(30, reserveDeficit);
          const progress = hexDistance(unit.position, facility.position) - hexDistance(action.destination, facility.position);
          let expansion = progress * (weights.captureProgress + strategicValue);
          if (hexDistance(action.destination, facility.position) === 0) expansion += strategicValue;
          if (expansion > bestExpansion) {
            bestExpansion = expansion;
            bestTarget = facility;
          }
        }
        if (Number.isFinite(bestExpansion)) score += bestExpansion;
        if (bestExpansion > 0) {
          reasonCodes.push('APPROACH_VALUABLE_FACILITY');
          if (bestTarget && PRODUCTION_TYPES.includes(bestTarget.type)) reasonCodes.push('SECURE_PRODUCTION_REDUNDANCY');
        }
      }
      const capitalEmergency = urgentThreats.some((threat) => threat.threatensCapital);
      if (unit.type === 'police' && infected.length === 0 && !capitalEmergency && afterZombie < beforeZombie) {
        score -= weights.policePreservation;
        reasonCodes.push('PRESERVE_POLICE_FOR_SUPPRESSION');
      }
      if (urgentHorde && urgentThreats.length === 0) {
        const entrances = hordeEntrancePositions(observation);
        if (unit.type === 'nationalGuard') {
          score += weights.hordeDefense * 3;
          const defendedFacilities = ownedOperationalFacilities(observation)
            .map((facility) => ({ facility, entranceDistance: nearestDistance(facility.position, entrances) }))
            .sort((left, right) => left.entranceDistance - right.entranceDistance || left.facility.id.localeCompare(right.facility.id))
            .slice(0, 3)
            .map(({ facility }) => facility.position);
          const progress = nearestDistance(unit.position, defendedFacilities) - nearestDistance(action.destination, defendedFacilities);
          score += progress * weights.hordeDefense;
          if (nearestDistance(action.destination, defendedFacilities) <= unit.effectiveRange) score += weights.hordeDefense;
          reasonCodes.push('DEFEND_FRONTLINE_FACILITY');
        } else {
          score -= weights.policePreservation * 0.5;
          reasonCodes.push('PRESERVE_POLICE_FOR_SUPPRESSION');
        }
      }
      if (followUpExposure > 0) {
        const exposureWeight = unit.type === 'police' ? weights.policePreservation : weights.criticalFacilityDefense;
        const healthMultiplier = unit.hp / unit.maxHp < 0.7 ? 1.5 : 1;
        score -= followUpExposure * exposureWeight * healthMultiplier;
        reasonCodes.push('AVOID_MULTI_ZOMBIE_EXPOSURE');
      }
      if (unit.type === 'police' && zombiesReachingDestination > 0 && infected.length === 0 && !capitalEmergency) {
        score -= zombiesReachingDestination * weights.policePreservation;
        reasonCodes.push('KEEP_POLICE_BEHIND_CONTACT_LINE');
      }
      const safeGuardPosition = unit.type === 'nationalGuard' && afterZombie <= effectiveRange && afterZombie > 1;
      if (unit.hp / unit.maxHp < BALANCED_THRESHOLDS.lowHpRatio && afterZombie <= 2 && !safeGuardPosition) {
        score -= 2_000;
        reasonCodes.push('AVOID_LOW_HP_RISK');
      }
      if (unit.hp < unit.maxHp && !unit.inSupply) {
        const destinationSupplied = observation.supply.suppliedTileKeys.includes(hexKey(action.destination));
        if (destinationSupplied) {
          score += weights.recoveryWait * 8 * (1 - unit.hp / unit.maxHp);
          reasonCodes.push('RETREAT_TO_SUPPLY_FOR_RECOVERY');
        } else {
          score -= weights.recoveryWait * 2;
          reasonCodes.push('REMAIN_OUT_OF_SUPPLY');
        }
      }
    }
  } else if (action.type === 'Wait') {
    const unit = units.get(action.unitId);
    if (unit?.suppressionAvailableIfTurnEndsNow) {
      const facility = unit.suppressionTargetId ? facilities.get(unit.suppressionTargetId) : undefined;
      score += weights.suppression + (facility?.infectedPopulation ?? 0) * 3;
      reasonCodes.push('AUTOMATIC_SUPPRESSION_READY');
      if (unit.type === 'police') {
        score += 45;
        reasonCodes.push('PREFER_POLICE_SUPPRESSION');
      } else if (unit.suppressionCivilianDamage > 0) {
        score -= unit.suppressionCivilianDamage * 30;
        reasonCodes.push('AVOID_SUPPRESSION_CIVILIAN_DAMAGE');
      }
    }
    if (unit && unit.hp < unit.maxHp && unit.recoveryClassIfTurnEndsNow === 'rest') {
      score += weights.recoveryWait * unit.recoveryRateIfTurnEndsNow * 15 * (1 - unit.hp / unit.maxHp);
      reasonCodes.push('REST_RECOVERY_20_PERCENT');
    } else if (unit && unit.hp < unit.maxHp && unit.recoveryClassIfTurnEndsNow === 'combat') {
      score += weights.recoveryWait * unit.recoveryRateIfTurnEndsNow * 2 * (1 - unit.hp / unit.maxHp);
      reasonCodes.push('COMBAT_RECOVERY_10_PERCENT');
    } else if (unit && unit.hp < unit.maxHp && unit.recoveryClassIfTurnEndsNow === 'outOfSupply') {
      score -= weights.recoveryWait;
      reasonCodes.push('RECOVERY_OUT_OF_SUPPLY');
    }
    if (unit?.type === 'police' && observation.population.infected === 0 && !urgentThreats.some((threat) => threat.threatensCapital)) {
      score += weights.policePreservation * 0.35;
      reasonCodes.push('HOLD_POLICE_IN_RESERVE');
    }
    if (urgentHorde && unit?.actionState === 'ready') score -= 25;
  } else if (action.type === 'ProduceUnit') {
    const unitCount = observation.units.length;
    const activeMilitaryFactory = observation.facilities.some((facility) =>
      facility.type === 'militaryFactory' &&
      facility.owner === 'player' &&
      facility.status === 'owned' &&
      facility.healthyPopulation > 0 &&
      facility.infectedPopulation === 0,
    );
    score += weights.production + (urgentHorde ? weights.hordeDefense * 2 : 0) + Math.max(0, 3 - unitCount) * 20;
    reasonCodes.push(urgentHorde ? 'PRODUCE_HORDE_DEFENDER' : 'BUILD_RESERVE');
    if (action.destination) {
      const destination = observation.facilities.find((facility) =>
        facility.position.q === action.destination!.q && facility.position.r === action.destination!.r,
      );
      if (destination && !destination.inSupply) {
        score -= 10_000;
        reasonCodes.push('SUPPLY_OUTSIDE_REJECTS_RECRUITMENT');
      } else if (destination?.recruitmentAvailable) {
        reasonCodes.push('RECRUIT_IN_SUPPLIED_CITY');
      }
    }
    if (action.unitType === 'police' && observation.population.infected > 0) {
      score += 60;
      reasonCodes.push('PRODUCE_SUPPRESSION_UNIT');
    }
    if (action.unitType === 'nationalGuard' && (urgentHorde || urgentThreats.length > 0)) {
      score += weights.safeGuardShot;
      reasonCodes.push('PRODUCE_CONTACT_DENIAL_UNIT');
    }
    const guardCount = observation.units.filter((unit) => unit.type === 'nationalGuard').length;
    if (
      action.unitType === 'nationalGuard' &&
      guardCount < 2 &&
      (activeMilitaryFactory || observation.resources.militaryGoods >= 50)
    ) {
      score += weights.contactDenial * 1.5;
      reasonCodes.push('BUILD_SECOND_CONTACT_DENIAL_UNIT');
    }
    const unitPopulation = action.unitType === 'police' ? 5 : 10;
    const perPopulationMaintenance = observation.population.unitPopulation > 0
      ? observation.endTurnForecast.militaryGoods.maintenanceRequired / observation.population.unitPopulation
      : 1;
    const projectedMaintenance = observation.endTurnForecast.militaryGoods.maintenanceRequired + unitPopulation * perPopulationMaintenance;
    const productionCost = action.unitType === 'police' ? 10 : 25;
    const unsupportedTurns = activeMilitaryFactory ? 1 : 2;
    const minimumMilitaryStock = productionCost + projectedMaintenance * unsupportedTurns;
    if (observation.resources.militaryGoods < minimumMilitaryStock) {
      score -= weights.militaryReserve * (minimumMilitaryStock - observation.resources.militaryGoods);
      reasonCodes.push('PRESERVE_MILITARY_RESERVE');
    }
    const capital = observation.facilities.find((facility) => facility.type === 'capital' && facility.owner === 'player');
    const capitalCost = action.unitType === 'police' ? 5 : 10;
    if (capital && capital.healthyPopulation - capitalCost < BALANCED_THRESHOLDS.capitalPopulationSafe) {
      score -= weights.capitalBuffer * (BALANCED_THRESHOLDS.capitalPopulationSafe - (capital.healthyPopulation - capitalCost));
      reasonCodes.push('PRESERVE_CAPITAL_POPULATION');
    }
    if (observation.population.healthyCivilians <= BALANCED_THRESHOLDS.criticalCivilianBuffer + (action.unitType === 'police' ? 5 : 10)) {
      score -= 250;
      reasonCodes.push('PRESERVE_CIVILIANS');
    }
  } else if (action.type === 'BuildCheckpoint') {
    const branch = branchFor(observation, action.branchId);
    score += weights.checkpoint + (urgentHorde ? 30 : 0);
    if (branch) {
      score += branch.turnsUntilArrival <= 1 ? 140 : branch.turnsUntilArrival <= 2 ? 65 : 0;
      if (branch.activeCheckpointId === null) reasonCodes.push('ROAD_UNMANAGED_ARRIVAL');
      if (branch.checkpointActionAvailable) reasonCodes.push('CHECKPOINT_BUILD_AVAILABLE');
      if (branch.turnsUntilArrival <= 1) reasonCodes.push('ROAD_ARRIVAL_IMMINENT');
    }
    score += roadUrgency * 15;
    reasonCodes.push('BUILD_CHECKPOINT');
  } else if (action.type === 'RelocateCheckpoint') {
    const checkpoint = observation.checkpoints.find((candidate) => candidate.id === action.checkpointId);
    const branch = branchFor(observation, action.branchId ?? checkpoint?.branchId);
    const capital = observation.facilities.find((facility) => facility.type === 'capital');
    const sourceDistance = checkpoint && capital ? hexDistance(capital.position, checkpoint.position) : 0;
    const destinationDistance = capital ? hexDistance(capital.position, action.position) : sourceDistance;
    const movingOutward = destinationDistance > sourceDistance;
    const movingInward = destinationDistance < sourceDistance;
    score += weights.checkpoint;
    if (branch?.turnsUntilArrival !== undefined && branch.turnsUntilArrival <= 2) {
      score += 50;
      reasonCodes.push('ROAD_ARRIVAL_IMMINENT');
    }
    if (movingOutward) {
      score += branch?.activeCheckpointStatus === 'operational' ? 35 : 0;
      reasonCodes.push('CHECKPOINT_ADVANCE_OUTWARD');
    }
    if (movingInward && (urgentThreats.length > 0 || observation.population.infected > 0)) {
      score += 120;
      reasonCodes.push('CHECKPOINT_RETREAT_FOR_DEFENSE');
    } else if (movingInward) {
      score -= 35;
      reasonCodes.push('CHECKPOINT_RETREAT');
    }
    reasonCodes.push('RELOCATE_CHECKPOINT');
  } else if (action.type === 'SetCheckpointPolicy') {
    const checkpoint = observation.checkpoints.find((candidate) => candidate.id === action.checkpointId);
    const branch = branchFor(observation, checkpoint?.branchId);
    if (action.policy === 'strict' && observation.population.healthyCivilians > 30) score += 55;
    if (action.policy === 'passThrough' && observation.population.healthyCivilians < 25) score += 50;
    if (action.policy === 'normal') score += 25;
    if (observation.population.infected > 0) {
      if (action.policy === 'strict') score += 110;
      if (action.policy === 'passThrough') score -= 110;
      reasonCodes.push('POLICY_REDUCE_INFECTION_RISK');
    } else if (observation.population.healthyCivilians < 25) {
      if (action.policy === 'passThrough') score += 75;
      if (action.policy === 'strict') score -= 45;
      reasonCodes.push('POLICY_GROW_POPULATION');
    }
    if (checkpoint && checkpoint.currentPolicy === action.policy) score -= 100;
    if (branch?.activeCheckpointId === null) score -= 100;
    if (branch?.turnsUntilArrival !== undefined && branch.turnsUntilArrival <= 1) reasonCodes.push('ROAD_POLICY_BEFORE_ARRIVAL');
    reasonCodes.push(`SET_POLICY_${action.policy.toUpperCase()}`);
  } else if (action.type === 'EndTurn') {
    const readyUnits = observation.units.filter((unit) => unit.actionState !== 'acted').length;
    if (readyUnits === 0) score += 80;
    if (shortage(observation) === 0 && observation.population.infected === 0) score += 25;
    if (goal === 'avoid_defeat') score -= 500;
    if (urgentThreats.length > 0 && readyUnits > 0 && canRespondToThreat) score -= 1_000;
    if (observation.population.infected > 0 && readyUnits > 0 && canRespondToInfection) score -= 500;
    reasonCodes.push('END_TURN_WHEN_SETTLED');
  }

  if (goal !== 'end_turn' && action.type !== 'EndTurn' && reasonCodes.length > 0) score += weights.goal[goal] * 0.05;
  return { action: cloneAction(action), score: Math.round(score * 100) / 100, reasonCodes };
}

export class BalancedAgent implements GameAgent {
  public readonly id = 'balanced';
  public readonly version = BALANCED_AGENT_VERSION;
  private currentTurn = -1;
  private decisionsThisTurn = 0;
  private readonly selectedCounts = new Map<string, number>();
  private readonly selectedFamilies = new Set<string>();

  public constructor(private readonly weights: Readonly<BalancedStrategyWeights> = BALANCED_WEIGHTS) {}

  public decide(observation: AgentObservation, legalActions: readonly GameAction[]): AgentDecision {
    if (legalActions.length === 0) throw new Error('Balanced Agent received no legal actions');
    if (observation.turn !== this.currentTurn) {
      this.currentTurn = observation.turn;
      this.decisionsThisTurn = 0;
      this.selectedCounts.clear();
      this.selectedFamilies.clear();
    }
    const threats = zombieThreats(observation);
    const goal = primaryGoal(observation, legalActions, threats);
    const urgentThreatIds = new Set(threats.filter((threat) => threat.contactNextTurn).map((threat) => threat.zombieId));
    const canRespondToThreat = legalActions.some((action) => {
      if (action.type === 'Attack') return urgentThreatIds.has(action.targetId);
      if (action.type !== 'Move') return false;
      const unit = observation.units.find((candidate) => candidate.id === action.unitId);
      return unit?.type === 'nationalGuard' || threats.some((threat) => threat.contactNextTurn && threat.threatensCapital);
    });
    const canRespondToInfection = legalActions.some((action) => {
      if (action.type === 'Wait') {
        return observation.units.find((unit) => unit.id === action.unitId)?.suppressionAvailableIfTurnEndsNow === true;
      }
      if (action.type !== 'Move') return false;
      return observation.units.find((unit) => unit.id === action.unitId)?.type === 'police';
    });
    let candidates = sortActions(legalActions).map((action) => scoreAction(
      action,
      observation,
      goal,
      this.weights,
      threats,
      canRespondToThreat,
      canRespondToInfection,
    ));
    candidates = candidates.map((candidate) => ({
      ...candidate,
      score: candidate.score
        - (this.selectedCounts.get(actionKey(candidate.action)) ?? 0) * this.weights.repeatPenalty
        - (this.selectedFamilies.has(repeatSensitiveActionFamily(candidate.action, observation) ?? '') ? 10_000 : 0),
    }));
    if (this.decisionsThisTurn >= BALANCED_THRESHOLDS.maxDecisionsPerTurn) {
      candidates = candidates.map((candidate) => candidate.action.type === 'EndTurn'
        ? { ...candidate, score: candidate.score + 10_000, reasonCodes: [...candidate.reasonCodes, 'TURN_DECISION_LIMIT'] }
        : candidate);
    }
    candidates.sort((left, right) => right.score - left.score || actionKey(left.action).localeCompare(actionKey(right.action)));
    const selected = candidates[0]!;
    this.decisionsThisTurn += 1;
    const selectedKey = actionKey(selected.action);
    this.selectedCounts.set(selectedKey, (this.selectedCounts.get(selectedKey) ?? 0) + 1);
    const selectedFamily = repeatSensitiveActionFamily(selected.action, observation);
    if (selectedFamily) this.selectedFamilies.add(selectedFamily);
    return {
      action: cloneAction(selected.action),
      trace: {
        priorityGoal: goal,
        selectedAction: cloneAction(selected.action),
        selectedScore: selected.score,
        topCandidates: candidates.slice(0, BALANCED_THRESHOLDS.candidateTraceLimit),
        reasonCodes: [...selected.reasonCodes],
      },
    };
  }
}

export function createBalancedAgent(): BalancedAgent {
  return new BalancedAgent();
}
