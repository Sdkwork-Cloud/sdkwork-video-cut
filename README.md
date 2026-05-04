# AI剪辑核心指令

## 当前可运行 MVP

本项目当前已提供 standalone React/Vite 本地工作台 MVP，不依赖 `spring-ai-plus-ai-api`、`spring-ai-plus-app-api` 或 Ollama。AI、语音、字幕、媒体工具、存储、运行时、安全和诊断配置通过 Settings Center 统一管理，运行时能力通过本地 host-client facade 暴露。

```bash
pnpm install
pnpm dev -- --host 127.0.0.1
pnpm dev:host
pnpm test -- --run
pnpm check:contracts
pnpm check:database-contracts
pnpm check:deployment-matrix -- --json
pnpm check:governance -- --json
pnpm host:test
pnpm deployment:doctor -- --json
pnpm workflow:smoke -- --json
pnpm workflow:smoke:server:managed -- --json
pnpm workflow:smoke:ui:managed -- --json
pnpm build
```
Current runnable app:
- React/Vite provides the full Workbench, Queue, Results, Diagnostics, and Settings Center UI.
- Rust/Axum Host is the single business kernel behind `/api/video-cut/v1`; the browser does not run FFmpeg or call model providers directly.
- The mock host client remains only for UI development and conformance tests.
- Local and server modes support file upload, analysis, split-plan review, manual transcript/subtitle import, real FFmpeg render, private artifact delivery, and OpenAI-compatible provider settings.

Rust host listens on `127.0.0.1:6177` by default:
```bash
pnpm dev:host
```

Rust host 默认使用文件系统 workspace manifest 作为 MVP 阶段 source of truth，不引入数据库 migration。默认路径为 `./workspace`，可通过 `SDKWORK_VIDEO_CUT_WORKSPACE_ROOT` 覆盖。任务会写入：

```text
workspace/projects/default/tasks/{taskId}/task.json
workspace/projects/default/tasks/{taskId}/events.jsonl
workspace/projects/default/tasks/{taskId}/plan/plan.json
workspace/projects/default/tasks/{taskId}/artifacts/manifest.json
workspace/runtime/settings.json
```

Database-backed queue support is implemented as an explicit opt-in adapter layer, not as the default local source of truth. The new-project database baseline lives in `host/database/schema/{sqlite,postgres}/001_baseline.sql`; `host/migrations/` is intentionally absent until a released database version needs an upgrade path. The database contract source is `docs/database/schema-registry/*.yaml`, and drift can be checked with:

```bash
pnpm check:database-contracts
cargo test --manifest-path host/Cargo.toml --test database_queue_test -- --nocapture
pnpm check:feature-readiness -- --json
```

`runtime/settings.json` 只保存非 secret 设置和 `apiKeyConfigured` 状态；`ai.apiKey`、`speechToText.apiKey` 等明文字段会在 host 入库前剥离。

The browser bundle uses the same-origin `/api/video-cut/v1` Host route by default. Development, Tauri, container, and Kubernetes deployments should route that path through the local Vite proxy, desktop shell, reverse proxy, or ingress instead of baking Host configuration into `VITE_*` build-time variables.

```bash
pnpm dev
```

Server/private direct API mode requires a single-user server token on the Host and automation clients. The token is sent as an `Authorization` header, never as a URL query string, and must not be placed in `VITE_*` browser build variables because Vite embeds those values into static JavaScript:

```bash
SDKWORK_VIDEO_CUT_RUNTIME_MODE=server-private
SDKWORK_VIDEO_CUT_BIND_HOST=0.0.0.0
SDKWORK_VIDEO_CUT_PORT=6177
SDKWORK_VIDEO_CUT_AUTH_MODE=single-user-token
SDKWORK_VIDEO_CUT_SERVER_TOKEN=replace-with-local-secret
SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com
SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_API_KEY=replace-with-llm-secret
SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_CHAT_MODEL=gpt-4.1-mini
SDKWORK_VIDEO_CUT_STT_BASE_URL=https://api.openai.com
SDKWORK_VIDEO_CUT_STT_API_KEY=replace-with-stt-secret
SDKWORK_VIDEO_CUT_STT_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE=openai-audio-transcriptions
SDKWORK_VIDEO_CUT_STT_RESOURCE_ID=volc.bigasr.auc
pnpm dev:host
pnpm dev -- --host 127.0.0.1
pnpm deployment:doctor:server:private -- --json
pnpm workflow:smoke:server:private -- --json
pnpm workflow:smoke:server:managed -- --json
pnpm workflow:smoke:ui:managed -- --json
```

The managed UI smoke injects the temporary Host URL and token into the browser at runtime before page code executes, so it can verify private artifact delivery without baking deployment configuration or credentials into a bundle. Production web deployments should terminate auth at the reverse proxy or inject short-lived runtime credentials outside the static Vite environment.

Browser-facing dev and smoke child processes sanitize inherited environment variables before launching Vite or Tauri. They strip every `VITE_*`, `SDKWORK_VIDEO_CUT_*`, and legacy `VIDEO_CUT_*` key so static browser runtimes cannot accidentally inherit local server tokens, provider keys, or Host configuration from the shell.

Container and Kubernetes manifests use `SDKWORK_VIDEO_CUT_AUTH_MODE=reverse-proxy` by default. In that mode the upstream proxy, gateway, or ingress is responsible for user authentication before requests reach the Host.

Container and Kubernetes deployment artifacts are provided under `deploy/`:

```bash
pnpm check:deployment-artifacts
pnpm check:deployment-matrix -- --json
docker compose -f deploy/docker/docker-compose.yml up --build
helm template sdkwork-video-cut ./deploy/kubernetes -f deploy/kubernetes/values.yaml
```

- `deploy/docker/Dockerfile` contains separate `host-runtime` and `web-runtime` targets.
- `deploy/docker/docker-compose.yml` runs the Rust Host and an Nginx web proxy against the same `/api/video-cut/v1` contract.
- `deploy/kubernetes` provides a Helm-compatible chart skeleton with ConfigMap, Secret, PVC, Deployment, Service, Ingress, and HPA templates.
- `deploy/runtime-profiles.yaml` is the machine-readable runtime profile registry for desktop-local, server-private, web-private, container-private, and kubernetes-private modes.
- `pnpm check:contracts -- --json` writes `artifacts/governance/openapi-contracts-report.json` and verifies the public OpenAPI/runtime environment contract through a pure Node gate that does not start Vite/Vitest.
- `pnpm check:deployment-artifacts -- --json` writes `artifacts/governance/deployment-artifacts-report.json` and verifies deployment artifacts through a pure Node gate that does not start Vite/Vitest.
- `pnpm check:deployment-matrix -- --json` writes `artifacts/governance/deployment-matrix-report.json` and verifies the deployment command matrix.
- `pnpm check:smoke-evidence -- --json` writes `artifacts/governance/smoke-evidence-contracts-report.json` and verifies smoke runner/report/release evidence contracts through a pure Node gate. Missing local live smoke samples are warnings by default; explicit `--smoke-report target=path` inputs are strict.
- `pnpm check:governance -- --json` writes `artifacts/governance/governance-suite-report.json` and generates `artifacts/governance/sdkwork-video-cut-sbom.cdx.json` for architecture, runtime-boundary, security, license/SBOM, release-flow, ADR, and SLO gates.
- `release:package:*` writes `release-manifest.json`, `SHA256SUMS.txt`, `release-notes.md`, `quality-gate-execution-report.json`, and `sdkwork-video-cut-sbom.cdx.json`; the release manifest records API/schema/provider/runtime profile versions for desktop, server, web, container, and Kubernetes targets.
- `release-manifest.json.runtimeProfile` is copied from `deploy/runtime-profiles.yaml` by `releaseTarget`; the release command does not maintain an inline profile map.
- `--release-assets-dir` must be project-relative. Release action reports, manifests, checksum files, release notes, and quality gate reports must record project-relative paths only; server-local absolute paths are used only internally while writing files and must not be serialized into release JSON.
- `release:smoke:*` first writes a target smoke report under `artifacts/release/smoke/{target}-smoke-report.json`, then packages that report as validated release evidence through `--smoke-report`.
- `release:smoke:preflight -- --json` writes `artifacts/governance/release-smoke-preflight-report.json` and verifies the real smoke environment before runtime mutation: FFmpeg spawn, Cargo spawn, Host Cargo manifest, Vite binary, Chromium-compatible browser, local port allocation, writable release/smoke/runtime directories, and report redaction/path safety.
- `release:smoke:matrix` first runs the preflight gate, then runs the five target smoke commands only when `environmentStatus=ready`. If the environment is blocked, it writes `artifacts/governance/release-smoke-matrix-report.json` with `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED` target evidence and no Host/Vite/browser/FFmpeg smoke workflow is started.
- `release:smoke:desktop`, `release:smoke:container`, and `release:smoke:kubernetes` reject HTTP workflow reports that do not prove health, task create, multipart upload, analysis, plan roundtrip, render, artifact list, download descriptors, full artifact content download, byte range artifact content delivery, private no-store/nosniff artifact headers, events, redaction, `taskId`, source size, MP4 signature, and `host-content-endpoint` delivery.
- `release:smoke:server` rejects managed server reports that do not prove Host build/start/health, workflow smoke, process cleanup, redaction, `single-user-token` runtime, and a nested HTTP workflow report with upload/render/artifact content/range/security-header proof.
- `release:smoke:web` additionally rejects smoke reports that lack private browser artifact delivery evidence, including authenticated preview fetch, authenticated download fetch, `blob:` preview URL, Settings Center/doctor/diagnostics verification, and `ui.localPathLeakVisible=false`.

运行时模板见 `.env.example`。HTTP 公共契约见 `docs/openapi/video-cut-v1.yaml`，契约校验通过 `pnpm check:contracts` 执行。

模型、语音转文字、字幕和 Secret 均通过 Rust host provider port 标准封装。当前标准模块位于 `host/src/providers.rs`，OpenAI-compatible endpoint 固定为 `/v1/chat/completions` 和 `/v1/audio/transcriptions`，并在 `/api/video-cut/v1/capabilities` 中声明 `ollamaAllowed=false`。

STT 通过 Host speech bridge 统一成 OpenAI-style verbose transcription contract。当前支持 `speechToText.providerProfile=openai-audio-transcriptions`、`volcengine-bigasr-flash`、`aliyun-qwen-asr`。火山 BigASR Flash 使用 `{baseUrl}/api/v3/auc/bigmodel/recognize/flash` 和 `speechToText.resourceId`，阿里 Qwen-ASR 使用 `{baseUrl}/compatible-mode/v1/chat/completions`。前端不直接调用厂商 API，diagnostics/conformance 只输出 `credentialStatus` 和非敏感元数据。

Settings Center 和 Rust host 都执行 provider/runtime 校验。启用 AI/STT 时必须配置 OpenAI-compatible URL、模型和 API key 状态；Ollama、`localhost:11434`、`127.0.0.1:11434` 会被拒绝。server/container/kubernetes 等非本地模式绑定 `0.0.0.0` 时必须启用 token 或 reverse-proxy 鉴权。`security.corsAllowedOrigins` 是唯一 CORS 来源白名单，默认允许本地 Vite origin，可通过 `SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS` 传入逗号分隔的 HTTP(S) origin；通配 `*` 和非法 URL 会被拒绝。Rust host 的 `PUT /settings` 返回标准 `ValidationResult`，无效配置不会写入运行时状态。

HTTP API 使用标准 envelope：

```json
{
  "ok": true,
  "data": {}
}
```

Malformed JSON, missing JSON content type, or schema-incompatible JSON request bodies return the standard `ApiErrorEnvelope` with `REQUEST_JSON_INVALID`; malformed multipart upload bodies or missing multipart boundaries return `MULTIPART_INVALID`; invalid path parameters return `PATH_PARAMETER_INVALID`; invalid query parameters return `QUERY_PARAMETER_INVALID`; unknown API routes return `ROUTE_NOT_FOUND`; unsupported methods on known routes return `METHOD_NOT_ALLOWED`; public `/api/video-cut/v1` endpoints must not leak Axum default `text/plain` extractor or routing responses.

## 类型 1：张老师单人独立口播视频

### 【视频基础】

-   身份：张伟用老师（艾俪特国际创始人，美国J1访学教父）
-   输出比例：9:16
-   分辨率：默认生产 preset 为 1080×1920；Host/OpenAPI 允许正整数 9:16 `outputSpec`（例如 360×640 预览 preset）
-   帧率：30fps
-   格式：MP4
-   时长：≤90秒

### 【剪辑要求】

1.  删除停顿、咳嗽、重复
2.  聚焦上半身（占2/3画面）
3.  画面稳定
4.  语音增强（无混响）

### 【字幕要求】

1.  简体中文逐句字幕
2.  极宋字体 + 阴影（95% / 模糊9%）
3.  黄色高亮重点
4.  100%同步语音

### 【包装要求】

1.  轻音乐（20%音量）
2.  自动封面（问题+核心）
3.  风格专业干净
4.  提示音"叮"
5.  画面优化

### 【输出结果】

-   单条可发布视频

------------------------------------------------------------------------

## 类型 2：访谈视频

### 【剪辑逻辑】

-   1问1答切分
-   删除无效内容
-   画面稳定 + 轻微缩放
-   批量生成

（其余规则同类型1）

------------------------------------------------------------------------

## 类型 3：长访谈拆条

### 【核心】

-   提取问答
-   单条60-180秒
-   去广告/废话
-   批量输出

### 【输出】

-   矩阵短视频内容

## 2026-04-27 Implementation Note: Deployment Doctor

Runtime diagnostics are implemented as the standard `DeploymentDoctorReport` contract.

- `GET /api/video-cut/v1/capabilities` returns the shared `CapabilityReport` used by UI, doctor, release smoke, and deployment checks.
- `GET /api/video-cut/v1/doctor` returns host health, workspace writable, ffmpeg, ffprobe, provider policy, settings validation, and redaction checks.
- `GET /api/video-cut/v1/diagnostics/bundle` returns `video-cut.diagnostics-bundle.v1` with capability, doctor, and redacted effective config.
- `POST /api/video-cut/v1/diagnostics/support-bundle` returns the same bundle contract with `supportRequest` evidence and task attachment descriptors only when the user has accepted explicit per-export consent.
- The doctor response includes `redactedConfig` and must not include plaintext `ai.apiKey` or `speechToText.apiKey` fields.
- Diagnostics bundle export defaults to `sourceMedia=false` and `transcript=false`.
- Source media or transcript support attachments require `consentAccepted=true`, a selected `taskId`, and at least one attachment flag. The response contains only workspace-relative `path`, host-relative `contentRef`, `artifactId`, `sizeBytes`, `sha256`, and redaction metadata; it never embeds media bytes, transcript text, API keys, bearer tokens, Authorization headers, or server-local absolute paths.
- The React Diagnostics page and Settings Center both convert the host bundle into a downloadable JSON file with media type `application/vnd.sdkwork.video-cut.diagnostics+json`.
- Browser-side export uses `DiagnosticBundleDownloadDescriptor` to generate a deterministic filename, byte size, and data URL, and it blocks download when `apiKey`, bearer tokens, Authorization headers, passwords, common token fields, or server-local absolute paths are detected.
- `pnpm deployment:doctor -- --json` runs the deployment smoke wrapper against the configured host URL and returns `video-cut.deployment-doctor.cli.v1`.
- `pnpm workflow:smoke -- --json` runs the real HTTP workflow smoke against `/api/video-cut/v1`: generate or read an MP4, create a task, upload, analyze, round-trip the split plan, render, download `output.mp4`, `render.json`, and `render.log`, and emit `video-cut.http-workflow-smoke.v1`.
- `pnpm workflow:smoke:server:managed -- --json` builds the Rust Host, starts an isolated `server-private` process with a generated single-user token and temporary workspace, runs the same HTTP workflow smoke with bearer auth, then shuts the process down and emits `video-cut.managed-server-workflow-smoke.v1`.
- `pnpm workflow:smoke:ui:managed -- --json` builds and starts an isolated `server-private` Host, starts an isolated Vite web process, injects runtime Host configuration before page code executes, opens Chrome through `playwright-core`, uploads a generated MP4 through the Workbench UI, analyzes, renders, opens the Results page, verifies the render manifest delivery package, verifies artifact content endpoint fetches carry Bearer auth, verifies preview media uses a `blob:` URL instead of a raw private API URL, checks that no server-local absolute path is visible, then shuts down both processes and emits `video-cut.managed-ui-workflow-smoke.v1`.
- The managed UI smoke also opens Settings Center, saves write-only LLM/STT secrets through the Host, clears plaintext inputs, runs provider conformance, runs doctor, exports diagnostics, and verifies redaction. The required report fields are `ui.artifactContentEndpointFetched`, `ui.artifactContentAuthorizationVerified`, `ui.artifactDownloadButtonVisible`, `ui.artifactDownloadContentFetched`, `ui.artifactDownloadAuthorizationVerified`, `ui.outputPreviewBlobUrl`, `ui.settingsSaved`, `ui.providerConformanceVerified`, `ui.doctorVerified`, `ui.diagnosticsBundleVerified`, and `ui.settingsRedactionVerified`.
- Doctor and diagnostics reports use diagnostics-grade redaction: API keys, bearer tokens, `Authorization` headers, and server-local absolute workspace/artifact/temp paths are never emitted. Absolute local paths are replaced with `<redacted-path>` while Settings Center still keeps editable runtime path values through `GET /settings`.

## 2026-04-27 Implementation Note: Provider Conformance

OpenAI-compatible provider dry-run conformance is implemented through the host only.

- `POST /api/video-cut/v1/providers/openai-compatible/conformance` returns `video-cut.provider-conformance.v1`.
- Request target supports `ai`, `speechToText`, and `all`.
- The report describes `/v1/chat/completions`, `/v1/audio/transcriptions`, structured output mode, multipart transcription shape, STT bridge profile metadata, vendor endpoint mapping, and validation errors.
- The report never emits `apiKey`, secret ref, token, Authorization header, or plaintext credentials; it only emits `credentialStatus`.
- Settings Center uses this API for “Test structured output” and “Test transcription”.

## 2026-04-27 Implementation Note: Local Source Upload

Local video import now has a real host-side upload path.

- `POST /api/video-cut/v1/tasks` creates a `draft` task only. It does not accept `sourceName`, publish a `kind=source` artifact, create an import event, or synthesize `input.mp4`.
- A task moves to `sourceReady` only after `POST /api/video-cut/v1/tasks/{taskId}/source/file` or `POST /api/video-cut/v1/tasks/{taskId}/source` succeeds.
- `POST /api/video-cut/v1/tasks/{taskId}/source/file` accepts `multipart/form-data` with a required `file` field.
- Malformed multipart upload envelopes return `MULTIPART_INVALID`; missing file fields return `SOURCE_FILE_REQUIRED`; invalid media types return `SOURCE_FILE_TYPE_UNSUPPORTED`.
- The host writes the uploaded file to `workspace/projects/default/tasks/{taskId}/source/{safeName}`.
- Uploaded source artifact `sizeBytes` and `sha256` are derived from the uploaded bytes, not from deterministic placeholders.
- Source filenames are sanitized before storage; path traversal segments are never used as workspace paths.
- Metadata source attachment and multipart upload use the same safe basename rule, so manifests never persist user-supplied path separators or server-local absolute paths.
- Metadata source attachment and multipart upload also use the same source media type policy. Supported source extensions are `mp4`, `mov`, `m4v`, `mkv`, `webm`, `avi`, `mpeg`, and `mpg`; explicit content types must be `video/*`, `application/x-matroska`, or `application/octet-stream`. Unsupported inputs return `SOURCE_FILE_TYPE_UNSUPPORTED` before replacing the current source artifact.
- Upload size is checked against `mediaTools.maxUploadBytes`.
- The source artifact replaces prior `source` artifacts for the task and is persisted into `task.json`, `events.jsonl`, and `artifacts/manifest.json`.
- The React workbench now creates a task and then uploads the selected `File` through `VideoCutHostClient.uploadTaskSourceFile()`.
- `Import sample video` uses the same upload boundary with an embedded tiny MP4 fixture; it does not create a metadata-only source placeholder.
- Local and server upload/render delivery can be verified from the TCP HTTP boundary with `pnpm workflow:smoke -- --json` or `pnpm workflow:smoke:server:private -- --json`.
- A fully isolated server-private boot path can be verified with `pnpm workflow:smoke:server:managed -- --json`; this covers process startup, token auth, upload, analysis, render, artifact download, byte range artifact delivery, private no-store/nosniff artifact headers, redaction, and process cleanup. Its report keeps a sanitized nested HTTP workflow evidence block so `release:smoke:server` can verify upload/render/artifact content/range/security-header proof without leaking tokens or workspace paths.
- The full browser path can be verified with `pnpm workflow:smoke:ui:managed -- --json`; this covers real UI controls, runtime-injected Host configuration, bearer-auth HTTP client configuration, Host upload, analysis, render, Results page delivery package verification, authenticated artifact content fetches, `blob:` preview URL validation, local path leak checks, redaction, and cleanup.

## 2026-04-27 Implementation Note: MediaInfo Probe Artifact

The analyze stage now writes a standard media-info analysis artifact before publishing the split plan.

- `POST /api/video-cut/v1/tasks/{taskId}/analyze` requires a current `kind=source` artifact. Draft tasks without uploaded or attached source media return `SOURCE_FILE_REQUIRED` and remain `draft`.
- `POST /api/video-cut/v1/tasks/{taskId}/analyze` creates `workspace/projects/default/tasks/{taskId}/analysis/media-info.json`.
- Analysis JSON, extracted audio, and split-plan artifact metadata now uses the exact bytes written to the workspace for `sizeBytes` and SHA-256.
- The document schema id is `video-cut.media-info.schema.v1`.
- The artifact id is `{taskId}-media-info` and the kind is `analysis`.
- `probeStatus` is `ok`, `failed`, or `source-unavailable`; failed states are persisted with warnings instead of fake success metadata.
- `mediaInfoTrack.sourceArtifactId` in the generated split plan references `{taskId}-media-info`.
- The generated split plan derives its default `segments[0].sourceRange` from `media-info.format.durationSeconds` when probing succeeds, so a short uploaded source can be analyzed and rendered without a manual range edit. If media duration is unavailable, the host keeps a conservative fallback range and records a segment warning.
- Frontend domain contracts now expose `validateMediaInfoDocument()` and OpenAPI declares `MediaInfoDocument`, `MediaFormatInfo`, `MediaVideoStream`, and `MediaAudioStream`.

## 2026-04-27 Implementation Note: Audio Extract And Silence Ranges

The analyze stage now continues past media probing into local FFmpeg-based audio preparation.

- `analysis/audio-extract.json` uses schema id `video-cut.audio-extract.schema.v1`.
- Successful extraction writes `audio/source.wav` as 16kHz mono `pcm_s16le` WAV and publishes `{taskId}-audio-source` with `kind=audio`.
- Failed extraction still writes a standard report with `extractStatus=failed` or `source-unavailable` and warnings.
- `analysis/silence-ranges.json` uses schema id `video-cut.silence-ranges.schema.v1`.
- Silence detection consumes only the extracted WAV artifact and writes millisecond ranges from FFmpeg `silencedetect`.
- When WAV is unavailable, silence detection writes `detectionStatus=audio-unavailable` with warnings instead of fake ranges.
- `silenceTrack.sourceArtifactId` in the generated split plan references `{taskId}-silence-ranges`.

## 2026-04-27 Implementation Note: Speech Activity / VAD Artifact

The analyze stage now also writes a standard speech activity artifact behind a `SpeechActivityDetectionPort` style boundary.

- `analysis/vad-ranges.json` uses schema id `video-cut.vad-ranges.schema.v1`.
- The artifact id is `{taskId}-vad-ranges` and the kind is `analysis`.
- VAD consumes only `{taskId}-audio-source`; it never reads the source video directly and never calls AI/STT providers.
- The standard provider id is `silero-vad-onnx` with adapter version `silero-vad-onnx.adapter.v1`.
- `vadStatus` is `ok`, `failed`, `unavailable`, or `audio-unavailable`.
- If audio is unavailable, ONNX Runtime is disabled, the Silero model is missing, or the host build has not linked ONNX inference yet, the artifact is still persisted with warnings and an empty `ranges` array.
- The system must not fabricate speech ranges. Only a successful VAD inference may populate `ranges`.
- `speechActivityTrack.sourceArtifactId` in the generated split plan references `{taskId}-vad-ranges`.

## 2026-04-27 Implementation Note: Transcript Artifact

The analyze stage now writes a standard transcript artifact behind a `SpeechToTextPort` style boundary.

- `analysis/transcript.json` uses schema id `video-cut.transcript.schema.v1`.
- The artifact id is `{taskId}-transcript` and the kind is `analysis`.
- Transcription consumes only `{taskId}-audio-source`; it never reads the source video directly.
- The default provider id is `openai-compatible-transcription` with adapter version `openai-compatible-transcription.adapter.v1`.
- `transcriptStatus` is `ok`, `failed`, `provider-unavailable`, or `audio-unavailable`.
- The canonical output standard remains OpenAI-style verbose transcription JSON; Ollama is not allowed.
- Provider profiles are selected through `speechToText.providerProfile`: `openai-audio-transcriptions` calls `/v1/audio/transcriptions`, `volcengine-bigasr-flash` calls BigASR Flash and maps utterances to canonical segments, and `aliyun-qwen-asr` calls Qwen-ASR through an OpenAI-compatible chat completion payload with `input_audio`.
- If audio is unavailable or the STT provider is disabled/not fully configured/not executable in the current host build, the artifact is still persisted with warnings, empty `text`, and an empty `segments` array.
- The system must not fabricate transcript text or segments. Only a successful STT provider execution may populate them.
- `transcriptTrack.sourceArtifactId` in the generated split plan references `{taskId}-transcript`.

## 2026-04-27 Implementation Note: Semantic Analysis Artifact

The analyze stage now writes a standard semantic analysis artifact behind a `SemanticAnalysisPort` style boundary.

- `analysis/semantic-analysis.json` uses schema id `video-cut.semantic-analysis.schema.v1`.
- The artifact id is `{taskId}-semantic-analysis` and the kind is `analysis`.
- Semantic analysis consumes only `{taskId}-transcript`; it never reads media files directly and never mutates transcript artifacts.
- The default provider id is `openai-compatible-semantic-analysis` with adapter version `openai-compatible-semantic-analysis.adapter.v1`.
- `semanticStatus` is `ok`, `failed`, `provider-unavailable`, or `transcript-unavailable`.
- OpenAI-compatible LLM execution remains standardized on `/v1/chat/completions` with structured output.
- If transcript output is unavailable or the AI provider is disabled/not fully configured/not executable in the current host build, the artifact is still persisted with warnings, empty `summary`, and empty `topics`/`qaCandidates` arrays.
- The system must not fabricate semantic summaries, topics, QA candidates, or cut facts.
- `semanticTrack.sourceArtifactId` in the generated split plan references `{taskId}-semantic-analysis`.

## 2026-04-27 Implementation Note: Runtime Secret Store And OpenAI-Compatible Execution

Provider credentials now have a runtime secret boundary.

- `PUT /api/video-cut/v1/settings` accepts `ai.apiKey` and `speechToText.apiKey` as write-only input.
- The host extracts plaintext keys into an in-memory `SecretStorePort` and persists only `apiKeyConfigured` markers.
- `GET /settings`, `runtime/settings.json`, doctor reports, diagnostics bundles, provider conformance reports, events, and analysis artifacts do not emit `apiKey`, bearer tokens, Authorization headers, or plaintext credentials.
- STT execution can call OpenAI-compatible `/v1/audio/transcriptions` through the host adapter when audio, settings, and runtime secret are available.
- Semantic analysis can call OpenAI-compatible `/v1/chat/completions` with structured output through the host adapter when transcript, settings, and runtime secret are available.
- Provider DTOs are converted into standard `TranscriptDocument` and `SemanticAnalysisDocument` artifacts before downstream stages consume them.
- If credentials are unavailable after restart in the current local MVP, analysis writes standard `provider-unavailable` artifacts with warnings rather than fabricating output.

## 2026-04-27 Implementation Note: Real FFmpeg Render/Cut

The render stage now uses a real Host-side media render adapter instead of publishing a fake `output.mp4` artifact.

- `POST /api/video-cut/v1/tasks/{taskId}/source/file` writes the browser/server uploaded file into the workspace before analysis or render.
- `POST /api/video-cut/v1/tasks/{taskId}/render` resolves the current `source` artifact from the workspace and renders the first split-plan segment with FFmpeg.
- The MVP render graph trims `sourceRange`, scales/crops to the plan output spec, normalizes frame rate, and writes H.264/AAC MP4 to `workspace/projects/default/tasks/{taskId}/renders/{renderId}/output.mp4`.
- Each render request creates a distinct `renderId`; repeated render calls do not overwrite previous attempts.
- Successful render publishes `kind=render` `output.mp4`, `kind=subtitle` `subtitles.ass`, `kind=cover` `cover.png`, `kind=render-manifest` `render.json`, and `kind=log` `render.log` artifacts with real file size and SHA-256 metadata.
- `subtitles.ass` is generated by the Host subtitle adapter from the standard transcript artifact and is burned into `output.mp4` through the FFmpeg subtitles/libass filter. When transcription is unavailable, the ASS file contains only headers and diagnostic comments, never fabricated dialogue lines.
- `cover.png` is generated by the Host cover adapter using FFmpeg frame extraction at the selected segment midpoint and the same output crop standard as the video render.
- `render.json` uses schema id `video-cut.render-attempt.schema.v1` and records video/audio render graph presets, voice enhancement status, BGM/SFX status, selected asset provenance, source range, artifact ids, subtitle burn-in status, and subtitle cue count for repeatable audit.
- Basic voice enhancement is applied through the standard FFmpeg audio preset `voice-basic-loudnorm-afftdn.v1` (`loudnorm` + `afftdn`).
- BGM/SFX are never fabricated. If licensed assets are not configured, the manifest records BGM `volumePercent=20`, `mixed=false`, `status=not-configured`, and SFX `mixed=false`, `status=not-configured`.
- When files are present in the configured `settings.assets.bgm` or `settings.assets.sfx` directories, the Host resolves `VideoSplitPlan.renderPreferences.audio` against the asset catalog, falls back to deterministic first-file selection only for `mode=auto`, mixes BGM at 20% through the standard FFmpeg `amix` graph, optionally mixes SFX, and records sanitized `assets://...`, `assetId`, SHA-256, `license`, `source`, and `version` in the manifest.
- Asset directories may include `asset-manifest.json` with schema id `video-cut.asset-pack-manifest.v1` and entries shaped as `{ "path": "licensed-bgm.wav", "license": "CC0-1.0", "source": "https://example.invalid/pack", "version": "2026.04" }`. If the file or entry is absent, the Host still records deterministic fallback provenance as `license=unverified-user-provided`, `source=configured-asset-directory`, and `version=sha256-{first16}`, plus a render manifest warning.
- `GET /api/video-cut/v1/assets/catalog` returns `video-cut.asset-catalog.schema.v1` for Settings Center asset-pack inspection. The catalog covers fonts, BGM, SFX, and cover templates, returns only `assets://...` logical references plus `<server-local-path>` for absolute configured directories, and never exposes physical server paths to browser clients.
- Workbench render asset choices are persisted through `VideoSplitPlan.renderPreferences.audio` with `auto`, `asset`, and `disabled` modes. `asset` mode must use the `assetId` and `assets://...` path returned by the asset catalog; server-local asset paths are never accepted from the browser.
- Browser/server artifact consumption uses `GET /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content`, which serves binary artifact content through the Host artifact repository instead of exposing server-local paths.
- The artifact content endpoint supports browser-safe single byte range requests for media playback. `Range: bytes=start-end` returns `206 Partial Content` with `Accept-Ranges: bytes`, `Content-Range`, and exact `Content-Length`; unsatisfied ranges return `416` with `Content-Range: bytes */{size}`. All artifact content responses use `Cache-Control: private, no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`.
- Render errors use the standard redacted error envelope. When FFmpeg starts and fails, the Host writes a redacted `render.log` artifact for diagnosis.
- The frontend never calls FFmpeg directly; local, server, container, and Kubernetes modes all use the same `/api/video-cut/v1` Host contract.

## 2026-04-27 Implementation Note: Split Plan Review

The Workbench now exposes the first generated split-plan segment for manual review.

- After analysis, the UI loads the current `VideoSplitPlan` through `GET /api/video-cut/v1/tasks/{taskId}/plan`.
- Users can edit `segments[0].sourceRange.startMs` and `segments[0].sourceRange.endMs`.
- Saving uses `PUT /api/video-cut/v1/tasks/{taskId}/plan`; the UI increments `planRevision`, updates `outputRange`, and records `manual-override` in `decisionReasons`.
- Host plan saves validate the split-plan contract before mutation. Invalid schema, missing standard tracks/segments, invalid ranges, or URL/body task id mismatch return `PLAN_INVALID` or `PLAN_TASK_ID_MISMATCH` without replacing `plan/plan.json` or `{taskId}-plan` artifact metadata.
- The render adapter still consumes the persisted plan only; it does not read UI state or mutate plan data.

## 2026-04-27 Implementation Note: Manual Transcript Import

STT is no longer the only way to produce subtitle-backed renders.

- `PUT /api/video-cut/v1/tasks/{taskId}/transcript` accepts manual transcript segments and writes a standard `TranscriptDocument`.
- The host stores the document at `workspace/projects/default/tasks/{taskId}/analysis/transcript.json` and replaces the current `{taskId}-transcript` artifact instead of creating duplicates.
- Manual transcript documents use `providerId=manual-transcript`, `adapterVersion=manual-transcript.adapter.v1`, `transcriptStatus=ok`, and segment-level millisecond timing.
- The Workbench can save manual transcript text for the selected range. It persists the matching plan range first, then imports the transcript through the Host API.
- Render continues to consume only the persisted transcript artifact. Manual transcript text is not stored in browser localStorage as a secret or provider payload.

## 2026-04-27 Implementation Note: Render Manifest Results UI

The Results page now reads the standard render delivery package instead of relying on server-local paths.

- `VideoCutHostClient.getArtifactText(taskId, artifactId)` reads text artifacts through `GET /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content`.
- `VideoCutHostClient.getArtifactContent(taskId, artifactId)` reads binary artifacts through the same canonical endpoint with the configured Host authorization headers. Results preview and download actions convert those blobs into short-lived object URLs, so `server-private` browser media elements do not rely on unauthenticated direct links.
- The frontend Host client intentionally does not expose reusable artifact content URL helpers; private artifact access is always fetched through authenticated Blob/text readers before a short-lived `blob:` URL is created.
- `VideoCutHostClient` normalizes standard `{ ok: false, error }` envelopes for JSON APIs, text artifact reads, and binary artifact reads into `VideoCutHostApiError`; error envelopes are never rendered as log text or exposed as downloaded blobs.
- `VideoCutHostClient` rejects 2xx JSON API responses that are not standard `{ ok: true, data }` envelopes with `RESPONSE_ENVELOPE_INVALID`, so malformed Host/proxy responses cannot enter UI state as `undefined`.
- Results preview, render-manifest loading, and download failures render the same `OperationError` metadata inline, preserving code, HTTP status, trace id, and endpoint for support diagnostics.
- The Results page loads the `kind=render-manifest` artifact and parses `video-cut.render-attempt.schema.v1`.
- The delivery panel shows `sourceRange`, output spec, FFmpeg render graph preset, audio filter preset, voice enhancement state, BGM/SFX status, codec, subtitle burn-in state, subtitle cue count, and artifact integrity status.
- Integrity evidence checks the standard delivery artifacts: `output.mp4`, `subtitles.ass`, `cover.png`, `render.log`, and `render.json`.
- Missing artifacts, invalid hashes, or manifest warnings are surfaced as a delivery warning without exposing server-local filesystem paths.

## 2026-04-27 Implementation Note: Standard Operation Errors

Workbench, Settings Center, and Diagnostics operations now surface Host failures through a single UI error contract.

- `VideoCutHostApiError` from the HTTP adapter is normalized into `OperationError` without coupling UI components to transport internals.
- `VideoCutHostApiError` lives in the domain layer and is shared by HTTP and local mock Host adapters, so local mode exposes the same error metadata as server mode.
- The operation error panel shows title, safe message, error code, HTTP status, trace id, and endpoint.
- Results page inline artifact warnings use the same `OperationError` fields for preview, manifest, and download failures.
- Startup and task refresh only treat `TASK_PLAN_NOT_FOUND` as an optional missing split plan. `TASK_NOT_FOUND` and unexpected plan loading failures are surfaced through the same `OperationError` panel.
- The panel never reads FFmpeg stderr, provider raw payloads, secrets, or server-local media paths.
- Workbench import, analyze, render, split-plan save, manual transcript import, doctor, diagnostics export, provider conformance, and settings save all use the same operation wrapper.
- Primary Workbench actions expose stable `aria-label` values for local/server automation and accessibility.

## 2026-04-27 Implementation Note: Task Selection And Queue Controls

The UI now treats tasks as explicitly selected operational records instead of always acting on the first row.

- App state tracks `selectedTaskId` and loads artifacts, events, and split plan for that task after import, selection, analyze, render, cancel, or delete.
- Workbench task rows are selectable buttons with stable `Select task {sourceName}` labels, so multi-upload workflows can switch between task contexts without mixing artifacts.
- Queue rows expose standard Select, Cancel, Retry, and Delete actions backed by the existing `VideoCutHostClient` contract.
- Retry is enabled for `failed` and `interrupted` tasks. Render-stage failures retry render; other failed stages retry analysis.
- Succeeded tasks with a persisted split plan can be rendered again; repeated render attempts create distinct render artifacts instead of overwriting the prior delivery package.

## 2026-04-27 Implementation Note: Startup Runtime Recovery

The UI now treats startup host loading as a recoverable operation.

- Initial runtime loading covers capabilities, doctor report, settings, task list, selected task artifacts, events, and split plan.
- If any startup host request fails, the same standard operation error panel is used with title `Load runtime state failed`.
- Startup errors expose the safe host message, error code, HTTP status, trace id, and endpoint without leaking provider payloads or local paths.
- The panel includes a `Reload runtime state` recovery action. A successful retry refreshes runtime state and clears the error panel without requiring a browser refresh.

## 2026-04-27 Implementation Note: Task Event Recovery Hints

Task-level failure recovery now comes from Host event metadata instead of UI-local guesses.

- `GET /api/video-cut/v1/tasks/{taskId}/events` returns optional `VideoCutProgressEvent.level` and `VideoCutProgressEvent.metadata.recoveryHint`.
- `metadata.recoveryHint` is the standard safe recovery object with `code`, `action`, `label`, `message`, `retryable`, and optional `targetStage`.
- Render failures that publish a redacted `render.log` artifact now emit `RENDER_FAILED_REVIEW_LOG` with action `retry-render`.
- Workbench event stream and Queue selected-task rows display the latest recovery hint for the selected task.
- Recovery hint text must not contain API keys, bearer tokens, Authorization headers, raw provider payloads, raw FFmpeg stderr, or server-local absolute paths.
