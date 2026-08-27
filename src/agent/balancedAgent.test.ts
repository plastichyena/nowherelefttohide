import { beforeEach, describe, expect, it } from 'vitest';
import { hexDistance } from '../core/hex';
import type { GameAction } from '../core/types';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';
import type { AgentObservation } from './types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Balanced Agent scenario intentions', () => {
  let observation: AgentObservation;
  let unitId: string;

  beforeEach(() => {
    observation = createAgentGame().reset({ seed: 1 });
    unitId = observation.units[0]!.id;
  });

  function decide(actions: GameAction[], mutate?: (value: AgentObservation) => void) {
    const value = clone(observation);
    mutate?.(value);
    return new BalancedAgent().decide(value, actions);
  }

  it('prefers a resource improvement over certain shortage defeat', () => {
    const farm = observation.facilities.find((facility) => facility.id === 'farm-1')!;
    const result = decide(
      [{ type: 'AssignWorkers', facilityId: farm.id, workers: farm.healthyPopulation + 1 }, { type: 'EndTurn' }],
      (value) => {
        value.population.healthyCivilians = 1;
        value.endTurnForecast.food.shortage = 2;
      },
    );
    expect(result.action.type).toBe('AssignWorkers');
    expect(result.trace?.priorityGoal).toBe('avoid_defeat');
  });

  it('improves food or civilian-goods shortage', () => {
    const farm = observation.facilities.find((facility) => facility.id === 'farm-1')!;
    const result = decide(
      [{ type: 'AssignWorkers', facilityId: farm.id, workers: farm.healthyPopulation + 1 }, { type: 'EndTurn' }],
      (value) => { value.endTurnForecast.food.shortage = 5; },
    );
    expect(result.action.type).toBe('AssignWorkers');
  });

  it('staffs a power plant during electricity shortage', () => {
    const plant = observation.facilities.find((facility) => facility.type === 'powerPlant' && facility.owner === 'player')!;
    const result = decide(
      [{ type: 'AssignWorkers', facilityId: plant.id, workers: plant.healthyPopulation + 1 }, { type: 'EndTurn' }],
      (value) => { value.endTurnForecast.electricity.shortage = 5; },
    );
    expect(result.trace?.reasonCodes).toContain('RESTORE_POWER');
  });

  it('prefers Police infection suppression over National Guard civilian damage', () => {
    const facility = observation.facilities[0]!;
    const police = observation.units.find((unit) => unit.type === 'police')!;
    const guard = observation.units.find((unit) => unit.type === 'nationalGuard')!;
    const result = decide([
      { type: 'SuppressInfection', unitId: guard.id, facilityId: facility.id },
      { type: 'SuppressInfection', unitId: police.id, facilityId: facility.id },
      { type: 'EndTurn' },
    ], (value) => {
      value.population.infected = 5;
      value.facilities[0]!.infectedPopulation = 5;
    });
    expect(result.action).toMatchObject({ type: 'SuppressInfection', unitId: police.id });
  });

  it('positions National Guard at a frontline facility when Horde arrival is imminent', () => {
    const unit = observation.units[0]!;
    const entrance = observation.map.tiles.find((tile) => tile.hordeEntranceDirections.includes(observation.horde.direction))!;
    const frontline = observation.facilities
      .filter((facility) => facility.owner === 'player' && facility.healthyPopulation > 0)
      .sort((left, right) =>
        hexDistance(left.position, entrance) - hexDistance(right.position, entrance) || left.id.localeCompare(right.id),
      )[0]!;
    const result = decide([
      { type: 'Move', unitId: unit.id, destination: frontline.position },
      { type: 'EndTurn' },
    ], (value) => {
      value.horde.turnsRemaining = 1;
      value.zombies = [];
      value.units.find((candidate) => candidate.id === unit.id)!.position = { q: 7, r: 7 };
    });
    expect(result.action.type).toBe('Move');
    expect(result.trace?.reasonCodes).toContain('DEFEND_FRONTLINE_FACILITY');
  });

  it('relieves severe city overcrowding', () => {
    const from = observation.facilities.find((facility) => facility.type === 'capital')!;
    const to = observation.facilities.find((facility) => facility.type === 'city')!;
    const result = decide([
      { type: 'TransferPopulation', fromFacilityId: from.id, toFacilityId: to.id, people: 5 },
      { type: 'EndTurn' },
    ], (value) => {
      const source = value.facilities.find((facility) => facility.id === from.id)!;
      const target = value.facilities.find((facility) => facility.id === to.id)!;
      source.healthyPopulation = source.populationCapacity + 10;
      target.healthyPopulation = 0;
      value.endTurnForecast.overcrowding.additionalFood = 10;
    });
    expect(result.trace?.reasonCodes).toContain('RELIEVE_OVERCROWDING');
  });

  it('expands toward an unowned facility only in a stable situation', () => {
    const unit = observation.units[0]!;
    const target = observation.facilities.find((facility) => facility.owner === 'none')!;
    const result = decide([
      { type: 'Move', unitId: unit.id, destination: target.position },
      { type: 'EndTurn' },
    ]);
    expect(result.action.type).toBe('Move');
    expect(result.trace?.reasonCodes).toContain('APPROACH_VALUABLE_FACILITY');
  });

  it('produces defenders shortly before a Horde', () => {
    const result = decide([
      { type: 'ProduceUnit', unitType: 'police' },
      { type: 'EndTurn' },
    ], (value) => { value.horde.turnsRemaining = 1; });
    expect(result.action.type).toBe('ProduceUnit');
  });

  it('does not send a badly damaged unit into nearby danger', () => {
    const unit = observation.units[0]!;
    const zombie = observation.zombies[0]!;
    const result = decide([
      { type: 'Move', unitId: unit.id, destination: zombie.position },
      { type: 'Wait', unitId: unit.id },
      { type: 'EndTurn' },
    ], (value) => {
      value.units.find((candidate) => candidate.id === unit.id)!.hp = 1;
    });
    expect(result.action.type).not.toBe('Move');
  });

  it('evaluates checkpoint construction and screening policy', () => {
    const build = decide([{ type: 'BuildCheckpoint', position: { q: 0, r: 7 } }, { type: 'EndTurn' }]);
    expect(build.action.type).toBe('BuildCheckpoint');
    const policy = decide([{ type: 'SetCheckpointPolicy', checkpointId: 'cp-1', policy: 'strict' }, { type: 'EndTurn' }]);
    expect(policy.action.type).toBe('SetCheckpointPolicy');
  });

  it('chooses EndTurn when there is no useful action', () => {
    const result = decide([{ type: 'Wait', unitId }, { type: 'EndTurn' }], (value) => {
      const unit = value.units.find((candidate) => candidate.id === unitId)!;
      unit.hp = unit.maxHp;
      unit.actionState = 'acted';
    });
    expect(result.action.type).toBe('EndTurn');
  });

  it('returns the same decision and trace from equivalent fresh inputs', () => {
    const actions: GameAction[] = [{ type: 'Wait', unitId }, { type: 'EndTurn' }];
    expect(new BalancedAgent().decide(clone(observation), actions)).toEqual(
      new BalancedAgent().decide(clone(observation), actions),
    );
  });
});
