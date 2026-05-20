import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const failures = [];
const pass = [];

function read(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertIncludes(source, marker, message) {
  assertRule(source.includes(marker), `${message} (missing ${JSON.stringify(marker)})`);
}

function countSourceOccurrences(source, marker) {
  return source.split(marker).length - 1;
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    return '';
  }
  return source.slice(start, end);
}

const flowModulePath = 'packages/sdkwork-autocut-tasks/src/pages/taskDetailEngineSteps.ts';
const taskDetailPagePath = 'packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx';
const i18nPath = 'packages/sdkwork-autocut-services/src/service/i18n-resources.service.ts';

assertRule(existsSync(path.join(rootDir, flowModulePath)), 'Task detail UX uses a dedicated engine flow standards module');

const flowModuleSource = existsSync(path.join(rootDir, flowModulePath)) ? read(flowModulePath) : '';
const taskDetailPageSource = read(taskDetailPagePath);
const commercialFlowPanelSource = extractBetween(
  taskDetailPageSource,
  'function TaskDetailCommercialFlowPanel',
  'function getTaskDetailFlowStatusLabelKey',
);
const commercialResultPanelSource = extractBetween(
  taskDetailPageSource,
  'function TaskDetailCommercialResultPanel',
  'export function TaskDetailPage',
);
const taskDetailHeaderSource = extractBetween(
  taskDetailPageSource,
  '{/* Header */}',
  '{task.type === AUTOCUT_TASK_TYPE.videoSlice && (',
);
const taskDetailContentSource = extractBetween(
  taskDetailPageSource,
  'const renderContent = () => {',
  '<div className="w-full min-h-full overflow-y-auto bg-[#0A0A0A]">',
);
const taskExecutionPanelStart = taskDetailPageSource.indexOf('function TaskExecutionPanel');
const taskExecutionPanelSource = taskExecutionPanelStart >= 0
  ? taskDetailPageSource.slice(taskExecutionPanelStart)
  : '';
const taskExecutionLogClipboardSource = extractBetween(
  taskDetailPageSource,
  'function createTaskExecutionLogClipboardText',
  'function downloadTaskExecutionResultFile',
);
const taskResultFileDownloadSource = extractBetween(
  taskDetailPageSource,
  'function downloadTaskExecutionResultFile',
  'function TaskVideoPreview',
);
const taskExecutionDiagnosticsSource = `${taskExecutionPanelSource}\n${taskDetailPageSource}`;
const taskDetailDiagnosticsChildrenSource = extractBetween(
  taskDetailPageSource,
  '<TaskExecutionPanel',
  '</TaskExecutionPanel>',
);
const i18nSource = read(i18nPath);
const zhTaskDetailFlowI18nSource = extractBetween(
  i18nSource,
  'reviewRisk: AUTOCUT_TASK_DETAIL_REVIEW_RISK_ZH_CN_MESSAGES',
  '    slicingLogic: {',
);
const enTaskDetailFlowI18nSource = extractBetween(
  i18nSource,
  'reviewRisk: AUTOCUT_TASK_DETAIL_REVIEW_RISK_EN_US_MESSAGES',
  '    slicingLogic: {',
);
const taskDetailFlowI18nSource = `${zhTaskDetailFlowI18nSource}\n${enTaskDetailFlowI18nSource}`;
const zhTaskDetailFlowCopySource = zhTaskDetailFlowI18nSource;
const enTaskDetailFlowCopySource = enTaskDetailFlowI18nSource;
const taskDetailFlowCopySource = `${zhTaskDetailFlowCopySource}\n${enTaskDetailFlowCopySource}`;

assertRule(zhTaskDetailFlowI18nSource.includes('flow: {'), 'Task detail zh-CN i18n includes flow copy');
assertRule(enTaskDetailFlowI18nSource.includes('flow: {'), 'Task detail en-US i18n includes flow copy');

const canonicalTaskDetailFlowSource = extractBetween(
  enTaskDetailFlowI18nSource,
  'flow: {',
  '    slicingLogic: {',
);
const zhDefaultFlowI18nSource = extractBetween(
  zhTaskDetailFlowI18nSource,
  'flow: {',
  '    slicingLogic: {',
);
const enDefaultFlowI18nSource = canonicalTaskDetailFlowSource;
const defaultFlowI18nSource = `${zhDefaultFlowI18nSource}\n${enDefaultFlowI18nSource}`;
const zhDefaultFlowStatusI18nSource = extractBetween(
  zhDefaultFlowI18nSource,
  'status: {',
  '    step: {',
);
const enDefaultFlowStatusI18nSource = extractBetween(
  enDefaultFlowI18nSource,
  'status: {',
  '    step: {',
);

assertIncludes(flowModuleSource, 'export type TaskDetailEngineFlowStepId', 'Task detail flow exposes stable business step ids');
assertIncludes(flowModuleSource, 'export const TASK_DETAIL_ENGINE_FLOW_STEPS', 'Task detail flow defines canonical step metadata');
assertIncludes(flowModuleSource, 'export const TASK_DETAIL_ENGINE_FLOW_BY_ENGINE', 'Task detail flow maps every smart slicing engine to a simplified business workflow');
assertIncludes(flowModuleSource, 'export function createTaskDetailEngineFlowSummary', 'Task detail flow exposes a pure summary builder');
assertIncludes(flowModuleSource, 'export function inferSmartSliceTaskDetailEngine', 'Task detail flow keeps engine inference outside the React view');
assertIncludes(flowModuleSource, "if (status === 'completed') {\n    return 100;", 'Task detail flow forces completed business steps to show 100% progress');

const requiredEngineMappings = {
  "'talking-head-semantic'": ['prepare-source', 'recognize-speech', 'understand-content', 'review-clips', 'export-results'],
  "'speech-semantic'": ['prepare-source', 'recognize-speech', 'understand-content', 'review-clips', 'export-results'],
  "'generic-transcript-assisted'": ['prepare-source', 'recognize-speech', 'understand-content', 'review-clips', 'export-results'],
  "'dialogue-qa'": ['prepare-source', 'recognize-speech', 'structure-dialogue', 'review-clips', 'export-results'],
  "'meeting-agenda'": ['prepare-source', 'recognize-speech', 'extract-decisions', 'review-clips', 'export-results'],
  "'commerce-live'": ['prepare-source', 'recognize-speech', 'find-selling-points', 'deduplicate-clips', 'export-results'],
  "'performance-moment'": ['prepare-source', 'recognize-speech', 'find-highlights', 'review-clips', 'export-results'],
  "'visual-scene'": ['prepare-source', 'collect-visual-evidence', 'understand-scenes', 'review-clips', 'export-results'],
  "'legacy-video-slice'": ['prepare-source', 'slice-video', 'export-results'],
};

for (const [engineId, stepIds] of Object.entries(requiredEngineMappings)) {
  assertIncludes(flowModuleSource, engineId, `Task detail flow maps engine ${engineId}`);
  for (const stepId of stepIds) {
    assertIncludes(flowModuleSource, `'${stepId}'`, `Task detail flow includes ${stepId} for ${engineId}`);
  }
}

assertIncludes(taskDetailPageSource, "from './taskDetailEngineSteps'", 'TaskDetailPage consumes the canonical task detail flow module');
assertIncludes(taskDetailPageSource, 'TaskDetailCommercialFlowPanel', 'TaskDetailPage renders the simplified commercial flow panel');
assertIncludes(taskDetailPageSource, 'activeFlowOutputTab', 'Task detail page tracks the active workflow output tab');
assertIncludes(taskDetailPageSource, '<div className="w-full min-h-full overflow-y-auto bg-[#0A0A0A]">', 'Task detail page root supports page-level vertical scrolling');
assertIncludes(taskDetailPageSource, '<div className="w-full min-h-full p-6 md:p-10 flex flex-col gap-4">', 'Task detail page content stack can grow beyond the viewport instead of forcing a fixed-height shell');
assertRule(!taskDetailPageSource.includes('<div className="w-full h-full p-6 md:p-10 flex flex-col bg-[#0A0A0A] overflow-hidden">'), 'Task detail page root does not lock the whole detail screen behind overflow-hidden');
assertRule(taskDetailPageSource.indexOf('{renderContent()}') < taskDetailPageSource.indexOf('<TaskExecutionPanel'), 'Task detail page renders primary delivery content before advanced diagnostics controls');
assertIncludes(commercialFlowPanelSource, 'data-task-detail-commercial-flow="primary"', 'Task detail default workflow is explicitly marked as the primary product surface');
assertIncludes(commercialFlowPanelSource, '<ol', 'Task detail default workflow uses a concise ordered flow rail instead of dense pipeline cards');
assertIncludes(commercialFlowPanelSource, 'data-task-detail-flow-step={step.id}', 'Task detail workflow steps have stable product-step markers for UI and QA');
assertIncludes(commercialFlowPanelSource, 'className="grid w-full min-w-full"', 'Task detail workflow rail expands to the available width before overflowing');
assertIncludes(commercialFlowPanelSource, 'gridTemplateColumns: `repeat(${summary.steps.length}, minmax(96px, 1fr))`', 'Task detail workflow adapts to each engine step count with compact rail spacing');
assertIncludes(commercialFlowPanelSource, 'overflow-x-auto', 'Task detail workflow rail stays readable on narrow layouts instead of compressing labels');
assertIncludes(commercialFlowPanelSource, 'minmax(96px, 1fr)', 'Task detail workflow rail uses a compact adaptive minimum width');
assertIncludes(commercialFlowPanelSource, 'const stepProgress = Math.min(100, Math.max(0, step.progress));', 'Task detail workflow clamps each step progress before rendering circular progress rings');
assertIncludes(commercialFlowPanelSource, 'conic-gradient(${getTaskDetailFlowStepProgressColor(step.status, isCurrent)} ${stepProgress * 3.6}deg', 'Task detail workflow renders each step as a circular percentage progress ring');
assertIncludes(commercialFlowPanelSource, `{stepProgress}<span className="text-[7px]">%</span>`, 'Task detail workflow shows the percent sign inside each circular progress ring');
assertIncludes(commercialFlowPanelSource, 'aria-label={`${t(step.labelKey)} ${stepProgress}%`}', 'Task detail workflow exposes per-step progress to assistive technology');
assertIncludes(commercialFlowPanelSource, 'absolute left-0 top-[18px] h-px w-1/2', 'Task detail workflow aligns connecting rail segments with circular progress centers');
assertIncludes(taskDetailPageSource, 'function getTaskDetailFlowStepProgressColor', 'Task detail workflow owns status-aware colors for circular step progress');
assertRule(!commercialFlowPanelSource.includes('md:grid-cols-5'), 'Task detail workflow does not hard-code a five-column layout for shorter engines');
assertRule(!commercialFlowPanelSource.includes('min-h-[92px]'), 'Task detail default workflow avoids tall diagnostic-style step cards');
assertRule(!commercialFlowPanelSource.includes('relative rounded-md border px-3 py-2 ${getTaskDetailFlowStatusClass(step.status)}'), 'Task detail workflow does not render each step as a heavy bordered card');
assertRule(!commercialFlowPanelSource.includes('getTaskDetailFlowStepDotClass'), 'Task detail workflow uses product rail nodes instead of simple status dots');
assertRule(!commercialFlowPanelSource.includes('CheckCircle2 size={12}'), 'Task detail workflow uses numeric circular progress instead of completed-only icons');
assertRule(!commercialFlowPanelSource.includes('taskDetail.engineSteps.engine.${summary.engine}'), 'Task detail default workflow does not reuse diagnostic engine labels');
assertRule(!commercialFlowPanelSource.includes('defaultValue: summary.engine'), 'Task detail default workflow never falls back to raw engine ids');
assertRule(!commercialFlowPanelSource.includes('defaultValue: currentStep.status'), 'Task detail default workflow never falls back to raw current status ids');
assertRule(!commercialFlowPanelSource.includes('defaultValue: step.status'), 'Task detail flow rail never falls back to raw step status ids');
assertRule(!commercialFlowPanelSource.includes('taskDetail.flow.title'), 'Task detail workflow strip does not spend vertical space on a redundant title');
assertRule(!commercialFlowPanelSource.includes('currentStep.descriptionKey'), 'Task detail workflow strip does not render explanatory step paragraphs above the rail');
assertRule(!commercialFlowPanelSource.includes('taskDetail.flow.description'), 'Task detail workflow strip avoids redundant explanatory copy near the top of the page');
assertRule(!commercialFlowPanelSource.includes('taskDetail.flow.metrics.title'), 'Task detail workflow strip no longer renders a generic output-summary card title');
assertRule(!commercialFlowPanelSource.includes('taskDetail.flow.metrics.subtitle'), 'Task detail workflow strip no longer renders a generic output-summary card subtitle');
assertIncludes(commercialFlowPanelSource, 'activeOutputTab', 'Task detail workflow strip renders output content through tabs');
assertIncludes(commercialFlowPanelSource, 'onSelectOutputTab', 'Task detail workflow strip lets operators switch output tabs');
assertIncludes(commercialFlowPanelSource, "outputTabs.map((tab) => (", 'Task detail workflow strip renders multiple output tabs');
assertIncludes(commercialFlowPanelSource, "taskDetail.flow.metrics.clips", 'Task detail workflow tabs include clip output content');
assertIncludes(commercialFlowPanelSource, "taskDetail.flow.metrics.transcript", 'Task detail workflow tabs include transcript output content');
assertIncludes(commercialFlowPanelSource, "taskDetail.flow.metrics.outputs", 'Task detail workflow tabs include file output content');
assertIncludes(commercialFlowPanelSource, 'taskDetail.review.openWorkbench', 'Task detail workflow keeps the review-stage action on the active workflow surface');
assertRule(!commercialFlowPanelSource.includes('taskDetail.flow.action.openOutput'), 'Task detail workflow does not duplicate completed-result output actions');
assertRule(!commercialFlowPanelSource.includes('taskDetail.flow.action.reprocess'), 'Task detail workflow does not duplicate the header reprocess action');
assertRule(!commercialFlowPanelSource.includes('primaryAction'), 'Task detail default workflow does not compute or render a primary CTA cluster');
assertRule(countSourceOccurrences(commercialFlowPanelSource, '<Button') === 1, 'Task detail workflow exposes only one contextual review CTA');
assertRule(!commercialFlowPanelSource.includes('shadow-xl'), 'Task detail workflow uses a flat product surface without heavy shadows');
assertIncludes(commercialFlowPanelSource, 'border border-white/10 bg-white/[0.025]', 'Task detail workflow uses a flat low-contrast surface');
assertIncludes(taskDetailPageSource, 'data-task-detail-diagnostics-panel="advanced"', 'Task detail advanced diagnostics are explicitly separated from the default product workflow');
assertIncludes(taskDetailPageSource, 'showExecutionDetails &&', 'Task detail keeps raw engine diagnostics hidden until the operator expands them');
assertIncludes(taskDetailPageSource, 'data-task-detail-diagnostics-drawer="true"', 'Task detail step logs render in a dedicated Drawer instead of expanding inline');
assertIncludes(taskDetailPageSource, 'className="fixed inset-0 z-50 flex justify-start bg-black/55 backdrop-blur-sm"', 'Task detail step logs use a left-side Drawer overlay');
assertIncludes(taskDetailPageSource, 'className="flex h-full w-[90vw] min-w-0 max-w-none flex-col overflow-hidden border-r border-white/10 bg-[#0A0A0A] shadow-2xl"', 'Task detail step log Drawer occupies ninety percent of the viewport width from the left');
assertIncludes(taskDetailPageSource, 'lg:grid-cols-[300px_minmax(0,1fr)]', 'Task detail step log Drawer gives the step filter enough width beside the log stream');
assertRule(!taskDetailPageSource.includes('grid gap-2 border-b border-[#222] p-3 sm:grid-cols-2 xl:grid-cols-4'), 'Task detail step log Drawer removes the duplicated diagnostics summary strip');
assertIncludes(taskDetailPageSource, 'data-task-detail-diagnostics-step-filter="true"', 'Task detail step log Drawer exposes a focused step filter rail');
assertIncludes(taskDetailPageSource, 'data-task-detail-diagnostics-log-stream="true"', 'Task detail step log Drawer exposes a dedicated flat log stream');
assertRule(!taskExecutionPanelSource.includes('allStepsDetail'), 'Task detail step log Drawer avoids explanatory step-filter copy that repeats the control label');
assertRule(!taskExecutionPanelSource.includes('step.checkpointKey && ('), 'Task detail step log Drawer keeps internal checkpoint detail out of the primary browsing flow');
assertIncludes(taskExecutionPanelSource, 'divide-y divide-white/5', 'Task detail execution logs render as a flat separated list instead of nested cards');
assertIncludes(taskDetailPageSource, 'aria-labelledby="task-detail-execution-drawer-title"', 'Task detail step log Drawer exposes an accessible title');
assertIncludes(taskDetailPageSource, 'onClick={onToggleExecutionDetails}', 'Task detail step log Drawer can close from the backdrop and close control');
assertRule(!taskExecutionPanelSource.includes('className="mt-2 max-h-[min(72vh,760px)] min-h-0 overflow-hidden rounded-md border border-white/10 bg-[#0D0D0D]"'), 'Task detail step logs no longer expand inline below the task content');
assertIncludes(taskDetailHeaderSource, 'taskDetail.header.type', 'Task detail header localizes the task type label');
assertIncludes(taskDetailHeaderSource, 'taskDetail.flow.engine.${taskDetailFlowSummary.engine}', 'Task detail header surfaces the product-facing engine label');
assertIncludes(taskDetailHeaderSource, "t('taskDetail.flow.current')", 'Task detail header surfaces the current workflow step');
assertIncludes(taskDetailHeaderSource, "t('taskDetail.result.progress')", 'Task detail header surfaces the overall progress');
assertIncludes(taskDetailHeaderSource, 'getTaskStatusLabelKey(task.status)', 'Task detail header uses localized task status labels');
assertIncludes(taskDetailHeaderSource, 'taskDetail.header.processAgain', 'Task detail header keeps a contextual reprocess action for reusable task runs');
assertIncludes(taskDetailHeaderSource, "t('taskDetail.engineSteps.diagnostics.show')", 'Task detail header exposes the step-log Drawer action where it is easy to find');
assertIncludes(taskDetailHeaderSource, 'aria-expanded={showExecutionDetails}', 'Task detail header step-log action exposes Drawer open state');
assertIncludes(taskDetailHeaderSource, 'setShowExecutionDetails((visible) => !visible)', 'Task detail header owns the step-log Drawer toggle');
assertIncludes(taskDetailHeaderSource, 'flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 pb-2 shrink-0', 'Task detail header uses a compact toolbar layout');
assertIncludes(taskDetailHeaderSource, 'className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md', 'Task detail header uses a compact back button');
assertIncludes(taskDetailHeaderSource, 'truncate text-base font-semibold text-white', 'Task detail header avoids oversized title typography');
assertIncludes(taskDetailHeaderSource, 'className="h-7 shrink-0 border-white/10 bg-transparent px-2.5 text-xs text-gray-200 hover:bg-white/[0.04]"', 'Task detail header keeps the reprocess action compact');
assertRule(!taskDetailHeaderSource.includes('Task type:'), 'Task detail header does not hard-code English task type text');
assertRule(!taskDetailHeaderSource.includes('Created:'), 'Task detail header does not hard-code English created text');
assertRule(!taskDetailHeaderSource.includes('taskDetail.header.openAssets'), 'Task detail header does not expose an asset action button');
assertRule(countSourceOccurrences(taskDetailHeaderSource, 'taskDetail.header.processAgain') === 1, 'Task detail header exposes the reprocess action only once');
assertRule(!taskDetailHeaderSource.includes('taskDetail.header.created'), 'Task detail header no longer spends a row on the created timestamp');
assertRule(!taskDetailHeaderSource.includes('pb-4 shrink-0'), 'Task detail header does not waste vertical space with oversized bottom padding');
assertRule(!taskDetailHeaderSource.includes('w-10 h-10'), 'Task detail header does not use an oversized circular back button');
assertRule(!taskDetailHeaderSource.includes('text-xl font-bold'), 'Task detail header does not use hero-sized title typography');
assertIncludes(taskDetailPageSource, 'taskDetail.missing.title', 'Task detail missing-task state uses localized product copy');
assertIncludes(taskDetailPageSource, 'taskDetail.processing.fallback', 'Task detail processing state uses localized product copy');
assertIncludes(taskDetailPageSource, 'taskDetail.review.title', 'Task detail review-ready state uses localized product copy');
assertIncludes(taskDetailPageSource, 'taskDetail.review.openWorkbench', 'Task detail review-ready action uses localized product copy');
assertRule(!taskDetailContentSource.includes('Task is processing...'), 'Task detail processing state does not hard-code English fallback copy');
assertRule(!taskDetailContentSource.includes('Segment Review Workbench is ready'), 'Task detail review-ready state does not expose workbench-style engineering copy');
assertRule(!taskDetailContentSource.includes('Open review workbench'), 'Task detail review-ready default action does not hard-code workbench copy');
assertRule(!taskDetailContentSource.includes('>Segments<'), 'Task detail review-ready metrics do not hard-code English segment labels');
assertRule(!taskDetailContentSource.includes('>Selected<'), 'Task detail review-ready metrics do not hard-code English selected labels');
assertRule(!taskDetailContentSource.includes('>Duplicates<'), 'Task detail review-ready metrics do not hard-code English duplicate labels');
assertRule(!taskDetailContentSource.includes('renderSmartSliceEvidenceInspector()'), 'Task detail default content does not render evidence inspector outside advanced diagnostics');
assertRule(!taskDetailDiagnosticsChildrenSource.includes('renderSmartSliceEvidenceInspector()'), 'Task detail step-log Drawer does not mix evidence inspection into the log browsing experience');
assertRule(!taskDetailPageSource.includes('function TaskDetailVideoSliceAdvancedPanel'), 'Task detail no longer keeps a second advanced video-slice panel behind the step-log Drawer');
assertRule(!taskDetailPageSource.includes('function TaskDetailEngineStepper'), 'Task detail step-log Drawer does not duplicate the product workflow stepper');
assertRule(!taskDetailPageSource.includes('function TaskDetailSmartSliceEngineWorkbench'), 'Task detail step-log Drawer does not duplicate the engine workbench');
assertIncludes(commercialResultPanelSource, 'data-task-detail-result-panel="commercial"', 'Task detail video-slice result panel is marked as a commercial product surface');
assertIncludes(commercialResultPanelSource, 'taskDetail.result.title', 'Task detail video-slice result panel uses product-facing result copy');
assertIncludes(taskDetailContentSource, '<TaskDetailCommercialResultPanel', 'Task detail default video-slice content renders the commercial result panel');
assertRule(countSourceOccurrences(commercialResultPanelSource, "t('taskDetail.result.openLocation')") === 1, 'Task detail video-slice result panel exposes a single open-location action surface');
assertIncludes(commercialResultPanelSource, 'border border-white/10 bg-white/[0.025]', 'Task detail result panel uses flat low-contrast containers');
assertRule(!commercialResultPanelSource.includes('shadow-xl'), 'Task detail result panel avoids heavy shadows');
assertRule(!commercialResultPanelSource.includes('Quality JSON'), 'Task detail default result panel does not expose quality JSON downloads');
assertRule(!commercialResultPanelSource.includes('showSlicingLogic'), 'Task detail default result panel does not expose slicing logic toggles');
assertRule(!commercialResultPanelSource.includes('taskDetail.slicingLogic.title'), 'Task detail default result panel does not surface diagnostic slicing logic');
assertRule(!commercialResultPanelSource.includes('selectedSliceReviewIssueCodes'), 'Task detail default result panel does not inline review-risk diagnostics');
assertRule(!commercialResultPanelSource.includes('smartSliceTaskSlicingLogicSummary'), 'Task detail default result panel does not inline smart-slice diagnostic summaries');
assertRule(!commercialResultPanelSource.includes('hasSliceReviewMetadata'), 'Task detail default result panel does not inline engineering review metadata');

const diagnosticsHardcodedEnglish = [
  'Smart Slice Evidence Inspector',
  'evidence files',
  'checkpoint steps',
  'Task JSON',
  "'Ready'",
  "'Missing'",
  "'Pending'",
  'Schema:',
  'Summary:',
  'Size:',
  'Copy artifact path',
  'Copy path',
  'Open artifact location',
  'Reveal',
];
for (const hardcodedCopy of diagnosticsHardcodedEnglish) {
  assertRule(!taskExecutionPanelSource.includes(hardcodedCopy), `Task detail step-log Drawer does not hard-code evidence-diagnostic copy "${hardcodedCopy}"`);
}

assertRule(!taskExecutionPanelSource.includes('defaultValue: engine'), 'Task detail step-log Drawer never falls back to raw engine ids');
assertRule(!taskExecutionPanelSource.includes('defaultValue: selectedStep.status'), 'Task detail step-log Drawer never falls back to raw selected status ids');
assertRule(!taskExecutionPanelSource.includes('defaultValue: step.status'), 'Task detail step-log Drawer never falls back to raw step status ids');
assertRule(!taskDetailPageSource.includes("|| '--'"), 'Task detail does not use raw placeholder dashes for user-facing empty state copy');

const executionDiagnosticsCopyKeys = [
  'nativeTask',
  'stepsCount',
  'logsCount',
  'errorsCount',
  'progressFallback',
  'cancel',
  'logsTitle',
  'allSteps',
  'resumeFromHere',
  'emptySteps',
  'latestLogs',
  'showAllLogs',
  'copyLog',
  'emptySelectedLogs',
  'emptyLogs',
  'unassignedStep',
  'logLabelSeverity',
  'logLabelStep',
  'logLabelPhase',
  'logLabelSource',
  'logLabelProgress',
  'logLabelTimestamp',
  'logLabelMessage',
  'logLabelDetails',
  'unavailable',
  'stepStatus',
  'logSeverity',
];
for (const key of executionDiagnosticsCopyKeys) {
  assertIncludes(taskExecutionDiagnosticsSource, `taskDetail.executionDiagnostics.${key}`, `Task detail execution diagnostics localizes ${key}`);
  assertIncludes(zhTaskDetailFlowCopySource, `${key}:`, `Chinese task detail execution diagnostics copy includes ${key}`);
  assertIncludes(enTaskDetailFlowCopySource, `${key}:`, `English task detail execution diagnostics copy includes ${key}`);
}

const executionDiagnosticsHardcodedEnglish = [
  '>Cancel<',
  '>Steps<',
  '>Logs<',
  'All steps',
  'Show the full execution timeline.',
  'Resume from here',
  'No execution step snapshot yet.',
  'Latest 12',
  'Show all',
  'Copy log',
  'No execution logs for the selected step yet.',
  'No execution logs yet.',
];
for (const hardcodedCopy of executionDiagnosticsHardcodedEnglish) {
  assertRule(!taskExecutionPanelSource.includes(hardcodedCopy), `Task detail execution diagnostics does not hard-code "${hardcodedCopy}"`);
}
assertIncludes(taskDetailPageSource, 'function getTaskExecutionStepStatusLabelKey', 'Task detail execution diagnostics maps step statuses through stable label keys');
assertIncludes(taskDetailPageSource, 'function getTaskExecutionLogSeverityLabelKey', 'Task detail execution diagnostics maps log severities through stable label keys');
assertIncludes(taskDetailPageSource, 'function translateTaskExecutionDisplayText', 'Task detail execution diagnostics translates known execution messages before rendering');
assertIncludes(taskDetailPageSource, 'const TASK_EXECUTION_DISPLAY_TEXT_I18N_KEYS', 'Task detail execution diagnostics keeps known log message translations in one canonical map');
assertIncludes(taskDetailPageSource, 'taskDetail.executionDiagnostics.message.', 'Task detail execution diagnostics maps log messages through executionDiagnostics.message keys');
assertIncludes(taskExecutionPanelSource, 'translateTaskExecutionDisplayText(latestLog?.message, t)', 'Task detail execution header localizes the latest log message');
assertIncludes(taskExecutionPanelSource, 'translateTaskExecutionDisplayText(summaryStep?.message, t)', 'Task detail execution header localizes the summary step message');
assertIncludes(taskExecutionPanelSource, 'translateTaskExecutionDisplayText(task.progressMessage, t)', 'Task detail execution header localizes task progress messages');
assertIncludes(taskDetailPageSource, 'function getTaskExecutionStepProgress', 'Task detail execution diagnostics centralizes status-aware step progress');
assertIncludes(taskDetailPageSource, "case 'completed':\n      return 100;", 'Task detail execution diagnostics forces completed raw steps to render 100% progress');
assertIncludes(taskExecutionPanelSource, 'const stepProgress = getTaskExecutionStepProgress(step);', 'Task detail execution step rail uses status-aware progress for every step');
assertIncludes(taskExecutionPanelSource, 'style={{ width: `${stepProgress}%` }}', 'Task detail execution step progress bars render the status-aware progress value');
assertIncludes(taskExecutionPanelSource, '<span>{stepProgress}%</span>', 'Task detail execution step progress labels render the status-aware progress value');
assertRule(!taskExecutionPanelSource.includes('Math.min(100, Math.max(0, step.progress || 0))'), 'Task detail execution step rail does not render raw step.progress in progress bars');
assertRule(!taskExecutionPanelSource.includes('Math.round(step.progress || 0)'), 'Task detail execution step rail does not render raw step.progress in progress labels');
assertIncludes(taskExecutionPanelSource, 'translateTaskExecutionDisplayText(step.message, t)', 'Task detail execution step rail localizes step messages');
assertIncludes(taskExecutionPanelSource, 'translateTaskExecutionDisplayText(log.message, t)', 'Task detail execution log stream localizes log messages');
assertIncludes(taskExecutionLogClipboardSource, 'translateTaskExecutionDisplayText(log.message, t)', 'Task detail execution log clipboard text localizes log messages');
assertIncludes(zhTaskDetailFlowCopySource, 'message:', 'Chinese task detail execution diagnostics copy includes log message translations');
assertIncludes(enTaskDetailFlowCopySource, 'message:', 'English task detail execution diagnostics copy includes log message translations');
for (const translatedMessageKey of ['smartSlicePrepareSource', 'smartSliceSpeechToText', 'videoCompressionPreparing', 'subtitleExtractionQueued', 'cancelRequested']) {
  assertIncludes(zhTaskDetailFlowCopySource, `${translatedMessageKey}:`, `Chinese task detail execution diagnostics localizes message ${translatedMessageKey}`);
  assertIncludes(enTaskDetailFlowCopySource, `${translatedMessageKey}:`, `English task detail execution diagnostics localizes message ${translatedMessageKey}`);
}
for (const status of ['pending', 'running', 'completed', 'failed', 'cancelRequested', 'canceled', 'interrupted', 'skipped']) {
  assertIncludes(zhTaskDetailFlowCopySource, `${status}:`, `Chinese task detail execution diagnostics localizes step status ${status}`);
  assertIncludes(enTaskDetailFlowCopySource, `${status}:`, `English task detail execution diagnostics localizes step status ${status}`);
}
for (const severity of ['debug', 'info', 'warning', 'error']) {
  assertIncludes(zhTaskDetailFlowCopySource, `${severity}:`, `Chinese task detail execution diagnostics localizes log severity ${severity}`);
  assertIncludes(enTaskDetailFlowCopySource, `${severity}:`, `English task detail execution diagnostics localizes log severity ${severity}`);
}
assertIncludes(taskExecutionPanelSource, 't(getTaskExecutionStepStatusLabelKey(step.status))', 'Task detail execution step cards localize step status labels');
assertIncludes(taskExecutionPanelSource, 't(getTaskExecutionLogSeverityLabelKey(log.severity))', 'Task detail execution logs localize severity labels');
assertIncludes(taskExecutionPanelSource, "t('taskDetail.executionDiagnostics.unassignedStep')", 'Task detail execution logs use localized unassigned-step copy');
assertRule(!taskExecutionPanelSource.includes("t('taskDetail.executionDiagnostics.checkpoint')"), 'Task detail execution step filter omits internal checkpoint labels from the primary browsing flow');
assertRule(!taskExecutionPanelSource.includes('>{step.status}</span>'), 'Task detail execution step cards do not render raw step status ids');
assertRule(!taskExecutionPanelSource.includes('{normalizeTaskDetailDisplayText(log.severity)}'), 'Task detail execution logs do not render raw severity ids');
assertRule(!taskExecutionPanelSource.includes('{normalizeTaskDetailDisplayText(log.message)}'), 'Task detail execution logs do not render raw log messages without i18n mapping');
assertRule(!taskExecutionPanelSource.includes('>{step.message}</p>'), 'Task detail execution step cards do not render raw step messages without i18n mapping');
assertRule(!taskExecutionPanelSource.includes('{selectedStep.id}'), 'Task detail execution log filter does not expose selected raw step ids as the only label');
assertIncludes(taskDetailPageSource, 'createTaskExecutionLogClipboardText(log, t)', 'Task detail execution log copy receives localized labels');
for (const hardcodedClipboardLabel of ['Severity:', 'Step:', 'Phase:', 'Source:', 'Progress:', 'Timestamp:', 'Message:', 'Details:']) {
  assertRule(!taskExecutionLogClipboardSource.includes(hardcodedClipboardLabel), `Task detail execution log clipboard text does not hard-code ${hardcodedClipboardLabel}`);
}
assertRule(!taskDetailPageSource.includes("return '--'"), 'Task detail display formatters do not return raw dash placeholders');
assertRule(!taskDetailPageSource.includes("'0 Bytes'"), 'Task detail byte formatting does not expose English zero-byte copy');

const defaultResultCopyKeys = [
  'unavailable',
  'copied',
  'copyText',
  'exportTxt',
  'gifAlt',
  'downloadGif',
  'audioTitle',
  'downloadAudio',
  'translationTitle',
  'speechSegments',
  'downloadSrt',
  'copyTranslation',
  'copyTranscript',
  'noTranscript',
  'compressionComplete',
  'originalSize',
  'compressedSize',
  'previewVideo',
  'downloadCompressedVideo',
  'downloadOutputFile',
  'fallbackEmpty',
  'downloadTaskResult',
];
for (const key of defaultResultCopyKeys) {
  assertIncludes(`${taskDetailContentSource}\n${commercialResultPanelSource}`, `taskDetail.result.${key}`, `Task detail default result surface localizes ${key}`);
  assertIncludes(zhTaskDetailFlowCopySource, `${key}:`, `Chinese task detail result copy includes ${key}`);
  assertIncludes(enTaskDetailFlowCopySource, `${key}:`, `English task detail result copy includes ${key}`);
}

const defaultResultHardcodedEnglish = [
  "'Copied'",
  'Copy text',
  'Export TXT',
  'Generated GIF',
  'Download GIF',
  'Extracted audio',
  'Download audio file',
  'Translated subtitle and transcript output',
  'speech segments',
  'Download SRT',
  'Copy translation',
  'Copy transcript',
  'No transcript text is available.',
  'Compression complete. Size reduced by',
  'Original size',
  'Compressed size',
  'Preview video',
  'Download compressed video',
  'Download output file',
  'No detailed result preview is available for this task.',
  'Download task result',
];
for (const hardcodedCopy of defaultResultHardcodedEnglish) {
  assertRule(!taskDetailContentSource.includes(hardcodedCopy), `Task detail default result surface does not hard-code "${hardcodedCopy}"`);
}
assertIncludes(commercialResultPanelSource, "t('taskDetail.result.unavailable')", 'Task detail commercial result panel uses localized unavailable copy');
assertRule(!commercialResultPanelSource.includes('formatBytes(slice.size)'), 'Task detail commercial result panel does not treat missing slice size as zero bytes');

const resultFileCopyKeys = [
  'labelTask',
  'labelType',
  'labelStatus',
  'labelProgress',
  'labelProgressMessage',
  'labelCompletedAt',
  'labelResultCount',
  'labelError',
];
for (const key of resultFileCopyKeys) {
  assertIncludes(taskResultFileDownloadSource, `taskDetail.resultFile.${key}`, `Task detail downloaded result file localizes ${key}`);
  assertIncludes(zhTaskDetailFlowCopySource, `${key}:`, `Chinese task detail result file copy includes ${key}`);
  assertIncludes(enTaskDetailFlowCopySource, `${key}:`, `English task detail result file copy includes ${key}`);
}
assertIncludes(taskDetailPageSource, 'downloadTaskExecutionResultFile(task, getTaskTypeLabel(task.type), t(getTaskStatusLabelKey(task.status)), t)', 'Task detail downloaded result file receives localized type, status, and labels');
for (const hardcodedResultFileLabel of ['Task:', 'Type:', 'Status:', 'Progress:', 'Progress message:', 'Completed at:', 'Result count:', 'Error:']) {
  assertRule(!taskResultFileDownloadSource.includes(hardcodedResultFileLabel), `Task detail downloaded result file does not hard-code ${hardcodedResultFileLabel}`);
}

assertIncludes(i18nSource, 'flow: {', 'Task detail i18n includes flow copy');
assertIncludes(zhTaskDetailFlowCopySource, 'header: {', 'Chinese task detail copy includes localized header labels');
assertIncludes(enTaskDetailFlowCopySource, 'header: {', 'English task detail copy includes localized header labels');
assertIncludes(zhTaskDetailFlowCopySource, 'status: {', 'Chinese task detail copy includes localized task status labels');
assertIncludes(enTaskDetailFlowCopySource, 'status: {', 'English task detail copy includes localized task status labels');
assertIncludes(zhTaskDetailFlowCopySource, 'review: {', 'Chinese task detail copy includes localized review-ready state labels');
assertIncludes(enTaskDetailFlowCopySource, 'review: {', 'English task detail copy includes localized review-ready state labels');
assertIncludes(zhTaskDetailFlowCopySource, 'processing: {', 'Chinese task detail copy includes localized processing state labels');
assertIncludes(enTaskDetailFlowCopySource, 'processing: {', 'English task detail copy includes localized processing state labels');
assertIncludes(zhTaskDetailFlowCopySource, 'engine: {', 'Chinese task detail flow includes product-facing engine labels');
assertIncludes(enTaskDetailFlowCopySource, 'engine: {', 'English task detail flow includes product-facing engine labels');
for (const engineId of Object.keys(requiredEngineMappings)) {
  assertIncludes(zhTaskDetailFlowCopySource, engineId, `Chinese task detail flow labels engine ${engineId}`);
  assertIncludes(enTaskDetailFlowCopySource, engineId, `English task detail flow labels engine ${engineId}`);
}
assertRule(!defaultFlowI18nSource.includes('timestamped transcript evidence'), 'Default English workflow copy avoids evidence-heavy technical language');
assertRule(!defaultFlowI18nSource.includes('manifest files'), 'Default English workflow copy describes deliverables without raw manifest jargon');
assertRule(!defaultFlowI18nSource.includes('evidence') && !defaultFlowI18nSource.includes('OCR') && !defaultFlowI18nSource.includes('audio-event'), 'Default English workflow copy avoids inspection-layer terminology');
assertRule(!defaultFlowI18nSource.includes('时间戳') && !defaultFlowI18nSource.includes('证据完备') && !defaultFlowI18nSource.includes('证据') && !defaultFlowI18nSource.includes('OCR'), 'Default Chinese workflow copy avoids evidence-heavy technical language');
assertRule(!enDefaultFlowStatusI18nSource.includes("blocked: 'Blocked'"), 'Default English workflow status avoids raw blocked wording');
assertRule(!enDefaultFlowStatusI18nSource.includes("failed: 'Failed'"), 'Default English workflow status avoids raw failed wording');
assertRule(!enDefaultFlowStatusI18nSource.includes("upcoming: 'Upcoming'"), 'Default English workflow status avoids raw upcoming wording');
assertRule(!zhDefaultFlowStatusI18nSource.includes("blocked: '受阻'"), 'Default Chinese workflow status avoids raw blocked wording');
assertRule(!zhDefaultFlowStatusI18nSource.includes("failed: '失败'"), 'Default Chinese workflow status avoids raw failed wording');
assertRule(!zhDefaultFlowStatusI18nSource.includes("upcoming: '待开始'"), 'Default Chinese workflow status avoids raw upcoming wording');
assertIncludes(enTaskDetailFlowI18nSource, "subtitle: 'overview'", 'English output summary subtitle uses product-facing language');
assertIncludes(zhTaskDetailFlowI18nSource, "subtitle: '概览'", 'Chinese output summary subtitle uses product-facing language');
assertIncludes(i18nSource, 'Engine diagnostics', 'Raw execution diagnostics are positioned as advanced information');

if (failures.length > 0) {
  console.error('AutoCut task detail UX check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exit(1);
}

console.log(`AutoCut task detail UX check passed (${pass.length} checks).`);
