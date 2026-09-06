import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../testing/fixtures/v153-initial-state.json';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';

describe('v1.5.3 deterministic full initial-state fixture', () => {
  for (const entry of fixture.fixtures) {
    it(`preserves every initial field, unit order and RNG draw for seed ${entry.seed}`, () => {
      const state = createInitialState(entry.seed, createDefaultConfig());
      expect(createHash('sha256').update(JSON.stringify(state)).digest('hex')).toBe(entry.sha256);
    });
  }
});
