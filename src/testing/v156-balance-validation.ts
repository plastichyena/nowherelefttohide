import { writeFileSync, mkdirSync } from 'node:fs';
import { createAgentGame } from '../agent/game';
import { APP_VERSION } from '../agent/types';
import { hexDistance } from '../core/hex';

const reports = [];
for (const seed of [1, 7, 17]) for (const useWalls of [false, true]) {
  const game = createAgentGame({ recordHistory: false });
  let observation = game.reset({ seed });
  let built = 0, destroyed = 0, absorbed = 0, steps = 0;
  const contacts: Record<string, number> = {};
  const powerOperation: Array<{ turn: number; runningPowerPlants: string[] }> = [];
  while (!game.isGameOver() && observation.turn < 100) {
    for (const facility of observation.facilities) {
      if (observation.zombies.some(z => hexDistance(z.position, facility.position) === 0)) contacts[facility.id] ??= observation.turn;
    }
    powerOperation.push({ turn: observation.turn, runningPowerPlants: observation.facilities.filter(f => (f.type === 'powerPlant' || f.type === 'windPowerPlant') && f.production.estimatedPowerGeneration > 0).map(f => f.id) });
    const wall = useWalls ? game.getLegalActions().filter(a => a.type === 'BuildBarbedWire').sort((a,b) => {
      const distance = (p: typeof a.position) => Math.min(100, ...observation.zombies.map(z => hexDistance(z.position,p)));
      return distance(a.position)-distance(b.position) || a.position.q-b.position.q || a.position.r-b.position.r;
    })[0] : undefined;
    if (wall) {
      const result = game.step(wall); if (result.error) throw new Error(result.error.message);
      observation = result.observation; built++;steps++;
    }
    const result = game.step({ type: 'EndTurn' });
    if (result.error) throw new Error(result.error.message);
    for (const event of result.events.filter(e => e.type === 'barbed_wire_damaged')) {
      if (event.payload.destroyed === true) destroyed++;
      if (event.payload.protectingHuman === true) absorbed += Number(event.payload.damage);
    }
    observation = result.observation;steps++;
  }
  const result = game.getResult();
  reports.push({ seed, condition: useWalls ? 'one-legal-wall-per-turn-then-EndTurn' : 'information-and-recovery-only-EndTurn', actionSequencesDiffer: useWalls, steps, turn: observation.turn, result, built, civilianGoodsCost: built*5, militaryGoodsCost: built*5, visibleDestroyed: destroyed, humanDamageAbsorbed: absorbed, firstPublicContactTurn: contacts, powerOperation, technicalFailure: false });
  console.log(JSON.stringify({ seed, useWalls, turn: observation.turn, built, destroyed }));
}
mkdirSync('output/v156', { recursive: true });
writeFileSync('output/v156/balance.json', JSON.stringify({ appVersion: APP_VERSION, comparison: 'Same initial conditions; different action sequences, not an identical-action causal experiment or a win-rate guarantee.', reports }, null, 2));
