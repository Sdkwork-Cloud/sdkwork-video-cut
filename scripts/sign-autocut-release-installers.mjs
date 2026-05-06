#!/usr/bin/env node

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
const bundleRelativeRoot = 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle';
const defaultTimestampUrl = 'http://timestamp.digicert.com';
const defaultSignToolPath = 'signtool.exe';

export function createAutoCutInstallerSigningPlan({
  rootDir = process.cwd(),
  certificatePath = process.env.SDKWORK_AUTOCUT_WINDOWS_SIGNING_PFX,
  certificatePassword = process.env.SDKWORK_AUTOCUT_WINDOWS_SIGNING_PASSWORD,
  certificateThumbprint = process.env.SDKWORK_AUTOCUT_WINDOWS_SIGNING_THUMBPRINT,
  timestampUrl = process.env.SDKWORK_AUTOCUT_WINDOWS_SIGNING_TIMESTAMP_URL ?? defaultTimestampUrl,
  signToolPath = process.env.SDKWORK_AUTOCUT_SIGNTOOL_PATH ?? defaultSignToolPath,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const installers = installerSpecs(resolvedRootDir).map((spec) => {
    if (!fs.existsSync(spec.path) || !fs.statSync(spec.path).isFile()) {
      throw new Error(`AutoCut release installer is missing: ${spec.path}`);
    }
    return spec;
  });

  const normalizedCertificatePath = normalizeOptionalString(certificatePath);
  const normalizedThumbprint = normalizeOptionalString(certificateThumbprint);
  if (!normalizedCertificatePath && !normalizedThumbprint) {
    throw new Error(
      'AutoCut installer signing requires a signing certificate source: set SDKWORK_AUTOCUT_WINDOWS_SIGNING_PFX or SDKWORK_AUTOCUT_WINDOWS_SIGNING_THUMBPRINT.',
    );
  }
  if (normalizedCertificatePath && normalizedThumbprint) {
    throw new Error('AutoCut installer signing accepts either a PFX path or a certificate thumbprint, not both.');
  }

  const mode = normalizedCertificatePath ? 'pfx' : 'store-thumbprint';
  const resolvedCertificatePath = normalizedCertificatePath
    ? path.resolve(normalizedCertificatePath)
    : undefined;
  if (resolvedCertificatePath && (!fs.existsSync(resolvedCertificatePath) || !fs.statSync(resolvedCertificatePath).isFile())) {
    throw new Error(`AutoCut installer signing certificate file is missing: ${resolvedCertificatePath}`);
  }

  const normalizedPassword = normalizeOptionalString(certificatePassword);
  if (resolvedCertificatePath && !normalizedPassword) {
    throw new Error('AutoCut installer signing with a PFX file requires SDKWORK_AUTOCUT_WINDOWS_SIGNING_PASSWORD or --cert-password.');
  }

  const normalizedTimestampUrl = normalizeRequiredString(timestampUrl, '--timestamp-url');
  const normalizedSignToolPath = normalizeRequiredString(signToolPath, '--signtool');
  const commands = installers.map((installer) => ({
    kind: installer.kind,
    path: installer.path,
    command: normalizedSignToolPath,
    args: createSignToolArgs({
      installerPath: installer.path,
      mode,
      certificatePath: resolvedCertificatePath,
      certificatePassword: normalizedPassword,
      certificateThumbprint: normalizedThumbprint,
      timestampUrl: normalizedTimestampUrl,
    }),
  }));

  return {
    rootDir: resolvedRootDir,
    mode,
    signToolPath: normalizedSignToolPath,
    timestampUrl: normalizedTimestampUrl,
    ...(resolvedCertificatePath ? { certificatePath: resolvedCertificatePath } : {}),
    ...(normalizedThumbprint ? { certificateThumbprint: normalizedThumbprint } : {}),
    installers,
    commands,
  };
}

export function signAutoCutReleaseInstallers({
  runCommand = runAutoCutInstallerSigningCommand,
  ...options
} = {}) {
  const plan = createAutoCutInstallerSigningPlan(options);
  const results = plan.commands.map((commandSpec) => {
    const result = runCommand(commandSpec.command, commandSpec.args);
    const status = Number.isInteger(result.status) ? result.status : 1;
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    if (status !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit ${status}`;
      throw new Error(`AutoCut installer signing failed for ${commandSpec.kind}: ${detail}`);
    }
    return {
      kind: commandSpec.kind,
      path: commandSpec.path,
      status,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
    };
  });

  return {
    ready: results.length === plan.installers.length,
    plan,
    mode: plan.mode,
    results,
  };
}

export function formatAutoCutInstallerSigningMessage(result) {
  return `ok - autocut installer signing installers=${result.results.length} mode=${result.mode}`;
}

export function runAutoCutInstallerSigningCommand(command, args) {
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

function createSignToolArgs({
  installerPath,
  mode,
  certificatePath,
  certificatePassword,
  certificateThumbprint,
  timestampUrl,
}) {
  const commonArgs = [
    'sign',
    '/fd',
    'SHA256',
    '/tr',
    timestampUrl,
    '/td',
    'SHA256',
  ];
  if (mode === 'pfx') {
    return [
      ...commonArgs,
      '/f',
      certificatePath,
      '/p',
      certificatePassword,
      installerPath,
    ];
  }
  return [
    ...commonArgs,
    '/sha1',
    certificateThumbprint,
    installerPath,
  ];
}

function installerSpecs(rootDir) {
  const bundleRoot = path.join(rootDir, bundleRelativeRoot);
  return [
    {
      kind: 'msi',
      path: path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi'),
    },
    {
      kind: 'nsis',
      path: path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe'),
    },
  ];
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeRequiredString(value, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`AutoCut installer signing requires ${name}.`);
  }
  return normalized;
}

function trimOutput(output) {
  const maxLength = 4000;
  return output.length <= maxLength ? output : `${output.slice(0, maxLength)}\n[autocut-installer-signing-output-truncated]`;
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--cert-pfx') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signing',
      });
      options.certificatePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--cert-password') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signing',
      });
      options.certificatePassword = option.value;
      index = option.nextIndex;
    } else if (arg === '--cert-thumbprint') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signing',
      });
      options.certificateThumbprint = option.value;
      index = option.nextIndex;
    } else if (arg === '--timestamp-url') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signing',
      });
      options.timestampUrl = option.value;
      index = option.nextIndex;
    } else if (arg === '--signtool') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut installer signing',
      });
      options.signToolPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut installer signing argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = signAutoCutReleaseInstallers(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutInstallerSigningMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
