import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

const generatedPaths = [
  'dist',
  'artifacts/runtime',
  'packages/sdkwork-autocut-desktop/dist',
  'packages/sdkwork-autocut-desktop/src-tauri/target',
  'packages/sdkwork-autocut-desktop/src-tauri/gen',
];

function assertInsideWorkspace(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const relativeFromRoot = path.relative(rootDir, absolutePath);
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Refusing to clean path outside workspace: ${relativePath}`);
  }
  return absolutePath;
}

for (const relativePath of generatedPaths) {
  fs.rmSync(assertInsideWorkspace(relativePath), { recursive: true, force: true });
}

console.log(`Cleaned ${generatedPaths.length} AutoCut generated paths.`);
