/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllFrameOrigins, getFrameOrigin } from '../../extension/frameOrigins.js';

test('getAllFrameOrigins returns empty array when webNavigation is unavailable', async () => {
  const origins = await getAllFrameOrigins(123);
  assert.deepEqual(origins, []);
});

test('getAllFrameOrigins extracts unique cross-origin iframe origins', async () => {
  globalThis.chrome = {
    webNavigation: {
      getAllFrames: async () => [
        { frameId: 0, url: 'https://parent.example.com' },
        { frameId: 1, url: 'https://iframe1.example.com/page' },
        { frameId: 2, url: 'https://iframe2.example.com/page' },
        { frameId: 3, url: 'https://iframe1.example.com/another' },
      ],
    },
  } as unknown as typeof chrome;

  const origins = await getAllFrameOrigins(123);
  assert.deepEqual(origins, ['https://parent.example.com', 'https://iframe1.example.com', 'https://iframe2.example.com']);

  delete (globalThis as { chrome?: unknown }).chrome;
});

test('getFrameOrigin returns undefined when chrome or webNavigation.getFrame is unavailable', async () => {
  delete (globalThis as { chrome?: unknown }).chrome;
  const originNoChrome = await getFrameOrigin(123, 0);
  assert.equal(originNoChrome, undefined);

  globalThis.chrome = {} as unknown as typeof chrome;
  const originNoWebNav = await getFrameOrigin(123, 0);
  assert.equal(originNoWebNav, undefined);

  globalThis.chrome = { webNavigation: {} } as unknown as typeof chrome;
  const originNoGetFrame = await getFrameOrigin(123, 0);
  assert.equal(originNoGetFrame, undefined);

  delete (globalThis as { chrome?: unknown }).chrome;
});

test('getFrameOrigin returns origin string when frame URL is valid HTTP/HTTPS', async () => {
  globalThis.chrome = {
    webNavigation: {
      getFrame: async ({ tabId, frameId }: { tabId: number; frameId: number }) => {
        if (tabId === 123 && frameId === 1) {
          return { frameId: 1, url: 'https://sub.example.com:8080/nested/path?query=1' };
        }
        return null;
      },
    },
  } as unknown as typeof chrome;

  const origin = await getFrameOrigin(123, 1);
  assert.equal(origin, 'https://sub.example.com:8080');

  delete (globalThis as { chrome?: unknown }).chrome;
});

test('getFrameOrigin returns undefined when frame is not found or url is undefined', async () => {
  globalThis.chrome = {
    webNavigation: {
      getFrame: async ({ frameId }: { frameId: number }) => {
        if (frameId === 404) {
          return null;
        }
        if (frameId === 500) {
          return { frameId: 500, url: '' };
        }
        if (frameId === 600) {
          throw new Error('Frame not found');
        }
        return { frameId };
      },
    },
  } as unknown as typeof chrome;

  assert.equal(await getFrameOrigin(123, 404), undefined);
  assert.equal(await getFrameOrigin(123, 500), undefined);
  assert.equal(await getFrameOrigin(123, 600), undefined);
  assert.equal(await getFrameOrigin(123, 700), undefined);

  delete (globalThis as { chrome?: unknown }).chrome;
});

test('getFrameOrigin returns undefined when frame URL origin is opaque or invalid', async () => {
  globalThis.chrome = {
    webNavigation: {
      getFrame: async ({ frameId }: { frameId: number }) => {
        if (frameId === 1) return { frameId: 1, url: 'about:blank' };
        if (frameId === 2) return { frameId: 2, url: 'data:text/html,hello' };
        if (frameId === 3) return { frameId: 3, url: 'not-a-valid-url' };
        return null;
      },
    },
  } as unknown as typeof chrome;

  assert.equal(await getFrameOrigin(123, 1), undefined);
  assert.equal(await getFrameOrigin(123, 2), undefined);
  assert.equal(await getFrameOrigin(123, 3), undefined);

  delete (globalThis as { chrome?: unknown }).chrome;
});

