/**
 * Data contracts shared by the headless game core and the Phaser adapter.
 *
 * The core deliberately uses arrays and plain records instead of Map, Set,
 * Date, class instances, or callbacks. A GameState can therefore be passed
 * through JSON.stringify/JSON.parse without a custom serializer.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type HexCoordinate = {
  q: number;
  r: number;
};

/** Short alias used throughout the game code. */
export type HexCoord = HexCoordinate;

export type HexKey = string;

export type CardinalDirection = 'north' | 'east' | 'south' | 'west';

export type HexDirection =
  | 'east'
  | 'northEast'
  | 'northWest'
  | 'west'
  | 'southWest'
  | 'southEast';

export type TileTerrain = 'land' | 'road';

export type FacilityType =
  | 'capital'
  | 'city'
  | 'farm'
  | 'civilianFactory'
  | 'militaryFactory'
  | 'refinery'
  | 'powerPlant';

export type FacilityId = string;

export type FacilityStatus = 'unowned' | 'owned' | 'ruined';

export type FacilityOperationalStatus = 'operational' | 'stopped' | 'infected' | 'ruined';

export type UnitType = 'police' | 'nationalGuard' | 'zombie';

/** Alias retained for systems that refer to units as a kind rather than type. */
export type UnitKind = UnitType;

export type HumanUnitType = Exclude<UnitType, 'zombie'>;

export type UnitActionState = 'ready' | 'moved' | 'acted' | 'destroyed';

export type CheckpointPolicy = 'passThrough' | 'normal' | 'strict';

export type CheckpointStatus = 'operational' | 'ruined';

export type GamePhase =
  | 'player'
  | 'economy'
  | 'refugees'
  | 'infection'
  | 'zombie'
  | 'horde'
  | 'gameOver';

export type GameOverReason =
  | 'capitalLost'
  | 'workersLost'
  | 'maxTurnsSurvived'
  | 'abandoned'
  | 'error';

export type ResourceType = 'food' | 'civilianGoods' | 'militaryGoods' | 'fuel';

export interface ResourceStock {
  food: number;
  civilianGoods: number;
  militaryGoods: number;
  fuel: number;
}

export interface ResourceState extends ResourceStock {
  /** Electricity is a per-turn capacity, not a consumable stockpile. */
  electricityCapacity: number;
  electricityRequired: number;
  militarySupplyAvailable: boolean;
}

export interface HexTile {
  key: HexKey;
  q: number;
  r: number;
  terrain: TileTerrain;
  road: boolean;
  movementCost: 1;
  facilityId: FacilityId | null;
  hordeEntranceDirections: CardinalDirection[];
}

export interface HordeEntrance {
  direction: CardinalDirection;
  tile: HexCoord;
  /** Road tiles in this branch, ordered from the edge toward the center. */
  roadTiles: HexCoord[];
}

export interface FacilityDefinition {
  id: FacilityId;
  type: FacilityType;
  nameKey: string;
  position: HexCoord;
  workerCapacity: number;
  startingOwned: boolean;
  startingWorkers: number;
  startingInfected: number;
}

export interface FixedMap {
  id: string;
  width: 15;
  height: 15;
  tiles: HexTile[];
  roadTiles: HexCoord[];
  facilities: FacilityDefinition[];
  hordeEntrances: HordeEntrance[];
  initialZombiePositions: HexCoord[];
}

export interface FacilityState extends FacilityDefinition {
  owner: 'player' | 'none';
  status: FacilityStatus;
  operationalStatus: FacilityOperationalStatus;
  workers: number;
  infected: number;
  /** Stable ordering key used when resolving fuel/electricity shortages. */
  securedOrder: number | null;
  /** Stable ordering key used for deterministic worker-shortage casualties. */
  lastAssignedOrder: number;
}

export interface PopulationState {
  /** Workers currently assigned to owned facilities. */
  employed: number;
  unemployed: number;
  police: number;
  nationalGuard: number;
  /** Population in units is tracked separately from civilian workers. */
  unitPopulation: number;
  /** Facility assignment is kept as an array so it remains JSON-only. */
  facilityWorkers: Array<{ facilityId: FacilityId; workers: number }>;
  waitingRefugees: number;
  screeningRefugees: number;
  facilityInfected: number;
}

export interface UnitState {
  id: string;
  type: UnitType;
  position: HexCoord;
  hp: number;
  maxHp: number;
  attack: number;
  movement: number;
  range: number;
  population: number;
  actionState: UnitActionState;
  canAttack: boolean;
  canMove: boolean;
  /** Set for human units; zombies are always false. */
  isPlayerUnit: boolean;
  /** Activity since the previous Player Turn Start, used for natural healing. */
  activity: {
    moved: boolean;
    attacked: boolean;
    intercepted: boolean;
    suppressed: boolean;
  };
}

export interface CheckpointState {
  id: string;
  position: HexCoord;
  direction: CardinalDirection;
  status: CheckpointStatus;
  waiting: number;
  screening: number;
  remainingTurns: number;
  screeningPolicy: CheckpointPolicy;
  currentPolicy: CheckpointPolicy;
  nextArrivalTurn: number | null;
  /** Infection is tracked separately from people still waiting for processing. */
  infected: number;
}

export interface PendingAdmission {
  checkpointId: string;
  acceptedWorkers: number;
  latentInfected: number;
}

export interface UnitProductionOrder {
  id: string;
  cityFacilityId: FacilityId;
  unitType: HumanUnitType;
  population: number;
  readyTurn: number;
}

export interface HordeState {
  spawnedCount: number;
  totalSpawned: number;
  nextDirection: CardinalDirection;
  turnsRemaining: number;
  nextSpawnTurn: number | null;
  lastSpawnTurn: number | null;
}

export type GameEventType =
  | 'unit_moved'
  | 'interception'
  | 'attack'
  | 'damage'
  | 'unit_destroyed'
  | 'facility_captured'
  | 'workers_assigned'
  | 'resource_produced'
  | 'resource_consumed'
  | 'resource_shortage'
  | 'refugees_arrived'
  | 'refugees_screened'
  | 'latent_infection'
  | 'infection_spread'
  | 'infection_suppressed'
  | 'facility_overrun'
  | 'facility_recovered'
  | 'checkpoint_built'
  | 'horde_spawned'
  | 'game_over';

export interface GameEvent {
  id: string;
  turn: number;
  phase: GamePhase;
  type: GameEventType;
  /** Event payloads are intentionally plain JSON values. */
  payload: JsonObject;
}

export interface GameStatistics {
  maxPopulation: number;
  maxSecuredFacilities: number;
  civilianLosses: number;
  unitLosses: number;
  infectionLosses: number;
  resourceShortageLosses: number;
  hordeInterceptions: number;
}

export interface GameResult {
  outcome: 'won' | 'lost';
  reason: GameOverReason;
  turn: number;
  statistics: GameStatistics;
}

export interface ForecastResourceRequirement {
  /** Stock available at the start of the economy phase. */
  available: number;
  /** Population/military maintenance that is paid before production input. */
  maintenanceRequired: number;
  /** Full staffing input for facilities that receive electricity. */
  productionInputRequired: number;
  /** Combined maintenance and full-production demand. */
  required: number;
  shortage: number;
}

export interface EndTurnForecast {
  populationConsumers: number;
  food: ForecastResourceRequirement;
  civilianGoods: ForecastResourceRequirement;
  militaryGoods: ForecastResourceRequirement;
  fuel: ForecastResourceRequirement;
  electricity: {
    capacity: number;
    required: number;
    shortage: number;
  };
}

export interface GameState {
  gameVersion: string;
  config: GameConfig;
  seed: number;
  /** Serializable state of the deterministic PRNG at this point in play. */
  rngState: RngState;
  turn: number;
  maxTurns: number;
  actionsTakenThisTurn: number;
  phase: GamePhase;
  mapId: string;
  map: FixedMap;
  facilities: FacilityState[];
  population: PopulationState;
  resources: ResourceState;
  units: UnitState[];
  checkpoints: CheckpointState[];
  pendingAdmissions: PendingAdmission[];
  pendingUnitProductions: UnitProductionOrder[];
  nextUnitNumber: number;
  nextEventNumber: number;
  nextAssignmentOrder: number;
  horde: HordeState;
  events: GameEvent[];
  statistics: GameStatistics;
  gameOver: boolean;
  result: GameResult | null;
}

export interface RngState {
  algorithm: 'xorshift32-v1';
  seed: number;
  state: number;
  calls: number;
}

export interface MoveAction {
  type: 'Move';
  unitId: string;
  destination: HexCoord;
}

export interface AttackAction {
  type: 'Attack';
  attackerId: string;
  targetId: string;
}

export interface WaitAction {
  type: 'Wait';
  unitId: string;
}

export interface SuppressInfectionAction {
  type: 'SuppressInfection';
  unitId: string;
  facilityId: FacilityId;
}

export interface AssignWorkersAction {
  type: 'AssignWorkers';
  facilityId: FacilityId;
  workers: number;
}

export interface SetCheckpointPolicyAction {
  type: 'SetCheckpointPolicy';
  checkpointId: string;
  policy: CheckpointPolicy;
}

export interface BuildCheckpointAction {
  type: 'BuildCheckpoint';
  position: HexCoord;
}

export interface ProduceUnitAction {
  type: 'ProduceUnit';
  unitType: HumanUnitType;
  /** Optional destination; if omitted the engine chooses a legal facility. */
  destination?: HexCoord;
}

export interface EndTurnAction {
  type: 'EndTurn';
}

export interface StartNewGameAction {
  type: 'StartNewGame';
  seed: number;
  config: GameConfig;
}

export interface LoadSnapshotAction {
  type: 'LoadSnapshot';
  snapshot: GameState;
}

export type GameAction =
  | MoveAction
  | AttackAction
  | WaitAction
  | SuppressInfectionAction
  | AssignWorkersAction
  | SetCheckpointPolicyAction
  | BuildCheckpointAction
  | ProduceUnitAction
  | EndTurnAction
  | StartNewGameAction
  | LoadSnapshotAction;

export interface ActionError {
  code: string;
  message: string;
  action: GameAction | null;
}

export interface StepResult {
  state: Readonly<GameState>;
  events: GameEvent[];
  error: ActionError | null;
  gameOver: boolean;
  result: GameResult | null;
}

export interface HeadlessGame {
  reset(seed: number, config: GameConfig): Readonly<GameState>;
  getState(): Readonly<GameState>;
  getLegalActions(): GameAction[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}

export interface UnitConfig {
  hp: number;
  attack: number;
  movement: number;
  range: number;
  population: number;
}

export interface ProductionRule {
  inputs: Partial<Record<ResourceType, number>>;
  outputs: Partial<Record<ResourceType, number>>;
  requiresPower: boolean;
  powerCapacity: number;
  /** Electricity capacity generated per worker (used by power plants). */
  powerGeneration: number;
}

export interface FacilityConfig {
  workerCapacity: number;
  production: ProductionRule;
  /** Number of zombies created when this facility falls. */
  overrunSpawnCount: number;
}

export interface HordeConfig {
  cycle: number;
  initialCount: number;
  increment: number;
  warningStartTurn: number;
  spawnOnlyBeforeFinalTurn: boolean;
}

export interface RefugeePolicyConfig {
  turns: number;
  workerRate: number;
  infectionRate: number;
  infectionPopulationRate: number;
}

export interface RefugeeConfig {
  arrivalIntervalMin: number;
  arrivalIntervalMax: number;
  arrivalPeopleMin: number;
  arrivalPeopleMax: number;
  screeningCapacity: number;
  policies: Record<CheckpointPolicy, RefugeePolicyConfig>;
}

export interface InfectionConfig {
  facilitySpreadPerTurn: number;
  fallBackInfectionRate: number;
  fallBackCapacityRate: number;
  fallBackCapacityRounding: 'ceil' | 'floor';
  policeSuppression: number;
  nationalGuardSuppression: number;
  nationalGuardCivilianDamageRate: number;
}

export interface CheckpointConfig {
  constructionCivilianGoods: number;
  maxPerDirection: number;
  requiresPolice: boolean;
  consumesPower: boolean;
}

export interface EconomyConfig {
  populationConsumption: {
    food: number;
    civilianGoods: number;
  };
  militaryGoodsPerUnitPopulation: number;
  initialResources: ResourceStock;
  initialWorkersByFacility: Record<FacilityId, number>;
  initialUnemployed: number;
  initialZombieCount: number;
}

/** Inclusive range resolved with the game's seeded RNG during new-game setup. */
export interface InitialPopulationRange {
  min: number;
  max: number;
}

/**
 * Optional per-facility population overrides for a new game.  `null` keeps
 * the legacy map/economy default, while a range takes precedence over its
 * matching fixed value.  This lets the fixed map stay deterministic by
 * default while allowing a Config to introduce seeded survivor scenarios.
 */
export interface InitialFacilityPopulationConfig {
  survivors: number | null;
  infected: number | null;
  survivorRange: InitialPopulationRange | null;
  infectedRange: InitialPopulationRange | null;
}

export interface NaturalRecoveryConfig {
  /** Fraction of maximum HP restored after a fully inactive turn. */
  rate: number;
  rounding: 'ceil' | 'floor';
}

export interface GameConfig {
  version: string;
  mapId: string;
  maxTurns: number;
  maxActionsPerTurn: number;
  units: Record<UnitType, UnitConfig>;
  facilities: Record<FacilityType, FacilityConfig>;
  economy: EconomyConfig;
  initialFacilityPopulation: Record<FacilityId, InitialFacilityPopulationConfig>;
  naturalRecovery: NaturalRecoveryConfig;
  horde: HordeConfig;
  refugees: RefugeeConfig;
  infection: InfectionConfig;
  checkpoint: CheckpointConfig;
}

/** A recursively partial configuration used by options screens and tests. */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
