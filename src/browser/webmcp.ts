import { APP_VERSION } from '../agent/types';
import type {
  AiSessionActInput,
  AiSessionLegalActionsInput,
  AiSessionPort,
  AiSessionPreviewInput,
  AiSessionBatchPreviewInput,
  AiSessionQueryInput,
} from '../session/ai-session-contract';

/** The WebMCP global is intentionally kept out of the transport-neutral Session contract. */
interface WebMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface WebMcpToolDefinition {
  name: WebMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: WebMcpToolAnnotations;
  execute: (input: unknown) => unknown;
}

interface WebMcpRegistrationHandle {
  unregister?: () => void;
}

interface WebMcpModelContext {
  registerTool: (definition: WebMcpToolDefinition, options: { signal: AbortSignal }) => Promise<void> | WebMcpRegistrationHandle | void;
  getTools?: () => Promise<RegisteredTool[]>;
  executeTool?: (tool: RegisteredTool, input?: object, options?: { signal: AbortSignal }) => Promise<string>;
  unregisterTool?: (name: string) => void;
}

export interface RegisteredTool { name: string; window?: unknown; origin?: string }

export interface WebMcpDocumentLike {
  modelContext?: WebMcpModelContext;
  defaultView?: { readonly top?: unknown } | null;
}

export const WEBMCP_TOOL_NAMES = [
  'nlth_get_context',
  'nlth_observe',
  'nlth_query',
  'nlth_legal_actions',
  'nlth_preview_action',
  'nlth_preview_actions',
  'nlth_act',
  'nlth_get_request_result',
  'nlth_get_result',
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export interface WebMcpHost {
  /** Returns the live UI-owned Session, or null until the user starts AI play/watch. */
  getSession(): AiSessionPort | null | undefined;
  /** Optional UI sequencing hook used by the live viewer for act/render/hold. */
  act?(input: AiSessionActInput): unknown;
}

export interface WebMcpRegistration {
  supported: boolean;
  registeredToolNames: readonly WebMcpToolName[];
  ready: Promise<void>;
  diagnostics(): WebMcpDiagnostics;
  smokeTest(): Promise<void>;
  cleanup(): void;
}

export const WEBMCP_ADAPTER_VERSION = '2.0.0';
export interface WebMcpDiagnostics {
  appVersion: string; buildId: string; adapterVersion: string;
  registration: 'unsupported' | 'registering' | 'registration_failed' | 'registered' | 'cleaned';
  selfTest: 'unavailable' | 'pending' | 'passed' | 'failed';
  smokeTest: 'unavailable' | 'not_run' | 'passed' | 'failed';
  expectedToolCount: number; expectedToolNames: readonly string[];
  registeredToolCount: number; registeredToolNames: string[]; fulfilledToolCount: number;
  missingToolNames: string[]; unexpectedToolNames: string[];
  registrationErrors: Array<{ tool: string; category: string }>;
  availability: { registerTool: boolean; getTools: boolean; executeTool: boolean };
  selfTestUnavailableReason: 'get_tools_unavailable' | 'registered_tool_window_unavailable' | null;
  session: 'inactive' | 'active' | 'paused' | 'ended'; generation: number | null; revision: number | null;
  ready: boolean; hostDiscovery: 'host_discovery_unverified';
}

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const REVISION_PROPERTIES = {
  generation: { type: 'integer', minimum: 1 },
  baseRevision: { type: 'integer', minimum: 0 },
} as const;

const ACTION_SCHEMA = {
  type: 'object',
  description: 'One public GameAction. The AI Session validates the bounded action DTO and legality.',
  required: ['type'],
  properties: { type: { type: 'string', minLength: 1 } },
  additionalProperties: true,
} as const;

const QUERY_SCHEMA = {
  type: 'object',
  required: ['target'],
  properties: {
    ...REVISION_PROPERTIES,
    target: { type: 'string' },
    cursor: { type: 'string' },
    pageSize: { type: 'integer', minimum: 1, maximum: 500 },
    filters: { type: 'object' },
  },
  additionalProperties: false,
} as const;

const LEGAL_ACTIONS_SCHEMA = {
  type: 'object',
  properties: {
    ...REVISION_PROPERTIES,
    actionKind: { type: 'string' },
    cursor: { type: 'string' },
    pageSize: { type: 'integer', minimum: 1, maximum: 500 },
  },
  additionalProperties: false,
} as const;

const PREVIEW_ACTION_SCHEMA = {
  type: 'object',
  required: ['baseRevision', 'action'],
  properties: {
    ...REVISION_PROPERTIES,
    action: ACTION_SCHEMA,
  },
  additionalProperties: false,
} as const;

const ACT_SCHEMA = {
  type: 'object',
  required: ['generation', 'baseRevision', 'requestId', 'action'],
  properties: {
    ...REVISION_PROPERTIES,
    requestId: { type: 'string', minLength: 1, maxLength: 128 },
    action: ACTION_SCHEMA,
    decisionSummary: { type: ['string', 'null'], maxLength: 500 },
    requestedCommentLocale: { type: 'string', enum: ['ja', 'en'] },
  },
  additionalProperties: false,
} as const;

const REQUEST_RESULT_SCHEMA = {
  type: 'object',
  required: ['requestId'],
  properties: { requestId: { type: 'string', minLength: 1, maxLength: 128 } },
  additionalProperties: false,
} as const;

function unsupportedResult(): unknown {
  return {
    ok: false,
    generation: 0,
    revision: 0,
    error: {
      code: 'unsupported',
      message: 'AI play/watch session is not active',
    },
  };
}

function withSession(host: WebMcpHost, invoke: (session: AiSessionPort) => unknown): unknown {
  const session = host.getSession();
  return session ? invoke(session) : unsupportedResult();
}

function inputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function toolDefinitions(host: WebMcpHost): WebMcpToolDefinition[] {
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  return [
    {
      name: 'nlth_get_context',
      description: 'Get the active AI session contract, generation, revision, lifecycle, locale, and capabilities.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: readOnly,
      execute: () => withSession(host, (session) => session.getContext()),
    },
    {
      name: 'nlth_observe',
      description: 'Get the bounded public observation summary and available public query targets.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: readOnly,
      execute: () => withSession(host, (session) => session.observe()),
    },
    {
      name: 'nlth_query',
      description: 'Run one bounded public AI session query with optional filters and cursor pagination.',
      inputSchema: QUERY_SCHEMA,
      annotations: readOnly,
      execute: (input) => withSession(host, (session) => session.query(input as AiSessionQueryInput)),
    },
    {
      name: 'nlth_legal_actions',
      description: 'List a bounded page of legal GameActions for a revision, optionally filtered by action kind.',
      inputSchema: LEGAL_ACTIONS_SCHEMA,
      annotations: readOnly,
      execute: (input) => withSession(host, (session) => session.getLegalActions(input as AiSessionLegalActionsInput)),
    },
    {
      name: 'nlth_preview_action',
      description: 'Preview one GameAction at a required base revision without changing session state.',
      inputSchema: PREVIEW_ACTION_SCHEMA,
      annotations: readOnly,
      execute: (input) => withSession(host, (session) => session.previewAction(input as AiSessionPreviewInput)),
    },
    {
      name: 'nlth_preview_actions',
      description: 'Preview 1..100 GameActions independently from the same baseRevision, in input order. Does not simulate a sequence or mutate State, RNG, Decision or Revision.',
      inputSchema: {type:'object',required:['generation','baseRevision','actions'],properties:{...REVISION_PROPERTIES,actions:{type:'array',minItems:1,maxItems:100,items:ACTION_SCHEMA}},additionalProperties:false},
      annotations: readOnly,
      execute: (input) => withSession(host, (session) => session.previewActions(input as AiSessionBatchPreviewInput)),
    },
    {
      name: 'nlth_act',
      description: 'Submit one idempotent GameAction Decision using a unique requestId.',
      inputSchema: ACT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: (input) => host.act
        ? host.act(input as AiSessionActInput)
        : withSession(host, (session) => session.act(input as AiSessionActInput)),
    },
    {
      name: 'nlth_get_request_result',
      description: 'Get the accepted, completed, rejected, or timed-out result for one requestId.',
      inputSchema: REQUEST_RESULT_SCHEMA,
      annotations: readOnly,
      execute: (input) => withSession(host, (session) => session.getRequestResult(inputRecord(input).requestId as string)),
    },
    {
      name: 'nlth_get_result',
      description: 'Get the current not-finished or finished public game result.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: readOnly,
      execute: () => withSession(host, (session) => session.getResult()),
    },
  ];
}

function currentDocument(): WebMcpDocumentLike | null {
  return typeof document === 'undefined' ? null : document as unknown as WebMcpDocumentLike;
}

function isTopLevel(documentLike: WebMcpDocumentLike): boolean {
  const view = documentLike.defaultView;
  if (!view) return true;
  try {
    return view.top === view;
  } catch {
    return false;
  }
}

const registrations = new WeakMap<object, WebMcpRegistration>();
const errorCategory = (error: unknown): string => error instanceof Error && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'RegistrationError';

/** Async draft registration is independent of Session and host discovery. */
export function registerWebMcpTools(
  host: WebMcpHost,
  documentLike: WebMcpDocumentLike | null = currentDocument(),
  options: { buildId?: string; onChange?: () => void } = {},
): WebMcpRegistration {
  if (documentLike) registrations.get(documentLike)?.cleanup();
  const modelContext = documentLike?.modelContext;
  const supported = !!documentLike && isTopLevel(documentLike) && typeof modelContext?.registerTool === 'function';
  const controller = new AbortController();
  const fulfilled: WebMcpToolName[] = [];
  const legacy: Array<{ name: string; handle: WebMcpRegistrationHandle | void }> = [];
  let ownTools: RegisteredTool[] = [];
  let cleaned = false;
  let testGeneration = 0;
  const status: WebMcpDiagnostics = {
    appVersion: APP_VERSION, buildId: options.buildId ?? 'unknown', adapterVersion: WEBMCP_ADAPTER_VERSION,
    registration: supported ? 'registering' : 'unsupported',
    selfTest: typeof modelContext?.getTools === 'function' ? 'pending' : 'unavailable',
    smokeTest: typeof modelContext?.executeTool === 'function' && typeof modelContext?.getTools === 'function' ? 'not_run' : 'unavailable',
    expectedToolCount: WEBMCP_TOOL_NAMES.length, expectedToolNames: [...WEBMCP_TOOL_NAMES],
    registeredToolCount: 0, registeredToolNames: [], fulfilledToolCount: 0,
    missingToolNames: [...WEBMCP_TOOL_NAMES], unexpectedToolNames: [], registrationErrors: [],
    availability: { registerTool: supported, getTools: typeof modelContext?.getTools === 'function', executeTool: typeof modelContext?.executeTool === 'function' },
    selfTestUnavailableReason: typeof modelContext?.getTools === 'function' ? null : 'get_tools_unavailable',
    session: 'inactive', generation: null, revision: null, ready: false, hostDiscovery: 'host_discovery_unverified',
  };
  const notify = () => options.onChange?.();
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true; testGeneration++; controller.abort();
    for (const entry of [...legacy].reverse()) {
      try { if (entry.handle?.unregister) entry.handle.unregister(); else modelContext?.unregisterTool?.(entry.name); } catch { /* signal is authoritative */ }
    }
    status.registration = 'cleaned'; status.registeredToolCount = 0; status.registeredToolNames = []; notify();
  };
  const diagnostics = (): WebMcpDiagnostics => {
    const context = host.getSession()?.getContext();
    return structuredClone({ ...status, session: context?.lifecycle ?? 'inactive', generation: context?.generation ?? null, revision: context?.revision ?? null,
      ready: status.registration === 'registered' && ['passed','unavailable'].includes(status.selfTest) && status.smokeTest !== 'failed' && context?.lifecycle === 'active' });
  };
  const registration: WebMcpRegistration = {
    supported, get registeredToolNames() { return [...fulfilled]; }, cleanup, diagnostics, ready: Promise.resolve(),
    async smokeTest() {
      await registration.ready;
      const session = host.getSession();
      if (cleaned || !session || status.registration !== 'registered' || status.smokeTest === 'unavailable' || !modelContext?.executeTool || !modelContext.getTools) return;
      const token = ++testGeneration;
      const before = session.getContext();
      if (before.lifecycle !== 'active') return;
      try {
        const tool = ownTools.find(t => t.name === 'nlth_get_context');
        if (!tool) throw new Error('Missing context tool');
        const response = JSON.parse(await modelContext.executeTool(tool, {}, { signal: controller.signal }));
        if (cleaned || token !== testGeneration || host.getSession() !== session) return;
        const after = session.getContext();
        status.smokeTest = response && response.ok !== false && response.lifecycle === 'active' && response.generation === before.generation && response.revision === before.revision &&
          after.generation === before.generation && after.revision === before.revision ? 'passed' : 'failed';
      } catch { if (!cleaned && token === testGeneration) status.smokeTest = 'failed'; }
      notify();
    },
  };
  if (documentLike) registrations.set(documentLike, registration);
  if (!supported || !modelContext) return registration;
  const pending = toolDefinitions(host).map(definition => {
    let value: ReturnType<WebMcpModelContext['registerTool']>;
    try { value = modelContext.registerTool(definition, { signal: controller.signal }); }
    catch (error) { value = Promise.reject(error); }
    if (!value || !('then' in value)) legacy.push({ name: definition.name, handle: value as WebMcpRegistrationHandle | void });
    return Promise.resolve(value).then(() => {
      if (cleaned) return;
      fulfilled.push(definition.name); status.fulfilledToolCount = fulfilled.length;
    }, error => {
      if (cleaned) return;
      status.registrationErrors.push({ tool: definition.name, category: errorCategory(error) });
      status.registration = 'registration_failed'; controller.abort(); notify();
    });
  });
  registration.ready = Promise.all(pending).then(async () => {
    if (cleaned) return;
    if (status.registrationErrors.length) { status.registeredToolNames = []; status.registeredToolCount = 0; notify(); return; }
    fulfilled.sort((a,b) => WEBMCP_TOOL_NAMES.indexOf(a)-WEBMCP_TOOL_NAMES.indexOf(b));
    status.registration = 'registered'; status.registeredToolNames = [...fulfilled]; status.registeredToolCount = fulfilled.length; status.missingToolNames = [];
    if (modelContext.getTools) {
      try {
        const all = await modelContext.getTools();
        if (cleaned) return;
        // Some host shims expose getTools without the Draft's window identity.
        // Registration fulfillment is still valid; this API cannot verify scope.
        if (!documentLike?.defaultView || all.some(t => t.name.startsWith('nlth_') && t.window == null)) {
          status.selfTest = 'unavailable';
          status.selfTestUnavailableReason = 'registered_tool_window_unavailable';
          status.smokeTest = 'unavailable';
          notify();
          return;
        }
        ownTools = all.filter(t => t.window === documentLike?.defaultView && t.name.startsWith('nlth_'));
        const names = ownTools.map(t => t.name).sort();
        status.registeredToolNames = names; status.registeredToolCount = names.length;
        status.missingToolNames = WEBMCP_TOOL_NAMES.filter(n => !names.includes(n));
        status.unexpectedToolNames = names.filter(n => !WEBMCP_TOOL_NAMES.includes(n as WebMcpToolName));
        status.selfTest = names.length === WEBMCP_TOOL_NAMES.length && !status.missingToolNames.length && !status.unexpectedToolNames.length ? 'passed' : 'failed';
      } catch { if (!cleaned) status.selfTest = 'failed'; }
    }
    if (!cleaned) notify();
  });
  return registration;
}
