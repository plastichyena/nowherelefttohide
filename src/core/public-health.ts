import { SeededRng } from './rng';
import type { CheckpointPolicy, EndTurnForecast, FacilityState, GameState, InfectionGrace } from './types';
import { forecastUnitSuppression } from './combat-query';

export const clamp = (n: number, low = 0, high = 1): number => Math.max(low, Math.min(high, n));

/** Independent streams: neither previews nor additional health draws advance the game RNG. */
export function domainRng(seed: number, domain: string): SeededRng {
  let hash = 2166136261;
  for (const c of `${seed}:${domain}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return new SeededRng(hash >>> 0);
}

export function binomial(n: number, p: number, rng: SeededRng): number {
  let count = 0;
  if (p <= 0) return 0;
  if (p >= 1) return n;
  for (let i = 0; i < n; i += 1) if (rng.nextFloat() < p) count += 1;
  return count;
}

export function healthTransition(stress: GameState['publicHealthStress'], accumulation: number, foodDeficit: number, civilianGoodsDeficit: number) {
  const nextAccumulation = foodDeficit > 0 ? Math.min(7, accumulation + foodDeficit) : Math.max(0, accumulation - 0.5);
  return {
    stress: { food: clamp(0.75 * stress.food + 0.40 * foodDeficit), civilianGoods: clamp(0.75 * stress.civilianGoods + 0.40 * civilianGoodsDeficit) },
    accumulation: nextAccumulation,
    starvationRate: foodDeficit > 0 ? Math.min(0.10, foodDeficit * Math.max(0, nextAccumulation - 2) * 0.02) : 0,
  };
}

export function screeningProbability(policy: CheckpointPolicy, waiting: number, capacity: number, stress: GameState['publicHealthStress']): number {
  if (policy === 'strict' || policy === 'deny') return 0;
  if (policy === 'normal') return 0.05;
  return clamp(0.25 * (1 + 0.50 * clamp(waiting / capacity - 1) + 0.75 * stress.food + stress.civilianGoods), 0, 0.60);
}

export function waitingProbability(waiting: number, capacity: number, stress: GameState['publicHealthStress']): number {
  return clamp(0.01 * Math.max(0, waiting / capacity - 1) * (1 + 0.50 * stress.food + stress.civilianGoods), 0, 0.12);
}

export function internalInfectionRisk(facility: Readonly<FacilityState>, stress: GameState['publicHealthStress'], outage: boolean) {
  const overcrowding = ['capital', 'city'].includes(facility.type) ? clamp((facility.workers + facility.infected) / facility.workerCapacity - 1) : 0;
  const housingOutage = facility.type === 'temporaryHousing' && facility.workers > 0 && outage ? 1 : 0;
  const causes = { food: 0.45 * stress.food, civilianGoods: 0.65 * stress.civilianGoods, overcrowding: 0.35 * overcrowding, housingOutage: 0.25 * housingOutage };
  const pressure = clamp(Object.values(causes).reduce((a, b) => a + b, 0));
  const probability = 0.03 * pressure ** 2;
  return { facilityId: facility.id, healthyPopulation: facility.workers, pressure, probability, expectedInfections: facility.workers * probability, causes, firstInfectionCanEmptySite: facility.workers === 1 && probability > 0 };
}

type InfectionSite = { infected: number; infectionGrace?: InfectionGrace[] };
export function graceCount(site: Readonly<InfectionSite>, turn: number): number {
  return (site.infectionGrace ?? []).filter(g => g.spreadsFromTurn > turn).reduce((n, g) => n + g.count, 0);
}
export function addInfectionGrace(site: InfectionSite, count: number, turn: number): void {
  if (count <= 0) return;
  const batches = site.infectionGrace ??= [];
  const existing = batches.find(g => g.spreadsFromTurn === turn + 1);
  if (existing) existing.count += count; else batches.push({ count, spreadsFromTurn: turn + 1 });
}
/** Consume old infectious people first, then oldest deferred cohorts. Call before reducing infected. */
export function consumeInfected(site: InfectionSite, count: number): void {
  const batches = [...(site.infectionGrace ?? [])].sort((a, b) => a.spreadsFromTurn - b.spreadsFromTurn);
  let remaining = Math.max(0, count - (site.infected - batches.reduce((n, g) => n + g.count, 0)));
  for (const batch of batches) { const take = Math.min(batch.count, remaining); batch.count -= take; remaining -= take; }
  site.infectionGrace = batches.filter(g => g.count > 0);
  site.infected = Math.max(0, site.infected - count);
}

export interface StarvationPool { id: string; kind: 'facility' | 'checkpoint'; pool: 'workers' | 'waiting' | 'screening' | 'approved'; population: number }
export function starvationPools(state: Readonly<GameState>): StarvationPool[] {
  return [
    ...state.facilities.filter(f => f.owner === 'player').map(f => ({ id: f.id, kind: 'facility' as const, pool: 'workers' as const, population: f.workers })),
    ...state.checkpoints.flatMap(c => (['waiting', 'screening', 'approved'] as const).map(pool => ({ id: c.id, kind: 'checkpoint' as const, pool, population: c[pool] }))),
  ].sort((a, b) => a.id.localeCompare(b.id) || ['workers', 'waiting', 'screening', 'approved'].indexOf(a.pool) - ['workers', 'waiting', 'screening', 'approved'].indexOf(b.pool));
}
export function starvationAllocation(pools: StarvationPool[], rate: number, carry: number) {
  const population = pools.reduce((n, p) => n + p.population, 0);
  const raw = population * rate + carry;
  const loss = rate > 0 ? Math.min(population, Math.floor(raw)) : 0;
  const allocations = pools.map((p, index) => ({ ...p, index, loss: population > 0 ? Math.floor(loss * p.population / population) : 0, remainder: population > 0 ? (loss * p.population) % population : 0 }));
  let remaining = loss - allocations.reduce((n, p) => n + p.loss, 0);
  for (const p of [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) { if (remaining <= 0) break; if (p.loss < p.population) { p.loss += 1; remaining -= 1; } }
  return { population, loss, carryBefore: carry, carryAfter: population === 0 ? 0 : rate > 0 ? raw - Math.floor(raw) : carry, allocations: allocations.map(({ index: _i, remainder: _r, ...p }) => p) };
}

export function forecastPublicHealth(state: Readonly<GameState>, economy: Omit<EndTurnForecast, 'publicHealth'>) {
  const foodDeficit = economy.food.maintenanceRequired > 0 ? clamp(economy.food.shortage / economy.food.maintenanceRequired) : 0;
  const civilianGoodsDeficit = economy.civilianGoods.maintenanceRequired > 0 ? clamp(economy.civilianGoods.maintenanceShortage / economy.civilianGoods.maintenanceRequired) : 0;
  const next = healthTransition(state.publicHealthStress, state.foodShortageAccumulation, foodDeficit, civilianGoodsDeficit);
  const pools = starvationPools(state);
  for (const entry of economy.militaryGoods.units) {
    const unit = state.units.find(u => u.id === entry.unitId)!;
    const suppression = forecastUnitSuppression(state, unit, entry.afterRefill);
    if (!suppression) continue;
    let loss = suppression.projectedCivilianDamage;
    for (const pool of pools.filter(p => p.id === suppression.targetId).sort((a,b) => ['approved','screening','waiting','workers'].indexOf(a.pool) - ['approved','screening','waiting','workers'].indexOf(b.pool))) { const removed = Math.min(loss, pool.population); pool.population -= removed; loss -= removed; }
  }
  const outageIds = new Set(economy.housingOutage.facilities.map(f => f.facilityId));
  return {
    foodDeficit, civilianGoodsDeficit, stressBefore: { ...state.publicHealthStress }, stressAfter: next.stress,
    accumulationBefore: state.foodShortageAccumulation, accumulationAfter: next.accumulation, threshold: 2, accumulationCap: 7,
    starvationRate: next.starvationRate, starvation: starvationAllocation(pools, next.starvationRate, state.starvationCarry),
    facilities: state.facilities.filter(f => f.owner === 'player').sort((a,b) => a.id.localeCompare(b.id)).map(f => ({ ...internalInfectionRisk(f, next.stress, outageIds.has(f.id)), graceCount: graceCount(f, state.turn), infectionGrace: f.infectionGrace ?? [] })),
    checkpoints: state.checkpoints.map(c => ({ checkpointId: c.id, waiting: c.waiting, probability: waitingProbability(c.waiting, state.config.refugees.screeningCapacity, next.stress), expectedInfections: c.waiting * waitingProbability(c.waiting, state.config.refugees.screeningCapacity, next.stress), policy: state.roadBranches.find(b => b.branchId === (c.branchId ?? c.direction))?.currentPolicy ?? c.screeningPolicy, screeningProbability: screeningProbability(state.roadBranches.find(b => b.branchId === (c.branchId ?? c.direction))?.currentPolicy ?? c.screeningPolicy, c.waiting, state.config.refugees.screeningCapacity, next.stress), graceCount: graceCount(c, state.turn), infectionGrace: c.infectionGrace ?? [] })),
    conditions: 'Starvation follows current deterministic suppression; infection probabilities are conditional on population after arrivals, screening and starvation. Expected infections are not guaranteed losses.',
  };
}

export type PublicHealthForecast = ReturnType<typeof forecastPublicHealth>;

export function compactPublicHealth(health: PublicHealthForecast) {
  const risks = [...health.facilities].filter(f => f.probability > 0).sort((a,b) => b.probability - a.probability || a.facilityId.localeCompare(b.facilityId));
  return { foodDeficit: health.foodDeficit, civilianGoodsDeficit: health.civilianGoodsDeficit, stressBefore: health.stressBefore, stressAfter: health.stressAfter, accumulationBefore: health.accumulationBefore, accumulationAfter: health.accumulationAfter, starvationRate: health.starvationRate, starvationLoss: health.starvation.loss, carryAfter: health.starvation.carryAfter, highRiskFacilities: { items: risks.slice(0,5), total: risks.length, omitted: Math.max(0,risks.length-5), detailQuery: { target: 'forecast' } }, checkpoints: health.checkpoints, conditions: health.conditions };
}
