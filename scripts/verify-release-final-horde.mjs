import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function main(argv) {
  const [input] = argv;
  if (!input || argv.length !== 1) {
    throw new Error('Usage: node scripts/verify-release-final-horde.mjs <run.json>');
  }
  const reportPath = resolve(input);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report.games) || report.games.length === 0) {
    throw new Error(`Release report ${reportPath} has no game metrics`);
  }
  const reached = report.games.filter((game) => (
    typeof game === 'object'
    && game !== null
    && typeof game.finalHordeSpawned === 'number'
    && game.finalHordeSpawned > 0
    && typeof game.finalTurn === 'number'
    && game.finalTurn > 50
  ));
  if (reached.length === 0) {
    throw new Error('No Balanced run reached a spawned Final Horde and continued past turn 50');
  }
  process.stdout.write(JSON.stringify({ report: reportPath, games: report.games.length, finalHordeReachableRuns: reached.length }) + '\n');
}

try { main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}