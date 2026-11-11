/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { AcpClient } from '../../server/acp/acpClient.ts';
import type { JsonRpcRequest, JsonRpcResponse } from '../../server/acp/types.ts';

test('acpClient - sends initialize handshake with fs: false and terminal: false', async () => {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const clientStream = new PassThrough();
  clientToServer.on('data', (d) => clientStream.write(d));
  // Invert streams for client Duplex simulation
  const duplex = {
    write: (data: string | Buffer) => clientToServer.write(data),
    on: (evt: string, handler: (...args: unknown[]) => void) => serverToClient.on(evt, handler),
    removeListener: (evt: string, handler: (...args: unknown[]) => void) =>
      serverToClient.removeListener(evt, handler),
    destroy: () => {
      clientToServer.destroy();
      serverToClient.destroy();
    },
    destroyed: false,
  };

  const client = new AcpClient({ stream: duplex as unknown as import('node:stream').Duplex });
  await client.connect();

  let capturedInitRequest: JsonRpcRequest | undefined;
  clientToServer.once('data', (chunk: Buffer) => {
    capturedInitRequest = JSON.parse(chunk.toString('utf-8').trim());
    const initResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: capturedInitRequest!.id,
      result: {
        protocolVersion: 1,
        serverCapabilities: {},
      },
    };
    serverToClient.write(JSON.stringify(initResponse) + '\n');
  });

  const initResult = await client.initialize();
  assert.equal(initResult.protocolVersion, 1);
  assert.ok(capturedInitRequest);
  assert.equal(capturedInitRequest.method, 'initialize');

  const clientCaps = (capturedInitRequest.params as { clientCapabilities: { fs: unknown; terminal: unknown } })
    .clientCapabilities;
  assert.deepEqual(clientCaps.fs, { readTextFile: false, writeTextFile: false });
  assert.equal(clientCaps.terminal, false);

  client.close();
});

test('acpClient - automatically denies incoming session/request_permission requests', async () => {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const duplex = {
    write: (data: string | Buffer) => clientToServer.write(data),
    on: (evt: string, handler: (...args: unknown[]) => void) => serverToClient.on(evt, handler),
    removeListener: (evt: string, handler: (...args: unknown[]) => void) =>
      serverToClient.removeListener(evt, handler),
    destroy: () => {
      clientToServer.destroy();
      serverToClient.destroy();
    },
    destroyed: false,
  };

  const client = new AcpClient({ stream: duplex as unknown as import('node:stream').Duplex });
  await client.connect();

  const permissionRequest: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 99,
    method: 'session/request_permission',
    params: {
      sessionId: 'test-session',
      toolCallId: 'call-1',
    },
  };

  const denialPromise = new Promise<JsonRpcResponse>((resolve) => {
    clientToServer.once('data', (chunk: Buffer) => {
      resolve(JSON.parse(chunk.toString('utf-8').trim()));
    });
  });

  serverToClient.write(JSON.stringify(permissionRequest) + '\n');
  const response = await denialPromise;

  assert.equal(response.id, 99);
  const result = response.result as { granted: boolean; reason: string };
  assert.equal(result.granted, false);
  assert.match(result.reason, /Host capabilities .* are disabled/);

  client.close();
});

test('acpClient - manages session/new and streams session/prompt updates', async () => {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const duplex = {
    write: (data: string | Buffer) => clientToServer.write(data),
    on: (evt: string, handler: (...args: unknown[]) => void) => serverToClient.on(evt, handler),
    removeListener: (evt: string, handler: (...args: unknown[]) => void) =>
      serverToClient.removeListener(evt, handler),
    destroy: () => {
      clientToServer.destroy();
      serverToClient.destroy();
    },
    destroyed: false,
  };

  const client = new AcpClient({ stream: duplex as unknown as import('node:stream').Duplex });
  await client.connect();

  // Handle session/new
  clientToServer.once('data', (chunk: Buffer) => {
    const req: JsonRpcRequest = JSON.parse(chunk.toString('utf-8').trim());
    assert.equal(req.method, 'session/new');
    const resp: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        sessionId: 'session-xyz',
      },
    };
    serverToClient.write(JSON.stringify(resp) + '\n');
  });

  const sessionResult = await client.newSession({
    cwd: '/tmp',
    mcpServers: [{ name: 'webmcp', url: 'http://127.0.0.1:3000/api/mcp' }],
  });
  assert.equal(sessionResult.sessionId, 'session-xyz');
  assert.equal(client.getSessionId(), 'session-xyz');

  // Handle session/prompt
  clientToServer.once('data', (chunk: Buffer) => {
    const req: JsonRpcRequest = JSON.parse(chunk.toString('utf-8').trim());
    assert.equal(req.method, 'session/prompt');

    // Simulate streamed updates before final response
    const update1 = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-xyz',
        update: { type: 'text', delta: 'Hello ' },
      },
    };
    const update2 = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-xyz',
        update: { type: 'text', delta: 'world!' },
      },
    };
    serverToClient.write(JSON.stringify(update1) + '\n');
    serverToClient.write(JSON.stringify(update2) + '\n');

    const promptResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: req.id,
      result: { status: 'complete' },
    };
    serverToClient.write(JSON.stringify(promptResponse) + '\n');
  });

  const receivedDeltas: string[] = [];
  await client.prompt('Say hello', (update) => {
    if (update.delta) receivedDeltas.push(update.delta);
  });

  assert.deepEqual(receivedDeltas, ['Hello ', 'world!']);
  client.close();
});
