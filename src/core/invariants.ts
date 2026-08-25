import { validateGameConfig } from './config';
import { hexKey, hexWithinBounds } from './hex';
import { isRoad } from './map';
import { civilianWorkerCount, resourceConsumerPopulation } from './state';
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
  if (!state.map || !state.config || !Array.isArray(state.facilities) || !Array.isArray(state.units) || !Array.isArray(state.checkpoints)) {
    return { valid: false, errors: ['State is missing required collections'] };
  }
  if (!Array.isArray(state.pendingAdmissions) || !Array.isArray(state.pendingUnitProductions)) {
    errors.push('State pending queues must be arrays');
  }
  const config = validateGameConfig(state.config);
  if (!config.valid) {
    errors.push(...config.errors.map((error) => `config: ${error}`));
  }
  if (state.map.id !== state.mapId || state.map.id !== state.config.mapId) {
    errors.push('State map id must match config and map');
  }
  if (!isNonNegativeInteger(state.turn) || state.turn < 1 || state.turn > state.maxTurns) {
    errors.push('Turn must be within the configured game range');
  }
  if (state.maxTurns !== state.config.maxTurns) {
    errors.push('State maxTurns must match config.maxTurns');
  }
  if (!isNonNegativeInteger(state.population.unemployed)) {
    errors.push('Unemployed must be a non-negative integer');
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
    if (facility.workers + facility.infected > facility.workerCapacity) {
      errors.push(`Facility ${facility.id} exceeds worker capacity`);
    }
    if (facility.status === 'unowned' && facility.owner !== 'none') {
      errors.push(`Unowned facility ${facility.id} must not have a player owner`);
    }
    if (facility.status === 'owned' && facility.owner !== 'player') {
      errors.push(`Owned facility ${facility.id} must have a player owner`);
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
    for (const field of ['waiting', 'screening', 'remainingTurns', 'infected'] as const) {
      if (!isNonNegativeInteger(checkpoint[field])) {
        errors.push(`Checkpoint ${checkpoint.id}.${field} must be non-negative`);
      }
    }
  }

  for (const admission of state.pendingAdmissions ?? []) {
    if (!isNonNegativeInteger(admission.acceptedWorkers) || !isNonNegativeInteger(admission.latentInfected)) {
      errors.push(`Pending admission ${admission.checkpointId} has invalid population`);
    }
  }
  for (const order of state.pendingUnitProductions ?? []) {
    if (!mapFacilityById.has(order.cityFacilityId) || !isNonNegativeInteger(order.population) || !isNonNegativeInteger(order.readyTurn)) {
      errors.push(`Pending unit production ${order.id} is invalid`);
    }
  }

  const employed = state.facilities.reduce((sum, facility) => sum + (facility.owner === 'player' ? facility.workers : 0), 0);
  if (state.population.employed !== employed) {
    errors.push('Population employed total is out of sync');
  }
  const police = state.units.filter((unit) => unit.type === 'police').reduce((sum, unit) => sum + unit.population, 0);
  const nationalGuard = state.units.filter((unit) => unit.type === 'nationalGuard').reduce((sum, unit) => sum + unit.population, 0);
  if (state.population.police !== police || state.population.nationalGuard !== nationalGuard || state.population.unitPopulation !== police + nationalGuard) {
    errors.push('Unit population totals are out of sync');
  }
  if (civilianWorkerCount(state) < 0 || resourceConsumerPopulation(state) < 0) {
    errors.push('Population totals cannot be negative');
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
