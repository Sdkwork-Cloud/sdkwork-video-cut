#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createReportPath } from './lib/report-paths.mjs';
import { normalizeCliArgs } from './lib/cli-args.mjs';

const REPORT_VERSION = 'video-cut.governance-suite.v1';
const COMMAND = 'check:governance';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const CATEGORIES = new Set([
  'all',
  'architecture-standards',
  'runtime-boundaries',
  'security',
  'license',
  'release-flow',
  'adr',
  'slo',
]);

const ARCHITECTURE_DOCS = [
  'docs/architecture/00-architecture-map.md',
  'docs/architecture/01-runtime-and-api-architecture.md',
  'docs/architecture/02-deployment-mode-architecture.md',
  'docs/architecture/03-provider-contract-and-ai-standards.md',
  'docs/architecture/04-media-pipeline-and-rendering-standards.md',
  'docs/architecture/05-data-storage-task-engine-standards.md',
  'docs/architecture/06-quality-security-observability-release-standards.md',
  'docs/architecture/07-technology-selection-decision-matrix.md',
  'docs/architecture/08-runtime-configuration-and-capability-standard.md',
  'docs/architecture/09-deployment-runtime-profile-standard.md',
  'docs/architecture/10-engineering-governance-automation-standard.md',
  'docs/architecture/11-nonfunctional-slo-resilience-standard.md',
  'docs/architecture/12-contract-versioning-and-migration-standard.md',
  'docs/architecture/13-adr-and-technology-radar-standard.md',
  'docs/architecture/14-database-implementation-standard.md',
  'docs/architecture/15-database-queue-baseline-implementation.md',
];

export function parseGovernanceArgs(argv) {
  const args = normalizeCliArgs(argv);
  let category = 'all';
  let json = false;
  let reportDir = DEFAULT_REPORT_DIR;

  if (args[0] && !args[0].startsWith('-')) {
    category = args.shift();
  }

  if (!CATEGORIES.has(category)) {
    throw new Error(`Unknown governance category: ${category}`);
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--report-dir') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--report-dir requires a value.');
      }
      reportDir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown governance argument: ${arg}`);
  }

  return { category, json, reportDir };
}

export function createGovernanceReport({
  category = 'all',
  projectRoot = process.cwd(),
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  if (!CATEGORIES.has(category)) {
    throw new Error(`Unknown governance category: ${category}`);
  }

  const selectedCategories =
    category === 'all'
      ? ['architecture-standards', 'runtime-boundaries', 'security', 'license', 'release-flow', 'adr', 'slo']
      : [category];
  const reportRoot = resolve(projectRoot, reportDir);
  const checks = selectedCategories.flatMap((currentCategory) =>
    createCategoryChecks(currentCategory, projectRoot, reportRoot),
  );
  const summary = summarizeChecks(checks);
  const { absolutePath: absoluteReportPath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    category === 'all' ? 'governance-suite-report.json' : `${category}-governance-report.json`,
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    category,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    reportPath,
    summary,
    checks,
  };

  writeReport(absoluteReportPath, report);
  return report;
}

function createCategoryChecks(category, projectRoot, reportRoot) {
  switch (category) {
    case 'architecture-standards':
      return architectureChecks(projectRoot);
    case 'runtime-boundaries':
      return runtimeBoundaryChecks(projectRoot);
    case 'security':
      return securityChecks(projectRoot);
    case 'license':
      return licenseChecks(projectRoot, reportRoot);
    case 'release-flow':
      return releaseFlowChecks(projectRoot);
    case 'adr':
      return adrChecks(projectRoot);
    case 'slo':
      return sloChecks(projectRoot);
    default:
      throw new Error(`Unsupported governance category: ${category}`);
  }
}

function architectureChecks(projectRoot) {
  const architect = readText(projectRoot, 'ARCHITECT.md');
  const map = readText(projectRoot, 'docs/architecture/00-architecture-map.md');
  const missingArchitectureDocs = ARCHITECTURE_DOCS.filter((path) => !existsSync(resolve(projectRoot, path)));
  const standaloneFiles = listFiles(projectRoot, 'docs').filter((path) => path.includes('standalone-design'));
  const standaloneOffenders = standaloneFiles.filter((path) => {
    const text = readText(projectRoot, path);
    return !text.includes('兼容跳转页') || !text.includes('不再承载新增架构内容') || text.length > 4096;
  });

  return [
    checkResult({
      id: 'architecture-map-present',
      category: 'architecture-standards',
      passed:
        existsSync(resolve(projectRoot, 'docs/architecture/00-architecture-map.md')) &&
        architect.includes('docs/architecture/00-architecture-map.md'),
      evidence: 'ARCHITECT.md delegates to docs/architecture/00-architecture-map.md.',
      failMessage: 'ARCHITECT.md must point to docs/architecture/00-architecture-map.md.',
    }),
    checkResult({
      id: 'architecture-authority-docs-present',
      category: 'architecture-standards',
      passed: missingArchitectureDocs.length === 0 && map.includes('authority order'),
      evidence: `${ARCHITECTURE_DOCS.length} architecture standard documents are present.`,
      failMessage: `Missing architecture standard documents: ${missingArchitectureDocs.join(', ')}`,
    }),
    checkResult({
      id: 'no-standalone-design-docs',
      category: 'architecture-standards',
      passed: standaloneOffenders.length === 0,
      evidence: 'standalone-design is redirect-only and formal standards live under docs/architecture.',
      failMessage: `standalone-design files must stay redirect-only: ${standaloneOffenders.join(', ')}`,
    }),
  ];
}

function runtimeBoundaryChecks(projectRoot) {
  const sourceFiles = listFiles(projectRoot, 'src').filter(
    (path) =>
      /\.(ts|tsx)$/.test(path) &&
      !path.includes('/__tests__/') &&
      !path.startsWith('src/test/') &&
      !path.endsWith('.d.ts'),
  );
  const frontendBoundaryViolations = [];
  for (const file of sourceFiles) {
    const text = readText(projectRoot, file);
    if (/(^|\s)from\s+['"](?:node:)?(?:fs|child_process)['"]/.test(text)) {
      frontendBoundaryViolations.push(`${file}: node filesystem/process import`);
    }
    if (text.includes('/api/local/v1')) {
      frontendBoundaryViolations.push(`${file}: hard-coded /api/local/v1`);
    }
    if (/fetch\s*\([^)]*(?:\/v1\/chat\/completions|\/v1\/audio\/transcriptions|compatible-mode\/v1\/chat\/completions)/s.test(text)) {
      frontendBoundaryViolations.push(`${file}: direct provider fetch`);
    }
  }

  const rustSourceFiles = listFiles(projectRoot, 'host/src').filter((path) => path.endsWith('.rs'));
  const allowedEnvFiles = new Set(['host/src/runtime_config.rs', 'host/src/tooling.rs']);
  const envAccessViolations = [];
  for (const file of rustSourceFiles) {
    const text = readText(projectRoot, file);
    if (/(?:std::env|env)::(?:vars|var|var_os)\s*\(/.test(text) && !allowedEnvFiles.has(file)) {
      envAccessViolations.push(file);
    }
  }
  const runtimeConfig = readText(projectRoot, 'host/src/runtime_config.rs');
  const runtimeConfigTest = readText(projectRoot, 'host/tests/runtime_config_test.rs');

  return [
    checkResult({
      id: 'frontend-no-media-or-provider-direct-calls',
      category: 'runtime-boundaries',
      passed: frontendBoundaryViolations.length === 0,
      evidence: 'Frontend code has no direct FFmpeg/process access, provider fetch, or /api/local/v1 route.',
      failMessage: `Frontend boundary violations: ${frontendBoundaryViolations.join('; ')}`,
    }),
    checkResult({
      id: 'host-env-access-confined-to-runtime-adapters',
      category: 'runtime-boundaries',
      passed: envAccessViolations.length === 0,
      evidence: 'Host env access is confined to runtime_config.rs and tooling.rs adapters.',
      failMessage: `Host env access outside runtime adapters: ${envAccessViolations.join(', ')}`,
    }),
    checkResult({
      id: 'host-runtime-rejects-legacy-video-cut-env',
      category: 'runtime-boundaries',
      passed:
        runtimeConfig.includes('FORBIDDEN_LEGACY_ENV_PREFIX') &&
        runtimeConfig.includes('reject_legacy_environment_aliases') &&
        runtimeConfig.includes('Legacy VIDEO_CUT_* environment variables are not supported') &&
        !runtimeConfig.includes('apply_legacy_aliases') &&
        runtimeConfigTest.includes('runtime_config_rejects_legacy_video_cut_environment_aliases'),
      evidence: 'Host runtime fails fast on legacy VIDEO_CUT_* environment aliases and accepts only SDKWORK_VIDEO_CUT_* runtime configuration.',
      failMessage: 'Host runtime must reject legacy VIDEO_CUT_* aliases instead of silently accepting compatibility configuration.',
    }),
    checkResult({
      id: 'canonical-host-route-only',
      category: 'runtime-boundaries',
      passed:
        readText(projectRoot, 'docs/openapi/video-cut-v1.yaml').includes('/api/video-cut/v1') &&
        !readText(projectRoot, 'src/services/httpHostClient.ts').includes('/api/local/v1'),
      evidence: 'Public API route is /api/video-cut/v1.',
      failMessage: 'Public host client and OpenAPI must use only /api/video-cut/v1.',
    }),
  ];
}

function securityChecks(projectRoot) {
  const configFiles = [
    '.env.example',
    'deploy/docker/docker-compose.yml',
    'deploy/kubernetes/values.yaml',
    'deploy/kubernetes/templates/secret.yaml',
  ];
  const secretDefaults = configFiles.filter((path) => {
    const text = readText(projectRoot, path);
    return /sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|xox[baprs]-[A-Za-z0-9-]+/.test(text);
  });
  const runtimeConfigTest = readText(projectRoot, 'host/tests/runtime_config_test.rs');
  const hostContractTest = readText(projectRoot, 'host/tests/host_contract_test.rs');
  const hostLib = readText(projectRoot, 'host/src/lib.rs');
  const hostMediaAssets = readText(projectRoot, 'host/src/media_assets.rs');
  const hostModels = readText(projectRoot, 'host/src/models.rs');
  const hostState = readText(projectRoot, 'host/src/state.rs');
  const appShell = readText(projectRoot, 'src/App.tsx');
  const diagnosticBundleExport = readText(projectRoot, 'src/domain/diagnosticBundleExport.ts');
  const hostApiErrors = readText(projectRoot, 'src/domain/hostApiErrors.ts');
  const diagnosticSupportBundleCard = readText(projectRoot, 'src/components/DiagnosticSupportBundleCard.tsx');
  const videoCutHostClientPort = readText(projectRoot, 'src/ports/videoCutHostClient.ts');
  const videoCutHostClientFactory = readText(projectRoot, 'src/services/createVideoCutHostClient.ts');
  const httpHostClient = readText(projectRoot, 'src/services/httpHostClient.ts');
  const mockHostClient = readText(projectRoot, 'src/services/mockHostClient.ts');
  const httpHostClientTest = readText(projectRoot, 'src/__tests__/httpHostClient.test.ts');
  const mockHostClientTest = readText(projectRoot, 'src/__tests__/mockHostClient.test.ts');
  const openApiContractTest = readText(projectRoot, 'src/__tests__/openApiContract.test.ts');
  const appShellTest = readText(projectRoot, 'src/__tests__/appShell.test.tsx');
  const settingsCenterTest = readText(projectRoot, 'src/__tests__/settingsCenter.test.tsx');
  const settingsPanels = readText(projectRoot, 'src/components/settings/SettingsPanels.tsx');
  const sampleVideo = readText(projectRoot, 'src/utils/sampleVideo.ts');
  const mediaContracts = readText(projectRoot, 'src/domain/mediaContracts.ts');
  const taskRecovery = readText(projectRoot, 'src/domain/taskRecovery.ts');
  const videoCutTypes = readText(projectRoot, 'src/domain/videoCutTypes.ts');
  const queuePage = readText(projectRoot, 'src/components/pages/QueuePage.tsx');
  const workbenchPage = readText(projectRoot, 'src/components/pages/WorkbenchPage.tsx');
  const resultsPage = readText(projectRoot, 'src/components/pages/ResultsPage.tsx');
  const resultsPageTest = readText(projectRoot, 'src/__tests__/resultsPage.test.tsx');
  const openApi = readText(projectRoot, 'docs/openapi/video-cut-v1.yaml');
  const prd = readText(projectRoot, 'docs/product/01-product-requirements-document.md');
  const dataStorageStandard = readText(projectRoot, 'docs/architecture/05-data-storage-task-engine-standards.md');
  const governanceStandard = readText(projectRoot, 'docs/architecture/10-engineering-governance-automation-standard.md');
  const mediaPipelineStandard = readText(projectRoot, 'docs/architecture/04-media-pipeline-and-rendering-standards.md');
  const hostCreateTaskBlock = sectionBetween(hostLib, 'async fn create_task(', 'async fn get_task(');
  const hostAnalyzeTaskBlock = sectionBetween(hostLib, 'async fn analyze_task(', 'async fn get_task_plan(');
  const hostUpdateTaskPlanBlock = sectionBetween(hostLib, 'async fn update_task_plan(', 'async fn put_task_transcript(');
  const importSampleBlock = sectionBetween(appShell, 'const importSample = async () => {', 'const importLocalVideo');
  const mockCreateTaskBlock = sectionBetween(mockHostClient, 'async createTask(input: CreateTaskInput)', 'async getTask');
  const mockAnalyzeTaskBlock = sectionBetween(mockHostClient, 'async analyzeTask(taskId: string)', 'async getTaskPlan');
  const mockUpdateTaskPlanBlock = sectionBetween(mockHostClient, 'async updateTaskPlan(taskId: string, plan: VideoSplitPlan)', 'async updateTaskTranscript');
  const createTaskInputType = sectionBetween(videoCutTypes, 'export interface CreateTaskInput', 'export interface ValidationError');
  const createTaskOpenApiSchema = sectionBetween(openApi, '    CreateTaskInput:', '    AttachTaskSourceInput:');
  const viteServerTokenBoundaryFiles = [
    '.env.example',
    'README.md',
    'src/services/createVideoCutHostClient.ts',
  ];
  const viteServerTokenBoundaryViolations = viteServerTokenBoundaryFiles.filter((path) =>
    readText(projectRoot, path).includes('VITE_VIDEO_CUT_SERVER_TOKEN'),
  );
  const viteHostRuntimeBoundaryFiles = [
    '.env.example',
    'README.md',
    'deploy/docker/Dockerfile',
    'scripts/run-video-cut-managed-ui-smoke.mjs',
    'scripts/run-video-cut-tauri-dev.mjs',
    'scripts/run-video-cut-tauri-dev-stack.mjs',
    'src/services/createVideoCutHostClient.ts',
  ];
  const viteHostRuntimeBoundaryViolations = viteHostRuntimeBoundaryFiles.filter((path) =>
    /VITE_VIDEO_CUT_HOST_(?:MODE|BASE_URL)/.test(readText(projectRoot, path)),
  );
  const legacyBrowserAuthTokenGlobalFiles = [
    'src/services/createVideoCutHostClient.ts',
    'scripts/run-video-cut-managed-ui-smoke.mjs',
    'README.md',
    'docs/architecture/08-runtime-configuration-and-capability-standard.md',
  ];
  const legacyBrowserAuthTokenGlobalViolations = legacyBrowserAuthTokenGlobalFiles.filter((path) =>
    readText(projectRoot, path).includes('__SDKWORK_VIDEO_CUT_AUTH_TOKEN__'),
  );
  const browserChildEnvUtility = readText(projectRoot, 'scripts/lib/safe-env.mjs');
  const browserChildEnvConsumers = [
    'scripts/run-video-cut-managed-ui-smoke.mjs',
    'scripts/run-video-cut-tauri-dev.mjs',
    'scripts/run-video-cut-tauri-dev-stack.mjs',
  ];
  const browserChildEnvConsumerViolations = browserChildEnvConsumers.filter(
    (path) => !readText(projectRoot, path).includes('createBrowserChildProcessEnv'),
  );

  return [
    checkResult({
      id: 'no-secret-defaults',
      category: 'security',
      passed: secretDefaults.length === 0,
      evidence: 'Deployment templates use placeholders and do not ship API key/token defaults.',
      failMessage: `Secret-like defaults found in: ${secretDefaults.join(', ')}`,
    }),
    checkResult({
      id: 'server-bind-requires-auth-test',
      category: 'security',
      passed:
        runtimeConfigTest.includes('runtime_config_rejects_server_bind_without_auth') &&
        runtimeConfigTest.includes('runtime_config_requires_server_token_for_single_user_token_auth'),
      evidence: 'Runtime config tests reject public server bind without auth.',
      failMessage: 'Missing runtime config auth guard tests.',
    }),
    checkResult({
      id: 'path-guard-tests-present',
      category: 'security',
      passed: hostContractTest.includes('..\\\\evil') && hostContractTest.includes('sanitize'),
      evidence: 'Host contract tests cover uploaded source filename sanitization.',
      failMessage: 'Host contract tests must cover source filename/path traversal sanitization.',
    }),
    checkResult({
      id: 'task-create-does-not-publish-fake-source',
      category: 'security',
      passed:
        hostContractTest.includes('create_task_without_source_does_not_publish_fake_source_artifact') &&
        mockHostClientTest.includes('creates draft tasks without publishing fake source artifacts') &&
        hostCreateTaskBlock.includes('status: "draft".to_string()') &&
        hostCreateTaskBlock.includes('source_name: None') &&
        !hostCreateTaskBlock.includes('VideoCutArtifact') &&
        !hostCreateTaskBlock.includes('push_event') &&
        mockCreateTaskBlock.includes("status: 'draft'") &&
        mockCreateTaskBlock.includes("currentStage: 'draft'") &&
        !mockCreateTaskBlock.includes('pushEvent') &&
        !mockCreateTaskBlock.includes('sourceName ??') &&
        !createTaskInputType.includes('sourceName') &&
        !createTaskOpenApiSchema.includes('sourceName'),
      evidence: 'Task creation remains draft-only; source artifacts are created only by upload or metadata attachment.',
      failMessage:
        'Task creation must not accept sourceName, publish source artifacts, create import events, or use input.mp4 fallbacks.',
    }),
    checkResult({
      id: 'analyze-requires-source-artifact',
      category: 'security',
      passed:
        hostContractTest.includes('analyze_task_without_source_is_rejected_without_publishing_artifacts') &&
        mockHostClientTest.includes('rejects analysis for draft tasks without source artifacts') &&
        hostAnalyzeTaskBlock.includes('SOURCE_FILE_REQUIRED') &&
        hostAnalyzeTaskBlock.includes('A source file must be uploaded before analysis.') &&
        mockAnalyzeTaskBlock.includes("item.kind === 'source'") &&
        mockAnalyzeTaskBlock.includes('A source file must be uploaded before analysis.') &&
        openApi.includes('SOURCE_FILE_REQUIRED') &&
        workbenchPage.includes('const canAnalyze') &&
        workbenchPage.includes("selectedTask?.status !== 'draft'") &&
        workbenchPage.includes('Boolean(selectedTask?.sourceName)'),
      evidence: 'Analyze is blocked until a real source artifact exists in Host, mock adapter, and Workbench UI.',
      failMessage:
        'Analyze must reject draft/no-source tasks and the Workbench Analyze action must require a selected source.',
    }),
    checkResult({
      id: 'sample-import-uses-upload-boundary',
      category: 'security',
      passed:
        importSampleBlock.includes('uploadTaskSourceFile') &&
        importSampleBlock.includes('createSampleVideoFile()') &&
        !importSampleBlock.includes('attachTaskSource') &&
        sampleVideo.includes('new File') &&
        sampleVideo.includes("'interview.mp4'") &&
        sampleVideo.includes("'video/mp4'") &&
        appShellTest.includes('Source video uploaded to workspace.'),
      evidence: 'Sample import uses the same multipart source upload boundary as user-selected files.',
      failMessage:
        'Sample import must upload a real sample File and must not create a metadata-only source placeholder.',
    }),
    checkResult({
      id: 'source-media-type-guard',
      category: 'security',
      passed:
        hostLib.includes('SOURCE_FILE_TYPE_UNSUPPORTED') &&
        hostContractTest.includes('upload_task_source_file_rejects_non_video_source_media') &&
        hostContractTest.includes('attach_task_source_rejects_non_video_source_media') &&
        mockHostClient.includes('validateSourceMediaType') &&
        workbenchPage.includes('.mp4,.mov,.m4v,.mkv,.webm,.avi,.mpeg,.mpg,video/*') &&
        openApi.includes('SOURCE_FILE_TYPE_UNSUPPORTED'),
      evidence: 'Source upload and metadata attachment reject unsupported non-video media before replacing source artifacts.',
      failMessage:
        'Source upload must enforce supported video extensions/content types in Host, mock client, Workbench, tests, and OpenAPI.',
    }),
    checkResult({
      id: 'asset-catalog-standard-contract',
      category: 'security',
      passed:
        hostContractTest.includes('asset_catalog_lists_configured_audio_asset_packs_without_leaking_local_paths') &&
        hostLib.includes('/api/video-cut/v1/assets/catalog') &&
        hostLib.includes('asset_catalog_document(&guard.settings)') &&
        hostMediaAssets.includes('video-cut.asset-catalog.schema.v1') &&
        hostMediaAssets.includes('<server-local-path>') &&
        hostMediaAssets.includes('assets://{kind}/{file_name}') &&
        videoCutTypes.includes('export interface AssetCatalog') &&
        httpHostClient.includes("request<AssetCatalog>('/assets/catalog')") &&
        httpHostClientTest.includes('reads the asset catalog through the standard asset repository endpoint') &&
        mockHostClient.includes('toAssetCatalog') &&
        mockHostClientTest.includes('returns a standard asset catalog without leaking absolute local asset paths') &&
        appShell.includes('client.getAssetCatalog()') &&
        settingsPanels.includes('Asset pack catalog') &&
        settingsCenterTest.includes('video-cut.asset-catalog.schema.v1') &&
        openApi.includes('/assets/catalog:') &&
        openApi.includes('AssetCatalogEnvelope') &&
        openApiContractTest.includes('declares the standard asset catalog endpoint and schema') &&
        prd.includes('GET /api/video-cut/v1/assets/catalog') &&
        mediaPipelineStandard.includes('AssetCatalog') &&
        governanceStandard.includes('asset catalog guard'),
      evidence:
        'Asset catalog is exposed through Host, OpenAPI, HTTP/mock clients, Settings Center, tests, and redacted server-local paths.',
      failMessage:
        'Asset pack management must use the standard /assets/catalog contract and must not expose server-local filesystem paths.',
    }),
    checkResult({
      id: 'render-asset-preferences-standard-contract',
      category: 'security',
      passed:
        hostContractTest.includes('render_task_uses_plan_selected_audio_assets_without_leaking_paths') &&
        hostMediaAssets.includes('select_render_audio_assets_for_plan') &&
        hostMediaAssets.includes('RenderAssetPreferenceMode::Disabled') &&
        hostLib.includes('validate_render_preferences(document.get("renderPreferences"))') &&
        hostLib.includes('renderPreferences.audio.bgm') &&
        mediaContracts.includes('export interface RenderPreferences') &&
        mediaContracts.includes('RenderAssetPreferenceMode') &&
        mediaContracts.includes('RENDER_ASSET_REFERENCE_INVALID') &&
        workbenchPage.includes('aria-label="Render asset preferences"') &&
        workbenchPage.includes('Save render assets') &&
        appShell.includes('saveRenderAssetPreferences') &&
        appShellTest.includes('lets the user save render asset preferences from the workbench catalog') &&
        openApi.includes('RenderPreferences:') &&
        openApi.includes('RenderAudioAssetPreference:') &&
        openApi.includes('renderPreferences') &&
        openApiContractTest.includes('declares split-plan render asset preferences as a standard catalog-backed contract') &&
        prd.includes('renderPreferences') &&
        mediaPipelineStandard.includes('renderPreferences') &&
        governanceStandard.includes('render asset preference guard'),
      evidence:
        'Render asset preferences are stored on split plans, validated by Host and TypeScript contracts, selectable in Workbench, and resolved through the redacted asset catalog.',
      failMessage:
        'BGM/SFX user selection must be a split-plan renderPreferences contract backed by /assets/catalog and must not expose server-local paths.',
    }),
    checkResult({
      id: 'task-event-recovery-hints-standard-contract',
      category: 'security',
      passed:
        hostContractTest.includes('RENDER_FAILED_REVIEW_LOG') &&
        hostModels.includes('pub(crate) struct TaskRecoveryHint') &&
        hostModels.includes('pub(crate) struct VideoCutProgressEventMetadata') &&
        hostState.includes('render_failure_recovery_metadata') &&
        hostState.includes('Open the render log artifact, verify FFmpeg/media settings') &&
        hostLib.includes('push_event_with_metadata') &&
        videoCutTypes.includes('export interface TaskRecoveryHint') &&
        videoCutTypes.includes('export interface VideoCutProgressEventMetadata') &&
        taskRecovery.includes('latestTaskRecoveryHint') &&
        queuePage.includes('latestTaskRecoveryHint(events, selectedTaskId)') &&
        queuePage.includes('aria-label={`Recovery hint for ${taskLabel(task)}`}') &&
        workbenchPage.includes('event.metadata?.recoveryHint') &&
        appShell.includes('events={events}') &&
        appShellTest.includes('shows recovery hints from task event metadata in the workbench and queue') &&
        openApi.includes('TaskRecoveryHint:') &&
        openApi.includes('VideoCutProgressEventMetadata:') &&
        openApi.includes('must not contain secrets or server-local paths') &&
        openApiContractTest.includes('declares task event recovery hints as standard redacted metadata') &&
        prd.includes('metadata.recoveryHint') &&
        governanceStandard.includes('task event recovery hint guard'),
      evidence:
        'Task failure recovery hints are emitted by Host event metadata, declared in OpenAPI, typed in the frontend, and surfaced in Workbench and Queue without server-local path leakage.',
      failMessage:
        'Task recovery hints must use VideoCutProgressEvent.metadata.recoveryHint across Host, OpenAPI, frontend types, Workbench, Queue, docs, and governance.',
    }),
    checkResult({
      id: 'diagnostics-support-bundle-consent-guard',
      category: 'security',
      passed:
        hostContractTest.includes('diagnostics_support_bundle_requires_explicit_consent_for_sensitive_attachments') &&
        hostContractTest.includes('DIAGNOSTICS_CONSENT_REQUIRED') &&
        hostContractTest.includes('diagnostics_support_bundle_exports_safe_attachment_descriptors_after_consent') &&
        hostLib.includes('/api/video-cut/v1/diagnostics/support-bundle') &&
        hostLib.includes('DiagnosticSupportBundleRequest') &&
        hostLib.includes('Explicit user consent is required') &&
        videoCutTypes.includes('export interface DiagnosticSupportBundleRequest') &&
        videoCutTypes.includes('export interface DiagnosticBundleArtifact') &&
        diagnosticBundleExport.includes('contentRef') &&
        httpHostClient.includes('getDiagnosticSupportBundle') &&
        mockHostClient.includes('toDiagnosticSupportBundle') &&
        diagnosticSupportBundleCard.includes('I understand this support bundle may include task media or transcript data') &&
        appShell.includes('exportDiagnosticSupportBundle') &&
        appShellTest.includes('requires explicit consent before exporting diagnostics support attachments') &&
        openApi.includes('/diagnostics/support-bundle:') &&
        openApi.includes('DiagnosticSupportBundleRequest:') &&
        openApiContractTest.includes('declares explicit-consent diagnostics support bundle attachments') &&
        prd.includes('POST /api/video-cut/v1/diagnostics/support-bundle') &&
        governanceStandard.includes('diagnostics support bundle consent guard'),
      evidence:
        'Diagnostics support attachments require per-export consent and expose only host-relative artifact descriptors across Host, OpenAPI, clients, UI, and governance.',
      failMessage:
        'Diagnostics support bundles must require explicit consent and must not expose source media or transcript references through local absolute paths.',
    }),
    checkResult({
      id: 'json-request-rejection-envelope-guard',
      category: 'security',
      passed:
        hostContractTest.includes('malformed_json_requests_return_standard_error_envelope') &&
        hostContractTest.includes('REQUEST_JSON_INVALID') &&
        hostLib.includes('struct ApiJson<T>') &&
        hostLib.includes('impl<S, T> FromRequest<S> for ApiJson<T>') &&
        hostLib.includes('Json::<T>::from_request(req, state)') &&
        hostLib.includes('json_request_invalid') &&
        hostState.includes('pub(crate) fn json_request_invalid') &&
        openApi.includes('REQUEST_JSON_INVALID') &&
        openApi.includes('BadRequestError:') &&
        openApiContractTest.includes('REQUEST_JSON_INVALID') &&
        prd.includes('REQUEST_JSON_INVALID') &&
        governanceStandard.includes('JSON request rejection envelope guard'),
      evidence:
        'Malformed or schema-incompatible JSON request bodies are normalized into ApiErrorEnvelope with REQUEST_JSON_INVALID.',
      failMessage:
        'JSON extractor rejections must return the standard application/json ApiErrorEnvelope instead of Axum text/plain bodies.',
    }),
    checkResult({
      id: 'multipart-request-rejection-envelope-guard',
      category: 'security',
      passed:
        hostContractTest.includes('malformed_multipart_requests_return_standard_error_envelope') &&
        hostContractTest.includes('MULTIPART_INVALID') &&
        hostLib.includes('struct ApiMultipart(Multipart)') &&
        hostLib.includes('impl<S> FromRequest<S> for ApiMultipart') &&
        hostLib.includes('Multipart::from_request(req, state)') &&
        hostLib.includes('api_multipart_rejection') &&
        openApi.includes('MULTIPART_INVALID') &&
        openApiContractTest.includes('MULTIPART_INVALID') &&
        prd.includes('MULTIPART_INVALID') &&
        governanceStandard.includes('multipart request rejection envelope guard'),
      evidence:
        'Malformed multipart upload requests are normalized into ApiErrorEnvelope with MULTIPART_INVALID before public upload handlers run.',
      failMessage:
        'Multipart extractor rejections must return the standard application/json ApiErrorEnvelope instead of Axum text/plain bodies.',
    }),
    checkResult({
      id: 'path-parameter-rejection-envelope-guard',
      category: 'security',
      passed:
        hostContractTest.includes('invalid_path_parameters_return_standard_error_envelope') &&
        hostContractTest.includes('PATH_PARAMETER_INVALID') &&
        hostLib.includes('struct ApiPath<T>') &&
        hostLib.includes('impl<S, T> FromRequestParts<S> for ApiPath<T>') &&
        hostLib.includes('Path::<T>::from_request_parts(parts, state)') &&
        hostLib.includes('api_path_rejection') &&
        hostState.includes('pub(crate) fn path_parameter_invalid') &&
        !hostLib.includes('Path(task_id): Path<String>') &&
        !hostLib.includes('Path((task_id, artifact_id)): Path<(String, String)>') &&
        openApi.includes('PATH_PARAMETER_INVALID') &&
        openApiContractTest.includes('PATH_PARAMETER_INVALID') &&
        prd.includes('PATH_PARAMETER_INVALID') &&
        governanceStandard.includes('path parameter rejection envelope guard'),
      evidence:
        'Invalid public API path parameters are normalized into ApiErrorEnvelope with PATH_PARAMETER_INVALID before public handlers run.',
      failMessage:
        'Path extractor rejections must return the standard application/json ApiErrorEnvelope instead of Axum text/plain bodies.',
    }),
    checkResult({
      id: 'query-parameter-extraction-standard-guard',
      category: 'security',
      passed:
        hostLib.includes('struct ApiQuery<T>') &&
        hostLib.includes('impl<S, T> FromRequestParts<S> for ApiQuery<T>') &&
        hostLib.includes('Query::<T>::from_request_parts(parts, state)') &&
        hostLib.includes('api_query_rejection') &&
        hostState.includes('pub(crate) fn query_parameter_invalid') &&
        !hostLib.includes('Query(query): Query<SubtitleExportQuery>') &&
        openApi.includes('QUERY_PARAMETER_INVALID') &&
        openApiContractTest.includes('QUERY_PARAMETER_INVALID') &&
        prd.includes('QUERY_PARAMETER_INVALID') &&
        governanceStandard.includes('query parameter extraction standard guard'),
      evidence:
        'Public API query parameters are extracted through the Host query boundary and future query deserialization failures map to QUERY_PARAMETER_INVALID.',
      failMessage:
        'Public API query extractors must use the Host ApiQuery boundary instead of naked Axum Query extractors.',
    }),
    checkResult({
      id: 'http-host-client-error-normalization-guard',
      category: 'security',
      passed:
        httpHostClient.includes('function toHostApiError') &&
        httpHostClient.includes('function isErrorEnvelope') &&
        httpHostClient.includes('function parseJsonTextSafely') &&
        httpHostClient.includes('throw toHostApiError({ body, endpoint, response })') &&
        httpHostClientTest.includes('rejects standard error envelopes returned from text artifact reads even when status is 200') &&
        httpHostClientTest.includes('rejects standard error envelopes returned from binary artifact reads even when status is 200') &&
        prd.includes('HTTP Host client must normalize standard error envelopes') &&
        governanceStandard.includes('HTTP Host client error normalization guard'),
      evidence:
        'The HTTP Host client parses standard error envelopes consistently for JSON, text artifact, and binary artifact reads.',
      failMessage:
        'HTTP Host client JSON/text/blob request paths must share standard error-envelope parsing and throw VideoCutHostApiError consistently.',
    }),
    checkResult({
      id: 'http-host-client-success-envelope-guard',
      category: 'security',
      passed:
        httpHostClient.includes('function isSuccessEnvelope<T>') &&
        httpHostClient.includes('function invalidSuccessEnvelopeError') &&
        httpHostClient.includes("code: 'RESPONSE_ENVELOPE_INVALID'") &&
        httpHostClient.includes('if (!isSuccessEnvelope<T>(body))') &&
        httpHostClient.includes('return body.data') &&
        httpHostClientTest.includes('rejects successful JSON API responses that do not use the standard success envelope') &&
        httpHostClientTest.includes('RESPONSE_ENVELOPE_INVALID') &&
        prd.includes('RESPONSE_ENVELOPE_INVALID') &&
        governanceStandard.includes('HTTP Host client success envelope guard'),
      evidence:
        'The HTTP Host client rejects 2xx JSON API responses that are not standard { ok: true, data } envelopes.',
      failMessage:
        'HTTP Host client JSON API request paths must reject malformed success envelopes instead of returning undefined or untyped payloads.',
    }),
    checkResult({
      id: 'runtime-cors-origin-allowlist-guard',
      category: 'security',
      passed:
        hostLib.includes('cors_layer_from_settings') &&
        hostLib.includes('AllowOrigin::list') &&
        !hostLib.includes('allow_origin(Any)') &&
        hostContractTest.includes('cors_preflight_uses_configured_origin_allowlist') &&
        runtimeConfigTest.includes('SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS') &&
        settingsPanels.includes('CORS origins') &&
        openApi.includes('corsAllowedOrigins') &&
        openApiContractTest.includes('declares CORS origin allowlist as part of the security settings contract') &&
        prd.includes('security.corsAllowedOrigins') &&
        governanceStandard.includes('runtime CORS origin allowlist guard'),
      evidence:
        'Runtime CORS uses security.corsAllowedOrigins and SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS instead of wildcard origins.',
      failMessage:
        'Host CORS must be driven by security.corsAllowedOrigins and must not use allow_origin(Any).',
    }),
    checkResult({
      id: 'results-artifact-error-metadata-guard',
      category: 'security',
      passed:
        resultsPage.includes('function InlineOperationError') &&
        resultsPage.includes("toOperationError(error, 'Load artifact content failed')") &&
        resultsPage.includes("toOperationError(error, 'Load render manifest failed')") &&
        resultsPage.includes("toOperationError(error, 'Download artifact failed')") &&
        resultsPage.includes('operation-error-meta') &&
        resultsPageTest.includes('shows standard host metadata when artifact preview content fails') &&
        resultsPageTest.includes('shows standard host metadata when the render manifest cannot be loaded') &&
        resultsPageTest.includes('shows standard host metadata when an artifact download cannot be prepared') &&
        prd.includes('Results page must render artifact preview, manifest, and download failures') &&
        governanceStandard.includes('Results artifact error metadata guard'),
      evidence:
        'Results page artifact preview, manifest, and download errors preserve standard Host metadata for operators.',
      failMessage:
        'Results artifact error handling must preserve code, HTTP status, traceId, and endpoint instead of displaying only a message string.',
    }),
    checkResult({
      id: 'no-public-artifact-content-url-helper-guard',
      category: 'security',
      passed:
        !videoCutHostClientPort.includes('getArtifactContentUrl') &&
        !httpHostClient.includes('getArtifactContentUrl') &&
        !mockHostClient.includes('getArtifactContentUrl') &&
        !httpHostClientTest.includes('getArtifactContentUrl') &&
        prd.includes('Direct artifact content URL helpers are forbidden') &&
        governanceStandard.includes('public artifact content URL helper guard'),
      evidence:
        'The frontend Host client port exposes only authenticated Blob/text artifact readers, not reusable private content URLs.',
      failMessage:
        'Frontend Host client ports must not expose getArtifactContentUrl; authenticated artifact access must go through Blob/text readers.',
    }),
    checkResult({
      id: 'task-plan-load-error-propagation-guard',
      category: 'security',
      passed:
        appShell.includes('function isMissingTaskPlanError') &&
        appShell.includes("code === 'TASK_PLAN_NOT_FOUND'") &&
        !appShell.includes('status === 404') &&
        appShell.includes('throw error') &&
        appShell.includes('function shouldReadTaskPlan') &&
        appShell.includes("task.status === 'draft'") &&
        appShell.includes("task.status === 'sourceReady'") &&
        hostState.includes('pub(crate) fn task_plan_not_found') &&
        hostLib.includes('task_plan_not_found(&task_id)') &&
        !appShell.includes('getTaskPlan(initialTaskId).catch(() => undefined)') &&
        !appShell.includes('getTaskPlan(nextSelectedTaskId).catch(() => undefined)') &&
        appShellTest.includes('does not swallow unexpected split-plan loading failures during startup') &&
        appShellTest.includes('does not swallow task-not-found split-plan failures during startup') &&
        appShellTest.includes('does not request split plans for draft tasks before analysis') &&
        hostContractTest.includes('get_task_plan_returns_task_plan_not_found_for_existing_task_without_plan') &&
        openApi.includes('TASK_PLAN_NOT_FOUND') &&
        openApiContractTest.includes('declares precise split-plan not-found codes for the task plan endpoint') &&
        prd.includes('Task plan loading may only suppress `TASK_PLAN_NOT_FOUND`') &&
        governanceStandard.includes('task plan load error propagation guard'),
      evidence:
        'Startup and task refresh avoid plan reads for draft/sourceReady tasks and only suppress TASK_PLAN_NOT_FOUND after analysis begins; TASK_NOT_FOUND and unexpected plan load failures reach OperationError.',
      failMessage:
        'Task plan loading must not request plans for draft/sourceReady tasks and must not use broad 404 or catch(() => undefined); only TASK_PLAN_NOT_FOUND may be treated as optional after analysis begins.',
    }),
    checkResult({
      id: 'mock-host-client-standard-error-guard',
      category: 'security',
      passed:
        hostApiErrors.includes('export class VideoCutHostApiError extends Error') &&
        httpHostClient.includes("export { VideoCutHostApiError } from '../domain/hostApiErrors'") &&
        mockHostClient.includes("import { VideoCutHostApiError } from '../domain/hostApiErrors'") &&
        mockHostClient.includes('function mockHostError') &&
        mockHostClient.includes("code: 'TASK_NOT_FOUND'") &&
        mockHostClient.includes("code: 'SOURCE_FILE_TYPE_UNSUPPORTED'") &&
        mockHostClient.includes("code: 'SOURCE_FILE_REQUIRED'") &&
        mockHostClient.includes("code: 'ARTIFACT_NOT_FOUND'") &&
        mockHostClient.includes("code: 'DIAGNOSTICS_CONSENT_REQUIRED'") &&
        mockHostClientTest.includes('throws standard host api errors for missing tasks in local mock mode') &&
        mockHostClientTest.includes('throws standard host api errors for invalid source uploads in local mock mode') &&
        mockHostClientTest.includes('throws standard host api errors for missing artifacts in local mock mode') &&
        prd.includes('Local mock mode must throw the same standard host API error shape') &&
        governanceStandard.includes('mock Host client standard error guard'),
      evidence:
        'Local mock mode exposes the same code/status/traceId/endpoint error metadata shape as HTTP Host mode.',
      failMessage:
        'Mock Host client public methods must throw VideoCutHostApiError with code, status, traceId, and endpoint for user-visible failures.',
    }),
    checkResult({
      id: 'api-route-not-found-envelope-guard',
      category: 'security',
      passed:
        hostContractTest.includes('unknown_api_routes_return_standard_error_envelope') &&
        hostContractTest.includes('ROUTE_NOT_FOUND') &&
        hostLib.includes('.fallback(api_route_not_found)') &&
        hostLib.includes('async fn api_route_not_found() -> HostError') &&
        hostState.includes('pub(crate) fn route_not_found') &&
        openApi.includes('ROUTE_NOT_FOUND') &&
        openApiContractTest.includes('ROUTE_NOT_FOUND') &&
        prd.includes('ROUTE_NOT_FOUND') &&
        governanceStandard.includes('API route not found envelope guard'),
      evidence:
        'Unknown public API routes return the standard application/json ApiErrorEnvelope with ROUTE_NOT_FOUND.',
      failMessage:
        'Unknown public API routes must return the standard application/json ApiErrorEnvelope instead of framework default 404 bodies.',
    }),
    checkResult({
      id: 'api-method-not-allowed-envelope-guard',
      category: 'security',
      passed:
        hostContractTest.includes('unsupported_api_methods_return_standard_error_envelope') &&
        hostContractTest.includes('METHOD_NOT_ALLOWED') &&
        hostLib.includes('.method_not_allowed_fallback(api_method_not_allowed)') &&
        hostLib.includes('async fn api_method_not_allowed() -> HostError') &&
        hostState.includes('pub(crate) fn method_not_allowed') &&
        openApi.includes('METHOD_NOT_ALLOWED') &&
        openApiContractTest.includes('METHOD_NOT_ALLOWED') &&
        prd.includes('METHOD_NOT_ALLOWED') &&
        governanceStandard.includes('API method not allowed envelope guard'),
      evidence:
        'Unsupported methods on known public API routes return the standard application/json ApiErrorEnvelope with METHOD_NOT_ALLOWED.',
      failMessage:
        'Unsupported public API methods must return the standard application/json ApiErrorEnvelope instead of framework default 405 bodies.',
    }),
    checkResult({
      id: 'artifact-metadata-uses-content-hashes',
      category: 'security',
      passed:
        hostContractTest.includes('assert_eq!(upload_response["data"]["sha256"], sha256_hex(source_bytes))') &&
        hostContractTest.includes('media_info_artifact["sha256"]') &&
        hostContractTest.includes('plan_artifact["sha256"]') &&
        hostState.includes('pub(crate) sha256: String') &&
        (hostState.includes('Sha256::digest(bytes)') || hostLib.includes('hasher.finalize()')) &&
        hostState.includes('Sha256::digest(&bytes)') &&
        hostLib.includes('sha256: stored_source.sha256') &&
        hostLib.includes('sha256: stored_media_info.sha256') &&
        hostLib.includes('json_artifact_metadata(&plan_document)') &&
        !hostAnalyzeTaskBlock.includes('size_bytes: 18_400') &&
        !hostAnalyzeTaskBlock.includes('sha256: pseudo_hash(&format!("{task_id}-plan"))'),
      evidence: 'Uploaded source, analysis JSON, audio, and plan artifacts use content-derived size and SHA-256 metadata.',
      failMessage:
        'Artifact metadata must use actual serialized/file bytes for sizeBytes and sha256 instead of pseudo hashes or fixed sizes.',
    }),
    checkResult({
      id: 'plan-update-refreshes-artifact-integrity',
      category: 'security',
      passed:
        hostContractTest.includes('update_task_plan_refreshes_plan_artifact_integrity_metadata') &&
        mockHostClientTest.includes('refreshes plan artifact metadata when a split plan is saved') &&
        hostUpdateTaskPlanBlock.includes('json_artifact_metadata(&plan)') &&
        hostUpdateTaskPlanBlock.includes('artifact.artifact_id != plan_artifact_id') &&
        hostUpdateTaskPlanBlock.includes('sha256: plan_sha256') &&
        mockUpdateTaskPlanBlock.includes('jsonArtifactMetadata(plan)') &&
        mockUpdateTaskPlanBlock.includes('artifact.artifactId !== `${taskId}-plan`') &&
        mockUpdateTaskPlanBlock.includes('sha256: planMetadata.sha256'),
      evidence: 'Saving a split plan refreshes the current plan artifact size and SHA-256 in Host and mock adapters.',
      failMessage:
        'updateTaskPlan must replace the plan artifact integrity metadata after writing a new plan revision.',
    }),
    checkResult({
      id: 'plan-update-validates-split-plan-contract',
      category: 'security',
      passed:
        hostContractTest.includes('update_task_plan_rejects_task_id_mismatch_without_replacing_plan_artifact') &&
        hostContractTest.includes('update_task_plan_rejects_invalid_split_plan_without_replacing_plan_artifact') &&
        hostUpdateTaskPlanBlock.includes('validate_split_plan_update(&task_id, &plan)') &&
        hostLib.includes('PLAN_TASK_ID_MISMATCH') &&
        hostLib.includes('PLAN_INVALID') &&
        hostLib.includes('validate_plan_tracks') &&
        hostLib.includes('validate_plan_segments') &&
        openApi.includes('PLAN_TASK_ID_MISMATCH') &&
        openApi.includes('PLAN_INVALID') &&
        prd.includes('PLAN_TASK_ID_MISMATCH') &&
        dataStorageStandard.includes('PLAN_INVALID') &&
        governanceStandard.includes('plan update validation guard'),
      evidence:
        'Host plan saves validate split-plan schema, ownership, tracks, and segments before replacing plan artifact metadata.',
      failMessage:
        'updateTaskPlan must reject invalid split plans or taskId mismatches before mutating the plan document or artifact manifest.',
    }),
    checkResult({
      id: 'local-storage-secret-redaction',
      category: 'security',
      passed:
        mockHostClient.includes('window.localStorage.setItem') &&
        mockHostClient.includes('delete nextSettings.ai.apiKey') &&
        mockHostClient.includes('delete nextSettings.speechToText.apiKey'),
      evidence: 'Browser mock persistence strips write-only AI and STT secret fields.',
      failMessage: 'Browser persistence must strip write-only AI and STT secret fields before localStorage writes.',
    }),
    checkResult({
      id: 'frontend-no-vite-server-token-secret',
      category: 'security',
      passed:
        viteServerTokenBoundaryViolations.length === 0 &&
        videoCutHostClientFactory.includes('__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__') &&
        !videoCutHostClientFactory.includes("readEnv('VITE_VIDEO_CUT_SERVER_TOKEN')"),
      evidence:
        'Browser Host client does not read server bearer tokens from Vite build-time environment variables.',
      failMessage: `Server bearer tokens must not use VITE_* build-time variables in browser-delivered code: ${viteServerTokenBoundaryViolations.join(', ')}`,
    }),
    checkResult({
      id: 'frontend-no-legacy-runtime-auth-token-global',
      category: 'security',
      passed:
        legacyBrowserAuthTokenGlobalViolations.length === 0 &&
        videoCutHostClientFactory.includes('__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__'),
      evidence:
        'Browser runtime Host URL and auth token injection use the single __SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__ object.',
      failMessage: `Browser runtime auth must use __SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__ only, not legacy token-only globals: ${legacyBrowserAuthTokenGlobalViolations.join(', ')}`,
    }),
    checkResult({
      id: 'frontend-no-vite-host-runtime-config',
      category: 'security',
      passed:
        viteHostRuntimeBoundaryViolations.length === 0 &&
        videoCutHostClientFactory.includes('__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__') &&
        !videoCutHostClientFactory.includes("readEnv('VITE_VIDEO_CUT_HOST_MODE')") &&
        !videoCutHostClientFactory.includes("readEnv('VITE_VIDEO_CUT_HOST_BASE_URL')"),
      evidence:
        'Browser Host client uses same-origin defaults or runtime-injected Host settings instead of Vite build-time Host configuration.',
      failMessage: `Host runtime configuration must not use VITE_* build-time variables in browser-delivered code: ${viteHostRuntimeBoundaryViolations.join(', ')}`,
    }),
    checkResult({
      id: 'browser-child-process-env-sanitized',
      category: 'security',
      passed:
        browserChildEnvUtility.includes('createBrowserChildProcessEnv') &&
        browserChildEnvUtility.includes('PRODUCT_ENV_PREFIX') &&
        browserChildEnvUtility.includes('BROWSER_EXPOSED_ENV_PREFIX') &&
        browserChildEnvUtility.includes('normalizedKey') &&
        browserChildEnvUtility.includes('SDKWORK_VIDEO_CUT_') &&
        browserChildEnvUtility.includes('VIDEO_CUT_') &&
        browserChildEnvUtility.includes('startsWith(PRODUCT_ENV_PREFIX)') &&
        browserChildEnvConsumerViolations.length === 0,
      evidence:
        'Browser-facing dev and smoke child processes strip VITE_*, SDKWORK_VIDEO_CUT_*, and legacy VIDEO_CUT_* environment variables before launching frontend runtimes.',
      failMessage: `Frontend child processes must use scripts/lib/safe-env.mjs createBrowserChildProcessEnv to avoid inheriting VITE_*, SDKWORK_VIDEO_CUT_*, or legacy VIDEO_CUT_* values: ${browserChildEnvConsumerViolations.join(', ')}`,
    }),
  ];
}

function licenseChecks(projectRoot, reportRoot) {
  const sbomPath = resolve(reportRoot, 'sdkwork-video-cut-sbom.cdx.json');
  const sbom = createCycloneDxSbom(projectRoot);
  writeReport(sbomPath, sbom);
  const packageJson = readJson(projectRoot, 'package.json');
  const cargoToml = readText(projectRoot, 'host/Cargo.toml');
  const combinedDependencyText = `${JSON.stringify(packageJson.dependencies ?? {})}\n${JSON.stringify(
    packageJson.devDependencies ?? {},
  )}\n${cargoToml}`.toLowerCase();

  return [
    checkResult({
      id: 'cyclonedx-sbom-generated',
      category: 'license',
      passed: existsSync(sbomPath) && sbom.bomFormat === 'CycloneDX' && sbom.components.length > 0,
      evidence: relative(projectRoot, sbomPath).replaceAll('\\', '/'),
      failMessage: 'CycloneDX SBOM must be generated with package and Cargo components.',
    }),
    checkResult({
      id: 'no-agpl-core-runtime-dependencies',
      category: 'license',
      passed: !combinedDependencyText.includes('agpl'),
      evidence: 'No AGPL dependency markers are present in package.json or host/Cargo.toml.',
      failMessage: 'AGPL dependencies must not enter the core runtime by default.',
    }),
    checkResult({
      id: 'rust-supply-chain-policy-documented',
      category: 'license',
      passed: readText(projectRoot, 'docs/architecture/07-technology-selection-decision-matrix.md').includes('cargo-deny + cargo-audit'),
      evidence: 'Rust cargo-deny/cargo-audit policy is documented in the technology matrix.',
      failMessage: 'Rust supply-chain policy must be documented in the technology matrix.',
    }),
  ];
}

function releaseFlowChecks(projectRoot) {
  const releaseScript = readText(projectRoot, 'scripts/release/local-release-command.mjs');
  const releaseReadyScript = readText(projectRoot, 'scripts/release/run-release-ready.mjs');
  const releaseWithGovernanceScript = readText(projectRoot, 'scripts/release/run-release-with-governance.mjs');
  const releaseMatrixScript = readText(projectRoot, 'scripts/release/run-release-matrix.mjs');
  const releaseSmokeMatrixScript = readText(projectRoot, 'scripts/release/run-release-smoke-matrix.mjs');
  const releaseSmokePreflightScript = readText(projectRoot, 'scripts/release/check-release-smoke-preflight.mjs');
  const releaseSmokeReadyScript = readText(projectRoot, 'scripts/release/run-release-smoke-ready.mjs');
  const releaseSmokeReadinessScript = readText(projectRoot, 'scripts/check-video-cut-release-smoke-readiness.mjs');
  const releaseContractsScript = readText(projectRoot, 'scripts/check-video-cut-release-contracts.mjs');
  const releaseSignatureVerifierScript = readText(projectRoot, 'scripts/verify-video-cut-release-signature.mjs');
  const deploymentArtifactsScript = readText(projectRoot, 'scripts/check-video-cut-deployment-artifacts.mjs');
  const openApiContractsScript = readText(projectRoot, 'scripts/check-video-cut-openapi-contracts.mjs');
  const smokeEvidenceContractsScript = readText(projectRoot, 'scripts/check-video-cut-smoke-evidence-contracts.mjs');
  const httpWorkflowSmokeScript = readText(projectRoot, 'scripts/run-video-cut-http-workflow-smoke.mjs');
  const managedServerSmokeScript = readText(projectRoot, 'scripts/run-video-cut-managed-server-smoke.mjs');
  const managedUiSmokeScript = readText(projectRoot, 'scripts/run-video-cut-managed-ui-smoke.mjs');
  const deploymentDoctorScript = readText(projectRoot, 'scripts/run-video-cut-deployment-doctor.mjs');
  const runtimeProfileRegistry = readText(projectRoot, 'deploy/runtime-profiles.yaml');
  const packageJson = readJson(projectRoot, 'package.json');
  const releaseScriptNames = [
    'release:ready',
    'release:package:desktop',
    'release:package:server',
    'release:package:web',
    'release:package:container',
    'release:package:kubernetes',
    'release:package:matrix',
    'release:smoke:desktop',
    'release:smoke:server',
    'release:smoke:web',
    'release:smoke:container',
    'release:smoke:kubernetes',
    'release:smoke:preflight',
    'release:smoke:matrix',
    'release:smoke:ready',
  ];
  const releaseSmokeReadinessScriptDrift =
    packageJson.scripts?.['check:release-smoke-readiness'] ===
      'node scripts/check-video-cut-release-smoke-readiness.mjs' &&
    existsSync(resolve(projectRoot, 'scripts/check-video-cut-release-smoke-readiness.mjs'))
      ? []
      : ['check:release-smoke-readiness'];
  const missingScripts = releaseScriptNames.filter((name) => !packageJson.scripts?.[name]);
  const smokeScriptNames = releaseScriptNames.filter((name) => name.startsWith('release:smoke:'));
  const packageScriptDrift = releaseScriptNames
    .filter((name) => name.startsWith('release:package:'))
    .filter((name) => name !== 'release:package:matrix')
    .filter((name) => !String(packageJson.scripts?.[name] ?? '').includes('scripts/release/run-release-with-governance.mjs package'));
  const matrixPackageScriptDrift =
    packageJson.scripts?.['release:package:matrix'] === 'node scripts/release/run-release-matrix.mjs' ? [] : ['release:package:matrix'];
  const releaseReadyScriptDrift =
    packageJson.scripts?.['release:ready'] === 'node scripts/release/run-release-ready.mjs' &&
    existsSync(resolve(projectRoot, 'scripts/release/run-release-ready.mjs'))
      ? []
      : ['release:ready'];
  const smokePreflightScriptDrift =
    packageJson.scripts?.['release:smoke:preflight'] === 'node scripts/release/check-release-smoke-preflight.mjs'
      ? []
      : ['release:smoke:preflight'];
  const smokeReadyScriptDrift =
    packageJson.scripts?.['release:smoke:ready'] === 'node scripts/release/run-release-smoke-ready.mjs' &&
    existsSync(resolve(projectRoot, 'scripts/release/run-release-smoke-ready.mjs'))
      ? []
      : ['release:smoke:ready'];
  const smokeGovernanceScriptDrift = smokeScriptNames.filter(
    (name) =>
      name !== 'release:smoke:matrix' &&
      name !== 'release:smoke:preflight' &&
      name !== 'release:smoke:ready' &&
      !String(packageJson.scripts?.[name] ?? '').includes('scripts/release/run-release-with-governance.mjs smoke'),
  );
  const smokeEvidenceViolations = smokeScriptNames.filter((name) => {
    if (name === 'release:smoke:matrix' || name === 'release:smoke:preflight' || name === 'release:smoke:ready') {
      return false;
    }
    const script = packageJson.scripts?.[name] ?? '';
    const target = name.split(':').pop();
    return (
      !script.includes('--report-path') ||
      !script.includes('--smoke-report') ||
      !script.includes(`artifacts/release/smoke/${target}-smoke-report.json`)
    );
  });
  const releaseReportPathTokens = [
    "assertProjectRelativePath('--release-assets-dir'",
    "assertProjectRelativePath('releaseAssetsDir'",
    'actionReportPath = normalizeProjectPath',
    'manifestPath = normalizeProjectPath',
    'checksumsPath = normalizeProjectPath',
    'releaseNotesPath = normalizeProjectPath',
    "createArtifactRecordFromBytes('release-notes.md'",
    'qualityGateReportPath = normalizeProjectPath',
    '.map(({ exists, absolutePath, ...artifact }) => artifact)',
    'findLocalAbsolutePath(report)',
    'reportContainsSensitiveData(report)',
  ];
  const missingReleaseReportPathTokens = releaseReportPathTokens.filter((token) => !releaseScript.includes(token));
  const releaseGovernanceEvidenceTokens = [
    'run-release-with-governance.mjs',
    'createReleaseWithGovernanceReport',
    "from '../lib/report-safety.mjs'",
    'createDeploymentArtifactsReport',
    'createOpenApiContractsReport',
    'createSmokeEvidenceContractsReport',
    'createFeatureReadinessPolicyReport',
    'createReleaseContractsReport',
    'releaseContracts: toReleaseContractsEvidence',
    'RELEASE_CONTRACTS_FAILED',
    'createReleaseSignatureVerificationReport',
    'signatureVerification: toSignatureVerificationEvidence',
    'RELEASE_SIGNATURE_VERIFICATION_FAILED',
    'video-cut.release-signature-verification.v1',
    'verify:release-signature',
    'GOVERNANCE_EVIDENCE_BUNDLE_VERSION',
    'video-cut.governance-evidence-bundle.v1',
    'governance-evidence-bundle.json',
    'createGovernanceEvidenceBundle',
    'createGovernanceEvidenceBundleReport',
    'SMOKE_EVIDENCE_BUNDLE_VERSION',
    'video-cut.smoke-evidence-bundle.v1',
    'smoke-evidence-bundle.json',
    'createSmokeEvidenceBundle',
    'createSmokeEvidenceSummary',
    'PROVENANCE_VERSION',
    'video-cut.release-provenance.v1',
    'provenance.json',
    'createReleaseProvenance',
    'artifactManifestSha256',
    "'release-notes.md'",
    'RELEASE_SIGNATURE_VERSION',
    'video-cut.release-signature.v1',
    'release-signature.json',
    'createReleaseSignature',
    "'release-notes'",
    'local-deterministic-digest',
    'createGovernanceReportDefinitions',
    'REQUIRED_GOVERNANCE_REPORTS',
    "fileName: 'cli-contracts-report.json'",
    "fileName: 'database-contracts-report.json'",
    "fileName: 'deployment-artifacts-report.json'",
    'governance-evidence-deployment-artifacts',
    "fileName: 'deployment-matrix-report.json'",
    "fileName: 'openapi-contracts-report.json'",
    'governance-evidence-openapi-contracts',
    "fileName: 'smoke-evidence-contracts-report.json'",
    'governance-evidence-smoke-evidence-contracts',
    "fileName: 'feature-readiness-report.json'",
    "fileName: 'feature-readiness-policy-report.json'",
    'video-cut.feature-readiness-policy-report.v1',
    'check:feature-readiness-policy',
    "fileName: 'governance-suite-report.json'",
    'validateGovernanceReport',
    'governance-evidence-${definition.id}',
    'summary?.blockingFailures',
    'summary?.gaps',
    'reportContainsSensitiveData(report)',
    'findLocalAbsolutePath(report)',
    'release-packages-require-governance-evidence',
  ];
  const releaseMatrixTokens = [
    "REPORT_VERSION = 'video-cut.release-matrix-report.v1'",
    "COMMAND = 'release:package:matrix'",
    "DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-matrix'",
    "MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes']",
    "from '../lib/report-safety.mjs'",
    'parseReleaseMatrixArgs',
    'createReleaseMatrixReport',
    'createReleaseWithGovernanceReport',
    'release-matrix-report.json',
    'release-matrix-target-coverage',
    'release-matrix-isolated-assets',
    'release-matrix/${target}',
    'release-matrix-redaction-and-path-safety',
    'release-signature.json',
    'signatureVerification',
    'verify:release-signature',
    'video-cut.release-signature-verification.v1',
    'provenance.json',
    'release-notes.md',
    'releaseNotes',
    'sdkwork-video-cut-sbom.cdx.json',
    'RELEASE_MATRIX_TARGET_FAILED',
    'release:package:matrix',
  ];
  const releaseReadyTokens = [
    "REPORT_VERSION = 'video-cut.release-ready-report.v1'",
    "COMMAND = 'release:ready'",
    "DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-matrix'",
    "DEFAULT_SMOKE_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix'",
    "DEFAULT_REPORT_DIR = 'artifacts/governance'",
    "from '../lib/report-safety.mjs'",
    'parseReleaseReadyArgs',
    'createReleaseReadyReport',
    'classifySmokeStatus',
    'createGovernanceReport',
    'createReleaseMatrixReport',
    'createReleaseSmokeReadyReport',
    'release-ready-report.json',
    'packageStatus',
    'smokeStatus',
    'promotionEligible',
    'environmentStatus',
    'environmentBlockers',
    'remediationSummary',
    'createRemediationSummary',
    'ffmpegPath',
    'cargoPath',
    'chromeExecutablePath',
    'bindHost',
    'timeoutMs',
    'release-ready-governance',
    'release-ready-package-matrix',
    'release-ready-smoke-ready',
    'release-ready-promotion-eligible',
    'release-ready-redaction-and-path-safety',
    'RELEASE_READY_FAILED',
    'release:ready',
  ];
  const releaseSmokeMatrixTokens = [
    "REPORT_VERSION = 'video-cut.release-smoke-matrix-report.v1'",
    "COMMAND = 'release:smoke:matrix'",
    "DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix'",
    "MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes']",
    "from '../lib/report-safety.mjs'",
    'parseReleaseSmokeMatrixArgs',
    'createReleaseSmokeMatrixReport',
    'createHttpWorkflowSmokeReport',
    'createManagedServerWorkflowSmokeReport',
    'createManagedUiWorkflowSmokeReport',
    'createSmokeEvidenceContractsReport',
    'createReleaseWithGovernanceReport',
    'release-smoke-matrix-report.json',
    'release-smoke-matrix-target-coverage',
    'release-smoke-matrix-isolated-smoke-reports',
    'release-smoke-matrix-redaction-and-path-safety',
    'RELEASE_SMOKE_MATRIX_TARGET_FAILED',
    'environmentBlockers',
    'ffmpegPath',
    'cargoPath',
    'chromeExecutablePath',
    'bindHost',
    'timeoutMs',
    'toEnvironmentBlockerEvidence',
    'release:smoke:matrix',
    'smokeEvidenceContracts',
    'signatureVerification',
  ];
  const releaseSmokePreflightTokens = [
    "REPORT_VERSION = 'video-cut.release-smoke-preflight-report.v1'",
    "COMMAND = 'release:smoke:preflight'",
    "DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix'",
    "DEFAULT_REPORT_DIR = 'artifacts/governance'",
    "from '../lib/report-safety.mjs'",
    "from '../lib/release-remediation-summary.mjs'",
    'parseReleaseSmokePreflightArgs',
    'createReleaseSmokePreflightReport',
    'release-smoke-preflight-report.json',
    'runnerConfig',
    'remediationActions',
    'release-smoke-preflight-ffmpeg-spawn',
    'release-smoke-preflight-cargo-spawn',
    'release-smoke-preflight-host-cargo-manifest',
    'release-smoke-preflight-vite-bin',
    'release-smoke-preflight-browser-executable',
    'release-smoke-preflight-local-ports',
    'release-smoke-preflight-writable-directories',
    'release-smoke-preflight-redaction-and-path-safety',
    'environmentStatus',
    'environmentBlockers',
    'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
    'RELEASE_SMOKE_ENV_BROWSER_UNAVAILABLE',
    'RELEASE_SMOKE_ENV_PORTS_UNAVAILABLE',
    'RELEASE_SMOKE_ENV_WORKSPACE_UNWRITABLE',
    'RELEASE_SMOKE_ENV_REQUIRED_FILE_MISSING',
    'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
    'RELEASE_SMOKE_PREFLIGHT_FAILED',
  ];
  const releaseSmokeReadinessTokens = [
    "REPORT_VERSION = 'video-cut.release-smoke-readiness-report.v1'",
    "COMMAND = 'check:release-smoke-readiness'",
    "DEFAULT_PREFLIGHT_REPORT_PATH = 'artifacts/governance/release-smoke-preflight-report.json'",
    "DEFAULT_MATRIX_REPORT_PATH = 'artifacts/governance/release-smoke-matrix-report.json'",
    "from './lib/report-safety.mjs'",
    "from './lib/release-remediation-summary.mjs'",
    'parseReleaseSmokeReadinessArgs',
    'createReleaseSmokeReadinessReport',
    'release-smoke-readiness-report.json',
    '--require-ready',
    'requireReady',
    'readinessStatus',
    'promotionEligible',
    'environmentStatus',
    'environmentBlockers',
    'remediationSummary',
    'createRemediationSummary',
    'release-smoke-readiness-preflight-report-contract',
    'release-smoke-readiness-matrix-report-contract',
    'release-smoke-readiness-classification-contract',
    'release-smoke-readiness-ready-required',
    'release-smoke-readiness-promotion-eligible',
    'release-smoke-readiness-environment-blockers',
    'release-smoke-readiness-target-coverage',
    'release-smoke-readiness-redaction-and-path-safety',
    'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
    'RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED',
    'RELEASE_SMOKE_ENV_BROWSER_UNAVAILABLE',
    'RELEASE_SMOKE_ENV_PORTS_UNAVAILABLE',
    'RELEASE_SMOKE_ENV_WORKSPACE_UNWRITABLE',
    'RELEASE_SMOKE_ENV_REQUIRED_FILE_MISSING',
    'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
  ];
  const releaseSmokeReadyTokens = [
    "REPORT_VERSION = 'video-cut.release-smoke-ready-report.v1'",
    "COMMAND = 'release:smoke:ready'",
    "DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix'",
    "DEFAULT_REPORT_DIR = 'artifacts/governance'",
    "from '../lib/report-safety.mjs'",
    'parseReleaseSmokeReadyArgs',
    'createReleaseSmokeReadyReport',
    'createReleaseSmokePreflightReport',
    'createReleaseSmokeMatrixReport',
    'createReleaseSmokeReadinessReport',
    'release-smoke-ready-report.json',
    'release-smoke-preflight-report.json',
    'release-smoke-matrix-report.json',
    'requireReady',
    'readinessStatus',
    'promotionEligible',
    'environmentStatus',
    'environmentBlockers',
    'remediationSummary',
    'createRemediationSummary',
    'ffmpegPath',
    'cargoPath',
    'chromeExecutablePath',
    'bindHost',
    'timeoutMs',
    'release-smoke-ready-preflight',
    'release-smoke-ready-matrix',
    'release-smoke-ready-readiness-required',
    'release-smoke-ready-promotion-eligible',
    'release-smoke-ready-redaction-and-path-safety',
    'RELEASE_SMOKE_READY_FAILED',
    'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
    'release:smoke:ready',
  ];
  const combinedReleaseGovernanceText = `${releaseScript}\n${releaseReadyScript}\n${releaseWithGovernanceScript}\n${releaseSignatureVerifierScript}\n${readText(
    projectRoot,
    'docs/architecture/10-engineering-governance-automation-standard.md',
  )}\n${readText(
    projectRoot,
    'docs/architecture/06-quality-security-observability-release-standards.md',
  )}\n${releaseMatrixScript}\n${releaseSmokeMatrixScript}\n${releaseSmokePreflightScript}\n${releaseSmokeReadyScript}\n${releaseSmokeReadinessScript}`;
  const missingReleaseGovernanceEvidenceTokens = releaseGovernanceEvidenceTokens.filter(
    (token) => !combinedReleaseGovernanceText.includes(token),
  );
  const missingReleaseMatrixTokens = releaseMatrixTokens.filter((token) => !combinedReleaseGovernanceText.includes(token));
  const missingReleaseReadyTokens = releaseReadyTokens.filter((token) => !combinedReleaseGovernanceText.includes(token));
  const missingReleaseSmokeMatrixTokens = releaseSmokeMatrixTokens.filter(
    (token) => !combinedReleaseGovernanceText.includes(token),
  );
  const missingReleaseSmokePreflightTokens = releaseSmokePreflightTokens.filter(
    (token) => !combinedReleaseGovernanceText.includes(token),
  );
  const missingReleaseSmokeReadinessTokens = releaseSmokeReadinessTokens.filter(
    (token) => !combinedReleaseGovernanceText.includes(token),
  );
  const missingReleaseSmokeReadyTokens = releaseSmokeReadyTokens.filter(
    (token) => !combinedReleaseGovernanceText.includes(token),
  );
  const matrixReportSafetyDrift = [
    ...(releaseMatrixScript.includes('function reportContainsSensitiveData') ? ['release matrix local reportContainsSensitiveData'] : []),
    ...(releaseMatrixScript.includes('function findLocalAbsolutePath') ? ['release matrix local findLocalAbsolutePath'] : []),
    ...(releaseMatrixScript.includes('function sanitizeErrorMessage') ? ['release matrix local sanitizeErrorMessage'] : []),
    ...(releaseReadyScript.includes('function reportContainsSensitiveData')
      ? ['release ready local reportContainsSensitiveData']
      : []),
    ...(releaseReadyScript.includes('function findLocalAbsolutePath')
      ? ['release ready local findLocalAbsolutePath']
      : []),
    ...(releaseReadyScript.includes('function sanitizeErrorMessage')
      ? ['release ready local sanitizeErrorMessage']
      : []),
    ...(releaseSmokeMatrixScript.includes('function reportContainsSensitiveData') ? ['release smoke matrix local reportContainsSensitiveData'] : []),
    ...(releaseSmokeMatrixScript.includes('function findLocalAbsolutePath') ? ['release smoke matrix local findLocalAbsolutePath'] : []),
    ...(releaseSmokeMatrixScript.includes('function sanitizeErrorMessage') ? ['release smoke matrix local sanitizeErrorMessage'] : []),
    ...(releaseSmokePreflightScript.includes('function reportContainsSensitiveData')
      ? ['release smoke preflight local reportContainsSensitiveData']
      : []),
    ...(releaseSmokePreflightScript.includes('function findLocalAbsolutePath')
      ? ['release smoke preflight local findLocalAbsolutePath']
      : []),
    ...(releaseSmokePreflightScript.includes('function sanitizeErrorMessage')
      ? ['release smoke preflight local sanitizeErrorMessage']
      : []),
    ...(releaseSmokeReadinessScript.includes('function reportContainsSensitiveData')
      ? ['release smoke readiness local reportContainsSensitiveData']
      : []),
    ...(releaseSmokeReadinessScript.includes('function findLocalAbsolutePath')
      ? ['release smoke readiness local findLocalAbsolutePath']
      : []),
    ...(releaseSmokeReadinessScript.includes('function sanitizeErrorMessage')
      ? ['release smoke readiness local sanitizeErrorMessage']
      : []),
    ...(releaseSmokeReadyScript.includes('function reportContainsSensitiveData')
      ? ['release smoke ready local reportContainsSensitiveData']
      : []),
    ...(releaseSmokeReadyScript.includes('function findLocalAbsolutePath')
      ? ['release smoke ready local findLocalAbsolutePath']
      : []),
    ...(releaseSmokeReadyScript.includes('function sanitizeErrorMessage')
      ? ['release smoke ready local sanitizeErrorMessage']
      : []),
  ];
  const releaseSmokePreflightIntegrationDrift = [
    ...(releaseSmokeMatrixScript.includes('createReleaseSmokePreflightReport') ? [] : ['release smoke matrix missing preflight report factory']),
    ...(releaseSmokeMatrixScript.includes('preflightImpl') ? [] : ['release smoke matrix missing injectable preflight gate']),
    ...(releaseSmokeMatrixScript.includes('RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED')
      ? []
      : ['release smoke matrix missing preflight blocked status code']),
    ...(releaseSmokeMatrixScript.includes('release-smoke-matrix-preflight')
      ? []
      : ['release smoke matrix missing preflight check evidence']),
    ...(releaseSmokeReadyScript.includes('createReleaseSmokePreflightReport')
      ? []
      : ['release smoke ready missing preflight report factory']),
    ...(releaseSmokeReadyScript.includes('createReleaseSmokeMatrixReport')
      ? []
      : ['release smoke ready missing matrix report factory']),
    ...(releaseSmokeReadyScript.includes('createReleaseSmokeReadinessReport')
      ? []
      : ['release smoke ready missing readiness report factory']),
    ...(releaseSmokeReadyScript.includes('requireReady: true')
      ? []
      : ['release smoke ready missing requireReady hard gate']),
    ...(releaseSmokeReadyScript.includes('RELEASE_SMOKE_READY_FAILED')
      ? []
      : ['release smoke ready missing failure code']),
    ...(releaseSmokePreflightScript.includes("from '../lib/release-remediation-summary.mjs'")
      ? []
      : ['release smoke preflight missing shared remediation summary import']),
    ...(releaseSmokePreflightScript.includes('function createRemediationActions')
      ? ['release smoke preflight defines local remediation action rules']
      : []),
    ...(releaseSmokePreflightScript.includes('function remediationEnvVar')
      ? ['release smoke preflight defines local remediation env var rules']
      : []),
    ...(releaseSmokePreflightScript.includes('function remediationCommandHint')
      ? ['release smoke preflight defines local remediation command hint rules']
      : []),
    ...(releaseSmokePreflightScript.includes('function remediationAction')
      ? ['release smoke preflight defines local remediation action text rules']
      : []),
    ...(releaseReadyScript.includes('createGovernanceReport')
      ? []
      : ['release ready missing governance report factory']),
    ...(releaseReadyScript.includes('createReleaseMatrixReport')
      ? []
      : ['release ready missing package matrix factory']),
    ...(releaseReadyScript.includes('createReleaseSmokeReadyReport')
      ? []
      : ['release ready missing smoke ready factory']),
    ...(releaseReadyScript.includes('release-ready-smoke-ready')
      ? []
      : ['release ready missing smoke hard gate evidence']),
  ];
  const runtimeEvidenceScripts = [
    ['http workflow smoke', httpWorkflowSmokeScript, 'authToken'],
    ['managed server smoke', managedServerSmokeScript, 'serverToken'],
    ['managed UI smoke', managedUiSmokeScript, 'serverToken'],
    ['deployment doctor', deploymentDoctorScript, 'authToken'],
  ];
  const runtimeEvidenceSafetyDrift = runtimeEvidenceScripts.flatMap(([name, script, knownSecretVariable]) => [
    ...(script.includes("from './lib/report-safety.mjs'") ? [] : [`${name} missing report-safety import`]),
    ...(script.includes('function reportContainsSensitiveData') ? [`${name} local reportContainsSensitiveData`] : []),
    ...(script.includes('function redactReport') ? [`${name} local redactReport`] : []),
    ...(script.includes('function shouldRedactLocalPath') ? [`${name} local shouldRedactLocalPath`] : []),
    ...(script.includes('function isAbsoluteLocalPath') ? [`${name} local isAbsoluteLocalPath`] : []),
    ...(redactReportReceivesKnownSecret(script, knownSecretVariable)
      ? []
      : [`${name} report redaction missing known runtime secret values`]),
  ]);
  const privateArtifactDeliveryTokens = [
    'artifactContent',
    'artifactRangeContent',
    'artifactSecurityHeaders',
    'artifacts.output.downloadMode',
    'artifacts.manifest.downloadMode',
    'artifacts.log.downloadMode',
    'host-content-endpoint',
    'artifacts.output.bytesChecked',
    'artifacts.output.mp4Signature',
    'artifacts.output.rangeChecked',
    'artifacts.output.rangeBytesChecked',
    'artifacts.output.securityHeadersChecked',
    'validateManagedServerSmokeReport',
    'validateWebSmokeReport',
    'ui.artifactContentAuthorizationVerified',
    'ui.artifactContentEndpointFetched',
    'ui.artifactDownloadAuthorizationVerified',
    'ui.artifactDownloadContentFetched',
    'ui.outputPreviewBlobUrl',
    'ui.localPathLeakVisible',
  ];
  const missingPrivateArtifactDeliveryTokens = privateArtifactDeliveryTokens.filter((token) => !releaseScript.includes(token));
  const releaseContractTokens = [
    "REPORT_VERSION = 'video-cut.release-contracts-report.v1'",
    "from './lib/report-safety.mjs'",
    "GOVERNANCE_EVIDENCE_BUNDLE_VERSION = 'video-cut.governance-evidence-bundle.v1'",
    "COMMAND = 'check:release-contracts'",
    'parseReleaseContractsArgs',
    'createReleaseContractsReport',
    'release-manifest.json',
    'quality-gate-execution-report.json',
    'SHA256SUMS.txt',
    'governance-evidence-bundle.json',
    'SMOKE_EVIDENCE_BUNDLE_VERSION',
    'video-cut.smoke-evidence-bundle.v1',
    'smoke-evidence-bundle.json',
    'PROVENANCE_VERSION',
    'video-cut.release-provenance.v1',
    'provenance.json',
    'RELEASE_SIGNATURE_VERSION',
    'video-cut.release-signature.v1',
    'release-signature.json',
    'release-notes.md',
    'sdkwork-video-cut-sbom.cdx.json',
    'checksums-match-manifest',
    'manifest-artifact-integrity',
    'release-root-generated-files-sealed',
    'checkReleaseRootGeneratedFilesSealed',
    'release-package-file-set-sealed',
    'checkReleasePackageFileSetSealed',
    'listReleasePackageFiles',
    'release-governance-evidence-contract',
    'release-smoke-evidence-bundle-contract',
    'release-provenance-contract',
    'release-signature-contract',
    'release-notes',
    'validateGovernanceReport',
    'validateGovernanceBundleReport',
    'createGovernanceReportDefinitions',
    "fileName: 'cli-contracts-report.json'",
    "fileName: 'deployment-artifacts-report.json'",
    "fileName: 'openapi-contracts-report.json'",
    "fileName: 'smoke-evidence-contracts-report.json'",
    'validateSmokeEvidenceBundle',
    'validateSmokeEvidenceSummary',
    'reportContainsSensitiveData',
    'findLocalAbsolutePath',
  ];
  const missingReleaseContractTokens = releaseContractTokens.filter((token) => !releaseContractsScript.includes(token));
  const releaseSignatureVerificationTokens = [
    "REPORT_VERSION = 'video-cut.release-signature-verification.v1'",
    "from './lib/report-safety.mjs'",
    "COMMAND = 'verify:release-signature'",
    'parseReleaseSignatureVerificationArgs',
    'createReleaseSignatureVerificationReport',
    'release-signature-standard-files-present',
    'release-signature-digest-valid',
    'release-signature-verification-redaction-and-path-safety',
    'release-signature.json',
    'release-notes.md',
    'quality-gate-execution-report.json',
    'SHA256SUMS.txt',
    'provenance.json',
    'action-report',
  ];
  const missingReleaseSignatureVerificationTokens = releaseSignatureVerificationTokens.filter(
    (token) => !releaseSignatureVerifierScript.includes(token),
  );
  const releaseReportSafetyDrift = [
    ...(releaseScript.includes('function reportContainsSensitiveData') ? ['local release local reportContainsSensitiveData'] : []),
    ...(releaseScript.includes('function findLocalAbsolutePath') ? ['local release local findLocalAbsolutePath'] : []),
    ...(releaseScript.includes('function isLocalAbsolutePath') ? ['local release local isLocalAbsolutePath'] : []),
    ...(releaseContractsScript.includes('function reportContainsSensitiveData')
      ? ['release contracts local reportContainsSensitiveData']
      : []),
    ...(releaseContractsScript.includes('function findLocalAbsolutePath') ? ['release contracts local findLocalAbsolutePath'] : []),
    ...(releaseContractsScript.includes('function isLocalAbsolutePath') ? ['release contracts local isLocalAbsolutePath'] : []),
    ...(releaseSignatureVerifierScript.includes('function reportContainsSensitiveData')
      ? ['release signature verifier local reportContainsSensitiveData']
      : []),
    ...(releaseSignatureVerifierScript.includes('function findLocalAbsolutePath')
      ? ['release signature verifier local findLocalAbsolutePath']
      : []),
    ...(releaseSignatureVerifierScript.includes('function isLocalAbsolutePath')
      ? ['release signature verifier local isLocalAbsolutePath']
      : []),
  ];
  const deploymentArtifactsTokens = [
    "REPORT_VERSION = 'video-cut.deployment-artifacts-report.v1'",
    "COMMAND = 'check:deployment-artifacts'",
    'parseDeploymentArtifactsArgs',
    'createDeploymentArtifactsReport',
    'tauri-desktop-shell-contract',
    'dockerfile-multi-target-contract',
    'docker-compose-private-runtime-contract',
    'kubernetes-chart-private-runtime-contract',
    'runtime-profiles-contract',
    'deployment-artifacts-report.json',
  ];
  const missingDeploymentArtifactsTokens = deploymentArtifactsTokens.filter(
    (token) => !deploymentArtifactsScript.includes(token),
  );
  const openApiContractsTokens = [
    "REPORT_VERSION = 'video-cut.openapi-contracts-report.v1'",
    "COMMAND = 'check:contracts'",
    'parseOpenApiContractsArgs',
    'createOpenApiContractsReport',
    'canonical-openapi-v1-surface',
    'standard-success-error-envelopes',
    'multipart-source-file-upload',
    'binary-artifact-content-serving',
    'runtime-env-template-no-vite-host-config',
    'openapi-contracts-report.json',
  ];
  const missingOpenApiContractsTokens = openApiContractsTokens.filter((token) => !openApiContractsScript.includes(token));
  const smokeEvidenceContractsTokens = [
    "REPORT_VERSION = 'video-cut.smoke-evidence-contracts-report.v1'",
    "COMMAND = 'check:smoke-evidence'",
    'parseSmokeEvidenceContractsArgs',
    'createSmokeEvidenceContractsReport',
    'http-workflow-smoke-contract',
    'managed-server-smoke-contract',
    'managed-ui-smoke-contract',
    'release-smoke-scripts-contract',
    'release-smoke-validation-contract',
    'smoke-evidence-contracts-report.json',
  ];
  const missingSmokeEvidenceContractsTokens = smokeEvidenceContractsTokens.filter(
    (token) => !smokeEvidenceContractsScript.includes(token),
  );

  return [
    checkResult({
      id: 'release-command-writes-standard-files',
      category: 'release-flow',
      passed:
        releaseScript.includes('release-manifest.json') &&
        releaseScript.includes('SHA256SUMS.txt') &&
        releaseScript.includes('release-notes.md') &&
        releaseScript.includes('quality-gate-execution-report.json') &&
        releaseScript.includes('provenance.json') &&
        releaseScript.includes('release-signature.json') &&
        releaseScript.includes('sdkwork-video-cut-sbom.cdx.json') &&
        releaseScript.includes('CONTRACT_VERSIONS'),
      evidence: 'Release command writes manifest, checksums, notes, quality gate report, provenance, signature, SBOM, and contract versions.',
      failMessage: 'Release command must write manifest, checksums, release notes, quality gate report, provenance, signature, SBOM, and contract versions.',
    }),
    checkResult({
      id: 'cli-contracts-command-present',
      category: 'release-flow',
      passed:
        packageJson.scripts?.['check:cli-contracts'] === 'node scripts/check-video-cut-cli-contracts.mjs' &&
        existsSync(resolve(projectRoot, 'scripts/check-video-cut-cli-contracts.mjs')),
      evidence: 'check:cli-contracts validates pure Node delivery CLI contracts without Vite/Vitest runtime dependencies.',
      failMessage: 'check:cli-contracts must exist and point to scripts/check-video-cut-cli-contracts.mjs.',
    }),
    checkResult({
      id: 'deployment-artifacts-command-present',
      category: 'release-flow',
      passed:
        packageJson.scripts?.['check:deployment-artifacts'] ===
          'node scripts/check-video-cut-deployment-artifacts.mjs' &&
        existsSync(resolve(projectRoot, 'scripts/check-video-cut-deployment-artifacts.mjs')) &&
        missingDeploymentArtifactsTokens.length === 0,
      evidence:
        'check:deployment-artifacts validates deployment artifacts through a pure Node JSON report without Vite/Vitest runtime dependencies.',
      failMessage: `check:deployment-artifacts must exist and validate deployment artifact contracts without Vitest. Missing: ${missingDeploymentArtifactsTokens.join(', ')}`,
    }),
    checkResult({
      id: 'openapi-contracts-command-present',
      category: 'release-flow',
      passed:
        packageJson.scripts?.['check:contracts'] === 'node scripts/check-video-cut-openapi-contracts.mjs' &&
        existsSync(resolve(projectRoot, 'scripts/check-video-cut-openapi-contracts.mjs')) &&
        missingOpenApiContractsTokens.length === 0,
      evidence:
        'check:contracts validates OpenAPI and runtime env contracts through a pure Node JSON report without Vite/Vitest runtime dependencies.',
      failMessage: `check:contracts must exist and validate OpenAPI contracts without Vitest. Missing: ${missingOpenApiContractsTokens.join(', ')}`,
    }),
    checkResult({
      id: 'smoke-evidence-contracts-command-present',
      category: 'release-flow',
      passed:
        packageJson.scripts?.['check:smoke-evidence'] ===
          'node scripts/check-video-cut-smoke-evidence-contracts.mjs' &&
        existsSync(resolve(projectRoot, 'scripts/check-video-cut-smoke-evidence-contracts.mjs')) &&
        missingSmokeEvidenceContractsTokens.length === 0,
      evidence:
        'check:smoke-evidence validates smoke evidence contracts through a pure Node JSON report without Vite/Vitest runtime dependencies.',
      failMessage: `check:smoke-evidence must exist and validate smoke evidence contracts without Vitest. Missing: ${missingSmokeEvidenceContractsTokens.join(', ')}`,
    }),
    checkResult({
      id: 'release-contracts-command-present',
      category: 'release-flow',
      passed:
        packageJson.scripts?.['check:release-contracts'] === 'node scripts/check-video-cut-release-contracts.mjs' &&
        existsSync(resolve(projectRoot, 'scripts/check-video-cut-release-contracts.mjs')) &&
        missingReleaseContractTokens.length === 0,
      evidence:
        'check:release-contracts validates release manifests, release notes, quality reports, action reports, sealed root files, recursively sealed package file sets, SHA256SUMS, provenance, signature, SBOM, artifact integrity, governance evidence, and redaction.',
      failMessage: `check:release-contracts must exist and validate release artifact contracts including sealed root files, recursively sealed package file sets, release notes, provenance, and signature. Missing: ${missingReleaseContractTokens.join(', ')}`,
    }),
    checkResult({
      id: 'release-signature-verifier-command-present',
      category: 'release-flow',
      passed:
        packageJson.scripts?.['verify:release-signature'] === 'node scripts/verify-video-cut-release-signature.mjs' &&
        existsSync(resolve(projectRoot, 'scripts/verify-video-cut-release-signature.mjs')) &&
        missingReleaseSignatureVerificationTokens.length === 0,
      evidence:
        'verify:release-signature validates the deterministic release-signature.json digest from packaged release files only.',
      failMessage: `verify:release-signature must exist and validate packaged release signature subjects. Missing: ${missingReleaseSignatureVerificationTokens.join(', ')}`,
    }),
    checkResult({
      id: 'release-runtime-profile-registry-source-of-truth',
      category: 'release-flow',
      passed:
        runtimeProfileRegistry.includes('registryVersion: video-cut.runtime-profile-registry.v1') &&
        runtimeProfileRegistry.includes('releaseTarget: desktop') &&
        runtimeProfileRegistry.includes('releaseTarget: kubernetes') &&
        releaseScript.includes("resolve(projectRoot, 'deploy/runtime-profiles.yaml')") &&
        releaseScript.includes("registry.registryVersion !== 'video-cut.runtime-profile-registry.v1'") &&
        releaseScript.includes('candidate.releaseTarget === target') &&
        !/storage:\s*['"]/.test(releaseScript),
      evidence: 'Release manifest runtimeProfile is loaded from deploy/runtime-profiles.yaml.',
      failMessage:
        'Release command must load runtimeProfile from deploy/runtime-profiles.yaml and must not use inline runtime profile fields.',
    }),
    checkResult({
      id: 'release-smoke-scripts-bind-report-evidence',
      category: 'release-flow',
      passed:
        smokeEvidenceViolations.length === 0 &&
        releaseScript.includes('--smoke-report') &&
        releaseScript.includes('validateSmokeReport') &&
        releaseScript.includes('SMOKE_REPORT_VERSIONS'),
      evidence: 'Release smoke scripts generate --report-path evidence and pass it to --smoke-report validation.',
      failMessage: `Release smoke scripts must bind report evidence: ${smokeEvidenceViolations.join(', ')}`,
    }),
    checkResult({
      id: 'release-reports-use-project-relative-paths',
      category: 'release-flow',
      passed: missingReleaseReportPathTokens.length === 0,
      evidence: 'Release reports serialize project-relative paths and reject secrets plus server-local absolute path leaks.',
      failMessage: `Release report path/redaction safeguards are missing: ${missingReleaseReportPathTokens.join(', ')}`,
    }),
    checkResult({
      id: 'release-packages-require-governance-evidence',
      category: 'release-flow',
      passed:
        missingReleaseGovernanceEvidenceTokens.length === 0 &&
        packageScriptDrift.length === 0 &&
        releaseReadyScriptDrift.length === 0 &&
        smokeGovernanceScriptDrift.length === 0 &&
        matrixPackageScriptDrift.length === 0 &&
        missingReleaseMatrixTokens.length === 0 &&
        missingReleaseReadyTokens.length === 0 &&
        missingReleaseSmokeMatrixTokens.length === 0 &&
        missingReleaseSmokePreflightTokens.length === 0 &&
        missingReleaseSmokeReadinessTokens.length === 0 &&
        missingReleaseSmokeReadyTokens.length === 0 &&
        matrixReportSafetyDrift.length === 0 &&
        releaseReportSafetyDrift.length === 0 &&
        runtimeEvidenceSafetyDrift.length === 0 &&
        releaseSmokePreflightIntegrationDrift.length === 0 &&
        smokePreflightScriptDrift.length === 0 &&
        smokeReadyScriptDrift.length === 0 &&
        releaseSmokeReadinessScriptDrift.length === 0,
      evidence:
        'Release packaging requires passed governance reports plus full release-ready, package matrix, smoke matrix, and single smoke ready gates for desktop, server, web, container, and Kubernetes, with shared report-safety enforcement across runtime evidence scripts.',
      failMessage: `Release governance evidence safeguards are missing: ${[
        ...missingReleaseGovernanceEvidenceTokens,
        ...missingReleaseMatrixTokens,
        ...missingReleaseReadyTokens,
        ...missingReleaseSmokeMatrixTokens,
        ...missingReleaseSmokePreflightTokens,
        ...missingReleaseSmokeReadinessTokens,
        ...missingReleaseSmokeReadyTokens,
        ...matrixReportSafetyDrift,
        ...releaseReportSafetyDrift,
        ...runtimeEvidenceSafetyDrift,
        ...releaseSmokePreflightIntegrationDrift,
        ...releaseReadyScriptDrift,
        ...packageScriptDrift,
        ...matrixPackageScriptDrift,
        ...smokePreflightScriptDrift,
        ...smokeReadyScriptDrift,
        ...releaseSmokeReadinessScriptDrift,
        ...smokeGovernanceScriptDrift,
      ].join(', ')}`,
    }),
    checkResult({
      id: 'release-smoke-requires-private-artifact-delivery-proof',
      category: 'release-flow',
      passed: missingPrivateArtifactDeliveryTokens.length === 0,
      evidence: 'Release smoke validation requires private artifact content, byte range, security headers, and browser blob delivery proof.',
      failMessage: `Release smoke private artifact delivery proof is incomplete: ${missingPrivateArtifactDeliveryTokens.join(', ')}`,
    }),
    checkResult({
      id: 'release-target-scripts-present',
      category: 'release-flow',
      passed: missingScripts.length === 0,
      evidence: releaseScriptNames.join(', '),
      failMessage: `Release package/smoke scripts are missing: ${missingScripts.join(', ')}`,
    }),
  ];
}

function adrChecks(projectRoot) {
  const adrFiles = listFiles(projectRoot, 'docs/architecture/adr').filter((path) => /^\d{4}-.+\.md$/.test(path.split('/').pop()));
  const adrNumbers = adrFiles
    .map((path) => Number(path.split('/').pop().slice(0, 4)))
    .sort((a, b) => a - b);
  const expectedNumbers = adrNumbers.map((_, index) => index + 1);
  const contiguous = adrNumbers.length > 0 && adrNumbers.every((number, index) => number === expectedNumbers[index]);
  const radar = readText(projectRoot, 'docs/architecture/13-adr-and-technology-radar-standard.md');

  return [
    checkResult({
      id: 'adr-numbering-contiguous',
      category: 'adr',
      passed: contiguous,
      evidence: adrFiles.join(', '),
      failMessage: `ADR numbers must start at 0001 and be contiguous. Found: ${adrNumbers.join(', ')}`,
    }),
    checkResult({
      id: 'technology-radar-present',
      category: 'adr',
      passed: radar.includes('Technology Radar') || radar.includes('技术雷达'),
      evidence: 'ADR and technology radar standard is present.',
      failMessage: 'ADR standard must include technology radar governance.',
    }),
  ];
}

function sloChecks(projectRoot) {
  const sloStandard = readText(projectRoot, 'docs/architecture/11-nonfunctional-slo-resilience-standard.md');
  const settings = readText(projectRoot, 'host/src/contracts.rs');
  const providerAdapters = `${readText(projectRoot, 'host/src/media_semantic.rs')}\n${readText(
    projectRoot,
    'host/src/speech_transcription.rs',
  )}`;
  const runtimeConfig = readText(projectRoot, 'host/src/runtime_config.rs');

  return [
    checkResult({
      id: 'slo-standard-present',
      category: 'slo',
      passed: sloStandard.includes('SLO') && sloStandard.includes('timeout') && sloStandard.includes('graceful shutdown'),
      evidence: 'Nonfunctional SLO and resilience standard documents timeout and shutdown policy.',
      failMessage: 'SLO standard must document timeout and graceful shutdown policy.',
    }),
    checkResult({
      id: 'timeout-budget-configured',
      category: 'slo',
      passed:
        settings.includes('"timeoutSeconds"') &&
        providerAdapters.includes('Duration::from_secs') &&
        providerAdapters.includes('.timeout('),
      evidence: 'Provider adapters apply configured timeoutSeconds to outbound HTTP calls.',
      failMessage: 'Provider adapters must apply configured timeoutSeconds.',
    }),
    checkResult({
      id: 'queue-backpressure-configured',
      category: 'slo',
      passed: settings.includes('"workerConcurrency"') && runtimeConfig.includes('SDKWORK_VIDEO_CUT_WORKER_CONCURRENCY'),
      evidence: 'Runtime config exposes workerConcurrency for queue/backpressure policy.',
      failMessage: 'Runtime config must expose workerConcurrency for queue/backpressure policy.',
    }),
  ];
}

function createCycloneDxSbom(projectRoot) {
  const packageJson = readJson(projectRoot, 'package.json');
  const components = [
    ...packageComponents(packageJson.dependencies ?? {}, 'npm', 'library'),
    ...packageComponents(packageJson.devDependencies ?? {}, 'npm', 'library'),
    ...cargoComponents(readText(projectRoot, 'host/Cargo.toml')),
  ].sort((left, right) => `${left.group ?? ''}/${left.name}`.localeCompare(`${right.group ?? ''}/${right.name}`));
  const hash = createHash('sha256').update(JSON.stringify(components)).digest('hex').slice(0, 32);

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(
      16,
      20,
    )}-${hash.slice(20)}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          type: 'application',
          name: 'sdkwork-video-cut-governance-suite',
          version: packageJson.version ?? '0.0.0',
        },
      ],
      component: {
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
      },
    },
    components,
  };
}

function packageComponents(dependencies, ecosystem, type) {
  return Object.entries(dependencies).map(([name, version]) => ({
    type,
    name,
    version: String(version),
    purl: ecosystem === 'npm' ? `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(String(version))}` : undefined,
  }));
}

function cargoComponents(cargoToml) {
  const components = [];
  let section = '';
  for (const rawLine of cargoToml.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'dependencies' && section !== 'dev-dependencies') {
      continue;
    }
    const dependencyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!dependencyMatch) {
      continue;
    }
    const [, name, value] = dependencyMatch;
    const quotedVersion = value.match(/"([^"]+)"/)?.[1];
    const objectVersion = value.match(/version\s*=\s*"([^"]+)"/)?.[1];
    const version = objectVersion ?? quotedVersion ?? 'workspace';
    components.push({
      type: 'library',
      name,
      version,
      purl: `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
      properties: [
        {
          name: 'sdkwork:dependency-scope',
          value: section,
        },
      ],
    });
  }
  return components;
}

function checkResult({ category, evidence, failMessage, id, passed }) {
  return {
    id,
    category,
    status: passed ? 'pass' : 'fail',
    evidence: passed ? evidence : failMessage,
  };
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function listFiles(projectRoot, relativeDir) {
  const root = resolve(projectRoot, relativeDir);
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') {
          continue;
        }
        visit(absolutePath);
        continue;
      }
      files.push(relative(projectRoot, absolutePath).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return files;
}

function readJson(projectRoot, path) {
  return JSON.parse(readText(projectRoot, path));
}

function readText(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function sectionBetween(text, startToken, endToken) {
  const start = text.indexOf(startToken);
  if (start < 0) {
    return '';
  }
  const end = text.indexOf(endToken, start + startToken.length);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function redactReportReceivesKnownSecret(script, knownSecretVariable) {
  return new RegExp(`redactReport\\s*\\([\\s\\S]*?,\\s*\\[\\s*${knownSecretVariable}\\s*]\\s*,?\\s*\\)`).test(
    script,
  );
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    `SDKWork Video Cut Governance Suite`,
    `category: ${report.category}`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.category}/${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseGovernanceArgs(process.argv.slice(2));
    const report = createGovernanceReport({ category: options.category, reportDir: options.reportDir });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reportVersion: REPORT_VERSION,
          command: COMMAND,
          status: 'fail',
          error: {
            code: 'GOVERNANCE_SUITE_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  void main();
}
