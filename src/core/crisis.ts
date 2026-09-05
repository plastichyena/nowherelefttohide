import { forecastEndTurn } from './economy-query';
import { forecastUnitSuppression, getUnitLegalAttackProjections } from './combat-query';
import { deriveStrategicForecast } from './forecast';
import { deriveCheckpointRole, isHexSupplied } from './supply';
import { isHumanUnit } from './state';
import type { CrisisAlert, CrisisSeverity, EndTurnRisk, EndTurnRiskUnit, GameState, JsonObject } from './types';

const severityOrder: Record<CrisisSeverity, number> = { critical: 0, warning: 1, advisory: 2 };

/** Public fact comparisons, exhaustive for the current crisis contract. */
export const CRISIS_WORSENING_FACTS = {
  capital_infection_uncontained: { infected: 'up', healthyPopulation: 'down', suppressionUnitAvailable: 'false' },
  critical_site_infection_uncontained: { infected: 'up', healthyPopulation: 'down', currentProductionLoss: 'up' },
  checkpoint_defense_degraded: { standbyCount: 'down', fallbackDepth: 'down', roleChangedThisTurn: 'true', activeCheckpointId: 'lost' },
  unit_out_of_supply_risk: { hp: 'down', fuel: 'down', militaryGoods: 'down' },
  horde_warning_active: { turnsRemaining: 'down', directionCount: 'up', final: 'true' },
  guaranteed_resource_defeat: { foodShortage: 'up', civilianGoodsShortage: 'up', healthyCivilians: 'down' },
  new_state_loss: { eventId: 'changed' },
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
): CrisisAlert {
  return {
    id: `${reasonCode}:${[...entityIds].sort().join(',') || 'state'}`,
    severity,
    category,
    reasonCode,
    entityIds: [...entityIds].sort(),
    publicFacts,
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
  const strategic = deriveStrategicForecast(state);
  const guaranteed = strategic.guaranteedDefeat.guaranteed;
  if (guaranteed) alerts.push(alert('critical', 'resource', 'guaranteed_resource_defeat', [], {
    foodShortage: forecast.food.shortage,
    civilianGoodsShortage: forecast.civilianGoods.maintenanceShortage,
    healthyCivilians: state.population.healthyCivilians,
  }));

  for (const event of currentTurnLossEvents(state)) {
    const entityId = String(event.payload.facilityId ?? event.payload.checkpointId ?? event.payload.unitId ?? event.id);
    alerts.push(alert('advisory', 'loss', 'new_state_loss', [entityId], { eventType: event.type, eventId: event.id }));
  }

  return alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
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
