import { describe, expect, it } from 'vitest';
import {
  hexDistance,
  hexDirectionBetween,
  hexLine,
  hexNeighbors,
  hexRange,
  hexRing,
  hexKey,
  parseHexKey,
  hexToPixel,
  pixelToHex,
} from './hex';

describe('hex utilities', () => {
  it('uses stable axial keys and inverse parsing', () => {
    const position = { q: -3, r: 8 };
    expect(parseHexKey(hexKey(position))).toEqual(position);
  });

  it('returns six adjacent coordinates and correct distances', () => {
    const origin = { q: 4, r: 4 };
    const neighbors = hexNeighbors(origin);
    expect(neighbors).toHaveLength(6);
    expect(new Set(neighbors.map(hexKey)).size).toBe(6);
    expect(neighbors.every((neighbor) => hexDistance(origin, neighbor) === 1)).toBe(true);
    expect(hexDistance(origin, { q: 6, r: 1 })).toBe(3);
    expect(hexDirectionBetween(origin, neighbors[0]!)).toBe('east');
    expect(hexDirectionBetween(origin, { q: 6, r: 6 })).toBeNull();
  });

  it('builds range/ring sizes and endpoint-inclusive lines', () => {
    expect(hexRange({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(hexRange({ q: 0, r: 0 }, 3)).toHaveLength(37);
    expect(hexRing({ q: 0, r: 0 }, 2)).toHaveLength(12);
    const line = hexLine({ q: 0, r: 0 }, { q: 3, r: -2 });
    expect(line).toHaveLength(4);
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line.at(-1)).toEqual({ q: 3, r: -2 });
  });

  it('round-trips pointy-top pixel coordinates', () => {
    const position = { q: 5, r: 8 };
    expect(pixelToHex(hexToPixel(position, 24), 24)).toEqual(position);
  });
});
