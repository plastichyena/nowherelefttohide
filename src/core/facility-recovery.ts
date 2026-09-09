import type { FacilityState, GameState } from './types';
import { hexKey } from './hex';

/** Shared by the Engine and public recovery explanation. Never mutates state. */
export function facilityRecaptureConditions(state: Readonly<GameState>, facility: FacilityState) {
  const occupants = state.units.filter(unit => unit.hp > 0 && hexKey(unit.position) === hexKey(facility.position));
  const human = occupants.find(unit => unit.isPlayerUnit) ?? null;
  const recoverable = !state.gameOver && !facility.constructible && facility.type !== 'windPowerPlant';
  const missing: string[] = [];
  if (facility.infected > 0) missing.push('suppress_infection');
  if (occupants.some(unit => !unit.isPlayerUnit)) missing.push('clear_visible_enemy');
  if (!human) missing.push('station_human_unit');
  return { recoverable, human, missing, ready: recoverable && facility.status === 'ruined' && missing.length === 0 };
}
