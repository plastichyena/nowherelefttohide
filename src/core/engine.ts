import { stableFacilities, eligibleSnapshotCities, availableSupplyPopulation, calculateEconomyPlan, forecastEndTurn, forecastUnitRefills, forecastFacilityProduction } from './economy-query';
export { forecastEndTurn, forecastUnitRefills, forecastFacilityProduction, forecastProductionCapacity } from './economy-query';
import { getUnitLegalAttackProjections, forecastUnitSuppression, infectedSuppressionTarget } from './combat-query';
export { getUnitLegalAttackProjections, forecastUnitSuppression } from './combat-query';
export type { UnitLegalAttackProjection, SuppressionProjection } from './combat-query';
import { createMovement } from './movement';
import { unitMoveFuelCost, getMovePath, reachableDestinations, getUnitLegalMoveFuelProjections, previewMove, interceptorsAt } from './movement-query';
export { getUnitLegalMoveFuelProjections, previewMove } from './movement-query';
export type { MovePreview } from './movement-query';
export { unitMoveFuelCost } from './movement-query';
import { createUnitLifecycle, type SpawnOccupancyEntry } from './unit-lifecycle';
import { emit } from './events-internal';
import type { FacilityProductionProjection } from './economy-types';
export type { FacilityProductionProjection } from './economy-types';
import { isNormalAiZombie, WAVE_NON_HORDE_TYPES } from './unit-catalog';
import { effectiveRange, forecastUnitCombatAtDistance } from './combat-query';
export { effectiveRange, forecastUnitCombatAtDistance } from './combat-query';
export type { UnitCombatProjection } from './combat-query';
import { registerCommittedState, queryValue, copyQueryValue, withReadOnlyQueryScope } from './query-cache';
import { createPublicEntityProjectionContext, createPublicUnitProjection, createPublicFacilityProjection, createPublicCheckpointProjection } from './public-entities';
import { createQueryContext } from './query-context';
import { deriveStrategicForecast } from './forecast';
import { deriveCrisisSummary, deriveEndTurnRisk } from './crisis';
import { deriveSupplySnapshot } from './supply';
import { createDefaultConfig, HUMAN_UNIT_TYPES } from './config';
import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { assertInvariants, validateInvariants } from './invariants';
import {
  canPlayerOccupyHex,
  getHordeEntrance,
  getTile,
  initialZombiePositionsMatchSeed,
  initialHunterPositionsMatchSeed,
  isHordeSpawnReserve,
} from './map';
import { findNearestOpenTiles, findReachablePaths, findShortestPath, pathMovementCost } from './path';
import { SeededRng } from './rng';
import { deriveUnitRecovery } from './recovery';
import { createMovementCostResolver, effectiveMovementCost, terrainAdjustedDamage } from './terrain';
import {
  canUnitSee,
  getCheckpointRouteVisibility,
  getPlayerVisionCoverage,
  getPlayerVisibleTileKeys,
  getVisibleEnemyUnits,
  isVisibleToPlayer,
} from './visibility';
import {
  getBlockingZombiesForCheckpoint,
  activeCheckpointForBranch,
  deriveCheckpointRole,
  getBranchIdAt,
  getBranchSupplyRadius,
  getCapitalPosition,
  getRoadBranch,
  getRoadBranchState,
  getSectorBranchIds,
  getSuppliedTileKeys,
  isHexSupplied,
} from './supply';
import {
  civilianWorkerCount,
  cloneState,
  createCityPopulationSnapshot,
  createInitialState,
  createUnit,
  effectiveAttackForProficiency,
  getCheckpointAt,
  getFacilityState,
  getFacilityAt,
  getUnit,
  getUnitAt,
  facilityZombieTargetValue,
  isHumanUnit,
  isCityFacility,
  isProductionFacility,
  nextHumanUnitId,
  positionKey,
  populationLedgerTotal,
  resourceConsumerPopulation,
  synchronizePopulation,
} from './state';
import type {
  ActionError,
  AttackAction,
  CardinalDirection,
  CheckpointPolicy,
  CheckpointPositionCandidate,
  CheckpointState,
  ConstructibleFacilityPositionCandidate,
  ConstructibleFacilityType,
  EndTurnForecast,
  FacilityState,
  GameAction,
  GameConfig,
  GameEvent,
  GameEventType,
  GameOverReason,
  GameResult,
  GameState,
  HeadlessGame,
  HexCoord,
  RoadBranchId,
  HumanUnitType,
  JsonObject,
  MilitaryGoodsForecast,
  MoveAction,
  PowerSupplyReason,
  ResourceType,
  StepResult,
  UnitProductionOrder,
  UnitState,
  ZombieUnitType,
} from './types';

const { dealDamage } = createUnitLifecycle({ applyGeneratedZombieOccupancy, processSpawnOccupancyQueue });
const { applyMovement } = createMovement({ interceptorsAt, resolveCombat, tryCapture });

const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'civilianGoods', 'militaryGoods', 'fuel'];
const CANONICAL_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

function isZombieFaction(unit: Pick<UnitState, 'isPlayerUnit'>): boolean {
  return !unit.isPlayerUnit;
}



function error(action: GameAction | null, code: string, message: string): ActionError {
  return { action, code, message };
}

function cloneResult(result: GameResult | null): GameResult | null {
  return result ? (JSON.parse(JSON.stringify(result)) as GameResult) : null;
}

function cloneEvents(events: GameEvent[]): GameEvent[] {
  return JSON.parse(JSON.stringify(events)) as GameEvent[];
}


function saveRng(state: GameState, rng: SeededRng): void {
  state.rngState = rng.snapshot();
}

function isPlayerPhase(state: GameState): boolean {
  return state.phase === 'player' && !state.gameOver;
}

function occupiedKeys(state: GameState, exceptUnitId?: string): Set<string> {
  return new Set(
    state.units.filter((unit) => unit.id !== exceptUnitId).map((unit) => positionKey(unit.position)),
  );
}

/** Exact public attack previews for the Unit's currently legal visible targets. */
function isAttackable(attacker: UnitState, target: UnitState): boolean {
  return attacker.isPlayerUnit !== target.isPlayerUnit;
}

function markAttacked(state: GameState, unit: UnitState, interception = false): void {
  unit.attackChargesRemaining = Math.max(0, unit.attackChargesRemaining - 1);
  unit.canAttack = unit.attackChargesRemaining > 0;
  if (isHumanUnit(unit)) {
    if (interception) {
      unit.activity.intercepted = true;
    } else {
      unit.activity.attacked = true;
    }
    emit(state, 'attack_charge_consumed', {
      unitId: unit.id,
      unitType: unit.type,
      remaining: unit.attackChargesRemaining,
      reason: interception ? 'interception' : 'combat',
    });
  }
}

function resolveCombat(
  state: GameState,
  attacker: UnitState,
  defender: UnitState,
  kind: 'attack' | 'interception',
  rng: SeededRng = SeededRng.fromState(state.rngState),
): void {
  if (!state.units.some((unit) => unit.id === attacker.id) || !state.units.some((unit) => unit.id === defender.id)) {
    return;
  }
  const attackDistance = hexDistance(attacker.position, defender.position);
  const attackProjection = forecastUnitCombatAtDistance(state, attacker, attackDistance);
  if (!attackProjection.canAttack) return;
  const human = attacker.isPlayerUnit ? attacker : defender.isPlayerUnit ? defender : null;
  const noise = human ? emitCombatNoise(state, human, { ...human.position }) : null;
  markAttacked(state, attacker, kind === 'interception');
  if (attacker.isPlayerUnit) attacker.currentMilitaryGoods = attackProjection.projectedMilitaryGoodsAfterAttack;
  emit(state, kind === 'interception' ? 'interception' : 'attack', {
    attackerId: attacker.id,
    defenderId: defender.id,
    distance: attackDistance,
    effectiveAttack: attackProjection.effectiveAttack,
    militaryGoodsCost: attackProjection.militaryGoodsCost,
    militaryGoodsRemaining: attacker.isPlayerUnit ? attacker.currentMilitaryGoods : 0,
  });
  if (kind === 'interception') {
    state.statistics.hordeInterceptions += attacker.isPlayerUnit ? 1 : 0;
  }
  dealDamage(state, defender, attackProjection.effectiveAttack, attacker.id, kind, rng);
  if (!state.units.some((unit) => unit.id === defender.id)) {
    if (noise) resolveFallenSiteNoiseRespawns(state, noise.sourceUnitType, noise.center, noise.radius, rng);
    return;
  }
  const counterDistance = hexDistance(defender.position, attacker.position);
  const counterProjection = forecastUnitCombatAtDistance(state, defender, counterDistance);
  if (defender.canAttack && counterProjection.canAttack) {
    markAttacked(state, defender);
    if (defender.isPlayerUnit) defender.currentMilitaryGoods = counterProjection.projectedMilitaryGoodsAfterAttack;
    emit(state, 'attack', {
      attackerId: defender.id,
      defenderId: attacker.id,
      counterattack: true,
      distance: counterDistance,
      effectiveAttack: counterProjection.effectiveAttack,
      militaryGoodsCost: counterProjection.militaryGoodsCost,
      militaryGoodsRemaining: defender.isPlayerUnit ? defender.currentMilitaryGoods : 0,
    });
    dealDamage(state, attacker, counterProjection.effectiveAttack, defender.id, 'counterattack', rng);
  }
  if (noise) resolveFallenSiteNoiseRespawns(state, noise.sourceUnitType, noise.center, noise.radius, rng);
}

function tryCapture(state: GameState, unit: UnitState): void {
  if (!unit.isPlayerUnit) {
    return;
  }
  const facility = getFacilityAt(state, unit.position);
  if (
    facility &&
    facility.operationalStatus === 'disabled' &&
    !state.units.some((candidate) => !candidate.isPlayerUnit && hexKey(candidate.position) === hexKey(facility.position))
  ) {
    facility.operationalStatus = 'recovering';
    facility.recoveryOperationalTurn = state.turn + 1;
    facility.populationOperationalTurn = state.turn + 1;
    emit(state, 'facility_recovered', { facilityId: facility.id, unitId: unit.id, recovering: true });
    return;
  }
  if (!facility || facility.status !== 'unowned') {
    return;
  }
  facility.owner = 'player';
  facility.status = 'owned';
  facility.operationalStatus = facility.infected > 0 ? 'infected' : facility.workers > 0 ? 'operational' : 'stopped';
  const previousOrder = state.facilities.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.securedOrder ?? -1),
    -1,
  );
  facility.securedOrder = previousOrder + 1;
  facility.lastAssignedOrder = state.nextAssignmentOrder++;
  facility.populationOperationalTurn = state.turn + 1;
  emit(state, 'facility_captured', { facilityId: facility.id, unitId: unit.id });
}

function totalCheckpointPeople(checkpoint: CheckpointState): number {
  return checkpoint.waiting + checkpoint.screening + checkpoint.approved;
}

function removeCheckpointPeople(
  checkpoint: CheckpointState,
  amount: number,
  order: Array<'waiting' | 'screening' | 'approved'> = ['waiting', 'screening', 'approved'],
): number {
  let remaining = Math.max(0, Math.floor(amount));
  let removed = 0;
  for (const pool of order) {
    const fromPool = Math.min(remaining, checkpoint[pool]);
    checkpoint[pool] -= fromPool;
    remaining -= fromPool;
    removed += fromPool;
    if (remaining === 0) break;
  }
  return removed;
}

function withdrawFromSupplyCities(state: GameState, amount: number): Array<{ facilityId: string; people: number }> | null {
  let remaining = amount;
  const changes: Array<{ facilityId: string; people: number }> = [];
  for (const city of eligibleSnapshotCities(state, 'supply')) {
    const people = Math.min(remaining, city.workers);
    if (people > 0) changes.push({ facilityId: city.id, people });
    remaining -= people;
    if (remaining === 0) break;
  }
  if (remaining > 0) return null;
  for (const change of changes) {
    getFacilityState(state, change.facilityId)!.workers -= change.people;
  }
  return changes;
}

function distributeToReceptionCities(state: GameState, amount: number): Array<{ facilityId: string; people: number }> | null {
  const cities = eligibleSnapshotCities(state, 'reception');
  if (amount > 0 && cities.length === 0) return null;
  let remaining = amount;
  const assigned = new Map<string, number>();
  for (const city of cities) {
    const softCap = state.config.facilities[city.type].workerCapacity;
    const people = Math.min(remaining, Math.max(0, softCap - city.workers));
    city.workers += people;
    assigned.set(city.id, (assigned.get(city.id) ?? 0) + people);
    remaining -= people;
    if (remaining === 0) break;
  }
  let index = 0;
  while (remaining > 0) {
    const city = cities[index % cities.length]!;
    city.workers += 1;
    assigned.set(city.id, (assigned.get(city.id) ?? 0) + 1);
    remaining -= 1;
    index += 1;
  }
  return [...assigned.entries()]
    .filter(([, people]) => people > 0)
    .map(([facilityId, people]) => ({ facilityId, people }));
}

function healthyLatentInfectionTargets(state: GameState): FacilityState[] {
  return state.facilities
    .filter(
      (facility) =>
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.workers > 0,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function establishLatentInfectionInState(
  state: GameState,
  rng: SeededRng,
  checkpointId: string,
  latentInfected: number,
): void {
  if (latentInfected <= 0) return;
  const candidates = healthyLatentInfectionTargets(state);
  if (candidates.length === 0) return;
  const target = rng.pick(candidates);
  const converted = Math.min(target.workers, latentInfected);
  const wasInfected = target.infected > 0;
  target.workers -= converted;
  target.infected += converted;
  target.operationalStatus = 'infected';
  if (converted > 0 && !wasInfected) {
    markSiteInfectionStarted(state, 'facility', target.id, target.type, target.position, converted, 'latent_infection');
  }
  emit(state, 'latent_infection', { checkpointId, facilityId: target.id, infected: converted });
}

function placeApprovedRefugees(state: GameState): void {
  for (const checkpoint of [...state.checkpoints].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!['operational', 'remnant'].includes(checkpoint.status) || checkpoint.approved <= 0) continue;
    const people = checkpoint.approved;
    const placements = distributeToReceptionCities(state, people);
    if (!placements) continue;
    checkpoint.approved = 0;
    for (const placement of placements) {
      emit(state, 'population_transferred', {
        from: checkpoint.id,
        to: placement.facilityId,
        people: placement.people,
        reason: 'approved_refugees',
      });
    }
  }
}

function resolveScreeningBatch(state: GameState, checkpoint: CheckpointState, rng: SeededRng): void {
  const screened = checkpoint.screening;
  if (screened <= 0) {
    return;
  }
  const policy = state.config.refugees.policies[checkpoint.screeningPolicy];
  checkpoint.screening = 0;
  checkpoint.remainingTurns = 0;
  const acceptedWorkers = Math.floor(screened * policy.workerRate);
  const rejected = screened - acceptedWorkers;
  state.population.cumulativeDepartures += rejected;
  state.statistics.refugeesDeparted += rejected;
  state.statistics.refugeesScreenedByPolicy[checkpoint.screeningPolicy] += screened;
  state.statistics.refugeesAccepted += acceptedWorkers;
  if (checkpoint.screeningPolicy === 'normal' || checkpoint.screeningPolicy === 'strict') {
    state.statistics.refugeesRejectedByDirectionAndPolicy[checkpoint.direction][checkpoint.screeningPolicy] += rejected;
    const contributesToFutureHorde = state.horde.finalHordeStatus === 'notStarted';
    if (contributesToFutureHorde) {
      state.rejectedRefugeesByDirection[checkpoint.direction][
        checkpoint.screeningPolicy === 'normal' ? 'normalRejected' : 'strictRejected'
      ] += rejected;
    }
    if (rejected > 0) {
      emit(state, 'checkpoint_refugees_rejected', {
        checkpointId: checkpoint.id,
        direction: checkpoint.direction,
        policy: checkpoint.screeningPolicy,
        count: rejected,
        contributesToFutureHorde,
      });
    }
  }
  let latentInfected = 0;
  if (acceptedWorkers > 0 && policy.infectionRate > 0 && rng.chance(policy.infectionRate)) {
    latentInfected = Math.ceil(acceptedWorkers * policy.infectionPopulationRate);
  }
  emit(state, 'refugees_screened', {
    checkpointId: checkpoint.id,
    screened,
    acceptedWorkers,
    policy: checkpoint.screeningPolicy,
  });
  const placements = distributeToReceptionCities(state, acceptedWorkers);
  if (placements) {
    for (const placement of placements) {
      emit(state, 'population_transferred', {
        from: checkpoint.id,
        to: placement.facilityId,
        people: placement.people,
        reason: 'screening_approved',
      });
    }
    establishLatentInfectionInState(state, rng, checkpoint.id, latentInfected);
  } else {
    checkpoint.approved += acceptedWorkers;
    const converted = removeCheckpointPeople(
      checkpoint,
      latentInfected,
      ['approved', 'screening', 'waiting'],
    );
    const wasInfected = checkpoint.infected > 0;
    checkpoint.infected += converted;
    if (converted > 0) {
      if (!wasInfected) markSiteInfectionStarted(state, 'checkpoint', checkpoint.id, deriveCheckpointRole(state, checkpoint), checkpoint.position, converted, 'latent_infection');
      emit(state, 'latent_infection', { checkpointId: checkpoint.id, infected: converted, pool: 'checkpoint' });
    }
    if (totalCheckpointPeople(checkpoint) === 0 && checkpoint.infected > 0) {
      overrunCheckpoint(state, checkpoint, rng);
    }
  }
}

function checkpointHasZombie(state: Readonly<GameState>, checkpoint: Readonly<CheckpointState>): boolean {
  return state.units.some(
    (unit) =>
      isZombieFaction(unit) &&
      hexKey(unit.position) === hexKey(checkpoint.position),
  );
}

function preparedCheckpointCount(state: Readonly<GameState>, branchId: string): number {
  const branch = getRoadBranchState(state, branchId);
  return branch ? (branch.activeCheckpointId === null ? 0 : 1) + branch.standbyCheckpointIds.length : 0;
}

function assignOperationalReserveRole(state: GameState, checkpoint: CheckpointState): 'standby' | 'dormant' {
  const branchId = checkpoint.branchId ?? checkpoint.direction;
  const branch = getRoadBranchState(state, branchId);
  if (!branch) return 'dormant';
  branch.standbyCheckpointIds = branch.standbyCheckpointIds.filter((id) => id !== checkpoint.id);
  if (preparedCheckpointCount(state, branchId) < state.config.checkpoint.maxPreparedPostsPerDirection) {
    branch.standbyCheckpointIds.push(checkpoint.id);
    return 'standby';
  }
  return 'dormant';
}

function resolveCheckpointRemnants(state: GameState): void {
  for (const checkpoint of state.checkpoints) {
    if (
      checkpoint.status !== 'remnant' ||
      totalCheckpointPeople(checkpoint) !== 0 ||
      checkpoint.infected !== 0 ||
      checkpointHasZombie(state, checkpoint)
    ) continue;
    checkpoint.status = 'operational';
    checkpoint.overrunProcessed = false;
    const role = assignOperationalReserveRole(state, checkpoint);
    if (role === 'standby') state.statistics.standbyCheckpointsCreated += 1;
    else state.statistics.dormantCheckpointsCreated += 1;
    emit(state, 'checkpoint_role_changed', {
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
      fromRole: 'remnant',
      toRole: role,
      reason: 'remnant_resolved',
    });
  }
}

function processUnmanagedArrival(
  state: GameState,
  branchId: string,
  people: number,
  rng: SeededRng,
): void {
  const policy = state.config.refugees.policies.passThrough;
  const accepted = Math.floor(people * policy.workerRate);
  state.statistics.unmanagedPassThrough += people;
  state.statistics.refugeesScreenedByPolicy.passThrough += people;
  const placements = distributeToReceptionCities(state, accepted);
  emit(state, 'refugees_screened', {
    branchId,
    screened: people,
    acceptedWorkers: placements ? accepted : 0,
    policy: 'passThrough',
    unmanaged: true,
  });
  if (!placements) {
    state.population.cumulativeDepartures += people;
    state.statistics.refugeesDeparted += people;
    return;
  }
  state.statistics.refugeesAccepted += accepted;
  for (const placement of placements) {
    emit(state, 'population_transferred', {
      from: `road-${branchId}`,
      to: placement.facilityId,
      people: placement.people,
      reason: 'unmanaged_pass_through',
    });
  }
  if (accepted > 0 && policy.infectionRate > 0 && rng.chance(policy.infectionRate)) {
    establishLatentInfectionInState(
      state,
      rng,
      `road-${branchId}`,
      Math.ceil(accepted * policy.infectionPopulationRate),
    );
  }
}

function processRefugees(state: GameState, rng: SeededRng): void {
  for (const branch of [...state.roadBranches].sort((a, b) => a.branchId.localeCompare(b.branchId))) {
    const checkpoint = activeCheckpointForBranch(state, branch.branchId);
    const arrivalsEnded = state.horde.finalHordeStatus !== 'notStarted';
    if (!checkpoint && !arrivalsEnded) state.statistics.unmanagedBranchTurns += 1;
    if (arrivalsEnded) {
      if (branch.nextArrivalTurn !== null && branch.nextArrivalTurn <= state.turn) {
        state.statistics.preventedRefugeeArrivalsAfterFinal += 1;
      }
      branch.nextArrivalTurn = null;
      continue;
    }
    if (branch.nextArrivalTurn === state.turn) {
      const people = rng.nextInt(state.config.refugees.arrivalPeopleMin, state.config.refugees.arrivalPeopleMax);
      state.population.cumulativeArrivals += people;
      state.statistics.refugeeArrivalsByBranch[branch.branchId] =
        (state.statistics.refugeeArrivalsByBranch[branch.branchId] ?? 0) + people;
      branch.nextArrivalTurn = state.turn + rng.nextInt(
        state.config.refugees.arrivalIntervalMin,
        state.config.refugees.arrivalIntervalMax,
      );
      if (checkpoint) checkpoint.waiting += people;
      emit(state, 'refugees_arrived', {
        branchId: branch.branchId,
        checkpointId: checkpoint?.id ?? null,
        people,
        unmanaged: !checkpoint,
      });
      if (!checkpoint) processUnmanagedArrival(state, branch.branchId, people, rng);
    }
  }
  for (const checkpoint of [...state.checkpoints].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!['operational', 'remnant'].includes(checkpoint.status)) continue;
    if (checkpoint.screening > 0 && checkpoint.remainingTurns > 0) {
      checkpoint.remainingTurns -= 1;
      if (checkpoint.remainingTurns === 0) {
        resolveScreeningBatch(state, checkpoint, rng);
      }
    }
    const role = deriveCheckpointRole(state, checkpoint);
    if (checkpoint.screening === 0 && checkpoint.waiting > 0 && (role === 'active' || role === 'remnant')) {
      const branch = getRoadBranchState(state, checkpoint.branchId ?? checkpoint.direction);
      const policy = branch?.currentPolicy ?? 'normal';
      const batch = Math.min(checkpoint.waiting, state.config.refugees.screeningCapacity);
      checkpoint.waiting -= batch;
      checkpoint.screening = batch;
      checkpoint.screeningPolicy = policy;
      checkpoint.remainingTurns = state.config.refugees.policies[policy].turns;
      if (checkpoint.remainingTurns === 0) {
        resolveScreeningBatch(state, checkpoint, rng);
      }
    }
  }
  resolveCheckpointRemnants(state);
}

function removeWorkersForShortage(state: GameState, amount: number, resource: 'food' | 'civilianGoods'): number {
  let remaining = Math.max(0, Math.floor(amount));
  let removed = 0;
  const directionOrder = new Map(CANONICAL_DIRECTIONS.map((direction, index) => [direction, index]));
  const checkpoints = [...state.checkpoints].sort(
    (left, right) =>
      (directionOrder.get(left.direction) ?? Number.MAX_SAFE_INTEGER) -
        (directionOrder.get(right.direction) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
  for (const checkpoint of checkpoints) {
    const loss = Math.min(remaining, totalCheckpointPeople(checkpoint));
    if (loss <= 0) continue;
    const actual = removeCheckpointPeople(checkpoint, loss, ['waiting', 'screening', 'approved']);
    remaining -= actual;
    removed += actual;
    emit(state, 'resource_shortage', {
      resource,
      checkpointId: checkpoint.id,
      populationLost: actual,
      rejectedCounterChanged: false,
    });
    if (remaining === 0) break;
  }
  const cities = state.cityPopulationSnapshot.supply
    .map((entry) => getFacilityState(state, entry.facilityId))
    .filter(
      (facility): facility is FacilityState =>
        facility !== undefined && facility.owner === 'player' && isCityFacility(facility) && facility.workers > 0,
    );
  for (const facility of cities) {
    const loss = Math.min(remaining, facility.workers);
    facility.workers -= loss;
    remaining -= loss;
    removed += loss;
    if (loss > 0) emit(state, 'resource_shortage', { resource, facilityId: facility.id, populationLost: loss });
    if (remaining === 0) break;
  }
  const facilities = [...state.facilities]
    .filter(
      (facility) =>
        facility.owner === 'player' && isProductionFacility(facility) && facility.workers > 0,
    )
    .sort(
      (left, right) =>
        (right.securedOrder ?? -1) - (left.securedOrder ?? -1) || left.id.localeCompare(right.id),
    );
  for (const facility of facilities) {
    const loss = Math.min(remaining, facility.workers);
    facility.workers -= loss;
    remaining -= loss;
    removed += loss;
    if (loss > 0) emit(state, 'resource_shortage', { resource, facilityId: facility.id, populationLost: loss });
    if (remaining === 0) {
      break;
    }
  }
  state.statistics.civilianLosses += removed;
  state.statistics.resourceShortageLosses += removed;
  state.population.cumulativeDeaths += removed;
  return removed;
}

function processEconomy(state: GameState): FacilityProductionProjection[] {
  synchronizePopulation(state);
  const plan = calculateEconomyPlan(state);
  const forecast = plan.forecast;
  const queuePopulation = state.checkpoints.reduce(
    (total, checkpoint) => total + checkpoint.waiting + checkpoint.screening + checkpoint.approved,
    0,
  );
  state.statistics.checkpointQueueFoodDemand +=
    queuePopulation * state.config.economy.populationConsumption.food;
  state.statistics.checkpointQueueCivilianGoodsDemand +=
    queuePopulation * state.config.economy.populationConsumption.civilianGoods;
  const queueFoodDemand = queuePopulation * state.config.economy.populationConsumption.food;
  const queueCivilianGoodsDemand = queuePopulation * state.config.economy.populationConsumption.civilianGoods;
  state.statistics.checkpointQueueFoodConsumed += Math.max(0, queueFoodDemand - forecast.food.shortage);
  state.statistics.checkpointQueueCivilianGoodsConsumed += Math.max(
    0,
    queueCivilianGoodsDemand - forecast.civilianGoods.maintenanceShortage,
  );
  state.resources.food = forecast.food.endingStock;
  state.resources.civilianGoods = forecast.civilianGoods.endingStock;
  state.resources.militaryGoods = forecast.militaryGoods.projectedEndingStock;
  state.resources.fuel = forecast.fuel.endingStock;
  state.resources.electricityCapacity = forecast.electricity.physicalGenerationCapacity;
  state.resources.electricityRequired = forecast.electricity.required;

  for (const unitForecast of forecast.militaryGoods.units) {
    const unit = getUnit(state, unitForecast.unitId);
    if (!unit) continue;
    unit.currentMilitaryGoods = unitForecast.afterFixed;
    if (unitForecast.fixedConsumption > 0) {
      emit(state, 'resource_consumed', {
        resource: 'militaryGoods',
        amount: unitForecast.fixedConsumption,
        reason: 'unit_fixed_upkeep',
        unitId: unit.id,
        unitType: unit.type,
      });
    }
  }

  for (const projection of plan.facilities) {
    const facility = getFacilityState(state, projection.facilityId)!;
    if (projection.powerMode === 'required') {
      facility.lastPowerSupplied = projection.projectedPowerSupplied;
    }
    if (!['building', 'disabled', 'recovering'].includes(facility.operationalStatus)) {
      facility.operationalStatus = facility.status === 'ruined'
        ? 'ruined'
        : facility.infected > 0
          ? 'infected'
          : facility.type === 'windPowerPlant' || facility.workers > 0
            ? 'operational'
            : 'stopped';
    }
    if (projection.powerMode !== 'none') {
      emit(state, 'power_allocated', {
        facilityId: facility.id,
        supplied: projection.projectedPowerSupplied,
        reason: projection.projectedPowerReason,
        amount: projection.projectedPowerSupplied ? state.config.facilities[facility.type].production.powerCapacity : 0,
      });
    }
    for (const [resource, amount] of Object.entries(projection.inputs) as Array<[ResourceType, number]>) {
      if (amount > 0) emit(state, 'resource_consumed', { facilityId: facility.id, resource, amount });
    }
  }
  if (forecast.fuel.projectedFuelUsed > 0) {
    emit(state, 'resource_consumed', { resource: 'fuel', amount: forecast.fuel.projectedFuelUsed, reason: 'power_generation' });
  }
  for (const refill of plan.unitRefills) {
    if (refill.amount <= 0) continue;
    const unit = getUnit(state, refill.unitId);
    if (!unit) continue;
    unit.currentFuel = Math.min(unit.maxFuel, unit.currentFuel + refill.amount);
    emit(state, 'resource_consumed', { resource: 'fuel', amount: refill.amount, reason: 'unit_refill', unitId: unit.id });
  }
  for (const resource of RESOURCE_TYPES) {
    const amount = resource === 'food'
      ? forecast.food.projectedProduction
      : resource === 'civilianGoods'
        ? forecast.civilianGoods.projectedProduction
        : resource === 'militaryGoods'
          ? forecast.militaryGoods.projectedProduction
          : forecast.fuel.projectedProduction;
    if (amount > 0) emit(state, 'resource_produced', { resource, amount });
  }
  for (const unitForecast of forecast.militaryGoods.units) {
    const unit = getUnit(state, unitForecast.unitId);
    if (!unit) continue;
    unit.currentMilitaryGoods = unitForecast.afterRefill;
    if (unitForecast.projectedRefillAmount > 0) {
      emit(state, 'resource_consumed', {
        resource: 'militaryGoods',
        amount: unitForecast.projectedRefillAmount,
        reason: 'unit_refill',
        unitId: unit.id,
        unitType: unit.type,
      });
    }
  }
  emit(state, 'resource_consumed', {
    resource: 'food',
    amount: forecast.food.maintenanceRequired - forecast.food.shortage,
    population: forecast.populationConsumers,
    overcrowding: forecast.overcrowding.additionalFood,
  });
  emit(state, 'resource_consumed', {
    resource: 'civilianGoods',
    amount: forecast.civilianGoods.maintenanceRequired - forecast.civilianGoods.maintenanceShortage,
    population: forecast.populationConsumers,
    overcrowding: forecast.overcrowding.additionalCivilianGoods,
  });
  if (forecast.militaryGoods.totalUnfilledRefillDemand > 0) {
    emit(state, 'resource_shortage', {
      resource: 'militaryGoods',
      amount: forecast.militaryGoods.totalUnfilledRefillDemand,
      reason: 'unit_refill',
    });
  }
  if (forecast.fuel.generationFuelShortage > 0) {
    emit(state, 'resource_shortage', { resource: 'fuel', amount: forecast.fuel.generationFuelShortage, reason: 'power_generation' });
  }
  if (forecast.food.shortage + forecast.civilianGoods.maintenanceShortage > 0) {
    emit(state, 'resource_shortage', {
      food: forecast.food.shortage,
      civilianGoods: forecast.civilianGoods.maintenanceShortage,
    });
    removeWorkersForShortage(state, forecast.food.shortage, 'food');
    synchronizePopulation(state);
    if (checkImmediateDefeat(state)) return plan.facilities;
    removeWorkersForShortage(state, forecast.civilianGoods.maintenanceShortage, 'civilianGoods');
    synchronizePopulation(state);
    if (checkImmediateDefeat(state)) return plan.facilities;
  }
  synchronizePopulation(state);
  return plan.facilities;
}

/**
 * Project the deterministic facility production that would be resolved by
 * ending the current turn. The private copy includes maintenance losses,
 * secured-order power allocation, and partial input-resource operation.
 */
function nearestSpawnPosition(state: GameState, origin: HexCoord, rng: SeededRng): HexCoord | null {
  const occupied = occupiedKeys(state);
  let frontier = [{ ...origin }];
  const seen = new Set<string>([hexKey(origin)]);
  while (frontier.length > 0) {
    const available = frontier.filter((position) => !occupied.has(hexKey(position)));
    if (available.length > 0) {
      return rng.pick(available.sort((a, b) => a.q - b.q || a.r - b.r));
    }
    const next: HexCoord[] = [];
    for (const position of frontier) {
      for (const neighbor of hexNeighbors(position)) {
        const key = hexKey(neighbor);
        if (hexWithinBounds(neighbor, state.map.width, state.map.height) && !seen.has(key)) {
          seen.add(key);
          next.push(neighbor);
        }
      }
    }
    frontier = next.sort((a, b) => a.q - b.q || a.r - b.r);
  }
  return null;
}

function nearestSpawnPositionMatching(
  state: GameState,
  origin: HexCoord,
  rng: SeededRng,
  allowed: (position: HexCoord) => boolean,
): HexCoord | null {
  const occupied = occupiedKeys(state);
  const available = state.map.tiles
    .map((tile) => ({ q: tile.q, r: tile.r }))
    .filter((position) => !occupied.has(hexKey(position)) && allowed(position));
  if (available.length === 0) return null;
  const minimumDistance = Math.min(...available.map((position) => hexDistance(origin, position)));
  return rng.pick(
    available
      .filter((position) => hexDistance(origin, position) === minimumDistance)
      .sort((left, right) => left.q - right.q || left.r - right.r),
  );
}

function spawnZombies(
  state: GameState,
  origin: HexCoord,
  count: number,
  rng: SeededRng,
  cause: string,
  unitType: ZombieUnitType = 'zombie',
  spawnGroupId: string | null = null,
  hordeKind: UnitState['hordeKind'] = null,
  positionAllowed: ((position: HexCoord) => boolean) | null = null,
): UnitState[] {
  const spawned: UnitState[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = positionAllowed
      ? nearestSpawnPositionMatching(state, origin, rng, positionAllowed)
      : nearestSpawnPosition(state, origin, rng);
    if (!position) {
      return spawned;
    }
    const prefix = unitType === 'hordeZombie' ? 'horde-zombie'
      : unitType === 'policeZombie' ? 'police-zombie'
        : unitType === 'soldierZombie' ? 'soldier-zombie'
          : unitType === 'riotZombie' ? 'riot-zombie' : unitType === 'hunterZombie' ? 'hunter-zombie' : 'zombie';
    let id = `${prefix}-${state.nextUnitNumber}`;
    while (state.units.some((unit) => unit.id === id)) {
      state.nextUnitNumber += 1;
      id = `${prefix}-${state.nextUnitNumber}`;
    }
    state.nextUnitNumber += 1;
    const unit = createUnit(state, id, unitType, position);
    unit.spawnGroupId = spawnGroupId;
    unit.hordeKind = hordeKind;
    state.units.push(unit);
    spawned.push(unit);
    emit(state, 'horde_spawned', { zombieId: id, q: position.q, r: position.r, cause, unitType, spawnGroupId });
  }
  return spawned;
}

function chooseHordeSlotType(
  state: Readonly<GameState>,
  rng: SeededRng,
  riotCount: number,
  hunterCount: number,
): Exclude<ZombieUnitType, 'hordeZombie'> {
  const entries = WAVE_NON_HORDE_TYPES
    .filter((type) => type !== 'riotZombie' || riotCount < state.config.horde.riotZombieCapPerDirection)
    .filter((type) => type !== 'hunterZombie' || hunterCount < state.config.horde.hunterZombieCapPerDirection)
    .map((type) => ({ type, weight: state.config.horde.specialZombieWeights[type] }))
    .filter((entry) => entry.weight > 0);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.nextInt(1, total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return entries.at(-1)!.type;
}

function spawnHordeComposition(
  state: GameState,
  origin: HexCoord,
  composition: { hordeZombie: number; zombie: number },
  rejectedBonusNormalZombies: number,
  rng: SeededRng,
  cause: string,
  spawnGroupId: string,
  hordeKind: Exclude<UnitState['hordeKind'], null>,
): UnitState[] {
  const hordeUnits = spawnZombies(
    state, origin, composition.hordeZombie, rng, cause, 'hordeZombie', spawnGroupId, hordeKind,
  );
  const slotUnits: UnitState[] = [];
  let riotCount = 0;
  let hunterCount = 0;
  for (let slot = 0; slot < composition.zombie; slot += 1) {
    const unitType = chooseHordeSlotType(state, rng, riotCount, hunterCount);
    if (unitType === 'riotZombie') riotCount += 1;
    if (unitType === 'hunterZombie') hunterCount += 1;
    const spawned = spawnZombies(
      state,
      origin,
      1,
      rng,
      cause,
      unitType,
      spawnGroupId,
      hordeKind,
      (position) => hordeUnits.some((horde) => hexDistance(position, horde.position) <= horde.vision),
    );
    slotUnits.push(...spawned);
  }
  const rejectedBonusUnits = spawnZombies(
    state,
    origin,
    rejectedBonusNormalZombies,
    rng,
    cause,
    'zombie',
    spawnGroupId,
    hordeKind,
    (position) => hordeUnits.some((horde) => hexDistance(position, horde.position) <= horde.vision),
  );
  return [...hordeUnits, ...slotUnits, ...rejectedBonusUnits];
}


interface SiteSpawnDescriptor {
  siteKind: 'facility' | 'checkpoint';
  siteId: string;
  siteType: string;
  position: HexCoord;
  currentInfected: number;
  constructibleDestroyed?: boolean;
}

function eligibleAdjacentZombieSpawnPositions(state: Readonly<GameState>, origin: HexCoord): HexCoord[] {
  const occupied = occupiedKeys(state as GameState);
  return hexNeighbors(origin)
    .filter((position) => hexWithinBounds(position, state.map.width, state.map.height))
    .filter((position) => !occupied.has(hexKey(position)))
    .filter((position) => {
      const tile = getTile(state.map, position);
      return tile !== undefined && state.config.terrain.movementCost[tile.terrain] !== null;
    })
    .sort((left, right) => left.q - right.q || left.r - right.r);
}

function createSiteSpawnedZombie(state: GameState, position: HexCoord): UnitState {
  let id = `zombie-${state.nextUnitNumber}`;
  while (state.units.some((unit) => unit.id === id)) {
    state.nextUnitNumber += 1;
    id = `zombie-${state.nextUnitNumber}`;
  }
  state.nextUnitNumber += 1;
  const unit = createUnit(state, id, 'zombie', position);
  unit.canMove = false;
  unit.canAttack = false;
  state.units.push(unit);
  return unit;
}

function resolveSiteZombieSpawn(
  state: GameState,
  site: SiteSpawnDescriptor,
  rng: SeededRng,
  eventType: 'site_fallen' | 'site_chain_fallen' | 'site_noise_respawn',
  cause: string,
  queue: SpawnOccupancyEntry[],
  chainRootEventId: string | null,
  chainDepth: number,
  originUnitType: HumanUnitType | 'hordeZombie' | null = null,
): { remainingInfected: number; actualSpawnCount: number; eventId: string } {
  const perUnit = state.config.infection.zombieSpawnPopulationPerUnit;
  const requestedSpawnCount = Math.min(
    state.config.infection.maxZombieSpawnPerResolution,
    Math.floor(site.currentInfected / perUnit),
  );
  let available = eligibleAdjacentZombieSpawnPositions(state, site.position);
  const actualSpawnCount = Math.min(requestedSpawnCount, available.length);
  const remainingInfected = site.currentInfected - actualSpawnCount * perUnit;
  const constructibleInfectedDeaths = site.constructibleDestroyed ? remainingInfected : 0;
  const primaryEvent = emit(state, eventType, {
    siteKind: site.siteKind,
    siteId: site.siteId,
    siteType: site.siteType,
    q: site.position.q,
    r: site.position.r,
    cause,
    infectedAtFall: site.currentInfected,
    requestedSpawnCount,
    actualSpawnCount,
    remainingInfected: site.constructibleDestroyed ? 0 : remainingInfected,
    constructibleInfectedDeaths,
    chainOriginEventId: chainRootEventId,
    chainDepth,
    sourceUnitType: originUnitType,
  });
  const rootEventId = chainRootEventId ?? primaryEvent.id;
  const spawned: UnitState[] = [];
  for (let index = 0; index < actualSpawnCount; index += 1) {
    const position = available.length > 1 ? rng.pick(available) : available[0]!;
    available = available.filter((candidate) => hexKey(candidate) !== hexKey(position));
    const unit = createSiteSpawnedZombie(state, position);
    spawned.push(unit);
    queue.push({ unitId: unit.id, chainRootEventId: rootEventId, chainDepth });
  }
  if (spawned.length > 0) {
    emit(state, 'site_zombies_spawned', {
      siteKind: site.siteKind,
      siteId: site.siteId,
      siteType: site.siteType,
      q: site.position.q,
      r: site.position.r,
      cause,
      requestedSpawnCount,
      actualSpawnCount,
      remainingInfected: site.constructibleDestroyed ? 0 : remainingInfected,
      chainOriginEventId: rootEventId,
      sourceUnitType: originUnitType,
      spawnedUnitIds: spawned.map((unit) => unit.id),
      spawnedPositions: spawned.map((unit) => ({ q: unit.position.q, r: unit.position.r })),
    });
  }
  state.statistics.infectedPopulationConvertedToZombies += actualSpawnCount * perUnit;
  state.statistics.unspawnedInfectedPopulation += Math.max(0, requestedSpawnCount - actualSpawnCount) * perUnit;
  if (site.constructibleDestroyed) {
    state.statistics.constructibleInfectedDeaths += constructibleInfectedDeaths;
  }
  if (eventType === 'site_noise_respawn') {
    state.statistics.fallenSitesTriggeredByNoise += 1;
    state.statistics.noiseRespawnAttempts += 1;
    state.statistics.noiseRespawnZombiesSpawned += actualSpawnCount;
  }
  if (eventType === 'site_chain_fallen') {
    state.statistics.chainOverruns += 1;
    state.statistics.maximumOverrunChainLength = Math.max(state.statistics.maximumOverrunChainLength, chainDepth);
  }
  return { remainingInfected, actualSpawnCount, eventId: primaryEvent.id };
}

function fallFacility(
  state: GameState,
  facility: FacilityState,
  rng: SeededRng,
  queue: SpawnOccupancyEntry[],
  cause: string,
  chainRootEventId: string | null,
  chainDepth: number,
): void {
  if (facility.type === 'windPowerPlant') {
    facility.operationalStatus = 'disabled';
    facility.infected = 0;
    facility.workers = 0;
    emit(state, 'facility_disabled', { facilityId: facility.id, facilityType: facility.type });
    return;
  }
  if (facility.status === 'ruined') return;
  const infectedAtFall = facility.infected;
  if (facility.constructible) {
    const result = resolveSiteZombieSpawn(
      state,
      {
        siteKind: 'facility', siteId: facility.id, siteType: facility.type,
        position: facility.position, currentInfected: infectedAtFall, constructibleDestroyed: true,
      },
      rng,
      chainRootEventId ? 'site_chain_fallen' : 'site_fallen',
      cause,
      queue,
      chainRootEventId,
      chainDepth,
    );
    state.population.cumulativeDeaths += result.remainingInfected;
    state.facilities.splice(state.facilities.findIndex((candidate) => candidate.id === facility.id), 1);
    emit(state, 'facility_overrun', {
      facilityId: facility.id,
      constructibleDestroyed: true,
      infectedAtFall,
      requestedSpawnCount: Math.min(state.config.infection.maxZombieSpawnPerResolution, Math.floor(infectedAtFall / state.config.infection.zombieSpawnPopulationPerUnit)),
      actualSpawnCount: result.actualSpawnCount,
      remainingInfected: 0,
      constructibleInfectedDeaths: result.remainingInfected,
      chainOriginEventId: chainRootEventId,
    });
    return;
  }
  facility.status = 'ruined';
  // Ruined facilities are no longer owned. Recovery by a stationed player
  // unit claims the site again after its internal infection reaches zero.
  facility.owner = 'none';
  facility.operationalStatus = 'ruined';
  facility.workers = 0;
  const result = resolveSiteZombieSpawn(
    state,
    { siteKind: 'facility', siteId: facility.id, siteType: facility.type, position: facility.position, currentInfected: infectedAtFall },
    rng,
    chainRootEventId ? 'site_chain_fallen' : 'site_fallen',
    cause,
    queue,
    chainRootEventId,
    chainDepth,
  );
  facility.infected = result.remainingInfected;
  emit(state, 'facility_overrun', {
    facilityId: facility.id,
    infectedAtFall,
    requestedSpawnCount: Math.min(state.config.infection.maxZombieSpawnPerResolution, Math.floor(infectedAtFall / state.config.infection.zombieSpawnPopulationPerUnit)),
    actualSpawnCount: result.actualSpawnCount,
    remainingInfected: result.remainingInfected,
    constructibleInfectedDeaths: 0,
    chainOriginEventId: chainRootEventId,
  });
}

function overrunFacility(state: GameState, facility: FacilityState, rng: SeededRng, cause = 'infection_fall'): void {
  const queue: SpawnOccupancyEntry[] = [];
  fallFacility(state, facility, rng, queue, cause, null, 0);
  processSpawnOccupancyQueue(state, rng, queue);
}

function checkpointBranchIndex(state: Readonly<GameState>, branchId: string, position: HexCoord): number {
  return getRoadBranch(state.map, branchId)?.roadTiles.findIndex((tile) => hexKey(tile) === hexKey(position)) ?? -1;
}

function resolveCheckpointFallback(
  state: GameState,
  branchId: string,
  lostCheckpoint: Readonly<CheckpointState>,
): CheckpointState | null {
  const branch = getRoadBranchState(state, branchId);
  if (!branch) return null;
  branch.activeCheckpointId = null;
  branch.standbyCheckpointIds = branch.standbyCheckpointIds.filter((id) => id !== lostCheckpoint.id);
  const lostIndex = checkpointBranchIndex(state, branchId, lostCheckpoint.position);
  const operationalBehind = (checkpoint: CheckpointState): boolean =>
    checkpoint.status === 'operational' &&
    (checkpoint.branchId ?? checkpoint.direction) === branchId &&
    checkpointBranchIndex(state, branchId, checkpoint.position) >= 0 &&
    checkpointBranchIndex(state, branchId, checkpoint.position) < lostIndex &&
    !checkpointHasZombie(state, checkpoint);
  const selectFrontmost = (checkpoints: CheckpointState[]): CheckpointState | null =>
    [...checkpoints].sort(
      (left, right) =>
        checkpointBranchIndex(state, branchId, right.position) - checkpointBranchIndex(state, branchId, left.position) ||
        left.id.localeCompare(right.id),
    )[0] ?? null;
  const standby = selectFrontmost(
    branch.standbyCheckpointIds
      .map((id) => state.checkpoints.find((checkpoint) => checkpoint.id === id))
      .filter((checkpoint): checkpoint is CheckpointState => checkpoint !== undefined && operationalBehind(checkpoint)),
  );
  const dormant = standby
    ? null
    : selectFrontmost(
        state.checkpoints.filter(
          (checkpoint) =>
            operationalBehind(checkpoint) &&
            checkpoint.id !== branch.activeCheckpointId &&
            !branch.standbyCheckpointIds.includes(checkpoint.id),
        ),
      );
  const replacement = standby ?? dormant;
  if (!replacement) return null;
  const sourceRole = standby ? 'standby' : 'dormant';
  branch.standbyCheckpointIds = branch.standbyCheckpointIds.filter((id) => id !== replacement.id);
  branch.activeCheckpointId = replacement.id;
  state.statistics.checkpointFallbacks += 1;
  state.statistics.checkpointFallbacksByBranch[branchId] =
    (state.statistics.checkpointFallbacksByBranch[branchId] ?? 0) + 1;
  if (sourceRole === 'standby') state.statistics.checkpointFallbacksFromStandby += 1;
  else state.statistics.checkpointFallbacksFromDormant += 1;
  state.statistics.checkpointFallbacksPreventingUnmanagedArrival += 1;
  emit(state, 'checkpoint_fallback', {
    branchId,
    lostCheckpointId: lostCheckpoint.id,
    checkpointId: replacement.id,
    fromRole: sourceRole,
  });
  return replacement;
}

function fallCheckpoint(
  state: GameState,
  checkpoint: CheckpointState,
  rng: SeededRng,
  queue: SpawnOccupancyEntry[],
  cause: string,
  chainRootEventId: string | null,
  chainDepth: number,
): void {
  if (checkpoint.overrunProcessed || checkpoint.status === 'abandoned') {
    return;
  }
  const infectedAtFall = checkpoint.infected;
  const previousRole = deriveCheckpointRole(state, checkpoint);
  const wasOperational = checkpoint.status === 'operational';
  const wasActive = previousRole === 'active';
  const beforeSupply = wasActive ? getSuppliedTileKeys(state) : [];
  checkpoint.overrunProcessed = true;
  if (wasOperational) {
    checkpoint.status = 'ruined';
    const branch = getRoadBranchState(state, checkpoint.branchId ?? checkpoint.direction);
    if (branch) branch.standbyCheckpointIds = branch.standbyCheckpointIds.filter((id) => id !== checkpoint.id);
    state.statistics.checkpointsRuined += 1;
    if (wasActive) {
      state.statistics.activeCheckpointLosses += 1;
      resolveCheckpointFallback(state, checkpoint.branchId ?? checkpoint.direction, checkpoint);
    }
  }
  checkpoint.waiting = 0;
  checkpoint.screening = 0;
  checkpoint.approved = 0;
  checkpoint.remainingTurns = 0;
  const result = resolveSiteZombieSpawn(
    state,
    {
      siteKind: 'checkpoint',
      siteId: checkpoint.id,
      siteType: previousRole,
      position: checkpoint.position,
      currentInfected: infectedAtFall,
    },
    rng,
    chainRootEventId ? 'site_chain_fallen' : 'site_fallen',
    cause,
    queue,
    chainRootEventId,
    chainDepth,
  );
  checkpoint.infected = result.remainingInfected;
  emit(state, 'facility_overrun', {
    checkpointId: checkpoint.id,
    branchId: checkpoint.branchId ?? checkpoint.direction,
    infectedAtFall,
    requestedSpawnCount: Math.min(state.config.infection.maxZombieSpawnPerResolution, Math.floor(infectedAtFall / state.config.infection.zombieSpawnPopulationPerUnit)),
    actualSpawnCount: result.actualSpawnCount,
    remainingInfected: result.remainingInfected,
    constructibleInfectedDeaths: 0,
    chainOriginEventId: chainRootEventId,
    previousStatus: wasOperational ? 'operational' : checkpoint.status,
  });
  if (wasActive) {
    emitSupplyChanged(state, checkpoint.branchId ?? checkpoint.direction, beforeSupply, 'checkpoint_ruined');
  }
}

function overrunCheckpoint(state: GameState, checkpoint: CheckpointState, rng: SeededRng, cause = 'infection_fall'): void {
  const queue: SpawnOccupancyEntry[] = [];
  fallCheckpoint(state, checkpoint, rng, queue, cause, null, 0);
  processSpawnOccupancyQueue(state, rng, queue);
}

function markSiteInfectionStarted(
  state: GameState,
  siteKind: 'facility' | 'checkpoint',
  siteId: string,
  siteType: string,
  position: HexCoord,
  amount: number,
  source: string,
  chainRootEventId: string | null = null,
): void {
  emit(state, 'site_infection_started', {
    siteKind,
    siteId,
    siteType,
    q: position.q,
    r: position.r,
    amount,
    source,
    chainOriginEventId: chainRootEventId,
  });
}

function applyGeneratedZombieOccupancy(
  state: GameState,
  zombie: UnitState,
  rng: SeededRng,
  queue: SpawnOccupancyEntry[],
  chainRootEventId: string,
  chainDepth: number,
): void {
  const facility = getFacilityAt(state, zombie.position);
  if (facility && facility.status !== 'ruined') {
    if (facility.type === 'windPowerPlant' || (facility.constructible && facility.workers === 0)) {
      facility.operationalStatus = 'disabled';
      facility.infected = 0;
      emit(state, 'facility_disabled', { facilityId: facility.id, facilityType: facility.type, source: zombie.id, immediateSpawnOccupation: true });
    } else {
      const wasInfected = facility.infected > 0;
      const converted = Math.min(zombie.attack, facility.workers);
      facility.workers -= converted;
      facility.infected += converted;
      if (converted > 0) {
        facility.operationalStatus = 'infected';
        state.statistics.civilianLosses += converted;
        state.statistics.infectionLosses += converted;
        state.statistics.immediateInfectionsFromSpawn += 1;
        if (!wasInfected) markSiteInfectionStarted(state, 'facility', facility.id, facility.type, facility.position, converted, zombie.id, chainRootEventId);
        emit(state, 'site_immediate_infection', {
          siteKind: 'facility', siteId: facility.id, siteType: facility.type,
          q: facility.position.q, r: facility.position.r, amount: converted,
          remainingHealthy: facility.workers, infected: facility.infected,
          chainOriginEventId: chainRootEventId,
        });
      }
      if (facility.workers === 0 && (converted > 0 || facility.infected > 0)) {
        fallFacility(state, facility, rng, queue, 'spawn_immediate_occupation', chainRootEventId, chainDepth + 1);
      }
    }
  }
  const checkpoint = getCheckpointAt(state, zombie.position);
  if (checkpoint && ['operational', 'remnant'].includes(checkpoint.status)) {
    const wasInfected = checkpoint.infected > 0;
    const converted = removeCheckpointPeople(checkpoint, zombie.attack);
    checkpoint.infected += converted;
    if (converted > 0) {
      state.statistics.civilianLosses += converted;
      state.statistics.infectionLosses += converted;
      state.statistics.immediateInfectionsFromSpawn += 1;
      if (!wasInfected) markSiteInfectionStarted(state, 'checkpoint', checkpoint.id, deriveCheckpointRole(state, checkpoint), checkpoint.position, converted, zombie.id, chainRootEventId);
      emit(state, 'site_immediate_infection', {
        siteKind: 'checkpoint', siteId: checkpoint.id, siteType: deriveCheckpointRole(state, checkpoint),
        q: checkpoint.position.q, r: checkpoint.position.r, amount: converted,
        remainingHealthy: totalCheckpointPeople(checkpoint), infected: checkpoint.infected,
        chainOriginEventId: chainRootEventId,
      });
    }
    if (totalCheckpointPeople(checkpoint) === 0 && (checkpoint.status === 'operational' || checkpoint.infected > 0)) {
      fallCheckpoint(state, checkpoint, rng, queue, 'spawn_immediate_occupation', chainRootEventId, chainDepth + 1);
    }
  }
}

function processSpawnOccupancyQueue(state: GameState, rng: SeededRng, queue: SpawnOccupancyEntry[]): void {
  while (queue.length > 0) {
    const entry = queue.shift()!;
    const zombie = state.units.find((unit) => unit.id === entry.unitId);
    if (!zombie) continue;
    applyGeneratedZombieOccupancy(state, zombie, rng, queue, entry.chainRootEventId, entry.chainDepth);
  }
}

function suppressFacility(state: GameState, facility: FacilityState, unit: UnitState): boolean {
  if (!unit.canAttack || unit.attackChargesRemaining <= 0 || facility.infected <= 0) {
    return false;
  }
  const militaryGoodsCost = state.config.units[unit.type as HumanUnitType].suppressionMilitaryGoodsCost;
  if (unit.currentMilitaryGoods < militaryGoodsCost) return false;
  const amount = unit.attack;
  const suppressed = Math.min(facility.infected, amount);
  facility.infected -= suppressed;
  state.population.cumulativeDeaths += suppressed;
  const civilianDamageRate = state.config.units[unit.type as HumanUnitType].suppressionCivilianDamageRate;
  if (civilianDamageRate > 0) {
    const civilianLosses = Math.min(
      facility.workers,
      Math.ceil(amount * civilianDamageRate),
    );
    facility.workers -= civilianLosses;
    state.statistics.civilianLosses += civilianLosses;
    state.population.cumulativeDeaths += civilianLosses;
  }
  unit.attackChargesRemaining = Math.max(0, unit.attackChargesRemaining - 1);
  unit.canAttack = unit.attackChargesRemaining > 0;
  unit.canMove = false;
  unit.activity.suppressed = true;
  unit.currentMilitaryGoods -= militaryGoodsCost;
  emit(state, 'infection_suppressed', {
    facilityId: facility.id,
    unitId: unit.id,
    unitType: unit.type,
    remaining: facility.infected,
    militaryGoodsCost,
    militaryGoodsRemaining: unit.currentMilitaryGoods,
    attackChargesRemaining: unit.attackChargesRemaining,
  });
  if (facility.infected > 0) {
    facility.operationalStatus = facility.status === 'ruined' ? 'ruined' : 'infected';
  }
  else if (facility.status === 'owned') facility.operationalStatus = facility.workers > 0 ? 'operational' : 'stopped';
  if (facility.infected === 0 && facility.status === 'ruined') {
    facility.owner = 'player';
    facility.status = 'owned';
    facility.operationalStatus = 'stopped';
    facility.workers = 0;
    facility.populationOperationalTurn = state.turn + 1;
    emit(state, 'facility_recovered', { facilityId: facility.id, unitId: unit.id });
  }
  return true;
}

function suppressCheckpoint(state: GameState, checkpoint: CheckpointState, unit: UnitState, _rng: SeededRng): boolean {
  if (!unit.canAttack || unit.attackChargesRemaining <= 0 || checkpoint.infected <= 0) {
    return false;
  }
  const militaryGoodsCost = state.config.units[unit.type as HumanUnitType].suppressionMilitaryGoodsCost;
  if (unit.currentMilitaryGoods < militaryGoodsCost) return false;
  const beforeSupply = checkpoint.status === 'ruined' ? getSuppliedTileKeys(state) : [];
  const amount = unit.attack;
  const suppressed = Math.min(checkpoint.infected, amount);
  checkpoint.infected -= suppressed;
  state.population.cumulativeDeaths += suppressed;
  const civilianDamageRate = state.config.units[unit.type as HumanUnitType].suppressionCivilianDamageRate;
  if (civilianDamageRate > 0) {
    const civilianLosses = removeCheckpointPeople(
      checkpoint,
      Math.ceil(amount * civilianDamageRate),
    );
    state.statistics.civilianLosses += civilianLosses;
    state.population.cumulativeDeaths += civilianLosses;
  }
  unit.attackChargesRemaining = Math.max(0, unit.attackChargesRemaining - 1);
  unit.canAttack = unit.attackChargesRemaining > 0;
  unit.canMove = false;
  unit.activity.suppressed = true;
  unit.currentMilitaryGoods -= militaryGoodsCost;
  emit(state, 'infection_suppressed', {
    checkpointId: checkpoint.id,
    unitId: unit.id,
    unitType: unit.type,
    remaining: checkpoint.infected,
    militaryGoodsCost,
    militaryGoodsRemaining: unit.currentMilitaryGoods,
    attackChargesRemaining: unit.attackChargesRemaining,
  });
  if (checkpoint.infected === 0 && checkpoint.status === 'ruined') {
    const branch = getRoadBranchState(state, checkpoint.branchId ?? checkpoint.direction);
    checkpoint.status = 'operational';
    checkpoint.overrunProcessed = false;
    let role: 'active' | 'standby' | 'dormant' = 'dormant';
    if (branch?.activeCheckpointId === null) {
      branch.activeCheckpointId = checkpoint.id;
      role = 'active';
    } else {
      role = assignOperationalReserveRole(state, checkpoint);
      if (role === 'standby') state.statistics.standbyCheckpointsCreated += 1;
      else state.statistics.dormantCheckpointsCreated += 1;
    }
    state.statistics.checkpointsRecovered += 1;
    emit(state, 'checkpoint_recovered', {
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
      unitId: unit.id,
      role,
    });
    if (role === 'active') emitSupplyChanged(state, checkpoint.branchId ?? checkpoint.direction, beforeSupply, 'checkpoint_recovered');
  } else if (
    checkpoint.infected === 0 &&
    checkpoint.status === 'abandoned'
  ) {
    state.checkpoints.splice(state.checkpoints.findIndex((candidate) => candidate.id === checkpoint.id), 1);
    state.statistics.checkpointsRemoved += 1;
    emit(state, 'checkpoint_removed', {
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
      reason: checkpoint.status === 'abandoned' ? 'abandoned_suppressed' : 'remnant_empty',
      unitId: unit.id,
    });
  }
  resolveCheckpointRemnants(state);
  return true;
}

function processInternalInfection(state: GameState, rng: SeededRng): void {
  for (const facility of stableFacilities(state)) {
    if (facility.infected <= 0) {
      continue;
    }
    const occupant = getUnitAt(state, facility.position);
    const guarded = occupant?.isPlayerUnit === true;
    if (guarded) {
      while (facility.infected > 0 && suppressFacility(state, facility, occupant!)) {
        // Veteran units may spend a second remaining charge on the same site.
      }
    }
    if (!guarded && facility.infected > 0) {
      const spread = Math.min(facility.workers, facility.infected * state.config.infection.facilitySpreadPerTurn);
      facility.workers -= spread;
      facility.infected += spread;
      facility.operationalStatus = facility.status === 'ruined' ? 'ruined' : 'infected';
      if (spread > 0) {
        state.statistics.civilianLosses += spread;
        state.statistics.infectionLosses += spread;
        emit(state, 'infection_spread', { facilityId: facility.id, amount: spread });
      }
      if (facility.workers === 0) {
        overrunFacility(state, facility, rng);
      }
    }
    if (checkImmediateDefeat(state)) {
      return;
    }
  }
  for (const checkpoint of [...state.checkpoints].sort((a, b) => a.id.localeCompare(b.id))) {
    if (checkpoint.infected <= 0) {
      continue;
    }
    const occupant = getUnitAt(state, checkpoint.position);
    const guarded = occupant?.isPlayerUnit === true;
    if (guarded) {
      while (checkpoint.infected > 0 && suppressCheckpoint(state, checkpoint, occupant!, rng)) {
        // Resolve one deterministic suppression check per remaining charge.
      }
    }
    if (!guarded && checkpoint.infected > 0) {
      const spread = Math.min(totalCheckpointPeople(checkpoint), checkpoint.infected * state.config.infection.facilitySpreadPerTurn);
      const removed = removeCheckpointPeople(checkpoint, spread);
      checkpoint.infected += removed;
      if (removed > 0) {
        state.statistics.civilianLosses += removed;
        state.statistics.infectionLosses += removed;
        emit(state, 'infection_spread', { checkpointId: checkpoint.id, amount: removed });
      }
      if (totalCheckpointPeople(checkpoint) === 0) {
        overrunCheckpoint(state, checkpoint, rng);
      }
    }
    if (checkImmediateDefeat(state)) {
      return;
    }
  }
  synchronizePopulation(state);
}

interface HumanTarget {
  position: HexCoord;
  population: number;
}

interface ZombieDecision {
  target: HexCoord | null;
  reason: 'visible_population' | 'inherited_horde' | 'noise' | 'capital' | 'idle';
  inheritedTarget: HexCoord | null;
  inheritedChanged: 'set' | 'cleared' | null;
  noiseTarget: HexCoord | null;
  noiseChanged: 'targeted' | 'reached' | 'overridden_horde' | 'overridden_visible' | null;
}

function zombieTargets(state: GameState): HumanTarget[] {
  const byPosition = new Map<string, HumanTarget>();
  const add = (position: HexCoord, population: number): void => {
    if (population <= 0) return;
    const key = hexKey(position);
    const existing = byPosition.get(key);
    if (existing) existing.population += population;
    else byPosition.set(key, { position: { ...position }, population });
  };
  for (const facility of state.facilities) {
    add(facility.position, facilityZombieTargetValue(state, facility));
  }
  for (const unit of state.units) {
    if (unit.isPlayerUnit) add(unit.position, unit.population);
  }
  for (const checkpoint of state.checkpoints) add(checkpoint.position, totalCheckpointPeople(checkpoint));
  return [...byPosition.values()].sort((left, right) => left.position.q - right.position.q || left.position.r - right.position.r);
}

function targetPath(
  state: GameState,
  zombie: UnitState,
  target: HumanTarget,
): { path: HexCoord[]; cost: number } | null {
  const occupied = occupiedKeys(state, zombie.id);
  const destinations = getUnitAt(state, target.position)
    ? hexNeighbors(target.position)
        .filter((position) => hexWithinBounds(position, state.map.width, state.map.height) && !occupied.has(hexKey(position)))
    : [target.position];
  // No search will run when every adjacent arrival hex is occupied. In
  // particular, do not build a terrain index for this common late-game case.
  if (destinations.length === 0) return null;
  const resolveCost = queryValue(state, 'zombieMovementCostResolver', () => createMovementCostResolver(state));
  const candidates = destinations
    .map((destination) => {
      const path = findShortestPath(
        state.map,
        zombie.position,
        destination,
        occupied,
        resolveCost,
      );
      return path
        ? { path, cost: pathMovementCost(path, resolveCost) }
        : null;
    })
    .filter((candidate): candidate is { path: HexCoord[]; cost: number } => candidate !== null)
    .sort((left, right) => left.cost - right.cost || left.path.at(-1)!.q - right.path.at(-1)!.q || left.path.at(-1)!.r - right.path.at(-1)!.r);
  return candidates[0] ?? null;
}

function chooseVisiblePopulationTarget(state: GameState, zombie: UnitState, rng: SeededRng): HumanTarget | null {
  const candidates = zombieTargets(state)
    .filter((target) => canUnitSee(zombie, target.position))
    .map((target) => ({ target, path: targetPath(state, zombie, target) }))
    .filter((candidate): candidate is { target: HumanTarget; path: { path: HexCoord[]; cost: number } } => candidate.path !== null);
  if (candidates.length === 0) return null;
  const minimumCost = Math.min(...candidates.map((candidate) => candidate.path.cost));
  const nearest = candidates.filter((candidate) => candidate.path.cost === minimumCost);
  const largestPopulation = Math.max(...nearest.map((candidate) => candidate.target.population));
  const tied = nearest
    .filter((candidate) => candidate.target.population === largestPopulation)
    .sort((left, right) => left.target.position.q - right.target.position.q || left.target.position.r - right.target.position.r);
  return (tied.length > 1 ? rng.pick(tied) : tied[0])?.target ?? null;
}

function hasVisiblePopulationTarget(state: GameState, zombie: UnitState): boolean {
  return zombieTargets(state).some(
    (target) => canUnitSee(zombie, target.position) && targetPath(state, zombie, target) !== null,
  );
}

interface CombatNoiseResolution {
  sourceUnitType: HumanUnitType | 'hordeZombie';
  center: HexCoord;
  radius: number;
}

function emitCombatNoise(state: GameState, source: UnitState, center: HexCoord): CombatNoiseResolution | null {
  if (!isHumanUnit(source)) return null;
  const config = state.config.units[source.type];
  const radius = config.noiseRadius;
  const noiseClass = config.noiseClass;
  const pulseId = `noise-${state.nextEventNumber}`;
  state.pendingNoisePulses.push({
    id: pulseId,
    center: { ...center },
    radius,
    sourceKind: 'humanCombat',
    sourceUnitType: source.type,
    emittedTurn: state.turn,
  });
  state.statistics.noisePulsesEmitted += 1;
  if (source.type === 'police') state.statistics.policeNoisePulses += 1;
  else if (source.type === 'nationalGuard') state.statistics.nationalGuardNoisePulses += 1;
  state.statistics.noisePulsesBySourceType[source.type] += 1;
  emit(state, 'noise_emitted', {
    sourceUnitId: source.id,
    sourceUnitType: source.type,
    q: center.q,
    r: center.r,
    noiseClass,
  });
  return { sourceUnitType: source.type, center: { ...center }, radius };
}

function emitHordeMovementNoise(
  state: GameState,
  source: UnitState,
  center: HexCoord,
): CombatNoiseResolution {
  const radius = state.config.horde.movementNoiseRadius;
  state.pendingNoisePulses.push({
    id: `noise-${state.nextEventNumber}`,
    center: { ...center },
    radius,
    sourceKind: 'hordeMovement',
    sourceUnitType: 'hordeZombie',
    emittedTurn: state.turn,
  });
  state.statistics.noisePulsesEmitted += 1;
  state.statistics.hordeMovementNoisePulses += 1;
  state.statistics.noisePulsesBySourceType.hordeZombie += 1;
  emit(state, 'noise_emitted', {
    sourceUnitType: 'hordeZombie',
    noiseClass: 'extraLarge',
    sourceKind: 'hordeMovement',
  });
  return { sourceUnitType: 'hordeZombie', center: { ...center }, radius };
}

function resolveFallenSiteNoiseRespawns(
  state: GameState,
  sourceUnitType: HumanUnitType | 'hordeZombie',
  center: HexCoord,
  radius: number,
  rng: SeededRng,
): void {
  if (!state.config.infection.noiseRespawnEnabled) return;
  const minimum = state.config.infection.zombieSpawnPopulationPerUnit;
  const sites: Array<
    | { kind: 'facility'; id: string; facility: FacilityState }
    | { kind: 'checkpoint'; id: string; checkpoint: CheckpointState }
  > = [
    ...state.facilities
      .filter((facility) => facility.status === 'ruined' && !facility.constructible && facility.type !== 'windPowerPlant' && facility.infected >= minimum)
      .map((facility) => ({ kind: 'facility' as const, id: facility.id, facility })),
    ...state.checkpoints
      .filter((checkpoint) => ['ruined', 'remnant'].includes(checkpoint.status) && checkpoint.infected >= minimum)
      .map((checkpoint) => ({ kind: 'checkpoint' as const, id: checkpoint.id, checkpoint })),
  ].filter((site) => hexDistance(site.kind === 'facility' ? site.facility.position : site.checkpoint.position, center) <= radius)
    .sort((left, right) => left.id.localeCompare(right.id) || (left.kind === right.kind ? 0 : left.kind === 'facility' ? -1 : 1));

  for (const site of sites) {
    const queue: SpawnOccupancyEntry[] = [];
    if (site.kind === 'facility') {
      const result = resolveSiteZombieSpawn(
        state,
        {
          siteKind: 'facility', siteId: site.facility.id, siteType: site.facility.type,
          position: site.facility.position, currentInfected: site.facility.infected,
        },
        rng,
        'site_noise_respawn',
        sourceUnitType === 'hordeZombie' ? 'horde_movement_noise' : 'combat_noise',
        queue,
        null,
        0,
        sourceUnitType,
      );
      site.facility.infected = result.remainingInfected;
    } else {
      const result = resolveSiteZombieSpawn(
        state,
        {
          siteKind: 'checkpoint', siteId: site.checkpoint.id, siteType: deriveCheckpointRole(state, site.checkpoint),
          position: site.checkpoint.position, currentInfected: site.checkpoint.infected,
        },
        rng,
        'site_noise_respawn',
        sourceUnitType === 'hordeZombie' ? 'horde_movement_noise' : 'combat_noise',
        queue,
        null,
        0,
        sourceUnitType,
      );
      site.checkpoint.infected = result.remainingInfected;
    }
    processSpawnOccupancyQueue(state, rng, queue);
  }
}

function nearestAttackableHuman(state: GameState, zombie: UnitState): UnitState | null {
  const candidates = state.units
    .filter(
      (unit) => unit.isPlayerUnit && hexDistance(unit.position, zombie.position) <= effectiveRange(state, zombie),
    )
    .sort(
      (left, right) =>
        hexDistance(zombie.position, left.position) - hexDistance(zombie.position, right.position) ||
        right.population - left.population ||
        left.id.localeCompare(right.id),
    );
  return candidates[0] ?? null;
}

function chooseNoisePulseTarget(
  zombie: Readonly<UnitState>,
  pulses: Readonly<GameState['pendingNoisePulses']>,
  current: HexCoord | null,
  rng: SeededRng,
): { target: HexCoord | null; changed: boolean } {
  const candidates = pulses
    .filter((pulse) => hexDistance(zombie.position, pulse.center) <= pulse.radius)
    .filter((pulse) => hexKey(pulse.center) !== hexKey(zombie.position))
    .map((pulse) => ({ pulse, distance: hexDistance(zombie.position, pulse.center) }))
    .sort((left, right) => left.distance - right.distance || left.pulse.id.localeCompare(right.pulse.id));
  if (candidates.length === 0) return { target: current ? { ...current } : null, changed: false };
  const minimumDistance = candidates[0].distance;
  if (current && hexDistance(zombie.position, current) <= minimumDistance) {
    return { target: { ...current }, changed: false };
  }
  const tied = candidates.filter((candidate) => candidate.distance === minimumDistance);
  const selected = tied.length === 1 ? tied[0] : rng.pick(tied);
  return { target: { ...selected.pulse.center }, changed: !current || hexKey(current) !== hexKey(selected.pulse.center) };
}

function targetDecisionSnapshot(
  state: GameState,
  rng: SeededRng,
  pendingPulses: Readonly<GameState['pendingNoisePulses']>,
): Map<string, ZombieDecision> {
  const snapshot = cloneState(state);
  return withReadOnlyQueryScope(snapshot, () => {
  const decisions = new Map<string, ZombieDecision>();
  const hordes = snapshot.units
    .filter((unit) => unit.type === 'hordeZombie')
    .sort((left, right) => left.id.localeCompare(right.id));
  const capital = getCapitalPosition(snapshot.map);
  for (const horde of hordes) {
    const visible = chooseVisiblePopulationTarget(snapshot, horde, rng);
    decisions.set(horde.id, {
      target: visible?.position ?? capital,
      reason: visible ? 'visible_population' : 'capital',
      inheritedTarget: null,
      inheritedChanged: null,
      noiseTarget: null,
      noiseChanged: null,
    });
  }
  for (const zombie of snapshot.units.filter(isNormalAiZombie).sort((a, b) => a.id.localeCompare(b.id))) {
    const visible = chooseVisiblePopulationTarget(snapshot, zombie, rng);
    if (visible) {
      decisions.set(zombie.id, {
        target: visible.position,
        reason: 'visible_population',
        inheritedTarget: zombie.inheritedTarget,
        inheritedChanged: null,
        noiseTarget: null,
        noiseChanged: zombie.noiseTarget ? 'overridden_visible' : null,
      });
      continue;
    }
    let memory = zombie.inheritedTarget;
    let noiseMemory = zombie.noiseTarget;
    let inheritedChanged: ZombieDecision['inheritedChanged'] = null;
    let noiseChanged: ZombieDecision['noiseChanged'] = null;
    if (memory && hexKey(memory) === hexKey(zombie.position)) {
      memory = null;
      inheritedChanged = 'cleared';
    }
    if (!memory) {
      const source = hordes
        .filter((horde) => {
          const propagatedTarget = decisions.get(horde.id)?.target;
          return canUnitSee(zombie, horde.position) && propagatedTarget !== null && propagatedTarget !== undefined && hexKey(propagatedTarget) !== hexKey(zombie.position);
        })
        .sort((left, right) => hexDistance(zombie.position, left.position) - hexDistance(zombie.position, right.position) || left.id.localeCompare(right.id))[0];
      const inherited = source ? decisions.get(source.id)?.target ?? null : null;
      if (inherited) {
        memory = { ...inherited };
        inheritedChanged = 'set';
        if (noiseMemory) {
          noiseMemory = null;
          noiseChanged = 'overridden_horde';
        }
      }
    }
    if (!memory) {
      const selection = chooseNoisePulseTarget(zombie, pendingPulses, noiseMemory, rng);
      noiseMemory = selection.target;
      if (selection.changed) noiseChanged = 'targeted';
    }
    if (memory && noiseMemory) {
      noiseMemory = null;
      noiseChanged = 'overridden_horde';
    }
    if (!memory && noiseMemory && hexKey(noiseMemory) === hexKey(zombie.position)) {
      noiseMemory = null;
      noiseChanged = 'reached';
    }
    decisions.set(zombie.id, {
      target: memory ?? noiseMemory,
      reason: memory ? 'inherited_horde' : noiseMemory ? 'noise' : 'idle',
      inheritedTarget: memory,
      inheritedChanged,
      noiseTarget: noiseMemory,
      noiseChanged,
    });
  }
  return decisions;
  });
}

/** Re-evaluate after each resolved combat; counters and interceptions share these charges. */
function resolveZombieAttacks(state: GameState, zombieId: string, rng: SeededRng): void {
  while (!state.gameOver) {
    const zombie = getUnit(state, zombieId);
    if (!zombie || !zombie.canAttack || zombie.attackChargesRemaining <= 0) return;
    const target = nearestAttackableHuman(state, zombie);
    if (!target) return;
    resolveCombat(state, zombie, target, 'attack', rng);
    if (checkImmediateDefeat(state)) return;
  }
}

function processZombieTurn(state: GameState, rng: SeededRng): void {
  const pendingPulses = state.pendingNoisePulses.map((pulse) => ({ ...pulse, center: { ...pulse.center } }));
  state.pendingNoisePulses = [];
  const decisions = targetDecisionSnapshot(state, rng, pendingPulses);
  const zombieIds = state.units
    .filter(isZombieFaction)
    .map((unit) => unit.id)
    .sort();
  for (const zombieId of zombieIds) {
    const zombie = getUnit(state, zombieId);
    if (!zombie) continue;
    // Site-spawned Zombies are created with both action flags disabled. They
    // can occupy/infect their spawn hex immediately, but do not receive a
    // normal Zombie action until startPlayerTurn arms them for the next cycle.
    if (!zombie.canMove && !zombie.canAttack) continue;
    const decision = decisions.get(zombieId) ?? {
      target: null,
      reason: 'idle' as const,
      inheritedTarget: null,
      inheritedChanged: null,
      noiseTarget: null,
      noiseChanged: null,
    };
    if (isNormalAiZombie(zombie)) {
      const noiseAcquiredAfterSnapshot =
        zombie.noiseTarget !== null && decision.noiseTarget === null && decision.noiseChanged === null
          ? { ...zombie.noiseTarget }
          : null;
      zombie.inheritedTarget = decision.inheritedTarget ? { ...decision.inheritedTarget } : null;
      zombie.noiseTarget = noiseAcquiredAfterSnapshot ?? (decision.noiseTarget ? { ...decision.noiseTarget } : null);
      if (decision.inheritedChanged === 'set') {
        state.statistics.hordeTargetInheritedCount += 1;
        emit(state, 'horde_target_inherited', { zombieId, q: decision.target!.q, r: decision.target!.r });
      } else if (decision.inheritedChanged === 'cleared') {
        state.statistics.hordeTargetClearedCount += 1;
        emit(state, 'horde_target_cleared', { zombieId });
      }
      if (decision.noiseChanged === 'overridden_horde') {
        state.statistics.noiseTargetsOverriddenByHorde += 1;
        emit(state, 'noise_target_overridden', { zombieId, reason: 'inherited_horde' });
      } else if (decision.noiseChanged === 'overridden_visible') {
        state.statistics.noiseTargetsOverriddenByVisiblePopulation += 1;
        emit(state, 'noise_target_overridden', { zombieId, reason: 'visible_population' });
      } else if (decision.noiseChanged === 'reached') {
        state.statistics.noiseTargetsReached += 1;
        emit(state, 'noise_target_reached', { zombieId });
      } else if (decision.noiseChanged === 'targeted') {
        state.statistics.normalZombiesNoiseTargeted += 1;
        emit(state, 'noise_targeted', { zombieId });
      }
    }
    const immediateTarget = zombie.canAttack ? nearestAttackableHuman(state, zombie) : null;
    if (immediateTarget) {
      resolveZombieAttacks(state, zombieId, rng);
      if (state.gameOver || checkImmediateDefeat(state)) return;
      continue;
    }
    if (!decision.target) {
      if (isNormalAiZombie(zombie)) {
        state.statistics.normalZombieIdleCount += 1;
        emit(state, 'zombie_idle', { zombieId });
      }
      continue;
    }
    const target: HumanTarget = { position: decision.target, population: 0 };
    const route = targetPath(state, zombie, target);
    const path = route?.path ?? null;
    const beforeMove = { ...zombie.position };
    if (path && path.length > 1) {
      applyMovement(state, zombie, path, zombie.movement, 'normal', rng);
    }
    const survivor = getUnit(state, zombieId);
    if (
      survivor !== undefined && isNormalAiZombie(survivor) &&
      decision.reason === 'noise' &&
      decision.target &&
      hexKey(survivor.position) === hexKey(decision.target) &&
      survivor.noiseTarget !== null
    ) {
      survivor.noiseTarget = null;
      state.statistics.noiseTargetsReached += 1;
      emit(state, 'noise_target_reached', { zombieId });
    }
    const afterMoveTarget = survivor?.canAttack ? nearestAttackableHuman(state, survivor) : null;
    if (survivor && afterMoveTarget) {
      resolveZombieAttacks(state, zombieId, rng);
      if (state.gameOver || checkImmediateDefeat(state)) return;
    }
    const movedHorde = getUnit(state, zombieId) ?? zombie;
    if (zombie.type === 'hordeZombie' && hexKey(beforeMove) !== hexKey(zombie.position)) {
      const pulse = emitHordeMovementNoise(state, movedHorde, zombie.position);
      resolveFallenSiteNoiseRespawns(state, pulse.sourceUnitType, pulse.center, pulse.radius, rng);
    }
    if (checkImmediateDefeat(state)) return;
  }
}

function processZombieInfection(state: GameState, rng: SeededRng): void {
  const zombies = state.units
    .filter(isZombieFaction)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const zombie of zombies) {
    const facility = getFacilityAt(state, zombie.position);
    if (facility) {
      if (
        facility.status !== 'ruined' &&
        (facility.type === 'windPowerPlant' || (facility.constructible && facility.workers === 0))
      ) {
        facility.operationalStatus = 'disabled';
        facility.infected = 0;
        emit(state, 'facility_disabled', { facilityId: facility.id, facilityType: facility.type, source: zombie.id });
      } else if (facility.status !== 'ruined') {
        const wasInfected = facility.infected > 0;
        const converted = Math.min(zombie.attack, facility.workers);
        facility.workers -= converted;
        facility.infected += converted;
        if (converted > 0) facility.operationalStatus = 'infected';
        if (converted > 0) {
          if (!wasInfected) markSiteInfectionStarted(state, 'facility', facility.id, facility.type, facility.position, converted, zombie.id);
          state.statistics.civilianLosses += converted;
          state.statistics.infectionLosses += converted;
          emit(state, 'infection_spread', { facilityId: facility.id, amount: converted, source: zombie.id });
        }
        if (facility.workers === 0 && (converted > 0 || facility.infected > 0)) {
          overrunFacility(state, facility, rng, converted > 0 ? 'zombie_occupation' : 'infection_fall');
        }
      }
    }
    const checkpoint = getCheckpointAt(state, zombie.position);
    if (checkpoint && ['operational', 'remnant'].includes(checkpoint.status)) {
      const wasInfected = checkpoint.infected > 0;
      const converted = removeCheckpointPeople(checkpoint, zombie.attack);
      checkpoint.infected += converted;
      if (converted > 0) {
        if (!wasInfected) markSiteInfectionStarted(state, 'checkpoint', checkpoint.id, deriveCheckpointRole(state, checkpoint), checkpoint.position, converted, zombie.id);
        state.statistics.civilianLosses += converted;
        state.statistics.infectionLosses += converted;
        emit(state, 'infection_spread', { checkpointId: checkpoint.id, amount: converted, source: zombie.id });
      }
      // An empty operational checkpoint is still destroyed by zombie occupation.
      if (totalCheckpointPeople(checkpoint) === 0 && (checkpoint.status === 'operational' || checkpoint.infected > 0)) {
        overrunCheckpoint(state, checkpoint, rng, converted > 0 ? 'zombie_occupation' : 'empty_zombie_occupation');
      }
    }
    if (checkImmediateDefeat(state)) return;
  }
  synchronizePopulation(state);
}

const CANONICAL_HORDE_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

function selectHordeDirections(rng: SeededRng, count: number): CardinalDirection[] {
  if (count === 4) return [...CANONICAL_HORDE_DIRECTIONS];
  const remaining = [...CANONICAL_HORDE_DIRECTIONS];
  const selected: CardinalDirection[] = [];
  while (selected.length < count) {
    const direction = rng.pick(remaining);
    selected.push(direction);
    remaining.splice(remaining.indexOf(direction), 1);
  }
  return CANONICAL_HORDE_DIRECTIONS.filter((direction) => selected.includes(direction));
}

function beginHordeWarningIfDue(state: GameState, rng: SeededRng): void {
  if (state.horde.nextWaveIndex === null || state.horde.warningDirections.length > 0) return;
  const wave = state.config.horde.waves[state.horde.nextWaveIndex - 1];
  if (!wave || state.turn < wave.turn - state.config.horde.warningLeadTurns) return;
  state.horde.warningDirections = selectHordeDirections(rng, wave.directionCount);
  state.horde.warningType = wave.final ? 'final' : 'periodic';
  emit(state, 'horde_warning', {
    waveIndex: state.horde.nextWaveIndex,
    spawnTurn: wave.turn,
    final: wave.final,
    directions: [...state.horde.warningDirections],
    hordeZombieCountPerDirection: wave.compositionPerDirection.hordeZombie,
    nonHordeSlotCountPerDirection: wave.compositionPerDirection.zombie,
    possibleNonHordeTypes: [...WAVE_NON_HORDE_TYPES],
  });
}

function processHorde(state: GameState, rng: SeededRng): ActionError | null {
  const due = state.horde.nextSpawnTurn !== null && state.turn === state.horde.nextSpawnTurn;
  if (!due) {
    state.horde.turnsRemaining = Math.max(0, (state.horde.nextSpawnTurn ?? state.turn) - state.turn);
    return null;
  }
  const waveIndex = state.horde.nextWaveIndex;
  const wave = waveIndex === null ? null : state.config.horde.waves[waveIndex - 1];
  if (waveIndex === null || !wave || state.horde.warningDirections.length !== wave.directionCount) {
    return error({ type: 'EndTurn' }, 'horde_spawn_technical_failure', 'Horde Wave warning directions are incomplete');
  }
  const kind = wave.final ? 'final' as const : 'periodic' as const;
  const allSpawned: UnitState[] = [];
  const groupIds: string[] = [];
  const rejectedBonuses: Array<{ direction: CardinalDirection; rejectedTotal: number; extraNormalZombies: number }> = [];
  for (const direction of state.horde.warningDirections) {
    const entrance = getHordeEntrance(state.map, direction);
    if (!entrance) {
      return error({ type: 'EndTurn' }, 'horde_spawn_technical_failure', `Missing Horde entrance for ${direction}`);
    }
    const groupId = `wave-${waveIndex}-${direction}`;
    const counters = state.rejectedRefugeesByDirection[direction];
    const rejectedTotal = counters.normalRejected + counters.strictRejected + counters.turnedAway;
    const extraNormalZombies = Math.ceil(rejectedTotal / 5);
    const composition = {
      hordeZombie: wave.compositionPerDirection.hordeZombie,
      zombie: wave.compositionPerDirection.zombie,
    };
    const spawned = spawnHordeComposition(
      state,
      entrance.tile,
      composition,
      extraNormalZombies,
      rng,
      wave.final ? 'final_horde' : 'periodic_horde',
      groupId,
      kind,
    );
    const expected = composition.hordeZombie + composition.zombie + extraNormalZombies;
    if (spawned.length !== expected) {
      return error({ type: 'EndTurn' }, 'horde_spawn_technical_failure', `Wave ${waveIndex} could not place every unit for ${direction}`);
    }
    groupIds.push(groupId);
    allSpawned.push(...spawned);
    rejectedBonuses.push({ direction, rejectedTotal, extraNormalZombies });
  }
  const hordeZombieCount = allSpawned.filter((unit) => unit.type === 'hordeZombie').length;
  const zombieCount = allSpawned.filter((unit) => unit.type === 'zombie').length;
  const policeZombieCount = allSpawned.filter((unit) => unit.type === 'policeZombie').length;
  const soldierZombieCount = allSpawned.filter((unit) => unit.type === 'soldierZombie').length;
  const riotZombieCount = allSpawned.filter((unit) => unit.type === 'riotZombie').length;
  const hunterZombieCount = allSpawned.filter((unit) => unit.type === 'hunterZombie').length;
  state.statistics.policeZombiesSpawned += policeZombieCount;
  state.statistics.soldierZombiesSpawned += soldierZombieCount;
  state.statistics.riotZombiesSpawned += riotZombieCount;
  state.statistics.hunterZombiesSpawned += hunterZombieCount;
  state.statistics.hordeSpecialSpawnedByType.policeZombie += policeZombieCount;
  state.statistics.hordeSpecialSpawnedByType.soldierZombie += soldierZombieCount;
  state.statistics.hordeSpecialSpawnedByType.riotZombie += riotZombieCount;
  state.statistics.hordeSpecialSpawnedByType.hunterZombie += hunterZombieCount;
  const count = allSpawned.length;
  state.horde.spawnedWaveIndices.push(waveIndex);
  state.horde.spawnGroupIdsByWave[String(waveIndex)] = groupIds;
  state.horde.totalSpawned += count;
  state.horde.lastSpawnTurn = state.turn;
  for (const bonus of rejectedBonuses) {
    const counters = state.rejectedRefugeesByDirection[bonus.direction];
    emit(state, 'horde_rejected_bonus_applied', {
      direction: bonus.direction,
      normalRejected: counters.normalRejected,
      strictRejected: counters.strictRejected,
      turnedAway: counters.turnedAway,
      rejectedTotal: bonus.rejectedTotal,
      extraNormalZombies: bonus.extraNormalZombies,
      waveIndex,
    });
    state.statistics.rejectedBonusZombiesByDirection[bonus.direction] += bonus.extraNormalZombies;
    state.statistics.rejectedCounterResetsByDirection[bonus.direction] += 1;
    counters.normalRejected = 0;
    counters.strictRejected = 0;
    counters.turnedAway = 0;
  }
  if (wave.final) {
    state.horde.finalSpawnGroupIds = [...groupIds];
    state.horde.finalSpawnedCount = count;
    state.horde.finalHordeStatus = 'active';
    state.statistics.finalHordeSpawned = count;
    state.statistics.finalHordeZombiesSpawned += hordeZombieCount;
    state.statistics.finalNormalZombiesSpawned += zombieCount;
    state.statistics.finalSpecialZombiesSpawnedByType.policeZombie += policeZombieCount;
    state.statistics.finalSpecialZombiesSpawnedByType.soldierZombie += soldierZombieCount;
    state.statistics.finalSpecialZombiesSpawnedByType.riotZombie += riotZombieCount;
    state.statistics.finalSpecialZombiesSpawnedByType.hunterZombie += hunterZombieCount;
    for (const branch of state.roadBranches) branch.nextArrivalTurn = null;
    emit(state, 'refugee_arrivals_ended', { finalWaveIndex: waveIndex, spawnTurn: state.turn });
  } else {
    state.statistics.periodicHordeZombiesSpawned += hordeZombieCount;
    state.statistics.periodicNormalZombiesSpawned += zombieCount;
  }
  emit(state, 'horde_spawned', {
    hordeKind: kind,
    waveIndex,
    spawnTurn: wave.turn,
    final: wave.final,
    directions: [...state.horde.warningDirections],
    compositionPerDirection: { ...wave.compositionPerDirection },
    spawnGroupIds: [...groupIds],
    hordeZombieCount,
    normalZombieCount: zombieCount,
    policeZombieCount,
    soldierZombieCount,
    riotZombieCount,
    hunterZombieCount,
    units: allSpawned.map((unit) => ({
      unitId: unit.id,
      unitType: unit.type,
      spawnGroupId: unit.spawnGroupId,
      hordeKind: kind,
      q: unit.position.q,
      r: unit.position.r,
    })),
  });
  const nextWave = state.config.horde.waves[waveIndex];
  state.horde.nextWaveIndex = nextWave ? waveIndex + 1 : null;
  state.horde.nextSpawnTurn = nextWave?.turn ?? null;
  state.horde.turnsRemaining = nextWave ? Math.max(0, nextWave.turn - state.turn) : 0;
  state.horde.warningDirections = [];
  state.horde.warningType = 'none';
  beginHordeWarningIfDue(state, rng);
  return null;
}

function finishGame(state: GameState, outcome: 'won' | 'lost', reason: GameOverReason): void {
  if (state.gameOver) return;
  synchronizePopulation(state);
  state.statistics.policeZombiesFinal = state.units.filter((unit) => unit.type === 'policeZombie').length;
  state.statistics.soldierZombiesFinal = state.units.filter((unit) => unit.type === 'soldierZombie').length;
  state.statistics.riotZombiesFinal = state.units.filter((unit) => unit.type === 'riotZombie').length;
  state.statistics.hunterZombiesFinal = state.units.filter((unit) => unit.type === 'hunterZombie').length;
  state.gameOver = true;
  state.phase = 'gameOver';
  state.result = { outcome, reason, turn: state.turn, statistics: JSON.parse(JSON.stringify(state.statistics)) as GameState['statistics'] };
  emit(state, 'game_over', { outcome, reason });
}

function checkImmediateDefeat(state: GameState): boolean {
  const capital = getFacilityState(state, 'capital');
  if (capital?.status === 'ruined') {
    finishGame(state, 'lost', 'capitalLost');
    return true;
  }
  synchronizePopulation(state);
  if (civilianWorkerCount(state) === 0) {
    finishGame(state, 'lost', 'healthyCiviliansLost');
    return true;
  }
  return false;
}

export interface VictoryProgress {
  finalHordeDefeated: boolean;
  suppliedAreaZombieClear: boolean;
  suppliedAreaInfectionClear: boolean;
}

export function deriveVictoryProgress(state: Readonly<GameState>): VictoryProgress {
  const supplied = new Set(getSuppliedTileKeys(state));
  const finalHordeDefeated =
    state.horde.finalSpawnGroupIds.length > 0 &&
    !state.units.some(
      (unit) => unit.spawnGroupId !== null && state.horde.finalSpawnGroupIds.includes(unit.spawnGroupId),
    );
  const suppliedAreaZombieClear = !state.units.some(
    (unit) =>
      isZombieFaction(unit) &&
      supplied.has(hexKey(unit.position)),
  );
  const suppliedAreaInfectionClear =
    !state.facilities.some((facility) => supplied.has(hexKey(facility.position)) && facility.infected > 0) &&
    !state.checkpoints.some((checkpoint) => supplied.has(hexKey(checkpoint.position)) && checkpoint.infected > 0);
  return { finalHordeDefeated, suppliedAreaZombieClear, suppliedAreaInfectionClear };
}

function emitPlayerKnowledgeChanges(before: Readonly<GameState>, after: GameState): void {
  const beforeVisible = new Map(getVisibleEnemyUnits(before).map((unit) => [unit.id, unit] as const));
  const afterVisible = new Map(getVisibleEnemyUnits(after).map((unit) => [unit.id, unit] as const));
  for (const [id, unit] of afterVisible) {
    if (!beforeVisible.has(id)) {
      emit(after, 'enemy_spotted', { unitId: id, unitType: unit.type, q: unit.position.q, r: unit.position.r });
    }
  }
  const survivingEnemyIds = new Set(
    after.units.filter((unit) => !unit.isPlayerUnit).map((unit) => unit.id),
  );
  for (const [id, unit] of beforeVisible) {
    if (!afterVisible.has(id) && survivingEnemyIds.has(id)) {
      emit(after, 'enemy_lost', { unitId: id, unitType: unit.type, q: unit.position.q, r: unit.position.r });
    }
  }

  const previousProgress = deriveVictoryProgress(before);
  const currentProgress = deriveVictoryProgress(after);
  if (
    previousProgress.finalHordeDefeated !== currentProgress.finalHordeDefeated ||
    previousProgress.suppliedAreaZombieClear !== currentProgress.suppliedAreaZombieClear ||
    previousProgress.suppliedAreaInfectionClear !== currentProgress.suppliedAreaInfectionClear
  ) {
    emit(after, 'victory_progress_changed', { ...currentProgress });
  }
}

function checkImmediateGameEnd(state: GameState): boolean {
  if (checkImmediateDefeat(state)) return true;
  const progress = deriveVictoryProgress(state);
  if (progress.finalHordeDefeated && state.horde.finalHordeStatus !== 'defeated') {
    state.horde.finalHordeStatus = 'defeated';
    state.statistics.finalHordeDefeated = true;
  }
  if (progress.suppliedAreaZombieClear && state.statistics.suppliedAreaZombieClearTurn === null) {
    state.statistics.suppliedAreaZombieClearTurn = state.turn;
  }
  if (progress.suppliedAreaInfectionClear && state.statistics.suppliedAreaInfectionClearTurn === null) {
    state.statistics.suppliedAreaInfectionClearTurn = state.turn;
  }
  if (progress.finalHordeDefeated && progress.suppliedAreaZombieClear && progress.suppliedAreaInfectionClear) {
    state.statistics.victoryTurn = state.turn;
    finishGame(state, 'won', 'stateSecured');
    return true;
  }
  return false;
}

function startPlayerTurn(state: GameState, rng: SeededRng): void {
  beginHordeWarningIfDue(state, rng);
  for (const unit of state.units.filter(isHumanUnit).sort((left, right) => left.id.localeCompare(right.id))) {
    if (unit.proficiency === 'regular' && unit.veteranPromotionPending) {
      unit.proficiency = 'veteran';
      unit.veteranPromotionPending = false;
      unit.maxAttackCharges = state.config.unitExperience.veteranAttackCharges;
      state.statistics.veteranPromotionsByType[unit.type] += 1;
      emit(state, 'unit_promoted', {
        unitId: unit.id, unitType: unit.type, from: 'regular', into: 'veteran',
        turn: state.turn, reason: 'zombie_kills',
      });
    } else if (unit.proficiency === 'recruit') {
      unit.recruitSurvivalTurns += 1;
      if (unit.recruitSurvivalTurns >= state.config.unitExperience.recruitSurvivalTurnsRequired) {
        unit.proficiency = 'regular';
        unit.attack = effectiveAttackForProficiency(state, unit.type, 'regular');
        unit.regularZombieKills = 0;
        unit.maxAttackCharges = 1;
        state.statistics.regularPromotionsByType[unit.type] += 1;
        emit(state, 'unit_promoted', {
          unitId: unit.id, unitType: unit.type, from: 'recruit', into: 'regular',
          turn: state.turn, reason: 'survival',
        });
      }
    }
  }
  for (const branch of state.roadBranches) branch.checkpointActionsThisTurn = 0;
  for (const facility of state.facilities) {
    if (facility.operationalStatus === 'building' && facility.builtTurn !== null && facility.builtTurn < state.turn) {
      facility.operationalStatus = facility.workers > 0 ? 'operational' : 'stopped';
      facility.populationOperationalTurn = state.turn;
      facility.powerSupplyEnabled = ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type);
    } else if (
      facility.operationalStatus === 'recovering' &&
      facility.recoveryOperationalTurn !== null &&
      facility.recoveryOperationalTurn <= state.turn
    ) {
      facility.operationalStatus = facility.type === 'windPowerPlant' || facility.workers > 0 ? 'operational' : 'stopped';
      facility.populationOperationalTurn = state.turn;
      facility.powerSupplyEnabled = ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type);
      facility.recoveryOperationalTurn = null;
    }
  }
  for (const unit of state.units.filter((candidate) => candidate.isPlayerUnit)) {
    const recovery = deriveUnitRecovery(state, unit);
    if (recovery.recoveryClass !== 'outOfSupply' && unit.hp < unit.maxHp) {
      const beforeHp = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + recovery.baseAmount);
      const actualAmount = unit.hp - beforeHp;
      if (actualAmount > 0) {
        emit(state, 'unit_recovered', {
          unitId: unit.id,
          unitType: unit.type,
          beforeHp,
          baseAmount: recovery.baseAmount,
          actualAmount,
          afterHp: unit.hp,
          recoveryClass: recovery.recoveryClass,
          rate: recovery.rate,
          inSupply: true,
        });
      }
    } else if (unit.hp < unit.maxHp && recovery.recoveryClass === 'outOfSupply') {
      emit(state, 'supply_action_rejected', { unitId: unit.id, reason: 'recovery_out_of_supply' });
    }
    unit.actionState = 'ready';
    unit.canMove = true;
    unit.canAttack = true;
    unit.attackChargesRemaining = unit.maxAttackCharges;
    unit.activity = { moved: false, attacked: false, intercepted: false, suppressed: false };
  }
  for (const zombie of state.units.filter(isZombieFaction)) {
    zombie.canAttack = true;
    zombie.maxAttackCharges = state.config.units[zombie.type as ZombieUnitType].maxAttackCharges;
    zombie.attackChargesRemaining = zombie.maxAttackCharges;
  }
  const orders = [...state.pendingUnitProductions].sort((left, right) => left.id.localeCompare(right.id));
  state.pendingUnitProductions = [];
  const commissioned: UnitState[] = [];
  for (const order of orders) {
    if (order.readyTurn > state.turn) {
      state.pendingUnitProductions.push(order);
      continue;
    }
    const city = getFacilityState(state, order.cityFacilityId);
    if (!city || city.owner !== 'player' || city.status !== 'owned') {
      state.pendingUnitProductions.push(order);
      continue;
    }
    const nearestPositions = findNearestOpenTiles(state.map, city.position, occupiedKeys(state))
      .filter((position) => canPlayerOccupyHex(state.map, position));
    const position = nearestPositions.length > 1 ? rng.pick(nearestPositions) : nearestPositions[0];
    if (!position) {
      state.pendingUnitProductions.push(order);
      continue;
    }
    const productionProficiency = state.config.unitExperience.productionProficiencyByType[order.unitType];
    const unit = createUnit(
      state,
      nextHumanUnitId(state, order.unitType),
      order.unitType,
      position,
      'ready',
      productionProficiency,
    );
    unit.currentFuel = 0;
    state.units.push(unit);
    commissioned.push(unit);
    if (productionProficiency === 'recruit') state.statistics.recruitsCommissionedByType[order.unitType] += 1;
    if (order.unitType === 'riotPolice') {
      state.statistics.riotPoliceProduced += 1;
      emit(state, 'riot_police_commissioned', { unitId: unit.id, cityFacilityId: city.id, proficiency: unit.proficiency });
    }
  }
  const commissioningDemand = new Map(commissioned.sort((left, right) => left.id.localeCompare(right.id)).map((unit) => [unit.id, unit.maxFuel]));
  while (state.resources.fuel > 0 && [...commissioningDemand.values()].some((amount) => amount > 0)) {
    for (const unit of commissioned) {
      if (state.resources.fuel <= 0) break;
      const remaining = commissioningDemand.get(unit.id) ?? 0;
      if (remaining <= 0) continue;
      commissioningDemand.set(unit.id, remaining - 1);
      unit.currentFuel += 1;
      state.resources.fuel -= 1;
    }
  }
  createCityPopulationSnapshot(state);
  placeApprovedRefugees(state);
  resolveCheckpointRemnants(state);
  synchronizePopulation(state);
  const coverage = getPlayerVisionCoverage(state);
  state.statistics.groundVisionPotentialHexes = coverage.groundPotential.size;
  state.statistics.groundVisionVisibleHexes = coverage.groundVisible.size;
  state.statistics.groundVisionBlockedHexes = coverage.groundBlocked.size;
  state.statistics.maxGroundVisionBlockedHexes = Math.max(state.statistics.maxGroundVisionBlockedHexes, coverage.groundBlocked.size);
  state.statistics.cumulativeGroundVisionBlockedHexes += coverage.groundBlocked.size;
  state.statistics.groundVisionSamples += 1;
  state.statistics.maxCivilianDroneVisionRadius = Math.max(
    state.statistics.maxCivilianDroneVisionRadius,
    ...state.facilities.filter((facility) => facility.type === 'civilianDroneBase').map((facility) => facility.workers * 3),
  );
  const previouslyDiscovered = new Set(state.events
    .filter((event) => event.type === 'aerial_enemy_discovered' && typeof event.payload.unitId === 'string')
    .map((event) => event.payload.unitId as string));
  const aerialDiscoveries = state.units.filter((unit) =>
    !unit.isPlayerUnit
      && !previouslyDiscovered.has(unit.id)
      && coverage.groundBlocked.has(hexKey(unit.position))
      && coverage.aerialVisible.has(hexKey(unit.position)),
  );
  for (const unit of aerialDiscoveries) {
    emit(state, 'aerial_enemy_discovered', { unitId: unit.id });
  }
  state.statistics.aerialDiscoveriesInGroundBlockedArea += aerialDiscoveries.length;
  checkImmediateGameEnd(state);
  saveRng(state, rng);
}

function endTurn(state: GameState, rng: SeededRng): ActionError | null {
  state.phase = 'economy';
  processEconomy(state);
  if (checkImmediateGameEnd(state)) return null;
  state.phase = 'refugees';
  processRefugees(state, rng);
  synchronizePopulation(state);
  if (checkImmediateGameEnd(state)) return null;
  state.phase = 'infection';
  processInternalInfection(state, rng);
  if (checkImmediateGameEnd(state)) return null;
  state.phase = 'zombie';
  processZombieTurn(state, rng);
  if (checkImmediateGameEnd(state)) return null;
  processZombieInfection(state, rng);
  if (checkImmediateGameEnd(state)) return null;
  state.phase = 'horde';
  const hordeError = processHorde(state, rng);
  if (hordeError) return hordeError;
  if (checkImmediateGameEnd(state)) return null;
  state.turn += 1;
  if (state.turn > state.finalHordeTurn) state.statistics.turnsAfterFinalHorde += 1;
  state.actionsTakenThisTurn = 0;
  state.phase = 'player';
  state.horde.turnsRemaining = state.horde.nextSpawnTurn === null
    ? 0
    : Math.max(0, state.horde.nextSpawnTurn - state.turn);
  startPlayerTurn(state, rng);
  return null;
}

function playerActionBudgetError(state: Readonly<GameState>, action: GameAction): ActionError | null {
  if (!isPlayerPhase(state)) return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) {
    return error(action, 'action_limit', 'The action limit for this turn has been reached');
  }
  return null;
}

function validateAssignWorkers(state: Readonly<GameState>, action: Extract<GameAction, { type: 'AssignWorkers' }>) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const facility = getFacilityState(state, action.facilityId);
  if (
    !facility ||
    facility.owner !== 'player' ||
    facility.status !== 'owned' ||
    !isProductionFacility(facility)
  ) return error(action, 'invalid_facility', 'Only an owned production facility can receive workers');
  if (!Number.isInteger(action.workers) || action.workers < 0 || action.workers > facility.workerCapacity) return error(action, 'invalid_workers', 'Worker count is outside capacity');
  if (facility.infected > 0) return error(action, 'infected_facility', 'Workers cannot be moved into or out of an infected facility');
  if (facility.populationOperationalTurn > state.turn) {
    return error(action, 'facility_not_yet_operational', 'Newly secured or recovered facilities become available next turn');
  }
  if (['building', 'disabled', 'recovering'].includes(facility.operationalStatus)) {
    return error(action, 'facility_not_operational', 'This facility is not currently operational');
  }
  const difference = action.workers - facility.workers;
  if (difference === 0) return error(action, 'no_change', 'Worker assignment is unchanged');
  if (difference > 0) {
    if (!isHexSupplied(state, facility.position)) {
      return error(action, 'facility_out_of_supply', 'Workers cannot be added outside the supply network');
    }
    if (availableSupplyPopulation(state) < difference) {
      return error(action, 'insufficient_city_population', 'Eligible cities cannot supply enough population');
    }
  } else {
    if (eligibleSnapshotCities(state, 'reception').length === 0) {
      return error(action, 'no_safe_return_city', 'No eligible safe city can receive withdrawn workers');
    }
  }
  return { facility, difference };
}

function assignWorkers(state: GameState, action: Extract<GameAction, { type: 'AssignWorkers' }>): ActionError | null {
  const validation = validateAssignWorkers(state, action);
  if ('code' in validation) return validation;
  const { facility, difference } = validation;
  const movements = difference > 0 ? withdrawFromSupplyCities(state, difference) : distributeToReceptionCities(state, -difference);
  if (!movements) return error(action, 'population_move_failed', 'Population movement could not be completed');
  facility.workers = action.workers;
  facility.operationalStatus = action.workers > 0 ? 'operational' : 'stopped';
  facility.lastAssignedOrder = state.nextAssignmentOrder++;
  state.actionsTakenThisTurn += 1;
  emit(state, 'workers_assigned', {
    facilityId: facility.id,
    workers: action.workers,
    difference,
    movements,
  });
  synchronizePopulation(state);
  return null;
}

function validateTransferPopulation(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'TransferPopulation' }>,
) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  if (!Number.isInteger(action.people) || action.people <= 0) {
    return error(action, 'invalid_population', 'Population transfer must be a positive integer');
  }
  if (action.fromFacilityId === action.toFacilityId) {
    return error(action, 'same_city', 'Population transfer requires two different cities');
  }
  const eligible = new Set(eligibleSnapshotCities(state, 'supply').map((city) => city.id));
  const from = getFacilityState(state, action.fromFacilityId);
  const to = getFacilityState(state, action.toFacilityId);
  if (!from || !to || !eligible.has(from.id) || !eligible.has(to.id)) {
    return error(action, 'ineligible_city', 'Both cities must be safe and eligible in the turn-start snapshot');
  }
  if (from.workers < action.people) {
    return error(action, 'insufficient_city_population', 'The source city does not have enough residents');
  }
  return { from, to };
}

function transferPopulation(
  state: GameState,
  action: Extract<GameAction, { type: 'TransferPopulation' }>,
): ActionError | null {
  const validation = validateTransferPopulation(state, action);
  if ('code' in validation) return validation;
  const { from, to } = validation;
  from.workers -= action.people;
  to.workers += action.people;
  state.actionsTakenThisTurn += 1;
  emit(state, 'population_transferred', {
    from: from.id,
    to: to.id,
    people: action.people,
    reason: 'city_transfer',
  });
  synchronizePopulation(state);
  return null;
}

function checkpointBranchId(
  state: Readonly<GameState>,
  position: HexCoord,
  requestedBranchId?: string,
): string | null {
  const branchId = getBranchIdAt(state.map, position);
  if (!branchId || (requestedBranchId !== undefined && requestedBranchId !== branchId)) return null;
  return branchId;
}

function checkpointDirection(state: Readonly<GameState>, branchId: string): CardinalDirection | null {
  return getRoadBranch(state.map, branchId)?.direction ?? null;
}

function checkpointForwardBlockers(state: Readonly<GameState>, branchId: string): CheckpointState[] {
  return state.checkpoints.filter(
    (checkpoint) =>
      (checkpoint.branchId ?? checkpoint.direction) === branchId &&
      ['ruined', 'abandoned'].includes(checkpoint.status) &&
      checkpoint.infected > 0,
  );
}

function validateCheckpointVisibility(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' }>,
  branchId: string,
  visibleTileKeys?: ReadonlySet<string>,
): ActionError | null {
  const visibility = getCheckpointRouteVisibility(state, branchId, action.position, visibleTileKeys);
  if (!visibility.targetVisible) {
    return error(action, 'checkpoint_target_not_visible', 'The checkpoint destination is outside current Player Vision');
  }
  if (!visibility.routeVisible) {
    return error(action, 'checkpoint_route_not_visible', 'The road corridor from the capital to this destination is not fully visible');
  }
  return null;
}

function validateCheckpointDestination(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' }>,
  branchId: string,
  ignoredCheckpointId?: string,
  visibleZombies?: readonly UnitState[],
  visibleTileKeys?: ReadonlySet<string>,
  visibilityAlreadyValidated = false,
): ActionError | null {
  if (!visibilityAlreadyValidated) {
    const visibilityError = validateCheckpointVisibility(state, action, branchId, visibleTileKeys);
    if (visibilityError) return visibilityError;
  }
  const tile = getTile(state.map, action.position);
  if (isHordeSpawnReserve(state.map, action.position)) {
    return error(action, 'horde_spawn_reserve', 'Player checkpoints cannot occupy the Horde Spawn Reserve');
  }
  if (!tile?.road || state.checkpoints.some(
    (checkpoint) => checkpoint.id !== ignoredCheckpointId && hexKey(checkpoint.position) === hexKey(action.position),
  ) || state.units.some(
    (unit) => unit.isPlayerUnit && hexKey(unit.position) === hexKey(action.position),
  )) {
    return error(action, 'invalid_checkpoint_tile', 'A checkpoint requires an empty branch road tile');
  }
  if (tile.facilityId || state.facilities.some(
    (facility) => hexKey(facility.position) === hexKey(action.position),
  )) {
    return error(action, 'checkpoint_facility_occupied', 'A Facility occupies this checkpoint destination');
  }
  if (checkpointBranchId(state, action.position, action.branchId) !== branchId) {
    return error(action, 'invalid_checkpoint_branch', 'Checkpoint destination must be on the selected road branch');
  }
  const branchState = getRoadBranchState(state, branchId);
  if (!branchState) return error(action, 'unknown_road_branch', 'Unknown road branch');
  if (branchState.checkpointActionsThisTurn >= 1) {
    return error(action, 'checkpoint_branch_action_limit', 'This branch already built or relocated a checkpoint this turn');
  }
  const capital = getCapitalPosition(state.map);
  const destinationDistance = hexDistance(capital, action.position);
  const forwardBlocker = checkpointForwardBlockers(state, branchId).find(
    (checkpoint) => destinationDistance >= hexDistance(capital, checkpoint.position),
  );
  if (forwardBlocker) {
    return error(action, 'checkpoint_abandoned_forward_block', 'An infected ruined or abandoned site only permits a position closer to the capital');
  }
  const zombies = (visibleZombies ?? state.units
    .filter(isZombieFaction)
    .filter((zombie) => isVisibleToPlayer(state, zombie.position)))
    .filter((zombie) =>
      getBlockingZombiesForCheckpoint(state, branchId, action.position).some((candidate) => candidate.id === zombie.id),
    );
  if (zombies.length > 0) {
    return error(action, 'checkpoint_supply_zombie_blocked', 'A visible Zombie blocks this checkpoint position or supply area');
  }
  const cost = action.type === 'RelocateCheckpoint'
    ? state.config.checkpoint.relocationCivilianGoods
    : getCheckpointBuildCost(state, branchId);
  if (state.resources.civilianGoods < cost) {
    return error(action, 'insufficient_civilian_goods', 'Not enough civilian goods');
  }
  return null;
}

export function getCheckpointBuildCost(state: Readonly<GameState>, branchId: string): number {
  const branch = getRoadBranchState(state, branchId);
  return branch?.hasBuiltCheckpoint
    ? state.config.checkpoint.subsequentConstructionCivilianGoods
    : state.config.checkpoint.constructionCivilianGoods;
}

function validateBuildCheckpointAction(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildCheckpoint' }>,
  visibleZombies?: readonly UnitState[],
  visibleTileKeys?: ReadonlySet<string>,
): { branchId: string | null; error: ActionError | null } {
  const budget = playerActionBudgetError(state, action);
  if (budget) return { branchId: null, error: budget };
  const branchId = checkpointBranchId(state, action.position, action.branchId);
  if (!branchId) {
    return {
      branchId: null,
      error: error(action, 'invalid_checkpoint_branch', 'Checkpoint tile must belong to one road branch'),
    };
  }
  const branch = getRoadBranchState(state, branchId);
  if (!branch) return { branchId, error: error(action, 'unknown_road_branch', 'Unknown road branch') };
  const visibilityError = validateCheckpointVisibility(state, action, branchId, visibleTileKeys);
  if (visibilityError) return { branchId, error: visibilityError };
  const active = activeCheckpointForBranch(state, branchId);
  if (preparedCheckpointCount(state, branchId) >= state.config.checkpoint.maxPreparedPostsPerDirection) {
    return {
      branchId,
      error: error(action, 'checkpoint_prepared_post_limit_reached', 'This branch already has the maximum prepared checkpoint posts'),
    };
  }
  if (active) {
    if (checkpointBranchIndex(state, branchId, action.position) >= checkpointBranchIndex(state, branchId, active.position)) {
      return {
        branchId,
        error: error(action, 'checkpoint_standby_requires_rear_position', 'A standby checkpoint must be closer to the capital than the active checkpoint'),
      };
    }
  }
  return {
    branchId,
    error: validateCheckpointDestination(state, action, branchId, undefined, visibleZombies, visibleTileKeys, true),
  };
}

function validateRelocateCheckpointAction(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'RelocateCheckpoint' }>,
  visibleZombies?: readonly UnitState[],
  visibleTileKeys?: ReadonlySet<string>,
): { source: CheckpointState | null; branchId: string | null; error: ActionError | null } {
  const budget = playerActionBudgetError(state, action);
  if (budget) return { source: null, branchId: null, error: budget };
  const source = state.checkpoints.find((checkpoint) => checkpoint.id === action.checkpointId);
  const sourceBranchId = source ? source.branchId ?? source.direction : null;
  const sourceBranch = sourceBranchId ? getRoadBranchState(state, sourceBranchId) : undefined;
  if (!source || source.status !== 'operational' || sourceBranch?.activeCheckpointId !== source.id) {
    return {
      source: null,
      branchId: null,
      error: error(action, 'unknown_operational_checkpoint', 'Relocation requires an operational checkpoint'),
    };
  }
  if (hexKey(source.position) === hexKey(action.position)) {
    return {
      source,
      branchId: source.branchId ?? source.direction,
      error: error(action, 'checkpoint_same_position', 'Relocation requires a different road tile'),
    };
  }
  const branchId = source.branchId ?? source.direction;
  if (checkpointBranchId(state, action.position, action.branchId) !== branchId) {
    return {
      source,
      branchId,
      error: error(action, 'checkpoint_wrong_branch', 'A checkpoint can only relocate on its current branch'),
    };
  }
  const visibilityError = validateCheckpointVisibility(state, action, branchId, visibleTileKeys);
  if (visibilityError) return { source, branchId, error: visibilityError };
  if (source.infected > 0) {
    return {
      source,
      branchId,
      error: error(action, 'checkpoint_infection_blocked', 'The active checkpoint must be cleared before relocation'),
    };
  }
  return {
    source,
    branchId,
    error: validateCheckpointDestination(state, action, branchId, source.id, visibleZombies, visibleTileKeys, true),
  };
}

function createOperationalCheckpoint(
  state: GameState,
  branchId: string,
  position: HexCoord,
  role: 'active' | 'standby',
): CheckpointState {
  const direction = checkpointDirection(state, branchId);
  if (!direction) throw new Error(`Unknown checkpoint branch: ${branchId}`);
  const branch = getRoadBranchState(state, branchId);
  const checkpoint: CheckpointState = {
    id: `checkpoint-${branchId}-${state.nextCheckpointNumber++}`,
    position: { ...position },
    direction,
    branchId,
    status: 'operational',
    waiting: 0,
    screening: 0,
    approved: 0,
    remainingTurns: 0,
    screeningPolicy: 'normal',
    nextArrivalTurn: branch?.nextArrivalTurn ?? null,
    infected: 0,
    overrunProcessed: false,
  };
  state.checkpoints.push(checkpoint);
  if (branch && role === 'active') branch.activeCheckpointId = checkpoint.id;
  if (branch && role === 'standby') branch.standbyCheckpointIds.push(checkpoint.id);
  return checkpoint;
}

function emitSupplyChanged(
  state: GameState,
  branchId: string,
  beforeKeys: readonly string[],
  reason: string,
): void {
  const afterKeys = getSuppliedTileKeys(state);
  if (beforeKeys.length === afterKeys.length && beforeKeys.every((key, index) => key === afterKeys[index])) return;
  if (afterKeys.length < beforeKeys.length) state.statistics.supplyLosses += 1;
  emit(state, 'supply_changed', {
    branchId,
    reason,
    beforeTileCount: beforeKeys.length,
    afterTileCount: afterKeys.length,
    radius: getBranchSupplyRadius(state, branchId),
  });
}

function buildCheckpoint(state: GameState, action: Extract<GameAction, { type: 'BuildCheckpoint' }>): ActionError | null {
  const validation = validateBuildCheckpointAction(state, action);
  if (validation.error) return validation.error;
  const branchId = validation.branchId!;
  const branch = getRoadBranchState(state, branchId);
  const role = branch?.activeCheckpointId ? 'standby' as const : 'active' as const;
  const beforeSupply = getSuppliedTileKeys(state);
  const cost = getCheckpointBuildCost(state, branchId);
  state.resources.civilianGoods -= cost;
  const ruined = state.checkpoints.filter(
    (checkpoint) =>
      checkpoint.status === 'ruined' &&
      (checkpoint.branchId ?? checkpoint.direction) === branchId,
  );
  const checkpoint = createOperationalCheckpoint(state, branchId, action.position, role);
  if (role === 'active') {
    for (const old of ruined) {
      old.status = 'abandoned';
      state.statistics.checkpointsAbandoned += 1;
      emit(state, 'checkpoint_abandoned', { checkpointId: old.id, branchId, replacementId: checkpoint.id });
    }
  }
  if (branch) {
    branch.checkpointActionsThisTurn += 1;
    branch.hasBuiltCheckpoint = true;
  }
  state.actionsTakenThisTurn += 1;
  state.statistics.checkpointsBuilt += 1;
  if (role === 'standby') state.statistics.standbyCheckpointsCreated += 1;
  if (role === 'active' && ruined.length > 0) {
    state.statistics.checkpointRetreats += 1;
  }
  emit(state, 'checkpoint_built', {
    checkpointId: checkpoint.id,
    branchId,
    direction: checkpoint.direction,
    role,
    civilianGoods: cost,
    retreat: role === 'active' && ruined.length > 0,
  });
  if (role === 'active') {
    emitSupplyChanged(state, branchId, beforeSupply, ruined.length > 0 ? 'checkpoint_retreat' : 'checkpoint_built');
  }
  return null;
}

function relocateCheckpoint(
  state: GameState,
  action: Extract<GameAction, { type: 'RelocateCheckpoint' }>,
): ActionError | null {
  const validation = validateRelocateCheckpointAction(state, action);
  if (validation.error) return validation.error;
  const source = validation.source!;
  const branchId = validation.branchId!;
  const beforeSupply = getSuppliedTileKeys(state);
  state.resources.civilianGoods -= state.config.checkpoint.relocationCivilianGoods;
  const branch = getRoadBranchState(state, branchId);
  if (branch) {
    branch.activeCheckpointId = null;
    branch.standbyCheckpointIds = branch.standbyCheckpointIds.filter((id) => id !== source.id);
  }
  const replacement = createOperationalCheckpoint(state, branchId, action.position, 'active');
  const sourceBecomesRemnant = totalCheckpointPeople(source) > 0 || source.infected > 0 || checkpointHasZombie(state, source);
  let sourceRole: 'remnant' | 'standby' | 'dormant';
  if (sourceBecomesRemnant) {
    source.status = 'remnant';
    sourceRole = 'remnant';
  } else {
    sourceRole = assignOperationalReserveRole(state, source);
    if (sourceRole === 'standby') state.statistics.standbyCheckpointsCreated += 1;
    else state.statistics.dormantCheckpointsCreated += 1;
  }
  if (branch) branch.checkpointActionsThisTurn += 1;
  state.actionsTakenThisTurn += 1;
  state.statistics.checkpointsRelocated += 1;
  if (sourceRole === 'remnant') {
    emit(state, 'checkpoint_remnant_created', {
      checkpointId: source.id,
      branchId,
      replacementId: replacement.id,
    });
  } else {
    emit(state, 'checkpoint_role_changed', {
      checkpointId: source.id,
      branchId,
      fromRole: 'active',
      toRole: sourceRole,
      reason: 'checkpoint_relocated',
    });
  }
  emit(state, 'checkpoint_relocated', {
    checkpointId: replacement.id,
    sourceCheckpointId: source.id,
    branchId,
    sourceRole,
    civilianGoods: state.config.checkpoint.relocationCivilianGoods,
  });
  resolveCheckpointRemnants(state);
  emitSupplyChanged(state, branchId, beforeSupply, 'checkpoint_relocated');
  return null;
}

function validateActivateCheckpointAction(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'ActivateCheckpoint' }>,
  visibleZombies?: readonly UnitState[],
): { target: CheckpointState | null; branchId: string | null; error: ActionError | null } {
  const budget = playerActionBudgetError(state, action);
  if (budget) return { target: null, branchId: null, error: budget };
  const branch = getRoadBranchState(state, action.branchId);
  if (!branch) return { target: null, branchId: null, error: error(action, 'unknown_road_branch', 'Unknown road branch') };
  if (branch.checkpointActionsThisTurn >= 1) {
    return { target: null, branchId: action.branchId, error: error(action, 'checkpoint_branch_action_limit', 'This branch already changed checkpoints this turn') };
  }
  const target = state.checkpoints.find((checkpoint) => checkpoint.id === action.checkpointId);
  if (!target || (target.branchId ?? target.direction) !== action.branchId || target.status !== 'operational') {
    return { target: null, branchId: action.branchId, error: error(action, 'unknown_operational_checkpoint', 'Activation requires an operational checkpoint on this branch') };
  }
  const role = deriveCheckpointRole(state, target);
  if (role !== 'standby' && role !== 'dormant') {
    return { target, branchId: action.branchId, error: error(action, 'checkpoint_not_activatable', 'Only a standby or dormant checkpoint can be activated') };
  }
  const visibleZombieOnTarget = (visibleZombies ?? state.units.filter(
    (unit) =>
      isZombieFaction(unit) &&
      isVisibleToPlayer(state, unit.position),
  )).some(
    (unit) =>
      isZombieFaction(unit) &&
      hexKey(unit.position) === hexKey(target.position) &&
      (visibleZombies !== undefined || isVisibleToPlayer(state, unit.position)),
  );
  if (visibleZombieOnTarget) {
    return { target, branchId: action.branchId, error: error(action, 'checkpoint_supply_zombie_blocked', 'A visible Zombie occupies this checkpoint') };
  }
  const active = activeCheckpointForBranch(state, action.branchId);
  if (
    active &&
    checkpointBranchIndex(state, action.branchId, target.position) > checkpointBranchIndex(state, action.branchId, active.position) &&
    getBlockingZombiesForCheckpoint(state, action.branchId, target.position).some((zombie) =>
      visibleZombies
        ? visibleZombies.some((visible) => visible.id === zombie.id)
        : isVisibleToPlayer(state, zombie.position))
  ) {
    return { target, branchId: action.branchId, error: error(action, 'checkpoint_supply_zombie_blocked', 'A visible Zombie blocks forward supply expansion') };
  }
  return { target, branchId: action.branchId, error: null };
}

function activateCheckpoint(
  state: GameState,
  action: Extract<GameAction, { type: 'ActivateCheckpoint' }>,
): ActionError | null {
  const validation = validateActivateCheckpointAction(state, action);
  if (validation.error) return validation.error;
  const branchId = validation.branchId!;
  const branch = getRoadBranchState(state, branchId)!;
  const target = validation.target!;
  const beforeSupply = getSuppliedTileKeys(state);
  const previousRole = deriveCheckpointRole(state, target);
  const oldActive = activeCheckpointForBranch(state, branchId);
  branch.standbyCheckpointIds = branch.standbyCheckpointIds.filter((id) => id !== target.id);
  branch.activeCheckpointId = target.id;
  let oldActiveRole: 'none' | 'remnant' | 'standby' | 'dormant' = 'none';
  if (oldActive && oldActive.id !== target.id) {
    if (totalCheckpointPeople(oldActive) > 0 || oldActive.infected > 0 || checkpointHasZombie(state, oldActive)) {
      oldActive.status = 'remnant';
      oldActiveRole = 'remnant';
      emit(state, 'checkpoint_remnant_created', { checkpointId: oldActive.id, branchId, replacementId: target.id });
    } else {
      oldActiveRole = assignOperationalReserveRole(state, oldActive);
      if (oldActiveRole === 'standby') state.statistics.standbyCheckpointsCreated += 1;
      else state.statistics.dormantCheckpointsCreated += 1;
    }
    emit(state, 'checkpoint_role_changed', {
      checkpointId: oldActive.id,
      branchId,
      fromRole: 'active',
      toRole: oldActiveRole,
      reason: 'checkpoint_activated',
    });
  }
  branch.checkpointActionsThisTurn += 1;
  state.actionsTakenThisTurn += 1;
  state.statistics.checkpointActivations += 1;
  emit(state, 'checkpoint_activated', {
    checkpointId: target.id,
    branchId,
    fromRole: previousRole,
    previousActiveCheckpointId: oldActive?.id ?? null,
    previousActiveRole: oldActiveRole,
  });
  emitSupplyChanged(state, branchId, beforeSupply, 'checkpoint_activated');
  return null;
}

function validateSetCheckpointPolicy(state: Readonly<GameState>, action: Extract<GameAction, { type: 'SetCheckpointPolicy' }>) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const branch = getRoadBranchState(state, action.branchId);
  if (!branch || !activeCheckpointForBranch(state, action.branchId)) return error(action, 'unknown_operational_checkpoint', 'This branch has no active checkpoint');
  if (!['passThrough', 'normal', 'strict'].includes(action.policy)) return error(action, 'invalid_policy', 'Unknown checkpoint policy');
  return { branch };
}

function setCheckpointPolicy(state: GameState, action: Extract<GameAction, { type: 'SetCheckpointPolicy' }>): ActionError | null {
  const validation = validateSetCheckpointPolicy(state, action);
  if ('code' in validation) return validation;
  const { branch } = validation;
  branch.currentPolicy = action.policy;
  state.actionsTakenThisTurn += 1;
  return null;
}

function validateTurnAwayCheckpointRefugees(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'TurnAwayCheckpointRefugees' }>,
) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const checkpoint = state.checkpoints.find((candidate) => candidate.id === action.checkpointId);
  if (!checkpoint || !['active', 'remnant'].includes(deriveCheckpointRole(state, checkpoint))) {
    return error(action, 'checkpoint_not_eligible_for_turn_away', 'Only Active or Remnant checkpoints can turn away waiting refugees');
  }
  if (!Number.isInteger(action.count) || action.count < 1 || action.count > checkpoint.waiting) {
    return error(action, 'invalid_refugee_turn_away_count', 'Turn Away count must be an integer within the waiting pool');
  }
  return { checkpoint };
}

function turnAwayCheckpointRefugees(
  state: GameState,
  action: Extract<GameAction, { type: 'TurnAwayCheckpointRefugees' }>,
): ActionError | null {
  const validation = validateTurnAwayCheckpointRefugees(state, action);
  if ('code' in validation) return validation;
  const { checkpoint } = validation;
  checkpoint.waiting -= action.count;
  state.population.cumulativeDepartures += action.count;
  state.statistics.refugeesDeparted += action.count;
  state.statistics.refugeesTurnedAwayByDirection[checkpoint.direction] += action.count;
  const contributesToFutureHorde = state.horde.finalHordeStatus === 'notStarted';
  if (contributesToFutureHorde) {
    state.rejectedRefugeesByDirection[checkpoint.direction].turnedAway += action.count;
  }
  state.actionsTakenThisTurn += 1;
  emit(state, 'checkpoint_refugees_turned_away', {
    checkpointId: checkpoint.id,
    direction: checkpoint.direction,
    count: action.count,
    contributesToFutureHorde,
  });
  return null;
}

function validateSetPowerSupply(state: Readonly<GameState>, action: Extract<GameAction, { type: 'SetPowerSupply' }>) {
  if (!isPlayerPhase(state)) return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  const facility = getFacilityState(state, action.facilityId);
  if (!facility || !['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type)) {
    return error(action, 'power_supply_not_applicable', 'Power Supply can only be changed for a supported facility');
  }
  if (
    facility.owner !== 'player' ||
    facility.status !== 'owned' ||
    facility.infected > 0 ||
    facility.populationOperationalTurn > state.turn ||
    ['building', 'disabled', 'recovering'].includes(facility.operationalStatus)
  ) {
    return error(action, 'power_supply_unavailable', 'The facility must be owned, safe, and operational for population actions');
  }
  if (typeof action.enabled !== 'boolean') return error(action, 'invalid_power_supply', 'Power Supply must be ON or OFF');
  if (facility.powerSupplyEnabled === action.enabled) return error(action, 'no_change', 'Power Supply is already set to this value');
  return { facility };
}

function setPowerSupply(state: GameState, action: Extract<GameAction, { type: 'SetPowerSupply' }>): ActionError | null {
  const validation = validateSetPowerSupply(state, action);
  if ('code' in validation) return validation;
  const { facility } = validation;
  facility.powerSupplyEnabled = action.enabled;
  emit(state, 'power_supply_changed', { facilityId: facility.id, enabled: action.enabled });
  return null;
}

function unitProductionCosts(state: Readonly<GameState>, unitType: HumanUnitType): {
  population: number;
  civilianGoods: number;
  militaryGoods: number;
} {
  const config = state.config.units[unitType];
  return {
    population: config.population,
    civilianGoods: config.productionCivilianGoods,
    militaryGoods: config.productionMilitaryGoods,
  };
}

function validateProduceUnit(state: Readonly<GameState>, action: Extract<GameAction, { type: 'ProduceUnit' }>) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  if (!HUMAN_UNIT_TYPES.includes(action.unitType)) return error(action, 'invalid_unit_type', 'Only configured human units can be produced');
  const eligibleCities = eligibleSnapshotCities(state, 'supply').filter(
    (facility) => state.config.units[action.unitType].recruitmentFacilityTypes.includes(facility.type as 'capital' | 'city'),
  );
  if (
    action.destination &&
    eligibleCities.some((facility) => hexKey(facility.position) === hexKey(action.destination!)) &&
    !isHexSupplied(state, action.destination)
  ) {
    return error(action, 'recruitment_out_of_supply', 'Units cannot be recruited outside the supply network');
  }
  const possibleCities = eligibleCities.filter((facility) => isHexSupplied(state, facility.position));
  const city = action.destination
    ? possibleCities.find((facility) => hexKey(facility.position) === hexKey(action.destination!))
    : possibleCities[0];
  if (!city) {
    return error(
      action,
      'invalid_recruitment_hub',
      'This unit type cannot be recruited at the selected facility',
    );
  }
  if (state.pendingUnitProductions.some((order) => order.cityFacilityId === city.id)) return error(action, 'city_busy', 'This city already has a reservation');
  const costs = unitProductionCosts(state, action.unitType);
  if (
    availableSupplyPopulation(state) < costs.population ||
    civilianWorkerCount(state) - costs.population <= 0 ||
    state.resources.civilianGoods < costs.civilianGoods ||
    state.resources.militaryGoods < costs.militaryGoods
  ) {
    return error(action, 'insufficient_production_cost', 'Insufficient eligible city population or supplies, or recruitment would use the last healthy civilian');
  }
  return { city, costs };
}

function produceUnit(state: GameState, action: Extract<GameAction, { type: 'ProduceUnit' }>): ActionError | null {
  const validation = validateProduceUnit(state, action);
  if ('code' in validation) return validation;
  const { city, costs } = validation;
  const sources = withdrawFromSupplyCities(state, costs.population);
  if (!sources) return error(action, 'population_move_failed', 'Recruitment population could not be conscripted atomically');
  state.resources.civilianGoods -= costs.civilianGoods;
  state.resources.militaryGoods -= costs.militaryGoods;
  const order: UnitProductionOrder = {
    id: `production-${state.nextEventNumber}`,
    cityFacilityId: city.id,
    unitType: action.unitType,
    population: costs.population,
    readyTurn: state.turn + 1,
  };
  state.pendingUnitProductions.push(order);
  state.actionsTakenThisTurn += 1;
  emit(state, 'population_conscripted', {
    cityFacilityId: city.id,
    unitType: action.unitType,
    people: costs.population,
    sources,
  });
  synchronizePopulation(state);
  return null;
}

function move(state: GameState, action: MoveAction, rng: SeededRng = SeededRng.fromState(state.rngState)): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const result = getMovePath(state, action);
  if ('code' in result) return result;
  const movementBudget = result.movementMode === 'emergency'
    ? state.config.units[result.unit.type as HumanUnitType].emergencyMovementPoints
    : result.unit.movement;
  applyMovement(state, result.unit, result.path, movementBudget, result.movementMode, rng);
  state.actionsTakenThisTurn += 1;
  synchronizePopulation(state);
  return null;
}

function validateAttack(state: Readonly<GameState>, action: AttackAction) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const attacker = getUnit(state, action.attackerId);
  const target = getUnit(state, action.targetId);
  if (!attacker || !attacker.isPlayerUnit || !target || !isAttackable(attacker, target) || !isVisibleToPlayer(state, target.position)) {
    return error(action, 'invalid_target', 'A visible enemy target and player attacker are required');
  }
  const combatProjection = forecastUnitCombatAtDistance(state, attacker, hexDistance(attacker.position, target.position));
  if ((attacker.actionState === 'acted' && !attacker.activity.attacked) || !attacker.canAttack || attacker.attackChargesRemaining <= 0 || !combatProjection.canAttack) {
    return error(action, 'attack_not_legal', 'Target is outside range or this unit cannot attack');
  }
  return { attacker, target };
}

function attack(state: GameState, action: AttackAction, rng: SeededRng = SeededRng.fromState(state.rngState)): ActionError | null {
  const validation = validateAttack(state, action);
  if ('code' in validation) return validation;
  const { attacker, target } = validation;
  attacker.actionState = 'acted';
  attacker.canMove = false;
  resolveCombat(state, attacker, target, 'attack', rng);
  state.actionsTakenThisTurn += 1;
  synchronizePopulation(state);
  return null;
}

function validateWait(state: Readonly<GameState>, action: Extract<GameAction, { type: 'Wait' }>) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const unit = getUnit(state, action.unitId);
  if (!unit || !unit.isPlayerUnit || unit.actionState === 'acted') return error(action, 'cannot_wait', 'Only an uncommitted player unit can wait');
  return { unit };
}

function wait(state: GameState, action: Extract<GameAction, { type: 'Wait' }>): ActionError | null {
  const validation = validateWait(state, action);
  if ('code' in validation) return validation;
  const { unit } = validation;
  unit.actionState = 'acted';
  unit.canMove = false;
  state.actionsTakenThisTurn += 1;
  return null;
}

function constructibleLimit(state: Readonly<GameState>, facilityType: ConstructibleFacilityType): number {
  return facilityType === 'simpleFarm'
    ? state.map.roadBranches.length
    : Math.ceil(state.map.roadBranches.length / state.config.constructibleFacility.limitPerTypeDivisor);
}

interface ConstructibleValidationContext {
  suppliedKeys: ReadonlySet<string>;
  facilityKeys: ReadonlySet<string>;
  checkpointKeys: ReadonlySet<string>;
  playerUnitKeys: ReadonlySet<string>;
  visibleEnemyKeys: ReadonlySet<string>;
}

function constructibleValidationContext(state: Readonly<GameState>): ConstructibleValidationContext {
  return {
    suppliedKeys: new Set(getSuppliedTileKeys(state)),
    facilityKeys: new Set(state.facilities.map((facility) => hexKey(facility.position))),
    checkpointKeys: new Set(state.checkpoints.map((checkpoint) => hexKey(checkpoint.position))),
    playerUnitKeys: new Set(state.units.filter((unit) => unit.isPlayerUnit).map((unit) => hexKey(unit.position))),
    visibleEnemyKeys: new Set(getVisibleEnemyUnits(state).map((unit) => hexKey(unit.position))),
  };
}

function validateConstructibleFacilityAction(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildConstructibleFacility' }>,
  context?: ConstructibleValidationContext,
): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  if (!['simpleFarm', 'civilianDroneBase'].includes(action.facilityType)) {
    return error(action, 'invalid_constructible_facility_type', 'Unknown constructible facility type');
  }
  if (state.facilities.filter((facility) => facility.constructible && facility.type === action.facilityType).length >= constructibleLimit(state, action.facilityType)) {
    return error(action, 'constructible_facility_limit_reached', 'The per-type constructible facility limit has been reached');
  }
  const cost = state.config.facilities[action.facilityType].buildCivilianGoods;
  if (state.resources.civilianGoods < cost) {
    return error(action, 'insufficient_civilian_goods', 'Not enough Civilian Goods to build this facility');
  }
  if (!hexWithinBounds(action.position, state.map.width, state.map.height)) {
    return error(action, 'outside_map', 'Position is outside the map');
  }
  if (isHordeSpawnReserve(state.map, action.position)) {
    return error(action, 'horde_spawn_reserve', 'Player facilities cannot occupy the Horde Spawn Reserve');
  }
  if (!(context ? context.suppliedKeys.has(hexKey(action.position)) : isHexSupplied(state, action.position))) {
    return error(action, 'constructible_out_of_supply', 'Constructible facilities must be built inside the Supply Network');
  }
  const tile = getTile(state.map, action.position);
  if (!tile || tile.terrain !== 'plain') return error(action, 'constructible_invalid_terrain', 'Only Plain terrain can be used');
  if (tile.road) return error(action, 'constructible_road_blocked', 'Road Hexes cannot be used');
  if (tile.hordeEntranceDirections.length > 0) return error(action, 'constructible_entrance_blocked', 'Horde Entrances cannot be used');
  const key = hexKey(action.position);
  if (context ? context.facilityKeys.has(key) : getFacilityAt(state as GameState, action.position) !== undefined) return error(action, 'constructible_facility_occupied', 'A facility already occupies this Hex');
  if (context ? context.checkpointKeys.has(key) : getCheckpointAt(state as GameState, action.position) !== undefined) return error(action, 'constructible_checkpoint_occupied', 'A Checkpoint already occupies this Hex');
  if (context ? context.playerUnitKeys.has(key) : state.units.some((unit) => unit.isPlayerUnit && hexKey(unit.position) === key)) {
    return error(action, 'constructible_player_unit_occupied', 'A player Unit occupies this Hex');
  }
  if (context ? context.visibleEnemyKeys.has(key) : getVisibleEnemyUnits(state).some((unit) => hexKey(unit.position) === key)) {
    return error(action, 'constructible_visible_zombie_occupied', 'A visible Zombie occupies this Hex');
  }
  return null;
}

export function getConstructibleFacilityPositionCandidates(
  state: Readonly<GameState>,
  facilityType: ConstructibleFacilityType,
): ConstructibleFacilityPositionCandidate[] {
  const context = constructibleValidationContext(state);
  return [...state.map.tiles]
    .sort((left, right) => left.q - right.q || left.r - right.r)
    .map((tile) => {
      const action: Extract<GameAction, { type: 'BuildConstructibleFacility' }> = {
        type: 'BuildConstructibleFacility',
        facilityType,
        position: { q: tile.q, r: tile.r },
      };
      const reason = validateConstructibleFacilityAction(state, action, context);
      return { facilityType, position: { ...action.position }, legal: reason === null, reasonCode: reason?.code ?? null };
    });
}

function getLegalConstructibleBuildActions(
  state: Readonly<GameState>,
): Array<Extract<GameAction, { type: 'BuildConstructibleFacility' }>> {
  const context = constructibleValidationContext(state);
  const actions: Array<Extract<GameAction, { type: 'BuildConstructibleFacility' }>> = [];
  const suppliedTiles = state.map.tiles.filter((tile) => context.suppliedKeys.has(tile.key));
  for (const facilityType of ['simpleFarm', 'civilianDroneBase'] as const) {
    for (const tile of suppliedTiles) {
      const action: Extract<GameAction, { type: 'BuildConstructibleFacility' }> = {
        type: 'BuildConstructibleFacility',
        facilityType,
        position: { q: tile.q, r: tile.r },
      };
      if (validateConstructibleFacilityAction(state, action, context) === null) actions.push(action);
    }
  }
  return actions;
}

function buildConstructibleFacility(
  state: GameState,
  action: Extract<GameAction, { type: 'BuildConstructibleFacility' }>,
): ActionError | null {
  const reason = validateConstructibleFacilityAction(state, action);
  if (reason) return reason;
  const config = state.config.facilities[action.facilityType];
  const number = state.nextConstructibleFacilityNumber++;
  const prefix = action.facilityType === 'simpleFarm' ? 'simple-farm' : 'civilian-drone-base';
  const securedOrder = state.facilities.reduce((maximum, facility) => Math.max(maximum, facility.securedOrder ?? -1), -1) + 1;
  const facility: FacilityState = {
    id: `${prefix}-${number}`,
    type: action.facilityType,
    nameKey: action.facilityType,
    position: { ...action.position },
    workerCapacity: config.workerCapacity,
    startingOwned: true,
    startingWorkers: 0,
    startingInfected: 0,
    owner: 'player',
    status: 'owned',
    operationalStatus: 'building',
    workers: 0,
    infected: 0,
    securedOrder,
    lastAssignedOrder: state.nextAssignmentOrder++,
    populationOperationalTurn: state.turn + 1,
    powerSupplyEnabled: action.facilityType !== 'simpleFarm',
    lastPowerSupplied: null,
    constructible: true,
    builtTurn: state.turn,
    recoveryOperationalTurn: null,
  };
  state.facilities.push(facility);
  if (action.facilityType === 'civilianDroneBase') state.statistics.civilianDroneBasesBuilt += 1;
  state.resources.civilianGoods -= config.buildCivilianGoods;
  state.actionsTakenThisTurn += 1;
  emit(state, 'constructible_built', {
    facilityId: facility.id,
    facilityType: action.facilityType,
    q: action.position.q,
    r: action.position.r,
    civilianGoods: config.buildCivilianGoods,
  });
  return null;
}

function validateDecommissionConstructibleFacility(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'DecommissionConstructibleFacility' }>,
) {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const facility = getFacilityState(state, action.facilityId);
  if (!facility || !facility.constructible || facility.type !== 'civilianDroneBase') {
    return error(action, 'facility_not_decommissionable', 'Only a constructed Civilian Drone Base can be decommissioned');
  }
  if (facility.operationalStatus === 'building') {
    return error(action, 'facility_building', 'A facility under construction cannot be decommissioned');
  }
  if (facility.owner !== 'player' || facility.workers !== 0 || facility.infected !== 0) {
    return error(action, 'facility_decommission_conditions_not_met', 'The facility must be player-owned, unstaffed, and uninfected');
  }
  if (state.units.some((unit) => isZombieFaction(unit) && hexKey(unit.position) === hexKey(facility.position))) {
    return error(action, 'facility_zombie_occupied', 'A Zombie occupies this facility');
  }
  return { facility };
}

function decommissionConstructibleFacility(
  state: GameState,
  action: Extract<GameAction, { type: 'DecommissionConstructibleFacility' }>,
): ActionError | null {
  const validation = validateDecommissionConstructibleFacility(state, action);
  if ('code' in validation) return validation;
  const { facility } = validation;
  const refund = Math.ceil(state.config.facilities.civilianDroneBase.buildCivilianGoods / 2);
  state.facilities.splice(state.facilities.findIndex((candidate) => candidate.id === facility.id), 1);
  state.resources.civilianGoods += refund;
  state.actionsTakenThisTurn += 1;
  state.statistics.civilianDroneBasesDecommissioned += 1;
  state.statistics.civilianGoodsRefundedFromDecommission += refund;
  emit(state, 'constructible_decommissioned', {
    facilityId: facility.id,
    facilityType: facility.type,
    q: facility.position.q,
    r: facility.position.r,
    civilianGoodsRefunded: refund,
  });
  return null;
}

function validationError(value: ActionError | object): ActionError | null {
  return 'code' in value ? value as ActionError : null;
}

/** Lightweight, non-mutating validation for callers that need an error reason. */
export function validateAction(state: Readonly<GameState>, action: GameAction): ActionError | null {
  if (state.gameOver) return error(action, 'game_over', 'The game is over');
  if (action.type === 'StartNewGame') {
    try {
      createInitialState(action.seed, action.config);
      return null;
    } catch (reason) {
      return error(action, 'invalid_new_game', reason instanceof Error ? reason.message : 'Invalid new game');
    }
  }
  if (action.type === 'LoadSnapshot') {
    const valid = validateInvariants(action.snapshot);
    const seededInitialZombiesValid = initialZombiePositionsMatchSeed(action.snapshot.map, action.snapshot.seed) && initialHunterPositionsMatchSeed(action.snapshot);
    if (action.snapshot.gameVersion !== state.gameVersion || !valid.valid || !seededInitialZombiesValid) {
      if (!seededInitialZombiesValid) valid.errors.push('Map initial Zombie positions and order must match the deterministic state seed');
      return error(action, 'invalid_snapshot', valid.errors.join('; ') || 'Unsupported game version');
    }
    return null;
  }
  if (action.type === 'EndTurn') {
    return state.phase === 'player' ? null : error(action, 'wrong_phase', 'Turn can only end during the player phase');
  }
  if (state.phase !== 'player') return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  if (action.type === 'SetPowerSupply') return validationError(validateSetPowerSupply(state, action));
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) return error(action, 'action_limit', 'The action limit for this turn has been reached');
  if (action.type === 'BuildCheckpoint') return validateBuildCheckpointAction(state, action).error;
  if (action.type === 'RelocateCheckpoint') return validateRelocateCheckpointAction(state, action).error;
  if (action.type === 'ActivateCheckpoint') return validateActivateCheckpointAction(state, action).error;
  if (action.type === 'BuildConstructibleFacility') return validateConstructibleFacilityAction(state, action);
  if (action.type === 'TurnAwayCheckpointRefugees') return validationError(validateTurnAwayCheckpointRefugees(state, action));
  if (action.type === 'DecommissionConstructibleFacility') return validationError(validateDecommissionConstructibleFacility(state, action));
  if (action.type === 'Move') return validationError(getMovePath(state as GameState, action));
  if (action.type === 'Attack') return validationError(validateAttack(state, action));
  if (action.type === 'Wait') return validationError(validateWait(state, action));
  if (action.type === 'AssignWorkers') return validationError(validateAssignWorkers(state, action));
  if (action.type === 'TransferPopulation') return validationError(validateTransferPopulation(state, action));
  if (action.type === 'SetCheckpointPolicy') return validationError(validateSetCheckpointPolicy(state, action));
  if (action.type === 'ProduceUnit') return validationError(validateProduceUnit(state, action));
  return error(action, 'unknown_action', 'Unknown action');
}

function staticConstructibleHexKeys(
  state: Readonly<GameState>,
  supplied: ReadonlySet<string> = new Set(getSuppliedTileKeys(state)),
): Set<string> {
  const eligible = staticConstructibleEligibleHexKeys(state);
  return new Set([...eligible].filter((key) => supplied.has(key)));
}

function staticConstructibleEligibleHexKeys(state: Readonly<GameState>): Set<string> {
  const visibleEnemyKeys = new Set(getVisibleEnemyUnits(state).map((unit) => hexKey(unit.position)));
  const playerUnitKeys = new Set(state.units.filter((unit) => unit.isPlayerUnit).map((unit) => hexKey(unit.position)));
  const facilityKeys = new Set(state.facilities.map((facility) => hexKey(facility.position)));
  const checkpointKeys = new Set(state.checkpoints.map((checkpoint) => hexKey(checkpoint.position)));
  return new Set(state.map.tiles
    .filter((tile) =>
      tile.terrain === 'plain' &&
      tile.playerOccupancyAllowed &&
      !tile.road &&
      tile.hordeEntranceDirections.length === 0 &&
      !facilityKeys.has(tile.key) &&
      !checkpointKeys.has(tile.key) &&
      !playerUnitKeys.has(tile.key) &&
      !visibleEnemyKeys.has(tile.key))
    .map((tile) => tile.key));
}

interface CheckpointProjectionContext {
  currentSupply: ReadonlySet<string>;
  currentBuildable: ReadonlySet<string>;
  staticBuildable: ReadonlySet<string>;
  currentBranchRadii: ReadonlyMap<RoadBranchId, number>;
  tiles: ReadonlyArray<{
    key: string;
    distance: number;
    branchIds: readonly RoadBranchId[];
  }>;
  facilityIdsByTile: ReadonlyMap<string, readonly string[]>;
}

function createCheckpointProjectionContext(state: Readonly<GameState>): CheckpointProjectionContext {
  const currentSupply = new Set(getSuppliedTileKeys(state));
  const staticBuildable = staticConstructibleEligibleHexKeys(state);
  const currentBuildable = new Set([...staticBuildable].filter((key) => currentSupply.has(key)));
  const capital = getCapitalPosition(state.map);
  const currentBranchRadii = new Map(state.map.roadBranches.map(
    (branch) => [branch.id, getBranchSupplyRadius(state, branch.id)] as const,
  ));
  const facilityIdsByTile = new Map<string, string[]>();
  for (const facility of state.facilities) {
    const key = hexKey(facility.position);
    const ids = facilityIdsByTile.get(key) ?? [];
    ids.push(facility.id);
    facilityIdsByTile.set(key, ids);
  }
  return {
    currentSupply,
    currentBuildable,
    staticBuildable,
    currentBranchRadii,
    tiles: state.map.tiles.map((tile) => ({
      key: tile.key,
      distance: hexDistance(capital, tile),
      branchIds: getSectorBranchIds(state.map, tile),
    })),
    facilityIdsByTile,
  };
}

function checkpointProjectedEffect(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' | 'ActivateCheckpoint' }>,
  legal: boolean,
  context: CheckpointProjectionContext,
): Omit<CheckpointPositionCandidate, 'actionType' | 'branchId' | 'checkpointId' | 'position' | 'legal' | 'reasonCode' | 'civilianGoodsCost'> {
  const branchId = action.branchId ?? ('position' in action ? getBranchIdAt(state.map, action.position) : null) ?? '';
  if (!legal) {
    const radius = getBranchSupplyRadius(state, branchId);
    return {
      currentBranchRadius: radius,
      projectedBranchRadius: radius,
      newlySuppliedHexCount: 0,
      newlyUnsuppliedHexCount: 0,
      newlySuppliedFacilityIds: [],
      newlyUnsuppliedFacilityIds: [],
      suppliedFacilityDelta: 0,
      newlyBuildableConstructibleHexCount: 0,
    };
  }
  const active = activeCheckpointForBranch(state, branchId);
  const projectedPosition = action.type === 'BuildCheckpoint'
    ? active ? null : action.position
    : action.type === 'RelocateCheckpoint'
      ? action.position
      : state.checkpoints.find((checkpoint) => checkpoint.id === action.checkpointId)?.position ?? null;
  const projectedRadius = projectedPosition
    ? getBranchSupplyRadius(state, branchId, projectedPosition)
    : getBranchSupplyRadius(state, branchId);
  const projectedSupply = new Set(context.tiles
    .filter((tile) =>
      tile.distance <= state.config.checkpoint.initialSupplyRadius ||
      tile.branchIds.some((candidateBranchId) =>
        tile.distance <= (candidateBranchId === branchId
          ? projectedRadius
          : context.currentBranchRadii.get(candidateBranchId) ?? state.config.checkpoint.initialSupplyRadius)))
    .map((tile) => tile.key));
  const newlySupplied = [...projectedSupply].filter((key) => !context.currentSupply.has(key));
  const newlyUnsupplied = [...context.currentSupply].filter((key) => !projectedSupply.has(key));
  const newlySuppliedSet = new Set(newlySupplied);
  const newlyUnsuppliedSet = new Set(newlyUnsupplied);
  const newlySuppliedFacilityIds = [...newlySuppliedSet]
    .flatMap((key) => context.facilityIdsByTile.get(key) ?? [])
    .sort();
  const newlyUnsuppliedFacilityIds = [...newlyUnsuppliedSet]
    .flatMap((key) => context.facilityIdsByTile.get(key) ?? [])
    .sort();
  return {
    currentBranchRadius: getBranchSupplyRadius(state, branchId),
    projectedBranchRadius: projectedRadius,
    newlySuppliedHexCount: newlySupplied.length,
    newlyUnsuppliedHexCount: newlyUnsupplied.length,
    newlySuppliedFacilityIds,
    newlyUnsuppliedFacilityIds,
    suppliedFacilityDelta: newlySuppliedFacilityIds.length - newlyUnsuppliedFacilityIds.length,
    newlyBuildableConstructibleHexCount: [...context.staticBuildable]
      .filter((key) => projectedSupply.has(key) && !context.currentBuildable.has(key)).length,
  };
}

/** Pure, stable, all-road-tile checkpoint explainability query. */
export function getCheckpointPositionCandidates(
  state: Readonly<GameState>,
  includeProjectedEffects = true,
): CheckpointPositionCandidate[] {
  const candidates: CheckpointPositionCandidate[] = [];
  const projectionContext = includeProjectedEffects ? createCheckpointProjectionContext(state) : null;
  const visibleTileKeys = getPlayerVisibleTileKeys(state);
  const visibleZombies = state.units
    .filter((unit) => isZombieFaction(unit) && visibleTileKeys.has(hexKey(unit.position)))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const branch of [...state.map.roadBranches].sort((left, right) => left.id.localeCompare(right.id))) {
    const active = activeCheckpointForBranch(state, branch.id);
    for (const position of branch.roadTiles) {
      const actions: Array<Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' }>> = [
        { type: 'BuildCheckpoint', branchId: branch.id, position: { ...position } },
      ];
      if (active) actions.push({ type: 'RelocateCheckpoint', checkpointId: active.id, branchId: branch.id, position: { ...position } });
      for (const action of actions) {
        const reason = action.type === 'BuildCheckpoint'
          ? validateBuildCheckpointAction(state, action, visibleZombies, visibleTileKeys).error
          : validateRelocateCheckpointAction(state, action, visibleZombies, visibleTileKeys).error;
        const effect = includeProjectedEffects
          ? checkpointProjectedEffect(state, action, reason === null, projectionContext!)
          : {};
        candidates.push({
          actionType: action.type,
          branchId: branch.id,
          ...(action.type === 'RelocateCheckpoint' ? { checkpointId: action.checkpointId } : {}),
          position: { ...position },
          legal: reason === null,
          reasonCode: reason?.code ?? null,
          civilianGoodsCost: action.type === 'BuildCheckpoint'
            ? getCheckpointBuildCost(state, branch.id)
            : state.config.checkpoint.relocationCivilianGoods,
          ...effect,
        });
      }
    }
    for (const checkpoint of state.checkpoints
      .filter((candidate) =>
        (candidate.branchId ?? candidate.direction) === branch.id &&
        candidate.status === 'operational' &&
        ['standby', 'dormant'].includes(deriveCheckpointRole(state, candidate)),
      )
      .sort((left, right) =>
        checkpointBranchIndex(state, branch.id, left.position) - checkpointBranchIndex(state, branch.id, right.position) ||
        left.id.localeCompare(right.id),
      )) {
      const action: Extract<GameAction, { type: 'ActivateCheckpoint' }> = {
        type: 'ActivateCheckpoint',
        branchId: branch.id,
        checkpointId: checkpoint.id,
      };
      const reason = validateActivateCheckpointAction(state, action, visibleZombies).error;
      const effect = includeProjectedEffects
        ? checkpointProjectedEffect(state, action, reason === null, projectionContext!)
        : {};
      candidates.push({
        actionType: 'ActivateCheckpoint',
        branchId: branch.id,
        checkpointId: checkpoint.id,
        position: { ...checkpoint.position },
        legal: reason === null,
        reasonCode: reason?.code ?? null,
        civilianGoodsCost: 0,
        ...effect,
      });
    }
  }
  const actionOrder: Record<CheckpointPositionCandidate['actionType'], number> = {
    BuildCheckpoint: 0,
    RelocateCheckpoint: 1,
    ActivateCheckpoint: 2,
  };
  return candidates.sort((left, right) =>
    left.branchId.localeCompare(right.branchId) ||
    checkpointBranchIndex(state, left.branchId, left.position) - checkpointBranchIndex(state, right.branchId, right.position) ||
    actionOrder[left.actionType] - actionOrder[right.actionType] ||
    (left.checkpointId ?? '').localeCompare(right.checkpointId ?? ''),
  );
}

export class GameEngine implements HeadlessGame {
  private state: GameState;
  private revision = 0;

  private committed(): void { this.revision += 1; registerCommittedState(this.state); }

  public constructor(seed = 1, config: GameConfig = createDefaultConfig()) {
    this.state = createInitialState(seed, config);
    this.committed();
  }

  public reset(seed: number, config: GameConfig): Readonly<GameState> {
    this.state = createInitialState(seed, config);
    this.committed();
    return this.getState();
  }

  public getQuery() {
    const state = this.state;
    const legal = () => queryValue(state, 'legal', () => {
      if (this.state !== state) throw new Error('Query revision has expired');
      return this.computeLegalActions();
    });
    const memo = <T>(key: string, fn: () => T) => queryValue(state, key, fn);
    const publicEntities = () => memo('publicEntityContext', () => ({
      ...createPublicEntityProjectionContext(state),
      visibleTileKeys: getPlayerVisibleTileKeys(state),
    }));
    return createQueryContext(this.revision, {
      getEndTurnForecast: () => forecastEndTurn(state),
      getStrategicForecast: () => memo('strategic', () => deriveStrategicForecast(state)),
      getCrisisSummary: () => memo('crisis', () => deriveCrisisSummary(state)),
      getEndTurnRisk: () => memo('risk', () => deriveEndTurnRisk(state)),
      getSupply: () => memo('supply', () => deriveSupplySnapshot(state)),
      getVision: () => memo('vision', () => getPlayerVisionCoverage(state)),
      getVisibleTileKeys: () => getPlayerVisibleTileKeys(state),
      getSuppliedTileKeys: () => getSuppliedTileKeys(state),
      getFacilityProduction: () => forecastFacilityProduction(state),
      getPublicUnitProjection: (id: string) => memo('publicUnit:'+id, () => {
        const unit = state.units.find(unit => unit.id === id);
        if (!unit || (!unit.isPlayerUnit && !getPlayerVisibleTileKeys(state).has(hexKey(unit.position)))) return undefined;
        return createPublicUnitProjection(unit, state, publicEntities());
      }),
      getPublicFacilityProjection: (id: string) => memo('publicFacility:'+id, () => {
        const facility = state.facilities.find(facility => facility.id === id);
        return facility ? createPublicFacilityProjection(facility, state, publicEntities()) : undefined;
      }),
      getPublicCheckpointProjection: (id: string) => memo('publicCheckpoint:'+id, () => {
        const checkpoint = state.checkpoints.find(checkpoint => checkpoint.id === id);
        return checkpoint ? createPublicCheckpointProjection(checkpoint, state) : undefined;
      }),
      getUnitMoveProjections: (id: string) => memo('moves:'+id, () => getUnitLegalMoveFuelProjections(state, id)),
      getUnitAttackProjections: (id: string) => memo('attacks:'+id, () => getUnitLegalAttackProjections(state, id)),
      previewMove: (id: string, destination: HexCoord) => memo('preview:'+id+':'+hexKey(destination), () => previewMove(state, id, destination)),
      getCheckpointPositionCandidates: () => memo('checkpoints', () => getCheckpointPositionCandidates(state)),
      getConstructibleFacilityPositionCandidates: (type: ConstructibleFacilityType) => memo('constructible:'+type, () => getConstructibleFacilityPositionCandidates(state, type)),
      getLegalActions: legal,
      getLegalActionsForUnit: (id: string) => legal().filter(a => ('unitId' in a && a.unitId === id) || ('attackerId' in a && a.attackerId === id)),
      getLegalActionsForFacility: (id: string) => legal().filter(a => ('facilityId' in a && a.facilityId === id) || ('fromFacilityId' in a && a.fromFacilityId === id) || ('toFacilityId' in a && a.toFacilityId === id)),
    }, () => this.state === state);
  }

  public getState(): Readonly<GameState> {
    return cloneState(this.state);
  }

  public isGameOver(): boolean {
    return this.state.gameOver;
  }

  public getResult(): GameResult | null {
    return cloneResult(this.state.result);
  }

  public getLegalActions(): GameAction[] {
    return copyQueryValue(queryValue(this.state, 'legal', () => this.computeLegalActions()));
  }

  private computeLegalActions(): GameAction[] {
    if (!isPlayerPhase(this.state)) return [];
    const actions: GameAction[] = [];
    if (this.state.actionsTakenThisTurn >= this.state.config.maxActionsPerTurn) {
      for (const facility of stableFacilities(this.state)) {
        if (
          facility.owner === 'player' &&
          facility.status === 'owned' &&
          facility.infected === 0 &&
          facility.populationOperationalTurn <= this.state.turn &&
          ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type) &&
          !['building', 'disabled', 'recovering'].includes(facility.operationalStatus)
        ) {
          actions.push({ type: 'SetPowerSupply', facilityId: facility.id, enabled: !facility.powerSupplyEnabled });
        }
      }
      actions.push({ type: 'EndTurn' });
      return actions;
    }
    const suppliedKeys = new Set(getSuppliedTileKeys(this.state));
    const supplyPopulationAvailable = availableSupplyPopulation(this.state);
    const receptionCitiesAvailable = eligibleSnapshotCities(this.state, 'reception').length > 0;
    const visibleEnemies = getVisibleEnemyUnits(this.state);
    for (const unit of this.state.units.filter((candidate) => candidate.isPlayerUnit).sort((a, b) => a.id.localeCompare(b.id))) {
      if (unit.actionState !== 'acted') {
        actions.push({ type: 'Wait', unitId: unit.id });
      }
      if (unit.canMove && unit.actionState !== 'acted') {
        for (const destination of reachableDestinations(this.state, unit)) {
          actions.push({ type: 'Move', unitId: unit.id, destination });
        }
      }
      if (unit.canAttack && unit.attackChargesRemaining > 0 && (unit.actionState !== 'acted' || unit.activity.attacked)) {
        for (const target of visibleEnemies) {
          if (forecastUnitCombatAtDistance(this.state, unit, hexDistance(unit.position, target.position)).canAttack) {
            actions.push({ type: 'Attack', attackerId: unit.id, targetId: target.id });
          }
        }
      }
    }
    for (const facility of stableFacilities(this.state)) {
      if (
        facility.owner !== 'player' ||
        facility.status !== 'owned' ||
        facility.infected > 0 ||
        !isProductionFacility(facility) ||
        facility.populationOperationalTurn > this.state.turn ||
        ['building', 'disabled', 'recovering'].includes(facility.operationalStatus)
      ) continue;
      const maximum = Math.min(facility.workerCapacity, facility.workers + supplyPopulationAvailable);
      for (let workers = 0; workers <= maximum; workers += 1) {
        if (
          workers !== facility.workers &&
          (workers > facility.workers || receptionCitiesAvailable) &&
          (workers < facility.workers || suppliedKeys.has(hexKey(facility.position)))
        ) actions.push({ type: 'AssignWorkers', facilityId: facility.id, workers });
      }
      if (
        ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type) &&
        !['building', 'disabled', 'recovering'].includes(facility.operationalStatus)
      ) {
        actions.push({ type: 'SetPowerSupply', facilityId: facility.id, enabled: !facility.powerSupplyEnabled });
      }
    }
    const cities = eligibleSnapshotCities(this.state, 'supply');
    for (const from of cities) {
      if (from.workers <= 0) continue;
      for (const to of cities) {
        if (from.id === to.id) continue;
        actions.push({ type: 'TransferPopulation', fromFacilityId: from.id, toFacilityId: to.id, people: 1 });
        if (from.workers > 1) {
          actions.push({
            type: 'TransferPopulation',
            fromFacilityId: from.id,
            toFacilityId: to.id,
            people: from.workers,
          });
        }
      }
    }
    for (const branch of [...this.state.roadBranches].sort((a, b) => a.branchId.localeCompare(b.branchId))) {
      if (!activeCheckpointForBranch(this.state, branch.branchId)) continue;
      for (const policy of ['passThrough', 'normal', 'strict'] as const) {
        if (policy !== branch.currentPolicy) actions.push({ type: 'SetCheckpointPolicy', branchId: branch.branchId, policy });
      }
    }
    for (const checkpoint of [...this.state.checkpoints].sort((a, b) => a.id.localeCompare(b.id))) {
      if (checkpoint.waiting > 0 && ['active', 'remnant'].includes(deriveCheckpointRole(this.state, checkpoint))) {
        actions.push({ type: 'TurnAwayCheckpointRefugees', checkpointId: checkpoint.id, count: 1 });
        if (checkpoint.waiting > 1) {
          actions.push({ type: 'TurnAwayCheckpointRefugees', checkpointId: checkpoint.id, count: checkpoint.waiting });
        }
      }
    }
    for (const candidate of getCheckpointPositionCandidates(this.state, false)) {
      if (!candidate.legal) continue;
      actions.push(candidate.actionType === 'RelocateCheckpoint'
        ? {
            type: 'RelocateCheckpoint',
            checkpointId: candidate.checkpointId!,
            branchId: candidate.branchId,
            position: { ...candidate.position },
          }
        : candidate.actionType === 'ActivateCheckpoint'
          ? { type: 'ActivateCheckpoint', branchId: candidate.branchId, checkpointId: candidate.checkpointId! }
          : { type: 'BuildCheckpoint', branchId: candidate.branchId, position: { ...candidate.position } });
    }
    actions.push(...getLegalConstructibleBuildActions(this.state));
    for (const facility of stableFacilities(this.state)) {
      const action: Extract<GameAction, { type: 'DecommissionConstructibleFacility' }> = {
        type: 'DecommissionConstructibleFacility',
        facilityId: facility.id,
      };
      if (validationError(validateDecommissionConstructibleFacility(this.state, action)) === null) actions.push(action);
    }
    const currentCivilianWorkers = civilianWorkerCount(this.state);
    for (const city of cities.filter((candidate) => suppliedKeys.has(hexKey(candidate.position)))) {
      if (!this.state.pendingUnitProductions.some((order) => order.cityFacilityId === city.id)) {
        for (const unitType of HUMAN_UNIT_TYPES) {
          if (!this.state.config.units[unitType].recruitmentFacilityTypes.includes(city.type as 'capital' | 'city')) continue;
          const costs = unitProductionCosts(this.state, unitType);
          if (
            supplyPopulationAvailable >= costs.population &&
            currentCivilianWorkers - costs.population > 0 &&
            this.state.resources.civilianGoods >= costs.civilianGoods &&
            this.state.resources.militaryGoods >= costs.militaryGoods
          ) {
            actions.push({ type: 'ProduceUnit', unitType, destination: { ...city.position } });
          }
        }
      }
    }
    actions.push({ type: 'EndTurn' });
    return actions;
  }

  public getCheckpointPositionCandidates(): CheckpointPositionCandidate[] {
    return getCheckpointPositionCandidates(this.state);
  }

  public getConstructibleFacilityPositionCandidates(
    facilityType: ConstructibleFacilityType,
  ): ConstructibleFacilityPositionCandidate[] {
    return getConstructibleFacilityPositionCandidates(this.state, facilityType);
  }

  public step(action: GameAction): StepResult {
    const original = this.state;
    if (original.gameOver) {
      return { state: this.getState(), events: [], error: error(action, 'game_over', 'The game is over'), gameOver: true, result: this.getResult() };
    }
    if (action.type === 'StartNewGame') {
      try {
        this.state = createInitialState(action.seed, action.config);
        this.committed();
        return { state: this.getState(), events: [], error: null, gameOver: false, result: null };
      } catch (reason) {
        return { state: this.getState(), events: [], error: error(action, 'invalid_new_game', reason instanceof Error ? reason.message : 'Invalid new game'), gameOver: false, result: null };
      }
    }
    if (action.type === 'LoadSnapshot') {
      try {
        const candidate = cloneState(action.snapshot);
        const valid = validateInvariants(candidate);
        const seededInitialZombiesValid = initialZombiePositionsMatchSeed(candidate.map, candidate.seed) && initialHunterPositionsMatchSeed(candidate);
        if (candidate.gameVersion !== original.gameVersion || !valid.valid || !seededInitialZombiesValid) {
          if (!seededInitialZombiesValid) valid.errors.push('Map initial Zombie positions and order must match the deterministic state seed');
          return { state: this.getState(), events: [], error: error(action, 'invalid_snapshot', valid.errors.join('; ') || 'Unsupported game version'), gameOver: false, result: null };
        }
        this.state = candidate;
    this.committed();
        return { state: this.getState(), events: [], error: null, gameOver: this.state.gameOver, result: this.getResult() };
      } catch (reason) {
        return { state: this.getState(), events: [], error: error(action, 'invalid_snapshot', reason instanceof Error ? reason.message : 'Invalid snapshot'), gameOver: false, result: null };
      }
    }

    const candidate = cloneState(original);
    const populationBeforeAction = populationLedgerTotal(original) + original.population.cumulativeDepartures;
    const rng = SeededRng.fromState(candidate.rngState);
    const eventCount = candidate.events.length;
    let actionError: ActionError | null = null;
    if (action.type === 'EndTurn') {
      if (!isPlayerPhase(candidate)) actionError = error(action, 'wrong_phase', 'Turn can only end during the player phase');
      else actionError = endTurn(candidate, rng);
    } else if (action.type === 'Move') actionError = move(candidate, action, rng);
    else if (action.type === 'Attack') actionError = attack(candidate, action, rng);
    else if (action.type === 'Wait') actionError = wait(candidate, action);
    else if (action.type === 'AssignWorkers') actionError = assignWorkers(candidate, action);
    else if (action.type === 'TransferPopulation') actionError = transferPopulation(candidate, action);
    else if (action.type === 'SetCheckpointPolicy') actionError = setCheckpointPolicy(candidate, action);
    else if (action.type === 'SetPowerSupply') actionError = setPowerSupply(candidate, action);
    else if (action.type === 'BuildConstructibleFacility') actionError = buildConstructibleFacility(candidate, action);
    else if (action.type === 'BuildCheckpoint') actionError = buildCheckpoint(candidate, action);
    else if (action.type === 'RelocateCheckpoint') actionError = relocateCheckpoint(candidate, action);
    else if (action.type === 'ActivateCheckpoint') actionError = activateCheckpoint(candidate, action);
    else if (action.type === 'TurnAwayCheckpointRefugees') actionError = turnAwayCheckpointRefugees(candidate, action);
    else if (action.type === 'DecommissionConstructibleFacility') actionError = decommissionConstructibleFacility(candidate, action);
    else if (action.type === 'ProduceUnit') actionError = produceUnit(candidate, action);
    else actionError = error(action, 'unknown_action', 'Unknown or retired action');

    if (actionError) {
      return { state: this.getState(), events: [], error: actionError, gameOver: this.isGameOver(), result: this.getResult() };
    }
    saveRng(candidate, rng);
    synchronizePopulation(candidate);
    if (!candidate.gameOver) checkImmediateGameEnd(candidate);
    if (
      action.type !== 'EndTurn'
      && populationLedgerTotal(candidate) + candidate.population.cumulativeDepartures !== populationBeforeAction
    ) {
      return {
        state: this.getState(),
        events: [],
        error: error(action, 'population_conservation_failure', 'Atomic action violated the population conservation ledger'),
        gameOver: this.isGameOver(),
        result: this.getResult(),
      };
    }
    emitPlayerKnowledgeChanges(original, candidate);
    try {
      assertInvariants(candidate);
    } catch (reason) {
      return { state: this.getState(), events: [], error: error(action, 'invariant_failure', reason instanceof Error ? reason.message : 'Invariant failure'), gameOver: this.isGameOver(), result: this.getResult() };
    }
    this.state = candidate;
    this.committed();
    return {
      state: this.getState(),
      events: cloneEvents(candidate.events.slice(eventCount)),
      error: null,
      gameOver: candidate.gameOver,
      result: this.getResult(),
    };
  }
}

export { createInitialState } from './state';
