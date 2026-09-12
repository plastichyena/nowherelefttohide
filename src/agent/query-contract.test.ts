import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState } from '../core/state';
import { createAgentObservation } from './observation';
import { publicQueryContract, QUERY_FILTER_SCHEMAS, validateQuerySchema } from './query-contract';
import { queryRoute } from './route-query';
import { deriveStrategicMap } from './strategic-map';

describe('machine-readable public Query contract', () => {
  it('validates actual filter fields, enums, nullable values, and conditional Route requirements', () => {
    expect(validateQuerySchema({ facilityId: null, terrain: 'forest', visibleToPlayer: false }, QUERY_FILTER_SCHEMAS.map)).toEqual([]);
    expect(validateQuerySchema({ type: 'police', proficiency: 'veteran', actionState: 'moved' }, QUERY_FILTER_SCHEMAS.units)).toEqual([]);
    expect(validateQuerySchema({ type: 'zombie' }, QUERY_FILTER_SCHEMAS.units)).not.toEqual([]);
    expect(validateQuerySchema({ operationalStatus: 'recovering', populationLimitKind: 'hard' }, QUERY_FILTER_SCHEMAS.facilities)).toEqual([]);
    expect(validateQuerySchema({ reasonCode: null, facilityType: 'barbedWire', legalOnly: true }, QUERY_FILTER_SCHEMAS.construction)).toEqual([]);
    expect(validateQuerySchema({ actionType: 'Attack', attackerId: 'police-1', targetId: 'zombie-1' }, QUERY_FILTER_SCHEMAS['legal-actions'])).toEqual([]);
    expect(validateQuerySchema({ actionType: 'Attack', targetUnitId: 'zombie-1' }, QUERY_FILTER_SCHEMAS['legal-actions'])).not.toEqual([]);
    expect(validateQuerySchema({ fromFacilityId: 'capital', toFacilityId: 'city-1', min: null }, QUERY_FILTER_SCHEMAS['population-transfers'])).toEqual([]);
    expect(validateQuerySchema({ sourceFacilityId: 'capital' }, QUERY_FILTER_SCHEMAS['population-transfers'])).not.toEqual([]);

    const unitRoute = { moverUnitId: 'police-1', destination: { kind: 'facility', id: 'capital' } };
    const referenceRoute = { source: { kind: 'facility', id: 'farm-1' }, destination: { kind: 'coordinate', position: { q: 25, r: 25 } } };
    expect(validateQuerySchema(unitRoute, QUERY_FILTER_SCHEMAS.route)).toEqual([]);
    expect(validateQuerySchema(referenceRoute, QUERY_FILTER_SCHEMAS.route)).toEqual([]);
    expect(validateQuerySchema({ destination: unitRoute.destination }, QUERY_FILTER_SCHEMAS.route)).not.toEqual([]);
    expect(validateQuerySchema({ ...unitRoute, ranges: { hexPath: { offset: 0, limit: 501 } } }, QUERY_FILTER_SCHEMAS.route)).not.toEqual([]);
    expect(validateQuerySchema({ ...unitRoute, ranges: { hexPath: { offset: 0, limit: 500 } } }, QUERY_FILTER_SCHEMAS.route)).toEqual([]);
  });

  it('publishes distinct cursor/range pagination, exact response fields, and the real failure shape', () => {
    const contract = publicQueryContract();
    expect(contract).toMatchObject({
      schemaFormat: 'JSON Schema',
      schemaVersion: '2020-12',
      contractVersion: '1.0.0',
      pagination: {
        cursor: { defaultPageSize: 100, maxPageSize: 500, revisionPinned: true, filtersPinned: true },
        routeRanges: { defaultOffset: 0, defaultLimit: 100, maxLimit: 500, hexPathIncludedByDefault: false },
      },
      failure: {
        programmatic: { behavior: 'throws SessionError', codes: ['invalid_query', 'invalid_page_size', 'invalid_cursor', 'stale_revision'] },
        cli: { stream: 'stderr', exitCode: 1 },
      },
    });
    expect(contract.targets['strategic-map'].pagination).toMatchObject({ mode: 'cursor', defaultPageSize: 100, maxPageSize: 500 });
    expect(contract.targets.route.pagination).toMatchObject({ mode: 'value-ranges', defaultLimit: 100, maxLimit: 500 });
    expect(contract.targets.route.response).toMatchObject({ payloadMode: 'value', valueType: 'RouteQueryResult' });
    expect(contract.targets.route.response.envelope.required).toContain('value');
    expect(contract.targets['strategic-map'].response).toMatchObject({ payloadMode: 'items-and-value' });
    expect(contract.targets['strategic-map'].response.envelope.required).toContain('value');
    expect(contract.failure.cli.shape.required).toEqual(['ok', 'code', 'error']);
    expect(contract.failure.cli.shape.properties).toMatchObject({ ok: { enum: [false] }, code: { type: 'string' }, error: { type: 'string' } });
    expect(validateQuerySchema({ ok: false, code: 'invalid_query', error: 'bad filters' }, contract.failure.cli.shape, 'stderr')).toEqual([]);
    expect(validateQuerySchema({ ok: false, error: { code: 'invalid_query', message: 'bad filters' } }, contract.failure.cli.shape, 'stderr')).not.toEqual([]);
  });

  it('keeps documented examples executable and response schemas aligned with pure Query output', () => {
    const contract = publicQueryContract();
    expect(validateQuerySchema(contract.examples.cli.inputFile, QUERY_FILTER_SCHEMAS.units)).toEqual([]);
    expect(validateQuerySchema(contract.examples.playTurn.filters, QUERY_FILTER_SCHEMAS.units)).toEqual([]);
    expect(validateQuerySchema(contract.examples.strategicMap.filters, QUERY_FILTER_SCHEMAS['strategic-map'])).toEqual([]);
    expect(validateQuerySchema(contract.examples.unitRoute.filters, QUERY_FILTER_SCHEMAS.route)).toEqual([]);
    expect(validateQuerySchema(contract.examples.referenceRoute.filters, QUERY_FILTER_SCHEMAS.route)).toEqual([]);

    const observation = createAgentObservation(createInitialState(15721, createDefaultConfig()));
    const unit = observation.units[0]!;
    const route = queryRoute(observation, { moverUnitId: unit.id, destination: { kind: 'facility', id: 'capital' } });
    const routeEnvelope = { sessionId: 'example', revision: 0, target: 'route', count: 1, total: 1, hasMore: false, nextCursor: null, value: route };
    expect(validateQuerySchema(routeEnvelope, contract.targets.route.response.envelope, 'response')).toEqual([]);

    const graph = deriveStrategicMap(observation);
    const nodeEnvelope = {
      sessionId: 'example', revision: 0, target: 'strategic-map', count: 1, total: graph.nodes.length,
      hasMore: graph.nodes.length > 1, nextCursor: 'next', items: [graph.nodes[0]],
      value: { mapId: graph.mapId, collection: 'nodes', nodeCount: graph.nodes.length, edgeCount: graph.edges.length, unconnectedFacilityCount: graph.unconnectedFacilityIds.length },
    };
    expect(validateQuerySchema(nodeEnvelope, contract.targets['strategic-map'].response.envelope, 'response')).toEqual([]);
    expect(validateQuerySchema(graph.edges[0], contract.targets['strategic-map'].response.envelope.properties!.items!.items!, 'edge')).toEqual([]);
  });
});
