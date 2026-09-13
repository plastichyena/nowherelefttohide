import { describe, expect, it } from 'vitest';
import { boundedCanvasBackingSize } from './live-ai';

describe('v1.6 live viewer canvas limits', () => {
  it.each([[360, 640], [640, 360]])('keeps %sx%s DPR 2 within the 2048² budget', (width, height) => {
    const size = boundedCanvasBackingSize(width, height, 2);
    expect(size.width * size.height).toBeLessThanOrEqual(2048 * 2048);
    expect(size.scale).toBeLessThanOrEqual(2);
  });

  it('reduces internal resolution for a large high-DPR viewport', () => {
    const size = boundedCanvasBackingSize(2560, 1440, 3);
    expect(size.width * size.height).toBeLessThanOrEqual(2048 * 2048);
    expect(size.scale).toBeLessThan(1.1);
  });
});
