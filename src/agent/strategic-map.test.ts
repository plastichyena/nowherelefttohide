import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState } from '../core/state';
import type { AgentMapTileObservation } from './types';
import { createAgentObservation } from './observation';
import {
  deriveStrategicMap,
  strategicMapItems,
  type StrategicMapSource,
} from './strategic-map';

function tile(q: number, r: number, overrides: Partial<AgentMapTileObservation> = {}): AgentMapTileObservation {
  return {
    q,
    r,
    terrain: 'plain',
    passable: true,
    road: false,
    movementRoad: false,
    roadRoles: [],
    urban: false,
    facilityId: null,
    checkpointId: null,
    effectiveMovementCost: 1,
    unobstructedMovementCost: 1,
    terrainDefenseSource: 'none',
    terrainDamageMultiplier: 1,
    visibleToPlayer: true,
    hordeEntranceDirections: [],
    playerOccupancyAllowed: true,
    ...overrides,
  };
}

describe('strategic map public graph', () => {
  it('derives a stable compressed graph containing public strategic entities', () => {
    const observation = createAgentObservation(createInitialState(15701, createDefaultConfig()));
    const first = deriveStrategicMap(observation);
    const second = deriveStrategicMap(structuredClone(observation));

    expect(second).toEqual(first);
    expect(first.nodes.some((node) => node.kinds.includes('capital'))).toBe(true);
    expect(first.nodes.filter((node) => node.kinds.includes('entrance'))).toHaveLength(observation.roadBranches.length);
    expect(first.nodes.length).toBeLessThan(observation.map.tiles.length / 2);
    expect(first.edges.length).toBeLessThan(observation.map.tiles.length / 2);
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length);
    expect(new Set(first.edges.map((edge) => edge.id)).size).toBe(first.edges.length);
    expect(strategicMapItems(first, 'nodes')).toEqual(first.nodes);
    expect(strategicMapItems(first, 'edges')).toEqual(first.edges);
  });

  it('keeps degree-two compression, loop-only components, isolated roads, and unconnected facilities', () => {
    const line = [tile(0, 0), tile(1, 0), tile(2, 0), tile(3, 0)];
    const loop = [tile(5, 5), tile(6, 5), tile(5, 6)];
    const isolated = tile(8, 8);
    const disconnected = tile(9, 9, { facilityId: 'facility-off-road', urban: true });
    const source: StrategicMapSource = {
      map: {
        id: 'custom-map',
        width: 10,
        height: 10,
        tiles: [...line, ...loop, isolated, disconnected],
        roads: {
          generatorVersion: 'connector-roads-v1',
          layoutSeed: 1,
          settingsId: 'test',
          inputHash: 'test',
          segments: [
            { id: 'line', role: 'trunk', path: line.map(({ q, r }) => ({ q, r })) },
            { id: 'loop', role: 'collector', path: [{ q: 5, r: 5 }, { q: 6, r: 5 }, { q: 5, r: 6 }, { q: 5, r: 5 }] },
            { id: 'isolated', role: 'access', path: [{ q: 8, r: 8 }] },
          ],
        },
      },
      facilities: [
        { id: 'capital', type: 'capital', position: { q: 0, r: 0 } },
        { id: 'line-end', type: 'city', position: { q: 3, r: 0 } },
        { id: 'facility-off-road', type: 'farm', position: { q: 9, r: 9 } },
      ],
      checkpoints: [{ id: 'checkpoint', branchId: 'test-branch', direction: 'display', position: { q: 1, r: 0 } }],
      roadBranches: [],
    };

    const graph = deriveStrategicMap(source);
    const lineEdge = graph.edges.find((edge) => edge.from.q === 1 && edge.from.r === 0 && edge.to.q === 3 && edge.to.r === 0);
    const loopEdge = graph.edges.find((edge) => edge.from.q === 5 && edge.from.r === 5 && edge.to.q === 5 && edge.to.r === 5);

    expect(lineEdge).toMatchObject({ length: 2, roadRoles: ['trunk'] });
    expect(graph.nodes.find((node) => node.position.q === 1 && node.position.r === 0)?.kinds).toContain('checkpoint');
    expect(loopEdge).toMatchObject({ length: 3, roadRoles: ['collector'] });
    expect(graph.nodes.find((node) => node.position.q === 5 && node.position.r === 5)?.kinds).toContain('loop-anchor');
    expect(graph.nodes.find((node) => node.position.q === 8 && node.position.r === 8)?.kinds).toContain('isolated-road');
    expect(graph.nodes.find((node) => node.position.q === 9 && node.position.r === 9)).toMatchObject({ connectedToRoad: false });
    expect(graph.unconnectedFacilityIds).toEqual(['facility-off-road']);
  });

  it('does not let enemy state change topology or stable IDs', () => {
    const observation = createAgentObservation(createInitialState(15702, createDefaultConfig()));
    const changedEnemyState = structuredClone(observation) as typeof observation & { hiddenEnemyState?: unknown };
    changedEnemyState.zombies.reverse();
    changedEnemyState.hiddenEnemyState = [{ id: 'private-only', position: { q: 1, r: 1 } }];

    expect(deriveStrategicMap(changedEnemyState)).toEqual(deriveStrategicMap(observation));
  });
});
