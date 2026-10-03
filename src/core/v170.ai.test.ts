import {expect,it} from 'vitest';
import {createAgentGame} from '../agent/game';
import {createUnit} from './state';
import {prepareTestSnapshot} from './testConfig';
import {proposeMapCorrections} from '../ui/map-start';
import {createDefaultConfig} from './config';
import {generateRandomMap,describeMap,validateMapDescriptor} from './map-generation';
import {buildContextHandoff} from '../session/context-handoff';

it('uses the same typed public attack and Gas projection in candidate, raw preview and summary without mutation',()=>{
  const game=createAgentGame();game.reset({mapMode:'fixed',seed:1});const s=game.exportPrivateSessionState();
  s.units=[createUnit(s,'guard','nationalGuard',{q:25,r:25}),createUnit(s,'gas','gasZombie',{q:26,r:25}),createUnit(s,'bystander','police',{q:26,r:24})];
  s.units[1]!.hp=1;s.units[2]!.hp=1;prepareTestSnapshot(s);game.restorePrivateSessionState(s);
  const before=game.exportPrivateSessionState();
  const candidate=(game.queryCandidates('attack-candidates',{unitId:'guard'}) as any[]).find(c=>c.targetId==='gas');
  expect(candidate.action).toEqual({type:'Attack',attackerId:'guard',targetId:'gas'});
  const preview=game.previewAction(candidate.action,0) as any;
  expect(preview.legal).toBe(true);expect(preview.combat.gasExplosion).toEqual(candidate.gasExplosion);
  expect(preview.summary.combat.gasExplosion.units.some((u:any)=>u.unitId==='bystander'&&u.lethal)).toBe(true);
  const observation=game.getObservation();
  const handoff=buildContextHandoff(observation,{sessionId:'fixture',revision:0,preferredCommentLocale:'en',branchLineage:null},[]);
  expect(handoff.authoritativeState.units.items.find(u=>u.id==='guard')?.attackPreviews).toEqual(observation.units.find(u=>u.id==='guard')?.attackPreviews);
  expect(game.exportPrivateSessionState()).toEqual(before);
});

it('offers a bounded explicit custom correction while preserving resources and combat settings',()=>{
  const config=createDefaultConfig({checkpoint:{initialSupplyRadius:0}}),before=structuredClone(config);
  const proposal=proposeMapCorrections(config,'initial_buildable_plain');
  expect(config).toEqual(before);expect(proposal.changes.map(c=>c.field)).toEqual(['checkpoint.initialSupplyRadius']);
  expect(proposal.corrected.checkpoint.initialSupplyRadius).toBe(5);
  expect(proposal.corrected.units).toEqual(config.units);expect(proposal.corrected.economy).toEqual(config.economy);
  expect(proposeMapCorrections(createDefaultConfig({scenarioId:'una'}),'initial_buildable_plain').changes).toEqual([]);
});

it('rejects a forged fallback designation even with a recalculated public hash',()=>{
  const config=createDefaultConfig(),generated=generateRandomMap(42,config);
  const d=describeMap(generated.map,42,config,64,{id:'inland-fallback-1',version:'inland-v1',reason:'forged'});
  expect(validateMapDescriptor({seed:42,config,map:generated.map,mapDescriptor:d})).toContain('fallback_content_mismatch');
});
