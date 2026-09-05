import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState, createUnit } from './state';
import { createPublicUnitProjection } from './public-entities';

describe('shared public entity projections', () => {
  it('keeps configured Horde charges and experience thresholds without mutating State', () => {
    const config = createDefaultConfig();
    config.unitExperience.recruitSurvivalTurnsRequired = 7;
    const state = createInitialState(15201, config);
    const horde = createUnit(state, 'projection-horde', 'hordeZombie', { q: 25, r: 25 });
    const recruit = createUnit(state, 'projection-recruit', 'police', { q: 25, r: 25 }, 'ready', 'recruit');
    state.units.push(horde, recruit);
    const before = JSON.stringify(state);

    const hordeProjection = createPublicUnitProjection(horde, state);
    const recruitProjection = createPublicUnitProjection(recruit, state);

    expect(hordeProjection.maxAttackCharges).toBe(2);
    expect(hordeProjection.attackChargesRemaining).toBe(2);
    expect(recruitProjection.turnsUntilRegular).toBe(7);
    expect(JSON.stringify(state)).toBe(before);
  });
});
