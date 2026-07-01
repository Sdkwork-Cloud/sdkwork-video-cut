import { createAutoCutId, createAutoCutTimestamp } from './identity.service';

export type AutoCutDiagnosticLevel = 'warning' | 'error';

export interface AutoCutDiagnosticEntry {
  id: string;
  level: AutoCutDiagnosticLevel;
  source: string;
  message: string;
  errorMessage?: string;
  createdAt: string;
}

const diagnostics: AutoCutDiagnosticEntry[] = [];
const MAX_DIAGNOSTICS = 200;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return undefined;
}

export function reportAutoCutDiagnostic(
  level: AutoCutDiagnosticLevel,
  source: string,
  message: string,
  error?: unknown,
) {
  const errorMessage = getErrorMessage(error);
  const entry: AutoCutDiagnosticEntry = {
    id: createAutoCutId('diagnostic'),
    level,
    source,
    message,
    ...(errorMessage ? { errorMessage } : {}),
    createdAt: createAutoCutTimestamp(),
  };
  diagnostics.unshift(entry);
  writeAutoCutDiagnosticToConsole(entry, error);

  diagnostics.splice(MAX_DIAGNOSTICS);
}

function writeAutoCutDiagnosticToConsole(entry: AutoCutDiagnosticEntry, error?: unknown) {
  if (typeof console === 'undefined') {
    return;
  }

  const writer = entry.level === 'error' ? console.error : console.warn;
  if (typeof writer !== 'function') {
    return;
  }

  const payload = {
    id: entry.id,
    level: entry.level,
    source: entry.source,
    message: entry.message,
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
    createdAt: entry.createdAt,
  };
  const args: unknown[] = [`[AutoCut:${entry.source}] ${entry.message}`, payload];
  if (error !== undefined) {
    args.push(error);
  }

  try {
    writer(...args);
  } catch {
    // Diagnostics must never break the workflow that is reporting them.
  }
}

export function getAutoCutDiagnostics() {
  return [...diagnostics];
}

export function clearAutoCutDiagnostics() {
  diagnostics.length = 0;
}
