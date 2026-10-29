import type { TerminalScore } from '../core/terminal-score';
import type { Locale } from './i18n';

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const signed = (value: string) => value.startsWith('-') ? value : `+${value}`;

/** Frozen result only: no live State, queries, or recalculation. */
export function renderTerminalScore(score: TerminalScore | null, locale: Locale): string {
  const ja = locale === 'ja';
  if (!score) return `<p data-terminal-score="invalid">${ja ? 'スコア不正: 確定結果がありません' : 'Invalid score: missing terminal snapshot'}</p>`;
  if (score.status === 'unscored') return `<section data-terminal-score="unscored"><h3>${ja ? '終局スコア' : 'Terminal score'}</h3><p>${score.reason === 'legacy_v1.7.1'
    ? ja ? '旧版 v1.7.1・未計測（遡及採点なし）' : 'Legacy v1.7.1 · unmeasured (no retrospective scoring)'
    : ja ? '採点未対応: 人口上限が既存ゲームの安全な整数範囲を超えます' : 'Scoring unsupported: population bounds exceed the game’s safe integer range'}</p></section>`;
  const { points: p, populationByLocation: n, comparison: c } = score;
  const row = (label: string, value: string) => `<span>${escape(label)}<b>${escape(value)}</b></span>`;
  return `<section data-terminal-score="scored" style="overflow-wrap:anywhere"><h3>${ja ? '終局スコア' : 'Terminal score'}: ${escape(signed(p.total))}</h3><div class="stats-grid">${[
    row(ja ? '健康人口 H' : 'Healthy population H', `${score.healthyPopulation} × ${score.coefficients.wH} = ${p.population}`),
    row(ja ? '健全な初期施設 F' : 'Healthy initial facilities F', `${score.healthyInitialFacilities}/${score.initialFacilityCount} × ${score.coefficients.wF} = ${p.facilities}`),
    row(ja ? '初期部隊人員 I / I0' : 'Initial personnel I / I0', `${score.initialPersonnel}/${score.initialPersonnelTotal} → ${p.initialPersonnel}/${score.coefficients.bMax}`),
    row(ja ? '全生存部隊 U（参考）' : 'All surviving units U (reference)', String(score.survivingUnits)),
    row(ja ? '資産点 A' : 'Asset points A', p.assets),
    row(p.outcomeAdjustment === '1' ? ja ? '勝利加算' : 'Victory adjustment' : ja ? '敗北共通控除' : 'Defeat adjustment', signed(p.outcomeAdjustment)),
  ].join('')}</div><p class="muted">${ja ? '健康人口内訳: 施設 / 部隊 / 編成待ち / 検問所（待機・審査・合格）' : 'Healthy people: facilities / units / formations / checkpoints (waiting, screening, approved)'}<br>${escape(`${n.facilities} / ${n.units} / ${n.formations} / ${n.waiting} · ${n.screening} · ${n.approved}`)}</p><p class="muted">${ja ? '新編成・増援の健康人数もHに含みます。部隊数U自体は加点しません。' : 'New units and reinforcements count in H. Unit count U earns no points.'}</p><p class="muted" data-score-crowding>${ja ? '終局時の過密（参考・スコアや順位への影響なし、感染者を含む）: 都市人数 / 容量 / 都市別超過の合計' : 'Terminal crowding (reference only, no score or ranking effect; includes infected): city population / capacity / sum of local excess'}<br>${escape(`${score.crowding.population} / ${score.crowding.capacity} / ${score.crowding.excess}`)}</p><details><summary>${ja ? '採点版・係数・比較条件' : 'Score version, coefficients and comparison conditions'}</summary><p>${escape(score.version)} · wH=${score.coefficients.wH}, wF=${score.coefficients.wF}, bMax=${score.coefficients.bMax}<br>Hmax=${score.populationLimit}, P=${p.defeatPenalty}<br>${escape(`${c.scenario} / ${c.mapMode} / ${c.origin}`)}<br>${ja ? 'ルート / 地図 / ゲームSeed' : 'Root / map / gameplay seed'}: ${escape(`${c.rootSeed} / ${c.mapSeed} / ${c.gameplaySeed}`)}<br>${escape(`${c.rulesVersion} / ${c.generatorVersion}`)}<br>Fallback: ${escape(c.fallback ?? 'none')}</p><p class="muted">Config: <code style="overflow-wrap:anywhere">${escape(c.configHash)}</code><br>Map: <code style="overflow-wrap:anywhere">${escape(c.mapHash)}</code><br>${escape(c.initialDeployment)}: <code style="overflow-wrap:anywhere">${escape(c.initialBasisHash)}</code></p><p class="muted">${ja ? '採点版・係数・全比較条件が同じ記録だけを厳密比較します。条件が異なる点数は参考比較です。' : 'Strict comparison requires the same score version, coefficients and all conditions. Scores under different conditions are reference comparisons only.'}</p></details></section>`;
}
