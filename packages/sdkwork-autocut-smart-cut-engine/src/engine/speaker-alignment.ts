import type {
  SmartCutTranscriptEvidence,
  SmartCutTranscriptSegment,
} from './domain.ts';
import type {
  SmartCutSpeakerEvidence,
  SmartCutSpeakerRoleAssignment,
  SmartCutSpeakerSegment,
  SmartCutSpeakerTurn,
} from './speaker.ts';

export interface SmartCutTranscriptSpeakerAlignmentInput {
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
}

export type SmartCutTranscriptSpeakerAlignmentBlockerCode =
  | 'MISSING_SPEAKER_ALIGNMENT_REPORT'
  | 'SPEAKER_ALIGNMENT_REPORT_BLOCKED'
  | 'SPEAKER_ALIGNMENT_REPORT_MISMATCH'
  | 'SPEAKER_ALIGNMENT_TRANSCRIPT_COVERAGE_MISMATCH'
  | 'NO_TRANSCRIPT_SEGMENTS'
  | 'NO_SPEAKER_SEGMENTS'
  | 'INVALID_TRANSCRIPT_SEGMENT_RANGE'
  | 'TRANSCRIPT_SEGMENT_WITHOUT_SPEAKER_OVERLAP';

export interface SmartCutTranscriptSpeakerAlignmentBlocker {
  code: SmartCutTranscriptSpeakerAlignmentBlockerCode;
  message: string;
  segmentId?: string;
  remediation: string;
}

export interface SmartCutTranscriptSpeakerAlignmentReport {
  ready: boolean;
  transcriptSegmentCount: number;
  alignedTranscriptSegmentCount: number;
  unalignedTranscriptSegmentCount: number;
  turnCount: number;
  turnIds: readonly string[];
  distinctSpeakerCount: number;
  blockers: readonly SmartCutTranscriptSpeakerAlignmentBlocker[];
}

export interface SmartCutTranscriptSpeakerAlignmentResult {
  ready: boolean;
  speakerEvidence: SmartCutSpeakerEvidence;
  report: SmartCutTranscriptSpeakerAlignmentReport;
}

interface AlignedTranscriptSegment {
  segment: SmartCutTranscriptSegment;
  speakerId: string;
}

const maximumTurnMergeGapMs = 1_500;
const maximumConnectorBridgeGapMs = 3_000;
const minimumSpeakerOverlapMs = 200;
const minimumShortSegmentCoverageRatio = 0.8;

export function alignSmartCutTranscriptSpeakers(
  input: SmartCutTranscriptSpeakerAlignmentInput,
): SmartCutTranscriptSpeakerAlignmentResult {
  const blockers: SmartCutTranscriptSpeakerAlignmentBlocker[] = [];
  const transcriptSegments = [...input.transcriptEvidence.segments]
    .sort(compareTimeRanges);
  const alignedSegments: AlignedTranscriptSegment[] = [];

  if (transcriptSegments.length === 0) {
    blockers.push({
      code: 'NO_TRANSCRIPT_SEGMENTS',
      message: 'Transcript speaker alignment requires timestamped transcript segments.',
      remediation: 'Run speech-to-text and provide timestamped transcript evidence before speaker alignment.',
    });
  }

  if (input.speakerEvidence.segments.length === 0) {
    blockers.push({
      code: 'NO_SPEAKER_SEGMENTS',
      message: 'Transcript speaker alignment requires diarized speaker segments.',
      remediation: 'Run speaker diarization before aligning transcript segments to speaker turns.',
    });
  }

  for (const segment of transcriptSegments) {
    if (!isValidTranscriptSegment(segment)) {
      blockers.push({
        code: 'INVALID_TRANSCRIPT_SEGMENT_RANGE',
        message: `Transcript segment ${segment.id} has invalid range ${segment.startMs}-${segment.endMs}.`,
        segmentId: segment.id,
        remediation: 'Use integer millisecond transcript segment ranges with positive duration before alignment.',
      });
      continue;
    }

    const speakerId = resolveSegmentSpeakerId(segment, input.speakerEvidence.segments);
    if (speakerId === undefined) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_WITHOUT_SPEAKER_OVERLAP',
        message: `Transcript segment ${segment.id} has no reliable diarization overlap.`,
        segmentId: segment.id,
        remediation: 'Repair diarization coverage or manually assign speaker identity before building speaker turns.',
      });
      continue;
    }

    alignedSegments.push({ segment, speakerId });
  }

  const turns = blockers.length === 0
    ? createAlignedSpeakerTurns(alignedSegments)
    : [];
  const alignedSpeakerEvidence = {
    ...input.speakerEvidence,
    turns,
    roleAssignments: alignRoleAssignments(input.speakerEvidence.roleAssignments, turns),
  };
  const report = createAlignmentReport({
    transcriptSegmentCount: transcriptSegments.length,
    alignedTranscriptSegmentCount: alignedSegments.length,
    turns,
    blockers,
  });

  return {
    ready: report.ready,
    speakerEvidence: alignedSpeakerEvidence,
    report,
  };
}

function createAlignedSpeakerTurns(
  alignedSegments: readonly AlignedTranscriptSegment[],
): readonly SmartCutSpeakerTurn[] {
  const turns: SmartCutSpeakerTurn[] = [];
  const speakerTurnCounts = new Map<string, number>();

  for (const alignedSegment of alignedSegments) {
    const segmentText = normalizeText(alignedSegment.segment.text);
    const segmentLowInformation = isLowInformationText(segmentText);
    const segmentQuestion = isQuestionText(segmentText);
    const lastTurn = turns.at(-1);
    if (shouldMergeIntoPreviousSpeakerTurn(lastTurn, alignedSegment, segmentText, segmentLowInformation, segmentQuestion)) {
      const mergedSegmentIds = [...lastTurn.transcriptSegmentIds, alignedSegment.segment.id];
      turns[turns.length - 1] = createSpeakerTurn({
        id: lastTurn.id,
        speakerId: alignedSegment.speakerId,
        startMs: lastTurn.startMs,
        endMs: alignedSegment.segment.endMs,
        transcriptSegmentIds: mergedSegmentIds,
        text: normalizeText(`${lastTurn.text} ${segmentText}`),
      });
      continue;
    }

    const nextIndex = (speakerTurnCounts.get(alignedSegment.speakerId) ?? 0) + 1;
    speakerTurnCounts.set(alignedSegment.speakerId, nextIndex);
    turns.push(createSpeakerTurn({
      id: `turn-${alignedSegment.speakerId}-${nextIndex}`,
      speakerId: alignedSegment.speakerId,
      startMs: alignedSegment.segment.startMs,
      endMs: alignedSegment.segment.endMs,
      transcriptSegmentIds: [alignedSegment.segment.id],
      text: segmentText,
    }));
  }

  return turns;
}

function shouldMergeIntoPreviousSpeakerTurn(
  lastTurn: SmartCutSpeakerTurn | undefined,
  alignedSegment: AlignedTranscriptSegment,
  segmentText: string,
  segmentLowInformation: boolean,
  segmentQuestion: boolean,
): lastTurn is SmartCutSpeakerTurn {
  if (
    lastTurn === undefined ||
    lastTurn.speakerId !== alignedSegment.speakerId ||
    lastTurn.isBackchannel ||
    segmentLowInformation ||
    lastTurn.isQuestion ||
    segmentQuestion
  ) {
    return false;
  }

  const gapMs = alignedSegment.segment.startMs - lastTurn.endMs;
  if (gapMs < 0) {
    return true;
  }
  if (gapMs <= maximumTurnMergeGapMs) {
    return true;
  }
  if (gapMs > maximumConnectorBridgeGapMs) {
    return false;
  }

  return startsWithDanglingConnector(segmentText) || endsWithDanglingConnector(lastTurn.text);
}

function createSpeakerTurn({
  id,
  speakerId,
  startMs,
  endMs,
  transcriptSegmentIds,
  text,
}: {
  id: string;
  speakerId: string;
  startMs: number;
  endMs: number;
  transcriptSegmentIds: readonly string[];
  text: string;
}): SmartCutSpeakerTurn {
  const lowInformation = isLowInformationText(text);
  const question = isQuestionText(text);
  return {
    id,
    speakerId,
    startMs,
    endMs,
    sentenceIds: transcriptSegmentIds.map((segmentId) => `sentence-${segmentId}`),
    transcriptSegmentIds: [...transcriptSegmentIds],
    text,
    isQuestion: question,
    isAnswerCandidate: !question && !lowInformation,
    isInterruption: false,
    isBackchannel: lowInformation,
    topicIds: ['topic-unknown'],
    risks: lowInformation ? ['low-information'] : [],
  };
}

function alignRoleAssignments(
  roleAssignments: readonly SmartCutSpeakerRoleAssignment[],
  turns: readonly SmartCutSpeakerTurn[],
): readonly SmartCutSpeakerRoleAssignment[] {
  return roleAssignments.map((assignment) => {
    if (assignment.evidenceTurnIds.length > 0) {
      return {
        ...assignment,
        evidenceTurnIds: [...assignment.evidenceTurnIds],
      };
    }

    return {
      ...assignment,
      evidenceTurnIds: turns
        .filter((turn) => turn.speakerId === assignment.speakerId)
        .map((turn) => turn.id),
    };
  });
}

function createAlignmentReport({
  transcriptSegmentCount,
  alignedTranscriptSegmentCount,
  turns,
  blockers,
}: {
  transcriptSegmentCount: number;
  alignedTranscriptSegmentCount: number;
  turns: readonly SmartCutSpeakerTurn[];
  blockers: readonly SmartCutTranscriptSpeakerAlignmentBlocker[];
}): SmartCutTranscriptSpeakerAlignmentReport {
  return {
    ready: blockers.length === 0,
    transcriptSegmentCount,
    alignedTranscriptSegmentCount,
    unalignedTranscriptSegmentCount: transcriptSegmentCount - alignedTranscriptSegmentCount,
    turnCount: turns.length,
    turnIds: turns.map((turn) => turn.id),
    distinctSpeakerCount: new Set(turns.map((turn) => turn.speakerId)).size,
    blockers,
  };
}

function resolveSegmentSpeakerId(
  segment: SmartCutTranscriptSegment,
  speakerSegments: readonly SmartCutSpeakerSegment[],
): string | undefined {
  const declaredSpeakerId = segment.speakerId?.trim();
  const candidateSegments = declaredSpeakerId === undefined || declaredSpeakerId.length === 0
    ? speakerSegments
    : speakerSegments.filter((speakerSegment) => speakerSegment.speakerId === declaredSpeakerId);
  const bestSpeaker = resolveBestSpeakerOverlap(segment, candidateSegments);
  if (bestSpeaker !== undefined) {
    return bestSpeaker;
  }

  return resolveBestSpeakerOverlap(segment, speakerSegments);
}

function resolveBestSpeakerOverlap(
  segment: SmartCutTranscriptSegment,
  speakerSegments: readonly SmartCutSpeakerSegment[],
): string | undefined {
  let bestSpeakerId: string | undefined;
  let bestSpeakerSegment: SmartCutSpeakerSegment | undefined;
  let bestOverlapMs = 0;
  for (const speakerSegment of speakerSegments) {
    const overlapMs = getOverlapMs(segment, speakerSegment);
    if (overlapMs > bestOverlapMs) {
      bestOverlapMs = overlapMs;
      bestSpeakerId = speakerSegment.speakerId;
      bestSpeakerSegment = speakerSegment;
    }
  }

  return bestSpeakerSegment !== undefined && hasReliableSpeakerOverlap(segment, bestSpeakerSegment, bestOverlapMs)
    ? bestSpeakerId
    : undefined;
}

function hasReliableSpeakerOverlap(
  segment: SmartCutTranscriptSegment,
  speakerSegment: SmartCutSpeakerSegment,
  overlapMs: number,
): boolean {
  if (overlapMs >= minimumSpeakerOverlapMs) {
    return true;
  }

  const transcriptDurationMs = segment.endMs - segment.startMs;
  const speakerDurationMs = speakerSegment.endMs - speakerSegment.startMs;
  const shorterDurationMs = Math.min(transcriptDurationMs, speakerDurationMs);
  if (shorterDurationMs <= 0 || shorterDurationMs >= minimumSpeakerOverlapMs) {
    return false;
  }

  return overlapMs >= Math.ceil(shorterDurationMs * minimumShortSegmentCoverageRatio);
}

function isValidTranscriptSegment(segment: SmartCutTranscriptSegment): boolean {
  return Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    Number.isInteger(segment.startMs) &&
    Number.isInteger(segment.endMs) &&
    segment.endMs > segment.startMs &&
    normalizeText(segment.text).length > 0;
}

function compareTimeRanges(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}

function getOverlapMs(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function isLowInformationText(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  return normalized.length <= 6 &&
    /^(?:ok|okay|yes|yeah|uh|um|hm|hmm|er|ah|[,.\s]|\u3002|\uFF0C|\uFF1B|\uFF01|\uFF1F)+$/iu.test(normalized);
}

function isQuestionText(text: string): boolean {
  const normalized = normalizeText(text);
  return /[?\uFF1F]\s*$/u.test(normalized) ||
    /^(?:when|what|why|how|who|where|which)\s+(?:should|can|could|would|will|do|does|did|is|are|was|were|has|have|had)\b/iu.test(normalized) ||
    /^(?:should|can|could|would|will|is|are|was|were|do|does|did|has|have|had)\b/iu.test(normalized);
}

function startsWithDanglingConnector(text: string): boolean {
  return /^(?:(?:and|but|so|because|therefore|however|then|also|or)\b|\u6240\u4ee5|\u56e0\u6b64|\u4f46\u662f|\u7136\u540e|\u800c\u4e14|\u56e0\u4e3a|\u4e0d\u8fc7|\u53ef\u662f|\u5982\u679c|\u5f53)/iu.test(normalizeText(text));
}

function endsWithDanglingConnector(text: string): boolean {
  return /(?:\b(?:and|but|so|because|therefore|however|then|also|or|if|when|while|although|though)|\u6240\u4ee5|\u56e0\u6b64|\u4f46\u662f|\u7136\u540e|\u800c\u4e14|\u56e0\u4e3a|\u4e0d\u8fc7|\u53ef\u662f|\u5982\u679c|\u5f53|\u867d\u7136)\s*$/iu.test(normalizeText(text));
}
