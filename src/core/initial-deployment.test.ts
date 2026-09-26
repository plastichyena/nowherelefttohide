import { describe, expect, it } from 'vitest';
import fixture from '../testing/fixtures/v155-initial-state.json';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';

describe('v1.6.1 deterministic full initial state', () => {
  for (const entry of fixture.fixtures) {
    it(`preserves every initial field, unit order and RNG draw for seed ${entry.seed}`, () => {
      const state = createInitialState(entry.seed, createDefaultConfig());
      const repeated = createInitialState(entry.seed, createDefaultConfig());
      expect(state.barbedWire).toEqual([]);
      expect(state.nextBarbedWireNumber).toBe(1);
      expect(state).toEqual(repeated);
      expect(state.gameVersion).toBe('17.0.0');
      expect(state.mapId).toBe('fixed-51x51-v9');
      expect(state.facilities.filter((facility) => facility.type === 'oilField')).toHaveLength(1);
      expect(state.rngState).toEqual(repeated.rngState);
    });
  }
});
