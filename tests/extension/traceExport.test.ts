/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionTrace,
  exportSessionTrace,
  getTraceFilename,
  sanitizeOrigin,
} from '../../extension/sidepanel/services/traceExport.js';
import type { TabSessionState } from '../../extension/sidepanel/services/tabSessionStore.js';

test('sanitizeOrigin transforms origins into file name safe strings', () => {
  assert.equal(sanitizeOrigin('http://localhost:3000'), 'localhost-3000');
  assert.equal(sanitizeOrigin('https://example.com/some/path'), 'example-com-some-path');
  assert.equal(sanitizeOrigin('https://sub.domain.org:8443'), 'sub-domain-org-8443');
  assert.equal(sanitizeOrigin(''), 'session');
});

test('getTraceFilename formats the trace download file name', () => {
  const ts = 1700000000000;
  const filename = getTraceFilename('http://localhost:3000', ts);
  assert.equal(filename, 'webmcp-trace-localhost-3000-1700000000000.json');
});

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

test('exportSessionTrace creates blob, triggers anchor download, and revokes URL', () => {
  const originalDocument = globalThis.document;
  const originalURL = globalThis.URL;

  let clicked = false;
  let downloadedFileName = '';
  let objectUrlCreated = false;
  let revokedUrl = '';

  const mockLink = {
    href: '',
    download: '',
    click: () => {
      clicked = true;
      downloadedFileName = mockLink.download;
    },
  };

  const mockBody = {
    appendChild: (node: unknown) => node,
    removeChild: (node: unknown) => node,
  };

  globalThis.document = {
    body: mockBody,
    createElement: (tag: string) => {
      if (tag === 'a') return mockLink;
      throw new Error(`Unexpected element ${tag}`);
    },
  } as unknown as Document;

  globalThis.URL = {
    createObjectURL: (_blob: Blob) => {
      objectUrlCreated = true;
      return 'blob:mock-url-1234';
    },
    revokeObjectURL: (url: string) => {
      revokedUrl = url;
    },
  } as unknown as typeof URL;

  try {
    const state: TabSessionState = {
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

    exportSessionTrace(state);

    assert.equal(clicked, true);
    assert.equal(objectUrlCreated, true);
    assert.equal(mockLink.href, 'blob:mock-url-1234');
    assert.equal(revokedUrl, 'blob:mock-url-1234');
    assert.match(downloadedFileName, /^webmcp-trace-localhost-3000-\d+\.json$/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.URL = originalURL;
  }
});
