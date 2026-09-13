import { describe, expect, it } from 'vitest';
import type { GameAction } from '../core/types';
import { createAiSession } from './ai-session';
import type { AiSessionResponse } from './ai-session-contract';

function expectOk<T extends object>(value: AiSessionResponse<T>): { ok: true; generation: number; revision: number } & T {
  if (!value.ok) throw new Error(`${value.error.code}: ${value.error.message}`);
  return value;
}

function firstLegalAction(session: ReturnType<typeof createAiSession>, generation: number, revision: number): GameAction {
  const legal = expectOk(session.getLegalActions({ generation, baseRevision: revision, pageSize: 1 }));
  expect(legal.actions).toHaveLength(1);
  expect(legal.total).toBeGreaterThan(0);
  return legal.actions[0]!;
}

describe('transport-neutral AI Session application boundary', () => {
  it('runs context → observe → legal → preview → act → result with no DOM globals', () => {
    // Vitest's Node runtime intentionally has neither of these browser globals.
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');

    const session = createAiSession({ initial: { seed: 41 }, preferredCommentLocale: 'en' });
    const context = session.getContext();
    expect(context.generation).toBe(1);
    expect(context.revision).toBe(0);
    expect(context.capabilities.preview.economyProjection).toBe('core_projector_optional');

    const observed = expectOk(session.observe());
    expect(observed.observation.turn).toBeGreaterThan(0);
    expect(observed.availableQueryTargets).toContain('facilities');

    const action = firstLegalAction(session, context.generation, context.revision);
    const preview = expectOk(session.previewAction({ generation: context.generation, baseRevision: context.revision, action }));
    expect(preview.legal).toBe(true);
    expect(preview.projection).toMatchObject({ kind: 'core_projection', reasonCode: null });
    expect(preview.projection.value).toMatchObject({ legal: true, baseRevision: context.revision });
    expect(session.getContext().revision).toBe(0);

    const input = {
      generation: context.generation,
      baseRevision: context.revision,
      requestId: 'decision-1',
      action,
      decisionSummary: '現在の公開情報を確認して一手進めます。',
      requestedCommentLocale: 'ja' as const,
    };
    const acted = expectOk(session.act(input));
    expect(acted.revision).toBe(1);
    expect(acted.record.accepted).toBe(true);
    expect(acted.record.decisionSummary).toBe(input.decisionSummary);
    expect(acted.record.requestedCommentLocale).toBe('ja');
    expect(acted.record.decisionHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(acted.before.turn).toBe(observed.observation.turn);

    const result = expectOk(session.getResult());
    expect(result.revision).toBe(1);
    expect(['not_finished', 'finished']).toContain(result.status);
  });

  it('keeps bounded query cursors revision-pinned and does not expose an unbounded unit list', () => {
    const session = createAiSession({ initial: { seed: 42 }, sessionId: 'query-session' });
    const first = expectOk(session.query({ generation: 1, baseRevision: 0, target: 'units', pageSize: 1 }));
    expect(first.count).toBe(1);
    expect(first.total).toBeGreaterThanOrEqual(1);
    expect(first.items).toHaveLength(1);
    if (first.nextCursor) {
      const second = expectOk(session.query({ generation: 1, baseRevision: 0, target: 'units', pageSize: 1, cursor: first.nextCursor }));
      expect(second.items?.[0]).not.toEqual(first.items?.[0]);
    }

    const action = firstLegalAction(session, 1, 0);
    expectOk(session.act({ generation: 1, baseRevision: 0, requestId: 'query-step', action }));
    const stale = session.query({ generation: 1, baseRevision: 0, target: 'units', pageSize: 1 });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_revision' } });
  });

  it('normalizes empty comments, preserves raw Unicode comments, and rejects oversize text before a Decision', () => {
    const session = createAiSession({ initial: { seed: 43 } });
    const action = firstLegalAction(session, 1, 0);
    const empty = expectOk(session.act({ generation: 1, baseRevision: 0, requestId: 'empty-comment', action, decisionSummary: '' }));
    expect(empty.record.decisionSummary).toBeNull();
    expect(empty.record.requestedCommentLocale).toBe('en');

    const oversized = session.act({
      generation: 1,
      baseRevision: 1,
      requestId: 'oversized-comment',
      action: firstLegalAction(session, 1, 1),
      decisionSummary: '😀'.repeat(501),
      requestedCommentLocale: 'ja',
    });
    expect(oversized).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    const malformed = session.act({
      generation: 1,
      baseRevision: 1,
      requestId: 'malformed-action',
      action: { type: 'Wait' } as unknown as GameAction,
    });
    expect(malformed).toMatchObject({ ok: false, error: { code: 'invalid_action_input' } });
    expect(session.getContext().revision).toBe(1);
    expect(expectOk(session.buildPublicArtifact()).artifact.decisions).toHaveLength(1);
  });

  it('returns the exact original result for an idempotent retry and conflicts on changed comment or locale', () => {
    const session = createAiSession({ initial: { seed: 44 } });
    const action = firstLegalAction(session, 1, 0);
    const input = {
      generation: 1,
      baseRevision: 0,
      requestId: 'same-request',
      action,
      decisionSummary: 'first comment',
      requestedCommentLocale: 'en' as const,
    };
    const first = expectOk(session.act(input));
    const retried = expectOk(session.act(input));
    expect(retried).toEqual(first);
    expect(expectOk(session.getRequestResult('same-request'))).toMatchObject({
      status: first.record.requestStatus,
      result: { record: { decisionHash: first.record.decisionHash } },
    });

    const changedComment = session.act({ ...input, decisionSummary: 'changed comment' });
    const changedLocale = session.act({ ...input, requestedCommentLocale: 'ja' });
    expect(changedComment).toMatchObject({ ok: false, error: { code: 'request_id_conflict' } });
    expect(changedLocale).toMatchObject({ ok: false, error: { code: 'request_id_conflict' } });
    expect(session.getContext().revision).toBe(1);
  });

  it('keeps request ledgers, engines, revisions, and decision hashes independent per Session instance', () => {
    const left = createAiSession({ initial: { seed: 45 } });
    const right = createAiSession({ initial: { seed: 45 } });
    const leftAction = firstLegalAction(left, 1, 0);
    const rightAction = firstLegalAction(right, 1, 0);
    expect(leftAction).toEqual(rightAction);

    const leftResult = expectOk(left.act({
      generation: 1, baseRevision: 0, requestId: 'shared-request-id', action: leftAction,
      decisionSummary: 'same raw comment', requestedCommentLocale: 'ja',
    }));
    const rightResult = expectOk(right.act({
      generation: 1, baseRevision: 0, requestId: 'shared-request-id', action: rightAction,
      decisionSummary: 'same raw comment', requestedCommentLocale: 'ja',
    }));
    expect(leftResult.record.decisionHash).toBe(rightResult.record.decisionHash);
    expect(left.getContext().revision).toBe(1);
    expect(right.getContext().revision).toBe(1);

    // A second decision in only the left instance must not alter right's
    // revision or make its request id conflict with the left ledger.
    expectOk(left.act({
      generation: 1, baseRevision: 1, requestId: 'left-only', action: firstLegalAction(left, 1, 1),
    }));
    expect(left.getContext().revision).toBe(2);
    expect(right.getContext().revision).toBe(1);
    expect(expectOk(right.getRequestResult('shared-request-id')).result.record.decision).toBe(1);
  });

  it('rejects new actions while paused or ended without recording a Decision', () => {
    const session = createAiSession({ initial: { seed: 46 } });
    const action = firstLegalAction(session, 1, 0);
    expectOk(session.setPaused(true));
    expect(session.act({ generation: 1, baseRevision: 0, requestId: 'paused', action })).toMatchObject({
      ok: false, error: { code: 'paused' },
    });
    expect(session.getContext().revision).toBe(0);
    expectOk(session.setPaused(false));
    expectOk(session.act({ generation: 1, baseRevision: 0, requestId: 'fresh', action }));
    expect(session.act({ generation: 1, baseRevision: 0, requestId: 'stale', action })).toMatchObject({
      ok: false, error: { code: 'stale_revision' },
    });
    expectOk(session.end());
    expect(session.act({ generation: 1, baseRevision: 1, requestId: 'ended', action: firstLegalAction(session, 1, 1) })).toMatchObject({
      ok: false, error: { code: 'session_ended' },
    });
    expect(expectOk(session.buildPublicArtifact()).artifact.decisions).toHaveLength(1);
  });
});
