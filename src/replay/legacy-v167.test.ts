import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReplayPackage,ReplayZip } from './package';
it('rejects a v1.6.7 public ZIP non-destructively without inventing a migration',async()=>{
  const bytes=readFileSync(new URL('./fixtures/v167-public.zip',import.meta.url));
  const original=Buffer.from(bytes);
  await expect(new ReplayPackage(new ReplayZip(new Blob([bytes]),new AbortController().signal)).open()).rejects.toThrow(/1.6.8|incompatible|互換/);
  expect(bytes).toEqual(original);
},30000);
