#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createAutoCutWenan5RealMediaSlicePlan,
  formatAutoCutWenan5RealMediaSliceCheckMessage,
  parseSilencedetectIntervals,
  runAutoCutWenan5RealMediaSliceCheck,
} from './check-autocut-wenan5-real-media-slice.mjs';
import {
  createAutoCutBaiduNetdiskRealMediaSliceAcceptanceOptions,
  findAutoCutBaiduNetdiskSmartSliceVideoCandidates,
} from './check-autocut-baidunetdisk-real-media-slice.mjs';

const commandCalls = [];
const renderedDurationsByPath = new Map();
const trackedTranscriptFixturePath = path.join(
  'scripts',
  'fixtures',
  'autocut',
  'wenan5',
  'speech-transcript.json',
);
const result = await runAutoCutWenan5RealMediaSliceCheck({
  inputPath: 'D:/media/wenan5.mp4',
  transcriptPath: trackedTranscriptFixturePath,
  outputDir: 'artifacts/autocut-diagnostics/wenan5/slices-real-media-contract',
  runCommand(command, args) {
    commandCalls.push({ command, args });
    const argText = args.join(' ');

    if (command === 'ffprobe' && argText.includes('format=duration') && args.at(-1)?.includes('compact.mp4')) {
      const outputPath = args.at(-1);
      const durationMs = renderedDurationsByPath.get(outputPath);
      assert.equal(typeof durationMs, 'number', `mock ffprobe must know rendered duration for ${outputPath}`);
      return { status: 0, stdout: `${(durationMs / 1_000).toFixed(6)}\n`, stderr: '' };
    }
    if (command === 'ffprobe' && argText.includes('format=duration')) {
      return { status: 0, stdout: '182.360000\n', stderr: '' };
    }
    if (command === 'ffprobe' && argText.includes('-select_streams a:0')) {
      return { status: 0, stdout: '1\n', stderr: '' };
    }
    if (command === 'ffprobe' && argText.includes('-show_streams')) {
      if (args.at(-1)?.includes('compact.mp4')) {
        return {
          status: 0,
          stdout: 'width=1080\nheight=1920\n',
          stderr: '',
        };
      }
      return {
        status: 0,
        stdout: 'width=1920\nheight=1080\nTAG:rotate=90\n[SIDE_DATA]\nside_data_type=Display Matrix\n[/SIDE_DATA]\n',
        stderr: '',
      };
    }
    if (command === 'ffmpeg' && argText.includes('silencedetect=noise=-35dB:d=0.08')) {
      const startSeconds = Number(args[args.indexOf('-ss') + 1]);
      if (startSeconds < 60) {
        return {
          status: 0,
          stdout: '',
          stderr: [
            'silence_start: 0.000',
            'silence_end: 0.250 | silence_duration: 0.250',
            'silence_start: 0.271',
            'silence_end: 3.030 | silence_duration: 2.759',
            'silence_start: 8.099',
            'silence_end: 8.490 | silence_duration: 0.391',
            'silence_start: 9.110',
            'silence_end: 16.247 | silence_duration: 7.137',
            'silence_start: 20.960',
            'silence_end: 22.603 | silence_duration: 1.643',
            'silence_start: 29.100',
            'silence_end: 33.952 | silence_duration: 4.852',
          ].join('\n'),
        };
      }
      if (startSeconds < 100) {
        return {
          status: 0,
          stdout: '',
          stderr: [
            'silence_start: 0.020',
            'silence_end: 3.380 | silence_duration: 3.360',
            'silence_start: 5.362',
            'silence_end: 7.052 | silence_duration: 1.690',
            'silence_start: 15.941',
            'silence_end: 17.237 | silence_duration: 1.296',
            'silence_start: 21.722',
            'silence_end: 29.059 | silence_duration: 7.337',
          ].join('\n'),
        };
      }
      if (startSeconds >= 150) {
        return { status: 0, stdout: '', stderr: '' };
      }
      return {
        status: 0,
        stdout: '',
        stderr: [
          'silence_start: 0.078',
          'silence_end: 7.357 | silence_duration: 7.279',
          'silence_start: 12.205',
          'silence_end: 15.548 | silence_duration: 3.343',
          'silence_start: 17.510',
          'silence_end: 19.755 | silence_duration: 2.245',
        ].join('\n'),
      };
    }
    if (command === 'ffmpeg' && argText.includes('silencedetect=noise=-35dB:d=0.8')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg' && argText.includes('-filter_complex')) {
      assert.match(argText, /concat=n=[2-9]\d*:v=1:a=1/u);
      assert.match(argText, /sidedata=mode=delete:type=DISPLAYMATRIX/u);
      assert.match(argText, /-metadata:s:v:0 rotate=/u);
      renderedDurationsByPath.set(args.at(-1), extractCompactedRenderDurationMs(args));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg' && argText.includes('scale=1080:1920')) {
      assert.match(argText, /-metadata:s:v:0 rotate=/u);
      renderedDurationsByPath.set(args.at(-1), extractContiguousRenderDurationMs(args));
      return { status: 0, stdout: '', stderr: '' };
    }

    return { status: 1, stdout: '', stderr: `unexpected command ${command} ${argText}` };
  },
});

assert.equal(result.ready, true);
assert.equal(result.executionEvidenceReport.ready, true);
assert.equal(result.executionEvidenceReport.summary.renderedSliceCount, result.report.renderedClipCount);
assert.equal(
  typeof result.evidencePackage.reviewEventsPath === 'string' &&
    result.evidencePackage.reviewEventsPath.endsWith('evidence\\review-events.json') ||
    result.evidencePackage.reviewEventsPath.endsWith('evidence/review-events.json'),
  true,
  'real media Smart Slice acceptance writes the replayable review-events evidence file',
);
assert.equal(result.report.params.minDuration, 30);
assert.equal(result.report.params.maxDuration, 70);
assert.equal(result.report.params.idealDuration, 45);
assert.equal(result.report.params.targetPlatform, 'douyin');
assert.equal(result.report.params.targetAspectRatio, '9:16');
assert.equal(result.report.params.videoObjectFit, 'contain');
assert.equal(result.report.params.baseAlgorithm, 'nlp');
assert.equal(result.report.params.highlightEngine, 'emotion');
assert.equal(result.report.params.enableNoiseReduction, true);
assert.equal(result.report.params.enableRepeatFilter, true);
assert.equal(result.report.params.enableSubtitles, true);
assert.equal(result.report.params.subtitleMode, 'both');
assert.equal(result.report.planningEngine, 'smart-cut-engine');
assert.equal(result.report.presetId, 'teacher-talking-head-single');
assert.equal(result.report.plannedClipCount >= 3, true);
assert.equal(result.report.renderedClipCount, result.report.plannedClipCount);
assert.equal(result.report.clips.filter((clip) => (clip.sourceSegments?.length ?? 0) >= 2).length >= 1, true);
assert.equal(result.report.clips.filter((clip) => (clip.removedSilenceMs ?? 0) > 0).length >= 1, true);
assert.equal(result.report.clips.every((clip) => clip.longSilenceCount === 0), true);
assert.equal(
  result.report.clips.every((clip) =>
    typeof clip.subtitlePath === 'string' &&
      clip.subtitlePath.endsWith('.srt') &&
      clip.subtitleCueCount > 0 &&
      clip.subtitleByteSize > 0
  ),
  true,
  'real media Smart Slice acceptance writes one editable SRT sidecar for every generated subtitle-enabled slice',
);
assert.equal(
  result.report.clips.every((clip) =>
    (clip.transcriptSegments ?? []).length > 0 &&
      (clip.transcriptSegmentCount ?? 0) === (clip.transcriptSegments ?? []).length &&
      clip.blockers.length === 0
  ),
  true,
);
assert.equal(result.report.clips.at(-1).sourceStartMs <= 156_060, true);
assert.equal(result.report.clips.at(-1).sourceEndMs <= 165_010, true);
assert.equal(result.report.clips.at(-1).speechEndMs <= 164_660, true);
assert.equal(
  result.report.clips.at(-1).risks.includes('post-slice-retake-tail-filtered'),
  true,
  'new Smart Cut Engine plan must audit post-slice retake tail filtering',
);
assert.equal(
  result.report.clips.every((clip) =>
    !/(?:\u91cd\u65b0\u5f55|\u91cd\u5f55|\u7b97\u4e86|retake|record again|re-record)/iu.test(String(clip.transcriptText ?? ''))
  ),
  true,
  'rendered transcript evidence must not include retake or NG text',
);
assert.equal(result.report.clips.every((clip) => clip.longSilenceCount === 0), true);
assert.equal(
  commandCalls.filter((call) =>
    call.command === 'ffmpeg' &&
      (call.args.includes('-filter_complex') || call.args.includes('-vf'))
  ).length,
  result.report.renderedClipCount,
);
assert.deepEqual(
  parseSilencedetectIntervals(
    [
      'silence_start: 0.000',
      'silence_end: 0.250 | silence_duration: 0.250',
      'silence_start: 0.271',
      'silence_end: 3.030 | silence_duration: 2.759',
      'silence_start: 8.099',
      'silence_end: 8.490 | silence_duration: 0.391',
    ].join('\n'),
    10_000,
  ),
  [
    { startMs: 0, endMs: 3_030 },
    { startMs: 8_099, endMs: 8_490 },
  ],
  'silencedetect parser merges millisecond audio glitches inside true silent spans',
);
assert.match(
  formatAutoCutWenan5RealMediaSliceCheckMessage(result),
  /ok - wenan5 real media Smart Slice clips=\d+/u,
);

const desktopDurationPlan = await createAutoCutWenan5RealMediaSlicePlan({
  inputPath: 'D:/media/wenan5.mp4',
  transcriptPath: trackedTranscriptFixturePath,
  runCommand(command, args) {
    const argText = args.join(' ');
    if (command === 'ffprobe' && argText.includes('format=duration')) {
      return { status: 0, stdout: '182.360000\n', stderr: '' };
    }
    if (command === 'ffprobe' && argText.includes('-select_streams a:0')) {
      return { status: 0, stdout: '1\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected command ${command} ${argText}` };
  },
});
assert.equal(
  desktopDurationPlan.params.maxDuration,
  70,
  'wenan5 real media planner check defaults to the same duration ceiling used by the desktop UI repro',
);
assert.equal(
  desktopDurationPlan.params.videoObjectFit,
  'contain',
  'wenan5 real media planner check defaults to the same vertical-video object-fit used by the desktop UI repro',
);

assert.deepEqual(
  findAutoCutBaiduNetdiskSmartSliceVideoCandidates({
    rootDir: 'E:/BaiduNetdiskDownload',
    entries: [
      { name: 'readme.txt', isFile: () => true },
      { name: 'course-4.mp4', isFile: () => true },
      { name: 'course-5.MP4', isFile: () => true },
      { name: 'folder', isFile: () => false },
    ],
  }),
  ['E:/BaiduNetdiskDownload/course-5.MP4'],
  'BaiduNetdisk Smart Slice acceptance check defaults to the same real-media candidate pattern used for manual verification',
);
assert.deepEqual(
  createAutoCutBaiduNetdiskRealMediaSliceAcceptanceOptions({
    rootDir: 'E:/BaiduNetdiskDownload',
    candidates: ['E:/BaiduNetdiskDownload/course-5.MP4'],
    outputDir: 'artifacts/autocut-diagnostics/wenan5/slices-baidunetdisk-contract',
  }),
  {
    inputPath: 'E:/BaiduNetdiskDownload/course-5.MP4',
    outputDir: 'artifacts/autocut-diagnostics/wenan5/slices-baidunetdisk-contract',
  },
  'BaiduNetdisk Smart Slice acceptance check converts the discovered real media into the core Wena5 slice command options',
);

console.log('ok - wenan5 real media Smart Slice contract');

function extractContiguousRenderDurationMs(args) {
  const durationArg = getRequiredCommandOptionValue(args, '-t');
  return Math.round(Number(durationArg) * 1_000);
}

function extractCompactedRenderDurationMs(args) {
  let durationMs = 0;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '-t') {
      continue;
    }
    durationMs += Math.round(Number(getRequiredCommandOptionValueAt(args, index)) * 1_000);
  }
  return durationMs;
}

function getRequiredCommandOptionValue(args, option) {
  return getRequiredCommandOptionValueAt(args, args.indexOf(option));
}

function getRequiredCommandOptionValueAt(args, optionIndex) {
  const value = optionIndex >= 0 ? args.at(optionIndex + 1) : undefined;
  assert.equal(typeof value, 'string', `mock command must include a value after ${args.at(optionIndex) ?? 'option'}`);
  return value;
}
