/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useId, useState } from 'react';
import { CloseIcon, DeviceIcon, ShieldIcon } from '../components/Icons.js';
import { Switch } from '../components/Switch.js';
import type { BackendMode } from '../services/codexSettings.js';
import type { CodexModel } from '../types/codex.js';

export interface SettingsScreenProps {
  sensitiveActionAlerts: boolean;
  onToggleSensitiveActionAlerts: () => void;
  onDeviceModel: boolean;
  onToggleOnDeviceModel: () => void;
  onDeviceModelSupported: boolean;
  /** A response is being generated, which the model must not change under. */
  responseInProgress?: boolean;
  onClose: () => void;

  backendMode?: BackendMode;
  onChangeBackendMode?: (mode: BackendMode) => void;
  codexPort?: number;
  onChangeCodexPort?: (port: number) => void;
  codexModel?: string;
  onChangeCodexModel?: (model: string) => void;
  codexReasoningEffort?: string;
  onChangeCodexReasoningEffort?: (effort: string) => void;
  availableModels?: CodexModel[];
}

/**
 * SettingsScreen Component
 * Presents settings options for permissions, backend, and model configuration.
 */
export function SettingsScreen({
  sensitiveActionAlerts,
  onToggleSensitiveActionAlerts,
  onDeviceModel,
  onToggleOnDeviceModel,
  onDeviceModelSupported,
  responseInProgress = false,
  onClose,
  backendMode,
  onChangeBackendMode,
  codexPort = 45123,
  onChangeCodexPort,
  codexModel = '',
  onChangeCodexModel,
  codexReasoningEffort = '',
  onChangeCodexReasoningEffort,
  availableModels = [],
}: SettingsScreenProps) {
  const alertsDescId = useId();
  const modelDescId = useId();
  const modelLockedId = useId();
  const modelLocked = onDeviceModelSupported && responseInProgress;

  const effectiveBackend: BackendMode =
    backendMode ?? (onDeviceModel ? 'onDevice' : 'companion');

  const [portInput, setPortInput] = useState<string>(() => String(codexPort));
  useEffect(() => {
    setPortInput(String(codexPort));
  }, [codexPort]);

  const selectedModelObj = availableModels.find((m) => m.id === codexModel);
  const reasoningEfforts = selectedModelObj?.supportedReasoningEfforts ?? [];
  const hasReasoning = reasoningEfforts.length > 0;

  return (
    <div className="settings-view">
      <div className="settings-card">
        {/* Header */}
        <div className="settings-card__header">
          <h1 className="settings-title">Settings</h1>
          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            aria-label="Close settings"
            title="Close settings"
          >
            <CloseIcon size={20} color="var(--color-blue-title)" />
          </button>
        </div>

        {/* Permissions Section */}
        <div className="settings-section">
          <h2 className="settings-section__title">Permissions</h2>

          <div className="settings-item">
            <div className="settings-item__icon">
              <ShieldIcon size={24} color="var(--color-on-surface-variant)" />
            </div>
            <div className="settings-item__content">
              <span className="settings-item__title">Sensitive action alerts</span>
              <p id={alertsDescId} className="settings-item__desc">
                Get a prompt before tools make changes to your data or accounts. Some external tools may not support this.
              </p>
            </div>
            <div className="settings-item__control">
              <Switch
                checked={sensitiveActionAlerts}
                onChange={onToggleSensitiveActionAlerts}
                aria-label="Sensitive action alerts"
                aria-describedby={alertsDescId}
              />
            </div>
          </div>
        </div>

        {/* Model Section */}
        <div className="settings-section">
          <h2 className="settings-section__title">Model</h2>

          {/* Backend Selector */}
          {backendMode !== undefined && (
            <div className="settings-item">
              <div className="settings-item__icon">
                <DeviceIcon size={24} color="var(--color-on-surface-variant)" />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__title">Backend</span>
                <p className="settings-item__desc">
                  Select which service powers model generation and tool calling.
                </p>
              </div>
              <div className="settings-item__control">
                <select
                  className="settings-select"
                  aria-label="Backend"
                  value={effectiveBackend}
                  disabled={responseInProgress}
                  onChange={(e) => {
                    const val = e.target.value as BackendMode;
                    if (onChangeBackendMode) {
                      onChangeBackendMode(val);
                    } else {
                      if (val === 'onDevice' && !onDeviceModel) onToggleOnDeviceModel();
                      if (val !== 'onDevice' && onDeviceModel) onToggleOnDeviceModel();
                    }
                  }}
                >
                  <option value="companion">Companion server</option>
                  <option value="onDevice" disabled={!onDeviceModelSupported}>
                    On-device Prompt API
                  </option>
                  <option value="codex">Codex app-server</option>
                </select>
              </div>
            </div>
          )}

          {/* On-device model toggle */}
          {(backendMode === undefined || effectiveBackend === 'onDevice') && (
            <div className="settings-item">
              <div className="settings-item__icon">
                <DeviceIcon size={24} color="var(--color-on-surface-variant)" />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__title">On-device model</span>
                <p id={modelDescId} className="settings-item__desc">
                  {onDeviceModelSupported
                    ? 'Run the model in your browser with the Prompt API, instead of sending prompts and page data to the backend server. No API key needed.'
                    : 'Unavailable: this browser does not expose the Prompt API. Prompts go to the backend server.'}
                </p>
                {modelLocked && (
                  <p id={modelLockedId} className="settings-item__desc">
                    Can be changed once the current response has finished.
                  </p>
                )}
              </div>
              <div className="settings-item__control">
                <Switch
                  checked={onDeviceModel}
                  onChange={onToggleOnDeviceModel}
                  disabled={!onDeviceModelSupported || responseInProgress}
                  aria-label="On-device model"
                  aria-describedby={modelLocked ? `${modelDescId} ${modelLockedId}` : modelDescId}
                />
              </div>
            </div>
          )}

          {/* Codex app-server configuration controls */}
          {effectiveBackend === 'codex' && (
            <>
              <div className="settings-item">
                <div className="settings-item__content">
                  <span className="settings-item__title">Codex port</span>
                  <p className="settings-item__desc">Port number of local codex app-server.</p>
                </div>
                <div className="settings-item__control">
                  <input
                    type="number"
                    className="settings-input"
                    aria-label="Codex port"
                    min={1024}
                    max={65535}
                    value={portInput}
                    disabled={responseInProgress}
                    onChange={(e) => {
                      const text = e.target.value;
                      setPortInput(text);
                      const val = parseInt(text, 10);
                      if (!Number.isNaN(val) && val >= 1024 && val <= 65535) {
                        onChangeCodexPort?.(val);
                      }
                    }}
                    onBlur={() => {
                      const val = parseInt(portInput, 10);
                      if (!Number.isNaN(val) && val >= 1024 && val <= 65535) {
                        onChangeCodexPort?.(val);
                      } else {
                        setPortInput(String(codexPort));
                      }
                    }}
                  />
                </div>
              </div>

              <div className="settings-item">
                <div className="settings-item__content">
                  <span className="settings-item__title">Codex model</span>
                  <p className="settings-item__desc">Active model on local codex app-server.</p>
                </div>
                <div className="settings-item__control">
                  <select
                    className="settings-select"
                    aria-label="Codex model"
                    value={codexModel}
                    disabled={responseInProgress}
                    onChange={(e) => onChangeCodexModel?.(e.target.value)}
                  >
                    {availableModels.length === 0 ? (
                      <option value={codexModel}>{codexModel || 'Default'}</option>
                    ) : (
                      availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName || m.id}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {hasReasoning && (
                <div className="settings-item">
                  <div className="settings-item__content">
                    <span className="settings-item__title">Reasoning effort</span>
                    <p className="settings-item__desc">Level of reasoning effort for this model.</p>
                  </div>
                  <div className="settings-item__control">
                    <select
                      className="settings-select"
                      aria-label="Reasoning effort"
                      value={codexReasoningEffort}
                      disabled={responseInProgress}
                      onChange={(e) => onChangeCodexReasoningEffort?.(e.target.value)}
                    >
                      {reasoningEfforts.map((r) => (
                        <option key={r.reasoningEffort} value={r.reasoningEffort}>
                          {r.description
                            ? `${r.reasoningEffort} (${r.description})`
                            : r.reasoningEffort}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
