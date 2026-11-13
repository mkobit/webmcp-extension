/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatRelativeTime,
  deriveSessionTitle,
  listDomainSessions,
  getStoredSession,
  saveStoredSession,
  deleteStoredSession,
  type StoredSession,
} from '../../extension/sidepanel/services/sessionHistoryStore.js';

interface TestChrome {
  storage: Map<string, unknown>;
  restore: () => void;
}

function installTestChrome(): TestChrome {
  const original = globalThis.chrome;
  const storage = new Map<string, unknown>();

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys?: string | string[] | Record<string, unknown> | null) => {
          if (!keys) {
            return Object.fromEntries(storage.entries());
          }
          if (typeof keys === 'string') {
            return storage.has(keys) ? { [keys]: storage.get(keys) } : {};
          }
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              if (storage.has(key)) result[key] = storage.get(key);
            }
            return result;
          }
          return {};
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            storage.set(key, value);
          }
        },
        remove: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) {
            storage.delete(key);
          }
        },
      },
    },
  } as unknown as typeof chrome;

  return {
    storage,
    restore: () => {
      globalThis.chrome = original;
    },
  };
}

test('deriveSessionTitle formats and truncates prompt cleanly', () => {
  assert.equal(deriveSessionTitle('How do I use this tool?'), 'How do I use this tool?');
  assert.equal(deriveSessionTitle('   Hello world!   '), 'Hello world!');
  assert.equal(
    deriveSessionTitle('This is a very long prompt that exceeds sixty characters and should therefore be truncated with ellipsis'),
    'This is a very long prompt that exceeds sixty characters...'
  );
  assert.equal(deriveSessionTitle(''), 'New session');
  assert.equal(deriveSessionTitle('   \n\t  '), 'New session');
  assert.equal(deriveSessionTitle('First line\nSecond line'), 'First line Second line');
});

test('formatRelativeTime formats minutes, hours, and days relative to now', () => {
  const now = 1700000000000;
  assert.equal(formatRelativeTime(now - 10000, now), 'Just now');
  assert.equal(formatRelativeTime(now - 60000, now), '1 minute ago');
  assert.equal(formatRelativeTime(now - 5 * 60000, now), '5 minutes ago');
  assert.equal(formatRelativeTime(now - 3600000, now), '1 hour ago');
  assert.equal(formatRelativeTime(now - 4 * 3600000, now), '4 hours ago');
  assert.equal(formatRelativeTime(now - 24 * 3600000, now), '1 day ago');
  assert.equal(formatRelativeTime(now - 3 * 24 * 3600000, now), '3 days ago');
  // Over 7 days returns localized date string
  const olderDate = formatRelativeTime(now - 14 * 24 * 3600000, now);
  assert.ok(olderDate.length > 0 && !olderDate.includes('ago'));
});

test('listDomainSessions returns empty list when no sessions exist', async () => {
  const browser = installTestChrome();
  try {
    const list = await listDomainSessions('example.com');
    assert.deepEqual(list, []);
  } finally {
    browser.restore();
  }
});

test('saveStoredSession saves full session and updates domain index sorted by updatedAt', async () => {
  const browser = installTestChrome();
  try {
    const session1: StoredSession = {
      id: 'session-1',
      domain: 'my.moergo.com',
      origin: 'https://my.moergo.com',
      title: 'First chat',
      createdAt: 1000,
      updatedAt: 1000,
      messageCount: 2,
      messages: [
        { id: 1, role: 'user', text: 'First chat' },
        { id: 2, role: 'ai', text: 'Reply 1' },
      ],
      activityLog: [],
      codexThreadId: 'thread-1',
    };

    const session2: StoredSession = {
      id: 'session-2',
      domain: 'my.moergo.com',
      origin: 'https://my.moergo.com',
      title: 'Second chat',
      createdAt: 2000,
      updatedAt: 3000,
      messageCount: 2,
      messages: [
        { id: 3, role: 'user', text: 'Second chat' },
        { id: 4, role: 'ai', text: 'Reply 2' },
      ],
      activityLog: [],
      codexThreadId: 'thread-2',
    };

    await saveStoredSession(session1);
    await saveStoredSession(session2);

    // List should return session2 first (updatedAt: 3000 > 1000)
    const list = await listDomainSessions('my.moergo.com');
    assert.equal(list.length, 2);
    assert.equal(list[0].id, 'session-2');
    assert.equal(list[0].title, 'Second chat');
    assert.equal(list[1].id, 'session-1');

    // Retrieve single session
    const retrieved = await getStoredSession('session-1');
    assert.ok(retrieved);
    assert.equal(retrieved.id, 'session-1');
    assert.equal(retrieved.messages.length, 2);
    assert.equal(retrieved.codexThreadId, 'thread-1');
  } finally {
    browser.restore();
  }
});

test('deleteStoredSession removes session and domain index entry', async () => {
  const browser = installTestChrome();
  try {
    const session: StoredSession = {
      id: 'session-del',
      domain: 'test.com',
      origin: 'https://test.com',
      title: 'To delete',
      createdAt: 1000,
      updatedAt: 1000,
      messageCount: 1,
      messages: [{ id: 1, role: 'user', text: 'To delete' }],
      activityLog: [],
    };

    await saveStoredSession(session);
    assert.equal((await listDomainSessions('test.com')).length, 1);

    await deleteStoredSession('test.com', 'session-del');
    assert.deepEqual(await listDomainSessions('test.com'), []);
    assert.equal(await getStoredSession('session-del'), null);
  } finally {
    browser.restore();
  }
});
