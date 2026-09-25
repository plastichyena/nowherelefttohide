import { describe, expect, it } from 'vitest';
import { boundedCanvasBackingSize, liveAiSessionOptions, liveAiResultText } from './live-ai';

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

describe('v1.6 live viewer session identity', () => {
  it('bounds the rendered receipt without changing canonical observations or records', () => {
    const response = { ok: true, before: { map: 'before-map'.repeat(100_000) }, after: { turn: 2, gameOver: false, resources: { food: 400 }, map: 'after-map'.repeat(100_000) }, record: { accepted: true, events: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: 'event'.repeat(50) })) } };
    const before = JSON.stringify(response);
    const rendered = liveAiResultText(response);
    expect(rendered.length).toBeLessThan(17_000);
    expect(rendered).not.toContain('before-map');
    expect(rendered).not.toContain('after-map');
    expect(rendered).toContain('canonical Artifact is complete');
    expect(JSON.stringify(response)).toBe(before);
  });
  it('forwards the Pages build id and current comment locale to the canonical session', () => {
    expect(liveAiSessionOptions({ buildId: 'pages-commit' }, 'ja')).toEqual({
      buildId: 'pages-commit',
      preferredCommentLocale: 'ja',
    });
  });

  it('does not invent a build id when an embedding host omits it', () => {
    expect(liveAiSessionOptions({}, 'en')).toEqual({ preferredCommentLocale: 'en' });
  });
});
