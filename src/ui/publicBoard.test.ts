import { expect, it } from 'vitest';
import { createAgentGame } from '../agent/game';
import { publicBoardEntities, publicBoardFrame } from './publicBoard';

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
