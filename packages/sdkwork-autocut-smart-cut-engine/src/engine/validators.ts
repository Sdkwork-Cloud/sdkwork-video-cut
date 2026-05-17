import type { SmartCutEvidenceKind } from './domain.ts';

export type SmartCutValidatorId =
  | 'semantic-completeness'
  | 'speaker-continuity'
  | 'boundary-integrity'
  | 'duration-contract'
  | 'evidence-coverage'
  | 'post-filter-integrity'
  | 'publishability-standard'
  | 'render-artifact-integrity';

export interface SmartCutValidatorDefinition {
  id: SmartCutValidatorId;
  displayName: string;
  description: string;
  requiredEvidence: readonly SmartCutEvidenceKind[];
  failClosed: boolean;
  nativeAcceleration: 'required' | 'recommended' | 'optional';
}

export const SMART_CUT_VALIDATOR_REGISTRY = [
  {
    id: 'semantic-completeness',
    displayName: 'Semantic Completeness',
    description: 'Verifies every slice starts and ends on a complete logical content unit.',
    requiredEvidence: ['transcript', 'speaker'],
    failClosed: true,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'speaker-continuity',
    displayName: 'Speaker Continuity',
    description: 'Verifies speaker turns, Q/A pairs, interruptions, and overlapping speech remain coherent.',
    requiredEvidence: ['speaker', 'transcript'],
    failClosed: true,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'boundary-integrity',
    displayName: 'Boundary Integrity',
    description: 'Verifies candidate, filtered, and rendered intervals remain ordered, non-corrupt, and source-backed.',
    requiredEvidence: ['media'],
    failClosed: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'duration-contract',
    displayName: 'Duration Contract',
    description: 'Verifies every output satisfies preset minimum and maximum duration contracts.',
    requiredEvidence: ['media'],
    failClosed: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'evidence-coverage',
    displayName: 'Evidence Coverage',
    description: 'Verifies required transcript, speaker, audio, visual, OCR, music, and event evidence exists for a strategy.',
    requiredEvidence: ['media'],
    failClosed: true,
    nativeAcceleration: 'optional',
  },
  {
    id: 'post-filter-integrity',
    displayName: 'Post Filter Integrity',
    description: 'Revalidates semantic and media boundaries after destructive filters run.',
    requiredEvidence: ['transcript', 'speaker', 'audio'],
    failClosed: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'publishability-standard',
    displayName: 'Publishability Standard',
    description: 'Verifies output profile, subtitles, cover, audio packaging, visual framing, and artifact readiness.',
    requiredEvidence: ['media', 'transcript', 'audio', 'visual'],
    failClosed: true,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'render-artifact-integrity',
    displayName: 'Render Artifact Integrity',
    description: 'Verifies rendered files, thumbnails, subtitles, and quality reports are present and internally consistent.',
    requiredEvidence: ['media'],
    failClosed: true,
    nativeAcceleration: 'required',
  },
] as const satisfies readonly SmartCutValidatorDefinition[];
