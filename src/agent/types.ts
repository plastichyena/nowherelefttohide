import type {
  CardinalDirection,
  CheckpointPolicy,
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
  ResourceState,
  UnitActionState,
  UnitType,
} from '../core/types';

export const APP_VERSION = '1.2.0';
export const AGENT_API_VERSION = '1.0.0';
export const OBSERVATION_API_VERSION = '1.0.0';
export const BRIDGE_API_VERSION = '1.0.0';
export const BALANCED_AGENT_VERSION = '2.0.0';
export const RANDOM_AGENT_VERSION = '1.0.0';

export interface AgentMapTileObservation {
  q: number;
  r: number;
  passable: boolean;
  road: boolean;
  facilityId: string | null;
  hordeEntranceDirections: CardinalDirection[];
}

export interface AgentMapObservation {
  id: string;
  width: number;
  height: number;
  coordinateSystem: 'axial-q-r';
  tiles: AgentMapTileObservation[];
}

export interface AgentFacilityObservation {
  id: string;
  type: FacilityType;
  position: HexCoord;
  owner: 'player' | 'none';
  status: FacilityStatus;
  operationalStatus: FacilityOperationalStatus;
  healthyPopulation: number;
  infectedPopulation: number;
  populationCapacity: number;
  populationLimitKind: 'soft' | 'hard';
  populationOperational: boolean;
  populationUnavailableReason: string | null;
}

export interface AgentUnitObservation {
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
}

export interface AgentCheckpointObservation {
  id: string;
  position: HexCoord;
  direction: CardinalDirection;
  status: 'operational' | 'ruined';
  waiting: number;
  screening: number;
  approved: number;
  infected: number;
  remainingTurns: number;
  currentPolicy: CheckpointPolicy;
  nextPolicy: CheckpointPolicy;
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
  };
}

export interface AgentObservation {
  apiVersion: string;
  gameRulesVersion: string;
  turn: number;
  maxTurns: number;
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
  horde: {
    direction: CardinalDirection;
    turnsRemaining: number;
    nextSpawnTurn: number | null;
  };
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
  acceptedActions: GameAction[];
  invalidAttempts: InvalidActionAttempt[];
  decisionTrace: AgentDecisionTrace[];
  result: AgentGameResult | null;
}

export interface AgentGame {
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
