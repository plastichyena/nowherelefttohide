import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_OUTPUT = 'dist/portable/session-cli.mjs';

function outputPath(argumentsList) {
  const prefix = '--out=';
  const inline = argumentsList.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const outIndex = argumentsList.indexOf('--out');
  if (outIndex === -1) return DEFAULT_OUTPUT;
  const value = argumentsList[outIndex + 1];
  if (!value || value.startsWith('--')) throw new Error('--out requires a file path');
  return value;
}

/**
 * Build the Session CLI once for the portable package.  A portable player
 * invokes the resulting ESM file directly with its bundled Node runtime, so
 * each `step` process never starts Vite or transforms TypeScript at runtime.
 */
async function main() {
  const output = resolve(outputPath(process.argv.slice(2)));
  mkdirSync(dirname(output), { recursive: true });
  await build({
    entryPoints: [resolve('src/session/session-cli.ts')],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    external: ['node:*'],
  });
  process.stdout.write(`${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
