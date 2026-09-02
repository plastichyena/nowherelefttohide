import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { deriveUnitRecovery } from './recovery';
import { createInitialState, populationLedgerTotal, synchronizePopulation } from './state';
import { singleFinalWave } from './testConfig';

function rebalance(state: ReturnType<typeof createInitialState>): void {
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state);
}

function recoveryEngine(seed = 301): GameEngine {
  return new GameEngine(seed, createDefaultConfig({
    horde: singleFinalWave(4),
    economy: {
      initialZombieCount: 0,
      initialResources: { food: 10_000, civilianGoods: 10_000, militaryGoods: 10_000, fuel: 10_000 },
    },
  }));
}

describe('v1.2.6 unit recovery and automatic suppression', () => {
  it.each([
    [{ moved: false, attacked: true, intercepted: false, suppressed: false }, 'combat', 3],
    [{ moved: false, attacked: false, intercepted: true, suppressed: false }, 'combat', 3],
    [{ moved: false, attacked: false, intercepted: false, suppressed: true }, 'combat', 3],
    [{ moved: true, attacked: false, intercepted: false, suppressed: false }, 'rest', 5],
    [{ moved: false, attacked: false, intercepted: false, suppressed: false }, 'rest', 5],
  ] as const)('classifies activity %j as %s recovery', (activity, expectedClass, expectedAmount) => {
    const state = createInitialState(300, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const police = state.units.find((unit) => unit.id === 'police-1')!;
    police.position = { ...state.facilities.find((facility) => facility.id === 'capital')!.position };
    police.activity = { ...activity };
    expect(deriveUnitRecovery(state, police)).toMatchObject({
      recoveryClass: expectedClass,
      baseAmount: expectedAmount,
      timing: 'nextPlayerTurnStart',
    });
  });

  it('applies ceil combat/rest recovery once at the next player turn start and emits details', () => {
    const engine = recoveryEngine();
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const capital = snapshot.facilities.find((facility) => facility.id === 'capital')!;
    const police = snapshot.units.find((unit) => unit.id === 'police-1')!;
    const guard = snapshot.units.find((unit) => unit.id === 'national-guard-1')!;
    police.position = { ...capital.position };
    guard.position = { q: capital.position.q + 1, r: capital.position.r };
    police.hp = 10;
    guard.hp = 20;
    police.activity.attacked = true;
    guard.activity.moved = true;
    rebalance(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();

    const result = engine.step({ type: 'EndTurn' });
    expect(result.state.units.find((unit) => unit.id === police.id)?.hp).toBe(13);
    expect(result.state.units.find((unit) => unit.id === guard.id)?.hp).toBe(30);
    expect(result.events.filter((event) => event.type === 'unit_recovered').map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitId: police.id, recoveryClass: 'combat', baseAmount: 3, actualAmount: 3, rate: 0.1 }),
        expect.objectContaining({ unitId: guard.id, recoveryClass: 'rest', baseAmount: 10, actualAmount: 10, rate: 0.2 }),
      ]),
    );
  });

  it('does not recover out of supply and never exceeds maximum HP', () => {
    const engine = recoveryEngine(302);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const police = snapshot.units.find((unit) => unit.id === 'police-1')!;
    const guard = snapshot.units.find((unit) => unit.id === 'national-guard-1')!;
    police.position = { q: 1, r: 1 };
    police.hp = 10;
    guard.hp = guard.maxHp - 2;
    rebalance(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.state.units.find((unit) => unit.id === police.id)?.hp).toBe(10);
    expect(result.state.units.find((unit) => unit.id === guard.id)?.hp).toBe(guard.maxHp);
    expect(result.events.some((event) => event.type === 'unit_recovered' && event.payload.unitId === police.id)).toBe(false);
  });

  it('contains infection without attack rights and suppresses automatically when attack remains', () => {
    const engine = recoveryEngine(303);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const farm = snapshot.facilities.find((facility) => facility.id === 'farm-1')!;
    const police = snapshot.units.find((unit) => unit.id === 'police-1')!;
    farm.infected = 2;
    farm.workers = 20;
    police.position = { ...farm.position };
    police.hp = 10;
    police.canAttack = false;
    police.activity.attacked = true;
    rebalance(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).state.facilities.find((facility) => facility.id === farm.id)).toMatchObject({ workers: 20, infected: 2 });

    const ready = engine.getState() as ReturnType<typeof createInitialState>;
    const readyPolice = ready.units.find((unit) => unit.id === police.id)!;
    readyPolice.canAttack = true;
    readyPolice.activity = { moved: false, attacked: false, intercepted: false, suppressed: false };
    rebalance(ready);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: ready }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.state.facilities.find((facility) => facility.id === farm.id)?.infected).toBe(0);
    expect(result.events.findIndex((event) => event.type === 'infection_suppressed')).toBeLessThan(
      result.events.findIndex((event) => event.type === 'unit_recovered' && event.payload.unitId === police.id),
    );
    expect(result.events.some((event) => event.type === 'unit_recovered' && event.payload.recoveryClass === 'combat')).toBe(true);
  });

  it('rejects the retired SuppressInfection input without mutating state', () => {
    const engine = recoveryEngine(304);
    const before = engine.getState();
    const result = engine.step({ type: 'SuppressInfection', unitId: 'police-1', facilityId: 'capital' } as never);
    expect(result.error?.code).toBe('unknown_action');
    expect(engine.getState()).toEqual(before);
    expect(engine.getLegalActions().some((action) => (action as { type: string }).type === 'SuppressInfection')).toBe(false);
  });
});
