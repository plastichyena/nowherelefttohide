import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';
import { getSuppliedTileKeys } from './supply';
import {
  getGroundVisibleTileKeys,
  getGroundVisionCoverageFrom,
  getPlayerVisionCoverage,
  getPlayerVisibleTileKeys,
  getVisibleEnemyUnits,
  isGroundVisibleFrom,
} from './visibility';
import type { GameState, HexCoord } from './types';

function tile(state: GameState, position: HexCoord) {
  const found = state.map.tiles.find((candidate) => candidate.q === position.q && candidate.r === position.r);
  if (!found) throw new Error(`Missing tile ${position.q},${position.r}`);
  return found;
}

describe('v1.4.4 player visibility', () => {
  it('combines human units, capital, owned facilities and operational checkpoints', () => {
    const state = createInitialState(1, createDefaultConfig());
    const visible = getPlayerVisibleTileKeys(state);
    expect(visible.has('25,25')).toBe(true);
    expect(visible.has('4,4')).toBe(false);
    expect(getVisibleEnemyUnits(state).map((unit) => unit.id)).not.toContain('zombie-1');

    const city = state.facilities.find((facility) => facility.id === 'city-1')!;
    city.owner = 'player';
    city.status = 'owned';
    expect(getPlayerVisibleTileKeys(state).has('25,20')).toBe(true);
    expect(getPlayerVisibleTileKeys(state).has('25,19')).toBe(true);

    state.checkpoints.push({
      id: 'checkpoint-test', position: { q: 25, r: 1 }, direction: 'north', branchId: 'north',
      status: 'operational', waiting: 0, screening: 0, approved: 0, remainingTurns: 0,
      screeningPolicy: 'normal', nextArrivalTurn: 2, infected: 0,
    });
    state.roadBranches.find((branch) => branch.branchId === 'north')!.activeCheckpointId = 'checkpoint-test';
    expect(getPlayerVisibleTileKeys(state).has('25,0')).toBe(true);
    state.checkpoints[0]!.status = 'ruined';
    expect(getPlayerVisibleTileKeys(state).has('25,0')).toBe(false);
  });

  it('uses the first Forest or Mountain on a Ground LOS as the visible boundary', () => {
    const state = createInitialState(1, createDefaultConfig());
    const origin = { q: 25, r: 25 };
    const firstBlocking = { q: 25, r: 26 };
    const beyondBlocking = { q: 25, r: 27 };
    tile(state, firstBlocking).terrain = 'forest';
    tile(state, beyondBlocking).terrain = 'plain';

    expect(isGroundVisibleFrom(state, origin, firstBlocking, 3)).toBe(true);
    expect(isGroundVisibleFrom(state, origin, beyondBlocking, 3)).toBe(false);
    expect(getGroundVisibleTileKeys(state, origin, 3).has(firstBlocking.q + ',' + firstBlocking.r)).toBe(true);
    expect(getGroundVisibleTileKeys(state, origin, 3).has(beyondBlocking.q + ',' + beyondBlocking.r)).toBe(false);

    tile(state, firstBlocking).terrain = 'plain';
    tile(state, beyondBlocking).terrain = 'mountain';
    expect(isGroundVisibleFrom(state, origin, beyondBlocking, 3)).toBe(true);
  });

  it('decomposes one Ground source without mixing in other player sources', () => {
    const state = createInitialState(1, createDefaultConfig());
    const source = getGroundVisionCoverageFrom(state, { q: 0, r: 0 }, 1);

    expect(source.potential.has('0,0')).toBe(true);
    expect(source.potential.has('25,25')).toBe(false);
    expect(source.visible.has('25,25')).toBe(false);
    expect(source.blocked.has('25,25')).toBe(false);
    expect(getPlayerVisionCoverage(state).groundPotential.has('25,25')).toBe(true);
  });

  it('does not let the source terrain block itself and uses base terrain behind overlays', () => {
    const state = createInitialState(2, createDefaultConfig());
    const origin = { q: 25, r: 25 };
    const target = { q: 25, r: 27 };
    const middle = { q: 25, r: 26 };
    tile(state, origin).terrain = 'mountain';
    tile(state, middle).terrain = 'forest';
    tile(state, target).terrain = 'plain';
    expect(isGroundVisibleFrom(state, origin, target, 3)).toBe(false);

    tile(state, middle).terrain = 'plain';
    expect(isGroundVisibleFrom(state, origin, target, 3)).toBe(true);

    // Road is an overlay; a blocking base terrain must still block LOS.
    tile(state, middle).road = true;
    tile(state, middle).terrain = 'mountain';
    expect(isGroundVisibleFrom(state, origin, target, 3)).toBe(false);
  });

  it('keeps Capital Vision independent from the initial Supply radius', () => {
    const state = createInitialState(3, createDefaultConfig({ checkpoint: { initialSupplyRadius: 0 } }));
    const capitalSightline = '25,20';
    expect(getPlayerVisibleTileKeys(state).has(capitalSightline)).toBe(true);
    expect(getSuppliedTileKeys(state)).not.toContain(capitalSightline);
  });

  it('lets a powered worker Drone use unblocked Aerial Vision through Ground terrain', () => {
    const state = createInitialState(4, createDefaultConfig());
    const origin = { q: 5, r: 5 };
    const blocking = { q: 5, r: 6 };
    const target = { q: 5, r: 7 };
    for (const unit of state.units) {
      unit.isPlayerUnit = false;
      unit.vision = 0;
    }
    for (const facility of state.facilities) {
      facility.owner = 'none';
      facility.status = 'unowned';
      facility.operationalStatus = 'stopped';
    }
    const drone = state.facilities.find((facility) => facility.id === 'farm-1')!;
    drone.id = 'drone-vision-test';
    drone.type = 'civilianDroneBase';
    drone.position = origin;
    drone.workerCapacity = 5;
    drone.workers = 1;
    drone.owner = 'player';
    drone.status = 'owned';
    drone.operationalStatus = 'operational';
    drone.powerSupplyEnabled = true;
    drone.lastPowerSupplied = true;
    drone.infected = 0;
    tile(state, blocking).terrain = 'forest';
    tile(state, target).terrain = 'plain';

    const coverage = getPlayerVisionCoverage(state);
    expect(coverage.groundVisible.has('5,7')).toBe(false);
    expect(coverage.groundBlocked.has('5,7')).toBe(false);
    expect(coverage.aerialVisible.has('5,7')).toBe(true);
    expect(getPlayerVisibleTileKeys(state).has('5,7')).toBe(true);
  });
});
