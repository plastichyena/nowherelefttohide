import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';

/**
 * Assemble the distributable Player package from a checkout-side build.
 *
 * The package deliberately has no repository checkout, package.json,
 * node_modules, TypeScript, Vite, Vitest, or UI assets.  The Session CLI is
 * bundled before this script runs and the only runtime dependency copied is
 * the Node executable itself.  Development and verification drivers stay in
 * the checkout that invokes this script.
 */

const PLATFORMS = new Set(['linux-x64', 'win-x64']);
const REQUIRED_FILES = ['PLAY_WITH_AI.md', 'LICENSE', 'THIRD_PARTY_NOTICES'];

function fail(message) {
  throw new Error(message);
}

function optionValue(argv, name, defaultValue = undefined) {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0) return defaultValue;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function safeIdentity(value, name) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${name} must be a non-empty value without control characters`);
  }
  return value;
}

function gitCommit(sourceRoot) {
  try {
    const value = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[0-9a-f]{40}$/u.test(value)) return value;
  } catch {
    // A source archive can be assembled without .git. The build identity is
    // explicit in CI and remains useful as local-unknown for local packages.
  }
  return 'local-unknown';
}

function findNodeExecutable(nodeArgument, platform) {
  const supplied = resolve(nodeArgument);
  if (existsSync(supplied) && statSync(supplied).isFile()) return supplied;
  if (!existsSync(supplied) || !statSync(supplied).isDirectory()) fail(`Bundled Node path does not exist: ${supplied}`);
  const candidates = platform === 'win-x64'
    ? [join(supplied, 'node.exe'), join(supplied, 'bin', 'node.exe')]
    : [join(supplied, 'node'), join(supplied, 'bin', 'node')];
  const executable = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!executable) fail(`Could not find a Node executable under ${supplied}`);
  return executable;
}

function ensureEmptyDirectory(path) {
  if (existsSync(path)) {
    if (!lstatSync(path).isDirectory()) fail(`Package output is not a directory: ${path}`);
    if (readdirSync(path).length > 0) fail(`Package output must be new and empty: ${path}`);
    return;
  }
  mkdirSync(path, { recursive: true });
}

function writeIdentity(root, platform, commit, buildId) {
  if (platform === 'win-x64') {
    writeFileSync(join(root, 'runtime', 'identity.cmd'), [
      '@echo off',
      `set "NLTH_GIT_COMMIT=${commit}"`,
      `set "NLTH_BUILD_ID=${buildId}"`,
      '',
    ].join('\r\n'), { encoding: 'ascii' });
    return;
  }
  writeFileSync(join(root, 'runtime', 'identity.env'), [
    `export NLTH_GIT_COMMIT='${commit.replaceAll("'", "'\\''")}'`,
    `export NLTH_BUILD_ID='${buildId.replaceAll("'", "'\\''")}'`,
    '',
  ].join('\n'), { encoding: 'utf8' });
}

function writeLauncher(root, platform) {
  if (platform === 'win-x64') {
    writeFileSync(join(root, 'run-session.cmd'), [
      '@echo off',
      'setlocal',
      'set "ROOT=%~dp0"',
      'call "%ROOT%runtime\\identity.cmd"',
      '"%ROOT%runtime\\node\\node.exe" "%ROOT%session-cli.mjs" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'), { encoding: 'ascii' });
    return;
  }
  const launcher = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
    'source "${ROOT}/runtime/identity.env"',
    'exec "${ROOT}/runtime/node/node" "${ROOT}/session-cli.mjs" "$@"',
    '',
  ].join('\n');
  const path = join(root, 'run-session.sh');
  writeFileSync(path, launcher, { encoding: 'utf8', mode: 0o755 });
  chmodSync(path, 0o755);
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`Player package cannot contain symbolic links: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
      else fail(`Unsupported Player package entry: ${path}`);
    }
  };
  visit(root);
  return files;
}

function main(argv = process.argv.slice(2)) {
  const sourceRoot = resolve(optionValue(argv, '--source', '.'));
  const outputOption = optionValue(argv, '--out');
  const platform = optionValue(argv, '--platform', process.platform === 'win32' ? 'win-x64' : 'linux-x64');
  const nodeArgument = optionValue(argv, '--node');
  if (!outputOption) fail('--out requires a package output directory');
  if (!nodeArgument) fail('--node requires the bundled Node executable or its directory');
  if (!PLATFORMS.has(platform)) fail(`--platform must be linux-x64 or win-x64, received ${platform}`);
  const outputRoot = resolve(outputOption);

  const packageMetadata = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
  const appVersion = safeIdentity(String(packageMetadata.version), 'package version');
  const commit = safeIdentity(optionValue(argv, '--commit', gitCommit(sourceRoot)), 'commit');
  const buildId = safeIdentity(optionValue(argv, '--build-id', commit), 'build id');
  const cliSource = resolve(sourceRoot, 'dist/portable/session-cli.mjs');
  if (!existsSync(cliSource) || !statSync(cliSource).isFile()) fail(`Bundled Session CLI does not exist: ${cliSource}`);
  for (const file of REQUIRED_FILES) {
    const path = join(sourceRoot, file);
    if (!existsSync(path) || !statSync(path).isFile()) fail(`Required Player package notice is missing: ${path}`);
  }

  ensureEmptyDirectory(outputRoot);
  const runtimeRoot = join(outputRoot, 'runtime', 'node');
  mkdirSync(runtimeRoot, { recursive: true });
  const nodeSource = findNodeExecutable(nodeArgument, platform);
  const nodeTarget = join(runtimeRoot, platform === 'win-x64' ? 'node.exe' : 'node');
  cpSync(nodeSource, nodeTarget);
  if (platform === 'linux-x64') chmodSync(nodeTarget, 0o755);
  cpSync(cliSource, join(outputRoot, 'session-cli.mjs'));
  for (const file of REQUIRED_FILES) cpSync(join(sourceRoot, file), join(outputRoot, basename(file)));
  if (existsSync(join(sourceRoot, 'ASSETS_LICENSE.md'))) cpSync(join(sourceRoot, 'ASSETS_LICENSE.md'), join(outputRoot, 'ASSETS_LICENSE.md'));
  mkdirSync(join(outputRoot, 'runtime'), { recursive: true });
  writeIdentity(outputRoot, platform, commit, buildId);
  writeLauncher(outputRoot, platform);

  const nodeVersion = process.version;
  writeFileSync(join(outputRoot, 'BUILD_INFO.txt'), [
    'Nowhere Left to Hide portable AI Player package',
    `App version: ${appVersion}`,
    `Commit: ${commit}`,
    `Build ID: ${buildId}`,
    `Node.js: ${nodeVersion}`,
    `Platform: ${platform}`,
    'Generated by: checkout-side portable assembly',
    '',
  ].join('\n'), { encoding: 'utf8' });

  const manifest = {
    packageKind: 'player',
    packageSchemaVersion: '1.0.0',
    appVersion,
    platform,
    commit,
    buildId,
    nodeVersion,
    entrypoint: platform === 'win-x64' ? '.\\run-session.cmd' : './run-session.sh',
    developmentFilesIncluded: false,
    developmentPath: 'Use the repository checkout for TypeScript drivers, UI development, and tests.',
  };
  writeFileSync(join(outputRoot, 'PORTABLE_PACKAGE.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });

  const files = listFiles(outputRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, output: outputRoot, platform, appVersion, commit, buildId, files, fileCount: files.length })}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
