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
  BOARD_MIN_ZOOM,
  BOARD_MAX_ZOOM,
  boardTextureKey,
  checkpointCandidateMarkerStyle,
  classifyBoardAssetFailure,
  constructibleCandidateMarkerStyle,
  hordeWarningTileKeys,
  projectWorldToScreen,
  roadTextureRotations,
  spawnReserveTileKeys,
  supplyBoundaryEdges,
  visionOverlayState,
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

  it('uses the v1.4.4 mobile camera bounds', () => {
    expect(BOARD_MIN_ZOOM).toBe(0.35);
    expect(BOARD_MAX_ZOOM).toBe(2.2);
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

  it('projects world coordinates using the current camera viewport, scroll, and zoom', () => {
    expect(projectWorldToScreen(
      { x: 240, y: 180 },
      { x: 8, y: 12, width: 320, height: 240, scrollX: 100, scrollY: 60, zoom: 1.5 },
    )).toEqual({ x: 138, y: 132 });
  });

  it('rejects unusable camera projection values', () => {
    expect(projectWorldToScreen(
      { x: 10, y: 20 },
      { x: 0, y: 0, width: 320, height: 240, scrollX: 0, scrollY: 0, zoom: 0 },
    )).toBeNull();
    expect(projectWorldToScreen(
      { x: Number.NaN, y: 20 },
      { x: 0, y: 0, width: 320, height: 240, scrollX: 0, scrollY: 0, zoom: 1 },
    )).toBeNull();
  });

  it.each(['east', 'west', 'north', 'south'] as const)('limits a %s Horde warning to its road branch', (direction) => {
    const map = createFixedMap();
    const branch = map.roadBranches.find((candidate) => candidate.direction === direction)!;
    const oppositeDirection = { east: 'west', west: 'east', north: 'south', south: 'north' }[direction];
    const oppositeBranch = map.roadBranches.find((candidate) => candidate.direction === oppositeDirection)!;
    const keys = hordeWarningTileKeys(map, [direction]);

    expect(keys).toContain(`${branch.entrance.q},${branch.entrance.r}`);
    expect(keys).not.toContain(`${branch.capitalConnection.q},${branch.capitalConnection.r}`);
    expect(keys).not.toContain(`${oppositeBranch.entrance.q},${oppositeBranch.entrance.r}`);
  });

  it('combines multiple warned Horde branches without leaking the capital tile', () => {
    const map = createFixedMap();
    const directions = ['north', 'east'] as const;
    const keys = hordeWarningTileKeys(map, directions);
    const north = map.roadBranches.find((candidate) => candidate.direction === 'north')!;
    const east = map.roadBranches.find((candidate) => candidate.direction === 'east')!;
    expect(keys).toEqual(expect.arrayContaining([
      `${north.entrance.q},${north.entrance.r}`,
      `${east.entrance.q},${east.entrance.r}`,
    ]));
    expect(keys).not.toContain(`${north.capitalConnection.q},${north.capitalConnection.r}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exposes exactly the fixed outer Spawn Reserve tiles', () => {
    const map = createFixedMap();
    const reserve = spawnReserveTileKeys(map);
    expect(reserve).toHaveLength(200);
    expect(new Set(reserve).size).toBe(200);
    expect(map.tiles.filter((tile) => tile.playerOccupancyAllowed === false).map((tile) => tile.key)).toEqual(reserve);
  });

  it('derives Supply outlines only from supplied-to-unsupplied edges', () => {
    const edges = supplyBoundaryEdges(createFixedMap(), new Set(['7,7']));

    expect(edges).toHaveLength(6);
    expect(new Set(edges.map((edge) => edge.tileKey))).toEqual(new Set(['7,7']));
  });

  it('distinguishes legal and invalid checkpoint candidates by symbol and line styling', () => {
    const legal = checkpointCandidateMarkerStyle(true, false);
    const invalid = checkpointCandidateMarkerStyle(false, false);
    const selectedInvalid = checkpointCandidateMarkerStyle(false, true);
    expect(legal.symbol).toBe('✓');
    expect(invalid.symbol).toBe('×');
    expect(invalid.color).not.toBe(legal.color);
    expect(invalid.lineWidth).not.toBe(legal.lineWidth);
    expect(selectedInvalid.lineWidth).toBeGreaterThan(invalid.lineWidth);
  });

  it('distinguishes legal and invalid constructible candidates by symbol and line styling', () => {
    const legal = constructibleCandidateMarkerStyle(true, false);
    const invalid = constructibleCandidateMarkerStyle(false, false);
    const selectedInvalid = constructibleCandidateMarkerStyle(false, true);
    expect(legal.symbol).toBe('＋');
    expect(invalid.symbol).toBe('×');
    expect(invalid.color).not.toBe(legal.color);
    expect(invalid.lineWidth).not.toBe(legal.lineWidth);
    expect(selectedInvalid.lineWidth).toBeGreaterThan(invalid.lineWidth);
  });

  it('does not draw the shared edge between adjacent supplied Hexes', () => {
    const edges = supplyBoundaryEdges(createFixedMap(), new Set(['7,7', '8,7']));

    expect(edges).toHaveLength(10);
    expect(edges).not.toContainEqual({ tileKey: '7,7', direction: 'east' });
    expect(edges).not.toContainEqual({ tileKey: '8,7', direction: 'west' });
  });

  it('classifies Core Ground and Aerial vision overlays without deriving LOS', () => {
    const ground = {
      origin: { q: 0, r: 0 },
      radius: 5,
      visionMode: 'ground' as const,
      terrainLosBlocking: true,
      visibleTileKeys: new Set(['1,1']),
      potentialTileKeys: new Set(['1,1', '2,2']),
      blockedTileKeys: new Set(['2,2']),
    };
    expect(visionOverlayState(ground, '1,1')).toBe('ground-visible');
    expect(visionOverlayState(ground, '2,2')).toBe('ground-blocked');
    expect(visionOverlayState(ground, '3,3')).toBe('none');

    const aerial = {
      ...ground,
      visionMode: 'aerial' as const,
      terrainLosBlocking: false,
      visibleTileKeys: new Set(['2,2']),
      potentialTileKeys: new Set(['2,2']),
      blockedTileKeys: new Set<string>(),
    };
    expect(visionOverlayState(aerial, '2,2')).toBe('aerial-visible');
    expect(visionOverlayState(aerial, '1,1')).toBe('none');
  });
});
