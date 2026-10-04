import { expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState } from '../core/state';
import { lazyArray } from './history';
import { collectGameMetrics } from './metrics';
import { createAgentObservation } from './observation';
import type { AgentObservation } from './types';

it.each([128, 1_000])('counts next-turn fuel shortages across %i outage turns without rescanning history', turns => {
  const config = createDefaultConfig({ mapMode: 'fixed' });
  const base = createAgentObservation(createInitialState(1511, config));
  const observations: AgentObservation[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    // A turn may have multiple accepted Decisions. Only its final forecast
    // counts, and repeated outages of the same turn must count just once.
    for (const last of [false, true]) {
      observations.push({
        ...base, turn,
        facilities: base.facilities.map(facility => facility.type !== 'refinery' ? facility : {
          ...facility, production: { ...facility.production,
            powerMode: 'required', projectedPowerRequested: true, projectedPowerSupplied: false,
          },
        }),
        endTurnForecast: { ...base.endTurnForecast, fuel: {
          ...base.endTurnForecast.fuel,
          totalFuelShortage: (last ? turn % 2 === 0 : turn % 2 !== 0) ? 1 : 0,
        } },
      });
    }
  }
  const input = {
    config, initialObservation: observations[0]!, finalObservation: observations.at(-1)!,
    actions: [], events: [], result: null, agent: { id: 'metrics-scaling', version: '1' },
  };
  const reads = observations.map(() => 0);
  const metrics = collectGameMetrics({ ...input, observations: lazyArray(observations.length, index => {
    reads[index]! += 1;
    return observations[index]!;
  }) });
  expect(metrics.refineryPowerOutageTurns).toBe(turns);
  expect(metrics.refineryOutageNextTurnFuelShortageTurns).toBe(turns / 2);
  expect(metrics).toEqual(collectGameMetrics({ ...input, observations }));
  // Aggregation has several fixed passes. An outage on each turn must not add
  // another read of the first turn (costly decompression in Session history).
  expect(reads[1], 'first turn was repeatedly restored by next-turn lookups').toBeLessThan(64);

  // A missing next turn is not the next available sample; the final outage
  // also has no next-turn observation. Keep the same last-sample semantics.
  const sparse = observations.filter(observation => [1, 2, 4, 5].includes(observation.turn));
  expect(collectGameMetrics({ ...input, observations: sparse }).refineryOutageNextTurnFuelShortageTurns).toBe(1);
});
