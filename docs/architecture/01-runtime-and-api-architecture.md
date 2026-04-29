# 01 Runtime And API Architecture

日期：2026-04-26

## 目标

本标准定义 `sdkwork-video-cut` 的运行时架构、唯一业务内核、前端调用边界和 canonical API。所有部署形态必须遵守本文件。

## Runtime Topology

```text
React workbench
  -> sdkwork-video-cut-core host client
  -> /api/video-cut/v1
  -> Rust host application use cases
  -> domain services
  -> ports
  -> adapters
  -> tools/providers/storage
```

桌面形态只是多了一个 Tauri shell：

```text
Tauri shell
  -> starts/supervises local Rust host
  -> injects runtime baseUrl
  -> opens file/folder dialogs
  -> never implements video-cut business logic
```

## 唯一业务内核

`host/` 是唯一业务能力内核，拥有：

- HTTP API
- 任务引擎
- 任务状态持久化
- 媒体探测和渲染
- provider registry
- artifact 管理
- capability discovery
- 配置、secret、日志和诊断

禁止：

- 在 `src-tauri/` 中实现剪辑、AI 分析、字幕、渲染、任务持久化。
- 在前端直接调用 FFmpeg、OpenAI-compatible endpoint、Whisper、文件系统业务路径。
- 为 server/container/kubernetes 重新实现一套 Node/Java/Python 后端。

## Canonical API

所有模式共用：

```text
/api/video-cut/v1
```

核心路由：

```http
GET  /api/video-cut/v1/health
GET  /api/video-cut/v1/capabilities
GET  /api/video-cut/v1/settings
PUT  /api/video-cut/v1/settings

POST /api/video-cut/v1/tasks
GET  /api/video-cut/v1/tasks
GET  /api/video-cut/v1/tasks/{taskId}
DELETE /api/video-cut/v1/tasks/{taskId}

POST /api/video-cut/v1/tasks/{taskId}/source
POST /api/video-cut/v1/tasks/{taskId}/analyze
GET  /api/video-cut/v1/tasks/{taskId}/plan
PUT  /api/video-cut/v1/tasks/{taskId}/plan
POST /api/video-cut/v1/tasks/{taskId}/render
POST /api/video-cut/v1/tasks/{taskId}/cancel

GET  /api/video-cut/v1/tasks/{taskId}/events
GET  /api/video-cut/v1/tasks/{taskId}/artifacts
GET  /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/download
GET  /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content
```

`/api/local/v1` 只允许作为 desktop-local 早期兼容 alias 存在于 route 层，不允许出现在 feature/core 包或正式契约中。

## Envelope

```ts
export interface VideoCutApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: VideoCutApiError;
}

export interface VideoCutApiError {
  code: string;
  message: string;
  actionHint?: string;
  logPath?: string;
  traceId?: string;
}
```

All public `/api/video-cut/v1` JSON request-body endpoints must use the Host JSON extraction boundary that maps malformed JSON, missing JSON content type, and schema deserialize failures into `ApiErrorEnvelope` with `REQUEST_JSON_INVALID`. Framework default `text/plain` extractor errors are not part of the public contract.

All public multipart upload endpoints must use the Host multipart extraction boundary that maps malformed multipart bodies, missing multipart boundaries, and extractor-level multipart failures into `ApiErrorEnvelope` with `MULTIPART_INVALID`. Upload business validation still uses dedicated domain codes such as `SOURCE_FILE_REQUIRED`, `SOURCE_FILE_TYPE_UNSUPPORTED`, and `SOURCE_FILE_TOO_LARGE`.

All public path-parameter endpoints must use the Host path extraction boundary that maps invalid percent-decoding, invalid UTF-8, missing path params, and path deserialization failures into `ApiErrorEnvelope` with `PATH_PARAMETER_INVALID`. Framework default `text/plain` path extractor errors are not part of the public contract.

All public query-parameter endpoints must use the Host query extraction boundary that maps query deserialization failures into `ApiErrorEnvelope` with `QUERY_PARAMETER_INVALID`. Endpoint-level domain validation still uses dedicated codes such as `SUBTITLE_FORMAT_INVALID`.

Unknown public `/api/video-cut/v1` routes must use the Host route fallback and return `ApiErrorEnvelope` with `ROUTE_NOT_FOUND`. Framework default empty or `text/plain` 404 bodies are not part of the public contract.

Known public API routes called with unsupported HTTP methods must use the Host method fallback and return `ApiErrorEnvelope` with `METHOD_NOT_ALLOWED`. Framework default empty or `text/plain` 405 bodies are not part of the public contract.

Frontend operation errors:

- UI components must consume a normalized `OperationError`, not transport-specific exceptions.
- `OperationError` may include title, safe message, code, HTTP status, traceId, and endpoint.
- The HTTP Host client must parse standard `{ ok: false, error }` envelopes consistently for JSON APIs, text artifact reads, and binary artifact reads. Artifact readers must throw `VideoCutHostApiError` for error envelopes instead of rendering the JSON as text or exposing it as a Blob.
- The HTTP Host client must reject 2xx JSON API responses that are not standard `{ ok: true, data }` envelopes with `RESPONSE_ENVELOPE_INVALID`, so malformed Host/proxy responses cannot enter UI state as `undefined` or untyped data.
- Results artifact preview, render-manifest loading, and artifact download failures must also render `OperationError` metadata inline. A private artifact content failure must preserve code, HTTP status, traceId, and endpoint for support diagnostics instead of degrading to a message-only warning.
- The frontend Host client port must not expose a reusable artifact content URL helper. Browser previews and downloads must call authenticated Blob/text reader methods so `Authorization` headers are preserved in server, web, container, and Kubernetes modes.
- Startup and task refresh must skip `GET /tasks/{taskId}/plan` for `draft` and `sourceReady` tasks. For post-analysis tasks, a missing split plan may be treated as optional only when the Host returns `TASK_PLAN_NOT_FOUND`, which means the task exists but no split plan has been generated yet. `TASK_NOT_FOUND` and all other plan loading failures must propagate into the standard `OperationError` flow.
- Local mock mode must throw the same standard host API error shape as HTTP mode for public Host client failures: safe message, code, HTTP status, traceId, and endpoint. The shared browser error class lives in the domain layer; HTTP and mock adapters both depend on that domain contract.
- Frontend code must not parse FFmpeg stderr, provider raw payloads, Authorization headers, API keys, or server-local media paths.
- Workbench actions must use one operation wrapper so local, server, container, and Kubernetes modes expose failures consistently.

## RuntimeDeploymentConfig

所有部署模式最终归一到同一个配置模型：

```ts
export interface RuntimeDeploymentConfig {
  deploymentMode:
    | 'desktop-local'
    | 'desktop-private'
    | 'web-private'
    | 'server-private'
    | 'container-private'
    | 'kubernetes-private';
  apiBaseUrl: string;
  publicBaseUrl?: string;
  authMode: 'none' | 'single-user-token' | 'reverse-proxy';
  corsAllowedOrigins: string[];
  storageProvider: 'filesystem' | 's3-compatible';
  secretProvider: 'local-secure-store' | 'env' | 'kubernetes-secret';
  workerConcurrency: number;
  maxUploadBytes: number;
}
```

前端只能消费 `apiBaseUrl` 和 capability，不允许根据 deployment mode 写业务分支。

`corsAllowedOrigins` maps to `security.corsAllowedOrigins` in settings and `SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS` in runtime env. Host CORS must use explicit HTTP(S) origins through an allowlist; wildcard `*` is forbidden in every deployment profile.

## Package Boundary

- `src/`：应用 shell，只装配路由和布局。
- `src-tauri/`：桌面 shell，只管窗口、host 进程、系统能力。
- `host/`：唯一业务内核。
- `packages/sdkwork-video-cut-types`：领域模型。
- `packages/sdkwork-video-cut-host-types`：HTTP transport、envelope、capability。
- `packages/sdkwork-video-cut-core`：host client、runtime baseUrl、platform facade。
- `packages/sdkwork-video-cut-feature`：视频剪辑工作台 UI。

## Contract Governance

- HTTP API 在 MVP 固定使用 OpenAPI 3.1 描述；OpenAPI 3.2 只有在生成、lint、contract test 工具链都支持后才能升级。
- DTO 使用 TypeScript/Rust parity test 校验。
- request/response/capability/config/task/plan/artifact 使用 JSON Schema。
- OpenAPI、schema、types 变更必须进入 `check:contracts`。
