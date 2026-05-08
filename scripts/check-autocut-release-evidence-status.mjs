#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import {
  createAutoCutAppManifestReleaseReadinessReport,
} from './check-autocut-app-manifest-release-readiness.mjs';
import {
  createAutoCutCommercialReleaseReadinessReport,
} from './check-autocut-commercial-release-readiness.mjs';
import {
  createAutoCutReleaseEnvironmentReport,
} from './check-autocut-release-environment.mjs';
import {
  createAutoCutMultiplatformReleaseReadinessReport,
} from './check-autocut-multiplatform-release-readiness.mjs';
import {
  syncAutoCutAppManifestReleaseEvidence,
} from './sync-autocut-app-manifest-release-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const statusSchemaVersion = '2026-05-08.autocut-release-evidence-status.v1';
const defaultEvidenceDirRelativePath = 'artifacts/release';
const defaultSbomEvidenceRelativePath = 'artifacts/release/autocut-sbom-evidence.json';
const defaultReleaseTag = 'v0.1.3';
const defaultRepository = 'Sdkwork-Cloud/sdkwork-video-cut';

export function createAutoCutReleaseEvidenceStatusReport({
  rootDir = process.cwd(),
  evidenceDir,
  manifestPath,
  sbomEvidencePath,
  releaseTag = defaultReleaseTag,
  repository = defaultRepository,
  generatedAt = new Date().toISOString(),
  releaseEnvironmentReport,
  requireCleanWorktree = true,
  includeWindowsInstallerService = process.platform === 'win32',
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedEvidenceDir = path.resolve(
    evidenceDir ?? path.join(resolvedRootDir, defaultEvidenceDirRelativePath),
  );
  const resolvedSbomEvidencePath = path.resolve(
    sbomEvidencePath ?? path.join(resolvedRootDir, defaultSbomEvidenceRelativePath),
  );
  const normalizedReleaseTag = normalizeReleaseTag(releaseTag);

  const environmentReport =
    releaseEnvironmentReport ??
    createAutoCutReleaseEnvironmentReport({
      rootDir: resolvedRootDir,
      releaseTag: normalizedReleaseTag,
      repository,
      requireCleanWorktree,
      includeWindowsInstallerService,
    });
  const multiplatformReport = createAutoCutMultiplatformReleaseReadinessReport({
    rootDir: resolvedRootDir,
    evidenceDir: resolvedEvidenceDir,
    generatedAt,
  });
  const sbomEvidenceReport = readSbomEvidenceStatus({
    rootDir: resolvedRootDir,
    sbomEvidencePath: resolvedSbomEvidencePath,
  });
  const manifestSyncResult = syncAutoCutAppManifestReleaseEvidence({
    rootDir: resolvedRootDir,
    evidenceDir: resolvedEvidenceDir,
    sbomEvidencePath: resolvedSbomEvidencePath,
    manifestPath,
    dryRun: true,
    generatedAt,
  });
  const manifestReadinessReport = createAutoCutAppManifestReleaseReadinessReport({
    rootDir: resolvedRootDir,
    manifestPath,
    generatedAt,
  });
  const commercialReadinessReport = createAutoCutCommercialReleaseReadinessReport({
    rootDir: resolvedRootDir,
    evidenceDir: resolvedEvidenceDir,
    generatedAt,
  });

  const domains = [
    createReleaseEnvironmentDomain(environmentReport),
    createPlatformEvidenceDomain(multiplatformReport),
    createSbomEvidenceDomain(sbomEvidenceReport),
    createManifestSyncDomain(manifestSyncResult),
    createManifestReadinessDomain(manifestReadinessReport),
    createMultiplatformPreviewDomain(multiplatformReport),
    createCommercialReleaseDomain(commercialReadinessReport),
  ];
  const blockers = domains.flatMap((domain) => domain.blockers);
  const warnings = domains.flatMap((domain) => domain.warnings);
  const readyDomainCount = domains.filter((domain) => domain.ready).length;

  return {
    schemaVersion: statusSchemaVersion,
    generatedAt,
    releaseTag: normalizedReleaseTag,
    repository,
    evidenceDir: toPosixRelative(resolvedRootDir, resolvedEvidenceDir),
    sbomEvidencePath: toPosixRelative(resolvedRootDir, resolvedSbomEvidencePath),
    releaseEvidenceStatusReady: blockers.length === 0,
    summary: {
      domainCount: domains.length,
      readyDomainCount,
      blockerCount: blockers.length,
      warningCount: warnings.length,
    },
    domains: domains.map(({ blockers: _blockers, warnings: _warnings, ...domain }) => domain),
    blockers,
    warnings,
    nextActions: createNextActions({
      releaseTag: normalizedReleaseTag,
      domains,
    }),
  };
}

export function formatAutoCutReleaseEvidenceStatusMessage(report) {
  const status = report.releaseEvidenceStatusReady ? 'ok' : 'blocked';
  return [
    `${status} - autocut release evidence status`,
    `domains=${report.summary.readyDomainCount}/${report.summary.domainCount}`,
    `blockers=${report.summary.blockerCount}`,
    `releaseTag=${report.releaseTag}`,
  ].join(' ');
}

function createReleaseEnvironmentDomain(report) {
  const blockers = Array.isArray(report.blockers)
    ? report.blockers.map((blocker) =>
        createDomainBlocker('release-environment', {
          code: blocker.code,
          message: blocker.diagnostic,
          check: blocker.check,
          remediation: blocker.remediation,
        }),
      )
    : [];
  return createDomain({
    id: 'release-environment',
    label: 'Release Environment',
    ready: report.ready === true,
    blockers,
    summary: {
      checkCount: report.checks ? Object.keys(report.checks).length : 0,
      releaseTag: report.releaseTag,
    },
  });
}

function createPlatformEvidenceDomain(report) {
  const blockers = Array.isArray(report.blockers)
    ? report.blockers.map((blocker) =>
        createDomainBlocker('platform-release-evidence', {
          platform: blocker.platform,
          code: blocker.code,
          message: blocker.message,
        }),
      )
    : [];
  return createDomain({
    id: 'platform-release-evidence',
    label: 'Platform Release Evidence',
    ready: report.multiplatformReleaseReady === true,
    blockers,
    warnings: mapDomainWarnings('platform-release-evidence', report.warnings),
    summary: report.summary,
  });
}

function createSbomEvidenceDomain(report) {
  const blockers = report.blockers.map((blocker) =>
    createDomainBlocker('sbom-evidence', {
      packageId: blocker.packageId,
      code: blocker.code,
      message: blocker.message,
      sourceCode: blocker.sourceCode,
    }),
  );
  return createDomain({
    id: 'sbom-evidence',
    label: 'SBOM Evidence',
    ready: report.ready,
    blockers,
    summary: report.summary,
  });
}

function createManifestSyncDomain(result) {
  const blockers = Array.isArray(result.blockers)
    ? result.blockers.map((blocker) =>
        createDomainBlocker('app-manifest-sync', {
          platform: blocker.platform,
          packageId: blocker.packageId,
          code: blocker.code,
          sourceCode: blocker.sourceCode,
          message: blocker.message,
        }),
      )
    : [];
  return createDomain({
    id: 'app-manifest-sync',
    label: 'App Manifest Evidence Sync',
    ready: result.commercialActivationReady === true,
    blockers,
    summary: result.summary,
  });
}

function createManifestReadinessDomain(report) {
  const blockers = Array.isArray(report.blockers)
    ? report.blockers.map((blocker) =>
        createDomainBlocker('app-manifest-readiness', {
          packageId: blocker.packageId,
          code: blocker.code,
          message: blocker.message,
        }),
      )
    : [];
  return createDomain({
    id: 'app-manifest-readiness',
    label: 'App Manifest Readiness',
    ready: report.manifestReleaseReady === true,
    blockers,
    warnings: mapDomainWarnings('app-manifest-readiness', report.warnings),
    summary: report.summary,
  });
}

function createMultiplatformPreviewDomain(report) {
  const blockers = Array.isArray(report.blockers)
    ? report.blockers.map((blocker) =>
        createDomainBlocker('multiplatform-preview-readiness', {
          platform: blocker.platform,
          code: blocker.code,
          message: blocker.message,
        }),
      )
    : [];
  return createDomain({
    id: 'multiplatform-preview-readiness',
    label: 'Multiplatform Preview Readiness',
    ready: report.multiplatformReleaseReady === true,
    blockers,
    warnings: mapDomainWarnings('multiplatform-preview-readiness', report.warnings),
    summary: report.summary,
  });
}

function createCommercialReleaseDomain(report) {
  const blockers = Array.isArray(report.blockers)
    ? report.blockers.map((blocker) =>
        createDomainBlocker('commercial-release-readiness', {
          platform: blocker.platform,
          code: blocker.code,
          message: blocker.message,
          remediation: blocker.remediation,
        }),
      )
    : [];
  return createDomain({
    id: 'commercial-release-readiness',
    label: 'Commercial Release Readiness',
    ready: report.commercialReleaseReady === true,
    blockers,
    summary: report.summary ?? { mode: report.mode },
  });
}

function readSbomEvidenceStatus({ rootDir, sbomEvidencePath }) {
  if (!fs.existsSync(sbomEvidencePath) || !fs.statSync(sbomEvidencePath).isFile()) {
    return {
      ready: false,
      summary: {
        packageCount: 6,
        readyPackageCount: 0,
        blockerCount: 1,
      },
      blockers: [
        {
          code: 'SBOM_EVIDENCE_MISSING',
          message: `Missing AutoCut SBOM evidence: ${toPosixRelative(rootDir, sbomEvidencePath)}.`,
        },
      ],
    };
  }

  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(sbomEvidencePath, 'utf8'));
  } catch (error) {
    return {
      ready: false,
      summary: {
        packageCount: 6,
        readyPackageCount: 0,
        blockerCount: 1,
      },
      blockers: [
        {
          code: 'SBOM_EVIDENCE_JSON_INVALID',
          message: `AutoCut SBOM evidence JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  if (evidence.schemaVersion !== '2026-05-08.autocut-sbom-evidence.v1') {
    return {
      ready: false,
      summary: {
        packageCount: 6,
        readyPackageCount: 0,
        blockerCount: 1,
      },
      blockers: [
        {
          code: 'SBOM_EVIDENCE_SCHEMA_UNSUPPORTED',
          message: `Unsupported AutoCut SBOM evidence schema: ${evidence.schemaVersion}.`,
        },
      ],
    };
  }

  const blockers = [];
  if (evidence.readiness?.sbomReady !== true) {
    blockers.push({
      code: 'SBOM_EVIDENCE_NOT_READY',
      message: 'AutoCut SBOM evidence is not ready.',
    });
  }
  for (const blocker of Array.isArray(evidence.blockers) ? evidence.blockers : []) {
    blockers.push({
      packageId: blocker?.packageId ? String(blocker.packageId) : undefined,
      sourceCode: blocker?.code ? String(blocker.code) : undefined,
      code: blocker?.code ? String(blocker.code) : 'SBOM_EVIDENCE_BLOCKER',
      message: String(blocker?.message ?? 'AutoCut SBOM evidence blocker.'),
    });
  }

  return {
    ready: evidence.readiness?.sbomReady === true && blockers.length === 0,
    summary: evidence.summary ?? {
      packageCount: Array.isArray(evidence.packages) ? evidence.packages.length : 0,
      readyPackageCount: Array.isArray(evidence.packages) ? evidence.packages.length : 0,
      blockerCount: blockers.length,
    },
    blockers,
  };
}

function createDomain({ id, label, ready, blockers = [], warnings = [], summary = {} }) {
  return {
    id,
    label,
    ready: Boolean(ready),
    blockerCount: blockers.length,
    warningCount: warnings.length,
    summary,
    blockers,
    warnings,
  };
}

function createDomainBlocker(domain, blocker) {
  return {
    domain,
    ...(blocker.platform ? { platform: blocker.platform } : {}),
    ...(blocker.packageId ? { packageId: blocker.packageId } : {}),
    ...(blocker.check ? { check: blocker.check } : {}),
    ...(blocker.sourceCode ? { sourceCode: blocker.sourceCode } : {}),
    code: String(blocker.code ?? 'UNKNOWN_BLOCKER'),
    message: String(blocker.message ?? blocker.diagnostic ?? 'Release evidence status blocker.'),
    ...(blocker.remediation ? { remediation: blocker.remediation } : {}),
  };
}

function mapDomainWarnings(domain, warnings) {
  return Array.isArray(warnings)
    ? warnings.map((warning) => ({
        domain,
        ...(warning.platform ? { platform: warning.platform } : {}),
        code: String(warning.code ?? 'UNKNOWN_WARNING'),
        message: String(warning.message ?? 'Release evidence status warning.'),
        ...(warning.remediation ? { remediation: warning.remediation } : {}),
      }))
    : [];
}

function createNextActions({ releaseTag, domains }) {
  const commandByDomain = {
    'release-environment': `pnpm release:environment -- --release-tag ${releaseTag} --json`,
    'platform-release-evidence': 'pnpm release:evidence -- --platform <platform> --output artifacts/release/autocut-release-evidence-<platform>.json',
    'sbom-evidence': `pnpm release:package-sbom && pnpm release:sbom-evidence -- --release-tag ${releaseTag}`,
    'app-manifest-sync': 'pnpm release:sync-app-manifest -- --dry-run --allow-blocked',
    'app-manifest-readiness': 'pnpm release:app-manifest-ready',
    'multiplatform-preview-readiness': 'pnpm release:multiplatform-ready',
    'commercial-release-readiness': 'pnpm release:sync-app-manifest -- --activate-commercial && pnpm release:commercial-ready',
  };
  return domains
    .filter((domain) => !domain.ready)
    .map((domain) => ({
      domain: domain.id,
      command: commandByDomain[domain.id],
      blockerCount: domain.blockerCount,
    }));
}

function normalizeReleaseTag(releaseTag) {
  const normalized = String(releaseTag ?? '').trim();
  if (!normalized) {
    throw new Error('AutoCut release evidence status requires a release tag.');
  }
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(normalized)) {
    throw new Error(`AutoCut release evidence status requires a semver tag like v0.1.3, got ${normalized}.`);
  }
  return normalized;
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--release-tag') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence status',
      });
      options.releaseTag = option.value;
      index = option.nextIndex;
    } else if (arg === '--repo') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence status',
      });
      options.repository = option.value;
      index = option.nextIndex;
    } else if (arg === '--evidence-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence status',
      });
      options.evidenceDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--manifest') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence status',
      });
      options.manifestPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--sbom') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence status',
      });
      options.sbomEvidencePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--allow-dirty') {
      options.requireCleanWorktree = false;
    } else if (arg === '--skip-windows-installer-service') {
      options.includeWindowsInstallerService = false;
    } else if (arg === '--allow-blocked') {
      options.allowBlocked = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown AutoCut release evidence status argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const { allowBlocked, json, ...options } = parseArgs(process.argv.slice(2));
  const report = createAutoCutReleaseEvidenceStatusReport(options);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAutoCutReleaseEvidenceStatusMessage(report));
    for (const warning of report.warnings) {
      console.error(`${warning.domain}:${warning.code}: ${warning.message}`);
    }
    for (const blocker of report.blockers) {
      const subject = blocker.packageId ? blocker.packageId : blocker.platform ? blocker.platform : blocker.check ?? blocker.domain;
      console.error(`${blocker.domain}:${subject}:${blocker.code}: ${blocker.message}`);
    }
    if (!report.releaseEvidenceStatusReady) {
      for (const action of report.nextActions) {
        console.error(`next:${action.domain}: ${action.command}`);
      }
    }
  }
  if (!report.releaseEvidenceStatusReady && allowBlocked !== true) {
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
