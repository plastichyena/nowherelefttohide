import { createHash } from 'node:crypto';

export function legacyDigest(input: unknown): string {
  const state = structuredClone(input) as any;
  delete state.gameVersion;
  delete state.mapDescriptor;
  delete state.initialEnemyAttempt;
  for (const key of ['version', 'mapMode', 'mapSeed', 'gameplaySeed']) delete state.config[key];
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
}

// Captured from f79eae9 before the implementation changed. Never overwrite the
// baseline using the current engine: that would stop testing compatibility.
