#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { normalizeCliArgs } from './lib/cli-args.mjs';
import { createReportPath } from './lib/report-paths.mjs';

const COMMAND = 'check:contracts';
const REPORT_VERSION = 'video-cut.openapi-contracts-report.v1';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const OPENAPI_PATH = 'docs/openapi/video-cut-v1.yaml';
const ENV_EXAMPLE_PATH = '.env.example';

const REQUIRED_PUBLIC_PATHS = [
  '/health',
  '/capabilities',
  '/doctor',
  '/diagnostics/bundle',
  '/diagnostics/support-bundle',
  '/providers/openai-compatible/conformance',
  '/settings',
  '/assets/catalog',
  '/tasks',
  '/tasks/{taskId}',
  '/tasks/{taskId}/source',
  '/tasks/{taskId}/source/file',
  '/tasks/{taskId}/analyze',
  '/tasks/{taskId}/plan',
  '/tasks/{taskId}/transcript',
  '/tasks/{taskId}/subtitles/import',
  '/tasks/{taskId}/subtitles/export',
  '/tasks/{taskId}/render',
  '/tasks/{taskId}/render/batch',
  '/tasks/{taskId}/cancel',
  '/tasks/{taskId}/events',
  '/tasks/{taskId}/artifacts',
  '/tasks/{taskId}/artifacts/{artifactId}/download',
  '/tasks/{taskId}/artifacts/{artifactId}/content',
];

const REQUIRED_DOMAIN_SCHEMAS = [
  'AssetSettings',
  'AssetCatalog',
  'AssetCatalogEntry',
  'AssetCatalogSlot',
  'ArtifactDownloadDescriptor',
  'AudioExtractDocument',
  'CapabilityReport',
  'DeploymentDoctorCheck',
  'DeploymentDoctorReport',
  'DiagnosticBundle',
  'ProviderConformanceCheck',
  'ProviderConformanceReport',
  'ProviderConformanceRequest',
  'ManualTranscriptInput',
  'ManualTranscriptSegmentInput',
  'MediaInfoDocument',
  'RenderRequest',
  'RenderPreferences',
  'RenderAudioAssetPreference',
  'RenderAttemptManifest',
  'SemanticAnalysisDocument',
  'SilenceRangesDocument',
  'SubtitleDocument',
  'TranscriptDocument',
  'VadRangesDocument',
  'VideoCutArtifact',
  'VideoCutProgressEvent',
  'VideoCutSettings',
  'VideoCutTask',
  'VideoSplitPlan',
];

const STANDARD_ERROR_CODES = [
  'REQUEST_JSON_INVALID',
  'MULTIPART_INVALID',
  'PATH_PARAMETER_INVALID',
  'QUERY_PARAMETER_INVALID',
  'TASK_NOT_FOUND',
  'TASK_PLAN_NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
];

const SPEECH_PROVIDER_PROFILES = [
  'openai-audio-transcriptions',
  'volcengine-bigasr-flash',
  'aliyun-qwen-asr',
];

export function parseOpenApiContractsArgs(argv) {
  const args = normalizeCliArgs(argv);
  let json = false;
  let reportDir = DEFAULT_REPORT_DIR;

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

    throw new Error(`Unknown OpenAPI contracts argument: ${arg}`);
  }

  return { json, reportDir };
}

export function createOpenApiContractsReport({
  projectRoot = process.cwd(),
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const parsedOpenApi = readYamlDocument(projectRoot, OPENAPI_PATH);
  const spec = parsedOpenApi.value ?? {};
  const envExample = readText(projectRoot, ENV_EXAMPLE_PATH);
  const checks = [
    checkOpenApiYamlParse(parsedOpenApi),
    ...openApiContractChecks(spec),
    checkRuntimeEnvironmentTemplate(envExample),
  ];
  const summary = summarizeChecks(checks);
  const { absolutePath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'openapi-contracts-report.json',
  );
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summary.fail === 0 ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    reportPath,
    summary,
    checks,
  };

  writeReport(absolutePath, report);
  return report;
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

function openApiContractChecks(spec) {
  return [
    checkCanonicalSurface(spec),
    checkSuccessAndErrorEnvelopes(spec),
    checkSplitPlanNotFoundCodes(spec),
    checkRequiredDomainSchemas(spec),
    checkCapabilityDiagnostics(spec),
    checkAssetCatalogContract(spec),
    checkRenderAssetPreferences(spec),
    checkTaskRecoveryHints(spec),
    checkProviderContractPolicy(spec),
    checkDeploymentDoctorContract(spec),
    checkCorsSettingsContract(spec),
    checkDiagnosticsBundleContract(spec),
    checkDiagnosticsSupportBundleContract(spec),
    checkDiagnosticsRedactedPathPlaceholders(spec),
    checkProviderConformanceContract(spec),
    checkSpeechProviderProfiles(spec),
    checkMultipartSourceUpload(spec),
    checkRenderFailureEnvelopes(spec),
    checkBatchRenderEnvelopes(spec),
    checkManualTranscriptImport(spec),
    checkSubtitleImportExport(spec),
    checkBinaryArtifactContentServing(spec),
    checkRenderManifestArtifacts(spec),
    checkMediaInfoSchema(spec),
    checkAudioAndSilenceSchemas(spec),
    checkVadSchema(spec),
    checkTranscriptSchema(spec),
    checkSemanticAnalysisSchema(spec),
  ];
}

function checkOpenApiYamlParse(parsedOpenApi) {
  return checkResult({
    id: 'openapi-yaml-parseable',
    passed: Boolean(parsedOpenApi.value) && !parsedOpenApi.error,
    evidence: `${OPENAPI_PATH} parses as YAML.`,
    failMessage: `${OPENAPI_PATH} must parse as YAML: ${parsedOpenApi.error}`,
  });
}

function checkCanonicalSurface(spec) {
  return contractCheck({
    id: 'canonical-openapi-v1-surface',
    evidence: `OpenAPI 3.1.0 exposes ${REQUIRED_PUBLIC_PATHS.length} canonical /api/video-cut/v1 paths.`,
    validate(errors) {
      requireEqual(errors, 'openapi', spec.openapi, '3.1.0');
      requireEqual(errors, 'info.version', spec.info?.version, '0.1.0');
      requireEqual(errors, 'servers', spec.servers, [{ url: '/api/video-cut/v1' }]);
      requireArrayContainsAll(errors, 'paths', Object.keys(spec.paths ?? {}), REQUIRED_PUBLIC_PATHS);
    },
  });
}

function checkSuccessAndErrorEnvelopes(spec) {
  return contractCheck({
    id: 'standard-success-error-envelopes',
    evidence: 'ApiSuccessEnvelope and ApiErrorEnvelope declare stable ok/data and ok/error contracts with canonical error codes.',
    validate(errors) {
      const apiErrorEnvelope = schema(spec, 'ApiErrorEnvelope');
      const apiError = schema(spec, 'ApiError');
      const apiSuccessEnvelope = schema(spec, 'ApiSuccessEnvelope');
      requireEqual(errors, 'ApiErrorEnvelope.required', apiErrorEnvelope.required, ['ok', 'error']);
      requireEqual(errors, 'ApiErrorEnvelope.properties.ok.const', apiErrorEnvelope.properties?.ok?.const, false);
      for (const code of STANDARD_ERROR_CODES) {
        requireText(errors, 'ApiError.properties.code.description', apiError.properties?.code?.description, code);
      }
      for (const code of ['REQUEST_JSON_INVALID', 'MULTIPART_INVALID', 'PATH_PARAMETER_INVALID', 'QUERY_PARAMETER_INVALID']) {
        requireText(errors, 'BadRequestError.description', spec.components?.responses?.BadRequestError?.description, code);
      }
      for (const code of ['TASK_NOT_FOUND', 'TASK_PLAN_NOT_FOUND']) {
        requireText(errors, 'NotFoundError.description', spec.components?.responses?.NotFoundError?.description, code);
      }
      requireEqual(errors, 'ApiSuccessEnvelope.required', apiSuccessEnvelope.required, ['ok', 'data']);
      requireEqual(errors, 'ApiSuccessEnvelope.properties.ok.const', apiSuccessEnvelope.properties?.ok?.const, true);
    },
  });
}

function checkSplitPlanNotFoundCodes(spec) {
  return contractCheck({
    id: 'task-plan-not-found-error-split',
    evidence: 'GET /tasks/{taskId}/plan distinguishes TASK_NOT_FOUND and TASK_PLAN_NOT_FOUND in the public contract.',
    validate(errors) {
      const response = spec.paths?.['/tasks/{taskId}/plan']?.get?.responses?.['404'];
      requireText(errors, 'plan.404.description', response?.description, 'TASK_NOT_FOUND');
      requireText(errors, 'plan.404.description', response?.description, 'TASK_PLAN_NOT_FOUND');
      requireEqual(
        errors,
        'plan.404.content.application/json.schema.$ref',
        response?.content?.['application/json']?.schema?.$ref,
        '#/components/schemas/ApiErrorEnvelope',
      );
    },
  });
}

function checkRequiredDomainSchemas(spec) {
  return contractCheck({
    id: 'required-domain-schemas-present',
    evidence: `${REQUIRED_DOMAIN_SCHEMAS.length} public domain schemas remain present in components.schemas.`,
    validate(errors) {
      requireArrayContainsAll(errors, 'components.schemas', Object.keys(spec.components?.schemas ?? {}), REQUIRED_DOMAIN_SCHEMAS);
    },
  });
}

function checkCapabilityDiagnostics(spec) {
  return contractCheck({
    id: 'capability-runtime-tool-diagnostics',
    evidence: 'CapabilityStatus exposes checkedTools and missingTools for deployment diagnostics.',
    validate(errors) {
      const capabilityStatus = schema(spec, 'CapabilityStatus');
      requireEqual(
        errors,
        'CapabilityStatus.properties.checkedTools.additionalProperties.type',
        capabilityStatus.properties?.checkedTools?.additionalProperties?.type,
        'string',
      );
      requireEqual(
        errors,
        'CapabilityStatus.properties.missingTools.items.type',
        capabilityStatus.properties?.missingTools?.items?.type,
        'string',
      );
    },
  });
}

function checkAssetCatalogContract(spec) {
  return contractCheck({
    id: 'asset-catalog-endpoint-schema',
    evidence: 'GET /assets/catalog returns a standard AssetCatalogEnvelope with fonts, BGM, SFX, and cover template slots.',
    validate(errors) {
      const path = spec.paths?.['/assets/catalog'];
      const catalog = schema(spec, 'AssetCatalog');
      const slot = schema(spec, 'AssetCatalogSlot');
      const entry = schema(spec, 'AssetCatalogEntry');
      requireEqual(errors, 'assets.catalog.operationId', path?.get?.operationId, 'getAssetCatalog');
      requireEqual(errors, 'assets.catalog.tags', path?.get?.tags, ['assets']);
      requireEqual(
        errors,
        'assets.catalog.200.schema.$ref',
        path?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref,
        '#/components/schemas/AssetCatalogEnvelope',
      );
      requireEqual(errors, 'AssetCatalog.required', catalog.required, ['schemaId', 'assetCatalogVersion', 'generatedAt', 'slots']);
      requireEqual(errors, 'AssetCatalog.properties.schemaId.const', catalog.properties?.schemaId?.const, 'video-cut.asset-catalog.schema.v1');
      requireEqual(errors, 'AssetCatalogSlot.properties.kind.enum', slot.properties?.kind?.enum, ['fonts', 'bgm', 'sfx', 'coverTemplates']);
      requireEqual(errors, 'AssetCatalogSlot.properties.status.enum', slot.properties?.status?.enum, ['available', 'not-configured', 'unavailable']);
      requireEqual(errors, 'AssetCatalogEntry.required', entry.required, ['assetId', 'path', 'fileName', 'sizeBytes', 'sha256', 'license', 'source', 'version']);
    },
  });
}

function checkRenderAssetPreferences(spec) {
  return contractCheck({
    id: 'render-asset-preferences-contract',
    evidence: 'VideoSplitPlan renderPreferences uses catalog-backed BGM/SFX asset preference contracts.',
    validate(errors) {
      const plan = schema(spec, 'VideoSplitPlan');
      const preferences = schema(spec, 'RenderPreferences');
      const assetPreference = schema(spec, 'RenderAudioAssetPreference');
      const manifest = schema(spec, 'RenderAttemptManifest');
      requireArrayContains(errors, 'VideoSplitPlan.required', plan.required, 'renderPreferences');
      requireEqual(errors, 'VideoSplitPlan.properties.renderPreferences.$ref', plan.properties?.renderPreferences?.$ref, '#/components/schemas/RenderPreferences');
      requireEqual(errors, 'RenderPreferences.required', preferences.required, ['audio']);
      requireEqual(errors, 'RenderPreferences.audio.required', preferences.properties?.audio?.required, ['bgm', 'bgmVolumePercent', 'sfx', 'voiceEnhancement']);
      requireEqual(errors, 'RenderPreferences.audio.bgm.$ref', preferences.properties?.audio?.properties?.bgm?.$ref, '#/components/schemas/RenderAudioAssetPreference');
      requireEqual(errors, 'RenderPreferences.audio.sfx.$ref', preferences.properties?.audio?.properties?.sfx?.$ref, '#/components/schemas/RenderAudioAssetPreference');
      requireEqual(errors, 'RenderAudioAssetPreference.mode.enum', assetPreference.properties?.mode?.enum, ['auto', 'asset', 'disabled']);
      requireEqual(errors, 'RenderAudioAssetPreference.path.pattern', assetPreference.properties?.path?.pattern, '^assets://(bgm|sfx)/[^\\\\/]+$');
      requireArrayContains(errors, 'RenderAttemptManifest.renderGraph.bgm.status.enum', manifest.properties?.renderGraph?.properties?.bgm?.properties?.status?.enum, 'disabled');
      requireArrayContains(errors, 'RenderAttemptManifest.renderGraph.sfx.status.enum', manifest.properties?.renderGraph?.properties?.sfx?.properties?.status?.enum, 'disabled');
    },
  });
}

function checkTaskRecoveryHints(spec) {
  return contractCheck({
    id: 'task-event-recovery-hints',
    evidence: 'VideoCutProgressEvent metadata exposes redacted TaskRecoveryHint actions for safe UI recovery.',
    validate(errors) {
      const event = schema(spec, 'VideoCutProgressEvent');
      const metadata = schema(spec, 'VideoCutProgressEventMetadata');
      const recoveryHint = schema(spec, 'TaskRecoveryHint');
      requireEqual(errors, 'VideoCutProgressEvent.level.enum', event.properties?.level?.enum, ['info', 'warn', 'error']);
      requireEqual(errors, 'VideoCutProgressEvent.metadata.$ref', event.properties?.metadata?.$ref, '#/components/schemas/VideoCutProgressEventMetadata');
      requireEqual(errors, 'VideoCutProgressEventMetadata.recoveryHint.$ref', metadata.properties?.recoveryHint?.$ref, '#/components/schemas/TaskRecoveryHint');
      requireEqual(errors, 'TaskRecoveryHint.required', recoveryHint.required, ['code', 'action', 'label', 'message', 'retryable']);
      requireEqual(errors, 'TaskRecoveryHint.action.enum', recoveryHint.properties?.action?.enum, [
        'upload-source',
        'retry-analysis',
        'retry-render',
        'open-settings',
        'open-diagnostics',
        'review-render-log',
        'none',
      ]);
      requireText(errors, 'TaskRecoveryHint.message.description', recoveryHint.properties?.message?.description, 'must not contain secrets or server-local paths');
    },
  });
}

function checkProviderContractPolicy(spec) {
  return contractCheck({
    id: 'provider-contract-policy',
    evidence: 'CapabilityReport includes ProviderContractPolicy and forbids Ollama-compatible drift in OpenAI-compatible profiles.',
    validate(errors) {
      const providerPolicy = schema(spec, 'ProviderContractPolicy');
      requireArrayContains(errors, 'CapabilityReport.required', schema(spec, 'CapabilityReport').required, 'providers');
      requireEqual(errors, 'ProviderContractPolicy.providerCapabilityVersion.const', providerPolicy.properties?.providerCapabilityVersion?.const, 'video-cut.provider-capability.schema.v1');
      requireEqual(errors, 'ProviderContractPolicy.openAiCompatible.ollamaAllowed.const', providerPolicy.properties?.openAiCompatible?.properties?.ollamaAllowed?.const, false);
    },
  });
}

function checkDeploymentDoctorContract(spec) {
  return contractCheck({
    id: 'deployment-doctor-runtime-report',
    evidence: 'GET /doctor returns DeploymentDoctorReport with health, capability, checks, and redacted config.',
    validate(errors) {
      const doctorReport = schema(spec, 'DeploymentDoctorReport');
      requireEqual(errors, 'doctor.operationId', spec.paths?.['/doctor']?.get?.operationId, 'getDeploymentDoctorReport');
      requireEqual(errors, 'DeploymentDoctorReport.required', doctorReport.required, [
        'reportVersion',
        'deploymentMode',
        'generatedAt',
        'health',
        'capability',
        'checks',
        'redactedConfig',
      ]);
      requireEqual(errors, 'DeploymentDoctorReport.reportVersion.const', doctorReport.properties?.reportVersion?.const, 'video-cut.doctor.v1');
      requireEqual(errors, 'DeploymentDoctorReport.capability.$ref', doctorReport.properties?.capability?.$ref, '#/components/schemas/CapabilityReport');
      requireEqual(errors, 'DeploymentDoctorReport.checks.items.$ref', doctorReport.properties?.checks?.items?.$ref, '#/components/schemas/DeploymentDoctorCheck');
    },
  });
}

function checkCorsSettingsContract(spec) {
  return contractCheck({
    id: 'cors-origin-allowlist-settings',
    evidence: 'SecuritySettings declares corsAllowedOrigins as a standard string allowlist.',
    validate(errors) {
      const securitySettings = schema(spec, 'SecuritySettings');
      requireArrayContains(errors, 'SecuritySettings.required', securitySettings.required, 'corsAllowedOrigins');
      requireEqual(errors, 'SecuritySettings.corsAllowedOrigins.items.type', securitySettings.properties?.corsAllowedOrigins?.items?.type, 'string');
      requireText(errors, 'SecuritySettings.corsAllowedOrigins.description', securitySettings.properties?.corsAllowedOrigins?.description, 'CORS');
    },
  });
}

function checkDiagnosticsBundleContract(spec) {
  return contractCheck({
    id: 'redacted-diagnostics-bundle',
    evidence: 'GET /diagnostics/bundle returns a redacted DiagnosticBundle with doctor and capability evidence.',
    validate(errors) {
      const diagnosticBundle = schema(spec, 'DiagnosticBundle');
      requireEqual(errors, 'diagnostics.bundle.operationId', spec.paths?.['/diagnostics/bundle']?.get?.operationId, 'exportDiagnosticsBundle');
      requireEqual(errors, 'DiagnosticBundle.required', diagnosticBundle.required, [
        'bundleVersion',
        'generatedAt',
        'deploymentMode',
        'includes',
        'capability',
        'doctor',
        'redactedConfig',
        'artifacts',
      ]);
      requireEqual(errors, 'DiagnosticBundle.bundleVersion.const', diagnosticBundle.properties?.bundleVersion?.const, 'video-cut.diagnostics-bundle.v1');
      requireEqual(errors, 'DiagnosticBundle.doctor.$ref', diagnosticBundle.properties?.doctor?.$ref, '#/components/schemas/DeploymentDoctorReport');
    },
  });
}

function checkDiagnosticsSupportBundleContract(spec) {
  return contractCheck({
    id: 'diagnostics-support-bundle-consent',
    evidence: 'POST /diagnostics/support-bundle requires explicit consent and returns host-relative redacted attachment descriptors.',
    validate(errors) {
      const path = spec.paths?.['/diagnostics/support-bundle'];
      const request = schema(spec, 'DiagnosticSupportBundleRequest');
      const artifact = schema(spec, 'DiagnosticBundleArtifact');
      const diagnosticBundle = schema(spec, 'DiagnosticBundle');
      requireEqual(errors, 'diagnostics.support.operationId', path?.post?.operationId, 'exportDiagnosticsSupportBundle');
      requireEqual(errors, 'diagnostics.support.requestBody.schema.$ref', path?.post?.requestBody?.content?.['application/json']?.schema?.$ref, '#/components/schemas/DiagnosticSupportBundleRequest');
      requireEqual(errors, 'diagnostics.support.200.schema.$ref', path?.post?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/DiagnosticBundleEnvelope');
      requireText(errors, 'diagnostics.support.400.description', path?.post?.responses?.['400']?.description, 'DIAGNOSTICS_CONSENT_REQUIRED');
      requireEqual(errors, 'DiagnosticSupportBundleRequest.required', request.required, ['includeSourceMedia', 'includeTranscript', 'consentAccepted']);
      requireText(errors, 'DiagnosticSupportBundleRequest.consentAccepted.description', request.properties?.consentAccepted?.description, 'explicit user consent');
      requireEqual(errors, 'DiagnosticBundle.supportRequest.$ref', diagnosticBundle.properties?.supportRequest?.$ref, '#/components/schemas/DiagnosticSupportBundleRequestEvidence');
      requireEqual(errors, 'DiagnosticBundle.artifacts.items.$ref', diagnosticBundle.properties?.artifacts?.items?.$ref, '#/components/schemas/DiagnosticBundleArtifact');
      requireEqual(errors, 'DiagnosticBundleArtifact.required', artifact.required, ['kind', 'included', 'redacted']);
      requireEqual(errors, 'DiagnosticBundleArtifact.kind.enum', artifact.properties?.kind?.enum, ['sourceMedia', 'transcript']);
      requireText(errors, 'DiagnosticBundleArtifact.contentRef.description', artifact.properties?.contentRef?.description, 'host-relative');
    },
  });
}

function checkDiagnosticsRedactedPathPlaceholders(spec) {
  return contractCheck({
    id: 'diagnostics-redacted-path-placeholders',
    evidence: 'Doctor and diagnostics settings use RedactedVideoCutSettings with <redacted-path> storage placeholders.',
    validate(errors) {
      const doctorReport = schema(spec, 'DeploymentDoctorReport');
      const diagnosticBundle = schema(spec, 'DiagnosticBundle');
      const redactedSettings = schema(spec, 'RedactedVideoCutSettings');
      const redactedStorage = schema(spec, 'RedactedStorageSettings');
      const doctorCheck = schema(spec, 'DeploymentDoctorCheck');
      requireEqual(errors, 'DeploymentDoctorReport.redactedConfig.$ref', doctorReport.properties?.redactedConfig?.$ref, '#/components/schemas/RedactedVideoCutSettings');
      requireEqual(errors, 'DiagnosticBundle.redactedConfig.$ref', diagnosticBundle.properties?.redactedConfig?.$ref, '#/components/schemas/RedactedVideoCutSettings');
      requireEqual(errors, 'RedactedVideoCutSettings.required', redactedSettings.required, schema(spec, 'VideoCutSettings').required);
      requireEqual(errors, 'RedactedVideoCutSettings.storage.$ref', redactedSettings.properties?.storage?.$ref, '#/components/schemas/RedactedStorageSettings');
      requireEqual(errors, 'RedactedStorageSettings.required', redactedStorage.required, ['workspaceRoot', 'artifactRoot', 'tempRoot', 'retentionDays']);

      for (const pathField of ['workspaceRoot', 'artifactRoot', 'tempRoot']) {
        const field = redactedStorage.properties?.[pathField];
        requireText(errors, `RedactedStorageSettings.${pathField}.description`, field?.description, '<redacted-path>');
        if (!Array.isArray(field?.anyOf) || !field.anyOf.some((entry) => entry?.const === '<redacted-path>')) {
          errors.push(`RedactedStorageSettings.${pathField}.anyOf must allow <redacted-path>`);
        }
      }

      requireText(errors, 'DeploymentDoctorCheck.details.description', doctorCheck.properties?.details?.description, '<redacted-path>');
    },
  });
}

function checkProviderConformanceContract(spec) {
  return contractCheck({
    id: 'openai-compatible-provider-conformance',
    evidence: 'POST /providers/openai-compatible/conformance returns a redacted ProviderConformanceReportEnvelope.',
    validate(errors) {
      const path = spec.paths?.['/providers/openai-compatible/conformance'];
      const report = schema(spec, 'ProviderConformanceReport');
      const check = schema(spec, 'ProviderConformanceCheck');
      requireEqual(errors, 'provider.conformance.operationId', path?.post?.operationId, 'runOpenAiCompatibleProviderConformance');
      requireEqual(errors, 'provider.conformance.requestBody.schema.$ref', path?.post?.requestBody?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ProviderConformanceRequest');
      requireEqual(errors, 'provider.conformance.200.schema.$ref', path?.post?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ProviderConformanceReportEnvelope');
      requireEqual(errors, 'ProviderConformanceReport.reportVersion.const', report.properties?.reportVersion?.const, 'video-cut.provider-conformance.v1');
      requireEqual(errors, 'ProviderConformanceReport.checks.items.$ref', report.properties?.checks?.items?.$ref, '#/components/schemas/ProviderConformanceCheck');
      requireText(errors, 'ProviderConformanceCheck.details.description', check.properties?.details?.description, 'credentialStatus');
      requireText(errors, 'ProviderConformanceCheck.details.description', check.properties?.details?.description, 'must not include secret refs');
    },
  });
}

function checkSpeechProviderProfiles(spec) {
  return contractCheck({
    id: 'canonical-speech-provider-profiles',
    evidence: 'Provider policy and SpeechToTextSettings declare the canonical speech provider profiles and resourceId.',
    validate(errors) {
      const policy = schema(spec, 'ProviderContractPolicy');
      const speech = schema(spec, 'SpeechToTextSettings');
      requireArrayContains(errors, 'ProviderContractPolicy.required', policy.required, 'speechToTextProviderProfiles');
      requireEqual(errors, 'ProviderContractPolicy.speechToTextProviderProfiles.items.enum', policy.properties?.speechToTextProviderProfiles?.items?.enum, SPEECH_PROVIDER_PROFILES);
      requireArrayContains(errors, 'SpeechToTextSettings.required', speech.required, 'providerProfile');
      requireArrayContains(errors, 'SpeechToTextSettings.required', speech.required, 'resourceId');
      requireEqual(errors, 'SpeechToTextSettings.providerProfile.enum', speech.properties?.providerProfile?.enum, SPEECH_PROVIDER_PROFILES);
      requireText(errors, 'SpeechToTextSettings.resourceId.description', speech.properties?.resourceId?.description, 'Volcengine');
    },
  });
}

function checkMultipartSourceUpload(spec) {
  return contractCheck({
    id: 'multipart-source-file-upload',
    evidence: 'POST /tasks/{taskId}/source/file declares multipart video upload and standard source upload errors.',
    validate(errors) {
      const path = spec.paths?.['/tasks/{taskId}/source/file'];
      const requestContent = path?.post?.requestBody?.content?.['multipart/form-data'];
      requireEqual(errors, 'source.file.operationId', path?.post?.operationId, 'uploadTaskSourceFile');
      requireText(errors, 'source.file.encoding.file.contentType', requestContent?.encoding?.file?.contentType, 'video/mp4');
      requireText(errors, 'source.file.encoding.file.contentType', requestContent?.encoding?.file?.contentType, 'video/webm');
      requireEqual(errors, 'source.file.schema.properties.file.format', requestContent?.schema?.properties?.file?.format, 'binary');
      requireEqual(errors, 'source.file.200.schema.$ref', path?.post?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/VideoCutArtifactEnvelope');
      requireText(errors, 'source.file.400.description', path?.post?.responses?.['400']?.description, 'SOURCE_FILE_TYPE_UNSUPPORTED');
      requireText(errors, 'source.file.400.description', path?.post?.responses?.['400']?.description, 'MULTIPART_INVALID');
    },
  });
}

function checkRenderFailureEnvelopes(spec) {
  return contractCheck({
    id: 'single-render-failure-envelopes',
    evidence: 'POST /tasks/{taskId}/render declares standard success, bad-request, conflict, and unprocessable envelopes.',
    validate(errors) {
      const path = spec.paths?.['/tasks/{taskId}/render'];
      requireEqual(errors, 'render.operationId', path?.post?.operationId, 'renderTask');
      requireEqual(errors, 'render.200.schema.$ref', path?.post?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/VideoCutTaskEnvelope');
      requireEqual(errors, 'render.400.schema.$ref', path?.post?.responses?.['400']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ApiErrorEnvelope');
      requireEqual(errors, 'render.409.$ref', path?.post?.responses?.['409']?.$ref, '#/components/responses/ConflictError');
      requireEqual(errors, 'render.422.schema.$ref', path?.post?.responses?.['422']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ApiErrorEnvelope');
    },
  });
}

function checkBatchRenderEnvelopes(spec) {
  return contractCheck({
    id: 'batch-render-failure-envelopes',
    evidence: 'POST /tasks/{taskId}/render/batch declares standard success, bad-request, conflict, and unprocessable envelopes.',
    validate(errors) {
      const path = spec.paths?.['/tasks/{taskId}/render/batch'];
      requireEqual(errors, 'render.batch.operationId', path?.post?.operationId, 'renderTaskBatch');
      requireEqual(errors, 'render.batch.200.schema.$ref', path?.post?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/VideoCutTaskEnvelope');
      requireEqual(errors, 'render.batch.400.schema.$ref', path?.post?.responses?.['400']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ApiErrorEnvelope');
      requireEqual(errors, 'render.batch.409.$ref', path?.post?.responses?.['409']?.$ref, '#/components/responses/ConflictError');
      requireEqual(errors, 'render.batch.422.schema.$ref', path?.post?.responses?.['422']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ApiErrorEnvelope');
    },
  });
}

function checkManualTranscriptImport(spec) {
  return contractCheck({
    id: 'manual-transcript-import',
    evidence: 'PUT /tasks/{taskId}/transcript accepts ManualTranscriptInput and returns TranscriptDocumentEnvelope.',
    validate(errors) {
      const path = spec.paths?.['/tasks/{taskId}/transcript'];
      requireEqual(errors, 'transcript.operationId', path?.put?.operationId, 'updateTaskTranscript');
      requireEqual(errors, 'transcript.requestBody.schema.$ref', path?.put?.requestBody?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ManualTranscriptInput');
      requireEqual(errors, 'transcript.200.schema.$ref', path?.put?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/TranscriptDocumentEnvelope');
      requireEqual(errors, 'ManualTranscriptInput.required', schema(spec, 'ManualTranscriptInput').required, ['segments']);
      requireEqual(errors, 'ManualTranscriptInput.segments.items.$ref', schema(spec, 'ManualTranscriptInput').properties?.segments?.items?.$ref, '#/components/schemas/ManualTranscriptSegmentInput');
    },
  });
}

function checkSubtitleImportExport(spec) {
  return contractCheck({
    id: 'subtitle-import-export-adapters',
    evidence: 'SRT/VTT subtitle import and export use standard transcript and subtitle output envelopes.',
    validate(errors) {
      const importPath = spec.paths?.['/tasks/{taskId}/subtitles/import'];
      const exportPath = spec.paths?.['/tasks/{taskId}/subtitles/export'];
      requireEqual(errors, 'subtitles.import.operationId', importPath?.put?.operationId, 'importTaskSubtitles');
      requireEqual(errors, 'subtitles.import.requestBody.schema.$ref', importPath?.put?.requestBody?.content?.['application/json']?.schema?.$ref, '#/components/schemas/SubtitleImportInput');
      requireEqual(errors, 'subtitles.import.200.schema.$ref', importPath?.put?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/TranscriptDocumentEnvelope');
      requireEqual(errors, 'subtitles.export.operationId', exportPath?.get?.operationId, 'exportTaskSubtitles');
      if (!Array.isArray(exportPath?.get?.parameters) || !exportPath.get.parameters.some((parameter) => parameter?.name === 'format' && deepEqual(parameter?.schema?.enum, ['srt', 'vtt']))) {
        errors.push('subtitles.export.parameters must include format enum [srt, vtt]');
      }
      requireEqual(errors, 'subtitles.export.200.schema.$ref', exportPath?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/SubtitleExportOutputEnvelope');
    },
  });
}

function checkBinaryArtifactContentServing(spec) {
  return contractCheck({
    id: 'binary-artifact-content-serving',
    evidence: 'GET /tasks/{taskId}/artifacts/{artifactId}/content serves private binary content, ranges, and no-store security headers.',
    validate(errors) {
      const path = spec.paths?.['/tasks/{taskId}/artifacts/{artifactId}/content'];
      const descriptor = schema(spec, 'ArtifactDownloadDescriptor');
      requireEqual(errors, 'artifact.content.operationId', path?.get?.operationId, 'getArtifactContent');
      requireArrayContains(errors, 'ArtifactDownloadDescriptor.required', descriptor.required, 'url');
      requireArrayContains(errors, 'ArtifactDownloadDescriptor.downloadMode.enum', descriptor.properties?.downloadMode?.enum, 'host-content-endpoint');
      for (const contentType of ['video/mp4', 'image/png', 'text/x-ssa', 'application/octet-stream']) {
        requireEqual(errors, `artifact.content.200.content.${contentType}.schema`, path?.get?.responses?.['200']?.content?.[contentType]?.schema, {
          type: 'string',
          format: 'binary',
        });
      }
      requireSecurityHeaders(errors, 'artifact.content.200.headers', path?.get?.responses?.['200']?.headers, { acceptRanges: false });
      requireText(errors, 'artifact.content.206.description', path?.get?.responses?.['206']?.description, 'Partial artifact content');
      requireSecurityHeaders(errors, 'artifact.content.206.headers', path?.get?.responses?.['206']?.headers, { acceptRanges: true, contentRange: true });
      requireText(errors, 'artifact.content.416.description', path?.get?.responses?.['416']?.description, 'range cannot be satisfied');
      requireSecurityHeaders(errors, 'artifact.content.416.headers', path?.get?.responses?.['416']?.headers, { acceptRanges: false });
      requireEqual(errors, 'artifact.content.404', path?.get?.responses?.['404'], { $ref: '#/components/responses/NotFoundError' });
    },
  });
}

function checkRenderManifestArtifacts(spec) {
  return contractCheck({
    id: 'render-manifest-artifact-provenance',
    evidence: 'Render manifest artifacts describe FFmpeg render provenance, audio graph, codec, and catalog-backed assets.',
    validate(errors) {
      const artifactKind = schema(spec, 'VideoCutArtifact').properties?.kind;
      const renderManifest = schema(spec, 'RenderAttemptManifest');
      const settings = schema(spec, 'VideoCutSettings');
      requireArrayContains(errors, 'VideoCutArtifact.kind.enum', artifactKind?.enum, 'render-manifest');
      requireArrayContains(errors, 'VideoCutSettings.required', settings.required, 'assets');
      requireEqual(errors, 'AssetSettings.required', schema(spec, 'AssetSettings').required, ['fonts', 'bgm', 'sfx', 'coverTemplates']);
      requireEqual(errors, 'RenderAttemptManifest.schemaId.const', renderManifest.properties?.schemaId?.const, 'video-cut.render-attempt.schema.v1');
      requireEqual(errors, 'RenderAttemptManifest.required', renderManifest.required, [
        'schemaId',
        'renderAttemptVersion',
        'taskId',
        'renderId',
        'planId',
        'planRevision',
        'sourceArtifactId',
        'outputArtifactId',
        'subtitleArtifactId',
        'coverArtifactId',
        'logArtifactId',
        'subtitleBurnIn',
        'subtitleCueCount',
        'sourceRange',
        'outputSpec',
        'renderGraph',
        'warnings',
        'createdAt',
      ]);

      const renderGraph = renderManifest.properties?.renderGraph;
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.required', renderGraph?.required, [
        'engine',
        'adapterVersion',
        'videoFilterPreset',
        'audioFilterPreset',
        'voiceEnhancement',
        'bgm',
        'sfx',
        'codec',
      ]);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.audioFilterPreset.const', renderGraph?.properties?.audioFilterPreset?.const, 'voice-basic-loudnorm-afftdn.v1');
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.voiceEnhancement.required', renderGraph?.properties?.voiceEnhancement?.required, ['status', 'filters']);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.voiceEnhancement.status.enum', renderGraph?.properties?.voiceEnhancement?.properties?.status?.enum, ['applied', 'skipped', 'failed']);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.voiceEnhancement.filters.items.enum', renderGraph?.properties?.voiceEnhancement?.properties?.filters?.items?.enum, ['loudnorm', 'afftdn']);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.bgm.required', renderGraph?.properties?.bgm?.required, ['status', 'mixed', 'volumePercent']);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.bgm.volumePercent.const', renderGraph?.properties?.bgm?.properties?.volumePercent?.const, 20);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.bgm.asset.$ref', renderGraph?.properties?.bgm?.properties?.asset?.$ref, '#/components/schemas/RenderAudioAssetProvenance');
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.sfx.required', renderGraph?.properties?.sfx?.required, ['status', 'mixed']);
      requireEqual(errors, 'RenderAttemptManifest.renderGraph.sfx.asset.$ref', renderGraph?.properties?.sfx?.properties?.asset?.$ref, '#/components/schemas/RenderAudioAssetProvenance');
      requireEqual(errors, 'RenderAudioAssetProvenance.required', schema(spec, 'RenderAudioAssetProvenance').required, [
        'assetId',
        'path',
        'sha256',
        'license',
        'source',
        'version',
      ]);
    },
  });
}

function checkMediaInfoSchema(spec) {
  return contractCheck({
    id: 'media-info-analysis-schema',
    evidence: 'MediaInfoDocument declares canonical probe status, format, video streams, audio streams, and provenance fields.',
    validate(errors) {
      const mediaInfo = schema(spec, 'MediaInfoDocument');
      requireEqual(errors, 'MediaInfoDocument.required', mediaInfo.required, [
        'schemaId',
        'mediaInfoVersion',
        'taskId',
        'sourceArtifactId',
        'sourcePath',
        'providerId',
        'adapterVersion',
        'probeStatus',
        'format',
        'videoStreams',
        'audioStreams',
        'warnings',
        'createdAt',
      ]);
      requireEqual(errors, 'MediaInfoDocument.schemaId.const', mediaInfo.properties?.schemaId?.const, 'video-cut.media-info.schema.v1');
      requireEqual(errors, 'MediaInfoDocument.probeStatus.$ref', mediaInfo.properties?.probeStatus?.$ref, '#/components/schemas/MediaProbeStatus');
      requireEqual(errors, 'MediaInfoDocument.format.$ref', mediaInfo.properties?.format?.$ref, '#/components/schemas/MediaFormatInfo');
      requireEqual(errors, 'MediaInfoDocument.videoStreams.items.$ref', mediaInfo.properties?.videoStreams?.items?.$ref, '#/components/schemas/MediaVideoStream');
      requireEqual(errors, 'MediaInfoDocument.audioStreams.items.$ref', mediaInfo.properties?.audioStreams?.items?.$ref, '#/components/schemas/MediaAudioStream');
    },
  });
}

function checkAudioAndSilenceSchemas(spec) {
  return contractCheck({
    id: 'audio-extract-and-silence-range-schemas',
    evidence: 'Audio extraction and silence range analysis use standard schema ids, statuses, and range items.',
    validate(errors) {
      const artifactKind = schema(spec, 'VideoCutArtifact').properties?.kind;
      const audioExtract = schema(spec, 'AudioExtractDocument');
      const silenceRanges = schema(spec, 'SilenceRangesDocument');
      requireArrayContains(errors, 'VideoCutArtifact.kind.enum', artifactKind?.enum, 'audio');
      requireEqual(errors, 'AudioExtractDocument.schemaId.const', audioExtract.properties?.schemaId?.const, 'video-cut.audio-extract.schema.v1');
      requireEqual(errors, 'AudioExtractDocument.extractStatus.$ref', audioExtract.properties?.extractStatus?.$ref, '#/components/schemas/AudioExtractStatus');
      requireEqual(errors, 'AudioExtractDocument.audio.$ref', audioExtract.properties?.audio?.$ref, '#/components/schemas/ExtractedAudioInfo');
      requireEqual(errors, 'SilenceRangesDocument.schemaId.const', silenceRanges.properties?.schemaId?.const, 'video-cut.silence-ranges.schema.v1');
      requireEqual(errors, 'SilenceRangesDocument.detectionStatus.$ref', silenceRanges.properties?.detectionStatus?.$ref, '#/components/schemas/SilenceDetectionStatus');
      requireEqual(errors, 'SilenceRangesDocument.ranges.items.$ref', silenceRanges.properties?.ranges?.items?.$ref, '#/components/schemas/SilenceRange');
    },
  });
}

function checkVadSchema(spec) {
  return contractCheck({
    id: 'vad-speech-activity-schema',
    evidence: 'VadRangesDocument declares standard VAD status, parameters, and range item schemas.',
    validate(errors) {
      const vadRanges = schema(spec, 'VadRangesDocument');
      requireEqual(errors, 'VadRangesDocument.schemaId.const', vadRanges.properties?.schemaId?.const, 'video-cut.vad-ranges.schema.v1');
      requireEqual(errors, 'VadRangesDocument.vadStatus.$ref', vadRanges.properties?.vadStatus?.$ref, '#/components/schemas/VadStatus');
      requireEqual(errors, 'VadRangesDocument.parameters.$ref', vadRanges.properties?.parameters?.$ref, '#/components/schemas/VadParameters');
      requireEqual(errors, 'VadRangesDocument.ranges.items.$ref', vadRanges.properties?.ranges?.items?.$ref, '#/components/schemas/VadRange');
    },
  });
}

function checkTranscriptSchema(spec) {
  return contractCheck({
    id: 'transcription-analysis-schema',
    evidence: 'TranscriptDocument declares standard transcript status, timestamp granularity, and segment item schemas.',
    validate(errors) {
      const transcript = schema(spec, 'TranscriptDocument');
      requireEqual(errors, 'TranscriptDocument.schemaId.const', transcript.properties?.schemaId?.const, 'video-cut.transcript.schema.v1');
      requireEqual(errors, 'TranscriptDocument.transcriptStatus.$ref', transcript.properties?.transcriptStatus?.$ref, '#/components/schemas/TranscriptStatus');
      requireEqual(errors, 'TranscriptDocument.timestampGranularity.items.$ref', transcript.properties?.timestampGranularity?.items?.$ref, '#/components/schemas/TimestampGranularity');
      requireEqual(errors, 'TranscriptDocument.segments.items.$ref', transcript.properties?.segments?.items?.$ref, '#/components/schemas/TranscriptSegment');
    },
  });
}

function checkSemanticAnalysisSchema(spec) {
  return contractCheck({
    id: 'semantic-analysis-schema',
    evidence: 'SemanticAnalysisDocument declares standard semantic status, topics, and QA candidate schemas.',
    validate(errors) {
      const semantic = schema(spec, 'SemanticAnalysisDocument');
      requireEqual(errors, 'SemanticAnalysisDocument.schemaId.const', semantic.properties?.schemaId?.const, 'video-cut.semantic-analysis.schema.v1');
      requireEqual(errors, 'SemanticAnalysisDocument.semanticStatus.$ref', semantic.properties?.semanticStatus?.$ref, '#/components/schemas/SemanticAnalysisStatus');
      requireEqual(errors, 'SemanticAnalysisDocument.topics.items.$ref', semantic.properties?.topics?.items?.$ref, '#/components/schemas/SemanticTopic');
      requireEqual(errors, 'SemanticAnalysisDocument.qaCandidates.items.$ref', semantic.properties?.qaCandidates?.items?.$ref, '#/components/schemas/QaCandidate');
    },
  });
}

function checkRuntimeEnvironmentTemplate(envExample) {
  return contractCheck({
    id: 'runtime-env-template-no-vite-host-config',
    evidence: '.env.example uses SDKWORK_VIDEO_CUT_* runtime variables and keeps browser host config out of Vite build-time env.',
    validate(errors) {
      requireText(errors, `${ENV_EXAMPLE_PATH}`, envExample, 'SDKWORK_VIDEO_CUT_RUNTIME_MODE=desktop-local');
      requireText(errors, `${ENV_EXAMPLE_PATH}`, envExample, 'SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=./workspace');
      requireTextAbsent(errors, `${ENV_EXAMPLE_PATH}`, envExample, 'VITE_VIDEO_CUT_HOST_MODE');
      requireTextAbsent(errors, `${ENV_EXAMPLE_PATH}`, envExample, 'VITE_VIDEO_CUT_HOST_BASE_URL');
    },
  });
}

function requireSecurityHeaders(errors, label, headers, { acceptRanges = false, contentRange = false } = {}) {
  if (acceptRanges) {
    requireEqual(errors, `${label}.Accept-Ranges.schema.const`, headers?.['Accept-Ranges']?.schema?.const, 'bytes');
  }
  if (contentRange) {
    requireEqual(errors, `${label}.Content-Range.schema.type`, headers?.['Content-Range']?.schema?.type, 'string');
  }
  requireEqual(errors, `${label}.Cache-Control.schema.const`, headers?.['Cache-Control']?.schema?.const, 'private, no-store');
  requireEqual(errors, `${label}.Pragma.schema.const`, headers?.Pragma?.schema?.const, 'no-cache');
  requireEqual(errors, `${label}.X-Content-Type-Options.schema.const`, headers?.['X-Content-Type-Options']?.schema?.const, 'nosniff');
}

function schema(spec, name) {
  return spec.components?.schemas?.[name] ?? {};
}

function contractCheck({ evidence, id, validate }) {
  const errors = [];
  try {
    validate(errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return checkResult({
    id,
    passed: errors.length === 0,
    evidence,
    failMessage: `${id} drift: ${errors.join('; ')}`,
  });
}

function requireEqual(errors, label, actual, expected) {
  if (!deepEqual(actual, expected)) {
    errors.push(`${label} must be ${formatValue(expected)}; actual=${formatValue(actual)}`);
  }
}

function requireArrayContains(errors, label, actual, expectedItem) {
  if (!Array.isArray(actual) || !actual.some((item) => deepEqual(item, expectedItem))) {
    errors.push(`${label} must contain ${formatValue(expectedItem)}`);
  }
}

function requireArrayContainsAll(errors, label, actual, expectedItems) {
  const missing = expectedItems.filter((item) => !Array.isArray(actual) || !actual.includes(item));
  if (missing.length > 0) {
    errors.push(`${label} missing: ${missing.join(', ')}`);
  }
}

function requireText(errors, label, actual, token) {
  if (!String(actual ?? '').includes(token)) {
    errors.push(`${label} must contain ${token}`);
  }
}

function requireTextAbsent(errors, label, actual, token) {
  if (String(actual ?? '').includes(token)) {
    errors.push(`${label} must not contain ${token}`);
  }
}

function checkResult({ evidence, failMessage, id, passed }) {
  return {
    id,
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

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatValue(value) {
  return JSON.stringify(value);
}

function readYamlDocument(projectRoot, path) {
  const text = readText(projectRoot, path);
  if (!text) {
    return { value: undefined, error: `${path} is missing or empty.` };
  }

  try {
    return { value: YAML.parse(text), error: '' };
  } catch (error) {
    return { value: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

function readText(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut OpenAPI Contracts',
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  try {
    const options = parseOpenApiContractsArgs(process.argv.slice(2));
    const report = createOpenApiContractsReport({ reportDir: options.reportDir });

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
            code: 'OPENAPI_CONTRACTS_FAILED',
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
