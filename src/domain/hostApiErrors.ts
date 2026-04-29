export interface VideoCutHostApiErrorInput {
  status: number;
  code: string;
  message: string;
  traceId?: string;
  endpoint: string;
}

export class VideoCutHostApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;
  readonly endpoint: string;

  constructor({ status, code, message, traceId, endpoint }: VideoCutHostApiErrorInput) {
    super(message);
    this.name = 'VideoCutHostApiError';
    this.status = status;
    this.code = code;
    this.traceId = traceId;
    this.endpoint = endpoint;
  }
}
