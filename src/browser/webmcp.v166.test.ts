import { expect, it, vi } from 'vitest';
import { createAiSession } from '../session/ai-session';
import { registerWebMcpTools, WEBMCP_TOOL_NAMES, type WebMcpDocumentLike } from './webmcp';

function harness() {
  const view: { top?: unknown } = {}; view.top = view;
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const signals: AbortSignal[] = [];
  const definitions: Array<{ name: string; execute: (input: unknown) => unknown }> = [];
  const context = {
    registerTool: vi.fn((definition: typeof definitions[number], options: { signal: AbortSignal }) => {
      signals.push(options.signal); definitions.push(definition);
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    }),
    getTools: vi.fn(async () => definitions.map(d => ({ name: d.name, window: view, origin: 'https://example.test' }))),
    executeTool: vi.fn(async (tool: { name: string }, input: unknown) => JSON.stringify(definitions.find(d => d.name === tool.name)!.execute(input))),
  };
  return { view, pending, signals, definitions, context, document: { defaultView: view, modelContext: context } as unknown as WebMcpDocumentLike };
}
it('awaits all nine promises, then checks discovery and real read-only session execution', async () => {
  const h = harness(); let session: ReturnType<typeof createAiSession> | null = null;
  const r = registerWebMcpTools({ getSession: () => session }, h.document);
  expect(r.diagnostics()).toMatchObject({ registration: 'registering', session: 'inactive', ready: false });
  h.pending.slice(0, 8).forEach(p => p.resolve()); await Promise.resolve();
  expect(r.diagnostics()).toMatchObject({ fulfilledToolCount: 8, ready: false });
  h.pending[8]!.resolve(); await r.ready;
  expect(r.diagnostics()).toMatchObject({ registration: 'registered', selfTest: 'passed', registeredToolCount: 9, session: 'inactive', ready: false });
  session = createAiSession({ initial: { seed: 4 } }); const before = session.getContext();
  await r.smokeTest();
  expect(session.getContext()).toEqual(before);
  expect(r.diagnostics()).toMatchObject({ smokeTest: 'passed', session: 'active', ready: true, hostDiscovery: 'host_discovery_unverified' });
  h.context.executeTool.mockResolvedValueOnce(JSON.stringify({ ok: false, error: { code: 'unsupported' } }));
  await r.smokeTest(); expect(r.diagnostics().smokeTest).toBe('failed');
  r.cleanup(); r.cleanup(); expect(h.signals.every(s => s.aborted)).toBe(true);
});
it.each(['throw', 'reject'] as const)('handles %s without advertising a partial registration', async failure => {
  const h = harness();
  if (failure === 'throw') h.context.registerTool.mockImplementationOnce(() => { throw new TypeError('private detail'); });
  const r = registerWebMcpTools({ getSession: () => null }, h.document);
  h.pending.forEach((p, i) => i === 0 && failure === 'reject' ? p.reject(new TypeError('private detail')) : p.resolve());
  await r.ready;
  expect(r.diagnostics()).toMatchObject({ registration: 'registration_failed', registeredToolCount: 0, ready: false });
  expect(JSON.stringify(r.diagnostics())).not.toContain('private detail');
  expect(h.signals.every(s => s.aborted)).toBe(true);
});
it('ignores stale completions and foreign windows, flags own missing or extra names', async () => {
  const h = harness();
  const old = registerWebMcpTools({ getSession: () => null }, h.document);
  const oldPending = [...h.pending]; h.pending.length = 0; h.definitions.length = 0;
  const fresh = registerWebMcpTools({ getSession: () => null }, h.document);
  h.context.getTools.mockResolvedValueOnce([...WEBMCP_TOOL_NAMES.slice(1).map(name => ({ name, window: h.view, origin: 'https://example.test' })), { name: 'nlth_extra' as never, window: h.view, origin: 'https://example.test' }, { name: 'nlth_get_context' as never, window: {}, origin: 'https://example.test' }]);
  oldPending.forEach(p => p.resolve()); h.pending.forEach(p => p.resolve());
  await Promise.all([old.ready, fresh.ready]);
  expect(old.diagnostics().registration).toBe('cleaned');
  expect(fresh.diagnostics()).toMatchObject({ selfTest: 'failed', missingToolNames: ['nlth_get_context'], unexpectedToolNames: ['nlth_extra'], ready: false });
});
it('reports unavailable draft APIs separately from successful registration', async () => {
  const h = harness(); delete (h.context as Partial<typeof h.context>).getTools; delete (h.context as Partial<typeof h.context>).executeTool;
  const r = registerWebMcpTools({ getSession: () => null }, h.document); h.pending.forEach(p => p.resolve()); await r.ready;
  expect(r.diagnostics()).toMatchObject({ registration: 'registered', selfTest: 'unavailable', smokeTest: 'unavailable', ready: false });
});
it('does not mistake a host shim without Draft window identity for nine missing tools', async () => {
  const h = harness();
  h.context.getTools.mockResolvedValueOnce(WEBMCP_TOOL_NAMES.map(name => ({ name, origin: 'https://example.test' })) as never);
  const session = createAiSession({ initial: { seed: 4 } });
  const r = registerWebMcpTools({ getSession: () => session }, h.document);
  h.pending.forEach(p => p.resolve()); await r.ready; await r.smokeTest();
  expect(r.diagnostics()).toMatchObject({ registration: 'registered', registeredToolCount: 9,
    selfTest: 'unavailable', selfTestUnavailableReason: 'registered_tool_window_unavailable', smokeTest: 'unavailable',
    ready: true, missingToolNames: [], hostDiscovery: 'host_discovery_unverified' });
  expect(h.context.executeTool).not.toHaveBeenCalled();
});
