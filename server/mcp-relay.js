#!/usr/bin/env node
/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stdio-to-HTTP relay for MCP agents that do not support HTTP transport.
 * Bridges stdio JSON-RPC to the companion server's /api/mcp endpoint.
 */

import http from 'node:http';

const targetUrl = process.argv[2] || process.env.WEBMCP_MCP_URL || 'http://127.0.0.1:3000/api/mcp';
const authToken = process.env.WEBMCP_AUTH_TOKEN || '';

let buffer = '';

process.stdin.setEncoding('utf-8');

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  processLines();
});

function processLines() {
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip framing headers if Content-Length framing is used
    if (trimmed.startsWith('Content-Length:') || trimmed.startsWith('Content-Type:')) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      forwardMessage(parsed);
    } catch {
      // Buffer incomplete line
    }
  }
}

function forwardMessage(message) {
  const payload = JSON.stringify(message);
  const parsedUrl = new URL(targetUrl);

  const req = http.request(
    {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(authToken ? { 'X-WebMCP-Auth': authToken } : {}),
      },
    },
    (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (body.trim()) {
          process.stdout.write(body.trim() + '\n');
        }
      });
    }
  );

  req.on('error', (err) => {
    if (message.id !== undefined) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: `Relay error connecting to ${targetUrl}: ${err.message}`,
        },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });

  req.write(payload);
  req.end();
}
