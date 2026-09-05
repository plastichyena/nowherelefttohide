import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeInputFile,
  assertSafeOutputPath,
  createSafePathRoot,
  ensureSafeOutputDirectory,
} from './safe-path';
import { SessionError } from './types';

function root(name: string): string { return mkdtempSync(join(tmpdir(), `nlth-safe-path-${name}-`)); }

function expectUnsafe(operation: () => unknown): void {
  try { operation(); }
  catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).code).toBe('unsafe_path');
    return;
  }
  throw new Error('Expected unsafe path rejection');
}

function linkOrUnavailable(target: string, path: string, type: 'file' | 'dir'): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (error) {
    // Windows hosts without Developer Mode or elevated symlink privilege cannot
    // create this fixture. Linux release CI must execute the rejection branch.
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

describe('Session safe path boundaries', () => {
  it('accepts ordinary rooted input and output paths', () => {
    const path = root('ordinary');
    const nested = join(path, 'payloads');
    mkdirSync(nested);
    const input = join(nested, 'record.json');
    writeFileSync(input, '{}\n', 'utf8');
    const safeRoot = createSafePathRoot(path);
    expect(assertSafeInputFile(safeRoot, input)).toBe(input);
    expect(ensureSafeOutputDirectory(safeRoot, 'artifacts/run.nlth-artifact')).toBe(join(path, 'artifacts', 'run.nlth-artifact'));
    expect(assertSafeOutputPath(safeRoot, 'artifacts/run.nlth-artifact/manifest.json')).toBe(join(path, 'artifacts', 'run.nlth-artifact', 'manifest.json'));
  });

  it('rejects absolute and traversal input outside the Session root', () => {
    const path = root('outside');
    const external = root('external');
    const externalFile = join(external, 'record.json');
    writeFileSync(externalFile, '{}\n', 'utf8');
    const safeRoot = createSafePathRoot(path);
    expectUnsafe(() => assertSafeInputFile(safeRoot, externalFile));
    expectUnsafe(() => assertSafeOutputPath(safeRoot, '../outside.json'));
  });

  it('rejects files and parent directories that are external links', () => {
    const path = root('links');
    const external = root('external');
    const externalFile = join(external, 'record.json');
    writeFileSync(externalFile, '{}\n', 'utf8');
    const fileLink = join(path, 'file-link.json');
    const directoryLink = join(path, 'directory-link');
    const fileReady = linkOrUnavailable(externalFile, fileLink, 'file');
    const directoryReady = linkOrUnavailable(external, directoryLink, 'dir');
    if (!fileReady || !directoryReady) return;
    const safeRoot = createSafePathRoot(path);
    expectUnsafe(() => assertSafeInputFile(safeRoot, fileLink));
    expectUnsafe(() => assertSafeInputFile(safeRoot, join(directoryLink, 'record.json')));
  });
});