import type { AgentUnitObservation } from '../agent/types';
import { createTranslator, facilityLabel, viewerUnitLabel, type Locale } from './i18n';
import type { FacilityType, HexCoord } from '../core/types';

/** Receives recorded public units only. Original comments are never passed through this formatter. */
export function viewerReferenceText(value: unknown, units: readonly Pick<AgentUnitObservation,'id'|'type'>[], locale: Locale, space?: number, sites: readonly {id:string;type?:FacilityType;position:HexCoord}[] = []): string {
  const names = new Map(units.map(unit=>[unit.id,viewerUnitLabel(unit,locale)]));
  const t=createTranslator(locale);
  for(const site of sites)names.set(site.id,`${site.type ? facilityLabel(site.type,locale) : t('checkpoint')} (${site.position.q},${site.position.r})`);
  return JSON.stringify(value,(key,item)=> key === 'decisionSummary' || key === 'comment' ? item : typeof item==='string' ? names.get(item) ?? (/type$/i.test(key) ? t(`facility.${item}`,t(item,item)) : item) : item,space);
}
