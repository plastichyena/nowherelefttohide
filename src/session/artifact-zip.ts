import { Zip, ZipPassThrough } from 'fflate';
import { closeSync, openSync, readSync, readdirSync, writeSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createSafePathRoot, assertSafeInputFile, assertSafeOutputPath } from './safe-path';

/** Internal payloads are already gzip compressed. Store entries without recompressing or buffering the package. */
export function writeArtifactZip(directory: string, output: string): void {
  const root = createSafePathRoot(directory);
  const fd = openSync(assertSafeOutputPath(createSafePathRoot(join(output, '..')), output), 'wx');
  try {
    const zip = new Zip((error, data) => { if (error) throw error; writeSync(fd, data); });
    const visit = (dir: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, item.name);
        if (item.isSymbolicLink()) throw new Error('Artifact ZIP cannot contain symbolic links');
        if (item.isDirectory()) { visit(path); continue; }
        const entry = new ZipPassThrough(relative(directory, path).replaceAll('\\', '/'));
        zip.add(entry);
        const input = openSync(assertSafeInputFile(root, path), 'r');
        try { const buffer = Buffer.alloc(1024 * 1024); let count: number; while ((count = readSync(input, buffer)) > 0) entry.push(buffer.subarray(0, count)); entry.push(new Uint8Array(), true); }
        finally { closeSync(input); }
      }
    };
    visit(directory); zip.end();
  } finally { closeSync(fd); }
}
