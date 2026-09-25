/** Reproducible UI fixtures and portable replay from real public GameActions. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAgentGame } from '../src/agent/game';
import { createDefaultConfig } from '../src/core/config';
import { exportSaveJson, decodeSaveCode, encodeSaveCode } from '../src/persistence/save';
import { createAgentSessionGameFactory, resolveSessionIdentity } from '../src/session/agent-adapter';
import { SessionService } from '../src/session/service';
import { SessionStore } from '../src/session/store';
import { sha256Json } from '../src/session/hash';
import type { GameAction } from '../src/core/types';

const directory = resolve(`output/playwright/v166-acceptance-${Date.now()}`); mkdirSync(directory, { recursive: true });
const config = createDefaultConfig({ facilities: { powerPlant: { production: { powerGeneration: 100 } } },
  economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } },
  refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 }, horde: { waves: [{ turn: 99, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] } });
const game = createAgentGame({ buildId: 'v166-local-acceptance' }); game.reset({ seed: 3, configOverrides: config });
const actions: GameAction[] = [];
function act(action: GameAction) { const result = game.step(action); if (result.error) throw new Error(`${JSON.stringify(action)}: ${result.error.code}`); actions.push(action); return result.observation; }
function save(name: string) { writeFileSync(resolve(directory, `${name}.json`), exportSaveJson(game.exportPrivateSessionState())); }
const build = game.getLegalActions().find(a => a.type === 'BuildConstructibleFacility' && a.facilityType === 'reliefSupplyCenter');
if (!build) throw new Error('No legal center build');
act(build); save('building'); act({ type: 'EndTurn' });
const id = game.getObservation().facilities.find(f => f.type === 'reliefSupplyCenter')!.id;
act({ type: 'AssignWorkers', facilityId: 'power-plant-1', workers: 20 });
act({ type: 'AssignWorkers', facilityId: id, workers: 5 }); save('operating');
const forecast = game.getObservation().endTurnForecast;
act({ type: 'EndTurn' });
const actual = game.getObservation().resources;
if (actual.food !== forecast.food.endingStock || actual.civilianGoods !== forecast.civilianGoods.endingStock) throw new Error('Forecast/actual mismatch');
act({ type: 'SetPowerSupply', facilityId: id, enabled: false }); save('power-off');
act({ type: 'EndTurn' }); act({ type: 'SetPowerSupply', facilityId: id, enabled: true });
act({ type: 'AssignWorkers', facilityId: id, workers: 0 }); save('empty');
const refundBefore = game.getObservation().resources.civilianGoods;
act({ type: 'DecommissionConstructibleFacility', facilityId: id });
if (game.getObservation().resources.civilianGoods !== refundBefore + 25) throw new Error('Refund mismatch');
const state = game.exportPrivateSessionState(); const restored = decodeSaveCode(encodeSaveCode(state));
if (!restored.valid || sha256Json(restored.state) !== sha256Json(state)) throw new Error('Save round-trip mismatch');

const identity = { ...resolveSessionIdentity(), buildId: 'v166-local-acceptance' };
const service = new SessionService(new SessionStore(resolve(directory, 'sessions')), createAgentSessionGameFactory(identity.buildId, config), identity);
service.newSession({ sessionId: 'relief', seed: 3 });
for (const [index, action] of actions.entries()) {
  const result = service.step('relief', { action, expectedRevision: index, decisionSummary: `救援物資センター / Relief Supply Center: ${action.type}` });
  if (!result.decisionRecord.accepted) throw new Error(`Portable rejected ${action.type}`);
}
const checkpoint = service.saveCheckpoint('relief'); service.loadCheckpoint('relief', checkpoint.checkpointId, 'branch');
service.step('branch', { action: { type: 'DecommissionConstructibleFacility', facilityId: id }, decisionSummary: 'Already decommissioned: must reject without another refund' });
const exported = service.exportArtifact('branch', resolve(directory, 'relief.nlth-artifact.zip'));
const replay = service.replayArtifact(exported.artifactPath);
writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ directory, actions, forecast: { food: forecast.food, civilianGoods: forecast.civilianGoods }, actual, exported, replay, versions: game.getApiInfo() }, null, 2));
writeFileSync(resolve('output/v166-acceptance-path.txt'), directory);
console.log(JSON.stringify({ directory, actions: actions.length, replay, artifactPath: exported.artifactPath }));
