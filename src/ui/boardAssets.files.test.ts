import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BOARD_ASSET_PATHS } from './boardAssets';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BOARD_ROOT = join(process.cwd(), 'public', 'assets', 'board');

function readPng(relativePath: string): Buffer {
  return readFileSync(join(BOARD_ROOT, relativePath));
}

function decodeRgba(bytes: Buffer): Buffer {
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 256 * 4;
  expect(raw).toHaveLength((stride + 1) * 256);
  const rgba = Buffer.alloc(stride * 256);
  for (let y = 0; y < 256; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4]! : 0;
      const above = previous?.[x] ?? 0;
      const upperLeft = x >= 4 ? previous?.[x - 4] ?? 0 : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      row[x] = (source[x]! + predictor) & 0xff;
    }
  }
  return rgba;
}

describe('board runtime PNG files', () => {
  it('provides every Registry path as a decodable-shape 256px PNG', () => {
    for (const path of BOARD_ASSET_PATHS) {
      const bytes = readPng(path);
      expect(bytes.subarray(0, 8), path).toEqual(PNG_SIGNATURE);
      expect(bytes.subarray(12, 16).toString('ascii'), path).toBe('IHDR');
      expect(bytes.readUInt32BE(16), path).toBe(256);
      expect(bytes.readUInt32BE(20), path).toBe(256);
      expect(bytes.readUInt8(24), path).toBe(8);
      expect(bytes.readUInt8(25), path).toBe(6); // RGBA
      expect(bytes.subarray(-8, -4).toString('ascii'), path).toBe('IEND');
      expect(decodeRgba(bytes), path).toHaveLength(256 * 256 * 4);
    }
  });

  it('keeps transparent sprites and overlays, omits water, and stays below 3 MiB', () => {
    const paths = [...BOARD_ASSET_PATHS];
    expect(paths).toHaveLength(new Set(paths).size);
    expect(paths.some((path) => /water/iu.test(path))).toBe(false);
    expect(paths.filter((path) => path.startsWith('units/'))).toHaveLength(6);
    expect(paths).toEqual(expect.arrayContaining([
      'units/unit_police.png',
      'units/unit_national_guard.png',
      'units/unit_police_zombie.png',
      'units/unit_soldier_zombie.png',
    ]));
    expect(paths.filter((path) => path.startsWith('facilities/'))).toHaveLength(11);
    for (const path of paths.filter((entry) => entry.startsWith('units/') || entry.startsWith('facilities/') || entry.startsWith('overlays/'))) {
      const rgba = decodeRgba(readPng(path));
      const alpha = Array.from({ length: 256 * 256 }, (_, index) => rgba[index * 4 + 3]!);
      expect(Math.min(...alpha), path).toBeLessThan(255);
      expect(Math.max(...alpha), path).toBeGreaterThan(0);
      if (path.startsWith('units/') || path.startsWith('facilities/')) {
        expect(Math.max(...alpha), path).toBe(255);
      }
    }
    const totalBytes = paths.reduce((total, path) => total + statSync(join(BOARD_ROOT, path)).size, 0);
    expect(totalBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});
