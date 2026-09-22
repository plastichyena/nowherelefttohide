import { describe, expect, it } from 'vitest';
import { createAgentGame } from './game';
import { createAiSession } from '../session/ai-session';

describe('v1.6.4 public checkpoint relocation',()=>{
  it('accepts branch omission in Session preview and act at the same revision',()=>{
    const session=createAiSession({initial:{seed:1}}),action={type:'RelocateCheckpoint' as const,checkpointId:'checkpoint-2',position:{q:29,r:25}};
    const preview=session.previewAction({generation:1,baseRevision:0,action});
    expect(preview).toMatchObject({ok:true,legal:true});
    const result=session.act({generation:1,baseRevision:0,requestId:'relocation-no-branch',action});
    expect(result).toMatchObject({ok:true,revision:1,record:{accepted:true}});
  });
  it.each([undefined,'east','west'])('handles branchId %s through the public AgentGame',branchId=>{
    const game=createAgentGame();game.reset({seed:1});
    const action={type:'RelocateCheckpoint' as const,checkpointId:'checkpoint-2',position:{q:29,r:25},...(branchId?{branchId}: {})};
    const result=game.step(action);
    if(branchId==='west')expect(result.error?.code).toBe('checkpoint_wrong_branch');
    else {expect(result.error).toBeNull();expect(result.observation.checkpoints.find(c=>c.role==='active'&&c.branchId==='east')?.position).toEqual(action.position);}
  });
});
