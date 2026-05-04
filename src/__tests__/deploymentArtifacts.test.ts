import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

function readText(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function readYaml(path: string): unknown {
  return YAML.parse(readText(path));
}

describe('deployment artifacts', () => {
  it('declares a Tauri desktop shell that delegates business work to the Host API', () => {
    const packageJson = JSON.parse(readText('package.json')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const tauriConfig = JSON.parse(readText('src-tauri/tauri.conf.json')) as {
      build: Record<string, string>;
      app: { windows: Array<Record<string, unknown>> };
    };
    const tauriCargo = readText('src-tauri/Cargo.toml');
    const tauriMain = readText('src-tauri/src/main.rs');
    const tauriDev = readText('scripts/run-video-cut-tauri-dev.mjs');
    const devStack = readText('scripts/run-video-cut-tauri-dev-stack.mjs');

    expect(existsSync(resolve(process.cwd(), 'src-tauri/icons/icon.ico'))).toBe(true);
    expect(packageJson.scripts['tauri:dev']).toBe('node scripts/run-video-cut-tauri-dev.mjs');
    expect(packageJson.scripts['tauri:before-dev']).toBe('node scripts/run-video-cut-tauri-dev-stack.mjs');
    expect(packageJson.devDependencies['@tauri-apps/cli']).toBeDefined();
    expect(tauriConfig.build.beforeDevCommand).toBe('pnpm tauri:before-dev');
    expect(tauriConfig.build.devUrl).toBe('http://127.0.0.1:5173');
    expect(tauriConfig.build.frontendDist).toBe('../dist');
    expect(JSON.stringify(tauriConfig)).toContain('icons/icon.ico');
    expect(tauriConfig.app.windows[0]).toMatchObject({
      label: 'main',
      title: 'SDKWork Video Cut',
    });
    expect(tauriCargo).toContain('name = "sdkwork-video-cut-desktop"');
    expect(tauriCargo).toContain('tauri = ');
    expect(tauriMain).toContain('tauri::Builder::default()');
    expect(tauriMain).not.toContain('ffmpeg');
    expect(tauriMain).not.toContain('/api/video-cut/v1');
    expect(tauriDev).toContain('--no-dev-server-wait');
    expect(tauriDev).toContain('beforeDevCommand');
    expect(devStack).toContain('SDKWORK_VIDEO_CUT_RUNTIME_MODE');
    expect(tauriDev).toContain('createBrowserChildProcessEnv');
    expect(devStack).toContain('createBrowserChildProcessEnv');
    expect(devStack).not.toContain('VITE_VIDEO_CUT_HOST_MODE');
    expect(devStack).not.toContain('VITE_VIDEO_CUT_HOST_BASE_URL');
    expect(devStack).toContain("'exec', 'vite'");
    expect(devStack).toContain('http://127.0.0.1:6177/api/video-cut/v1');
  });

  it('declares a web favicon so desktop and browser runtimes do not request missing default icons', () => {
    const indexHtml = readText('index.html');

    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(existsSync(resolve(process.cwd(), 'public/favicon.svg'))).toBe(true);
  });

  it('declares a multi-target Dockerfile for host and web runtime images', () => {
    const dockerfile = readText('deploy/docker/Dockerfile');

    expect(dockerfile).toContain('AS frontend-build');
    expect(dockerfile).toContain('AS host-build');
    expect(dockerfile).toContain('AS host-runtime');
    expect(dockerfile).toContain('AS web-runtime');
    expect(dockerfile).not.toContain('VITE_VIDEO_CUT_HOST_MODE');
    expect(dockerfile).not.toContain('VITE_VIDEO_CUT_HOST_BASE_URL');
    expect(dockerfile).toContain('SDKWORK_VIDEO_CUT_BIND_HOST=0.0.0.0');
    expect(dockerfile).toContain('SDKWORK_VIDEO_CUT_PORT=6177');
    expect(dockerfile).toContain('SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=/data/workspace');
  });

  it('declares docker compose services for server host and web proxy', () => {
    const compose = readYaml('deploy/docker/docker-compose.yml') as {
      services: Record<string, Record<string, unknown>>;
      volumes: Record<string, unknown>;
    };
    const hostService = compose.services['video-cut-host'];

    expect(compose.services).toHaveProperty('video-cut-host');
    expect(compose.services).toHaveProperty('video-cut-web');
    expect(compose.volumes).toHaveProperty('video-cut-workspace');
    expect(hostService).not.toHaveProperty('ports');
    expect(hostService.expose).toContain('6177');
    expect(JSON.stringify(compose)).toContain('/api/video-cut/v1/health');
    expect(JSON.stringify(compose)).toContain('container-private');
    expect(JSON.stringify(compose)).toContain('SDKWORK_VIDEO_CUT_AUTH_MODE');
    expect(JSON.stringify(compose)).toContain('SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE');
    expect(JSON.stringify(compose)).toContain('SDKWORK_VIDEO_CUT_STT_RESOURCE_ID');
    expect(JSON.stringify(compose)).toContain('reverse-proxy');
  });

  it('declares a helm-compatible kubernetes chart with config, secret, pvc, service, and deployment templates', () => {
    const requiredFiles = [
      'deploy/kubernetes/Chart.yaml',
      'deploy/kubernetes/values.yaml',
      'deploy/kubernetes/templates/configmap.yaml',
      'deploy/kubernetes/templates/deployment.yaml',
      'deploy/kubernetes/templates/hpa.yaml',
      'deploy/kubernetes/templates/ingress.yaml',
      'deploy/kubernetes/templates/pvc.yaml',
      'deploy/kubernetes/templates/secret.yaml',
      'deploy/kubernetes/templates/service.yaml',
    ];

    for (const file of requiredFiles) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(true);
    }

    const chart = readYaml('deploy/kubernetes/Chart.yaml') as { name: string };
    const valuesText = readText('deploy/kubernetes/values.yaml');
    const deploymentText = readText('deploy/kubernetes/templates/deployment.yaml');
    const serviceText = readText('deploy/kubernetes/templates/service.yaml');

    expect(chart.name).toBe('sdkwork-video-cut');
    expect(valuesText).toContain('deploymentMode: kubernetes-private');
    expect(valuesText).toContain('authMode: reverse-proxy');
    expect(valuesText).toContain('secretProvider: kubernetes-secret');
    expect(valuesText).toContain('speechToText:');
    expect(valuesText).toContain('providerProfile: openai-audio-transcriptions');
    expect(valuesText).toContain('resourceId: volc.bigasr.auc');
    expect(valuesText).not.toContain('hostPort:');
    expect(deploymentText).toContain('SDKWORK_VIDEO_CUT_BIND_HOST');
    expect(deploymentText).toContain('SDKWORK_VIDEO_CUT_PORT');
    expect(deploymentText).toContain('SDKWORK_VIDEO_CUT_WORKSPACE_ROOT');
    expect(deploymentText).toContain('SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE');
    expect(deploymentText).toContain('SDKWORK_VIDEO_CUT_STT_RESOURCE_ID');
    expect(deploymentText).toContain('/api/video-cut/v1/health');
    expect(serviceText).toContain('name: http');
    expect(serviceText).not.toContain('name: host');
    expect(serviceText).not.toContain('targetPort: host');
  });

  it('keeps the example environment on the canonical SDKWORK_VIDEO_CUT prefix', () => {
    const envExample = readText('.env.example');

    expect(envExample).toContain('SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=./workspace');
    expect(envExample).toContain('SDKWORK_VIDEO_CUT_RUNTIME_MODE=desktop-local');
    expect(envExample).toContain('SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE=openai-audio-transcriptions');
    expect(envExample).toContain('SDKWORK_VIDEO_CUT_STT_RESOURCE_ID=volc.bigasr.auc');
    expect(envExample).not.toMatch(/^VIDEO_CUT_WORKSPACE_ROOT=/m);
    expect(envExample).not.toMatch(/^VIDEO_CUT_HOST_BIND=/m);
  });

  it('declares machine-readable runtime profiles for every supported deployment mode', () => {
    const registry = readYaml('deploy/runtime-profiles.yaml') as {
      registryVersion: string;
      profiles: Array<Record<string, unknown>>;
    };
    const profiles = new Map(registry.profiles.map((profile) => [profile.deploymentMode, profile]));

    expect(registry.registryVersion).toBe('video-cut.runtime-profile-registry.v1');
    expect([...profiles.keys()]).toEqual(
      expect.arrayContaining([
        'desktop-local',
        'server-private',
        'web-private',
        'container-private',
        'kubernetes-private',
      ]),
    );
    expect(profiles.get('desktop-local')).toMatchObject({
      profileId: 'video-cut.desktop-local.v1',
      readinessLevel: 'prod-ready',
      apiContract: '/api/video-cut/v1',
      storageProvider: 'filesystem',
      secretProvider: 'local-secure-store',
    });
    expect(profiles.get('server-private')).toMatchObject({
      profileId: 'video-cut.server-private.v1',
      readinessLevel: 'prod-ready',
      authMode: 'single-user-token',
      secretProvider: 'env',
    });
    expect(profiles.get('container-private')).toMatchObject({
      readinessLevel: 'prod-ready',
      authMode: 'reverse-proxy',
      secretProvider: 'env',
    });
    expect(profiles.get('kubernetes-private')).toMatchObject({
      readinessLevel: 'smoke-ready',
      authMode: 'reverse-proxy',
      secretProvider: 'kubernetes-secret',
      replicaPolicy: 'single-replica-until-shared-db-and-object-storage',
    });
    for (const profile of registry.profiles) {
      expect(profile.requiredChecks).toEqual(expect.arrayContaining(['health', 'capability']));
      expect(profile.readinessLevel).not.toBe('scale-ready');
    }
  });
});
