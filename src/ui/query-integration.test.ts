import { expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class Scene {}, Game: class Game {} } }));
import { GameEngine } from '../core/engine';
import { createAgentObservation } from '../agent/observation';
import { crisisSummaryViewModel, endTurnRiskViewModel, shouldConfirmEndTurn } from './controller';
import type { EndTurnRisk } from '../core/types';

it('renders Core Query crisis alerts exactly like the complete Agent Observation', () => {
  const engine = new GameEngine(1);
  engine.step({ type: 'EndTurn' });
  engine.step({ type: 'EndTurn' });
  const queryAlerts = engine.getQuery().getCrisisSummary();
  expect(queryAlerts.length).toBeGreaterThan(0);
  const fromQuery = crisisSummaryViewModel({ crisisSummary: queryAlerts });
  const fromObservation = crisisSummaryViewModel(createAgentObservation(engine.getState()));
  expect(fromQuery).toEqual(fromObservation);
  expect(fromQuery.alerts.length).toBe(queryAlerts.length);
  expect(endTurnRiskViewModel({ endTurnRisk: engine.getQuery().getEndTurnRisk() }))
    .toEqual(endTurnRiskViewModel(createAgentObservation(engine.getState())));
});

it('keeps Core risk IDs, charge details and independent confirmation triggers', () => {
  const unit = { unitId: 'police-1', moveRemaining: true, attackChargesRemaining: 2, legalAttackTargetIds: ['zombie-1'], suppressionTargetId: 'capital' };
  const risk: EndTurnRisk = {
    readyUnits: [unit], unitsWithMoveRemaining: [unit], unitsWithAttackChargesRemaining: [unit],
    uncontainedInfectedSites: [{ id: 'capital', kind: 'facility', infected: 1 }],
    criticalAlerts: [{ id: 'infection:capital', severity: 'critical', category: 'infection', reasonCode: 'capital_infection_uncontained', entityIds: ['capital'], publicFacts: { infected: 1 } }],
    forecastGuaranteedDefeat: false,
  };
  const model = endTurnRiskViewModel({ endTurnRisk: risk });
  expect(model.readyUnits).toEqual(['police-1']);
  expect(model.unitsWithMoveRemaining).toEqual(['police-1']);
  expect(model.unitsWithAttackChargesRemaining).toEqual([{ unitId: 'police-1', remainingMove: 1, remainingAttackCharges: 2, legalAttackCount: 1, automaticSuppressionTargetId: 'capital' }]);
  expect(model.uncontainedInfectedSites).toEqual(['capital']);
  expect(model.criticalAlerts[0]).toMatchObject({ id: 'infection:capital', reasonCode: 'capital_infection_uncontained', severity: 'critical' });
  const emptySummary = crisisSummaryViewModel({});
  expect(shouldConfirmEndTurn(emptySummary, { ...model, unitsWithAttackChargesRemaining: [], uncontainedInfectedSites: [] })).toBe(true);
  expect(shouldConfirmEndTurn(emptySummary, { ...model, unitsWithAttackChargesRemaining: [], criticalAlerts: [] })).toBe(true);
});
