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

    expect(parseMatrixArgs(['--', '--json'])).toEqual({ json: true, reportDir: 'artifacts/governance' });
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
        'cli-contracts-script',
        'release-script-matrix',
        'runtime-profile-manifest',
        'docker-artifacts',
        'docker-private-host-exposure',
        'env-example-standard-prefix',
        'kubernetes-artifacts',
        'kubernetes-private-host-service',
      ]),
    );
    const releaseScripts = report.checks.find((check: Record<string, unknown>) => check.id === 'release-script-matrix');
    expect(releaseScripts?.evidence).toContain('release:smoke:preflight');
    const releaseArtifacts = report.checks.find(
      (check: Record<string, unknown>) => check.id === 'release-command-artifacts',
    );
    expect(releaseArtifacts?.evidence).toContain('scripts/release/check-release-smoke-preflight.mjs');
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
      'check:contracts': 'node scripts/check-video-cut-openapi-contracts.mjs',
      'check:deployment-artifacts': 'node scripts/check-video-cut-deployment-artifacts.mjs',
      'check:deployment-matrix': 'node scripts/check-video-cut-deployment-matrix.mjs',
      'check:cli-contracts': 'node scripts/check-video-cut-cli-contracts.mjs',
      'check:smoke-evidence': 'node scripts/check-video-cut-smoke-evidence-contracts.mjs',
      'verify:release-signature': 'node scripts/verify-video-cut-release-signature.mjs',
      'release:package:desktop': 'node scripts/release/run-release-with-governance.mjs package desktop',
      'release:package:container': 'node scripts/release/run-release-with-governance.mjs package container',
      'release:package:kubernetes': 'node scripts/release/run-release-with-governance.mjs package kubernetes',
      'release:package:matrix': 'node scripts/release/run-release-matrix.mjs',
      'release:smoke:preflight': 'node scripts/release/check-release-smoke-preflight.mjs',
      'release:smoke:matrix': 'node scripts/release/run-release-smoke-matrix.mjs',
      'release:package:server': 'node scripts/release/run-release-with-governance.mjs package server',
      'release:package:web': 'node scripts/release/run-release-with-governance.mjs package web',
      'release:smoke:desktop':
        'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local --report-path artifacts/release/smoke/desktop-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke desktop --smoke-report artifacts/release/smoke/desktop-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:container':
        'node scripts/run-video-cut-http-workflow-smoke.mjs container-release --deployment-mode container-private --report-path artifacts/release/smoke/container-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke container --smoke-report artifacts/release/smoke/container-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:kubernetes':
        'node scripts/run-video-cut-http-workflow-smoke.mjs kubernetes-release --deployment-mode kubernetes-private --report-path artifacts/release/smoke/kubernetes-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke kubernetes --smoke-report artifacts/release/smoke/kubernetes-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:server':
        'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private --report-path artifacts/release/smoke/server-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke server --smoke-report artifacts/release/smoke/server-smoke-report.json --release-assets-dir artifacts/release',
      'release:smoke:web':
        'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private --report-path artifacts/release/smoke/web-smoke-report.json && node scripts/release/run-release-with-governance.mjs smoke web --smoke-report artifacts/release/smoke/web-smoke-report.json --release-assets-dir artifacts/release',
    });
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadCliModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/check-video-cut-deployment-matrix.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
