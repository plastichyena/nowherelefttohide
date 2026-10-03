/** Run: npm exec vite-node -- --script examples/v170-public-turn.ts */
import {createAiSession} from '../src/session/ai-session';
import type {AiSessionResponse} from '../src/session/ai-session-contract';
import type {GameAction} from '../src/core/types';

function checked<T extends object>(r:AiSessionResponse<T>) {
  if(!r.ok)throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}
const session=createAiSession({initial:{scenarioId:'una',seed:1,mapMode:'random',mapSeed:42,gameplaySeed:1},preferredCommentLocale:'en'});
function terminal() {
  const observation=checked(session.observe()).observation;
  if(!observation.gameOver)return false;
  console.log(JSON.stringify({kind:'terminal',progressActionsAllowed:false,result:session.getResult(),artifact:session.buildPublicArtifact()}));
  return true; // Use the formal result, never infer defeat from units or visible enemies.
}
function act(action:GameAction,requestId:string) {
  if(terminal())return;
  const context=session.getContext(), input={generation:context.generation,baseRevision:context.revision,action};
  const preview=checked(session.previewAction(input)); // Raw action; play-turn uses its documented envelope.
  console.log(JSON.stringify({kind:'prediction',revision:context.revision,summary:preview.summary}));
  if(!preview.legal||preview.summary?.movement?.destinationReached===false)return;
  const request={...input,requestId,decisionSummary:'Use the current public preview.'};
  const response=session.act(request);
  if(!response.ok){
    console.log(JSON.stringify({kind:'replan',error:response.error,context:session.getContext()}));
    return; // On stale_revision, re-observe and choose a new action, then preview it.
  }
  console.log(JSON.stringify({kind:'result',accepted:response.record.accepted,revision:response.revision,summary:response.record.summary}));
  // For a lost transport response, resend this exact requestId and payload. The
  // replayed response is the same decision, not a second action. Never increment
  // a local decision counter without inspecting accepted/replayed and revision.
  terminal();
}
// Candidate query filters use unitId. Submit the returned typed action unchanged:
// Attack has attackerId/targetId; AttackHex has attackerId/position.
// Inspect gasExplosion and gasRisk even when friendlyFirePossible is false.
const context=session.getContext();
const units=checked(session.query({generation:context.generation,baseRevision:context.revision,target:'units',pageSize:1}));
console.log(JSON.stringify({kind:'units',page:units})); // Follow nextCursor; omitted is not zero.
act({type:'EndTurn'},'v170-example-turn-1');
