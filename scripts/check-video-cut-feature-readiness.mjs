#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { createReportPath, serializeProjectPath } from './lib/report-paths.mjs';
import { normalizeCliArgs } from './lib/cli-args.mjs';

const COMMAND = 'check:feature-readiness';
const DEFAULT_REGISTRY_PATH = 'docs/product/feature-readiness.yaml';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const REPORT_VERSION = 'video-cut.feature-readiness-report.v1';
const VALID_STATUSES = new Set(['implemented', 'partial', 'planned']);

const FEATURE_POLICY_REQUIREMENTS = {
  'canonical-host-api': {
    evidenceFiles: [
      'docs/openapi/video-cut-v1.yaml',
      'host/src/lib.rs',
      'host/src/state.rs',
      'host/tests/host_contract_test.rs',
      'src/services/httpHostClient.ts',
      'src/__tests__/httpHostClient.test.ts',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm test -- --run src/__tests__/httpHostClient.test.ts',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test -- --nocapture',
    ],
    nextActionIncludes: [
      '/api/video-cut/v1',
      'OpenAPI',
      'Host contract tests',
      'frontend client',
      'ApiSuccessEnvelope',
      'ApiErrorEnvelope',
      'REQUEST_JSON_INVALID',
      'MULTIPART_INVALID',
      'PATH_PARAMETER_INVALID',
      'QUERY_PARAMETER_INVALID',
      'ROUTE_NOT_FOUND',
      'METHOD_NOT_ALLOWED',
      'TASK_NOT_FOUND',
      'TASK_PLAN_NOT_FOUND',
      'HTTP Host client error normalization',
      'success envelope validation',
    ],
  },
  'settings-center-provider-config': {
    evidenceFiles: [
      'src/domain/settingsSchema.ts',
      'src/services/settingsDraft.ts',
      'src/services/settingsValidation.ts',
      'src/components/settings/SettingsCenter.tsx',
      'src/components/settings/SettingsPanels.tsx',
      'src/services/httpHostClient.ts',
      'src/services/mockHostClient.ts',
      'host/src/settings.rs',
      'host/tests/host_contract_test.rs',
      'host/tests/workspace_manifest_test.rs',
      'src/__tests__/settingsSchema.test.ts',
      'src/__tests__/settingsDraft.test.ts',
      'src/__tests__/settingsValidation.test.ts',
      'src/__tests__/settingsCenter.test.tsx',
      'src/__tests__/httpHostClient.test.ts',
      'src/__tests__/mockHostClient.test.ts',
      'scripts/run-video-cut-managed-ui-smoke.mjs',
      'scripts/check-video-cut-smoke-evidence-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
    ],
    checks: [
      'pnpm check:provider-conformance',
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm workflow:smoke:ui:managed -- --json',
      'pnpm check:smoke-evidence -- --json',
      'pnpm test -- --run src/__tests__/settingsSchema.test.ts src/__tests__/settingsDraft.test.ts src/__tests__/settingsValidation.test.ts src/__tests__/settingsCenter.test.tsx src/__tests__/httpHostClient.test.ts src/__tests__/mockHostClient.test.ts',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test put_settings_extracts_plaintext_provider_keys_without_persisting_them -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test workspace_manifest_test persistent_app_saves_settings_without_plaintext_secret_fields -- --nocapture',
    ],
    nextActionIncludes: [
      'Settings Center',
      'settings schema',
      'settings draft',
      'settings validation',
      'Host validation',
      'write-only secret save path',
      'plaintext provider keys must not persist',
      'apiKeyConfigured',
      'RedactedVideoCutSettings',
      'ProviderConformanceReport',
      'managed UI Settings Center smoke',
      'settingsRedactionVerified',
      'settingsSaved',
      'diagnosticsBundleVerified',
      'providerConformanceVerified',
      'no secret persistence',
      'runtime restart impact',
      'deployment-mode field ownership',
    ],
  },
  'speech-provider-bridge-profiles': {
    evidenceFiles: [
      'host/src/speech_transcription.rs',
      'host/src/providers.rs',
      'host/src/settings.rs',
      'host/src/runtime_config.rs',
      'host/src/media_transcript.rs',
      'host/tests/provider_contract_test.rs',
      'host/tests/host_contract_test.rs',
      'src/domain/settingsSchema.ts',
      'src/services/settingsValidation.ts',
      'src/services/mockHostClient.ts',
      'src/services/httpHostClient.ts',
      'src/components/settings/SettingsPanels.tsx',
      'src/__tests__/settingsCenter.test.tsx',
      'src/__tests__/settingsValidation.test.ts',
      'src/__tests__/mockHostClient.test.ts',
      'src/__tests__/httpHostClient.test.ts',
      'docs/openapi/video-cut-v1.yaml',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
    ],
    checks: [
      'cargo test --manifest-path host/Cargo.toml media_transcript -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test provider_contract_test -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test provider_conformance_endpoint_builds_redacted_report_from_runtime_settings -- --nocapture',
      'pnpm check:provider-conformance',
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm test -- --run src/__tests__/settingsCenter.test.tsx src/__tests__/settingsValidation.test.ts src/__tests__/mockHostClient.test.ts src/__tests__/httpHostClient.test.ts',
    ],
    nextActionIncludes: [
      'openai-audio-transcriptions',
      'volcengine-bigasr-flash',
      'aliyun-qwen-asr',
      'speech_to_text_provider_profiles',
      'SpeechToTextProviderProfile',
      'stt.provider.bridge',
      'openai-audio-transcriptions.verbose-json',
      'canonical verbose transcript JSON',
      'vendor-specific request headers',
      'vendor payload DTOs',
      'Host bridge adapters',
      'frontend provider DTO leaks are forbidden',
      'redacted conformance evidence',
      'credentialStatus',
      'resourceId',
      'timestampGranularity',
      'ProviderConformanceReport',
    ],
  },
  'local-source-upload': {
    evidenceFiles: [
      'src/components/pages/WorkbenchPage.tsx',
      'src/ports/videoCutHostClient.ts',
      'src/services/httpHostClient.ts',
      'src/services/mockHostClient.ts',
      'docs/openapi/video-cut-v1.yaml',
      'host/src/lib.rs',
      'host/tests/host_contract_test.rs',
      'scripts/run-video-cut-http-workflow-smoke.mjs',
      'scripts/run-video-cut-managed-server-smoke.mjs',
      'scripts/run-video-cut-managed-ui-smoke.mjs',
      'scripts/check-video-cut-smoke-evidence-contracts.mjs',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
      'src/__tests__/httpWorkflowSmokeCli.test.ts',
      'src/__tests__/managedServerSmokeCli.test.ts',
      'src/__tests__/managedUiSmokeCli.test.ts',
      'src/__tests__/httpHostClient.test.ts',
      'src/__tests__/mockHostClient.test.ts',
      'src/__tests__/appShell.test.tsx',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm workflow:smoke:desktop:local -- --json',
      'pnpm workflow:smoke:server:private -- --json',
      'pnpm workflow:smoke:server:managed -- --json',
      'pnpm workflow:smoke:ui:managed -- --json',
      'pnpm check:smoke-evidence -- --json',
      'pnpm test -- --run src/__tests__/appShell.test.tsx src/__tests__/httpHostClient.test.ts src/__tests__/mockHostClient.test.ts src/__tests__/httpWorkflowSmokeCli.test.ts src/__tests__/managedServerSmokeCli.test.ts src/__tests__/managedUiSmokeCli.test.ts',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test attach_task_source_sanitizes_metadata_source_name_before_manifest_path -- --nocapture',
    ],
    nextActionIncludes: [
      'multipart upload boundary',
      'local and server-private modes',
      'source media type guard',
      'SOURCE_FILE_REQUIRED',
      'MULTIPART_INVALID',
      'sourceName sanitization',
      'host-relative artifact descriptors',
      'private delivery proof',
      'TCP HTTP workflow smoke',
      'managed server smoke',
      'managed UI Results-page delivery smoke',
      'smoke-evidence-bundle.json',
      'redaction/path safety',
      'no browser local absolute path leaks',
    ],
  },
  'media-analysis-pipeline': {
    evidenceFiles: [
      'host/src/media_probe.rs',
      'host/src/media_audio.rs',
      'host/src/media_vad.rs',
      'host/src/media_transcript.rs',
      'host/src/media_semantic.rs',
      'host/tests/host_contract_test.rs',
      'host/tests/provider_contract_test.rs',
      'src/domain/mediaContracts.ts',
      'src/__tests__/mediaContracts.test.ts',
      'src/__tests__/appShell.test.tsx',
      'docs/openapi/video-cut-v1.yaml',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm test -- --run src/__tests__/mediaContracts.test.ts src/__tests__/appShell.test.tsx',
      'cargo test --manifest-path host/Cargo.toml media_probe -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml media_audio -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml media_vad -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml media_transcript -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml media_semantic -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test analyze_task_writes_standard_media_info_artifact -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test analyze_task_writes_standard_audio_and_silence_artifacts -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test analyze_task_writes_standard_speech_activity_artifact -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test analyze_task_writes_standard_transcript_artifact -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test analyze_task_writes_standard_semantic_analysis_artifact -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test analyze_task_generates_renderable_default_plan_from_media_duration -- --nocapture',
    ],
    nextActionIncludes: [
      'video-cut.media-info.schema.v1',
      'video-cut.audio-extract.schema.v1',
      'video-cut.silence-ranges.schema.v1',
      'video-cut.vad-ranges.schema.v1',
      'video-cut.transcript.schema.v1',
      'video-cut.semantic-analysis.schema.v1',
      'video-cut.split-plan.schema.v1',
      'provider-unavailable',
      'audio-unavailable',
      'transcript-unavailable',
      'no fake segments',
      'no fake topics',
      'artifact integrity',
      'tracks provenance',
      'OpenAPI',
      'Host contract tests',
      'TypeScript media contract validators',
    ],
  },
  'manual-transcript-fallback': {
    evidenceFiles: [
      'src/components/pages/WorkbenchPage.tsx',
      'src/services/httpHostClient.ts',
      'src/services/mockHostClient.ts',
      'src/ports/videoCutHostClient.ts',
      'src/domain/videoCutTypes.ts',
      'host/src/media_transcript.rs',
      'host/src/media_subtitle_format.rs',
      'host/tests/host_contract_test.rs',
      'src/__tests__/appShell.test.tsx',
      'src/__tests__/mockHostClient.test.ts',
      'src/__tests__/httpHostClient.test.ts',
      'docs/openapi/video-cut-v1.yaml',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm test -- --run src/__tests__/appShell.test.tsx src/__tests__/mockHostClient.test.ts src/__tests__/httpHostClient.test.ts',
      'cargo test --manifest-path host/Cargo.toml media_transcript -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml subtitle_import -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test put_manual_transcript_writes_standard_artifact_and_drives_subtitle_burn_in -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test subtitle_import_and_export_support_srt_and_vtt_standard_adapters -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test subtitle_import_rejects_overlapping_cues_before_replacing_transcript -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test rendering_tasks_reject_plan_transcript_and_subtitle_mutations_without_overwriting_status -- --nocapture',
    ],
    nextActionIncludes: [
      'ManualTranscriptInput',
      'manual-transcript.adapter.v1',
      'subtitle-import-srt',
      'subtitle-import-vtt',
      'SRT',
      'VTT',
      'overlapping cues',
      'TASK_BUSY',
      'subtitle burn-in',
      'transcript artifact contract',
      'OpenAPI',
      'HTTP Host',
      'local mock Host',
      'Workbench',
      'no replacement during rendering',
      'render manifest subtitleCueCount',
    ],
  },
  'real-ffmpeg-render': {
    evidenceFiles: [
      'host/src/media_render.rs',
      'host/src/media_assets.rs',
      'host/src/media_subtitle.rs',
      'host/src/media_cover.rs',
      'host/src/media_render_manifest.rs',
      'host/tests/host_contract_test.rs',
      'docs/openapi/video-cut-v1.yaml',
      'src/domain/mediaContracts.ts',
      'src/components/pages/WorkbenchPage.tsx',
      'src/components/pages/ResultsPage.tsx',
      'src/__tests__/mediaContracts.test.ts',
      'src/__tests__/appShell.test.tsx',
      'src/__tests__/resultsPage.test.tsx',
      'scripts/check-video-cut-smoke-evidence-contracts.mjs',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
      'scripts/run-video-cut-http-workflow-smoke.mjs',
      'scripts/run-video-cut-managed-ui-smoke.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm check:smoke-evidence -- --json',
      'pnpm workflow:smoke:desktop:local -- --json',
      'pnpm workflow:smoke:ui:managed -- --json',
      'pnpm test -- --run src/__tests__/mediaContracts.test.ts src/__tests__/appShell.test.tsx src/__tests__/resultsPage.test.tsx',
      'cargo test --manifest-path host/Cargo.toml media_render -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test render_task_publishes_subtitle_ass_and_cover_artifacts_for_delivery_package -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test render_task_mixes_configured_bgm_and_sfx_assets_without_leaking_paths -- --nocapture',
    ],
    nextActionIncludes: [
      'FFmpeg',
      'ASS subtitle burn-in',
      'voice-basic-loudnorm-afftdn.v1',
      'asset catalog',
      'assets://',
      'renderPreferences',
      'typed render graph',
      'video-cut.render-attempt.schema.v1',
      'output manifest',
      'cover artifact',
      'render log',
      'private delivery',
      'host-relative artifact descriptors',
      'redaction/path safety',
      'BGM/SFX asset provenance',
      '9:16 MP4',
      'timeline-positioned SFX only through typed render graph extensions',
    ],
  },
  'diagnostics-and-redaction': {
    evidenceFiles: [
      'src/domain/diagnosticBundleExport.ts',
      'src/components/DiagnosticBundleDownloadCard.tsx',
      'src/components/DiagnosticSupportBundleCard.tsx',
      'src/components/pages/DiagnosticsPage.tsx',
      'host/src/doctor.rs',
      'host/src/lib.rs',
      'host/tests/provider_contract_test.rs',
      'host/tests/host_contract_test.rs',
      'src/__tests__/diagnosticBundleExport.test.ts',
      'src/__tests__/appShell.test.tsx',
      'src/__tests__/httpHostClient.test.ts',
      'src/__tests__/mockHostClient.test.ts',
      'docs/openapi/video-cut-v1.yaml',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm check:provider-conformance',
      'pnpm test -- --run src/__tests__/diagnosticBundleExport.test.ts',
      'pnpm test -- --run src/__tests__/appShell.test.tsx',
      'cargo test --manifest-path host/Cargo.toml diagnostics_support_bundle -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test provider_contract_test -- --nocapture',
    ],
    nextActionIncludes: [
      'doctor',
      'diagnostics',
      'explicit-consent',
      'DIAGNOSTICS_CONSENT_REQUIRED',
      'DiagnosticSupportBundleRequest',
      'DiagnosticBundleArtifact',
      'RedactedVideoCutSettings',
      'ProviderConformanceReport',
      'API keys',
      'bearer tokens',
      'Authorization headers',
      'transcript text',
      'media bytes',
      'server-local absolute paths',
      'host-relative artifact descriptors',
      'browser href',
    ],
  },
  'operation-errors-and-recovery': {
    evidenceFiles: [
      'src/domain/operationErrors.ts',
      'src/domain/hostApiErrors.ts',
      'src/domain/taskRecovery.ts',
      'src/components/OperationErrorPanel.tsx',
      'src/components/pages/ResultsPage.tsx',
      'src/components/pages/QueuePage.tsx',
      'src/components/pages/WorkbenchPage.tsx',
      'src/services/httpHostClient.ts',
      'src/services/mockHostClient.ts',
      'docs/openapi/video-cut-v1.yaml',
      'host/src/state.rs',
      'host/tests/host_contract_test.rs',
      'src/__tests__/appShell.test.tsx',
      'src/__tests__/resultsPage.test.tsx',
      'src/__tests__/mockHostClient.test.ts',
      'src/__tests__/httpHostClient.test.ts',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-governance-suite.mjs',
      'scripts/check-video-cut-smoke-evidence-contracts.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:governance -- --json',
      'pnpm test -- --run src/__tests__/appShell.test.tsx',
      'pnpm test -- --run src/__tests__/resultsPage.test.tsx',
      'pnpm test -- --run src/__tests__/mockHostClient.test.ts',
      'pnpm test -- --run src/__tests__/httpHostClient.test.ts',
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test render_task_failure_redacts_absolute_workspace_paths -- --nocapture',
    ],
    nextActionIncludes: [
      'OperationError',
      'VideoCutHostApiError',
      'code',
      'status',
      'traceId',
      'endpoint',
      'task event recovery hints',
      'TaskRecoveryHint',
      'metadata.recoveryHint',
      'retry-analysis',
      'retry-render',
      'review-render-log',
      'TASK_PLAN_NOT_FOUND',
      'TASK_NOT_FOUND',
      'TASK_BUSY',
      'SOURCE_FILE_REQUIRED',
      'HTTP Host',
      'local mock Host',
      'Workbench',
      'Results',
      'Queue',
      'OpenAPI',
      'governance',
    ],
  },
  'deployment-artifacts-and-governance': {
    evidenceFiles: [
      'scripts/check-video-cut-cli-contracts.mjs',
      'scripts/check-video-cut-openapi-contracts.mjs',
      'scripts/check-video-cut-deployment-artifacts.mjs',
      'scripts/check-video-cut-release-contracts.mjs',
      'scripts/verify-video-cut-release-signature.mjs',
      'scripts/check-video-cut-feature-readiness-policy.mjs',
      'scripts/release/run-release-with-governance.mjs',
      'scripts/release/run-release-matrix.mjs',
      'scripts/release/check-release-smoke-preflight.mjs',
      'scripts/release/run-release-smoke-matrix.mjs',
    ],
    checks: [
      'pnpm check:contracts -- --json',
      'pnpm check:deployment-artifacts',
      'pnpm check:deployment-matrix -- --json',
      'pnpm check:cli-contracts -- --json',
      'pnpm check:feature-readiness-policy -- --json',
      'pnpm check:smoke-evidence -- --json',
      'pnpm check:release-contracts -- --json',
      'pnpm verify:release-signature -- --json',
      'pnpm release:package:matrix -- --json',
      'pnpm release:smoke:preflight -- --json',
      'pnpm release:smoke:matrix -- --json',
      'pnpm check:governance -- --json',
    ],
    nextActionIncludes: [
      'video-cut.release-matrix-report.v1',
      'video-cut.release-smoke-preflight-report.v1',
      'video-cut.release-smoke-matrix-report.v1',
      'video-cut.release-signature-verification.v1',
      'video-cut.feature-readiness-policy-report.v1',
      'release-root-generated-files-sealed',
      'release-package-file-set-sealed',
      'governance-evidence-bundle.json',
      'smoke-evidence-bundle.json',
      'RELEASE_MATRIX_TARGET_FAILED',
      'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
      'RELEASE_SMOKE_MATRIX_TARGET_FAILED',
      'redaction/path safety',
    ],
  },
  'runtime-config-and-private-auth': {
    evidenceFiles: [
      'host/src/runtime_config.rs',
      'host/tests/runtime_config_test.rs',
      'host/tests/auth_test.rs',
      'src/services/httpHostClient.ts',
      'src/__tests__/httpHostClient.test.ts',
      'scripts/run-video-cut-deployment-doctor.mjs',
      'src/__tests__/deploymentDoctorCli.test.ts',
      'deploy/docker/docker-compose.yml',
      'deploy/kubernetes/values.yaml',
      'docs/architecture/08-runtime-configuration-and-capability-standard.md',
      'docs/architecture/02-deployment-mode-architecture.md',
    ],
    checks: [
      'cargo test --manifest-path host/Cargo.toml --test runtime_config_test -- --nocapture',
      'cargo test --manifest-path host/Cargo.toml --test auth_test -- --nocapture',
      'pnpm check:deployment-artifacts -- --json',
      'pnpm check:deployment-matrix -- --json',
      'pnpm check:governance -- --json',
      'pnpm test -- --run src/__tests__/httpHostClient.test.ts src/__tests__/deploymentDoctorCli.test.ts src/__tests__/deploymentArtifacts.test.ts',
    ],
    nextActionIncludes: [
      'SDKWORK_VIDEO_CUT_*',
      'VIDEO_CUT_*',
      'SDKWORK_VIDEO_CUT_AUTH_MODE',
      'SDKWORK_VIDEO_CUT_SERVER_TOKEN',
      'SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS',
      'single-user-token',
      'reverse-proxy',
      'bearer authorization scheme',
      '0.0.0.0',
      'deployment doctor',
      'HTTP client headers',
      'browser-facing child process env sanitizer',
    ],
  },
  'multi-segment-batch-render': {
    evidenceFiles: [
      'src/components/pages/WorkbenchPage.tsx',
      'src/App.tsx',
      'src/ports/videoCutHostClient.ts',
      'src/services/httpHostClient.ts',
      'src/services/mockHostClient.ts',
      'docs/openapi/video-cut-v1.yaml',
      'host/src/media_render.rs',
      'host/src/lib.rs',
      'host/tests/host_contract_test.rs',
      'src/__tests__/appShell.test.tsx',
      'src/__tests__/mockHostClient.test.ts',
      'src/__tests__/httpHostClient.test.ts',
      'scripts/check-video-cut-openapi-contracts.mjs',
    ],
    checks: [
      'pnpm test -- --run src/__tests__/appShell.test.tsx',
      'pnpm check:contracts -- --json',
      'pnpm test -- --run src/__tests__/mockHostClient.test.ts src/__tests__/httpHostClient.test.ts',
      'pnpm host:test',
    ],
    nextActionIncludes: [
      'single-render',
      'batch-render',
      'Host',
      'OpenAPI',
      'HTTP client',
      'Mock client',
    ],
  },
  'srt-vtt-subtitle-import-export': {
    evidenceFiles: [
      'host/src/media_subtitle_format.rs',
      'host/src/lib.rs',
      'host/src/models.rs',
      'host/tests/host_contract_test.rs',
      'src/App.tsx',
      'src/utils/readTextFile.ts',
      'src/components/pages/WorkbenchPage.tsx',
      'src/ports/videoCutHostClient.ts',
      'src/services/httpHostClient.ts',
      'src/services/mockHostClient.ts',
      'docs/openapi/video-cut-v1.yaml',
      'src/__tests__/appShell.test.tsx',
      'src/__tests__/mockHostClient.test.ts',
      'src/__tests__/httpHostClient.test.ts',
      'scripts/check-video-cut-openapi-contracts.mjs',
    ],
    checks: [
      'pnpm test -- --run src/__tests__/appShell.test.tsx',
      'pnpm check:contracts -- --json',
      'pnpm test -- --run src/__tests__/mockHostClient.test.ts src/__tests__/httpHostClient.test.ts',
      'cargo test --manifest-path host/Cargo.toml subtitle_import -- --nocapture',
    ],
    nextActionIncludes: [
      'subtitle adapters',
      'transcript artifacts',
      'render subtitle burn-in',
      'OpenAPI contracts',
    ],
  },
  'real-vad-onnx-execution': {
    evidenceFiles: [
      'docs/architecture/04-media-pipeline-and-rendering-standards.md',
      'docs/architecture/05-data-storage-task-engine-standards.md',
      'models/silero-vad.onnx.manifest.json',
      'host/Cargo.toml',
      'host/src/media_vad.rs',
      'host/Cargo.lock',
    ],
    checks: [
      'cargo test --manifest-path host/Cargo.toml media_vad -- --nocapture',
      'pnpm host:test',
    ],
    nextActionIncludes: [
      'deployment model path',
      'runtime capability checks',
      'packaged model manifest',
    ],
  },
  'full-nle-timeline': {
    evidenceFiles: [
      'src/domain/nleTimeline.ts',
      'src/components/NleTimelinePanel.tsx',
      'src/components/pages/WorkbenchPage.tsx',
      'src/styles.css',
      'src/__tests__/nleTimeline.test.ts',
      'src/__tests__/appShell.test.tsx',
    ],
    checks: [
      'pnpm test -- --run src/__tests__/nleTimeline.test.ts src/__tests__/appShell.test.tsx',
      'pnpm typecheck',
    ],
    nextActionIncludes: [
      'deterministic view',
      'split-plan',
      'artifact',
      'provenance',
      'collaborative editing requires persistence',
    ],
  },
  'database-backed-multi-instance-queue': {
    evidenceFiles: [
      'docs/architecture/14-database-implementation-standard.md',
      'docs/architecture/15-database-queue-baseline-implementation.md',
      'docs/architecture/05-data-storage-task-engine-standards.md',
      'docs/database/prefix-registry.yaml',
      'docs/database/schema-registry/ops_task.yaml',
      'docs/database/schema-registry/ops_stage_run.yaml',
      'docs/database/schema-registry/ops_task_event.yaml',
      'docs/database/schema-registry/ops_worker_lease.yaml',
      'docs/database/schema-registry/media_artifact.yaml',
      'host/database/schema/sqlite/001_baseline.sql',
      'host/database/schema/postgres/001_baseline.sql',
      'host/src/database_queue.rs',
      'host/tests/database_queue_test.rs',
      'scripts/check-video-cut-database-contracts.mjs',
      'src/__tests__/databaseContractsCli.test.ts',
    ],
    checks: [
      'pnpm check:database-contracts',
      'cargo test --manifest-path host/Cargo.toml --test database_queue_test -- --nocapture',
      'pnpm check:feature-readiness -- --json',
    ],
    nextActionIncludes: [
      'local filesystem',
      'default runtime source of truth',
      'server/k8s queue enablement',
      'database queue port',
      'explicit baseline initialization',
    ],
  },
};

export const FEATURE_POLICY_DRIFT_SCENARIOS = [
  {
    id: 'canonical-host-api',
    removeFile: 'scripts/check-video-cut-openapi-contracts.mjs',
    removeCheck: 'pnpm check:contracts -- --json',
    removeText: 'ROUTE_NOT_FOUND',
    expectedPolicyFailures: [
      'evidenceFiles:scripts/check-video-cut-openapi-contracts.mjs',
      'checks:pnpm check:contracts -- --json',
      'nextAction:ROUTE_NOT_FOUND',
    ],
  },
  {
    id: 'settings-center-provider-config',
    removeFile: 'src/domain/settingsSchema.ts',
    removeCheck: 'pnpm workflow:smoke:ui:managed -- --json',
    removeText: 'write-only secret save path',
    expectedPolicyFailures: [
      'evidenceFiles:src/domain/settingsSchema.ts',
      'checks:pnpm workflow:smoke:ui:managed -- --json',
      'nextAction:write-only secret save path',
    ],
  },
  {
    id: 'speech-provider-bridge-profiles',
    removeFile: 'host/src/speech_transcription.rs',
    removeCheck: 'pnpm check:governance -- --json',
    removeText: 'stt.provider.bridge',
    expectedPolicyFailures: [
      'evidenceFiles:host/src/speech_transcription.rs',
      'checks:pnpm check:governance -- --json',
      'nextAction:stt.provider.bridge',
    ],
  },
  {
    id: 'local-source-upload',
    removeFile: 'scripts/check-video-cut-smoke-evidence-contracts.mjs',
    removeCheck: 'pnpm workflow:smoke:server:private -- --json',
    removeText: 'SOURCE_FILE_REQUIRED',
    expectedPolicyFailures: [
      'evidenceFiles:scripts/check-video-cut-smoke-evidence-contracts.mjs',
      'checks:pnpm workflow:smoke:server:private -- --json',
      'nextAction:SOURCE_FILE_REQUIRED',
    ],
  },
  {
    id: 'media-analysis-pipeline',
    removeFile: 'host/src/media_semantic.rs',
    removeCheck: 'pnpm check:contracts -- --json',
    removeText: 'provider-unavailable',
    expectedPolicyFailures: [
      'evidenceFiles:host/src/media_semantic.rs',
      'checks:pnpm check:contracts -- --json',
      'nextAction:provider-unavailable',
    ],
  },
  {
    id: 'manual-transcript-fallback',
    removeFile: 'host/src/media_subtitle_format.rs',
    removeCheck:
      'cargo test --manifest-path host/Cargo.toml --test host_contract_test put_manual_transcript_writes_standard_artifact_and_drives_subtitle_burn_in -- --nocapture',
    removeText: 'subtitle burn-in',
    expectedPolicyFailures: [
      'evidenceFiles:host/src/media_subtitle_format.rs',
      'checks:cargo test --manifest-path host/Cargo.toml --test host_contract_test put_manual_transcript_writes_standard_artifact_and_drives_subtitle_burn_in -- --nocapture',
      'nextAction:subtitle burn-in',
    ],
  },
  {
    id: 'real-ffmpeg-render',
    removeFile: 'host/src/media_render_manifest.rs',
    removeCheck: 'pnpm check:smoke-evidence -- --json',
    removeText: 'video-cut.render-attempt.schema.v1',
    expectedPolicyFailures: [
      'evidenceFiles:host/src/media_render_manifest.rs',
      'checks:pnpm check:smoke-evidence -- --json',
      'nextAction:video-cut.render-attempt.schema.v1',
    ],
  },
  {
    id: 'diagnostics-and-redaction',
    removeFile: 'src/domain/diagnosticBundleExport.ts',
    removeCheck: 'pnpm check:governance -- --json',
    removeText: 'explicit-consent',
    expectedPolicyFailures: [
      'evidenceFiles:src/domain/diagnosticBundleExport.ts',
      'checks:pnpm check:governance -- --json',
      'nextAction:explicit-consent',
    ],
  },
  {
    id: 'operation-errors-and-recovery',
    removeFile: 'src/domain/taskRecovery.ts',
    removeCheck: 'pnpm check:governance -- --json',
    removeText: 'task event recovery hints',
    expectedPolicyFailures: [
      'evidenceFiles:src/domain/taskRecovery.ts',
      'checks:pnpm check:governance -- --json',
      'nextAction:task event recovery hints',
    ],
  },
  {
    id: 'deployment-artifacts-and-governance',
    removeFile: 'scripts/release/check-release-smoke-preflight.mjs',
    removeCheck: 'pnpm release:smoke:preflight -- --json',
    removeText: 'RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
    expectedPolicyFailures: [
      'evidenceFiles:scripts/release/check-release-smoke-preflight.mjs',
      'checks:pnpm release:smoke:preflight -- --json',
      'nextAction:RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED',
    ],
  },
  {
    id: 'runtime-config-and-private-auth',
    removeFile: 'host/tests/auth_test.rs',
    removeCheck: 'cargo test --manifest-path host/Cargo.toml --test auth_test -- --nocapture',
    removeText: 'SDKWORK_VIDEO_CUT_SERVER_TOKEN',
    expectedPolicyFailures: [
      'evidenceFiles:host/tests/auth_test.rs',
      'checks:cargo test --manifest-path host/Cargo.toml --test auth_test -- --nocapture',
      'nextAction:SDKWORK_VIDEO_CUT_SERVER_TOKEN',
    ],
  },
  {
    id: 'multi-segment-batch-render',
    removeFile: 'src/ports/videoCutHostClient.ts',
    removeCheck: 'pnpm check:contracts -- --json',
    removeText: 'batch-render',
    expectedPolicyFailures: [
      'evidenceFiles:src/ports/videoCutHostClient.ts',
      'checks:pnpm check:contracts -- --json',
      'nextAction:batch-render',
    ],
  },
  {
    id: 'srt-vtt-subtitle-import-export',
    removeFile: 'src/utils/readTextFile.ts',
    removeCheck: 'cargo test --manifest-path host/Cargo.toml subtitle_import -- --nocapture',
    removeText: 'OpenAPI contracts',
    expectedPolicyFailures: [
      'evidenceFiles:src/utils/readTextFile.ts',
      'checks:cargo test --manifest-path host/Cargo.toml subtitle_import -- --nocapture',
      'nextAction:OpenAPI contracts',
    ],
  },
  {
    id: 'real-vad-onnx-execution',
    removeFile: 'models/silero-vad.onnx.manifest.json',
    removeCheck: 'cargo test --manifest-path host/Cargo.toml media_vad -- --nocapture',
    removeText: 'packaged model manifest',
    expectedPolicyFailures: [
      'evidenceFiles:models/silero-vad.onnx.manifest.json',
      'checks:cargo test --manifest-path host/Cargo.toml media_vad -- --nocapture',
      'nextAction:packaged model manifest',
    ],
  },
  {
    id: 'full-nle-timeline',
    removeFile: 'src/domain/nleTimeline.ts',
    removeCheck: 'pnpm typecheck',
    removeText: 'collaborative editing requires persistence',
    expectedPolicyFailures: [
      'evidenceFiles:src/domain/nleTimeline.ts',
      'checks:pnpm typecheck',
      'nextAction:collaborative editing requires persistence',
    ],
  },
  {
    id: 'database-backed-multi-instance-queue',
    removeFile: 'scripts/check-video-cut-database-contracts.mjs',
    removeCheck: 'pnpm check:database-contracts',
    removeText: 'database queue port',
    expectedPolicyFailures: [
      'evidenceFiles:scripts/check-video-cut-database-contracts.mjs',
      'checks:pnpm check:database-contracts',
      'nextAction:database queue port',
    ],
  },
];

export function parseFeatureReadinessArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let registryPath = DEFAULT_REGISTRY_PATH;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--registry') {
      registryPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown feature readiness argument: ${arg}`);
  }

  return { json, registryPath, reportDir };
}

export function createFeatureReadinessReport({
  projectRoot = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const registry = readRegistry(projectRoot, registryPath);
  const features = normalizeFeatures(projectRoot, registry.features ?? []);
  const policyFailures = features.reduce((count, feature) => count + feature.policyFailures.length, 0);
  const openGaps = features
    .filter((feature) => feature.status !== 'implemented')
    .map((feature) => ({
      id: feature.id,
      title: feature.title,
      priority: feature.priority,
      status: feature.status,
      gap: feature.gap,
      nextAction: feature.nextAction,
    }));
  const blockingFailures = features.filter((feature) => feature.blockingFailure);
  const summary = summarizeFeatures(features);
  const status = blockingFailures.length > 0 ? 'fail' : openGaps.length > 0 ? 'attention' : 'pass';
  const { absolutePath: absoluteReportPath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'feature-readiness-report.json',
  );
  const absoluteRegistryPath = resolve(projectRoot, registryPath);
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status,
    checkedAt: new Date().toISOString(),
    registryPath: serializeProjectPath(projectRoot, absoluteRegistryPath),
    reportPath,
    summary: {
      ...summary,
      gaps: openGaps.length,
      blockingFailures: blockingFailures.length,
      policyFailures,
    },
    openGaps,
    blockingFailures,
    features,
  };

  writeReport(absoluteReportPath, report);
  return report;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function readRegistry(projectRoot, registryPath) {
  const absolutePath = resolve(projectRoot, registryPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Feature readiness registry not found: ${registryPath}`);
  }

  return YAML.parse(readFileSync(absolutePath, 'utf8'));
}

function normalizeFeatures(projectRoot, features) {
  if (!Array.isArray(features)) {
    throw new Error('feature-readiness.yaml must define a features array.');
  }

  return features.map((feature, index) => normalizeFeature(projectRoot, feature, index));
}

function normalizeFeature(projectRoot, feature, index) {
  const id = stringField(feature, 'id', index);
  const status = stringField(feature, 'status', index);
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Feature ${id} has invalid status: ${status}`);
  }

  const evidenceFiles = arrayField(feature, 'evidenceFiles');
  const checks = arrayField(feature, 'checks');
  const nextAction = String(feature.nextAction || '');
  const missingEvidence = evidenceFiles.filter((file) => !existsSync(resolve(projectRoot, file)));
  const priority = stringField(feature, 'priority', index);
  const policyFailures = findFeaturePolicyFailures(id, { checks, evidenceFiles, nextAction });
  const implementedContractFailure =
    status === 'implemented' && (missingEvidence.length > 0 || policyFailures.length > 0);
  const blockingFailure = (priority === 'mvp' && status !== 'implemented') || implementedContractFailure;

  return {
    id,
    title: stringField(feature, 'title', index),
    priority,
    status,
    evidenceFiles,
    checks,
    missingEvidence,
    policyFailures,
    blockingFailure,
    ...(feature.gap ? { gap: String(feature.gap) } : {}),
    nextAction,
  };
}

function findFeaturePolicyFailures(id, feature) {
  const policy = FEATURE_POLICY_REQUIREMENTS[id];
  if (!policy) {
    return [];
  }

  return [
    ...missingArrayValues('evidenceFiles', feature.evidenceFiles, policy.evidenceFiles),
    ...missingArrayValues('checks', feature.checks, policy.checks),
    ...missingTextIncludes('nextAction', feature.nextAction, policy.nextActionIncludes),
  ];
}

function missingArrayValues(field, actualValues, requiredValues) {
  const actual = new Set(actualValues);
  return requiredValues.filter((value) => !actual.has(value)).map((value) => `${field}:${value}`);
}

function missingTextIncludes(field, actualValue, requiredValues) {
  return requiredValues.filter((value) => !actualValue.includes(value)).map((value) => `${field}:${value}`);
}

function stringField(feature, key, index) {
  const value = feature?.[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Feature at index ${index} must define string field ${key}.`);
  }

  return value.trim();
}

function arrayField(feature, key) {
  const value = feature?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

function summarizeFeatures(features) {
  return features.reduce(
    (summary, feature) => {
      summary.total += 1;
      summary[feature.status] += 1;
      return summary;
    },
    { total: 0, implemented: 0, partial: 0, planned: 0 },
  );
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    `SDKWork Video Cut Feature Readiness`,
    `status: ${report.status}`,
    `summary: ${report.summary.implemented} implemented, ${report.summary.partial} partial, ${report.summary.planned} planned`,
    `openGaps: ${report.openGaps.length}`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.openGaps.map((gap) => `${gap.status.toUpperCase()} ${gap.id}: ${gap.nextAction}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseFeatureReadinessArgs(process.argv.slice(2));
    const report = createFeatureReadinessReport({
      registryPath: options.registryPath,
      reportDir: options.reportDir,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.status === 'fail' ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reportVersion: REPORT_VERSION,
          command: COMMAND,
          status: 'fail',
          error: {
            code: 'FEATURE_READINESS_FAILED',
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
