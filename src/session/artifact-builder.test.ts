import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createAiSession } from './ai-session';
import { buildAiSessionArtifactPackage, MemoryArtifactSink } from './artifact-builder';

describe('v1.6 canonical AI Session artifact builder', () => {
  it('delivers one unchanged deterministic byte sequence and manifest to a memory sink', () => {
    const session = createAiSession({ initial: { seed: 16 }, preferredCommentLocale: 'ja' });
    const context = session.getContext();
    const legal = session.getLegalActions({ generation: context.generation, baseRevision: context.revision });
    if (!legal.ok) throw new Error(legal.error.message);
    const action = legal.actions[0]!;
    const acted = session.act({ generation: 1, baseRevision: 0, requestId: 'artifact-1', action, decisionSummary: '公開情報からこの行動を選びます。' });
    expect(acted.ok).toBe(true);
    const built = session.buildPublicArtifact();
    if (!built.ok) throw new Error(built.error.message);
    const first = buildAiSessionArtifactPackage(built.artifact);
    const second = buildAiSessionArtifactPackage(built.artifact);
    expect(first.bytes).toEqual(second.bytes);
    const sink = new MemoryArtifactSink();
    expect(sink.deliver(first)).toBe(first.bytes);
    expect(sink.delivered?.manifest).toBe(first.manifest);
    const entries = unzipSync(first.bytes);
    expect(Object.keys(entries).sort()).toEqual(['artifact.json', 'manifest.json']);
    const artifact = JSON.parse(strFromU8(entries['artifact.json']!));
    expect(artifact.decisions[0]).toMatchObject({ decisionSummary: '公開情報からこの行動を選びます。', requestedCommentLocale: 'ja' });
    expect(JSON.parse(strFromU8(entries['manifest.json']!))).toEqual(first.manifest);
  });
});
