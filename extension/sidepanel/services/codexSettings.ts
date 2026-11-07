/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type BackendMode = 'companion' | 'onDevice' | 'codex';

const DEFAULT_CODEX_PORT = 45123;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getCodexPort(): number {
  const storage = getStorage();
  const raw = storage?.getItem('codexPort');
  if (!raw) return DEFAULT_CODEX_PORT;
  const parsed = parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed >= MIN_PORT && parsed <= MAX_PORT) {
    return parsed;
  }
  return DEFAULT_CODEX_PORT;
}

export function setCodexPort(port: number): void {
  const parsed = Math.floor(port);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new Error(
      `Invalid port number: ${port}. Must be an integer between ${MIN_PORT} and ${MAX_PORT}.`
    );
  }
  const storage = getStorage();
  storage?.setItem('codexPort', String(parsed));
}

export function getCodexModel(): string {
  const storage = getStorage();
  return storage?.getItem('codexModel') ?? '';
}

export function setCodexModel(model: string): void {
  const storage = getStorage();
  storage?.setItem('codexModel', model);
}

export function getCodexReasoningEffort(): string {
  const storage = getStorage();
  return storage?.getItem('codexReasoningEffort') ?? '';
}

export function setCodexReasoningEffort(effort: string): void {
  const storage = getStorage();
  storage?.setItem('codexReasoningEffort', effort);
}

export function getBackendMode(): BackendMode {
  const storage = getStorage();
  const explicit = storage?.getItem('backendMode');
  if (explicit === 'companion' || explicit === 'onDevice' || explicit === 'codex') {
    return explicit;
  }
  // Fallback to legacy onDeviceModel boolean
  if (storage?.getItem('onDeviceModel') === 'true') {
    return 'onDevice';
  }
  return 'companion';
}

export function setBackendMode(mode: BackendMode): void {
  const storage = getStorage();
  storage?.setItem('backendMode', mode);
  storage?.setItem('onDeviceModel', mode === 'onDevice' ? 'true' : 'false');
}
