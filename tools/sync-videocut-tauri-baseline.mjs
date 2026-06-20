#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'database/ddl/baseline/sqlite/0001_videocut_legacy_baseline.sql');
const target = path.join(
  root,
  'packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql',
);

const sql = fs.readFileSync(source, 'utf8');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, sql, 'utf8');
process.stdout.write(`synced framework sqlite baseline to ${path.relative(root, target)}\n`);
