/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionTraceExport } from '../types/index.js';
import type { TabSessionState } from './tabSessionStore.js';

/**
 * Sanitizes an origin string into a safe file name component.
 * Converts characters outside [a-zA-Z0-9_-] into hyphens.
 */
export function sanitizeOrigin(origin: string): string {
  if (!origin) return 'session';
  const stripped = origin
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stripped || 'session';
}

/**
 * Constructs the trace export file name for a session.
 */
export function getTraceFilename(origin: string, timestamp: number = Date.now()): string {
  const sanitized = sanitizeOrigin(origin);
  return `webmcp-trace-${sanitized}-${timestamp}.json`;
}

/**
 * Assembles the export payload from tab session state.
 */
export function buildSessionTrace(state: TabSessionState): SessionTraceExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    origin: state.origin || '',
    ...(state.sessionTokenUsage ? { sessionTokenUsage: state.sessionTokenUsage } : {}),
    messages: state.messages ?? [],
    activityLog: state.activityLog ?? [],
    tools: state.tools ?? [],
  };
}

/**
 * Serializes the active session to JSON and triggers a file download in the browser.
 */
export function exportSessionTrace(state: TabSessionState): void {
  const trace = buildSessionTrace(state);
  const json = JSON.stringify(trace, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = getTraceFilename(state.origin);

  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    const container = document.body || document.documentElement;
    container.appendChild(link);
    link.click();
    container.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
