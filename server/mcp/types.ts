/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface McpToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolInputSchema;
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    logging?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface McpListToolsResult {
  tools: McpTool[];
}

export interface McpCallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpCallToolResult {
  content: McpTextContent[];
  isError?: boolean;
}
