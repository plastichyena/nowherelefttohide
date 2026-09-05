import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { GameAction } from '../core/types';
import { canonicalJson } from './hash';

interface Measurement {
  wallMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number; maxRSS: number; fsRead: number; fsWrite: number };
}

const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...parts] = arg.replace(/^--/u, '').split('=');
  return [key, parts.join('=')];
}));
const cli = resolve(options.cli || 'dist/portable/session-cli.mjs');
const output = resolve(options.out || `output/performance/play-turn-${Date.now()}/report.json`);
const requestedTurns = Number(options.turns || '1');
if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 30) throw new Error('--turns must be an integer from 1 to 30');
const sessionRoot = resolve(dirname(output), 'sessions');
const worker = resolve('src/session/play-turn-benchmark-worker.mjs');
mkdirSync(sessionRoot, { recursive: true });

function run(args: string[], stdin = ''): { json: Record<string, unknown>; measurement: Measurement } {
  const started = performance.now();
  const child = spawnSync(process.execPath, [worker, cli, ...args], { input: stdin, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const wallMs = performance.now() - started;
  if (child.status !== 0) throw new Error(`Session CLI failed (${child.status}): ${child.stderr}`);
  const marker = child.stderr.split(/\r?\n/u).find((line) => line.startsWith('NLTH_BENCHMARK '));
  if (!marker) throw new Error('Session CLI did not return its resource marker');
  return {
    json: JSON.parse(child.stdout.trim().split(/\r?\n/u).at(-1)!) as Record<string, unknown>,
    measurement: { wallMs, stdoutBytes: Buffer.byteLength(child.stdout), stderrBytes: Buffer.byteLength(child.stderr), memory: JSON.parse(marker.slice('NLTH_BENCHMARK '.length)) as Measurement['memory'] },
  };
}

function create(sessionId: string) {
  return run(['new', `--root=${sessionRoot}`, `--session-id=${sessionId}`, '--seed=1', '--agent-id=benchmark']);
}

const legacyNew = create('legacy');
create('play-turn');
create('interactive');
const legacyRuns: Measurement[] = [];
const playTurnRuns: Measurement[] = [];
const interactiveRuns: Measurement[] = [];
const actions: GameAction[] = [];
let legacyRevision = 0;
let playTurnRevision = 0;
let interactiveRevision = 0;
let turnsCompleted = 0;
let gameResultsMatch = true;
let legacyView = legacyNew.json;
for (let turnIndex = 0; turnIndex < requestedTurns; turnIndex += 1) {
  const compact = legacyView.observation as { units: Array<{ id: string }>; gameOver: boolean };
  if (compact.gameOver) break;
  const actionInputs: Array<{ action: GameAction; decisionSummary: string }> = compact.units.slice(0, 2).map((unit, index) => ({ action: { type: 'Wait', unitId: unit.id }, decisionSummary: `Benchmark turn ${turnIndex + 1} wait ${index + 1}.` }));
  actionInputs.push({ action: { type: 'EndTurn' }, decisionSummary: `Benchmark turn ${turnIndex + 1} EndTurn.` });
  for (const input of actionInputs) {
    const entry = run(['step', `--root=${sessionRoot}`, '--session=legacy'], `${JSON.stringify({ ...input, expectedRevision: legacyRevision })}\n`);
    legacyRuns.push(entry.measurement);
    legacyRevision += 1;
  }
  const planPath = resolve(dirname(output), `turn-plan-${turnIndex + 1}.json`);
  writeFileSync(planPath, `${JSON.stringify({ expectedRevision: playTurnRevision, actions: actionInputs.map((input, index) => ({ ...input, requestId: `benchmark-${turnIndex + 1}-${index + 1}` })) }, null, 2)}\n`, 'utf8');
  const finite = run(['play-turn', `--root=${sessionRoot}`, '--session=play-turn', `--input=${planPath}`]);
  playTurnRuns.push(finite.measurement);
  const interactive = run(
    ['play-turn', `--root=${sessionRoot}`, '--session=interactive'],
    actionInputs.map((input, index) => JSON.stringify({ type: 'action', ...input, expectedRevision: interactiveRevision + index, requestId: `interactive-${turnIndex + 1}-${index + 1}` })).join('\n') + '\n',
  );
  interactiveRuns.push(interactive.measurement);
  legacyRevision += 0;
  playTurnRevision += actionInputs.length;
  interactiveRevision += actionInputs.length;
  actions.push(...actionInputs.map((entry) => entry.action));
  const legacyStatus = run(['status', `--root=${sessionRoot}`, '--session=legacy']);
  const playTurnStatus = run(['status', `--root=${sessionRoot}`, '--session=play-turn']);
  const interactiveStatus = run(['status', `--root=${sessionRoot}`, '--session=interactive']);
  gameResultsMatch &&= canonicalJson(legacyStatus.json.observation) === canonicalJson(playTurnStatus.json.observation)
    && canonicalJson(legacyStatus.json.observation) === canonicalJson(interactiveStatus.json.observation)
    && canonicalJson(legacyStatus.json.result) === canonicalJson(playTurnStatus.json.result)
    && canonicalJson(legacyStatus.json.result) === canonicalJson(interactiveStatus.json.result);
  legacyView = legacyStatus.json;
  turnsCompleted += 1;
  if (!gameResultsMatch) break;
}

function summarize(measurements: Measurement[]) {
  return {
    nodeStarts: measurements.length,
    wallMs: measurements.reduce((sum, item) => sum + item.wallMs, 0),
    rssTrend: { firstExitBytes: measurements[0]?.memory.rss ?? 0, lastExitBytes: measurements.at(-1)?.memory.rss ?? 0 },
    peak: Object.fromEntries(['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers', 'maxRSS'].map((key) => [key, Math.max(...measurements.map((item) => item.memory[key as keyof Measurement['memory']]))])),
    io: {
      stdoutBytes: measurements.reduce((sum, item) => sum + item.stdoutBytes, 0),
      stderrBytes: measurements.reduce((sum, item) => sum + item.stderrBytes, 0),
      fsRead: measurements.reduce((sum, item) => sum + item.memory.fsRead, 0),
      fsWrite: measurements.reduce((sum, item) => sum + item.memory.fsWrite, 0),
    },
  };
}

const legacy = summarize(legacyRuns);
const playTurn = summarize(playTurnRuns);
const interactive = summarize(interactiveRuns);
const report = {
  schemaVersion: '1.0.0', measuredAt: new Date().toISOString(), platform: process.platform, nodeVersion: process.version,
  cli, cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'), seed: 1, requestedTurns, turnsCompleted, actions, gameResultsMatch,
  measurementNotes: { maxRSS: 'process.resourceUsage().maxRSS; units are platform-defined by Node.js', wall: 'includes wrapper and bundled CLI startup', childNodeStartsPerAction: 0 },
  legacySingleStep: legacy,
  playTurnInteractive: interactive,
  playTurnFinitePlan: playTurn,
  difference: {
    interactive: { nodeStarts: interactive.nodeStarts - legacy.nodeStarts, wallMs: interactive.wallMs - legacy.wallMs, peakRssBytes: Number(interactive.peak.rss) - Number(legacy.peak.rss), stdoutBytes: interactive.io.stdoutBytes - legacy.io.stdoutBytes },
    finitePlan: { nodeStarts: playTurn.nodeStarts - legacy.nodeStarts, wallMs: playTurn.wallMs - legacy.wallMs, peakRssBytes: Number(playTurn.peak.rss) - Number(legacy.peak.rss), stdoutBytes: playTurn.io.stdoutBytes - legacy.io.stdoutBytes },
  },
};
if (!gameResultsMatch) throw new Error('legacy step and play-turn final public results differ');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: true, output, legacy: report.legacySingleStep, interactive: report.playTurnInteractive, finitePlan: report.playTurnFinitePlan, difference: report.difference })}\n`);
