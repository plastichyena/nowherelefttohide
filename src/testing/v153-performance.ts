import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig } from '../core/config';
import { GameEngine } from '../core/engine';
import { createPublicFacilityProjection } from '../core/public-entities';
import { createCityPopulationSnapshot, createUnit, synchronizePopulation } from '../core/state';
import { hexNeighbors } from '../core/hex';
import type { FacilityState, GameAction, GameConfig, GameState } from '../core/types';

const RUNS = 5;
const QUERY_OPERATIONS = 25;
const OUTPUT_PATH = fileURLToPath(new URL('./fixtures/v153-performance-evidence.json', import.meta.url));

interface TimingSummary {
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

function benchmarkConfig(overrides: Parameters<typeof createDefaultConfig>[0] = {}): GameConfig {
  return createDefaultConfig({
    economy: {
      initialZombieCount: 0,
      initialHunterCount: { min: 0, max: 0 },
      initialGasCount: { min: 0, max: 0 },
      initialResources: { food: 100_000, civilianGoods: 100_000, militaryGoods: 100_000, fuel: 100_000 },
    },
    horde: { waves: [{ turn: 99, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
    ...overrides,
  });
}

function finalizeFixture(state: GameState): GameState {
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  return structuredClone(state);
}

function loadFixture(snapshot: GameState): GameEngine {
  const engine = new GameEngine(snapshot.seed, snapshot.config);
  const result = engine.step({ type: 'LoadSnapshot', snapshot: structuredClone(snapshot) });
  if (result.error) throw new Error(`Fixture load failed: ${result.error.code}: ${result.error.message}`);
  return engine;
}

function ownArmyBase(state: GameState, workers: number): FacilityState {
  const base = state.facilities.find((facility) => facility.type === 'armyBase');
  const capital = state.facilities.find((facility) => facility.type === 'capital');
  if (!base?.armyBase || !capital) throw new Error('Army Base or Capital missing');
  base.owner = 'player';
  base.status = 'owned';
  base.operationalStatus = 'operational';
  base.populationOperationalTurn = state.turn;
  base.securedOrder = 20;
  base.workers = workers;
  capital.workers -= workers;
  return base;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function summarize(samples: number[]): TimingSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const round = (value: number) => Number(value.toFixed(4));
  return {
    samplesMs: samples.map(round),
    medianMs: round(sorted[Math.floor(sorted.length / 2)]!),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]!),
    maxMs: round(sorted.at(-1)!),
  };
}

function stepResultDigest(result: ReturnType<GameEngine['step']>): string {
  return digest({
    error: result.error?.code ?? null,
    gameOver: result.gameOver,
    units: result.state.units.map((unit) => ({ id: unit.id, type: unit.type, q: unit.position.q, r: unit.position.r, hp: unit.hp })),
    bases: result.state.facilities.filter((facility) => facility.type === 'armyBase'),
    eventTypes: result.events.map((event) => event.type),
    statistics: result.state.statistics,
  });
}

function measureAction(snapshot: GameState, action: GameAction): TimingSummary & { deterministicDigest: string } {
  // Fixture construction, cloning and LoadSnapshot deliberately stay outside
  // each timed interval. One untimed run warms module-level runtime paths.
  loadFixture(snapshot).step(action);
  const samples: number[] = [];
  const digests = new Set<string>();
  for (let index = 0; index < RUNS; index += 1) {
    const engine = loadFixture(snapshot);
    const started = performance.now();
    const result = engine.step(action);
    samples.push(performance.now() - started);
    if (result.error) throw new Error(`Measured action failed: ${result.error.code}: ${result.error.message}`);
    digests.add(stepResultDigest(result));
  }
  if (digests.size !== 1) throw new Error('Fixed action produced non-deterministic results');
  return { ...summarize(samples), deterministicDigest: [...digests][0]! };
}

function observeAction(snapshot: GameState, action: GameAction) {
  const result = loadFixture(snapshot).step(action);
  if (result.error) throw new Error(`Observed action failed: ${result.error.code}: ${result.error.message}`);
  return result;
}

function gasChainFixture(): { snapshot: GameState; action: GameAction } {
  const state = new GameEngine(15301, benchmarkConfig()).getState() as GameState;
  const guard = state.units.find((unit) => unit.type === 'nationalGuard');
  const police = state.units.find((unit) => unit.type === 'police');
  if (!guard || !police) throw new Error('Initial Human units missing');
  guard.position = { q: 25, r: 25 };
  police.position = { q: 25, r: 26 };
  state.units = state.units.filter((unit) => unit.isPlayerUnit);
  for (let index = 0; index < 6; index += 1) {
    const gas = createUnit(state, `performance-gas-${index}`, 'gasZombie', { q: 26 + index, r: 25 });
    gas.hp = 1;
    state.units.push(gas);
  }
  return {
    snapshot: finalizeFixture(state),
    action: { type: 'Attack', attackerId: guard.id, targetId: 'performance-gas-0' },
  };
}

function armyBaseInterceptionFixture(): { snapshot: GameState; action: GameAction } {
  const state = new GameEngine(15302, benchmarkConfig()).getState() as GameState;
  const base = ownArmyBase(state, 8);
  state.units = state.units.filter((unit) => unit.isPlayerUnit);
  const start = hexNeighbors(base.position).find((position) =>
    !state.units.some((unit) => unit.position.q === position.q && unit.position.r === position.r)
  );
  if (!start) throw new Error('No adjacent Army Base entry Hex');
  const zombie = createUnit(state, 'performance-base-horde', 'hordeZombie', start);
  zombie.hordeKind = 'periodic';
  zombie.spawnGroupId = 'performance-base-group';
  state.units.push(zombie);
  return { snapshot: finalizeFixture(state), action: { type: 'EndTurn' } };
}

function zombiePhaseFixture(): { snapshot: GameState; action: GameAction } {
  const config = benchmarkConfig();
  config.economy.initialZombieCount = 25;
  const state = new GameEngine(15303, config).getState() as GameState;
  return { snapshot: finalizeFixture(state), action: { type: 'EndTurn' } };
}

function recruitmentForecastFixture(): { snapshot: GameState; baseId: string } {
  const config = benchmarkConfig({ checkpoint: { initialSupplyRadius: 8 } });
  const state = new GameEngine(15304, config).getState() as GameState;
  const base = ownArmyBase(state, 0);
  const capital = state.facilities.find((facility) => facility.type === 'capital');
  if (!capital) throw new Error('Capital missing');
  capital.workers -= state.config.units.nationalGuard.population;
  state.pendingUnitProductions.push({
    id: 'performance-army-base-order',
    cityFacilityId: base.id,
    unitType: 'nationalGuard',
    population: state.config.units.nationalGuard.population,
    readyTurn: state.turn + 1,
    powerReady: false,
  });
  return { snapshot: finalizeFixture(state), baseId: base.id };
}

function measureRecruitmentForecast(snapshot: GameState, baseId: string) {
  const cachedSamples: number[] = [];
  const freshSamples: number[] = [];
  let publicResultsDetached = true;
  for (let sample = 0; sample < RUNS; sample += 1) {
    const engine = loadFixture(snapshot);
    const query = engine.getQuery();
    const first = query.getPublicFacilityProjection(baseId);
    if (!first?.armyBase?.pendingRecruitment) throw new Error('Recruitment projection missing');
    const startedCached = performance.now();
    for (let operation = 0; operation < QUERY_OPERATIONS; operation += 1) {
      publicResultsDetached &&= query.getPublicFacilityProjection(baseId) !== first;
    }
    cachedSamples.push(performance.now() - startedCached);

    const fresh = engine.getState() as GameState;
    const facility = fresh.facilities.find((candidate) => candidate.id === baseId);
    if (!facility) throw new Error('Forecast Army Base missing');
    const startedFresh = performance.now();
    for (let operation = 0; operation < QUERY_OPERATIONS; operation += 1) {
      createPublicFacilityProjection(facility, fresh);
    }
    freshSamples.push(performance.now() - startedFresh);
  }
  return {
    operationsPerSample: QUERY_OPERATIONS,
    sameRevisionCached: { ...summarize(cachedSamples), publicResultsDetached },
    freshDetachedState: summarize(freshSamples),
  };
}

async function staticEvidence() {
  const controllerPath = fileURLToPath(new URL('../ui/controller.ts', import.meta.url));
  const source = await readFile(controllerPath, 'utf8');
  const applyStart = source.indexOf('  private apply(action: GameAction): boolean {');
  const applyEnd = source.indexOf('  private notifyImportantEvents(', applyStart);
  const applyBody = source.slice(applyStart, applyEnd);
  const updateBoardStart = source.indexOf('  private updateBoard(): void {');
  const updateBoardEnd = source.indexOf('  private updateNoiseDebugOverlay()', updateBoardStart);
  const updateBoardBody = source.slice(updateBoardStart, updateBoardEnd);
  return {
    source: 'src/ui/controller.ts',
    acceptedActionCallsUpdateView: applyBody.includes('this.updateView();'),
    acceptedActionDoesNotCallRenderGame: !applyBody.includes('this.renderGame();'),
    acceptedActionDoesNotCreateBoard: !applyBody.includes('this.createBoard();'),
    autosaveLimitedToEndTurnOrGameOver: applyBody.includes("if (result.gameOver || (action.type === 'EndTurn' && this.state.phase === 'player')) this.autosave();"),
    autosaveCallsInAcceptedActionPath: applyBody.match(/this\.autosave\(\)/g)?.length ?? 0,
    boardUpdatesExistingScene: updateBoardBody.includes('this.boardScene.updateState(render);'),
  };
}

async function main(): Promise<void> {
  const gas = gasChainFixture();
  const interception = armyBaseInterceptionFixture();
  const zombiePhase = zombiePhaseFixture();
  const forecast = recruitmentForecastFixture();
  const gasObserved = observeAction(gas.snapshot, gas.action);
  const interceptionObserved = observeAction(interception.snapshot, interception.action);
  const zombieObserved = observeAction(zombiePhase.snapshot, zombiePhase.action);
  const gasExplosions = gasObserved.events.filter((event) => event.type === 'gas_explosion').length;
  const baseInterceptions = interceptionObserved.events.filter((event) => event.type === 'interception' && typeof event.payload.facilityId === 'string').length;
  if (gasExplosions !== 6) throw new Error(`Gas fixture resolved ${gasExplosions} explosions instead of 6`);
  if (baseInterceptions === 0) throw new Error('Army Base fixture did not intercept');
  const evidence = {
    schemaVersion: '1.0.0',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    methodology: {
      runsPerScenario: RUNS,
      fixtureConstructionAndLoadSnapshotTimed: false,
      clock: 'performance.now()',
      percentile: 'nearest-rank p95; with five runs this is the maximum sample',
      thresholds: null,
    },
    scenarios: [
      { name: 'gas-death-chain-six', seed: 15301, operation: 'Attack', observedGasExplosions: gasExplosions, ...measureAction(gas.snapshot, gas.action) },
      { name: 'army-base-distance-zero-interception', seed: 15302, operation: 'EndTurn', observedBaseInterceptions: baseInterceptions, ...measureAction(interception.snapshot, interception.action) },
      {
        name: 'zombie-phase-25-normal-ai-idle',
        seed: 15303,
        operation: 'EndTurn',
        initialZombieCount: 25,
        observedZombieIdleEvents: zombieObserved.events.filter((event) => event.type === 'zombie_idle').length,
        observedUnitMoves: zombieObserved.events.filter((event) => event.type === 'unit_moved').length,
        ...measureAction(zombiePhase.snapshot, zombiePhase.action),
      },
    ],
    armyBaseRecruitmentForecast: {
      seed: 15304,
      ...measureRecruitmentForecast(forecast.snapshot, forecast.baseId),
    },
    staticEvidence: await staticEvidence(),
    limitations: [
      'One desktop Node.js process with other operating-system activity uncontrolled.',
      'Engine step timings include normal result cloning and validation, but exclude fixture construction and LoadSnapshot.',
      'These measurements establish a v1.5.3 reference only; they are not absolute pass/fail thresholds and do not claim SOG05 or device improvement.',
      'No browser layout, paint, GPU, mobile thermal, or autosave serialization timing is included.',
    ],
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT_PATH, scenarios: evidence.scenarios.map(({ name, medianMs, p95Ms }) => ({ name, medianMs, p95Ms })), query: evidence.armyBaseRecruitmentForecast }, null, 2));
}

await main();
