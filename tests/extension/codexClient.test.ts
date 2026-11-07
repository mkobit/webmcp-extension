/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexClient } from '../../extension/sidepanel/services/codexClient.js';
import type { CodexModelListResponse } from '../../extension/sidepanel/types/codex.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code: 1000, reason: 'Normal Closure' });
  }

  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  simulateMessage(data: unknown): void {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: text });
  }

  simulateError(err = new Error('Socket error')): void {
    this.onerror?.({ error: err });
  }
}

function setupMockWebSocket() {
  const original = (globalThis as any).WebSocket;
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket;
  return () => {
    (globalThis as any).WebSocket = original;
  };
}

test('CodexClient connects, sends initialize handshake, and reports connection state', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    assert.equal(client.isConnected(), false);

    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    assert.ok(ws);
    assert.equal(ws.url, 'ws://127.0.0.1:45123');

    // Socket opens
    ws.simulateOpen();

    // Verify initialize request was sent
    assert.equal(ws.sent.length, 1);
    const initReq = JSON.parse(ws.sent[0]);
    assert.equal(initReq.method, 'initialize');
    assert.equal(initReq.jsonrpc, '2.0');
    assert.deepEqual(initReq.params, {
      clientInfo: {
        name: 'webmcp-extension',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    // Simulate initialize response
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: initReq.id,
      result: { serverInfo: { name: 'codex-app-server' } },
    });

    await connectPromise;
    assert.equal(client.isConnected(), true);

    client.disconnect();
    assert.equal(client.isConnected(), false);
    assert.equal(ws.readyState, 3);
  } finally {
    restore();
  }
});

test('CodexClient matches requests and responses by correlation id', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    // Send custom request
    const requestPromise = client.sendRequest<string>('test/echo', { message: 'hello' });
    assert.equal(ws.sent.length, 2);
    const req = JSON.parse(ws.sent[1]);
    assert.equal(req.method, 'test/echo');
    assert.deepEqual(req.params, { message: 'hello' });

    // Respond
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: 'echo: hello',
    });

    const res = await requestPromise;
    assert.equal(res, 'echo: hello');
  } finally {
    restore();
  }
});

test('CodexClient handles incoming notifications and unsubscribes', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const received: any[] = [];
    const unsubscribe = client.onNotification('item/agentMessage/delta', (params) => {
      received.push(params);
    });

    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { delta: 'Hello world' },
    });

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], { delta: 'Hello world' });

    unsubscribe();

    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { delta: 'Second chunk' },
    });

    assert.equal(received.length, 1);
  } finally {
    restore();
  }
});

test('CodexClient handles incoming server requests and returns response', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    client.onServerRequest('item/tool/call', async (_id, params) => {
      assert.equal(params.tool, 'get_weather');
      return { success: true, contentItems: [{ type: 'inputText', text: 'Sunny' }] };
    });

    ws.simulateMessage({
      jsonrpc: '2.0',
      id: 99,
      method: 'item/tool/call',
      params: { tool: 'get_weather', arguments: {} },
    });

    // Wait microtask for async handler
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Server request response should be sent
    assert.equal(ws.sent.length, 2);
    const toolRes = JSON.parse(ws.sent[1]);
    assert.equal(toolRes.id, 99);
    assert.equal(toolRes.jsonrpc, '2.0');
    assert.deepEqual(toolRes.result, {
      success: true,
      contentItems: [{ type: 'inputText', text: 'Sunny' }],
    });
  } finally {
    restore();
  }
});

test('CodexClient lists models using model/list', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const listPromise = client.listModels();
    const req = JSON.parse(ws.sent[1]);
    assert.equal(req.method, 'model/list');
    assert.deepEqual(req.params, { limit: 20, includeHidden: false });

    const mockResponse: CodexModelListResponse = {
      data: [
        {
          id: 'gpt-6.1-sol',
          displayName: 'GPT-6.1 Sol',
          supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }],
          defaultReasoningEffort: 'low',
          isDefault: true,
        },
      ],
    };

    ws.simulateMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: mockResponse,
    });

    const res = await listPromise;
    assert.deepEqual(res, mockResponse);
  } finally {
    restore();
  }
});

test('CodexClient handles malformed JSON and disconnect errors cleanly', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    // Simulate malformed JSON message - should not crash client
    ws.simulateMessage('INVALID JSON {{{');

    // In-flight request rejection on disconnect
    const pendingReq = client.sendRequest('some/method', {});
    ws.simulateError(new Error('Connection dropped'));
    ws.close();

    await assert.rejects(pendingReq, /Connection dropped|closed|WebSocket/i);
    assert.equal(client.isConnected(), false);
  } finally {
    restore();
  }
});
