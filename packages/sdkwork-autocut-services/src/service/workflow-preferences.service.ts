import type {
  AutoCutTextExtractionPreferences,
  AutoCutVideoSlicePreferences,
  AutoCutWorkflowPreferences,
  SliceAlgorithm,
  SliceContinuityLevel,
  SliceCountMode,
  SliceHighlightEngine,
  SliceSubtitleMode,
  SliceTargetAspectRatio,
  SliceTargetPlatform,
  SliceVideoObjectFit,
} from '@sdkwork/autocut-types';
import {
  AUTOCUT_MODEL_VENDOR_PRESETS,
  AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS,
} from '@sdkwork/autocut-types';
import { dispatchAutoCutEvent } from './events.service';
import { createAutoCutTimestamp } from './identity.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';

const VIDEO_SLICE_TARGET_PLATFORMS = new Set<SliceTargetPlatform>([
  'douyin',
  'kuaishou',
  'shipinhao',
  'xiaohongshu',
  'bilibili',
  'generic',
]);
const VIDEO_SLICE_TARGET_ASPECT_RATIOS = new Set<SliceTargetAspectRatio>(['auto', '16:9', '9:16', '1:1', '4:3']);
const VIDEO_SLICE_OBJECT_FITS = new Set<SliceVideoObjectFit>(['contain', 'cover']);
const VIDEO_SLICE_COUNT_MODES = new Set<SliceCountMode>(['auto', 'fixed', 'qualityFirst', 'coverageFirst']);
const VIDEO_SLICE_CONTINUITY_LEVELS = new Set<SliceContinuityLevel>(['standard', 'strict']);
const VIDEO_SLICE_ALGORITHMS = new Set<SliceAlgorithm>(['nlp', 'pause', 'scene']);
const VIDEO_SLICE_HIGHLIGHT_ENGINES = new Set<SliceHighlightEngine>(['emotion', 'keyword', 'motion']);
const VIDEO_SLICE_SUBTITLE_MODES = new Set<SliceSubtitleMode>(['none', 'srt', 'burned', 'both']);

const INITIAL_WORKFLOW_PREFERENCES: AutoCutWorkflowPreferences = {
  videoSlice: {
    mode: '通用',
    targetPlatform: 'douyin',
    targetAspectRatio: 'auto',
    videoObjectFit: 'contain',
    sliceCountMode: 'qualityFirst',
    targetSliceCount: 5,
    idealDuration: 45,
    continuityLevel: 'standard',
    customKeywordsInput: '',
    minDuration: 15,
    maxDuration: 90,
    llmModel: AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.defaultModel,
    baseAlgorithm: 'nlp',
    highlightEngine: 'emotion',
    enableNoiseReduction: true,
    enableCoughFilter: true,
    enableRepeatFilter: false,
    enableSubtitles: false,
    subtitleMode: 'both',
    subtitleStyleId: 'tiktok',
  },
  textExtraction: {
    language: 'auto',
    separateSpeakers: true,
    filterWords: true,
  },
  updatedAt: createAutoCutTimestamp(),
};

const DEFAULT_VIDEO_SLICE_MODE = 'generic';

type StoredAutoCutWorkflowPreferences = Partial<AutoCutWorkflowPreferences> & {
  videoSlice?: Partial<AutoCutVideoSlicePreferences>;
  textExtraction?: Partial<AutoCutTextExtractionPreferences>;
};

function readWorkflowPreferences() {
  const storedPreferences = readAutoCutStorage<StoredAutoCutWorkflowPreferences>(
    'workflowPreferences',
    INITIAL_WORKFLOW_PREFERENCES,
  );
  return normalizeAutoCutWorkflowPreferences(storedPreferences);
}

function writeWorkflowPreferences(preferences: AutoCutWorkflowPreferences) {
  const safePreferences = normalizeAutoCutWorkflowPreferences(preferences);
  writeAutoCutStorage('workflowPreferences', safePreferences);
  dispatchAutoCutEvent('workflowPreferencesUpdated', safePreferences);
  return safePreferences;
}

function updateWorkflowPreferences(
  updater: (preferences: AutoCutWorkflowPreferences) => AutoCutWorkflowPreferences,
) {
  return writeWorkflowPreferences(updater(readWorkflowPreferences()));
}

function normalizeAutoCutWorkflowPreferences(
  preferences: StoredAutoCutWorkflowPreferences,
): AutoCutWorkflowPreferences {
  return {
    ...INITIAL_WORKFLOW_PREFERENCES,
    ...preferences,
    videoSlice: normalizeAutoCutVideoSlicePreferences(preferences.videoSlice),
    textExtraction: normalizeAutoCutTextExtractionPreferences(preferences.textExtraction),
    updatedAt: preferences.updatedAt ?? INITIAL_WORKFLOW_PREFERENCES.updatedAt,
  };
}

function normalizeAutoCutVideoSlicePreferences(
  preferences: Partial<AutoCutVideoSlicePreferences> | undefined,
): AutoCutVideoSlicePreferences {
  const minDuration = clampInteger(preferences?.minDuration, 5, 180, INITIAL_WORKFLOW_PREFERENCES.videoSlice.minDuration);
  const maxDuration = clampInteger(
    preferences?.maxDuration,
    Math.max(10, minDuration),
    600,
    Math.max(INITIAL_WORKFLOW_PREFERENCES.videoSlice.maxDuration, minDuration),
  );

  return {
    mode: normalizeOptionalText(preferences?.mode) ?? DEFAULT_VIDEO_SLICE_MODE,
    targetPlatform: normalizeEnum(
      preferences?.targetPlatform,
      VIDEO_SLICE_TARGET_PLATFORMS,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.targetPlatform,
    ),
    targetAspectRatio: normalizeEnum(
      preferences?.targetAspectRatio,
      VIDEO_SLICE_TARGET_ASPECT_RATIOS,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.targetAspectRatio,
    ),
    videoObjectFit: normalizeEnum(
      preferences?.videoObjectFit,
      VIDEO_SLICE_OBJECT_FITS,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.videoObjectFit,
    ),
    sliceCountMode: normalizeEnum(
      preferences?.sliceCountMode,
      VIDEO_SLICE_COUNT_MODES,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.sliceCountMode,
    ),
    targetSliceCount: clampInteger(
      preferences?.targetSliceCount,
      1,
      20,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.targetSliceCount,
    ),
    idealDuration: clampInteger(
      preferences?.idealDuration,
      minDuration,
      maxDuration,
      Math.min(Math.max(INITIAL_WORKFLOW_PREFERENCES.videoSlice.idealDuration, minDuration), maxDuration),
    ),
    continuityLevel: normalizeEnum(
      preferences?.continuityLevel,
      VIDEO_SLICE_CONTINUITY_LEVELS,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.continuityLevel,
    ),
    customKeywordsInput: normalizeOptionalText(preferences?.customKeywordsInput) ?? '',
    minDuration,
    maxDuration,
    llmModel: normalizeOptionalText(preferences?.llmModel) ?? INITIAL_WORKFLOW_PREFERENCES.videoSlice.llmModel,
    baseAlgorithm: normalizeEnum(
      preferences?.baseAlgorithm,
      VIDEO_SLICE_ALGORITHMS,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.baseAlgorithm,
    ),
    highlightEngine: normalizeEnum(
      preferences?.highlightEngine,
      VIDEO_SLICE_HIGHLIGHT_ENGINES,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.highlightEngine,
    ),
    enableNoiseReduction: normalizeBoolean(
      preferences?.enableNoiseReduction,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.enableNoiseReduction,
    ),
    enableCoughFilter: normalizeBoolean(
      preferences?.enableCoughFilter,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.enableCoughFilter,
    ),
    enableRepeatFilter: normalizeBoolean(
      preferences?.enableRepeatFilter,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.enableRepeatFilter,
    ),
    enableSubtitles: normalizeBoolean(
      preferences?.enableSubtitles,
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.enableSubtitles,
    ),
    subtitleMode: normalizeVideoSliceSubtitleMode(preferences?.subtitleMode),
    subtitleStyleId: normalizeOptionalText(preferences?.subtitleStyleId) ??
      INITIAL_WORKFLOW_PREFERENCES.videoSlice.subtitleStyleId,
  };
}

function normalizeAutoCutTextExtractionPreferences(
  preferences: Partial<AutoCutTextExtractionPreferences> | undefined,
): AutoCutTextExtractionPreferences {
  return {
    language: normalizeAutoCutSpeechLanguage(preferences?.language),
    separateSpeakers: normalizeBoolean(
      preferences?.separateSpeakers,
      INITIAL_WORKFLOW_PREFERENCES.textExtraction.separateSpeakers,
    ),
    filterWords: normalizeBoolean(preferences?.filterWords, INITIAL_WORKFLOW_PREFERENCES.textExtraction.filterWords),
  };
}

function normalizeVideoSliceSubtitleMode(value: unknown): SliceSubtitleMode {
  const normalizedMode = normalizeEnum(
    value,
    VIDEO_SLICE_SUBTITLE_MODES,
    INITIAL_WORKFLOW_PREFERENCES.videoSlice.subtitleMode,
  );
  return normalizedMode;
}

function normalizeAutoCutSpeechLanguage(value: string | undefined) {
  const normalized = normalizeOptionalText(value) ?? INITIAL_WORKFLOW_PREFERENCES.textExtraction.language;
  if (normalized.toLowerCase() === 'auto') {
    return 'auto';
  }

  const sanitized = normalized
    .replace(/_/gu, '-')
    .split('-')
    .map((part, index) => index === 0 ? part.toLowerCase() : part.toUpperCase())
    .join('-');
  const supportedValues = new Set<string>(
    AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => option.value),
  );
  if (supportedValues.has(sanitized)) {
    return sanitized;
  }

  return /^[a-z]{2,3}(?:-[A-Z0-9]{2,8}){0,2}$/u.test(sanitized) ? sanitized : 'auto';
}

function normalizeEnum<T extends string>(value: unknown, allowedValues: ReadonlySet<T>, fallback: T) {
  return typeof value === 'string' && allowedValues.has(value as T) ? value as T : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  return normalized || undefined;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export async function getAutoCutWorkflowPreferences(): Promise<AutoCutWorkflowPreferences> {
  await randomDelay(20, 50);
  return readWorkflowPreferences();
}

export async function saveAutoCutVideoSlicePreferences(
  videoSlice: Partial<AutoCutVideoSlicePreferences>,
): Promise<AutoCutWorkflowPreferences> {
  await randomDelay(20, 50);
  return updateWorkflowPreferences((preferences) => ({
    ...preferences,
    videoSlice: normalizeAutoCutVideoSlicePreferences({
      ...preferences.videoSlice,
      ...videoSlice,
    }),
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function saveAutoCutTextExtractionPreferences(
  textExtraction: Partial<AutoCutTextExtractionPreferences>,
): Promise<AutoCutWorkflowPreferences> {
  await randomDelay(20, 50);
  return updateWorkflowPreferences((preferences) => ({
    ...preferences,
    textExtraction: normalizeAutoCutTextExtractionPreferences({
      ...preferences.textExtraction,
      ...textExtraction,
    }),
    updatedAt: createAutoCutTimestamp(),
  }));
}
