import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/release/local-release-command.mjs')).href;
const releaseContractsScriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/check-video-cut-release-contracts.mjs')).href;

async function loadReleaseModule() {
  return import(scriptUrl) as Promise<{
    createReleaseCommandReport: (options: {
      action: string;
      projectRoot?: string;
      releaseAssetsDir?: string;
      reportDir?: string;
      smokeReportPath?: string;
      target: string;
    }) => Record<string, any>;
    parseReleaseArgs: (argv: string[]) => Record<string, any>;
  }>;
}

async function loadReleaseContractsModule() {
  return import(releaseContractsScriptUrl) as Promise<{
    createReleaseContractsReport: (options?: {
      projectRoot?: string;
      releaseAssetsDir?: string;
      reportDir?: string;
    }) => Record<string, any>;
  }>;
}

function writeBaseReleaseProject(projectRoot: string) {
  for (const dir of ['deploy', 'host/src', 'artifacts/governance', 'artifacts/release/smoke']) {
    mkdirSync(resolve(projectRoot, dir), { recursive: true });
  }
  writeFileSync(
    resolve(projectRoot, 'package.json'),
    JSON.stringify({
      name: '@sdkwork/video-cut',
      version: '0.1.0',
      dependencies: { react: '^19.0.0' },
      devDependencies: {},
    }),
    'utf8',
  );
  writeFileSync(resolve(projectRoot, 'host/Cargo.toml'), '[package]\nname = "sdkwork-video-cut-host"\nversion = "0.1.0"\n', 'utf8');
  writeFileSync(resolve(projectRoot, 'host/src/main.rs'), 'fn main() {}\n', 'utf8');
  writeFileSync(resolve(projectRoot, 'deploy/runtime-profiles.yaml'), readFileSync('deploy/runtime-profiles.yaml', 'utf8'), 'utf8');
  writeStandardGovernanceReports(projectRoot);
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

function writeStandardGovernanceReports(projectRoot: string, reportDir = 'artifacts/governance') {
  mkdirSync(resolve(projectRoot, reportDir), { recursive: true });
  const reports = [
    ['cli-contracts-report.json', 'video-cut.cli-contracts-report.v1', 'check:cli-contracts'],
    ['database-contracts-report.json', 'video-cut.database-contracts-report.v1', 'check:database-contracts'],
    ['deployment-artifacts-report.json', 'video-cut.deployment-artifacts-report.v1', 'check:deployment-artifacts'],
    ['deployment-matrix-report.json', 'video-cut.deployment-matrix.v1', 'check:deployment-matrix'],
    ['openapi-contracts-report.json', 'video-cut.openapi-contracts-report.v1', 'check:contracts'],
    ['smoke-evidence-contracts-report.json', 'video-cut.smoke-evidence-contracts-report.v1', 'check:smoke-evidence'],
    ['feature-readiness-report.json', 'video-cut.feature-readiness-report.v1', 'check:feature-readiness'],
    ['governance-suite-report.json', 'video-cut.governance-suite.v1', 'check:governance'],
  ] as const;

  for (const [fileName, reportVersion, command] of reports) {
    const reportPath = `${reportDir}/${fileName}`;
    writeFileSync(
      resolve(projectRoot, reportPath),
      JSON.stringify(
        {
          reportVersion,
          command,
          status: 'pass',
          checkedAt: '2026-05-01T00:00:00.000Z',
          reportPath,
          summary: { pass: 1, warn: 0, fail: 0 },
          checks: [],
        },
        null,
        2,
      ),
      'utf8',
    );
  }
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

    expect(parseReleaseArgs(['package', 'container', '--', '--json'])).toEqual({
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      reportDir: 'artifacts/governance',
      target: 'container',
    });
    expect(parseReleaseArgs(['package', 'container', '--json'])).toEqual({
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      reportDir: 'artifacts/governance',
      target: 'container',
    });
    expect(parseReleaseArgs(['package', 'desktop', '--json'])).toEqual({
      action: 'package',
      json: true,
      releaseAssetsDir: 'artifacts/release',
      reportDir: 'artifacts/governance',
      target: 'desktop',
    });
    expect(
      parseReleaseArgs([
        'smoke',
        'server',
        '--release-assets-dir',
        'artifacts/release-smoke',
        '--report-dir',
        'artifacts/governance/release-smoke',
        '--smoke-report',
        'artifacts/release/smoke/server-smoke-report.json',
      ]),
    ).toEqual({
      action: 'smoke',
      json: false,
      releaseAssetsDir: 'artifacts/release-smoke',
      reportDir: 'artifacts/governance/release-smoke',
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
    const provenancePath = 'artifacts/release/provenance.json';
    const signaturePath = 'artifacts/release/release-signature.json';
    const actionReportPath = 'artifacts/release/container-package-report.json';
    const releaseNotesArtifactPath = 'release-notes.md';

    expect(report).toMatchObject({
      action: 'package',
      manifestPath,
      qualityGateReportPath: qualityPath,
      status: 'pass',
      target: 'container',
    });
    for (const path of [manifestPath, checksumsPath, notesPath, qualityPath, provenancePath, signaturePath, actionReportPath]) {
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
          path: 'artifacts/governance/cli-contracts-report.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'artifacts/governance/deployment-artifacts-report.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'artifacts/governance/openapi-contracts-report.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'artifacts/governance/smoke-evidence-contracts-report.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'artifacts/governance/governance-suite-report.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'sdkwork-video-cut-sbom.cdx.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: releaseNotesArtifactPath,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'provenance.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'release-signature.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain('deploy/docker/docker-compose.yml');
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain('sdkwork-video-cut-sbom.cdx.json');
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain(releaseNotesArtifactPath);
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain('provenance.json');
    expect(readFileSync(resolve(projectRoot, checksumsPath), 'utf8')).toContain('release-signature.json');
    const provenance = JSON.parse(readFileSync(resolve(projectRoot, provenancePath), 'utf8'));
    const subjectArtifacts = manifest.artifacts.filter((artifact: Record<string, unknown>) => {
      return artifact.path !== 'provenance.json' && artifact.path !== 'release-signature.json';
    });
    expect(provenance).toMatchObject({
      action: 'package',
      product: 'sdkwork-video-cut',
      provenanceVersion: 'video-cut.release-provenance.v1',
      releaseAssetsDir,
      status: 'pass',
      target: 'container',
      package: {
        name: '@sdkwork/video-cut',
        version: '0.1.0',
      },
      subject: {
        artifactCount: subjectArtifacts.length,
        artifactManifestSha256: createHash('sha256').update(JSON.stringify(subjectArtifacts)).digest('hex'),
        artifacts: subjectArtifacts,
      },
      standardArtifacts: {
        'governance-evidence-bundle.json': expect.objectContaining({
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        'release-notes.md': expect.objectContaining({
          path: releaseNotesArtifactPath,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        'quality-gate-execution-report.json': expect.objectContaining({
          path: qualityPath,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        'container-package-report.json': {
          path: actionReportPath,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          sizeBytes: expect.any(Number),
        },
      },
    });
    expect(provenance.standardArtifacts['container-package-report.json'].sizeBytes).toBeGreaterThan(0);
    expect(provenance.standardArtifacts['container-package-report.json']).not.toHaveProperty('pending');
    const signature = JSON.parse(readFileSync(resolve(projectRoot, signaturePath), 'utf8'));
    expect(signature).toMatchObject({
      action: 'package',
      product: 'sdkwork-video-cut',
      releaseAssetsDir,
      signatureKind: 'local-deterministic-digest',
      signatureVersion: 'video-cut.release-signature.v1',
      status: 'pass',
      target: 'container',
      payload: {
        algorithm: 'sha256',
        subjectManifestSha256: createHash('sha256')
          .update(JSON.stringify(manifest.artifacts.filter((artifact: Record<string, unknown>) => artifact.path !== 'release-signature.json')))
          .digest('hex'),
        signedFiles: expect.arrayContaining([
          expect.objectContaining({
            role: 'release-manifest-subject',
            path: manifestPath,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          expect.objectContaining({
            role: 'sha256sums-subject',
            path: checksumsPath,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          expect.objectContaining({
            role: 'provenance',
            path: provenancePath,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          expect.objectContaining({
            role: 'release-notes',
            path: notesPath,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          expect.objectContaining({
            role: 'action-report',
            path: actionReportPath,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]),
      },
      verification: {
        command: 'check:release-contracts',
        contract: 'release-signature-contract',
      },
    });
    expect(signature.signature).toMatch(/^[a-f0-9]{64}$/);
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
      provenancePath,
      qualityGateReportPath: qualityPath,
      signaturePath,
    });
    expect(JSON.parse(readFileSync(resolve(projectRoot, qualityPath), 'utf8'))).toMatchObject({
      gateVersion: 'video-cut.quality-gate-report.v1',
      status: 'pass',
      target: 'container',
    });
    expect(JSON.parse(readFileSync(resolve(projectRoot, qualityPath), 'utf8')).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'governance-evidence-cli-contracts',
          status: 'pass',
          evidence: 'artifacts/governance/cli-contracts-report.json',
        }),
        expect.objectContaining({
          id: 'governance-evidence-deployment-artifacts',
          status: 'pass',
          evidence: 'artifacts/governance/deployment-artifacts-report.json',
        }),
        expect.objectContaining({
          id: 'governance-evidence-openapi-contracts',
          status: 'pass',
          evidence: 'artifacts/governance/openapi-contracts-report.json',
        }),
        expect.objectContaining({
          id: 'governance-evidence-smoke-evidence-contracts',
          status: 'pass',
          evidence: 'artifacts/governance/smoke-evidence-contracts-report.json',
        }),
        expect.objectContaining({
          id: 'governance-evidence-governance-suite',
          status: 'pass',
          evidence: 'artifacts/governance/governance-suite-report.json',
        }),
      ]),
    );
  });

  it('fails release packaging when required governance evidence is missing', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-missing-governance-project-'));
    const releaseAssetsDir = 'artifacts/release';
    for (const dir of ['deploy/docker', 'host/src']) {
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

    const report = createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });
    const quality = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'quality-gate-execution-report.json'), 'utf8'));

    expect(report.status).toBe('fail');
    expect(quality.status).toBe('fail');
    expect(quality.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'governance-evidence-cli-contracts',
          status: 'fail',
          evidence: 'Required governance report is missing: artifacts/governance/cli-contracts-report.json.',
        }),
      ]),
    );
  });

  it('packages governance evidence from the requested report directory', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-custom-governance-project-'));
    const releaseAssetsDir = 'artifacts/release-matrix/container';
    const reportDir = 'artifacts/governance/release-matrix/container';
    writeReleaseTargetRequirements(projectRoot, 'container');
    writeStandardGovernanceReports(projectRoot, reportDir);

    const report = createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      reportDir,
      target: 'container',
    });
    const manifest = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'release-manifest.json'), 'utf8'));
    const bundle = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'governance-evidence-bundle.json'), 'utf8'));
    const quality = JSON.parse(readFileSync(resolve(projectRoot, releaseAssetsDir, 'quality-gate-execution-report.json'), 'utf8'));
    const contracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir,
    });

    expect(report.status).toBe('pass');
    expect(report.reportDir).toBe(reportDir);
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `${reportDir}/cli-contracts-report.json`,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: `${reportDir}/deployment-artifacts-report.json`,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: `${reportDir}/openapi-contracts-report.json`,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: `${reportDir}/smoke-evidence-contracts-report.json`,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: `${reportDir}/governance-suite-report.json`,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(quality.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'governance-evidence-cli-contracts',
          status: 'pass',
          evidence: `${reportDir}/cli-contracts-report.json`,
        }),
        expect.objectContaining({
          id: 'governance-evidence-deployment-artifacts',
          status: 'pass',
          evidence: `${reportDir}/deployment-artifacts-report.json`,
        }),
        expect.objectContaining({
          id: 'governance-evidence-openapi-contracts',
          status: 'pass',
          evidence: `${reportDir}/openapi-contracts-report.json`,
        }),
        expect.objectContaining({
          id: 'governance-evidence-smoke-evidence-contracts',
          status: 'pass',
          evidence: `${reportDir}/smoke-evidence-contracts-report.json`,
        }),
      ]),
    );
    expect(bundle.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cli-contracts',
          path: `${reportDir}/cli-contracts-report.json`,
          reportPath: `${reportDir}/cli-contracts-report.json`,
          status: 'pass',
        }),
        expect.objectContaining({
          id: 'deployment-artifacts',
          path: `${reportDir}/deployment-artifacts-report.json`,
          reportPath: `${reportDir}/deployment-artifacts-report.json`,
          status: 'pass',
        }),
        expect.objectContaining({
          id: 'openapi-contracts',
          path: `${reportDir}/openapi-contracts-report.json`,
          reportPath: `${reportDir}/openapi-contracts-report.json`,
          status: 'pass',
        }),
        expect.objectContaining({
          id: 'smoke-evidence-contracts',
          path: `${reportDir}/smoke-evidence-contracts-report.json`,
          reportPath: `${reportDir}/smoke-evidence-contracts-report.json`,
          status: 'pass',
        }),
      ]),
    );
    expect(existsSync(resolve(projectRoot, releaseAssetsDir, reportDir, 'cli-contracts-report.json'))).toBe(true);
    expect(existsSync(resolve(projectRoot, releaseAssetsDir, reportDir, 'deployment-artifacts-report.json'))).toBe(true);
    expect(existsSync(resolve(projectRoot, releaseAssetsDir, reportDir, 'openapi-contracts-report.json'))).toBe(true);
    expect(existsSync(resolve(projectRoot, releaseAssetsDir, reportDir, 'smoke-evidence-contracts-report.json'))).toBe(true);
    expect(contracts.status).toBe('pass');
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
      provenancePath: 'artifacts/release/provenance.json',
      qualityGateReportPath: 'artifacts/release/quality-gate-execution-report.json',
      releaseNotesPath: 'artifacts/release/release-notes.md',
      signaturePath: 'artifacts/release/release-signature.json',
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
    writeStandardGovernanceReports(projectRoot);

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
    writeStandardGovernanceReports(projectRoot);

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
    writeStandardGovernanceReports(projectRoot);
    const smokeReport = validManagedServerSmokeReport();
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
      target: 'server',
    });
    const manifest = JSON.parse(readFileSync(resolve(releaseDir, 'release-manifest.json'), 'utf8'));
    const quality = JSON.parse(readFileSync(resolve(releaseDir, 'quality-gate-execution-report.json'), 'utf8'));
    const checksums = readFileSync(resolve(releaseDir, 'SHA256SUMS.txt'), 'utf8');
    const smokeEvidenceBundle = JSON.parse(readFileSync(resolve(releaseDir, 'smoke-evidence-bundle.json'), 'utf8'));

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
        expect.objectContaining({
          path: 'smoke-evidence-bundle.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(checksums).toContain('smoke-evidence-bundle.json');
    expect(smokeEvidenceBundle).toMatchObject({
      action: 'smoke',
      bundleVersion: 'video-cut.smoke-evidence-bundle.v1',
      ok: true,
      product: 'sdkwork-video-cut',
      reportVersion: 'video-cut.managed-server-workflow-smoke.v1',
      smokeReportPath,
      status: 'pass',
      target: 'server',
      validation: {
        reason: '',
        status: 'pass',
      },
      evidence: {
        type: 'managed-server-private-workflow',
        runtime: {
          authMode: 'single-user-token',
        },
        managedChecks: {
          hostBuild: true,
          workflowSmoke: true,
        },
        workflow: {
          type: 'http-workflow-private-artifact-delivery',
          requiredChecks: {
            artifactContent: true,
            artifactRangeContent: true,
            artifactSecurityHeaders: true,
          },
          artifacts: {
            output: {
              downloadMode: 'host-content-endpoint',
              mp4Signature: true,
              rangeChecked: true,
              securityHeadersChecked: true,
            },
          },
        },
      },
      report: smokeReport,
    });
    expect(smokeEvidenceBundle.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(smokeEvidenceBundle.sizeBytes).toBeGreaterThan(0);
    expect(quality.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'server-smoke-report-evidence',
          status: 'pass',
        }),
      ]),
    );
  });

  it('release contracts require self-contained smoke evidence bundles for smoke packages', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-smoke-contracts-project-'));
    const releaseAssetsDir = 'artifacts/release';
    const smokeReportPath = 'artifacts/release/smoke/container-smoke-report.json';
    writeReleaseTargetRequirements(projectRoot, 'container');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(validHttpWorkflowSmokeReport('container-private'), null, 2),
      'utf8',
    );

    createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir,
      smokeReportPath,
      target: 'container',
    });

    const passingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(passingContracts.status).toBe('pass');
    expect(passingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-smoke-evidence-bundle-contract',
          status: 'pass',
        }),
        expect.objectContaining({
          id: 'release-signature-contract',
          status: 'pass',
        }),
      ]),
    );

    rmSync(resolve(projectRoot, releaseAssetsDir, 'smoke-evidence-bundle.json'));
    const failingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });

    expect(failingContracts.status).toBe('fail');
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-smoke-evidence-bundle-contract',
          status: 'fail',
          evidence: expect.stringContaining('smoke-evidence-bundle.json'),
        }),
      ]),
    );
  });

  it('release contracts require self-contained release provenance for all packages', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-provenance-contracts-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const passingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(passingContracts.status).toBe('pass');
    expect(passingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-provenance-contract',
          status: 'pass',
        }),
        expect.objectContaining({
          id: 'release-signature-contract',
          status: 'pass',
        }),
      ]),
    );

    rmSync(resolve(projectRoot, releaseAssetsDir, 'provenance.json'));
    const failingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });

    expect(failingContracts.status).toBe('fail');
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-provenance-contract',
          status: 'fail',
          evidence: expect.stringContaining('provenance.json'),
        }),
      ]),
    );
  });

  it('cleans stale single-target release reports before writing a new default release package', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-clean-default-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');
    mkdirSync(resolve(projectRoot, 'docs/openapi'), { recursive: true });
    writeFileSync(resolve(projectRoot, 'docs/openapi/video-cut-v1.yaml'), 'openapi: 3.1.0\n', 'utf8');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });
    expect(existsSync(resolve(projectRoot, releaseAssetsDir, 'container-package-report.json'))).toBe(true);

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'server',
    });

    expect(existsSync(resolve(projectRoot, releaseAssetsDir, 'container-package-report.json'))).toBe(false);
    expect(existsSync(resolve(projectRoot, releaseAssetsDir, 'server-package-report.json'))).toBe(true);
    const contracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(contracts.status).toBe('pass');
    expect(contracts.action).toBe('package');
    expect(contracts.target).toBe('server');
  });

  it('release contracts reject unsealed root files in a package release directory', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-root-sealed-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const passingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(passingContracts.status).toBe('pass');

    writeFileSync(
      resolve(projectRoot, releaseAssetsDir, 'smoke-evidence-bundle.json'),
      JSON.stringify({ stale: true }, null, 2),
      'utf8',
    );
    writeFileSync(resolve(projectRoot, releaseAssetsDir, 'temporary-debug-note.txt'), 'unsealed root file\n', 'utf8');

    const failingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });

    expect(failingContracts.status).toBe('fail');
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-root-generated-files-sealed',
          status: 'fail',
          evidence: expect.stringContaining('smoke-evidence-bundle.json'),
        }),
      ]),
    );
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-root-generated-files-sealed',
          evidence: expect.stringContaining('temporary-debug-note.txt'),
        }),
      ]),
    );
  });

  it('release contracts reject unsealed nested files in a package release directory', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-file-set-sealed-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const passingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(passingContracts.status).toBe('pass');

    mkdirSync(resolve(projectRoot, releaseAssetsDir, 'smoke'), { recursive: true });
    writeFileSync(
      resolve(projectRoot, releaseAssetsDir, 'smoke/stale-smoke-report.json'),
      JSON.stringify({ stale: true }, null, 2),
      'utf8',
    );

    const failingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });

    expect(failingContracts.status).toBe('fail');
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-package-file-set-sealed',
          status: 'fail',
          evidence: expect.stringContaining('smoke/stale-smoke-report.json'),
        }),
      ]),
    );
  });

  it('release contracts reject release notes drift after packaging', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-notes-sealed-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const passingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(passingContracts.status).toBe('pass');

    writeFileSync(
      resolve(projectRoot, releaseAssetsDir, 'release-notes.md'),
      '# Tampered release notes\n\n- malicious: true\n',
      'utf8',
    );

    const failingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });

    expect(failingContracts.status).toBe('fail');
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manifest-artifact-integrity',
          status: 'fail',
          evidence: expect.stringContaining('release-notes.md'),
        }),
        expect.objectContaining({
          id: 'release-provenance-contract',
          status: 'fail',
          evidence: expect.stringContaining('release-notes.md'),
        }),
        expect.objectContaining({
          id: 'release-signature-contract',
          status: 'fail',
          evidence: expect.stringContaining('release-notes'),
        }),
      ]),
    );
  });

  it('cleans stale generated nested release reports before writing a new package', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-recursive-clean-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');
    mkdirSync(resolve(projectRoot, releaseAssetsDir, 'smoke'), { recursive: true });
    writeFileSync(resolve(projectRoot, releaseAssetsDir, 'smoke/stale-smoke-report.json'), '{}\n', 'utf8');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    expect(existsSync(resolve(projectRoot, releaseAssetsDir, 'smoke/stale-smoke-report.json'))).toBe(false);
    const contracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(contracts.status).toBe('pass');
    expect(contracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-package-file-set-sealed',
          status: 'pass',
        }),
      ]),
    );
  });

  it('release contracts require deterministic release signatures for all packages', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-signature-contracts-project-'));
    const releaseAssetsDir = 'artifacts/release';
    writeReleaseTargetRequirements(projectRoot, 'container');

    createReleaseCommandReport({
      action: 'package',
      projectRoot,
      releaseAssetsDir,
      target: 'container',
    });

    const passingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    expect(passingContracts.status).toBe('pass');
    expect(passingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-signature-contract',
          status: 'pass',
        }),
      ]),
    );

    rmSync(resolve(projectRoot, releaseAssetsDir, 'release-signature.json'));
    const failingContracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });

    expect(failingContracts.status).toBe('fail');
    expect(failingContracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-signature-contract',
          status: 'fail',
          evidence: expect.stringContaining('release-signature.json'),
        }),
      ]),
    );
  });

  it('validates release packages from packaged evidence snapshots after workspace evidence changes', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-snapshot-contracts-project-'));
    const releaseAssetsDir = 'artifacts/release';
    const smokeReportPath = 'artifacts/release/smoke/container-smoke-report.json';
    writeReleaseTargetRequirements(projectRoot, 'container');
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(validHttpWorkflowSmokeReport('container-private'), null, 2),
      'utf8',
    );

    createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir,
      smokeReportPath,
      target: 'container',
    });

    const packagedGovernanceSnapshot = JSON.parse(
      readFileSync(resolve(projectRoot, releaseAssetsDir, 'artifacts/governance/cli-contracts-report.json'), 'utf8'),
    );
    writeFileSync(
      resolve(projectRoot, 'artifacts/governance/cli-contracts-report.json'),
      JSON.stringify(
        {
          ...packagedGovernanceSnapshot,
          checkedAt: '2026-05-02T00:00:00.000Z',
          summary: { pass: 999, warn: 0, fail: 0 },
        },
        null,
        2,
      ),
      'utf8',
    );

    const contracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    const packagedGovernanceAfterWorkspaceDrift = JSON.parse(
      readFileSync(resolve(projectRoot, releaseAssetsDir, 'artifacts/governance/cli-contracts-report.json'), 'utf8'),
    );

    expect(contracts.status).toBe('pass');
    expect(contracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-provenance-contract',
          status: 'pass',
        }),
      ]),
    );
    expect(packagedGovernanceAfterWorkspaceDrift.summary.pass).toBe(packagedGovernanceSnapshot.summary.pass);
    expect(packagedGovernanceAfterWorkspaceDrift.summary.pass).not.toBe(999);
  });

  it('validates smoke packages from packaged smoke evidence snapshots after workspace smoke report changes', async () => {
    const { createReleaseCommandReport } = await loadReleaseModule();
    const { createReleaseContractsReport } = await loadReleaseContractsModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-smoke-snapshot-contracts-project-'));
    const releaseAssetsDir = 'artifacts/release';
    const smokeReportPath = 'artifacts/release/smoke/container-smoke-report.json';
    const smokeReport = validHttpWorkflowSmokeReport('container-private');
    writeReleaseTargetRequirements(projectRoot, 'container');
    writeFileSync(resolve(projectRoot, smokeReportPath), JSON.stringify(smokeReport, null, 2), 'utf8');

    createReleaseCommandReport({
      action: 'smoke',
      projectRoot,
      releaseAssetsDir,
      smokeReportPath,
      target: 'container',
    });

    const packagedSmokeSnapshot = JSON.parse(
      readFileSync(resolve(projectRoot, releaseAssetsDir, smokeReportPath), 'utf8'),
    );
    writeFileSync(
      resolve(projectRoot, smokeReportPath),
      JSON.stringify(
        {
          ...smokeReport,
          summary: { fail: 1, ok: 12, warn: 0 },
        },
        null,
        2,
      ),
      'utf8',
    );

    const contracts = createReleaseContractsReport({
      projectRoot,
      releaseAssetsDir,
      reportDir: 'artifacts/governance',
    });
    const packagedSmokeAfterWorkspaceDrift = JSON.parse(
      readFileSync(resolve(projectRoot, releaseAssetsDir, smokeReportPath), 'utf8'),
    );

    expect(contracts.status).toBe('pass');
    expect(contracts.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-smoke-evidence-bundle-contract',
          status: 'pass',
        }),
      ]),
    );
    expect(packagedSmokeAfterWorkspaceDrift.summary.fail).toBe(packagedSmokeSnapshot.summary.fail);
    expect(packagedSmokeAfterWorkspaceDrift.summary.fail).not.toBe(1);
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
    writeStandardGovernanceReports(projectRoot);
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
