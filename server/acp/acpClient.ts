/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Duplex } from 'node:stream';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import type {
  AcpInitializeParams,
  AcpInitializeResult,
  AcpNewSessionParams,
  AcpNewSessionResult,
  AcpPromptParams,
  AcpSessionUpdateNotification,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.ts';

export interface AcpClientOptions {
  command?: string;
  args?: string[];
  socketPath?: string;
  port?: number;
  host?: string;
  stream?: Duplex;
}

export class AcpClient extends EventEmitter {
  private options: AcpClientOptions;
  private childProcess?: ChildProcess;
  private stream?: Duplex;
  private nextId = 1;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
    }
  > = new Map();
  private buffer = '';
  private activeSessionId?: string;

  constructor(options: AcpClientOptions = {}) {
    super();
    this.options = options;
  }

  public get connected(): boolean {
    return Boolean(
      (this.childProcess && !this.childProcess.killed) ||
      (this.stream && !this.stream.destroyed)
    );
  }

  public async connect(): Promise<void> {
    if (this.options.stream) {
      this.stream = this.options.stream;
      this.setupStreamListeners();
      return;
    }

    if (this.options.socketPath) {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(this.options.socketPath!, () => {
          this.stream = socket;
          this.setupStreamListeners();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    }

    if (this.options.port) {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(
          { port: this.options.port!, host: this.options.host || '127.0.0.1' },
          () => {
            this.stream = socket;
            this.setupStreamListeners();
            resolve();
          }
        );
        socket.on('error', reject);
      });
      return;
    }

    if (this.options.command) {
      this.childProcess = spawn(this.options.command, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env },
      });

      const { stdin, stdout } = this.childProcess;
      if (!stdin || !stdout) {
        throw new Error('Failed to spawn ACP process with piped standard I/O');
      }

      stdout.on('data', (chunk: Buffer) => this.handleData(chunk.toString('utf-8')));
      this.childProcess.on('error', (err) => this.emit('error', err));
      this.childProcess.on('exit', (code, signal) => {
        this.emit('close', { code, signal });
      });

      return;
    }

    throw new Error('No valid transport configured for AcpClient (command, socketPath, port, or stream required)');
  }

  private setupStreamListeners(): void {
    if (!this.stream) return;
    this.stream.on('data', (chunk: Buffer) => this.handleData(chunk.toString('utf-8')));
    this.stream.on('error', (err) => this.emit('error', err));
    this.stream.on('close', () => {
      this.emit('close');
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        this.handleMessage(parsed);
      } catch {
        // Ignore unparseable lines or framing artifacts
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Check if it's a response to a pending request
    if ('id' in msg && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const response = msg as unknown as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`ACP Error (${response.error.code}): ${response.error.message}`));
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Check if it's an incoming server request (e.g. session/request_permission)
    if ('id' in msg && 'method' in msg && typeof msg.method === 'string') {
      const serverReq = msg as unknown as JsonRpcRequest;
      this.handleServerRequest(serverReq);
      return;
    }

    // Check if it's a notification
    if ('method' in msg && typeof msg.method === 'string') {
      const notification = msg as unknown as JsonRpcNotification;
      if (notification.method === 'session/update') {
        const updateParams = notification.params as AcpSessionUpdateNotification;
        this.emit('session/update', updateParams);
      }
      this.emit('notification', notification);
    }
  }

  private handleServerRequest(req: JsonRpcRequest): void {
    if (req.method === 'session/request_permission') {
      // Guardrail: Deny all host capability permission requests from the ACP agent
      const denialResponse: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          granted: false,
          reason: 'Host capabilities (filesystem/terminal) are disabled for WebMCP extension sessions.',
        },
      };
      this.sendRaw(denialResponse);
      return;
    }

    // Unknown method: method not found
    const errorResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: req.id,
      error: {
        code: -32601,
        message: `Method "${req.method}" not found or unsupported by client`,
      },
    };
    this.sendRaw(errorResponse);
  }

  private sendRaw(data: unknown): void {
    const json = JSON.stringify(data) + '\n';
    if (this.childProcess?.stdin && !this.childProcess.stdin.destroyed) {
      this.childProcess.stdin.write(json);
    } else if (this.stream && !this.stream.destroyed) {
      this.stream.write(json);
    } else {
      throw new Error('Cannot send ACP message: connection is closed');
    }
  }

  public async request<TResult = unknown, TParams = unknown>(
    method: string,
    params: TParams
  ): Promise<TResult> {
    const id = this.nextId++;
    const req: JsonRpcRequest<TParams> = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      try {
        this.sendRaw(req);
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async initialize(): Promise<AcpInitializeResult> {
    const params: AcpInitializeParams = {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        terminal: false,
      },
      clientInfo: {
        name: 'webmcp-companion-acp',
        version: '1.0.0',
      },
    };
    return this.request<AcpInitializeResult, AcpInitializeParams>('initialize', params);
  }

  public async newSession(params: AcpNewSessionParams): Promise<AcpNewSessionResult> {
    const res = await this.request<AcpNewSessionResult, AcpNewSessionParams>('session/new', params);
    this.activeSessionId = res.sessionId;
    return res;
  }

  public getSessionId(): string | undefined {
    return this.activeSessionId;
  }

  public async prompt(
    promptText: string,
    onUpdate?: (update: AcpSessionUpdateNotification['update']) => void,
    sessionId?: string
  ): Promise<unknown> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      throw new Error('No active session ID. Call newSession first.');
    }

    let updateListener: ((data: AcpSessionUpdateNotification) => void) | undefined;
    if (onUpdate) {
      updateListener = (notification: AcpSessionUpdateNotification) => {
        if (notification.sessionId === targetSessionId) {
          onUpdate(notification.update);
        }
      };
      this.on('session/update', updateListener);
    }

    try {
      const params: AcpPromptParams = {
        sessionId: targetSessionId,
        prompt: promptText,
      };
      return await this.request('session/prompt', params);
    } finally {
      if (updateListener) {
        this.removeListener('session/update', updateListener);
      }
    }
  }

  public close(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('AcpClient connection closed'));
    }
    this.pendingRequests.clear();

    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = undefined;
    }
    if (this.stream) {
      this.stream.destroy();
      this.stream = undefined;
    }
  }
}
