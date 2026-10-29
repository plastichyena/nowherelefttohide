import { expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { calculateTerminalScore, type ScoredTerminal } from '../core/terminal-score';
import { renderTerminalScore } from './terminalScore';

it('renders exact signed frozen numbers, explanations and comparison conditions in both languages', () => {
  const state = createInitialState(42, createDefaultConfig({ mapMode: 'fixed' }));
  const won = calculateTerminalScore(state, 'won') as ScoredTerminal;
  const lost = calculateTerminalScore(state, 'lost') as ScoredTerminal;
  const before = structuredClone(won);
  for (const locale of ['ja', 'en'] as const) {
    const win = renderTerminalScore(won, locale), loss = renderTerminalScore(lost, locale);
    expect(win).toContain('+17951'); expect(loss).toContain('-1033001');
    expect(loss).toContain('-1050951'); expect(win).toContain('45/45'); expect(win).toContain('155 × 100 = 15500');
    expect(win).toContain('8/28 × 300 = 2400'); expect(win).toContain('terminal-assets-v1');
    expect(win).toContain(won.comparison.configHash);
    expect(win).toContain(locale === 'ja' ? 'スコアや順位への影響なし' : 'no score or ranking effect');
    expect(win).toContain(locale === 'ja' ? '感染者を含む' : 'includes infected');
    expect(win).toContain(locale === 'ja' ? '部隊数U自体は加点しません' : 'Unit count U earns no points');
  }
  expect(won).toEqual(before);
  const huge = structuredClone(won); huge.points.total = '123456789012345678901234567890';
  expect(renderTerminalScore(huge, 'ja')).toContain('+123456789012345678901234567890');
});

it('distinguishes missing, legacy unmeasured and unsupported results without a fake zero', () => {
  const state = createInitialState(42, createDefaultConfig({ mapMode: 'fixed' }));
  const comparison = state.scoreContext.comparison;
  for (const locale of ['ja', 'en'] as const) {
    expect(renderTerminalScore(null, locale)).toContain('data-terminal-score="invalid"');
    const legacy = renderTerminalScore({ status: 'unscored', version: 'terminal-assets-v1', reason: 'legacy_v1.7.1', comparison }, locale);
    const unsupported = renderTerminalScore({ status: 'unscored', version: 'terminal-assets-v1', reason: 'population_arithmetic_unsafe', comparison }, locale);
    expect(legacy).toContain(locale === 'ja' ? '未計測' : 'unmeasured');
    expect(unsupported).toContain(locale === 'ja' ? '採点未対応' : 'unsupported');
    expect(legacy).not.toContain('+0'); expect(unsupported).not.toContain('+0');
  }
});
