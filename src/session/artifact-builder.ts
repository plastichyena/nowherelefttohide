import { strToU8, zipSync } from 'fflate';
import { ARTIFACT_SCHEMA_VERSION } from '../agent/types';
import type { AiSessionPublicArtifact } from './ai-session-contract';
import { canonicalAiSessionJson, sha256AiSessionJson } from './ai-session';

export interface AiSessionArtifactManifest {
  artifactSchemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  packageType: 'nlth-ai-session-public-zip';
  sessionId: string;
  generation: number;
  revision: number;
  decisionCount: number;
  artifactPayloadHash: string;
  entries: readonly ['manifest.json', 'artifact.json'];
}

export interface AiSessionArtifactPackage {
  readonly manifest: Readonly<AiSessionArtifactManifest>;
  readonly bytes: Uint8Array;
  readonly suggestedFileName: string;
}

export interface AiSessionArtifactSink<T = void> {
  deliver(pkg: AiSessionArtifactPackage): T;
}

/** Build canonical bytes without assuming a browser, filesystem, network, or upload target. */
export function buildAiSessionArtifactPackage(artifact: AiSessionPublicArtifact): AiSessionArtifactPackage {
  const artifactJson = canonicalAiSessionJson(artifact);
  const manifest = Object.freeze({
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    packageType: 'nlth-ai-session-public-zip' as const,
    sessionId: artifact.context.sessionId,
    generation: artifact.context.generation,
    revision: artifact.context.revision,
    decisionCount: artifact.decisions.length,
    artifactPayloadHash: sha256AiSessionJson(artifact),
    entries: ['manifest.json', 'artifact.json'] as const,
  });
  const bytes = zipSync({
    'manifest.json': strToU8(canonicalAiSessionJson(manifest)),
    'artifact.json': strToU8(artifactJson),
  }, { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') });
  return Object.freeze({ manifest, bytes, suggestedFileName: `nlth-${artifact.context.sessionId}-r${artifact.context.revision}.zip` });
}

export class MemoryArtifactSink implements AiSessionArtifactSink<Uint8Array> {
  public delivered: AiSessionArtifactPackage | null = null;
  public deliver(pkg: AiSessionArtifactPackage): Uint8Array {
    this.delivered = pkg;
    return pkg.bytes;
  }
}

export class BrowserDownloadArtifactSink implements AiSessionArtifactSink<void> {
  public deliver(pkg: AiSessionArtifactPackage): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') throw new Error('Browser download is unavailable');
    const blob = new Blob([pkg.bytes as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = pkg.suggestedFileName;
    anchor.rel = 'noopener';
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }
}
