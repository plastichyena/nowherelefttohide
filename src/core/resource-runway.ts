import type { EndTurnForecast, StrategicResourceType } from './types';

export type ResourceRunwayUnavailableReason =
  | 'not_depleting'
  | 'non_storable'
  | 'input_dependency_unstable';

export interface ResourceRunwayEstimate {
  netBurn: number | null;
  /** One means the next EndTurn. */
  estimatedShortageTurn: number | null;
  unavailableReason: ResourceRunwayUnavailableReason | null;
  nextEndTurnShortage: boolean;
}

export interface ResourceRunwayForecast {
  assumption: 'static_current_conditions';
  currentStock: number | null;
  projectedCurrentProduction: number;
  largestContributorOutput: number;
  productionWithoutLargestContributor: number;
  currentDemandBasis: number;
  demandBreakdown: Record<string, number>;
  current: ResourceRunwayEstimate;
  withoutLargestContributor: ResourceRunwayEstimate;
}

export type ResourceRunwayOrder =
  | 'production_before_demand'
  | 'civilian_goods_reservation'
  | 'production_after_demand';

export type ElectricityContributorKind = 'wind' | 'fuel_power';

export interface ResourceRunwayContext {
  electricityContributorKind?: ElectricityContributorKind | null;
  militaryGoodsArmyBaseRefillDemand?: number;
}

interface EstimateResourceRunwayInput {
  startingStock: number;
  production: number;
  demand: number;
  order: ResourceRunwayOrder;
  nextEndTurnShortage: boolean;
  unavailableReason?: Extract<ResourceRunwayUnavailableReason, 'input_dependency_unstable'> | null;
  maintenanceDemand?: number;
  productionInputDemand?: number;
}

/**
 * Estimates the first shortage with integer stock while preserving the
 * established EndTurn availability order. A successful turn that merely ends
 * at stock zero is not a shortage; the following turn is.
 */
export function estimateResourceRunway(input: EstimateResourceRunwayInput): ResourceRunwayEstimate {
  const stock = Math.max(0, input.startingStock);
  const production = Math.max(0, input.production);
  const demand = Math.max(0, input.demand);
  const netBurn = demand - production;

  if (input.unavailableReason) {
    return {
      netBurn,
      estimatedShortageTurn: null,
      unavailableReason: input.unavailableReason,
      nextEndTurnShortage: input.nextEndTurnShortage,
    };
  }
  if (input.nextEndTurnShortage) {
    return { netBurn, estimatedShortageTurn: 1, unavailableReason: null, nextEndTurnShortage: true };
  }
  if (netBurn <= 0) {
    return {
      netBurn,
      estimatedShortageTurn: null,
      unavailableReason: 'not_depleting',
      nextEndTurnShortage: false,
    };
  }

  if (input.order === 'production_after_demand') {
    const successfulStockMargin = stock - demand;
    return {
      netBurn,
      estimatedShortageTurn: Math.floor(successfulStockMargin / netBurn) + 2,
      unavailableReason: null,
      nextEndTurnShortage: false,
    };
  }
  if (input.order === 'civilian_goods_reservation') {
    const maintenance = Math.max(0, input.maintenanceDemand ?? 0);
    const productionInput = Math.max(0, input.productionInputDemand ?? 0);
    const minimumStartingStock = productionInput + Math.max(0, maintenance - production);
    const successfulStockMargin = stock - minimumStartingStock;
    return {
      netBurn,
      estimatedShortageTurn: Math.floor(successfulStockMargin / netBurn) + 2,
      unavailableReason: null,
      nextEndTurnShortage: false,
    };
  }
  return {
    netBurn,
    estimatedShortageTurn: Math.floor(stock / netBurn) + 1,
    unavailableReason: null,
    nextEndTurnShortage: false,
  };
}

function civilianGoodsShortage(
  stock: number,
  production: number,
  maintenance: number,
  productionInput: number,
): boolean {
  const maintenanceReservation = Math.max(0, maintenance - production);
  const inputAllocated = Math.min(productionInput, Math.max(0, stock - maintenanceReservation));
  const maintenanceAvailable = stock - inputAllocated + production;
  return inputAllocated < productionInput || maintenanceAvailable < maintenance;
}

export function deriveResourceRunwayForecast(
  resource: StrategicResourceType,
  economy: Readonly<EndTurnForecast>,
  largestContributorOutput: number,
  context: Readonly<ResourceRunwayContext> = {},
): ResourceRunwayForecast {
  const largestOutput = Math.max(0, largestContributorOutput);
  let currentStock: number | null;
  let production: number;
  let demand: number;
  let demandBreakdown: Record<string, number>;
  let order: ResourceRunwayOrder;
  let nextEndTurnShortage: boolean;
  let unavailableReason: EstimateResourceRunwayInput['unavailableReason'] = null;

  switch (resource) {
    case 'food':
      currentStock = economy.food.startingStock;
      production = economy.food.projectedProduction;
      demand = economy.food.maintenanceRequired;
      demandBreakdown = { maintenance: demand };
      order = 'production_before_demand';
      nextEndTurnShortage = economy.food.shortage > 0;
      break;
    case 'civilianGoods':
      currentStock = economy.civilianGoods.startingStock;
      production = economy.civilianGoods.projectedProduction;
      demand = economy.civilianGoods.maintenanceRequired + economy.civilianGoods.productionInputDemand;
      demandBreakdown = {
        maintenance: economy.civilianGoods.maintenanceRequired,
        productionInput: economy.civilianGoods.productionInputDemand,
      };
      order = 'civilian_goods_reservation';
      nextEndTurnShortage = economy.civilianGoods.maintenanceShortage > 0
        || economy.civilianGoods.productionInputShortage > 0;
      break;
    case 'militaryGoods':
      currentStock = economy.militaryGoods.startingStock;
      production = economy.militaryGoods.projectedProduction;
      demand = economy.militaryGoods.totalRefillDemand
        + Math.max(0, context.militaryGoodsArmyBaseRefillDemand ?? 0);
      demandBreakdown = {
        unitRefill: economy.militaryGoods.totalRefillDemand,
        armyBaseRefill: Math.max(0, context.militaryGoodsArmyBaseRefillDemand ?? 0),
      };
      order = 'production_before_demand';
      nextEndTurnShortage = economy.militaryGoods.totalUnfilledRefillDemand > 0
        || economy.militaryGoods.startingStock + economy.militaryGoods.projectedProduction < demand;
      unavailableReason = economy.civilianGoods.productionInputShortage > 0
        ? 'input_dependency_unstable'
        : null;
      break;
    case 'fuel':
      currentStock = economy.fuel.turnStartFuel;
      production = economy.fuel.projectedRefineryProduction;
      demand = economy.fuel.projectedTotalFuelDemand;
      demandBreakdown = {
        powerGeneration: economy.fuel.projectedPowerFuelDemand,
        unitRefill: economy.fuel.projectedUnitRefillDemand,
      };
      order = 'production_after_demand';
      nextEndTurnShortage = economy.fuel.totalFuelShortage > 0;
      break;
    case 'electricity': {
      const electricityContributorKind = context.electricityContributorKind ?? null;
      const currentProduction = economy.electricity.availableGenerationCapacity;
      const windWithoutLargest = Math.max(
        0,
        economy.fuel.windPowerAvailable - (electricityContributorKind === 'wind' ? largestOutput : 0),
      );
      const powerPlantWithoutLargest = Math.max(
        0,
        economy.fuel.powerPlantPhysicalCapacity
          - (electricityContributorKind === 'fuel_power' ? largestOutput : 0),
      );
      const fuelLimitedPower = Math.floor(economy.fuel.turnStartFuel / 2) * 5;
      const physicalWithoutLargest = windWithoutLargest + powerPlantWithoutLargest;
      const fuelLimitedWithoutLargest = windWithoutLargest
        + Math.min(powerPlantWithoutLargest, fuelLimitedPower);
      const productionWithoutLargest = electricityContributorKind === null
        ? currentProduction
        : Math.floor(Math.min(physicalWithoutLargest, fuelLimitedWithoutLargest) / 5) * 5;
      const nonStorable = (
        nextShortage: boolean,
      ): ResourceRunwayEstimate => ({
        netBurn: null,
        estimatedShortageTurn: null,
        unavailableReason: 'non_storable',
        nextEndTurnShortage: nextShortage,
      });
      return {
        assumption: 'static_current_conditions',
        currentStock: null,
        projectedCurrentProduction: currentProduction,
        largestContributorOutput: largestOutput,
        productionWithoutLargestContributor: productionWithoutLargest,
        currentDemandBasis: economy.electricity.requiredPowerDemand,
        demandBreakdown: { requiredPower: economy.electricity.requiredPowerDemand },
        current: nonStorable(economy.electricity.shortage > 0),
        withoutLargestContributor: nonStorable(
          productionWithoutLargest < economy.electricity.requiredPowerDemand,
        ),
      };
    }
  }

  const productionWithoutLargest = Math.max(0, production - largestOutput);
  const common = {
    startingStock: currentStock,
    demand,
    order,
    unavailableReason,
    maintenanceDemand: resource === 'civilianGoods' ? economy.civilianGoods.maintenanceRequired : undefined,
    productionInputDemand: resource === 'civilianGoods' ? economy.civilianGoods.productionInputDemand : undefined,
  };
  const withoutLargestNextShortage = resource === 'civilianGoods'
    ? civilianGoodsShortage(
      currentStock,
      productionWithoutLargest,
      economy.civilianGoods.maintenanceRequired,
      economy.civilianGoods.productionInputDemand,
    )
    : order === 'production_after_demand'
      ? currentStock < demand
      : currentStock + productionWithoutLargest < demand;

  return {
    assumption: 'static_current_conditions',
    currentStock,
    projectedCurrentProduction: production,
    largestContributorOutput: largestOutput,
    productionWithoutLargestContributor: productionWithoutLargest,
    currentDemandBasis: demand,
    demandBreakdown,
    current: estimateResourceRunway({ ...common, production, nextEndTurnShortage }),
    withoutLargestContributor: estimateResourceRunway({
      ...common,
      production: productionWithoutLargest,
      nextEndTurnShortage: withoutLargestNextShortage,
    }),
  };
}
