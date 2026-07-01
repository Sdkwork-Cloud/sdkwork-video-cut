export const SMART_CUT_STANDARD_VERSION = '2026-05-14.smart-cut-engine.v1' as const;

export const SMART_CUT_DEFAULT_SLICER_ID = 'speech-semantic' as const;

export const SMART_CUT_DEFAULT_PRODUCT_PRESET_ID = 'teacher-talking-head-single' as const;

export const SMART_CUT_EVIDENCE_KINDS = [
  'media',
  'transcript',
  'speaker',
  'audio',
  'visual',
  'ocr',
  'music',
  'motion',
  'event',
  'llm-review',
] as const;

export type SmartCutEvidenceKind = typeof SMART_CUT_EVIDENCE_KINDS[number];

export type SmartCutMediaKind =
  | 'talking-head'
  | 'interview'
  | 'meeting'
  | 'podcast'
  | 'course'
  | 'documentary'
  | 'film'
  | 'music-video'
  | 'sports'
  | 'gaming'
  | 'commerce-live'
  | 'screen-recording'
  | 'news'
  | 'vlog'
  | 'mixed';

export type SmartCutArtifactKind =
  | 'candidate'
  | 'render-plan'
  | 'rendered-video'
  | 'subtitle'
  | 'cover'
  | 'quality-report';

export type SmartCutBoundaryPrimaryUnit =
  | 'content-unit'
  | 'speaker-turn'
  | 'qa-pair'
  | 'topic-chapter'
  | 'visual-scene'
  | 'shot'
  | 'audio-event'
  | 'music-beat'
  | 'template-window'
  | 'event'
  | 'ocr-section';

export type SmartCutSpeakerRole =
  | 'teacher'
  | 'host'
  | 'interviewer'
  | 'guest'
  | 'speaker'
  | 'moderator'
  | 'narrator'
  | 'unknown';

export interface SmartCutTimeRange {
  startMs: number;
  endMs: number;
}

export interface SmartCutSourceMedia {
  id: string;
  uri: string;
  mediaKind: SmartCutMediaKind;
  durationMs: number;
  width?: number;
  height?: number;
  frameRateFps?: number;
  audioChannels?: number;
}

export interface SmartCutTranscriptSegment extends SmartCutTimeRange {
  id: string;
  text: string;
  confidence?: number;
  language?: string;
  tokenIds?: readonly string[];
  speakerId?: string;
}

export interface SmartCutTranscriptEvidence {
  kind: 'transcript';
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  provider: string;
  language: string;
  segments: readonly SmartCutTranscriptSegment[];
}

export interface SmartCutAudioEvidence {
  kind: 'audio';
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  sampleRateHz: number;
  speechRanges: readonly SmartCutTimeRange[];
  silenceRanges: readonly SmartCutTimeRange[];
  abnormalRanges: readonly SmartCutTimeRange[];
  waveformFingerprintId?: string;
}

export const SMART_CUT_VISUAL_EVIDENCE_PROFILES = [
  'shot-boundary-v1',
  'scene-index-v1',
] as const;

export type SmartCutVisualEvidenceProfile = typeof SMART_CUT_VISUAL_EVIDENCE_PROFILES[number];

export type SmartCutVisualBoundarySource =
  | 'ffmpeg-scene'
  | 'frame-hash'
  | 'model'
  | 'manual';

export interface SmartCutVisualEvidence {
  kind: 'visual';
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  provider?: string;
  profile?: SmartCutVisualEvidenceProfile;
  shots: readonly SmartCutVisualShot[];
  sceneBoundaries: readonly SmartCutTimeRange[];
  faceTracks?: readonly SmartCutFaceTrack[];
  frameQuality?: readonly SmartCutFrameQualitySample[];
}

export interface SmartCutVisualShot extends SmartCutTimeRange {
  id: string;
  confidence: number;
  cameraMotion?: 'static' | 'pan' | 'tilt' | 'zoom' | 'handheld' | 'cut';
  boundarySource?: SmartCutVisualBoundarySource;
}

export interface SmartCutFaceTrack extends SmartCutTimeRange {
  id: string;
  speakerId?: string;
  confidence: number;
  boxCoverageRatio: number;
}

export interface SmartCutFrameQualitySample {
  atMs: number;
  blurScore: number;
  exposureScore: number;
  stabilityScore: number;
}

export interface SmartCutOcrEvidence {
  kind: 'ocr';
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  regions: readonly SmartCutOcrRegion[];
}

export interface SmartCutOcrRegion extends SmartCutTimeRange {
  id: string;
  text: string;
  confidence: number;
}

export interface SmartCutMusicEvidence {
  kind: 'music';
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  beats: readonly SmartCutBeatMarker[];
  downbeats: readonly SmartCutBeatMarker[];
  sections: readonly SmartCutMusicSection[];
}

export interface SmartCutBeatMarker {
  atMs: number;
  confidence: number;
}

export interface SmartCutMusicSection extends SmartCutTimeRange {
  id: string;
  label: 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'outro' | 'unknown';
  confidence: number;
}

export interface SmartCutLlmReviewEvidence {
  kind: 'llm-review';
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  model: string;
  referencedCandidateIds: readonly string[];
  referencedUnitIds: readonly string[];
  referencedTimeSliceIds: readonly string[];
  referencedSpeakerIds: readonly string[];
  referencedSpeakerTurnIds: readonly string[];
  segmentDecisions: readonly SmartCutLlmReviewSegmentDecision[];
  rejectedRawTimeCuts: boolean;
  reviewNotes: readonly string[];
}

export interface SmartCutLlmReviewSegmentDecision {
  candidateId: string;
  decision: 'select' | 'reject' | 'review';
  reasonCode: string;
  referencedUnitIds: readonly string[];
  referencedTimeSliceIds: readonly string[];
  referencedSpeakerIds: readonly string[];
  referencedSpeakerTurnIds: readonly string[];
}

export interface SmartCutContentUnit extends SmartCutTimeRange {
  id: string;
  unitKind: SmartCutBoundaryPrimaryUnit;
  text?: string;
  speakerIds: readonly string[];
  speakerTurnIds: readonly string[];
  speakerRoles: readonly SmartCutSpeakerRole[];
  speakerConfidence: number;
  overlapGroupIds: readonly string[];
  transcriptSegmentIds: readonly string[];
  evidenceIds: readonly string[];
  topicIds: readonly string[];
  completenessScore: number;
  continuityScore: number;
  publishabilityScore: number;
}

export interface SmartCutCandidate extends SmartCutTimeRange {
  id: string;
  slicerId: string;
  unitIds: readonly string[];
  title: string;
  reason: string;
  confidence: number;
  risks: readonly string[];
}

export interface SmartCutPlan {
  id: string;
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  sourceMediaId: string;
  presetId: string;
  candidates: readonly SmartCutCandidate[];
}

export type SmartCutRequirementSource =
  | 'ORG_REQUIREMENTS.type-1'
  | 'ORG_REQUIREMENTS.type-2'
  | 'ORG_REQUIREMENTS.type-3'
  | 'industry.standard';

export interface SmartCutOutputProfile {
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5' | 'source';
  resolution: '1080x1920' | '1920x1080' | '1080x1080' | 'source';
  frameRateFps: 24 | 25 | 30 | 50 | 60 | 'source';
  format: 'mp4' | 'mov' | 'webm';
  minDurationMs?: number;
  maxDurationMs?: number;
}
