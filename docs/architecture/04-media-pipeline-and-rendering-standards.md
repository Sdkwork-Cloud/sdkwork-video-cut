# 04 Media Pipeline And Rendering Standards

日期：2026-04-26

## 目标

本标准定义视频切分、字幕、音频增强、渲染和媒体 artifact 的技术架构。媒体处理必须真实可执行、可解释、可审阅、可复现。

## Pipeline

```text
source video
  -> ffprobe media info
  -> ffmpeg extract 16k mono wav
  -> FFmpeg silencedetect
  -> Silero VAD ONNX
  -> OpenAI-compatible transcription or local fallback
  -> sentence timeline
  -> optional scene detection
  -> OpenAI-compatible semantic analysis
  -> cut candidate scoring
  -> split_plan.json
  -> review / plan override
  -> FFmpeg render graph
  -> output.mp4 + subtitles.ass + cover.png + render.log
```

## MVP 必选技术

- FFmpeg / ffprobe：探测、抽音频、裁切、拼接、混音、字幕烧录、MP4 输出。
- FFmpeg `silencedetect`：静音区间。
- Silero VAD ONNX + ONNX Runtime：人声区间。
- OpenAI-compatible STT：转写和时间戳。
- OpenAI-compatible LLM：结构化语义分析。
- ASS subtitle + libass/FFmpeg subtitles filter：高质量字幕烧录。

## MediaInfo Artifact Standard

`ffprobe` must be accessed through a `MediaProbePort` style adapter boundary. The host implementation writes a standard JSON document before plan generation:

- schema id: `video-cut.media-info.schema.v1`
- file path: `workspace/projects/default/tasks/{taskId}/analysis/media-info.json`
- artifact id: `{taskId}-media-info`
- artifact kind: `analysis`
- provider id: `ffprobe-media-probe`
- adapter version: `ffprobe-media-probe.adapter.v1`

The document fields are fixed by `MediaInfoDocument` in the OpenAPI contract:

- `probeStatus=ok` means `format.durationSeconds` is positive and at least one video stream has positive `width`, `height`, and `frameRate`.
- `probeStatus=failed` means the source file exists but probing failed or returned invalid JSON.
- `probeStatus=source-unavailable` means the source artifact exists in metadata but the workspace file is not available.
- failed and source-unavailable documents must keep `videoStreams` and `audioStreams` as arrays and must include at least one warning.

`VideoSplitPlan.tracks[kind=mediaInfoTrack].sourceArtifactId` must point to `{taskId}-media-info`, not directly to the source video artifact. Downstream stages consume the media-info artifact for provenance and never re-run probing implicitly.

Default split-plan range rules:

- When `media-info.format.durationSeconds` is available with `probeStatus=ok`, the Host must clamp the default `segments[0].sourceRange` to the probed media duration.
- Short sources must remain renderable without requiring a manual plan edit; `outputRange.endMs` must equal `sourceRange.endMs - sourceRange.startMs`.
- If media duration is unavailable, the Host may use a conservative fallback range, but it must record a segment warning rather than silently publishing an unaudited assumption.
- The render adapter still treats `VideoSplitPlan` as the source of truth and must not re-run media probing or mutate the plan.

## Audio Extract And Silence Ranges Standard

Audio extraction and silence detection are separate adapter boundaries:

- `AudioExtractPort`: uses FFmpeg to extract `workspace/projects/default/tasks/{taskId}/audio/source.wav`.
- `SilenceDetectionPort`: uses FFmpeg `silencedetect` and consumes only the extracted WAV artifact.

Audio extraction writes:

- schema id: `video-cut.audio-extract.schema.v1`
- file path: `workspace/projects/default/tasks/{taskId}/analysis/audio-extract.json`
- artifact id: `{taskId}-audio-extract`
- optional audio artifact id: `{taskId}-audio-source`
- audio artifact path: `workspace/projects/default/tasks/{taskId}/audio/source.wav`
- audio format: WAV, `pcm_s16le`, 16kHz, mono

Silence detection writes:

- schema id: `video-cut.silence-ranges.schema.v1`
- file path: `workspace/projects/default/tasks/{taskId}/analysis/silence-ranges.json`
- artifact id: `{taskId}-silence-ranges`
- range units: milliseconds
- default parameters: `noiseDb=-35`, `minDurationSeconds=0.3`

Failure semantics are part of the contract:

- `extractStatus=ok` means `source.wav` exists and a `kind=audio` artifact is published.
- `extractStatus=failed` means source exists but FFmpeg extraction failed.
- `extractStatus=source-unavailable` means source metadata exists but the workspace file is unavailable.
- `detectionStatus=audio-unavailable` means silence detection did not run because `source.wav` is unavailable.
- failed/source-unavailable/audio-unavailable documents must include warnings.

`VideoSplitPlan.tracks[kind=silenceTrack].sourceArtifactId` must point to `{taskId}-silence-ranges`.

## Speech Activity / VAD Standard

Speech activity detection is a separate `SpeechActivityDetectionPort` adapter boundary. It consumes only the extracted WAV artifact from `AudioExtractPort`; it must not read the source video directly and must not call LLM/STT providers.

The MVP adapter target is Silero VAD ONNX through an ONNX Runtime-compatible implementation. The standalone host links the Rust `ort` ONNX Runtime adapter and loads the model from `mediaTools.sileroVadModelPath`. If ONNX Runtime is disabled or the model file is missing, the host must still write the standard artifact so downstream stages and UI can reason about the missing capability deterministically.

Speech activity detection writes:

- schema id: `video-cut.vad-ranges.schema.v1`
- file path: `workspace/projects/default/tasks/{taskId}/analysis/vad-ranges.json`
- artifact id: `{taskId}-vad-ranges`
- artifact kind: `analysis`
- input audio artifact id: `{taskId}-audio-source`
- provider id: `silero-vad-onnx`
- adapter version: `silero-vad-onnx.adapter.v1`
- range units: milliseconds
- default parameters: `sampleRate=16000`, `threshold=0.5`, `minSpeechDurationMs=250`, `minSilenceDurationMs=100`

Failure and availability semantics are part of the contract:

- `vadStatus=ok` means VAD inference ran successfully and produced zero or more real speech ranges.
- `vadStatus=failed` means the WAV artifact exists but VAD inference failed.
- `vadStatus=unavailable` means the adapter cannot run because ONNX Runtime is disabled, the model file is missing, or inference is not linked in the current host build.
- `vadStatus=audio-unavailable` means VAD did not run because `{taskId}-audio-source` is unavailable.
- failed/unavailable/audio-unavailable documents must include warnings.
- The adapter must never fabricate speech ranges. If inference did not run, `ranges` must be an empty array.

`VideoSplitPlan.tracks[kind=speechActivityTrack].sourceArtifactId` must point to `{taskId}-vad-ranges`. Cut scoring may consume `vad_confidence` only from this artifact, never from ad hoc runtime state.

## Transcript Artifact Standard

Transcription is exposed through a `SpeechToTextPort` adapter boundary. The use case consumes the extracted WAV artifact and receives a provider-neutral `TranscriptDocument`; it must not depend on OpenAI-specific response DTOs.

The default external adapter target is the Host STT bridge. It normalizes `openai-audio-transcriptions`, `volcengine-bigasr-flash`, and `aliyun-qwen-asr` into the same OpenAI-style verbose transcription JSON before writing `TranscriptDocument`. Ollama is not allowed. Local Whisper-style engines may only be introduced as fallback adapters behind the same port and must not perform semantic analysis.

Transcription writes:

- schema id: `video-cut.transcript.schema.v1`
- file path: `workspace/projects/default/tasks/{taskId}/analysis/transcript.json`
- artifact id: `{taskId}-transcript`
- artifact kind: `analysis`
- input audio artifact id: `{taskId}-audio-source`
- provider id: selected STT bridge profile (`openai-audio-transcriptions`, `volcengine-bigasr-flash`, or `aliyun-qwen-asr`) when provider execution succeeds.
- adapter version: `speech-to-text-bridge.adapter.v1`
- timestamp granularity: `segment` or `word`

Failure and availability semantics are part of the contract:

- `transcriptStatus=ok` means a real transcription provider ran and all segments came from provider output.
- `transcriptStatus=failed` means the WAV artifact exists and the provider call failed.
- `transcriptStatus=provider-unavailable` means STT is disabled, credentials/model/base URL are incomplete, or the HTTP execution adapter is not linked in the current host build.
- `transcriptStatus=audio-unavailable` means transcription did not run because `{taskId}-audio-source` is unavailable.
- failed/provider-unavailable/audio-unavailable documents must include warnings.
- The adapter must never fabricate transcript text or segments. If transcription did not run, `text` must be empty and `segments` must be an empty array.

`VideoSplitPlan.tracks[kind=transcriptTrack].sourceArtifactId` must point to `{taskId}-transcript`. Subtitle generation and sentence-boundary scoring must consume transcript artifacts rather than reading provider responses directly.

Manual transcript import rules:

- Manual input is a first-class adapter path, exposed as `PUT /api/video-cut/v1/tasks/{taskId}/transcript`.
- The adapter must validate non-empty segment text, positive millisecond ranges, and non-overlapping segment order.
- The output is still the same `TranscriptDocument` schema with `providerId=manual-transcript`, `adapterVersion=manual-transcript.adapter.v1`, and `transcriptStatus=ok`.
- The Host replaces the current `{taskId}-transcript` artifact in place. It must not publish duplicate transcript artifacts for the same task.
- Render and subtitle generation consume only the persisted transcript artifact, so local, server, container, and Kubernetes deployments share the same behavior.

## Semantic Analysis Artifact Standard

Semantic analysis is exposed through a `SemanticAnalysisPort` adapter boundary. It consumes only `TranscriptDocument` and provider/runtime settings; it must not read media files, mutate transcript artifacts, or write split-plan decisions directly.

The default external adapter target is OpenAI-compatible `/v1/chat/completions` with structured output. Provider-specific response DTOs remain adapter-internal.

Semantic analysis writes:

- schema id: `video-cut.semantic-analysis.schema.v1`
- file path: `workspace/projects/default/tasks/{taskId}/analysis/semantic-analysis.json`
- artifact id: `{taskId}-semantic-analysis`
- artifact kind: `analysis`
- input transcript artifact id: `{taskId}-transcript`
- provider id: `openai-compatible-semantic-analysis`
- adapter version: `openai-compatible-semantic-analysis.adapter.v1`

Failure and availability semantics are part of the contract:

- `semanticStatus=ok` means a real semantic provider ran and all topics/QA candidates came from validated structured output.
- `semanticStatus=failed` means the transcript exists and the provider call or schema validation failed.
- `semanticStatus=provider-unavailable` means AI is disabled, credentials/model/base URL are incomplete, or the HTTP execution adapter is not linked in the current host build.
- `semanticStatus=transcript-unavailable` means semantic analysis did not run because `{taskId}-transcript` is not `ok`.
- failed/provider-unavailable/transcript-unavailable documents must include warnings.
- The adapter must never fabricate summaries, topics, or QA candidates. If semantic analysis did not run, `summary` must be empty and `topics`/`qaCandidates` must be empty arrays.

`VideoSplitPlan.tracks[kind=semanticTrack].sourceArtifactId` must point to `{taskId}-semantic-analysis`. Cut scoring and long-interview QA extraction may consume semantic facts only from this artifact.

## 第二阶段技术

- PySceneDetect：镜头切换。
- MediaPipe Face/Pose：人脸和上半身定位。
- FFmpeg vidstab 或 OpenCV videostab：画面稳定。
- WhisperX：词级时间戳增强。
- pyannote.audio：说话人分离。

第二阶段技术都必须通过独立 port/adapter 引入，不进入 MVP 必需路径。

## 标准轨道

`split_plan.json` 之前必须生成可解释中间轨道：

- `mediaInfoTrack`
- `silenceTrack`
- `speechActivityTrack`
- `transcriptTrack`
- `sceneTrack`
- `subjectTrack`
- `semanticTrack`
- `cutDecisionTrack`

每条轨道必须记录：

- source artifact
- provider id
- adapter version
- input hash
- output hash
- parameters
- warnings

## 切点融合

候选切点评分：

```text
score =
  0.35 * sentence_boundary_score
+ 0.25 * silence_boundary_score
+ 0.15 * vad_confidence
+ 0.10 * scene_boundary_score
+ 0.10 * semantic_score
+ 0.05 * duration_score
```

硬约束：

- 不在字幕句子中间切。
- 不在词级时间戳中间切。
- 单人口播输出不超过 90 秒。
- 长访谈单条 60-180 秒。
- 切点前后保留 120-180ms breathing room。
- 语义边界和静音边界冲突时选择最近静音/句子边界。

## RenderGraph

渲染 adapter 只消费 `VideoSplitPlan` 和 `RenderRequest`。

禁止：

- 渲染 adapter 调用 LLM。
- 渲染 adapter 修改 `split_plan.json`。
- 渲染 adapter 读取 UI 状态。
- 用户直接传入任意 FFmpeg filter 字符串。

RenderGraphBuilder 负责：

- scale/crop 到 `VideoSplitPlan.outputSpec` 指定的正整数 9:16 尺寸；默认生产 preset 为 1080x1920，预览 preset 可使用 360x640 等较小尺寸。
- trim/atrim/concat。
- loudnorm/afftdn。
- ASS 字幕烧录。
- BGM 20% 混音。
- SFX 插入。
- libx264/aac 输出 MP4。

## Real Render Adapter Implementation

The MVP Host implementation now includes a `MediaRenderPort` style adapter in `host/src/media_render.rs`.

- The adapter consumes only the persisted source artifact, the current `VideoSplitPlan`, and runtime media tool settings.
- It never calls LLM, STT, UI state, or provider-specific DTOs.
- It executes FFmpeg from the configured `mediaTools.ffmpegPath`.
- It trims the selected `sourceRange`, applies the standard vertical scale/crop/fps filter, and writes H.264/AAC MP4.
- Output path is `workspace/projects/default/tasks/{taskId}/renders/{renderId}/output.mp4`.
- Diagnostic log path is `workspace/projects/default/tasks/{taskId}/renders/{renderId}/render.log`.
- Render artifact metadata must be based on real file metadata, including actual `sizeBytes` and content SHA-256.
- Render logs must use artifact-relative paths or redacted placeholders. They must not include API keys, Authorization headers, bearer tokens, or server-local absolute source paths.
- If the source file is missing or FFmpeg fails, the Host must not publish a fake render artifact. It returns the standard error envelope and preserves a redacted render log when available.

Current MVP scope includes render delivery package generation for `output.mp4`, `subtitles.ass`, `cover.png`, `render.json`, and `render.log`. Subtitle burn-in is implemented through the FFmpeg subtitles/libass filter. Basic voice enhancement is implemented by the standard FFmpeg audio preset `voice-basic-loudnorm-afftdn.v1` (`loudnorm` + `afftdn`). BGM/SFX mixing is asset-dependent and must not be fabricated when licensed assets are not configured; when configured asset directories contain supported audio files, the Host resolves `VideoSplitPlan.renderPreferences.audio` against the asset catalog, falls back to deterministic auto selection only for `mode=auto`, mixes BGM at 20% through FFmpeg `amix`, optionally mixes SFX, and records sanitized `assets://...` provenance plus SHA-256, license, source, and version in `render.json`.

Audio asset metadata rules:

- Optional directory manifest file: `asset-manifest.json`.
- Manifest schema id: `video-cut.asset-pack-manifest.v1`.
- Entry fields: `path`, `license`, `source`, `version`.
- `path` matches the selected basename only; server-local absolute paths are never copied to render artifacts or logs.
- If the manifest or entry is missing, the Host may still mix the selected user-provided audio asset but must mark provenance as `license=unverified-user-provided`, `source=configured-asset-directory`, and `version=sha256-{first16}` and must add a render warning.
- Metadata values must be safe strings and must not contain backslashes, NUL bytes, `..`, `file:` URLs, root-absolute paths, or Windows drive-absolute paths.
- The Host exposes configured asset repositories through `GET /api/video-cut/v1/assets/catalog` as `AssetCatalog` (`video-cut.asset-catalog.schema.v1`). The catalog includes `fonts`, `bgm`, `sfx`, and `coverTemplates` slots, supported extensions, entries, warnings, SHA-256, size, and safe license/source/version metadata.
- `AssetCatalog` is browser-safe: it may return relative configured paths, `assets://...` logical references, and `<server-local-path>` for absolute configured directories, but it must not return physical server-local paths.
- User-level BGM/SFX choices are stored only in `VideoSplitPlan.renderPreferences.audio`. `mode=asset` must reference a catalog `assetId` and `assets://...` path, `mode=disabled` must produce `status=disabled`, and unsafe or mismatched references must be rejected before replacing the plan artifact.

## Render Delivery Package

Every successful render attempt is stored under:

`workspace/projects/default/tasks/{taskId}/renders/{renderId}/`

The Host publishes these artifacts:

- `output.mp4`, `kind=render`, H.264/AAC MP4, generated by the FFmpeg render adapter.
- `subtitles.ass`, `kind=subtitle`, generated by the subtitle adapter from `TranscriptDocument`.
- `cover.png`, `kind=cover`, generated by the cover adapter from the source video segment midpoint.
- `render.json`, `kind=render-manifest`, generated by the render manifest adapter for repeatable audit.
- `render.log`, `kind=log`, generated with redacted process command and stderr/stdout summaries.

Subtitle rules:

- The internal subtitle delivery format is ASS.
- Subtitle cue timing is mapped from source timeline to the selected output timeline.
- `output.mp4` burns `subtitles.ass` through FFmpeg subtitles/libass after the standard 9:16 scale/crop/fps filter.
- When transcript status is not `ok`, the adapter still emits a valid ASS file with diagnostic comments, but it must not fabricate `Dialogue` rows.
- `subtitles.ass` is an artifact and must be downloaded through `/api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content`.

Render manifest rules:

- `render.json` uses schema id `video-cut.render-attempt.schema.v1`.
- It records `sourceArtifactId`, output/subtitle/cover/log artifact ids, `sourceRange`, `outputSpec`, render graph presets, `voiceEnhancement`, `bgm`, `sfx`, `subtitleBurnIn`, and `subtitleCueCount`.
- It must not contain absolute workspace paths, credentials, API keys, bearer tokens, or provider raw payloads.
- UI consumers must read `render.json` through `VideoCutHostClient.getArtifactText()` and the artifact content endpoint.
- UI consumers must read binary preview/download artifacts through `VideoCutHostClient.getArtifactContent()` and convert the returned `Blob` into a short-lived object URL. Direct content endpoint URLs are not valid browser media/download sources when `single-user-token` or reverse-proxy authorization is required.
- Host artifact delivery must support byte range reads on `output.mp4` and other binary media so browser playback can seek and buffer predictably. The standard response for a satisfiable range is `206 Partial Content` with `Accept-Ranges: bytes` and `Content-Range`; unsatisfied ranges return `416`. All artifact content responses must use private no-store and nosniff headers so private rendered media is not cached or MIME-sniffed.
- Results UI integrity status must be derived from the manifest artifact ids plus artifact metadata (`sizeBytes`, `sha256`), not from server-local file paths.

Cover rules:

- The cover adapter uses FFmpeg frame extraction at the selected segment midpoint.
- The cover crop uses the same 9:16 scale/crop standard as `output.mp4`.
- `cover.png` content type is `image/png` and must be served by the artifact content endpoint.

## Subtitle

内部字幕主模型是 `SubtitleDocument`，不是 SRT/VTT。

规则：

- ASS 是 MVP 烧录格式。
- SRT/VTT 只作为导入/导出格式。
- 字幕 cue 同时保留 source timeline 和 output timeline。
- 高亮词必须通过 `KeywordHighlightPort` 或人工 override。
- 缺字体必须 fallback，并记录 warning。

## Cover

封面由 `CoverRenderPort` 生成：

- 输入：封面标题、核心观点、截图帧、模板、字体、颜色。
- 输出：cover.png、cover.json。
- LLM 只能生成文案，不直接渲染图片。

## Media Smoke

## Source Upload Standard

本地导入必须通过 Host 写入 workspace，前端不得只保存浏览器文件名作为业务事实。

标准入口：

```http
POST /api/video-cut/v1/tasks/{taskId}/source/file
Content-Type: multipart/form-data
```

规则：

- multipart 字段名固定为 `file`。
- Host 对文件名做安全化处理，只保留安全 basename，不允许 `..`、`/`、`\` 参与路径拼接。
- 文件写入 `workspace/projects/default/tasks/{taskId}/source/{safeName}`。
- 大小按 `mediaTools.maxUploadBytes` 校验，超限返回 `SOURCE_FILE_TOO_LARGE`。
- 上传成功后替换当前 task 的 `source` artifact，并写入 task manifest、artifact manifest 和 events。
- UI 只能通过 `VideoCutHostClient.uploadTaskSourceFile()` 调用该能力。

媒体 smoke 至少验证：

- 输出 MP4 存在。
- 分辨率默认 1080x1920，且必须通过 `outputSpec` 显式记录；预览输出可使用任意正整数 9:16 尺寸。
- 帧率 30fps。
- 音频存在且可播放。
- 字幕 cue 时间合法且不重叠。
- render log 存在且无 secret。
