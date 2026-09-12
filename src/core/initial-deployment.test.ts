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
      // Normalize only approved v1.5.7 additions; retain deployment and RNG regression.
      previousShape.config.units.hordeZombie.maxAttackCharges = 2;
      for (const key of ['barbedWireBuilt', 'barbedWireDestroyed', 'barbedWireDamageTaken', 'barbedWireAbsorbedDamage', 'barbedWireEmptyAttackCharges', 'barbedWireOccupiedAttackCharges']) delete (previousShape.statistics as unknown as Record<string, unknown>)[key];
      previousShape.gameVersion = '7.0.0';
      previousShape.config.version = '7.0.0';
      expect(createHash('sha256').update(JSON.stringify(previousShape)).digest('hex')).toBe(entry.sha256);
    });
  }
});
