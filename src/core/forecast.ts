import { forecastEndTurn, forecastFacilityProduction } from './engine';
import type {
  CriticalResourceDependencyForecast,
  GameState,
  QueuePressureClass,
  ResourceContributorForecast,
  StrategicForecast,
  StrategicResourceType,
} from './types';

function contributorsFor(
  state: Readonly<GameState>,
  resource: StrategicResourceType,
): ResourceContributorForecast[] {
  const projections = forecastFacilityProduction(state);
  const raw = projections
    .map((projection) => ({
      facilityId: projection.facilityId,
      amount: resource === 'electricity'
        ? projection.powerGeneration
        : projection.outputs[resource] ?? 0,
    }))
    .filter((entry) => entry.amount > 0)
    .sort((left, right) => right.amount - left.amount || left.facilityId.localeCompare(right.facilityId));
  const total = raw.reduce((sum, entry) => sum + entry.amount, 0);
  return raw.map((entry) => ({ ...entry, share: total > 0 ? entry.amount / total : 0 }));
}

export function getQueuePressureClass(queuePeople: number, capacity: number): QueuePressureClass {
  if (queuePeople <= 0) return 'none';
  if (queuePeople <= capacity) return 'low';
  if (queuePeople <= capacity * 2) return 'medium';
  return 'high';
}

/** Pure strategic projection shared by Human UI, Observation, and agents. */
export function deriveStrategicForecast(state: Readonly<GameState>): StrategicForecast {
  const economy = forecastEndTurn(state);
  const supplyAndDemand: Record<StrategicResourceType, { supply: number; demand: number; short: boolean }> = {
    food: {
      supply: economy.food.startingStock + economy.food.projectedProduction,
      demand: economy.food.maintenanceRequired,
      short: economy.food.shortage > 0,
    },
    civilianGoods: {
      supply: economy.civilianGoods.startingStock + economy.civilianGoods.projectedProduction,
      demand: economy.civilianGoods.maintenanceRequired + economy.civilianGoods.productionInputDemand,
      short: economy.civilianGoods.maintenanceShortage > 0,
    },
    militaryGoods: {
      supply: economy.militaryGoods.startingStock + economy.militaryGoods.projectedProduction,
      demand: economy.militaryGoods.totalRefillDemand,
      short: economy.militaryGoods.totalUnfilledRefillDemand > 0,
    },
    fuel: {
      supply: economy.fuel.turnStartFuel + economy.fuel.projectedRefineryProduction,
      demand: economy.fuel.projectedTotalFuelDemand,
      short: economy.fuel.totalFuelShortage > 0,
    },
    electricity: {
      supply: economy.electricity.availableGenerationCapacity,
      demand: economy.electricity.required,
      short: economy.electricity.shortage > 0,
    },
  };
  const resources = Object.fromEntries(
    (['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricity'] as const).map((resource) => {
      const contributors = contributorsFor(state, resource);
      const largest = contributors[0] ?? null;
      const current = supplyAndDemand[resource];
      const projectedSupplyWithoutLargestContributor = Math.max(0, current.supply - (largest?.amount ?? 0));
      const shortageWithoutLargestContributor = Math.max(0, current.demand - projectedSupplyWithoutLargestContributor);
      const value: CriticalResourceDependencyForecast = {
        resource,
        currentSupply: current.supply,
        currentDemand: current.demand,
        contributors,
        largestContributorFacilityId: largest?.facilityId ?? null,
        projectedSupplyWithoutLargestContributor,
        shortageWithoutLargestContributor,
        singlePointOfFailure: !current.short && largest !== null && shortageWithoutLargestContributor > 0,
        currentlyShort: current.short,
      };
      return [resource, value];
    }),
  ) as StrategicForecast['resources'];

  const afterFood = Math.max(0, state.population.healthyCivilians - economy.food.shortage);
  const afterCivilianGoods = Math.max(0, afterFood - economy.civilianGoods.maintenanceShortage);
  const guaranteed = afterCivilianGoods === 0;
  return {
    resources,
    guaranteedDefeat: {
      guaranteed,
      causeResource: !guaranteed
        ? null
        : afterFood === 0
          ? 'food'
          : 'civilianGoods',
      foodShortage: economy.food.shortage,
      civilianGoodsShortage: economy.civilianGoods.maintenanceShortage,
      projectedHealthyCivilians: afterCivilianGoods,
      defeatReason: guaranteed ? 'healthyCiviliansLost' : null,
    },
  };
}
