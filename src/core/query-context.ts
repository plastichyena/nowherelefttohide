import { copyQueryValue } from './query-cache';

/** Public methods return detached data. Providers close over exactly one committed revision. */
export function createQueryContext<T extends Record<string, (...args: any[]) => any>>(revision: number, providers: T, isCurrent: () => boolean): T & { readonly revision: number } {
  const entries = Object.entries(providers).map(([name, query]) => [name, (...args: unknown[]) => {
    if (!isCurrent()) throw new Error('Query revision has expired');
    return copyQueryValue(query(...args));
  }]);
  return Object.freeze(Object.assign(Object.fromEntries(entries), { revision })) as T & { readonly revision: number };
}
