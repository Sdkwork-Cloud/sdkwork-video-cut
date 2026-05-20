import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

function read(relativePath) {
  return normalizeLineEndings(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

const failures = [];
const pass = [];
const speechTranscriptionService = read('packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts');
const i18nResources = read('packages/sdkwork-autocut-services/src/service/i18n-resources.service.ts');
const identityService = read('packages/sdkwork-autocut-services/src/service/identity.service.ts');
const autocutTypes = read('packages/sdkwork-autocut-types/src/index.ts');
const rootPackageJson = read('package.json');

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertIncludes(source, marker, message) {
  assertRule(source.includes(marker), message);
}

function assertNotIncludes(source, marker, message) {
  assertRule(!source.includes(marker), message);
}

function countSourceOccurrences(source, marker) {
  return source.split(marker).length - 1;
}

function assertOccurrenceAtLeast(source, marker, minimumCount, message) {
  assertRule(
    countSourceOccurrences(source, marker) >= minimumCount,
    `${message} (expected at least ${minimumCount} occurrences of ${JSON.stringify(marker)})`,
  );
}

function assertLineOrder(source, earlierMarker, laterMarker, message) {
  const earlierIndex = source.indexOf(earlierMarker);
  const laterIndex = source.indexOf(laterMarker);
  assertRule(
    earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex,
    `${message} (expected ${JSON.stringify(earlierMarker)} before ${JSON.stringify(laterMarker)})`,
  );
}

function normalizeLineEndings(source) {
  return source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function assertMatches(source, pattern, message) {
  assertRule(pattern.test(source), message);
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    return '';
  }
  return source.slice(start, end);
}

function toLowerCamelCase(value) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`))
    .join('');
}

function extractSmartSliceReviewRiskCatalogCodes(source) {
  const catalogMatch = source.match(/AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG\s*=\s*\{([\s\S]*?)\n\} as const/u);
  const catalogBody = catalogMatch?.[1] ?? '';
  return new Set([...catalogBody.matchAll(/^ {2}['"]([^'"]+)['"]:\s*\{/gmu)].map((match) => match[1]));
}

function extractSmartSliceReviewRiskCatalogEntries(source) {
  const catalogMatch = source.match(/AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG\s*=\s*\{([\s\S]*?)\n\} as const/u);
  const catalogBody = catalogMatch?.[1] ?? '';
  return [...catalogBody.matchAll(
    /^ {2}['"]([^'"]+)['"]:[\s\S]*?labelKey:\s*'taskDetail\.reviewRisk\.([^']+)\.label',[\s\S]*?messageKey:\s*'taskDetail\.reviewRisk\.([^']+)\.message',[\s\S]*?remediationKey:\s*'taskDetail\.reviewRisk\.([^']+)\.remediation',/gmu,
  )].map((match) => ({
    code: match[1],
    labelResourceKey: match[2],
    messageResourceKey: match[3],
    remediationResourceKey: match[4],
  }));
}

function assertOpeningTagsHaveHandler(source, tagName, relativePath) {
  const openingTagPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gu');
  for (const match of source.matchAll(openingTagPattern)) {
    const tag = match[0];
    assertRule(
      /\bonClick\s*=/u.test(tag),
      `${relativePath} interactive <${tagName}> tag has an onClick handler: ${tag.replace(/\s+/gu, ' ').slice(0, 140)}`,
    );
  }
}

const processingWorkflows = [
  {
    name: 'slicer',
    page: 'packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx',
    service: 'packages/sdkwork-autocut-slicer/src/service/slicerService.ts',
    processFn: 'processVideoSlice',
    pageMarkers: ['NativeSmartSliceVideoPreview', "listenAutoCutEvent('taskUpdated'", "listenAutoCutEvent('taskAdded'", 'setActiveLeftTab("tasks")', 'navigate(`/tasks/${task.id}`)', 'formatAutoCutTimeOfDay(task.createdAt)'],
    serviceMarkers: [
      'addTask',
      'createSmartSliceNativePreflightErrorMessage',
      'failAutoCutProcessingTask',
      'addAsset',
      'addMessage',
      'sliceResults',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'createAutoCutOpenAiCompatibleChatCompletion',
      'resolveAutoCutOutputRootDir',
      'transcribeAutoCutMediaWithConfiguredProvider',
      'AutoCutSpeechTranscriptionSegment',
      'sliceVideo',
      'renderProfile',
      'createAssetUrl',
      'thumbnailArtifactPath',
      'createSmartCutEngineSlicePlan',
      'createSmartCutEngineLlmReview',
      'SmartCutEngineSlicePlanningError',
      'toNativeSliceClipRequest',
      'plannedClips[index]',
    ],
    planningKernel: 'packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts',
    planningMarkers: [
      'createSmartCutEngineSlicePlan',
      'createSmartCutSpeechFirstExecutionPackage',
      'createSmartCutTranscriptEvidence',
      'createSmartCutSpeakerEvidence',
      'createSmartCutEngineLlmReview',
      'rankedCandidateIds',
      'referencedUnitIds',
      'Never return startMs, endMs, durationMs, or raw timestamps',
      'MISSING_MULTI_SPEAKER_DIARIZATION',
      'contentUnitIds',
      'speakerIds',
      'speakerRoles',
      'sourceDurationMs',
      'planningEngine',
      'smartCutPresetId',
      'smartCutPlanId',
      'smartCutRunId',
    ],
  },
  {
    name: 'extractor-text',
    page: 'packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx',
    service: 'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts',
    processFn: 'processExtractorText',
    uploadStreamRequirement: 'requiredStreams={{ audio: true }}',
    pageMarkers: ['downloadExtractedTextFile', 'writeAutoCutClipboardText', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'assertAutoCutMediaHasAudioStream',
      'addAsset',
      'addMessage',
      'extractedText',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'transcribeAutoCutMediaWithConfiguredProvider',
      'importMediaFile',
      'createNativeExtractedTextSegments',
      'normalizeExtractedTranscriptText',
      "params.format",
    ],
  },
  {
    name: 'extractor-audio',
    page: 'packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx',
    service: 'packages/sdkwork-autocut-extractor-audio/src/service/audioExtractorService.ts',
    processFn: 'processAudioExtraction',
    uploadStreamRequirement: 'requiredStreams={{ audio: true }}',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'assertAutoCutMediaHasAudioStream',
      'addAsset',
      'addMessage',
      'audioUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'importMediaFile',
      'extractAudio',
      'outputQuality: params.quality',
      'outputChannel: params.channel',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-gif',
    page: 'packages/sdkwork-autocut-video-gif/src/pages/VideoGifPage.tsx',
    service: 'packages/sdkwork-autocut-video-gif/src/service/videoGifService.ts',
    processFn: 'processVideoGif',
    uploadStreamRequirement: 'requiredStreams={{ video: true }}',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'assertAutoCutMediaHasVideoStream',
      'addAsset',
      'addMessage',
      'gifUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'generateGif',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-compress',
    page: 'packages/sdkwork-autocut-video-compress/src/pages/VideoCompressPage.tsx',
    service: 'packages/sdkwork-autocut-video-compress/src/service/videoCompressService.ts',
    processFn: 'processVideoCompress',
    uploadStreamRequirement: 'requiredStreams={{ video: true }}',
    pageMarkers: ['downloadAutoCutUrl', 'openAutoCutPreviewUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'assertAutoCutMediaHasVideoStream',
      'addAsset',
      'addMessage',
      'videoUrl',
      'fileSizeStats',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'compressVideo',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-convert',
    page: 'packages/sdkwork-autocut-video-convert/src/pages/VideoConvertPage.tsx',
    service: 'packages/sdkwork-autocut-video-convert/src/service/videoConvertService.ts',
    processFn: 'processVideoConvert',
    uploadStreamRequirement: 'requiredStreams={{ video: true }}',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'assertAutoCutMediaHasVideoStream',
      'addAsset',
      'addMessage',
      'videoUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'convertVideo',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-enhance',
    page: 'packages/sdkwork-autocut-video-enhance/src/pages/VideoEnhancePage.tsx',
    service: 'packages/sdkwork-autocut-video-enhance/src/service/videoEnhanceService.ts',
    processFn: 'processVideoEnhance',
    uploadStreamRequirement: 'requiredStreams={{ video: true }}',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'assertAutoCutMediaHasVideoStream',
      'addAsset',
      'addMessage',
      'videoUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'enhanceVideo',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'subtitle-translate',
    page: 'packages/sdkwork-autocut-subtitle-translate/src/pages/SubtitleTranslatePage.tsx',
    service: 'packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts',
    processFn: 'processSubtitleTranslate',
    uploadStreamRequirement: 'requiredStreams={hardcode ? { audio: true, video: true } : { audio: true }}',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'failAutoCutProcessingTask',
      'assertAutoCutMediaHasAudioStream',
      'assertAutoCutMediaHasVideoStream',
      'addAsset',
      'addMessage',
      'generatedAssetIds',
      'subtitleUrl',
      'transcriptText',
      'transcriptSegments',
      'translationText',
      'translationSegments',
      'createAutoCutOpenAiCompatibleChatCompletion',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'transcribeAutoCutMediaWithConfiguredProvider',
      'importMediaFile',
      'sliceVideo',
      'createSubtitleTranslateVideoRenderClip',
      'createSubtitleTranslateOutputSegments',
      'isSubtitleTranslateHardcodeVideoSource',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
      'createAutoCutTextObjectUrl',
      'createAutoCutSrtSubtitleText',
    ],
  },
  {
    name: 'voice-translate',
    page: 'packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx',
    service: 'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts',
    processFn: 'processVoiceTranslate',
    uploadStreamRequirement: 'requiredStreams={{ audio: true }}',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'failAutoCutProcessingTask',
      'assertAutoCutMediaHasAudioStream',
      'addAsset',
      'addMessage',
      'generatedAssetIds',
      'subtitleUrl',
      'transcriptText',
      'transcriptSegments',
      'translationText',
      'translationSegments',
      'createAutoCutOpenAiCompatibleChatCompletion',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'transcribeAutoCutMediaWithConfiguredProvider',
      'importMediaFile',
      'createAutoCutTextObjectUrl',
      'createAutoCutSrtSubtitleText',
    ],
  },
];

const processingWorkflowTaskIdTypes = {
  slicer: 'slice',
  'extractor-text': 'text',
  'extractor-audio': 'audio',
  'video-gif': 'gif',
  'video-compress': 'compress',
  'video-convert': 'convert',
  'video-enhance': 'enhance',
  'subtitle-translate': 'subtitle',
  'voice-translate': 'voice',
};

const videoDedupTypes = read('packages/sdkwork-autocut-types/src/index.ts');
const videoDedupService = read('packages/sdkwork-autocut-services/src/service/video-dedup.service.ts');
const videoDedupWorkbench = read('packages/sdkwork-autocut-commons/src/components/VideoDedupWorkbench.tsx');
const videoDedupPage = read('packages/sdkwork-autocut-video-dedup/src/pages/VideoDedupPage.tsx');
const videoDedupPackageJson = read('packages/sdkwork-autocut-video-dedup/package.json');
const videoDedupNativeHostClient = read('packages/sdkwork-autocut-services/src/service/native-host-client.service.ts');
const videoDedupNativeCommands = read('packages/sdkwork-autocut-desktop/src-tauri/src/commands.rs');
const videoDedupNativeMediaRuntime = read('packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs');
const smartSliceEvidenceSlicerService = read('packages/sdkwork-autocut-slicer/src/service/slicerService.ts');
const desktopAppSource = read('packages/sdkwork-autocut-desktop/src/App.tsx');
const toolsRegistrySource = read('packages/sdkwork-autocut-services/src/service/tools.registry.ts');
const slicerPageForDedup = read('packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx');
assertIncludes(videoDedupTypes, 'VideoDedupStrategyId', 'Types define video dedup strategies as a first-class contract');
assertIncludes(videoDedupTypes, "'visual-fingerprint'", 'Video dedup types include visual fingerprint strategy');
assertIncludes(videoDedupTypes, "'audio-fingerprint'", 'Video dedup types include audio fingerprint strategy');
assertIncludes(videoDedupTypes, "'transcript-semantic'", 'Video dedup types include transcript semantic strategy');
assertIncludes(videoDedupTypes, 'VideoDedupReport', 'Types define the video dedup report contract');
assertIncludes(videoDedupTypes, 'videoDedup: \'video-dedup\'', 'Task type includes video dedup as a first-class processing workflow');
assertIncludes(videoDedupService, 'export const AUTOCUT_VIDEO_DEDUP_STRATEGIES', 'Video dedup service exports canonical strategy definitions');
assertIncludes(videoDedupService, 'export async function analyzeAutoCutVideoDedup', 'Video dedup service exposes reusable analysis API');
assertIncludes(videoDedupService, 'exact-file-hash', 'Video dedup service supports exact file hashing');
assertIncludes(videoDedupService, 'visual-fingerprint', 'Video dedup service supports visual fingerprint evidence');
assertIncludes(videoDedupService, 'audio-fingerprint', 'Video dedup service supports audio fingerprint evidence');
assertIncludes(videoDedupService, 'transcript-semantic', 'Video dedup service supports transcript semantic evidence');
assertIncludes(videoDedupService, 'template-reuse', 'Video dedup service treats template reuse separately from full duplicate removal');
assertIncludes(videoDedupService, 'native-sha256', 'Video dedup service uses native SHA-256 fingerprints for exact-file matching when local artifacts are available');
assertIncludes(videoDedupService, 'fingerprintVideoFile', 'Video dedup service calls the typed native fingerprint client instead of relying only on metadata proxies');
assertIncludes(videoDedupService, 'probeVideoFileIdentity', 'Video dedup service validates cached native fingerprints with lightweight file identity probes');
assertIncludes(videoDedupService, 'extractVisualEvidence', 'Video dedup service calls the typed native visual evidence client for visual-fingerprint matching');
assertIncludes(videoDedupService, 'fingerprintAudio', 'Video dedup service calls the typed native audio fingerprint client for audio-fingerprint matching');
assertIncludes(videoDedupService, 'native-visual-evidence', 'Video dedup service records native visual evidence as the primary visual fingerprint source');
assertIncludes(videoDedupService, 'native-audio-fingerprint', 'Video dedup service records native audio fingerprint evidence as the primary audio source');
assertIncludes(videoDedupService, 'sourcePath ? { sourcePath }', 'Video dedup service passes local asset artifact paths to native visual evidence extraction');
assertIncludes(videoDedupService, 'includeFrameFingerprint: true', 'Video dedup service requests native perceptual frame fingerprints for visual-fingerprint picture-content evidence');
assertIncludes(videoDedupService, 'calculateNativeVideoDedupFrameFingerprintSimilarity', 'Video dedup service scores visual near-duplicates from perceptual frame fingerprints before scene structure evidence');
assertIncludes(videoDedupService, 'calculateNativeVideoDedupVisualSimilarity', 'Video dedup service scores visual near-duplicates from native scene structure evidence');
assertIncludes(videoDedupService, 'contentEvidenceReady', 'Video dedup service requires native perceptual frame content evidence before high-confidence visual-fingerprint auto matching');
assertIncludes(videoDedupService, 'calculateNativeVideoDedupAudioSimilarity', 'Video dedup service scores audio duplicates from native energy fingerprint evidence');
assertIncludes(videoDedupService, '!hasNativeAudioPair', 'Video dedup service disables metadata-token audio fallback when native audio fingerprints are available');
assertIncludes(videoDedupService, 'videoDedupFingerprints', 'Video dedup service persists native fingerprints in a reusable cache to avoid rehashing unchanged large files');
assertIncludes(videoDedupService, 'VIDEO_DEDUP_FINGERPRINT_CACHE_LIMIT', 'Video dedup service bounds the native fingerprint cache for commercial-scale libraries');
assertIncludes(videoDedupService, 'videoDedupVisualEvidence', 'Video dedup service persists native visual evidence in a reusable cache to avoid repeating expensive frame analysis');
assertIncludes(videoDedupService, 'VIDEO_DEDUP_VISUAL_EVIDENCE_CACHE_LIMIT', 'Video dedup service bounds the native visual evidence cache for commercial-scale media libraries');
assertIncludes(videoDedupService, 'createVideoDedupVisualEvidenceCacheKey', 'Video dedup service versions visual evidence cache entries by asset, local path, profile, and extraction parameters');
assertIncludes(videoDedupService, 'doesVideoDedupVisualEvidenceCacheIdentityMatch', 'Video dedup service validates cached visual evidence with lightweight native file identity before reuse');
assertIncludes(videoDedupNativeHostClient, 'videoDedupFingerprintCommandReady', 'Native host client exposes video dedup fingerprint readiness');
assertIncludes(videoDedupNativeHostClient, 'videoDedupFileIdentityCommandReady', 'Native host client exposes video dedup file identity readiness');
assertIncludes(videoDedupNativeHostClient, 'audioFingerprintCommandReady', 'Native host client exposes audio fingerprint command readiness');
assertIncludes(videoDedupNativeHostClient, 'audioFingerprintAdapterReady', 'Native host client exposes audio fingerprint adapter readiness');
assertIncludes(videoDedupNativeHostClient, 'fingerprintVideoFile', 'Native host client exposes a typed video fingerprint method');
assertIncludes(videoDedupNativeHostClient, 'probeVideoFileIdentity', 'Native host client exposes a typed video file identity method');
assertIncludes(videoDedupNativeHostClient, 'fingerprintAudio', 'Native host client exposes a typed audio fingerprint method');
assertIncludes(videoDedupNativeHostClient, 'AutoCutAudioFingerprintResult', 'Native host client exposes the structured audio fingerprint result contract');
assertIncludes(videoDedupNativeHostClient, 'extractVisualEvidence', 'Native host client exposes a typed visual evidence method for perceptual video dedup');
assertIncludes(videoDedupNativeHostClient, 'taskEvidenceWriteCommandReady', 'Native host client exposes workflow task evidence JSON write readiness');
assertIncludes(videoDedupNativeHostClient, 'writeTaskEvidenceJson', 'Native host client exposes a typed workflow task evidence JSON writer');
assertIncludes(videoDedupNativeHostClient, 'AutoCutTaskEvidenceWriteResult', 'Native host client exposes the structured task evidence write result contract');
assertIncludes(videoDedupNativeHostClient, 'sourcePath?: string', 'Native host client visual evidence request supports sourcePath for asset-library videos');
assertIncludes(videoDedupNativeCommands, 'autocut_fingerprint_video_file', 'Desktop native command layer exposes the video fingerprint command');
assertIncludes(videoDedupNativeCommands, 'autocut_probe_video_file_identity', 'Desktop native command layer exposes the video identity probe command');
assertIncludes(videoDedupNativeCommands, 'autocut_extract_audio_fingerprint', 'Desktop native command layer exposes the audio fingerprint command for soundtrack and speech-track dedup');
assertIncludes(videoDedupNativeCommands, 'autocut_extract_visual_evidence', 'Desktop native command layer exposes the visual evidence command for perceptual video dedup');
assertIncludes(videoDedupNativeCommands, 'autocut_write_task_evidence_json', 'Desktop native command layer exposes the workflow task evidence JSON write command');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutVideoFileFingerprintResult', 'Rust media runtime defines the video fingerprint result contract');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutVideoFileIdentityResult', 'Rust media runtime defines the video file identity result contract');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutAudioFingerprintResult', 'Rust media runtime defines the audio fingerprint result contract');
assertIncludes(videoDedupNativeMediaRuntime, 'audio-energy-v1', 'Rust media runtime emits stable audio-energy-v1 fingerprints for audio dedup');
assertIncludes(videoDedupNativeMediaRuntime, 'run_ffmpeg_audio_fingerprint_extraction', 'Rust media runtime extracts normalized PCM audio before computing native audio fingerprints');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutVisualEvidenceExtractionResult', 'Rust media runtime defines the visual evidence result contract for perceptual dedup');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutTaskEvidenceWriteRequest', 'Rust media runtime defines the workflow task evidence write request contract');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutTaskEvidenceWriteResult', 'Rust media runtime defines the workflow task evidence write result contract');
assertIncludes(videoDedupNativeMediaRuntime, 'write_autocut_task_evidence_json', 'Rust media runtime writes workflow task evidence JSON under the task output directory');
assertIncludes(videoDedupNativeMediaRuntime, 'remove_file(&artifact_path)', 'Rust media runtime can replace existing workflow task evidence JSON during retry and resume');
assertIncludes(videoDedupNativeMediaRuntime, 'remove_file(&temporary_path)', 'Rust media runtime clears stale task evidence temp files before rewriting evidence JSON');
assertIncludes(videoDedupNativeMediaRuntime, 'AutoCutVisualEvidenceFrameFingerprintSample', 'Rust media runtime defines native perceptual frame fingerprint samples for visual dedup');
assertIncludes(videoDedupNativeMediaRuntime, 'ahash-8x8-luma-v1', 'Rust media runtime emits stable 8x8 luma aHash frame fingerprints for visual dedup');
assertIncludes(videoDedupNativeMediaRuntime, 'run_tracked_visual_evidence_ffmpeg_command', 'Rust media runtime runs visual evidence FFmpeg analysis through the tracked native process boundary');
assertIncludes(videoDedupNativeMediaRuntime, 'source_path: Option<String>', 'Rust media runtime visual evidence request supports sourcePath for asset-library videos');
assertIncludes(videoDedupNativeMediaRuntime, 'resolve_visual_evidence_input_asset', 'Rust media runtime resolves visual evidence input from either sourcePath or registered assetUuid');
assertIncludes(videoDedupWorkbench, 'VideoDedupWorkbench', 'Commons exports a reusable video dedup workbench component');
assertIncludes(videoDedupWorkbench, 'AUTOCUT_VIDEO_DEDUP_STRATEGIES', 'Video dedup workbench renders canonical strategy choices');
assertIncludes(videoDedupWorkbench, 'onParamsChange', 'Video dedup workbench can be embedded by other workflows as a controlled component');
assertIncludes(videoDedupWorkbench, 'analysisDisabledReason', 'Video dedup workbench supports configuration-only embedding when the caller owns runtime source evidence');
assertIncludes(videoDedupWorkbench, 'const sourceAssetSelectionLocked = Array.isArray(sourceAssetIds)', 'Video dedup workbench treats explicit empty sourceAssetIds as a locked runtime-source configuration instead of scanning every library asset');
assertIncludes(videoDedupWorkbench, 'Duplicate groups', 'Video dedup workbench presents duplicate groups for human review');
assertIncludes(videoDedupPage, '<VideoDedupWorkbench', 'Video dedup tool page uses the shared workbench instead of duplicating UI');
assertIncludes(videoDedupPackageJson, '"name": "@sdkwork/autocut-video-dedup"', 'Video dedup package is a first-class workspace package');
assertIncludes(toolsRegistrySource, "id: 'video-dedup'", 'Tool registry exposes the video dedup AI tool');
assertIncludes(toolsRegistrySource, "route: '/video-dedup'", 'Tool registry routes the video dedup tool');
assertIncludes(desktopAppSource, "path: '/video-dedup'", 'Desktop app mounts the video dedup route');
assertIncludes(desktopAppSource, "import('@sdkwork/autocut-video-dedup')", 'Desktop app lazy-loads the video dedup package');
assertIncludes(slicerPageForDedup, 'VideoDedupWorkbench', 'Smart Slice embeds the shared video dedup workbench');
assertIncludes(slicerPageForDedup, 'enableSmartDedup', 'Smart Slice exposes an intelligent dedup option');
assertIncludes(slicerPageForDedup, 'videoDedupParams', 'Smart Slice stores video dedup parameters in its workflow state');
assertIncludes(slicerPageForDedup, 'sourceAssetIds={fileId ? [fileId] : []}', 'Smart Slice locks the dedup workbench source scope so local runtime imports do not accidentally scan the asset library');
assertIncludes(slicerPageForDedup, 'analysisDisabledReason={fileId ? undefined :', 'Smart Slice disables standalone dedup analysis in the embedded workbench until runtime source evidence is available during Smart Slice analysis');
assertIncludes(slicerPageForDedup, "t('slicer.settings.review.dedup.title')", 'Smart Slice review workbench surfaces localized service-side video dedup findings');
assertIncludes(slicerPageForDedup, 'isSliceReviewDuplicateRiskSegment', 'Smart Slice duplicate filter includes service-side smart dedup review risks');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/speech-to-text.json'", 'Smart Slice persists canonical speech-to-text evidence JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/semantic-segmentation.json'", 'Smart Slice persists canonical semantic segmentation evidence JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/review-session.json'", 'Smart Slice persists canonical human review session evidence JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/manual-edits.json'", 'Smart Slice persists canonical manual edit evidence JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/review-events.json'", 'Smart Slice persists canonical replayable review event evidence JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/render-selection.json'", 'Smart Slice persists canonical render selection evidence JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, "relativePath: 'evidence/render-artifact-manifest.json'", 'Smart Slice persists canonical render artifact manifest JSON in the workflow task output directory');
assertIncludes(smartSliceEvidenceSlicerService, 'export async function saveVideoSliceReviewDraft', 'Smart Slice exposes a service API for saving human review drafts before rendering');
assertIncludes(smartSliceEvidenceSlicerService, 'speechToTextEvidence', 'Smart Slice checkpoint records the speech-to-text evidence artifact reference');
assertIncludes(smartSliceEvidenceSlicerService, 'semanticSegmentationEvidence', 'Smart Slice checkpoint records the semantic segmentation evidence artifact reference');
assertIncludes(smartSliceEvidenceSlicerService, 'reviewSessionEvidence', 'Smart Slice checkpoint records the review-session evidence artifact reference');
assertIncludes(smartSliceEvidenceSlicerService, 'manualEditsEvidence', 'Smart Slice checkpoint records the manual-edits evidence artifact reference');
assertIncludes(smartSliceEvidenceSlicerService, 'reviewEventsEvidence', 'Smart Slice checkpoint records the review-events evidence artifact reference');
assertIncludes(smartSliceEvidenceSlicerService, 'renderSelectionEvidence', 'Smart Slice checkpoint records the render-selection evidence artifact reference');
assertIncludes(smartSliceEvidenceSlicerService, 'renderArtifactManifestEvidence', 'Smart Slice checkpoint records the render artifact manifest evidence reference');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.speech-to-text.v1\'', 'Smart Slice speech-to-text task evidence uses a versioned schema');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.semantic-segmentation.v1\'', 'Smart Slice semantic segmentation task evidence uses a versioned schema');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.review-session.v1\'', 'Smart Slice review-session task evidence uses a versioned schema');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.manual-edits.v1\'', 'Smart Slice manual-edits task evidence uses a versioned schema');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.review-events.v1\'', 'Smart Slice review-events task evidence uses a versioned schema');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.render-selection.v1\'', 'Smart Slice render-selection task evidence uses a versioned schema');
assertIncludes(smartSliceEvidenceSlicerService, 'schema: \'smart-slice.render-artifact-manifest.v1\'', 'Smart Slice render artifact manifest task evidence uses a versioned schema');

for (const workflow of processingWorkflows) {
  const pageSource = read(workflow.page);
  const serviceSource = read(workflow.service);
  assertIncludes(serviceSource, `export async function ${workflow.processFn}`, `${workflow.name} exports its processing workflow function`);
  assertIncludes(pageSource, `${workflow.processFn}(`, `${workflow.name} page invokes its processing workflow function`);
  assertIncludes(serviceSource, 'AUTOCUT_TASK_STATUS.pending', `${workflow.name} service creates a pending task`);
  assertIncludes(
    serviceSource,
    `createAutoCutTaskId('${processingWorkflowTaskIdTypes[workflow.name]}')`,
    `${workflow.name} service creates task IDs with the UUIDv7 task id factory`,
  );
  assertNotIncludes(
    serviceSource,
    "createAutoCutId('newTask')",
    `${workflow.name} service does not use timestamp-sequence task IDs`,
  );
  if (workflow.returnsSuccess !== false) {
    assertRule(
      serviceSource.includes('return { success: true, taskId: newTask.id }') ||
        serviceSource.includes('return { success: true, taskId: newTask.id, ...(nativeTaskId ? { nativeTaskId } : {}) }') ||
        serviceSource.includes('return { success: true, taskId: durableTaskId }'),
      `${workflow.name} service returns a task id result contract`,
    );
    assertIncludes(
      serviceSource,
      'failAutoCutProcessingTask(',
      `${workflow.name} service rejects native command failures instead of returning success`,
    );
    if (workflow.name === 'slicer') {
      assertIncludes(
        serviceSource,
        'createVideoSliceFailureDiagnostics(error)',
        'slicer service persists full smart-slice failure diagnostics with stack traces',
      );
    }
  }
  assertIncludes(
    serviceSource,
    'validateAutoCutProcessingSource',
    `${workflow.name} service validates source media before creating a task`,
  );
  if (workflow.name === 'slicer') {
    assertIncludes(
      serviceSource,
      'allowExternalUrl: true',
      'slicer service explicitly allows http and https external source URLs',
    );
  }
  for (const marker of workflow.pageMarkers) {
    assertIncludes(pageSource, marker, `${workflow.name} page contains workflow marker ${marker}`);
  }
  if (workflow.uploadStreamRequirement) {
    assertIncludes(
      pageSource,
      workflow.uploadStreamRequirement,
      `${workflow.name} page declares the trusted upload stream evidence required by its processing contract`,
    );
  }
  for (const marker of workflow.serviceMarkers) {
    assertIncludes(serviceSource, marker, `${workflow.name} service contains workflow marker ${marker}`);
  }
  if (workflow.planningKernel) {
    const planningSource = read(workflow.planningKernel);
    for (const marker of workflow.planningMarkers) {
      assertIncludes(planningSource, marker, `${workflow.name} planning kernel contains workflow marker ${marker}`);
    }
  }
  assertIncludes(pageSource, 'TaskFailureState', `${workflow.name} page renders a standard failed task state`);
  assertRule(
    !/className="[^"]*\bhidden\b[^"]*"[\s\S]{0,160}<TaskFailureState/u.test(pageSource),
    `${workflow.name} page does not hide TaskFailureState to satisfy workflow contracts`,
  );
  assertIncludes(pageSource, 'AUTOCUT_TASK_STATUS.failed', `${workflow.name} page handles failed task status`);
  assertRule(
    pageSource.includes('activeTask.errorMessage') || pageSource.includes('task.errorMessage'),
    `${workflow.name} page displays the task error message`,
  );
  assertIncludes(
    pageSource,
    'getAutoCutProcessingTaskErrorTaskId',
    `${workflow.name} page can surface persisted failed tasks created by fail-closed processing`,
  );
  if (workflow.name !== 'slicer') {
    assertIncludes(
      pageSource,
      'const isProcessing = Boolean(activeTaskId) && (!activeTask || isAutoCutTaskActiveStatus(activeTask.status));',
      `${workflow.name} page treats submitted-but-not-loaded tasks as processing`,
    );
    assertIncludes(
      pageSource,
      'activeTaskId && (',
      `${workflow.name} page renders the task workflow area immediately after task submission`,
    );
    assertRule(
      !pageSource.includes('isProcessing && activeTask &&'),
      `${workflow.name} page does not suppress the processing view before task details load`,
    );
    assertIncludes(
      pageSource,
      'activeTask?.progress || 0',
      `${workflow.name} page can render progress safely before task details load`,
    );
  }
}

const taskFailureState = read('packages/sdkwork-autocut-commons/src/components/TaskFailureState.tsx');
const taskDetailTextNormalizationPath = 'packages/sdkwork-autocut-commons/src/components/taskDetailText.ts';
const taskDetailTextNormalization = exists(taskDetailTextNormalizationPath)
  ? read(taskDetailTextNormalizationPath)
  : '';
assertRule(
  exists(taskDetailTextNormalizationPath),
  'AutoCut commons owns a shared task detail text normalization utility',
);
assertIncludes(
  taskDetailTextNormalization,
  'normalizeAutoCutTaskDetailDisplayText',
  'shared task detail text normalization decodes escaped diagnostics before rendering',
);
assertIncludes(
  taskDetailTextNormalization,
  'tryRepairUtf8MojibakeAutoCutTaskDetailText',
  'shared task detail text normalization repairs UTF-8 mojibake diagnostics when possible',
);
assertIncludes(
  taskDetailTextNormalization,
  "new TextDecoder('utf-8', { fatal: true })",
  'shared task detail text normalization rejects invalid mojibake repairs instead of corrupting valid text',
);
assertIncludes(taskFailureState, "variant?: 'full' | 'compact'", 'TaskFailureState exposes full and compact variants');
assertIncludes(taskFailureState, "variant = 'full'", 'TaskFailureState defaults to the full failure view');
assertIncludes(taskFailureState, "variant === 'compact'", 'TaskFailureState renders a compact task-list failure view');
assertIncludes(
  taskFailureState,
  'normalizeAutoCutTaskDetailDisplayText',
  'TaskFailureState normalizes failed-task errors and diagnostics before rendering or copying',
);
assertIncludes(
  taskFailureState,
  'const normalizedFailureDiagnostics',
  'TaskFailureState keeps failed-task diagnostics readable in the details panel',
);
assertIncludes(
  taskFailureState,
  'onCopyErrorMessage: (message: string) => Promise<void> | void',
  'TaskFailureState requires callers to provide the standard failed-task clipboard writer',
);
assertIncludes(
  taskFailureState,
  'return displayErrorMessage;',
  'TaskFailureState copies the exact visible failed-task error message when diagnostics are absent',
);
assertIncludes(
  taskFailureState,
  'failureDiagnostics',
  'TaskFailureState accepts detailed failed-task diagnostics for engineering troubleshooting',
);
assertIncludes(
  taskFailureState,
  'createTaskFailureClipboardMessage',
  'TaskFailureState builds a single clipboard payload containing the visible error and diagnostics',
);
assertIncludes(
  taskFailureState,
  'onCopyErrorMessage(createTaskFailureClipboardMessage(displayErrorMessage, normalizedFailureDiagnostics))',
  'TaskFailureState copies the full failed-task diagnostic payload instead of only the visible summary when diagnostics exist',
);
assertIncludes(
  taskFailureState,
  'event.stopPropagation()',
  'TaskFailureState copy action does not trigger parent task-card navigation',
);
assertIncludes(taskFailureState, 'copyErrorMessage', 'TaskFailureState renders a clear labels-driven failed-task copy action');
assertIncludes(
  taskFailureState,
  'flex-1 min-h-0 w-full overflow-y-auto',
  'TaskFailureState full view remains scrollable so long diagnostics and copy actions stay reachable',
);
assertIncludes(
  taskFailureState,
  'custom-scrollbar',
  'TaskFailureState uses the standard scroll surface for long failed-task diagnostics',
);

const taskFailureStateConsumerPaths = [
  'packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx',
  'packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx',
  'packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx',
  'packages/sdkwork-autocut-subtitle-translate/src/pages/SubtitleTranslatePage.tsx',
  'packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx',
  'packages/sdkwork-autocut-video-compress/src/pages/VideoCompressPage.tsx',
  'packages/sdkwork-autocut-video-convert/src/pages/VideoConvertPage.tsx',
  'packages/sdkwork-autocut-video-enhance/src/pages/VideoEnhancePage.tsx',
  'packages/sdkwork-autocut-video-gif/src/pages/VideoGifPage.tsx',
  'packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx',
];
for (const relativePath of taskFailureStateConsumerPaths) {
  const source = read(relativePath);
  assertIncludes(source, 'writeAutoCutClipboardText', `${relativePath} imports the standard clipboard helper for failed tasks`);
  assertMatches(
    source,
    /<TaskFailureState\b[\s\S]*?onCopyErrorMessage=\{writeAutoCutClipboardText\}/u,
    `${relativePath} wires failed-task copy actions to the standard clipboard helper`,
  );
}

const downloadService = read('packages/sdkwork-autocut-services/src/service/download.service.ts');
const tasksPage = read('packages/sdkwork-autocut-tasks/src/pages/TasksPage.tsx');
assertIncludes(
  downloadService,
  'export async function createAutoCutTaskPackageArchive',
  'download service exports the standard task package archive builder',
);
assertIncludes(
  downloadService,
  'export async function downloadAutoCutTaskPackage',
  'download service exports the task package browser download action',
);
assertIncludes(
  downloadService,
  'export function hasAutoCutTaskPackageDownloadables',
  'download service exports the task package availability predicate for UI state',
);
assertIncludes(
  downloadService,
  'task.translationSegments?.length',
  'download service treats structured target-language translation segments as packageable task outputs',
);
assertIncludes(
  downloadService,
  'task.translationText?.trim()',
  'download service treats target-language translation text as packageable task output',
);
assertIncludes(
  downloadService,
  'if (task.translationSegments?.length)',
  'download service exports structured translation segments before falling back to source transcripts',
);
assertIncludes(
  downloadService,
  'if (task.translationText?.trim())',
  'download service exports target-language translation text before falling back to source transcripts',
);
assertIncludes(
  downloadService,
  'TASK_PACKAGE_SCHEMA_VERSION',
  'download service versions the task package manifest schema',
);
assertIncludes(
  downloadService,
  'skippedFiles.push',
  'download service records skipped package artifacts instead of aborting a whole batch',
);
assertIncludes(
  downloadService,
  'createStoredZipArchive',
  'download service creates a real ZIP archive for task package downloads',
);
assertIncludes(
  tasksPage,
  'downloadAutoCutTaskPackage',
  'task list imports the standard task package download action',
);
assertIncludes(
  tasksPage,
  'hasAutoCutTaskPackageDownloadables',
  'task list uses the standard package availability predicate',
);
assertIncludes(
  tasksPage,
  'handleBulkDownloadTaskPackage',
  'task list exposes a bulk package download action for selected tasks',
);
assertIncludes(
  tasksPage,
  'handleDownloadTaskPackage(task',
  'task list exposes a per-task package download action',
);
assertIncludes(
  tasksPage,
  "t('tasks.packageDownload.download'",
  'task list package download label participates in i18n language switching',
);
assertIncludes(
  tasksPage,
  'event.stopPropagation()',
  'task list package download actions do not trigger row navigation',
);
assertIncludes(
  read('scripts/check-autocut-service-behavior.mjs'),
  'readStoredZipEntries',
  'service behavior tests parse generated task package ZIP files instead of only checking function presence',
);

const slicerPage = read('packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx');
const clipWorkflow = read('packages/sdkwork-autocut-slicer/src/service/clipWorkflow.ts');
assertIncludes(slicerPage, 'saveVideoSliceReviewDraft', 'Slicer UI persists human review corrections as task-scoped evidence while the operator edits');
assertIncludes(slicerPage, 'reviewDraftSavedAt', 'Slicer UI shows whether the current human review draft has been persisted');
assertIncludes(
  slicerPage,
  '<TaskFailureState',
  'Slicer renders a visible compact task failure state',
);
assertMatches(
  slicerPage,
  /<TaskFailureState\b[\s\S]*?variant="compact"[\s\S]*?errorMessage=\{task\.errorMessage\}/u,
  'Slicer passes failed task messages into the compact task failure state',
);
assertIncludes(slicerPage, 'useSearchParams', 'Slicer reads router search params for external video links');
assertIncludes(slicerPage, "searchParams.get('url')", 'Slicer reads the external source URL query parameter');
assertIncludes(slicerPage, 'useState(initialSourceUrl)', 'Slicer stores the external source URL from navigation state');
assertIncludes(slicerPage, 'sliceParams.url = sourceUrl', 'Slicer passes the external source URL into the slicing workflow');
assertIncludes(slicerPage, "const SMART_SLICE_DEFAULT_TARGET_PLATFORM: SliceTargetPlatform = 'generic'", 'Slicer submits a stable generic target platform without exposing publishing strategy choices');
assertIncludes(slicerPage, 'targetPlatform: SMART_SLICE_DEFAULT_TARGET_PLATFORM', 'Slicer persists generic Smart Slice target platform defaults behind the simplified settings panel');
assertIncludes(slicerPage, 'SMART_CUT_ENGINE_PRODUCT_PROFILES', 'Slicer UI encapsulates scene-to-engine product profiles instead of scattering mode copy');
assertIncludes(slicerPage, 'createSmartCutEngineProductExperience', 'Slicer UI derives one product experience model from the selected mode and simplified settings');
assertIncludes(slicerPage, 'formatSmartCutEngineModeLabel', 'Slicer UI renders readable Smart Cut scene labels while submitting stable strategy ids');
assertNotIncludes(slicerPage, 'Publishing Strategy', 'Slicer settings panel removes the publishing strategy section from the default workflow');
assertNotIncludes(slicerPage, 'Target Platform', 'Slicer settings panel removes the target-platform selector from the default workflow');
assertNotIncludes(slicerPage, 'Commercial Readiness', 'Slicer settings panel no longer blocks slicing behind commercial-release readiness copy');
assertNotIncludes(slicerPage, 'Output Package', 'Slicer settings panel no longer exposes release-package language in the main workflow');
assertNotIncludes(slicerPage, 'Operator Brief', 'Slicer settings panel removes commercial operator brief copy from the simplified workflow');
assertIncludes(slicerPage, "t('slicer.settings.title')", 'Slicer settings panel title is localized');
assertIncludes(slicerPage, "t('slicer.settings.basic.title')", 'Slicer settings panel basic section title is localized');
assertIncludes(slicerPage, "t('slicer.settings.advanced.title')", 'Slicer advanced settings disclosure title is localized');
assertIncludes(slicerPage, "showAdvancedSettings", 'Slicer hides expert Smart Slice controls behind a disclosure by default');
assertIncludes(slicerPage, 'w-[430px] xl:w-[460px]', 'Slicer right properties panel is wide enough for scan-friendly Smart Slice controls');
assertIncludes(slicerPage, 'const smartSliceSpeechReady =', 'Slicer derives speech readiness once before rendering the simplified settings panel');
assertIncludes(slicerPage, 'const smartSliceReadyForRun = hasVideoSource && strategyExecutionSupport.ready', 'Slicer derives the main run readiness once before rendering controls');
assertIncludes(slicerPage, 'const smartSliceSettingsReadinessItems = [', 'Slicer models the right-panel readiness rows as a named view model');
assertIncludes(slicerPage, 'smartSliceSettingsReadinessItems.map', 'Slicer renders readiness rows from the named view model instead of inline JSX data');
assertIncludes(slicerPage, 'const smartSliceDurationControls = [', 'Slicer models the duration inputs as a named view model');
assertIncludes(slicerPage, 'smartSliceDurationControls.map', 'Slicer renders duration controls from the named view model instead of inline JSX data');
assertIncludes(slicerPage, 'const smartSliceAspectRatioOptions = [', 'Slicer models aspect-ratio choices as a named view model');
assertIncludes(slicerPage, 'smartSliceAspectRatioOptions.map', 'Slicer renders aspect-ratio choices from the named view model instead of inline JSX options');
assertIncludes(slicerPage, 'const smartSliceObjectFitOptions = [', 'Slicer models frame-fit choices as a named view model');
assertIncludes(slicerPage, 'smartSliceObjectFitOptions.map', 'Slicer renders frame-fit choices from the named view model instead of inline JSX options');
assertIncludes(slicerPage, 'const smartSliceAudioCleanupControls = [', 'Slicer models speech cleanup toggles as a named view model');
assertIncludes(slicerPage, 'smartSliceAudioCleanupControls.map', 'Slicer renders speech cleanup toggles from the named view model instead of inline JSX data');
assertNotIncludes(slicerPage, 'setNoiseReduction(!noiseReduction)', 'Slicer noise-reduction toggle uses a functional state update');
assertNotIncludes(slicerPage, 'setCoughFilter(!coughFilter)', 'Slicer silence-cleanup toggle uses a functional state update');
assertNotIncludes(slicerPage, 'setRepeatFilter(!repeatFilter)', 'Slicer repeat-filter toggle uses a functional state update');
assertNotIncludes(slicerPage, 'setEnableSmartDedup(!enableSmartDedup)', 'Slicer smart-dedup toggle uses a functional state update');
assertIncludes(slicerPage, 'const smartSliceContinuityOptions = [', 'Slicer models continuity choices as a named view model');
assertIncludes(slicerPage, 'smartSliceContinuityOptions.map', 'Slicer renders continuity choices from the named view model instead of inline JSX options');
assertIncludes(slicerPage, 'const smartSliceSegmentationOptions = [', 'Slicer models segmentation choices as a named view model');
assertIncludes(slicerPage, 'smartSliceSegmentationOptions.map', 'Slicer renders segmentation choices from the named view model instead of inline JSX options');
assertIncludes(slicerPage, 'const smartSliceSceneOptions = MODES.map', 'Slicer models advanced scene cards as a named view model');
assertIncludes(slicerPage, 'smartSliceSceneOptions.map', 'Slicer renders advanced scene cards from the named view model instead of inline MODES mapping');
assertIncludes(slicerPage, 'function createSmartSliceAdvancedI18nKey', 'Slicer centralizes dynamic advanced-settings translation keys instead of scattering raw registry copy');
assertIncludes(slicerPage, "'sceneOptions'", 'Slicer derives advanced scene card copy from localized scene option keys');
assertIncludes(slicerPage, "'sttPresets'", 'Slicer derives STT workflow preset copy from localized preset option keys');
assertIncludes(slicerPage, "'segmentationAgents'", 'Slicer derives segmentation-agent copy from localized agent option keys');
assertNotIncludes(slicerPage, 'label: formatSmartCutEngineModeLabel(mode)', 'Slicer advanced scene option labels do not leak English product registry titles into localized UI');
assertNotIncludes(slicerPage, 'detail: profile.primarySlicer', 'Slicer advanced scene option details do not leak engine strategy ids as translated UI copy');
assertNotIncludes(slicerPage, 'title: profile.strategy', 'Slicer advanced scene option titles do not leak English product strategy copy into localized UI');
assertNotIncludes(slicerPage, 'uiLabel: gpuPresetWithoutRuntime', 'Slicer advanced STT option labels are localized through a single formatter instead of nested English suffixes');
assertNotIncludes(slicerPage, '`${preset.label} (requires GPU runtime)`', 'Slicer advanced STT GPU-disabled suffix is localized');
assertNotIncludes(slicerPage, '`${preset.label} (configure API key)`', 'Slicer advanced STT API-disabled suffix is localized');
assertNotIncludes(slicerPage, '`${preset.label} (recommended)`', 'Slicer advanced STT recommended suffix is localized');
assertNotIncludes(slicerPage, '{agent.label}</option>', 'Slicer advanced segmentation-agent selector renders localized agent labels');
assertNotIncludes(slicerPage, 'description: selectedSegmentationAgent.description', 'Slicer advanced segmentation-agent description is not raw English registry copy');
assertIncludes(slicerPage, 'const smartSliceRunModeOptions = [', 'Slicer models run-mode choices as a named view model');
assertIncludes(slicerPage, 'smartSliceRunModeOptions.map', 'Slicer renders run-mode choices from the named view model instead of inline JSX data');
assertIncludes(slicerPage, 'satisfies Array<{ id: SmartSliceRunMode; label: string; detail: string }>', 'Slicer type-checks run-mode choices at the named view model boundary');
assertIncludes(slicerPage, 'const smartSliceSubtitleModeOptions = [', 'Slicer models subtitle output choices as a named view model');
assertIncludes(slicerPage, 'smartSliceSubtitleModeOptions.map', 'Slicer renders subtitle output choices from the named view model instead of inline JSX data');
assertIncludes(slicerPage, 'satisfies Array<{ value: SliceSubtitleMode; label: string }>', 'Slicer type-checks subtitle output choices at the named view model boundary');
assertNotIncludes(slicerPage, 'option.value as SliceSubtitleMode', 'Slicer subtitle output buttons do not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'event.target.value as SliceTargetAspectRatio', 'Slicer aspect-ratio select does not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'event.target.value as SliceVideoObjectFit', 'Slicer object-fit select does not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'event.target.value as SliceContinuityLevel', 'Slicer continuity select does not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'event.target.value as SliceSegmentationDensity', 'Slicer segmentation select does not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'event.target.value as SliceLLM', 'Slicer LLM model select does not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'event.target.value as AutoCutSmartSliceSegmentationAgentId', 'Slicer segmentation-agent select does not rely on JSX-level type assertions');
assertNotIncludes(slicerPage, 'selectedModel.id as SliceLLM', 'Slicer LLM model select does not rely on selected-option type assertions');
assertNotIncludes(slicerPage, 'config.model as SliceLLM', 'Slicer does not force runtime LLM config strings into SliceLLM without provider-aware normalization');
assertNotIncludes(slicerPage, 'defaultModel as SliceLLM', 'Slicer does not force provider default model strings into SliceLLM without provider-aware normalization');
assertIncludes(slicerPage, 'function isSliceLlmModelId(value: string): value is SliceLLM', 'Slicer centralizes SliceLLM string validation before updating model state');
assertIncludes(slicerPage, 'function resolveSmartSliceLlmModelForVendor', 'Slicer normalizes runtime LLM models through provider-aware model resolution');
assertIncludes(slicerPage, "if (vendor === 'custom')", 'Slicer keeps custom-provider LLM model strings valid instead of rejecting them through the official model registry');
assertIncludes(slicerPage, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS.find((model) => model.vendor === vendor && model.id === value)', 'Slicer resolves non-custom provider LLM models through the canonical provider model registry');
assertIncludes(slicerPage, 'const selectedModel = visibleLlmModelOptions.find((model) => model.id === event.target.value)', 'Slicer resolves LLM model selections through the visible model option registry');
assertIncludes(slicerPage, 'const selectedAgent = AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.find((agent) => agent.id === event.target.value)', 'Slicer resolves segmentation-agent selections through the canonical agent registry');
assertIncludes(slicerPage, 'setSttPresetId(nextPreset.id)', 'Slicer resolves STT workflow selections through the available preset registry before updating state');
assertIncludes(slicerPage, 'const smartSliceReviewFilterOptions = [', 'Slicer models review queue filters as a named view model');
assertIncludes(slicerPage, 'smartSliceReviewFilterOptions.map', 'Slicer renders review queue filters from the named view model instead of inline JSX data');
assertIncludes(slicerPage, 'const smartSliceReviewStatusBadge =', 'Slicer derives the review workbench status badge before rendering JSX');
assertIncludes(slicerPage, 'const smartSliceReviewMetricItems = [', 'Slicer models review workbench metric cards as a named view model');
assertIncludes(slicerPage, 'smartSliceReviewMetricItems.map', 'Slicer renders review workbench metric cards from the named view model instead of repeated JSX cards');
assertIncludes(slicerPage, 'const publishableReviewSegmentCount =', 'Slicer derives the number of publishable review segments before rendering queue bulk actions');
assertIncludes(slicerPage, 'const renderableReviewSegmentIds = reviewSegments', 'Slicer derives render submission ids from the current review segment statuses instead of stale UI selection state');
assertIncludes(slicerPage, 'segment.selected && segment.status === \'selected\'', 'Slicer only treats currently selected non-duplicate review segments as renderable');
assertIncludes(slicerPage, 'const renderableReviewSegmentCount = renderableReviewSegmentIds.length', 'Slicer derives render button state from normalized renderable segment ids');
assertIncludes(slicerPage, 'const selectedReviewSegmentIds = renderableReviewSegmentIds', 'Slicer derives review selection display state from current renderable review segments');
assertNotIncludes(slicerPage, 'setSelectedReviewSegmentIds', 'Slicer does not maintain a second independent review selection state');
assertNotIncludes(slicerPage, 'selectedReviewSegmentIds.includes(segment.id)', 'Slicer does not render review selection from a stale selected-id state array');
assertIncludes(slicerPage, 'const canSelectAllReviewSegments = publishableReviewSegmentCount > 0', 'Slicer derives select-all availability before rendering queue bulk actions');
assertIncludes(slicerPage, 'const canClearReviewSegmentSelection = selectedReviewSegmentCount > 0', 'Slicer derives clear-selection availability before rendering queue bulk actions');
assertIncludes(slicerPage, "disabled={segment.status === 'duplicate'}", 'Slicer blocks direct checkbox re-selection of duplicate review segments');
assertIncludes(slicerPage, "handleRestoreReviewSegment(segment.id)", 'Slicer keeps duplicate review restoration behind the explicit restore action');
assertIncludes(slicerPage, 'disabled={segment.status === \'duplicate\'}', 'Slicer disables duplicate review segment checkboxes instead of letting them bypass the restore action');
assertIncludes(slicerPage, 'disabled={!canSelectAllReviewSegments}', 'Slicer disables the select-all review action when no publishable segment exists');
assertIncludes(slicerPage, 'disabled={!canClearReviewSegmentSelection}', 'Slicer disables the clear-selection review action when no segment is selected');
assertIncludes(slicerPage, 'selectedSegmentIds: renderableReviewSegmentIds', 'Slicer submits normalized renderable review segment ids to the render service');
assertNotIncludes(slicerPage, 'selectedSegmentIds: selectedReviewSegmentIds', 'Slicer does not submit stale UI-selected review segment ids to render service');
assertNotIncludes(slicerPage, 'selectedReviewSegmentIds.length === 0', 'Slicer does not gate render availability on stale UI-selected review segment ids');
assertIncludes(slicerPage, 'const smartSliceReviewPreviewMetaItems =', 'Slicer models the active review segment preview metadata before rendering JSX');
assertIncludes(slicerPage, 'smartSliceReviewPreviewMetaItems.map', 'Slicer renders active review segment preview metadata as compact chips instead of one dense string');
assertNotIncludes(slicerPage, "`${formatTime(activeReviewSegment.startMs / 1_000)} - ${formatTime(activeReviewSegment.endMs / 1_000)} |", 'Slicer avoids a dense pipe-delimited preview metadata string in the right settings panel');
assertIncludes(slicerPage, 'const reviewSegmentActionItems = [', 'Slicer models each review segment card action row before rendering JSX');
assertIncludes(slicerPage, 'reviewSegmentActionItems.map', 'Slicer renders each review segment card action row from a named model instead of repeated buttons');
assertIncludes(slicerPage, "const [expandedReviewSegmentActionId, setExpandedReviewSegmentActionId] = useState<string>('')", 'Slicer keeps dense per-segment review actions collapsed by default in the right settings panel');
assertIncludes(slicerPage, 'const handleToggleReviewSegmentActions = (segmentId: string) =>', 'Slicer centralizes review segment action disclosure toggling');
assertIncludes(slicerPage, 'const reviewSegmentActionsExpanded = expandedReviewSegmentActionId === segment.id', 'Slicer derives each review segment action disclosure state before rendering JSX');
assertIncludes(slicerPage, 'aria-expanded={reviewSegmentActionsExpanded}', 'Slicer exposes each review segment action disclosure state accessibly');
assertIncludes(slicerPage, "t('slicer.settings.review.action.showSegmentActions')", 'Slicer uses localized copy for the compact review segment actions toggle');
assertIncludes(slicerPage, 'reviewSegmentActionsExpanded ? (', 'Slicer renders dense review segment edit actions only when the operator opens the card actions');
assertNotIncludes(slicerPage, '<div className="mt-2 grid grid-cols-4 gap-1">', 'Slicer no longer shows four dense review segment edit buttons by default on every card');
assertMatches(
  slicerPage,
  /setShowReviewCorrectionEditor\(false\);[\s\S]*?setExpandedReviewSegmentActionId\(''\);[\s\S]*?if \(!activeReviewSegment\)/u,
  'Slicer collapses open per-segment actions together with the correction editor when the active review segment changes',
);
assertMatches(
  slicerPage,
  /resetSmartSliceReviewWorkbenchForNewPlan[\s\S]*?setActiveReviewSegmentId\(''\);[\s\S]*?setExpandedReviewSegmentActionId\(''\);/u,
  'Slicer clears stale per-segment action disclosure state before creating a new Smart Slice review plan',
);
assertIncludes(slicerPage, 'const reviewSegmentBadgeItems = [', 'Slicer models each review segment card badge row before rendering JSX');
assertIncludes(slicerPage, 'reviewSegmentBadgeItems.map', 'Slicer renders each review segment card badge row from a named model instead of repeated badge branches');
assertIncludes(slicerPage, 'type SmartSliceReviewCorrectionDraft = {', 'Slicer gives review correction drafts an explicit local contract before rendering correction controls');
assertIncludes(slicerPage, 'const updateSmartSliceReviewCorrectionDraftField =', 'Slicer centralizes review correction draft updates instead of repeating object-spread handlers in JSX');
assertIncludes(slicerPage, 'const smartSliceReviewCorrectionFields = [', 'Slicer models review correction controls as a named field list before rendering JSX');
assertIncludes(slicerPage, 'smartSliceReviewCorrectionFields.map', 'Slicer renders review correction controls from the named field list instead of repeated input and textarea blocks');
assertIncludes(slicerPage, 'const [showReviewCorrectionEditor, setShowReviewCorrectionEditor] = useState(false)', 'Slicer keeps the review correction editor collapsed by default to simplify the right settings panel');
assertIncludes(slicerPage, 'aria-expanded={showReviewCorrectionEditor}', 'Slicer exposes the review correction editor expanded state through an accessible toggle');
assertIncludes(slicerPage, "t('slicer.settings.review.action.editCorrection')", 'Slicer shows a compact edit action before opening the correction editor');
assertIncludes(slicerPage, 'showReviewCorrectionEditor ? (', 'Slicer renders review correction controls only after the operator opens the editor');
assertIncludes(slicerPage, 'setShowReviewCorrectionEditor(false)', 'Slicer collapses the correction editor when the active review segment changes');
assertIncludes(slicerPage, 'const smartSlicePrimaryActionLabel =', 'Slicer derives the bottom primary action label once instead of nesting copy logic in JSX');
assertNotIncludes(slicerPage, "t('slicer.settings.badge')", 'Slicer settings panel does not show a redundant simple-mode badge');
assertNotIncludes(slicerPage, "t('slicer.settings.status.description')", 'Slicer settings panel removes explanatory readiness copy from the right sidebar');
assertNotIncludes(slicerPage, "t('slicer.settings.runMode.description')", 'Slicer settings panel removes explanatory run-mode copy from the right sidebar');
assertNotIncludes(slicerPage, "t('slicer.settings.runMode.review.badge')", 'Slicer settings panel avoids redundant run-mode badges');
assertNotIncludes(slicerPage, "t('slicer.settings.runMode.auto.badge')", 'Slicer settings panel avoids redundant run-mode badges');
assertNotIncludes(slicerPage, "t('slicer.settings.basic.description')", 'Slicer settings panel removes explanatory basic-settings copy from the right sidebar');
assertNotIncludes(slicerPage, "t('slicer.settings.basic.subtitlesDescription')", 'Slicer settings panel avoids redundant subtitle helper copy beside a clear toggle');
assertNotIncludes(slicerPage, "t('slicer.settings.review.description')", 'Slicer settings panel removes explanatory review copy from the right sidebar');
assertNotIncludes(slicerPage, "t('slicer.settings.review.empty')", 'Slicer settings panel keeps the empty review state to a compact title');
assertNotIncludes(slicerPage, "t('slicer.settings.advanced.description')", 'Slicer settings panel removes explanatory advanced-settings copy from the disclosure header');
assertNotIncludes(slicerPage, "t('slicer.settings.advanced.dedupDescription')", 'Slicer settings panel avoids redundant dedup helper copy beside a clear toggle');
assertNotIncludes(slicerPage, 'selectedSegmentationAgent', 'Slicer settings panel does not render internal segmentation-agent ids or descriptions');
assertNotIncludes(slicerPage, 'const smartSliceFooterText =', 'Slicer settings panel does not render a redundant footer hint below the primary action');
assertIncludes(slicerPage, 'const handleSmartSliceAspectRatioChange = (value: string) =>', 'Slicer centralizes aspect-ratio selection normalization for both preview controls and settings panel');
assertIncludes(slicerPage, 'const handleSmartSliceObjectFitChange = (value: string) =>', 'Slicer centralizes object-fit selection normalization for both preview controls and settings panel');
assertIncludes(slicerPage, 'const handleSmartSliceContinuityChange = (value: string) =>', 'Slicer centralizes continuity selection normalization for advanced settings');
assertIncludes(slicerPage, 'const handleSmartSliceSegmentationChange = (value: string) =>', 'Slicer centralizes segmentation selection normalization for advanced settings');
assertIncludes(slicerPage, "t('slicer.settings.status.title')", 'Slicer settings panel opens with a compact readiness status instead of dense engine copy');
assertIncludes(slicerPage, "t('slicer.settings.status.sourceReady')", 'Slicer settings status surfaces source readiness through localized copy');
assertIncludes(slicerPage, "t('slicer.settings.status.sttReady')", 'Slicer settings status surfaces speech readiness through localized copy');
assertIncludes(slicerPage, "t('slicer.settings.status.strategyReady')", 'Slicer settings status surfaces strategy readiness through localized copy');
assertIncludes(slicerPage, "t('slicer.settings.action.analyze')", 'Slicer analyze action participates in i18n language switching');
assertMatches(
  slicerPage,
  /t\('slicer\.settings\.status\.title'\)[\s\S]*?t\('slicer\.settings\.runMode\.title'\)[\s\S]*?t\('slicer\.settings\.basic\.title'\)[\s\S]*?effectiveReviewSession \? \(/u,
  'Slicer settings panel puts readiness status, run mode, and basic settings before the review workbench so first-time users see the essential controls first',
);
assertMatches(
  slicerPage,
  /effectiveReviewSession \? \(\s*<section[\s\S]*?t\('slicer\.settings\.review\.title'\)[\s\S]*?\) : \(\s*<div className="rounded-lg border border-dashed/u,
  'Slicer settings panel renders the full review workbench only after a review plan exists',
);
assertIncludes(
  slicerPage,
  "t('slicer.settings.review.emptyTitle')",
  'Slicer settings panel replaces the empty review workbench with a compact localized next-step prompt',
);
assertIncludes(i18nResources, 'settings: {', 'AutoCut i18n resources define Smart Slice settings copy for every supported language');
assertIncludes(i18nResources, "title: '智能切片设置'", 'zh-CN i18n resources localize the simplified Smart Slice settings title');
assertIncludes(i18nResources, "title: 'Smart Slice settings'", 'en-US i18n resources localize the simplified Smart Slice settings title');
assertIncludes(i18nResources, "emptyTitle: '先创建审阅计划'", 'zh-CN i18n resources localize the empty review workbench prompt title');
assertIncludes(i18nResources, "emptyTitle: 'Create a review plan first'", 'en-US i18n resources localize the empty review workbench prompt title');
assertIncludes(i18nResources, 'editCorrection:', 'AutoCut i18n resources localize the compact review correction editor toggle for every supported language');
assertIncludes(i18nResources, 'showSegmentActions:', 'AutoCut i18n resources localize the compact per-segment action disclosure for every supported language');
assertIncludes(i18nResources, 'sceneOptions: {', 'AutoCut i18n resources localize every Smart Slice advanced scene option');
assertIncludes(i18nResources, 'sttPresets: {', 'AutoCut i18n resources localize every Smart Slice advanced STT workflow preset');
assertIncludes(i18nResources, 'segmentationAgents: {', 'AutoCut i18n resources localize every Smart Slice advanced segmentation-agent option');
assertIncludes(i18nResources, "gpuRuntimeRequired: '", 'AutoCut i18n resources localize the Smart Slice GPU STT runtime blocker');
assertIncludes(i18nResources, "configureVendorApiKey: '", 'AutoCut i18n resources localize the Smart Slice cloud STT API-key blocker');
assertIncludes(i18nResources, "recommendedSuffix: '", 'AutoCut i18n resources localize the Smart Slice recommended STT suffix');
assertIncludes(i18nResources, "cloudExecutionDetail: '", 'AutoCut i18n resources localize Smart Slice cloud STT execution detail');
assertRule(
  !/[\u00c0-\u00ff]\u0080?|\uFFFD/u.test(slicerPage),
  'SlicerPage has no visible UTF-8 mojibake in the Smart Cut commercial workbench source',
);
assertIncludes(slicerPage, "t('slicer.settings.runMode.review.label')", 'Slicer UI exposes a localized review-before-render mode before native rendering');
assertIncludes(slicerPage, "t('slicer.settings.runMode.auto.label')", 'Slicer UI keeps localized one-click automatic slicing as a first-class mode');
assertIncludes(slicerPage, 'segmentationDensity', 'Slicer UI stores segmentation density as a real Smart Cut Engine option');
assertIncludes(slicerPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS', 'Slicer UI reads the standard STT workflow preset registry');
assertIncludes(slicerPage, "const [sttPresetId, setSttPresetId]", 'Slicer UI stores the selected STT workflow preset as first-class workflow state');
assertIncludes(slicerPage, 'availableSttWorkflowPresets', 'Slicer UI filters unavailable future STT workflow strategies out of the operator selector');
assertIncludes(slicerPage, "t('slicer.settings.advanced.sttMode')", 'Slicer UI exposes STT strategy only inside localized advanced settings');
assertIncludes(slicerPage, 'function createSmartSliceSttWorkflowPresetDetail', 'Slicer UI surfaces the selected local Whisper chunk execution settings through localized preset detail copy');
assertIncludes(slicerPage, 'speechSetupStatus?.gpu.ready', 'Slicer UI gates GPU local STT mode on the probed local whisper.cpp GPU runtime instead of exposing a fake acceleration toggle');
assertIncludes(slicerPage, "t('slicer.settings.advanced.gpuRuntimeRequired')", 'Slicer UI tells operators through localized copy when GPU local STT requires a GPU-enabled whisper.cpp sidecar');
assertIncludes(slicerPage, 'effectiveSttPresetId', 'Slicer submits the effective selectable STT workflow preset after runtime-aware GPU gating');
assertIncludes(slicerPage, "t('slicer.settings.review.title')", 'Slicer UI provides a localized segment review workbench instead of a passive human-review note');
assertIncludes(slicerPage, "t('slicer.settings.review.action.renderSelected'", 'Slicer UI lets operators render only manually selected review segments through localized copy');
assertIncludes(slicerPage, 'const selectedReviewSegmentIds = renderableReviewSegmentIds', 'Slicer UI tracks checkbox-based manual segment selection from the review segment model');
assertIncludes(slicerPage, "type SliceReviewVisibilityFilter = 'all' | 'selected' | 'duplicates' | 'excluded'", 'Slicer UI defines review workbench visibility filters for commercial manual review');
assertIncludes(slicerPage, 'reviewVisibilityFilter', 'Slicer UI keeps a dedicated review segment visibility filter state');
assertIncludes(slicerPage, 'visibleReviewSegments', 'Slicer UI derives the review list from the visibility filter instead of hiding workflow state in raw segments');
assertIncludes(slicerPage, 'activeReviewSegmentId', 'Slicer UI tracks the segment currently being previewed by the operator');
assertIncludes(slicerPage, 'activeReviewSegment', 'Slicer UI exposes the currently previewed segment summary and evidence');
assertIncludes(slicerPage, 'timelineController.previewReviewSegment', 'Slicer UI supports explicit preview seeking for review segments');
assertIncludes(slicerPage, 'shouldHydrateSmartSliceReviewSessionFromTask', 'Slicer UI guards task-event hydration so manual review edits are not overwritten by background task refreshes');
assertMatches(
  slicerPage,
  /currentManualEditCount\s*>\s*0[\s\S]*?currentDraft\?\.id\s*===\s*nextSession\.id/u,
  'Slicer UI preserves an in-progress manual review draft when the same review session is refreshed from task events',
);
assertMatches(
  slicerPage,
  /!hasVideoSource\s*&&\s*!activeReviewTaskId[\s\S]*?status === AUTOCUT_TASK_STATUS\.reviewing/u,
  'Slicer UI only auto-opens the latest reviewing task when no current source video is loaded, avoiding stale review plans after source replacement',
);
assertIncludes(slicerPage, 'resetSmartSliceReviewWorkbenchForNewPlan', 'Slicer UI clears stale review workbench state before creating a new Smart Cut analysis plan');
assertMatches(
  slicerPage,
  /if \(runMode === 'review-before-render'\) \{\s+resetSmartSliceReviewWorkbenchForNewPlan\(\);[\s\S]*?const result = await analyzeVideoSlicePlan/u,
  'Slicer UI clears the old review preview before starting a fresh review-before-render analysis',
);
assertIncludes(slicerPage, 'handleSelectAllReviewSegments', 'Slicer UI supports selecting every renderable review segment before export');
assertIncludes(slicerPage, 'handleClearReviewSegmentSelection', 'Slicer UI supports clearing the manual render selection before export');
assertIncludes(slicerPage, "t('slicer.settings.review.queue.title')", 'Slicer UI presents human review as a localized queue instead of only a passive segment list');
assertIncludes(slicerPage, "t('slicer.settings.review.preview.title')", 'Slicer UI shows the currently previewed segment evidence before rendering with localized copy');
assertIncludes(slicerPage, "t('slicer.settings.review.action.selectAll')", 'Slicer UI has a one-click publishable segment selection action');
assertIncludes(slicerPage, "t('slicer.settings.review.action.clearSelection')", 'Slicer UI has a one-click selection clearing action');
assertIncludes(slicerPage, "t('slicer.settings.review.filter.all')", 'Slicer UI has an all-segments review filter');
assertIncludes(slicerPage, "t('slicer.settings.review.filter.selected')", 'Slicer UI has a selected-segments review filter');
assertIncludes(slicerPage, "t('slicer.settings.review.filter.duplicates')", 'Slicer UI has a duplicate-content review filter');
assertIncludes(slicerPage, "t('slicer.settings.review.filter.excluded')", 'Slicer UI has an excluded-segments review filter');
assertIncludes(slicerPage, 'timelineController.splitClipAtTime', 'Slicer UI supports manual split at an engine-owned segment boundary');
assertIncludes(slicerPage, 'handleMergeReviewSegment', 'Slicer UI supports manual merge for adjacent review segments');
assertIncludes(clipWorkflow, "if (currentSegment.status === 'duplicate' || neighborSegment.status === 'duplicate')", 'Slicer UI blocks duplicate review segments from manual merge handlers');
assertIncludes(slicerPage, 'const previousReviewSegment = reviewSegments[index - 1]', 'Slicer UI resolves the previous review segment before exposing merge actions');
assertIncludes(slicerPage, 'const nextReviewSegment = reviewSegments[index + 1]', 'Slicer UI resolves the next review segment before exposing merge actions');
assertIncludes(slicerPage, 'const canMergeWithPreviousReviewSegment =', 'Slicer UI derives previous merge availability before rendering segment actions');
assertIncludes(slicerPage, 'const canMergeWithNextReviewSegment =', 'Slicer UI derives next merge availability before rendering segment actions');
assertIncludes(slicerPage, "previousReviewSegment.status !== 'duplicate'", 'Slicer UI hides merge-previous when the adjacent previous segment is duplicate');
assertIncludes(slicerPage, "nextReviewSegment.status !== 'duplicate'", 'Slicer UI hides merge-next when the adjacent next segment is duplicate');
assertMatches(
  slicerPage,
  /canMergeWithPreviousReviewSegment[\s\S]*?id: 'merge-previous'[\s\S]*?canMergeWithNextReviewSegment[\s\S]*?id: 'merge-next'/u,
  'Slicer UI exposes merge actions only for directions whose adjacent review segment is mergeable',
);
assertIncludes(slicerPage, 'handleDeleteDuplicateReviewSegment', 'Slicer UI supports manual duplicate-content deletion before render');
assertIncludes(clipWorkflow, 'function resolveSliceReviewDuplicateKeepSegmentId', 'SlicerPage centralizes duplicate keep-segment resolution before manual duplicate deletion');
assertIncludes(slicerPage, 'segment.duplicateOfSegmentId', 'SlicerPage prefers an existing duplicateOfSegmentId when deleting a duplicate segment');
assertIncludes(slicerPage, 'duplicateGroup?.keptSegmentId', 'SlicerPage falls back to the review duplicate group kept segment when deleting a duplicate segment');
assertNotIncludes(slicerPage, 'baseSession.selectedSegmentIds.find((id) => id !== segmentId)', 'SlicerPage does not pick an arbitrary selected segment as the duplicate keep target');
assertNotIncludes(slicerPage, 'reviewSession.segments.find((candidate) => candidate.id !== segment.id)?.id', 'SlicerPage does not pick an arbitrary review segment as the duplicate keep target for external dedup matches');
assertIncludes(slicerPage, 'handleRestoreReviewSegment', 'Slicer UI supports restoring manually excluded or duplicate segments');
assertIncludes(slicerPage, 'resetSmartSliceReviewWorkbenchForSourceChange', 'Slicer UI clears stale review sessions, manual edits, and dedup reports whenever the source video changes');
assertMatches(
  slicerPage,
  /handleReplaceVideoFallbackSelected[\s\S]*resetSmartSliceReviewWorkbenchForSourceChange\(\)/u,
  'Slicer UI clears stale Smart Slice review state when browser fallback source replacement is used',
);
assertMatches(
  slicerPage,
  /handleReplaceVideo[\s\S]*resetSmartSliceReviewWorkbenchForSourceChange\(\)/u,
  'Slicer UI clears stale Smart Slice review state when trusted native source replacement is used',
);
assertIncludes(slicerPage, 'analyzeVideoSlicePlan', 'Slicer UI can run Smart Cut analysis without immediately rendering');
assertIncludes(slicerPage, 'renderVideoSlicePlan', 'Slicer UI can render the reviewed selected segment plan');
assertIncludes(slicerPage, "searchParams.get('reviewTaskId')", 'Slicer can open a specific review-ready task from the task center');
assertIncludes(slicerPage, 'useState<string>(initialReviewTaskId)', 'Slicer initializes the active review workbench from the routed review task id');
assertNotIncludes(slicerPage, 'Commercial Readiness', 'Slicer UI removes launch-readiness release copy from the simplified Smart Slice settings panel');
assertNotIncludes(slicerPage, 'Source Evidence', 'Slicer UI removes source evidence commercial gate copy from the simplified Smart Slice settings panel');
assertNotIncludes(slicerPage, 'Speaker Evidence', 'Slicer UI removes speaker evidence commercial gate copy from the simplified Smart Slice settings panel');
assertNotIncludes(slicerPage, 'Export Contract', 'Slicer UI removes export contract commercial gate copy from the simplified Smart Slice settings panel');
assertNotIncludes(slicerPage, 'commercialReadinessItems', 'Slicer no longer derives release-readiness cards for the simplified settings panel');
assertNotIncludes(slicerPage, 'hasCommercialReadinessBlocker', 'Slicer start action no longer depends on a commercial-readiness blocker');
assertIncludes(slicerPage, 'disabled={isProcessing || !smartSliceReadyForRun}', 'Slicer start action is gated by the named Smart Slice run-readiness model');
assertIncludes(slicerPage, 'publishableClipContract', 'Slicer product experience derives a publishable clip contract from the selected scene');
assertIncludes(slicerPage, 'qaSplitContract', 'Slicer product experience derives one-question-one-answer splitting rules for interview scenes');
assertIncludes(slicerPage, 'formatContract', 'Slicer product experience derives output format constraints from publishing settings');
assertIncludes(slicerPage, 'subtitleContract', 'Slicer product experience derives subtitle delivery requirements from the selected settings');
assertIncludes(slicerPage, 'cleanupContract', 'Slicer product experience derives cleanup requirements from post-boundary filter settings');
assertIncludes(slicerPage, 'coverContract', 'Slicer product experience derives cover and packaging expectations for commercial output');
assertIncludes(slicerPage, 'reviewCheckpoint', 'Slicer product experience derives the human review checkpoint from smart-edit evidence policy');
assertIncludes(slicerPage, 'failClosedPolicy', 'Slicer product experience derives a fail-closed policy from evidence requirements');
assertIncludes(slicerPage, '9:16', 'Slicer UI exposes the default vertical short-video format required by the original smart-edit brief');
assertIncludes(slicerPage, '1080x1920', 'Slicer UI exposes the commercial vertical resolution required by the original smart-edit brief');
assertIncludes(slicerPage, '30fps MP4', 'Slicer UI exposes frame-rate and container requirements from the original smart-edit brief');
assertIncludes(slicerPage, '1Q1A', 'Slicer UI exposes interview one-question-one-answer splitting as a first-class product rule');
assertIncludes(slicerPage, '60-180s matrix', 'Slicer UI exposes long-interview matrix slicing duration expectations');
assertIncludes(slicerPage, 'Prompt sound', 'Slicer UI exposes package-level polish requirements instead of only core clipping');
assertIncludes(slicerPage, 'hasVideoSource', 'Slicer UI models source availability before enabling commercial Smart Cut execution');
assertIncludes(slicerPage, '!hasVideoSource', 'Slicer start action stays disabled until a source video is available');
assertIncludes(slicerPage, "useState<'text' | 'tasks'>('tasks')", 'Slicer opens on Smart Cut jobs instead of the secondary text-effect editor');
assertIncludes(slicerPage, 'No Smart Cut jobs yet', 'Slicer task rail has a commercial empty state for first-time operators');
assertNotIncludes(slicerPage, 'Speech-to-text evidence', 'Slicer UI removes dense pipeline-step copy from the simplified settings panel');
assertNotIncludes(slicerPage, 'Speaker diarization', 'Slicer UI removes dense diarization step copy from the simplified settings panel');
assertNotIncludes(slicerPage, 'Semantic content units', 'Slicer UI removes dense semantic unit step copy from the simplified settings panel');
assertNotIncludes(slicerPage, 'Candidate ID review', 'Slicer UI removes dense candidate-id pipeline copy from the simplified settings panel');
assertNotIncludes(slicerPage, 'Post-filter render', 'Slicer UI removes dense post-filter pipeline copy from the simplified settings panel');
assertNotIncludes(slicerPage, 'smartCutRequiresSpeakerDiarization', 'Slicer UI removes the unused scene regex once the simplified panel no longer renders a speaker gate badge');
assertNotIncludes(slicerPage, 'Multi-speaker gate', 'Slicer UI removes dense multi-speaker gate copy from the simplified settings panel');

assertIncludes(tasksPage, 'AUTOCUT_TASK_STATUS.reviewing', 'TasksPage treats human review as a first-class task status');
assertIncludes(tasksPage, 'Review Ready', 'TasksPage labels review-ready Smart Slice tasks clearly');
assertIncludes(tasksPage, 'handleOpenReviewWorkbench', 'TasksPage provides a direct action back to the Segment Review Workbench');
assertIncludes(tasksPage, '`/slicer?reviewTaskId=${encodeURIComponent(taskId)}`', 'TasksPage routes review-ready tasks to the exact slicer review session');
assertIncludes(tasksPage, 'Review segments', 'TasksPage row action tells operators to review segments before rendering');

const taskDetailReviewPage = read('packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx');
const taskDetailEngineStepsPath = 'packages/sdkwork-autocut-tasks/src/pages/taskDetailEngineSteps.ts';
const taskDetailEngineSteps = exists(taskDetailEngineStepsPath) ? read(taskDetailEngineStepsPath) : '';
assertIncludes(taskDetailReviewPage, 'AUTOCUT_TASK_STATUS.reviewing', 'TaskDetailPage treats human review as a first-class task status');
assertIncludes(taskDetailReviewPage, 'taskDetail.review.title', 'TaskDetailPage presents a dedicated localized review-ready state instead of a generic progress view');
assertIncludes(taskDetailReviewPage, 'taskDetail.review.openWorkbench', 'TaskDetailPage provides a clear localized action to continue manual segment review');
assertIncludes(taskDetailReviewPage, '`/slicer?reviewTaskId=${encodeURIComponent(task.id)}`', 'TaskDetailPage routes the operator back to the exact review-ready slicer task');
assertRule(exists(taskDetailEngineStepsPath), 'TaskDetail Smart Slice engine-step standard is extracted into a focused pure module');
assertIncludes(taskDetailReviewPage, "from './taskDetailEngineSteps'", 'TaskDetailPage imports the Smart Slice engine-step standard module instead of owning the registry');
assertNotIncludes(taskDetailReviewPage, 'const TASK_DETAIL_ENGINE_STEP_DEFINITIONS: Record', 'TaskDetailPage does not inline the Smart Slice engine-step registry');
assertNotIncludes(taskDetailReviewPage, 'function inferSmartSliceTaskDetailEngine(', 'TaskDetailPage does not inline Smart Slice engine inference logic');
assertNotIncludes(taskDetailReviewPage, 'function createTaskDetailEngineStepViewModels(', 'TaskDetailPage does not inline engine-step evidence mapping logic');
assertIncludes(taskDetailEngineSteps, 'export const SMART_SLICE_EVIDENCE_PACKAGE_ITEMS', 'Task detail engine-step module still defines the canonical Smart Slice evidence package for backend and release gates');
assertIncludes(taskDetailEngineSteps, 'export const SMART_SLICE_EVIDENCE_STEP_IDS', 'Task detail engine-step module still counts evidence-producing checkpoint steps outside the simplified log Drawer');
assertNotIncludes(taskDetailReviewPage, 'createSmartSliceEvidenceInspectorRows', 'TaskDetailPage does not render a task evidence inspector inside the simplified step-log Drawer');
assertNotIncludes(taskDetailReviewPage, "t('taskDetail.diagnostics.evidenceTitle')", 'TaskDetailPage does not expose evidence-inspector chrome inside the simplified step-log Drawer');
assertNotIncludes(taskDetailReviewPage, 'copiedSmartSliceEvidenceItemId', 'TaskDetailPage does not keep evidence-copy UI state in the simplified task detail surface');
assertNotIncludes(taskDetailReviewPage, 'copySmartSliceEvidenceArtifactPath', 'TaskDetailPage does not expose task evidence copy actions from the step-log Drawer');
assertNotIncludes(taskDetailReviewPage, 'openSmartSliceEvidenceArtifactLocation', 'TaskDetailPage does not expose task evidence reveal actions from the step-log Drawer');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/speech-to-text.json'", 'Task detail engine-step module includes the canonical speech-to-text evidence file');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/semantic-segmentation.json'", 'Task detail engine-step module includes the canonical semantic segmentation evidence file');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/review-session.json'", 'Task detail engine-step module includes the canonical review session evidence file');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/manual-edits.json'", 'Task detail engine-step module includes the canonical manual edits evidence file');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/review-events.json'", 'Task detail engine-step module includes the canonical replayable review events evidence file');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/render-selection.json'", 'Task detail engine-step module includes the canonical render selection evidence file');
assertIncludes(taskDetailEngineSteps, "relativePath: 'evidence/render-artifact-manifest.json'", 'Task detail engine-step module includes the canonical render artifact manifest evidence file');
assertIncludes(taskDetailEngineSteps, 'export type SmartSliceTaskDetailEngine', 'Task detail engine-step module models the selected Smart Slice engine separately from raw execution step ids');
assertIncludes(taskDetailEngineSteps, 'export const TASK_DETAIL_ENGINE_STEP_DEFINITIONS', 'Task detail engine-step module defines an engine-aware step registry for Smart Slice task detail');
assertIncludes(taskDetailEngineSteps, "'talking-head-semantic'", 'Task detail engine-step module includes the talking-head semantic engine for spoken-content Smart Slice tasks');
assertIncludes(taskDetailEngineSteps, "'dialogue-qa'", 'Task detail engine-step module includes a dialogue QA engine-specific detail flow');
assertIncludes(taskDetailEngineSteps, "'visual-scene'", 'Task detail engine-step module includes a visual scene engine-specific detail flow');
assertIncludes(taskDetailEngineSteps, "id: 'content-understanding-segmentation'", 'Task detail engine-step module separates post-STT content-understanding segmentation into its own engine step');
assertIncludes(taskDetailEngineSteps, "id: 'timeline-refinement'", 'Task detail engine-step module separates manual timeline boundary refinement into its own engine step');
assertIncludes(taskDetailEngineSteps, "'drag-clip-boundaries'", 'Task detail engine-step module marks timeline refinement as supporting left/right clip-boundary adjustment');
assertIncludes(taskDetailEngineSteps, 'export function inferSmartSliceTaskDetailEngine', 'Task detail engine-step module infers the engine from review session, params, checkpoint evidence, and slice evidence');
assertIncludes(taskDetailEngineSteps, 'export function createTaskDetailEngineStepViewModels', 'Task detail engine-step module maps raw execution evidence into product-level engine steps');
assertIncludes(taskDetailReviewPage, 'TaskDetailCommercialFlowPanel', 'TaskDetailPage renders a compact product workflow surface for engine-aware Smart Slice tasks');
assertIncludes(taskDetailReviewPage, 'activeFlowOutputTab', 'TaskDetailPage keeps output exploration in product-facing tabs instead of an advanced engine workbench');
assertIncludes(taskDetailReviewPage, 'data-task-detail-diagnostics-drawer="true"', 'TaskDetailPage keeps raw step logs in a dedicated Drawer');
assertIncludes(taskDetailReviewPage, 'data-task-detail-diagnostics-step-filter="true"', 'TaskDetailPage exposes compact step filtering inside the log Drawer');
assertIncludes(taskDetailReviewPage, 'data-task-detail-diagnostics-log-stream="true"', 'TaskDetailPage exposes the execution log stream inside the log Drawer');
assertNotIncludes(taskDetailReviewPage, 'TaskDetailEngineStepper', 'TaskDetailPage does not duplicate the commercial workflow with a second advanced stepper');
assertNotIncludes(taskDetailReviewPage, 'TaskDetailSmartSliceEngineWorkbench', 'TaskDetailPage does not duplicate product outputs with an advanced engine workbench inside diagnostics');
assertNotIncludes(taskDetailReviewPage, 'TaskDetailVideoSliceAdvancedPanel', 'TaskDetailPage does not mount a second advanced video-slice panel below task results');
assertNotIncludes(taskDetailReviewPage, "t('taskDetail.engineSteps.title')", 'TaskDetailPage does not render the removed advanced engine-stepper title');
assertNotIncludes(taskDetailReviewPage, "t('taskDetail.engineSteps.workbench.contentUnderstanding.title')", 'TaskDetailPage does not render removed content-understanding workbench copy');
assertNotIncludes(taskDetailReviewPage, "t('taskDetail.engineSteps.workbench.timelineRefinement.title')", 'TaskDetailPage does not render removed timeline-refinement workbench copy');
assertIncludes(taskDetailReviewPage, "t('taskDetail.engineSteps.diagnostics.title')", 'TaskDetailPage keeps raw execution details as advanced diagnostics below the product workbench');
assertIncludes(i18nResources, 'contentUnderstandingSegmentation', 'i18n resources include content-understanding segmentation engine-step labels');
assertIncludes(i18nResources, 'timelineRefinement', 'i18n resources include timeline refinement engine-step labels');
assertIncludes(slicerPage, 'contentUnitIds', 'Slicer retains audit-ready content unit evidence in review segments without exposing dense release copy in settings');
assertIncludes(slicerPage, 'speakerRoles', 'Slicer retains speaker-role evidence in review segments without exposing dense release copy in settings');
assertIncludes(slicerPage, "t('slicer.settings.basic.title')", 'Slicer UI presents the main Smart Slice settings as a basic product section instead of a pipeline contract');
const autocutTypesSource = read('packages/sdkwork-autocut-types/src/index.ts');
assertIncludes(autocutTypesSource, 'AutoCutSliceReviewSession', 'Types define a first-class Smart Slice human review session');
assertIncludes(autocutTypesSource, 'AutoCutSliceReviewSegment', 'Types define reviewable slice segments independent of rendered artifacts');
assertIncludes(autocutTypesSource, 'AutoCutSliceManualEdit', 'Types preserve manual split, merge, duplicate-delete, restore, and selection edits as audit data');
assertIncludes(autocutTypesSource, 'AutoCutSliceDuplicateGroup', 'Types model duplicate content groups for manual deletion and audit');
assertIncludes(autocutTypesSource, "'smart-dedup'", 'Types model Smart Slice video dedup groups separately from semantic and manual duplicate edits');
assertIncludes(autocutTypesSource, 'smartDedupReport?: VideoDedupReport', 'Types attach the reusable video dedup report to the Smart Slice review session');
assertIncludes(autocutTypesSource, "'smart-dedup-review'", 'Types define a cataloged Smart Slice review risk for service-side video dedup matches');
assertIncludes(autocutTypesSource, 'AutoCutSliceRenderSelection', 'Types define the render-selected contract after human review');
assertIncludes(autocutTypesSource, 'SliceSegmentationDensity', 'Types define Smart Slice segmentation density as a first-class option');
assertIncludes(autocutTypesSource, 'maximize-continuity', 'Types include the maximize-continuity segmentation density');
assertIncludes(autocutTypesSource, "reviewing: 'reviewing'", 'Task status includes an explicit reviewing state for plans waiting on human approval');
assertNotIncludes(slicerPage, '核心切分算法', 'Slicer UI no longer exposes legacy core algorithm wording');
assertNotIncludes(slicerPage, '基础分段策略', 'Slicer UI no longer exposes legacy base algorithm selection');
assertNotIncludes(slicerPage, '高光提取引擎', 'Slicer UI no longer exposes legacy highlight engine selection');
assertNotIncludes(slicerPage, "const [sliceCountMode, setSliceCountMode]", 'Slicer does not store a user-selected smart slice count strategy mode');
assertNotIncludes(slicerPage, "const [targetSliceCount, setTargetSliceCount]", 'Slicer does not store a user requested smart slice count');
assertNotIncludes(slicerPage, 'SliceCountMode', 'Slicer UI removes legacy slice count mode controls from the active workflow');
assertNotIncludes(slicerPage, 'setBaseAlgorithm', 'Slicer UI no longer keeps legacy base algorithm as operator state');
assertNotIncludes(slicerPage, 'setHighlightEngine', 'Slicer UI no longer keeps legacy highlight engine as operator state');
assertNotIncludes(slicerPage, 'useState<SliceAlgorithm>', 'Slicer UI no longer stores legacy base algorithm state');
assertNotIncludes(slicerPage, 'useState<SliceHighlightEngine>', 'Slicer UI no longer stores legacy highlight engine state');
assertIncludes(slicerPage, "const [idealDuration, setIdealDuration]", 'Slicer stores the ideal smart slice duration');
assertIncludes(slicerPage, "const [continuityLevel, setContinuityLevel]", 'Slicer stores the transcript continuity level');
assertIncludes(slicerPage, "const [customKeywordsInput, setCustomKeywordsInput]", 'Slicer stores custom smart slice keywords');
assertNotIncludes(slicerPage, "if (targetPlatform === 'bilibili')", 'Slicer removes publishing-platform auto-default branches from the simplified settings panel');
assertNotIncludes(slicerPage, "if (targetPlatform === 'xiaohongshu')", 'Slicer removes Xiaohongshu publishing defaults from the simplified settings panel');
assertNotIncludes(slicerPage, "if (targetPlatform !== 'generic')", 'Slicer no longer applies short-video platform defaults from a hidden UI state');
assertIncludes(slicerPage, 'targetPlatform: SMART_SLICE_DEFAULT_TARGET_PLATFORM', 'Slicer passes a stable generic targetPlatform into VideoSliceParams and preferences');
assertIncludes(slicerPage, 'targetAspectRatio: aspectRatio', 'Slicer passes the target aspect ratio into VideoSliceParams');
assertIncludes(slicerPage, 'videoObjectFit,', 'Slicer passes target object-fit into VideoSliceParams');
assertNotIncludes(slicerPage, 'sliceCountMode,', 'Slicer does not submit a legacy count mode into VideoSliceParams');
assertNotIncludes(slicerPage, 'targetSliceCount,', 'Slicer does not submit a target clip count into VideoSliceParams or preferences');
assertIncludes(slicerPage, 'idealDuration,', 'Slicer passes idealDuration into VideoSliceParams');
assertIncludes(slicerPage, 'continuityLevel,', 'Slicer passes continuityLevel into VideoSliceParams');
assertIncludes(slicerPage, 'sttPresetId,', 'Slicer passes the selected STT workflow preset into VideoSliceParams and preferences');
assertIncludes(slicerPage, 'customKeywords: customKeywordsInput', 'Slicer passes custom keywords into VideoSliceParams');
assertIncludes(slicerPage, 'subtitleMode', 'Slicer exposes a standardized subtitle publishing mode');
assertIncludes(slicerPage, 'setSubtitleMode', 'Slicer lets the operator choose the subtitle publishing mode');
assertIncludes(
  slicerPage,
  'const [enableSubtitles, setEnableSubtitles] = useState(false)',
  'Slicer defaults subtitle rendering to disabled while smart slicing still requires speech-to-text',
);
assertIncludes(
  slicerPage,
  'enableSubtitles,',
  'Slicer passes the explicit subtitle rendering toggle into VideoSliceParams',
);
assertIncludes(
  slicerPage,
  "subtitleMode: enableSubtitles ? effectiveSubtitleMode : 'none'",
  'Slicer persists disabled subtitles as the canonical none mode without weakening STT planning',
);
assertIncludes(
  slicerPage,
  "setSubtitleMode((currentMode) => currentMode === 'none' ? 'both' : currentMode)",
  'Slicer repairs the latent subtitle mode when the operator re-enables subtitle rendering after a disabled run',
);
assertIncludes(
  slicerPage,
  "{ value: 'srt', label: 'SRT' }",
  'Slicer exposes SRT-only subtitle publishing when subtitle rendering is enabled',
);
assertIncludes(slicerPage, 'getAutoCutWorkflowPreferences', 'Slicer loads persisted workflow parameter preferences');
assertIncludes(slicerPage, 'saveAutoCutVideoSlicePreferences', 'Slicer persists the last-used video slice parameters before processing');
assertIncludes(slicerPage, 'setSttPresetId(videoSlice.sttPresetId)', 'Slicer reloads the persisted STT workflow preset before Smart Slice execution');
assertIncludes(slicerPage, 'setNoiseReduction', 'Slicer exposes a switch that can skip broadband denoise for clean Smart Slice source audio');
assertIncludes(slicerPage, 'createSmartSliceSubmissionDiagnostics(sliceParams)', 'Slicer creates sanitized Smart Slice submission diagnostics for console troubleshooting');
assertIncludes(slicerPage, 'reportAutoCutDiagnostic(\'warning\', \'slicer.submit\', \'Smart Slice submit params\'', 'Slicer logs Smart Slice submit parameters to the browser console');
assertIncludes(slicerPage, 'createSmartSliceFailureToastMessage(e, t)', 'Slicer surfaces the real Smart Slice failure reason instead of a generic parameter error');
assertIncludes(slicerPage, 'toast(createSmartSliceFailureToastMessage(e, t), \'error\')', 'Slicer failure toast includes the actionable underlying Smart Slice error');
assertIncludes(slicerPage, 'handleSlicerTaskUpdated', 'SlicerPage applies taskUpdated events directly instead of refetching full native task snapshots on progress ticks');
assertIncludes(slicerPage, 'mergeSlicerTaskUpdate', 'SlicerPage uses a deterministic task merge helper for responsive progress updates');
assertIncludes(
  slicerPage,
  'useTranslation',
  'Slicer uses the open-source i18next React integration for visible Smart Slice setup text',
);
assertIncludes(
  slicerPage,
  "t('slicer.speechSetup.smartSliceFailedPrefix')",
  'Slicer localizes Smart Slice failure toast prefixes through i18n resources',
);
assertIncludes(
  slicerPage,
  "t('slicer.speechSetup.toast.ready')",
  'Slicer localizes local STT ready toasts through i18n resources',
);
assertIncludes(
  slicerPage,
  "t('slicer.speechSetup.toast.submitCreated')",
  'Slicer localizes Smart Slice task-created toasts through i18n resources',
);
assertIncludes(
  slicerPage,
  'inspectAutoCutLocalSpeechTranscriptionSetup',
  'Slicer checks local STT setup readiness before creating a smart-slice task',
);
assertIncludes(
  slicerPage,
  'initializeAutoCutLocalSpeechTranscriptionSetup',
  'Slicer starts local STT initialization from the slice button instead of creating an immediate failed task',
);
assertIncludes(
  slicerPage,
  "listenAutoCutEvent('speechTranscriptionModelDownloadProgress'",
  'Slicer listens for local STT model download progress while preflight initialization runs',
);
assertRule(
  !slicerPage.includes("listenAutoCutEvent('speechTranscriptionExecutableDownloadProgress'"),
  'Slicer does not listen for executable download progress because whisper-cli is packaged as a sidecar',
);
assertIncludes(
  slicerPage,
  'speechSetupDialogOpen',
  'Slicer renders a blocking local STT setup dialog before smart slicing when STT is not ready',
);
assertIncludes(
  slicerPage,
  'ensureSmartSliceLocalSpeechTranscriptionReady',
  'Slicer gates Smart Slice execution on verified local STT setup readiness',
);
assertMatches(
  slicerPage,
  /const speechReady = await ensureSmartSliceLocalSpeechTranscriptionReady\(\);\s+if \(!speechReady\) \{\s+return;\s+\}/u,
  'Slicer does not call processVideoSlice when local STT setup initialization cannot reach ready state',
);
assertIncludes(
  slicerPage,
  "navigate('/settings?tab=speech')",
  'Slicer local STT setup dialog provides a direct Speech-to-Text settings action when manual configuration is required',
);
assertIncludes(
  slicerPage,
  'speechModelDownloadProgress?.progress',
  'Slicer local STT setup dialog renders visible model download percentage progress',
);
assertIncludes(
  slicerPage,
  'speechModelDownloadCompleted',
  'Slicer preserves completed local STT model downloads as a success state when the final availability check still needs attention',
);
assertIncludes(
  slicerPage,
  "t('slicer.speechSetup.progress.completed')",
  'Slicer explains completed local STT model download and verification in user-facing language',
);
assertIncludes(
  slicerPage,
  "t('slicer.speechSetup.executable.title')",
  'Slicer local STT setup dialog renders visible packaged speech recognition app status',
);
assertIncludes(
  slicerPage,
  'formatSmartSliceSpeechSetupBytes',
  'Slicer local STT setup dialog renders visible local STT model download byte counts',
);
assertIncludes(
  slicerPage,
  "reportAutoCutDiagnostic('warning', 'slicer.speech-setup', 'Smart Slice local STT initialization preflight'",
  'Slicer logs local STT initialization preflight details to the browser console before starting downloads',
);
assertIncludes(
  slicerPage,
  'waitForSmartSliceUiYield',
  'Slicer yields to the browser renderer before Smart Slice STT initialization and processing work begins',
);
assertMatches(
  normalizeLineEndings(slicerPage),
  /await waitForSmartSliceUiYield\(\);\s+const preflightStatus = await refreshSmartSliceLocalSpeechTranscriptionSetup\(\);/u,
  'Slicer opens and paints the STT setup dialog before probing or downloading the local model',
);
assertMatches(
  normalizeLineEndings(slicerPage),
  /const ensureSmartSliceLocalSpeechTranscriptionReady = async \(\) => \{[\s\S]*?setSpeechSetupDialogOpen\(true\);\s+await waitForSmartSliceUiYield\(\);\s+const status = await refreshSmartSliceLocalSpeechTranscriptionSetup\(\);/u,
  'Slicer opens the local STT setup dialog and yields before the first readiness inspection',
);
assertIncludes(
  slicerPage,
  'isInspectingSpeechSetup',
  'Slicer shows an explicit busy state while inspecting local STT readiness before model setup',
);
assertIncludes(
  slicerPage,
  'speechSetupBusy',
  'Slicer keeps the local STT setup dialog in a consistent busy state during inspection and initialization',
);
assertIncludes(
  slicerPage,
  'Smart Slice local STT readiness inspection failed',
  'Slicer records first-pass local STT readiness inspection failures in the setup dialog instead of failing silently',
);
assertMatches(
  normalizeLineEndings(slicerPage),
  /await waitForSmartSliceUiYield\(\);\s+const result = await initializeAutoCutLocalSpeechTranscriptionSetup\(\);/u,
  'Slicer yields again before the long-running local STT initialization call',
);
assertIncludes(
  speechTranscriptionService,
  'dispatchAutoCutSpeechTranscriptionModelDownloadProgress',
  'Speech transcription service emits model download progress events instead of blocking the UI silently',
);
assertIncludes(
  speechTranscriptionService,
  'phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed',
  'Speech transcription service reports model download failures as visible progress events',
);
assertIncludes(
  slicerPage,
  'NativeSmartSliceVideoPreview',
  'Slicer uses a lightweight native video preview for Smart Slice instead of defaulting to a WebGL rendering surface',
);
assertIncludes(
  slicerPage,
  'React.lazy(() => import("../components/WebGLPlayer"))',
  'Slicer lazy-loads the WebGL text overlay editor only when the operator enables overlay editing',
);
assertIncludes(
  slicerPage,
  'setWebGlTextEffectDragPayload',
  'Slicer prepares lazy WebGL drag state without statically importing the Pixi editor into the default route',
);
assertIncludes(
  slicerPage,
  'const shouldUseWebGlOverlayEditor = enableOverlayEditor && videoSrc',
  'Slicer keeps WebGL disabled during the normal transcript-assisted Smart Slice workflow',
);
assertRule(
  !slicerPage.includes('import { WebGLPlayer, WebGLPlayerRef, WebGLPlayerDragState } from "../components/WebGLPlayer"'),
  'Slicer does not statically import the Pixi/WebGL player into the default Smart Slice route',
);
assertIncludes(
  slicerPage,
  'window.requestAnimationFrame',
  'Slicer uses a browser animation frame yield so the setup dialog and progress state paint before heavy Smart Slice work',
);
assertMatches(
  normalizeLineEndings(slicerPage),
  /window\.requestAnimationFrame\(\(\) => \{\s+window\.requestAnimationFrame\(\(\) => \{\s+setTimeout\(\(\) => resolve\(\), 0\);/u,
  'Slicer waits for two animation frames and one macro task so the STT setup dialog is visibly painted before native initialization starts',
);
assertIncludes(
  slicerPage,
  'speechSetupStatus?.defaults.modelPath',
  'Slicer local STT setup dialog shows the automatically resolved default model path',
);
assertIncludes(
  slicerPage,
  'createSmartSliceSpeechSetupFriendlyError',
  'Slicer local STT setup dialog converts technical setup failures into user-friendly guidance',
);
assertIncludes(
  slicerPage,
  "t('slicer.speechSetup.action.openSettings')",
  'Slicer local STT setup dialog links manual recovery to the product settings page',
);
assertIncludes(
  i18nResources,
  'speechSetup:',
  'i18n resources include the Slicer local STT setup dialog resources',
);
assertIncludes(
  i18nResources,
  'smartSliceFailedPrefix',
  'i18n resources include Smart Slice failure toast prefixes',
);
assertIncludes(
  i18nResources,
  'modelSavedNeedsCheck',
  'i18n resources include completed-model pending-check guidance for Slicer STT setup',
);
assertIncludes(
  slicerPage,
  'formatSmartSliceSpeechSetupPath',
  'Slicer local STT setup dialog summarizes long local paths without exposing technical paths as the primary content',
);
const speechSettingsPage = read('packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
assertIncludes(
  speechSettingsPage,
  'speechSetupStatus?.executable.ready === true',
  'Settings speech checklist trusts the native STT executable probe instead of treating any typed path as ready',
);
assertIncludes(
  speechSettingsPage,
  'speechSetupStatus?.model.ready === true',
  'Settings speech checklist trusts the native STT model probe instead of treating any typed path as ready',
);
assertIncludes(
  speechSettingsPage,
  'speechSetupStatus?.defaults.modelPath',
  'Settings speech page shows the automatically resolved default STT model path',
);

const slicerService = read('packages/sdkwork-autocut-slicer/src/service/slicerService.ts');
const slicerPlanningKernel = read('packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts');
const smartCutEnginePlanner = read('packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts');
const smartCutEngineLlmReview = read('packages/sdkwork-autocut-smart-cut-engine/src/engine/llm-review.ts');
const smartCutEngineContentUnits = read('packages/sdkwork-autocut-smart-cut-engine/src/engine/content-units.ts');
const smartCutEngineSemanticBoundary = read('packages/sdkwork-autocut-smart-cut-engine/src/engine/semantic-boundary.ts');
const smartCutEngineFilterEffects = read('packages/sdkwork-autocut-smart-cut-engine/src/engine/filter-effects.ts');
const tasksService = read('packages/sdkwork-autocut-services/src/service/tasks.service.ts');
const serviceBehaviorCheck = read('scripts/check-autocut-service-behavior.mjs');
const slicerPlannerCheck = read('scripts/check-autocut-slicer-planner.mjs');
assertIncludes(serviceBehaviorCheck, 'moduleLoaderOutRootDir', 'Service behavior check isolates generated module output under a stable root directory');
assertIncludes(serviceBehaviorCheck, 'process.pid', 'Service behavior check uses a process-scoped generated module directory to avoid stale dynamic-import cache collisions');
assertIncludes(serviceBehaviorCheck, 'moduleLoaderOutDirPrepared', 'Service behavior check prepares its generated module directory once per process');
assertIncludes(slicerService, 'getVideoSlicePlanningPolicy', 'Slicer service consumes the canonical smart slice planning policy');
assertIncludes(slicerService, 'reportAutoCutDiagnostic', 'Slicer service emits Smart Slice execution diagnostics to the browser console');
assertIncludes(slicerService, 'createVideoSliceStageDiagnosticPayload', 'Slicer service wraps Smart Slice stage diagnostics without leaking transcript text');
assertIncludes(slicerService, "'slicer.service'", 'Slicer service labels Smart Slice execution diagnostics with a stable console source');
assertIncludes(slicerService, 'planningPolicy', 'Slicer service includes planning policy in the LLM prompt payload');
assertNotIncludes(slicerService, 'requestedClipCount', 'Slicer service never presents Smart Slice as a requested clip-count problem');
assertNotIncludes(slicerService, 'sliceCountMode: planningPolicy.sliceCountMode', 'Slicer service does not prompt the LLM with legacy slice count mode');
assertIncludes(slicerService, 'AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID', 'Slicer service has a canonical Smart Slice segmentation agent fallback for non-UI execution paths');
assertIncludes(slicerService, 'analyzeVideoSlicePlan', 'Slicer service exposes an analyze-only Smart Slice plan endpoint for human review workflows');
assertIncludes(slicerService, 'renderVideoSlicePlan', 'Slicer service exposes a render-selected endpoint for reviewed Smart Slice plans');
assertIncludes(slicerService, 'createAutoCutSliceReviewSessionFromClips', 'Slicer service converts engine clips into a first-class review session');
assertIncludes(slicerService, 'applyAutoCutSliceManualEdits', 'Slicer service applies audited human review edits before selected render');
assertIncludes(clipWorkflow, 'createStudioClipTimelineFromReviewSession', 'Studio clip workflow rebuilds a review-session-backed timeline for the preview surface');
assertIncludes(clipWorkflow, 'createStudioClipFromReviewSegment', 'Studio clip workflow keeps one clip per review segment');
assertIncludes(clipWorkflow, 'preview: {', 'Studio clip workflow exposes preview source boundaries on each StudioClip');
assertIncludes(clipWorkflow, 'sourceStartMs: segment.startMs', 'Studio clip workflow keeps preview start aligned to the review segment start');
assertIncludes(clipWorkflow, 'sourceEndMs: segment.endMs', 'Studio clip workflow keeps preview end aligned to the review segment end');
assertIncludes(clipWorkflow, 'createStudioClipSourceRefs', 'Studio clip workflow centralizes source ref construction for preview and render provenance');
assertIncludes(clipWorkflow, "sourceType: 'content_unit'", 'Studio clip workflow records content-unit provenance on each preview clip');
assertIncludes(clipWorkflow, "sourceType: 'text_segment'", 'Studio clip workflow records transcript-segment provenance on each preview clip');
assertIncludes(clipWorkflow, 'metadata: {', 'Studio clip workflow preserves review-segment provenance metadata on each preview clip');
assertIncludes(slicerPage, 'function createSliceReviewTranscriptTextForSegments', 'SlicerPage centralizes review transcript text derivation from structured segment evidence');
assertIncludes(slicerPage, 'return transcriptSegments', 'SlicerPage derives review transcript text from clipped transcript segments');
assertIncludes(slicerPage, '.replace(/\\s+/gu, \' \')', 'SlicerPage normalizes review transcript whitespace consistently with the service replay path');
assertIncludes(slicerPage, 'createStudioClipTimelineFromReviewSession', 'SlicerPage rebuilds the timeline preview from the review-session model');
assertIncludes(slicerPage, 'createSliceReviewSegmentFromStudioClipBoundaryAdjustment', 'SlicerPage derives corrected review segments from StudioClip boundary edits');
assertIncludes(slicerPage, 'createSliceReviewSpeechRangeForPreview', 'SlicerPage clips review speech ranges with the same timeline boundaries used for preview');
assertIncludes(slicerPage, 'filterSliceReviewTranscriptSegmentsForPreview', 'SlicerPage clips structured transcript evidence with the same timeline boundaries used for preview');
assertNotIncludes(slicerPage, '|| segment.transcriptText', 'SlicerPage does not reuse stale full-segment transcript text after split/correction transcript clipping');
assertIncludes(slicerPage, 'transcriptText: createSliceReviewTranscriptTextForSegments(firstTranscriptSegments)', 'SlicerPage split preview text matches service replay text for the first split segment');
assertIncludes(slicerPage, 'transcriptText: createSliceReviewTranscriptTextForSegments(secondTranscriptSegments)', 'SlicerPage split preview text matches service replay text for the second split segment');
assertIncludes(slicerPage, "transcriptText: correctedTranscriptText || createSliceReviewTranscriptTextForSegments(correctedTranscriptSegments)", 'SlicerPage correction preview text matches service replay text when no manual transcript override is provided');
assertIncludes(slicerService, 'AutoCutSliceRenderSelection', 'Slicer service accepts the typed render-selected review contract');
assertIncludes(slicerService, 'function resolveReviewedSmartSliceRenderableSegmentIds', 'Slicer service centralizes renderable reviewed segment id normalization');
assertIncludes(slicerService, "segment.selected && segment.status === 'selected'", 'Slicer service resolves selected render ids from reviewed segment state rather than trusting raw render selection arrays');
assertIncludes(slicerService, 'const normalizedRenderSelection = {', 'Slicer service creates a normalized render selection contract after validation');
assertIncludes(slicerService, 'selectedSegmentIds: resolveReviewedSmartSliceRenderableSegmentIds(reviewedSession, renderSelection.selectedSegmentIds)', 'Slicer service removes duplicate or non-renderable render-selection ids before persisting task state');
assertNotIncludes(slicerService, 'selectedSegmentIds: renderSelection.selectedSegmentIds', 'Slicer service does not persist raw render-selection ids after validation');
assertNotIncludes(slicerService, 'selectedSegmentIds: [...context.renderSelection.selectedSegmentIds]', 'Slicer service does not write raw context render-selection ids into review evidence');
assertIncludes(slicerService, 'function resolveReviewedSmartSliceDraftSegmentIds', 'Slicer service centralizes draft review segment id normalization');
assertIncludes(slicerService, "segment.selected && segment.status === 'selected'", 'Slicer service persists only selected, non-duplicate ids into review draft state');
assertIncludes(slicerService, 'selectedSegmentIds: resolveReviewedSmartSliceDraftSegmentIds(reviewedSession, renderSelection.selectedSegmentIds)', 'Slicer service removes non-selected ids before persisting review draft state');
assertNotIncludes(slicerService, 'selectedSegmentIds: [...new Set(renderSelection.selectedSegmentIds.filter(Boolean))]', 'Slicer service does not persist raw review draft ids without segment-state normalization');
assertIncludes(slicerService, 'analyzeAutoCutVideoDedup', 'Slicer service calls the shared video dedup component when Smart Slice intelligent dedup is enabled');
assertIncludes(slicerService, "'analyze-duplicates'", 'Slicer service models Smart Slice intelligent dedup as an auditable checkpoint before human review');
assertIncludes(slicerService, 'readAnalyzeDuplicatesCheckpoint', 'Slicer service can resume Smart Slice after the duplicate-analysis checkpoint');
assertIncludes(slicerService, 'SMART_SLICE_DEDUP_REVIEW_RISK_CODE', 'Slicer service marks smart dedup matches as review risks instead of silently deleting semantic content');
assertIncludes(slicerService, 'smartDedupReport', 'Slicer service persists the video dedup report into the Smart Slice review contract');
assertIncludes(slicerService, 'function applyAutoCutSliceDuplicateGroupLinks', 'Slicer service links duplicate group metadata back onto review segments during review-session creation');
assertIncludes(slicerService, 'const segmentsWithDuplicateGroupLinks = applyAutoCutSliceDuplicateGroupLinks(segments, duplicateGroups)', 'Slicer service builds review-session selected ids from duplicate-group-linked segments');
assertIncludes(slicerService, 'duplicateGroupId: duplicateGroup.id', 'Slicer service stores the owning duplicate group id on each review segment');
assertIncludes(slicerService, 'duplicateOfSegmentId: duplicateGroup.keptSegmentId !== segment.id', 'Slicer service stores deterministic duplicate keep targets on non-kept review segments');
assertNotIncludes(slicerService, 'if (duplicateGroups.length === 0)', 'Slicer service still clears stale duplicate links when restore removes every duplicate group');
assertIncludes(serviceBehaviorCheck, 'Smart Slice intelligent dedup runs as a checkpoint before human review when enabled', 'Service behavior check covers the enabled Smart Slice intelligent dedup pipeline');
assertIncludes(serviceBehaviorCheck, 'links smart dedup duplicate groups back onto each review segment', 'Service behavior check covers duplicate group back-links on Smart Slice review segments');
assertIncludes(slicerService, 'segmentationDensity', 'Slicer service diagnostics preserve the selected segmentation density');
assertIncludes(slicerService, 'manualEdit.kind === \'deleteDuplicate\'', 'Slicer service records manual duplicate deletion as an audit edit before rendering');
assertIncludes(slicerService, 'createSmartSliceReviewSegmentIdAliasMap', 'Slicer service tracks review segment id aliases while replaying split, merge, and duplicate-delete manual edits');
assertIncludes(slicerService, 'resolveSmartSliceManualEditSegmentAliases', 'Slicer service resolves manual edit segment ids through replay aliases before applying each edit');
assertIncludes(slicerService, 'const keepSegment = keepSegmentId ? segments.find((segment) => segment.id === keepSegmentId) : undefined', 'Slicer service verifies the manual duplicate keep segment exists before replaying deletion');
assertIncludes(slicerService, 'const duplicateSegmentIds = resolvedManualEdit.segmentIds.filter((segmentId) => segmentId !== keepSegmentId && segments.some((segment) => segment.id === segmentId))', 'Slicer service replays manual duplicate deletion only for existing non-keep segments after resolving split/merge aliases');
assertIncludes(slicerService, 'resolvedManualEdit.segmentIds.length > 1 ? resolvedManualEdit.segmentIds[0] : undefined', 'Slicer service infers a duplicate keep segment only for multi-segment duplicate deletion edits');
assertIncludes(slicerService, 'const externalDuplicateSegmentIds = !keepSegment && !resolvedManualEdit.keepSegmentId && resolvedManualEdit.segmentIds.length === 1', 'Slicer service treats single-segment duplicate deletion as an external smart-dedup removal');
assertIncludes(slicerService, "const duplicateGroupId = `manual-external-duplicate-${manualEdit.id}`", 'Slicer service records external smart-dedup removals with a distinct manual duplicate group id');
assertIncludes(slicerService, 'if (!keepSegment || duplicateSegmentIds.length === 0)', 'Slicer service ignores invalid manual duplicate deletions instead of writing corrupt duplicate groups');
assertNotIncludes(slicerService, "keptSegmentId: keepSegmentId ?? ''", 'Slicer service never writes an empty manual duplicate keptSegmentId');
assertIncludes(slicerService, 'const remainingSegmentIds = group.segmentIds.filter((segmentId) => !restoredSegmentIds.has(segmentId))', 'Slicer service preserves remaining duplicate group members when restoring one segment');
assertIncludes(slicerService, 'keptSegmentId: restoredSegmentIds.has(group.keptSegmentId)', 'Slicer service reassigns duplicate group keptSegmentId when the previous kept segment is restored');
assertNotIncludes(slicerService, '!restoredSegmentIds.has(group.keptSegmentId)', 'Slicer service does not delete an entire duplicate group just because its kept segment was restored');
assertIncludes(slicerService, 'function assertSmartSliceManualEditHasNoDuplicateTargets', 'Slicer service centralizes the duplicate review-segment frozen-state invariant for manual edit replay');
assertIncludes(slicerService, "assertSmartSliceManualEditHasNoDuplicateTargets(segments, resolvedManualEdit, 'select')", 'Slicer service prevents manual select edits from implicitly restoring duplicate review segments');
assertIncludes(slicerService, "assertSmartSliceManualEditHasNoDuplicateTargets(segments, resolvedManualEdit, 'exclude')", 'Slicer service prevents manual exclude edits from erasing duplicate review state');
assertIncludes(slicerService, "assertSmartSliceManualEditHasNoDuplicateTargets(segments, resolvedManualEdit, 'merge')", 'Slicer service prevents manual merge edits from making duplicate review segments renderable');
assertIncludes(slicerService, 'function assertSmartSliceManualMergeTargetsAreAdjacent', 'Slicer service centralizes the manual merge adjacency invariant before replay');
assertIncludes(slicerService, 'assertSmartSliceManualMergeTargetsAreAdjacent(segments, resolvedManualEdit)', 'Slicer service rejects non-adjacent manual merge edits before they can span unreviewed content');
assertIncludes(slicerService, 'restore it before changing render eligibility', 'Slicer service explains that duplicate review segments must be restored before render eligibility can change');
assertIncludes(serviceBehaviorCheck, 'review-edit-merge-selected-with-duplicate-preflight', 'Service behavior check covers duplicate review segments being rejected before merge-and-render replay');
assertIncludes(serviceBehaviorCheck, 'review-edit-merge-non-adjacent-preflight', 'Service behavior check covers non-adjacent merge replay being rejected before it can span unreviewed content');
assertIncludes(serviceBehaviorCheck, 'review-edit-delete-external-smart-dedup-preflight', 'Service behavior check covers single-segment external smart-dedup deletion replay before rendering');
assertIncludes(slicerService, 'const mergedTranscriptSegments = repairLightlyOverlappingVideoSliceTranscriptSegments', 'Slicer service rebuilds transcript evidence when review operators merge adjacent smart slices');
assertIncludes(slicerService, 'const mergedSpeechStartMs = Math.max', 'Slicer service recomputes merged review speech start from all merged segments');
assertIncludes(slicerService, 'const mergedSpeechEndMs = Math.max', 'Slicer service recomputes merged review speech end from all merged segments');
assertIncludes(slicerService, 'speechEndMs: mergedSpeechEndMs', 'Slicer service stores the full merged speech end on manual review merge results');
assertIncludes(slicerService, 'const expandsBeyondSourceClip = segment.startMs < sourceClipStartMs || segment.endMs > sourceClipEndMs', 'Slicer service detects reviewed segments that expand beyond their original source clip evidence');
assertIncludes(slicerService, "reviewedClip.boundaryDecisionSource = 'transcript'", 'Slicer service rebuilds boundary evidence from transcript speech range for review-expanded clips');
assertIncludes(slicerService, 'reviewedClip.audioActivityStartMs = transcriptAudioActivityStartMs', 'Slicer service resets review-expanded clip audio activity start to the reviewed speech boundary');
assertIncludes(slicerService, 'reviewedClip.audioActivityEndMs = transcriptAudioActivityEndMs', 'Slicer service resets review-expanded clip audio activity end to the reviewed speech boundary');
assertIncludes(slicerService, 'reviewedClip.audioActivityConfidence = 0.97', 'Slicer service marks transcript-derived boundary evidence with the canonical deterministic confidence');
assertIncludes(slicerService, 'reviewedClip.audioActivityAnalysisFilter = getSmartSliceRequiredAudioActivityAnalysisFilter', 'Slicer service keeps rebuilt review boundary evidence aligned with the recorded denoise decision');
assertIncludes(serviceBehaviorCheck, 'review-edit-merge-adjacent-speech-range-regression', 'Service behavior check covers legal adjacent review merges preserving full speech and audio activity evidence');
assertIncludes(slicerService, 'reviewedTranscriptText', 'Slicer service projects reviewed transcript text into native render clips');
assertIncludes(slicerService, 'plannedClip?.transcriptSegments', 'Slicer service preserves reviewed structured transcript evidence before falling back to full-source STT transcript segments');
assertNotIncludes(slicerService, 'const sourceTranscriptText = sourceClip.transcriptText', 'Slicer service does not overwrite reviewed transcript text with the original source clip transcript during render projection');
assertIncludes(slicerService, 'selectedSegmentIds', 'Slicer service renders only selected reviewed segment ids');
assertIncludes(slicerService, 'getAutoCutSmartSliceSegmentationAgentDefinition', 'Slicer service normalizes Smart Slice segmentation agents through the canonical registry');
assertIncludes(slicerService, 'isCanonicalSmartCutEngineLlmReview', 'Slicer service detects canonical structured Smart Cut Engine LLM reviews');
assertIncludes(slicerService, 'referencedTimeSliceIds', 'Slicer service validates canonical LLM review time-slice coverage before accepting provider output');
assertIncludes(slicerService, 'referencedSpeakerTurnIds', 'Slicer service validates canonical LLM review speaker-turn coverage before accepting provider output');
assertIncludes(slicerService, 'coversSmartCutEngineSegmentDecisions', 'Slicer service validates canonical segment decisions before accepting provider output');
assertIncludes(slicerService, 'resolveSmartSliceExecutionParams', 'Slicer service resolves complete Smart Slice execution params before validation, checkpointing, and execution');
assertIncludes(slicerService, 'resolveSmartSliceSegmentationAgentId', 'Slicer service centralizes selected Smart Slice segmentation agent normalization');
assertIncludes(slicerService, 'segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId),', 'Slicer service normalizes the Smart Slice segmentation agent before internal planning as a defensive boundary');
assertIncludes(slicerService, 'runtime.defaultSegmentationAgentId', 'Slicer service falls back to the Settings Center default Smart Slice segmentation agent');
assertIncludes(slicerService, '`segmentationAgentId=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.segmentationAgentId)}`', 'Slicer service includes the Smart Slice segmentation agent in failure diagnostics summaries');
assertOccurrenceAtLeast(slicerService, 'segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId)', 2, 'Slicer service serializes and restores a normalized Smart Slice segmentation agent in checkpoints');
assertIncludes(slicerService, 'segmentationAgentId: params.segmentationAgentId', 'Slicer service includes the resolved Smart Slice segmentation agent in planning diagnostics');
assertIncludes(serviceBehaviorCheck, "defaultSegmentationAgentId: 'dialogue-turn-agent'", 'Service behavior check proves Settings Center default segmentation agent drives non-UI Smart Slice execution');
assertIncludes(serviceBehaviorCheck, 'singleSelectionLlmPrompt?.segmentationAgent?.id', 'Service behavior check asserts LLM review receives the resolved segmentation agent from Settings Center');
assertIncludes(serviceBehaviorCheck, 'singleSelectionLlmTask?.executionCheckpoint?.params?.segmentationAgentId', 'Service behavior check asserts Smart Slice checkpoints persist the resolved default segmentation agent');
assertIncludes(smartCutEnginePlanner, 'createSmartCutSpeechFirstExecutionPackage', 'Smart Cut Engine planner builds candidates through the speech-first execution package');
assertIncludes(smartCutEnginePlanner, 'resolveSmartCutEngineMaximumCandidateGapMs', 'Smart Cut Engine planner resolves candidate join gap from segmentation density');
assertIncludes(smartCutEnginePlanner, 'maximumCandidateGapMs', 'Smart Cut Engine planner passes candidate join gap into speech-first candidate construction');
assertIncludes(smartCutEnginePlanner, 'createSmartCutTranscriptEvidence', 'Smart Cut Engine planner converts STT output into canonical transcript evidence before slicing');
assertIncludes(smartCutEnginePlanner, 'createSmartCutSpeakerEvidence', 'Smart Cut Engine planner converts diarized speaker labels into canonical speaker evidence before slicing');
assertIncludes(smartCutEnginePlanner, 'Rank stable candidate ids and reference content unit ids', 'Smart Cut Engine planner constrains LLM review to stable ids');
assertIncludes(smartCutEnginePlanner, 'Never return startMs, endMs, durationMs, or raw timestamps', 'Smart Cut Engine planner forbids model-generated cut timestamps');
assertIncludes(smartCutEnginePlanner, 'segmentationAgent', 'Smart Cut Engine planner passes the selected segmentation agent into ID-only review context');
assertIncludes(smartCutEnginePlanner, 'getAutoCutSmartSliceSegmentationAgentDefinition', 'Smart Cut Engine planner resolves segmentation agents from the canonical registry');
assertIncludes(smartCutEnginePlanner, 'systemPrompt', 'Smart Cut Engine planner injects auditable segmentation agent system prompts into LLM review');
assertIncludes(smartCutEnginePlanner, "segmentationAgent.id === 'dialogue-turn-agent'", 'Smart Cut Engine planner lets the selected dialogue segmentation agent drive Q/A slicer routing');
assertIncludes(smartCutEnginePlanner, "segmentationAgent.id === 'teaching-step-agent'", 'Smart Cut Engine planner lets the selected teaching segmentation agent drive instructional slicer routing');
assertLineOrder(smartCutEnginePlanner, "mode === 'commerce-live'", "if (segmentationAgent.id === 'dialogue-turn-agent')", 'Smart Cut Engine planner resolves explicit industry slice modes before default dialogue segmentation-agent routing');
assertIncludes(smartCutEnginePlanner, 'createSmartCutEngineLlmReviewCandidatePayload', 'Smart Cut Engine planner serializes candidate-level speaker evidence into LLM review context');
assertIncludes(smartCutEnginePlanner, "SMART_CUT_LLM_REVIEW_SCHEMA_VERSION = 'smart-cut-llm-review/v1'", 'Smart Cut Engine planner owns a versioned LLM review contract');
assertIncludes(smartCutEnginePlanner, 'inputContract', 'Smart Cut Engine planner sends a structured LLM input contract');
assertIncludes(smartCutEnginePlanner, 'outputContract', 'Smart Cut Engine planner sends a structured LLM output contract');
assertIncludes(smartCutEnginePlanner, 'allowedOutputIds', 'Smart Cut Engine planner constrains model output to explicit stable id whitelists');
assertIncludes(smartCutEnginePlanner, 'forbiddenOutputFields', 'Smart Cut Engine planner explicitly forbids raw timestamp fields in model output');
assertIncludes(smartCutEnginePlanner, 'createSmartCutEngineLlmReviewTimeSlices', 'Smart Cut Engine planner serializes time slices as engine-owned evidence ids');
assertIncludes(smartCutEnginePlanner, 'createSmartCutEngineLlmReviewSpeakerCatalog', 'Smart Cut Engine planner serializes speaker catalog evidence for LLM review');
assertIncludes(smartCutEnginePlanner, 'createSmartCutEngineLlmReviewSpeakerTurns', 'Smart Cut Engine planner serializes speaker turns for dialogue-aware LLM review');
assertIncludes(smartCutEnginePlanner, 'segmentDecisionSchema', 'Smart Cut Engine planner requires structured segment decisions from the model');
assertIncludes(smartCutEnginePlanner, 'dialogueTurnContinuity', 'Smart Cut Engine planner labels dialogue candidate continuity before LLM ranking');
assertIncludes(smartCutEnginePlanner, 'speakerTurnIds', 'Smart Cut Engine planner exposes speaker turn ids as first-class dialogue evidence');
assertIncludes(smartCutEnginePlanner, 'speakerConfidence', 'Smart Cut Engine planner exposes diarization confidence for dialogue auditability');
assertIncludes(smartCutEnginePlanner, 'orphan answers', 'Smart Cut Engine dialogue agent rules reject answers without question or context');
assertIncludes(smartCutEnginePlanner, 'speakerIds and speakerRoles', 'Smart Cut Engine dialogue agent rules require speaker evidence reasoning');
assertIncludes(smartCutEngineLlmReview, 'LLM_RAW_TIME_RANGE_REJECTED', 'Smart Cut Engine LLM review rejects raw timestamp ranges');
assertIncludes(smartCutEngineLlmReview, 'LLM_UNKNOWN_CANDIDATE_ID', 'Smart Cut Engine LLM review rejects unknown candidate ids');
assertIncludes(smartCutEngineLlmReview, 'LLM_UNKNOWN_UNIT_ID', 'Smart Cut Engine LLM review rejects unknown content unit ids');
assertIncludes(smartCutEngineLlmReview, 'LLM_UNKNOWN_TIME_SLICE_ID', 'Smart Cut Engine LLM review rejects unknown time slice ids');
assertIncludes(smartCutEngineLlmReview, 'LLM_UNKNOWN_SPEAKER_ID', 'Smart Cut Engine LLM review rejects unknown speaker ids');
assertIncludes(smartCutEngineLlmReview, 'LLM_UNKNOWN_SPEAKER_TURN_ID', 'Smart Cut Engine LLM review rejects unknown speaker turn ids');
assertIncludes(smartCutEngineLlmReview, 'readSegmentDecisions', 'Smart Cut Engine LLM review normalizes structured segment decisions');
assertIncludes(smartCutEngineLlmReview, 'referencedTimeSliceIds', 'Smart Cut Engine LLM review evidence preserves referenced time slice ids');
assertIncludes(smartCutEngineLlmReview, 'referencedSpeakerTurnIds', 'Smart Cut Engine LLM review evidence preserves referenced speaker turn ids');
assertIncludes(slicerService, 'idealDurationMs: planningPolicy.idealDurationMs', 'Slicer service prompts the LLM with the ideal duration');
assertIncludes(slicerService, 'continuityJoinGapMs: planningPolicy.continuityJoinGapMs', 'Slicer service prompts the LLM with the continuity join gap');
assertIncludes(slicerService, 'continuityOverlapToleranceMs: planningPolicy.continuityOverlapToleranceMs', 'Slicer service prompts the LLM with the STT overlap tolerance used by deterministic transcript repair');
assertIncludes(smartCutEnginePlanner, 'customKeywords', 'Smart Cut Engine planner receives custom keyword policy context');
assertIncludes(smartCutEngineContentUnits, 'continuityScore', 'Smart Cut Engine content units carry continuity scores before candidate review');
assertIncludes(smartCutEngineContentUnits, 'completenessScore', 'Smart Cut Engine content units carry semantic completeness scores before candidate review');
assertIncludes(smartCutEngineContentUnits, 'publishabilityScore', 'Smart Cut Engine content units carry publishability scores before candidate review');
assertIncludes(smartCutEngineSemanticBoundary, 'LOW_CONTENT_UNIT_COMPLETENESS', 'Smart Cut Engine validates semantic boundary completeness before filters');
assertIncludes(smartCutEngineFilterEffects, 'Post-slice filters may trim media noise but must not delete approved semantic units', 'Smart Cut Engine filters are constrained to preserve approved semantic units');
assertIncludes(slicerService, 'resolveTrustedVideoSliceSourceDurationMs', 'Slicer service uses only trusted imported media duration for source-bounded planning');
assertRule(
  !slicerService.includes('resolveTranscriptPlanningDurationMs'),
  'Slicer service does not treat transcript end time as authoritative source media duration',
);
assertIncludes(slicerService, 'sourceDurationMs: sourceMedia.durationMs', 'Slicer service passes trusted source media duration into smart slice planning');
assertIncludes(
  slicerService,
  "workflowPurpose: 'smart-slice-transcript-evidence'",
  'Slicer service marks its speech-to-text task as internal Smart Slice transcript evidence instead of a user text-extraction task',
);
assertIncludes(
  slicerService,
  'SMART_SLICE_EXECUTION_STEPS',
  'Slicer service uses a canonical Smart Slice execution step plan instead of scattered progress literals',
);
assertIncludes(
  slicerService,
  'reportSmartSliceExecutionPlan',
  'Slicer service logs the full Smart Slice execution plan to the console before long-running work starts',
);
assertIncludes(
  slicerService,
  'runSmartSliceExecutionStep',
  'Slicer service wraps each Smart Slice stage with progress updates and console diagnostics',
);
assertIncludes(
  slicerService,
  'runSmartSliceLongRunningExecutionStep',
  'Slicer service wraps long Smart Slice stages so local STT progress stays observable',
);
assertIncludes(
  slicerService,
  'startSmartSliceLongRunningStageProgressMonitor',
  'Slicer service observes native progress events while local STT is still running',
);
assertIncludes(
  slicerService,
  'createSmartSliceLongRunningStageProgressMessage',
  'Slicer service publishes elapsed-time progress messages from native STT progress events',
);
assertIncludes(
  slicerService,
  'createAutoCutRelativeTimestampMs',
  'Slicer service delegates long-running Smart Slice elapsed-time measurement to the shared timing helper',
);
assertRule(
  !slicerService.includes('progress: 35'),
  'Slicer service no longer regresses Smart Slice task progress to 35 percent during speech-to-text',
);
assertIncludes(
  slicerService,
  "'verify-artifacts'",
  'Slicer service validates native slice and subtitle artifacts in a dedicated Smart Slice verification stage before persisting results',
);
assertRule(
  slicerService.indexOf('assertNativeSliceArtifactsMatchPlan') < slicerService.indexOf('finishVideoSliceTask(completedTask, verifiedSliceResults.sliceResults)'),
  'Slicer service validates native slice and subtitle artifacts before persisting smart slice results',
);
assertIncludes(
  slicerService,
  'assertNativeSliceAudioCleanupMetadataMatchesPlan',
  'Slicer service validates native render returned post-cut denoise, audio-activity, silence-trim, and tail-treatment evidence',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceBoolean(nativeSlice.noiseReductionApplied',
  'Slicer service validates native post-cut noise-reduction evidence without forcing it to reuse planning metadata',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceMilliseconds(nativeSlice.audioActivityStartMs',
  'Slicer service validates native post-cut audioActivityStartMs evidence shape',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceMilliseconds(nativeSlice.audioActivityEndMs',
  'Slicer service validates native post-cut audioActivityEndMs evidence shape',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceConfidence(nativeSlice.audioActivityConfidence',
  'Slicer service validates native post-cut audioActivityConfidence evidence shape',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceAudioActivityAnalysisFilter(nativeSlice, sliceNumber)',
  'Slicer service validates native post-cut audioActivityAnalysisFilter against the actual cleanup denoise decision',
);
assertIncludes(
  slicerService,
  'audioActivityAnalysisFilter must match the post-cut cleanup noise reduction decision',
  'Slicer service rejects native post-cut audio analysis filters that do not match the artifact cleanup decision',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceMilliseconds(nativeSlice.leadingSilenceMs',
  'Slicer service validates native post-cut leadingSilenceMs evidence shape',
);
assertIncludes(
  slicerService,
  'assertOptionalNativeSliceMilliseconds(nativeSlice.trailingSilenceMs',
  'Slicer service validates native post-cut trailingSilenceMs evidence shape',
);
assertIncludes(
  slicerService,
  'fallbackNoiseReductionApplied: SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED',
  'Slicer service reads the canonical fallback denoise decision from the professional smart-slice standard',
);
assertIncludes(
  slicerService,
  "typeof sliceResult.noiseReductionApplied !== 'boolean'",
  'Slicer service rejects completed smart-slice results unless the real noise-reduction decision was recorded before boundary cleanup',
);
assertIncludes(
  slicerService,
  'noise reduction decision evidence',
  'Slicer service reports missing noise-reduction decision evidence as a professional completion-gate failure',
);
assertIncludes(
  slicerService,
  'assertNativeSliceTimingMatchesPlan',
  'Slicer service rejects native slice artifacts whose timing differs from the intelligent plan',
);
assertIncludes(
  slicerService,
  'assertNativeSlicePathInsideTaskOutputDir',
  'Slicer service rejects native slice artifacts outside their task output directory',
);
assertIncludes(
  slicerService,
  'assertNativeSliceThumbnailPathInsideCoverDir',
  'Slicer service requires native smart-slice thumbnails to live in the dedicated task cover directory',
);
assertIncludes(
  slicerService,
  'assertNativeSliceTaskOutputDirMatchesResult',
  'Slicer service rejects native slice artifacts whose taskOutputDir differs from the native result output directory',
);
assertIncludes(
  slicerService,
  'nativeSlice.startMs !== plannedClip.startMs || nativeSlice.durationMs !== expectedDurationMs',
  'Slicer service compares native slice start and rendered duration against each planned clip',
);
assertIncludes(
  slicerService,
  'expectedSourceSegments.reduce',
  'Slicer service validates silence-compacted native durations against retained source segments',
);
assertIncludes(
  slicerService,
  'thumbnailArtifactPath',
  'Slicer service requires thumbnail artifact paths before building smart slice preview results',
);
assertIncludes(
  slicerService,
  'assertPositiveNativeSliceNumber(nativeSlice.byteSize',
  'Slicer service rejects native smart slice artifacts with invalid byte sizes',
);
assertIncludes(
  tasksService,
  'createNativeVideoSliceProjection',
  'Tasks service uses a dedicated native smart-slice projection contract',
);
assertIncludes(
  tasksService,
  'assertAndMapNativeSliceResult',
  'Tasks service validates native smart-slice artifacts during task recovery',
);
assertIncludes(
  tasksService,
  'createInvalidNativeVideoSliceProjection',
  'Tasks service fails closed when completed native smart-slice task output is invalid',
);
assertIncludes(
  tasksService,
  'enforceRecoveredNativeVideoSliceProfessionalTranscriptEvidence',
  'Tasks service revalidates recovered native smart-slice transcript evidence after sidecar metadata merging',
);
assertIncludes(
  tasksService,
  'missing speech-to-text transcript evidence',
  'Tasks service fails closed when recovered native smart-slice artifacts have no speech-to-text evidence',
);
assertIncludes(
  tasksService,
  'assertRecoveredNativeVideoSliceAudioCleanupEvidence',
  'Tasks service revalidates recovered native smart-slice audio cleanup evidence after sidecar metadata merging',
);
assertIncludes(
  tasksService,
  'audioCleanupProfile: RECOVERED_SMART_SLICE_AUDIO_CLEANUP_PROFILE',
  'Tasks service uses the canonical smart-slice audio cleanup profile for recovered native task validation',
);
assertIncludes(
  tasksService,
  'rawAudioActivityAnalysisFilter: RECOVERED_SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER',
  'Tasks service validates recovered raw-audio boundary evidence when broadband denoise was skipped',
);
assertIncludes(
  tasksService,
  'acceptedBoundaryDecisionSources: RECOVERED_SMART_SLICE_ACCEPTED_BOUNDARY_DECISION_SOURCES',
  'Tasks service uses canonical recovered smart-slice boundary decision sources',
);
assertIncludes(
  tasksService,
  'acceptedTailTreatments: RECOVERED_SMART_SLICE_ACCEPTED_TAIL_TREATMENTS',
  'Tasks service uses canonical recovered smart-slice tail treatment values',
);
assertIncludes(
  tasksService,
  'missing smart-slice audio cleanup evidence',
  'Tasks service fails closed when recovered native smart-slice audio cleanup evidence is missing',
);
assertIncludes(
  tasksService,
  'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD',
  'Tasks service uses the canonical smart-slice professional standard contract',
);
assertIncludes(
  tasksService,
  'maxTrailingSilenceMs: MAX_RECOVERED_SMART_SLICE_TRAILING_SILENCE_MS',
  'Tasks service enforces the recovered native smart-slice trailing silence limit',
);
assertIncludes(
  tasksService,
  'minTranscriptCoverageScore: MIN_RECOVERED_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE',
  'Tasks service enforces the recovered native smart-slice transcript coverage threshold',
);
assertIncludes(
  tasksService,
  'speechContinuityGrade to be strong or repaired',
  'Tasks service rejects recovered native smart-slice artifacts with weak speech continuity',
);
assertIncludes(
  tasksService,
  'transcript segment ${segmentNumber} is outside its rendered source range',
  'Tasks service rejects recovered native smart-slice transcript segments outside rendered source ranges',
);
assertIncludes(
  tasksService,
  'snapshot.status !== OPS_STATUS_COMPLETED',
  'Tasks service projects native smart-slice result fields only after native completion',
);
assertIncludes(
  tasksService,
  'assertPositiveNativeSliceCount',
  'Tasks service requires a positive native smart-slice count before projecting recovered results',
);
assertIncludes(
  tasksService,
  'sourceFileId: baseProjection.sourceFileId',
  'Tasks service keeps source asset diagnostics when native smart-slice recovery fails closed',
);
assertIncludes(
  tasksService,
  'declared slices',
  'Tasks service explains recovered native smart-slice count mismatches',
);
assertIncludes(
  tasksService,
  'thumbnailArtifactPath',
  'Tasks service requires recovered native smart-slice thumbnail artifact paths',
);
assertIncludes(
  tasksService,
  'assertPositiveNativeSliceNumber(slice.byteSize',
  'Tasks service rejects recovered native smart-slice artifacts with invalid byte sizes',
);
assertIncludes(
  tasksService,
  'assertNativeSlicePathInsideTaskOutputDir',
  'Tasks service rejects recovered native smart-slice artifacts outside their task output directory',
);
assertIncludes(
  tasksService,
  'assertNativeSliceThumbnailPathInsideCoverDir',
  'Tasks service rejects recovered native smart-slice thumbnails outside the dedicated task cover directory',
);
assertRule(
  !tasksService.includes('.filter((slice): slice is TaskSliceResult => Boolean(slice))'),
  'Tasks service does not silently filter corrupt native smart-slice artifacts during recovery',
);
assertIncludes(slicerService, 'storyShape: plannedClip.storyShape', 'Slicer service preserves hook-context-payoff story-shape metadata on slice results');
assertIncludes(smartCutEngineSemanticBoundary, 'DANGLING_CONNECTOR_BOUNDARY', 'Smart Cut Engine blocks candidates that start or end on dangling connector words');
assertIncludes(smartCutEngineSemanticBoundary, 'QUESTION_WITHOUT_ANSWER', 'Smart Cut Engine blocks dialogue candidates that include questions without answers');
assertIncludes(smartCutEngineSemanticBoundary, 'ANSWER_WITHOUT_QUESTION', 'Smart Cut Engine blocks dialogue answers without question context');
assertIncludes(smartCutEngineSemanticBoundary, 'Reject raw time-only candidates and rebuild using stable content unit ids.', 'Smart Cut Engine requires content-unit ids instead of raw timing windows');
assertIncludes(slicerPlanningKernel, 'createNormalizedSliceTimingMetadata', 'Slicer planner centralizes source and speech timing metadata repair');
assertIncludes(slicerPlanningKernel, 'timing-metadata-repaired', 'Slicer planner records repaired dirty timing metadata for quality review');
assertIncludes(slicerPlanningKernel, 'filterRepeatedTranscriptCandidates', 'Slicer planner removes repeated speech-to-text candidate windows before LLM planning');
assertIncludes(slicerPlanningKernel, 'areTranscriptSliceClipsRepeated', 'Slicer planner owns transcript text repeat detection for smart slicing');
assertIncludes(slicerPlanningKernel, 'normalizeTranscriptTextForRepeatDetection', 'Slicer planner normalizes transcript text before duplicate detection');
assertIncludes(slicerPlanningKernel, 'normalizeTranscriptSegmentTextForPlanning', 'Slicer planner normalizes speech-to-text filler-heavy segment text before smart slice planning');
assertIncludes(slicerPlanningKernel, 'isLowInformationTranscriptFillerSegment', 'Slicer planner drops pure filler speech-to-text segments before building candidate windows');
assertIncludes(autocutTypes, 'AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_PREFIX_PATTERN', 'AutoCut types owns the shared filler-prefix cleanup rules for transcript evidence');
assertIncludes(autocutTypes, 'AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_TOKEN_PATTERN', 'AutoCut types owns the shared low-information filler token detection for transcript evidence');
assertIncludes(slicerPlanningKernel, 'normalizeAutoCutTranscriptEvidenceText', 'Slicer planner reuses the shared transcript evidence normalization standard');
assertIncludes(slicerPlanningKernel, 'isLowInformationAutoCutTranscriptEvidenceText', 'Slicer planner reuses the shared low-information transcript evidence standard');
assertIncludes(speechTranscriptionService, 'isLowInformationAutoCutTranscriptEvidenceText', 'Speech transcription normalization reuses the shared low-information transcript evidence standard');
assertIncludes(slicerPlanningKernel, 'normalizeTranscriptSliceLabelText', 'Slicer planner sanitizes transcript-derived clip titles before file naming');
assertIncludes(slicerPlanningKernel, '/[\\p{L}\\p{N}]/u.test(normalizedText)', 'Slicer planner rejects punctuation-only transcript-derived clip titles');
assertIncludes(slicerPlanningKernel, 'const fallbackLabel = matchedCandidate?.label ?? createPlannerSliceLabel(index)', 'Slicer planner falls back to transcript candidate labels when model titles are unusable');
assertIncludes(slicerPlanningKernel, 'const title = normalizeTranscriptSliceLabelText(normalizePlanText(clip?.title, 48) ?? label, label)', 'Slicer planner sanitizes LLM-derived clip titles before output file naming');
assertIncludes(slicerPlanningKernel, 'calculateTranscriptTokenOverlapScore', 'Slicer planner detects high-overlap repeated transcript windows beyond exact substrings');
assertIncludes(slicerPlanningKernel, 'firstTokens.length < 2', 'Slicer planner still evaluates short one-sentence transcript windows for repeat filtering');
assertIncludes(slicerPlanningKernel, 'containmentScore >= 0.9', 'Slicer planner requires high-containment evidence before removing short transcript near-duplicates');
assertIncludes(slicerPlanningKernel, "replace(/(?:ing|ed|es|s)$/u, '')", 'Slicer planner normalizes simple English inflections before transcript repeat filtering');
assertIncludes(slicerPlanningKernel, 'extractTranscriptRepeatTokens', 'Slicer planner tokenizes transcript text for robust repeat filtering');
assertIncludes(slicerPlanningKernel, 'selectOptimalSliceCandidateSet', 'Slicer planner globally optimizes candidate combinations instead of relying on greedy single-clip ranking');
assertIncludes(slicerPlanningKernel, 'calculateSliceCandidateSetScore', 'Slicer planner scores whole candidate sets for dynamic STT slice planning');
assertIncludes(slicerPlanningKernel, 'compareSliceCandidateSets', 'Slicer planner compares full non-overlapping candidate sets before selecting final smart slices');
assertIncludes(slicerPlanningKernel, 'selectNaturalStrongContentDerivedCandidatePlan', 'Slicer planner publishes every strong continuous content-derived story without a fixed target clip count');
assertIncludes(slicerPlanningKernel, 'selectContentDerivedCandidateOutputPool', 'Slicer planner keeps complete semantic stories out of bounded review-pool truncation');
assertIncludes(slicerPlanningKernel, 'createContentTopicSegmentCandidates', 'Slicer planner builds lecture-style content topic clips from multiple ASR transcript segments');
assertIncludes(slicerPlanningKernel, 'content-topic-segment', 'Slicer planner records content-topic segmentation evidence for task detail review');
assertNotIncludes(slicerPlanningKernel, 'MAX_CONTENT_DERIVED_SLICE_COUNT', 'Slicer planner has no fixed content-derived release clip-count cap');
assertIncludes(slicerPlanningKernel, 'transcript-repeat-filtered', 'Slicer planner preserves repeat-filter audit metadata on candidate windows and results');
assertIncludes(slicerPlanningKernel, 'transcript-overlap-repaired', 'Slicer planner preserves tiny STT overlap repair audit metadata on candidate windows and results');
assertIncludes(slicerPlanningKernel, 'NON_PUBLISHABILITY_PENALTY_RISKS', 'Slicer planner keeps repaired/audit-only transcript risks visible without over-penalizing publishability');
assertIncludes(slicerPlanningKernel, "'short-video'", 'Slicer planner groups English short-video STT keywords for topic coherence scoring');
assertIncludes(slicerService, 'const renderProfile = createVideoSliceRenderProfile(planningPolicy)', 'Slicer service creates the smart publishing render profile from planning policy');
assertIncludes(slicerService, 'renderProfile }', 'Slicer service passes the smart publishing render profile into native slicing');
assertIncludes(slicerService, 'createVideoSliceSubtitleRequest', 'Slicer service centralizes subtitle-mode projection into native slicing');
assertIncludes(slicerService, 'shouldGenerateVideoSliceSubtitles', 'Slicer service separates required STT planning from optional subtitle rendering');
assertIncludes(slicerService, 'params.enableSubtitles === true', 'Slicer service only requests native subtitle rendering after explicit user opt-in');
assertIncludes(slicerService, "subtitleMode === 'srt'", 'Slicer service preserves SRT-only subtitle publishing when enabled');
assertIncludes(
  slicerService,
  "if (params.enableSubtitles === true && params.subtitleMode === 'none')",
  'Slicer service fails closed when the UI or caller sends contradictory subtitle enablement parameters',
);
assertIncludes(slicerService, 'assertNativeSliceSubtitleArtifactMatchesRequest', 'Slicer service validates native subtitle artifacts against the explicit subtitle request');
assertIncludes(
  slicerService,
  'subtitle artifact was returned even though subtitle rendering was not requested',
  'Slicer service rejects unrequested native subtitle sidecars when subtitles are disabled',
);
assertIncludes(
  slicerService,
  'is missing the requested SRT subtitle artifact',
  'Slicer service fails closed if enabled SRT subtitle rendering does not return sidecar artifacts',
);
assertIncludes(
  slicerService,
  "subtitleRequest.subtitleFormat === 'srt' &&\n    requestedSubtitleMode !== 'none'",
  'Slicer service requires editable SRT sidecars for SRT, burned, and combined subtitle rendering modes',
);
assertIncludes(
  slicerService,
  'Smart slicing requires successful speech-to-text transcription before planning clips',
  'Slicer service fails closed when required STT is unavailable before planning',
);
assertRule(
  !slicerService.includes('transcriptSegments.slice(0, 80)'),
  'Slicer service does not prompt the LLM with only the first transcript segments for long videos',
);
assertIncludes(slicerService, 'outputFileName: createPlannedSliceOutputFileName(renderClip)', 'Slicer service sends semantic title-based file names into native smart slicing');
assertIncludes(slicerService, "clip?.title ?? clip?.label", 'Slicer service prefers AI or transcript-derived titles when naming generated slice files');
assertIncludes(slicerService, 'createAutoCutSafeFileNameStem', 'Slicer service sanitizes generated slice file names before native rendering');

const homePage = read('packages/sdkwork-autocut-home/src/pages/HomePage.tsx');
assertIncludes(homePage, 'sourceUrlInput', 'HomePage stores the external source URL input value');
assertIncludes(homePage, 'handleSubmitSourceUrl', 'HomePage routes external source URL submissions through one handler');
assertIncludes(homePage, 'encodeURIComponent(sourceUrlInput.trim())', 'HomePage preserves the submitted external source URL in navigation');
assertIncludes(homePage, 'value={sourceUrlInput}', 'HomePage controls the external source URL input value');
assertIncludes(homePage, 'listenAutoCutI18nLanguageChanged', 'HomePage subscribes to i18next language changes for visible text');
assertIncludes(homePage, 't(tool.nameKey', 'HomePage resolves tool names during render so language changes update immediately');
assertIncludes(homePage, 't(tool.descriptionKey', 'HomePage resolves tool descriptions during render so language changes update immediately');

const assetsPage = read('packages/sdkwork-autocut-assets/src/pages/AssetsPage.tsx');
assertIncludes(assetsPage, 'searchQuery', 'AssetsPage stores an asset search query');
assertMatches(assetsPage, /setSearchQuery\s*\(/u, 'AssetsPage updates the asset search query from the search input');
assertMatches(assetsPage, /filteredAssets\s*=\s*assets\.filter[\s\S]*searchQuery/u, 'AssetsPage filters visible assets by the search query');
assertIncludes(assetsPage, 'createAssetFolder', 'AssetsPage creates folders through the assets service');
assertIncludes(assetsPage, 'handleCreateFolder', 'AssetsPage has a folder creation workflow handler');
assertIncludes(assetsPage, 'handleOpenAsset', 'AssetsPage has an asset preview/open workflow handler');
assertIncludes(assetsPage, 'handleDownloadAsset', 'AssetsPage has an asset download workflow handler');
assertIncludes(assetsPage, 'refreshAssetsWorkspace', 'AssetsPage refreshes assets and storage through one workspace workflow');
assertIncludes(assetsPage, 'getStorageInfo().then(setStorageInfo)', 'AssetsPage refreshes storage information from the assets service');
assertIncludes(assetsPage, 'Download', 'AssetsPage imports a download icon for asset download actions');
assertIncludes(assetsPage, '<Download size={16}', 'AssetsPage uses a download icon for asset download actions');
assertRule(!assetsPage.includes('<MoreVertical size={16}'), 'AssetsPage does not use a menu icon for direct download actions');

assertIncludes(tasksPage, 'handleOpenTaskDetail', 'TasksPage wires the row detail button to an explicit open-detail workflow handler');
assertMatches(tasksPage, /handleOpenTaskDetail\([^)]*task\.id/u, 'TasksPage detail handler receives the selected task id');
assertIncludes(tasksPage, 'ArrowRight', 'TasksPage imports a direct navigation icon for detail actions');
assertIncludes(tasksPage, '<ArrowRight size={16}', 'TasksPage uses a direct navigation icon for detail actions');
assertRule(!tasksPage.includes('handleOpenTaskActions'), 'TasksPage does not name direct detail navigation as a generic actions menu');
assertRule(!tasksPage.includes('<MoreHorizontal size={16}'), 'TasksPage does not use a menu icon for direct detail navigation');
assertIncludes(tasksPage, 'selectedTaskIds', 'TasksPage stores canonical multi-select state for batch task operations');
assertIncludes(tasksPage, 'selectedTasks', 'TasksPage derives selected task records before rendering bulk actions');
assertIncludes(tasksPage, 'handleToggleTaskSelection', 'TasksPage owns a dedicated task row selection handler');
assertIncludes(tasksPage, 'handleToggleVisibleTaskSelection', 'TasksPage can select or clear every task in the current filtered view');
assertIncludes(tasksPage, 'handleBulkDeleteTasks', 'TasksPage owns a dedicated bulk delete workflow handler');
assertIncludes(tasksPage, 'handleBulkCancelTasks', 'TasksPage owns a dedicated status-aware bulk cancel workflow handler');
assertIncludes(tasksPage, 'handleBulkRetryTasks', 'TasksPage owns a dedicated status-aware bulk retry workflow handler');
assertIncludes(tasksPage, 'deleteTasks', 'TasksPage delegates bulk task deletion to the task service instead of looping UI-side deletes');
assertIncludes(tasksPage, 'cancelTasks', 'TasksPage delegates bulk task cancellation to the task service instead of mutating UI-side state');
assertIncludes(tasksPage, 'retryTasks', 'TasksPage delegates bulk task retry to the task service instead of mutating UI-side state');
assertIncludes(tasksPage, 'activeSelectedTaskIds', 'TasksPage derives active selected task ids for status-aware cancellation');
assertIncludes(tasksPage, 'failedSelectedTaskIds', 'TasksPage derives failed selected task ids for status-aware retry');
assertIncludes(tasksPage, 'aria-label="Select task"', 'TasksPage exposes accessible per-row task selection checkboxes');
assertIncludes(tasksPage, 'aria-label="Select visible tasks"', 'TasksPage exposes an accessible current-view select-all checkbox');
assertIncludes(tasksPage, 'aria-label="Cancel active selected tasks"', 'TasksPage renders an accessible compact bulk cancel command for active selected tasks');
assertIncludes(tasksPage, 'aria-label="Retry failed selected tasks"', 'TasksPage renders an accessible compact bulk retry command for failed selected tasks');
assertIncludes(tasksPage, 'aria-label="Delete selected tasks"', 'TasksPage renders an accessible compact bulk delete command');
assertIncludes(tasksPage, 'aria-label="Clear task selection"', 'TasksPage renders an accessible compact clear-selection command');
assertIncludes(tasksPage, 'aria-label="Selected task bulk actions"', 'TasksPage renders selected-task bulk actions inside the compact toolbar');
assertRule(
  tasksPage.indexOf('aria-label="Selected task bulk actions"') !== -1 &&
    tasksPage.indexOf('aria-label="Select visible tasks"') !== -1 &&
    tasksPage.indexOf('aria-label="Selected task bulk actions"') > tasksPage.indexOf('aria-label="Select visible tasks"') &&
    tasksPage.indexOf('aria-label="Selected task bulk actions"') < tasksPage.indexOf('Type</span>'),
  'TasksPage renders selected-task bulk actions in the same toolbar row instead of adding a second header row',
);
assertRule(!tasksPage.includes('justify-between gap-3 rounded-md border border-blue-500/20'), 'TasksPage does not add a second header row when tasks are selected');
assertRule(!tasksPage.includes('rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2'), 'TasksPage does not render a full-width selected-task banner');
assertIncludes(tasksPage, 'formatAutoCutDateTime', 'TasksPage imports the canonical local datetime formatter for task timestamps');
assertIncludes(tasksPage, 'formatAutoCutDateTime(task.createdAt)', 'TasksPage renders task row creation time through the canonical local datetime formatter');
assertRule(!tasksPage.includes('<Clock size={12} /> {task.createdAt}'), 'TasksPage does not render raw UTC/native task timestamps in the task row');
assertIncludes(tasksPage, 'Task queue', 'TasksPage uses a compact workbench title instead of a large page hero');
assertIncludes(tasksPage, 'min-h-0 p-4 md:p-5', 'TasksPage keeps the task center page chrome compact');
assertIncludes(tasksPage, 'border-b border-[#222] px-3 py-2', 'TasksPage renders a compact toolbar header');
assertIncludes(tasksPage, 'aria-label="Task status filter"', 'TasksPage exposes the compact status filter as a toolbar control');
assertRule(
  tasksPage.indexOf('aria-label="Task status filter"') !== -1 &&
    tasksPage.indexOf('Task queue') !== -1 &&
    tasksPage.indexOf('aria-label="Task status filter"') < tasksPage.indexOf('Task queue'),
  'TasksPage keeps the status tabs as the leftmost toolbar control before the queue title',
);
assertIncludes(tasksPage, 'AUTOCUT_TASK_STATUS.pending', 'TasksPage exposes pending workflow status in the compact filter tabs');
assertIncludes(tasksPage, 'isAutoCutTaskActiveStatus', 'TasksPage uses the canonical active-status predicate for bulk cancel selection');
assertIncludes(tasksPage, 'ml-auto', 'TasksPage pushes secondary toolbar actions away from the left-aligned status tabs');
assertRule(!tasksPage.includes('Track every processing task from one canonical queue.'), 'TasksPage does not spend vertical space on descriptive hero copy');
assertRule(!tasksPage.includes('text-2xl font-bold'), 'TasksPage does not use hero-sized typography in the task workbench header');
assertRule(!tasksPage.includes('space-y-8'), 'TasksPage avoids large vertical gaps above the task list');
assertRule(!tasksPage.includes('pb-6'), 'TasksPage avoids oversized header bottom padding');
assertIncludes(slicerPage, 'formatAutoCutTimeOfDay(task.createdAt)', 'SlicerPage task side list renders task creation time through the canonical local time-of-day formatter');
assertRule(!slicerPage.includes("task.createdAt.split(' ')[1]"), 'SlicerPage task side list does not split raw task timestamps');

const taskDetailPage = read('packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx');
const taskDetailCommercialResultPanel = extractBetween(
  taskDetailPage,
  'function TaskDetailCommercialResultPanel',
  'export function TaskDetailPage',
);
const smartSliceReviewRiskCatalogCodes = extractSmartSliceReviewRiskCatalogCodes(autocutTypes);
const smartSliceReviewRiskCatalogEntries = extractSmartSliceReviewRiskCatalogEntries(autocutTypes);
assertIncludes(autocutTypes, 'sourceTaskId?: string', 'AppAsset records the source task id for generated assets');
assertIncludes(autocutTypes, 'sourceTaskType?: TaskType', 'AppAsset records the source task type for generated assets');
assertIncludes(autocutTypes, 'generatedAssetIds?: string[]', 'AppTask records generated asset ids for task result traceability');
assertIncludes(taskDetailPage, 'REPROCESS_ROUTES: Record<TaskType, string>', 'TaskDetailPage keeps a typed reprocess route map');
assertNotIncludes(taskDetailPage, "navigate('/assets')", 'TaskDetailPage does not expose a redundant assets-page shortcut from the simplified detail header');
assertIncludes(taskDetailPage, "t('taskDetail.header.processAgain')", 'TaskDetailPage keeps a reusable process-again action in the simplified header');
assertIncludes(taskDetailPage, 'downloadTaskExecutionResultFile', 'TaskDetailPage can export fallback task execution results');
assertIncludes(taskDetailPage, 'TaskFailureState', 'TaskDetailPage renders the standard failed task state');
assertIncludes(taskDetailPage, 'task.status === AUTOCUT_TASK_STATUS.failed', 'TaskDetailPage branches failed tasks before pending or processing views');
assertIncludes(taskDetailPage, 'normalizeTaskDetailDisplayText', 'TaskDetailPage normalizes escaped or mojibake-prone task detail text before rendering');
assertIncludes(taskDetailPage, 'normalizeAutoCutTaskDetailDisplayText', 'TaskDetailPage uses the shared task detail text normalizer');
assertIncludes(taskDetailPage, 'createTaskExecutionLogClipboardText', 'TaskDetailPage creates complete execution log clipboard diagnostics');
assertIncludes(taskDetailPage, 'data-task-execution-log-copy', 'TaskDetailPage exposes per-log copy controls for execution diagnostics');
assertIncludes(taskDetailPage, 'const detailsJson = log.details ? normalizeTaskDetailDisplayText(JSON.stringify(log.details, null, 2)) :', 'TaskDetailPage normalizes execution log detail JSON before copying');
assertIncludes(taskDetailPage, 'task.translationSegments?.length', 'TaskDetailPage prefers structured target-language translation segments for subtitle and voice translation results');
assertIncludes(taskDetailPage, 'task.translationText?.trim()', 'TaskDetailPage falls back to target-language translation text for subtitle and voice translation results');
assertIncludes(taskDetailPage, 'translationText || transcriptText', 'TaskDetailPage shows translated output before source STT transcript evidence');
assertIncludes(taskDetailPage, "translationText ? t('taskDetail.result.copyTranslation') : t('taskDetail.result.copyTranscript')", 'TaskDetailPage copy action distinguishes target-language translation from source transcript evidence');
assertRule(!/[\u3400-\u9FFF]/u.test(taskDetailPage), 'TaskDetailPage has no hardcoded CJK mojibake fallback copy in source');
assertIncludes(
  taskDetailPage,
  'w-full min-h-full overflow-y-auto bg-[#0A0A0A]',
  'TaskDetailPage supports page-level vertical scrolling for long task detail content',
);
assertRule(
  !taskDetailPage.includes('w-full h-full p-6 md:p-10 flex flex-col bg-[#0A0A0A] overflow-hidden'),
  'TaskDetailPage does not lock the whole detail screen behind overflow-hidden',
);
assertIncludes(taskDetailPage, 'isAutoCutTaskActiveStatus', 'TaskDetailPage uses the canonical active-status predicate for pending and processing task controls');
assertIncludes(taskDetailPage, 'errorMessage={task.errorMessage}', 'TaskDetailPage passes task error messages into the failed task state');
assertIncludes(taskDetailPage, 'createTaskReprocessState', 'TaskDetailPage prepares route state for reprocessing failed tasks');
assertIncludes(taskDetailPage, 'initialFileId: task.sourceFileId', 'TaskDetailPage reprocesses failed smart slices from the original native source asset');
assertIncludes(taskDetailPage, 'onRetry={() => handleReprocessTask(task)}', 'TaskDetailPage failed task retry opens the owning workflow instead of hiding diagnostics');
assertNotIncludes(taskDetailPage, 'downloadSmartSliceTaskEvidenceFile', 'TaskDetailPage does not expose release-gate evidence export actions from the simplified step-log Drawer');
assertNotIncludes(taskDetailPage, 'handleDownloadSmartSliceTaskEvidence', 'TaskDetailPage does not own a task evidence export button in the simplified detail surface');
assertNotIncludes(taskDetailPage, '_smart-slice-task.json', 'TaskDetailPage does not surface release evidence filenames in the product task detail view');
assertIncludes(taskDetailPage, 'openAutoCutNativeArtifactInFolder', 'TaskDetailPage opens generated task artifacts through the trusted native host command');
assertIncludes(taskDetailPage, 'handleOpenSliceArtifactInFolder', 'TaskDetailPage owns a dedicated generated slice containing-folder workflow');
assertIncludes(taskDetailPage, 'slice.artifactPath', 'TaskDetailPage uses persisted native slice artifact paths instead of reverse-parsing asset URLs');
assertIncludes(taskDetailCommercialResultPanel, '<FolderOpen size={13}', 'TaskDetailPage keeps the generated slice folder action inside the selected deliverable detail view');
assertIncludes(taskDetailPage, 'handleSlicePreviewSelect', 'TaskDetailPage routes slice preview clicks through a dedicated selection handler');
assertIncludes(taskDetailCommercialResultPanel, 'onClick={() => onSelectSlice(slice.id)}', 'TaskDetailPage lets each generated slice select its own preview video through the commercial result panel');
assertIncludes(taskDetailPage, 'const selectedSlice = sliceResults.find((slice) => slice.id === activePreviewUrl) ?? sliceResults[0] ?? null', 'TaskDetailPage resolves the selected slice result before rendering the player');
assertIncludes(taskDetailPage, 'videoKey={selectedSlice.id}', 'TaskDetailPage remounts the video player when a different slice is selected');
assertIncludes(taskDetailPage, 'src={selectedSlice.url}', 'TaskDetailPage plays the selected slice artifact URL instead of a shared placeholder');
assertIncludes(taskDetailPage, 'function TaskVideoPreview', 'TaskDetailPage uses one standardized video preview component for task videos');
assertIncludes(taskDetailPage, 'task-detail-video-preview-shell', 'TaskDetailPage wraps videos in a stable adaptive preview shell');
assertIncludes(taskDetailPage, 'task-detail-video-preview-media', 'TaskDetailPage marks the actual media element for preview quality checks');
assertIncludes(taskDetailPage, 'object-contain', 'TaskDetailPage video previews preserve the complete video frame without cropping');
assertRule(!taskDetailPage.includes('object-cover'), 'TaskDetailPage never crops task videos or slice thumbnails in preview surfaces');
assertIncludes(taskDetailPage, 'task-detail-slice-thumbnail-media', 'TaskDetailPage slice thumbnails use the same complete-frame preview rule');
assertIncludes(taskDetailPage, 'playsInline', 'TaskDetailPage video previews play inline inside the stable preview shell');
assertIncludes(taskDetailPage, 'loading="lazy"', 'TaskDetailPage lazily loads smart slice thumbnails for large slice sets');
assertIncludes(taskDetailPage, 'decoding="async"', 'TaskDetailPage decodes smart slice thumbnails asynchronously to reduce preview list jank');
assertIncludes(taskDetailPage, 'max-h-[62vh]', 'TaskDetailPage video preview shell is bounded by viewport height to prevent layout jumps');
assertIncludes(taskDetailPage, 'function TaskDetailCommercialResultPanel', 'TaskDetailPage owns a dedicated commercial result panel for completed video slicing tasks');
assertIncludes(taskDetailCommercialResultPanel, 'data-task-detail-result-panel="commercial"', 'TaskDetailPage marks the completed video-slice result view as a commercial product surface');
assertIncludes(taskDetailCommercialResultPanel, "t('taskDetail.result.title')", 'TaskDetailPage labels completed video-slice deliverables with product-facing copy');
assertIncludes(taskDetailCommercialResultPanel, "t('taskDetail.result.count', { count: sliceResults.length })", 'TaskDetailPage summarizes completed video-slice result count without exposing diagnostic metadata');
assertIncludes(taskDetailCommercialResultPanel, "t('taskDetail.result.previewing')", 'TaskDetailPage uses product-facing preview status copy for selected deliverables');
assertIncludes(taskDetailCommercialResultPanel, "t('taskDetail.result.download')", 'TaskDetailPage keeps download as a primary deliverable action');
assertIncludes(taskDetailCommercialResultPanel, "t('taskDetail.result.openLocation')", 'TaskDetailPage keeps open-location as a direct deliverable action');
assertRule(countSourceOccurrences(taskDetailCommercialResultPanel, "t('taskDetail.result.openLocation')") === 1, 'TaskDetailPage keeps a single open-location action in the completed video-slice result surface');
assertIncludes(taskDetailPage, "t('taskDetail.review.openWorkbench')", 'TaskDetailPage keeps a dedicated review action for review-ready tasks');
assertRule(countSourceOccurrences(taskDetailPage, "t('taskDetail.review.openWorkbench')") === 2, 'TaskDetailPage keeps review actions contextual without duplicating completed-result controls');
assertRule(!taskDetailPage.includes("label: t('taskDetail.review.openWorkbench')"), 'TaskDetailPage does not reuse the review action label as a passive workflow output tab');
assertIncludes(taskDetailCommercialResultPanel, "t('taskDetail.result.empty')", 'TaskDetailPage has a product-facing empty completed-results state');
assertRule(!taskDetailCommercialResultPanel.includes('Quality JSON'), 'TaskDetailPage default completed video-slice result view does not expose quality JSON downloads');
assertRule(!taskDetailCommercialResultPanel.includes('showSlicingLogic'), 'TaskDetailPage default completed video-slice result view does not expose slicing logic toggles');
assertRule(!taskDetailCommercialResultPanel.includes('taskDetail.slicingLogic.title'), 'TaskDetailPage default completed video-slice result view does not surface diagnostic slicing logic');
assertRule(!taskDetailCommercialResultPanel.includes('selectedSliceReviewIssueCodes'), 'TaskDetailPage default completed video-slice result view does not inline review-risk diagnostics');
assertRule(!taskDetailCommercialResultPanel.includes('hasSliceReviewMetadata'), 'TaskDetailPage default completed video-slice result view does not inline engineering review metadata');
assertIncludes(taskDetailPage, 'data-task-detail-diagnostics-panel="advanced"', 'TaskDetailPage keeps engineering diagnostics in an explicitly separated advanced panel');
assertIncludes(taskDetailPage, 'showExecutionDetails &&', 'TaskDetailPage hides raw engine diagnostics until the operator expands them');
assertNotIncludes(taskDetailPage, "t('taskDetail.header.openAssets')", 'TaskDetailPage simplified header does not duplicate an open-assets action');
assertRule(countSourceOccurrences(taskDetailPage, "t('taskDetail.header.processAgain')") === 1, 'TaskDetailPage keeps a single header-level process-again action');
assertIncludes(taskDetailCommercialResultPanel, 'border border-white/10 bg-white/[0.025]', 'TaskDetailPage completed result surface uses flat low-contrast product styling');
assertRule(!taskDetailCommercialResultPanel.includes('shadow-xl'), 'TaskDetailPage completed result surface avoids heavy shadows');
assertLineOrder(taskDetailPage, '{renderContent()}', '<TaskExecutionPanel', 'TaskDetailPage renders delivery content before the step-log diagnostics Drawer host');
assertNotIncludes(taskDetailPage, 'renderSmartSliceEvidenceInspector()', 'TaskDetailPage keeps the step-log Drawer focused on execution logs rather than evidence inspection');
assertNotIncludes(taskDetailPage, 'createTaskDetailTimelineClips(task)', 'TaskDetailPage does not duplicate timeline inspection inside task-detail diagnostics');
assertNotIncludes(taskDetailPage, 'isSmartSliceReviewSentenceBoundaryIssue', 'TaskDetailPage does not inline review-risk diagnostics in the simplified detail surface');
assertIncludes(i18nResources, 'slicingLogic: {', 'AutoCut i18n resources define the task detail smart slicing logic namespace');
assertIncludes(i18nResources, "title: '切分逻辑'", 'zh-CN i18n resources localize the smart slicing logic title');
assertIncludes(i18nResources, "title: 'Slicing logic'", 'en-US i18n resources localize the smart slicing logic title');
assertIncludes(i18nResources, "reasonUnavailable: '该切片没有写入单独的 AI 选择原因，请结合下方语义、边界和风险证据复核。'", 'zh-CN i18n resources localize the missing smart slicing reason fallback');
assertIncludes(i18nResources, "reasonUnavailable: 'This slice has no dedicated AI selection reason. Review the semantic, boundary, and risk evidence below.'", 'en-US i18n resources localize the missing smart slicing reason fallback');
assertIncludes(taskDetailPage, 'sliceResults.map((slice, index)', 'TaskDetailPage renders per-slice smart slicing logic rows instead of only the selected slice');
assertIncludes(taskDetailPage, '<TaskDetailCommercialResultPanel', 'TaskDetailPage renders completed slice results through the commercial result panel by default');
const requiredSmartSliceReviewRiskCodes = [
  'audio-boundary-refined',
  'audio-transcript-boundary-conflict',
  'broken-sentence-boundary',
  'connector-repaired',
  'content-topic-segment',
  'excess-leading-silence-trimmed',
  'excess-trailing-silence-trimmed',
  'fallback-plan',
  'llm-timing-snapped-to-transcript',
  'llm-timing-without-transcript',
  'low-transcript-coverage',
  'missing-content-conflict',
  'missing-content-hook',
  'missing-content-payoff',
  'missing-content-setup',
  'missing-hook',
  'missing-payoff',
  'missing-setup',
  'needs-cover-title',
  'no-transcript-boundary',
  'no-transcript-segments',
  'open-ending',
  'open-sentence-extended',
  'platform-broken-sentence-boundary',
  'platform-duration-reject',
  'platform-duration-too-long',
  'platform-duration-too-short',
  'platform-hook-not-strong',
  'platform-incomplete-arc',
  'platform-open-ending',
  'platform-topic-drift',
  'platform-weak-hook',
  'sentence-boundary-unavailable',
  'sentence-leading-connector-unrepaired',
  'sentence-open-ending-unrepaired',
  'sentence-trailing-connector-unrepaired',
  'short-transcript-window',
  'source-duration-tail',
  'sparse-transcript-speech',
  'smart-cut-engine',
  'timing-metadata-repaired',
  'topic-drift',
  'trailing-connector-extended',
  'transcript-internal-repeat',
  'transcript-noise-bridge-repaired',
  'transcript-overlap-repaired',
  'transcript-repeat-filtered',
  'unrepaired-sentence-boundary',
  'weak-speech-continuity',
  'weak-hook',
];
for (const code of requiredSmartSliceReviewRiskCodes) {
  const messageKey = toLowerCamelCase(code);
  assertRule(
    smartSliceReviewRiskCatalogCodes.has(code),
    `canonical smart slice review risk catalog covers internally emitted risk ${code}`,
  );
  assertIncludes(
    autocutTypes,
    `taskDetail.reviewRisk.${messageKey}.label`,
    `canonical smart slice review risk ${code} defines a stable i18n label key`,
  );
}
assertRule(
  smartSliceReviewRiskCatalogEntries.length === smartSliceReviewRiskCatalogCodes.size,
  'every canonical smart slice review risk catalog entry defines label, message, and remediation i18n keys',
);
for (const entry of smartSliceReviewRiskCatalogEntries) {
  assertRule(
    entry.labelResourceKey === entry.messageResourceKey &&
      entry.labelResourceKey === entry.remediationResourceKey,
    `canonical smart slice review risk ${entry.code} uses one stable nested i18n resource namespace`,
  );
  assertMatches(
    i18nResources,
    new RegExp(`\\b${entry.labelResourceKey}:\\s*\\{`, 'u'),
    `smart slice review risk ${entry.code} has localized i18n resources`,
  );
}
assertNotIncludes(taskDetailPage, 'formatSliceSourceRange(clip.startMs, clip.endMs)', 'TaskDetailPage does not render advanced timeline diagnostics inside the simplified detail surface');
assertIncludes(autocutTypes, 'artifactPath?: string', 'TaskSliceResult records the trusted native video artifact path for open-containing-folder workflows');
assertIncludes(autocutTypes, 'taskOutputDir?: string', 'TaskSliceResult records the trusted native task output directory for artifact containment audits');
assertIncludes(autocutTypes, 'qualityScore?: number', 'TaskSliceResult records AI smart slice quality scores');
assertIncludes(autocutTypes, 'continuityScore?: number', 'TaskSliceResult records AI smart slice continuity scores');
assertIncludes(autocutTypes, 'storyShape?:', 'TaskSliceResult records AI smart slice story-shape completeness');
assertIncludes(autocutTypes, 'publishabilityScore?: number', 'TaskSliceResult records composite AI smart slice publishability scores');
assertIncludes(autocutTypes, "publishabilityGrade?: 'excellent' | 'good' | 'review' | 'reject'", 'TaskSliceResult records AI smart slice publishability grades');
assertIncludes(autocutTypes, 'publishabilityIssues?: string[]', 'TaskSliceResult records normalized AI smart slice publishability issue tags');
assertIncludes(autocutTypes, 'boundaryQualityScore?: number', 'TaskSliceResult records AI smart slice boundary quality scores');
assertIncludes(autocutTypes, "hookStrength?: 'strong' | 'contextual' | 'weak'", 'TaskSliceResult records AI smart slice hook strength grades');
assertIncludes(autocutTypes, "endingCompleteness?: 'complete' | 'soft' | 'open'", 'TaskSliceResult records AI smart slice ending completeness grades');
assertIncludes(autocutTypes, 'contentArcScore?: number', 'TaskSliceResult records AI smart slice content-arc scores');
assertIncludes(autocutTypes, "contentArcGrade?: 'complete' | 'partial' | 'thin'", 'TaskSliceResult records AI smart slice content-arc grades');
assertIncludes(autocutTypes, "contentArcStages?: Array<'hook' | 'setup' | 'conflict' | 'payoff'>", 'TaskSliceResult records detected smart slice content-arc stages');
assertIncludes(autocutTypes, "contentArcMissingStages?: Array<'hook' | 'setup' | 'conflict' | 'payoff'>", 'TaskSliceResult records missing smart slice content-arc stages');
assertIncludes(autocutTypes, 'topicCoherenceScore?: number', 'TaskSliceResult records AI smart slice topic coherence scores');
assertIncludes(autocutTypes, "topicCoherenceGrade?: 'strong' | 'mixed' | 'weak'", 'TaskSliceResult records AI smart slice topic coherence grades');
assertIncludes(autocutTypes, 'topicShiftCount?: number', 'TaskSliceResult records AI smart slice topic shift counts');
assertIncludes(autocutTypes, 'topicKeywords?: string[]', 'TaskSliceResult records AI smart slice topic keywords');
assertIncludes(autocutTypes, 'platformReadinessScore?: number', 'TaskSliceResult records platform-specific readiness scores');
assertIncludes(autocutTypes, "platformReadinessGrade?: 'ready' | 'review' | 'reject'", 'TaskSliceResult records platform-specific readiness grades');
assertIncludes(autocutTypes, 'platformReadinessIssues?: string[]', 'TaskSliceResult records platform-specific readiness issue tags');
assertIncludes(autocutTypes, 'sentenceBoundaryIntegrityScore?: number', 'TaskSliceResult records sentence boundary integrity scores');
assertIncludes(autocutTypes, "sentenceBoundaryIntegrityGrade?: 'clean' | 'repaired' | 'broken'", 'TaskSliceResult records sentence boundary integrity grades');
assertIncludes(autocutTypes, 'sentenceBoundaryIssues?: string[]', 'TaskSliceResult records sentence boundary issue tags');
assertIncludes(autocutTypes, 'sourceStartMs?: number', 'TaskSliceResult records repaired source start metadata');
assertIncludes(autocutTypes, 'sourceEndMs?: number', 'TaskSliceResult records repaired source end metadata');
assertIncludes(autocutTypes, 'speechStartMs?: number', 'TaskSliceResult records unpadded speech start metadata');
assertIncludes(autocutTypes, 'speechEndMs?: number', 'TaskSliceResult records unpadded speech end metadata');
assertIncludes(autocutTypes, 'boundaryPaddingBeforeMs?: number', 'TaskSliceResult records leading speech boundary padding');
assertIncludes(autocutTypes, 'boundaryPaddingAfterMs?: number', 'TaskSliceResult records trailing speech boundary padding');
assertIncludes(autocutTypes, 'export interface AutoCutTranscriptSegment', 'AutoCut types define a reusable transcript segment contract');
assertIncludes(autocutTypes, 'export interface AutoCutTranscriptCorrectionAudit', 'AutoCut types define a structured manual transcript correction audit contract');
assertIncludes(autocutTypes, 'transcriptSegments?: AutoCutTranscriptSegment[]', 'TaskSliceResult records structured speech-to-text transcript segments');
assertIncludes(autocutTypes, 'translationText?: string', 'AppTask records translated subtitle text for subtitle and voice translation workflows');
assertIncludes(autocutTypes, 'translationSegments?: AutoCutTranscriptSegment[]', 'AppTask records structured translated subtitle segments for subtitle and voice translation workflows');
assertIncludes(autocutTypes, 'transcriptSegmentCount?: number', 'TaskSliceResult records structured speech-to-text transcript segment counts separately from subtitle artifacts');
assertIncludes(autocutTypes, 'transcriptCorrection?: AutoCutTranscriptCorrectionAudit', 'TaskSliceResult records manual transcript correction audit metadata');
assertIncludes(autocutTypes, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'AutoCut types define the canonical smart-slice professional standard');
assertIncludes(autocutTypes, 'maxLeadingSilenceMs: 200', 'AutoCut smart-slice professional standard caps leading silence at 200ms');
assertIncludes(autocutTypes, 'maxTrailingSilenceMs: 250', 'AutoCut smart-slice professional standard caps trailing silence at 250ms');
assertIncludes(autocutTypes, 'minTranscriptCoverageScore: 0.8', 'AutoCut smart-slice professional standard requires 80% transcript coverage');
assertIncludes(autocutTypes, 'maxAudioTranscriptBoundaryDisagreementMs: 1_500', 'AutoCut smart-slice professional standard caps audio/STT boundary disagreement');
assertIncludes(autocutTypes, 'minAudioTranscriptBoundaryOverlapRatio: 0.85', 'AutoCut smart-slice professional standard requires audio/STT boundary overlap before combined trims');
assertIncludes(slicerService, 'createVideoSliceTranscriptSegments', 'Slicer service derives slice-level transcript segments from the STT timeline');
assertIncludes(slicerService, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'Slicer service uses the canonical smart-slice professional standard contract');
assertIncludes(slicerPlanningKernel, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'Slicer planner uses the canonical smart-slice professional standard contract');
assertIncludes(slicerPlanningKernel, 'maxLeadingSilenceMs: TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS', 'Slicer planner uses canonical leading speech padding for transcript windows');
assertIncludes(slicerPlanningKernel, 'minTranscriptCoverageScore: MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE', 'Slicer planner uses canonical transcript coverage for render guards');
assertIncludes(slicerPlanningKernel, 'maxAudioTranscriptBoundaryDisagreementMs: MAX_AUDIO_TRANSCRIPT_BOUNDARY_DISAGREEMENT_MS', 'Slicer planner reads audio/STT disagreement threshold from the canonical professional standard');
assertIncludes(slicerPlanningKernel, 'minAudioTranscriptBoundaryOverlapRatio: MIN_AUDIO_TRANSCRIPT_BOUNDARY_OVERLAP_RATIO', 'Slicer planner reads audio/STT overlap threshold from the canonical professional standard');
assertIncludes(slicerPlanningKernel, 'audio-transcript-boundary-conflict', 'Slicer planner protects transcript speech when audio activity conflicts with STT boundaries');
assertIncludes(smartCutEngineContentUnits, 'DANGLING_CONNECTOR_CONTENT_UNIT', 'Smart Cut Engine records incomplete content units before semantic candidate approval');
assertIncludes(smartCutEngineSemanticBoundary, 'LOW_CONTENT_UNIT_COMPLETENESS', 'Smart Cut Engine rejects candidates built from incomplete semantic units');
assertIncludes(smartCutEngineSemanticBoundary, 'complete answer unit', 'Smart Cut Engine validates complete Q/A continuity for dialogue slicing');
assertIncludes(smartCutEngineLlmReview, 'LLM_RAW_TIME_RANGE_REJECTED', 'Smart Cut Engine refuses model-invented timestamp cuts');
assertIncludes(smartCutEngineLlmReview, 'Rerun LLM review with the final candidate id list and require rankedCandidateIds', 'Smart Cut Engine validates candidate-id review coverage');
assertIncludes(smartCutEngineLlmReview, 'Rerun LLM review with the final content unit id list and require referencedUnitIds', 'Smart Cut Engine validates content-unit review coverage');
assertIncludes(smartCutEngineLlmReview, 'validateReferencedTimeSliceIds', 'Smart Cut Engine validates time-slice id evidence after LLM review');
assertIncludes(smartCutEngineLlmReview, 'validateReferencedSpeakerTurnIds', 'Smart Cut Engine validates speaker-turn id evidence after LLM review');
assertIncludes(slicerPlannerCheck, 'Smart Cut Engine rejects interview planning when transcript evidence has no real speaker diarization labels', 'Slicer planner check covers fail-closed multi-speaker diarization');
assertIncludes(slicerPlannerCheck, 'Smart Cut Engine accepts interview planning when real speaker labels exist', 'Slicer planner check covers successful speaker-aware dialogue planning');
assertIncludes(slicerPlannerCheck, 'Smart Cut Engine infers interview roles from question evidence', 'Slicer planner check covers evidence-based interviewer role assignment');
assertIncludes(serviceBehaviorCheck, 'marks native clip requests with Smart Cut Engine evidence when the configured LLM returns an invalid ID review', 'Service behavior check covers Smart Cut Engine risk propagation after invalid ID-only LLM review');
assertRule(!slicerService.includes('llmPlan === fallbackPlan'), 'Slicer service does not rely on array reference equality to detect LLM planning fallback');
assertIncludes(slicerPlannerCheck, 'audio cleanup boundary conflicts choose combined boundaries when transcript ranges overlap with denoised audio activity', 'Slicer planner check covers renderable audio boundaries when trusted audio activity conflicts with transcript timing');
assertIncludes(slicerPlannerCheck, 'auto deterministic fallback refuses to fabricate default clip counts without transcript content evidence', 'Slicer planner check covers automatic mode refusing default deterministic clip counts without real content evidence');
assertIncludes(slicerPlannerCheck, 'auto LLM fallback refuses deterministic clips when no transcript content evidence is available', 'Slicer planner check covers automatic mode rejecting deterministic LLM fallback plans without real transcript content evidence');
assertIncludes(slicerPlannerCheck, 'no-transcript LLM plans reject raw timing windows instead of filling fabricated fallback clips', 'Slicer planner check covers every slice count mode rejecting raw LLM timing windows without real transcript content evidence');
assertIncludes(slicerPlannerCheck, 'source-duration-aware no-transcript LLM plans reject raw model timing instead of fabricating bounded clips', 'Slicer planner check covers source-bounded no-transcript LLM plans failing closed instead of fabricating clips');
assertIncludes(slicerPlannerCheck, 'transcript planning ignores legacy fixed target count and derives clip count from real continuous content groups', 'Slicer planner check covers legacy count inputs being ignored by content-derived planning');
assertIncludes(slicerPlannerCheck, 'invalid LLM responses cannot fall back to deterministic no-transcript clips when transcript candidates exist', 'Slicer planner check covers invalid LLM responses refusing deterministic no-transcript fallback clips');
assertIncludes(slicerPlannerCheck, 'invalid LLM responses cannot fall back to weak transcript evidence that would fail native render readiness', 'Slicer planner check covers invalid LLM responses refusing weak transcript-evidence fallback clips');
assertIncludes(slicerPlannerCheck, 'content-derived planning publishes every natural continuous story beyond internal candidate safety limits', 'Slicer planner check covers large workloads deriving clip count from every real continuous story instead of bounded safety limits');
assertIncludes(smartCutEnginePlanner, 'Smart Cut Engine could not build executable semantic candidates from transcript and speaker evidence.', 'Smart Cut Engine fails closed when no executable semantic candidate exists');
assertIncludes(smartCutEnginePlanner, 'NO_RENDERABLE_TRANSCRIPT_SEGMENT', 'Smart Cut Engine fails closed when candidate validation leaves no renderable transcript-backed slices');
assertIncludes(smartCutEnginePlanner, 'MISSING_TRANSCRIPT_EVIDENCE', 'Smart Cut Engine planner has a named fail-closed guard for missing transcript evidence');
assertIncludes(smartCutEnginePlanner, 'MISSING_SPEAKER_DIARIZATION', 'Smart Cut Engine planner has a named fail-closed guard for missing speaker evidence');
assertIncludes(smartCutEnginePlanner, 'MISSING_MULTI_SPEAKER_DIARIZATION', 'Smart Cut Engine planner has a named fail-closed guard for multi-speaker modes without real diarization');
assertIncludes(slicerService, 'hasRealSmartSliceTranscriptContentEvidence', 'Slicer service has a named guard for real transcript content evidence before Smart Slice planning');
assertIncludes(serviceBehaviorCheck, 'video slice workflow fails closed when speech-to-text only returns silence or filler transcript segments', 'Service behavior check covers Smart Slice failing closed on silence-only or filler-only STT output');
assertIncludes(slicerService, 'Smart slicing requires real transcript content evidence before automatic clip planning', 'Slicer service exposes a precise failure reason when automatic planning has no real transcript content evidence');
assertIncludes(slicerService, 'assertSmartSliceTranscriptTimelineWithinSourceDuration', 'Slicer service has a named guard for STT timeline source-duration consistency');
assertIncludes(slicerService, 'normalizeSmartSliceTranscriptTimelineForSourceDuration', 'Slicer service repairs only bounded final STT tail timestamp drift before Smart Slice planning');
assertIncludes(slicerService, 'MAX_SMART_SLICE_TRANSCRIPT_SOURCE_TAIL_REPAIR_MS', 'Slicer service uses the canonical audio/STT boundary disagreement limit for final tail timestamp repair');
assertIncludes(slicerService, "'clip planning'", 'Slicer service validates STT source-duration consistency before LLM clip planning');
assertIncludes(slicerService, "'native rendering'", 'Slicer service revalidates STT source-duration consistency before native rendering');
assertIncludes(serviceBehaviorCheck, 'video slice workflow exposes the source-bounded final STT segment as a content unit before ID-only LLM review', 'Service behavior check covers bounded final STT tail timestamp repair before ID-only LLM review');
assertIncludes(serviceBehaviorCheck, 'smart slice native-render readiness gate repairs bounded final STT tail timestamp drift consistently with clip planning', 'Service behavior check covers bounded final STT tail timestamp repair before native rendering');
assertIncludes(serviceBehaviorCheck, 'video slice workflow does not prompt the LLM with out-of-source STT timestamp evidence', 'Service behavior check covers failing closed before LLM planning on out-of-source STT timestamps');
assertIncludes(slicerService, 'segment.endMs > speechStartMs', 'Slicer service clips slice STT evidence to speech start boundaries instead of render padding');
assertIncludes(slicerService, 'segment.startMs < speechEndMs', 'Slicer service clips slice STT evidence to speech end boundaries so adjacent transcript text cannot leak through render padding');
assertIncludes(slicerService, 'transcriptSegmentCount: sliceTranscriptSegments.length', 'Slicer service persists speech-to-text segment counts independent of subtitle rendering');
assertIncludes(slicerService, 'mergedPlannedClips.map((clip) => toNativeSliceClipRequest(clip, transcriptSegments, params))', 'Slicer service embeds slice-level STT evidence into every native render clip request after final slice merging');
assertIncludes(slicerService, 'clipTranscriptText ? { transcriptText: clipTranscriptText }', 'Slicer service sends real transcript text, not AI summaries, in native clip requests');
assertIncludes(slicerService, 'clipTranscriptSegments.length ? { transcriptSegments: clipTranscriptSegments }', 'Slicer service sends structured transcript segments in native clip requests');
assertIncludes(slicerService, 'renderClip.risks ? { risks: renderClip.risks }', 'Slicer service sends slice review risks into native render evidence');
assertIncludes(slicerService, 'renderClip.boundaryPaddingBeforeMs !== undefined', 'Slicer service sends speech boundary padding evidence in native clip requests');
assertIncludes(slicerService, 'sourceSegments: renderClip.sourceSegments', 'Slicer service sends retained source speech islands into native clip requests');
assertIncludes(slicerService, 'renderedDurationMs: renderClip.renderedDurationMs', 'Slicer service sends silence-compacted rendered duration evidence into native clip requests');
assertIncludes(slicerService, 'assertVideoSliceResultsHaveTranscripts', 'Slicer service fails closed if any completed smart slice lacks visible speech-to-text text');
assertIncludes(slicerService, 'createVideoSliceTranscriptText(sliceTranscriptSegments)', 'Slicer service rebuilds visible slice transcript text from structured segment evidence');
assertIncludes(slicerService, '!sliceResult.transcriptSegments?.length ||', 'Slicer service requires structured transcript segments instead of accepting transcriptText-only smart slices');
assertIncludes(slicerService, 'normalizeVideoSliceTranscriptEvidenceText', 'Slicer service normalizes transcript evidence before comparing rendered text');
assertIncludes(slicerService, 'transcriptText to match structured transcriptSegments', 'Slicer service rejects stale transcriptText that does not match structured STT segments');
assertIncludes(slicerService, 'speech range to stay covered by structured transcript segment boundaries', 'Slicer service rejects speech boundary metadata that is not proven by structured STT segments');
assertIncludes(slicerService, 'transcript segments to be ordered and non-overlapping', 'Slicer service rejects out-of-order or overlapping structured STT segments');
const checkSmartSliceTaskEvidence = read('scripts/check-autocut-smart-slice-task-evidence.mjs');
const writeSmartSliceQualityEvidence = read('scripts/write-autocut-smart-slice-quality-evidence.mjs');
const writeSmartSliceSampleEvidence = read('scripts/write-autocut-smart-slice-sample-evidence.mjs');
const checkSmartSliceReleaseFixture = read('scripts/check-autocut-smart-slice-release-fixture.mjs');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptStructuredSegmentCount', 'smart slice task evidence validation requires structured transcript segments for every generated slice');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptTextMatchesSegments', 'smart slice task evidence validation rejects stale transcript text that is not backed by structured STT segments');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptSegmentsOrdered', 'smart slice task evidence validation rejects out-of-order or overlapping transcript segments');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptSpeechBoundaryMatches', 'smart slice task evidence validation rejects speech ranges that are not backed by transcript segment boundaries');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptCorrectionAuditReady', 'smart slice task evidence validation verifies manual transcript correction audit metadata when present');
assertIncludes(checkSmartSliceTaskEvidence, 'reviewWarnings', 'smart slice task evidence validation exports non-blocking human-review warnings for slice risks');
assertIncludes(checkSmartSliceTaskEvidence, 'AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG', 'smart slice task evidence validation resolves review warnings through the canonical risk catalog');
assertIncludes(checkSmartSliceTaskEvidence, 'createSmartSliceReviewIssueCodes', 'smart slice task evidence validation collects risks and quality issue tags into one review warning report');
assertIncludes(checkSmartSliceTaskEvidence, 'publishabilityIssues', 'smart slice task evidence validation includes publishability issue tags in review warning reports');
assertIncludes(checkSmartSliceTaskEvidence, 'platformReadinessIssues', 'smart slice task evidence validation includes platform readiness issue tags in review warning reports');
assertIncludes(checkSmartSliceTaskEvidence, 'sentenceBoundaryIssues', 'smart slice task evidence validation includes sentence boundary issue tags in review warning reports');
assertIncludes(checkSmartSliceTaskEvidence, 'SMART_SLICE_TASK_TRANSCRIPT_CORRECTION_AUDIT_INVALID', 'smart slice task evidence validation blocks malformed manual transcript correction audit metadata');
assertIncludes(checkSmartSliceTaskEvidence, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'smart slice task evidence validation uses the canonical professional standard contract');
assertIncludes(checkSmartSliceTaskEvidence, 'maximumLeadingSilenceMs = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs', 'smart slice task evidence blocks rendered slices with excessive leading silence');
assertIncludes(checkSmartSliceTaskEvidence, 'maximumTrailingSilenceMs = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs', 'smart slice task evidence blocks rendered slices with excessive trailing silence');
assertIncludes(checkSmartSliceTaskEvidence, 'requiredAudioCleanupProfile = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.audioCleanupProfile', 'smart slice task evidence validates the canonical audio cleanup profile');
assertIncludes(checkSmartSliceTaskEvidence, 'noiseReductionApplied !== undefined', 'smart slice task evidence requires explicit noise-reduction decision evidence for professional release');
assertIncludes(checkSmartSliceTaskEvidence, 'minimumAudioActivityConfidence = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.minAudioActivityConfidence', 'smart slice task evidence validates high-confidence audio activity evidence');
assertIncludes(checkSmartSliceTaskEvidence, 'requiredAudioActivityAnalysisFilter = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.requiredAudioActivityAnalysisFilter', 'smart slice task evidence knows the canonical denoised audio activity analysis filter');
assertIncludes(checkSmartSliceTaskEvidence, 'rawAudioActivityAnalysisFilter', 'smart slice task evidence accepts the canonical raw-audio activity analysis filter when denoise is skipped');
assertIncludes(checkSmartSliceTaskEvidence, 'audioActivityRangeReady', 'smart slice task evidence requires audio activity start/end range evidence');
assertIncludes(checkSmartSliceTaskEvidence, 'leadingSilenceMs !== undefined', 'smart slice task evidence requires leading silence evidence from audio analysis');
assertIncludes(checkSmartSliceTaskEvidence, 'trailingSilenceMs !== undefined', 'smart slice task evidence requires trailing silence evidence from audio analysis');
assertIncludes(checkSmartSliceTaskEvidence, 'SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE', 'smart slice task evidence blocks missing noise-reduction decision, boundary, raw silence, trim, or tail treatment evidence');
assertIncludes(checkSmartSliceTaskEvidence, 'SMART_SLICE_TASK_EXCESSIVE_SILENCE_BOUNDARY', 'smart slice task evidence has a dedicated excessive silence blocker');
assertIncludes(writeSmartSliceQualityEvidence, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'smart slice quality evidence uses the canonical professional standard contract');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptSegmentsSourceRangeReady', 'smart slice quality evidence verifies structured transcript segments stay inside each rendered source range');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptTextMatchesSegments', 'smart slice quality evidence verifies visible transcript text is backed by structured STT segments');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptSegmentsOrdered', 'smart slice quality evidence verifies structured STT segments are ordered and non-overlapping');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptSpeechBoundaryMatches', 'smart slice quality evidence verifies speech ranges are backed by transcript segment boundaries');
assertIncludes(writeSmartSliceQualityEvidence, 'correctedTranscriptSlices', 'smart slice quality evidence summarizes manually corrected transcript slices');
assertIncludes(writeSmartSliceQualityEvidence, 'reviewWarnings', 'smart slice quality evidence exports non-blocking human-review warnings for slice risks');
assertIncludes(writeSmartSliceQualityEvidence, 'AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG', 'smart slice quality evidence resolves review warnings through the canonical risk catalog');
assertIncludes(writeSmartSliceQualityEvidence, 'createSmartSliceReviewIssueCodes', 'smart slice quality evidence collects risks and quality issue tags into one review warning report');
assertIncludes(writeSmartSliceQualityEvidence, 'SMART_SLICE_TRANSCRIPT_CORRECTION_AUDIT_INVALID', 'smart slice quality evidence blocks malformed manual transcript correction audit metadata');
assertIncludes(writeSmartSliceSampleEvidence, 'reviewWarnings: taskValidation.reviewWarnings', 'smart slice sample evidence includes task-level non-blocking review warnings');
assertIncludes(writeSmartSliceSampleEvidence, 'reviewWarnings: quality.evidence.reviewWarnings', 'smart slice sample evidence includes quality-level non-blocking review warnings');
assertIncludes(checkSmartSliceReleaseFixture, 'reviewWarningSlices: taskValidation.summary.reviewWarningSlices', 'smart slice release fixture summarizes non-blocking review warning slices');
assertIncludes(checkSmartSliceReleaseFixture, 'reviewWarnings: taskValidation.reviewWarnings', 'smart slice release fixture includes task-level review warning details');
assertIncludes(checkSmartSliceReleaseFixture, 'reviewWarnings: result.evidence.reviewWarnings', 'smart slice release fixture includes quality evidence review warning details');
assertIncludes(writeSmartSliceQualityEvidence, 'maxLeadingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs', 'smart slice quality evidence uses the professional leading silence threshold');
assertIncludes(writeSmartSliceQualityEvidence, 'maxTrailingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs', 'smart slice quality evidence uses the professional trailing silence threshold');
assertIncludes(writeSmartSliceQualityEvidence, 'audioCleanupProfile: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.audioCleanupProfile', 'smart slice quality evidence reports the canonical audio cleanup profile threshold');
assertIncludes(writeSmartSliceQualityEvidence, 'noiseReductionDecisionRequired: true', 'smart slice quality evidence requires explicit noise-reduction decision evidence');
assertIncludes(writeSmartSliceQualityEvidence, 'minAudioActivityConfidence: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.minAudioActivityConfidence', 'smart slice quality evidence reports the high-confidence audio activity threshold');
assertIncludes(writeSmartSliceQualityEvidence, 'requiredAudioActivityAnalysisFilter: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.requiredAudioActivityAnalysisFilter', 'smart slice quality evidence reports the denoised audio activity filter');
assertIncludes(writeSmartSliceQualityEvidence, 'rawAudioActivityAnalysisFilter', 'smart slice quality evidence reports the raw-audio activity filter when denoise is skipped');
assertIncludes(writeSmartSliceQualityEvidence, 'audioActivityRangeReady', 'smart slice quality evidence requires audio activity start/end range evidence');
assertIncludes(writeSmartSliceQualityEvidence, 'leadingSilenceMs !== undefined', 'smart slice quality evidence requires leading silence evidence from audio analysis');
assertIncludes(writeSmartSliceQualityEvidence, 'trailingSilenceMs !== undefined', 'smart slice quality evidence requires trailing silence evidence from audio analysis');
assertIncludes(writeSmartSliceQualityEvidence, 'SMART_SLICE_AUDIO_CLEANUP_INCOMPLETE', 'smart slice quality evidence blocks release when noise-reduction decision or audio cleanup evidence is incomplete');
assertIncludes(writeSmartSliceQualityEvidence, 'SMART_SLICE_EXCESSIVE_SILENCE_BOUNDARY', 'smart slice quality evidence blocks excessive rendered silence before release');
assertRule(!autocutTypes.includes('subtitleSegmentCount?: number'), 'TaskSliceResult does not use subtitle terminology for required speech-to-text transcript metadata');
assertRule(!slicerPlanningKernel.includes('subtitleSegmentCount'), 'Slicer planner uses transcript terminology for speech-to-text segment counts');
assertRule(!slicerPlanningKernel.includes('subtitleSegmentScore'), 'Slicer planner does not use subtitle terminology for transcript segment scoring');
assertRule(!taskDetailCommercialResultPanel.includes('downloadSliceTranscriptFile'), 'TaskDetailPage default completed result panel does not expose transcript export as a primary deliverable');
assertRule(!taskDetailCommercialResultPanel.includes('selectedSlice.transcriptSegments.map'), 'TaskDetailPage default completed result panel does not inline structured transcript diagnostics');
assertRule(!taskDetailCommercialResultPanel.includes('handleCopyTranscriptText'), 'TaskDetailPage default completed result panel does not expose transcript correction copy controls');
assertRule(!taskDetailCommercialResultPanel.includes('handleStartTranscriptEdit'), 'TaskDetailPage default completed result panel does not expose transcript editing controls');
assertRule(!taskDetailCommercialResultPanel.includes('handleSaveTranscriptEdit'), 'TaskDetailPage default completed result panel does not expose transcript save controls');
assertRule(!taskDetailCommercialResultPanel.includes('updateTaskSliceTranscript'), 'TaskDetailPage default completed result panel does not persist transcript edits from the delivery surface');
assertRule(!taskDetailCommercialResultPanel.includes('selectedSlice.transcriptCorrection'), 'TaskDetailPage default completed result panel does not inline manual transcript correction audit status');
assertIncludes(serviceBehaviorCheck, 'native completed slice task fails closed when recovered audio cleanup evidence is missing', 'service behavior check covers recovered native smart-slice audio cleanup evidence fail-closed behavior');
assertIncludes(serviceBehaviorCheck, 'does not expose generated slices without recovered audio cleanup evidence', 'service behavior check prevents invalid recovered smart-slice audio cleanup artifacts from being projected');
assertIncludes(serviceBehaviorCheck, 'Smart Slice honors disabled denoise before audio boundary analysis for clean source audio', 'service behavior check covers skipping broadband denoise before boundary analysis for clean source audio');
assertIncludes(serviceBehaviorCheck, 'Smart Slice completes with clean raw audio cleanup evidence when callers disable denoise', 'service behavior check covers disabled denoise completion with raw-audio cleanup evidence');
assertIncludes(serviceBehaviorCheck, 'Smart Slice fails closed when audio boundary analysis fails', 'service behavior check covers audio boundary analysis execution failures');
assertIncludes(serviceBehaviorCheck, 'Smart Slice fails preflight when audio boundary analysis capability is unavailable', 'service behavior check covers missing smart-slice audio boundary capability preflight failures');
assertIncludes(serviceBehaviorCheck, 'Smart Slice rejects incomplete audio boundary analysis results', 'service behavior check covers incomplete audio boundary result failures');
assertIncludes(serviceBehaviorCheck, 'Smart Slice rejects malformed audio boundary analysis evidence with a standard error', 'service behavior check covers malformed audio boundary evidence failures');
assertIncludes(serviceBehaviorCheck, 'Smart Slice rejects malformed audio boundary analysis envelopes with a standard error', 'service behavior check covers malformed audio boundary envelope failures');
assertIncludes(serviceBehaviorCheck, 'Smart Slice rejects weak non-audio boundary analysis evidence with a standard error', 'service behavior check covers weak or wrong-filter audio boundary evidence failures');
assertIncludes(serviceBehaviorCheck, 'Smart Slice does not render native slices after incomplete audio boundary analysis', 'service behavior check prevents native rendering after incomplete audio boundary evidence');
assertIncludes(slicerService, 'assertSmartSliceAudioActivityAnalysisComplete', 'Slicer service validates complete audio boundary evidence before native rendering');
assertIncludes(slicerService, 'Array.isArray(resultEnvelope.analyses)', 'Slicer service validates the native audio boundary analysis envelope shape before reading analyses');
assertIncludes(slicerService, 'capabilities.videoSliceAudioActivityAnalysisCommandReady &&', 'Slicer service treats audio activity analysis as a hard native smart-slice preflight requirement');
assertIncludes(slicerService, 'analysis.confidence < MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE', 'Slicer service rejects weak audio activity confidence before native rendering');
assertIncludes(slicerService, 'getSmartSliceRequiredAudioActivityAnalysisFilter', 'Slicer service chooses the required audio activity filter from the recorded noise-reduction decision');
assertIncludes(slicerService, 'SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER', 'Slicer service accepts the raw-audio activity filter when broadband denoise is skipped');
assertIncludes(slicerService, 'Smart slicing requires ${createSmartSliceAudioBoundaryAnalysisRequirementLabel(noiseReductionApplied)} before native rendering', 'Slicer service fails closed when audio boundary analysis throws');
assertIncludes(slicerService, 'Smart slicing requires high-confidence ${analysisRequirementLabel} activity evidence before native rendering', 'Slicer service reports a standard error for weak or wrong-filter audio activity evidence');
assertIncludes(slicerService, 'activity range to stay inside planned source range', 'Slicer service rejects out-of-range native audio activity before planner clamping can hide it');
assertIncludes(slicerService, 'audio silence evidence to match trusted audio activity padding', 'Slicer service rejects stale silence metadata that does not match trusted audio activity evidence');
assertIncludes(slicerService, 'explicit STT speechStartMs and speechEndMs before native rendering', 'Slicer service requires explicit STT speech boundaries before native rendering');
assertIncludes(serviceBehaviorCheck, 'smart slice native-render readiness gate rejects audio-only post-cleanup plans without explicit STT speech boundaries', 'service behavior check covers audio-only post-cleanup native readiness fail-closed behavior');
assertIncludes(slicerPlanningKernel, 'audio-only-boundary-too-short', 'Slicer planner refuses audio-only micro activity as standalone Smart Slice render timing');
assertIncludes(slicerPlannerCheck, 'audio-only cleanup refuses to create sub-second clips from micro audio activity without STT speech boundaries', 'planner check covers audio-only micro activity boundary protection');
assertIncludes(serviceBehaviorCheck, 'smart slice professional completion gate rejects stale leading silence evidence before task completion', 'service behavior check covers final-result stale leading silence rejection');
assertIncludes(serviceBehaviorCheck, 'smart slice native-render readiness gate rejects stale audio silence evidence after cleanup', 'service behavior check covers native readiness stale silence rejection');
assertIncludes(slicerService, 'raw audio boundary analysis fallback to denoise', 'Slicer service can retry with denoise when raw boundary analysis fails and denoise is allowed');
assertIncludes(slicerService, 'assertSmartSliceSemanticPlanReadyForAudioAnalysis', 'Slicer service uses a semantic pre-filter readiness gate before audio cleanup instead of applying render-only silence rules too early');
assertNotIncludes(slicerService, 'plan readiness assertion relaxed', 'Slicer service never relaxes Smart Slice plan readiness assertions after semantic planning or audio cleanup');
assertNotIncludes(slicerService, 'native slice artifact validation relaxed', 'Slicer service fails closed when native slice artifacts do not match the Smart Cut Engine render plan');
assertNotIncludes(slicerService, 'professional evidence verification relaxed', 'Slicer service fails closed when completed slices do not meet the professional evidence contract');
assertNotIncludes(slicerService, 'isRelaxableNativeSliceArtifactValidationError', 'Slicer service does not keep a relaxable native artifact validation escape hatch');
assertRule(!slicerService.includes('fallbackToTranscriptBoundaries'), 'Slicer service does not report transcript-boundary fallback as completed audio cleanup');
assertIncludes(i18nResources, 'transcript: {', 'AutoCut i18n resources retain transcript resources for evidence and correction workflows outside the default delivery surface');
assertIncludes(i18nResources, 'copyAll:', 'AutoCut i18n resources localize the transcript copy-all action');
assertIncludes(i18nResources, 'segmentCopied:', 'AutoCut i18n resources localize per-segment transcript copy feedback');
assertIncludes(i18nResources, 'save:', 'AutoCut i18n resources localize the transcript save action');
assertIncludes(i18nResources, 'edit:', 'AutoCut i18n resources localize the transcript edit action');
assertIncludes(i18nResources, 'copyFailed:', 'AutoCut i18n resources localize transcript copy failures');
assertRule(!taskDetailPage.includes("'Segment copied'"), 'TaskDetailPage does not hardcode per-segment transcript copy feedback');
assertRule(!taskDetailPage.includes("'Copy failed'"), 'TaskDetailPage does not hardcode transcript copy failure feedback');
assertRule(!taskDetailPage.includes("'Save failed'"), 'TaskDetailPage does not hardcode transcript save failure feedback');
assertIncludes(tasksService, 'createUpdatedTaskSliceTranscript', 'Tasks service normalizes and persists corrected slice transcript edits');
assertIncludes(tasksService, "source: 'task-detail'", 'Tasks service records task detail as the manual transcript correction source');
assertIncludes(tasksService, 'originalTranscriptText', 'Tasks service preserves the original transcript text when manual corrections are saved');
assertIncludes(tasksService, 'countChangedTranscriptSegments', 'Tasks service counts only actual transcript segment changes for correction audit metadata');
assertIncludes(tasksService, 'transcriptCorrection: localSlice.transcriptCorrection', 'Tasks service preserves transcript correction audit metadata when merging native recovered tasks');
assertIncludes(tasksService, 'audioActivityStartMs/audioActivityEndMs inside the source range', 'Tasks service rejects recovered native smart-slice output without audio activity range evidence');
assertIncludes(tasksService, 'transcriptSegmentCount: transcriptSegments.length', 'Tasks service keeps transcript segment counts in sync after manual corrections');
assertIncludes(taskDetailPage, 'formatSliceTranscriptTimestamp', 'TaskDetailPage keeps timestamp formatting for translated transcript views');
assertNotIncludes(taskDetailPage, 'formatSliceSourceRange(clip.startMs, clip.endMs)', 'TaskDetailPage does not display advanced timeline diagnostics in the simplified task detail view');
assertMatches(
  taskDetailPage,
  /<Button className="mt-4" variant="outline" onClick=\{\(\) => downloadTaskExecutionResultFile\(task, getTaskTypeLabel\(task\.type\), t\(getTaskStatusLabelKey\(task\.status\)\), t\)\}/u,
  'TaskDetailPage fallback result download button is wired to a real export workflow',
);
assertIncludes(downloadService, 'createSmartSliceTaskEvidenceJson', 'download.service creates standardized smart slice task evidence JSON');
assertIncludes(downloadService, 'downloadSmartSliceTaskEvidenceFile', 'download.service exposes a smart slice task evidence download workflow');
assertIncludes(downloadService, '2026-05-06.autocut-smart-slice-task-evidence.v1', 'smart slice task evidence JSON has a versioned schema marker');
assertIncludes(downloadService, 'sliceResults: task.sliceResults ?? []', 'smart slice task evidence preserves the exact completed slice results');
assertIncludes(downloadService, "application/json", 'smart slice task evidence is exported as JSON instead of plain text');
const releaseChangelog = read('docs/release/CHANGELOG.md');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-sample', 'release notes document the smart slice sample evidence command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-quality -- --task artifacts/smart-slice/smart-slice-task.json', 'release notes document the smart slice quality evidence command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-media-artifacts -- --task artifacts/smart-slice/smart-slice-task.json', 'release notes document the smart slice media artifacts evidence command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-task -- --task artifacts/smart-slice/smart-slice-task.json', 'release notes document the smart slice task evidence validation command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-fixture', 'release notes document the smart slice release fixture smoke command');
assertIncludes(releaseChangelog, 'pnpm release:sign-installers', 'release notes document the installer signing execution command');
assertIncludes(releaseChangelog, 'pnpm release:preview-ready', 'release notes document the unsigned preview release readiness gate');
assertIncludes(releaseChangelog, 'unsigned preview', 'release notes document the unsigned preview release boundary');
assertIncludes(releaseChangelog, 'smart-slice-task.json', 'release notes document the smart slice task JSON evidence input');
assertIncludes(releaseChangelog, 'autocut-smart-slice-quality-evidence.json', 'release notes document the generated smart slice quality evidence file');
assertIncludes(releaseChangelog, 'autocut-smart-slice-media-artifacts-evidence.json', 'release notes document the generated smart slice media artifacts evidence file');
assertIncludes(releaseChangelog, 'autocut-smart-slice-sample-evidence.json', 'release notes document the generated smart slice sample evidence file');
assertIncludes(releaseChangelog, 'autocut-smart-slice-release-fixture.json', 'release notes document the generated smart slice release fixture report file');
assertIncludes(releaseChangelog, 'pnpm release:multiplatform-ready', 'release notes document the multiplatform preview release readiness gate');
assertIncludes(releaseChangelog, 'autocut-release-evidence-linux-x86_64.json', 'release notes document the Linux release evidence file');
assertIncludes(releaseChangelog, 'autocut-release-evidence-macos-x86_64.json', 'release notes document the Intel macOS release evidence file');
assertIncludes(releaseChangelog, 'autocut-release-evidence-macos-aarch64.json', 'release notes document the Apple Silicon macOS release evidence file');
assertIncludes(releaseChangelog, 'ubuntu-22.04', 'release notes document the Ubuntu/Linux native release runner');
assertIncludes(releaseChangelog, 'repository-root `pnpm', 'release notes document the repository-root Tauri release workflow');
assertIncludes(releaseChangelog, 'Phase 1', 'release notes document the Phase 1 preview release scope');
assertIncludes(releaseChangelog, 'Phase 2', 'release notes document the Phase 2 commercial release standard');

for (const workflow of processingWorkflows) {
  const serviceSource = read(workflow.service);
  if (workflow.producesGeneratedAssets !== false) {
    assertIncludes(serviceSource, 'sourceTaskId: newTask.id', `${workflow.name} service stores sourceTaskId on generated assets`);
    assertIncludes(serviceSource, 'sourceTaskType: newTask.type', `${workflow.name} service stores sourceTaskType on generated assets`);
    assertIncludes(serviceSource, 'generatedAssetIds', `${workflow.name} service returns generatedAssetIds to the completed task`);
  }
  assertIncludes(serviceSource, 'sourceFileId: params.fileId', `${workflow.name} service stores selected source file id on the task`);
}

assertIncludes(identityService, 'export function createAutoCutTaskId', 'identity.service.ts exports the standard task id factory');
assertIncludes(identityService, 'export function createAutoCutUuidV7', 'identity.service.ts exposes the UUIDv7 generator used by task ids');
assertIncludes(identityService, '0x70', 'identity.service.ts sets UUIDv7 version bits');
assertIncludes(identityService, '0x80 | (randomBytes[0] & 0x3f)', 'identity.service.ts sets RFC 4122/RFC 9562 UUID variant bits');

const processingSourceServicePath = 'packages/sdkwork-autocut-services/src/service/processing-source.service.ts';
const settingsServicePath = 'packages/sdkwork-autocut-services/src/service/settings.service.ts';
const settingsRegistryPath = 'packages/sdkwork-autocut-settings/src/service/settings.registry.ts';
const servicesIndex = read('packages/sdkwork-autocut-services/src/index.ts');
const storageService = read('packages/sdkwork-autocut-services/src/service/storage.service.ts');
const eventsService = read('packages/sdkwork-autocut-services/src/service/events.service.ts');
const settingsPage = read('packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
const settingsRegistry = exists(settingsRegistryPath) ? read(settingsRegistryPath) : '';
const settingsZhMessagesStart = i18nResources.indexOf('const AUTOCUT_SETTINGS_ZH_CN_MESSAGES');
const settingsEnMessagesStart = i18nResources.indexOf('const AUTOCUT_SETTINGS_EN_US_MESSAGES');
const settingsZhMessages = settingsZhMessagesStart >= 0 && settingsEnMessagesStart > settingsZhMessagesStart
  ? i18nResources.slice(settingsZhMessagesStart, settingsEnMessagesStart)
  : '';
const settingsEnMessages = settingsEnMessagesStart >= 0
  ? i18nResources.slice(settingsEnMessagesStart)
  : '';
const normalizedSettingsZhMessages = normalizeLineEndings(settingsZhMessages);
const normalizedSettingsEnMessages = normalizeLineEndings(settingsEnMessages);
assertRule(exists(processingSourceServicePath), '@sdkwork/autocut-services owns processing-source.service.ts');
if (exists(processingSourceServicePath)) {
  const processingSourceService = read(processingSourceServicePath);
  assertIncludes(
    processingSourceService,
    'export function validateAutoCutProcessingSource',
    'processing-source.service.ts exports validateAutoCutProcessingSource',
  );
  assertIncludes(
    processingSourceService,
    'AutoCutProcessingTaskError',
    'processing-source.service.ts exposes a typed failed-task error',
  );
  assertIncludes(
    processingSourceService,
    'failAutoCutProcessingTask',
    'processing-source.service.ts exposes a standard failed-task transition helper',
  );
  assertIncludes(
    processingSourceService,
    'getAutoCutProcessingTaskErrorTaskId',
    'processing-source.service.ts exposes a helper for reading failed task ids',
  );
  assertIncludes(
    processingSourceService,
    'allowExternalUrl?: boolean',
    'processing-source.service.ts supports explicit external URL allowance',
  );
  assertIncludes(
    processingSourceService,
    "parsed.protocol !== 'http:' && parsed.protocol !== 'https:'",
    'processing-source.service.ts rejects non-http and non-https external URLs',
  );
}
assertIncludes(servicesIndex, "export * from './service/processing-source.service'", 'services index exports processing-source.service.ts');
assertRule(exists(settingsServicePath), '@sdkwork/autocut-services owns a settings.service.ts workflow service');
if (exists(settingsServicePath)) {
  const settingsService = read(settingsServicePath);
  for (const exportName of [
    'getAutoCutSettings',
    'saveAutoCutAccountSettings',
    'saveAutoCutWorkspaceSettings',
    'saveAutoCutNotificationSettings',
    'saveAutoCutLlmSettings',
    'initializeAutoCutDefaultLlmSettingsFromEnvironment',
    'saveAutoCutSpeechTranscriptionSettings',
    'resolveAutoCutLlmRuntimeConfig',
    'resolveAutoCutSpeechTranscriptionRuntimeConfig',
    'testAutoCutSpeechTranscriptionToolchain',
    'createAutoCutApiKey',
    'revokeAutoCutApiKey',
    'clearAutoCutStorageCache',
    'requestAutoCutAvatarChange',
    'openAutoCutSubscriptionManagement',
    'requestAutoCutPasswordChange',
    'setAutoCutTwoFactorEnabled',
    'cancelAutoCutSubscription',
    'deleteAutoCutAccount',
  ]) {
    assertIncludes(settingsService, `export async function ${exportName}`, `settings.service.ts exports ${exportName}`);
  }
}
assertIncludes(servicesIndex, "export * from './service/settings.service'", 'services index exports settings.service.ts');
assertRule(exists('packages/sdkwork-autocut-services/src/service/llm.service.ts'), '@sdkwork/autocut-services owns an llm.service.ts integration boundary');
if (exists('packages/sdkwork-autocut-services/src/service/llm.service.ts')) {
  const llmService = read('packages/sdkwork-autocut-services/src/service/llm.service.ts');
  assertIncludes(
    llmService,
    'export async function createAutoCutOpenAiCompatibleChatCompletion',
    'llm.service.ts exposes a single OpenAI-compatible chat completion boundary',
  );
  assertIncludes(
    llmService,
    'export async function testAutoCutLlmConnection',
    'llm.service.ts exposes an approved-bridge LLM connection test boundary',
  );
  assertIncludes(
    llmService,
    'resolveAutoCutLlmRuntimeConfig',
    'llm.service.ts consumes normalized LLM runtime config',
  );
  assertRule(!/fetch\(/u.test(llmService), 'llm.service.ts does not bypass the AI SDK boundary with raw fetch');
  assertRule(!/Authorization/u.test(llmService), 'llm.service.ts does not assemble Authorization headers manually');
}
assertIncludes(servicesIndex, "export * from './service/llm.service'", 'services index exports llm.service.ts');
assertRule(
  exists('packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts'),
  '@sdkwork/autocut-services owns a speech-transcription.service.ts provider boundary',
);
if (exists('packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts')) {
  assertRule(
    !/export\s+interface\s+AutoCutLocalSpeechTranscriptionSetupStatus/u.test(speechTranscriptionService),
    'speech-transcription.service.ts consumes the public local STT setup status contract from @sdkwork/autocut-types',
  );
  assertRule(
    !/export\s+interface\s+AutoCutLocalSpeechTranscriptionModelSetupResult/u.test(speechTranscriptionService) &&
      !/export\s+interface\s+AutoCutLocalSpeechTranscriptionSetupInitializationResult/u.test(speechTranscriptionService),
    'speech-transcription.service.ts consumes public local STT setup result contracts from @sdkwork/autocut-types',
  );
  assertIncludes(
    speechTranscriptionService,
    'export function getAutoCutSpeechTranscriptionProviderDefinitions',
    'speech-transcription.service.ts exposes canonical STT provider definitions',
  );
  assertIncludes(
    speechTranscriptionService,
    'export function resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset',
    'speech-transcription.service.ts exposes a recommended offline local STT model preset resolver',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function setupAutoCutLocalSpeechTranscriptionModelPreset',
    'speech-transcription.service.ts exposes guided one-click local STT model setup',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function inspectAutoCutLocalSpeechTranscriptionSetup',
    'speech-transcription.service.ts exposes a product-facing local STT setup inspection status',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function initializeAutoCutLocalSpeechTranscriptionSetup',
    'speech-transcription.service.ts exposes one product-facing local STT initialization action',
  );
  assertIncludes(
    speechTranscriptionService,
    'dispatchAutoCutSpeechTranscriptionModelDownloadProgress',
    'speech-transcription.service.ts publishes visible local STT model download progress through AutoCut events',
  );
  assertIncludes(
    speechTranscriptionService,
    'isAutoCutSpeechTranscriptionModelDownloadPhase',
    'speech-transcription.service.ts validates untrusted native local STT model download phases before publishing events',
  );
  assertIncludes(
    speechTranscriptionService,
    'unsupported local speech-to-text model download phase',
    'speech-transcription.service.ts rejects unsupported native local STT model download phases with an actionable error',
  );
  assertIncludes(
    speechTranscriptionService,
    'resolveAutoCutLocalSpeechTranscriptionModelPreset(progress.presetId)',
    'speech-transcription.service.ts resolves untrusted native local STT model download progress against the canonical preset registry',
  );
  assertIncludes(
    speechTranscriptionService,
    'progress.providerId !== preset.providerId',
    'speech-transcription.service.ts rejects native local STT model download progress whose provider does not match the registered preset',
  );
  assertIncludes(
    speechTranscriptionService,
    'progress.fileName !== preset.fileName',
    'speech-transcription.service.ts rejects native local STT model download progress whose fileName does not match the registered preset',
  );
  assertIncludes(
    speechTranscriptionService,
    'isAutoCutLocalSpeechTranscriptionModelPresetDownloadUrl(preset, sourceUrl)',
    'speech-transcription.service.ts rejects native local STT model download progress whose sourceUrl is not a registered primary or vetted mirror URL',
  );
  assertIncludes(
    speechTranscriptionService,
    'model download progress did not match the registered local speech-to-text model preset',
    'speech-transcription.service.ts explains native local STT model download preset mismatches with an actionable error',
  );
  assertIncludes(
    speechTranscriptionService,
    'localProviderIds',
    'speech-transcription.service.ts reports every supported local STT provider considered by setup inspection',
  );
  assertIncludes(
    speechTranscriptionService,
    'readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsModel',
    'speech-transcription.service.ts distinguishes missing local STT models from missing executables',
  );
  assertIncludes(
    speechTranscriptionService,
    'initializeAutoCutLocalSpeechTranscriptionModelForExecution',
    'speech-transcription.service.ts automatically initializes the local STT model before transcript-assisted execution when only modelPath is missing',
  );
  assertIncludes(
    speechTranscriptionService,
    'Local speech-to-text executable is missing',
    'speech-transcription.service.ts reports missing local STT executable diagnostics to the browser console instead of surfacing a generic Smart Slice parameter error',
  );
  assertIncludes(
    speechTranscriptionService,
    'export function configureAutoCutSpeechTranscriptionProviderBridge',
    'speech-transcription.service.ts exposes a standard API transcription bridge configurator',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function transcribeAutoCutMediaWithConfiguredProvider',
    'speech-transcription.service.ts exposes one configured-provider transcription entrypoint',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function testAutoCutSpeechTranscriptionProvider',
    'speech-transcription.service.ts exposes one configured-provider test entrypoint',
  );
  assertIncludes(
    speechTranscriptionService,
    'provider.kind === \'local\'',
    'speech-transcription.service.ts dispatches local STT providers through the local adapter',
  );
  assertIncludes(
    speechTranscriptionService,
    'provider.kind === \'api\'',
    'speech-transcription.service.ts dispatches API STT providers through the API bridge adapter',
  );
  assertIncludes(
    speechTranscriptionService,
    'nativeHostClient.transcribeMedia',
    'speech-transcription.service.ts is the only workflow-facing service allowed to call native local transcription',
  );
  assertIncludes(
    speechTranscriptionService,
    'providerId: runtime.providerId',
    'speech-transcription.service.ts sends the selected providerId to native local transcription',
  );
  assertIncludes(
    speechTranscriptionService,
    'ensureAutoCutLocalSpeechTranscriptionExecutionReady',
    'speech-transcription.service.ts centralizes execution-time local STT model and provider readiness checks',
  );
  assertIncludes(
    speechTranscriptionService,
    'sourceKind: \'execution-preflight\'',
    'speech-transcription.service.ts performs a fresh native execution preflight probe before local STT dispatch',
  );
  assertIncludes(
    speechTranscriptionService,
    'runtime.configured && runtime.lastProbeReady !== true',
    'speech-transcription.service.ts requires settings-backed local STT paths to pass provider validation before transcription',
  );
  assertIncludes(
    speechTranscriptionService,
    'validateAutoCutLocalSpeechTranscriptionModelDownloadResult',
    'speech-transcription.service.ts rejects incomplete local STT model downloads before saving modelPath',
  );
  assertIncludes(
    speechTranscriptionService,
    'requires the matching ModelVendor',
    'speech-transcription.service.ts guides API STT users to select a supported matching provider vendor before dispatch',
  );
  assertIncludes(
    speechTranscriptionService,
    'Run the speech-to-text provider test',
    'speech-transcription.service.ts gives operators an actionable local STT validation remediation',
  );
  assertIncludes(
    speechTranscriptionService,
    'normalizeAutoCutSpeechTranscriptionSegments',
    'speech-transcription.service.ts centralizes STT provider segment normalization',
  );
  assertIncludes(
    speechTranscriptionService,
    'dedupeRepeatedSpeech',
    'speech-transcription.service.ts owns optional repeated-speech dedupe at the STT normalization boundary',
  );
  assertIncludes(
    speechTranscriptionService,
    'dedupeAutoCutRepeatedSpeechText',
    'speech-transcription.service.ts removes adjacent repeated recognized phrases before Smart Slice planning',
  );
  assertIncludes(
    speechTranscriptionService,
    'valid timestamped speech segments',
    'speech-transcription.service.ts rejects provider results without structured timestamped speech segments',
  );
  assertIncludes(
    speechTranscriptionService,
    'to contain recognized speech text',
    'speech-transcription.service.ts rejects provider segments without recognized speech text',
  );
  assertIncludes(
    speechTranscriptionService,
    'endMs to be after startMs',
    'speech-transcription.service.ts rejects provider segments without positive speech duration',
  );
  assertIncludes(
    speechTranscriptionService,
    'finite non-negative timestamp',
    'speech-transcription.service.ts rejects provider segments with invalid speech timestamps',
  );
  assertRule(!/fetch\(/u.test(speechTranscriptionService), 'speech-transcription.service.ts does not bypass the provider bridge with raw fetch');
  assertRule(!/Authorization/u.test(speechTranscriptionService), 'speech-transcription.service.ts does not assemble provider Authorization headers manually');
}
assertIncludes(servicesIndex, "export * from './service/speech-transcription.service'", 'services index exports speech-transcription.service.ts');
assertRule(
  !exists('packages/sdkwork-autocut-services/src/service/ai-sdk-bridge.service.ts'),
  '@sdkwork/autocut-services does not keep the deprecated generated @sdkwork/ai-sdk bridge service',
);
assertRule(
  exists('packages/sdkwork-autocut-services/src/service/vercel-ai-sdk-bridge.service.ts'),
  '@sdkwork/autocut-services owns a Vercel AI SDK bridge service',
);
if (exists('packages/sdkwork-autocut-services/src/service/vercel-ai-sdk-bridge.service.ts')) {
  const aiSdkBridgeService = read('packages/sdkwork-autocut-services/src/service/vercel-ai-sdk-bridge.service.ts');
  assertIncludes(
    aiSdkBridgeService,
    "from 'ai'",
    'vercel-ai-sdk-bridge.service.ts imports the open-source Vercel AI SDK core package',
  );
  assertIncludes(
    aiSdkBridgeService,
    "from '@ai-sdk/openai-compatible'",
    'vercel-ai-sdk-bridge.service.ts imports the OpenAI-compatible Vercel AI SDK provider',
  );
  assertIncludes(
    aiSdkBridgeService,
    'export function configureAutoCutVercelAiSdkBridge',
    'vercel-ai-sdk-bridge.service.ts exposes a desktop startup bridge configurator',
  );
  assertIncludes(
    aiSdkBridgeService,
    'configureAutoCutApprovedAiSdkBridge',
    'vercel-ai-sdk-bridge.service.ts registers through the approved LLM bridge boundary',
  );
  assertIncludes(
    aiSdkBridgeService,
    'createOpenAICompatible',
    'vercel-ai-sdk-bridge.service.ts creates a provider from the runtime OpenAI-compatible endpoint',
  );
  assertIncludes(
    aiSdkBridgeService,
    'fetchAutoCutLlmViaNativeHost',
    'vercel-ai-sdk-bridge.service.ts routes OpenAI-compatible provider transport through the Tauri native host',
  );
  assertIncludes(
    aiSdkBridgeService,
    'generateText',
    'vercel-ai-sdk-bridge.service.ts creates chat completions through the Vercel AI SDK',
  );
  assertRule(!/fetch\(/u.test(aiSdkBridgeService), 'vercel-ai-sdk-bridge.service.ts does not bypass the Vercel AI SDK with raw fetch');
  assertRule(!/Authorization/u.test(aiSdkBridgeService), 'vercel-ai-sdk-bridge.service.ts does not assemble Authorization headers manually');
  assertRule(!aiSdkBridgeService.includes('@sdkwork/ai-sdk'), 'vercel-ai-sdk-bridge.service.ts does not import @sdkwork/ai-sdk');
}
assertIncludes(servicesIndex, "export * from './service/vercel-ai-sdk-bridge.service'", 'services index exports vercel-ai-sdk-bridge.service.ts');
const desktopMain = read('packages/sdkwork-autocut-desktop/src/main.tsx');
assertIncludes(desktopMain, 'configureAutoCutVercelAiSdkBridge', 'desktop startup configures the Vercel AI SDK bridge');
assertIncludes(desktopMain, 'initializeAutoCutDefaultLlmSettingsFromEnvironment', 'desktop startup initializes default LLM settings from native environment secrets');
assertIncludes(desktopMain, '.catch(() => undefined)', 'desktop startup ignores missing optional environment LLM defaults without blocking the app');
assertIncludes(storageService, 'settings:', 'storage.service.ts declares the settings storage key');
assertIncludes(eventsService, 'settingsUpdated:', 'events.service.ts emits settingsUpdated events');
assertIncludes(settingsPage, 'getAutoCutSettings', 'SettingsPage loads settings from the settings service');
assertIncludes(settingsPage, 'saveAutoCutAccountSettings', 'SettingsPage persists account edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutWorkspaceSettings', 'SettingsPage persists workspace edits through the settings service');
assertRule(exists(settingsRegistryPath), '@sdkwork/autocut-settings owns a standard Settings Center registry');
assertIncludes(settingsRegistry, 'AUTOCUT_SETTINGS_TABS', 'Settings Center registry defines canonical tab metadata');
assertIncludes(settingsRegistry, 'AUTOCUT_SETTINGS_LOCALE_OPTIONS', 'Settings Center registry defines canonical locale selector options');
assertIncludes(settingsRegistry, 'labelKey', 'Settings Center registry stores display labels as i18n keys');
assertIncludes(settingsRegistry, 'descriptionKey', 'Settings Center registry stores descriptions as i18n keys');
assertIncludes(settingsPage, "from '../service/settings.registry'", 'SettingsPage consumes the standard Settings Center registry');
assertIncludes(settingsPage, 'AUTOCUT_SETTINGS_TABS.map', 'SettingsPage renders tabs from canonical tab metadata');
assertIncludes(settingsPage, 'AUTOCUT_SETTINGS_LOCALE_OPTIONS.map', 'SettingsPage renders application locale options from canonical metadata');
assertIncludes(settingsPage, 'useTranslation', 'SettingsPage uses the open-source i18next React integration for visible text');
assertIncludes(settingsPage, "t('settings.page.title')", 'SettingsPage localizes the Settings Center title through i18n resources');
assertIncludes(settingsPage, "t('settings.toast.accountSaved')", 'SettingsPage localizes toast messages through i18n resources');
assertIncludes(settingsPage, "t('settings.status.ready')", 'SettingsPage localizes configuration status badges through i18n resources');
assertIncludes(settingsPage, 'handleWorkspaceLanguageChange', 'SettingsPage owns a dedicated application locale switching action');
assertIncludes(settingsPage, 'settings.workspace.language', 'SettingsPage renders the persisted canonical application locale');
assertRule(!settingsPage.includes('const tabs = ['), 'SettingsPage does not define tab labels inline');
assertRule(!settingsPage.includes('Speech-to-text provider settings saved'), 'SettingsPage does not hard-code speech-to-text save messages');
assertRule(!settingsPage.includes('Absolute local executable file path'), 'SettingsPage does not hard-code local speech executable guidance');
assertRule(!settingsPage.includes('Absolute local model file path'), 'SettingsPage does not hard-code local speech model guidance');
assertIncludes(settingsPage, 'settings.workspace.outputDirectory', 'SettingsPage renders the configured native output directory');
assertIncludes(settingsPage, 'handleChangeOutputDirectory', 'SettingsPage owns a default output directory update action');
assertIncludes(settingsPage, 'selectAutoCutTrustedLocalDirectory', 'SettingsPage uses the desktop trusted local directory chooser for workspace directories');
assertIncludes(settingsPage, 'handleChangeDirectory', 'SettingsPage owns a default storage directory chooser action');
assertMatches(
  settingsPage,
  /selectAutoCutTrustedLocalDirectory\(\)[\s\S]*defaultStoragePath:\s*selectedDirectory/u,
  'SettingsPage saves the selected native directory as defaultStoragePath',
);
assertMatches(
  settingsPage,
  /selectAutoCutTrustedLocalDirectory\(\)[\s\S]*outputDirectory:\s*selectedDirectory/u,
  'SettingsPage saves the selected native directory as outputDirectory',
);
assertRule(!settingsPage.includes('\\\\Exports'), 'SettingsPage does not synthesize a Windows-only default storage path');
assertIncludes(settingsPage, 'saveAutoCutNotificationSettings', 'SettingsPage persists notification edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutLlmSettings', 'SettingsPage persists LLM edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutSpeechTranscriptionSettings', 'SettingsPage persists speech-to-text provider edits through the settings service');
assertIncludes(settingsPage, 'testAutoCutSpeechTranscriptionProvider', 'SettingsPage invokes the selected speech-to-text provider test service');
assertIncludes(settingsPage, 'selectAutoCutSpeechTranscriptionFile', 'SettingsPage uses the trusted native speech tool file chooser');
assertIncludes(settingsPage, 'handleSpeechTranscriptionProviderChange', 'SettingsPage owns a provider switching action for speech-to-text');
assertIncludes(settingsPage, 'handleTestSpeechTranscriptionProvider', 'SettingsPage owns a dedicated selected speech-to-text provider test action');
assertIncludes(settingsPage, 'isTestingSpeechTranscription', 'SettingsPage disables duplicate local speech-to-text tests while pending');
assertMatches(settingsRegistry, /id:\s*'speech'/u, 'Settings Center registry exposes a dedicated speech-to-text provider settings tab');
assertIncludes(settingsPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS', 'SettingsPage renders the canonical speech-to-text provider registry');
assertIncludes(settingsPage, 'settings.speechTranscription.providerId', 'SettingsPage renders and persists the selected speech-to-text provider id');
assertIncludes(settingsPage, 'activeSpeechTranscriptionProvider.kind === \'local\'', 'SettingsPage shows local executable/model fields only for local STT providers');
assertIncludes(settingsPage, 'activeSpeechTranscriptionProvider.kind === \'api\'', 'SettingsPage shows API provider guidance only for API STT providers');
assertIncludes(settingsPage, 't(activeSpeechTranscriptionProvider.nameKey', 'SettingsPage localizes the selected speech-to-text provider display name');
assertIncludes(settingsPage, 'settings.speechTranscription.executablePath', 'SettingsPage renders the configured local speech executable path for local providers');
assertIncludes(settingsPage, 'settings.speechTranscription.modelPath', 'SettingsPage renders the configured local speech model path for local providers');
assertIncludes(settingsPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS', 'SettingsPage renders the canonical local speech language options');
assertIncludes(settingsPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS', 'SettingsPage documents supported local speech model file extensions');
assertIncludes(settingsPage, 'getAutoCutLocalSpeechTranscriptionModelPresets', 'SettingsPage renders local STT model acquisition presets through the service validation boundary');
assertIncludes(settingsPage, 'setupAutoCutLocalSpeechTranscriptionModelPreset', 'SettingsPage offers guided one-click local STT model setup through the service boundary');
assertIncludes(settingsPage, 'inspectAutoCutLocalSpeechTranscriptionSetup', 'SettingsPage loads local STT setup inspection status through the service boundary');
assertIncludes(settingsPage, 'initializeAutoCutLocalSpeechTranscriptionSetup', 'SettingsPage runs local STT initialization through the service boundary');
assertIncludes(settingsPage, "listenAutoCutEvent('speechTranscriptionModelDownloadProgress'", 'SettingsPage listens for visible local STT model download progress events');
assertRule(!settingsPage.includes("listenAutoCutEvent('speechTranscriptionExecutableDownloadProgress'"), 'SettingsPage does not listen for executable download progress because whisper-cli is packaged as a sidecar');
assertIncludes(settingsPage, 'speechSetupStatus', 'SettingsPage renders a productized local STT setup status object');
assertIncludes(settingsPage, 'speechModelDownloadProgress', 'SettingsPage stores visible local STT model download progress state');
assertIncludes(settingsPage, 'speechModelDownloadCompleted', 'SettingsPage separates completed local STT model downloads from the final availability check');
assertIncludes(settingsPage, 'settings.speech.modelSavedNeedsCheckDescription', 'SettingsPage explains that a saved model can still need a final availability check');
assertIncludes(settingsPage, 'createSettingsSpeechSetupFriendlyError', 'SettingsPage converts technical local STT setup failures into user-facing toast messages');
assertIncludes(settingsPage, 'settings.speech.readinessTitle', 'SettingsPage renders a user-facing local STT readiness summary');
assertIncludes(settingsPage, 'downloadedBytes', 'SettingsPage displays local STT model download byte progress');
assertIncludes(settingsPage, 'totalBytes', 'SettingsPage displays local STT model download total byte progress when available');
assertIncludes(settingsPage, 'handleInitializeSpeechTranscriptionSetup', 'SettingsPage owns a single local STT initialize action that detects executable, downloads model, and verifies probe');
assertIncludes(settingsPage, 'handleSetupSpeechTranscriptionModelPreset', 'SettingsPage owns a one-click local STT model setup action');
assertIncludes(settingsPage, 'isConfiguringSpeechModel', 'SettingsPage disables duplicate local STT model setup while pending');
assertIncludes(settingsPage, 'waitForSettingsUiYield', 'SettingsPage yields to the browser renderer before long-running local STT setup actions');
assertMatches(
  settingsPage,
  /setIsConfiguringSpeechModel\(true\);[\s\S]*await waitForSettingsUiYield\(\);[\s\S]*setupAutoCutLocalSpeechTranscriptionModelPreset/u,
  'SettingsPage paints the local STT model setup pending state before starting the model setup workflow',
);
assertMatches(
  settingsPage,
  /setSpeechModelDownloadProgress\(null\);[\s\S]*await waitForSettingsUiYield\(\);[\s\S]*initializeAutoCutLocalSpeechTranscriptionSetup/u,
  'SettingsPage paints the local STT initialization pending state before starting the full setup workflow',
);
assertIncludes(settingsPage, "t('settings.action.initializeSpeech')", 'SettingsPage makes local STT initialization a localized primary action');
assertIncludes(settingsPage, "t('settings.action.useAndDownloadModel')", 'SettingsPage makes guided local STT model setup the primary model catalog action');
assertIncludes(settingsPage, 'downloadAutoCutLocalSpeechTranscriptionModelPreset', 'SettingsPage downloads local STT model presets through the service validation boundary');
assertIncludes(settingsPage, 'copyAutoCutLocalSpeechTranscriptionModelPresetUrl', 'SettingsPage copies local STT model preset URLs through the service validation boundary');
assertIncludes(settingsPage, 'handleCopySpeechTranscriptionModelPresetUrl', 'SettingsPage can copy vetted local STT model download URLs without treating them as modelPath values');
assertRule(!settingsPage.includes('downloadAutoCutUrl(modelPreset.url'), 'SettingsPage does not directly download raw local STT model preset URLs');
assertRule(!settingsPage.includes('writeAutoCutClipboardText(modelPreset.url'), 'SettingsPage does not directly copy raw local STT model preset URLs');
assertIncludes(settingsPage, 'settings.speech.modelCatalog', 'SettingsPage localizes the local STT model download catalog section');
assertIncludes(settingsPage, 'speechSetupChecklist', 'SettingsPage builds an explicit local STT setup checklist');
assertMatches(
  settingsPage,
  /activeSpeechTranscriptionProvider\.kind === 'local' && \([\s\S]*speechSetupChecklist\.map/u,
  'SettingsPage renders the local STT setup checklist only for local providers',
);
assertIncludes(settingsPage, 'executableReady', 'SettingsPage shows whether the local STT executable path is configured');
assertIncludes(settingsPage, 'modelReady', 'SettingsPage shows whether the local STT model path is configured');
assertIncludes(settingsPage, 'testReady', 'SettingsPage shows whether the selected STT provider has passed a probe test');
assertMatches(
  settingsPage,
  /import\s+type\s+\{[\s\S]*AutoCutLocalSpeechTranscriptionSetupStatus[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-types['"]/u,
  'SettingsPage imports public local STT setup status types from @sdkwork/autocut-types',
);
assertMatches(
  settingsPage,
  /import\s+type\s+\{[\s\S]*AutoCutSpeechTranscriptionModelDownloadProgressEvent[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-types['"]/u,
  'SettingsPage imports public local STT model download progress types from @sdkwork/autocut-types',
);
assertIncludes(
  settingsPage,
  'readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.downloading',
  'SettingsPage treats active model download as a distinct local STT setup state',
);
assertIncludes(
  settingsPage,
  'isAutoCutSpeechTranscriptionModelDownloadTerminalPhase',
  'SettingsPage consumes the canonical local STT model download terminal-phase helper',
);
assertRule(
  !settingsPage.includes('terminalSpeechModelDownloadPhases'),
  'SettingsPage does not maintain a local copy of local STT model download terminal phases',
);
assertIncludes(settingsPage, "t('settings.speech.setupStatus.downloading')", 'SettingsPage localizes the active local STT model download state');
assertIncludes(settingsPage, 'speechRuntimeReady', 'SettingsPage separates local STT runtime readiness from path-only configuration');
assertIncludes(
  settingsPage,
  "activeSpeechTranscriptionProvider.kind === 'local' ? testReady : settings.speechTranscription.configured",
  'SettingsPage only marks local STT ready after the selected provider passes validation',
);
assertIncludes(settingsPage, 'lastProbeDiagnostics', 'SettingsPage renders speech-to-text probe diagnostics for failed local setup');
assertIncludes(settingsPage, 'resetSpeechTranscriptionProbeState', 'SettingsPage clears stale speech-to-text probe results whenever provider configuration changes');
assertIncludes(i18nResources, 'setupChecklist', 'i18n resources include the local speech-to-text setup checklist label');
assertIncludes(i18nResources, 'initializeSpeech', 'i18n resources include the one-click local speech-to-text initialize action label');
assertIncludes(i18nResources, 'setupStatus', 'i18n resources include local speech-to-text setup status labels');
assertIncludes(i18nResources, 'downloadProgress', 'i18n resources include local speech-to-text model download progress labels');
assertIncludes(i18nResources, 'modelDownloadCompleted', 'i18n resources include a friendly completed local STT model download label');
assertIncludes(i18nResources, 'modelSavedNeedsCheckDescription', 'i18n resources explain completed model download separately from readiness checks');
assertIncludes(i18nResources, 'speechSetupAvailabilityFailed', 'i18n resources include a user-facing local STT availability check failure toast');
assertIncludes(i18nResources, 'diagnostics', 'i18n resources include the local speech-to-text diagnostics label');
assertIncludes(settingsPage, "t('settings.speech.local.executableHelp')", 'SettingsPage explains the local speech executable path contract through i18n');
assertIncludes(settingsPage, "t('settings.speech.local.modelHelp'", 'SettingsPage explains the local speech model path contract through i18n');
assertIncludes(settingsPage, 'testAutoCutLlmConnection', 'SettingsPage invokes the LLM connection test service');
assertIncludes(settingsPage, 'handleTestLlmConnection', 'SettingsPage owns a dedicated LLM connection test action');
assertIncludes(settingsPage, 'isTestingLlmConnection', 'SettingsPage disables duplicate LLM connection tests while pending');
assertIncludes(settingsPage, "t('settings.action.testConnection')", 'SettingsPage exposes a localized click target for testing the LLM connection');
assertIncludes(settingsPage, 'AUTOCUT_MODEL_VENDOR_PRESETS', 'SettingsPage renders the canonical ModelVendor presets');
assertIncludes(settingsPage, 'AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS', 'SettingsPage renders the canonical Smart Slice segmentation agent registry');
assertIncludes(settingsPage, 'settings.llm.defaultSegmentationAgentId', 'SettingsPage persists the default Smart Slice segmentation agent');
assertIncludes(settingsPage, 'agent.systemPrompt', 'SettingsPage lets users inspect segmentation agent system prompts');
assertIncludes(settingsPage, 'settings.llm.segmentationAgent', 'SettingsPage exposes segmentation agent configuration in the LLM settings tab');
assertIncludes(settingsPage, 't(preset.labelKey)', 'SettingsPage localizes ModelVendor labels from the canonical registry');
assertIncludes(settingsPage, 't(preset.descriptionKey)', 'SettingsPage localizes ModelVendor guidance from the canonical registry');
assertIncludes(settingsPage, "t(`settings.llm.region.${activeLlmVendorPreset.region}`)", 'SettingsPage localizes the active ModelVendor region metadata');
assertIncludes(settingsPage, "t('settings.llm.runtime.openAiCompatible')", 'SettingsPage displays the standardized OpenAI-compatible runtime contract through i18n');
assertIncludes(settingsPage, 'getAutoCutModelPreset', 'SettingsPage resolves the active LLM model preset for dynamic limits');
assertIncludes(settingsPage, 'activeLlmModelPreset.maxOutputTokens', 'SettingsPage renders model-specific Max Tokens constraints');
assertRule(!settingsPage.includes('max={128000}'), 'SettingsPage does not hard-code a global Max Tokens ceiling');
assertMatches(settingsRegistry, /id:\s*'llm'/u, 'Settings Center registry exposes a dedicated LLM settings tab');
assertIncludes(settingsPage, 'settings.llm.maskedApiKey', 'SettingsPage renders masked LLM API keys instead of raw secrets');
const typesSource = read('packages/sdkwork-autocut-types/src/index.ts');
assertIncludes(typesSource, "| 'talking-head'", 'SliceMode uses stable Smart Cut strategy ids instead of localized display strings');
assertIncludes(typesSource, "| 'commerce-live'", 'SliceMode exposes the commerce-live strategy id for product-aware slicing');
assertRule(!/export type SliceMode =[\s\S]*?[\u00c0-\u00ff]\u0080?[\s\S]*?;/u.test(typesSource), 'SliceMode does not contain mojibake or localized display labels');
assertIncludes(typesSource, 'outputDirectory: string', 'AutoCut workspace settings include configurable outputDirectory');
assertIncludes(typesSource, 'AUTOCUT_APP_LOCALES', 'AutoCut types centralize supported application locales');
assertIncludes(typesSource, 'AutoCutAppLocale', 'AutoCut types define canonical application locale values');
assertIncludes(typesSource, 'language: AutoCutAppLocale', 'AutoCut workspace settings store a canonical application locale enum value');
assertIncludes(typesSource, 'AutoCutSpeechTranscriptionSettings', 'AutoCut types define speech-to-text provider settings');
assertIncludes(typesSource, 'speechTranscription: AutoCutSpeechTranscriptionSettings', 'AppSettings includes local speech-to-text settings');
assertIncludes(typesSource, 'AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS', 'Types package exposes canonical local STT model acquisition presets');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionModelPreset', 'Types package defines a typed local STT model acquisition preset contract');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionSetupStatus', 'Types package owns the public local STT setup status contract');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionModelSetupResult', 'Types package owns the public local STT model setup result contract');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionSetupInitializationResult', 'Types package owns the public local STT setup initialization result contract');
assertIncludes(typesSource, 'isAutoCutSpeechTranscriptionModelDownloadPhase', 'Types package owns the canonical local STT model download phase type guard');
assertIncludes(typesSource, 'isAutoCutSpeechTranscriptionModelDownloadTerminalPhase', 'Types package owns the canonical local STT model download terminal-phase helper');
assertIncludes(typesSource, 'capabilities: {', 'Public local STT setup status exposes native capability readiness to product UI');
assertIncludes(typesSource, 'AutoCutWorkflowPreferences', 'AutoCut types define standard workflow parameter preferences');
assertIncludes(typesSource, 'AutoCutSmartSliceSegmentationAgentId', 'AutoCut types define stable Smart Slice segmentation agent ids');
assertIncludes(typesSource, 'AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS', 'AutoCut types expose the canonical Smart Slice segmentation agent registry');
assertIncludes(typesSource, 'AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID', 'AutoCut types define a default Smart Slice segmentation agent');
assertIncludes(typesSource, 'systemPrompt: string', 'AutoCut Smart Slice segmentation agents publish auditable system prompts');
assertIncludes(typesSource, 'defaultSegmentationAgentId', 'AutoCut LLM settings store the default Smart Slice segmentation agent');
assertIncludes(typesSource, 'segmentationAgentId?: AutoCutSmartSliceSegmentationAgentId', 'VideoSliceParams carries the selected Smart Slice segmentation agent');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER', 'AutoCut types centralize stable speech transcription provider constants');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS', 'AutoCut types centralize speech transcription provider registry definitions');
assertIncludes(typesSource, 'AutoCutSpeechTranscriptionProviderId', 'AutoCut types define the stable speech transcription provider id enum type');
assertIncludes(typesSource, 'providerId: AutoCutSpeechTranscriptionProviderId', 'AutoCut speech settings store the selected provider as an English enum id');
assertIncludes(typesSource, "'local-whisper-cli'", 'AutoCut STT provider registry includes local Whisper CLI');
assertRule(!typesSource.includes("localFasterWhisper: 'local-faster-whisper'"), 'AutoCut STT provider constants do not expose local faster-whisper before native execution exists');
assertRule(!typesSource.includes("localWhisperCpp: 'local-whisper-cpp'"), 'AutoCut STT provider constants do not expose local whisper.cpp before native execution exists');
assertRule(!typesSource.includes("| 'faster-whisper'"), 'AutoCut local STT engine type only includes engines with implemented native execution');
assertRule(!typesSource.includes("| 'whisper-cpp'"), 'AutoCut local STT engine type does not expose a separate whisper.cpp runtime until implemented end-to-end');
assertRule(!typesSource.includes("id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localFasterWhisper"), 'AutoCut STT provider registry does not expose local faster-whisper until native command execution is implemented');
assertRule(!typesSource.includes("id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCpp"), 'AutoCut STT provider registry does not expose local whisper.cpp as a separate provider until native command execution is implemented');
assertIncludes(typesSource, "'openai-transcription'", 'AutoCut STT provider registry includes OpenAI transcription API');
assertIncludes(typesSource, "'qwen-transcription'", 'AutoCut STT provider registry includes Qwen transcription API');
assertIncludes(typesSource, "'gemini-transcription'", 'AutoCut STT provider registry includes Gemini transcription API');
assertIncludes(typesSource, "'custom-openai-compatible-transcription'", 'AutoCut STT provider registry includes a custom OpenAI-compatible transcription API');
assertIncludes(typesSource, "'iflytek-long-form'", 'AutoCut STT provider registry includes iFlytek long-form ASR');
assertIncludes(typesSource, "'volcengine-asr'", 'AutoCut STT provider registry includes Volcengine ASR');
assertIncludes(typesSource, "'qwen-paraformer'", 'AutoCut STT provider registry includes Alibaba Qwen Paraformer recorded ASR');
assertIncludes(typesSource, "'tencent-cloud-asr'", 'AutoCut STT provider registry includes Tencent Cloud ASR');
assertIncludes(typesSource, "'baidu-cloud-asr'", 'AutoCut STT provider registry includes Baidu Cloud ASR');
assertIncludes(typesSource, 'officialDocsUrl', 'AutoCut STT provider definitions carry official documentation URLs');
assertIncludes(typesSource, 'optionSchema', 'AutoCut STT provider definitions expose a typed option schema for Settings Center');
assertIncludes(typesSource, 'requiredForSmartSlice', 'AutoCut STT provider options mark timestamp-critical parameters for Smart Slice');
assertIncludes(typesSource, 'providerOptions?: AutoCutSpeechTranscriptionProviderOptions', 'AutoCut speech settings persist provider-specific standard STT options');
assertIncludes(typesSource, 'requiresLongAudio: true', 'Cloud STT providers explicitly require long-audio mode for Smart Slice');
assertIncludes(typesSource, 'requiresSegmentTimestamps: true', 'Cloud STT providers explicitly require segment timestamps for Smart Slice');
assertIncludes(typesSource, 'AUTOCUT_SMART_SLICE_CLOUD_STT_PROVIDER_IDS', 'AutoCut types expose the standard Smart Slice cloud STT provider set');
assertIncludes(settingsPage, 'activeSpeechTranscriptionProvider.optionSchema', 'Settings Center renders STT provider parameters from the canonical option schema');
assertIncludes(settingsPage, 'providerOptions', 'Settings Center stores STT provider option edits in speechTranscription.providerOptions');
assertRule(!i18nResources.includes('localFasterWhisper'), 'AutoCut i18n resources do not keep unreachable local faster-whisper provider copy');
assertRule(!i18nResources.includes('localWhisperCpp'), 'AutoCut i18n resources do not keep unreachable local whisper.cpp provider copy');
assertRule(
  !/[\u00c0-\u00ff]\u0080?|\uFFFD/u.test(i18nResources),
  'AutoCut i18n resources do not contain mojibake or replacement characters',
);
assertIncludes(normalizedSettingsZhMessages, "readinessTitle: '语音识别状态'", 'zh-CN i18n resources localize the local STT readiness summary in Chinese');
assertIncludes(normalizedSettingsZhMessages, "setupStatus: {\n      label: '准备状态'", 'zh-CN i18n resources localize local STT setup status in Chinese');
assertIncludes(normalizedSettingsZhMessages, "modelCatalog: '离线模型'", 'zh-CN i18n resources localize the local STT model catalog in Chinese');
assertRule(!normalizedSettingsZhMessages.includes("setupChecklist: 'Local setup checklist'"), 'zh-CN settings resources do not fall back to English local STT setup copy');
assertIncludes(normalizedSettingsEnMessages, "readinessTitle: 'Speech recognition status'", 'en-US i18n resources localize the local STT readiness summary in English');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS', 'AutoCut types centralize supported speech transcription language options');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS', 'AutoCut types centralize supported local speech model file extensions');
const workflowPreferencesService = read('packages/sdkwork-autocut-services/src/service/workflow-preferences.service.ts');
assertIncludes(workflowPreferencesService, 'getAutoCutWorkflowPreferences', 'workflow-preferences.service.ts loads persisted workflow parameter preferences');
assertIncludes(workflowPreferencesService, 'saveAutoCutVideoSlicePreferences', 'workflow-preferences.service.ts persists video slice parameters');
assertIncludes(workflowPreferencesService, 'segmentationAgentId', 'workflow-preferences.service.ts persists the selected Smart Slice segmentation agent');
assertIncludes(workflowPreferencesService, 'AUTOCUT_SMART_SLICE_SEGMENTATION_AGENT_IDS', 'workflow-preferences.service.ts validates segmentation agents against the canonical registry');
assertIncludes(workflowPreferencesService, 'saveAutoCutTextExtractionPreferences', 'workflow-preferences.service.ts persists text extraction parameters');
assertIncludes(workflowPreferencesService, 'enableNoiseReduction: true', 'workflow-preferences.service.ts defaults Smart Slice generated artifact denoise to on before silence removal');
assertNotIncludes(workflowPreferencesService, 'sliceCountMode', 'workflow-preferences.service.ts does not persist legacy Smart Slice count strategy');
assertNotIncludes(workflowPreferencesService, 'targetSliceCount', 'workflow-preferences.service.ts does not persist legacy Smart Slice target clip count');
assertIncludes(serviceBehaviorCheck, 'workflow parameter preferences store disabled broadband denoise after disabled denoise input', 'service behavior check covers persisted disabled denoise preferences');
assertIncludes(servicesIndex, "export * from './service/workflow-preferences.service'", 'services index exports workflow-preferences.service.ts');
const extractorTextPage = read('packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx');
for (const audioBearingPageContract of [
  {
    source: read('packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx'),
    name: 'AudioExtractorPage',
  },
  {
    source: read('packages/sdkwork-autocut-subtitle-translate/src/pages/SubtitleTranslatePage.tsx'),
    name: 'SubtitleTranslatePage',
  },
  {
    source: read('packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx'),
    name: 'VoiceTranslatePage',
  },
]) {
  assertIncludes(
    audioBearingPageContract.source,
    'accept="audio/*,video/*"',
    `${audioBearingPageContract.name} accepts every local media file type that can carry audio`,
  );
  assertIncludes(
    audioBearingPageContract.source,
    "selectAutoCutTrustedLocalMediaFile(['audio', 'video'])",
    `${audioBearingPageContract.name} opens the trusted desktop chooser with both audio and video enabled`,
  );
}
assertIncludes(extractorTextPage, 'accept="audio/*,video/*"', 'ExtractorTextPage accepts both local audio and video sources');
assertIncludes(
  extractorTextPage,
  "selectAutoCutTrustedLocalMediaFile(['audio', 'video'])",
  'ExtractorTextPage opens the trusted desktop chooser with both audio and video enabled',
);

const currentAudioBearingToolSurfacePaths = [
  'packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx',
  'packages/sdkwork-autocut-extractor-audio/src/service/audioExtractorService.ts',
  'packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx',
  'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts',
  'packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx',
  'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts',
];
for (const relativePath of currentAudioBearingToolSurfacePaths) {
  const source = read(relativePath);
  assertRule(
    !/[\u00c0-\u00ff]|\uFFFD/u.test(source),
    `${relativePath} exposes readable standardized text instead of mojibake in current media tool surfaces`,
  );
}
const voiceTranslatePageSource = read('packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx');
const voiceTranslateServiceSource = read('packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts');
assertNotIncludes(typesSource, 'voiceCloneSync', 'VoiceTranslateParams does not expose voice cloning before native TTS exists end-to-end');
assertNotIncludes(typesSource, 'bgmHandling', 'VoiceTranslateParams does not expose background music handling before native dubbing exists end-to-end');
assertNotIncludes(voiceTranslatePageSource, 'voiceModel', 'VoiceTranslatePage does not expose unimplemented voice model controls');
assertNotIncludes(voiceTranslatePageSource, 'voiceCloneSync', 'VoiceTranslatePage does not submit unimplemented voice cloning parameters');
assertNotIncludes(voiceTranslatePageSource, 'bgmHandling', 'VoiceTranslatePage does not submit unimplemented dubbing background music parameters');
assertRule(!/\bclone\b|\bdubbing\b|\bdubbed\b|TTS/u.test(voiceTranslatePageSource), 'VoiceTranslatePage copy only promises translated transcript/SRT output');
assertRule(!/\bclone\b|\bdubbing\b|\bdubbed\b|TTS/u.test(voiceTranslateServiceSource), 'voiceTranslateService copy only reports translated transcript/SRT output');
assertIncludes(
  extractorTextPage,
  '音视频',
  'ExtractorTextPage describes text extraction as an audio/video workflow, not audio-only',
);
assertRule(
  !extractorTextPage.includes('识别音频内容'),
  'ExtractorTextPage processing copy must not describe text extraction as audio-only',
);
assertIncludes(extractorTextPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS', 'ExtractorTextPage renders the canonical speech language selector options');
assertIncludes(extractorTextPage, 'getAutoCutWorkflowPreferences', 'ExtractorTextPage loads persisted text extraction preferences');
assertIncludes(extractorTextPage, 'saveAutoCutTextExtractionPreferences', 'ExtractorTextPage persists the last-used text extraction parameters before processing');
for (const requiredModelVendor of [
  'deepseek',
  'openai',
  'anthropic',
  'gemini',
  'xai',
  'qwen',
  'moonshot',
  'baidu',
  'zhipu',
  'minimax',
  'hunyuan',
  'doubao',
  'custom',
]) {
  assertIncludes(typesSource, `'${requiredModelVendor}'`, `AutoCut ModelVendor includes stable vendor id ${requiredModelVendor}`);
  assertIncludes(typesSource, `${requiredModelVendor}: {`, `AutoCut model vendor registry includes ${requiredModelVendor}`);
}
for (const requiredVendorMetadata of [
  'region: \'china\'',
  'region: \'us\'',
  'labelKey: \'settings.llm.vendor.openai.label\'',
  'descriptionKey: \'settings.llm.vendor.qwen.description\'',
  'descriptionKey: \'settings.llm.vendor.custom.description\'',
]) {
  assertIncludes(typesSource, requiredVendorMetadata, `AutoCut model vendor registry stores display metadata ${requiredVendorMetadata}`);
}
for (const latestOpenAiModel of ['gpt-5.2', 'gpt-5.2-chat-latest', 'gpt-5.2-pro', 'gpt-5.1', 'gpt-5.1-codex']) {
  assertIncludes(typesSource, `'${latestOpenAiModel}'`, `AutoCut model presets include latest OpenAI model ${latestOpenAiModel}`);
}
for (const latestAnthropicModel of ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']) {
  assertIncludes(typesSource, `'${latestAnthropicModel}'`, `AutoCut model presets include latest Anthropic model ${latestAnthropicModel}`);
}
for (const latestGeminiModel of ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro']) {
  assertIncludes(typesSource, `'${latestGeminiModel}'`, `AutoCut model presets include latest Gemini model ${latestGeminiModel}`);
}
for (const latestXaiModel of ['grok-4.1', 'grok-4.1-fast', 'grok-4.1-mini', 'grok-4-fast-reasoning']) {
  assertIncludes(typesSource, `'${latestXaiModel}'`, `AutoCut model presets include latest xAI model ${latestXaiModel}`);
}
for (const latestChinaModel of [
  'qwen3.6-plus',
  'qwen3.6-flash',
  'kimi-k2-0905-preview',
  'kimi-latest',
  'ernie-5.0-preview',
  'ernie-4.5-turbo-128k',
  'glm-4.6',
  'glm-4.5',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'hunyuan-t1-latest',
  'hunyuan-turbos-latest',
  'doubao-seed-2-0-pro-250828',
  'doubao-seed-2-0-flash-250828',
]) {
  assertIncludes(typesSource, `'${latestChinaModel}'`, `AutoCut model presets include mainstream China model ${latestChinaModel}`);
}
assertIncludes(typesSource, "defaultModel: 'gpt-5.2'", 'OpenAI ModelVendor defaults to the current flagship GPT model id');
assertIncludes(typesSource, "defaultModel: 'gemini-3.1-pro-preview'", 'Gemini ModelVendor defaults to the active Gemini Pro Preview model id');
assertIncludes(typesSource, "defaultModel: 'claude-sonnet-4-5-20250929'", 'Anthropic ModelVendor defaults to the current balanced Claude Sonnet model id');
assertIncludes(typesSource, "defaultModel: 'grok-4.1'", 'xAI ModelVendor defaults to the current Grok flagship model id');
assertIncludes(typesSource, "defaultModel: 'qwen3.6-plus'", 'Qwen ModelVendor defaults to the latest Qwen Plus family model id');
assertIncludes(typesSource, "defaultModel: 'kimi-k2-0905-preview'", 'Moonshot ModelVendor defaults to the latest Kimi K2 API model id');
assertIncludes(typesSource, "defaultModel: 'ernie-5.0-preview'", 'Baidu ModelVendor defaults to the latest ERNIE API model id');
assertIncludes(typesSource, "defaultModel: 'glm-4.6'", 'Zhipu ModelVendor defaults to the current GLM flagship model id');
assertIncludes(typesSource, "defaultModel: 'MiniMax-M2.7'", 'MiniMax ModelVendor defaults to the latest MiniMax flagship model id');
assertIncludes(typesSource, "defaultModel: 'hunyuan-t1-latest'", 'Hunyuan ModelVendor defaults to the current reasoning-capable Hunyuan model id');
assertIncludes(typesSource, "defaultModel: 'doubao-seed-2-0-pro-250828'", 'Doubao ModelVendor defaults to the latest Doubao Seed 2.0 Pro model id');
assertRule(!typesSource.includes("'gpt-5.5'"), 'AutoCut model presets do not include non-official OpenAI model id gpt-5.5');
assertRule(!typesSource.includes("'claude-opus-4-7'"), 'AutoCut model presets do not include non-official Anthropic model id claude-opus-4-7');
assertRule(!typesSource.includes("'gemini-3-pro-preview'"), 'AutoCut model presets do not include the retired Gemini 3 Pro Preview model id');
assertRule(!typesSource.includes("'grok-4.3'"), 'AutoCut model presets do not include non-official xAI model id grok-4.3');
assertIncludes(typesSource, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS', 'AutoCut types export one centralized slicer LLM option list');
assertIncludes(slicerPage, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS', 'Slicer LLM selector consumes the centralized LLM option list');
assertIncludes(slicerPage, 'activeLlmRuntimeModelVendor', 'Slicer tracks the active Settings Center LLM ModelVendor');
assertIncludes(slicerPage, 'activeLlmModelOptions', 'Slicer filters LLM model options to the active Settings Center ModelVendor');
assertIncludes(slicerPage, 'model.vendor === activeLlmRuntimeModelVendor', 'Slicer prevents cross-provider model selection from mismatching baseUrl and API key');
assertIncludes(slicerPage, 'visibleLlmModelOptions.map', 'Slicer LLM selector renders only active-provider model options from centralized config');
assertIncludes(slicerPage, 'AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS', 'Slicer exposes the canonical Smart Slice segmentation agent registry');
assertIncludes(slicerPage, 'segmentationAgentId', 'Slicer submits the selected Smart Slice segmentation agent id into VideoSliceParams');
assertNotIncludes(slicerPage, '<pre', 'SlicerPage does not show raw segmentation agent system prompts inside the simplified Smart Slice settings panel');
assertNotIncludes(slicerPage, 'selectedSegmentationAgent.systemPrompt', 'SlicerPage keeps raw segmentation agent prompts out of the simplified Smart Slice settings panel');
assertNotIncludes(slicerPage, "'description',\n                            selectedSegmentationAgent.description", 'SlicerPage does not show segmentation-agent implementation descriptions in the simplified settings panel');
assertIncludes(slicerPage, 'setSegmentationAgentId', 'Slicer lets users choose a Smart Slice segmentation agent implementation');
assertIncludes(slicerPage, 'executionSupport', 'SlicerPage models Smart Cut strategy execution capability explicitly instead of relying on copy');
assertIncludes(slicerPage, 'UNSUPPORTED_VISUAL_PRESET_EVIDENCE', 'SlicerPage surfaces the same unsupported visual evidence blocker code as the planner');
assertIncludes(slicerPage, "t('slicer.settings.advanced.scene')", 'SlicerPage keeps scene selection available only inside localized advanced settings');
assertNotIncludes(slicerPage, 'Strategy Capability', 'SlicerPage removes commercial strategy capability copy from the simplified settings panel');
assertNotIncludes(slicerPage, 'data-smart-cut-strategy-status', 'SlicerPage no longer exposes dense per-strategy status cards in the default workflow');
assertIncludes(slicerPage, 'split(/[,\\n;\\uFF0C\\u3001]+/u)', 'SlicerPage parses custom keywords with a clean comma/newline/semicolon delimiter instead of mojibake');
assertRule(
  !/[^\u0000-\u007f]/u.test(slicerPage),
  'SlicerPage contains only ASCII source text so the commercial workbench has no mojibake or polluted regex literals',
);
assertRule(
  exists('scripts/check-autocut-baidunetdisk-real-media-slice.mjs'),
  'AutoCut provides a one-command BaiduNetdisk real-media Smart Slice acceptance check',
);
assertIncludes(rootPackageJson, 'acceptance:smart-slice-baidunetdisk', 'package.json exposes the BaiduNetdisk Smart Slice acceptance check as a first-class script');
const smartSlicePerformanceBenchmark = read('scripts/check-autocut-smart-slice-performance-benchmark.mjs');
const smartSlicePerformanceBenchmarkTest = read('scripts/check-autocut-smart-slice-performance-benchmark.test.mjs');
const genericRealMediaSlice = read('scripts/check-autocut-generic-real-media-slice.mjs');
const genericRealMediaSliceTest = read('scripts/check-autocut-generic-real-media-slice.test.mjs');
const largeMediaBaseline = read('scripts/check-autocut-large-media-baseline.mjs');
const largeMediaBaselineTest = read('scripts/check-autocut-large-media-baseline.test.mjs');
const largeMediaSttBaseline = read('scripts/write-autocut-large-media-stt-baseline.mjs');
const largeMediaSttBaselineTest = read('scripts/write-autocut-large-media-stt-baseline.test.mjs');
assertRule(
  exists('scripts/check-autocut-smart-slice-performance-benchmark.mjs'),
  'AutoCut provides a repeatable Smart Slice performance benchmark command',
);
assertIncludes(rootPackageJson, 'benchmark:smart-slice-performance', 'package.json exposes the Smart Slice performance benchmark as a first-class script');
assertIncludes(smartSlicePerformanceBenchmark, 'smart-slice.performance-benchmark.v1', 'Smart Slice performance benchmark writes a versioned report schema');
assertIncludes(smartSlicePerformanceBenchmark, 'byteSize: readFileByteSize(resolvedInputPath)', 'Smart Slice performance benchmark records source file size for large-file trend analysis');
assertIncludes(smartSlicePerformanceBenchmark, 'totalElapsedMs', 'Smart Slice performance benchmark records total elapsed time');
assertIncludes(smartSlicePerformanceBenchmark, 'totalOutputBytes', 'Smart Slice performance benchmark records rendered output bytes');
assertIncludes(smartSlicePerformanceBenchmark, 'executionEvidenceReport', 'Smart Slice performance benchmark includes execution evidence readiness in the report');
assertIncludes(smartSlicePerformanceBenchmark, 'runAutoCutGenericRealMediaSliceCheck', 'Smart Slice performance benchmark routes same-source transcripts through the generic real-media runner');
assertIncludes(smartSlicePerformanceBenchmarkTest, 'generic-real-media', 'Smart Slice performance benchmark test covers generic real-media runner selection');
assertIncludes(smartSlicePerformanceBenchmark, 'SMART_SLICE_PERFORMANCE_TOTAL_ELAPSED_EXCEEDED', 'Smart Slice performance benchmark can fail closed on configured elapsed-time thresholds');
assertIncludes(smartSlicePerformanceBenchmark, 'SMART_SLICE_PERFORMANCE_RUN_FAILED', 'Smart Slice performance benchmark writes a blocked report when the real-media runner fails');
assertIncludes(smartSlicePerformanceBenchmarkTest, 'createSequenceClock', 'Smart Slice performance benchmark test uses deterministic timing instead of wall-clock flakiness');
assertIncludes(smartSlicePerformanceBenchmarkTest, 'performance-benchmark-failed.json', 'Smart Slice performance benchmark test covers failed runner report persistence');
assertRule(
  exists('scripts/check-autocut-generic-real-media-slice.mjs'),
  'AutoCut provides a generic same-source real-media Smart Slice runner for large files',
);
assertIncludes(rootPackageJson, 'baseline:generic-real-media-slice', 'package.json exposes the generic real-media Smart Slice runner as a first-class script');
assertIncludes(genericRealMediaSlice, '2026-05-16.autocut-generic-real-media-slice.v1', 'generic real-media runner writes a versioned report schema');
assertIncludes(genericRealMediaSlice, 'createSmartCutEngineSlicePlan', 'generic real-media runner uses the Smart Cut Engine first');
assertIncludes(genericRealMediaSlice, 'createTranscriptAssistedSlicePlan', 'generic real-media runner has a transcript-continuity fallback when strict evidence blocks');
assertIncludes(genericRealMediaSlice, 'createLargeMediaTranscriptContinuityPlan', 'generic real-media runner has a linear continuity fallback for fragmented large-media STT');
assertIncludes(genericRealMediaSlice, 'large-media-transcript-continuity-fallback', 'generic real-media runner records the large-media continuity fallback risk for audit');
assertIncludes(genericRealMediaSlice, 'renderClipLimit', 'generic real-media runner limits benchmark rendering for large files');
assertIncludes(genericRealMediaSlice, 'smart-slice.render-artifact-manifest.v1', 'generic real-media runner writes render artifact manifest evidence');
assertIncludes(genericRealMediaSlice, 'subtitleArtifactPath', 'generic real-media runner writes editable SRT sidecars for rendered clips');
assertIncludes(genericRealMediaSliceTest, 'same-source transcript', 'generic real-media runner test requires same-source transcript evidence');
assertIncludes(genericRealMediaSliceTest, 'large-media transcript continuity fallback merges dangling connector fragments', 'generic real-media runner test covers fragmented STT continuity fallback');
assertRule(
  exists('scripts/check-autocut-large-media-baseline.mjs'),
  'AutoCut provides a same-source large media Smart Slice baseline command',
);
assertIncludes(rootPackageJson, 'baseline:large-media', 'package.json exposes the large-media baseline as a first-class script');
assertIncludes(largeMediaBaseline, 'smart-slice.large-media-baseline.v1', 'large-media baseline writes a versioned report schema');
assertIncludes(largeMediaBaseline, 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_MISSING', 'large-media baseline blocks when same-source transcript evidence is missing');
assertIncludes(largeMediaBaseline, 'runAutoCutSmartSlicePerformanceBenchmark', 'large-media baseline delegates ready transcript cases to the Smart Slice performance benchmark');
assertIncludes(largeMediaBaseline, 'smart-slice.speech-to-text.v1', 'large-media baseline converts Whisper JSON into canonical Smart Slice STT evidence');
assertIncludes(largeMediaBaseline, 'normalizeSmartSliceTranscriptEvidenceText', 'large-media baseline uses the same Smart Slice transcript evidence normalization as the generic runner');
assertIncludes(largeMediaBaseline, 'renderClipLimit', 'large-media baseline can bound rendered clip count for large-file performance checks');
assertIncludes(largeMediaBaseline, 'SMART_SLICE_LARGE_MEDIA_BENCHMARK_BLOCKED', 'large-media baseline propagates benchmark blockers into its top-level report');
assertIncludes(largeMediaBaselineTest, 'not the wenan5 fixture', 'large-media baseline test prevents accidental reuse of the wenan5 transcript fixture');
assertRule(
  exists('scripts/write-autocut-large-media-stt-baseline.mjs'),
  'AutoCut provides a large-media STT baseline command for generating same-source transcript evidence',
);
assertIncludes(rootPackageJson, 'baseline:large-media-stt', 'package.json exposes the large-media STT baseline as a first-class script');
assertIncludes(largeMediaSttBaseline, 'smart-slice.large-media-stt-baseline.v1', 'large-media STT baseline writes a versioned report schema');
assertIncludes(largeMediaSttBaseline, 'SMART_SLICE_LARGE_MEDIA_AUDIO_EXTRACT_FAILED', 'large-media STT baseline blocks when FFmpeg audio extraction fails');
assertIncludes(largeMediaSttBaseline, 'SMART_SLICE_LARGE_MEDIA_WHISPER_FAILED', 'large-media STT baseline blocks when local Whisper transcription fails');
assertIncludes(largeMediaSttBaseline, 'smart-slice.speech-to-text.v1', 'large-media STT baseline writes canonical Smart Slice STT evidence');
assertIncludes(largeMediaSttBaseline, 'smart-slice.large-media-source-identity.v1', 'large-media STT baseline writes a same-source identity marker before reusing expensive large-file artifacts');
assertIncludes(largeMediaSttBaseline, 'smart-slice.large-media-stt-chunks.v1', 'large-media STT baseline records a chunk manifest for long-video STT observability');
assertIncludes(largeMediaSttBaseline, 'chunked-parallel', 'large-media STT baseline switches long audio to chunked parallel transcription instead of a single slow Whisper process');
assertIncludes(largeMediaSttBaseline, 'runAutoCutLargeMediaSttCommandAsync', 'large-media STT baseline has an async command runner for concurrent Whisper chunk transcription');
assertIncludes(largeMediaSttBaseline, '--chunk-duration-ms', 'large-media STT baseline exposes chunk duration tuning for commercial large-file benchmarking');
assertIncludes(largeMediaSttBaseline, '--parallelism', 'large-media STT baseline exposes Whisper chunk parallelism tuning for large videos');
assertIncludes(largeMediaSttBaseline, '--audio-duration-ms', 'large-media STT baseline exposes an explicit diagnostic audio-duration cap for bounded large-file smoke tests');
assertIncludes(largeMediaSttBaseline, 'transcriptReusable', 'large-media STT baseline can resume after completed local Whisper transcription');
assertIncludes(largeMediaSttBaseline, 'audioReusable', 'large-media STT baseline can resume from already extracted mono 16k speech audio');
assertIncludes(largeMediaSttBaselineTest, 'audio extraction fails', 'large-media STT baseline test covers blocked audio extraction persistence');
assertIncludes(largeMediaSttBaselineTest, 'reuses an already generated same-source transcript', 'large-media STT baseline test covers transcript resume without rerunning expensive tools');
assertIncludes(largeMediaSttBaselineTest, 'audio should have been reused', 'large-media STT baseline test covers audio reuse before Whisper retry');
assertIncludes(largeMediaSttBaselineTest, 'interrupted large-media STT resumes from extracted same-source audio', 'large-media STT baseline test covers interruption recovery after audio extraction');
assertIncludes(largeMediaSttBaselineTest, 'large-media STT baseline transcribes audio chunks concurrently', 'large-media STT baseline test covers chunked parallel transcription for long videos');
const slicerLlmService = read('packages/sdkwork-autocut-services/src/service/llm.service.ts');
assertIncludes(slicerLlmService, 'getAutoCutModelVendorForModel', 'llm.service resolves model ownership before allowing model overrides');
assertIncludes(slicerLlmService, 'requestedModelVendor !== runtime.modelVendor', 'llm.service rejects model overrides from a different configured provider');
assertIncludes(homePage, 'startSmartSliceInputRef', 'HomePage owns the smart slice hidden file chooser');
assertIncludes(homePage, 'handleStartSmartSlice', 'HomePage starts smart slicing through the video file chooser');
assertIncludes(homePage, 'handleSmartSliceFileSelected', 'HomePage forwards the selected video file to the slicer route');
assertIncludes(homePage, 'selectAutoCutTrustedLocalVideoFile', 'HomePage prefers the desktop trusted local video chooser for smart slicing');
assertIncludes(homePage, 'initialTrustedFileSource: selectedVideo', 'HomePage forwards the desktop trusted video descriptor through route state');
assertRule(!homePage.includes('initialFile: trustedFile'), 'HomePage does not put a trusted File instance into router state where structured cloning drops sourcePath');
assertIncludes(homePage, 'fallbackSmartSliceFileChooser', 'HomePage keeps a browser file chooser fallback outside the Tauri desktop host');
assertIncludes(homePage, 'stopPropagation()', 'HomePage hidden smart slice input stops click bubbling back to the banner');
assertIncludes(homePage, 'accept="video/*"', 'HomePage smart slice chooser accepts video files only');
assertIncludes(homePage, "t('home.hero.action')", 'HomePage primary smart slice action uses localized intelligent slicing product copy');
assertIncludes(slicerPage, 'useLocation', 'SlicerPage reads route state from the homepage smart slice chooser');
assertIncludes(slicerPage, 'initialFile', 'SlicerPage initializes the selected source file from route state');
assertIncludes(slicerPage, 'initialFileId', 'SlicerPage initializes an already imported native source asset from route state');
assertIncludes(slicerPage, 'const [fileId, setFileId] = useState<string>(initialFileId)', 'SlicerPage preserves selected native source asset IDs for smart-slice reruns');
assertIncludes(slicerPage, '...(fileId && !file ? { fileId } : {})', 'SlicerPage submits fileId-only smart-slice reruns without requiring a browser File');
assertIncludes(slicerPage, 'initialTrustedFileSource', 'SlicerPage reads the serializable trusted desktop source descriptor from route state');
assertIncludes(slicerPage, 'createAutoCutTrustedLocalFile(initialTrustedFileSource)', 'SlicerPage rebuilds a File-compatible trusted source after router state cloning');
assertIncludes(slicerPage, 'resolveAutoCutTrustedSourcePath(file)', 'SlicerPage detects trusted desktop-selected video source paths');
assertIncludes(slicerPage, 'getAutoCutNativeHostClient().createAssetUrl(trustedSourcePath)', 'SlicerPage previews desktop-selected videos through the Tauri asset protocol');
assertIncludes(slicerPage, 'selectAutoCutTrustedLocalVideoFile', 'SlicerPage prefers the desktop trusted local video chooser when replacing the source video');
assertIncludes(slicerPage, 'createAutoCutTrustedLocalFile', 'SlicerPage converts replacement desktop videos into File-compatible trusted inputs');
assertMatches(
  slicerPage,
  /handleReplaceVideo[\s\S]*selectAutoCutTrustedLocalVideoFile[\s\S]*createAutoCutTrustedLocalFile[\s\S]*setFile\(trustedFile\)/u,
  'SlicerPage replacement video flow preserves trusted source paths so native slicing runs real FFmpeg logic',
);
assertIncludes(slicerPage, 'normalizeSlicerNumberInput', 'SlicerPage normalizes numeric smart-slicing controls before writing React state');
assertRule(
  !slicerPage.includes('setTargetSliceCount(Number(e.target.value))') &&
    !slicerPage.includes('setIdealDuration(Number(e.target.value))') &&
    !slicerPage.includes('setMinDuration(Number(e.target.value))') &&
    !slicerPage.includes('setMaxDuration(Number(e.target.value))'),
  'SlicerPage does not persist raw Number(input.value) results that can turn empty numeric controls into NaN',
);
assertMatches(
  slicerPage,
  /id: 'min'[\s\S]*max: Math\.min\(180, maxDuration\)[\s\S]*update: setMinDuration[\s\S]*item\.update\(\(currentValue\)[\s\S]*normalizeSlicerNumberInput\(event\.target\.value, currentValue, item\.min, item\.max\)/u,
  'SlicerPage clamps minimum slice duration against the current maximum duration',
);
assertMatches(
  slicerPage,
  /id: 'max'[\s\S]*min: Math\.max\(10, minDuration\)[\s\S]*update: setMaxDuration[\s\S]*item\.update\(\(currentValue\)[\s\S]*normalizeSlicerNumberInput\(event\.target\.value, currentValue, item\.min, item\.max\)/u,
  'SlicerPage clamps maximum slice duration against the current minimum duration',
);
for (const hardCodedLlmModelOption of [
  '<option value="gpt-5.2">',
  '<option value="gpt-5.2-chat-latest">',
  '<option value="gemini-3.1-pro-preview">',
  '<option value="gemini-3-flash-preview">',
  '<option value="deepseek-v4-flash">',
]) {
  assertRule(
    !slicerPage.includes(hardCodedLlmModelOption),
    `Slicer LLM selector does not hard-code model option ${hardCodedLlmModelOption}`,
  );
}
assertIncludes(settingsPage, 'createAutoCutApiKey', 'SettingsPage creates API keys through the settings service');
assertIncludes(settingsPage, 'revokeAutoCutApiKey', 'SettingsPage revokes API keys through the settings service');
assertIncludes(settingsPage, 'clearAutoCutStorageCache', 'SettingsPage clears cache through the settings service');
assertIncludes(settingsPage, 'requestAutoCutAvatarChange', 'SettingsPage records avatar change requests through the settings service');
assertIncludes(settingsPage, 'openAutoCutSubscriptionManagement', 'SettingsPage records subscription management opens through the settings service');
assertIncludes(settingsPage, 'requestAutoCutPasswordChange', 'SettingsPage records password change requests through the settings service');
assertIncludes(settingsPage, '{settings.account.displayName}', 'SettingsPage account summary reflects persisted display name');
assertIncludes(settingsPage, '{settings.account.email}', 'SettingsPage account summary reflects persisted email');
assertIncludes(settingsPage, '{settings.billing.planName}', 'SettingsPage billing summary reflects persisted plan name');
assertIncludes(settingsPage, '{settings.billing.monthlyPrice}', 'SettingsPage billing summary reflects persisted monthly price');
assertIncludes(settingsPage, '{settings.billing.nextBillingDate}', 'SettingsPage billing summary reflects persisted next billing date');
assertIncludes(settingsPage, 'getAutoCutAccountInitials(settings.account.displayName)', 'SettingsPage account avatar reflects persisted display name');
assertIncludes(settingsPage, 'Array.from({ length: settings.billing.invoicesLoaded })', 'SettingsPage renders invoice rows from persisted invoice count');
assertRule(!settingsPage.includes('User_001'), 'SettingsPage does not hard-code the default account display name');
assertRule(!settingsPage.includes('user_001@example.com'), 'SettingsPage does not hard-code the default account email');
assertRule(!settingsPage.includes('2023-12-20'), 'SettingsPage does not hard-code the billing date');
assertIncludes(settingsPage, '{settings.storage.cachedItems}', 'SettingsPage storage summary reflects persisted cache item count');
assertRule(!settingsPage.includes('defaultValue'), 'SettingsPage uses controlled text inputs instead of defaultValue');
assertRule(!settingsPage.includes('defaultChecked'), 'SettingsPage uses controlled checkboxes instead of defaultChecked');
assertRule(!settingsPage.includes('{settings.llm.apiKey}'), 'SettingsPage never renders the raw LLM API key');
assertOpeningTagsHaveHandler(settingsPage, 'Button', 'packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
assertOpeningTagsHaveHandler(settingsPage, 'button', 'packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');

const toolsPage = read('packages/sdkwork-autocut-tools/src/pages/ToolsPage.tsx');
assertIncludes(toolsPage, 'getTools().then(setToolsList)', 'ToolsPage loads the canonical tool registry');
assertIncludes(toolsPage, 'setSearchQuery', 'ToolsPage searches tools locally');
assertIncludes(toolsPage, 'navigate(tool.route)', 'ToolsPage opens tool routes from the registry');
assertIncludes(toolsPage, 'listenAutoCutI18nLanguageChanged', 'ToolsPage subscribes to i18next language changes for visible text');
assertIncludes(toolsPage, 't(cat.labelKey)', 'ToolsPage resolves category labels during render so language changes update immediately');
assertIncludes(toolsPage, 't(tool.nameKey', 'ToolsPage resolves tool names during render so language changes update immediately');
assertIncludes(toolsPage, 't(tool.descriptionKey', 'ToolsPage resolves tool descriptions during render so language changes update immediately');
assertIncludes(toolsPage, 'translatedToolName', 'ToolsPage searches against current-language tool names instead of stale service strings');

const appLayout = read('packages/sdkwork-autocut-core/src/components/AppLayout.tsx');
assertIncludes(appLayout, 'listenAutoCutI18nLanguageChanged', 'AppLayout subscribes to i18next language changes for persistent shell text');
assertIncludes(appLayout, "t('layout.sidebar.home')", 'AppLayout localizes the Home sidebar label through i18next');
assertIncludes(appLayout, "t('layout.sidebar.tools')", 'AppLayout localizes the Tools sidebar label through i18next');
assertIncludes(appLayout, "t('layout.sidebar.assets')", 'AppLayout localizes the Assets sidebar label through i18next');
assertIncludes(appLayout, "t('layout.sidebar.tasks')", 'AppLayout localizes the Tasks sidebar label through i18next');
assertIncludes(appLayout, "t('layout.sidebar.messages')", 'AppLayout localizes the Messages sidebar label through i18next');

const architectureCheck = read('scripts/check-autocut-architecture.mjs');
assertIncludes(architectureCheck, 'registeredToolRoutes', 'architecture check extracts tool registry routes');
assertIncludes(architectureCheck, 'desktopRoutePaths', 'architecture check extracts desktop route table paths');
assertIncludes(architectureCheck, 'tool registry route', 'architecture check verifies every tool registry route is mounted by the desktop app');

const processingSource = read('packages/sdkwork-autocut-services/src/service/processing-source.service.ts');
assertIncludes(processingSource, 'assertAutoCutMediaHasAudioStream', 'processing-source exposes the canonical audio-stream evidence assertion');
assertIncludes(processingSource, 'assertAutoCutMediaHasVideoStream', 'processing-source exposes the canonical video-stream evidence assertion');
assertRule(
  !processingSource.includes("media.mediaType === 'audio' || media.hasAudioStream === true"),
  'processing-source audio-stream assertion does not trust mediaType labels without FFmpeg audio-stream evidence',
);
assertRule(
  !processingSource.includes("media.mediaType === 'video' || media.hasVideoStream === true"),
  'processing-source video-stream assertion does not trust mediaType labels without FFmpeg video-stream evidence',
);

const subtitleTranslateService = read('packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts');
assertIncludes(
  subtitleTranslateService,
  "assertAutoCutMediaHasVideoStream(importedMedia, 'subtitle hardcode')",
  'subtitle translate hardcode mode fails closed unless native probe evidence confirms a video stream',
);
assertRule(
  !subtitleTranslateService.includes("params.hardcode === true && importedMedia.mediaType === 'video'"),
  'subtitle translate hardcode routing does not rely on mediaType labels instead of FFmpeg video-stream evidence',
);
assertIncludes(
  subtitleTranslateService,
  "params.hardcode === true && importedMedia.hasVideoStream === true",
  'subtitle translate hardcode routing uses native video-stream evidence',
);

const fileUpload = read('packages/sdkwork-autocut-commons/src/components/FileUpload.tsx');
const trustedFileSourceService = read('packages/sdkwork-autocut-commons/src/service/trusted-file-source.service.ts');
assertIncludes(fileUpload, 'getValidatedFile', 'FileUpload validates selected and dropped files through one standard workflow');
assertIncludes(fileUpload, 'onValidationError', 'FileUpload exposes a typed validation error callback');
assertIncludes(fileUpload, 'requiredStreams', 'FileUpload accepts a per-workflow stream evidence contract');
assertIncludes(fileUpload, 'validateAutoCutTrustedFileRequiredStreams', 'FileUpload uses the canonical trusted stream evidence validator');
assertIncludes(fileUpload, 'requiredStreams]', 'FileUpload refreshes trusted drop validation when a workflow changes required stream evidence');
assertIncludes(trustedFileSourceService, 'AutoCutRequiredMediaStreams', 'trusted file source service exposes the shared required-stream contract');
assertIncludes(trustedFileSourceService, 'validateAutoCutTrustedFileRequiredStreams', 'trusted file source service exposes the canonical trusted stream evidence validator');
assertIncludes(trustedFileSourceService, 'AutoCut selected media requires an audio stream.', 'trusted file source validator reports missing audio stream evidence before processing starts');
assertIncludes(trustedFileSourceService, 'AutoCut selected media requires a video stream.', 'trusted file source validator reports missing video stream evidence before processing starts');
assertMatches(fileUpload, /\.size > maxSizeMB \* 1024 \* 1024/u, 'FileUpload enforces maxSizeMB before accepting files');
assertMatches(fileUpload, /acceptFileTypes\.some[\s\S]*\.type\.startsWith/u, 'FileUpload validates MIME wildcard accept rules');
assertIncludes(fileUpload, 'isTrustedAutoCutAudioVideoFile', 'FileUpload treats native-described audio/video files as probe-validated media sources');
assertIncludes(
  fileUpload,
  'isTrustedAutoCutAudioVideoFile(nextFile, acceptFileTypes)',
  'FileUpload does not reject trusted desktop audio/video files solely because the browser MIME accept string cannot describe their extension, while preserving the control media-type contract',
);
assertIncludes(fileUpload, "mediaType !== 'audio' && mediaType !== 'video'", 'FileUpload only bypasses MIME guessing for native-described audio/video media');
assertIncludes(fileUpload, 'acceptedType === `${mediaType}/*`', 'FileUpload still enforces the current control media-type accept contract for trusted native files');
assertMatches(fileUpload, /handleFileChange[\s\S]*getValidatedFile/u, 'FileUpload validates browse-selected files');
assertMatches(fileUpload, /handleDrop[\s\S]*getValidatedFile/u, 'FileUpload validates drag-and-dropped files');
assertIncludes(fileUpload, 'listenAutoCutTrustedFileSourceDrop', 'FileUpload listens to trusted desktop file source drops');
assertIncludes(fileUpload, 'createAutoCutTrustedLocalFile', 'FileUpload converts trusted desktop file descriptions into File-compatible values');
assertIncludes(fileUpload, 'resolveAutoCutTrustedSourcePath', 'FileUpload can validate selected files while preserving trusted source paths');
assertIncludes(fileUpload, 'hasAudioStream', 'FileUpload preserves native audio-stream evidence on trusted desktop media files');
assertIncludes(fileUpload, 'hasVideoStream', 'FileUpload preserves native video-stream evidence on trusted desktop media files');
assertIncludes(fileUpload, 'trustedFileSourceSelector', 'FileUpload accepts a native trusted file selector so desktop processing does not receive browser-only File objects');
assertMatches(fileUpload, /handleBrowseClick[\s\S]*trustedFileSourceSelector[\s\S]*createAutoCutTrustedLocalFile[\s\S]*getValidatedFile/u, 'FileUpload click selection converts native trusted file descriptions before validation');
assertIncludes(fileUpload, 'onClick={handleBrowseClick}', 'FileUpload routes click-to-select through the trusted native selector before browser fallback');
assertIncludes(fileUpload, 'requiresTrustedLocalSource', 'FileUpload has an explicit fail-closed mode for workflows that require trusted desktop media');
assertIncludes(fileUpload, 'requiresTrustedLocalSource && !trustedSourcePath', 'FileUpload rejects browser-only File objects when a trusted desktop selector is configured');
assertIncludes(fileUpload, 'AutoCut desktop processing requires a trusted local media file selected by the native host.', 'FileUpload reports the trusted-source requirement instead of silently accepting browser files');
assertRule(
  !/trustedFileSourceSelector\(\)[\s\S]*catch\(\(\)\s*=>\s*\{[\s\S]*inputRef\.current\?\.click\(\)/u.test(fileUpload),
  'FileUpload does not fall back to the browser file picker after trusted desktop media selection fails',
);

const nativeHostClient = read('packages/sdkwork-autocut-services/src/service/native-host-client.service.ts');
assertIncludes(nativeHostClient, 'risks?: string[]', 'native host client preserves smart-slice review risks in typed clip requests and native artifacts');
assertIncludes(nativeHostClient, 'hasAudioStream: boolean', 'native host client media import and describe results expose verified audio-stream presence');
assertIncludes(nativeHostClient, 'hasVideoStream: boolean', 'native host client media import and describe results expose verified video-stream presence');
assertIncludes(nativeHostClient, 'localMediaFileSelectCommandReady', 'native host client declares the trusted desktop audio/video chooser capability');
assertIncludes(nativeHostClient, 'selectLocalMediaFile', 'native host client exposes the trusted desktop audio/video chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_media_file', 'native host client invokes the trusted desktop audio/video chooser command');
assertIncludes(nativeHostClient, 'selectAutoCutTrustedLocalMediaFile', 'services expose a standard trusted local media chooser for FileUpload pages');
assertIncludes(nativeHostClient, 'selectLocalVideoFile', 'native host client exposes the trusted desktop video chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_video_file', 'native host client invokes the trusted desktop video chooser command');
assertIncludes(nativeHostClient, 'selectLocalDirectory', 'native host client exposes the trusted desktop directory chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_directory', 'native host client invokes the trusted desktop directory chooser command');
assertIncludes(nativeHostClient, 'allowLocalMediaPreviewDirectory', 'native host client exposes trusted local preview directory authorization');
assertIncludes(nativeHostClient, 'autocut_allow_local_media_preview_directory', 'native host client invokes trusted local preview directory authorization');
assertIncludes(nativeHostClient, 'AutoCutNativeArtifactInFolderRequest', 'native host client exposes a typed open-containing-folder request');
assertIncludes(nativeHostClient, 'openArtifactInFolder', 'native host client exposes trusted generated artifact folder opening');
assertIncludes(nativeHostClient, 'autocut_open_artifact_in_folder', 'native host client invokes trusted generated artifact folder opening');
assertIncludes(nativeHostClient, 'openAutoCutNativeArtifactInFolder', 'native host client exposes the guarded generated artifact folder helper');
assertIncludes(nativeHostClient, 'probeSpeechTranscription', 'native host client exposes local speech-to-text toolchain probing');
assertIncludes(nativeHostClient, 'autocut_probe_speech_transcription', 'native host client invokes the local speech-to-text probe command');
assertIncludes(nativeHostClient, 'selectSpeechTranscriptionFile', 'native host client exposes trusted local speech tool file selection');
assertIncludes(nativeHostClient, 'autocut_select_speech_transcription_file', 'native host client invokes the trusted local speech tool file chooser');
assertIncludes(nativeHostClient, 'AutoCutSpeechTranscriptionModelDownloadProgressEvent', 'native host client exposes typed local speech model download progress events');
assertIncludes(nativeHostClient, 'speechTranscriptionModelDownloadCommandReady', 'native host client declares local speech model download readiness');
assertIncludes(nativeHostClient, 'downloadSpeechTranscriptionModel', 'native host client exposes trusted local speech model preset download');
assertIncludes(nativeHostClient, 'autocut_download_speech_transcription_model', 'native host client invokes the trusted local speech model download command');
const desktopNativeHost = read('packages/sdkwork-autocut-desktop/src/native-host.ts');
const desktopMediaRuntime = read('packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs');
assertIncludes(
  desktopMediaRuntime,
  'AUTOCUT_ALL_FILES_DIALOG_EXTENSIONS',
  'desktop media chooser exposes an all-files dialog filter so unknown-extension audio/video can reach FFmpeg probe validation',
);
assertMatches(
  desktopMediaRuntime,
  /select_autocut_local_media_file[\s\S]*add_filter\("All files", AUTOCUT_ALL_FILES_DIALOG_EXTENSIONS\)[\s\S]*describe_autocut_local_media_file_from_path/u,
  'desktop media chooser allows any selected file through to native describe/probe before applying requested media type validation',
);
assertMatches(
  desktopNativeHost,
  /import\s+type\s+\{[\s\S]*AutoCutSpeechTranscriptionModelDownloadProgressEvent[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-types['"]/u,
  'desktop native host imports public local STT model download progress event types from @sdkwork/autocut-types',
);
assertRule(
  !/import\s+type\s+\{[\s\S]*AutoCutSpeechTranscriptionModelDownloadProgressEvent[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-services['"]/u.test(desktopNativeHost),
  'desktop native host does not import local STT model download progress event types from the services package',
);
assertIncludes(desktopNativeHost, 'reportAutoCutDiagnostic', 'desktop native host reports trusted drag-drop bridge diagnostics');
assertIncludes(desktopNativeHost, 'describeTrustedDesktopDropFile', 'desktop native host describes dropped files through a per-file resilient helper');
assertIncludes(desktopNativeHost, 'allowLocalMediaPreviewDirectory', 'desktop native host grants asset-protocol access to trusted dropped file parent directories');
assertIncludes(desktopNativeHost, 'nativeHostClient.allowLocalMediaPreviewDirectory', 'desktop trusted drag-drop bridge grants preview scope before dispatching dropped files');
assertRule(
  !desktopNativeHost.includes('Promise.all('),
  'desktop trusted drag-drop bridge does not fail the whole drop when one path cannot be described',
);
assertMatches(
  desktopNativeHost,
  /descriptions\.filter[\s\S]*Boolean[\s\S]*dispatchAutoCutTrustedFileSourceDrop/u,
  'desktop trusted drag-drop bridge dispatches only successfully described local media files',
);
const nativeTauriConfig = JSON.parse(read('packages/sdkwork-autocut-desktop/src-tauri/tauri.conf.json'));
const nativeTauriDefaultCapability = JSON.parse(read('packages/sdkwork-autocut-desktop/src-tauri/capabilities/default.json'));
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:event:default'),
  'desktop Tauri capability grants event listen/unlisten permissions for trusted drag-drop registration',
);
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:event:allow-listen'),
  'desktop Tauri capability explicitly grants event.listen for trusted drag-drop registration',
);
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:event:allow-unlisten'),
  'desktop Tauri capability explicitly grants event.unlisten for trusted drag-drop cleanup',
);
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:default'),
  'desktop Tauri capability grants the core invoke permissions required by the native host client',
);
assertRule(
  nativeTauriConfig.app?.security?.assetProtocol?.enable === true,
  'desktop Tauri config enables asset protocol previews for trusted desktop media paths',
);
const nativeCommands = read('packages/sdkwork-autocut-desktop/src-tauri/src/commands.rs');
assertIncludes(nativeCommands, 'autocut_select_local_media_file', 'desktop commands expose the trusted local audio/video chooser');
assertIncludes(nativeCommands, 'autocut_select_local_video_file', 'desktop commands expose the trusted local video chooser');
assertIncludes(nativeCommands, 'autocut_select_local_directory', 'desktop commands expose the trusted local directory chooser');
assertIncludes(nativeCommands, 'autocut_allow_local_media_preview_directory', 'desktop commands expose the asset-protocol preview directory authorization command');
assertIncludes(nativeCommands, 'autocut_open_artifact_in_folder', 'desktop commands expose the trusted open-containing-folder command');
assertIncludes(nativeCommands, 'autocut_probe_speech_transcription', 'desktop commands expose the local speech-to-text probe');
assertIncludes(nativeCommands, 'autocut_select_speech_transcription_file', 'desktop commands expose the trusted local speech tool file chooser');
assertIncludes(nativeCommands, 'autocut_download_speech_transcription_model', 'desktop commands expose the trusted local speech model download command');
const nativeMain = read('packages/sdkwork-autocut-desktop/src-tauri/src/main.rs');
assertIncludes(nativeMain, 'commands::autocut_select_local_media_file', 'desktop main registers the trusted local audio/video chooser command');
assertIncludes(nativeMain, 'commands::autocut_select_local_video_file', 'desktop main registers the trusted local video chooser command');
assertIncludes(nativeMain, 'commands::autocut_select_local_directory', 'desktop main registers the trusted local directory chooser command');
assertIncludes(nativeMain, 'commands::autocut_allow_local_media_preview_directory', 'desktop main registers the asset-protocol preview directory authorization command');
assertIncludes(nativeMain, 'commands::autocut_open_artifact_in_folder', 'desktop main registers the trusted open-containing-folder command');
assertIncludes(nativeMain, 'commands::autocut_probe_speech_transcription', 'desktop main registers the local speech-to-text probe command');
assertIncludes(nativeMain, 'commands::autocut_select_speech_transcription_file', 'desktop main registers the trusted local speech tool file chooser command');
assertIncludes(nativeMain, 'commands::autocut_download_speech_transcription_model', 'desktop main registers the trusted local speech model download command');
const nativeHostContract = read('packages/sdkwork-autocut-desktop/src-tauri/src/host_contract.rs');
assertIncludes(nativeHostContract, 'local_media_file_select_command_ready', 'native host capabilities declare trusted local audio/video chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_media_file"', 'native host supported commands include trusted local audio/video chooser');
assertIncludes(nativeHostContract, 'local_video_file_select_command_ready', 'native host capabilities declare trusted local video chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_video_file"', 'native host supported commands include trusted local video chooser');
assertIncludes(nativeHostContract, 'local_directory_select_command_ready', 'native host capabilities declare trusted local directory chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_directory"', 'native host supported commands include trusted local directory chooser');
assertIncludes(nativeHostContract, 'local_media_preview_directory_scope_command_ready', 'native host capabilities declare local media preview directory authorization readiness');
assertIncludes(nativeHostContract, '"autocut_allow_local_media_preview_directory"', 'native host supported commands include local media preview directory authorization');
assertIncludes(nativeHostContract, 'open_artifact_in_folder_command_ready', 'native host capabilities declare generated artifact folder opening readiness');
assertIncludes(nativeHostContract, '"autocut_open_artifact_in_folder"', 'native host supported commands include generated artifact folder opening');
assertIncludes(nativeHostContract, 'speech_transcription_probe_command_ready', 'native host capabilities declare local speech-to-text probe readiness');
assertIncludes(nativeHostContract, 'speech_transcription_file_select_command_ready', 'native host capabilities declare local speech tool file chooser readiness');
assertIncludes(nativeHostContract, 'speech_transcription_model_download_command_ready', 'native host capabilities declare local speech model download readiness');
assertIncludes(nativeHostContract, '"autocut_probe_speech_transcription"', 'native host supported commands include local speech-to-text probe');
assertIncludes(nativeHostContract, '"autocut_select_speech_transcription_file"', 'native host supported commands include local speech tool file chooser');
assertIncludes(nativeHostContract, '"autocut_download_speech_transcription_model"', 'native host supported commands include local speech model download');
assertIncludes(nativeHostContract, 'visual_evidence_extraction_contract_ready: true', 'native host exposes visual evidence extraction contract readiness for multimodal slicers');
assertIncludes(nativeHostContract, 'visual_evidence_extraction_command_ready: true', 'native host exposes source-backed visual evidence extraction command readiness');
assertIncludes(nativeHostContract, 'visual_evidence_extraction_adapter_ready: true', 'native host claims visual evidence adapter readiness only after source-backed FFmpeg shot evidence is implemented');
assertIncludes(nativeHostContract, '"autocut_extract_visual_evidence"', 'native host supported commands include the visual evidence command surface');
assertRule(
  nativeTauriConfig.bundle?.resources?.['binaries/speech-transcription.toolchain.json'] === 'binaries/speech-transcription.toolchain.json',
  'desktop Tauri config packages the local speech-to-text toolchain manifest for release builds',
);
const nativeMediaRuntime = read('packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs');
assertIncludes(nativeMediaRuntime, 'AutoCutVisualEvidenceExtractionRequest', 'media runtime defines a typed visual evidence extraction request');
assertIncludes(nativeMediaRuntime, 'AutoCutVisualEvidenceExtractionResult', 'media runtime defines a typed visual evidence extraction result');
assertIncludes(nativeMediaRuntime, 'extract_autocut_visual_evidence', 'media runtime owns the visual evidence extraction command boundary');
assertIncludes(nativeMediaRuntime, 'AUTOCUT_VISUAL_EVIDENCE_SUPPORTED_PROFILES', 'media runtime enumerates supported visual evidence profiles before accepting native requests');
assertIncludes(nativeMediaRuntime, 'run_ffmpeg_visual_evidence_extraction', 'media runtime implements source-backed FFmpeg visual evidence extraction');
assertIncludes(nativeMediaRuntime, 'parse_ffmpeg_showinfo_pts_times_to_millis', 'media runtime parses FFmpeg scene detector timestamps into canonical millisecond evidence');
assertIncludes(nativeMediaRuntime, 'complete_ops_visual_evidence_task', 'media runtime persists visual evidence task output through the native task contract');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_media_file', 'media runtime implements the trusted local audio/video chooser');
assertIncludes(nativeMediaRuntime, 'has_audio_stream: bool', 'media runtime returns native audio-stream evidence in media import and describe results');
assertIncludes(nativeMediaRuntime, 'has_video_stream: bool', 'media runtime returns native video-stream evidence in media import and describe results');
assertIncludes(nativeMediaRuntime, '"hasAudioStream": has_audio_stream', 'media import metadata stores verified audio-stream presence for downstream workflows');
assertIncludes(nativeMediaRuntime, '"hasVideoStream": has_video_stream', 'media import metadata stores verified video-stream presence for downstream workflows');
assertIncludes(nativeMediaRuntime, 'struct AutoCutMediaStreamEvidence', 'media runtime models FFmpeg audio/video stream evidence as the native source of truth');
assertIncludes(nativeMediaRuntime, 'probe_autocut_media_stream_evidence', 'media runtime probes native audio/video stream evidence before classifying local media');
assertIncludes(nativeMediaRuntime, 'resolve_media_type_from_stream_evidence', 'media runtime derives local media type from verified stream evidence instead of extension-only labels');
assertRule(
  !nativeMediaRuntime.includes('let has_audio_stream = if media_type == "audio"'),
  'media runtime never treats an audio mediaType label as verified audio-stream evidence',
);
assertRule(
  !nativeMediaRuntime.includes('let has_video_stream = if media_type == "video"'),
  'media runtime never treats a video mediaType label as verified video-stream evidence',
);
assertRule(
  !nativeMediaRuntime.includes('resolve_media_type_from_extension_or_probe'),
  'media runtime does not classify audio/video media from extension labels before stream evidence is known',
);
assertIncludes(nativeMediaRuntime, 'requested_autocut_media_streams_match_description', 'trusted local media chooser matches requested media kinds against verified stream evidence');
assertRule(
  !nativeMediaRuntime.includes('media_type == &description.media_type'),
  'trusted local media chooser does not accept files by mediaType label without matching stream evidence',
);
assertRule(
  !nativeMediaRuntime.includes('description.media_type != "video"'),
  'trusted local video chooser does not reject or accept files by mediaType label without video-stream evidence',
);
assertIncludes(nativeMediaRuntime, 'SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS', 'media runtime exposes audio extensions for the trusted audio/video chooser');
for (const requiredAudioExtension of ['opus', 'wma', 'aiff', 'aif', 'alac', 'amr', 'oga', 'spx', 'ac3', 'eac3', 'weba']) {
  assertIncludes(
    nativeMediaRuntime,
    `"${requiredAudioExtension}"`,
    `media runtime recognizes common audio-bearing file extension .${requiredAudioExtension}`,
  );
}
for (const requiredVideoExtension of ['mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', '3g2', 'wmv', 'asf', 'ogv', 'vob']) {
  assertIncludes(
    nativeMediaRuntime,
    `"${requiredVideoExtension}"`,
    `media runtime recognizes common audio-bearing video container .${requiredVideoExtension}`,
  );
}
assertIncludes(nativeMediaRuntime, 'normalize_autocut_media_file_select_types', 'media runtime validates requested trusted media chooser types');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_video_file', 'media runtime implements the trusted local video chooser');
assertIncludes(nativeMediaRuntime, 'rfd::FileDialog', 'media runtime uses a native system file dialog for local video selection');
assertIncludes(nativeMediaRuntime, 'describe_autocut_local_media_file_from_path', 'media runtime describes the selected video through the canonical local media descriptor');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_directory', 'media runtime implements the trusted local directory chooser');
assertIncludes(nativeMediaRuntime, 'pick_folder', 'media runtime uses the native system folder dialog for local directory selection');
assertIncludes(nativeMediaRuntime, 'allow_autocut_local_media_preview_directory', 'media runtime implements trusted asset-protocol preview directory authorization');
assertIncludes(nativeMediaRuntime, 'open_autocut_artifact_in_folder', 'media runtime implements trusted generated artifact folder opening');
assertIncludes(nativeMediaRuntime, 'ensure_existing_autocut_artifact_file_path', 'media runtime validates artifact paths before opening the system file manager');
assertIncludes(nativeMediaRuntime, 'spawn_autocut_artifact_folder_reveal_command', 'media runtime isolates OS-specific file-manager spawning behind a testable helper');
assertIncludes(nativeMediaRuntime, 'allow_autocut_asset_protocol_directory_scope', 'media runtime centralizes asset-protocol directory scope grants');
assertIncludes(nativeMediaRuntime, 'tauri::scope::Scopes', 'media runtime grants preview paths through Tauri runtime scopes instead of broad static config');
assertMatches(nativeMediaRuntime, /scopes\s*\.allow_directory\(directory_path,\s*true\)/u, 'media runtime grants recursive asset-protocol access only to trusted selected directories');
assertIncludes(nativeMediaRuntime, 'allow_autocut_asset_protocol_file_parent_scope', 'media runtime grants preview access to trusted selected source file parent directories');
assertIncludes(nativeMediaRuntime, 'Path::new(&description.source_path)', 'media runtime grants source preview scope from the canonical described media path');
assertIncludes(nativeMediaRuntime, 'allow_autocut_asset_protocol_directory_scope(app, &media_root)?', 'media runtime grants preview access to resolved configured output roots');
assertIncludes(nativeMediaRuntime, 'probe_autocut_speech_transcription', 'media runtime implements the local speech-to-text toolchain probe');
assertIncludes(nativeMediaRuntime, 'AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS_EVENT', 'media runtime defines a native local STT model download progress event name');
assertRule(!nativeMediaRuntime.includes('AUTOCUT_SPEECH_TRANSCRIPTION_EXECUTABLE_DOWNLOAD_PROGRESS_EVENT'), 'media runtime does not expose a native local STT executable download progress event because whisper-cli is packaged as a sidecar');
assertIncludes(nativeMediaRuntime, 'emit_autocut_speech_transcription_model_download_progress', 'media runtime emits local STT model download progress while streaming bytes');
assertRule(!nativeMediaRuntime.includes('emit_autocut_speech_transcription_executable_download_progress'), 'media runtime never emits executable download progress because runtime whisper-cli download is disabled');
assertIncludes(nativeMediaRuntime, 'download_autocut_speech_transcription_model_file_with_progress', 'media runtime writes local STT model downloads through a progress-aware streaming loop');
assertRule(!nativeMediaRuntime.includes('download_autocut_speech_transcription_executable_archive_with_progress'), 'media runtime never downloads local STT executable archives at runtime');
assertRule(!nativeMediaRuntime.includes('download_autocut_speech_transcription_executable'), 'media runtime never exposes a local STT executable download function at runtime');
assertIncludes(nativeMediaRuntime, 'verify_file_sha256_for_label', 'media runtime verifies pinned local STT model SHA-256 before installation');
assertIncludes(nativeMediaRuntime, 'speech-transcription.toolchain.json', 'media runtime resolves bundled local speech-to-text sidecars from the package resource manifest');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_default_bundled_speech_executable_path', 'media runtime computes the default whisper-cli sidecar path from the package manifest');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_bundled_speech_executable_from_candidate_manifests', 'media runtime discovers packaged whisper-cli sidecars from candidate manifests');
assertIncludes(nativeMediaRuntime, 'validate_autocut_speech_toolchain_manifest', 'media runtime validates the packaged speech sidecar manifest before trusting executable paths');
assertIncludes(nativeMediaRuntime, 'verify_autocut_ffmpeg_sidecar_integrity', 'media runtime verifies packaged speech sidecar integrity using the manifest SHA-256 and byte size contract');
assertIncludes(nativeMediaRuntime, 'acceleration_backend', 'media runtime carries the declared speech sidecar acceleration backend through the local STT toolchain');
assertIncludes(nativeMediaRuntime, 'normalize_autocut_speech_acceleration_backend', 'media runtime validates speech sidecar acceleration backend declarations before GPU probing');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_carries_bundled_acceleration_backend_into_probe', 'media runtime tests bundled GPU runtime metadata reaches the local STT GPU probe');
assertIncludes(nativeMediaRuntime, 'speech_bundled_sidecar_does_not_accept_unverified_existing_target', 'media runtime tests that unverified sidecar placeholders cannot satisfy local STT readiness');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_manifest_rejects_placeholder_integrity_when_bundled_ready', 'media runtime tests that bundled-ready speech manifests cannot use placeholder integrity');
assertRule(!nativeMediaRuntime.includes('extract_autocut_speech_transcription_executable_from_zip'), 'media runtime does not extract runtime whisper-cli zip archives');
assertRule(!nativeMediaRuntime.includes('install_autocut_speech_transcription_runtime_directory'), 'media runtime does not stage runtime whisper-cli install directories');
assertRule(!nativeMediaRuntime.includes('write_autocut_speech_executable_install_receipt'), 'media runtime does not persist runtime executable install receipts');
assertRule(!nativeMediaRuntime.includes('verify_autocut_speech_executable_install_receipt'), 'media runtime does not reuse runtime executable install receipts');
assertIncludes(nativeMediaRuntime, 'speech_model_download_progress_calculates_percent_for_known_total', 'media runtime tests local STT model download percent calculation');
assertIncludes(nativeMediaRuntime, 'speech_model_download_progress_keeps_unknown_total_visible', 'media runtime tests local STT model download progress for unknown total sizes');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_speech_toolchain_from_candidate_manifests', 'media runtime can resolve local speech-to-text from settings, environment, bundled sidecar manifests, PATH, and common local install directories');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_speech_executable_from_system_candidates', 'media runtime discovers local whisper-cli from PATH and common local install directories when settings are empty');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_whisper_thread_count', 'media runtime assigns a bounded local Whisper thread count instead of relying on slow CLI defaults');
assertIncludes(nativeMediaRuntime, 'build_local_whisper_transcription_command', 'media runtime centralizes local Whisper command construction for testable STT performance parameters');
assertIncludes(nativeMediaRuntime, '.args(["-t", whisper_thread_count])', 'media runtime passes the bounded thread count to whisper-cli for local STT performance');
assertIncludes(nativeMediaRuntime, 'AUTOCUT_LONG_SPEECH_TRANSCRIPTION_THRESHOLD_MS', 'media runtime defines a native long-audio STT threshold instead of feeding very long videos to one Whisper process');
assertIncludes(nativeMediaRuntime, 'run_chunked_local_whisper_transcription', 'media runtime routes long source media through chunked local Whisper transcription');
assertIncludes(nativeMediaRuntime, 'SourceMediaDirect', 'media runtime has a source-direct large-video STT mode instead of requiring full WAV extraction first');
assertIncludes(nativeMediaRuntime, 'source-media-direct', 'media runtime records source-direct long-video STT chunk extraction for performance auditability');
assertIncludes(nativeMediaRuntime, 'fullAudioExtracted', 'media runtime records whether long-video STT skipped full WAV extraction before chunk transcription');
assertIncludes(nativeMediaRuntime, 'long_speech_transcription_source_chunk_extract_command_skips_video_decode', 'media runtime tests source-direct long-video STT chunk extraction skips video decode');
assertIncludes(nativeMediaRuntime, 'long_speech_transcription_writes_source_direct_chunk_manifest', 'media runtime tests source-direct long-video STT manifest evidence');
assertIncludes(nativeMediaRuntime, 'run_autocut_speech_chunk_pipeline_step', 'media runtime pipelines per-chunk audio extraction and Whisper transcription inside workers instead of staging every chunk first');
assertIncludes(nativeMediaRuntime, 'AutoCutSpeechChunkPipelineStep::ExtractAudio', 'media runtime models chunk audio extraction as an explicit resumable pipeline step');
assertIncludes(nativeMediaRuntime, 'AutoCutSpeechChunkPipelineStep::TranscribeAudio', 'media runtime models chunk Whisper transcription as an explicit resumable pipeline step');
assertIncludes(nativeMediaRuntime, 'long_speech_transcription_chunk_pipeline_resumes_finished_artifacts', 'media runtime tests that completed chunk artifacts are not recomputed during long-video STT retries');
assertIncludes(nativeMediaRuntime, 'create_autocut_speech_audio_chunk_plan', 'media runtime plans overlapped audio chunks for long-video transcript continuity');
assertIncludes(nativeMediaRuntime, 'transcribe_local_whisper_chunks_parallel', 'media runtime transcribes long-video audio chunks concurrently');
assertIncludes(nativeMediaRuntime, 'merge_autocut_speech_audio_chunk_segments', 'media runtime merges chunk transcript timestamps back to the original source timeline');
assertIncludes(nativeMediaRuntime, 'write_merged_whisper_transcript_json', 'media runtime writes a canonical merged Whisper JSON transcript after chunked STT');
assertIncludes(nativeMediaRuntime, 'write_autocut_speech_chunk_manifest', 'media runtime writes an observable chunk manifest for large-video STT diagnostics and recovery');
assertIncludes(nativeMediaRuntime, 'smart-slice.large-media-stt-chunks.v1', 'media runtime uses the same versioned chunk manifest schema as the large-media STT baseline');
assertIncludes(nativeMediaRuntime, 'SDKWORK_AUTOCUT_WHISPER_CHUNK_PARALLELISM', 'media runtime exposes native chunk parallelism tuning for commercial large-file benchmarking');
assertIncludes(nativeMediaRuntime, 'pub stt_preset_id: Option<String>', 'media runtime accepts the selected Smart Slice STT workflow preset id from the service boundary');
assertIncludes(nativeMediaRuntime, 'pub whisper_chunk_parallelism: Option<usize>', 'media runtime accepts product-facing local Whisper chunk parallelism overrides');
assertIncludes(nativeMediaRuntime, 'AutoCutSpeechTranscriptionExecutionOptions', 'media runtime isolates STT execution strategy options from the media request model');
assertIncludes(nativeMediaRuntime, 'normalize_autocut_whisper_chunk_option', 'media runtime validates STT strategy chunk override bounds before starting long-video transcription');
assertIncludes(nativeMediaRuntime, 'execution_options.whisper_chunk_parallelism', 'media runtime uses the selected STT strategy to override chunked local Whisper parallelism');
assertIncludes(nativeMediaRuntime, '"sttPresetId": execution_options.stt_preset_id', 'media runtime records the STT strategy preset in the large-media chunk manifest');
assertIncludes(nativeMediaRuntime, 'long_speech_transcription_writes_observable_chunk_manifest', 'media runtime tests versioned chunk manifest persistence');
assertIncludes(nativeMediaRuntime, 'speech_transcription_execution_options_reject_invalid_chunk_strategy', 'media runtime tests fail-closed validation for invalid STT strategy chunk overrides');
assertIncludes(nativeMediaRuntime, 'long_speech_transcription_writes_strategy_options_to_chunk_manifest', 'media runtime tests chunk manifest observability for selected STT strategy options');
assertIncludes(nativeMediaRuntime, 'long_speech_transcription_writes_merged_transcript_as_parseable_whisper_json', 'media runtime tests that merged chunk transcripts stay parseable by the canonical STT parser');
assertIncludes(nativeMediaRuntime, 'WHISPER_SUBTITLE_FRIENDLY_MAX_SEGMENT_CHARS', 'media runtime caps local Whisper segment length for subtitle-friendly timestamp granularity');
assertIncludes(nativeMediaRuntime, '.args(["-ml", WHISPER_SUBTITLE_FRIENDLY_MAX_SEGMENT_CHARS, "-sow"])', 'media runtime asks whisper-cli to emit subtitle-friendly word-boundary segments');
assertIncludes(nativeMediaRuntime, '"-ojf"', 'media runtime asks whisper-cli to include full JSON timing details for professional subtitle pacing');
assertIncludes(slicerService, 'createSmartSliceWordTimedSubtitleSegments', 'Slicer service uses word-level STT timings when available for spoken-progress subtitle pacing');
assertIncludes(nativeMediaRuntime, 'build_video_slice_burned_subtitle_force_style', 'media runtime centralizes adaptive burned subtitle force_style generation for native rendering');
assertIncludes(nativeMediaRuntime, 'video_slice_burned_subtitle_style_preset', 'media runtime applies the selected subtitleStyleId to burned subtitle rendering');
assertIncludes(nativeMediaRuntime, 'FontName=Microsoft YaHei', 'media runtime uses a CJK-safe burned subtitle font for Chinese short-video captions');
assertIncludes(nativeMediaRuntime, 'matches!(self, Self::Srt | Self::Burned | Self::Both)', 'media runtime persists editable SRT sidecars for burned subtitle rendering as well as SRT-only and combined modes');
assertIncludes(nativeMediaRuntime, 'video_slice_burned_subtitle_mode_persists_editable_srt_sidecar', 'media runtime tests burned subtitle rendering also preserves per-slice editable SRT files');
assertIncludes(nativeMediaRuntime, 'BorderStyle=1', 'media runtime explicitly requests ASS outlined subtitle rendering for readability');
assertIncludes(nativeMediaRuntime, 'Encoding=1', 'media runtime explicitly requests subtitle text encoding for CJK rendering stability');
assertIncludes(nativeMediaRuntime, 'VIDEO_SLICE_SUBTITLE_MAX_CJK_UNITS: usize = 18', 'media runtime keeps CJK subtitle cue lines compact for vertical short-video readability');
assertIncludes(nativeMediaRuntime, 'video_slice_srt_subtitles_keep_cjk_cues_short_for_speech_progress', 'media runtime tests CJK subtitle cues follow speech progress instead of rendering a full sentence statically');
assertIncludes(nativeMediaRuntime, 'append_whisper_progress_output_args', 'media runtime enables local Whisper progress output instead of treating worker lease heartbeat as user-visible STT progress');
assertIncludes(nativeMediaRuntime, 'append_whisper_progress_output_args(&mut command);', 'media runtime passes whisper-cli the print-progress flag before spawning local STT');
assertIncludes(nativeMediaRuntime, 'parse_whisper_progress_percent', 'media runtime parses real whisper-cli progress callback output from stderr');
assertIncludes(nativeMediaRuntime, 'parse_whisper_progress_percent(line)', 'media runtime reads whisper-cli stderr progress lines from the native media progress loop');
assertIncludes(nativeMediaRuntime, 'record_local_whisper_streaming_progress', 'media runtime records local Whisper runtime progress through the native task progress event/log pipeline');
assertIncludes(nativeMediaRuntime, 'record_local_whisper_streaming_progress(', 'media runtime persists whisper-cli progress into the task observability pipeline');
assertIncludes(nativeMediaRuntime, '"phase": "local-whisper-progress"', 'media runtime emits a distinct local Whisper progress phase for task log queries');
assertIncludes(nativeMediaRuntime, '"source": "whisper-cli-progress"', 'media runtime marks local STT runtime progress as provider progress, not worker lease heartbeat');
assertIncludes(nativeMediaRuntime, 'map_local_whisper_cli_progress_to_task_progress', 'media runtime maps provider STT progress into the bounded speech-to-text task stage range');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_discovers_whisper_cli_from_system_path_when_not_configured', 'media runtime tests automatic local whisper-cli discovery from PATH before reporting missing executablePath');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_uses_existing_default_model_path_when_model_is_not_configured', 'media runtime tests automatic default local STT model path detection');
assertIncludes(nativeMediaRuntime, 'select_autocut_speech_transcription_file', 'media runtime implements trusted local speech tool file selection');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_explicit_settings_override_env_fallback', 'media runtime tests that saved speech tool settings override environment fallback');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_uses_bundled_whisper_sidecar_when_executable_is_not_configured', 'media runtime tests that packaged whisper-cli sidecars can initialize local speech-to-text executable discovery');
assertIncludes(nativeMediaRuntime, 'speech_transcription_probe_validates_model_path_without_fake_readiness', 'media runtime tests local speech-to-text probe validation');
assertIncludes(nativeMediaRuntime, 'MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES', 'media runtime enforces a minimum viable local speech model byte size');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_rejects_partial_download_model_files', 'media runtime tests that partial .download speech model files are rejected');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_rejects_too_small_model_files', 'media runtime tests that incomplete local speech model files are rejected');
assertIncludes(nativeMediaRuntime, 'pub duration_ms: Option<i64>', 'media runtime exposes source media duration for smart slice planning');
assertIncludes(nativeMediaRuntime, '"durationMs": duration_ms', 'media runtime stores imported media duration in asset metadata for audits');
assertIncludes(nativeMediaRuntime, 'probe_autocut_media_evidence(Some(toolchain), &sandbox_path)', 'media runtime probes imported media stream and duration evidence without blocking import on probe failure');
assertIncludes(nativeMediaRuntime, 'video_slice_render_dimensions', 'media runtime defines canonical smart slice render dimensions');
assertIncludes(nativeMediaRuntime, '"9:16" => Some((1080, 1920))', 'media runtime maps 9:16 smart slices to 1080x1920 output');
assertIncludes(nativeMediaRuntime, 'force_original_aspect_ratio=increase', 'media runtime uses cover scaling for smart slice renderProfile cover mode');
assertIncludes(nativeMediaRuntime, 'crop={target_width}:{target_height}', 'media runtime crops cover smart slice renders to the target frame');
assertIncludes(nativeMediaRuntime, 'AUTOCUT_MEDIA_TASK_COVER_DIR', 'media runtime defines a dedicated cover directory for generated task video thumbnails');
assertIncludes(nativeMediaRuntime, 'autocut_task_cover_dir', 'media runtime creates and validates the dedicated task cover directory before writing thumbnails');
assertIncludes(nativeMediaRuntime, 'force_original_aspect_ratio=decrease', 'media runtime uses contain scaling for smart slice renderProfile contain mode');
assertIncludes(nativeMediaRuntime, 'pad={target_width}:{target_height}', 'media runtime pads contain smart slice renders to the target frame');
assertIncludes(nativeMediaRuntime, 'setsar=1', 'media runtime normalizes sample aspect ratio after smart slice rendering');
assertIncludes(nativeMediaRuntime, 'run_ffmpeg_video_slice_with_encoder_fallback', 'media runtime runs smart slice rendering through a native FFmpeg encoder fallback chain instead of a single fixed encoder');
assertIncludes(nativeMediaRuntime, 'default_smart_slice_noise_reduction', 'media runtime centralizes the native smart-slice rendering and audio boundary analysis denoise default');
assertIncludes(nativeMediaRuntime, 'smart_slice_native_requests_honor_disabled_noise_reduction', 'media runtime tests that native smart-slice callers can skip broadband denoise for clean source audio');
assertIncludes(nativeMediaRuntime, 'ensure_video_slice_clip_audio_cleanup_evidence', 'media runtime rejects invalid smart-slice audio cleanup evidence before rendering');
assertIncludes(nativeMediaRuntime, 'video_slice_rejects_invalid_audio_cleanup_evidence_before_rendering', 'media runtime tests fail-closed validation for smart-slice cleanup metadata');
assertIncludes(nativeMediaRuntime, 'smart_slice_native_requests_default_to_raw_audio_when_noise_reduction_is_omitted', 'media runtime tests raw-audio defaults when native callers omit denoise flags');
assertIncludes(nativeMediaRuntime, 'clip.noise_reduction_applied = Some(apply_audio_noise_reduction)', 'media runtime makes request-level denoise the authoritative artifact evidence');
assertIncludes(nativeMediaRuntime, 'video_slice_audio_activity_analysis_preserves_raw_audio_when_denoise_is_disabled', 'media runtime tests raw audio boundary analysis does not add destructive denoise filters');
assertIncludes(nativeMediaRuntime, 'video_slice_audio_activity_analysis_rejects_all_silence_instead_of_stt_fallback', 'media runtime rejects all-silence audio activity analysis instead of emitting weak fallback evidence');
assertRule(
  !nativeMediaRuntime.includes('confidence: 0.55') && !nativeMediaRuntime.includes('Some(0.55)'),
  'media runtime has no weak STT-only audio activity confidence fallback',
);
assertIncludes(nativeMediaRuntime, 'should_run_video_slice_audio_cleanup_postprocess', 'media runtime gates post-cut audio cleanup so large-file smart slices do not re-analyze audio after upstream boundary planning');
assertIncludes(nativeMediaRuntime, 'AutoCutVideoSliceAudioPostprocessDecision', 'media runtime records an explicit smart-slice audio postprocess decision instead of implicit always-on postprocessing');
assertIncludes(nativeMediaRuntime, 'ffmpeg-video-slice-postprocess-skipped', 'media runtime emits audit progress when native smart-slice skips redundant post-cut processing');
assertIncludes(nativeMediaRuntime, 'postprocessSkipReason', 'media runtime records why the large-file render fast path skipped native post-cut cleanup');
assertIncludes(nativeMediaRuntime, 'video_slice_audio_postprocess_skips_upstream_audio_activity_plan_for_large_file_rendering', 'media runtime tests that upstream audio boundary analysis avoids redundant native post-cut analysis');
assertIncludes(nativeMediaRuntime, 'video_slice_audio_postprocess_skips_precomputed_source_segments_for_one_pass_rendering', 'media runtime tests that precomputed sourceSegments render in one native pass');
assertIncludes(nativeMediaRuntime, 'video_slice_audio_postprocess_skipped_render_pass_keeps_cleanup_filters', 'media runtime tests that one-pass large-file rendering still applies requested denoise, mute, and tail filters');
assertIncludes(nativeMediaRuntime, 'create_video_slice_render_pass_clip', 'media runtime keeps full sourceSegments and cleanup filters on the render pass when redundant postprocess is skipped');
assertIncludes(nativeMediaRuntime, 'should_apply_video_slice_audio_cleanup_during_render_pass', 'media runtime applies requested cleanup filters during the single render pass when postprocess is skipped');
assertIncludes(nativeMediaRuntime, 'video_slice_audio_postprocess_runs_only_when_cleanup_plan_is_missing', 'media runtime preserves post-cut cleanup fallback only when no upstream cleanup plan exists');
assertIncludes(slicerService, "nativeAudioPostprocessPolicy: 'use-upstream-audio-boundary-plan'", 'slicer service declares that native rendering should consume the upstream audio boundary plan for fast large-file slicing');
assertIncludes(slicerService, 'clipsWithAudioActivityEvidence', 'slicer service logs clips with audio activity evidence before native rendering for performance diagnostics');
assertIncludes(slicerService, 'clipsWithSourceSegments', 'slicer service logs clips with sourceSegments before native rendering for performance diagnostics');
assertIncludes(nativeMediaRuntime, 'autocut_video_slice_encoder_candidates', 'media runtime defines platform-aware native smart slice hardware encoder candidates');
assertIncludes(nativeMediaRuntime, 'h264_nvenc', 'media runtime can use NVIDIA NVENC for native smart slice rendering on Windows/Linux when FFmpeg supports it');
assertIncludes(nativeMediaRuntime, 'h264_qsv', 'media runtime can use Intel Quick Sync for native smart slice rendering on Windows/Linux when FFmpeg supports it');
assertIncludes(nativeMediaRuntime, 'h264_amf', 'media runtime can use AMD AMF for native smart slice rendering on Windows when FFmpeg supports it');
assertIncludes(nativeMediaRuntime, 'h264_videotoolbox', 'media runtime can use Apple VideoToolbox for native smart slice rendering on macOS');
assertIncludes(nativeMediaRuntime, 'h264_vaapi', 'media runtime can use VAAPI for native smart slice rendering on Linux when a render device exists');
assertIncludes(nativeMediaRuntime, 'autocut_video_slice_cpu_encoder_candidate', 'media runtime always keeps libx264 CPU rendering as the last smart slice fallback');
assertIncludes(nativeMediaRuntime, 'format_video_slice_encoder_attempt_diagnostics', 'media runtime reports every failed native smart slice encoder attempt in diagnostics');
assertIncludes(nativeMediaRuntime, 'remove_partial_video_slice_output', 'media runtime removes partial smart slice files before retrying the next encoder');
assertIncludes(nativeMediaRuntime, 'video_slice_encoder_candidates_prioritize_platform_hardware_and_end_with_cpu_fallback', 'media runtime tests the native smart slice hardware-first CPU-fallback encoder policy');
assertRule(!nativeMediaRuntime.includes('"subtitleSegmentCount"'), 'media runtime does not persist subtitleSegmentCount as required smart-slice STT evidence');
assertRule(!nativeMediaRuntime.includes('"subtitleArtifactCount": subtitle_segments.len()'), 'media runtime does not report requested subtitle segment count as generated subtitle artifact count');
assertIncludes(nativeMediaRuntime, '.filter(|slice| slice.subtitle_artifact_uuid.is_some())', 'media runtime counts generated subtitle artifacts from completed slice outputs');
const nativeCargoToml = read('packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml');
assertIncludes(nativeCargoToml, 'rfd = { version = "0.16.0"', 'desktop Tauri crate declares rfd for the contracted trusted local file chooser');

const messagesPage = read('packages/sdkwork-autocut-messages/src/pages/MessagesPage.tsx');
for (const marker of ['getMessages', 'updateMessageRead', 'markAllMessagesRead', 'clearReadMessages', 'handleActionClick']) {
  assertIncludes(messagesPage, marker, `MessagesPage contains message workflow marker ${marker}`);
}

if (failures.length > 0) {
  console.error('AutoCut feature workflow check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exit(1);
}

console.log(`AutoCut feature workflow check passed (${pass.length} checks).`);
