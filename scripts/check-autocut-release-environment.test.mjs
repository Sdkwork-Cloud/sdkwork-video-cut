#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  createAutoCutReleaseEnvironmentReport,
  formatAutoCutReleaseEnvironmentMessage,
} from './check-autocut-release-environment.mjs';

const healthyReport = createAutoCutReleaseEnvironmentReport({
  rootDir: 'D:/repo',
  releaseTag: 'v0.1.6',
  hostPlatform: 'win32',
  runCommand(command, args) {
    if (command === 'git' && args.join(' ') === 'status --porcelain=v1') {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'ls-remote --heads origin main') {
      return {
        status: 0,
        stdout: '83391d36c2c01c168b1555e103b1cd818b2d7fdb\trefs/heads/main\n',
        stderr: '',
      };
    }
    if (command === 'git' && args.join(' ') === 'ls-remote --tags origin v0.1.6') {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'gh' && args.join(' ') === 'auth status') {
      return { status: 0, stdout: 'Logged in to github.com account Sdkwork-Cloud', stderr: '' };
    }
    if (command === 'gh' && args.join(' ') === 'release view v0.1.6 --repo Sdkwork-Cloud/sdkwork-video-cut') {
      return { status: 1, stdout: '', stderr: 'release not found' };
    }
    if (command === 'node') {
      return { status: 0, stdout: 'spawn-ok\n', stderr: '' };
    }
    if (command === 'powershell.exe') {
      return { status: 0, stdout: 'msi-ok\n', stderr: '' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  },
  probeGitMetadataWrite() {
    return { ready: true, diagnostic: 'git metadata write ok' };
  },
});

assert.equal(healthyReport.ready, true);
assert.deepEqual(healthyReport.blockers, []);
assert.equal(healthyReport.checks.gitMetadataWritable.ready, true);
assert.equal(healthyReport.checks.gitSshRemote.ready, true);
assert.equal(healthyReport.checks.githubCliAuthenticated.ready, true);
assert.equal(healthyReport.checks.nodeSpawnReady.ready, true);
assert.equal(healthyReport.checks.windowsInstallerServiceReady.ready, true);
assert.equal(
  formatAutoCutReleaseEnvironmentMessage(healthyReport),
  'ok - autocut release environment releaseTag=v0.1.6 checks=6 blockers=0',
);

const blockedReport = createAutoCutReleaseEnvironmentReport({
  rootDir: 'D:/repo',
  releaseTag: 'v0.1.6',
  hostPlatform: 'win32',
  includeWindowsInstallerService: true,
  runCommand(command, args) {
    if (command === 'git' && args.join(' ') === 'status --porcelain=v1') {
      return { status: 0, stdout: ' M package.json\n', stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'ls-remote --heads origin main') {
      return {
        status: 1,
        stdout: '',
        stderr: "ssh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5",
      };
    }
    if (command === 'git' && args.join(' ') === 'ls-remote --tags origin v0.1.6') {
      return {
        status: 1,
        stdout: '',
        stderr: "ssh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5",
      };
    }
    if (command === 'gh' && args.join(' ') === 'auth status') {
      return {
        status: 1,
        stdout: '',
        stderr: 'The token in default is invalid.',
      };
    }
    if (command === 'gh' && args.join(' ') === 'release view v0.1.6 --repo Sdkwork-Cloud/sdkwork-video-cut') {
      return {
        status: 1,
        stdout: '',
        stderr: 'HTTP 401: Requires authentication',
      };
    }
    if (command === 'node') {
      return { status: 1, stdout: 'spawnSync rustc EPERM\n', stderr: '' };
    }
    if (command === 'powershell.exe') {
      return {
        status: 1,
        stdout: '',
        stderr: 'The Windows Installer Service could not be accessed.',
      };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  },
  probeGitMetadataWrite() {
    return { ready: false, diagnostic: 'index.lock: Permission denied' };
  },
});

assert.equal(blockedReport.ready, false);
assert.deepEqual(
  blockedReport.blockers.map((blocker) => blocker.code),
  [
    'GIT_WORKTREE_NOT_CLEAN',
    'GIT_METADATA_NOT_WRITABLE',
    'GIT_SSH_REMOTE_UNAVAILABLE',
    'GITHUB_CLI_UNAUTHENTICATED',
    'NODE_SPAWN_UNAVAILABLE',
    'WINDOWS_INSTALLER_SERVICE_UNAVAILABLE',
  ],
);
assert.match(formatAutoCutReleaseEnvironmentMessage(blockedReport), /blocked - autocut release environment/u);
assert.match(JSON.stringify(blockedReport), /index\.lock: Permission denied/u);
assert.match(JSON.stringify(blockedReport), /couldn't create signal pipe/u);
assert.match(JSON.stringify(blockedReport), /token in default is invalid/u);
assert.match(JSON.stringify(blockedReport), /spawnSync rustc EPERM/u);
assert.match(JSON.stringify(blockedReport), /Windows Installer Service could not be accessed/u);

const nonWindowsBlockedReport = createAutoCutReleaseEnvironmentReport({
  rootDir: '/repo',
  releaseTag: 'v0.1.6',
  hostPlatform: 'linux',
  includeWindowsInstallerService: true,
  runCommand(command, args) {
    if (command === 'git' && args.join(' ') === 'status --porcelain=v1') {
      return { status: 0, stdout: ' M package.json\n', stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'ls-remote --heads origin main') {
      return { status: 1, stdout: '', stderr: 'ssh: network unavailable' };
    }
    if (command === 'git' && args.join(' ') === 'ls-remote --tags origin v0.1.6') {
      return { status: 1, stdout: '', stderr: 'ssh: network unavailable' };
    }
    if (command === 'gh' && args.join(' ') === 'auth status') {
      return { status: 1, stdout: '', stderr: 'not logged in' };
    }
    if (command === 'gh' && args.join(' ') === 'release view v0.1.6 --repo Sdkwork-Cloud/sdkwork-video-cut') {
      return { status: 1, stdout: '', stderr: 'HTTP 401: Requires authentication' };
    }
    if (command === 'node') {
      return { status: 1, stdout: 'spawnSync rustc EPERM\n', stderr: '' };
    }
    if (command === 'powershell.exe') {
      throw new Error('non-Windows release environment checks must not invoke powershell.exe');
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  },
  probeGitMetadataWrite() {
    return { ready: false, diagnostic: 'index.lock: Permission denied' };
  },
});

assert.equal(nonWindowsBlockedReport.ready, false);
assert.equal(nonWindowsBlockedReport.checks.windowsInstallerServiceReady.required, false);
assert.equal(nonWindowsBlockedReport.checks.windowsInstallerServiceReady.ready, true);
assert.deepEqual(
  nonWindowsBlockedReport.blockers.map((blocker) => blocker.code),
  [
    'GIT_WORKTREE_NOT_CLEAN',
    'GIT_METADATA_NOT_WRITABLE',
    'GIT_SSH_REMOTE_UNAVAILABLE',
    'GITHUB_CLI_UNAUTHENTICATED',
    'NODE_SPAWN_UNAVAILABLE',
  ],
);

assert.throws(
  () => createAutoCutReleaseEnvironmentReport({ releaseTag: '' }),
  /requires a release tag/u,
);

console.log('ok - autocut release environment contract');
