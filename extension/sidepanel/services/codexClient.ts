/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CodexModelListResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../types/codex.js';

type NotificationHandler = (params: any) => void;
type ServerRequestHandler = (id: number | string, params: any) => Promise<any>;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

export class CodexClient {
  private socket: WebSocket | null = null;
  private nextRequestId = 1;
  private initialized = false;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private notificationHandlers = new Map<string, Set<NotificationHandler>>();
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();

  isConnected(): boolean {
    return (
      this.socket !== null &&
      this.socket.readyState === 1 && // WebSocket.OPEN
      this.initialized
    );
  }

  async connect(port: number): Promise<void> {
    this.disconnect();

    const url = `ws://127.0.0.1:${port}`;
    const ws = new WebSocket(url);
    this.socket = ws;

    await new Promise<void>((resolve, reject) => {
      let openHandled = false;

      const cleanupOpenListeners = () => {
        ws.onopen = null;
      };

      ws.onopen = async () => {
        openHandled = true;
        cleanupOpenListeners();
        this.attachSocketHandlers(ws);

        try {
          await this.sendRequest('initialize', {
            clientInfo: {
              name: 'webmcp-extension',
              version: '1.0.0',
            },
            capabilities: {
              experimentalApi: true,
            },
          });
          this.initialized = true;
          resolve();
        } catch (error) {
          this.disconnect();
          reject(error);
        }
      };

      ws.onerror = (_event: any) => {
        if (!openHandled) {
          cleanupOpenListeners();
          reject(new Error(`Failed to connect to Codex app-server on ${url}`));
        }
      };

      ws.onclose = (_event: any) => {
        if (!openHandled) {
          cleanupOpenListeners();
          reject(new Error(`WebSocket connection closed before opening on ${url}`));
        }
      };
    });
  }

  disconnect(): void {
    this.initialized = false;
    if (this.socket) {
      const ws = this.socket;
      this.socket = null;
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }
    this.rejectAllPending(new Error('WebSocket connection closed'));
  }

  sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.socket || this.socket.readyState !== 1) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }

    const id = this.nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.socket!.send(JSON.stringify(request));
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  onNotification(method: string, handler: NotificationHandler): () => void {
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.notificationHandlers.delete(method);
      }
    };
  }

  onServerRequest(method: string, handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.set(method, handler);
    return () => {
      if (this.serverRequestHandlers.get(method) === handler) {
        this.serverRequestHandlers.delete(method);
      }
    };
  }

  async listModels(): Promise<CodexModelListResponse> {
    return this.sendRequest<CodexModelListResponse>('model/list', {
      limit: 20,
      includeHidden: false,
    });
  }

  private attachSocketHandlers(ws: WebSocket): void {
    ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    ws.onerror = (_event: Event) => {
      this.rejectAllPending(new Error('WebSocket encountered an error'));
    };

    ws.onclose = (_event: CloseEvent) => {
      this.initialized = false;
      this.rejectAllPending(new Error('WebSocket connection closed'));
    };
  }

  private handleMessage(data: any): void {
    let payload: any;
    try {
      payload = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      // Ignore malformed JSON payloads
      return;
    }

    if (!payload || typeof payload !== 'object') {
      return;
    }

    // 1. Server request (has id and method)
    if (payload.id !== undefined && typeof payload.method === 'string') {
      this.handleServerRequest(payload as JsonRpcRequest);
      return;
    }

    // 2. Client request response (has id and result or error)
    if (payload.id !== undefined && (payload.result !== undefined || payload.error !== undefined)) {
      this.handleClientResponse(payload as JsonRpcResponse);
      return;
    }

    // 3. Notification (has method without id)
    if (typeof payload.method === 'string' && payload.id === undefined) {
      this.handleNotification(payload as JsonRpcNotification);
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.serverRequestHandlers.get(request.method);
    if (!handler) {
      this.sendErrorResponse(request.id, -32601, `Method not found: ${request.method}`);
      return;
    }

    try {
      const result = await handler(request.id, request.params);
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
      this.socket?.send(JSON.stringify(response));
    } catch (err: any) {
      this.sendErrorResponse(request.id, -32000, err?.message ?? 'Server request execution failed');
    }
  }

  private handleClientResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(response.error.message || `JSON-RPC error ${response.error.code}`)
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const handlers = this.notificationHandlers.get(notification.method);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        handler(notification.params);
      } catch {
        // Ignore handler error to protect other listeners
      }
    }
  }

  private sendErrorResponse(id: number | string, code: number, message: string): void {
    if (!this.socket || this.socket.readyState !== 1) {
      return;
    }
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    try {
      this.socket.send(JSON.stringify(response));
    } catch {
      // Ignore socket send failure
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
