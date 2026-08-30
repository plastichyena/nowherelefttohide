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
    !state.statistics ||
    !state.horde ||
    !Array.isArray(state.facilities) ||
    !Array.isArray(state.units) ||
    !Array.isArray(state.checkpoints) ||
    !Array.isArray(state.roadBranches)
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
  if (!isNonNegativeInteger(state.turn) || state.turn < 1) {
    errors.push('Turn must be a positive integer');
  }
  if (state.finalHordeTurn !== state.config.finalHordeTurn) {
    errors.push('State finalHordeTurn must match config.finalHordeTurn');
  }
  const cardinalDirections = ['north', 'east', 'south', 'west'];
  if (!cardinalDirections.includes(state.horde.nextDirection)) {
    errors.push('Horde nextDirection is invalid');
  }
  for (const field of ['spawnedCount', 'totalSpawned', 'turnsRemaining', 'finalSpawnedCount'] as const) {
    if (!isNonNegativeInteger(state.horde[field])) errors.push(`Horde ${field} must be a non-negative integer`);
  }
  for (const field of ['nextSpawnTurn', 'lastSpawnTurn'] as const) {
    const value = state.horde[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) errors.push(`Horde ${field} must be null or a positive integer`);
  }
  if (!['periodic', 'final', 'none'].includes(state.horde.warningType)) errors.push('Horde warningType is invalid');
  if (!['notStarted', 'active', 'defeated'].includes(state.horde.finalHordeStatus)) errors.push('Final Horde status is invalid');
  if (state.horde.finalHordeStatus === 'notStarted') {
    if (state.horde.finalSpawnGroupId !== null || state.horde.finalSpawnedCount !== 0) {
      errors.push('An unstarted Final Horde cannot have a spawn group');
    }
  } else if (typeof state.horde.finalSpawnGroupId !== 'string' || state.horde.finalSpawnGroupId.length === 0 || state.horde.finalSpawnedCount < 1) {
    errors.push('An active or defeated Final Horde requires a spawn group and count');
  }
  if (state.horde.warningType === 'final' && state.horde.nextSpawnTurn !== state.finalHordeTurn) {
    errors.push('Final Horde warning must point to finalHordeTurn');
  }
  if (state.horde.warningType === 'periodic' && (state.horde.nextSpawnTurn === null || state.horde.nextSpawnTurn >= state.finalHordeTurn)) {
    errors.push('Periodic Horde warning must point before finalHordeTurn');
  }
  if (state.horde.warningType === 'none' && state.horde.nextSpawnTurn !== null) {
    errors.push('A state without a Horde warning cannot have a next spawn turn');
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
  if (!isNonNegativeInteger(state.actionsTakenThisTurn) || !isNonNegativeInteger(state.nextUnitNumber) || !isNonNegativeInteger(state.nextCheckpointNumber) || !isNonNegativeInteger(state.nextEventNumber) || !isNonNegativeInteger(state.nextAssignmentOrder)) {
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
  for (const field of [
    'maxPopulation',
    'maxSecuredFacilities',
    'civilianLosses',
    'unitLosses',
    'infectionLosses',
    'resourceShortageLosses',
    'hordeInterceptions',
    'unmanagedPassThrough',
    'refugeesAccepted',
    'refugeesDeparted',
    'checkpointsBuilt',
    'checkpointsRelocated',
    'checkpointRetreats',
    'checkpointsRuined',
    'checkpointsRecovered',
    'checkpointsAbandoned',
    'checkpointsRemoved',
    'unmanagedBranchTurns',
    'maxSuppliedFacilities',
    'maxSupplyRadius',
    'supplyLosses',
    'supplyRejections',
    'finalHordeSpawned',
    'finalHordeKilled',
    'periodicHordeZombiesSpawned',
    'periodicNormalZombiesSpawned',
    'finalHordeZombiesSpawned',
    'finalNormalZombiesSpawned',
    'normalZombiesKilled',
    'hordeZombiesKilled',
    'maxVisibleZombies',
    'turnsAfterFinalHorde',
    'urbanDefenseApplications',
    'urbanDefenseDamagePrevented',
    'forestDefenseApplications',
    'forestDefenseDamagePrevented',
    'normalZombieIdleCount',
    'hordeTargetInheritedCount',
    'hordeTargetClearedCount',
  ] as const) {
    if (!isNonNegativeInteger(state.statistics[field])) {
      errors.push(`Statistic ${field} must be a non-negative integer`);
    }
  }
  for (const policy of ['passThrough', 'normal', 'strict'] as const) {
    if (!isNonNegativeInteger(state.statistics.refugeesScreenedByPolicy?.[policy])) {
      errors.push(`Statistic refugeesScreenedByPolicy.${policy} must be a non-negative integer`);
    }
  }
  if (typeof state.statistics.finalHordeDefeated !== 'boolean') {
    errors.push('Statistic finalHordeDefeated must be boolean');
  }
  if (state.statistics.finalHordeDefeated !== (state.horde.finalHordeStatus === 'defeated')) {
    errors.push('Final Horde defeated statistic and status must agree');
  }
  for (const field of ['suppliedAreaZombieClearTurn', 'suppliedAreaInfectionClearTurn', 'victoryTurn'] as const) {
    const value = state.statistics[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      errors.push(`Statistic ${field} must be null or a positive integer`);
    }
  }
  for (const terrain of ['plain', 'forest', 'mountain', 'water'] as const) {
    if (!isNonNegativeInteger(state.statistics.terrainEntriesByType?.[terrain])) {
      errors.push(`Statistic terrainEntriesByType.${terrain} must be a non-negative integer`);
    }
  }
  if (state.statistics.finalHordeKilled > state.statistics.finalHordeSpawned) {
    errors.push('Final Horde killed count cannot exceed its spawned count');
  }
  if (state.statistics.finalHordeSpawned !== state.statistics.finalHordeZombiesSpawned + state.statistics.finalNormalZombiesSpawned) {
    errors.push('Final Horde spawned count must equal its Unit Type counts');
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
    const configuredCapacity = state.config.facilities[facility.type]?.workerCapacity;
    if (definition.workerCapacity !== configuredCapacity || facility.workerCapacity !== configuredCapacity) {
      errors.push(`Facility ${facility.id} worker capacity must match config and map`);
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
    if (typeof facility.powerSupplyEnabled !== 'boolean') {
      errors.push(`Facility ${facility.id} has an invalid Power Supply setting`);
    }
    if (facility.lastPowerSupplied !== null && typeof facility.lastPowerSupplied !== 'boolean') {
      errors.push(`Facility ${facility.id} has an invalid last Power Supply result`);
    }
    if (!['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type) && facility.powerSupplyEnabled) {
      errors.push(`Facility ${facility.id} cannot request industrial boost power`);
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
    if (!['police', 'nationalGuard', 'zombie', 'hordeZombie'].includes(unit.type)) {
      errors.push(`Unit ${unit.id} has an invalid type`);
    }
    const shouldBePlayerUnit = unit.type === 'police' || unit.type === 'nationalGuard';
    if (unit.isPlayerUnit !== shouldBePlayerUnit) errors.push(`Unit ${unit.id} has an invalid faction`);
    if (!isNonNegativeInteger(unit.vision)) errors.push(`Unit ${unit.id} has invalid vision`);
    if (unit.inheritedTarget && !hexWithinBounds(unit.inheritedTarget, state.map.width, state.map.height)) {
      errors.push(`Unit ${unit.id} has an invalid inherited target`);
    }
    if (unit.actionState === 'destroyed') {
      errors.push(`Destroyed unit ${unit.id} must be removed from state`);
    }
    if (!['ready', 'moved', 'acted'].includes(unit.actionState)) errors.push(`Unit ${unit.id} has an invalid action state`);
    if (unit.type === 'zombie') {
      const hasKind = ['periodic', 'final'].includes(unit.hordeKind ?? '');
      const hasGroup = typeof unit.spawnGroupId === 'string' && unit.spawnGroupId.length > 0;
      if (hasKind !== hasGroup) errors.push(`Normal Zombie ${unit.id} must have both Horde kind and spawn group, or neither`);
      if (unit.hordeKind === 'final' && unit.spawnGroupId !== state.horde.finalSpawnGroupId) {
        errors.push(`Final Normal Zombie ${unit.id} must use the active Final Horde group`);
      }
    } else if (unit.type === 'hordeZombie') {
      if (!['periodic', 'final'].includes(unit.hordeKind ?? '') || typeof unit.spawnGroupId !== 'string' || unit.spawnGroupId.length === 0) {
        errors.push(`Horde Zombie ${unit.id} requires Horde kind and spawn group`);
      }
      if (unit.inheritedTarget !== null) errors.push(`Horde Zombie ${unit.id} cannot inherit a target`);
      if (unit.hordeKind === 'final' && unit.spawnGroupId !== state.horde.finalSpawnGroupId) {
        errors.push(`Final Horde Zombie ${unit.id} must use the active Final Horde group`);
      }
    } else if (unit.inheritedTarget !== null || unit.hordeKind !== null || unit.spawnGroupId !== null) {
      errors.push(`Human unit ${unit.id} cannot contain Zombie target or Horde group state`);
    }
  }

  const remainingFinalHorde = state.units.filter(
    (unit) => unit.spawnGroupId === state.horde.finalSpawnGroupId,
  ).length;
  if (state.horde.finalHordeStatus === 'active' && remainingFinalHorde === 0) {
    errors.push('An active Final Horde must have at least one surviving member');
  }
  if (state.horde.finalHordeStatus === 'defeated' && remainingFinalHorde > 0) {
    errors.push('A defeated Final Horde cannot have surviving members');
  }

  const checkpointTiles = new Set<string>();
  const checkpointIds = new Set<string>();
  for (const checkpoint of state.checkpoints) {
    const key = hexKey(checkpoint.position);
    if (checkpointTiles.has(key)) {
      errors.push(`Duplicate checkpoint tile ${key}`);
    }
    checkpointTiles.add(key);
    if (checkpointIds.has(checkpoint.id)) errors.push(`Duplicate checkpoint id ${checkpoint.id}`);
    checkpointIds.add(checkpoint.id);
    if (!isRoad(state.map, checkpoint.position)) {
      errors.push(`Checkpoint ${checkpoint.id} is not on a road`);
    }
    for (const field of ['waiting', 'screening', 'approved', 'remainingTurns', 'infected'] as const) {
      if (!isNonNegativeInteger(checkpoint[field])) {
        errors.push(`Checkpoint ${checkpoint.id}.${field} must be non-negative`);
      }
    }
    const branchId = checkpoint.branchId ?? checkpoint.direction;
    const branch = state.map.roadBranches.find((candidate) => candidate.id === branchId);
    if (!branch || !branch.roadTiles.some((position) => hexKey(position) === key)) {
      errors.push(`Checkpoint ${checkpoint.id} is not on its declared branch`);
    }
    if (!['operational', 'remnant', 'ruined', 'abandoned'].includes(checkpoint.status)) {
      errors.push(`Checkpoint ${checkpoint.id} has an invalid status`);
    }
  }

  const roadBranchIds = new Set<string>();
  if (state.roadBranches.length !== state.map.roadBranches.length) {
    errors.push('Road branch state count must match map branches');
  }
  for (const branch of state.roadBranches) {
    if (roadBranchIds.has(branch.branchId)) errors.push(`Duplicate road branch state ${branch.branchId}`);
    roadBranchIds.add(branch.branchId);
    if (!state.map.roadBranches.some((definition) => definition.id === branch.branchId)) {
      errors.push(`Unknown road branch state ${branch.branchId}`);
    }
    if (!isNonNegativeInteger(branch.nextArrivalTurn) || branch.nextArrivalTurn < state.turn) {
      errors.push(`Road branch ${branch.branchId} has an invalid next arrival turn`);
    }
    if (!isNonNegativeInteger(branch.checkpointActionsThisTurn) || branch.checkpointActionsThisTurn > 1) {
      errors.push(`Road branch ${branch.branchId} has an invalid checkpoint action count`);
    }
    const operational = state.checkpoints.filter(
      (checkpoint) =>
        checkpoint.status === 'operational' &&
        (checkpoint.branchId ?? checkpoint.direction) === branch.branchId,
    );
    if (operational.length > 1) errors.push(`Road branch ${branch.branchId} has multiple operational checkpoints`);
    if (
      branch.activeCheckpointId !== null &&
      !operational.some((checkpoint) => checkpoint.id === branch.activeCheckpointId)
    ) {
      errors.push(`Road branch ${branch.branchId} active checkpoint is invalid`);
    }
    if (!isNonNegativeInteger(state.statistics.refugeeArrivalsByBranch?.[branch.branchId])) {
      errors.push(`Statistic refugeeArrivalsByBranch.${branch.branchId} must be a non-negative integer`);
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
