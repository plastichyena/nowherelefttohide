import { describe, expect, it, vi } from 'vitest';
import { createAiSession } from '../session/ai-session';
import type { AiSessionPort } from '../session/ai-session-contract';
import {
  WEBMCP_TOOL_NAMES,
  registerWebMcpTools,
  type WebMcpDocumentLike,
} from './webmcp';

type RegisteredDefinition = {
  name: string;
  annotations: { readOnlyHint: boolean; idempotentHint?: boolean };
  execute(input?: unknown): unknown;
};

function mockDocument(options: { handles?: boolean; contextFallback?: boolean } = {}) {
  const definitions: RegisteredDefinition[] = [];
  const handleUnregisters: Array<ReturnType<typeof vi.fn>> = [];
  const unregisterTool = vi.fn();
  const registerTool = vi.fn((definition: RegisteredDefinition) => {
    definitions.push(definition);
    if (!options.handles) return undefined;
    const unregister = vi.fn();
    handleUnregisters.push(unregister);
    return { unregister };
  });
  const view: { top?: unknown } = {};
  view.top = view;
  const documentLike = {
    defaultView: view,
    modelContext: {
      registerTool,
      ...(options.contextFallback ? { unregisterTool } : {}),
    },
  } as unknown as WebMcpDocumentLike;
  return { documentLike, definitions, registerTool, unregisterTool, handleUnregisters };
}

function definitionByName(definitions: RegisteredDefinition[], name: string): RegisteredDefinition {
  const definition = definitions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`tool not registered: ${name}`);
  return definition;
}

describe('v1.6 WebMCP adapter', () => {
  it('discovers exactly the fixed nine tools and marks only act as writing', () => {
    const mock = mockDocument({ handles: true });
    const registration = registerWebMcpTools({ getSession: () => createAiSession({ initial: { seed: 61 } }) }, mock.documentLike);

    expect(registration.supported).toBe(true);
    expect(mock.definitions.map(({ name }) => name)).toEqual(WEBMCP_TOOL_NAMES);
    expect(registration.registeredToolNames).toEqual(WEBMCP_TOOL_NAMES);
    expect(mock.definitions).toHaveLength(9);
    expect(mock.definitions.filter(({ annotations }) => annotations.readOnlyHint === false).map(({ name }) => name)).toEqual(['nlth_act']);
    expect(definitionByName(mock.definitions, 'nlth_act').annotations.idempotentHint).toBe(true);
    expect(mock.definitions.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      'nlth_start', 'nlth_pause', 'nlth_resume', 'nlth_end', 'nlth_export', 'nlth_reset',
    ]));
  });

  it('delegates every tool to the current Session and returns each DTO without transformation', () => {
    const marker = (name: string) => ({ name });
    const context = marker('context');
    const observe = marker('observe');
    const query = marker('query');
    const legal = marker('legal');
    const preview = marker('preview');
    const previews = marker('previews');
    const act = marker('act');
    const request = marker('request');
    const result = marker('result');
    const session = {
      getContext: vi.fn(() => context),
      observe: vi.fn(() => observe),
      query: vi.fn(() => query),
      getLegalActions: vi.fn(() => legal),
      previewAction: vi.fn(() => preview),
      previewActions: vi.fn(() => previews),
      act: vi.fn(() => act),
      getRequestResult: vi.fn(() => request),
      getResult: vi.fn(() => result),
    } as unknown as AiSessionPort;
    const getSession = vi.fn(() => session);
    const mock = mockDocument();
    registerWebMcpTools({ getSession }, mock.documentLike);

    const queryInput = { target: 'facilities', pageSize: 2 };
    const legalInput = { generation: 1, baseRevision: 0, actionKind: 'Wait' };
    const previewInput = { generation: 1, baseRevision: 0, action: { type: 'Wait', unitId: 'unit-1' } };
    const actInput = { ...previewInput, requestId: 'decision-1', decisionSummary: 'raw comment', requestedCommentLocale: 'en' };
    expect(definitionByName(mock.definitions, 'nlth_get_context').execute()).toBe(context);
    expect(definitionByName(mock.definitions, 'nlth_observe').execute()).toBe(observe);
    expect(definitionByName(mock.definitions, 'nlth_query').execute(queryInput)).toBe(query);
    expect(definitionByName(mock.definitions, 'nlth_legal_actions').execute(legalInput)).toBe(legal);
    expect(definitionByName(mock.definitions, 'nlth_preview_action').execute(previewInput)).toBe(preview);
    const batchInput = { generation: 1, baseRevision: 0, actions: [previewInput.action] };
    expect(definitionByName(mock.definitions, 'nlth_preview_actions').execute(batchInput)).toBe(previews);
    expect(session.previewActions).toHaveBeenCalledWith(batchInput);
    expect(definitionByName(mock.definitions, 'nlth_act').execute(actInput)).toBe(act);
    expect(definitionByName(mock.definitions, 'nlth_get_request_result').execute({ requestId: 'decision-1' })).toBe(request);
    expect(definitionByName(mock.definitions, 'nlth_get_result').execute()).toBe(result);

    expect(session.query).toHaveBeenCalledWith(queryInput);
    expect(session.getLegalActions).toHaveBeenCalledWith(legalInput);
    expect(session.previewAction).toHaveBeenCalledWith(previewInput);
    expect(session.act).toHaveBeenCalledWith(actInput);
    expect(session.getRequestResult).toHaveBeenCalledWith('decision-1');
    expect(getSession).toHaveBeenCalledTimes(9);
  });

  it('returns unsupported before UI session start and resolves a later Session without re-registration', () => {
    let session: AiSessionPort | null = null;
    const mock = mockDocument();
    registerWebMcpTools({ getSession: () => session }, mock.documentLike);
    const observe = definitionByName(mock.definitions, 'nlth_observe');

    expect(observe.execute()).toEqual({
      ok: false,
      generation: 0,
      revision: 0,
      error: { code: 'unsupported', message: 'AI play/watch session is not active' },
    });
    session = createAiSession({ initial: { seed: 62 } });
    expect(observe.execute()).toEqual(session.observe());
  });

  it('cleans up once through returned handles or the modelContext fallback', () => {
    const withHandles = mockDocument({ handles: true, contextFallback: true });
    const handleRegistration = registerWebMcpTools({ getSession: () => null }, withHandles.documentLike);
    handleRegistration.cleanup();
    handleRegistration.cleanup();
    expect(withHandles.handleUnregisters).toHaveLength(9);
    for (const unregister of withHandles.handleUnregisters) expect(unregister).toHaveBeenCalledTimes(1);
    expect(withHandles.unregisterTool).not.toHaveBeenCalled();

    const withFallback = mockDocument({ contextFallback: true });
    const fallbackRegistration = registerWebMcpTools({ getSession: () => null }, withFallback.documentLike);
    fallbackRegistration.cleanup();
    expect(withFallback.unregisterTool.mock.calls.map(([name]) => name)).toEqual([...WEBMCP_TOOL_NAMES].reverse());
  });

  it('does not claim support without the imperative API or inside an iframe', () => {
    expect(registerWebMcpTools({ getSession: () => null }, {})).toMatchObject({
      supported: false,
      registeredToolNames: [],
    });
    const frameView = { top: {} };
    const registerTool = vi.fn();
    const framedDocument = { defaultView: frameView, modelContext: { registerTool } } as unknown as WebMcpDocumentLike;
    expect(registerWebMcpTools({ getSession: () => null }, framedDocument).supported).toBe(false);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it('matches direct application DTOs, revisions, reason codes, and Decision hashes', () => {
    const direct = createAiSession({ initial: { seed: 63 }, preferredCommentLocale: 'ja' });
    const throughWebMcp = createAiSession({ initial: { seed: 63 }, preferredCommentLocale: 'ja' });
    const mock = mockDocument();
    registerWebMcpTools({ getSession: () => throughWebMcp }, mock.documentLike);

    const directContext = direct.getContext();
    const webContext = definitionByName(mock.definitions, 'nlth_get_context').execute();
    expect(webContext).toEqual(directContext);
    const legalInput = { generation: 1, baseRevision: 0, pageSize: 1 };
    const directLegal = direct.getLegalActions(legalInput);
    const webLegal = definitionByName(mock.definitions, 'nlth_legal_actions').execute(legalInput);
    expect(webLegal).toEqual(directLegal);
    if (!directLegal.ok || directLegal.actions.length !== 1) throw new Error('expected one legal action');

    const input = {
      generation: 1,
      baseRevision: 0,
      requestId: 'same-decision',
      action: directLegal.actions[0]!,
      decisionSummary: '同じコメント',
      requestedCommentLocale: 'ja' as const,
    };
    const directResult = direct.act(input);
    const webResult = definitionByName(mock.definitions, 'nlth_act').execute(input);
    expect(webResult).toEqual(directResult);
    expect(webResult).toMatchObject({
      ok: true,
      revision: 1,
      record: {
        reasonCode: directResult.ok ? directResult.record.reasonCode : undefined,
        decisionHash: directResult.ok ? directResult.record.decisionHash : undefined,
      },
    });
  });

  it('preserves requestId idempotency and conflicts through the WebMCP act surface', () => {
    const session = createAiSession({ initial: { seed: 64 } });
    const mock = mockDocument();
    registerWebMcpTools({ getSession: () => session }, mock.documentLike);
    const act = definitionByName(mock.definitions, 'nlth_act');
    const legal = session.getLegalActions({ generation: 1, baseRevision: 0, pageSize: 2 });
    if (!legal.ok || legal.actions.length < 2) throw new Error('expected at least two legal actions');
    const input = {
      generation: 1,
      baseRevision: 0,
      requestId: 'idempotent-webmcp-request',
      action: legal.actions[0]!,
      decisionSummary: 'original',
      requestedCommentLocale: 'en' as const,
    };

    const first = act.execute(input);
    expect(act.execute(input)).toEqual(first);
    expect(act.execute({ ...input, action: legal.actions[1] })).toMatchObject({
      ok: false,
      error: { code: 'request_id_conflict' },
    });
    expect(act.execute({ ...input, decisionSummary: 'changed' })).toMatchObject({
      ok: false,
      error: { code: 'request_id_conflict' },
    });
    expect(act.execute({ ...input, requestedCommentLocale: 'ja' })).toMatchObject({
      ok: false,
      error: { code: 'request_id_conflict' },
    });
  });
});
