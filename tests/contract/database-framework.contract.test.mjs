#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabaseFramework } from '../../../sdkwork-specs/tools/check-database-framework-standard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = validateDatabaseFramework(root);
assert.equal(result.skipped, false, 'application must own database/');
assert.equal(result.ok, true, `database framework validation failed: ${result.failures.join('; ')}`);

const sync = spawnSync(process.execPath, [path.join(root, 'tools/check-videocut-baseline-sync.mjs')], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(sync.status, 0, sync.stderr || sync.stdout || 'videocut baseline sync check failed');

process.stdout.write('database-framework.contract.test.mjs passed\n');
