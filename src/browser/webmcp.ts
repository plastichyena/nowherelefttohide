import type {
  AiSessionActInput,
  AiSessionLegalActionsInput,
  AiSessionPort,
  AiSessionPreviewInput,
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
  registerTool: (definition: WebMcpToolDefinition) => WebMcpRegistrationHandle | void;
  unregisterTool?: (name: string) => void;
}

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
  cleanup(): void;
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

/**
 * Registers the fixed v1.6 WebMCP surface on the top-level imperative API.
 * Session lifecycle remains UI-owned; registrations resolve the current Session per invocation.
 */
export function registerWebMcpTools(
  host: WebMcpHost,
  documentLike: WebMcpDocumentLike | null = currentDocument(),
): WebMcpRegistration {
  const modelContext = documentLike?.modelContext;
  if (!documentLike || !isTopLevel(documentLike) || typeof modelContext?.registerTool !== 'function') {
    return { supported: false, registeredToolNames: [], cleanup: () => undefined };
  }

  const registered: Array<{ name: WebMcpToolName; handle: WebMcpRegistrationHandle | void }> = [];
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const entry of [...registered].reverse()) {
      let removed = false;
      if (typeof entry.handle?.unregister === 'function') {
        try {
          entry.handle.unregister();
          removed = true;
        } catch {
          // Some implementations expose both forms; use the context fallback below.
        }
      }
      if (!removed && typeof modelContext.unregisterTool === 'function') {
        try {
          modelContext.unregisterTool(entry.name);
        } catch {
          // Cleanup is best-effort and must continue unregistering the remaining tools.
        }
      }
    }
  };

  try {
    for (const definition of toolDefinitions(host)) {
      registered.push({ name: definition.name, handle: modelContext.registerTool(definition) });
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    supported: true,
    registeredToolNames: WEBMCP_TOOL_NAMES,
    cleanup,
  };
}
