import { expect, it } from 'vitest';
import { createAgentGame } from '../agent/game';
import { publicBoardEntities, publicBoardFrame } from './publicBoard';
import { createInitialState, createUnit } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { createAgentObservation } from '../agent/observation';

it('uses the same visible-entity boundary for Live observations and Replay documents', () => {
  const observation=createAgentGame().reset({seed:1});
  const enemy=observation.zombies[0]!;
  expect(enemy).toBeDefined();
  const frame=publicBoardFrame(observation);
  expect(publicBoardEntities(frame).some(e=>e.key===`unit:${enemy.id}`)).toBe(true);
  const replay={...frame.observation,visibleTileKeys:frame.observation.visibleTileKeys.filter(k=>k!==`${enemy.position.q},${enemy.position.r}`)};
  expect(publicBoardEntities(publicBoardFrame(replay,frame.map)).some(e=>e.key===`unit:${enemy.id}`)).toBe(false);
  expect(publicBoardEntities(publicBoardFrame(replay,frame.map)).filter(e=>e.kind==='unit'&&observation.units.some(u=>u.id===e.data.id))).toHaveLength(observation.units.length);
});

it('draws air after ground even when public ID ordering places the helicopter first, and omits cargo',()=>{
  const state=createInitialState(1,createDefaultConfig());
  const heli=createUnit(state,'a-aircraft','multipurposeHelicopter',{q:25,r:25});heli.flightState='airborne';heli.movementDomain='air';heli.movement=50;heli.cargoUnitId='cargo';
  const cargo=createUnit(state,'cargo','police',heli.position);cargo.transportedByUnitId=heli.id;
  state.units=[heli,cargo,createUnit(state,'z-ground','police',heli.position)];
  const frame=publicBoardFrame(createAgentObservation(state)),entities=publicBoardEntities(frame);
  expect(entities.some(e=>e.key==='unit:cargo')).toBe(false);
  expect(entities.at(-1)?.key).toBe('unit:a-aircraft');
  expect(entities.findIndex(e=>e.key==='unit:z-ground')).toBeLessThan(entities.findIndex(e=>e.key==='unit:a-aircraft'));
  expect(publicBoardEntities(publicBoardFrame(frame.observation,frame.map))).toEqual(entities);
});
