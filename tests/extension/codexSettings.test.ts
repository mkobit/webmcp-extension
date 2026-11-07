/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCodexPort,
  setCodexPort,
  getCodexModel,
  setCodexModel,
  getCodexReasoningEffort,
  setCodexReasoningEffort,
  getBackendMode,
  setBackendMode,
} from '../../extension/sidepanel/services/codexSettings.js';

class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

function setupLocalStorage() {
  const original = (globalThis as any).localStorage;
  const mock = new MockLocalStorage();
  (globalThis as any).localStorage = mock;
  return {
    mock,
    restore: () => {
      (globalThis as any).localStorage = original;
    },
  };
}

test('codexSettings manages port with validation and defaults to 45123', () => {
  const { restore } = setupLocalStorage();
  try {
    assert.equal(getCodexPort(), 45123);

    setCodexPort(8080);
    assert.equal(getCodexPort(), 8080);

    // Invalid port numbers should throw or be ignored
    assert.throws(() => setCodexPort(80), /invalid port/i);
    assert.throws(() => setCodexPort(70000), /invalid port/i);
    assert.throws(() => setCodexPort(NaN), /invalid port/i);

    // Port remains 8080
    assert.equal(getCodexPort(), 8080);
  } finally {
    restore();
  }
});

test('codexSettings persists model and reasoning effort', () => {
  const { restore } = setupLocalStorage();
  try {
    assert.equal(getCodexModel(), '');
    assert.equal(getCodexReasoningEffort(), '');

    setCodexModel('gpt-6.1-sol');
    setCodexReasoningEffort('high');

    assert.equal(getCodexModel(), 'gpt-6.1-sol');
    assert.equal(getCodexReasoningEffort(), 'high');
  } finally {
    restore();
  }
});

test('codexSettings manages backendMode and falls back from legacy onDeviceModel', () => {
  const { mock, restore } = setupLocalStorage();
  try {
    // Fresh: defaults to companion
    assert.equal(getBackendMode(), 'companion');

    // Legacy onDeviceModel === 'true'
    mock.setItem('onDeviceModel', 'true');
    assert.equal(getBackendMode(), 'onDevice');

    // Setting explicit backendMode overrides legacy
    setBackendMode('codex');
    assert.equal(getBackendMode(), 'codex');
    assert.equal(mock.getItem('backendMode'), 'codex');
    assert.equal(mock.getItem('onDeviceModel'), 'false');

    setBackendMode('onDevice');
    assert.equal(getBackendMode(), 'onDevice');
    assert.equal(mock.getItem('onDeviceModel'), 'true');

    setBackendMode('companion');
    assert.equal(getBackendMode(), 'companion');
    assert.equal(mock.getItem('onDeviceModel'), 'false');
  } finally {
    restore();
  }
});
