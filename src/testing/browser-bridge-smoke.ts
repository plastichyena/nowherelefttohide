import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { BOARD_ASSET_PATHS } from '../ui/boardAssets';

const DEFAULT_DIST = 'dist';
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
const PUBLIC_METHODS = [
  'getApiInfo',
  'reset',
  'getObservation',
  'getLegalActions',
  'step',
  'isGameOver',
  'getResult',
  'getRunArtifact',
] as const;

function argumentValue(name: string): string | undefined {
  const equalsPrefix = `--${name}=`;
  const equals = process.argv.find((argument) => argument.startsWith(equalsPrefix));
  if (equals) return equals.slice(equalsPrefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  throw new Error(`[browser-bridge-smoke] ${message}`);
}

function filesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

function assertInside(root: string, path: string): void {
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  if (path !== root && !path.startsWith(rootWithSeparator)) fail(`asset escapes dist: ${path}`);
}

function run(): void {
  const requestedDist = argumentValue('dist') ?? DEFAULT_DIST;
  const dist = resolve(requestedDist);
  if (!existsSync(dist) || !statSync(dist).isDirectory()) fail(`production directory does not exist: ${dist}`);

  const indexPath = resolve(dist, 'index.html');
  const agentPagePath = resolve(dist, 'agent-api.html');
  if (!existsSync(indexPath)) fail('dist/index.html is missing');
  if (!existsSync(agentPagePath)) fail('dist/agent-api.html is missing');
  const boardAssetRoot = resolve(dist, 'assets', 'board');
  if (!existsSync(resolve(boardAssetRoot, 'ASSET_MANIFEST.md'))) fail('board Asset Manifest is missing');
  let boardAssetBytes = 0;
  for (const assetPath of BOARD_ASSET_PATHS) {
    const runtimePath = resolve(boardAssetRoot, assetPath);
    assertInside(boardAssetRoot, runtimePath);
    if (!existsSync(runtimePath)) fail(`board runtime asset is missing: ${assetPath}`);
    boardAssetBytes += statSync(runtimePath).size;
  }
  if (boardAssetBytes > 3 * 1024 * 1024) fail(`board runtime assets exceed 3 MiB: ${boardAssetBytes}`);

  const index = readFileSync(indexPath, 'utf8');
  const agentPage = readFileSync(agentPagePath, 'utf8');
  if (/<(?:script|link|img)[^>]+(?:src|href)=["']https?:\/\//i.test(index)) {
    fail('index.html contains an insecure or mixed-content absolute asset URL');
  }
  if (!agentPage.includes('window.NLTH') || !agentPage.includes('test:browser-bridge')) {
    fail('agent-api.html is missing the public bridge instructions');
  }

  const scriptSources = [...index.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);
  if (scriptSources.length === 0) fail('index.html does not reference a script bundle');

  const bundles = new Set<string>();
  for (const source of scriptSources) {
    if (/^https?:\/\//i.test(source)) fail(`external script is not allowed: ${source}`);
    const cleanSource = source.split('#', 1)[0].split('?', 1)[0];
    const scriptPath = resolve(dist, cleanSource.replace(/^\.\//, '').replace(/^\//, ''));
    assertInside(dist, scriptPath);
    if (!existsSync(scriptPath)) fail(`script bundle is missing: ${source}`);
    bundles.add(scriptPath);
  }

  // Include code-split JavaScript chunks as well; the bridge must remain in
  // the production graph even when Vite changes chunking strategy.
  for (const path of filesUnder(dist).filter((candidate) => candidate.endsWith('.js'))) bundles.add(path);
  const sources = [...bundles].map((path) => {
    const bytes = statSync(path).size;
    if (bytes > MAX_BUNDLE_BYTES) fail(`bundle is unexpectedly large: ${path}`);
    return readFileSync(path, 'utf8');
  });
  const bundle = sources.join('\n');
  if (!bundle.includes('window.NLTH')) fail('production bundle does not install window.NLTH');
  for (const method of PUBLIC_METHODS) {
    if (!bundle.includes(method)) fail(`production bundle does not contain bridge method marker: ${method}`);
  }
  if (!bundle.includes('Object.freeze')) fail('production bridge API is not frozen');
  for (const marker of ['1.3.3', '1.4.2', 'fixed-15x15-v2', 'SetPowerSupply', 'RelocateCheckpoint', 'ActivateCheckpoint', 'roadBranches', 'standbyCheckpointIds', 'dormantCheckpointIds', 'fallbackAvailable', 'checkpointPositionCandidates', 'noiseClass', 'periodicInitial', 'finalComposition', 'periodicHordeZombiesSpawned', 'artifactSchemaVersion', 'projectedPowerSupplied', 'recoveryClassIfTurnEndsNow', 'effectiveRange', 'projectedSuppression', 'visibleToPlayer', 'finalHordeStatus']) {
    if (!bundle.includes(marker)) fail(`production bundle does not contain v1.3.3 schema marker: ${marker}`);
  }
  const productionCodeAndStyles = filesUnder(dist)
    .filter((path) => path.endsWith('.js') || path.endsWith('.css'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  for (const forbidden of ['data-noise-debug-overlay', 'getDevelopmentNoiseDebug', 'Internal Noise Target', '.noise-debug-overlay']) {
    if (productionCodeAndStyles.includes(forbidden)) fail(`development-only Noise diagnostic leaked into production: ${forbidden}`);
  }
  // This is deliberately a static smoke: the project has no browser-driver
  // dependency. The companion page documents the real-browser E2E sequence.
  const relativeBundles = [...bundles].map((path) => relative(dist, path));
  console.log(`[browser-bridge-smoke] PASS: ${relativeBundles.length} production JS bundle(s), window.NLTH and agent-api.html verified`);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
