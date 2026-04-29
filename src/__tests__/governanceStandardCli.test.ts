import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

const governanceScriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/check-video-cut-governance-suite.mjs')).href;

async function loadGovernanceModule() {
  return import(governanceScriptUrl) as Promise<{
    createGovernanceReport: (options?: {
      category?: string;
      projectRoot?: string;
      reportDir?: string;
    }) => Record<string, any>;
    parseGovernanceArgs: (argv: string[]) => Record<string, any>;
  }>;
}

describe('governance standard CLI', () => {
  it('declares every governance command required by the architecture standard', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'check:architecture-standards': 'node scripts/check-video-cut-governance-suite.mjs architecture-standards',
      'check:runtime-boundaries': 'node scripts/check-video-cut-governance-suite.mjs runtime-boundaries',
      'check:security': 'node scripts/check-video-cut-governance-suite.mjs security',
      'check:license': 'node scripts/check-video-cut-governance-suite.mjs license',
      'check:release-flow': 'node scripts/check-video-cut-governance-suite.mjs release-flow',
      'check:media-pipeline':
        'cargo test --manifest-path host/Cargo.toml media -- --nocapture && vitest --run src/__tests__/mediaContracts.test.ts src/__tests__/resultsPage.test.tsx',
      'check:multi-mode': 'node scripts/check-video-cut-deployment-matrix.mjs',
      'check:adr': 'node scripts/check-video-cut-governance-suite.mjs adr',
      'check:slo': 'node scripts/check-video-cut-governance-suite.mjs slo',
      'check:migrations': 'node scripts/check-video-cut-database-contracts.mjs',
      'check:governance': 'node scripts/check-video-cut-governance-suite.mjs all',
    });
  });

  it('creates a standard governance report for architecture, boundary, security, release, ADR, and SLO checks', async () => {
    const { createGovernanceReport } = await loadGovernanceModule();
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-governance-suite-'));

    const report = createGovernanceReport({ reportDir });

    expect(report).toMatchObject({
      command: 'check:governance',
      reportVersion: 'video-cut.governance-suite.v1',
      status: 'pass',
      reportPath: resolve(reportDir, 'governance-suite-report.json'),
    });
    expect(report.summary.fail).toBe(0);
    expect(report.checks.map((check: Record<string, unknown>) => check.id)).toEqual(
      expect.arrayContaining([
        'architecture-map-present',
        'no-standalone-design-docs',
        'frontend-no-media-or-provider-direct-calls',
        'host-env-access-confined-to-runtime-adapters',
        'no-secret-defaults',
        'server-bind-requires-auth-test',
        'task-create-does-not-publish-fake-source',
        'analyze-requires-source-artifact',
        'sample-import-uses-upload-boundary',
        'source-media-type-guard',
        'asset-catalog-standard-contract',
        'render-asset-preferences-standard-contract',
        'task-event-recovery-hints-standard-contract',
        'diagnostics-support-bundle-consent-guard',
        'json-request-rejection-envelope-guard',
        'multipart-request-rejection-envelope-guard',
        'path-parameter-rejection-envelope-guard',
        'query-parameter-extraction-standard-guard',
        'http-host-client-error-normalization-guard',
        'http-host-client-success-envelope-guard',
        'runtime-cors-origin-allowlist-guard',
        'results-artifact-error-metadata-guard',
        'no-public-artifact-content-url-helper-guard',
        'task-plan-load-error-propagation-guard',
        'mock-host-client-standard-error-guard',
        'api-route-not-found-envelope-guard',
        'api-method-not-allowed-envelope-guard',
        'artifact-metadata-uses-content-hashes',
        'plan-update-refreshes-artifact-integrity',
        'plan-update-validates-split-plan-contract',
        'cyclonedx-sbom-generated',
        'release-command-writes-standard-files',
        'release-runtime-profile-registry-source-of-truth',
        'release-smoke-scripts-bind-report-evidence',
        'release-reports-use-project-relative-paths',
        'release-smoke-requires-private-artifact-delivery-proof',
        'adr-numbering-contiguous',
        'slo-standard-present',
      ]),
    );
    expect(existsSync(report.reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(report.reportPath, 'utf8'))).toMatchObject({
      reportVersion: 'video-cut.governance-suite.v1',
      status: 'pass',
    });
  });

  it('supports category-scoped checks and writes a CycloneDX SBOM for license governance', async () => {
    const { createGovernanceReport, parseGovernanceArgs } = await loadGovernanceModule();
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-license-'));

    expect(parseGovernanceArgs(['license', '--json', '--report-dir', reportDir])).toEqual({
      category: 'license',
      json: true,
      reportDir,
    });

    const report = createGovernanceReport({ category: 'license', reportDir });
    const sbomPath = resolve(reportDir, 'sdkwork-video-cut-sbom.cdx.json');

    expect(report.status).toBe('pass');
    expect(report.checks.map((check: Record<string, unknown>) => check.id)).toContain('cyclonedx-sbom-generated');
    expect(existsSync(sbomPath)).toBe(true);
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
  });

  it('serializes the default governance report path as a project-relative path', async () => {
    const { createGovernanceReport } = await loadGovernanceModule();

    const report = createGovernanceReport();

    expect(report.reportPath).toBe('artifacts/governance/governance-suite-report.json');
    expect(existsSync(resolve(process.cwd(), report.reportPath))).toBe(true);
  });
});

describe('product PRD API dependency surface', () => {
  it('lists every public OpenAPI path that the runnable local/server app exposes', () => {
    const prd = readFileSync(resolve(process.cwd(), 'docs/product/01-product-requirements-document.md'), 'utf8');
    const openApi = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/openapi/video-cut-v1.yaml'), 'utf8')) as Record<
      string,
      any
    >;
    const apiSection = prd.match(/## 9\. API 依赖[\s\S]*?## 10\. 状态模型/)?.[0] ?? '';
    const prdEndpointLines = new Set(
      apiSection
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^(GET|POST|PUT|DELETE|PATCH)\s+\/api\/video-cut\/v1/.test(line))
        .map((line) => line.replace(/\s+/g, ' ')),
    );

    const paths = openApi.paths as Record<string, Record<string, unknown>>;
    const missing = Object.entries(paths).flatMap(([path, operations]) => {
      return Object.keys(operations)
        .filter((method) => ['get', 'post', 'put', 'delete', 'patch'].includes(method))
        .map((method) => `${method.toUpperCase()} /api/video-cut/v1${path}`)
        .filter((endpoint) => !prdEndpointLines.has(endpoint));
    });

    expect(missing).toEqual([]);
  });
});
