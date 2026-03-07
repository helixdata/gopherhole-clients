/**
 * A2A Channel Plugin for OpenClaw
 * Enables communication with other AI agents via A2A protocol
 */

// Use minimal type imports - mostly self-contained
const DEFAULT_ACCOUNT_ID = 'default';
function normalizeAccountId(id?: string): string {
  return id?.trim()?.toLowerCase() || DEFAULT_ACCOUNT_ID;
}

import { A2AConnectionManager } from './connection.js';
import { sendChatMessage, connectToGateway, disconnectFromGateway } from './gateway-client.js';
import type {
  A2AMessage,
  A2AChannelConfig,
  ResolvedA2AAccount,
} from './types.js';

// Minimal runtime interface - what we actually need
interface OpenClawRuntime {
  handleInbound(params: {
    channel: string;
    chatId: string;
    userId: string;
    username?: string;
    text: string;
    isGroup: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<{ text?: string } | null>;
}

// Runtime state
let connectionManager: A2AConnectionManager | null = null;
let currentRuntime: OpenClawRuntime | null = null;

export function setA2ARuntime(runtime: unknown): void {
  currentRuntime = runtime as OpenClawRuntime;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenClawConfig = any;

// Minimal channel plugin interfaces (self-contained)
interface ChannelAccountSnapshot {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChannelPlugin<T = any> = {
  id: string;
  meta: unknown;
  capabilities: unknown;
  reload?: unknown;
  config: {
    listAccountIds: (cfg: unknown) => string[];
    resolveAccount: (cfg: unknown, accountId?: string) => T;
    defaultAccountId: (cfg: unknown) => string;
    setAccountEnabled: (opts: { cfg: unknown; accountId?: string; enabled: boolean }) => unknown;
    deleteAccount: (opts: { cfg: unknown; accountId: string }) => unknown;
    isConfigured: (account: T) => boolean;
    describeAccount: (account: T) => ChannelAccountSnapshot;
    resolveAllowFrom: (opts: { cfg: unknown; accountId?: string }) => string[];
    formatAllowFrom: (opts: { allowFrom: string[] }) => string[];
  };
  security?: unknown;
  messaging?: unknown;
  setup?: unknown;
  outbound?: unknown;
  status?: unknown;
  gateway?: {
    startAccount: (ctx: {
      account: T;
      cfg: unknown;
      accountId: string;
      runtime: unknown;
      abortSignal?: AbortSignal;
      setStatus: (status: Record<string, unknown>) => void;
      log?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
    }) => Promise<(() => Promise<void>) | void>;
  };
};

function resolveA2AConfig(cfg: OpenClawConfig): A2AChannelConfig {
  return cfg?.channels?.a2a ?? {};
}

function resolveA2AAccount(opts: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedA2AAccount {
  const config = resolveA2AConfig(opts.cfg);
  const accountId = opts.accountId ?? DEFAULT_ACCOUNT_ID;

  return {
    accountId,
    name: config.agentName ?? 'A2A',
    enabled: config.enabled ?? false,
    configured: !!(config.bridgeUrl && config.apiKey),
    agentId: config.agentId ?? 'openclaw',
    bridgeUrl: config.bridgeUrl ?? null,
    config,
  };
}

const meta = {
  id: 'a2a',
  label: 'A2A',
  selectionLabel: 'A2A (Agent-to-Agent)',
  detailLabel: 'A2A Protocol',
  docsPath: '/channels/a2a',
  docsLabel: 'a2a',
  blurb: 'Communicate with other AI agents via GopherHole A2A protocol.',
  systemImage: 'bubble.left.and.bubble.right',
  aliases: ['agent2agent', 'gopherhole'],
  order: 200,
};

export const a2aPlugin: ChannelPlugin<ResolvedA2AAccount> = {
  id: 'a2a',
  meta,
  capabilities: {
    chatTypes: ['direct'],
    media: false,      // Text-only for now
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
  },
  reload: { configPrefixes: ['channels.a2a'] },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) =>
      resolveA2AAccount({ cfg: cfg as OpenClawConfig, accountId }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => {
      const next = cfg as OpenClawConfig;
      return {
        ...next,
        channels: {
          ...next.channels,
          a2a: {
            ...(next.channels as Record<string, unknown>)?.a2a as object,
            enabled,
          },
        },
      } as OpenClawConfig;
    },
    deleteAccount: ({ cfg }) => cfg as OpenClawConfig,
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: () => [],
    formatAllowFrom: ({ allowFrom }) => allowFrom,
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: 'open',  // A2A connections are pre-configured, no pairing needed
      allowFrom: [],
      policyPath: 'channels.a2a.dmPolicy',
      allowFromPath: 'channels.a2a.',
      approveHint: '',
      normalizeEntry: (raw) => raw,
    }),
    collectWarnings: () => [],
  },
  messaging: {
    normalizeTarget: (target) => target?.trim() ?? '',
    targetResolver: {
      looksLikeId: (id) => /^[a-z0-9_@-]+$/i.test(id),
      hint: '<agentId> (e.g. @memory, @echo)',
    },
    formatTargetDisplay: ({ target }) => target ?? '',
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg }) => cfg as OpenClawConfig,
    validateInput: ({ input }) => {
      if (!input.httpUrl && !input.customArgs) {
        return 'A2A requires --http-url (bridge URL) or bridgeUrl + apiKey in config.';
      }
      return null;
    },
    applyAccountConfig: ({ cfg, input }) => {
      const next = cfg as OpenClawConfig;
      return {
        ...next,
        channels: {
          ...next.channels,
          a2a: {
            ...(next.channels as Record<string, unknown>)?.a2a as object,
            enabled: true,
            ...(input.httpUrl ? { bridgeUrl: input.httpUrl } : {}),
          },
        },
      } as OpenClawConfig;
    },
  },
  outbound: {
    deliveryMode: 'direct',
    textChunkLimit: 10000,
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error('A2A requires --to <agentId>'),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ to, text }) => {
      if (!connectionManager) {
        return { channel: 'a2a', success: false, error: 'A2A not connected' };
      }
      try {
        const response = await connectionManager.sendMessage(to, text);
        return {
          channel: 'a2a',
          success: true,
          messageId: response.status,
          response: response.text,
        };
      } catch (err) {
        return {
          channel: 'a2a',
          success: false,
          error: (err as Error).message,
        };
      }
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: () => [],
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async () => ({ ok: connectionManager !== null }),
    buildAccountSnapshot: async ({ account, runtime }) => {
      const connectionStatus = connectionManager?.listAgents() ?? [];
      const availableAgents = await connectionManager?.listAvailableAgents() ?? [];
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        running: runtime?.running ?? false,
        connected: connectionStatus.some((a) => a.connected),
        hubStatus: connectionStatus,
        availableAgents,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const config = account.config;

      ctx.log?.info(`[a2a] Starting A2A channel`);
      ctx.setStatus({ accountId: account.accountId });

      connectionManager = new A2AConnectionManager(config);

      // Set up message handler for incoming messages
      connectionManager.setMessageHandler(async (agentId: string, message: A2AMessage) => {
        if (message.type === 'message' && message.from) {
          const text = message.content?.parts
            ?.filter((p) => p.kind === 'text')
            .map((p) => p.text)
            .join('\n') ?? '';

          if (!text) return;

          // Route to OpenClaw's reply pipeline via gateway JSON-RPC
          try {
            ctx.log?.info(`[a2a] Routing message from ${message.from}: "${text.slice(0, 100)}..."`);
            
            // Use chat.send to route the message through the agent
            // Session key format: agent:<agentId>:<channel>:<chatId>
            const sessionKey = `agent:main:a2a:${message.from}`;
            const response = await sendChatMessage(sessionKey, text);

            ctx.log?.info(`[a2a] chat.send returned: ${response ? `text=${response.text?.slice(0, 50)}...` : 'null'}`);

            // Send response back to the agent via GopherHole
            if (response?.text) {
              connectionManager?.sendResponseViaGopherHole(
                message.from,
                message.taskId,
                response.text,
                message.contextId
              );
            }
          } catch (err) {
            ctx.log?.error(`[a2a] Error handling message:`, err);
            connectionManager?.sendResponseViaGopherHole(
              message.from,
              message.taskId,
              `Error: ${(err as Error).message}`,
              message.contextId
            );
          }
        }
      });

      await connectionManager.start();

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      ctx.log?.info(`[a2a] A2A channel started`);

      // Return cleanup function
      return async () => {
        ctx.log?.info(`[a2a] Stopping A2A channel`);
        await connectionManager?.stop();
        connectionManager = null;
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastStopAt: Date.now(),
        });
      };
    },
  },
};

/**
 * Get the connection manager for direct access (e.g., from tools)
 */
export function getA2AConnectionManager(): A2AConnectionManager | null {
  return connectionManager;
}
