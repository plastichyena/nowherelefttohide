import { hexKey, hexNeighbors } from './hex';
import { terrainAdjustedDamage } from './terrain';
import { getPlayerVisibleTileKeys } from './visibility';
import type { GameState, HexCoord, UnitState } from './types';

export interface GasAttackPreview {
  trigger: 'lethal_direct_attack' | 'nonlethal_no_explosion';
  scope: 'currently_public_entities';
  limitations: string[];
  explosions: Array<{ sourceId: string; position: HexCoord; affectedHexes: HexCoord[] }>;
  units: Array<{ unitId: string; side: 'player' | 'enemy'; hpBefore: number; damage: number; hpAfter: number; lethal: boolean }>;
  sites: Array<{ siteId: string; kind: 'facility' | 'checkpoint'; healthyBefore: number; infected: number; healthyAfter: number; reachesZero: boolean; stopsProduction: boolean; falls: boolean }>;
}
/** No hidden entity is read to select, qualify or quantify a public preview. */
export function gasAttackPreview(state: Readonly<GameState>, target: Readonly<UnitState>, directDamage: number): GasAttackPreview | null {
  if (target.type !== 'gasZombie') return null;
  const result: GasAttackPreview = { trigger: directDamage >= target.hp ? 'lethal_direct_attack' : 'nonlethal_no_explosion', scope: 'currently_public_entities',
    limitations: ['unobserved_hexes_not_predicted', 'future_enemy_phase_excluded', 'reanimation_and_site_spawn_consequences_not_predicted'], explosions: [], units: [], sites: [] };
  if (result.trigger === 'nonlethal_no_explosion') return result;
  const visible = getPlayerVisibleTileKeys(state);
  const units = state.units.filter(u => u.id !== target.id && (u.isPlayerUnit || visible.has(hexKey(u.position)))).map(u => ({ unit: u, before: u.hp, hp: u.hp }));
  const sites = [
    ...state.facilities.map(f => ({ id: f.id, kind: 'facility' as const, position: f.position, healthy: f.workers, existingInfected: f.infected })),
    ...state.checkpoints.map(c => ({ id: c.id, kind: 'checkpoint' as const, position: c.position, healthy: c.waiting + c.screening + c.approved, existingInfected: c.infected })),
  ].map(s => ({ ...s, before: s.healthy }));
  const queue = [{ id: target.id, position: target.position }];
  const queued = new Set([target.id]);
  while (queue.length) {
    const source = queue.shift()!;
    const affectedHexes = hexNeighbors(source.position).filter(p => p.q >= 0 && p.r >= 0 && p.q < state.map.width && p.r < state.map.height);
    const keys = new Set(affectedHexes.map(hexKey));
    result.explosions.push({ sourceId: source.id, position: { ...source.position }, affectedHexes });
    const hit = units.filter(u => u.hp > 0 && keys.has(hexKey(u.unit.position))).sort((a, b) => a.unit.id.localeCompare(b.unit.id));
    for (const u of hit) u.hp -= Math.min(u.hp, terrainAdjustedDamage(state, u.unit, state.config.units.gasZombie.explosionDamage).finalDamage);
    for (const s of sites.filter(s => keys.has(hexKey(s.position)))) s.healthy -= Math.min(s.healthy, state.config.units.gasZombie.explosionInfection);
    for (const u of hit) if (u.hp === 0 && u.unit.type === 'gasZombie' && !queued.has(u.unit.id)) { queue.push({ id: u.unit.id, position: u.unit.position }); queued.add(u.unit.id); }
  }
  result.units = units.filter(u => u.hp !== u.before).map(u => ({ unitId: u.unit.id, side: u.unit.isPlayerUnit ? 'player' : 'enemy', hpBefore: u.before, damage: u.before - u.hp, hpAfter: u.hp, lethal: u.hp === 0 }));
  result.sites = sites.filter(s => s.before !== s.healthy).map(s => ({ siteId: s.id, kind: s.kind, healthyBefore: s.before, infected: s.before - s.healthy, healthyAfter: s.healthy, reachesZero: s.healthy === 0, stopsProduction: s.kind === 'facility', falls: s.healthy === 0 && s.existingInfected + s.before - s.healthy > 0 }));
  return result;
}
