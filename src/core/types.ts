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

export type BaseTerrain = 'plain' | 'forest' | 'mountain' | 'water';

/** Compatibility name retained for callers that imported TileTerrain. */
export type TileTerrain = BaseTerrain;

export type TerrainDefenseSource = 'urban' | 'forest' | 'none';

export type FacilityType =
  | 'capital'
  | 'city'
  | 'farm'
  | 'civilianFactory'
  | 'militaryFactory'
  | 'refinery'
  | 'powerPlant'
  | 'windPowerPlant'
  | 'simpleFarm'
  | 'civilianDroneBase';

export type ConstructibleFacilityType = 'simpleFarm' | 'civilianDroneBase';

export type FacilityId = string;

export type FacilityStatus = 'unowned' | 'owned' | 'ruined';

export type FacilityOperationalStatus =
  | 'building'
  | 'operational'
  | 'stopped'
  | 'infected'
  | 'disabled'
  | 'recovering'
  | 'ruined';

export type UnitType = 'police' | 'nationalGuard' | 'zombie' | 'hordeZombie';

/** Alias retained for systems that refer to units as a kind rather than type. */
export type UnitKind = UnitType;

export type HumanUnitType = Exclude<UnitType, 'zombie' | 'hordeZombie'>;

export type UnitActionState = 'ready' | 'moved' | 'acted' | 'destroyed';

export type CheckpointPolicy = 'passThrough' | 'normal' | 'strict';

export type CheckpointStatus = 'operational' | 'remnant' | 'ruined' | 'abandoned';

export type CheckpointRole = 'active' | 'standby' | 'dormant' | 'remnant' | 'ruined' | 'abandoned';

export type NoiseClass = 'small' | 'medium' | 'large' | 'extraLarge';

export type RoadBranchId = string;

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
  | 'healthyCiviliansLost'
  | 'stateSecured'
  | 'abandoned'
  | 'error';

export type ResourceType = 'food' | 'civilianGoods' | 'militaryGoods' | 'fuel';

export type PowerMode = 'required' | 'none';

export type PowerSupplyReason =
  | 'supplied'
  | 'physical_capacity_shortage'
  | 'fuel_shortage'
  | 'allocation_priority'
  | 'power_supply_off'
  | 'no_population'
  | 'not_eligible'
  | 'production_input_unavailable'
  | 'not_applicable';

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
}

export interface HexTile {
  key: HexKey;
  q: number;
  r: number;
  terrain: TileTerrain;
  road: boolean;
  movementCost: number | null;
  facilityId: FacilityId | null;
  hordeEntranceDirections: CardinalDirection[];
  /** Static public rule: player pieces and structures may not occupy this tile. */
  playerOccupancyAllowed: boolean;
}

export interface HordeEntrance {
  direction: CardinalDirection;
  tile: HexCoord;
  /** Road tiles in this branch, ordered from the edge toward the center. */
  roadTiles: HexCoord[];
}

export interface RoadBranchDefinition {
  id: RoadBranchId;
  direction: CardinalDirection;
  /** Shared capital intersection; checkpoints cannot be built here. */
  capitalConnection: HexCoord;
  /** Branch tiles ordered from the capital outward, excluding the capital. */
  roadTiles: HexCoord[];
  entrance: HexCoord;
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
  width: number;
  height: number;
  tiles: HexTile[];
  roadTiles: HexCoord[];
  facilities: FacilityDefinition[];
  hordeEntrances: HordeEntrance[];
  /** Public static reserve used by every player-placement validator. */
  hordeSpawnReserve: HexCoord[];
  roadBranches: RoadBranchDefinition[];
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
  /** First player turn on which population actions and recruitment are legal. */
  populationOperationalTurn: number;
  /** Player-controlled boost request for Farm/Civilian/Military factories. */
  powerSupplyEnabled: boolean;
  /** Actual result of the most recently completed economy phase. */
  lastPowerSupplied: boolean | null;
  /** Constructible facilities are dynamic state and never part of the fixed-map definition. */
  constructible: boolean;
  /** Turn on which a constructible facility was accepted, otherwise null. */
  builtTurn: number | null;
  /** First Player Turn on which a recovering special facility becomes operational. */
  recoveryOperationalTurn: number | null;
}

export interface PopulationState {
  /** Population present at new-game creation, including initial human units. */
  initialPopulation: number;
  /** Derived healthy civilians living in owned cities. */
  cityResidents: number;
  /** Derived healthy civilians assigned to owned production facilities. */
  productionWorkers: number;
  /** Derived healthy civilians in all owned normal facilities. */
  healthyCivilians: number;
  police: number;
  nationalGuard: number;
  /** Population in units is tracked separately from civilian workers. */
  unitPopulation: number;
  /** Facility assignment is kept as an array so it remains JSON-only. */
  facilityWorkers: Array<{ facilityId: FacilityId; workers: number }>;
  waitingRefugees: number;
  screeningRefugees: number;
  approvedRefugees: number;
  facilityInfected: number;
  checkpointInfected: number;
  /** Population deaths used to audit the population conservation ledger. */
  cumulativeDeaths: number;
  /** Refugees entering checkpoint custody. */
  cumulativeArrivals: number;
  /** Screened people who do not join the managed population. */
  cumulativeDepartures: number;
  /** Previously uncounted infected revealed by the configured overrun floor. */
  cumulativeDiscoveredInfected: number;
}

export interface CityPopulationSnapshotEntry {
  facilityId: FacilityId;
  population: number;
  eligible: boolean;
}

export interface CityPopulationSnapshot {
  turn: number;
  supply: CityPopulationSnapshotEntry[];
  reception: CityPopulationSnapshotEntry[];
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
  vision: number;
  population: number;
  /** Human-unit endurance. Zombie units always store zero for both values. */
  currentFuel: number;
  maxFuel: number;
  /** Human-unit carried ammunition/supplies. Zombie units always store zero. */
  currentMilitaryGoods: number;
  maxMilitaryGoods: number;
  actionState: UnitActionState;
  canAttack: boolean;
  canMove: boolean;
  /** Set for human units; zombies are always false. */
  isPlayerUnit: boolean;
  /** Internal-only remembered coordinate inherited from a visible Horde Zombie. */
  inheritedTarget: HexCoord | null;
  /** Internal-only remembered combat-noise coordinate for a normal Zombie. */
  noiseTarget: HexCoord | null;
  /** Identifies periodic/final Horde membership without exposing it through public APIs. */
  spawnGroupId: string | null;
  hordeKind: 'periodic' | 'final' | null;
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
  branchId?: RoadBranchId;
  status: CheckpointStatus;
  waiting: number;
  screening: number;
  approved: number;
  remainingTurns: number;
  screeningPolicy: CheckpointPolicy;
  nextArrivalTurn: number | null;
  /** Infection is tracked separately from people still waiting for processing. */
  infected: number;
  /** Prevents repeated overrun effects while a non-operational site remains infected. */
  overrunProcessed?: boolean;
}

export interface CheckpointPositionCandidate {
  actionType: 'BuildCheckpoint' | 'RelocateCheckpoint' | 'ActivateCheckpoint';
  branchId: string;
  checkpointId?: string;
  position: HexCoord;
  legal: boolean;
  reasonCode: string | null;
  currentBranchRadius?: number;
  projectedBranchRadius?: number;
  newlySuppliedHexCount?: number;
  newlyUnsuppliedHexCount?: number;
  newlySuppliedFacilityIds?: FacilityId[];
  newlyUnsuppliedFacilityIds?: FacilityId[];
  suppliedFacilityDelta?: number;
  newlyBuildableConstructibleHexCount?: number;
}

export interface ConstructibleFacilityPositionCandidate {
  facilityType: ConstructibleFacilityType;
  position: HexCoord;
  legal: boolean;
  reasonCode: string | null;
}

export interface RoadBranchState {
  branchId: RoadBranchId;
  nextArrivalTurn: number;
  checkpointActionsThisTurn: number;
  activeCheckpointId: string | null;
  standbyCheckpointIds: string[];
  currentPolicy: CheckpointPolicy;
}

export interface UnitProductionOrder {
  id: string;
  cityFacilityId: FacilityId;
  unitType: HumanUnitType;
  population: number;
  readyTurn: number;
}

export interface HordeState {
  /** One-based index of the next configured wave, or null after the Final Wave. */
  nextWaveIndex: number | null;
  totalSpawned: number;
  /** Directions selected for the currently warned wave, in canonical order. */
  warningDirections: CardinalDirection[];
  turnsRemaining: number;
  nextSpawnTurn: number | null;
  lastSpawnTurn: number | null;
  warningType: 'periodic' | 'final' | 'none';
  spawnedWaveIndices: number[];
  spawnGroupIdsByWave: Record<string, string[]>;
  finalHordeStatus: 'notStarted' | 'active' | 'defeated';
  finalSpawnGroupIds: string[];
  finalSpawnedCount: number;
}

export type GameEventType =
  | 'unit_moved'
  | 'unit_recovered'
  | 'interception'
  | 'attack'
  | 'damage'
  | 'unit_destroyed'
  | 'facility_captured'
  | 'workers_assigned'
  | 'population_transferred'
  | 'population_conscripted'
  | 'resource_produced'
  | 'resource_consumed'
  | 'resource_shortage'
  | 'refugees_arrived'
  | 'refugees_screened'
  | 'latent_infection'
  | 'infection_spread'
  | 'site_infection_started'
  | 'infection_suppressed'
  | 'facility_overrun'
  | 'site_fallen'
  | 'site_zombies_spawned'
  | 'site_immediate_infection'
  | 'site_chain_fallen'
  | 'site_noise_respawn'
  | 'facility_recovered'
  | 'checkpoint_built'
  | 'checkpoint_relocated'
  | 'checkpoint_remnant_created'
  | 'checkpoint_removed'
  | 'checkpoint_abandoned'
  | 'checkpoint_recovered'
  | 'checkpoint_activated'
  | 'checkpoint_fallback'
  | 'checkpoint_role_changed'
  | 'supply_changed'
  | 'supply_action_rejected'
  | 'power_supply_changed'
  | 'power_allocated'
  | 'constructible_built'
  | 'facility_disabled'
  | 'terrain_defense_applied'
  | 'enemy_spotted'
  | 'enemy_lost'
  | 'aerial_enemy_discovered'
  | 'zombie_idle'
  | 'horde_target_inherited'
  | 'horde_target_cleared'
  | 'noise_emitted'
  | 'noise_targeted'
  | 'noise_target_reached'
  | 'noise_target_overridden'
  | 'victory_progress_changed'
  | 'horde_spawned'
  | 'horde_warning'
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
  refugeeArrivalsByBranch: Record<RoadBranchId, number>;
  unmanagedPassThrough: number;
  refugeesScreenedByPolicy: Record<CheckpointPolicy, number>;
  refugeesAccepted: number;
  refugeesDeparted: number;
  checkpointsBuilt: number;
  checkpointsRelocated: number;
  checkpointRetreats: number;
  checkpointsRuined: number;
  checkpointsRecovered: number;
  checkpointsAbandoned: number;
  checkpointsRemoved: number;
  unmanagedBranchTurns: number;
  maxSuppliedFacilities: number;
  maxSupplyRadius: number;
  supplyLosses: number;
  supplyRejections: number;
  finalHordeSpawned: number;
  finalHordeKilled: number;
  finalHordeDefeated: boolean;
  periodicHordeZombiesSpawned: number;
  periodicNormalZombiesSpawned: number;
  finalHordeZombiesSpawned: number;
  finalNormalZombiesSpawned: number;
  normalZombiesKilled: number;
  hordeZombiesKilled: number;
  maxVisibleZombies: number;
  turnsAfterFinalHorde: number;
  suppliedAreaZombieClearTurn: number | null;
  suppliedAreaInfectionClearTurn: number | null;
  victoryTurn: number | null;
  terrainEntriesByType: Record<BaseTerrain, number>;
  urbanDefenseApplications: number;
  urbanDefenseDamagePrevented: number;
  forestDefenseApplications: number;
  forestDefenseDamagePrevented: number;
  normalZombieIdleCount: number;
  hordeTargetInheritedCount: number;
  hordeTargetClearedCount: number;
  standbyCheckpointsCreated: number;
  dormantCheckpointsCreated: number;
  checkpointActivations: number;
  checkpointFallbacks: number;
  checkpointFallbacksByBranch: Record<RoadBranchId, number>;
  checkpointFallbacksFromStandby: number;
  checkpointFallbacksFromDormant: number;
  checkpointFallbacksPreventingUnmanagedArrival: number;
  maxCheckpointPostsPerBranch: number;
  maxPreparedCheckpointPostsPerBranch: number;
  activeCheckpointLosses: number;
  noisePulsesEmitted: number;
  policeNoisePulses: number;
  nationalGuardNoisePulses: number;
  normalZombiesNoiseTargeted: number;
  noiseTargetsReached: number;
  noiseTargetsOverriddenByHorde: number;
  noiseTargetsOverriddenByVisiblePopulation: number;
  initialNormalZombies: number;
  fallenSitesTriggeredByNoise: number;
  noiseRespawnAttempts: number;
  noiseRespawnZombiesSpawned: number;
  infectedPopulationConvertedToZombies: number;
  unspawnedInfectedPopulation: number;
  immediateInfectionsFromSpawn: number;
  chainOverruns: number;
  maximumOverrunChainLength: number;
  constructibleInfectedDeaths: number;
  groundVisionPotentialHexes: number;
  groundVisionVisibleHexes: number;
  groundVisionBlockedHexes: number;
  maxGroundVisionBlockedHexes: number;
  cumulativeGroundVisionBlockedHexes: number;
  groundVisionSamples: number;
  civilianDroneBasesBuilt: number;
  maxCivilianDroneVisionRadius: number;
  aerialDiscoveriesInGroundBlockedArea: number;
}

export interface GameResult {
  outcome: 'won' | 'lost';
  reason: GameOverReason;
  turn: number;
  statistics: GameStatistics;
}

export interface ForecastResourceRequirement {
  startingStock: number;
  projectedProduction: number;
  maintenanceRequired: number;
  endingStock: number;
  /** Compatibility alias for startingStock. */
  available: number;
  productionInputRequired: number;
  required: number;
  shortage: number;
}

export interface CivilianGoodsForecast extends ForecastResourceRequirement {
  productionInputDemand: number;
  productionInputAllocated: number;
  productionInputShortage: number;
  maintenanceShortage: number;
}

export interface FuelForecast extends ForecastResourceRequirement {
  turnStartFuel: number;
  windPowerAvailable: number;
  powerPlantPhysicalCapacity: number;
  projectedPowerFuelDemand: number;
  projectedPowerFuelUsed: number;
  fuelAfterPower: number;
  projectedUnitRefillDemand: number;
  projectedUnitFuelRefilled: number;
  projectedTotalFuelDemand: number;
  projectedRefineryProduction: number;
  projectedEndingFuel: number;
  powerFuelShortage: number;
  unitRefillFuelShortage: number;
  totalFuelShortage: number;
  generationFuelDemand: number;
  projectedFuelUsed: number;
  generationFuelShortage: number;
}

export type MilitaryGoodsSuppressionStatus = 'suppression' | 'containment_only' | 'none';

export interface MilitaryGoodsUnitForecast {
  unitId: string;
  unitType: HumanUnitType;
  inSupply: boolean;
  beforeFixed: number;
  fixedConsumption: number;
  afterFixed: number;
  refillDemand: number;
  projectedRefillAmount: number;
  unfilledRefillDemand: number;
  afterRefill: number;
  suppressionCost: number;
  suppressionStatus: MilitaryGoodsSuppressionStatus;
  afterSuppression: number;
}

export interface MilitaryGoodsForecast {
  startingStock: number;
  projectedProduction: number;
  totalRefillDemand: number;
  projectedTotalRefilled: number;
  totalUnfilledRefillDemand: number;
  projectedEndingStock: number;
  units: MilitaryGoodsUnitForecast[];
}

export type StrategicResourceType = ResourceType | 'electricity';

export interface ResourceContributorForecast {
  facilityId: FacilityId;
  amount: number;
  share: number;
}

export interface CriticalResourceDependencyForecast {
  resource: StrategicResourceType;
  currentSupply: number;
  currentDemand: number;
  contributors: ResourceContributorForecast[];
  largestContributorFacilityId: FacilityId | null;
  projectedSupplyWithoutLargestContributor: number;
  shortageWithoutLargestContributor: number;
  singlePointOfFailure: boolean;
  currentlyShort: boolean;
}

export interface GuaranteedDefeatForecast {
  guaranteed: boolean;
  causeResource: 'food' | 'civilianGoods' | null;
  foodShortage: number;
  civilianGoodsShortage: number;
  projectedHealthyCivilians: number;
  defeatReason: 'healthyCiviliansLost' | null;
}

export type QueuePressureClass = 'none' | 'low' | 'medium' | 'high';

export interface StrategicForecast {
  resources: Record<StrategicResourceType, CriticalResourceDependencyForecast>;
  guaranteedDefeat: GuaranteedDefeatForecast;
}

export interface UnpoweredFacilityForecast {
  facilityId: FacilityId;
  reason: PowerSupplyReason;
}

export interface EndTurnForecast {
  populationConsumers: number;
  overcrowding: {
    /** Exact sum represented as per-city rational terms. */
    cities: Array<{ facilityId: FacilityId; excess: number; softCap: number }>;
    additionalFood: number;
    additionalCivilianGoods: number;
  };
  food: ForecastResourceRequirement;
  civilianGoods: CivilianGoodsForecast;
  militaryGoods: MilitaryGoodsForecast;
  fuel: FuelForecast;
  electricity: {
    physicalGenerationCapacity: number;
    fuelLimitedGenerationCapacity: number;
    availableGenerationCapacity: number;
    requiredPowerDemand: number;
    requiredPowerAllocated: number;
    unpoweredFacilities: UnpoweredFacilityForecast[];
    /** Compatibility aliases used by the existing compact HUD. */
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
  finalHordeTurn: number;
  actionsTakenThisTurn: number;
  phase: GamePhase;
  mapId: string;
  map: FixedMap;
  facilities: FacilityState[];
  population: PopulationState;
  cityPopulationSnapshot: CityPopulationSnapshot;
  resources: ResourceState;
  units: UnitState[];
  checkpoints: CheckpointState[];
  roadBranches: RoadBranchState[];
  pendingUnitProductions: UnitProductionOrder[];
  nextCheckpointNumber: number;
  nextConstructibleFacilityNumber: number;
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

export interface AssignWorkersAction {
  type: 'AssignWorkers';
  facilityId: FacilityId;
  workers: number;
}

export interface TransferPopulationAction {
  type: 'TransferPopulation';
  fromFacilityId: FacilityId;
  toFacilityId: FacilityId;
  people: number;
}

export interface SetCheckpointPolicyAction {
  type: 'SetCheckpointPolicy';
  branchId: RoadBranchId;
  policy: CheckpointPolicy;
}

export interface SetPowerSupplyAction {
  type: 'SetPowerSupply';
  facilityId: FacilityId;
  enabled: boolean;
}

export interface BuildCheckpointAction {
  type: 'BuildCheckpoint';
  branchId?: RoadBranchId;
  position: HexCoord;
}

export interface BuildConstructibleFacilityAction {
  type: 'BuildConstructibleFacility';
  facilityType: ConstructibleFacilityType;
  position: HexCoord;
}

export interface RelocateCheckpointAction {
  type: 'RelocateCheckpoint';
  checkpointId: string;
  branchId?: RoadBranchId;
  position: HexCoord;
}

export interface ActivateCheckpointAction {
  type: 'ActivateCheckpoint';
  branchId: RoadBranchId;
  checkpointId: string;
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
  | AssignWorkersAction
  | TransferPopulationAction
  | SetCheckpointPolicyAction
  | SetPowerSupplyAction
  | BuildConstructibleFacilityAction
  | BuildCheckpointAction
  | RelocateCheckpointAction
  | ActivateCheckpointAction
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
  getCheckpointPositionCandidates(): CheckpointPositionCandidate[];
  getConstructibleFacilityPositionCandidates(facilityType: ConstructibleFacilityType): ConstructibleFacilityPositionCandidate[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}

export interface UnitConfig {
  hp: number;
  attack: number;
  movement: number;
  range: number;
  vision: number;
  population: number;
  maxFuel: number;
  maxMilitaryGoods: number;
  fixedMilitaryGoodsUpkeepPerTurn: number;
  attackMilitaryGoodsCostByRange: Record<number, number>;
  suppressionMilitaryGoodsCost: number;
  militaryGoodsShortageAttackMultiplier: number;
  emergencyMovementPoints: number;
}

export interface ProductionRule {
  inputs: Partial<Record<ResourceType, number>>;
  outputs: Partial<Record<ResourceType, number>>;
  powerMode: PowerMode;
  /** Compatibility alias; true only for required-power facilities. */
  requiresPower: boolean;
  powerCapacity: number;
  /** Electricity capacity generated per worker (used by power plants). */
  powerGeneration: number;
  /** Fixed generation independent of workers, used by Wind Power Plants. */
  fixedPowerGeneration: number;
}

export interface FacilityConfig {
  workerCapacity: number;
  production: ProductionRule;
  /** Number of zombies created when this facility falls. */
  overrunSpawnCount: number;
  buildCivilianGoods: number;
  visionRadius: number;
  zombieTargetValue: number;
}

export interface ConstructibleFacilityConfig {
  limitPerTypeDivisor: number;
}

export interface HordeComposition {
  hordeZombie: number;
  zombie: number;
}

export interface HordeWaveConfig {
  turn: number;
  directionCount: 1 | 2 | 3 | 4;
  compositionPerDirection: HordeComposition;
  final: boolean;
}

export interface HordeConfig {
  warningLeadTurns: number;
  waves: HordeWaveConfig[];
}

export interface TerrainConfig {
  movementCost: Record<BaseTerrain, number | null>;
  damageMultiplier: {
    urban: number;
    forestZombie: number;
  };
}

export interface VisionConfig {
  capital: number;
  ownedFacility: number;
  operationalCheckpoint: number;
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
  zombieSpawnPopulationPerUnit: number;
  maxZombieSpawnPerResolution: number;
  zombieSpawnRadius: number;
  noiseRespawnEnabled: boolean;
  policeSuppression: number;
  nationalGuardSuppression: number;
  nationalGuardCivilianDamageRate: number;
}

export interface CheckpointConfig {
  constructionCivilianGoods: number;
  maxPreparedPostsPerDirection: number;
  requiresPolice: boolean;
  consumesPower: boolean;
  initialSupplyRadius: number;
}

export interface NoiseConfig {
  police: number;
  nationalGuard: number;
  publicClass: Record<HumanUnitType, NoiseClass>;
}

export interface EconomyConfig {
  populationConsumption: {
    food: number;
    civilianGoods: number;
  };
  initialResources: ResourceStock;
  initialWorkersByFacility: Record<FacilityId, number>;
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
  /** Fraction of maximum HP restored after combat or infection suppression. */
  combatRate: number;
  /** Fraction of maximum HP restored when no combat or suppression occurred. */
  restRate: number;
  rounding: 'ceil' | 'floor';
}

export interface GameConfig {
  version: string;
  mapId: string;
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
  constructibleFacility: ConstructibleFacilityConfig;
  noise: NoiseConfig;
  terrain: TerrainConfig;
  vision: VisionConfig;
}

/** A recursively partial configuration used by options screens and tests. */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
