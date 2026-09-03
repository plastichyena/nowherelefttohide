import type {
  CardinalDirection,
  CheckpointPolicy,
  CheckpointPositionCandidate,
  CheckpointRole,
  CheckpointStatus,
  ConstructibleFacilityPositionCandidate,
  DeepPartial,
  EndTurnForecast,
  FacilityOperationalStatus,
  FacilityStatus,
  FacilityType,
  GameAction,
  GameConfig,
  GameEvent,
  GameEventType,
  GameOverReason,
  GamePhase,
  HexCoord,
  HordeComposition,
  HumanUnitType,
  JsonObject,
  NoiseClass,
  PowerMode,
  PowerSupplyReason,
  ResourceState,
  ResourceType,
  StrategicForecast,
  BaseTerrain,
  TerrainDefenseSource,
  UnitActionState,
  UnitType,
} from '../core/types';
import type { UnitRecoveryClass } from '../core/recovery';
import type { GameMetrics } from './metrics';

/** v1.4.4 has no compatibility or migration path for v1.4.3 data. */
export const APP_VERSION = '1.4.4';
export const GAME_RULES_VERSION = '2.4.0';
export const SAVE_FORMAT_VERSION = '9';
export const AGENT_API_VERSION = '6.0.0';
export const OBSERVATION_API_VERSION = '6.0.0';
export const BRIDGE_API_VERSION = '6.0.0';
export const BALANCED_AGENT_VERSION = '4.4.0';
export const RANDOM_AGENT_VERSION = '2.3.0';
export const ARTIFACT_SCHEMA_VERSION = '5.0.0';
export const CHECKPOINT_SCHEMA_VERSION = '2.0.0';

export interface AgentMapTileObservation {
  q: number;
  r: number;
  /** Base terrain is public even outside the current visibility union. */
  terrain: BaseTerrain;
  passable: boolean;
  road: boolean;
  /** True when a facility or checkpoint occupies this tile. */
  urban: boolean;
  facilityId: string | null;
  checkpointId: string | null;
  effectiveMovementCost: number | null;
  terrainDefenseSource: TerrainDefenseSource;
  terrainDamageMultiplier: number;
  visibleToPlayer: boolean;
  hordeEntranceDirections: CardinalDirection[];
  /** Static Map Rule: Player units and Player-owned placements may occupy this Hex. */
  playerOccupancyAllowed: boolean;
}

export interface AgentMapObservation {
  id: string;
  width: number;
  height: number;
  coordinateSystem: 'axial-q-r';
  tiles: AgentMapTileObservation[];
  /** Static outer-ring Horde Spawn Reserve, duplicated for direct consumers. */
  hordeSpawnReserve: HexCoord[];
}

export interface AgentRoadBranchObservation {
  branchId: string;
  direction: CardinalDirection;
  capitalConnection: HexCoord;
  roadTiles: HexCoord[];
  entrance: HexCoord;
  nextArrivalTurn: number | null;
  turnsUntilArrival: number | null;
  /** Final Wave commit permanently stops new natural arrivals. */
  arrivalsEnded: boolean;
  /** Current branch-specific cost; the first ever Build is discounted. */
  checkpointBuildCost: number;
  checkpointRelocateCost: number;
  /** Qualitative public warning; direction/count/bonus remain private. */
  rejectionMayStrengthenFutureHorde: true;
  activeCheckpointId: string | null;
  activeCheckpointStatus: CheckpointStatus | null;
  standbyCheckpointIds: string[];
  dormantCheckpointIds: string[];
  /** Structural fallback availability; never reveals hidden-Zombie exclusion. */
  fallbackAvailable: boolean;
  currentPolicy: CheckpointPolicy;
  currentPolicyTurns: number;
  preparedPostCount: number;
  preparedPostLimit: number;
  checkpointActionsThisTurn: number;
  checkpointActionAvailable: boolean;
}

export interface AgentSupplyObservation {
  initialRadius: number;
  suppliedTileKeys: string[];
  branchRadii: Array<{ branchId: string; radius: number }>;
}

export interface AgentFacilityObservation {
  id: string;
  type: FacilityType;
  position: HexCoord;
  owner: 'player' | 'none';
  status: FacilityStatus;
  operationalStatus: FacilityOperationalStatus;
  /** True only for player-built Simple Farms and Civilian Drone Bases. */
  constructible: boolean;
  /** The Player Turn in which this constructible was accepted, if applicable. */
  builtTurn: number | null;
  /** Recovery completion turn for disabled special facilities, if pending. */
  recoveryOperationalTurn: number | null;
  /** Vision radius contributed by this facility at the current state. */
  vision: number;
  visionMode: 'ground' | 'aerial';
  terrainLosBlocking: boolean;
  healthyPopulation: number;
  /** Zombie targeting value is deliberately distinct from real population. */
  zombieTargetValue: number;
  infectedPopulation: number;
  populationCapacity: number;
  populationLimitKind: 'soft' | 'hard';
  populationOperational: boolean;
  populationUnavailableReason: string | null;
  inSupply: boolean;
  populationIncreaseAvailable: boolean;
  populationDecreaseAvailable: boolean;
  recruitmentAvailable: boolean;
  recruitmentUnavailableReason: string | null;
  production: {
    inputsPerWorker: Partial<Record<ResourceType, number>>;
    outputsPerWorker: Partial<Record<ResourceType, number>>;
    requiresPower: boolean;
    requiredPowerCapacity: number;
    powerGenerationPerWorker: number;
    powerMode: PowerMode;
    powerDemand: number;
    powerSupplyEnabled: boolean;
    projectedPowerRequested: boolean;
    projectedPowerSupplied: boolean;
    projectedPowerReason: PowerSupplyReason;
    lastPowerSupplied: boolean | null;
    projectedProductionMultiplier: number;
    baseProduction: Partial<Record<ResourceType, number>>;
    projectedProduction: Partial<Record<ResourceType, number>>;
    estimatedInputConsumption: Partial<Record<ResourceType, number>>;
    estimatedOutput: Partial<Record<ResourceType, number>>;
    estimatedPowerGeneration: number;
    stoppedReason: string | null;
    projectedInputLossIfInfectedOrOverrun: Partial<Record<ResourceType, number>>;
    projectedOutputLossIfInfectedOrOverrun: Partial<Record<ResourceType, number>>;
    projectedPowerLossIfInfectedOrOverrun: number;
  };
  infectionContained: boolean;
  containingUnitId: string | null;
  projectedSuppression: number;
  projectedCivilianDamage: number;
  /** Only an eligible Civilian Drone Base can expose this refund. */
  decommissionRefundCivilianGoods: number | null;
}

export interface AgentUnitObservation {
  id: string;
  type: UnitType;
  /** Explicit v1.4 name; `type` remains as the established alias. */
  unitType: UnitType;
  position: HexCoord;
  vision: number;
  visionMode: 'ground' | 'aerial';
  terrainLosBlocking: boolean;
  positionTerrain: BaseTerrain;
  effectiveMovementCostAtPosition: number | null;
  terrainDefenseSource: TerrainDefenseSource;
  terrainDamageMultiplier: number;
  hp: number;
  maxHp: number;
  attack: number;
  movement: number;
  /** Deprecated base range alias retained for simple v1.1 consumers. */
  range: number;
  baseRange: number;
  effectiveRange: number;
  rangeModifierReason: 'carried_military_goods_shortage' | null;
  population: number;
  actionState: UnitActionState;
  canAttack: boolean;
  canMove: boolean;
  inSupply: boolean;
  currentFuel: number;
  maxFuel: number;
  currentMilitaryGoods: number;
  maxMilitaryGoods: number;
  fixedMilitaryGoodsUpkeepPerTurn: number;
  attackMilitaryGoodsCostByRange: Record<number, number>;
  suppressionMilitaryGoodsCost: number;
  emergencyMovementPoints: number;
  emergencyMovementAvailable: boolean;
  /** Exact Core previews for every currently legal Move of this Unit. */
  fuelCostByLegalMove: Array<{
    destination: HexCoord;
    fuelCost: number;
    projectedFuelAfterMove: number;
    movementMode: 'normal' | 'emergency';
    effectiveMovementCost: number;
  }>;
  attackPreviews: Array<{
    targetUnitId: string;
    distance: number;
    militaryGoodsCost: number;
    projectedMilitaryGoodsAfterAttack: number;
    effectiveAttack: number;
    projectedDamageBeforeTerrain: number;
    projectedDamageAfterTerrain: number;
  }>;
  projectedRefillDemandIfTurnEndsNow: number;
  projectedRefillAmountIfTurnEndsNow: number;
  projectedMilitaryGoodsAfterFixedConsumption: number;
  projectedMilitaryGoodsAfterRefill: number;
  projectedMilitaryGoodsAfterSuppression: number;
  recoveryClassIfTurnEndsNow: UnitRecoveryClass | null;
  recoveryRateIfTurnEndsNow: number;
  recoveryBaseAmountIfTurnEndsNow: number;
  recoveryTiming: 'nextPlayerTurnStart' | null;
  recoveryConditions: {
    requiresSurvival: boolean;
    requiresSupplyAtRecovery: boolean;
  };
  infectionContainmentCapable: boolean;
  suppressionPower: number;
  suppressionCivilianDamage: number;
  suppressionAvailableIfTurnEndsNow: boolean;
  suppressionStatusIfTurnEndsNow: 'suppression' | 'containment_only' | 'none';
  suppressionTargetId: string | null;
}

export interface AgentCheckpointObservation {
  id: string;
  branchId: string;
  position: HexCoord;
  direction: CardinalDirection;
  /** Vision radius contributed by an operational checkpoint. */
  vision?: number;
  visionMode?: 'ground';
  terrainLosBlocking?: true;
  status: 'operational' | 'remnant' | 'ruined' | 'abandoned';
  role: CheckpointRole;
  waiting: number;
  screening: number;
  approved: number;
  queuePeople: number;
  screeningCapacity: number;
  estimatedScreeningThroughput: number;
  arrivalIntervalMin: number;
  arrivalIntervalMax: number;
  arrivalPeopleMin: number;
  arrivalPeopleMax: number;
  queuePressureClass: 'none' | 'low' | 'medium' | 'high';
  healthyQueueConsumesMaintenance: true;
  queueMaintenanceFood: number;
  queueMaintenanceCivilianGoods: number;
  infected: number;
  remainingTurns: number;
  currentPolicy: CheckpointPolicy;
  currentPolicyTurns: number;
  nextPolicy: CheckpointPolicy;
  nextArrivalTurn: number | null;
  providesSupply: boolean;
  infectionContained: boolean;
  containingUnitId: string | null;
  projectedSuppression: number;
  projectedCivilianDamage: number;
}

export interface AgentApiInfo {
  appVersion: string;
  gameRulesVersion: string;
  saveFormatVersion: string;
  artifactSchemaVersion: string;
  agentApiVersion: string;
  observationApiVersion: string;
  bridgeApiVersion: string;
  buildId: string;
  methods: string[];
  methodSchemas: Record<string, { arguments: string; returns: string; description: string }>;
  recommendedCallOrder: string[];
  publicInformation: string[];
  prohibited: string[];
  rules: {
    recovery: {
      combatRate: number;
      restRate: number;
      rounding: 'ceil' | 'floor';
      timing: 'nextPlayerTurnStart';
      supplyRequiredAtRecovery: true;
      combatActivities: string[];
      restActivities: string[];
    };
    infection: {
      stationedUnitsContainSpread: true;
      automaticSuppressionTiming: 'infectionPhaseAfterEndTurn';
      policeSuppression: number;
      nationalGuardSuppression: number;
      nationalGuardCivilianDamageFormula: string;
      zombieSpawnPopulationPerUnit: number;
      maxZombieSpawnPerResolution: number;
      zombieSpawnRadius: number;
      noiseRespawnEnabled: boolean;
    };
    ranges: Record<'police' | 'nationalGuard' | 'zombie' | 'hordeZombie' | 'policeZombie' | 'soldierZombie', { baseRange: number }>;
    terrain: {
      movementCost: Record<BaseTerrain, number | null>;
      damageMultiplier: {
        urban: number;
        forestZombie: number;
      };
      roadAndUrbanMovementCost: number;
      defenseRounding: 'ceil';
      minimumDamage: number;
    };
    vision: {
      unitVision: Record<UnitType, number>;
      capital: number;
      ownedFacility: number;
      operationalCheckpoint: number;
      distance: 'hex';
      terrainBlocks: boolean;
      groundBlockingTerrain: BaseTerrain[];
      firstBlockingHexVisible: true;
      zombieVisionTerrainLosBlocking: false;
      combatNoiseTerrainLosBlocking: false;
      attackLineTerrainLosBlocking: false;
      sources: string[];
    };
    fogOfWar: {
      enemyVisibility: 'visible_only';
      mapTerrainAlwaysKnown: true;
      hiddenEnemyPositionPublic: false;
      hiddenEnemyTargetPublic: false;
      hiddenEnemySpawnCoordinatePublic: false;
      hiddenEnemyCountPublic: false;
    };
    map: {
      id: string;
      width: number;
      height: number;
      coordinateSystem: 'axial-q-r';
      hordeSpawnReserve: HexCoord[];
      playerOccupancyRule: string;
    };
    horde: {
      warningLeadTurns: number;
      waves: Array<{
        index: number;
        turn: number;
        directionCount: number;
        compositionPerDirection: HordeComposition;
        final: boolean;
      }>;
      finalHordeTurn: number;
      finalHordeTurnRule: string;
      warningDirectionRule: string;
      warningDirectionsPublicAfter: 'warning_start';
    };
    victory: {
      requiresFinalHorde: true;
      progressFields: string[];
      defeatPrecedesVictory: true;
    };
    checkpointPolicies: Record<CheckpointPolicy, {
      turns: number;
      acceptanceRate: number;
      infectionBatchRate: number;
      infectedPopulationRate: number;
    }>;
    checkpointPositionCandidates: {
      observationField: 'checkpointPositionCandidates';
      schema: {
        actionType: 'BuildCheckpoint | RelocateCheckpoint | ActivateCheckpoint';
        branchId: 'string';
        checkpointId: 'string (RelocateCheckpoint / ActivateCheckpoint; omitted for BuildCheckpoint)';
        position: '{ q: number; r: number }';
        legal: 'boolean';
        reasonCode: 'ActionError.code | null';
      };
      ordering: 'branch_id_then_branch_road_tile_order';
      includesIllegalCandidates: true;
      reasonCodes: Record<string, string>;
      fairPlay: {
        hiddenEnemiesBlock: false;
        visibleEnemiesCanBlock: true;
        blockerUnitIdsPublic: false;
        prngStatePublic: false;
        futureRandomOutcomesPublic: false;
      };
    };
    checkpoint: {
      roles: CheckpointRole[];
      activePerBranchLimit: 1;
      preparedPostLimit: number;
      screeningCapacity: number;
      estimatedScreeningThroughputByPolicy: Record<CheckpointPolicy, number>;
      queuePressureThresholds: Record<'none' | 'low' | 'medium' | 'high', { min: number; max: number | null }>;
      policyOwner: 'road_branch';
      fallbackPriority: string[];
      standbyProvidesArrivalSupplyVision: false;
      dormantProvidesArrivalSupplyVision: false;
    };
    unitFuel: {
      movementByType: Record<'police' | 'nationalGuard', number>;
      maxFuelByType: Record<'police' | 'nationalGuard', number>;
      fuelCostFormulaByType: Record<'police' | 'nationalGuard', string>;
      refuelTiming: 'after_power_before_production';
      refuelRequiresSupply: true;
      shortageAllocation: 'unit_id_ascending_round_robin';
      emergencyMovementPointsByType: Record<'police' | 'nationalGuard', number>;
      emergencyMovementTrigger: 'current_fuel_zero';
      emergencyMovementUsesEffectiveMovementCost: true;
    };
    unitMilitaryGoods: {
      maxByType: Record<'police' | 'nationalGuard', number>;
      fixedUpkeepByType: Record<'police' | 'nationalGuard', number>;
      attackCostByRange: Record<'police' | 'nationalGuard', Record<number, number>>;
      suppressionCostByType: Record<'police' | 'nationalGuard', number>;
      shortageAttackMultiplierByType: Record<'police' | 'nationalGuard', number>;
      refillTiming: 'after_military_factory_production_before_suppression';
      refillRequiresSupply: true;
      shortageAllocation: 'unit_id_ascending_round_robin';
      destroyedUnitReturnsCarriedGoods: false;
    };
    constructibleFacilities: {
      types: Array<'simpleFarm' | 'civilianDroneBase'>;
      limitFormula: string;
      buildConditions: string[];
      costs: Record<'simpleFarm' | 'civilianDroneBase', number>;
      stateTransitions: string[];
      simpleFarm: { workerCapacity: number; requiredPower: number; foodPerWorker: number };
      civilianDroneBase: { workerCapacity: number; requiredPower: number; visionPerWorker: number };
      windPowerPlant: { fixedPower: number; vision: number; zombieTargetValue: number; supplySource: false };
    };
    strategicForecast: {
      observationField: 'strategicForecast';
      resources: string[];
      guaranteedDefeat: string[];
      queuePressureThresholds: Record<'none' | 'low' | 'medium' | 'high', string>;
    };
    noise: {
      classes: NoiseClass[];
      policeClass: NoiseClass;
      nationalGuardClass: NoiseClass;
      distance: 'hex';
      terrainAttenuation: false;
      normalZombieAffected: true;
      hordeZombieAffected: false;
      targetPriority: string[];
    };
    production: {
      workerCapacityByFacilityType: Record<FacilityType, number>;
      powerPlantsGenerateCapacityPerWorker: number;
      poweredFacilitiesConsumeFixedCapacityWhenOperating: true;
      fuelPerFiveElectricity: number;
      facilityPowerUnit: number;
      powerModes: PowerMode[];
      standardOutputRule: {
        requiredPowered: 'base';
        requiredUnpowered: 0;
        nonePowered: 'base';
      };
      unpoweredCityCivilianGoodsOutputIsZero: true;
      sameTurnProductionCanCoverMaintenance: true;
      sameTurnProductionCanCoverProductionInputs: false;
      sameTurnCivilianGoodsCannotDirectlyFeedMilitaryFactories: true;
      civilianProductionCanReleaseTurnStartStockFromMaintenanceReservation: true;
      powerAllocationOrder: string[];
    };
  };
  minimalExample: string;
}

export interface AgentGameResult {
  outcome: 'won' | 'lost';
  reason: GameOverReason;
  turn: number;
  statistics: {
    maxPopulation: number;
    maxSecuredFacilities: number;
    civilianLosses: number;
    unitLosses: number;
    infectionLosses: number;
    resourceShortageLosses: number;
    hordeInterceptions: number;
    refugeeArrivalsByBranch: Record<string, number>;
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
    checkpointFallbacksByBranch: Record<string, number>;
    checkpointFallbacksFromStandby: number;
    checkpointFallbacksFromDormant: number;
    checkpointFallbacksPreventingUnmanagedArrival: number;
    maxCheckpointPostsPerBranch: number;
    maxPreparedCheckpointPostsPerBranch: number;
    activeCheckpointLosses: number;
    /** Public combat facts. Hidden reactions are intentionally not exposed. */
    noisePulsesEmitted: number;
    policeNoisePulses: number;
    nationalGuardNoisePulses: number;
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
  };
}

export interface AgentObservation {
  apiVersion: string;
  gameRulesVersion: string;
  turn: number;
  finalHordeTurn: number;
  phase: GamePhase;
  map: AgentMapObservation;
  resources: ResourceState;
  population: {
    healthyCivilians: number;
    cityResidents: number;
    productionWorkers: number;
    unitPopulation: number;
    waitingRefugees: number;
    screeningRefugees: number;
    approvedRefugees: number;
    infected: number;
  };
  facilities: AgentFacilityObservation[];
  units: AgentUnitObservation[];
  zombies: AgentUnitObservation[];
  checkpoints: AgentCheckpointObservation[];
  /** Last 50 public site infection/fall/spawn events, including off-screen sites. */
  importantSiteEvents: AgentPublicEvent[];
  checkpointPositionCandidates: CheckpointPositionCandidate[];
  constructibleFacilityPositionCandidates: ConstructibleFacilityPositionCandidate[];
  roadBranches: AgentRoadBranchObservation[];
  supply: AgentSupplyObservation;
  horde: {
    warningType: 'periodic' | 'final' | 'none';
    warningDirections: CardinalDirection[];
    nextWaveIndex: number | null;
    nextWave: {
      index: number;
      spawnTurn: number;
      directionCount: number;
      compositionPerDirection: HordeComposition;
      final: boolean;
    } | null;
    spawnTurn: number | null;
    finalHordeStatus: 'notStarted' | 'active' | 'defeated';
    turnsRemaining: number;
    nextSpawnTurn: number | null;
  };
  /** Public Victory progress; no hidden enemy count or coordinate is included. */
  victory: {
    finalHordeDefeated: boolean;
    suppliedAreaZombieClear: boolean;
    suppliedAreaInfectionClear: boolean;
  };
  /** Top-level aliases make the three progress facts easy to consume. */
  finalHordeDefeated: boolean;
  suppliedAreaZombieClear: boolean;
  suppliedAreaInfectionClear: boolean;
  endTurnForecast: EndTurnForecast;
  strategicForecast: StrategicForecast;
  gameOver: boolean;
  result: AgentGameResult | null;
}

export interface AgentPublicEvent {
  id: string;
  turn: number;
  phase: GamePhase;
  type: GameEventType;
  payload: JsonObject;
}

export interface AgentActionError {
  code: string;
  message: string;
}

export interface AgentStepResult {
  observation: AgentObservation;
  events: AgentPublicEvent[];
  error: AgentActionError | null;
  gameOver: boolean;
  result: AgentGameResult | null;
}

export interface AgentResetOptions {
  seed?: number;
  configOverrides?: DeepPartial<GameConfig>;
  agent?: { id: string };
}

export interface InvalidActionAttempt {
  decision: number;
  action: unknown;
  error: AgentActionError;
}

export type AgentPriorityGoal =
  | 'avoid_defeat'
  | 'prevent_facility_contact'
  | 'rescue_critical_infection'
  | 'defend_horde'
  | 'suppress_infection'
  | 'restore_military_supply'
  | 'restore_economy'
  | 'reduce_overcrowding'
  | 'build_forces'
  | 'secure_facilities'
  | 'manage_checkpoint'
  | 'combat'
  | 'end_turn';

export interface AgentCandidateScore {
  action: GameAction;
  score: number;
  reasonCodes: string[];
}

export interface AgentDecisionTrace {
  turn: number;
  decision: number;
  priorityGoal: AgentPriorityGoal;
  selectedAction: GameAction;
  selectedScore: number;
  topCandidates: AgentCandidateScore[];
  reasonCodes: string[];
  /** Short public rationale; never private chain-of-thought. */
  decisionSummary: string;
}

export interface AgentDecision {
  action: GameAction;
  trace?: Omit<AgentDecisionTrace, 'turn' | 'decision' | 'decisionSummary'> & {
    decisionSummary?: string;
  };
}

export interface GameAgent {
  readonly id: string;
  readonly version: string;
  decide(observation: AgentObservation, legalActions: readonly GameAction[]): AgentDecision;
}

export interface AgentRunArtifact {
  artifactSchemaVersion: string;
  artifactType?: 'replay' | 'failure';
  appVersion: string;
  gameRulesVersion: string;
  agentApiVersion: string;
  observationApiVersion: string;
  bridgeApiVersion: string;
  buildId: string;
  mapId: string;
  seed: number;
  config: GameConfig;
  agent: { id: string; version?: string; strategy?: string };
  initialRoadArrivalSchedule: Array<{ branchId: string; nextArrivalTurn: number | null }>;
  acceptedActions: GameAction[];
  invalidAttempts: InvalidActionAttempt[];
  decisionTrace: AgentDecisionTrace[];
  /** Present for a Session artifact; absent for a standalone run. */
  sessionLineage?: { parentSessionId: string | null; parentCheckpointId: string | null };
  result: AgentGameResult | null;
  /** Static map projection stored once per game by Artifact Schema 5.0.0. */
  fixedMap?: AgentMapObservation;
  /** Dynamic public observations at reset and after each accepted action. */
  observationTrace?: AgentArtifactObservation[];
  /** Present on complete Runner artifacts and optionally on a live AgentGame. */
  metrics?: AgentPublicMetrics;
  /** Local/CI Runner-only Core events. Browser Bridge artifacts never include this field. */
  verificationEvents?: GameEvent[];
  events?: AgentPublicEvent[];
}

/**
 * Artifact Schema 5.0.0 stores topology once and keeps only dynamic map
 * visibility in each trace entry.  Live observations remain complete.
 */
export type AgentArtifactObservation = Omit<AgentObservation, 'map'> & {
  mapId: string;
  visibleTileKeys: string[];
};

/**
 * Noise reaction counts can reveal hidden enemy activity.  They are retained
 * only in local/CI verification metrics and never in a production result or
 * Browser Bridge artifact. Final special-Zombie survivor totals are included
 * because a surviving unit may have left player vision before Game Over.
 */
export const HIDDEN_NOISE_METRIC_KEYS = [
  'normalZombiesNoiseTargeted',
  'noiseTargetsReached',
  'noiseTargetsOverriddenByHorde',
  'noiseTargetsOverriddenByVisiblePopulation',
  'aerialDiscoveriesInGroundBlockedArea',
  'policeZombiesFinal',
  'soldierZombiesFinal',
] as const;

export type HiddenNoiseMetricKey = typeof HIDDEN_NOISE_METRIC_KEYS[number];

/**
 * Rejected-refugee detail predicts a future Horde composition. It remains
 * verification-only just like hidden Noise reaction detail.
 */
export const HIDDEN_REJECTED_REFUGEE_METRIC_KEYS = [
  'refugeesRejectedByDirectionAndPolicy',
  'refugeesTurnedAwayByDirection',
  'rejectedBonusZombiesByDirection',
  'rejectedCounterResetsByDirection',
] as const;

export type HiddenRejectedRefugeeMetricKey = typeof HIDDEN_REJECTED_REFUGEE_METRIC_KEYS[number];
export type AgentPublicConfig = Omit<GameConfig, 'noise'> & {
  noise: Pick<GameConfig['noise'], 'publicClass'>;
};
export type AgentPublicMetrics = Omit<GameMetrics, HiddenNoiseMetricKey | HiddenRejectedRefugeeMetricKey | 'config'> & {
  config: AgentPublicConfig;
};
export type AgentPublicRunArtifact = Omit<
  AgentRunArtifact,
  'artifactType' | 'config' | 'metrics' | 'verificationEvents'
> & {
  config: AgentPublicConfig;
  metrics?: AgentPublicMetrics;
};

export interface AgentGame {
  getApiInfo(): AgentApiInfo;
  reset(options?: AgentResetOptions): AgentObservation;
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(action: GameAction): AgentStepResult;
  isGameOver(): boolean;
  getResult(): AgentGameResult | null;
  getRunArtifact(): AgentPublicRunArtifact;
}

export type AgentStrategyId = 'random' | 'balanced';
export type AgentProducedUnit = HumanUnitType;
