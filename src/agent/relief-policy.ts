import type { GameAction } from '../core/types';
import type { AgentObservation } from './types';

/** Uses only public stocks, feasible forecasts and legal worker assignments. */
export function reliefPolicy(observation: AgentObservation, action: GameAction): { score: number; reason: string } | null {
  const centers = observation.facilities.filter(f => f.type === 'reliefSupplyCenter' && f.owner === 'player');
  const food = observation.endTurnForecast.food;
  const civilian = observation.endTurnForecast.civilianGoods;
  const inputBudget = Math.max(0, observation.resources.food - Math.max(0, food.maintenanceRequired - food.projectedProduction));
  const needsGoods = civilian.maintenanceShortage > 0 || civilian.endingStock < civilian.maintenanceRequired * 3 + 100;
  const answer = (score: number, reason: string) => ({ score, reason });
  if (action.type === 'BuildConstructibleFacility' && action.facilityType === 'reliefSupplyCenter') {
    const staffingAvailable = observation.facilities.some(f => f.owner === 'player' && f.inSupply && ['capital','city','temporaryHousing'].includes(f.type) && f.healthyPopulation >= 6);
    const powerAvailable = observation.endTurnForecast.electricity.availableGenerationCapacity - observation.endTurnForecast.electricity.requiredPowerAllocated >= 5;
    const ready = staffingAvailable && powerAvailable && needsGoods && inputBudget >= 100 && food.shortage === 0 && observation.resources.civilianGoods >= 50 &&
      !centers.some(f => f.operationalStatus === 'building' || f.healthyPopulation < f.populationCapacity) &&
      inputBudget - food.productionInputAllocated >= 100;
    return answer(ready ? 360 : -10000, ready ? 'BUILD_RELIEF_FOR_GOODS_DEFICIT' : 'RELIEF_BUILD_NOT_SUSTAINABLE');
  }
  if (action.type !== 'AssignWorkers' && action.type !== 'SetPowerSupply') return null;
  const facility = centers.find(f => f.id === action.facilityId);
  if (!facility) return null;
  const otherInput = centers.filter(f => f.id !== facility.id).reduce((sum, f) => sum + (f.production.estimatedInputConsumption.food ?? 0), 0);
  const target = needsGoods && facility.inSupply && facility.infectedPopulation === 0 && food.shortage === 0
    ? Math.min(5, Math.floor(Math.max(0, inputBudget - otherInput) / 20)) : 0;
  if (action.type === 'AssignWorkers') {
    const improvement = Math.abs(facility.healthyPopulation - target) - Math.abs(action.workers - target);
    return answer(improvement > 0 ? 380 + improvement * 10 : -10000, target > 0 ? 'STAFF_RELIEF_WITH_SURPLUS_FOOD' : 'RELEASE_UNPRODUCTIVE_RELIEF_WORKERS');
  }
  const shouldEnable = target > 0 && facility.healthyPopulation > 0;
  return answer(action.enabled === shouldEnable ? 400 : -10000, shouldEnable ? 'ENABLE_RELIEF_CONVERSION' : 'STOP_RELIEF_TO_PRESERVE_FOOD');
}
