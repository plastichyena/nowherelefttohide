import { createDefaultConfig } from '../core/config';
import { GameEngine } from '../core/engine';
import { hexKey, hexNeighbors } from '../core/hex';
import { createUnit } from '../core/state';
import { prepareTestSnapshot } from '../core/testConfig';
import type { GameAction, GameState, JsonValue } from '../core/types';
import { createAgentSessionGameFactory } from '../session/agent-adapter';
import type { SessionGameFactory } from '../session/types';

export type TerminalFixtureOutcome = 'won' | 'lost';

/** A bounded scenario, with real Core actions and the production restore path. */
export function createTerminalSessionFixture(buildId: string, outcome: TerminalFixtureOutcome): SessionGameFactory {
  const config = createDefaultConfig({
    mapMode: 'fixed',
    economy: {
      initialZombieCount: 0, initialScreamerCount: 0,
      initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 },
      initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 },
    },
    horde: { waves: [{ turn: outcome === 'won' ? 1 : 99, directionCount: 1,
      compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
  });
  const real = createAgentSessionGameFactory(buildId, config);
  return {
    ...real,
    createNew(options) {
      const runtime = real.createNew({ ...options, mapMode: 'fixed' });
      let state = runtime.exportPrivateState() as unknown as GameState;
      if (outcome === 'won') {
        const spawned = GameEngine.fromSnapshot(state).step({ type: 'EndTurn' });
        if (spawned.error) throw new Error(spawned.error.message);
        state = spawned.state as GameState;
        const final = state.units.find(unit => unit.hordeKind === 'final')!;
        // Stage the last surviving Final member (additional Pack slots are
        // legitimate wave members, but outside this last-kill fixture).
        state.units = state.units.filter(unit => unit.isPlayerUnit || unit.id === final.id);
        const guard = state.units.find(unit => unit.id === 'national-guard-1')!;
        const occupied = new Set(state.units.filter(unit => unit.id !== final.id).map(unit => hexKey(unit.position)));
        final.position = hexNeighbors(guard.position).find(position =>
          state.map.tiles.some(tile => tile.q === position.q && tile.r === position.r && tile.movementCost !== null)
          && !occupied.has(hexKey(position)))!;
        final.hp = 1;
      } else {
        const capital = state.facilities.find(facility => facility.id === 'capital')!;
        const city = state.facilities.find(facility => facility.id === 'city-1')!;
        city.workers += capital.workers;
        capital.workers = 0;
        state.units.push(createUnit(state, 'terminal-capital-zombie', 'zombie', capital.position));
      }
      prepareTestSnapshot(state);
      return real.restore({ privateState: state as unknown as JsonValue, seed: options.seed,
        agentId: options.agentId, sessionId: `terminal-${outcome}`, decision: 0, traceHeadHash: '0'.repeat(64) });
    },
  };
}

export function terminalFixtureAction(state: GameState, outcome: TerminalFixtureOutcome): GameAction {
  return outcome === 'won'
    ? { type: 'Attack', attackerId: 'national-guard-1', targetId: state.units.find(unit => unit.hordeKind === 'final')!.id }
    : { type: 'EndTurn' };
}
