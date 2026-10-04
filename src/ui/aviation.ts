import type { GameAction, GameState, UnitState } from '../core/types';
import { aviationUnitProjection, militaryDroneProjection } from '../core/aviation-preview';
import { previewMove } from '../core/movement-query';
import { RULES_V165 } from '../core/rules-v165';
import { createTranslator, type Locale } from './i18n';

export const aviationEscape = (value: unknown): string => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function aviationButton(action: GameAction, label: string, reason: string|null, locale: Locale): string {
  const t=createTranslator(locale);
  return `<div class="aviation-choice"><button class="secondary-button" data-action="aviation-preview" data-game-action="${aviationEscape(JSON.stringify(action))}" ${reason?'disabled':''}>${aviationEscape(label)}</button>${reason?`<small>${aviationEscape(t('error.'+reason,reason))}</small>`:''}</div>`;
}
export function renderAviationUnit(state: Readonly<GameState>, unit: UnitState, locale: Locale, destination?: {q:number;r:number}): string {
  if(!['ifv','multipurposeHelicopter'].includes(unit.type))return '';
  const isIfv = unit.type === 'ifv';
  const t=createTranslator(locale),p=aviationUnitProjection(state,unit),rules=RULES_V165[locale];
  const cargo=state.units.find(u=>u.id===unit.cargoUnitId);
  const move=destination?previewMove(state,unit.id,destination):null;
  return `<section data-aviation-unit="${aviationEscape(unit.id)}"><h3>${t(unit.type)}${isIfv?'':` · ${t(p.flightState ?? 'ground')}`}</h3><p>${t('cargo')}: ${cargo?`${t(cargo.type)} (${aviationEscape(cargo.id)}) HP${cargo.hp} · ${t('fuel')} ${cargo.currentFuel} · ${t('militaryGoods')} ${cargo.currentMilitaryGoods}`:t('none')}</p><p>${t('fuel')} ${unit.currentFuel}/${unit.maxFuel} · ${t('movement')} ${unit.movement} · ${t('vision')} ${unit.vision}</p>${isIfv?'':`<div class="aviation-choices">${aviationButton({type:'TakeOff',unitId:unit.id},t('takeOff'),p.takeOffReasonCode,locale)}${aviationButton({type:'Land',unitId:unit.id},t('land'),p.landReasonCode,locale)}</div>`}${!cargo?`<h4>${t(isIfv?'boardTransport':'boardAircraft')}</h4>${p.boardingCandidates.map(c=>aviationButton({type:'BoardTransport',unitId:c.unitId,transportId:unit.id},`${t(isIfv?'boardTransport':'boardAircraft')} ${c.unitId}`,c.reasonCode,locale)).join('')}`:`<h4>${t(isIfv?'disembarkTransport':'disembarkAircraft')}</h4><div class="aviation-choices">${p.disembarkCandidates.map(c=>aviationButton({type:'DisembarkTransport',transportId:unit.id,destination:c.destination},`${c.destination.q},${c.destination.r}`,c.reasonCode,locale)).join('')}</div>`}${isIfv&&move?.overruns?`<p data-ifv-preview="true">HP ${move.projectedHpAfterMove} · ${t('fuel')} ${move.projectedFuelAfterMove} · ${aviationEscape(move.arrivalReason)} · ${move.overruns.map(o=>`${aviationEscape(o.targetId)}: ${o.impactDamage}+${o.gasDamage}`).join(', ')}</p>`:''}${move&&'emergencyLanding' in move&&move.emergencyLanding?`<p class="warning-text">${aviationEscape(rules.emergency)}</p>`:''}</section>`;
}
export function renderMilitaryDrone(state: Readonly<GameState>, facilityId: string, locale: Locale): string {
  const t=createTranslator(locale),p=militaryDroneProjection(state);
  return `<section data-military-drone="true"><h3>${t('militaryDrone')}</h3>${p.active?`<p>${t('active')}: ${p.center!.q},${p.center!.r} · ${t('throughTurn')} ${p.expiresBeforeTurn!-1}</p>`:''}<button class="secondary-button" data-action="drone-target" data-facility-id="${aviationEscape(facilityId)}" ${p.relaunchAvailable?'':'disabled'}>${t('selectDroneTarget')}</button>${p.relaunchReasonCode?`<p>${aviationEscape(t('error.'+p.relaunchReasonCode,p.relaunchReasonCode))}</p>`:''}</section>`;
}
export function renderFacilityObjectives(state: Readonly<GameState>, locale: Locale): string {
  const t=createTranslator(locale);
  return `<section data-facility-objectives="true"><h3>${t('facilityObjectives')}</h3>${(['nuclearPowerPlant','airBase'] as const).map(type=>{const p=type==='airBase'?state.airBaseObjective:state.nuclearObjective;const config=state.config.objectives[type];return `<p><strong>${t('facility.'+type)}</strong> · Turn${config.rewardDeadlineTurn} · ${t('objective.'+p.reward)} · ${t('remaining')} ${Math.max(0,config.rewardDeadlineTurn-state.turn)}</p>`;}).join('')}</section>`;
}
