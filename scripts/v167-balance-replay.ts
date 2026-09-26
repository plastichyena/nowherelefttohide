/** Replay captured decisions without running AI again; retain actual settlement events. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameEngine } from '../src/core/engine';
import { APP_VERSION } from '../src/agent/types';
import type { GameAction, GameEvent } from '../src/core/types';

const directory = resolve(process.argv[2]!);
for (const name of readdirSync(directory).filter(n => /^seed-\d+\.json$/.test(n))) {
  const output = resolve(directory, name.replace('.json', '.events.json'));
  if (existsSync(output) && JSON.parse(readFileSync(output, 'utf8')).terminal) continue;
  const report = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
  if (report.version !== APP_VERSION) throw new Error('Replay requires its matching release');
  const engine = new GameEngine(report.seed);
  const events: GameEvent[] = [];
  for (const action of report.actions as GameAction[]) {
    const result = engine.step(action);
    if (result.error) throw new Error(JSON.stringify(result.error));
    events.push(...result.events);
  }
  const state = engine.getState();
  for (const resource of ['food', 'civilianGoods', 'militaryGoods', 'fuel'] as const) {
    const field = `final${resource[0]!.toUpperCase()}${resource.slice(1)}`;
    if (state.resources[resource] !== report.metrics[field]) throw new Error(`Replay differs: ${field}`);
  }
  if (state.turn !== report.finalTurn || !state.gameOver) throw new Error('Replay terminal state differs');
  writeFileSync(output, JSON.stringify({ version: APP_VERSION, seed: report.seed, replayMatched: true, finalTurn: state.turn,
    terminal: { turn: state.turn, resources: state.resources, militaryPopulation: state.population.unitPopulation,
      cumulative: { unitLosses: state.statistics.unitLosses, infectionLosses: state.statistics.infectionLosses,
        starvationDeaths: state.statistics.starvationDeaths, facilitiesFallen: state.facilities.filter(f => f.status === 'ruined').map(f => f.id) } },
    events: events.filter(e => ['resource_produced', 'resource_consumed', 'artillery_fired', 'unit_destroyed', 'unit_kill_credited', 'gas_explosion'].includes(e.type)) }, null, 2));
  console.log(JSON.stringify({ version: APP_VERSION, seed: report.seed, replayMatched: true }));
}
