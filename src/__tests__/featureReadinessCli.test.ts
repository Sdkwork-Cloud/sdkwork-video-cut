import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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

describe('feature readiness CLI', () => {
  it('parses json output mode and optional registry/report directories', async () => {
    const { parseFeatureReadinessArgs } = await loadCliModule();

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
