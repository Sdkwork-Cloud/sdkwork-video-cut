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
  diagnostics.unshift({
    id: createAutoCutId('diagnostic'),
    level,
    source,
    message,
    ...(errorMessage ? { errorMessage } : {}),
    createdAt: createAutoCutTimestamp(),
  });

  diagnostics.splice(MAX_DIAGNOSTICS);
}

export function getAutoCutDiagnostics() {
  return [...diagnostics];
}

export function clearAutoCutDiagnostics() {
  diagnostics.length = 0;
}
