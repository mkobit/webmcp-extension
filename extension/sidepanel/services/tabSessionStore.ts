/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { endChat } from './chatBridge.js';
import { clearSessionToolPermissions } from './toolPermissions.js';
import {
  type ActivityEntry,
  type ChatMessage,
  type PendingToolCheckpoint,
  type PendingToolPermission,
  type TokenUsage,
  type WebMCPTool,
} from '../types/index.js';

/**
 * Everything the side panel shows for one tab.
 *
 * The panel is a single window shared by every tab, so without a key like this
 * one tab's conversation — and, worse, its permission prompt — would still be
 * on screen after switching to a page that never asked for anything. Each tab
 * keeps its own, and the panel renders whichever tab is in front.
 */
export interface TabSessionState {
  /** What is typed in the composer but not sent yet. */
  userPrompt: string;
  messages: ChatMessage[];
  busy: boolean;
  activityLog: ActivityEntry[];
  /** The reply being written right now, until it becomes one of `messages`. */
  streamingText: string;
  pendingPermission: PendingToolPermission | null;
  /** Set while the agent waits for the user to let it keep using tools. */
  pendingCheckpoint: PendingToolCheckpoint | null;
  /** The tools the page in this tab exposes, as last reported. */
  tools: WebMCPTool[];
  domain: string;
  origin: string;
  favicon: string;
  statusMsg: string;
  sessionTokenUsage?: TokenUsage;
}

export interface PersistedSessionData {
  version: 1;
  origin: string;
  tabId: number;
  updatedAt: number;
  messages: ChatMessage[];
  activityLog: ActivityEntry[];
  tokenUsage?: TokenUsage;
  codexThreadId?: string;
}

export const SESSION_STORAGE_PREFIX = 'active_session_';
export const SESSION_EXPIRATION_MS = 24 * 60 * 60 * 1000;
export const SESSION_SAVE_DEBOUNCE_MS = 500;

export function getSessionStorageKey(origin: string, tabId: number): string {
  return `${SESSION_STORAGE_PREFIX}${origin}_${tabId}`;
}

/**
 * The state of a tab nothing has happened in yet. Shared rather than rebuilt
 * per read: `useSyncExternalStore` compares snapshots by identity and would
 * loop forever on a fresh object every time.
 */
const EMPTY_TAB_SESSION: TabSessionState = Object.freeze({
  userPrompt: '',
  messages: Object.freeze([]) as unknown as ChatMessage[],
  busy: false,
  activityLog: Object.freeze([]) as unknown as ActivityEntry[],
  streamingText: '',
  pendingPermission: null,
  pendingCheckpoint: null,
  tools: Object.freeze([]) as unknown as WebMCPTool[],
  domain: '',
  origin: '',
  favicon: '',
  statusMsg: '',
});

/**
 * The parts of a tab's session that drive a turn but are never rendered. They
 * are mutated in place, the way the refs they replace were: a turn reads them
 * long after the render that started it.
 */
export interface TabSessionInternals {
  /** Identifies the conversation to whichever backend is holding it. */
  chatId?: string;
  codexThreadId?: string;
  codexTurnId?: string;
  abortController: AbortController | null;
  /** The activity of the turn in flight, for the message it ends up on. */
  turnLogs: ActivityEntry[];
}

type TabSessionPatch =
  | Partial<TabSessionState>
  | ((previous: TabSessionState) => Partial<TabSessionState>);

function isUnchanged(previous: TabSessionState, next: TabSessionState): boolean {
  return (Object.keys(next) as Array<keyof TabSessionState>).every((key) => previous[key] === next[key]);
}

/**
 * The side panel's per-tab state, outside React so that a turn running in a
 * background tab keeps writing to its own tab while the user works in another.
 */
class TabSessionStore {
  private states = new Map<number, TabSessionState>();
  private internals = new Map<number, TabSessionInternals>();
  private listeners = new Set<() => void>();
  private pendingWrites = new Map<number, { timer: ReturnType<typeof setTimeout>; origin: string }>();
  private attachedChrome: typeof chrome | null = null;

  constructor() {
    this.ensureChromeListeners();
  }

  private ensureChromeListeners(): void {
    const chromeApi = typeof chrome !== 'undefined' ? chrome : undefined;
    if (chromeApi?.tabs?.onRemoved?.addListener && this.attachedChrome !== chromeApi) {
      this.attachedChrome = chromeApi;
      try {
        chromeApi.tabs.onRemoved.addListener((tabId) => {
          void this.clearSessionStorageForTab(tabId);
        });
      } catch {}
    }
  }

  /** Bound so React sees the same function across renders. */
  subscribe = (listener: () => void): (() => void) => {
    this.ensureChromeListeners();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The state to render for `tabId`, or the empty one for an unknown tab. */
  getState = (tabId: number | null | undefined): TabSessionState => {
    this.ensureChromeListeners();
    if (tabId == null) return EMPTY_TAB_SESSION;
    return this.states.get(tabId) ?? EMPTY_TAB_SESSION;
  };

  /** Whether `tabId` holds an active turn or existing conversation worth following in the background. */
  hasConversation(tabId: number): boolean {
    const state = this.states.get(tabId);
    const internals = this.internals.get(tabId);
    return Boolean(state?.busy || state?.messages.length || internals?.chatId);
  }

  /**
   * Applies `patch` to a tab's state and tells React, unless nothing changed:
   * reports of an unchanged tool list arrive on a timer, and re-rendering the
   * panel for each of them would be waste.
   */
  update(tabId: number, patch: TabSessionPatch): void {
    const previous = this.getState(tabId);
    const changes = typeof patch === 'function' ? patch(previous) : patch;
    const next: TabSessionState = { ...previous, ...changes };
    if (this.states.has(tabId) && isUnchanged(previous, next)) return;
    this.states.set(tabId, next);
    this.emit();

    if (
      next.origin &&
      (previous.messages !== next.messages ||
        previous.activityLog !== next.activityLog ||
        previous.sessionTokenUsage !== next.sessionTokenUsage)
    ) {
      if (next.messages.length > 0 || next.activityLog.length > 0) {
        this.saveActiveSession(tabId, next.origin);
      }
    }
  }

  /** The turn state of `tabId`, created on first use. */
  getInternals(tabId: number): TabSessionInternals {
    let internals = this.internals.get(tabId);
    if (!internals) {
      internals = { chatId: undefined, abortController: null, turnLogs: [] };
      this.internals.set(tabId, internals);
    }
    return internals;
  }

  /** Every tab the panel is holding something for. */
  tabIds(): number[] {
    return [...new Set([...this.states.keys(), ...this.internals.keys()])];
  }

  /** The tabs with a turn in flight, which need the shared model in turn. */
  busyTabIds(): number[] {
    return [...this.states.entries()].filter(([, state]) => state.busy).map(([tabId]) => tabId);
  }

  /** Bound for `useSyncExternalStore`, which needs one stable function. */
  isAnyBusy = (): boolean => {
    for (const state of this.states.values()) {
      if (state.busy) return true;
    }
    return false;
  };

  /** Queues a debounced write of the tab's session to chrome.storage.local. */
  saveActiveSession = (tabId: number, origin: string): void => {
    if (!origin) return;
    const existing = this.pendingWrites.get(tabId);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.pendingWrites.delete(tabId);
      void this.persistSessionNow(tabId, origin);
    }, SESSION_SAVE_DEBOUNCE_MS);
    this.pendingWrites.set(tabId, { timer, origin });
  };

  /** Flushes any pending debounced session save immediately. */
  flushActiveSession = async (tabId: number): Promise<void> => {
    const pending = this.pendingWrites.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(tabId);
      await this.persistSessionNow(tabId, pending.origin);
      return;
    }
    const state = this.getState(tabId);
    if (state.origin) {
      await this.persistSessionNow(tabId, state.origin);
    }
  };

  private async persistSessionNow(tabId: number, origin: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    const state = this.getState(tabId);
    const internals = this.internals.get(tabId);
    const key = getSessionStorageKey(origin, tabId);
    const data: PersistedSessionData = {
      version: 1,
      origin,
      tabId,
      updatedAt: Date.now(),
      messages: state.messages,
      activityLog: state.activityLog,
      tokenUsage: state.sessionTokenUsage,
      codexThreadId: internals?.codexThreadId,
    };
    try {
      await chrome.storage.local.set({ [key]: data });
    } catch (error) {
      console.warn('[WebMCP] Failed to persist active session to chrome.storage.local:', error);
    }
  }

  /** Hydrates a session from chrome.storage.local if present and not expired. */
  restoreActiveSession = async (tabId: number, origin: string): Promise<boolean> => {
    if (!origin || typeof chrome === 'undefined' || !chrome?.storage?.local) return false;
    const key = getSessionStorageKey(origin, tabId);
    try {
      const result = await chrome.storage.local.get(key);
      const data = result[key] as PersistedSessionData | undefined;
      if (!data || data.version !== 1) return false;

      if (Date.now() - data.updatedAt > SESSION_EXPIRATION_MS) {
        await chrome.storage.local.remove(key);
        return false;
      }

      const internals = this.getInternals(tabId);
      if (data.codexThreadId) {
        internals.codexThreadId = data.codexThreadId;
      }
      this.update(tabId, {
        messages: data.messages ?? [],
        activityLog: data.activityLog ?? [],
        sessionTokenUsage: data.tokenUsage,
      });
      return true;
    } catch (error) {
      console.warn('[WebMCP] Failed to restore active session from chrome.storage.local:', error);
      return false;
    }
  };

  /** Deletes the stored session from chrome.storage.local. */
  clearActiveSession = async (tabId: number, origin: string): Promise<void> => {
    const pending = this.pendingWrites.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(tabId);
    }
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    const key = getSessionStorageKey(origin, tabId);
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.warn('[WebMCP] Failed to clear active session from chrome.storage.local:', error);
    }
  };

  /** Removes all session storage keys for a tab. */
  clearSessionStorageForTab = async (tabId: number): Promise<void> => {
    const pending = this.pendingWrites.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(tabId);
    }
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    try {
      const all = await chrome.storage.local.get(null);
      const suffix = `_${tabId}`;
      const keysToRemove = Object.keys(all).filter(
        (k) => k.startsWith(SESSION_STORAGE_PREFIX) && k.endsWith(suffix)
      );
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.warn('[WebMCP] Failed to remove storage for tab:', error);
    }
  };

  /**
   * Resets a tab's conversation state and releases its backend session while
   * keeping the tab's discovered tools and page metadata intact.
   */
  resetChat(tabId: number, options: { onDevice?: boolean; codex?: boolean } = {}): void {
    const pending = this.pendingWrites.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(tabId);
    }
    const internals = this.internals.get(tabId);
    if (internals) {
      internals.abortController?.abort();
      internals.abortController = null;
      if (internals.chatId) {
        endChat(internals.chatId, options);
        internals.chatId = undefined;
      }
      internals.codexThreadId = undefined;
      internals.codexTurnId = undefined;
      internals.turnLogs = [];
    }
    clearSessionToolPermissions(tabId);
    this.update(tabId, {
      userPrompt: '',
      messages: [],
      activityLog: [],
      streamingText: '',
      pendingPermission: null,
      pendingCheckpoint: null,
      busy: false,
      sessionTokenUsage: undefined,
    });
  }

  /**
   * Migrates session and storage from an old tab ID to a new tab ID when Chrome
   * replaces a tab (e.g. on prerendering or instant navigation).
   */
  migrateTab = async (fromTabId: number, toTabId: number): Promise<void> => {
    const pending = this.pendingWrites.get(fromTabId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(fromTabId);
    }

    const state = this.states.get(fromTabId);
    const internals = this.internals.get(fromTabId);
    if (!state && !internals) return;

    if (state) {
      this.states.set(toTabId, state);
      this.states.delete(fromTabId);
    }
    if (internals) {
      this.internals.set(toTabId, internals);
      this.internals.delete(fromTabId);
    }

    if (state?.origin && typeof chrome !== 'undefined' && chrome?.storage?.local) {
      const oldKey = getSessionStorageKey(state.origin, fromTabId);
      const newKey = getSessionStorageKey(state.origin, toTabId);
      try {
        const result = await chrome.storage.local.get(oldKey);
        const data = result[oldKey] as PersistedSessionData | undefined;
        if (data) {
          await chrome.storage.local.set({ [newKey]: { ...data, tabId: toTabId } });
          await chrome.storage.local.remove(oldKey);
        }
      } catch (error) {
        console.warn('[WebMCP] Failed to migrate tab session storage:', error);
      }
    }
    this.emit();
  };

  /**
   * Stops and forgets a tab's session, for a tab that has been closed. The
   * conversation is ended on the backend too, so a chat nothing can reach
   * again does not sit there holding context.
   */
  remove(tabId: number, options: { onDevice?: boolean; codex?: boolean } = {}): void {
    const pending = this.pendingWrites.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(tabId);
    }
    const state = this.states.get(tabId);
    if (state?.origin) {
      void this.clearActiveSession(tabId, state.origin);
    }
    const internals = this.internals.get(tabId);
    if (internals) {
      internals.abortController?.abort();
      if (internals.chatId) endChat(internals.chatId, options);
      internals.codexThreadId = undefined;
      internals.codexTurnId = undefined;
    }
    clearSessionToolPermissions(tabId);
    const existed = this.states.delete(tabId);
    this.internals.delete(tabId);
    if (existed) this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const tabSessions = new TabSessionStore();

export function initTabSessionListeners(): void {
  const chromeApi = typeof chrome !== 'undefined' ? chrome : undefined;
  if (chromeApi?.tabs?.onRemoved?.addListener) {
    try {
      chromeApi.tabs.onRemoved.addListener((tabId) => {
        void tabSessions.clearSessionStorageForTab(tabId);
      });
    } catch {}
  }
}

export function saveActiveSession(tabId: number, origin: string): void {
  tabSessions.saveActiveSession(tabId, origin);
}

export function flushActiveSession(tabId: number): Promise<void> {
  return tabSessions.flushActiveSession(tabId);
}

export function restoreActiveSession(tabId: number, origin: string): Promise<boolean> {
  return tabSessions.restoreActiveSession(tabId, origin);
}

export function clearActiveSession(tabId: number, origin: string): Promise<void> {
  return tabSessions.clearActiveSession(tabId, origin);
}

export function migrateTab(fromTabId: number, toTabId: number): Promise<void> {
  return tabSessions.migrateTab(fromTabId, toTabId);
}
