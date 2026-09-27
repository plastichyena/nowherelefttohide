import { afterEach,describe,expect,it,vi } from 'vitest';
import { TurnPlayback } from './turnPlayback';
import { applyPresentationFrame,type TurnPresentation,type PresentationSnapshot } from '../core/presentation';

const base:PresentationSnapshot={units:[],facilities:[],checkpoints:[],walls:[],visibleTileKeys:[]};
const presentation=(actors=2,steps=8):TurnPresentation=>({version:1,turn:1,base,frames:Array.from({length:actors*steps},(_,i)=>({actorId:`enemy-${Math.floor(i/steps)}`,walls:{upsert:[{id:'wall',position:{q:i,r:0},hp:20,maxHp:20,builtTurn:1}],remove:[]}}))});
afterEach(()=>vi.useRealTimers());
describe('shared normal/replay/live display clock',()=>{
  it('plays the recorded order with at most350ms per actor and reaches the exact reducer result',()=>{
    vi.useFakeTimers();const p=presentation(),clock=new TurnPlayback(),frames:PresentationSnapshot[]=[];let complete=0;
    clock.play(p,s=>frames.push(s),()=>complete++);
    vi.advanceTimersByTime(700);expect(complete).toBe(1);expect(clock.active).toBe(false);
    expect(frames.at(-1)).toEqual(p.frames.reduce(applyPresentationFrame,p.base));
    expect(frames.slice(1).map(s=>s.walls[0]!.position.q)).toEqual(Array.from({length:16},(_,i)=>i));
  });
  it('skip is synchronous, idempotent and does not skip a later phase',()=>{
    vi.useFakeTimers();const clock=new TurnPlayback();let complete=0,rendered=0;
    clock.play(presentation(100,15),()=>rendered++,()=>complete++);
    const start=performance.now();clock.skip();expect(performance.now()-start).toBeLessThan(100);
    clock.skip();clock.skip();vi.runAllTimers();expect(complete).toBe(1);expect(rendered).toBe(2);
    clock.play(presentation(1),()=>rendered++,()=>complete++);expect(clock.active).toBe(true);vi.runAllTimers();expect(complete).toBe(2);
  });
  it('cancel and seek replace outstanding callbacks without completing an old phase',()=>{
    vi.useFakeTimers();const clock=new TurnPlayback(),old=vi.fn(),next=vi.fn();
    clock.play(presentation(),()=>{},old);clock.cancel();vi.runAllTimers();expect(old).not.toHaveBeenCalled();
    clock.play(presentation(),()=>{},old);clock.play(presentation(1),()=>{},next);vi.runAllTimers();expect(old).not.toHaveBeenCalled();expect(next).toHaveBeenCalledTimes(1);
  });
});
