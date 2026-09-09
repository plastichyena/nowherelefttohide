import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateSourceArtifacts, validateSourceRun } from './verify-release-reuse.mjs';

const repository = 'owner/game';
const sha = 'a'.repeat(40);
function source() {
  const run = { id: 123, repository: { full_name: repository }, head_repository: { full_name: repository },
    path: '.github/workflows/v140-release-validation.yml', event: 'workflow_dispatch', status: 'completed', head_sha: sha };
  const jobs = [{ name: 'Session v1.5.5 physical 512 MiB Package validation', conclusion: 'success' }];
  for (const agent of ['random', 'balanced']) for (let start = 1; start <= 91; start += 10) {
    jobs.push({ name: `v1.5.5 ${agent} seeds ${start} + 9`, conclusion: 'success' });
  }
  return { run, jobs };
}

test('requires every original execution to succeed, even when the report gate failed', () => {
  const { run, jobs } = source();
  jobs.push({ name: 'old report gate', conclusion: 'failure' });
  assert.equal(validateSourceRun(run, jobs, repository).validatedJobs, 21);
  for (let index = 0; index < 21; index += 1) {
    const changed = structuredClone(jobs); changed[index].conclusion = 'failure';
    assert.throws(() => validateSourceRun(run, changed, repository), /did not succeed/);
  }
  assert.throws(() => validateSourceRun(run, jobs.slice(1), repository), /did not succeed/);
  assert.throws(() => validateSourceRun(run, [...jobs, jobs[0]], repository), /did not succeed/);
});

test('rejects unfinished, foreign-repository, and unrelated-workflow evidence', () => {
  const { run, jobs } = source();
  for (const patch of [{ status: 'in_progress' }, { event: 'push' }, { head_sha: 'invalid' },
    { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'fork/game' } }]) {
    assert.throws(() => validateSourceRun({ ...run, ...patch }, jobs, repository), /completed release run/);
  }
});

test('requires matching builds and complete physical Session and viewer evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-release-reuse-'));
  const write = (path, data) => writeFileSync(path, JSON.stringify(data));
  mkdirSync(join(root, 'reports'));
  mkdirSync(join(root, 'session'));
  for (let index = 0; index < 20; index += 1) {
    mkdirSync(join(root, 'reports', String(index)));
    write(join(root, 'reports', String(index), 'run.json'), { execution: { buildId: sha } });
  }
  const session = { ok: true, execution: { physicalArtifactPackageTargetReached: true, executedDecisions: 2000 },
    artifact: { bytes: 790000000, readMatched: true, replayMatched: true } };
  const viewer = { ok: true, cancelled: true, zipBytes: 791000000 };
  const sessionPath = join(root, 'session', 'large-512.json');
  const viewerPath = join(root, 'session', 'large-512-viewer.json');
  write(sessionPath, session); write(viewerPath, viewer);
  assert.equal(validateSourceArtifacts(root, { sourceCommit: sha }).sessionDecisions, 2000);
  write(join(root, 'reports', '0', 'run.json'), { execution: { buildId: 'b'.repeat(40) } });
  assert.throws(() => validateSourceArtifacts(root, { sourceCommit: sha }), /build mismatch/);
  write(join(root, 'reports', '0', 'run.json'), { execution: { buildId: sha } });
  for (const bad of [undefined, 0, 100, null]) {
    write(sessionPath, { ...session, artifact: { ...session.artifact, bytes: bad } });
    assert.throws(() => validateSourceArtifacts(root, { sourceCommit: sha }), /incomplete/);
  }
  write(sessionPath, session);
  write(viewerPath, { ...viewer, cancelled: false });
  assert.throws(() => validateSourceArtifacts(root, { sourceCommit: sha }), /incomplete/);
});
