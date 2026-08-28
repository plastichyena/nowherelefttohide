import { describe, expect, it } from 'vitest';
import type { GameAction } from '../core/types';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';
import type { AgentObservation } from './types';

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

/** Keep each scenario focused on the strategic conflict under test. */
function stabilize(observation: AgentObservation): AgentObservation {
  const value = clone(observation);
  value.horde.turnsRemaining = 10;
  value.population.infected = 0;
  value.resources.militarySupplyAvailable = true;
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
    ['the state capital', 'capital', { q: 7, r: 4 }],
    ['an operational farm', 'farm-1', { q: 5, r: 4 }],
  ] as const)('attacks a zombie that can contact %s during the next zombie turn', (_label, facilityId, threatPosition) => {
    const observation = stabilize(freshObservation());
    const targetFacility = facilityById(observation, facilityId);
    targetFacility.healthyPopulation = Math.max(targetFacility.healthyPopulation, 10);

    const threat = observation.zombies[0]!;
    const decoy = observation.zombies[1]!;
    threat.id = 'zombie-threat';
    threat.position = threatPosition;
    threat.hp = 10;
    threat.maxHp = 10;
    decoy.id = 'zombie-a';
    decoy.position = { q: 0, r: 0 };
    decoy.hp = 10;
    decoy.maxHp = 10;

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
    observation.zombies = observation.zombies.slice(0, 2);
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

    const threat = observation.zombies[0]!;
    const decoy = observation.zombies[1]!;
    threat.id = 'zombie-threat';
    threat.position = { q: 5, r: 2 };
    decoy.id = 'zombie-decoy';
    decoy.position = { q: 10, r: 7 };

    const guard = unitByType(observation, 'nationalGuard');
    guard.position = { q: 7, r: 7 };
    guard.range = 2;
    guard.movement = 5;
    guard.actionState = 'ready';
    guard.canMove = true;

    const firingPosition = { q: 7, r: 3 };
    const nearerDecoyPosition = { q: 9, r: 7 };
    const actions: GameAction[] = [
      { type: 'Move', unitId: guard.id, destination: nearerDecoyPosition },
      { type: 'Move', unitId: guard.id, destination: firingPosition },
    ];
    const result = new BalancedAgent().decide(observation, actions);

    expect(result.action).toEqual({ type: 'Move', unitId: guard.id, destination: firingPosition });
  });

  it('keeps Police out of the frontline when no facility or Horde emergency exists', () => {
    const observation = stabilize(freshObservation());
    observation.zombies = observation.zombies.slice(0, 1);
    const zombie = observation.zombies[0]!;
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
    observation.horde.turnsRemaining = 1;
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
    guard.position = { q: 9, r: 7 };
    guard.movement = 5;
    guard.actionState = 'ready';
    guard.canMove = true;
    const eastEntrance = { q: 14, r: 7 };

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
    observation.resources.militarySupplyAvailable = true;
    observation.endTurnForecast.militaryGoods.available = 2;
    observation.endTurnForecast.militaryGoods.maintenanceRequired = 15;
    observation.endTurnForecast.militaryGoods.required = 15;
    observation.endTurnForecast.militaryGoods.shortage = 13;

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
    observation.resources.militarySupplyAvailable = true;
    observation.endTurnForecast.militaryGoods.available = 2;
    observation.endTurnForecast.militaryGoods.maintenanceRequired = 15;
    observation.endTurnForecast.militaryGoods.required = 15;
    observation.endTurnForecast.militaryGoods.shortage = 13;

    const militaryFactory = facilityById(observation, 'military-factory-1');
    const farm = facilityById(observation, 'farm-1');
    militaryFactory.healthyPopulation = 0;
    farm.healthyPopulation = 0;
    militaryFactory.populationOperational = true;
    farm.populationOperational = true;

    const actions: GameAction[] = [
      { type: 'AssignWorkers', facilityId: farm.id, workers: 5 },
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
