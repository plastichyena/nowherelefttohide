import type { PresentationSnapshot } from '../core/presentation';
import type { GameState, UnitState } from '../core/types';

/** Detached paint model only. Never passed into Engine, persistence or a query. */
export function presentationState(before:Readonly<GameState>,after:Readonly<GameState>,visual:PresentationSnapshot):Readonly<GameState> {
  return { ...before,
    units:visual.units.map(u=>({...before.units.find(v=>v.id===u.id),...after.units.find(v=>v.id===u.id),...u,position:{...u.position}} as UnitState)),
    facilities:visual.facilities.map(f=>({...before.facilities.find(v=>v.id===f.id),...f,workers:f.healthyPopulation??0,infected:f.infectedPopulation} as GameState['facilities'][number])),
    checkpoints:visual.checkpoints.map(c=>({...before.checkpoints.find(v=>v.id===c.id),...c,infected:c.infectedPopulation} as GameState['checkpoints'][number])),
    barbedWire:visual.walls,
  };
}
