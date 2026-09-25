import { expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { ArtifactSource, ArtifactWriter } from './artifact-io';
import { SessionStore } from './store';
import { SessionService } from './service';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';

it('exports ZIP only, keeps directory only explicitly, and replays a detached branch without its Store', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-v166-artifact-'));
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v166-artifact-test' });
  const service = new SessionService(new SessionStore(join(root, 'store')), createAgentSessionGameFactory(identity.buildId), identity);
  service.newSession({ sessionId: 'root', seed: 3 });
  service.step('root', { action: { type: 'Wait', unitId: 'missing' }, decisionSummary: 'Rejected: 日本語' });
  const checkpoint = service.saveCheckpoint('root'); service.loadCheckpoint('root', checkpoint.checkpointId, 'child');
  const output = join(root, 'out');
  const result = service.exportArtifact('child', join(output, 'branch.zip'));
  expect(readdirSync(output)).toEqual(['branch.zip']);
  expect(result).toMatchObject({ artifactPath: join(output, 'branch.zip'), replayZipPath: join(output, 'branch.zip'), artifactDirectoryPath: null });
  const zip = new ArtifactSource(result.artifactPath);
  const manifest = JSON.parse(zip.read('manifest.json', 1024 * 1024).toString());
  expect(manifest).not.toHaveProperty('artifactPath'); zip.close();
  const detached = mkdtempSync(join(tmpdir(), 'nlth-v166-detached-')); const path = join(detached, 'renamed.zip'); cpSync(result.artifactPath, path);
  const reader = new SessionService(new SessionStore(join(detached, 'empty-store')), createAgentSessionGameFactory(identity.buildId), identity);
  expect(reader.readArtifact(path).lineage.parentSessionId).toBe('root');
  expect(reader.replayArtifact(path)).toMatchObject({ matched: true, decisionCount: 1 });
  const both = service.exportArtifact('child', join(output, 'both'), { keepDirectory: true });
  expect(both.artifactDirectoryPath).toBe(join(output, 'both'));
  expect(service.readArtifact(both.artifactDirectoryPath!).manifestHash).toBe(result.manifestHash);
  expect(service.readArtifact(both.artifactPath).manifestHash).toBe(result.manifestHash);
  const before = readFileSync(result.artifactPath);
  expect(() => service.exportArtifact('child', result.artifactPath)).toThrow(/overwrite/);
  expect(readFileSync(result.artifactPath)).toEqual(before);
  const aborted = new AbortController(); aborted.abort();
  expect(() => reader.readArtifact(path, { signal: aborted.signal })).toThrow();
  const failed = join(output, 'cancelled.zip');
  expect(() => service.exportArtifact('child', failed, { signal: aborted.signal })).toThrow(/not finalized.*partial/);
  expect(existsSync(failed)).toBe(false); expect(existsSync(`${failed}.partial`)).toBe(true);
}, 120000);

it.each(['../escape', '/absolute', 'https://external.test/payload', 'a\\b', 'a/../b'])('rejects unsafe ZIP entry %s without extracting it', name => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-v166-badzip-')); const path = join(root, 'bad.zip');
  writeFileSync(path, zipSync({ [name]: new Uint8Array([1]) }, { level: 0 }));
  expect(() => new ArtifactSource(path)).toThrow(/Unsafe/);
});
it('keeps a failed write partial and refuses to overwrite it on retry', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-v166-partial-')); const path = join(root, 'test.zip');
  const writer = new ArtifactWriter(path, null);
  function *broken() { yield new Uint8Array([1, 2]); throw new Error('simulated source read error'); }
  expect(() => writer.add('artifact.ndjson', broken())).toThrow('simulated source read error'); writer.close();
  expect(existsSync(path)).toBe(false); expect(() => new ArtifactSource(`${path}.partial`)).toThrow();
  expect(() => new ArtifactWriter(path, null)).toThrow(/overwrite/);
});
