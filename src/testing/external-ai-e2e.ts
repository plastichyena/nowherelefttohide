import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAgentGame } from '../agent/game';
import type { AgentGame, AgentObservation, AgentArtifactPageOptions } from '../agent/types';
import type { GameAction } from '../core/types';
import { sha256Json } from '../session/hash';
import { writeJsonStream } from '../agent/json-stream';

const DEFAULT_MAX_DECISIONS = 200;
const HIDDEN_KEYS = new Set([
  'verificationEvents',
  'normalZombiesNoiseTargeted',
  'noiseTargetsReached',
  'noiseTargetsOverriddenByHorde',
  'noiseTargetsOverriddenByVisiblePopulation',
  'aerialDiscoveriesInGroundBlockedArea',
  'hordeNoiseRespawnedByType',
]);

function assertPublic(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublic(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) throw new Error(`Hidden field leaked at ${path}.${key}`);
    assertPublic(child, `${path}.${key}`);
  }
}

/** Deliberately external: it consumes only Observation and Legal Actions. */
function chooseAction(_observation: AgentObservation, legalActions: readonly GameAction[]): GameAction {
  const endTurn = legalActions.find((action) => action.type === 'EndTurn');
  if (!endTurn) throw new Error('External policy could not find EndTurn in Legal Actions');
  return structuredClone(endTurn);
}

function integerArgument(name: string, defaultValue: number, minimum: number): number {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  const index = process.argv.indexOf(`--${name}`);
  const value = inline ? inline.slice(prefix.length) : index >= 0 ? process.argv[index + 1] : undefined;
  if (index >= 0 && value === undefined) throw new Error(`--${name} requires a value`);
  if (value === undefined) return defaultValue;
  if (!/^-?\d+$/u.test(value)) throw new Error(`--${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`--${name} must be at least ${minimum}`);
  return parsed;
}

function play(seed: number, game: AgentGame, maxDecisions: number, actions?: readonly GameAction[]) {
  if (!game.getArtifactPage) throw new Error('Public artifact pagination is required');
  let observation = game.reset({ seed, agent: { id: `external-public-api-seed-${seed}` } });
  assertPublic(observation);
  const acceptedActions: GameAction[] = [];
  const observationHashes = [sha256Json(observation)];

  for (let index = 0; !game.isGameOver() && index < maxDecisions; index += 1) {
    const legalActions = game.getLegalActions();
    assertPublic(legalActions);
    const action = actions ? actions[index] : chooseAction(observation, legalActions);
    if (!action) throw new Error(`Replay action ${index} is missing`);
    const step = game.step(structuredClone(action));
    if (step.error) throw new Error(`External action ${index} failed: ${step.error.code}: ${step.error.message}`);
    observation = step.observation;
    acceptedActions.push(structuredClone(action));
    observationHashes.push(sha256Json(observation));
    assertPublic(step);
  }

  if (!game.isGameOver()) throw new Error(`External AI did not reach Game Over within ${maxDecisions} decisions`);
  if (actions && acceptedActions.length !== actions.length) {
    throw new Error(`Replay consumed ${acceptedActions.length}/${actions.length} accepted actions`);
  }
  const result = game.getResult();
  const artifact = game.getRunArtifact();
  if (!result || !artifact.result) throw new Error('Completed external AI run did not produce a Result');
  if (artifact.acceptedActions.length !== acceptedActions.length) throw new Error('Artifact accepted action count differs');
  if (artifact.observationTrace?.length !== acceptedActions.length + 1) throw new Error('Artifact observation trace is incomplete');
  assertPublic(artifact);
  const revision = game.getArtifactPage().revision;
  for (let index = 0; index < observationHashes.length; index += 1) {
    const page = game.getArtifactPage({ target: 'observations', offset: index, pageSize: 1, expectedRevision: revision });
    if (sha256Json(page.items[0]) !== observationHashes[index]) throw new Error(`Artifact observation ${index} differs`);
  }
  return { acceptedActions, observationHashes, result, artifact };
}

function compareArtifacts(first: AgentGame, replayed: AgentGame): void {
  if (!first.getArtifactPage || !replayed.getArtifactPage) throw new Error('Public artifact pagination is required');
  for (const target of ['manifest', 'observations', 'actions', 'events', 'invalid-attempts'] as NonNullable<AgentArtifactPageOptions['target']>[]) {
    let offset = 0;
    while (true) {
      const left = first.getArtifactPage({ target, offset, pageSize: 1 });
      const right = replayed.getArtifactPage({ target, offset, pageSize: 1 });
      if (left.total !== right.total || sha256Json(left.items) !== sha256Json(right.items)) throw new Error(`Replay artifact ${target} page ${offset} differs`);
      if (!left.hasMore) break;
      offset = left.nextOffset!;
    }
  }
}

const seed = integerArgument('seed', 1, Number.MIN_SAFE_INTEGER);
const maxDecisions = integerArgument('max-decisions', DEFAULT_MAX_DECISIONS, 1);
const firstGame = createAgentGame({ buildId: 'external-ai-e2e' });
const replayGame = createAgentGame({ buildId: 'external-ai-e2e' });
const first = play(seed, firstGame, maxDecisions);
const replayed = play(seed, replayGame, maxDecisions, first.acceptedActions);
if (JSON.stringify(first.result) !== JSON.stringify(replayed.result)) throw new Error('Replay final Result differs');
if (JSON.stringify(first.observationHashes) !== JSON.stringify(replayed.observationHashes)) throw new Error('Replay Observation trace differs');
compareArtifacts(firstGame, replayGame);

const report = {
  ok: true,
  policy: 'external-public-api-end-turn',
  seed,
  decisions: first.acceptedActions.length,
  gameOver: true,
  result: first.result,
  replayMatched: true,
  artifact: first.artifact,
};
const outputArgument = process.argv.slice(2).find((argument) => argument.startsWith('--out='));
if (outputArgument) {
  const outputPath = resolve(outputArgument.slice('--out='.length));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeJsonStream(outputPath, report);
}
process.stdout.write(`${JSON.stringify({ ...report, artifact: undefined })}\n`);
