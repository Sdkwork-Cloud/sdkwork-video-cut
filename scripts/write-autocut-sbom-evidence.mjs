#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import { readAutoCutReleaseVersion } from './autocut-release-platforms.mjs';

const __filename = fileURLToPath(import.meta.url);
const sbomEvidenceSchemaVersion = '2026-05-08.autocut-sbom-evidence.v1';
const defaultSbomDirRelativePath = 'artifacts/release/sbom';
const defaultOutputRelativePath = 'artifacts/release/autocut-sbom-evidence.json';
const defaultReleaseRepositoryUrl = 'https://github.com/Sdkwork-Cloud/sdkwork-video-cut';
const sbomFileSuffixes = ['.cdx.json', '.cyclonedx.json', '.spdx.json', '.sbom.json'];
const packageIds = [
  'windows-x64-desktop-msi',
  'windows-x64-desktop-exe',
  'linux-debian-x64-desktop-deb',
  'linux-x64-desktop-appimage',
  'macos-x64-desktop-dmg',
  'macos-arm64-desktop-dmg',
];

export function createAutoCutSbomEvidence({
  rootDir = process.cwd(),
  sbomDir,
  releaseTag,
  releaseRepositoryUrl = defaultReleaseRepositoryUrl,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedSbomDir = path.resolve(sbomDir ?? path.join(resolvedRootDir, defaultSbomDirRelativePath));
  const normalizedReleaseTag = normalizeReleaseTag(releaseTag ?? `v${readAutoCutReleaseVersion(resolvedRootDir)}`);
  const normalizedRepositoryUrl = String(releaseRepositoryUrl ?? defaultReleaseRepositoryUrl).replace(/\/+$/u, '');
  const packageIdSet = new Set(packageIds);
  const blockers = [];
  const candidatesByPackageId = new Map(packageIds.map((packageId) => [packageId, []]));

  for (const candidatePath of listSbomCandidateFiles(resolvedSbomDir)) {
    const packageId = packageIdFromSbomFileName(path.basename(candidatePath));
    const relativeCandidatePath = toPosixRelative(resolvedRootDir, candidatePath);
    if (!packageId) {
      continue;
    }
    if (!packageIdSet.has(packageId)) {
      blockers.push(
        createBlocker(
          'PACKAGE_SBOM_UNKNOWN_PACKAGE_ID',
          `SBOM file ${relativeCandidatePath} does not match an AutoCut desktop release package id.`,
          {
            packageId,
            path: relativeCandidatePath,
          },
        ),
      );
      continue;
    }
    candidatesByPackageId.get(packageId).push(candidatePath);
  }

  const packages = [];
  for (const packageId of packageIds) {
    const candidates = candidatesByPackageId.get(packageId);
    if (candidates.length === 0) {
      blockers.push(
        createBlocker(
          'PACKAGE_SBOM_MISSING',
          `Missing SBOM file for ${packageId} in ${toPosixRelative(resolvedRootDir, resolvedSbomDir)}.`,
          { packageId },
        ),
      );
      continue;
    }
    if (candidates.length > 1) {
      blockers.push(
        createBlocker(
          'PACKAGE_SBOM_MULTIPLE_CANDIDATES',
          `Multiple SBOM files were found for ${packageId}; keep exactly one SBOM per release package.`,
          {
            packageId,
            paths: candidates.map((candidatePath) => toPosixRelative(resolvedRootDir, candidatePath)),
          },
        ),
      );
      continue;
    }

    const packageEvidence = createPackageSbomEvidence({
      rootDir: resolvedRootDir,
      filePath: candidates[0],
      packageId,
      releaseTag: normalizedReleaseTag,
      releaseRepositoryUrl: normalizedRepositoryUrl,
    });
    if (packageEvidence.blocker) {
      blockers.push(packageEvidence.blocker);
    } else {
      packages.push(packageEvidence.package);
    }
  }

  packages.sort((left, right) => packageIds.indexOf(left.packageId) - packageIds.indexOf(right.packageId));
  return {
    schemaVersion: sbomEvidenceSchemaVersion,
    generatedAt,
    releaseTag: normalizedReleaseTag,
    sbomDir: toPosixRelative(resolvedRootDir, resolvedSbomDir),
    readiness: {
      sbomReady: packages.length === packageIds.length && blockers.length === 0,
    },
    summary: {
      packageCount: packageIds.length,
      readyPackageCount: packages.length,
      blockerCount: blockers.length,
    },
    packages,
    blockers,
  };
}

export function writeAutoCutSbomEvidence({
  rootDir = process.cwd(),
  outputPath,
  allowBlocked = false,
  ...options
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const evidence = createAutoCutSbomEvidence({
    rootDir: resolvedRootDir,
    ...options,
  });
  if (evidence.readiness.sbomReady !== true && allowBlocked !== true) {
    throw new Error(
      [
        `AutoCut SBOM evidence is blocked with ${evidence.summary.blockerCount} blocker(s).`,
        ...evidence.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`),
      ].join('\n'),
    );
  }
  const resolvedOutputPath = path.resolve(outputPath ?? path.join(resolvedRootDir, defaultOutputRelativePath));
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    evidence,
  };
}

export function formatAutoCutSbomEvidenceMessage(result) {
  const status = result.evidence.readiness.sbomReady === true ? 'ok' : 'blocked';
  return `${status} - autocut SBOM evidence ${result.outputPath} packages=${result.evidence.summary.readyPackageCount} blockers=${result.evidence.summary.blockerCount}`;
}

function createPackageSbomEvidence({
  rootDir,
  filePath,
  packageId,
  releaseTag,
  releaseRepositoryUrl,
}) {
  const relativeFilePath = toPosixRelative(rootDir, filePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return {
      blocker: createBlocker('PACKAGE_SBOM_MISSING', `SBOM path is not a file for ${packageId}: ${relativeFilePath}.`, {
        packageId,
        path: relativeFilePath,
      }),
    };
  }
  if (stat.size <= 0) {
    return {
      blocker: createBlocker('PACKAGE_SBOM_FILE_EMPTY', `SBOM file is empty for ${packageId}: ${relativeFilePath}.`, {
        packageId,
        path: relativeFilePath,
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      blocker: createBlocker(
        'PACKAGE_SBOM_JSON_INVALID',
        `SBOM file is not valid JSON for ${packageId}: ${relativeFilePath}. ${error instanceof Error ? error.message : String(error)}`,
        {
          packageId,
          path: relativeFilePath,
        },
      ),
    };
  }

  const format = detectSbomFormat(filePath, payload);
  if (!format) {
    return {
      blocker: createBlocker(
        'PACKAGE_SBOM_FORMAT_UNSUPPORTED',
        `SBOM file must be CycloneDX JSON or SPDX JSON for ${packageId}: ${relativeFilePath}.`,
        {
          packageId,
          path: relativeFilePath,
        },
      ),
    };
  }

  const bytes = fs.readFileSync(filePath);
  return {
    package: {
      packageId,
      format,
      path: relativeFilePath,
      url: `${releaseRepositoryUrl}/releases/download/${releaseTag}/${encodeURIComponent(path.basename(filePath))}`,
      byteSize: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function detectSbomFormat(filePath, payload) {
  const fileName = path.basename(filePath).toLowerCase();
  const bomFormat = String(payload?.bomFormat ?? '').toLowerCase();
  const spdxVersion = String(payload?.spdxVersion ?? '');
  const looksCycloneDx = bomFormat === 'cyclonedx' && typeof payload?.specVersion === 'string';
  const looksSpdx = spdxVersion.startsWith('SPDX-') && typeof payload?.SPDXID === 'string';

  if ((fileName.endsWith('.cdx.json') || fileName.endsWith('.cyclonedx.json')) && looksCycloneDx) {
    return 'CycloneDX';
  }
  if (fileName.endsWith('.spdx.json') && looksSpdx) {
    return 'SPDX';
  }
  if (fileName.endsWith('.sbom.json')) {
    if (looksCycloneDx) {
      return 'CycloneDX';
    }
    if (looksSpdx) {
      return 'SPDX';
    }
  }
  return '';
}

function listSbomCandidateFiles(sbomDir) {
  if (!fs.existsSync(sbomDir) || !fs.statSync(sbomDir).isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(sbomDir, { withFileTypes: true })) {
    const entryPath = path.join(sbomDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSbomCandidateFiles(entryPath));
    } else if (entry.isFile() && packageIdFromSbomFileName(entry.name)) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function packageIdFromSbomFileName(fileName) {
  const normalized = fileName.toLowerCase();
  const suffix = sbomFileSuffixes.find((candidate) => normalized.endsWith(candidate));
  return suffix ? normalized.slice(0, -suffix.length) : '';
}

function normalizeReleaseTag(releaseTag) {
  const normalized = String(releaseTag ?? '').trim();
  if (!normalized) {
    throw new Error('AutoCut SBOM evidence release tag is required.');
  }
  return normalized;
}

function createBlocker(code, message, extra = {}) {
  return {
    ...extra,
    code,
    message,
  };
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--sbom-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut SBOM evidence',
      });
      options.sbomDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut SBOM evidence',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--release-tag') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut SBOM evidence',
      });
      options.releaseTag = option.value;
      index = option.nextIndex;
    } else if (arg === '--release-repository-url') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut SBOM evidence',
      });
      options.releaseRepositoryUrl = option.value;
      index = option.nextIndex;
    } else if (arg === '--allow-blocked') {
      options.allowBlocked = true;
    } else {
      throw new Error(`Unknown AutoCut SBOM evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutSbomEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutSbomEvidenceMessage(result));
  if (result.evidence.readiness.sbomReady !== true) {
    for (const blocker of result.evidence.blockers) {
      console.error(`${blocker.packageId ? `${blocker.packageId}:` : ''}${blocker.code}: ${blocker.message}`);
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
