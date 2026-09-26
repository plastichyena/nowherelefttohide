/** Same balanced policy/limits on both revisions; observations never feed extra private data to AI. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAgentGame, DEFAULT_AGENT_RUNNER_LIMITS } from '../src/agent/runner';
import { createAgentGame } from '../src/agent/game';
import { APP_VERSION } from '../src/agent/types';
import { calculateEconomyPlan } from '../src/core/economy-query';

const out = resolve(process.argv[2] ?? `output/v167-balance/${APP_VERSION}`);
mkdirSync(out, { recursive: true });
for (const seed of (process.argv[3]?.split(',').map(Number) ?? [1, 2, 4])) {
  const turns: unknown[] = [], waveEvents: unknown[] = [], artilleryEvents: unknown[] = [];
  const actions: unknown[] = [];
  const waveUnits = new Map<string, string>();
  const firstWaveCombat: Record<string, number> = {};
  let capitalMinimum = Infinity, capitalTransfers = 0;
  const run = runAgentGame(seed, { strategy: 'balanced', summaryOnly: true, limits: DEFAULT_AGENT_RUNNER_LIMITS,
    gameFactory: (gameSeed, config, agent) => {
      const game = createAgentGame({ recordHistory: false });
      game.reset({ seed: gameSeed, configOverrides: config, agent: { id: agent.id } });
      const step = game.step.bind(game);
      game.step = action => {
        const before = game.exportPrivateSessionState();
        capitalMinimum = Math.min(capitalMinimum, before.facilities.find(f => f.type === 'capital')!.workers);
        const plan = action.type === 'EndTurn' ? calculateEconomyPlan(before) : null;
        const result = step(action);
        if (result.error) return result;
        const after = game.exportPrivateSessionState();
        actions.push(action);
        for (const unit of [...before.units, ...after.units]) if (unit.spawnGroupId?.startsWith('wave-')) waveUnits.set(unit.id, unit.spawnGroupId);
        capitalMinimum = Math.min(capitalMinimum, after.facilities.find(f => f.type === 'capital')!.workers);
        if (action.type === 'TransferPopulation' && action.toFacilityId === 'capital') capitalTransfers++;
        const fresh = after.events.slice(before.events.length);
        for (const event of fresh.filter(e => /^(attack|interception|damage|army_base_interception)$/.test(e.type))) {
          for (const value of Object.values(event.payload)) {
            const group = typeof value === 'string' ? waveUnits.get(value) : undefined;
            if (group) firstWaveCombat[group] ??= event.turn;
          }
        }
        waveEvents.push(...fresh.filter(e => /horde|wave|site_fallen|combat/.test(e.type)));
        if (action.type === 'AttackHex' || (action.type === 'Attack' && before.units.find(u => u.id === action.attackerId)?.type === 'fieldArtillery')) {
          artilleryEvents.push({ turn: before.turn, action, proficiency: before.units.find(u => u.id === action.attackerId)?.proficiency,
            events: fresh.filter(e => ['artillery_fired', 'damage', 'unit_destroyed', 'unit_kill_credited', 'gas_explosion'].includes(e.type)) });
        }
        if (plan) turns.push({ turn: before.turn, stockBefore: before.resources, stockAfter: after.resources,
          forecast: plan.forecast, militaryPopulation: before.population.unitPopulation,
          factories: plan.facilities.filter(f => before.facilities.some(s => s.id === f.facilityId && ['militaryFactory', 'reliefSupplyCenter'].includes(s.type))),
          statistics: after.statistics, facilitiesFallen: after.facilities.filter(f => f.status === 'ruined').map(f => f.id),
          artillery: after.units.filter(u => u.type === 'fieldArtillery').map(u => ({ id: u.id, proficiency: u.proficiency, regularDirectKills: u.regularZombieKills })) });
        return result;
      };
      return game;
    },
  });
  const report = { version: APP_VERSION, seed, policy: 'balanced', limits: DEFAULT_AGENT_RUNNER_LIMITS,
    outcome: run.metrics.outcome, failure: run.failure, finalTurn: run.finalObservation?.turn,
    capitalMinimum, capitalTransfers, firstWaveCombat, actions, turns, waveEvents, artilleryEvents, metrics: run.metrics };
  writeFileSync(resolve(out, `seed-${seed}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ version: APP_VERSION, seed, outcome: report.outcome, finalTurn: report.finalTurn, failure: run.failure?.message ?? null }));
}
