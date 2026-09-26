import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionService } from '../src/session/service';
import { SessionStore } from '../src/session/store';
import { createAgentSessionGameFactory, resolveSessionIdentity } from '../src/session/agent-adapter';
import { createAgentGame } from '../src/agent/game';
import { createDefaultConfig } from '../src/core/config';
import { exportSaveJson } from '../src/persistence/save';
import type { GameAction } from '../src/core/types';
const directory = resolve('output/playwright/v167'); mkdirSync(directory, { recursive: true });
const config = createDefaultConfig({ vision: { capital: 50 }, facilities: { powerPlant: { production: { powerGeneration: 100 } } },
  economy: { initialZombieCount: 0, initialGasCount: { min: 0, max: 0 }, initialHunterCount: { min: 0, max: 0 }, initialScreamerCount: 0,
    initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } },
  refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
  horde: { warningLeadTurns: 1, waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] } });
const game = createAgentGame(); game.reset({ seed: 4, configOverrides: config });
const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v167-browser-fixture', NLTH_GIT_COMMIT: 'a'.repeat(40) });
const service = new SessionService(new SessionStore(resolve(directory, `sessions-${Date.now()}`)), createAgentSessionGameFactory(identity.buildId, config), identity);
service.newSession({ sessionId: 'browser', seed: 4 });
for (const action of [
  { type: 'AssignWorkers', facilityId: 'power-plant-1', workers: 10 },
  { type: 'AssignWorkers', facilityId: 'military-factory-1', workers: 10 },
  { type: 'EndTurn' }, { type: 'EndTurn' }, { type: 'EndTurn' },
] as GameAction[]) {
  if (game.step(action).error) throw Error(`Fixture rejected ${action.type}`);
  if (!service.step('browser', { action, decisionSummary: `v1.6.7 検証 / ${action.type}` }).accepted) throw Error('Session rejected fixture');
}
writeFileSync(resolve(directory, 'accelerated.json'), exportSaveJson(game.exportPrivateSessionState()));
writeFileSync(resolve(directory, 'config.json'), JSON.stringify(config));
writeFileSync(resolve(directory, 'observation.json'), JSON.stringify(game.getObservation()));
const output = service.exportArtifact('browser', resolve(directory, `v167-${Date.now()}.zip`));
console.log(JSON.stringify({ directory, zip: output.artifactPath, zombies: game.getObservation().zombies.map(u => ({ id: u.id, position: u.position, baseMovement: u.baseMovement, appliedMovementBonus: u.appliedMovementBonus, effectiveMovement: u.effectiveMovement })) }));
