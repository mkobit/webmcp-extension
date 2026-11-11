/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The distinct origins of every frame in a tab, so the content script can ask
 * `document.modelContext.getTools()` for tools from cross-origin iframes too.
 * Frames without an origin (about:blank, data: URLs) are left out.
 *
 * Used by both the service worker and the side panel.
 */
export async function getAllFrameOrigins(tabId: number): Promise<string[]> {
  if (typeof chrome === 'undefined' || !chrome.webNavigation?.getAllFrames) {
    return [];
  }
  try {
    const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
    const origins = frames
      .map((frame) => {
        try {
          return new URL(frame.url).origin;
        } catch {
          return 'null';
        }
      })
      .filter((origin) => origin !== 'null');
    return [...new Set(origins)];
  } catch {
    return [];
  }
}

/**
 * Look up the origin of a specific frame in a tab.
 * Frames without a web origin (about:blank, data: URLs) return undefined.
 */
export async function getFrameOrigin(tabId: number, frameId: number): Promise<string | undefined> {
  if (typeof chrome === 'undefined' || !chrome.webNavigation?.getFrame) {
    return undefined;
  }
  try {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId });
    if (!frame?.url) {
      return undefined;
    }
    const origin = new URL(frame.url).origin;
    return origin !== 'null' ? origin : undefined;
  } catch {
    return undefined;
  }
}

