#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameworkBaseline = path.join(
  root,
  'database/ddl/baseline/sqlite/0001_videocut_legacy_baseline.sql',
);
const tauriBaseline = path.join(
  root,
  'packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql',
);

for (const filePath of [frameworkBaseline, tauriBaseline]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing required baseline file: ${path.relative(root, filePath)}`);
  }
}

const frameworkSql = fs.readFileSync(frameworkBaseline, 'utf8');
const tauriSql = fs.readFileSync(tauriBaseline, 'utf8');
const frameworkHash = crypto.createHash('sha256').update(frameworkSql).digest('hex');
const tauriHash = crypto.createHash('sha256').update(tauriSql).digest('hex');

if (frameworkHash !== tauriHash) {
  throw new Error(
    'videocut framework and Tauri sqlite baselines are out of sync; run pnpm run db:materialize:contract',
  );
}

process.stdout.write('videocut baseline sync check passed\n');
