/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ActivityEntry, type ChatMessage, type TokenUsage } from '../types/index.js';

export interface SessionSummary {
  id: string;
  domain: string;
  origin: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface StoredSession extends SessionSummary {
  messages: ChatMessage[];
  activityLog: ActivityEntry[];
  tokenUsage?: TokenUsage;
  codexThreadId?: string;
}

export const SESSION_RECORD_PREFIX = 'session_v1_';
export const DOMAIN_SESSIONS_PREFIX = 'domain_sessions_v1_';

export function getSessionRecordKey(sessionId: string): string {
  return `${SESSION_RECORD_PREFIX}${sessionId}`;
}

export function getDomainSessionsKey(domain: string): string {
  return `${DOMAIN_SESSIONS_PREFIX}${domain}`;
}

/**
 * Derives a clean display title from the user's first prompt, truncating at 60 characters.
 */
export function deriveSessionTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New session';
  if (normalized.length <= 60) return normalized;
  return `${normalized.slice(0, 57).trimEnd()}...`;
}

/**
 * Formats a timestamp into human-readable relative time (for example, "5 minutes ago"),
 * falling back to a localized date string for events older than 7 days.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffDays < 7) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Lists past sessions for a domain, ordered by most recently updated first.
 */
export async function listDomainSessions(domain: string): Promise<SessionSummary[]> {
  if (!domain || typeof chrome === 'undefined' || !chrome?.storage?.local) return [];
  const key = getDomainSessionsKey(domain);
  try {
    const result = await chrome.storage.local.get(key);
    const summaries = (result[key] as SessionSummary[]) ?? [];
    return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.warn('[WebMCP] Failed to list domain sessions:', error);
    return [];
  }
}

/**
 * Retrieves the complete stored session payload by session ID.
 */
export async function getStoredSession(sessionId: string): Promise<StoredSession | null> {
  if (!sessionId || typeof chrome === 'undefined' || !chrome?.storage?.local) return null;
  const key = getSessionRecordKey(sessionId);
  try {
    const result = await chrome.storage.local.get(key);
    const session = result[key] as StoredSession | undefined;
    return session ?? null;
  } catch (error) {
    console.warn('[WebMCP] Failed to get stored session:', error);
    return null;
  }
}

/**
 * Saves a session payload and updates the domain session index.
 */
export async function saveStoredSession(session: StoredSession): Promise<void> {
  if (!session.domain || !session.id || typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  const sessionKey = getSessionRecordKey(session.id);
  const domainKey = getDomainSessionsKey(session.domain);

  const summary: SessionSummary = {
    id: session.id,
    domain: session.domain,
    origin: session.origin,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages?.length ?? 0,
  };

  try {
    const domainResult = await chrome.storage.local.get(domainKey);
    const existingSummaries = (domainResult[domainKey] as SessionSummary[]) ?? [];
    const filtered = existingSummaries.filter((s) => s.id !== session.id);
    const updatedSummaries = [summary, ...filtered].sort((a, b) => b.updatedAt - a.updatedAt);

    await chrome.storage.local.set({
      [sessionKey]: session,
      [domainKey]: updatedSummaries,
    });
  } catch (error) {
    console.warn('[WebMCP] Failed to save stored session:', error);
  }
}

/**
 * Removes a session payload and deletes its reference from the domain session index.
 */
export async function deleteStoredSession(domain: string, sessionId: string): Promise<void> {
  if (!domain || !sessionId || typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  const sessionKey = getSessionRecordKey(sessionId);
  const domainKey = getDomainSessionsKey(domain);

  try {
    const domainResult = await chrome.storage.local.get(domainKey);
    const existingSummaries = (domainResult[domainKey] as SessionSummary[]) ?? [];
    const updatedSummaries = existingSummaries.filter((s) => s.id !== sessionId);

    await chrome.storage.local.remove(sessionKey);
    await chrome.storage.local.set({
      [domainKey]: updatedSummaries,
    });
  } catch (error) {
    console.warn('[WebMCP] Failed to delete stored session:', error);
  }
}
