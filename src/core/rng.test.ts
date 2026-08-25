import { describe, expect, it } from 'vitest';
import { SeededRng } from './rng';

describe('SeededRng', () => {
  it('reproduces the same stream for the same seed', () => {
    const first = new SeededRng(20260825);
    const second = new SeededRng(20260825);
    const firstStream = Array.from({ length: 12 }, () => first.nextUint32());
    const secondStream = Array.from({ length: 12 }, () => second.nextUint32());
    expect(firstStream).toEqual(secondStream);
    expect(new SeededRng(20260826).nextUint32()).not.toBe(firstStream[0]);
  });

  it('continues exactly after a JSON-compatible snapshot', () => {
    const original = new SeededRng(17);
    original.nextInt(0, 100);
    const snapshot = JSON.parse(JSON.stringify(original.snapshot()));
    const restored = SeededRng.fromState(snapshot);
    expect(Array.from({ length: 8 }, () => original.nextFloat())).toEqual(
      Array.from({ length: 8 }, () => restored.nextFloat()),
    );
  });

  it('keeps inclusive integer results in bounds and can pick/shuffle', () => {
    const rng = new SeededRng(1);
    for (let index = 0; index < 100; index += 1) {
      expect(rng.nextInt(3, 5)).toBeGreaterThanOrEqual(3);
      expect(rng.nextInt(3, 5)).toBeLessThanOrEqual(5);
    }
    expect(new SeededRng(4).pick(['a'])).toBe('a');
    const source = [1, 2, 3, 4];
    const shuffled = new SeededRng(4).shuffle(source);
    expect(source).toEqual([1, 2, 3, 4]);
    expect([...shuffled].sort()).toEqual(source);
  });

  it('normalizes zero seeds without entering a zero lock-up state', () => {
    const rng = new SeededRng(0);
    expect(rng.nextUint32()).not.toBe(0);
    expect(rng.snapshot().seed).toBe(0);
  });
});
