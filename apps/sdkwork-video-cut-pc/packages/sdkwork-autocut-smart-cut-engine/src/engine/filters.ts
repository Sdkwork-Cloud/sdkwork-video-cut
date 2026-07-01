import type { SmartCutEvidenceKind } from './domain.ts';

export type SmartCutFilterId =
  | 'speech-denoise'
  | 'dereverb'
  | 'silence-trim'
  | 'abnormal-segment-remove'
  | 'repeat-deduplicate'
  | 'filler-word-soft-trim'
  | 'ad-fluff-remove'
  | 'stabilize-video'
  | 'smart-reframe'
  | 'subtitle-sync'
  | 'keyword-highlight'
  | 'bgm-ducking'
  | 'prompt-sfx'
  | 'cover-generate';

export type SmartCutFilterStage =
  | 'pre-evidence'
  | 'post-slice'
  | 'post-filter'
  | 'render-packaging';

export interface SmartCutFilterDefinition {
  id: SmartCutFilterId;
  stage: SmartCutFilterStage;
  displayName: string;
  description: string;
  requiredEvidence: readonly SmartCutEvidenceKind[];
  destructive: boolean;
  requiresRevalidation: boolean;
  nativeAcceleration: 'required' | 'recommended' | 'optional';
}

export const SMART_CUT_FILTER_REGISTRY = [
  {
    id: 'speech-denoise',
    stage: 'post-slice',
    displayName: 'Speech Denoise',
    description: 'Enhances speech and reduces noise after semantic cut approval.',
    requiredEvidence: ['audio'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'dereverb',
    stage: 'post-slice',
    displayName: 'Dereverb',
    description: 'Reduces room reverb without changing semantic boundaries.',
    requiredEvidence: ['audio'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'silence-trim',
    stage: 'post-slice',
    displayName: 'Silence Trim',
    description: 'Trims leading, trailing, and excessive internal silence only inside validated semantic ranges.',
    requiredEvidence: ['audio', 'transcript'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'abnormal-segment-remove',
    stage: 'post-slice',
    displayName: 'Abnormal Segment Remove',
    description: 'Removes coughs, glitches, blank frames, severe blur, and corrupt media spans after range validation.',
    requiredEvidence: ['audio', 'visual'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'required',
  },
  {
    id: 'repeat-deduplicate',
    stage: 'post-slice',
    displayName: 'Repeat Deduplicate',
    description: 'Removes repeated takes and duplicate content while preserving the strongest complete semantic version.',
    requiredEvidence: ['transcript', 'speaker'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'filler-word-soft-trim',
    stage: 'post-filter',
    displayName: 'Filler Word Soft Trim',
    description: 'Soft trims low-information filler words where transcript alignment remains valid.',
    requiredEvidence: ['transcript', 'speaker'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'ad-fluff-remove',
    stage: 'post-slice',
    displayName: 'Ad And Fluff Remove',
    description: 'Filters ads, off-topic chatter, and low-value setup from long interviews and podcasts.',
    requiredEvidence: ['transcript', 'speaker'],
    destructive: true,
    requiresRevalidation: true,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'stabilize-video',
    stage: 'post-filter',
    displayName: 'Video Stabilize',
    description: 'Stabilizes video without changing speech or content-unit boundaries.',
    requiredEvidence: ['visual'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'required',
  },
  {
    id: 'smart-reframe',
    stage: 'render-packaging',
    displayName: 'Smart Reframe',
    description: 'Reframes subjects for target aspect ratio such as upper-body 2/3 talking-head framing.',
    requiredEvidence: ['visual'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'required',
  },
  {
    id: 'subtitle-sync',
    stage: 'render-packaging',
    displayName: 'Subtitle Sync',
    description: 'Generates sentence-level subtitles from validated transcript timings.',
    requiredEvidence: ['transcript'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'recommended',
  },
  {
    id: 'keyword-highlight',
    stage: 'render-packaging',
    displayName: 'Keyword Highlight',
    description: 'Highlights selected keywords in subtitle styling and cover text.',
    requiredEvidence: ['transcript'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'optional',
  },
  {
    id: 'bgm-ducking',
    stage: 'render-packaging',
    displayName: 'BGM Ducking',
    description: 'Adds low-volume BGM with automatic ducking below speech.',
    requiredEvidence: ['audio'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'required',
  },
  {
    id: 'prompt-sfx',
    stage: 'render-packaging',
    displayName: 'Prompt SFX',
    description: 'Adds short prompt sound effects at approved moments.',
    requiredEvidence: ['audio'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'optional',
  },
  {
    id: 'cover-generate',
    stage: 'render-packaging',
    displayName: 'Cover Generate',
    description: 'Generates a question-plus-core-point cover from the validated slice summary.',
    requiredEvidence: ['transcript', 'visual'],
    destructive: false,
    requiresRevalidation: false,
    nativeAcceleration: 'optional',
  },
] as const satisfies readonly SmartCutFilterDefinition[];
