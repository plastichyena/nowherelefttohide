import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'output/v167-balance-complete');
const currentDirectory = resolve(process.argv[3] ?? resolve(directory, '1.6.7'));
const resourceNames = ['food', 'civilianGoods', 'militaryGoods', 'fuel'];
const reports = [];
for (const version of ['1.6.6', '1.6.7']) for (const seed of [1, 2, 4]) {
  const source = version === '1.6.7' ? currentDirectory : resolve(directory, version);
  const raw = JSON.parse(readFileSync(resolve(source, `seed-${seed}.json`), 'utf8'));
  const replay = JSON.parse(readFileSync(resolve(source, `seed-${seed}.events.json`), 'utf8'));
  if (!replay.replayMatched || !replay.terminal || raw.failure) throw new Error('Incomplete validation');
  const sample = t => {
    if (!t) return null;
    const events = replay.events.filter(e => e.turn === t.turn && e.phase === 'economy');
    const amount = (type, resource) => events.filter(e => e.type === type && e.payload.resource === resource).reduce((n, e) => n + e.payload.amount, 0);
    return { turn: t.turn,
      resources: Object.fromEntries(resourceNames.map(resource => [resource, {
        stockBeforeEndTurn: t.stockBefore[resource], stockAfterEndTurn: t.stockAfter[resource],
        actualEconomyProduction: amount('resource_produced', resource), actualEconomyConsumption: amount('resource_consumed', resource),
        forecastProduction: t.forecast[resource].projectedProduction,
        maintenanceRequired: t.forecast[resource].maintenanceRequired ?? null,
        maintenanceShortage: t.forecast[resource].maintenanceShortage ?? null,
        inputAllocated: t.forecast[resource].productionInputAllocated ?? null,
      }])) ,
      militaryPopulationBeforeEndTurn: t.militaryPopulation,
      factories: t.factories.map(f => ({ id: f.facilityId, operatingWorkers: f.operatingWorkers, inputs: f.inputs, outputs: f.outputs, stoppedReason: f.stoppedReason })),
      unfilledMilitaryGoodsRefillDemand: t.forecast.militaryGoods.totalUnfilledRefillDemand,
      cumulative: { unitLosses: t.statistics.unitLosses, infectionLosses: t.statistics.infectionLosses,
        starvationDeaths: t.statistics.starvationDeaths, facilitiesFallen: t.facilitiesFallen },
    };
  };
  const artillery = { attacks: raw.artilleryEvents.length, shellShots: 0, shellMilitaryGoods: 0, directKills: 0, blastKills: 0, gasChainKills: 0,
    regularPromotions: raw.metrics.regularPromotionsByType.fieldArtillery,
    veteranPromotions: raw.metrics.veteranPromotionsByType.fieldArtillery,
    veteranAttributedKills: raw.metrics.veteranZombieKillsByType.fieldArtillery };
  for (const shot of raw.artilleryEvents) {
    const fired = shot.events.find(e => e.type === 'artillery_fired');
    if (fired) { artillery.shellShots++; artillery.shellMilitaryGoods += fired.payload.militaryGoodsCost; }
    for (const e of shot.events.filter(e => e.type === 'unit_destroyed' && !e.payload.isPlayerUnit)) {
      if (e.payload.cause === 'gas_explosion') artillery.gasChainKills++;
      else if (fired && e.payload.cause === 'artillery') {
        if (e.payload.q === fired.payload.impactHex.q && e.payload.r === fired.payload.impactHex.r) artillery.directKills++;
        else artillery.blastKills++;
      }
    }
  }
  const waves = raw.metrics.hordeWaves.map(w => {
    const batches = raw.waveEvents.filter(e => e.type === 'horde_spawn_batch' && e.payload.waveIndex === w.index);
    const firstCombats = Object.entries(raw.firstWaveCombat).filter(([group]) => group.startsWith(`wave-${w.index}-`));
    return { index: w.index, scheduledTurn: w.spawnTurn, final: w.final, directions: w.directions,
      frozenBaseCount: w.baseWaveUnitCount, frozenCommittedCount: w.committedWaveUnitCount,
      actualSpawned: batches.reduce((n, e) => n + e.payload.spawnedThisBatch, 0),
      firstCombatTurn: firstCombats.length ? Math.min(...firstCombats.map(([, turn]) => turn)) : null,
      firstCombatByGroup: Object.fromEntries(firstCombats) };
  });
  reports.push({ version, seed, policy: raw.policy, limits: raw.limits, outcome: raw.outcome, finalTurn: raw.finalTurn,
    acceptedActionCount: raw.actions.length,
    replayMatched: replay.replayMatched, capitalMinimum: raw.capitalMinimum, capitalTransfers: raw.capitalTransfers,
    samples: Object.fromEntries([10, 20, 35, 50, 70].map(turn => [turn, sample(raw.turns.find(t => t.turn === turn))])),
    terminal: { ...replay.terminal, latestEndTurn: sample(raw.turns.at(-1)) }, waves, artillery,
    barbedWireBuilt: raw.metrics.barbedWireBuilt, earlyFacilityLosses: raw.metrics.earlyFacilityLosses,
    totalUnfilledMilitaryGoodsRefill: raw.metrics.unfilledMilitaryGoodsRefillByType,
  });
}
writeFileSync(process.argv[4] ?? 'validation/v167-balance.json', JSON.stringify({
  method: 'Same Balanced14 policy and limits; v1.6.6 baseline d7c71b9 and v1.6.7. Private instrumentation never feeds AI decisions. All accepted actions replayed against matching rules.',
  timing: 'Samples are each requested Turn EndTurn: stocks before/after that action, actual economy resource events, and forecast/worker/military values immediately before it. Null means no such EndTurn before game termination. Terminal contains actual post-action final stocks, population and cumulative losses; latestEndTurn separately records the last settlement, which can precede the final player action or stop mid-phase.',
  contact: 'First recorded attack/interception/damage involving a scheduled-wave unit, including neutral base combat. Null means no recorded combat before termination. Not an estimate of unseen movement or adjacency.',
  losses: 'Cumulative infectionLosses and starvationDeaths use distinct Core counters. facilitiesFallen includes neutral sites as well as formerly owned sites; earlyFacilityLosses is the separate owned-loss metric.',
  capital: 'Minimum is the capital resident count (workers, including infected residents) over every accepted action boundary, including terminal loss. Transfers count accepted TransferPopulation actions into the capital, not automatic refugee admissions.',
  artillery: 'Shots, actual MG cost, direct impact Hex kills, adjacent blast kills and resulting Gas chain kills are separated. Veteran-attributed kills are not all artillery kills. No shots means this sample cannot assess artillery sustain or late-game proficiency.',
  reports,
}, null, 2) + '\n');
console.log(JSON.stringify(reports.map(r => ({ version: r.version, seed: r.seed, turn: r.finalTurn, firstCombat: r.waves[0].firstCombatTurn, artillery: r.artillery.attacks, wires: r.barbedWireBuilt })), null, 2));
