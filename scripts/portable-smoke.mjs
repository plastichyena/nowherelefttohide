import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

/**
 * Checkout-side verification driver for a Player package.
 *
 * This file intentionally imports no game source. It invokes the package's
 * Session launcher as an external process, so a clean Player package is
 * tested without putting development dependencies back into that package.
 */

const COMMANDS = ['new', 'status', 'step', 'play-turn', 'save-checkpoint', 'list-checkpoints', 'load-checkpoint', 'query', 'artifact'];
const MAX_DECISIONS = 200;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function optionValue(argv, name, defaultValue = undefined) {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0) return defaultValue;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function parseSeeds(value) {
  const raw = String(value ?? '1,7').split(',').map((item) => item.trim()).filter(Boolean);
  if (raw.length === 0) fail('--seeds requires at least one integer');
  const seeds = raw.map((item) => {
    if (!/^-?\d+$/u.test(item)) fail(`Invalid seed: ${item}`);
    const seed = Number(item);
    if (!Number.isSafeInteger(seed)) fail(`Seed is not a safe integer: ${item}`);
    return seed;
  });
  return [...new Set(seeds)];
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} did not return JSON: ${error instanceof Error ? error.message : String(error)}\n${text.slice(0, 2000)}`);
  }
}

function parseJsonLines(text, label) {
  return text.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line, index) => parseJson(line, `${label} line ${index + 1}`));
}

function packageInvocation(launcher) {
  const packageRoot = dirname(launcher);
  const windowsPackage = launcher.toLowerCase().endsWith('.cmd');
  const executable = join(packageRoot, 'runtime', 'node', windowsPackage ? 'node.exe' : 'node');
  const cli = join(packageRoot, 'session-cli.mjs');
  if (!existsSync(executable) || !existsSync(cli)) return null;
  const buildInfo = existsSync(join(packageRoot, 'BUILD_INFO.txt')) ? readFileSync(join(packageRoot, 'BUILD_INFO.txt'), 'utf8') : '';
  const commit = buildInfo.match(/^Commit:\s*(\S+)$/mu)?.[1];
  const buildId = buildInfo.match(/^Build ID:\s*(\S+)$/mu)?.[1];
  return { packageRoot, executable, cli, env: { ...process.env, ...(commit ? { NLTH_GIT_COMMIT: commit } : {}), ...(buildId ? { NLTH_BUILD_ID: buildId } : {}) } };
}

function invokeLauncher(launcher, args, { input = undefined, label = args.join(' '), allowFailure = false } = {}) {
  const shell = launcher.toLowerCase().endsWith('.cmd');
  const result = spawnSync(launcher, args, {
    input,
    encoding: 'utf8',
    shell,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0 && !allowFailure) fail(`${label} failed with exit ${String(result.status)}\nstdout: ${stdout.slice(0, 4000)}\nstderr: ${stderr.slice(0, 4000)}`);
  return { status: result.status ?? -1, stdout, stderr };
}

function invoke(launcher, args, { input = undefined, label = args.join(' '), allowFailure = false } = {}) {
  // Once the launcher itself has been smoke-tested, invoke the packaged
  // executable directly for the long driver. This avoids shell-specific
  // command-file buffering and keeps interactive JSONL on one Node process
  // on both operating systems.
  const packageInfo = packageInvocation(launcher);
  const command = packageInfo ? [packageInfo.executable, [packageInfo.cli, ...args], packageInfo.env, packageInfo.packageRoot] : [launcher, args, process.env, undefined];
  const shell = packageInfo ? false : launcher.toLowerCase().endsWith('.cmd');
  const result = spawnSync(command[0], command[1], {
    input,
    encoding: 'utf8',
    env: command[2],
    cwd: command[3],
    shell,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0 && !allowFailure) fail(`${label} failed with exit ${String(result.status)}\nstdout: ${stdout.slice(0, 4000)}\nstderr: ${stderr.slice(0, 4000)}`);
  return { status: result.status ?? -1, stdout, stderr };
}

function invokeJson(launcher, args, options = {}) {
  const result = invoke(launcher, args, options);
  return parseJson(result.stdout.trim(), options.label ?? args.join(' '));
}

function invokeInteractive(launcher, args, requests, label) {
  const input = `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`;
  const result = invoke(launcher, args, { input, label });
  return parseJsonLines(result.stdout, label);
}

function statusView(payload, label) {
  assert(payload && payload.ok === true, `${label} did not return ok=true`);
  assert(typeof payload.sessionId === 'string' || (payload.session && typeof payload.session.sessionId === 'string'), `${label} omitted Session identity`);
  assert(Number.isSafeInteger(payload.revision), `${label} omitted revision`);
  assert(payload.observation && typeof payload.observation === 'object', `${label} omitted Compact observation`);
  return payload;
}

function sessionArgs(root, session) {
  return ['--root', root, '--session', session];
}

function writeUniqueJson(path, value) {
  if (existsSync(path)) fail(`Refusing to overwrite driver input: ${path}`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function fullSnapshot(launcher, root, session, revision) {
  const payload = invokeJson(launcher, ['query', ...sessionArgs(root, session), '--target', 'full-snapshot', '--revision', String(revision), '--page-size', '1'], { label: `query full-snapshot ${session}@${revision}` });
  assert(payload.ok === true && payload.target === 'full-snapshot', `full-snapshot failed for ${session}@${revision}`);
  assert(payload.value && Array.isArray(payload.value.legalActions), `full-snapshot omitted legal actions for ${session}@${revision}`);
  return payload;
}

function endTurnAction(snapshot, label) {
  const action = snapshot.value.legalActions.find((candidate) => candidate && candidate.type === 'EndTurn');
  assert(action, `${label} has no public EndTurn action`);
  return action;
}

function createEndTurnPlan(path, revision, action, requestId, summary) {
  writeUniqueJson(path, {
    expectedRevision: revision,
    actions: [{ action, decisionSummary: summary, requestId }],
  });
}

function assertArtifact(artifactPayload, artifactPath, expectedDecisionCount, label) {
  assert(artifactPayload.ok === true && artifactPayload.artifact, `${label} did not export an Artifact`);
  const manifest = artifactPayload.artifact;
  assert(manifest.decisionCount === expectedDecisionCount, `${label} Artifact decision count differs from Session`);
  assert(manifest.acceptedActionCount === expectedDecisionCount, `${label} Artifact accepted count differs from Session`);
  assert(existsSync(join(artifactPath, 'manifest.json')), `${label} Artifact manifest.json is missing`);
  assert(existsSync(join(artifactPath, 'artifact.ndjson')), `${label} Artifact stream is missing`);
  assert(existsSync(`${artifactPath}.zip`), `${label} Artifact ZIP is missing`);
  return {
    path: artifactPath,
    manifestHash: manifest.manifestHash,
    decisionCount: manifest.decisionCount,
    acceptedActionCount: manifest.acceptedActionCount,
  };
}

function commandSmoke(launcher, root) {
  const launcherHelpResult = invokeLauncher(launcher, ['--help'], { label: 'Session launcher --help' });
  const help = parseJson(launcherHelpResult.stdout.trim(), 'Session launcher --help');
  assert(help.ok === true && Array.isArray(help.commands), 'Session CLI help is not machine-readable');
  for (const command of COMMANDS) assert(help.commands.includes(command), `Session CLI help omitted ${command}`);

  const session = 'portable-command-smoke';
  const created = statusView(invokeJson(launcher, ['new', '--root', root, '--session-id', session, '--seed', '1', '--checkpoint-interval', '1', '--agent-id', 'portable-command-driver'], { label: 'new command smoke' }), 'new command smoke');
  assert(created.revision === 0, 'new command did not start at revision 0');
  statusView(invokeJson(launcher, ['status', ...sessionArgs(root, session)], { label: 'status command smoke' }), 'status command smoke');

  const snapshot = fullSnapshot(launcher, root, session, created.revision);
  const endTurn = endTurnAction(snapshot, 'command smoke');
  const queryFilterPath = join(root, 'command-query-filter.json');
  writeUniqueJson(queryFilterPath, { actionType: 'EndTurn' });
  const filtered = invokeJson(launcher, ['query', ...sessionArgs(root, session), '--target', 'legal-actions', '--revision', String(created.revision), '--input', queryFilterPath, '--page-size', '500'], { label: 'query filter command smoke' });
  assert(filtered.ok === true && filtered.items?.some((candidate) => candidate.type === 'EndTurn'), 'query target filter did not return EndTurn');

  const stepInputPath = join(root, 'command-step-input.json');
  writeUniqueJson(stepInputPath, { action: endTurn, decisionSummary: 'Portable command smoke EndTurn.', expectedRevision: created.revision });
  const stepped = statusView(invokeJson(launcher, ['step', ...sessionArgs(root, session), '--input', stepInputPath], { label: 'step command smoke' }), 'step command smoke');
  assert(stepped.accepted === true && stepped.revision === created.revision + 1, 'step command did not accept EndTurn');
  const resumed = statusView(invokeJson(launcher, ['status', ...sessionArgs(root, session)], { label: 'status resume smoke' }), 'status resume smoke');
  assert(resumed.revision === stepped.revision, 'status did not resume the committed revision');

  const saved = invokeJson(launcher, ['save-checkpoint', ...sessionArgs(root, session)], { label: 'save-checkpoint command smoke' });
  assert(saved.ok === true && saved.checkpoint?.checkpointId, 'save-checkpoint omitted checkpointId');
  const checkpointId = saved.checkpoint.checkpointId;
  const listed = invokeJson(launcher, ['list-checkpoints', ...sessionArgs(root, session)], { label: 'list-checkpoints command smoke' });
  assert(listed.ok === true && listed.checkpoints?.some((item) => item.checkpointId === checkpointId), 'list-checkpoints omitted saved checkpoint');

  const branch = 'portable-command-branch';
  const loaded = statusView(invokeJson(launcher, ['load-checkpoint', ...sessionArgs(root, session), '--checkpoint', checkpointId, '--new-session-id', branch], { label: 'load-checkpoint command smoke' }), 'load-checkpoint command smoke');
  assert(loaded.session?.sessionId === branch || loaded.sessionId === branch, 'load-checkpoint returned the wrong branch Session');
  const branchStatus = statusView(invokeJson(launcher, ['status', ...sessionArgs(root, branch)], { label: 'branch status smoke' }), 'branch status smoke');
  assert(branchStatus.revision === stepped.revision, 'Checkpoint branch did not preserve the checkpoint revision');
  const branchQuery = invokeJson(launcher, ['query', ...sessionArgs(root, branch), '--target', 'api', '--revision', String(branchStatus.revision), '--page-size', '1'], { label: 'branch query smoke' });
  assert(branchQuery.ok === true && branchQuery.target === 'api', 'branch query failed');
  const branchArtifactPath = join(root, 'command-branch-artifact');
  const branchArtifact = assertArtifact(invokeJson(launcher, ['artifact', ...sessionArgs(root, branch), '--out', branchArtifactPath], { label: 'artifact command smoke' }), branchArtifactPath, branchStatus.revision, 'artifact command smoke');

  const finiteSession = 'portable-finite-plan';
  const finiteCreated = statusView(invokeJson(launcher, ['new', '--root', root, '--session', finiteSession, '--seed', '1', '--agent-id', 'portable-finite-driver'], { label: 'finite new smoke' }), 'finite new smoke');
  const finiteAction = endTurnAction(fullSnapshot(launcher, root, finiteSession, finiteCreated.revision), 'finite plan smoke');
  const finitePlanPath = join(root, 'finite-plan.json');
  createEndTurnPlan(finitePlanPath, finiteCreated.revision, finiteAction, 'portable-finite-end-turn', 'Portable finite plan EndTurn.');
  const finite = invokeJson(launcher, ['play-turn', ...sessionArgs(root, finiteSession), '--input', finitePlanPath], { label: 'finite play-turn smoke' });
  assert(finite.ok === true && finite.kind === 'plan-result' && finite.executedIndexes?.length === 1, 'finite play-turn did not execute its plan');
  const finiteResumed = statusView(invokeJson(launcher, ['status', ...sessionArgs(root, finiteSession)], { label: 'finite status resume smoke' }), 'finite status resume smoke');
  assert(finiteResumed.revision === finiteCreated.revision + 1, 'finite play-turn Session did not resume at the next revision');

  const interactiveSession = 'portable-interactive-plan';
  const interactiveCreated = statusView(invokeJson(launcher, ['new', '--root', root, '--session', interactiveSession, '--seed', '1', '--agent-id', 'portable-interactive-driver'], { label: 'interactive new smoke' }), 'interactive new smoke');
  const interactiveAction = endTurnAction(fullSnapshot(launcher, root, interactiveSession, interactiveCreated.revision), 'interactive play-turn smoke');
  const interactiveResponses = invokeInteractive(launcher, ['play-turn', ...sessionArgs(root, interactiveSession)], [
    { type: 'query', target: 'legal-actions', expectedRevision: interactiveCreated.revision, pageSize: 500, filters: { actionType: 'EndTurn' } },
    { type: 'action', action: interactiveAction, decisionSummary: 'Portable interactive EndTurn.', expectedRevision: interactiveCreated.revision, requestId: 'portable-interactive-end-turn' },
  ], 'interactive play-turn smoke');
  assert(interactiveResponses.some((item) => item.kind === 'start'), 'interactive play-turn omitted start');
  assert(interactiveResponses.some((item) => item.kind === 'query-result' && item.target === 'legal-actions'), 'interactive play-turn omitted query result');
  const actionResult = interactiveResponses.find((item) => item.kind === 'action-result');
  assert(actionResult?.accepted === true, 'interactive play-turn did not accept EndTurn');
  const closed = interactiveResponses.at(-1);
  assert(closed?.kind === 'closed' && ['successful_end_turn', 'game_over'].includes(closed.reason), 'interactive play-turn did not close after EndTurn');
  const interactiveResumed = statusView(invokeJson(launcher, ['status', ...sessionArgs(root, interactiveSession)], { label: 'interactive status resume smoke' }), 'interactive status resume smoke');
  assert(interactiveResumed.revision === interactiveCreated.revision + 1, 'interactive play-turn Session did not resume at the next revision');

  return {
    commandCount: COMMANDS.length,
    commands: COMMANDS,
    checkpointId,
    branchArtifact,
    finitePlan: { sessionId: finiteSession, revision: finiteResumed.revision },
    interactive: { sessionId: interactiveSession, revision: interactiveResumed.revision },
  };
}

function runSeed(launcher, root, seed, index) {
  const session = `portable-seed-${String(seed).replaceAll('-', 'n')}-${index}`;
  const agentId = `portable-seed-driver-${String(seed).replaceAll('-', 'n')}-${index}`;
  const created = statusView(invokeJson(launcher, ['new', '--root', root, '--session', session, '--seed', String(seed), '--agent-id', agentId], { label: `new seed ${seed}` }), `new seed ${seed}`);
  let current = created;
  const actions = [];
  const compactHashes = [sha256(current.observation)];
  let decisions = 0;
  while (!current.gameOver) {
    if (decisions >= MAX_DECISIONS) fail(`Seed ${seed} did not reach Game Over within ${MAX_DECISIONS} decisions`);
    const action = endTurnAction(fullSnapshot(launcher, root, session, current.revision), `seed ${seed} revision ${current.revision}`);
    const requestId = `portable-seed-${seed}-${decisions + 1}-${index}`;
    const planPath = join(root, `seed-${String(seed).replaceAll('-', 'n')}-${index}-${decisions + 1}.plan.json`);
    createEndTurnPlan(planPath, current.revision, action, requestId, `Portable seed ${seed} EndTurn ${decisions + 1}.`);
    const played = invokeJson(launcher, ['play-turn', ...sessionArgs(root, session), '--input', planPath], { label: `play-turn seed ${seed} decision ${decisions + 1}` });
    assert(played.ok === true && played.kind === 'plan-result' && played.executedIndexes?.length === 1, `Seed ${seed} play-turn rejected decision ${decisions + 1}`);
    const next = statusView(invokeJson(launcher, ['status', ...sessionArgs(root, session)], { label: `status seed ${seed} decision ${decisions + 1}` }), `status seed ${seed} decision ${decisions + 1}`);
    assert(next.revision === current.revision + 1, `Seed ${seed} revision did not advance at decision ${decisions + 1}`);
    actions.push(action);
    compactHashes.push(sha256(next.observation));
    current = next;
    decisions += 1;
  }
  assert(current.result && (current.result.outcome === 'won' || current.result.outcome === 'lost'), `Seed ${seed} Game Over omitted a public Result`);
  const artifactPath = join(root, `seed-${String(seed).replaceAll('-', 'n')}-${index}.nlth-artifact`);
  const artifact = assertArtifact(invokeJson(launcher, ['artifact', ...sessionArgs(root, session), '--out', artifactPath], { label: `artifact seed ${seed}` }), artifactPath, decisions, `artifact seed ${seed}`);
  return { seed, session, decisions, revision: current.revision, result: current.result, actions, compactHashes, artifact };
}

function replaySeed(launcher, root, original, index) {
  const session = `portable-replay-${String(original.seed).replaceAll('-', 'n')}-${index}`;
  const created = statusView(invokeJson(launcher, ['new', '--root', root, '--session', session, '--seed', String(original.seed), '--agent-id', `portable-replay-driver-${original.seed}-${index}`], { label: `new replay seed ${original.seed}` }), `new replay seed ${original.seed}`);
  let current = created;
  const compactHashes = [sha256(current.observation)];
  for (let indexInRun = 0; indexInRun < original.actions.length; indexInRun += 1) {
    const planPath = join(root, `replay-seed-${String(original.seed).replaceAll('-', 'n')}-${index}-${indexInRun + 1}.plan.json`);
    createEndTurnPlan(planPath, current.revision, original.actions[indexInRun], `portable-replay-${original.seed}-${indexInRun + 1}-${index}`, `Replay seed ${original.seed} EndTurn ${indexInRun + 1}.`);
    const played = invokeJson(launcher, ['play-turn', ...sessionArgs(root, session), '--input', planPath], { label: `replay play-turn seed ${original.seed} decision ${indexInRun + 1}` });
    assert(played.ok === true && played.kind === 'plan-result' && played.executedIndexes?.length === 1, `Replay seed ${original.seed} rejected decision ${indexInRun + 1}`);
    current = statusView(invokeJson(launcher, ['status', ...sessionArgs(root, session)], { label: `replay status seed ${original.seed} decision ${indexInRun + 1}` }), `replay status seed ${original.seed} decision ${indexInRun + 1}`);
    assert(current.revision === indexInRun + 1, `Replay seed ${original.seed} revision differs at decision ${indexInRun + 1}`);
    assert(sha256(current.observation) === original.compactHashes[indexInRun + 1], `Replay seed ${original.seed} Compact differs at decision ${indexInRun + 1}`);
    compactHashes.push(sha256(current.observation));
  }
  assert(current.gameOver === true, `Replay seed ${original.seed} did not reach Game Over`);
  assert(JSON.stringify(current.result) === JSON.stringify(original.result), `Replay seed ${original.seed} Result differs`);
  const artifactPath = join(root, `replay-seed-${String(original.seed).replaceAll('-', 'n')}-${index}.nlth-artifact`);
  const artifact = assertArtifact(invokeJson(launcher, ['artifact', ...sessionArgs(root, session), '--out', artifactPath], { label: `replay artifact seed ${original.seed}` }), artifactPath, original.decisions, `replay artifact seed ${original.seed}`);
  return { session, decisions: original.decisions, result: current.result, artifact, compactHashes, replayMatched: true };
}

function main(argv = process.argv.slice(2)) {
  const launcherOption = optionValue(argv, '--launcher');
  const rootOption = optionValue(argv, '--root');
  if (!launcherOption) fail('--launcher requires a Player run-session launcher path');
  if (!rootOption) fail('--root requires a unique Session root');
  const launcher = resolve(launcherOption);
  const root = resolve(rootOption);
  const output = resolve(optionValue(argv, '--out', join(root, 'PORTABLE_SMOKE.json')));
  const seeds = parseSeeds(optionValue(argv, '--seeds', '1,7'));
  if (!existsSync(launcher) || !statSync(launcher).isFile()) fail(`Player launcher does not exist: ${launcher}`);
  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) fail(`Smoke root is not a directory: ${root}`);
    if (readdirSync(root).length > 0) fail(`Smoke root must be new and empty: ${root}`);
  } else mkdirSync(root, { recursive: true });
  if (existsSync(output)) fail(`Refusing to overwrite smoke report: ${output}`);

  const commandSmokeReport = commandSmoke(launcher, root);
  const seedReports = seeds.map((seed, index) => runSeed(launcher, root, seed, index));
  const replayReports = seedReports.map((report, index) => replaySeed(launcher, root, report, index));
  const report = {
    ok: true,
    launcher,
    root,
    node: { version: process.version, platform: process.platform, arch: process.arch },
    commands: COMMANDS,
    commandSmoke: commandSmokeReport,
    seeds: seedReports.map(({ actions: _actions, compactHashes, ...summary }) => ({ ...summary, compactHashes })),
    replays: replayReports,
    replayMatched: replayReports.every((item) => item.replayMatched === true),
  };
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ok: true, output, commandCount: COMMANDS.length, seeds: seedReports.map((item) => ({ seed: item.seed, decisions: item.decisions, outcome: item.result.outcome })), replayMatched: report.replayMatched })}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
