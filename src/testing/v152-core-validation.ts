/** Run with --baseline=<checkout>; baseline code is never part of production bundles. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import assert from 'node:assert/strict';
import { GameEngine, previewMove, forecastEndTurn } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import { createAgentObservation } from '../agent/observation';
import { encodeSaveCode, decodeSaveCode } from '../persistence/save';
import type { GameAction, GameConfig, GameState } from '../core/types';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
if (!args.baseline) throw new Error('--baseline=<v1.5.1 checkout> is required');
const baseline = resolve(args.baseline).replaceAll('\\', '/');
const old = await import(`${baseline}/src/core/engine.ts`) as typeof import('../core/engine');
const oldObservation = await import(`${baseline}/src/agent/observation.ts`) as typeof import('../agent/observation');
const oldSave = await import(`${baseline}/src/persistence/save.ts`) as typeof import('../persistence/save');
const output = resolve(args.out ?? 'output/v152-validation');
await mkdir(output, { recursive: true });
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const measure = (fn: () => unknown, samples = 30) => {
  const coldStart = performance.now(); fn(); const coldMs = performance.now() - coldStart;
  for (let i = 0; i < 3; i++) fn();
  const sessions = Array.from({ length: 3 }, () => {
    const values = Array.from({ length: samples }, () => { const start = performance.now(); fn(); return performance.now() - start; }).sort((a,b)=>a-b);
    return { medianMs: values[Math.floor(samples/2)], p95Ms: values[Math.ceil(samples*.95)-1], maxMs: values.at(-1) };
  });
  return { coldMs, samples, sessions };
};
const traces: unknown[] = [], fixtures: Array<{ name: string; state: GameState }> = [];
// Standard rules: deterministic legal choices exercise gameplay and rejection atomicity.
for (const seed of [1, 7]) {
  const a = new old.GameEngine(seed), b = new GameEngine(seed);
  for (let decision = 0; decision < 80 && !a.isGameOver(); decision++) {
    const actions = a.getLegalActions();
    assert.deepEqual(b.getLegalActions(), actions);
    const action = decision % 5 === 4 ? { type: 'EndTurn' } as GameAction : actions[(decision * 37 + seed) % actions.length]!;
    const ar = a.step(action), br = b.step(action);
    assert.equal(hash(br), hash(ar), `state/events/RNG mismatch seed ${seed} decision ${decision}`);
    const oa = oldObservation.createAgentObservation(ar.state);
    const ob = createAgentObservation(br.state);
    const { productionCapacity: _, ...legacyForecast } = ob.strategicForecast;
    assert.deepEqual({ ...ob, apiVersion: oa.apiVersion, strategicForecast: legacyForecast }, oa);
    traces.push({ seed, decision, action, hash: hash(ar) });
  }
}
fixtures.push({ name: 'standard-early', state: new old.GameEngine(1).getState() as GameState });
// Reachable dense/late fixtures use a declared quiet config, preserving the actual wave schedule.
const config: GameConfig = createDefaultConfig({
  economy: { initialResources: { food: 1_000_000, civilianGoods: 1_000_000, militaryGoods: 1_000_000, fuel: 1_000_000 } },
  refugees: { arrivalIntervalMin: 1_000_000, arrivalIntervalMax: 1_000_000 },
  units: { zombie: { movement: 0 }, policeZombie: { movement: 0 }, soldierZombie: { movement: 0 }, riotZombie: { movement: 0 }, hunterZombie: { movement: 0 }, hordeZombie: { movement: 0 } },
});
const campaign = new old.GameEngine(1, config);
for (let turn = 1; turn <= 51; turn++) {
  if ([20, 50, 51].includes(turn)) fixtures.push({ name: `reachable-wave-turn-${turn}`, state: campaign.getState() as GameState });
  if (turn === 51) break;
  // Recruit repeatedly through real Actions, increasing unit count without injected state.
  const production = campaign.getLegalActions().find(a => a.type === 'ProduceUnit');
  if (production && turn <= 15) { const r = campaign.step(production); if (r.error) throw new Error(r.error.code); }
  const r = campaign.step({ type: 'EndTurn' });
  if (r.error || r.gameOver) throw new Error(`Fixture campaign stopped: ${JSON.stringify(r.result ?? r.error)}`);
}
const reports: unknown[] = [];
for (const fixture of fixtures) {
  const a = new old.GameEngine(fixture.state.seed, fixture.state.config), b = new GameEngine(fixture.state.seed, fixture.state.config);
  assert.equal(a.step({ type: 'LoadSnapshot', snapshot: fixture.state }).error, null);
  assert.equal(b.step({ type: 'LoadSnapshot', snapshot: fixture.state }).error, null);
  const actions = a.getLegalActions(); assert.deepEqual(b.getLegalActions(), actions);
  const oldCode = oldSave.encodeSaveCode(fixture.state);
  assert.deepEqual(decodeSaveCode(oldCode), oldSave.decodeSaveCode(oldCode));
  await writeFile(resolve(output, `${fixture.name}.json`), JSON.stringify(fixture.state));
  await writeFile(resolve(output, `${fixture.name}.save.txt`), oldCode);
  const move = actions.find(a => a.type === 'Move');
  const rows = {
    legal: { before: measure(()=>a.getLegalActions()), after: measure(()=>b.getLegalActions()) },
    observation: { before: measure(()=>oldObservation.createAgentObservation(fixture.state)), after: measure(()=>createAgentObservation(fixture.state)) },
    forecast: { before: measure(()=>old.forecastEndTurn(fixture.state)), after: measure(()=>forecastEndTurn(fixture.state)) },
    save: { before: measure(()=>oldSave.encodeSaveCode(fixture.state), 10), after: measure(()=>encodeSaveCode(fixture.state), 10) },
    preview: move?.type === 'Move' ? { before: measure(()=>old.previewMove(fixture.state, move.unitId, move.destination)), after: measure(()=>previewMove(fixture.state, move.unitId, move.destination)) } : null,
  };
  const step = (Engine: typeof GameEngine) => {
    const e = new Engine(fixture.state.seed, fixture.state.config); e.step({ type: 'LoadSnapshot', snapshot: fixture.state });
    const start = performance.now(), r = e.step({ type: 'EndTurn' });
    if (r.error) throw new Error(r.error.code);
    return { ms: performance.now()-start, hash: hash(r) };
  };
  const before = Array.from({length: 5}, ()=>step(old.GameEngine));
  const after = Array.from({length: 5}, ()=>step(GameEngine));
  assert.equal(after[0]!.hash, before[0]!.hash);
  reports.push({ name: fixture.name, turn: fixture.state.turn, units: fixture.state.units.length, facilities: fixture.state.facilities.length, events: fixture.state.events.length, rows, endTurn: {before, after} });
  console.log(`Verified ${fixture.name}`);
}
await writeFile(resolve(output, 'core-report.json'), JSON.stringify({ node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, baseline, measuredAt: new Date().toISOString(), traces, reports, limits: 'PC Node function measurements. Late fixtures have stationary enemies and large stocks, reached by real Actions. Not SOG05/browser timing.' }, null, 2));
console.log(`All deterministic comparisons passed; report ${output}`);
