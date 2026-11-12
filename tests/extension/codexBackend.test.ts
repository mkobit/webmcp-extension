/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexClient } from '../../extension/sidepanel/services/codexClient.js';
import {
  sendCodexChatTurn,
  interruptCodexTurn,
} from '../../extension/sidepanel/services/codexBackend.js';
import { tabSessions } from '../../extension/sidepanel/services/tabSessionStore.js';
import type { WebMCPTool } from '../../extension/sidepanel/types/index.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
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
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: 'Normal Closure' });
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  simulateMessage(data: unknown): void {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: text });
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

test('sendCodexChatTurn creates new thread on first turn and reuses threadId on subsequent turns', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 301;
    tabSessions.resetChat(tabId);
    assert.equal(tabSessions.getInternals(tabId).codexThreadId, undefined);

    const tools: WebMCPTool[] = [{ name: 'calc', frameId: 0 }];

    // First turn: starts thread then starts turn
    const turn1Promise = sendCodexChatTurn(
      { message: 'Hello first turn' },
      { tabId, client, tools, model: 'gpt-6.1-sol', effort: 'medium' }
    );

    // Verify thread/start request
    const threadStartReq = JSON.parse(ws.sent[1]);
    assert.equal(threadStartReq.method, 'thread/start');
    assert.equal(threadStartReq.params.model, 'gpt-6.1-sol');
    assert.deepEqual(threadStartReq.params.dynamicTools, [
      {
        type: 'function',
        name: '_0_calc',
        description: '',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);

    // Respond with thread id
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: threadStartReq.id,
      result: { thread: { id: 'thread-abc-123' } },
    });

    // Wait microtask for turn/start to be sent
    await new Promise((r) => setTimeout(r, 10));

    // Verify turn/start request
    const turnStartReq = JSON.parse(ws.sent[2]);
    assert.equal(turnStartReq.method, 'turn/start');
    assert.equal(turnStartReq.params.threadId, 'thread-abc-123');
    assert.equal(turnStartReq.params.effort, 'medium');

    // Respond with turn id
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: turnStartReq.id,
      result: { turn: { id: 'turn-001' } },
    });

    // Complete the turn
    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-abc-123', turn: { id: 'turn-001' } },
    });

    const res1 = await turn1Promise;
    assert.equal(res1.chatId, 'thread-abc-123');
    assert.equal(tabSessions.getInternals(tabId).codexThreadId, 'thread-abc-123');

    // Second turn: should NOT send thread/start, but reuse threadId directly
    const turn2Promise = sendCodexChatTurn(
      { message: 'Second turn' },
      { tabId, client, tools }
    );

    await new Promise((r) => setTimeout(r, 10));

    // Verify turn/start request was sent directly without thread/start
    const turn2Req = JSON.parse(ws.sent[3]);
    assert.equal(turn2Req.method, 'turn/start');
    assert.equal(turn2Req.params.threadId, 'thread-abc-123');

    ws.simulateMessage({
      jsonrpc: '2.0',
      id: turn2Req.id,
      result: { turn: { id: 'turn-002' } },
    });

    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-abc-123', turn: { id: 'turn-002' } },
    });

    const res2 = await turn2Promise;
    assert.equal(res2.chatId, 'thread-abc-123');
  } finally {
    restore();
  }
});

test('sendCodexChatTurn streams text deltas to onText callback', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 302;
    tabSessions.resetChat(tabId);
    tabSessions.getInternals(tabId).codexThreadId = 'thread-stream-test';

    const streamed: string[] = [];
    const turnPromise = sendCodexChatTurn(
      { message: 'Stream test' },
      {
        tabId,
        client,
        onText: (text) => streamed.push(text),
      }
    );

    await new Promise((r) => setTimeout(r, 10));
    const turnReq = JSON.parse(ws.sent[1]);
    ws.simulateMessage({ jsonrpc: '2.0', id: turnReq.id, result: { turn: { id: 'turn-s1' } } });

    // Stream deltas
    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-stream-test', turnId: 'turn-s1', delta: 'Hello ' },
    });
    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-stream-test', turnId: 'turn-s1', delta: 'world!' },
    });

    // Complete turn
    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-stream-test', turn: { id: 'turn-s1' } },
    });

    const res = await turnPromise;
    assert.equal(res.text, 'Hello world!');
    assert.deepEqual(streamed, ['Hello ', 'Hello world!']);
  } finally {
    restore();
  }
});

test('sendCodexChatTurn executes server dynamic tool calls during turn', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 303;
    tabSessions.resetChat(tabId);
    tabSessions.getInternals(tabId).codexThreadId = 'thread-tool-test';

    const tools: WebMCPTool[] = [{ name: 'add', frameId: 0, readOnlyHint: true }];

    const turnPromise = sendCodexChatTurn(
      { message: 'Add 2 and 3' },
      {
        tabId,
        client,
        tools,
        origin: 'https://example.com',
        executeTool: async (_name, args) => {
          return { sum: (args.a as number) + (args.b as number) };
        },
      }
    );

    await new Promise((r) => setTimeout(r, 10));
    const turnReq = JSON.parse(ws.sent[1]);
    ws.simulateMessage({ jsonrpc: '2.0', id: turnReq.id, result: { turn: { id: 'turn-t1' } } });

    // Server requests tool call
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: 555,
      method: 'item/tool/call',
      params: {
        threadId: 'thread-tool-test',
        turnId: 'turn-t1',
        callId: 'call-555',
        tool: '_0_add',
        arguments: { a: 2, b: 3 },
      },
    });

    // Wait microtask for tool execution response
    await new Promise((r) => setTimeout(r, 10));

    // Verify response sent to server
    const toolRes = JSON.parse(ws.sent[2]);
    assert.equal(toolRes.id, 555);
    assert.equal(toolRes.jsonrpc, '2.0');
    assert.deepEqual(toolRes.result, {
      success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify({ sum: 5 }) }],
    });

    // Complete turn
    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-tool-test', turn: { id: 'turn-t1' } },
    });

    await turnPromise;
  } finally {
    restore();
  }
});

test('interruptCodexTurn sends turn/interrupt request', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 304;
    const internals = tabSessions.getInternals(tabId);
    internals.codexThreadId = 'thread-interrupt-test';
    internals.codexTurnId = 'turn-interrupt-test';

    const interruptPromise = interruptCodexTurn(tabId, client);

    const intReq = JSON.parse(ws.sent[1]);
    assert.equal(intReq.method, 'turn/interrupt');
    assert.deepEqual(intReq.params, {
      threadId: 'thread-interrupt-test',
      turnId: 'turn-interrupt-test',
    });

    ws.simulateMessage({ jsonrpc: '2.0', id: intReq.id, result: {} });
    await interruptPromise;
    assert.equal(internals.codexTurnId, undefined);
  } finally {
    restore();
  }
});

test('sendCodexChatTurn rejects with connection error when socket closes mid-turn', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 305;
    tabSessions.resetChat(tabId);
    tabSessions.getInternals(tabId).codexThreadId = 'thread-disconnect-test';

    const turnPromise = sendCodexChatTurn(
      { message: 'Disconnect test' },
      { tabId, client }
    );

    await new Promise((r) => setTimeout(r, 10));
    const turnReq = JSON.parse(ws.sent[1]);
    ws.simulateMessage({ jsonrpc: '2.0', id: turnReq.id, result: { turn: { id: 'turn-d1' } } });

    // Socket disconnects without turn/completed
    ws.close();

    await assert.rejects(turnPromise, /WebSocket connection closed|disconnected/i);
  } finally {
    restore();
  }
});

test('sendCodexChatTurn extracts tokenUsage from turn/completed notification', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 306;
    tabSessions.resetChat(tabId);
    tabSessions.getInternals(tabId).codexThreadId = 'thread-token-test';

    const turnPromise = sendCodexChatTurn(
      { message: 'Token usage test' },
      { tabId, client }
    );

    await new Promise((r) => setTimeout(r, 10));
    const turnReq = JSON.parse(ws.sent[1]);
    ws.simulateMessage({ jsonrpc: '2.0', id: turnReq.id, result: { turn: { id: 'turn-u1' } } });

    // Complete turn with token usage
    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 'thread-token-test',
        turn: { id: 'turn-u1' },
        usage: {
          promptTokens: 250,
          completionTokens: 80,
          totalTokens: 330,
        },
      },
    });

    const res = await turnPromise;
    assert.deepEqual(res.tokenUsage, {
      promptTokens: 250,
      completionTokens: 80,
      totalTokens: 330,
    });
  } finally {
    restore();
  }
});

test('sendCodexChatTurn recovers from stale thread by starting a fresh thread', async () => {
  const restore = setupMockWebSocket();
  try {
    const client = new CodexClient();
    const connectPromise = client.connect(45123);
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const initReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage({ jsonrpc: '2.0', id: initReq.id, result: {} });
    await connectPromise;

    const tabId = 304;
    tabSessions.resetChat(tabId);
    // Simulate restored stale thread ID
    tabSessions.getInternals(tabId).codexThreadId = 'stale-thread-999';

    const turnPromise = sendCodexChatTurn(
      { message: 'Turn on stale thread' },
      { tabId, client, tools: [], model: 'gpt-6.1-sol', effort: 'medium' }
    );

    // Initial turn/start with stale thread
    const turn1Req = JSON.parse(ws.sent[1]);
    assert.equal(turn1Req.method, 'turn/start');
    assert.equal(turn1Req.params.threadId, 'stale-thread-999');

    // Server returns thread not found error
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: turn1Req.id,
      error: { code: -32000, message: 'Thread not found: stale-thread-999' },
    });

    // Wait microtask for recovery thread/start
    await new Promise((r) => setTimeout(r, 10));

    // Client should have requested thread/start
    const recoverThreadReq = JSON.parse(ws.sent[2]);
    assert.equal(recoverThreadReq.method, 'thread/start');

    // Respond with fresh thread
    ws.simulateMessage({
      jsonrpc: '2.0',
      id: recoverThreadReq.id,
      result: { thread: { id: 'fresh-thread-001' } },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Client sends turn/start with fresh thread
    const recoverTurnReq = JSON.parse(ws.sent[3]);
    assert.equal(recoverTurnReq.method, 'turn/start');
    assert.equal(recoverTurnReq.params.threadId, 'fresh-thread-001');

    ws.simulateMessage({
      jsonrpc: '2.0',
      id: recoverTurnReq.id,
      result: { turn: { id: 'fresh-turn-001' } },
    });

    ws.simulateMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 'fresh-thread-001',
        turn: { id: 'fresh-turn-001' },
      },
    });

    const res = await turnPromise;
    assert.equal(res.chatId, 'fresh-thread-001');
    assert.equal(tabSessions.getInternals(tabId).codexThreadId, 'fresh-thread-001');
  } finally {
    restore();
  }
});
