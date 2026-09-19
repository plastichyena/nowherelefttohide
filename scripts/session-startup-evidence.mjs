import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = resolve(option('out') ?? 'output/session-startup/evidence.json');
const directory = resolve(output, '..');
mkdirSync(directory, { recursive: true });
const root = realpathSync(mkdtempSync(join(directory, 'sessions-')));
const bundle = resolve('dist/portable/session-cli.mjs');
const launcher = resolve('scripts/run-session.mjs');
const packageRoot = option('package') ? resolve(option('package')) : null;
const buildInfo = packageRoot ? readFileSync(join(packageRoot, 'BUILD_INFO.txt'), 'utf8') : '';
const env = { ...process.env,
  ...(buildInfo.match(/^Commit:\s*(\S+)$/mu)?.[1] ? { NLTH_GIT_COMMIT: buildInfo.match(/^Commit:\s*(\S+)$/mu)[1] } : {}),
  ...(buildInfo.match(/^Build ID:\s*(\S+)$/mu)?.[1] ? { NLTH_BUILD_ID: buildInfo.match(/^Build ID:\s*(\S+)$/mu)[1] } : {}),
};
function run(executable, args, input, allowFailure = false) {
  const start = performance.now();
  const result = spawnSync(executable, args, { encoding: 'utf8', input, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || (!allowFailure && result.status !== 0)) throw Error(result.error?.message ?? result.stderr);
  return { ms: performance.now() - start, result, json: () => JSON.parse(result.stdout || result.stderr) };
}
const cold = run(process.execPath, ['scripts/build-portable.mjs']);
const bundleStamp = statSync(bundle).mtimeMs;
const cli = (args, input, allowFailure) => run(process.execPath, [launcher, ...args], input, allowFailure);
const common = ['--root', root, '--session', 'startup'];
const timings = {};
timings.help = cli(['--help']).ms;
timings.new = cli(['new', ...common, '--seed', '1']).ms;
timings.status = cli(['status', ...common]).ms;
timings.query = cli(['query', ...common, '--target', 'api']).ms;
const warm = Array.from({ length: 10 }, () => cli(['status', ...common]).ms).sort((a, b) => a - b);
assert.equal(statSync(bundle).mtimeMs, bundleStamp, 'warm commands must not rebuild');
assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts.session, 'node scripts/run-session.mjs');
let contractMatched = null;
if (packageRoot) {
  const executable = join(packageRoot, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
  const packaged = (args, input, allowFailure) => run(executable, [join(packageRoot, 'session-cli.mjs'), ...args], input, allowFailure);
  const roots = [join(root, 'checkout'), join(root, 'package')];
  const states = [cli, packaged].map((invoke, index) => {
    const args = ['--root', roots[index], '--session', 'contract'];
    invoke(['new', ...args, '--seed', '7']);
    const initial = invoke(['query', ...args, '--target', 'full-snapshot']).json().value;
    const malformed = invoke(['preview', ...args, '--revision', '0'], JSON.stringify({ type: 'ProduceUnit', facilityId: 'capital', unitType: 'police' }), true);
    assert.notEqual(malformed.result.status, 0);
    assert.equal(malformed.json().code, 'invalid_action_input');
    const status = invoke(['status', ...args]).json();
    assert.equal(status.revision, 0);
    const preview = invoke(['preview', ...args, '--revision', '0'], JSON.stringify({ type: 'EndTurn' })).json();
    const step = invoke(['step', ...args], JSON.stringify({ action: { type: 'EndTurn' }, expectedRevision: 0 })).json();
    assert.equal(step.ok, true); assert.equal(step.accepted, true);
    const final = invoke(['query', ...args, '--target', 'full-snapshot']).json().value;
    return { initial, preview, final };
  });
  assert.deepEqual(states[0], states[1], 'checkout and bundled-runtime CLI contracts must agree');
  contractMatched = true;
}
const medianMs = (warm[4] + warm[5]) / 2;
const p95Ms = warm[9];
const report = { ok: true, appVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
  platform: process.platform, coldBuildMs: cold.ms, builtCommandMs: timings,
  warmReadOnly: { samplesMs: warm, medianMs, p95Ms, count: 10 }, warmRebundled: false, contractMatched,
  performanceInvestigation: p95Ms < 10000 ? null : 'p95 exceeded the investigation target. Inspect runner load and status integrity/observation work; no Vite/TS runtime or warm rebuild was used.' };
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
