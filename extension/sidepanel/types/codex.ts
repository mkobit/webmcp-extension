/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: T;
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: JsonRpcError;
}

export interface ReasoningEffortOption {
  reasoningEffort: string;
  description?: string;
}

export interface CodexModel {
  id: string;
  displayName: string;
  supportedReasoningEfforts?: ReasoningEffortOption[];
  defaultReasoningEffort?: string;
  isDefault?: boolean;
}

export interface CodexModelListResponse {
  data: CodexModel[];
  nextCursor?: string | null;
}

export interface DynamicToolSpec {
  type: 'function';
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  namespace?: string | null;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface DynamicToolCallContentItem {
  type: 'inputText';
  text: string;
}

export interface DynamicToolCallResponse {
  success: boolean;
  contentItems: DynamicToolCallContentItem[];
}

export interface CodexInitializeParams {
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities?: Record<string, unknown>;
}

export interface CodexThreadStartParams {
  model?: string;
  dynamicTools?: DynamicToolSpec[];
  cwd?: string;
}

export interface CodexThreadStartResponse {
  thread: {
    id: string;
  };
}

export interface CodexTurnInputItem {
  type: 'text';
  text: string;
  text_elements?: unknown[];
}

export interface CodexTurnStartParams {
  threadId: string;
  model?: string;
  effort?: string;
  input: CodexTurnInputItem[];
}

export interface CodexTurnStartResponse {
  turn?: {
    id: string;
    status?: string;
  };
}

export interface CodexTurnCompletedNotification {
  threadId: string;
  turn: {
    id: string;
    status?: string;
    error?: unknown;
  };
}

export interface CodexAgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId?: string;
  delta: string;
}
