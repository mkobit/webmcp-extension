/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isToolUntrusted } from './toolEncoder.js';
import { type WebMCPTool } from '../types/index.js';

/**
 * What happens to a tool's result on its way back to the model: it is cut to
 * a size the context can take, and spotlighted when the page marked the tool
 * as returning untrusted content. Kept apart from the agent loop so each rule
 * can be read and tested on its own.
 */

/** Tool results longer than this are cut, so a page cannot flood the model's context. */
export const MAX_TOOL_RESPONSE_CHARS = 8000;

export const MAX_TELEMETRY_PAYLOAD_BYTES = 64 * 1024;
const SENSITIVE_KEY_PATTERN = /(authorization|token|password|secret)/i;

/**
 * Redact sensitive keys (authorization, token, password, secret) recursively
 * from objects and arrays.
 */
export function redactSensitiveKeys<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  const seen = new WeakSet<object>();

  function redact(val: unknown): unknown {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;
    if (seen.has(val)) return '[Circular]';
    seen.add(val);

    if (Array.isArray(val)) {
      return val.map(redact);
    }

    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redact(v);
      }
    }
    return result;
  }

  return redact(data) as T;
}

/**
 * Enforce a 64 KB payload size cap for telemetry records.
 */
export function truncateTelemetryPayload<T>(
  data: T,
  maxBytes = MAX_TELEMETRY_PAYLOAD_BYTES
): T {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    if (data.length > maxBytes) {
      return (data.slice(0, maxBytes) + '... [TRUNCATED]') as unknown as T;
    }
    return data;
  }
  if (typeof data !== 'object') return data;

  try {
    const json = JSON.stringify(data);
    if (json.length <= maxBytes) {
      return data;
    }
    if (Array.isArray(data)) {
      return (json.slice(0, maxBytes) + '... [TRUNCATED]') as unknown as T;
    }
    return {
      _warning: `Payload exceeded ${maxBytes} bytes limit and was truncated`,
      preview: json.slice(0, maxBytes) + '... [TRUNCATED]',
    } as unknown as T;
  } catch {
    return data;
  }
}

/**
 * Redact sensitive keys and apply a 64 KB size limit for tool telemetry.
 */
export function sanitizeTelemetryData<T>(data: T): T {
  return truncateTelemetryPayload(redactSensitiveKeys(data));
}

/**
 * Produce a short text preview of a result payload for summary display.
 */
export function summarizeResult(result: unknown): string | undefined {
  if (result === undefined) return undefined;
  if (result === null) return 'null';
  if (typeof result === 'string') {
    return result.length > 100 ? `${result.slice(0, 100)}...` : result;
  }
  try {
    const s = JSON.stringify(result);
    return s.length > 100 ? `${s.slice(0, 100)}...` : s;
  } catch {
    return String(result);
  }
}

export function applyTokenLimit(result: unknown): unknown {
  if (result === undefined || result === null) return result;
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str && str.length > MAX_TOOL_RESPONSE_CHARS) {
    console.warn(
      `[WebMCP Security] Tool payload exceeded limit: ${str.length} chars (max: ${MAX_TOOL_RESPONSE_CHARS})`
    );
    const truncated = str.slice(0, MAX_TOOL_RESPONSE_CHARS);
    return `${truncated}\n\n[WEBMCP_SECURITY_WARNING: Tool response exceeded maximum allowable limit (${str.length} > ${MAX_TOOL_RESPONSE_CHARS} characters) and was truncated to protect against context exhaustion and prompt injection.]`;
  }
  return result;
}

/**
 * Base64-encodes a UTF-8 string in the browser.
 *
 * `btoa` only accepts Latin-1, and the old `unescape(encodeURIComponent(...))`
 * trick throws a URIError on a lone surrogate — which `applyTokenLimit` can
 * produce when it truncates mid-character. `TextEncoder` replaces unpaired
 * surrogates with U+FFFD instead of throwing, so this cannot fail on any input.
 */
function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  // Chunked to stay well under the argument-count limit of String.fromCharCode.
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/**
 * Spotlights the result of a tool marked `untrustedContentHint: true`, and
 * returns any other result as it is.
 *
 * Encoding is the stronger spotlighting, but it takes a model that decodes
 * base64 reliably. Callers that pass a fence get delimiting instead, with any
 * forged closing marker stripped so the data cannot break out.
 */
export function applySpotlighting(result: unknown, tool?: WebMCPTool, fence?: string): unknown {
  if (!isToolUntrusted(tool)) return result;

  const rawStr = typeof result === 'string' ? result : JSON.stringify(result);

  if (fence) {
    const fenced = (rawStr || '').split(`</${fence}>`).join('');
    return `<${fence}>\n${fenced}\n</${fence}>`;
  }

  return encodeBase64(rawStr || '');
}

/**
 * Refreshes the page's tools after a round of tool calls, and waits until they
 * have settled, so the next request declares the tools the page has now.
 *
 * A call can change them, by navigating, or by rendering a view with tools of
 * its own, and a page can take a while to register those: the content script
 * only reports the list once its changes have paused. So this waits for a
 * report, then for `quietMs` without another, and gives up after `timeoutMs`,
 * keeping whatever tools arrived by then.
 */
export async function waitForToolsToSettle(
  toolsRef: { readonly current: WebMCPTool[] },
  {
    requestTools,
    signal,
    quietMs = 250,
    timeoutMs = 2000,
    pollMs = 25,
  }: {
    requestTools: () => Promise<void>;
    signal?: AbortSignal;
    quietMs?: number;
    timeoutMs?: number;
    pollMs?: number;
  }
): Promise<void> {
  const start = performance.now();
  // Every report replaces the array, even when the tools are the same.
  let seen = toolsRef.current;
  let lastReport: number | null = null;

  try {
    await requestTools();
  } catch {}

  while (!signal?.aborted && performance.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (toolsRef.current !== seen) {
      seen = toolsRef.current;
      lastReport = performance.now();
    }
    if (lastReport !== null && performance.now() - lastReport >= quietMs) return;
  }
}
