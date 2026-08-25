import type { HexCoord, HexDirection, HexKey } from './types';

export const HEX_DIRECTIONS: Readonly<Record<HexDirection, HexCoord>> = {
  east: { q: 1, r: 0 },
  northEast: { q: 1, r: -1 },
  northWest: { q: 0, r: -1 },
  west: { q: -1, r: 0 },
  southWest: { q: -1, r: 1 },
  southEast: { q: 0, r: 1 },
};

export const HEX_DIRECTION_ORDER: readonly HexDirection[] = [
  'east',
  'northEast',
  'northWest',
  'west',
  'southWest',
  'southEast',
];

export function hexKey({ q, r }: HexCoord): HexKey {
  return `${q},${r}`;
}

export function parseHexKey(key: HexKey): HexCoord {
  const [qText, rText, ...extra] = key.split(',');
  if (extra.length > 0 || qText === undefined || rText === undefined) {
    throw new Error(`Invalid hex key: ${key}`);
  }
  const q = Number(qText);
  const r = Number(rText);
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new Error(`Invalid hex key: ${key}`);
  }
  return { q, r };
}

export function hexEquals(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSubtract(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexScale(a: HexCoord, factor: number): HexCoord {
  return { q: a.q * factor, r: a.r * factor };
}

export function hexNeighbor(origin: HexCoord, direction: HexDirection): HexCoord {
  return hexAdd(origin, HEX_DIRECTIONS[direction]);
}

export function hexNeighbors(origin: HexCoord): HexCoord[] {
  return HEX_DIRECTION_ORDER.map((direction) => hexNeighbor(origin, direction));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const delta = hexSubtract(a, b);
  return (Math.abs(delta.q) + Math.abs(delta.q + delta.r) + Math.abs(delta.r)) / 2;
}

export function hexWithinBounds(coord: HexCoord, width: number, height: number): boolean {
  return (
    Number.isInteger(coord.q) &&
    Number.isInteger(coord.r) &&
    coord.q >= 0 &&
    coord.q < width &&
    coord.r >= 0 &&
    coord.r < height
  );
}

export function hexRange(center: HexCoord, radius: number): HexCoord[] {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error('Hex range radius must be a non-negative integer');
  }
  const result: HexCoord[] = [];
  for (let q = center.q - radius; q <= center.q + radius; q += 1) {
    const rMin = center.r - radius;
    const rMax = center.r + radius;
    for (let r = rMin; r <= rMax; r += 1) {
      const candidate = { q, r };
      if (hexDistance(center, candidate) <= radius) {
        result.push(candidate);
      }
    }
  }
  return result;
}

export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error('Hex ring radius must be a non-negative integer');
  }
  if (radius === 0) {
    return [{ ...center }];
  }

  // Start at the south-west corner and walk clockwise around the ring.
  let cursor = hexAdd(center, hexScale(HEX_DIRECTIONS.southWest, radius));
  const result: HexCoord[] = [];
  const walkOrder: HexDirection[] = [
    'east',
    'northEast',
    'northWest',
    'west',
    'southWest',
    'southEast',
  ];
  for (const direction of walkOrder) {
    for (let step = 0; step < radius; step += 1) {
      result.push({ ...cursor });
      cursor = hexNeighbor(cursor, direction);
    }
  }
  return result;
}

export function hexSpiral(center: HexCoord, radius: number): HexCoord[] {
  return Array.from({ length: radius + 1 }, (_, index) => hexRing(center, index)).flat();
}

function cubeRound(q: number, r: number): HexCoord {
  const x = q;
  const z = r;
  const y = -x - z;
  let roundedX = Math.round(x);
  let roundedY = Math.round(y);
  let roundedZ = Math.round(z);

  const xDifference = Math.abs(roundedX - x);
  const yDifference = Math.abs(roundedY - y);
  const zDifference = Math.abs(roundedZ - z);
  if (xDifference > yDifference && xDifference > zDifference) {
    roundedX = -roundedY - roundedZ;
  } else if (yDifference > zDifference) {
    roundedY = -roundedX - roundedZ;
  } else {
    roundedZ = -roundedX - roundedY;
  }
  return { q: roundedX, r: roundedZ };
}

/** Return the shortest grid line, including both endpoints. */
export function hexLine(start: HexCoord, end: HexCoord): HexCoord[] {
  const distance = hexDistance(start, end);
  if (distance === 0) {
    return [{ ...start }];
  }
  const result: HexCoord[] = [];
  for (let step = 0; step <= distance; step += 1) {
    const amount = step / distance;
    result.push(
      cubeRound(
        start.q + (end.q - start.q) * amount,
        start.r + (end.r - start.r) * amount,
      ),
    );
  }
  return result;
}

export function hexDirectionBetween(from: HexCoord, to: HexCoord): HexDirection | null {
  const delta = hexSubtract(to, from);
  for (const direction of HEX_DIRECTION_ORDER) {
    if (hexEquals(delta, HEX_DIRECTIONS[direction])) {
      return direction;
    }
  }
  return null;
}

export interface HexPixel {
  x: number;
  y: number;
}

/** Pointy-top axial projection used by the optional Phaser adapter. */
export function hexToPixel(coord: HexCoord, size: number): HexPixel {
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r,
  };
}

/** Inverse of hexToPixel, rounded to the nearest axial coordinate. */
export function pixelToHex(pixel: HexPixel, size: number): HexCoord {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Hex size must be greater than zero');
  }
  const r = pixel.y / (size * 1.5);
  const q = pixel.x / (size * Math.sqrt(3)) - r / 2;
  return cubeRound(q, r);
}

// Short aliases keep call sites readable in pathfinding and tests.
export const keyOf = hexKey;
export const neighborsOf = hexNeighbors;
export const distanceBetween = hexDistance;
export const isWithinBounds = hexWithinBounds;
