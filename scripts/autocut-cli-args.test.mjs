#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

assert.deepEqual(
  normalizeAutoCutCliArgs(['--', '--platform', 'windows-x86_64', '--skip-executable-smoke']),
  ['--platform', 'windows-x86_64', '--skip-executable-smoke'],
);
assert.deepEqual(
  normalizeAutoCutCliArgs(['--task', 'artifacts/smart-slice/smart-slice-task.json']),
  ['--task', 'artifacts/smart-slice/smart-slice-task.json'],
);
assert.deepEqual(
  normalizeAutoCutCliArgs(['--root', 'D:/tmp/fixture', '--', '--profile', 'ready']),
  ['--root', 'D:/tmp/fixture', '--profile', 'ready'],
);

assert.equal(
  readAutoCutCliOptionValue(['--task', 'artifacts/smart-slice/smart-slice-task.json'], 0, {
    optionName: '--task',
    commandName: 'AutoCut smart slice task evidence',
  }).value,
  'artifacts/smart-slice/smart-slice-task.json',
);
assert.equal(
  readAutoCutCliOptionValue(['--task', 'artifacts/smart-slice/smart-slice-task.json'], 0, {
    optionName: '--task',
    commandName: 'AutoCut smart slice task evidence',
  }).nextIndex,
  1,
);
assert.throws(
  () => readAutoCutCliOptionValue(['--task'], 0, {
    optionName: '--task',
    commandName: 'AutoCut smart slice task evidence',
  }),
  /Missing value for AutoCut smart slice task evidence argument --task/u,
);
assert.throws(
  () => readAutoCutCliOptionValue(['--task', '--output'], 0, {
    optionName: '--task',
    commandName: 'AutoCut smart slice task evidence',
  }),
  /Missing value for AutoCut smart slice task evidence argument --task/u,
);
assert.throws(
  () => readAutoCutCliOptionValue(['--output', ''], 0, {
    optionName: '--output',
    commandName: 'AutoCut release evidence',
  }),
  /Missing value for AutoCut release evidence argument --output/u,
);

console.log('ok - autocut cli args contract');
