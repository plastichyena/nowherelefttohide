/**
 * EndTurn-only paired benchmark. Reuses validated v152-core-validation fixtures.
 * node_modules/.bin/vite-node.cmd --script src/testing/v152-endturn-benchmark.ts --baseline=output/v152-baseline
 * Engine construction, LoadSnapshot, hashing and memory sampling are outside step timing.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { GameEngine } from '../core/engine';
import type { GameState } from '../core/types';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
  const separator = arg.indexOf('=');
  if (separator < 0) throw new Error(`Expected --name=value: ${arg}`);
  return [arg.slice(2, separator), arg.slice(separator + 1)];
}));
if (!args.baseline) throw new Error('--baseline=<v1.5.1 checkout> is required');
const baseline = resolve(args.baseline).replaceAll('\\', '/');
const fixtures = resolve(args.fixtures ?? 'output/v152-validation');
const reportPath = resolve(args.out ?? `${fixtures}/endturn-paired-report.json`);
const old = await import(`${baseline}/src/core/engine.ts`) as typeof import('../core/engine');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHashes = Object.fromEntries(await Promise.all([
  `${baseline}/src/core/engine.ts`, 'src/core/engine.ts', 'src/core/movement-query.ts',
  'src/core/terrain.ts', 'src/core/query-cache.ts', 'src/core/visibility.ts',
  'src/core/economy-query.ts', 'src/core/supply.ts',
].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));

type Variant = 'before' | 'after';
function measure(variant: Variant, state: GameState) {
  const Engine = variant === 'before' ? old.GameEngine : GameEngine;
  const engine = new Engine(state.seed, state.config);
  const loaded = engine.step({ type: 'LoadSnapshot', snapshot: state });
  assert.equal(loaded.error, null, `${variant}: fixture LoadSnapshot`);
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  const result = engine.step({ type: 'EndTurn' });
  const wallMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  assert.equal(result.error, null, `${variant}: EndTurn must succeed`);
  return {
    wallMs, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
    cpuTotalMs: (cpu.user + cpu.system) / 1000,
    resultHash: hash(result), memoryBefore, memoryAfter,
    memoryDeltaBytes: {
      rss: memoryAfter.rss - memoryBefore.rss,
      heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
      external: memoryAfter.external - memoryBefore.external,
      arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    },
  };
}
function summarize(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return { median: ordered[Math.floor(ordered.length / 2)]!,
    p95: ordered[Math.ceil(ordered.length * 0.95) - 1]!, max: ordered.at(-1)! };
}

const names = ['standard-early', 'reachable-wave-turn-20', 'reachable-wave-turn-50', 'reachable-wave-turn-51'];
const reports = [];
for (const name of names) {
  const state = JSON.parse(await readFile(resolve(fixtures, `${name}.json`), 'utf8')) as GameState;
  let expectedHash: string | null = null;
  const warmups: Array<{ order: Variant[]; resultHash: string }> = [];
  const samples: Array<{ round: number; order: Variant[]; before: ReturnType<typeof measure>; after: ReturnType<typeof measure> }> = [];
  for (let round = -3; round < 15; round += 1) {
    const order: Variant[] = (round + 3) % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
    const pair = {} as Record<Variant, ReturnType<typeof measure>>;
    for (const variant of order) {
      pair[variant] = measure(variant, state);
      expectedHash ??= pair[variant].resultHash;
      assert.equal(pair[variant].resultHash, expectedHash, `${name}: ${variant} result mismatch round ${round}`);
    }
    if (round < 0) warmups.push({ order, resultHash: expectedHash! });
    else samples.push({ round, order, ...pair });
  }
  const summary = Object.fromEntries((['before', 'after'] as const).map(variant => [variant, {
    wallMs: summarize(samples.map(sample => sample[variant].wallMs)),
    cpuTotalMs: summarize(samples.map(sample => sample[variant].cpuTotalMs)),
    heapDeltaBytes: summarize(samples.map(sample => sample[variant].memoryDeltaBytes.heapUsed)),
    externalDeltaBytes: summarize(samples.map(sample => sample[variant].memoryDeltaBytes.external)),
    maxSampledRssBytes: Math.max(...samples.flatMap(sample => [sample[variant].memoryBefore.rss, sample[variant].memoryAfter.rss])),
  }])) as Record<Variant, { wallMs: ReturnType<typeof summarize>; cpuTotalMs: ReturnType<typeof summarize>;
    heapDeltaBytes: ReturnType<typeof summarize>; externalDeltaBytes: ReturnType<typeof summarize>; maxSampledRssBytes: number }>;
  const medianWallChangePercent = (summary.after.wallMs.median / summary.before.wallMs.median - 1) * 100;
  reports.push({ name, turn: state.turn, units: state.units.length, facilities: state.facilities.length,
    events: state.events.length, fixtureHash: hash(state), resultHash: expectedHash,
    warmups, samples, summary, medianWallChangePercent });
  console.log(`${name}: before ${summary.before.wallMs.median.toFixed(2)} ms, after ${summary.after.wallMs.median.toFixed(2)} ms (${medianWallChangePercent.toFixed(1)}%); every result hash matched`);
}
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ baseline, fixtures, node: process.version, platform: process.platform,
  cpu: os.cpus()[0]?.model, measuredAt: new Date().toISOString(), sourceHashes,
  warmupsPerVersion: 3, measuredSamplesPerVersion: 15, alternatingPairOrder: true,
  timingScope: 'Synchronous engine.step(EndTurn), including its returned state clone. Constructor/LoadSnapshot/hash/memory sampling excluded.',
  memoryScope: 'Same Node process loads both versions. No forced GC. Heap/external deltas include allocation and collection; RSS values are endpoint samples, not peak or isolated retained memory.',
  limitations: 'One PC Node session, 15 paired samples per fixture (p95 equals maximum). Other OS processes are uncontrolled. Late fixtures use declared stationary enemies and high stocks; not SOG05/browser timing.',
  reports,
}, null, 2));
console.log(`EndTurn comparison complete: ${reportPath}`);
