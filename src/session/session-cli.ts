import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import type { Writable } from 'node:stream';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';
import { SessionService } from './service';
import { SessionStore } from './store';
import {
  DEFAULT_PLAY_TURN_IDLE_TIMEOUT_MS,
  MAX_PLAY_TURN_LINE_BYTES,
  MAX_PLAY_TURN_PLAN_BYTES,
  MAX_PLAY_TURN_REQUESTS,
  PLAY_TURN_PROTOCOL_VERSION,
  SessionError,
  type SessionCommand,
  type SessionPlayTurnRequest,
} from './types';
import { SESSION_PLAY_TURN_CAPABILITIES } from './service';
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
  idleTimeoutMs?: number;
}

export interface SessionCliDependencies {
  createService(root: string): SessionService;
  readStdin(): string;
}

const COMMANDS = new Set<SessionCommand>([
  'new', 'status', 'step', 'play-turn', 'save-checkpoint', 'list-checkpoints', 'load-checkpoint', 'query', 'artifact',
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
    else if ((value = readOption(argument, '--idle-timeout-ms', remaining)) !== null) parsed.idleTimeoutMs = integer(value, '--idle-timeout-ms', 100);
    else throw new SessionError('invalid_cli_argument', `Unknown option: ${argument}`);
  }
  if (command !== 'new' && !parsed.sessionId) throw new SessionError('invalid_cli_argument', `${command} requires --session`);
  if (command === 'load-checkpoint' && (!parsed.checkpointId || !parsed.newSessionId)) {
    throw new SessionError('invalid_cli_argument', 'load-checkpoint requires --checkpoint and --new-session-id');
  }
  if (command === 'query' && !parsed.queryTarget) throw new SessionError('invalid_cli_argument', 'query requires --target');
  if (command !== 'play-turn' && parsed.idleTimeoutMs !== undefined) throw new SessionError('invalid_cli_argument', '--idle-timeout-ms is only valid for play-turn');
  if (parsed.idleTimeoutMs !== undefined && parsed.idleTimeoutMs > 60 * 60 * 1000) throw new SessionError('invalid_cli_argument', '--idle-timeout-ms must be <= 3600000');
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

function readBoundedJsonFile(path: string, code: string): unknown {
  const absolute = resolve(path);
  const fd = openSync(absolute, 'r');
  let text: string;
  try {
    if (fstatSync(fd).size > MAX_PLAY_TURN_PLAN_BYTES) throw new SessionError(code, `play-turn input exceeds ${MAX_PLAY_TURN_PLAN_BYTES} bytes`);
    const bytes = Buffer.allocUnsafe(MAX_PLAY_TURN_PLAN_BYTES + 1);
    let offset = 0;
    while (offset <= MAX_PLAY_TURN_PLAN_BYTES) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > MAX_PLAY_TURN_PLAN_BYTES) throw new SessionError(code, `play-turn input exceeds ${MAX_PLAY_TURN_PLAN_BYTES} bytes`);
    text = bytes.subarray(0, offset).toString('utf8');
  } finally { closeSync(fd); }
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new SessionError(code, `play-turn input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

export function sessionCliHelp(): Record<string, unknown> {
  return {
    ok: true,
    usage: 'run-session.sh COMMAND [options]',
    commands: [...COMMANDS],
    playTurn: {
      ...SESSION_PLAY_TURN_CAPABILITIES,
      examples: {
        interactive: './run-session.sh play-turn --session=my-game',
        finitePlan: './run-session.sh play-turn --session=my-game --input=turn-plan.json',
      },
    },
  };
}

/** Execute one formal Session command and return its deterministic JSON value. */
export function executeSessionCommand(
  argv: readonly string[],
  dependencies: SessionCliDependencies = defaultDependencies(),
): Record<string, unknown> {
  if (argv.length === 0 || argv.includes('--help')) return sessionCliHelp();
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
    case 'play-turn': {
      if (!parsed.inputPath) throw new SessionError('interactive_play_turn_required', 'play-turn without --input uses the interactive JSONL runner');
      const result = service.playTurnPlan(parsed.sessionId!, readBoundedJsonFile(parsed.inputPath, 'invalid_play_turn_input'));
      return { ok: true, command: parsed.command, protocolVersion: PLAY_TURN_PROTOCOL_VERSION, ...result };
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

type AsyncChunkIterator = AsyncIterator<string | Buffer | Uint8Array>;

async function nextChunk(iterator: AsyncChunkIterator, timeoutMs: number): Promise<{ timedOut: true } | { timedOut: false; value: IteratorResult<string | Buffer | Uint8Array> }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); timer.unref?.(); });
  const next = iterator.next().then((value) => ({ timedOut: false as const, value }));
  const result = await Promise.race([next, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

function publicError(error: unknown): Record<string, unknown> {
  return error instanceof SessionError
    ? { ok: false, code: error.code, error: error.message, details: error.details }
    : { ok: false, code: 'session_cli_fatal', error: error instanceof Error ? error.message : String(error) };
}

export async function runInteractivePlayTurn(
  service: SessionService,
  sessionId: string,
  input: AsyncIterable<string | Buffer | Uint8Array>,
  output: Writable,
  idleTimeoutMs = DEFAULT_PLAY_TURN_IDLE_TIMEOUT_MS,
): Promise<'successful_end_turn' | 'game_over' | 'explicit_close' | 'eof' | 'idle_timeout' | 'request_limit'> {
  const turn = service.beginPlayTurn(sessionId);
  const decoder = new StringDecoder('utf8');
  const iterator = input[Symbol.asyncIterator]();
  let pending = '';
  let requests = 0;
  let exitReason: 'successful_end_turn' | 'game_over' | 'explicit_close' | 'eof' | 'idle_timeout' | 'request_limit' | null = null;
  const writeClosed = async (reason: NonNullable<typeof exitReason>): Promise<void> => {
    const status = service.playTurnStatus(sessionId);
    await writeJsonToWritable(output, { ok: true, command: 'play-turn', kind: 'closed', protocolVersion: PLAY_TURN_PROTOCOL_VERSION, reason, sessionId, revision: status.revision, turn: status.observation.turn, observation: status.observation, gameOver: status.gameOver, result: status.result });
  };
  const handleLine = async (line: string): Promise<void> => {
    if (Buffer.byteLength(line, 'utf8') > MAX_PLAY_TURN_LINE_BYTES) throw new SessionError('play_turn_line_too_large', `play-turn line exceeds ${MAX_PLAY_TURN_LINE_BYTES} bytes`);
    if (line.trim().length === 0) return;
    requests += 1;
    if (requests > MAX_PLAY_TURN_REQUESTS) { exitReason = 'request_limit'; return; }
    let request: unknown;
    try { request = JSON.parse(line) as unknown; }
    catch (error) {
      service.recordInputFormatRejection(sessionId, 'play-turn-jsonl');
      await writeJsonToWritable(output, publicError(new SessionError('invalid_play_turn_json', `play-turn line is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)));
      return;
    }
    if (request === null || typeof request !== 'object' || Array.isArray(request)) {
      await writeJsonToWritable(output, publicError(new SessionError('invalid_play_turn_input', 'play-turn request must be a JSON object')));
      return;
    }
    const typed = request as SessionPlayTurnRequest;
    try {
      if (typed.type === 'action') {
        const result = service.playTurnAction(sessionId, typed);
        await writeJsonToWritable(output, { ok: true, command: 'play-turn', protocolVersion: PLAY_TURN_PROTOCOL_VERSION, ...result });
        if (result.stopReason === 'end_turn_completed') exitReason = 'successful_end_turn';
        else if (result.stopReason === 'game_over') exitReason = 'game_over';
      } else if (typed.type === 'query') {
        const queryObject = typed as unknown as Record<string, unknown>;
        if (Object.keys(queryObject).some((key) => !['type', 'target', 'expectedRevision', 'cursor', 'pageSize', 'filters'].includes(key))) throw new SessionError('invalid_play_turn_input', 'query request contains an unknown field');
        if (typed.expectedRevision !== undefined && (!Number.isSafeInteger(typed.expectedRevision) || typed.expectedRevision < 0)) throw new SessionError('invalid_play_turn_input', 'query expectedRevision must be a non-negative integer');
        if (typed.cursor !== undefined && typeof typed.cursor !== 'string') throw new SessionError('invalid_play_turn_input', 'query cursor must be a string');
        if (typed.filters !== undefined && (typed.filters === null || typeof typed.filters !== 'object' || Array.isArray(typed.filters))) throw new SessionError('invalid_play_turn_input', 'query filters must be an object');
        const result = service.query(sessionId, { target: typed.target, expectedRevision: typed.expectedRevision, cursor: typed.cursor, pageSize: typed.pageSize, filters: typed.filters });
        await writeJsonToWritable(output, { ok: true, command: 'play-turn', kind: 'query-result', protocolVersion: PLAY_TURN_PROTOCOL_VERSION, ...result });
      } else if (typed.type === 'close') {
        if (Object.keys(typed as unknown as Record<string, unknown>).length !== 1) throw new SessionError('invalid_play_turn_input', 'close request may contain only type');
        exitReason = 'explicit_close';
      } else throw new SessionError('invalid_play_turn_input', 'play-turn request type must be action, query, or close');
    } catch (error) {
      await writeJsonToWritable(output, publicError(error));
    }
  };
  try {
    await writeJsonToWritable(output, { ok: true, command: 'play-turn', kind: 'start', protocolVersion: PLAY_TURN_PROTOCOL_VERSION, sessionId, startRevision: turn.startRevision, startTurn: turn.startTurn, observation: turn.status.observation, gameOver: turn.status.gameOver, result: turn.status.result, capabilities: SESSION_PLAY_TURN_CAPABILITIES });
    while (!exitReason) {
      const next = await nextChunk(iterator, idleTimeoutMs);
      if (next.timedOut) { exitReason = 'idle_timeout'; break; }
      if (next.value.done) {
        pending += decoder.end();
        if (pending.trim().length > 0) await handleLine(pending.replace(/\r$/u, ''));
        if (!exitReason) exitReason = 'eof';
        break;
      }
      pending += decoder.write(Buffer.from(next.value.value));
      if (Buffer.byteLength(pending, 'utf8') > MAX_PLAY_TURN_LINE_BYTES && !pending.includes('\n')) throw new SessionError('play_turn_line_too_large', `play-turn line exceeds ${MAX_PLAY_TURN_LINE_BYTES} bytes`);
      let newline: number;
      while (!exitReason && (newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '');
        pending = pending.slice(newline + 1);
        await handleLine(line);
      }
    }
    await writeClosed(exitReason!);
    return exitReason!;
  } finally {
    await iterator.return?.();
    turn.close();
  }
}

export async function runSessionCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (!argv.includes('--help') && argv.length > 0 && argv[0] === 'play-turn') {
    const parsed = parseSessionCliArgs(argv);
    const dependencies = defaultDependencies();
    const service = dependencies.createService(resolve(parsed.root));
    if (parsed.inputPath) {
      const result = await service.playTurnPlanAsync(parsed.sessionId!, readBoundedJsonFile(parsed.inputPath, 'invalid_play_turn_input'));
      await writeJsonToWritable(process.stdout, { ok: true, command: 'play-turn', protocolVersion: PLAY_TURN_PROTOCOL_VERSION, ...result });
    } else {
      await runInteractivePlayTurn(service, parsed.sessionId!, process.stdin, process.stdout, parsed.idleTimeoutMs);
      process.stdin.pause();
    }
    return 0;
  }
  const result = executeSessionCommand(argv);
  await writeJsonToWritable(process.stdout, result);
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    process.exitCode = await runSessionCli();
  } catch (error) {
    const payload = publicError(error);
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}
