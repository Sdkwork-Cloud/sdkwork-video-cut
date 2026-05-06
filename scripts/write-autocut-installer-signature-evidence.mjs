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

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-05.autocut-installer-signature-evidence.v1';
const bundleRelativeRoot = 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle';
const defaultOutputRelativePath = 'artifacts/release/autocut-installer-signature-evidence.json';

export function createAutoCutInstallerSignatureEvidence({
  rootDir = process.cwd(),
  generatedAt = new Date().toISOString(),
  runCommand = runAutoCutInstallerSignatureCommand,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const installers = installerSpecs(resolvedRootDir).map((spec) =>
    createInstallerSignatureSnapshot({ rootDir: resolvedRootDir, spec, runCommand }),
  );
  const blockers = installers
    .filter((installer) => !installer.signatureReady)
    .map((installer) => ({
      code: installer.exists ? 'INSTALLER_SIGNATURE_MISSING' : 'INSTALLER_MISSING',
      installerKind: installer.kind,
      path: installer.path,
      message: installer.exists
        ? `AutoCut ${installer.kind} installer is not signed or the signature cannot be verified.`
        : `AutoCut ${installer.kind} installer is missing.`,
    }));

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    readiness: {
      installerSignatureReady: blockers.length === 0,
    },
    verification: {
      platform: process.platform,
      method: process.platform === 'win32' ? 'powershell-Get-AuthenticodeSignature' : 'unsupported-host-signed-evidence-required',
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
  const signature = inspectInstallerSignature(spec.absolutePath, runCommand);
  return {
    kind: spec.kind,
    path: pathRelative,
    exists: true,
    byteSize: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    signatureReady: signature.ready,
    signatureStatus: signature.status,
    signer: signature.signer,
    diagnostics: signature.diagnostics,
  };
}

function inspectInstallerSignature(installerPath, runCommand) {
  const command = 'powershell';
  const literalInstallerPath = toPowerShellSingleQuotedString(installerPath);
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

function installerSpecs(rootDir) {
  const bundleRoot = path.join(rootDir, bundleRelativeRoot);
  return [
    {
      kind: 'msi',
      absolutePath: path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi'),
    },
    {
      kind: 'nsis',
      absolutePath: path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe'),
    },
  ];
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
