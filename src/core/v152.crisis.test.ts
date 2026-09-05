import { describe, expect, it } from 'vitest';
import { comparePublicCrisisAlerts, CRISIS_WORSENING_FACTS } from './crisis';
import type { CrisisAlert, JsonObject } from './types';

type FactCase = [CrisisAlert['reasonCode'], string, string | number | boolean | null, string | number | boolean | null];
const worseningCases: FactCase[] = [
  ['capital_infection_uncontained', 'infected', 1, 2],
  ['capital_infection_uncontained', 'healthyPopulation', 20, 19],
  ['capital_infection_uncontained', 'suppressionUnitAvailable', true, false],
  ['critical_site_infection_uncontained', 'infected', 1, 2],
  ['critical_site_infection_uncontained', 'healthyPopulation', 20, 19],
  ['critical_site_infection_uncontained', 'currentProductionLoss', 1, 2],
  ['checkpoint_defense_degraded', 'standbyCount', 2, 1],
  ['checkpoint_defense_degraded', 'fallbackDepth', 3, 2],
  ['checkpoint_defense_degraded', 'roleChangedThisTurn', false, true],
  ['checkpoint_defense_degraded', 'activeCheckpointId', 'cp-1', null],
  ['unit_out_of_supply_risk', 'hp', 20, 19],
  ['unit_out_of_supply_risk', 'fuel', 2, 1],
  ['unit_out_of_supply_risk', 'militaryGoods', 2, 1],
  ['horde_warning_active', 'turnsRemaining', 2, 1],
  ['horde_warning_active', 'directionCount', 1, 2],
  ['horde_warning_active', 'final', false, true],
  ['guaranteed_resource_defeat', 'foodShortage', 1, 2],
  ['guaranteed_resource_defeat', 'civilianGoodsShortage', 1, 2],
  ['guaranteed_resource_defeat', 'healthyCivilians', 20, 19],
  ['new_state_loss', 'eventId', 'event-1', 'event-2'],
];
function alert(reasonCode: CrisisAlert['reasonCode'], publicFacts: JsonObject = {}): CrisisAlert {
  return { id: reasonCode + ':x', category: 'unit', severity: 'warning', reasonCode, entityIds: ['x'], publicFacts };
}

describe('v1.5.2 public crisis worsening contract', () => {
  it('covers all seven reason codes and their declared comparison facts', () => {
    expect(Object.keys(CRISIS_WORSENING_FACTS).sort()).toEqual([
      'capital_infection_uncontained', 'critical_site_infection_uncontained', 'checkpoint_defense_degraded',
      'unit_out_of_supply_risk', 'horde_warning_active', 'guaranteed_resource_defeat', 'new_state_loss',
    ].sort());
    expect(worseningCases.map(([reason, key]) => `${reason}:${key}`).sort()).toEqual(
      Object.entries(CRISIS_WORSENING_FACTS).flatMap(([reason, facts]) => Object.keys(facts).map(key => `${reason}:${key}`)).sort());
  });
  it.each(worseningCases)('detects %s / %s at unchanged severity', (reason, key, beforeValue, afterValue) => {
    const before = alert(reason, { [key]: beforeValue });
    const after = alert(reason, { [key]: afterValue });
    expect(comparePublicCrisisAlerts([before], [after])).toEqual({ newAlertIds: [], worsenedAlertIds: [after.id] });
    expect(comparePublicCrisisAlerts([before], [structuredClone(before)])).toEqual({ newAlertIds: [], worsenedAlertIds: [] });
    if (reason !== 'new_state_loss') expect(comparePublicCrisisAlerts([after], [before]).worsenedAlertIds).toEqual([]);
  });
  it('uses reason and target set, ignores wording and fact ordering, and notices severity or target changes', () => {
    const before = alert('unit_out_of_supply_risk', { hp: 20, message: 'English' });
    before.entityIds = ['b', 'a'];
    const after = { ...before, id: 'different-display-id', entityIds: ['a', 'b'], publicFacts: { message: '日本語', hp: 20 } };
    expect(comparePublicCrisisAlerts([before], [after])).toEqual({ newAlertIds: [], worsenedAlertIds: [] });
    expect(comparePublicCrisisAlerts([before], [{ ...after, severity: 'critical' }]).worsenedAlertIds).toEqual([after.id]);
    expect(comparePublicCrisisAlerts([before], [{ ...after, entityIds: ['c'] }]).newAlertIds).toEqual([after.id]);
    expect(comparePublicCrisisAlerts([before], [])).toEqual({ newAlertIds: [], worsenedAlertIds: [] });
  });
});
