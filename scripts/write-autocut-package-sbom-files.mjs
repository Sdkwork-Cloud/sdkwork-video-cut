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
const defaultOutputDirRelativePath = 'artifacts/release/sbom';
const desktopPackageRelativePath = 'packages/sdkwork-autocut-desktop';
const desktopCargoRelativePath = `${desktopPackageRelativePath}/src-tauri`;
const rootComponentType = 'application';
const packageSpecs = [
  { packageId: 'windows-x64-desktop-msi', platform: 'windows-x86_64', architecture: 'x64', installerKind: 'msi' },
  { packageId: 'windows-x64-desktop-exe', platform: 'windows-x86_64', architecture: 'x64', installerKind: 'nsis' },
  { packageId: 'linux-debian-x64-desktop-deb', platform: 'linux-x86_64', architecture: 'x64', installerKind: 'deb' },
  { packageId: 'linux-x64-desktop-appimage', platform: 'linux-x86_64', architecture: 'x64', installerKind: 'appimage' },
  { packageId: 'macos-x64-desktop-dmg', platform: 'macos-x86_64', architecture: 'x64', installerKind: 'dmg' },
  { packageId: 'macos-arm64-desktop-dmg', platform: 'macos-aarch64', architecture: 'arm64', installerKind: 'dmg' },
];

export function createAutoCutPackageSbom({
  rootDir = process.cwd(),
  packageId,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const packageSpec = getPackageSpec(packageId);
  const dependencyContext = readDependencyContext(resolvedRootDir);
  const rootVersion = readAutoCutReleaseVersion(resolvedRootDir);
  const rootBomRef = createRootBomRef(packageSpec.packageId, rootVersion);
  const cargoRuntimePackageNames = selectCargoRuntimeDependencyNames(
    dependencyContext.cargoManifestSource,
    dependencyContext.cargoPackages,
    packageSpec.platform,
  );
  const components = [
    ...createWorkspaceComponents(dependencyContext.workspacePackages, dependencyContext.catalogVersions),
    ...createNpmExternalComponents(dependencyContext.npmRuntimePackageVersions),
    ...createCargoComponents(dependencyContext.cargoPackages, cargoRuntimePackageNames),
  ].sort((left, right) => `${left.type}:${left.name}:${left.version}`.localeCompare(`${right.type}:${right.name}:${right.version}`));
  const dependencyRefs = components.map((component) => component['bom-ref']);

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: createDeterministicUrnUuid(`autocut:${packageSpec.packageId}:${rootVersion}`),
    version: 1,
    metadata: {
      timestamp: generatedAt,
      tools: {
        components: [
          {
            type: 'application',
            name: 'sdkwork-video-cut-autocut-package-sbom-writer',
            version: rootVersion,
          },
        ],
      },
      component: {
        type: rootComponentType,
        'bom-ref': rootBomRef,
        name: `SDKWork Video Cut ${packageSpec.packageId}`,
        version: rootVersion,
        purl: rootBomRef,
      },
      properties: [
        { name: 'sdkwork:autocut:packageId', value: packageSpec.packageId },
        { name: 'sdkwork:autocut:platform', value: packageSpec.platform },
        { name: 'sdkwork:autocut:architecture', value: packageSpec.architecture },
        { name: 'sdkwork:autocut:installerKind', value: packageSpec.installerKind },
        { name: 'sdkwork:autocut:source', value: 'workspace package manifests, pnpm-lock.yaml, and Cargo.lock' },
      ],
    },
    components,
    dependencies: [
      {
        ref: rootBomRef,
        dependsOn: dependencyRefs,
      },
      ...dependencyRefs.map((ref) => ({
        ref,
        dependsOn: [],
      })),
    ],
  };
}

export function writeAutoCutPackageSbomFiles({
  rootDir = process.cwd(),
  outputDir,
  packageIds,
  platform,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const selectedPackageSpecs = selectPackageSpecs({ packageIds, platform });
  const resolvedOutputDir = path.resolve(outputDir ?? path.join(resolvedRootDir, defaultOutputDirRelativePath));
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const files = [];
  for (const packageSpec of selectedPackageSpecs) {
    const sbom = createAutoCutPackageSbom({
      rootDir: resolvedRootDir,
      packageId: packageSpec.packageId,
      generatedAt,
    });
    const outputPath = path.join(resolvedOutputDir, `${packageSpec.packageId}.cdx.json`);
    fs.writeFileSync(`${outputPath}.tmp`, `${JSON.stringify(sbom, null, 2)}\n`);
    fs.renameSync(`${outputPath}.tmp`, outputPath);
    files.push({
      packageId: packageSpec.packageId,
      outputPath,
      componentCount: sbom.components.length,
    });
  }
  return {
    outputDir: resolvedOutputDir,
    files,
    summary: {
      packageCount: files.length,
      componentCount: files.reduce((sum, file) => sum + file.componentCount, 0),
    },
  };
}

export function formatAutoCutPackageSbomFilesMessage(result) {
  return `ok - autocut package SBOM files ${result.outputDir} packages=${result.summary.packageCount} components=${result.summary.componentCount}`;
}

function readDependencyContext(rootDir) {
  const pnpmLockPath = path.join(rootDir, 'pnpm-lock.yaml');
  const cargoLockPath = path.join(rootDir, desktopCargoRelativePath, 'Cargo.lock');
  const cargoManifestPath = path.join(rootDir, desktopCargoRelativePath, 'Cargo.toml');
  if (!fs.existsSync(pnpmLockPath) || !fs.statSync(pnpmLockPath).isFile()) {
    throw new Error(`missing AutoCut pnpm lockfile: ${pnpmLockPath}`);
  }
  if (!fs.existsSync(cargoManifestPath) || !fs.statSync(cargoManifestPath).isFile()) {
    throw new Error(`missing AutoCut Cargo manifest: ${cargoManifestPath}`);
  }
  if (!fs.existsSync(cargoLockPath) || !fs.statSync(cargoLockPath).isFile()) {
    throw new Error(`missing AutoCut Cargo lockfile: ${cargoLockPath}`);
  }
  const workspacePackages = readWorkspacePackageManifests(rootDir);
  const pnpmLockSource = fs.readFileSync(pnpmLockPath, 'utf8');
  const catalogVersions = parsePnpmCatalogVersions(pnpmLockSource);
  const pnpmSnapshots = parsePnpmSnapshotDependencies(pnpmLockSource);
  const npmRuntimePackageVersions = expandNpmRuntimeDependencyClosure(workspacePackages, catalogVersions, pnpmSnapshots);
  assertAllNpmRuntimeDependenciesResolved(workspacePackages, catalogVersions);
  return {
    workspacePackages,
    catalogVersions,
    npmRuntimePackageVersions,
    cargoManifestSource: fs.readFileSync(cargoManifestPath, 'utf8'),
    cargoPackages: parseCargoLockPackages(fs.readFileSync(cargoLockPath, 'utf8')),
  };
}

function readWorkspacePackageManifests(rootDir) {
  const packagePaths = [
    path.join(rootDir, 'package.json'),
    ...listPackageJsonFiles(path.join(rootDir, 'packages')),
  ];
  return packagePaths.map((packagePath) => {
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    };
    return {
      name: String(manifest.name ?? path.basename(path.dirname(packagePath))),
      version: String(manifest.version ?? readAutoCutReleaseVersion(rootDir)),
      private: manifest.private === true,
      relativePath: path.relative(rootDir, packagePath).replaceAll(path.sep, '/'),
      dependencies,
    };
  });
}

function listPackageJsonFiles(packagesDir) {
  if (!fs.existsSync(packagesDir) || !fs.statSync(packagesDir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, 'package.json'))
    .filter((packagePath) => fs.existsSync(packagePath) && fs.statSync(packagePath).isFile())
    .sort((left, right) => left.localeCompare(right));
}

function createWorkspaceComponents(workspacePackages, catalogVersions) {
  return workspacePackages.map((manifest) => ({
    type: 'library',
    'bom-ref': createNpmBomRef(manifest.name, manifest.version),
    name: manifest.name,
    version: manifest.version,
    purl: createNpmBomRef(manifest.name, manifest.version),
    properties: [
      { name: 'sdkwork:autocut:workspacePackage', value: 'true' },
      { name: 'sdkwork:autocut:manifestPath', value: manifest.relativePath },
      { name: 'sdkwork:autocut:dependencyCount', value: String(Object.keys(manifest.dependencies).length) },
      { name: 'sdkwork:autocut:lockfileResolved', value: String(allDependenciesResolved(manifest.dependencies, catalogVersions)) },
    ],
  }));
}

function createNpmExternalComponents(npmRuntimePackageVersions) {
  return [...npmRuntimePackageVersions.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([name, version]) => {
    return {
      type: 'library',
      'bom-ref': createNpmBomRef(name, version),
      name,
      version,
      purl: createNpmBomRef(name, version),
      properties: [
        { name: 'sdkwork:autocut:packageManager', value: 'pnpm' },
        { name: 'sdkwork:autocut:lockfileResolved', value: String(version !== 'unresolved') },
      ],
    };
  });
}

function createCargoComponents(cargoPackages, runtimePackageKeys) {
  return cargoPackages
    .filter((entry) => runtimePackageKeys.has(createCargoPackageKey(entry.name, entry.version)))
    .map((entry) => ({
      type: 'library',
      'bom-ref': `pkg:cargo/${encodePurlName(entry.name)}@${encodeURIComponent(entry.version)}`,
      name: entry.name,
      version: entry.version,
      purl: `pkg:cargo/${encodePurlName(entry.name)}@${encodeURIComponent(entry.version)}`,
      ...(entry.checksum
        ? {
            hashes: [
              {
                alg: 'SHA-256',
                content: entry.checksum,
              },
            ],
          }
        : {}),
      properties: [
        { name: 'sdkwork:autocut:packageManager', value: 'cargo' },
        { name: 'sdkwork:autocut:source', value: entry.source ?? 'workspace' },
      ],
    }));
}

function parsePnpmCatalogVersions(source) {
  const versions = new Map();
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const nameMatch = lines[index].match(/^ {4}('?[^':]+(?:\/[^':]+)?'?):\s*$/u);
    if (!nameMatch) {
      continue;
    }
    const name = nameMatch[1].replace(/^'|'$/gu, '');
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 6); lookahead += 1) {
      const versionMatch = lines[lookahead].match(/^ {6}version:\s*(.+?)\s*$/u);
      if (versionMatch) {
        versions.set(name, versionMatch[1].replace(/^'|'$/gu, ''));
        break;
      }
      if (/^ {4}\S/u.test(lines[lookahead])) {
        break;
      }
    }
  }
  return versions;
}

function parsePnpmSnapshotDependencies(source) {
  const snapshots = new Map();
  const lines = source.split(/\r?\n/u);
  let inSnapshots = false;
  let currentPackageKey = '';
  let inDependencies = false;
  for (const line of lines) {
    if (line === 'snapshots:') {
      inSnapshots = true;
      continue;
    }
    if (!inSnapshots) {
      continue;
    }
    const packageMatch = line.match(/^  ('?[^'\s].*?):(?: \{\})?\s*$/u);
    if (packageMatch) {
      currentPackageKey = parsePnpmPackageSpecifier(packageMatch[1].replace(/^'|'$/gu, ''));
      if (currentPackageKey) {
        snapshots.set(currentPackageKey, []);
      }
      inDependencies = false;
      continue;
    }
    if (!currentPackageKey) {
      continue;
    }
    if (/^    dependencies:\s*$/u.test(line) || /^    optionalDependencies:\s*$/u.test(line)) {
      inDependencies = true;
      continue;
    }
    if (/^    [A-Za-z]/u.test(line) && !/^    (dependencies|optionalDependencies):/u.test(line)) {
      inDependencies = false;
    }
    if (!inDependencies) {
      continue;
    }
    const dependencyMatch = line.match(/^      ('?[^':]+'?):\s*(.+?)\s*$/u);
    if (!dependencyMatch) {
      continue;
    }
    const name = dependencyMatch[1].replace(/^'|'$/gu, '');
    const version = parsePnpmDependencyVersion(dependencyMatch[2]);
    if (version) {
      snapshots.get(currentPackageKey).push({ name, version });
    }
  }
  return snapshots;
}

function expandNpmRuntimeDependencyClosure(workspacePackages, catalogVersions, pnpmSnapshots) {
  const workspaceNames = new Set(workspacePackages.map((manifest) => manifest.name));
  const selected = new Map();
  const queue = [];
  for (const manifest of workspacePackages) {
    for (const [name, specifier] of Object.entries(manifest.dependencies)) {
      if (workspaceNames.has(name) || String(specifier).startsWith('workspace:')) {
        continue;
      }
      const version = catalogVersions.get(name) ?? '';
      if (version) {
        queue.push({ name, version });
      }
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const dependency = queue[index];
    const existingVersion = selected.get(dependency.name);
    if (existingVersion === dependency.version) {
      continue;
    }
    if (existingVersion && existingVersion !== dependency.version) {
      throw new Error(`ambiguous AutoCut npm runtime dependency version: ${dependency.name}`);
    }
    selected.set(dependency.name, dependency.version);
    for (const transitive of pnpmSnapshots.get(createNpmPackageKey(dependency.name, dependency.version)) ?? []) {
      queue.push(transitive);
    }
  }
  return selected;
}

function parsePnpmDependencyVersion(value) {
  return String(value).split('(')[0].trim().replace(/^'|'$/gu, '');
}

function parsePnpmPackageSpecifier(specifier) {
  const withoutPeers = String(specifier).replace(/^'|'$/gu, '').split('(')[0];
  const separator = withoutPeers.lastIndexOf('@');
  if (separator <= 0) {
    return '';
  }
  const name = withoutPeers.slice(0, separator);
  const version = withoutPeers.slice(separator + 1);
  return name && version ? createNpmPackageKey(name, version) : '';
}

function parseCargoLockPackages(source) {
  const packages = [];
  for (const block of source.split(/\n\[\[package\]\]\r?\n/u)) {
    if (!block.includes('name = ')) {
      continue;
    }
    const name = matchTomlString(block, 'name');
    const version = matchTomlString(block, 'version');
    if (!name || !version) {
      continue;
    }
    packages.push({
      name,
      version,
      source: matchTomlString(block, 'source'),
      checksum: matchTomlString(block, 'checksum'),
      dependencies: matchTomlStringArray(block, 'dependencies').map(parseCargoDependencyReference),
    });
  }
  return packages.sort((left, right) => `${left.name}:${left.version}`.localeCompare(`${right.name}:${right.version}`));
}

function selectCargoRuntimeDependencyNames(cargoManifestSource, cargoPackages, platform) {
  const allowedRootNames = new Set(parseCargoDependencySectionNames(cargoManifestSource, 'dependencies'));
  if (platform === 'windows-x86_64') {
    for (const name of parseCargoDependencySectionNames(cargoManifestSource, "target.'cfg(windows)'.dependencies")) {
      allowedRootNames.add(name);
    }
  }
  const rootPackage = cargoPackages.find((entry) => entry.name === 'sdkwork-video-cut-desktop');
  const rootReferences = rootPackage
    ? rootPackage.dependencies.filter((reference) => allowedRootNames.has(reference.name))
    : [...allowedRootNames].map((name) => ({ name, version: '' }));
  return expandCargoDependencyClosure(rootReferences, cargoPackages);
}

function expandCargoDependencyClosure(rootReferences, cargoPackages) {
  const packagesByName = new Map();
  const packagesByNameVersion = new Map();
  for (const cargoPackage of cargoPackages) {
    if (!packagesByName.has(cargoPackage.name)) {
      packagesByName.set(cargoPackage.name, []);
    }
    packagesByName.get(cargoPackage.name).push(cargoPackage);
    packagesByNameVersion.set(createCargoPackageKey(cargoPackage.name, cargoPackage.version), cargoPackage);
  }

  const selectedKeys = new Set();
  const selectedNames = new Set();
  const queue = [...rootReferences].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
  for (let index = 0; index < queue.length; index += 1) {
    const reference = queue[index];
    for (const cargoPackage of resolveCargoPackageReference(reference, packagesByName, packagesByNameVersion)) {
      const key = createCargoPackageKey(cargoPackage.name, cargoPackage.version);
      if (selectedKeys.has(key)) {
        continue;
      }
      selectedKeys.add(key);
      selectedNames.add(cargoPackage.name);
      for (const dependencyReference of cargoPackage.dependencies) {
        const dependencyKey = dependencyReference.version
          ? createCargoPackageKey(dependencyReference.name, dependencyReference.version)
          : dependencyReference.name;
        if (!selectedKeys.has(dependencyKey) && !selectedNames.has(dependencyReference.name)) {
          queue.push(dependencyReference);
        }
      }
    }
  }
  return selectedKeys;
}

function resolveCargoPackageReference(reference, packagesByName, packagesByNameVersion) {
  if (reference.version) {
    const candidate = packagesByNameVersion.get(createCargoPackageKey(reference.name, reference.version));
    return candidate ? [candidate] : [];
  }
  const candidates = packagesByName.get(reference.name) ?? [];
  if (candidates.length > 1) {
    throw new Error(`ambiguous AutoCut Cargo dependency reference: ${reference.name}`);
  }
  return candidates;
}

function parseCargoDependencySectionNames(source, sectionName) {
  const names = new Set();
  const lines = source.split(/\r?\n/u);
  let inSection = false;
  for (const line of lines) {
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*$/u);
    if (sectionMatch) {
      inSection = sectionMatch[1] === sectionName;
      continue;
    }
    if (!inSection || line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    const dependencyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=/u);
    if (dependencyMatch) {
      names.add(dependencyMatch[1]);
    }
  }
  return names;
}

function matchTomlString(block, key) {
  const match = block.match(new RegExp(`^${key} = "([^"]+)"`, 'mu'));
  return match?.[1] ?? '';
}

function matchTomlStringArray(block, key) {
  const match = block.match(new RegExp(`^${key} = \\[\\s*([\\s\\S]*?)^\\]`, 'mu'));
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

function parseCargoDependencyReference(dependency) {
  const value = String(dependency);
  const match = value.match(/^(.+?)\s+(\d[\w.+-]*)$/u);
  return match
    ? { name: match[1], version: match[2] }
    : { name: value, version: '' };
}

function createCargoPackageKey(name, version) {
  return `${name}@${version}`;
}

function allDependenciesResolved(dependencies, catalogVersions) {
  for (const [name, specifier] of Object.entries(dependencies)) {
    if (String(specifier).startsWith('workspace:')) {
      continue;
    }
    if (!catalogVersions.has(name)) {
      return false;
    }
  }
  return true;
}

function assertAllNpmRuntimeDependenciesResolved(workspacePackages, catalogVersions) {
  const workspaceNames = new Set(workspacePackages.map((manifest) => manifest.name));
  const unresolved = new Set();
  for (const manifest of workspacePackages) {
    for (const [name, specifier] of Object.entries(manifest.dependencies)) {
      if (workspaceNames.has(name) || String(specifier).startsWith('workspace:')) {
        continue;
      }
      if (!catalogVersions.has(name)) {
        unresolved.add(name);
      }
    }
  }
  if (unresolved.size > 0) {
    throw new Error(`unresolved AutoCut npm runtime dependency versions: ${[...unresolved].sort().join(', ')}`);
  }
}

function selectPackageSpecs({ packageIds, platform }) {
  let specs = packageSpecs;
  if (platform) {
    specs = specs.filter((spec) => spec.platform === platform);
    if (specs.length === 0) {
      throw new Error(`Unsupported AutoCut release SBOM platform: ${platform}`);
    }
  }
  if (packageIds?.length) {
    const selected = packageIds.map((packageId) => getPackageSpec(packageId));
    if (platform && selected.some((spec) => spec.platform !== platform)) {
      throw new Error('AutoCut SBOM package ids must match the selected platform.');
    }
    return selected;
  }
  return specs;
}

function getPackageSpec(packageId) {
  const spec = packageSpecs.find((candidate) => candidate.packageId === packageId);
  if (!spec) {
    throw new Error(`Unsupported AutoCut release package id: ${packageId}`);
  }
  return spec;
}

function createRootBomRef(packageId, version) {
  return `pkg:generic/sdkwork-video-cut@${encodeURIComponent(version)}?package-id=${encodeURIComponent(packageId)}`;
}

function createNpmBomRef(name, version) {
  return `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(version)}`;
}

function createNpmPackageKey(name, version) {
  return `${name}@${version}`;
}

function encodePurlName(name) {
  return String(name).split('/').map((part) => encodeURIComponent(part)).join('/');
}

function createDeterministicUrnUuid(value) {
  const digest = crypto.createHash('sha256').update(value).digest('hex');
  return `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut package SBOM files',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--package-id') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut package SBOM files',
      });
      options.packageIds = [...(options.packageIds ?? []), option.value];
      index = option.nextIndex;
    } else if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut package SBOM files',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut package SBOM files argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutPackageSbomFiles(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutPackageSbomFilesMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
