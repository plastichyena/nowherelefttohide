import { clearScenarioCheckpoints } from './testConfig';
import { describe, expect, it } from 'vitest';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  OBSERVATION_API_VERSION,
  SAVE_FORMAT_VERSION as PUBLIC_SAVE_FORMAT_VERSION,
} from '../agent/types';
import { createAgentGame, createAgentPublicConfig } from '../agent/game';
import { CHECKPOINT_SCHEMA_VERSION, SESSION_SCHEMA_VERSION } from '../session/types';
import { forecastUnitCombatAtDistance } from './combat-query';
import { CONFIG_VERSION, createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { hexDistance, hexKey } from './hex';
import { FIXED_MAP_ID } from './map';
import { createInitialState, createUnit, populationLedgerTotal, synchronizePopulation } from './state';
import type { DeepPartial, GameConfig, GameState } from './types';
import { decodeSaveCode, encodeSaveCode, SAVE_FORMAT_VERSION } from '../persistence/save';

const QUIET_CONFIG: DeepPartial<GameConfig> = {
  economy: {
    initialZombieCount: 0, initialScreamerCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
    initialResources: { food: 100_000, civilianGoods: 100_000, militaryGoods: 100_000, fuel: 100_000 },
  },
  refugees: { arrivalIntervalMin: 100, arrivalIntervalMax: 100 },
  horde: {
    waves: [{ turn: 100, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }],
  },
};

function quietConfig(overrides: DeepPartial<GameConfig> = {}): GameConfig {
  return createDefaultConfig({ ...QUIET_CONFIG, ...overrides });
}

function resetLedgerBaseline(state: GameState): void {
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state)
    - state.population.cumulativeArrivals
    + state.population.cumulativeDepartures
    - state.population.cumulativeReinforcements;
}

describe('v1.6.1 acceptance', { timeout: 30_000 }, () => {
  it('pins every release and persistence boundary', () => {
    expect({
      app: APP_VERSION,
      rules: CONFIG_VERSION,
      save: SAVE_FORMAT_VERSION,
      publicSave: PUBLIC_SAVE_FORMAT_VERSION,
      agent: AGENT_API_VERSION,
      observation: OBSERVATION_API_VERSION,
      bridge: BRIDGE_API_VERSION,
      artifact: ARTIFACT_SCHEMA_VERSION,
      session: SESSION_SCHEMA_VERSION,
      checkpoint: CHECKPOINT_SCHEMA_VERSION,
      map: FIXED_MAP_ID,
    }).toEqual({
      app: '1.6.7', rules: '17.0.0', save: 24, publicSave: '24',
      agent: '22.0.0', observation: '22.0.0', bridge: '22.0.0', artifact: '21.0.0',
      session: '18.0.0', checkpoint: '18.0.0', map: 'fixed-51x51-v9',
    });
  });

  it('uses one seed-selected Oil Field and deterministic neutral survivors without consuming gameplay RNG', () => {
    const first = createInitialState(16101, createDefaultConfig());
    const second = createInitialState(16101, createDefaultConfig());
    expect(second).toEqual(first);
    expect(first.facilities.filter((facility) => facility.type === 'oilField')).toHaveLength(1);
    const neutral = first.facilities.filter((facility) => facility.owner === 'none' && facility.type !== 'nuclearPowerPlant');
    expect(neutral.length).toBeGreaterThan(0);
    expect(neutral.every((facility) => facility.workers >= 1 && facility.workers <= Math.min(10, facility.workerCapacity))).toBe(true);
    expect(neutral.every((facility) => facility.earlyCaptureSurvivorStatus === 'available')).toBe(true);
  });

  it('places 40 Normal Zombies away from Capital and outside the selected Army Base vision', () => {
    const state = createInitialState(16102, createDefaultConfig());
    const capital = state.facilities.find((facility) => facility.type === 'capital')!;
    const base = state.facilities.find((facility) => facility.type === 'armyBase')!;
    const normals = state.units.filter((unit) => unit.type === 'zombie');
    expect(normals).toHaveLength(40);
    expect(normals.every((unit) => hexDistance(unit.position, capital.position) >= 8)).toBe(true);
    expect(normals.every((unit) => hexDistance(unit.position, base.position) > state.config.units.zombie.vision)).toBe(true);
    expect(new Set(normals.map((unit) => hexKey(unit.position))).size).toBe(40);
  });

  it('pins Recon combat, logistics, suppression, visibility and reanimation rules', () => {
    const state = createInitialState(16103, quietConfig());
    const config = state.config.units.reconTeam;
    expect(config).toMatchObject({
      hp: 25, recruitAttack: 9, movement: 10, vision: 10, range: 6, population: 5,
      maxFuel: 44, maxMilitaryGoods: 40, fixedMilitaryGoodsUpkeepPerTurn: 0,
      suppressionMilitaryGoodsCost: 1, suppressionCivilianDamageRate: 0.5,
      noiseClass: 'medium', noiseRadius: 6, reanimationUnitType: 'soldierZombie',
    });
    const recon = createUnit(state, 'recon-test', 'reconTeam', { q: 25, r: 25 });
    recon.currentMilitaryGoods = 6;
    for (let distance = 1; distance <= 6; distance += 1) {
      expect(forecastUnitCombatAtDistance(state, recon, distance)).toMatchObject({
        canAttack: true, militaryGoodsCost: 6, projectedMilitaryGoodsAfterAttack: 0,
      });
    }
    recon.currentMilitaryGoods = 5;
    expect(forecastUnitCombatAtDistance(state, recon, 1)).toMatchObject({
      canAttack: false, reason: 'insufficient_military_goods', militaryGoodsCost: 6,
    });
  });

  it('applies the Range-1 shortage rule only to Police, Riot Police and Soldier', () => {
    const state = createInitialState(16104, quietConfig());
    for (const type of ['police', 'riotPolice', 'nationalGuard'] as const) {
      const unit = createUnit(state, `short-${type}`, type, { q: 25, r: 25 });
      unit.currentMilitaryGoods = 1;
      expect(forecastUnitCombatAtDistance(state, unit, 1)).toMatchObject({
        canAttack: true,
        militaryGoodsCost: 1,
        projectedMilitaryGoodsAfterAttack: 0,
        effectiveAttack: Math.max(1, Math.ceil(unit.attack * 0.2)),
      });
    }
  });

  it('expires every unsecured survivor pool on the tenth completed EndTurn', () => {
    const engine = new GameEngine(16105, quietConfig());
    for (let completed = 0; completed < 10; completed += 1) {
      const result = engine.step({ type: 'EndTurn' });
      expect(result.error).toBeNull();
    }
    const state = engine.getState();
    const neutral = state.facilities.filter((facility) => facility.owner === 'none' && facility.type !== 'nuclearPowerPlant');
    expect(state.facilities.find(f => f.type === 'nuclearPowerPlant')?.earlyCaptureSurvivorStatus).toBe('notApplicable');
    expect(neutral.every((facility) => facility.workers === 0)).toBe(true);
    expect(neutral.every((facility) => facility.earlyCaptureSurvivorStatus === 'lost')).toBe(true);
    expect(state.events.some((event) => event.type === 'survivors_expired')).toBe(true);
  });

  it('emits each Screamer pulse once and keeps exact radius out of public events and Config', () => {
    const game = createAgentGame();
    game.reset({
      seed: 16106,
      configOverrides: {
        economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 } },
        refugees: { arrivalIntervalMin: 100, arrivalIntervalMax: 100 },
        horde: {
          warningLeadTurns: 2,
          waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 1 }, final: true }],
          specialZombieWeights: { zombie: 0, policeZombie: 0, soldierZombie: 0, riotZombie: 0, hunterZombie: 0, gasZombie: 0, screamerZombie: 100 },
        },
      },
    });
    const result = game.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    const screams = result.events.filter((event) => event.type === 'screamer_scream');
    expect(screams).toHaveLength(1);
    expect(screams[0]?.payload).toEqual({
      noiseClass: 'extraLarge',
      message: { ja: '悍ましい叫び声(特大ノイズ)', en: 'Horrifying scream (extra-large noise)' },
    });
    expect(JSON.stringify(screams)).not.toMatch(/radius|position|source/i);
    const publicConfig = createAgentPublicConfig(createDefaultConfig()) as unknown as Record<string, unknown>;
    expect(JSON.stringify(publicConfig)).not.toContain('screamRadius');
    expect(JSON.stringify(publicConfig)).not.toContain('"noiseRadius":6');
  });

  it('round-trips all v1.6.1 state fields in Save 18 without rerolling', () => {
    const state = createInitialState(16107, createDefaultConfig());
    clearScenarioCheckpoints(state);
    resetLedgerBaseline(state);
    const code = encodeSaveCode(state);
    const decoded = decodeSaveCode(code);
    expect(decoded).toMatchObject({ valid: true, errors: [] });
    expect(decoded.state).toEqual(state);
  });
});
