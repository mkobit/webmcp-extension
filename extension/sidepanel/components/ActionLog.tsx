/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useId } from 'react';
import { ArrowDownIcon, ArrowUpIcon, AtomLogo } from './Icons.js';
import { type ActivityEntry } from '../types/index.js';

export interface ActionLogProps {
  status: 'initiation' | 'running' | 'completed' | 'permission';
  statusText?: string;
  activityLogs?: ActivityEntry[];
  /** Keeps the log in the page, but out of sight and out of the accessibility tree. */
  hidden?: boolean;
}

/**
 * Format activity/tool name into human readable label
 */
export function formatLogLabel(name: string): string {
  if (!name) return 'Thinking...';
  const clean = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export interface ActionLogCardProps {
  entry: ActivityEntry;
  defaultExpanded?: boolean;
}

/**
 * Collapsible card for an individual tool execution step.
 */
export function ActionLogCard({ entry, defaultExpanded = false }: ActionLogCardProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const detailsId = useId();

  const renderStatusIcon = () => {
    if (entry.status === 'error' || entry.errorMessage) {
      return (
        <span className="action-log__item-error" aria-label="Failed">
          ✕
        </span>
      );
    }
    if (entry.status === 'success' || entry.done) {
      return (
        <span className="action-log__item-check" aria-label="Completed">
          ✓
        </span>
      );
    }
    return <span className="action-log__item-circle" aria-label="Running" />;
  };

  return (
    <div className={`action-log__card${isExpanded ? ' action-log__card--expanded' : ''}`}>
      <button
        type="button"
        className="action-log__card-header"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
      >
        <div className="action-log__card-header-left">
          <div className="action-log__item-icon">{renderStatusIcon()}</div>
          <span className="action-log__item-label">{formatLogLabel(entry.name)}</span>
        </div>
        <div className="action-log__card-header-right">
          {entry.durationMs !== undefined && (
            <span className="action-log__duration-badge">{`${entry.durationMs}ms`}</span>
          )}
          <span className="action-log__card-chevron" aria-hidden="true">
            {isExpanded ? <ArrowUpIcon size={14} /> : <ArrowDownIcon size={14} />}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div id={detailsId} className="action-log__card-details">
          {entry.frameOrigin && (
            <div className="action-log__card-field">
              <span className="action-log__card-field-name">Frame origin</span>
              <span className="action-log__card-field-value">{entry.frameOrigin}</span>
            </div>
          )}
          {entry.arguments && Object.keys(entry.arguments).length > 0 && (
            <div className="action-log__card-field">
              <span className="action-log__card-field-name">Parameters</span>
              <pre className="action-log__card-json">
                {JSON.stringify(entry.arguments, null, 2)}
              </pre>
            </div>
          )}
          {entry.rawResult !== undefined && (
            <div className="action-log__card-field">
              <span className="action-log__card-field-name">Result</span>
              <pre className="action-log__card-json">
                {typeof entry.rawResult === 'string'
                  ? entry.rawResult
                  : JSON.stringify(entry.rawResult, null, 2)}
              </pre>
            </div>
          )}
          {entry.errorMessage && (
            <div className="action-log__card-field action-log__card-field--error">
              <span className="action-log__card-field-name">Error</span>
              <span className="action-log__card-field-value">{entry.errorMessage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActionLog({
  status,
  statusText,
  activityLogs = [],
  hidden,
}: ActionLogProps) {
  const [isOpen, setIsOpen] = useState<boolean>(status !== 'completed');
  const contentId = useId();

  // Determine status label
  let headerLabel = statusText;
  if (!headerLabel) {
    if (status === 'initiation') {
      headerLabel = 'Just a sec...';
    } else if (status === 'running') {
      const activeEntry = activityLogs[0];
      headerLabel = activeEntry
        ? `${formatLogLabel(activeEntry.name)}...`
        : 'Thinking...';
    } else if (status === 'permission') {
      headerLabel = 'Waiting for permission';
    } else if (status === 'completed') {
      headerLabel = 'Show thinking';
    }
  }

  // Determine status icon on left of header
  const renderStatusIcon = () => {
    if (status === 'initiation' || status === 'running') {
      return <span className="action-log__dots" aria-hidden="true">• •</span>;
    }
    return <AtomLogo size={16} color="#0b57d0" />;
  };

  // Reverse activity logs for display so earliest step is top
  const displayLogs = useMemo(() => [...activityLogs].reverse(), [activityLogs]);

  return (
    <div className="action-log" hidden={hidden}>
      {/* Header Row */}
      <button
        type="button"
        className="action-log__header"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className="action-log__title-group">
          <div className="action-log__icon-wrapper">{renderStatusIcon()}</div>
          <span className="action-log__label">{headerLabel}</span>
        </div>
        <div className="action-log__chevron" aria-hidden="true">
          {isOpen ? <ArrowUpIcon size={16} /> : <ArrowDownIcon size={16} />}
        </div>
      </button>

      {/* Expanded Details */}
      {isOpen && (
        <div id={contentId} className="action-log__content">
          {/* Activity / Task Trajectory Logs */}
          <div className="action-log__items">
            {displayLogs.length > 0 ? (
              displayLogs.map((entry) => (
                <ActionLogCard key={entry.id} entry={entry} />
              ))
            ) : (
              <div className="action-log__item">
                <div className="action-log__item-icon">
                  {status === 'completed' ? (
                    <span className="action-log__item-check">✓</span>
                  ) : (
                    <span className="action-log__item-circle" />
                  )}
                </div>
                <span className="action-log__item-label">
                  {status === 'completed' ? 'Thinking process completed' : 'Thinking...'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
