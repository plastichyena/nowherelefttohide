/** Generate bounded, replayable local evidence. Run with vite-node; never writes outside the requested new output directory. */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, strFromU8 } from 'fflate';
import { createTerminalSessionFixture, terminalFixtureAction } from './v171-session-fixture';
import { SessionService } from '../session/service';
import { SessionStore } from '../session/store';
import { resolveSessionIdentity } from '../session/agent-adapter';
import { exportSaveJson, decodeSaveCode } from '../persistence/save';
import { GameEngine } from '../core/engine';
import { createScoreContext } from '../core/terminal-score';
import { prepareTestSnapshot } from '../core/testConfig';
import type { GameState } from '../core/types';
import legacy from './fixtures/v171-score-compat.json';

const out = resolve(process.argv.find(v => v.startsWith('--out='))?.slice(6) ?? 'output/v172/browser-fixtures');
if (existsSync(out)) throw new Error(`Refusing to overwrite existing evidence: ${out}`);
mkdirSync(out, { recursive: true });
const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v172-local-validation', NLTH_GIT_COMMIT: 'd0b08ccaf5969c00f8d021a2e0c2ff3d880121f3' });
const results: unknown[] = [];
for (const outcome of ['won', 'lost'] as const) {
  const store = new SessionStore(join(out, 'sessions'));
  const service = new SessionService(store, createTerminalSessionFixture(identity.buildId, outcome), identity);
  service.newSession({ sessionId: outcome, seed: 42, mapMode: 'fixed' });
  const before = store.load(outcome).privateState as unknown as GameState;
  const step = service.step(outcome, { action: terminalFixtureAction(before, outcome), expectedRevision: 0 });
  if (!step.accepted || !step.gameOver) throw new Error('Terminal fixture did not finish');
  const terminal = store.load(outcome).privateState as unknown as GameState;
  writeFileSync(join(out, `${outcome}.json`), exportSaveJson(terminal));
  const artifact = service.exportArtifact(outcome, join(out, `${outcome}.zip`));
  results.push({ outcome, result: terminal.result, artifact: artifact.artifactPath });
  if (outcome === 'won') {
    before.config.terminalScore = { wH: Number.MAX_SAFE_INTEGER, wF: Number.MAX_SAFE_INTEGER, bMax: 50 };
    prepareTestSnapshot(before);
    before.scoreContext = createScoreContext(before);
    const huge = GameEngine.fromSnapshot(before).step(terminalFixtureAction(before, outcome));
    if (huge.error) throw new Error(huge.error.message);
    writeFileSync(join(out, 'huge.json'), exportSaveJson(huge.state as GameState));
  }
}
writeFileSync(join(out, 'legacy-finished.json'), strFromU8(gunzipSync(Buffer.from(legacy.cases.find(c => c.name === 'finished-won')!.code, 'base64url'))));
writeFileSync(join(out, 'legacy-ongoing.json'), strFromU8(gunzipSync(Buffer.from(legacy.cases[0]!.code, 'base64url'))));
const check = decodeSaveCode(legacy.cases[0]!.code); if (!check.valid) throw new Error(check.errors.join('; '));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const packages = ['typescript', 'vitest', 'vite', 'vite-node', 'esbuild', 'phaser', 'fflate', 'rollup', '@types/node'].map(name => ({
  name, installed: JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version,
  lockVersion: lock.packages[`node_modules/${name}`]?.version,
}));
writeFileSync(join(out, 'evidence.json'), JSON.stringify({ node: process.version, packages, results }, null, 2) + '\n');
console.log(JSON.stringify({ out, generated: ['won.json', 'lost.json', 'huge.json', 'legacy-finished.json', 'legacy-ongoing.json', 'won.zip', 'lost.zip', 'evidence.json'] }));
