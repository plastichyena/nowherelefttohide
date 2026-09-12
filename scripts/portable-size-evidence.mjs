import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Record portable package and representative Session occupancy.
 *
 * This is a checkout-side evidence tool. It only measures files and the
 * public Compact returned by the supplied launcher; it does not participate
 * in game decisions. `--before-package`/`--before-zip` are optional so a CI
 * run can attach a comparison package when one is available without adding a
 * pass/fail size threshold.
 */

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

function walk(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`Evidence root cannot contain symbolic links: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({ path, relativePath: relative(root, path).replaceAll('\\', '/'), bytes: statSync(path).size });
      else fail(`Unsupported evidence entry: ${path}`);
    }
  };
  visit(root);
  return files;
}

function packageMetrics(pathOption) {
  const root = resolve(pathOption);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) fail(`Package directory does not exist: ${root}`);
  const files = walk(root);
  return {
    path: root,
    expandedBytes: files.reduce((total, file) => total + file.bytes, 0),
    fileCount: files.length,
    sha256: createHash('sha256').update(files.map((file) => `${file.relativePath}\0${file.bytes}\n`).join(''), 'utf8').digest('hex'),
  };
}

function optionalFileBytes(pathOption, label) {
  if (!pathOption) return null;
  const path = resolve(pathOption);
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`${label} does not exist: ${path}`);
  return { path, bytes: statSync(path).size };
}

function category(relativePath) {
  const normalized = relativePath.toLowerCase();
  if (normalized.includes('.nlth-artifact')) return 'artifactPackage';
  if (normalized.includes('/pool/public/') || normalized.startsWith('pool/public/')) return 'publicPayloadPool';
  if (normalized.includes('/pool/private/') || normalized.startsWith('pool/private/')) return 'privatePayloadPool';
  if (normalized.includes('/checkpoints/') || normalized.startsWith('checkpoints/')) return 'checkpointMetadata';
  if (normalized.includes('/requests/') || normalized.startsWith('requests/')) return 'requestIndex';
  if (normalized.includes('/diagnostics/') || normalized.startsWith('diagnostics/') || normalized.includes('.active-lock/')) return 'lockDiagnosticHistory';
  if (normalized.endsWith('/trace.ndjson') || normalized === 'trace.ndjson' || normalized.includes('/public/decisions/')) return 'decisionRecord';
  if (normalized.includes('/history/') || normalized.startsWith('history/')) return 'repeatedEventHistoryProjection';
  return 'otherSessionFile';
}

function sessionMetrics(rootOption) {
  const root = resolve(rootOption);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) fail(`Session root does not exist: ${root}`);
  const allFiles = walk(root);
  const categories = {};
  let sessionBytes = 0;
  let sessionFileCount = 0;
  let artifactBytes = 0;
  let artifactFileCount = 0;
  for (const file of allFiles) {
    const kind = category(file.relativePath);
    categories[kind] ??= { bytes: 0, fileCount: 0 };
    categories[kind].bytes += file.bytes;
    categories[kind].fileCount += 1;
    if (kind === 'artifactPackage') {
      artifactBytes += file.bytes;
      artifactFileCount += 1;
    } else {
      sessionBytes += file.bytes;
      sessionFileCount += 1;
    }
  }
  // Legal actions are stored inside the public snapshot/diff payload rather
  // than in a separate directory. Keep that fact explicit in evidence so a
  // zero standalone bucket is not mistaken for an omitted measurement.
  categories.legalActionPayload = { bytes: 0, fileCount: 0, storage: 'embedded in publicPayloadPool snapshots/diffs' };
  return { root, sessionBytes, sessionFileCount, artifactBytes, artifactFileCount, categories };
}

function sessionIds(root) {
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'session.json'))).map((entry) => entry.name).sort();
}

function launcherCommand(launcher, args) {
  const root = dirname(launcher);
  // Windows cmd wrappers can buffer or keep an inherited console handle open
  // during a large query. The package's bundled runtime and CLI are the same
  // entry point, so invoke them directly for deterministic evidence capture.
  if (launcher.toLowerCase().endsWith('.cmd')) {
    return {
      command: join(root, 'runtime', 'node', 'node.exe'),
      args: [join(root, 'session-cli.mjs'), ...args],
      options: { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    };
  }
  return {
    command: launcher,
    args,
    options: { encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  };
}

function queryJson(launcher, args, label) {
  const invocation = launcherCommand(launcher, args);
  const result = spawnSync(invocation.command, invocation.args, invocation.options);
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit ${String(result.status)}: ${String(result.stderr).slice(0, 2000)}`);
  const stdout = result.stdout ?? '';
  let parsed;
  try { parsed = JSON.parse(stdout); } catch (error) { fail(`${label} did not return JSON: ${error instanceof Error ? error.message : String(error)}`); }
  return { parsed, stdout };
}

function compactMetrics(launcherOption, rootOption, sessionOption) {
  if (!launcherOption) return { available: false, reason: 'launcher not supplied' };
  const launcher = resolve(launcherOption);
  const root = resolve(rootOption);
  const session = sessionOption ?? sessionIds(root)[0];
  if (!session) return { available: false, reason: 'no Session directory found' };
  const { parsed, stdout } = queryJson(launcher, ['status', '--root', root, '--session', session], 'Compact status');
  return {
    available: true,
    launcher,
    session,
    revision: parsed.revision,
    bytes: Buffer.byteLength(stdout, 'utf8'),
    sha256: createHash('sha256').update(stdout, 'utf8').digest('hex'),
  };
}

function fullJsonMetrics(compact) {
  if (!compact.available) return { available: false, reason: compact.reason };
  const { parsed, stdout } = queryJson(compact.launcher, [
    'query',
    '--root', compact.sessionRoot,
    '--session', compact.session,
    '--target', 'full-snapshot',
    '--revision', String(compact.revision),
    '--page-size', '1',
  ], 'Full Snapshot query');
  if (parsed.ok !== true) fail('Full Snapshot query returned an unsuccessful result');
  return {
    available: true,
    launcher: compact.launcher,
    session: compact.session,
    revision: compact.revision,
    bytes: Buffer.byteLength(stdout, 'utf8'),
    sha256: createHash('sha256').update(stdout, 'utf8').digest('hex'),
    kind: parsed.kind ?? null,
    target: parsed.target ?? parsed.query?.target ?? 'full-snapshot',
  };
}

function main(argv = process.argv.slice(2)) {
  const packageOption = optionValue(argv, '--package');
  const sessionRootOption = optionValue(argv, '--session-root');
  const outputOption = optionValue(argv, '--out');
  if (!packageOption) fail('--package requires the assembled Player package directory');
  if (!sessionRootOption) fail('--session-root requires the representative Session root');
  if (!outputOption) fail('--out requires an evidence JSON path');
  const packageReport = packageMetrics(packageOption);
  const zip = optionalFileBytes(optionValue(argv, '--zip'), 'Package ZIP');
  const beforePackageOption = optionValue(argv, '--before-package');
  const beforeZip = optionalFileBytes(optionValue(argv, '--before-zip'), 'Before package ZIP');
  const beforePackage = beforePackageOption ? packageMetrics(beforePackageOption) : null;
  const compact = compactMetrics(optionValue(argv, '--launcher'), sessionRootOption, optionValue(argv, '--session'));
  if (compact.available) compact.sessionRoot = resolve(sessionRootOption);
  const report = {
    ok: true,
    measuredAtUtc: new Date().toISOString(),
    package: { ...packageReport, zipBytes: zip?.bytes ?? null, zipPath: zip?.path ?? null },
    before: beforePackage || beforeZip ? { package: beforePackage, zip: beforeZip } : null,
    comparison: beforePackage || beforeZip ? {
      expandedBytesDelta: beforePackage ? packageReport.expandedBytes - beforePackage.expandedBytes : null,
      fileCountDelta: beforePackage ? packageReport.fileCount - beforePackage.fileCount : null,
      zipBytesDelta: zip && beforeZip ? zip.bytes - beforeZip.bytes : null,
      threshold: 'informational; no size reduction pass/fail gate',
    } : null,
    session: sessionMetrics(sessionRootOption),
    compact: compact.available ? { ...compact, sessionRoot: undefined } : compact,
    fullJson: fullJsonMetrics(compact),
  };
  const output = resolve(outputOption);
  if (existsSync(output)) fail(`Refusing to overwrite evidence report: ${output}`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ok: true, output, expandedBytes: packageReport.expandedBytes, fileCount: packageReport.fileCount, zipBytes: zip?.bytes ?? null, sessionBytes: report.session.sessionBytes, compactBytes: report.compact.bytes ?? null, fullJsonBytes: report.fullJson.bytes ?? null })}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
