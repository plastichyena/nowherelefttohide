import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openReplayJson } from './json-file';

function fixture(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'nlth-replay-json-')), 'replay.json');
  writeFileSync(path, text);
  return path;
}

describe('disk-backed replay JSON', () => {
  it('reads every observation across buffer boundaries without a whole-array string', () => {
    const observations = Array.from({ length: 100 }, (_, index) => ({ index, text: '日本語🙂[]{}\\\"'.repeat(200) }));
    const original = { seed: 3, observationTrace: observations, result: { won: false }, '__key': null };
    const file = openReplayJson(fixture(JSON.stringify(original)), 8192);
    try {
      const trace = file.value.observationTrace as unknown[];
      expect(Array.isArray(trace)).toBe(true);
      expect(trace.length).toBe(100);
      expect(trace.some(value => value === undefined)).toBe(false);
      expect(trace[99]).toEqual(observations[99]);
      expect(trace[0]).toEqual(observations[0]);
      expect(JSON.parse(JSON.stringify(file.value))).toEqual(original);
    } finally { file.close(); }
    expect(() => (file.value.observationTrace as unknown[])[0]).toThrow(/closed/);
  });
  it.each(['{}', '{"observationTrace":[]}', '{"observationTrace":null}', '{"__proto__":{"x":1}}'])('matches JSON.parse for %s', input => {
    const file = openReplayJson(fixture(input));
    try { expect(file.value).toEqual(JSON.parse(input)); }
    finally { file.close(); }
  });
  it.each(['{"observationTrace":[{},]}', '{"observationTrace":[{}', '{"a":1,}', '{"a":"unterminated}', '{"a":[}}', '{} trailing', '{"a":1,"a":2}'])('rejects malformed structure: %s', input => {
    expect(() => openReplayJson(fixture(input))).toThrow();
  });
  it('checks invalid JSON inside lazy elements when they are consumed', () => {
    const file = openReplayJson(fixture('{"observationTrace":[{"a":}]}'));
    try { expect(() => (file.value.observationTrace as unknown[])[0]).toThrow(); }
    finally { file.close(); }
  });
  it('limits individual values without limiting the total history', () => {
    expect(() => openReplayJson(fixture('{"other":"' + 'x'.repeat(100) + '"}'), 50)).toThrow(/exceeds/);
  });
});
