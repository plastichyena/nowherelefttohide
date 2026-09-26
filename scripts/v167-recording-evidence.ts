/** Read-only reconstruction of recorded v1.6.6 public snapshots, never resumed under new rules. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { applyLosslessJsonDiff } from '../src/session/public-diff';
const directory = 'output/claude-playtest-20260925-v166-seed4';
const root = join(directory, 'sessions');
const commits = join(root, 'claude-0925-v166s4/commits');
function payload(reference: any): any {
  return JSON.parse(Buffer.concat(reference.chunks.map((c: any) => gunzipSync(readFileSync(join(root, 'pool', reference.domain, 'chunks', c.hash.slice(0, 2), `${c.hash}.gz`))))).toString());
}
const transcript = readFileSync(join(directory, 'logs/transcript.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
const trace = readFileSync(join(root, 'claude-0925-v166s4/trace.ndjson'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
function publicAt(revision: number) {
  const name = readdirSync(commits).find(n => n.startsWith(`g${String(revision).padStart(12, '0')}-`))!;
  const commit = JSON.parse(readFileSync(join(commits, name), 'utf8'));
  const head = payload(commit.publicState);
  let document = payload(head.snapshot).document;
  for (const reference of head.diffs) document = applyLosslessJsonDiff(document, payload(reference).operations);
  return { commit, document };
}
const reports = [153, 169, 202].map(revision => {
  const { commit, document } = publicAt(revision);
  const observation = document.observation;
  const visible = new Set(observation.visibleTileKeys);
  const branch = observation.roadBranches.find((b: any) => b.branchId === 'east');
  const query = transcript.find(r => r.line?.revision === revision && r.line?.target === 'construction')?.line;
  return { revision, turn: commit.currentTurn, roadTiles: branch.roadTiles,
    candidates: query.items.filter((c: any) => c.branchId === 'east' && c.position.q >= 35 && c.position.q <= 42).map((c: any) => {
      const index = branch.roadTiles.findIndex((p: any) => p.q === c.position.q && p.r === c.position.r);
      return { position: c.position, targetVisible: visible.has(`${c.position.q},${c.position.r}`),
        missingVisibleHexes: branch.roadTiles.slice(0, index + 1).filter((p: any) => !visible.has(`${p.q},${p.r}`)), reason: c.reasonCode };
    }),
    recordedPreview: transcript.filter(r => r.line?.revision === revision && r.line?.kind === 'preview-result' && r.line?.action?.type === 'RelocateCheckpoint').map(r => r.line),
    nextDecision: trace.find(r => r.decision === revision + 1),
  };
});
const rejectedMoves = trace.filter(r => r.inputAction?.type === 'Move' && !r.accepted).map(record => {
  const { document } = publicAt(record.decision - 1);
  const unit = document.observation.units.find((u: any) => u.id === record.inputAction.unitId);
  const routeQueries = transcript.filter(r => r.line?.revision === record.decision - 1 && r.line?.target === 'route').map(r => r.line);
  return { decision: record.decision, turn: record.turn, action: record.inputAction, error: record.error,
    positionBefore: unit?.position, alreadyAtDestination: JSON.stringify(unit?.position) === JSON.stringify(record.inputAction.destination),
    recordedRouteQueries: routeQueries };
});
writeFileSync('validation/v167-recording.json', JSON.stringify({ source: directory, method: 'Lossless reconstruction of recorded public document; no old State loaded into v1.6.7.', reports, rejectedMoves }, null, 2));
console.log(JSON.stringify(reports.map(({ revision, turn, candidates, recordedPreview, nextDecision }) => ({ revision, turn, candidates, previewCount: recordedPreview.length, nextAction: nextDecision?.inputAction })), null, 2));
