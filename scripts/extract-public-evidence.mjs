import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const types = new Set(['infection_suppressed','facility_recovered','workers_assigned','population_transferred']);
/** Public responses only. Query legality is explicitly distinguished from execution. */
export function extractEvidence(entry, source, lineNumber) {
  const response = entry.line ?? entry;
  if (!response || typeof response !== 'object') return [];
  if (response.target === 'history' && Array.isArray(response.items)) {
    return response.items.flatMap(record => extractEvidence(record, source, lineNumber));
  }
  const record = response.record ?? response;
  const revision = response.originalRevision ?? response.revision ?? record.revision ?? record.decision ?? null;
  const reference = { source, lineNumber, revision, requestId: response.requestId ?? record.requestId ?? null };
  if (response.kind === 'query-result' && response.target === 'population-transfers') {
    return (response.items ?? []).filter(p=>p.legal).map(p=>({ ...reference, kind:'query-legality', executed:false, turn:null, eventId:null, fromFacilityId:p.fromFacilityId,toFacilityId:p.toFacilityId,min:p.min,max:p.max }));
  }
  if (record.accepted !== true) return [];
  return (record.events ?? []).filter(e=>types.has(e.type)).map(e=>({ ...reference, kind:'observed-execution', executed:true, turn:e.turn,eventId:e.id,type:e.type,payload:e.payload }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source=process.argv[2];if(!source)throw new Error('Usage: node scripts/extract-public-evidence.mjs public-transcript.jsonl');
  let line=0;
  for await(const text of createInterface({input:createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity})) {
    line++;if(!text.trim())continue;
    for(const evidence of extractEvidence(JSON.parse(text),source,line))process.stdout.write(JSON.stringify(evidence)+'\n');
  }
}
