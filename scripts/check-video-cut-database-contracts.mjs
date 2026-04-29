#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { createReportPath } from './lib/report-paths.mjs';

const COMMAND = 'check:database-contracts';
const REPORT_VERSION = 'video-cut.database-contracts-report.v1';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const PREFIX_REGISTRY = 'docs/database/prefix-registry.yaml';
const SCHEMA_REGISTRY_DIR = 'docs/database/schema-registry';
const SQLITE_BASELINE = 'host/database/schema/sqlite/001_baseline.sql';
const POSTGRES_BASELINE = 'host/database/schema/postgres/001_baseline.sql';
const MIGRATION_DIR = 'host/migrations';

const REQUIRED_TABLES = [
  'ops_database_contract',
  'ops_task',
  'ops_stage_run',
  'ops_task_event',
  'ops_worker_lease',
  'media_artifact',
];

const REQUIRED_PREFIXES = ['studio', 'media', 'ops', 'ai', 'integration', 'iam'];
const FORBIDDEN_PREFIXES = ['sdkwork', 'video_cut', 'plus', 'app', 'sys', 'common'];
const REQUIRED_COLUMNS = ['id', 'uuid', 'tenant_id', 'created_at', 'updated_at', 'version'];
const VALID_COMPLIANCE_LEVELS = new Set(['L1', 'L2', 'L3']);
const NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export function parseDatabaseContractsArgs(argv) {
  const args = [...argv];
  let json = false;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown database contracts argument: ${arg}`);
  }

  return { json, reportDir };
}

export function createDatabaseContractsReport({
  projectRoot = process.cwd(),
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const prefixRegistry = readYaml(projectRoot, PREFIX_REGISTRY);
  const contracts = readSchemaContracts(projectRoot);
  const sqliteBaseline = readText(projectRoot, SQLITE_BASELINE);
  const postgresBaseline = readText(projectRoot, POSTGRES_BASELINE);

  const checks = [
    checkPrefixRegistry(prefixRegistry),
    checkSchemaRegistryRequiredTables(contracts),
    ...contracts.map((contract) => checkTableContract(projectRoot, prefixRegistry, contract)),
    checkBaselineSchema('sqlite-baseline-schema', sqliteBaseline, contracts),
    checkBaselineSchema('postgres-baseline-schema', postgresBaseline, contracts),
    checkNoMigrationDirectory(projectRoot),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath: absoluteReportPath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'database-contracts-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    reportPath,
    summary,
    checks,
  };

  writeReport(absoluteReportPath, report);
  return report;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function readSchemaContracts(projectRoot) {
  const absoluteDir = resolve(projectRoot, SCHEMA_REGISTRY_DIR);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir)
    .filter((file) => file.endsWith('.yaml'))
    .sort()
    .map((file) => readYaml(projectRoot, `${SCHEMA_REGISTRY_DIR}/${file}`));
}

function checkPrefixRegistry(prefixRegistry) {
  const allowedPrefixes = new Set(asArray(prefixRegistry.allowedPrefixes).map((item) => String(item.prefix)));
  const forbiddenPrefixes = new Set(asArray(prefixRegistry.forbiddenPrefixes).map(String));
  const missingRequired = REQUIRED_PREFIXES.filter((prefix) => !allowedPrefixes.has(prefix));
  const missingForbidden = FORBIDDEN_PREFIXES.filter((prefix) => !forbiddenPrefixes.has(prefix));

  return checkResult({
    id: 'prefix-registry',
    passed:
      prefixRegistry.registryVersion === 'video-cut.database-prefix-registry.v1' &&
      missingRequired.length === 0 &&
      missingForbidden.length === 0,
    evidence: `allowed=${[...allowedPrefixes].join(', ')} forbidden=${[...forbiddenPrefixes].join(', ')}`,
    failMessage: `Prefix registry drift. missingRequired=${missingRequired.join(', ')} missingForbidden=${missingForbidden.join(', ')}`,
  });
}

function checkSchemaRegistryRequiredTables(contracts) {
  const tableNames = new Set(contracts.map((contract) => String(contract.tableName)));
  const missing = REQUIRED_TABLES.filter((tableName) => !tableNames.has(tableName));

  return checkResult({
    id: 'schema-registry-required-tables',
    passed: missing.length === 0,
    evidence: REQUIRED_TABLES.join(', '),
    failMessage: `Missing schema registry contracts: ${missing.join(', ')}`,
  });
}

function checkTableContract(projectRoot, prefixRegistry, contract) {
  const tableName = String(contract.tableName || '');
  const allowedPrefixes = new Set(asArray(prefixRegistry.allowedPrefixes).map((item) => String(item.prefix)));
  const forbiddenPrefixes = new Set(asArray(prefixRegistry.forbiddenPrefixes).map(String));
  const prefix = String(contract.prefix || tableName.split('_')[0] || '');
  const columns = asArray(contract.columns);
  const indexes = asArray(contract.indexes);
  const queryContracts = asArray(contract.queryContracts);
  const columnNames = columns.map((column) => String(column.name));
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columnNames.includes(column));
  const jsonColumnsMissingSchema = columns
    .filter((column) => String(column.logicalType) === 'json')
    .filter((column) => !jsonSchemaExists(projectRoot, column.jsonSchema))
    .map((column) => String(column.name));
  const invalidIndexes = indexes
    .filter((index) => !String(index.name || '').match(/^(idx|uq|pk|fk|ck)_[a-z0-9_]+$/))
    .map((index) => String(index.name));
  const invalidColumns = columnNames.filter((name) => !NAME_PATTERN.test(name));
  const errors = [
    ...(!NAME_PATTERN.test(tableName) ? [`invalid table name ${tableName}`] : []),
    ...(!allowedPrefixes.has(prefix) ? [`prefix not registered ${prefix}`] : []),
    ...(forbiddenPrefixes.has(prefix) ? [`forbidden prefix ${prefix}`] : []),
    ...(!VALID_COMPLIANCE_LEVELS.has(String(contract.complianceLevel)) ? ['invalid complianceLevel'] : []),
    ...(!SEMVER_PATTERN.test(String(contract.contractVersion || '')) ? ['invalid contractVersion'] : []),
    ...(!contract.owner ? ['owner missing'] : []),
    ...(!contract.profile ? ['profile missing'] : []),
    ...(missingColumns.length > 0 ? [`missing columns ${missingColumns.join(', ')}`] : []),
    ...(queryContracts.length === 0 ? ['queryContracts missing'] : []),
    ...(indexes.length === 0 ? ['indexes missing'] : []),
    ...(invalidColumns.length > 0 ? [`invalid columns ${invalidColumns.join(', ')}`] : []),
    ...(jsonColumnsMissingSchema.length > 0 ? [`json schema missing for ${jsonColumnsMissingSchema.join(', ')}`] : []),
    ...(invalidIndexes.length > 0 ? [`invalid indexes ${invalidIndexes.join(', ')}`] : []),
  ];

  return checkResult({
    id: `table-contract-${tableName || 'unknown'}`,
    passed: errors.length === 0,
    evidence: `${tableName} ${contract.profile} ${contract.complianceLevel}`,
    failMessage: `${tableName || 'unknown'} contract errors: ${errors.join('; ')}`,
  });
}

function checkBaselineSchema(id, sql, contracts) {
  const normalized = sql.toLowerCase();
  const missingTables = contracts
    .map((contract) => String(contract.tableName))
    .filter((tableName) => !normalized.includes(`create table if not exists ${tableName}`));
  const missingIndexes = contracts
    .flatMap((contract) => asArray(contract.indexes).map((index) => String(index.name)))
    .filter((indexName) => !normalized.includes(indexName.toLowerCase()));
  const baselineNameMatches = normalized.includes('001_baseline.sql');

  return checkResult({
    id,
    passed: missingTables.length === 0 && missingIndexes.length === 0 && baselineNameMatches,
    evidence: `tables=${contracts.length} indexes=${contracts.flatMap((contract) => asArray(contract.indexes)).length}`,
    failMessage: `${id} drift. missingTables=${missingTables.join(', ')} missingIndexes=${missingIndexes.join(', ')}`,
  });
}

function checkNoMigrationDirectory(projectRoot) {
  const migrationPath = resolve(projectRoot, MIGRATION_DIR);

  return checkResult({
    id: 'no-new-project-migrations',
    passed: !existsSync(migrationPath),
    evidence: 'host/migrations is intentionally absent for the new-project baseline.',
    failMessage: 'host/migrations must not exist for the new-project baseline. Use host/database/schema/*/001_baseline.sql.',
  });
}

function jsonSchemaExists(projectRoot, jsonSchemaPath) {
  return typeof jsonSchemaPath === 'string' && existsSync(resolve(projectRoot, jsonSchemaPath));
}

function checkResult({ evidence, failMessage, id, passed }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence: passed ? evidence : failMessage,
  };
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readYaml(projectRoot, path) {
  return YAML.parse(readText(projectRoot, path));
}

function readText(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  if (!existsSync(absolutePath)) {
    return '';
  }

  return readFileSync(absolutePath, 'utf8');
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    `SDKWork Video Cut Database Contracts`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseDatabaseContractsArgs(process.argv.slice(2));
    const report = createDatabaseContractsReport({ reportDir: options.reportDir });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reportVersion: REPORT_VERSION,
          command: COMMAND,
          status: 'fail',
          error: {
            code: 'DATABASE_CONTRACTS_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  void main();
}
