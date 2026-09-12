import type {
  BaseTerrain,
  CheckpointPolicy,
  CheckpointRole,
  CheckpointStatus,
  ConstructibleFacilityType,
  FacilityOperationalStatus,
  FacilityStatus,
  FacilityType,
  GameAction,
  HumanUnitType,
  UnitActionState,
  UnitProficiency,
} from '../core/types';

export type QuerySchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

/** JSON Schema 2020-12 subset, shared by validation and API discovery. */
export interface QuerySchema {
  type?: QuerySchemaType | readonly QuerySchemaType[];
  properties?: Record<string, QuerySchema>;
  items?: QuerySchema;
  required?: string[];
  additionalProperties?: false;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  default?: string | number | boolean | null;
  oneOf?: QuerySchema[];
  description?: string;
}

const HUMAN_UNIT_TYPES = ['police', 'nationalGuard', 'riotPolice'] as const satisfies readonly HumanUnitType[];
const FACILITY_TYPES = ['capital', 'city', 'farm', 'civilianFactory', 'militaryFactory', 'refinery', 'powerPlant', 'windPowerPlant', 'simpleFarm', 'civilianDroneBase', 'temporaryHousing', 'armyBase'] as const satisfies readonly FacilityType[];
const CONSTRUCTIBLE_TYPES = ['simpleFarm', 'civilianDroneBase', 'temporaryHousing', 'windPowerPlant'] as const satisfies readonly ConstructibleFacilityType[];
const FACILITY_STATUSES = ['unowned', 'owned', 'ruined'] as const satisfies readonly FacilityStatus[];
const FACILITY_OPERATIONAL_STATUSES = ['building', 'operational', 'stopped', 'infected', 'disabled', 'recovering', 'ruined'] as const satisfies readonly FacilityOperationalStatus[];
const CHECKPOINT_STATUSES = ['operational', 'remnant', 'ruined', 'abandoned'] as const satisfies readonly CheckpointStatus[];
const CHECKPOINT_ROLES = ['active', 'standby', 'dormant', 'remnant', 'ruined', 'abandoned'] as const satisfies readonly CheckpointRole[];
const CHECKPOINT_POLICIES = ['passThrough', 'normal', 'strict'] as const satisfies readonly CheckpointPolicy[];
const UNIT_ACTION_STATES = ['ready', 'moved', 'acted', 'destroyed'] as const satisfies readonly UnitActionState[];
const UNIT_PROFICIENCIES = ['recruit', 'regular', 'veteran'] as const satisfies readonly UnitProficiency[];
const TERRAINS = ['plain', 'forest', 'mountain', 'water'] as const satisfies readonly BaseTerrain[];
const QUERYABLE_ACTION_TYPES = ['BuildBarbedWire', 'Move', 'Attack', 'Wait', 'AssignWorkers', 'TransferPopulation', 'SetCheckpointPolicy', 'SetPowerSupply', 'BuildConstructibleFacility', 'BuildCheckpoint', 'RelocateCheckpoint', 'ActivateCheckpoint', 'TurnAwayCheckpointRefugees', 'DecommissionConstructibleFacility', 'ProduceUnit', 'EndTurn'] as const satisfies readonly GameAction['type'][];

const string: QuerySchema = { type: 'string', minLength: 1 };
const nullableString: QuerySchema = { type: ['string', 'null'], minLength: 1 };
const bool: QuerySchema = { type: 'boolean' };
const integer: QuerySchema = { type: 'integer' };
const object = (properties: Record<string, QuerySchema>, required: string[] = []): QuerySchema => ({ type: 'object', properties, required, additionalProperties: false });
const bounds = { q: integer, r: integer, qMin: integer, qMax: integer, rMin: integer, rMax: integer };
const position = object({ q: integer, r: integer }, ['q', 'r']);
const reference: QuerySchema = { oneOf: [
  object({ kind: { enum: ['facility', 'checkpoint', 'strategic-node'] }, id: string }, ['kind', 'id']),
  object({ kind: { enum: ['coordinate'] }, position }, ['kind', 'position']),
] };
const range = object({ offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } });
const ranges = object({ strategicNodes: range, supplyTransitions: range, hexPath: range });
const unitRoute = object({ moverUnitId: string, source: reference, destination: reference, includeHexPath: { ...bool, default: false }, ranges }, ['moverUnitId', 'destination']);
const referenceRoute = object({ source: reference, destination: reference, includeHexPath: { ...bool, default: false }, ranges }, ['source', 'destination']);
export const QUERY_FILTER_SCHEMAS = {
  api: object({}),
  map: object({ ...bounds, terrain: { enum: TERRAINS }, road: bool, movementRoad: bool, passable: bool, urban: bool, facilityId: nullableString, checkpointId: nullableString, visibleToPlayer: bool, playerOccupancyAllowed: bool }),
  units: object({ ...bounds, id: string, type: { enum: HUMAN_UNIT_TYPES }, unitType: { enum: HUMAN_UNIT_TYPES }, proficiency: { enum: UNIT_PROFICIENCIES }, actionState: { enum: UNIT_ACTION_STATES }, inSupply: bool, canMove: bool, canAttack: bool, isScheduledWaveMember: { enum: [false] }, isFinalWaveMember: { enum: [false] } }),
  facilities: object({ ...bounds, id: string, type: { enum: FACILITY_TYPES }, owner: { enum: ['player', 'none'] }, status: { enum: FACILITY_STATUSES }, inSupply: bool, operationalStatus: { enum: FACILITY_OPERATIONAL_STATUSES }, constructible: bool, populationLimitKind: { enum: ['soft', 'hard'] }, populationOperational: bool }),
  checkpoints: object({ ...bounds, id: string, branchId: string, direction: { enum: ['north', 'east', 'south', 'west'] }, role: { enum: CHECKPOINT_ROLES }, status: { enum: CHECKPOINT_STATUSES }, currentPolicy: { enum: CHECKPOINT_POLICIES }, providesSupply: bool, infectionContained: bool }),
  branches: object({ branchId: string, direction: { enum: ['north', 'east', 'south', 'west'] }, managed: bool, currentPolicy: { enum: CHECKPOINT_POLICIES }, activeCheckpointId: nullableString, fallbackAvailable: bool, arrivalsEnded: bool }),
  construction: object({ ...bounds, facilityType: { enum: [...CONSTRUCTIBLE_TYPES, 'barbedWire'] }, actionType: { enum: ['BuildCheckpoint', 'RelocateCheckpoint', 'ActivateCheckpoint', 'BuildBarbedWire'] }, branchId: string, checkpointId: string, legalOnly: bool, legal: bool, inSupply: bool, reasonCode: nullableString }),
  'legal-actions': object({ type: { enum: QUERYABLE_ACTION_TYPES }, actionType: { enum: QUERYABLE_ACTION_TYPES }, unitId: string, attackerId: string, targetId: string, facilityId: string, checkpointId: string, branchId: string, fromFacilityId: string, toFacilityId: string, unitType: { enum: HUMAN_UNIT_TYPES }, facilityType: { enum: CONSTRUCTIBLE_TYPES }, policy: { enum: CHECKPOINT_POLICIES }, enabled: bool }),
  forecast: object({}),
  history: object({ fromDecision: { type: 'integer', minimum: 0 }, toDecision: { type: 'integer', minimum: 0 } }),
  'full-snapshot': object({}),
  'population-transfers': object({ fromFacilityId: string, toFacilityId: string, legal: bool, legalOnly: bool, min: { type: ['integer', 'null'] }, max: { type: ['integer', 'null'] }, fromReason: nullableString, toReason: nullableString, actionBudgetReason: nullableString, reason: nullableString }),
  'worker-assignments': object({ facilityId: string, legal: bool, legalOnly: bool, availablePopulation: { type: 'integer', minimum: 0 }, targetReason: nullableString, populationReason: nullableString, actionBudgetReason: nullableString, reason: nullableString }),
  'strategic-map': object({ collection: { enum: ['nodes', 'edges'], default: 'nodes' } }),
  route: { oneOf: [unitRoute, referenceRoute], description: 'Exactly one Player Unit route or reference-route shape.' },
} satisfies Record<string, QuerySchema>;
export type PublicQueryTarget = keyof typeof QUERY_FILTER_SCHEMAS;

function schemaTypes(schema: QuerySchema): readonly QuerySchemaType[] {
  if (!schema.type) return [];
  return typeof schema.type === 'string' ? [schema.type] : schema.type;
}

function actualType(value: unknown): QuerySchemaType | 'undefined' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isSafeInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'undefined';
}

export function validateQuerySchema(value: unknown, schema: QuerySchema, path = 'filters'): string[] {
  if (schema.oneOf) return schema.oneOf.filter(s => validateQuerySchema(value, s, path).length === 0).length === 1 ? [] : [`${path} must match exactly one documented shape`];
  if (schema.enum && !schema.enum.includes(value as never)) return [`${path} must be one of ${schema.enum.join(', ')}`];
  const types = schemaTypes(schema);
  const valueType = actualType(value);
  const typeMatches = types.length === 0 || types.includes(valueType as QuerySchemaType) || (valueType === 'integer' && types.includes('number'));
  if (!typeMatches) return [`${path} must be ${types.join(' or ')}`];
  if (valueType === 'object' && types.includes('object')) {
    const obj = value as Record<string, unknown>;
    return [
      ...(schema.required ?? []).filter(k => obj[k] === undefined).map(k => `${path}.${k} is required`),
      ...Object.entries(obj).flatMap(([k, v]) => schema.properties?.[k] ? validateQuerySchema(v, schema.properties[k], `${path}.${k}`) : schema.additionalProperties === false ? [`${path}.${k} is not supported`] : []),
    ];
  }
  if (valueType === 'array' && types.includes('array') && schema.items) {
    return (value as unknown[]).flatMap((item, index) => validateQuerySchema(item, schema.items!, `${path}[${index}]`));
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return [`${path} is outside the documented numeric range`];
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) return [`${path} must not be empty`];
  return [];
}

const nonNegativeInteger: QuerySchema = { type: 'integer', minimum: 0 };
const nullableNumber: QuerySchema = { type: ['number', 'null'] };
const opaqueObject = (description: string): QuerySchema => ({ type: 'object', description });
const array = (items: QuerySchema, description?: string): QuerySchema => ({ type: 'array', items, ...(description ? { description } : {}) });
const routeSequencePage = (itemSchema: QuerySchema): QuerySchema => object({
  included: bool,
  items: array(itemSchema),
  totalCount: nonNegativeInteger,
  offset: nonNegativeInteger,
  limit: { type: 'integer', minimum: 1, maximum: 500 },
  hasMore: bool,
  omittedCount: nonNegativeInteger,
  omittedBefore: nonNegativeInteger,
  omittedAfter: nonNegativeInteger,
}, ['included', 'items', 'totalCount', 'offset', 'limit', 'hasMore', 'omittedCount', 'omittedBefore', 'omittedAfter']);
const resolvedEndpointSchema = object({
  kind: { enum: ['facility', 'checkpoint', 'strategic-node', 'coordinate', 'unit'] },
  id: nullableString,
  position,
}, ['kind', 'id', 'position']);
const adjacentCandidateSchema = object({
  position,
  effectiveMovementCost: { type: 'number', minimum: 0 },
  pathLength: nonNegativeInteger,
  currentSingleActionReachable: { enum: [true, false, null] },
  currentSingleActionReason: string,
}, ['position', 'effectiveMovementCost', 'pathLength', 'currentSingleActionReachable', 'currentSingleActionReason']);
const strategicPathItemSchema = object({ pathIndex: nonNegativeInteger, nodeId: string, position }, ['pathIndex', 'nodeId', 'position']);
const supplyTransitionItemSchema = object({ pathIndex: nonNegativeInteger, position, inSupply: bool }, ['pathIndex', 'position', 'inSupply']);
const hexPathItemSchema = object({ pathIndex: nonNegativeInteger, position }, ['pathIndex', 'position']);
const routeValueSchema = object({
  mode: { enum: ['unit', 'reference'] },
  moverUnitId: nullableString,
  resolvedSource: resolvedEndpointSchema,
  resolvedDestination: resolvedEndpointSchema,
  terrainPathExists: bool,
  routeAvailable: bool,
  unavailableReason: nullableString,
  destinationCenterReached: bool,
  adjacentCandidates: array(adjacentCandidateSchema),
  pathLength: { type: ['integer', 'null'], minimum: 0 },
  terrainMovementCost: nullableNumber,
  effectiveMovementCost: nullableNumber,
  roadDistance: { type: ['integer', 'null'], minimum: 0 },
  roadRoles: array({ enum: ['trunk', 'collector', 'access'] }),
  branchIds: array(string),
  hasOffRoadSegments: bool,
  offRoadDistance: { type: ['integer', 'null'], minimum: 0 },
  startsAtStrategicNode: bool,
  endsAtStrategicNode: bool,
  currentSingleAction: object({
    reachable: { enum: [true, false, null] },
    actionRequired: { enum: [true, false, null] },
    reason: string,
    movementMode: { enum: ['normal', 'emergency', null] },
    movementBudget: nullableNumber,
    effectiveMovementCost: nullableNumber,
    fuelCost: nullableNumber,
    projectedFuelAfterMove: nullableNumber,
  }, ['reachable', 'actionRequired', 'reason', 'movementMode', 'movementBudget', 'effectiveMovementCost', 'fuelCost', 'projectedFuelAfterMove']),
  publicMovementConditions: object({ publiclyOccupiedHexesConsidered: nonNegativeInteger, visibleBarbedWireHexesEntered: nonNegativeInteger }, ['publiclyOccupiedHexesConsidered', 'visibleBarbedWireHexesEntered']),
  strategicNodes: routeSequencePage(strategicPathItemSchema),
  supplyTransitions: routeSequencePage(supplyTransitionItemSchema),
  hexPath: routeSequencePage(hexPathItemSchema),
}, ['mode', 'moverUnitId', 'resolvedSource', 'resolvedDestination', 'terrainPathExists', 'routeAvailable', 'unavailableReason', 'destinationCenterReached', 'adjacentCandidates', 'pathLength', 'terrainMovementCost', 'effectiveMovementCost', 'roadDistance', 'roadRoles', 'branchIds', 'hasOffRoadSegments', 'offRoadDistance', 'startsAtStrategicNode', 'endsAtStrategicNode', 'currentSingleAction', 'publicMovementConditions', 'strategicNodes', 'supplyTransitions', 'hexPath']);

const strategicNodeSchema = object({
  id: string, position,
  kinds: array({ enum: ['capital', 'facility', 'checkpoint', 'entrance', 'junction', 'road-end', 'role-transition', 'loop-anchor', 'isolated-road'] }),
  facilityIds: array(string), checkpointIds: array(string), entranceBranchIds: array(string), branchIds: array(string),
  directionLabels: array({ enum: ['north', 'east', 'south', 'west'] }), connectedToRoad: bool,
}, ['id', 'position', 'kinds', 'facilityIds', 'checkpointIds', 'entranceBranchIds', 'branchIds', 'directionLabels', 'connectedToRoad']);
const strategicEdgeSchema = object({
  id: string, fromNodeId: string, toNodeId: string, from: position, to: position,
  length: nonNegativeInteger, roadRoles: array({ enum: ['trunk', 'collector', 'access'] }), branchId: nullableString,
}, ['id', 'fromNodeId', 'toNodeId', 'from', 'to', 'length', 'roadRoles', 'branchId']);

type ResponseMode = 'items' | 'value' | 'items-and-value';
interface TargetResponseSpec { mode: ResponseMode; itemType?: string; itemSchema?: QuerySchema; valueType?: string; valueSchema?: QuerySchema }
const TARGET_RESPONSE_SPECS: Record<PublicQueryTarget, TargetResponseSpec> = {
  api: { mode: 'value', valueType: 'AgentApiInfo + queryContract + SessionPlayTurnCapabilities', valueSchema: opaqueObject('Public API discovery value.') },
  map: { mode: 'items-and-value', itemType: 'AgentMapTileObservation', itemSchema: opaqueObject('Public Map tile.'), valueType: 'AgentMapObservation metadata', valueSchema: opaqueObject('Map metadata and visibleTileKeys; tiles are paged items.') },
  units: { mode: 'items', itemType: 'AgentUnitObservation' },
  facilities: { mode: 'items', itemType: 'AgentFacilityObservation' },
  checkpoints: { mode: 'items', itemType: 'AgentCheckpointObservation + Session supplyExplanation', itemSchema: opaqueObject('Existing posts. supplyExplanation reports capital-centered branch radius and a revision-pinned construction candidateQuery. providesSupply denotes Active role, not newly added coverage.') },
  branches: { mode: 'items', itemType: 'AgentRoadBranchObservation' },
  construction: { mode: 'items', itemType: 'public construction candidate', itemSchema: opaqueObject('Includes top-level checkpointPositionCandidates: filter branchId and actionType BuildCheckpoint/RelocateCheckpoint/ActivateCheckpoint. Legal candidates report current/projectedBranchRadius and supply deltas. Illegal candidates report unchanged radius and zero deltas; read reasonCode first.') },
  'legal-actions': { mode: 'items', itemType: 'GameAction' },
  forecast: { mode: 'value', valueType: '{endTurnForecast,strategicForecast}', valueSchema: object({ endTurnForecast: opaqueObject('Public EndTurn forecast.'), strategicForecast: opaqueObject('Public strategic forecast.') }, ['endTurnForecast', 'strategicForecast']) },
  history: { mode: 'items', itemType: 'public Decision history detail' },
  'full-snapshot': { mode: 'value', valueType: '{observation,legalActions}', valueSchema: object({ observation: opaqueObject('AgentObservation'), legalActions: array(opaqueObject('GameAction')) }, ['observation', 'legalActions']) },
  'population-transfers': { mode: 'items', itemType: 'population transfer candidate' },
  'worker-assignments': { mode: 'items', itemType: 'worker assignment candidate' },
  'strategic-map': {
    mode: 'items-and-value',
    itemType: 'StrategicMapNode | StrategicMapEdge selected by filters.collection',
    itemSchema: { oneOf: [strategicNodeSchema, strategicEdgeSchema] },
    valueType: '{mapId,collection,nodeCount,edgeCount,unconnectedFacilityCount}',
    valueSchema: object({ mapId: string, collection: { enum: ['nodes', 'edges'] }, nodeCount: nonNegativeInteger, edgeCount: nonNegativeInteger, unconnectedFacilityCount: nonNegativeInteger }, ['mapId', 'collection', 'nodeCount', 'edgeCount', 'unconnectedFacilityCount']),
  },
  route: { mode: 'value', valueType: 'RouteQueryResult', valueSchema: routeValueSchema },
};
const CURSOR_TARGETS = new Set<PublicQueryTarget>(['map', 'units', 'facilities', 'checkpoints', 'branches', 'construction', 'legal-actions', 'history', 'population-transfers', 'worker-assignments', 'strategic-map']);

function responseEnvelope(target: PublicQueryTarget, spec: TargetResponseSpec): QuerySchema {
  const properties: Record<string, QuerySchema> = {
    sessionId: string,
    revision: nonNegativeInteger,
    target: { enum: [target] },
    count: nonNegativeInteger,
    total: nonNegativeInteger,
    hasMore: bool,
    nextCursor: { type: ['string', 'null'], minLength: 1 },
  };
  if (spec.mode !== 'value') properties.items = array(spec.itemSchema ?? opaqueObject(spec.itemType ?? 'public item'));
  if (spec.mode !== 'items') properties.value = spec.valueSchema ?? opaqueObject(spec.valueType ?? 'public value');
  return object(properties, ['sessionId', 'revision', 'target', 'count', 'total', 'hasMore', 'nextCursor', ...(spec.mode !== 'items' ? ['value'] : [])]);
}

export function publicQueryContract() {
  const listFields = ['sessionId', 'revision', 'target', 'count', 'total', 'hasMore', 'nextCursor', 'items'];
  return {
    schemaFormat: 'JSON Schema', schemaVersion: '2020-12', contractVersion: '1.0.0',
    requestEnvelopes: {
      programmatic: { required: ['target'], optional: ['expectedRevision', 'cursor', 'pageSize', 'filters'], fields: { target: { enum: Object.keys(QUERY_FILTER_SCHEMAS) }, expectedRevision: { type: 'integer', minimum: 0 }, cursor: string, pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 100 }, filters: { type: 'object', default: {} } } },
      cliInputFile: 'The --input JSON file contains the selected target filter object directly.',
      playTurnQuery: 'The filter object is nested at filters in {type:"query",target,expectedRevision?,cursor?,pageSize?,filters?}.',
    },
    nullableFields: { nextCursor: 'string|null', route: ['moverUnitId', 'unavailableReason', 'path and cost fields', 'reference currentSingleAction fields'], forecast: 'runway estimate null with unavailableReason' },
    pagination: { cursor: { defaultPageSize: 100, maxPageSize: 500, revisionPinned: true, filtersPinned: true, firstPageCursor: null }, routeRanges: { sequences: ['strategicNodes', 'supplyTransitions', 'hexPath'], defaultOffset: 0, defaultLimit: 100, maxLimit: 500, hexPathIncludedByDefault: false } },
    targets: Object.fromEntries((Object.entries(QUERY_FILTER_SCHEMAS) as Array<[PublicQueryTarget, QuerySchema]>).map(([name, schema]) => {
      const spec = TARGET_RESPONSE_SPECS[name];
      return [name, {
        filters: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema },
        pagination: name === 'route' ? { mode: 'value-ranges', sequences: ['strategicNodes', 'supplyTransitions', 'hexPath'], defaultLimit: 100, maxLimit: 500 }
          : CURSOR_TARGETS.has(name) ? { mode: 'cursor', requestFields: ['pageSize', 'cursor', 'expectedRevision'], defaultPageSize: 100, maxPageSize: 500 }
            : { mode: 'none' },
        response: { envelope: responseEnvelope(name, spec), payloadMode: spec.mode, itemType: spec.itemType ?? null, valueType: spec.valueType ?? null },
        responseFields: spec.mode === 'value' ? [...listFields.filter(k => k !== 'items'), 'value'] : spec.mode === 'items-and-value' ? [...listFields, 'value'] : listFields,
        detailShape: spec.itemType ?? spec.valueType ?? `public ${name} projection`,
      }];
    })),
    failure: {
      programmatic: { behavior: 'throws SessionError', codes: ['invalid_query', 'invalid_page_size', 'invalid_cursor', 'stale_revision'], shape: object({ code: string, message: string, details: {} }, ['code', 'message']) },
      routeInputReasonCodes: ['source_required', 'invalid_source', 'invalid_destination', 'unknown_source', 'unknown_destination', 'unknown_unit', 'enemy_unit_not_allowed', 'source_unit_mismatch', 'invalid_range'],
      cli: { stream: 'stderr', shape: object({ ok: { enum: [false] }, code: string, error: string, details: {} }, ['ok', 'code', 'error']), exitCode: 1 },
    },
    examples: {
      cli: { command: './run-session.sh query --session=example --target=units --revision=0 --input=filters.json', inputFile: { id: 'police-1' } },
      playTurn: { type: 'query', target: 'units', expectedRevision: 0, filters: { id: 'police-1' } },
      strategicMap: { target: 'strategic-map', expectedRevision: 0, pageSize: 100, filters: { collection: 'nodes' } },
      unitRoute: { target: 'route', expectedRevision: 0, filters: { moverUnitId: 'police-1', destination: { kind: 'facility', id: 'capital' }, includeHexPath: false } },
      referenceRoute: { target: 'route', expectedRevision: 0, filters: { source: { kind: 'facility', id: 'capital' }, destination: { kind: 'strategic-node', id: 'strategic-node:25,0' }, ranges: { strategicNodes: { offset: 0, limit: 100 } } } },
    },
  };
}
