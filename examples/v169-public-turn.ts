/** Run: node node_modules/vite-node/vite-node.mjs --script examples/v169-public-turn.ts */
import { createAiSession } from '../src/session/ai-session';
import type { GameAction } from '../src/core/types';
import type { AiSessionResponse } from '../src/session/ai-session-contract';

function checked<T extends object>(r: AiSessionResponse<T>) {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}
const session = createAiSession({ initial: { scenarioId: 'una', seed: 7 }, preferredCommentLocale: 'en' });
function actFromCurrentState(action: GameAction, requestId: string) {
  const context = session.getContext();
  const input = { generation: context.generation, baseRevision: context.revision, action };
  if (action.type === 'Move') {
    const route = checked(session.query({ generation: context.generation, baseRevision: context.revision, target: 'route', filters: { moverUnitId: action.unitId, destination: {kind:'coordinate',position:action.destination}, includeHexPath:true } }));
    console.log(JSON.stringify({kind:'route',revision:context.revision,route:route.value}));
  }
  const preview = checked(session.previewAction(input));
  console.log(JSON.stringify({ kind: 'prediction', summary: preview.summary }));
  if (!preview.legal) return; // A successful preview command can describe an illegal action.
  if (preview.summary?.movement?.destinationReached === false) {
    console.log(JSON.stringify({kind:'replan',reason:preview.summary.movement.interruptionReason}));
    return; // This example declines a legal move predicted to stop early.
  }
  const response = session.act({ ...input, requestId, decisionSummary: 'Act on the current public preview.' });
  if (!response.ok) {
    if (response.error.code === 'stale_revision') {
      // Discard the old plan. Re-observe/re-query, then choose and preview a new action.
      console.log(JSON.stringify({ kind: 'replan', context: session.getContext(), observation: checked(session.observe()).observation }));
      return;
    }
    throw new Error(`${response.error.code}: ${response.error.message}`);
  }
  console.log(JSON.stringify({ kind: 'result', requestId, summary: response.record.summary }));
  if (!response.record.accepted) return;
  // Use actualPosition and the returned revision. Re-query targets after every shot/overrun.
  const enemies = checked(session.query({ generation: response.generation, baseRevision: response.revision, target: 'enemies', pageSize: 100 }));
  console.log(JSON.stringify({ kind: 'current-enemies', revision: response.revision, count: enemies.count, nextCursor: enemies.nextCursor }));
}
const legal = checked(session.getLegalActions({ generation: 1, baseRevision: 0, actionKind: 'Move', pageSize: 500 }));
const move = legal.actions.find((a): a is Extract<GameAction,{type:'Move'}> => a.type === 'Move');
if (move) actFromCurrentState(move, 'example-move-1');
actFromCurrentState({type:'Wait',unitId:'already-destroyed-or-unknown'}, 'example-invalid');
actFromCurrentState({type:'EndTurn'}, 'example-end-turn');
