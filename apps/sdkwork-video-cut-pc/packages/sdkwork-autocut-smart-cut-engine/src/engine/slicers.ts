import type {
  SmartCutBoundaryPrimaryUnit,
  SmartCutEvidenceKind,
  SmartCutMediaKind,
} from './domain.ts';

export type SmartCutSlicerId =
  | 'speech-semantic'
  | 'dialogue-qa'
  | 'topic-chapter'
  | 'meeting-agenda'
  | 'podcast-topic'
  | 'knowledge-point'
  | 'visual-scene'
  | 'motion-action'
  | 'audio-waveform'
  | 'music-beat'
  | 'multimodal-highlight'
  | 'template-rule'
  | 'event-detection'
  | 'screen-ocr'
  | 'commerce-live'
  | 'documentary-chapter'
  | 'film-scene'
  | 'sports-event'
  | 'gaming-highlight'
  | 'vlog-story'
  | 'course-chapter'
  | 'news-segment'
  | 'compliance';

export type SmartCutSlicerFamily =
  | 'speech'
  | 'dialogue'
  | 'topic'
  | 'visual'
  | 'audio'
  | 'music'
  | 'multimodal'
  | 'template'
  | 'event'
  | 'screen'
  | 'commerce'
  | 'compliance';

export interface SmartCutBoundaryPolicy {
  primaryUnit: SmartCutBoundaryPrimaryUnit;
  allowsRawTimeCut: boolean;
  requiresCompleteSemanticUnit: boolean;
  preservesSourceContinuity: boolean;
  minimumConfidence: number;
}

export interface SmartCutSpeakerPolicy {
  requiresDiarization: boolean;
  requiresRoleAssignment: boolean;
  allowsUnknownSpeaker: boolean;
  handlesOverlappingSpeech: boolean;
}

export interface SmartCutLlmPolicy {
  enabled: boolean;
  role: 'disabled' | 'reviewer-ranker' | 'planner-with-candidate-ids';
  mustReferenceStableIds: boolean;
  mayCreateRawTimeRanges: false;
}

export interface SmartCutSlicerDefinition {
  id: SmartCutSlicerId;
  family: SmartCutSlicerFamily;
  displayName: string;
  description: string;
  supportedMediaKinds: readonly SmartCutMediaKind[];
  requiredEvidence: readonly SmartCutEvidenceKind[];
  optionalEvidence: readonly SmartCutEvidenceKind[];
  boundaryPolicy: SmartCutBoundaryPolicy;
  speakerPolicy: SmartCutSpeakerPolicy;
  llmPolicy: SmartCutLlmPolicy;
  nativeAcceleration: 'required' | 'recommended' | 'optional';
  defaultPriority: number;
}

const noSpeakerPolicy = {
  requiresDiarization: false,
  requiresRoleAssignment: false,
  allowsUnknownSpeaker: true,
  handlesOverlappingSpeech: false,
} as const satisfies SmartCutSpeakerPolicy;

const speakerAwarePolicy = {
  requiresDiarization: true,
  requiresRoleAssignment: false,
  allowsUnknownSpeaker: false,
  handlesOverlappingSpeech: true,
} as const satisfies SmartCutSpeakerPolicy;

const dialogueSpeakerPolicy = {
  requiresDiarization: true,
  requiresRoleAssignment: true,
  allowsUnknownSpeaker: false,
  handlesOverlappingSpeech: true,
} as const satisfies SmartCutSpeakerPolicy;

const reviewerLlmPolicy = {
  enabled: true,
  role: 'reviewer-ranker',
  mustReferenceStableIds: true,
  mayCreateRawTimeRanges: false,
} as const satisfies SmartCutLlmPolicy;

const disabledLlmPolicy = {
  enabled: false,
  role: 'disabled',
  mustReferenceStableIds: true,
  mayCreateRawTimeRanges: false,
} as const satisfies SmartCutLlmPolicy;

function createBoundaryPolicy(primaryUnit: SmartCutBoundaryPrimaryUnit, overrides: Partial<SmartCutBoundaryPolicy> = {}): SmartCutBoundaryPolicy {
  return {
    primaryUnit,
    allowsRawTimeCut: false,
    requiresCompleteSemanticUnit: true,
    preservesSourceContinuity: true,
    minimumConfidence: 0.72,
    ...overrides,
  };
}

export const SMART_CUT_SLICER_REGISTRY = [
  {
    id: 'speech-semantic',
    family: 'speech',
    displayName: 'Speech Semantic Slicer',
    description: 'Default speech-first slicer. It converts speech into timestamped content units, then cuts only on complete semantic boundaries.',
    supportedMediaKinds: ['talking-head', 'interview', 'meeting', 'podcast', 'course', 'news', 'commerce-live', 'mixed'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['audio', 'visual', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('content-unit'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 100,
  },
  {
    id: 'dialogue-qa',
    family: 'dialogue',
    displayName: 'Dialogue Q/A Slicer',
    description: 'Pairs question and answer turns, preserving speaker continuity for interviews, panels, and multi-person dialogue.',
    supportedMediaKinds: ['interview', 'meeting', 'podcast', 'news', 'mixed'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['audio', 'visual', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('qa-pair'),
    speakerPolicy: dialogueSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 95,
  },
  {
    id: 'topic-chapter',
    family: 'topic',
    displayName: 'Topic Chapter Slicer',
    description: 'Cuts long spoken material into coherent topic chapters using transcript, speaker turns, and topic shifts.',
    supportedMediaKinds: ['meeting', 'podcast', 'course', 'documentary', 'news', 'mixed'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['audio', 'visual', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('topic-chapter'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 90,
  },
  {
    id: 'meeting-agenda',
    family: 'topic',
    displayName: 'Meeting Agenda Slicer',
    description: 'Segments meeting recordings by agenda item, decision, action item, and speaker handoff.',
    supportedMediaKinds: ['meeting'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['audio', 'ocr', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('topic-chapter'),
    speakerPolicy: dialogueSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 84,
  },
  {
    id: 'podcast-topic',
    family: 'topic',
    displayName: 'Podcast Topic Slicer',
    description: 'Cuts podcasts into topic arcs while preserving host/guest context and story payoff.',
    supportedMediaKinds: ['podcast', 'interview'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['audio', 'music', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('topic-chapter'),
    speakerPolicy: dialogueSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 82,
  },
  {
    id: 'knowledge-point',
    family: 'speech',
    displayName: 'Knowledge Point Slicer',
    description: 'Extracts self-contained teaching points, definitions, examples, and conclusions from course or explainer content.',
    supportedMediaKinds: ['course', 'talking-head', 'screen-recording'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['ocr', 'visual', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('content-unit'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 80,
  },
  {
    id: 'visual-scene',
    family: 'visual',
    displayName: 'Visual Scene Slicer',
    description: 'Segments video by shot and scene changes for film, documentary, b-roll, and non-speech footage.',
    supportedMediaKinds: ['film', 'documentary', 'vlog', 'music-video', 'mixed'],
    requiredEvidence: ['visual'],
    optionalEvidence: ['audio', 'transcript', 'speaker', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('visual-scene', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 78,
  },
  {
    id: 'motion-action',
    family: 'visual',
    displayName: 'Motion Action Slicer',
    description: 'Cuts around action starts, peaks, and resolutions using motion vectors and object/activity detection.',
    supportedMediaKinds: ['sports', 'gaming', 'vlog', 'film', 'mixed'],
    requiredEvidence: ['visual', 'motion'],
    optionalEvidence: ['audio', 'event', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('event', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 76,
  },
  {
    id: 'audio-waveform',
    family: 'audio',
    displayName: 'Audio Waveform Slicer',
    description: 'Cuts by speech activity, silence, loudness, and abnormal waveform regions for cleanup and rough segmentation.',
    supportedMediaKinds: ['talking-head', 'interview', 'meeting', 'podcast', 'music-video', 'mixed'],
    requiredEvidence: ['audio'],
    optionalEvidence: ['transcript', 'speaker'],
    boundaryPolicy: createBoundaryPolicy('audio-event', {
      requiresCompleteSemanticUnit: false,
      minimumConfidence: 0.65,
    }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: disabledLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 60,
  },
  {
    id: 'music-beat',
    family: 'music',
    displayName: 'Music Beat Slicer',
    description: 'Aligns cuts to beat grids, downbeats, chorus/drop sections, and phrase boundaries.',
    supportedMediaKinds: ['music-video', 'vlog', 'mixed'],
    requiredEvidence: ['music', 'audio'],
    optionalEvidence: ['visual'],
    boundaryPolicy: createBoundaryPolicy('music-beat', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: disabledLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 70,
  },
  {
    id: 'multimodal-highlight',
    family: 'multimodal',
    displayName: 'Multimodal Highlight Slicer',
    description: 'Ranks highlights from speech, visual action, audio events, OCR, and engagement signals.',
    supportedMediaKinds: ['sports', 'gaming', 'vlog', 'documentary', 'commerce-live', 'mixed'],
    requiredEvidence: ['audio', 'visual'],
    optionalEvidence: ['transcript', 'speaker', 'ocr', 'event', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('event', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 74,
  },
  {
    id: 'template-rule',
    family: 'template',
    displayName: 'Template Rule Slicer',
    description: 'Uses deterministic templates such as fixed chapters, platform slots, intro/body/outro, or campaign rules.',
    supportedMediaKinds: ['talking-head', 'course', 'commerce-live', 'screen-recording', 'mixed'],
    requiredEvidence: ['media'],
    optionalEvidence: ['transcript', 'speaker', 'audio', 'visual', 'ocr'],
    boundaryPolicy: createBoundaryPolicy('template-window', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: disabledLlmPolicy,
    nativeAcceleration: 'optional',
    defaultPriority: 50,
  },
  {
    id: 'event-detection',
    family: 'event',
    displayName: 'Event Detection Slicer',
    description: 'Cuts around explicit events such as applause, slide change, whistle, goal, laugh, or product demonstration.',
    supportedMediaKinds: ['sports', 'gaming', 'course', 'commerce-live', 'documentary', 'mixed'],
    requiredEvidence: ['event'],
    optionalEvidence: ['audio', 'visual', 'transcript', 'speaker'],
    boundaryPolicy: createBoundaryPolicy('event', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 72,
  },
  {
    id: 'screen-ocr',
    family: 'screen',
    displayName: 'Screen OCR Slicer',
    description: 'Segments screen recordings and slide videos by OCR regions, slide/page changes, and UI state changes.',
    supportedMediaKinds: ['screen-recording', 'course', 'meeting'],
    requiredEvidence: ['ocr', 'visual'],
    optionalEvidence: ['transcript', 'speaker', 'audio', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('ocr-section'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 68,
  },
  {
    id: 'commerce-live',
    family: 'commerce',
    displayName: 'Commerce Live Slicer',
    description: 'Extracts product demonstration, offer explanation, objection handling, and conversion moments from live commerce.',
    supportedMediaKinds: ['commerce-live'],
    requiredEvidence: ['transcript', 'speaker', 'visual'],
    optionalEvidence: ['audio', 'ocr', 'event', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('content-unit'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 73,
  },
  {
    id: 'documentary-chapter',
    family: 'multimodal',
    displayName: 'Documentary Chapter Slicer',
    description: 'Segments documentary content by narration arc, interview quote, location change, and visual chapter.',
    supportedMediaKinds: ['documentary'],
    requiredEvidence: ['visual', 'audio'],
    optionalEvidence: ['transcript', 'speaker', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('topic-chapter'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 77,
  },
  {
    id: 'film-scene',
    family: 'visual',
    displayName: 'Film Scene Slicer',
    description: 'Cuts narrative film by scene, shot cluster, dialogue exchange, and audio transition.',
    supportedMediaKinds: ['film'],
    requiredEvidence: ['visual', 'audio'],
    optionalEvidence: ['transcript', 'speaker', 'music', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('visual-scene', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 75,
  },
  {
    id: 'sports-event',
    family: 'event',
    displayName: 'Sports Event Slicer',
    description: 'Extracts rallies, goals, scoring plays, replays, reactions, and commentary highlights.',
    supportedMediaKinds: ['sports'],
    requiredEvidence: ['event', 'visual', 'audio'],
    optionalEvidence: ['transcript', 'speaker', 'ocr', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('event', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: noSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 71,
  },
  {
    id: 'gaming-highlight',
    family: 'event',
    displayName: 'Gaming Highlight Slicer',
    description: 'Extracts kills, wins, fails, boss phases, streamer reactions, and UI-triggered events.',
    supportedMediaKinds: ['gaming'],
    requiredEvidence: ['visual', 'audio', 'event'],
    optionalEvidence: ['transcript', 'speaker', 'ocr', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('event', { requiresCompleteSemanticUnit: false }),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 69,
  },
  {
    id: 'vlog-story',
    family: 'multimodal',
    displayName: 'Vlog Story Slicer',
    description: 'Cuts vlogs by setup, action, reaction, transition, and payoff while preserving story continuity.',
    supportedMediaKinds: ['vlog'],
    requiredEvidence: ['visual', 'audio'],
    optionalEvidence: ['transcript', 'speaker', 'music', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('content-unit'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'required',
    defaultPriority: 67,
  },
  {
    id: 'course-chapter',
    family: 'speech',
    displayName: 'Course Chapter Slicer',
    description: 'Segments courses into objective, concept, demonstration, exercise, and summary blocks.',
    supportedMediaKinds: ['course', 'screen-recording'],
    requiredEvidence: ['transcript', 'speaker'],
    optionalEvidence: ['ocr', 'visual', 'audio', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('topic-chapter'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 79,
  },
  {
    id: 'news-segment',
    family: 'topic',
    displayName: 'News Segment Slicer',
    description: 'Cuts news by headline, anchor handoff, package, interview quote, and topic transition.',
    supportedMediaKinds: ['news'],
    requiredEvidence: ['transcript', 'speaker', 'visual'],
    optionalEvidence: ['ocr', 'audio', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('topic-chapter'),
    speakerPolicy: dialogueSpeakerPolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 66,
  },
  {
    id: 'compliance',
    family: 'compliance',
    displayName: 'Compliance Slicer',
    description: 'Removes or isolates prohibited, repetitive, ad, privacy, or low-confidence ranges before publish approval.',
    supportedMediaKinds: ['talking-head', 'interview', 'meeting', 'podcast', 'course', 'documentary', 'film', 'commerce-live', 'news', 'mixed'],
    requiredEvidence: ['transcript'],
    optionalEvidence: ['speaker', 'audio', 'visual', 'ocr', 'llm-review'],
    boundaryPolicy: createBoundaryPolicy('content-unit'),
    speakerPolicy: speakerAwarePolicy,
    llmPolicy: reviewerLlmPolicy,
    nativeAcceleration: 'recommended',
    defaultPriority: 40,
  },
] as const satisfies readonly SmartCutSlicerDefinition[];
