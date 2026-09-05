/**
 * Chooser-only v1.5.1 compatibility check. Does not advance games or regenerate fixtures.
 * Run after v152-core-validation.ts has produced the four validated state fixtures:
 * node_modules/.bin/vite-node.cmd --script src/testing/v152-agent-comparison.ts --baseline=output/v152-baseline
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { GameEngine } from '../core/engine';
import { getUnitLegalMoveFuelProjections, previewMove } from '../core/movement-query';
import { createAgentObservation } from '../agent/observation';
import { RandomAgent } from '../agent/randomAgent';
import { BalancedAgent } from '../agent/balancedAgent';
import type { GameAction, GameState } from '../core/types';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
  const separator = arg.indexOf('=');
  if (separator < 0) throw new Error(`Expected --name=value: ${arg}`);
  return [arg.slice(2, separator), arg.slice(separator + 1)];
}));
if (!args.baseline) throw new Error('--baseline=<v1.5.1 checkout> is required');
const baseline = resolve(args.baseline).replaceAll('\\', '/');
const fixtureDirectory = resolve(args.fixtures ?? 'output/v152-validation');
const reportPath = resolve(args.out ?? `${fixtureDirectory}/agent-comparison-report.json`);
const oldEngine = await import(`${baseline}/src/core/engine.ts`) as typeof import('../core/engine');
const oldObservation = await import(`${baseline}/src/agent/observation.ts`) as typeof import('../agent/observation');
const oldRandom = await import(`${baseline}/src/agent/randomAgent.ts`) as typeof import('../agent/randomAgent');
const oldBalanced = await import(`${baseline}/src/agent/balancedAgent.ts`) as typeof import('../agent/balancedAgent');

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const choosers = [1, 7].map(seed => ({ seed, before: new oldRandom.RandomAgent(seed), after: new RandomAgent(seed) }));
const names = ['standard-early', 'reachable-wave-turn-20', 'reachable-wave-turn-50', 'reachable-wave-turn-51'];
const reports = [];
let randomDecisions = 0, balancedDecisions = 0, movementProjections = 0, movePreviews = 0;
for (const name of names) {
  const state = deepFreeze(JSON.parse(await readFile(resolve(fixtureDirectory, `${name}.json`), 'utf8')) as GameState);
  const stateHash = hash(state);
  const beforeEngine = new oldEngine.GameEngine(state.seed, state.config);
  const afterEngine = new GameEngine(state.seed, state.config);
  assert.equal(beforeEngine.step({ type: 'LoadSnapshot', snapshot: state }).error, null, `${name}: old fixture load`);
  assert.equal(afterEngine.step({ type: 'LoadSnapshot', snapshot: state }).error, null, `${name}: current fixture load`);
  const beforeActions = deepFreeze(beforeEngine.getLegalActions());
  const afterActions = deepFreeze(afterEngine.getLegalActions());
  assert.deepEqual(afterActions, beforeActions, `${name}: legal action values and order`);
  const before = deepFreeze(oldObservation.createAgentObservation(state));
  const after = deepFreeze(createAgentObservation(state));
  const { productionCapacity: addedCapacity, ...legacyForecast } = after.strategicForecast;
  assert.ok(addedCapacity, `${name}: current derived production capacity must exist`);
  // Only these two deliberate API changes are normalized. All other fields,
  // ordering and nested public information must match the old implementation.
  assert.deepEqual({ ...after, apiVersion: before.apiVersion, strategicForecast: legacyForecast }, before,
    `${name}: legacy public observation fields`);
  const beforeObservationHash = hash(before), afterObservationHash = hash(after);

  const random = choosers.map(chooser => {
    const actions: GameAction[] = [];
    for (let decision = 0; decision < 12; decision += 1) {
      // Interleave the singleton branch to prove it still consumes no RNG draw.
      const singleton = decision === 3 || decision === 9;
      const oldLegal = singleton ? [{ type: 'EndTurn' } as const] : beforeActions;
      const newLegal = singleton ? [{ type: 'EndTurn' } as const] : afterActions;
      const oldDecision = chooser.before.decide(before, oldLegal);
      const newDecision = chooser.after.decide(after, newLegal);
      assert.deepEqual(newDecision, oldDecision, `${name}: Random seed ${chooser.seed} chooser decision ${decision}`);
      actions.push(newDecision.action);
      randomDecisions += 1;
    }
    return { seed: chooser.seed, actions, sequenceHash: hash(actions) };
  });

  const beforeBalanced = new oldBalanced.BalancedAgent();
  const afterBalanced = new BalancedAgent();
  const balanced = [];
  // Repeated reads of fixed inputs also exercise the agent's repeat penalties.
  // These are chooser calls, not claims about four executed gameplay Actions.
  for (let decision = 0; decision < 4; decision += 1) {
    const oldDecision = beforeBalanced.decide(before, beforeActions);
    const newDecision = afterBalanced.decide(after, afterActions);
    assert.deepEqual(newDecision, oldDecision, `${name}: Balanced chooser decision ${decision}, including score trace`);
    balanced.push({ action: newDecision.action, decisionHash: hash(newDecision) });
    balancedDecisions += 1;
  }

  for (const unit of state.units.filter(unit => unit.isPlayerUnit)) {
    const oldMoves = oldEngine.getUnitLegalMoveFuelProjections(state, unit.id);
    const newMoves = getUnitLegalMoveFuelProjections(state, unit.id);
    assert.deepEqual(newMoves, oldMoves, `${name}: ${unit.id} cached search costs equal path cost sums`);
    movementProjections += newMoves.length;
    const destinations = [{ q: -1, r: 0 }, { ...unit.position }];
    for (const index of new Set([0, Math.floor(oldMoves.length / 2), oldMoves.length - 1])) {
      const move = oldMoves[index];
      if (move) destinations.push({ ...move.destination });
    }
    for (const destination of destinations) {
      const destinationHash = hash(destination);
      const oldPreview = oldEngine.previewMove(state, unit.id, destination);
      const newPreview = previewMove(state, unit.id, destination);
      assert.deepEqual(newPreview, oldPreview, `${name}: ${unit.id} preview ${JSON.stringify(destination)}`);
      if (newPreview.path[0]) newPreview.path[0].q = -999;
      if (newPreview.reached) newPreview.reached.q = -999;
      if (newPreview.interception) newPreview.interception.position.q = -999;
      assert.equal(hash(destination), destinationHash, `${name}: preview must detach its destination`);
      movePreviews += 1;
    }
  }
  assert.equal(hash(state), stateHash, `${name}: queries must not mutate State/RNG/events`);
  assert.equal(hash(before), beforeObservationHash, `${name}: old chooser public input mutation`);
  assert.equal(hash(after), afterObservationHash, `${name}: current chooser public input mutation`);
  if (name === 'standard-early') {
    for (const fuel of [0, 1]) {
      // Narrow query-only cases; these edited copies are not reachable fixtures.
      const interceptionState = structuredClone(state);
      const mover = interceptionState.units.find(unit => unit.id === 'police-1')!;
      const interceptor = interceptionState.units.find(unit => !unit.isPlayerUnit)!;
      mover.currentFuel = fuel;
      interceptor.position = { q: 26, r: 24 };
      interceptor.canAttack = true;
      deepFreeze(interceptionState);
      const beforeHash = hash(interceptionState);
      const destination = { q: 25, r: 24 };
      const expected = oldEngine.previewMove(interceptionState, mover.id, destination);
      const actual = previewMove(interceptionState, mover.id, destination);
      assert.equal(actual.interception?.interceptorId, interceptor.id, `targeted visible interception, fuel ${fuel}`);
      assert.equal(actual.movementMode, fuel === 0 ? 'emergency' : 'normal');
      assert.deepEqual(actual, expected, `targeted visible interception preview, fuel ${fuel}`);
      actual.path[0]!.q = -999;
      actual.interception!.position.q = -999;
      assert.equal(hash(interceptionState), beforeHash, 'preview without state clone must be detached and pure');
      movePreviews += 1;
    }
  }
  reports.push({ name, turn: state.turn, units: state.units.length, legalActions: beforeActions.length,
    stateHash, legacyObservationHash: beforeObservationHash, random, balanced });
  console.log(`Verified public fields, Random/Balanced choices and movement queries: ${name}`);
}
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ baseline, fixtureDirectory, node: process.version,
  checkedAt: new Date().toISOString(), normalizedPublicDifferences: ['apiVersion', 'strategicForecast.productionCapacity'],
  randomDecisions, balancedDecisions, movementProjections, movePreviews, reports,
  scope: 'Fixed-input chooser sequence comparison. No gameplay Actions are executed. Late fixtures retain the separately declared stationary-enemy/high-stock configuration.',
}, null, 2));
console.log(`All chooser and movement comparisons passed; report ${reportPath}`);
