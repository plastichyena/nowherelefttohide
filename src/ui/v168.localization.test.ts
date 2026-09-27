import {expect,it} from 'vitest';
import {createTranslator} from './i18n';
import {RULES_V163} from '../core/rules-v163';
import {RULES_V164} from '../core/rules-v164';
import {RULES_V165} from '../core/rules-v165';

it('uses the nine required Japanese zombie names without changing English names',()=>{
  const ja=createTranslator('ja'),en=createTranslator('en');
  const names={zombie:'ゾンビ',hordeZombie:'ゾンビの大群',gasZombie:'ガスゾンビ',packZombie:'パック',hunterZombie:'ハンター',screamerZombie:'スクリーマー',riotZombie:'機動隊ゾンビ',policeZombie:'警察ゾンビ',soldierZombie:'兵士ゾンビ'};
  for(const [key,name] of Object.entries(names))expect(ja(key)).toBe(name);
  expect(en('hordeZombie')).toBe('Horde Zombie');
  expect(en('packZombie')).toBe('Pack Zombie');
  expect(ja('movement')).toBe('移動力（MP）');
});

it('keeps shared Japanese rule explanations and legends free of untranslated game terms',()=>{
  const ja=createTranslator('ja');
  const text=[...Object.values(RULES_V163.ja),...Object.values(RULES_V164.ja),...Object.values(RULES_V165.ja),
    ...['zombie','hordeZombie','riotZombie','policeZombie','soldierZombie','hunterZombie','gasZombie','screamerZombie','barbedWire'].map(key=>ja(`legendDescription.${key}`)),
    ...['tipBuild','tipVision','tipNoise','tipWaveRoster','tipCheckpoint','tipRefugeeRejection'].map(key=>ja(key))].join('\n');
  expect(text).not.toMatch(/\b(?:Horde|Zombie|Riot|Pack|Packed|Capital|PlayerTurn|Army|Preview|waiting|screening|approved|riotpolice)\b|パックed/);
  expect(ja('tipCheckpoint')).toContain('60人');
  expect(ja('tipRefugeeRejection')).toContain('2ターンごとに1人');
});
