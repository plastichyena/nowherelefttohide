import { describe, expect, it } from 'vitest';
import { HUMAN_UNIT_TYPES, UNIT_CATALOG, UNIT_TYPES, WAVE_NON_HORDE_TYPES, isHumanUnitType, isUnitType, isZombieUnitType } from './unit-catalog';
import { createDefaultConfig, validateGameConfig } from './config';
import { createUnit } from './state';

describe('closed existing unit catalog', () => {
  it('preserves validation, production and weighted draw orders', () => {
    expect(UNIT_TYPES).toEqual(['police', 'nationalGuard', 'riotPolice', 'zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie']);
    expect(HUMAN_UNIT_TYPES).toEqual(['police', 'nationalGuard', 'riotPolice']);
    expect(WAVE_NON_HORDE_TYPES).toEqual(['zombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie']);
    const config = createDefaultConfig();
    for (const type of UNIT_TYPES) {
      const unit = createUnit({ config }, 'test', type, { q: 25, r: 25 });
      expect(unit.isPlayerUnit).toBe(isHumanUnitType(type));
      expect(isZombieUnitType(type)).toBe(!isHumanUnitType(type));
    }
    for (const type of HUMAN_UNIT_TYPES) expect(config.units[type].reanimationUnitType).toBe(UNIT_CATALOG[type].reanimation);
  });

  it('rejects unknown and inherited object keys instead of classifying them as humans', () => {
    for (const type of ['unknown', 'constructor', '__proto__', 'toString', null]) {
      expect(isUnitType(type)).toBe(false);
      expect(isHumanUnitType(type)).toBe(false);
      expect(isZombieUnitType(type)).toBe(false);
    }
    const config = createDefaultConfig();
    (config.units as unknown as Record<string, unknown>).unknown = { ...config.units.zombie };
    expect(validateGameConfig(config).errors).toContain('units.unknown is not a supported unit type');
  });
});
