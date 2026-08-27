import { hexDistance } from '../core/hex';
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

function primaryGoal(observation: AgentObservation, legalActions: readonly GameAction[]): AgentPriorityGoal {
  const forecastCivilianLoss = observation.endTurnForecast.food.shortage + observation.endTurnForecast.civilianGoods.shortage;
  if (forecastCivilianLoss >= observation.population.healthyCivilians) return 'avoid_defeat';
  if (observation.horde.turnsRemaining <= BALANCED_THRESHOLDS.hordeUrgentTurns) return 'defend_horde';
  if (observation.population.infected > 0) return 'suppress_infection';
  if (shortage(observation) > 0 || !observation.resources.militarySupplyAvailable) return 'restore_economy';
  if (observation.endTurnForecast.overcrowding.additionalFood > 0) return 'reduce_overcrowding';
  if (legalActions.some((action) => action.type === 'Attack')) return 'combat';
  if (legalActions.some((action) => action.type === 'ProduceUnit')) return 'build_forces';
  if (legalActions.some((action) => action.type === 'Move') && observation.facilities.some((facility) => facility.owner === 'none')) return 'secure_facilities';
  if (legalActions.some((action) => action.type === 'BuildCheckpoint' || action.type === 'SetCheckpointPolicy')) return 'manage_checkpoint';
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

function scoreAction(
  action: GameAction,
  observation: AgentObservation,
  goal: AgentPriorityGoal,
  weights: Readonly<BalancedStrategyWeights>,
): AgentCandidateScore {
  let score = action.type === 'EndTurn' ? weights.endTurn : 0;
  const reasonCodes: string[] = [];
  const facilities = new Map(observation.facilities.map((facility) => [facility.id, facility]));
  const units = new Map(observation.units.map((unit) => [unit.id, unit]));
  const zombies = new Map(observation.zombies.map((unit) => [unit.id, unit]));
  const urgentHorde = observation.horde.turnsRemaining <= BALANCED_THRESHOLDS.hordeUrgentTurns;

  if (action.type === 'Attack') {
    const attacker = units.get(action.attackerId);
    const target = zombies.get(action.targetId);
    score += weights.attack;
    reasonCodes.push('ATTACK_THREAT');
    if (attacker && target && attacker.attack >= target.hp) {
      score += weights.lethalAttack;
      reasonCodes.push('LETHAL_ATTACK');
    }
    if (attacker && attacker.hp / attacker.maxHp < BALANCED_THRESHOLDS.lowHpRatio && target && target.hp >= attacker.hp) {
      score -= 120;
      reasonCodes.push('AVOID_LOW_HP_RISK');
    }
  } else if (action.type === 'SuppressInfection') {
    const facility = facilities.get(action.facilityId);
    const unit = units.get(action.unitId);
    score += weights.suppression + (facility?.infectedPopulation ?? 0) * 3;
    reasonCodes.push('SUPPRESS_INFECTION');
    if (unit?.type === 'police') {
      score += 45;
      reasonCodes.push('PREFER_POLICE_SUPPRESSION');
    } else if (facility && facility.healthyPopulation <= 5) {
      score -= 90;
      reasonCodes.push('GUARD_CIVILIAN_DAMAGE');
    }
  } else if (action.type === 'AssignWorkers') {
    const facility = facilities.get(action.facilityId);
    if (facility) {
      const delta = action.workers - facility.healthyPopulation;
      const need = facilityResourceValue(facility.type, observation);
      score += delta * weights.economyImprovement * need;
      if (delta > 0) reasonCodes.push(`STAFF_${facility.type.toUpperCase()}`);
      if (delta < 0 && observation.endTurnForecast.fuel.shortage > 0 && ['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)) {
        score += Math.abs(delta) * 25;
        reasonCodes.push('REDUCE_INPUT_DEMAND');
      }
      if (facility.type === 'powerPlant' && observation.endTurnForecast.electricity.shortage > 0 && delta > 0) {
        score += 180;
        reasonCodes.push('RESTORE_POWER');
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
      if (urgentHorde) {
        const entrances = hordeEntrancePositions(observation);
        const dangerReduction = nearestDistance(from.position, entrances) - nearestDistance(to.position, entrances);
        score += dangerReduction * weights.hordeDefense;
        if (dangerReduction > 0) reasonCodes.push('EVACUATE_HORDE_DIRECTION');
      }
      if (relief === 0 && !urgentHorde) score -= 80;
    }
  } else if (action.type === 'Move') {
    const unit = units.get(action.unitId);
    if (unit) {
      const infected = observation.facilities.filter((facility) => facility.infectedPopulation > 0).map((facility) => facility.position);
      const unowned = observation.facilities.filter((facility) => facility.owner === 'none');
      const zombiePositions = observation.zombies.map((zombie) => zombie.position);
      const beforeZombie = nearestDistance(unit.position, zombiePositions);
      const afterZombie = nearestDistance(action.destination, zombiePositions);
      if (zombiePositions.length > 0 && unit.hp / unit.maxHp >= BALANCED_THRESHOLDS.lowHpRatio) {
        score += (beforeZombie - afterZombie) * 25;
        if (afterZombie < beforeZombie) reasonCodes.push('APPROACH_THREAT');
      }
      if (infected.length > 0) {
        const progress = nearestDistance(unit.position, infected) - nearestDistance(action.destination, infected);
        score += progress * weights.suppression;
        if (progress > 0) reasonCodes.push('APPROACH_INFECTION');
      } else if (unowned.length > 0 && !urgentHorde && shortage(observation) === 0) {
        const before = Math.min(...unowned.map((facility) => hexDistance(unit.position, facility.position) - facilityResourceValue(facility.type, observation)));
        const after = Math.min(...unowned.map((facility) => hexDistance(action.destination, facility.position) - facilityResourceValue(facility.type, observation)));
        score += (before - after) * weights.captureProgress;
        if (after < before) reasonCodes.push('APPROACH_VALUABLE_FACILITY');
      }
      if (urgentHorde) {
        const entrances = hordeEntrancePositions(observation);
        const progress = nearestDistance(unit.position, entrances) - nearestDistance(action.destination, entrances);
        score += progress * weights.hordeDefense;
        if (progress > 0) reasonCodes.push('MOVE_TO_HORDE_FRONT');
      }
      if (unit.hp / unit.maxHp < BALANCED_THRESHOLDS.lowHpRatio && afterZombie <= 2) {
        score -= 180;
        reasonCodes.push('AVOID_LOW_HP_RISK');
      }
    }
  } else if (action.type === 'Wait') {
    const unit = units.get(action.unitId);
    if (unit && unit.hp < unit.maxHp) {
      score += weights.recoveryWait * (1 - unit.hp / unit.maxHp);
      reasonCodes.push('RECOVER_DAMAGED_UNIT');
    }
    if (urgentHorde && unit?.actionState === 'ready') score -= 25;
  } else if (action.type === 'ProduceUnit') {
    const unitCount = observation.units.length;
    score += weights.production + (urgentHorde ? weights.hordeDefense * 2 : 0) + Math.max(0, 3 - unitCount) * 20;
    reasonCodes.push(urgentHorde ? 'PRODUCE_HORDE_DEFENDER' : 'BUILD_RESERVE');
    if (action.unitType === 'police' && observation.population.infected > 0) {
      score += 60;
      reasonCodes.push('PRODUCE_SUPPRESSION_UNIT');
    }
    if (observation.population.healthyCivilians <= BALANCED_THRESHOLDS.criticalCivilianBuffer + (action.unitType === 'police' ? 5 : 10)) {
      score -= 250;
      reasonCodes.push('PRESERVE_CIVILIANS');
    }
  } else if (action.type === 'BuildCheckpoint') {
    score += weights.checkpoint + (urgentHorde ? 30 : 0);
    reasonCodes.push('BUILD_CHECKPOINT');
  } else if (action.type === 'SetCheckpointPolicy') {
    const checkpoint = observation.checkpoints.find((candidate) => candidate.id === action.checkpointId);
    if (action.policy === 'strict' && observation.population.healthyCivilians > 30) score += 55;
    if (action.policy === 'passThrough' && observation.population.healthyCivilians < 25) score += 50;
    if (action.policy === 'normal') score += 25;
    if (checkpoint && checkpoint.currentPolicy === action.policy) score -= 100;
    reasonCodes.push(`SET_POLICY_${action.policy.toUpperCase()}`);
  } else if (action.type === 'EndTurn') {
    const readyUnits = observation.units.filter((unit) => unit.actionState !== 'acted').length;
    if (readyUnits === 0) score += 80;
    if (shortage(observation) === 0 && observation.population.infected === 0) score += 25;
    if (goal === 'avoid_defeat') score -= 500;
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

  public constructor(private readonly weights: Readonly<BalancedStrategyWeights> = BALANCED_WEIGHTS) {}

  public decide(observation: AgentObservation, legalActions: readonly GameAction[]): AgentDecision {
    if (legalActions.length === 0) throw new Error('Balanced Agent received no legal actions');
    if (observation.turn !== this.currentTurn) {
      this.currentTurn = observation.turn;
      this.decisionsThisTurn = 0;
      this.selectedCounts.clear();
    }
    const goal = primaryGoal(observation, legalActions);
    let candidates = sortActions(legalActions).map((action) => scoreAction(action, observation, goal, this.weights));
    candidates = candidates.map((candidate) => ({
      ...candidate,
      score: candidate.score - (this.selectedCounts.get(actionKey(candidate.action)) ?? 0) * this.weights.repeatPenalty,
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

