import type { AgentPriorityGoal } from './types';

export interface BalancedStrategyWeights {
  goal: Record<AgentPriorityGoal, number>;
  attack: number;
  lethalAttack: number;
  contactDenial: number;
  criticalFacilityDefense: number;
  safeGuardShot: number;
  policePreservation: number;
  suppression: number;
  captureProgress: number;
  redundancy: number;
  militaryReserve: number;
  capitalBuffer: number;
  hordeDefense: number;
  economyImprovement: number;
  overcrowdingRelief: number;
  production: number;
  checkpoint: number;
  checkpointFallback: number;
  enemyForestPenalty: number;
  urbanHold: number;
  noiseRisk: number;
  recoveryWait: number;
  repeatPenalty: number;
  endTurn: number;
}

/** Data-only so later strategies can be introduced as weight differences. */
export const BALANCED_WEIGHTS: Readonly<BalancedStrategyWeights> = {
  goal: {
    avoid_defeat: 1_000,
    prevent_facility_contact: 1_100,
    rescue_critical_infection: 1_050,
    defend_horde: 800,
    suppress_infection: 700,
    restore_military_supply: 750,
    restore_economy: 600,
    reduce_overcrowding: 500,
    build_forces: 400,
    secure_facilities: 300,
    manage_checkpoint: 200,
    combat: 650,
    end_turn: 0,
  },
  attack: 180,
  lethalAttack: 90,
  contactDenial: 320,
  criticalFacilityDefense: 280,
  safeGuardShot: 180,
  policePreservation: 240,
  suppression: 220,
  captureProgress: 55,
  redundancy: 85,
  militaryReserve: 14,
  capitalBuffer: 150,
  hordeDefense: 70,
  economyImprovement: 45,
  overcrowdingRelief: 80,
  production: 75,
  checkpoint: 35,
  checkpointFallback: 55,
  enemyForestPenalty: 115,
  urbanHold: 75,
  noiseRisk: 14,
  recoveryWait: 30,
  repeatPenalty: 500,
  endTurn: 20,
};

export const BALANCED_THRESHOLDS = {
  hordeUrgentTurns: 2,
  lowHpRatio: 0.4,
  criticalCivilianBuffer: 10,
  capitalPopulationSafe: 15,
  capitalPopulationDanger: 20,
  militaryReserveTurns: 3,
  militaryProductionCostBuffer: 25,
  maxDecisionsPerTurn: 18,
  candidateTraceLimit: 5,
} as const;
