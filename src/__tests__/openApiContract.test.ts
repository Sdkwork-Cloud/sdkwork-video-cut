import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

const openApiPath = resolve(process.cwd(), 'docs/openapi/video-cut-v1.yaml');
const envExamplePath = resolve(process.cwd(), '.env.example');

function readOpenApi(): Record<string, any> {
  return YAML.parse(readFileSync(openApiPath, 'utf8')) as Record<string, any>;
}

describe('video cut OpenAPI contract', () => {
  it('declares the canonical OpenAPI 3.1 video-cut v1 surface', () => {
    const spec = readOpenApi();

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.version).toBe('0.1.0');
    expect(spec.servers).toEqual([
      {
        url: '/api/video-cut/v1',
      },
    ]);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('defines canonical success and error envelopes', () => {
    const spec = readOpenApi();

    expect(spec.components.schemas.ApiErrorEnvelope.required).toEqual(['ok', 'error']);
    expect(spec.components.schemas.ApiErrorEnvelope.properties.ok.const).toBe(false);
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('REQUEST_JSON_INVALID');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('MULTIPART_INVALID');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('PATH_PARAMETER_INVALID');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('QUERY_PARAMETER_INVALID');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('TASK_NOT_FOUND');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('TASK_PLAN_NOT_FOUND');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('ROUTE_NOT_FOUND');
    expect(spec.components.schemas.ApiError.properties.code.description).toContain('METHOD_NOT_ALLOWED');
    expect(spec.components.responses.BadRequestError.description).toContain('REQUEST_JSON_INVALID');
    expect(spec.components.responses.BadRequestError.description).toContain('MULTIPART_INVALID');
    expect(spec.components.responses.BadRequestError.description).toContain('PATH_PARAMETER_INVALID');
    expect(spec.components.responses.BadRequestError.description).toContain('QUERY_PARAMETER_INVALID');
    expect(spec.components.responses.NotFoundError.description).toContain('TASK_NOT_FOUND');
    expect(spec.components.responses.NotFoundError.description).toContain('TASK_PLAN_NOT_FOUND');
    expect(spec.components.schemas.ApiSuccessEnvelope.required).toEqual(['ok', 'data']);
    expect(spec.components.schemas.ApiSuccessEnvelope.properties.ok.const).toBe(true);
  });

  it('declares precise split-plan not-found codes for the task plan endpoint', () => {
    const spec = readOpenApi();
    const response = spec.paths['/tasks/{taskId}/plan'].get.responses['404'];

    expect(response.description).toContain('TASK_NOT_FOUND');
    expect(response.description).toContain('TASK_PLAN_NOT_FOUND');
    expect(response.content['application/json'].schema.$ref).toBe('#/components/schemas/ApiErrorEnvelope');
  });

  it('keeps required domain schemas in the public contract', () => {
    const spec = readOpenApi();

    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('declares optional capability diagnostics for runtime tool checks', () => {
    const spec = readOpenApi();
    const capabilityStatus = spec.components.schemas.CapabilityStatus;

    expect(capabilityStatus.properties.checkedTools.additionalProperties.type).toBe('string');
    expect(capabilityStatus.properties.missingTools.items.type).toBe('string');
  });

  it('declares the standard asset catalog endpoint and schema', () => {
    const spec = readOpenApi();
    const path = spec.paths['/assets/catalog'];
    const catalog = spec.components.schemas.AssetCatalog;
    const slot = spec.components.schemas.AssetCatalogSlot;
    const entry = spec.components.schemas.AssetCatalogEntry;

    expect(path.get.operationId).toBe('getAssetCatalog');
    expect(path.get.tags).toEqual(['assets']);
    expect(path.get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/AssetCatalogEnvelope');
    expect(catalog.required).toEqual(['schemaId', 'assetCatalogVersion', 'generatedAt', 'slots']);
    expect(catalog.properties.schemaId.const).toBe('video-cut.asset-catalog.schema.v1');
    expect(slot.properties.kind.enum).toEqual(['fonts', 'bgm', 'sfx', 'coverTemplates']);
    expect(slot.properties.status.enum).toEqual(['available', 'not-configured', 'unavailable']);
    expect(entry.required).toEqual(['assetId', 'path', 'fileName', 'sizeBytes', 'sha256', 'license', 'source', 'version']);
  });

  it('declares split-plan render asset preferences as a standard catalog-backed contract', () => {
    const spec = readOpenApi();
    const plan = spec.components.schemas.VideoSplitPlan;
    const preferences = spec.components.schemas.RenderPreferences;
    const assetPreference = spec.components.schemas.RenderAudioAssetPreference;
    const manifest = spec.components.schemas.RenderAttemptManifest;

    expect(plan.required).toContain('renderPreferences');
    expect(plan.properties.renderPreferences.$ref).toBe('#/components/schemas/RenderPreferences');
    expect(preferences.required).toEqual(['audio']);
    expect(preferences.properties.audio.required).toEqual(['bgm', 'bgmVolumePercent', 'sfx', 'voiceEnhancement']);
    expect(preferences.properties.audio.properties.bgm.$ref).toBe('#/components/schemas/RenderAudioAssetPreference');
    expect(preferences.properties.audio.properties.sfx.$ref).toBe('#/components/schemas/RenderAudioAssetPreference');
    expect(assetPreference.properties.mode.enum).toEqual(['auto', 'asset', 'disabled']);
    expect(assetPreference.properties.path.pattern).toBe('^assets://(bgm|sfx)/[^\\\\/]+$');
    expect(manifest.properties.renderGraph.properties.bgm.properties.status.enum).toContain('disabled');
    expect(manifest.properties.renderGraph.properties.sfx.properties.status.enum).toContain('disabled');
  });

  it('declares task event recovery hints as standard redacted metadata', () => {
    const spec = readOpenApi();
    const event = spec.components.schemas.VideoCutProgressEvent;
    const metadata = spec.components.schemas.VideoCutProgressEventMetadata;
    const recoveryHint = spec.components.schemas.TaskRecoveryHint;

    expect(event.properties.level.enum).toEqual(['info', 'warn', 'error']);
    expect(event.properties.metadata.$ref).toBe('#/components/schemas/VideoCutProgressEventMetadata');
    expect(metadata.properties.recoveryHint.$ref).toBe('#/components/schemas/TaskRecoveryHint');
    expect(recoveryHint.required).toEqual(['code', 'action', 'label', 'message', 'retryable']);
    expect(recoveryHint.properties.action.enum).toEqual([
      'upload-source',
      'retry-analysis',
      'retry-render',
      'open-settings',
      'open-diagnostics',
      'review-render-log',
      'none',
    ]);
    expect(recoveryHint.properties.message.description).toContain('must not contain secrets or server-local paths');
  });

  it('declares provider contract policy in capability reports', () => {
    const spec = readOpenApi();
    const providerPolicy = spec.components.schemas.ProviderContractPolicy;

    expect(spec.components.schemas.CapabilityReport.required).toContain('providers');
    expect(providerPolicy.properties.providerCapabilityVersion.const).toBe('video-cut.provider-capability.schema.v1');
    expect(providerPolicy.properties.openAiCompatible.properties.ollamaAllowed.const).toBe(false);
  });

  it('declares deployment doctor as a reusable runtime report', () => {
    const spec = readOpenApi();
    const doctorReport = spec.components.schemas.DeploymentDoctorReport;

    expect(spec.paths['/doctor'].get.operationId).toBe('getDeploymentDoctorReport');
    expect(doctorReport.required).toEqual([
      'reportVersion',
      'deploymentMode',
      'generatedAt',
      'health',
      'capability',
      'checks',
      'redactedConfig',
    ]);
    expect(doctorReport.properties.reportVersion.const).toBe('video-cut.doctor.v1');
    expect(doctorReport.properties.capability.$ref).toBe('#/components/schemas/CapabilityReport');
    expect(doctorReport.properties.checks.items.$ref).toBe('#/components/schemas/DeploymentDoctorCheck');
  });

  it('declares CORS origin allowlist as part of the security settings contract', () => {
    const spec = readOpenApi();
    const securitySettings = spec.components.schemas.SecuritySettings;

    expect(securitySettings.required).toContain('corsAllowedOrigins');
    expect(securitySettings.properties.corsAllowedOrigins.items.type).toBe('string');
    expect(securitySettings.properties.corsAllowedOrigins.description).toContain('CORS');
  });

  it('declares the redacted diagnostics bundle contract', () => {
    const spec = readOpenApi();
    const diagnosticBundle = spec.components.schemas.DiagnosticBundle;

    expect(spec.paths['/diagnostics/bundle'].get.operationId).toBe('exportDiagnosticsBundle');
    expect(diagnosticBundle.required).toEqual([
      'bundleVersion',
      'generatedAt',
      'deploymentMode',
      'includes',
      'capability',
      'doctor',
      'redactedConfig',
      'artifacts',
    ]);
    expect(diagnosticBundle.properties.bundleVersion.const).toBe('video-cut.diagnostics-bundle.v1');
    expect(diagnosticBundle.properties.doctor.$ref).toBe('#/components/schemas/DeploymentDoctorReport');
  });

  it('declares explicit-consent diagnostics support bundle attachments', () => {
    const spec = readOpenApi();
    const path = spec.paths['/diagnostics/support-bundle'];
    const request = spec.components.schemas.DiagnosticSupportBundleRequest;
    const artifact = spec.components.schemas.DiagnosticBundleArtifact;
    const diagnosticBundle = spec.components.schemas.DiagnosticBundle;

    expect(path.post.operationId).toBe('exportDiagnosticsSupportBundle');
    expect(path.post.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/DiagnosticSupportBundleRequest',
    );
    expect(path.post.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/DiagnosticBundleEnvelope',
    );
    expect(path.post.responses['400'].description).toContain('DIAGNOSTICS_CONSENT_REQUIRED');
    expect(request.required).toEqual(['includeSourceMedia', 'includeTranscript', 'consentAccepted']);
    expect(request.properties.consentAccepted.description).toContain('explicit user consent');
    expect(diagnosticBundle.properties.supportRequest.$ref).toBe('#/components/schemas/DiagnosticSupportBundleRequestEvidence');
    expect(diagnosticBundle.properties.artifacts.items.$ref).toBe('#/components/schemas/DiagnosticBundleArtifact');
    expect(artifact.required).toEqual(['kind', 'included', 'redacted']);
    expect(artifact.properties.kind.enum).toEqual(['sourceMedia', 'transcript']);
    expect(artifact.properties.contentRef.description).toContain('host-relative');
  });

  it('declares diagnostics-grade redacted path placeholders for doctor and diagnostics settings', () => {
    const spec = readOpenApi();
    const doctorReport = spec.components.schemas.DeploymentDoctorReport;
    const diagnosticBundle = spec.components.schemas.DiagnosticBundle;
    const redactedSettings = spec.components.schemas.RedactedVideoCutSettings;
    const redactedStorage = spec.components.schemas.RedactedStorageSettings;
    const doctorCheck = spec.components.schemas.DeploymentDoctorCheck;

    expect(doctorReport.properties.redactedConfig.$ref).toBe('#/components/schemas/RedactedVideoCutSettings');
    expect(diagnosticBundle.properties.redactedConfig.$ref).toBe('#/components/schemas/RedactedVideoCutSettings');
    expect(redactedSettings.required).toEqual(spec.components.schemas.VideoCutSettings.required);
    expect(redactedSettings.properties.storage.$ref).toBe('#/components/schemas/RedactedStorageSettings');
    expect(redactedStorage.required).toEqual(['workspaceRoot', 'artifactRoot', 'tempRoot', 'retentionDays']);

    for (const pathField of ['workspaceRoot', 'artifactRoot', 'tempRoot']) {
      expect(redactedStorage.properties[pathField].description).toContain('<redacted-path>');
      expect(redactedStorage.properties[pathField].anyOf).toEqual(
        expect.arrayContaining([expect.objectContaining({ const: '<redacted-path>' })]),
      );
    }

    expect(doctorCheck.properties.details.description).toContain('<redacted-path>');
  });

  it('declares the OpenAI-compatible provider conformance contract', () => {
    const spec = readOpenApi();
    const path = spec.paths['/providers/openai-compatible/conformance'];
    const report = spec.components.schemas.ProviderConformanceReport;
    const check = spec.components.schemas.ProviderConformanceCheck;

    expect(path.post.operationId).toBe('runOpenAiCompatibleProviderConformance');
    expect(path.post.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ProviderConformanceRequest',
    );
    expect(path.post.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ProviderConformanceReportEnvelope',
    );
    expect(report.properties.reportVersion.const).toBe('video-cut.provider-conformance.v1');
    expect(report.properties.checks.items.$ref).toBe('#/components/schemas/ProviderConformanceCheck');
    expect(check.properties.details.description).toContain('credentialStatus');
    expect(check.properties.details.description).toContain('must not include secret refs');
  });

  it('declares canonical speech provider profiles in provider policy and settings', () => {
    const spec = readOpenApi();
    const policy = spec.components.schemas.ProviderContractPolicy;
    const speech = spec.components.schemas.SpeechToTextSettings;

    expect(policy.required).toContain('speechToTextProviderProfiles');
    expect(policy.properties.speechToTextProviderProfiles.items.enum).toEqual([
      'openai-audio-transcriptions',
      'volcengine-bigasr-flash',
      'aliyun-qwen-asr',
    ]);
    expect(speech.required).toContain('providerProfile');
    expect(speech.required).toContain('resourceId');
    expect(speech.properties.providerProfile.enum).toEqual([
      'openai-audio-transcriptions',
      'volcengine-bigasr-flash',
      'aliyun-qwen-asr',
    ]);
    expect(speech.properties.resourceId.description).toContain('Volcengine');
  });

  it('declares multipart source file upload for local-first imports', () => {
    const spec = readOpenApi();
    const path = spec.paths['/tasks/{taskId}/source/file'];
    const requestContent = path.post.requestBody.content['multipart/form-data'];

    expect(path.post.operationId).toBe('uploadTaskSourceFile');
    expect(path.post.requestBody.content['multipart/form-data'].encoding.file.contentType).toContain('video/mp4');
    expect(path.post.requestBody.content['multipart/form-data'].encoding.file.contentType).toContain('video/webm');
    expect(requestContent.schema.properties.file.format).toBe('binary');
    expect(path.post.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/VideoCutArtifactEnvelope',
    );
    expect(path.post.responses['400'].description).toContain('SOURCE_FILE_TYPE_UNSUPPORTED');
    expect(path.post.responses['400'].description).toContain('MULTIPART_INVALID');
  });

  it('declares real render failure envelopes for missing source or unprocessable FFmpeg inputs', () => {
    const spec = readOpenApi();
    const path = spec.paths['/tasks/{taskId}/render'];

    expect(path.post.operationId).toBe('renderTask');
    expect(path.post.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/VideoCutTaskEnvelope',
    );
    expect(path.post.responses['400'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ApiErrorEnvelope',
    );
    expect(path.post.responses['409'].$ref).toBe('#/components/responses/ConflictError');
    expect(path.post.responses['422'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ApiErrorEnvelope',
    );
  });

  it('declares batch render for rendering every split-plan segment as separate attempts', () => {
    const spec = readOpenApi();
    const path = spec.paths['/tasks/{taskId}/render/batch'];

    expect(path.post.operationId).toBe('renderTaskBatch');
    expect(path.post.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/VideoCutTaskEnvelope',
    );
    expect(path.post.responses['400'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ApiErrorEnvelope',
    );
    expect(path.post.responses['409'].$ref).toBe('#/components/responses/ConflictError');
    expect(path.post.responses['422'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ApiErrorEnvelope',
    );
  });

  it('declares manual transcript import through a standard transcript document endpoint', () => {
    const spec = readOpenApi();
    const path = spec.paths['/tasks/{taskId}/transcript'];

    expect(path.put.operationId).toBe('updateTaskTranscript');
    expect(path.put.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/ManualTranscriptInput');
    expect(path.put.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/TranscriptDocumentEnvelope',
    );
    expect(spec.components.schemas.ManualTranscriptInput.required).toEqual(['segments']);
    expect(spec.components.schemas.ManualTranscriptInput.properties.segments.items.$ref).toBe(
      '#/components/schemas/ManualTranscriptSegmentInput',
    );
  });

  it('declares SRT and VTT subtitle import/export through standard adapters', () => {
    const spec = readOpenApi();
    const importPath = spec.paths['/tasks/{taskId}/subtitles/import'];
    const exportPath = spec.paths['/tasks/{taskId}/subtitles/export'];

    expect(importPath.put.operationId).toBe('importTaskSubtitles');
    expect(importPath.put.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/SubtitleImportInput');
    expect(importPath.put.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/TranscriptDocumentEnvelope',
    );
    expect(exportPath.get.operationId).toBe('exportTaskSubtitles');
    expect(exportPath.get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'format', schema: expect.objectContaining({ enum: ['srt', 'vtt'] }) })]),
    );
    expect(exportPath.get.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/SubtitleExportOutputEnvelope',
    );
  });

  it('declares binary artifact content serving for server browser consumption', () => {
    const spec = readOpenApi();
    const path = spec.paths['/tasks/{taskId}/artifacts/{artifactId}/content'];
    const descriptor = spec.components.schemas.ArtifactDownloadDescriptor;

    expect(path.get.operationId).toBe('getArtifactContent');
    expect(descriptor.required).toContain('url');
    expect(descriptor.properties.downloadMode.enum).toContain('host-content-endpoint');
    expect(path.get.responses['200'].content['video/mp4'].schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(path.get.responses['200'].content['image/png'].schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(path.get.responses['200'].content['text/x-ssa'].schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(path.get.responses['200'].content['application/octet-stream'].schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(path.get.responses['200'].headers).toMatchObject({
      'Cache-Control': {
        schema: {
          const: 'private, no-store',
        },
      },
      Pragma: {
        schema: {
          const: 'no-cache',
        },
      },
      'X-Content-Type-Options': {
        schema: {
          const: 'nosniff',
        },
      },
    });
    expect(path.get.responses['206'].description).toContain('Partial artifact content');
    expect(path.get.responses['206'].headers).toMatchObject({
      'Accept-Ranges': {
        schema: {
          const: 'bytes',
        },
      },
      'Content-Range': {
        schema: {
          type: 'string',
        },
      },
      'Cache-Control': {
        schema: {
          const: 'private, no-store',
        },
      },
      Pragma: {
        schema: {
          const: 'no-cache',
        },
      },
      'X-Content-Type-Options': {
        schema: {
          const: 'nosniff',
        },
      },
    });
    expect(path.get.responses['416'].description).toContain('range cannot be satisfied');
    expect(path.get.responses['416'].headers).toMatchObject({
      'Cache-Control': {
        schema: {
          const: 'private, no-store',
        },
      },
      Pragma: {
        schema: {
          const: 'no-cache',
        },
      },
      'X-Content-Type-Options': {
        schema: {
          const: 'nosniff',
        },
      },
    });
    expect(path.get.responses['404']).toEqual({ $ref: '#/components/responses/NotFoundError' });
  });

  it('declares render manifest artifacts and schema for render attempt provenance', () => {
    const spec = readOpenApi();
    const artifactKind = spec.components.schemas.VideoCutArtifact.properties.kind;
    const renderManifest = spec.components.schemas.RenderAttemptManifest;
    const settings = spec.components.schemas.VideoCutSettings;

    expect(artifactKind.enum).toContain('render-manifest');
    expect(settings.required).toContain('assets');
    expect(spec.components.schemas.AssetSettings.required).toEqual(['fonts', 'bgm', 'sfx', 'coverTemplates']);
    expect(renderManifest.properties.schemaId.const).toBe('video-cut.render-attempt.schema.v1');
    expect(renderManifest.required).toEqual([
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

    const renderGraph = renderManifest.properties.renderGraph;
    expect(renderGraph.required).toEqual([
      'engine',
      'adapterVersion',
      'videoFilterPreset',
      'audioFilterPreset',
      'voiceEnhancement',
      'bgm',
      'sfx',
      'codec',
    ]);
    expect(renderGraph.properties.audioFilterPreset.const).toBe('voice-basic-loudnorm-afftdn.v1');
    expect(renderGraph.properties.voiceEnhancement.required).toEqual(['status', 'filters']);
    expect(renderGraph.properties.voiceEnhancement.properties.status.enum).toEqual(['applied', 'skipped', 'failed']);
    expect(renderGraph.properties.voiceEnhancement.properties.filters.items.enum).toEqual(['loudnorm', 'afftdn']);
    expect(renderGraph.properties.bgm.required).toEqual(['status', 'mixed', 'volumePercent']);
    expect(renderGraph.properties.bgm.properties.volumePercent.const).toBe(20);
    expect(renderGraph.properties.bgm.properties.asset.$ref).toBe('#/components/schemas/RenderAudioAssetProvenance');
    expect(renderGraph.properties.sfx.required).toEqual(['status', 'mixed']);
    expect(renderGraph.properties.sfx.properties.asset.$ref).toBe('#/components/schemas/RenderAudioAssetProvenance');
    expect(spec.components.schemas.RenderAudioAssetProvenance.required).toEqual([
      'assetId',
      'path',
      'sha256',
      'license',
      'source',
      'version',
    ]);
  });

  it('declares the standard media-info analysis artifact schema', () => {
    const spec = readOpenApi();
    const mediaInfo = spec.components.schemas.MediaInfoDocument;

    expect(mediaInfo.required).toEqual([
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
    expect(mediaInfo.properties.schemaId.const).toBe('video-cut.media-info.schema.v1');
    expect(mediaInfo.properties.probeStatus.$ref).toBe('#/components/schemas/MediaProbeStatus');
    expect(mediaInfo.properties.format.$ref).toBe('#/components/schemas/MediaFormatInfo');
    expect(mediaInfo.properties.videoStreams.items.$ref).toBe('#/components/schemas/MediaVideoStream');
    expect(mediaInfo.properties.audioStreams.items.$ref).toBe('#/components/schemas/MediaAudioStream');
  });

  it('declares standard audio extraction and silence range analysis schemas', () => {
    const spec = readOpenApi();
    const artifactKind = spec.components.schemas.VideoCutArtifact.properties.kind;
    const audioExtract = spec.components.schemas.AudioExtractDocument;
    const silenceRanges = spec.components.schemas.SilenceRangesDocument;

    expect(artifactKind.enum).toContain('audio');
    expect(audioExtract.properties.schemaId.const).toBe('video-cut.audio-extract.schema.v1');
    expect(audioExtract.properties.extractStatus.$ref).toBe('#/components/schemas/AudioExtractStatus');
    expect(audioExtract.properties.audio.$ref).toBe('#/components/schemas/ExtractedAudioInfo');
    expect(silenceRanges.properties.schemaId.const).toBe('video-cut.silence-ranges.schema.v1');
    expect(silenceRanges.properties.detectionStatus.$ref).toBe('#/components/schemas/SilenceDetectionStatus');
    expect(silenceRanges.properties.ranges.items.$ref).toBe('#/components/schemas/SilenceRange');
  });

  it('declares standard VAD speech activity analysis schema', () => {
    const spec = readOpenApi();
    const vadRanges = spec.components.schemas.VadRangesDocument;

    expect(vadRanges.properties.schemaId.const).toBe('video-cut.vad-ranges.schema.v1');
    expect(vadRanges.properties.vadStatus.$ref).toBe('#/components/schemas/VadStatus');
    expect(vadRanges.properties.parameters.$ref).toBe('#/components/schemas/VadParameters');
    expect(vadRanges.properties.ranges.items.$ref).toBe('#/components/schemas/VadRange');
  });

  it('declares standard transcription analysis schema', () => {
    const spec = readOpenApi();
    const transcript = spec.components.schemas.TranscriptDocument;

    expect(transcript.properties.schemaId.const).toBe('video-cut.transcript.schema.v1');
    expect(transcript.properties.transcriptStatus.$ref).toBe('#/components/schemas/TranscriptStatus');
    expect(transcript.properties.timestampGranularity.items.$ref).toBe('#/components/schemas/TimestampGranularity');
    expect(transcript.properties.segments.items.$ref).toBe('#/components/schemas/TranscriptSegment');
  });

  it('declares standard semantic analysis schema', () => {
    const spec = readOpenApi();
    const semantic = spec.components.schemas.SemanticAnalysisDocument;

    expect(semantic.properties.schemaId.const).toBe('video-cut.semantic-analysis.schema.v1');
    expect(semantic.properties.semanticStatus.$ref).toBe('#/components/schemas/SemanticAnalysisStatus');
    expect(semantic.properties.topics.items.$ref).toBe('#/components/schemas/SemanticTopic');
    expect(semantic.properties.qaCandidates.items.$ref).toBe('#/components/schemas/QaCandidate');
  });
});

describe('runtime environment template', () => {
  it('keeps browser host configuration out of Vite build-time environment variables', () => {
    const envExample = readFileSync(envExamplePath, 'utf8');

    expect(envExample).toContain('SDKWORK_VIDEO_CUT_RUNTIME_MODE=desktop-local');
    expect(envExample).toContain('SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=./workspace');
    expect(envExample).not.toContain('VITE_VIDEO_CUT_HOST_MODE');
    expect(envExample).not.toContain('VITE_VIDEO_CUT_HOST_BASE_URL');
  });
});
