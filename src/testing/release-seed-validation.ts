import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { replayArtifact } from '../agent/runner';
import type { AgentRunArtifact } from '../agent/types';
import type { SimulationReport } from '../agent/sim-cli';
import { validateReleaseSeedCoverage, validateReleaseSeedReport } from './release-seed-report';

const [mode, input, agent, startText, countText] = process.argv.slice(2);
try {
  if (mode === 'aggregate' && input) {
    const root = resolve(input);
    const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory());
    const reports = directories.map(entry => {
      const directory = join(root, entry.name);
      const report = JSON.parse(readFileSync(join(directory, 'run.json'), 'utf8')) as SimulationReport;
      const replay = JSON.parse(readFileSync(join(directory, 'replay-validation.json'), 'utf8'));
      if (replay.agent !== report.execution.agents[0] || JSON.stringify(replay.seeds) !== JSON.stringify(report.execution.seeds)
        || replay.replayed !== report.games.length) throw new Error(`Replay verification missing for ${entry.name}`);
      return report;
    });
    const result = validateReleaseSeedCoverage(reports);
    writeFileSync(join(root, 'release-summary.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } else if (mode === 'shard' && input && ['random', 'balanced'].includes(agent ?? '')) {
    const start = Number(startText), count = Number(countText);
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(count) || count < 1 || start + count > 101) throw new Error('Invalid seed range');
    const reportPath = resolve(input);
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SimulationReport;
    validateReleaseSeedReport(report, agent!, start, count);
    const output = dirname(reportPath);
    const paths = readdirSync(join(output, 'games')).filter(name => name.endsWith('.json')).sort();
    if (paths.length !== count) throw new Error(`Expected ${count} replay artifacts, got ${paths.length}`);
    for (const [index, name] of paths.entries()) {
      const artifact = JSON.parse(readFileSync(join(output, 'games', name), 'utf8')) as AgentRunArtifact;
      if (artifact.artifactType !== 'replay' || artifact.agent.strategy !== agent || artifact.seed !== start + index) throw new Error(`Artifact metadata mismatch: ${name}`);
      const replay = replayArtifact(artifact);
      if (!replay.reproduced || replay.error !== null) throw new Error(`Replay mismatch: ${name}: ${JSON.stringify(replay)}`);
      console.log(JSON.stringify({ agent, seed: artifact.seed, replayed: true }));
    }
    writeFileSync(join(output, 'replay-validation.json'), JSON.stringify({ agent, seeds: report.execution.seeds, replayed: paths.length }) + '\n');
  } else {
    throw new Error('Usage: release-seed-validation.ts shard <run.json> <agent> <start> <count> | aggregate <reports-directory>');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
