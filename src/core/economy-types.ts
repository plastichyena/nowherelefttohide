import type { ResourceType, PowerSupplyReason } from './types';

export type ArmyBaseMilitaryGoodsRefillReason =
  | 'not_owned'
  | 'infection'
  | 'not_operational'
  | 'out_of_supply'
  | 'full'
  | 'national_stock_shortage'
  | 'supplied';

/**
 * The Army Base's dedicated interception stock is deliberately separate from
 * the national stock.  This projection is derived after all Human Unit
 * military-goods refills, which preserves their established priority.
 */
export interface ArmyBaseMilitaryGoodsProjection {
  capacity: number;
  current: number;
  inSupply: boolean;
  refillEligible: boolean;
  projectedRefillAmount: number;
  projectedAfterRefill: number;
  refillReason: ArmyBaseMilitaryGoodsRefillReason;
  recruitmentPower: {
    hasReservation: boolean;
    requested: boolean;
    supplied: boolean;
    reason: PowerSupplyReason;
  };
}

export interface FacilityProductionProjection {
  facilityId: string;
  operatingWorkers: number;
  inputs: Partial<Record<ResourceType, number>>;
  outputs: Partial<Record<ResourceType, number>>;
  powerGeneration: number;
  powerMode: 'required' | 'none';
  requiredPowerCapacity: number;
  powerSupplyEnabled: boolean;
  projectedPowerRequested: boolean;
  projectedPowerSupplied: boolean;
  projectedPowerReason: PowerSupplyReason;
  lastPowerSupplied: boolean | null;
  productionMultiplier: number;
  baseOutputs: Partial<Record<ResourceType, number>>;
  stoppedReason: 'building' | 'recovering' | 'disabled' | 'ruined' | 'infection' | 'not_owned' | 'no_workers' | 'power_unavailable' | 'input_shortage' | null;
  /** Present only for Army Base facilities; it does not consume production inputs. */
  armyBaseMilitaryGoods: ArmyBaseMilitaryGoodsProjection | null;
}
