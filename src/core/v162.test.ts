import { expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { getBranchSupplyRadius } from './supply';
import { hexDistance, hexKey } from './hex';
import { prepareTestSnapshot } from './testConfig';
import { forecastNextTurnPenalties } from './economy-query';
import { validateInvariants } from './invariants';
import type { GameState } from './types';

const quiet = () => createDefaultConfig({
  economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialScreamerCount: 0,
    initialResources: { food: 10000, civilianGoods: 10000, militaryGoods: 10000, fuel: 10000 } },
  refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
});

it('starts with four active checkpoints, seven regular units, 110 civilians and exactly 50 zombies', () => {
  for (const seed of [1, 7, 19]) {
    const state = new GameEngine(seed).getState();
    expect(state.checkpoints.map(c => [c.id, hexKey(c.position)])).toEqual([
      ['checkpoint-1', '25,20'], ['checkpoint-2', '30,25'], ['checkpoint-3', '25,30'], ['checkpoint-4', '20,25'],
    ]);
    expect(state.statistics.checkpointsBuilt).toBe(0);
    expect(state.nextCheckpointNumber).toBe(5);
    for (const branch of state.roadBranches) {
      expect(getBranchSupplyRadius(state, branch.branchId)).toBe(5);
      expect(state.checkpoints.find(c => c.id === branch.activeCheckpointId)).toMatchObject({ status: 'operational', waiting: 0, screening: 0, approved: 0, infected: 0 });
      expect(branch.currentPolicy).toBe('normal');
    }
    expect(state.population.healthyCivilians).toBe(110);
    expect(state.resources).toMatchObject({ food: 330, civilianGoods: 355, militaryGoods: 175, fuel: 192 });
    for (const id of ['city-1', 'military-factory-1']) expect(state.facilities.find(f => f.id === id)).toMatchObject({ owner: 'player', workers: 0, firstCaptureRewardClaimed: true, earlyCaptureSurvivorStatus: 'notApplicable' });
    expect(state.facilities.find(f => f.id === 'city-1')!.position).toEqual({ q: 25, r: 21 });
    const counts = Object.fromEntries(['police', 'riotPolice', 'reconTeam', 'nationalGuard', 'zombie', 'gasZombie', 'hunterZombie', 'screamerZombie'].map(type => [type, state.units.filter(u => u.type === type).length]));
    expect(counts).toEqual({ police: 4, riotPolice: 1, reconTeam: 1, nationalGuard: 1, zombie: 40, gasZombie: 4, hunterZombie: 4, screamerZombie: 2 });
    const base = state.facilities.find(f => f.type === 'armyBase')!;
    const occupied = [...state.units, ...state.facilities, ...state.checkpoints].map(entity => hexKey(entity.position));
    expect(new Set(occupied).size).toBe(occupied.length);
    for (const unit of state.units) {
      if (unit.isPlayerUnit) expect(unit).toMatchObject({ proficiency: 'regular', currentFuel: unit.maxFuel, currentMilitaryGoods: unit.maxMilitaryGoods });
      else expect(hexDistance(unit.position, base.position)).toBeGreaterThan(unit.vision);
    }
  }
}, 60000);

it('rejects a population transfer beyond Temporary Housing capacity', () => {
  const engine = new GameEngine(1, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialScreamerCount: 0 } }));
  const candidate = engine.getConstructibleFacilityPositionCandidates('temporaryHousing').find(c => c.legal)!;
  expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'temporaryHousing', position: candidate.position }).error).toBeNull();
  expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const housing = engine.getState().facilities.find(f => f.type === 'temporaryHousing')!;
  expect(engine.step({ type: 'TransferPopulation', fromFacilityId: 'capital', toFacilityId: housing.id, people: 10 }).error).toBeNull();
  const before = engine.getState();
  const action = { type: 'TransferPopulation' as const, fromFacilityId: 'capital', toFacilityId: housing.id, people: 1 };
  expect(engine.getLegalActions()).not.toContainEqual(action);
  expect(engine.step(action).error?.code).toBe('population_capacity_exceeded');
  expect(engine.getState()).toEqual(before);
});

it('keeps excess approved refugees queued and rejects worker withdrawal when only Housing has insufficient room', () => {
  const engine = new GameEngine(7, quiet());
  const candidate = engine.getConstructibleFacilityPositionCandidates('temporaryHousing').find(c => c.legal)!;
  expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'temporaryHousing', position: candidate.position }).error).toBeNull();
  expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const state = engine.getState() as GameState;
  const housing = state.facilities.find(f => f.type === 'temporaryHousing')!;
  housing.workers = 8;
  for (const city of state.facilities.filter(f => f.owner === 'player' && ['capital', 'city'].includes(f.type))) {
    city.infected = 1; city.operationalStatus = 'infected';
  }
  state.checkpoints[0]!.approved = 3;
  prepareTestSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const withdraw = { type: 'AssignWorkers' as const, facilityId: 'farm-1', workers: 20 };
  const before = engine.getState();
  expect(engine.getLegalActions()).not.toContainEqual(withdraw);
  expect(engine.step(withdraw).error).not.toBeNull();
  expect(engine.getState()).toEqual(before);
  expect(forecastNextTurnPenalties(before).overcrowding.facilities.some(f => f.facilityId === housing.id)).toBe(false);
  const ended = engine.step({ type: 'EndTurn' });
  expect(ended.error).toBeNull();
  expect(ended.state.checkpoints[0]!.approved).toBe(3);
  expect(ended.state.facilities.find(f => f.id === housing.id)!.workers).toBe(8);
  const overCapacity = structuredClone(ended.state) as GameState;
  const infectedHousing = overCapacity.facilities.find(f => f.id === housing.id)!;
  infectedHousing.workers = 10; infectedHousing.infected = 1;
  prepareTestSnapshot(overCapacity);
  expect(validateInvariants(overCapacity).valid).toBe(false);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: overCapacity }).error?.code).toBe('invalid_snapshot');
});

it('charges 25 for initial-post relocation and rear construction, and resolves Strict after five screening turns', () => {
  const engine = new GameEngine(1, quiet());
  const initial = engine.getState().resources.civilianGoods;
  expect(engine.step({ type: 'RelocateCheckpoint', checkpointId: 'checkpoint-2', position: { q: 29, r: 25 } }).error).toBeNull();
  expect(engine.getState().resources.civilianGoods).toBe(initial - 25);
  expect(engine.step({ type: 'BuildCheckpoint', branchId: 'south', position: { q: 25, r: 29 } }).error).toBeNull();
  expect(engine.getState().resources.civilianGoods).toBe(initial - 50);
  const state = engine.getState() as GameState;
  state.checkpoints[0]!.waiting = 20;
  prepareTestSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  expect(engine.step({ type: 'SetCheckpointPolicy', branchId: 'north', policy: 'strict' }).error).toBeNull();
  expect(engine.step({ type: 'EndTurn' }).state.checkpoints[0]).toMatchObject({ screening: 20, remainingTurns: 5 });
  const civilians = engine.getState().population.healthyCivilians;
  for (const remainingTurns of [4, 3, 2, 1]) {
    const next = engine.step({ type: 'EndTurn' });
    expect(next.error).toBeNull();
    expect(next.state.checkpoints[0]).toMatchObject({ screening: 20, remainingTurns });
  }
  const resolved = engine.step({ type: 'EndTurn' });
  expect(resolved.error).toBeNull();
  expect(resolved.state.checkpoints[0]).toMatchObject({ screening: 0, remainingTurns: 0, infected: 0 });
  expect(resolved.state.population.healthyCivilians).toBe(civilians + 20);
});

it('receives the ordinary first scheduled arrivals at all four initial checkpoints', () => {
  const config = quiet();
  config.refugees.arrivalIntervalMin = 1; config.refugees.arrivalIntervalMax = 1;
  config.refugees.arrivalPeopleMin = 10; config.refugees.arrivalPeopleMax = 10;
  const engine = new GameEngine(7, config);
  expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const arrived = engine.step({ type: 'EndTurn' });
  expect(arrived.error).toBeNull();
  expect(arrived.state.checkpoints.map(c => c.waiting)).toEqual([10, 10, 10, 10]);
  expect(arrived.state.population.cumulativeArrivals).toBe(40);
});
