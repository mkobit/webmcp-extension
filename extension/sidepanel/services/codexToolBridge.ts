/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActivityEntry, WebMCPTool } from '../types/index.js';
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  DynamicToolSpec,
} from '../types/codex.js';
import { decodeToolName } from './toolEncoder.js';
import {
  applySpotlighting,
  applyTokenLimit,
  sanitizeTelemetryData,
  summarizeResult,
} from './toolResults.js';
import {
  applyToolPermissionDecision,
  isGrantEligible,
  needsToolPermission,
  type ToolPermissionDecision,
  type ToolPermissionQuery,
} from './toolPermissions.js';
import { executeTabTool } from './extensionBridge.js';
import { getFrameOrigin } from '../../frameOrigins.js';

let nextTelemetryId = Date.now();
const generateTelemetryId = (): number => ++nextTelemetryId;

export interface ToolExecutionOptions {
  tabId: number;
  origin: string;
  tools: WebMCPTool[];
  sensitiveActionAlerts?: boolean;
  onRequestPermission?: (prompt: {
    tool: WebMCPTool;
    args: Record<string, unknown>;
    consequential: boolean;
    canAllowAlways: boolean;
  }) => Promise<ToolPermissionDecision | boolean>;
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
    frameId: number,
    tabId: number,
    options?: { onTabChanged?: (tabId: number) => void }
  ) => Promise<unknown>;
  onTabChanged?: (tabId: number) => void;
  onToolTelemetry?: (entry: ActivityEntry) => void;
}

export function buildCodexDynamicTools(tools: WebMCPTool[] = []): DynamicToolSpec[] {
  return tools.map((tool) => {
    const frameId = tool.frameId ?? 0;
    const inputSchema =
      tool.inputSchema && typeof tool.inputSchema === 'object'
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} };

    return {
      type: 'function',
      name: `_${frameId}_${tool.name}`,
      description: tool.description || '',
      inputSchema,
    };
  });
}

export async function handleCodexToolCall(
  params: DynamicToolCallParams,
  options: ToolExecutionOptions
): Promise<DynamicToolCallResponse> {
  const startTime = performance.now();
  const { name, frameId = 0 } = decodeToolName(params.tool);
  const targetTool = options.tools.find(
    (tool) => tool.name === name && (tool.frameId ?? 0) === frameId
  );

  const permissionQuery: ToolPermissionQuery = {
    sensitiveActionAlerts: options.sensitiveActionAlerts,
    origin: options.origin,
    toolName: name,
    tabId: options.tabId,
    readOnlyHint: targetTool?.readOnlyHint,
    consequentialHint: targetTool?.consequentialHint,
    toolFrameId: frameId,
  };

  const sanitizedArgs = sanitizeTelemetryData(params.arguments);

  if (needsToolPermission(permissionQuery)) {
    if (!options.onRequestPermission) {
      const durationMs = Math.round(performance.now() - startTime);
      const frameOrigin =
        (await getFrameOrigin(options.tabId, frameId)) ??
        (frameId === 0 ? options.origin : undefined);
      options.onToolTelemetry?.({
        id: generateTelemetryId(),
        name,
        done: true,
        status: 'error',
        durationMs,
        frameId,
        frameOrigin,
        arguments: sanitizedArgs,
        errorMessage: 'User denied permission to execute this tool.',
        resultSummary: 'User denied permission to execute this tool.',
      });
      return {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text: 'User denied permission to execute this tool.',
          },
        ],
      };
    }

    const decision = await options.onRequestPermission({
      tool: targetTool ?? { name, frameId },
      args: params.arguments,
      consequential: targetTool?.consequentialHint === true,
      canAllowAlways: isGrantEligible(permissionQuery),
    });

    const normalizedDecision: ToolPermissionDecision =
      typeof decision === 'boolean' ? (decision ? 'allow' : 'deny') : decision;

    if (!applyToolPermissionDecision(normalizedDecision, permissionQuery)) {
      const durationMs = Math.round(performance.now() - startTime);
      const frameOrigin =
        (await getFrameOrigin(options.tabId, frameId)) ??
        (frameId === 0 ? options.origin : undefined);
      options.onToolTelemetry?.({
        id: generateTelemetryId(),
        name,
        done: true,
        status: 'error',
        durationMs,
        frameId,
        frameOrigin,
        arguments: sanitizedArgs,
        errorMessage: 'User denied permission to execute this tool.',
        resultSummary: 'User denied permission to execute this tool.',
      });
      return {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text: 'User denied permission to execute this tool.',
          },
        ],
      };
    }
  }

  const executor = options.executeTool ?? executeTabTool;

  try {
    const rawResult = await executor(
      name,
      params.arguments,
      frameId,
      options.tabId,
      { onTabChanged: options.onTabChanged }
    );

    const durationMs = Math.round(performance.now() - startTime);
    const frameOrigin =
      (await getFrameOrigin(options.tabId, frameId)) ??
      (frameId === 0 ? options.origin : undefined);
    const sanitizedRawResult = sanitizeTelemetryData(rawResult);
    const resultSummary = summarizeResult(sanitizedRawResult);

    options.onToolTelemetry?.({
      id: generateTelemetryId(),
      name,
      done: true,
      status: 'success',
      durationMs,
      frameId,
      frameOrigin,
      arguments: sanitizedArgs,
      rawResult: sanitizedRawResult,
      resultSummary,
    });

    const limited = applyTokenLimit(rawResult);
    const spotlighted = applySpotlighting(limited, targetTool);
    const text =
      typeof spotlighted === 'string'
        ? spotlighted
        : JSON.stringify(spotlighted);

    return {
      success: true,
      contentItems: [{ type: 'inputText', text }],
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    const frameOrigin =
      (await getFrameOrigin(options.tabId, frameId)) ??
      (frameId === 0 ? options.origin : undefined);
    const errorMessage = `Tool execution failed: ${err?.message ?? String(err)}`;
    options.onToolTelemetry?.({
      id: generateTelemetryId(),
      name,
      done: true,
      status: 'error',
      durationMs,
      frameId,
      frameOrigin,
      arguments: sanitizedArgs,
      errorMessage,
      resultSummary: errorMessage,
    });
    return {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: errorMessage,
        },
      ],
    };
  }
}
