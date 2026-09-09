import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../testing/fixtures/v155-initial-state.json';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';

describe('v1.5.5 deterministic full initial-state fixture', () => {
  for (const entry of fixture.fixtures) {
    it(`preserves every initial field, unit order and RNG draw for seed ${entry.seed}`, () => {
      const state = createInitialState(entry.seed, createDefaultConfig());
      expect(state.barbedWire).toEqual([]);
      expect(state.nextBarbedWireNumber).toBe(1);
      const { barbedWire, nextBarbedWireNumber, ...previousShape } = state;
      previousShape.gameVersion = '7.0.0';
      previousShape.config.version = '7.0.0';
      expect(createHash('sha256').update(JSON.stringify(previousShape)).digest('hex')).toBe(entry.sha256);
    });
  }
});
