import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    Scene: class Scene {},
    Game: class Game {},
    Scale: { RESIZE: 0, CENTER_BOTH: 0 },
    Math: {
      DegToRad: (degrees: number) => degrees * Math.PI / 180,
      Clamp: (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value)),
    },
  },
}));

import {
  BOARD_RENDER_LAYER_ORDER,
  boardTextureKey,
  classifyBoardAssetFailure,
  roadTextureRotations,
} from './board';

describe('Phaser board asset boundary helpers', () => {
  it('keeps the required visual layer order explicit', () => {
    expect(BOARD_RENDER_LAYER_ORDER).toEqual([
      'terrain',
      'road',
      'urban',
      'facility-base',
      'facility-state',
      'fog',
      'unit',
      'dynamic',
    ]);
  });

  it('classifies independent asset failures for per-file fallback', () => {
    expect(classifyBoardAssetFailure({ status: 404 })).toBe('missing');
    expect(classifyBoardAssetFailure(new Error('image decoding failed'))).toBe('decode');
    expect(classifyBoardAssetFailure(new Error('texture registration failed'))).toBe('texture-registration');
    expect(classifyBoardAssetFailure(new Error('network unavailable'))).toBe('load');
  });

  it('uses stable, distinct texture keys and one rotation per road axis', () => {
    expect(boardTextureKey('units/unit_police.png')).toBe('board:units_unit_police_png');
    expect(boardTextureKey('units/unit_police.png')).not.toBe(boardTextureKey('units/unit_zombie.png'));
    expect(roadTextureRotations(['east', 'west'])).toHaveLength(1);
    expect(roadTextureRotations(['east', 'northEast', 'west', 'southWest'])).toHaveLength(2);
  });
});
