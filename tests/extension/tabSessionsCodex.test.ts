/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tabSessions } from '../../extension/sidepanel/services/tabSessionStore.js';

test('tabSessions stores and retains codexThreadId and codexTurnId per tab', () => {
  const internals1 = tabSessions.getInternals(101);
  internals1.codexThreadId = 'thread-tab-101';
  internals1.codexTurnId = 'turn-tab-101';

  const internals2 = tabSessions.getInternals(102);
  internals2.codexThreadId = 'thread-tab-102';
  internals2.codexTurnId = 'turn-tab-102';

  assert.equal(tabSessions.getInternals(101).codexThreadId, 'thread-tab-101');
  assert.equal(tabSessions.getInternals(101).codexTurnId, 'turn-tab-101');
  assert.equal(tabSessions.getInternals(102).codexThreadId, 'thread-tab-102');
  assert.equal(tabSessions.getInternals(102).codexTurnId, 'turn-tab-102');
});

test('resetChat clears codexThreadId and codexTurnId and aborts in-flight controller for target tab only', () => {
  const internals1 = tabSessions.getInternals(201);
  internals1.codexThreadId = 'thread-201';
  internals1.codexTurnId = 'turn-201';
  const controller1 = new AbortController();
  internals1.abortController = controller1;

  const internals2 = tabSessions.getInternals(202);
  internals2.codexThreadId = 'thread-202';
  internals2.codexTurnId = 'turn-202';
  const controller2 = new AbortController();
  internals2.abortController = controller2;

  tabSessions.resetChat(201, { codex: true });

  assert.equal(internals1.codexThreadId, undefined);
  assert.equal(internals1.codexTurnId, undefined);
  assert.equal(internals1.abortController, null);
  assert.equal(controller1.signal.aborted, true);

  // Tab 202 remains intact
  assert.equal(internals2.codexThreadId, 'thread-202');
  assert.equal(internals2.codexTurnId, 'turn-202');
  assert.equal(internals2.abortController, controller2);
  assert.equal(controller2.signal.aborted, false);
});
