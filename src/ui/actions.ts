import { hexKey } from '../core/hex';
import { forecastEndTurn } from '../core/engine';
import type {
  EndTurnForecast,
  FacilityId,
  FacilityState,
  GameAction,
  GameState,
  HexCoord,
  HumanUnitType,
  UnitState,
} from '../core/types';

export function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function findUnitAt(state: Readonly<GameState>, position: HexCoord): UnitState | undefined {
  return state.units.find((unit) => unit.actionState !== 'destroyed' && sameHex(unit.position, position));
}

export function findUnit(state: Readonly<GameState>, unitId: string): UnitState | undefined {
  return state.units.find((unit) => unit.id === unitId && unit.actionState !== 'destroyed');
}

export function findFacilityAt(state: Readonly<GameState>, position: HexCoord) {
  return state.facilities.find((facility) => sameHex(facility.position, position));
}

export function findCheckpointAt(state: Readonly<GameState>, position: HexCoord) {
  return (state.checkpoints ?? []).find((checkpoint) => sameHex(checkpoint.position, position));
}

export function legalActionsForUnit(state: Readonly<GameState>, actions: readonly GameAction[], unitId: string): GameAction[] {
  return actions.filter((action) =>
    (action.type === 'Move' && action.unitId === unitId) ||
    (action.type === 'Attack' && action.attackerId === unitId) ||
    (action.type === 'Wait' && action.unitId === unitId),
  );
}

export function legalMoveDestinations(actions: readonly GameAction[], unitId: string): HexCoord[] {
  return actions
    .filter((action): action is Extract<GameAction, { type: 'Move' }> => action.type === 'Move' && action.unitId === unitId)
    .map((action) => action.destination);
}

export function legalAttackTargets(actions: readonly GameAction[], unitId: string): string[] {
  return actions
    .filter((action): action is Extract<GameAction, { type: 'Attack' }> => action.type === 'Attack' && action.attackerId === unitId)
    .map((action) => action.targetId);
}

export function isLegalAction(actions: readonly GameAction[], action: GameAction): boolean {
  const wanted = JSON.stringify(action);
  return actions.some((candidate) => JSON.stringify(candidate) === wanted);
}

export function actionForWorkerAssignment(
  actions: readonly GameAction[],
  facilityId: string,
  workers: number,
): Extract<GameAction, { type: 'AssignWorkers' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'AssignWorkers' }> =>
      action.type === 'AssignWorkers' && action.facilityId === facilityId && action.workers === workers,
  );
}

/** Find an industrial Power Supply toggle in the engine's legal action list. */
export function actionForPowerSupply(
  actions: readonly GameAction[],
  facilityId: FacilityId,
  enabled: boolean,
): Extract<GameAction, { type: 'SetPowerSupply' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'SetPowerSupply' }> =>
      action.type === 'SetPowerSupply' && action.facilityId === facilityId && action.enabled === enabled,
  );
}

/** Find an atomic city-to-city transfer in the engine's legal action list. */
export function actionForPopulationTransfer(
  actions: readonly GameAction[],
  fromFacilityId: FacilityId,
  toFacilityId: FacilityId,
  people: number,
): Extract<GameAction, { type: 'TransferPopulation' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'TransferPopulation' }> =>
      action.type === 'TransferPopulation' &&
      action.fromFacilityId === fromFacilityId &&
      action.toFacilityId === toFacilityId &&
      action.people === people,
  );
}

/** Alias kept explicit for callers that use the action's verb in the name. */
export const actionForTransferPopulation = actionForPopulationTransfer;

export function actionForUnitProduction(
  actions: readonly GameAction[],
  unitType: HumanUnitType,
  destination?: HexCoord,
): Extract<GameAction, { type: 'ProduceUnit' }> | undefined {
  return actions.find((action): action is Extract<GameAction, { type: 'ProduceUnit' }> => {
    if (action.type !== 'ProduceUnit' || action.unitType !== unitType) return false;
    if (!destination || !action.destination) return true;
    return sameHex(action.destination, destination);
  });
}

/**
 * Normalize a worker control value at the UI boundary. The core still owns
 * legality; this helper only keeps HTML controls integer-valued and bounded.
 */
export function clampInteger(value: string | number | null | undefined, minimum: number, maximum: number, fallback = minimum): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const safeFallback = Number.isFinite(fallback) ? Math.trunc(fallback) : minimum;
  const safeMinimum = Math.ceil(Math.min(minimum, maximum));
  const safeMaximum = Math.floor(Math.max(minimum, maximum));
  if (!Number.isFinite(parsed)) return Math.max(safeMinimum, Math.min(safeMaximum, safeFallback));
  return Math.max(safeMinimum, Math.min(safeMaximum, Math.trunc(parsed)));
}

export const clampWorkerCount = clampInteger;

export interface WorkerAssignmentBounds {
  minimum: number;
  maximum: number;
  current: number;
}

/** Maximum legal staffing target, including currently assigned workers. */
export function workerAssignmentBounds(
  state: Readonly<GameState>,
  facility: Pick<FacilityState, 'id' | 'workerCapacity' | 'workers'>,
): WorkerAssignmentBounds {
  const snapshot = state.cityPopulationSnapshot;
  const eligibleSupply = snapshot && snapshot.turn === state.turn
    ? snapshot.supply
      .filter((entry) => entry.eligible)
      .map((entry) => state.facilities.find((candidate) => candidate.id === entry.facilityId))
      .filter((candidate): candidate is FacilityState => candidate !== undefined)
      .reduce((sum, city) => sum + Math.max(0, city.workers), 0)
    : 0;
  return {
    minimum: 0,
    maximum: Math.max(0, Math.min(facility.workerCapacity, facility.workers + eligibleSupply)),
    current: Math.max(0, Math.min(facility.workerCapacity, facility.workers)),
  };
}

export interface PopulationLocationTotals {
  cityResidents: number;
  productionWorkers: number;
  healthyCivilians: number;
  unitPopulation: number;
  waitingRefugees: number;
  screeningRefugees: number;
  approvedRefugees: number;
  facilityInfected: number;
  checkpointInfected: number;
  infected: number;
  total: number;
}

/** Read-only population projection used by the HUD and population overview. */
export function populationLocationTotals(state: Readonly<GameState>): PopulationLocationTotals {
  const population = state.population;
  const cityResidents = Math.max(0, population.cityResidents ?? 0);
  const productionWorkers = Math.max(0, population.productionWorkers ?? 0);
  const healthyCivilians = Math.max(0, population.healthyCivilians ?? cityResidents + productionWorkers);
  const unitPopulation = Math.max(0, population.unitPopulation ?? ((population.police ?? 0) + (population.nationalGuard ?? 0)));
  const waitingRefugees = Math.max(0, population.waitingRefugees ?? 0);
  const screeningRefugees = Math.max(0, population.screeningRefugees ?? 0);
  const approvedRefugees = Math.max(0, population.approvedRefugees ?? 0);
  const facilityInfected = Math.max(0, population.facilityInfected ?? 0);
  const checkpointInfected = Math.max(0, population.checkpointInfected ?? 0);
  const infected = facilityInfected + checkpointInfected;
  return {
    cityResidents,
    productionWorkers,
    healthyCivilians,
    unitPopulation,
    waitingRefugees,
    screeningRefugees,
    approvedRefugees,
    facilityInfected,
    checkpointInfected,
    infected,
    total: healthyCivilians + unitPopulation + waitingRefugees + screeningRefugees + approvedRefugees + infected,
  };
}

export interface CityTransferProjection {
  fromPopulation: number;
  toPopulation: number;
  fromAfter: number;
  toAfter: number;
  people: number;
  overcrowdingRate: number;
  additionalFood: number;
  additionalCivilianGoods: number;
  forecast: EndTurnForecast;
}

/**
 * Project the visible consequences of a city transfer without changing the
 * GameState. Forecasting must go through the same pure Core calculation as
 * EndTurn so city power demand, same-turn production, maintenance reservation,
 * and production-input allocation all reflect the hypothetical populations.
 */
export function projectCityTransfer(
  state: Readonly<GameState>,
  fromFacilityId: FacilityId,
  toFacilityId: FacilityId,
  people: number,
  forecast: EndTurnForecast,
): CityTransferProjection | null {
  const from = state.facilities.find((facility) => facility.id === fromFacilityId);
  const to = state.facilities.find((facility) => facility.id === toFacilityId);
  if (!from || !to || from.id === to.id) return null;
  const requestedPeople = Number.isFinite(people) ? Math.trunc(people) : 0;
  const safePeople = Math.max(0, Math.min(requestedPeople, Math.max(0, from.workers)));
  const fromAfter = from.workers - safePeople;
  const toAfter = to.workers + safePeople;
  const projectedState: GameState = {
    ...(state as GameState),
    facilities: state.facilities.map((facility) => ({
      ...facility,
      position: { ...facility.position },
      workers: facility.id === from.id
        ? fromAfter
        : facility.id === to.id
          ? toAfter
          : facility.workers,
    })),
    population: {
      ...state.population,
      facilityWorkers: state.population.facilityWorkers.map((entry) => ({ ...entry })),
    },
    cityPopulationSnapshot: {
      turn: state.cityPopulationSnapshot.turn,
      supply: state.cityPopulationSnapshot.supply.map((entry) => ({ ...entry })),
      reception: state.cityPopulationSnapshot.reception.map((entry) => ({ ...entry })),
    },
    resources: { ...state.resources },
  };
  const projectedForecast = forecastEndTurn(projectedState);
  const additionalFood = projectedForecast.overcrowding.additionalFood;
  const additionalCivilianGoods = projectedForecast.overcrowding.additionalCivilianGoods;
  return {
    fromPopulation: from.workers,
    toPopulation: to.workers,
    fromAfter,
    toAfter,
    people: safePeople,
    overcrowdingRate: projectedForecast.overcrowding.cities.reduce(
      (total, city) => total + city.excess / Math.max(1, city.softCap),
      0,
    ),
    additionalFood,
    additionalCivilianGoods,
    forecast: projectedForecast,
  };
}

export function actionForCheckpointPolicy(
  actions: readonly GameAction[],
  branchId: string,
  policy: Extract<GameAction, { type: 'SetCheckpointPolicy' }>['policy'],
): Extract<GameAction, { type: 'SetCheckpointPolicy' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'SetCheckpointPolicy' }> =>
      action.type === 'SetCheckpointPolicy' &&
      // v1.3.3 moves policy ownership to RoadBranchState. Policy actions are
      // therefore always selected by their branch id, never by a checkpoint.
      action.branchId === branchId &&
      action.policy === policy,
  );
}

/** Find the Core-provided activation action for one branch post. */
export function actionForCheckpointActivation(
  actions: readonly GameAction[],
  branchId: string,
  checkpointId: string,
): Extract<GameAction, { type: 'ActivateCheckpoint' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'ActivateCheckpoint' }> =>
      action.type === 'ActivateCheckpoint' && action.branchId === branchId && action.checkpointId === checkpointId,
  );
}

export function unitTileKey(unit: UnitState): string {
  return hexKey(unit.position);
}
