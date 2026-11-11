/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type {
  McpTool,
  McpInitializeResult,
  McpListToolsResult,
  McpCallToolParams,
  McpCallToolResult,
} from './types.ts';
import type { JsonRpcRequest, JsonRpcResponse } from '../acp/types.ts';

const MAX_TOOL_RESPONSE_CHARS = 8000;

export interface WebMcpToolEntry {
  name?: unknown;
  description?: string;
  parameters?: unknown;
  inputSchema?: unknown;
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
}

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ result?: unknown; error?: string }>;

export interface PendingToolApproval {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  consequentialHint?: boolean;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
}

export class McpServer {
  private tools: Map<string, WebMcpToolEntry> = new Map();
  private pendingApprovals: Map<string, PendingToolApproval> = new Map();
  private executor?: ToolExecutor;

  constructor(options: { executor?: ToolExecutor } = {}) {
    this.executor = options.executor;
  }

  public setExecutor(executor: ToolExecutor): void {
    this.executor = executor;
  }

  public setTools(tools: WebMcpToolEntry[]): void {
    this.tools.clear();
    for (const tool of tools) {
      if (tool && typeof tool.name === 'string') {
        this.tools.set(tool.name, tool);
      }
    }
  }

  public getTools(): McpTool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: String(tool.name),
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? tool.parameters ?? { type: 'object' }) as McpTool['inputSchema'],
      readOnlyHint: tool.readOnlyHint,
      consequentialHint: tool.consequentialHint,
      untrustedContentHint: tool.untrustedContentHint,
    }));
  }

  public getPendingApprovals(): Array<{ callId: string; name: string; args: Record<string, unknown> }> {
    return Array.from(this.pendingApprovals.values()).map(({ callId, name, args }) => ({
      callId,
      name,
      args,
    }));
  }

  public resolveApproval(callId: string, decision: { approved: boolean; reason?: string }): boolean {
    const pending = this.pendingApprovals.get(callId);
    if (!pending) {
      return false;
    }
    this.pendingApprovals.delete(callId);
    pending.resolve(decision);
    return true;
  }

  public async handleJsonRpc(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse | null> {
    const { id, method, params } = request;

    if (method === 'initialize') {
      const result: McpInitializeResult = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'webmcp-companion-mcp',
          version: '1.0.0',
        },
      };
      return { jsonrpc: '2.0', id, result };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'tools/list') {
      const result: McpListToolsResult = {
        tools: this.getTools(),
      };
      return { jsonrpc: '2.0', id, result };
    }

    if (method === 'tools/call') {
      const callParams = params as McpCallToolParams;
      const toolName = callParams?.name;
      const toolArgs = callParams?.arguments ?? {};

      const toolEntry = this.tools.get(toolName);
      if (!toolEntry) {
        const errorResult: McpCallToolResult = {
          content: [{ type: 'text', text: `Tool "${toolName}" is not registered on this tab.` }],
          isError: true,
        };
        return { jsonrpc: '2.0', id, result: errorResult };
      }

      // Check if consequential tool approval is required
      if (toolEntry.consequentialHint) {
        const callId = randomUUID();
        const decisionPromise = new Promise<{ approved: boolean; reason?: string }>((resolve) => {
          this.pendingApprovals.set(callId, {
            callId,
            name: toolName,
            args: toolArgs,
            consequentialHint: true,
            resolve,
          });
        });

        const decision = await decisionPromise;
        if (!decision.approved) {
          const denialResult: McpCallToolResult = {
            content: [{ type: 'text', text: `Tool call "${toolName}" was denied by the user: ${decision.reason || 'User rejected permission.'}` }],
            isError: true,
          };
          return { jsonrpc: '2.0', id, result: denialResult };
        }
      }

      if (!this.executor) {
        const fallbackResult: McpCallToolResult = {
          content: [{ type: 'text', text: JSON.stringify({ status: 'ok', tool: toolName, args: toolArgs }) }],
        };
        return { jsonrpc: '2.0', id, result: fallbackResult };
      }

      try {
        const executionOutcome = await this.executor(toolName, toolArgs);
        if (executionOutcome.error) {
          const errorResult: McpCallToolResult = {
            content: [{ type: 'text', text: executionOutcome.error }],
            isError: true,
          };
          return { jsonrpc: '2.0', id, result: errorResult };
        }

        let rawOutput = '';
        if (typeof executionOutcome.result === 'string') {
          rawOutput = executionOutcome.result;
        } else {
          rawOutput = JSON.stringify(executionOutcome.result ?? null);
        }

        // Apply spotlighting if untrustedContentHint is true
        if (toolEntry.untrustedContentHint) {
          rawOutput = Buffer.from(rawOutput, 'utf-8').toString('base64');
        }

        // Truncate to MAX_TOOL_RESPONSE_CHARS
        if (rawOutput.length > MAX_TOOL_RESPONSE_CHARS) {
          rawOutput = rawOutput.slice(0, MAX_TOOL_RESPONSE_CHARS) + '... [truncated]';
        }

        const successResult: McpCallToolResult = {
          content: [{ type: 'text', text: rawOutput }],
        };
        return { jsonrpc: '2.0', id, result: successResult };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorResult: McpCallToolResult = {
          content: [{ type: 'text', text: `Execution failed: ${errorMsg}` }],
          isError: true,
        };
        return { jsonrpc: '2.0', id, result: errorResult };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method "${method}" not found`,
      },
    };
  }
}
