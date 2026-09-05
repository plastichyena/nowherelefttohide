import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState, createUnit } from '../core/state';
import { createAgentObservation } from './observation';

describe('v1.5.0 public progression, Horde, and Crisis projections', () => {
  it('projects Human proficiency and charge state while keeping Zombies free of it', () => {
    const state = createInitialState(15011, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const observation = createAgentObservation(state);
    const police = observation.units.find((unit) => unit.type === 'police')!;
    const guard = observation.units.find((unit) => unit.type === 'nationalGuard')!;

    expect(police).toMatchObject({
      proficiency: 'regular', recruitSurvivalTurns: 0, turnsUntilRegular: null,
      regularZombieKills: 0, killsUntilVeteran: 5, veteranPromotionPending: false,
      baseRecruitAttack: 6, effectiveAttack: 8, maxAttackCharges: 1, attackChargesRemaining: 1,
    });
    expect(guard).toMatchObject({ proficiency: 'regular', baseRecruitAttack: 12, effectiveAttack: 15 });
    expect(observation.zombies.every((zombie) =>
      zombie.proficiency === null && zombie.maxAttackCharges === 0 && zombie.attackChargesRemaining === 0,
    )).toBe(true);
  });

  it('returns all deterministic crisis alerts from public state without leaking private target data or mutating State', () => {
    const state = createInitialState(15012, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const capital = state.facilities.find((facility) => facility.type === 'capital')!;
    capital.infected = 3;
    capital.operationalStatus = 'infected';
    const before = JSON.stringify(state);

    const first = createAgentObservation(state);
    const second = createAgentObservation(state);
    const critical = first.crisisSummary.alerts.find((alert) => alert.reasonCode === 'capital_infection_uncontained');

    expect(first).toEqual(second);
    expect(JSON.stringify(state)).toBe(before);
    expect(critical).toMatchObject({
      severity: 'critical', category: expect.any(String), entityIds: [capital.id],
      publicFacts: expect.objectContaining({ infected: 3 }),
    });
    expect(first.crisisSummary.criticalCount).toBeGreaterThanOrEqual(1);
    expect(first.endTurnRisk.criticalAlerts).toContainEqual(expect.objectContaining({ id: critical!.id }));
    expect(JSON.stringify(first)).not.toContain('inheritedTarget');
    expect(JSON.stringify(first)).not.toContain('noiseTarget');
    expect(JSON.stringify(first)).not.toContain('spawnGroupId');
  });

  it('lists only usable remaining Attack Charges in EndTurn Risk and exposes their projected consumption', () => {
    const state = createInitialState(15013, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const police = state.units.find((unit) => unit.type === 'police')!;
    const target = createUnit(state, 'crisis-target', 'zombie', { q: police.position.q + 1, r: police.position.r });
    target.hp = 1;
    state.units.push(target);
    const before = JSON.stringify(state);

    const observation = createAgentObservation(state);
    const publicPolice = observation.units.find((unit) => unit.id === police.id)!;
    const risk = observation.endTurnRisk.unitsWithAttackChargesRemaining.find((unit) => unit.unitId === police.id)!;

    expect(JSON.stringify(state)).toBe(before);
    expect(publicPolice.attackPreviews).toContainEqual(expect.objectContaining({
      targetUnitId: target.id, projectedAttackChargesRemaining: 0,
    }));
    expect(risk).toMatchObject({
      unitId: police.id, moveRemaining: true, attackChargesRemaining: 1,
      legalAttackTargetIds: [target.id], suppressionTargetId: null,
    });
    expect(observation.endTurnRisk.readyUnits).toContainEqual(expect.objectContaining({ unitId: police.id }));
  });

  it('reveals only total scheduled Horde slots and possible types before spawning', () => {
    const state = createInitialState(15014, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const observation = createAgentObservation(state);

    expect(observation.horde.nextWave).toMatchObject({
      spawnTurn: 5,
      directionCount: 1,
      compositionPerDirection: { hordeZombie: 3, zombie: 3 },
      nonHordeSlotCountPerDirection: 3,
      possibleNonHordeTypes: ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'],
      final: false,
    });
    expect(JSON.stringify(observation.horde)).not.toContain('spawnGroupId');
    expect(JSON.stringify(observation.horde)).not.toContain('riotZombieCount');
  });
});
