import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';
import { getPlayerVisibleTileKeys, getVisibleEnemyUnits } from './visibility';

describe('v1.3 player visibility', () => {
  it('combines human units, capital, owned facilities and operational checkpoints', () => {
    const state = createInitialState(1, createDefaultConfig());
    const visible = getPlayerVisibleTileKeys(state);
    expect(visible.has('7,7')).toBe(true);
    expect(visible.has('4,4')).toBe(false);
    expect(getVisibleEnemyUnits(state).map((unit) => unit.id)).not.toContain('zombie-1');

    const city = state.facilities.find((facility) => facility.id === 'city-1')!;
    city.owner = 'player';
    city.status = 'owned';
    expect(getPlayerVisibleTileKeys(state).has('7,3')).toBe(true);
    expect(getPlayerVisibleTileKeys(state).has('7,2')).toBe(true);

    state.checkpoints.push({
      id: 'checkpoint-test', position: { q: 7, r: 1 }, direction: 'north', branchId: 'north',
      status: 'operational', waiting: 0, screening: 0, approved: 0, remainingTurns: 0,
      screeningPolicy: 'normal', nextArrivalTurn: 2, infected: 0,
    });
    state.roadBranches.find((branch) => branch.branchId === 'north')!.activeCheckpointId = 'checkpoint-test';
    expect(getPlayerVisibleTileKeys(state).has('7,0')).toBe(true);
    state.checkpoints[0]!.status = 'ruined';
    expect(getPlayerVisibleTileKeys(state).has('7,0')).toBe(false);
  });

  it('does not let terrain block radius-based vision', () => {
    const state = createInitialState(1, createDefaultConfig());
    const police = state.units.find((unit) => unit.type === 'police')!;
    police.position = { q: 4, r: 3 };
    police.vision = 1;
    const visible = getPlayerVisibleTileKeys(state);
    expect(visible.has('4,4')).toBe(true);
  });
});
