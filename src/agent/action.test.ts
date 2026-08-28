import { describe, expect, it } from 'vitest';
import { actionKey, sortActions } from './action';

describe('Agent action keys', () => {
  it('distinguishes checkpoint build and relocation deterministically', () => {
    const build = { type: 'BuildCheckpoint', branchId: 'north', position: { q: 1, r: 7 } } as const;
    const relocate = { type: 'RelocateCheckpoint', checkpointId: 'checkpoint-north-1', branchId: 'north', position: { q: 1, r: 7 } } as const;
    expect(actionKey(build)).toBe('BuildCheckpoint|north|1,7');
    expect(actionKey(relocate)).toBe('RelocateCheckpoint|checkpoint-north-1|north|1,7');
    expect(actionKey({ ...build, branchId: 'east' })).not.toBe(actionKey(build));
    expect(actionKey({ ...relocate, branchId: undefined })).not.toBe(actionKey(relocate));
    expect(sortActions([relocate, build])).toEqual([build, relocate]);
  });
});
