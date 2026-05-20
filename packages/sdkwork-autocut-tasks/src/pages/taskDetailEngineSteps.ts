import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  isAutoCutTaskActiveStatus,
  type AppTask,
} from '@sdkwork/autocut-types';

export type SmartSliceTaskDetailEngine =
  | 'talking-head-semantic'
  | 'speech-semantic'
  | 'dialogue-qa'
  | 'meeting-agenda'
  | 'commerce-live'
  | 'performance-moment'
  | 'visual-scene'
  | 'generic-transcript-assisted'
  | 'legacy-video-slice';

export type TaskDetailEngineFlowStepId =
  | 'prepare-source'
  | 'recognize-speech'
  | 'understand-content'
  | 'structure-dialogue'
  | 'extract-decisions'
  | 'find-selling-points'
  | 'find-highlights'
  | 'collect-visual-evidence'
  | 'understand-scenes'
  | 'deduplicate-clips'
  | 'review-clips'
  | 'slice-video'
  | 'export-results';

export type TaskDetailEngineFlowStepStatus =
  | 'completed'
  | 'running'
  | 'action-required'
  | 'blocked'
  | 'failed'
  | 'upcoming';

export type TaskDetailEngineFlowMetricTone = 'neutral' | 'info' | 'success' | 'warning';

export interface TaskDetailEngineFlowStepDefinition {
  id: TaskDetailEngineFlowStepId;
  labelKey: string;
  descriptionKey: string;
  sourceStepIds: string[];
  evidenceKeys: string[];
}

export interface TaskDetailEngineFlowStep extends TaskDetailEngineFlowStepDefinition {
  status: TaskDetailEngineFlowStepStatus;
  progress: number;
}

export interface TaskDetailEngineFlowMetric {
  id: 'clips' | 'selected' | 'transcript' | 'outputs';
  labelKey: string;
  value: string;
  tone: TaskDetailEngineFlowMetricTone;
}

export interface TaskDetailEngineFlowSummary {
  engine: SmartSliceTaskDetailEngine;
  steps: TaskDetailEngineFlowStep[];
  currentStepId: TaskDetailEngineFlowStepId | null;
  progress: number;
  metrics: TaskDetailEngineFlowMetric[];
  sourceName: string;
}

type TaskExecutionLog = NonNullable<AppTask['executionLogs']>[number];

export type EngineStepStatus =
  | 'not-started'
  | 'running'
  | 'ready-for-review'
  | 'needs-user-action'
  | 'completed'
  | 'warning'
  | 'blocked'
  | 'failed'
  | 'stale';

export type EngineStepCapability =
  | 'view-source'
  | 'view-transcript'
  | 'view-semantic-clips'
  | 'drag-clip-boundaries'
  | 'edit-transcript'
  | 'split-clip'
  | 'merge-clips'
  | 'select-clips'
  | 'render-selected'
  | 'inspect-artifacts'
  | 'open-review-workbench'
  | 'copy-evidence-path'
  | 'open-output-folder';

type SmartSliceEvidenceCheckpointStepId =
  | 'speech-to-text'
  | 'plan-clips'
  | 'human-review'
  | 'verify-artifacts';

export interface TaskDetailEngineStepDefinition {
  id: string;
  labelKey: string;
  descriptionKey: string;
  rawStepIds: string[];
  evidenceKeys: string[];
  requiredArtifacts?: string[];
  optionalArtifacts?: string[];
  capabilities: EngineStepCapability[];
  action?: 'open-review' | 'resume-task' | 'reprocess' | 'reveal-output';
}

export interface TaskDetailEngineEvidenceRow {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

export interface TaskDetailEngineStepViewModel extends TaskDetailEngineStepDefinition {
  status: EngineStepStatus;
  progress: number;
  evidenceRows: TaskDetailEngineEvidenceRow[];
  logs: TaskExecutionLog[];
  canSelect: boolean;
  disabledReason?: string;
}

export interface SmartSliceEvidenceArtifact {
  relativePath: string;
  artifactPath?: string;
  taskOutputDir?: string;
  byteSize?: number;
  contentSha256?: string;
}

export interface SmartSliceEvidenceInspectorRow {
  item: SmartSliceEvidencePackageItem;
  present: boolean;
  stepCompleted: boolean;
  summary: string;
  artifact?: SmartSliceEvidenceArtifact;
}

export interface SmartSliceEvidenceInspectorSummary {
  presentCount: number;
  missingCount: number;
  totalCount: number;
  completedStepCount: number;
  totalStepCount: number;
  speechSegmentCount: number;
  semanticClipCount: number;
  reviewSegmentCount: number;
  selectedSegmentCount: number;
  manualEditCount: number;
  renderedSliceCount: number;
}

export const SMART_SLICE_WORKFLOW_ID = 'smart-slice';

export const SMART_SLICE_EVIDENCE_STEP_IDS = [
  'speech-to-text',
  'plan-clips',
  'human-review',
  'verify-artifacts',
] as const satisfies ReadonlyArray<SmartSliceEvidenceCheckpointStepId>;

export const SMART_SLICE_EVIDENCE_PACKAGE_ITEMS = [
  {
    id: 'speech-to-text',
    title: 'Speech-to-text',
    stepId: 'speech-to-text',
    artifactKey: 'speechToTextEvidence',
    relativePath: 'evidence/speech-to-text.json',
    schema: 'smart-slice.speech-to-text.v1',
  },
  {
    id: 'semantic-segmentation',
    title: 'Semantic segmentation',
    stepId: 'plan-clips',
    artifactKey: 'semanticSegmentationEvidence',
    relativePath: 'evidence/semantic-segmentation.json',
    schema: 'smart-slice.semantic-segmentation.v1',
  },
  {
    id: 'review-session',
    title: 'Review session',
    stepId: 'human-review',
    artifactKey: 'reviewSessionEvidence',
    relativePath: 'evidence/review-session.json',
    schema: 'smart-slice.review-session.v1',
  },
  {
    id: 'manual-edits',
    title: 'Manual edits',
    stepId: 'human-review',
    artifactKey: 'manualEditsEvidence',
    relativePath: 'evidence/manual-edits.json',
    schema: 'smart-slice.manual-edits.v1',
  },
  {
    id: 'review-events',
    title: 'Review events',
    stepId: 'human-review',
    artifactKey: 'reviewEventsEvidence',
    relativePath: 'evidence/review-events.json',
    schema: 'smart-slice.review-events.v1',
  },
  {
    id: 'render-selection',
    title: 'Render selection',
    stepId: 'human-review',
    artifactKey: 'renderSelectionEvidence',
    relativePath: 'evidence/render-selection.json',
    schema: 'smart-slice.render-selection.v1',
  },
  {
    id: 'render-artifact-manifest',
    title: 'Render artifact manifest',
    stepId: 'verify-artifacts',
    artifactKey: 'renderArtifactManifestEvidence',
    relativePath: 'evidence/render-artifact-manifest.json',
    schema: 'smart-slice.render-artifact-manifest.v1',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  stepId: SmartSliceEvidenceCheckpointStepId;
  artifactKey: string;
  relativePath: string;
  schema: string;
}>;

export type SmartSliceEvidencePackageItem = (typeof SMART_SLICE_EVIDENCE_PACKAGE_ITEMS)[number];

const TASK_DETAIL_STEP_SOURCE_PREPARATION: TaskDetailEngineStepDefinition = {
  id: 'source-preparation',
  labelKey: 'taskDetail.engineSteps.step.sourcePreparation.label',
  descriptionKey: 'taskDetail.engineSteps.step.sourcePreparation.description',
  rawStepIds: ['prepare-source'],
  evidenceKeys: ['source', 'mediaProbe', 'sourceIdentity'],
  capabilities: ['view-source', 'inspect-artifacts'],
};

const TASK_DETAIL_STEP_SPEECH_RECOGNITION: TaskDetailEngineStepDefinition = {
  id: 'speech-recognition',
  labelKey: 'taskDetail.engineSteps.step.speechRecognition.label',
  descriptionKey: 'taskDetail.engineSteps.step.speechRecognition.description',
  rawStepIds: ['speech-to-text'],
  evidenceKeys: ['transcriptSegments', 'speechToTextEvidence'],
  requiredArtifacts: ['speechToTextEvidence'],
  capabilities: ['view-transcript', 'copy-evidence-path'],
};

const TASK_DETAIL_STEP_CONTENT_UNDERSTANDING_SEGMENTATION: TaskDetailEngineStepDefinition = {
  id: 'content-understanding-segmentation',
  labelKey: 'taskDetail.engineSteps.step.contentUnderstandingSegmentation.label',
  descriptionKey: 'taskDetail.engineSteps.step.contentUnderstandingSegmentation.description',
  rawStepIds: ['plan-clips'],
  evidenceKeys: ['plannedClips', 'semanticSegmentationEvidence', 'contentUnitIds', 'storyShape'],
  requiredArtifacts: ['semanticSegmentationEvidence'],
  capabilities: ['view-source', 'view-transcript', 'view-semantic-clips', 'open-review-workbench'],
};

const TASK_DETAIL_STEP_TIMELINE_REFINEMENT: TaskDetailEngineStepDefinition = {
  id: 'timeline-refinement',
  labelKey: 'taskDetail.engineSteps.step.timelineRefinement.label',
  descriptionKey: 'taskDetail.engineSteps.step.timelineRefinement.description',
  rawStepIds: ['analyze-audio-boundaries', 'human-review'],
  evidenceKeys: ['reviewSession', 'manualEditsEvidence', 'audioActivityStartMs', 'audioActivityEndMs'],
  requiredArtifacts: ['reviewSessionEvidence'],
  optionalArtifacts: ['manualEditsEvidence'],
  capabilities: ['view-source', 'view-transcript', 'view-semantic-clips', 'drag-clip-boundaries', 'split-clip', 'merge-clips', 'open-review-workbench'],
  action: 'open-review',
};

const TASK_DETAIL_STEP_PUBLISHING_REVIEW: TaskDetailEngineStepDefinition = {
  id: 'publishing-review',
  labelKey: 'taskDetail.engineSteps.step.publishingReview.label',
  descriptionKey: 'taskDetail.engineSteps.step.publishingReview.description',
  rawStepIds: ['human-review', 'analyze-duplicates'],
  evidenceKeys: ['reviewSession', 'selectedSegmentIds', 'duplicateGroups', 'renderSelectionEvidence'],
  capabilities: ['select-clips', 'edit-transcript', 'open-review-workbench'],
  action: 'open-review',
};

const TASK_DETAIL_STEP_NATIVE_RENDER: TaskDetailEngineStepDefinition = {
  id: 'native-render',
  labelKey: 'taskDetail.engineSteps.step.nativeRender.label',
  descriptionKey: 'taskDetail.engineSteps.step.nativeRender.description',
  rawStepIds: ['native-render', 'persist-results'],
  evidenceKeys: ['sliceResults', 'renderSelectionEvidence'],
  capabilities: ['render-selected', 'open-output-folder'],
  action: 'reveal-output',
};

const TASK_DETAIL_STEP_ARTIFACT_VERIFICATION: TaskDetailEngineStepDefinition = {
  id: 'artifact-verification',
  labelKey: 'taskDetail.engineSteps.step.artifactVerification.label',
  descriptionKey: 'taskDetail.engineSteps.step.artifactVerification.description',
  rawStepIds: ['verify-artifacts', 'persist-results'],
  evidenceKeys: ['renderArtifactManifestEvidence', 'sliceResults'],
  requiredArtifacts: ['renderArtifactManifestEvidence'],
  capabilities: ['inspect-artifacts', 'open-output-folder', 'copy-evidence-path'],
};

export const TASK_DETAIL_ENGINE_STEP_DEFINITIONS: Record<
  SmartSliceTaskDetailEngine,
  readonly TaskDetailEngineStepDefinition[]
> = {
  'talking-head-semantic': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    TASK_DETAIL_STEP_CONTENT_UNDERSTANDING_SEGMENTATION,
    TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'speech-semantic': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    TASK_DETAIL_STEP_CONTENT_UNDERSTANDING_SEGMENTATION,
    TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'generic-transcript-assisted': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    TASK_DETAIL_STEP_CONTENT_UNDERSTANDING_SEGMENTATION,
    TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'dialogue-qa': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    {
      id: 'speaker-identification',
      labelKey: 'taskDetail.engineSteps.step.speakerIdentification.label',
      descriptionKey: 'taskDetail.engineSteps.step.speakerIdentification.description',
      rawStepIds: ['speech-to-text', 'plan-clips'],
      evidenceKeys: ['speakerIds', 'speakerRoles', 'transcriptSegments'],
      capabilities: ['view-transcript', 'view-semantic-clips'],
    },
    {
      id: 'qa-unit-understanding',
      labelKey: 'taskDetail.engineSteps.step.qaUnitUnderstanding.label',
      descriptionKey: 'taskDetail.engineSteps.step.qaUnitUnderstanding.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['contentUnitIds', 'speakerRoles', 'semanticSegmentationEvidence'],
      capabilities: ['view-source', 'view-transcript', 'view-semantic-clips'],
    },
    {
      ...TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
      id: 'qa-boundary-refinement',
      labelKey: 'taskDetail.engineSteps.step.qaBoundaryRefinement.label',
      descriptionKey: 'taskDetail.engineSteps.step.qaBoundaryRefinement.description',
    },
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'meeting-agenda': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    {
      id: 'speaker-topic-identification',
      labelKey: 'taskDetail.engineSteps.step.speakerTopicIdentification.label',
      descriptionKey: 'taskDetail.engineSteps.step.speakerTopicIdentification.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['speakerRoles', 'topicKeywords', 'contentUnitIds'],
      capabilities: ['view-transcript', 'view-semantic-clips'],
    },
    {
      id: 'decision-action-segmentation',
      labelKey: 'taskDetail.engineSteps.step.decisionActionSegmentation.label',
      descriptionKey: 'taskDetail.engineSteps.step.decisionActionSegmentation.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['semanticSegmentationEvidence', 'contentUnitIds', 'speakerRoles'],
      capabilities: ['view-source', 'view-transcript', 'view-semantic-clips'],
    },
    {
      ...TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
      id: 'decision-context-boundary-refinement',
      labelKey: 'taskDetail.engineSteps.step.decisionContextBoundaryRefinement.label',
      descriptionKey: 'taskDetail.engineSteps.step.decisionContextBoundaryRefinement.description',
    },
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'commerce-live': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    {
      id: 'product-selling-point-identification',
      labelKey: 'taskDetail.engineSteps.step.productSellingPointIdentification.label',
      descriptionKey: 'taskDetail.engineSteps.step.productSellingPointIdentification.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['topicKeywords', 'contentUnitIds', 'semanticSegmentationEvidence'],
      capabilities: ['view-transcript', 'view-semantic-clips'],
    },
    {
      id: 'conversion-segmentation',
      labelKey: 'taskDetail.engineSteps.step.conversionSegmentation.label',
      descriptionKey: 'taskDetail.engineSteps.step.conversionSegmentation.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['semanticSegmentationEvidence', 'publishabilityScore', 'platformReadinessScore'],
      capabilities: ['view-source', 'view-transcript', 'view-semantic-clips'],
    },
    {
      ...TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
      id: 'sales-script-boundary-refinement',
      labelKey: 'taskDetail.engineSteps.step.salesScriptBoundaryRefinement.label',
      descriptionKey: 'taskDetail.engineSteps.step.salesScriptBoundaryRefinement.description',
    },
    {
      id: 'repeated-script-deduplication',
      labelKey: 'taskDetail.engineSteps.step.repeatedScriptDeduplication.label',
      descriptionKey: 'taskDetail.engineSteps.step.repeatedScriptDeduplication.description',
      rawStepIds: ['analyze-duplicates', 'human-review'],
      evidenceKeys: ['duplicateGroups', 'smartDedupReport'],
      capabilities: ['select-clips', 'open-review-workbench'],
      action: 'open-review',
    },
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'performance-moment': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    TASK_DETAIL_STEP_SPEECH_RECOGNITION,
    {
      id: 'highlight-moment-identification',
      labelKey: 'taskDetail.engineSteps.step.highlightMomentIdentification.label',
      descriptionKey: 'taskDetail.engineSteps.step.highlightMomentIdentification.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['semanticSegmentationEvidence', 'qualityScore', 'continuityScore'],
      capabilities: ['view-source', 'view-semantic-clips'],
    },
    {
      ...TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
      id: 'moment-boundary-refinement',
      labelKey: 'taskDetail.engineSteps.step.momentBoundaryRefinement.label',
      descriptionKey: 'taskDetail.engineSteps.step.momentBoundaryRefinement.description',
    },
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'visual-scene': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    {
      id: 'visual-evidence-check',
      labelKey: 'taskDetail.engineSteps.step.visualEvidenceCheck.label',
      descriptionKey: 'taskDetail.engineSteps.step.visualEvidenceCheck.description',
      rawStepIds: ['prepare-source', 'plan-clips'],
      evidenceKeys: ['shotEvidence', 'ocrEvidence', 'motionEvidence', 'audioEventEvidence'],
      capabilities: ['view-source', 'inspect-artifacts'],
    },
    {
      id: 'speech-assisted-recognition',
      labelKey: 'taskDetail.engineSteps.step.speechAssistedRecognition.label',
      descriptionKey: 'taskDetail.engineSteps.step.speechAssistedRecognition.description',
      rawStepIds: ['speech-to-text'],
      evidenceKeys: ['transcriptSegments', 'speechToTextEvidence'],
      capabilities: ['view-transcript'],
    },
    {
      id: 'scene-understanding-segmentation',
      labelKey: 'taskDetail.engineSteps.step.sceneUnderstandingSegmentation.label',
      descriptionKey: 'taskDetail.engineSteps.step.sceneUnderstandingSegmentation.description',
      rawStepIds: ['plan-clips'],
      evidenceKeys: ['semanticSegmentationEvidence', 'visualSceneEvidence'],
      capabilities: ['view-source', 'view-semantic-clips'],
    },
    {
      ...TASK_DETAIL_STEP_TIMELINE_REFINEMENT,
      id: 'scene-boundary-refinement',
      labelKey: 'taskDetail.engineSteps.step.sceneBoundaryRefinement.label',
      descriptionKey: 'taskDetail.engineSteps.step.sceneBoundaryRefinement.description',
    },
    TASK_DETAIL_STEP_PUBLISHING_REVIEW,
    TASK_DETAIL_STEP_NATIVE_RENDER,
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
  'legacy-video-slice': [
    TASK_DETAIL_STEP_SOURCE_PREPARATION,
    {
      id: 'legacy-slicing',
      labelKey: 'taskDetail.engineSteps.step.legacySlicing.label',
      descriptionKey: 'taskDetail.engineSteps.step.legacySlicing.description',
      rawStepIds: ['plan-clips', 'native-render'],
      evidenceKeys: ['sliceResults'],
      capabilities: ['view-source', 'open-output-folder'],
    },
    TASK_DETAIL_STEP_ARTIFACT_VERIFICATION,
  ],
};

type JsonRecord = Record<string, unknown>;

export const TASK_DETAIL_ENGINE_FLOW_STEPS: Record<TaskDetailEngineFlowStepId, TaskDetailEngineFlowStepDefinition> = {
  'prepare-source': {
    id: 'prepare-source',
    labelKey: 'taskDetail.flow.step.prepareSource.label',
    descriptionKey: 'taskDetail.flow.step.prepareSource.description',
    sourceStepIds: ['prepare-source', 'probe-media'],
    evidenceKeys: ['source'],
  },
  'recognize-speech': {
    id: 'recognize-speech',
    labelKey: 'taskDetail.flow.step.recognizeSpeech.label',
    descriptionKey: 'taskDetail.flow.step.recognizeSpeech.description',
    sourceStepIds: ['speech-to-text', 'build-transcript-index'],
    evidenceKeys: ['transcript'],
  },
  'understand-content': {
    id: 'understand-content',
    labelKey: 'taskDetail.flow.step.understandContent.label',
    descriptionKey: 'taskDetail.flow.step.understandContent.description',
    sourceStepIds: ['plan-clips', 'content-understanding-segmentation', 'generate-clips'],
    evidenceKeys: ['clips'],
  },
  'structure-dialogue': {
    id: 'structure-dialogue',
    labelKey: 'taskDetail.flow.step.structureDialogue.label',
    descriptionKey: 'taskDetail.flow.step.structureDialogue.description',
    sourceStepIds: ['plan-clips', 'speaker-diarization', 'dialogue-unit-segmentation', 'generate-clips'],
    evidenceKeys: ['clips', 'speaker'],
  },
  'extract-decisions': {
    id: 'extract-decisions',
    labelKey: 'taskDetail.flow.step.extractDecisions.label',
    descriptionKey: 'taskDetail.flow.step.extractDecisions.description',
    sourceStepIds: ['plan-clips', 'content-understanding-segmentation', 'generate-clips'],
    evidenceKeys: ['clips', 'topic'],
  },
  'find-selling-points': {
    id: 'find-selling-points',
    labelKey: 'taskDetail.flow.step.findSellingPoints.label',
    descriptionKey: 'taskDetail.flow.step.findSellingPoints.description',
    sourceStepIds: ['plan-clips', 'product-entity-extraction', 'generate-clips'],
    evidenceKeys: ['clips', 'commerce'],
  },
  'find-highlights': {
    id: 'find-highlights',
    labelKey: 'taskDetail.flow.step.findHighlights.label',
    descriptionKey: 'taskDetail.flow.step.findHighlights.description',
    sourceStepIds: ['plan-clips', 'content-understanding-segmentation', 'generate-clips'],
    evidenceKeys: ['clips'],
  },
  'collect-visual-evidence': {
    id: 'collect-visual-evidence',
    labelKey: 'taskDetail.flow.step.collectVisualEvidence.label',
    descriptionKey: 'taskDetail.flow.step.collectVisualEvidence.description',
    sourceStepIds: ['scene-detection', 'motion-audio-analysis'],
    evidenceKeys: ['visual'],
  },
  'understand-scenes': {
    id: 'understand-scenes',
    labelKey: 'taskDetail.flow.step.understandScenes.label',
    descriptionKey: 'taskDetail.flow.step.understandScenes.description',
    sourceStepIds: ['plan-clips', 'engine-analysis', 'generate-clips'],
    evidenceKeys: ['clips', 'visual'],
  },
  'deduplicate-clips': {
    id: 'deduplicate-clips',
    labelKey: 'taskDetail.flow.step.deduplicateClips.label',
    descriptionKey: 'taskDetail.flow.step.deduplicateClips.description',
    sourceStepIds: ['analyze-duplicates', 'refine-clips', 'human-review'],
    evidenceKeys: ['clips', 'duplicates'],
  },
  'review-clips': {
    id: 'review-clips',
    labelKey: 'taskDetail.flow.step.reviewClips.label',
    descriptionKey: 'taskDetail.flow.step.reviewClips.description',
    sourceStepIds: ['human-review', 'timeline-preview-edit', 'refine-clips'],
    evidenceKeys: ['clips', 'selection'],
  },
  'slice-video': {
    id: 'slice-video',
    labelKey: 'taskDetail.flow.step.sliceVideo.label',
    descriptionKey: 'taskDetail.flow.step.sliceVideo.description',
    sourceStepIds: ['plan-clips', 'native-render', 'render-clips'],
    evidenceKeys: ['outputs'],
  },
  'export-results': {
    id: 'export-results',
    labelKey: 'taskDetail.flow.step.exportResults.label',
    descriptionKey: 'taskDetail.flow.step.exportResults.description',
    sourceStepIds: ['native-render', 'render-clips', 'verify-artifacts', 'verify-clips', 'persist-results'],
    evidenceKeys: ['outputs'],
  },
};

export const TASK_DETAIL_ENGINE_FLOW_BY_ENGINE: Record<SmartSliceTaskDetailEngine, readonly TaskDetailEngineFlowStepId[]> = {
  'talking-head-semantic': ['prepare-source', 'recognize-speech', 'understand-content', 'review-clips', 'export-results'],
  'speech-semantic': ['prepare-source', 'recognize-speech', 'understand-content', 'review-clips', 'export-results'],
  'generic-transcript-assisted': ['prepare-source', 'recognize-speech', 'understand-content', 'review-clips', 'export-results'],
  'dialogue-qa': ['prepare-source', 'recognize-speech', 'structure-dialogue', 'review-clips', 'export-results'],
  'meeting-agenda': ['prepare-source', 'recognize-speech', 'extract-decisions', 'review-clips', 'export-results'],
  'commerce-live': ['prepare-source', 'recognize-speech', 'find-selling-points', 'deduplicate-clips', 'export-results'],
  'performance-moment': ['prepare-source', 'recognize-speech', 'find-highlights', 'review-clips', 'export-results'],
  'visual-scene': ['prepare-source', 'collect-visual-evidence', 'understand-scenes', 'review-clips', 'export-results'],
  'legacy-video-slice': ['prepare-source', 'slice-video', 'export-results'],
};

export function normalizeSmartSliceTaskDetailEngine(value: unknown): SmartSliceTaskDetailEngine | undefined {
  const engine = readTaskDetailString(value);
  switch (engine) {
    case 'talking-head-semantic':
    case 'speech-semantic':
    case 'dialogue-qa':
    case 'meeting-agenda':
    case 'commerce-live':
    case 'performance-moment':
    case 'visual-scene':
    case 'generic-transcript-assisted':
    case 'legacy-video-slice':
      return engine;
    case 'talking-head':
    case 'teacher-talking-head-single':
    case 'semantic-story-agent':
    case 'transcript-semantic-v2':
      return 'talking-head-semantic';
    case 'dialogue':
    case 'interview-one-question-one-answer':
    case 'long-interview-matrix':
    case 'dialogue-turn-agent':
    case 'dialogue-speaker-v1':
      return 'dialogue-qa';
    case 'meeting':
    case 'meeting-minutes-highlights':
      return 'meeting-agenda';
    case 'commerce':
    case 'commerce-live-product-cards':
    case 'commerce-live-v1':
      return 'commerce-live';
    case 'performance':
    case 'sports-highlight-reel':
    case 'gaming-highlight-reel':
    case 'music-beat-clips':
      return 'performance-moment';
    case 'film':
    case 'scene':
    case 'film-scene-index':
    case 'visual-scene-v1':
      return 'visual-scene';
    case 'general':
      return 'generic-transcript-assisted';
    default:
      return undefined;
  }
}

export function inferSmartSliceTaskDetailEngine(task: AppTask): SmartSliceTaskDetailEngine {
  const reviewSessionEngine = normalizeSmartSliceTaskDetailEngine(task.sliceReviewSession?.segmentationAgentId);
  if (reviewSessionEngine) {
    return reviewSessionEngine;
  }

  const checkpointParams = task.executionCheckpoint?.params;
  const checkpointEngine =
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(checkpointParams, 'taskDetailEngine')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(checkpointParams, 'mode')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(checkpointParams, 'presetId')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(checkpointParams, 'smartCutPresetId')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(checkpointParams, 'segmentationAgentId')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(readTaskDetailNestedRecord(checkpointParams, 'videoSlice'), 'mode')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(readTaskDetailNestedRecord(checkpointParams, 'videoSliceParams'), 'mode'));
  if (checkpointEngine) {
    return checkpointEngine;
  }

  const planArtifact = task.executionCheckpoint?.artifacts?.['plan-clips'];
  const planEngine =
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(planArtifact, 'taskDetailEngine')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(planArtifact, 'engine')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(planArtifact, 'mode')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(planArtifact, 'presetId')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(planArtifact, 'smartCutPresetId')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(planArtifact, 'segmentationAgentId')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(readTaskDetailNestedRecord(planArtifact, 'enginePlan'), 'engine')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(readTaskDetailNestedRecord(planArtifact, 'enginePlan'), 'mode')) ??
    normalizeSmartSliceTaskDetailEngine(readTaskDetailNestedString(readTaskDetailNestedRecord(planArtifact, 'semanticSegmentationEvidence'), 'engine'));
  if (planEngine) {
    return planEngine;
  }

  const sliceEvidenceEngine = task.sliceResults?.some((slice) =>
    slice.risks?.some((risk) => /dialogue|speaker|qa/iu.test(risk)) ||
    slice.topicKeywords?.some((keyword) => /dialogue|interview|question|answer|speaker|qa/iu.test(keyword))
  )
    ? 'dialogue-qa'
    : task.sliceResults?.some((slice) =>
        slice.topicKeywords?.some((keyword) => /product|sku|price|offer|coupon|sale|commerce|shop|selling|discount/iu.test(keyword))
      )
      ? 'commerce-live'
      : undefined;
  if (sliceEvidenceEngine) {
    return sliceEvidenceEngine;
  }

  if (task.sliceResults?.some((slice) =>
    slice.transcriptSegmentCount !== undefined ||
    slice.transcriptSegments?.length ||
    slice.transcriptText
  )) {
    return 'generic-transcript-assisted';
  }

  return task.executionCheckpoint?.workflowId === 'smart-slice'
    ? 'generic-transcript-assisted'
    : 'legacy-video-slice';
}

export function createTaskDetailEngineFlowSummary(
  task: AppTask,
  engine: SmartSliceTaskDetailEngine = inferSmartSliceTaskDetailEngine(task),
): TaskDetailEngineFlowSummary {
  const steps = TASK_DETAIL_ENGINE_FLOW_BY_ENGINE[engine].map((stepId) => {
    const definition = TASK_DETAIL_ENGINE_FLOW_STEPS[stepId];
    const status = resolveTaskDetailEngineFlowStepStatus(task, engine, definition);
    return {
      ...definition,
      status,
      progress: getTaskDetailEngineFlowStepProgress(task, definition, status),
    };
  });
  const currentStepId = resolveCurrentTaskDetailEngineFlowStepId(task, steps);
  return {
    engine,
    steps,
    currentStepId,
    progress: resolveTaskDetailEngineFlowProgress(task, steps),
    metrics: createTaskDetailEngineFlowMetrics(task),
    sourceName: resolveTaskDetailFlowSourceName(task),
  };
}

export function createTaskDetailEngineStepViewModels(
  task: AppTask,
  engine: SmartSliceTaskDetailEngine,
): TaskDetailEngineStepViewModel[] {
  const logs = task.executionLogs ?? [];
  return TASK_DETAIL_ENGINE_STEP_DEFINITIONS[engine].map((definition) => {
    const status = resolveTaskDetailEngineStepStatus(task, engine, definition);
    return {
      ...definition,
      status,
      progress: getTaskDetailEngineStepProgress(status, task, definition),
      evidenceRows: createTaskDetailEngineEvidenceRows(task, engine, definition),
      logs: logs.filter((log) => log.stepId && definition.rawStepIds.includes(log.stepId)),
      canSelect: true,
      ...(status === 'blocked'
        ? { disabledReason: 'Missing required visual evidence adapters for this engine.' }
        : {}),
    };
  });
}

export function getCurrentTaskDetailEngineStepId(
  task: AppTask,
  steps: readonly TaskDetailEngineStepViewModel[],
) {
  if (task.currentStepId) {
    const current = steps.find((step) => step.rawStepIds.includes(task.currentStepId ?? ''));
    if (current) {
      return current.id;
    }
  }

  const running = steps.find((step) => step.status === 'running');
  if (running) {
    return running.id;
  }
  const actionRequired = steps.find((step) => step.status === 'needs-user-action' || step.status === 'ready-for-review');
  if (actionRequired) {
    return actionRequired.id;
  }
  return [...steps].reverse().find((step) => step.status !== 'not-started')?.id ?? steps[0]?.id ?? null;
}

export function createSmartSliceEvidenceInspectorRows(task: AppTask): {
  rows: SmartSliceEvidenceInspectorRow[];
  summary: SmartSliceEvidenceInspectorSummary;
} {
  const completedStepIds = new Set(task.executionCheckpoint?.completedStepIds ?? []);
  const completedEvidenceStepCount = SMART_SLICE_EVIDENCE_STEP_IDS.filter((stepId) => completedStepIds.has(stepId)).length;
  const rows = SMART_SLICE_EVIDENCE_PACKAGE_ITEMS.map((item) => {
    const artifact = readSmartSliceEvidenceArtifact(task, item);
    const stepCompleted = completedStepIds.has(item.stepId);
    return {
      item,
      present: Boolean(artifact),
      stepCompleted,
      summary: createSmartSliceEvidenceRowSummary(task, item),
      ...(artifact ? { artifact } : {}),
    };
  });

  return {
    rows,
    summary: {
      presentCount: rows.filter((row) => row.present).length,
      missingCount: rows.filter((row) => !row.present).length,
      totalCount: rows.length,
      completedStepCount: completedEvidenceStepCount,
      totalStepCount: SMART_SLICE_EVIDENCE_STEP_IDS.length,
      speechSegmentCount: readSmartSliceSpeechSegmentCount(task),
      semanticClipCount: readSmartSliceSemanticClipCount(task),
      reviewSegmentCount: readSmartSliceReviewSessionSegmentCount(task),
      selectedSegmentCount: readSmartSliceReviewSessionSelectedCount(task),
      manualEditCount: readSmartSliceReviewSessionManualEditCount(task),
      renderedSliceCount: readSmartSliceRenderedSliceCount(task),
    },
  };
}

export function shouldRenderSmartSliceEvidenceInspector(task: AppTask) {
  if (task.type !== AUTOCUT_TASK_TYPE.videoSlice) {
    return false;
  }

  if (task.executionCheckpoint?.workflowId === SMART_SLICE_WORKFLOW_ID) {
    return true;
  }

  return createSmartSliceEvidenceInspectorRows(task).rows.some((row) => row.present);
}

function resolveTaskDetailEngineFlowStepStatus(
  task: AppTask,
  engine: SmartSliceTaskDetailEngine,
  definition: TaskDetailEngineFlowStepDefinition,
): TaskDetailEngineFlowStepStatus {
  const rawStatus = getTaskDetailFlowRawStepStatus(task, definition.sourceStepIds);
  if (rawStatus === 'failed' || (task.status === AUTOCUT_TASK_STATUS.failed && isCurrentFlowStep(task, definition))) {
    return 'failed';
  }
  if (engine === 'visual-scene' && definition.id === 'collect-visual-evidence' && !hasTaskDetailFlowEvidence(task, 'visual')) {
    return 'blocked';
  }
  if (rawStatus === 'running' || (isAutoCutTaskActiveStatus(task.status) && isCurrentFlowStep(task, definition))) {
    return 'running';
  }
  if (definition.id === 'review-clips' && task.status === AUTOCUT_TASK_STATUS.reviewing) {
    return 'action-required';
  }
  if (definition.id === 'deduplicate-clips' && task.status === AUTOCUT_TASK_STATUS.reviewing && task.sliceReviewSession) {
    return task.sliceReviewSession.duplicateGroups.length ? 'action-required' : 'completed';
  }
  if (definition.id === 'export-results' && task.status === AUTOCUT_TASK_STATUS.completed && getRenderedSliceCount(task) > 0) {
    return 'completed';
  }
  if (definition.evidenceKeys.some((key) => hasTaskDetailFlowEvidence(task, key))) {
    return 'completed';
  }
  if (rawStatus === 'completed') {
    return 'completed';
  }
  return 'upcoming';
}

function getTaskDetailEngineFlowStepProgress(
  task: AppTask,
  definition: TaskDetailEngineFlowStepDefinition,
  status: TaskDetailEngineFlowStepStatus,
) {
  if (status === 'completed') {
    return 100;
  }

  const rawSteps = task.executionSteps?.filter((step) => definition.sourceStepIds.includes(step.id)) ?? [];
  if (rawSteps.length > 0) {
    const averageProgress = rawSteps.reduce((sum, step) => sum + clampProgress(step.progress), 0) / rawSteps.length;
    return Math.round(averageProgress);
  }

  switch (status) {
    case 'action-required':
      return 90;
    case 'running':
      return Math.min(96, Math.max(8, clampProgress(task.progress)));
    case 'blocked':
    case 'failed':
    case 'upcoming':
    default:
      return 0;
  }
}

function resolveCurrentTaskDetailEngineFlowStepId(
  task: AppTask,
  steps: readonly TaskDetailEngineFlowStep[],
): TaskDetailEngineFlowStepId | null {
  if (task.currentStepId) {
    const current = steps.find((step) => step.sourceStepIds.includes(task.currentStepId ?? ''));
    if (current) {
      return current.id;
    }
  }

  return steps.find((step) => step.status === 'running')?.id ??
    steps.find((step) => step.status === 'action-required')?.id ??
    steps.find((step) => step.status === 'failed' || step.status === 'blocked')?.id ??
    steps.find((step) => step.status !== 'completed')?.id ??
    steps.at(-1)?.id ??
    null;
}

function resolveTaskDetailEngineFlowProgress(
  task: AppTask,
  steps: readonly TaskDetailEngineFlowStep[],
) {
  if (isAutoCutTaskActiveStatus(task.status) && Number.isFinite(task.progress)) {
    return clampProgress(task.progress);
  }
  if (steps.length === 0) {
    return 0;
  }
  return Math.round(steps.reduce((sum, step) => sum + step.progress, 0) / steps.length);
}

function createTaskDetailEngineFlowMetrics(task: AppTask): TaskDetailEngineFlowMetric[] {
  const clipCount = getPlannedClipCount(task);
  const selectedCount = getSelectedClipCount(task);
  const transcriptCount = getTranscriptSegmentCount(task);
  const outputCount = getRenderedSliceCount(task);
  return [
    {
      id: 'clips',
      labelKey: 'taskDetail.flow.metrics.clips',
      value: String(clipCount),
      tone: clipCount > 0 ? 'info' : 'neutral',
    },
    {
      id: 'selected',
      labelKey: 'taskDetail.flow.metrics.selected',
      value: String(selectedCount),
      tone: selectedCount > 0 ? 'success' : 'neutral',
    },
    {
      id: 'transcript',
      labelKey: 'taskDetail.flow.metrics.transcript',
      value: String(transcriptCount),
      tone: transcriptCount > 0 ? 'info' : 'neutral',
    },
    {
      id: 'outputs',
      labelKey: 'taskDetail.flow.metrics.outputs',
      value: String(outputCount || task.resultCount || 0),
      tone: outputCount > 0 || (task.resultCount ?? 0) > 0 ? 'success' : 'neutral',
    },
  ];
}

function getTaskDetailFlowRawStepStatus(task: AppTask, sourceStepIds: readonly string[]) {
  const matchedSteps = task.executionSteps?.filter((step) => sourceStepIds.includes(step.id)) ?? [];
  if (!matchedSteps.length) {
    return undefined;
  }
  if (matchedSteps.some((step) => step.status === 'failed')) {
    return 'failed' as const;
  }
  if (matchedSteps.some((step) => step.status === 'running' || step.status === 'cancelRequested')) {
    return 'running' as const;
  }
  if (matchedSteps.every((step) => step.status === 'completed' || step.status === 'skipped')) {
    return 'completed' as const;
  }
  return 'pending' as const;
}

function getTaskDetailEngineRawStepStatus(task: AppTask, definition: TaskDetailEngineStepDefinition) {
  const rawSteps = task.executionSteps ?? [];
  const matchedSteps = rawSteps.filter((step) => definition.rawStepIds.includes(step.id));
  if (!matchedSteps.length) {
    return undefined;
  }

  if (matchedSteps.some((step) => step.status === 'failed')) {
    return 'failed' as const;
  }
  if (matchedSteps.some((step) => step.status === 'running' || step.status === 'cancelRequested')) {
    return 'running' as const;
  }
  if (matchedSteps.some((step) => step.status === 'interrupted' || step.status === 'canceled')) {
    return 'interrupted' as const;
  }
  if (matchedSteps.every((step) => step.status === 'completed' || step.status === 'skipped')) {
    return 'completed' as const;
  }
  return 'pending' as const;
}

function hasTaskDetailEngineArtifact(task: AppTask, artifactKey: string) {
  if (artifactKey === 'source') {
    return Boolean(task.sourceFileId || task.executionCheckpoint?.source);
  }
  if (artifactKey === 'sliceResults') {
    return Boolean(task.sliceResults?.length);
  }
  if (artifactKey === 'reviewSession' || artifactKey === 'reviewSessionEvidence') {
    return Boolean(task.sliceReviewSession || readSmartSliceEvidenceArtifact(task, SMART_SLICE_EVIDENCE_PACKAGE_ITEMS[2]));
  }
  if (artifactKey === 'manualEditsEvidence') {
    return Boolean(readSmartSliceEvidenceArtifact(task, SMART_SLICE_EVIDENCE_PACKAGE_ITEMS[3]));
  }
  if (artifactKey === 'renderSelectionEvidence') {
    return Boolean(readSmartSliceEvidenceArtifact(task, SMART_SLICE_EVIDENCE_PACKAGE_ITEMS[5]));
  }
  if (artifactKey === 'renderArtifactManifestEvidence') {
    return Boolean(readSmartSliceEvidenceArtifact(task, SMART_SLICE_EVIDENCE_PACKAGE_ITEMS[6]));
  }
  if (artifactKey === 'speechToTextEvidence') {
    return Boolean(readSmartSliceEvidenceArtifact(task, SMART_SLICE_EVIDENCE_PACKAGE_ITEMS[0]));
  }
  if (artifactKey === 'semanticSegmentationEvidence') {
    return Boolean(readSmartSliceEvidenceArtifact(task, SMART_SLICE_EVIDENCE_PACKAGE_ITEMS[1]));
  }
  if (artifactKey === 'transcriptSegments') {
    return readSmartSliceSpeechSegmentCount(task) > 0 ||
      Boolean(task.sliceResults?.some((slice) => slice.transcriptSegments?.length || slice.transcriptSegmentCount));
  }
  if (artifactKey === 'plannedClips') {
    return readSmartSliceSemanticClipCount(task) > 0 || Boolean(task.sliceResults?.length || task.sliceReviewSession?.segments.length);
  }
  if (artifactKey === 'selectedSegmentIds') {
    return readSmartSliceReviewSessionSelectedCount(task) > 0;
  }
  if (artifactKey === 'duplicateGroups') {
    return Boolean(task.sliceReviewSession?.duplicateGroups.length);
  }
  if (artifactKey === 'smartDedupReport') {
    return Boolean(task.sliceReviewSession?.smartDedupReport);
  }
  if (artifactKey === 'visualSceneEvidence' || artifactKey === 'shotEvidence' || artifactKey === 'ocrEvidence' || artifactKey === 'motionEvidence' || artifactKey === 'audioEventEvidence') {
    return false;
  }

  return Boolean(task.sliceResults?.some((slice) => {
    const record = slice as unknown as Record<string, unknown>;
    return record[artifactKey] !== undefined &&
      (!Array.isArray(record[artifactKey]) || (record[artifactKey] as unknown[]).length > 0);
  }));
}

function resolveTaskDetailEngineStepStatus(
  task: AppTask,
  engine: SmartSliceTaskDetailEngine,
  definition: TaskDetailEngineStepDefinition,
): EngineStepStatus {
  if (
    engine === 'visual-scene' &&
    definition.id === 'visual-evidence-check' &&
    !definition.evidenceKeys.some((key) => hasTaskDetailEngineArtifact(task, key))
  ) {
    return 'blocked';
  }

  const rawStatus = getTaskDetailEngineRawStepStatus(task, definition);
  if (rawStatus === 'failed') {
    return 'failed';
  }
  if (rawStatus === 'running') {
    return 'running';
  }
  if (rawStatus === 'interrupted') {
    return 'stale';
  }

  const hasRequiredArtifacts = definition.requiredArtifacts?.every((key) => hasTaskDetailEngineArtifact(task, key)) ?? true;
  const hasAnyEvidence = definition.evidenceKeys.some((key) => hasTaskDetailEngineArtifact(task, key)) ||
    definition.rawStepIds.some((stepId) => task.executionCheckpoint?.completedStepIds?.includes(stepId));

  if (definition.id === 'timeline-refinement' && task.sliceReviewSession && task.status === AUTOCUT_TASK_STATUS.reviewing) {
    return 'needs-user-action';
  }
  if (definition.id === 'publishing-review' && task.sliceReviewSession && task.status === AUTOCUT_TASK_STATUS.reviewing) {
    return task.sliceReviewSession.selectedSegmentIds.length ? 'ready-for-review' : 'needs-user-action';
  }
  if (definition.id === 'native-render' && task.sliceReviewSession?.status === 'rendering') {
    return 'running';
  }
  if (definition.id === 'native-render' && task.sliceResults?.length) {
    return 'completed';
  }
  if (definition.id === 'artifact-verification' && task.status === AUTOCUT_TASK_STATUS.completed && task.sliceResults?.length && !hasRequiredArtifacts) {
    return 'warning';
  }

  if (rawStatus === 'completed' && hasRequiredArtifacts) {
    return 'completed';
  }
  if (hasAnyEvidence && hasRequiredArtifacts) {
    return 'completed';
  }
  if (hasAnyEvidence) {
    return 'warning';
  }
  return 'not-started';
}

function getTaskDetailEngineStepProgress(status: EngineStepStatus, task: AppTask, definition: TaskDetailEngineStepDefinition) {
  const rawSteps = task.executionSteps?.filter((step) => definition.rawStepIds.includes(step.id)) ?? [];
  if (rawSteps.length) {
    const averageProgress = rawSteps.reduce((sum, step) => sum + Math.min(100, Math.max(0, step.progress || 0)), 0) / rawSteps.length;
    return Math.round(averageProgress);
  }

  switch (status) {
    case 'completed':
    case 'ready-for-review':
      return 100;
    case 'needs-user-action':
    case 'warning':
      return 88;
    case 'running':
      return Math.min(99, Math.max(8, Math.round(task.progress || 0)));
    case 'failed':
    case 'blocked':
    case 'stale':
      return 0;
    case 'not-started':
    default:
      return 0;
  }
}

function createTaskDetailEngineEvidenceRows(
  task: AppTask,
  engine: SmartSliceTaskDetailEngine,
  definition: TaskDetailEngineStepDefinition,
): TaskDetailEngineEvidenceRow[] {
  const rows: TaskDetailEngineEvidenceRow[] = [];
  if (definition.id === 'source-preparation') {
    rows.push({
      id: 'source',
      label: 'Source',
      value: task.executionCheckpoint?.source?.fileName ?? task.executionCheckpoint?.source?.sourcePath ?? task.sourceFileId ?? '--',
      tone: task.executionCheckpoint?.source || task.sourceFileId ? 'success' : 'neutral',
    });
  }
  if (definition.capabilities.includes('view-transcript')) {
    rows.push({
      id: 'transcript',
      label: 'Transcript',
      value: `${readSmartSliceSpeechSegmentCount(task) || task.sliceResults?.reduce((sum, slice) => sum + (slice.transcriptSegmentCount ?? slice.transcriptSegments?.length ?? 0), 0) || 0} segments`,
      tone: hasTaskDetailEngineArtifact(task, 'transcriptSegments') ? 'success' : 'neutral',
    });
  }
  if (definition.capabilities.includes('view-semantic-clips')) {
    rows.push({
      id: 'clips',
      label: 'Clips',
      value: `${task.sliceReviewSession?.segments.length ?? task.sliceResults?.length ?? readSmartSliceSemanticClipCount(task)} candidates`,
      tone: task.sliceReviewSession?.segments.length || task.sliceResults?.length ? 'success' : 'neutral',
    });
  }
  if (definition.capabilities.includes('drag-clip-boundaries')) {
    rows.push({
      id: 'manual-edits',
      label: 'Manual edits',
      value: `${task.sliceReviewSession?.manualEdits.length ?? readSmartSliceReviewSessionManualEditCount(task)} edits`,
      tone: task.sliceReviewSession?.manualEdits.length ? 'info' : 'neutral',
    });
  }
  if (definition.id === 'visual-evidence-check' && engine === 'visual-scene') {
    rows.push({
      id: 'visual-adapter',
      label: 'Visual adapter',
      value: 'Shot/OCR/motion evidence unavailable',
      tone: 'warning',
    });
  }
  if (definition.id === 'native-render' || definition.id === 'artifact-verification') {
    rows.push({
      id: 'rendered',
      label: 'Rendered',
      value: `${readSmartSliceRenderedSliceCount(task)} slices`,
      tone: readSmartSliceRenderedSliceCount(task) > 0 ? 'success' : 'neutral',
    });
  }

  return rows;
}

function isCurrentFlowStep(task: AppTask, definition: TaskDetailEngineFlowStepDefinition) {
  return Boolean(task.currentStepId && definition.sourceStepIds.includes(task.currentStepId));
}

function hasTaskDetailFlowEvidence(task: AppTask, evidenceKey: string) {
  switch (evidenceKey) {
    case 'source':
      return Boolean(task.sourceFileId || task.executionCheckpoint?.source);
    case 'transcript':
      return getTranscriptSegmentCount(task) > 0 || Boolean(task.transcriptText?.trim());
    case 'clips':
      return getPlannedClipCount(task) > 0;
    case 'selection':
      return getSelectedClipCount(task) > 0;
    case 'outputs':
      return getRenderedSliceCount(task) > 0 || (task.resultCount ?? 0) > 0;
    case 'duplicates':
      return Boolean(task.sliceReviewSession?.duplicateGroups.length);
    case 'speaker':
      return Boolean(task.sliceResults?.some((slice) => slice.risks?.some((risk) => /speaker|dialogue|qa/iu.test(risk))));
    case 'topic':
      return Boolean(task.sliceResults?.some((slice) => slice.topicKeywords?.length));
    case 'commerce':
      return Boolean(task.sliceResults?.some((slice) =>
        slice.topicKeywords?.some((keyword) => /product|sku|price|offer|coupon|sale|commerce|shop|selling|discount/iu.test(keyword))
      ));
    case 'visual':
      return hasCheckpointArtifact(task, 'visualEvidence') ||
        hasCheckpointArtifact(task, 'visualSceneEvidence') ||
        hasCheckpointArtifact(task, 'shotEvidence') ||
        hasCheckpointArtifact(task, 'ocrEvidence') ||
        hasCheckpointArtifact(task, 'motionEvidence') ||
        hasCheckpointArtifact(task, 'audioEventEvidence');
    default:
      return false;
  }
}

function hasCheckpointArtifact(task: AppTask, key: string) {
  const artifacts = task.executionCheckpoint?.artifacts;
  if (!artifacts) {
    return false;
  }
  return artifacts[key] !== undefined ||
    Object.values(artifacts).some((artifact) => {
      const record = readTaskDetailRecord(artifact);
      return record ? record[key] !== undefined : false;
    });
}

function getTranscriptSegmentCount(task: AppTask) {
  return task.transcriptSegmentCount ??
    task.transcriptSegments?.length ??
    task.sliceReviewSession?.segments.reduce((sum, segment) => sum + (segment.transcriptSegments?.length ?? 0), 0) ??
    task.sliceResults?.reduce((sum, slice) => sum + (slice.transcriptSegmentCount ?? slice.transcriptSegments?.length ?? 0), 0) ??
    0;
}

function getPlannedClipCount(task: AppTask) {
  return task.sliceReviewSession?.segments.length ?? task.sliceResults?.length ?? 0;
}

function getSelectedClipCount(task: AppTask) {
  return task.sliceReviewSession?.selectedSegmentIds.length ?? task.sliceResults?.length ?? 0;
}

function getRenderedSliceCount(task: AppTask) {
  return task.sliceResults?.length ?? 0;
}

function resolveTaskDetailFlowSourceName(task: AppTask) {
  return task.executionCheckpoint?.source?.fileName ??
    task.executionCheckpoint?.source?.sourcePath?.split(/[\\/]/u).filter(Boolean).at(-1) ??
    task.sourceFileId ??
    task.name;
}

function clampProgress(progress: number | undefined) {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function readTaskDetailString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTaskDetailRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function readTaskDetailNestedRecord(value: unknown, key: string) {
  return readTaskDetailRecord(value)?.[key] as JsonRecord | undefined;
}

function readTaskDetailNestedString(value: unknown, key: string) {
  return readTaskDetailString(readTaskDetailRecord(value)?.[key]);
}

function readTaskDetailFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function countTaskDetailArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function readSmartSliceCheckpointStepArtifact(
  task: AppTask,
  stepId: SmartSliceEvidenceCheckpointStepId,
) {
  const stepArtifact = task.executionCheckpoint?.artifacts[stepId];
  return readTaskDetailRecord(stepArtifact);
}

function readSmartSliceEvidenceArtifact(
  task: AppTask,
  item: SmartSliceEvidencePackageItem,
): SmartSliceEvidenceArtifact | undefined {
  const stepArtifact = readSmartSliceCheckpointStepArtifact(task, item.stepId);
  const artifact = readTaskDetailRecord(stepArtifact?.[item.artifactKey]);
  if (!artifact) {
    return undefined;
  }

  const relativePath = readTaskDetailString(artifact.relativePath) ?? item.relativePath;
  const artifactPath = readTaskDetailString(artifact.artifactPath);
  const taskOutputDir = readTaskDetailString(artifact.taskOutputDir);
  const byteSize = readTaskDetailFiniteNumber(artifact.byteSize);
  const contentSha256 = readTaskDetailString(artifact.contentSha256);

  return {
    relativePath,
    ...(artifactPath ? { artifactPath } : {}),
    ...(taskOutputDir ? { taskOutputDir } : {}),
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
  };
}

function readSmartSliceReviewSessionSegmentCount(task: AppTask) {
  if (task.sliceReviewSession) {
    return task.sliceReviewSession.segments.length;
  }

  const humanReviewArtifact = readSmartSliceCheckpointStepArtifact(task, 'human-review');
  const reviewSession = readTaskDetailRecord(humanReviewArtifact?.reviewSession);
  return reviewSession ? countTaskDetailArray(reviewSession.segments) : 0;
}

function readSmartSliceReviewSessionSelectedCount(task: AppTask) {
  if (task.sliceReviewSession) {
    return task.sliceReviewSession.selectedSegmentIds.length;
  }

  const humanReviewArtifact = readSmartSliceCheckpointStepArtifact(task, 'human-review');
  const reviewSession = readTaskDetailRecord(humanReviewArtifact?.reviewSession);
  return reviewSession ? countTaskDetailArray(reviewSession.selectedSegmentIds) : 0;
}

function readSmartSliceReviewSessionManualEditCount(task: AppTask) {
  if (task.sliceReviewSession) {
    return task.sliceReviewSession.manualEdits.length;
  }

  const humanReviewArtifact = readSmartSliceCheckpointStepArtifact(task, 'human-review');
  const reviewSession = readTaskDetailRecord(humanReviewArtifact?.reviewSession);
  return reviewSession ? countTaskDetailArray(reviewSession.manualEdits) : 0;
}

function readSmartSliceSpeechSegmentCount(task: AppTask) {
  const speechArtifact = readSmartSliceCheckpointStepArtifact(task, 'speech-to-text');
  return countTaskDetailArray(speechArtifact?.transcriptSegments);
}

function readSmartSliceSemanticClipCount(task: AppTask) {
  const planArtifact = readSmartSliceCheckpointStepArtifact(task, 'plan-clips');
  return countTaskDetailArray(planArtifact?.plannedClips);
}

function readSmartSliceRenderedSliceCount(task: AppTask) {
  if (task.sliceResults?.length) {
    return task.sliceResults.length;
  }

  const verifyArtifact = readSmartSliceCheckpointStepArtifact(task, 'verify-artifacts');
  return countTaskDetailArray(verifyArtifact?.sliceResults);
}

function createSmartSliceEvidenceRowSummary(task: AppTask, item: SmartSliceEvidencePackageItem) {
  switch (item.id) {
    case 'speech-to-text':
      return `${readSmartSliceSpeechSegmentCount(task)} speech segments`;
    case 'semantic-segmentation':
      return `${readSmartSliceSemanticClipCount(task)} semantic clips`;
    case 'review-session':
      return `${readSmartSliceReviewSessionSegmentCount(task)} review segments`;
    case 'manual-edits':
      return `${readSmartSliceReviewSessionManualEditCount(task)} manual edits`;
    case 'review-events':
      return `${readSmartSliceReviewSessionManualEditCount(task)} replayable events`;
    case 'render-selection':
      return `${readSmartSliceReviewSessionSelectedCount(task)} selected segments`;
    case 'render-artifact-manifest':
      return `${readSmartSliceRenderedSliceCount(task)} rendered slices`;
  }
}
