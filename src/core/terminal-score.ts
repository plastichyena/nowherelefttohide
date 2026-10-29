import { INITIAL_HUMAN_DEPLOYMENT } from './initial-deployment';
import { canonicalMapValue, mapContentHash } from './map-generation';
import { isHumanUnitType } from './unit-catalog';
import { GAME_RULES_VERSION } from './versions';
import type { GameState, HumanUnitType } from './types';

export const TERMINAL_SCORE_VERSION = 'terminal-assets-v1' as const;
export interface ScoreCoefficients { wH: number; wF: number; bMax: number }
/** Tuning defaults, fixed into each game's Config and score context. */
export const DEFAULT_SCORE_COEFFICIENTS: Readonly<ScoreCoefficients> = Object.freeze({ wH: 100, wF: 300, bMax: 50 });
export type ScoreOrigin = 'new' | 'v1.7.1-ongoing' | 'v1.7.1-finished';
export interface ScoreComparison {
  rulesVersion: string;
  configHash: string;
  scenario: string;
  mapMode: string;
  mapHash: string;
  generatorVersion: string;
  rootSeed: number;
  mapSeed: number;
  gameplaySeed: number;
  fallback: string | null;
  initialDeployment: 'seven-human-units-v1';
  initialBasisHash: string;
  origin: ScoreOrigin;
}
export interface ScoreContext {
  version: typeof TERMINAL_SCORE_VERSION;
  coefficients: ScoreCoefficients;
  comparison: ScoreComparison;
  initialFacilityIds: string[];
  initialUnits: Array<{ id: string; type: HumanUnitType; population: number }>;
  initialPersonnelTotal: string;
  populationLimit: string;
  status: 'supported' | 'unsupported';
  reason: null | 'population_arithmetic_unsafe';
}
export interface ScorePopulation {
  facilities: string;
  units: string;
  formations: string;
  waiting: string;
  screening: string;
  approved: string;
}
export interface ScorePoints {
  population: string;
  facilities: string;
  initialPersonnel: string;
  assets: string;
  defeatPenalty: string;
  outcomeAdjustment: string;
  total: string;
}
export interface ScoredTerminal {
  status: 'scored';
  version: typeof TERMINAL_SCORE_VERSION;
  coefficients: ScoreCoefficients;
  comparison: ScoreComparison;
  healthyPopulation: string;
  populationByLocation: ScorePopulation;
  healthyInitialFacilities: number;
  initialFacilityCount: number;
  survivingUnits: number;
  initialPersonnel: string;
  initialPersonnelTotal: string;
  populationLimit: string;
  points: ScorePoints;
  /** Current owned cities, including infected residents. Never an input to points. */
  crowding: { population: string; capacity: string; excess: string };
}
export type TerminalScore = ScoredTerminal | {
  status: 'unscored';
  version: typeof TERMINAL_SCORE_VERSION;
  reason: 'legacy_v1.7.1' | 'population_arithmetic_unsafe';
  comparison: ScoreComparison;
};

function integer(value: number, label: string, minimum = 0): bigint {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`score: ${label} must be a safe integer >= ${minimum}`);
  return BigInt(value);
}
function decimal(value: string, label: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`score: invalid ${label}`);
  return BigInt(value);
}
function unique(ids: string[], label: string): void {
  if (ids.some(id => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== ids.length) throw new Error(`score: duplicate or invalid ${label}`);
}
export function validateScoreCoefficients(value: ScoreCoefficients): string[] {
  try {
    integer(value?.wH, 'wH', 1); integer(value?.wF, 'wF', 1); integer(value?.bMax, 'bMax');
    if (value.bMax >= Math.min(value.wH, value.wF)) throw new Error('score: bMax must be less than both wH and wF');
    return [];
  } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}

type StartBasis = Pick<GameState, 'config' | 'map' | 'mapDescriptor' | 'seed'>;
/** No RNG, population draws, enemy positions or current survivors are consulted. */
export function createScoreContext(state: StartBasis, origin: ScoreOrigin = 'new'): ScoreContext {
  const { config, map, mapDescriptor: d } = state;
  const coefficientErrors = validateScoreCoefficients(config.terminalScore);
  if (coefficientErrors.length) throw new Error(coefficientErrors.join('; '));
  const initialFacilityIds = map.facilities.map(f => f.id).sort();
  unique(initialFacilityIds, 'initial facility IDs');
  const initialUnits = INITIAL_HUMAN_DEPLOYMENT.map(({ id, type }) => ({ id, type, population: config.units[type].population }));
  const i0 = initialUnits.reduce((n, u) => n + integer(u.population, `initial ${u.id}`), 0n);
  // A conservative, public capacity bound includes every initial site, not its hidden occupants.
  const maxCapacity = map.facilities.reduce((n, f) => {
    const capacity = integer(config.facilities[f.type].workerCapacity, `capacity ${f.type}`);
    return capacity > n ? capacity : n;
  }, 0n);
  const finalTurn = integer(config.horde.waves.at(-1)!.turn, 'Final turn', 1);
  const interval = integer(config.refugees.arrivalIntervalMin, 'arrival interval', 1);
  const arrivalMax = integer(config.refugees.arrivalPeopleMax, 'arrival maximum')
    + (finalTurn - 1n) / integer(config.refugees.arrivalGrowthInterval, 'growth interval', 1)
      * integer(config.refugees.arrivalGrowthPeople, 'arrival growth');
  const arrivals = BigInt(map.roadBranches.length) * ((finalTurn + interval - 1n) / interval) * arrivalMax;
  const reinforcements = map.facilities.reduce((n, f) => n + (f.type === 'armyBase'
    ? integer(config.units.nationalGuard.population, 'Army reward')
    : f.type === 'nuclearPowerPlant' || f.type === 'airBase'
      ? integer(config.units.specialForces.population, 'objective reward') : 0n), 0n);
  const populationLimit = BigInt(initialFacilityIds.length) * maxCapacity + i0 + arrivals + reinforcements;
  // The existing game population ledger uses Number. Do not pretend it can preserve unsafe totals.
  const supported = populationLimit <= BigInt(Number.MAX_SAFE_INTEGER)
    && finalTurn + integer(config.refugees.arrivalIntervalMax, 'arrival interval maximum', 1) <= BigInt(Number.MAX_SAFE_INTEGER);
  const comparison: ScoreComparison = {
    rulesVersion: GAME_RULES_VERSION, configHash: mapContentHash(config),
    scenario: config.scenarioId, mapMode: config.mapMode, mapHash: d.mapHash,
    generatorVersion: d.generatorVersion, rootSeed: state.seed, mapSeed: d.mapSeed, gameplaySeed: d.gameplaySeed,
    fallback: d.fallback ? `${d.fallback.id}/${d.fallback.version}` : null,
    initialDeployment: 'seven-human-units-v1',
    initialBasisHash: mapContentHash({ initialFacilityIds, initialUnits }), origin,
  };
  return {
    version: TERMINAL_SCORE_VERSION, coefficients: { ...config.terminalScore }, comparison,
    initialFacilityIds, initialUnits, initialPersonnelTotal: i0.toString(), populationLimit: populationLimit.toString(),
    status: supported ? 'supported' : 'unsupported', reason: supported ? null : 'population_arithmetic_unsafe',
  };
}

/** Arbitrary precision arithmetic; all serialized values remain ordinary JSON strings. */
export function calculateScorePoints(input: {
  healthyPopulation: string; healthyInitialFacilities: number; initialPersonnel: string;
  initialPersonnelTotal: string; populationLimit: string; initialFacilityCount: number;
}, coefficients: ScoreCoefficients, outcome: 'won' | 'lost'): ScorePoints {
  const errors = validateScoreCoefficients(coefficients);
  if (errors.length) throw new Error(errors.join('; '));
  if (outcome !== 'won' && outcome !== 'lost') throw new Error('score: invalid outcome');
  const h = decimal(input.healthyPopulation, 'H'), hmax = decimal(input.populationLimit, 'Hmax');
  const f = integer(input.healthyInitialFacilities, 'F'), fmax = integer(input.initialFacilityCount, 'Fmax');
  const i = decimal(input.initialPersonnel, 'I'), i0 = decimal(input.initialPersonnelTotal, 'I0');
  if (h > hmax || f > fmax || i > i0 || i > h) throw new Error('score: input exceeds fixed bounds');
  const population = BigInt(coefficients.wH) * h, facilities = BigInt(coefficients.wF) * f;
  const initialPersonnel = i0 === 0n ? 0n : BigInt(coefficients.bMax) * i / i0;
  const assets = population + facilities + initialPersonnel;
  const penalty = BigInt(coefficients.wH) * hmax + BigInt(coefficients.wF) * fmax + BigInt(coefficients.bMax) + 1n;
  const adjustment = outcome === 'won' ? 1n : -penalty;
  return { population: population.toString(), facilities: facilities.toString(), initialPersonnel: initialPersonnel.toString(),
    assets: assets.toString(), defeatPenalty: penalty.toString(), outcomeAdjustment: adjustment.toString(), total: (assets + adjustment).toString() };
}

/** Pure projection of the final committed candidate. Aggregates and transport cargo references are not added. */
export function calculateTerminalScore(state: GameState, outcome: 'won' | 'lost'): TerminalScore {
  const c = state.scoreContext;
  validateScoreContext(state);
  if (c.comparison.origin === 'v1.7.1-finished') return { status: 'unscored', version: c.version, reason: 'legacy_v1.7.1', comparison: { ...c.comparison } };
  if (c.status === 'unsupported') return { status: 'unscored', version: c.version, reason: c.reason!, comparison: { ...c.comparison } };
  unique(state.units.map(u => u.id), 'unit IDs');
  unique(state.facilities.map(f => f.id), 'facility IDs');
  unique(state.pendingUnitProductions.map(o => o.id), 'formation IDs');
  unique(state.checkpoints.map(cp => cp.id), 'checkpoint IDs');
  const sum = (values: number[], label: string) => values.reduce((n, v) => n + integer(v, label), 0n);
  const owned = state.facilities.filter(f => f.owner === 'player');
  const humans = state.units.filter(u => u.isPlayerUnit && isHumanUnitType(u.type) && u.hp > 0 && u.actionState !== 'destroyed');
  const populationByLocation: ScorePopulation = {
    facilities: sum(owned.map(f => f.workers), 'facility workers').toString(),
    units: sum(humans.map(u => u.population), 'unit population').toString(),
    formations: sum(state.pendingUnitProductions.map(o => o.population), 'formation population').toString(),
    waiting: sum(state.checkpoints.map(cp => cp.waiting), 'checkpoint waiting').toString(),
    screening: sum(state.checkpoints.map(cp => cp.screening), 'checkpoint screening').toString(),
    approved: sum(state.checkpoints.map(cp => cp.approved), 'checkpoint approved').toString(),
  };
  const healthyPopulation = Object.values(populationByLocation).reduce((n, v) => n + BigInt(v), 0n).toString();
  let healthyInitialFacilities = 0;
  for (const id of c.initialFacilityIds) {
    const f = state.facilities.find(f => f.id === id);
    if (!f) throw new Error(`score: missing initial facility ${id}`);
    integer(f.infected, 'facility infected');
    if (f.owner === 'player' && f.status === 'owned' && f.infected === 0
      && !['building', 'disabled', 'ruined', 'infected'].includes(f.operationalStatus)) healthyInitialFacilities++;
  }
  const initialPersonnel = c.initialUnits.reduce((n, initial) => {
    const unit = humans.find(u => u.id === initial.id);
    if (!unit) return n;
    if (unit.type !== initial.type) throw new Error(`score: initial unit identity changed: ${unit.id}`);
    return n + integer(Math.min(unit.population, initial.population), 'retained initial personnel');
  }, 0n).toString();
  const cities = owned.filter(f => f.type === 'capital' || f.type === 'city');
  let cityPopulation = 0n, capacity = 0n, excess = 0n;
  for (const city of cities) {
    const n = integer(city.workers, 'city workers') + integer(city.infected, 'city infected');
    const cap = integer(city.workerCapacity, 'city capacity');
    cityPopulation += n; capacity += cap; if (n > cap) excess += n - cap;
  }
  const inputs = { healthyPopulation, healthyInitialFacilities, initialPersonnel,
    initialPersonnelTotal: c.initialPersonnelTotal, populationLimit: c.populationLimit, initialFacilityCount: c.initialFacilityIds.length };
  return { status: 'scored', version: c.version, coefficients: { ...c.coefficients }, comparison: { ...c.comparison },
    ...inputs, populationByLocation, survivingUnits: humans.length, points: calculateScorePoints(inputs, c.coefficients, outcome),
    crowding: { population: cityPopulation.toString(), capacity: capacity.toString(), excess: excess.toString() } };
}

export function validateScoreContext(state: GameState): void {
  const origin = state.scoreContext?.comparison?.origin;
  if (!['new', 'v1.7.1-ongoing', 'v1.7.1-finished'].includes(origin)) throw new Error('score: missing or invalid start context');
  const expected = createScoreContext(state, origin);
  if (canonicalMapValue(expected) !== canonicalMapValue(state.scoreContext)) throw new Error('score: start context does not match Map / Config / deployment');
  if (origin === 'v1.7.1-finished' && !state.gameOver) throw new Error('score: legacy finished context requires an ended game');
  const initialSuffix = Math.max(...INITIAL_HUMAN_DEPLOYMENT.map(u => Number(u.id.split('-').at(-1))));
  if (!Number.isSafeInteger(state.nextUnitNumber) || state.nextUnitNumber <= initialSuffix) throw new Error('score: lifetime unit ID counter overlaps initial deployment');
}

export function validateTerminalScoring(state: GameState): string[] {
  try {
    validateScoreContext(state);
    if (state.result) {
      if (!state.gameOver || state.result.turn !== state.turn) throw new Error('score: inconsistent terminal boundary');
      const expected = calculateTerminalScore(state, state.result.outcome);
      if (canonicalMapValue(expected) !== canonicalMapValue(state.result.terminalScore)) throw new Error('score: missing or inconsistent terminal snapshot');
    } else if (state.gameOver) throw new Error('score: missing terminal result');
    return [];
  } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
