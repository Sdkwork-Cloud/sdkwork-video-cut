import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/check-video-cut-feature-readiness.mjs')).href;

async function loadCliModule() {
  return import(scriptUrl) as Promise<{
    createFeatureReadinessReport: (options?: {
      projectRoot?: string;
      registryPath?: string;
      reportDir?: string;
    }) => Record<string, any>;
    isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
    parseFeatureReadinessArgs: (argv: string[]) => Record<string, any>;
  }>;
}

async function loadReportSafetyModule() {
  return import(pathToFileURL(resolve(process.cwd(), 'scripts/lib/report-safety.mjs')).href) as Promise<{
    findLocalAbsolutePath: (value: unknown) => string;
    isLocalAbsolutePath: (value: unknown) => boolean;
    reportContainsSensitiveData: (value: unknown) => boolean;
  }>;
}

describe('feature readiness CLI', () => {
  it('parses json output mode and optional registry/report directories', async () => {
    const { parseFeatureReadinessArgs } = await loadCliModule();

    expect(
      parseFeatureReadinessArgs(['--', '--json', '--registry', 'docs/product/feature-readiness.yaml', '--report-dir', 'tmp']),
    ).toEqual({
      json: true,
      registryPath: 'docs/product/feature-readiness.yaml',
      reportDir: 'tmp',
    });
    expect(parseFeatureReadinessArgs(['--json', '--registry', 'docs/product/feature-readiness.yaml', '--report-dir', 'tmp'])).toEqual({
      json: true,
      registryPath: 'docs/product/feature-readiness.yaml',
      reportDir: 'tmp',
    });
  });

  it('keeps a machine-readable feature registry with implemented and open-gap features', () => {
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, unknown>>;
      registryVersion: string;
    };

    expect(registry.registryVersion).toBe('video-cut.feature-readiness.v1');
    expect(registry.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-source-upload', status: 'implemented' }),
        expect.objectContaining({ id: 'real-ffmpeg-render', status: 'implemented' }),
        expect.objectContaining({ id: 'multi-segment-batch-render', status: 'implemented' }),
        expect.objectContaining({ id: 'srt-vtt-subtitle-import-export', status: 'implemented' }),
        expect.objectContaining({ id: 'real-vad-onnx-execution', status: 'implemented' }),
        expect.objectContaining({ id: 'full-nle-timeline', status: 'implemented' }),
        expect.objectContaining({ id: 'database-backed-multi-instance-queue', status: 'implemented' }),
      ]),
    );
  });

  it('documents release smoke preflight readiness evidence before real-environment smoke acceptance', () => {
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
      registryVersion: string;
    };
    const deploymentFeature = registry.features.find((feature) => feature.id === 'deployment-artifacts-and-governance');

    expect(deploymentFeature?.evidenceFiles).toEqual(
      expect.arrayContaining(['scripts/release/check-release-smoke-preflight.mjs']),
    );
    expect(deploymentFeature?.checks).toEqual(expect.arrayContaining(['pnpm release:smoke:preflight -- --json']));
    expect(deploymentFeature?.nextAction).toContain('video-cut.release-smoke-preflight-report.v1');
    expect(deploymentFeature?.nextAction).toContain('RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED');
  });

  it('creates a standard readiness report with no open feature gaps', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-feature-readiness-'));

    const report = createFeatureReadinessReport({ reportDir });

    expect(report).toMatchObject({
      command: 'check:feature-readiness',
      reportVersion: 'video-cut.feature-readiness-report.v1',
      status: 'pass',
    });
    expect(report.summary.implemented).toBeGreaterThan(5);
    expect(report.summary.gaps).toBe(0);
    expect(report.summary.planned).toBe(0);
    expect(report.openGaps).toEqual([]);
    expect(report.openGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'multi-segment-batch-render' })]),
    );
    expect(report.openGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'srt-vtt-subtitle-import-export' })]),
    );
    expect(report.openGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'real-vad-onnx-execution' })]),
    );
    expect(report.openGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'full-nle-timeline' })]),
    );
    expect(report.openGaps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'database-backed-multi-instance-queue' })]),
    );
    expect(report.reportPath).toBe(resolve(reportDir, 'feature-readiness-report.json'));
    expect(existsSync(report.reportPath)).toBe(true);
  });

  it('keeps the release-packaged readiness report free of credential-shaped values and local paths', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const { findLocalAbsolutePath, reportContainsSensitiveData } = await loadReportSafetyModule();

    const report = createFeatureReadinessReport({
      reportDir: 'artifacts/governance',
    });

    expect(reportContainsSensitiveData(report)).toBe(false);
    expect(findLocalAbsolutePath(report)).toBe('');
  });

  it('does not treat standard asset catalog URIs as local absolute paths', async () => {
    const { findLocalAbsolutePath, isLocalAbsolutePath } = await loadReportSafetyModule();

    expect(isLocalAbsolutePath('assets://bgm/licensed-bgm.wav')).toBe(false);
    expect(findLocalAbsolutePath({ path: 'assets://sfx/click.wav' })).toBe('');
    expect(findLocalAbsolutePath({ path: 'D:\\private\\workspace\\source.mp4' })).toBe('$.path');
  });

  it('fails MVP deployment readiness when mandatory release governance policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const deploymentFeature = registry.features.find((feature) => feature.id === 'deployment-artifacts-and-governance');
    expect(deploymentFeature).toBeTruthy();
    deploymentFeature!.checks = deploymentFeature!.checks.filter(
      (check: string) => check !== 'pnpm release:smoke:preflight -- --json',
    );
    deploymentFeature!.nextAction = deploymentFeature!.nextAction.replace('RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'deployment-artifacts-and-governance',
    );

    expect(report.status).toBe('fail');
    expect(report.summary.policyFailures).toBeGreaterThanOrEqual(2);
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'checks:pnpm release:smoke:preflight -- --json',
        'nextAction:RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
      ]),
    );
  });

  it('fails MVP runtime auth readiness when mandatory private runtime policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const runtimeFeature = registry.features.find((feature) => feature.id === 'runtime-config-and-private-auth');
    expect(runtimeFeature).toBeTruthy();
    runtimeFeature!.evidenceFiles = runtimeFeature!.evidenceFiles.filter(
      (file: string) => file !== 'host/tests/auth_test.rs',
    );
    runtimeFeature!.checks = runtimeFeature!.checks.filter(
      (check: string) => check !== 'cargo test --manifest-path host/Cargo.toml --test auth_test -- --nocapture',
    );
    runtimeFeature!.nextAction = runtimeFeature!.nextAction.replace('SDKWORK_VIDEO_CUT_SERVER_TOKEN', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-runtime-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'runtime-config-and-private-auth',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:host/tests/auth_test.rs',
        'checks:cargo test --manifest-path host/Cargo.toml --test auth_test -- --nocapture',
        'nextAction:SDKWORK_VIDEO_CUT_SERVER_TOKEN',
      ]),
    );
  });

  it('fails MVP canonical Host API readiness when mandatory API policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const canonicalFeature = registry.features.find((feature) => feature.id === 'canonical-host-api');
    expect(canonicalFeature).toBeTruthy();
    canonicalFeature!.evidenceFiles = canonicalFeature!.evidenceFiles.filter(
      (file: string) => file !== 'scripts/check-video-cut-openapi-contracts.mjs',
    );
    canonicalFeature!.checks = canonicalFeature!.checks.filter((check: string) => check !== 'pnpm check:contracts -- --json');
    canonicalFeature!.nextAction = canonicalFeature!.nextAction.replace('ROUTE_NOT_FOUND', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-canonical-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'canonical-host-api',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:scripts/check-video-cut-openapi-contracts.mjs',
        'checks:pnpm check:contracts -- --json',
        'nextAction:ROUTE_NOT_FOUND',
      ]),
    );
  });

  it('fails MVP settings readiness when mandatory provider settings policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const settingsFeature = registry.features.find((feature) => feature.id === 'settings-center-provider-config');
    expect(settingsFeature).toBeTruthy();
    settingsFeature!.evidenceFiles = settingsFeature!.evidenceFiles.filter(
      (file: string) => file !== 'src/domain/settingsSchema.ts',
    );
    settingsFeature!.checks = settingsFeature!.checks.filter(
      (check: string) => check !== 'pnpm workflow:smoke:ui:managed -- --json',
    );
    settingsFeature!.nextAction = settingsFeature!.nextAction.replace('write-only secret save path', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-settings-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'settings-center-provider-config',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:src/domain/settingsSchema.ts',
        'checks:pnpm workflow:smoke:ui:managed -- --json',
        'nextAction:write-only secret save path',
      ]),
    );
  });

  it('fails MVP speech provider bridge readiness when mandatory provider bridge policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const speechFeature = registry.features.find((feature) => feature.id === 'speech-provider-bridge-profiles');
    expect(speechFeature).toBeTruthy();
    speechFeature!.evidenceFiles = speechFeature!.evidenceFiles.filter(
      (file: string) => file !== 'host/src/speech_transcription.rs',
    );
    speechFeature!.checks = speechFeature!.checks.filter(
      (check: string) => check !== 'pnpm check:governance -- --json',
    );
    speechFeature!.nextAction = speechFeature!.nextAction.replace('stt.provider.bridge', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-speech-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'speech-provider-bridge-profiles',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:host/src/speech_transcription.rs',
        'checks:pnpm check:governance -- --json',
        'nextAction:stt.provider.bridge',
      ]),
    );
  });

  it('fails MVP local source upload readiness when mandatory workflow policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const uploadFeature = registry.features.find((feature) => feature.id === 'local-source-upload');
    expect(uploadFeature).toBeTruthy();
    uploadFeature!.evidenceFiles = uploadFeature!.evidenceFiles.filter(
      (file: string) => file !== 'scripts/check-video-cut-smoke-evidence-contracts.mjs',
    );
    uploadFeature!.checks = uploadFeature!.checks.filter(
      (check: string) => check !== 'pnpm workflow:smoke:server:private -- --json',
    );
    uploadFeature!.nextAction = uploadFeature!.nextAction.replace('SOURCE_FILE_REQUIRED', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-upload-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'local-source-upload',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:scripts/check-video-cut-smoke-evidence-contracts.mjs',
        'checks:pnpm workflow:smoke:server:private -- --json',
        'nextAction:SOURCE_FILE_REQUIRED',
      ]),
    );
  });

  it('fails MVP FFmpeg render readiness when mandatory render policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const renderFeature = registry.features.find((feature) => feature.id === 'real-ffmpeg-render');
    expect(renderFeature).toBeTruthy();
    renderFeature!.evidenceFiles = renderFeature!.evidenceFiles.filter(
      (file: string) => file !== 'host/src/media_render_manifest.rs',
    );
    renderFeature!.checks = renderFeature!.checks.filter(
      (check: string) => check !== 'pnpm check:smoke-evidence -- --json',
    );
    renderFeature!.nextAction = renderFeature!.nextAction.replace('video-cut.render-attempt.schema.v1', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-render-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'real-ffmpeg-render',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:host/src/media_render_manifest.rs',
        'checks:pnpm check:smoke-evidence -- --json',
        'nextAction:video-cut.render-attempt.schema.v1',
      ]),
    );
  });

  it('fails MVP media analysis readiness when mandatory pipeline policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const mediaFeature = registry.features.find((feature) => feature.id === 'media-analysis-pipeline');
    expect(mediaFeature).toBeTruthy();
    mediaFeature!.evidenceFiles = mediaFeature!.evidenceFiles.filter(
      (file: string) => file !== 'host/src/media_semantic.rs',
    );
    mediaFeature!.checks = mediaFeature!.checks.filter((check: string) => check !== 'pnpm check:contracts -- --json');
    mediaFeature!.nextAction = mediaFeature!.nextAction.replace('provider-unavailable', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-media-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'media-analysis-pipeline',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:host/src/media_semantic.rs',
        'checks:pnpm check:contracts -- --json',
        'nextAction:provider-unavailable',
      ]),
    );
  });

  it('fails MVP manual transcript readiness when mandatory subtitle fallback policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const manualFeature = registry.features.find((feature) => feature.id === 'manual-transcript-fallback');
    expect(manualFeature).toBeTruthy();
    manualFeature!.evidenceFiles = manualFeature!.evidenceFiles.filter(
      (file: string) => file !== 'host/src/media_subtitle_format.rs',
    );
    manualFeature!.checks = manualFeature!.checks.filter(
      (check: string) =>
        check !==
        'cargo test --manifest-path host/Cargo.toml --test host_contract_test put_manual_transcript_writes_standard_artifact_and_drives_subtitle_burn_in -- --nocapture',
    );
    manualFeature!.nextAction = manualFeature!.nextAction.replace('subtitle burn-in', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-manual-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'manual-transcript-fallback',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:host/src/media_subtitle_format.rs',
        'checks:cargo test --manifest-path host/Cargo.toml --test host_contract_test put_manual_transcript_writes_standard_artifact_and_drives_subtitle_burn_in -- --nocapture',
        'nextAction:subtitle burn-in',
      ]),
    );
  });

  it('fails MVP diagnostics readiness when mandatory privacy policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const diagnosticsFeature = registry.features.find((feature) => feature.id === 'diagnostics-and-redaction');
    expect(diagnosticsFeature).toBeTruthy();
    diagnosticsFeature!.evidenceFiles = diagnosticsFeature!.evidenceFiles.filter(
      (file: string) => file !== 'src/domain/diagnosticBundleExport.ts',
    );
    diagnosticsFeature!.checks = diagnosticsFeature!.checks.filter(
      (check: string) => check !== 'pnpm check:governance -- --json',
    );
    diagnosticsFeature!.nextAction = diagnosticsFeature!.nextAction.replace('explicit-consent', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-diagnostics-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'diagnostics-and-redaction',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:src/domain/diagnosticBundleExport.ts',
        'checks:pnpm check:governance -- --json',
        'nextAction:explicit-consent',
      ]),
    );
  });

  it('fails MVP operation recovery readiness when mandatory error policy tokens drift', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, any>>;
    };
    const operationFeature = registry.features.find((feature) => feature.id === 'operation-errors-and-recovery');
    expect(operationFeature).toBeTruthy();
    operationFeature!.evidenceFiles = operationFeature!.evidenceFiles.filter(
      (file: string) => file !== 'src/domain/taskRecovery.ts',
    );
    operationFeature!.checks = operationFeature!.checks.filter(
      (check: string) => check !== 'pnpm check:governance -- --json',
    );
    operationFeature!.nextAction = operationFeature!.nextAction.replace('task event recovery hints', '');

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'video-cut-operation-readiness-policy-'));
    const registryPath = resolve(tempRoot, 'feature-readiness.yaml');
    writeFileSync(registryPath, YAML.stringify(registry), 'utf8');

    const report = createFeatureReadinessReport({
      registryPath,
      reportDir: resolve(tempRoot, 'reports'),
    });
    const blockedFeature = report.blockingFailures.find(
      (feature: Record<string, unknown>) => feature.id === 'operation-errors-and-recovery',
    );

    expect(report.status).toBe('fail');
    expect(blockedFeature?.policyFailures).toEqual(
      expect.arrayContaining([
        'evidenceFiles:src/domain/taskRecovery.ts',
        'checks:pnpm check:governance -- --json',
        'nextAction:task event recovery hints',
      ]),
    );
  });

  it('serializes default readiness registry and report paths as project-relative paths', async () => {
    const { createFeatureReadinessReport } = await loadCliModule();

    const report = createFeatureReadinessReport();

    expect(report.registryPath).toBe('docs/product/feature-readiness.yaml');
    expect(report.reportPath).toBe('artifacts/governance/feature-readiness-report.json');
    expect(existsSync(resolve(process.cwd(), report.reportPath))).toBe(true);
  });

  it('declares a package script for quick feature readiness checks', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'check:feature-readiness': 'node scripts/check-video-cut-feature-readiness.mjs',
    });
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadCliModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/check-video-cut-feature-readiness.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
