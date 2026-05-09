import fs from 'node:fs';
import path from 'node:path';

const desktopTauriTargetRelativePath = 'packages/sdkwork-autocut-desktop/src-tauri/target';
const desktopTauriConfigRelativePath = 'packages/sdkwork-autocut-desktop/src-tauri/tauri.conf.json';

export const autoCutReleasePlatformSpecs = {
  'windows-x86_64': {
    key: 'windows-x86_64',
    targetTriple: 'x86_64-pc-windows-msvc',
    bundleRootOrder: ['default', 'target'],
    installers: [
      {
        kind: 'msi',
        bundleSubdir: 'msi',
        missingFileName: createAutoCutReleaseInstallerFileName('windows-msi'),
        suffixes: ['.msi'],
      },
      {
        kind: 'nsis',
        bundleSubdir: 'nsis',
        missingFileName: createAutoCutReleaseInstallerFileName('windows-nsis'),
        suffixes: ['.exe'],
      },
    ],
  },
  'linux-x86_64': {
    key: 'linux-x86_64',
    targetTriple: 'x86_64-unknown-linux-gnu',
    bundleRootOrder: ['target', 'default'],
    installers: [
      {
        kind: 'deb',
        bundleSubdir: 'deb',
        missingFileName: createAutoCutReleaseInstallerFileName('linux-deb'),
        suffixes: ['.deb'],
      },
      {
        kind: 'appimage',
        bundleSubdir: 'appimage',
        missingFileName: createAutoCutReleaseInstallerFileName('linux-appimage'),
        suffixes: ['.appimage'],
      },
    ],
  },
  'macos-x86_64': {
    key: 'macos-x86_64',
    targetTriple: 'x86_64-apple-darwin',
    bundleRootOrder: ['target', 'default'],
    installers: [
      {
        kind: 'dmg',
        bundleSubdir: 'dmg',
        missingFileName: createAutoCutReleaseInstallerFileName('macos-x64-dmg'),
        suffixes: ['.dmg'],
      },
      {
        kind: 'app',
        bundleSubdir: 'macos',
        missingFileName: createAutoCutReleaseInstallerFileName('macos-x64-app'),
        suffixes: ['.app.tar.gz'],
      },
    ],
  },
  'macos-aarch64': {
    key: 'macos-aarch64',
    targetTriple: 'aarch64-apple-darwin',
    bundleRootOrder: ['target', 'default'],
    installers: [
      {
        kind: 'dmg',
        bundleSubdir: 'dmg',
        missingFileName: createAutoCutReleaseInstallerFileName('macos-aarch64-dmg'),
        suffixes: ['.dmg'],
      },
      {
        kind: 'app',
        bundleSubdir: 'macos',
        missingFileName: createAutoCutReleaseInstallerFileName('macos-aarch64-app'),
        suffixes: ['.app.tar.gz'],
      },
    ],
  },
};

export const autoCutReleasePlatformKeys = Object.freeze(Object.keys(autoCutReleasePlatformSpecs));
const autoCutReleasePlatformAliases = new Map([
  ['windows', 'windows-x86_64'],
  ['win32', 'windows-x86_64'],
  ['windows-x64', 'windows-x86_64'],
  ['windows-amd64', 'windows-x86_64'],
  ['windows-x86-64', 'windows-x86_64'],
  ['win32-x64', 'windows-x86_64'],
  ['win32-amd64', 'windows-x86_64'],
  ['win32-x86-64', 'windows-x86_64'],
  ['x64-windows', 'windows-x86_64'],
  ['amd64-windows', 'windows-x86_64'],
  ['x86-64-pc-windows-msvc', 'windows-x86_64'],
  ['x86-64-pc-windows-gnu', 'windows-x86_64'],
  ['linux', 'linux-x86_64'],
  ['ubuntu', 'linux-x86_64'],
  ['linux-x64', 'linux-x86_64'],
  ['linux-amd64', 'linux-x86_64'],
  ['linux-x86-64', 'linux-x86_64'],
  ['ubuntu-x64', 'linux-x86_64'],
  ['ubuntu-amd64', 'linux-x86_64'],
  ['ubuntu-x86-64', 'linux-x86_64'],
  ['debian-x64', 'linux-x86_64'],
  ['debian-amd64', 'linux-x86_64'],
  ['x86-64-unknown-linux-gnu', 'linux-x86_64'],
  ['x86-64-unknown-linux-musl', 'linux-x86_64'],
  ['macos-x64', 'macos-x86_64'],
  ['macos-amd64', 'macos-x86_64'],
  ['macos-x86-64', 'macos-x86_64'],
  ['macos-intel', 'macos-x86_64'],
  ['darwin-x64', 'macos-x86_64'],
  ['darwin-amd64', 'macos-x86_64'],
  ['darwin-x86-64', 'macos-x86_64'],
  ['x86-64-apple-darwin', 'macos-x86_64'],
  ['macos-arm64', 'macos-aarch64'],
  ['macos-aarch64', 'macos-aarch64'],
  ['macos-apple-silicon', 'macos-aarch64'],
  ['darwin-arm64', 'macos-aarch64'],
  ['darwin-aarch64', 'macos-aarch64'],
  ['arm64-apple-darwin', 'macos-aarch64'],
  ['aarch64-apple-darwin', 'macos-aarch64'],
]);
const ambiguousAutoCutReleasePlatforms = new Set(['macos', 'darwin', 'apple']);

export function readAutoCutReleaseVersion(rootDir = process.cwd()) {
  const tauriConfigPath = path.join(path.resolve(rootDir), desktopTauriConfigRelativePath);
  if (fs.existsSync(tauriConfigPath) && fs.statSync(tauriConfigPath).isFile()) {
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
    const version = typeof tauriConfig.version === 'string' ? tauriConfig.version.trim() : '';
    if (version) {
      return version;
    }
  }

  const rootPackagePath = path.join(path.resolve(rootDir), 'package.json');
  if (!fs.existsSync(rootPackagePath) || !fs.statSync(rootPackagePath).isFile()) {
    return '0.1.0';
  }
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  const version = typeof rootPackage.version === 'string' ? rootPackage.version.trim() : '';
  if (!version) {
    throw new Error('AutoCut release version is missing from package.json.');
  }
  return version;
}

export function normalizeAutoCutReleasePlatform(platform = 'windows-x86_64') {
  const normalized = String(platform ?? '').trim();
  if (!normalized) {
    throw new Error('AutoCut release platform is required.');
  }
  if (Object.hasOwn(autoCutReleasePlatformSpecs, normalized)) {
    return normalized;
  }

  const lookupKey = createAutoCutReleasePlatformLookupKey(normalized);
  if (ambiguousAutoCutReleasePlatforms.has(lookupKey)) {
    throw new Error(`AutoCut release platform ${normalized} is ambiguous; use macos-x86_64 or macos-aarch64.`);
  }

  const alias = autoCutReleasePlatformAliases.get(lookupKey);
  if (alias) {
    return alias;
  }

  throw new Error(`Unsupported AutoCut release platform: ${normalized}`);
}

export function createAutoCutHostPlatformKey({
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const osKey = normalizeAutoCutHostOs(platform);
  const archKey = normalizeAutoCutHostArch(arch);
  return normalizeAutoCutReleasePlatform(`${osKey}-${archKey}`);
}

export function getAutoCutReleasePlatformSpec(platform = 'windows-x86_64') {
  return autoCutReleasePlatformSpecs[normalizeAutoCutReleasePlatform(platform)];
}

export function createAutoCutReleaseInstallerSpecs({ rootDir, platform = 'windows-x86_64' }) {
  const resolvedRootDir = path.resolve(rootDir);
  const platformSpec = getAutoCutReleasePlatformSpec(platform);
  const bundleRoots = createBundleRootCandidates(resolvedRootDir, platformSpec);
  return platformSpec.installers.map((installerSpec) => {
    const matches = findInstallerMatches(bundleRoots, installerSpec);
    if (matches.length > 1) {
      throw new Error(
        `multiple AutoCut ${platformSpec.key} ${installerSpec.kind} installers found: ${matches
          .map((entry) => entry.absolutePath)
          .join(', ')}`,
      );
    }
    return {
      platform: platformSpec.key,
      targetTriple: platformSpec.targetTriple,
      kind: installerSpec.kind,
      absolutePath: matches[0]?.absolutePath ?? createMissingInstallerPath(resolvedRootDir, bundleRoots[0], installerSpec),
    };
  });
}

function createBundleRootCandidates(rootDir, platformSpec) {
  const targetRoot = path.join(rootDir, desktopTauriTargetRelativePath);
  const candidatesByKind = {
    default: path.join(targetRoot, 'release', 'bundle'),
    target: path.join(targetRoot, platformSpec.targetTriple, 'release', 'bundle'),
  };
  return platformSpec.bundleRootOrder.map((kind) => candidatesByKind[kind]);
}

function findInstallerMatches(bundleRoots, installerSpec) {
  const matches = [];
  for (const bundleRoot of bundleRoots) {
    const installerDir = path.join(bundleRoot, installerSpec.bundleSubdir);
    for (const filePath of listFiles(installerDir)) {
      const fileName = path.basename(filePath).toLowerCase();
      if (installerSpec.suffixes.some((suffix) => fileName.endsWith(suffix))) {
        matches.push({
          absolutePath: filePath,
        });
      }
    }
  }
  return matches.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath));
}

function createMissingInstallerPath(rootDir, bundleRoot, installerSpec) {
  return path.join(
    bundleRoot,
    installerSpec.bundleSubdir,
    renderInstallerFileName(installerSpec.missingFileName, readAutoCutReleaseVersion(rootDir)),
  );
}

function createAutoCutReleaseInstallerFileName(kind) {
  const token = '${version}';
  switch (kind) {
    case 'windows-msi':
      return `SDKWork Video Cut_${token}_x64_en-US.msi`;
    case 'windows-nsis':
      return `SDKWork Video Cut_${token}_x64-setup.exe`;
    case 'linux-deb':
      return `SDKWork Video Cut_${token}_amd64.deb`;
    case 'linux-appimage':
      return `SDKWork Video Cut_${token}_amd64.AppImage`;
    case 'macos-x64-dmg':
      return `SDKWork Video Cut_${token}_x64.dmg`;
    case 'macos-x64-app':
      return `SDKWork Video Cut_${token}_x64.app.tar.gz`;
    case 'macos-aarch64-dmg':
      return `SDKWork Video Cut_${token}_aarch64.dmg`;
    case 'macos-aarch64-app':
      return `SDKWork Video Cut_${token}_aarch64.app.tar.gz`;
    default:
      throw new Error(`Unsupported AutoCut release installer file kind: ${kind}`);
  }
}

function renderInstallerFileName(fileName, version) {
  return fileName.replaceAll('${version}', version);
}

function normalizeAutoCutHostOs(platform) {
  const value = String(platform ?? '').trim().toLowerCase();
  switch (value) {
    case 'win32':
    case 'windows':
      return 'windows';
    case 'darwin':
    case 'macos':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      throw new Error(`Unsupported AutoCut host operating system: ${platform}`);
  }
}

function normalizeAutoCutHostArch(arch) {
  const value = String(arch ?? '').trim().toLowerCase();
  switch (value) {
    case 'x64':
    case 'x86_64':
    case 'amd64':
      return 'x86_64';
    case 'arm64':
    case 'aarch64':
      return 'aarch64';
    default:
      throw new Error(`Unsupported AutoCut host CPU architecture: ${arch}`);
  }
}

function createAutoCutReleasePlatformLookupKey(platform) {
  return String(platform ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replaceAll('_', '-');
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      files.push(entryPath);
    } else if (entry.isDirectory() && !entry.name.endsWith('.app')) {
      files.push(...listFiles(entryPath));
    }
  }
  return files;
}
