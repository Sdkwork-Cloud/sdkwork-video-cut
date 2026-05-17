import {
  SMART_CUT_VISUAL_EVIDENCE_PROFILES,
  type SmartCutFrameQualitySample,
  type SmartCutSourceMedia,
  type SmartCutTimeRange,
  type SmartCutTranscriptEvidence,
  type SmartCutTranscriptSegment,
  type SmartCutVisualEvidence,
  type SmartCutVisualShot,
} from './domain.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY, type SmartCutProductPresetId } from './presets.ts';
import { validateSmartCutSpeakerEvidenceStructure } from './speaker-evidence-structure.ts';
import type {
  SmartCutSpeakerEvidence,
  SmartCutSpeakerProfile,
  SmartCutSpeakerRole,
  SmartCutSpeakerSegment,
} from './speaker.ts';

export interface SmartCutEvidenceQualityValidationInput {
  presetId: SmartCutProductPresetId;
  sourceMedia: SmartCutSourceMedia;
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
}

export interface SmartCutVisualEvidenceQualityValidationInput {
  presetId: SmartCutProductPresetId;
  sourceMedia: SmartCutSourceMedia;
  visualEvidence: SmartCutVisualEvidence;
}

export type SmartCutEvidenceQualityBlockerCode =
  | 'UNKNOWN_PRESET'
  | 'INVALID_SOURCE_DURATION'
  | 'TRANSCRIPT_EVIDENCE_INVALID'
  | 'TRANSCRIPT_SEGMENTS_INVALID'
  | 'MISSING_TRANSCRIPT_EVIDENCE'
  | 'TRANSCRIPT_SEGMENT_INVALID'
  | 'TRANSCRIPT_SEGMENT_ID_MISSING'
  | 'DUPLICATE_TRANSCRIPT_SEGMENT_ID'
  | 'TRANSCRIPT_SEGMENT_TEXT_MISSING'
  | 'INVALID_TRANSCRIPT_SEGMENT_RANGE'
  | 'TRANSCRIPT_SEGMENT_OUT_OF_SOURCE'
  | 'TRANSCRIPT_SEGMENTS_OVERLAP'
  | 'TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID'
  | 'LOW_TRANSCRIPT_CONFIDENCE'
  | 'SPEAKER_EVIDENCE_INVALID'
  | 'MISSING_SPEAKER_DIARIZATION'
  | 'SPEAKER_PROFILES_INVALID'
  | 'SPEAKER_SEGMENTS_INVALID'
  | 'SPEAKER_TURNS_INVALID'
  | 'OVERLAP_GROUPS_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENTS_INVALID'
  | 'SPEAKER_CORRECTIONS_INVALID'
  | 'SPEAKER_PROFILE_INVALID'
  | 'SPEAKER_SEGMENT_INVALID'
  | 'SPEAKER_TURN_INVALID'
  | 'OVERLAP_GROUP_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_INVALID'
  | 'SPEAKER_CORRECTION_INVALID'
  | 'SPEAKER_PROFILE_ID_MISSING'
  | 'DUPLICATE_SPEAKER_PROFILE_ID'
  | 'SPEAKER_PROFILE_DISPLAY_NAME_MISSING'
  | 'SPEAKER_PROFILE_CONFIDENCE_INVALID'
  | 'SPEAKER_PROFILE_ROLE_INVALID'
  | 'SPEAKER_PROFILE_SOURCE_INVALID'
  | 'SPEAKER_SEGMENT_ID_MISSING'
  | 'DUPLICATE_SPEAKER_SEGMENT_ID'
  | 'SPEAKER_SEGMENT_SPEAKER_ID_MISSING'
  | 'SPEAKER_SEGMENT_CONFIDENCE_INVALID'
  | 'INVALID_SPEAKER_SEGMENT_RANGE'
  | 'SPEAKER_SEGMENT_OUT_OF_SOURCE'
  | 'SPEAKER_TURN_ID_MISSING'
  | 'DUPLICATE_SPEAKER_TURN_ID'
  | 'INVALID_SPEAKER_TURN_RANGE'
  | 'SPEAKER_TURN_OUT_OF_SOURCE'
  | 'SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS'
  | 'SPEAKER_TURN_TEXT_MISSING'
  | 'SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT'
  | 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH'
  | 'SPEAKER_TURN_UNKNOWN_SPEAKER'
  | 'SPEAKER_TURN_SPEAKER_MISMATCH'
  | 'UNKNOWN_SPEAKER_REFERENCE'
  | 'OVERLAP_GROUP_ID_MISSING'
  | 'DUPLICATE_OVERLAP_GROUP_ID'
  | 'INVALID_OVERLAP_GROUP_RANGE'
  | 'OVERLAP_GROUP_OUT_OF_SOURCE'
  | 'OVERLAP_GROUP_WITHOUT_MULTIPLE_SPEAKERS'
  | 'DUPLICATE_OVERLAP_GROUP_SPEAKER'
  | 'OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE'
  | 'OVERLAP_GROUP_WITHOUT_SEGMENTS'
  | 'DUPLICATE_OVERLAP_GROUP_SEGMENT'
  | 'OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE'
  | 'OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH'
  | 'OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH'
  | 'OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT'
  | 'OVERLAP_GROUP_WITHOUT_REAL_OVERLAP'
  | 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER'
  | 'SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN'
  | 'SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH'
  | 'SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS'
  | 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT'
  | 'TRANSCRIPT_SPEAKER_ALIGNMENT_INCOMPLETE'
  | 'REQUIRED_SPEAKER_ROLE_MISSING'
  | 'OVERLAPPING_SPEECH_NOT_DECLARED';

export interface SmartCutEvidenceQualityBlocker {
  code: SmartCutEvidenceQualityBlockerCode;
  message: string;
  segmentId?: string;
  speakerId?: string;
  remediation: string;
}

export interface SmartCutEvidenceQualityMetrics {
  transcriptSegmentCount: number;
  speakerSegmentCount: number;
  distinctSpeakerCount: number;
  alignedTranscriptSegmentCount: number;
  averageTranscriptConfidence: number;
  speakerCoverageRatio: number;
}

export interface SmartCutEvidenceQualityValidationReport {
  ready: boolean;
  transcriptReady: boolean;
  speakerReady: boolean;
  alignmentReady: boolean;
  roleReady: boolean;
  requiredSpeakerRoles: readonly SmartCutSpeakerRole[];
  metrics: SmartCutEvidenceQualityMetrics;
  blockers: readonly SmartCutEvidenceQualityBlocker[];
}

export type SmartCutVisualEvidenceQualityBlockerCode =
  | 'UNKNOWN_PRESET'
  | 'INVALID_SOURCE_DURATION'
  | 'VISUAL_EVIDENCE_INVALID'
  | 'VISUAL_EVIDENCE_PROVIDER_MISSING'
  | 'VISUAL_EVIDENCE_PROFILE_INVALID'
  | 'VISUAL_SHOTS_INVALID'
  | 'VISUAL_SCENE_BOUNDARIES_INVALID'
  | 'VISUAL_FRAME_QUALITY_INVALID'
  | 'MISSING_VISUAL_SHOT_EVIDENCE'
  | 'VISUAL_SHOT_INVALID'
  | 'VISUAL_SHOT_ID_MISSING'
  | 'DUPLICATE_VISUAL_SHOT_ID'
  | 'INVALID_VISUAL_SHOT_RANGE'
  | 'VISUAL_SHOT_OUT_OF_SOURCE'
  | 'VISUAL_SHOT_CONFIDENCE_INVALID'
  | 'LOW_VISUAL_SHOT_CONFIDENCE'
  | 'VISUAL_SHOTS_OVERLAP'
  | 'VISUAL_SCENE_BOUNDARY_INVALID'
  | 'VISUAL_SCENE_BOUNDARY_OUT_OF_SOURCE'
  | 'VISUAL_SCENE_BOUNDARY_WITHOUT_SHOT_COVERAGE'
  | 'VISUAL_FRAME_QUALITY_SAMPLE_INVALID'
  | 'VISUAL_FRAME_QUALITY_SAMPLE_OUT_OF_SOURCE'
  | 'VISUAL_FRAME_QUALITY_SCORE_INVALID';

export interface SmartCutVisualEvidenceQualityBlocker {
  code: SmartCutVisualEvidenceQualityBlockerCode;
  message: string;
  shotId?: string;
  remediation: string;
}

export interface SmartCutVisualEvidenceQualityMetrics {
  shotCount: number;
  sceneBoundaryCount: number;
  frameQualitySampleCount: number;
  averageShotConfidence: number;
  timelineCoverageRatio: number;
}

export interface SmartCutVisualEvidenceQualityValidationReport {
  ready: boolean;
  visualReady: boolean;
  shotReady: boolean;
  sceneReady: boolean;
  frameQualityReady: boolean;
  metrics: SmartCutVisualEvidenceQualityMetrics;
  blockers: readonly SmartCutVisualEvidenceQualityBlocker[];
}

const minimumTranscriptConfidence = 0.6;
const minimumVisualShotConfidence = 0.6;
const minimumSpeakerCoverageRatio = 0.95;
const minimumSpeakerOverlapMs = 200;
const minimumShortSegmentCoverageRatio = 0.8;

export function validateSmartCutEvidenceQuality(
  input: SmartCutEvidenceQualityValidationInput,
): SmartCutEvidenceQualityValidationReport {
  const blockers: SmartCutEvidenceQualityBlocker[] = [];
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.presetId);
  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.presetId}`,
      remediation: 'Validate evidence quality against a registered smart cut product preset.',
    });
  }

  if (!Number.isFinite(input.sourceMedia.durationMs) || input.sourceMedia.durationMs <= 0) {
    blockers.push({
      code: 'INVALID_SOURCE_DURATION',
      message: `Source media duration must be positive milliseconds, got ${input.sourceMedia.durationMs}.`,
      remediation: 'Probe source media before validating transcript and speaker evidence.',
    });
  }

  const transcriptEvidenceIsRecord = isRecord(input.transcriptEvidence);
  const speakerEvidenceIsRecord = isRecord(input.speakerEvidence);
  if (!transcriptEvidenceIsRecord) {
    blockers.push({
      code: 'TRANSCRIPT_EVIDENCE_INVALID',
      message: 'Transcript evidence must be an object payload.',
      remediation: 'Provide canonical transcript evidence before validating evidence quality, speaker alignment, or semantic slicing.',
    });
  }
  if (!speakerEvidenceIsRecord) {
    blockers.push({
      code: 'SPEAKER_EVIDENCE_INVALID',
      message: 'Speaker evidence must be an object payload.',
      remediation: 'Provide canonical speaker diarization evidence before validating evidence quality, speaker alignment, or semantic slicing.',
    });
  }

  if (transcriptEvidenceIsRecord) {
    validateTranscriptSegments(input, blockers);
  }
  if (transcriptEvidenceIsRecord && speakerEvidenceIsRecord) {
    const speakerStructureReport = validateSmartCutSpeakerEvidenceStructure({
      speakerEvidence: input.speakerEvidence,
      transcriptEvidence: input.transcriptEvidence,
      sourceDurationMs: input.sourceMedia.durationMs,
    });
    blockers.push(...speakerStructureReport.blockers);
    if (!hasUnsafeSpeakerStructureBlockers(speakerStructureReport.blockers)) {
      validateTranscriptSpeakerAlignment(input, blockers);
      validateRequiredSpeakerRoles(input, blockers);
      validateDeclaredOverlappingSpeech(input, blockers);
    }
  }

  const metrics = createEvidenceQualityMetrics(input);
  const requiredSpeakerRoles = getRequiredSpeakerRoles(input.presetId);
  const transcriptReady = !blockers.some((blocker) =>
      blocker.code === 'TRANSCRIPT_EVIDENCE_INVALID' ||
      blocker.code.startsWith('MISSING_TRANSCRIPT') ||
      blocker.code.startsWith('INVALID_TRANSCRIPT') ||
      blocker.code.startsWith('TRANSCRIPT_SEGMENT') ||
      blocker.code === 'DUPLICATE_TRANSCRIPT_SEGMENT_ID' ||
      blocker.code === 'LOW_TRANSCRIPT_CONFIDENCE'
  );
  const speakerReady = !blockers.some((blocker) =>
    blocker.code === 'SPEAKER_EVIDENCE_INVALID' ||
      blocker.code === 'MISSING_SPEAKER_DIARIZATION' ||
      blocker.code === 'SPEAKER_PROFILES_INVALID' ||
      blocker.code === 'SPEAKER_SEGMENTS_INVALID' ||
      blocker.code === 'SPEAKER_TURNS_INVALID' ||
      blocker.code === 'OVERLAP_GROUPS_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENTS_INVALID' ||
      blocker.code === 'SPEAKER_CORRECTIONS_INVALID' ||
      blocker.code === 'SPEAKER_PROFILE_INVALID' ||
      blocker.code === 'SPEAKER_SEGMENT_INVALID' ||
      blocker.code === 'SPEAKER_TURN_INVALID' ||
      blocker.code === 'OVERLAP_GROUP_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_INVALID' ||
      blocker.code === 'SPEAKER_CORRECTION_INVALID' ||
      blocker.code === 'SPEAKER_PROFILE_ID_MISSING' ||
      blocker.code === 'DUPLICATE_SPEAKER_PROFILE_ID' ||
      blocker.code === 'SPEAKER_PROFILE_DISPLAY_NAME_MISSING' ||
      blocker.code === 'SPEAKER_PROFILE_CONFIDENCE_INVALID' ||
      blocker.code === 'SPEAKER_PROFILE_ROLE_INVALID' ||
      blocker.code === 'SPEAKER_PROFILE_SOURCE_INVALID' ||
      blocker.code === 'SPEAKER_SEGMENT_ID_MISSING' ||
      blocker.code === 'DUPLICATE_SPEAKER_SEGMENT_ID' ||
      blocker.code === 'SPEAKER_SEGMENT_SPEAKER_ID_MISSING' ||
      blocker.code === 'SPEAKER_SEGMENT_CONFIDENCE_INVALID' ||
      blocker.code === 'INVALID_SPEAKER_SEGMENT_RANGE' ||
      blocker.code === 'SPEAKER_SEGMENT_OUT_OF_SOURCE' ||
      blocker.code === 'SPEAKER_TURN_ID_MISSING' ||
      blocker.code === 'DUPLICATE_SPEAKER_TURN_ID' ||
      blocker.code === 'INVALID_SPEAKER_TURN_RANGE' ||
      blocker.code === 'SPEAKER_TURN_OUT_OF_SOURCE' ||
      blocker.code === 'SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS' ||
      blocker.code === 'SPEAKER_TURN_TEXT_MISSING' ||
      blocker.code === 'SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT' ||
      blocker.code === 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH' ||
      blocker.code === 'SPEAKER_TURN_UNKNOWN_SPEAKER' ||
      blocker.code === 'SPEAKER_TURN_SPEAKER_MISMATCH' ||
      blocker.code === 'UNKNOWN_SPEAKER_REFERENCE' ||
      blocker.code === 'OVERLAP_GROUP_ID_MISSING' ||
      blocker.code === 'DUPLICATE_OVERLAP_GROUP_ID' ||
      blocker.code === 'INVALID_OVERLAP_GROUP_RANGE' ||
      blocker.code === 'OVERLAP_GROUP_OUT_OF_SOURCE' ||
      blocker.code === 'OVERLAP_GROUP_WITHOUT_MULTIPLE_SPEAKERS' ||
      blocker.code === 'DUPLICATE_OVERLAP_GROUP_SPEAKER' ||
      blocker.code === 'OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE' ||
      blocker.code === 'OVERLAP_GROUP_WITHOUT_SEGMENTS' ||
      blocker.code === 'DUPLICATE_OVERLAP_GROUP_SEGMENT' ||
      blocker.code === 'OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE' ||
      blocker.code === 'OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH' ||
      blocker.code === 'OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH' ||
      blocker.code === 'OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT' ||
      blocker.code === 'OVERLAP_GROUP_WITHOUT_REAL_OVERLAP' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT' ||
      blocker.code === 'OVERLAPPING_SPEECH_NOT_DECLARED'
  );
  const alignmentReady = !blockers.some((blocker) =>
    blocker.code === 'TRANSCRIPT_SPEAKER_ALIGNMENT_INCOMPLETE'
  );
  const roleReady = !blockers.some((blocker) =>
    blocker.code === 'REQUIRED_SPEAKER_ROLE_MISSING'
  );

  return {
    ready: blockers.length === 0,
    transcriptReady,
    speakerReady,
    alignmentReady,
    roleReady,
    requiredSpeakerRoles,
    metrics,
    blockers,
  };
}

export function validateSmartCutVisualEvidenceQuality(
  input: SmartCutVisualEvidenceQualityValidationInput,
): SmartCutVisualEvidenceQualityValidationReport {
  const blockers: SmartCutVisualEvidenceQualityBlocker[] = [];
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.presetId);
  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.presetId}`,
      remediation: 'Validate visual evidence quality against a registered smart cut product preset.',
    });
  }

  if (!Number.isFinite(input.sourceMedia.durationMs) || input.sourceMedia.durationMs <= 0) {
    blockers.push({
      code: 'INVALID_SOURCE_DURATION',
      message: `Source media duration must be positive milliseconds, got ${input.sourceMedia.durationMs}.`,
      remediation: 'Probe source media before validating visual evidence.',
    });
  }

  const visualEvidenceIsRecord = isRecord(input.visualEvidence);
  if (!visualEvidenceIsRecord) {
    blockers.push({
      code: 'VISUAL_EVIDENCE_INVALID',
      message: 'Visual evidence must be an object payload.',
      remediation: 'Provide canonical visual evidence before visual scene, film, music, or multimodal slicing.',
    });
  }

  if (visualEvidenceIsRecord) {
    validateVisualEvidenceMetadata(input, blockers);
    validateVisualShots(input, blockers);
    validateVisualSceneBoundaries(input, blockers);
    validateVisualFrameQuality(input, blockers);
  }

  const metrics = createVisualEvidenceQualityMetrics(input);
  const visualReady = !blockers.some((blocker) =>
    blocker.code === 'VISUAL_EVIDENCE_INVALID' ||
      blocker.code === 'VISUAL_EVIDENCE_PROVIDER_MISSING' ||
      blocker.code === 'VISUAL_EVIDENCE_PROFILE_INVALID'
  );
  const shotReady = !blockers.some((blocker) =>
    blocker.code === 'VISUAL_SHOTS_INVALID' ||
      blocker.code === 'MISSING_VISUAL_SHOT_EVIDENCE' ||
      blocker.code === 'VISUAL_SHOT_INVALID' ||
      blocker.code === 'VISUAL_SHOT_ID_MISSING' ||
      blocker.code === 'DUPLICATE_VISUAL_SHOT_ID' ||
      blocker.code === 'INVALID_VISUAL_SHOT_RANGE' ||
      blocker.code === 'VISUAL_SHOT_OUT_OF_SOURCE' ||
      blocker.code === 'VISUAL_SHOT_CONFIDENCE_INVALID' ||
      blocker.code === 'LOW_VISUAL_SHOT_CONFIDENCE' ||
      blocker.code === 'VISUAL_SHOTS_OVERLAP'
  );
  const sceneReady = !blockers.some((blocker) =>
    blocker.code === 'VISUAL_SCENE_BOUNDARIES_INVALID' ||
      blocker.code === 'VISUAL_SCENE_BOUNDARY_INVALID' ||
      blocker.code === 'VISUAL_SCENE_BOUNDARY_OUT_OF_SOURCE' ||
      blocker.code === 'VISUAL_SCENE_BOUNDARY_WITHOUT_SHOT_COVERAGE'
  );
  const frameQualityReady = !blockers.some((blocker) =>
    blocker.code === 'VISUAL_FRAME_QUALITY_INVALID' ||
      blocker.code === 'VISUAL_FRAME_QUALITY_SAMPLE_INVALID' ||
      blocker.code === 'VISUAL_FRAME_QUALITY_SAMPLE_OUT_OF_SOURCE' ||
      blocker.code === 'VISUAL_FRAME_QUALITY_SCORE_INVALID'
  );

  return {
    ready: blockers.length === 0,
    visualReady,
    shotReady,
    sceneReady,
    frameQualityReady,
    metrics,
    blockers,
  };
}

function validateVisualEvidenceMetadata(
  input: SmartCutVisualEvidenceQualityValidationInput,
  blockers: SmartCutVisualEvidenceQualityBlocker[],
) {
  if (!normalizeText(input.visualEvidence.provider)) {
    blockers.push({
      code: 'VISUAL_EVIDENCE_PROVIDER_MISSING',
      message: 'Visual evidence has no provider identity.',
      remediation: 'Attach a visual evidence provider such as ffmpeg-scene, frame-hash, model, or manual before visual slicing.',
    });
  }

  if (!isRegisteredVisualEvidenceProfile(input.visualEvidence.profile)) {
    blockers.push({
      code: 'VISUAL_EVIDENCE_PROFILE_INVALID',
      message: `Visual evidence profile ${String(input.visualEvidence.profile)} is not supported.`,
      remediation: 'Use a registered visual evidence profile so native adapters and slicers share the same contract.',
    });
  }
}

function validateVisualShots(
  input: SmartCutVisualEvidenceQualityValidationInput,
  blockers: SmartCutVisualEvidenceQualityBlocker[],
) {
  const visualShots = getVisualShots(input);
  if (visualShots === undefined) {
    blockers.push({
      code: 'VISUAL_SHOTS_INVALID',
      message: 'Visual evidence shots must be an array.',
      remediation: 'Return canonical visual evidence with a timestamped shots array before visual scene slicing.',
    });
    return;
  }

  if (visualShots.length === 0) {
    blockers.push({
      code: 'MISSING_VISUAL_SHOT_EVIDENCE',
      message: 'Visual evidence has no timestamped shot ranges.',
      remediation: 'Run shot boundary detection before visual scene, film, documentary, music, or multimodal slicing.',
    });
    return;
  }

  for (const shot of visualShots as readonly unknown[]) {
    if (!isRecord(shot)) {
      blockers.push({
        code: 'VISUAL_SHOT_INVALID',
        message: 'Visual evidence shots contains a non-object shot item.',
        remediation: 'Return one timestamped object for each visual shot before scene validation.',
      });
    }
  }

  const sortedShots = getValidVisualShots(input).sort(compareTimeRanges);
  const shotIds = new Set<string>();
  const duplicateShotIds = new Set<string>();
  for (const shot of sortedShots) {
    const shotId = normalizeId(shot.id);
    if (!shotId) {
      blockers.push({
        code: 'VISUAL_SHOT_ID_MISSING',
        message: 'Visual evidence has a shot without a stable shot id.',
        shotId: shot.id,
        remediation: 'Assign stable unique shot ids before building visual scenes or multimodal intervals.',
      });
    } else if (shotIds.has(shotId)) {
      duplicateShotIds.add(shotId);
    } else {
      shotIds.add(shotId);
    }

    if (!isValidRange(shot)) {
      blockers.push({
        code: 'INVALID_VISUAL_SHOT_RANGE',
        message: `Visual shot ${shot.id} has invalid range ${shot.startMs}-${shot.endMs}.`,
        shotId: shot.id,
        remediation: 'Use integer millisecond shot ranges with positive duration.',
      });
      continue;
    }

    if (shot.startMs < 0 || shot.endMs > input.sourceMedia.durationMs) {
      blockers.push({
        code: 'VISUAL_SHOT_OUT_OF_SOURCE',
        message: `Visual shot ${shot.id} is outside source duration ${input.sourceMedia.durationMs}ms.`,
        shotId: shot.id,
        remediation: 'Repair shot boundary drift or reject out-of-source visual evidence.',
      });
    }

    if (!isValidOptionalConfidence(shot.confidence)) {
      blockers.push({
        code: 'VISUAL_SHOT_CONFIDENCE_INVALID',
        message: `Visual shot ${shotId || '<blank>'} confidence ${shot.confidence} is invalid.`,
        shotId: shot.id,
        remediation: 'Return shot confidence in the inclusive 0-1 range.',
      });
    } else if ((shot.confidence ?? 1) < minimumVisualShotConfidence) {
      blockers.push({
        code: 'LOW_VISUAL_SHOT_CONFIDENCE',
        message: `Visual shot ${shot.id} confidence ${shot.confidence} is below ${minimumVisualShotConfidence}.`,
        shotId: shot.id,
        remediation: 'Rerun visual analysis, lower-risk profile selection, or request manual review before visual slicing.',
      });
    }
  }

  for (const duplicateShotId of duplicateShotIds) {
    blockers.push({
      code: 'DUPLICATE_VISUAL_SHOT_ID',
      message: `Visual evidence has duplicate shot id ${duplicateShotId}.`,
      shotId: duplicateShotId,
      remediation: 'Use one stable unique id for each visual shot before scene and interval construction.',
    });
  }

  for (let index = 1; index < sortedShots.length; index += 1) {
    const previous = sortedShots[index - 1];
    const current = sortedShots[index];
    if (previous !== undefined && current !== undefined && current.startMs < previous.endMs) {
      blockers.push({
        code: 'VISUAL_SHOTS_OVERLAP',
        message: `Visual shot ${current.id} overlaps previous shot ${previous.id}.`,
        shotId: current.id,
        remediation: 'Normalize visual shots to ordered non-overlapping source-backed ranges.',
      });
    }
  }
}

function validateVisualSceneBoundaries(
  input: SmartCutVisualEvidenceQualityValidationInput,
  blockers: SmartCutVisualEvidenceQualityBlocker[],
) {
  const sceneBoundaries = getVisualSceneBoundaries(input);
  if (sceneBoundaries === undefined) {
    blockers.push({
      code: 'VISUAL_SCENE_BOUNDARIES_INVALID',
      message: 'Visual evidence scene boundaries must be an array.',
      remediation: 'Return canonical visual evidence with a sceneBoundaries array before visual scene slicing.',
    });
    return;
  }

  for (const sceneBoundary of sceneBoundaries as readonly unknown[]) {
    if (!isRecord(sceneBoundary)) {
      blockers.push({
        code: 'VISUAL_SCENE_BOUNDARY_INVALID',
        message: 'Visual evidence scene boundaries contains a non-object boundary item.',
        remediation: 'Return one timestamped object for each visual scene boundary.',
      });
    }
  }

  const validShots = getValidVisualShots(input);
  const validSceneBoundaries = getValidVisualSceneBoundaries(input);
  for (const sceneBoundary of validSceneBoundaries) {
    if (!isValidRange(sceneBoundary)) {
      blockers.push({
        code: 'VISUAL_SCENE_BOUNDARY_INVALID',
        message: `Visual scene boundary has invalid range ${sceneBoundary.startMs}-${sceneBoundary.endMs}.`,
        remediation: 'Use integer millisecond scene ranges with positive duration.',
      });
      continue;
    }

    if (sceneBoundary.startMs < 0 || sceneBoundary.endMs > input.sourceMedia.durationMs) {
      blockers.push({
        code: 'VISUAL_SCENE_BOUNDARY_OUT_OF_SOURCE',
        message: `Visual scene boundary ${sceneBoundary.startMs}-${sceneBoundary.endMs} is outside source duration ${input.sourceMedia.durationMs}ms.`,
        remediation: 'Repair scene boundary drift or reject out-of-source scene evidence.',
      });
    }

    if (!isRangeCoveredByShots(sceneBoundary, validShots)) {
      blockers.push({
        code: 'VISUAL_SCENE_BOUNDARY_WITHOUT_SHOT_COVERAGE',
        message: `Visual scene boundary ${sceneBoundary.startMs}-${sceneBoundary.endMs} is not fully covered by shot evidence.`,
        remediation: 'Build scene ranges from accepted shot ids/ranges, not from untraceable raw timestamps.',
      });
    }
  }
}

function validateVisualFrameQuality(
  input: SmartCutVisualEvidenceQualityValidationInput,
  blockers: SmartCutVisualEvidenceQualityBlocker[],
) {
  const frameQuality = getVisualFrameQualitySamples(input);
  if (frameQuality === undefined) {
    blockers.push({
      code: 'VISUAL_FRAME_QUALITY_INVALID',
      message: 'Visual evidence frameQuality must be an array when present.',
      remediation: 'Omit frameQuality or return canonical frame quality sample objects.',
    });
    return;
  }

  for (const sample of frameQuality as readonly unknown[]) {
    if (!isRecord(sample)) {
      blockers.push({
        code: 'VISUAL_FRAME_QUALITY_SAMPLE_INVALID',
        message: 'Visual evidence frameQuality contains a non-object sample item.',
        remediation: 'Return one object for each frame quality sample.',
      });
    }
  }

  for (const sample of getValidFrameQualitySamples(input)) {
    if (!Number.isFinite(sample.atMs) || !Number.isInteger(sample.atMs) || sample.atMs < 0 || sample.atMs > input.sourceMedia.durationMs) {
      blockers.push({
        code: 'VISUAL_FRAME_QUALITY_SAMPLE_OUT_OF_SOURCE',
        message: `Frame quality sample at ${sample.atMs}ms is outside source duration ${input.sourceMedia.durationMs}ms.`,
        remediation: 'Only attach frame quality samples within the probed source timeline.',
      });
    }

    if (
      !isValidScore(sample.blurScore) ||
      !isValidScore(sample.exposureScore) ||
      !isValidScore(sample.stabilityScore)
    ) {
      blockers.push({
        code: 'VISUAL_FRAME_QUALITY_SCORE_INVALID',
        message: `Frame quality sample at ${sample.atMs}ms has an invalid score.`,
        remediation: 'Return blur, exposure, and stability scores in the inclusive 0-1 range.',
      });
    }
  }
}

function validateTranscriptSegments(
  input: SmartCutEvidenceQualityValidationInput,
  blockers: SmartCutEvidenceQualityBlocker[],
) {
  const transcriptSegments = getTranscriptSegments(input);
  if (transcriptSegments === undefined) {
    blockers.push({
      code: 'TRANSCRIPT_SEGMENTS_INVALID',
      message: 'Transcript evidence segments must be an array.',
      remediation: 'Return canonical transcript evidence with a timestamped segments array before speaker alignment or semantic slicing.',
    });
    return;
  }

  if (transcriptSegments.length === 0) {
    blockers.push({
      code: 'MISSING_TRANSCRIPT_EVIDENCE',
      message: 'Transcript evidence has no timestamped speech segments.',
      remediation: 'Run speech-to-text and provide timestamped transcript segments before slicing.',
    });
    return;
  }

  for (const segment of transcriptSegments as readonly unknown[]) {
    if (!isRecord(segment)) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_INVALID',
        message: 'Transcript evidence segments contains a non-object segment item.',
        remediation: 'Return one timestamped object for each transcript segment before speaker alignment or semantic slicing.',
      });
    }
  }

  const sortedSegments = getValidTranscriptSegments(input).sort(compareTimeRanges);
  const segmentIds = new Set<string>();
  const duplicateSegmentIds = new Set<string>();
  for (const segment of sortedSegments) {
    const segmentId = normalizeId(segment.id);
    if (!segmentId) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_ID_MISSING',
        message: 'Transcript evidence has a segment without a stable segment id.',
        segmentId: segment.id,
        remediation: 'Assign stable unique transcript segment ids before speaker alignment or content-unit construction.',
      });
    } else if (segmentIds.has(segmentId)) {
      duplicateSegmentIds.add(segmentId);
    } else {
      segmentIds.add(segmentId);
    }

    if (!normalizeText(segment.text)) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_TEXT_MISSING',
        message: `Transcript segment ${segmentId || '<blank>'} has no normalized text.`,
        segmentId: segment.id,
        remediation: 'Return non-empty transcript text for every timestamped segment before semantic slicing.',
      });
    }

    if (!isValidRange(segment)) {
      blockers.push({
        code: 'INVALID_TRANSCRIPT_SEGMENT_RANGE',
        message: `Transcript segment ${segment.id} has invalid range ${segment.startMs}-${segment.endMs}.`,
        segmentId: segment.id,
        remediation: 'Use integer millisecond transcript ranges with positive duration.',
      });
      continue;
    }

    if (segment.startMs < 0 || segment.endMs > input.sourceMedia.durationMs) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_OUT_OF_SOURCE',
        message: `Transcript segment ${segment.id} is outside source duration ${input.sourceMedia.durationMs}ms.`,
        segmentId: segment.id,
        remediation: 'Repair bounded STT tail drift or reject out-of-source transcript evidence.',
      });
    }

    if (!isValidOptionalConfidence(segment.confidence)) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID',
        message: `Transcript segment ${segmentId || '<blank>'} confidence ${segment.confidence} is invalid.`,
        segmentId: segment.id,
        remediation: 'Return transcript confidence in the inclusive 0-1 range when confidence is provided.',
      });
    } else if ((segment.confidence ?? 1) < minimumTranscriptConfidence) {
      blockers.push({
        code: 'LOW_TRANSCRIPT_CONFIDENCE',
        message: `Transcript segment ${segment.id} confidence ${segment.confidence} is below ${minimumTranscriptConfidence}.`,
        segmentId: segment.id,
        remediation: 'Rerun speech-to-text, choose a stronger model, or request manual review.',
      });
    }
  }

  for (const duplicateSegmentId of duplicateSegmentIds) {
    blockers.push({
      code: 'DUPLICATE_TRANSCRIPT_SEGMENT_ID',
      message: `Transcript evidence has duplicate segment id ${duplicateSegmentId}.`,
      segmentId: duplicateSegmentId,
      remediation: 'Use one stable unique id for each transcript segment before content-unit and speaker-turn evidence is created.',
    });
  }

  for (let index = 1; index < sortedSegments.length; index += 1) {
    const previous = sortedSegments[index - 1];
    const current = sortedSegments[index];
    if (previous !== undefined && current !== undefined && current.startMs < previous.endMs) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENTS_OVERLAP',
        message: `Transcript segment ${current.id} overlaps previous segment ${previous.id}.`,
        segmentId: current.id,
        remediation: 'Normalize transcript timeline to ordered non-overlapping speech segments.',
      });
    }
  }
}

function validateTranscriptSpeakerAlignment(
  input: SmartCutEvidenceQualityValidationInput,
  blockers: SmartCutEvidenceQualityBlocker[],
) {
  const transcriptSegments = getValidTranscriptSegments(input);
  const speakerSegments = getValidSpeakerSegments(input);
  for (const segment of transcriptSegments) {
    const aligned = hasReliableTranscriptSpeakerOverlap(segment, speakerSegments);
    if (!aligned) {
      blockers.push({
        code: 'TRANSCRIPT_SPEAKER_ALIGNMENT_INCOMPLETE',
        message: `Transcript segment ${segment.id} has no reliable speaker overlap.`,
        segmentId: segment.id,
        remediation: 'Align transcript segments to diarized speaker segments before building content units.',
      });
    }
  }

  const metrics = createEvidenceQualityMetrics(input);
  if (
    transcriptSegments.length > 0 &&
    speakerSegments.length > 0 &&
    metrics.speakerCoverageRatio < minimumSpeakerCoverageRatio
  ) {
    blockers.push({
      code: 'TRANSCRIPT_SPEAKER_ALIGNMENT_INCOMPLETE',
      message: `Speaker coverage ratio ${metrics.speakerCoverageRatio} is below ${minimumSpeakerCoverageRatio}.`,
      remediation: 'Rerun diarization or manually correct speaker ranges before slicing.',
    });
  }
}

function validateRequiredSpeakerRoles(
  input: SmartCutEvidenceQualityValidationInput,
  blockers: SmartCutEvidenceQualityBlocker[],
) {
  const requiredRoles = getRequiredSpeakerRoles(input.presetId);
  if (requiredRoles.length === 0) {
    return;
  }

  const roleAssignments = new Set<SmartCutSpeakerRole>();
  for (const profile of getValidSpeakerProfiles(input)) {
    if (profile.role !== 'unknown') {
      roleAssignments.add(profile.role);
    }
  }
  for (const assignment of getValidSpeakerRoleAssignments(input)) {
    roleAssignments.add(assignment.role);
  }

  for (const requiredRole of requiredRoles) {
    if (!roleAssignments.has(requiredRole)) {
      blockers.push({
        code: 'REQUIRED_SPEAKER_ROLE_MISSING',
        message: `Required speaker role ${requiredRole} is missing for preset ${input.presetId}.`,
        remediation: 'Infer, assign, or manually correct speaker roles before dialogue-aware slicing.',
      });
    }
  }
}

function validateDeclaredOverlappingSpeech(
  input: SmartCutEvidenceQualityValidationInput,
  blockers: SmartCutEvidenceQualityBlocker[],
) {
  const segments = [...getValidSpeakerSegments(input)].sort(compareTimeRanges);
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const right = segments[rightIndex];
      if (right === undefined || right.startMs >= left.endMs) {
        break;
      }
      if (left.speakerId === right.speakerId) {
        continue;
      }
      const overlapMs = getOverlapMs(left, right);
      if (overlapMs >= minimumSpeakerOverlapMs && !isOverlapDeclared(input.speakerEvidence, left, right)) {
        blockers.push({
          code: 'OVERLAPPING_SPEECH_NOT_DECLARED',
          message: `Speakers ${left.speakerId} and ${right.speakerId} overlap for ${overlapMs}ms without an overlap group.`,
          remediation: 'Declare overlapping speech groups or repair diarization before multi-speaker slicing.',
        });
      }
    }
  }
}

function createEvidenceQualityMetrics(input: SmartCutEvidenceQualityValidationInput): SmartCutEvidenceQualityMetrics {
  const transcriptSegments = getValidTranscriptSegments(input);
  const speakerSegments = getValidSpeakerSegments(input);
  const alignedTranscriptSegmentCount = transcriptSegments.filter((segment) =>
    hasReliableTranscriptSpeakerOverlap(segment, speakerSegments)
  ).length;
  const transcriptDurationMs = transcriptSegments.reduce((sum, segment) =>
    sum + (isValidRange(segment) ? segment.endMs - segment.startMs : 0), 0);
  const coveredDurationMs = transcriptSegments.reduce((sum, segment) =>
    sum + getCoveredTranscriptDurationMs(segment, speakerSegments), 0);
  const confidenceSum = transcriptSegments.reduce((sum, segment) => sum + (segment.confidence ?? 1), 0);

  return {
    transcriptSegmentCount: transcriptSegments.length,
    speakerSegmentCount: speakerSegments.length,
    distinctSpeakerCount: countDistinctSpeakers(getValidSpeakerProfiles(input)),
    alignedTranscriptSegmentCount,
    averageTranscriptConfidence: roundMetric(transcriptSegments.length === 0 ? 0 : confidenceSum / transcriptSegments.length),
    speakerCoverageRatio: roundMetric(transcriptDurationMs === 0 ? 0 : Math.min(1, coveredDurationMs / transcriptDurationMs)),
  };
}

function createVisualEvidenceQualityMetrics(
  input: SmartCutVisualEvidenceQualityValidationInput,
): SmartCutVisualEvidenceQualityMetrics {
  const visualShots = getValidVisualShots(input).filter(isValidRange);
  const confidenceSum = visualShots.reduce((sum, shot) => sum + (shot.confidence ?? 1), 0);
  const coveredDurationMs = getCoveredTimelineDurationMs(visualShots);

  return {
    shotCount: visualShots.length,
    sceneBoundaryCount: getValidVisualSceneBoundaries(input).filter(isValidRange).length,
    frameQualitySampleCount: getValidFrameQualitySamples(input).length,
    averageShotConfidence: roundMetric(visualShots.length === 0 ? 0 : confidenceSum / visualShots.length),
    timelineCoverageRatio: roundMetric(input.sourceMedia.durationMs <= 0 ? 0 : Math.min(1, coveredDurationMs / input.sourceMedia.durationMs)),
  };
}

function getRequiredSpeakerRoles(presetId: SmartCutProductPresetId): readonly SmartCutSpeakerRole[] {
  if (presetId === 'teacher-talking-head-single') {
    return ['teacher'];
  }

  if (presetId === 'interview-one-question-one-answer' || presetId === 'long-interview-matrix') {
    return ['interviewer', 'guest'];
  }

  return [];
}

function hasUnsafeSpeakerStructureBlockers(
  blockers: readonly { code: string }[],
): boolean {
  return blockers.some((blocker) =>
    blocker.code === 'SPEAKER_PROFILES_INVALID' ||
      blocker.code === 'SPEAKER_SEGMENTS_INVALID' ||
      blocker.code === 'SPEAKER_TURNS_INVALID' ||
      blocker.code === 'OVERLAP_GROUPS_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENTS_INVALID' ||
      blocker.code === 'SPEAKER_CORRECTIONS_INVALID' ||
      blocker.code === 'SPEAKER_PROFILE_INVALID' ||
      blocker.code === 'SPEAKER_SEGMENT_INVALID' ||
      blocker.code === 'SPEAKER_TURN_INVALID' ||
      blocker.code === 'OVERLAP_GROUP_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_INVALID' ||
      blocker.code === 'SPEAKER_CORRECTION_INVALID'
  );
}

function hasReliableTranscriptSpeakerOverlap(
  transcriptSegment: SmartCutTranscriptSegment,
  speakerSegments: readonly SmartCutSpeakerSegment[],
): boolean {
  for (const speakerSegment of speakerSegments) {
    if (
      transcriptSegment.speakerId !== undefined &&
      transcriptSegment.speakerId !== speakerSegment.speakerId
    ) {
      continue;
    }
    const overlapMs = getOverlapMs(transcriptSegment, speakerSegment);
    if (hasReliableShortAwareOverlap(transcriptSegment, speakerSegment, overlapMs)) {
      return true;
    }
  }

  return false;
}

function hasReliableShortAwareOverlap(
  left: SmartCutTimeRange,
  right: SmartCutTimeRange,
  overlapMs: number,
): boolean {
  if (overlapMs >= minimumSpeakerOverlapMs) {
    return true;
  }

  const shorterDurationMs = Math.min(left.endMs - left.startMs, right.endMs - right.startMs);
  if (shorterDurationMs <= 0 || shorterDurationMs >= minimumSpeakerOverlapMs) {
    return false;
  }

  return overlapMs >= Math.ceil(shorterDurationMs * minimumShortSegmentCoverageRatio);
}

function getCoveredTranscriptDurationMs(
  transcriptSegment: SmartCutTranscriptSegment,
  speakerSegments: readonly SmartCutSpeakerSegment[],
): number {
  const overlaps = speakerSegments
    .filter((speakerSegment) =>
      transcriptSegment.speakerId === undefined || transcriptSegment.speakerId === speakerSegment.speakerId
    )
    .map((speakerSegment) => ({
      startMs: Math.max(transcriptSegment.startMs, speakerSegment.startMs),
      endMs: Math.min(transcriptSegment.endMs, speakerSegment.endMs),
    }))
    .filter(isValidRange)
    .sort(compareTimeRanges);
  let coveredMs = 0;
  let currentEndMs = Number.NEGATIVE_INFINITY;
  for (const overlap of overlaps) {
    const startMs = Math.max(overlap.startMs, currentEndMs);
    if (overlap.endMs > startMs) {
      coveredMs += overlap.endMs - startMs;
      currentEndMs = overlap.endMs;
    }
  }
  return coveredMs;
}

function isOverlapDeclared(
  speakerEvidence: SmartCutSpeakerEvidence,
  left: SmartCutSpeakerSegment,
  right: SmartCutSpeakerSegment,
): boolean {
  return speakerEvidence.overlappingSpeechGroups.some((group) =>
    group.speakerIds.includes(left.speakerId) &&
      group.speakerIds.includes(right.speakerId) &&
      getOverlapMs(group, left) >= minimumSpeakerOverlapMs &&
      getOverlapMs(group, right) >= minimumSpeakerOverlapMs
  );
}

function countDistinctSpeakers(profiles: readonly SmartCutSpeakerProfile[]): number {
  return new Set(profiles.map((profile) => profile.id)).size;
}

function compareTimeRanges(left: SmartCutTimeRange, right: SmartCutTimeRange): number {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}

function isValidRange(range: SmartCutTimeRange): boolean {
  return Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    Number.isInteger(range.startMs) &&
    Number.isInteger(range.endMs) &&
    range.endMs > range.startMs;
}

function isValidOptionalConfidence(confidence: number | undefined): boolean {
  return confidence === undefined || (
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
}

function getOverlapMs(left: SmartCutTimeRange, right: SmartCutTimeRange): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function getCoveredTimelineDurationMs(ranges: readonly SmartCutTimeRange[]): number {
  const sortedRanges = [...ranges].filter(isValidRange).sort(compareTimeRanges);
  let coveredMs = 0;
  let currentEndMs = Number.NEGATIVE_INFINITY;
  for (const range of sortedRanges) {
    const startMs = Math.max(range.startMs, currentEndMs);
    if (range.endMs > startMs) {
      coveredMs += range.endMs - startMs;
      currentEndMs = range.endMs;
    }
  }
  return coveredMs;
}

function isRangeCoveredByShots(range: SmartCutTimeRange, shots: readonly SmartCutVisualShot[]): boolean {
  const sortedShots = [...shots].filter(isValidRange).sort(compareTimeRanges);
  let cursorMs = range.startMs;
  for (const shot of sortedShots) {
    if (shot.endMs <= cursorMs) {
      continue;
    }
    if (shot.startMs > cursorMs) {
      return false;
    }
    cursorMs = Math.max(cursorMs, Math.min(shot.endMs, range.endMs));
    if (cursorMs >= range.endMs) {
      return true;
    }
  }
  return cursorMs >= range.endMs;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getTranscriptSegments(
  input: SmartCutEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const transcriptEvidence = input.transcriptEvidence as unknown;
  return isRecord(transcriptEvidence) && Array.isArray(transcriptEvidence.segments)
    ? transcriptEvidence.segments
    : undefined;
}

function getValidTranscriptSegments(
  input: SmartCutEvidenceQualityValidationInput,
): SmartCutTranscriptSegment[] {
  return (getTranscriptSegments(input) ?? []).filter(isRecord) as unknown as SmartCutTranscriptSegment[];
}

function getSpeakerProfiles(
  input: SmartCutEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const speakerEvidence = input.speakerEvidence as unknown;
  return isRecord(speakerEvidence) && Array.isArray(speakerEvidence.profiles)
    ? speakerEvidence.profiles
    : undefined;
}

function getValidSpeakerProfiles(
  input: SmartCutEvidenceQualityValidationInput,
): SmartCutSpeakerProfile[] {
  return (getSpeakerProfiles(input) ?? []).filter(isRecord) as unknown as SmartCutSpeakerProfile[];
}

function getSpeakerSegments(
  input: SmartCutEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const speakerEvidence = input.speakerEvidence as unknown;
  return isRecord(speakerEvidence) && Array.isArray(speakerEvidence.segments)
    ? speakerEvidence.segments
    : undefined;
}

function getValidSpeakerSegments(
  input: SmartCutEvidenceQualityValidationInput,
): SmartCutSpeakerSegment[] {
  return (getSpeakerSegments(input) ?? []).filter(isRecord) as unknown as SmartCutSpeakerSegment[];
}

function getSpeakerRoleAssignments(
  input: SmartCutEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const speakerEvidence = input.speakerEvidence as unknown;
  return isRecord(speakerEvidence) && Array.isArray(speakerEvidence.roleAssignments)
    ? speakerEvidence.roleAssignments
    : undefined;
}

function getValidSpeakerRoleAssignments(
  input: SmartCutEvidenceQualityValidationInput,
): SmartCutEvidenceQualityValidationInput['speakerEvidence']['roleAssignments'] {
  return (getSpeakerRoleAssignments(input) ?? []).filter(isRecord) as unknown as SmartCutEvidenceQualityValidationInput['speakerEvidence']['roleAssignments'];
}

function getVisualShots(
  input: SmartCutVisualEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const visualEvidence = input.visualEvidence as unknown;
  return isRecord(visualEvidence) && Array.isArray(visualEvidence.shots)
    ? visualEvidence.shots
    : undefined;
}

function getValidVisualShots(
  input: SmartCutVisualEvidenceQualityValidationInput,
): SmartCutVisualShot[] {
  return (getVisualShots(input) ?? []).filter(isRecord) as unknown as SmartCutVisualShot[];
}

function getVisualSceneBoundaries(
  input: SmartCutVisualEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const visualEvidence = input.visualEvidence as unknown;
  return isRecord(visualEvidence) && Array.isArray(visualEvidence.sceneBoundaries)
    ? visualEvidence.sceneBoundaries
    : undefined;
}

function getValidVisualSceneBoundaries(
  input: SmartCutVisualEvidenceQualityValidationInput,
): SmartCutTimeRange[] {
  return (getVisualSceneBoundaries(input) ?? []).filter(isRecord) as unknown as SmartCutTimeRange[];
}

function getVisualFrameQualitySamples(
  input: SmartCutVisualEvidenceQualityValidationInput,
): readonly unknown[] | undefined {
  const visualEvidence = input.visualEvidence as unknown;
  if (!isRecord(visualEvidence)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(visualEvidence, 'frameQuality')) {
    return [];
  }
  return Array.isArray(visualEvidence.frameQuality)
    ? visualEvidence.frameQuality
    : undefined;
}

function getValidFrameQualitySamples(
  input: SmartCutVisualEvidenceQualityValidationInput,
): SmartCutFrameQualitySample[] {
  return (getVisualFrameQualitySamples(input) ?? []).filter(isRecord) as unknown as SmartCutFrameQualitySample[];
}

function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRegisteredVisualEvidenceProfile(value: unknown): boolean {
  return typeof value === 'string' &&
    SMART_CUT_VISUAL_EVIDENCE_PROFILES.includes(value as (typeof SMART_CUT_VISUAL_EVIDENCE_PROFILES)[number]);
}

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}
