import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { GameEngine } from '../core/engine';
import {
  actionForWorkerAssignment,
  findUnitAt,
  isLegalAction,
  legalMoveDestinations,
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
});
