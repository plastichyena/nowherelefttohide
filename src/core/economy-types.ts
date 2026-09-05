import type { ResourceType, PowerSupplyReason } from './types';

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
  stoppedReason: 'ruined' | 'infection' | 'not_owned' | 'no_workers' | 'power_unavailable' | 'input_shortage' | null;
}
