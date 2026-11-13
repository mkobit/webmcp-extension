/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ButtonUI, type ButtonVariant } from './ButtonUI.js';
import { DownloadIcon, HistoryIcon, SettingsIcon } from './Icons.js';

export interface ToolbarProps {
  actionVariant?: ButtonVariant;
  onActionClick?: () => void;
  onSettingsClick?: () => void;
  onExportTrace?: () => void;
  canExport?: boolean;
  onToggleHistory?: () => void;
  showingHistory?: boolean;
}

/**
 * Toolbar Component
 * Toolbar footer inside the prompt composer.
 */
export function Toolbar({
  actionVariant = 'live',
  onActionClick,
  onSettingsClick,
  onExportTrace,
  canExport = true,
  onToggleHistory,
  showingHistory = false,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      {onSettingsClick && (
        <button
          type="button"
          className="toolbar__settings-btn"
          onClick={onSettingsClick}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon size={20} color="var(--color-on-surface-variant)" />
        </button>
      )}
      {onToggleHistory && (
        <button
          type="button"
          className={`toolbar__history-btn ${showingHistory ? 'toolbar__history-btn--active' : ''}`}
          onClick={onToggleHistory}
          aria-label={showingHistory ? 'Show active chat' : 'Show past sessions'}
          title={showingHistory ? 'Show active chat' : 'Show past sessions'}
        >
          <HistoryIcon
            size={20}
            color={showingHistory ? 'var(--color-blue-dark)' : 'var(--color-on-surface-variant)'}
          />
        </button>
      )}
      {onExportTrace && (
        <button
          type="button"
          className="toolbar__export-btn"
          onClick={onExportTrace}
          disabled={!canExport}
          aria-label="Export trace"
          title="Export trace"
        >
          <DownloadIcon size={20} color="var(--color-on-surface-variant)" />
        </button>
      )}
      <ButtonUI
        variant={actionVariant}
        onClick={onActionClick}
      />
    </div>
  );
}
