import { hexKey } from './hex';
import { SeededRng } from './rng';
import type { HexCoord } from './types';

export const BAY_CORNERS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
export type BayCorner = typeof BAY_CORNERS[number];
// One connected, irregular 17-row estuary. Translate the reflected top-right
// copy to equalize axial distance (square reflection alone halves that distance).
const widths = [5,5,4,5,4,4,3,4,3,3,3,2,3,2,2,1,1];
const template: HexCoord[] = widths.flatMap((width, r) => {
  const center = 11 + Math.floor(r * 6 / 16);
  return Array.from({ length: width }, (_, i) => ({ q: center - Math.floor(width / 2) + i, r }));
});
export const BAY_WATER_COUNT = template.length;
export function bayCornerForSeed(seed: number): BayCorner {
  let h = 2166136261;
  for (const c of `${seed}:bay-layout-v1`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return BAY_CORNERS[new SeededRng(h >>> 0).nextInt(0, 3)]!;
}
export function bayLayout(corner: BayCorner) {
  const transform = ({q,r}: HexCoord): HexCoord => {
    const right = corner === 'topRight' || corner === 'bottomLeft';
    const p = { q: right ? 58 - q : q, r };
    return corner === 'bottomRight' || corner === 'bottomLeft' ? { q: 50 - p.q, r: 50 - p.r } : p;
  };
  const water = template.map(transform);
  const waterKeys = new Set(water.map(hexKey));
  const bridge = [13,14,15,16,17].map(q => transform({q,r:12}));
  return { corner, water, waterKeys, bridge, nuclear: transform({q:17,r:17}) };
}
