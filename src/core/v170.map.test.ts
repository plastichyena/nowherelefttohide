import { describe, expect, it } from 'vitest';
import baseline from '../testing/fixtures/v169-fixed-baseline.json';
import { legacyDigest } from '../../scripts/v170-fixed-baseline';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createInitialState } from './state';
import { validateInvariants } from './invariants';
import { generateRandomMap, mapContentHash, publicStaticMap, validateRandomMap } from './map-generation';
import { resolveScenario } from './scenarios';
import { createAgentGame } from '../agent/game';
import type { GameAction } from './types';
import {exportSaveJson,importSaveJson} from '../persistence/save';

describe('v1.7.0 map contracts',()=>{
  it('preserves v1.6.9 fixed initialization and three turn transitions',()=>{
    for(const f of baseline.fixtures){const game=new GameEngine(f.seed,createDefaultConfig({mapMode:'fixed'}));expect(legacyDigest(game.getState()),`seed ${f.seed} initial`).toBe(f.digests[0]);
      f.actions.forEach((a,i)=>{expect(game.step(a as GameAction).error).toBeNull();expect(legacyDigest(game.getState()),`seed ${f.seed} step ${i}`).toBe(f.digests[i+1]);});}
  },120000);
  it('defaults to random and separates map and gameplay seeds',()=>{
    const a=createInitialState(1,createDefaultConfig({mapSeed:42,gameplaySeed:1}));
    const b=createInitialState(2,createDefaultConfig({mapSeed:42,gameplaySeed:2}));
    expect(a.mapDescriptor.mode).toBe('random');expect(a.mapDescriptor.mapHash).toBe(b.mapDescriptor.mapHash);
    expect(a.map.initialZombiePositions).not.toEqual(b.map.initialZombiePositions);
    expect(a.facilities).toHaveLength(28);expect(a.checkpoints).toHaveLength(4);expect(a.units.filter(u=>u.isPlayerUnit)).toHaveLength(7);
    expect(a.population.healthyCivilians).toBe(110);expect(a.population.unitPopulation).toBe(45);
    expect(validateInvariants(a)).toEqual({valid:true,errors:[]});
    expect(resolveScenario({}).config.mapMode).toBe('random');
    expect(()=>resolveScenario({mapMode:'bad' as never})).toThrow('invalid_map_mode');
    expect(()=>resolveScenario({scenarioId:'una',configOverrides:{}})).toThrow('scenario_config_override_forbidden');
  });
  it('rejects unsafe seeds and accepts boundary seeds',()=>{
    for(const seed of [NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])expect(()=>resolveScenario({mapSeed:seed})).toThrow('invalid_seed');
    for(const seed of [0,-1,4294967295,4294967296,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER])expect(validateInvariants(createInitialState(seed,createDefaultConfig())).valid).toBe(true);
  });
  it('validates geometry as well as hashes and keeps hidden positions out of the public hash',()=>{
    const s=createInitialState(3,createDefaultConfig());const hash=mapContentHash(publicStaticMap(s.map));
    s.map.initialZombiePositions=[];expect(mapContentHash(publicStaticMap(s.map))).toBe(hash);
    s.map.facilities[1]!.position={q:0,r:0};expect(validateRandomMap(s.map,s.config).valid).toBe(false);
  });
  it('ignores configuration property insertion order when generating the public map',()=>{
    const a=createDefaultConfig(),b=structuredClone(a);
    b.facilities=Object.fromEntries(Object.entries(b.facilities).reverse()) as typeof b.facilities;
    b.terrain.movementCost=Object.fromEntries(Object.entries(b.terrain.movementCost).reverse()) as typeof b.terrain.movementCost;
    const first=createInitialState(42,a),second=createInitialState(42,b);
    expect(second.mapDescriptor.mapHash).toBe(first.mapDescriptor.mapHash);
    expect(second.mapDescriptor.settingsId).toBe(first.mapDescriptor.settingsId);
  });
  it('rejects impossible enemy placement without regenerating the accepted geography',()=>{
    const progress:string[]=[];
    expect(()=>createInitialState(1,createDefaultConfig({economy:{initialScreamerCount:10000}}),p=>progress.push(p.stage))).toThrow('initial_enemy_placement_failed');
    expect(progress.filter(p=>p==='terrain')).toHaveLength(1);
    expect(progress.filter(p=>p==='initialization')).toHaveLength(1);
  });
  it('uses a deterministic dedicated inland fallback after bounded rejection',()=>{
    const config=createDefaultConfig();const state=createInitialState(1,config,undefined,{rejectCandidate:()=>true});
    expect(state.mapDescriptor.attempt).toBe(64);expect(state.mapDescriptor.fallback?.id).toBe('inland-fallback-1');expect(state.map.id).toBe('inland-51x51-v1');
    expect(validateRandomMap(state.map,config)).toEqual({valid:true,errors:[]});
    const loaded=importSaveJson(exportSaveJson(state));expect(loaded.valid).toBe(true);
    if(!loaded.valid || !loaded.state)throw new Error('fallback save did not load');
    expect(GameEngine.fromSnapshot(loaded.state).getState()).toEqual(state);
  },60000);
  it('exposes map identity on real API starts and rejects invalid reset without mutation',()=>{
    const game=createAgentGame();const a=game.reset({scenarioId:'una',seed:7});expect(a.map.id).toBe('inland-51x51-v1');
    expect(a.map.descriptor?.mapHash).toMatch(/^[a-f0-9]{64}$/);const before=game.getObservation();
    expect(()=>game.reset({mapMode:'invalid' as never})).toThrow();expect(game.getObservation()).toEqual(before);
    expect(()=>game.reset({configOverrides:{checkpoint:{initialSupplyRadius:0}}})).toThrow('map_generation_failed');expect(game.getObservation()).toEqual(before);
  },60000);
});
