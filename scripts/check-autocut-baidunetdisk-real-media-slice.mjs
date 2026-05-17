#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  formatAutoCutWenan5RealMediaSliceCheckMessage,
  runAutoCutWenan5RealMediaSliceCheck,
} from './check-autocut-wenan5-real-media-slice.mjs';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const defaultBaiduNetdiskRootDir = 'E:/BaiduNetdiskDownload';
const defaultOutputDir = 'artifacts/autocut-diagnostics/wenan5/slices-baidunetdisk-current';
const defaultCandidatePattern = /5\.mp4$/iu;

export function findAutoCutBaiduNetdiskSmartSliceVideoCandidates({
  rootDir = defaultBaiduNetdiskRootDir,
  entries,
  candidatePattern = defaultCandidatePattern,
} = {}) {
  const resolvedEntries = entries ?? fs.readdirSync(rootDir, { withFileTypes: true });
  return resolvedEntries
    .filter((entry) => entry.isFile() && candidatePattern.test(entry.name))
    .map((entry) => toPortableMediaPath(path.join(rootDir, entry.name)))
    .sort((firstPath, secondPath) => firstPath.localeCompare(secondPath));
}

export function createAutoCutBaiduNetdiskRealMediaSliceAcceptanceOptions({
  rootDir = defaultBaiduNetdiskRootDir,
  candidates,
  outputDir = defaultOutputDir,
  transcriptPath,
  ffmpegPath,
  ffprobePath,
  profile,
} = {}) {
  const resolvedCandidates = candidates ?? findAutoCutBaiduNetdiskSmartSliceVideoCandidates({ rootDir });
  const inputPath = resolvedCandidates[0];
  if (!inputPath) {
    throw new Error(`No candidate MP4 ending with 5.MP4 found under ${rootDir}`);
  }

  return {
    inputPath,
    outputDir,
    ...(transcriptPath ? { transcriptPath } : {}),
    ...(ffmpegPath ? { ffmpegPath } : {}),
    ...(ffprobePath ? { ffprobePath } : {}),
    ...(profile ? { profile } : {}),
  };
}

export async function runAutoCutBaiduNetdiskRealMediaSliceAcceptanceCheck(options = {}) {
  const coreOptions = createAutoCutBaiduNetdiskRealMediaSliceAcceptanceOptions(options);
  return runAutoCutWenan5RealMediaSliceCheck(coreOptions);
}

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut BaiduNetdisk real media Smart Slice acceptance check',
      });
      options.rootDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut BaiduNetdisk real media Smart Slice acceptance check',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--transcript') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut BaiduNetdisk real media Smart Slice acceptance check',
      });
      options.transcriptPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut BaiduNetdisk real media Smart Slice acceptance check',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffprobe') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut BaiduNetdisk real media Smart Slice acceptance check',
      });
      options.ffprobePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--profile') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut BaiduNetdisk real media Smart Slice acceptance check',
      });
      options.profile = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`unknown AutoCut BaiduNetdisk real media Smart Slice acceptance option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const result = await runAutoCutBaiduNetdiskRealMediaSliceAcceptanceCheck(parseArgs(process.argv.slice(2)));
    console.log(formatAutoCutWenan5RealMediaSliceCheckMessage(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function toPortableMediaPath(mediaPath) {
  return String(mediaPath).replaceAll('\\', '/');
}
