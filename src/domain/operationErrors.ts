export interface OperationError {
  title: string;
  message: string;
  code?: string;
  endpoint?: string;
  status?: number;
  traceId?: string;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectValue(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  return (error as Record<string, unknown>)[key];
}

export function toOperationError(error: unknown, title: string): OperationError {
  return {
    title,
    code: valueAsString(objectValue(error, 'code')),
    endpoint: valueAsString(objectValue(error, 'endpoint')),
    message: error instanceof Error ? error.message : 'The operation failed before the host returned a standard message.',
    status: valueAsNumber(objectValue(error, 'status')),
    traceId: valueAsString(objectValue(error, 'traceId')),
  };
}
