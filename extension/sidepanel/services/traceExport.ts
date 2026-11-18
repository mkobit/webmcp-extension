/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionTraceExport } from '../types/index.js';
import type { TabSessionState } from './tabSessionStore.js';

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

/** Copies the active session as JSON to the clipboard. */
export async function copySessionTrace(state: TabSessionState): Promise<void> {
  const trace = buildSessionTrace(state);
  await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
}
