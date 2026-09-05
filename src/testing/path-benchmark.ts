import { performance } from 'node:perf_hooks';
import { createDefaultConfig } from '../core/config';
import { createInitialState } from '../core/state';
import * as current from '../core/path';
import * as legacy from './fixtures/v151-path-reference';
import { createMovementCostResolver, effectiveMovementCost } from '../core/terrain';

// Run with: node_modules/.bin/vite-node.cmd --script src/testing/path-benchmark.ts
const state = createInitialState(1, createDefaultConfig());
const blocked = new Set(state.units.slice(1).map((unit) => `${unit.position.q},${unit.position.r}`));
const cases = [
  { name: 'initial human budget 15', start: { q: 24, r: 25 }, budget: 15 },
  { name: 'long weighted search budget 40', start: { q: 5, r: 5 }, budget: 40 },
];
function measure(fn: () => unknown) {
  for (let i = 0; i < 3; i += 1) fn();
  const samples = Array.from({ length: 30 }, () => {
    const start = performance.now(); fn(); return performance.now() - start;
  }).sort((a, b) => a - b);
  return { medianMs: samples[15], p95Ms: samples[28], maxMs: samples[29] };
}
console.log(JSON.stringify({ node: process.version, seed: 1, units: state.units.length,
  cases: cases.map((fixture) => ({ name: fixture.name,
    legacy: measure(() => legacy.findReachablePaths(state.map, fixture.start, fixture.budget, blocked,
      (position) => effectiveMovementCost(state, position))),
    current: measure(() => current.findReachablePaths(state.map, fixture.start, fixture.budget, blocked,
      createMovementCostResolver(state))),
  })),
}, null, 2));
