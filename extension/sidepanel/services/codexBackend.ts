/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CodexClient } from './codexClient.js';
import {
  buildCodexDynamicTools,
  handleCodexToolCall,
  type ToolExecutionOptions,
} from './codexToolBridge.js';
import { tabSessions } from './tabSessionStore.js';
import type {
  ChatTurnRequest,
  ChatTurnResponse,
  WebMCPTool,
} from '../types/index.js';
import type {
  CodexThreadStartResponse,
  CodexTurnStartResponse,
} from '../types/codex.js';

export interface CodexChatTurnOptions {
  tabId: number;
  origin?: string;
  tools?: WebMCPTool[];
  client?: CodexClient;
  port?: number;
  model?: string;
  effort?: string;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  sensitiveActionAlerts?: boolean;
  onRequestPermission?: ToolExecutionOptions['onRequestPermission'];
  executeTool?: ToolExecutionOptions['executeTool'];
  onTabChanged?: (tabId: number) => void;
}

interface ActiveTurnContext {
  tabId: number;
  text: string;
  onText?: (text: string) => void;
  toolOptions: ToolExecutionOptions;
  resolve: (res: ChatTurnResponse) => void;
  reject: (err: any) => void;
}

let defaultClient: CodexClient | null = null;
const initializedClients = new WeakSet<CodexClient>();
const activeTurnContexts = new Map<string, ActiveTurnContext>();

export function getCodexClient(): CodexClient {
  if (!defaultClient) {
    defaultClient = new CodexClient();
  }
  return defaultClient;
}

function ensureClientHandlers(client: CodexClient): void {
  if (initializedClients.has(client)) return;
  initializedClients.add(client);

  client.onNotification('item/agentMessage/delta', (params: any) => {
    if (!params?.threadId) return;
    const ctx = activeTurnContexts.get(params.threadId);
    if (ctx) {
      ctx.text += params.delta ?? '';
      ctx.onText?.(ctx.text);
    }
  });

  client.onNotification('turn/completed', (params: any) => {
    if (!params?.threadId) return;
    const ctx = activeTurnContexts.get(params.threadId);
    if (ctx) {
      activeTurnContexts.delete(params.threadId);
      const internals = tabSessions.getInternals(ctx.tabId);
      internals.codexTurnId = undefined;
      ctx.resolve({ chatId: params.threadId, text: ctx.text });
    }
  });

  client.onServerRequest('item/tool/call', async (_id: number | string, params: any) => {
    const ctx = activeTurnContexts.get(params?.threadId);
    if (!ctx) {
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: 'Turn not found or completed' }],
      };
    }
    return handleCodexToolCall(params, ctx.toolOptions);
  });

  client.onDisconnect((error: Error) => {
    for (const [threadId, ctx] of activeTurnContexts.entries()) {
      activeTurnContexts.delete(threadId);
      const internals = tabSessions.getInternals(ctx.tabId);
      internals.codexTurnId = undefined;
      ctx.reject(error);
    }
  });
}

export async function interruptCodexTurn(
  tabId: number,
  client?: CodexClient
): Promise<void> {
  const c = client ?? getCodexClient();
  const internals = tabSessions.getInternals(tabId);
  const threadId = internals.codexThreadId;
  const turnId = internals.codexTurnId;

  if (threadId && turnId && c.isConnected()) {
    try {
      await c.sendRequest('turn/interrupt', { threadId, turnId });
    } catch {
      // Ignore failure to interrupt
    }
  }
  internals.codexTurnId = undefined;
}

export async function sendCodexChatTurn(
  request: ChatTurnRequest,
  options: CodexChatTurnOptions
): Promise<ChatTurnResponse> {
  const client = options.client ?? getCodexClient();
  const port = options.port ?? 45123;

  if (!client.isConnected() || client.getPort() !== port) {
    await client.connect(port);
  }

  ensureClientHandlers(client);

  const internals = tabSessions.getInternals(options.tabId);
  let threadId = internals.codexThreadId;

  if (!threadId) {
    const dynamicTools = buildCodexDynamicTools(options.tools ?? []);
    const threadRes = await client.sendRequest<CodexThreadStartResponse>('thread/start', {
      model: options.model,
      dynamicTools,
    });
    threadId = threadRes.thread.id;
    internals.codexThreadId = threadId;
    internals.chatId = threadId;
  }

  const toolOptions: ToolExecutionOptions = {
    tabId: options.tabId,
    origin: options.origin ?? '',
    tools: options.tools ?? [],
    sensitiveActionAlerts: options.sensitiveActionAlerts,
    onRequestPermission: options.onRequestPermission,
    executeTool: options.executeTool,
    onTabChanged: options.onTabChanged,
  };

  return new Promise<ChatTurnResponse>((resolve, reject) => {
    const ctx: ActiveTurnContext = {
      tabId: options.tabId,
      text: '',
      onText: options.onText,
      toolOptions,
      resolve,
      reject,
    };

    activeTurnContexts.set(threadId!, ctx);

    const onAbort = () => {
      void interruptCodexTurn(options.tabId, client);
      activeTurnContexts.delete(threadId!);
      resolve({ chatId: threadId, text: ctx.text });
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    options.signal?.addEventListener('abort', onAbort, { once: true });

    client
      .sendRequest<CodexTurnStartResponse>('turn/start', {
        threadId,
        model: options.model,
        effort: options.effort,
        input: [
          {
            type: 'text',
            text: request.message ?? '',
          },
        ],
      })
      .then((turnRes) => {
        if (turnRes?.turn?.id) {
          internals.codexTurnId = turnRes.turn.id;
        }
      })
      .catch((err) => {
        activeTurnContexts.delete(threadId!);
        options.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}
