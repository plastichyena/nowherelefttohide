import { expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { prepareTestSnapshot } from './testConfig';
import { validateInvariants } from './invariants';
import type { GameState } from './types';

it.each([{ seed: 64, workers: 10 }, { seed: 123, workers: 1 }])('keeps Army Base interception capacity valid after living-condition infection: $workers workers', ({ seed, workers }) => {
  const engine = new GameEngine(seed, createDefaultConfig({
    economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialResources: { food: 1000000, civilianGoods: 1000000, militaryGoods: 1000000, fuel: 1000000 } },
    refugees: { arrivalIntervalMin: 999, arrivalIntervalMax: 999 },
  }));
  const state = engine.getState() as GameState;
  const base = state.facilities.find(f => f.type === 'armyBase')!;
  Object.assign(base, { owner: 'player', status: 'owned', workers, earlyCaptureSurvivorStatus: 'rescued' });
  base.armyBase!.interceptionsRemaining = workers;
  state.publicHealthStress = { food: 1, civilianGoods: 1 };
  const capital = state.facilities.find(f => f.type === 'capital')!;
  Object.assign(capital, { workers: 1, infected: 1, operationalStatus: 'infected' });
  state.units = state.units.filter(u => !u.isPlayerUnit);
  prepareTestSnapshot(state, true);
  expect(validateInvariants(state).errors).toEqual([]);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const ended = engine.step({ type: 'EndTurn' });
  expect(ended.error).toBeNull();
  const infection = ended.events.find(e => e.type === 'public_health_infection' && e.payload.facilityId === base.id);
  expect(infection?.payload.infected).toBe(1);
  expect(ended.state.result).toMatchObject({ outcome: 'lost', reason: 'capitalLost' });
  expect(ended.state.facilities.find(f => f.id === base.id)?.armyBase!.interceptionsRemaining).toBe(workers - 1);
  expect(validateInvariants(ended.state as GameState).errors).toEqual([]);
});

it('finishes a Turn 10 capital defeat after neutral Army Base survivors expire', () => {
  const engine = new GameEngine(23, createDefaultConfig({
    economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialResources: { food: 1000000, civilianGoods: 1000000, militaryGoods: 1000000, fuel: 1000000 } },
    refugees: { arrivalIntervalMin: 999, arrivalIntervalMax: 999 },
    horde: { waves: [{ turn: 100, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
  }));
  const state = engine.getState() as GameState;
  state.turn = 10;
  const base = state.facilities.find(f => f.type === 'armyBase')!;
  expect(base.workers).toBeGreaterThan(0);
  base.armyBase!.interceptionsRemaining = base.workers;
  const capital = state.facilities.find(f => f.type === 'capital')!;
  capital.workers = 1;
  capital.infected = 1;
  capital.operationalStatus = 'infected';
  state.units = state.units.filter(u => !u.isPlayerUnit);
  prepareTestSnapshot(state, true);
  expect(validateInvariants(state).errors).toEqual([]);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();

  const ended = engine.step({ type: 'EndTurn' });
  expect(ended.error).toBeNull();
  expect(ended.state.result).toMatchObject({ outcome: 'lost', reason: 'capitalLost', turn: 10 });
  expect(ended.state.facilities.find(f => f.id === base.id)).toMatchObject({ workers: 0, earlyCaptureSurvivorStatus: 'lost', armyBase: { interceptionsRemaining: 0, reward: 'expired' } });
  expect(ended.events.some(e => e.type === 'survivors_expired' && e.payload.facilityId === base.id)).toBe(true);
  expect(validateInvariants(ended.state as GameState).errors).toEqual([]);
});
