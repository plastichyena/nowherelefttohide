import { expect, it } from 'vitest';
import type { JsonValue } from '../core/types';
import { createJsonTreeHasher, sha256Json } from './hash';
import { applyLosslessJsonDiff, createLosslessJsonDiff } from './public-diff';

it('preserves every historical canonical hash while sharing only unchanged JSON subtrees', () => {
  const snapshots: JsonValue[] = [
    { '10': 'ten', '2': 'two', '01': 'one', '日本語': '部隊', a: [{ hp: 75 }, { hp: 60 }], stable: { empty: [], n: null } },
    { '10': 'ten', '2': 'two', '01': 'one', '日本語': '部隊', a: [{ hp: 50 }, { hp: 60 }], stable: { empty: [], n: null } },
    { '10': 'ten', '2': 'two', '01': 'one', a: [{ hp: 60 }], stable: { empty: [], n: null } },
    { '10': 'ten', '2': 'two', '01': 'one', a: [], stable: { empty: [], n: null } },
  ];
  for (const budget of [0, 64, 64 * 1024 * 1024]) {
    const hash = createJsonTreeHasher(budget);
    let document: JsonValue = snapshots[0]!;
    const prior: JsonValue[] = [document];
    expect(hash(document)).toBe(sha256Json(document));
    for (let i = 1; i < snapshots.length; i++) {
      document = applyLosslessJsonDiff(document, createLosslessJsonDiff(document, snapshots[i]!), true);
      expect(document).toEqual(snapshots[i]);
      expect(hash(document)).toBe(sha256Json(snapshots[i]));
      prior.push(document);
    }
    expect(prior).toEqual(snapshots);
  }
});

it('still rejects invalid paths and never mutates an earlier public snapshot', () => {
  const before = { a: [1, 2], stable: { hp: 75 } };
  const next = applyLosslessJsonDiff(before, [{ op: 'splice', path: ['a'], index: 0, deleteCount: 1, values: [3] }], true);
  expect(next).toEqual({ a: [3, 2], stable: { hp: 75 } });
  expect(before).toEqual({ a: [1, 2], stable: { hp: 75 } });
  expect(() => applyLosslessJsonDiff(before, [{ op: 'set', path: ['__proto__', 'x'], value: 1 }], true)).toThrow('Forbidden');
});
