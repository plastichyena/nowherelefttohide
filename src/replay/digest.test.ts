import { describe,it,expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Digest } from './digest';
import { commentDuration } from './view';
describe('stream digest and playback timing',()=>{
  it.each([0,1,55,56,63,64,65,100000])('matches SHA-256 across chunk boundaries: %s',n=>{const bytes=Uint8Array.from({length:n},(_,i)=>i%251);const d=new Digest();for(let i=0;i<n;i+=37)d.update(bytes.subarray(i,i+37));expect(d.hex()).toBe(createHash('sha256').update(bytes).digest('hex'));});
  it('counts Unicode code points and skips absent comments',()=>{expect(commentDuration('')).toBe(0);expect(commentDuration('😀'.repeat(61))).toBe(4000);expect(commentDuration('x'.repeat(1000))).toBe(8000);});
});
