import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createAgentObservation } from '../agent/observation';
import { forecastEndTurn, forecastFacilityProduction } from '../core/economy-query';
import { deriveProductionCapacity } from '../core/production-capacity';
import type { GameState } from '../core/types';

const fixtureRoot = process.argv.find(arg => arg.startsWith('--fixtures='))?.slice(11) ?? 'output/v152-validation';
const records = [];
for (const name of ['standard-early', 'reachable-wave-turn-20', 'reachable-wave-turn-50', 'reachable-wave-turn-51']) {
  const state = JSON.parse(readFileSync(`${fixtureRoot}/${name}.json`, 'utf8')) as GameState;
  const observation = createAgentObservation(state);
  const capacity = observation.strategicForecast.productionCapacity;
  const forecast = forecastEndTurn(state);
  const projections = forecastFacilityProduction(state);
  const compute = () => deriveProductionCapacity(state, forecast, projections, capacity.availableCityPopulation);
  const start = performance.now(); compute(); const coldMs = performance.now() - start;
  for (let i = 0; i < 3; i++) compute();
  const sessions = Array.from({ length: 3 }, () => {
    const ms = Array.from({ length: 30 }, () => { const start = performance.now(); compute(); return performance.now() - start; }).sort((a, b) => a - b);
    return { medianMs: ms[15], p95Ms: ms[28], maxMs: ms[29], samples: ms };
  });
  const withoutCapacity = structuredClone(observation) as unknown as { strategicForecast: Record<string, unknown> };
  delete withoutCapacity.strategicForecast.productionCapacity;
  records.push({ name, turn: state.turn, coldMs, sessions, fullObservationBytes: Buffer.byteLength(JSON.stringify(observation)), capacityAddedBytes: Buffer.byteLength(JSON.stringify(observation)) - Buffer.byteLength(JSON.stringify(withoutCapacity)), existingEconomyPlanReused: true });
}
const report = { node: process.version, scope: 'Additional capacity derivation after the shared economy forecast, plus serialized public response size.', records };
writeFileSync(`${fixtureRoot}/capacity-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(records.map(({ name, capacityAddedBytes, sessions }) => ({ name, capacityAddedBytes, medianMs: sessions.map(s => s.medianMs) }))));
