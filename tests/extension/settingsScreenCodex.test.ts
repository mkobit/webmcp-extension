/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SettingsScreen } from '../../extension/sidepanel/screens/SettingsScreen.js';
import type { CodexModel } from '../../extension/sidepanel/types/codex.js';

const mockModels: CodexModel[] = [
  {
    id: 'gpt-6.1-sol',
    displayName: 'GPT-6.1 Sol',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Standard' },
      { reasoningEffort: 'high', description: 'Deep reasoning' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-6-fast',
    displayName: 'GPT-6 Fast',
    // No reasoning efforts
  },
];

test('SettingsScreen renders backend mode selection controls', () => {
  const html = renderToString(
    React.createElement(SettingsScreen, {
      sensitiveActionAlerts: true,
      onToggleSensitiveActionAlerts: () => {},
      onDeviceModel: false,
      onToggleOnDeviceModel: () => {},
      onDeviceModelSupported: true,
      backendMode: 'companion',
      onChangeBackendMode: () => {},
      onClose: () => {},
    })
  );

  assert.ok(html.includes('Backend'));
  assert.ok(html.includes('Companion server'));
  assert.ok(html.includes('Codex app-server'));
});

test('SettingsScreen renders port, model, and reasoning selectors when Codex backend is active', () => {
  const html = renderToString(
    React.createElement(SettingsScreen, {
      sensitiveActionAlerts: true,
      onToggleSensitiveActionAlerts: () => {},
      onDeviceModel: false,
      onToggleOnDeviceModel: () => {},
      onDeviceModelSupported: true,
      backendMode: 'codex',
      onChangeBackendMode: () => {},
      codexPort: 45123,
      onChangeCodexPort: () => {},
      codexModel: 'gpt-6.1-sol',
      onChangeCodexModel: () => {},
      codexReasoningEffort: 'medium',
      onChangeCodexReasoningEffort: () => {},
      availableModels: mockModels,
      onClose: () => {},
    })
  );

  assert.ok(html.includes('aria-label="Codex port"'));
  assert.ok(html.includes('value="45123"'));
  assert.ok(html.includes('aria-label="Codex model"'));
  assert.ok(html.includes('GPT-6.1 Sol'));
  assert.ok(html.includes('aria-label="Reasoning effort"'));
  assert.ok(html.includes('Deep reasoning') || html.includes('high'));
});

test('SettingsScreen hides or disables reasoning effort dropdown when model has no reasoning options', () => {
  const html = renderToString(
    React.createElement(SettingsScreen, {
      sensitiveActionAlerts: true,
      onToggleSensitiveActionAlerts: () => {},
      onDeviceModel: false,
      onToggleOnDeviceModel: () => {},
      onDeviceModelSupported: true,
      backendMode: 'codex',
      onChangeBackendMode: () => {},
      codexPort: 45123,
      onChangeCodexPort: () => {},
      codexModel: 'gpt-6-fast',
      onChangeCodexModel: () => {},
      codexReasoningEffort: '',
      onChangeCodexReasoningEffort: () => {},
      availableModels: mockModels,
      onClose: () => {},
    })
  );

  // Reasoning dropdown should not be rendered or should be disabled when model has no reasoning efforts
  const hasReasoningDropdown = html.includes('aria-label="Reasoning effort"');
  if (hasReasoningDropdown) {
    assert.ok(html.includes('disabled'));
  } else {
    assert.equal(hasReasoningDropdown, false);
  }
});

test('SettingsScreen locks backend, port, and model inputs when responseInProgress is true', () => {
  const html = renderToString(
    React.createElement(SettingsScreen, {
      sensitiveActionAlerts: true,
      onToggleSensitiveActionAlerts: () => {},
      onDeviceModel: false,
      onToggleOnDeviceModel: () => {},
      onDeviceModelSupported: true,
      backendMode: 'codex',
      onChangeBackendMode: () => {},
      codexPort: 45123,
      onChangeCodexPort: () => {},
      codexModel: 'gpt-6.1-sol',
      onChangeCodexModel: () => {},
      codexReasoningEffort: 'medium',
      onChangeCodexReasoningEffort: () => {},
      availableModels: mockModels,
      responseInProgress: true,
      onClose: () => {},
    })
  );

  // Port input must be disabled
  assert.match(html, /<input[^>]*aria-label="Codex port"[^>]*disabled/);
  // Model selector must be disabled
  assert.match(html, /<select[^>]*aria-label="Codex model"[^>]*disabled/);
  // Backend selector must be disabled
  assert.match(html, /<select[^>]*aria-label="Backend"[^>]*disabled/);
});
