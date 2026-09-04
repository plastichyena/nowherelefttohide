import type { GameConfig } from '../core/types';
import { FIXED_MAP } from '../core/map';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  GAME_RULES_VERSION,
  OBSERVATION_API_VERSION,
  SAVE_FORMAT_VERSION,
  type CrisisReasonCode,
  type AgentApiInfo,
  type CrisisSeverity,
} from './types';
import { cloneJson } from './action';

const PUBLIC_METHODS = [
  'getApiInfo', 'reset', 'getObservation', 'getLegalActions', 'step',
  'isGameOver', 'getResult', 'getRunArtifact',
] as const;

const CHECKPOINT_REASON_CODES: Readonly<Record<string, string>> = Object.freeze({
  invalid_checkpoint_tile: 'The destination is not an empty road tile that can contain a checkpoint.',
  invalid_checkpoint_branch: 'The destination does not belong to the selected road branch.',
  unknown_road_branch: 'The selected road branch does not exist in the current state.',
  checkpoint_target_not_visible: 'The destination is outside current Player Vision.',
  checkpoint_route_not_visible: 'The branch road from the capital side through the destination is not fully visible.',
  checkpoint_facility_occupied: 'A permanent or constructible Facility occupies the destination.',
  checkpoint_prepared_post_limit_reached: 'The branch already has the maximum number of prepared Active and Standby posts.',
  unknown_operational_checkpoint: 'Relocation requires a known operational checkpoint.',
  unknown_activatable_checkpoint: 'Activation requires a known Standby or Dormant checkpoint on the selected branch.',
  checkpoint_same_position: 'Relocation must select a different road tile.',
  checkpoint_wrong_branch: 'A checkpoint can only relocate within its current branch.',
  checkpoint_infection_blocked: 'The checkpoint being moved or activated is infected and cannot change administrative role.',
  checkpoint_branch_action_limit: 'This branch already built, relocated, or activated a checkpoint this turn.',
  checkpoint_abandoned_forward_block: 'An infected ruined or abandoned site prevents placement at the same distance or farther from the capital.',
  checkpoint_supply_zombie_blocked: 'A player-visible Zombie is inside the candidate supply area.',
  horde_spawn_reserve: 'Player units, checkpoints, and facilities cannot occupy the Horde Spawn Reserve.',
  insufficient_civilian_goods: 'The current Civilian Goods stock cannot pay the checkpoint construction cost.',
  action_limit: 'The global action limit for this turn has been reached.',
  wrong_phase: 'Checkpoint actions are only available during the player phase.',
  game_over: 'No checkpoint action is available after Game Over.',
});

export function createAgentApiInfo(
  config: Readonly<GameConfig>,
  buildId: string,
  bridgeApiVersion = BRIDGE_API_VERSION,
): AgentApiInfo {
  const policies = config.refugees.policies;
  const configRecord = config as unknown as Record<string, unknown>;
  const units = config.units as unknown as Record<string, Record<string, unknown>>;
  const policeUnit = units.police ?? {};
  const nationalGuardUnit = units.nationalGuard ?? {};
  const unitExperience = (configRecord.unitExperience && typeof configRecord.unitExperience === 'object'
    ? configRecord.unitExperience
    : {}) as Record<string, unknown>;
  const getNumber = (record: Record<string, unknown> | undefined, key: string, fallback: number): number =>
    typeof record?.[key] === 'number' && Number.isFinite(record[key]) ? record[key] as number : fallback;
  const riotPolice = units.riotPolice ?? {};
  const riotZombie = units.riotZombie ?? {};
  // Production proficiency is a shared Unit Experience rule in v1.5. Keep
  // API metadata sourced from the same map the Core uses when commissioning.
  const productionProficiencyByType = (
    unitExperience.productionProficiencyByType ?? {
      police: 'recruit',
      nationalGuard: 'recruit',
      riotPolice: 'recruit',
    }
  ) as Record<string, string>;
  const publicProficiency = (value: string): 'recruit' | 'regular' | 'veteran' =>
    value === 'regular' || value === 'veteran' ? value : 'recruit';
  const publicProductionProficiency = Object.fromEntries(
    Object.entries(productionProficiencyByType).map(([key, value]) => [key, publicProficiency(value)]),
  );
  const crisisCategories: Record<CrisisReasonCode, { severity: CrisisSeverity; category: string }> = {
    capital_infection_uncontained: { severity: 'critical', category: 'infection' },
    critical_site_infection_uncontained: { severity: 'critical', category: 'infection' },
    checkpoint_defense_degraded: { severity: 'critical', category: 'checkpoint_defense' },
    unit_out_of_supply_risk: { severity: 'warning', category: 'unit_supply' },
    horde_warning_active: { severity: 'advisory', category: 'horde' },
    guaranteed_resource_defeat: { severity: 'critical', category: 'resources' },
    new_state_loss: { severity: 'advisory', category: 'loss' },
  };
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
      getObservation: { arguments: 'none', returns: `AgentObservation ${OBSERVATION_API_VERSION}`, description: 'Returns a deterministic JSON copy of current public information, including Ground/Aerial visibility, the last 50 important public site events, checkpoint candidates, Horde status, and Victory progress.' },
      getLegalActions: { arguments: 'none', returns: 'GameAction[]', description: 'Returns deterministic currently legal atomic actions.' },
      step: { arguments: 'one GameAction from getLegalActions()', returns: 'AgentStepResult', description: 'Validates and applies exactly one action through GameEngine.' },
      isGameOver: { arguments: 'none', returns: 'boolean', description: 'Reports whether the Agent session ended.' },
      getResult: { arguments: 'none', returns: 'AgentGameResult|null', description: 'Returns the public result when the game has ended.' },
      getRunArtifact: { arguments: 'none', returns: `AgentPublicRunArtifact ${ARTIFACT_SCHEMA_VERSION}`, description: 'Returns an in-memory public play trace without verification-only fields or exact Noise radii.' },
    },
    recommendedCallOrder: [...PUBLIC_METHODS],
    publicInformation: [
      'Use getObservation() for current public facts and getLegalActions() for currently legal operations.',
      'Call step() with one listed action at a time until isGameOver() is true.',
      'All returned values are detached JSON-compatible copies.',
      'Map terrain, roads, facility/checkpoint overlays, supply, Horde warning facts, Spawn Reserve occupancy rules, and Victory progress are public.',
      'Checkpoint observations identify Active, Standby, Dormant, Remnant, Ruined, and Abandoned posts; branch policy belongs to the road branch.',
      'checkpointPositionCandidates contains every road tile or post with the Core-derived legal flag and first ActionError reason code.',
      'BuildCheckpoint and RelocateCheckpoint require the destination and every capital-side branch road tile through it to be in current Player Vision.',
      'TurnAwayCheckpointRefugees may remove only a legal waiting-pool count. Rejected-refugee counters and their future Horde bonus are intentionally never public.',
      'DecommissionConstructibleFacility is legal only for an eligible player-owned Civilian Drone Base; the Core supplies its deterministic refund and validation.',
      'Human Units publish current/max Fuel and carried Military Goods, legal Move mode/cost previews, distance-based Attack costs, and same-EndTurn refill/suppression projections.',
      'Facilities publish actual population and separate zombieTargetValue; Wind is a target value 5 but has no civilian population.',
      'strategicForecast is the Core projection for resource dependencies, Guaranteed Defeat, and Checkpoint Queue Pressure.',
      'The fixed outer-ring Horde Spawn Reserve is public; Player units and Player placements cannot occupy it, while Zombies and attacks may use it under normal rules.',
      'Horde schedule, selected warning directions, and per-direction planned composition are public at the documented warning boundary; future unselected directions and hidden spawn details are not.',
      'Required facilities produce their standard output only when powered. Simple Farm is a power-free Food 5/worker redundancy and has no SetPowerSupply action.',
      'Combat and Horde movement Noise expose only public centers, unit type/class, and documented movement radius rules. Police/Riot Police are Medium, National Guard is Large, and Horde movement uses radius 8.',
      'Ground Vision uses deterministic hex-line LOS: Forest and Mountain are visible blockers and hide Hexes beyond them. Civilian Drone Base provides terrain-ignoring Aerial Vision.',
      'Public site events report infection onset, fall, requested/actual adjacent Spawn counts, remaining infected population, Noise outflow, and chain origin without hidden Zombie IDs or positions.',
      'importantSiteEvents repeats the latest 50 of those public site events in every Observation, including off-screen site coordinates and status facts.',
      'The enemy list contains only currently visible Normal, Horde, Police, Soldier, and Riot Zombies; hidden enemies are omitted.',
      'Crisis Summary and EndTurn Risk are deterministic read-only projections of public State, Legal Actions, and Forecast; they never alter State or PRNG.',
      'Human Units expose recruit/regular/veteran proficiency, survival and kill counters, Veteran promotion pending state, and shared Attack Charges.',
      'Scheduled Horde special Zombie Types are not drawn until Spawn. Warning exposes only possible Types and non-Horde Slot count; actual visible members carry public Wave flags.',
      'Riot Police is a police-family Unit for Capital/City production; Riot Zombie is a Normal AI enemy and never carries a Horde Strategic Anchor.',
      'AI Portable Session Decision responses include a public State Delta derived from adjacent public Observations; ordinary Observation remains pure and delta-free.',
    ],
    prohibited: [
      'GameState, PRNG state, future random outcomes, hidden enemy positions/counts, and unspawned Horde size are not public.',
      'Direction/policy rejected-refugee counters and the calculated extra Horde Zombies are private validation data, not public facts.',
      'Zombie Current Target, Inherited Target, Target Reason, hidden Spawn coordinates, and hidden enemy history are not public.',
      'Zombie Noise Target, exact Noise Radius, and affected hidden Zombie IDs or counts are not public.',
      'Checkpoint candidates never reveal blocker unit IDs; hidden enemies do not block a candidate or change its reason code.',
      'Constructible candidates and actions use only visible Zombies. Hidden Zombies never make an otherwise legal Build candidate illegal.',
      'Before a Horde warning starts, its randomly selected directions are not public. Spawn coordinates, non-visible individual IDs, internal targets, and hidden metrics are never public.',
      'Warning-time special Zombie Type draws are not public until the Wave is Spawned; exact Noise Radius and hidden Noise reactions remain private.',
      'LoadSnapshot, StartNewGame, SuppressInfection, arbitrary code, files, saves, localStorage, network, and Batch execution are not public actions.',
      'Do not infer or request private chain-of-thought; concise action reasons are sufficient.',
    ],
    rules: {
      proficiency: {
        values: ['recruit', 'regular', 'veteran'],
        productionProficiencyByType: publicProductionProficiency,
        recruitSurvivalTurnsRequired: getNumber(unitExperience, 'recruitSurvivalTurnsRequired', 5),
        regularAttackMultiplier: getNumber(unitExperience, 'regularAttackMultiplier', 1.25),
        regularAttackRounding: unitExperience.regularAttackRounding === 'floor' ? 'floor' : 'ceil',
        veteranZombieKillsRequired: getNumber(unitExperience, 'veteranZombieKillsRequired', 5),
        veteranAttackCharges: getNumber(unitExperience, 'veteranAttackCharges', 2),
        killCreditTypes: ['zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie'] as never,
      },
      crisis: {
        severityOrder: ['critical', 'warning', 'advisory'],
        reasonCodes: crisisCategories,
        endTurnRiskFields: [
          'readyUnits',
          'unitsWithMoveRemaining',
          'unitsWithAttackChargesRemaining',
          'uncontainedInfectedSites',
          'criticalAlerts',
          'forecastGuaranteedDefeat',
        ],
        hiddenInformationExcluded: true,
      },
      riot: {
        police: {
          recruitAttack: getNumber(riotPolice, 'recruitAttack', 10),
          hp: getNumber(riotPolice, 'hp', 75),
          movement: getNumber(riotPolice, 'movement', 10),
          range: getNumber(riotPolice, 'range', 1),
          vision: getNumber(riotPolice, 'vision', 5),
          population: getNumber(riotPolice, 'population', 10),
        },
        zombie: {
          hp: getNumber(riotZombie, 'hp', 50),
          attack: getNumber(riotZombie, 'attack', 5),
          movement: getNumber(riotZombie, 'movement', 3),
          range: getNumber(riotZombie, 'range', 1),
          vision: getNumber(riotZombie, 'vision', 5),
        },
        productionFacilities: ['capital', 'city'],
        productionCost: {
          population: 10,
          civilianGoods: getNumber(riotPolice, 'productionCivilianGoods', 25),
          militaryGoods: getNumber(riotPolice, 'productionMilitaryGoods', 25),
        },
      },
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
        policeSuppression: getNumber(policeUnit, 'recruitAttack', 4),
        nationalGuardSuppression: getNumber(nationalGuardUnit, 'recruitAttack', 8),
        nationalGuardCivilianDamageFormula: `ceil(suppressionPower * ${getNumber(nationalGuardUnit, 'suppressionCivilianDamageRate', 0.5)})`,
        zombieSpawnPopulationPerUnit: config.infection.zombieSpawnPopulationPerUnit,
        maxZombieSpawnPerResolution: config.infection.maxZombieSpawnPerResolution,
        zombieSpawnRadius: config.infection.zombieSpawnRadius,
        noiseRespawnEnabled: config.infection.noiseRespawnEnabled,
      },
      ranges: {
        police: { baseRange: getNumber(policeUnit, 'range', 1) },
        nationalGuard: { baseRange: getNumber(nationalGuardUnit, 'range', 2) },
        zombie: { baseRange: getNumber(units.zombie, 'range', 1) },
        hordeZombie: { baseRange: getNumber(units.hordeZombie, 'range', 1) },
        policeZombie: { baseRange: getNumber(units.policeZombie, 'range', 1) },
        soldierZombie: { baseRange: getNumber(units.soldierZombie, 'range', 1) },
        riotPolice: { baseRange: getNumber(riotPolice, 'range', 1) },
        riotZombie: { baseRange: getNumber(riotZombie, 'range', 1) },
      },
      terrain: {
        movementCost: cloneJson(config.terrain.movementCost),
        damageMultiplier: cloneJson(config.terrain.damageMultiplier),
        roadAndUrbanMovementCost: 1,
        defenseRounding: 'ceil',
        minimumDamage: 1,
      },
      vision: {
        unitVision: Object.fromEntries(
          Object.entries(config.units).map(([type, unit]) => [type, unit.vision]),
        ) as AgentApiInfo['rules']['vision']['unitVision'],
        capital: config.vision.capital,
        ownedFacility: config.vision.ownedFacility,
        operationalCheckpoint: config.vision.operationalCheckpoint,
        distance: 'hex',
        terrainBlocks: true,
        groundBlockingTerrain: ['forest', 'mountain'],
        firstBlockingHexVisible: true,
        zombieVisionTerrainLosBlocking: false,
        combatNoiseTerrainLosBlocking: false,
        attackLineTerrainLosBlocking: false,
        sources: ['ground: human units, capital, owned non-fallen facilities, active checkpoints', 'aerial: powered Civilian Drone Base'],
      },
      fogOfWar: {
        enemyVisibility: 'visible_only',
        mapTerrainAlwaysKnown: true,
        hiddenEnemyPositionPublic: false,
        hiddenEnemyTargetPublic: false,
        hiddenEnemySpawnCoordinatePublic: false,
        hiddenEnemyCountPublic: false,
      },
      map: {
        id: FIXED_MAP.id,
        width: FIXED_MAP.width,
        height: FIXED_MAP.height,
        coordinateSystem: 'axial-q-r',
        hordeSpawnReserve: cloneJson(FIXED_MAP.hordeSpawnReserve),
        playerOccupancyRule: 'playerOccupancyAllowed=false forbids Player Unit entry/traversal/stopping and Player placement; Zombie entry, attacks, and damage remain allowed',
      },
      horde: {
        warningLeadTurns: config.horde.warningLeadTurns,
        waves: config.horde.waves.map((wave, index) => {
          const waveRecord = wave as unknown as Record<string, unknown>;
          const composition = waveRecord.compositionPerDirection as Record<string, unknown>;
          const nonHordeSlots = getNumber(
            waveRecord,
            'nonHordeSlotCountPerDirection',
            getNumber(composition, 'zombie', 0),
          );
          const possibleNonHordeTypes = Array.isArray(waveRecord.possibleNonHordeTypes)
            ? waveRecord.possibleNonHordeTypes.filter((value): value is string => typeof value === 'string')
            : ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie'].filter((type) => Object.prototype.hasOwnProperty.call(units, type));
          return {
            index: index + 1,
            turn: wave.turn,
            directionCount: wave.directionCount,
            compositionPerDirection: cloneJson(wave.compositionPerDirection),
            nonHordeSlotCountPerDirection: nonHordeSlots,
            possibleNonHordeTypes: possibleNonHordeTypes as never,
            final: wave.final,
          };
        }),
        finalHordeTurn: config.horde.waves.find((wave) => wave.final)?.turn ?? 0,
        finalHordeTurnRule: 'Derived from the turn of the sole wave with final=true; it is not an independent Config field.',
        warningDirectionRule: 'Directions are selected independently at warning start, deduplicated, and normalized north/east/south/west.',
        warningDirectionsPublicAfter: 'warning_start',
      },
      victory: {
        requiresFinalHorde: true,
        progressFields: ['finalHordeDefeated', 'suppliedAreaZombieClear', 'suppliedAreaInfectionClear'],
        defeatPrecedesVictory: true,
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
      checkpointPositionCandidates: {
        observationField: 'checkpointPositionCandidates',
        schema: {
          actionType: 'BuildCheckpoint | RelocateCheckpoint | ActivateCheckpoint',
          branchId: 'string',
          checkpointId: 'string (RelocateCheckpoint / ActivateCheckpoint; omitted for BuildCheckpoint)',
          position: '{ q: number; r: number }',
          legal: 'boolean',
          reasonCode: 'ActionError.code | null',
        },
        ordering: 'branch_id_then_branch_road_tile_order',
        includesIllegalCandidates: true,
        reasonCodes: cloneJson(CHECKPOINT_REASON_CODES),
        fairPlay: {
          hiddenEnemiesBlock: false,
          visibleEnemiesCanBlock: true,
          blockerUnitIdsPublic: false,
          prngStatePublic: false,
          futureRandomOutcomesPublic: false,
        },
      },
      checkpoint: {
        roles: ['active', 'standby', 'dormant', 'remnant', 'ruined', 'abandoned'],
        activePerBranchLimit: 1,
        preparedPostLimit: config.checkpoint.maxPreparedPostsPerDirection,
        screeningCapacity: config.refugees.screeningCapacity,
        estimatedScreeningThroughputByPolicy: {
          passThrough: config.refugees.screeningCapacity / Math.max(1, policies.passThrough.turns),
          normal: config.refugees.screeningCapacity / Math.max(1, policies.normal.turns),
          strict: config.refugees.screeningCapacity / Math.max(1, policies.strict.turns),
        },
        queuePressureThresholds: {
          none: { min: 0, max: 0 },
          low: { min: 1, max: config.refugees.screeningCapacity },
          medium: { min: config.refugees.screeningCapacity + 1, max: config.refugees.screeningCapacity * 2 },
          high: { min: config.refugees.screeningCapacity * 2 + 1, max: null },
        },
        policyOwner: 'road_branch',
        fallbackPriority: ['capital_side_standby', 'capital_side_dormant'],
        standbyProvidesArrivalSupplyVision: false,
        dormantProvidesArrivalSupplyVision: false,
      },
      unitFuel: {
        movementByType: {
          police: config.units.police.movement,
          nationalGuard: config.units.nationalGuard.movement,
          riotPolice: getNumber(riotPolice, 'movement', 10),
        },
        maxFuelByType: {
          police: config.units.police.maxFuel,
          nationalGuard: config.units.nationalGuard.maxFuel,
          riotPolice: getNumber(riotPolice, 'maxFuel', 12),
        },
        fuelCostFormulaByType: {
          police: 'distance 0: 0; 1..5: 1; >=6: 1 + (distance - 5)',
          nationalGuard: 'distance 0: 0; 1..5: 1; >=6: 1 + 2 * (distance - 5)',
          riotPolice: 'distance 0: 0; 1..5: 1; >=6: 1 + (distance - 5)',
        },
        refuelTiming: 'after_power_before_production',
        refuelRequiresSupply: true,
        shortageAllocation: 'unit_id_ascending_round_robin',
        emergencyMovementPointsByType: {
          police: config.units.police.emergencyMovementPoints,
          nationalGuard: config.units.nationalGuard.emergencyMovementPoints,
          riotPolice: getNumber(riotPolice, 'emergencyMovementPoints', 2),
        },
        emergencyMovementTrigger: 'current_fuel_zero',
        emergencyMovementUsesEffectiveMovementCost: true,
      },
      unitMilitaryGoods: {
        maxByType: {
          police: config.units.police.maxMilitaryGoods,
          nationalGuard: config.units.nationalGuard.maxMilitaryGoods,
          riotPolice: getNumber(riotPolice, 'maxMilitaryGoods', 5),
        },
        fixedUpkeepByType: {
          police: config.units.police.fixedMilitaryGoodsUpkeepPerTurn,
          nationalGuard: config.units.nationalGuard.fixedMilitaryGoodsUpkeepPerTurn,
          riotPolice: getNumber(riotPolice, 'fixedMilitaryGoodsUpkeepPerTurn', 0),
        },
        attackCostByRange: {
          police: cloneJson(config.units.police.attackMilitaryGoodsCostByRange),
          nationalGuard: cloneJson(config.units.nationalGuard.attackMilitaryGoodsCostByRange),
          riotPolice: cloneJson(riotPolice.attackMilitaryGoodsCostByRange ?? { 1: 1 }) as never,
        },
        suppressionCostByType: {
          police: config.units.police.suppressionMilitaryGoodsCost,
          nationalGuard: config.units.nationalGuard.suppressionMilitaryGoodsCost,
          riotPolice: getNumber(riotPolice, 'suppressionMilitaryGoodsCost', 1),
        },
        shortageAttackMultiplierByType: {
          police: config.units.police.militaryGoodsShortageAttackMultiplier,
          nationalGuard: config.units.nationalGuard.militaryGoodsShortageAttackMultiplier,
          riotPolice: getNumber(riotPolice, 'militaryGoodsShortageAttackMultiplier', 0.2),
        },
        refillTiming: 'after_military_factory_production_before_suppression',
        refillRequiresSupply: true,
        shortageAllocation: 'unit_id_ascending_round_robin',
        destroyedUnitReturnsCarriedGoods: false,
      },
      constructibleFacilities: {
        types: ['simpleFarm', 'civilianDroneBase'],
        limitFormula: 'ceil(roadBranchCount / constructibleFacility.limitPerTypeDivisor)',
        buildConditions: [
          'inside_player_supply',
          'plain_base_terrain',
          'no_road_urban_horde_entrance_or_spawn_reserve',
          'no_facility_checkpoint_player_unit_or_visible_zombie',
          'per_type_limit_resources_and_action_budget',
        ],
        costs: {
          simpleFarm: config.facilities.simpleFarm.buildCivilianGoods,
          civilianDroneBase: config.facilities.civilianDroneBase.buildCivilianGoods,
        },
        stateTransitions: [
          'build_turn: building_empty_no_power_or_vision',
          'next_player_turn: operational',
          'empty_zombie_occupation: disabled',
          'human_recapture: recovering',
          'next_player_turn_after_recovery: operational_empty',
        ],
        simpleFarm: {
          workerCapacity: config.facilities.simpleFarm.workerCapacity,
          requiredPower: 0,
          foodPerWorker: config.facilities.simpleFarm.production.outputs.food ?? 0,
        },
        civilianDroneBase: {
          workerCapacity: config.facilities.civilianDroneBase.workerCapacity,
          requiredPower: config.facilities.civilianDroneBase.production.powerCapacity,
          visionPerWorker: 2,
        },
        windPowerPlant: {
          fixedPower: config.facilities.windPowerPlant.production.fixedPowerGeneration,
          vision: config.facilities.windPowerPlant.visionRadius,
          zombieTargetValue: config.facilities.windPowerPlant.zombieTargetValue,
          supplySource: false,
        },
      },
      strategicForecast: {
        observationField: 'strategicForecast',
        resources: ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricity'],
        guaranteedDefeat: ['guaranteed', 'causeResource', 'foodShortage', 'civilianGoodsShortage', 'projectedHealthyCivilians', 'defeatReason'],
        queuePressureThresholds: {
          none: 'queuePeople == 0',
          low: '0 < queuePeople <= screeningCapacity',
          medium: 'screeningCapacity < queuePeople <= screeningCapacity * 2',
          high: 'queuePeople > screeningCapacity * 2',
        },
      },
      noise: {
        classes: ['small', 'medium', 'large', 'extraLarge'],
        policeClass: (policeUnit.noiseClass as 'small' | 'medium' | 'large' | 'extraLarge' | undefined) ?? 'medium',
        nationalGuardClass: (nationalGuardUnit.noiseClass as 'small' | 'medium' | 'large' | 'extraLarge' | undefined) ?? 'large',
        riotPoliceClass: (riotPolice.noiseClass as 'small' | 'medium' | 'large' | 'extraLarge' | undefined) ?? 'medium',
        hordeMovementNoiseRadius: config.horde.movementNoiseRadius,
        distance: 'hex',
        terrainAttenuation: false,
        normalZombieAffected: true,
        hordeZombieAffected: false,
        targetPriority: ['visible_population', 'inherited_horde', 'noise', 'idle'],
      },
      production: {
        workerCapacityByFacilityType: Object.fromEntries(
          Object.entries(config.facilities).map(([type, facility]) => [type, facility.workerCapacity]),
        ) as AgentApiInfo['rules']['production']['workerCapacityByFacilityType'],
        powerPlantsGenerateCapacityPerWorker: config.facilities.powerPlant.production.powerGeneration,
        poweredFacilitiesConsumeFixedCapacityWhenOperating: true,
        fuelPerFiveElectricity: 1,
        facilityPowerUnit: 5,
        powerModes: ['required', 'none'],
        standardOutputRule: {
          requiredPowered: 'base',
          requiredUnpowered: 0,
          nonePowered: 'base',
        },
        unpoweredCityCivilianGoodsOutputIsZero: true,
        sameTurnProductionCanCoverMaintenance: true,
        sameTurnProductionCanCoverProductionInputs: false,
        sameTurnCivilianGoodsCannotDirectlyFeedMilitaryFactories: true,
        civilianProductionCanReleaseTurnStartStockFromMaintenanceReservation: true,
        powerAllocationOrder: ['capital_and_cities', 'farm_and_civilian_factory', 'input_ready_military_factory', 'refinery', 'civilian_drone_base'],
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
