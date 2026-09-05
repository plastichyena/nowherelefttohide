import { isCityFacility } from './state';
import type { EndTurnForecast, GameState, ProductionCapacityForecast, ResourceProductionCapacity, ResourceType } from './types';
import type { FacilityProductionProjection } from './economy-types';

const resources: readonly ResourceType[] = ['food', 'civilianGoods', 'militaryGoods', 'fuel'];

/** Derived from the same economy plan as actual production; never searches reallocations. */
export function deriveProductionCapacity(
  state: Readonly<GameState>, forecast: EndTurnForecast,
  projections: readonly FacilityProductionProjection[], availableCityPopulation: number,
): ProductionCapacityForecast {
  const owned = [...state.facilities].filter(f => f.owner === 'player' && f.status !== 'ruined' && f.operationalStatus !== 'building')
    .sort((a, b) => a.id.localeCompare(b.id));
  const projectionById = new Map(projections.map(p => [p.facilityId, p]));
  const facilities: ProductionCapacityForecast['facilities'] = owned.map(f => {
    const config = state.config.facilities[f.type];
    const rule = config.production;
    const city = isCityFacility(f);
    const projection = projectionById.get(f.id);
    const inactiveReasons: string[] = [];
    if (f.workers < config.workerCapacity) inactiveReasons.push('unassigned_workers');
    if (f.infected > 0) inactiveReasons.push('infection');
    if (['disabled', 'recovering'].includes(f.operationalStatus)) inactiveReasons.push(f.operationalStatus);
    if (f.operationalStatus === 'stopped' && f.workers === 0) inactiveReasons.push('no_workers');
    if (projection?.projectedPowerReason && !['not_applicable', 'supplied'].includes(projection.projectedPowerReason)) inactiveReasons.push(projection.projectedPowerReason);
    if (projection?.stoppedReason === 'input_shortage') inactiveReasons.push('production_input_shortage');
    const output = (workers: number) => Object.fromEntries(Object.entries(rule.outputs).map(([r, per]) => [r, per * workers]));
    const residentWorkers = city ? Math.min(f.workers, config.workerCapacity) : 0;
    return {
      facilityId: f.id, inactiveReasons: [...new Set(inactiveReasons)],
      installedRatedOutputs: city ? {} : output(config.workerCapacity),
      currentWorkerRatedOutputs: city ? {} : output(f.workers),
      residentRatedOutputs: city ? output(residentWorkers) : {},
      residentSoftCapRatedCeiling: city ? output(config.workerCapacity) : {},
      residentSoftCapGap: city ? output(config.workerCapacity - residentWorkers) : {},
      installedPowerCapacity: rule.powerGeneration * config.workerCapacity + rule.fixedPowerGeneration,
      currentWorkerPowerCapacity: rule.powerGeneration * f.workers + rule.fixedPowerGeneration,
    };
  });
  const summary = Object.fromEntries(resources.map(resource => {
    const sum = (field: 'installedRatedOutputs' | 'currentWorkerRatedOutputs' | 'residentRatedOutputs') => facilities.reduce((n, f) => n + (f[field][resource] ?? 0), 0);
    const installedFacilityRatedCapacity = sum('installedRatedOutputs');
    const residentRatedOutputAtCurrentPopulation = sum('residentRatedOutputs');
    const currentFacilityWorkerRatedCapacity = sum('currentWorkerRatedOutputs');
    const ratedUpperBoundAtCurrentCityPopulation = installedFacilityRatedCapacity + residentRatedOutputAtCurrentPopulation;
    const projectedEndTurnOutput = projections.reduce((n, p) => n + (p.outputs[resource] ?? 0), 0);
    const ratedGapUpperBound = ratedUpperBoundAtCurrentCityPopulation - projectedEndTurnOutput;
    if (ratedGapUpperBound < 0) throw new Error(`Production exceeds rated capacity: ${resource}`);
    const blockingReasonCounts: Record<string, number> = {};
    facilities.filter(f => (f.installedRatedOutputs[resource] ?? 0) + (f.residentSoftCapRatedCeiling[resource] ?? 0) > 0)
      .forEach(f => f.inactiveReasons.forEach(r => { blockingReasonCounts[r] = (blockingReasonCounts[r] ?? 0) + 1; }));
    const value: ResourceProductionCapacity = {
      projectedEndTurnOutput, installedFacilityRatedCapacity, residentRatedOutputAtCurrentPopulation,
      ratedUpperBoundAtCurrentCityPopulation, currentFacilityWorkerRatedCapacity,
      currentTotalRatedCapacity: currentFacilityWorkerRatedCapacity + residentRatedOutputAtCurrentPopulation,
      currentPlanPrePowerOutput: projections.reduce((n, p) => n + (p.baseOutputs[resource] ?? 0), 0),
      ratedGapUpperBound, utilizationRatio: ratedUpperBoundAtCurrentCityPopulation > 0 ? projectedEndTurnOutput / ratedUpperBoundAtCurrentCityPopulation : null,
      utilizationUnavailableReason: ratedUpperBoundAtCurrentCityPopulation > 0 ? null : 'no_rated_capacity',
      blockingReasonCounts, feasibleHeadroom: 'not_computed',
    };
    return [resource, value];
  })) as ProductionCapacityForecast['resources'];
  return {
    targetTurn: state.turn, cityPopulationBasis: 'current_healthy_residents',
    facilityScope: 'player_owned_completed_not_ruined_including_temporarily_unavailable',
    boundsSimultaneouslyAchievable: false, blockingReasonsOverlap: true,
    exactReallocationCapacityComputed: false, availableCityPopulation,
    remainingActions: Math.max(0, state.config.maxActionsPerTurn - state.actionsTakenThisTurn),
    resources: summary, facilities,
    electricity: {
      installedFacilityRatedCapacity: facilities.reduce((n, f) => n + f.installedPowerCapacity, 0),
      currentFacilityWorkerRatedCapacity: facilities.reduce((n, f) => n + f.currentWorkerPowerCapacity, 0),
      currentPlanPhysicalCapacity: forecast.electricity.physicalGenerationCapacity,
      availableGenerationCapacity: forecast.electricity.availableGenerationCapacity,
      demand: forecast.electricity.requiredPowerDemand, allocated: forecast.electricity.requiredPowerAllocated,
      unallocatedAvailableCapacity: forecast.electricity.availableGenerationCapacity - forecast.electricity.requiredPowerAllocated,
      storable: false, fuelBasis: 'turn_start_stock',
    },
  };
}
