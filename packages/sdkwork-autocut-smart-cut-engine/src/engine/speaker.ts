import type { SmartCutSpeakerRole, SmartCutTimeRange } from './domain.ts';
export type { SmartCutSpeakerRole } from './domain.ts';

export type SmartCutSpeakerProfileSource =
  | 'diarization'
  | 'voiceprint'
  | 'manual'
  | 'metadata'
  | 'llm-role-inference';

export interface SmartCutSpeakerProfile {
  id: string;
  displayName: string;
  role: SmartCutSpeakerRole;
  confidence: number;
  source: SmartCutSpeakerProfileSource;
  voiceprintId?: string;
}

export interface SmartCutSpeakerSegment extends SmartCutTimeRange {
  id: string;
  speakerId: string;
  confidence: number;
  channel?: number;
  overlapGroupId?: string;
}

export interface SmartCutSpeakerTurn extends SmartCutTimeRange {
  id: string;
  speakerId: string;
  sentenceIds: readonly string[];
  transcriptSegmentIds: readonly string[];
  text: string;
  isQuestion: boolean;
  isAnswerCandidate: boolean;
  isInterruption: boolean;
  isBackchannel: boolean;
  topicIds: readonly string[];
  risks: readonly string[];
}

export interface SmartCutOverlappingSpeechGroup extends SmartCutTimeRange {
  id: string;
  speakerIds: readonly string[];
  segmentIds: readonly string[];
  severity: 'low' | 'medium' | 'high';
}

export interface SmartCutSpeakerRoleAssignment {
  speakerId: string;
  role: SmartCutSpeakerRole;
  confidence: number;
  evidenceTurnIds: readonly string[];
  source: 'manual' | 'metadata' | 'llm-role-inference' | 'rule';
}

export type SmartCutSpeakerCorrectionKind =
  | 'rename'
  | 'assign-role'
  | 'merge'
  | 'split'
  | 'reassign-time-range';

export interface SmartCutSpeakerCorrection {
  id: string;
  kind: SmartCutSpeakerCorrectionKind;
  speakerIds: readonly string[];
  range?: SmartCutTimeRange;
  replacementSpeakerId?: string;
  replacementDisplayName?: string;
  replacementRole?: SmartCutSpeakerRole;
  reason: string;
  createdAt: string;
}

export interface SmartCutSpeakerEvidence {
  kind: 'speaker';
  schemaVersion: '2026-05-14.smart-cut-engine.v1';
  profiles: readonly SmartCutSpeakerProfile[];
  segments: readonly SmartCutSpeakerSegment[];
  turns: readonly SmartCutSpeakerTurn[];
  overlappingSpeechGroups: readonly SmartCutOverlappingSpeechGroup[];
  roleAssignments: readonly SmartCutSpeakerRoleAssignment[];
  corrections: readonly SmartCutSpeakerCorrection[];
}
