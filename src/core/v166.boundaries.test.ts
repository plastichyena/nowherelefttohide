import { expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { getPlayerVisibleTileKeys } from './visibility';
import { facilityZombieTargetValue } from './state';
import { isHexSuppliedByBranch } from './supply';
import { decodeSaveCode, encodeSaveCode } from '../persistence/save';
import type { GameAction, GameState } from './types';
import { previewCoreAction } from './action-preview';

const config = () => createDefaultConfig({ vision: { capital: 50 }, economy: { initialZombieCount: 0, initialScreamerCount: 0, initialGasCount: { min: 0, max: 0 }, initialHunterCount: { min: 0, max: 0 }, initialResources: { food: 10000, civilianGoods: 10000, militaryGoods: 10000, fuel: 10000 } } });

it.each(['initial', 'outside-overlap', 'destination', 'infected-source', 'infected-abandoned'] as const)('applies checkpoint initial-supply boundaries consistently: %s', scenario => {
  const engine = new GameEngine(3, config());
  const state = engine.getState() as GameState;
  const source = state.checkpoints.find(c => c.direction === 'north')!;
  const destination = { q: 25, r: 18 };
  const action: GameAction = { type: 'RelocateCheckpoint', checkpointId: source.id, branchId: 'north', position: destination };
  let reason: string | null = null;
  if (scenario === 'initial') state.units.push(createUnit(state, 'near-enemy', 'zombie', { q: 25, r: 23 }));
  if (scenario === 'outside-overlap') {
    source.position = { q: 25, r: 18 }; action.position = { q: 25, r: 17 };
    const position = { q: 25, r: 19 };
    expect(isHexSuppliedByBranch(state, position, 'north')).toBe(true);
    state.units.push(createUnit(state, 'overlap-enemy', 'zombie', position)); reason = 'checkpoint_supply_zombie_blocked';
  }
  if (scenario === 'destination') {
    action.position = { q: 25, r: 22 };
    state.units.push(createUnit(state, 'destination-enemy', 'zombie', action.position)); reason = 'checkpoint_supply_zombie_blocked';
  }
  if (scenario === 'infected-source') { source.infected = 1; reason = 'checkpoint_infection_blocked'; }
  if (scenario === 'infected-abandoned') {
    state.checkpoints.push({ ...source, id: `checkpoint-${state.nextCheckpointNumber++}`, position: { q: 25, r: 22 }, status: 'abandoned', infected: 1 });
  }
  prepareTestSnapshot(state, true);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const candidate = engine.getCheckpointPositionCandidates().find(c => c.actionType === action.type && c.branchId === 'north' && c.position.q === action.position.q && c.position.r === action.position.r)!;
  expect(candidate).toBeDefined(); expect(candidate.reasonCode).toBe(reason);
  const before = engine.getState();
  expect(previewCoreAction(before, action, 0).reasonCode).toBe(reason);
  const result = engine.step(action);
  expect(result.error?.code ?? null).toBe(reason);
  if (reason) expect(engine.getState()).toEqual(before);
});

it('keeps completed relief vision and population target independent of power and supply, but removes both with the facility', () => {
  const engine = new GameEngine(3, config());
  const position = engine.getConstructibleFacilityPositionCandidates('reliefSupplyCenter').find(c => c.legal)!.position;
  expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'reliefSupplyCenter', position }).error).toBeNull();
  const state = engine.getState() as GameState;
  const center = state.facilities.find(f => f.type === 'reliefSupplyCenter')!;
  // Isolate this sight source on the existing map; no alternative source masks it.
  state.units = []; state.checkpoints = []; state.militaryDrone = null;
  for (const f of state.facilities) if (f !== center) f.owner = 'none';
  center.position = { q: 5, r: 5 };
  expect(getPlayerVisibleTileKeys(state).size).toBe(0);
  center.operationalStatus = 'stopped'; center.populationOperationalTurn = state.turn;
  center.powerSupplyEnabled = false; center.lastPowerSupplied = false;
  expect([...getPlayerVisibleTileKeys(state)].sort()).toEqual(['4,5','4,6','5,4','5,5','5,6','6,4','6,5']);
  expect(facilityZombieTargetValue(state, center)).toBe(0);
  center.workers = 5;
  expect(facilityZombieTargetValue(state, center)).toBe(5);
  state.facilities = state.facilities.filter(f => f.id !== center.id);
  expect(getPlayerVisibleTileKeys(state).size).toBe(0);
});

it.each(['workers', 'infection', 'building', 'enemy', 'empty-off-remote'] as const)('validates relief decommission and exact one-time refund: %s', scenario => {
  const engine = new GameEngine(3, config());
  const position = engine.getConstructibleFacilityPositionCandidates('reliefSupplyCenter').find(c => c.legal)!.position;
  expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'reliefSupplyCenter', position }).error).toBeNull();
  expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const state = engine.getState() as GameState; const center = state.facilities.find(f => f.type === 'reliefSupplyCenter')!;
  if (scenario === 'workers') center.workers = 1;
  if (scenario === 'infection') center.infected = 1;
  if (scenario === 'building') { center.operationalStatus = 'building'; center.populationOperationalTurn = state.turn + 1; }
  if (scenario === 'enemy') { const enemy = createUnit(state, 'occupying-enemy', 'zombie', center.position); state.units.push(enemy); }
  if (scenario === 'empty-off-remote') { center.position = { q: 5, r: 5 }; center.powerSupplyEnabled = false; }
  prepareTestSnapshot(state, true);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const restored = decodeSaveCode(encodeSaveCode(engine.getState())); expect(restored.valid).toBe(true);
  const before = engine.getState(); const action: GameAction = { type: 'DecommissionConstructibleFacility', facilityId: center.id };
  const result = engine.step(action);
  if (scenario === 'empty-off-remote') {
    expect(result.error).toBeNull(); expect(result.state.resources.civilianGoods).toBe(before.resources.civilianGoods + 25);
    expect(result.state.actionsTakenThisTurn).toBe(before.actionsTakenThisTurn + 1);
    expect(engine.step(action).error).not.toBeNull(); expect(engine.getState()).toEqual(result.state);
  } else { expect(result.error).not.toBeNull(); expect(engine.getState()).toEqual(before); }
});
