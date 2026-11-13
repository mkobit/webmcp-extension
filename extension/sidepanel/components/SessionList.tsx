/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type SessionSummary, formatRelativeTime } from '../services/sessionHistoryStore.js';
import { EditSquareIcon, TrashIcon } from './Icons.js';

export interface SessionListProps {
  domain: string;
  sessions: SessionSummary[];
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onNewChat: () => void;
}

export function SessionList({
  domain,
  sessions,
  onSelectSession,
  onDeleteSession,
  onNewChat,
}: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list__header">
        <div className="session-list__header-info">
          <h2 className="session-list__title">Past sessions</h2>
          <span className="session-list__domain">{domain || 'This website'}</span>
        </div>
        <button
          type="button"
          className="session-list__new-btn"
          onClick={onNewChat}
          title="Start new chat"
          aria-label="Start new chat"
        >
          <EditSquareIcon size={18} color="#012c6f" />
          <span className="session-list__new-btn-text">New chat</span>
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="session-list--empty">
          <p className="session-list__empty-text">No past sessions for this site.</p>
          <button type="button" className="session-list__empty-action" onClick={onNewChat}>
            Start a new conversation
          </button>
        </div>
      ) : (
        <div className="session-list__cards" role="list" aria-label="Past conversations">
          {sessions.map((session) => {
            const timeFormatted = formatRelativeTime(session.updatedAt);
            const fullDate = new Date(session.updatedAt).toLocaleString();

            return (
              <div
                key={session.id}
                className="session-card"
                role="listitem"
                tabIndex={0}
                onClick={() => onSelectSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSession(session.id);
                  }
                }}
              >
                <div className="session-card__content">
                  <div className="session-card__title" title={session.title}>
                    {session.title}
                  </div>
                  <div className="session-card__meta">
                    <span className="session-card__time" title={fullDate}>
                      {timeFormatted}
                    </span>
                    <span className="session-card__dot" aria-hidden="true">
                      •
                    </span>
                    <span className="session-card__count">
                      {`${session.messageCount} ${session.messageCount === 1 ? 'msg' : 'msgs'}`}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="session-card__delete-btn"
                  aria-label={`Delete session ${session.title}`}
                  title="Delete session"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                >
                  <TrashIcon size={16} color="#5f6368" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
