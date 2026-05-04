import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/check-video-cut-database-contracts.mjs')).href;

async function loadCliModule() {
  return import(scriptUrl) as Promise<{
    createDatabaseContractsReport: (options?: {
      projectRoot?: string;
      reportDir?: string;
    }) => Record<string, any>;
    isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
    parseDatabaseContractsArgs: (argv: string[]) => Record<string, any>;
  }>;
}

describe('database contracts CLI', () => {
  it('parses json output mode and optional report directory', async () => {
    const { parseDatabaseContractsArgs } = await loadCliModule();

    expect(parseDatabaseContractsArgs(['--', '--json', '--report-dir', 'tmp/database'])).toEqual({
      json: true,
      reportDir: 'tmp/database',
    });
    expect(parseDatabaseContractsArgs(['--json', '--report-dir', 'tmp/database'])).toEqual({
      json: true,
      reportDir: 'tmp/database',
    });
  });

  it('declares database contracts artifacts for the multi-instance queue baseline', () => {
    const prefixRegistry = YAML.parse(
      readFileSync(resolve(process.cwd(), 'docs/database/prefix-registry.yaml'), 'utf8'),
    ) as Record<string, any>;
    const requiredTables = [
      'ops_database_contract',
      'ops_task',
      'ops_stage_run',
      'ops_task_event',
      'ops_worker_lease',
      'media_artifact',
    ];

    expect(prefixRegistry.registryVersion).toBe('video-cut.database-prefix-registry.v1');
    expect(prefixRegistry.allowedPrefixes.map((item: Record<string, unknown>) => item.prefix)).toEqual(
      expect.arrayContaining(['studio', 'media', 'ops', 'ai', 'integration', 'iam']),
    );

    for (const tableName of requiredTables) {
      const contract = YAML.parse(
        readFileSync(resolve(process.cwd(), `docs/database/schema-registry/${tableName}.yaml`), 'utf8'),
      ) as Record<string, any>;

      expect(contract).toMatchObject({
        tableName,
        complianceLevel: 'L2',
        contractVersion: '1.0.0',
      });
      expect(contract.columns.map((column: Record<string, unknown>) => column.name)).toEqual(
        expect.arrayContaining(['id', 'uuid', 'created_at', 'updated_at', 'version']),
      );
      expect(contract.indexes.length).toBeGreaterThan(0);
      expect(contract.queryContracts.length).toBeGreaterThan(0);
    }

    expect(readFileSync(resolve(process.cwd(), 'host/database/schema/sqlite/001_baseline.sql'), 'utf8')).toContain(
      'CREATE TABLE IF NOT EXISTS ops_task',
    );
    expect(readFileSync(resolve(process.cwd(), 'host/database/schema/postgres/001_baseline.sql'), 'utf8')).toContain(
      'CREATE TABLE IF NOT EXISTS ops_task',
    );
    expect(existsSync(resolve(process.cwd(), 'host/migrations'))).toBe(false);
  });

  it('creates a pass/fail database contract report for registry, baseline schema, and drift guards', async () => {
    const { createDatabaseContractsReport } = await loadCliModule();
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-database-contracts-'));

    const report = createDatabaseContractsReport({ reportDir });

    expect(report).toMatchObject({
      command: 'check:database-contracts',
      reportVersion: 'video-cut.database-contracts-report.v1',
      status: 'pass',
    });
    expect(report.summary.fail).toBe(0);
    expect(report.checks.map((check: Record<string, unknown>) => check.id)).toEqual(
      expect.arrayContaining([
        'prefix-registry',
        'schema-registry-required-tables',
        'sqlite-baseline-schema',
        'postgres-baseline-schema',
        'no-new-project-migrations',
      ]),
    );
    expect(report.reportPath).toBe(resolve(reportDir, 'database-contracts-report.json'));
    expect(existsSync(report.reportPath)).toBe(true);
  });

  it('serializes the default database contract report path as a project-relative path', async () => {
    const { createDatabaseContractsReport } = await loadCliModule();

    const report = createDatabaseContractsReport();

    expect(report.reportPath).toBe('artifacts/governance/database-contracts-report.json');
    expect(existsSync(resolve(process.cwd(), report.reportPath))).toBe(true);
  });

  it('declares package scripts for quick database contract and readiness checks', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'check:database-contracts': 'node scripts/check-video-cut-database-contracts.mjs',
      'check:feature-readiness': 'node scripts/check-video-cut-feature-readiness.mjs',
    });
  });

  it('marks database-backed multi-instance queue readiness as implemented with executable evidence', () => {
    const registry = YAML.parse(readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8')) as {
      features: Array<Record<string, unknown>>;
    };

    expect(registry.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'database-backed-multi-instance-queue',
          status: 'implemented',
          checks: expect.arrayContaining(['pnpm check:database-contracts']),
        }),
      ]),
    );
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadCliModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/check-video-cut-database-contracts.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
