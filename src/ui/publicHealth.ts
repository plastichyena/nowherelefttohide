import { forecastEndTurn } from '../core/economy-query';
import { RULES_V163 } from '../core/rules-v163';
import type { GameState } from '../core/types';
import type { Locale } from './i18n';
import { humanNames } from './displayNames';
const escape = (s: unknown) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const percent = (p: number) => `${(p*100).toFixed(2).replace(/\.?0+$/,'')}%`;
export function renderHealthDetails(state: Readonly<GameState>, locale: Locale, siteId?: string): string {
  const h=forecastEndTurn(state).publicHealth, ja=locale==='ja', rules=RULES_V163[locale];
  const names=humanNames(state,locale);
  const rows: Array<[string,string]> = siteId ? [] : [
    [ja?'食料 / 民需品不足率':'Food / goods deficit',`${percent(h.foodDeficit)} / ${percent(h.civilianGoodsDeficit)}`],
    [ja?'衛生ストレス 食料 / 民需品':'Health stress food / goods',`${h.stressBefore.food.toFixed(3)} → ${h.stressAfter.food.toFixed(3)} / ${h.stressBefore.civilianGoods.toFixed(3)} → ${h.stressAfter.civilianGoods.toFixed(3)}`],
    [ja?'食料蓄積（閾値2 / 上限7）':'Food accumulation (threshold2 / cap7)',`${h.accumulationBefore.toFixed(2)} → ${h.accumulationAfter.toFixed(2)}`],
    [ja?'飢餓死亡率 / 予測人数 / 繰越端数':'Starvation rate / projected deaths / carry',`${percent(h.starvationRate)} / ${h.starvation.loss} / ${h.starvation.carryAfter.toFixed(3)}`],
  ];
  const risks=h.facilities.filter(f=>(!siteId||f.facilityId===siteId)&&f.healthyPopulation>0&&(!siteId||f.probability>0)).sort((a,b)=>b.probability-a.probability);
  for(const f of risks) rows.push([names.get(f.facilityId) ?? (ja?'施設':'Facility'),`${ja?'健康人口':'Healthy'} ${f.healthyPopulation} · ${percent(f.probability)} · ${ja?'期待':'Expected'} ${f.expectedInfections.toFixed(2)} · ${ja?'猶予中':'Deferred'} ${f.graceCount} · Food ${f.causes.food.toFixed(3)} / CG ${f.causes.civilianGoods.toFixed(3)} / ${ja?'過密':'Crowding'} ${f.causes.overcrowding.toFixed(3)} / ${ja?'停電':'Outage'} ${f.causes.housingOutage.toFixed(3)}`]);
  for(const c of h.checkpoints.filter(c=>!siteId||(c.checkpointId===siteId&&(c.probability>0||c.screeningProbability>0)))) rows.push([names.get(c.checkpointId) ?? (ja?'検問所':'Checkpoint'),`waiting ${c.waiting} · ${percent(c.probability)} · ${ja?'期待':'Expected'} ${c.expectedInfections.toFixed(2)} · ${ja?'審査':'Screening'} ${percent(c.screeningProbability)} · ${ja?'猶予中':'Deferred'} ${c.graceCount}`]);
  const deferred=[...h.facilities,...h.checkpoints].filter(f=>!siteId||('facilityId'in f?f.facilityId:f.checkpointId)===siteId).flatMap(f=>f.infectionGrace).filter(g=>g.spreadsFromTurn>state.turn);
  if (siteId && !rows.length) return '';
  const abnormal=h.foodDeficit>0||h.civilianGoodsDeficit>0||h.stressAfter.food>0||h.stressAfter.civilianGoods>0||h.accumulationAfter>0||h.starvation.loss>0||risks.some(f=>f.probability>0)||h.checkpoints.some(c=>c.probability>0||c.screeningProbability>0);
  const summary=siteId ? (ja?'この拠点の感染予測':'Local infection forecast') : abnormal ? (ja?'衛生・飢餓・感染予測':'Health, starvation and infection forecast') : (ja?'異常なし':'No issues');
  return `<details class="health-details" data-public-health="true"><summary>${summary}</summary><dl class="forecast-detail-grid">${rows.map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl>${deferred.length?`<p>${ja?'感染拡大開始Turn':'Spread begins at EndTurn'}: ${deferred.map(g=>`${g.spreadsFromTurn} (${g.count})`).join(', ')}</p>`:''}<p>${ja?'現在の人口・供給と確定的な鎮圧を仮定。到着・確率感染で後続結果は変化します。':'Conditional on current population, supply and deterministic suppression; arrivals and random infections can change later results.'}</p></details>`;

}
export function renderNuclearObjective(state: Readonly<GameState>, locale: Locale): string {
  const status={ja:{unclaimed:'未確保',pending:'援軍配置待ち',claimed:'援軍獲得済み',expired:'期限終了'},en:{unclaimed:'Not captured',pending:'Reinforcement pending',claimed:'Reward claimed',expired:'Deadline expired'}};
  return `<p class="nuclear-objective" data-nuclear-objective="true">${locale==='ja'?'原発遠征':'Nuclear expedition'} · ${status[locale][state.nuclearObjective.reward]} · Turn${state.config.objectives.nuclearPowerPlant.rewardDeadlineTurn}</p>`;
}
