import { describe, expect, it, vi } from 'vitest';

// The controller imports the Phaser adapter, but these view-model helpers are
// intentionally testable without constructing a browser canvas.
vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {},
    Game: class Game {},
  },
}));

import { loadValidationError, phaseIndicatorViewModel } from './controller';

describe('controller view models', () => {
  it('keeps the raw phase in metadata while exposing a localized label separately', () => {
    expect(phaseIndicatorViewModel('player', 'ja')).toEqual({
      phase: 'player',
      shortLabel: '行動',
      label: 'フェーズ: 行動',
    });
    expect(phaseIndicatorViewModel('zombie', 'en')).toEqual({
      phase: 'zombie',
      shortLabel: 'Zombies',
      label: 'Phase: Zombies',
    });
    expect(phaseIndicatorViewModel('player', 'ja').label).not.toBe('player');
  });

  it('selects the first validation error and falls back only when no detail exists', () => {
    expect(loadValidationError({ valid: true, errors: [] }, 'Load failed')).toBeNull();
    expect(loadValidationError({ valid: false, errors: ['checksum mismatch'] }, 'Load failed')).toBe('checksum mismatch');
    expect(loadValidationError({ valid: false, errors: [] }, 'Load failed')).toBe('Load failed');
  });
});
