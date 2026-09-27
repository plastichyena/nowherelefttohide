import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReplayPackage,ReplayZip } from './package';
it('shows an actual v1.6.7 public ZIP with recorded HP60 and no invented animation',async()=>{
  const bytes=readFileSync(new URL('./fixtures/v167-public.zip',import.meta.url));
  const replay=await new ReplayPackage(new ReplayZip(new Blob([bytes]),new AbortController().signal)).open();
  const decision=await replay.decision(0);
  expect(decision.before.observation.zombies.find(z=>z.type==='riotZombie')).toMatchObject({hp:60,maxHp:60});
  expect(decision.record.events.some(e=>e.type==='zombie_presentation')).toBe(false);
  expect(decision.after.observation.turn).toBe(2);
},30000);
