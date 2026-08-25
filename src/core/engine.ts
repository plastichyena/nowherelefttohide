import { createDefaultConfig, HUMAN_UNIT_TYPES } from './config';
import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { assertInvariants, validateInvariants } from './invariants';
import { getHordeEntrance, getTile, isRoad } from './map';
import { findNearestOpenTiles, findShortestPath } from './path';
import { SeededRng } from './rng';
import {
  civilianWorkerCount,
  cloneState,
  createInitialState,
  createUnit,
  getCheckpointAt,
  getFacilityState,
  getUnit,
  getUnitAt,
  isHumanUnit,
  nextHumanUnitId,
  positionKey,
  resourceConsumerPopulation,
  synchronizePopulation,
} from './state';
import type {
  ActionError,
  AttackAction,
  CardinalDirection,
  CheckpointPolicy,
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
  PendingAdmission,
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

function effectiveRange(state: GameState, unit: UnitState): number {
  if (unit.type === 'nationalGuard' && !state.resources.militarySupplyAvailable) {
    return Math.min(1, unit.range);
  }
  return unit.range;
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
  }
  emit(state, 'unit_destroyed', { unitId: unit.id, cause });
}

function dealDamage(state: GameState, target: UnitState, amount: number, sourceId: string, cause: string): void {
  const damage = Math.max(0, Math.min(target.hp, Math.floor(amount)));
  target.hp -= damage;
  emit(state, 'damage', { sourceId, targetId: target.id, amount: damage, cause });
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
  emit(state, 'facility_captured', { facilityId: facility.id, unitId: unit.id });
}

function applyMovement(
  state: GameState,
  mover: UnitState,
  path: HexCoord[],
  maxSteps: number,
): { reached: HexCoord; interception: UnitState | null } {
  let reached = { ...mover.position };
  let interception: UnitState | null = null;
  const steps = path.slice(1, maxSteps + 1);
  for (const position of steps) {
    mover.position = { ...position };
    reached = { ...position };
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
      mover.activity.moved = steps.length > 0;
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
  if (getUnitAt(state, action.destination)) {
    return error(action, 'occupied_destination', 'Destination is occupied');
  }
  const path = findShortestPath(state.map, unit.position, action.destination, occupiedKeys(state, unit.id));
  if (!path) {
    return error(action, 'no_path', 'No path is available');
  }
  if (path.length <= 1 || path.length - 1 > unit.movement) {
    return error(action, 'out_of_range', 'Destination exceeds movement range');
  }
  return { unit, path };
}

function reachableDestinations(state: GameState, unit: UnitState): HexCoord[] {
  const blocked = occupiedKeys(state, unit.id);
  const startKey = hexKey(unit.position);
  const seen = new Set<string>([startKey]);
  const pending: Array<{ position: HexCoord; steps: number }> = [{ position: { ...unit.position }, steps: 0 }];
  const destinations: HexCoord[] = [];
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]!;
    if (current.steps > 0) destinations.push(current.position);
    if (current.steps === unit.movement) continue;
    for (const neighbor of hexNeighbors(current.position)) {
      const key = hexKey(neighbor);
      if (!hexWithinBounds(neighbor, state.map.width, state.map.height) || seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      pending.push({ position: neighbor, steps: current.steps + 1 });
    }
  }
  return destinations.sort((left, right) => left.q - right.q || left.r - right.r);
}

/** Pure movement preview shared by the UI and action validation. */
export function previewMove(state: Readonly<GameState>, unitId: string, destination: HexCoord): MovePreview {
  const snapshot = cloneState(state as GameState);
  const candidate = getMovePath(snapshot, { type: 'Move', unitId, destination });
  if ('code' in candidate) {
    return { legal: false, reason: candidate.message, path: [], reached: null, interception: null };
  }
  const mover = candidate.unit;
  for (const position of candidate.path.slice(1)) {
    const interceptors = interceptorsAt(snapshot, mover, position);
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
  return checkpoint.waiting + checkpoint.screening;
}

function removeCheckpointPeople(checkpoint: CheckpointState, amount: number): number {
  let remaining = Math.max(0, Math.floor(amount));
  const fromWaiting = Math.min(remaining, checkpoint.waiting);
  checkpoint.waiting -= fromWaiting;
  remaining -= fromWaiting;
  const fromScreening = Math.min(remaining, checkpoint.screening);
  checkpoint.screening -= fromScreening;
  return fromWaiting + fromScreening;
}

function availableAdmissionFacility(state: GameState): FacilityState[] {
  return stableFacilities(state).filter(
    (facility) => facility.owner === 'player' && facility.status === 'owned' && facility.workers > 0,
  );
}

function establishLatentInfection(
  state: GameState,
  rng: SeededRng,
  checkpointId: string,
  acceptedWorkers: number,
  latentInfected: number,
): void {
  if (latentInfected <= 0) {
    state.population.unemployed += acceptedWorkers;
    return;
  }
  const candidates = availableAdmissionFacility(state);
  if (candidates.length === 0) {
    state.pendingAdmissions.push({ checkpointId, acceptedWorkers, latentInfected });
    return;
  }
  const target = rng.pick(candidates);
  const converted = Math.min(target.workers, latentInfected);
  target.workers -= converted;
  target.infected += converted;
  state.population.unemployed += acceptedWorkers;
  emit(state, 'latent_infection', { checkpointId, facilityId: target.id, infected: converted });
}

function resolvePendingAdmissions(state: GameState, rng: SeededRng): void {
  const pending = [...state.pendingAdmissions];
  state.pendingAdmissions = [];
  for (const admission of pending) {
    const candidates = availableAdmissionFacility(state);
    if (candidates.length === 0) {
      state.pendingAdmissions.push(admission);
      continue;
    }
    establishLatentInfection(state, rng, admission.checkpointId, admission.acceptedWorkers, admission.latentInfected);
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
  establishLatentInfection(state, rng, checkpoint.id, acceptedWorkers, latentInfected);
}

function processRefugees(state: GameState, rng: SeededRng): void {
  for (const checkpoint of [...state.checkpoints].sort((a, b) => a.id.localeCompare(b.id))) {
    if (checkpoint.status !== 'operational') {
      continue;
    }
    if (checkpoint.nextArrivalTurn !== null && checkpoint.nextArrivalTurn === state.turn) {
      const people = rng.nextInt(state.config.refugees.arrivalPeopleMin, state.config.refugees.arrivalPeopleMax);
      checkpoint.waiting += people;
      checkpoint.nextArrivalTurn = state.turn + rng.nextInt(
        state.config.refugees.arrivalIntervalMin,
        state.config.refugees.arrivalIntervalMax,
      );
      emit(state, 'refugees_arrived', { checkpointId: checkpoint.id, people });
    }
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
  resolvePendingAdmissions(state, rng);
}

function powerAndProduction(state: GameState): void {
  const outputs: Record<ResourceType, number> = { food: 0, civilianGoods: 0, militaryGoods: 0, fuel: 0 };
  const activeFacilities = stableFacilities(state).filter(
    (facility) => facility.owner === 'player' && facility.status === 'owned' && facility.workers > 0,
  );
  const capacity = activeFacilities
    .filter((facility) => facility.type === 'powerPlant')
    .reduce(
      (sum, facility) => sum + facility.workers * state.config.facilities[facility.type].production.powerGeneration,
      0,
    );
  const powered = activeFacilities.filter(
    (facility) => state.config.facilities[facility.type].production.requiresPower,
  );
  state.resources.electricityCapacity = capacity;
  state.resources.electricityRequired = powered.reduce(
    (sum, facility) => sum + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  let remainingCapacity = capacity;
  for (const facility of stableFacilities(state)) {
    if (facility.owner !== 'player' || facility.status !== 'owned' || facility.workers <= 0) {
      facility.operationalStatus = facility.status === 'ruined' ? 'ruined' : 'stopped';
      continue;
    }
    const rule = state.config.facilities[facility.type].production;
    if (!rule.requiresPower || remainingCapacity >= rule.powerCapacity) {
      facility.operationalStatus = 'operational';
      if (rule.requiresPower) {
        remainingCapacity -= rule.powerCapacity;
      }
    } else {
      facility.operationalStatus = 'stopped';
    }
  }

  for (const facility of stableFacilities(state)) {
    if (facility.operationalStatus !== 'operational' || facility.workers <= 0) {
      continue;
    }
    const rule = state.config.facilities[facility.type].production;
    let working = facility.workers;
    for (const [resource, perWorker] of Object.entries(rule.inputs) as Array<[ResourceType, number]>) {
      if (perWorker > 0) {
        working = Math.min(working, Math.floor(state.resources[resource] / perWorker));
      }
    }
    for (const [resource, perWorker] of Object.entries(rule.inputs) as Array<[ResourceType, number]>) {
      const spent = perWorker * working;
      state.resources[resource] -= spent;
      if (spent > 0) {
        emit(state, 'resource_consumed', { facilityId: facility.id, resource, amount: spent });
      }
    }
    for (const [resource, perWorker] of Object.entries(rule.outputs) as Array<[ResourceType, number]>) {
      outputs[resource] += perWorker * working;
    }
  }
  for (const resource of RESOURCE_TYPES) {
    if (outputs[resource] > 0) {
      state.resources[resource] += outputs[resource];
      emit(state, 'resource_produced', { resource, amount: outputs[resource] });
    }
  }
}

function removeWorkersForShortage(state: GameState, amount: number): number {
  let remaining = Math.max(0, Math.floor(amount));
  const unemployedLosses = Math.min(remaining, state.population.unemployed);
  state.population.unemployed -= unemployedLosses;
  remaining -= unemployedLosses;
  let removed = unemployedLosses;
  const facilities = [...state.facilities]
    .filter((facility) => facility.owner === 'player' && facility.workers > 0)
    .sort((left, right) => right.lastAssignedOrder - left.lastAssignedOrder || right.id.localeCompare(left.id));
  for (const facility of facilities) {
    const loss = Math.min(remaining, facility.workers);
    facility.workers -= loss;
    remaining -= loss;
    removed += loss;
    if (remaining === 0) {
      break;
    }
  }
  state.statistics.civilianLosses += removed;
  state.statistics.resourceShortageLosses += removed;
  return removed;
}

/**
 * Predict economy requirements for the current player turn without mutating
 * GameState.  The calculation intentionally uses the same secured-order and
 * electricity rules as the economy phase, while exposing full staffing input
 * demand so the UI can warn before partial fuel operation is resolved.
 */
export function forecastEndTurn(state: Readonly<GameState>): EndTurnForecast {
  const snapshot = state as GameState;
  const employed = snapshot.facilities.reduce(
    (total, facility) => total + (facility.owner === 'player' ? facility.workers : 0),
    0,
  );
  const unitPopulation = snapshot.units
    .filter((unit) => unit.isPlayerUnit)
    .reduce((total, unit) => total + unit.population, 0);
  const populationConsumers = employed + snapshot.population.unemployed + unitPopulation;
  const maintenance: Record<ResourceType, number> = {
    food: populationConsumers * snapshot.config.economy.populationConsumption.food,
    civilianGoods: populationConsumers * snapshot.config.economy.populationConsumption.civilianGoods,
    militaryGoods: unitPopulation * snapshot.config.economy.militaryGoodsPerUnitPopulation,
    fuel: 0,
  };
  const productionInput: Record<ResourceType, number> = {
    food: 0,
    civilianGoods: 0,
    militaryGoods: 0,
    fuel: 0,
  };

  const activeFacilities = stableFacilities(snapshot).filter(
    (facility) => facility.owner === 'player' && facility.status === 'owned' && facility.workers > 0,
  );
  const electricityCapacity = activeFacilities
    .filter((facility) => facility.type === 'powerPlant')
    .reduce(
      (total, facility) => total + facility.workers * snapshot.config.facilities[facility.type].production.powerGeneration,
      0,
    );
  const electricityRequired = activeFacilities
    .filter((facility) => snapshot.config.facilities[facility.type].production.requiresPower)
    .reduce(
      (total, facility) => total + snapshot.config.facilities[facility.type].production.powerCapacity,
      0,
    );

  let remainingCapacity = electricityCapacity;
  for (const facility of activeFacilities) {
    const rule = snapshot.config.facilities[facility.type].production;
    if (rule.requiresPower && remainingCapacity < rule.powerCapacity) continue;
    if (rule.requiresPower) remainingCapacity -= rule.powerCapacity;
    for (const [resource, amount] of Object.entries(rule.inputs) as Array<[ResourceType, number]>) {
      productionInput[resource] += amount * facility.workers;
    }
  }

  const resourceForecast = (resource: ResourceType): EndTurnForecast['food'] => {
    const available = snapshot.resources[resource];
    const maintenanceRequired = maintenance[resource];
    const productionInputRequired = productionInput[resource];
    const required = maintenanceRequired + productionInputRequired;
    return {
      available,
      maintenanceRequired,
      productionInputRequired,
      required,
      shortage: Math.max(0, required - available),
    };
  };

  return {
    populationConsumers,
    food: resourceForecast('food'),
    civilianGoods: resourceForecast('civilianGoods'),
    militaryGoods: resourceForecast('militaryGoods'),
    fuel: resourceForecast('fuel'),
    electricity: {
      capacity: electricityCapacity,
      required: electricityRequired,
      shortage: Math.max(0, electricityRequired - electricityCapacity),
    },
  };
}

function processEconomy(state: GameState): void {
  synchronizePopulation(state);
  const consumers = resourceConsumerPopulation(state);
  const foodNeed = consumers * state.config.economy.populationConsumption.food;
  const civilianNeed = consumers * state.config.economy.populationConsumption.civilianGoods;
  const foodShortage = Math.max(0, foodNeed - state.resources.food);
  const civilianShortage = Math.max(0, civilianNeed - state.resources.civilianGoods);
  const foodSpent = Math.min(foodNeed, state.resources.food);
  const civilianSpent = Math.min(civilianNeed, state.resources.civilianGoods);
  state.resources.food -= foodSpent;
  state.resources.civilianGoods -= civilianSpent;
  emit(state, 'resource_consumed', { resource: 'food', amount: foodSpent, population: consumers });
  emit(state, 'resource_consumed', { resource: 'civilianGoods', amount: civilianSpent, population: consumers });
  if (foodShortage + civilianShortage > 0) {
    emit(state, 'resource_shortage', { food: foodShortage, civilianGoods: civilianShortage });
    removeWorkersForShortage(state, foodShortage + civilianShortage);
    synchronizePopulation(state);
    if (checkImmediateDefeat(state)) {
      return;
    }
  }

  const militaryNeed = state.population.unitPopulation * state.config.economy.militaryGoodsPerUnitPopulation;
  state.resources.militarySupplyAvailable = state.resources.militaryGoods >= militaryNeed;
  const militarySpent = Math.min(state.resources.militaryGoods, militaryNeed);
  state.resources.militaryGoods -= militarySpent;
  emit(state, 'resource_consumed', { resource: 'militaryGoods', amount: militarySpent, population: state.population.unitPopulation });
  powerAndProduction(state);
  synchronizePopulation(state);
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

function spawnZombies(state: GameState, origin: HexCoord, count: number, rng: SeededRng, cause: string): void {
  for (let index = 0; index < count; index += 1) {
    const position = nearestSpawnPosition(state, origin, rng);
    if (!position) {
      return;
    }
    let id = `zombie-${state.nextUnitNumber}`;
    while (state.units.some((unit) => unit.id === id)) {
      state.nextUnitNumber += 1;
      id = `zombie-${state.nextUnitNumber}`;
    }
    state.nextUnitNumber += 1;
    state.units.push(createUnit(state, id, 'zombie', position));
    emit(state, 'horde_spawned', { zombieId: id, q: position.q, r: position.r, cause });
  }
}

function overrunFacility(state: GameState, facility: FacilityState, rng: SeededRng): void {
  if (facility.status === 'ruined') {
    return;
  }
  facility.status = 'ruined';
  // A disconnected facility can be overrun before the player reaches it.
  // Preserve that lack of ownership; recovery by a stationed player unit
  // will claim the site only after its internal infection reaches zero.
  facility.operationalStatus = 'ruined';
  const capacityFallback = facility.workerCapacity * state.config.infection.fallBackCapacityRate;
  const rounded = state.config.infection.fallBackCapacityRounding === 'ceil' ? Math.ceil(capacityFallback) : Math.floor(capacityFallback);
  facility.infected = Math.max(facility.infected, rounded);
  facility.workers = 0;
  emit(state, 'facility_overrun', { facilityId: facility.id });
  spawnZombies(state, facility.position, state.config.facilities[facility.type].overrunSpawnCount, rng, 'facility_overrun');
}

function overrunCheckpoint(state: GameState, checkpoint: CheckpointState, rng: SeededRng): void {
  if (checkpoint.status === 'ruined') {
    return;
  }
  checkpoint.status = 'ruined';
  checkpoint.infected = Math.max(
    checkpoint.infected,
    Math.ceil(state.config.refugees.screeningCapacity * state.config.infection.fallBackCapacityRate),
  );
  checkpoint.waiting = 0;
  checkpoint.screening = 0;
  checkpoint.remainingTurns = 0;
  emit(state, 'facility_overrun', { checkpointId: checkpoint.id });
  spawnZombies(state, checkpoint.position, state.config.facilities.capital.overrunSpawnCount, rng, 'checkpoint_overrun');
}

function suppressFacility(state: GameState, facility: FacilityState, unit: UnitState): boolean {
  if (!unit.canAttack || unit.activity.attacked || unit.activity.intercepted || facility.infected <= 0) {
    return false;
  }
  const amount = unit.type === 'police' ? state.config.infection.policeSuppression : state.config.infection.nationalGuardSuppression;
  facility.infected = Math.max(0, facility.infected - amount);
  if (unit.type === 'nationalGuard') {
    const civilianLosses = Math.min(
      facility.workers,
      Math.ceil(amount * state.config.infection.nationalGuardCivilianDamageRate),
    );
    facility.workers -= civilianLosses;
    state.statistics.civilianLosses += civilianLosses;
  }
  unit.canAttack = false;
  unit.canMove = false;
  unit.actionState = 'acted';
  unit.activity.suppressed = true;
  emit(state, 'infection_suppressed', { facilityId: facility.id, unitId: unit.id, remaining: facility.infected });
  if (facility.infected === 0 && facility.status === 'ruined') {
    facility.owner = 'player';
    facility.status = 'owned';
    facility.operationalStatus = 'stopped';
    facility.workers = 0;
    emit(state, 'facility_recovered', { facilityId: facility.id, unitId: unit.id });
  }
  return true;
}

function suppressCheckpoint(state: GameState, checkpoint: CheckpointState, unit: UnitState): boolean {
  if (!unit.canAttack || unit.activity.attacked || unit.activity.intercepted || checkpoint.infected <= 0) {
    return false;
  }
  const amount = unit.type === 'police' ? state.config.infection.policeSuppression : state.config.infection.nationalGuardSuppression;
  checkpoint.infected = Math.max(0, checkpoint.infected - amount);
  if (unit.type === 'nationalGuard') {
    const civilianLosses = removeCheckpointPeople(
      checkpoint,
      Math.ceil(amount * state.config.infection.nationalGuardCivilianDamageRate),
    );
    state.statistics.civilianLosses += civilianLosses;
  }
  unit.canAttack = false;
  unit.canMove = false;
  unit.actionState = 'acted';
  unit.activity.suppressed = true;
  emit(state, 'infection_suppressed', { checkpointId: checkpoint.id, unitId: unit.id, remaining: checkpoint.infected });
  if (checkpoint.infected === 0 && checkpoint.status === 'ruined') {
    checkpoint.status = 'operational';
    emit(state, 'facility_recovered', { checkpointId: checkpoint.id, unitId: unit.id });
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
      suppressCheckpoint(state, checkpoint, occupant!);
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

function chooseZombieTarget(state: GameState, zombie: UnitState, rng: SeededRng): HumanTarget | null {
  const targets = zombieTargets(state);
  if (targets.length === 0) return null;
  const minimumDistance = Math.min(...targets.map((target) => hexDistance(zombie.position, target.position)));
  const nearest = targets.filter((target) => hexDistance(zombie.position, target.position) === minimumDistance);
  const largestPopulation = Math.max(...nearest.map((target) => target.population));
  return rng.pick(nearest.filter((target) => target.population === largestPopulation));
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

function destinationNearTarget(state: GameState, zombie: UnitState, target: HumanTarget): HexCoord | null {
  if (!getUnitAt(state, target.position)) {
    return target.position;
  }
  const candidates = hexNeighbors(target.position)
    .filter((position) => hexWithinBounds(position, state.map.width, state.map.height) && !getUnitAt(state, position))
    .sort((left, right) => hexDistance(zombie.position, left) - hexDistance(zombie.position, right) || left.q - right.q || left.r - right.r);
  return candidates[0] ?? null;
}

function processZombieTurn(state: GameState, rng: SeededRng): void {
  const zombieIds = state.units.filter((unit) => unit.type === 'zombie').map((unit) => unit.id).sort();
  for (const zombieId of zombieIds) {
    const zombie = getUnit(state, zombieId);
    if (!zombie) continue;
    const immediateTarget = zombie.canAttack ? nearestAttackableHuman(state, zombie) : null;
    if (immediateTarget) {
      resolveCombat(state, zombie, immediateTarget, 'attack');
      continue;
    }
    const target = chooseZombieTarget(state, zombie, rng);
    if (!target) continue;
    const destination = destinationNearTarget(state, zombie, target);
    if (!destination) continue;
    const path = findShortestPath(state.map, zombie.position, destination, occupiedKeys(state, zombie.id));
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
  const zombies = state.units.filter((unit) => unit.type === 'zombie').sort((a, b) => a.id.localeCompare(b.id));
  for (const zombie of zombies) {
    const tile = getTile(state.map, zombie.position);
    if (tile?.facilityId) {
      const facility = getFacilityState(state, tile.facilityId);
        if (facility && facility.status !== 'ruined') {
        const converted = Math.min(zombie.attack, facility.workers);
        facility.workers -= converted;
        facility.infected += converted;
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
    if (checkpoint?.status === 'operational' && totalCheckpointPeople(checkpoint) > 0) {
      const converted = removeCheckpointPeople(checkpoint, zombie.attack);
      checkpoint.infected += converted;
      if (converted > 0) {
        state.statistics.civilianLosses += converted;
        state.statistics.infectionLosses += converted;
        emit(state, 'infection_spread', { checkpointId: checkpoint.id, amount: converted, source: zombie.id });
      }
      if (totalCheckpointPeople(checkpoint) === 0) {
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
  if (state.config.horde.spawnOnlyBeforeFinalTurn && state.turn >= state.maxTurns) {
    state.horde.nextSpawnTurn = null;
    state.horde.turnsRemaining = 0;
    return;
  }
  const count = state.config.horde.initialCount + state.horde.spawnedCount * state.config.horde.increment;
  const entrance = getHordeEntrance(state.map, state.horde.nextDirection);
  if (entrance) {
    spawnZombies(state, entrance.tile, count, rng, 'horde');
  }
  state.horde.spawnedCount += 1;
  state.horde.totalSpawned += count;
  state.horde.lastSpawnTurn = state.turn;
  state.horde.nextDirection = rng.pick(['north', 'east', 'south', 'west'] as const);
  state.horde.nextSpawnTurn = state.turn + state.config.horde.cycle;
  state.horde.turnsRemaining = state.config.horde.cycle;
  emit(state, 'horde_spawned', { count, direction: entrance?.direction ?? 'north' });
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
    finishGame(state, 'lost', 'workersLost');
    return true;
  }
  return false;
}

function startPlayerTurn(state: GameState, rng: SeededRng): void {
  for (const unit of state.units.filter((candidate) => candidate.isPlayerUnit)) {
    const activity = unit.activity;
    if (!activity.moved && !activity.attacked && !activity.intercepted && !activity.suppressed) {
      const recovery = unit.maxHp * state.config.naturalRecovery.rate;
      const amount = state.config.naturalRecovery.rounding === 'ceil' ? Math.ceil(recovery) : Math.floor(recovery);
      unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    }
    unit.actionState = 'ready';
    unit.canMove = true;
    unit.canAttack = true;
    unit.activity = { moved: false, attacked: false, intercepted: false, suppressed: false };
  }
  for (const zombie of state.units.filter((unit) => unit.type === 'zombie')) {
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
  synchronizePopulation(state);
  checkImmediateDefeat(state);
  saveRng(state, rng);
}

function endTurn(state: GameState, rng: SeededRng): void {
  state.phase = 'economy';
  processEconomy(state);
  if (state.gameOver) return;
  state.phase = 'refugees';
  processRefugees(state, rng);
  synchronizePopulation(state);
  if (checkImmediateDefeat(state)) return;
  state.phase = 'infection';
  processInternalInfection(state, rng);
  if (state.gameOver) return;
  state.phase = 'zombie';
  processZombieTurn(state, rng);
  if (state.gameOver) return;
  processZombieInfection(state, rng);
  if (state.gameOver) return;
  state.phase = 'horde';
  processHorde(state, rng);
  if (state.turn >= state.maxTurns) {
    finishGame(state, 'won', 'maxTurnsSurvived');
    return;
  }
  state.turn += 1;
  state.actionsTakenThisTurn = 0;
  state.phase = 'player';
  state.horde.turnsRemaining = Math.max(0, (state.horde.nextSpawnTurn ?? state.turn) - (state.turn - 1));
  startPlayerTurn(state, rng);
}

function playerActionBudgetError(state: GameState, action: GameAction): ActionError | null {
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
  if (!facility || facility.owner !== 'player' || facility.status !== 'owned') return error(action, 'invalid_facility', 'Facility is not owned and usable');
  if (!Number.isInteger(action.workers) || action.workers < 0 || action.workers > facility.workerCapacity) return error(action, 'invalid_workers', 'Worker count is outside capacity');
  if (facility.infected > 0) return error(action, 'infected_facility', 'Workers cannot be moved into or out of an infected facility');
  const difference = action.workers - facility.workers;
  if (difference > state.population.unemployed) return error(action, 'insufficient_workers', 'Not enough unemployed workers');
  state.population.unemployed -= difference;
  facility.workers = action.workers;
  facility.lastAssignedOrder = state.nextAssignmentOrder++;
  state.actionsTakenThisTurn += 1;
  emit(state, 'workers_assigned', { facilityId: facility.id, workers: action.workers });
  synchronizePopulation(state);
  return null;
}

function checkpointDirection(state: GameState, position: HexCoord): CardinalDirection | null {
  const north = state.map.hordeEntrances.find((entrance) => entrance.direction === 'north')?.tile;
  const east = state.map.hordeEntrances.find((entrance) => entrance.direction === 'east')?.tile;
  const south = state.map.hordeEntrances.find((entrance) => entrance.direction === 'south')?.tile;
  const west = state.map.hordeEntrances.find((entrance) => entrance.direction === 'west')?.tile;
  const centerQ = north?.q ?? south?.q;
  const centerR = east?.r ?? west?.r;
  if (north && centerQ !== undefined && centerR !== undefined && position.q === centerQ && position.r < centerR) return 'north';
  if (south && centerQ !== undefined && centerR !== undefined && position.q === centerQ && position.r > centerR) return 'south';
  if (east && centerQ !== undefined && centerR !== undefined && position.r === centerR && position.q > centerQ) return 'east';
  if (west && centerQ !== undefined && centerR !== undefined && position.r === centerR && position.q < centerQ) return 'west';
  return null;
}

function buildCheckpoint(state: GameState, action: Extract<GameAction, { type: 'BuildCheckpoint' }>, rng: SeededRng): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  if (!isRoad(state.map, action.position) || getTile(state.map, action.position)?.facilityId || getCheckpointAt(state, action.position)) {
    return error(action, 'invalid_checkpoint_tile', 'A checkpoint requires an empty road tile');
  }
  const direction = checkpointDirection(state, action.position);
  if (!direction) return error(action, 'ambiguous_direction', 'Checkpoint tile must belong to exactly one cardinal approach');
  const existingOnDirection = state.checkpoints.filter((checkpoint) => checkpoint.direction === direction);
  if (existingOnDirection.length >= state.config.checkpoint.maxPerDirection) return error(action, 'checkpoint_limit', 'A checkpoint already exists on this approach');
  const police = state.units.find(
    (unit) => unit.type === 'police' && hexKey(unit.position) === hexKey(action.position) && unit.actionState !== 'acted',
  );
  if (!police) return error(action, 'police_required', 'A police unit with an available action is required');
  if (state.resources.civilianGoods < state.config.checkpoint.constructionCivilianGoods) return error(action, 'insufficient_civilian_goods', 'Not enough civilian goods');
  state.resources.civilianGoods -= state.config.checkpoint.constructionCivilianGoods;
  police.canMove = false;
  police.actionState = 'acted';
  const interval = rng.nextInt(state.config.refugees.arrivalIntervalMin, state.config.refugees.arrivalIntervalMax);
  const checkpoint: CheckpointState = {
    id: `checkpoint-${direction}-${existingOnDirection.length + 1}`,
    position: { ...action.position },
    direction,
    status: 'operational',
    waiting: 0,
    screening: 0,
    remainingTurns: 0,
    screeningPolicy: 'normal',
    currentPolicy: 'normal',
    nextArrivalTurn: state.turn + interval,
    infected: 0,
  };
  state.checkpoints.push(checkpoint);
  state.actionsTakenThisTurn += 1;
  emit(state, 'checkpoint_built', { checkpointId: checkpoint.id, direction });
  return null;
}

function setCheckpointPolicy(state: GameState, action: Extract<GameAction, { type: 'SetCheckpointPolicy' }>): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const checkpoint = state.checkpoints.find((candidate) => candidate.id === action.checkpointId);
  if (!checkpoint || checkpoint.status !== 'operational') return error(action, 'unknown_checkpoint', 'Checkpoint is not operational');
  if (!['passThrough', 'normal', 'strict'].includes(action.policy)) return error(action, 'invalid_policy', 'Unknown checkpoint policy');
  checkpoint.currentPolicy = action.policy;
  state.actionsTakenThisTurn += 1;
  return null;
}

function produceUnit(state: GameState, action: Extract<GameAction, { type: 'ProduceUnit' }>): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  if (!HUMAN_UNIT_TYPES.includes(action.unitType)) return error(action, 'invalid_unit_type', 'Only police and national guard can be produced');
  const possibleCities = stableFacilities(state).filter(
    (facility) => facility.owner === 'player' && facility.status === 'owned' && (facility.type === 'capital' || facility.type === 'city'),
  );
  const city = action.destination
    ? possibleCities.find((facility) => hexKey(facility.position) === hexKey(action.destination!))
    : possibleCities[0];
  if (!city) return error(action, 'no_city', 'An owned city is required');
  if (state.pendingUnitProductions.some((order) => order.cityFacilityId === city.id)) return error(action, 'city_busy', 'This city already has a reservation');
  const costs = action.unitType === 'police'
    ? { population: 5, civilianGoods: 10, militaryGoods: 10 }
    : { population: 10, civilianGoods: 20, militaryGoods: 25 };
  if (state.population.unemployed < costs.population || state.resources.civilianGoods < costs.civilianGoods || state.resources.militaryGoods < costs.militaryGoods) {
    return error(action, 'insufficient_production_cost', 'Insufficient unemployed population or military supplies');
  }
  state.population.unemployed -= costs.population;
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
  if (!attacker || !attacker.isPlayerUnit || !target || !isAttackable(attacker, target)) return error(action, 'invalid_target', 'An enemy target and player attacker are required');
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

function manualSuppress(state: GameState, action: Extract<GameAction, { type: 'SuppressInfection' }>): ActionError | null {
  const budget = playerActionBudgetError(state, action);
  if (budget) return budget;
  const unit = getUnit(state, action.unitId);
  const facility = getFacilityState(state, action.facilityId);
  if (!unit?.isPlayerUnit || !facility || hexKey(unit.position) !== hexKey(facility.position) || facility.infected <= 0) {
    return error(action, 'suppression_not_legal', 'A human unit must be stationed at an infected facility');
  }
  suppressFacility(state, facility, unit);
  state.actionsTakenThisTurn += 1;
  synchronizePopulation(state);
  return null;
}

/** Lightweight, non-mutating validation for callers that need an error reason. */
export function validateAction(state: Readonly<GameState>, action: GameAction): ActionError | null {
  if (state.gameOver) return error(action, 'game_over', 'The game is over');
  if (action.type === 'EndTurn' || action.type === 'StartNewGame' || action.type === 'LoadSnapshot') return null;
  if (state.phase !== 'player') return error(action, 'wrong_phase', 'Actions are only accepted during the player phase');
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) return error(action, 'action_limit', 'The action limit for this turn has been reached');
  return null;
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
    if (this.state.actionsTakenThisTurn >= this.state.config.maxActionsPerTurn) return [{ type: 'EndTurn' }];
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
        for (const target of this.state.units.filter((candidate) => !candidate.isPlayerUnit).sort((a, b) => a.id.localeCompare(b.id))) {
          if (hexDistance(unit.position, target.position) <= effectiveRange(this.state, unit)) {
            actions.push({ type: 'Attack', attackerId: unit.id, targetId: target.id });
          }
        }
      }
    }
    for (const facility of stableFacilities(this.state)) {
      if (facility.owner !== 'player' || facility.status !== 'owned' || facility.infected > 0) continue;
      const maximum = Math.min(facility.workerCapacity, facility.workers + this.state.population.unemployed);
      for (let workers = 0; workers <= maximum; workers += 1) {
        if (workers !== facility.workers) actions.push({ type: 'AssignWorkers', facilityId: facility.id, workers });
      }
    }
    for (const checkpoint of this.state.checkpoints.filter((candidate) => candidate.status === 'operational').sort((a, b) => a.id.localeCompare(b.id))) {
      for (const policy of ['passThrough', 'normal', 'strict'] as const) {
        if (policy !== checkpoint.currentPolicy) actions.push({ type: 'SetCheckpointPolicy', checkpointId: checkpoint.id, policy });
      }
    }
    for (const unit of this.state.units.filter((candidate) => candidate.type === 'police' && candidate.actionState !== 'acted')) {
      if (isRoad(this.state.map, unit.position) && !getTile(this.state.map, unit.position)?.facilityId && !getCheckpointAt(this.state, unit.position)) {
        const direction = checkpointDirection(this.state, unit.position);
        if (direction && this.state.checkpoints.filter((checkpoint) => checkpoint.direction === direction).length < this.state.config.checkpoint.maxPerDirection && this.state.resources.civilianGoods >= this.state.config.checkpoint.constructionCivilianGoods) {
          actions.push({ type: 'BuildCheckpoint', position: { ...unit.position } });
        }
      }
    }
    for (const city of stableFacilities(this.state).filter((facility) => facility.owner === 'player' && facility.status === 'owned' && (facility.type === 'capital' || facility.type === 'city'))) {
      if (!this.state.pendingUnitProductions.some((order) => order.cityFacilityId === city.id)) {
        for (const unitType of HUMAN_UNIT_TYPES) {
          const costs = unitType === 'police' ? { population: 5, civilian: 10, military: 10 } : { population: 10, civilian: 20, military: 25 };
          if (this.state.population.unemployed >= costs.population && this.state.resources.civilianGoods >= costs.civilian && this.state.resources.militaryGoods >= costs.military) {
            actions.push({ type: 'ProduceUnit', unitType, destination: { ...city.position } });
          }
        }
      }
    }
    actions.push({ type: 'EndTurn' });
    return actions;
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
    else if (action.type === 'SetCheckpointPolicy') actionError = setCheckpointPolicy(candidate, action);
    else if (action.type === 'BuildCheckpoint') actionError = buildCheckpoint(candidate, action, rng);
    else if (action.type === 'ProduceUnit') actionError = produceUnit(candidate, action);
    else if (action.type === 'SuppressInfection') actionError = manualSuppress(candidate, action);

    if (actionError) {
      return { state: this.getState(), events: [], error: actionError, gameOver: this.isGameOver(), result: this.getResult() };
    }
    saveRng(candidate, rng);
    synchronizePopulation(candidate);
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
