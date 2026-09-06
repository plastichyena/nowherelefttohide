import { expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
it('restricts Gas to the last two waves and caps it independently per direction without adding slots', () => {
  const config = createDefaultConfig({economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0}}});
  config.horde.waves = [1,2,3].map(turn => ({turn,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:4},final:turn===3}));
  config.horde.specialZombieWeights = {zombie:1,policeZombie:0,soldierZombie:0,riotZombie:100000,hunterZombie:100000,gasZombie:100000};
  const engine = new GameEngine(153,config);
  for(const index of [1,2,3]) {
    const result=engine.step({type:'EndTurn'});
    expect(result.error).toBeNull();
    const spawned=result.state.units.filter(unit=>unit.spawnGroupId?.startsWith(`wave-${index}-`));
    expect(spawned).toHaveLength(5);
    expect(spawned.filter(unit=>unit.type==='gasZombie')).toHaveLength(index===1?0:1);
    expect(spawned.filter(unit=>unit.type==='riotZombie')).toHaveLength(1);
    expect(spawned.filter(unit=>unit.type==='hunterZombie')).toHaveLength(1);
    expect(spawned.every(unit=>unit.hordeKind===(index===3?'final':'periodic'))).toBe(true);
  }
});
