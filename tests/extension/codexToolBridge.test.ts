/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexDynamicTools,
  handleCodexToolCall,
} from '../../extension/sidepanel/services/codexToolBridge.js';
import type { ActivityEntry, WebMCPTool } from '../../extension/sidepanel/types/index.js';
import { clearSessionToolPermissions } from '../../extension/sidepanel/services/toolPermissions.js';

test('buildCodexDynamicTools converts WebMCP tools with frame prefix encoding and fallback schema', () => {
  const tools: WebMCPTool[] = [
    {
      name: 'getFlights',
      description: 'Search flights',
      frameId: 0,
      inputSchema: {
        type: 'object',
        properties: { origin: { type: 'string' } },
        required: ['origin'],
      },
    },
    {
      name: 'bookHotel',
      frameId: 2,
      // Missing description and inputSchema
    },
  ];

  const dynamicTools = buildCodexDynamicTools(tools);
  assert.equal(dynamicTools.length, 2);
  assert.deepEqual(dynamicTools[0], {
    type: 'function',
    name: '_0_getFlights',
    description: 'Search flights',
    inputSchema: {
      type: 'object',
      properties: { origin: { type: 'string' } },
      required: ['origin'],
    },
  });
  assert.deepEqual(dynamicTools[1], {
    type: 'function',
    name: '_2_bookHotel',
    description: '',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  });
});

test('handleCodexToolCall executes tool and returns formatted response', async () => {
  const tools: WebMCPTool[] = [
    {
      name: 'search',
      frameId: 0,
      readOnlyHint: true,
    },
  ];

  let executedWith: any = null;
  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_search',
      arguments: { q: 'paris' },
    },
    {
      tabId: 1,
      origin: 'https://example.com',
      tools,
      executeTool: async (name, args, frameId, tabId) => {
        executedWith = { name, args, frameId, tabId };
        return { count: 3, items: ['A', 'B', 'C'] };
      },
    }
  );

  assert.deepEqual(executedWith, {
    name: 'search',
    args: { q: 'paris' },
    frameId: 0,
    tabId: 1,
  });
  assert.equal(response.success, true);
  assert.equal(response.contentItems.length, 1);
  assert.equal(response.contentItems[0].type, 'inputText');
  assert.equal(
    response.contentItems[0].text,
    JSON.stringify({ count: 3, items: ['A', 'B', 'C'] })
  );
});

test('handleCodexToolCall returns error when user denies permission', async () => {
  clearSessionToolPermissions(1);
  const tools: WebMCPTool[] = [
    {
      name: 'deleteAccount',
      frameId: 0,
      consequentialHint: true,
    },
  ];

  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_deleteAccount',
      arguments: {},
    },
    {
      tabId: 1,
      origin: 'https://example.com',
      tools,
      sensitiveActionAlerts: true,
      onRequestPermission: async () => 'deny',
      executeTool: async () => {
        throw new Error('Should not be executed');
      },
    }
  );

  assert.equal(response.success, false);
  assert.equal(response.contentItems.length, 1);
  assert.match(response.contentItems[0].text, /denied permission/i);
});

test('handleCodexToolCall truncates output exceeding 8,000 characters', async () => {
  const tools: WebMCPTool[] = [
    {
      name: 'largeOutput',
      frameId: 0,
      readOnlyHint: true,
    },
  ];

  const largeString = 'X'.repeat(10000);
  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_largeOutput',
      arguments: {},
    },
    {
      tabId: 1,
      origin: 'https://example.com',
      tools,
      executeTool: async () => largeString,
    }
  );

  assert.equal(response.success, true);
  const text = response.contentItems[0].text;
  assert.match(text, /WEBMCP_SECURITY_WARNING/);
  assert.ok(text.startsWith('X'.repeat(8000)));
});

test('handleCodexToolCall applies spotlighting when tool has untrustedContentHint', async () => {
  const tools: WebMCPTool[] = [
    {
      name: 'fetchHtml',
      frameId: 0,
      readOnlyHint: true,
      untrustedContentHint: true,
    },
  ];

  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_fetchHtml',
      arguments: {},
    },
    {
      tabId: 1,
      origin: 'https://example.com',
      tools,
      executeTool: async () => '<html>Unsafe content</html>',
    }
  );

  assert.equal(response.success, true);
  // Default spotlighting without fence base64 encodes untrusted output
  const text = response.contentItems[0].text;
  assert.notEqual(text, '<html>Unsafe content</html>');
  assert.equal(atob(text), '<html>Unsafe content</html>');
});

test('handleCodexToolCall records success telemetry with duration, origin, and arguments', async () => {
  const tools: WebMCPTool[] = [
    {
      name: 'calculate',
      frameId: 0,
      readOnlyHint: true,
    },
  ];

  let telemetryEntry: ActivityEntry | undefined;
  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_calculate',
      arguments: { expr: '2 + 2' },
    },
    {
      tabId: 10,
      origin: 'https://calc.example',
      tools,
      executeTool: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { result: 4 };
      },
      onToolTelemetry: (entry) => {
        telemetryEntry = entry;
      },
    }
  );

  assert.equal(response.success, true);
  assert.ok(telemetryEntry);
  assert.equal(telemetryEntry.name, 'calculate');
  assert.equal(telemetryEntry.done, true);
  assert.equal(telemetryEntry.status, 'success');
  assert.ok(typeof telemetryEntry.durationMs === 'number');
  assert.ok(telemetryEntry.durationMs >= 5);
  assert.equal(telemetryEntry.frameId, 0);
  assert.equal(telemetryEntry.frameOrigin, 'https://calc.example');
  assert.deepEqual(telemetryEntry.arguments, { expr: '2 + 2' });
  assert.deepEqual(telemetryEntry.rawResult, { result: 4 });
  assert.equal(telemetryEntry.resultSummary, '{"result":4}');
});

test('handleCodexToolCall redacts sensitive keys in telemetry', async () => {
  const tools: WebMCPTool[] = [
    {
      name: 'login',
      frameId: 0,
      readOnlyHint: true,
    },
  ];

  let telemetryEntry: ActivityEntry | undefined;
  await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_login',
      arguments: {
        username: 'alice',
        password: 'my-password', // betterleaks:allow
        auth_token: 'tok-123',
      },
    },
    {
      tabId: 10,
      origin: 'https://auth.example',
      tools,
      executeTool: async (_name, args) => {
        // Ensure execution received raw args
        assert.equal(args.password, 'my-password');
        return {
          sessionToken: 'session-secret-456',
          status: 'ok',
        };
      },
      onToolTelemetry: (entry) => {
        telemetryEntry = entry;
      },
    }
  );

  assert.ok(telemetryEntry);
  assert.equal(telemetryEntry.arguments?.username, 'alice');
  assert.equal(telemetryEntry.arguments?.password, '[REDACTED]');
  assert.equal(telemetryEntry.arguments?.auth_token, '[REDACTED]');
  const rawResult = telemetryEntry.rawResult as any;
  assert.equal(rawResult.status, 'ok');
  assert.equal(rawResult.sessionToken, '[REDACTED]');
});

test('handleCodexToolCall records error telemetry on execution failure', async () => {
  const tools: WebMCPTool[] = [
    {
      name: 'failTool',
      frameId: 0,
      readOnlyHint: true,
    },
  ];

  let telemetryEntry: ActivityEntry | undefined;
  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_failTool',
      arguments: { foo: 'bar' },
    },
    {
      tabId: 10,
      origin: 'https://error.example',
      tools,
      executeTool: async () => {
        throw new Error('Database connection failed');
      },
      onToolTelemetry: (entry) => {
        telemetryEntry = entry;
      },
    }
  );

  assert.equal(response.success, false);
  assert.ok(telemetryEntry);
  assert.equal(telemetryEntry.name, 'failTool');
  assert.equal(telemetryEntry.done, true);
  assert.equal(telemetryEntry.status, 'error');
  assert.match(telemetryEntry.errorMessage ?? '', /Database connection failed/);
  assert.match(telemetryEntry.resultSummary ?? '', /Database connection failed/);
});

test('handleCodexToolCall records error telemetry when permission is denied', async () => {
  clearSessionToolPermissions(10);
  const tools: WebMCPTool[] = [
    {
      name: 'sensitiveAction',
      frameId: 0,
      consequentialHint: true,
    },
  ];

  let telemetryEntry: ActivityEntry | undefined;
  const response = await handleCodexToolCall(
    {
      threadId: 't-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: '_0_sensitiveAction',
      arguments: { action: 'delete' },
    },
    {
      tabId: 10,
      origin: 'https://security.example',
      tools,
      sensitiveActionAlerts: true,
      onRequestPermission: async () => 'deny',
      executeTool: async () => {
        throw new Error('Should not run');
      },
      onToolTelemetry: (entry) => {
        telemetryEntry = entry;
      },
    }
  );

  assert.equal(response.success, false);
  assert.ok(telemetryEntry);
  assert.equal(telemetryEntry.name, 'sensitiveAction');
  assert.equal(telemetryEntry.done, true);
  assert.equal(telemetryEntry.status, 'error');
  assert.match(telemetryEntry.errorMessage ?? '', /denied permission/i);
});
