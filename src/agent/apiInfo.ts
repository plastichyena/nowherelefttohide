import type { GameConfig } from '../core/types';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  GAME_RULES_VERSION,
  OBSERVATION_API_VERSION,
  SAVE_FORMAT_VERSION,
  type AgentApiInfo,
} from './types';
import { cloneJson } from './action';

const PUBLIC_METHODS = [
  'getApiInfo', 'reset', 'getObservation', 'getLegalActions', 'step',
  'isGameOver', 'getResult', 'getRunArtifact',
] as const;

export function createAgentApiInfo(
  config: Readonly<GameConfig>,
  buildId: string,
  bridgeApiVersion = BRIDGE_API_VERSION,
): AgentApiInfo {
  const policies = config.refugees.policies;
  return cloneJson({
    appVersion: APP_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    saveFormatVersion: SAVE_FORMAT_VERSION,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    agentApiVersion: AGENT_API_VERSION,
    observationApiVersion: OBSERVATION_API_VERSION,
    bridgeApiVersion,
    buildId,
    methods: [...PUBLIC_METHODS],
    methodSchemas: {
      getApiInfo: { arguments: 'none', returns: 'AgentApiInfo', description: 'Returns versions, public methods, fair-play boundaries, and static rules.' },
      reset: { arguments: 'AgentResetOptions? { seed?, configOverrides?, agent?: { id } }', returns: 'AgentObservation', description: 'Replaces the in-memory Agent session.' },
      getObservation: { arguments: 'none', returns: `AgentObservation ${OBSERVATION_API_VERSION}`, description: 'Returns a deterministic JSON copy of current public information.' },
      getLegalActions: { arguments: 'none', returns: 'GameAction[]', description: 'Returns deterministic currently legal atomic actions.' },
      step: { arguments: 'one GameAction from getLegalActions()', returns: 'AgentStepResult', description: 'Validates and applies exactly one action through GameEngine.' },
      isGameOver: { arguments: 'none', returns: 'boolean', description: 'Reports whether the Agent session ended.' },
      getResult: { arguments: 'none', returns: 'AgentGameResult|null', description: 'Returns the public result when the game has ended.' },
      getRunArtifact: { arguments: 'none', returns: `AgentRunArtifact ${ARTIFACT_SCHEMA_VERSION}`, description: 'Returns the in-memory replay artifact and public trace.' },
    },
    recommendedCallOrder: [...PUBLIC_METHODS],
    publicInformation: [
      'Use getObservation() for current public facts and getLegalActions() for currently legal operations.',
      'Call step() with one listed action at a time until isGameOver() is true.',
      'All returned values are detached JSON-compatible copies.',
    ],
    prohibited: [
      'GameState, PRNG state, future random outcomes, and unspawned Horde size are not public.',
      'LoadSnapshot, StartNewGame, SuppressInfection, arbitrary code, files, saves, localStorage, network, and Batch execution are not public actions.',
      'Do not infer or request private chain-of-thought; concise action reasons are sufficient.',
    ],
    rules: {
      recovery: {
        combatRate: config.naturalRecovery.combatRate,
        restRate: config.naturalRecovery.restRate,
        rounding: config.naturalRecovery.rounding,
        timing: 'nextPlayerTurnStart',
        supplyRequiredAtRecovery: true,
        combatActivities: ['attack', 'counterattack', 'interception', 'automatic_infection_suppression'],
        restActivities: ['move_only', 'wait', 'move_then_wait', 'no_action'],
      },
      infection: {
        stationedUnitsContainSpread: true,
        automaticSuppressionTiming: 'infectionPhaseAfterEndTurn',
        policeSuppression: config.infection.policeSuppression,
        nationalGuardSuppression: config.infection.nationalGuardSuppression,
        nationalGuardCivilianDamageFormula: `ceil(suppressionPower * ${config.infection.nationalGuardCivilianDamageRate})`,
      },
      ranges: {
        police: { baseRange: config.units.police.range },
        nationalGuard: { baseRange: config.units.nationalGuard.range },
        zombie: { baseRange: config.units.zombie.range },
        nationalGuardMilitarySupplyShortageRange: Math.min(1, config.units.nationalGuard.range),
      },
      checkpointPolicies: {
        passThrough: {
          turns: policies.passThrough.turns,
          acceptanceRate: policies.passThrough.workerRate,
          infectionBatchRate: policies.passThrough.infectionRate,
          infectedPopulationRate: policies.passThrough.infectionPopulationRate,
        },
        normal: {
          turns: policies.normal.turns,
          acceptanceRate: policies.normal.workerRate,
          infectionBatchRate: policies.normal.infectionRate,
          infectedPopulationRate: policies.normal.infectionPopulationRate,
        },
        strict: {
          turns: policies.strict.turns,
          acceptanceRate: policies.strict.workerRate,
          infectionBatchRate: policies.strict.infectionRate,
          infectedPopulationRate: policies.strict.infectionPopulationRate,
        },
      },
      production: {
        workerCapacityByFacilityType: Object.fromEntries(
          Object.entries(config.facilities).map(([type, facility]) => [type, facility.workerCapacity]),
        ) as AgentApiInfo['rules']['production']['workerCapacityByFacilityType'],
        powerPlantsGenerateCapacityPerWorker: config.facilities.powerPlant.production.powerGeneration,
        poweredFacilitiesConsumeFixedCapacityWhenOperating: true,
        fuelPerFiveElectricity: 1,
        facilityPowerUnit: 5,
        industrialPoweredMultiplier: 2,
        industrialUnpoweredMultiplier: 1,
        unpoweredCityCivilianGoodsOutputIsZero: true,
        sameTurnProductionCanCoverMaintenance: true,
        sameTurnProductionCanCoverProductionInputs: false,
        sameTurnCivilianGoodsCannotDirectlyFeedMilitaryFactories: true,
        civilianProductionCanReleaseTurnStartStockFromMaintenanceReservation: true,
        powerAllocationOrder: ['required_cities', 'farm_and_civilian_factory_boost', 'input_ready_military_factory_boost'],
      },
    },
    minimalExample: [
      'const game = window.NLTH; // Node: createAgentGame()',
      'const info = game.getApiInfo();',
      "let observation = game.reset({ seed: 1, agent: { id: 'example' } });",
      'while (!game.isGameOver()) {',
      '  const legal = game.getLegalActions();',
      '  if (legal.length === 0) break;',
      '  observation = game.step(legal[0]).observation;',
      '}',
      'const artifact = game.getRunArtifact();',
    ].join('\n'),
  } as AgentApiInfo);
}
