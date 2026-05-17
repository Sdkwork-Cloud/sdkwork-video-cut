import type { SmartCutFilterId } from './filters.ts';
import type { SmartCutOutputProfile, SmartCutRequirementSource } from './domain.ts';
import type { SmartCutSlicerId } from './slicers.ts';
import type { SmartCutValidatorId } from './validators.ts';

export type SmartCutProductPresetId =
  | 'teacher-talking-head-single'
  | 'interview-one-question-one-answer'
  | 'long-interview-matrix'
  | 'meeting-minutes-highlights'
  | 'course-knowledge-clips'
  | 'film-scene-index'
  | 'documentary-story-chapters'
  | 'music-beat-clips'
  | 'sports-highlight-reel'
  | 'gaming-highlight-reel'
  | 'commerce-live-product-cards'
  | 'screen-recording-tutorial';

export type SmartCutRendererId =
  | 'publishable-short-video'
  | 'batch-short-video'
  | 'chapter-index'
  | 'highlight-reel'
  | 'asset-only';

export interface SmartCutSubtitleProfile {
  enabled: boolean;
  language: 'zh-CN' | 'en-US' | 'auto';
  granularity: 'sentence' | 'phrase' | 'word';
  fontFamily: string;
  shadow: boolean;
  keywordHighlight: boolean;
  syncRequired: boolean;
}

export interface SmartCutAudioPackagingProfile {
  speechEnhancement: boolean;
  removeReverb: boolean;
  bgmVolumePercent?: number;
  promptSfx: boolean;
}

export interface SmartCutVisualPackagingProfile {
  stabilize: boolean;
  smartReframe: boolean;
  framing?: 'upper-body-two-thirds' | 'speaker-focus' | 'scene-native' | 'screen-content';
  coverPolicy: 'question-plus-core' | 'scene-frame' | 'chapter-title' | 'none';
}

export interface SmartCutProductPresetDefinition {
  id: SmartCutProductPresetId;
  requirementSource: SmartCutRequirementSource;
  displayName: string;
  description: string;
  slicerChain: readonly SmartCutSlicerId[];
  filters: readonly SmartCutFilterId[];
  validators: readonly SmartCutValidatorId[];
  renderers: readonly SmartCutRendererId[];
  outputProfile: SmartCutOutputProfile;
  subtitleProfile: SmartCutSubtitleProfile;
  audioPackaging: SmartCutAudioPackagingProfile;
  visualPackaging: SmartCutVisualPackagingProfile;
  requiresSpeakerDiarization: boolean;
  batchOutput: boolean;
}

const shortVideoOutputProfile = {
  aspectRatio: '9:16',
  resolution: '1080x1920',
  frameRateFps: 30,
  format: 'mp4',
  maxDurationMs: 90_000,
} as const satisfies SmartCutOutputProfile;

const chineseSentenceSubtitleProfile = {
  enabled: true,
  language: 'zh-CN',
  granularity: 'sentence',
  fontFamily: 'Jisong',
  shadow: true,
  keywordHighlight: true,
  syncRequired: true,
} as const satisfies SmartCutSubtitleProfile;

const teacherAudioPackaging = {
  speechEnhancement: true,
  removeReverb: true,
  bgmVolumePercent: 20,
  promptSfx: true,
} as const satisfies SmartCutAudioPackagingProfile;

const teacherVisualPackaging = {
  stabilize: true,
  smartReframe: true,
  framing: 'upper-body-two-thirds',
  coverPolicy: 'question-plus-core',
} as const satisfies SmartCutVisualPackagingProfile;

export const SMART_CUT_PRODUCT_PRESET_REGISTRY = [
  {
    id: 'teacher-talking-head-single',
    requirementSource: 'ORG_REQUIREMENTS.type-1',
    displayName: 'Teacher Talking Head Single',
    description: 'Original type-1 requirement: one publishable teacher short video with semantic speech slicing, cleanup, subtitles, cover, BGM, and vertical packaging.',
    slicerChain: ['speech-semantic', 'compliance'],
    filters: [
      'speech-denoise',
      'dereverb',
      'silence-trim',
      'abnormal-segment-remove',
      'repeat-deduplicate',
      'stabilize-video',
      'smart-reframe',
      'subtitle-sync',
      'keyword-highlight',
      'bgm-ducking',
      'prompt-sfx',
      'cover-generate',
    ],
    validators: [
      'evidence-coverage',
      'semantic-completeness',
      'speaker-continuity',
      'boundary-integrity',
      'post-filter-integrity',
      'duration-contract',
      'publishability-standard',
      'render-artifact-integrity',
    ],
    renderers: ['publishable-short-video'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: chineseSentenceSubtitleProfile,
    audioPackaging: teacherAudioPackaging,
    visualPackaging: teacherVisualPackaging,
    requiresSpeakerDiarization: true,
    batchOutput: false,
  },
  {
    id: 'interview-one-question-one-answer',
    requirementSource: 'ORG_REQUIREMENTS.type-2',
    displayName: 'Interview One Question One Answer',
    description: 'Original type-2 requirement: split each valid question and answer pair into batch short videos with speaker-aware dialogue continuity.',
    slicerChain: ['dialogue-qa', 'speech-semantic', 'compliance'],
    filters: [
      'speech-denoise',
      'dereverb',
      'silence-trim',
      'abnormal-segment-remove',
      'repeat-deduplicate',
      'stabilize-video',
      'smart-reframe',
      'subtitle-sync',
      'keyword-highlight',
      'bgm-ducking',
      'prompt-sfx',
      'cover-generate',
    ],
    validators: [
      'evidence-coverage',
      'semantic-completeness',
      'speaker-continuity',
      'boundary-integrity',
      'post-filter-integrity',
      'duration-contract',
      'publishability-standard',
      'render-artifact-integrity',
    ],
    renderers: ['batch-short-video'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: chineseSentenceSubtitleProfile,
    audioPackaging: teacherAudioPackaging,
    visualPackaging: {
      stabilize: true,
      smartReframe: true,
      framing: 'speaker-focus',
      coverPolicy: 'question-plus-core',
    },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'long-interview-matrix',
    requirementSource: 'ORG_REQUIREMENTS.type-3',
    displayName: 'Long Interview Matrix',
    description: 'Original type-3 requirement: extract Q/A matrix clips, 60-180 seconds each, removing ads and low-value fluff.',
    slicerChain: ['dialogue-qa', 'topic-chapter', 'compliance'],
    filters: [
      'ad-fluff-remove',
      'speech-denoise',
      'dereverb',
      'silence-trim',
      'abnormal-segment-remove',
      'repeat-deduplicate',
      'stabilize-video',
      'smart-reframe',
      'subtitle-sync',
      'keyword-highlight',
      'bgm-ducking',
      'prompt-sfx',
      'cover-generate',
    ],
    validators: [
      'evidence-coverage',
      'semantic-completeness',
      'speaker-continuity',
      'boundary-integrity',
      'post-filter-integrity',
      'duration-contract',
      'publishability-standard',
      'render-artifact-integrity',
    ],
    renderers: ['batch-short-video'],
    outputProfile: {
      ...shortVideoOutputProfile,
      minDurationMs: 60_000,
      maxDurationMs: 180_000,
    },
    subtitleProfile: chineseSentenceSubtitleProfile,
    audioPackaging: teacherAudioPackaging,
    visualPackaging: {
      stabilize: true,
      smartReframe: true,
      framing: 'speaker-focus',
      coverPolicy: 'question-plus-core',
    },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'meeting-minutes-highlights',
    requirementSource: 'industry.standard',
    displayName: 'Meeting Minutes Highlights',
    description: 'Segments meetings by agenda item, decision, action item, and speaker turn.',
    slicerChain: ['meeting-agenda', 'speech-semantic', 'compliance'],
    filters: ['speech-denoise', 'silence-trim', 'repeat-deduplicate', 'subtitle-sync', 'cover-generate'],
    validators: ['evidence-coverage', 'semantic-completeness', 'speaker-continuity', 'boundary-integrity', 'post-filter-integrity'],
    renderers: ['batch-short-video', 'chapter-index'],
    outputProfile: { aspectRatio: '16:9', resolution: '1920x1080', frameRateFps: 'source', format: 'mp4' },
    subtitleProfile: { ...chineseSentenceSubtitleProfile, language: 'auto' },
    audioPackaging: { speechEnhancement: true, removeReverb: false, promptSfx: false },
    visualPackaging: { stabilize: false, smartReframe: false, coverPolicy: 'chapter-title' },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'course-knowledge-clips',
    requirementSource: 'industry.standard',
    displayName: 'Course Knowledge Clips',
    description: 'Extracts standalone teaching points and examples from course or screen-recorded lessons.',
    slicerChain: ['knowledge-point', 'course-chapter', 'screen-ocr', 'compliance'],
    filters: ['speech-denoise', 'silence-trim', 'subtitle-sync', 'keyword-highlight', 'cover-generate'],
    validators: ['evidence-coverage', 'semantic-completeness', 'speaker-continuity', 'boundary-integrity', 'post-filter-integrity', 'publishability-standard'],
    renderers: ['batch-short-video'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: chineseSentenceSubtitleProfile,
    audioPackaging: { speechEnhancement: true, removeReverb: false, promptSfx: false },
    visualPackaging: { stabilize: true, smartReframe: true, framing: 'screen-content', coverPolicy: 'chapter-title' },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'film-scene-index',
    requirementSource: 'industry.standard',
    displayName: 'Film Scene Index',
    description: 'Builds a scene and shot index from visual and audio continuity.',
    slicerChain: ['film-scene', 'visual-scene', 'music-beat'],
    filters: ['abnormal-segment-remove'],
    validators: ['evidence-coverage', 'boundary-integrity', 'render-artifact-integrity'],
    renderers: ['chapter-index', 'asset-only'],
    outputProfile: { aspectRatio: 'source', resolution: 'source', frameRateFps: 'source', format: 'mp4' },
    subtitleProfile: { enabled: false, language: 'auto', granularity: 'sentence', fontFamily: 'Jisong', shadow: false, keywordHighlight: false, syncRequired: false },
    audioPackaging: { speechEnhancement: false, removeReverb: false, promptSfx: false },
    visualPackaging: { stabilize: false, smartReframe: false, coverPolicy: 'scene-frame' },
    requiresSpeakerDiarization: false,
    batchOutput: true,
  },
  {
    id: 'documentary-story-chapters',
    requirementSource: 'industry.standard',
    displayName: 'Documentary Story Chapters',
    description: 'Cuts documentary content by narrative chapter, interview quote, location, and visual transition.',
    slicerChain: ['documentary-chapter', 'topic-chapter', 'visual-scene'],
    filters: ['speech-denoise', 'silence-trim', 'abnormal-segment-remove', 'subtitle-sync', 'cover-generate'],
    validators: ['evidence-coverage', 'semantic-completeness', 'speaker-continuity', 'boundary-integrity', 'post-filter-integrity'],
    renderers: ['chapter-index', 'batch-short-video'],
    outputProfile: { aspectRatio: '16:9', resolution: '1920x1080', frameRateFps: 'source', format: 'mp4' },
    subtitleProfile: { ...chineseSentenceSubtitleProfile, language: 'auto' },
    audioPackaging: { speechEnhancement: true, removeReverb: false, promptSfx: false },
    visualPackaging: { stabilize: true, smartReframe: false, coverPolicy: 'scene-frame' },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'music-beat-clips',
    requirementSource: 'industry.standard',
    displayName: 'Music Beat Clips',
    description: 'Creates clips aligned to beat, chorus, drop, and visual rhythm.',
    slicerChain: ['music-beat', 'visual-scene'],
    filters: ['stabilize-video', 'smart-reframe'],
    validators: ['evidence-coverage', 'boundary-integrity', 'render-artifact-integrity'],
    renderers: ['highlight-reel'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: { enabled: false, language: 'auto', granularity: 'phrase', fontFamily: 'Jisong', shadow: false, keywordHighlight: false, syncRequired: false },
    audioPackaging: { speechEnhancement: false, removeReverb: false, promptSfx: false },
    visualPackaging: { stabilize: true, smartReframe: true, framing: 'scene-native', coverPolicy: 'scene-frame' },
    requiresSpeakerDiarization: false,
    batchOutput: true,
  },
  {
    id: 'sports-highlight-reel',
    requirementSource: 'industry.standard',
    displayName: 'Sports Highlight Reel',
    description: 'Extracts scoring events, rallies, replay clusters, crowd reactions, and commentary highlights.',
    slicerChain: ['sports-event', 'multimodal-highlight'],
    filters: ['abnormal-segment-remove', 'stabilize-video', 'smart-reframe', 'prompt-sfx', 'cover-generate'],
    validators: ['evidence-coverage', 'boundary-integrity', 'publishability-standard', 'render-artifact-integrity'],
    renderers: ['highlight-reel', 'batch-short-video'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: { ...chineseSentenceSubtitleProfile, language: 'auto' },
    audioPackaging: { speechEnhancement: false, removeReverb: false, promptSfx: true },
    visualPackaging: { stabilize: true, smartReframe: true, framing: 'scene-native', coverPolicy: 'scene-frame' },
    requiresSpeakerDiarization: false,
    batchOutput: true,
  },
  {
    id: 'gaming-highlight-reel',
    requirementSource: 'industry.standard',
    displayName: 'Gaming Highlight Reel',
    description: 'Extracts gameplay events, streamer reactions, OCR/UI state changes, and audio peaks.',
    slicerChain: ['gaming-highlight', 'screen-ocr', 'multimodal-highlight'],
    filters: ['abnormal-segment-remove', 'subtitle-sync', 'prompt-sfx', 'cover-generate'],
    validators: ['evidence-coverage', 'semantic-completeness', 'speaker-continuity', 'boundary-integrity', 'publishability-standard'],
    renderers: ['highlight-reel', 'batch-short-video'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: { ...chineseSentenceSubtitleProfile, language: 'auto' },
    audioPackaging: { speechEnhancement: true, removeReverb: false, promptSfx: true },
    visualPackaging: { stabilize: false, smartReframe: true, framing: 'scene-native', coverPolicy: 'scene-frame' },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'commerce-live-product-cards',
    requirementSource: 'industry.standard',
    displayName: 'Commerce Live Product Cards',
    description: 'Extracts product explainers, offer claims, objection handling, and purchase prompts.',
    slicerChain: ['commerce-live', 'speech-semantic', 'screen-ocr', 'compliance'],
    filters: ['ad-fluff-remove', 'speech-denoise', 'silence-trim', 'repeat-deduplicate', 'smart-reframe', 'subtitle-sync', 'keyword-highlight', 'cover-generate'],
    validators: ['evidence-coverage', 'semantic-completeness', 'speaker-continuity', 'boundary-integrity', 'post-filter-integrity', 'publishability-standard'],
    renderers: ['batch-short-video'],
    outputProfile: shortVideoOutputProfile,
    subtitleProfile: chineseSentenceSubtitleProfile,
    audioPackaging: teacherAudioPackaging,
    visualPackaging: { stabilize: true, smartReframe: true, framing: 'speaker-focus', coverPolicy: 'question-plus-core' },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
  {
    id: 'screen-recording-tutorial',
    requirementSource: 'industry.standard',
    displayName: 'Screen Recording Tutorial',
    description: 'Cuts tutorials by OCR/UI state, spoken step, and knowledge point.',
    slicerChain: ['screen-ocr', 'knowledge-point', 'course-chapter'],
    filters: ['speech-denoise', 'silence-trim', 'subtitle-sync', 'keyword-highlight', 'cover-generate'],
    validators: ['evidence-coverage', 'semantic-completeness', 'speaker-continuity', 'boundary-integrity', 'post-filter-integrity', 'publishability-standard'],
    renderers: ['batch-short-video', 'chapter-index'],
    outputProfile: { aspectRatio: '16:9', resolution: '1920x1080', frameRateFps: 'source', format: 'mp4' },
    subtitleProfile: { ...chineseSentenceSubtitleProfile, language: 'auto' },
    audioPackaging: { speechEnhancement: true, removeReverb: false, promptSfx: false },
    visualPackaging: { stabilize: false, smartReframe: false, framing: 'screen-content', coverPolicy: 'chapter-title' },
    requiresSpeakerDiarization: true,
    batchOutput: true,
  },
] as const satisfies readonly SmartCutProductPresetDefinition[];
