import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateSourceRun(run, jobs, repository) {
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || run.path !== '.github/workflows/v140-release-validation.yml'
    || run.event !== 'workflow_dispatch' || run.status !== 'completed'
    || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) throw new Error('Source must be a completed release run from this repository');
  const expected = ['Session v1.5.6 physical 512 MiB Package validation'];
  for (const agent of ['random', 'balanced']) {
    for (let start = 1; start <= 91; start += 10) expected.push(`v1.5.6 ${agent} seeds ${start} + 9`);
  }
  for (const name of expected) {
    const matching = jobs.filter(job => job.name === name);
    if (matching.length !== 1 || matching[0].conclusion !== 'success') throw new Error(`Source validation did not succeed: ${name}`);
  }
  return { sourceRunId: run.id, sourceCommit: run.head_sha, sourceUrl: run.html_url, validatedJobs: expected.length };
}

export function validateSourceArtifacts(root, receipt) {
  const reportsRoot = join(root, 'reports');
  const reports = readdirSync(reportsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (reports.length !== 20) throw new Error('Source must contain all 20 report artifacts');
  for (const entry of reports) {
    const report = JSON.parse(readFileSync(join(reportsRoot, entry.name, 'run.json'), 'utf8'));
    if (report.execution?.buildId !== receipt.sourceCommit) throw new Error(`Source build mismatch: ${entry.name}`);
  }
  const session = JSON.parse(readFileSync(join(root, 'session', 'large-512.json'), 'utf8'));
  const viewer = JSON.parse(readFileSync(join(root, 'session', 'large-512-viewer.json'), 'utf8'));
  const atLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
  if (session.ok !== true || session.execution?.physicalArtifactPackageTargetReached !== true
    || !atLeast(session.execution?.executedDecisions, 1000) || !atLeast(session.artifact?.bytes, 512 * 1024 * 1024)
    || session.artifact?.readMatched !== true || session.artifact?.replayMatched !== true
    || viewer.ok !== true || viewer.cancelled !== true || !atLeast(viewer.zipBytes, 512 * 1024 * 1024)) {
    throw new Error('Source large Session or ZIP viewer evidence is incomplete');
  }
  return { sessionDecisions: session.execution.executedDecisions, packageBytes: session.artifact.bytes, zipBytes: viewer.zipBytes };
}

function main([mode, input]) {
  const root = resolve('output/release-reuse');
  if (mode === 'source' && /^[1-9][0-9]*$/.test(input ?? '')) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) throw new Error('GITHUB_REPOSITORY is required');
    const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${path}`], { encoding: 'utf8' }));
    const run = api(`actions/runs/${input}`);
    const jobs = api(`actions/runs/${input}/jobs?per_page=100`).jobs;
    const receipt = validateSourceRun(run, jobs, repository);
    // Reuse only when game/runtime/dependencies and the large-package probes
    // are unchanged. Documentation and report-verifier fixes can reuse the
    // expensive, already successful executions with explicit provenance.
    const diff = paths => execFileSync('git', ['diff', '--name-only', receipt.sourceCommit, 'HEAD', '--', ...paths], { encoding: 'utf8' }).trim();
    const changed = [diff([
      'src', ':(exclude)src/testing', 'public', 'package.json', 'package-lock.json',
      'scripts/build-portable.mjs', 'vite.config.ts',
    ]), diff(['src/testing/session-release-validation.ts', 'src/testing/session-*.ts', 'src/testing/v155-replay-validation.ts'])].filter(Boolean).join('\n');
    if (changed) throw new Error(`Runtime or endurance probe changed; run fresh validation:\n${changed}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'source.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt));
  } else if (mode === 'artifacts') {
    const receiptPath = join(root, 'source.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const evidence = validateSourceArtifacts(root, receipt);
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, ...evidence }, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } else throw new Error('Usage: verify-release-reuse.mjs source <run-id> | artifacts');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
