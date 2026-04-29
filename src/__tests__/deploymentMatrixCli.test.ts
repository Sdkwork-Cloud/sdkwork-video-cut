import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/check-video-cut-deployment-matrix.mjs')).href;

async function loadCliModule() {
  return import(scriptUrl) as Promise<{
    createDeploymentMatrixReport: (options?: { projectRoot?: string; reportDir?: string }) => Record<string, any>;
    isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
    parseMatrixArgs: (argv: string[]) => Record<string, any>;
  }>;
}

describe('deployment matrix CLI', () => {
  it('parses json output mode', async () => {
    const { parseMatrixArgs } = await loadCliModule();

    expect(parseMatrixArgs(['--json'])).toEqual({ json: true, reportDir: 'artifacts/governance' });
  });

  it('creates a standard pass/fail report for deployment scripts and artifacts', async () => {
    const { createDeploymentMatrixReport } = await loadCliModule();

    const report = createDeploymentMatrixReport();

    expect(report).toMatchObject({
      command: 'check:deployment-matrix',
      reportVersion: 'video-cut.deployment-matrix.v1',
      status: 'pass',
    });
    expect(report.summary.fail).toBe(0);
    expect(report.reportPath).toBe('artifacts/governance/deployment-matrix-report.json');
    expect(existsSync(resolve(process.cwd(), report.reportPath))).toBe(true);
    expect(report.checks.map((check: Record<string, unknown>) => check.id)).toEqual(
      expect.arrayContaining([
        'canonical-api-route',
        'doctor-script-matrix',
        'http-workflow-smoke-script-matrix',
        'managed-server-smoke-script-matrix',
        'managed-ui-smoke-script-matrix',
        'release-script-matrix',
        'runtime-profile-manifest',
        'docker-artifacts',
        'docker-private-host-exposure',
        'env-example-standard-prefix',
        'kubernetes-artifacts',
        'kubernetes-private-host-service',
      ]),
    );
  });

  it('writes the governance report to the requested report directory', async () => {
    const { createDeploymentMatrixReport } = await loadCliModule();
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-governance-'));

    const report = createDeploymentMatrixReport({ reportDir });

    expect(report.reportPath).toBe(resolve(reportDir, 'deployment-matrix-report.json'));
    expect(existsSync(report.reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(report.reportPath, 'utf8'))).toMatchObject({
      command: 'check:deployment-matrix',
      reportVersion: 'video-cut.deployment-matrix.v1',
      status: 'pass',
    });
  });

  it('declares deployment matrix, release package, and release smoke package scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'check:deployment-matrix': 'node scripts/check-video-cut-deployment-matrix.mjs',
      'release:package:desktop': 'node scripts/release/local-release-command.mjs package desktop',
      'release:package:container': 'node scripts/release/local-release-command.mjs package container',
      'release:package:kubernetes': 'node scripts/release/local-release-command.mjs package kubernetes',
      'release:package:server': 'node scripts/release/local-release-command.mjs package server',
      'release:package:web': 'node scripts/release/local-release-command.mjs package web',
      'release:smoke:desktop':
        'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local --report-path artifacts/release/smoke/desktop-smoke-report.json && node scripts/release/local-release-command.mjs smoke desktop --smoke-report artifacts/release/smoke/desktop-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:container':
        'node scripts/run-video-cut-http-workflow-smoke.mjs container-release --deployment-mode container-private --report-path artifacts/release/smoke/container-smoke-report.json && node scripts/release/local-release-command.mjs smoke container --smoke-report artifacts/release/smoke/container-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:kubernetes':
        'node scripts/run-video-cut-http-workflow-smoke.mjs kubernetes-release --deployment-mode kubernetes-private --report-path artifacts/release/smoke/kubernetes-smoke-report.json && node scripts/release/local-release-command.mjs smoke kubernetes --smoke-report artifacts/release/smoke/kubernetes-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:server':
        'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private --report-path artifacts/release/smoke/server-smoke-report.json && node scripts/release/local-release-command.mjs smoke server --smoke-report artifacts/release/smoke/server-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:web':
        'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private --report-path artifacts/release/smoke/web-smoke-report.json && node scripts/release/local-release-command.mjs smoke web --smoke-report artifacts/release/smoke/web-smoke-report.json --release-assets-dir artifacts/release',
    });
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadCliModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/check-video-cut-deployment-matrix.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
