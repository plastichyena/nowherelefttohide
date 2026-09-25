import { expect, it } from 'vitest';
import { createInitialState, createUnit } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { getUnitLegalMoveFuelProjections, previewMove } from '../core/movement-query';
import { createAgentObservation } from './observation';
import { queryRoute } from './route-query';
import { publicMoveCandidates } from './public-movement';
const HUMAN_UNIT_TYPES = ['police','nationalGuard','riotPolice','reconTeam','specialForces','fieldArtillery','multipurposeHelicopter'] as const;

it('keeps summaries and every short legal destination consistent for all Human types, without serialized move arrays', () => {
  const state = createInitialState(1, createDefaultConfig());
  state.units = [];
  for (const type of HUMAN_UNIT_TYPES) {
    const unit = createUnit(state, `test-${type}`, type, { q: 25, r: 25 });
    unit.movement = 2; if (type === 'multipurposeHelicopter') unit.flightState = 'airborne'; unit.canMove = true;
    state.units = [unit];
    const observation = createAgentObservation(state); const publicUnit = observation.units[0]!;
    expect(JSON.stringify(observation)).not.toContain('fuelCostByLegalMove');
    const legacy = getUnitLegalMoveFuelProjections(state, unit.id);
    expect(legacy.length).toBeGreaterThan(0);
    expect(publicUnit.movementSummary.legalMoveCount).toBe(legacy.length);
    expect(publicMoveCandidates(observation, unit.id)).toHaveLength(legacy.length);
    for (const move of legacy) {
      const route = queryRoute(observation, { moverUnitId: unit.id, destination: { kind: 'coordinate', position: move.destination } });
      const preview = previewMove(state, unit.id, move.destination);
      expect(route.currentSingleAction).toMatchObject({ reachable: true, fuelCost: move.fuelCost, effectiveMovementCost: move.effectiveMovementCost });
      expect(route.movementDetail?.preview).toMatchObject({ fuelCost: preview.fuelCost, reached: preview.reached, projectedFuelAfterMove: preview.projectedFuelAfterMove });
    }
    unit.canMove = false;
    expect(createAgentObservation(state).units[0]!.movementSummary).toMatchObject({ legalMoveCount: 0, availableMovementPoints: 0 });
  }
}, 120000);

it.each([0, 1, 4, 5, 6])('distinguishes legal helicopter plans and exhaustion for Fuel %i', fuel => {
  const state = createInitialState(1, createDefaultConfig());
  const unit = createUnit(state, 'test-helicopter', 'multipurposeHelicopter', { q: 25, r: 25 });
  unit.flightState = 'airborne'; unit.canMove = true; unit.movement = 50; unit.movementDomain = 'air'; unit.currentFuel = fuel; state.units = [unit];
  const before = JSON.stringify(state); const observation = createAgentObservation(state);
  const destination = { q: 28, r: 25 };
  const route = queryRoute(observation, { moverUnitId: unit.id, destination: { kind: 'coordinate', position: destination } });
  const preview = previewMove(state, unit.id, destination);
  expect(route.currentSingleAction.reachable).toBe(fuel > 0); expect(preview.legal).toBe(fuel > 0);
  expect(route.destinationCenterReached).toBe(false);
  if (fuel > 0) {
    expect(route.movementDetail?.plannedFuelCost).toBe(15);
    expect(route.movementDetail?.preview).toMatchObject({ projectedFuelAfterMove: 0, fuelCost: fuel, reached: preview.reached, fuelExhaustionHex: preview.fuelExhaustionHex });
    expect(observation.units[0]!.movementSummary.rangeUpperBound).toBe(fuel <= 5 ? 0 : 1);
  }
  expect(JSON.stringify(state)).toBe(before);
});

it('offers one deterministic closer move without forced interruption or exhaustion, and returns none when acted', () => {
  const state = createInitialState(1, createDefaultConfig());
  const unit = createUnit(state, 'test-helicopter', 'multipurposeHelicopter', { q: 25, r: 25 });
  unit.flightState = 'airborne'; unit.canMove = true; unit.movement = 2; state.units = [unit];
  const observation = createAgentObservation(state); const input = { moverUnitId: unit.id, destination: { kind: 'coordinate' as const, position: { q: 35, r: 25 } } };
  const route = queryRoute(observation, input);
  expect(route.alternative).toMatchObject({ destination: { q: 27, r: 25 } });
  expect(queryRoute(observation, input)).toEqual(route);
  unit.currentFuel = 1;
  expect(queryRoute(createAgentObservation(state), input).alternative).toBeNull();
  unit.actionState = 'acted';
  expect(queryRoute(createAgentObservation(state), input).alternative).toBeNull();
});
