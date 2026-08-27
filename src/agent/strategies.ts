import type { AgentPriorityGoal } from './types';

export interface BalancedStrategyWeights {
  goal: Record<AgentPriorityGoal, number>;
  attack: number;
  lethalAttack: number;
  suppression: number;
  captureProgress: number;
  hordeDefense: number;
  economyImprovement: number;
  overcrowdingRelief: number;
  production: number;
  checkpoint: number;
  recoveryWait: number;
  repeatPenalty: number;
  endTurn: number;
}

/** Data-only so later strategies can be introduced as weight differences. */
export const BALANCED_WEIGHTS: Readonly<BalancedStrategyWeights> = {
  goal: {
    avoid_defeat: 1_000,
    defend_horde: 800,
    suppress_infection: 700,
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
  suppression: 220,
  captureProgress: 55,
  hordeDefense: 70,
  economyImprovement: 45,
  overcrowdingRelief: 80,
  production: 75,
  checkpoint: 35,
  recoveryWait: 30,
  repeatPenalty: 500,
  endTurn: 20,
};

export const BALANCED_THRESHOLDS = {
  hordeUrgentTurns: 2,
  lowHpRatio: 0.4,
  criticalCivilianBuffer: 10,
  maxDecisionsPerTurn: 18,
  candidateTraceLimit: 5,
} as const;

