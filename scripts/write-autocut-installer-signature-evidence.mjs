#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import {
  createAutoCutReleaseInstallerSpecs,
  normalizeAutoCutReleasePlatform,
} from './autocut-release-platforms.mjs';

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-05.autocut-installer-signature-evidence.v1';
const defaultOutputRelativePath = 'artifacts/release/autocut-installer-signature-evidence.json';

export function createAutoCutInstallerSignatureEvidence({
  rootDir = process.cwd(),
  platform = 'windows-x86_64',
  generatedAt = new Date().toISOString(),
  runCommand = runAutoCutInstallerSignatureCommand,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const normalizedPlatform = normalizeAutoCutReleasePlatform(platform);
  const installers = createAutoCutReleaseInstallerSpecs({
    rootDir: resolvedRootDir,
    platform: normalizedPlatform,
  }).map((spec) =>
    createInstallerSignatureSnapshot({ rootDir: resolvedRootDir, spec, runCommand }),
  );
  const blockers = installers
    .filter((installer) => !installer.signatureReady)
    .map((installer) => ({
      code: createInstallerSignatureBlockerCode(normalizedPlatform, installer),
      installerKind: installer.kind,
      path: installer.path,
      message: createInstallerSignatureBlockerMessage(normalizedPlatform, installer),
    }));

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    platform: normalizedPlatform,
    readiness: {
      installerSignatureReady: blockers.length === 0,
    },
    verification: {
      platform: normalizedPlatform,
      hostPlatform: process.platform,
      method: installerSignatureMethod(normalizedPlatform),
    },
    installers,
    blockers,
  };
}

export function writeAutoCutInstallerSignatureEvidence({
  rootDir = process.cwd(),
  outputPath,
  ...options
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultOutputRelativePath),
  );
  const evidence = createAutoCutInstallerSignatureEvidence({
    rootDir: resolvedRootDir,
    ...options,
  });
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    evidence,
  };
}

export function formatAutoCutInstallerSignatureEvidenceMessage(result) {
  return [
    `ok - autocut installer signature evidence ${result.outputPath}`,
    `installerSignatureReady=${result.evidence.readiness.installerSignatureReady}`,
    `blockers=${result.evidence.blockers.length}`,
  ].join(' ');
}

export function runAutoCutInstallerSignatureCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: '',
      stderr: result.error.message,
    };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function createInstallerSignatureSnapshot({ rootDir, spec, runCommand }) {
  const exists = fs.existsSync(spec.absolutePath) && fs.statSync(spec.absolutePath).isFile();
  const pathRelative = toPosixRelative(rootDir, spec.absolutePath);
  if (!exists) {
    return {
      kind: spec.kind,
      path: pathRelative,
      exists: false,
      byteSize: 0,
      sha256: '',
      signatureReady: false,
      signatureStatus: 'missing',
      signer: '',
      diagnostics: [`missing installer: ${spec.absolutePath}`],
    };
  }

  const bytes = fs.readFileSync(spec.absolutePath);
  const signature = inspectInstallerSignature(spec, runCommand);
  return {
    kind: spec.kind,
    path: pathRelative,
    exists: true,
    byteSize: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    signatureReady: signature.ready,
    signatureStatus: signature.status,
    notarizationStatus: signature.notarizationStatus,
    signer: signature.signer,
    diagnostics: signature.diagnostics,
  };
}

function inspectInstallerSignature(spec, runCommand) {
  if (spec.platform === 'linux-x86_64') {
    return {
      ready: false,
      status: 'unsigned-preview',
      notarizationStatus: 'not-applicable',
      signer: '',
      diagnostics: [
        'Linux preview installer evidence records artifact digest only. Commercial release requires a signed package/repository policy and install smoke.',
      ],
    };
  }
  if (spec.platform.startsWith('macos-')) {
    return {
      ready: false,
      status: 'unsigned-preview',
      notarizationStatus: 'not-notarized',
      signer: '',
      diagnostics: [
        'macOS preview installer evidence records artifact digest only. Commercial release requires Developer ID signing, Gatekeeper assessment, and notarization.',
      ],
    };
  }

  const command = 'powershell';
  const literalInstallerPath = toPowerShellSingleQuotedString(spec.absolutePath);
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      `$signature = Get-AuthenticodeSignature -LiteralPath ${literalInstallerPath};`,
      '$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { "" };',
      'Write-Output ("Status=" + $signature.Status);',
      'Write-Output ("Signer=" + $subject);',
    ].join(' '),
  ];
  const result = runCommand(command, args);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const status = readSignatureOutputField(output, 'Status') ?? 'Unknown';
  const signer = readSignatureOutputField(output, 'Signer') ?? extractSigner(output);
  return {
    ready: result.status === 0 && status === 'Valid',
    status,
    notarizationStatus: 'not-applicable',
    signer,
    diagnostics: output ? [trimDiagnostics(output)] : [],
  };
}

function extractSigner(output) {
  const signerMatch = output.match(/SignerCertificate:\s*(.+)/u);
  return signerMatch ? signerMatch[1].trim() : '';
}

function readSignatureOutputField(output, fieldName) {
  const prefix = `${fieldName}=`;
  const colonPrefix = `${fieldName}:`;
  const line = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix) || entry.startsWith(colonPrefix));
  if (!line) {
    return undefined;
  }
  const separator = line.startsWith(prefix) ? prefix : colonPrefix;
  return line.slice(separator.length).trim();
}

function toPowerShellSingleQuotedString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function installerSignatureMethod(platform) {
  if (platform === 'windows-x86_64') {
    return 'powershell-Get-AuthenticodeSignature';
  }
  if (platform === 'linux-x86_64') {
    return 'unsigned-linux-preview-artifact-digest';
  }
  return 'unsigned-macos-preview-codesign-notarytool-required';
}

function createInstallerSignatureBlockerCode(platform, installer) {
  if (!installer.exists) {
    return 'INSTALLER_MISSING';
  }
  if (platform === 'linux-x86_64') {
    return 'LINUX_INSTALLER_SIGNATURE_NOT_CONFIGURED';
  }
  if (platform.startsWith('macos-')) {
    return 'MACOS_INSTALLER_NOT_SIGNED_OR_NOTARIZED';
  }
  return 'INSTALLER_SIGNATURE_MISSING';
}

function createInstallerSignatureBlockerMessage(platform, installer) {
  if (!installer.exists) {
    return `AutoCut ${installer.kind} installer is missing.`;
  }
  if (platform === 'linux-x86_64') {
    return `AutoCut ${installer.kind} installer has no commercial Linux package signing/install-smoke evidence.`;
  }
  if (platform.startsWith('macos-')) {
    return `AutoCut ${installer.kind} installer is not Developer ID signed and notarized.`;
  }
  return `AutoCut ${installer.kind} installer is not signed or the signature cannot be verified.`;
}

function trimDiagnostics(value) {
  const maxLength = 4000;
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[autocut-signature-diagnostics-truncated]`;
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signature evidence',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signature evidence',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut installer signature evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutInstallerSignatureEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutInstallerSignatureEvidenceMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
