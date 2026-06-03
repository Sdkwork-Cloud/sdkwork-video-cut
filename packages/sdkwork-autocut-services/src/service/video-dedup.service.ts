import type {
  AppAsset,
  VideoDedupEvidence,
  VideoDedupMode,
  VideoDedupParams,
  VideoDedupReport,
  VideoDedupSensitivity,
  VideoDedupStrategyId,
  VideoDuplicateGroup,
  VideoDuplicateMatch,
} from '@sdkwork/autocut-types';
import { getAssets } from './assets.service';
import { sortAutoCutRecordsByUpdatedAtDesc } from './datetime.service';
import { createAutoCutId, createAutoCutTimestamp } from './identity.service';
import {
  getAutoCutNativeHostClient,
  type AutoCutAudioFingerprintResult,
  type AutoCutVisualEvidenceExtractionResult,
  type AutoCutVideoFileFingerprintResult,
  type AutoCutVideoFileIdentityResult,
} from './native-host-client.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';
import { getAutoCutI18nText } from './i18n.service';

export interface AutoCutVideoDedupStrategyDefinition {
  id: VideoDedupStrategyId;
  name: string;
  description: string;
  evidenceKind: 'file' | 'container' | 'visual' | 'temporal' | 'audio' | 'transcript' | 'template';
  runtimeCost: 'low' | 'medium' | 'high';
  defaultEnabled: boolean;
}

export interface AutoCutVideoDedupAnalysisOptions {
  runtimeAssets?: AppAsset[];
}

export const AUTOCUT_VIDEO_DEDUP_STRATEGIES = [
  {
    id: 'exact-file-hash',
    name: 'Exact file signature',
    description: 'Detect identical source assets by stable metadata and file-size signature.',
    evidenceKind: 'file',
    runtimeCost: 'low',
    defaultEnabled: true,
  },
  {
    id: 'container-normalized',
    name: 'Container-normalized copy',
    description: 'Detect likely remuxed copies with matching normalized titles and close file sizes.',
    evidenceKind: 'container',
    runtimeCost: 'low',
    defaultEnabled: true,
  },
  {
    id: 'visual-fingerprint',
    name: 'Visual fingerprint',
    description: 'Detect near-duplicate picture content across cuts, exports, and light edits.',
    evidenceKind: 'visual',
    runtimeCost: 'medium',
    defaultEnabled: true,
  },
  {
    id: 'temporal-video-copy',
    name: 'Temporal partial copy',
    description: 'Detect partial video reuse after trimming, speed changes, or reordered clips.',
    evidenceKind: 'temporal',
    runtimeCost: 'high',
    defaultEnabled: false,
  },
  {
    id: 'audio-fingerprint',
    name: 'Audio fingerprint',
    description: 'Detect duplicate voice, music, or soundtrack reuse even when visuals differ.',
    evidenceKind: 'audio',
    runtimeCost: 'medium',
    defaultEnabled: true,
  },
  {
    id: 'transcript-semantic',
    name: 'Transcript semantic',
    description: 'Detect repeated speech topics and duplicate spoken content after STT.',
    evidenceKind: 'transcript',
    runtimeCost: 'medium',
    defaultEnabled: true,
  },
  {
    id: 'template-reuse',
    name: 'Template reuse',
    description: 'Separate intro, outro, logo, and layout reuse from actual duplicate content.',
    evidenceKind: 'template',
    runtimeCost: 'low',
    defaultEnabled: true,
  },
] as const satisfies readonly AutoCutVideoDedupStrategyDefinition[];

const DEFAULT_VIDEO_DEDUP_STRATEGIES = AUTOCUT_VIDEO_DEDUP_STRATEGIES
  .filter((strategy) => strategy.defaultEnabled)
  .map((strategy) => strategy.id);

const VIDEO_DEDUP_SENSITIVITY_THRESHOLDS: Record<VideoDedupSensitivity, number> = {
  low: 0.92,
  balanced: 0.82,
  high: 0.72,
  forensic: 0.62,
};

const VIDEO_DEDUP_MODE_MINIMUM_SCORE_BONUS: Record<VideoDedupMode, number> = {
  'quick-scan': 0.04,
  standard: 0,
  'deep-audit': -0.06,
  'publish-risk': -0.03,
  'slice-result-dedup': -0.04,
  'library-monitor': 0.02,
};

const VIDEO_DEDUP_STRATEGY_WEIGHT: Record<VideoDedupStrategyId, number> = {
  'exact-file-hash': 1,
  'container-normalized': 0.9,
  'visual-fingerprint': 0.86,
  'temporal-video-copy': 0.84,
  'audio-fingerprint': 0.78,
  'transcript-semantic': 0.76,
  'template-reuse': 0.48,
};

const VIDEO_DEDUP_FINGERPRINT_VERSION = '2026-05-15.video-file-fingerprint.v1';
const VIDEO_DEDUP_FILE_IDENTITY_VERSION = '2026-05-15.video-file-identity.v1';
const VIDEO_DEDUP_FINGERPRINT_CACHE_LIMIT = 2_000;
const VIDEO_DEDUP_VISUAL_EVIDENCE_VERSION = '2026-05-16.visual-evidence.scene-index-v1.ahash-v1';
const VIDEO_DEDUP_VISUAL_EVIDENCE_PROFILE = 'scene-index-v1';
const VIDEO_DEDUP_VISUAL_EVIDENCE_SCENE_CHANGE_THRESHOLD = 0.32;
const VIDEO_DEDUP_VISUAL_EVIDENCE_MIN_SHOT_DURATION_MS = 1_600;
const VIDEO_DEDUP_VISUAL_EVIDENCE_CACHE_LIMIT = 1_000;

const VIDEO_DEDUP_TEMPLATE_TOKENS = new Set([
  'intro',
  'outro',
  'opening',
  'ending',
  'logo',
  'template',
  'watermark',
  'bumper',
  'title',
  'cover',
  '片头',
  '片尾',
  '模板',
  '水印',
  '开场',
  '结尾',
]);

const VIDEO_DEDUP_LOW_SIGNAL_TOKENS = new Set([
  'video',
  'final',
  'export',
  'copy',
  'clip',
  'draft',
  'new',
  'old',
  'mp4',
  'mov',
  'mkv',
  'avi',
  '1080p',
  '720p',
  '4k',
  '2k',
  'v1',
  'v2',
  'v3',
]);

interface NormalizedVideoAsset {
  asset: AppAsset;
  baseName: string;
  tokens: Set<string>;
  templateTokens: Set<string>;
  signature: string;
  signatureSource: 'native-sha256' | 'metadata-proxy';
  nativeVisualSignature?: AutoCutVideoDedupVisualSignature;
  nativeAudioSignature?: AutoCutVideoDedupAudioSignature;
  nativeSha256?: string;
  nativeByteSize?: number;
  size: number;
}

interface ScoredEvidence {
  evidence: VideoDedupEvidence;
  weight: number;
}

interface AutoCutVideoDedupFingerprintCacheEntry {
  cacheKey: string;
  assetId: string;
  sourcePath: string;
  assetSize: number;
  assetUpdatedAt: string;
  byteSize: number;
  modifiedAtMs: number;
  sha256: string;
  algorithm: 'sha256';
  fingerprintVersion: string;
  fileIdentityVersion: string;
  createdAt: string;
  updatedAt: string;
}

interface AutoCutVideoDedupVisualEvidenceCacheEntry {
  cacheKey: string;
  assetId: string;
  sourcePath: string;
  assetSize: number;
  assetUpdatedAt: string;
  byteSize: number;
  modifiedAtMs: number;
  visualEvidenceVersion: string;
  fileIdentityVersion: string;
  profile: string;
  sceneChangeThreshold: number;
  minShotDurationMs: number;
  includeFrameQuality: boolean;
  includeFrameFingerprint: boolean;
  signature: AutoCutVideoDedupVisualSignature;
  createdAt: string;
  updatedAt: string;
}

interface AutoCutVideoDedupVisualQualityVector {
  blurScore: number;
  exposureScore: number;
  stabilityScore: number;
}

interface AutoCutVideoDedupFrameFingerprint {
  atMs: number;
  algorithm: string;
  hash: string;
  meanLuma: number;
  histogram: number[];
}

interface AutoCutVideoDedupVisualSignature {
  source: 'native-visual-evidence';
  provider: string;
  profile: string;
  signature: string;
  durationMs: number;
  shotCount: number;
  sceneBoundaryCount: number;
  shotDurationRatios: number[];
  shotDurationBuckets: number[];
  quality?: AutoCutVideoDedupVisualQualityVector;
  frameFingerprints: AutoCutVideoDedupFrameFingerprint[];
}

interface AutoCutVideoDedupVisualSimilarity {
  score: number;
  contentScore: number;
  patternScore: number;
  sceneScore: number;
  qualityScore: number;
  contentEvidenceReady: boolean;
  exactSignature: boolean;
}

interface AutoCutVideoDedupAudioSignature {
  source: 'native-audio-fingerprint';
  provider: string;
  profile: string;
  algorithm: string;
  hash: string;
  durationMs: number;
  sampleRateHz: number;
  windowDurationMs: number;
  energyBuckets: number[];
  silenceRatio: number;
  spectralCentroidBuckets: number[];
}

interface AutoCutVideoDedupAudioSimilarity {
  score: number;
  energyScore: number;
  spectralScore: number;
  durationScore: number;
  silenceScore: number;
  exactSignature: boolean;
}

export function createDefaultAutoCutVideoDedupParams(
  overrides: Partial<VideoDedupParams> = {},
): VideoDedupParams {
  const strategies = overrides.strategies?.length ? [...overrides.strategies] : [...DEFAULT_VIDEO_DEDUP_STRATEGIES];
  const sourceAssetIds = overrides.sourceAssetIds ? [...overrides.sourceAssetIds] : [];
  const normalized: VideoDedupParams = {
    mode: overrides.mode ?? 'standard',
    sourceAssetIds,
    strategies,
    sensitivity: overrides.sensitivity ?? 'balanced',
    minMatchDurationMs: clampInteger(overrides.minMatchDurationMs, 1_000, 600_000, 8_000),
    ignoreIntroOutro: overrides.ignoreIntroOutro ?? true,
    introOutroMaxDurationMs: clampInteger(overrides.introOutroMaxDurationMs, 0, 120_000, 12_000),
    actionMode: overrides.actionMode ?? 'review-before-action',
  };

  if (overrides.referenceAssetIds) {
    normalized.referenceAssetIds = [...overrides.referenceAssetIds];
  }

  return normalized;
}

function mergeAutoCutVideoDedupAssets(
  persistentAssets: readonly AppAsset[],
  runtimeAssets: readonly AppAsset[],
) {
  const assetById = new Map<string, AppAsset>();
  for (const asset of persistentAssets) {
    assetById.set(asset.id, asset);
  }
  for (const asset of runtimeAssets) {
    assetById.set(asset.id, asset);
  }
  return [...assetById.values()];
}

export async function analyzeAutoCutVideoDedup(
  params: VideoDedupParams,
  options: AutoCutVideoDedupAnalysisOptions = {},
): Promise<VideoDedupReport> {
  await randomDelay(80, 160);
  const normalizedParams = createDefaultAutoCutVideoDedupParams(params);
  const persistentVideoAssets = (await getAssets()).filter((asset) => asset.type === 'video');
  const runtimeVideoAssets = (options.runtimeAssets ?? []).filter((asset) => asset.type === 'video');
  const videoAssets = mergeAutoCutVideoDedupAssets(persistentVideoAssets, runtimeVideoAssets);
  const selectedSourceIds = new Set(
    normalizedParams.sourceAssetIds.length ? normalizedParams.sourceAssetIds : videoAssets.map((asset) => asset.id),
  );
  const selectedReferenceIds = new Set(
    normalizedParams.referenceAssetIds?.length
      ? normalizedParams.referenceAssetIds
      : videoAssets.map((asset) => asset.id),
  );
  const sourceAssets = videoAssets.filter((asset) => selectedSourceIds.has(asset.id));
  const referenceAssets = videoAssets.filter((asset) => selectedReferenceIds.has(asset.id));
  const nativeFingerprints = normalizedParams.strategies.includes('exact-file-hash')
    ? await collectNativeVideoDedupFingerprints([...sourceAssets, ...referenceAssets])
    : new Map<string, AutoCutVideoFileFingerprintResult>();
  const nativeVisualSignatures = normalizedParams.strategies.includes('visual-fingerprint')
    ? await collectNativeVideoDedupVisualSignatures([...sourceAssets, ...referenceAssets])
    : new Map<string, AutoCutVideoDedupVisualSignature>();
  const nativeAudioSignatures = normalizedParams.strategies.includes('audio-fingerprint')
    ? await collectNativeVideoDedupAudioSignatures([...sourceAssets, ...referenceAssets])
    : new Map<string, AutoCutVideoDedupAudioSignature>();
  const normalizedSources = sourceAssets.map((asset) =>
    normalizeVideoAssetForDedup(
      asset,
      nativeFingerprints.get(asset.id),
      nativeVisualSignatures.get(asset.id),
      nativeAudioSignatures.get(asset.id),
    )
  );
  const normalizedReferences = referenceAssets.map((asset) =>
    normalizeVideoAssetForDedup(
      asset,
      nativeFingerprints.get(asset.id),
      nativeVisualSignatures.get(asset.id),
      nativeAudioSignatures.get(asset.id),
    )
  );
  const threshold = Math.max(
    0.1,
    Math.min(0.98, VIDEO_DEDUP_SENSITIVITY_THRESHOLDS[normalizedParams.sensitivity] +
      VIDEO_DEDUP_MODE_MINIMUM_SCORE_BONUS[normalizedParams.mode]),
  );
  const enabledStrategies = new Set(normalizedParams.strategies);
  const matches: VideoDuplicateMatch[] = [];
  const seenPairKeys = new Set<string>();

  for (const source of normalizedSources) {
    for (const target of normalizedReferences) {
      if (source.asset.id === target.asset.id) {
        continue;
      }

      const pairKey = createStablePairKey(source.asset.id, target.asset.id);
      if (seenPairKeys.has(pairKey)) {
        continue;
      }
      seenPairKeys.add(pairKey);

      const match = scoreVideoAssetPair(source, target, normalizedParams, enabledStrategies, threshold);
      if (match) {
        matches.push(match);
      }
    }
  }

  const groups = createVideoDuplicateGroups(matches, videoAssets);
  const duplicateAssetIds = new Set(groups.flatMap((group) => group.duplicateAssetIds));
  const reclaimableBytes = videoAssets
    .filter((asset) => duplicateAssetIds.has(asset.id))
    .reduce((total, asset) => total + Math.max(0, asset.size), 0);

  return {
    id: createAutoCutId('video-dedup-report'),
    createdAt: createAutoCutTimestamp(),
    params: normalizedParams,
    scannedAssetCount: new Set([...sourceAssets, ...referenceAssets].map((asset) => asset.id)).size,
    duplicateGroupCount: groups.length,
    matchCount: matches.length,
    reclaimableBytes,
    strategies: [...enabledStrategies],
    groups,
    matches,
  };
}

function scoreVideoAssetPair(
  source: NormalizedVideoAsset,
  target: NormalizedVideoAsset,
  params: VideoDedupParams,
  enabledStrategies: ReadonlySet<VideoDedupStrategyId>,
  threshold: number,
): VideoDuplicateMatch | undefined {
  const scoredEvidence: ScoredEvidence[] = [];
  const tokenSimilarity = calculateTokenSimilarity(source.tokens, target.tokens);
  const templateSimilarity = calculateTokenSimilarity(source.templateTokens, target.templateTokens);
  const sizeSimilarity = calculateSizeSimilarity(source.size, target.size);
  const sameTaskLineage = Boolean(
    source.asset.sourceTaskId &&
      target.asset.sourceTaskId &&
      source.asset.sourceTaskId === target.asset.sourceTaskId,
  );
  const nativeVisualSimilarity = enabledStrategies.has('visual-fingerprint')
    ? calculateNativeVideoDedupVisualSimilarity(source.nativeVisualSignature, target.nativeVisualSignature)
    : undefined;
  const hasNativeVisualPair = Boolean(source.nativeVisualSignature && target.nativeVisualSignature);
  const nativeAudioSimilarity = enabledStrategies.has('audio-fingerprint')
    ? calculateNativeVideoDedupAudioSimilarity(source.nativeAudioSignature, target.nativeAudioSignature)
    : undefined;
  const hasNativeAudioPair = Boolean(source.nativeAudioSignature && target.nativeAudioSignature);
  const timeRange = createVideoDedupTimeRange(params);

  if (
    enabledStrategies.has('exact-file-hash') &&
    source.signature === target.signature &&
    source.size === target.size
  ) {
    const nativeExactMatch = source.signatureSource === 'native-sha256' && target.signatureSource === 'native-sha256';
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'exact-file-hash',
        1,
        'Exact file signature',
        nativeExactMatch
          ? 'Native SHA-256 file fingerprint and byte size match exactly.'
          : 'The normalized name and byte size match exactly.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['exact-file-hash'],
    });
  }

  if (
    enabledStrategies.has('container-normalized') &&
    source.baseName === target.baseName &&
    sizeSimilarity >= 0.72
  ) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'container-normalized',
        Math.max(0.74, sizeSimilarity),
        'Container-normalized copy',
        'The normalized title matches and file sizes are close enough for likely remuxed copies.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['container-normalized'],
    });
  }

  if (nativeVisualSimilarity && nativeVisualSimilarity.score >= 0.7) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'visual-fingerprint',
        nativeVisualSimilarity.score,
        'Native visual fingerprint',
        createNativeVideoDedupVisualEvidenceDetail(source.nativeVisualSignature, target.nativeVisualSignature, nativeVisualSimilarity),
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['visual-fingerprint'],
    });
  } else if (enabledStrategies.has('visual-fingerprint') && !hasNativeVisualPair && tokenSimilarity >= 0.62) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'visual-fingerprint',
        Math.max(tokenSimilarity, sameTaskLineage ? 0.88 : 0),
        'Visual fingerprint proxy',
        'The visual fingerprint stage found a strong metadata-level picture-content proxy match.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['visual-fingerprint'],
    });
  }

  if (
    enabledStrategies.has('temporal-video-copy') &&
    (tokenSimilarity >= 0.52 || sameTaskLineage) &&
    sizeSimilarity >= 0.38
  ) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'temporal-video-copy',
        sameTaskLineage ? 0.86 : Math.min(0.9, (tokenSimilarity + sizeSimilarity) / 2 + 0.12),
        'Temporal partial copy',
        'The temporal strategy found a likely partial copy relation from shared naming, lineage, or size patterns.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['temporal-video-copy'],
    });
  }

  if (nativeAudioSimilarity && nativeAudioSimilarity.score >= 0.76) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'audio-fingerprint',
        nativeAudioSimilarity.score,
        'Native audio fingerprint',
        createNativeVideoDedupAudioEvidenceDetail(source.nativeAudioSignature, target.nativeAudioSignature, nativeAudioSimilarity),
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['audio-fingerprint'],
    });
  } else if (enabledStrategies.has('audio-fingerprint') && !hasNativeAudioPair && tokenSimilarity >= 0.56) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'audio-fingerprint',
        Math.min(0.92, tokenSimilarity + 0.1),
        'Audio fingerprint proxy',
        'The audio fingerprint stage found a likely shared soundtrack or speech-track signature.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['audio-fingerprint'],
    });
  }

  if (enabledStrategies.has('transcript-semantic') && tokenSimilarity >= 0.5) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'transcript-semantic',
        Math.min(0.94, tokenSimilarity + (sameTaskLineage ? 0.22 : 0.08)),
        'Transcript semantic proxy',
        'The transcript semantic strategy found repeated speech-topic evidence suitable for STT-backed review.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['transcript-semantic'],
    });
  }

  if (enabledStrategies.has('template-reuse') && templateSimilarity > 0) {
    scoredEvidence.push({
      evidence: createVideoDedupEvidence(
        'template-reuse',
        Math.max(0.65, templateSimilarity),
        'Template reuse',
        'The match is driven by intro, outro, logo, title, or publishing-template tokens.',
        timeRange,
      ),
      weight: VIDEO_DEDUP_STRATEGY_WEIGHT['template-reuse'],
    });
  }

  if (!scoredEvidence.length) {
    return undefined;
  }

  const weightedScore = scoredEvidence.reduce((total, item) => total + item.evidence.score * item.weight, 0);
  const weightTotal = scoredEvidence.reduce((total, item) => total + item.weight, 0);
  const confidence = Math.min(1, Math.max(0, weightedScore / Math.max(0.01, weightTotal)));
  const templateOnly =
    scoredEvidence.every((item) => item.evidence.strategyId === 'template-reuse') ||
    (templateSimilarity >= 0.85 && tokenSimilarity < 0.42);
  if (confidence < threshold && !templateOnly) {
    return undefined;
  }

  const evidence = scoredEvidence
    .map((item) => item.evidence)
    .sort((left, right) => right.score - left.score);
  const visualScore = maxEvidenceScore(evidence, ['visual-fingerprint', 'temporal-video-copy', 'container-normalized']);
  const audioScore = maxEvidenceScore(evidence, ['audio-fingerprint']);
  const transcriptScore = maxEvidenceScore(evidence, ['transcript-semantic']);
  const matchKind = resolveVideoDuplicateMatchKind(evidence, confidence, templateOnly);
  const recommendation = resolveVideoDuplicateRecommendation(matchKind, confidence, params.actionMode);

  return {
    id: createAutoCutId('video-dedup-match'),
    sourceAssetId: source.asset.id,
    targetAssetId: target.asset.id,
    matchKind,
    confidence: roundScore(confidence),
    ...(visualScore !== undefined ? { visualScore } : {}),
    ...(audioScore !== undefined ? { audioScore } : {}),
    ...(transcriptScore !== undefined ? { transcriptScore } : {}),
    temporalCoverageRatio: roundScore(templateOnly ? 0.18 : Math.max(0.35, Math.min(1, tokenSimilarity + sizeSimilarity / 3))),
    sourceStartMs: timeRange.sourceStartMs,
    sourceEndMs: timeRange.sourceEndMs,
    targetStartMs: timeRange.targetStartMs,
    targetEndMs: timeRange.targetEndMs,
    evidence,
    recommendation,
  };
}

function createVideoDuplicateGroups(
  matches: readonly VideoDuplicateMatch[],
  assets: readonly AppAsset[],
): VideoDuplicateGroup[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const groupedMatches = new Map<string, VideoDuplicateMatch[]>();

  for (const match of matches) {
    const canonicalId = chooseCanonicalAssetId(match.sourceAssetId, match.targetAssetId, assetById);
    const existing = groupedMatches.get(canonicalId) ?? [];
    existing.push(match);
    groupedMatches.set(canonicalId, existing);
  }

  return [...groupedMatches.entries()]
    .map(([canonicalAssetId, groupMatches]) => {
      const duplicateAssetIds = new Set<string>();
      const reviewAssetIds = new Set<string>();
      for (const match of groupMatches) {
        const targetId = match.sourceAssetId === canonicalAssetId ? match.targetAssetId : match.sourceAssetId;
        if (match.recommendation === 'archive-target') {
          duplicateAssetIds.add(targetId);
        } else {
          reviewAssetIds.add(targetId);
        }
      }

      const groupScore = roundScore(
        groupMatches.reduce((total, match) => total + match.confidence, 0) / Math.max(1, groupMatches.length),
      );

      return {
        id: createAutoCutId('video-dedup-group'),
        canonicalAssetId,
        duplicateAssetIds: [...duplicateAssetIds],
        reviewAssetIds: [...reviewAssetIds],
        groupScore,
        reason: createVideoDuplicateGroupReason(groupMatches),
        matches: [...groupMatches].sort((left, right) => right.confidence - left.confidence),
      };
    })
    .sort((left, right) => right.groupScore - left.groupScore);
}

function createVideoDuplicateGroupReason(matches: readonly VideoDuplicateMatch[]) {
  const strongest = [...matches].sort((left, right) => right.confidence - left.confidence)[0];
  if (!strongest) {
    return getAutoCutI18nText('videoDedup.groupReasons.noEvidence');
  }

  switch (strongest.matchKind) {
    case 'exact':
      return getAutoCutI18nText('videoDedup.groupReasons.exact');
    case 'same-audio':
      return getAutoCutI18nText('videoDedup.groupReasons.sameAudio');
    case 'same-speech':
      return getAutoCutI18nText('videoDedup.groupReasons.sameSpeech');
    case 'partial-copy':
      return getAutoCutI18nText('videoDedup.groupReasons.partialCopy');
    case 'template-only':
      return getAutoCutI18nText('videoDedup.groupReasons.templateOnly');
    case 'near-duplicate':
    default:
      return getAutoCutI18nText('videoDedup.groupReasons.nearDuplicate');
  }
}

function chooseCanonicalAssetId(
  leftAssetId: string,
  rightAssetId: string,
  assetById: ReadonlyMap<string, AppAsset>,
) {
  const left = assetById.get(leftAssetId);
  const right = assetById.get(rightAssetId);
  if (!left || !right) {
    return leftAssetId.localeCompare(rightAssetId) <= 0 ? leftAssetId : rightAssetId;
  }

  if (left.size !== right.size) {
    return left.size >= right.size ? left.id : right.id;
  }

  return left.createdAt.localeCompare(right.createdAt) <= 0 ? left.id : right.id;
}

async function collectNativeVideoDedupFingerprints(
  videoAssets: readonly AppAsset[],
): Promise<Map<string, AutoCutVideoFileFingerprintResult>> {
  const fingerprintableAssets = dedupeVideoDedupAssets(videoAssets).filter((asset) => Boolean(asset.artifactPath?.trim()));
  if (!fingerprintableAssets.length) {
    return new Map();
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  let capabilities;
  try {
    capabilities = await nativeHostClient.getCapabilities();
  } catch {
    return new Map();
  }

  if (capabilities.videoDedupFingerprintCommandReady !== true) {
    return new Map();
  }

  const fingerprints = new Map<string, AutoCutVideoFileFingerprintResult>();
  const cachedEntries = readValidVideoDedupFingerprintCacheEntries();
  const cacheByKey = new Map(cachedEntries.map((entry) => [entry.cacheKey, entry]));
  const nextCacheByKey = new Map(cacheByKey);
  let cacheChanged = false;
  await Promise.all(
    fingerprintableAssets.map(async (asset) => {
      const sourcePath = asset.artifactPath?.trim();
      if (!sourcePath) {
        return;
      }

      const cacheKey = createVideoDedupFingerprintCacheKey(asset, sourcePath);
      const cachedEntry = cacheByKey.get(cacheKey);
      if (cachedEntry && isUsableVideoDedupFingerprintCacheEntry(cachedEntry, asset, sourcePath)) {
        const currentIdentity = await probeCurrentVideoDedupFileIdentity(nativeHostClient, sourcePath, capabilities);
        if (currentIdentity && doesVideoDedupFingerprintCacheIdentityMatch(cachedEntry, currentIdentity)) {
          fingerprints.set(asset.id, createVideoDedupFingerprintResultFromCache(cachedEntry));
          return;
        }
      }

      try {
        const fingerprint = await nativeHostClient.fingerprintVideoFile({ sourcePath });
        if (
          fingerprint.algorithm.toLowerCase() === 'sha256' &&
          /^[a-f0-9]{64}$/u.test(fingerprint.sha256) &&
          fingerprint.byteSize >= 0 &&
          Number.isFinite(fingerprint.modifiedAtMs)
        ) {
          fingerprints.set(asset.id, {
            ...fingerprint,
            sha256: fingerprint.sha256.toLowerCase(),
          });
          nextCacheByKey.set(cacheKey, createVideoDedupFingerprintCacheEntry(asset, sourcePath, {
            ...fingerprint,
            sha256: fingerprint.sha256.toLowerCase(),
          }));
          cacheChanged = true;
        }
      } catch {
        // Browser URLs and moved local artifacts fall back to metadata proxy matching.
      }
    }),
  );

  if (cacheChanged) {
    writeAutoCutStorage('videoDedupFingerprints', limitVideoDedupFingerprintCacheEntries([...nextCacheByKey.values()]));
  }

  return fingerprints;
}

function readValidVideoDedupFingerprintCacheEntries(): AutoCutVideoDedupFingerprintCacheEntry[] {
  const storedEntries = readAutoCutStorage<unknown>('videoDedupFingerprints', []);
  return (Array.isArray(storedEntries) ? storedEntries : [])
    .filter(isValidVideoDedupFingerprintCacheEntry);
}

function isValidVideoDedupFingerprintCacheEntry(
  entry: unknown,
): entry is AutoCutVideoDedupFingerprintCacheEntry {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const candidate = entry as Partial<AutoCutVideoDedupFingerprintCacheEntry>;
  return Boolean(
    typeof candidate.cacheKey === 'string' &&
      typeof candidate.assetId === 'string' &&
      typeof candidate.sourcePath === 'string' &&
      Number.isFinite(candidate.assetSize) &&
      typeof candidate.assetUpdatedAt === 'string' &&
      Number.isFinite(candidate.byteSize) &&
      Number.isFinite(candidate.modifiedAtMs) &&
      typeof candidate.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(candidate.sha256) &&
      candidate.algorithm === 'sha256' &&
      candidate.fingerprintVersion === VIDEO_DEDUP_FINGERPRINT_VERSION &&
      candidate.fileIdentityVersion === VIDEO_DEDUP_FILE_IDENTITY_VERSION &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string',
  );
}

async function probeCurrentVideoDedupFileIdentity(
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>,
  sourcePath: string,
  capabilities: Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['getCapabilities']>>,
): Promise<AutoCutVideoFileIdentityResult | undefined> {
  if (capabilities.videoDedupFileIdentityCommandReady !== true) {
    return undefined;
  }

  try {
    const identity = await nativeHostClient.probeVideoFileIdentity({ sourcePath });
    if (
      identity.fileIdentityVersion === VIDEO_DEDUP_FILE_IDENTITY_VERSION &&
      identity.byteSize >= 0 &&
      Number.isFinite(identity.modifiedAtMs)
    ) {
      return identity;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function createVideoDedupFingerprintCacheKey(asset: AppAsset, sourcePath: string) {
  return [
    sourcePath,
    Math.max(0, asset.size),
    asset.updatedAt,
    VIDEO_DEDUP_FINGERPRINT_VERSION,
  ].join('|');
}

function isUsableVideoDedupFingerprintCacheEntry(
  entry: AutoCutVideoDedupFingerprintCacheEntry,
  asset: AppAsset,
  sourcePath: string,
) {
  return (
    entry.cacheKey === createVideoDedupFingerprintCacheKey(asset, sourcePath) &&
    entry.sourcePath === sourcePath &&
    entry.assetSize === Math.max(0, asset.size) &&
    entry.assetUpdatedAt === asset.updatedAt &&
    entry.fingerprintVersion === VIDEO_DEDUP_FINGERPRINT_VERSION &&
    entry.fileIdentityVersion === VIDEO_DEDUP_FILE_IDENTITY_VERSION &&
    entry.algorithm === 'sha256' &&
    /^[a-f0-9]{64}$/u.test(entry.sha256) &&
    Number.isFinite(entry.modifiedAtMs) &&
    entry.byteSize >= 0
  );
}

function doesVideoDedupFingerprintCacheIdentityMatch(
  entry: AutoCutVideoDedupFingerprintCacheEntry,
  identity: AutoCutVideoFileIdentityResult,
) {
  return (
    identity.byteSize === entry.byteSize &&
    identity.modifiedAtMs === entry.modifiedAtMs &&
    identity.fileIdentityVersion === entry.fileIdentityVersion
  );
}

function createVideoDedupFingerprintResultFromCache(
  entry: AutoCutVideoDedupFingerprintCacheEntry,
): AutoCutVideoFileFingerprintResult {
  return {
    sourcePath: entry.sourcePath,
    byteSize: entry.byteSize,
    modifiedAtMs: entry.modifiedAtMs,
    sha256: entry.sha256,
    algorithm: entry.algorithm,
    fingerprintVersion: entry.fingerprintVersion,
    fileIdentityVersion: entry.fileIdentityVersion,
  };
}

function createVideoDedupFingerprintCacheEntry(
  asset: AppAsset,
  sourcePath: string,
  fingerprint: AutoCutVideoFileFingerprintResult,
): AutoCutVideoDedupFingerprintCacheEntry {
  const normalizedSourcePath = sourcePath.trim();
  const timestamp = createAutoCutTimestamp();
  return {
    cacheKey: createVideoDedupFingerprintCacheKey(asset, normalizedSourcePath),
    assetId: asset.id,
    sourcePath: normalizedSourcePath,
    assetSize: Math.max(0, asset.size),
    assetUpdatedAt: asset.updatedAt,
    byteSize: Math.max(0, fingerprint.byteSize),
    modifiedAtMs: Math.max(0, Math.round(fingerprint.modifiedAtMs ?? 0)),
    sha256: fingerprint.sha256.toLowerCase(),
    algorithm: 'sha256',
    fingerprintVersion: VIDEO_DEDUP_FINGERPRINT_VERSION,
    fileIdentityVersion: fingerprint.fileIdentityVersion ?? VIDEO_DEDUP_FILE_IDENTITY_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function limitVideoDedupFingerprintCacheEntries(
  entries: readonly AutoCutVideoDedupFingerprintCacheEntry[],
): AutoCutVideoDedupFingerprintCacheEntry[] {
  return sortAutoCutRecordsByUpdatedAtDesc(entries.filter(isValidVideoDedupFingerprintCacheEntry))
    .slice(0, VIDEO_DEDUP_FINGERPRINT_CACHE_LIMIT);
}

async function collectNativeVideoDedupVisualSignatures(
  videoAssets: readonly AppAsset[],
): Promise<Map<string, AutoCutVideoDedupVisualSignature>> {
  const visualEvidenceAssets = dedupeVideoDedupAssets(videoAssets).filter((asset) => Boolean(asset.id.trim()));
  if (!visualEvidenceAssets.length) {
    return new Map();
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  let capabilities;
  try {
    capabilities = await nativeHostClient.getCapabilities();
  } catch {
    return new Map();
  }

  if (
    capabilities.visualEvidenceExtractionCommandReady !== true ||
    capabilities.visualEvidenceExtractionAdapterReady !== true
  ) {
    return new Map();
  }

  const signatures = new Map<string, AutoCutVideoDedupVisualSignature>();
  const cachedEntries = readValidVideoDedupVisualEvidenceCacheEntries();
  const cacheByKey = new Map(cachedEntries.map((entry) => [entry.cacheKey, entry]));
  const nextCacheByKey = new Map(cacheByKey);
  let cacheChanged = false;
  await Promise.all(
    visualEvidenceAssets.map(async (asset) => {
      const sourcePath = asset.artifactPath?.trim();
      const cacheKey = sourcePath ? createVideoDedupVisualEvidenceCacheKey(asset, sourcePath) : undefined;
      const cachedEntry = cacheKey ? cacheByKey.get(cacheKey) : undefined;
      if (sourcePath && cachedEntry && isUsableVideoDedupVisualEvidenceCacheEntry(cachedEntry, asset, sourcePath)) {
        const currentIdentity = await probeCurrentVideoDedupFileIdentity(nativeHostClient, sourcePath, capabilities);
        if (currentIdentity && doesVideoDedupVisualEvidenceCacheIdentityMatch(cachedEntry, currentIdentity)) {
          signatures.set(asset.id, createVideoDedupVisualSignatureFromCache(cachedEntry));
          return;
        }
      }

      try {
        const evidence = await nativeHostClient.extractVisualEvidence({
          assetUuid: asset.id,
          ...(sourcePath ? { sourcePath } : {}),
          ...(asset.sourceTaskId ? { workflowTaskId: asset.sourceTaskId } : {}),
          visualEvidenceProfile: VIDEO_DEDUP_VISUAL_EVIDENCE_PROFILE,
          sceneChangeThreshold: VIDEO_DEDUP_VISUAL_EVIDENCE_SCENE_CHANGE_THRESHOLD,
          minShotDurationMs: VIDEO_DEDUP_VISUAL_EVIDENCE_MIN_SHOT_DURATION_MS,
          includeFrameQuality: true,
          includeFrameFingerprint: true,
        });
        const signature = createNativeVideoDedupVisualSignature(evidence);
        if (signature) {
          signatures.set(asset.id, signature);
          if (sourcePath && cacheKey) {
            const currentIdentity = await probeCurrentVideoDedupFileIdentity(nativeHostClient, sourcePath, capabilities);
            if (currentIdentity) {
              nextCacheByKey.set(cacheKey, createVideoDedupVisualEvidenceCacheEntry(asset, sourcePath, currentIdentity, signature));
              cacheChanged = true;
            }
          }
        }
      } catch {
        // Assets not backed by the native media index fall back to metadata proxy matching.
      }
    }),
  );

  if (cacheChanged) {
    writeAutoCutStorage('videoDedupVisualEvidence', limitVideoDedupVisualEvidenceCacheEntries([...nextCacheByKey.values()]));
  }

  return signatures;
}

function readValidVideoDedupVisualEvidenceCacheEntries(): AutoCutVideoDedupVisualEvidenceCacheEntry[] {
  const storedEntries = readAutoCutStorage<unknown>('videoDedupVisualEvidence', []);
  return (Array.isArray(storedEntries) ? storedEntries : [])
    .filter(isValidVideoDedupVisualEvidenceCacheEntry);
}

function isValidVideoDedupVisualEvidenceCacheEntry(
  entry: unknown,
): entry is AutoCutVideoDedupVisualEvidenceCacheEntry {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const candidate = entry as Partial<AutoCutVideoDedupVisualEvidenceCacheEntry>;
  return Boolean(
    typeof candidate.cacheKey === 'string' &&
      typeof candidate.assetId === 'string' &&
      typeof candidate.sourcePath === 'string' &&
      Number.isFinite(candidate.assetSize) &&
      typeof candidate.assetUpdatedAt === 'string' &&
      Number.isFinite(candidate.byteSize) &&
      Number.isFinite(candidate.modifiedAtMs) &&
      candidate.visualEvidenceVersion === VIDEO_DEDUP_VISUAL_EVIDENCE_VERSION &&
      candidate.fileIdentityVersion === VIDEO_DEDUP_FILE_IDENTITY_VERSION &&
      candidate.profile === VIDEO_DEDUP_VISUAL_EVIDENCE_PROFILE &&
      candidate.sceneChangeThreshold === VIDEO_DEDUP_VISUAL_EVIDENCE_SCENE_CHANGE_THRESHOLD &&
      candidate.minShotDurationMs === VIDEO_DEDUP_VISUAL_EVIDENCE_MIN_SHOT_DURATION_MS &&
      candidate.includeFrameQuality === true &&
      candidate.includeFrameFingerprint === true &&
      isValidVideoDedupVisualSignature(candidate.signature) &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string',
  );
}

function createVideoDedupVisualEvidenceCacheKey(asset: AppAsset, sourcePath: string) {
  return [
    asset.id,
    sourcePath,
    Math.max(0, asset.size),
    asset.updatedAt,
    VIDEO_DEDUP_VISUAL_EVIDENCE_VERSION,
    VIDEO_DEDUP_VISUAL_EVIDENCE_PROFILE,
    VIDEO_DEDUP_VISUAL_EVIDENCE_SCENE_CHANGE_THRESHOLD,
    VIDEO_DEDUP_VISUAL_EVIDENCE_MIN_SHOT_DURATION_MS,
    'includeFrameQuality=true',
    'includeFrameFingerprint=true',
  ].join('|');
}

function isUsableVideoDedupVisualEvidenceCacheEntry(
  entry: AutoCutVideoDedupVisualEvidenceCacheEntry,
  asset: AppAsset,
  sourcePath: string,
) {
  return (
    entry.cacheKey === createVideoDedupVisualEvidenceCacheKey(asset, sourcePath) &&
    entry.assetId === asset.id &&
    entry.sourcePath === sourcePath &&
    entry.assetSize === Math.max(0, asset.size) &&
    entry.assetUpdatedAt === asset.updatedAt &&
    entry.visualEvidenceVersion === VIDEO_DEDUP_VISUAL_EVIDENCE_VERSION &&
    entry.fileIdentityVersion === VIDEO_DEDUP_FILE_IDENTITY_VERSION &&
    entry.profile === VIDEO_DEDUP_VISUAL_EVIDENCE_PROFILE &&
    entry.sceneChangeThreshold === VIDEO_DEDUP_VISUAL_EVIDENCE_SCENE_CHANGE_THRESHOLD &&
    entry.minShotDurationMs === VIDEO_DEDUP_VISUAL_EVIDENCE_MIN_SHOT_DURATION_MS &&
    entry.includeFrameQuality === true &&
    entry.includeFrameFingerprint === true &&
    Number.isFinite(entry.modifiedAtMs) &&
    entry.byteSize >= 0 &&
    isValidVideoDedupVisualSignature(entry.signature)
  );
}

function doesVideoDedupVisualEvidenceCacheIdentityMatch(
  entry: AutoCutVideoDedupVisualEvidenceCacheEntry,
  identity: AutoCutVideoFileIdentityResult,
) {
  return (
    identity.byteSize === entry.byteSize &&
    identity.modifiedAtMs === entry.modifiedAtMs &&
    identity.fileIdentityVersion === entry.fileIdentityVersion
  );
}

function createVideoDedupVisualSignatureFromCache(
  entry: AutoCutVideoDedupVisualEvidenceCacheEntry,
): AutoCutVideoDedupVisualSignature {
  return cloneVideoDedupVisualSignature(entry.signature);
}

function cloneVideoDedupVisualSignature(
  signature: AutoCutVideoDedupVisualSignature,
): AutoCutVideoDedupVisualSignature {
  return {
    ...signature,
    shotDurationRatios: [...signature.shotDurationRatios],
    shotDurationBuckets: [...signature.shotDurationBuckets],
    frameFingerprints: signature.frameFingerprints.map((sample) => ({
      ...sample,
      histogram: [...sample.histogram],
    })),
    ...(signature.quality ? { quality: { ...signature.quality } } : {}),
  };
}

function createVideoDedupVisualEvidenceCacheEntry(
  asset: AppAsset,
  sourcePath: string,
  identity: AutoCutVideoFileIdentityResult,
  signature: AutoCutVideoDedupVisualSignature,
): AutoCutVideoDedupVisualEvidenceCacheEntry {
  const normalizedSourcePath = sourcePath.trim();
  const timestamp = createAutoCutTimestamp();
  return {
    cacheKey: createVideoDedupVisualEvidenceCacheKey(asset, normalizedSourcePath),
    assetId: asset.id,
    sourcePath: normalizedSourcePath,
    assetSize: Math.max(0, asset.size),
    assetUpdatedAt: asset.updatedAt,
    byteSize: Math.max(0, identity.byteSize),
    modifiedAtMs: Math.max(0, Math.round(identity.modifiedAtMs ?? 0)),
    visualEvidenceVersion: VIDEO_DEDUP_VISUAL_EVIDENCE_VERSION,
    fileIdentityVersion: identity.fileIdentityVersion ?? VIDEO_DEDUP_FILE_IDENTITY_VERSION,
    profile: VIDEO_DEDUP_VISUAL_EVIDENCE_PROFILE,
    sceneChangeThreshold: VIDEO_DEDUP_VISUAL_EVIDENCE_SCENE_CHANGE_THRESHOLD,
    minShotDurationMs: VIDEO_DEDUP_VISUAL_EVIDENCE_MIN_SHOT_DURATION_MS,
    includeFrameQuality: true,
    includeFrameFingerprint: true,
    signature: cloneVideoDedupVisualSignature(signature),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function limitVideoDedupVisualEvidenceCacheEntries(
  entries: readonly AutoCutVideoDedupVisualEvidenceCacheEntry[],
): AutoCutVideoDedupVisualEvidenceCacheEntry[] {
  return sortAutoCutRecordsByUpdatedAtDesc(entries.filter(isValidVideoDedupVisualEvidenceCacheEntry))
    .slice(0, VIDEO_DEDUP_VISUAL_EVIDENCE_CACHE_LIMIT);
}

function isValidVideoDedupVisualSignature(signature: unknown): signature is AutoCutVideoDedupVisualSignature {
  if (!signature || typeof signature !== 'object') {
    return false;
  }
  const candidate = signature as Partial<AutoCutVideoDedupVisualSignature>;
  return Boolean(
    candidate.source === 'native-visual-evidence' &&
      typeof candidate.provider === 'string' &&
      typeof candidate.profile === 'string' &&
      typeof candidate.signature === 'string' &&
      Number.isFinite(candidate.durationMs) &&
      Number.isFinite(candidate.shotCount) &&
      Number.isFinite(candidate.sceneBoundaryCount) &&
      Array.isArray(candidate.shotDurationRatios) &&
      candidate.shotDurationRatios.every((value) => Number.isFinite(value)) &&
      Array.isArray(candidate.shotDurationBuckets) &&
      candidate.shotDurationBuckets.every((value) => Number.isFinite(value)) &&
      Array.isArray(candidate.frameFingerprints) &&
      candidate.frameFingerprints.every(isValidVideoDedupFrameFingerprint) &&
      (candidate.quality === undefined || isValidVideoDedupVisualQualityVector(candidate.quality)),
  );
}

function isValidVideoDedupFrameFingerprint(sample: unknown): sample is AutoCutVideoDedupFrameFingerprint {
  if (!sample || typeof sample !== 'object') {
    return false;
  }
  const candidate = sample as Partial<AutoCutVideoDedupFrameFingerprint>;
  return Boolean(
    Number.isFinite(candidate.atMs) &&
      typeof candidate.algorithm === 'string' &&
      typeof candidate.hash === 'string' &&
      /^[a-f0-9]{16}$/u.test(candidate.hash) &&
      Number.isFinite(candidate.meanLuma) &&
      Array.isArray(candidate.histogram) &&
      candidate.histogram.length > 0 &&
      candidate.histogram.every((value) => Number.isFinite(value)),
  );
}

function isValidVideoDedupVisualQualityVector(quality: unknown): quality is AutoCutVideoDedupVisualQualityVector {
  if (!quality || typeof quality !== 'object') {
    return false;
  }
  const candidate = quality as Partial<AutoCutVideoDedupVisualQualityVector>;
  return Boolean(
    Number.isFinite(candidate.blurScore) &&
      Number.isFinite(candidate.exposureScore) &&
      Number.isFinite(candidate.stabilityScore),
  );
}

function createNativeVideoDedupVisualSignature(
  evidence: AutoCutVisualEvidenceExtractionResult,
): AutoCutVideoDedupVisualSignature | undefined {
  if (evidence.ready !== true || !Array.isArray(evidence.shots)) {
    return undefined;
  }

  const shots = evidence.shots
    .map((shot) => ({
      startMs: normalizeVideoDedupPositiveNumber(shot.startMs),
      endMs: normalizeVideoDedupPositiveNumber(shot.endMs),
    }))
    .filter((shot) => shot.endMs > shot.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  if (!shots.length) {
    return undefined;
  }

  const shotDurations = shots.map((shot) => Math.max(1, shot.endMs - shot.startMs));
  const durationMs = Math.max(...shots.map((shot) => shot.endMs), shotDurations.reduce((total, duration) => total + duration, 0));
  const totalShotDurationMs = shotDurations.reduce((total, duration) => total + duration, 0);
  const shotDurationRatios = shotDurations.map((duration) => roundScore(duration / Math.max(1, totalShotDurationMs)));
  const shotDurationBuckets = shotDurationRatios.map((ratio) => Math.round(ratio * 1000));
  const quality = createNativeVideoDedupVisualQualityVector(evidence.frameQuality);
  const frameFingerprints = createNativeVideoDedupFrameFingerprints(evidence.frameFingerprints);
  const fingerprintSignature = frameFingerprints.length
    ? frameFingerprints.map((sample) => `${Math.round(sample.atMs / 1000)}:${sample.algorithm}:${sample.hash}`).join(',')
    : 'none';
  const qualitySignature = quality
    ? [
        Math.round(quality.blurScore * 100),
        Math.round(quality.exposureScore * 100),
        Math.round(quality.stabilityScore * 100),
      ].join(':')
    : 'none';

  return {
    source: 'native-visual-evidence',
    provider: evidence.provider || 'native',
    profile: evidence.profile || 'scene-index-v1',
    signature: [
      evidence.provider || 'native',
      evidence.profile || 'scene-index-v1',
      `shots=${shotDurationBuckets.join(':')}`,
      `scenes=${Math.max(0, evidence.sceneBoundaries?.length ?? 0)}`,
      `frames=${fingerprintSignature}`,
      `quality=${qualitySignature}`,
    ].join('|'),
    durationMs,
    shotCount: shots.length,
    sceneBoundaryCount: Math.max(0, evidence.sceneBoundaries?.length ?? 0),
    shotDurationRatios,
    shotDurationBuckets,
    frameFingerprints,
    ...(quality ? { quality } : {}),
  };
}

function createNativeVideoDedupFrameFingerprints(
  samples: AutoCutVisualEvidenceExtractionResult['frameFingerprints'],
): AutoCutVideoDedupFrameFingerprint[] {
  if (!Array.isArray(samples) || !samples.length) {
    return [];
  }

  return samples
    .map((sample) => {
      const hash = typeof sample.hash === 'string' ? sample.hash.trim().toLowerCase() : '';
      const histogram = Array.isArray(sample.histogram)
        ? sample.histogram
            .map((value) => normalizeVideoDedupUnitScore(value))
            .filter(Number.isFinite)
            .slice(0, 32)
        : [];
      return {
        atMs: normalizeVideoDedupPositiveNumber(sample.atMs),
        algorithm: typeof sample.algorithm === 'string' && sample.algorithm.trim()
          ? sample.algorithm.trim()
          : 'unknown',
        hash,
        meanLuma: normalizeVideoDedupUnitScore(sample.meanLuma),
        histogram,
      };
    })
    .filter((sample) =>
      /^[a-f0-9]{16}$/u.test(sample.hash) &&
        Number.isFinite(sample.meanLuma) &&
        sample.histogram.length > 0
    )
    .sort((left, right) => left.atMs - right.atMs || left.hash.localeCompare(right.hash));
}

function createNativeVideoDedupVisualQualityVector(
  samples: AutoCutVisualEvidenceExtractionResult['frameQuality'],
): AutoCutVideoDedupVisualQualityVector | undefined {
  if (!Array.isArray(samples) || !samples.length) {
    return undefined;
  }

  const validSamples = samples
    .map((sample) => ({
      blurScore: normalizeVideoDedupUnitScore(sample.blurScore),
      exposureScore: normalizeVideoDedupUnitScore(sample.exposureScore),
      stabilityScore: normalizeVideoDedupUnitScore(sample.stabilityScore),
    }))
    .filter((sample) =>
      Number.isFinite(sample.blurScore) &&
      Number.isFinite(sample.exposureScore) &&
      Number.isFinite(sample.stabilityScore)
    );
  if (!validSamples.length) {
    return undefined;
  }

  return {
    blurScore: roundScore(validSamples.reduce((total, sample) => total + sample.blurScore, 0) / validSamples.length),
    exposureScore: roundScore(validSamples.reduce((total, sample) => total + sample.exposureScore, 0) / validSamples.length),
    stabilityScore: roundScore(validSamples.reduce((total, sample) => total + sample.stabilityScore, 0) / validSamples.length),
  };
}

function calculateNativeVideoDedupVisualSimilarity(
  left: AutoCutVideoDedupVisualSignature | undefined,
  right: AutoCutVideoDedupVisualSignature | undefined,
): AutoCutVideoDedupVisualSimilarity | undefined {
  if (!left || !right) {
    return undefined;
  }

  const contentEvidenceReady = left.frameFingerprints.length > 0 && right.frameFingerprints.length > 0;
  if (contentEvidenceReady && left.signature === right.signature) {
    return {
      score: 0.97,
      contentScore: 1,
      patternScore: 1,
      sceneScore: 1,
      qualityScore: 1,
      contentEvidenceReady,
      exactSignature: true,
    };
  }

  const contentScore = calculateNativeVideoDedupFrameFingerprintSimilarity(left.frameFingerprints, right.frameFingerprints);
  const patternScore = calculateNativeVideoDedupShotPatternSimilarity(left.shotDurationRatios, right.shotDurationRatios);
  const sceneScore = calculateVideoDedupCountSimilarity(left.sceneBoundaryCount, right.sceneBoundaryCount);
  const qualityScore = calculateNativeVideoDedupQualitySimilarity(left.quality, right.quality);
  const structureScore = roundScore(patternScore * 0.72 + sceneScore * 0.16 + qualityScore * 0.12);
  const score = contentEvidenceReady
    ? roundScore(contentScore * 0.72 + patternScore * 0.2 + sceneScore * 0.05 + qualityScore * 0.03)
    : Math.min(structureScore, 0.64);
  return {
    score,
    contentScore: roundScore(contentScore),
    patternScore: roundScore(patternScore),
    sceneScore: roundScore(sceneScore),
    qualityScore: roundScore(qualityScore),
    contentEvidenceReady,
    exactSignature: false,
  };
}

function calculateNativeVideoDedupFrameFingerprintSimilarity(
  leftFingerprints: readonly AutoCutVideoDedupFrameFingerprint[],
  rightFingerprints: readonly AutoCutVideoDedupFrameFingerprint[],
) {
  const maxLength = Math.max(leftFingerprints.length, rightFingerprints.length);
  const minLength = Math.min(leftFingerprints.length, rightFingerprints.length);
  if (!maxLength || !minLength) {
    return 0.5;
  }

  let alignedScore = 0;
  for (let index = 0; index < minLength; index += 1) {
    const left = leftFingerprints[index];
    const right = rightFingerprints[index];
    if (!left || !right) {
      continue;
    }
    alignedScore += calculateNativeVideoDedupFrameFingerprintPairSimilarity(left, right);
  }

  const sequenceScore = alignedScore / minLength;
  const coverageScore = minLength / maxLength;
  return roundScore(sequenceScore * 0.88 + coverageScore * 0.12);
}

function calculateNativeVideoDedupFrameFingerprintPairSimilarity(
  left: AutoCutVideoDedupFrameFingerprint,
  right: AutoCutVideoDedupFrameFingerprint,
) {
  const hashScore = calculateNativeVideoDedupHashSimilarity(left.hash, right.hash);
  const histogramScore = calculateNativeVideoDedupHistogramSimilarity(left.histogram, right.histogram);
  const meanLumaScore = Math.max(0, 1 - Math.abs(left.meanLuma - right.meanLuma));
  return roundScore(hashScore * 0.62 + histogramScore * 0.3 + meanLumaScore * 0.08);
}

function calculateNativeVideoDedupHashSimilarity(leftHash: string, rightHash: string) {
  if (!/^[a-f0-9]{16}$/u.test(leftHash) || !/^[a-f0-9]{16}$/u.test(rightHash)) {
    return 0;
  }

  let distance = 0;
  for (let index = 0; index < 16; index += 1) {
    const leftNibble = Number.parseInt(leftHash[index] ?? '0', 16);
    const rightNibble = Number.parseInt(rightHash[index] ?? '0', 16);
    distance += countVideoDedupNibbleBits(leftNibble ^ rightNibble);
  }

  return roundScore(Math.max(0, 1 - distance / 64));
}

function countVideoDedupNibbleBits(value: number) {
  let count = 0;
  let normalized = value & 0xf;
  while (normalized > 0) {
    count += normalized & 1;
    normalized >>= 1;
  }
  return count;
}

function calculateNativeVideoDedupHistogramSimilarity(
  leftHistogram: readonly number[],
  rightHistogram: readonly number[],
) {
  const length = Math.min(leftHistogram.length, rightHistogram.length);
  if (!length) {
    return 0.5;
  }

  let distance = 0;
  for (let index = 0; index < length; index += 1) {
    distance += Math.abs((leftHistogram[index] ?? 0) - (rightHistogram[index] ?? 0));
  }
  return roundScore(Math.max(0, 1 - distance / 2));
}

function calculateNativeVideoDedupShotPatternSimilarity(
  leftRatios: readonly number[],
  rightRatios: readonly number[],
) {
  const maxLength = Math.max(leftRatios.length, rightRatios.length);
  const minLength = Math.min(leftRatios.length, rightRatios.length);
  if (!maxLength || !minLength) {
    return 0;
  }

  let alignedScore = 0;
  for (let index = 0; index < minLength; index += 1) {
    const leftRatio = leftRatios[index] ?? 0;
    const rightRatio = rightRatios[index] ?? 0;
    const distance = Math.abs(leftRatio - rightRatio);
    alignedScore += Math.max(0, 1 - distance * 6);
  }

  const sequenceScore = alignedScore / minLength;
  const coverageScore = minLength / maxLength;
  return roundScore(sequenceScore * 0.78 + coverageScore * 0.22);
}

function calculateVideoDedupCountSimilarity(leftCount: number, rightCount: number) {
  const larger = Math.max(leftCount, rightCount);
  if (larger <= 0) {
    return 0.5;
  }

  return Math.min(leftCount, rightCount) / larger;
}

function calculateNativeVideoDedupQualitySimilarity(
  left: AutoCutVideoDedupVisualQualityVector | undefined,
  right: AutoCutVideoDedupVisualQualityVector | undefined,
) {
  if (!left || !right) {
    return 0.7;
  }

  const averageDistance = (
    Math.abs(left.blurScore - right.blurScore) +
    Math.abs(left.exposureScore - right.exposureScore) +
    Math.abs(left.stabilityScore - right.stabilityScore)
  ) / 3;
  return roundScore(Math.max(0, 1 - averageDistance));
}

function createNativeVideoDedupVisualEvidenceDetail(
  source: AutoCutVideoDedupVisualSignature | undefined,
  target: AutoCutVideoDedupVisualSignature | undefined,
  similarity: AutoCutVideoDedupVisualSimilarity,
) {
  const shotCount = Math.min(source?.shotCount ?? 0, target?.shotCount ?? 0);
  const sceneCount = Math.min(source?.sceneBoundaryCount ?? 0, target?.sceneBoundaryCount ?? 0);
  return [
    `Native visual evidence matched ${source?.profile ?? target?.profile ?? 'scene-index-v1'} scene structure.`,
    `provider=${source?.provider ?? target?.provider ?? 'native'}`,
    `shots=${shotCount}`,
    `sceneBoundaries=${sceneCount}`,
    `contentScore=${roundScore(similarity.contentScore)}`,
    `patternScore=${roundScore(similarity.patternScore)}`,
    `sceneScore=${roundScore(similarity.sceneScore)}`,
    `qualityScore=${roundScore(similarity.qualityScore)}`,
    `contentEvidence=${similarity.contentEvidenceReady ? 'ready' : 'missing'}`,
    similarity.exactSignature ? 'signature=exact' : 'signature=similar',
  ].join(' ');
}

async function collectNativeVideoDedupAudioSignatures(
  videoAssets: readonly AppAsset[],
): Promise<Map<string, AutoCutVideoDedupAudioSignature>> {
  const audioFingerprintAssets = dedupeVideoDedupAssets(videoAssets).filter((asset) => Boolean(asset.id.trim()));
  if (!audioFingerprintAssets.length) {
    return new Map();
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  let capabilities;
  try {
    capabilities = await nativeHostClient.getCapabilities();
  } catch {
    return new Map();
  }

  if (
    capabilities.audioFingerprintCommandReady !== true ||
    capabilities.audioFingerprintAdapterReady !== true
  ) {
    return new Map();
  }

  const signatures = new Map<string, AutoCutVideoDedupAudioSignature>();
  await Promise.all(
    audioFingerprintAssets.map(async (asset) => {
      try {
        const fingerprint = await nativeHostClient.fingerprintAudio({
          assetUuid: asset.id,
          ...(asset.artifactPath?.trim() ? { sourcePath: asset.artifactPath.trim() } : {}),
          ...(asset.sourceTaskId ? { workflowTaskId: asset.sourceTaskId } : {}),
          fingerprintProfile: 'audio-energy-v1',
          sampleRateHz: 16_000,
          windowDurationMs: 1_000,
        });
        const signature = createNativeVideoDedupAudioSignature(fingerprint);
        if (signature) {
          signatures.set(asset.id, signature);
        }
      } catch {
        // Assets without readable audio stream evidence fall back only when no native pair exists.
      }
    }),
  );

  return signatures;
}

function createNativeVideoDedupAudioSignature(
  result: AutoCutAudioFingerprintResult,
): AutoCutVideoDedupAudioSignature | undefined {
  if (result.ready !== true || !result.fingerprint || typeof result.fingerprint !== 'object') {
    return undefined;
  }

  const hash = typeof result.fingerprint.hash === 'string' ? result.fingerprint.hash.trim().toLowerCase() : '';
  const energyBuckets = createNativeVideoDedupAudioBuckets(result.fingerprint.energyBuckets);
  if (!/^[a-f0-9]{64}$/u.test(hash) || energyBuckets.length < 2) {
    return undefined;
  }

  const spectralCentroidBuckets = createNativeVideoDedupAudioBuckets(result.fingerprint.spectralCentroidBuckets);
  return {
    source: 'native-audio-fingerprint',
    provider: result.provider || 'native',
    profile: result.profile || 'audio-energy-v1',
    algorithm: result.fingerprint.algorithm || 'audio-energy-v1',
    hash,
    durationMs: normalizeVideoDedupPositiveNumber(result.durationMs),
    sampleRateHz: normalizeVideoDedupPositiveNumber(result.sampleRateHz),
    windowDurationMs: normalizeVideoDedupPositiveNumber(result.windowDurationMs),
    energyBuckets,
    silenceRatio: normalizeVideoDedupUnitScore(result.fingerprint.silenceRatio),
    spectralCentroidBuckets,
  };
}

function createNativeVideoDedupAudioBuckets(values: readonly number[] | undefined) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => Number.isFinite(value) ? Math.round(value) : Number.NaN)
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(255, value)))
    .slice(0, 600);
}

function calculateNativeVideoDedupAudioSimilarity(
  left: AutoCutVideoDedupAudioSignature | undefined,
  right: AutoCutVideoDedupAudioSignature | undefined,
): AutoCutVideoDedupAudioSimilarity | undefined {
  if (!left || !right) {
    return undefined;
  }

  if (left.hash === right.hash && left.algorithm === right.algorithm) {
    return {
      score: 0.97,
      energyScore: 1,
      spectralScore: 1,
      durationScore: 1,
      silenceScore: 1,
      exactSignature: true,
    };
  }

  const energyScore = calculateNativeVideoDedupAudioBucketSimilarity(left.energyBuckets, right.energyBuckets);
  const spectralScore = calculateNativeVideoDedupAudioBucketSimilarity(left.spectralCentroidBuckets, right.spectralCentroidBuckets);
  const durationScore = calculateVideoDedupDurationSimilarity(left.durationMs, right.durationMs);
  const silenceScore = Math.max(0, 1 - Math.abs(left.silenceRatio - right.silenceRatio) * 2);
  const hasSpectralEvidence = left.spectralCentroidBuckets.length > 0 && right.spectralCentroidBuckets.length > 0;
  const score = hasSpectralEvidence
    ? roundScore(energyScore * 0.7 + spectralScore * 0.16 + durationScore * 0.08 + silenceScore * 0.06)
    : roundScore(energyScore * 0.82 + durationScore * 0.1 + silenceScore * 0.08);
  return {
    score,
    energyScore: roundScore(energyScore),
    spectralScore: roundScore(hasSpectralEvidence ? spectralScore : 0.5),
    durationScore: roundScore(durationScore),
    silenceScore: roundScore(silenceScore),
    exactSignature: false,
  };
}

function calculateNativeVideoDedupAudioBucketSimilarity(
  leftBuckets: readonly number[],
  rightBuckets: readonly number[],
) {
  const maxLength = Math.max(leftBuckets.length, rightBuckets.length);
  const minLength = Math.min(leftBuckets.length, rightBuckets.length);
  if (!maxLength || !minLength) {
    return 0.5;
  }

  let alignedScore = 0;
  for (let index = 0; index < minLength; index += 1) {
    const left = leftBuckets[index] ?? 0;
    const right = rightBuckets[index] ?? 0;
    alignedScore += Math.max(0, 1 - Math.abs(left - right) / 255);
  }

  const sequenceScore = alignedScore / minLength;
  const coverageScore = minLength / maxLength;
  return roundScore(sequenceScore * 0.9 + coverageScore * 0.1);
}

function calculateVideoDedupDurationSimilarity(leftDurationMs: number, rightDurationMs: number) {
  const larger = Math.max(leftDurationMs, rightDurationMs);
  if (larger <= 0) {
    return 0.5;
  }

  return Math.max(0, Math.min(leftDurationMs, rightDurationMs) / larger);
}

function createNativeVideoDedupAudioEvidenceDetail(
  source: AutoCutVideoDedupAudioSignature | undefined,
  target: AutoCutVideoDedupAudioSignature | undefined,
  similarity: AutoCutVideoDedupAudioSimilarity,
) {
  const bucketCount = Math.min(source?.energyBuckets.length ?? 0, target?.energyBuckets.length ?? 0);
  return [
    `Native audio fingerprint matched ${source?.profile ?? target?.profile ?? 'audio-energy-v1'} energy sequence.`,
    `provider=${source?.provider ?? target?.provider ?? 'native'}`,
    `algorithm=${source?.algorithm ?? target?.algorithm ?? 'audio-energy-v1'}`,
    `durationMs=${Math.min(source?.durationMs ?? 0, target?.durationMs ?? 0)}`,
    `buckets=${bucketCount}`,
    `energyScore=${roundScore(similarity.energyScore)}`,
    `spectralScore=${roundScore(similarity.spectralScore)}`,
    `durationScore=${roundScore(similarity.durationScore)}`,
    `silenceScore=${roundScore(similarity.silenceScore)}`,
    similarity.exactSignature ? 'signature=exact' : 'signature=similar',
  ].join(' ');
}

function normalizeVideoDedupPositiveNumber(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function normalizeVideoDedupUnitScore(value: number) {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  return Math.max(0, Math.min(1, value));
}

function dedupeVideoDedupAssets(videoAssets: readonly AppAsset[]) {
  const seenAssetIds = new Set<string>();
  const uniqueAssets: AppAsset[] = [];
  for (const asset of videoAssets) {
    if (seenAssetIds.has(asset.id)) {
      continue;
    }
    seenAssetIds.add(asset.id);
    uniqueAssets.push(asset);
  }
  return uniqueAssets;
}

function normalizeVideoAssetForDedup(
  asset: AppAsset,
  nativeFingerprint?: AutoCutVideoFileFingerprintResult,
  nativeVisualSignature?: AutoCutVideoDedupVisualSignature,
  nativeAudioSignature?: AutoCutVideoDedupAudioSignature,
): NormalizedVideoAsset {
  const baseName = normalizeVideoDedupBaseName(asset.name);
  const tokens = tokenizeVideoDedupText(baseName);
  const templateTokens = new Set([...tokens].filter((token) => VIDEO_DEDUP_TEMPLATE_TOKENS.has(token)));
  const nativeSha256 = nativeFingerprint?.sha256;
  const nativeByteSize = nativeFingerprint?.byteSize;
  return {
    asset,
    baseName,
    tokens,
    templateTokens,
    signature: nativeSha256 ? `native-sha256:${nativeSha256}` : `${baseName}:${Math.max(0, asset.size)}`,
    signatureSource: nativeSha256 ? 'native-sha256' : 'metadata-proxy',
    ...(nativeVisualSignature ? { nativeVisualSignature } : {}),
    ...(nativeAudioSignature ? { nativeAudioSignature } : {}),
    ...(nativeSha256 ? { nativeSha256 } : {}),
    ...(nativeByteSize !== undefined ? { nativeByteSize } : {}),
    size: nativeByteSize ?? Math.max(0, asset.size),
  };
}

function normalizeVideoDedupBaseName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/iu, '')
    .replace(/\b(2160p|1440p|1080p|720p|480p|4k|2k|hdr|sdr|hevc|h264|h265|x264|x265|aac|mp3)\b/giu, ' ')
    .replace(/[\[\](){}【】（）_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenizeVideoDedupText(value: string) {
  return new Set(
    value
      .split(/[^\p{L}\p{N}]+/gu)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 2 && !VIDEO_DEDUP_LOW_SIGNAL_TOKENS.has(token)),
  );
}

function calculateTokenSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (!left.size || !right.size) {
    return 0;
  }
  let intersectionSize = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersectionSize += 1;
    }
  }
  const unionSize = new Set([...left, ...right]).size;
  return unionSize ? intersectionSize / unionSize : 0;
}

function calculateSizeSimilarity(leftSize: number, rightSize: number) {
  const larger = Math.max(leftSize, rightSize);
  if (larger <= 0) {
    return 0;
  }
  const smaller = Math.min(leftSize, rightSize);
  return smaller / larger;
}

function createStablePairKey(left: string, right: string) {
  return left.localeCompare(right) <= 0 ? `${left}:${right}` : `${right}:${left}`;
}

function createVideoDedupTimeRange(params: VideoDedupParams) {
  const trimOffsetMs = params.ignoreIntroOutro ? Math.min(params.introOutroMaxDurationMs, 10_000) : 0;
  const matchDurationMs = Math.max(params.minMatchDurationMs, 30_000);
  return {
    sourceStartMs: trimOffsetMs,
    sourceEndMs: trimOffsetMs + matchDurationMs,
    targetStartMs: trimOffsetMs,
    targetEndMs: trimOffsetMs + matchDurationMs,
  };
}

function createVideoDedupEvidence(
  strategyId: VideoDedupStrategyId,
  score: number,
  label: string,
  detail: string,
  timeRange: ReturnType<typeof createVideoDedupTimeRange>,
): VideoDedupEvidence {
  return {
    strategyId,
    score: roundScore(score),
    label,
    detail,
    sourceStartMs: timeRange.sourceStartMs,
    sourceEndMs: timeRange.sourceEndMs,
    targetStartMs: timeRange.targetStartMs,
    targetEndMs: timeRange.targetEndMs,
  };
}

function maxEvidenceScore(
  evidence: readonly VideoDedupEvidence[],
  strategyIds: readonly VideoDedupStrategyId[],
) {
  const score = evidence
    .filter((item) => strategyIds.includes(item.strategyId))
    .reduce<number | undefined>((current, item) => current === undefined ? item.score : Math.max(current, item.score), undefined);
  return score === undefined ? undefined : roundScore(score);
}

function resolveVideoDuplicateMatchKind(
  evidence: readonly VideoDedupEvidence[],
  confidence: number,
  templateOnly: boolean,
): VideoDuplicateMatch['matchKind'] {
  if (templateOnly) {
    return 'template-only';
  }
  if (evidence.some((item) => item.strategyId === 'exact-file-hash' && item.score >= 0.98)) {
    return 'exact';
  }
  if (evidence.some((item) => item.strategyId === 'temporal-video-copy' && item.score >= 0.78)) {
    return 'partial-copy';
  }
  if (evidence.some((item) => item.strategyId === 'audio-fingerprint' && item.score >= 0.82)) {
    return 'same-audio';
  }
  if (evidence.some((item) => item.strategyId === 'transcript-semantic' && item.score >= 0.8)) {
    return 'same-speech';
  }
  return confidence >= 0.74 ? 'near-duplicate' : 'partial-copy';
}

function resolveVideoDuplicateRecommendation(
  matchKind: VideoDuplicateMatch['matchKind'],
  confidence: number,
  actionMode: VideoDedupParams['actionMode'],
): VideoDuplicateMatch['recommendation'] {
  if (matchKind === 'template-only') {
    return 'ignore-template-only';
  }
  if (actionMode === 'archive-duplicates' && confidence >= 0.9) {
    return 'archive-target';
  }
  if (matchKind === 'exact' && confidence >= 0.96) {
    return 'archive-target';
  }
  if (actionMode === 'report-only') {
    return 'keep-both';
  }
  return 'manual-review';
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
