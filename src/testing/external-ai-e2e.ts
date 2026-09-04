import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAgentGame } from '../agent/game';
import type { AgentGame, AgentObservation, AgentPublicRunArtifact } from '../agent/types';
import type { GameAction } from '../core/types';

const MAX_DECISIONS = 100;
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

function play(game: AgentGame, actions?: readonly GameAction[]) {
  let observation = game.reset({ seed: 1, agent: { id: 'external-public-api-seed-1' } });
  assertPublic(observation);
  const acceptedActions: GameAction[] = [];
  const observationJson = [JSON.stringify(observation)];

  for (let index = 0; !game.isGameOver() && index < MAX_DECISIONS; index += 1) {
    const legalActions = game.getLegalActions();
    assertPublic(legalActions);
    const action = actions ? actions[index] : chooseAction(observation, legalActions);
    if (!action) throw new Error(`Replay action ${index} is missing`);
    const step = game.step(structuredClone(action));
    if (step.error) throw new Error(`External action ${index} failed: ${step.error.code}: ${step.error.message}`);
    observation = step.observation;
    acceptedActions.push(structuredClone(action));
    observationJson.push(JSON.stringify(observation));
    assertPublic(step);
  }

  if (!game.isGameOver()) throw new Error(`External AI did not reach Game Over within ${MAX_DECISIONS} decisions`);
  if (actions && acceptedActions.length !== actions.length) {
    throw new Error(`Replay consumed ${acceptedActions.length}/${actions.length} accepted actions`);
  }
  const result = game.getResult();
  const artifact = game.getRunArtifact();
  if (!result || !artifact.result) throw new Error('Completed external AI run did not produce a Result');
  if (artifact.acceptedActions.length !== acceptedActions.length) throw new Error('Artifact accepted action count differs');
  if (artifact.observationTrace?.length !== acceptedActions.length + 1) throw new Error('Artifact observation trace is incomplete');
  assertPublic(artifact);
  return { acceptedActions, observationJson, result, artifact };
}

function artifactComparable(artifact: AgentPublicRunArtifact): string {
  return JSON.stringify(artifact);
}

const first = play(createAgentGame({ buildId: 'external-ai-e2e' }));
const replayed = play(createAgentGame({ buildId: 'external-ai-e2e' }), first.acceptedActions);
if (JSON.stringify(first.result) !== JSON.stringify(replayed.result)) throw new Error('Replay final Result differs');
if (JSON.stringify(first.observationJson) !== JSON.stringify(replayed.observationJson)) throw new Error('Replay Observation trace differs');
if (artifactComparable(first.artifact) !== artifactComparable(replayed.artifact)) throw new Error('Replay public Artifact differs');

const report = {
  ok: true,
  policy: 'external-public-api-end-turn',
  seed: 1,
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
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify({ ...report, artifact: undefined })}\n`);
