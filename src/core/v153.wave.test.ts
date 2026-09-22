import { expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
it('allows four Gas in each direction from Wave 1 through Final', () => {
  const config = createDefaultConfig({economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0}}});
  config.horde.waves = [1,2,3].map(turn => ({turn,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:4},final:turn===3}));
  config.horde.specialZombieWeights = {zombie:0,policeZombie:0,soldierZombie:0,riotZombie:0,hunterZombie:0,gasZombie:1};
  const engine = new GameEngine(153,config);
  for(const index of [1,2,3]) {
    const result=engine.step({type:'EndTurn'});
    expect(result.error).toBeNull();
    const spawned=result.state.units.filter(unit=>unit.spawnGroupId?.startsWith(`wave-${index}-`));
    expect(spawned).toHaveLength(index === 3 ? 6 : 5);
    expect(spawned.filter(unit=>unit.type==='packZombie')).toHaveLength(index === 3 ? 1 : 0);
    expect(spawned.filter(unit=>unit.type==='gasZombie')).toHaveLength(4);
    expect(spawned.filter(unit=>unit.type==='riotZombie')).toHaveLength(0);
    expect(spawned.filter(unit=>unit.type==='hunterZombie')).toHaveLength(0);
    expect(spawned.every(unit=>unit.hordeKind===(index===3?'final':'periodic'))).toBe(true);
  }
});
