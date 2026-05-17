import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const rootDir = process.cwd();
const packagesDir = path.join(rootDir, 'packages');
const desktopPackageName = 'sdkwork-autocut-desktop';
const desktopPackageDir = path.join(packagesDir, desktopPackageName);
const desktopSrcDir = path.join(desktopPackageDir, 'src');
const desktopTauriDir = path.join(desktopPackageDir, 'src-tauri');
const internalPrefix = '@sdkwork/autocut-';
const allowedDesktopSourceFiles = new Set([
  'packages/sdkwork-autocut-desktop/src/App.tsx',
  'packages/sdkwork-autocut-desktop/src/index.ts',
  'packages/sdkwork-autocut-desktop/src/main.tsx',
  'packages/sdkwork-autocut-desktop/src/native-host.ts',
  'packages/sdkwork-autocut-desktop/src/vite-env.d.ts',
]);
const allowedDesktopPackageEntries = new Set([
  'dist',
  'index.html',
  'node_modules',
  'package.json',
  'public',
  'rust-toolchain.toml',
  'specs',
  'src',
  'src-tauri',
  'tsconfig.json',
  'vite.config.ts',
]);
const allowedDesktopPublicEntries = new Set(['favicon.svg']);
const allowedDesktopTauriEntries = new Set([
  'binaries',
  'build.rs',
  'Cargo.lock',
  'Cargo.toml',
  'capabilities',
  'database',
  'gen',
  'icons',
  'specs',
  'src',
  'target',
  'tauri.conf.json',
]);
const allowedDesktopTauriIconEntries = new Set(['icon.ico', 'icon.png']);
const allowedDesktopTauriBinariesEntries = new Set([
  'ffmpeg.toolchain.json',
  'speech-transcription.toolchain.json',
  'linux-x86_64',
  'macos-aarch64',
  'macos-x86_64',
  'windows-x86_64',
]);
const allowedDesktopTauriSrcEntries = new Set([
  'commands.rs',
  'database_contract.rs',
  'database_runtime.rs',
  'host_contract.rs',
  'llm_http_runtime.rs',
  'llm_secret_runtime.rs',
  'main.rs',
  'media_runtime.rs',
]);
const forbiddenRootRuntimeFiles = [
  '.dockerignore',
  'metadata.json',
  'package-lock.json',
  'replace_polling.mjs',
  'scaffold.ts',
  'server.ts',
  'tsconfig.node.tsbuildinfo',
  'tsconfig.node.json',
  'tsconfig.tsbuildinfo',
  'update-mock-results.ts',
];
const forbiddenRootRuntimeDirs = [
  'deploy',
  'host',
  'models',
  'workspace',
  'workspace-server-private-smoke',
];
const forbiddenTauriGeneratedDirs = ['packages/sdkwork-autocut-desktop/src-tauri/gen'];
const allowedScriptFiles = new Set([
  'scripts/autocut-release-platforms.mjs',
  'scripts/autocut-cli-args.mjs',
  'scripts/autocut-cli-args.test.mjs',
  'scripts/check-autocut-architecture.mjs',
  'scripts/check-autocut-app-manifest-release-readiness.mjs',
  'scripts/check-autocut-app-manifest-release-readiness.test.mjs',
  'scripts/check-autocut-feature-workflows.mjs',
  'scripts/check-autocut-multiplatform-release-readiness.mjs',
  'scripts/check-autocut-multiplatform-release-readiness.test.mjs',
  'scripts/check-autocut-preview-release-readiness.mjs',
  'scripts/check-autocut-preview-release-readiness.test.mjs',
  'scripts/check-autocut-release-environment.mjs',
  'scripts/check-autocut-release-environment.test.mjs',
  'scripts/check-autocut-release-evidence-status.mjs',
  'scripts/check-autocut-release-evidence-status.test.mjs',
  'scripts/check-autocut-release-workflow.test.mjs',
  'scripts/check-autocut-slicer-planner.mjs',
  'scripts/check-autocut-service-behavior.mjs',
  'scripts/check-autocut-baidunetdisk-real-media-slice.mjs',
  'scripts/check-autocut-generic-real-media-slice.mjs',
  'scripts/check-autocut-generic-real-media-slice.test.mjs',
  'scripts/check-autocut-large-media-baseline.mjs',
  'scripts/check-autocut-large-media-baseline.test.mjs',
  'scripts/check-autocut-smart-slice-performance-benchmark.mjs',
  'scripts/check-autocut-smart-slice-performance-benchmark.test.mjs',
  'scripts/check-autocut-wenan5-real-media-slice.e2e.mjs',
  'scripts/check-autocut-wenan5-real-media-slice.mjs',
  'scripts/check-autocut-wenan5-real-media-slice.test.mjs',
  'scripts/check-autocut-workspace-typecheck.mjs',
  'scripts/check-autocut-workspace-typecheck.test.mjs',
  'scripts/clean-autocut-generated.mjs',
  'scripts/ensure-autocut-tauri-rust-toolchain.mjs',
  'scripts/ensure-autocut-tauri-rust-toolchain.test.mjs',
  'scripts/prepare-autocut-ffmpeg-sidecar.mjs',
  'scripts/prepare-autocut-ffmpeg-sidecar.test.mjs',
  'scripts/prepare-autocut-release-sidecars.mjs',
  'scripts/prepare-autocut-release-sidecars.test.mjs',
  'scripts/prepare-autocut-speech-gpu-runtime.mjs',
  'scripts/prepare-autocut-speech-gpu-runtime.test.mjs',
  'scripts/prepare-autocut-speech-sidecar.mjs',
  'scripts/prepare-autocut-speech-sidecar.test.mjs',
  'scripts/run-autocut-vite.mjs',
  'scripts/run-autocut-vite.test.mjs',
  'scripts/check-autocut-release-smoke-preflight.mjs',
  'scripts/check-autocut-release-smoke-preflight.test.mjs',
  'scripts/check-autocut-commercial-release-readiness.mjs',
  'scripts/check-autocut-commercial-release-readiness.test.mjs',
  'scripts/check-autocut-smart-slice-release-fixture.mjs',
  'scripts/check-autocut-smart-slice-release-fixture.test.mjs',
  'scripts/check-autocut-smart-slice-execution-evidence.mjs',
  'scripts/check-autocut-smart-slice-execution-evidence.test.mjs',
  'scripts/check-autocut-smart-slice-task-evidence.mjs',
  'scripts/check-autocut-smart-slice-task-evidence.test.mjs',
  'scripts/check-smart-cut-engine-audit-trace.mjs',
  'scripts/check-smart-cut-engine-candidate-selection.mjs',
  'scripts/check-smart-cut-engine-content-unit-evidence-link.mjs',
  'scripts/check-smart-cut-engine-content-units.mjs',
  'scripts/check-smart-cut-engine-interfaces.mjs',
  'scripts/check-smart-cut-engine-evidence-quality.mjs',
  'scripts/check-smart-cut-engine-execution-package.mjs',
  'scripts/check-smart-cut-engine-filter-effects.mjs',
  'scripts/check-smart-cut-engine-filter-plan.mjs',
  'scripts/check-smart-cut-engine-llm-review.mjs',
  'scripts/check-smart-cut-engine-native-contract.mjs',
  'scripts/check-smart-cut-engine-pipeline.mjs',
  'scripts/check-smart-cut-engine-registry.mjs',
  'scripts/check-smart-cut-engine-render-artifacts.mjs',
  'scripts/check-smart-cut-engine-render-contract.mjs',
  'scripts/check-smart-cut-engine-semantic-boundary.mjs',
  'scripts/check-smart-cut-engine-speaker-alignment.mjs',
  'scripts/check-smart-cut-engine-speech-semantic.mjs',
  'scripts/check-smart-cut-engine-speaker-corrections.mjs',
  'scripts/check-smart-cut-engine-standard.mjs',
  'scripts/sign-autocut-release-installers.mjs',
  'scripts/sign-autocut-release-installers.test.mjs',
  'scripts/sync-autocut-app-manifest-release-evidence.mjs',
  'scripts/sync-autocut-app-manifest-release-evidence.test.mjs',
  'scripts/write-autocut-installer-signature-evidence.mjs',
  'scripts/write-autocut-installer-signature-evidence.test.mjs',
  'scripts/write-autocut-large-media-stt-baseline.mjs',
  'scripts/write-autocut-large-media-stt-baseline.test.mjs',
  'scripts/write-autocut-package-sbom-files.mjs',
  'scripts/write-autocut-package-sbom-files.test.mjs',
  'scripts/write-autocut-sbom-evidence.mjs',
  'scripts/write-autocut-sbom-evidence.test.mjs',
  'scripts/write-autocut-smart-slice-media-artifacts-evidence.mjs',
  'scripts/write-autocut-smart-slice-media-artifacts-evidence.test.mjs',
  'scripts/write-autocut-smart-slice-quality-evidence.mjs',
  'scripts/write-autocut-smart-slice-quality-evidence.test.mjs',
  'scripts/write-autocut-smart-slice-sample-evidence.mjs',
  'scripts/write-autocut-smart-slice-sample-evidence.test.mjs',
  'scripts/write-autocut-native-release-smoke.mjs',
  'scripts/write-autocut-native-release-smoke.test.mjs',
  'scripts/write-autocut-release-evidence.mjs',
  'scripts/write-autocut-release-evidence.test.mjs',
]);
const allowedDocs = new Set([
  'docs/architecture/16-autocut-frontend-module-standard.md',
  'docs/architecture/17-autocut-database-contract-standard.md',
  'docs/release/CHANGELOG.md',
  'docs/requirements/2026-05-05-smart-slicing-logic.md',
  'docs/requirements/2026-05-05-smart-slicing-short-video-implementation-review.md',
  'docs/specs/smart-cut-engine/00-smart-cut-engine-master-spec.md',
  'docs/specs/smart-cut-engine/01-industry-slicer-taxonomy.md',
  'docs/specs/smart-cut-engine/02-speech-semantic-and-speaker-pipeline.md',
  'docs/specs/smart-cut-engine/03-filter-validator-render-spec.md',
  'docs/specs/smart-cut-engine/04-rust-native-engine-spec.md',
  'docs/specs/smart-cut-engine/05-rewrite-implementation-plan.md',
  'docs/superpowers/plans/2026-05-04-autocut-desktop-standardization.md',
  'docs/superpowers/plans/2026-05-06-smart-slicing-phase-one.md',
]);
const requiredDatabaseContractDoc = 'docs/architecture/17-autocut-database-contract-standard.md';
const requiredStorageServicePath = 'packages/sdkwork-autocut-services/src/service/storage.service.ts';
const legacyStorageServicePath = 'packages/sdkwork-autocut-services/src/service/storage.ts';
const requiredRuntimeEnvironmentServicePath = 'packages/sdkwork-autocut-services/src/service/runtime-environment.service.ts';
const requiredWorkflowPreferencesServicePath = 'packages/sdkwork-autocut-services/src/service/workflow-preferences.service.ts';
const requiredSettingsServicePath = 'packages/sdkwork-autocut-services/src/service/settings.service.ts';
const requiredI18nServicePath = 'packages/sdkwork-autocut-services/src/service/i18n.service.ts';
const requiredI18nResourcesServicePath = 'packages/sdkwork-autocut-services/src/service/i18n-resources.service.ts';
const requiredSettingsRegistryPath = 'packages/sdkwork-autocut-settings/src/service/settings.registry.ts';
const requiredMediaFixturesServicePath = 'packages/sdkwork-autocut-services/src/service/media-fixtures.service.ts';
const requiredDatetimeServicePath = 'packages/sdkwork-autocut-services/src/service/datetime.service.ts';
const requiredDownloadServicePath = 'packages/sdkwork-autocut-services/src/service/download.service.ts';
const requiredProcessingSourceServicePath = 'packages/sdkwork-autocut-services/src/service/processing-source.service.ts';
const requiredNativeHostClientServicePath = 'packages/sdkwork-autocut-services/src/service/native-host-client.service.ts';
const requiredTasksServicePath = 'packages/sdkwork-autocut-services/src/service/tasks.service.ts';
const requiredAssetsServicePath = 'packages/sdkwork-autocut-services/src/service/assets.service.ts';
const requiredMessagesServicePath = 'packages/sdkwork-autocut-services/src/service/messages.service.ts';
const requiredToolsRegistryPath = 'packages/sdkwork-autocut-services/src/service/tools.registry.ts';
const requiredSlicerServicePath = 'packages/sdkwork-autocut-slicer/src/service/slicerService.ts';
const realProcessingServicePaths = [
  requiredSlicerServicePath,
  'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts',
  'packages/sdkwork-autocut-extractor-audio/src/service/audioExtractorService.ts',
  'packages/sdkwork-autocut-video-gif/src/service/videoGifService.ts',
  'packages/sdkwork-autocut-video-compress/src/service/videoCompressService.ts',
  'packages/sdkwork-autocut-video-convert/src/service/videoConvertService.ts',
  'packages/sdkwork-autocut-video-enhance/src/service/videoEnhanceService.ts',
  'packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts',
  'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts',
];
const requiredTrustedFileSourcePath = 'packages/sdkwork-autocut-commons/src/service/trusted-file-source.service.ts';
const requiredNativeHostCommandSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/commands.rs';
const requiredNativeHostContractSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/host_contract.rs';
const requiredNativeDatabaseContractSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/database_contract.rs';
const requiredNativeDatabaseRuntimeSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/database_runtime.rs';
const requiredNativeMediaRuntimeSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs';
const requiredNativeLlmHttpRuntimeSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/llm_http_runtime.rs';
const requiredNativeLlmSecretRuntimeSourcePath = 'packages/sdkwork-autocut-desktop/src-tauri/src/llm_secret_runtime.rs';
const requiredNativeFfmpegToolchainManifestPath = 'packages/sdkwork-autocut-desktop/src-tauri/binaries/ffmpeg.toolchain.json';
const requiredNativeSpeechToolchainManifestPath = 'packages/sdkwork-autocut-desktop/src-tauri/binaries/speech-transcription.toolchain.json';
const requiredNativeSqliteBaselinePath = 'packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql';
const requiredNativeSchemaRegistryPath = 'packages/sdkwork-autocut-desktop/src-tauri/database/schema-registry/autocut_host_baseline.yaml';
const allowedRootEntries = new Set([
  '.git',
  '.claude',
  '.github',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  'ARCHITECT.md',
  'COMMERCIAL-LICENSE.md',
  'DATABASE_SPEC.md',
  'LICENSE',
  'README.md',
  'artifacts',
  'docs',
  'node_modules',
  'package.json',
  'packages',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts',
  'sdkwork.app.config.json',
  'specs',
  'tsconfig.json',
]);
const requiredRoutePaths = [
  '/',
  '/tools',
  '/assets',
  '/tasks',
  '/tasks/:taskId',
  '/messages',
  '/slicer',
  '/extractor-text',
  '/extractor-audio',
  '/video-gif',
  '/video-compress',
  '/video-convert',
  '/video-enhance',
  '/video-dedup',
  '/subtitle-translate',
  '/voice-translate',
  '/settings',
];
const requiredLazyPackages = [
  '@sdkwork/autocut-home',
  '@sdkwork/autocut-tools',
  '@sdkwork/autocut-assets',
  '@sdkwork/autocut-tasks',
  '@sdkwork/autocut-messages',
  '@sdkwork/autocut-slicer',
  '@sdkwork/autocut-extractor-text',
  '@sdkwork/autocut-extractor-audio',
  '@sdkwork/autocut-video-gif',
  '@sdkwork/autocut-video-compress',
  '@sdkwork/autocut-video-convert',
  '@sdkwork/autocut-video-enhance',
  '@sdkwork/autocut-video-dedup',
  '@sdkwork/autocut-subtitle-translate',
  '@sdkwork/autocut-voice-translate',
  '@sdkwork/autocut-settings',
];
const requiredRootInternalDependencies = new Set([
  '@sdkwork/autocut-desktop',
]);
const requiredDesktopInternalDependencies = new Set([
  '@sdkwork/autocut-commons',
  '@sdkwork/autocut-core',
  ...requiredLazyPackages,
]);
const forbiddenRootDependencies = new Set(['@google/genai', 'cors', 'dotenv', 'express']);
const requiredRootToolDependencies = new Set([
  '@tailwindcss/vite',
  '@tauri-apps/api',
  '@vitejs/plugin-react',
  'vite',
]);
const requiredDesktopDependencies = new Set([
  '@tailwindcss/vite',
  '@tauri-apps/api',
  '@vitejs/plugin-react',
  'lucide-react',
  'pixi.js',
  'react',
  'react-dom',
  'react-i18next',
  'react-router-dom',
  'vite',
]);
const allowedRootDependencies = new Set([
  ...requiredRootToolDependencies,
  '@tauri-apps/cli',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  'tailwindcss',
  'typescript',
]);
const externalDependencyAllowlist = new Set([
  '@ai-sdk/openai-compatible',
  '@tauri-apps/api',
  'ai',
  'i18next',
  'lucide-react',
  'pixi.js',
  'react',
  'react-dom',
  'react-i18next',
  'react-router-dom',
]);
const requiredDatabaseSpecMarkers = [
  '# 通用数据库定义标准规范',
  'L1',
  'Schema Registry',
  'schema registry',
  '<module_prefix>',
  'DB061',
  'DB072',
  '每张表都必须同时定义 `id` 和 `uuid`',
  '`id` 的逻辑类型必须是 `int64`，语言映射为 long/64 位整数语义',
  'id',
  'uuid',
  'int64',
  'created_at',
  'updated_at',
  'version',
];
const requiredDatabaseContractMarkers = [
  'DATABASE_SPEC.md',
  '每张表都必须同时定义 `id` 和 `uuid`',
  '`id` 的逻辑类型必须是 `int64`，语言映射为 Java/Rust/TypeScript 侧的 long/64 位整数语义',
  '新建表最低合规等级为 L1',
  'schema registry',
  'media',
  'ops',
  'studio',
  'MUST NOT 使用 `autocut_`、`video_cut_`、`sdkwork_`、`plus_`',
];
const forbiddenDatabaseTablePrefixes = ['autocut', 'video_cut', 'sdkwork', 'plus', 'app', 'sys', 'common'];
const requiredStorageServiceMarkers = [
  'AUTO_CUT_STORAGE_NAMESPACE',
  'AUTO_CUT_STORAGE_KEYS',
  'AutoCutStorageKey',
  'createAutoCutStorageKey',
  'getAutoCutRuntimeEnvironment',
  'readAutoCutStorage',
  'writeAutoCutStorage',
  'removeAutoCutStorage',
];
const requiredRuntimeEnvironmentServiceMarkers = [
  'AutoCutRuntimeEnvironment',
  'configureAutoCutRuntimeEnvironment',
  'getAutoCutRuntimeEnvironment',
  'createAutoCutRuntimeScopedName',
  "'dev'",
  "'release'",
];
const requiredMediaFixturesMarkers = [
  'AUTO_CUT_MEDIA_FIXTURES',
  'getAutoCutSampleAudioUrl',
  'getAutoCutSampleGifUrl',
  'getAutoCutSampleThumbnailUrl',
  'getAutoCutSampleSliceThumbnailUrl',
];
const requiredDatetimeServiceMarkers = [
  'getAutoCutTimestampMs',
  'compareAutoCutTimestampDesc',
  'sortAutoCutRecordsByCreatedAtDesc',
  'normalizeAutoCutTimestampForParsing',
  'formatAutoCutDateTime',
  'formatAutoCutTimeOfDay',
  'formatAutoCutLocalDateTimeSecondTimestamp',
];
const requiredDownloadServiceMarkers = [
  'createAutoCutObjectUrl',
  'revokeAutoCutObjectUrl',
  'createAutoCutTextObjectUrl',
  'downloadAutoCutUrl',
  'formatExtractedText',
  'downloadExtractedTextFile',
];
const requiredProcessingSourceServiceMarkers = [
  'AutoCutProcessingSourceInput',
  'validateAutoCutProcessingSource',
  'allowExternalUrl?: boolean',
  'source media',
  'new URL',
  "parsed.protocol !== 'http:' && parsed.protocol !== 'https:'",
];
const requiredNativeHostClientServiceMarkers = [
  'AutoCutNativeInvoke',
  'AutoCutNativeHostClient',
  'sourceKind',
  'manifestReady',
  'bundledReady',
  'createAutoCutNativeHostClient',
  'AutoCutNativeAssetUrlFactory',
  'configureAutoCutNativeHostClient',
  'getAutoCutNativeHostClient',
  'autocut_host_capabilities',
  'autocut_database_health',
  'autocut_ffmpeg_probe',
  'autocut_import_media_file',
  'autocut_describe_local_media_file',
  'autocut_select_local_video_file',
  'autocut_list_native_tasks',
  'autocut_cancel_native_task',
  'autocut_recover_native_tasks',
  'autocut_retry_native_task',
  'autocut_transcribe_media',
  'autocut_extract_visual_evidence',
  'autocut_extract_audio',
  'autocut_extract_audio_fingerprint',
  'autocut_generate_gif',
  'autocut_slice_video',
  'autocut_compress_video',
  'autocut_convert_video',
  'autocut_enhance_video',
  'autocut_audio_smoke',
  'assetUuid',
  'outputRootDir',
  'mediaImportCommandReady',
  'mediaFileDescribeCommandReady',
  'localVideoFileSelectCommandReady',
  'localDirectorySelectCommandReady',
  'openArtifactInFolderCommandReady',
  'nativeTaskQueryCommandReady',
  'nativeTaskCancelCommandReady',
  'nativeTaskRecoveryCommandReady',
  'nativeTaskRetryCommandReady',
  'nativeTaskProgressEventsReady',
  'nativeWorkerLeaseReady',
  'audioExtractionFromAssetReady',
  'audioFingerprintCommandReady',
  'audioFingerprintAdapterReady',
  'videoGifCommandReady',
  'videoSliceCommandReady',
  'videoCompressCommandReady',
  'videoConvertCommandReady',
  'videoEnhanceCommandReady',
  'speechTranscriptionCommandReady',
  'speechTranscriptionToolchainReady',
  'visualEvidenceExtractionContractReady',
  'visualEvidenceExtractionCommandReady',
  'visualEvidenceExtractionAdapterReady',
  'AutoCutVisualEvidenceExtractionRequest',
  'AutoCutVisualEvidenceExtractionResult',
  'extractVisualEvidence',
  'AutoCutAudioFingerprintRequest',
  'AutoCutAudioFingerprintResult',
  'fingerprintAudio',
  'AutoCutSpeechTranscriptionRequest',
  'AutoCutSpeechTranscriptionResult',
  'AutoCutSpeechTranscriptionSegment',
  'providerId',
  'transcribeMedia',
  'AutoCutVideoGifRequest',
  'AutoCutVideoGifResult',
  'generateGif',
  'AutoCutVideoSliceRequest',
  'AutoCutVideoSliceArtifactResult',
  'AutoCutVideoSliceResult',
  'sliceVideo',
  'thumbnailArtifactUuid',
  'thumbnailArtifactPath',
  'thumbnailByteSize',
  'subtitleFormat',
  'subtitleStyleId',
  'subtitleSegments',
  'transcriptText',
  'transcriptSegments',
  'transcriptSegmentCount',
  'speechStartMs',
  'speechEndMs',
  'boundaryPaddingBeforeMs',
  'boundaryPaddingAfterMs',
  'subtitleArtifactUuid',
  'subtitleArtifactPath',
  'subtitleByteSize',
  'AutoCutNativeTaskSnapshot',
  'AutoCutNativeTaskQueryRequest',
  'AutoCutNativeTaskCancelRequest',
  'AutoCutNativeTaskCancelResult',
  'AutoCutNativeTaskRecoveryRequest',
  'AutoCutNativeTaskRecoveryResult',
  'expiredLeases',
  'deferred',
  'AutoCutNativeTaskRetryRequest',
  'AutoCutNativeTaskRetryResult',
  'AutoCutNativeWorkerLeaseSnapshot',
  'listNativeTasks',
  'cancelNativeTask',
  'recoverNativeTasks',
  'retryNativeTask',
  'AutoCutVideoCompressRequest',
  'AutoCutVideoCompressResult',
  'compressVideo',
  'AutoCutVideoConvertRequest',
  'AutoCutVideoConvertResult',
  'convertVideo',
  'AutoCutVideoEnhanceRequest',
  'AutoCutVideoEnhanceResult',
  'enhanceVideo',
  'taskOutputDir',
];
const requiredTrustedFileSourceMarkers = [
  'AutoCutTrustedLocalFile',
  'AutoCutTrustedFileSourceDescriptor',
  'createAutoCutTrustedLocalFile',
  'resolveAutoCutTrustedSourcePath',
  'dispatchAutoCutTrustedFileSourceDrop',
  'listenAutoCutTrustedFileSourceDrop',
  'hasAutoCutTrustedSourcePath',
  'sourcePath',
];
const requiredNativeHostMarkers = [
  'AUTOCUT_HOST_CONTRACT_VERSION',
  'AutoCutHostCapabilities',
  'native-host',
  'ffmpegExecutionReady',
  'ffmpegProbeCommandReady',
  'mediaImportCommandReady',
  'mediaFileDescribeCommandReady',
  'localVideoFileSelectCommandReady',
  'localDirectorySelectCommandReady',
  'nativeTaskQueryCommandReady',
  'nativeTaskCancelCommandReady',
  'nativeTaskRecoveryCommandReady',
  'nativeTaskRetryCommandReady',
  'nativeTaskProgressEventsReady',
  'nativeWorkerLeaseReady',
  'audioExtractionCommandReady',
  'audioExtractionFromAssetReady',
  'audioFingerprintCommandReady',
  'audioFingerprintAdapterReady',
  'videoGifCommandReady',
  'videoSliceCommandReady',
  'videoCompressCommandReady',
  'videoConvertCommandReady',
  'videoEnhanceCommandReady',
  'speechTranscriptionCommandReady',
  'speechTranscriptionToolchainReady',
  'visualEvidenceExtractionContractReady',
  'visualEvidenceExtractionCommandReady',
  'visualEvidenceExtractionAdapterReady',
  'llmHttpCommandReady',
  'llmSecretStoreReady',
  'ffmpegToolchainManifestReady',
  'ffmpegToolchainResolverReady',
  'ffmpegBundledReady',
  'databaseContractReady',
  'sqliteMigrationReady',
  'databaseHealthCommandReady',
];
const requiredNativeDatabaseMarkers = [
  'AUTOCUT_DATABASE_CONTRACT_VERSION',
  'AutoCutDatabaseContract',
  'AutoCutDatabaseTableContract',
  'media_asset',
  'media_artifact',
  'ops_task',
  'ops_task_event',
  'ops_stage_run',
  'ops_worker_lease',
  'ops_schema_migration',
];
const requiredNativeDatabaseRuntimeMarkers = [
  'AUTOCUT_SQLITE_BASELINE_MIGRATION_ID',
  'AUTOCUT_SQLITE_BASELINE_SQL',
  'AutoCutDatabaseHealth',
  'run_autocut_database_migrations',
  'verify_autocut_database_schema',
  'ops_schema_migration',
  'PRAGMA foreign_keys = ON',
  'include_str!("../database/schema/sqlite/001_baseline.sql")',
];
const requiredNativeMediaRuntimeMarkers = [
  'AutoCutFfmpegProbe',
  'AutoCutFfmpegToolchain',
  'AutoCutFfmpegToolchainManifest',
  'AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_JSON',
  'AUTOCUT_MEDIA_TASK_DIR',
  'AutoCutMediaImportRequest',
  'AutoCutMediaImportResult',
  'AutoCutLocalMediaFileDescription',
  'describe_autocut_local_media_file',
  'AutoCutAudioExtractionRequest',
  'AutoCutAudioExtractionResult',
  'output_quality',
  'output_channel',
  'normalize_audio_quality',
  'normalize_audio_channel',
  'audio_extraction_applies_quality_and_channel_contract',
  'AutoCutVideoGifRequest',
  'AutoCutVideoGifResult',
  'AutoCutVideoSliceRequest',
  'AutoCutVideoSliceResult',
  'AutoCutVideoCompressRequest',
  'AutoCutVideoCompressResult',
  'AutoCutVideoConvertRequest',
  'AutoCutVideoConvertResult',
  'AutoCutVideoEnhanceRequest',
  'AutoCutVideoEnhanceResult',
  'AutoCutSpeechTranscriptionRequest',
  'AutoCutSpeechTranscriptionResult',
  'AutoCutSpeechTranscriptionSegment',
  'AutoCutVisualEvidenceExtractionRequest',
  'AutoCutVisualEvidenceExtractionResult',
  'extract_autocut_visual_evidence',
  'autocut_extract_visual_evidence',
  'run_ffmpeg_visual_evidence_extraction',
  'run_tracked_visual_evidence_ffmpeg_command',
  'parse_ffmpeg_showinfo_pts_times_to_millis',
  'complete_ops_visual_evidence_task',
  'provider_id',
  'task_output_dir',
  'taskOutputDir',
  'output_root_dir',
  'outputRootDir',
  'probe_autocut_ffmpeg',
  'import_autocut_media_file',
  'autocut_describe_local_media_file',
  'select_autocut_local_video_file',
  'select_autocut_local_directory',
  'SUPPORTED_VIDEO_FILE_DIALOG_EXTENSIONS',
  'pick_folder',
  'resolve_autocut_request_media_root',
  'autocut_media_root_for_request',
  'AutoCut outputRootDir must be an absolute directory path',
  'autocut_operation_output_root_dir_payload',
  'insert_autocut_output_root_dir_payload',
  'retry_output_root_dir',
  'native_media_task_writes_artifact_inside_configured_output_root',
  'native_task_retry_preserves_configured_output_root',
  'autocut_task_output_dir',
  'AutoCutNativeTaskSnapshot',
  'AutoCutNativeTaskQueryRequest',
  'AutoCutNativeTaskCancelRequest',
  'AutoCutNativeTaskCancelResult',
  'AutoCutNativeTaskRecoveryRequest',
  'AutoCutNativeTaskRecoveryResult',
  'AutoCutNativeTaskRetryRequest',
  'AutoCutNativeTaskRetryResult',
  'list_autocut_native_tasks',
  'autocut_list_native_tasks',
  'cancel_autocut_native_task',
  'autocut_cancel_native_task',
  'recover_autocut_native_tasks',
  'autocut_recover_native_tasks',
  'retry_autocut_native_task',
  'autocut_retry_native_task',
  'OPS_STATUS_CANCEL_REQUESTED',
  'OPS_STATUS_CANCELED',
  'OPS_STATUS_INTERRUPTED',
  'OPS_TASK_EVENT_TYPE_CANCEL_REQUESTED',
  'OPS_TASK_EVENT_TYPE_CANCELED',
  'OPS_TASK_EVENT_TYPE_INTERRUPTED',
  'OPS_TASK_EVENT_TYPE_RETRY_REQUESTED',
  'OPS_TASK_EVENT_TYPE_PROGRESS',
  'recover_autocut_native_tasks_on_connection',
  'retry_autocut_native_task_in_root_with_toolchain',
  'record_ops_task_progress',
  'parse_ffmpeg_progress_percent',
  'parse_ffmpeg_duration_millis',
  'append_ffmpeg_progress_output_args',
  'run_tracked_ffmpeg_command_with_progress',
  'record_ffmpeg_streaming_progress',
  'read_child_pipe_by_line',
  'AutoCutFfmpegPipeEvent',
  'standardize_native_task_event_payload',
  'parse_native_task_event_payload',
  'OPS_WORKER_LEASE_STATUS_ACTIVE',
  'OPS_WORKER_LEASE_STATUS_RELEASED',
  'OPS_WORKER_LEASE_STATUS_EXPIRED',
  'AutoCutNativeWorkerLeaseSnapshot',
  'AutoCutOpsWorkerLease',
  'AutoCutRecoveryLeaseSignal',
  'acquire_ops_worker_lease',
  'heartbeat_ops_worker_lease',
  'release_ops_worker_lease',
  'expire_stale_ops_worker_leases',
  'has_active_ops_worker_lease',
  'read_recovery_lease_signal',
  'native_task_recovery_event_payload',
  'begin_native_media_task_worker_lease',
  'read_native_worker_leases',
  'mark_ops_task_interrupted',
  'AutoCutTrackedNativeMediaProcess',
  'run_tracked_native_media_command',
  'has_tracked_native_media_process',
  'cancel_tracked_native_media_process',
  'stop_tracked_native_media_child',
  'stop_and_join_tracked_native_media_child_after_error',
  'AutoCutThrottledPoll',
  'NATIVE_MEDIA_POLL_HEARTBEAT_INTERVAL',
  'native_media_poll_throttler_can_force_final_run',
  'run_tracked_ffmpeg_command_with_progress',
  'AutoCutNativeMediaPipeEvent',
  'append_whisper_progress_output_args',
  'parse_whisper_progress_percent',
  'record_local_whisper_streaming_progress',
  'map_local_whisper_cli_progress_to_task_progress',
  'extract_autocut_audio_from_asset',
  'generate_autocut_gif_from_asset',
  'autocut_generate_gif',
  'slice_autocut_video_from_asset',
  'autocut_slice_video',
  'compress_autocut_video_from_asset',
  'autocut_compress_video',
  'convert_autocut_video_from_asset',
  'autocut_convert_video',
  'enhance_autocut_video_from_asset',
  'autocut_enhance_video',
  'transcribe_autocut_media_from_asset',
  'autocut_transcribe_media',
  'AutoCutSpeechToolchain',
  'resolve_autocut_speech_toolchain',
  'resolve_autocut_speech_toolchain_from_candidate_manifests',
  'speech-transcription.toolchain.json',
  'resolve_autocut_bundled_speech_executable_from_candidate_manifests',
  'speech_toolchain_resolver_uses_bundled_whisper_sidecar_when_executable_is_not_configured',
  'SDKWORK_AUTOCUT_WHISPER_EXECUTABLE',
  'SDKWORK_AUTOCUT_WHISPER_MODEL',
  'run_ffmpeg_speech_audio_extract',
  'run_local_whisper_transcription',
  'parse_whisper_transcript_json',
  'SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS',
  'ensure_supported_speech_executable_file_path',
  'ensure_supported_speech_model_file_path',
  'speech_toolchain_rejects_relative_executable_paths',
  'speech_toolchain_rejects_relative_model_paths',
  'speech_toolchain_rejects_unsupported_model_extensions',
  'MEDIA_ARTIFACT_TYPE_TRANSCRIPT',
  'MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_SUBTITLE',
  'OPS_TASK_TYPE_SPEECH_TRANSCRIPTION',
  'OPS_STAGE_TYPE_SPEECH_TRANSCRIPTION',
  'run_autocut_audio_smoke',
  'resolve_autocut_ffmpeg_toolchain',
  'resolve_autocut_ffmpeg_toolchain_for_app',
  'resolve_autocut_ffmpeg_toolchain_from_candidate_manifests',
  'autocut_ffmpeg_toolchain_manifest_candidate_paths',
  'resource_dir',
  'resolve_ffmpeg_executable_from_toolchain',
  'ffmpeg.toolchain.json',
  'SDKWORK_AUTOCUT_FFMPEG',
  'Sha256',
  'verify_autocut_ffmpeg_sidecar_integrity',
  'checksum mismatch',
  'byteSize mismatch',
  'source_kind',
  'bundled_ready',
  'manifest_ready',
  'asset_uuid',
  'source_asset_uuid',
  'media_asset',
  'media_artifact',
  'ops_task',
  'ops_stage_run',
  '.join(AUTOCUT_MEDIA_TASK_DIR)',
  'AUTOCUT_MEDIA_TASK_COVER_DIR',
  'autocut_task_cover_dir',
  'autocut_task_uuid',
  'Uuid::now_v7()',
  'Command::new',
  '.args(',
  'fs::copy',
  'ensure_safe_import_source_path',
  'ensure_safe_media_path',
  'run_ffmpeg_video_gif',
  'run_ffmpeg_video_slices',
  'run_ffmpeg_video_slice',
  'run_ffmpeg_video_slice_thumbnail',
  'insert_media_slice_thumbnail_artifact',
  'MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL',
  'thumbnail_artifact_path',
  'thumbnail_byte_size',
  'run_ffmpeg_video_compress',
  'run_ffmpeg_video_convert',
  'run_ffmpeg_video_enhance',
  'normalize_video_gif_fps',
  'normalize_video_gif_resolution',
  'normalize_video_slice_clips',
  'normalize_video_slice_format',
  'adjust_video_slice_clips_for_source_duration',
  'read_ffmpeg_media_duration_millis',
  'AutoCutVideoSliceEncoderCandidate',
  'autocut_video_slice_encoder_candidates',
  'autocut_video_slice_cpu_encoder_candidate',
  'run_ffmpeg_video_slice_with_encoder_fallback',
  'append_ffmpeg_video_slice_encoder_args',
  'format_video_slice_encoder_attempt_diagnostics',
  'normalize_video_compress_mode',
  'normalize_video_convert_format',
  'normalize_video_convert_codec',
  'normalize_video_convert_resolution',
  'normalize_video_enhance_resolution',
  'normalize_video_enhance_mode',
  'normalize_video_enhance_frame_rate',
  'image/gif',
  'image/jpeg',
  'video/mp4',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
  'h264_vaapi',
  'libx264',
  'yuv420p',
  'libvpx-vp9',
  'unsharp',
  '-movflags',
  'scale=-2',
  '-nostdin',
  '-vn',
  'lavfi',
];
const forbiddenRemoteFixtureUrlPatterns = [
  /https:\/\/www\.soundhelix\.com\/examples\/mp3\/SoundHelix-Song-1\.mp3/u,
  /https:\/\/media\.giphy\.com\/media\/3o7aD2saalEvW6vWgA\/giphy\.gif/u,
  /https:\/\/picsum\.photos\/seed\//u,
];
const forbiddenCspRemoteSources = [
  'https://www.soundhelix.com',
  'https://media.giphy.com',
  'https://picsum.photos',
];

const businessPackagesWithService = new Set([
  'sdkwork-autocut-extractor-audio',
  'sdkwork-autocut-extractor-text',
  'sdkwork-autocut-services',
  'sdkwork-autocut-slicer',
  'sdkwork-autocut-subtitle-translate',
  'sdkwork-autocut-video-compress',
  'sdkwork-autocut-video-convert',
  'sdkwork-autocut-video-enhance',
  'sdkwork-autocut-video-dedup',
  'sdkwork-autocut-video-gif',
  'sdkwork-autocut-voice-translate',
]);
const forbiddenSourcePatterns = [
  {
    pattern: /@ts-ignore/u,
    message: 'does not suppress TypeScript with @ts-ignore',
  },
  {
    pattern: /@ts-expect-error/u,
    message: 'does not suppress TypeScript with @ts-expect-error',
  },
  {
    pattern: /eslint-disable/u,
    message: 'does not suppress lint or type governance with eslint-disable',
  },
  {
    pattern: /\bTODO\b/u,
    message: 'does not commit TODO markers into AutoCut source',
  },
  {
    pattern: /\bFIXME\b/u,
    message: 'does not commit FIXME markers into AutoCut source',
  },
];

function assertPngBitDepth(filePath, expectedBitDepth, message) {
  const header = fs.readFileSync(filePath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assertRule(
    header.length >= 25 && header.subarray(0, pngSignature.length).equals(pngSignature),
    `${message} has a valid PNG signature`,
  );
  if (header.length < 25) {
    return;
  }
  assertRule(
    header.toString('ascii', 12, 16) === 'IHDR',
    `${message} has an IHDR header`,
  );
  assertRule(header[24] === expectedBitDepth, `${message} uses ${expectedBitDepth}-bit depth`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function listFiles(dirPath, predicate = () => true, shouldSkipDirectory = () => false) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const output = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolute = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(absolute)) {
        output.push(...listFiles(absolute, predicate, shouldSkipDirectory));
      }
    } else if (predicate(absolute)) {
      output.push(absolute);
    }
  }
  return output;
}

const failures = [];
const pass = [];

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

const forbiddenHighEntropyApiKeyPattern = /\bsk-[0-9a-fA-F]{24,}\b/u;

function shouldSkipSecretGovernanceDirectory(dirPath) {
  const relative = path.relative(rootDir, dirPath).replaceAll(path.sep, '/');
  return (
    relative === '.git' ||
    relative === 'node_modules' ||
    relative === 'artifacts' ||
    relative.endsWith('/node_modules') ||
    relative.endsWith('/dist') ||
    relative.startsWith('packages/sdkwork-autocut-desktop/src-tauri/target') ||
    relative.startsWith('packages/sdkwork-autocut-desktop/src-tauri/binaries/linux-') ||
    relative.startsWith('packages/sdkwork-autocut-desktop/src-tauri/binaries/macos-') ||
    relative.startsWith('packages/sdkwork-autocut-desktop/src-tauri/binaries/windows-')
  );
}

function isSecretGovernanceTextFile(filePath) {
  const relative = path.relative(rootDir, filePath).replaceAll(path.sep, '/');
  return (
    ['.env.example', 'ARCHITECT.md', 'DATABASE_SPEC.md', 'README.md', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.json']
      .includes(relative) ||
    (/^(docs|packages|scripts)\//u.test(relative) &&
      /\.(css|html|json|md|mjs|sql|toml|ts|tsx|ya?ml|rs)$/u.test(relative))
  );
}

function readTrackedFilesUnderPath(relativePath) {
  const normalizedPrefix = relativePath.replaceAll(path.sep, '/').replace(/\/+$/u, '');
  try {
    return execFileSync('git', ['ls-files', '--', normalizedPrefix], {
      cwd: rootDir,
      encoding: 'utf8',
    })
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch {
    return readTrackedFilesUnderPathFromGitIndex(normalizedPrefix);
  }
}

function readTrackedFilesUnderPathFromGitIndex(normalizedPrefix) {
  const indexPath = path.join(rootDir, '.git', 'index');
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const indexBuffer = fs.readFileSync(indexPath);
  if (indexBuffer.subarray(0, 4).toString('ascii') !== 'DIRC' || indexBuffer.length < 12) {
    return [];
  }

  const version = indexBuffer.readUInt32BE(4);
  if (version < 2 || version > 3) {
    return readTrackedFilesUnderPathFromGitIndexText(normalizedPrefix, indexBuffer);
  }

  const entryCount = indexBuffer.readUInt32BE(8);
  const trackedFiles = [];
  let offset = 12;
  for (let index = 0; index < entryCount && offset + 62 <= indexBuffer.length; index += 1) {
    const entryStart = offset;
    const pathStart = offset + 62;
    let pathEnd = pathStart;
    while (pathEnd < indexBuffer.length && indexBuffer[pathEnd] !== 0) {
      pathEnd += 1;
    }
    if (pathEnd >= indexBuffer.length) {
      break;
    }

    const entryPath = indexBuffer.subarray(pathStart, pathEnd).toString('utf8');
    if (entryPath === normalizedPrefix || entryPath.startsWith(`${normalizedPrefix}/`)) {
      trackedFiles.push(entryPath);
    }

    const entryLength = pathEnd - entryStart + 1;
    offset = entryStart + Math.ceil(entryLength / 8) * 8;
  }

  return trackedFiles;
}

function readTrackedFilesUnderPathFromGitIndexText(normalizedPrefix, indexBuffer) {
  const text = indexBuffer.toString('utf8');
  return [...text.matchAll(/[A-Za-z0-9_./-]+/gu)]
    .map((match) => match[0])
    .filter((entryPath) => entryPath === normalizedPrefix || entryPath.startsWith(`${normalizedPrefix}/`));
}

function assertNoForbiddenSourcePatterns(relativePath, sourceText) {
  for (const { pattern, message } of forbiddenSourcePatterns) {
    assertRule(!pattern.test(sourceText), `${relativePath} ${message}`);
  }
}

function assertNoTypeScriptNonNullAssertions(relativePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const nonNullAssertions = [];
  const visit = (node) => {
    if (ts.isNonNullExpression(node)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      nonNullAssertions.push(`${line + 1}:${character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assertRule(
    nonNullAssertions.length === 0,
    `${relativePath} avoids TypeScript non-null assertions (${nonNullAssertions.join(', ')})`,
  );
}

function stripSqlComments(sqlSource) {
  return sqlSource.replace(/--.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
}

function extractSqlCreateTables(sqlSource) {
  const tables = [];
  const normalizedSource = stripSqlComments(sqlSource);
  const createTablePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(["`[]?[a-zA-Z_][\w$]*["`\]]?(?:\s*\.\s*["`[]?[a-zA-Z_][\w$]*["`\]]?)*)\s*\(/giu;
  for (const match of normalizedSource.matchAll(createTablePattern)) {
    const rawName = match[1];
    const normalizedName = rawName
      .split('.')
      .at(-1)
      ?.replace(/["`\[\]\s]/gu, '')
      .toLowerCase();
    if (normalizedName) {
      tables.push({ name: normalizedName, bodyStart: match.index + match[0].length });
    }
  }
  return tables.map((table, index) => {
    const end = index + 1 < tables.length ? tables[index + 1].bodyStart : normalizedSource.length;
    return { ...table, body: normalizedSource.slice(table.bodyStart, end) };
  });
}

function extractYamlTableContracts(sourceText) {
  const matches = [];
  const tablePattern = /(?:^|\n)\s*table_name:\s*['"]?([a-z][a-z0-9_]+)['"]?/gmu;
  const tableMatches = [...sourceText.matchAll(tablePattern)];
  for (let index = 0; index < tableMatches.length; index += 1) {
    const match = tableMatches[index];
    const nextMatch = tableMatches[index + 1];
    const start = match.index ?? 0;
    const end = nextMatch?.index ?? sourceText.length;
    matches.push({
      name: match[1].toLowerCase(),
      body: sourceText.slice(start, end),
    });
  }
  return matches;
}

function extractJsonTableContracts(sourceText) {
  try {
    const parsed = JSON.parse(sourceText);
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    return candidates
      .filter((candidate) => candidate && typeof candidate === 'object' && typeof candidate.table_name === 'string')
      .map((candidate) => ({
        name: candidate.table_name.toLowerCase(),
        body: candidate,
      }));
  } catch {
    return [];
  }
}

function assertStandardDatabaseTableName(tableName, relativePath) {
  const firstSegment = tableName.split('_')[0];
  assertRule(
    /^[a-z][a-z0-9_]*$/u.test(tableName),
    `${relativePath} table ${tableName} uses lowercase underscore database naming`,
  );
  assertRule(tableName.includes('_'), `${relativePath} table ${tableName} includes a business module prefix and entity name`);
  assertRule(
    !forbiddenDatabaseTablePrefixes.includes(firstSegment),
    `${relativePath} table ${tableName} does not use a forbidden product/project/common prefix`,
  );
}

function assertSqlTableHasIdentityColumns(table, relativePath) {
  const body = table.body.toLowerCase();
  assertRule(
    /(?:^|[\s,(])id\s+(?:bigint|integer|int8|number\s*\(\s*19\s*\)|numeric\s*\(\s*19\s*,\s*0\s*\))/u.test(body),
    `${relativePath} table ${table.name} defines id as long/int64 storage`,
  );
  assertRule(/(?:^|[\s,(])uuid\s+(?:varchar|char|text|uuid|nvarchar)/u.test(body), `${relativePath} table ${table.name} defines uuid`);
}

function assertYamlTableHasIdentityColumns(table, relativePath) {
  const body = table.body.toLowerCase();
  assertRule(
    /(?:^|\n)\s*id:\s*\{[^}\n]*type:\s*int64\b/u.test(body) ||
      /(?:^|\n)\s*id:\s*(?:\r?\n)(?:\s+[a-z_]+:\s*[^\n]*\r?\n)*\s+type:\s*int64\b/u.test(body),
    `${relativePath} table ${table.name} declares columns.id as int64`,
  );
  assertRule(/(?:^|\n)\s*uuid:\s*/u.test(body), `${relativePath} table ${table.name} declares columns.uuid`);
}

function assertJsonTableHasIdentityColumns(table, relativePath) {
  const columns = table.body.columns;
  const idColumn = columns?.id;
  const uuidColumn = columns?.uuid;
  assertRule(
    idColumn && typeof idColumn === 'object' && idColumn.type === 'int64',
    `${relativePath} table ${table.name} declares columns.id as int64`,
  );
  assertRule(Boolean(uuidColumn), `${relativePath} table ${table.name} declares columns.uuid`);
}

function assertSetsEqual(actualItems, expectedItems, message) {
  const actual = new Set(actualItems);
  const expected = new Set(expectedItems);
  const missing = [...expected].filter((item) => !actual.has(item)).sort();
  const extra = [...actual].filter((item) => !expected.has(item)).sort();
  assertRule(
    missing.length === 0 && extra.length === 0,
    `${message}${missing.length > 0 ? ` missing=${missing.join(',')}` : ''}${extra.length > 0 ? ` extra=${extra.join(',')}` : ''}`,
  );
}

function toTaskTypeEnumKey(taskType) {
  return taskType.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}

const rootPackage = readJson(path.join(rootDir, 'package.json'));
const rootTsconfig = readJson(path.join(rootDir, 'tsconfig.json'));
const sdkworkAppConfig = fs.existsSync(path.join(rootDir, 'sdkwork.app.config.json'))
  ? readJson(path.join(rootDir, 'sdkwork.app.config.json'))
  : {};
const desktopPackage = fs.existsSync(path.join(desktopPackageDir, 'package.json'))
  ? readJson(path.join(desktopPackageDir, 'package.json'))
  : {};
const tauriConfig = fs.existsSync(path.join(desktopTauriDir, 'tauri.conf.json'))
  ? readJson(path.join(desktopTauriDir, 'tauri.conf.json'))
  : {};
const desktopTauriDefaultCapabilityPath = path.join(desktopTauriDir, 'capabilities', 'default.json');
const desktopTauriDefaultCapability = fs.existsSync(desktopTauriDefaultCapabilityPath)
  ? readJson(desktopTauriDefaultCapabilityPath)
  : {};
const rootGitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
const ignoredRootDirectoryEntries = new Set(
  rootGitignore
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.endsWith('/') &&
      !line.startsWith('!') &&
      !line.startsWith('#') &&
      !line.includes('*') &&
      !line.includes('/../') &&
      line.indexOf('/') === line.length - 1,
    )
    .map((line) => line.slice(0, -1)),
);
const rootGitAttributes = fs.existsSync(path.join(rootDir, '.gitattributes'))
  ? fs.readFileSync(path.join(rootDir, '.gitattributes'), 'utf8')
  : '';
const architectSource = fs.existsSync(path.join(rootDir, 'ARCHITECT.md'))
  ? fs.readFileSync(path.join(rootDir, 'ARCHITECT.md'), 'utf8')
  : '';
const readmeSource = fs.existsSync(path.join(rootDir, 'README.md'))
  ? fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8')
  : '';
const licenseSource = fs.existsSync(path.join(rootDir, 'LICENSE'))
  ? fs.readFileSync(path.join(rootDir, 'LICENSE'), 'utf8')
  : '';
const frontendStandardSource = fs.existsSync(path.join(rootDir, 'docs/architecture/16-autocut-frontend-module-standard.md'))
  ? fs.readFileSync(path.join(rootDir, 'docs/architecture/16-autocut-frontend-module-standard.md'), 'utf8')
  : '';
const viteConfigSource = fs.existsSync(path.join(desktopPackageDir, 'vite.config.ts'))
  ? fs.readFileSync(path.join(desktopPackageDir, 'vite.config.ts'), 'utf8')
  : '';
const indexHtmlSource = fs.existsSync(path.join(desktopPackageDir, 'index.html'))
  ? fs.readFileSync(path.join(desktopPackageDir, 'index.html'), 'utf8')
  : '';
const cargoTomlSource = fs.existsSync(path.join(desktopTauriDir, 'Cargo.toml'))
  ? fs.readFileSync(path.join(desktopTauriDir, 'Cargo.toml'), 'utf8')
  : '';
const mainRsSource = fs.existsSync(path.join(desktopTauriDir, 'src', 'main.rs'))
  ? fs.readFileSync(path.join(desktopTauriDir, 'src', 'main.rs'), 'utf8')
  : '';
const rustToolchainSource = fs.existsSync(path.join(desktopPackageDir, 'rust-toolchain.toml'))
  ? fs.readFileSync(path.join(desktopPackageDir, 'rust-toolchain.toml'), 'utf8')
  : '';
const workspaceSource = fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
const databaseSpecSource = fs.existsSync(path.join(rootDir, 'DATABASE_SPEC.md'))
  ? fs.readFileSync(path.join(rootDir, 'DATABASE_SPEC.md'), 'utf8')
  : '';
const databaseContractSource = fs.existsSync(path.join(rootDir, requiredDatabaseContractDoc))
  ? fs.readFileSync(path.join(rootDir, requiredDatabaseContractDoc), 'utf8')
  : '';
const nativeHostCommandSource = fs.existsSync(path.join(rootDir, requiredNativeHostCommandSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeHostCommandSourcePath), 'utf8')
  : '';
const nativeHostContractSource = fs.existsSync(path.join(rootDir, requiredNativeHostContractSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeHostContractSourcePath), 'utf8')
  : '';
const nativeDatabaseContractSource = fs.existsSync(path.join(rootDir, requiredNativeDatabaseContractSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeDatabaseContractSourcePath), 'utf8')
  : '';
const nativeDatabaseRuntimeSource = fs.existsSync(path.join(rootDir, requiredNativeDatabaseRuntimeSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeDatabaseRuntimeSourcePath), 'utf8')
  : '';
const nativeMediaRuntimeSource = fs.existsSync(path.join(rootDir, requiredNativeMediaRuntimeSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeMediaRuntimeSourcePath), 'utf8')
  : '';
const nativeLlmHttpRuntimeSource = fs.existsSync(path.join(rootDir, requiredNativeLlmHttpRuntimeSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeLlmHttpRuntimeSourcePath), 'utf8')
  : '';
const nativeLlmSecretRuntimeSource = fs.existsSync(path.join(rootDir, requiredNativeLlmSecretRuntimeSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeLlmSecretRuntimeSourcePath), 'utf8')
  : '';
const nativeFfmpegToolchainManifestSource = fs.existsSync(path.join(rootDir, requiredNativeFfmpegToolchainManifestPath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeFfmpegToolchainManifestPath), 'utf8')
  : '';
const nativeSpeechToolchainManifestSource = fs.existsSync(path.join(rootDir, requiredNativeSpeechToolchainManifestPath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeSpeechToolchainManifestPath), 'utf8')
  : '';
const nativeHostClientServiceSource = fs.existsSync(path.join(rootDir, requiredNativeHostClientServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeHostClientServicePath), 'utf8')
  : '';
const speechTranscriptionServiceSource = fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts'))
  ? fs.readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts'), 'utf8')
  : '';
const tasksServiceSource = fs.existsSync(path.join(rootDir, requiredTasksServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredTasksServicePath), 'utf8')
  : '';
const assetsServiceSource = fs.existsSync(path.join(rootDir, requiredAssetsServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredAssetsServicePath), 'utf8')
  : '';
const messagesServiceSource = fs.existsSync(path.join(rootDir, requiredMessagesServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredMessagesServicePath), 'utf8')
  : '';
const slicerServiceSource = fs.existsSync(path.join(rootDir, requiredSlicerServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredSlicerServicePath), 'utf8')
  : '';
const slicePlannerSource = fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts'))
  ? fs.readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts'), 'utf8')
  : '';
const smartCutEnginePlannerSource = fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts'))
  ? fs.readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts'), 'utf8')
  : '';
const servicesIndexSource = fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/index.ts'))
  ? fs.readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/index.ts'), 'utf8')
  : '';
const serviceBehaviorCheckSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-service-behavior.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-service-behavior.mjs'), 'utf8')
  : '';
const largeMediaBaselineSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-large-media-baseline.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-large-media-baseline.mjs'), 'utf8')
  : '';
const largeMediaBaselineTestSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-large-media-baseline.test.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-large-media-baseline.test.mjs'), 'utf8')
  : '';
const largeMediaSttBaselineSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-large-media-stt-baseline.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-large-media-stt-baseline.mjs'), 'utf8')
  : '';
const largeMediaSttBaselineTestSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-large-media-stt-baseline.test.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-large-media-stt-baseline.test.mjs'), 'utf8')
  : '';
const speechGpuRuntimeSource = fs.existsSync(path.join(rootDir, 'scripts/prepare-autocut-speech-gpu-runtime.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/prepare-autocut-speech-gpu-runtime.mjs'), 'utf8')
  : '';
const speechGpuRuntimeTestSource = fs.existsSync(path.join(rootDir, 'scripts/prepare-autocut-speech-gpu-runtime.test.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/prepare-autocut-speech-gpu-runtime.test.mjs'), 'utf8')
  : '';
const genericRealMediaSliceSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-generic-real-media-slice.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-generic-real-media-slice.mjs'), 'utf8')
  : '';
const genericRealMediaSliceTestSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-generic-real-media-slice.test.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-generic-real-media-slice.test.mjs'), 'utf8')
  : '';
const smartSlicePerformanceBenchmarkSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-performance-benchmark.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-performance-benchmark.mjs'), 'utf8')
  : '';
const smartSlicePerformanceBenchmarkTestSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-performance-benchmark.test.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-performance-benchmark.test.mjs'), 'utf8')
  : '';
const slicerPlannerCheckSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-slicer-planner.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-slicer-planner.mjs'), 'utf8')
  : '';
const nativeReleaseSmokeCheckSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-native-release-smoke.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-native-release-smoke.mjs'), 'utf8')
  : '';
const installerSigningSource = fs.existsSync(path.join(rootDir, 'scripts/sign-autocut-release-installers.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/sign-autocut-release-installers.mjs'), 'utf8')
  : '';
const smartSliceTaskEvidenceCheckSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-task-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-task-evidence.mjs'), 'utf8')
  : '';
const smartSliceExecutionEvidenceCheckSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-execution-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-execution-evidence.mjs'), 'utf8')
  : '';
const smartSliceReleaseFixtureCheckSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-release-fixture.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-smart-slice-release-fixture.mjs'), 'utf8')
  : '';
const smartSliceQualityEvidenceSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-smart-slice-quality-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-smart-slice-quality-evidence.mjs'), 'utf8')
  : '';
const smartSliceMediaArtifactsEvidenceSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-smart-slice-media-artifacts-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-smart-slice-media-artifacts-evidence.mjs'), 'utf8')
  : '';
const smartSliceSampleEvidenceSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-smart-slice-sample-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-smart-slice-sample-evidence.mjs'), 'utf8')
  : '';
const releaseEvidenceSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-release-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-release-evidence.mjs'), 'utf8')
  : '';
const packageSbomSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-package-sbom-files.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-package-sbom-files.mjs'), 'utf8')
  : '';
const sbomEvidenceSource = fs.existsSync(path.join(rootDir, 'scripts/write-autocut-sbom-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/write-autocut-sbom-evidence.mjs'), 'utf8')
  : '';
const releaseEvidenceStatusSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-release-evidence-status.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-release-evidence-status.mjs'), 'utf8')
  : '';
const releasePlatformsSource = fs.existsSync(path.join(rootDir, 'scripts/autocut-release-platforms.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/autocut-release-platforms.mjs'), 'utf8')
  : '';
const appManifestReleaseReadinessSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-app-manifest-release-readiness.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-app-manifest-release-readiness.mjs'), 'utf8')
  : '';
const appManifestReleaseEvidenceSyncSource = fs.existsSync(path.join(rootDir, 'scripts/sync-autocut-app-manifest-release-evidence.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/sync-autocut-app-manifest-release-evidence.mjs'), 'utf8')
  : '';
const previewReleaseReadinessSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-preview-release-readiness.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-preview-release-readiness.mjs'), 'utf8')
  : '';
const multiplatformReleaseReadinessSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-multiplatform-release-readiness.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-multiplatform-release-readiness.mjs'), 'utf8')
  : '';
const commercialReleaseReadinessSource = fs.existsSync(path.join(rootDir, 'scripts/check-autocut-commercial-release-readiness.mjs'))
  ? fs.readFileSync(path.join(rootDir, 'scripts/check-autocut-commercial-release-readiness.mjs'), 'utf8')
  : '';
const desktopReleaseWorkflowSource = fs.existsSync(path.join(rootDir, '.github/workflows/autocut-desktop-release.yml'))
  ? fs.readFileSync(path.join(rootDir, '.github/workflows/autocut-desktop-release.yml'), 'utf8')
  : '';
const nativeSqliteBaselineSource = fs.existsSync(path.join(rootDir, requiredNativeSqliteBaselinePath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeSqliteBaselinePath), 'utf8')
  : '';
const nativeSchemaRegistrySource = fs.existsSync(path.join(rootDir, requiredNativeSchemaRegistryPath))
  ? fs.readFileSync(path.join(rootDir, requiredNativeSchemaRegistryPath), 'utf8')
  : '';
const nativeHostCommandNames = Array.from(
  nativeHostCommandSource.matchAll(/pub\s+(?:async\s+)?fn\s+(autocut_[a-z0-9_]+)\s*\(/gu),
  (match) => match[1],
);
const nativeMainRegisteredCommandNames = Array.from(
  mainRsSource.matchAll(/commands::(autocut_[a-z0-9_]+)/gu),
  (match) => match[1],
);
const nativeHostSupportedCommandNames = Array.from(
  nativeHostContractSource.matchAll(/"(autocut_[a-z0-9_]+)"/gu),
  (match) => match[1],
);
const nativeHostClientCommandNames = Array.from(
  nativeHostClientServiceSource.matchAll(/invoke<[^>]+>\('([^']+)'/gu),
  (match) => match[1],
).filter((command) => command.startsWith('autocut_'));
const workspaceCatalogNames = new Set(
  [...workspaceSource.matchAll(/^ {2}['"]?([^:'"\s][^:'"]*?)['"]?:\s*[^\s]+/gmu)].map((match) => match[1].trim()),
);
const workspaceCatalogVersions = Object.fromEntries(
  [...workspaceSource.matchAll(/^ {2}['"]?([^:'"\s][^:'"]*?)['"]?:\s*([^\s]+)/gmu)].map((match) => [
    match[1].trim(),
    match[2].trim(),
  ]),
);
const trackedTauriGeneratedFiles = readTrackedFilesUnderPath('packages/sdkwork-autocut-desktop/src-tauri/gen');
const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
const packageNames = new Set(packageDirs.map((entry) => `${internalPrefix}${entry.name.replace(/^sdkwork-autocut-/, '')}`));

for (const scriptName of ['dev', 'build', 'typecheck', 'test', 'tauri:before-dev', 'tauri:dev', 'tauri:build']) {
  assertRule(Boolean(rootPackage.scripts?.[scriptName]), `root package.json defines script ${scriptName}`);
}
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-feature-workflows.mjs'), 'root test runs the AutoCut feature workflow governance check');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-slicer-planner.mjs'), 'root test runs the AutoCut slicer planner contract');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-service-behavior.mjs'), 'root test runs the AutoCut service behavior contract');
assertRule(rootPackage.scripts?.test?.includes('node scripts/autocut-cli-args.test.mjs'), 'root test runs the AutoCut CLI argument normalization contract');
assertRule(rootPackage.scripts?.test?.includes('node scripts/run-autocut-vite.test.mjs'), 'root test runs the AutoCut Vite runner dependency-link contract');
assertRule(rootPackage.scripts?.typecheck === 'node scripts/check-autocut-workspace-typecheck.mjs', 'root typecheck uses the stable AutoCut workspace TypeScript API runner');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-workspace-typecheck.test.mjs'), 'root test runs the AutoCut workspace typecheck runner contract');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-workspace-typecheck.mjs'), 'root test runs the stable AutoCut workspace typecheck runner');
assertRule(rootPackage.scripts?.['release:sign-installers'] === 'node scripts/sign-autocut-release-installers.mjs', 'root package.json defines the installer signing execution script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/sign-autocut-release-installers.test.mjs'), 'root test runs the installer signing execution contract');
assertRule(rootPackage.scripts?.['release:smart-slice-sample'] === 'node scripts/write-autocut-smart-slice-sample-evidence.mjs', 'root package.json defines the smart slice sample release evidence script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/write-autocut-smart-slice-sample-evidence.test.mjs'), 'root test runs the smart slice sample evidence contract');
assertRule(rootPackage.scripts?.['release:preview-ready'] === 'node scripts/check-autocut-preview-release-readiness.mjs', 'root package.json defines the unsigned preview release readiness gate');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-preview-release-readiness.test.mjs'), 'root test runs the unsigned preview release readiness contract');
assertRule(rootPackage.scripts?.['release:smart-slice-task'] === 'node scripts/check-autocut-smart-slice-task-evidence.mjs', 'root package.json defines the smart slice task evidence validation script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-smart-slice-task-evidence.test.mjs'), 'root test runs the smart slice task evidence validation contract');
assertRule(rootPackage.scripts?.['release:smart-slice-execution-evidence'] === 'node scripts/check-autocut-smart-slice-execution-evidence.mjs', 'root package.json defines the smart slice execution evidence validation script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-smart-slice-execution-evidence.test.mjs'), 'root test runs the smart slice execution evidence validation contract');
assertRule(rootPackage.scripts?.['release:smart-slice-quality'] === 'node scripts/write-autocut-smart-slice-quality-evidence.mjs', 'root package.json defines the smart slice quality release evidence script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/write-autocut-smart-slice-quality-evidence.test.mjs'), 'root test runs the smart slice quality evidence contract');
assertRule(rootPackage.scripts?.['release:smart-slice-media-artifacts'] === 'node scripts/write-autocut-smart-slice-media-artifacts-evidence.mjs', 'root package.json defines the smart slice media artifacts release evidence script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/write-autocut-smart-slice-media-artifacts-evidence.test.mjs'), 'root test runs the smart slice media artifacts evidence contract');
assertRule(rootPackage.scripts?.['release:smart-slice-fixture'] === 'node scripts/check-autocut-smart-slice-release-fixture.mjs', 'root package.json defines the smart slice release fixture smoke script');
assertRule(rootPackage.scripts?.test?.includes('node scripts/check-autocut-smart-slice-release-fixture.test.mjs'), 'root test runs the smart slice release fixture contract');

assertRule(rootPackage.packageManager?.startsWith('pnpm@'), 'root package.json declares pnpm packageManager');
assertRule(rootPackage.workspaces?.length === 1 && rootPackage.workspaces[0] === 'packages/*', 'root package.json workspace list only includes packages/*');
assertRule(exists('LICENSE'), 'root LICENSE declares the repository source license notice');
assertRule(exists('COMMERCIAL-LICENSE.md'), 'root COMMERCIAL-LICENSE.md declares commercial authorization terms');
assertRule(rootPackage.license === 'SEE LICENSE IN LICENSE', 'root package.json points license tools to the repository license notice');
assertRule(desktopPackage.license === 'SEE LICENSE IN LICENSE', 'desktop package.json points license tools to the repository license notice');
assertRule(cargoTomlSource.includes('license-file = "../../../LICENSE"'), 'desktop Tauri Cargo.toml points cargo metadata to the repository license notice');
assertRule(
  licenseSource.includes('AGPL-3.0-or-later') &&
    licenseSource.includes('non-commercial') &&
    licenseSource.includes('Commercial use is not permitted') &&
    licenseSource.includes('separate commercial license'),
  'root LICENSE declares AGPL-3.0-or-later non-commercial use with separate commercial authorization',
);
assertRule(
  readmeSource.includes('AGPL-3.0-or-later') &&
    readmeSource.includes('non-commercial') &&
    readmeSource.includes('commercial license') &&
    readmeSource.includes('COMMERCIAL-LICENSE.md'),
  'README documents the AGPL non-commercial source license and commercial authorization requirement',
);
assertRule(workspaceSource.includes("  - 'packages/*'"), 'pnpm-workspace.yaml includes only the packages/* workspace');
assertRule(exists('.gitattributes'), 'root .gitattributes defines repository binary storage policy');
assertRule(
  rootGitAttributes.includes('packages/sdkwork-autocut-desktop/src-tauri/binaries/**/ffmpeg filter=lfs diff=lfs merge=lfs -text') &&
    rootGitAttributes.includes('packages/sdkwork-autocut-desktop/src-tauri/binaries/**/ffmpeg.exe filter=lfs diff=lfs merge=lfs -text'),
  'root .gitattributes stores bundled FFmpeg sidecars through Git LFS',
);
assertRule(
  rootGitAttributes.includes('packages/sdkwork-autocut-desktop/src-tauri/binaries/**/whisper-cli filter=lfs diff=lfs merge=lfs -text') &&
    rootGitAttributes.includes('packages/sdkwork-autocut-desktop/src-tauri/binaries/**/whisper-cli.exe filter=lfs diff=lfs merge=lfs -text'),
  'root .gitattributes stores bundled Whisper CLI sidecars through Git LFS',
);
assertRule(architectSource.includes('Git LFS'), 'ARCHITECT.md documents Git LFS for bundled FFmpeg sidecars');
assertRule(readmeSource.includes('git lfs install'), 'README documents Git LFS setup before committing bundled FFmpeg sidecars');
assertRule(exists('packages/sdkwork-autocut-desktop/package.json'), 'AutoCut desktop app is defined as packages/sdkwork-autocut-desktop');
assertRule(!exists('src'), 'root src is not used for the AutoCut desktop app package');
assertRule(!exists('src-tauri'), 'root src-tauri is not used; Tauri lives in packages/sdkwork-autocut-desktop');
assertRule(!exists('vite.config.ts'), 'root vite.config.ts is not used; Vite config lives in packages/sdkwork-autocut-desktop');
assertRule(!exists('index.html'), 'root index.html is not used; HTML entry lives in packages/sdkwork-autocut-desktop');
assertRule(desktopPackage.name === '@sdkwork/autocut-desktop', 'desktop package manifest name is @sdkwork/autocut-desktop');
assertRule(desktopPackage.version === rootPackage.version, 'desktop package version matches root package.json version');
assertRule(rootPackage.version === tauriConfig.version, 'root package.json version matches desktop Tauri application version');
assertRule(cargoTomlSource.includes(`version = "${rootPackage.version}"`), 'desktop Tauri Cargo.toml package version matches root package.json version');
assertRule(sdkworkAppConfig.app?.versionSource === 'package.json', 'sdkwork.app.config.json derives the application version from package.json');
assertRule(sdkworkAppConfig.media?.metadata?.assetVersion === rootPackage.version, 'sdkwork.app.config.json media asset version matches root package.json version');
assertRule(sdkworkAppConfig.release?.currentVersion === rootPackage.version, 'sdkwork.app.config.json release currentVersion matches root package.json version');
assertRule(sdkworkAppConfig.release?.latest?.STABLE === rootPackage.version, 'sdkwork.app.config.json latest STABLE release matches root package.json version');
assertRule(
  Array.isArray(sdkworkAppConfig.release?.notes) &&
    sdkworkAppConfig.release.notes.some((note) => note?.version === rootPackage.version && note?.current === true),
  'sdkwork.app.config.json contains a current release note for the root package version',
);
assertRule(
  !JSON.stringify(sdkworkAppConfig).includes('/STABLE/0.1.0/'),
  'sdkwork.app.config.json does not point install packages at stale v0.1.0 CDN artifacts',
);
const appInstallPackages = Array.isArray(sdkworkAppConfig.artifacts?.installConfig?.packages)
  ? sdkworkAppConfig.artifacts.installConfig.packages
  : [];
for (const installPackage of appInstallPackages) {
  assertRule(
    installPackage?.enabled !== true || String(installPackage?.url ?? '').includes(`/STABLE/${rootPackage.version}/`),
    `sdkwork.app.config.json enabled install package ${installPackage?.id ?? 'unknown'} points at the current release version`,
  );
  assertRule(
    installPackage?.enabled !== true || installPackage?.metadata?.generatedPlaceholder !== true,
    `sdkwork.app.config.json enabled install package ${installPackage?.id ?? 'unknown'} is not marked as generated placeholder`,
  );
}
assertRule(sdkworkAppConfig.security?.checksumRequired === true, 'sdkwork.app.config.json requires checksums for release install packages');
assertRule(sdkworkAppConfig.security?.signatureRequired === true, 'sdkwork.app.config.json requires signatures for commercial release install packages');
assertRule(sdkworkAppConfig.security?.sbomRequired === true, 'sdkwork.app.config.json requires SBOM evidence for commercial release install packages');
assertRule(cargoTomlSource.includes('name = "sdkwork-video-cut-desktop"'), 'Tauri Cargo.toml uses the standard desktop crate name');
assertRule(cargoTomlSource.includes('edition = "2024"'), 'Tauri Cargo.toml uses Rust 2024 edition');
assertRule(exists('packages/sdkwork-autocut-desktop/rust-toolchain.toml'), 'desktop package pins a package-local Rust toolchain');
assertRule(rustToolchainSource.includes('channel = "1.90.0"'), 'desktop Tauri Rust toolchain pins rustc 1.90.0');
assertRule(rustToolchainSource.includes('"x86_64-pc-windows-msvc"'), 'desktop Tauri Rust toolchain declares the Windows MSVC target');
for (const [relativePath, sourceText] of [
  ['ARCHITECT.md', architectSource],
  ['README.md', readmeSource],
  ['docs/architecture/16-autocut-frontend-module-standard.md', frontendStandardSource],
]) {
  assertRule(
    sourceText.includes('packages/sdkwork-autocut-desktop/rust-toolchain.toml'),
    `${relativePath} documents the package-local Rust toolchain file`,
  );
  assertRule(sourceText.includes('1.90.0'), `${relativePath} documents the pinned Rust toolchain version`);
}
for (const [relativePath, sourceText] of [
  ['ARCHITECT.md', architectSource],
  ['README.md', readmeSource],
  ['docs/architecture/16-autocut-frontend-module-standard.md', frontendStandardSource],
]) {
  assertRule(
    sourceText.includes('scripts/ensure-autocut-tauri-rust-toolchain.test.mjs'),
    `${relativePath} documents the executable Rust toolchain guard contract test`,
  );
}
assertRule(indexHtmlSource.includes('<title>SDKWork Video Cut</title>'), 'desktop index.html title matches the Tauri product name');
assertRule(rootPackage.version === '0.1.7', 'AutoCut desktop application version matches the v0.1.7 release line');
assertRule(desktopPackage.scripts?.dev?.includes('--host 127.0.0.1'), 'desktop dev binds to loopback for desktop-local development');
assertRule(desktopPackage.scripts?.dev?.includes('--port 3000'), 'desktop dev uses the standard AutoCut web port 3000');
assertRule(desktopPackage.scripts?.dev?.includes('--strictPort'), 'desktop dev uses strictPort for deterministic desktop-local startup');
assertRule(desktopPackage.scripts?.['dev:tauri-web']?.includes('--host 127.0.0.1'), 'desktop dev:tauri-web binds to loopback for Tauri development');
assertRule(desktopPackage.scripts?.['dev:tauri-web']?.includes('--port 5173'), 'desktop dev:tauri-web uses the Tauri devUrl port 5173');
assertRule(desktopPackage.scripts?.['dev:tauri-web']?.includes('--strictPort'), 'desktop dev:tauri-web uses strictPort for deterministic Tauri startup');
assertRule(desktopPackage.scripts?.dev?.startsWith('node ../../scripts/run-autocut-vite.mjs '), 'desktop dev uses the stable AutoCut Vite runner instead of relying on node_modules/.bin');
assertRule(desktopPackage.scripts?.build === 'node ../../scripts/run-autocut-vite.mjs build', 'desktop build uses the stable AutoCut Vite runner instead of relying on node_modules/.bin');
assertRule(desktopPackage.scripts?.preview === 'node ../../scripts/run-autocut-vite.mjs preview', 'desktop preview uses the stable AutoCut Vite runner instead of relying on node_modules/.bin');
assertRule(desktopPackage.scripts?.['dev:tauri-web']?.startsWith('node ../../scripts/run-autocut-vite.mjs '), 'desktop dev:tauri-web uses the stable AutoCut Vite runner instead of relying on node_modules/.bin');
assertRule(desktopPackage.scripts?.['tauri:before-dev'] === 'pnpm dev:tauri-web', 'desktop tauri:before-dev delegates to the deterministic Tauri web dev script');
assertRule(rootPackage.scripts?.dev?.includes('--filter @sdkwork/autocut-desktop'), 'root dev delegates to the desktop package');
assertRule(rootPackage.scripts?.build?.includes('--filter @sdkwork/autocut-desktop'), 'root build delegates to the desktop package');
assertRule(rootPackage.scripts?.typecheck === 'node scripts/check-autocut-workspace-typecheck.mjs', 'root typecheck runs the stable workspace TypeScript API runner');
assertRule(rootPackage.scripts?.lint?.includes('check:autocut-architecture'), 'root lint includes AutoCut architecture governance');
assertRule(rootPackage.scripts?.clean === 'node scripts/clean-autocut-generated.mjs', 'root clean delegates to the standard generated-output cleanup script');
assertRule(exists('scripts/ensure-autocut-tauri-rust-toolchain.mjs'), 'AutoCut defines a Rust toolchain guard script for desktop Tauri commands');
assertRule(
  rootPackage.scripts?.test?.includes('node scripts/ensure-autocut-tauri-rust-toolchain.test.mjs'),
  'root test runs the AutoCut Tauri Rust toolchain guard contract',
);
assertRule(!rootPackage.scripts?.start, 'root package.json does not define a legacy Node start script');
assertRule(exists('DATABASE_SPEC.md'), 'root DATABASE_SPEC.md exists as the canonical database definition standard');
for (const marker of requiredDatabaseSpecMarkers) {
  assertRule(databaseSpecSource.includes(marker), `DATABASE_SPEC.md contains required database standard marker ${marker}`);
}
assertRule(exists(requiredDatabaseContractDoc), `${requiredDatabaseContractDoc} exists as the AutoCut database contract standard`);
for (const marker of requiredDatabaseContractMarkers) {
  assertRule(databaseContractSource.includes(marker), `${requiredDatabaseContractDoc} contains required AutoCut database marker ${marker}`);
}

const allRootDeps = {
  ...(rootPackage.dependencies ?? {}),
  ...(rootPackage.devDependencies ?? {}),
};
const allDesktopDeps = {
  ...(desktopPackage.dependencies ?? {}),
  ...(desktopPackage.devDependencies ?? {}),
};
for (const depName of requiredRootToolDependencies) {
  assertRule(Boolean(allRootDeps[depName]), `root package.json declares required workspace orchestration dependency ${depName}`);
}
for (const depName of requiredRootInternalDependencies) {
  assertRule(rootPackage.dependencies?.[depName] === 'workspace:*', `root package.json declares desktop package dependency ${depName} with workspace:*`);
}
for (const depName of requiredDesktopDependencies) {
  assertRule(Boolean(allDesktopDeps[depName]), `desktop package.json declares required runtime/tool dependency ${depName}`);
}
for (const depName of requiredDesktopInternalDependencies) {
  assertRule(desktopPackage.dependencies?.[depName] === 'workspace:*', `desktop package.json declares AutoCut package dependency ${depName} with workspace:*`);
}
for (const depName of forbiddenRootDependencies) {
  assertRule(!allRootDeps[depName], `root package.json does not depend on legacy AI Studio/server dependency ${depName}`);
  assertRule(!allDesktopDeps[depName], `desktop package.json does not depend on legacy AI Studio/server dependency ${depName}`);
}
assertRule(
  workspaceCatalogVersions['@tauri-apps/api'] === '2.10.1' &&
    workspaceCatalogVersions['@tauri-apps/cli'] === '2.10.1',
  'pnpm catalog pins Tauri JavaScript packages to the Rust tauri 2.10 minor line',
);
for (const depName of Object.keys(allRootDeps)) {
  if (depName.startsWith(internalPrefix)) {
    assertRule(packageNames.has(depName), `root package.json dependency ${depName} is a known AutoCut package`);
    assertRule(allRootDeps[depName] === 'workspace:*', `root package.json dependency ${depName} uses workspace:*`);
  } else {
    assertRule(allowedRootDependencies.has(depName), `root package.json dependency ${depName} is allowed by AutoCut desktop standard`);
    assertRule(allRootDeps[depName] === 'catalog:', `root package.json dependency ${depName} uses pnpm catalog version`);
    assertRule(workspaceCatalogNames.has(depName), `pnpm catalog declares root dependency ${depName}`);
  }
}

for (const excludedPath of ['artifacts/**', 'packages/sdkwork-autocut-desktop/src-tauri/target/**', 'packages/sdkwork-autocut-desktop/dist/**']) {
  assertRule(rootTsconfig.exclude?.includes(excludedPath), `root tsconfig excludes ${excludedPath}`);
}
assertRule(rootTsconfig.compilerOptions?.strict === true, 'root tsconfig enables strict TypeScript checking');
assertRule(rootTsconfig.compilerOptions?.exactOptionalPropertyTypes === true, 'root tsconfig distinguishes absent optional fields from explicit undefined');
assertRule(rootTsconfig.compilerOptions?.noUncheckedIndexedAccess === true, 'root tsconfig requires indexed access boundary handling');
assertRule(rootTsconfig.compilerOptions?.noUnusedLocals === true, 'root tsconfig rejects unused local declarations');
assertRule(rootTsconfig.compilerOptions?.noUnusedParameters === true, 'root tsconfig rejects unused function parameters');
for (const legacyExcludedPath of ['host/target/**', 'workspace/**', 'workspace-server-private-smoke/**']) {
  assertRule(
    !rootTsconfig.exclude?.includes(legacyExcludedPath),
    `root tsconfig does not retain legacy runtime exclude ${legacyExcludedPath}`,
  );
}
assertRule(
  !rootTsconfig.compilerOptions?.paths?.['@sdkwork/*'],
  'root tsconfig does not expose broad @sdkwork/* workspace alias',
);
assertRule(
  !rootTsconfig.compilerOptions?.paths?.['@/*'],
  'root tsconfig does not expose @/* root source alias',
);
assertRule(
  rootTsconfig.compilerOptions?.paths?.['@sdkwork/autocut-*']?.[0] === './packages/sdkwork-autocut-*/src/index.ts',
  'root tsconfig exposes only the @sdkwork/autocut-* package alias',
);
assertRule(frontendStandardSource.includes('noUnusedLocals'), 'frontend module standard documents noUnusedLocals as a TypeScript baseline');
assertRule(frontendStandardSource.includes('noUnusedParameters'), 'frontend module standard documents noUnusedParameters as a TypeScript baseline');
assertRule(frontendStandardSource.includes('strict'), 'frontend module standard documents strict TypeScript as a baseline');
assertRule(frontendStandardSource.includes('exactOptionalPropertyTypes'), 'frontend module standard documents exactOptionalPropertyTypes as a TypeScript baseline');
assertRule(frontendStandardSource.includes('noUncheckedIndexedAccess'), 'frontend module standard documents noUncheckedIndexedAccess as a TypeScript baseline');
assertRule(frontendStandardSource.includes('Task result traceability'), 'frontend module standard documents task result traceability');
assertRule(frontendStandardSource.includes('sourceTaskId'), 'frontend module standard documents sourceTaskId');
assertRule(frontendStandardSource.includes('sourceFileId'), 'frontend module standard documents sourceFileId');
assertRule(frontendStandardSource.includes('generatedAssetIds'), 'frontend module standard documents generatedAssetIds');
assertRule(frontendStandardSource.includes('Service-layer source validation'), 'frontend module standard documents service-layer source validation');
assertRule(frontendStandardSource.includes('validateAutoCutProcessingSource'), 'frontend module standard documents validateAutoCutProcessingSource');
assertRule(frontendStandardSource.includes('autocut_host_capabilities'), 'frontend module standard documents the native host capabilities command');
assertRule(frontendStandardSource.includes('ffmpegExecutionReady'), 'frontend module standard documents the honest FFmpeg execution readiness flag');
assertRule(frontendStandardSource.includes('autocut_database_health'), 'frontend module standard documents the native database health command');
assertRule(frontendStandardSource.includes('sqliteMigrationReady'), 'frontend module standard documents the SQLite migration readiness flag');
assertRule(frontendStandardSource.includes('autocut_ffmpeg_probe'), 'frontend module standard documents the native FFmpeg probe command');
assertRule(frontendStandardSource.includes('autocut_import_media_file'), 'frontend module standard documents the native media import command');
assertRule(frontendStandardSource.includes('autocut_describe_local_media_file'), 'frontend module standard documents the native local file describe command');
assertRule(frontendStandardSource.includes('autocut_select_local_video_file'), 'frontend module standard documents the native local video file chooser command');
assertRule(frontendStandardSource.includes('autocut_select_local_directory'), 'frontend module standard documents the native local directory chooser command');
assertRule(frontendStandardSource.includes('autocut_extract_audio'), 'frontend module standard documents the native audio extraction command');
assertRule(frontendStandardSource.includes('autocut_cancel_native_task'), 'frontend module standard documents the native task cancellation command');
assertRule(frontendStandardSource.includes('nativeTaskCancelCommandReady'), 'frontend module standard documents native task cancel readiness');
assertRule(frontendStandardSource.includes('autocut_recover_native_tasks'), 'frontend module standard documents the native task recovery command');
assertRule(frontendStandardSource.includes('nativeTaskRecoveryCommandReady'), 'frontend module standard documents native task recovery readiness');
assertRule(frontendStandardSource.includes('autocut_retry_native_task'), 'frontend module standard documents the native task retry command');
assertRule(frontendStandardSource.includes('nativeTaskRetryCommandReady'), 'frontend module standard documents native task retry readiness');
assertRule(frontendStandardSource.includes('nativeTaskProgressEventsReady'), 'frontend module standard documents native task progress event readiness');
assertRule(frontendStandardSource.includes('nativeWorkerLeaseReady'), 'frontend module standard documents native worker lease readiness');
assertRule(frontendStandardSource.includes('ops_task.progress'), 'frontend module standard documents persisted native task progress snapshots');
assertRule(frontendStandardSource.includes('OPS_TASK_EVENT_TYPE_PROGRESS'), 'frontend module standard documents native task progress audit events');
assertRule(frontendStandardSource.includes('AutoCutNativeTaskSnapshot.workerLeases'), 'frontend module standard documents native worker lease snapshots');
assertRule(frontendStandardSource.includes('AutoCutNativeTaskRecoveryResult.expiredLeases'), 'frontend module standard documents typed expired worker lease recovery diagnostics');
assertRule(frontendStandardSource.includes('AutoCutNativeTaskRecoveryResult.deferred'), 'frontend module standard documents typed deferred worker lease recovery diagnostics');
assertRule(frontendStandardSource.includes('reason: "expiredWorkerLease"'), 'frontend module standard documents expired worker lease recovery event reason');
assertRule(frontendStandardSource.includes('AutoCutNativeTaskEventSnapshot'), 'frontend module standard documents native task event snapshots');
assertRule(frontendStandardSource.includes('payloadJson'), 'frontend module standard documents raw native task event payloadJson audit copy');
assertRule(frontendStandardSource.includes('payload` is the parsed'), 'frontend module standard documents parsed native task event payload contract');
assertRule(frontendStandardSource.includes('autocut_generate_gif'), 'frontend module standard documents the native video GIF command');
assertRule(frontendStandardSource.includes('autocut_compress_video'), 'frontend module standard documents the native video compression command');
assertRule(frontendStandardSource.includes('autocut_convert_video'), 'frontend module standard documents the native video conversion command');
assertRule(frontendStandardSource.includes('autocut_enhance_video'), 'frontend module standard documents the native video enhancement command');
assertRule(frontendStandardSource.includes('assetUuid'), 'frontend module standard documents assetUuid based native media processing');
assertRule(frontendStandardSource.includes('media_artifact'), 'frontend module standard documents native media artifact registration');
assertRule(frontendStandardSource.includes('native-host-client.service.ts'), 'frontend module standard documents the typed native host client service');
assertRule(frontendStandardSource.includes('configureAutoCutNativeHostClient'), 'frontend module standard documents native host client configuration');
assertRule(frontendStandardSource.includes('ffmpegBundledReady'), 'frontend module standard documents bundled FFmpeg readiness');
assertRule(frontendStandardSource.includes('ffmpegToolchainManifestReady'), 'frontend module standard documents FFmpeg toolchain manifest readiness');
assertRule(frontendStandardSource.includes('ffmpegToolchainResolverReady'), 'frontend module standard documents FFmpeg toolchain resolver readiness');
assertRule(frontendStandardSource.includes('每个 package 的 `tsconfig.json` 必须继承根 `../../tsconfig.json`'), 'frontend module standard documents package tsconfig inheritance');
assertRule(frontendStandardSource.includes('desktop package 的 `tsconfig.json` 必须额外包含 `vite.config.ts`'), 'frontend module standard documents desktop package tsconfig scope');
assertRule(frontendStandardSource.includes('不得使用 TypeScript 非空断言'), 'frontend module standard forbids TypeScript non-null assertions');
assertRule(databaseContractSource.includes('001_baseline.sql'), 'database contract standard documents the package-local SQLite baseline');
assertRule(databaseContractSource.includes('autocut_host_baseline.yaml'), 'database contract standard documents the package-local schema registry');
assertRule(databaseContractSource.includes('media_artifact'), 'database contract standard documents media_artifact');
assertRule(databaseContractSource.includes('ops_stage_run'), 'database contract standard documents ops_stage_run');
assertRule(databaseContractSource.includes('ops_worker_lease'), 'database contract standard documents ops_worker_lease');
assertRule(databaseContractSource.includes('ops_schema_migration'), 'database contract standard documents ops_schema_migration');
assertRule(databaseContractSource.includes('run_autocut_database_migrations'), 'database contract standard documents the native SQLite migration runtime');
assertRule(databaseContractSource.includes('autocut_import_media_file'), 'database contract standard documents asset registration through media import');
assertRule(databaseContractSource.includes('Native task cancellation uses the existing `ops` tables'), 'database contract standard documents native task cancellation through existing ops tables');
assertRule(databaseContractSource.includes('No `autocut_*` or'), 'database contract standard forbids product-prefixed task tables for native cancellation');
assertRule(databaseContractSource.includes('cancel requested'), 'database contract standard documents cancel requested task state');
assertRule(databaseContractSource.includes('non-canceled acknowledgement without blind database mutation'), 'database contract standard documents non-blind native cancellation mutation');
assertRule(databaseContractSource.includes('Native task recovery also uses only the existing `ops` tables'), 'database contract standard documents native task recovery through existing ops tables');
assertRule(databaseContractSource.includes('interrupted'), 'database contract standard documents interrupted task recovery state');
assertRule(databaseContractSource.includes('autocut_recover_native_tasks'), 'database contract standard documents the native task recovery command');
assertRule(databaseContractSource.includes('must not mutate completed, failed, canceled, or'), 'database contract standard documents non-blind native recovery mutation');
assertRule(databaseContractSource.includes('Native task retry uses the existing `ops` tables'), 'database contract standard documents native task retry through existing ops tables');
assertRule(databaseContractSource.includes('autocut_retry_native_task'), 'database contract standard documents the native task retry command');
assertRule(databaseContractSource.includes('Native task progress uses the existing `ops` tables'), 'database contract standard documents native task progress through existing ops tables');
assertRule(databaseContractSource.includes('ops_task.progress'), 'database contract standard documents ops_task.progress as the progress snapshot');
assertRule(databaseContractSource.includes('OPS_TASK_EVENT_TYPE_PROGRESS'), 'database contract standard documents progress audit events');
assertRule(databaseContractSource.includes('parse_ffmpeg_progress_percent'), 'database contract standard documents FFmpeg progress parsing contract');
assertRule(databaseContractSource.includes('run_tracked_ffmpeg_command_with_progress'), 'database contract standard documents streaming native task progress');
assertRule(databaseContractSource.includes('record_ffmpeg_streaming_progress'), 'database contract standard documents persisted streaming progress updates');
assertRule(databaseContractSource.includes('standardize_native_task_event_payload'), 'database contract standard documents standardized native task event payload writes');
assertRule(databaseContractSource.includes('AutoCutNativeTaskEventSnapshot'), 'database contract standard documents typed native task event snapshots');
assertRule(databaseContractSource.includes('payloadJson'), 'database contract standard documents raw native task event payloadJson audit copy');
assertRule(databaseContractSource.includes('Native durable execution uses `ops_worker_lease`'), 'database contract standard documents native durable worker lease execution');
assertRule(databaseContractSource.includes('nativeWorkerLeaseReady'), 'database contract standard documents native worker lease readiness capability');
assertRule(databaseContractSource.includes('Recovery is lease-aware'), 'database contract standard documents lease-aware native task recovery');
assertRule(databaseContractSource.includes('AutoCutNativeTaskRecoveryResult'), 'database contract standard documents typed native recovery diagnostics');
assertRule(databaseContractSource.includes('expiredLeases'), 'database contract standard documents expired worker lease recovery count');
assertRule(databaseContractSource.includes('deferred'), 'database contract standard documents deferred active lease recovery count');
assertRule(databaseContractSource.includes('retry requested'), 'database contract standard documents retry requested task events');
assertRule(databaseContractSource.includes('must create a new `ops_task`'), 'database contract standard documents retry creates a new task');
assertRule(databaseContractSource.includes('assetUuid'), 'database contract standard documents assetUuid as the processing boundary');
assertRule(databaseContractSource.includes('source_asset_uuid'), 'database contract standard documents artifact source asset traceability');
assertRule(architectSource.includes('ffmpeg.toolchain.json'), 'ARCHITECT.md documents the package-local FFmpeg toolchain manifest');
assertRule(architectSource.includes('prepare-autocut-ffmpeg-sidecar.mjs'), 'ARCHITECT.md documents the standardized FFmpeg sidecar preparation script');
assertRule(architectSource.includes('speech-transcription.toolchain.json'), 'ARCHITECT.md documents the package-local speech transcription toolchain manifest');
assertRule(architectSource.includes('prepare-autocut-speech-sidecar.mjs'), 'ARCHITECT.md documents the standardized Whisper sidecar preparation script');
assertRule(architectSource.includes('check-autocut-release-smoke-preflight.mjs'), 'ARCHITECT.md documents the standardized release smoke preflight script');
assertRule(architectSource.includes('write-autocut-native-release-smoke.mjs'), 'ARCHITECT.md documents the standardized native release smoke evidence writer script');
assertRule(architectSource.includes('--run-real-llm-secret-smoke'), 'ARCHITECT.md documents the real Windows LLM secret store smoke gate');
assertRule(architectSource.includes('write-autocut-installer-signature-evidence.mjs'), 'ARCHITECT.md documents the standardized installer signature evidence writer script');
assertRule(architectSource.includes('write-autocut-release-evidence.mjs'), 'ARCHITECT.md documents the standardized release evidence writer script');
assertRule(architectSource.includes('check-autocut-commercial-release-readiness.mjs'), 'ARCHITECT.md documents the standardized commercial release readiness gate script');
assertRule(architectSource.includes('runtime-environment.service.ts'), 'ARCHITECT.md documents the runtime environment service boundary');
assertRule(architectSource.includes('autocut_dev_settings'), 'ARCHITECT.md documents dev-scoped browser settings storage');
assertRule(architectSource.includes('autocut_release_settings'), 'ARCHITECT.md documents release-scoped browser settings storage');
assertRule(architectSource.includes('outputDirectory'), 'ARCHITECT.md documents configurable native outputDirectory');
assertRule(architectSource.includes('outputRootDir'), 'ARCHITECT.md documents native outputRootDir request propagation');
assertRule(architectSource.includes('{outputRootDir}/tasks/{task_uuid}/'), 'ARCHITECT.md documents configured task output directory layout');
assertRule(architectSource.includes('dev-default'), 'ARCHITECT.md documents dev-scoped native LLM secret names');
assertRule(architectSource.includes('release-default'), 'ARCHITECT.md documents release-scoped native LLM secret names');
assertRule(frontendStandardSource.includes('prepare-autocut-ffmpeg-sidecar.mjs'), 'frontend module standard documents FFmpeg sidecar preparation');
assertRule(frontendStandardSource.includes('prepare-autocut-speech-sidecar.mjs'), 'frontend module standard documents Whisper sidecar preparation');
assertRule(frontendStandardSource.includes('check-autocut-release-smoke-preflight.mjs'), 'frontend module standard documents FFmpeg release smoke preflight');
assertRule(frontendStandardSource.includes('write-autocut-native-release-smoke.mjs'), 'frontend module standard documents native release smoke evidence generation');
assertRule(frontendStandardSource.includes('--run-real-llm-secret-smoke'), 'frontend module standard documents the real Windows LLM secret store smoke gate');
assertRule(frontendStandardSource.includes('write-autocut-installer-signature-evidence.mjs'), 'frontend module standard documents installer signature evidence generation');
assertRule(frontendStandardSource.includes('write-autocut-release-evidence.mjs'), 'frontend module standard documents release evidence generation');
assertRule(frontendStandardSource.includes('check-autocut-commercial-release-readiness.mjs'), 'frontend module standard documents commercial release readiness gating');
assertRule(frontendStandardSource.includes('runtime-environment.service.ts'), 'frontend module standard documents the runtime environment service boundary');
assertRule(frontendStandardSource.includes('autocut_dev_settings'), 'frontend module standard documents dev-scoped browser settings storage');
assertRule(frontendStandardSource.includes('autocut_release_settings'), 'frontend module standard documents release-scoped browser settings storage');
assertRule(frontendStandardSource.includes('outputDirectory'), 'frontend module standard documents configurable native outputDirectory');
assertRule(frontendStandardSource.includes('outputRootDir'), 'frontend module standard documents native outputRootDir request propagation');
assertRule(frontendStandardSource.includes('{outputRootDir}/tasks/{task_uuid}/'), 'frontend module standard documents configured task output directory layout');
assertRule(frontendStandardSource.includes('dev-default'), 'frontend module standard documents dev-scoped native LLM secret names');
assertRule(frontendStandardSource.includes('release-default'), 'frontend module standard documents release-scoped native LLM secret names');
assertRule(readmeSource.includes('pnpm prepare:ffmpeg-sidecar'), 'README documents the FFmpeg sidecar preparation command');
assertRule(readmeSource.includes('pnpm prepare:speech-sidecar'), 'README documents the Whisper speech sidecar preparation command');
assertRule(readmeSource.includes('pnpm release:smoke-preflight'), 'README documents the FFmpeg release smoke preflight command');
assertRule(readmeSource.includes('pnpm release:native-smoke'), 'README documents the native release smoke evidence command');
assertRule(readmeSource.includes('--run-real-llm-secret-smoke'), 'README documents the real Windows LLM secret store smoke command');
assertRule(readmeSource.includes('pnpm release:installer-signature'), 'README documents the installer signature evidence command');
assertRule(readmeSource.includes('pnpm release:evidence'), 'README documents the release evidence command');
assertRule(readmeSource.includes('pnpm release:commercial-ready'), 'README documents the commercial release readiness gate command');
assertRule(readmeSource.includes('autocut_dev_settings'), 'README documents dev-scoped settings storage');
assertRule(readmeSource.includes('autocut_release_settings'), 'README documents release-scoped settings storage');
assertRule(readmeSource.includes('outputDirectory'), 'README documents configurable native outputDirectory');
assertRule(readmeSource.includes('outputRootDir'), 'README documents native outputRootDir request propagation');
assertRule(readmeSource.includes('{outputRootDir}/tasks/{task_uuid}/'), 'README documents configured task output directory layout');
assertRule(architectSource.includes('expiredLeases'), 'ARCHITECT.md documents expired worker lease recovery diagnostics');
assertRule(architectSource.includes('deferred'), 'ARCHITECT.md documents deferred worker lease recovery diagnostics');

const desktopSrcFiles = listFiles(desktopSrcDir, (file) => /\.(ts|tsx)$/.test(file));
const desktopCssFiles = listFiles(desktopSrcDir, (file) => /\.css$/.test(file));
const appSource = fs.existsSync(path.join(desktopSrcDir, 'App.tsx'))
  ? fs.readFileSync(path.join(desktopSrcDir, 'App.tsx'), 'utf8')
  : '';
const desktopMainSource = fs.existsSync(path.join(desktopSrcDir, 'main.tsx'))
  ? fs.readFileSync(path.join(desktopSrcDir, 'main.tsx'), 'utf8')
  : '';
const desktopNativeHostSource = fs.existsSync(path.join(desktopSrcDir, 'native-host.ts'))
  ? fs.readFileSync(path.join(desktopSrcDir, 'native-host.ts'), 'utf8')
  : '';
const toolsRegistrySource = fs.existsSync(path.join(rootDir, requiredToolsRegistryPath))
  ? fs.readFileSync(path.join(rootDir, requiredToolsRegistryPath), 'utf8')
  : '';
const serviceIndexSource = fs.existsSync(path.join(packagesDir, 'sdkwork-autocut-services', 'src', 'index.ts'))
  ? fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-services', 'src', 'index.ts'), 'utf8')
  : '';
const i18nServiceSource = fs.existsSync(path.join(packagesDir, 'sdkwork-autocut-services', 'src', 'service', 'i18n.service.ts'))
  ? fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-services', 'src', 'service', 'i18n.service.ts'), 'utf8')
  : '';
const autocutTypesSource = fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-types', 'src', 'index.ts'), 'utf8');
const tasksPageSource = fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-tasks', 'src', 'pages', 'TasksPage.tsx'), 'utf8');
const taskDetailPageSource = fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-tasks', 'src', 'pages', 'TaskDetailPage.tsx'), 'utf8');
const realProcessingServiceSources = realProcessingServicePaths
  .map((relativePath) => (exists(relativePath) ? fs.readFileSync(path.join(rootDir, relativePath), 'utf8') : ''))
  .join('\n');
const autocutEventSource = fs.existsSync(path.join(packagesDir, 'sdkwork-autocut-services', 'src', 'service', 'events.service.ts'))
  ? fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-services', 'src', 'service', 'events.service.ts'), 'utf8')
  : '';
const storageServiceSource = fs.existsSync(path.join(rootDir, requiredStorageServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredStorageServicePath), 'utf8')
  : '';
const runtimeEnvironmentServiceSource = fs.existsSync(path.join(rootDir, requiredRuntimeEnvironmentServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredRuntimeEnvironmentServicePath), 'utf8')
  : '';
const workflowPreferencesServiceSource = fs.existsSync(path.join(rootDir, requiredWorkflowPreferencesServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredWorkflowPreferencesServicePath), 'utf8')
  : '';
const settingsServiceSource = fs.existsSync(path.join(rootDir, requiredSettingsServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredSettingsServicePath), 'utf8')
  : '';
const i18nResourcesServiceSource = fs.existsSync(path.join(rootDir, requiredI18nResourcesServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredI18nResourcesServicePath), 'utf8')
  : '';
const settingsRegistrySource = fs.existsSync(path.join(rootDir, requiredSettingsRegistryPath))
  ? fs.readFileSync(path.join(rootDir, requiredSettingsRegistryPath), 'utf8')
  : '';
const settingsPageSource = fs.existsSync(path.join(packagesDir, 'sdkwork-autocut-settings', 'src', 'pages', 'SettingsPage.tsx'))
  ? fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-settings', 'src', 'pages', 'SettingsPage.tsx'), 'utf8')
  : '';
const mediaFixturesServiceSource = fs.existsSync(path.join(rootDir, requiredMediaFixturesServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredMediaFixturesServicePath), 'utf8')
  : '';
const slicerPageSource = fs.existsSync(path.join(packagesDir, 'sdkwork-autocut-slicer', 'src', 'pages', 'SlicerPage.tsx'))
  ? fs.readFileSync(path.join(packagesDir, 'sdkwork-autocut-slicer', 'src', 'pages', 'SlicerPage.tsx'), 'utf8')
  : '';
const datetimeServiceSource = fs.existsSync(path.join(rootDir, requiredDatetimeServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredDatetimeServicePath), 'utf8')
  : '';
const downloadServiceSource = fs.existsSync(path.join(rootDir, requiredDownloadServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredDownloadServicePath), 'utf8')
  : '';
const processingSourceServiceSource = fs.existsSync(path.join(rootDir, requiredProcessingSourceServicePath))
  ? fs.readFileSync(path.join(rootDir, requiredProcessingSourceServicePath), 'utf8')
  : '';
const trustedFileSourceSource = fs.existsSync(path.join(rootDir, requiredTrustedFileSourcePath))
  ? fs.readFileSync(path.join(rootDir, requiredTrustedFileSourcePath), 'utf8')
  : '';
const forbiddenRootDirs = ['components', 'domain', 'ports', 'services', 'utils'];
for (const dir of forbiddenRootDirs) {
  assertRule(!exists(`src/${dir}`), `root src/${dir} is not used for new AutoCut business implementation`);
}

for (const file of desktopSrcFiles) {
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  assertRule(allowedDesktopSourceFiles.has(relative), `desktop package source file ${relative} is allowed thin-shell code`);
  const sourceText = fs.readFileSync(file, 'utf8');
  assertNoForbiddenSourcePatterns(relative, sourceText);
  assertNoTypeScriptNonNullAssertions(relative, sourceText);
  for (const importSpecifier of parseStaticImports(file)) {
    if (importSpecifier.startsWith('.')) {
      continue;
    }
    const depName = dependencyName(importSpecifier);
    const isAllowedRootImport =
      depName === 'react' ||
      depName === 'react-dom' ||
      depName === 'react-i18next' ||
      depName === 'react-router-dom' ||
      depName === '@tauri-apps/api' ||
      depName.startsWith(internalPrefix);
    assertRule(isAllowedRootImport, `${relative} imports only desktop-shell approved dependency ${depName}`);
    if (depName.startsWith(internalPrefix)) {
      assertRule(packageNames.has(depName), `${relative} imports known AutoCut package ${depName}`);
      assertRule(desktopPackage.dependencies?.[depName] === 'workspace:*', `desktop package.json declares imported AutoCut dependency ${depName}`);
    }
  }
}

for (const entry of fs.readdirSync(desktopPackageDir, { withFileTypes: true })) {
  assertRule(
    allowedDesktopPackageEntries.has(entry.name),
    `desktop package root entry ${entry.name} is allowed by the package-local desktop standard`,
  );
  if (entry.isFile()) {
    assertRule(!entry.name.endsWith('.log'), `desktop package generated log ${entry.name} is not present`);
    assertRule(!entry.name.endsWith('.tsbuildinfo'), `desktop package generated TypeScript build info ${entry.name} is not present`);
  }
}
for (const entry of fs.readdirSync(path.join(desktopPackageDir, 'public'), { withFileTypes: true })) {
  assertRule(
    allowedDesktopPublicEntries.has(entry.name),
    `desktop public entry ${entry.name} is an approved desktop static asset`,
  );
}
for (const entry of fs.readdirSync(desktopTauriDir, { withFileTypes: true })) {
  assertRule(
    allowedDesktopTauriEntries.has(entry.name),
    `desktop src-tauri entry ${entry.name} is allowed by the thin Tauri shell standard`,
  );
}
assertRule(
  fs.existsSync(path.join(desktopTauriDir, 'capabilities')),
  'desktop src-tauri declares explicit Tauri v2 capabilities for frontend API permissions',
);
assertRule(
  fs.existsSync(desktopTauriDefaultCapabilityPath),
  'desktop src-tauri capabilities/default.json is the canonical main-window permission contract',
);
assertRule(
  desktopTauriDefaultCapability.identifier === 'autocut-main-window',
  'desktop Tauri default capability uses the canonical AutoCut main-window identifier',
);
assertRule(
  Array.isArray(desktopTauriDefaultCapability.windows) &&
    desktopTauriDefaultCapability.windows.length === 1 &&
    desktopTauriDefaultCapability.windows[0] === 'main',
  'desktop Tauri default capability is scoped only to the main window',
);
for (const permission of [
  'core:default',
  'core:event:default',
  'core:event:allow-listen',
  'core:event:allow-unlisten',
  'core:webview:default',
  'core:window:default',
]) {
  assertRule(
    desktopTauriDefaultCapability.permissions?.includes(permission),
    `desktop Tauri default capability grants ${permission}`,
  );
}
for (const entry of fs.readdirSync(path.join(desktopTauriDir, 'icons'), { withFileTypes: true })) {
  assertRule(
    allowedDesktopTauriIconEntries.has(entry.name),
    `desktop src-tauri icon entry ${entry.name} is an approved bundle icon`,
  );
}
assertRule(
  Array.isArray(tauriConfig.bundle?.icon) && tauriConfig.bundle.icon.length > 0,
  'desktop Tauri bundle declares explicit installer and runtime icons',
);
for (const iconPath of tauriConfig.bundle?.icon ?? []) {
  const resolvedIconPath = path.join(desktopTauriDir, iconPath);
  assertRule(
    fs.existsSync(resolvedIconPath),
    `desktop Tauri bundle icon ${iconPath} exists for generate_context`,
  );
  if (iconPath.endsWith('.png') && fs.existsSync(resolvedIconPath)) {
    assertPngBitDepth(
      resolvedIconPath,
      8,
      `desktop Tauri bundle icon ${iconPath} is 8-bit PNG for macOS app icon generation`,
    );
  }
}
const desktopTauriBinariesDir = path.join(desktopTauriDir, 'binaries');
assertRule(
  fs.existsSync(desktopTauriBinariesDir),
  'desktop src-tauri owns binaries directory for native toolchain contracts',
);
if (fs.existsSync(desktopTauriBinariesDir)) {
  for (const entry of fs.readdirSync(desktopTauriBinariesDir, { withFileTypes: true })) {
    assertRule(
      allowedDesktopTauriBinariesEntries.has(entry.name),
      `desktop src-tauri binaries entry ${entry.name} is an approved toolchain contract asset`,
    );
  }
}
for (const entry of fs.readdirSync(path.join(desktopTauriDir, 'src'), { withFileTypes: true })) {
  assertRule(
    allowedDesktopTauriSrcEntries.has(entry.name),
    `desktop src-tauri/src entry ${entry.name} is allowed by the thin native shell standard`,
  );
}
assertRule(
  cargoTomlSource.includes('tauri = { version = "=2.10.3", features = ["protocol-asset"] }'),
  'desktop Tauri crate keeps Tauri features explicit and only enables the asset protocol required by local media previews',
);
assertRule(cargoTomlSource.includes('tauri-build = { version = "=2.5.6", features = [] }'), 'desktop Tauri build crate is pinned exactly for deterministic CLI compatibility');
assertRule(!cargoTomlSource.includes('tauri-plugin-'), 'desktop Tauri crate does not add native plugins without an architecture contract');
assertRule(cargoTomlSource.includes('reqwest = { version = "0.12"'), 'desktop Tauri crate declares reqwest for the contracted native LLM HTTP bridge');
assertRule(cargoTomlSource.includes('features = ["blocking", "json", "rustls-tls"]'), 'desktop Tauri reqwest dependency uses blocking rustls JSON transport for deterministic command execution');
assertRule(cargoTomlSource.includes('keyring-core = "1.0.0"'), 'desktop Tauri crate declares keyring-core for the contracted native LLM secret store');
assertRule(cargoTomlSource.includes('windows-native-keyring-store = "1.0.0"'), 'desktop Tauri crate declares the Windows native keyring store for desktop LLM secrets');
assertRule(cargoTomlSource.includes('serde = { version = "1.0"'), 'desktop Tauri crate declares serde for native host DTO contracts');
assertRule(cargoTomlSource.includes('serde_json = "1.0"'), 'desktop Tauri crate declares serde_json for native host diagnostics payloads');
assertRule(cargoTomlSource.includes('sha2 = "0.10"'), 'desktop Tauri crate declares sha2 only for FFmpeg sidecar checksum verification');
assertRule(cargoTomlSource.includes('rusqlite = { version = "0.32"'), 'desktop Tauri crate declares rusqlite after the database contract is implemented');
assertRule(cargoTomlSource.includes('uuid = { version = "1"') && cargoTomlSource.includes('features = ["v7"]'), 'desktop Tauri crate declares uuid v7 for native task ids');
assertRule(cargoTomlSource.includes('features = ["bundled"]'), 'desktop Tauri crate uses bundled SQLite for deterministic desktop builds');
assertRule(cargoTomlSource.includes('rfd = { version = "0.16.0"'), 'desktop Tauri crate declares rfd for the contracted trusted local file chooser');
assertRule(!cargoTomlSource.includes('sqlx'), 'desktop Tauri crate does not add SQLx before the database contract is implemented');
assertRule(
  tauriConfig.app?.security?.assetProtocol?.enable === true,
  'desktop Tauri config enables the asset protocol used by convertFileSrc previews',
);
assertRule(
    nativeMediaRuntimeSource.includes('allow_autocut_asset_protocol_directory_scope') &&
    nativeMediaRuntimeSource.includes('tauri::scope::Scopes') &&
    /scopes\s*\.allow_directory\(directory_path,\s*true\)/u.test(nativeMediaRuntimeSource) &&
    nativeMediaRuntimeSource.includes('allow_autocut_asset_protocol_file_parent_scope') &&
    nativeMediaRuntimeSource.includes('allow_autocut_asset_protocol_directory_scope(app, &media_root)?'),
  'desktop native runtime grants asset protocol preview access through trusted runtime scopes instead of broad static filesystem scope',
);
assertRule(
    nativeMediaRuntimeSource.includes('allow_autocut_native_task_preview_scopes') &&
    nativeMediaRuntimeSource.includes('collect_autocut_native_task_preview_directories') &&
    nativeMediaRuntimeSource.includes('read_autocut_task_output_root_dir') &&
    nativeMediaRuntimeSource.includes('allow_autocut_native_task_preview_scopes(app, &snapshots);') &&
    nativeMediaRuntimeSource.includes('allow_existing_autocut_asset_protocol_directory_scope(app, &directory_path).is_err()') &&
    nativeMediaRuntimeSource.includes('fn ensure_existing_autocut_preview_directory_path'),
  'desktop native task listing restores trusted asset protocol preview scopes for persisted task outputs after app restart without failing task queries or recreating stale output paths',
);
assertRule(
  Array.isArray(tauriConfig.app?.security?.assetProtocol?.scope) &&
    tauriConfig.app.security.assetProtocol.scope.includes('$APPDATA/**'),
  'desktop Tauri asset protocol scope allows the per-user AutoCut app-data media root',
);
assertRule(
  tauriConfig.app?.security?.csp?.includes('asset:') &&
    tauriConfig.app.security.csp.includes('http://asset.localhost'),
  'desktop Tauri CSP allows both asset: and http://asset.localhost preview URLs',
);
assertRule(mainRsSource.includes('mod commands;'), 'desktop Tauri main.rs declares the native commands module');
assertRule(mainRsSource.includes('mod database_contract;'), 'desktop Tauri main.rs declares the database contract module');
assertRule(mainRsSource.includes('mod database_runtime;'), 'desktop Tauri main.rs declares the database runtime module');
assertRule(mainRsSource.includes('mod host_contract;'), 'desktop Tauri main.rs declares the host contract module');
assertRule(mainRsSource.includes('mod llm_http_runtime;'), 'desktop Tauri main.rs declares the LLM HTTP runtime module');
assertRule(mainRsSource.includes('mod llm_secret_runtime;'), 'desktop Tauri main.rs declares the LLM secret runtime module');
assertRule(mainRsSource.includes('mod media_runtime;'), 'desktop Tauri main.rs declares the media runtime module');
assertRule(
  mainRsSource.includes('commands::autocut_host_capabilities') &&
    mainRsSource.includes('commands::autocut_database_health') &&
    mainRsSource.includes('commands::autocut_ffmpeg_probe') &&
    mainRsSource.includes('commands::autocut_import_media_file') &&
    mainRsSource.includes('commands::autocut_describe_local_media_file') &&
    mainRsSource.includes('commands::autocut_select_local_video_file') &&
    mainRsSource.includes('commands::autocut_select_local_directory') &&
    mainRsSource.includes('commands::autocut_allow_local_media_preview_directory') &&
    mainRsSource.includes('commands::autocut_list_native_tasks') &&
    mainRsSource.includes('commands::autocut_cancel_native_task') &&
    mainRsSource.includes('commands::autocut_recover_native_tasks') &&
    mainRsSource.includes('commands::autocut_retry_native_task') &&
    mainRsSource.includes('commands::autocut_transcribe_media') &&
    mainRsSource.includes('commands::autocut_extract_visual_evidence') &&
    mainRsSource.includes('commands::autocut_extract_audio') &&
    mainRsSource.includes('commands::autocut_extract_audio_fingerprint') &&
    mainRsSource.includes('commands::autocut_generate_gif') &&
    mainRsSource.includes('commands::autocut_slice_video') &&
    mainRsSource.includes('commands::autocut_compress_video') &&
    mainRsSource.includes('commands::autocut_convert_video') &&
    mainRsSource.includes('commands::autocut_enhance_video') &&
    mainRsSource.includes('commands::autocut_llm_http_request') &&
    mainRsSource.includes('commands::autocut_save_llm_secret') &&
    mainRsSource.includes('commands::autocut_get_llm_secret') &&
    mainRsSource.includes('commands::autocut_delete_llm_secret') &&
    mainRsSource.includes('commands::autocut_audio_smoke'),
  'desktop Tauri main.rs exposes only the standard native host, database, media, speech, LLM HTTP, and LLM secret runtime commands',
);
assertSetsEqual(
  nativeMainRegisteredCommandNames,
  nativeHostCommandNames,
  'desktop Tauri main.rs registers every command exposed by commands.rs and no stale command names',
);
assertSetsEqual(
  nativeHostSupportedCommandNames,
  nativeHostCommandNames,
  'native host capabilities supportedCommands mirrors commands.rs exactly',
);
assertSetsEqual(
  nativeHostClientCommandNames,
  nativeHostCommandNames,
  'renderer native host client invokes only commands registered by the native host',
);
assertRule(exists(requiredNativeHostCommandSourcePath), 'desktop Tauri owns native host commands.rs');
assertRule(exists(requiredNativeHostContractSourcePath), 'desktop Tauri owns host_contract.rs');
assertRule(exists(requiredNativeDatabaseContractSourcePath), 'desktop Tauri owns database_contract.rs');
assertRule(exists(requiredNativeDatabaseRuntimeSourcePath), 'desktop Tauri owns database_runtime.rs');
assertRule(exists(requiredNativeMediaRuntimeSourcePath), 'desktop Tauri owns media_runtime.rs');
assertRule(exists(requiredNativeLlmHttpRuntimeSourcePath), 'desktop Tauri owns llm_http_runtime.rs');
assertRule(exists(requiredNativeLlmSecretRuntimeSourcePath), 'desktop Tauri owns llm_secret_runtime.rs');
assertRule(exists(requiredNativeFfmpegToolchainManifestPath), 'desktop Tauri owns the FFmpeg toolchain manifest contract');
assertRule(exists(requiredNativeSpeechToolchainManifestPath), 'desktop Tauri owns the speech-to-text toolchain manifest contract');
assertRule(nativeSpeechToolchainManifestSource.includes('"accelerationBackend": "cpu"'), 'speech-to-text toolchain manifest declares an explicit acceleration backend per platform instead of implicit CPU/GPU inference');
assertRule(nativeMediaRuntimeSource.includes('normalize_autocut_speech_acceleration_backend'), 'native media runtime validates speech-to-text toolchain acceleration backend metadata');
assertRule(nativeMediaRuntimeSource.includes('speech_toolchain_resolver_carries_bundled_acceleration_backend_into_probe'), 'native media runtime tests that bundled speech acceleration backend metadata reaches GPU probing');
assertRule(exists(requiredNativeSqliteBaselinePath), 'desktop Tauri owns SQLite baseline schema');
assertRule(exists(requiredNativeSchemaRegistryPath), 'desktop Tauri owns schema registry baseline');
assertRule(nativeHostCommandSource.includes('#[tauri::command]'), 'native host command is exposed through an explicit Tauri command');
assertRule(nativeHostCommandSource.includes('autocut_host_capabilities'), 'native host command exposes autocut_host_capabilities');
assertRule(nativeHostCommandSource.includes('host_contract::autocut_host_capabilities'), 'native host command delegates to host_contract');
assertRule(nativeHostCommandSource.includes('autocut_database_health'), 'native host command exposes autocut_database_health');
assertRule(nativeHostCommandSource.includes('autocut_ffmpeg_probe'), 'native host command exposes autocut_ffmpeg_probe');
assertRule(nativeHostCommandSource.includes('autocut_import_media_file'), 'native host command exposes autocut_import_media_file');
assertRule(nativeHostCommandSource.includes('autocut_describe_local_media_file'), 'native host command exposes autocut_describe_local_media_file');
assertRule(nativeHostCommandSource.includes('autocut_select_local_video_file'), 'native host command exposes autocut_select_local_video_file');
assertRule(nativeHostCommandSource.includes('autocut_select_local_directory'), 'native host command exposes autocut_select_local_directory');
assertRule(nativeHostCommandSource.includes('autocut_allow_local_media_preview_directory'), 'native host command exposes autocut_allow_local_media_preview_directory');
assertRule(nativeHostCommandSource.includes('autocut_list_native_tasks'), 'native host command exposes autocut_list_native_tasks');
assertRule(nativeHostCommandSource.includes('autocut_cancel_native_task'), 'native host command exposes autocut_cancel_native_task');
assertRule(nativeHostCommandSource.includes('autocut_recover_native_tasks'), 'native host command exposes autocut_recover_native_tasks');
assertRule(nativeHostCommandSource.includes('autocut_retry_native_task'), 'native host command exposes autocut_retry_native_task');
assertRule(nativeHostCommandSource.includes('autocut_transcribe_media'), 'native host command exposes autocut_transcribe_media');
assertRule(nativeHostCommandSource.includes('autocut_extract_visual_evidence'), 'native host command exposes autocut_extract_visual_evidence');
assertRule(nativeHostCommandSource.includes('autocut_extract_audio'), 'native host command exposes autocut_extract_audio');
assertRule(nativeHostCommandSource.includes('autocut_generate_gif'), 'native host command exposes autocut_generate_gif');
assertRule(nativeHostCommandSource.includes('autocut_slice_video'), 'native host command exposes autocut_slice_video');
assertRule(nativeHostCommandSource.includes('autocut_compress_video'), 'native host command exposes autocut_compress_video');
assertRule(nativeHostCommandSource.includes('autocut_convert_video'), 'native host command exposes autocut_convert_video');
assertRule(nativeHostCommandSource.includes('autocut_enhance_video'), 'native host command exposes autocut_enhance_video');
assertRule(nativeHostCommandSource.includes('autocut_llm_http_request'), 'native host command exposes autocut_llm_http_request');
assertRule(nativeHostCommandSource.includes('autocut_save_llm_secret'), 'native host command exposes autocut_save_llm_secret');
assertRule(nativeHostCommandSource.includes('autocut_get_llm_secret'), 'native host command exposes autocut_get_llm_secret');
assertRule(nativeHostCommandSource.includes('autocut_delete_llm_secret'), 'native host command exposes autocut_delete_llm_secret');
assertRule(nativeHostCommandSource.includes('autocut_audio_smoke'), 'native host command exposes autocut_audio_smoke');
assertRule(
  nativeHostCommandSource.includes('run_autocut_database_migrations'),
  'native host command delegates database initialization to database_runtime',
);
assertRule(
    nativeHostCommandSource.includes('media_runtime::probe_autocut_ffmpeg') &&
    nativeHostCommandSource.includes('media_runtime::import_autocut_media_file') &&
    nativeHostCommandSource.includes('media_runtime::describe_autocut_local_media_file') &&
    nativeHostCommandSource.includes('media_runtime::select_autocut_local_directory') &&
    nativeHostCommandSource.includes('media_runtime::list_autocut_native_tasks') &&
    nativeHostCommandSource.includes('media_runtime::cancel_autocut_native_task') &&
    nativeHostCommandSource.includes('media_runtime::recover_autocut_native_tasks') &&
    nativeHostCommandSource.includes('media_runtime::retry_autocut_native_task') &&
    nativeHostCommandSource.includes('media_runtime::transcribe_autocut_media_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::extract_autocut_visual_evidence') &&
    nativeHostCommandSource.includes('media_runtime::extract_autocut_audio_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::generate_autocut_gif_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::slice_autocut_video_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::compress_autocut_video_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::convert_autocut_video_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::enhance_autocut_video_from_asset') &&
    nativeHostCommandSource.includes('media_runtime::run_autocut_audio_smoke'),
  'native host command delegates media operations to media_runtime',
);
assertRule(
  nativeHostCommandSource.includes('run_autocut_blocking_native_command') &&
    nativeHostCommandSource.includes('tauri::async_runtime::spawn_blocking') &&
    nativeHostCommandSource.includes('pub async fn autocut_import_media_file') &&
    nativeHostCommandSource.includes('pub async fn autocut_transcribe_media') &&
    nativeHostCommandSource.includes('pub async fn autocut_extract_visual_evidence') &&
    nativeHostCommandSource.includes('pub async fn autocut_slice_video'),
  'native host runs Smart Slice import, speech transcription, visual evidence, and rendering commands on a blocking worker pool instead of the Tauri main thread',
);
for (const commandName of [
  'autocut_host_capabilities',
  'autocut_ffmpeg_probe',
  'autocut_import_media_file',
  'autocut_describe_local_media_file',
  'autocut_download_speech_transcription_model',
  'autocut_probe_speech_transcription',
  'autocut_extract_audio',
  'autocut_generate_gif',
  'autocut_slice_video',
  'autocut_analyze_video_slice_audio_activity',
  'autocut_transcribe_media',
  'autocut_extract_visual_evidence',
  'autocut_write_task_evidence_json',
  'autocut_compress_video',
  'autocut_convert_video',
  'autocut_enhance_video',
  'autocut_audio_smoke',
  'autocut_llm_http_request',
]) {
  assertRule(
    nativeHostCommandSource.includes(`pub async fn ${commandName}`) &&
      nativeHostCommandSource.includes(`run_autocut_blocking_native_command("${commandName}"`),
    `native host command ${commandName} runs blocking media or STT work on the worker pool`,
  );
}
assertRule(
  nativeHostCommandSource.includes('llm_http_runtime::send_autocut_llm_http_request'),
  'native host command delegates LLM HTTP requests to llm_http_runtime',
);
assertRule(
  nativeHostCommandSource.includes('llm_secret_runtime::save_autocut_llm_secret') &&
    nativeHostCommandSource.includes('llm_secret_runtime::get_autocut_llm_secret') &&
    nativeHostCommandSource.includes('llm_secret_runtime::delete_autocut_llm_secret'),
  'native host command delegates LLM secret operations to llm_secret_runtime',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutLocalMediaFileDescription'),
  'native local file describe command returns a typed local media description',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutVideoGifRequest') &&
    nativeHostCommandSource.includes('AutoCutVideoGifResult'),
  'native GIF command returns a typed video GIF result',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutVideoSliceRequest') &&
    nativeHostCommandSource.includes('AutoCutVideoSliceResult'),
  'native video slice command returns a typed video slice result',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutVideoCompressRequest') &&
    nativeHostCommandSource.includes('AutoCutVideoCompressResult'),
  'native video compression command returns a typed video compression result',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutVideoConvertRequest') &&
    nativeHostCommandSource.includes('AutoCutVideoConvertResult'),
  'native video conversion command returns a typed video conversion result',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutVideoEnhanceRequest') &&
    nativeHostCommandSource.includes('AutoCutVideoEnhanceResult'),
  'native video enhancement command returns a typed video enhancement result',
);
assertRule(
  nativeHostCommandSource.includes('AutoCutSpeechTranscriptionRequest') &&
    nativeHostCommandSource.includes('AutoCutSpeechTranscriptionResult'),
  'native speech transcription command returns a typed speech transcription result',
);
for (const marker of requiredNativeHostMarkers) {
  assertRule(nativeHostContractSource.includes(marker), `host_contract.rs contains ${marker}`);
}
for (const marker of [
  'AutoCutLlmHttpRequest',
  'AutoCutLlmHttpResponse',
  'send_autocut_llm_http_request',
  'reqwest::blocking::Client',
  'https://',
]) {
  assertRule(nativeLlmHttpRuntimeSource.includes(marker), `llm_http_runtime.rs contains ${marker}`);
}
for (const marker of [
  'AutoCutLlmSecretRequest',
  'AutoCutSaveLlmSecretRequest',
  'AutoCutGetLlmSecretResult',
  'AutoCutDeleteLlmSecretResult',
  'AUTOCUT_LLM_ENV_DEFAULT_SECRET_NAMES',
  '"dev-default"',
  '"release-default"',
  'save_autocut_llm_secret',
  'get_autocut_llm_secret',
  'delete_autocut_llm_secret',
  'reads_default_deepseek_api_key_from_environment_when_secret_is_missing',
  'ignores_deepseek_environment_key_for_unrecognized_default_secret_names',
  'keyring_core::Entry',
  'windows_native_keyring_store::Store',
  'keyring_core::Error::NoEntry',
  'real_windows_keyring_store_saves_reads_and_deletes_llm_secret',
  'SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE',
  'autocut-real-llm-secret-store-smoke=passed',
]) {
  assertRule(nativeLlmSecretRuntimeSource.includes(marker), `llm_secret_runtime.rs contains ${marker}`);
}
for (const marker of requiredNativeDatabaseMarkers) {
  assertRule(nativeDatabaseContractSource.includes(marker), `database_contract.rs contains ${marker}`);
}
for (const marker of requiredNativeDatabaseRuntimeMarkers) {
  assertRule(nativeDatabaseRuntimeSource.includes(marker), `database_runtime.rs contains ${marker}`);
}
for (const marker of requiredNativeMediaRuntimeMarkers) {
  assertRule(nativeMediaRuntimeSource.includes(marker), `media_runtime.rs contains ${marker}`);
}
assertRule(
  nativeMediaRuntimeSource.includes('native_media_task_writes_artifact_inside_its_task_output_directory'),
  'media_runtime.rs tests that native task artifacts are written directly under media/tasks/{task_uuid}',
);
assertRule(
  nativeMediaRuntimeSource.includes('native_task_uuid_uses_uuid_v7_contract') &&
    nativeMediaRuntimeSource.includes('task-native-slice-') &&
    nativeMediaRuntimeSource.includes('Uuid::now_v7()'),
  'media_runtime.rs generates native task ids with a task-native type prefix and UUIDv7 suffix',
);
assertRule(
  nativeMediaRuntimeSource.includes('video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir'),
  'media_runtime.rs tests that native video slicing writes every slice under one task output directory',
);
assertRule(
  nativeMediaRuntimeSource.includes('default_smart_slice_noise_reduction') &&
    nativeMediaRuntimeSource.includes('smart_slice_native_requests_default_to_raw_audio_when_noise_reduction_is_omitted') &&
    nativeMediaRuntimeSource.includes('smart_slice_native_requests_honor_disabled_noise_reduction') &&
    nativeMediaRuntimeSource.includes('clip.noise_reduction_applied = Some(apply_audio_noise_reduction)') &&
    nativeMediaRuntimeSource.includes('ensure_video_slice_clip_audio_cleanup_evidence') &&
    nativeMediaRuntimeSource.includes('video_slice_rejects_invalid_audio_cleanup_evidence_before_rendering') &&
    nativeMediaRuntimeSource.includes('video_slice_audio_activity_analysis_preserves_raw_audio_when_denoise_is_disabled') &&
    nativeMediaRuntimeSource.includes('video_slice_audio_activity_analysis_rejects_all_silence_instead_of_stt_fallback') &&
    !nativeMediaRuntimeSource.includes('confidence: 0.55') &&
    !nativeMediaRuntimeSource.includes('Some(0.55)'),
  'media_runtime.rs defaults native smart-slice cleanup to raw audio, records denoise decision evidence, rejects invalid cleanup metadata, and has no weak STT-only audio activity confidence fallback',
);
assertRule(
  nativeMediaRuntimeSource.includes('should_run_video_slice_audio_cleanup_postprocess') &&
    nativeMediaRuntimeSource.includes('AutoCutVideoSliceAudioPostprocessDecision') &&
    nativeMediaRuntimeSource.includes('ffmpeg-video-slice-postprocess-skipped') &&
    nativeMediaRuntimeSource.includes('postprocessSkipReason') &&
    nativeMediaRuntimeSource.includes('video_slice_audio_postprocess_skips_upstream_audio_activity_plan_for_large_file_rendering') &&
    nativeMediaRuntimeSource.includes('video_slice_audio_postprocess_skips_precomputed_source_segments_for_one_pass_rendering') &&
    nativeMediaRuntimeSource.includes('video_slice_audio_postprocess_skipped_render_pass_keeps_cleanup_filters') &&
    nativeMediaRuntimeSource.includes('create_video_slice_render_pass_clip') &&
    nativeMediaRuntimeSource.includes('should_apply_video_slice_audio_cleanup_during_render_pass') &&
    nativeMediaRuntimeSource.includes('video_slice_audio_postprocess_runs_only_when_cleanup_plan_is_missing') &&
    slicerServiceSource.includes("nativeAudioPostprocessPolicy: 'use-upstream-audio-boundary-plan'") &&
    slicerServiceSource.includes('clipsWithAudioActivityEvidence') &&
    slicerServiceSource.includes('clipsWithSourceSegments'),
  'native smart-slice rendering consumes the upstream cleanup plan directly, skips redundant post-cut audio analysis for large files, and exposes performance policy diagnostics',
);
assertRule(
  exists('scripts/check-autocut-smart-slice-performance-benchmark.mjs') &&
    smartSlicePerformanceBenchmarkSource.includes('smart-slice.performance-benchmark.v1') &&
    smartSlicePerformanceBenchmarkSource.includes('runAutoCutBaiduNetdiskRealMediaSliceAcceptanceCheck') &&
    smartSlicePerformanceBenchmarkSource.includes('runAutoCutGenericRealMediaSliceCheck') &&
    smartSlicePerformanceBenchmarkSource.includes('runAutoCutWenan5RealMediaSliceCheck') &&
    smartSlicePerformanceBenchmarkSource.includes('runnerOptions.transcriptPath') &&
    smartSlicePerformanceBenchmarkSource.includes('totalElapsedMs') &&
    smartSlicePerformanceBenchmarkSource.includes('byteSize: readFileByteSize(resolvedInputPath)') &&
    smartSlicePerformanceBenchmarkSource.includes('totalOutputBytes') &&
    smartSlicePerformanceBenchmarkSource.includes('thresholdResults') &&
    smartSlicePerformanceBenchmarkSource.includes('SMART_SLICE_PERFORMANCE_TOTAL_ELAPSED_EXCEEDED') &&
    smartSlicePerformanceBenchmarkSource.includes('SMART_SLICE_PERFORMANCE_RUN_FAILED') &&
    smartSlicePerformanceBenchmarkTestSource.includes('createSequenceClock') &&
    smartSlicePerformanceBenchmarkTestSource.includes('generic-real-media') &&
    smartSlicePerformanceBenchmarkTestSource.includes('caller-provided transcripts to the generic real-media runner') &&
    smartSlicePerformanceBenchmarkTestSource.includes('maxTotalElapsedMs') &&
    smartSlicePerformanceBenchmarkTestSource.includes('performance-benchmark-failed.json') &&
    rootPackage.scripts?.['benchmark:smart-slice-performance'] === 'node scripts/check-autocut-smart-slice-performance-benchmark.mjs' &&
    rootPackage.scripts?.test?.includes('node scripts/check-autocut-smart-slice-performance-benchmark.test.mjs'),
  'Smart Slice has a repeatable large-file performance benchmark report with input size, output bytes, timing thresholds, evidence readiness, and test coverage',
);
assertRule(
  exists('scripts/check-autocut-generic-real-media-slice.mjs') &&
    genericRealMediaSliceSource.includes('2026-05-16.autocut-generic-real-media-slice.v1') &&
    genericRealMediaSliceSource.includes('createSmartCutEngineSlicePlan') &&
    genericRealMediaSliceSource.includes('createTranscriptAssistedSlicePlan') &&
    genericRealMediaSliceSource.includes('createLargeMediaTranscriptContinuityPlan') &&
    genericRealMediaSliceSource.includes('large-media-transcript-continuity-fallback') &&
    genericRealMediaSliceSource.includes('renderClipLimit') &&
    genericRealMediaSliceSource.includes('smart-slice.speech-to-text.v1') &&
    genericRealMediaSliceSource.includes('smart-slice.semantic-segmentation.v1') &&
    genericRealMediaSliceSource.includes('smart-slice.render-artifact-manifest.v1') &&
    genericRealMediaSliceSource.includes('nativeTranscriptPath') &&
    genericRealMediaSliceTestSource.includes('generic real media Smart Slice contract') &&
    genericRealMediaSliceTestSource.includes('same-source transcript') &&
    genericRealMediaSliceTestSource.includes('large-media transcript continuity fallback merges dangling connector fragments') &&
    rootPackage.scripts?.['baseline:generic-real-media-slice'] === 'node scripts/check-autocut-generic-real-media-slice.mjs' &&
    rootPackage.scripts?.test?.includes('node scripts/check-autocut-generic-real-media-slice.test.mjs'),
  'Smart Slice generic real-media runner uses same-source transcript evidence, engine-first semantic planning, bounded large-file rendering, editable SRT sidecars, and execution evidence',
);
assertRule(
  exists('scripts/check-autocut-large-media-baseline.mjs') &&
    largeMediaBaselineSource.includes('smart-slice.large-media-baseline.v1') &&
    largeMediaBaselineSource.includes('SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_MISSING') &&
    largeMediaBaselineSource.includes('runAutoCutSmartSlicePerformanceBenchmark') &&
    largeMediaBaselineSource.includes('smart-slice.speech-to-text.v1') &&
    largeMediaBaselineSource.includes('normalizeSmartSliceTranscriptEvidenceText') &&
    largeMediaBaselineSource.includes('nativeTranscriptPath') &&
    largeMediaBaselineSource.includes('renderClipLimit') &&
    largeMediaBaselineSource.includes('SMART_SLICE_LARGE_MEDIA_BENCHMARK_BLOCKED') &&
    largeMediaBaselineTestSource.includes('large-media baseline must block instead of silently reusing the wenan5 transcript fixture') &&
    largeMediaBaselineTestSource.includes('not the wenan5 fixture') &&
    largeMediaBaselineTestSource.includes('renderClipLimit') &&
    rootPackage.scripts?.['baseline:large-media'] === 'node scripts/check-autocut-large-media-baseline.mjs' &&
    rootPackage.scripts?.test?.includes('node scripts/check-autocut-large-media-baseline.test.mjs'),
  'Smart Slice large-media baseline preflights real input media, requires same-source transcript evidence, blocks fixture reuse, and gates benchmark execution',
);
assertRule(
  exists('scripts/write-autocut-large-media-stt-baseline.mjs') &&
    largeMediaSttBaselineSource.includes('smart-slice.large-media-stt-baseline.v1') &&
    largeMediaSttBaselineSource.includes('SMART_SLICE_LARGE_MEDIA_AUDIO_EXTRACT_FAILED') &&
    largeMediaSttBaselineSource.includes('SMART_SLICE_LARGE_MEDIA_WHISPER_FAILED') &&
    largeMediaSttBaselineSource.includes('smart-slice.speech-to-text.v1') &&
    largeMediaSttBaselineSource.includes('smart-slice.large-media-source-identity.v1') &&
    largeMediaSttBaselineSource.includes('smart-slice.large-media-stt-chunks.v1') &&
    largeMediaSttBaselineSource.includes('chunked-parallel') &&
    largeMediaSttBaselineSource.includes('runAutoCutLargeMediaSttCommandAsync') &&
    largeMediaSttBaselineSource.includes('--chunk-duration-ms') &&
    largeMediaSttBaselineSource.includes('--parallelism') &&
    largeMediaSttBaselineSource.includes('--audio-duration-ms') &&
    largeMediaSttBaselineSource.includes('transcriptReusable') &&
    largeMediaSttBaselineSource.includes('audioReusable') &&
    largeMediaSttBaselineSource.includes("'-ac'") &&
    largeMediaSttBaselineSource.includes("'16000'") &&
    largeMediaSttBaselineSource.includes("'-ojf'") &&
    largeMediaSttBaselineTestSource.includes('large media STT baseline writes a blocked report when audio extraction fails') &&
    largeMediaSttBaselineTestSource.includes('reuses an already generated same-source transcript') &&
    largeMediaSttBaselineTestSource.includes('audio should have been reused') &&
    largeMediaSttBaselineTestSource.includes('interrupted large-media STT resumes from extracted same-source audio') &&
    largeMediaSttBaselineTestSource.includes('large-media STT baseline transcribes audio chunks concurrently') &&
    rootPackage.scripts?.['baseline:large-media-stt'] === 'node scripts/write-autocut-large-media-stt-baseline.mjs' &&
    rootPackage.scripts?.test?.includes('node scripts/write-autocut-large-media-stt-baseline.test.mjs'),
  'Smart Slice large-media STT baseline extracts mono 16k audio, resumes same-source large-file artifacts, parallelizes long-audio Whisper chunks, writes canonical STT evidence, and persists blocked reports',
);
assertRule(
  exists('scripts/prepare-autocut-speech-gpu-runtime.mjs') &&
    speechGpuRuntimeSource.includes('smart-slice.speech-gpu-runtime.v1') &&
    speechGpuRuntimeSource.includes('AUTOCUT_SPEECH_GPU_RUNTIME_MISSING') &&
    speechGpuRuntimeSource.includes('AUTOCUT_SPEECH_GPU_RUNTIME_UNVERIFIED') &&
    speechGpuRuntimeSource.includes('AUTOCUT_SPEECH_GPU_RUNTIME_LICENSE_NOT_ACCEPTED') &&
    speechGpuRuntimeSource.includes('prepareAutoCutSpeechSidecar') &&
    speechGpuRuntimeSource.includes('runAutoCutLargeMediaSttBaseline') &&
    speechGpuRuntimeSource.includes('-DGGML_CUDA=ON') &&
    speechGpuRuntimeSource.includes('ggml-cuda') &&
    speechGpuRuntimeSource.includes('cudart') &&
    speechGpuRuntimeTestSource.includes('CPU-only runtime must not be packaged as CUDA') &&
    speechGpuRuntimeTestSource.includes('GPU speech preparation must fail honestly') &&
    speechGpuRuntimeTestSource.includes('prepareSpeechSidecar') &&
    speechGpuRuntimeTestSource.includes('runSttBaseline') &&
    rootPackage.scripts?.['prepare:speech-gpu-runtime'] === 'node scripts/prepare-autocut-speech-gpu-runtime.mjs' &&
    rootPackage.scripts?.test?.includes('node scripts/prepare-autocut-speech-gpu-runtime.test.mjs'),
  'Smart Slice speech GPU runtime preparation verifies real CUDA/Vulkan whisper.cpp companions, packages only verified GPU runtimes, supports local build and benchmark handoff, and records honest blockers when GPU STT cannot run',
);
assertRule(
  nativeMediaRuntimeSource.includes('AUTOCUT_LONG_SPEECH_TRANSCRIPTION_THRESHOLD_MS') &&
    nativeMediaRuntimeSource.includes('AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_DURATION_MS') &&
    nativeMediaRuntimeSource.includes('AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_OVERLAP_MS') &&
    nativeMediaRuntimeSource.includes('should_use_chunked_local_speech_transcription') &&
    nativeMediaRuntimeSource.includes('run_chunked_local_whisper_transcription') &&
    nativeMediaRuntimeSource.includes('create_autocut_speech_audio_chunk_plan') &&
    nativeMediaRuntimeSource.includes('transcribe_local_whisper_chunks_parallel') &&
    nativeMediaRuntimeSource.includes('merge_autocut_speech_audio_chunk_segments') &&
    nativeMediaRuntimeSource.includes('write_merged_whisper_transcript_json') &&
    nativeMediaRuntimeSource.includes('write_autocut_speech_chunk_manifest') &&
    nativeMediaRuntimeSource.includes('smart-slice.large-media-stt-chunks.v1') &&
    nativeMediaRuntimeSource.includes('SourceMediaDirect') &&
    nativeMediaRuntimeSource.includes('source-media-direct') &&
    nativeMediaRuntimeSource.includes('fullAudioExtracted') &&
    nativeMediaRuntimeSource.includes('run_autocut_speech_chunk_pipeline_step') &&
    nativeMediaRuntimeSource.includes('AutoCutSpeechChunkPipelineStep::ExtractAudio') &&
    nativeMediaRuntimeSource.includes('AutoCutSpeechChunkPipelineStep::TranscribeAudio') &&
    nativeMediaRuntimeSource.includes('SDKWORK_AUTOCUT_WHISPER_CHUNK_PARALLELISM') &&
    nativeMediaRuntimeSource.includes('SDKWORK_AUTOCUT_WHISPER_CHUNK_THREADS') &&
    nativeMediaRuntimeSource.includes('long_speech_transcription_plans_overlapping_audio_chunks_for_parallel_whisper') &&
    nativeMediaRuntimeSource.includes('long_speech_transcription_source_chunk_extract_command_skips_video_decode') &&
    nativeMediaRuntimeSource.includes('long_speech_transcription_writes_source_direct_chunk_manifest') &&
    nativeMediaRuntimeSource.includes('long_speech_transcription_chunk_pipeline_resumes_finished_artifacts') &&
    nativeMediaRuntimeSource.includes('long_speech_transcription_writes_observable_chunk_manifest') &&
    nativeMediaRuntimeSource.includes('long_speech_transcription_writes_merged_transcript_as_parseable_whisper_json'),
  'media_runtime.rs routes long native speech-to-text through source-direct chunked parallel Whisper, merges back to the source timeline, writes versioned chunk evidence, and tests the commercial large-file contract',
);
assertRule(
  nativeMediaRuntimeSource.includes('video_slice_encoder_candidates_prioritize_platform_hardware_and_end_with_cpu_fallback') &&
    nativeMediaRuntimeSource.includes('video_slice_cpu_encoder_candidate_uses_compatible_libx264_output') &&
    nativeMediaRuntimeSource.includes('video_slice_encoder_attempt_diagnostics_preserve_all_candidate_failures'),
  'media_runtime.rs tests native video slicing hardware encoder discovery, CPU fallback compatibility, and candidate failure diagnostics',
);
assertRule(
  nativeMediaRuntimeSource.includes('video_slice_skips_clips_that_start_after_source_duration'),
  'media_runtime.rs tests that native video slicing skips clip plans outside source duration',
);
assertRule(
  nativeMediaRuntimeSource.includes('video_slice_fails_when_all_clips_are_outside_source_duration'),
  'media_runtime.rs tests that native video slicing fails with an audited task when every clip is outside source duration',
);
assertRule(
  nativeMediaRuntimeSource.includes('native_media_poll_throttler_runs_immediately_then_waits_for_interval'),
  'media_runtime.rs tests throttled native media polling for internal worker-lease maintenance during local speech-to-text execution',
);
assertRule(
  nativeMediaRuntimeSource.includes('native_media_poll_throttler_can_force_final_run'),
  'media_runtime.rs tests the final native media worker-lease poll after local speech-to-text process exit',
);
assertRule(
  nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_accepts_segment_timeline'),
  'media_runtime.rs tests Whisper JSON transcript parsing with segment timing',
);
assertRule(
  nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_accepts_comma_fraction_timestamps') &&
    nativeMediaRuntimeSource.includes('normalized.replace') &&
    nativeMediaRuntimeSource.includes("','") &&
    nativeMediaRuntimeSource.includes('parse_ffmpeg_out_time_to_millis'),
  'media_runtime.rs accepts Whisper/SRT-style comma timestamp fractions for local speech-to-text JSON parsing',
);
assertRule(
  nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_sorts_segments_by_start_time') &&
    nativeMediaRuntimeSource.includes('segments.sort_by') &&
    nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_accepts_explicit_millisecond_fields') &&
    nativeMediaRuntimeSource.includes('start_ms') &&
    nativeMediaRuntimeSource.includes('end_ms') &&
    nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_accepts_nested_result_segments') &&
    nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_accepts_chunk_timestamp_arrays') &&
    nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_accepts_nested_result_chunks') &&
    nativeMediaRuntimeSource.includes('result.chunks') &&
    nativeMediaRuntimeSource.includes('timestamp[{offsets_index}]') &&
    nativeMediaRuntimeSource.includes('read_whisper_segments_array') &&
    nativeMediaRuntimeSource.includes('result.segments'),
  'media_runtime.rs normalizes local speech-to-text JSON variants, including chunk timestamp arrays, into a sorted canonical transcript timeline',
);
assertRule(
  nativeMediaRuntimeSource.includes('MAX_SPEECH_TRANSCRIPT_JSON_BYTES') &&
    nativeMediaRuntimeSource.includes('MAX_SPEECH_TRANSCRIPT_SEGMENTS') &&
    nativeMediaRuntimeSource.includes('read_whisper_transcript_json_file') &&
    nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_rejects_oversized_payloads_before_deserialization') &&
    nativeMediaRuntimeSource.includes('parse_whisper_transcript_json_rejects_excessive_segment_counts') &&
    nativeMediaRuntimeSource.includes('read_whisper_transcript_json_file_rejects_oversized_files_before_loading') &&
    nativeMediaRuntimeSource.includes('fs::metadata(path)') &&
    !nativeMediaRuntimeSource.includes('let transcript_json = fs::read_to_string(&transcript_path)'),
  'media_runtime.rs limits local speech-to-text transcript JSON size and segment count before expensive processing',
);
assertRule(
  nativeMediaRuntimeSource.includes('speech_transcription_requires_local_toolchain_without_fake_transcript'),
  'media_runtime.rs tests that speech transcription fails closed when the local toolchain is not configured',
);
assertRule(
  nativeMediaRuntimeSource.includes('speech_toolchain_rejects_relative_executable_paths') &&
    nativeMediaRuntimeSource.includes('speech_toolchain_rejects_relative_model_paths') &&
    nativeMediaRuntimeSource.includes('speech_toolchain_rejects_unsupported_model_extensions') &&
    nativeMediaRuntimeSource.includes('speech_toolchain_rejects_partial_download_model_files') &&
    nativeMediaRuntimeSource.includes('speech_toolchain_rejects_too_small_model_files') &&
    nativeMediaRuntimeSource.includes('MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES') &&
    nativeMediaRuntimeSource.includes('ensure_supported_speech_executable_file_path') &&
    nativeMediaRuntimeSource.includes('ensure_supported_speech_model_file_path'),
  'media_runtime.rs enforces absolute local speech executable paths and complete supported local speech model files',
);
assertRule(
  nativeMediaRuntimeSource.includes('normalize_speech_transcription_language(language: Option<&str>) -> Result<String, String>') &&
    nativeMediaRuntimeSource.includes('is_supported_speech_transcription_language_tag') &&
    nativeMediaRuntimeSource.includes('speech_transcription_language_rejects_unsafe_tokens_instead_of_sanitizing') &&
    nativeMediaRuntimeSource.includes('speech_transcription_language_normalizes_bcp47_underscore_tags'),
  'media_runtime.rs validates speech transcription languages fail-closed while preserving BCP-47 normalization',
);
assertRule(
  nativeHostContractSource.includes('speech_toolchain_readiness_rejects_relative_executable_files'),
  'host_contract.rs tests that speech toolchain readiness rejects relative executable paths',
);
assertRule(
  nativeHostContractSource.includes('SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS') &&
    nativeHostContractSource.includes('MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES') &&
    nativeHostContractSource.includes('speech_toolchain_readiness_rejects_unsupported_model_extensions') &&
    nativeHostContractSource.includes('speech_toolchain_readiness_rejects_too_small_model_files'),
  'host_contract.rs reuses the native speech model extension and completeness contract for readiness checks',
);
assertRule(
  nativeMediaRuntimeSource.includes('video_slice_from_asset_writes_task_scoped_srt_subtitle_artifacts') &&
    nativeMediaRuntimeSource.includes('video_slice_burned_subtitle_mode_persists_editable_srt_sidecar') &&
    nativeMediaRuntimeSource.includes('video_slice_srt_subtitles_are_clipped_to_slice_boundaries') &&
    nativeMediaRuntimeSource.includes('write_video_slice_subtitle_artifact') &&
    nativeMediaRuntimeSource.includes('normalize_video_slice_subtitle_mode') &&
    nativeMediaRuntimeSource.includes('subtitle_mode') &&
    nativeMediaRuntimeSource.includes('build_video_slice_srt') &&
    nativeMediaRuntimeSource.includes('insert_media_slice_subtitle_artifact'),
  'media_runtime.rs tests and implements task-scoped SRT and burned subtitle artifacts for transcript-assisted slicing',
);
assertRule(
  slicerServiceSource.includes('assertNativeSliceSubtitleArtifactMatchesRequest') &&
    slicerServiceSource.includes('subtitle artifact was returned even though subtitle rendering was not requested') &&
    slicerServiceSource.includes('is missing the requested SRT subtitle artifact') &&
    serviceBehaviorCheckSource.includes('rejects native subtitle artifacts when subtitles are explicitly disabled') &&
    serviceBehaviorCheckSource.includes('does not persist video assets after unrequested native subtitle artifacts'),
  'slicerService.ts fails closed when native subtitle artifacts do not match the explicit subtitle request mode',
);
assertRule(
  nativeMediaRuntimeSource.includes('build_video_slice_burned_subtitle_force_style') &&
    nativeMediaRuntimeSource.includes('video_slice_subtitle_horizontal_margin') &&
    nativeMediaRuntimeSource.includes('video_slice_burned_subtitle_style_preset') &&
    nativeMediaRuntimeSource.includes('Alignment=2') &&
    nativeMediaRuntimeSource.includes('FontName=Microsoft YaHei') &&
    nativeMediaRuntimeSource.includes('BorderStyle=1') &&
    nativeMediaRuntimeSource.includes('Encoding=1') &&
    nativeMediaRuntimeSource.includes('MarginV=') &&
    nativeMediaRuntimeSource.includes('force_style='),
  'media_runtime.rs renders burned speech-to-text subtitles bottom-centered with adaptive safe areas, CJK-safe font rendering, and selected style presets',
);
assertRule(
  frontendStandardSource.includes('autocut_transcribe_media') &&
    frontendStandardSource.includes('SDKWORK_AUTOCUT_WHISPER_EXECUTABLE') &&
    frontendStandardSource.includes('transcript-assisted intelligent slicing') &&
    frontendStandardSource.includes('subtitleSegments') &&
    frontendStandardSource.includes('settings-backed local speech-to-text'),
  'frontend module standard documents local speech transcription, subtitle artifacts, and transcript-assisted intelligent slicing',
);
assertRule(
  slicePlannerSource.includes('selectOptimalSliceCandidateSetByDynamicProgramming') &&
    slicePlannerSource.includes('findPreviousCompatibleSliceCandidateIndexes') &&
    slicePlannerSource.includes('sortSliceClipsByEndMs') &&
    slicePlannerSource.includes('SLICE_CANDIDATE_DP_BEAM_WIDTH') &&
    slicePlannerSource.includes('isSliceCandidatePlanInternallyCompatible') &&
    slicePlannerSource.includes('doSliceCandidatesOverlap') &&
    slicePlannerSource.includes('areTranscriptSliceClipsRepeated') &&
    slicePlannerSource.includes('calculateTranscriptTokenOverlapScore') &&
    slicePlannerSource.includes('extractTranscriptRepeatTokens') &&
    slicePlannerSource.includes('STANDARD_TRANSCRIPT_SEGMENT_OVERLAP_TOLERANCE_MS') &&
    slicePlannerSource.includes('continuityOverlapToleranceMs') &&
    slicePlannerSource.includes('transcript-overlap-repaired'),
  'slicePlanner.ts selects smart slice candidates with bounded dynamic programming, non-overlap enforcement, STT overlap tolerance, and transcript token-overlap repeat filtering',
);
assertRule(
  slicerServiceSource.includes('SMART_SLICE_EXECUTION_STEPS') &&
    slicerServiceSource.includes('reportSmartSliceExecutionPlan') &&
    slicerServiceSource.includes('runSmartSliceExecutionStep') &&
    slicerServiceSource.includes('progressBefore') &&
    slicerServiceSource.includes('progressAfter') &&
    !slicerServiceSource.includes('progress: 35'),
  'slicerService.ts exposes a monotonic Smart Slice execution plan with console diagnostics instead of a sticky 35 percent stage',
);
assertRule(
  nativeMediaRuntimeSource.includes('complete_ops_slice_task') &&
    nativeMediaRuntimeSource.includes('"sliceResults"') &&
    nativeMediaRuntimeSource.includes('AUTOCUT_MEDIA_TASK_COVER_DIR') &&
    nativeMediaRuntimeSource.includes('autocut_task_cover_dir') &&
    nativeMediaRuntimeSource.includes('insert_media_slice_artifact') &&
    nativeMediaRuntimeSource.includes('insert_media_slice_thumbnail_artifact') &&
    nativeMediaRuntimeSource.includes('insert_media_slice_subtitle_artifact') &&
    nativeMediaRuntimeSource.includes('thumbnailArtifactPath') &&
    nativeMediaRuntimeSource.includes('subtitleArtifactPath'),
  'media_runtime.rs persists native video slice output_json and video, cover-directory thumbnail, and subtitle media_artifact rows',
);
for (const marker of [
  '"tool": "ffmpeg"',
  '"contractVersion"',
  '"bundledReady"',
  '"requiredBinary": "ffmpeg"',
  '"license"',
  '"integrity"',
  '"sha256"',
  '"byteSize"',
  '"windows-x86_64"',
  '"windows-x86_64/ffmpeg.exe"',
  '"linux-x86_64/ffmpeg"',
  '"macos-x86_64/ffmpeg"',
  '"macos-aarch64/ffmpeg"',
]) {
  assertRule(
    nativeFfmpegToolchainManifestSource.includes(marker),
    `FFmpeg toolchain manifest contains ${marker}`,
  );
}
assertRule(!nativeMediaRuntimeSource.includes('cmd /c'), 'media_runtime.rs does not execute through cmd /c');
assertRule(!nativeMediaRuntimeSource.includes('powershell'), 'media_runtime.rs does not execute through powershell');
assertRule(!nativeMediaRuntimeSource.includes('/bin/sh'), 'media_runtime.rs does not execute through a shell');
assertRule(
  nativeMediaRuntimeSource.includes('std::os::windows::process::CommandExt') &&
    nativeMediaRuntimeSource.includes('AUTOCUT_WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000') &&
    nativeMediaRuntimeSource.includes('fn new_autocut_hidden_child_command') &&
    nativeMediaRuntimeSource.includes('command.creation_flags(AUTOCUT_WINDOWS_CREATE_NO_WINDOW)'),
  'media_runtime.rs applies CREATE_NO_WINDOW to AutoCut child processes on Windows',
);
const nativeMediaRuntimeDirectCommandNewLines = nativeMediaRuntimeSource
  .split(/\r?\n/u)
  .map((line, index) => ({ index: index + 1, line: line.trim() }))
  .filter(({ line }) => line.includes('Command::new('))
  .filter(({ line }) => !line.includes('let mut command = Command::new(program);'));
assertRule(
  nativeMediaRuntimeDirectCommandNewLines.length === 0,
  `media_runtime.rs creates child processes only through the AutoCut hidden-window command helper${
    nativeMediaRuntimeDirectCommandNewLines.length > 0
      ? ` (${nativeMediaRuntimeDirectCommandNewLines
          .slice(0, 8)
          .map(({ index, line }) => `${index}: ${line}`)
          .join('; ')})`
      : ''
  }`,
);
for (const tableName of ['media_asset', 'media_artifact', 'ops_task', 'ops_task_event', 'ops_stage_run']) {
  assertRule(
    new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tableName}\\b`, 'iu').test(nativeSqliteBaselineSource),
    `SQLite baseline creates ${tableName}`,
  );
  assertRule(nativeSchemaRegistrySource.includes(`table_name: ${tableName}`), `schema registry declares ${tableName}`);
}
assertRule(
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?ops_worker_lease\b/iu.test(nativeSqliteBaselineSource),
  'SQLite baseline creates ops_worker_lease',
);
assertRule(nativeSchemaRegistrySource.includes('table_name: ops_worker_lease'), 'schema registry declares ops_worker_lease');
assertRule(
  /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?uk_ops_worker_lease_task_active\b/iu.test(nativeSqliteBaselineSource),
  'SQLite baseline enforces one active worker lease per task',
);
assertRule(
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?ops_schema_migration\b/iu.test(nativeSqliteBaselineSource),
  'SQLite baseline creates ops_schema_migration',
);
assertRule(nativeSchemaRegistrySource.includes('table_name: ops_schema_migration'), 'schema registry declares ops_schema_migration');

for (const relative of forbiddenRootRuntimeFiles) {
  assertRule(!exists(relative), `root ${relative} is not a committed AutoCut desktop source file`);
}
for (const relative of forbiddenRootRuntimeDirs) {
  assertRule(!exists(relative), `root ${relative}/ legacy runtime tree is not committed in the AutoCut desktop frontend app`);
}
for (const relative of forbiddenTauriGeneratedDirs) {
  assertRule(rootGitignore.includes(`${relative}/`), `${relative}/ generated Tauri schema output is ignored`);
}
assertRule(trackedTauriGeneratedFiles.length === 0, 'desktop package src-tauri/gen generated schema files are not tracked by git');
for (const legacyIgnoredPath of [
  'package-lock.json',
  '.dockerignore',
  'deploy/',
  'host/',
  'models/',
  'workspace/',
  'workspace-server-private-smoke/',
]) {
  assertRule(!rootGitignore.includes(legacyIgnoredPath), `.gitignore does not hide legacy source path ${legacyIgnoredPath}`);
}
assertRule(!rootGitignore.includes('DATABASE_SPEC.md'), '.gitignore does not hide canonical DATABASE_SPEC.md');
assertRule(tauriConfig.app?.security?.csp && tauriConfig.app.security.csp !== null, 'Tauri config defines a non-null content security policy');
assertRule(
  typeof tauriConfig.app?.security?.csp === 'string' && tauriConfig.app.security.csp.includes("default-src 'self'"),
  "Tauri CSP restricts default-src to 'self'",
);
assertRule(
  typeof tauriConfig.app?.security?.csp === 'string' && !tauriConfig.app.security.csp.includes('*'),
  'Tauri CSP does not use wildcard sources',
);
const tauriCsp = typeof tauriConfig.app?.security?.csp === 'string' ? tauriConfig.app.security.csp : '';
assertRule(!/(?:^|;)\s*img-src[^;]*\shttps:(?:\s|;)/u.test(tauriCsp), 'Tauri CSP img-src does not allow broad https sources');
assertRule(!/(?:^|;)\s*media-src[^;]*\shttps:(?:\s|;)/u.test(tauriCsp), 'Tauri CSP media-src does not allow broad https sources');
assertRule(!tauriCsp.includes('https://storage.googleapis.com'), 'Tauri CSP does not allow the removed BigBuckBunny storage fixture source');
assertRule(!tauriCsp.includes('https://commondatastorage.googleapis.com'), 'Tauri CSP does not allow the removed legacy BigBuckBunny fixture source');
for (const cspSource of forbiddenCspRemoteSources) {
  assertRule(!tauriCsp.includes(cspSource), `Tauri CSP does not allow third-party fixture source ${cspSource}`);
}
assertRule(tauriConfig.build?.devUrl === 'http://127.0.0.1:5173', 'Tauri devUrl uses loopback 127.0.0.1:5173');
assertRule(tauriConfig.bundle?.active === true, 'Tauri bundling is active');
assertRule(
  rootPackage.scripts?.['prepare:ffmpeg-sidecar'] === 'node scripts/prepare-autocut-ffmpeg-sidecar.mjs',
  'root package exposes the standardized FFmpeg sidecar preparation command',
);
assertRule(
  rootPackage.scripts?.['prepare:speech-sidecar'] === 'node scripts/prepare-autocut-speech-sidecar.mjs',
  'root package exposes the standardized Whisper CLI speech sidecar preparation command',
);
assertRule(
  rootPackage.scripts?.['prepare:release-sidecars'] === 'node scripts/prepare-autocut-release-sidecars.mjs',
  'root package exposes the standardized CI release sidecar preparation command',
);
assertRule(
  rootPackage.scripts?.['release:smoke-preflight'] === 'node scripts/check-autocut-release-smoke-preflight.mjs',
  'root package exposes the standardized AutoCut release smoke preflight command',
);
assertRule(
  rootPackage.scripts?.['release:native-smoke'] === 'node scripts/write-autocut-native-release-smoke.mjs',
  'root package exposes the standardized AutoCut native release smoke evidence command',
);
for (const marker of [
  'runRealLlmSecretSmoke',
  'SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE',
  'CARGO_TARGET_DIR',
  'createAutoCutNativeSmokeCargoTargetDir',
  'sdkwork-autocut-native-smoke-target-',
  'runAutoCutNativeReleaseSmokeCargoCommand',
  'isRustCompilerCrash',
  'STATUS_ACCESS_VIOLATION',
  'cargoTargetDirs',
  'videoSliceSmoke',
  'videoSliceSmokeReady',
  'autocut_slice_video',
  'autocut-video-slice-smoke=passed',
  '--run-real-llm-secret-smoke',
  'realLlmSecretStoreSmokeReady',
  'llmSecretStoreSmoke',
  'autocut-real-llm-secret-store-smoke=passed',
]) {
  assertRule(nativeReleaseSmokeCheckSource.includes(marker), `native release smoke writer contains ${marker}`);
}
assertRule(
  nativeReleaseSmokeCheckSource.includes('real_windows_keyring_store_saves_reads_and_deletes_llm_secret') &&
    nativeReleaseSmokeCheckSource.includes('--ignored') &&
    nativeReleaseSmokeCheckSource.includes('--test-threads=1'),
  'native release smoke writer runs the real Windows LLM secret store smoke as an ignored serialized Rust test',
);
assertRule(
  nativeReleaseSmokeCheckSource.includes('video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir') &&
    nativeReleaseSmokeCheckSource.includes('autocut-video-slice-smoke=passed') &&
    nativeMediaRuntimeSource.includes('println!("autocut-video-slice-smoke=passed")'),
  'native release smoke writer runs the exact native video slice artifact smoke and requires its success marker',
);
assertRule(
  releaseEvidenceSource.includes('nativeVideoSliceSmokeReady') &&
    releaseEvidenceSource.includes('videoSliceReady') &&
    releaseEvidenceSource.includes('autocut-video-slice-smoke=passed'),
  'release evidence aggregates native video slice smoke readiness instead of trusting only generic native smoke',
);
assertRule(
  commercialReleaseReadinessSource.includes('NATIVE_VIDEO_SLICE_SMOKE_NOT_READY') &&
    commercialReleaseReadinessSource.includes('nativeVideoSliceSmokeReady') &&
    commercialReleaseReadinessSource.includes('videoSliceReady'),
  'commercial release readiness blocks when native video slice smoke evidence is missing',
);
assertRule(
  commercialReleaseReadinessSource.includes('2026-05-06.autocut-commercial-release-readiness.v2') &&
    commercialReleaseReadinessSource.includes("mode: 'aggregate'") &&
    commercialReleaseReadinessSource.includes("mode: 'single'") &&
    commercialReleaseReadinessSource.includes('PLATFORM_RELEASE_EVIDENCE_MISSING') &&
    commercialReleaseReadinessSource.includes('PLATFORM_RELEASE_EVIDENCE_INVALID') &&
    commercialReleaseReadinessSource.includes('PLATFORM_RELEASE_EVIDENCE_MISMATCH') &&
    commercialReleaseReadinessSource.includes('autocut-release-evidence-${platform}.json') &&
    commercialReleaseReadinessSource.includes('normalizeAutoCutReleasePlatform') &&
    commercialReleaseReadinessSource.includes('--evidence-dir') &&
    commercialReleaseReadinessSource.includes('--platforms'),
  'commercial release readiness gate defaults to aggregate four-platform evidence while preserving explicit single-platform diagnostics',
);
assertRule(
  rootPackage.scripts?.['release:sign-installers'] === 'node scripts/sign-autocut-release-installers.mjs',
  'root package exposes the standardized AutoCut installer signing execution command',
);
for (const marker of [
  'SDKWORK_AUTOCUT_WINDOWS_SIGNING_PFX',
  'SDKWORK_AUTOCUT_WINDOWS_SIGNING_PASSWORD',
  'SDKWORK_AUTOCUT_WINDOWS_SIGNING_THUMBPRINT',
  'SDKWORK_AUTOCUT_WINDOWS_SIGNING_TIMESTAMP_URL',
  'SDKWORK_AUTOCUT_SIGNTOOL_PATH',
  'signtool.exe',
  'createAutoCutInstallerSigningPlan',
  'signAutoCutReleaseInstallers',
]) {
  assertRule(installerSigningSource.includes(marker), `installer signing execution script contains ${marker}`);
}
assertRule(
  rootPackage.scripts?.['release:installer-signature'] === 'node scripts/write-autocut-installer-signature-evidence.mjs',
  'root package exposes the standardized AutoCut installer signature evidence command',
);
assertRule(
  fs.readFileSync(path.join(rootDir, 'scripts/autocut-cli-args.mjs'), 'utf8').includes('normalizeAutoCutCliArgs') &&
    fs.readFileSync(path.join(rootDir, 'scripts/autocut-cli-args.mjs'), 'utf8').includes('readAutoCutCliOptionValue') &&
    fs.readFileSync(path.join(rootDir, 'scripts/autocut-cli-args.test.mjs'), 'utf8').includes("['--', '--platform'") &&
    fs.readFileSync(path.join(rootDir, 'scripts/autocut-cli-args.test.mjs'), 'utf8').includes("['--task']"),
  'release governance scripts share pnpm -- argument separator normalization and missing-value checks',
);
assertRule(
  rootPackage.scripts?.['release:smart-slice-quality'] === 'node scripts/write-autocut-smart-slice-quality-evidence.mjs',
  'root package exposes the standardized AutoCut smart slice quality evidence command',
);
assertRule(
  rootPackage.scripts?.['release:smart-slice-media-artifacts'] === 'node scripts/write-autocut-smart-slice-media-artifacts-evidence.mjs',
  'root package exposes the standardized AutoCut smart slice media artifacts evidence command',
);
assertRule(
  rootPackage.scripts?.['release:smart-slice-task'] === 'node scripts/check-autocut-smart-slice-task-evidence.mjs',
  'root package exposes the standardized AutoCut smart slice task evidence validation command',
);
assertRule(
  rootPackage.scripts?.['release:smart-slice-fixture'] === 'node scripts/check-autocut-smart-slice-release-fixture.mjs',
  'root package exposes the standardized AutoCut smart slice release fixture smoke command',
);
assertRule(
  rootPackage.scripts?.['release:smart-slice-sample'] === 'node scripts/write-autocut-smart-slice-sample-evidence.mjs',
  'root package exposes the standardized AutoCut smart slice sample evidence command',
);
for (const marker of [
  '2026-05-06.autocut-smart-slice-sample-evidence.v1',
  'source-smart-slice-sample.mp4',
  'autocut-smart-slice-sample-evidence.json',
  'autocut-smart-slice-quality-evidence.json',
  'autocut-smart-slice-media-artifacts-evidence.json',
  'writeAutoCutSmartSliceQualityEvidence',
  'writeAutoCutSmartSliceMediaArtifactsEvidence',
  'createAutoCutSmartSliceTaskEvidenceValidationReport',
  'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD',
  'sampleAudioCleanupEvidence',
  'audioCleanupProfile',
  'noiseReductionApplied',
  'boundaryDecisionSource',
  'leadingSilenceTrimMs',
  'trailingSilenceTrimMs',
  'tailTreatment',
  'sentenceBoundaryIntegrityGrade',
  'speechContinuityGrade',
]) {
  assertRule(smartSliceSampleEvidenceSource.includes(marker), `smart slice sample evidence writer contains ${marker}`);
}
for (const marker of [
  '2026-05-06.autocut-smart-slice-release-fixture.v1',
  'createAutoCutSmartSliceReleaseFixtureReport',
  'createSmartSliceTaskFixture',
  'writeAutoCutSmartSliceQualityEvidence',
  'writeAutoCutSmartSliceMediaArtifactsEvidence',
  'writeSmartSliceMediaFiles',
  'mediaArtifactsEvidence',
  'writeAutoCutReleaseEvidence',
  'createAutoCutCommercialReleaseReadinessReport',
  'blocked-transcript',
  'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD',
  'fixtureAudioCleanupEvidence',
  'audioCleanupProfile',
  'noiseReductionApplied',
  'boundaryDecisionSource',
  'leadingSilenceTrimMs',
  'trailingSilenceTrimMs',
  'tailTreatment',
  'SMART_SLICE_RELEASE_EVIDENCE_NOT_READY',
  'SMART_SLICE_COMMERCIAL_READINESS_NOT_READY',
]) {
  assertRule(smartSliceReleaseFixtureCheckSource.includes(marker), `smart slice release fixture check contains ${marker}`);
}
for (const marker of [
  '2026-05-06.autocut-smart-slice-task-evidence-validation.v1',
  '2026-05-06.autocut-smart-slice-task-evidence.v1',
  'SMART_SLICE_TASK_NOT_COMPLETED',
  'SMART_SLICE_TASK_TRANSCRIPT_MISSING',
  'SMART_SLICE_TASK_CONTINUITY_INCOMPLETE',
  'SMART_SLICE_TASK_SOURCE_RANGE_INVALID',
  'SMART_SLICE_TASK_RENDER_ARTIFACT_MISSING',
  'SMART_SLICE_TASK_RENDER_DURATION_MISMATCH',
  'minimumContinuityScore',
  'minimumTranscriptCoverageScore',
  'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD',
  'formatAutoCutSmartSliceTaskEvidenceValidationMessage',
]) {
  assertRule(smartSliceTaskEvidenceCheckSource.includes(marker), `smart slice task evidence validation check contains ${marker}`);
}
for (const marker of [
  '2026-05-16.autocut-smart-slice-execution-evidence-validation.v1',
  'smart-slice.speech-to-text.v1',
  'smart-slice.semantic-segmentation.v1',
  'smart-slice.review-session.v1',
  'smart-slice.manual-edits.v1',
  'smart-slice.review-events.v1',
  'smart-slice.render-selection.v1',
  'smart-slice.render-artifact-manifest.v1',
  'SMART_SLICE_STT_EVIDENCE_MISSING',
  'SMART_SLICE_SEMANTIC_EVIDENCE_MISSING',
  'SMART_SLICE_STT_TIMELINE_OVERLAP',
  'SMART_SLICE_SEMANTIC_CLIP_SPEAKER_UNKNOWN',
  'llmReviewAuditReady',
  'speech-to-text.json',
  'semantic-segmentation.json',
  'review-session.json',
  'manual-edits.json',
  'review-events.json',
  'render-selection.json',
  'render-artifact-manifest.json',
]) {
  assertRule(smartSliceExecutionEvidenceCheckSource.includes(marker), `smart slice execution evidence validation check contains ${marker}`);
}
for (const marker of [
  '2026-05-06.autocut-smart-slice-quality-evidence.v1',
  '2026-05-06.autocut-smart-slice-task-evidence.v1',
  'QUALITY_THRESHOLDS',
  'minAveragePublishabilityScore',
  'minAverageContinuityScore',
  'minAverageTranscriptCoverageScore',
  'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD',
  'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
  'platformReadyOrReviewRatio',
  'validateSmartSliceTaskEvidence',
  'evidenceKind',
  'smart-slice-task',
  "task.status !== 'completed'",
]) {
  assertRule(smartSliceQualityEvidenceSource.includes(marker), `smart slice quality evidence writer contains ${marker}`);
}
for (const marker of [
  '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1',
  '2026-05-06.autocut-smart-slice-task-evidence.v1',
  'SMART_SLICE_MEDIA_ARTIFACT_MISSING',
  'SMART_SLICE_MEDIA_ARTIFACT_PATH_ESCAPE',
  'smartSliceMediaArtifactsReady',
  'createAutoCutSmartSliceMediaArtifactsEvidence',
  'writeAutoCutSmartSliceMediaArtifactsEvidence',
  'sha256',
  'asset://',
]) {
  assertRule(smartSliceMediaArtifactsEvidenceSource.includes(marker), `smart slice media artifacts evidence writer contains ${marker}`);
}
assertRule(
  releaseEvidenceSource.includes('readSmartSliceQualityEvidence') &&
    releaseEvidenceSource.includes('smartSliceQualityReady') &&
    releaseEvidenceSource.includes('smartSliceQuality') &&
    releaseEvidenceSource.includes('readSmartSliceMediaArtifactsEvidence') &&
    releaseEvidenceSource.includes('smartSliceMediaArtifactsReady') &&
    releaseEvidenceSource.includes('smartSliceMediaArtifacts'),
  'release evidence writer aggregates smart slice quality and media artifact evidence',
);
assertRule(
  commercialReleaseReadinessSource.includes('SMART_SLICE_QUALITY_NOT_READY') &&
    commercialReleaseReadinessSource.includes('SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY') &&
    commercialReleaseReadinessSource.includes('INSTALLER_ARTIFACTS_NOT_READY') &&
    commercialReleaseReadinessSource.includes('smartSliceQualityReady') &&
    commercialReleaseReadinessSource.includes('smartSliceMediaArtifactsReady') &&
    commercialReleaseReadinessSource.includes('installerArtifactsReady') &&
    commercialReleaseReadinessSource.includes('expectedInstallerKindsByPlatform') &&
    commercialReleaseReadinessSource.includes('release:smart-slice-quality') &&
    commercialReleaseReadinessSource.includes('release:smart-slice-media-artifacts'),
  'commercial release readiness gate blocks releases without smart slice quality, media artifact, or installer artifact evidence',
);
assertRule(
  rootPackage.scripts?.['release:evidence'] === 'node scripts/write-autocut-release-evidence.mjs',
  'root package exposes the standardized AutoCut release evidence writer command',
);
assertRule(
  rootPackage.scripts?.['release:package-sbom'] === 'node scripts/write-autocut-package-sbom-files.mjs',
  'root package exposes the standardized AutoCut per-package SBOM file writer command',
);
assertRule(
  packageSbomSource.includes('CycloneDX') &&
    packageSbomSource.includes('specVersion: \'1.6\'') &&
    packageSbomSource.includes('pnpm-lock.yaml') &&
    packageSbomSource.includes('parsePnpmSnapshotDependencies') &&
    packageSbomSource.includes('expandNpmRuntimeDependencyClosure') &&
    packageSbomSource.includes('ambiguous AutoCut npm runtime dependency version') &&
    packageSbomSource.includes('Cargo.lock') &&
    packageSbomSource.includes('Cargo.toml') &&
    packageSbomSource.includes('target.\'cfg(windows)\'.dependencies') &&
    packageSbomSource.includes("cargoPackages.find((entry) => entry.name === 'sdkwork-video-cut-desktop')") &&
    packageSbomSource.includes('rootPackage.dependencies.filter') &&
    packageSbomSource.includes('expandCargoDependencyClosure') &&
    packageSbomSource.includes('parseCargoDependencyReference') &&
    packageSbomSource.includes('ambiguous AutoCut Cargo dependency reference') &&
    packageSbomSource.includes('matchTomlStringArray') &&
    packageSbomSource.includes('assertAllNpmRuntimeDependenciesResolved') &&
    packageSbomSource.includes('unresolved AutoCut npm runtime dependency versions') &&
    packageSbomSource.includes('--platform') &&
    packageSbomSource.includes('--package-id') &&
    packageSbomSource.includes('desktop-windows-msi') &&
    packageSbomSource.includes('desktop-linux-appimage') &&
    packageSbomSource.includes('desktop-macos-aarch64-dmg'),
  'per-package SBOM writer creates deterministic CycloneDX SBOMs from locked recursive npm and Cargo runtime dependency metadata without unresolved versions',
);
assertRule(
  rootPackage.scripts?.['release:sbom-evidence'] === 'node scripts/write-autocut-sbom-evidence.mjs',
  'root package exposes the standardized AutoCut SBOM evidence writer command',
);
assertRule(
  sbomEvidenceSource.includes('2026-05-08.autocut-sbom-evidence.v1') &&
    sbomEvidenceSource.includes('artifacts/release/sbom') &&
    sbomEvidenceSource.includes('desktop-windows-msi') &&
    sbomEvidenceSource.includes('desktop-windows-nsis') &&
    sbomEvidenceSource.includes('desktop-linux-deb') &&
    sbomEvidenceSource.includes('desktop-linux-appimage') &&
    sbomEvidenceSource.includes('desktop-macos-x64-dmg') &&
    sbomEvidenceSource.includes('desktop-macos-aarch64-dmg') &&
    sbomEvidenceSource.includes('crypto.createHash(\'sha256\')') &&
    sbomEvidenceSource.includes('PACKAGE_SBOM_MISSING') &&
    sbomEvidenceSource.includes('PACKAGE_SBOM_FILE_EMPTY') &&
    sbomEvidenceSource.includes('PACKAGE_SBOM_JSON_INVALID') &&
    sbomEvidenceSource.includes('PACKAGE_SBOM_FORMAT_UNSUPPORTED') &&
    sbomEvidenceSource.includes('PACKAGE_SBOM_UNKNOWN_PACKAGE_ID') &&
    sbomEvidenceSource.includes('PACKAGE_SBOM_MULTIPLE_CANDIDATES') &&
    sbomEvidenceSource.includes('--allow-blocked') &&
    sbomEvidenceSource.includes('--release-tag'),
  'SBOM evidence writer hashes real per-package CycloneDX/SPDX SBOM files and fails closed for missing, invalid, unknown, or duplicate SBOM inputs',
);
assertRule(
  rootPackage.scripts?.['release:evidence-status'] === 'node scripts/check-autocut-release-evidence-status.mjs',
  'root package exposes the standardized AutoCut aggregate release evidence status command',
);
assertRule(
  releaseEvidenceStatusSource.includes('2026-05-08.autocut-release-evidence-status.v1') &&
    releaseEvidenceStatusSource.includes('createAutoCutReleaseEnvironmentReport') &&
    releaseEvidenceStatusSource.includes('createAutoCutMultiplatformReleaseReadinessReport') &&
    releaseEvidenceStatusSource.includes('syncAutoCutAppManifestReleaseEvidence') &&
    releaseEvidenceStatusSource.includes('createAutoCutAppManifestReleaseReadinessReport') &&
    releaseEvidenceStatusSource.includes('createAutoCutCommercialReleaseReadinessReport') &&
    releaseEvidenceStatusSource.includes('release-environment') &&
    releaseEvidenceStatusSource.includes('platform-release-evidence') &&
    releaseEvidenceStatusSource.includes('sbom-evidence') &&
    releaseEvidenceStatusSource.includes('app-manifest-sync') &&
    releaseEvidenceStatusSource.includes('app-manifest-readiness') &&
    releaseEvidenceStatusSource.includes('multiplatform-preview-readiness') &&
    releaseEvidenceStatusSource.includes('commercial-release-readiness') &&
    releaseEvidenceStatusSource.includes('--allow-blocked') &&
    releaseEvidenceStatusSource.includes('--json') &&
    releaseEvidenceStatusSource.includes('nextActions'),
  'release evidence status command aggregates environment, platform evidence, SBOM, app manifest, preview, and commercial readiness blockers without generating synthetic evidence',
);
assertRule(
  rootPackage.scripts?.['release:sync-app-manifest'] === 'node scripts/sync-autocut-app-manifest-release-evidence.mjs',
  'root package exposes the standardized AutoCut release evidence to app manifest sync command',
);
assertRule(
  appManifestReleaseEvidenceSyncSource.includes('2026-05-08.autocut-app-manifest-release-evidence-sync.v1') &&
    appManifestReleaseEvidenceSyncSource.includes('autocut-sbom-evidence.json') &&
    appManifestReleaseEvidenceSyncSource.includes('autocut-release-evidence-${platform}.json') &&
    appManifestReleaseEvidenceSyncSource.includes('PACKAGE_SBOM_EVIDENCE_MISSING') &&
    appManifestReleaseEvidenceSyncSource.includes('PACKAGE_TRUST_EVIDENCE_NOT_READY') &&
    appManifestReleaseEvidenceSyncSource.includes('PLATFORM_INSTALLER_SIGNATURE_EVIDENCE_NOT_READY') &&
    appManifestReleaseEvidenceSyncSource.includes('SBOM_EVIDENCE_MISSING') &&
    appManifestReleaseEvidenceSyncSource.includes('SBOM_EVIDENCE_NOT_READY') &&
    appManifestReleaseEvidenceSyncSource.includes('sourceCode') &&
    appManifestReleaseEvidenceSyncSource.includes('evidence.readiness?.sbomReady !== true') &&
    appManifestReleaseEvidenceSyncSource.includes('--activate-commercial') &&
    appManifestReleaseEvidenceSyncSource.includes('--dry-run') &&
    appManifestReleaseEvidenceSyncSource.includes('--allow-blocked') &&
    appManifestReleaseEvidenceSyncSource.includes('checksumAlgorithm = \'SHA-256\'') &&
    appManifestReleaseEvidenceSyncSource.includes('delete appPackage.metadata.commercialActivationRequired'),
  'app manifest release evidence sync reads real release, trust, and SBOM evidence before enabling commercial packages',
);
assertRule(
  rootPackage.scripts?.['release:app-manifest-ready'] === 'node scripts/check-autocut-app-manifest-release-readiness.mjs',
  'root package exposes the standardized AutoCut app manifest release readiness gate command',
);
assertRule(
  appManifestReleaseReadinessSource.includes('2026-05-08.autocut-app-manifest-release-readiness.v1') &&
    appManifestReleaseReadinessSource.includes("mode === 'inactive-preview'") &&
    appManifestReleaseReadinessSource.includes("mode === 'active-commercial'") &&
    appManifestReleaseReadinessSource.includes('DISABLED_PACKAGE_COMMERCIAL_ACTIVATION_MISSING') &&
    appManifestReleaseReadinessSource.includes('ACTIVE_MANIFEST_HAS_NO_ENABLED_PACKAGES') &&
    appManifestReleaseReadinessSource.includes('ENABLED_PACKAGE_CHECKSUM_INVALID') &&
    appManifestReleaseReadinessSource.includes('ENABLED_PACKAGE_TRUST_EVIDENCE_INVALID') &&
    appManifestReleaseReadinessSource.includes('ENABLED_PACKAGE_SBOM_INVALID') &&
    appManifestReleaseReadinessSource.includes('ENABLED_PACKAGE_CHECKSUM_PLACEHOLDER'),
  'app manifest release readiness gate separates inactive preview packages from active commercial packages with checksum, trust, and SBOM evidence blockers',
);
assertRule(
  rootPackage.scripts?.['release:preview-ready'] === 'node scripts/check-autocut-preview-release-readiness.mjs',
  'root package exposes the standardized AutoCut unsigned preview release readiness gate command',
);
assertRule(
  previewReleaseReadinessSource.includes('UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW') &&
    previewReleaseReadinessSource.includes('installerArtifactsReady') &&
    previewReleaseReadinessSource.includes('ffmpegExecutionPreviewReady') &&
    previewReleaseReadinessSource.includes('INSTALLER_ARTIFACTS_NOT_READY') &&
    previewReleaseReadinessSource.includes('release:commercial-ready'),
  'preview release readiness gate allows unsigned installers only with explicit warning and keeps all runtime evidence gates',
);
assertRule(
  rootPackage.scripts?.['release:multiplatform-ready'] === 'node scripts/check-autocut-multiplatform-release-readiness.mjs',
  'root package exposes the standardized AutoCut multiplatform preview release readiness gate command',
);
assertRule(
  releasePlatformsSource.includes('windows-x86_64') &&
    releasePlatformsSource.includes('linux-x86_64') &&
    releasePlatformsSource.includes('macos-x86_64') &&
    releasePlatformsSource.includes('macos-aarch64') &&
    releasePlatformsSource.includes('autoCutReleasePlatformAliases') &&
    releasePlatformsSource.includes('windows-x64') &&
    releasePlatformsSource.includes('ubuntu-x64') &&
    releasePlatformsSource.includes('darwin-arm64') &&
    releasePlatformsSource.includes('is ambiguous; use macos-x86_64 or macos-aarch64') &&
    releasePlatformsSource.includes('x86_64-unknown-linux-gnu') &&
    releasePlatformsSource.includes('x86_64-apple-darwin') &&
    releasePlatformsSource.includes('aarch64-apple-darwin') &&
    releasePlatformsSource.includes('deb') &&
    releasePlatformsSource.includes('appimage') &&
    releasePlatformsSource.includes('dmg') &&
    releasePlatformsSource.includes('macos-x64-app') &&
    releasePlatformsSource.includes('macos-aarch64-app'),
  'release platform registry maps all desktop release platforms and common Windows/Linux/macOS aliases to their native Tauri installer artifact policy with architecture-specific macOS app archives',
);
assertRule(
  releaseEvidenceSource.includes('createAutoCutReleaseInstallerSpecs') &&
    releaseEvidenceSource.includes('normalizeAutoCutReleasePlatform') &&
    releaseEvidenceSource.includes('readReleaseInstallers(resolvedRootDir, normalizedPlatform)') &&
    releaseEvidenceSource.includes('speechBundledReady') &&
    releaseEvidenceSource.includes('preflight.speechSidecar') &&
    releaseEvidenceSource.includes('platformBundledReady') &&
    releaseEvidenceSource.includes('manifestBundledReady'),
  'release evidence writer discovers installers through the canonical multiplatform release platform registry and records verified local Whisper sidecar readiness',
);
assertRule(
  multiplatformReleaseReadinessSource.includes('windows-x86_64') &&
    multiplatformReleaseReadinessSource.includes('linux-x86_64') &&
    multiplatformReleaseReadinessSource.includes('macos-x86_64') &&
    multiplatformReleaseReadinessSource.includes('macos-aarch64') &&
    multiplatformReleaseReadinessSource.includes('normalizeAutoCutReleasePlatform') &&
    multiplatformReleaseReadinessSource.includes('UNSIGNED_MACOS_INSTALLERS_ACCEPTED_FOR_PREVIEW') &&
    multiplatformReleaseReadinessSource.includes('INSTALLER_ARTIFACTS_NOT_READY') &&
    multiplatformReleaseReadinessSource.includes('SPEECH_SIDECAR_NOT_BUNDLED') &&
    multiplatformReleaseReadinessSource.includes('speechBundledReady'),
  'multiplatform preview readiness gate requires all four platform evidence files, platform installer kinds, and verified local Whisper sidecars',
);
assertRule(
  previewReleaseReadinessSource.includes('SPEECH_SIDECAR_NOT_BUNDLED') &&
    previewReleaseReadinessSource.includes('speechBundledReady') &&
    commercialReleaseReadinessSource.includes('SPEECH_SIDECAR_NOT_BUNDLED') &&
    commercialReleaseReadinessSource.includes('release:smoke-preflight --require-bundled') &&
    commercialReleaseReadinessSource.includes('Run prepare:speech-sidecar'),
  'preview and commercial release readiness gates fail closed when the approved local Whisper sidecar is missing or unverifiable',
);
assertRule(
  desktopReleaseWorkflowSource.includes('name: AutoCut Desktop Multiplatform Release') &&
    desktopReleaseWorkflowSource.includes('build-windows') &&
    desktopReleaseWorkflowSource.includes('build-linux') &&
    desktopReleaseWorkflowSource.includes('build-macos') &&
    desktopReleaseWorkflowSource.includes('windows-latest') &&
    desktopReleaseWorkflowSource.includes('ubuntu-22.04') &&
    desktopReleaseWorkflowSource.includes('macos-latest') &&
    desktopReleaseWorkflowSource.includes('pnpm tauri:build --target x86_64-unknown-linux-gnu') &&
    desktopReleaseWorkflowSource.includes('pnpm tauri:build --target ${{ matrix.rust_target }}') &&
    !desktopReleaseWorkflowSource.includes('pnpm tauri:build -- --target') &&
    !desktopReleaseWorkflowSource.includes('tauri-apps/tauri-action') &&
    desktopReleaseWorkflowSource.includes('pnpm release:package-sbom -- --platform windows-x86_64') &&
    desktopReleaseWorkflowSource.includes('pnpm release:package-sbom -- --platform linux-x86_64') &&
    desktopReleaseWorkflowSource.includes('pnpm release:package-sbom -- --platform ${{ matrix.platform }}') &&
    desktopReleaseWorkflowSource.includes('artifacts/release/sbom') &&
    desktopReleaseWorkflowSource.includes('pnpm release:sbom-evidence -- --release-tag "${{ inputs.release_tag }}" --allow-blocked') &&
    desktopReleaseWorkflowSource.includes('pnpm release:sync-app-manifest -- --dry-run --allow-blocked') &&
    desktopReleaseWorkflowSource.includes('pnpm release:app-manifest-ready') &&
    desktopReleaseWorkflowSource.includes('pnpm release:multiplatform-ready') &&
    desktopReleaseWorkflowSource.includes('pnpm release:evidence-status -- --release-tag "${{ inputs.release_tag }}" --allow-dirty --skip-windows-installer-service --allow-blocked') &&
    desktopReleaseWorkflowSource.includes('release:installer-signature -- --platform ${{ matrix.platform }}') &&
    desktopReleaseWorkflowSource.includes('autocut-sbom-evidence.json') &&
    desktopReleaseWorkflowSource.includes('autocut-app-manifest-release-evidence-sync.txt') &&
    desktopReleaseWorkflowSource.includes('autocut-app-manifest-release-readiness.txt') &&
    desktopReleaseWorkflowSource.includes('autocut-release-evidence-status.json') &&
    desktopReleaseWorkflowSource.includes('releaseVersion="${{ inputs.release_tag }}"') &&
    desktopReleaseWorkflowSource.includes('releaseVersion="${releaseVersion#v}"') &&
    desktopReleaseWorkflowSource.includes('SDKWork Video Cut_${releaseVersion}_${{ matrix.app_arch }}.app.tar.gz') &&
    (desktopReleaseWorkflowSource.match(/ref: \$\{\{ inputs\.release_tag \}\}/gu) ?? []).length === 4 &&
    desktopReleaseWorkflowSource.includes('artifacts/release/autocut-release-evidence-${{ matrix.platform }}.json'),
  'GitHub workflow builds native Windows, Linux, Intel macOS, and Apple Silicon macOS desktop release artifacts with app manifest and aggregate readiness evidence without clobbering macOS app archives',
);
assertRule(
  rootPackage.scripts?.['release:commercial-ready'] === 'node scripts/check-autocut-commercial-release-readiness.mjs',
  'root package exposes the standardized AutoCut commercial release readiness gate command',
);
assertRule(
    rootPackage.scripts?.test?.includes('scripts/prepare-autocut-ffmpeg-sidecar.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/prepare-autocut-speech-sidecar.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/prepare-autocut-speech-gpu-runtime.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/prepare-autocut-release-sidecars.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/autocut-cli-args.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-release-smoke-preflight.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-native-release-smoke.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/sign-autocut-release-installers.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-installer-signature-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-smart-slice-sample-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-smart-slice-task-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-smart-slice-execution-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-smart-slice-quality-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-smart-slice-media-artifacts-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-smart-slice-release-fixture.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-release-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-package-sbom-files.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/write-autocut-sbom-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/sync-autocut-app-manifest-release-evidence.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-app-manifest-release-readiness.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-preview-release-readiness.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-multiplatform-release-readiness.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-release-workflow.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-release-evidence-status.test.mjs') &&
    rootPackage.scripts?.test?.includes('scripts/check-autocut-commercial-release-readiness.test.mjs'),
  'root package test script covers FFmpeg sidecar preparation, Whisper CLI speech sidecar preparation, GPU speech runtime preparation, CI release sidecar preparation, release smoke preflight, native release smoke, installer signing, installer signature, smart slice sample, smart slice task validation, smart slice quality, smart slice media artifacts, smart slice fixture, release evidence, package SBOM file generation, SBOM evidence, app manifest sync/readiness, preview readiness, multiplatform readiness, release workflow, aggregate evidence status, and commercial readiness contracts',
);
assertRule(
  tauriConfig.bundle?.resources?.['binaries/ffmpeg.toolchain.json'] === 'binaries/ffmpeg.toolchain.json',
  'Tauri bundle includes the package-local FFmpeg toolchain manifest as a runtime resource',
);
assertRule(
  tauriConfig.bundle?.resources?.['binaries/windows-x86_64'] === 'binaries/windows-x86_64',
  'Tauri bundle includes the Windows FFmpeg sidecar directory as a runtime resource boundary',
);
assertRule(
  tauriConfig.bundle?.resources?.['binaries/linux-x86_64'] === 'binaries/linux-x86_64',
  'Tauri bundle includes the Linux FFmpeg sidecar directory as a runtime resource boundary',
);
assertRule(
  tauriConfig.bundle?.resources?.['binaries/macos-x86_64'] === 'binaries/macos-x86_64',
  'Tauri bundle includes the Intel macOS FFmpeg sidecar directory as a runtime resource boundary',
);
assertRule(
  tauriConfig.bundle?.resources?.['binaries/macos-aarch64'] === 'binaries/macos-aarch64',
  'Tauri bundle includes the Apple Silicon macOS FFmpeg sidecar directory as a runtime resource boundary',
);
for (const scriptFile of listFiles(path.join(rootDir, 'scripts'), (file) => /\.(mjs|cjs|js|ts)$/.test(file))) {
  const relative = path.relative(rootDir, scriptFile).replaceAll(path.sep, '/');
  const content = fs.readFileSync(scriptFile, 'utf8');
  assertRule(allowedScriptFiles.has(relative), `${relative} is an allowed AutoCut desktop governance script`);
  if (relative !== 'scripts/check-autocut-architecture.mjs') {
    assertRule(!content.includes('args[index + 1]'), `${relative} uses the shared AutoCut CLI option value validator`);
  }
}
if (exists('docs')) {
  for (const docFile of listFiles(path.join(rootDir, 'docs'), (file) => /\.(md|yaml|yml|json)$/.test(file))) {
    const relative = path.relative(rootDir, docFile).replaceAll(path.sep, '/');
    assertRule(allowedDocs.has(relative), `${relative} is an allowed current AutoCut desktop document`);
  }
}

const databaseDefinitionFiles = listFiles(rootDir, (file) => {
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  if (!/\.(sql|ya?ml|json)$/u.test(relative)) {
    return false;
  }
  return !(
    relative.startsWith('node_modules/') ||
    relative.startsWith('dist/') ||
    relative.startsWith('packages/sdkwork-autocut-desktop/dist/') ||
    relative.startsWith('artifacts/') ||
    relative.startsWith('packages/sdkwork-autocut-desktop/src-tauri/target/')
  );
});
for (const file of databaseDefinitionFiles) {
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  const content = fs.readFileSync(file, 'utf8');
  if (relative.endsWith('.sql')) {
    for (const table of extractSqlCreateTables(content)) {
      assertStandardDatabaseTableName(table.name, relative);
      assertSqlTableHasIdentityColumns(table, relative);
    }
  } else if (/\.(ya?ml)$/u.test(relative)) {
    for (const table of extractYamlTableContracts(content)) {
      assertStandardDatabaseTableName(table.name, relative);
      assertYamlTableHasIdentityColumns(table, relative);
    }
  } else if (relative.endsWith('.json')) {
    for (const table of extractJsonTableContracts(content)) {
      assertStandardDatabaseTableName(table.name, relative);
      assertJsonTableHasIdentityColumns(table, relative);
    }
  }
}

const rootTextFiles = [
  ...desktopSrcFiles,
  path.join(desktopPackageDir, 'vite.config.ts'),
  path.join(rootDir, '.env.example'),
  path.join(rootDir, 'README.md'),
].filter((file) => fs.existsSync(file));
for (const file of rootTextFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  if (/\.(ts|tsx|mjs)$/.test(relative)) {
    assertNoForbiddenSourcePatterns(relative, content);
  }
  assertRule(!content.includes('GEMINI_API_KEY'), `${relative} does not expose AI Studio GEMINI_API_KEY wiring`);
  assertRule(!content.includes('@google/genai'), `${relative} does not import Google GenAI directly`);
  assertRule(!content.includes('AI Studio'), `${relative} does not contain AI Studio scaffolding copy`);
}
for (const file of listFiles(rootDir, isSecretGovernanceTextFile, shouldSkipSecretGovernanceDirectory)) {
  const content = fs.readFileSync(file, 'utf8');
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  assertRule(
    !forbiddenHighEntropyApiKeyPattern.test(content),
    `${relative} does not commit high-entropy OpenAI-compatible API keys`,
  );
}
for (const rootEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
  if (rootEntry.isDirectory() && ignoredRootDirectoryEntries.has(rootEntry.name)) {
    continue;
  }
  assertRule(allowedRootEntries.has(rootEntry.name), `root entry ${rootEntry.name} is allowed by the AutoCut desktop app standard`);
  if (rootEntry.isFile()) {
    assertRule(!rootEntry.name.endsWith('.log'), `root generated log ${rootEntry.name} is not present`);
    assertRule(!rootEntry.name.endsWith('.tsbuildinfo'), `root generated TypeScript build info ${rootEntry.name} is not present`);
  }
}
for (const file of desktopCssFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  assertRule(relative === 'packages/sdkwork-autocut-desktop/src/index.css', `desktop stylesheet ${relative} is the allowed global style entry`);
  assertRule(content.includes('@source "../../sdkwork-autocut-*/src/**/*.{ts,tsx}"'), `${relative} scans AutoCut workspace package sources for Tailwind utilities`);
  assertRule(!content.includes('@import url('), `${relative} does not import remote CSS URLs`);
  assertRule(!content.includes('fonts.googleapis.com'), `${relative} does not depend on Google Fonts CSS`);
  assertRule(!content.includes('fonts.gstatic.com'), `${relative} does not depend on remote Google font assets`);
}
assertRule(appSource.includes('const AUTOCUT_ROUTES'), 'root App.tsx declares a canonical AUTOCUT_ROUTES table');
const desktopRoutePaths = new Set([...appSource.matchAll(/path:\s*'([^']+)'/gu)].map((match) => match[1]));
const registeredToolRoutes = [...toolsRegistrySource.matchAll(/route:\s*'([^']+)'/gu)].map((match) => match[1]);
for (const routePath of requiredRoutePaths) {
  assertRule(appSource.includes(`path: '${routePath}'`), `root route table includes ${routePath}`);
}
for (const routePath of registeredToolRoutes) {
  assertRule(desktopRoutePaths.has(routePath), `tool registry route ${routePath} is mounted by the desktop app route table`);
}
for (const packageName of requiredLazyPackages) {
  assertRule(appSource.includes(`import('${packageName}')`), `root route table lazy-loads ${packageName}`);
}
assertRule(appSource.includes('AUTOCUT_ROUTES.map'), 'root App.tsx renders routes from AUTOCUT_ROUTES');
const requiredTaskTypes = [
  'video-slice',
  'text-extraction',
  'audio-extraction',
  'video-gif',
  'video-compress',
  'video-convert',
  'video-enhance',
  'video-dedup',
  'subtitle-translate',
  'voice-translate',
];
assertRule(autocutTypesSource.includes('AUTOCUT_TASK_TYPES'), '@sdkwork/autocut-types exports canonical AUTOCUT_TASK_TYPES');
assertRule(autocutTypesSource.includes('AUTOCUT_TASK_TYPE'), '@sdkwork/autocut-types exports canonical AUTOCUT_TASK_TYPE enum codes');
assertRule(autocutTypesSource.includes('export type TaskType = typeof AUTOCUT_TASK_TYPES[number]'), 'TaskType is derived from AUTOCUT_TASK_TYPES');
assertRule(autocutTypesSource.includes('AUTOCUT_TASK_STATUS'), '@sdkwork/autocut-types exports canonical AUTOCUT_TASK_STATUS');
assertRule(autocutTypesSource.includes('export type TaskStatus = typeof AUTOCUT_TASK_STATUS[keyof typeof AUTOCUT_TASK_STATUS]'), 'TaskStatus is derived from AUTOCUT_TASK_STATUS');
assertRule(autocutTypesSource.includes('sourceTaskId?: string'), 'AppAsset records sourceTaskId for generated asset traceability');
assertRule(autocutTypesSource.includes('sourceTaskType?: TaskType'), 'AppAsset records sourceTaskType for generated asset traceability');
assertRule(autocutTypesSource.includes('sourceFileId?: string'), 'AppTask records sourceFileId for selected source asset traceability');
assertRule(autocutTypesSource.includes('generatedAssetIds?: string[]'), 'AppTask records generatedAssetIds for task result traceability');
assertRule(
  autocutTypesSource.includes('export interface AutoCutTranscriptCorrectionAudit') &&
    autocutTypesSource.includes("source: 'task-detail'") &&
    autocutTypesSource.includes('transcriptCorrection?: AutoCutTranscriptCorrectionAudit'),
  'TaskSliceResult records structured manual transcript correction audit metadata',
);
assertRule(
  autocutTypesSource.includes('AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG') &&
    autocutTypesSource.includes('audio-transcript-boundary-conflict') &&
    autocutTypesSource.includes('labelKey: string') &&
    autocutTypesSource.includes('remediationKey: string'),
  '@sdkwork/autocut-types owns the canonical smart-slice review risk catalog with UI and evidence metadata',
);
assertRule(tasksPageSource.includes('Record<TaskType, React.ReactNode>'), 'TasksPage icon map is typed against every TaskType');
assertRule(taskDetailPageSource.includes('Record<TaskType, string>'), 'TaskDetailPage reprocess route map is typed against every TaskType');
assertRule(serviceIndexSource.includes("export * from './service/i18n.service';"), '@sdkwork/autocut-services exports the standard i18n service');
assertRule(i18nServiceSource.includes("from 'i18next'"), 'AutoCut i18n service is backed by the i18next open-source framework');
assertRule(i18nServiceSource.includes('createInstance'), 'AutoCut i18n service creates a dedicated i18next instance');
assertRule(i18nServiceSource.includes('initAsync: false'), 'AutoCut i18n resources initialize synchronously for service/runtime use');
assertRule(i18nServiceSource.includes('AUTOCUT_I18N_RESOURCES'), 'AutoCut localized display text lives in i18next resources');
assertRule(appSource.includes("from 'react-i18next'") && appSource.includes('I18nextProvider'), 'Desktop App wires React through react-i18next I18nextProvider');
assertRule(tasksPageSource.includes("from 'react-i18next'") && tasksPageSource.includes('useTranslation'), 'TasksPage resolves display labels through react-i18next');
assertRule(taskDetailPageSource.includes("from 'react-i18next'") && taskDetailPageSource.includes('useTranslation'), 'TaskDetailPage resolves display labels through react-i18next');
assertRule(
  !/type:\s*['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/u.test(realProcessingServiceSources),
  'processing services never persist localized Chinese task.type values',
);
assertRule(
  nativeMediaRuntimeSource.includes('fn create_autocut_task_input_json') &&
    nativeMediaRuntimeSource.includes('"sourceName".to_string()') &&
    nativeMediaRuntimeSource.includes('json!(asset.name.clone())'),
  'media_runtime.rs centralizes native ops_task input_json creation with the original source file name',
);
assertRule(
  !/let mut input_json = json!\(\{\s*"assetUuid": asset\.uuid/u.test(nativeMediaRuntimeSource),
  'native media operations do not build ops_task input_json without the original source file name',
);
assertRule(
  taskDetailPageSource.includes('function TaskVideoPreview') &&
    taskDetailPageSource.includes('task-detail-video-preview-shell') &&
    taskDetailPageSource.includes('task-detail-video-preview-media') &&
    taskDetailPageSource.includes('object-contain') &&
    taskDetailPageSource.includes('playsInline') &&
    taskDetailPageSource.includes('max-h-[62vh]') &&
    taskDetailPageSource.includes('max-h-[34%]'),
  'TaskDetailPage uses a standardized bounded object-contain preview shell so each task video remains fully visible',
);
assertRule(
  taskDetailPageSource.includes('task-detail-slice-thumbnail-media') &&
    taskDetailPageSource.includes('loading="lazy"') &&
    taskDetailPageSource.includes('decoding="async"') &&
    !taskDetailPageSource.includes('object-cover'),
  'TaskDetailPage slice thumbnails follow the complete-frame preview rule and never crop generated videos',
);
assertRule(
  taskDetailPageSource.includes('SMART_SLICE_EVIDENCE_PACKAGE_ITEMS') &&
    taskDetailPageSource.includes('SMART_SLICE_EVIDENCE_STEP_IDS') &&
    taskDetailPageSource.includes('Smart Slice Evidence Inspector') &&
    taskDetailPageSource.includes('copiedSmartSliceEvidenceItemId') &&
    taskDetailPageSource.includes('copySmartSliceEvidenceArtifactPath') &&
    taskDetailPageSource.includes('openSmartSliceEvidenceArtifactLocation') &&
    taskDetailPageSource.includes('reviewEventsEvidence') &&
    taskDetailPageSource.includes("relativePath: 'evidence/render-artifact-manifest.json'"),
  'TaskDetailPage exposes the canonical Smart Slice evidence package with copy and reveal actions for commercial audit handoff',
);
for (const taskType of requiredTaskTypes) {
  assertRule(autocutTypesSource.includes(`'${taskType}'`), `AUTOCUT_TASK_TYPES includes ${taskType}`);
  assertRule(tasksPageSource.includes(`AUTOCUT_TASK_TYPE.${toTaskTypeEnumKey(taskType)}`), `TasksPage icon map covers ${taskType}`);
  assertRule(taskDetailPageSource.includes(`AUTOCUT_TASK_TYPE.${toTaskTypeEnumKey(taskType)}`), `TaskDetailPage route map covers ${taskType}`);
}
const requiredEventNames = [
  'taskAdded',
  'taskUpdated',
  'taskDeleted',
  'assetAdded',
  'assetDeleted',
  'messageAdded',
  'messagesUpdated',
];
assertRule(autocutEventSource.includes('AUTOCUT_EVENTS'), '@sdkwork/autocut-services defines canonical AUTOCUT_EVENTS');
assertRule(autocutEventSource.includes('dispatchAutoCutEvent'), '@sdkwork/autocut-services exposes typed dispatchAutoCutEvent');
assertRule(autocutEventSource.includes('listenAutoCutEvent'), '@sdkwork/autocut-services exposes typed listenAutoCutEvent');
for (const eventName of requiredEventNames) {
  assertRule(autocutEventSource.includes(`${eventName}:`), `AUTOCUT_EVENTS includes ${eventName}`);
}
assertRule(autocutEventSource.includes('settingsUpdated:'), 'AUTOCUT_EVENTS includes settingsUpdated');
assertRule(exists(requiredStorageServicePath), '@sdkwork/autocut-services defines canonical storage.service.ts');
assertRule(!exists(legacyStorageServicePath), '@sdkwork/autocut-services does not keep legacy storage.ts helper');
for (const marker of requiredStorageServiceMarkers) {
  assertRule(storageServiceSource.includes(marker), `storage.service.ts exposes ${marker}`);
}
assertRule(
  storageServiceSource.includes('`${AUTO_CUT_STORAGE_NAMESPACE}_${getAutoCutRuntimeEnvironment()}_'),
  'storage.service.ts namespaces browser key-value storage by runtime environment',
);
for (const storageKey of ['assets', 'tasks', 'messages', 'settings', 'videoDedupFingerprints', 'videoDedupVisualEvidence', 'workflowPreferences']) {
  assertRule(storageServiceSource.includes(`${storageKey}:`), `storage.service.ts declares typed storage key ${storageKey}`);
}
assertRule(
  exists(requiredRuntimeEnvironmentServicePath),
  '@sdkwork/autocut-services defines canonical runtime-environment.service.ts',
);
for (const marker of requiredRuntimeEnvironmentServiceMarkers) {
  assertRule(runtimeEnvironmentServiceSource.includes(marker), `runtime-environment.service.ts exposes ${marker}`);
}
assertRule(
  serviceIndexSource.includes("export * from './service/runtime-environment.service'"),
  '@sdkwork/autocut-services exports the canonical runtime environment service',
);
assertRule(
  settingsServiceSource.includes('createAutoCutRuntimeScopedName') &&
    settingsServiceSource.includes("createAutoCutRuntimeScopedName(AUTO_CUT_LLM_SECRET_NAME)"),
  'settings.service.ts stores LLM secrets through runtime-scoped native secret names',
);
assertRule(
  settingsServiceSource.includes('resolveAutoCutOutputRootDir') &&
    settingsServiceSource.includes('outputDirectory') &&
    settingsServiceSource.includes('return normalizeOptionalText(value) ?? \'\';') &&
    !settingsServiceSource.includes("D:\\\\SDKWork\\\\AutoCut\\\\Media"),
  'settings.service.ts persists configured native output directories without hard-coding an OS-specific default',
);
assertRule(
  settingsServiceSource.includes('transientAutoCutLlmApiKeys = new Map<string, string>()') &&
    settingsServiceSource.includes('transientAutoCutLlmApiKeys.get(runtimeEnvironment)') &&
    settingsServiceSource.includes('transientAutoCutLlmApiKeys.delete(getAutoCutRuntimeEnvironment())'),
  'settings.service.ts keeps transient LLM API keys isolated by runtime environment',
);
assertRule(
  exists(requiredI18nServicePath) &&
    i18nServiceSource.includes("import i18next") &&
    i18nServiceSource.includes('normalizeAutoCutLocale') &&
    i18nServiceSource.includes("case 'zh':") &&
    i18nServiceSource.includes("case 'en':"),
  'i18n.service.ts owns the open-source i18next locale runtime and legacy locale alias normalization',
);
assertRule(
  exists(requiredI18nResourcesServicePath) &&
    i18nResourcesServiceSource.includes('settings:') &&
    i18nResourcesServiceSource.includes('page:') &&
    i18nResourcesServiceSource.includes('tabs:') &&
    i18nResourcesServiceSource.includes('toast:') &&
    i18nResourcesServiceSource.includes('status:'),
  'i18n-resources.service.ts owns Settings Center UI copy for every supported language',
);
assertRule(
  autocutTypesSource.includes('labelKey: string') &&
    autocutTypesSource.includes('descriptionKey: string') &&
    autocutTypesSource.includes("region: AutoCutModelVendorRegion") &&
    autocutTypesSource.includes('AUTOCUT_MODEL_VENDOR_PRESETS'),
  'AutoCut ModelVendor registry stores stable ids plus i18n display metadata in @sdkwork/autocut-types',
);
assertRule(
  !/label:\s*['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/u.test(autocutTypesSource),
  'AutoCut ModelVendor registry does not store localized Chinese labels in business constants',
);
assertRule(
  settingsPageSource.includes('t(preset.labelKey)') &&
    settingsPageSource.includes('t(preset.descriptionKey)') &&
    !settingsPageSource.includes('{preset.label}'),
  'SettingsPage resolves ModelVendor display labels and descriptions through i18next keys',
);
assertRule(
  exists(requiredSettingsRegistryPath) &&
    settingsRegistrySource.includes('AUTOCUT_SETTINGS_TABS') &&
    settingsRegistrySource.includes('AUTOCUT_SETTINGS_LOCALE_OPTIONS') &&
    settingsRegistrySource.includes('AutoCutSettingsTabId') &&
    settingsRegistrySource.includes('labelKey') &&
    settingsRegistrySource.includes('descriptionKey'),
  'settings.registry.ts centralizes Settings Center tab and locale display metadata as i18n keys',
);
assertRule(
  settingsServiceSource.includes('normalizeAutoCutLocale') &&
    settingsServiceSource.includes('initializeAutoCutI18n') &&
    settingsServiceSource.includes('language: normalizeAutoCutWorkspaceLanguage'),
  'settings.service.ts normalizes workspace language to canonical application locales and synchronizes the i18next runtime',
);
assertRule(
  servicesIndexSource.includes("export * from './service/speech-transcription.service'") &&
    speechTranscriptionServiceSource.includes('getAutoCutSpeechTranscriptionProviderDefinitions') &&
    speechTranscriptionServiceSource.includes('getAutoCutLocalSpeechTranscriptionModelPresets') &&
    speechTranscriptionServiceSource.includes('getAutoCutSpeechTranscriptionWorkflowPresets') &&
    speechTranscriptionServiceSource.includes('resolveAutoCutSpeechTranscriptionWorkflowPreset') &&
    speechTranscriptionServiceSource.includes('whisperChunkParallelism') &&
    speechTranscriptionServiceSource.includes('whisperChunkThreadCount') &&
    !speechTranscriptionServiceSource.includes('getAutoCutLocalSpeechTranscriptionExecutablePresets') &&
    speechTranscriptionServiceSource.includes('resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset') &&
    !speechTranscriptionServiceSource.includes('resolveAutoCutRecommendedLocalSpeechTranscriptionExecutablePreset') &&
    speechTranscriptionServiceSource.includes('setupAutoCutLocalSpeechTranscriptionModelPreset') &&
    !speechTranscriptionServiceSource.includes('setupAutoCutLocalSpeechTranscriptionExecutablePreset') &&
    speechTranscriptionServiceSource.includes('inspectAutoCutLocalSpeechTranscriptionSetup') &&
    speechTranscriptionServiceSource.includes('initializeAutoCutLocalSpeechTranscriptionSetup') &&
    speechTranscriptionServiceSource.includes('dispatchAutoCutSpeechTranscriptionModelDownloadProgress') &&
    speechTranscriptionServiceSource.includes('yieldAutoCutSpeechTranscriptionUiFrame') &&
    speechTranscriptionServiceSource.includes('requestAnimationFrame') &&
    !speechTranscriptionServiceSource.includes('dispatchAutoCutSpeechTranscriptionExecutableDownloadProgress') &&
    speechTranscriptionServiceSource.includes('downloadAutoCutLocalSpeechTranscriptionModelPreset') &&
    speechTranscriptionServiceSource.includes('copyAutoCutLocalSpeechTranscriptionModelPresetUrl') &&
    speechTranscriptionServiceSource.includes('configureAutoCutSpeechTranscriptionProviderBridge') &&
    speechTranscriptionServiceSource.includes('transcribeAutoCutMediaWithConfiguredProvider') &&
    speechTranscriptionServiceSource.includes('testAutoCutSpeechTranscriptionProvider'),
  'speech-transcription.service.ts owns the standard speech-to-text provider and guided local model acquisition boundary without runtime whisper-cli download presets',
);
assertRule(
  autocutTypesSource.includes('AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS') &&
    autocutTypesSource.includes('smart-slice-cloud-stt') &&
    autocutTypesSource.includes('smart-slice-balanced-local') &&
    autocutTypesSource.includes('smart-slice-fast-preview') &&
    autocutTypesSource.includes('smart-slice-quality-local') &&
    autocutTypesSource.includes('AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID') &&
    workflowPreferencesServiceSource.includes('AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID') &&
    workflowPreferencesServiceSource.includes('VIDEO_SLICE_STT_PRESETS') &&
    workflowPreferencesServiceSource.includes('sttPresetId: normalizeEnum') &&
    serviceBehaviorCheckSource.includes('workflow parameter preferences default Smart Slice to the commercial cloud STT workflow preset') &&
    serviceBehaviorCheckSource.includes('Smart Slice default STT workflow preset uses cloud STT for commercial large-video throughput') &&
    serviceBehaviorCheckSource.includes('workflow parameter preferences persist the selected Smart Slice STT workflow preset'),
  'Smart Slice speech-to-text workflow presets are standardized, persisted in workflow preferences, and covered by service behavior tests',
);
assertRule(
  !speechTranscriptionServiceSource.includes('validateAutoCutLocalSpeechTranscriptionExecutablePreset') &&
    !speechTranscriptionServiceSource.includes('official whisper.cpp GitHub release URL') &&
    !speechTranscriptionServiceSource.includes('pinned SHA-256 archive digest') &&
    speechTranscriptionServiceSource.includes('executableDownloadReady') &&
    speechTranscriptionServiceSource.includes('executableDownloadReady: false') &&
    speechTranscriptionServiceSource.includes('isAutoCutLocalSpeechTranscriptionSetupStatusCompatibleWithRuntimeAndHost') &&
    speechTranscriptionServiceSource.includes('areAutoCutLocalSpeechTranscriptionSetupCapabilitiesEqual') &&
    speechTranscriptionServiceSource.includes('createAutoCutUnsupportedLocalSpeechTranscriptionExecutablePresetReason') &&
    speechTranscriptionServiceSource.includes('runtime download is disabled') &&
    speechTranscriptionServiceSource.includes('packaged sidecar') &&
    serviceBehaviorCheckSource.includes('never downloads whisper-cli at runtime') &&
    serviceBehaviorCheckSource.includes('re-inspects native capabilities instead of reusing a stale missing-executable setup cache before resolving the packaged whisper-cli sidecar'),
  'speech-transcription.service.ts fails closed on local STT executable readiness and never downloads whisper-cli at runtime',
);
assertRule(
    speechTranscriptionServiceSource.includes('validateAutoCutLocalSpeechTranscriptionModelPreset') &&
    speechTranscriptionServiceSource.includes('target a local speech-to-text provider') &&
    speechTranscriptionServiceSource.includes('implemented local speech-to-text engine') &&
    speechTranscriptionServiceSource.includes('trusted Hugging Face source URL') &&
    speechTranscriptionServiceSource.includes("'hf-mirror.com'") &&
    speechTranscriptionServiceSource.includes('pinned SHA-256 model digest') &&
    speechTranscriptionServiceSource.includes('normalizeAutoCutSha256Digest(modelDownload.sha256) !== normalizeAutoCutSha256Digest(preset.sha256)') &&
    speechTranscriptionServiceSource.includes('URL file name must match fileName') &&
    speechTranscriptionServiceSource.includes('ggerganov/whisper.cpp') &&
    speechTranscriptionServiceSource.includes('supported model file extension') &&
    serviceBehaviorCheckSource.includes('rejects presets for API providers') &&
    serviceBehaviorCheckSource.includes('rejects presets for unimplemented local engines') &&
    serviceBehaviorCheckSource.includes('rejects non-HTTPS model URLs') &&
    serviceBehaviorCheckSource.includes('rejects mismatched URL file names') &&
    serviceBehaviorCheckSource.includes('rejects untrusted mirror model URLs') &&
    serviceBehaviorCheckSource.includes('rejects model presets without a pinned SHA-256 digest') &&
    serviceBehaviorCheckSource.includes('rejects unsupported model file extensions'),
  'speech-transcription.service.ts fails closed on malformed local STT model acquisition presets and mirror URLs before browser download or clipboard copy',
);
assertRule(
    settingsPageSource.includes('getAutoCutLocalSpeechTranscriptionModelPresets') &&
    settingsPageSource.includes('setupAutoCutLocalSpeechTranscriptionModelPreset') &&
    settingsPageSource.includes('handleSetupSpeechTranscriptionModelPreset') &&
    settingsPageSource.includes('isConfiguringSpeechModel') &&
    settingsPageSource.includes('normalizeSettingsLocalPath(settings.speechTranscription.modelPath') &&
    settingsPageSource.includes('settings.status.downloaded') &&
    settingsPageSource.includes('downloadAutoCutLocalSpeechTranscriptionModelPreset') &&
    settingsPageSource.includes('copyAutoCutLocalSpeechTranscriptionModelPresetUrl') &&
    !settingsPageSource.includes('downloadAutoCutUrl(modelPreset.url') &&
    !settingsPageSource.includes('writeAutoCutClipboardText(modelPreset.url'),
  'SettingsPage delegates guided local STT model acquisition actions to speech-transcription.service.ts and marks verified local model presets as downloaded instead of directly trusting preset URLs',
);
assertRule(
    settingsPageSource.includes('const refreshedStatus = await inspectAutoCutLocalSpeechTranscriptionSetup();') &&
    settingsPageSource.includes('setSpeechSetupStatus(refreshedStatus);') &&
    settingsPageSource.includes('refreshedStatus.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready') &&
    serviceBehaviorCheckSource.includes('yields one browser frame before starting the heavy native STT model download'),
  'SettingsPage refreshes local STT readiness immediately after guided model setup and service behavior requires a UI frame yield before heavy model download',
);
assertRule(
  nativeHostClientServiceSource.includes('speechTranscriptionModelDownloadCommandReady') &&
    nativeHostClientServiceSource.includes('speechTranscriptionExecutableDownloadCommandReady') &&
    nativeHostClientServiceSource.includes('downloadSpeechTranscriptionModel') &&
    !nativeHostClientServiceSource.includes('downloadSpeechTranscriptionExecutable') &&
    nativeHostClientServiceSource.includes('AutoCutSpeechTranscriptionModelDownloadProgressEvent') &&
    !nativeHostClientServiceSource.includes('AutoCutSpeechTranscriptionExecutableDownloadProgressEvent') &&
    nativeHostClientServiceSource.includes('autocut_download_speech_transcription_model') &&
    !nativeHostClientServiceSource.includes('autocut_download_speech_transcription_executable') &&
    nativeHostContractSource.includes('speech_transcription_model_download_command_ready') &&
    nativeHostContractSource.includes('speech_transcription_executable_download_command_ready') &&
    nativeHostContractSource.includes('"autocut_download_speech_transcription_model"') &&
    !nativeHostContractSource.includes('"autocut_download_speech_transcription_executable"') &&
    nativeHostCommandSource.includes('autocut_download_speech_transcription_model') &&
    !nativeHostCommandSource.includes('autocut_download_speech_transcription_executable') &&
    mainRsSource.includes('commands::autocut_download_speech_transcription_model') &&
    !mainRsSource.includes('commands::autocut_download_speech_transcription_executable') &&
    nativeMediaRuntimeSource.includes('download_autocut_speech_transcription_model') &&
    !nativeMediaRuntimeSource.includes('download_autocut_speech_transcription_executable') &&
    nativeMediaRuntimeSource.includes('AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS_EVENT') &&
    !nativeMediaRuntimeSource.includes('AUTOCUT_SPEECH_TRANSCRIPTION_EXECUTABLE_DOWNLOAD_PROGRESS_EVENT') &&
    nativeMediaRuntimeSource.includes('download_autocut_speech_transcription_model_file_with_progress') &&
    nativeMediaRuntimeSource.includes('header(RANGE, format!("bytes={partial_byte_size}-"))') &&
    nativeMediaRuntimeSource.includes('CONTENT_RANGE') &&
    nativeMediaRuntimeSource.includes('append_to_partial') &&
    nativeMediaRuntimeSource.includes('preserved partial .download file') &&
    nativeMediaRuntimeSource.includes('SHA-256 checksum mismatch') &&
    nativeMediaRuntimeSource.includes('validate_autocut_speech_transcription_model_download_request') &&
    !nativeMediaRuntimeSource.includes('validate_autocut_speech_transcription_executable_download_request') &&
    nativeMediaRuntimeSource.includes('verify_file_sha256_for_label') &&
    nativeMediaRuntimeSource.includes('AutoCut speech transcription model') &&
    nativeMediaRuntimeSource.includes('speech-transcription.toolchain.json') &&
    nativeMediaRuntimeSource.includes('resolve_autocut_bundled_speech_executable_from_candidate_manifests') &&
    nativeMediaRuntimeSource.includes('resolve_autocut_default_bundled_speech_executable_path') &&
    nativeMediaRuntimeSource.includes('validate_autocut_speech_toolchain_manifest') &&
    nativeMediaRuntimeSource.includes('verify_autocut_ffmpeg_sidecar_integrity') &&
    nativeMediaRuntimeSource.includes('speech_toolchain_resolver_uses_bundled_whisper_sidecar_when_executable_is_not_configured') &&
    nativeMediaRuntimeSource.includes('speech_toolchain_manifest_rejects_placeholder_integrity_when_bundled_ready') &&
    nativeMediaRuntimeSource.includes('models') &&
    nativeMediaRuntimeSource.includes('speech'),
  'native host exposes trusted local STT model downloads while resolving whisper-cli only from packaged sidecars, settings, environment, PATH, or common local installs',
);
assertRule(
  speechTranscriptionServiceSource.includes("AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_EXECUTABLE_ROOT = 'AutoCut application resources'") &&
    speechTranscriptionServiceSource.includes("AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_RESOURCE_SUBDIRECTORY = 'binaries'") &&
    speechTranscriptionServiceSource.includes("defaultExecutablePlatform === 'windows-x86_64'") &&
    serviceBehaviorCheckSource.includes('D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe') &&
    !serviceBehaviorCheckSource.includes('target/debug/binaries/whisper-cli') &&
    !serviceBehaviorCheckSource.includes('target\\\\debug\\\\binaries\\\\whisper-cli') &&
    !serviceBehaviorCheckSource.includes('D:/autocut/media/runtimes/speech/windows-x86_64/whisper-cli.exe'),
  'local STT initialization defaults and tests point whisper-cli to packaged application resources instead of writable app-data runtime or debug build directories',
);
assertRule(
  tauriConfig.bundle?.resources?.['binaries/speech-transcription.toolchain.json'] === 'binaries/speech-transcription.toolchain.json' &&
    tauriConfig.bundle?.resources?.['binaries/windows-x86_64'] === 'binaries/windows-x86_64' &&
    tauriConfig.bundle?.resources?.['binaries/linux-x86_64'] === 'binaries/linux-x86_64' &&
    tauriConfig.bundle?.resources?.['binaries/macos-x86_64'] === 'binaries/macos-x86_64' &&
    tauriConfig.bundle?.resources?.['binaries/macos-aarch64'] === 'binaries/macos-aarch64' &&
    nativeSpeechToolchainManifestSource.includes('"tool": "whisper-cli"') &&
    nativeSpeechToolchainManifestSource.includes('"windows-x86_64"') &&
    nativeSpeechToolchainManifestSource.includes('"linux-x86_64"') &&
    nativeSpeechToolchainManifestSource.includes('"macos-x86_64"') &&
    nativeSpeechToolchainManifestSource.includes('"macos-aarch64"') &&
    nativeSpeechToolchainManifestSource.includes('"relativePath": "windows-x86_64/whisper-cli.exe"') &&
    nativeSpeechToolchainManifestSource.includes('"relativePath": "linux-x86_64/whisper-cli"') &&
    nativeSpeechToolchainManifestSource.includes('"relativePath": "macos-x86_64/whisper-cli"') &&
    nativeSpeechToolchainManifestSource.includes('"relativePath": "macos-aarch64/whisper-cli"'),
  'desktop Tauri packages the Whisper CLI speech-to-text sidecar manifest for release executable discovery',
);
assertRule(
  speechTranscriptionServiceSource.includes("runtime.provider.kind === 'local'") &&
    speechTranscriptionServiceSource.includes("runtime.provider.kind === 'api'") &&
    speechTranscriptionServiceSource.includes('nativeHostClient.transcribeMedia') &&
    speechTranscriptionServiceSource.includes('configuredSpeechTranscriptionProviderBridge.transcribe') &&
    speechTranscriptionServiceSource.includes('ensureAutoCutLocalSpeechTranscriptionExecutionReady') &&
    speechTranscriptionServiceSource.includes("sourceKind: 'execution-preflight'") &&
    speechTranscriptionServiceSource.includes('validateAutoCutLocalSpeechTranscriptionModelDownloadResult') &&
    speechTranscriptionServiceSource.includes('requires the matching ModelVendor') &&
    serviceBehaviorCheckSource.includes('rejects incomplete native model downloads before saving modelPath') &&
    serviceBehaviorCheckSource.includes('performs a fresh execution preflight probe before local STT dispatch') &&
    speechTranscriptionServiceSource.includes('providerId: runtime.providerId'),
  'speech-transcription.service.ts dispatches local and API STT providers only after model/provider preflight and passes providerId through requests',
);
assertRule(
  speechTranscriptionServiceSource.includes('normalizeAutoCutSpeechTranscriptionSegments') &&
    speechTranscriptionServiceSource.includes('valid timestamped speech segments') &&
    speechTranscriptionServiceSource.includes('to contain recognized speech text') &&
    speechTranscriptionServiceSource.includes('endMs to be after startMs') &&
    speechTranscriptionServiceSource.includes('finite non-negative timestamp') &&
    serviceBehaviorCheckSource.includes('rejects API provider results with no structured speech segments') &&
    serviceBehaviorCheckSource.includes('rejects API provider segments with blank transcript text') &&
    serviceBehaviorCheckSource.includes('rejects API provider segments with zero speech duration') &&
    serviceBehaviorCheckSource.includes('rejects API provider segments with non-finite speech timestamps') &&
    serviceBehaviorCheckSource.includes('rejects API provider segments with negative speech timestamps'),
  'speech-transcription.service.ts fails closed on malformed STT provider transcript segments before smart slicing or text extraction',
);
assertRule(
  serviceBehaviorCheckSource.includes('autocut_dev_settings') &&
    serviceBehaviorCheckSource.includes('autocut_release_settings') &&
    serviceBehaviorCheckSource.includes('dev-default') &&
    serviceBehaviorCheckSource.includes('release-default') &&
    serviceBehaviorCheckSource.includes('dev runtime reloads the selected output directory after restart') &&
    serviceBehaviorCheckSource.includes('release runtime leaves outputRootDir unset so the desktop host resolves a per-user app-data media root'),
  'service behavior check covers dev/release settings, output directory, app-data fallback, and native secret isolation',
);
assertRule(exists(requiredMediaFixturesServicePath), '@sdkwork/autocut-services defines canonical media-fixtures.service.ts');
for (const marker of requiredMediaFixturesMarkers) {
  assertRule(mediaFixturesServiceSource.includes(marker), `media-fixtures.service.ts exposes ${marker}`);
}
assertRule(!mediaFixturesServiceSource.includes('BigBuckBunny.mp4'), 'media-fixtures.service.ts does not expose the removed BigBuckBunny sample video');
assertRule(!mediaFixturesServiceSource.includes('storage.googleapis.com/gtv-videos-bucket'), 'media-fixtures.service.ts does not expose Google sample video fixtures that return 403');
for (const pattern of forbiddenRemoteFixtureUrlPatterns) {
  assertRule(!pattern.test(mediaFixturesServiceSource), 'media-fixtures.service.ts does not expose third-party remote fixture media URLs');
}
assertRule(!slicerPageSource.includes('getAutoCutSampleVideoUrl'), 'SlicerPage does not load a remote sample video by default');
assertRule(
  slicerPageSource.includes('AutoCut no longer loads remote demo videos by default.'),
  'SlicerPage shows a local-media empty state instead of loading a remote demo video',
);
assertRule(exists(requiredDatetimeServicePath), '@sdkwork/autocut-services defines canonical datetime.service.ts');
for (const marker of requiredDatetimeServiceMarkers) {
  assertRule(datetimeServiceSource.includes(marker), `datetime.service.ts exposes ${marker}`);
}
assertRule(
  !/toLocaleString\s*\(\s*\)/u.test(datetimeServiceSource),
  'datetime.service.ts does not use environment-dependent bare toLocaleString() for task timestamps',
);
assertRule(
  datetimeServiceSource.includes("return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`"),
  'datetime.service.ts formats task timestamps as stable local YYYY-MM-DD HH:mm:ss text',
);
assertRule(
  datetimeServiceSource.includes('AUTO_CUT_SQLITE_UTC_TIMESTAMP_PATTERN') &&
    datetimeServiceSource.includes("normalizedTimestamp.replace(' ', 'T')}Z"),
  'datetime.service.ts treats native SQLite UTC timestamps without timezone suffix as UTC instants',
);
for (const marker of requiredDownloadServiceMarkers) {
  assertRule(downloadServiceSource.includes(marker), `download.service.ts exposes ${marker}`);
}
assertRule(
  exists(requiredProcessingSourceServicePath),
  '@sdkwork/autocut-services defines canonical processing-source.service.ts',
);
assertRule(
    processingSourceServiceSource.includes('class AutoCutProcessingTaskError') &&
    processingSourceServiceSource.includes('readonly taskId: string') &&
    processingSourceServiceSource.includes('failAutoCutProcessingTask') &&
    processingSourceServiceSource.includes('getAutoCutProcessingTaskErrorTaskId'),
  'processing-source.service.ts exposes typed failed task diagnostics for UI surfaces',
);
for (const marker of requiredProcessingSourceServiceMarkers) {
  assertRule(processingSourceServiceSource.includes(marker), `processing-source.service.ts exposes ${marker}`);
}
assertRule(
  exists(requiredNativeHostClientServicePath),
  '@sdkwork/autocut-services defines canonical native-host-client.service.ts',
);
for (const marker of requiredNativeHostClientServiceMarkers) {
  assertRule(nativeHostClientServiceSource.includes(marker), `native-host-client.service.ts exposes ${marker}`);
}
assertRule(
  serviceIndexSource.includes("export * from './service/native-host-client.service'"),
  '@sdkwork/autocut-services exports the canonical native host client service',
);
assertRule(exists(requiredTasksServicePath), '@sdkwork/autocut-services defines canonical tasks.service.ts');
assertRule(
  tasksServiceSource.includes('getAutoCutNativeHostClient'),
  'tasks.service.ts reads native task snapshots through the canonical native host client',
);
assertRule(
  tasksServiceSource.includes('listNativeTasks'),
  'tasks.service.ts uses autocut_list_native_tasks for database-backed task center data',
);
assertRule(
  !/\btasks\.mock\b/u.test(tasksServiceSource) && !/\bINITIAL_TASKS\b/u.test(tasksServiceSource),
  'tasks.service.ts does not seed task center data from mock/default tasks',
);
assertRule(
  !/readAutoCutStorage<[^>]*AppTask[^>]*>\(\s*['"]tasks['"]\s*,\s*INITIAL_TASKS/u.test(tasksServiceSource),
  'tasks.service.ts defaults browser task storage to an empty collection instead of mock tasks',
);
assertRule(
  tasksServiceSource.includes('mergeNativeTaskWithLocalSliceMetadata') &&
    tasksServiceSource.includes('isSameSliceSourceWindow') &&
    !tasksServiceSource.includes('localTask.sliceResults?.[index]') &&
    serviceBehaviorCheckSource.includes('does not merge stale smart slice metadata by index'),
  'tasks.service.ts merges native smart-slice metadata only by artifact id or matching source window',
);
assertRule(
  tasksServiceSource.includes('createNativeVideoSliceProjection') &&
    tasksServiceSource.includes('assertAndMapNativeSliceResult') &&
    tasksServiceSource.includes('createInvalidNativeVideoSliceProjection') &&
    tasksServiceSource.includes('snapshot.status !== OPS_STATUS_COMPLETED') &&
    tasksServiceSource.includes('assertPositiveNativeSliceCount') &&
    tasksServiceSource.includes('sourceFileId: baseProjection.sourceFileId') &&
    tasksServiceSource.includes('declared slices') &&
    tasksServiceSource.includes('thumbnailArtifactPath') &&
    tasksServiceSource.includes('assertPositiveNativeSliceNumber(slice.byteSize') &&
    tasksServiceSource.includes('assertNativeSlicePathInsideTaskOutputDir') &&
    tasksServiceSource.includes('enforceRecoveredNativeVideoSliceProfessionalTranscriptEvidence') &&
    tasksServiceSource.includes('missing speech-to-text transcript evidence') &&
    tasksServiceSource.includes('assertRecoveredNativeVideoSliceAudioCleanupEvidence') &&
    tasksServiceSource.includes('audioCleanupProfile: RECOVERED_SMART_SLICE_AUDIO_CLEANUP_PROFILE') &&
    tasksServiceSource.includes('rawAudioActivityAnalysisFilter: RECOVERED_SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER') &&
    tasksServiceSource.includes('acceptedBoundaryDecisionSources: RECOVERED_SMART_SLICE_ACCEPTED_BOUNDARY_DECISION_SOURCES') &&
    tasksServiceSource.includes('acceptedTailTreatments: RECOVERED_SMART_SLICE_ACCEPTED_TAIL_TREATMENTS') &&
    tasksServiceSource.includes('missing smart-slice audio cleanup evidence') &&
    tasksServiceSource.includes('slicesWithAudioCleanupEvidence') &&
    tasksServiceSource.includes('createRecoveredNativeVideoSliceDebugDiagnostics') &&
    tasksServiceSource.includes('Input clip evidence:') &&
    tasksServiceSource.includes('Output slice evidence:') &&
    tasksServiceSource.includes('error.stack') &&
    autocutTypesSource.includes('failureDiagnostics?: string') &&
    autocutTypesSource.includes('AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD') &&
    autocutTypesSource.includes('maxLeadingSilenceMs: 200') &&
    autocutTypesSource.includes('maxTrailingSilenceMs: 250') &&
    autocutTypesSource.includes('minTranscriptCoverageScore: 0.8') &&
    autocutTypesSource.includes('minAudioActivityConfidence: 0.8') &&
    autocutTypesSource.includes('maxAudioTranscriptBoundaryDisagreementMs: 1_500') &&
    autocutTypesSource.includes('minAudioTranscriptBoundaryOverlapRatio: 0.85') &&
    autocutTypesSource.includes("requiredAudioActivityAnalysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08'") &&
    autocutTypesSource.includes("rawAudioActivityAnalysisFilter: 'silencedetect=noise=-35dB:d=0.08'") &&
    tasksServiceSource.includes('AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD') &&
    tasksServiceSource.includes('speechContinuityGrade to be strong or repaired') &&
    tasksServiceSource.includes('noise reduction decision evidence') &&
    tasksServiceSource.includes('audioActivityStartMs/audioActivityEndMs inside the source range') &&
    tasksServiceSource.includes('audioActivityConfidence to be at least') &&
    tasksServiceSource.includes('audioActivityAnalysisFilter to match the recorded noise reduction decision') &&
    tasksServiceSource.includes("assertRecoveredNativeVideoSliceMilliseconds(sliceResult.leadingSilenceMs, sliceNumber, 'leadingSilenceMs')") &&
    tasksServiceSource.includes("assertRecoveredNativeVideoSliceMilliseconds(sliceResult.trailingSilenceMs, sliceNumber, 'trailingSilenceMs')") &&
    serviceBehaviorCheckSource.includes('fails closed when recovered speech-to-text transcript evidence is missing') &&
    serviceBehaviorCheckSource.includes('exposes the recovered transcript evidence validation stack trace for debugging') &&
    serviceBehaviorCheckSource.includes('diagnostics summarize missing request-side transcript evidence') &&
    serviceBehaviorCheckSource.includes('diagnostics summarize missing output-side transcript evidence') &&
    serviceBehaviorCheckSource.includes('does not expose generated slices without recovered transcript evidence') &&
    serviceBehaviorCheckSource.includes('fails closed when recovered audio cleanup evidence is missing') &&
    serviceBehaviorCheckSource.includes('does not expose generated slices without recovered audio cleanup evidence') &&
    serviceBehaviorCheckSource.includes('fails closed when recovered transcript coverage is below the professional threshold') &&
    serviceBehaviorCheckSource.includes('fails closed when recovered speech continuity is weak') &&
    serviceBehaviorCheckSource.includes('native completed slice task fails closed when an artifact escapes its task output directory') &&
    serviceBehaviorCheckSource.includes('fails closed when a thumbnail stays in the task output root instead of cover') &&
    !tasksServiceSource.includes('.filter((slice): slice is TaskSliceResult => Boolean(slice))') &&
    serviceBehaviorCheckSource.includes('native completed slice tasks with corrupt output are recovered as failed AppTasks'),
  'tasks.service.ts fails closed instead of projecting corrupt, escaped, cover-bypassing, or transcript-less native smart-slice task output',
);
assertRule(
  slicerServiceSource.includes('fallbackNoiseReductionApplied: SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED') &&
    slicerServiceSource.includes('shouldStartSmartSliceWithNoiseReduction') &&
    slicerServiceSource.includes('shouldAllowSmartSliceNoiseReduction') &&
    slicerServiceSource.includes("typeof sliceResult.noiseReductionApplied !== 'boolean'") &&
    slicerServiceSource.includes('noise reduction decision evidence') &&
    workflowPreferencesServiceSource.includes('enableNoiseReduction: true') &&
    slicerPageSource.includes('setNoiseReduction') &&
    slicePlannerSource.includes('SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER') &&
    !slicePlannerSource.includes('options.noiseReductionApplied ?? true') &&
    serviceBehaviorCheckSource.includes('Smart Slice honors disabled denoise before audio boundary analysis for clean source audio') &&
    serviceBehaviorCheckSource.includes('Smart Slice completes with clean raw audio cleanup evidence when callers disable denoise') &&
    serviceBehaviorCheckSource.includes('workflow parameter preferences store disabled broadband denoise after disabled denoise input'),
  'slicerService.ts, SlicerPage, workflow preferences, and planner default Smart Slice to raw audio while preserving explicit denoise decision evidence',
);
assertRule(
  slicerServiceSource.includes('capabilities.videoSliceAudioActivityAnalysisCommandReady &&') &&
    slicerServiceSource.includes('assertSmartSliceAudioActivityAnalysisComplete') &&
    slicerServiceSource.includes('Array.isArray(resultEnvelope.analyses)') &&
    slicerServiceSource.includes('analysis.confidence < MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE') &&
    slicerServiceSource.includes('getSmartSliceRequiredAudioActivityAnalysisFilter') &&
    slicerServiceSource.includes('SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER') &&
    slicerServiceSource.includes('analysis.analysisFilter !== requiredAudioActivityAnalysisFilter') &&
    smartSliceTaskEvidenceCheckSource.includes('audioActivityRangeReady') &&
    smartSliceTaskEvidenceCheckSource.includes('rawAudioActivityAnalysisFilter') &&
    smartSliceQualityEvidenceSource.includes('audioActivityRangeReady') &&
    smartSliceQualityEvidenceSource.includes('rawAudioActivityAnalysisFilter') &&
    smartSliceSampleEvidenceSource.includes('audioActivityStartMs') &&
    slicerServiceSource.includes('createSmartSliceAudioBoundaryAnalysisRequirementLabel') &&
    slicerServiceSource.includes('Smart slicing requires ${createSmartSliceAudioBoundaryAnalysisRequirementLabel(noiseReductionApplied)} before native rendering') &&
    slicerServiceSource.includes('Smart slicing requires complete ${analysisRequirementLabel} for every planned clip before native rendering') &&
    slicerServiceSource.includes('Smart slicing requires high-confidence ${analysisRequirementLabel} activity evidence before native rendering') &&
    serviceBehaviorCheckSource.includes('Smart Slice fails closed when audio boundary analysis fails') &&
    serviceBehaviorCheckSource.includes('Smart Slice fails preflight when audio boundary analysis capability is unavailable') &&
    serviceBehaviorCheckSource.includes('Smart Slice rejects incomplete audio boundary analysis results') &&
    serviceBehaviorCheckSource.includes('Smart Slice rejects malformed audio boundary analysis evidence with a standard error') &&
    serviceBehaviorCheckSource.includes('Smart Slice rejects malformed audio boundary analysis envelopes with a standard error') &&
    serviceBehaviorCheckSource.includes('Smart Slice rejects weak non-audio boundary analysis evidence with a standard error') &&
    serviceBehaviorCheckSource.includes('Smart Slice does not render native slices after incomplete audio boundary analysis') &&
    slicerServiceSource.includes('raw audio boundary analysis fallback to denoise') &&
    !slicerServiceSource.includes('fallbackToTranscriptBoundaries'),
  'slicerService.ts requires successful complete high-confidence audio boundary analysis before native smart-slice rendering and never falls back to transcript-only cleanup',
);
assertRule(
  slicePlannerSource.includes('MAX_AUDIO_TRANSCRIPT_BOUNDARY_DISAGREEMENT_MS') &&
    slicePlannerSource.includes('MIN_AUDIO_TRANSCRIPT_BOUNDARY_OVERLAP_RATIO') &&
    slicePlannerSource.includes('maxAudioTranscriptBoundaryDisagreementMs: MAX_AUDIO_TRANSCRIPT_BOUNDARY_DISAGREEMENT_MS') &&
    slicePlannerSource.includes('minAudioTranscriptBoundaryOverlapRatio: MIN_AUDIO_TRANSCRIPT_BOUNDARY_OVERLAP_RATIO') &&
    slicePlannerSource.includes('resolveAudioTranscriptBoundaryConflictRisks') &&
    slicePlannerSource.includes('audio-transcript-boundary-conflict') &&
    slicePlannerSource.includes('createSemanticStoryMergeCandidates') &&
    slicePlannerSource.includes('candidatesHaveIncompleteSemanticOverlap') &&
    slicePlannerSource.includes('repairIncompleteSemanticStorySelections') &&
    slicePlannerSource.includes('repairSelectedPlanSemanticStoryFragments') &&
    slicePlannerSource.includes('SEMANTIC_STORY_FRAGMENT_BOUNDARY_TOLERANCE_MS') &&
    slicePlannerSource.includes('speechDurationMs > maxDurationMs') &&
    slicePlannerSource.includes('semantic-story-merged') &&
    slicePlannerSource.includes('const qualityScore = matchedCandidate?.qualityScore ?? clampScore(clip?.qualityScore)') &&
    slicePlannerSource.includes('const continuityScore = matchedCandidate?.continuityScore ?? clampScore(clip?.continuityScore)') &&
    slicePlannerSource.includes('const llmRisks = matchedCandidate ? undefined : normalizePlanRisks(clip?.risks)') &&
    slicePlannerSource.includes('selectContentDerivedReleasePlan') &&
    slicePlannerSource.includes('selectCanonicalContentDerivedReleasePlan') &&
    slicerPlannerCheckSource.includes('semantic continuity planning merges adjacent understood transcript segments into one continuous clip') &&
    slicerPlannerCheckSource.includes('auto semantic continuity planning treats short same-topic pauses as one content group instead of separate output clips') &&
    slicerPlannerCheckSource.includes('auto semantic continuity planning emits two clips for two distinct complete back-to-back stories') &&
    slicerPlannerCheckSource.includes('semantic story merge candidates are rejected instead of truncating speech beyond the maximum clip duration') &&
    slicerPlannerCheckSource.includes('LLM partial semantic selections are repaired to the complete merged story candidate') &&
    slicerPlannerCheckSource.includes('LLM planning cannot omit a deterministic strong content-derived story to reduce the natural clip count') &&
    slicerPlannerCheckSource.includes('LLM planning cannot contaminate canonical strong content groups with model-invented blocking risks') &&
    slicerPlannerCheckSource.includes('LLM candidate-id plans preserve deterministic transcript quality scores instead of trusting model-invented scores') &&
    slicerPlannerCheckSource.includes('LLM candidate-id plans ignore model-invented risk tags so publishability scoring stays evidence-backed') &&
    slicerPlannerCheckSource.includes('LLM candidate-id plans fall back when every selected transcript candidate fails publishability gates after normalization') &&
    slicerPlannerCheckSource.includes('audio cleanup boundary conflicts choose renderable audio activity boundaries instead of transcript windows with excessive trusted padding') &&
    slicerPlannerCheckSource.includes('audio cleanup boundary conflicts preserve denoised audio activity start evidence for review'),
  'slicePlanner.ts keeps audio-cleaned conflict clips renderable when audio activity boundaries conflict with STT evidence, keeps LLM candidate-id selections evidence-backed, and merges adjacent understood segments into complete content groups without truncating story speech',
);
assertRule(exists(requiredAssetsServicePath), '@sdkwork/autocut-services defines canonical assets.service.ts');
assertRule(
  !/\bassets\.mock\b/u.test(assetsServiceSource) && !/\bINITIAL_ASSETS\b/u.test(assetsServiceSource),
  'assets.service.ts does not seed asset center data from mock/default assets',
);
assertRule(exists(requiredMessagesServicePath), '@sdkwork/autocut-services defines canonical messages.service.ts');
assertRule(
  !/\bmessages\.mock\b/u.test(messagesServiceSource) && !/\bINITIAL_MESSAGES\b/u.test(messagesServiceSource),
  'messages.service.ts does not seed message center data from mock/default messages',
);
assertRule(exists(requiredToolsRegistryPath), '@sdkwork/autocut-services defines canonical tools.registry.ts');
assertRule(!exists('packages/sdkwork-autocut-services/src/service/tools.mock.ts'), 'tool catalog uses registry naming instead of mock naming');
assertRule(
  toolsRegistrySource.includes('AUTOCUT_TOOL_DEFINITIONS') &&
    toolsRegistrySource.includes('nameKey') &&
    toolsRegistrySource.includes('descriptionKey') &&
    !/[\u4e00-\u9fff]/u.test(toolsRegistrySource),
  'tool catalog stores stable tool ids and i18n keys instead of localized display text',
);
assertRule(exists(requiredSlicerServicePath), '@sdkwork/autocut-slicer defines canonical slicerService.ts');
assertRule(
  exists('packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts'),
  '@sdkwork/autocut-slicer defines a pure slicePlanner.ts planning kernel',
);
assertRule(
  slicerServiceSource.includes("from './smartCutEnginePlanner'") &&
    slicerServiceSource.includes('createSmartCutEngineSlicePlan') &&
    slicerServiceSource.includes('createSmartCutEngineLlmReview') &&
    slicerServiceSource.includes('SmartCutEngineSlicePlanningError') &&
    slicerServiceSource.includes('validateVideoSliceParams'),
  'slicerService.ts delegates intelligent slice planning to the Smart Cut Engine planner',
);
assertRule(
  toolsRegistrySource.includes("id: 'video-dedup'") &&
    toolsRegistrySource.includes("route: '/video-dedup'") &&
    toolsRegistrySource.includes("category: 'ai'"),
  'tool catalog registers video-dedup as an AI tool with a mounted route',
);
assertRule(
  servicesIndexSource.includes("export * from './service/video-dedup.service'"),
  'services index exports the reusable video-dedup service',
);
assertRule(
  autocutTypesSource.includes('VideoDedupParams') &&
    autocutTypesSource.includes('VideoDedupReport') &&
    autocutTypesSource.includes('VideoDuplicateGroup'),
  'autocut types define reusable video dedup contracts',
);
assertRule(
  nativeHostCommandSource.includes('pub async fn autocut_fingerprint_video_file') &&
    nativeHostCommandSource.includes('pub async fn autocut_probe_video_file_identity') &&
    nativeHostCommandSource.includes('fingerprint_autocut_video_file') &&
    nativeHostCommandSource.includes('probe_autocut_video_file_identity') &&
    mainRsSource.includes('commands::autocut_fingerprint_video_file') &&
    mainRsSource.includes('commands::autocut_probe_video_file_identity') &&
    nativeHostContractSource.includes('videoDedupFingerprintCommandReady') &&
    nativeHostContractSource.includes('videoDedupFileIdentityCommandReady') &&
    nativeHostContractSource.includes('"autocut_fingerprint_video_file"') &&
    nativeHostContractSource.includes('"autocut_probe_video_file_identity"') &&
    nativeMediaRuntimeSource.includes('AutoCutVideoFileFingerprintRequest') &&
    nativeMediaRuntimeSource.includes('AutoCutVideoFileFingerprintResult') &&
    nativeMediaRuntimeSource.includes('AutoCutVideoFileIdentityResult') &&
    nativeMediaRuntimeSource.includes('fingerprint_autocut_video_file') &&
    nativeMediaRuntimeSource.includes('probe_autocut_video_file_identity') &&
    nativeMediaRuntimeSource.includes('calculate_file_sha256'),
  'native host exposes Rust-backed streaming SHA-256 and lightweight file-identity commands for exact video dedup',
);
assertRule(
  nativeHostClientServiceSource.includes('AutoCutVideoFileFingerprintRequest') &&
    nativeHostClientServiceSource.includes('AutoCutVideoFileFingerprintResult') &&
    nativeHostClientServiceSource.includes('AutoCutVideoFileIdentityResult') &&
    nativeHostClientServiceSource.includes('videoDedupFingerprintCommandReady') &&
    nativeHostClientServiceSource.includes('videoDedupFileIdentityCommandReady') &&
    nativeHostClientServiceSource.includes('fingerprintVideoFile') &&
    nativeHostClientServiceSource.includes('probeVideoFileIdentity') &&
    nativeHostClientServiceSource.includes("'autocut_fingerprint_video_file'") &&
    nativeHostClientServiceSource.includes("'autocut_probe_video_file_identity'"),
  'native-host-client.service.ts exposes typed video dedup fingerprint and file identity client contracts',
);
assertRule(
  serviceBehaviorCheckSource.includes('video dedup exact-file-hash uses native SHA-256 fingerprints') &&
    fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts')) &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('native-sha256') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('fingerprintVideoFile') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('probeVideoFileIdentity') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('VIDEO_DEDUP_FILE_IDENTITY_VERSION') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('videoDedupFingerprints') &&
    serviceBehaviorCheckSource.includes('reuses cached native SHA-256 fingerprints') &&
    serviceBehaviorCheckSource.includes('lightweight native file identity probes') &&
    serviceBehaviorCheckSource.includes('native identity changes'),
  'video-dedup.service.ts prefers native SHA-256 fingerprints and validates cached entries with native file identity probes',
);
assertRule(
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint extracts native visual evidence for each selected asset') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint uses native scene evidence') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint passes local artifactPath to native visual evidence extraction') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint requests native perceptual frame fingerprints') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint reuses cached native visual evidence') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint validates cached visual evidence with lightweight native file identity probes') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint invalidates only changed visual evidence cache entry') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint does not auto-match structure-only native visual evidence without perceptual frame content') &&
    serviceBehaviorCheckSource.includes('video dedup visual-fingerprint does not mark different picture content as duplicate just because scene timing matches') &&
    fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts')) &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('extractVisualEvidence') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('AutoCutVideoDedupVisualSignature') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('native-visual-evidence') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('includeFrameFingerprint: true') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('videoDedupVisualEvidence') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('VIDEO_DEDUP_VISUAL_EVIDENCE_CACHE_LIMIT') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('createVideoDedupVisualEvidenceCacheKey') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('doesVideoDedupVisualEvidenceCacheIdentityMatch') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('calculateNativeVideoDedupFrameFingerprintSimilarity') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('calculateNativeVideoDedupVisualSimilarity') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('contentEvidenceReady') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('visualEvidenceExtractionAdapterReady'),
  'video-dedup.service.ts prefers native scene-index visual evidence with perceptual frame content for visual-fingerprint matching before metadata fallback and passes local artifact paths',
);
assertRule(
  serviceBehaviorCheckSource.includes('video dedup audio-fingerprint extracts native audio fingerprints for each selected asset') &&
    serviceBehaviorCheckSource.includes('video dedup audio-fingerprint uses native audio evidence') &&
    serviceBehaviorCheckSource.includes('video dedup audio-fingerprint passes local artifactPath to native audio fingerprint extraction') &&
    serviceBehaviorCheckSource.includes('video dedup audio-fingerprint does not fall back to metadata-token proxy when native audio fingerprints prove different audio') &&
    fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts')) &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('fingerprintAudio') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('AutoCutVideoDedupAudioSignature') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('native-audio-fingerprint') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('calculateNativeVideoDedupAudioSimilarity') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/video-dedup.service.ts'), 'utf8')
      .includes('!hasNativeAudioPair') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-services/src/service/native-host-client.service.ts'), 'utf8')
      .includes('AutoCutAudioFingerprintResult') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs'), 'utf8')
      .includes('run_ffmpeg_audio_fingerprint_extraction') &&
    fs
      .readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs'), 'utf8')
      .includes('audio-energy-v1'),
  'video-dedup.service.ts prefers native FFmpeg-backed audio fingerprints for audio-fingerprint matching and blocks metadata fallback when native audio proves different content',
);
assertRule(
  slicePlannerSource.includes('export function getVideoSlicePlanningPolicy') &&
    !slicePlannerSource.includes('MAX_CONTENT_DERIVED_SLICE_COUNT') &&
    slicePlannerSource.includes('MAX_LLM_PLAN_ITEMS_TO_INSPECT') &&
    slicePlannerSource.includes('selectNaturalStrongContentDerivedCandidatePlan') &&
    slicePlannerSource.includes('SLICE_PLATFORM_PROFILES') &&
    slicePlannerSource.includes('idealDurationMs') &&
    slicePlannerSource.includes('sourceDurationMs') &&
    slicePlannerSource.includes('continuityJoinGapMs') &&
    slicePlannerSource.includes('customKeywords') &&
    slicePlannerSource.includes("params.targetAspectRatio && params.targetAspectRatio !== 'auto'"),
  'slicePlanner.ts centralizes smart slicing strategy policy instead of scattering fixed defaults',
);
assertRule(
    !slicerServiceSource.includes('requestedClipCount') &&
    !slicerServiceSource.includes('sliceCountMode: planningPolicy.sliceCountMode') &&
    smartCutEnginePlannerSource.includes('rankedCandidateIds') &&
    smartCutEnginePlannerSource.includes('referencedUnitIds') &&
    smartCutEnginePlannerSource.includes('candidates: input.candidates.map') &&
    smartCutEnginePlannerSource.includes('contentUnits: input.contentUnits.map') &&
    smartCutEnginePlannerSource.includes('Never return startMs, endMs, durationMs, or raw timestamps'),
  'smartCutEnginePlanner.ts constrains AI planning to canonical candidate ids and content-unit ids',
);
assertRule(
  smartCutEnginePlannerSource.includes('createSmartCutSpeechFirstExecutionPackage') &&
    smartCutEnginePlannerSource.includes('contentUnitIds') &&
    smartCutEnginePlannerSource.includes('speakerIds') &&
    smartCutEnginePlannerSource.includes('speakerRoles') &&
    smartCutEnginePlannerSource.includes('MISSING_MULTI_SPEAKER_DIARIZATION'),
  'smartCutEnginePlanner.ts preserves speech continuity through content units and speaker-aware evidence',
);
assertRule(
  slicerServiceSource.includes('function createVideoSliceRenderProfile') &&
    slicerServiceSource.includes('const renderProfile = createVideoSliceRenderProfile(planningPolicy)') &&
    slicerServiceSource.includes('renderProfile }'),
  'slicerService.ts projects the canonical publishing strategy into native renderProfile requests',
);
assertRule(
  nativeHostClientServiceSource.includes('AutoCutVideoSliceRenderProfile') &&
    nativeHostClientServiceSource.includes('renderProfile?: AutoCutVideoSliceRenderProfile'),
  'native host client exposes a typed video slice renderProfile contract',
);
assertRule(
  nativeHostClientServiceSource.includes('durationMs?: number') &&
    nativeMediaRuntimeSource.includes('pub duration_ms: Option<i64>') &&
    nativeMediaRuntimeSource.includes('"durationMs": duration_ms') &&
    nativeMediaRuntimeSource.includes('probe_autocut_media_evidence(Some(toolchain), &sandbox_path)') &&
    nativeMediaRuntimeSource.includes('media_probe_evidence.duration_ms'),
  'native host media import and describe contracts expose source duration for source-bounded smart slicing',
);
assertRule(
  nativeMediaRuntimeSource.includes('fn parse_ffmpeg_media_probe_evidence') &&
    nativeMediaRuntimeSource.includes('fn probe_autocut_media_evidence') &&
    nativeMediaRuntimeSource.includes('duration_ms: parse_ffmpeg_duration_millis(ffmpeg_output)') &&
    nativeMediaRuntimeSource.includes('probe_autocut_media_evidence(toolchain, &source_path)'),
  'media_runtime.rs derives stream evidence and duration from one FFmpeg media probe during local selection and import',
);
assertRule(
  !/let\s+source_duration_ms\s*=\s*read_ffmpeg_media_duration_millis\([^;]+;\s*let\s+source_has_audio_stream\s*=\s*ffmpeg_media_has_audio_stream/u.test(
    nativeMediaRuntimeSource,
  ),
  'media_runtime.rs avoids back-to-back FFmpeg duration and audio-stream probes for the same source',
);
assertRule(
  nativeMediaRuntimeSource.includes('AutoCutVideoSliceRenderProfile') &&
    nativeMediaRuntimeSource.includes('normalize_video_slice_render_profile') &&
    nativeMediaRuntimeSource.includes('video_slice_render_filter_chain') &&
    nativeMediaRuntimeSource.includes('render_profile') &&
    nativeMediaRuntimeSource.includes('target_aspect_ratio') &&
    nativeMediaRuntimeSource.includes('object_fit'),
  'native media runtime standardizes target aspect ratio rendering for smart slices',
);
assertRule(
  !slicerServiceSource.includes('requestedClipCount'),
  'slicerService.ts does not present Smart Slice as a requested clip count in LLM prompts',
);
assertRule(
  slicePlannerSource.includes('export function createDeterministicSlicePlan') &&
    slicePlannerSource.includes('return [];') &&
    slicerPlannerCheckSource.includes('auto deterministic fallback refuses to fabricate default clip counts without transcript content evidence') &&
    slicerPlannerCheckSource.includes('deterministic Smart Slice fallback refuses legacy fixed target counts without transcript content evidence') &&
    slicerPlannerCheckSource.includes('auto transcript-assisted planning returns no clips when no real transcript content is available') &&
    slicePlannerSource.includes('shouldRejectLlmPlanWithoutTranscriptEvidence') &&
    slicerPlannerCheckSource.includes('auto LLM fallback refuses deterministic clips when no transcript content evidence is available') &&
    slicerPlannerCheckSource.includes('no-transcript LLM plans reject raw timing windows instead of filling fabricated fallback clips') &&
    slicerPlannerCheckSource.includes('source-duration-aware no-transcript LLM plans reject raw model timing instead of fabricating bounded clips') &&
    slicerPlannerCheckSource.includes('transcript planning ignores legacy fixed target count and derives clip count from real continuous content groups') &&
    slicerPlannerCheckSource.includes('invalid LLM responses cannot fall back to deterministic no-transcript clips when transcript candidates exist') &&
    slicerPlannerCheckSource.includes('invalid LLM responses cannot fall back to weak transcript evidence that would fail native render readiness') &&
    slicerPlannerCheckSource.includes('LLM planning drops sparse review candidates whenever strong content-derived clips exist in the selected plan') &&
    slicerPlannerCheckSource.includes('LLM sparse-only selections fall back to the complete deterministic content group when one exists') &&
    slicerPlannerCheckSource.includes('LLM planning cannot omit a deterministic strong content-derived story to reduce the natural clip count') &&
    slicerPlannerCheckSource.includes('LLM planning cannot contaminate canonical strong content groups with model-invented blocking risks') &&
    slicePlannerSource.includes('filterLlmFallbackPlanToTranscriptEvidence') &&
    slicePlannerSource.includes('selectContentDerivedReleasePlan') &&
    slicePlannerSource.includes('selectCanonicalContentDerivedReleasePlan') &&
    slicePlannerSource.includes("clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired'") &&
    slicePlannerSource.includes("clip.publishabilityGrade !== 'reject'") &&
    slicePlannerSource.includes("clip.platformReadinessGrade !== 'reject'"),
  'slicePlanner.ts refuses to fabricate Smart Slice clips or raw LLM windows without real transcript content evidence',
);
assertRule(
  slicePlannerSource.includes('qualityScore') &&
    slicePlannerSource.includes('continuityScore') &&
    slicePlannerSource.includes('sourceStartMs') &&
    slicePlannerSource.includes('sourceEndMs') &&
    slicePlannerSource.includes('storyShape') &&
    slicePlannerSource.includes('inferTranscriptStoryShape') &&
    slicePlannerSource.includes('missing-payoff') &&
    slicePlannerSource.includes('createNormalizedSliceTimingMetadata') &&
    slicePlannerSource.includes('timing-metadata-repaired') &&
    slicePlannerSource.includes('createTranscriptSliceMetadata'),
  'slicePlanner.ts preserves explainable smart slicing metadata through deterministic normalization',
);
assertRule(
    slicePlannerSource.includes('endsWithWeakConnector') &&
    slicePlannerSource.includes('endsWithTerminalPunctuation') &&
    slicePlannerSource.includes('canTreatAsOpenSentence') &&
    slicePlannerSource.includes('selectOptimalSliceCandidateSet') &&
    slicePlannerSource.includes('calculateSliceCandidateSetScore') &&
    slicePlannerSource.includes('compareSliceCandidateSets') &&
    slicePlannerSource.includes('filterRepeatedTranscriptCandidates') &&
    slicePlannerSource.includes('areTranscriptSliceClipsRepeated') &&
    slicePlannerSource.includes('normalizeTranscriptTextForRepeatDetection') &&
    slicePlannerSource.includes('transcript-repeat-filtered') &&
    slicePlannerSource.includes('NON_PUBLISHABILITY_PENALTY_RISKS') &&
    slicePlannerSource.includes("'short-video'") &&
    slicePlannerSource.includes('trailing-connector-extended') &&
    slicePlannerSource.includes('open-sentence-extended') &&
    slicePlannerSource.includes('connector-repaired') &&
    slicePlannerSource.includes('findBestOverlappingTranscriptCandidate') &&
    slicePlannerSource.includes('calculateClipOverlapRatio') &&
    slicePlannerSource.includes('source-duration-tail') &&
    slicePlannerSource.includes('llm-timing-snapped-to-transcript') &&
    slicerPlannerCheckSource.includes('does not let one broad overlapping candidate crowd out multiple complete clips'),
  'slicePlanner.ts owns speech-to-text continuity repair and dynamic non-overlapping candidate selection instead of trusting partial LLM timings',
);
assertRule(
  slicerServiceSource.includes('audio silence evidence to match trusted audio activity padding') &&
    slicerServiceSource.includes('activity range to stay inside planned source range') &&
    slicerServiceSource.includes('explicit STT speechStartMs and speechEndMs before native rendering') &&
    slicerPlannerCheckSource.includes('audio cleanup refinement records only the remaining leading audio padding inside the final render window') &&
    slicerPlannerCheckSource.includes('audio cleanup refinement derives leading silence evidence from the final render window instead of stale native metadata') &&
    slicerPlannerCheckSource.includes('audio-only cleanup refuses to create sub-second clips from micro audio activity without STT speech boundaries') &&
    serviceBehaviorCheckSource.includes('smart slice professional completion gate rejects stale leading silence evidence before task completion') &&
    serviceBehaviorCheckSource.includes('smart slice native-render readiness gate rejects stale audio silence evidence after cleanup') &&
    serviceBehaviorCheckSource.includes('smart slice native-render readiness gate rejects audio-only post-cleanup plans without explicit STT speech boundaries'),
  'Smart Slice validates audio activity evidence, explicit STT speech boundaries, and derived silence padding consistently before native rendering and completion',
);
assertRule(
  slicerServiceSource.includes('assertSmartSliceTranscriptTimelineWithinSourceDuration') &&
    slicerServiceSource.includes('normalizeSmartSliceTranscriptTimelineForSourceDuration') &&
    slicerServiceSource.includes('MAX_SMART_SLICE_TRANSCRIPT_SOURCE_TAIL_REPAIR_MS') &&
    slicerServiceSource.includes("'clip planning'") &&
    slicerServiceSource.includes("'native rendering'") &&
    serviceBehaviorCheckSource.includes('video slice workflow exposes the source-bounded final STT segment as a content unit before ID-only LLM review') &&
    serviceBehaviorCheckSource.includes('smart slice native-render readiness gate repairs bounded final STT tail timestamp drift consistently with clip planning') &&
    serviceBehaviorCheckSource.includes('video slice workflow does not prompt the LLM with out-of-source STT timestamp evidence') &&
    serviceBehaviorCheckSource.includes('smart slice native-render readiness gate rejects STT segments that extend beyond imported media duration'),
  'Smart Slice repairs bounded final STT tail timestamp drift, then validates source-duration consistency before LLM planning and again before native rendering',
);
assertRule(
  slicePlannerSource.includes('MAX_LLM_PLAN_ITEMS_TO_INSPECT') &&
    slicePlannerSource.includes('Number(durationMs) <= 0') &&
    slicerPlannerCheckSource.includes('LLM parsing rejects dirty raw timing survivors when no transcript candidate evidence exists'),
  'slicePlanner.ts rejects invalid or unsupported raw LLM timing when transcript evidence is absent',
);
assertRule(
  /clip\.durationMs\s*>\s*0/u.test(slicePlannerSource) &&
    slicerPlannerCheckSource.includes('candidate normalization rejects non-positive durations'),
  'slicePlanner.ts rejects non-positive candidate durations at the shared normalization boundary',
);
assertRule(
    !slicerServiceSource.includes('llm-timing-snapped-to-transcript') &&
    !slicerServiceSource.includes('trailing-connector-extended') &&
    !slicerServiceSource.includes('filterRepeatedTranscriptCandidates') &&
    !slicerServiceSource.includes('areTranscriptSliceClipsRepeated') &&
    !slicerServiceSource.includes('normalizeTranscriptTextForRepeatDetection') &&
    !slicerServiceSource.includes('NON_PUBLISHABILITY_PENALTY_RISKS') &&
    !slicerServiceSource.includes('endsWithWeakConnector'),
  'slicerService.ts does not duplicate speech-to-text continuity repair, repeat filtering, or publishability scoring outside the planner kernel',
);
assertRule(
    slicerServiceSource.includes('function toNativeSliceClipRequest') &&
    slicerServiceSource.includes('clips: nativeClips') &&
    slicerServiceSource.includes('mergedPlannedClips.map((clip) => toNativeSliceClipRequest(clip, transcriptSegments, params))') &&
    slicerServiceSource.includes('clipTranscriptText ? { transcriptText: clipTranscriptText }') &&
    slicerServiceSource.includes('clipTranscriptSegments.length ? { transcriptSegments: clipTranscriptSegments }') &&
    slicerServiceSource.includes('renderClip.risks ? { risks: renderClip.risks }') &&
    slicerServiceSource.includes('sourceSegments: renderClip.sourceSegments') &&
    slicerServiceSource.includes('renderedDurationMs: renderClip.renderedDurationMs') &&
    slicerServiceSource.includes('removedSilenceMs: renderClip.removedSilenceMs') &&
    slicerServiceSource.includes('params.enableCoughFilter === true') &&
    slicerServiceSource.includes('audioMuteRanges.length ? { audioMuteRanges }') &&
    slicerServiceSource.includes('assertNativeSliceTimingMatchesPlan') &&
    slicerServiceSource.includes('assertNativeSlicePathInsideTaskOutputDir') &&
    slicerServiceSource.includes('assertNativeSliceTaskOutputDirMatchesResult') &&
    serviceBehaviorCheckSource.includes('video slice native escaped artifact containment') &&
    slicerServiceSource.includes('nativeSlice.startMs !== plannedClip.startMs || nativeSlice.durationMs !== expectedDurationMs') &&
    slicerServiceSource.includes('expectedSourceSegments.reduce') &&
    slicerServiceSource.includes('plannedClips[index]') &&
    slicerServiceSource.includes('storyShape: plannedClip.storyShape') &&
    nativeMediaRuntimeSource.includes('-filter_complex') &&
    nativeMediaRuntimeSource.includes('concat=n={}:v=1:a=1[vcat][acat]'),
  'slicerService.ts separates explainable planning metadata from native slice rendering requests, embeds STT evidence, and rejects mismatched native timing or escaped output paths',
);
assertRule(
  nativeMediaRuntimeSource.includes('pub transcript_text: Option<String>') &&
    nativeMediaRuntimeSource.includes('pub transcript_segments: Option<Vec<AutoCutSpeechTranscriptionSegment>>') &&
    nativeMediaRuntimeSource.includes('transcript_text: slice_output.clip.transcript_text.clone()') &&
    nativeMediaRuntimeSource.includes('transcript_segments: slice_output.clip.transcript_segments.clone()') &&
    nativeMediaRuntimeSource.includes('audio_cleanup_profile: slice_output.clip.audio_cleanup_profile.clone()') &&
    nativeMediaRuntimeSource.includes('noise_reduction_applied: slice_output.clip.noise_reduction_applied') &&
    nativeMediaRuntimeSource.includes('leading_silence_trim_ms: slice_output.clip.leading_silence_trim_ms') &&
    nativeMediaRuntimeSource.includes('tail_treatment: slice_output.clip.tail_treatment.clone()') &&
    nativeMediaRuntimeSource.includes('risks: slice_output.clip.risks.clone()') &&
    nativeMediaRuntimeSource.includes('Opening transcript survives native task output.') &&
    nativeMediaRuntimeSource.includes('"slice task output JSON must persist structured slice-level transcript segments"'),
  'media_runtime.rs persists native smart-slice speech-to-text and audio cleanup evidence in ops_task output_json sliceResults',
);
assertRule(
  nativeHostClientServiceSource.includes('risks?: string[]') &&
    tasksServiceSource.includes('readAutoCutSliceRisks') &&
    tasksServiceSource.includes('recoveryEvidence.risks') &&
    serviceBehaviorCheckSource.includes('video slice native workflow sends successful audio boundary refinement evidence to native rendering'),
  'native smart-slice request, artifact, task recovery, and service behavior contracts preserve slice review risks',
);
assertRule(
  taskDetailPageSource.includes('AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG') &&
    taskDetailPageSource.includes('getSmartSliceReviewRiskDefinition') &&
    taskDetailPageSource.includes('taskDetail.reviewRisk.title') &&
    i18nResourcesServiceSource.includes('AUTOCUT_TASK_DETAIL_REVIEW_RISK_ZH_CN_MESSAGES') &&
    i18nResourcesServiceSource.includes('AUTOCUT_TASK_DETAIL_REVIEW_RISK_EN_US_MESSAGES') &&
    smartSliceTaskEvidenceCheckSource.includes('reviewWarnings') &&
    smartSliceTaskEvidenceCheckSource.includes('AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG') &&
    smartSliceQualityEvidenceSource.includes('reviewWarnings') &&
    smartSliceQualityEvidenceSource.includes('AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG') &&
    smartSliceSampleEvidenceSource.includes('reviewWarnings: taskValidation.reviewWarnings') &&
    smartSliceSampleEvidenceSource.includes('reviewWarnings: quality.evidence.reviewWarnings') &&
    smartSliceReleaseFixtureCheckSource.includes('reviewWarningSlices: taskValidation.summary.reviewWarningSlices') &&
    smartSliceReleaseFixtureCheckSource.includes('reviewWarnings: taskValidation.reviewWarnings') &&
    smartSliceReleaseFixtureCheckSource.includes('reviewWarnings: result.evidence.reviewWarnings'),
  'smart-slice review risks are catalog-driven, localized in task detail, and exported as non-blocking task, quality, sample, and release fixture evidence warnings',
);
assertRule(
  tasksServiceSource.includes('transcriptCorrection: {') &&
    tasksServiceSource.includes("source: 'task-detail'") &&
    tasksServiceSource.includes('originalTranscriptText') &&
    tasksServiceSource.includes('countChangedTranscriptSegments') &&
    tasksServiceSource.includes('transcriptCorrection: localSlice.transcriptCorrection') &&
    taskDetailPageSource.includes('selectedSlice.transcriptCorrection') &&
    smartSliceTaskEvidenceCheckSource.includes('SMART_SLICE_TASK_TRANSCRIPT_CORRECTION_AUDIT_INVALID') &&
    smartSliceQualityEvidenceSource.includes('correctedTranscriptSlices') &&
    serviceBehaviorCheckSource.includes('preserves transcript correction audit metadata after native task recovery merge'),
  'manual smart-slice transcript corrections are audited, visible, preserved through native recovery, and covered by release evidence gates',
);
assertRule(
  !slicerServiceSource.includes('function normalizeCandidateSlicePlan') &&
    !slicerServiceSource.includes('function buildTranscriptSliceCandidates') &&
    !slicerServiceSource.includes('function parseLlmSlicePlan'),
  'slicerService.ts does not own the slice planning kernel',
);
assertRule(
  !slicerServiceSource.includes('isSmartSlicePlanEquivalentToFallback') &&
    !slicerServiceSource.includes('markSmartSliceFallbackPlan') &&
    !slicerServiceSource.includes('parseLlmSlicePlan(result.content, planningParams, fallbackPlan, transcriptCandidates)') &&
    smartCutEnginePlannerSource.includes('LLM reviewer returned invalid JSON') &&
    smartCutEnginePlannerSource.includes('Smart Cut Engine will block if review coverage is incomplete'),
  'slicerService.ts no longer preserves legacy LLM fallback planning; Smart Cut Engine blocks incomplete or invalid review evidence',
);
assertRule(!slicerServiceSource.includes('createSampleSliceResults'), 'slicerService.ts does not generate fake slice result lists');
assertRule(!slicerServiceSource.includes('getAutoCutSampleSliceThumbnailUrl'), 'slicerService.ts does not assign sample thumbnails to generated slices');
assertRule(!slicerServiceSource.includes('simulateTaskProgress'), 'slicerService.ts does not simulate automatic video slicing completion');
assertRule(
  slicerServiceSource.includes('createSmartSliceNativePreflightErrorMessage') &&
    slicerServiceSource.includes("reportVideoSliceStageDiagnostic('native preflight failed'") &&
    slicerServiceSource.includes('return await failAutoCutProcessingTask(task.id, errorMessage)'),
  'slicerService.ts fails closed with a smart-slice-specific native preflight message when trusted local slicing is unavailable',
);
assertRule(
  slicerServiceSource.includes('plannedClips.length === 0') &&
    slicerServiceSource.includes('trustedSourceDurationMs !== undefined && trustedSourceDurationMs < 5_000') &&
    !slicerServiceSource.includes('resolveTranscriptPlanningDurationMs') &&
    slicerServiceSource.includes('source video is too short') &&
    serviceBehaviorCheckSource.includes('source media that is shorter than the minimum renderable slice') &&
    serviceBehaviorCheckSource.includes('renders a short speech-aligned clip when imported media duration is unknown but STT has verified speech evidence') &&
    serviceBehaviorCheckSource.includes('keeps unknown-duration short transcript clips above the speech-aligned minimum without padding them to the requested duration') &&
    serviceBehaviorCheckSource.includes('calls native slicing for isolated micro speech when STT evidence is verified') &&
    serviceBehaviorCheckSource.includes('labels sparse transcript Smart Cut Engine candidates for ID-only LLM review') &&
    serviceBehaviorCheckSource.includes('removes repeated speech-to-text candidates before asking the Smart Cut Engine LLM reviewer') &&
    serviceBehaviorCheckSource.includes('records repeated transcript filtering on task slice results') &&
    slicerPlannerCheckSource.includes('creates reviewable speech-backed clips from isolated micro speech') &&
    slicerPlannerCheckSource.includes('English connector-chain speech-to-text planning') &&
    slicerPlannerCheckSource.includes('preserves transcript repeat-filtering risks') &&
    serviceBehaviorCheckSource.includes('does not call the LLM planner when the source media is too short'),
  'slicerService.ts fails closed only for impossible source media and preserves STT-first sparse transcript fallback, trim, and repeat-filter standards',
);
const extractorTextServiceSource = fs.existsSync(path.join(rootDir, 'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts'))
  ? fs.readFileSync(path.join(rootDir, 'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts'), 'utf8')
  : '';
assertRule(
  slicerServiceSource.includes('transcribeAutoCutMediaWithConfiguredProvider') &&
    slicerServiceSource.includes('sttPresetId: params.sttPresetId') &&
    slicerServiceSource.includes('sttPresetId: transcription.sttPresetId') &&
    slicerServiceSource.includes('executionProfile: transcription.executionProfile') &&
    slicerServiceSource.includes('sttPresetId: params.sttPresetId') &&
    !slicerServiceSource.includes('nativeHostClient.transcribeMedia') &&
    !slicerServiceSource.includes('executablePath: speechRuntimeConfig.executablePath') &&
    extractorTextServiceSource.includes('transcribeAutoCutMediaWithConfiguredProvider') &&
    !extractorTextServiceSource.includes('nativeHostClient.transcribeMedia') &&
    !extractorTextServiceSource.includes('executablePath: speechRuntimeConfig.executablePath'),
  'slicer and extractor-text workflows use the STT provider boundary instead of direct native Whisper toolchain coupling',
);
assertRule(
  slicerServiceSource.includes('sttPresetId: params.sttPresetId') &&
    slicerServiceSource.includes('createSerializableSmartSliceParams') &&
    slicerServiceSource.includes('sttPresetId: params.sttPresetId') &&
    slicerServiceSource.includes('sttPresetId: transcription.sttPresetId') &&
    slicerServiceSource.includes('executionProfile: transcription.executionProfile'),
  'Smart Slice persists the selected STT workflow preset through execution params, checkpoint replay, and task evidence JSON',
);
assertRule(
  extractorTextServiceSource.includes('normalizeExtractedTranscriptText') &&
    extractorTextServiceSource.includes("format !== 'filtered'") &&
    extractorTextServiceSource.includes('trailingPunctuation') &&
    serviceBehaviorCheckSource.includes('extractor text raw mode preserves native speech-to-text filler words') &&
    serviceBehaviorCheckSource.includes('extractor text filtered mode removes redundant filler words from native speech-to-text') &&
    serviceBehaviorCheckSource.includes('extractor text filtered mode removes pure filler speech segments'),
  'extractorTextService.ts implements real raw/filtered local speech-to-text transcript cleanup instead of ignoring the UI format option',
);
for (const relativePath of realProcessingServicePaths) {
  const source = exists(relativePath) ? fs.readFileSync(path.join(rootDir, relativePath), 'utf8') : '';
  assertRule(exists(relativePath), `${relativePath} exists as a canonical processing service`);
  assertRule(!source.includes('simulateTaskProgress'), `${relativePath} does not simulate task progress`);
  assertRule(!source.includes('getAutoCutSampleVideoUrl'), `${relativePath} does not use sample video URLs as generated output`);
  assertRule(!source.includes('getAutoCutSampleAudioUrl'), `${relativePath} does not use sample audio URLs as generated output`);
  assertRule(!source.includes('getAutoCutSampleGifUrl'), `${relativePath} does not use sample GIF URLs as generated output`);
  assertRule(!source.includes('getAutoCutSampleSliceThumbnailUrl'), `${relativePath} does not use sample thumbnails as generated output`);
  assertRule(!source.includes('createFallbackExtractedText'), `${relativePath} does not create fallback transcript text`);
  assertRule(!source.includes('SIMULATED_'), `${relativePath} does not persist simulated media metadata`);
  assertRule(
    source.includes('failAutoCutUnsupportedNativeProcessingTask') ||
      (
        relativePath === 'packages/sdkwork-autocut-slicer/src/service/slicerService.ts' &&
        source.includes('createSmartSliceNativePreflightErrorMessage')
      ),
    `${relativePath} fails closed when real native processing is unavailable`,
  );
  if (
    relativePath !== 'packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts' &&
    relativePath !== 'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts'
  ) {
    assertRule(
      source.includes('failAutoCutProcessingTask('),
      `${relativePath} rejects native command failures instead of returning success`,
    );
    if (relativePath === 'packages/sdkwork-autocut-slicer/src/service/slicerService.ts') {
      assertRule(
        source.includes('createVideoSliceFailureDiagnostics(error)'),
        `${relativePath} persists smart-slice failure diagnostics with stack traces`,
      );
    }
  }
}
assertRule(!exists('packages/sdkwork-autocut-services/src/service/simulation.service.ts'), 'shared services no longer expose simulated task progress helpers');
assertRule(
  !servicesIndexSource.includes("export * from './service/simulation.service'"),
  'services index does not export simulated task progress helpers',
);
assertRule(
  exists(requiredTrustedFileSourcePath),
  '@sdkwork/autocut-commons defines canonical trusted-file-source.service.ts',
);
for (const marker of requiredTrustedFileSourceMarkers) {
  assertRule(trustedFileSourceSource.includes(marker), `trusted-file-source.service.ts exposes ${marker}`);
}
assertRule(
  desktopMainSource.includes('configureDesktopNativeHostClient'),
  'desktop main.tsx configures the native host client before rendering React',
);
assertRule(
  desktopMainSource.includes('configureAutoCutRuntimeEnvironment') &&
    desktopMainSource.includes("import.meta.env.DEV ? 'dev' : 'release'"),
  'desktop main.tsx configures the AutoCut runtime environment from the Vite dev/release mode',
);
assertRule(
  desktopMainSource.search(/configureAutoCutRuntimeEnvironment\(/u) >= 0 &&
    desktopMainSource.search(/configureDesktopNativeHostClient\(/u) >= 0 &&
    desktopMainSource.search(/configureAutoCutRuntimeEnvironment\(/u) < desktopMainSource.search(/configureDesktopNativeHostClient\(/u),
  'desktop main.tsx configures runtime environment before native host setup',
);
assertRule(
  desktopNativeHostSource.includes('isTauri') &&
    desktopNativeHostSource.includes('invoke as AutoCutNativeInvoke') &&
    desktopNativeHostSource.includes('createAutoCutNativeHostClient') &&
    desktopNativeHostSource.includes('configureAutoCutNativeHostClient'),
  'desktop native-host.ts adapts the Tauri v2 module invoke API into the canonical native host client',
);
assertRule(
  desktopNativeHostSource.includes('recoverNativeTasks') && desktopNativeHostSource.includes('limit: 100'),
  'desktop native-host.ts triggers native task recovery during native host setup',
);
assertRule(
  desktopNativeHostSource.includes('recoverNativeTasks') && desktopNativeHostSource.includes('.catch('),
  'desktop native-host.ts handles native task recovery startup failures without unhandled promises',
);
assertRule(
  desktopNativeHostSource.includes("from '@tauri-apps/api/core'") &&
    desktopNativeHostSource.includes('convertFileSrc') &&
    desktopNativeHostSource.includes('createAssetUrl') &&
    desktopNativeHostSource.includes('allowLocalMediaPreviewDirectory'),
  'desktop native-host.ts converts native artifact paths through the Tauri asset protocol and grants trusted preview scopes',
);
assertRule(
  desktopNativeHostSource.includes("from '@tauri-apps/api/webview'") &&
    desktopNativeHostSource.includes("from '@sdkwork/autocut-commons'") &&
    desktopNativeHostSource.includes('getCurrentWebview') &&
    desktopNativeHostSource.includes('onDragDropEvent') &&
    desktopNativeHostSource.includes('dispatchAutoCutTrustedFileSourceDrop'),
  'desktop native-host.ts bridges Tauri webview drag-drop paths into the trusted file source service',
);
for (const marker of [
  "import ts from 'typescript'",
  'transpileLocalModule',
  'rewriteLocalModuleSpecifiers',
  'collectLocalModuleGraph',
  'resolveExternalModuleSpecifier',
  'resetAutoCutNativeHostClient',
  'native host fallback reports browser host kind',
  'native host fallback task recovery',
  'native host client invokes the media import command',
  'native host client invokes the local file describe command',
  'native host client invokes the local directory chooser command',
  'native host client invokes the local media preview directory authorization command',
  'native host client passes directoryPath under the Tauri preview authorization request argument',
  'native host client passes assetUuid under the Tauri request argument',
  'native host client invokes the assetUuid video GIF command',
  'native host client invokes the assetUuid video compression command',
  'native host client invokes the assetUuid video conversion command',
  'native host client invokes the assetUuid video enhancement command',
  'native host client invokes the native task query command',
  'native host client invokes the native task cancel command',
  'native host client invokes the native task recovery command',
  'native host client invokes the native task retry command',
  'structured native task event payload operation',
  'structured native task event payload phase',
  'structured native task event payload source',
  'structured native task event payload progress',
  'raw native task event payloadJson for audits',
  'native worker lease readiness',
  'native worker lease workerId',
  'native worker lease status',
  'trusted file source bridge creates a File-compatible trusted local file',
  'extractor audio native workflow imports local media before extraction',
  'extractor audio native workflow converts native artifact paths to safe asset URLs',
  'video GIF native workflow imports local media before generation',
  'video GIF native workflow converts native artifact paths to safe asset URLs',
  'video compress native workflow imports local media before compression',
  'video compress native workflow converts native artifact paths to safe asset URLs',
  'video convert native workflow imports local media before conversion',
  'video convert native workflow converts native artifact paths to safe asset URLs',
  'video enhance native workflow imports local media before enhancement',
  'video enhance native workflow converts native artifact paths to safe asset URLs',
  'createNativeTaskOutputArtifact',
  'assertNativeTaskOutputArtifact',
  'D:/autocut/media',
  '`${outputRootDir}/tasks/${expectedTaskUuid}`',
  'createAutoCutTaskId',
  'D:/autocut-configured-output',
  'configured output directory to media import',
  'configured output directory to audio extraction',
  'taskOutputDir',
  'stores the artifact inside its task output directory',
]) {
  assertRule(
    serviceBehaviorCheckSource.includes(marker),
    `service behavior check covers native host client marker ${marker}`,
  );
}
assertRule(
  !serviceBehaviorCheckSource.includes("from 'vite'") &&
    !serviceBehaviorCheckSource.includes('createServer') &&
    !serviceBehaviorCheckSource.includes('ssrLoadModule') &&
    !serviceBehaviorCheckSource.includes("from 'node:child_process'") &&
    !serviceBehaviorCheckSource.includes('childProcess.exec'),
  'service behavior check loads TypeScript contracts without Vite, esbuild, or child_process spawn dependencies',
);
assertRule(
  !serviceIndexSource.includes("from '@sdkwork/autocut-commons'"),
  '@sdkwork/autocut-services does not re-export commons UI/source bridge APIs',
);
assertRule(
  !viteConfigSource.includes('^@sdkwork\\/([^/]+)$'),
  'Vite config does not expose broad @sdkwork/* workspace alias',
);
assertRule(!viteConfigSource.includes("find: '@'"), 'Vite config does not expose @ root source alias');
assertRule(
  viteConfigSource.includes('^@sdkwork\\/autocut-([^/]+)$') &&
    viteConfigSource.includes('../sdkwork-autocut-$1/src/index.ts'),
  'Vite config exposes only the @sdkwork/autocut-* package alias',
);
assertRule(viteConfigSource.includes('manualChunks'), 'Vite config defines standard manual chunks for commercial desktop startup performance');
assertRule(viteConfigSource.includes("find: 'react/jsx-runtime'"), 'Vite config aliases react/jsx-runtime to the desktop app dependency so workspace source packages build without per-package node_modules links');
assertRule(viteConfigSource.includes("find: 'react'"), 'Vite config aliases react to the desktop app dependency for one React runtime across workspace UI packages');
assertRule(viteConfigSource.includes('autocut-pixi'), 'Vite config isolates Pixi rendering runtime into a stable manual chunk');
assertRule(viteConfigSource.includes('autocut-ai'), 'Vite config isolates Vercel AI SDK runtime into a stable manual chunk');
assertRule(viteConfigSource.includes('autocut-feature-'), 'Vite config groups internal AutoCut feature packages into stable manual chunks');

const usedExternalCatalogNames = new Set([
  ...Object.keys(allRootDeps),
  ...Object.keys(allDesktopDeps),
]);

function parseStaticImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const specs = [];
  const patterns = [
    /(?:^|[\n\r;])\s*import\s+[^'"\n\r;]*\s+from\s+['"]([^'"]+)['"]/g,
    /(?:^|[\n\r;])\s*import\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function dependencyName(importSpecifier) {
  if (importSpecifier.startsWith('@')) {
    return importSpecifier.split('/').slice(0, 2).join('/');
  }
  return importSpecifier.split('/')[0];
}

for (const packageDirent of packageDirs) {
  const dirName = packageDirent.name;
  const moduleName = dirName.replace(/^sdkwork-autocut-/, '');
  const packagePath = path.join(packagesDir, dirName);
  const manifestPath = path.join(packagePath, 'package.json');
  const manifest = readJson(manifestPath);

  assertRule(/^sdkwork-autocut-[a-z0-9-]+$/.test(dirName), `${dirName} uses sdkwork-autocut-* directory naming`);
  assertRule(manifest.name === `${internalPrefix}${moduleName}`, `${dirName} manifest name is ${internalPrefix}${moduleName}`);
  assertRule(manifest.version === rootPackage.version, `${manifest.name} version matches the root AutoCut desktop version`);
  assertRule(manifest.private === true, `${manifest.name} is private`);
  assertRule(manifest.type === 'module', `${manifest.name} is type module`);
  assertRule(manifest.main === './src/index.ts', `${manifest.name} main points to ./src/index.ts`);
  assertRule(manifest.module === './src/index.ts', `${manifest.name} module points to ./src/index.ts`);
  assertRule(manifest.types === './src/index.ts', `${manifest.name} types points to ./src/index.ts`);
  assertRule(manifest.exports?.['.']?.import === './src/index.ts', `${manifest.name} exports import points to ./src/index.ts`);
  assertRule(manifest.exports?.['.']?.types === './src/index.ts', `${manifest.name} exports types points to ./src/index.ts`);
  if (dirName === desktopPackageName) {
    assertRule(manifest.scripts?.build === 'node ../../scripts/run-autocut-vite.mjs build', `${manifest.name} build script uses the stable AutoCut Vite runner`);
    assertRule(manifest.scripts?.dev?.startsWith('node ../../scripts/run-autocut-vite.mjs '), `${manifest.name} dev script uses the stable AutoCut Vite runner`);
    assertRule(
      manifest.scripts?.['tauri:dev']?.startsWith('node ../../scripts/ensure-autocut-tauri-rust-toolchain.mjs && '),
      `${manifest.name} tauri:dev verifies the pinned Rust toolchain before launching Tauri`,
    );
    assertRule(
      manifest.scripts?.['tauri:build']?.startsWith('node ../../scripts/ensure-autocut-tauri-rust-toolchain.mjs && '),
      `${manifest.name} tauri:build verifies the pinned Rust toolchain before packaging Tauri`,
    );
    assertRule(
      manifest.scripts?.['tauri:build']?.includes('node ../../scripts/prepare-autocut-speech-sidecar.mjs --check --require-bundled && '),
      `${manifest.name} tauri:build requires an integrity-verified bundled Whisper CLI sidecar before packaging Tauri`,
    );
    assertRule(manifest.scripts?.['tauri:build']?.endsWith('pnpm exec tauri build'), `${manifest.name} tauri:build runs the package-local Tauri CLI`);
    assertRule(fs.existsSync(path.join(packagePath, 'index.html')), `${manifest.name} owns index.html`);
    assertRule(fs.existsSync(path.join(packagePath, 'vite.config.ts')), `${manifest.name} owns vite.config.ts`);
    assertRule(fs.existsSync(path.join(packagePath, 'src-tauri', 'tauri.conf.json')), `${manifest.name} owns src-tauri/tauri.conf.json`);
  } else {
    assertRule(manifest.scripts?.build === 'tsc --noEmit', `${manifest.name} build script is tsc --noEmit`);
  }
  assertRule(manifest.scripts?.typecheck === 'tsc --noEmit', `${manifest.name} typecheck script is tsc --noEmit`);
  assertRule(manifest.scripts?.test === 'tsc --noEmit', `${manifest.name} test script is tsc --noEmit`);
  assertRule(fs.existsSync(path.join(packagePath, 'tsconfig.json')), `${manifest.name} has package-local tsconfig.json`);
  const packageTsconfig = readJson(path.join(packagePath, 'tsconfig.json'));
  assertRule(packageTsconfig.extends === '../../tsconfig.json', `${manifest.name} package tsconfig inherits the root strict TypeScript baseline`);
  if (dirName === desktopPackageName) {
    assertRule(
      JSON.stringify(packageTsconfig.include) === JSON.stringify(['src', 'vite.config.ts']),
      `${manifest.name} package tsconfig checks desktop src and package-local Vite config`,
    );
  } else {
    assertRule(
      JSON.stringify(packageTsconfig.include) === JSON.stringify(['src']),
      `${manifest.name} package tsconfig checks only its source boundary`,
    );
  }
  assertRule(fs.existsSync(path.join(packagePath, 'src', 'index.ts')), `${manifest.name} has src/index.ts`);

  const allDeps = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };
  for (const [depName, version] of Object.entries(allDeps)) {
    if (depName.startsWith(internalPrefix)) {
      assertRule(version === 'workspace:*', `${manifest.name} depends on ${depName} with workspace:*`);
    } else {
      assertRule(version === 'catalog:', `${manifest.name} external dependency ${depName} uses pnpm catalog version`);
      usedExternalCatalogNames.add(depName);
      assertRule(workspaceCatalogNames.has(depName), `pnpm catalog declares ${manifest.name} external dependency ${depName}`);
    }
  }

  const packageSourceFiles = listFiles(path.join(packagePath, 'src'), (file) => /\.(ts|tsx)$/.test(file));
  for (const file of packageSourceFiles) {
    const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
    const sourceText = fs.readFileSync(file, 'utf8');
    const packageRelative = path.relative(path.join(packagePath, 'src'), file).replaceAll(path.sep, '/');
    const isPageSource = packageRelative.startsWith('pages/');
    const isServiceSource = packageRelative.startsWith('service/');
    if (!packageRelative.includes('/') && dirName !== desktopPackageName) {
      assertRule(packageRelative === 'index.ts', `${manifest.name} keeps root src source file ${packageRelative} limited to public index.ts`);
    }

    const isDiagnosticsService = relative === 'packages/sdkwork-autocut-services/src/service/diagnostics.service.ts';
    const isEventService = relative === 'packages/sdkwork-autocut-services/src/service/events.service.ts';
    const isSpeechTranscriptionProviderService =
      relative === 'packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts';
    const isIdentityService = relative === 'packages/sdkwork-autocut-services/src/service/identity.service.ts';
    const isStorageService = relative === requiredStorageServicePath;
    const isNativeHostClientService = relative === requiredNativeHostClientServicePath;
    const isNativeHostCommandConsumerService = isNativeHostClientService || relative === requiredSlicerServicePath;
    const isDownloadService = relative === requiredDownloadServicePath;
    const isProcessingSourceService = relative === requiredProcessingSourceServicePath;
    const isMediaFixturesService = relative === requiredMediaFixturesServicePath;
    const isDatetimeService = relative === requiredDatetimeServicePath;
    const isTypesSource = relative === 'packages/sdkwork-autocut-types/src/index.ts';
    assertNoForbiddenSourcePatterns(relative, sourceText);
    assertNoTypeScriptNonNullAssertions(relative, sourceText);
    assertRule(
      isDiagnosticsService || !/console\.(log|warn|error)\(/.test(sourceText),
      `${relative} reports diagnostics through the AutoCut diagnostics service`,
    );
    assertRule(!sourceText.includes('component: any'), `${relative} does not expose component as any`);
    assertRule(!sourceText.includes('const handleUpdate = (e: any)'), `${relative} types task update event handlers without any`);
    assertRule(!sourceText.includes('const handleDelete = (e: any)'), `${relative} types task delete event handlers without any`);
    assertRule(!/\bany\b/.test(sourceText), `${relative} does not use any in package source`);
    const hasRawTaskStatusReference =
      /\btask\.status\s*(?:===|!==)\s*['"](pending|processing|completed|failed)['"]/u.test(sourceText) ||
      /\b(?:newTask|updatedTask|localTask)\.status\s*(?:===|!==)\s*['"](pending|processing|completed|failed)['"]/u.test(sourceText) ||
      [...sourceText.matchAll(/\bstatus\s*:\s*['"](pending|processing|completed|failed)['"][\s\S]{0,120}\b(?:progressMessage|errorMessage|completedAt|nativeTaskId|resultCount)\b/gu)]
        .some((match) => {
          const context = sourceText.slice(Math.max(0, match.index - 120), match.index + 260);
          return !/\beventType\s*:/u.test(context) && !/\bstep\s*,/u.test(context);
        });
    assertRule(
      isTypesSource || !hasRawTaskStatusReference,
      `${relative} references task statuses through AUTOCUT_TASK_STATUS`,
    );
    assertRule(
      isDownloadService || !/new\s+Blob\(/u.test(sourceText),
      `${relative} delegates file blob creation to AutoCut service helpers`,
    );
    assertRule(
      isDownloadService || !/URL\.createObjectURL\(/u.test(sourceText),
      `${relative} delegates object URL creation to AutoCut service helpers`,
    );
    assertRule(
      isDownloadService || !/URL\.revokeObjectURL\(/u.test(sourceText),
      `${relative} delegates object URL revocation to AutoCut service helpers`,
    );
    assertRule(
      !isPageSource || !/document\.createElement\(\s*['"]a['"]\s*\)/u.test(sourceText),
      `${relative} delegates browser download anchors to AutoCut service helpers`,
    );
    assertRule(
      !isPageSource || !/\bconfirm\(/u.test(sourceText),
      `${relative} delegates confirmation dialogs to AutoCut browser service helpers`,
    );
    assertRule(
      !isPageSource || !/navigator\.clipboard/u.test(sourceText),
      `${relative} delegates clipboard writes to AutoCut browser service helpers`,
    );
    assertRule(
      !isPageSource || !/window\.open\(/u.test(sourceText),
      `${relative} delegates external preview windows to AutoCut browser service helpers`,
    );
    assertRule(
      !relative.endsWith('Page.tsx') ||
        sourceText.includes('useAutoCutTranslation') ||
        sourceText.includes('useAutoCutCommonLabels') ||
        sourceText.includes('useTranslation') ||
        sourceText.includes('listenAutoCutI18nLanguageChanged'),
      `${relative} subscribes to i18n language changes so visible route copy updates immediately`,
    );
    assertRule(
      !isServiceSource || isIdentityService || !/Date\.now\(\)/u.test(sourceText),
      `${relative} delegates service IDs and relative timestamps to AutoCut identity helpers`,
    );
    assertRule(
      !isServiceSource || isIdentityService || !/new Date\(\)\.toISOString\(\)/u.test(sourceText),
      `${relative} delegates service timestamps to AutoCut identity helpers`,
    );
    assertRule(
      isIdentityService || isDatetimeService || !/\bnew Date\(/u.test(sourceText),
      `${relative} delegates timestamp parsing and formatting to datetime.service.ts`,
    );
    assertRule(
      isDatetimeService || !/Date\.parse\(/u.test(sourceText),
      `${relative} delegates timestamp parsing to datetime.service.ts`,
    );
    assertRule(
      isDatetimeService || !/\.getTime\(\)/u.test(sourceText),
      `${relative} delegates timestamp millisecond conversion to datetime.service.ts`,
    );
    assertRule(
      !isServiceSource ||
        isDatetimeService ||
        !/\.sort\([\s\S]{0,320}\b(?:createdAt|updatedAt|completedAt|timestamp|Date\.parse|new Date|getTime)\b/u.test(sourceText),
      `${relative} delegates service datetime sorting to datetime.service.ts`,
    );
    assertRule(
      isDatetimeService || !/\.toLocaleString\(/u.test(sourceText),
      `${relative} delegates localized datetime formatting to datetime.service.ts`,
    );
    assertRule(
      isStorageService || !/\b(?:localStorage|sessionStorage)\b/u.test(sourceText),
      `${relative} accesses browser key-value storage only through storage.service.ts`,
    );
    assertRule(
      isStorageService || isNativeHostCommandConsumerService || !/['"]autocut_[a-z0-9_-]+['"]/u.test(sourceText),
      `${relative} builds AutoCut browser storage keys only through storage.service.ts`,
    );
    for (const pattern of forbiddenRemoteFixtureUrlPatterns) {
      assertRule(
        !pattern.test(sourceText),
        `${relative} does not reference third-party remote fixture media`,
      );
    }
    const hasAutocutEventString = /['"]autocut-[a-z-]+['"]/.test(sourceText) &&
      !/['"]autocut:\/\/[^'"]+['"]/.test(sourceText);
    assertRule(
      !hasAutocutEventString || isEventService || isSpeechTranscriptionProviderService,
      `${relative} references AutoCut events through canonical service helpers`,
    );
    const hasAutocutCustomEventDispatch =
      /window\.dispatchEvent\(\s*new\s+CustomEvent/u.test(sourceText) ||
      /dispatchEvent\(\s*new\s+CustomEvent\s*\(\s*AUTOCUT_EVENTS/u.test(sourceText);
    assertRule(!hasAutocutCustomEventDispatch || isEventService, `${relative} dispatches AutoCut custom events only through events.service.ts`);
    const hasAutocutEventListener =
      /window\.addEventListener\(\s*AUTOCUT_EVENTS/u.test(sourceText) ||
      /window\.removeEventListener\(\s*AUTOCUT_EVENTS/u.test(sourceText);
    assertRule(!hasAutocutEventListener || isEventService, `${relative} binds AutoCut custom events only through events.service.ts`);
    assertRule(!sourceText.includes(' as EventListener'), `${relative} does not cast AutoCut event handlers with as EventListener`);
    if (relative.includes('/src/service/') && !isProcessingSourceService && /export\s+async\s+function\s+process/u.test(sourceText)) {
      assertRule(
        sourceText.includes('validateAutoCutProcessingSource'),
        `${relative} validates source media through processing-source.service.ts before creating tasks`,
      );
    }
    const importsAddAssetFromSharedServices =
      /import\s*\{[^}]*\baddAsset\b[^}]*\}\s*from\s*['"]@sdkwork\/autocut-services['"]/u.test(sourceText);
    assertRule(!isPageSource || !importsAddAssetFromSharedServices, `${relative} delegates asset creation to AutoCut service workflow functions`);

    for (const importSpecifier of parseStaticImports(file)) {
      if (importSpecifier.startsWith('@/')) {
        assertRule(false, `${relative} does not import from root alias ${importSpecifier}`);
        continue;
      }

      if (importSpecifier.startsWith('../..')) {
        assertRule(false, `${relative} does not cross package boundaries through relative import ${importSpecifier}`);
        continue;
      }

      if (importSpecifier.startsWith('.')) {
        continue;
      }

      const depName = dependencyName(importSpecifier);
      if (depName.startsWith(internalPrefix)) {
        assertRule(packageNames.has(depName), `${relative} imports known AutoCut package ${depName}`);
        if (depName !== manifest.name) {
          assertRule(allDeps[depName] === 'workspace:*', `${manifest.name} declares imported AutoCut dependency ${depName} as workspace:*`);
        }
        continue;
      }

      assertRule(externalDependencyAllowlist.has(depName), `${relative} imports allowed external dependency ${depName}`);
      assertRule(Boolean(allDeps[depName]), `${manifest.name} declares directly imported external dependency ${depName}`);
    }
  }

  if (businessPackagesWithService.has(dirName)) {
    assertRule(fs.existsSync(path.join(packagePath, 'src', 'service')), `${manifest.name} has src/service`);
  }
}

for (const catalogName of workspaceCatalogNames) {
  assertRule(usedExternalCatalogNames.has(catalogName), `pnpm catalog entry ${catalogName} is used by root or package manifests`);
}

if (failures.length > 0) {
  console.error('AutoCut architecture check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exit(1);
}

console.log(`AutoCut architecture check passed (${pass.length} checks).`);
