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
    expect(result.trace?.reasonCodes).toContain('PREVENT_POWER_CASCADE');
  });

  it('prefers Police automatic suppression over National Guard civilian damage', () => {
    const facility = observation.facilities[0]!;
    const police = observation.units.find((unit) => unit.type === 'police')!;
    const guard = observation.units.find((unit) => unit.type === 'nationalGuard')!;
    const result = decide([
      { type: 'Wait', unitId: guard.id },
      { type: 'Wait', unitId: police.id },
      { type: 'EndTurn' },
    ], (value) => {
      value.population.infected = 5;
      value.facilities[0]!.infectedPopulation = 5;
      for (const unit of value.units) {
        unit.suppressionAvailableIfTurnEndsNow = true;
        unit.suppressionTargetId = facility.id;
        unit.suppressionCivilianDamage = unit.type === 'nationalGuard' ? 5 : 0;
        unit.recoveryClassIfTurnEndsNow = 'combat';
        unit.recoveryRateIfTurnEndsNow = 0.1;
      }
    });
    expect(result.action).toMatchObject({ type: 'Wait', unitId: police.id });
    expect(result.trace?.reasonCodes).toContain('PREFER_POLICE_SUPPRESSION');
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

  it('prioritizes an imminent unmanaged road and distinguishes relocation', () => {
    const branch = observation.roadBranches[0]!;
    const build = decide([
      { type: 'BuildCheckpoint', branchId: branch.branchId, position: branch.roadTiles[0]! },
      { type: 'EndTurn' },
    ], (value) => {
      const target = value.roadBranches.find((candidate) => candidate.branchId === branch.branchId)!;
      target.turnsUntilArrival = 1;
      target.nextArrivalTurn = value.turn + 1;
      target.activeCheckpointId = null;
    });
    expect(build.action.type).toBe('BuildCheckpoint');
    expect(build.trace?.reasonCodes).toContain('ROAD_ARRIVAL_IMMINENT');

    const checkpoint = {
      id: 'checkpoint-north-1',
      branchId: branch.branchId,
      position: { ...branch.roadTiles[0]! },
      direction: branch.direction,
      status: 'operational' as const,
      waiting: 0,
      screening: 0,
      approved: 0,
      infected: 0,
      remainingTurns: 0,
      currentPolicy: 'normal' as const,
      nextPolicy: 'normal' as const,
      nextArrivalTurn: branch.nextArrivalTurn,
      providesSupply: true,
      infectionContained: false,
      containingUnitId: null,
      projectedSuppression: 0,
      projectedCivilianDamage: 0,
    };
    const relocate = decide([
      { type: 'RelocateCheckpoint', checkpointId: checkpoint.id, branchId: branch.branchId, position: { ...branch.roadTiles[1]! } },
      { type: 'EndTurn' },
    ], (value) => {
      value.checkpoints = [checkpoint];
      value.roadBranches.find((candidate) => candidate.branchId === branch.branchId)!.activeCheckpointId = checkpoint.id;
    });
    expect(relocate.action.type).toBe('RelocateCheckpoint');
    expect(relocate.trace?.reasonCodes).toContain('RELOCATE_CHECKPOINT');
  });

  it('does not choose supply-blocked worker increases or recovery waits', () => {
    const facility = observation.facilities.find((candidate) => candidate.type === 'farm' && candidate.owner === 'player')!;
    const unit = observation.units.find((candidate) => candidate.hp === candidate.maxHp)!;
    const assign = decide([
      { type: 'AssignWorkers', facilityId: facility.id, workers: facility.healthyPopulation + 1 },
      { type: 'EndTurn' },
    ], (value) => {
      value.facilities.find((candidate) => candidate.id === facility.id)!.inSupply = false;
    });
    expect(assign.action.type).toBe('EndTurn');

    const wait = decide([
      { type: 'Wait', unitId: unit.id },
      { type: 'EndTurn' },
    ], (value) => {
      const target = value.units.find((candidate) => candidate.id === unit.id)!;
      target.hp = Math.max(1, target.maxHp - 1);
      target.inSupply = false;
      target.recoveryClassIfTurnEndsNow = 'outOfSupply';
      target.recoveryRateIfTurnEndsNow = 0;
      target.recoveryBaseAmountIfTurnEndsNow = 0;
    });
    expect(wait.action.type).toBe('EndTurn');
  });

  it('retreats a damaged out-of-supply unit into the public supply network', () => {
    const unit = observation.units.find((candidate) => candidate.type === 'police')!;
    const suppliedKey = observation.supply.suppliedTileKeys[0]!;
    const [q, r] = suppliedKey.split(',').map(Number);
    const supplied = { q: q!, r: r! };
    const exposed = { q: 0, r: 0 };
    const result = decide([
      { type: 'Move', unitId: unit.id, destination: supplied },
      { type: 'Move', unitId: unit.id, destination: exposed },
      { type: 'EndTurn' },
    ], (value) => {
      value.zombies = [];
      value.population.infected = 0;
      const target = value.units.find((candidate) => candidate.id === unit.id)!;
      target.hp = Math.floor(target.maxHp / 2);
      target.inSupply = false;
      target.recoveryClassIfTurnEndsNow = 'outOfSupply';
      target.recoveryRateIfTurnEndsNow = 0;
    });
    expect(result.action).toEqual({ type: 'Move', unitId: unit.id, destination: supplied });
    expect(result.trace?.reasonCodes).toContain('RETREAT_TO_SUPPLY_FOR_RECOVERY');
  });

  it('uses rest recovery for a safely damaged unit', () => {
    const unit = observation.units.find((candidate) => candidate.type === 'nationalGuard')!;
    const result = decide([{ type: 'Wait', unitId: unit.id }, { type: 'EndTurn' }], (value) => {
      value.zombies = [];
      value.population.infected = 0;
      const target = value.units.find((candidate) => candidate.id === unit.id)!;
      target.hp = Math.floor(target.maxHp / 2);
      target.recoveryClassIfTurnEndsNow = 'rest';
      target.recoveryRateIfTurnEndsNow = 0.2;
      target.recoveryBaseAmountIfTurnEndsNow = 10;
    });
    expect(['Wait', 'EndTurn']).toContain(result.action.type);
    const waitCandidate = result.trace?.topCandidates.find((candidate) => candidate.action.type === 'Wait');
    expect(waitCandidate?.reasonCodes).toContain('REST_RECOVERY_20_PERCENT');
  });

  it('changes checkpoint policy intent between population need and infection crisis', () => {
    const branch = observation.roadBranches[0]!;
    const checkpoint = {
      id: 'checkpoint-policy-test',
      branchId: branch.branchId,
      position: { ...branch.roadTiles[0]! },
      direction: branch.direction,
      status: 'operational' as const,
      waiting: 5,
      screening: 0,
      approved: 0,
      infected: 0,
      remainingTurns: 0,
      currentPolicy: 'normal' as const,
      nextPolicy: 'normal' as const,
      nextArrivalTurn: branch.nextArrivalTurn,
      providesSupply: true,
      infectionContained: false,
      containingUnitId: null,
      projectedSuppression: 0,
      projectedCivilianDamage: 0,
    };
    const actions: GameAction[] = [
      { type: 'SetCheckpointPolicy', checkpointId: checkpoint.id, policy: 'passThrough' },
      { type: 'SetCheckpointPolicy', checkpointId: checkpoint.id, policy: 'strict' },
      { type: 'EndTurn' },
    ];
    const population = decide(actions, (value) => {
      value.checkpoints = [checkpoint];
      value.roadBranches[0]!.activeCheckpointId = checkpoint.id;
      value.population.healthyCivilians = 15;
      value.population.infected = 0;
    });
    expect(population.action).toMatchObject({ type: 'SetCheckpointPolicy', policy: 'passThrough' });
    expect(population.trace?.reasonCodes).toContain('POLICY_GROW_POPULATION');

    const infection = decide(actions, (value) => {
      value.checkpoints = [checkpoint];
      value.roadBranches[0]!.activeCheckpointId = checkpoint.id;
      value.population.healthyCivilians = 50;
      value.population.infected = 5;
    });
    expect(infection.action).toMatchObject({ type: 'SetCheckpointPolicy', policy: 'strict' });
    expect(infection.trace?.reasonCodes).toContain('POLICY_REDUCE_INFECTION_RISK');
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
