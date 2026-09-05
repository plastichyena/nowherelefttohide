import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';
import { SessionService } from './service';
import { SessionStore } from './store';
import { SessionError, type SessionCommand } from './types';
import { writeJsonStream, writeJsonToWritable } from '../agent/json-stream';
import { assertSafeOutputPath, createSafePathRoot, ensureSafeOutputDirectory } from './safe-path';

interface ParsedCli {
  command: SessionCommand;
  root: string;
  sessionId?: string;
  newSessionId?: string;
  checkpointId?: string;
  seed?: number;
  checkpointInterval?: number;
  agentId?: string;
  inputPath?: string;
  outputPath?: string;
  queryTarget?: string;
  revision?: number;
  cursor?: string;
  pageSize?: number;
}

export interface SessionCliDependencies {
  createService(root: string): SessionService;
  readStdin(): string;
}

const COMMANDS = new Set<SessionCommand>([
  'new', 'status', 'step', 'save-checkpoint', 'list-checkpoints', 'load-checkpoint', 'query', 'artifact',
]);

function integer(value: string, name: string, minimum: number): number {
  if (!/^-?\d+$/u.test(value)) throw new SessionError('invalid_cli_argument', `${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new SessionError('invalid_cli_argument', `${name} must be >= ${minimum}`);
  return parsed;
}

function readOption(argument: string, name: string, remaining: string[]): string | null {
  if (argument === name) {
    const value = remaining.shift();
    if (!value || value.startsWith('--')) throw new SessionError('invalid_cli_argument', `${name} requires a value`);
    return value;
  }
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
}

export function parseSessionCliArgs(argv: readonly string[]): ParsedCli {
  const remaining = [...argv];
  const command = remaining.shift() as SessionCommand | undefined;
  if (!command || !COMMANDS.has(command)) throw new SessionError('invalid_cli_command', `Expected one of: ${[...COMMANDS].join(', ')}`);
  const parsed: ParsedCli = { command, root: 'output/sessions' };
  while (remaining.length > 0) {
    const argument = remaining.shift()!;
    let value: string | null;
    if ((value = readOption(argument, '--root', remaining)) !== null) parsed.root = value;
    else if ((value = readOption(argument, '--session', remaining)) !== null) parsed.sessionId = value;
    else if ((value = readOption(argument, '--session-id', remaining)) !== null) parsed.sessionId = value;
    else if ((value = readOption(argument, '--new-session-id', remaining)) !== null) parsed.newSessionId = value;
    else if ((value = readOption(argument, '--checkpoint', remaining)) !== null) parsed.checkpointId = value;
    else if ((value = readOption(argument, '--checkpoint-id', remaining)) !== null) parsed.checkpointId = value;
    else if ((value = readOption(argument, '--seed', remaining)) !== null) parsed.seed = integer(value, '--seed', Number.MIN_SAFE_INTEGER);
    else if ((value = readOption(argument, '--checkpoint-interval', remaining)) !== null) parsed.checkpointInterval = integer(value, '--checkpoint-interval', 1);
    else if ((value = readOption(argument, '--agent-id', remaining)) !== null) parsed.agentId = value;
    else if ((value = readOption(argument, '--input', remaining)) !== null) parsed.inputPath = value;
    else if ((value = readOption(argument, '--out', remaining)) !== null) parsed.outputPath = value;
    else if ((value = readOption(argument, '--target', remaining)) !== null) parsed.queryTarget = value;
    else if ((value = readOption(argument, '--revision', remaining)) !== null) parsed.revision = integer(value, '--revision', 0);
    else if ((value = readOption(argument, '--cursor', remaining)) !== null) parsed.cursor = value;
    else if ((value = readOption(argument, '--page-size', remaining)) !== null) parsed.pageSize = integer(value, '--page-size', 1);
    else throw new SessionError('invalid_cli_argument', `Unknown option: ${argument}`);
  }
  if (command !== 'new' && !parsed.sessionId) throw new SessionError('invalid_cli_argument', `${command} requires --session`);
  if (command === 'load-checkpoint' && (!parsed.checkpointId || !parsed.newSessionId)) {
    throw new SessionError('invalid_cli_argument', 'load-checkpoint requires --checkpoint and --new-session-id');
  }
  if (command === 'query' && !parsed.queryTarget) throw new SessionError('invalid_cli_argument', 'query requires --target');
  return parsed;
}

function defaultDependencies(): SessionCliDependencies {
  return {
    createService: (root) => {
      const identity = resolveSessionIdentity();
      return new SessionService(new SessionStore(root), createAgentSessionGameFactory(identity.buildId), identity);
    },
    readStdin: () => readFileSync(0, 'utf8'),
  };
}

function readStepInput(parsed: ParsedCli, dependencies: SessionCliDependencies): unknown {
  const text = parsed.inputPath ? readFileSync(resolve(parsed.inputPath), 'utf8') : dependencies.readStdin();
  if (text.trim().length === 0) throw new SessionError('invalid_step_input', 'step requires JSON from --input or standard input');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new SessionError('invalid_step_input', `step input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readOptionalJsonInput(parsed: ParsedCli, dependencies: SessionCliDependencies): unknown {
  if (!parsed.inputPath) return {};
  const text = readFileSync(resolve(parsed.inputPath), 'utf8');
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new SessionError('invalid_query', `query input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Execute one formal Session command and return its deterministic JSON value. */
export function executeSessionCommand(
  argv: readonly string[],
  dependencies: SessionCliDependencies = defaultDependencies(),
): Record<string, unknown> {
  const parsed = parseSessionCliArgs(argv);
  const service = dependencies.createService(resolve(parsed.root));
  switch (parsed.command) {
    case 'new': {
      const status = service.newSession({
        sessionId: parsed.sessionId,
        seed: parsed.seed,
        checkpointInterval: parsed.checkpointInterval,
        agentId: parsed.agentId,
      });
      return { ok: true, command: parsed.command, ...status };
    }
    case 'status':
      return { ok: true, command: parsed.command, ...service.status(parsed.sessionId!) };
    case 'step': {
      let input: unknown;
      try {
        input = readStepInput(parsed, dependencies);
      } catch (error) {
        const sessionMetrics = service.recordInputFormatRejection(parsed.sessionId!, 'step-json');
        if (error instanceof SessionError) {
          throw new SessionError(error.code, error.message, { sessionMetrics } as never);
        }
        throw error;
      }
      const result = service.step(parsed.sessionId!, input);
      return { ok: true, command: parsed.command, ...result };
    }
    case 'save-checkpoint':
      return { ok: true, command: parsed.command, checkpoint: service.saveCheckpoint(parsed.sessionId!) };
    case 'list-checkpoints':
      return { ok: true, command: parsed.command, checkpoints: service.listCheckpoints(parsed.sessionId!) };
    case 'load-checkpoint':
      return {
        ok: true,
        command: parsed.command,
        ...service.loadCheckpoint(parsed.sessionId!, parsed.checkpointId!, parsed.newSessionId!),
      };
    case 'query': {
      const filters = readOptionalJsonInput(parsed, dependencies);
      if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) throw new SessionError('invalid_query', 'query --input must contain a JSON filter object');
      const result = { ok: true, command: parsed.command, ...service.query(parsed.sessionId!, {
        target: parsed.queryTarget as never,
        expectedRevision: parsed.revision,
        cursor: parsed.cursor,
        pageSize: parsed.pageSize,
        filters: filters as never,
      }) };
      if (!parsed.outputPath) return result;
      const outputPath = resolve(parsed.outputPath);
      let parent = dirname(outputPath);
      while (!existsSync(parent)) parent = dirname(parent);
      const safeRoot = createSafePathRoot(parent);
      ensureSafeOutputDirectory(safeRoot, dirname(outputPath));
      assertSafeOutputPath(safeRoot, outputPath);
      assertSafeOutputPath(safeRoot, `${outputPath}.pending`);
      if (existsSync(outputPath) || existsSync(`${outputPath}.pending`)) throw new SessionError('output_exists', `Refusing to overwrite query output ${outputPath}`);
      writeJsonStream(outputPath, result);
      return { ok: true, command: parsed.command, target: result.target, sessionId: result.sessionId,
        revision: result.revision, count: result.count, total: result.total, hasMore: result.hasMore,
        nextCursor: result.nextCursor, outputPath };
    }
    case 'artifact':
      return { ok: true, command: parsed.command, artifact: service.exportArtifact(parsed.sessionId!, parsed.outputPath ? resolve(parsed.outputPath) : undefined) };
  }
}

export async function runSessionCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const output = executeSessionCommand(argv);
  await writeJsonToWritable(process.stdout, output);
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    process.exitCode = await runSessionCli();
  } catch (error) {
    const payload = error instanceof SessionError
      ? { ok: false, code: error.code, error: error.message, details: error.details }
      : { ok: false, code: 'session_cli_fatal', error: error instanceof Error ? error.message : String(error) };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}
