#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const readinessSchemaVersion = '2026-05-08.autocut-app-manifest-release-readiness.v1';
const defaultManifestRelativePath = 'sdkwork.app.config.json';
const sha256Pattern = /^[a-f0-9]{64}$/u;
const placeholderSha256Values = new Set([
  '0'.repeat(64),
  '1'.repeat(64),
  'f'.repeat(64),
]);
const activePublishStatuses = new Set(['ACTIVE']);
const inactivePublishStatuses = new Set(['INACTIVE', 'DISABLED', 'DELETED']);

export function createAutoCutAppManifestReleaseReadinessReport({
  rootDir = process.cwd(),
  manifestPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedManifestPath = path.resolve(
    manifestPath ?? path.join(resolvedRootDir, defaultManifestRelativePath),
  );
  const manifest = readManifest(resolvedManifestPath);
  const packages = Array.isArray(manifest.artifacts?.installConfig?.packages)
    ? manifest.artifacts.installConfig.packages
    : [];
  const mode = createManifestMode(manifest);
  const blockers = createManifestReleaseBlockers(manifest, packages, mode);
  const warnings = createManifestReleaseWarnings(manifest, packages, mode);
  const enabledPackages = packages.filter((installPackage) => installPackage?.enabled === true);

  return {
    schemaVersion: readinessSchemaVersion,
    generatedAt,
    manifestPath: toPosixRelative(resolvedRootDir, resolvedManifestPath),
    mode,
    manifestReleaseReady: blockers.length === 0,
    summary: {
      totalPackages: packages.length,
      enabledPackages: enabledPackages.length,
      disabledPackages: packages.length - enabledPackages.length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
    },
    packages: packages.map((installPackage, index) => ({
      index,
      id: String(installPackage?.id ?? ''),
      enabled: installPackage?.enabled === true,
      platform: String(installPackage?.platform ?? ''),
      packageFormat: String(installPackage?.packageFormat ?? ''),
      checksumReady: packageChecksumReady(installPackage),
      trustEvidenceReady: packageTrustEvidenceReady(installPackage),
      sbomReady: packageSbomReady(installPackage),
      commercialActivationRequired: text(installPackage?.metadata?.commercialActivationRequired),
    })),
    blockers,
    warnings,
  };
}

export function formatAutoCutAppManifestReleaseReadinessMessage(report) {
  const status = report.manifestReleaseReady ? 'ok' : 'blocked';
  return [
    `${status} - autocut app manifest release readiness`,
    `mode=${report.mode}`,
    `packages=${report.summary.enabledPackages}/${report.summary.totalPackages}`,
    `blockers=${report.summary.blockerCount}`,
    `warnings=${report.summary.warningCount}`,
  ].join(' ');
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`missing AutoCut app manifest: ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function createManifestMode(manifest) {
  const publishStatus = upper(manifest.publish?.status);
  if (activePublishStatuses.has(publishStatus)) {
    return 'active-commercial';
  }
  if (inactivePublishStatuses.has(publishStatus)) {
    return 'inactive-preview';
  }
  return 'unknown';
}

function createManifestReleaseBlockers(manifest, packages, mode) {
  const blockers = [];
  const enabledPackages = packages.filter((installPackage) => installPackage?.enabled === true);

  if (manifest.schemaVersion !== 3 || manifest.kind !== 'sdkwork.app') {
    blockers.push(createBlocker('MANIFEST_SCHEMA_UNSUPPORTED', 'sdkwork.app.config.json must use sdkwork.app schemaVersion 3.'));
  }

  if (mode === 'unknown') {
    blockers.push(
      createBlocker(
        'PUBLISH_STATUS_UNSUPPORTED',
        'sdkwork.app.config.json publish.status must be ACTIVE, INACTIVE, DISABLED, or DELETED.',
      ),
    );
  }

  if (!manifest.security?.checksumRequired || !manifest.security?.signatureRequired || !manifest.security?.sbomRequired) {
    blockers.push(
      createBlocker(
        'MANIFEST_SECURITY_POLICY_INCOMPLETE',
        'sdkwork.app.config.json must require checksum, signature, and SBOM evidence.',
      ),
    );
  }

  if (!Array.isArray(packages) || packages.length === 0) {
    blockers.push(createBlocker('INSTALL_PACKAGES_MISSING', 'sdkwork.app.config.json must declare an install package matrix.'));
    return blockers;
  }

  if (mode === 'active-commercial' && enabledPackages.length === 0) {
    blockers.push(
      createBlocker(
        'ACTIVE_MANIFEST_HAS_NO_ENABLED_PACKAGES',
        'ACTIVE commercial app manifests must enable at least one fully evidenced install package.',
      ),
    );
  }

  for (const [index, installPackage] of packages.entries()) {
    if (installPackage?.enabled === true) {
      blockers.push(...createEnabledPackageBlockers(installPackage, index));
    } else {
      blockers.push(...createDisabledPackageBlockers(installPackage, index, mode));
    }
  }

  return blockers;
}

function createEnabledPackageBlockers(installPackage, index) {
  const blockers = [];
  const packageId = packageLabel(installPackage, index);

  if (installPackage?.metadata?.generatedPlaceholder === true) {
    blockers.push(
      createPackageBlocker(
        packageId,
        'ENABLED_PACKAGE_PLACEHOLDER_METADATA',
        'Enabled install packages must not be generated placeholders.',
      ),
    );
  }

  if (!packageChecksumReady(installPackage)) {
    blockers.push(
      createPackageBlocker(
        packageId,
        'ENABLED_PACKAGE_CHECKSUM_INVALID',
        'Enabled install packages must include checksumAlgorithm SHA-256 and a 64 character lowercase hex checksum.',
      ),
    );
  } else if (placeholderSha256Values.has(text(installPackage.checksum).toLowerCase())) {
    blockers.push(
      createPackageBlocker(
        packageId,
        'ENABLED_PACKAGE_CHECKSUM_PLACEHOLDER',
        'Enabled install package checksum must be a real release asset digest, not a placeholder value.',
      ),
    );
  }

  if (!packageTrustEvidenceReady(installPackage)) {
    blockers.push(
      createPackageBlocker(
        packageId,
        'ENABLED_PACKAGE_TRUST_EVIDENCE_INVALID',
        'Enabled install packages must include verified platform trust evidence metadata.',
      ),
    );
  }

  if (!packageSbomReady(installPackage)) {
    blockers.push(
      createPackageBlocker(
        packageId,
        'ENABLED_PACKAGE_SBOM_INVALID',
        'Enabled install packages must include SBOM metadata with CycloneDX or SPDX format, URL, and SHA-256 digest.',
      ),
    );
  }

  if (text(installPackage?.metadata?.commercialActivationRequired)) {
    blockers.push(
      createPackageBlocker(
        packageId,
        'ENABLED_PACKAGE_STILL_MARKED_COMMERCIAL_ACTIVATION_REQUIRED',
        'Enabled commercial packages must remove commercialActivationRequired after real release evidence is recorded.',
      ),
    );
  }

  return blockers;
}

function createDisabledPackageBlockers(installPackage, index, mode) {
  if (mode !== 'inactive-preview') {
    return [];
  }
  if (text(installPackage?.metadata?.commercialActivationRequired)) {
    return [];
  }
  return [
    createPackageBlocker(
      packageLabel(installPackage, index),
      'DISABLED_PACKAGE_COMMERCIAL_ACTIVATION_MISSING',
      'Disabled preview install packages must state the commercial activation evidence required before enabling.',
    ),
  ];
}

function createManifestReleaseWarnings(manifest, packages, mode) {
  const warnings = [];
  const currentReleaseNote = Array.isArray(manifest.release?.notes)
    ? manifest.release.notes.find((note) => note?.current === true)
    : null;

  if (mode === 'inactive-preview' && currentReleaseNote?.metadata?.previewRelease !== true) {
    warnings.push(
      createBlocker(
        'PREVIEW_RELEASE_NOTE_METADATA_MISSING',
        'Inactive preview manifests should mark the current release note metadata.previewRelease as true.',
      ),
    );
  }

  if (mode === 'active-commercial' && currentReleaseNote?.metadata?.previewRelease === true) {
    warnings.push(
      createBlocker(
        'ACTIVE_RELEASE_NOTE_STILL_MARKED_PREVIEW',
        'Active commercial manifests should not keep the current release note marked as previewRelease.',
      ),
    );
  }

  const disabledWithoutReleaseAsset = packages.filter(
    (installPackage) => installPackage?.enabled !== true && installPackage?.metadata?.releaseAsset !== true,
  );
  if (disabledWithoutReleaseAsset.length > 0) {
    warnings.push(
      createBlocker(
        'DISABLED_PACKAGE_RELEASE_ASSET_METADATA_MISSING',
        'Disabled preview packages should keep metadata.releaseAsset=true so planned GitHub Release assets remain explicit.',
      ),
    );
  }

  return warnings;
}

function packageChecksumReady(installPackage) {
  return (
    ['SHA-256', 'SHA256'].includes(text(installPackage?.checksumAlgorithm).toUpperCase()) &&
    sha256Pattern.test(text(installPackage?.checksum))
  );
}

function packageTrustEvidenceReady(installPackage) {
  const trustEvidence = installPackage?.metadata?.trustEvidence;
  if (!trustEvidence || typeof trustEvidence !== 'object' || Array.isArray(trustEvidence)) {
    return false;
  }
  if (!['verified', 'ready'].includes(text(trustEvidence.status).toLowerCase())) {
    return false;
  }
  if (!text(trustEvidence.evidencePath) && !text(trustEvidence.url)) {
    return false;
  }
  const platform = upper(installPackage?.platform);
  if (platform === 'DESKTOP_MACOS') {
    return (
      trustEvidence.signed === true &&
      ['valid', 'verified', 'accepted'].includes(text(trustEvidence.signatureStatus).toLowerCase()) &&
      ['notarized', 'accepted', 'verified'].includes(text(trustEvidence.notarizationStatus).toLowerCase())
    );
  }
  if (platform === 'DESKTOP_WINDOWS') {
    return (
      trustEvidence.signed === true &&
      ['valid', 'verified'].includes(text(trustEvidence.signatureStatus).toLowerCase())
    );
  }
  if (platform === 'DESKTOP_LINUX') {
    return (
      trustEvidence.signed === true &&
      ['valid', 'verified', 'policy-verified'].includes(text(trustEvidence.signatureStatus).toLowerCase())
    );
  }
  return trustEvidence.signed === true;
}

function packageSbomReady(installPackage) {
  const sbom = installPackage?.metadata?.sbom;
  if (!sbom || typeof sbom !== 'object' || Array.isArray(sbom)) {
    return false;
  }
  if (!['cyclonedx', 'spdx'].includes(text(sbom.format).toLowerCase())) {
    return false;
  }
  if (!text(sbom.url) && !text(sbom.path)) {
    return false;
  }
  if (!sha256Pattern.test(text(sbom.sha256))) {
    return false;
  }
  return !placeholderSha256Values.has(text(sbom.sha256).toLowerCase());
}

function packageLabel(installPackage, index) {
  return text(installPackage?.id) || `index-${index}`;
}

function createPackageBlocker(packageId, code, message) {
  return {
    packageId,
    code,
    message,
  };
}

function createBlocker(code, message) {
  return {
    code,
    message,
  };
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function upper(value) {
  return text(value).toUpperCase();
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--manifest') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut app manifest release readiness',
      });
      options.manifestPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut app manifest release readiness argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutAppManifestReleaseReadinessReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutAppManifestReleaseReadinessMessage(report));
  for (const warning of report.warnings) {
    console.error(`${warning.code}: ${warning.message}`);
  }
  if (!report.manifestReleaseReady) {
    for (const blocker of report.blockers) {
      console.error(`${blocker.packageId ? `${blocker.packageId}:` : ''}${blocker.code}: ${blocker.message}`);
    }
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
