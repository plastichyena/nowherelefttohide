import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState } from '../core/state';
import { createAgentObservation } from './observation';

describe('Agent Observation 1.2.0 rule projections', () => {
  it('publishes effective range, automatic suppression, recovery, production, and power facts', () => {
    const state = createInitialState(126, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { ...farm.position };
    guard.hp = 30;
    farm.infected = 4;
    farm.operationalStatus = 'infected';
    state.resources.militarySupplyAvailable = false;

    const observation = createAgentObservation(state);
    const publicGuard = observation.units.find((unit) => unit.id === guard.id)!;
    const publicFarm = observation.facilities.find((facility) => facility.id === farm.id)!;
    expect(publicGuard).toMatchObject({
      baseRange: 2,
      effectiveRange: 1,
      rangeModifierReason: 'military_supply_shortage',
      recoveryClassIfTurnEndsNow: 'combat',
      recoveryRateIfTurnEndsNow: 0.1,
      recoveryBaseAmountIfTurnEndsNow: 5,
      suppressionAvailableIfTurnEndsNow: true,
      suppressionTargetId: farm.id,
    });
    expect(publicGuard.suppressionCivilianDamage).toBe(5);
    expect(publicFarm).toMatchObject({
      populationCapacity: 30,
      infectionContained: true,
      containingUnitId: guard.id,
      projectedSuppression: 4,
      projectedCivilianDamage: 5,
    });
    expect(publicFarm.production).toMatchObject({
      inputsPerWorker: { fuel: 1 },
      outputsPerWorker: { food: 5 },
      requiresPower: true,
      requiredPowerCapacity: 5,
      stoppedReason: 'infection',
    });
  });

  it('returns deterministic detached JSON without private state', () => {
    const state = createInitialState(127, createDefaultConfig());
    const before = JSON.stringify(state);
    const first = createAgentObservation(state);
    const second = createAgentObservation(state);
    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(first)).not.toContain('rngState');
    first.units[0]!.effectiveRange = 999;
    first.facilities[0]!.production.estimatedPowerGeneration = 999;
    expect(createAgentObservation(state)).toEqual(second);
  });

  it('reports no current production loss for a stopped production facility', () => {
    const state = createInitialState(128, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    const powerPlant = state.facilities.find((facility) => facility.id === 'power-plant-1')!;
    farm.workers = 12;
    powerPlant.workers = 0;

    const publicFarm = createAgentObservation(state).facilities.find((facility) => facility.id === farm.id)!;
    expect(publicFarm.production).toMatchObject({
      estimatedInputConsumption: { fuel: 0 },
      estimatedOutput: { food: 0 },
      estimatedPowerGeneration: 0,
      projectedInputLossIfInfectedOrOverrun: { fuel: 0 },
      projectedOutputLossIfInfectedOrOverrun: { food: 0 },
      projectedPowerLossIfInfectedOrOverrun: 0,
      stoppedReason: 'power_unavailable',
    });
  });

  it('uses the Core partial-input allocation for current production and loss estimates', () => {
    const state = createInitialState(129, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    state.resources.fuel = 0;

    const publicFarm = createAgentObservation(state).facilities.find((facility) => facility.id === farm.id)!;
    expect(publicFarm.production).toMatchObject({
      estimatedInputConsumption: { fuel: 0 },
      estimatedOutput: { food: 0 },
      stoppedReason: 'input_shortage',
      projectedInputLossIfInfectedOrOverrun: { fuel: 0 },
      projectedOutputLossIfInfectedOrOverrun: { food: 0 },
    });
  });

  it('leaves the stop reason empty for a fully operating facility', () => {
    const state = createInitialState(130, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const capital = state.facilities.find((facility) => facility.id === 'capital')!;
    const publicCapital = createAgentObservation(state).facilities.find((facility) => facility.id === capital.id)!;

    expect(publicCapital.production.estimatedOutput.civilianGoods).toBe(41);
    expect(publicCapital.production.stoppedReason).toBeNull();
  });
});
