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
  hordeWarningTileKeys,
  roadTextureRotations,
  supplyBoundaryEdges,
} from './board';
import { createFixedMap } from '../core/map';

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

  it.each([
    ['east', '14,7', '0,7'],
    ['west', '0,7', '14,7'],
    ['north', '7,0', '7,14'],
    ['south', '7,14', '7,0'],
  ] as const)('limits a %s Horde warning to its road branch', (direction, entrance, opposite) => {
    const keys = hordeWarningTileKeys(createFixedMap(), direction);

    expect(keys).toContain(entrance);
    expect(keys).not.toContain('7,7');
    expect(keys).not.toContain(opposite);
  });

  it('derives Supply outlines only from supplied-to-unsupplied edges', () => {
    const edges = supplyBoundaryEdges(createFixedMap(), new Set(['7,7']));

    expect(edges).toHaveLength(6);
    expect(new Set(edges.map((edge) => edge.tileKey))).toEqual(new Set(['7,7']));
  });

  it('does not draw the shared edge between adjacent supplied Hexes', () => {
    const edges = supplyBoundaryEdges(createFixedMap(), new Set(['7,7', '8,7']));

    expect(edges).toHaveLength(10);
    expect(edges).not.toContainEqual({ tileKey: '7,7', direction: 'east' });
    expect(edges).not.toContainEqual({ tileKey: '8,7', direction: 'west' });
  });
});
