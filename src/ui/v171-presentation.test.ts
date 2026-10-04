import { describe, expect, it } from 'vitest';
import { GameEngine } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import { createAgentObservation } from '../agent/observation';
import { panelViewModel } from './panel';
import { humanNames } from './displayNames';
import { viewerReferenceText } from './viewerNames';
import { mergeDisplayAlerts } from './status';
import { createTranslator, facilityLabel } from './i18n';

describe('v1.7.1 public presentation', () => {
  it('keeps required zero values and unknown population in compact panels without mutating the public state', () => {
    const state=new GameEngine(1547,createDefaultConfig({mapMode:'fixed'})).getState();
    const obs=createAgentObservation(state), before=JSON.stringify(obs);
    for(const locale of ['ja','en'] as const) {
      const u={...obs.units[0]!,currentFuel:0,currentMilitaryGoods:0,attackChargesRemaining:0,veteranPromotionPending:true};
      const unit=panelViewModel({kind:'unit',value:u,supplied:false,infectedSite:true},locale);
      expect(unit.facts).toHaveLength(5);
      expect(unit.facts.filter(f=>f.value.startsWith('0/'))).toHaveLength(3);
      expect(unit.exceptions.length).toBeGreaterThan(2);
      for(const f of obs.facilities) {
        const panel=panelViewModel({kind:'facility',value:f},locale);
        expect(panel.facts).toHaveLength(5);
        expect(panel.title).toBe(facilityLabel(f.type,locale));
        if(f.healthyPopulation===null)expect(panel.facts[1]!.value).toContain(createTranslator(locale)('unknown'));
      }
      const checkpoint=panelViewModel({kind:'checkpoint',value:obs.checkpoints[0]!},locale);
      expect(checkpoint.facts[0]!.value.split(' / ')).toHaveLength(4);
      expect(checkpoint.facts.length).toBeLessThanOrEqual(5);
    }
    expect(JSON.stringify(obs)).toBe(before);
  });

  it('keeps data identifiers and AI comments while using public name plus full ID in viewer references', () => {
    const state=new GameEngine(1547,createDefaultConfig({mapMode:'fixed'})).getState();
    const obs=createAgentObservation(state), action={type:'Wait',unitId:obs.units[0]!.id,decisionSummary:`Wait for ${obs.units[0]!.id}`};
    const before=JSON.stringify(action);
    for(const locale of ['ja','en'] as const) {
      const names=humanNames(state,locale);
      expect(names.get(obs.units[0]!.id)).not.toContain(obs.units[0]!.id);
      const survivor = state.units.find(unit => unit.id === 'police-2')!;
      expect(humanNames({...state,units:state.units.filter(unit=>unit.id!=='police-1')},locale).get(survivor.id)).toBe(names.get(survivor.id));
      const display=JSON.parse(viewerReferenceText(action,obs.units,locale));
      expect(display.unitId).toContain(`[${obs.units[0]!.id}]`);
      expect(display.unitId).not.toBe(`[${obs.units[0]!.id}]`);
      expect(display.decisionSummary).toBe(action.decisionSummary);
      expect(viewerReferenceText({unitId:'hidden-unit'},obs.units,locale)).toBe('{"unitId":"hidden-unit"}');
    }
    expect(JSON.stringify(action)).toBe(before);
  });

  it('counts duplicate public shortage/defeat warnings once and keeps all distinct warnings', () => {
    const core={alerts:[{id:'c1',severity:'critical' as const,category:'resource',reasonCode:'guaranteed_resource_defeat',entityIds:[],publicFacts:{}},{id:'c2',severity:'warning' as const,category:'resource',reasonCode:'public_health_food_stress',entityIds:[],publicFacts:{}}],criticalCount:1,warningCount:1,advisoryCount:0};
    const result=mergeDisplayAlerts(core,[{tier:'critical',key:'guaranteedDefeat',title:'Defeat',detail:''},{tier:'high',key:'shortage:food',title:'Food',detail:''},{tier:'warning',key:'single-point:electricity',title:'Single supplier',detail:''},{tier:'info',key:'normal-forecast',title:'Normal',detail:''}]);
    expect(result.alerts.map(a=>a.id)).toEqual(['c1','c2','display:single-point:electricity']);
    expect(result.criticalCount).toBe(1);expect(result.warningCount).toBe(2);
    expect(core.alerts).toHaveLength(2);
  });

  it('keeps destroyed unit and event references readable after the unit leaves the state', () => {
    const state=new GameEngine(1547,createDefaultConfig({mapMode:'fixed'})).getState();
    const names=humanNames({...state,events:[{id:'event-42',type:'unit_destroyed',turn:1,phase:'player',payload:{unitId:'police-50',unitType:'police',q:25,r:25}}]},'ja');
    expect(names.get('police-50')).toBe('警察 50');
    expect(names.get('event-42')).toBe('イベント 42');
  });
});
