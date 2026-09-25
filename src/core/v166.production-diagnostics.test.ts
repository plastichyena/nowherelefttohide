import { expect, it } from 'vitest';
import { createInitialState } from './state';
import { createDefaultConfig } from './config';
import { calculateEconomyPlan } from './economy-query';

it('distinguishes a switched-off or unpowered converter from missing input stock', () => {
  const state = createInitialState(3, createDefaultConfig());
  state.units = []; state.checkpoints = [];
  for (const facility of state.facilities) { facility.workers = 0; facility.infected = 0; }
  state.config.economy.populationConsumption = { food: 0, civilianGoods: 0 };
  const center = { ...state.facilities.find(f => f.type === 'farm')!, id: 'diagnostic-center',
    type: 'reliefSupplyCenter' as const, position: { q: 23, r: 24 }, workers: 5, workerCapacity: 5,
    operationalStatus: 'operational' as const, constructible: true, powerSupplyEnabled: false };
  state.facilities.push(center); state.resources.food = 1000;
  const project = () => calculateEconomyPlan(state).facilities.find(f => f.facilityId === center.id)!;
  expect(project()).toMatchObject({ inputs: { food: 0 }, inputRequired: { food: 100 }, inputShortage: { food: 0 }, projectedPowerReason: 'power_supply_off' });
  center.powerSupplyEnabled = true;
  for (const facility of state.facilities.filter(f => f.type === 'windPowerPlant')) facility.operationalStatus = 'disabled';
  expect(project()).toMatchObject({ inputs: { food: 0 }, inputShortage: { food: 0 }, projectedPowerReason: 'physical_capacity_shortage' });
  state.resources.food = 0;
  expect(project()).toMatchObject({ inputShortage: { food: 100 }, projectedPowerReason: 'production_input_unavailable' });
});
