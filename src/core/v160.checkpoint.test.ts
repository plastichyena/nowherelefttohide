import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { checkpointBonusValue } from './public-entities';

describe('v1.6 checkpoint bonus display source', () => {
  it('uses Core config in the normal projection and 25 in the missing legacy fallback', () => {
    const config = createDefaultConfig();
    expect(checkpointBonusValue(config.checkpoint.checkpointBonus)).toBe(25);
    expect(checkpointBonusValue(undefined)).toBe(25);
    expect(checkpointBonusValue(null)).toBe(25);
  });
});
