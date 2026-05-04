#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createReportPath } from './lib/report-paths.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData } from './lib/report-safety.mjs';

const REPORT_VERSION = 'video-cut.release-signature-verification.v1';
const COMMAND = 'verify:release-signature';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const RELEASE_SIGNATURE_VERSION = 'video-cut.release-signature.v1';

export function parseReleaseSignatureVerificationArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--release-assets-dir') {
      releaseAssetsDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown release signature verification argument: ${arg}`);
  }

  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  return {
    json,
    releaseAssetsDir: normalizeProjectPath(releaseAssetsDir),
    reportDir: normalizeProjectPath(reportDir),
  };
}

export function createReleaseSignatureVerificationReport({
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const releaseRoot = resolve(projectRoot, normalizedReleaseAssetsDir);
  const manifest = readJsonFile(resolve(releaseRoot, 'release-manifest.json'));
  const signature = readJsonFile(resolve(releaseRoot, 'release-signature.json'));
  const checksumsText = readTextFile(resolve(releaseRoot, 'SHA256SUMS.txt'));
  const checks = [
    checkStandardSignatureFiles(releaseRoot),
    checkSignaturePayload({
      checksumsText,
      manifest: manifest.value,
      normalizedReleaseAssetsDir,
      releaseRoot,
      signature: signature.value,
    }),
    checkVerificationJsonSafety([manifest.value, signature.value]),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    normalizedReportDir,
    'release-signature-verification-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    releaseAssetsDir: normalizedReleaseAssetsDir,
    action: typeof manifest.value?.action === 'string' ? manifest.value.action : '',
    target: typeof manifest.value?.target === 'string' ? manifest.value.target : '',
    reportPath,
    summary,
    checks,
  };
  writeReport(absolutePath, report);
  return report;
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

if (isDirectRun(import.meta.url)) {
  const options = parseReleaseSignatureVerificationArgs(process.argv.slice(2));
  const report = createReleaseSignatureVerificationReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanReport(report);
  }
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

function checkStandardSignatureFiles(releaseRoot) {
  const requiredFiles = [
    'release-manifest.json',
    'SHA256SUMS.txt',
    'provenance.json',
    'release-notes.md',
    'quality-gate-execution-report.json',
    'release-signature.json',
  ];
  const manifest = readJsonFile(resolve(releaseRoot, 'release-manifest.json')).value;
  const actionReport =
    typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
      ? `${manifest.target}-${manifest.action}-report.json`
      : '';
  const missing = [...requiredFiles, actionReport].filter((fileName) => fileName && !existsSync(resolve(releaseRoot, fileName)));

  return checkResult({
    id: 'release-signature-standard-files-present',
    passed: existsSync(releaseRoot) && missing.length === 0,
    evidence: `${requiredFiles.join(', ')}${actionReport ? `, ${actionReport}` : ''}`,
    failMessage: `Release signature verification files are incomplete. Missing: ${missing.join(', ')}`,
  });
}

function checkSignaturePayload({ checksumsText, manifest, normalizedReleaseAssetsDir, releaseRoot, signature }) {
  const failures = [];
  const manifestArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const signedArtifacts = manifestArtifacts.filter((artifact) => artifact?.path !== 'release-signature.json');

  if (!signature || typeof signature !== 'object') {
    failures.push('release-signature.json: missing or invalid JSON');
  } else {
    if (signature.signatureVersion !== RELEASE_SIGNATURE_VERSION) {
      failures.push(`signatureVersion must be ${RELEASE_SIGNATURE_VERSION}`);
    }
    if (signature.signatureKind !== 'local-deterministic-digest') {
      failures.push('signatureKind must be local-deterministic-digest');
    }
    if (signature.product !== 'sdkwork-video-cut') {
      failures.push('product must be sdkwork-video-cut');
    }
    if (signature.action !== manifest?.action || signature.target !== manifest?.target) {
      failures.push('action/target must match release manifest');
    }
    if (signature.status !== manifest?.status || signature.status !== 'pass') {
      failures.push('status must be pass and match release manifest');
    }
    if (signature.releaseAssetsDir !== normalizedReleaseAssetsDir) {
      failures.push('releaseAssetsDir must match checked release assets directory');
    }
    if (signature.verification?.command !== 'check:release-contracts') {
      failures.push('verification.command must be check:release-contracts');
    }
    if (signature.verification?.contract !== 'release-signature-contract') {
      failures.push('verification.contract must be release-signature-contract');
    }

    const payload = signature.payload;
    if (payload?.algorithm !== 'sha256') {
      failures.push('payload.algorithm must be sha256');
    }
    const expectedSubjectHash = createHash('sha256').update(JSON.stringify(signedArtifacts)).digest('hex');
    if (payload?.subjectManifestSha256 !== expectedSubjectHash) {
      failures.push('payload.subjectManifestSha256 must match manifest artifacts excluding release-signature.json');
    }

    const manifestSubject = createReleaseManifestSignatureSubject(manifest, signedArtifacts);
    const checksumsSubject = signedArtifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n');
    const actionReportFile =
      typeof manifest?.target === 'string' && typeof manifest?.action === 'string'
        ? `${manifest.target}-${manifest.action}-report.json`
        : '';
    const expectedSignedFiles = [
      releaseSignatureTextSubject(
        JSON.stringify(manifestSubject),
        `${normalizedReleaseAssetsDir}/release-manifest.json`,
        'release-manifest-subject',
      ),
      releaseSignatureTextSubject(
        checksumsSubject,
        `${normalizedReleaseAssetsDir}/SHA256SUMS.txt`,
        'sha256sums-subject',
      ),
      releaseSignatureFileSubject(resolve(releaseRoot, 'provenance.json'), `${normalizedReleaseAssetsDir}/provenance.json`, 'provenance'),
      releaseSignatureFileSubject(
        resolve(releaseRoot, 'release-notes.md'),
        `${normalizedReleaseAssetsDir}/release-notes.md`,
        'release-notes',
      ),
      releaseSignatureFileSubject(
        resolve(releaseRoot, 'quality-gate-execution-report.json'),
        `${normalizedReleaseAssetsDir}/quality-gate-execution-report.json`,
        'quality-gate-report',
      ),
      releaseSignatureFileSubject(
        resolve(releaseRoot, actionReportFile),
        `${normalizedReleaseAssetsDir}/${actionReportFile}`,
        'action-report',
      ),
    ];
    if (!deepEqual(payload?.signedFiles, expectedSignedFiles)) {
      failures.push('payload.signedFiles must match release manifest, SHA256SUMS, provenance, release-notes.md, quality report, and action report');
    }
    const expectedSignature = createHash('sha256')
      .update(
        JSON.stringify({
          algorithm: 'sha256',
          subjectManifestSha256: expectedSubjectHash,
          signedFiles: expectedSignedFiles,
        }),
      )
      .digest('hex');
    if (signature.signature !== expectedSignature) {
      failures.push('signature must match deterministic digest payload');
    }

    const checksumValidation = validateChecksumsSubject({
      checksumsText,
      manifestArtifacts,
      signedArtifacts,
    });
    if (!checksumValidation.valid) {
      failures.push(checksumValidation.reason);
    }
  }

  return checkResult({
    id: 'release-signature-digest-valid',
    passed: failures.length === 0,
    evidence:
      'release-signature.json deterministic digest matches manifest, SHA256SUMS, provenance, release-notes.md, quality report, and action report.',
    failMessage: `Release signature verification failed: ${failures.join('; ')}`,
  });
}

function validateChecksumsSubject({ checksumsText, manifestArtifacts, signedArtifacts }) {
  const normalizedActual = checksumsText.replace(/\r\n/g, '\n');
  const expectedComplete = manifestArtifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n');
  const expectedCompleteWithNewline = expectedComplete ? `${expectedComplete}\n` : '';
  if (normalizedActual !== expectedCompleteWithNewline) {
    return { valid: false, reason: 'SHA256SUMS.txt must exactly match release-manifest.json artifact order and hashes' };
  }

  const signedChecksumLines = normalizedActual
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.endsWith('  release-signature.json'))
    .join('\n');
  const expectedSigned = signedArtifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n');
  if (signedChecksumLines !== expectedSigned) {
    return { valid: false, reason: 'signed SHA256SUMS subject must match manifest artifacts excluding release-signature.json' };
  }

  return { valid: true, reason: '' };
}

function checkVerificationJsonSafety(values) {
  const localPath = findLocalAbsolutePath(values);
  const sensitive = reportContainsSensitiveData(values);
  return checkResult({
    id: 'release-signature-verification-redaction-and-path-safety',
    passed: !localPath && !sensitive,
    evidence: 'Release signature verification inputs contain no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release signature verification inputs must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
  });
}

function releaseSignatureFileSubject(absolutePath, path, role) {
  if (!existsSync(absolutePath)) {
    return {
      role,
      path,
      sha256: '',
      sizeBytes: 0,
    };
  }
  const bytes = readFileSync(absolutePath);
  return {
    role,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function releaseSignatureTextSubject(text, path, role) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8');
  return {
    role,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

function createReleaseManifestSignatureSubject(manifest, subjectArtifacts) {
  return {
    manifestVersion: manifest?.manifestVersion,
    product: manifest?.product,
    action: manifest?.action,
    target: manifest?.target,
    runtimeProfile: manifest?.runtimeProfile,
    contractVersions: manifest?.contractVersions,
    status: manifest?.status,
    generatedAt: manifest?.generatedAt,
    artifacts: subjectArtifacts,
  };
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    return { exists: false, value: undefined, error: 'missing' };
  }

  try {
    return { exists: true, value: JSON.parse(readFileSync(path, 'utf8')), error: '' };
  } catch (error) {
    return {
      exists: true,
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTextFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function assertProjectRelativePath(name, value) {
  if (!isSafeRelativePath(value)) {
    throw new Error(`${name} must be project-relative and must not contain parent-directory segments.`);
  }
}

function isSafeRelativePath(value) {
  const raw = String(value ?? '');
  const normalized = normalizeProjectPath(raw);
  return Boolean(
    normalized &&
      !isAbsolute(raw) &&
      !normalized.startsWith('../') &&
      normalized !== '..' &&
      !normalized.includes('/../') &&
      !normalized.startsWith('/') &&
      !/^[A-Za-z]:\//.test(normalized) &&
      !normalized.startsWith('//'),
  );
}

function normalizeProjectPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
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

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Release Signature Verification',
    `releaseAssetsDir: ${report.releaseAssetsDir}`,
    `action: ${report.action}`,
    `target: ${report.target}`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
