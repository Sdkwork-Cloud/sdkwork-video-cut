#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import {
  FEATURE_POLICY_DRIFT_SCENARIOS,
  createFeatureReadinessReport,
} from './check-video-cut-feature-readiness.mjs';
import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createReportPath, serializeProjectPath } from './lib/report-paths.mjs';

const COMMAND = 'check:feature-readiness-policy';
const REPORT_VERSION = 'video-cut.feature-readiness-policy-report.v1';
const DEFAULT_REGISTRY_PATH = 'docs/product/feature-readiness.yaml';
const DEFAULT_REPORT_DIR = 'artifacts/governance';

export function parseFeatureReadinessPolicyArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let registryPath = DEFAULT_REGISTRY_PATH;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--registry') {
      registryPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown feature readiness policy argument: ${arg}`);
  }

  return { json, registryPath, reportDir };
}

export function createFeatureReadinessPolicyReport({
  projectRoot = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const registry = YAML.parse(readFileSync(resolve(projectRoot, registryPath), 'utf8'));
  const checks = [
    checkScenarioCoverage(registry),
    ...FEATURE_POLICY_DRIFT_SCENARIOS.map((scenario) =>
      checkPolicyDriftScenario({ projectRoot, registry, registryPath, reportDir, scenario }),
    ),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(projectRoot, reportDir, 'feature-readiness-policy-report.json');
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    registryPath: serializeProjectPath(projectRoot, resolve(projectRoot, registryPath)),
    reportPath,
    scenarioCount: FEATURE_POLICY_DRIFT_SCENARIOS.length,
    summary,
    checks,
  };
  writeReport(absolutePath, report);
  return report;
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

function checkScenarioCoverage(registry) {
  const implemented = (Array.isArray(registry.features) ? registry.features : [])
    .filter((feature) => feature?.status === 'implemented')
    .map((feature) => String(feature.id))
    .sort();
  const covered = FEATURE_POLICY_DRIFT_SCENARIOS.map((scenario) => scenario.id).sort();
  const missing = implemented.filter((id) => !covered.includes(id));
  const stale = covered.filter((id) => !implemented.includes(id));
  const passed = missing.length === 0 && stale.length === 0;

  return checkResult({
    id: 'feature-policy-drift-scenario-coverage',
    passed,
    evidence: `${covered.length} drift scenarios cover every implemented feature.`,
    failMessage:
      `Feature policy drift scenarios must cover every implemented feature; missing=${missing.join(', ') || 'none'}; stale=${stale.join(', ') || 'none'}.`,
  });
}

function checkPolicyDriftScenario({ projectRoot, registry, registryPath, reportDir, scenario }) {
  const mutated = structuredClone(registry);
  const feature = mutated.features?.find((item) => item?.id === scenario.id);
  if (!feature) {
    return checkResult({
      id: `${scenario.id}-policy-drift`,
      passed: false,
      evidence: '',
      failMessage: `Feature ${scenario.id} is missing from ${registryPath}.`,
    });
  }

  feature.evidenceFiles = removeArrayValue(feature.evidenceFiles, scenario.removeFile);
  feature.checks = removeArrayValue(feature.checks, scenario.removeCheck);
  feature.nextAction = String(feature.nextAction || '').replace(scenario.removeText, '');

  const scenarioReportDir = `${reportDir}/feature-readiness-policy/${scenario.id}`;
  const tempRegistryPath = `${scenarioReportDir}/feature-readiness-policy-mutated.yaml`;
  const absoluteTempRegistryPath = resolve(projectRoot, tempRegistryPath);
  mkdirSync(dirname(absoluteTempRegistryPath), { recursive: true });
  writeFileSync(absoluteTempRegistryPath, YAML.stringify(mutated), 'utf8');

  const readinessReport = createFeatureReadinessReport({
    projectRoot,
    registryPath: tempRegistryPath,
    reportDir: scenarioReportDir,
  });
  const blockedFeature = readinessReport.blockingFailures.find((item) => item.id === scenario.id);
  const missingFailures = scenario.expectedPolicyFailures.filter(
    (failure) => !blockedFeature?.policyFailures?.includes(failure),
  );
  const passed = readinessReport.status === 'fail' && missingFailures.length === 0;

  return checkResult({
    id: `${scenario.id}-policy-drift`,
    passed,
    evidence: `${scenario.id} drift is blocked with ${scenario.expectedPolicyFailures.length} mandatory policy failures.`,
    failMessage:
      `${scenario.id} drift was not blocked correctly; status=${readinessReport.status}; missingFailures=${missingFailures.join(', ') || 'none'}.`,
  });
}

function removeArrayValue(value, removeValue) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => String(item) !== removeValue);
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
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

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  try {
    const options = parseFeatureReadinessPolicyArgs(process.argv.slice(2));
    const report = createFeatureReadinessPolicyReport({
      registryPath: options.registryPath,
      reportDir: options.reportDir,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reportVersion: REPORT_VERSION,
          command: COMMAND,
          status: 'fail',
          error: {
            code: 'FEATURE_READINESS_POLICY_FAILED',
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
