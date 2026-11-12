/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTokenLimit,
  MAX_TELEMETRY_PAYLOAD_BYTES,
  MAX_TOOL_RESPONSE_CHARS,
  redactSensitiveKeys,
  sanitizeTelemetryData,
  summarizeResult,
  truncateTelemetryPayload,
} from '../../extension/sidepanel/services/toolResults.js';

test('applyTokenLimit leaves responses under the maximum character limit untouched', () => {
  const shortString = 'Short tool response with normal size data.';
  assert.equal(applyTokenLimit(shortString), shortString);

  const shortObject = { status: 'success', count: 42 };
  assert.deepEqual(applyTokenLimit(shortObject), shortObject);

  assert.equal(applyTokenLimit(null), null);
  assert.equal(applyTokenLimit(undefined), undefined);
});

test('applyTokenLimit truncates oversized string payloads and appends security warning', () => {
  const oversizedPayload = 'A'.repeat(MAX_TOOL_RESPONSE_CHARS + 500);
  const result = applyTokenLimit(oversizedPayload) as string;

  assert.ok(typeof result === 'string');
  assert.ok(result.startsWith('A'.repeat(MAX_TOOL_RESPONSE_CHARS)));
  assert.ok(result.includes('WEBMCP_SECURITY_WARNING'));
  assert.ok(result.includes('Tool response exceeded maximum allowable limit'));
});

test('applyTokenLimit truncates oversized JSON payloads and appends security warning', () => {
  const largeObject = {
    content: 'X'.repeat(MAX_TOOL_RESPONSE_CHARS + 200),
  };
  const result = applyTokenLimit(largeObject) as string;

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('WEBMCP_SECURITY_WARNING'));
  assert.ok(result.includes('Tool response exceeded maximum allowable limit'));
});

test('redactSensitiveKeys redacts authorization, token, password, and secret keys recursively', () => {
  const input = {
    password: 'superSecretPassword', // betterleaks:allow
    user_token: 'xyz-token-123',
    Authorization: 'Bearer auth-header-val',
    client_secret: 'secret-val',
    regularField: 'safeValue',
    nested: {
      passwordHash: 'hash123',
      nestedSecret: 'nestedVal',
      subArray: [
        { token: 'itemToken', value: 42 },
      ],
    },
  };

  const redacted = redactSensitiveKeys(input);
  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.user_token, '[REDACTED]');
  assert.equal(redacted.Authorization, '[REDACTED]');
  assert.equal(redacted.client_secret, '[REDACTED]');
  assert.equal(redacted.regularField, 'safeValue');
  assert.equal(redacted.nested.passwordHash, '[REDACTED]');
  assert.equal(redacted.nested.nestedSecret, '[REDACTED]');
  assert.equal(redacted.nested.subArray[0].token, '[REDACTED]');
  assert.equal(redacted.nested.subArray[0].value, 42);

  // Original input is not mutated
  assert.equal(input.password, 'superSecretPassword');
});

test('truncateTelemetryPayload truncates strings and objects exceeding 64 KB', () => {
  const bigString = 'Z'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES + 100);
  const truncatedString = truncateTelemetryPayload(bigString);
  assert.ok(typeof truncatedString === 'string');
  assert.ok(truncatedString.startsWith('Z'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES)));
  assert.ok(truncatedString.includes('[TRUNCATED]'));

  const bigObject = {
    data: 'Y'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES + 500),
  };
  const truncatedObject = truncateTelemetryPayload(bigObject) as any;
  assert.ok(truncatedObject._warning);
  assert.ok(truncatedObject.preview.includes('[TRUNCATED]'));
});

test('sanitizeTelemetryData combines redaction and 64 KB truncation', () => {
  const data = {
    password: 'secret', // betterleaks:allow
    payload: 'W'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES + 50),
  };
  const sanitized = sanitizeTelemetryData(data) as any;
  assert.ok(sanitized._warning);
  assert.ok(sanitized.preview.includes('[REDACTED]'));
  assert.ok(sanitized.preview.includes('[TRUNCATED]'));
});

test('summarizeResult returns concise preview strings', () => {
  assert.equal(summarizeResult(undefined), undefined);
  assert.equal(summarizeResult(null), 'null');
  assert.equal(summarizeResult('hello'), 'hello');
  assert.equal(summarizeResult('a'.repeat(150)), 'a'.repeat(100) + '...');
  assert.equal(summarizeResult({ a: 1 }), '{"a":1}');
});
