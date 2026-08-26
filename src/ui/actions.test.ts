import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { GameEngine } from '../core/engine';
import {
  actionForPopulationTransfer,
  actionForWorkerAssignment,
  clampInteger,
  findUnitAt,
  isLegalAction,
  legalMoveDestinations,
  populationLocationTotals,
  workerAssignmentBounds,
} from './actions';

describe('UI action projection', () => {
  it('derives legal movement without mutating the engine state', () => {
    const engine = new GameEngine(5, createDefaultConfig());
    const before = JSON.stringify(engine.getState());
    const state = engine.getState();
    const police = state.units.find((unit) => unit.type === 'police');
    expect(police).toBeDefined();
    const actions = engine.getLegalActions();
    const destinations = legalMoveDestinations(actions, police!.id);
    expect(destinations.length).toBeGreaterThan(0);
    expect(findUnitAt(state, police!.position)?.id).toBe(police!.id);
    expect(JSON.stringify(engine.getState())).toBe(before);
  });

  it('matches worker assignment controls to atomic GameActions', () => {
    const engine = new GameEngine(3, createDefaultConfig());
    const state = engine.getState();
    const farm = state.facilities.find((facility) => facility.id === 'farm-1');
    expect(farm).toBeDefined();
    const action = actionForWorkerAssignment(engine.getLegalActions(), farm!.id, farm!.workers - 1);
    expect(action?.type).toBe('AssignWorkers');
    expect(isLegalAction(engine.getLegalActions(), action!)).toBe(true);
  });

  it('keeps worker controls integer and within the legal UI range', () => {
    expect(clampInteger('17.9', 0, 25)).toBe(17);
    expect(clampInteger('-4', 0, 25)).toBe(0);
    expect(clampInteger('999', 0, 25)).toBe(25);
    expect(clampInteger('not a number', 0, 25, 4)).toBe(4);

    const engine = new GameEngine(3, createDefaultConfig());
    const state = engine.getState();
    const farm = state.facilities.find((facility) => facility.id === 'farm-1')!;
    expect(workerAssignmentBounds(state, farm)).toEqual({ minimum: 0, maximum: 25, current: 23 });
  });

  it('projects location-based population totals without legacy pools', () => {
    const engine = new GameEngine(9, createDefaultConfig());
    const population = populationLocationTotals(engine.getState());
    expect(population.cityResidents).toBe(41);
    expect(population.productionWorkers).toBe(59);
    expect(population.healthyCivilians).toBe(100);
    expect(population.unitPopulation).toBe(15);
    expect(population.total).toBe(115);
  });

  it('finds a city transfer only as the exact atomic GameAction', () => {
    const actions = [
      { type: 'TransferPopulation', fromFacilityId: 'capital', toFacilityId: 'city-1', people: 1 } as const,
      { type: 'TransferPopulation', fromFacilityId: 'capital', toFacilityId: 'city-1', people: 41 } as const,
    ];
    expect(actionForPopulationTransfer(actions, 'capital', 'city-1', 41)).toEqual(actions[1]);
    expect(actionForPopulationTransfer(actions, 'capital', 'city-2', 1)).toBeUndefined();
  });
});
