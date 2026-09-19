import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = resolve(root, 'dist/portable/session-cli.mjs');
function currentBundle() {
  if (!existsSync(bundle)) return false;
  try {
    const inputs = JSON.parse(readFileSync(`${bundle}.inputs.json`, 'utf8'));
    return inputs.length > 0 && inputs.every(input => {
      const current = statSync(input.path);
      return current.mtimeMs === input.mtimeMs && current.size === input.size;
    });
  } catch { return false; }
}

if (!currentBundle()) {
  const built = spawnSync(process.execPath, ['scripts/build-portable.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (built.error || built.status !== 0) {
    process.stderr.write(built.error?.message ?? built.stderr);
    process.exit(built.status || 1);
  }
  process.stderr.write('Session CLI bundle built.\n');
}
const child = spawn(process.execPath, [bundle, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
