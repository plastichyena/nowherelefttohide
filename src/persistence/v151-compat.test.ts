import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSaveCode } from './save';

const v151Fixture = readFileSync(
  new URL('../testing/fixtures/v151-standard.save.txt', import.meta.url),
  'utf8',
).trim();

describe('v1.5.4 Save Format 13 compatibility boundary', () => {
  it('rejects the real v1.5.1 Save Format 11 fixture without a conversion path', () => {
    const decoded = decodeSaveCode(v151Fixture);
    expect(decoded).toMatchObject({ valid: false, state: null, envelope: null });
    expect(decoded.errors.join(' ')).toMatch(/format version: 11|v1\.5\.3.*earlier|Game Rules 5\.0\.0/i);
  });
});
