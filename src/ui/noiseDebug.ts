import { hexDistance } from '../core/hex';
import type { GameState, HexCoord } from '../core/types';
import type { Locale } from './i18n';
import './noiseDebug.css';

export interface NoiseDebugViewModel {
  center: HexCoord;
  radius: number;
  radiusHexes: HexCoord[];
  affectedNormalZombieIds: string[];
  noiseTargets: Array<{ zombieId: string; target: HexCoord | null }>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function deriveDevelopmentNoiseDebug(
  state: Pick<Readonly<GameState>, 'events' | 'config' | 'map' | 'units' | 'pendingNoisePulses'>,
): NoiseDebugViewModel | null {
  let emittedIndex = -1;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    if (state.events[index]?.type === 'noise_emitted') {
      emittedIndex = index;
      break;
    }
  }
  if (emittedIndex < 0) return null;
  const emitted = state.events[emittedIndex]!;
  const pending = state.pendingNoisePulses.at(-1);
  const q = emitted.payload.q ?? pending?.center.q;
  const r = emitted.payload.r ?? pending?.center.r;
  const sourceUnitType = emitted.payload.sourceUnitType;
  if (
    typeof q !== 'number' ||
    typeof r !== 'number' ||
    !['police', 'nationalGuard', 'riotPolice', 'hordeZombie'].includes(String(sourceUnitType))
  ) return null;
  const center = { q, r };
  const radius = sourceUnitType === 'hordeZombie'
    ? state.config.horde.movementNoiseRadius
    : state.config.units[sourceUnitType as 'police' | 'nationalGuard' | 'riotPolice'].noiseRadius;
  const targeted = state.events.slice(emittedIndex + 1).find((event) =>
    event.type === 'noise_targeted' &&
    event.payload.sourceUnitId === emitted.payload.sourceUnitId &&
    event.payload.q === q &&
    event.payload.r === r,
  );
  const affectedNormalZombieIds = targeted && Array.isArray(targeted.payload.affectedZombieIds)
    ? targeted.payload.affectedZombieIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    center,
    radius,
    radiusHexes: state.map.tiles
      .filter((tile) => hexDistance(center, tile) <= radius)
      .map((tile) => ({ q: tile.q, r: tile.r })),
    affectedNormalZombieIds,
    noiseTargets: state.units
      .filter((unit) => ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie'].includes(unit.type))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((unit) => ({ zombieId: unit.id, target: unit.noiseTarget ? { ...unit.noiseTarget } : null })),
  };
}

export function renderNoiseDebugOverlay(debug: NoiseDebugViewModel | null, locale: Locale): string {
  if (!debug) return '';
  const labels = locale === 'ja'
    ? {
        title: 'Noise診断（開発用）', center: 'Noise Center', radius: '正確なRadius',
        radiusHexes: 'Radius内Hex', affected: '反応したNormal Zombie', targets: 'Internal Noise Target', none: 'なし',
      }
    : {
        title: 'Noise diagnostics (development)', center: 'Noise Center', radius: 'Exact Radius',
        radiusHexes: 'Hexes in Radius', affected: 'Affected Normal Zombies', targets: 'Internal Noise Target', none: 'None',
      };
  const hexes = debug.radiusHexes.map((hex) => `${hex.q},${hex.r}`).join(' · ') || labels.none;
  const targets = debug.noiseTargets
    .map((entry) => `${entry.zombieId} → ${entry.target ? `${entry.target.q},${entry.target.r}` : labels.none}`)
    .join(' · ') || labels.none;
  return `<aside class="noise-debug-overlay" data-noise-debug-overlay="true" aria-label="${escapeHtml(labels.title)}"><strong>${escapeHtml(labels.title)}</strong><dl><div><dt>${escapeHtml(labels.center)}</dt><dd>${debug.center.q},${debug.center.r}</dd></div><div><dt>${escapeHtml(labels.radius)}</dt><dd>${debug.radius}</dd></div><div><dt>${escapeHtml(labels.radiusHexes)}</dt><dd>${escapeHtml(hexes)}</dd></div><div><dt>${escapeHtml(labels.affected)}</dt><dd>${escapeHtml(debug.affectedNormalZombieIds.join(' · ') || labels.none)}</dd></div><div><dt>${escapeHtml(labels.targets)}</dt><dd>${escapeHtml(targets)}</dd></div></dl></aside>`;
}

export function renderDevelopmentNoiseDebug(
  state: Pick<Readonly<GameState>, 'events' | 'config' | 'map' | 'units' | 'pendingNoisePulses'>,
  locale: Locale,
): string {
  return renderNoiseDebugOverlay(deriveDevelopmentNoiseDebug(state), locale);
}
