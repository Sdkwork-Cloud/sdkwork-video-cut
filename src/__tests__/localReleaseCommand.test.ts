import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/release/local-release-command.mjs')).href;

async function loadReleaseModule() {
  return import(scriptUrl) as Promise<{
    createReleaseCommandReport: (options: {
      action: string;
      projectRoot?: string;
      releaseAssetsDir?: string;
      smokeReportPath?: string;
      target: string;
    }) => Record<string, any>;
    parseReleaseArgs: (argv: string[]) => Record<string, any>;
  }>;
}

function writeBaseReleaseProject(projectRoot: string) {
  for (const dir of ['deploy', 'host/src', 'artifacts/release/smoke']) {
    mkdirSync(resolve(projectRoot, dir), { recursive: true });
  }
  writeFileSync(
    resolve(projectRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/video-cut', version: '0.1.0', dependencies: {}, devDependencies: {} }),
    'utf8',
  );
  writeFileSync(resolve(projectRoot, 'host/Cargo.toml'), '[package]\nname = "sdkwork-video-cut-host"\nversion = "0.1.0"\n', 'utf8');
  writeFileSync(resolve(projectRoot, 'host/src/main.rs'), 'fn main() {}\n', 'utf8');
  writeFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), readFileSync('deploy/runtime-profiles.yaml', 'utf8'), 'utf8');
}

function writeReleaseTargetRequirements(projectRoot: string, target: 'container' | 'kubernetes' | 'server') {
  writeBaseReleaseProject(projectRoot);

  if (target === 'server') {
    mkdirSync(resolve(projectRoot, 'docs/openapi'), { recursive: true });
    writeFileSync(resolve(projectRoot, 'docs/openapi/video-cut-v1.yaml'), 'openapi: 3.1.0\n', 'utf8');
    return;
  }

  if (target === 'container') {
    mkdirSync(resolve(projectRoot, 'deploy/docker'), { recursive: true });
    writeFileSync(resolve(projectRoot, 'deploy/docker/Dockerfile'), 'FROM nginx:alpine\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/docker/docker-compose.yml'), 'services: {}\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/docker/nginx.conf'), 'events {}\n', 'utf8');
    return;
  }

  mkdirSync(resolve(projectRoot, 'deploy/kubernetes/templates'), { recursive: true });
  writeFileSync(resolve(projectRoot, 'deploy/kubernetes/Chart.yaml'), 'apiVersion: v2\nname: sdkwork-video-cut\nversion: 0.1.0\n', 'utf8');
  writeFileSync(resolve(projectRoot, 'deploy/kubernetes/values.yaml'), 'replicaCount: 1\n', 'utf8');
  writeFileSync(resolve(projectRoot, 'deploy/kubernetes/templates/deployment.yaml'), 'apiVersion: apps/v1\nkind: Deployment\n', 'utf8');
}

function validHttpWorkflowSmokeReport(deploymentMode = 'server-private') {
  return {
    artifacts: {
      log: {
        artifactId: 'task-smoke-log',
        downloadMode: 'host-content-endpoint',
        kind: 'log',
      },
      manifest: {
        artifactId: 'task-smoke-manifest',
        downloadMode: 'host-content-endpoint',
        kind: 'render-manifest',
      },
      output: {
        artifactId: 'task-smoke-output',
        bytesChecked: 4096,
        downloadMode: 'host-content-endpoint',
        kind: 'render',
        mp4Signature: true,
        rangeBytesChecked: 12,
        rangeChecked: true,
        securityHeadersChecked: true,
      },
    },
    checks: [
      'health',
      'taskCreate',
      'sourceUpload',
      'analysis',
      'planRoundtrip',
      'render',
      'artifactList',
      'artifactDownloadDescriptors',
      'artifactContent',
      'artifactRangeContent',
      'artifactSecurityHeaders',
      'events',
      'redaction',
    ].map((checkId) => ({ checkId, status: 'ok' })),
    deploymentMode,
    ok: true,
    profile: 'server-dev',
    reportVersion: 'video-cut.http-workflow-smoke.v1',
    source: {
      fileName: 'smoke-source.mp4',
      generated: true,
      sizeBytes: 2048,
    },
    summary: { fail: 0, ok: 11, warn: 0 },
    taskId: 'task-smoke',
  };
}

function validManagedServerSmokeReport() {
  return {
    checks: ['hostBuild', 'hostStart', 'hostHealth', 'workflowSmoke', 'processCleanup', 'redaction'].map((checkId) => ({
      checkId,
      status: 'ok',
    })),
    deploymentMode: 'server-private',
    hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1',
    ok: true,
    profile: 'server-dev',
    reportVersion: 'video-cut.managed-server-workflow-smoke.v1',
    runtime: {
      authMode: 'single-user-token',
      bindHost: '127.0.0.1',
      port: 6177,
      workspaceRoot: '<generated-workspace>',
    },
    summary: { fail: 0, ok: 6, warn: 0 },
    workflow: validHttpWorkflowSmokeReport('server-private'),
  };
}

function containsLocalAbsolutePath(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return (
    /"(?!https?:\/\/)[A-Za-z]:[\\/]/.test(serialized) ||
    /"\\\\[^\\]+\\[^\\]+/.test(serialized) ||
    /"\/(?:Users|home|tmp|var|private|mnt|opt|workspace|data|Volumes)\b/.test(serialized)
  );
}

describe('local release command', () => {
  it('parses package and smoke commands with json output', async () => {
    const { parseReleaseArgs } = await loadReleaseModule();

    expect(parseReleaseArgs(['package', 'container', '--json'])).toEqual({
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      target: 'container',
    });
    expect(parseReleaseArgs(['package', 'desktop', '--json'])).toEqual({
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      target: 'desktop',
    });
    expect(parseReleaseArgs(['smoke', 'server', '--release-assets-dir', 'artifacts/release-smoke', '--smoke-report', 'artifacts/release/smoke/server-smoke-report.json'])).toEqual({
      action: 'smoke',
      json: false,
      releaseAssetsDir: 'artifacts/release-smoke',
      smokeReportPath: 'artifacts/release/smoke/server-smoke-report.json',
      target: 'server',
    });
  });

  it('writes the standard release manifest, checksums, notes, quality report, and action report', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-project-'));
    const releaseAssetsDir = 'artifacts/release';
    const releaseDir = resolve(projectRoot, releaseAssetsDir);
    writeReleaseTargetRequirements(projectRoot, 'container');

    const report = createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const manifestPath = 'artifacts/release/release-manifest.json';
    const checksumsPath = 'artifacts/release/SHA256SUMS.txt';
    const notesPath = 'artifacts/release/release-notes.md';
    const qualityPath = 'artifacts/release/quality-gate-execution-report.json';
    const sbomPath = resolve(releaseDir, 'sdkwork-video-cut-sbom.cdx.json');
    const actionReportPath = 'artifacts/release/container-package-report.json';

    expect(report).toMatchObject({
      action: 'package',
      manifestPath,
      qualityGateReportPath: qualityPath,
      status: 'pass',
      target: 'container',
    });
    for (const path of [manifestPath, checksumsPath, notesPath, qualityPath, actionReportPath]) {
      expect(existsSync(resolve(projectRoot, path)), path).toBe(true);
    }
    expect(existsSync(sbomPath), sbomPath).toBe(true);

    const manifest = JSON.parse(readFileSync(resolve(projectRoot, manifestPath), 'utf8'));
    expect(manifest).toMatchObject({
      action: 'package',
      contractVersions: {
        api: 'openapi.video-cut.v1',
        schema: 'video-cut.schema-bundle.v1',
        provider: 'video-cut.provider-capability.schema.v1',
        runtimeProfile: 'video-cut.runtime-profile.v1',
      },
      manifestVersion: 'video-cut.release-manifest.v1',
      target: 'container',
    });
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'deploy/docker/docker-compose.yml',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'sdkwork-video-cut-sbom.cdx.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain('deploy/docker/docker-compose.yml');
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain('sdkwork-video-cut-sbom.cdx.json');
    expect(JSON.parse(readFileSync(sbomPath, 'utf8'))).toMatchObject({
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      metadata: {
        component: {
          name: '@sdkwork/video-cut',
          type: 'application',
        },
      },
    });
    expect(readFileSync(resolve(projectRoot, notesPath), 'utf8')).toContain('sdkwork-video-cut container package');
    expect(JSON.parse(readFileSync(resolve(projectRoot, actionReportPath), 'utf8'))).toMatchObject({
      actionReportPath,
      manifestPath,
      qualityGateReportPath: qualityPath,
    });
    expect(JSON.parse(readFileSync(resolve(projectRoot, qualityPath), 'utf8'))).toMatchObject({
      gateVersion: 'video-cut.quality-gate-report.v1',
      status: 'pass',
      target: 'container',
    });
  });

  it('does not write server-local absolute paths into release reports', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-no-local-path-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');

    const report = createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const actionReport = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'container-package-report.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'release-manifest.json'), 'utf8'));
    const quality = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'quality-gate-execution-report.json'), 'utf8'));

    expect(containsLocalAbsolutePath(report)).toBe(false);
    expect(containsLocalAbsolutePath(actionReport)).toBe(false);
    expect(containsLocalAbsolutePath(manifest)).toBe(false);
    expect(containsLocalAbsolutePath(quality)).toBe(false);
    expect(report).toMatchObject({
      actionReportPath: 'artifacts/release/container-package-report.json',
      checksumsPath: 'artifacts/release/SHA256SUMS.txt',
      manifestPath: 'artifacts/release/release-manifest.json',
      qualityGateReportPath: 'artifacts/release/quality-gate-execution-report.json',
      releaseNotesPath: 'artifacts/release/release-notes.md',
    });
  });

  it('packages desktop-local release evidence for standalone local deployment', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-desktop-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    for (const dir of ['deploy', 'host/src', 'dist']) {
      mkdirSync(resolve(projectRoot, dir), { recursive: true });
    }
    writeFileSync(
      resolve(projectRoot, 'package.json'),
      JSON.stringify({ name: '@sdkwork/video-cut', version: '0.1.0', dependencies: {}, devDependencies: {} }),
      'utf8',
    );
    writeFileSync(resolve(projectRoot, 'host/Cargo.toml'), '[package]\nname = "sdkwork-video-cut-host"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'host/src/main.rs'), 'fn main() {}\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'dist/index.html'), '<html></html>\n', 'utf8');
    writeFileSync(resolve(projectRoot, '.env.example'), 'SDKWORK_VIDEO_CUT_RUNTIME_MODE=desktop-local\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), readFileSync('deploy/runtime-profiles.yaml', 'utf8'), 'utf8');

    const report = createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      target: 'desktop',
    });

    const manifest = JSON.parse(readFileSync(resolve(releaseDir, 'release-manifest.json'), 'utf8'));

    expect(report).toMatchObject({
      action: 'package',
      status: 'pass',
      target: 'desktop',
    });
    expect(manifest).toMatchObject({
      target: 'desktop',
      runtimeProfile: {
        deploymentMode: 'desktop-local',
        profileId: 'video-cut.desktop-local.v1',
        releaseTarget: 'desktop',
      },
    });
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'host/Cargo.toml' }),
        expect.objectContaining({ path: 'package.json' }),
        expect.objectContaining({ path: 'dist/index.html' }),
        expect.objectContaining({ path: '.env.example' }),
        expect.objectContaining({ path: 'sdkwork-video-cut-sbom.cdx.json' }),
      ]),
    );
  });

  it('uses the runtime profile registry as the release manifest source of truth', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-profile-registry-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    for (const dir of ['deploy/docker', 'host']) {
      mkdirSync(resolve(projectRoot, dir), { recursive: true });
    }
    writeFileSync(
      resolve(projectRoot, 'package.json'),
      JSON.stringify({ name: '@sdkwork/video-cut', version: '0.1.0', dependencies: {}, devDependencies: {} }),
      'utf8',
    );
    writeFileSync(resolve(projectRoot, 'host/Cargo.toml'), '[package]\nname = "sdkwork-video-cut-host"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/docker/Dockerfile'), 'FROM nginx:alpine\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/docker/docker-compose.yml'), 'services: {}\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/docker/nginx.conf'), 'events {}\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), readFileSync('deploy/runtime-profiles.yaml', 'utf8'), 'utf8');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      target: 'container',
    });

    const registry = parse(readFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), 'utf8')) as {
      profiles: Array<Record<string, unknown>>;
    };
    const expectedProfile = registry.profiles.find((profile) => profile.releaseTarget === 'container');
    const manifest = JSON.parse(readFileSync(resolve(releaseDir, 'release-manifest.json'), 'utf8'));

    expect(manifest.runtimeProfile).toEqual(expectedProfile);
  });

  it('attaches validated smoke report evidence to release smoke artifacts', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-smoke-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    const smokeReportPath = 'artifacts/release/smoke/server-smoke-report.json';
    for (const dir of ['deploy', 'docs/openapi', 'host/src', 'artifacts/release/smoke']) {
      mkdirSync(resolve(projectRoot, dir), { recursive: true });
    }
    writeFileSync(
      resolve(projectRoot, 'package.json'),
      JSON.stringify({ name: '@sdkwork/video-cut', version: '0.1.0', dependencies: {}, devDependencies: {} }),
      'utf8',
    );
    writeFileSync(resolve(projectRoot, 'host/Cargo.toml'), '[package]\nname = "sdkwork-video-cut-host"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'host/src/main.rs'), 'fn main() {}\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'docs/openapi/video-cut-v1.yaml'), 'openapi: 3.1.0\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), readFileSync('deploy/runtime-profiles.yaml', 'utf8'), 'utf8');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(validManagedServerSmokeReport(), null, 2),
      'utf8',
    );

    const report = createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      smokeReportPath,
      target: 'server',
    });
    const manifest = JSON.parse(readFileSync(resolve(releaseDir, 'release-manifest.json'), 'utf8'));
    const quality = JSON.parse(readFileSync(resolve(releaseDir, 'quality-gate-execution-report.json'), 'utf8'));

    expect(report.status).toBe('pass');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'server-smoke-report-evidence',
          status: 'pass',
          evidence: smokeReportPath,
        }),
      ]),
    );
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: smokeReportPath,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(quality.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'server-smoke-report-evidence',
          status: 'pass',
        }),
      ]),
    );
  });

  it('rejects web smoke release evidence without authenticated artifact preview and download proof', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-web-smoke-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    const smokeReportPath = 'artifacts/release/smoke/web-smoke-report.json';
    for (const dir of ['deploy', 'dist', 'host', 'src', 'artifacts/release/smoke']) {
      mkdirSync(resolve(projectRoot, dir), { recursive: true });
    }
    writeFileSync(
      resolve(projectRoot, 'package.json'),
      JSON.stringify({ name: '@sdkwork/video-cut', version: '0.1.0', dependencies: {}, devDependencies: {} }),
      'utf8',
    );
    writeFileSync(resolve(projectRoot, 'host/Cargo.toml'), '[package]\nname = "sdkwork-video-cut-host"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'src/App.tsx'), 'export default function App() { return null; }\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'dist/index.html'), '<html></html>\n', 'utf8');
    writeFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), readFileSync('deploy/runtime-profiles.yaml', 'utf8'), 'utf8');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(
        {
          ok: true,
          reportVersion: 'video-cut.managed-ui-workflow-smoke.v1',
          summary: { fail: 0, ok: 8, warn: 0 },
          ui: {
            deliveryPackageVisible: true,
            manifestVisible: true,
            outputArtifactVisible: true,
            resultsPageVerified: true,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const report = createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      smokeReportPath,
      target: 'web',
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'web-smoke-report-evidence',
          status: 'fail',
          evidence: expect.stringContaining('artifactContentAuthorizationVerified'),
        }),
      ]),
    );
  });

  it('rejects server smoke release evidence without managed host and nested workflow proof', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-server-smoke-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    const smokeReportPath = 'artifacts/release/smoke/server-smoke-report.json';
    writeReleaseTargetRequirements(projectRoot, 'server');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(
        {
          ok: true,
          reportVersion: 'video-cut.managed-server-workflow-smoke.v1',
          summary: { fail: 0, ok: 6, warn: 0 },
          workflow: {
            ok: true,
            reportVersion: 'video-cut.http-workflow-smoke.v1',
            summary: { fail: 0, ok: 11, warn: 0 },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const report = createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      smokeReportPath,
      target: 'server',
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'server-smoke-report-evidence',
          status: 'fail',
          evidence: expect.stringContaining('hostBuild'),
        }),
      ]),
    );
  });

  it.each([
    ['container', 'container-private'],
    ['kubernetes', 'kubernetes-private'],
  ] as const)('rejects %s smoke release evidence without full HTTP workflow proof', async (target, deploymentMode) => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), `video-cut-release-${target}-smoke-project-`));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    const smokeReportPath = `artifacts/release/smoke/${target}-smoke-report.json`;
    writeReleaseTargetRequirements(projectRoot, target);
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(
        {
          deploymentMode,
          ok: true,
          reportVersion: 'video-cut.http-workflow-smoke.v1',
          summary: { fail: 0, ok: 3, warn: 0 },
          taskId: `${target}-task`,
          checks: [
            { checkId: 'health', status: 'ok' },
            { checkId: 'taskCreate', status: 'ok' },
            { checkId: 'redaction', status: 'ok' },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const report = createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      smokeReportPath,
      target,
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${target}-smoke-report-evidence`,
          status: 'fail',
          evidence: expect.stringContaining('sourceUpload'),
        }),
      ]),
    );
  });

  it('rejects HTTP workflow release evidence without artifact byte range proof', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-container-range-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    const smokeReportPath = 'artifacts/release/smoke/container-smoke-report.json';
    writeReleaseTargetRequirements(projectRoot, 'container');
    const smokeReport: any = validHttpWorkflowSmokeReport('container-private');
    delete smokeReport.artifacts.output.rangeChecked;
    delete smokeReport.artifacts.output.rangeBytesChecked;
    smokeReport.checks = smokeReport.checks.filter((check: { checkId: string }) => check.checkId !== 'artifactRangeContent');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(smokeReport, null, 2),
      'utf8',
    );

    const report = createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      smokeReportPath,
      target: 'container',
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'container-smoke-report-evidence',
          status: 'fail',
          evidence: expect.stringContaining('artifacts.output.rangeChecked'),
        }),
      ]),
    );
  });

  it('rejects HTTP workflow release evidence without private artifact security header proof', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-container-security-header-project-'));
    const releaseDir = resolve(projectRoot, 'artifacts/release');
    const smokeReportPath = 'artifacts/release/smoke/container-smoke-report.json';
    writeReleaseTargetRequirements(projectRoot, 'container');
    const smokeReport: any = validHttpWorkflowSmokeReport('container-private');
    delete smokeReport.artifacts.output.securityHeadersChecked;
    smokeReport.checks = smokeReport.checks.filter((check: { checkId: string }) => check.checkId !== 'artifactSecurityHeaders');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(smokeReport, null, 2),
      'utf8',
    );

    const report = createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir: 'artifacts/release',
      smokeReportPath,
      target: 'container',
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'container-smoke-report-evidence',
          status: 'fail',
          evidence: expect.stringContaining('artifacts.output.securityHeadersChecked'),
        }),
      ]),
    );
  });
});
