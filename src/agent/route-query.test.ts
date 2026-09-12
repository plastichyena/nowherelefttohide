import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import { createInitialState } from '../core/state';
import { hexKey, hexNeighbors } from '../core/hex';
import { createAgentObservation } from './observation';
import type { AgentMapTileObservation } from './types';
import {
  MAX_ROUTE_SEQUENCE_LIMIT,
  RouteQueryInputError,
  queryRoute,
  type RouteQuerySource,
} from './route-query';

function expectRouteError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected RouteQueryInputError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RouteQueryInputError);
    expect(error).toMatchObject({ code });
  }
}

function lineTile(q: number): AgentMapTileObservation {
  return {
    q,
    r: 0,
    terrain: 'plain',
    passable: true,
    road: true,
    movementRoad: true,
    roadRoles: ['trunk'],
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
  };
}

describe('public route query', () => {
  it('uses the Core legal-move projection for a player unit and omits raw Hexes by default', () => {
    const observation = createAgentObservation(createInitialState(15711, createDefaultConfig()));
    const unit = observation.units.find((candidate) => candidate.fuelCostByLegalMove.length > 0)!;
    const legal = unit.fuelCostByLegalMove[0]!;
    const result = queryRoute(observation, {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: legal.destination },
    });

    expect(result.routeAvailable).toBe(true);
    expect(result.destinationCenterReached).toBe(true);
    expect(result.currentSingleAction).toMatchObject({
      reachable: true,
      actionRequired: true,
      reason: 'reachable_now',
      fuelCost: legal.fuelCost,
      effectiveMovementCost: legal.effectiveMovementCost,
    });
    expect(result.hexPath.included).toBe(false);
    expect(result.hexPath.items).toEqual([]);
    expect(result.hexPath.totalCount).toBe(result.pathLength! + 1);

    const withPath = queryRoute(observation, {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: legal.destination },
      includeHexPath: true,
    });
    expect(withPath.hexPath.items[0]?.position).toEqual(unit.position);
    expect(withPath.hexPath.items.at(-1)?.position).toEqual(legal.destination);
  });

  it('separates terrain path existence, public center occupancy, and adjacent Facility candidates', () => {
    const observation = createAgentObservation(createInitialState(15712, createDefaultConfig()));
    const mover = observation.units[0]!;
    const facility = observation.facilities.find((candidate) => hexKey(candidate.position) !== hexKey(mover.position))!;
    const blocker = { ...structuredClone(observation.units[1] ?? mover), id: 'public-blocker', position: { ...facility.position } };
    observation.units.push(blocker);

    const result = queryRoute(observation, {
      moverUnitId: mover.id,
      destination: { kind: 'facility', id: facility.id },
    });

    expect(result.terrainPathExists).toBe(true);
    expect(result.routeAvailable).toBe(false);
    expect(result.destinationCenterReached).toBe(false);
    expect(result.unavailableReason).toBe('destination_publicly_occupied');
    expect(result.adjacentCandidates.length).toBeGreaterThan(0);
    expect(result.adjacentCandidates).toEqual([...result.adjacentCandidates].sort((left, right) =>
      left.effectiveMovementCost - right.effectiveMovementCost || left.position.q - right.position.q || left.position.r - right.position.r));
  });

  it('marks Facility-to-Facility paths as reference routes without unit MP claims', () => {
    const observation = createAgentObservation(createInitialState(15713, createDefaultConfig()));
    const [source, destination] = observation.facilities;
    const result = queryRoute(observation, {
      source: { kind: 'facility', id: source!.id },
      destination: { kind: 'facility', id: destination!.id },
    });

    expect(result.mode).toBe('reference');
    expect(result.terrainPathExists).toBe(true);
    expect(result.currentSingleAction).toEqual({
      reachable: null,
      actionRequired: null,
      reason: 'reference_route_has_no_movement_actor',
      movementMode: null,
      movementBudget: null,
      effectiveMovementCost: null,
      fuelCost: null,
      projectedFuelAfterMove: null,
    });
  });

  it('reports a visible wall MP cost, an already-acted unit, and a zero-length route distinctly', () => {
    const state = createInitialState(15716, createDefaultConfig());
    const unit = state.units.find((candidate) => candidate.isPlayerUnit)!;
    const occupied = new Set(state.units.map((candidate) => hexKey(candidate.position)));
    const destination = hexNeighbors(unit.position).find((position) => {
      const tile = state.map.tiles.find((candidate) => hexKey(candidate) === hexKey(position));
      return tile?.playerOccupancyAllowed && tile.movementCost !== null && !occupied.has(hexKey(position))
        && !state.facilities.some((facility) => hexKey(facility.position) === hexKey(position));
    })!;
    state.barbedWire.push({ id: 'wire-route-test', position: destination, hp: 10, maxHp: 20, builtTurn: state.turn });
    const readyObservation = createAgentObservation(state);
    const ready = queryRoute(readyObservation, {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: destination },
      includeHexPath: true,
    });
    expect(ready.publicMovementConditions.visibleBarbedWireHexesEntered).toBe(1);
    expect(ready.effectiveMovementCost).toBe(5);
    expect(ready.currentSingleAction).toMatchObject({ reachable: true, effectiveMovementCost: 5 });

    unit.actionState = 'acted';
    const acted = queryRoute(createAgentObservation(state), {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: destination },
    });
    expect(acted.routeAvailable).toBe(true);
    expect(acted.currentSingleAction).toMatchObject({ reachable: false, reason: 'unit_already_acted' });

    const alreadyThere = queryRoute(readyObservation, {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: unit.position },
    });
    expect(alreadyThere).toMatchObject({ routeAvailable: true, pathLength: 0, effectiveMovementCost: 0 });
    expect(alreadyThere.currentSingleAction).toMatchObject({
      reachable: true,
      actionRequired: false,
      reason: 'already_at_destination',
    });
  });

  it('rejects an enemy actor and a source that contradicts the player unit position', () => {
    const observation = createAgentObservation(createInitialState(15714, createDefaultConfig()));
    const unit = observation.units[0]!;
    const zombie = observation.zombies[0];
    if (zombie) {
      expectRouteError(() => queryRoute(observation, {
        moverUnitId: zombie.id,
        destination: { kind: 'coordinate', position: unit.position },
      }), 'enemy_unit_not_allowed');
    }
    expectRouteError(() => queryRoute(observation, {
      moverUnitId: unit.id,
      source: { kind: 'coordinate', position: { q: unit.position.q + 1, r: unit.position.r } },
      destination: { kind: 'coordinate', position: unit.position },
    }), 'source_unit_mismatch');
  });

  it('paginates and fully restores long node, Supply transition, and Hex columns with 100/500 bounds', () => {
    const length = 140;
    const tiles = Array.from({ length }, (_, q) => lineTile(q));
    const source: RouteQuerySource = {
      phase: 'player',
      map: {
        id: 'long-map',
        width: length,
        height: 1,
        tiles,
        roads: {
          generatorVersion: 'connector-roads-v1',
          layoutSeed: 1,
          settingsId: 'test',
          inputHash: 'test',
          segments: [{ id: 'trunk', role: 'trunk', path: tiles.map(({ q, r }) => ({ q, r })) }],
        },
      },
      facilities: [],
      checkpoints: Array.from({ length }, (_, q) => ({ id: `cp-${q}`, branchId: 'branch', direction: 'display', position: { q, r: 0 } })),
      roadBranches: [],
      units: [],
      zombies: [],
      barbedWire: [],
      supply: { suppliedTileKeys: tiles.filter((tile) => tile.q % 2 === 0).map(hexKey) },
    };
    const baseInput = {
      source: { kind: 'coordinate' as const, position: { q: 0, r: 0 } },
      destination: { kind: 'coordinate' as const, position: { q: length - 1, r: 0 } },
      includeHexPath: true,
    };
    const first = queryRoute(source, baseInput);
    expect(first.strategicNodes.items).toHaveLength(100);
    expect(first.supplyTransitions.items).toHaveLength(100);
    expect(first.hexPath.items).toHaveLength(100);
    expect(first.strategicNodes.totalCount).toBe(length);
    expect(first.supplyTransitions.totalCount).toBe(length);
    expect(first.hexPath.totalCount).toBe(length);

    for (const sequence of ['strategicNodes', 'supplyTransitions', 'hexPath'] as const) {
      const restored: unknown[] = [];
      for (let offset = 0; offset < length; offset += 100) {
        const result = queryRoute(source, { ...baseInput, ranges: { [sequence]: { offset, limit: 100 } } });
        restored.push(...result[sequence].items);
      }
      expect(restored).toHaveLength(length);
    }
    expectRouteError(() => queryRoute(source, {
      ...baseInput,
      ranges: { hexPath: { limit: MAX_ROUTE_SEQUENCE_LIMIT + 1 } },
    }), 'invalid_range');
  });

  it('is unchanged when private enemy positions change outside public vision', () => {
    const state = createInitialState(15715, createDefaultConfig());
    const visible = getPlayerVisibleTileKeys(state);
    const enemy = state.units.find((unit) => !unit.isPlayerUnit)!;
    const occupied = new Set(state.units.map((unit) => hexKey(unit.position)));
    const replacement = state.map.tiles.find((tile) =>
      tile.movementCost !== null && !visible.has(tile.key) && !occupied.has(tile.key))!;
    const changed = structuredClone(state);
    changed.units.find((unit) => unit.id === enemy.id)!.position = { q: replacement.q, r: replacement.r };
    const firstObservation = createAgentObservation(state);
    const secondObservation = createAgentObservation(changed);
    expect(secondObservation.zombies).toEqual(firstObservation.zombies);
    const unit = firstObservation.units.find((candidate) => candidate.fuelCostByLegalMove.length > 0)!;
    const destination = unit.fuelCostByLegalMove[0]!.destination;

    expect(queryRoute(secondObservation, {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: destination },
      includeHexPath: true,
    })).toEqual(queryRoute(firstObservation, {
      moverUnitId: unit.id,
      destination: { kind: 'coordinate', position: destination },
      includeHexPath: true,
    }));
  });
});
