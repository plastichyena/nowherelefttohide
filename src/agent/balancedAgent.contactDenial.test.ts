import { describe, expect, it } from 'vitest';
import type { GameAction } from '../core/types';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';
import type { AgentObservation, AgentUnitObservation } from './types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freshObservation(): AgentObservation {
  return createAgentGame().reset({ seed: 1 });
}

function facilityById(observation: AgentObservation, facilityId: string) {
  const facility = observation.facilities.find((candidate) => candidate.id === facilityId);
  if (!facility) throw new Error(`Missing facility ${facilityId}`);
  return facility;
}

function unitByType(observation: AgentObservation, type: 'police' | 'nationalGuard') {
  const unit = observation.units.find((candidate) => candidate.type === type);
  if (!unit) throw new Error(`Missing ${type} unit`);
  return unit;
}

function visibleZombie(observation: AgentObservation, id: string): AgentUnitObservation {
  const template = observation.zombies[0] ?? observation.units[0]!;
  return {
    ...clone(template),
    id,
    type: 'zombie',
    unitType: 'zombie',
    hp: 10,
    maxHp: 10,
    attack: 5,
    movement: 3,
    range: 1,
    baseRange: 1,
    effectiveRange: 1,
    population: 0,
    canAttack: true,
    canMove: true,
    currentFuel: 0,
    maxFuel: 0,
    fuelCostByLegalMove: [],
    projectedRefillDemandIfTurnEndsNow: 0,
    projectedRefillAmountIfTurnEndsNow: 0,
  };
}

/** Keep each scenario focused on the strategic conflict under test. */
function stabilize(observation: AgentObservation): AgentObservation {
  const value = clone(observation);
  value.horde.turnsRemaining = 10;
  value.population.infected = 0;
  value.endTurnForecast.militaryGoods.totalUnfilledRefillDemand = 0;
  value.endTurnForecast.food.shortage = 0;
  value.endTurnForecast.civilianGoods.shortage = 0;
  value.endTurnForecast.fuel.shortage = 0;
  value.endTurnForecast.electricity.shortage = 0;
  value.endTurnForecast.overcrowding.additionalFood = 0;
  value.endTurnForecast.overcrowding.additionalCivilianGoods = 0;
  for (const facility of value.facilities) {
    facility.owner = 'player';
    facility.status = 'owned';
    facility.operationalStatus = 'operational';
    facility.infectedPopulation = 0;
    facility.populationOperational = true;
    facility.populationUnavailableReason = null;
  }
  return value;
}

describe('Balanced Agent facility-contact denial', () => {
  it.each([
    ['the state capital', 'capital', { q: 15, r: 12 }],
    ['an operational farm', 'farm-1', { q: 13, r: 12 }],
  ] as const)('attacks a zombie that can contact %s during the next zombie turn', (_label, facilityId, threatPosition) => {
    const observation = stabilize(freshObservation());
    const targetFacility = facilityById(observation, facilityId);
    targetFacility.healthyPopulation = Math.max(targetFacility.healthyPopulation, 10);

    const threat = visibleZombie(observation, 'zombie-threat');
    const decoy = visibleZombie(observation, 'zombie-a');
    threat.position = threatPosition;
    threat.hp = 10;
    threat.maxHp = 10;
    decoy.position = { q: 0, r: 0 };
    decoy.hp = 10;
    decoy.maxHp = 10;
    observation.zombies = [threat, decoy];

    const guard = unitByType(observation, 'nationalGuard');
    guard.position = { q: threatPosition.q, r: threatPosition.r + 1 };
    guard.attack = 10;
    guard.range = 2;
    guard.hp = guard.maxHp;
    guard.actionState = 'ready';
    guard.canAttack = true;

    const actions: GameAction[] = [
      { type: 'Attack', attackerId: guard.id, targetId: decoy.id },
      { type: 'Attack', attackerId: guard.id, targetId: threat.id },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'Attack', attackerId: guard.id, targetId: threat.id });
  });

  it('moves National Guard into firing range of a facility-contact threat before chasing a nearer decoy', () => {
    const observation = stabilize(freshObservation());
    const targetFacility = facilityById(observation, 'military-factory-1');
    for (const facility of observation.facilities) {
      if (facility.id !== targetFacility.id) {
        facility.owner = 'none';
        facility.status = 'unowned';
        facility.operationalStatus = 'stopped';
        facility.populationOperational = false;
        facility.populationUnavailableReason = 'not_owned';
      }
    }
    targetFacility.healthyPopulation = 10;

    const threat = visibleZombie(observation, 'zombie-threat');
    const decoy = visibleZombie(observation, 'zombie-decoy');
    // One Forest step plus the Urban destination costs exactly the Zombie's
    // three movement points, so this remains a next-phase contact threat in v1.4.
    threat.position = { q: 25, r: 15 };
    decoy.position = { q: 26, r: 19 };
    observation.zombies = [threat, decoy];

    const guard = unitByType(observation, 'nationalGuard');
    guard.position = { q: 26, r: 20 };
    guard.range = 2;
    guard.movement = 5;
    guard.actionState = 'ready';
    guard.canMove = true;

    const firingPosition = { q: 26, r: 16 };
    const nearerDecoyPosition = { q: 26, r: 19 };
    const actions: GameAction[] = [
      { type: 'Move', unitId: guard.id, destination: nearerDecoyPosition },
      { type: 'Move', unitId: guard.id, destination: firingPosition },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'Move', unitId: guard.id, destination: firingPosition });
  });

  it('keeps Police out of the frontline when no facility or Horde emergency exists', () => {
    const observation = stabilize(freshObservation());
    const zombie = visibleZombie(observation, 'frontline-zombie');
    observation.zombies = [zombie];
    zombie.position = { q: 7, r: 2 };

    const police = unitByType(observation, 'police');
    police.position = { q: 7, r: 7 };
    police.hp = police.maxHp;
    police.actionState = 'ready';
    police.canMove = true;

    const actions: GameAction[] = [
      { type: 'Move', unitId: police.id, destination: { q: 7, r: 4 } },
      { type: 'Wait', unitId: police.id },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'Wait', unitId: police.id });
  });

  it('handles an infected facility before taking a normal Horde-front move', () => {
    const observation = stabilize(freshObservation());
    observation.zombies = [];
    observation.horde.direction = 'east';
    observation.horde.turnsRemaining = 5;
    const infectedFacility = facilityById(observation, 'farm-1');
    infectedFacility.infectedPopulation = 1;
    infectedFacility.operationalStatus = 'infected';
    observation.population.infected = 1;

    const police = unitByType(observation, 'police');
    police.suppressionAvailableIfTurnEndsNow = true;
    police.suppressionTargetId = infectedFacility.id;
    police.suppressionCivilianDamage = 0;
    police.recoveryClassIfTurnEndsNow = 'combat';
    police.recoveryRateIfTurnEndsNow = 0.1;
    const guard = unitByType(observation, 'nationalGuard');
    guard.position = { q: 20, r: 15 };
    guard.movement = 5;
    guard.actionState = 'ready';
    guard.canMove = true;
    const eastEntrance = { q: 30, r: 15 };

    const actions: GameAction[] = [
      { type: 'Move', unitId: guard.id, destination: eastEntrance },
      { type: 'Wait', unitId: police.id },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'Wait', unitId: police.id });
  });

  it('secures an unowned military factory when the military reserve is already below projected demand', () => {
    const observation = stabilize(freshObservation());
    observation.zombies = [];
    observation.resources.militaryGoods = 2;
    observation.endTurnForecast.militaryGoods.startingStock = 2;
    observation.endTurnForecast.militaryGoods.totalRefillDemand = 15;
    observation.endTurnForecast.militaryGoods.totalUnfilledRefillDemand = 13;
    observation.endTurnForecast.militaryGoods.projectedEndingStock = 0;

    const militaryFactory = facilityById(observation, 'military-factory-1');
    const alternateFarm = facilityById(observation, 'farm-2');
    for (const facility of [militaryFactory, alternateFarm]) {
      facility.owner = 'none';
      facility.status = 'unowned';
      facility.operationalStatus = 'stopped';
      facility.populationOperational = false;
      facility.populationUnavailableReason = 'not_owned';
    }

    const guard = unitByType(observation, 'nationalGuard');
    guard.position = { q: 7, r: 7 };
    guard.actionState = 'ready';
    guard.canMove = true;
    const actions: GameAction[] = [
      { type: 'Move', unitId: guard.id, destination: alternateFarm.position },
      { type: 'Move', unitId: guard.id, destination: militaryFactory.position },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'Move', unitId: guard.id, destination: militaryFactory.position });
  });

  it('assigns workers to an owned military factory before a normal farm increase under reserve pressure', () => {
    const observation = stabilize(freshObservation());
    observation.zombies = [];
    observation.resources.militaryGoods = 2;
    observation.endTurnForecast.militaryGoods.startingStock = 2;
    observation.endTurnForecast.militaryGoods.totalRefillDemand = 15;
    observation.endTurnForecast.militaryGoods.totalUnfilledRefillDemand = 13;
    observation.endTurnForecast.militaryGoods.projectedEndingStock = 0;

    const militaryFactory = facilityById(observation, 'military-factory-1');
    const farm = facilityById(observation, 'farm-1');
    militaryFactory.healthyPopulation = 0;
    // A farm at its sustainable baseline is a genuine but lower-value alternative.
    // The military factory must be preferred while the reserve has a large deficit.
    farm.healthyPopulation = 8;
    militaryFactory.populationOperational = true;
    militaryFactory.inSupply = true;
    farm.populationOperational = true;

    const actions: GameAction[] = [
      { type: 'AssignWorkers', facilityId: farm.id, workers: 9 },
      { type: 'AssignWorkers', facilityId: militaryFactory.id, workers: 5 },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'AssignWorkers', facilityId: militaryFactory.id, workers: 5 });
  });

  it('moves people back to the capital when the capital is below its survival buffer', () => {
    const observation = stabilize(freshObservation());
    observation.zombies = [];
    const capital = facilityById(observation, 'capital');
    const farmSource = facilityById(observation, 'farm-1');
    const overcrowdedCity = facilityById(observation, 'city-1');
    const alternateDestination = facilityById(observation, 'farm-2');
    capital.healthyPopulation = 5;
    farmSource.healthyPopulation = farmSource.populationCapacity + 5;
    overcrowdedCity.healthyPopulation = overcrowdedCity.populationCapacity + 10;
    alternateDestination.healthyPopulation = 0;

    const actions: GameAction[] = [
      { type: 'TransferPopulation', fromFacilityId: overcrowdedCity.id, toFacilityId: alternateDestination.id, people: 5 },
      { type: 'TransferPopulation', fromFacilityId: farmSource.id, toFacilityId: capital.id, people: 5 },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({
      type: 'TransferPopulation',
      fromFacilityId: farmSource.id,
      toFacilityId: capital.id,
      people: 5,
    });
  });
});
