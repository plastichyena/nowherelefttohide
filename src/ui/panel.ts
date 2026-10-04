import type { AgentUnitObservation, AgentFacilityObservation, AgentCheckpointObservation, AgentMapTileObservation } from '../agent/types';
import { createTranslator, facilityLabel, unitLabel, type Locale } from './i18n';

export interface PanelViewModel {
  title: string;
  status: string;
  collapsed: string[];
  facts: Array<{ label: string; value: string; ratio?: number }>;
  exceptions: string[];
}
export type PanelSource = { kind: 'unit' | 'zombie'; value: AgentUnitObservation; supplied: boolean; infectedSite: boolean }
  | { kind: 'facility'; value: AgentFacilityObservation; stoppedReason?: string; infectionRisk?: number }
  | { kind: 'checkpoint'; value: AgentCheckpointObservation; infectionRisk?: number }
  | { kind: 'hex' | 'road'; value: AgentMapTileObservation; wireHp?: string; reason?: string };

/** Display-only, public projections. Neither hidden population nor unavailable values become zero. */
export function panelViewModel(source: PanelSource, locale: Locale): PanelViewModel {
  const t = createTranslator(locale), ja = locale === 'ja';
  const model: PanelViewModel = { title: '', status: '', collapsed: [], facts: [], exceptions: [] };
  const fact = (label: string, value: unknown, ratio?: number) => model.facts.push({ label, value: value === null || value === undefined ? t('unknown') : String(value), ratio });
  const exception = (condition: unknown, value: string) => { if (condition) model.exceptions.push(value); };
  if (source.kind === 'unit' || source.kind === 'zombie') {
    const u = source.value;
    model.title = unitLabel(u.type, locale);
    model.status = source.kind === 'unit' ? t(`proficiency.${u.proficiency}`) : '';
    model.collapsed = [`HP ${u.hp}/${u.maxHp}`, ...(source.kind === 'unit' ? [source.supplied ? t('supplied') : t('outOfSupply')] : [])];
    fact('HP', `${u.hp}/${u.maxHp}`, u.hp / u.maxHp);
    if (source.kind === 'unit') {
      fact(t('movement'), u.movement); fact(t('attackCharge'), `${u.attackChargesRemaining}/${u.maxAttackCharges}`);
      fact(t('fuel'), `${u.currentFuel}/${u.maxFuel}`); fact(t('militaryGoods'), `${u.currentMilitaryGoods}/${u.maxMilitaryGoods}`);
      exception(!source.supplied, t('outOfSupply'));
      exception(u.currentFuel === 0, ja ? `燃料0 · 緊急移動${u.emergencyMovementAvailable ? '可' : '不可'}` : `Fuel 0 · Emergency move ${u.emergencyMovementAvailable ? 'available' : 'unavailable'}`);
      exception(u.rangeModifierReason, t('carriedMilitaryGoodsShortage'));
      exception(source.infectedSite, t('infected')); exception(u.veteranPromotionPending, t('veteranPromotionPending'));
    } else {
      fact(t('attack'), u.attack); fact(t('movement'), u.effectiveMovement); fact(t('range'), u.effectiveRange);
      fact(t('waveMembership'), u.isFinalWaveMember ? t('finalWave') : u.isScheduledWaveMember ? t('horde') : t('none'));
      exception(u.appliedMovementBonus > 0, `${t('movement')} +${u.appliedMovementBonus}`);
    }
  } else if (source.kind === 'facility') {
    const f = source.value, p = f.production;
    model.title = facilityLabel(f.type, locale);
    const status = ({building:'stateBuilding',disabled:'stateDisabled',recovering:'stateRecovering'} as Record<string,string>)[f.operationalStatus] ?? f.operationalStatus;
    model.status = t(status);
    model.collapsed = [`${t('population')} ${f.healthyPopulation ?? t('unknown')}/${f.populationCapacity}`];
    fact(t('facilityStatus'), model.status); fact(t('population'), `${f.healthyPopulation ?? t('unknown')}/${f.populationCapacity}`);
    const production = Object.entries(p.projectedProduction ?? p.estimatedOutput).map(([key,value]) => `${t(key)} ${Number(value).toFixed(2).replace(/\.?0+$/, '') || '0'}`).join(' · ');
    fact((ja?'生産予測':'Output'), production || '—'); fact(t('powerSupply'), p.powerMode === 'none' ? '—' : p.projectedPowerSupplied ? t('powerOn') : t('powerOff'));
    fact(t('facilitySupply'), f.inSupply ? t('supplied') : t('outOfSupply'));
    exception(p.powerMode === 'required' && !p.projectedPowerSupplied, t('unpoweredForecast'));
    exception(f.infectedPopulation !== null && f.infectedPopulation > 0, `${t('infected')} ${f.infectedPopulation}`);
    exception(f.healthyPopulation !== null && f.healthyPopulation > f.populationCapacity, t('overcrowding'));
    exception(source.stoppedReason && f.operationalStatus !== 'operational' && !['infected','recovering'].includes(f.operationalStatus), source.stoppedReason ?? '');
    exception(source.infectionRisk && source.infectionRisk > 0, `${ja?'感染確率':'Infection risk'} ${((source.infectionRisk ?? 0)*100).toFixed(2)}%`);
    exception(f.recoveryOperationalTurn !== null, `${t('recoveryTurn')} ${f.recoveryOperationalTurn}`);
  } else if (source.kind === 'checkpoint') {
    const c = source.value;
    model.title = t('checkpoint'); model.status = `${t(c.role)} · ${t(c.status)}`;
    model.collapsed = [model.status];
    fact(ja?'待機 / 審査 / 合格 / 感染':'Waiting / Screening / Approved / Infected', `${c.waiting} / ${c.screening} / ${c.approved} / ${c.infected}`);
    fact(t('nextArrival'), c.nextArrivalTurn === null ? '—' : `T${c.nextArrivalTurn}`);
    fact(t('facilitySupply'), c.providesSupply ? t('supplied') : t('outOfSupply'));
    fact(t('branchPolicy'), `${t(c.nextPolicy)} · ${t(c.currentPolicy)} (${c.remainingTurns}T)`);
    exception(c.infected > 0, `${t('infected')} ${c.infected}`);
    exception(source.infectionRisk && source.infectionRisk > 0, `${ja?'感染確率':'Infection risk'} ${((source.infectionRisk ?? 0)*100).toFixed(2)}%`);
    exception(c.nextArrivalTurn === null, ja?'新規到着停止':'New arrivals stopped');
  } else {
    const tile = source.value as AgentMapTileObservation;
    model.title = `${t(source.kind === 'road' ? 'roadHex' : 'hex')} (${tile.q},${tile.r})`;
    model.status = t(`terrain.${tile.terrain}`, ja ? ({plain:'平地',forest:'森林',mountain:'山地',water:'水域'}[tile.terrain] ?? '地形') : tile.terrain);
    model.collapsed = [model.status]; fact(t('terrain'), model.status);
    if (tile.road || tile.urban) fact(t('roadOverlay'), [tile.road ? t('roadOverlay') : '',tile.urban ? t('urbanOverlay') : ''].filter(Boolean).join(' · '));
    if ('wireHp' in source && source.wireHp) fact(t('barbedWire'), source.wireHp);
    if ('reason' in source && source.reason) model.exceptions.push(source.reason);
  }
  return model;
}
