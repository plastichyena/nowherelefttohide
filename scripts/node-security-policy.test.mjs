import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertSecureNodeVersion } from './node-security-policy.mjs';

test('portable rejects pre-security runtimes, EOL lines, prereleases and unassessed majors', () => {
  for (const version of ['v22.14.0', 'v22.23.3', 'v24.22.0', 'v26.12.0', 'v20.20.2', 'v25.9.0', 'v27.0.0', 'v22.23.4-rc.1', 'garbage']) {
    assert.throws(() => assertSecureNodeVersion(version), /Unsupported bundled Node/);
  }
});

test('portable accepts the security releases and later patches in assessed LTS lines', () => {
  for (const version of ['v22.23.4', 'v22.23.5', 'v22.24.0', 'v24.22.1', 'v26.12.1', 'v26.13.0']) {
    assert.doesNotThrow(() => assertSecureNodeVersion(version));
  }
  const pinned = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
  assert.doesNotThrow(() => assertSecureNodeVersion(pinned));
});
