import { describe, expect, it, vi } from 'vitest';

import { createVideoCutHostClient } from '../services/createVideoCutHostClient';
import { createMemoryHostStore } from '../services/mockHostClient';

describe('createVideoCutHostClient', () => {
  it('creates a mock client with an injected local store by default', async () => {
    const client = createVideoCutHostClient({
      mode: 'mock',
      store: createMemoryHostStore(),
    });

    const task = await client.createTask({
      title: 'mock task',
      type: 'single-speaker',
    });

    expect(task.status).toBe('draft');
    expect(await client.listTasks()).toContainEqual(expect.objectContaining({ title: 'mock task' }));
  });

  it('creates an http client when host mode is http', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: 'ok' } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    const client = createVideoCutHostClient({
      fetchImpl,
      httpBaseUrl: '/api/video-cut/v1',
      mode: 'http',
    });

    await expect(client.getHealth()).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/health', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
  });

  it('uses the canonical HTTP Host API when no runtime mode is configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: 'ok' } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    const client = createVideoCutHostClient({ fetchImpl });

    await expect(client.getHealth()).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/health', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
  });

  it('passes the configured server token into the http client adapter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: 'ok' } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    const client = createVideoCutHostClient({
      authToken: 'server-token',
      fetchImpl,
      httpBaseUrl: '/api/video-cut/v1',
      mode: 'http',
    });

    await expect(client.getHealth()).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/health', {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer server-token',
      },
      method: 'GET',
    });
  });

  it('uses runtime-injected host settings without requiring Vite build-time host configuration', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: 'ok' } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    window.__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__ = {
      authToken: 'runtime-config-token',
      hostBaseUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
      hostMode: 'http',
    };

    try {
      const client = createVideoCutHostClient({ fetchImpl });

      await expect(client.getHealth()).resolves.toEqual({ status: 'ok' });
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:18077/api/video-cut/v1/health', {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer runtime-config-token',
        },
        method: 'GET',
      });
    } finally {
      delete window.__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__;
    }
  });
});
