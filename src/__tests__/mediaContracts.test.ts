import { describe, expect, it } from 'vitest';

import {
  createDefaultRenderRequest,
  createDefaultSubtitleDocument,
  createDefaultVideoSplitPlan,
  mediaContractSchemaIds,
  parseRenderAttemptManifest,
  validateAudioExtractDocument,
  validateMediaInfoDocument,
  validateRenderRequest,
  validateSemanticAnalysisDocument,
  validateSilenceRangesDocument,
  validateSubtitleDocument,
  validateTranscriptDocument,
  validateVadRangesDocument,
  validateVideoSplitPlan,
} from '../domain/mediaContracts';

describe('mediaContracts', () => {
  it('declares versioned schema identifiers for plan, subtitle, and render request', () => {
    expect(mediaContractSchemaIds).toEqual({
      audioExtract: 'video-cut.audio-extract.schema.v1',
      mediaInfo: 'video-cut.media-info.schema.v1',
      nleTimeline: 'video-cut.nle-timeline.schema.v1',
      renderAttemptManifest: 'video-cut.render-attempt.schema.v1',
      renderRequest: 'video-cut.render-request.schema.v1',
      semanticAnalysis: 'video-cut.semantic-analysis.schema.v1',
      silenceRanges: 'video-cut.silence-ranges.schema.v1',
      subtitleDocument: 'video-cut.subtitle-document.schema.v1',
      transcriptDocument: 'video-cut.transcript.schema.v1',
      vadRanges: 'video-cut.vad-ranges.schema.v1',
      videoSplitPlan: 'video-cut.split-plan.schema.v1',
    });
  });

  it('accepts a standard media-info document produced by the media probe port', () => {
    const mediaInfo = {
      schemaId: mediaContractSchemaIds.mediaInfo,
      mediaInfoVersion: 1,
      taskId: 'task-0001',
      sourceArtifactId: 'task-0001-source',
      sourcePath: 'workspace/projects/default/tasks/task-0001/source/interview.mp4',
      providerId: 'ffprobe-media-probe',
      adapterVersion: 'ffprobe-media-probe.adapter.v1',
      probeStatus: 'ok',
      format: {
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        durationSeconds: 12.345,
        bitRate: 1_200_000,
      },
      videoStreams: [
        {
          index: 0,
          codec: 'h264',
          width: 1920,
          height: 1080,
          frameRate: 29.97,
        },
      ],
      audioStreams: [
        {
          index: 1,
          codec: 'aac',
          sampleRate: 48_000,
          channels: 2,
        },
      ],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateMediaInfoDocument(mediaInfo)).toEqual({ valid: true, errors: [] });
  });

  it('rejects ok media-info documents with non-positive video dimensions', () => {
    const mediaInfo = {
      schemaId: mediaContractSchemaIds.mediaInfo,
      mediaInfoVersion: 1,
      taskId: 'task-0001',
      sourceArtifactId: 'task-0001-source',
      sourcePath: 'workspace/projects/default/tasks/task-0001/source/interview.mp4',
      providerId: 'ffprobe-media-probe',
      adapterVersion: 'ffprobe-media-probe.adapter.v1',
      probeStatus: 'ok',
      format: {
        formatName: 'mp4',
        durationSeconds: 12,
        bitRate: 1_200_000,
      },
      videoStreams: [
        {
          index: 0,
          codec: 'h264',
          width: 0,
          height: 1080,
          frameRate: 30,
        },
      ],
      audioStreams: [],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateMediaInfoDocument(mediaInfo).errors).toContainEqual(
      expect.objectContaining({
        code: 'MEDIA_VIDEO_DIMENSIONS_INVALID',
        field: 'videoStreams[0]',
      }),
    );
  });

  it('requires failed media-info documents to explain the probe failure', () => {
    const mediaInfo = {
      schemaId: mediaContractSchemaIds.mediaInfo,
      mediaInfoVersion: 1,
      taskId: 'task-0001',
      sourceArtifactId: 'task-0001-source',
      sourcePath: 'workspace/projects/default/tasks/task-0001/source/interview.mp4',
      providerId: 'ffprobe-media-probe',
      adapterVersion: 'ffprobe-media-probe.adapter.v1',
      probeStatus: 'failed',
      format: {
        formatName: '',
        durationSeconds: 0,
        bitRate: 0,
      },
      videoStreams: [],
      audioStreams: [],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateMediaInfoDocument(mediaInfo).errors).toContainEqual(
      expect.objectContaining({
        code: 'MEDIA_PROBE_WARNING_REQUIRED',
        field: 'warnings',
      }),
    );
  });

  it('validates standard audio extract documents and requires warnings on failed extraction', () => {
    const failedAudioExtract = {
      schemaId: mediaContractSchemaIds.audioExtract,
      audioExtractVersion: 1,
      taskId: 'task-0001',
      sourceArtifactId: 'task-0001-source',
      sourcePath: 'workspace/projects/default/tasks/task-0001/source/interview.mp4',
      audioArtifactId: 'task-0001-audio-source',
      audioPath: 'workspace/projects/default/tasks/task-0001/audio/source.wav',
      providerId: 'ffmpeg-audio-extract',
      adapterVersion: 'ffmpeg-audio-extract.adapter.v1',
      extractStatus: 'failed',
      audio: {
        format: 'wav',
        codec: 'pcm_s16le',
        sampleRate: 16_000,
        channels: 1,
        sizeBytes: 0,
      },
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateAudioExtractDocument(failedAudioExtract).errors).toContainEqual(
      expect.objectContaining({
        code: 'AUDIO_EXTRACT_WARNING_REQUIRED',
        field: 'warnings',
      }),
    );

    expect(validateAudioExtractDocument({ ...failedAudioExtract, warnings: ['ffmpeg failed'] })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates silence ranges and rejects non-positive ranges', () => {
    const silenceRanges = {
      schemaId: mediaContractSchemaIds.silenceRanges,
      silenceRangesVersion: 1,
      taskId: 'task-0001',
      audioArtifactId: 'task-0001-audio-source',
      audioPath: 'workspace/projects/default/tasks/task-0001/audio/source.wav',
      providerId: 'ffmpeg-silencedetect',
      adapterVersion: 'ffmpeg-silencedetect.adapter.v1',
      detectionStatus: 'ok',
      parameters: {
        noiseDb: -35,
        minDurationSeconds: 0.3,
      },
      ranges: [
        {
          startMs: 3000,
          endMs: 3000,
          durationMs: 0,
        },
      ],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateSilenceRangesDocument(silenceRanges).errors).toContainEqual(
      expect.objectContaining({
        code: 'SILENCE_RANGE_INVALID',
        field: 'ranges[0]',
      }),
    );
  });

  it('validates VAD ranges and requires warnings when speech activity is unavailable', () => {
    const vadRanges = {
      schemaId: mediaContractSchemaIds.vadRanges,
      vadRangesVersion: 1,
      taskId: 'task-0001',
      audioArtifactId: 'task-0001-audio-source',
      audioPath: 'workspace/projects/default/tasks/task-0001/audio/source.wav',
      providerId: 'silero-vad-onnx',
      adapterVersion: 'silero-vad-onnx.adapter.v1',
      vadStatus: 'unavailable',
      parameters: {
        sampleRate: 16_000,
        threshold: 0.5,
        minSpeechDurationMs: 250,
        minSilenceDurationMs: 100,
      },
      ranges: [],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateVadRangesDocument(vadRanges).errors).toContainEqual(
      expect.objectContaining({
        code: 'VAD_WARNING_REQUIRED',
        field: 'warnings',
      }),
    );
  });

  it('validates transcript documents and requires warnings when transcription is unavailable', () => {
    const transcript = {
      schemaId: mediaContractSchemaIds.transcriptDocument,
      transcriptVersion: 1,
      taskId: 'task-0001',
      audioArtifactId: 'task-0001-audio-source',
      audioPath: 'workspace/projects/default/tasks/task-0001/audio/source.wav',
      providerId: 'openai-compatible-transcription',
      adapterVersion: 'openai-compatible-transcription.adapter.v1',
      transcriptStatus: 'provider-unavailable',
      language: 'zh-CN',
      timestampGranularity: ['segment'],
      durationSeconds: 0,
      text: '',
      segments: [],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateTranscriptDocument(transcript).errors).toContainEqual(
      expect.objectContaining({
        code: 'TRANSCRIPT_WARNING_REQUIRED',
        field: 'warnings',
      }),
    );

    expect(validateTranscriptDocument({ ...transcript, warnings: ['STT provider is not configured.'] })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates semantic analysis documents and requires warnings when transcript is unavailable', () => {
    const semanticAnalysis = {
      schemaId: mediaContractSchemaIds.semanticAnalysis,
      semanticAnalysisVersion: 1,
      taskId: 'task-0001',
      transcriptArtifactId: 'task-0001-transcript',
      providerId: 'openai-compatible-semantic-analysis',
      adapterVersion: 'openai-compatible-semantic-analysis.adapter.v1',
      semanticStatus: 'transcript-unavailable',
      model: 'gpt-4.1-mini',
      summary: '',
      topics: [],
      qaCandidates: [],
      warnings: [],
      createdAt: '2026-04-26T00:00:00.000Z',
    };

    expect(validateSemanticAnalysisDocument(semanticAnalysis).errors).toContainEqual(
      expect.objectContaining({
        code: 'SEMANTIC_WARNING_REQUIRED',
        field: 'warnings',
      }),
    );

    expect(validateSemanticAnalysisDocument({ ...semanticAnalysis, warnings: ['Transcript is unavailable.'] })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('creates a valid split plan with every required explainability track', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'long-interview',
    });

    expect(plan.planVersion).toBe(1);
    expect(plan.tracks.map((track) => track.kind)).toEqual([
      'mediaInfoTrack',
      'silenceTrack',
      'speechActivityTrack',
      'transcriptTrack',
      'sceneTrack',
      'subjectTrack',
      'semanticTrack',
      'cutDecisionTrack',
    ]);
    expect(plan.tracks.every((track) => track.providerId && track.adapterVersion && track.inputHash && track.outputHash)).toBe(true);
    expect(plan.renderPreferences.audio.bgm.mode).toBe('auto');
    expect(plan.renderPreferences.audio.sfx.mode).toBe('auto');
    expect(plan.renderPreferences.audio.voiceEnhancement).toBe('basic');
    expect(validateVideoSplitPlan(plan)).toEqual({ valid: true, errors: [] });
  });

  it('accepts explicit render asset preferences from the standard asset catalog', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'single-speaker',
    });

    plan.renderPreferences.audio.bgm = {
      mode: 'asset',
      assetId: 'bgm-1234567890abcdef',
      path: 'assets://bgm/licensed-bgm.wav',
    };
    plan.renderPreferences.audio.sfx = {
      mode: 'disabled',
    };

    expect(validateVideoSplitPlan(plan)).toEqual({ valid: true, errors: [] });
  });

  it('rejects render asset preferences with unsafe or mismatched asset references', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'single-speaker',
    });

    plan.renderPreferences.audio.bgm = {
      mode: 'asset',
      assetId: 'sfx-1234567890abcdef',
      path: 'C:/private/licensed-bgm.wav' as `assets://bgm/${string}`,
    };

    expect(validateVideoSplitPlan(plan).errors).toContainEqual(
      expect.objectContaining({
        code: 'RENDER_ASSET_REFERENCE_INVALID',
        field: 'renderPreferences.audio.bgm',
      }),
    );
  });

  it('rejects split plans whose output dimensions do not match 9:16', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'single-speaker',
    });
    plan.outputSpec = {
      ...plan.outputSpec,
      width: 360,
      height: 360,
    };

    expect(validateVideoSplitPlan(plan).errors).toContainEqual(
      expect.objectContaining({
        code: 'OUTPUT_SPEC_INVALID',
        field: 'outputSpec',
      }),
    );
  });

  it('links mediaInfoTrack provenance to the media-info analysis artifact', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'single-speaker',
    });

    expect(plan.tracks.find((track) => track.kind === 'mediaInfoTrack')?.sourceArtifactId).toBe('task-0001-media-info');
    expect(plan.tracks.find((track) => track.kind === 'silenceTrack')?.sourceArtifactId).toBe('task-0001-silence-ranges');
    expect(plan.tracks.find((track) => track.kind === 'speechActivityTrack')?.sourceArtifactId).toBe('task-0001-vad-ranges');
    expect(plan.tracks.find((track) => track.kind === 'transcriptTrack')?.sourceArtifactId).toBe('task-0001-transcript');
    expect(plan.tracks.find((track) => track.kind === 'semanticTrack')?.sourceArtifactId).toBe('task-0001-semantic-analysis');
  });

  it('rejects subtitle documents with overlapping output cues', () => {
    const subtitleDocument = createDefaultSubtitleDocument({
      planId: 'plan-0001',
      taskId: 'task-0001',
    });
    subtitleDocument.cues[1].outputRange.startMs = subtitleDocument.cues[0].outputRange.endMs - 200;

    expect(validateSubtitleDocument(subtitleDocument)).toContainEqual(
      expect.objectContaining({
        code: 'SUBTITLE_CUE_OVERLAP',
        field: 'cues[1].outputRange.startMs',
      }),
    );
  });

  it('binds render requests to an immutable plan revision', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'interview-qa',
    });
    const subtitleDocument = createDefaultSubtitleDocument({
      planId: plan.planId,
      taskId: plan.taskId,
    });
    const renderRequest = createDefaultRenderRequest({
      plan,
      subtitleDocument,
    });

    expect(renderRequest.planId).toBe(plan.planId);
    expect(renderRequest.planRevision).toBe(plan.planRevision);
    expect(validateRenderRequest(renderRequest, plan, subtitleDocument)).toEqual({ valid: true, errors: [] });

    const staleRenderRequest = {
      ...renderRequest,
      planRevision: plan.planRevision + 1,
    };

    expect(validateRenderRequest(staleRenderRequest, plan, subtitleDocument).errors).toContainEqual(
      expect.objectContaining({
        code: 'PLAN_REVISION_MISMATCH',
        field: 'planRevision',
      }),
    );
  });

  it('parses render attempt manifests with standard voice enhancement and BGM status', () => {
    const manifest = parseRenderAttemptManifest(
      JSON.stringify({
        schemaId: 'video-cut.render-attempt.schema.v1',
        renderAttemptVersion: 1,
        taskId: 'task-0001',
        renderId: 'task-0001-render-1',
        planId: 'task-0001-plan-1',
        planRevision: 1,
        sourceArtifactId: 'task-0001-source',
        transcriptArtifactId: null,
        outputArtifactId: 'task-0001-render-1-output',
        subtitleArtifactId: 'task-0001-render-1-subtitle',
        coverArtifactId: 'task-0001-render-1-cover',
        logArtifactId: 'task-0001-render-1-log',
        subtitleBurnIn: true,
        subtitleCueCount: 0,
        sourceRange: { startMs: 500, endMs: 1800 },
        outputSpec: {
          aspectRatio: '9:16',
          width: 1080,
          height: 1920,
          frameRate: 30,
          format: 'mp4',
        },
        renderGraph: {
          engine: 'ffmpeg',
          adapterVersion: 'ffmpeg-media-render.adapter.v1',
          videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
          audioFilterPreset: 'voice-basic-loudnorm-afftdn.v1',
          voiceEnhancement: {
            status: 'applied',
            filters: ['loudnorm', 'afftdn'],
          },
          bgm: {
            status: 'not-configured',
            mixed: false,
            volumePercent: 20,
          },
          sfx: {
            status: 'not-configured',
            mixed: false,
          },
          codec: { video: 'libx264', audio: 'aac' },
        },
        warnings: [],
        createdAt: '2026-04-27T00:00:00.000Z',
      }),
    );

    expect(manifest?.renderGraph.audioFilterPreset).toBe('voice-basic-loudnorm-afftdn.v1');
    expect(manifest?.renderGraph.bgm.volumePercent).toBe(20);
  });

  it('parses render attempt manifests with valid 9:16 preview output dimensions', () => {
    const manifest = parseRenderAttemptManifest(
      JSON.stringify({
        schemaId: 'video-cut.render-attempt.schema.v1',
        renderAttemptVersion: 1,
        taskId: 'task-0001',
        renderId: 'task-0001-render-1',
        planId: 'task-0001-plan-1',
        planRevision: 1,
        sourceArtifactId: 'task-0001-source',
        transcriptArtifactId: null,
        outputArtifactId: 'task-0001-render-1-output',
        subtitleArtifactId: 'task-0001-render-1-subtitle',
        coverArtifactId: 'task-0001-render-1-cover',
        logArtifactId: 'task-0001-render-1-log',
        subtitleBurnIn: true,
        subtitleCueCount: 0,
        sourceRange: { startMs: 500, endMs: 1800 },
        outputSpec: {
          aspectRatio: '9:16',
          width: 360,
          height: 640,
          frameRate: 30,
          format: 'mp4',
        },
        renderGraph: {
          engine: 'ffmpeg',
          adapterVersion: 'ffmpeg-media-render.adapter.v1',
          videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
          audioFilterPreset: 'voice-basic-loudnorm-afftdn.v1',
          voiceEnhancement: {
            status: 'skipped',
            filters: [],
          },
          bgm: {
            status: 'not-configured',
            mixed: false,
            volumePercent: 20,
          },
          sfx: {
            status: 'not-configured',
            mixed: false,
          },
          codec: { video: 'libx264', audio: 'aac' },
        },
        warnings: [],
        createdAt: '2026-04-27T00:00:00.000Z',
      }),
    );

    expect(manifest?.outputSpec.width).toBe(360);
    expect(manifest?.outputSpec.height).toBe(640);
  });

  it('rejects render attempt manifests without the standard audio render graph', () => {
    const manifest = parseRenderAttemptManifest(
      JSON.stringify({
        schemaId: 'video-cut.render-attempt.schema.v1',
        renderAttemptVersion: 1,
        taskId: 'task-0001',
        renderId: 'task-0001-render-1',
        planId: 'task-0001-plan-1',
        planRevision: 1,
        sourceArtifactId: 'task-0001-source',
        transcriptArtifactId: null,
        outputArtifactId: 'task-0001-render-1-output',
        subtitleArtifactId: 'task-0001-render-1-subtitle',
        coverArtifactId: 'task-0001-render-1-cover',
        logArtifactId: 'task-0001-render-1-log',
        subtitleBurnIn: true,
        subtitleCueCount: 0,
        sourceRange: { startMs: 500, endMs: 1800 },
        outputSpec: {
          aspectRatio: '9:16',
          width: 1080,
          height: 1920,
          frameRate: 30,
          format: 'mp4',
        },
        renderGraph: {
          engine: 'ffmpeg',
          adapterVersion: 'ffmpeg-media-render.adapter.v1',
          videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
          codec: { video: 'libx264', audio: 'aac' },
        },
        warnings: [],
        createdAt: '2026-04-27T00:00:00.000Z',
      }),
    );

    expect(manifest).toBeUndefined();
  });

  it('parses mixed BGM and SFX asset provenance without server-local paths', () => {
    const manifest = parseRenderAttemptManifest(
      JSON.stringify({
        schemaId: 'video-cut.render-attempt.schema.v1',
        renderAttemptVersion: 1,
        taskId: 'task-0001',
        renderId: 'task-0001-render-1',
        planId: 'task-0001-plan-1',
        planRevision: 1,
        sourceArtifactId: 'task-0001-source',
        transcriptArtifactId: null,
        outputArtifactId: 'task-0001-render-1-output',
        subtitleArtifactId: 'task-0001-render-1-subtitle',
        coverArtifactId: 'task-0001-render-1-cover',
        logArtifactId: 'task-0001-render-1-log',
        subtitleBurnIn: true,
        subtitleCueCount: 0,
        sourceRange: { startMs: 500, endMs: 1800 },
        outputSpec: {
          aspectRatio: '9:16',
          width: 1080,
          height: 1920,
          frameRate: 30,
          format: 'mp4',
        },
        renderGraph: {
          engine: 'ffmpeg',
          adapterVersion: 'ffmpeg-media-render.adapter.v1',
          videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
          audioFilterPreset: 'voice-basic-loudnorm-afftdn.v1',
          voiceEnhancement: {
            status: 'applied',
            filters: ['loudnorm', 'afftdn'],
          },
          bgm: {
            status: 'mixed',
            mixed: true,
            volumePercent: 20,
            asset: {
              assetId: 'bgm-1234567890abcdef',
              path: 'assets://bgm/licensed-bgm.wav',
              sha256: 'a'.repeat(64),
              license: 'CC0-1.0',
              source: 'https://example.invalid/sdkwork-bgm-pack',
              version: '2026.04',
            },
          },
          sfx: {
            status: 'mixed',
            mixed: true,
            asset: {
              assetId: 'sfx-1234567890abcdef',
              path: 'assets://sfx/licensed-sfx.wav',
              sha256: 'b'.repeat(64),
              license: 'CC0-1.0',
              source: 'https://example.invalid/sdkwork-sfx-pack',
              version: '2026.04',
            },
          },
          codec: { video: 'libx264', audio: 'aac' },
        },
        warnings: [],
        createdAt: '2026-04-27T00:00:00.000Z',
      }),
    );

    expect(manifest?.renderGraph.bgm.asset?.path).toBe('assets://bgm/licensed-bgm.wav');
    expect(manifest?.renderGraph.sfx.asset?.path).toBe('assets://sfx/licensed-sfx.wav');
    expect(manifest?.renderGraph.bgm.asset?.license).toBe('CC0-1.0');
    expect(manifest?.renderGraph.bgm.asset?.source).toBe('https://example.invalid/sdkwork-bgm-pack');
    expect(manifest?.renderGraph.bgm.asset?.version).toBe('2026.04');
  });

  it('rejects mixed audio asset provenance without license metadata', () => {
    const manifest = parseRenderAttemptManifest(
      JSON.stringify({
        schemaId: 'video-cut.render-attempt.schema.v1',
        renderAttemptVersion: 1,
        taskId: 'task-0001',
        renderId: 'task-0001-render-1',
        planId: 'task-0001-plan-1',
        planRevision: 1,
        sourceArtifactId: 'task-0001-source',
        transcriptArtifactId: null,
        outputArtifactId: 'task-0001-render-1-output',
        subtitleArtifactId: 'task-0001-render-1-subtitle',
        coverArtifactId: 'task-0001-render-1-cover',
        logArtifactId: 'task-0001-render-1-log',
        subtitleBurnIn: true,
        subtitleCueCount: 0,
        sourceRange: { startMs: 500, endMs: 1800 },
        outputSpec: {
          aspectRatio: '9:16',
          width: 1080,
          height: 1920,
          frameRate: 30,
          format: 'mp4',
        },
        renderGraph: {
          engine: 'ffmpeg',
          adapterVersion: 'ffmpeg-media-render.adapter.v1',
          videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
          audioFilterPreset: 'voice-basic-loudnorm-afftdn.v1',
          voiceEnhancement: {
            status: 'applied',
            filters: ['loudnorm', 'afftdn'],
          },
          bgm: {
            status: 'mixed',
            mixed: true,
            volumePercent: 20,
            asset: {
              assetId: 'bgm-1234567890abcdef',
              path: 'assets://bgm/licensed-bgm.wav',
              sha256: 'a'.repeat(64),
            },
          },
          sfx: {
            status: 'not-configured',
            mixed: false,
          },
          codec: { video: 'libx264', audio: 'aac' },
        },
        warnings: [],
        createdAt: '2026-04-27T00:00:00.000Z',
      }),
    );

    expect(manifest).toBeUndefined();
  });

  it('rejects mixed audio asset status without sanitized asset provenance', () => {
    const manifest = parseRenderAttemptManifest(
      JSON.stringify({
        schemaId: 'video-cut.render-attempt.schema.v1',
        renderAttemptVersion: 1,
        taskId: 'task-0001',
        renderId: 'task-0001-render-1',
        planId: 'task-0001-plan-1',
        planRevision: 1,
        sourceArtifactId: 'task-0001-source',
        transcriptArtifactId: null,
        outputArtifactId: 'task-0001-render-1-output',
        subtitleArtifactId: 'task-0001-render-1-subtitle',
        coverArtifactId: 'task-0001-render-1-cover',
        logArtifactId: 'task-0001-render-1-log',
        subtitleBurnIn: true,
        subtitleCueCount: 0,
        sourceRange: { startMs: 500, endMs: 1800 },
        outputSpec: {
          aspectRatio: '9:16',
          width: 1080,
          height: 1920,
          frameRate: 30,
          format: 'mp4',
        },
        renderGraph: {
          engine: 'ffmpeg',
          adapterVersion: 'ffmpeg-media-render.adapter.v1',
          videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
          audioFilterPreset: 'voice-basic-loudnorm-afftdn.v1',
          voiceEnhancement: {
            status: 'applied',
            filters: ['loudnorm', 'afftdn'],
          },
          bgm: {
            status: 'mixed',
            mixed: true,
            volumePercent: 20,
            asset: {
              assetId: 'bgm-1234567890abcdef',
              path: 'C:/private/licensed-bgm.wav',
              sha256: 'a'.repeat(64),
              license: 'CC0-1.0',
              source: 'https://example.invalid/sdkwork-bgm-pack',
              version: '2026.04',
            },
          },
          sfx: {
            status: 'not-configured',
            mixed: false,
          },
          codec: { video: 'libx264', audio: 'aac' },
        },
        warnings: [],
        createdAt: '2026-04-27T00:00:00.000Z',
      }),
    );

    expect(manifest).toBeUndefined();
  });
});
