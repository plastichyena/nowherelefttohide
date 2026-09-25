/** Run unchanged in the original checkout too. The controlled matrix holds v1.6.6 rules/summary constant. */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createAgentGame } from '../src/agent/game';
import { createDefaultConfig } from '../src/core/config';
import { createUnit, populationLedgerTotal, synchronizePopulation } from '../src/core/state';
import { getUnitLegalMoveFuelProjections } from '../src/core/movement-query';
import { SessionService } from '../src/session/service';
import { SessionStore } from '../src/session/store';
import { resolveSessionIdentity } from '../src/session/agent-adapter';
import type { GameState, JsonValue } from '../src/core/types';
import type { SessionGameFactory, SessionGameRuntime } from '../src/session/types';

const root = resolve(process.argv[2] ?? `output/v166-capacity-${Date.now()}`); mkdirSync(root, { recursive: true });
const identity = { ...resolveSessionIdentity(), buildId: 'capacity-controlled', gitCommit: null };
const old = identity.appVersion === '1.6.5';
const config = createDefaultConfig({ economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 } } });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function files(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]); }
const disk = (path: string) => statSync(path).isDirectory() ? files(path).reduce((n, p) => n + statSync(p).size, 0) : statSync(path).size;
const rows = [];
for (const arrays of old ? [true] : [true, false]) {
  const directory = join(root, arrays ? 'enumerated' : 'compact');
  function adapt(game: ReturnType<typeof createAgentGame>): SessionGameRuntime {
    const observation = () => {
      const result = game.getObservation();
      if (!old && arrays) for (const unit of result.units) Object.assign(unit, { fuelCostByLegalMove: getUnitLegalMoveFuelProjections(game.exportPrivateSessionState(), unit.id) });
      return result;
    };
    return { getApiInfo: () => game.getApiInfo(), getObservation: observation, getLegalActions: () => game.getLegalActions(),
      step: input => { const result = game.step(input.action); return { ...result, observation: observation() }; },
      isGameOver: () => game.isGameOver(), getResult: () => game.getResult(), getRunArtifact: () => game.getRunArtifact(), exportPrivateState: () => game.exportPrivateSessionState() as unknown as JsonValue };
  }
  const factory: SessionGameFactory = {
    createNew: ({ seed, agentId }) => {
      const game = createAgentGame({ buildId: identity.buildId, recordHistory: false }); game.reset({ seed, configOverrides: config });
      const state = game.exportPrivateSessionState(); const helicopter = createUnit(state, 'capacity-helicopter', 'multipurposeHelicopter', { q: 25, r: 25 });
      helicopter.flightState = 'airborne'; helicopter.movementDomain = 'air'; helicopter.canMove = true; helicopter.movement = 50; state.units.push(helicopter);
      synchronizePopulation(state); state.population.initialPopulation = populationLedgerTotal(state);
      game.restorePrivateSessionState(state, { agentId }); return adapt(game);
    },
    restore: ({ privateState, agentId, decision }) => { const game = createAgentGame({ buildId: identity.buildId, recordHistory: false }); game.restorePrivateSessionState(privateState as unknown as GameState, { agentId, decisionCount: decision }); return adapt(game); },
  };
  const store = new SessionStore(directory); const service = new SessionService(store, factory, identity);
  const started = performance.now(); service.newSession({ sessionId: 'capacity', seed: 3 });
  const initial = factory.createNew({ seed: 3, agentId: 'external' }).getObservation();
  const stripped = initial.units.map(u => { const copy = { ...u } as Record<string, unknown>; delete copy.fuelCostByLegalMove; delete copy.movementSummary; return copy; });
  const unitsBytes = bytes(initial.units), unitsWithoutEnumerationOrSummaryBytes = bytes(stripped);
  for (const action of [{ type: 'Wait', unitId: 'missing' }, { type: 'Wait', unitId: 'police-1' }, { type: 'EndTurn' }] as const) service.step('capacity', { action, decisionSummary: 'Same controlled action sequence / 日本語' });
  const sessionMs = performance.now() - started;
  const publicChunks = files(join(directory, 'pool', 'public', 'chunks'));
  const publicGzipBytes = publicChunks.reduce((n, path) => n + statSync(path).size, 0);
  const publicExpandedBytes = publicChunks.reduce((n, path) => n + gunzipSync(readFileSync(path)).length, 0);
  const sessionBytes = disk(directory);
  for (const keepDirectory of old ? [true] : [true, false]) {
    const target = join(root, `${arrays ? 'enumerated' : 'compact'}-${keepDirectory ? 'both' : 'zip'}`);
    const t = performance.now(); const exported = service.exportArtifact('capacity', target, { keepDirectory }); const exportMs = performance.now() - t;
    const zipPath = old ? `${exported.artifactPath}.zip` : exported.artifactPath;
    const readStarted = performance.now(); service.readArtifact(old ? target : zipPath); const readMs = performance.now() - readStarted;
    const directoryBytes = existsSync(target) ? disk(target) : 0;
    rows.push({ appVersion: identity.appVersion, arrays, keepDirectory, rulesHeldConstant: !old, unitCount: initial.units.length, unitsBytes, unitsWithoutEnumerationOrSummaryBytes,
      observationBytes: bytes(initial), observationGzipBytes: gzipSync(JSON.stringify(initial)).length, publicExpandedBytes, publicGzipBytes, sessionBytes,
      directoryBytes, zipBytes: disk(zipPath), artifactTotalBytes: directoryBytes + disk(zipPath), sessionMs, exportMs, readMs });
  }
}
writeFileSync(join(root, 'report.json'), JSON.stringify({ identity, compression: 'SessionStore default gzip; ZIP stored entries', measurement: 'Logical UTF-8/file bytes; Windows NTFS; allocation-unit disk occupancy not inferred. Concurrent local validation can affect timings.', control: 'v1.6.6 matrix retains movementSummary in all four variants and toggles only legacy enumeration and directory retention; native v1.6.5 is measured separately in its own checkout.', rows }, null, 2));
console.log(JSON.stringify({ root, rows }));
