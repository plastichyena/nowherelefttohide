import type { CrisisSummaryViewModel, CrisisAlertViewModel, StrategicWarningViewModel } from './controller';

/** UI aggregation only: keep Core ordering and don't count the same resource/defeat warning twice. */
export function mergeDisplayAlerts(core: CrisisSummaryViewModel, strategic: readonly StrategicWarningViewModel[]): CrisisSummaryViewModel {
  const alerts = [...core.alerts];
  for (const warning of strategic) {
    if (warning.key === 'normal-forecast') continue;
    const [kind, resource] = warning.key.split(':');
    const covered = core.alerts.some(alert => {
      if (kind === 'guaranteedDefeat') return alert.reasonCode === 'guaranteed_resource_defeat';
      if (kind === 'shortage') return (alert.publicFacts.resource === resource && ['resource_runway_risk','public_health_food_stress','public_health_civilian_goods_stress'].includes(alert.reasonCode))
        || resource === 'electricity' && ['production_outage','nuclear_power_outage'].includes(alert.reasonCode)
        || resource === 'food' && alert.reasonCode === 'public_health_food_stress'
        || resource === 'civilianGoods' && alert.reasonCode === 'public_health_civilian_goods_stress'
        || resource === 'militaryGoods' && alert.reasonCode === 'military_goods_national_shortage';
      if (kind === 'fuel-shortage') return alert.reasonCode === 'resource_runway_risk' && alert.publicFacts.resource === 'fuel';
      return false;
    });
    if (covered) continue;
    alerts.push({ id:`display:${warning.key}`, severity:warning.tier==='critical'?'critical':warning.tier==='info'?'advisory':'warning', category:'strategic',reasonCode:warning.key,entityIds:[],publicFacts:{},label:warning.title,detail:warning.detail });
  }
  const order={critical:0,warning:1,advisory:2};
  alerts.sort((a,b)=>order[a.severity]-order[b.severity]);
  return {alerts,criticalCount:alerts.filter(a=>a.severity==='critical').length,warningCount:alerts.filter(a=>a.severity==='warning').length,advisoryCount:alerts.filter(a=>a.severity==='advisory').length};
}

export function compactCrisisText(alert: CrisisAlertViewModel, locale: 'ja'|'en', fallback:string): string {
  const names:Record<string,[string,string]>={
    capital_resident_minimum:['住民不足','Residents low'], capital_infection_uncontained:['感染未封鎖','Infection uncontained'],
    critical_site_infection_uncontained:['感染未封鎖','Infection uncontained'], checkpoint_active_missing:['検問所なし','No checkpoint'],
    checkpoint_defense_degraded:['防衛低下','Defense reduced'],unit_out_of_supply_risk:['供給外','Out of supply'],
    guaranteed_resource_defeat:['敗北見込み','Defeat projected'], production_outage:['生産停止','Production stopped'],
    resource_runway_risk:['資源不足見込み','Resource shortage'],military_goods_national_shortage:['軍需不足','Military shortage'],
    nuclear_early_capture_window:['遠征期限','Expedition deadline'],air_base_early_capture_window:['確保期限','Capture deadline'],
    internal_infection_risk:['感染リスク','Infection risk'],public_health_food_stress:['食料不足','Food deficit'],
    public_health_civilian_goods_stress:['民需不足','Goods deficit'],facility_workers_zero:['労働者なし','No workers'],
    checkpoint_health_risk:['感染リスク','Infection risk'],horde_warning_active:['襲撃警告','Horde warning'],
    overcrowding_forecast:['過密予測','Overcrowding'],temporary_housing_outage_forecast:['住宅停止予測','Housing outage'],
  };
  return names[alert.reasonCode]?.[locale==='ja'?0:1] ?? fallback;
}
