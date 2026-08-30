import { createDefaultConfig, HUMAN_UNIT_TYPES } from './config';
import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { assertInvariants, validateInvariants } from './invariants';
import { getHordeEntrance, getTile } from './map';
import { findNearestOpenTiles, findReachableTiles, findShortestPath, pathMovementCost } from './path';
import { SeededRng } from './rng';
import { deriveUnitRecovery } from './recovery';
import { effectiveMovementCost, terrainAdjustedDamage } from './terrain';
import { canUnitSee, getPlayerVisibleTileKeys, getVisibleEnemyUnits, isVisibleToPlayer } from './visibility';
import {
  getBlockingZombiesForCheckpoint,
  getBranchIdAt,
  getBranchSupplyRadius,
  getCapitalPosition,
  getRoadBranch,
  getRoadBranchState,
  getSuppliedTileKeys,
  isHexSupplied,
} from './supply';
import {
  civilianWorkerCount,
  cloneState,
  createCityPopulationSnapshot,
  createInitialState,
  createUnit,
  getCheckpointAt,
  getFacilityState,
  getUnit,
  getUnitAt,
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
  HumanUnitType,
  JsonObject,
  MoveAction,
  PowerSupplyReason,
  ResourceType,
  StepResult,
  UnitProductionOrder,
  UnitState,
} from './types';

export interface MovePreview {
  legal: boolean;
  reason: string | null;
  path: HexCoord[];
  reached: HexCoord | null;
  interception: { interceptorId: string; position: HexCoord } | null;
}

export interface FacilityProductionProjection {
  facilityId: string;
  operatingWorkers: number;
  inputs: Partial<Record<ResourceType, number>>;
  outputs: Partial<Record<ResourceType, number>>;
  powerGeneration: number;
  powerMode: 'required' | 'boost' | 'none';
  powerSupplyEnabled: boolean;
  projectedPowerRequested: boolean;
  projectedPowerSupplied: boolean;
  projectedPowerReason: PowerSupplyReason;
  lastPowerSupplied: boolean | null;
  productionMultiplier: number;
  baseOutputs: Partial<Record<ResourceType, number>>;
  stoppedReason: 'ruined' | 'infection' | 'not_owned' | 'no_workers' | 'power_unavailable' | 'input_shortage' | null;
}

const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'civilianGoods', 'militaryGoods', 'fuel'];

function error(action: GameAction | null, code: string, message: string): ActionError {
  return { action, code, message };
}

function cloneResult(result: GameResult | null): GameResult | null {
  return result ? (JSON.parse(JSON.stringify(result)) as GameResult) : null;
}

function cloneEvents(events: GameEvent[]): GameEvent[] {
  return JSON.parse(JSON.stringify(events)) as GameEvent[];
}

function emit(state: GameState, type: GameEventType, payload: JsonObject): void {
  state.events.push({
    id: `event-${state.nextEventNumber}`,
    turn: state.turn,
    phase: state.phase,
    type,
    payload,
  });
  state.nextEventNumber += 1;
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

function stableFacilities(state: GameState, descending = false): FacilityState[] {
  return [...state.facilities].sort((left, right) => {
    const leftOrder = left.securedOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.securedOrder ?? Number.MAX_SAFE_INTEGER;
    const order = leftOrder - rightOrder || left.id.localeCompare(right.id);
    return descending ? -order : order;
  });
}

export function effectiveRange(state: Readonly<GameState>, unit: Readonly<UnitState>): number {
  if (unit.type === 'nationalGuard' && !state.resources.militarySupplyAvailable) {
    return Math.min(1, unit.range);
  }
  return unit.range;
}

export interface SuppressionProjection {
  targetId: string;
  targetKind: 'facility' | 'checkpoint';
  suppressionPower: number;
  projectedSuppression: number;
  projectedCivilianDamage: number;
}

/** Conditional EndTurn suppression derived only from the current public state. */
export function forecastUnitSuppression(
  state: Readonly<GameState>,
  unit: Readonly<UnitState>,
): SuppressionProjection | null {
  if (
    !unit.isPlayerUnit ||
    !unit.canAttack ||
    unit.activity.attacked ||
    unit.activity.intercepted
  ) return null;
  const key = hexKey(unit.position);
  const facility = state.facilities.find((candidate) => hexKey(candidate.position) === key && candidate.infected > 0);
  const checkpoint = state.checkpoints.find((candidate) => hexKey(candidate.position) === key && candidate.infected > 0);
  const target = facility ?? checkpoint;
  if (!target) return null;
  const suppressionPower = unit.type === 'police'
    ? state.config.infection.policeSuppression
    : state.config.infection.nationalGuardSuppression;
  const healthyPopulation = facility
    ? facility.workers
    : checkpoint
      ? checkpoint.waiting + checkpoint.screening + checkpoint.approved
      : 0;
  return {
    targetId: target.id,
    targetKind: facility ? 'facility' : 'checkpoint',
    suppressionPower,
    projectedSuppression: Math.min(target.infected, suppressionPower),
    projectedCivilianDamage: unit.type === 'nationalGuard'
      ? Math.min(healthyPopulation, Math.ceil(suppressionPower * state.config.infection.nationalGuardCivilianDamageRate))
      : 0,
  };
}

function isAttackable(attacker: UnitState, target: UnitState): boolean {
  return attacker.isPlayerUnit !== target.isPlayerUnit;
}

function markAttacked(unit: UnitState, interception = false): void {
  unit.canAttack = false;
  if (isHumanUnit(unit)) {
    if (interception) {
      unit.activity.intercepted = true;
    } else {
      unit.activity.attacked = true;
    }
  }
}

function destroyUnit(state: GameState, unit: UnitState, cause: string): void {
  const index = state.units.findIndex((candidate) => candidate.id === unit.id);
  if (index < 0) {
    return;
  }
  state.units.splice(index, 1);
  if (isHumanUnit(unit)) {
    state.statistics.unitLosses += 1;
    state.population.cumulativeDeaths += unit.population;
  }
  if (unit.type === 'zombie') {
    state.statistics.normalZombiesKilled += 1;
    if (unit.hordeKind === 'final') state.statistics.finalHordeKilled += 1;
  }
  if (unit.type === 'hordeZombie') {
    state.statistics.hordeZombiesKilled += 1;
    if (unit.hordeKind === 'final') state.statistics.finalHordeKilled += 1;
  }
  emit(state, 'unit_destroyed', {
    unitId: unit.id,
    unitType: unit.type,
    isPlayerUnit: unit.isPlayerUnit,
    cause,
    q: unit.position.q,
    r: unit.position.r,
    inSupply: unit.isPlayerUnit ? isHexSupplied(state, unit.position) : false,
  });
}

function dealDamage(state: GameState, target: UnitState, amount: number, sourceId: string, cause: string): void {
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
    destroyUnit(state, target, cause);
  }
}

function resolveCombat(
  state: GameState,
  attacker: UnitState,
  defender: UnitState,
  kind: 'attack' | 'interception',
): void {
  if (!state.units.some((unit) => unit.id === attacker.id) || !state.units.some((unit) => unit.id === defender.id)) {
    return;
  }
  markAttacked(attacker, kind === 'interception');
  emit(state, kind === 'interception' ? 'interception' : 'attack', {
    attackerId: attacker.id,
    defenderId: defender.id,
  });
  if (kind === 'interception') {
    state.statistics.hordeInterceptions += attacker.isPlayerUnit ? 1 : 0;
  }
  dealDamage(state, defender, attacker.attack, attacker.id, kind);
  if (!state.units.some((unit) => unit.id === defender.id)) {
    return;
  }
  if (defender.canAttack && hexDistance(defender.position, attacker.position) <= effectiveRange(state, defender)) {
    markAttacked(defender);
    emit(state, 'attack', { attackerId: defender.id, defenderId: attacker.id, counterattack: true });
    dealDamage(state, attacker, defender.attack, defender.id, 'counterattack');
  }
}

function interceptorsAt(state: GameState, mover: UnitState, position: HexCoord): UnitState[] {
  return state.units
    .filter(
      (candidate) =>
        candidate.id !== mover.id &&
        candidate.isPlayerUnit !== mover.isPlayerUnit &&
        candidate.canAttack &&
        hexDistance(candidate.position, position) <= effectiveRange(state, candidate),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function tryCapture(state: GameState, unit: UnitState): void {
  if (!unit.isPlayerUnit) {
    return;
  }
  const tile = getTile(state.map, unit.position);
  if (!tile?.facilityId) {
    return;
  }
  const facility = getFacilityState(state, tile.facilityId);
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

function applyMovement(
  state: GameState,
  mover: UnitState,
  path: HexCoord[],
  movementBudget: number,
): { reached: HexCoord; interception: UnitState | null } {
  let reached = { ...mover.position };
  let interception: UnitState | null = null;
  const traversed: HexCoord[] = [];
  let spent = 0;
  for (const position of path.slice(1)) {
    const cost = effectiveMovementCost(state, position);
    if (cost === null || spent + cost > movementBudget) break;
    const occupant = getUnitAt(state, position);
    if (occupant && occupant.id !== mover.id) break;
    spent += cost;
    mover.position = { ...position };
    reached = { ...position };
    traversed.push(position);
    const enteredTile = getTile(state.map, position);
    if (enteredTile) state.statistics.terrainEntriesByType[enteredTile.terrain] += 1;
    const candidates = interceptorsAt(state, mover, position);
    const interceptor = candidates[0];
    if (interceptor) {
      interception = interceptor;
      resolveCombat(state, interceptor, mover, 'interception');
      break;
    }
  }
  if (state.units.some((unit) => unit.id === mover.id)) {
    if (isHumanUnit(mover)) {
      mover.activity.moved = traversed.length > 0;
      mover.canMove = false;
      mover.actionState = 'moved';
    }
    emit(state, 'unit_moved', { unitId: mover.id, q: reached.q, r: reached.r });
    tryCapture(state, mover);
  }
  return { reached, interception };
}

function getMovePath(state: GameState, action: MoveAction): { unit: UnitState; path: HexCoord[] } | ActionError {
  const unit = getUnit(state, action.unitId);
  if (!unit || !unit.isPlayerUnit) {
    return error(action, 'unknown_unit', 'A player unit is required');
  }
  if (!isPlayerPhase(state) || unit.actionState === 'acted' || !unit.canMove) {
    return error(action, 'unit_cannot_move', 'This unit cannot move now');
  }
  if (!hexWithinBounds(action.destination, state.map.width, state.map.height)) {
    return error(action, 'outside_map', 'Destination is outside the map');
  }
  const visible = getPlayerVisibleTileKeys(state);
  const destinationUnit = getUnitAt(state, action.destination);
  if (destinationUnit && (destinationUnit.isPlayerUnit || visible.has(hexKey(destinationUnit.position)))) {
    return error(action, 'occupied_destination', 'Destination is occupied');
  }
  const publicBlocked = new Set(
    state.units
      .filter((candidate) => candidate.id !== unit.id && (candidate.isPlayerUnit || visible.has(hexKey(candidate.position))))
      .map((candidate) => hexKey(candidate.position)),
  );
  const path = findShortestPath(
    state.map,
    unit.position,
    action.destination,
    publicBlocked,
    (position) => effectiveMovementCost(state, position),
  );
  if (!path) {
    return error(action, 'no_path', 'No path is available');
  }
  if (path.length <= 1 || pathMovementCost(path, (position) => effectiveMovementCost(state, position)) > unit.movement) {
    return error(action, 'out_of_range', 'Destination exceeds movement range');
  }
  return { unit, path };
}

function reachableDestinations(state: GameState, unit: UnitState): HexCoord[] {
  const visible = getPlayerVisibleTileKeys(state);
  const blocked = new Set(
    state.units
      .filter((candidate) => candidate.id !== unit.id && (candidate.isPlayerUnit || visible.has(hexKey(candidate.position))))
      .map((candidate) => hexKey(candidate.position)),
  );
  return findReachableTiles(
    state.map,
    unit.position,
    unit.movement,
    blocked,
    (position) => effectiveMovementCost(state, position),
  );
}

/** Pure movement preview shared by the UI and action validation. */
export function previewMove(state: Readonly<GameState>, unitId: string, destination: HexCoord): MovePreview {
  const snapshot = cloneState(state as GameState);
  const initiallyVisible = getPlayerVisibleTileKeys(snapshot);
  const candidate = getMovePath(snapshot, { type: 'Move', unitId, destination });
  if ('code' in candidate) {
    return { legal: false, reason: candidate.message, path: [], reached: null, interception: null };
  }
  const mover = candidate.unit;
  for (const position of candidate.path.slice(1)) {
    const interceptors = interceptorsAt(snapshot, mover, position)
      .filter((interceptor) => initiallyVisible.has(hexKey(interceptor.position)));
    if (interceptors[0]) {
      return {
        legal: true,
        reason: null,
        path: candidate.path,
        reached: { ...position },
        interception: { interceptorId: interceptors[0].id, position: { ...position } },
      };
    }
  }
  return {
    legal: true,
    reason: null,
    path: candidate.path,
    reached: { ...destination },
    interception: null,
  };
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

function eligibleSnapshotCities(
  state: GameState,
  order: 'supply' | 'reception',
): FacilityState[] {
  if (state.cityPopulationSnapshot.turn !== state.turn) return [];
  return state.cityPopulationSnapshot[order]
    .filter((entry) => entry.eligible)
    .map((entry) => getFacilityState(state, entry.facilityId))
    .filter(
      (facility): facility is FacilityState =>
        facility !== undefined &&
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        facility.populationOperationalTurn <= state.turn &&
        isCityFacility(facility),
    );
}

function availableSupplyPopulation(state: GameState): number {
  return eligibleSnapshotCities(state, 'supply').reduce((total, city) => total + city.workers, 0);
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
  target.workers -= converted;
  target.infected += converted;
  target.operationalStatus = 'infected';
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
  state.population.cumulativeDepartures += screened - acceptedWorkers;
  state.statistics.refugeesDeparted += screened - acceptedWorkers;
  state.statistics.refugeesScreenedByPolicy[checkpoint.screeningPolicy] += screened;
  state.statistics.refugeesAccepted += acceptedWorkers;
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
    checkpoint.infected += converted;
    if (converted > 0) {
      emit(state, 'latent_infection', { checkpointId: checkpoint.id, infected: converted, pool: 'checkpoint' });
    }
    if (totalCheckpointPeople(checkpoint) === 0 && checkpoint.infected > 0) {
      overrunCheckpoint(state, checkpoint, rng);
    }
  }
}

function removeEmptyCheckpointRemnants(state: GameState): void {
  const removed = state.checkpoints.filter(
    (checkpoint) =>
      checkpoint.status === 'remnant' &&
      totalCheckpointPeople(checkpoint) === 0 &&
      checkpoint.infected === 0,
  );
  for (const checkpoint of removed) {
    state.checkpoints.splice(state.checkpoints.findIndex((candidate) => candidate.id === checkpoint.id), 1);
    state.statistics.checkpointsRemoved += 1;
    emit(state, 'checkpoint_removed', {
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
      reason: 'remnant_empty',
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
    const checkpoint = branch.activeCheckpointId
      ? state.checkpoints.find(
        (candidate) => candidate.id === branch.activeCheckpointId && candidate.status === 'operational',
      )
      : state.checkpoints.find(
        (candidate) =>
          candidate.status === 'operational' &&
          (candidate.branchId ?? candidate.direction) === branch.branchId,
      );
    if (!checkpoint) state.statistics.unmanagedBranchTurns += 1;
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
    if (checkpoint.screening === 0 && checkpoint.waiting > 0) {
      const batch = Math.min(checkpoint.waiting, state.config.refugees.screeningCapacity);
      checkpoint.waiting -= batch;
      checkpoint.screening = batch;
      checkpoint.screeningPolicy = checkpoint.currentPolicy;
      checkpoint.remainingTurns = state.config.refugees.policies[checkpoint.currentPolicy].turns;
      if (checkpoint.remainingTurns === 0) {
        resolveScreeningBatch(state, checkpoint, rng);
      }
    }
  }
  removeEmptyCheckpointRemnants(state);
}

function emptyFacilityProjection(
  facility: Readonly<FacilityState>,
  stoppedReason: FacilityProductionProjection['stoppedReason'],
): FacilityProductionProjection {
  return {
    facilityId: facility.id,
    operatingWorkers: 0,
    inputs: {},
    outputs: {},
    powerGeneration: 0,
    powerMode: 'none',
    powerSupplyEnabled: false,
    projectedPowerRequested: false,
    projectedPowerSupplied: false,
    projectedPowerReason: 'not_applicable',
    lastPowerSupplied: facility.lastPowerSupplied,
    productionMultiplier: 1,
    baseOutputs: {},
    stoppedReason,
  };
}

function facilityStoppedReason(facility: Readonly<FacilityState>): FacilityProductionProjection['stoppedReason'] {
  if (facility.status === 'ruined') return 'ruined';
  if (facility.infected > 0) return 'infection';
  if (facility.owner !== 'player' || facility.status !== 'owned') return 'not_owned';
  if (facility.workers <= 0) return 'no_workers';
  if (facility.operationalStatus !== 'operational') return 'power_unavailable';
  return null;
}

interface EconomyPlan {
  forecast: EndTurnForecast;
  facilities: FacilityProductionProjection[];
}

function calculateEconomyPlan(state: Readonly<GameState>): EconomyPlan {
  const facilities = stableFacilities(state as GameState);
  const isOwned = (facility: Readonly<FacilityState>) => facility.owner === 'player' && facility.status === 'owned';
  const canProduce = (facility: Readonly<FacilityState>) => isOwned(facility) && facility.infected === 0 && facility.workers > 0;
  const consumers = state.facilities.reduce(
    (total, facility) => total + (facility.owner === 'player' ? facility.workers : 0),
    state.population.unitPopulation,
  );
  const overcrowding = overcrowdingTerms(state);
  const normalFood = consumers * state.config.economy.populationConsumption.food;
  const normalCivilian = consumers * state.config.economy.populationConsumption.civilianGoods;
  const maintenance = {
    food: normalFood + overcrowdingAdditionalConsumption(normalFood, overcrowding),
    civilianGoods: normalCivilian + overcrowdingAdditionalConsumption(normalCivilian, overcrowding),
    militaryGoods: state.population.unitPopulation * state.config.economy.militaryGoodsPerUnitPopulation,
  };

  const physicalGenerationCapacity = facilities
    .filter((facility) => facility.type === 'powerPlant' && canProduce(facility))
    .reduce((total, facility) => total + facility.workers * state.config.facilities.powerPlant.production.powerGeneration, 0);
  const fuelLimitedGenerationCapacity = state.resources.fuel * 5;
  const availableGenerationCapacity = Math.floor(
    Math.min(physicalGenerationCapacity, fuelLimitedGenerationCapacity) / 5,
  ) * 5;
  let remainingPower = availableGenerationCapacity;
  const supplied = new Set<string>();
  const requested = new Set<string>();
  const reasons = new Map<string, PowerSupplyReason>();
  const allocate = (targets: FacilityState[]): number => {
    let allocated = 0;
    let lostInTier = false;
    for (const facility of targets) {
      const demand = state.config.facilities[facility.type].production.powerCapacity;
      requested.add(facility.id);
      if (remainingPower >= demand) {
        remainingPower -= demand;
        allocated += demand;
        supplied.add(facility.id);
        reasons.set(facility.id, 'supplied');
      } else {
        const underlying: PowerSupplyReason = physicalGenerationCapacity <= fuelLimitedGenerationCapacity
          ? 'physical_capacity_shortage'
          : 'fuel_shortage';
        reasons.set(facility.id, lostInTier ? 'allocation_priority' : underlying);
        lostInTier = true;
      }
    }
    return allocated;
  };

  const requiredTargets = facilities.filter(
    (facility) => isOwned(facility) && isCityFacility(facility) && facility.workers > 0,
  );
  const requiredPowerDemand = requiredTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  const requiredPowerAllocated = allocate(requiredTargets);

  const maintenanceTargets = facilities.filter(
    (facility) =>
      isOwned(facility) &&
      facility.workers > 0 &&
      ['farm', 'civilianFactory'].includes(facility.type) &&
      facility.powerSupplyEnabled,
  );
  const maintenancePowerAllocated = allocate(maintenanceTargets);

  const staffed = (facility: FacilityState) => isCityFacility(facility)
    ? Math.min(facility.workers, state.config.facilities[facility.type].workerCapacity)
    : facility.workers;
  const preliminaryCivilianProduction = facilities.reduce((total, facility) => {
    if (!canProduce(facility)) return total;
    const rule = state.config.facilities[facility.type].production;
    const perWorker = rule.outputs.civilianGoods ?? 0;
    if (perWorker <= 0 || facility.type === 'militaryFactory') return total;
    if (rule.powerMode === 'required' && !supplied.has(facility.id)) return total;
    const multiplier = rule.powerMode === 'boost' && supplied.has(facility.id) ? 2 : 1;
    return total + staffed(facility) * perWorker * multiplier;
  }, 0);
  const maintenanceReservation = Math.max(0, maintenance.civilianGoods - preliminaryCivilianProduction);
  let civilianInputAvailable = Math.max(0, state.resources.civilianGoods - maintenanceReservation);
  const militaryInputWorkers = new Map<string, number>();
  const militaryFacilities = facilities.filter(
    (facility) => facility.type === 'militaryFactory' && canProduce(facility),
  );
  for (const facility of militaryFacilities) {
    const perWorker = state.config.facilities.militaryFactory.production.inputs.civilianGoods ?? 0;
    const workers = perWorker > 0
      ? Math.min(facility.workers, Math.floor(civilianInputAvailable / perWorker))
      : facility.workers;
    militaryInputWorkers.set(facility.id, workers);
    civilianInputAvailable -= workers * perWorker;
  }
  const militaryTargets = militaryFacilities.filter(
    (facility) => facility.powerSupplyEnabled && (militaryInputWorkers.get(facility.id) ?? 0) > 0,
  );
  const militaryPowerAllocated = allocate(militaryTargets);

  const projections = facilities.map((facility): FacilityProductionProjection => {
    const rule = state.config.facilities[facility.type].production;
    const eligible = isOwned(facility) && facility.workers > 0;
    let projectedPowerReason: PowerSupplyReason = reasons.get(facility.id) ?? 'not_applicable';
    let projectedPowerRequested = requested.has(facility.id);
    if (rule.powerMode === 'boost' && !facility.powerSupplyEnabled) projectedPowerReason = 'power_supply_off';
    else if (!eligible && rule.powerMode !== 'none') projectedPowerReason = facility.workers <= 0 ? 'no_population' : 'not_eligible';
    else if (facility.type === 'militaryFactory' && canProduce(facility) && (militaryInputWorkers.get(facility.id) ?? 0) === 0) {
      projectedPowerReason = 'production_input_unavailable';
      projectedPowerRequested = false;
    }
    const projectedPowerSupplied = supplied.has(facility.id);
    const productionMultiplier = rule.powerMode === 'boost' && projectedPowerSupplied ? 2 : 1;
    const operatingWorkers = !canProduce(facility)
      ? 0
      : facility.type === 'militaryFactory'
        ? militaryInputWorkers.get(facility.id) ?? 0
        : staffed(facility);
    const baseOutputs = Object.fromEntries(
      Object.entries(rule.outputs).map(([resource, amount]) => [resource, amount * operatingWorkers]),
    ) as Partial<Record<ResourceType, number>>;
    const outputs = rule.powerMode === 'required' && !projectedPowerSupplied
      ? {}
      : Object.fromEntries(
        Object.entries(baseOutputs).map(([resource, amount]) => [resource, (amount ?? 0) * productionMultiplier]),
      ) as Partial<Record<ResourceType, number>>;
    const inputs = facility.type === 'militaryFactory'
      ? { civilianGoods: (rule.inputs.civilianGoods ?? 0) * operatingWorkers }
      : {};
    const stoppedReason = !canProduce(facility)
      ? facilityStoppedReason(facility)
      : rule.powerMode === 'required' && !projectedPowerSupplied
        ? 'power_unavailable'
        : facility.type === 'militaryFactory' && operatingWorkers < facility.workers
          ? 'input_shortage'
          : null;
    return {
      facilityId: facility.id,
      operatingWorkers,
      inputs,
      outputs,
      powerGeneration: facility.type === 'powerPlant' && canProduce(facility)
        ? rule.powerGeneration * facility.workers
        : 0,
      powerMode: rule.powerMode,
      powerSupplyEnabled: facility.powerSupplyEnabled,
      projectedPowerRequested,
      projectedPowerSupplied,
      projectedPowerReason,
      lastPowerSupplied: facility.lastPowerSupplied,
      productionMultiplier,
      baseOutputs,
      stoppedReason,
    };
  });
  const production = (resource: ResourceType) => projections.reduce(
    (total, projection) => total + (projection.outputs[resource] ?? 0),
    0,
  );
  const militaryInputDemand = militaryFacilities.reduce(
    (total, facility) => total + facility.workers * (state.config.facilities.militaryFactory.production.inputs.civilianGoods ?? 0),
    0,
  );
  const militaryInputAllocated = projections.reduce(
    (total, projection) => total + (projection.inputs.civilianGoods ?? 0),
    0,
  );
  const industrialBoostDemand = [...maintenanceTargets, ...militaryTargets].reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  const industrialBoostAllocated = maintenancePowerAllocated + militaryPowerAllocated;
  const generationFuelDemand = (requiredPowerDemand + industrialBoostDemand) / 5;
  const projectedFuelUsed = (requiredPowerAllocated + industrialBoostAllocated) / 5;
  const resourceForecast = (
    resource: 'food' | 'militaryGoods',
    maintenanceRequired: number,
  ): EndTurnForecast['food'] => {
    const startingStock = state.resources[resource];
    const projectedProduction = production(resource);
    const shortage = Math.max(0, maintenanceRequired - startingStock - projectedProduction);
    return {
      startingStock,
      projectedProduction,
      maintenanceRequired,
      endingStock: Math.max(0, startingStock + projectedProduction - maintenanceRequired),
      available: startingStock,
      productionInputRequired: 0,
      required: maintenanceRequired,
      shortage,
    };
  };
  const civilianStarting = state.resources.civilianGoods;
  const civilianProduction = production('civilianGoods');
  const civilianShortage = Math.max(
    0,
    maintenance.civilianGoods - (civilianStarting - militaryInputAllocated + civilianProduction),
  );
  const fuelProduction = production('fuel');
  const fuelEnding = Math.max(0, state.resources.fuel - projectedFuelUsed + fuelProduction);
  const unpoweredFacilities = projections
    .filter((projection) => projection.powerMode !== 'none' && !projection.projectedPowerSupplied)
    .map((projection) => ({ facilityId: projection.facilityId, reason: projection.projectedPowerReason }));
  const totalPowerDemand = requiredPowerDemand + industrialBoostDemand;
  return {
    facilities: projections,
    forecast: {
      populationConsumers: consumers,
      overcrowding: {
        cities: overcrowding,
        additionalFood: maintenance.food - normalFood,
        additionalCivilianGoods: maintenance.civilianGoods - normalCivilian,
      },
      food: resourceForecast('food', maintenance.food),
      civilianGoods: {
        startingStock: civilianStarting,
        projectedProduction: civilianProduction,
        maintenanceRequired: maintenance.civilianGoods,
        productionInputDemand: militaryInputDemand,
        productionInputAllocated: militaryInputAllocated,
        productionInputShortage: Math.max(0, militaryInputDemand - militaryInputAllocated),
        endingStock: Math.max(0, civilianStarting - militaryInputAllocated + civilianProduction - maintenance.civilianGoods),
        maintenanceShortage: civilianShortage,
        available: civilianStarting,
        productionInputRequired: militaryInputDemand,
        required: maintenance.civilianGoods + militaryInputDemand,
        shortage: civilianShortage,
      },
      militaryGoods: resourceForecast('militaryGoods', maintenance.militaryGoods),
      fuel: {
        startingStock: state.resources.fuel,
        projectedProduction: fuelProduction,
        maintenanceRequired: 0,
        generationFuelDemand,
        projectedFuelUsed,
        generationFuelShortage: Math.max(0, generationFuelDemand - state.resources.fuel),
        endingStock: fuelEnding,
        available: state.resources.fuel,
        productionInputRequired: generationFuelDemand,
        required: generationFuelDemand,
        shortage: Math.max(0, generationFuelDemand - state.resources.fuel),
      },
      electricity: {
        physicalGenerationCapacity,
        fuelLimitedGenerationCapacity,
        availableGenerationCapacity,
        requiredPowerDemand,
        industrialBoostDemand,
        requiredPowerAllocated,
        industrialBoostAllocated,
        unpoweredFacilities,
        capacity: physicalGenerationCapacity,
        required: totalPowerDemand,
        shortage: Math.max(0, totalPowerDemand - requiredPowerAllocated - industrialBoostAllocated),
      },
    },
  };
}

function removeWorkersForShortage(state: GameState, amount: number, resource: 'food' | 'civilianGoods'): number {
  let remaining = Math.max(0, Math.floor(amount));
  let removed = 0;
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

function overcrowdingTerms(state: Readonly<GameState>): Array<{ facilityId: string; excess: number; softCap: number }> {
  return state.facilities
    .filter(
      (facility) =>
        facility.owner === 'player' && facility.status === 'owned' && isCityFacility(facility),
    )
    .map((facility) => ({
      facilityId: facility.id,
      excess: Math.max(0, facility.workers - state.config.facilities[facility.type].workerCapacity),
      softCap: state.config.facilities[facility.type].workerCapacity,
    }))
    .filter((term) => term.excess > 0)
    .sort((left, right) => left.facilityId.localeCompare(right.facilityId));
}

function gcdBigInt(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function overcrowdingAdditionalConsumption(normal: number, terms: ReturnType<typeof overcrowdingTerms>): number {
  if (normal <= 0 || terms.length === 0) return 0;
  let numerator = 0n;
  let denominator = 1n;
  for (const term of terms) {
    numerator = numerator * BigInt(term.softCap) + BigInt(term.excess) * denominator;
    denominator *= BigInt(term.softCap);
    const divisor = gcdBigInt(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  const amount = (BigInt(normal) * numerator + denominator - 1n) / denominator;
  return Math.max(1, Number(amount));
}

/**
 * Predict economy requirements for the current player turn without mutating
 * GameState.  The calculation intentionally uses the same secured-order and
 * electricity rules as the economy phase, while exposing full staffing input
 * demand so the UI can warn before partial fuel operation is resolved.
 */
export function forecastEndTurn(state: Readonly<GameState>): EndTurnForecast {
  return calculateEconomyPlan(state).forecast;
}

function processEconomy(state: GameState): FacilityProductionProjection[] {
  synchronizePopulation(state);
  const plan = calculateEconomyPlan(state);
  const forecast = plan.forecast;
  state.resources.food = forecast.food.endingStock;
  state.resources.civilianGoods = forecast.civilianGoods.endingStock;
  state.resources.militaryGoods = forecast.militaryGoods.endingStock;
  state.resources.fuel = forecast.fuel.endingStock;
  state.resources.electricityCapacity = forecast.electricity.physicalGenerationCapacity;
  state.resources.electricityRequired = forecast.electricity.required;
  state.resources.militarySupplyAvailable = forecast.militaryGoods.shortage === 0;

  for (const projection of plan.facilities) {
    const facility = getFacilityState(state, projection.facilityId)!;
    if (projection.powerMode === 'required' || projection.powerMode === 'boost') {
      facility.lastPowerSupplied = projection.projectedPowerSupplied;
    }
    facility.operationalStatus = facility.status === 'ruined'
      ? 'ruined'
      : facility.infected > 0
        ? 'infected'
        : facility.workers > 0
          ? 'operational'
          : 'stopped';
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
  emit(state, 'resource_consumed', {
    resource: 'militaryGoods',
    amount: forecast.militaryGoods.maintenanceRequired - forecast.militaryGoods.shortage,
    population: state.population.unitPopulation,
  });
  if (forecast.militaryGoods.shortage > 0) {
    emit(state, 'resource_shortage', { resource: 'militaryGoods', amount: forecast.militaryGoods.shortage });
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
export function forecastFacilityProduction(
  state: Readonly<GameState>,
): FacilityProductionProjection[] {
  return calculateEconomyPlan(state).facilities;
}

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
  unitType: 'zombie' | 'hordeZombie' = 'zombie',
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
    const prefix = unitType === 'hordeZombie' ? 'horde-zombie' : 'zombie';
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

function spawnHordeComposition(
  state: GameState,
  origin: HexCoord,
  composition: { hordeZombie: number; zombie: number },
  rng: SeededRng,
  cause: string,
  spawnGroupId: string,
  hordeKind: Exclude<UnitState['hordeKind'], null>,
): UnitState[] {
  const hordeUnits = spawnZombies(
    state, origin, composition.hordeZombie, rng, cause, 'hordeZombie', spawnGroupId, hordeKind,
  );
  const normalUnits = spawnZombies(
    state,
    origin,
    composition.zombie,
    rng,
    cause,
    'zombie',
    spawnGroupId,
    hordeKind,
    (position) => hordeUnits.some((horde) => hexDistance(position, horde.position) <= horde.vision),
  );
  return [...hordeUnits, ...normalUnits];
}

function overrunFacility(state: GameState, facility: FacilityState, rng: SeededRng): void {
  if (facility.status === 'ruined') {
    return;
  }
  facility.status = 'ruined';
  // Ruined facilities are no longer owned. Recovery by a stationed player
  // unit claims the site again after its internal infection reaches zero.
  facility.owner = 'none';
  facility.operationalStatus = 'ruined';
  const capacityFallback = facility.workerCapacity * state.config.infection.fallBackCapacityRate;
  const rounded = state.config.infection.fallBackCapacityRounding === 'ceil' ? Math.ceil(capacityFallback) : Math.floor(capacityFallback);
  const previousInfected = facility.infected;
  facility.infected = Math.max(facility.infected, rounded);
  const discoveredInfected = facility.infected - previousInfected;
  state.population.cumulativeDiscoveredInfected += discoveredInfected;
  facility.workers = 0;
  emit(state, 'facility_overrun', { facilityId: facility.id, discoveredInfected });
  spawnZombies(state, facility.position, state.config.facilities[facility.type].overrunSpawnCount, rng, 'facility_overrun');
}

function overrunCheckpoint(state: GameState, checkpoint: CheckpointState, rng: SeededRng): void {
  if (checkpoint.overrunProcessed || checkpoint.status === 'abandoned') {
    return;
  }
  const wasOperational = checkpoint.status === 'operational';
  const beforeSupply = wasOperational ? getSuppliedTileKeys(state) : [];
  checkpoint.overrunProcessed = true;
  if (wasOperational) {
    checkpoint.status = 'ruined';
    const branch = getRoadBranchState(state, checkpoint.branchId ?? checkpoint.direction);
    if (branch?.activeCheckpointId === checkpoint.id) branch.activeCheckpointId = null;
    state.statistics.checkpointsRuined += 1;
  }
  const previousInfected = checkpoint.infected;
  checkpoint.infected = Math.max(
    checkpoint.infected,
    Math.ceil(state.config.refugees.screeningCapacity * state.config.infection.fallBackCapacityRate),
  );
  const discoveredInfected = checkpoint.infected - previousInfected;
  state.population.cumulativeDiscoveredInfected += discoveredInfected;
  checkpoint.waiting = 0;
  checkpoint.screening = 0;
  checkpoint.approved = 0;
  checkpoint.remainingTurns = 0;
  emit(state, 'facility_overrun', {
    checkpointId: checkpoint.id,
    branchId: checkpoint.branchId ?? checkpoint.direction,
    discoveredInfected,
    previousStatus: wasOperational ? 'operational' : checkpoint.status,
  });
  spawnZombies(state, checkpoint.position, state.config.facilities.capital.overrunSpawnCount, rng, 'checkpoint_overrun');
  if (wasOperational) {
    emitSupplyChanged(state, checkpoint.branchId ?? checkpoint.direction, beforeSupply, 'checkpoint_ruined');
  }
}

function suppressFacility(state: GameState, facility: FacilityState, unit: UnitState): boolean {
  if (!unit.canAttack || unit.activity.attacked || unit.activity.intercepted || facility.infected <= 0) {
    return false;
  }
  const amount = unit.type === 'police' ? state.config.infection.policeSuppression : state.config.infection.nationalGuardSuppression;
  const suppressed = Math.min(facility.infected, amount);
  facility.infected -= suppressed;
  state.population.cumulativeDeaths += suppressed;
  if (unit.type === 'nationalGuard') {
    const civilianLosses = Math.min(
      facility.workers,
      Math.ceil(amount * state.config.infection.nationalGuardCivilianDamageRate),
    );
    facility.workers -= civilianLosses;
    state.statistics.civilianLosses += civilianLosses;
    state.population.cumulativeDeaths += civilianLosses;
  }
  unit.canAttack = false;
  unit.canMove = false;
  unit.actionState = 'acted';
  unit.activity.suppressed = true;
  emit(state, 'infection_suppressed', { facilityId: facility.id, unitId: unit.id, remaining: facility.infected });
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
  if (!unit.canAttack || unit.activity.attacked || unit.activity.intercepted || checkpoint.infected <= 0) {
    return false;
  }
  const beforeSupply = checkpoint.status === 'ruined' ? getSuppliedTileKeys(state) : [];
  const amount = unit.type === 'police' ? state.config.infection.policeSuppression : state.config.infection.nationalGuardSuppression;
  const suppressed = Math.min(checkpoint.infected, amount);
  checkpoint.infected -= suppressed;
  state.population.cumulativeDeaths += suppressed;
  if (unit.type === 'nationalGuard') {
    const civilianLosses = removeCheckpointPeople(
      checkpoint,
      Math.ceil(amount * state.config.infection.nationalGuardCivilianDamageRate),
    );
    state.statistics.civilianLosses += civilianLosses;
    state.population.cumulativeDeaths += civilianLosses;
  }
  unit.canAttack = false;
  unit.canMove = false;
  unit.actionState = 'acted';
  unit.activity.suppressed = true;
  emit(state, 'infection_suppressed', { checkpointId: checkpoint.id, unitId: unit.id, remaining: checkpoint.infected });
  if (checkpoint.infected === 0 && checkpoint.status === 'ruined') {
    const branch = getRoadBranchState(state, checkpoint.branchId ?? checkpoint.direction);
    checkpoint.status = 'operational';
    checkpoint.overrunProcessed = false;
    if (branch) branch.activeCheckpointId = checkpoint.id;
    state.statistics.checkpointsRecovered += 1;
    emit(state, 'checkpoint_recovered', {
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
      unitId: unit.id,
    });
    emitSupplyChanged(state, checkpoint.branchId ?? checkpoint.direction, beforeSupply, 'checkpoint_recovered');
  } else if (
    checkpoint.infected === 0 &&
    (checkpoint.status === 'abandoned' ||
      (checkpoint.status === 'remnant' && totalCheckpointPeople(checkpoint) === 0))
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
      suppressFacility(state, facility, occupant!);
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
      suppressCheckpoint(state, checkpoint, occupant!, rng);
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
  reason: 'visible_population' | 'inherited_horde' | 'capital' | 'idle';
  inheritedTarget: HexCoord | null;
  inheritedChanged: 'set' | 'cleared' | null;
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
    add(facility.position, facility.workers);
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
  const candidates = destinations
    .map((destination) => {
      const path = findShortestPath(
        state.map,
        zombie.position,
        destination,
        occupied,
        (position) => effectiveMovementCost(state, position),
      );
      return path
        ? { path, cost: pathMovementCost(path, (position) => effectiveMovementCost(state, position)) }
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

function targetDecisionSnapshot(state: GameState, rng: SeededRng): Map<string, ZombieDecision> {
  const snapshot = cloneState(state);
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
    });
  }
  for (const zombie of snapshot.units.filter((unit) => unit.type === 'zombie').sort((a, b) => a.id.localeCompare(b.id))) {
    const visible = chooseVisiblePopulationTarget(snapshot, zombie, rng);
    if (visible) {
      decisions.set(zombie.id, {
        target: visible.position,
        reason: 'visible_population',
        inheritedTarget: zombie.inheritedTarget,
        inheritedChanged: null,
      });
      continue;
    }
    let memory = zombie.inheritedTarget;
    let inheritedChanged: ZombieDecision['inheritedChanged'] = null;
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
      }
    }
    decisions.set(zombie.id, {
      target: memory,
      reason: memory ? 'inherited_horde' : 'idle',
      inheritedTarget: memory,
      inheritedChanged,
    });
  }
  return decisions;
}

function processZombieTurn(state: GameState, rng: SeededRng): void {
  const decisions = targetDecisionSnapshot(state, rng);
  const zombieIds = state.units
    .filter((unit) => unit.type === 'zombie' || unit.type === 'hordeZombie')
    .map((unit) => unit.id)
    .sort();
  for (const zombieId of zombieIds) {
    const zombie = getUnit(state, zombieId);
    if (!zombie) continue;
    const decision = decisions.get(zombieId) ?? { target: null, reason: 'idle' as const, inheritedTarget: null, inheritedChanged: null };
    if (zombie.type === 'zombie') {
      zombie.inheritedTarget = decision.inheritedTarget ? { ...decision.inheritedTarget } : null;
      if (decision.inheritedChanged === 'set') {
        state.statistics.hordeTargetInheritedCount += 1;
        emit(state, 'horde_target_inherited', { zombieId, q: decision.target!.q, r: decision.target!.r });
      } else if (decision.inheritedChanged === 'cleared') {
        state.statistics.hordeTargetClearedCount += 1;
        emit(state, 'horde_target_cleared', { zombieId });
      }
    }
    const immediateTarget = zombie.canAttack ? nearestAttackableHuman(state, zombie) : null;
    if (immediateTarget) {
      resolveCombat(state, zombie, immediateTarget, 'attack');
      continue;
    }
    if (!decision.target) {
      if (zombie.type === 'zombie') {
        state.statistics.normalZombieIdleCount += 1;
        emit(state, 'zombie_idle', { zombieId });
      }
      continue;
    }
    const target: HumanTarget = { position: decision.target, population: 0 };
    const route = targetPath(state, zombie, target);
    const path = route?.path ?? null;
    if (path && path.length > 1) {
      applyMovement(state, zombie, path, zombie.movement);
    }
    const survivor = getUnit(state, zombieId);
    const afterMoveTarget = survivor?.canAttack ? nearestAttackableHuman(state, survivor) : null;
    if (survivor && afterMoveTarget) {
      resolveCombat(state, survivor, afterMoveTarget, 'attack');
    }
    if (checkImmediateDefeat(state)) return;
  }
}

function processZombieInfection(state: GameState, rng: SeededRng): void {
  const zombies = state.units
    .filter((unit) => unit.type === 'zombie' || unit.type === 'hordeZombie')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const zombie of zombies) {
    const tile = getTile(state.map, zombie.position);
    if (tile?.facilityId) {
      const facility = getFacilityState(state, tile.facilityId);
        if (facility && facility.status !== 'ruined') {
        const converted = Math.min(zombie.attack, facility.workers);
        facility.workers -= converted;
        facility.infected += converted;
        if (converted > 0) facility.operationalStatus = 'infected';
        if (converted > 0) {
          state.statistics.civilianLosses += converted;
          state.statistics.infectionLosses += converted;
          emit(state, 'infection_spread', { facilityId: facility.id, amount: converted, source: zombie.id });
        }
        if (facility.workers === 0 && (converted > 0 || facility.infected > 0)) {
          overrunFacility(state, facility, rng);
        }
      }
    }
    const checkpoint = getCheckpointAt(state, zombie.position);
    if (checkpoint && ['operational', 'remnant'].includes(checkpoint.status)) {
      const converted = removeCheckpointPeople(checkpoint, zombie.attack);
      checkpoint.infected += converted;
      if (converted > 0) {
        state.statistics.civilianLosses += converted;
        state.statistics.infectionLosses += converted;
        emit(state, 'infection_spread', { checkpointId: checkpoint.id, amount: converted, source: zombie.id });
      }
      // An empty operational checkpoint is still destroyed by zombie occupation.
      if (totalCheckpointPeople(checkpoint) === 0 && (checkpoint.status === 'operational' || checkpoint.infected > 0)) {
        overrunCheckpoint(state, checkpoint, rng);
      }
    }
    if (checkImmediateDefeat(state)) return;
  }
  synchronizePopulation(state);
}

function processHorde(state: GameState, rng: SeededRng): void {
  const due = state.horde.nextSpawnTurn !== null && state.turn === state.horde.nextSpawnTurn;
  if (!due) {
    state.horde.turnsRemaining = Math.max(0, (state.horde.nextSpawnTurn ?? state.turn) - state.turn);
    return;
  }
  const entrance = getHordeEntrance(state.map, state.horde.nextDirection);
  if (state.turn === state.finalHordeTurn) {
    const groupId = `final-horde-${state.turn}`;
    const composition = state.config.horde.finalComposition;
    const spawned = entrance
      ? spawnHordeComposition(state, entrance.tile, composition, rng, 'final_horde', groupId, 'final')
      : [];
    const hordeZombieCount = spawned.filter((unit) => unit.type === 'hordeZombie').length;
    const zombieCount = spawned.filter((unit) => unit.type === 'zombie').length;
    const count = spawned.length;
    state.horde.finalSpawnGroupId = groupId;
    state.horde.finalSpawnedCount = count;
    state.horde.finalHordeStatus = 'active';
    state.horde.nextSpawnTurn = null;
    state.horde.turnsRemaining = 0;
    state.horde.warningType = 'none';
    state.horde.lastSpawnTurn = state.turn;
    state.statistics.finalHordeSpawned = count;
    state.statistics.finalHordeZombiesSpawned += hordeZombieCount;
    state.statistics.finalNormalZombiesSpawned += zombieCount;
    state.horde.totalSpawned += count;
    emit(state, 'horde_spawned', {
      hordeKind: 'final',
      direction: entrance?.direction ?? state.horde.nextDirection,
      spawnGroupId: groupId,
      hordeZombieCount,
      normalZombieCount: zombieCount,
      units: spawned.map((unit) => ({
        unitId: unit.id,
        unitType: unit.type,
        spawnGroupId: groupId,
        hordeKind: 'final',
        q: unit.position.q,
        r: unit.position.r,
      })),
    });
    return;
  }
  if (state.turn > state.finalHordeTurn) return;
  const composition = {
    hordeZombie: state.config.horde.periodicInitial.hordeZombie + state.horde.spawnedCount * state.config.horde.periodicIncrement.hordeZombie,
    zombie: state.config.horde.periodicInitial.zombie + state.horde.spawnedCount * state.config.horde.periodicIncrement.zombie,
  };
  const groupId = `periodic-horde-${state.turn}`;
  const spawned = entrance
    ? spawnHordeComposition(state, entrance.tile, composition, rng, 'periodic_horde', groupId, 'periodic')
    : [];
  const hordeZombieCount = spawned.filter((unit) => unit.type === 'hordeZombie').length;
  const zombieCount = spawned.filter((unit) => unit.type === 'zombie').length;
  const count = spawned.length;
  state.horde.spawnedCount += 1;
  state.horde.totalSpawned += count;
  state.statistics.periodicHordeZombiesSpawned += hordeZombieCount;
  state.statistics.periodicNormalZombiesSpawned += zombieCount;
  state.horde.lastSpawnTurn = state.turn;
  state.horde.nextDirection = rng.pick(['north', 'east', 'south', 'west'] as const);
  const nextPeriodic = state.turn + state.config.horde.cycle;
  state.horde.nextSpawnTurn = nextPeriodic < state.finalHordeTurn ? nextPeriodic : state.finalHordeTurn;
  state.horde.warningType = state.horde.nextSpawnTurn === state.finalHordeTurn ? 'final' : 'periodic';
  state.horde.turnsRemaining = state.horde.nextSpawnTurn - state.turn;
  emit(state, 'horde_spawned', {
    hordeKind: 'periodic',
    direction: entrance?.direction ?? 'north',
    spawnGroupId: groupId,
    hordeZombieCount,
    normalZombieCount: zombieCount,
    units: spawned.map((unit) => ({
      unitId: unit.id,
      unitType: unit.type,
      spawnGroupId: groupId,
      hordeKind: 'periodic',
      q: unit.position.q,
      r: unit.position.r,
    })),
  });
}

function finishGame(state: GameState, outcome: 'won' | 'lost', reason: GameOverReason): void {
  if (state.gameOver) return;
  synchronizePopulation(state);
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
    state.horde.finalSpawnGroupId !== null &&
    !state.units.some(
      (unit) => unit.spawnGroupId === state.horde.finalSpawnGroupId,
    );
  const suppliedAreaZombieClear = !state.units.some(
    (unit) =>
      (unit.type === 'zombie' || unit.type === 'hordeZombie') &&
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
  for (const branch of state.roadBranches) branch.checkpointActionsThisTurn = 0;
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
    unit.activity = { moved: false, attacked: false, intercepted: false, suppressed: false };
  }
  for (const zombie of state.units.filter((unit) => unit.type === 'zombie' || unit.type === 'hordeZombie')) {
    zombie.canAttack = true;
  }
  const orders = [...state.pendingUnitProductions].sort((left, right) => left.id.localeCompare(right.id));
  state.pendingUnitProductions = [];
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
    const nearestPositions = findNearestOpenTiles(state.map, city.position, occupiedKeys(state));
    const position = nearestPositions.length > 1 ? rng.pick(nearestPositions) : nearestPositions[0];
    if (!position) {
      state.pendingUnitProductions.push(order);
      continue;
    }
    state.units.push(createUnit(state, nextHumanUnitId(state, order.unitType), order.unitType, position));
  }
  createCityPopulationSnapshot(state);
  placeApprovedRefugees(state);
  removeEmptyCheckpointRemnants(state);
  synchronizePopulation(state);
  checkImmediateGameEnd(state);
  saveRng(state, rng);
}

function endTurn(state: GameState, rng: SeededRng): void {
  state.phase = 'economy';
  processEconomy(state);
  if (checkImmediateGameEnd(state)) return;
  state.phase = 'refugees';
  processRefugees(state, rng);
  synchronizePopulation(state);
  if (checkImmediateGameEnd(state)) return;
  state.phase = 'infection';
  processInternalInfection(state, rng);
  if (checkImmediateGameEnd(state)) return;
  state.phase = 'zombie';
  processZombieTurn(state, rng);
  if (checkImmediateGameEnd(state)) return;
  processZombieInfection(state, rng);
  if (checkImmediateGameEnd(state)) return;
  state.phase = 'horde';
  processHorde(state, rng);
  if (checkImmediateGameEnd(state)) return;
  state.turn += 1;
  if (state.turn > state.finalHordeTurn) state.statistics.turnsAfterFinalHorde += 1;
  state.actionsTakenThisTurn = 0;
  state.phase = 'player';
  state.horde.turnsRemaining = state.horde.nextSpawnTurn === null
    ? 0
    : Math.max(0, state.horde.nextSpawnTurn - (state.turn - 1));
  startPlayerTurn(state, rng);
}

function playerActionBudgetError(state: Readonly<GameState>, action: GameAction): ActionError | null {
  if (!isPlayerPhase(state)) return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) {
    return error(action, 'action_limit', 'The action limit for this turn has been reached');
  }
  return null;
}

function assignWorkers(state: GameState, action: Extract<GameAction, { type: 'AssignWorkers' }>): ActionError | null {
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
  const difference = action.workers - facility.workers;
  if (difference === 0) return error(action, 'no_change', 'Worker assignment is unchanged');
  let movements: Array<{ facilityId: string; people: number }> | null;
  if (difference > 0) {
    if (!isHexSupplied(state, facility.position)) {
      return error(action, 'facility_out_of_supply', 'Workers cannot be added outside the supply network');
    }
    if (availableSupplyPopulation(state) < difference) {
      return error(action, 'insufficient_city_population', 'Eligible cities cannot supply enough population');
    }
    movements = withdrawFromSupplyCities(state, difference);
  } else {
    if (eligibleSnapshotCities(state, 'reception').length === 0) {
      return error(action, 'no_safe_return_city', 'No eligible safe city can receive withdrawn workers');
    }
    movements = distributeToReceptionCities(state, -difference);
  }
  if (!movements) return error(action, 'population_move_failed', 'Population movement could not be completed');
  facility.workers = action.workers;
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

function transferPopulation(
  state: GameState,
  action: Extract<GameAction, { type: 'TransferPopulation' }>,
): ActionError | null {
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

function checkpointBranchInfectionBlocker(state: Readonly<GameState>, branchId: string): CheckpointState | undefined {
  return state.checkpoints.find(
    (checkpoint) =>
      (checkpoint.branchId ?? checkpoint.direction) === branchId &&
      ['operational', 'remnant'].includes(checkpoint.status) &&
      checkpoint.infected > 0,
  );
}

function checkpointForwardBlockers(state: Readonly<GameState>, branchId: string): CheckpointState[] {
  return state.checkpoints.filter(
    (checkpoint) =>
      (checkpoint.branchId ?? checkpoint.direction) === branchId &&
      ['ruined', 'abandoned'].includes(checkpoint.status) &&
      checkpoint.infected > 0,
  );
}

function validateCheckpointDestination(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' }>,
  branchId: string,
  ignoredCheckpointId?: string,
): ActionError | null {
  const tile = getTile(state.map, action.position);
  if (
    !tile?.road ||
    tile.facilityId ||
    state.checkpoints.some(
      (checkpoint) => checkpoint.id !== ignoredCheckpointId && hexKey(checkpoint.position) === hexKey(action.position),
    )
  ) {
    return error(action, 'invalid_checkpoint_tile', 'A checkpoint requires an empty branch road tile');
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
  const zombies = getBlockingZombiesForCheckpoint(state, branchId, action.position)
    .filter((zombie) => isVisibleToPlayer(state, zombie.position));
  if (zombies.length > 0) {
    return error(action, 'checkpoint_supply_zombie_blocked', `Checkpoint supply area contains zombie ${zombies[0]!.id}`);
  }
  if (state.resources.civilianGoods < state.config.checkpoint.constructionCivilianGoods) {
    return error(action, 'insufficient_civilian_goods', 'Not enough civilian goods');
  }
  return null;
}

function validateBuildCheckpointAction(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'BuildCheckpoint' }>,
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
  const existingActive = state.checkpoints.find(
    (checkpoint) =>
      checkpoint.status === 'operational' &&
      (checkpoint.branchId ?? checkpoint.direction) === branchId,
  );
  if (branch?.activeCheckpointId || existingActive) {
    return {
      branchId,
      error: error(action, 'checkpoint_requires_relocation', 'Use RelocateCheckpoint while this branch has an operational checkpoint'),
    };
  }
  if (checkpointBranchInfectionBlocker(state, branchId)) {
    return {
      branchId,
      error: error(action, 'checkpoint_infection_blocked', 'Operational checkpoints and remnants must be cleared before changing position'),
    };
  }
  return {
    branchId,
    error: validateCheckpointDestination(state, action, branchId),
  };
}

function validateRelocateCheckpointAction(
  state: Readonly<GameState>,
  action: Extract<GameAction, { type: 'RelocateCheckpoint' }>,
): { source: CheckpointState | null; branchId: string | null; error: ActionError | null } {
  const budget = playerActionBudgetError(state, action);
  if (budget) return { source: null, branchId: null, error: budget };
  const source = state.checkpoints.find((checkpoint) => checkpoint.id === action.checkpointId);
  if (!source || source.status !== 'operational') {
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
  if (checkpointBranchInfectionBlocker(state, branchId)) {
    return {
      source,
      branchId,
      error: error(action, 'checkpoint_infection_blocked', 'Operational checkpoints and remnants must be cleared before relocation'),
    };
  }
  return {
    source,
    branchId,
    error: validateCheckpointDestination(state, action, branchId, source.id),
  };
}

function createOperationalCheckpoint(
  state: GameState,
  branchId: string,
  position: HexCoord,
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
    currentPolicy: 'normal',
    nextArrivalTurn: branch?.nextArrivalTurn ?? null,
    infected: 0,
    overrunProcessed: false,
  };
  state.checkpoints.push(checkpoint);
  if (branch) branch.activeCheckpointId = checkpoint.id;
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
  const beforeSupply = getSuppliedTileKeys(state);
  state.resources.civilianGoods -= state.config.checkpoint.constructionCivilianGoods;
  const ruined = state.checkpoints.filter(
    (checkpoint) =>
      checkpoint.status === 'ruined' &&
      (checkpoint.branchId ?? checkpoint.direction) === branchId,
  );
  const checkpoint = createOperationalCheckpoint(state, branchId, action.position);
  for (const old of ruined) {
    old.status = 'abandoned';
    state.statistics.checkpointsAbandoned += 1;
    emit(state, 'checkpoint_abandoned', { checkpointId: old.id, branchId, replacementId: checkpoint.id });
  }
  if (branch) branch.checkpointActionsThisTurn += 1;
  state.actionsTakenThisTurn += 1;
  state.statistics.checkpointsBuilt += 1;
  if (ruined.length > 0) {
    state.statistics.checkpointRetreats += 1;
  }
  emit(state, 'checkpoint_built', {
    checkpointId: checkpoint.id,
    branchId,
    direction: checkpoint.direction,
    retreat: ruined.length > 0,
  });
  emitSupplyChanged(state, branchId, beforeSupply, ruined.length > 0 ? 'checkpoint_retreat' : 'checkpoint_built');
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
  state.resources.civilianGoods -= state.config.checkpoint.constructionCivilianGoods;
  source.status = 'remnant';
  const replacement = createOperationalCheckpoint(state, branchId, action.position);
  const branch = getRoadBranchState(state, branchId);
  if (branch) branch.checkpointActionsThisTurn += 1;
  state.actionsTakenThisTurn += 1;
  state.statistics.checkpointsRelocated += 1;
  emit(state, 'checkpoint_remnant_created', {
    checkpointId: source.id,
    branchId,
    replacementId: replacement.id,
  });
  emit(state, 'checkpoint_relocated', {
    checkpointId: replacement.id,
    sourceCheckpointId: source.id,
    branchId,
  });
  removeEmptyCheckpointRemnants(state);
  emitSupplyChanged(state, branchId, beforeSupply, 'checkpoint_relocated');
  return null;
}

function setCheckpointPolicy(state: GameState, action: Extract<GameAction, { type: 'SetCheckpointPolicy' }>): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const checkpoint = state.checkpoints.find((candidate) => candidate.id === action.checkpointId);
  if (!checkpoint || !['operational', 'remnant'].includes(checkpoint.status)) return error(action, 'unknown_checkpoint', 'Checkpoint does not accept policy changes');
  if (!['passThrough', 'normal', 'strict'].includes(action.policy)) return error(action, 'invalid_policy', 'Unknown checkpoint policy');
  checkpoint.currentPolicy = action.policy;
  state.actionsTakenThisTurn += 1;
  return null;
}

function setPowerSupply(state: GameState, action: Extract<GameAction, { type: 'SetPowerSupply' }>): ActionError | null {
  if (!isPlayerPhase(state)) return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  const facility = getFacilityState(state, action.facilityId);
  if (!facility || !['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)) {
    return error(action, 'power_supply_not_applicable', 'Power Supply can only be changed for an industrial boost facility');
  }
  if (
    facility.owner !== 'player' ||
    facility.status !== 'owned' ||
    facility.infected > 0 ||
    facility.populationOperationalTurn > state.turn
  ) {
    return error(action, 'power_supply_unavailable', 'The facility must be owned, safe, and operational for population actions');
  }
  if (typeof action.enabled !== 'boolean') return error(action, 'invalid_power_supply', 'Power Supply must be ON or OFF');
  if (facility.powerSupplyEnabled === action.enabled) return error(action, 'no_change', 'Power Supply is already set to this value');
  facility.powerSupplyEnabled = action.enabled;
  emit(state, 'power_supply_changed', { facilityId: facility.id, enabled: action.enabled });
  return null;
}

function unitProductionCosts(state: Readonly<GameState>, unitType: HumanUnitType): {
  population: number;
  civilianGoods: number;
  militaryGoods: number;
} {
  const materialCosts = unitType === 'police'
    ? { civilianGoods: 10, militaryGoods: 10 }
    : { civilianGoods: 20, militaryGoods: 25 };
  return {
    population: state.config.units[unitType].population,
    ...materialCosts,
  };
}

function produceUnit(state: GameState, action: Extract<GameAction, { type: 'ProduceUnit' }>): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  if (!HUMAN_UNIT_TYPES.includes(action.unitType)) return error(action, 'invalid_unit_type', 'Only police and national guard can be produced');
  const eligibleCities = eligibleSnapshotCities(state, 'supply').filter(
    (facility) => action.unitType === 'police' || facility.type === 'capital',
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
      action.unitType === 'police'
        ? 'Police can only be recruited in an eligible city'
        : 'National Guard can only be recruited in the eligible capital',
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

function move(state: GameState, action: MoveAction): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const result = getMovePath(state, action);
  if ('code' in result) return result;
  applyMovement(state, result.unit, result.path, result.unit.movement);
  state.actionsTakenThisTurn += 1;
  synchronizePopulation(state);
  return null;
}

function attack(state: GameState, action: AttackAction): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const attacker = getUnit(state, action.attackerId);
  const target = getUnit(state, action.targetId);
  if (!attacker || !attacker.isPlayerUnit || !target || !isAttackable(attacker, target) || !isVisibleToPlayer(state, target.position)) {
    return error(action, 'invalid_target', 'A visible enemy target and player attacker are required');
  }
  if (attacker.actionState === 'acted' || !attacker.canAttack || hexDistance(attacker.position, target.position) > effectiveRange(state, attacker)) {
    return error(action, 'attack_not_legal', 'Target is outside range or this unit cannot attack');
  }
  attacker.actionState = 'acted';
  attacker.canMove = false;
  resolveCombat(state, attacker, target, 'attack');
  state.actionsTakenThisTurn += 1;
  synchronizePopulation(state);
  return null;
}

function wait(state: GameState, action: Extract<GameAction, { type: 'Wait' }>): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const unit = getUnit(state, action.unitId);
  if (!unit || !unit.isPlayerUnit || unit.actionState === 'acted') return error(action, 'cannot_wait', 'Only an uncommitted player unit can wait');
  unit.actionState = 'acted';
  unit.canMove = false;
  state.actionsTakenThisTurn += 1;
  return null;
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
    if (action.snapshot.gameVersion !== state.gameVersion || !valid.valid) {
      return error(action, 'invalid_snapshot', valid.errors.join('; ') || 'Unsupported game version');
    }
    return null;
  }
  if (action.type === 'EndTurn') {
    return state.phase === 'player' ? null : error(action, 'wrong_phase', 'Turn can only end during the player phase');
  }
  if (state.phase !== 'player') return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  if (action.type === 'SetPowerSupply') return setPowerSupply(cloneState(state as GameState), action);
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) return error(action, 'action_limit', 'The action limit for this turn has been reached');
  if (action.type === 'BuildCheckpoint') return validateBuildCheckpointAction(state, action).error;
  if (action.type === 'RelocateCheckpoint') return validateRelocateCheckpointAction(state, action).error;
  const candidate = cloneState(state as GameState);
  if (action.type === 'Move') return move(candidate, action);
  if (action.type === 'Attack') return attack(candidate, action);
  if (action.type === 'Wait') return wait(candidate, action);
  if (action.type === 'AssignWorkers') return assignWorkers(candidate, action);
  if (action.type === 'TransferPopulation') return transferPopulation(candidate, action);
  if (action.type === 'SetCheckpointPolicy') return setCheckpointPolicy(candidate, action);
  if (action.type === 'ProduceUnit') return produceUnit(candidate, action);
  return error(action, 'unknown_action', 'Unknown action');
}

/** Pure, stable, all-road-tile checkpoint explainability query. */
export function getCheckpointPositionCandidates(
  state: Readonly<GameState>,
): CheckpointPositionCandidate[] {
  const candidates: CheckpointPositionCandidate[] = [];
  for (const branch of [...state.map.roadBranches].sort((left, right) => left.id.localeCompare(right.id))) {
    const active = state.checkpoints.find(
      (checkpoint) => checkpoint.status === 'operational' && (checkpoint.branchId ?? checkpoint.direction) === branch.id,
    );
    for (const position of branch.roadTiles) {
      const action: Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' }> = active
        ? { type: 'RelocateCheckpoint', checkpointId: active.id, branchId: branch.id, position: { ...position } }
        : { type: 'BuildCheckpoint', branchId: branch.id, position: { ...position } };
      const reason = validateAction(state, action);
      candidates.push({
        actionType: action.type,
        branchId: branch.id,
        ...(action.type === 'RelocateCheckpoint' ? { checkpointId: action.checkpointId } : {}),
        position: { ...position },
        legal: reason === null,
        reasonCode: reason?.code ?? null,
      });
    }
  }
  return candidates;
}

export class GameEngine implements HeadlessGame {
  private state: GameState;

  public constructor(seed = 1, config: GameConfig = createDefaultConfig()) {
    this.state = createInitialState(seed, config);
  }

  public reset(seed: number, config: GameConfig): Readonly<GameState> {
    this.state = createInitialState(seed, config);
    return this.getState();
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
    if (!isPlayerPhase(this.state)) return [];
    const actions: GameAction[] = [];
    if (this.state.actionsTakenThisTurn >= this.state.config.maxActionsPerTurn) {
      for (const facility of stableFacilities(this.state)) {
        if (
          facility.owner === 'player' &&
          facility.status === 'owned' &&
          facility.infected === 0 &&
          facility.populationOperationalTurn <= this.state.turn &&
          ['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)
        ) {
          actions.push({ type: 'SetPowerSupply', facilityId: facility.id, enabled: !facility.powerSupplyEnabled });
        }
      }
      actions.push({ type: 'EndTurn' });
      return actions;
    }
    for (const unit of this.state.units.filter((candidate) => candidate.isPlayerUnit).sort((a, b) => a.id.localeCompare(b.id))) {
      if (unit.actionState !== 'acted') {
        actions.push({ type: 'Wait', unitId: unit.id });
      }
      if (unit.canMove && unit.actionState !== 'acted') {
        for (const destination of reachableDestinations(this.state, unit)) {
          actions.push({ type: 'Move', unitId: unit.id, destination });
        }
      }
      if (unit.canAttack && unit.actionState !== 'acted') {
        for (const target of getVisibleEnemyUnits(this.state)) {
          if (hexDistance(unit.position, target.position) <= effectiveRange(this.state, unit)) {
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
        facility.populationOperationalTurn > this.state.turn
      ) continue;
      const maximum = Math.min(facility.workerCapacity, facility.workers + availableSupplyPopulation(this.state));
      for (let workers = 0; workers <= maximum; workers += 1) {
        if (
          workers !== facility.workers &&
          (workers > facility.workers || eligibleSnapshotCities(this.state, 'reception').length > 0) &&
          (workers < facility.workers || isHexSupplied(this.state, facility.position))
        ) actions.push({ type: 'AssignWorkers', facilityId: facility.id, workers });
      }
      if (['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)) {
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
    for (const checkpoint of this.state.checkpoints.filter((candidate) => ['operational', 'remnant'].includes(candidate.status)).sort((a, b) => a.id.localeCompare(b.id))) {
      for (const policy of ['passThrough', 'normal', 'strict'] as const) {
        if (policy !== checkpoint.currentPolicy) actions.push({ type: 'SetCheckpointPolicy', checkpointId: checkpoint.id, policy });
      }
    }
    for (const candidate of getCheckpointPositionCandidates(this.state)) {
      if (!candidate.legal) continue;
      actions.push(candidate.actionType === 'RelocateCheckpoint'
        ? {
            type: 'RelocateCheckpoint',
            checkpointId: candidate.checkpointId!,
            branchId: candidate.branchId,
            position: { ...candidate.position },
          }
        : { type: 'BuildCheckpoint', branchId: candidate.branchId, position: { ...candidate.position } });
    }
    for (const city of cities.filter((candidate) => isHexSupplied(this.state, candidate.position))) {
      if (!this.state.pendingUnitProductions.some((order) => order.cityFacilityId === city.id)) {
        for (const unitType of HUMAN_UNIT_TYPES) {
          if (unitType === 'nationalGuard' && city.type !== 'capital') continue;
          const costs = unitProductionCosts(this.state, unitType);
          if (
            availableSupplyPopulation(this.state) >= costs.population &&
            civilianWorkerCount(this.state) - costs.population > 0 &&
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

  public step(action: GameAction): StepResult {
    const original = this.state;
    if (original.gameOver) {
      return { state: this.getState(), events: [], error: error(action, 'game_over', 'The game is over'), gameOver: true, result: this.getResult() };
    }
    if (action.type === 'StartNewGame') {
      try {
        this.state = createInitialState(action.seed, action.config);
        return { state: this.getState(), events: [], error: null, gameOver: false, result: null };
      } catch (reason) {
        return { state: this.getState(), events: [], error: error(action, 'invalid_new_game', reason instanceof Error ? reason.message : 'Invalid new game'), gameOver: false, result: null };
      }
    }
    if (action.type === 'LoadSnapshot') {
      try {
        const candidate = cloneState(action.snapshot);
        const valid = validateInvariants(candidate);
        if (candidate.gameVersion !== original.gameVersion || !valid.valid) {
          return { state: this.getState(), events: [], error: error(action, 'invalid_snapshot', valid.errors.join('; ') || 'Unsupported game version'), gameOver: false, result: null };
        }
        this.state = candidate;
        return { state: this.getState(), events: [], error: null, gameOver: this.state.gameOver, result: this.getResult() };
      } catch (reason) {
        return { state: this.getState(), events: [], error: error(action, 'invalid_snapshot', reason instanceof Error ? reason.message : 'Invalid snapshot'), gameOver: false, result: null };
      }
    }

    const candidate = cloneState(original);
    const populationBeforeAction = populationLedgerTotal(original);
    const rng = SeededRng.fromState(candidate.rngState);
    const eventCount = candidate.events.length;
    let actionError: ActionError | null = null;
    if (action.type === 'EndTurn') {
      if (!isPlayerPhase(candidate)) actionError = error(action, 'wrong_phase', 'Turn can only end during the player phase');
      else endTurn(candidate, rng);
    } else if (action.type === 'Move') actionError = move(candidate, action);
    else if (action.type === 'Attack') actionError = attack(candidate, action);
    else if (action.type === 'Wait') actionError = wait(candidate, action);
    else if (action.type === 'AssignWorkers') actionError = assignWorkers(candidate, action);
    else if (action.type === 'TransferPopulation') actionError = transferPopulation(candidate, action);
    else if (action.type === 'SetCheckpointPolicy') actionError = setCheckpointPolicy(candidate, action);
    else if (action.type === 'SetPowerSupply') actionError = setPowerSupply(candidate, action);
    else if (action.type === 'BuildCheckpoint') actionError = buildCheckpoint(candidate, action);
    else if (action.type === 'RelocateCheckpoint') actionError = relocateCheckpoint(candidate, action);
    else if (action.type === 'ProduceUnit') actionError = produceUnit(candidate, action);
    else actionError = error(action, 'unknown_action', 'Unknown or retired action');

    if (actionError) {
      return { state: this.getState(), events: [], error: actionError, gameOver: this.isGameOver(), result: this.getResult() };
    }
    saveRng(candidate, rng);
    synchronizePopulation(candidate);
    if (!candidate.gameOver) checkImmediateGameEnd(candidate);
    if (action.type !== 'EndTurn' && populationLedgerTotal(candidate) !== populationBeforeAction) {
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
