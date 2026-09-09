import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionStore } from '../session/store';
import type { SessionPayloadReference } from '../session/types';

/** Physical public chunks that exportArtifact copies, counted once per hash.
 * Excludes private checkpoints, unused pool data and logical expanded bytes.
 * Manifest, references and stream bytes make the final Package larger.
 */
export function artifactPayloadBytes(store: SessionStore, sessionId: string): number {
  const loaded = store.load(sessionId);
  const seen = new Set<string>();
  let bytes = 0;
  const add = (reference: SessionPayloadReference): void => {
    if (reference.domain !== 'public') throw new Error('Release Artifact references a private payload');
    for (const chunk of reference.chunks) {
      if (seen.has(chunk.hash)) continue;
      seen.add(chunk.hash);
      const path = join(store.sessionsRoot, 'pool', 'public', 'chunks', chunk.hash.slice(0, 2), `${chunk.hash}.gz`);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== chunk.compressedBytes) {
        throw new Error(`Invalid physical Artifact chunk: ${chunk.hash}`);
      }
      bytes += stat.size;
    }
  };
  add(loaded.runBase.fixedMap);
  add(loaded.runBase.initialPublicState);
  for (const record of store.iterateAllDecisionRecords(sessionId)) add(record.publicPayload);
  return bytes;
}
