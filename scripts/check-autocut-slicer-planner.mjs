import { readFileSync } from 'node:fs';
import {
  buildTranscriptSliceCandidates,
  createDeterministicSlicePlan,
  createSmartSliceTranscriptAudioMuteRanges,
  createTranscriptAssistedSlicePlan,
  getVideoSlicePlanningPolicy,
  normalizeSmartSliceTranscriptEvidenceText,
  normalizeCandidateSlicePlan,
  parseLlmSlicePlan,
  validateVideoSliceParams,
} from '../packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts';

const failures = [];
const pass = [];
const plannerSource = readFileSync('packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts', 'utf8');

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertEqual(actual, expected, message) {
  assertRule(Object.is(actual, expected), `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertRejects(action, expectedMessagePart, message) {
  let rejectedError = null;

  try {
    action();
  } catch (error) {
    rejectedError = error;
  }

  const rejectedMessage = rejectedError instanceof Error ? rejectedError.message : '';
  assertRule(rejectedError instanceof Error, `${message} rejects`);
  assertRule(
    rejectedMessage.includes(expectedMessagePart),
    `${message} explains ${expectedMessagePart}`,
  );
}

function assertNumberBetween(actual, min, max, message) {
  assertRule(
    typeof actual === 'number' && actual >= min && actual <= max,
    `${message} (expected ${min} <= value <= ${max}, got ${JSON.stringify(actual)})`,
  );
}

function assertArrayIncludes(actual, expectedItem, message) {
  assertRule(
    Array.isArray(actual) && actual.includes(expectedItem),
    `${message} (expected array to include ${JSON.stringify(expectedItem)}, got ${JSON.stringify(actual)})`,
  );
}

const baseParams = {
  mode: '单人讲解',
  llmModel: 'deepseek-chat',
  minDuration: 15,
  maxDuration: 60,
  baseAlgorithm: 'scene',
  highlightEngine: 'keyword',
  enableNoiseReduction: true,
  enableCoughFilter: true,
  enableRepeatFilter: true,
  enableSubtitles: false,
};

assertRejects(
  () => validateVideoSliceParams({ ...baseParams, minDuration: 90, maxDuration: 15 }),
  'minimum slice duration',
  'planner rejects inverted duration ranges',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, targetSliceCount: 0 }),
  'target slice count',
  'planner rejects target slice counts below the publishing standard range',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, targetSliceCount: 21 }),
  'target slice count',
  'planner rejects target slice counts above the publishing standard range',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, minDuration: Number.NaN }),
  'minimum slice duration',
  'planner rejects NaN minimum durations instead of silently defaulting them',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, minDuration: 4 }),
  'minimum slice duration',
  'planner rejects minimum durations below the renderable slicing floor',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, maxDuration: Number.POSITIVE_INFINITY }),
  'maximum slice duration',
  'planner rejects infinite maximum durations before native rendering',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, maxDuration: 601 }),
  'maximum slice duration',
  'planner rejects maximum durations above the standard slicing ceiling',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, idealDuration: Number.NaN }),
  'ideal slice duration',
  'planner rejects NaN ideal durations instead of passing unstable planning policy',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, idealDuration: 4 }),
  'ideal slice duration',
  'planner rejects ideal durations below the renderable slicing floor',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, idealDuration: 601 }),
  'ideal slice duration',
  'planner rejects ideal durations above the standard slicing ceiling',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, targetSliceCount: 2.5 }),
  'target slice count',
  'planner rejects fractional target slice counts',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, sourceDurationMs: Number.NaN }),
  'source media duration',
  'planner rejects NaN source media duration metadata',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, sourceDurationMs: 4_000 }),
  'source media duration',
  'planner rejects source media duration metadata below the minimum renderable slice',
);
assertRule(
  !plannerSource.includes('const insertIndex = sorted.findIndex') &&
    !plannerSource.includes('sorted.splice(insertIndex, 0'),
  'planner uses native stable sort instead of quadratic insertion-sort helpers for large transcript workloads',
);
assertRule(
  !plannerSource.includes('const frontier: NormalizedSlicePlanClip[][]') &&
    plannerSource.includes('selectOptimalSliceCandidateSetByDynamicProgramming') &&
    plannerSource.includes('findPreviousCompatibleSliceCandidateIndexes'),
  'planner selects transcript-aligned slice candidates with bounded dynamic programming instead of exponential frontier enumeration',
);
assertRule(
  plannerSource.includes('sortSliceClipsByEndMs') &&
    plannerSource.includes('SLICE_CANDIDATE_DP_BEAM_WIDTH') &&
    plannerSource.includes('isSliceCandidatePlanInternallyCompatible'),
  'planner dynamic programming is ordered by candidate end time, keeps a bounded beam, and revalidates whole-plan repeat compatibility',
);
assertRule(
  plannerSource.includes('MAX_TRANSCRIPT_SLICE_CANDIDATE_POOL_SIZE') &&
    plannerSource.includes('pruneTranscriptSliceCandidatePool') &&
    plannerSource.includes('getTranscriptSliceCandidatePoolLimit') &&
    plannerSource.includes('candidatePoolLimit'),
  'planner prunes speech-to-text candidate pools during generation for long transcript performance',
);

const sparseSpeechSegments = [
  {
    startMs: 10_000,
    endMs: 15_600,
    text: 'How to remove silent intros from short video clips.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 31_000,
    endMs: 36_600,
    text: 'How to remove silent intros from short video clips.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 55_000,
    endMs: 60_700,
    text: 'Then keep only the complete spoken payoff.',
    speaker: 'Speaker 1',
  },
];
const sparseSpeechPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    targetSliceCount: 3,
    sourceDurationMs: 90_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  sparseSpeechSegments,
);
assertRule(
  sparseSpeechPlan.length >= 1,
  'transcript-assisted planner can create clips from short speech-to-text segments without relying on fixed silent filler windows',
);
assertRule(
  sparseSpeechPlan.every((clip) => (clip.boundaryPaddingBeforeMs ?? 0) <= 500),
  'transcript-assisted planner clamps leading silence around speech-to-text starts',
);
assertRule(
  sparseSpeechPlan.every((clip) => (clip.boundaryPaddingAfterMs ?? 0) <= 500),
  'transcript-assisted planner clamps trailing silence around speech-to-text ends',
);
assertRule(
  sparseSpeechPlan.every((clip) => (clip.speechEndMs ?? clip.startMs + clip.durationMs) - (clip.speechStartMs ?? clip.startMs) >= clip.durationMs - 1_000),
  'transcript-assisted planner does not stretch sparse speech windows with long silent padding just to satisfy requested minimum duration',
);
assertEqual(
  sparseSpeechPlan.filter((clip) => clip.transcriptText === sparseSpeechSegments[0].text).length,
  1,
  'transcript-assisted planner deduplicates repeated speech-to-text content across different time ranges',
);
assertRule(
  sparseSpeechPlan.some((clip) => clip.risks?.includes('transcript-repeat-filtered')),
  'transcript-assisted planner records when repeated speech-to-text windows are filtered',
);
const fillerHeavyTranscriptCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 22,
  maxDuration: 45,
  continuityLevel: 'standard',
  highlightEngine: 'keyword',
  customKeywords: ['retention', 'refund'],
}, [
  { startMs: 0, endMs: 12_000, text: 'um um uh', speaker: 'Speaker 1' },
  { startMs: 12_100, endMs: 21_000, text: 'Well, watch the retention setup and pricing pain.', speaker: 'Speaker 1' },
  { startMs: 21_100, endMs: 30_000, text: 'So the complete payoff is the refund fix.', speaker: 'Speaker 1' },
]);
const fillerHeavyTranscriptCandidate = fillerHeavyTranscriptCandidates.find((candidate) =>
  candidate.transcriptText?.includes('retention setup') &&
  candidate.transcriptText.includes('refund fix'),
);
assertRule(
  Boolean(fillerHeavyTranscriptCandidate),
  'speech-to-text filler cleanup still keeps the meaningful retention-to-payoff candidate window',
);
assertRule(
  !/\b(?:um|uh)\b/iu.test(fillerHeavyTranscriptCandidate?.transcriptText ?? ''),
  'speech-to-text filler cleanup removes pure filler words from transcript candidate text',
);
assertRule(
  !/^(?:um|uh|well|like|you know|i mean|okay|so)\b/iu.test(fillerHeavyTranscriptCandidate?.label ?? ''),
  'speech-to-text filler cleanup prevents filler words from becoming task clip titles',
);
assertEqual(
  fillerHeavyTranscriptCandidate?.transcriptSegmentCount,
  2,
  'speech-to-text filler cleanup excludes pure filler segments from transcript segment counts',
);
const punctuationOnlyTitleCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 5,
  maxDuration: 25,
  continuityLevel: 'strict',
}, [
  { startMs: 0, endMs: 6_000, text: 'And?', speaker: 'Speaker 1' },
  { startMs: 12_000, endMs: 21_000, text: 'Then retention payoff fixes refund churn.', speaker: 'Speaker 1' },
]);
assertRule(
  !punctuationOnlyTitleCandidates.some((candidate) => /^[^\p{L}\p{N}]+$/u.test(candidate.label)),
  'speech-to-text title extraction never emits punctuation-only candidate labels',
);
assertRule(
  punctuationOnlyTitleCandidates.some((candidate) => candidate.label === 'Smart slice 1'),
  'speech-to-text title extraction falls back to a stable slice label when weak connectors strip all words',
);
const isolatedMicroSpeechPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    targetSliceCount: 3,
    sourceDurationMs: 90_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  [
    {
      startMs: 10_000,
      endMs: 12_000,
      text: 'Tiny isolated speech.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 40_000,
      endMs: 42_000,
      text: 'Another tiny isolated speech.',
      speaker: 'Speaker 1',
    },
  ],
);
assertRule(
  isolatedMicroSpeechPlan.length >= 1,
  'transcript-assisted planner creates reviewable speech-backed clips from isolated micro speech instead of failing the whole smart slice task',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => clip.transcriptText?.trim()),
  'transcript-assisted planner keeps visible transcript text on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => (clip.transcriptSegmentCount ?? 0) > 0),
  'transcript-assisted planner keeps structured transcript segment evidence on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => (clip.transcriptCoverageScore ?? 0) >= 0.8),
  'transcript-assisted planner keeps professional transcript coverage on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => clip.durationMs < 3_000),
  'transcript-assisted planner does not pad isolated micro speech up to long requested minimum durations',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => (clip.boundaryPaddingBeforeMs ?? 0) <= 500 && (clip.boundaryPaddingAfterMs ?? 0) <= 500),
  'transcript-assisted planner bounds silence padding on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => clip.risks?.includes('sparse-transcript-speech')),
  'transcript-assisted planner marks isolated micro speech fallback clips for review instead of hiding sparse transcript risk',
);
const sparseSpeechCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    targetSliceCount: 3,
    sourceDurationMs: 90_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  sparseSpeechSegments,
);
const llmSparseSpeechPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: sparseSpeechCandidates[0]?.candidateId,
      title: 'Trimmed speech candidate',
      qualityScore: 0.9,
      continuityScore: 0.9,
    },
  ]),
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    targetSliceCount: 3,
    sourceDurationMs: 90_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  sparseSpeechPlan,
  sparseSpeechCandidates,
);
assertRule(
  (llmSparseSpeechPlan[0]?.boundaryPaddingAfterMs ?? Number.POSITIVE_INFINITY) <= 500,
  'LLM candidate-id planning preserves trimmed speech-to-text trailing boundaries instead of re-expanding sparse speech to the requested minimum',
);
assertRule(
  (llmSparseSpeechPlan[0]?.speechEndMs ?? 0) - (llmSparseSpeechPlan[0]?.speechStartMs ?? 0) >=
    (llmSparseSpeechPlan[0]?.durationMs ?? 0) - 1_000,
  'LLM candidate-id planning keeps sparse speech render windows aligned to speech duration',
);
assertArrayIncludes(
  llmSparseSpeechPlan[0]?.risks,
  'transcript-repeat-filtered',
  'LLM candidate-id planning preserves transcript repeat-filtering risks from matched speech-to-text candidates',
);

const partialDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 40,
    targetSliceCount: 4,
    sourceDurationMs: 90_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  [
    {
      startMs: 0,
      endMs: 12_000,
      text: 'Watch the retention hook, pricing pain, and final refund fix for this launch.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 24_000,
      endMs: 36_000,
      text: 'This launch refund fix repeats the pricing pain and retention hook.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 55_000,
      endMs: 68_000,
      text: 'A different onboarding example explains setup, user confusion, and the final payoff.',
      speaker: 'Speaker 1',
    },
  ],
);
assertEqual(
  partialDuplicateCandidates.filter((candidate) => candidate.transcriptText?.includes('retention hook')).length,
  1,
  'transcript repeat filter removes high-overlap paraphrased speech windows that are not strict text substrings',
);
assertRule(
  partialDuplicateCandidates.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
  'transcript repeat filter records filtered high-overlap paraphrased speech windows for review',
);
const shortPhraseDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 20,
    targetSliceCount: 3,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
    continuityLevel: 'strict',
  },
  [
    { startMs: 0, endMs: 9_000, text: 'Refund fix improves retention.', speaker: 'Speaker 1' },
    { startMs: 16_000, endMs: 25_000, text: 'Refund fix improved retention.', speaker: 'Speaker 1' },
    { startMs: 36_000, endMs: 45_000, text: 'Pricing setup explains invoice pain.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  shortPhraseDuplicateCandidates.filter((candidate) => candidate.transcriptText?.includes('Refund fix')).length,
  1,
  'transcript repeat filter removes short one-sentence paraphrases that differ only by inflection',
);
assertRule(
  shortPhraseDuplicateCandidates.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
  'transcript repeat filter records filtered short one-sentence paraphrases for review',
);
const semanticDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 25,
    targetSliceCount: 3,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
    continuityLevel: 'strict',
  },
  [
    { startMs: 0, endMs: 9_000, text: 'Refund fix improves retention.', speaker: 'Speaker 1' },
    { startMs: 15_000, endMs: 24_000, text: 'Return repair boosts retention.', speaker: 'Speaker 1' },
    { startMs: 34_000, endMs: 44_000, text: 'Pricing setup explains invoice pain.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  semanticDuplicateCandidates.filter((candidate) =>
    candidate.transcriptText?.includes('retention') &&
      /Refund fix|Return repair/u.test(candidate.transcriptText)
  ).length,
  1,
  'transcript repeat filter removes semantically equivalent short windows even when the duplicate uses different words',
);
assertRule(
  semanticDuplicateCandidates.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
  'transcript repeat filter records semantically equivalent short-window removals for review',
);
const businessMeaningDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 20,
    targetSliceCount: 3,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
    continuityLevel: 'strict',
  },
  [
    { startMs: 0, endMs: 9_000, text: 'Customers cancel after a confusing bill.', speaker: 'Speaker 1' },
    { startMs: 15_000, endMs: 24_000, text: 'Users churn after unclear invoices.', speaker: 'Speaker 1' },
    { startMs: 34_000, endMs: 44_000, text: 'Pricing setup explains annual terms.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  businessMeaningDuplicateCandidates.filter((candidate) =>
    /\b(?:cancel|churn)\b/iu.test(candidate.transcriptText ?? '')
  ).length,
  1,
  'transcript repeat filter removes business-meaning duplicates using semantic canonical tokens',
);
const internalRepeatCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 45,
    targetSliceCount: 3,
    sourceDurationMs: 70_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
    continuityLevel: 'standard',
  },
  [
    { startMs: 0, endMs: 8_000, text: 'Watch the onboarding setup and retention pain.', speaker: 'Speaker 1' },
    { startMs: 8_000, endMs: 16_000, text: 'Watch the onboarding setup and retention pain.', speaker: 'Speaker 1' },
    { startMs: 16_000, endMs: 28_000, text: 'So the payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
    { startMs: 40_000, endMs: 52_000, text: 'Watch the pricing setup and invoice pain.', speaker: 'Speaker 1' },
    { startMs: 52_000, endMs: 64_000, text: 'So the payoff is the billing fix viewers can apply.', speaker: 'Speaker 1' },
  ],
);
const internalRepeatCandidate = internalRepeatCandidates.find((candidate) =>
  candidate.transcriptSegmentCount === 2 &&
    (candidate.transcriptText?.match(/onboarding setup/giu)?.length ?? 0) >= 2
);
assertArrayIncludes(
  internalRepeatCandidate?.risks,
  'transcript-internal-repeat',
  'speech-to-text planning flags candidate windows that contain repeated meaning inside the same rendered slice',
);
assertRule(
  (internalRepeatCandidate?.qualityScore ?? 1) <= 0.72,
  'speech-to-text planning downgrades internally repeated windows so clean continuous clips win selection',
);
const noiseInterruptedTranscriptCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 45,
  continuityLevel: 'standard',
  highlightEngine: 'keyword',
  customKeywords: ['activation', 'payoff'],
}, [
  { startMs: 0, endMs: 9_000, text: 'Watch the onboarding setup and activation pain.', speaker: 'Speaker 1' },
  { startMs: 9_100, endMs: 10_000, text: '[coughing]', speaker: 'Speaker 1' },
  { startMs: 10_100, endMs: 11_000, text: '哈哈哈', speaker: 'Speaker 1' },
  { startMs: 11_100, endMs: 12_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 12_100, endMs: 25_000, text: 'So the complete payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
]);
const noiseInterruptedTranscriptCandidate = noiseInterruptedTranscriptCandidates.find((candidate) =>
  candidate.transcriptText?.includes('onboarding setup') &&
    candidate.transcriptText.includes('activation fix')
);
assertRule(
  Boolean(noiseInterruptedTranscriptCandidate),
  'speech-to-text noise cleanup keeps one continuous setup-to-payoff window across removed cough, laugh, and music markers',
);
assertRule(
  !/\b(?:coughing|music)\b|哈哈/u.test(noiseInterruptedTranscriptCandidate?.transcriptText ?? ''),
  'speech-to-text noise cleanup removes cough, laugh, and music-only transcript fragments from planned clip text',
);
assertEqual(
  noiseInterruptedTranscriptCandidate?.transcriptSegmentCount,
  2,
  'speech-to-text noise cleanup excludes noise-only fragments from transcript segment evidence',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('[coughing]'),
  '',
  'speech-to-text evidence cleanup drops cough-only transcript fragments before native rendering',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('um, What works is this.'),
  'What works is this.',
  'speech-to-text evidence cleanup removes edge filler before native rendering',
);
const audioMuteRanges = createSmartSliceTranscriptAudioMuteRanges(0, 25_000, [
  { startMs: 0, endMs: 9_000, text: 'Watch the onboarding setup and activation pain.', speaker: 'Speaker 1' },
  { startMs: 9_100, endMs: 10_000, text: '[coughing]', speaker: 'Speaker 1' },
  { startMs: 10_100, endMs: 10_700, text: 'um', speaker: 'Speaker 1' },
  { startMs: 11_100, endMs: 12_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 12_100, endMs: 25_000, text: 'So the complete payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
  { startMs: 26_000, endMs: 30_000, text: '[Music]', speaker: 'Speaker 1' },
]);
assertEqual(audioMuteRanges.length, 3, 'speech-to-text noise cleanup creates audio mute ranges for short noise and filler fragments inside rendered clips');
assertEqual(audioMuteRanges[0]?.startMs, 9_100, 'speech-to-text audio mute range keeps the original cough start boundary');
assertEqual(audioMuteRanges[2]?.endMs, 12_000, 'speech-to-text audio mute range keeps the original music end boundary');
const mergedLongAudioMuteRanges = createSmartSliceTranscriptAudioMuteRanges(0, 12_000, [
  { startMs: 3_000, endMs: 5_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 5_000, endMs: 7_000, text: '[coughing]', speaker: 'Speaker 1' },
]);
assertEqual(
  mergedLongAudioMuteRanges.length,
  0,
  'speech-to-text noise cleanup refuses merged mute ranges that would create a long silent hole inside the rendered clip',
);
const longNoiseBridgeCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 45,
  continuityLevel: 'standard',
  highlightEngine: 'keyword',
  customKeywords: ['activation', 'payoff'],
}, [
  { startMs: 0, endMs: 9_000, text: 'Watch the onboarding setup and activation pain.', speaker: 'Speaker 1' },
  { startMs: 9_100, endMs: 18_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 18_100, endMs: 30_000, text: 'So the complete payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
]);
assertRule(
  !longNoiseBridgeCandidates.some((candidate) =>
    candidate.transcriptText?.includes('onboarding setup') &&
      candidate.transcriptText.includes('activation fix')
  ),
  'speech-to-text noise cleanup does not bridge long audible interruptions that would still remain inside a continuous rendered clip',
);

const englishConnectorChainCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    targetSliceCount: 3,
    sourceDurationMs: 62_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  [
    { startMs: 0, endMs: 12_000, text: 'Watch this case background.', speaker: 'Speaker 1' },
    { startMs: 12_000, endMs: 26_000, text: 'Then the real spike comes from concentrated user pain.', speaker: 'Speaker 1' },
    { startMs: 26_000, endMs: 41_000, text: 'So this is the complete short-video payoff.', speaker: 'Speaker 1' },
  ],
);
const englishConnectorChainCandidate = englishConnectorChainCandidates.find(
  (candidate) => candidate.transcriptSegmentCount === 3,
);
assertEqual(
  englishConnectorChainCandidate?.startMs,
  0,
  'English connector-chain speech-to-text planning repairs repeated Then/So starts back to the full context boundary',
);
assertEqual(
  englishConnectorChainCandidate?.speechEndMs,
  41_000,
  'English connector-chain speech-to-text planning keeps the repaired payoff segment in the final candidate',
);
assertEqual(
  englishConnectorChainCandidate?.contentArcGrade,
  'complete',
  'English connector-chain speech-to-text planning scores hook-context-payoff windows as complete arcs',
);
assertNumberBetween(
  englishConnectorChainCandidate?.topicCoherenceScore,
  0.65,
  1,
  'English connector-chain speech-to-text planning treats background, spike, user pain, and payoff as one topic',
);

const lightlyOverlappingTranscriptCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 45,
    sourceDurationMs: 50_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  [
    { startMs: 0, endMs: 12_000, text: 'Watch the retention case background and pricing pain.', speaker: 'Speaker 1' },
    { startMs: 11_850, endMs: 26_000, text: 'Then the refund fix becomes the complete payoff.', speaker: 'Speaker 1' },
  ],
);
const lightlyOverlappingTranscriptCandidate = lightlyOverlappingTranscriptCandidates.find((candidate) =>
  candidate.startMs === 0 && candidate.transcriptSegmentCount === 2
);
assertEqual(
  lightlyOverlappingTranscriptCandidate?.speechStartMs,
  0,
  'speech-to-text planning repairs connector starts across tiny STT segment overlaps',
);
assertEqual(
  lightlyOverlappingTranscriptCandidate?.speechEndMs,
  26_000,
  'speech-to-text planning preserves the full spoken payoff when STT segments slightly overlap',
);
assertArrayIncludes(
  lightlyOverlappingTranscriptCandidate?.risks,
  'connector-repaired',
  'speech-to-text planning records connector repair across tiny STT segment overlaps',
);
assertArrayIncludes(
  lightlyOverlappingTranscriptCandidate?.risks,
  'transcript-overlap-repaired',
  'speech-to-text planning records tiny STT segment overlap repair for quality review',
);

const dynamicPlanningSegments = [
  { startMs: 0, endMs: 12_000, text: 'Watch the first case background and key pain.', speaker: 'Speaker 1' },
  { startMs: 12_000, endMs: 28_000, text: 'So the first payoff is a complete fix viewers can apply.', speaker: 'Speaker 1' },
  { startMs: 36_000, endMs: 48_000, text: 'Watch the second case background and retention pain.', speaker: 'Speaker 1' },
  { startMs: 48_000, endMs: 64_000, text: 'So the second payoff is another complete fix viewers can apply.', speaker: 'Speaker 1' },
  {
    startMs: 72_000,
    endMs: 90_000,
    text: 'This long recap repeats the same first case background and key pain, then repeats the second case background and retention pain without adding a new payoff.',
    speaker: 'Speaker 1',
  },
];
const dynamicPlanningPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 120,
    targetSliceCount: 2,
    sourceDurationMs: 100_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  dynamicPlanningSegments,
);
assertEqual(
  dynamicPlanningPlan.length,
  2,
  'transcript-assisted dynamic planning selects the requested number of non-overlapping high-value speech windows',
);
assertRule(
  dynamicPlanningPlan.some((clip) => (clip.speechStartMs ?? clip.startMs) === 0 && (clip.speechEndMs ?? 0) >= 28_000),
  'transcript-assisted dynamic planning keeps the first complete speech-to-text case window',
);
assertRule(
  dynamicPlanningPlan.some((clip) => (clip.speechStartMs ?? clip.startMs) === 36_000 && (clip.speechEndMs ?? 0) >= 64_000),
  'transcript-assisted dynamic planning keeps the second complete speech-to-text case window',
);
assertRule(
  !dynamicPlanningPlan.some((clip) => (clip.speechStartMs ?? clip.startMs) === 0 && (clip.speechEndMs ?? 0) >= 64_000),
  'transcript-assisted dynamic planning does not let one broad overlapping candidate crowd out multiple complete clips',
);

const longTranscriptSegments = Array.from({ length: 260 }, (_, index) => {
  const startMs = index * 8_000;
  const keyWindowTextByIndex = {
    12: 'Watch the onboarding funnel setup, signup pain, pricing conflict, and complete activation payoff.',
    130: 'Watch the refund workflow setup, support queue pain, escalation conflict, and complete retention payoff.',
    238: 'Watch the creator analytics setup, audience dropoff pain, packaging conflict, and complete publishing payoff.',
  };
  return {
    startMs,
    endMs: startMs + 6_000,
    text: keyWindowTextByIndex[index]
      ? keyWindowTextByIndex[index]
      : `Routine context segment ${index} with background notes and normal discussion.`,
    speaker: 'Speaker 1',
  };
});
const longTranscriptCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 15,
    targetSliceCount: 5,
    sourceDurationMs: 2_100_000,
    sliceCountMode: 'qualityFirst',
    enableRepeatFilter: true,
  },
  longTranscriptSegments,
);
assertRule(
  longTranscriptCandidates.length <= 10,
  'speech-to-text candidate generation returns a bounded review set after pruning large transcript workloads',
);
assertRule(
  longTranscriptCandidates.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) < 160_000) &&
    longTranscriptCandidates.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) > 900_000 && (candidate.speechStartMs ?? candidate.startMs) < 1_200_000) &&
    longTranscriptCandidates.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) > 1_800_000),
  'speech-to-text candidate pruning preserves high-value windows across early, middle, and late transcript ranges',
);

const transcriptSegments = [
  {
    startMs: 0,
    endMs: 12000,
    text: '先看这个案例的背景',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12000,
    endMs: 26000,
    text: '然后它真正爆发的原因是用户痛点很集中',
    speaker: 'Speaker 1',
  },
  {
    startMs: 26000,
    endMs: 41000,
    text: '所以这里最适合切成一条完整短视频',
    speaker: 'Speaker 1',
  },
];
const transcriptPlan = createTranscriptAssistedSlicePlan(baseParams, transcriptSegments);
assertRule(
  transcriptPlan.length > 0 && transcriptPlan.length <= 3,
  'transcript-assisted planner returns quality transcript windows instead of fixed filler clips',
);
assertEqual(
  transcriptPlan[0]?.startMs,
  0,
  'transcript-assisted planner expands connector-led candidates backward',
);
assertEqual(
  transcriptPlan[0]?.durationMs,
  41250,
  'transcript-assisted planner extends open speech-to-text windows through the payoff segment and keeps a trailing speech buffer',
);
assertRule(
  transcriptPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
  ),
  'transcript-assisted planner returns non-overlapping clips',
);
assertRule(
  typeof transcriptPlan[0]?.title === 'string' && transcriptPlan[0].title.length > 0,
  'transcript-assisted fallback clips expose reviewable titles without relying on the LLM',
);
assertRule(
  typeof transcriptPlan[0]?.summary === 'string' && transcriptPlan[0].summary.includes(' '),
  'transcript-assisted fallback clips summarize the repaired speech-to-text window',
);
assertRule(
  typeof transcriptPlan[0]?.reason === 'string' && transcriptPlan[0].reason.includes('speech-to-text'),
  'transcript-assisted fallback clips explain that slice boundaries follow speech-to-text continuity',
);
assertNumberBetween(
  transcriptPlan[0]?.qualityScore,
  0.55,
  1,
  'transcript-assisted fallback clips expose transcript-derived quality scores',
);
assertNumberBetween(
  transcriptPlan[0]?.continuityScore,
  0.8,
  1,
  'transcript-assisted fallback clips expose high continuity scores for joined speech windows',
);
assertArrayIncludes(
  transcriptPlan[0]?.risks,
  'connector-repaired',
  'transcript-assisted fallback clips surface repaired weak-connector starts as review risks',
);
assertEqual(
  transcriptPlan[0]?.sourceStartMs,
  transcriptPlan[0]?.startMs,
  'transcript-assisted fallback clips expose sourceStartMs aligned to the repaired transcript boundary',
);
assertEqual(
  transcriptPlan[0]?.sourceEndMs,
  transcriptPlan[0]?.startMs + transcriptPlan[0]?.durationMs,
  'transcript-assisted fallback clips expose sourceEndMs aligned to the padded render boundary',
);
assertEqual(
  transcriptPlan[0]?.speechStartMs,
  0,
  'transcript-assisted fallback clips preserve the repaired speech-to-text start boundary separately from render padding',
);
assertEqual(
  transcriptPlan[0]?.speechEndMs,
  41000,
  'transcript-assisted fallback clips preserve the repaired speech-to-text end boundary separately from render padding',
);
assertEqual(
  transcriptPlan[0]?.boundaryPaddingBeforeMs,
  0,
  'transcript-assisted fallback clips expose clamped leading speech boundary padding',
);
assertEqual(
  transcriptPlan[0]?.boundaryPaddingAfterMs,
  250,
  'transcript-assisted fallback clips expose trailing speech boundary padding for natural endings',
);
assertEqual(
  transcriptPlan[0]?.transcriptText,
  transcriptSegments.map((segment) => segment.text).join(' '),
  'transcript-assisted fallback clips expose the exact repaired speech-to-text text for review',
);
assertEqual(
  transcriptPlan[0]?.transcriptSegmentCount,
  3,
  'transcript-assisted fallback clips expose the number of transcript segments included in the slice',
);
assertEqual(
  transcriptPlan[0]?.transcriptCoverageScore,
  1,
  'transcript-assisted fallback clips expose full transcript coverage for contiguous speech windows',
);
assertEqual(
  transcriptPlan[0]?.speechContinuityGrade,
  'repaired',
  'transcript-assisted fallback clips grade connector-repaired speech windows as repaired continuity',
);
assertNumberBetween(
  transcriptPlan[0]?.publishabilityScore,
  0.7,
  1,
  'transcript-assisted fallback clips expose a composite publishability score for short-video review',
);
assertRule(
  ['excellent', 'good'].includes(transcriptPlan[0]?.publishabilityGrade),
  `transcript-assisted fallback clips grade repaired complete speech windows as publishable (got ${JSON.stringify(transcriptPlan[0]?.publishabilityGrade)})`,
);
assertRule(
  Array.isArray(transcriptPlan[0]?.publishabilityIssues),
  'transcript-assisted fallback clips expose normalized publishability issue tags',
);
assertNumberBetween(
  transcriptPlan[0]?.platformReadinessScore,
  0.68,
  1,
  'transcript-assisted fallback clips expose platform-specific readiness scores',
);
assertRule(
  ['ready', 'review'].includes(transcriptPlan[0]?.platformReadinessGrade),
  `transcript-assisted fallback clips grade platform-specific publish readiness (got ${JSON.stringify(transcriptPlan[0]?.platformReadinessGrade)})`,
);
assertRule(
  Array.isArray(transcriptPlan[0]?.platformReadinessIssues),
  'transcript-assisted fallback clips expose platform-specific readiness issue tags',
);
assertNumberBetween(
  transcriptPlan[0]?.boundaryQualityScore,
  0.65,
  1,
  'transcript-assisted fallback clips expose boundary quality scores for opening and ending review',
);
assertRule(
  ['strong', 'contextual'].includes(transcriptPlan[0]?.hookStrength),
  `transcript-assisted fallback clips grade hook strength for self-media openings (got ${JSON.stringify(transcriptPlan[0]?.hookStrength)})`,
);
assertRule(
  ['complete', 'soft'].includes(transcriptPlan[0]?.endingCompleteness),
  `transcript-assisted fallback clips grade ending completeness for coherent short videos (got ${JSON.stringify(transcriptPlan[0]?.endingCompleteness)})`,
);

const llmCandidatePlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'transcript-2',
      startMs: 12000,
      durationMs: 15000,
      summary: 'Explains the spike cause and the audience pain point.',
      reason: 'The selected window has a complete setup and payoff for a short video.',
      qualityScore: 0.92,
      continuityScore: 0.88,
      risks: ['needs-cover-title'],
      title: '爆发原因',
    },
  ]),
  baseParams,
  transcriptPlan,
  transcriptSegments,
);
assertEqual(
  llmCandidatePlan[0]?.startMs,
  0,
  'LLM candidate-id plans keep deterministic repaired candidate start time',
);
assertEqual(
  llmCandidatePlan[0]?.durationMs,
  41250,
  'LLM candidate-id plans keep deterministic padded speech-to-text render duration',
);
assertEqual(
  llmCandidatePlan[0]?.label,
  '爆发原因',
  'LLM candidate-id plans can still use the semantic title as clip label',
);

assertEqual(
  llmCandidatePlan[0]?.title,
  llmCandidatePlan[0]?.label,
  'LLM candidate-id plans preserve AI titles for explainable slice results',
);
assertEqual(
  llmCandidatePlan[0]?.summary,
  'Explains the spike cause and the audience pain point.',
  'LLM candidate-id plans preserve AI summaries for operator review',
);
assertEqual(
  llmCandidatePlan[0]?.reason,
  'The selected window has a complete setup and payoff for a short video.',
  'LLM candidate-id plans preserve AI selection reasons',
);
assertEqual(
  llmCandidatePlan[0]?.qualityScore,
  0.92,
  'LLM candidate-id plans preserve normalized quality scores',
);
assertEqual(
  llmCandidatePlan[0]?.continuityScore,
  0.88,
  'LLM candidate-id plans preserve normalized continuity scores',
);
assertEqual(
  llmCandidatePlan[0]?.risks?.[0],
  'needs-cover-title',
  'LLM candidate-id plans preserve publishing risk tags',
);
assertEqual(
  llmCandidatePlan[0]?.sourceStartMs,
  0,
  'LLM candidate-id plans expose deterministic source start metadata',
);
assertEqual(
  llmCandidatePlan[0]?.sourceEndMs,
  41250,
  'LLM candidate-id plans expose deterministic source end metadata',
);
assertEqual(
  llmCandidatePlan[0]?.speechStartMs,
  0,
  'LLM candidate-id plans expose deterministic speech start metadata',
);
assertEqual(
  llmCandidatePlan[0]?.speechEndMs,
  41000,
  'LLM candidate-id plans expose deterministic speech end metadata',
);
assertEqual(
  llmCandidatePlan[0]?.boundaryPaddingAfterMs,
  250,
  'LLM candidate-id plans preserve deterministic speech boundary padding metadata',
);
assertEqual(
  llmCandidatePlan[0]?.transcriptText,
  transcriptPlan[0]?.transcriptText,
  'LLM candidate-id plans preserve deterministic transcript text metadata',
);
assertEqual(
  llmCandidatePlan[0]?.transcriptSegmentCount,
  3,
  'LLM candidate-id plans preserve deterministic transcript segment counts',
);
assertEqual(
  llmCandidatePlan[0]?.transcriptCoverageScore,
  1,
  'LLM candidate-id plans preserve deterministic transcript coverage scores',
);
assertEqual(
  llmCandidatePlan[0]?.speechContinuityGrade,
  'repaired',
  'LLM candidate-id plans preserve deterministic speech continuity grades',
);
assertEqual(
  llmCandidatePlan[0]?.boundaryQualityScore,
  transcriptPlan[0]?.boundaryQualityScore,
  'LLM candidate-id plans preserve deterministic boundary quality scores',
);
assertEqual(
  llmCandidatePlan[0]?.hookStrength,
  transcriptPlan[0]?.hookStrength,
  'LLM candidate-id plans preserve deterministic hook strength grades',
);
assertEqual(
  llmCandidatePlan[0]?.endingCompleteness,
  transcriptPlan[0]?.endingCompleteness,
  'LLM candidate-id plans preserve deterministic ending completeness grades',
);
assertNumberBetween(
  llmCandidatePlan[0]?.publishabilityScore,
  0.7,
  1,
  'LLM candidate-id plans expose composite publishability scores',
);
assertRule(
  ['excellent', 'good'].includes(llmCandidatePlan[0]?.publishabilityGrade),
  `LLM candidate-id plans preserve publishable transcript candidates as ready for self-media review (got ${JSON.stringify(llmCandidatePlan[0]?.publishabilityGrade)})`,
);
assertEqual(
  llmCandidatePlan[0]?.platformReadinessGrade,
  transcriptPlan[0]?.platformReadinessGrade,
  'LLM candidate-id plans preserve deterministic platform-specific readiness grades',
);
assertRule(
  Array.isArray(llmCandidatePlan[0]?.platformReadinessIssues),
  'LLM candidate-id plans preserve deterministic platform-specific readiness issues',
);

const llmRawTranscriptPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      startMs: 13000,
      durationMs: 10000,
      title: 'Raw LLM midpoint',
      reason: 'LLM chose a midpoint that needs speech-to-text repair.',
    },
  ]),
  baseParams,
  transcriptPlan,
  transcriptSegments,
);
assertEqual(
  llmRawTranscriptPlan[0]?.startMs,
  0,
  'LLM raw-timing plans snap overlapping selections back to repaired speech-to-text start boundaries',
);
assertEqual(
  llmRawTranscriptPlan[0]?.durationMs,
  41250,
  'LLM raw-timing plans snap overlapping selections forward to complete padded speech-to-text durations',
);
assertArrayIncludes(
  llmRawTranscriptPlan[0]?.risks,
  'llm-timing-snapped-to-transcript',
  'LLM raw-timing plans record when a model midpoint is repaired to speech-to-text boundaries',
);

const deterministicPlan = createDeterministicSlicePlan({ ...baseParams, minDuration: 15, maxDuration: 60 });
assertEqual(deterministicPlan.length, 5, 'deterministic fallback keeps the bounded standard clip count');
assertEqual(deterministicPlan[0]?.durationMs, 15000, 'deterministic fallback uses the configured minimum duration');
assertRule(
  typeof deterministicPlan[0]?.title === 'string' && deterministicPlan[0].title.length > 0,
  'deterministic fallback clips expose reviewable titles',
);
assertRule(
  typeof deterministicPlan[0]?.summary === 'string' && deterministicPlan[0].summary.includes('fallback'),
  'deterministic fallback clips explain the fallback source',
);
assertRule(
  typeof deterministicPlan[0]?.reason === 'string' && deterministicPlan[0].reason.includes('continuous'),
  'deterministic fallback clips explain that intervals remain continuous and non-overlapping',
);
assertNumberBetween(
  deterministicPlan[0]?.qualityScore,
  0.4,
  0.7,
  'deterministic fallback clips expose conservative quality scores',
);
assertNumberBetween(
  deterministicPlan[0]?.continuityScore,
  0.6,
  0.85,
  'deterministic fallback clips expose conservative continuity scores',
);
assertArrayIncludes(
  deterministicPlan[0]?.risks,
  'no-transcript-boundary',
  'deterministic fallback clips warn that boundaries are not speech-to-text aligned',
);
assertEqual(
  deterministicPlan[0]?.transcriptCoverageScore,
  0,
  'deterministic fallback clips expose zero transcript coverage when no speech-to-text boundary is available',
);
assertEqual(
  deterministicPlan[0]?.transcriptSegmentCount,
  0,
  'deterministic fallback clips expose zero transcript segments when no transcript is available',
);
assertEqual(
  deterministicPlan[0]?.speechContinuityGrade,
  'weak',
  'deterministic fallback clips grade speech continuity as weak without transcript boundaries',
);
assertNumberBetween(
  deterministicPlan[0]?.publishabilityScore,
  0,
  0.6,
  'deterministic fallback clips expose low publishability scores when no transcript continuity is available',
);
assertEqual(
  deterministicPlan[0]?.publishabilityGrade,
  'review',
  'deterministic fallback clips require review before self-media publishing',
);
assertArrayIncludes(
  deterministicPlan[0]?.publishabilityIssues,
  'no-transcript-boundary',
  'deterministic fallback publishability issues explain missing speech-to-text boundaries',
);
assertEqual(
  deterministicPlan[0]?.hookStrength,
  'weak',
  'deterministic fallback clips grade hook strength as weak without speech-to-text evidence',
);
assertEqual(
  deterministicPlan[0]?.endingCompleteness,
  'open',
  'deterministic fallback clips grade endings as open without speech-to-text evidence',
);
assertArrayIncludes(
  deterministicPlan[0]?.publishabilityIssues,
  'weak-hook',
  'deterministic fallback publishability issues include weak opening warnings',
);
assertEqual(
  deterministicPlan[0]?.sourceStartMs,
  deterministicPlan[0]?.startMs,
  'deterministic fallback clips expose sourceStartMs',
);
assertEqual(
  deterministicPlan[0]?.sourceEndMs,
  deterministicPlan[0]?.startMs + deterministicPlan[0]?.durationMs,
  'deterministic fallback clips expose sourceEndMs',
);

const fixedCountPlan = createDeterministicSlicePlan({
  ...baseParams,
  sliceCountMode: 'fixed',
  targetSliceCount: 3,
  idealDuration: 45,
});
assertEqual(fixedCountPlan.length, 3, 'fixed-count deterministic fallback uses the requested target slice count');
assertEqual(fixedCountPlan[0]?.durationMs, 45000, 'deterministic fallback uses ideal duration when it is inside configured bounds');

const sourceBoundedDeterministicPlan = createDeterministicSlicePlan({
  ...baseParams,
  targetSliceCount: 5,
  sourceDurationMs: 35000,
});
assertEqual(
  sourceBoundedDeterministicPlan.length,
  3,
  'source-duration-aware deterministic fallback stops at the real media duration',
);
assertEqual(
  sourceBoundedDeterministicPlan[2]?.startMs,
  30000,
  'source-duration-aware deterministic fallback keeps the final tail continuous',
);
assertEqual(
  sourceBoundedDeterministicPlan[2]?.durationMs,
  5000,
  'source-duration-aware deterministic fallback keeps a publishable final tail when it reaches the absolute minimum duration',
);
assertRule(
  sourceBoundedDeterministicPlan.every((clip) => clip.startMs + clip.durationMs <= 35000),
  'source-duration-aware deterministic fallback never plans clips beyond the source media duration',
);
assertArrayIncludes(
  sourceBoundedDeterministicPlan[2]?.risks,
  'source-duration-tail',
  'source-duration-aware deterministic fallback flags final tail clips that are shorter than the configured target duration',
);

const qualityFirstPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 5,
}, transcriptSegments);
assertRule(
  qualityFirstPlan.length > 0 && qualityFirstPlan.length < 5,
  'quality-first transcript planning does not pad weak filler clips to the target count',
);

const coverageFirstPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  sliceCountMode: 'coverageFirst',
  targetSliceCount: 5,
}, transcriptSegments);
assertEqual(
  coverageFirstPlan.length,
  qualityFirstPlan.length,
  'coverage-first transcript planning only emits clips with structured speech-to-text coverage instead of padding silent fixed windows',
);
assertRule(
  coverageFirstPlan.every((clip) => clip.publishabilityGrade !== 'reject' && clip.platformReadinessGrade !== 'reject'),
  'transcript-assisted planning filters unpublishable reject-grade speech windows before rendering',
);

const standardContinuityCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 10000, text: 'Opening setup with important context.', speaker: 'Speaker 1' },
  { startMs: 11200, endMs: 24000, text: 'then payoff should attach across standard gap.', speaker: 'Speaker 1' },
]);
const standardConnectorCandidate = standardContinuityCandidates.find((candidate) =>
  candidate.startMs === 0 && candidate.risks?.includes('connector-repaired')
);
assertEqual(
  standardConnectorCandidate?.startMs,
  0,
  'standard continuity repairs connector starts across short transcript gaps',
);
assertArrayIncludes(
  standardConnectorCandidate?.risks,
  'connector-repaired',
  'standard continuity candidates flag repaired connector-led starts',
);
assertNumberBetween(
  standardConnectorCandidate?.continuityScore,
  0.8,
  1,
  'standard continuity candidates score repaired speech-to-text windows as continuous',
);

const trailingConnectorCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The setup reaches the minimum duration and', speaker: 'Speaker 1' },
  { startMs: 12400, endMs: 25000, text: 'the payoff completes the sentence for the short video.', speaker: 'Speaker 1' },
]);
assertEqual(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  25250,
  'speech-to-text planning extends clips that would otherwise end on a trailing connector and adds ending breathing room',
);
assertArrayIncludes(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'trailing-connector-extended',
  'speech-to-text planning records when it extends an incomplete trailing connector',
);
assertNumberBetween(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityScore,
  0.72,
  1,
  'speech-to-text planning exposes sentence boundary integrity scores after repairing trailing connectors',
);
assertEqual(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityGrade,
  'repaired',
  'speech-to-text planning grades repaired trailing connector windows separately from fully clean sentence boundaries',
);
assertArrayIncludes(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIssues,
  'sentence-trailing-connector-repaired',
  'speech-to-text planning records sentence boundary issue tags for repaired trailing connectors',
);

const trailingOpenSentenceCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The speaker introduces the case without closing punctuation', speaker: 'Speaker 1' },
  { startMs: 12300, endMs: 23000, text: 'so the next subtitle completes the thought.', speaker: 'Speaker 1' },
]);
assertEqual(
  trailingOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  23250,
  'speech-to-text planning extends clips that end on an open subtitle sentence without terminal punctuation and adds ending breathing room',
);
assertArrayIncludes(
  trailingOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'open-sentence-extended',
  'speech-to-text planning records when it extends an open subtitle sentence',
);
assertEqual(
  trailingOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityGrade,
  'repaired',
  'speech-to-text planning grades open subtitle sentence extensions as repaired sentence boundaries',
);

const chineseConnectorCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: '\u5f00\u5934\u5148\u8bb2\u5b8c\u8fd9\u4e2a\u6848\u4f8b\u7684\u80cc\u666f\u548c\u95ee\u9898\u3002', speaker: 'Speaker 1' },
  { startMs: 12400, endMs: 30000, text: '\u7136\u540e\u624d\u7ed9\u51fa\u89e3\u51b3\u529e\u6cd5\uff0c\u8fd9\u6837\u526a\u51fa\u6765\u7684\u7247\u6bb5\u624d\u8fde\u8d2f\u3002', speaker: 'Speaker 1' },
]);
const chineseConnectorCandidate = chineseConnectorCandidates.find((candidate) =>
  candidate.startMs === 0 && candidate.risks?.includes('connector-repaired')
);
assertEqual(
  chineseConnectorCandidate?.startMs,
  0,
  'Chinese speech-to-text planning repairs clips that start with connector words by including prior context',
);
assertArrayIncludes(
  chineseConnectorCandidate?.risks,
  'connector-repaired',
  'Chinese connector-led clips surface the repaired transcript boundary as a review risk',
);
assertArrayIncludes(
  chineseConnectorCandidate?.sentenceBoundaryIssues,
  'sentence-leading-connector-repaired',
  'Chinese connector-led clips expose sentence boundary issue tags for repaired openings',
);

const chineseTrailingConnectorCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: '\u8fd9\u4e2a\u7247\u6bb5\u4e0d\u80fd\u5728\u8fd9\u91cc\u76f4\u63a5\u7ed3\u675f\uff0c\u56e0\u4e3a', speaker: 'Speaker 1' },
  { startMs: 12300, endMs: 24500, text: '\u540e\u9762\u8fd9\u53e5\u624d\u662f\u89e3\u91ca\u539f\u56e0\u548c\u5b8c\u6574\u7ed3\u8bba\u3002', speaker: 'Speaker 1' },
]);
assertEqual(
  chineseTrailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  24750,
  'Chinese speech-to-text planning extends clips that would end on trailing connector words and adds ending breathing room',
);
assertArrayIncludes(
  chineseTrailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'trailing-connector-extended',
  'Chinese trailing connector extensions are surfaced as continuity repair risks',
);
assertEqual(
  chineseTrailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityGrade,
  'repaired',
  'Chinese trailing connector extensions are graded as repaired sentence boundaries',
);

const chineseOpenSentenceCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: '\u8fd9\u6bb5\u8bdd\u5df2\u7ecf\u8fbe\u5230\u6700\u77ed\u65f6\u957f\u4f46\u8fd8\u6ca1\u6709\u628a\u7ed3\u8bba\u8bf4\u5b8c', speaker: 'Speaker 1' },
  { startMs: 12200, endMs: 23800, text: '\u6240\u4ee5\u9700\u8981\u628a\u8fd9\u4e00\u53e5\u4e5f\u7eb3\u5165\u540c\u4e00\u4e2a\u77ed\u89c6\u9891\u3002', speaker: 'Speaker 1' },
]);
assertEqual(
  chineseOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  24050,
  'Chinese speech-to-text planning extends subtitle windows that lack terminal punctuation and adds ending breathing room',
);
assertArrayIncludes(
  chineseOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'open-sentence-extended',
  'Chinese open sentence extensions are surfaced as continuity repair risks',
);
assertNumberBetween(
  chineseOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityScore,
  0.72,
  1,
  'Chinese open sentence extensions expose a usable repaired sentence boundary score',
);

const unrepairedConnectorRankingPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 22000,
    label: 'Clean sentence boundary',
    qualityScore: 0.83,
    continuityScore: 0.86,
    storyShape: 'complete',
    publishabilityScore: 0.83,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.86,
    topicCoherenceGrade: 'strong',
    sentenceBoundaryIntegrityScore: 0.94,
    sentenceBoundaryIntegrityGrade: 'clean',
    sentenceBoundaryIssues: [],
  },
  {
    index: 1,
    startMs: 30000,
    durationMs: 22000,
    label: 'Higher score but broken sentence boundary',
    qualityScore: 0.94,
    continuityScore: 0.93,
    storyShape: 'complete',
    publishabilityScore: 0.9,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    sentenceBoundaryIntegrityScore: 0.28,
    sentenceBoundaryIntegrityGrade: 'broken',
    sentenceBoundaryIssues: ['sentence-leading-connector-unrepaired'],
  },
], {
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
});
assertEqual(
  unrepairedConnectorRankingPlan[0]?.label,
  'Clean sentence boundary',
  'quality-first candidate normalization ranks clean sentence boundaries above higher-score broken sentence fragments',
);
assertEqual(
  unrepairedConnectorRankingPlan[0]?.sentenceBoundaryIntegrityGrade,
  'clean',
  'quality-first candidate normalization preserves sentence boundary integrity grades on selected clips',
);

const paddedBreathingRoomCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
  sourceDurationMs: 45000,
}, [
  { startMs: 1000, endMs: 9000, text: 'Watch the opening result before the setup starts.', speaker: 'Speaker 1' },
  { startMs: 9300, endMs: 22000, text: 'Because the first sentence names the pain clearly.', speaker: 'Speaker 1' },
]);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.startMs,
  800,
  'speech-to-text candidates add leading render padding before the first spoken word',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.speechStartMs,
  1000,
  'speech-to-text candidates preserve the unpadded speech start for subtitle and review alignment',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.speechEndMs,
  22000,
  'speech-to-text candidates preserve the unpadded speech end for subtitle and review alignment',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.boundaryPaddingBeforeMs,
  200,
  'speech-to-text candidates expose the leading boundary padding applied to the render clip',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.boundaryPaddingAfterMs,
  250,
  'speech-to-text candidates expose the trailing boundary padding applied to the render clip',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sourceStartMs,
  800,
  'speech-to-text candidates expose padded sourceStartMs for the actual rendered clip',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sourceEndMs,
  22250,
  'speech-to-text candidates expose padded sourceEndMs for the actual rendered clip',
);

const tightGapPaddingPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 18,
  continuityLevel: 'strict',
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 2,
  sourceDurationMs: 36000,
}, [
  { startMs: 0, endMs: 12000, text: 'First clear hook explains the retention problem.', speaker: 'Speaker 1' },
  { startMs: 12100, endMs: 25000, text: 'Second clear hook explains the pricing problem.', speaker: 'Speaker 1' },
]);
assertRule(
  tightGapPaddingPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
  ),
  'speech boundary padding is clamped so adjacent rendered clips never overlap',
);
assertEqual(
  tightGapPaddingPlan[0]?.boundaryPaddingAfterMs,
  50,
  'speech boundary padding splits tight inter-speech gaps instead of overlapping the next clip',
);
assertEqual(
  tightGapPaddingPlan[1]?.boundaryPaddingBeforeMs,
  50,
  'speech boundary padding splits tight previous gaps before the next clip',
);

const externallyPaddedSpeechPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 25_000,
    label: 'LLM padded intro',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'Watch the result first, then the speaker explains the reason and takeaway.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
    speechStartMs: 4_000,
    speechEndMs: 20_000,
    sourceStartMs: 0,
    sourceEndMs: 25_000,
  },
], {
  ...baseParams,
  minDuration: 5,
  maxDuration: 60,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
  sourceDurationMs: 60_000,
});
assertEqual(
  externallyPaddedSpeechPlan[0]?.startMs,
  3_800,
  'candidate normalization trims excessive silent intros around known speech starts',
);
assertEqual(
  externallyPaddedSpeechPlan[0]?.durationMs,
  16_450,
  'candidate normalization trims excessive silent outros around known speech ends',
);
assertEqual(
  externallyPaddedSpeechPlan[0]?.boundaryPaddingBeforeMs,
  200,
  'candidate normalization keeps only professional leading speech breathing room after silence trimming',
);
assertEqual(
  externallyPaddedSpeechPlan[0]?.boundaryPaddingAfterMs,
  250,
  'candidate normalization keeps only professional trailing speech breathing room after silence trimming',
);
assertArrayIncludes(
  externallyPaddedSpeechPlan[0]?.risks,
  'excess-leading-silence-trimmed',
  'candidate normalization records excessive leading silence trimming for review',
);
assertArrayIncludes(
  externallyPaddedSpeechPlan[0]?.risks,
  'excess-trailing-silence-trimmed',
  'candidate normalization records excessive trailing silence trimming for review',
);

const llmOverpaddedSpeechPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      startMs: 0,
      durationMs: 30_000,
      title: 'Overpadded LLM clip',
      transcriptText: 'The hook starts only after silence and finishes before the quiet tail.',
      transcriptCoverageScore: 0.92,
      transcriptSegmentCount: 2,
      speechContinuityGrade: 'strong',
      speechStartMs: 6_000,
      speechEndMs: 23_000,
      qualityScore: 0.9,
      continuityScore: 0.9,
      storyShape: 'complete',
    },
  ]),
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 60,
    sliceCountMode: 'qualityFirst',
    targetSliceCount: 1,
    sourceDurationMs: 60_000,
  },
  deterministicPlan,
);
assertEqual(
  llmOverpaddedSpeechPlan[0]?.startMs,
  5_800,
  'LLM raw timing is trimmed to the first real speech boundary instead of preserving a long silent intro',
);
assertEqual(
  llmOverpaddedSpeechPlan[0]?.durationMs,
  17_450,
  'LLM raw timing is trimmed to the final real speech boundary instead of preserving a long silent outro',
);
assertArrayIncludes(
  llmOverpaddedSpeechPlan[0]?.risks,
  'excess-leading-silence-trimmed',
  'LLM raw timing records leading silence trimming in the final plan',
);

const shortUnjoinedSpeechCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 20,
  continuityLevel: 'strict',
}, [
  { startMs: 0, endMs: 6000, text: 'Short setup cannot stand alone yet.', speaker: 'Speaker 1' },
  { startMs: 7000, endMs: 18000, text: 'Separate next point starts after a strict continuity break.', speaker: 'Speaker 1' },
]);
assertRule(
  !shortUnjoinedSpeechCandidates.some((candidate) =>
    candidate.candidateId === 'transcript-1' && candidate.endMs > 7000,
  ),
  'speech boundary padding never extends a short candidate into the next unjoined speech segment',
);

const strictContinuityCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  continuityLevel: 'strict',
}, [
  { startMs: 0, endMs: 10000, text: 'Opening setup with important context.', speaker: 'Speaker 1' },
  { startMs: 11200, endMs: 24000, text: 'then payoff should not attach across strict gap.', speaker: 'Speaker 1' },
]);
assertEqual(
  strictContinuityCandidates.find((candidate) => candidate.candidateId === 'transcript-2')?.startMs,
  11000,
  'strict continuity may add silence breathing room but does not repair connector starts across gaps beyond the strict join standard',
);
assertEqual(
  strictContinuityCandidates.find((candidate) => candidate.candidateId === 'transcript-2')?.speechStartMs,
  11200,
  'strict continuity preserves the unpadded speech start when connector context cannot be repaired',
);

const keywordCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  highlightEngine: 'keyword',
  customKeywords: ['retention'],
}, [
  { startMs: 0, endMs: 16000, text: 'Plain setup without the configured term.', speaker: 'Speaker 1' },
  { startMs: 17000, endMs: 33000, text: 'Retention spike explains why viewers stay.', speaker: 'Speaker 1' },
]);
const keywordCandidate = keywordCandidates.find((candidate) => candidate.transcriptText?.includes('Retention spike'));
assertEqual(
  keywordCandidate?.startMs,
  16800,
  'custom keywords boost matching transcript windows in candidate ranking while preserving render breathing room',
);
assertEqual(
  keywordCandidate?.speechStartMs,
  17000,
  'custom keyword candidates preserve the original speech start despite leading render padding',
);

const storyShapeCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'Three seconds is all you have before people scroll away.', speaker: 'Speaker 1' },
  { startMs: 12200, endMs: 24000, text: 'Because the opening does not name the pain, viewers never know why they should care.', speaker: 'Speaker 1' },
  { startMs: 24200, endMs: 36000, text: 'So the fix is to lead with the result, then prove it with one concrete example.', speaker: 'Speaker 1' },
]);
const completeStoryCandidate = storyShapeCandidates.find((candidate) => candidate.storyShape === 'complete');
assertEqual(
  completeStoryCandidate?.storyShape,
  'complete',
  'speech-to-text candidate scoring detects complete hook-context-payoff short-video windows',
);
assertRule(
  !completeStoryCandidate?.risks?.includes('missing-payoff'),
  'complete hook-context-payoff windows are not flagged as missing a payoff',
);
assertNumberBetween(
  completeStoryCandidate?.contentArcScore,
  0.8,
  1,
  'speech-to-text candidate scoring exposes complete content-arc scores for publishable short videos',
);
assertEqual(
  completeStoryCandidate?.contentArcGrade,
  'complete',
  'speech-to-text candidate scoring grades complete hook-setup-conflict-payoff arcs as complete',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'hook',
  'speech-to-text content arcs detect short-video hooks',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'setup',
  'speech-to-text content arcs detect setup context',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'conflict',
  'speech-to-text content arcs detect audience pain or conflict',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'payoff',
  'speech-to-text content arcs detect payoff or solution endings',
);
assertRule(
  Array.isArray(completeStoryCandidate?.contentArcMissingStages) &&
    completeStoryCandidate.contentArcMissingStages.length === 0,
  'complete content arcs do not report missing short-video stages',
);
assertNumberBetween(
  completeStoryCandidate?.topicCoherenceScore,
  0.75,
  1,
  'speech-to-text candidate scoring exposes high topic coherence for single-topic short videos',
);
assertEqual(
  completeStoryCandidate?.topicCoherenceGrade,
  'strong',
  'speech-to-text candidate scoring grades single-topic transcript windows as strong topic coherence',
);
assertEqual(
  completeStoryCandidate?.topicShiftCount,
  0,
  'single-topic transcript windows do not report topic shifts',
);
assertArrayIncludes(
  completeStoryCandidate?.topicKeywords,
  'opening',
  'topic coherence metadata exposes representative transcript keywords for review',
);

const chineseStoryShapeCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 11000, text: '\u4e3a\u4ec0\u4e48\u5f88\u591a\u77ed\u89c6\u9891\u526a\u51fa\u6765\u6ca1\u6709\u5b8c\u64ad\uff1f', speaker: 'Speaker 1' },
  { startMs: 11200, endMs: 23000, text: '\u56e0\u4e3a\u5f00\u5934\u6ca1\u6709\u628a\u95ee\u9898\u548c\u573a\u666f\u4ea4\u4ee3\u6e05\u695a\u3002', speaker: 'Speaker 1' },
  { startMs: 23200, endMs: 35000, text: '\u6240\u4ee5\u89e3\u51b3\u529e\u6cd5\u662f\u5148\u7ed9\u7ed3\u679c\uff0c\u518d\u7528\u4e00\u4e2a\u4f8b\u5b50\u8bc1\u660e\u3002', speaker: 'Speaker 1' },
]);
const completeChineseStoryCandidate = chineseStoryShapeCandidates.find((candidate) => candidate.storyShape === 'complete');
assertEqual(
  completeChineseStoryCandidate?.storyShape,
  'complete',
  'Chinese speech-to-text candidate scoring detects complete hook-context-payoff windows',
);
assertRule(
  !completeChineseStoryCandidate?.risks?.includes('missing-payoff'),
  'complete Chinese hook-context-payoff windows are not flagged as missing a payoff',
);
assertEqual(
  completeChineseStoryCandidate?.contentArcGrade,
  'complete',
  'Chinese speech-to-text candidate scoring grades complete hook-setup-conflict-payoff arcs as complete',
);
assertArrayIncludes(
  completeChineseStoryCandidate?.contentArcStages,
  'conflict',
  'Chinese speech-to-text content arcs detect problem or pain stages',
);

const thinStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 20,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The team had a difficult launch with many details still unclear', speaker: 'Speaker 1' },
  { startMs: 50000, endMs: 62000, text: 'The next section starts a separate topic with no payoff yet', speaker: 'Speaker 1' },
]);
assertArrayIncludes(
  thinStoryCandidates[0]?.risks,
  'missing-payoff',
  'speech-to-text candidate scoring flags setup-only windows that are weak short-video slices',
);
assertEqual(
  thinStoryCandidates[0]?.contentArcGrade,
  'partial',
  'setup-only transcript windows are graded as partial content arcs instead of complete publishable shorts',
);
assertArrayIncludes(
  thinStoryCandidates[0]?.contentArcMissingStages,
  'payoff',
  'setup-only transcript windows surface missing payoff stages for review',
);

const topicDriftCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 30,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 10000, text: 'Retention drops when the opening hides the viewer pain.', speaker: 'Speaker 1' },
  { startMs: 10200, endMs: 21000, text: 'So the fix is to name the result and prove it fast.', speaker: 'Speaker 1' },
  { startMs: 21200, endMs: 32000, text: 'The pricing model uses annual invoices and refund terms.', speaker: 'Speaker 1' },
]);
assertNumberBetween(
  topicDriftCandidates[0]?.topicCoherenceScore,
  0,
  0.74,
  'speech-to-text candidate scoring lowers topic coherence when one slice crosses unrelated topics',
);
assertEqual(
  topicDriftCandidates[0]?.topicCoherenceGrade,
  'weak',
  'speech-to-text candidate scoring grades cross-topic transcript windows as weak topic coherence',
);
assertRule(
  typeof topicDriftCandidates[0]?.topicShiftCount === 'number' && topicDriftCandidates[0].topicShiftCount >= 1,
  'cross-topic transcript windows expose the number of topic shifts for review',
);
assertArrayIncludes(
  topicDriftCandidates[0]?.publishabilityIssues,
  'topic-drift',
  'cross-topic transcript windows include topic drift publishability issue tags',
);

const duplicateCandidatePlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 22000,
    label: 'Duplicate lower score',
    qualityScore: 0.62,
    summary: 'The speaker explains the same retention spike with weaker framing.',
  },
  {
    index: 1,
    startMs: 1000,
    durationMs: 22000,
    label: 'Duplicate higher score',
    qualityScore: 0.93,
    summary: 'The speaker explains the same retention spike with stronger framing.',
  },
  {
    index: 2,
    startMs: 32000,
    durationMs: 15000,
    label: 'Distinct later topic',
    qualityScore: 0.72,
    summary: 'A different example covers the pricing lesson.',
  },
], {
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 3,
});
assertEqual(
  duplicateCandidatePlan[0]?.startMs,
  1000,
  'candidate normalization keeps the strongest candidate when two windows heavily overlap',
);
assertEqual(
  duplicateCandidatePlan.length,
  2,
  'candidate normalization removes near-duplicate windows instead of producing repetitive short videos',
);

const partialOverlapCandidatePlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 30000,
    label: 'First complete speech window',
    qualityScore: 0.86,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'The first window explains one complete answer.',
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
  },
  {
    index: 1,
    startMs: 25000,
    durationMs: 30000,
    label: 'Partially repeated overlap',
    qualityScore: 0.85,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'The second window repeats the previous ending before a new answer.',
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 2,
});
assertEqual(
  partialOverlapCandidatePlan.length,
  1,
  'candidate normalization rejects partially overlapping speech windows so slice outputs do not repeat source content',
);
const shortPhraseDuplicateCandidatePlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 12_000,
    label: 'Refund fix A',
    qualityScore: 0.9,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'Refund fix improves retention.',
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
  {
    index: 1,
    startMs: 16_000,
    durationMs: 12_000,
    label: 'Refund fix B',
    qualityScore: 0.89,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'Refund fix improved retention.',
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
  {
    index: 2,
    startMs: 36_000,
    durationMs: 12_000,
    label: 'Pricing setup',
    qualityScore: 0.8,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'Pricing setup explains invoice pain.',
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  minDuration: 5,
  maxDuration: 60,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 3,
  enableRepeatFilter: true,
});
assertEqual(
  shortPhraseDuplicateCandidatePlan.filter((candidate) => candidate.transcriptText?.includes('Refund fix')).length,
  1,
  'candidate normalization removes short one-sentence near-duplicates from external or LLM candidate inputs',
);
assertRule(
  shortPhraseDuplicateCandidatePlan.some((candidate) => candidate.transcriptText?.includes('Pricing setup')),
  'candidate normalization keeps distinct short transcript candidates while removing short near-duplicates',
);

const invalidCandidateTimingPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: -30000,
    label: 'Negative duration candidate',
    qualityScore: 0.99,
  },
  {
    index: 1,
    startMs: 10000,
    durationMs: 0,
    label: 'Zero duration candidate',
    qualityScore: 0.98,
  },
  {
    index: 2,
    startMs: 30000,
    durationMs: 16000,
    label: 'Valid normalized candidate',
    qualityScore: 0.7,
  },
], {
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
});
assertEqual(
  invalidCandidateTimingPlan[0]?.label,
  'Valid normalized candidate',
  'candidate normalization rejects non-positive durations instead of repairing them into minimum-length clips',
);
assertEqual(
  invalidCandidateTimingPlan[0]?.startMs,
  30000,
  'candidate normalization keeps valid candidates after dirty timing entries',
);

const dirtyTimingMetadataPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 10000,
    durationMs: 20000,
    label: 'Dirty timing metadata',
    qualityScore: 0.82,
    continuityScore: 0.9,
    storyShape: 'complete',
    sourceStartMs: 50000,
    sourceEndMs: 9000,
    speechStartMs: 0,
    speechEndMs: 50000,
    transcriptText: 'Start with the result, explain the reason, and finish with the takeaway.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
});
assertEqual(
  dirtyTimingMetadataPlan[0]?.sourceStartMs,
  10000,
  'candidate normalization repairs dirty sourceStartMs to the actual render start',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.sourceEndMs,
  30000,
  'candidate normalization repairs dirty sourceEndMs to the actual render end',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.speechStartMs,
  10000,
  'candidate normalization clamps dirty speechStartMs inside the repaired source range',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.speechEndMs,
  30000,
  'candidate normalization clamps dirty speechEndMs inside the repaired source range',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.boundaryPaddingBeforeMs,
  0,
  'candidate normalization recomputes leading boundary padding after timing repair',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.boundaryPaddingAfterMs,
  0,
  'candidate normalization recomputes trailing boundary padding after timing repair',
);
assertArrayIncludes(
  dirtyTimingMetadataPlan[0]?.risks,
  'timing-metadata-repaired',
  'candidate normalization records timing metadata repairs for quality review',
);

const publishabilityRankedPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 20000,
    label: 'Weak but early',
    qualityScore: 0.95,
    continuityScore: 0.35,
    storyShape: 'thin',
    risks: ['missing-payoff'],
    transcriptCoverageScore: 0.2,
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'weak',
  },
  {
    index: 1,
    startMs: 30000,
    durationMs: 20000,
    label: 'Complete publishable',
    qualityScore: 0.78,
    continuityScore: 0.92,
    storyShape: 'complete',
    risks: [],
    transcriptCoverageScore: 0.96,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
});
assertEqual(
  publishabilityRankedPlan[0]?.label,
  'Complete publishable',
  'quality-first candidate normalization ranks complete continuous slices above early but weak high-quality fragments',
);
assertNumberBetween(
  publishabilityRankedPlan[0]?.publishabilityScore,
  0.75,
  1,
  'quality-first candidate normalization exposes publishability scores on selected clips',
);
assertEqual(
  publishabilityRankedPlan[0]?.publishabilityGrade,
  'good',
  'quality-first candidate normalization grades complete continuous slices as good publish candidates',
);

const platformRankedPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 90000,
    label: 'Long context that only works on Bilibili',
    qualityScore: 0.9,
    continuityScore: 0.94,
    storyShape: 'complete',
    publishabilityScore: 0.9,
    boundaryQualityScore: 0.84,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 6,
    speechContinuityGrade: 'strong',
  },
  {
    index: 1,
    startMs: 100000,
    durationMs: 32000,
    label: 'Short vertical-ready hook',
    qualityScore: 0.83,
    continuityScore: 0.9,
    storyShape: 'complete',
    publishabilityScore: 0.84,
    boundaryQualityScore: 0.9,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.88,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.94,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  targetPlatform: 'douyin',
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
  maxDuration: 120,
});
assertEqual(
  platformRankedPlan[0]?.label,
  'Short vertical-ready hook',
  'quality-first candidate normalization ranks platform-ready short-video slices above generic long contexts on Douyin',
);
assertEqual(
  platformRankedPlan[0]?.platformReadinessGrade,
  'ready',
  'platform-ready short-video candidates are graded ready for the selected platform',
);

const bilibiliLongContextPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 90000,
    label: 'Long context that fits Bilibili',
    qualityScore: 0.9,
    continuityScore: 0.94,
    storyShape: 'complete',
    publishabilityScore: 0.9,
    boundaryQualityScore: 0.84,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 6,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  targetPlatform: 'bilibili',
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
  maxDuration: 120,
});
assertNumberBetween(
  bilibiliLongContextPlan[0]?.platformReadinessScore,
  0.68,
  1,
  'Bilibili platform readiness tolerates longer complete context windows',
);
assertRule(
  ['ready', 'review'].includes(bilibiliLongContextPlan[0]?.platformReadinessGrade),
  `Bilibili long context slices remain reviewable instead of rejected (got ${JSON.stringify(bilibiliLongContextPlan[0]?.platformReadinessGrade)})`,
);

const xiaohongshuWeakHookPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 32000,
    label: 'Lifestyle context without a strong cover hook',
    qualityScore: 0.86,
    continuityScore: 0.9,
    storyShape: 'complete',
    publishabilityScore: 0.86,
    boundaryQualityScore: 0.68,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.94,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  targetPlatform: 'xiaohongshu',
  sliceCountMode: 'qualityFirst',
  targetSliceCount: 1,
});
assertArrayIncludes(
  xiaohongshuWeakHookPlan[0]?.platformReadinessIssues,
  'platform-hook-not-strong',
  'Xiaohongshu readiness requires a strong opening hook for cover-feed publishing',
);
assertRule(
  ['review', 'reject'].includes(xiaohongshuWeakHookPlan[0]?.platformReadinessGrade),
  `Xiaohongshu contextual-hook slices require review before publishing (got ${JSON.stringify(xiaohongshuWeakHookPlan[0]?.platformReadinessGrade)})`,
);

const weakBoundaryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The team talked through a few implementation details', speaker: 'Speaker 1' },
  { startMs: 12200, endMs: 24500, text: 'and there were still unresolved tradeoffs before the next section', speaker: 'Speaker 1' },
]);
assertEqual(
  weakBoundaryCandidates[0]?.hookStrength,
  'weak',
  'speech-to-text candidate scoring detects weak openings that are poor self-media hooks',
);
assertEqual(
  weakBoundaryCandidates[0]?.endingCompleteness,
  'open',
  'speech-to-text candidate scoring detects open endings that need review before publishing',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.publishabilityIssues,
  'weak-hook',
  'weak-boundary transcript candidates surface weak opening publishability issues',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.publishabilityIssues,
  'open-ending',
  'weak-boundary transcript candidates surface open ending publishability issues',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.contentArcMissingStages,
  'hook',
  'weak-boundary transcript candidates surface missing hook content-arc stages',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.contentArcMissingStages,
  'payoff',
  'weak-boundary transcript candidates surface missing payoff content-arc stages',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.publishabilityIssues,
  'missing-content-payoff',
  'weak-boundary transcript candidates include content-arc publishability issue tags',
);

const policy = getVideoSlicePlanningPolicy({
  ...baseParams,
  targetPlatform: 'douyin',
  targetAspectRatio: '9:16',
  videoObjectFit: 'cover',
  sliceCountMode: 'fixed',
  targetSliceCount: 4,
  idealDuration: 42,
  continuityLevel: 'strict',
  customKeywords: ['hook', 'retention', 'retention'],
});
assertEqual(policy.targetPlatform, 'douyin', 'planning policy preserves the target publishing platform');
assertEqual(policy.targetAspectRatio, '9:16', 'planning policy preserves the target aspect ratio');
assertEqual(policy.videoObjectFit, 'cover', 'planning policy preserves the target object-fit behavior');
assertEqual(policy.sliceCountMode, 'fixed', 'planning policy preserves the target count mode');
assertEqual(policy.targetSliceCount, 4, 'planning policy preserves the validated target slice count');
assertEqual(policy.idealDurationMs, 42000, 'planning policy normalizes the ideal duration to milliseconds');
assertEqual(policy.continuityJoinGapMs, 800, 'strict continuity policy uses a tighter transcript join gap');
assertEqual(policy.customKeywords.length, 2, 'planning policy trims and deduplicates custom keywords');
assertEqual(
  getVideoSlicePlanningPolicy({ ...baseParams, sourceDurationMs: 35000 }).sourceDurationMs,
  35000,
  'planning policy carries the source media duration into deterministic slice normalization',
);

const platformDefaultPolicy = getVideoSlicePlanningPolicy({
  ...baseParams,
  targetPlatform: 'douyin',
  targetAspectRatio: 'auto',
});
assertEqual(
  platformDefaultPolicy.targetAspectRatio,
  '9:16',
  'planning policy resolves auto aspect ratio to the target platform publishing standard',
);

const noTranscriptLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 40000, durationMs: 999999, label: 'Late' },
    { startMs: 0, durationMs: 1000, label: 'Short' },
  ]),
  baseParams,
  deterministicPlan,
);
assertEqual(noTranscriptLlmPlan.length, 5, 'no-transcript LLM plans fill to the bounded fallback count');
assertEqual(noTranscriptLlmPlan[0]?.startMs, 0, 'no-transcript LLM plans sort by start time');
assertEqual(noTranscriptLlmPlan[0]?.durationMs, 15000, 'no-transcript LLM plans clamp short clips to the minimum');
assertEqual(noTranscriptLlmPlan[2]?.startMs, 40000, 'no-transcript LLM plans preserve late candidate timing after safe filler');
assertEqual(noTranscriptLlmPlan[2]?.durationMs, 60000, 'no-transcript LLM plans clamp long clips to the maximum');
assertRule(
  noTranscriptLlmPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
  ),
  'no-transcript LLM plans are non-overlapping',
);
assertArrayIncludes(
  noTranscriptLlmPlan[0]?.risks,
  'llm-timing-without-transcript',
  'no-transcript LLM plans warn that the first accepted LLM timing is not speech-to-text aligned',
);
assertArrayIncludes(
  noTranscriptLlmPlan[2]?.risks,
  'llm-timing-without-transcript',
  'no-transcript LLM plans warn that later accepted LLM timings are not speech-to-text aligned',
);
assertArrayIncludes(
  noTranscriptLlmPlan[1]?.risks,
  'no-transcript-boundary',
  'no-transcript LLM gap filler clips retain deterministic fallback boundary warnings',
);
assertArrayIncludes(
  noTranscriptLlmPlan[3]?.risks,
  'no-transcript-boundary',
  'no-transcript LLM filler clips retain deterministic fallback boundary warnings',
);

const punctuationOnlyLlmTitlePlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 0, durationMs: 15000, title: '???', label: '...' },
  ]),
  {
    ...baseParams,
    sliceCountMode: 'qualityFirst',
    targetSliceCount: 1,
  },
  deterministicPlan,
);
assertRule(
  !/^[^\p{L}\p{N}]+$/u.test(punctuationOnlyLlmTitlePlan[0]?.label ?? ''),
  'LLM parsing never emits punctuation-only clip labels for task display or native output naming',
);
assertRule(
  !/^[^\p{L}\p{N}]+$/u.test(punctuationOnlyLlmTitlePlan[0]?.title ?? ''),
  'LLM parsing never emits punctuation-only clip titles for generated file names',
);
assertEqual(
  punctuationOnlyLlmTitlePlan[0]?.label,
  'Smart slice 1',
  'LLM parsing falls back to stable semantic labels when model titles contain no words',
);

const dirtyLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 0, durationMs: -20000, label: 'Negative duration' },
    { startMs: 15000, endMs: 15000, label: 'Zero duration by endMs' },
    { startMs: 'bad', durationMs: 15000, label: 'Invalid start' },
    { startMs: 30000, durationMs: 18000, label: 'Valid after dirty candidates' },
  ]),
  {
    ...baseParams,
    sliceCountMode: 'qualityFirst',
    targetSliceCount: 1,
  },
  deterministicPlan,
);
assertEqual(
  dirtyLlmPlan[0]?.label,
  'Valid after dirty candidates',
  'LLM parsing skips invalid timing candidates before applying the target slice limit',
);
assertEqual(
  dirtyLlmPlan[0]?.startMs,
  30000,
  'LLM parsing does not turn negative or zero durations into publishable minimum-duration clips',
);
assertArrayIncludes(
  dirtyLlmPlan[0]?.risks,
  'llm-timing-without-transcript',
  'LLM parsing keeps accepted dirty-output survivors marked as non transcript-aligned',
);

const sourceBoundedLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 40000, durationMs: 20000, label: 'Outside source' },
    { startMs: 0, durationMs: 15000, label: 'Inside source' },
  ]),
  {
    ...baseParams,
    targetSliceCount: 5,
    sourceDurationMs: 32000,
  },
  sourceBoundedDeterministicPlan,
);
assertRule(
  sourceBoundedLlmPlan.every((clip) => clip.startMs + clip.durationMs <= 32000),
  'source-duration-aware LLM plans never pass out-of-range clips to native rendering',
);
assertRule(
  !sourceBoundedLlmPlan.some((clip) => clip.label === 'Outside source'),
  'source-duration-aware LLM plans drop clips that start after the real media duration',
);
assertEqual(
  sourceBoundedLlmPlan.at(-1)?.sourceEndMs,
  30000,
  'source-duration-aware LLM plans stop filler generation before an unpublishably short final tail',
);

if (failures.length > 0) {
  console.error('AutoCut slicer planner check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`AutoCut slicer planner check passed (${pass.length} checks).`);
}
