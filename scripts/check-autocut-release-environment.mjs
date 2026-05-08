#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const defaultRepository = 'Sdkwork-Cloud/sdkwork-video-cut';
const defaultReleaseTag = 'v0.1.1';

export function createAutoCutReleaseEnvironmentReport({
  rootDir = process.cwd(),
  releaseTag = defaultReleaseTag,
  repository = defaultRepository,
  requireCleanWorktree = true,
  includeWindowsInstallerService = process.platform === 'win32',
  runCommand = runAutoCutReleaseEnvironmentCommand,
  probeGitMetadataWrite = probeAutoCutGitMetadataWrite,
} = {}) {
  const normalizedReleaseTag = normalizeReleaseTag(releaseTag);
  const resolvedRootDir = path.resolve(rootDir);
  const checks = {
    gitWorktreeClean: checkGitWorktreeClean({
      rootDir: resolvedRootDir,
      required: requireCleanWorktree,
      runCommand,
    }),
    gitMetadataWritable: checkGitMetadataWritable({
      rootDir: resolvedRootDir,
      probeGitMetadataWrite,
    }),
    gitSshRemote: checkGitSshRemote({
      rootDir: resolvedRootDir,
      releaseTag: normalizedReleaseTag,
      runCommand,
    }),
    githubCliAuthenticated: checkGithubCliAuthenticated({
      rootDir: resolvedRootDir,
      releaseTag: normalizedReleaseTag,
      repository,
      runCommand,
    }),
    nodeSpawnReady: checkNodeSpawnReady({
      rootDir: resolvedRootDir,
      runCommand,
    }),
    windowsInstallerServiceReady: includeWindowsInstallerService
      ? checkWindowsInstallerServiceReady({
        rootDir: resolvedRootDir,
        runCommand,
      })
      : createSkippedCheck(
        'windowsInstallerServiceReady',
        'Windows Installer Service check is skipped on non-Windows hosts.',
      ),
  };

  const blockers = Object.values(checks)
    .filter((check) => check.required && !check.ready)
    .map((check) => ({
      code: check.blockerCode,
      check: check.name,
      diagnostic: check.diagnostic,
      remediation: check.remediation,
    }));

  return {
    schemaVersion: '2026-05-08.autocut-release-environment.v1',
    releaseTag: normalizedReleaseTag,
    repository,
    rootDir: resolvedRootDir,
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}

export function formatAutoCutReleaseEnvironmentMessage(report) {
  const checkCount = Object.keys(report.checks).length;
  if (report.ready) {
    return `ok - autocut release environment releaseTag=${report.releaseTag} checks=${checkCount} blockers=0`;
  }

  return [
    `blocked - autocut release environment releaseTag=${report.releaseTag}`,
    `checks=${checkCount}`,
    `blockers=${report.blockers.length}`,
    `codes=${report.blockers.map((blocker) => blocker.code).join(',')}`,
  ].join(' ');
}

export function runAutoCutReleaseEnvironmentCommand(command, args, { cwd = process.cwd() } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    return {
      status: null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error.message,
    };
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function probeAutoCutGitMetadataWrite({ rootDir = process.cwd() } = {}) {
  const gitDir = path.join(path.resolve(rootDir), '.git');
  const probeName = `codex-autocut-release-${process.pid}-${Date.now()}.lock`;
  const probePath = path.join(gitDir, probeName);
  try {
    fs.writeFileSync(probePath, 'autocut release environment probe\n', { flag: 'wx' });
    fs.rmSync(probePath, { force: true });
    return {
      ready: true,
      diagnostic: 'Git metadata directory is writable.',
    };
  } catch (error) {
    return {
      ready: false,
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkGitWorktreeClean({ rootDir, required, runCommand }) {
  const result = runCommand('git', ['status', '--porcelain=v1'], { cwd: rootDir });
  if (!commandSucceeded(result)) {
    return createCheck({
      name: 'gitWorktreeClean',
      ready: false,
      required,
      blockerCode: 'GIT_WORKTREE_STATUS_UNAVAILABLE',
      diagnostic: commandDiagnostic(result),
      remediation: 'Run git status locally and resolve repository access errors before releasing.',
    });
  }

  const changedLines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('.codex-release-index') && !line.includes('artifacts/'));
  return createCheck({
    name: 'gitWorktreeClean',
    ready: changedLines.length === 0,
    required,
    blockerCode: 'GIT_WORKTREE_NOT_CLEAN',
    diagnostic: changedLines.length === 0
      ? 'Git worktree is clean.'
      : `Git worktree has ${changedLines.length} changed paths.`,
    remediation: 'Commit or intentionally stash every source change before starting the GitHub Release flow.',
    details: {
      changedPathCount: changedLines.length,
      changedPaths: changedLines.slice(0, 40),
    },
  });
}

function checkGitMetadataWritable({ rootDir, probeGitMetadataWrite }) {
  const probe = probeGitMetadataWrite({ rootDir });
  return createCheck({
    name: 'gitMetadataWritable',
    ready: Boolean(probe.ready),
    required: true,
    blockerCode: 'GIT_METADATA_NOT_WRITABLE',
    diagnostic: probe.diagnostic,
    remediation: 'Run the release from a terminal identity that can write .git/index.lock, refs, and tag metadata.',
  });
}

function checkGitSshRemote({ rootDir, releaseTag, runCommand }) {
  const headResult = runCommand('git', ['ls-remote', '--heads', 'origin', 'main'], { cwd: rootDir });
  const tagResult = runCommand('git', ['ls-remote', '--tags', 'origin', releaseTag], { cwd: rootDir });
  const headReady = commandSucceeded(headResult) && headResult.stdout.includes('refs/heads/main');
  const tagReady = commandSucceeded(tagResult);
  return createCheck({
    name: 'gitSshRemote',
    ready: headReady && tagReady,
    required: true,
    blockerCode: 'GIT_SSH_REMOTE_UNAVAILABLE',
    diagnostic: headReady && tagReady
      ? `origin/main is reachable and ${releaseTag} tag lookup completed.`
      : [commandDiagnostic(headResult), commandDiagnostic(tagResult)].filter(Boolean).join(' | '),
    remediation: 'Fix SSH/network access to git@github.com or switch the remote to an authenticated HTTPS URL before pushing main and tags.',
    details: {
      mainHead: normalizeCommandOutput(headResult.stdout),
      releaseTagRemoteState: normalizeCommandOutput(tagResult.stdout) || 'missing-or-unavailable',
    },
  });
}

function checkGithubCliAuthenticated({ rootDir, releaseTag, repository, runCommand }) {
  const authResult = runCommand('gh', ['auth', 'status'], { cwd: rootDir });
  const releaseResult = runCommand(
    'gh',
    ['release', 'view', releaseTag, '--repo', repository],
    { cwd: rootDir },
  );
  const authReady = commandSucceeded(authResult);
  const releaseViewAuthenticated =
    commandSucceeded(releaseResult) ||
    !/401|requires authentication|token .*invalid/iu.test(commandDiagnostic(releaseResult));
  return createCheck({
    name: 'githubCliAuthenticated',
    ready: authReady && releaseViewAuthenticated,
    required: true,
    blockerCode: 'GITHUB_CLI_UNAUTHENTICATED',
    diagnostic: authReady && releaseViewAuthenticated
      ? 'GitHub CLI is authenticated for release operations.'
      : [commandDiagnostic(authResult), commandDiagnostic(releaseResult)].filter(Boolean).join(' | '),
    remediation: 'Run gh auth login or provide a valid GH_TOKEN/GITHUB_TOKEN with contents:write before creating the release.',
  });
}

function checkNodeSpawnReady({ rootDir, runCommand }) {
  const probeSource = [
    "const { spawnSync } = require('node:child_process');",
    "const candidates = process.platform === 'win32' ? [['cmd.exe', ['/c', 'ver']]] : [['sh', ['-c', 'echo spawn-ok']]];",
    "for (const [command, args] of candidates) {",
    "  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });",
    "  if (result.error) { console.log(`${result.error.code || 'ERROR'}:${result.error.message}`); process.exit(1); }",
    "  if (result.status !== 0) { console.log(result.stderr || result.stdout || `exit ${result.status}`); process.exit(1); }",
    "}",
    "console.log('spawn-ok');",
  ].join('\n');
  const result = runCommand('node', ['-e', probeSource], { cwd: rootDir });
  const diagnostic = commandDiagnostic(result);
  return createCheck({
    name: 'nodeSpawnReady',
    ready: commandSucceeded(result) && /spawn-ok/u.test(result.stdout),
    required: true,
    blockerCode: 'NODE_SPAWN_UNAVAILABLE',
    diagnostic: commandSucceeded(result) ? 'Node child_process spawn is available.' : diagnostic,
    remediation: 'Run release scripts in an environment that permits Node child_process to start rustc, cargo, ffmpeg, shell helpers, and package-manager tools.',
  });
}

function checkWindowsInstallerServiceReady({ rootDir, runCommand }) {
  if (process.platform !== 'win32') {
    return createSkippedCheck(
      'windowsInstallerServiceReady',
      'Windows Installer Service check is skipped on non-Windows hosts.',
    );
  }

  const result = runCommand(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "(Get-Service -Name msiserver -ErrorAction Stop).Status; Write-Output 'msi-ok'",
    ],
    { cwd: rootDir },
  );
  return createCheck({
    name: 'windowsInstallerServiceReady',
    ready: commandSucceeded(result) && /msi-ok/u.test(result.stdout),
    required: true,
    blockerCode: 'WINDOWS_INSTALLER_SERVICE_UNAVAILABLE',
    diagnostic: commandSucceeded(result)
      ? 'Windows Installer Service is queryable for WiX MSI validation.'
      : commandDiagnostic(result),
    remediation: 'Run Windows installer packaging on a host where msiserver is accessible, such as GitHub Actions windows-latest or an unrestricted Windows build machine.',
  });
}

function createSkippedCheck(name, diagnostic) {
  return createCheck({
    name,
    ready: true,
    required: false,
    blockerCode: `${name.toUpperCase()}_SKIPPED`,
    diagnostic,
    remediation: '',
  });
}

function createCheck({
  name,
  ready,
  required,
  blockerCode,
  diagnostic,
  remediation,
  details,
}) {
  return {
    name,
    ready: Boolean(ready),
    required: Boolean(required),
    blockerCode,
    diagnostic: normalizeDiagnostic(diagnostic),
    remediation,
    ...(details ? { details } : {}),
  };
}

function commandSucceeded(result) {
  return result?.status === 0 && !result.error;
}

function commandDiagnostic(result) {
  if (!result) {
    return 'command did not return a result';
  }
  return normalizeDiagnostic(
    result.error ||
      result.stderr ||
      result.stdout ||
      (result.status === null || result.status === undefined ? 'command failed' : `exit ${result.status}`),
  );
}

function normalizeCommandOutput(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function normalizeDiagnostic(value) {
  const normalized = normalizeCommandOutput(value);
  return normalized || 'ok';
}

function normalizeReleaseTag(releaseTag) {
  if (typeof releaseTag !== 'string' || releaseTag.trim() === '') {
    throw new Error('AutoCut release environment check requires a release tag.');
  }
  const normalized = releaseTag.trim();
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(normalized)) {
    throw new Error(`AutoCut release environment check requires a semver tag like v0.1.1, got ${normalized}.`);
  }
  return normalized;
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--release-tag') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release environment',
      });
      options.releaseTag = option.value;
      index = option.nextIndex;
    } else if (arg === '--repo') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release environment',
      });
      options.repository = option.value;
      index = option.nextIndex;
    } else if (arg === '--allow-dirty') {
      options.requireCleanWorktree = false;
    } else if (arg === '--skip-windows-installer-service') {
      options.includeWindowsInstallerService = false;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown AutoCut release environment argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const { json, ...options } = parseArgs(process.argv.slice(2));
  const report = createAutoCutReleaseEnvironmentReport(options);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAutoCutReleaseEnvironmentMessage(report));
    if (!report.ready) {
      for (const blocker of report.blockers) {
        console.error(`- ${blocker.code}: ${blocker.diagnostic}`);
        console.error(`  remediation: ${blocker.remediation}`);
      }
    }
  }
  if (!report.ready) {
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
