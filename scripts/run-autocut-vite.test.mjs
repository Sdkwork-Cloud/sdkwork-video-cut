#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutViteEnvironmentReport,
  createAutoCutViteSpawnSpec,
  formatAutoCutViteEnvironmentError,
} from './run-autocut-vite.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const missingRoot = tempRoot('autocut-vite-missing');
const missingReport = createAutoCutViteEnvironmentReport({ rootDir: missingRoot });
assert.equal(missingReport.ready, false);
assert.deepEqual(
  missingReport.blockers.map((blocker) => blocker.code),
  ['PNPM_MODULES_MANIFEST_MISSING', 'VITE_PACKAGE_MISSING', 'ESBUILD_PACKAGE_MISSING'],
);
assert.match(
  formatAutoCutViteEnvironmentError(missingReport),
  /Run `pnpm\.cmd install --frozen-lockfile` from the AutoCut workspace root/u,
);

const readyRoot = tempRoot('autocut-vite-ready');
fs.mkdirSync(path.join(readyRoot, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(readyRoot, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
writeJson(path.join(readyRoot, 'node_modules', 'vite', 'package.json'), {
  bin: {
    vite: 'bin/vite.js',
  },
});
fs.mkdirSync(path.join(readyRoot, 'node_modules', 'vite', 'bin'), { recursive: true });
fs.writeFileSync(path.join(readyRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '#!/usr/bin/env node\n');
writeJson(path.join(readyRoot, 'node_modules', 'esbuild', 'package.json'), {
  name: 'esbuild',
});
const readyReport = createAutoCutViteEnvironmentReport({ rootDir: readyRoot });
assert.equal(readyReport.ready, true);
assert.deepEqual(readyReport.blockers, []);

const spawnSpec = createAutoCutViteSpawnSpec({
  rootDir: readyRoot,
  cwd: path.join(readyRoot, 'packages', 'sdkwork-autocut-desktop'),
  args: ['--host', '127.0.0.1', '--port', '3000'],
});
assert.equal(spawnSpec.command, process.execPath);
assert.equal(spawnSpec.args[0], path.join(readyRoot, 'node_modules', 'vite', 'bin', 'vite.js'));
assert.deepEqual(spawnSpec.args.slice(1), ['--host', '127.0.0.1', '--port', '3000']);
assert.equal(spawnSpec.cwd, path.join(readyRoot, 'packages', 'sdkwork-autocut-desktop'));

const pnpmIsolatedRoot = tempRoot('autocut-vite-pnpm-isolated');
fs.mkdirSync(path.join(pnpmIsolatedRoot, 'node_modules', '.pnpm', 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(pnpmIsolatedRoot, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
const pnpmViteDir = path.join(
  pnpmIsolatedRoot,
  'node_modules',
  '.pnpm',
  'vite@6.4.2_@types+node@22.19.17',
  'node_modules',
  'vite',
);
writeJson(path.join(pnpmViteDir, 'package.json'), {
  bin: {
    vite: 'bin/vite.js',
  },
});
fs.mkdirSync(path.join(pnpmViteDir, 'bin'), { recursive: true });
fs.writeFileSync(path.join(pnpmViteDir, 'bin', 'vite.js'), '#!/usr/bin/env node\n');
writeJson(path.join(pnpmIsolatedRoot, 'node_modules', '.pnpm', 'node_modules', 'esbuild', 'package.json'), {
  name: 'esbuild',
});
fs.symlinkSync(pnpmViteDir, path.join(pnpmIsolatedRoot, 'node_modules', 'vite'), 'junction');
const pnpmIsolatedReport = createAutoCutViteEnvironmentReport({ rootDir: pnpmIsolatedRoot });
assert.equal(pnpmIsolatedReport.ready, true);
assert.deepEqual(pnpmIsolatedReport.blockers, []);
assert.equal(
  pnpmIsolatedReport.esbuildPackagePath,
  path.join(pnpmIsolatedRoot, 'node_modules', '.pnpm', 'node_modules', 'esbuild', 'package.json'),
);

console.log('ok - autocut vite runner contract');
