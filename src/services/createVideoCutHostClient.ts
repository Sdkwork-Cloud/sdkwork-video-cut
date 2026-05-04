import type { VideoCutHostClient } from '../ports/videoCutHostClient';
import { createHttpHostClient } from './httpHostClient';
import {
  createBrowserHostStore,
  createMockHostClient,
  type VideoCutHostStore,
} from './mockHostClient';

export type VideoCutHostMode = 'mock' | 'http';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

declare global {
  interface Window {
    __SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__?: {
      authToken?: string;
      hostBaseUrl?: string;
      hostMode?: VideoCutHostMode;
    };
  }
}

export interface CreateVideoCutHostClientOptions {
  authToken?: string;
  mode?: VideoCutHostMode;
  httpBaseUrl?: string;
  fetchImpl?: FetchLike;
  store?: VideoCutHostStore;
}

function readRuntimeConfig(): NonNullable<Window['__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__']> {
  if (typeof window === 'undefined') {
    return {};
  }

  return window.__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__ ?? {};
}

export function createVideoCutHostClient(options: CreateVideoCutHostClientOptions = {}): VideoCutHostClient {
  const runtimeConfig = readRuntimeConfig();
  const mode = options.mode ?? runtimeConfig.hostMode ?? 'http';

  if (mode === 'http') {
    return createHttpHostClient({
      authToken: options.authToken ?? runtimeConfig.authToken,
      baseUrl: options.httpBaseUrl ?? runtimeConfig.hostBaseUrl ?? '/api/video-cut/v1',
      fetchImpl: options.fetchImpl,
    });
  }

  return createMockHostClient(undefined, options.store ?? createBrowserHostStore());
}
