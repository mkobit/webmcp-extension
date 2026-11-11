/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
}

export interface AcpInitializeParams {
  protocolVersion: number;
  clientCapabilities: AcpClientCapabilities;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export interface AcpInitializeResult {
  protocolVersion: number;
  serverCapabilities?: Record<string, unknown>;
  serverInfo?: {
    name: string;
    version: string;
  };
}

export interface AcpMcpServerSpec {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AcpNewSessionParams {
  cwd: string;
  mcpServers?: AcpMcpServerSpec[];
}

export interface AcpConfigOption {
  id: string;
  name: string;
  category?: 'model' | 'thought_level' | string;
  currentValue?: string;
  options?: Array<{ id: string; name: string }>;
}

export interface AcpNewSessionResult {
  sessionId: string;
  configOptions?: AcpConfigOption[];
}

export interface AcpPromptParams {
  sessionId: string;
  prompt: string;
}

export interface AcpSessionUpdateNotification {
  sessionId: string;
  update: {
    type: 'text' | 'thought' | 'tool_call' | 'tool_result' | 'message';
    content?: string;
    delta?: string;
  };
}

export interface AcpRequestPermissionParams {
  sessionId: string;
  toolCallId?: string;
  title?: string;
  options?: Array<{ id: string; label: string }>;
}

export interface AcpRequestPermissionResult {
  granted: boolean;
  reason?: string;
}

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params: T;
}
