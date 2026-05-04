import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/release/run-release-matrix.mjs')).href;

async function loadReleaseMatrixModule() {
  return import(scriptUrl) as Promise<{
    createReleaseMatrixReport: (options?: {
      projectRoot?: string;
      releaseAssetsDir?: string;
      reportDir?: string;
      releaseWithGovernanceImpl?: (options: Record<string, any>) => Promise<Record<string, any>>;
    }) => Promise<Record<string, any>>;
    parseReleaseMatrixArgs: (argv: string[]) => Record<string, any>;
  }>;
}

const MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes'] as const;

describe('release matrix command', () => {
  it('parses matrix packaging options with pnpm separators', async () => {
    const { parseReleaseMatrixArgs } = await loadReleaseMatrixModule();

    expect(
      parseReleaseMatrixArgs([
        '--',
        '--json',
        '--release-assets-dir',
        'artifacts/release-train',
        '--report-dir',
        'artifacts/governance/release-train',
      ]),
    ).toEqual({
      json: true,
      releaseAssetsDir: 'artifacts/release-train',
      reportDir: 'artifacts/governance/release-train',
    });
    expect(() => parseReleaseMatrixArgs(['--release-assets-dir', '../outside'])).toThrow(
      /project-relative/,
    );
  });

  it('packages every release target into isolated release assets directories and writes one matrix report', async () => {
    const { createReleaseMatrixReport } = await loadReleaseMatrixModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-matrix-project-'));
    const calls: Record<string, any>[] = [];

    const report = await createReleaseMatrixReport({
      projectRoot,
      releaseAssetsDir: 'artifacts/release-matrix',
      releaseWithGovernanceImpl: async (options) => {
        calls.push(options);
        writeStubReleasePackage(projectRoot, options.releaseAssetsDir, options.target);
        return stubReleaseWithGovernanceReport(options);
      },
    });

    expect(calls.map((call) => call.target)).toEqual(MATRIX_TARGETS);
    expect(calls.map((call) => call.releaseAssetsDir)).toEqual(
      MATRIX_TARGETS.map((target) => `artifacts/release-matrix/${target}`),
    );
    expect(calls.map((call) => call.reportDir)).toEqual(
      MATRIX_TARGETS.map((target) => `artifacts/governance/release-matrix/${target}`),
    );
    expect(report).toMatchObject({
      command: 'release:package:matrix',
      releaseAssetsDir: 'artifacts/release-matrix',
      reportPath: 'artifacts/governance/release-matrix-report.json',
      reportVersion: 'video-cut.release-matrix-report.v1',
      status: 'pass',
      targetSummary: {
        fail: 0,
        pass: MATRIX_TARGETS.length,
        total: MATRIX_TARGETS.length,
      },
    });
    expect(report.targets).toHaveLength(MATRIX_TARGETS.length);
    expect(report.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'container',
          status: 'pass',
          releaseAssetsDir: 'artifacts/release-matrix/container',
          manifest: expect.objectContaining({
            action: 'package',
            artifactCount: expect.any(Number),
            status: 'pass',
            target: 'container',
          }),
          releaseContracts: expect.objectContaining({
            status: 'pass',
            summary: { pass: 14, warn: 0, fail: 0 },
          }),
          signatureVerification: expect.objectContaining({
            command: 'verify:release-signature',
            reportPath: 'artifacts/governance/release-matrix/container/release-signature-verification-report.json',
            status: 'pass',
            summary: { pass: 3, warn: 0, fail: 0 },
          }),
          standardArtifacts: expect.objectContaining({
            manifest: expect.objectContaining({ path: 'artifacts/release-matrix/container/release-manifest.json' }),
            releaseSignature: expect.objectContaining({
              path: 'artifacts/release-matrix/container/release-signature.json',
            }),
            provenance: expect.objectContaining({ path: 'artifacts/release-matrix/container/provenance.json' }),
          }),
        }),
      ]),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-matrix-target-coverage',
          status: 'pass',
        }),
        expect.objectContaining({
          id: 'release-matrix-container-package-contract',
          status: 'pass',
        }),
      ]),
    );

    const writtenReport = JSON.parse(
      readFileSync(resolve(projectRoot, 'artifacts/governance/release-matrix-report.json'), 'utf8'),
    );
    expect(writtenReport.targets).toHaveLength(MATRIX_TARGETS.length);
    expect(existsSync(resolve(projectRoot, 'artifacts/release-matrix/web/release-signature.json'))).toBe(true);
  });

  it('fails the matrix when any target package or release contract fails', async () => {
    const { createReleaseMatrixReport } = await loadReleaseMatrixModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-matrix-fail-project-'));

    const report = await createReleaseMatrixReport({
      projectRoot,
      releaseAssetsDir: 'artifacts/release-matrix',
      releaseWithGovernanceImpl: async (options) => {
        writeStubReleasePackage(projectRoot, options.releaseAssetsDir, options.target);
        return stubReleaseWithGovernanceReport(options, {
          status: options.target === 'web' ? 'fail' : 'pass',
        });
      },
    });

    expect(report.status).toBe('fail');
    expect(report.targetSummary).toEqual({
      fail: 1,
      pass: MATRIX_TARGETS.length - 1,
      total: MATRIX_TARGETS.length,
      warn: 0,
    });
    expect(report.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'web',
          status: 'fail',
          releaseContracts: expect.objectContaining({
            status: 'fail',
          }),
          signatureVerification: expect.objectContaining({
            status: 'pass',
          }),
        }),
      ]),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'release-matrix-web-package-contract',
          status: 'fail',
          evidence: expect.stringContaining('release contracts'),
        }),
      ]),
    );
  });

  it('keeps writing the matrix report when a target packaging command throws', async () => {
    const { createReleaseMatrixReport } = await loadReleaseMatrixModule();
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-release-matrix-error-project-'));

    const report = await createReleaseMatrixReport({
      projectRoot,
      releaseAssetsDir: 'artifacts/release-matrix',
      releaseWithGovernanceImpl: async (options) => {
        if (options.target === 'server') {
          throw new Error('server release packaging exploded');
        }
        writeStubReleasePackage(projectRoot, options.releaseAssetsDir, options.target);
        return stubReleaseWithGovernanceReport(options);
      },
    });

    expect(report.status).toBe('fail');
    expect(report.targetSummary).toEqual({
      fail: 1,
      pass: MATRIX_TARGETS.length - 1,
      total: MATRIX_TARGETS.length,
      warn: 0,
    });
    expect(report.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'server',
          status: 'fail',
          releaseReport: expect.objectContaining({
            status: 'fail',
            error: {
              code: 'RELEASE_MATRIX_TARGET_FAILED',
              message: 'server release packaging exploded',
            },
          }),
        }),
      ]),
    );
    expect(JSON.parse(readFileSync(resolve(projectRoot, 'artifacts/governance/release-matrix-report.json'), 'utf8'))).toMatchObject({
      status: 'fail',
      targetSummary: {
        fail: 1,
        pass: MATRIX_TARGETS.length - 1,
      },
    });
  });
});

function stubReleaseWithGovernanceReport(options: Record<string, any>, overrides: { status?: string } = {}) {
  const status = overrides.status ?? 'pass';
  const releaseAssetsDir = options.releaseAssetsDir;
  const target = options.target;
  return {
    reportVersion: 'video-cut.release-with-governance.v1',
    action: 'package',
    actionReportPath: `${releaseAssetsDir}/${target}-package-report.json`,
    checksumsPath: `${releaseAssetsDir}/SHA256SUMS.txt`,
    manifestPath: `${releaseAssetsDir}/release-manifest.json`,
    provenancePath: `${releaseAssetsDir}/provenance.json`,
    qualityGateReportPath: `${releaseAssetsDir}/quality-gate-execution-report.json`,
    releaseAssetsDir,
    releaseNotesPath: `${releaseAssetsDir}/release-notes.md`,
    signaturePath: `${releaseAssetsDir}/release-signature.json`,
    status,
    summary: { pass: status === 'pass' ? 8 : 7, warn: 0, fail: status === 'pass' ? 0 : 1 },
    target,
    releaseContracts: {
      action: 'package',
      command: 'check:release-contracts',
      releaseAssetsDir,
      reportPath: `${options.reportDir}/release-contracts-report.json`,
      reportVersion: 'video-cut.release-contracts-report.v1',
      status,
      summary: { pass: status === 'pass' ? 14 : 13, warn: 0, fail: status === 'pass' ? 0 : 1 },
      target,
    },
    signatureVerification: {
      action: 'package',
      command: 'verify:release-signature',
      releaseAssetsDir,
      reportPath: `${options.reportDir}/release-signature-verification-report.json`,
      reportVersion: 'video-cut.release-signature-verification.v1',
      status: 'pass',
      summary: { pass: 3, warn: 0, fail: 0 },
      target,
    },
  };
}

function writeStubReleasePackage(projectRoot: string, releaseAssetsDir: string, target: string) {
  const releaseRoot = resolve(projectRoot, releaseAssetsDir);
  mkdirSync(releaseRoot, { recursive: true });
  const standardFiles: Record<string, unknown> = {
    'release-manifest.json': {
      manifestVersion: 'video-cut.release-manifest.v1',
      product: 'sdkwork-video-cut',
      action: 'package',
      target,
      status: 'pass',
      artifacts: [
        { path: 'governance-evidence-bundle.json', sha256: 'a'.repeat(64), sizeBytes: 2 },
        { path: 'sdkwork-video-cut-sbom.cdx.json', sha256: 'b'.repeat(64), sizeBytes: 2 },
        { path: 'provenance.json', sha256: 'c'.repeat(64), sizeBytes: 2 },
        { path: 'release-signature.json', sha256: 'd'.repeat(64), sizeBytes: 2 },
      ],
    },
    'quality-gate-execution-report.json': { status: 'pass' },
    'governance-evidence-bundle.json': { status: 'pass' },
    'provenance.json': { status: 'pass' },
    'release-signature.json': { status: 'pass' },
    'sdkwork-video-cut-sbom.cdx.json': { bomFormat: 'CycloneDX' },
    [`${target}-package-report.json`]: { status: 'pass' },
  };

  for (const [fileName, value] of Object.entries(standardFiles)) {
    writeFileSync(resolve(releaseRoot, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
  writeFileSync(resolve(releaseRoot, 'SHA256SUMS.txt'), `${'0'.repeat(64)}  release-manifest.json\n`, 'utf8');
  writeFileSync(resolve(releaseRoot, 'release-notes.md'), `# ${target} package\n`, 'utf8');
}
