import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createCityPopulationSnapshot, createUnit, synchronizePopulation } from './state';
import type { GameState } from './types';

const quietConfig = () => createDefaultConfig({
  economy: {
    initialZombieCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
    initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 },
  },
  horde: { waves: [{ turn: 99, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
});

function load(engine: GameEngine, state: GameState): void {
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error?.message ?? null).toBeNull();
}

describe('v1.5.4 engine integration', () => {
  it('immediately ruins and loses an empty Capital when any Zombie occupies it', () => {
    const engine = new GameEngine(1541, quietConfig());
    const state = engine.getState() as GameState;
    const capital = state.facilities.find((facility) => facility.type === 'capital')!;
    const city = state.facilities.find((facility) => facility.type === 'city')!;
    city.owner = 'player';
    city.status = 'owned';
    city.operationalStatus = 'operational';
    city.populationOperationalTurn = 1;
    city.securedOrder = 100;
    city.workers = capital.workers;
    capital.workers = 0;
    const zombie = createUnit(state, 'empty-capital-zombie', 'zombie', capital.position);
    zombie.canMove = true;
    state.units.push(zombie);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.gameOver).toBe(true);
    expect(result.result).toMatchObject({ outcome: 'lost', reason: 'capitalLost' });
    expect(result.state.facilities.find((facility) => facility.id === capital.id)?.status).toBe('ruined');
  });

  it('builds empty Temporary Housing, completes it next Player Turn, then decommissions it for no refund', () => {
    const engine = new GameEngine(1542, quietConfig());
    const candidate = engine.getConstructibleFacilityPositionCandidates('temporaryHousing').find((entry) => entry.legal)!;
    const beforeBuild = engine.getState().resources.civilianGoods;
    const built = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'temporaryHousing', position: candidate.position });
    expect(built.error).toBeNull();
    const housingId = built.events.find((event) => event.type === 'constructible_built')!.payload.facilityId as string;
    expect(built.state.facilities.find((facility) => facility.id === housingId)).toMatchObject({
      type: 'temporaryHousing', operationalStatus: 'building', workers: 0, infected: 0,
    });
    expect(built.state.resources.civilianGoods).toBe(beforeBuild - 25);

    const nextTurn = engine.step({ type: 'EndTurn' });
    expect(nextTurn.error).toBeNull();
    expect(nextTurn.state.facilities.find((facility) => facility.id === housingId)?.operationalStatus).toBe('operational');
    const beforeDecommission = nextTurn.state.resources.civilianGoods;
    const removed = engine.step({ type: 'DecommissionConstructibleFacility', facilityId: housingId });
    expect(removed.error).toBeNull();
    expect(removed.state.facilities.some((facility) => facility.id === housingId)).toBe(false);
    expect(removed.state.resources.civilianGoods).toBe(beforeDecommission);
  });

  it('emits one Radius-8 Wind pulse before the Zombie snapshot and excludes disabled Wind', () => {
    const engine = new GameEngine(1543, quietConfig());
    const state = engine.getState() as GameState;
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    load(engine, state);
    const operational = engine.step({ type: 'EndTurn' });
    expect(operational.events.filter((event) => event.type === 'noise_emitted' && event.payload.sourceFacilityId === wind.id)).toHaveLength(1);
    expect(operational.events.find((event) => event.type === 'noise_emitted' && event.payload.sourceFacilityId === wind.id)?.payload.radius).toBe(8);

    const disabledState = operational.state as GameState;
    disabledState.gameOver = false;
    disabledState.result = null;
    disabledState.phase = 'player';
    disabledState.facilities.find((facility) => facility.id === wind.id)!.operationalStatus = 'disabled';
    load(engine, disabledState);
    const disabled = engine.step({ type: 'EndTurn' });
    expect(disabled.events.some((event) => event.type === 'noise_emitted' && event.payload.sourceFacilityId === wind.id)).toBe(false);
  });

  it('removes empty Temporary Housing on Zombie contact without spawning another Zombie', () => {
    const engine = new GameEngine(1545, quietConfig());
    const candidate = engine.getConstructibleFacilityPositionCandidates('temporaryHousing').find((entry) => entry.legal)!;
    const built = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'temporaryHousing', position: candidate.position });
    const housingId = built.events.find((event) => event.type === 'constructible_built')!.payload.facilityId as string;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const state = engine.getState() as GameState;
    const housing = state.facilities.find((facility) => facility.id === housingId)!;
    const zombie = createUnit(state, 'housing-contact-zombie', 'zombie', housing.position);
    zombie.canMove = false;
    zombie.canAttack = false;
    state.units.push(zombie);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.facilities.some((facility) => facility.id === housingId)).toBe(false);
    expect(result.state.units.find((unit) => unit.id === zombie.id)?.position).toEqual(housing.position);
    expect(result.events.some((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === housingId)).toBe(false);
  });

  it('builds Wind without counting the initial Wind against the player-built limit and starts noise after completion', () => {
    const engine = new GameEngine(1546, quietConfig());
    const candidate = engine.getConstructibleFacilityPositionCandidates('windPowerPlant').find((entry) => entry.legal)!;
    const built = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'windPowerPlant', position: candidate.position });
    expect(built.error).toBeNull();
    const windId = built.events.find((event) => event.type === 'constructible_built')!.payload.facilityId as string;
    const completionTurn = engine.step({ type: 'EndTurn' });
    expect(completionTurn.error).toBeNull();
    expect(completionTurn.events.some((event) => event.type === 'noise_emitted' && event.payload.sourceFacilityId === windId)).toBe(false);
    expect(completionTurn.state.facilities.find((facility) => facility.id === windId)?.operationalStatus).toBe('operational');
    const activeTurn = engine.step({ type: 'EndTurn' });
    expect(activeTurn.error).toBeNull();
    expect(activeTurn.events.filter((event) => event.type === 'noise_emitted' && event.payload.sourceKind === 'windPower')).toHaveLength(2);
  });

  it('wins after the Final roster has no Pending or map units even while a non-Final Zombie remains', () => {
    const finalConfig = quietConfig();
    finalConfig.horde.waves = [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }];
    const engine = new GameEngine(1547, finalConfig);
    const spawned = engine.step({ type: 'EndTurn' });
    expect(spawned.error).toBeNull();
    const state = spawned.state as GameState;
    state.units = state.units.filter((unit) => unit.hordeKind !== 'final');
    state.horde.finalHordeStatus = 'defeated';
    state.statistics.finalHordeDefeated = true;
    const nonFinal = createUnit(state, 'remaining-non-final', 'zombie', { q: 5, r: 5 });
    state.units.push(nonFinal);
    load(engine, state);
    const human = state.units.find((unit) => unit.isPlayerUnit)!;

    const result = engine.step({ type: 'Wait', unitId: human.id });
    expect(result.error).toBeNull();
    expect(result.result).toMatchObject({ outcome: 'won', reason: 'stateSecured' });
    expect(result.state.units.some((unit) => unit.id === nonFinal.id)).toBe(true);
  });
});
