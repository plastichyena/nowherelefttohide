import { hexDistance, hexKey } from './hex';
import type { GameState, HexCoord, UnitState } from './types';

function addRadius(state: Readonly<GameState>, visible: Set<string>, origin: HexCoord, radius: number): void {
  for (const tile of state.map.tiles) {
    if (hexDistance(origin, tile) <= radius) visible.add(tile.key);
  }
}

/** Single source of truth for Human UI, Agent Observation and legal actions. */
export function getPlayerVisibleTileKeys(state: Readonly<GameState>): Set<string> {
  const visible = new Set<string>();
  for (const unit of state.units) {
    if (unit.isPlayerUnit) addRadius(state, visible, unit.position, unit.vision);
  }
  for (const facility of state.facilities) {
    if (facility.owner !== 'player' || facility.status === 'ruined') continue;
    addRadius(
      state,
      visible,
      facility.position,
      facility.type === 'capital' ? state.config.checkpoint.initialSupplyRadius : state.config.vision.ownedFacility,
    );
  }
  for (const checkpoint of state.checkpoints) {
    if (checkpoint.status === 'operational') {
      addRadius(state, visible, checkpoint.position, state.config.vision.operationalCheckpoint);
    }
  }
  return visible;
}

export function isVisibleToPlayer(state: Readonly<GameState>, position: HexCoord): boolean {
  return getPlayerVisibleTileKeys(state).has(hexKey(position));
}

export function getVisibleEnemyUnits(state: Readonly<GameState>): UnitState[] {
  const visible = getPlayerVisibleTileKeys(state);
  return state.units
    .filter((unit) => !unit.isPlayerUnit && visible.has(hexKey(unit.position)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function canUnitSee(observer: Pick<UnitState, 'position' | 'vision'>, target: HexCoord): boolean {
  return hexDistance(observer.position, target) <= observer.vision;
}
