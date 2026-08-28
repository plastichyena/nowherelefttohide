import { hexKey } from '../core/hex';
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

function ceilRationalProduct(value: number, numerator: bigint, denominator: bigint): number {
  if (!Number.isFinite(value) || value <= 0 || numerator <= 0n || denominator <= 0n) return 0;
  const wholeValue = BigInt(Math.max(0, Math.trunc(value)));
  const amount = (wholeValue * numerator + denominator - 1n) / denominator;
  return Math.max(1, Number(amount));
}

function gcdBigInt(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * Project the visible consequences of a city transfer without changing the
 * GameState. The returned forecast retains the engine forecast for all
 * non-overcrowding fields and replaces only the values affected by the two
 * city populations.
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
  const terms = state.facilities
    .filter((facility) => facility.owner === 'player' && facility.status === 'owned' && (facility.type === 'capital' || facility.type === 'city'))
    .map((facility) => {
      const workers = facility.id === from.id ? fromAfter : facility.id === to.id ? toAfter : facility.workers;
      const softCap = state.config.facilities[facility.type].workerCapacity;
      return { excess: Math.max(0, workers - softCap), softCap };
    })
    .filter((term) => term.excess > 0);
  // Configured city capacities are integers. A small rational accumulator
  // keeps the common 50/100 caps exact while avoiding visible FP drift.
  let numerator = 0n;
  let denominator = 1n;
  for (const term of terms) {
    numerator = numerator * BigInt(term.softCap) + BigInt(term.excess) * denominator;
    denominator *= BigInt(term.softCap);
    const divisor = gcdBigInt(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  const rate = denominator > 0n ? Number(numerator) / Number(denominator) : 0;
  const additionalFood = ceilRationalProduct(forecast.food.maintenanceRequired - forecast.overcrowding.additionalFood, numerator, denominator);
  const additionalCivilianGoods = ceilRationalProduct(
    forecast.civilianGoods.maintenanceRequired - forecast.overcrowding.additionalCivilianGoods,
    numerator,
    denominator,
  );
  return {
    fromPopulation: from.workers,
    toPopulation: to.workers,
    fromAfter,
    toAfter,
    people: safePeople,
    overcrowdingRate: rate,
    additionalFood,
    additionalCivilianGoods,
    forecast: {
      ...forecast,
      overcrowding: {
        ...forecast.overcrowding,
        additionalFood,
        additionalCivilianGoods,
      },
    },
  };
}

export function actionForCheckpointPolicy(
  actions: readonly GameAction[],
  checkpointId: string,
  policy: Extract<GameAction, { type: 'SetCheckpointPolicy' }>['policy'],
): Extract<GameAction, { type: 'SetCheckpointPolicy' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'SetCheckpointPolicy' }> =>
      action.type === 'SetCheckpointPolicy' && action.checkpointId === checkpointId && action.policy === policy,
  );
}

export function unitTileKey(unit: UnitState): string {
  return hexKey(unit.position);
}
