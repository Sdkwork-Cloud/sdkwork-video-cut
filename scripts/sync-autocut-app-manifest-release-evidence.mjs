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
const syncSchemaVersion = '2026-05-08.autocut-app-manifest-release-evidence-sync.v1';
const defaultManifestRelativePath = 'sdkwork.app.config.json';
const defaultEvidenceDirRelativePath = 'artifacts/release';
const defaultSbomEvidenceRelativePath = 'artifacts/release/autocut-sbom-evidence.json';
const requiredPlatforms = ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'];
const sha256Pattern = /^[a-f0-9]{64}$/u;
const packageMappings = [
  { packageId: 'desktop-windows-msi', platform: 'windows-x86_64', kind: 'msi' },
  { packageId: 'desktop-windows-nsis', platform: 'windows-x86_64', kind: 'nsis' },
  { packageId: 'desktop-linux-deb', platform: 'linux-x86_64', kind: 'deb' },
  { packageId: 'desktop-linux-appimage', platform: 'linux-x86_64', kind: 'appimage' },
  { packageId: 'desktop-macos-x64-dmg', platform: 'macos-x86_64', kind: 'dmg' },
  { packageId: 'desktop-macos-aarch64-dmg', platform: 'macos-aarch64', kind: 'dmg' },
];

export function syncAutoCutAppManifestReleaseEvidence({
  rootDir = process.cwd(),
  manifestPath,
  evidenceDir,
  sbomEvidencePath,
  activateCommercial = false,
  dryRun = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedManifestPath = path.resolve(
    manifestPath ?? path.join(resolvedRootDir, defaultManifestRelativePath),
  );
  const resolvedEvidenceDir = path.resolve(
    evidenceDir ?? path.join(resolvedRootDir, defaultEvidenceDirRelativePath),
  );
  const resolvedSbomEvidencePath = path.resolve(
    sbomEvidencePath ?? path.join(resolvedRootDir, defaultSbomEvidenceRelativePath),
  );
  const manifest = readJsonFile(resolvedManifestPath, 'AutoCut app manifest');
  const evidenceRead = readReleaseEvidenceByPlatform(resolvedEvidenceDir);
  const sbomRead = readSbomEvidence(resolvedSbomEvidencePath);
  const evidenceByPackage = createPackageEvidenceSnapshots({
    evidenceByPlatform: evidenceRead.evidenceByPlatform,
    sbomEvidence: sbomRead.sbomEvidence,
  });
  const syncBlockers = createSyncBlockers(manifest, evidenceRead.evidenceByPlatform, evidenceByPackage);
  const blockers = dedupeBlockers([
    ...evidenceRead.blockers,
    ...sbomRead.blockers,
    ...syncBlockers,
  ]);
  const commercialActivationReady = blockers.length === 0;
  const nextManifest = commercialActivationReady
    ? applyEvidenceToManifest(manifest, evidenceByPackage, { activateCommercial })
    : manifest;
  const manifestWritten = commercialActivationReady && !dryRun;

  if (manifestWritten) {
    writeJsonFileAtomic(resolvedManifestPath, nextManifest);
  }

  return {
    schemaVersion: syncSchemaVersion,
    generatedAt,
    manifestPath: toPosixRelative(resolvedRootDir, resolvedManifestPath),
    evidenceDir: toPosixRelative(resolvedRootDir, resolvedEvidenceDir),
    sbomEvidencePath: toPosixRelative(resolvedRootDir, resolvedSbomEvidencePath),
    activateCommercial: Boolean(activateCommercial),
    dryRun: Boolean(dryRun),
    commercialActivationReady,
    manifestWritten,
    summary: {
      packageCount: packageMappings.length,
      syncedPackageCount: commercialActivationReady ? packageMappings.length : 0,
      blockerCount: blockers.length,
    },
    packages: evidenceByPackage,
    blockers,
    ...(dryRun || !manifestWritten ? { manifest: nextManifest } : {}),
  };
}

export function formatAutoCutAppManifestReleaseEvidenceSyncMessage(result) {
  const status = result.commercialActivationReady ? 'ok' : 'blocked';
  return [
    `${status} - autocut app manifest release evidence sync`,
    `packages=${result.summary.syncedPackageCount || result.packages.length}`,
    `activateCommercial=${result.activateCommercial}`,
    `dryRun=${result.dryRun}`,
    `written=${result.manifestWritten}`,
    `blockers=${result.summary.blockerCount}`,
  ].join(' ');
}

function readReleaseEvidenceByPlatform(evidenceDir) {
  const evidenceByPlatform = new Map();
  const blockers = [];
  for (const platform of requiredPlatforms) {
    const evidencePath = path.join(evidenceDir, `autocut-release-evidence-${platform}.json`);
    let evidence;
    try {
      evidence = readJsonFile(evidencePath, `AutoCut release evidence for ${platform}`);
      if (evidence.schemaVersion !== '2026-05-05.autocut-release-evidence.v1') {
        blockers.push(createBlocker('PLATFORM_RELEASE_EVIDENCE_SCHEMA_UNSUPPORTED', `Unsupported release evidence schema for ${platform}: ${evidence.schemaVersion}.`, { platform }));
        continue;
      }
      if (evidence.platform !== platform) {
        blockers.push(createBlocker('PLATFORM_RELEASE_EVIDENCE_MISMATCH', `Release evidence declares ${evidence.platform}, expected ${platform}.`, { platform }));
        continue;
      }
    } catch (error) {
      blockers.push(createBlocker('PLATFORM_RELEASE_EVIDENCE_MISSING', error instanceof Error ? error.message : String(error), { platform }));
      continue;
    }
    evidenceByPlatform.set(platform, {
      path: evidencePath,
      evidence,
    });
  }
  return {
    evidenceByPlatform,
    blockers,
  };
}

function readSbomEvidence(sbomEvidencePath) {
  try {
    const evidence = readJsonFile(sbomEvidencePath, 'AutoCut SBOM evidence');
    if (evidence.schemaVersion !== '2026-05-08.autocut-sbom-evidence.v1') {
      return {
        sbomEvidence: { packages: [] },
        blockers: [
          createBlocker('SBOM_EVIDENCE_SCHEMA_UNSUPPORTED', `Unsupported AutoCut SBOM evidence schema: ${evidence.schemaVersion}.`),
        ],
      };
    }
    const evidenceBlockers = [];
    if (evidence.readiness?.sbomReady !== true) {
      evidenceBlockers.push(
        createBlocker(
          'SBOM_EVIDENCE_NOT_READY',
          'AutoCut SBOM evidence is not ready; package SBOM metadata must not be synced until every SBOM blocker is resolved.',
        ),
      );
    }
    for (const blocker of Array.isArray(evidence.blockers) ? evidence.blockers : []) {
      evidenceBlockers.push(
        createBlocker(
          'SBOM_EVIDENCE_NOT_READY',
          String(blocker?.message ?? `AutoCut SBOM evidence blocker: ${blocker?.code ?? 'UNKNOWN'}.`),
          {
            packageId: blocker?.packageId ? String(blocker.packageId) : undefined,
            sourceCode: String(blocker?.code ?? 'UNKNOWN'),
          },
        ),
      );
    }
    return {
      sbomEvidence: evidence,
      blockers: evidenceBlockers,
    };
  } catch (error) {
    return {
      sbomEvidence: { packages: [] },
      blockers: [
        createBlocker('SBOM_EVIDENCE_MISSING', error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}

function createPackageEvidenceSnapshots({ evidenceByPlatform, sbomEvidence }) {
  const sbomByPackageId = new Map(
    Array.isArray(sbomEvidence.packages)
      ? sbomEvidence.packages.map((entry) => [String(entry?.packageId ?? ''), entry])
      : [],
  );

  return packageMappings.map((mapping) => {
    const platformEvidence = evidenceByPlatform.get(mapping.platform);
    const releaseEvidence = platformEvidence?.evidence;
    const installer = Array.isArray(releaseEvidence?.installers)
      ? releaseEvidence.installers.find((entry) => String(entry?.kind ?? '').toLowerCase() === mapping.kind)
      : undefined;
    const signatureInstaller = Array.isArray(releaseEvidence?.installerSignature?.evidence?.installers)
      ? releaseEvidence.installerSignature.evidence.installers.find((entry) => String(entry?.kind ?? '').toLowerCase() === mapping.kind)
      : undefined;
    const sbom = sbomByPackageId.get(mapping.packageId);

    return {
      ...mapping,
      installer: installer
        ? {
            path: String(installer.path ?? ''),
            byteSize: Number(installer.byteSize ?? 0),
            sha256: String(installer.sha256 ?? '').toLowerCase(),
          }
        : null,
      trustEvidence: signatureInstaller
        ? {
            status: signatureInstaller.signatureReady === true ? 'verified' : 'blocked',
            platform: mapping.platform,
            kind: mapping.kind,
            signed: signatureInstaller.signatureReady === true,
            signatureStatus: String(signatureInstaller.signatureStatus ?? ''),
            notarizationStatus: String(signatureInstaller.notarizationStatus ?? ''),
            signer: String(signatureInstaller.signer ?? ''),
            evidencePath: String(releaseEvidence?.installerSignature?.path ?? ''),
            diagnostics: Array.isArray(signatureInstaller.diagnostics) ? signatureInstaller.diagnostics : [],
          }
        : null,
      sbom: sbom
        ? {
            format: String(sbom.format ?? ''),
            url: String(sbom.url ?? ''),
            path: String(sbom.path ?? ''),
            sha256: String(sbom.sha256 ?? '').toLowerCase(),
          }
        : null,
    };
  });
}

function createSyncBlockers(manifest, evidenceByPlatform, evidenceByPackage) {
  const blockers = [];
  const packages = Array.isArray(manifest.artifacts?.installConfig?.packages)
    ? manifest.artifacts.installConfig.packages
    : [];
  const manifestPackageIds = new Set(packages.map((entry) => String(entry?.id ?? '')));

  for (const platform of requiredPlatforms) {
    const releaseEvidence = evidenceByPlatform.get(platform)?.evidence;
    if (!releaseEvidence) {
      continue;
    }
    if (releaseEvidence.readiness?.installerSignatureReady !== true || releaseEvidence.installerSignature?.ready !== true) {
      blockers.push(
        createBlocker(
          'PLATFORM_INSTALLER_SIGNATURE_EVIDENCE_NOT_READY',
          `Installer signature evidence is not ready for ${platform}.`,
          { platform },
        ),
      );
    }
  }

  for (const packageEvidence of evidenceByPackage) {
    const packageId = packageEvidence.packageId;
    if (!manifestPackageIds.has(packageId)) {
      blockers.push(createBlocker('MANIFEST_PACKAGE_MISSING', `Manifest is missing install package ${packageId}.`, { packageId }));
      continue;
    }
    if (!packageEvidence.installer) {
      blockers.push(createBlocker('PACKAGE_INSTALLER_EVIDENCE_MISSING', `Missing installer evidence for ${packageId}.`, { packageId }));
    } else {
      if (!Number.isFinite(packageEvidence.installer.byteSize) || packageEvidence.installer.byteSize <= 0) {
        blockers.push(createBlocker('PACKAGE_INSTALLER_BYTE_SIZE_INVALID', `Installer byte size is invalid for ${packageId}.`, { packageId }));
      }
      if (!sha256Pattern.test(packageEvidence.installer.sha256)) {
        blockers.push(createBlocker('PACKAGE_INSTALLER_CHECKSUM_INVALID', `Installer SHA-256 is invalid for ${packageId}.`, { packageId }));
      }
    }

    if (!packageTrustEvidenceReady(packageEvidence)) {
      blockers.push(createBlocker('PACKAGE_TRUST_EVIDENCE_NOT_READY', `Platform trust evidence is not ready for ${packageId}.`, { packageId }));
    }

    if (!packageSbomEvidenceReady(packageEvidence.sbom)) {
      blockers.push(createBlocker('PACKAGE_SBOM_EVIDENCE_MISSING', `SBOM evidence is missing or invalid for ${packageId}.`, { packageId }));
    }
  }

  return blockers;
}

function dedupeBlockers(blockers) {
  const seen = new Set();
  const deduped = [];
  for (const blocker of blockers) {
    const key = [
      blocker.code,
      blocker.platform ?? '',
      blocker.packageId ?? '',
      blocker.sourceCode ?? '',
      blocker.message ?? '',
    ].join('\u0000');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(blocker);
  }
  return deduped;
}

function packageTrustEvidenceReady(packageEvidence) {
  const trust = packageEvidence.trustEvidence;
  if (!trust || trust.status !== 'verified' || trust.signed !== true || !trust.evidencePath) {
    return false;
  }
  const status = String(trust.signatureStatus ?? '').toLowerCase();
  if (packageEvidence.platform === 'windows-x86_64') {
    return status === 'valid' || status === 'verified';
  }
  if (packageEvidence.platform === 'linux-x86_64') {
    return ['verified', 'valid', 'policy-verified'].includes(status);
  }
  if (packageEvidence.platform.startsWith('macos-')) {
    const notarizationStatus = String(trust.notarizationStatus ?? '').toLowerCase();
    return ['valid', 'verified'].includes(status) && ['notarized', 'accepted', 'verified'].includes(notarizationStatus);
  }
  return false;
}

function packageSbomEvidenceReady(sbom) {
  if (!sbom) {
    return false;
  }
  const format = String(sbom.format ?? '').toLowerCase();
  return (
    ['cyclonedx', 'spdx'].includes(format) &&
    Boolean(sbom.url || sbom.path) &&
    sha256Pattern.test(String(sbom.sha256 ?? ''))
  );
}

function applyEvidenceToManifest(manifest, evidenceByPackage, { activateCommercial }) {
  const cloned = structuredClone(manifest);
  const evidenceByPackageId = new Map(evidenceByPackage.map((entry) => [entry.packageId, entry]));
  const packages = cloned.artifacts.installConfig.packages;

  for (const appPackage of packages) {
    const evidence = evidenceByPackageId.get(appPackage.id);
    if (!evidence) {
      continue;
    }
    appPackage.enabled = Boolean(activateCommercial);
    appPackage.checksumAlgorithm = 'SHA-256';
    appPackage.checksum = evidence.installer.sha256;
    appPackage.sizeBytes = evidence.installer.byteSize;
    appPackage.metadata = {
      ...(appPackage.metadata ?? {}),
      releaseAsset: true,
      releaseEvidence: {
        platform: evidence.platform,
        installerKind: evidence.kind,
        path: evidence.installer.path,
        syncedAtSchemaVersion: syncSchemaVersion,
      },
      trustEvidence: evidence.trustEvidence,
      sbom: evidence.sbom,
    };
    delete appPackage.metadata.commercialActivationRequired;
    delete appPackage.metadata.generatedPlaceholder;
  }

  if (activateCommercial) {
    cloned.publish.status = 'ACTIVE';
    for (const note of Array.isArray(cloned.release?.notes) ? cloned.release.notes : []) {
      if (note?.current === true) {
        note.metadata = {
          ...(note.metadata ?? {}),
          previewRelease: false,
        };
        delete note.metadata.commercialActivationRequired;
      }
    }
  }

  return cloned;
}

function createBlocker(code, message, extra = {}) {
  return {
    ...extra,
    code,
    message,
  };
}

function readJsonFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`missing ${label}: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFileAtomic(filePath, payload) {
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
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
        commandName: 'AutoCut app manifest release evidence sync',
      });
      options.manifestPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--evidence-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut app manifest release evidence sync',
      });
      options.evidenceDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--sbom') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut app manifest release evidence sync',
      });
      options.sbomEvidencePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--activate-commercial') {
      options.activateCommercial = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--allow-blocked') {
      options.allowBlocked = true;
    } else {
      throw new Error(`Unknown AutoCut app manifest release evidence sync argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = syncAutoCutAppManifestReleaseEvidence(options);
  console.log(formatAutoCutAppManifestReleaseEvidenceSyncMessage(result));
  if (!result.commercialActivationReady) {
    for (const blocker of result.blockers) {
      console.error(`${blocker.packageId ? `${blocker.packageId}:` : blocker.platform ? `${blocker.platform}:` : ''}${blocker.code}: ${blocker.message}`);
    }
    if (!options.allowBlocked) {
      process.exit(1);
    }
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
