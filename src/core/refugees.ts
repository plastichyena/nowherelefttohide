import type { RefugeeConfig } from './types';

/** Use the resolving EndTurn, never the turn when the schedule was drawn. */
export function refugeeArrivalRange(config: RefugeeConfig, turn: number) {
  return {
    min: config.arrivalPeopleMin,
    max: config.arrivalPeopleMax + Math.floor(Math.max(0, turn - 1) / config.arrivalGrowthInterval) * config.arrivalGrowthPeople,
  };
}

export function refugeeArrivalProjection(config: RefugeeConfig, turn: number, nextArrivalTurn: number | null) {
  return {
    current: refugeeArrivalRange(config, turn),
    next: nextArrivalTurn === null ? null : { turn: nextArrivalTurn, ...refugeeArrivalRange(config, nextArrivalTurn) },
    growth: { initialUpper: config.arrivalPeopleMax, intervalTurns: config.arrivalGrowthInterval, peoplePerInterval: config.arrivalGrowthPeople, firstTurn: 1 },
  };
}
