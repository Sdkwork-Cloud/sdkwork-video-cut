import type { VideoCutHostClient } from '../ports/videoCutHostClient';
import { createHttpHostClient } from './httpHostClient';
import {
  createBrowserHostStore,
  createMockHostClient,
  type VideoCutHostStore,
} from './mockHostClient';

export type VideoCutHostMode = 'mock' | 'http';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CreateVideoCutHostClientOptions {
  authToken?: string;
  mode?: VideoCutHostMode;
  httpBaseUrl?: string;
  fetchImpl?: FetchLike;
  store?: VideoCutHostStore;
}

function readEnv(key: string): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)[key];
}

export function createVideoCutHostClient(options: CreateVideoCutHostClientOptions = {}): VideoCutHostClient {
  const mode = options.mode ?? (readEnv('VITE_VIDEO_CUT_HOST_MODE') as VideoCutHostMode | undefined) ?? 'http';

  if (mode === 'http') {
    return createHttpHostClient({
      authToken: options.authToken ?? readEnv('VITE_VIDEO_CUT_SERVER_TOKEN'),
      baseUrl: options.httpBaseUrl ?? readEnv('VITE_VIDEO_CUT_HOST_BASE_URL') ?? '/api/video-cut/v1',
      fetchImpl: options.fetchImpl,
    });
  }

  return createMockHostClient(undefined, options.store ?? createBrowserHostStore());
}
