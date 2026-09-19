import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from './store';
import { SessionService } from './service';
import { createAgentSessionGameFactory, resolveSessionIdentity } from './agent-adapter';
import { createAiSession } from './ai-session';
import { sessionCliHelp } from './session-cli';

it('rejects malformed ProduceUnit before preview or any Decision is committed', () => {
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v162-test', NLTH_GIT_COMMIT: 'a'.repeat(40) });
  const service = new SessionService(new SessionStore(mkdtempSync(join(tmpdir(), 'nlth-v162-'))), createAgentSessionGameFactory(identity.buildId), identity);
  const initial = service.newSession({ sessionId: 'invalid-action', seed: 1 });
  const action = { type: 'ProduceUnit', facilityId: 'capital', unitType: 'police' } as const;
  for (const call of [
    () => service.preview('invalid-action', { action, expectedRevision: 0 }),
    () => service.step('invalid-action', { action, expectedRevision: 0 }),
    () => service.playTurnAction('invalid-action', { type: 'action', action, expectedRevision: 0, requestId: 'bad-interactive' }),
    () => service.playTurnPlan('invalid-action', { expectedRevision: 0, actions: [{ action, requestId: 'bad-plan' }] }),
  ]) {
    expect(call).toThrowError(expect.objectContaining({ code: 'invalid_action_input' }));
    const status = service.status('invalid-action');
    expect(status.revision).toBe(0);
    expect(status.observation).toEqual(initial.observation);
  }
  const ai = createAiSession({ initial: { seed: 1 } });
  const before = ai.observe();
  const input = { action, generation: 1, baseRevision: 0 };
  expect(ai.previewAction(input)).toMatchObject({ ok: false, error: { code: 'invalid_action_input' } });
  expect(ai.act({ ...input, requestId: 'malformed' })).toMatchObject({ ok: false, error: { code: 'invalid_action_input' } });
  expect(ai.observe()).toEqual(before);
  const illegal = service.step('invalid-action', { action: { type: 'Wait', unitId: 'missing-unit' }, expectedRevision: 0 });
  expect(illegal.accepted).toBe(false);
  expect(illegal.revision).toBe(1);
}, 60000);

it('filters checkpoint construction through the same schema in CLI and AiSession', () => {
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v162-query', NLTH_GIT_COMMIT: 'b'.repeat(40) });
  const service = new SessionService(new SessionStore(mkdtempSync(join(tmpdir(), 'nlth-v162-query-'))), createAgentSessionGameFactory(identity.buildId), identity);
  service.newSession({ sessionId: 'queries', seed: 1 });
  const ai = createAiSession({ initial: { seed: 1 }, buildId: identity.buildId });
  for (const filters of ([{ facilityType: 'checkpoint' }, { actionType: 'BuildConstructibleFacility' }] as Record<string, string>[])) {
    const cli = service.query('queries', { target: 'construction', filters, pageSize: 500 });
    const result = ai.query({ target: 'construction', filters, pageSize: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error.message);
    expect(result.items).toEqual(cli.items);
    expect(cli.count).toBeGreaterThan(0);
    if ('facilityType' in filters) expect(cli.items!.every(item => (item as { facilityType: string }).facilityType === 'checkpoint')).toBe(true);
  }
  expect(sessionCliHelp()).toHaveProperty('responseSemantics.accepted');
  expect(service.query('queries', { target: 'api' }).value).toHaveProperty('responseSemantics.accepted');
}, 60000);

it('allows only the requested new crisis reasons and rejects unknown allowlist entries', () => {
  const identity = resolveSessionIdentity({ NLTH_BUILD_ID: 'v162-plan', NLTH_GIT_COMMIT: 'c'.repeat(40) });
  const service = new SessionService(new SessionStore(mkdtempSync(join(tmpdir(), 'nlth-v162-plan-'))), createAgentSessionGameFactory(identity.buildId), identity);
  service.newSession({ sessionId: 'plan', seed: 1 });
  expect(service.step('plan', { action: { type: 'AssignWorkers', facilityId: 'military-factory-1', workers: 5 } }).accepted).toBe(true);
  expect(() => service.playTurnPlan('plan', { expectedRevision: 1, actions: [{ requestId: 'unknown', action: { type: 'Wait', unitId: 'police-1' }, expectations: { allowedNewCrisisReasonCodes: ['not_a_reason'] } }] })).toThrowError(expect.objectContaining({ code: 'invalid_play_turn_input' }));
  expect(service.status('plan').revision).toBe(1);
  const checkpoint = service.saveCheckpoint('plan');
  service.loadCheckpoint('plan', checkpoint.checkpointId, 'allowed');
  const plan = (allow: boolean) => ({ expectedRevision: 1, actions: [
    { requestId: 'stop-production', action: { type: 'AssignWorkers', facilityId: 'military-factory-1', workers: 0 }, ...(allow ? { expectations: { allowedNewCrisisReasonCodes: ['production_outage', 'facility_workers_zero'] } } : {}) },
    { requestId: 'continue', action: { type: 'Wait', unitId: 'police-1' } },
  ] });
  expect(service.playTurnPlan('plan', plan(false))).toMatchObject({ executedIndexes: [0], stopReason: 'new_crisis' });
  const allowed = service.playTurnPlan('allowed', plan(true));
  expect(allowed.executedIndexes).toEqual([0, 1]);
}, 60000);
