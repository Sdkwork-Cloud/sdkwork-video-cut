#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutWorkspaceTypecheckReport,
  formatAutoCutWorkspaceTypecheckMessage,
} from './check-autocut-workspace-typecheck.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const root = tempRoot('autocut-workspace-typecheck');
writeJson(path.join(root, 'package.json'), {
  scripts: {
    typecheck: 'node scripts/check-autocut-workspace-typecheck.mjs',
  },
});
writeJson(path.join(root, 'tsconfig.json'), {
  compilerOptions: {
    noEmit: true,
    skipLibCheck: true,
  },
  files: ['root.ts'],
});
fs.writeFileSync(path.join(root, 'root.ts'), 'export {};\n');
writeJson(path.join(root, 'packages/a/package.json'), {
  name: '@sdkwork/autocut-a',
  scripts: {
    typecheck: 'tsc --noEmit',
  },
});
writeJson(path.join(root, 'packages/a/tsconfig.json'), {
  compilerOptions: {
    noEmit: true,
    strict: true,
  },
  files: ['src/index.ts'],
});
fs.mkdirSync(path.join(root, 'packages/a/src'), { recursive: true });
fs.writeFileSync(path.join(root, 'packages/a/src/index.ts'), 'export const value: number = 1;\n');

const report = createAutoCutWorkspaceTypecheckReport({
  rootDir: root,
});

assert.equal(report.ready, true);
assert.equal(report.packages.length, 1);
assert.equal(report.packages[0].name, '@sdkwork/autocut-a');
assert.equal(report.packages[0].ready, true);
assert.equal(report.root.ready, true);
assert.equal(formatAutoCutWorkspaceTypecheckMessage(report), 'ok - autocut workspace typecheck packages=1');

const failingRoot = tempRoot('autocut-workspace-typecheck-failing');
writeJson(path.join(failingRoot, 'package.json'), {});
writeJson(path.join(failingRoot, 'packages/b/package.json'), {
  name: '@sdkwork/autocut-b',
});
writeJson(path.join(failingRoot, 'packages/b/tsconfig.json'), {
  compilerOptions: {
    noEmit: true,
    strict: true,
  },
  files: ['src/index.ts'],
});
fs.mkdirSync(path.join(failingRoot, 'packages/b/src'), { recursive: true });
fs.writeFileSync(path.join(failingRoot, 'packages/b/src/index.ts'), 'export const value: number = "bad";\n');

const failingReport = createAutoCutWorkspaceTypecheckReport({
  rootDir: failingRoot,
});

assert.equal(failingReport.ready, false);
assert.equal(failingReport.packages.length, 1);
assert.equal(failingReport.packages[0].ready, false);
assert.match(failingReport.packages[0].diagnostics[0], /Type 'string' is not assignable to type 'number'/u);
assert.equal(
  formatAutoCutWorkspaceTypecheckMessage(failingReport),
  'blocked - autocut workspace typecheck packages=1 failing=1',
);

console.log('ok - autocut workspace typecheck contract');
