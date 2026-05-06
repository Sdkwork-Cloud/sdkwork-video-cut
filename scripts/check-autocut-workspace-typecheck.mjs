#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);

export function createAutoCutWorkspaceTypecheckReport({
  rootDir = process.cwd(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const packages = discoverWorkspacePackageTypecheckTargets(resolvedRootDir)
    .map((target) => createTypeScriptProjectTypecheckSnapshot(target));
  const root = createRootTypecheckSnapshot(resolvedRootDir);
  const failingPackages = packages.filter((entry) => !entry.ready);
  return {
    ready: root.ready && failingPackages.length === 0,
    root,
    packages,
    failingPackages: failingPackages.map((entry) => entry.name),
  };
}

export function formatAutoCutWorkspaceTypecheckMessage(report) {
  if (report.ready) {
    return `ok - autocut workspace typecheck packages=${report.packages.length}`;
  }
  return `blocked - autocut workspace typecheck packages=${report.packages.length} failing=${report.failingPackages.length + (report.root.ready ? 0 : 1)}`;
}

function discoverWorkspacePackageTypecheckTargets(rootDir) {
  const packagesDir = path.join(rootDir, 'packages');
  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageDir = path.join(packagesDir, entry.name);
      const packageJsonPath = path.join(packageDir, 'package.json');
      const tsconfigPath = path.join(packageDir, 'tsconfig.json');
      if (!fs.existsSync(packageJsonPath) || !fs.existsSync(tsconfigPath)) {
        return undefined;
      }
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return {
        name: typeof packageJson.name === 'string' && packageJson.name.trim()
          ? packageJson.name.trim()
          : entry.name,
        rootDir,
        projectDir: packageDir,
        tsconfigPath,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createRootTypecheckSnapshot(rootDir) {
  const tsconfigPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: '@sdkwork/video-cut-root',
      path: 'tsconfig.json',
      ready: true,
      skipped: true,
      diagnostics: [],
    };
  }

  return createTypeScriptProjectTypecheckSnapshot({
    name: '@sdkwork/video-cut-root',
    rootDir,
    projectDir: rootDir,
    tsconfigPath,
  });
}

function createTypeScriptProjectTypecheckSnapshot({
  name,
  rootDir,
  projectDir,
  tsconfigPath,
}) {
  const parsed = readTypeScriptConfig(tsconfigPath);
  const host = ts.createCompilerHost(parsed.options, true);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      noEmit: true,
    },
    projectReferences: parsed.projectReferences,
    host,
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => formatDiagnostic(diagnostic, rootDir));

  return {
    name,
    path: toPosixRelative(rootDir, projectDir),
    tsconfigPath: toPosixRelative(rootDir, tsconfigPath),
    ready: diagnostics.length === 0,
    diagnostics,
  };
}

function readTypeScriptConfig(tsconfigPath) {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) {
    const message = ts.formatDiagnosticsWithColorAndContext([config.error], createDiagnosticHost(path.dirname(tsconfigPath)));
    throw new Error(message.trim());
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(tsconfigPath),
    {
      noEmit: true,
    },
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    const message = ts.formatDiagnosticsWithColorAndContext(
      parsed.errors,
      createDiagnosticHost(path.dirname(tsconfigPath)),
    );
    throw new Error(message.trim());
  }
  return parsed;
}

function formatDiagnostic(diagnostic, rootDir) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relativePath = toPosixRelative(rootDir, diagnostic.file.fileName);
  return `${relativePath}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`;
}

function createDiagnosticHost(currentDirectory) {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => currentDirectory,
    getNewLine: () => '\n',
  };
}

function toPosixRelative(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return relative ? relative.replaceAll(path.sep, '/') : '.';
}

function main() {
  const report = createAutoCutWorkspaceTypecheckReport();
  console.log(formatAutoCutWorkspaceTypecheckMessage(report));
  if (!report.ready) {
    for (const entry of [report.root, ...report.packages]) {
      if (entry.ready) {
        continue;
      }
      console.error(`${entry.name} (${entry.tsconfigPath}):`);
      for (const diagnostic of entry.diagnostics.slice(0, 20)) {
        console.error(`- ${diagnostic}`);
      }
    }
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
