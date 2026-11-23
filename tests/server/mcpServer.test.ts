/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '../../server/mcp/mcpServer.ts';
import type { JsonRpcRequest } from '../../server/acp/types.ts';
import type { McpInitializeResult, McpListToolsResult, McpCallToolResult } from '../../server/mcp/types.ts';

test('mcpServer - responds to initialize and lists tools', async () => {
  const mcp = new McpServer();
  mcp.setTools([
    {
      name: 'getPageTitle',
      description: 'Returns the document title',
      inputSchema: { type: 'object' },
      readOnlyHint: true,
    },
  ]);

  // Test initialize
  const initReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  };
  const initRes = await mcp.handleJsonRpc(initReq);
  assert.ok(initRes);
  assert.equal(initRes.id, 1);
  const initResult = initRes.result as McpInitializeResult;
  assert.equal(initResult.protocolVersion, '2024-11-05');
  assert.equal(initResult.serverInfo.name, 'webmcp-companion-mcp');

  // Test notifications/initialized
  const notifyReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'notifications/initialized',
    params: {},
  };
  const notifyRes = await mcp.handleJsonRpc(notifyReq);
  assert.equal(notifyRes, null);

  // Test tools/list
  const listReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: {},
  };
  const listRes = await mcp.handleJsonRpc(listReq);
  assert.ok(listRes);
  const listResult = listRes.result as McpListToolsResult;
  assert.equal(listResult.tools.length, 1);
  assert.equal(listResult.tools[0].name, 'getPageTitle');
  assert.equal(listResult.tools[0].readOnlyHint, true);
});

test('mcpServer - handles tools/call and executes registered executor', async () => {
  const mcp = new McpServer({
    executor: async (name, args) => {
      if (name === 'addNumbers') {
        const a = (args.a as number) || 0;
        const b = (args.b as number) || 0;
        return { result: a + b };
      }
      return { error: 'Unknown tool' };
    },
  });

  mcp.setTools([
    {
      name: 'addNumbers',
      description: 'Adds two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    },
  ]);

  const callReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'addNumbers',
      arguments: { a: 5, b: 7 },
    },
  };

  const callRes = await mcp.handleJsonRpc(callReq);
  assert.ok(callRes);
  const callResult = callRes.result as McpCallToolResult;
  assert.equal(callResult.isError, undefined);
  assert.equal(callResult.content[0].text, '12');
});

test('mcpServer - delegates consequential tools directly to executor without internal blocking', async () => {
  const mcp = new McpServer({
    executor: async (name, args) => ({ result: { executed: name, args } }),
  });

  mcp.setTools([
    {
      name: 'buyItem',
      description: 'Charges credit card',
      consequentialHint: true,
    },
  ]);

  const callReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: {
      name: 'buyItem',
      arguments: { itemId: 'sku-123' },
    },
  };

  const callRes = await mcp.handleJsonRpc(callReq);
  assert.ok(callRes);
  const callResult = callRes.result as McpCallToolResult;
  assert.equal(callResult.isError, undefined);
  assert.deepEqual(JSON.parse(callResult.content[0].text), {
    executed: 'buyItem',
    args: { itemId: 'sku-123' },
  });
});

test('mcpServer - applies base64 spotlighting when untrustedContentHint is true', async () => {
  const mcp = new McpServer({
    executor: async () => ({ result: 'Sensitive page content' }),
  });

  mcp.setTools([
    {
      name: 'readUntrustedDom',
      untrustedContentHint: true,
    },
  ]);

  const callReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: { name: 'readUntrustedDom', arguments: {} },
  };

  const callRes = await mcp.handleJsonRpc(callReq);
  assert.ok(callRes);
  const callResult = callRes.result as McpCallToolResult;
  const decoded = Buffer.from(callResult.content[0].text, 'base64').toString('utf-8');
  assert.equal(decoded, 'Sensitive page content');
});

test('mcpServer - truncates output exceeding 8,000 characters', async () => {
  const giantString = 'A'.repeat(10000);
  const mcp = new McpServer({
    executor: async () => ({ result: giantString }),
  });

  mcp.setTools([{ name: 'largePayload' }]);

  const callReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 40,
    method: 'tools/call',
    params: { name: 'largePayload', arguments: {} },
  };

  const callRes = await mcp.handleJsonRpc(callReq);
  assert.ok(callRes);
  const callResult = callRes.result as McpCallToolResult;
  assert.ok(callResult.content[0].text.length < 9000);
  assert.match(callResult.content[0].text, /\[truncated\]/);
});
