/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatBubble } from './components/ChatBubble.js';
import { WebMCPToolsDialogue } from './components/WebMCPToolsDialogue.js';
import { IPHPopover } from './components/IPHPopover.js';
import { ConsentScreen } from './screens/ConsentScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import {
  getBackendMode,
  setBackendMode,
  getCodexPort,
  setCodexPort,
  getCodexModel,
  setCodexModel,
  getCodexReasoningEffort,
  setCodexReasoningEffort,
  type BackendMode,
} from './services/codexSettings.js';
import { getCodexClient } from './services/codexBackend.js';
import type { CodexModel } from './types/codex.js';
import { MarkdownText } from './components/MarkdownText.js';
import { ActionLog } from './components/ActionLog.js';
import { OnDeviceModelStatus } from './components/OnDeviceModelStatus.js';
import { ContextMeter } from './components/ContextMeter.js';
import { EditSquareIcon } from './components/Icons.js';
import { SessionList } from './components/SessionList.js';
import {
  listDomainSessions,
  deleteStoredSession,
  type SessionSummary,
} from './services/sessionHistoryStore.js';

import { useActiveTabId } from './hooks/useActiveTabId.js';
import { useActiveTabTools } from './hooks/useActiveTabTools.js';
import { useAgentSession } from './hooks/useAgentSession.js';
import { flushActiveSession, tabSessions } from './services/tabSessionStore.js';
import { exportSessionTrace } from './services/traceExport.js';
import { type ContextUsage, isPromptApiSupported, prepareOnDeviceModel } from './services/promptApiBackend.js';

/** Starts the on-device model download; a failure only means it starts later, with the first message. */
async function startOnDeviceModelDownload(): Promise<void> {
  try {
    await prepareOnDeviceModel();
  } catch (error) {
    console.warn('[WebMCP] Could not start downloading the on-device model:', error);
  }
}

export function App() {
  // Navigation & View State
  const [showConsent, setShowConsent] = useState(
    () => localStorage.getItem('agentConsent') !== 'true'
  );
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [sensitiveActionAlerts, setSensitiveActionAlerts] = useState<boolean>(() => {
    const saved = localStorage.getItem('sensitiveActionAlerts');
    return saved !== null ? saved === 'true' : true;
  });

  // Which provider and model the server uses is the server's own configuration.
  // All the panel decides is whether a turn goes there at all, or runs here in
  // the browser. A browser without the Prompt API has no choice to make.
  const onDeviceModelSupported = isPromptApiSupported();
  const [onDeviceModel, setOnDeviceModel] = useState<boolean>(() => {
    if (!onDeviceModelSupported) return false;
    try {
      return localStorage.getItem('onDeviceModel') === 'true';
    } catch {
      return false;
    }
  });

  const [backendMode, setBackendModeState] = useState<BackendMode>(() => getBackendMode());
  const [codexPort, setCodexPortState] = useState<number>(() => getCodexPort());
  const [codexModel, setCodexModelState] = useState<string>(() => getCodexModel());
  const [codexReasoningEffort, setCodexReasoningEffortState] = useState<string>(
    () => getCodexReasoningEffort()
  );
  const [availableModels, setAvailableModels] = useState<CodexModel[]>([]);
  const [isLoadingCodexModels, setIsLoadingCodexModels] = useState<boolean>(false);
  const [codexModelsError, setCodexModelsError] = useState<string | null>(null);

  const codexModelRef = useRef(codexModel);
  useEffect(() => {
    codexModelRef.current = codexModel;
  }, [codexModel]);

  const fetchCodexModels = useCallback(async () => {
    if (backendMode !== 'codex') return;
    setIsLoadingCodexModels(true);
    setCodexModelsError(null);
    const client = getCodexClient();
    try {
      if (!client.isConnected() || client.getPort() !== codexPort) {
        await client.connect(codexPort);
      }
      const res = await client.listModels();
      setAvailableModels(res.data);
      if (res.data.length > 0 && !codexModelRef.current) {
        const defaultModel = res.data.find((m) => m.isDefault) ?? res.data[0];
        setCodexModelState(defaultModel.id);
        setCodexModel(defaultModel.id);
      }
      setCodexModelsError(null);
    } catch (error) {
      console.warn('[WebMCP] Failed to load Codex models:', error);
      const msg = error instanceof Error ? error.message : String(error);
      setCodexModelsError(msg);
    } finally {
      setIsLoadingCodexModels(false);
    }
  }, [backendMode, codexPort]);

  useEffect(() => {
    void fetchCodexModels();
  }, [fetchCodexModels]);

  useEffect(() => {
    if (showSettings && backendMode === 'codex') {
      void fetchCodexModels();
    }
  }, [showSettings, backendMode, fetchCodexModels]);

  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);

  const [showToolsDialogue, setShowToolsDialogue] = useState<boolean>(false);
  const [showIPHPopover, setShowIPHPopover] = useState<boolean>(false);

  const handleToggleSensitiveActionAlerts = () => {
    setSensitiveActionAlerts((prev) => {
      const next = !prev;
      localStorage.setItem('sensitiveActionAlerts', String(next));
      return next;
    });
  };

  const [viewMode, setViewMode] = useState<'chat' | 'history'>('chat');
  const [domainSessions, setDomainSessions] = useState<SessionSummary[]>([]);
  const [hasDismissedHistory, setHasDismissedHistory] = useState<boolean>(false);

  const handleChangeBackendMode = (mode: BackendMode) => {
    if (anyBusy) return;
    setBackendMode(mode);
    setBackendModeState(mode);
    const isOnDevice = mode === 'onDevice';
    setOnDeviceModel(isOnDevice);
    if (isOnDevice) {
      void startOnDeviceModelDownload();
    }
  };

  const handleChangeCodexPort = (port: number) => {
    if (anyBusy) return;
    try {
      setCodexPort(port);
      setCodexPortState(port);
    } catch {}
  };

  const handleChangeCodexModel = (model: string) => {
    if (anyBusy) return;
    setCodexModel(model);
    setCodexModelState(model);
    const modelObj = availableModels.find((m) => m.id === model);
    if (modelObj?.defaultReasoningEffort) {
      setCodexReasoningEffort(modelObj.defaultReasoningEffort);
      setCodexReasoningEffortState(modelObj.defaultReasoningEffort);
    }
  };

  const handleChangeCodexReasoningEffort = (effort: string) => {
    if (anyBusy) return;
    setCodexReasoningEffort(effort);
    setCodexReasoningEffortState(effort);
  };

  // Custom Hooks
  // The panel is shared by every tab in the window, so it follows whichever
  // tab is in front and shows that tab's page and conversation.
  const activeTabId = useActiveTabId({ onDeviceModel });
  const { tools, domain, origin, favicon, statusMsg } = useActiveTabTools(activeTabId);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (activeTabId != null) {
        void flushActiveSession(activeTabId);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (activeTabId != null) {
        void flushActiveSession(activeTabId);
      }
    };
  }, [activeTabId]);
  const {
    userPrompt,
    setUserPrompt,
    messages,
    streamingText,
    busy,
    anyBusy,
    activityLog,
    pendingPermission,
    pendingCheckpoint,
    sessionTokenUsage,
    handleSendPrompt,
    handleStop,
    handleReset,
  } = useAgentSession(activeTabId, {
    sensitiveActionAlerts,
    onDeviceModel,
    backendMode,
    codexConfig: {
      port: codexPort,
      model: codexModel,
      effort: codexReasoningEffort,
    },
    origin,
  });
  // The agent is waiting on the user: to allow a tool, or to keep using tools.
  const waitingOnUser = Boolean(pendingPermission || pendingCheckpoint);

  const handleExportTrace = useCallback(() => {
    if (activeTabId != null) {
      const state = tabSessions.getState(activeTabId);
      exportSessionTrace({
        ...state,
        tools: state.tools.length > 0 ? state.tools : tools,
      });
    }
  }, [activeTabId, tools]);

  const handleToggleOnDeviceModel = () => {
    // Switching backends mid-response would pull the conversation out from
    // under the request in flight, in whichever tab is running it. The switch
    // is disabled then, too.
    if (anyBusy) return;
    const next = !onDeviceModel;
    try {
      localStorage.setItem('onDeviceModel', String(next));
    } catch {}
    setOnDeviceModel(next);
    // Choosing on-device is a click, which a model download needs, so the
    // download can start now rather than with the first message.
    if (next) {
      void startOnDeviceModelDownload();
    }
  };

  const chatStreamEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll chat to bottom on new messages
  useEffect(() => {
    const timer = setTimeout(() => {
      chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, busy, streamingText]);

  const fetchDomainSessions = useCallback(async () => {
    if (!domain || domain === 'New Tab') {
      setDomainSessions([]);
      return;
    }
    const list = await listDomainSessions(domain);
    setDomainSessions(list);
  }, [domain]);

  useEffect(() => {
    setHasDismissedHistory(false);
    void fetchDomainSessions();
  }, [domain, fetchDomainSessions]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (activeTabId != null) {
        await tabSessions.resumeSession(activeTabId, sessionId);
        setViewMode('chat');
        setHasDismissedHistory(true);
      }
    },
    [activeTabId]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (domain) {
        await deleteStoredSession(domain, sessionId);
        await fetchDomainSessions();
        if (activeTabId != null) {
          const state = tabSessions.getState(activeTabId);
          if (state.currentSessionId === sessionId) {
            handleReset();
          }
        }
      }
    },
    [domain, activeTabId, fetchDomainSessions, handleReset]
  );

  const handleNewChat = useCallback(() => {
    handleReset();
    setViewMode('chat');
    setHasDismissedHistory(true);
    void fetchDomainSessions();
  }, [handleReset, fetchDomainSessions]);

  const handleToggleHistory = useCallback(() => {
    setViewMode((prev) => (prev === 'history' ? 'chat' : 'history'));
    void fetchDomainSessions();
  }, [fetchDomainSessions]);

  const handleSendPromptAndSwitch = useCallback(async () => {
    setViewMode('chat');
    setHasDismissedHistory(true);
    await handleSendPrompt();
    void fetchDomainSessions();
  }, [handleSendPrompt, fetchDomainSessions]);

  const isShowingHistory =
    viewMode === 'history' ||
    (messages.length === 0 && !busy && domainSessions.length > 0 && !hasDismissedHistory);

  // Derive dynamic welcome subtitle topic based on active domain
  const domainTopic = domain && domain !== 'New Tab' ? domain : 'your tasks';

  // Welcome Action Chips
  const welcomeActionChips =
    tools.length > 0 && domain
      ? tools.slice(0, 3).map((tool) => ({
          text: tool.description || tool.name,
        }))
      : [
          { text: 'Learn more about WebMCP tools' },
          { text: 'Make your website agent ready' },
          { text: 'Read about Lighthouse audit' },
        ];

  const handleBadgeClick = () => {
    if (showIPHPopover) {
      setShowIPHPopover(false);
      setShowToolsDialogue(true);
    } else if (showToolsDialogue) {
      setShowToolsDialogue(false);
    } else {
      setShowIPHPopover(true);
    }
  };

  const dismissConsent = () => {
    localStorage.setItem('agentConsent', 'true');
    setShowConsent(false);
  };

  return (
    <div className="agent-screen-shell">
      {/* Error / Status Notice */}
      {statusMsg && <div id="status">{statusMsg}</div>}

      {/* On-device model status, outside <main> so settings cannot unmount it mid-download */}
      {onDeviceModelSupported && <OnDeviceModelStatus onContextUsage={setContextUsage} />}

      <main>
        {showConsent ? (
          <ConsentScreen
            onGotIt={dismissConsent}
            onClose={dismissConsent}
          />
        ) : showSettings ? (
          <SettingsScreen
            sensitiveActionAlerts={sensitiveActionAlerts}
            onToggleSensitiveActionAlerts={handleToggleSensitiveActionAlerts}
            onDeviceModel={onDeviceModel}
            onToggleOnDeviceModel={handleToggleOnDeviceModel}
            onDeviceModelSupported={onDeviceModelSupported}
            responseInProgress={anyBusy}
            onClose={() => setShowSettings(false)}
            backendMode={backendMode}
            onChangeBackendMode={handleChangeBackendMode}
            codexPort={codexPort}
            onChangeCodexPort={handleChangeCodexPort}
            codexModel={codexModel}
            onChangeCodexModel={handleChangeCodexModel}
            codexReasoningEffort={codexReasoningEffort}
            onChangeCodexReasoningEffort={handleChangeCodexReasoningEffort}
            availableModels={availableModels}
            onRefreshModels={fetchCodexModels}
            isLoadingModels={isLoadingCodexModels}
            modelsError={codexModelsError}
          />
        ) : (
          <section className="view chat-view">
            {/* Chat Stream Area */}
            <div id="chatStream">
              {isShowingHistory ? (
                <SessionList
                  domain={domain}
                  sessions={domainSessions}
                  onSelectSession={handleSelectSession}
                  onDeleteSession={handleDeleteSession}
                  onNewChat={handleNewChat}
                />
              ) : (
                <>
                  {messages.length === 0 && (
                    <div id="welcomeCard" className="welcome-card">
                      <div className="welcome-card__header">
                        <h1 className="welcome-title">Hi there!</h1>
                      </div>
                      <p className="welcome-subtitle">
                        {tools.length > 0
                          ? `How can I help you with ${domainTopic}?`
                          : 'How can I help you?'}
                      </p>

                      <div className="action-chips">
                        {welcomeActionChips.map((chip) => (
                          <button
                            key={chip.text}
                            className="action-chip"
                            onClick={() => setUserPrompt(chip.text)}
                          >
                            <span>{chip.text}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Chat Messages Card */}
                  {messages.length > 0 && (
                    <div className="chat-card">
                      <div className="chat-card__header">
                        <div className="chat-card__header-metrics">
                          {onDeviceModel && contextUsage && <ContextMeter {...contextUsage} />}
                          {sessionTokenUsage && (
                            <div
                              className="session-tokens"
                              title={`Session tokens: ${sessionTokenUsage.totalTokens.toLocaleString()} (${sessionTokenUsage.promptTokens.toLocaleString()} prompt / ${sessionTokenUsage.completionTokens.toLocaleString()} completion)`}
                              aria-label={`Session tokens: ${sessionTokenUsage.totalTokens} tokens`}
                            >
                              <span className="session-tokens__count">
                                {sessionTokenUsage.totalTokens.toLocaleString()} tokens
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="chat-card__new-chat-btn"
                          onClick={handleNewChat}
                          title="Start new chat"
                          aria-label="Start new chat"
                        >
                          <EditSquareIcon size={20} color="#012c6f" />
                        </button>
                      </div>

                      <div className="chat-card__messages">
                    {/* Messages and Logs */}
                    {messages.map((msg) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={msg.id} className="user-bubble">
                            {msg.text}
                          </div>
                        );
                      }

                      if (msg.role === 'ai') {
                        return (
                          <React.Fragment key={msg.id}>
                            {/* Hidden, not removed, for on-device replies without tools: the Prompt API has no thinking to show yet. */}
                            <ActionLog
                              status="completed"
                              activityLogs={msg.activityLogs}
                              hidden={msg.onDevice && !msg.activityLogs?.length}
                            />
                            {msg.text && (
                              <div className="ai-response">
                                <MarkdownText content={msg.text} />
                              </div>
                            )}
                            {msg.tokenUsage && (
                              <div className="token-chip" aria-label="Token usage">
                                <span className="token-chip__text">
                                  {msg.tokenUsage.promptTokens.toLocaleString()} prompt / {msg.tokenUsage.completionTokens.toLocaleString()} completion tokens
                                </span>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      }

                      if (msg.role === 'error') {
                        return (
                          <div key={msg.id} className="msg error">
                            <div className="msg-body">{msg.text}</div>
                          </div>
                        );
                      }

                      return null;
                    })}

                    {/* Pending/Running Action Log */}
                    {busy && (
                      <ActionLog
                        status={
                          waitingOnUser
                            ? 'permission'
                            : activityLog.length === 0
                            ? 'initiation'
                            : 'running'
                        }
                        statusText={!waitingOnUser && streamingText ? 'Writing...' : undefined}
                        activityLogs={activityLog}
                      />
                    )}

                    {/* The reply as it is written. Not a live region: announcing every chunk would be noise, and the finished message is what gets read. */}
                    {busy && streamingText && (
                      <div className="ai-response">
                        <MarkdownText content={streamingText} streaming />
                      </div>
                    )}

                    <div ref={chatStreamEndRef} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Floating Composer */}
        <footer className="composer-footer">
          {/* Floating WebMCP Tools Dialogue Popover */}
          {showToolsDialogue && (
            <div className="floating-popover">
              <WebMCPToolsDialogue
                domain={domain || 'page'}
                toolsCount={tools.length}
                toolsList={tools.map((t) => t.description || t.name)}
                onClose={() => setShowToolsDialogue(false)}
              />
            </div>
          )}

          {/* Floating IPH Popover */}
          {showIPHPopover && (
            <div className="floating-popover">
              <IPHPopover
                onClose={() => setShowIPHPopover(false)}
                onViewActions={() => {
                  setShowIPHPopover(false);
                  setShowToolsDialogue(true);
                }}
                onGotIt={() => setShowIPHPopover(false)}
              />
            </div>
          )}

          <ChatBubble
            showTab={Boolean(domain && domain !== 'New Tab')}
            tabProps={{
              domain: domain || 'New Tab',
              faviconUrl: favicon,
              hasTools: tools.length > 0,
              toolsCountLabel: `${tools.length} tools`,
              onToggleExpand: handleBadgeClick,
            }}
            textProps={{
              value: userPrompt,
              placeholder: 'Ask Agent anything',
              onChange: (e) => setUserPrompt(e.target.value),
              onSubmit: handleSendPromptAndSwitch,
            }}
            toolbarProps={{
              actionVariant: busy ? 'stop' : userPrompt.trim() ? 'send' : 'live',
              onActionClick: busy ? handleStop : handleSendPromptAndSwitch,
              onSettingsClick: () => setShowSettings(true),
              onExportTrace: handleExportTrace,
              canExport: messages.length > 0,
              onToggleHistory: handleToggleHistory,
              showingHistory: isShowingHistory,
            }}
                permissionProps={
                  pendingPermission
                    ? {
                        toolName: pendingPermission.toolName,
                        toolDescription: pendingPermission.toolDescription,
                        origin: pendingPermission.origin,
                        consequential: pendingPermission.consequential,
                        onAllow: pendingPermission.allow,
                        onAlwaysAllow: pendingPermission.allowAlways,
                        onDeny: pendingPermission.deny,
                      }
                    : null
                }
                checkpointProps={
                  pendingCheckpoint
                    ? {
                        roundsUsed: pendingCheckpoint.roundsUsed,
                        maxRounds: pendingCheckpoint.maxRounds,
                        onAllow: pendingCheckpoint.allow,
                        onDeny: pendingCheckpoint.deny,
                      }
                    : null
                }
              />
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}
