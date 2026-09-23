import { forecastEndTurn, forecastNextTurnPenalties, forecastFacilityProduction } from './economy-query';
import { forecastUnitSuppression, getUnitLegalAttackProjections } from './combat-query';
import { deriveStrategicForecast } from './forecast';
import { deriveCheckpointRole, isHexSupplied } from './supply';
import { isHumanUnit } from './state';
import type { CrisisAlert, CrisisSeverity, EndTurnRisk, EndTurnRiskUnit, GameAction, GameState, JsonObject } from './types';

const severityOrder: Record<CrisisSeverity, number> = { critical: 0, warning: 1, advisory: 2 };

/** Public fact comparisons, exhaustive for the current crisis contract. */
export const CRISIS_WORSENING_FACTS = {
  capital_resident_minimum: { healthyPopulation: 'down' },
  public_health_food_stress: { deficit: 'up', stress: 'up', accumulation: 'up' },
  public_health_civilian_goods_stress: { deficit: 'up', stress: 'up' },
  food_starvation_risk: { rate: 'up', populationLost: 'up', accumulation: 'up' },
  internal_infection_risk: { probability: 'up', expectedInfections: 'up', healthyPopulation: 'down' },
  checkpoint_health_risk: { probability: 'up', waiting: 'up' },
  refinery_allowance_runway_risk: { netBurn: 'up', estimatedTurnsRemaining: 'down' },
  air_base_early_capture_window: { turnsRemaining: 'down' },
  nuclear_early_capture_window: { turnsRemaining: 'down' },
  nuclear_power_outage: { lostGeneration: 'up', shortage: 'up' },
  overcrowding_forecast: { penaltyRatio: 'up', additionalFood: 'up', additionalCivilianGoods: 'up' },
  temporary_housing_outage_forecast: { outageCount: 'up', penaltyRatio: 'up', additionalFood: 'up', additionalCivilianGoods: 'up' },
  capital_infection_uncontained: { infected: 'up', healthyPopulation: 'down', suppressionUnitAvailable: 'false' },
  critical_site_infection_uncontained: { infected: 'up', healthyPopulation: 'down', currentProductionLoss: 'up' },
  checkpoint_defense_degraded: { standbyCount: 'down', fallbackDepth: 'down', roleChangedThisTurn: 'true', activeCheckpointId: 'lost' },
  unit_out_of_supply_risk: { hp: 'down', fuel: 'down', militaryGoods: 'down' },
  horde_warning_active: { turnsRemaining: 'down', directionCount: 'up', final: 'true' },
  guaranteed_resource_defeat: { foodShortage: 'up', civilianGoodsShortage: 'up', healthyCivilians: 'down' },
  new_state_loss: { eventId: 'changed' },
  production_outage: { stoppedWorkers: 'up' },
  resource_runway_risk: { netBurn: 'up', estimatedShortageTurn: 'down', nextEndTurnShortage: 'true' },
  military_goods_national_shortage: { unfilledSuppliedDemand: 'up', nationalEndingStock: 'down' },
  military_goods_supply_disconnected: { disconnectedDemand: 'up', disconnectedUnitCount: 'up' },
  facility_workers_zero: { stoppedWorkers: 'up' },
  refinery_allowance_exhausted: { availableAllowance: 'down' },
  oil_field_allowance_blocked: { blockedWorkers: 'up' },
} satisfies Record<CrisisAlert['reasonCode'], Record<string, string>>;

type ComparableCrisis = Pick<CrisisAlert, 'id' | 'reasonCode' | 'entityIds' | 'severity' | 'publicFacts'>;
export function comparePublicCrisisAlerts(before: readonly ComparableCrisis[], after: readonly ComparableCrisis[]): { newAlertIds: string[]; worsenedAlertIds: string[] } {
  const identity = (a: ComparableCrisis) => `${a.reasonCode}:${[...a.entityIds].sort().join(',') || 'state'}`;
  const previous = new Map(before.map(a => [identity(a), a]));
  const newAlertIds: string[] = [], worsenedAlertIds: string[] = [];
  for (const current of after) {
    const old = previous.get(identity(current));
    if (!old) { newAlertIds.push(current.id); continue; }
    const worse = severityOrder[current.severity] < severityOrder[old.severity] || Object.entries(CRISIS_WORSENING_FACTS[current.reasonCode]).some(([key, direction]) => {
      const a = old.publicFacts[key], b = current.publicFacts[key];
      if (direction === 'up' || direction === 'down') return typeof a === 'number' && typeof b === 'number' && (direction === 'up' ? b > a : b < a);
      if (direction === 'true') return a === false && b === true;
      if (direction === 'false') return a === true && b === false;
      if (direction === 'lost') return a != null && b == null;
      return a !== b;
    });
    if (worse) worsenedAlertIds.push(current.id);
  }
  return { newAlertIds, worsenedAlertIds };
}

function alert(
  severity: CrisisSeverity,
  category: CrisisAlert['category'],
  reasonCode: CrisisAlert['reasonCode'],
  entityIds: string[],
  publicFacts: JsonObject,
  suggestedActionKinds: GameAction['type'][] = [],
): CrisisAlert {
  return {
    id: `${reasonCode}:${[...entityIds].sort().join(',') || 'state'}`,
    severity,
    category,
    reasonCode,
    entityIds: [...entityIds].sort(),
    publicFacts,
    titleKey: `alert.${reasonCode}.title`,
    bodyKey: `alert.${reasonCode}.body`,
    params: structuredClone(publicFacts),
    evidence: [structuredClone(publicFacts)],
    suggestedActionKinds: [...suggestedActionKinds],
    sourceRevision: 0,
  };
}

function isContained(state: Readonly<GameState>, position: { q: number; r: number }): boolean {
  return state.units.some((unit) => isHumanUnit(unit) && unit.position.q === position.q && unit.position.r === position.r);
}

function currentTurnLossEvents(state: Readonly<GameState>) {
  return state.events.filter((event) => event.turn === state.turn && (
    event.type === 'site_fallen'
    || event.type === 'facility_overrun'
    || event.type === 'checkpoint_fallback'
    || (event.type === 'unit_destroyed' && event.payload.isPlayerUnit === true)
  ));
}

/** Pure, public-information-only crisis projection shared by UI and Agent APIs. */
export function deriveCrisisSummary(state: Readonly<GameState>): CrisisAlert[] {
  const alerts: CrisisAlert[] = [];
  const capital = state.facilities.find((facility) => facility.type === 'capital');
  if (capital && capital.infected > 0 && !isContained(state, capital.position)) {
    const suppressors = state.units.filter((unit) => isHumanUnit(unit) && unit.attackChargesRemaining > 0);
    alerts.push(alert('critical', 'infection', 'capital_infection_uncontained', [capital.id], {
      infected: capital.infected,
      healthyPopulation: capital.workers,
      suppressionUnitAvailable: suppressors.length > 0,
    }));
  }

  for (const facility of [...state.facilities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (facility.type === 'capital' || facility.owner !== 'player' || facility.infected <= 0 || isContained(state, facility.position)) continue;
    const productionLoss = ['city', 'capital'].includes(facility.type) ? 0 : facility.workers;
    alerts.push(alert('critical', 'infection', 'critical_site_infection_uncontained', [facility.id], {
      facilityType: facility.type,
      infected: facility.infected,
      healthyPopulation: facility.workers,
      currentProductionLoss: productionLoss,
    }));
  }
  for (const checkpoint of [...state.checkpoints].sort((a, b) => a.id.localeCompare(b.id))) {
    if (deriveCheckpointRole(state, checkpoint) !== 'active' || checkpoint.infected <= 0 || isContained(state, checkpoint.position)) continue;
    alerts.push(alert('critical', 'infection', 'critical_site_infection_uncontained', [checkpoint.id], {
      facilityType: 'checkpoint',
      infected: checkpoint.infected,
      healthyPopulation: checkpoint.waiting + checkpoint.screening + checkpoint.approved,
      currentProductionLoss: 0,
    }));
  }

  for (const branch of [...state.roadBranches].sort((a, b) => a.branchId.localeCompare(b.branchId))) {
    const active = branch.activeCheckpointId
      ? state.checkpoints.find((checkpoint) => checkpoint.id === branch.activeCheckpointId)
      : null;
    const roleLossThisTurn = state.events.some((event) => event.turn === state.turn
      && event.type === 'checkpoint_fallback'
      && event.payload.branchId === branch.branchId);
    if ((active && (active.infected > 0 || active.status !== 'operational')) || roleLossThisTurn) {
      alerts.push(alert('critical', 'checkpoint', 'checkpoint_defense_degraded', [branch.branchId], {
        branchId: branch.branchId,
        activeCheckpointId: active?.id ?? null,
        standbyCount: branch.standbyCheckpointIds.length,
        fallbackDepth: branch.standbyCheckpointIds.length + (active ? 1 : 0),
        roleChangedThisTurn: roleLossThisTurn,
      }));
    }
  }

  for (const unit of state.units.filter(isHumanUnit).sort((a, b) => a.id.localeCompare(b.id))) {
    if (isHexSupplied(state, unit.position)) continue;
    const atRisk = unit.hp < unit.maxHp || unit.currentFuel < unit.maxFuel || unit.currentMilitaryGoods < unit.maxMilitaryGoods;
    if (!atRisk) continue;
    alerts.push(alert(unit.hp * 2 <= unit.maxHp || unit.currentFuel === 0 ? 'warning' : 'advisory', 'unit', 'unit_out_of_supply_risk', [unit.id], {
      hp: unit.hp, maxHp: unit.maxHp, fuel: unit.currentFuel, maxFuel: unit.maxFuel,
      militaryGoods: unit.currentMilitaryGoods, maxMilitaryGoods: unit.maxMilitaryGoods,
    }));
  }

  if (state.horde.warningType !== 'none') {
    alerts.push(alert(state.horde.turnsRemaining <= 1 ? 'warning' : 'advisory', 'horde', 'horde_warning_active', [], {
      spawnTurn: state.horde.nextSpawnTurn,
      turnsRemaining: state.horde.turnsRemaining,
      directionCount: state.horde.warningDirections.length,
      directions: [...state.horde.warningDirections],
      final: state.horde.warningType === 'final',
    }));
  }

  const forecast = forecastEndTurn(state);
  const health = forecast.publicHealth;
  if (capital && capital.workers <= 1) alerts.push(alert(capital.workers === 0 ? 'critical' : 'advisory', 'facility', 'capital_resident_minimum', [capital.id], { healthyPopulation: capital.workers, minimum: 1 }, ['TransferPopulation']));
  for (const resource of ['food', 'civilianGoods'] as const) {
    const deficit = resource === 'food' ? health.foodDeficit : health.civilianGoodsDeficit;
    if (deficit > 0 || health.stressBefore[resource] > 0 || (resource === 'food' && health.accumulationBefore > 0)) alerts.push(alert(deficit > 0 ? 'warning' : 'advisory', 'resource', resource === 'food' ? 'public_health_food_stress' : 'public_health_civilian_goods_stress', [], { deficit, stress: health.stressAfter[resource], stressBefore: health.stressBefore[resource], accumulation: health.accumulationAfter, recoveryPerSuppliedTurn: 0.5 }, ['AssignWorkers']));
  }
  if (health.starvationRate > 0) alerts.push(alert('critical', 'resource', 'food_starvation_risk', [], { rate: health.starvationRate, populationLost: health.starvation.loss, accumulation: health.accumulationAfter, carry: health.starvation.carryAfter }, ['AssignWorkers']));
  for (const risk of health.facilities.filter(f => f.probability > 0 && f.healthyPopulation > 0)) alerts.push(alert('warning', 'infection', 'internal_infection_risk', [risk.facilityId], { probability: risk.probability, expectedInfections: risk.expectedInfections, healthyPopulation: risk.healthyPopulation, causes: risk.causes, firstInfectionCanEmptySite: risk.firstInfectionCanEmptySite, spreadsFromTurn: state.turn + 1 }, ['TransferPopulation', 'AssignWorkers', 'SetPowerSupply']));
  for (const risk of health.checkpoints.filter(c => c.probability > 0 || (c.policy === 'passThrough' && c.screeningProbability > 0.25))) alerts.push(alert('warning', 'checkpoint', 'checkpoint_health_risk', [risk.checkpointId], { probability: risk.probability, waiting: risk.waiting, screeningProbability: risk.screeningProbability, spreadsFromTurn: state.turn + 1 }, ['SetCheckpointPolicy', 'TurnAwayCheckpointRefugees']));
  const allowance = forecast.refineryAllowance;
  const { netBurn, estimatedTurnsRemaining } = allowance;
  if (estimatedTurnsRemaining !== null && estimatedTurnsRemaining <= 3 && allowance.before > 0) alerts.push(alert(allowance.remaining === 0 ? 'critical' : 'warning', 'resource', 'refinery_allowance_runway_risk', [], { remainingAllowance: allowance.before, projectedFuelRefined: allowance.fuelRefined, oilCredits: allowance.oilCreditsEarned, netBurn, estimatedTurnsRemaining, refineryWorkers: state.facilities.filter(f => f.owner === 'player' && f.type === 'refinery').reduce((n,f) => n + f.workers,0), oilFieldWorkers: state.facilities.filter(f => f.owner === 'player' && f.type === 'oilField').reduce((n,f) => n + f.workers,0) }, ['AssignWorkers']));
  if (state.nuclearObjective.reward === 'unclaimed' && state.turn >= state.config.objectives.nuclearPowerPlant.rewardDeadlineTurn - 5) alerts.push(alert(state.turn >= state.config.objectives.nuclearPowerPlant.rewardDeadlineTurn ? 'critical' : 'warning', 'facility', 'nuclear_early_capture_window', ['nuclear-power-plant-1'], { deadlineTurn: state.config.objectives.nuclearPowerPlant.rewardDeadlineTurn, turnsRemaining: Math.max(0,state.config.objectives.nuclearPowerPlant.rewardDeadlineTurn-state.turn) }, ['Move']));
  if (state.airBaseObjective.firstCapturedTurn === null && state.turn >= state.config.objectives.airBase.rewardDeadlineTurn-5 && state.turn <= state.config.objectives.airBase.rewardDeadlineTurn) alerts.push(alert(state.turn === state.config.objectives.airBase.rewardDeadlineTurn?'critical':'warning','facility','air_base_early_capture_window',['air-base-1'],{deadlineTurn:state.config.objectives.airBase.rewardDeadlineTurn,turnsRemaining:Math.max(0,state.config.objectives.airBase.rewardDeadlineTurn-state.turn)},['Move']));
  const plant = state.facilities.find(f => f.type === 'nuclearPowerPlant');
  if (plant?.owner === 'player' && plant.workers > 0 && (!isHexSupplied(state, plant.position) || plant.infected > 0 || plant.operationalStatus !== 'operational') && forecast.electricity.shortage > 0) alerts.push(alert('warning', 'resource', 'nuclear_power_outage', [plant.id], { lostGeneration: plant.workers * state.config.facilities.nuclearPowerPlant.production.powerGeneration, shortage: forecast.electricity.shortage, reason: !isHexSupplied(state, plant.position) ? 'out_of_supply' : plant.operationalStatus }, ['Move']));
  const suppliedMilitaryShortages = forecast.militaryGoods.units.filter((unit) => unit.inSupply && unit.unfilledRefillDemand > 0);
  const unfilledSuppliedDemand = suppliedMilitaryShortages.reduce((sum, unit) => sum + unit.unfilledRefillDemand, 0);
  if (unfilledSuppliedDemand > 0) {
    alerts.push(alert('warning', 'resource', 'military_goods_national_shortage', suppliedMilitaryShortages.map((unit) => unit.unitId), {
      nationalStartingStock: forecast.militaryGoods.startingStock,
      nationalProduction: forecast.militaryGoods.projectedProduction,
      nationalEndingStock: forecast.militaryGoods.projectedEndingStock,
      suppliedDemand: suppliedMilitaryShortages.reduce((sum, unit) => sum + unit.refillDemand, 0),
      unfilledSuppliedDemand,
    }, ['AssignWorkers', 'SetPowerSupply']));
  }
  const disconnectedMilitaryDemand = forecast.militaryGoods.units.filter((unit) => !unit.inSupply && unit.refillDemand > 0);
  if (disconnectedMilitaryDemand.length > 0) {
    alerts.push(alert('warning', 'unit', 'military_goods_supply_disconnected', disconnectedMilitaryDemand.map((unit) => unit.unitId), {
      disconnectedDemand: disconnectedMilitaryDemand.reduce((sum, unit) => sum + unit.refillDemand, 0),
      disconnectedUnitCount: disconnectedMilitaryDemand.length,
      nationalStockExcluded: true,
    }, ['Move', 'BuildCheckpoint', 'RelocateCheckpoint', 'ActivateCheckpoint']));
  }
  for (const source of state.facilities.filter(f => ['powerPlant', 'windPowerPlant'].includes(f.type) && (f.status === 'ruined' || f.operationalStatus === 'disabled'))) {
    alerts.push(alert('warning', 'resource', 'production_outage', [source.id], { stoppedWorkers: source.workers, reason: 'power_source_lost', currentStatus: source.status, forecastOnly: false }));
  }
  for (const production of forecastFacilityProduction(state)) {
    const facility = state.facilities.find(f => f.id === production.facilityId)!;
    if (facility.owner === 'player' && facility.workers === 0 && production.stoppedReason === 'no_workers'
      && !['capital', 'city', 'temporaryHousing', 'windPowerPlant'].includes(facility.type)) {
      alerts.push(alert('advisory', 'facility', 'facility_workers_zero', [facility.id], {
        facilityType: facility.type,
        stoppedWorkers: facility.workerCapacity,
        reason: 'no_workers',
      }, ['AssignWorkers']));
    }
    if (facility.owner === 'player' && facility.workers > 0 && production.stoppedReason && !['capital', 'city', 'temporaryHousing'].includes(facility.type)) {
      alerts.push(alert('warning', 'resource', 'production_outage', [facility.id], { stoppedWorkers: facility.workers, reason: production.stoppedReason, powerReason: production.projectedPowerReason, forecastOnly: true }));
    }
    if (facility.owner === 'player' && facility.type === 'oilField' && facility.workers > 0 && production.allowanceCredits === 0) {
      alerts.push(alert('warning', 'facility', 'oil_field_allowance_blocked', [facility.id], {
        blockedWorkers: facility.workers, reason: production.stoppedReason ?? production.projectedPowerReason,
      }, ['Move', 'AssignWorkers']));
    }
  }
  const activeRefineries = state.facilities.filter((facility) => facility.owner === 'player' && facility.type === 'refinery' && facility.workers > 0);
  if (activeRefineries.length > 0 && forecast.refineryAllowance.availableForRefining <= 0) {
    alerts.push(alert('warning', 'resource', 'refinery_allowance_exhausted', activeRefineries.map((facility) => facility.id), {
      availableAllowance: forecast.refineryAllowance.availableForRefining,
      oilCreditsEarned: forecast.refineryAllowance.oilCreditsEarned,
      refineryCount: activeRefineries.length,
    }, ['AssignWorkers']));
  }
  const nextTurnPenalties = forecastNextTurnPenalties(state);
  if (nextTurnPenalties.overcrowding.active) {
    alerts.push(alert('warning', 'resource', 'overcrowding_forecast', nextTurnPenalties.overcrowding.facilities.map((entry) => entry.facilityId), {
      targetTurn: nextTurnPenalties.targetTurn,
      penaltyRatio: nextTurnPenalties.overcrowding.penaltyRatio,
      additionalFood: nextTurnPenalties.overcrowding.additionalFood,
      additionalCivilianGoods: nextTurnPenalties.overcrowding.additionalCivilianGoods,
      facilities: nextTurnPenalties.overcrowding.facilities,
    }));
  }
  if (nextTurnPenalties.housingOutage.active) {
    alerts.push(alert('warning', 'resource', 'temporary_housing_outage_forecast', nextTurnPenalties.housingOutage.facilities.map((entry) => entry.facilityId), {
      targetTurn: nextTurnPenalties.targetTurn,
      outageCount: nextTurnPenalties.housingOutage.outageCount,
      penaltyRatio: nextTurnPenalties.housingOutage.penaltyRatio,
      additionalFood: nextTurnPenalties.housingOutage.additionalFood,
      additionalCivilianGoods: nextTurnPenalties.housingOutage.additionalCivilianGoods,
      facilities: nextTurnPenalties.housingOutage.facilities,
    }));
  }
  const strategic = deriveStrategicForecast(state);
  const guaranteed = strategic.guaranteedDefeat.guaranteed;
  const populationIncreasedThisTurn = state.events.some((event) =>
    event.turn === state.turn
    && event.type === 'population_transferred'
    && event.payload.reason === 'unmanaged_pass_through'
    && typeof event.payload.people === 'number'
    && event.payload.people > 0);
  if (guaranteed) alerts.push(alert('critical', 'resource', 'guaranteed_resource_defeat', [], {
    foodShortage: forecast.food.shortage,
    civilianGoodsShortage: forecast.civilianGoods.maintenanceShortage,
    healthyCivilians: state.population.healthyCivilians,
  }));

  for (const resource of ['food', 'civilianGoods', 'militaryGoods', 'fuel'] as const) {
    if (guaranteed && strategic.guaranteedDefeat.causeResource === resource) continue;
    const runway = strategic.resources[resource].runway;
    const shortageTurn = runway.current.estimatedShortageTurn;
    const severity = runway.current.nextEndTurnShortage || shortageTurn === 1
      ? 'critical' as const
      : shortageTurn != null && shortageTurn <= 3
        ? 'warning' as const
        : null;
    if (!severity) continue;
    const causeCodes: string[] = [];
    if (runway.current.nextEndTurnShortage) causeCodes.push('next_end_turn_shortage');
    if ((runway.current.netBurn ?? 0) > 0) causeCodes.push('demand_exceeds_current_production');
    if (runway.projectedCurrentProduction === 0 && runway.currentDemandBasis > 0) causeCodes.push('no_projected_production');
    if (resource === 'food' || resource === 'civilianGoods') {
      const maintenance = forecast.maintenanceBreakdown[resource];
      if (populationIncreasedThisTurn) causeCodes.push('population_increase');
      if (maintenance.overcrowding > 0) causeCodes.push('overcrowding');
      if (maintenance.housingOutage > 0) causeCodes.push('temporary_housing_outage');
    }
    if (resource === 'civilianGoods' && forecast.civilianGoods.productionInputShortage > 0) {
      causeCodes.push('production_input_shortage');
    }
    if (resource === 'militaryGoods' && runway.current.unavailableReason === 'input_dependency_unstable') {
      causeCodes.push('production_input_shortage');
    }
    if (resource === 'fuel') {
      if (forecast.fuel.powerFuelShortage > 0) causeCodes.push('power_generation_demand');
      if (forecast.fuel.unitRefillFuelShortage > 0) causeCodes.push('unit_refill_demand');
    }
    alerts.push(alert(severity, 'resource', 'resource_runway_risk', [resource], {
      resource,
      estimatedShortageTurn: shortageTurn,
      nextEndTurnShortage: runway.current.nextEndTurnShortage,
      netBurn: runway.current.netBurn,
      unavailableReason: runway.current.unavailableReason,
      causeCodes,
      assumption: runway.assumption,
      currentStock: runway.currentStock,
      projectedProduction: runway.projectedCurrentProduction,
      demand: runway.currentDemandBasis,
      demandBreakdown: runway.demandBreakdown,
    }));
  }

  for (const event of currentTurnLossEvents(state)) {
    const entityId = String(event.payload.facilityId ?? event.payload.checkpointId ?? event.payload.unitId ?? event.id);
    alerts.push(alert('advisory', 'loss', 'new_state_loss', [entityId], { eventType: event.type, eventId: event.id }));
  }

  const sourceRevision = state.events.length + state.actionsTakenThisTurn;
  return alerts.map((entry) => ({ ...entry, sourceRevision })).sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || left.category.localeCompare(right.category)
    || left.entityIds.join(',').localeCompare(right.entityIds.join(','))
    || left.id.localeCompare(right.id));
}

function riskUnit(state: Readonly<GameState>, unit: GameState['units'][number]): EndTurnRiskUnit {
  const attacks = getUnitLegalAttackProjections(state, unit.id);
  const suppression = forecastUnitSuppression(state, unit);
  return {
    unitId: unit.id,
    moveRemaining: unit.canMove && unit.actionState !== 'acted',
    attackChargesRemaining: unit.attackChargesRemaining,
    legalAttackTargetIds: attacks.map((entry) => entry.targetUnitId),
    suppressionTargetId: suppression?.targetId ?? null,
  };
}

/** Pure EndTurn warning projection. It never changes EndTurn legality. */
export function deriveEndTurnRisk(state: Readonly<GameState>): EndTurnRisk {
  const units = state.units.filter(isHumanUnit).sort((a, b) => a.id.localeCompare(b.id)).map((unit) => riskUnit(state, unit));
  const crisis = deriveCrisisSummary(state);
  const infectedFacilities = state.facilities
    .filter((facility) => facility.owner === 'player' && facility.infected > 0 && !isContained(state, facility.position))
    .map((facility) => ({ id: facility.id, kind: 'facility' as const, infected: facility.infected }));
  const infectedCheckpoints = state.checkpoints
    .filter((checkpoint) => checkpoint.infected > 0 && !isContained(state, checkpoint.position))
    .map((checkpoint) => ({ id: checkpoint.id, kind: 'checkpoint' as const, infected: checkpoint.infected }));
  return {
    readyUnits: units.filter((unit) => unit.moveRemaining || unit.attackChargesRemaining > 0),
    unitsWithMoveRemaining: units.filter((unit) => unit.moveRemaining),
    unitsWithAttackChargesRemaining: units.filter((unit) => unit.attackChargesRemaining > 0),
    uncontainedInfectedSites: [...infectedFacilities, ...infectedCheckpoints].sort((a, b) => a.id.localeCompare(b.id)),
    criticalAlerts: crisis.filter((entry) => entry.severity === 'critical'),
    forecastGuaranteedDefeat: crisis.some((entry) => entry.reasonCode === 'guaranteed_resource_defeat'),
  };
}
