import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloneConfig, createDefaultConfig } from '../core/config';
import { createHeadlessGame } from '../core/headless';
import type { DeepPartial, GameConfig } from '../core/types';
import {
  replayFailure,
  runRandomGames,
  type HeadlessGameFactory,
  type RandomAgentFailure,
  type RandomAgentOptions,
} from './randomAgent';

interface ParsedArguments extends RandomAgentOptions {
  configPath?: string;
  failureFile: string;
  replayPath?: string;
  quiet: boolean;
  help: boolean;
}

function usage(): string {
  return `Usage: npm run test:random -- [options]

Options:
  --games=N              Number of distinct games (default: 100)
  --seed=N               First seed; subsequent games use seed + index
  --seeds=N,M,...        Explicit seed list (overrides --games/--seed)
  --config=PATH          JSON Config overrides for each new game
  --maxActions=N         Per-turn Action limit before forcing EndTurn (default: Config/100)
  --maxTurns=N           Turn safety limit (default: max(Config.maxTurns, 100))
  --maxGameActions=N     Whole-game Action safety limit
  --failure-file=PATH    Failure artifact path (default: random-agent-failures.json)
  --replay=PATH          Replay the first failure from a failure artifact
  --stop-on-failure      Stop after the first failed game
  --quiet                Suppress the success summary
  --help                 Show this help
`;
}

function parseInteger(value: string, name: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

function optionValue(argument: string, name: string, rest: string[]): string {
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  const next = rest.shift();
  if (!next || next.startsWith('--')) throw new Error(`${name} requires a value`);
  return next;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = { failureFile: 'random-agent-failures.json', quiet: false, help: false };
  // npm 11 treats unknown `--foo=value` arguments as npm config keys before
  // invoking a package script. Read those keys as a fallback so local usage
  // through `npm run test:random -- --games=...` remains configurable on both
  // npm and direct vite-node invocations. Explicit argv values below win.
  const npmConfig = (name: string): string | undefined =>
    process.env[`npm_config_${name}`] ?? process.env[`npm_config_${name.toLowerCase()}`];
  const envGames = npmConfig('games');
  const envSeed = npmConfig('seed');
  const envSeeds = npmConfig('seeds');
  const envConfig = npmConfig('config');
  const envMaxActions = npmConfig('maxactions');
  const envMaxTurns = npmConfig('maxturns');
  const envMaxGameActions = npmConfig('maxgameactions');
  const envFailureFile = npmConfig('failure-file') ?? npmConfig('failure_file');
  const envReplay = npmConfig('replay');
  if (envGames !== undefined) parsed.games = parseInteger(envGames, '--games');
  if (envSeed !== undefined) parsed.seed = parseInteger(envSeed, '--seed');
  if (envSeeds !== undefined) parsed.seeds = envSeeds.split(',').filter(Boolean).map((item) => parseInteger(item, '--seeds'));
  if (envConfig !== undefined) parsed.configPath = envConfig;
  if (envMaxActions !== undefined) parsed.maxActionsPerTurn = parseInteger(envMaxActions, '--maxActions');
  if (envMaxTurns !== undefined) parsed.maxTurns = parseInteger(envMaxTurns, '--maxTurns');
  if (envMaxGameActions !== undefined) parsed.maxGameActions = parseInteger(envMaxGameActions, '--maxGameActions');
  if (envFailureFile !== undefined) parsed.failureFile = envFailureFile;
  if (envReplay !== undefined) parsed.replayPath = envReplay;
  const rest = [...argv];
  while (rest.length > 0) {
    const argument = rest.shift()!;
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (argument === '--stop-on-failure') {
      parsed.stopOnFailure = true;
    } else if (argument === '--quiet') {
      parsed.quiet = true;
    } else if (argument === '--games' || argument.startsWith('--games=')) {
      parsed.games = parseInteger(optionValue(argument, '--games', rest), '--games');
    } else if (argument === '--seed' || argument.startsWith('--seed=')) {
      parsed.seed = parseInteger(optionValue(argument, '--seed', rest), '--seed');
    } else if (argument === '--seeds' || argument.startsWith('--seeds=')) {
      const value = optionValue(argument, '--seeds', rest);
      parsed.seeds = value.split(',').filter((item) => item.length > 0).map((item) => parseInteger(item, '--seeds'));
    } else if (argument === '--config' || argument.startsWith('--config=')) {
      parsed.configPath = optionValue(argument, '--config', rest);
    } else if (argument === '--maxActions' || argument.startsWith('--maxActions=')) {
      parsed.maxActionsPerTurn = parseInteger(optionValue(argument, '--maxActions', rest), '--maxActions');
    } else if (argument === '--maxTurns' || argument.startsWith('--maxTurns=')) {
      parsed.maxTurns = parseInteger(optionValue(argument, '--maxTurns', rest), '--maxTurns');
    } else if (argument === '--maxGameActions' || argument.startsWith('--maxGameActions=')) {
      parsed.maxGameActions = parseInteger(optionValue(argument, '--maxGameActions', rest), '--maxGameActions');
    } else if (argument === '--failure-file' || argument.startsWith('--failure-file=')) {
      parsed.failureFile = optionValue(argument, '--failure-file', rest);
    } else if (argument === '--replay' || argument.startsWith('--replay=')) {
      parsed.replayPath = optionValue(argument, '--replay', rest);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return parsed;
}

function loadConfig(configPath: string | undefined): GameConfig {
  if (!configPath) return createDefaultConfig();
  const raw = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as DeepPartial<GameConfig>;
  return createDefaultConfig(raw);
}

function readFailure(path: string): RandomAgentFailure {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as { failures?: RandomAgentFailure[] } | RandomAgentFailure;
  const envelope = parsed as { failures?: RandomAgentFailure[] };
  if (Array.isArray(envelope.failures)) {
    const failure = envelope.failures[0];
    if (!failure) throw new Error(`No failure artifact found in ${path}`);
    return failure;
  }
  return parsed as RandomAgentFailure;
}

function writeFailureArtifact(path: string, report: unknown): void {
  writeFileSync(resolve(path), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const factory: HeadlessGameFactory = (config, seed) => createHeadlessGame(seed, config);
  if (args.replayPath) {
    const original = readFailure(args.replayPath);
    const replay = replayFailure(factory, original);
    process.stdout.write(`${JSON.stringify(replay, null, 2)}\n`);
    if (!replay.reproduced) process.exitCode = 1;
    return;
  }

  const options: RandomAgentOptions = {
    games: args.games,
    seeds: args.seeds,
    seed: args.seed,
    maxActionsPerTurn: args.maxActionsPerTurn,
    maxTurns: args.maxTurns,
    maxGameActions: args.maxGameActions,
    config: loadConfig(args.configPath),
    stopOnFailure: args.stopOnFailure,
  };
  const report = runRandomGames(factory, options);
  if (!args.quiet || !report.ok) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    writeFailureArtifact(args.failureFile, report);
    process.stderr.write(`Random Agent failures written to ${resolve(args.failureFile)}\n`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
