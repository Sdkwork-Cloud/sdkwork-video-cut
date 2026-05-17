#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export function createAutoCutViteEnvironmentReport({
  rootDir = process.cwd(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const modulesManifestPath = path.join(resolvedRootDir, 'node_modules', '.modules.yaml');
  const vitePackagePath = path.join(resolvedRootDir, 'node_modules', 'vite', 'package.json');
  let esbuildPackagePath = path.join(resolvedRootDir, 'node_modules', 'esbuild', 'package.json');
  const blockers = [];

  if (!fs.existsSync(modulesManifestPath)) {
    blockers.push({
      code: 'PNPM_MODULES_MANIFEST_MISSING',
      message: 'AutoCut workspace node_modules is missing the PNPM modules manifest.',
    });
  }
  if (!fs.existsSync(vitePackagePath)) {
    blockers.push({
      code: 'VITE_PACKAGE_MISSING',
      message: 'AutoCut workspace node_modules is missing the Vite package.',
    });
  }
  const viteExecutablePath = blockers.some((blocker) => blocker.code === 'VITE_PACKAGE_MISSING')
    ? undefined
    : resolveViteExecutablePath(vitePackagePath);
  if (viteExecutablePath && !fs.existsSync(viteExecutablePath)) {
    blockers.push({
      code: 'VITE_EXECUTABLE_MISSING',
      message: `AutoCut workspace Vite package is missing its CLI entry: ${viteExecutablePath}`,
    });
  }
  if (!blockers.some((blocker) => blocker.code === 'VITE_PACKAGE_MISSING')) {
    esbuildPackagePath = resolvePackageJsonFromPackage(vitePackagePath, 'esbuild')
      ?? path.join(resolvedRootDir, 'node_modules', 'esbuild', 'package.json');
    if (!fs.existsSync(esbuildPackagePath)) {
      blockers.push({
        code: 'ESBUILD_PACKAGE_MISSING',
        message: 'AutoCut workspace cannot resolve the esbuild package required by Vite.',
      });
    }
  } else if (!fs.existsSync(esbuildPackagePath)) {
    blockers.push({
      code: 'ESBUILD_PACKAGE_MISSING',
      message: 'AutoCut workspace node_modules is missing the esbuild package required by Vite.',
    });
  }

  return {
    ready: blockers.length === 0,
    rootDir: resolvedRootDir,
    modulesManifestPath,
    vitePackagePath,
    esbuildPackagePath,
    viteExecutablePath,
    blockers,
  };
}

export function formatAutoCutViteEnvironmentError(report) {
  const details = report.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`).join('\n');
  return [
    'AutoCut Vite startup cannot continue because the local PNPM dependency links are incomplete.',
    details,
    'Run `pnpm.cmd install --frozen-lockfile` from the AutoCut workspace root, then retry the dev/build command.',
  ].filter(Boolean).join('\n');
}

export function createAutoCutViteSpawnSpec({
  rootDir = process.cwd(),
  cwd = process.cwd(),
  args = [],
} = {}) {
  const report = createAutoCutViteEnvironmentReport({ rootDir });
  if (!report.ready) {
    const error = new Error(formatAutoCutViteEnvironmentError(report));
    error.report = report;
    throw error;
  }

  return {
    command: process.execPath,
    args: [report.viteExecutablePath, ...args],
    cwd: path.resolve(cwd),
  };
}

function resolveViteExecutablePath(vitePackagePath) {
  const manifest = JSON.parse(fs.readFileSync(vitePackagePath, 'utf8'));
  const bin = typeof manifest.bin === 'string'
    ? manifest.bin
    : typeof manifest.bin?.vite === 'string'
      ? manifest.bin.vite
      : undefined;
  if (!bin) {
    return undefined;
  }
  return path.resolve(path.dirname(vitePackagePath), bin);
}

function resolvePackageJsonFromPackage(packageJsonPath, packageName) {
  try {
    const realPackageJsonPath = fs.realpathSync(packageJsonPath);
    const resolver = createRequire(realPackageJsonPath);
    return resolver.resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
}

function main() {
  const rootDir = path.resolve(__filename, '..', '..');
  const cwd = process.cwd();
  const spawnSpec = createAutoCutViteSpawnSpec({
    rootDir,
    cwd,
    args: process.argv.slice(2),
  });
  const result = spawnSync(spawnSpec.command, spawnSpec.args, {
    cwd: spawnSpec.cwd,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
