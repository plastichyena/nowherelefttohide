import { validateGameConfig } from './config';
import { hexKey, hexWithinBounds } from './hex';
import { isRoad, validateFixedMap } from './map';
import { civilianWorkerCount, isCityFacility, populationLedgerTotal, resourceConsumerPopulation } from './state';
import type { GameState } from './types';

export interface InvariantResult {
  valid: boolean;
  errors: string[];
}

const nonNegativeFields = ['food', 'civilianGoods', 'militaryGoods', 'fuel'] as const;

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Validate the rules that must hold after every GameAction and each end-turn
 * subphase. It deliberately does not repair state: invalid snapshots are
 * rejected before they can replace a live game.
 */
export function validateInvariants(state: GameState): InvariantResult {
  const errors: string[] = [];
  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State must be an object'] };
  }
  if (
    !state.map ||
    !state.config ||
    !state.population ||
    !state.resources ||
    !Array.isArray(state.facilities) ||
    !Array.isArray(state.units) ||
    !Array.isArray(state.checkpoints)
  ) {
    return { valid: false, errors: ['State is missing required collections'] };
  }
  if (!Array.isArray(state.pendingUnitProductions)) {
    errors.push('State pending queues must be arrays');
  }
  const config = validateGameConfig(state.config);
  if (!config.valid) {
    errors.push(...config.errors.map((error) => `config: ${error}`));
  }
  if (state.map.id !== state.mapId || state.map.id !== state.config.mapId) {
    errors.push('State map id must match config and map');
  }
  try {
    const map = validateFixedMap(state.map);
    if (!map.valid) errors.push(...map.errors.map((error) => `map: ${error}`));
  } catch (reason) {
    errors.push(`map: could not validate fixed map (${reason instanceof Error ? reason.message : String(reason)})`);
  }
  if (!isNonNegativeInteger(state.turn) || state.turn < 1 || state.turn > state.maxTurns) {
    errors.push('Turn must be within the configured game range');
  }
  if (state.maxTurns !== state.config.maxTurns) {
    errors.push('State maxTurns must match config.maxTurns');
  }
  for (const field of [
    'cityResidents',
    'initialPopulation',
    'productionWorkers',
    'healthyCivilians',
    'police',
    'nationalGuard',
    'unitPopulation',
    'waitingRefugees',
    'screeningRefugees',
    'approvedRefugees',
    'facilityInfected',
    'checkpointInfected',
    'cumulativeDeaths',
    'cumulativeArrivals',
    'cumulativeDepartures',
    'cumulativeDiscoveredInfected',
  ] as const) {
    if (!isNonNegativeInteger(state.population[field])) {
      errors.push(`Population ${field} must be a non-negative integer`);
    }
  }
  if (!isNonNegativeInteger(state.actionsTakenThisTurn) || !isNonNegativeInteger(state.nextUnitNumber) || !isNonNegativeInteger(state.nextEventNumber) || !isNonNegativeInteger(state.nextAssignmentOrder)) {
    errors.push('State sequence counters must be non-negative integers');
  }
  for (const resource of nonNegativeFields) {
    if (!isNonNegativeInteger(state.resources[resource])) {
      errors.push(`Resource ${resource} must be a non-negative integer`);
    }
  }
  if (!isNonNegativeInteger(state.resources.electricityCapacity) || !isNonNegativeInteger(state.resources.electricityRequired)) {
    errors.push('Electricity capacity and requirement must be non-negative integers');
  }

  const mapFacilityById = new Map(state.map.facilities.map((facility) => [facility.id, facility]));
  if (state.facilities.length !== state.map.facilities.length) {
    errors.push('Facility state count must match map');
  }
  const seenFacilities = new Set<string>();
  for (const facility of state.facilities) {
    if (seenFacilities.has(facility.id)) {
      errors.push(`Duplicate facility id ${facility.id}`);
    }
    seenFacilities.add(facility.id);
    const definition = mapFacilityById.get(facility.id);
    if (!definition) {
      errors.push(`Facility ${facility.id} does not exist in map`);
      continue;
    }
    if (hexKey(definition.position) !== hexKey(facility.position)) {
      errors.push(`Facility ${facility.id} position differs from map`);
    }
    if (!isNonNegativeInteger(facility.workers) || !isNonNegativeInteger(facility.infected)) {
      errors.push(`Facility ${facility.id} population must be non-negative integers`);
    }
    if (!isCityFacility(facility) && facility.workers + facility.infected > facility.workerCapacity) {
      errors.push(`Facility ${facility.id} exceeds worker capacity`);
    }
    if (!Number.isSafeInteger(facility.populationOperationalTurn) || facility.populationOperationalTurn < 1) {
      errors.push(`Facility ${facility.id} has an invalid population operational turn`);
    }
    if (facility.status === 'unowned' && facility.owner !== 'none') {
      errors.push(`Unowned facility ${facility.id} must not have a player owner`);
    }
    if (facility.status === 'owned' && facility.owner !== 'player') {
      errors.push(`Owned facility ${facility.id} must have a player owner`);
    }
    if (facility.status === 'ruined' && facility.owner !== 'none') {
      errors.push(`Ruined facility ${facility.id} must not have a player owner`);
    }
    if (facility.status === 'ruined' && facility.workers !== 0) {
      errors.push(`Ruined facility ${facility.id} cannot retain workers`);
    }
    if (facility.status === 'ruined' && facility.operationalStatus !== 'ruined') {
      errors.push(`Ruined facility ${facility.id} must use ruined operational status`);
    }
  }

  const occupied = new Set<string>();
  const knownUnitIds = new Set<string>();
  for (const unit of state.units) {
    if (knownUnitIds.has(unit.id)) {
      errors.push(`Duplicate unit id ${unit.id}`);
    }
    knownUnitIds.add(unit.id);
    const key = hexKey(unit.position);
    if (!hexWithinBounds(unit.position, state.map.width, state.map.height)) {
      errors.push(`Unit ${unit.id} is outside the map`);
    }
    if (occupied.has(key)) {
      errors.push(`More than one unit occupies ${key}`);
    }
    occupied.add(key);
    if (!isNonNegativeInteger(unit.hp) || !isNonNegativeInteger(unit.maxHp) || unit.hp > unit.maxHp) {
      errors.push(`Unit ${unit.id} has invalid HP`);
    }
    if (!isNonNegativeInteger(unit.population)) {
      errors.push(`Unit ${unit.id} has invalid population`);
    }
    if (unit.actionState === 'destroyed') {
      errors.push(`Destroyed unit ${unit.id} must be removed from state`);
    }
  }

  const checkpointTiles = new Set<string>();
  for (const checkpoint of state.checkpoints) {
    const key = hexKey(checkpoint.position);
    if (checkpointTiles.has(key)) {
      errors.push(`Duplicate checkpoint tile ${key}`);
    }
    checkpointTiles.add(key);
    if (!isRoad(state.map, checkpoint.position)) {
      errors.push(`Checkpoint ${checkpoint.id} is not on a road`);
    }
    for (const field of ['waiting', 'screening', 'approved', 'remainingTurns', 'infected'] as const) {
      if (!isNonNegativeInteger(checkpoint[field])) {
        errors.push(`Checkpoint ${checkpoint.id}.${field} must be non-negative`);
      }
    }
  }

  for (const order of state.pendingUnitProductions ?? []) {
    if (!mapFacilityById.has(order.cityFacilityId) || !isNonNegativeInteger(order.population) || !isNonNegativeInteger(order.readyTurn)) {
      errors.push(`Pending unit production ${order.id} is invalid`);
    }
  }

  const cityResidents = state.facilities
    .filter((facility) => facility.owner === 'player' && isCityFacility(facility))
    .reduce((sum, facility) => sum + facility.workers, 0);
  const productionWorkers = state.facilities
    .filter((facility) => facility.owner === 'player' && !isCityFacility(facility))
    .reduce((sum, facility) => sum + facility.workers, 0);
  if (
    state.population.cityResidents !== cityResidents ||
    state.population.productionWorkers !== productionWorkers ||
    state.population.healthyCivilians !== cityResidents + productionWorkers
  ) {
    errors.push('Healthy civilian population totals are out of sync');
  }
  const expectedFacilityWorkers = state.facilities
    .filter((facility) => facility.owner === 'player')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((facility) => ({ facilityId: facility.id, workers: facility.workers }));
  if (
    !Array.isArray(state.population.facilityWorkers) ||
    JSON.stringify(state.population.facilityWorkers) !== JSON.stringify(expectedFacilityWorkers)
  ) {
    errors.push('Facility worker population totals are out of sync');
  }
  const police =
    state.units.filter((unit) => unit.type === 'police').reduce((sum, unit) => sum + unit.population, 0) +
    state.pendingUnitProductions.filter((order) => order.unitType === 'police').reduce((sum, order) => sum + order.population, 0);
  const nationalGuard =
    state.units.filter((unit) => unit.type === 'nationalGuard').reduce((sum, unit) => sum + unit.population, 0) +
    state.pendingUnitProductions.filter((order) => order.unitType === 'nationalGuard').reduce((sum, order) => sum + order.population, 0);
  if (state.population.police !== police || state.population.nationalGuard !== nationalGuard || state.population.unitPopulation !== police + nationalGuard) {
    errors.push('Unit population totals are out of sync');
  }
  const waiting = state.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.waiting, 0);
  const screening = state.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.screening, 0);
  const approved = state.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.approved, 0);
  const checkpointInfected = state.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.infected, 0);
  const facilityInfected = state.facilities.reduce((sum, facility) => sum + facility.infected, 0);
  if (
    state.population.waitingRefugees !== waiting ||
    state.population.screeningRefugees !== screening ||
    state.population.approvedRefugees !== approved ||
    state.population.checkpointInfected !== checkpointInfected ||
    state.population.facilityInfected !== facilityInfected
  ) {
    errors.push('Checkpoint or infected population totals are out of sync');
  }
  if (
    !state.cityPopulationSnapshot ||
    state.cityPopulationSnapshot.turn !== state.turn ||
    !Array.isArray(state.cityPopulationSnapshot.supply) ||
    !Array.isArray(state.cityPopulationSnapshot.reception)
  ) {
    errors.push('City population snapshot must match the current player turn');
  }
  if (civilianWorkerCount(state) < 0 || resourceConsumerPopulation(state) < 0) {
    errors.push('Population totals cannot be negative');
  }
  const expectedPopulationLedger =
    state.population.initialPopulation +
    state.population.cumulativeArrivals +
    state.population.cumulativeDiscoveredInfected -
    state.population.cumulativeDepartures;
  if (populationLedgerTotal(state) !== expectedPopulationLedger) {
    errors.push('Population conservation ledger is out of balance');
  }
  if (state.gameOver !== (state.result !== null)) {
    errors.push('Game over flag and result must agree');
  }
  if (!state.rngState || state.rngState.algorithm !== 'xorshift32-v1' || !isNonNegativeInteger(state.rngState.calls)) {
    errors.push('RNG state is invalid');
  }
  return { valid: errors.length === 0, errors };
}

export function assertInvariants(state: GameState): void {
  const result = validateInvariants(state);
  if (!result.valid) {
    throw new Error(`GameState invariant violation: ${result.errors.join('; ')}`);
  }
}
