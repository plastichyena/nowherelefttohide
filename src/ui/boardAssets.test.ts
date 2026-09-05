import { describe, expect, it } from 'vitest';
import {
  ASSET_REGISTRY,
  BOARD_ASSET_PATHS,
  BOARD_ASSET_REGISTRY,
  BOARD_CHECKPOINT_OVERLAYS,
  BOARD_COMMON_OVERLAYS,
  BOARD_FACILITY_OVERLAYS,
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  BOARD_LOD_ZOOM_THRESHOLD,
  BOARD_UNIT_OVERLAYS,
  boardLodMode,
  deriveRoadConnectionDirections,
  getFacilityAssetPath,
  getFacilityUnitOffset,
  getTerrainAssetPath,
  getUnitAssetPath,
  isBoardZombieUnitType,
  mapCheckpointAssetLayers,
  mapFacilityAssetLayers,
  mapTerrainAsset,
  mapUnitAssetLayers,
  resolveBoardAssetUrl,
  roadConnectionMask,
  shouldUseBoardLod,
} from './boardAssets';

describe('board asset registry', () => {
  it('covers the required terrain, facilities, and unit mappings without water', () => {
    expect(Object.keys(BOARD_ASSET_REGISTRY.terrain)).toEqual(['plain', 'forest', 'mountain']);
    expect(Object.keys(BOARD_ASSET_REGISTRY.facilities)).toEqual([
      'capital',
      'city',
      'farm',
      'civilianFactory',
      'militaryFactory',
      'refinery',
      'powerPlant',
      'windPowerPlant',
      'simpleFarm',
      'civilianDroneBase',
      'checkpoint',
    ]);
    expect(Object.keys(BOARD_ASSET_REGISTRY.units)).toEqual([
      'police',
      'nationalGuard',
      'zombie',
      'hordeZombie',
      'policeZombie',
      'soldierZombie',
      'riotPolice',
      'riotZombie',
      'hunterZombie',
    ]);
    expect('water' in BOARD_ASSET_REGISTRY.terrain).toBe(false);
    expect(getTerrainAssetPath('water')).toBeNull();
    expect(mapTerrainAsset('water')).toEqual({ key: 'water', path: null, fallback: true });
    expect(getFacilityAssetPath('not-a-facility')).toBeNull();
    expect(getUnitAssetPath('not-a-unit')).toBeNull();
    expect(getUnitAssetPath('policeZombie')).toBe(BOARD_ASSET_REGISTRY.units.policeZombie);
    expect(getUnitAssetPath('soldierZombie')).toBe(BOARD_ASSET_REGISTRY.units.soldierZombie);
    expect(getUnitAssetPath('riotPolice')).toBe(BOARD_ASSET_REGISTRY.units.riotPolice);
    expect(getUnitAssetPath('riotZombie')).toBe(BOARD_ASSET_REGISTRY.units.riotZombie);
    expect(getUnitAssetPath('hunterZombie')).toBe(BOARD_ASSET_REGISTRY.units.hunterZombie);
    expect(isBoardZombieUnitType('zombie')).toBe(true);
    expect(isBoardZombieUnitType('hordeZombie')).toBe(true);
    expect(isBoardZombieUnitType('policeZombie')).toBe(true);
    expect(isBoardZombieUnitType('soldierZombie')).toBe(true);
    expect(isBoardZombieUnitType('riotZombie')).toBe(true);
    expect(isBoardZombieUnitType('hunterZombie')).toBe(true);
    expect(isBoardZombieUnitType('police')).toBe(false);
    expect(BOARD_ASSET_PATHS.some((path) => /water/iu.test(path))).toBe(false);
  });

  it('keeps Board and Board Legend on the exact same registry object', () => {
    expect(ASSET_REGISTRY).toBe(BOARD_ASSET_REGISTRY);
    expect(BOARD_FACILITY_OVERLAYS.secured).toBe(BOARD_ASSET_REGISTRY.overlays.secured);
    expect(BOARD_CHECKPOINT_OVERLAYS.operational).toBe(BOARD_ASSET_REGISTRY.overlays.checkpointOperational);
    expect(BOARD_UNIT_OVERLAYS.final).toBe(BOARD_ASSET_REGISTRY.overlays.final);
    expect(BOARD_COMMON_OVERLAYS.infected).toBe(BOARD_ASSET_REGISTRY.overlays.infected);
    expect(BOARD_COMMON_OVERLAYS.ruined).toBe(BOARD_ASSET_REGISTRY.overlays.ruined);
  });

  it('resolves deployment BASE_URL and cache-busts by app/build version', () => {
    expect(resolveBoardAssetUrl('terrain/terrain_plain.png', {
      baseUrl: '/nowhere-left-to-hide/',
      appVersion: '1.3.1',
      buildId: 'abc123',
    })).toBe('/nowhere-left-to-hide/assets/board/terrain/terrain_plain.png?v=1.3.1&b=abc123');
    expect(resolveBoardAssetUrl('/terrain/terrain_plain.png', {
      baseUrl: './',
      appVersion: '1.3.1',
      buildId: null,
    })).toBe('./assets/board/terrain/terrain_plain.png?v=1.3.1');
  });
});

describe('board state asset mappings', () => {
  it('composes independent general-facility state layers', () => {
    const securedStopped = mapFacilityAssetLayers({
      type: 'farm',
      owner: 'player',
      status: 'owned',
      operationalStatus: 'stopped',
      infected: 0,
    });
    expect(securedStopped.layers).toEqual(['secured', 'stopped']);
    expect(securedStopped.overlays).toEqual([
      BOARD_ASSET_REGISTRY.overlays.secured,
      BOARD_ASSET_REGISTRY.overlays.stopped,
    ]);

    const unsecuredInfected = mapFacilityAssetLayers({
      type: 'city',
      owner: 'none',
      status: 'unowned',
      operationalStatus: 'infected',
      infected: 4,
    });
    expect(unsecuredInfected.layers).toEqual(['unsecured', 'infected']);
    expect(unsecuredInfected.overlays.at(-1)).toBe(BOARD_ASSET_REGISTRY.overlays.infected);

    const ruinedInfected = mapFacilityAssetLayers({
      type: 'militaryFactory',
      owner: 'none',
      status: 'ruined',
      operationalStatus: 'ruined',
      infected: 2,
    });
    expect(ruinedInfected.layers).toEqual(['infected', 'ruined']);
    expect(ruinedInfected.overlays).toEqual([
      BOARD_ASSET_REGISTRY.overlays.infected,
      BOARD_ASSET_REGISTRY.overlays.ruined,
    ]);
    expect(ruinedInfected.forecastStopped).toBe(false);
  });

  it('keeps forecast stop separate from current stopped state', () => {
    const mapping = mapFacilityAssetLayers({
      type: 'farm',
      owner: 'player',
      status: 'owned',
      operationalStatus: 'operational',
      infected: 0,
    }, { forecastStopped: true });
    expect(mapping.layers).toEqual(['secured']);
    expect(mapping.forecastStopped).toBe(true);
    expect(mapping.forecastOverlay).toBeNull();
  });

  it('uses the shared infected/ruined paths for general facilities and checkpoints', () => {
    const facility = mapFacilityAssetLayers({
      type: 'capital',
      owner: 'none',
      status: 'ruined',
      operationalStatus: 'ruined',
      infected: 1,
    });
    const checkpoint = mapCheckpointAssetLayers({ status: 'ruined', infected: 1 });
    expect(facility.overlays).toContain(BOARD_COMMON_OVERLAYS.infected);
    expect(facility.overlays).toContain(BOARD_COMMON_OVERLAYS.ruined);
    expect(checkpoint.overlays).toEqual([
      BOARD_COMMON_OVERLAYS.ruined,
      BOARD_COMMON_OVERLAYS.infected,
    ]);
    expect(BOARD_ASSET_REGISTRY.overlays.infected).toBe(BOARD_COMMON_OVERLAYS.infected);
    expect(BOARD_ASSET_REGISTRY.overlays.ruined).toBe(BOARD_COMMON_OVERLAYS.ruined);
  });

  it('maps every checkpoint lifecycle and composes infection independently', () => {
    for (const status of ['operational', 'abandoned', 'remnant'] as const) {
      const mapping = mapCheckpointAssetLayers({ status, infected: 0 });
      expect(mapping.lifecycle).toBe(status);
      expect(mapping.layers).toEqual([status]);
      expect(mapping.base).toBe(BOARD_ASSET_REGISTRY.facilities.checkpoint);
    }
    expect(mapCheckpointAssetLayers({ status: 'operational', infected: 3 }).layers).toEqual([
      'operational',
      'infected',
    ]);
    expect(mapCheckpointAssetLayers({ status: 'abandoned', infected: 2 }).layers).toEqual([
      'abandoned',
      'infected',
    ]);
    expect(mapCheckpointAssetLayers({ status: 'remnant', infected: 1 }).layers).toEqual([
      'remnant',
      'infected',
    ]);
  });

  it('maps regular, periodic, and final units with distinct Horde layers', () => {
    expect(mapUnitAssetLayers({ type: 'police', hordeKind: null }).layers).toEqual([]);
    expect(mapUnitAssetLayers({ type: 'zombie', hordeKind: null }).layers).toEqual([]);
    expect(mapUnitAssetLayers({ type: 'zombie', hordeKind: 'periodic' })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.zombie,
      layers: ['horde'],
      isHorde: true,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'zombie', hordeKind: 'final' })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.zombie,
      layers: ['horde', 'final'],
      overlays: [BOARD_UNIT_OVERLAYS.horde, BOARD_UNIT_OVERLAYS.final],
      isFinalHorde: true,
    });
    expect(mapUnitAssetLayers({ type: 'hordeZombie', hordeKind: 'periodic' })).toMatchObject({
      layers: ['horde'],
      isHorde: true,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'hordeZombie', hordeKind: 'final' })).toMatchObject({
      layers: ['horde', 'final'],
      overlays: [BOARD_UNIT_OVERLAYS.horde, BOARD_UNIT_OVERLAYS.final],
      isHorde: true,
      isFinalHorde: true,
    });
    expect(mapUnitAssetLayers({ type: 'policeZombie', hordeKind: null })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.policeZombie,
      layers: [],
      isHorde: false,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'soldierZombie', hordeKind: null })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.soldierZombie,
      layers: [],
      isHorde: false,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'soldierZombie', hordeKind: 'final' })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.soldierZombie,
      layers: ['horde', 'final'],
      isHorde: true,
      isFinalHorde: true,
    });
    expect(mapUnitAssetLayers({ type: 'riotPolice', hordeKind: null })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.riotPolice,
      layers: [],
      isHorde: false,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'riotZombie', hordeKind: null })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.riotZombie,
      layers: [],
      isHorde: false,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'hunterZombie', hordeKind: null })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.hunterZombie,
      layers: [],
      isHorde: false,
      isFinalHorde: false,
    });
    expect(mapUnitAssetLayers({ type: 'hunterZombie', hordeKind: 'final' })).toMatchObject({
      base: BOARD_ASSET_REGISTRY.units.hunterZombie,
      layers: ['horde', 'final'],
      isHorde: true,
      isFinalHorde: true,
    });
    expect(getUnitAssetPath('hordeZombie')).toBe(BOARD_ASSET_REGISTRY.units.hordeZombie);
  });
});

describe('pure board layout helpers', () => {
  it('derives Road connections in stable hex direction order', () => {
    const center = { q: 4, r: 4 };
    const roads = [
      center,
      { q: 5, r: 4 }, // east
      { q: 4, r: 3 }, // northWest
      { q: 3, r: 4 }, // west
      { q: 4, r: 5 }, // southEast
    ];
    expect(deriveRoadConnectionDirections(center, roads)).toEqual([
      'east',
      'northWest',
      'west',
      'southEast',
    ]);
    expect(roadConnectionMask(['east', 'west'])).toBe(1 | (1 << 3));
    const before = JSON.stringify(roads);
    deriveRoadConnectionDirections(center, roads);
    expect(JSON.stringify(roads)).toBe(before);
  });

  it('supports map tile sources and ignores non-road tiles', () => {
    const center = { q: 1, r: 1 };
    const tiles = [
      { key: '1,1', q: 1, r: 1, terrain: 'plain', road: true },
      { key: '2,1', q: 2, r: 1, terrain: 'plain', road: true },
      { key: '1,0', q: 1, r: 0, terrain: 'plain', road: false },
    ] as never[];
    expect(deriveRoadConnectionDirections(center, tiles)).toEqual(['east']);
  });

  it('uses the documented LOD boundary and facility/unit offset without mutation', () => {
    expect(BOARD_MIN_ZOOM).toBe(0.35);
    expect(BOARD_MAX_ZOOM).toBe(2.2);
    expect(BOARD_LOD_ZOOM_THRESHOLD).toBe(0.75);
    expect(shouldUseBoardLod(0.7499)).toBe(true);
    expect(shouldUseBoardLod(0.75)).toBe(false);
    expect(shouldUseBoardLod(0.7501)).toBe(false);
    expect(boardLodMode(0.55)).toBe('lod');
    expect(boardLodMode(0.75)).toBe('normal');
    expect(getFacilityUnitOffset(false)).toEqual({ x: 0, y: 0 });
    expect(getFacilityUnitOffset(true)).toEqual({ x: 10, y: 10 });
    const facility = { id: 'capital' };
    const first = getFacilityUnitOffset(facility);
    first.x = 999;
    expect(getFacilityUnitOffset(facility)).toEqual({ x: 10, y: 10 });
  });
});
