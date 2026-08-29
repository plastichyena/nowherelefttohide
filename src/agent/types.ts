import type {
  CardinalDirection,
  CheckpointPolicy,
  CheckpointStatus,
  DeepPartial,
  EndTurnForecast,
  FacilityOperationalStatus,
  FacilityStatus,
  FacilityType,
  GameAction,
  GameConfig,
  GameEventType,
  GameOverReason,
  GamePhase,
  HexCoord,
  HumanUnitType,
  JsonObject,
  PowerMode,
  PowerSupplyReason,
  ResourceState,
  ResourceType,
  BaseTerrain,
  TerrainDefenseSource,
  UnitActionState,
  UnitType,
} from '../core/types';
import type { UnitRecoveryClass } from '../core/recovery';
import type { GameMetrics } from './metrics';

export const APP_VERSION = '1.3.0';
export const GAME_RULES_VERSION = '1.4.0';
export const SAVE_FORMAT_VERSION = '3';
export const AGENT_API_VERSION = '1.4.0';
export const OBSERVATION_API_VERSION = '1.4.0';
export const BRIDGE_API_VERSION = '1.4.0';
export const BALANCED_AGENT_VERSION = '3.0.0';
export const RANDOM_AGENT_VERSION = '1.2.0';
export const ARTIFACT_SCHEMA_VERSION = '1.4.0';

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
}

export interface AgentMapObservation {
  id: string;
  width: number;
  height: number;
  coordinateSystem: 'axial-q-r';
  tiles: AgentMapTileObservation[];
}

export interface AgentRoadBranchObservation {
  branchId: string;
  direction: CardinalDirection;
  capitalConnection: HexCoord;
  roadTiles: HexCoord[];
  entrance: HexCoord;
  nextArrivalTurn: number;
  turnsUntilArrival: number;
  activeCheckpointId: string | null;
  activeCheckpointStatus: CheckpointStatus | null;
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
  /** Vision radius contributed by this facility at the current state. */
  vision: number;
  healthyPopulation: number;
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
}

export interface AgentUnitObservation {
  id: string;
  type: UnitType;
  /** Explicit v1.4 name; `type` remains as the established alias. */
  unitType: UnitType;
  position: HexCoord;
  vision: number;
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
  rangeModifierReason: 'military_supply_shortage' | null;
  population: number;
  actionState: UnitActionState;
  canAttack: boolean;
  canMove: boolean;
  inSupply: boolean;
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
  suppressionTargetId: string | null;
}

export interface AgentCheckpointObservation {
  id: string;
  branchId: string;
  position: HexCoord;
  direction: CardinalDirection;
  /** Vision radius contributed by an operational checkpoint. */
  vision?: number;
  status: 'operational' | 'remnant' | 'ruined' | 'abandoned';
  waiting: number;
  screening: number;
  approved: number;
  infected: number;
  remainingTurns: number;
  currentPolicy: CheckpointPolicy;
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
    };
    ranges: Record<'police' | 'nationalGuard' | 'zombie' | 'hordeZombie', { baseRange: number }> & {
      nationalGuardMilitarySupplyShortageRange: number;
    };
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
      terrainBlocks: false;
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
    horde: {
      cycle: number;
      initialCount: number;
      increment: number;
      warningStartTurn: number;
      spawnOnlyBeforeFinalTurn: boolean;
      finalHordeTurn: number;
      finalCount: number;
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
    production: {
      workerCapacityByFacilityType: Record<FacilityType, number>;
      powerPlantsGenerateCapacityPerWorker: number;
      poweredFacilitiesConsumeFixedCapacityWhenOperating: true;
      fuelPerFiveElectricity: number;
      facilityPowerUnit: number;
      industrialPoweredMultiplier: number;
      industrialUnpoweredMultiplier: number;
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
  roadBranches: AgentRoadBranchObservation[];
  supply: AgentSupplyObservation;
  horde: {
    warningType: 'periodic' | 'final' | 'none';
    warningDirection: CardinalDirection;
    spawnTurn: number | null;
    finalHordeStatus: 'notStarted' | 'active' | 'defeated';
    /** Established aliases retained for clients that consumed v1.3 Horde data. */
    direction: CardinalDirection;
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
}

export interface AgentDecision {
  action: GameAction;
  trace?: Omit<AgentDecisionTrace, 'turn' | 'decision'>;
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
  initialRoadArrivalSchedule: Array<{ branchId: string; nextArrivalTurn: number }>;
  acceptedActions: GameAction[];
  invalidAttempts: InvalidActionAttempt[];
  decisionTrace: AgentDecisionTrace[];
  result: AgentGameResult | null;
  /** Public observations at reset and after each accepted action, when retained by a runner. */
  observationTrace?: AgentObservation[];
  /** Present on complete Runner artifacts and optionally on a live AgentGame. */
  metrics?: GameMetrics;
  events?: AgentPublicEvent[];
}

export interface AgentGame {
  getApiInfo(): AgentApiInfo;
  reset(options?: AgentResetOptions): AgentObservation;
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(action: GameAction): AgentStepResult;
  isGameOver(): boolean;
  getResult(): AgentGameResult | null;
  getRunArtifact(): AgentRunArtifact;
}

export type AgentStrategyId = 'random' | 'balanced';
export type AgentProducedUnit = HumanUnitType;
