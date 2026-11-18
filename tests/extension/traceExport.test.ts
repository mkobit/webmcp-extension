/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionTrace,
  copySessionTrace,
} from '../../extension/sidepanel/services/traceExport.js';
import type { TabSessionState } from '../../extension/sidepanel/services/tabSessionStore.js';

test('buildSessionTrace creates version 1 trace export with complete session telemetry', () => {
  const state: TabSessionState = {
    userPrompt: 'test prompt',
    messages: [
      { id: 1, role: 'user', text: 'Find products' },
      {
        id: 2,
        role: 'ai',
        text: 'Found 2 items',
        tokenUsage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
      },
    ],
    busy: false,
    activityLog: [
      {
        id: 1,
        name: 'search_products',
        done: true,
        status: 'success',
        durationMs: 42,
        frameOrigin: 'https://store.example.com',
        arguments: { query: 'shoes' },
        rawResult: [{ id: 101, title: 'Sneakers' }],
      },
    ],
    streamingText: '',
    pendingPermission: null,
    pendingCheckpoint: null,
    tools: [
      {
        name: 'search_products',
        description: 'Search store catalog',
        inputSchema: { type: 'object' },
      },
    ],
    domain: 'store.example.com',
    origin: 'https://store.example.com',
    favicon: '',
    statusMsg: '',
    sessionTokenUsage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
  };

  const trace = buildSessionTrace(state);
  assert.equal(trace.version, 1);
  assert.equal(trace.origin, 'https://store.example.com');
  assert.ok(typeof trace.exportedAt === 'string');
  assert.ok(!Number.isNaN(Date.parse(trace.exportedAt)));
  assert.deepEqual(trace.sessionTokenUsage, {
    promptTokens: 120,
    completionTokens: 45,
    totalTokens: 165,
  });
  assert.equal(trace.messages.length, 2);
  assert.equal(trace.messages[1].tokenUsage?.totalTokens, 165);
  assert.equal(trace.activityLog.length, 1);
  assert.equal(trace.activityLog[0].durationMs, 42);
  assert.equal(trace.activityLog[0].frameOrigin, 'https://store.example.com');
  assert.deepEqual(trace.activityLog[0].arguments, { query: 'shoes' });
  assert.equal(trace.tools.length, 1);
  assert.equal(trace.tools[0].name, 'search_products');
});

const copyState: TabSessionState = {
  userPrompt: '',
  messages: [{ id: 1, role: 'user', text: 'Hello' }],
  busy: false,
  activityLog: [],
  streamingText: '',
  pendingPermission: null,
  pendingCheckpoint: null,
  tools: [],
  domain: 'localhost:3000',
  origin: 'http://localhost:3000',
  favicon: '',
  statusMsg: '',
};

test('copySessionTrace copies formatted session JSON to the clipboard', async (t) => {
  let copiedText = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text: string) => { copiedText = text; },
  } });
  t.after(() => { Reflect.deleteProperty(navigator, 'clipboard'); });

  await copySessionTrace(copyState);

  const copied = JSON.parse(copiedText);
  assert.deepEqual(copied.messages, [{ id: 1, role: 'user', text: 'Hello' }]);
  assert.equal(copied.origin, 'http://localhost:3000');
  assert.equal(copied.version, 1);
  assert.deepEqual(copied.activityLog, []);
  assert.deepEqual(copied.tools, []);
  assert.ok(!Number.isNaN(Date.parse(copied.exportedAt)));
  assert.equal(copiedText, JSON.stringify(copied, null, 2));
});

test('copySessionTrace reports a clipboard write failure', async (t) => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw new Error('Clipboard denied'); },
  } });
  t.after(() => { Reflect.deleteProperty(navigator, 'clipboard'); });

  await assert.rejects(async () => copySessionTrace(copyState), /Clipboard denied/);
});
