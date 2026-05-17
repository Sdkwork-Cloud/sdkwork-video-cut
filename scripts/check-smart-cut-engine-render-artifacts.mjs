#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  createSmartCutRenderContract,
  validateSmartCutRenderArtifacts,
} from '../packages/sdkwork-autocut-smart-cut-engine/src/index.ts';

const failures = [];
const pass = [];

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

const teacherRenderContract = createSmartCutRenderContract({
  presetId: 'teacher-talking-head-single',
  planId: 'post-slice-filter-plan-teacher',
  candidateIds: ['candidate-1'],
});

const validArtifactsReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    {
      id: 'video-candidate-1',
      candidateId: 'candidate-1',
      kind: 'rendered-video',
      path: 'D:/autocut/output/candidate-1.mp4',
      byteSize: 18_000_000,
      checksum: 'sha256-video-candidate-1',
      probe: {
        durationMs: 61_000,
        width: 1080,
        height: 1920,
        frameRateFps: 30,
        format: 'mp4',
        hasAudio: true,
        hasVideo: true,
      },
    },
    {
      id: 'subtitle-candidate-1',
      candidateId: 'candidate-1',
      kind: 'subtitle',
      path: 'D:/autocut/output/candidate-1.srt',
      byteSize: 8_000,
      checksum: 'sha256-subtitle-candidate-1',
      probe: {
        durationMs: 61_000,
        format: 'srt',
        cueCount: 12,
      },
    },
    {
      id: 'cover-candidate-1',
      candidateId: 'candidate-1',
      kind: 'cover',
      path: 'D:/autocut/output/candidate-1-cover.jpg',
      byteSize: 240_000,
      checksum: 'sha256-cover-candidate-1',
      probe: {
        width: 1080,
        height: 1920,
        format: 'jpg',
      },
    },
    {
      id: 'quality-candidate-1',
      candidateId: 'candidate-1',
      kind: 'quality-report',
      path: 'D:/autocut/output/candidate-1-quality.json',
      byteSize: 12_000,
      checksum: 'sha256-quality-candidate-1',
      probe: {
        schemaVersion: SMART_CUT_STANDARD_VERSION,
        ready: true,
        metricCount: 9,
      },
    },
  ],
});

assertRule(validArtifactsReport.ready === true, 'valid render artifacts pass validation');
assertRule(validArtifactsReport.blockers.length === 0, 'valid render artifacts have no blockers');
assertRule(validArtifactsReport.artifactCount === 4, 'render artifact report counts artifacts');
assertRule(validArtifactsReport.candidateReports[0]?.candidateId === 'candidate-1', 'render artifact report groups artifacts by candidate');
assertRule(
  validArtifactsReport.candidateReports[0]?.artifactKinds.join(',') === 'rendered-video,subtitle,cover,quality-report',
  'render artifact report records all required artifact kinds',
);

const missingSubtitleReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: validArtifactsReport.artifacts.filter((artifact) => artifact.kind !== 'subtitle'),
});

assertRule(missingSubtitleReport.ready === false, 'render artifacts fail when required subtitle is missing');
assertRule(
  missingSubtitleReport.blockers.some((blocker) => blocker.code === 'MISSING_REQUIRED_ARTIFACT_KIND'),
  'missing required subtitle artifact is reported',
);

const wrongCandidateReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    {
      id: 'video-candidate-unknown',
      candidateId: 'candidate-unknown',
      kind: 'rendered-video',
      path: 'D:/autocut/output/unknown.mp4',
      byteSize: 18_000_000,
      checksum: 'sha256-video-unknown',
      probe: {
        durationMs: 61_000,
        width: 1080,
        height: 1920,
        frameRateFps: 30,
        format: 'mp4',
        hasAudio: true,
        hasVideo: true,
      },
    },
  ],
});

assertRule(wrongCandidateReport.ready === false, 'render artifacts fail when artifact references a candidate outside render contract');
assertRule(
  wrongCandidateReport.blockers.some((blocker) => blocker.code === 'ARTIFACT_FOR_UNKNOWN_CANDIDATE'),
  'unknown candidate artifact is reported',
);

const duplicateArtifactIdReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    validArtifactsReport.artifacts[0],
    {
      ...validArtifactsReport.artifacts[1],
      id: validArtifactsReport.artifacts[0].id,
    },
    ...validArtifactsReport.artifacts.slice(2),
  ],
});

assertRule(duplicateArtifactIdReport.ready === false, 'render artifacts fail when artifact ids are duplicated');
assertRule(
  duplicateArtifactIdReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_RENDER_ARTIFACT_ID'),
  'duplicate render artifact id is reported',
);

const duplicateArtifactKindReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    ...validArtifactsReport.artifacts,
    {
      ...validArtifactsReport.artifacts[0],
      id: 'video-candidate-1-duplicate-kind',
      path: 'D:/autocut/output/candidate-1-duplicate.mp4',
      checksum: 'sha256-video-candidate-1-duplicate',
    },
  ],
});

assertRule(duplicateArtifactKindReport.ready === false, 'render artifacts fail when a candidate has duplicate artifact kinds');
assertRule(
  duplicateArtifactKindReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_RENDER_ARTIFACT_KIND_FOR_CANDIDATE'),
  'duplicate candidate artifact kind is reported',
);

const unrequiredArtifactKindReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    ...validArtifactsReport.artifacts,
    {
      id: 'render-plan-candidate-1',
      candidateId: 'candidate-1',
      kind: 'render-plan',
      path: 'D:/autocut/output/candidate-1-render-plan.json',
      byteSize: 4_000,
      checksum: 'sha256-render-plan-candidate-1',
      probe: {
        schemaVersion: SMART_CUT_STANDARD_VERSION,
        ready: true,
        metricCount: 1,
      },
    },
  ],
});

assertRule(unrequiredArtifactKindReport.ready === false, 'render artifacts fail when native output includes uncontracted artifact kinds');
assertRule(
  unrequiredArtifactKindReport.blockers.some((blocker) => blocker.code === 'ARTIFACT_KIND_NOT_REQUIRED'),
  'uncontracted artifact kind is reported',
);

const blankIdentityReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    {
      ...validArtifactsReport.artifacts[0],
      id: ' ',
      candidateId: '',
    },
    ...validArtifactsReport.artifacts.slice(1),
  ],
});

assertRule(blankIdentityReport.ready === false, 'render artifacts fail when artifact or candidate ids are blank');
assertRule(
  blankIdentityReport.blockers.some((blocker) => blocker.code === 'ARTIFACT_ID_MISSING'),
  'blank artifact id is reported',
);
assertRule(
  blankIdentityReport.blockers.some((blocker) => blocker.code === 'ARTIFACT_CANDIDATE_ID_MISSING'),
  'blank artifact candidate id is reported',
);

const invalidVideoProbeReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    {
      id: 'video-candidate-1-bad-probe',
      candidateId: 'candidate-1',
      kind: 'rendered-video',
      path: 'D:/autocut/output/candidate-1.mp4',
      byteSize: 18_000_000,
      checksum: 'sha256-video-candidate-1',
      probe: {
        durationMs: 61_000,
        width: 1920,
        height: 1080,
        frameRateFps: 25,
        format: 'mp4',
        hasAudio: false,
        hasVideo: true,
      },
    },
    ...validArtifactsReport.artifacts.filter((artifact) => artifact.kind !== 'rendered-video'),
  ],
});

assertRule(invalidVideoProbeReport.ready === false, 'render artifacts fail when video probe does not match output contract');
assertRule(
  invalidVideoProbeReport.blockers.some((blocker) => blocker.code === 'VIDEO_RESOLUTION_MISMATCH'),
  'video resolution mismatch is reported',
);
assertRule(
  invalidVideoProbeReport.blockers.some((blocker) => blocker.code === 'VIDEO_FRAME_RATE_MISMATCH'),
  'video frame rate mismatch is reported',
);
assertRule(
  invalidVideoProbeReport.blockers.some((blocker) => blocker.code === 'VIDEO_AUDIO_STREAM_MISSING'),
  'missing video audio stream is reported',
);

const emptyFileReport = validateSmartCutRenderArtifacts({
  renderContract: teacherRenderContract,
  artifacts: [
    {
      id: 'empty-video-candidate-1',
      candidateId: 'candidate-1',
      kind: 'rendered-video',
      path: 'D:/autocut/output/empty.mp4',
      byteSize: 0,
      checksum: '',
      probe: {
        durationMs: 61_000,
        width: 1080,
        height: 1920,
        frameRateFps: 30,
        format: 'mp4',
        hasAudio: true,
        hasVideo: true,
      },
    },
  ],
});

assertRule(emptyFileReport.ready === false, 'render artifacts fail when files are empty or unchecksummed');
assertRule(
  emptyFileReport.blockers.some((blocker) => blocker.code === 'ARTIFACT_EMPTY_FILE'),
  'empty file artifact is reported',
);
assertRule(
  emptyFileReport.blockers.some((blocker) => blocker.code === 'ARTIFACT_MISSING_CHECKSUM'),
  'missing checksum artifact is reported',
);

const musicRenderContract = createSmartCutRenderContract({
  presetId: 'music-beat-clips',
  planId: 'post-slice-filter-plan-music',
  candidateIds: ['music-candidate-1'],
});

const musicArtifactsReport = validateSmartCutRenderArtifacts({
  renderContract: musicRenderContract,
  artifacts: [
    {
      id: 'video-music-candidate-1',
      candidateId: 'music-candidate-1',
      kind: 'rendered-video',
      path: 'D:/autocut/output/music-candidate-1.mp4',
      byteSize: 20_000_000,
      checksum: 'sha256-video-music-candidate-1',
      probe: {
        durationMs: 45_000,
        width: 1080,
        height: 1920,
        frameRateFps: 30,
        format: 'mp4',
        hasAudio: true,
        hasVideo: true,
      },
    },
    {
      id: 'quality-music-candidate-1',
      candidateId: 'music-candidate-1',
      kind: 'quality-report',
      path: 'D:/autocut/output/music-candidate-1-quality.json',
      byteSize: 12_000,
      checksum: 'sha256-quality-music-candidate-1',
      probe: {
        schemaVersion: SMART_CUT_STANDARD_VERSION,
        ready: true,
        metricCount: 6,
      },
    },
  ],
});

assertRule(musicArtifactsReport.ready === true, 'render artifacts allow no-subtitle presets with video and quality report');
assertRule(
  musicArtifactsReport.requiredArtifactKinds.join(',') === 'rendered-video,quality-report',
  'render artifact report follows render contract required artifact kinds',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut render artifact failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut render artifact checks=${pass.length}`);
