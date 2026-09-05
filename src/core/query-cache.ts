import type { GameState } from './types';

/** Only Engine-owned committed states are registered. Mutable candidates never cache. */
const committed = new WeakMap<Readonly<GameState>, Map<string, unknown>>();

export function registerCommittedState(state: Readonly<GameState>): void {
  committed.set(state, new Map());
}

export function queryValue<T>(state: Readonly<GameState>, key: string, compute: () => T): T {
  const cache = committed.get(state);
  if (!cache) return compute();
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as T;
}

export function copyQueryValue<T>(value: T): T {
  return structuredClone(value);
}

/** Fresh projections are already detached; only shared cached results need a copy. */
export function detachedQueryValue<T>(state: Readonly<GameState>, key: string, compute: () => T): T {
  if (!committed.has(state)) return compute();
  return copyQueryValue(queryValue(state, key, compute));
}

/** A synchronous pure projection may also share work on its detached snapshot. */
export function withReadOnlyQueryScope<T>(state: Readonly<GameState>, project: () => T): T {
  if (committed.has(state)) return project();
  committed.set(state, new Map());
  try { return project(); } finally { committed.delete(state); }
}
