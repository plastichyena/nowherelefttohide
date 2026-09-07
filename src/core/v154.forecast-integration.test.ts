import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { singleFinalWave } from './testConfig';
import type { ConstructibleFacilityType } from './types';

function forecastEngine(): GameEngine {
  return new GameEngine(15420, createDefaultConfig({
    economy: {
      initialResources: { fuel: 0, civilianGoods: 10_000 },
      initialZombieCount: 0,
      initialHunterCount: { min: 0, max: 0 },
      initialGasCount: { min: 0, max: 0 },
    },
    horde: singleFinalWave(50),
  }));
}

function firstBuildPosition(engine: GameEngine, facilityType: ConstructibleFacilityType) {
  const candidate = engine.getQuery().getConstructibleFacilityPositionCandidates(facilityType)
    .find((entry) => entry.legal);
  if (!candidate) throw new Error(`No legal ${facilityType} position`);
  return candidate.position;
}

function expectExpired(query: ReturnType<GameEngine['getQuery']>): void {
  expect(() => query.getNextTurnPenaltyForecast()).toThrow('Query revision has expired');
}

describe('v1.5.4 committed next-turn penalty forecast', () => {
  it('refreshes after accepted build/transfer/decommission actions and keeps cache and RNG detached', () => {
    const engine = forecastEngine();
    const initialQuery = engine.getQuery();
    const initialRng = structuredClone(engine.getState().rngState);
    const initialForecast = initialQuery.getNextTurnPenaltyForecast();
    expect(engine.getState().rngState).toEqual(initialRng);
    initialForecast.overcrowding.additionalFood = -1;
    expect(initialQuery.getNextTurnPenaltyForecast().overcrowding.additionalFood).toBeGreaterThanOrEqual(0);

    for (let index = 0; index < 2; index += 1) {
      const oldQuery = engine.getQuery();
      const result = engine.step({
        type: 'BuildConstructibleFacility',
        facilityType: 'temporaryHousing',
        position: firstBuildPosition(engine, 'temporaryHousing'),
      });
      expect(result.error).toBeNull();
      expectExpired(oldQuery);
      expect(engine.getQuery().getNextTurnPenaltyForecast().targetTurn).toBe(engine.getState().turn + 1);
    }

    const buildTurnQuery = engine.getQuery();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expectExpired(buildTurnQuery);
    const housings = engine.getState().facilities
      .filter((facility) => facility.constructible && facility.type === 'temporaryHousing')
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(housings).toHaveLength(2);
    expect(housings.every((facility) => facility.operationalStatus === 'operational')).toBe(true);

    const capital = engine.getState().facilities.find((facility) => facility.type === 'capital')!;
    let oldQuery = engine.getQuery();
    expect(engine.step({
      type: 'TransferPopulation', fromFacilityId: capital.id, toFacilityId: housings[0]!.id, people: 1,
    }).error).toBeNull();
    expectExpired(oldQuery);
    expect(engine.getQuery().getNextTurnPenaltyForecast().housingOutage.outageCount).toBe(0);

    oldQuery = engine.getQuery();
    expect(engine.step({
      type: 'TransferPopulation', fromFacilityId: capital.id, toFacilityId: housings[1]!.id, people: 1,
    }).error).toBeNull();
    expectExpired(oldQuery);
    const shortageQuery = engine.getQuery();
    expect(shortageQuery.getNextTurnPenaltyForecast().housingOutage).toMatchObject({ active: true, outageCount: 1 });
    expect(shortageQuery.getCrisisSummary().map((entry) => entry.reasonCode)).toContain(
      'temporary_housing_outage_forecast',
    );

    const rngBeforeWindForecast = structuredClone(engine.getState().rngState);
    const windResult = engine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'windPowerPlant',
      position: firstBuildPosition(engine, 'windPowerPlant'),
    });
    expect(windResult.error).toBeNull();
    expectExpired(shortageQuery);
    const withCommittedWind = engine.getQuery();
    expect(withCommittedWind.getNextTurnPenaltyForecast().housingOutage).toMatchObject({ active: false, outageCount: 0 });
    expect(withCommittedWind.getCrisisSummary().map((entry) => entry.reasonCode)).not.toContain(
      'temporary_housing_outage_forecast',
    );
    expect(engine.getState().rngState).toEqual(rngBeforeWindForecast);

    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expectExpired(withCommittedWind);
    const builtWind = engine.getState().facilities.find(
      (facility) => facility.constructible && facility.type === 'windPowerPlant',
    );
    expect(builtWind?.operationalStatus).toBe('operational');
    expect(engine.getQuery().getNextTurnPenaltyForecast().housingOutage.active).toBe(false);

    oldQuery = engine.getQuery();
    expect(engine.step({
      type: 'TransferPopulation', fromFacilityId: housings[1]!.id, toFacilityId: capital.id, people: 1,
    }).error).toBeNull();
    expectExpired(oldQuery);
    const beforeDecommission = engine.getQuery();
    expect(engine.step({ type: 'DecommissionConstructibleFacility', facilityId: housings[1]!.id }).error).toBeNull();
    expectExpired(beforeDecommission);
    expect(engine.getState().facilities.some((facility) => facility.id === housings[1]!.id)).toBe(false);
    expect(engine.getQuery().getNextTurnPenaltyForecast().housingOutage.active).toBe(false);
  });
});
