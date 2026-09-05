import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../testing/fixtures/v151-initial-state.json';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';

describe('v1.5.1 full initial-state compatibility', () => {
  for (const entry of fixture.fixtures) {
    it(`preserves every initial field, unit order and RNG draw for seed ${entry.seed}`, () => {
      const state = createInitialState(entry.seed, createDefaultConfig());
      expect(createHash('sha256').update(JSON.stringify(state)).digest('hex')).toBe(entry.sha256);
    });
  }
});
