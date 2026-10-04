import { describe, expect, it } from 'vitest';
import { createInitialState, createUnit } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { nextPrincipalTarget, resolveTileTargets, selectableSelection } from './selection';

describe('public Hex selection', () => {
  it('cycles principal targets while keeping terrain and visible enemies reachable in the header', () => {
    const state = createInitialState(1, createDefaultConfig({ mapMode: 'fixed' }));
    const position = state.facilities.find(facility => facility.id === 'capital')!.position;
    state.units = [createUnit(state, 'a', 'police', position), createUnit(state, 'b', 'multipurposeHelicopter', position),
      createUnit(state, 'visible-zombie', 'zombie', position)];
    state.units[1]!.flightState = 'airborne';
    const targets = resolveTileTargets(state, position);
    expect(targets).toEqual([{ kind: 'unit', id: 'a' }, { kind: 'unit', id: 'b' }, { kind: 'facility', id: 'capital' },
      { kind: 'zombie', id: 'visible-zombie' }, { kind: 'hex', position }]);
    expect(nextPrincipalTarget(state, position, targets[0]!)).toEqual(targets[1]);
    expect(nextPrincipalTarget(state, position, targets[1]!)).toEqual(targets[2]);
    expect(nextPrincipalTarget(state, position, targets[2]!)).toEqual(targets[0]);
    expect(nextPrincipalTarget(state, position, targets[3]!)).toEqual(targets[0]);
    expect(nextPrincipalTarget(state, position, targets[4]!)).toEqual(targets[0]);
  });

  it('clears a lone facility on a repeat tap but retains its terrain entry', () => {
    const state = createInitialState(2, createDefaultConfig({ mapMode: 'fixed' }));
    state.units = [];
    const facility = state.facilities[0]!;
    expect(resolveTileTargets(state, facility.position)).toEqual([{ kind: 'facility', id: facility.id }, { kind: 'hex', position: facility.position }]);
    expect(nextPrincipalTarget(state, facility.position, { kind: 'facility', id: facility.id })).toBeNull();
  });

  it('excludes hidden, destroyed and transported units and invalidates a lost selection', () => {
    const state = createInitialState(3, createDefaultConfig({ mapMode: 'fixed' }));
    const position = { q: 0, r: 0 };
    const capital = state.facilities.find(facility => facility.id === 'capital')!.position;
    const hidden = createUnit(state, 'hidden', 'zombie', position);
    const destroyed = createUnit(state, 'destroyed', 'police', capital); destroyed.actionState = 'destroyed';
    const cargo = createUnit(state, 'cargo', 'police', capital); cargo.transportedByUnitId = 'transport';
    state.units = [hidden, destroyed, cargo];
    expect(resolveTileTargets(state, position)).toEqual([{ kind: 'hex', position }]);
    expect(resolveTileTargets(state, capital)).toEqual([{ kind: 'facility', id: 'capital' }, { kind: 'hex', position: capital }]);
    expect(selectableSelection(state, { kind: 'zombie', id: hidden.id })).toBeNull();
    expect(selectableSelection(state, { kind: 'unit', id: cargo.id })).toBeNull();
  });
});
