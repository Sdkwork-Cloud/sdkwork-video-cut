# 08 Runtime Configuration And Capability Standard

日期：2026-04-26

## 目标

本标准定义运行时配置、模式 profile、能力发现、doctor、配置 schema 和启动校验。不同部署模式必须通过同一套 `RuntimeDeploymentConfig` 和 `CapabilityReport` 进入业务内核。

## 配置来源优先级

```text
code defaults
  < mode profile
  < config file
  < environment variables
  < command line flags
  < locked server policy
```

规则：

- 所有配置先进入 `RuntimeConfigPort`，再被 use case 消费。
- use case 不直接读取 env、文件、Secret、ConfigMap、Tauri state。
- 配置合并必须输出 `effective-config.redacted.json`，用于诊断。
- secret 字段在 effective config 中只保留来源和是否存在，不保留值。

## 技术选型

| 能力 | 推荐选型 | 边界 |
| --- | --- | --- |
| CLI 参数 | `clap` | 只在 binary 启动层使用，转换为 `RuntimeDeploymentConfig`。 |
| 分层配置 | `config` crate 或自研薄封装 | 必须封装在 `RuntimeConfigPort`，避免业务依赖具体 crate。 |
| Schema 生成 | `schemars` | 从 Rust config DTO 生成 JSON Schema。 |
| Schema 校验 | `jsonschema` | 校验 config、capability、manifest 和 LLM 输出。 |
| Secret 表达 | `SecretStorePort` + redacted DTO | 不把 secret 值放进普通 config。 |

## 环境变量命名

统一使用：

```text
SDKWORK_VIDEO_CUT_*
```

核心配置：

| Env | 类型 | Secret | 说明 |
| --- | --- | --- | --- |
| `SDKWORK_VIDEO_CUT_RUNTIME_MODE` | enum | no | `desktop-local`, `server-private`, `container-private`, `kubernetes-private`。 |
| `SDKWORK_VIDEO_CUT_BIND_HOST` | string | no | server 监听地址。 |
| `SDKWORK_VIDEO_CUT_PORT` | number | no | server 监听端口。 |
| `SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL` | url | no | 生成公开链接和 web runtime config。 |
| `SDKWORK_VIDEO_CUT_WORKSPACE_ROOT` | path | no | 项目和任务目录。 |
| `SDKWORK_VIDEO_CUT_ARTIFACT_ROOT` | path | no | artifact 目录。 |
| `SDKWORK_VIDEO_CUT_TEMP_ROOT` | path | no | 临时文件目录。 |
| `SDKWORK_VIDEO_CUT_WORKER_CONCURRENCY` | number | no | 分析/渲染并发。 |
| `SDKWORK_VIDEO_CUT_MAX_UPLOAD_BYTES` | number | no | 上传限制。 |
| `SDKWORK_VIDEO_CUT_AUTH_MODE` | enum | no | `none`, `single-user-token`, `reverse-proxy`。 |
| `SDKWORK_VIDEO_CUT_SERVER_TOKEN` | string | yes | server token。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_BASE_URL` | url | no | OpenAI-compatible base URL。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_API_KEY` | string | yes | OpenAI-compatible API key。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_CHAT_MODEL` | string | no | LLM model。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL` | string | no | STT model。 |
| `SDKWORK_VIDEO_CUT_STT_BASE_URL` | url | no | 独立 STT provider base URL；配置后不复用 LLM provider。 |
| `SDKWORK_VIDEO_CUT_STT_API_KEY` | string | yes | 独立 STT provider API key，写入 `settings://speech-to-text/api-key`。 |
| `SDKWORK_VIDEO_CUT_STT_TRANSCRIPTION_MODEL` | string | no | 独立 STT provider transcription model。 |
| `SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE` | enum | no | `openai-audio-transcriptions`、`volcengine-bigasr-flash`、`aliyun-qwen-asr`。 |
| `SDKWORK_VIDEO_CUT_STT_RESOURCE_ID` | string | no | 火山 BigASR Flash `X-Api-Resource-Id` 元数据，默认 `volc.bigasr.auc`。 |

## Mode Profile

Mode profile 只提供默认值，不改变业务语义。

```ts
export interface RuntimeModeProfile {
  deploymentMode: RuntimeDeploymentMode;
  bindHost: string;
  defaultPort?: number;
  allowRandomLoopbackPort: boolean;
  requireAuth: boolean;
  requireCorsOrigins: boolean;
  secretProvider: 'local-secure-store' | 'env' | 'kubernetes-secret';
  storageProvider: 'filesystem' | 's3-compatible';
  allowLocalFileDialog: boolean;
  allowLocalToolDiscovery: boolean;
}
```

## CapabilityReport

能力发现必须同时面向 UI、doctor、release smoke 和运维。

```ts
export interface CapabilityReport {
  reportVersion: 'video-cut.capability.v1';
  deploymentMode: RuntimeDeploymentMode;
  qualityTier: 'basic' | 'standard' | 'interview' | 'pro' | 'batch';
  health: 'ok' | 'degraded' | 'unavailable';
  media: MediaCapability;
  ai: AiCapability;
  storage: StorageCapability;
  security: SecurityCapability;
  deployment: DeploymentCapability;
  missing: CapabilityMissingItem[];
  warnings: CapabilityWarning[];
}
```

规则：

- capability 必须可序列化为 JSON。
- UI 只展示 capability，不自行探测本地环境。
- doctor 使用同一 `CapabilityReport`，加上更详细 diagnostics。
- capability 缺失必须给出 `reason` 和 `actionHint`。

## Fail Fast 与 Fail Soft

Fail fast：

- config schema 无效。
- workspace root 不可写。
- artifact root 不可写。
- server 模式绑定 `0.0.0.0` 但无 auth 且无 reverse proxy policy。
- OpenAI-compatible baseUrl 被 SSRF guard 拦截。

Fail soft：

- FFmpeg 缺失：媒体渲染不可用，但设置页可打开。
- OpenAI-compatible 不可用：智能分析不可用，但基础裁切/手动字幕可用。
- BGM/SFX 缺失：不阻塞主视频渲染。
- 字体缺失：fallback 并记录 warning。

## Deployment Doctor

doctor 必须支持：

```bash
pnpm deployment:doctor -- --json
pnpm deployment:doctor:desktop:local -- --json
pnpm deployment:doctor:server:private -- --json
```

输出：

```ts
export interface DeploymentDoctorReport {
  reportVersion: 'video-cut.doctor.v1';
  deploymentMode: RuntimeDeploymentMode;
  generatedAt: string;
  health: 'ok' | 'degraded' | 'unavailable';
  capability: CapabilityReport;
  checks: DeploymentDoctorCheck[];
  redactedConfig: RuntimeDeploymentConfig;
}
```

每个 check 必须有：

- `checkId`
- `status`
- `label`
- `actionHint`
- `details`

MVP 已落地 HTTP doctor：

```http
GET /api/video-cut/v1/doctor
```

当前必备检查项：

- `health`
- `workspaceWritable`
- `ffmpeg`
- `ffprobe`
- `providerPolicy`
- `settingsValidation`
- `redaction`

部署层 CLI 包装器：

```bash
node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local --json
```

CLI 输出版本为 `video-cut.deployment-doctor.cli.v1`，对外只依赖 `/api/video-cut/v1` 标准 HTTP contract，适用于 local、server、container 和 kubernetes smoke。

## DiagnosticBundle

诊断包导出必须由 host 生成，UI 不自行拼接本地环境信息。

```ts
export interface DiagnosticBundle {
  bundleVersion: 'video-cut.diagnostics-bundle.v1';
  generatedAt: string;
  deploymentMode: RuntimeDeploymentMode;
  includes: {
    sourceMedia: boolean;
    transcript: boolean;
  };
  supportRequest?: DiagnosticSupportBundleRequestEvidence;
  capability: CapabilityReport;
  doctor: DeploymentDoctorReport;
  redactedConfig: RuntimeDeploymentConfig;
  artifacts: DiagnosticBundleArtifact[];
}
```

标准端点：

```http
GET /api/video-cut/v1/diagnostics/bundle
POST /api/video-cut/v1/diagnostics/support-bundle
```

默认 `GET /diagnostics/bundle` 导出范围必须脱敏，不包含源视频、完整 transcript、API key、token 或 Authorization header，并且 `includes.sourceMedia=false`、`includes.transcript=false`。

`POST /diagnostics/support-bundle` 是唯一可请求敏感支持附件描述符的接口。请求必须使用 `DiagnosticSupportBundleRequest { taskId?, includeSourceMedia, includeTranscript, consentAccepted }`。当 `includeSourceMedia` 或 `includeTranscript` 为 true 时，`consentAccepted` 必须为 true，且必须指定 `taskId`。返回的 `DiagnosticBundleArtifact` 只能包含 workspace-relative `path` 和 host-relative `contentRef`，不得包含 server-local absolute path、源媒体 bytes 或 transcript 文本。

浏览器侧必须将该 contract 封装为 `DiagnosticBundleDownloadDescriptor`，而不是让页面组件直接拼 JSON 或拼文件名。该 descriptor 至少包含：

- `fileName`：`sdkwork-video-cut-diagnostics-{deploymentMode}-{generatedAt}.json`。
- `mediaType`：`application/vnd.sdkwork.video-cut.diagnostics+json`。
- `href`：浏览器可下载 data URL 或未来 server signed URL。
- `sizeBytes`：按 UTF-8 计算的下载体大小。
- `redaction`：脱敏兜底扫描结果；不安全时不得生成可下载链接。

## Runtime Secret Store Standard

Settings Center can submit provider API keys, but keys are write-only runtime input:

- plaintext keys are accepted only by `PUT /api/video-cut/v1/settings`;
- host extracts them into `SecretStorePort` under stable refs such as `settings://ai/api-key` and `settings://speech-to-text/api-key`;
- persisted `runtime/settings.json` stores only non-secret settings and `apiKeyConfigured` markers;
- responses from `GET /settings`, `/doctor`, `/diagnostics/bundle`, `/diagnostics/support-bundle`, and `/providers/openai-compatible/conformance` must not include `apiKey`, bearer tokens, Authorization headers, or secret values;
- `/doctor`, `/diagnostics/bundle`, and `/diagnostics/support-bundle` must also redact server-local absolute `workspaceRoot`, `artifactRoot`, `tempRoot`, `details.path`, artifact `path`, and artifact `contentRef` values; `GET /settings` remains the editable runtime settings endpoint and may return configured path values to authorized local/server operators;
- local MVP uses an in-memory runtime secret store; durable OS/keychain or K8s secret adapters must implement the same port before production multi-user deployment.

## Private Mode Auth Runtime Standard

The Host runtime treats private deployment auth as startup-critical configuration.

- `SDKWORK_VIDEO_CUT_RUNTIME_MODE`, `SDKWORK_VIDEO_CUT_BIND_HOST`, `SDKWORK_VIDEO_CUT_PORT`, `SDKWORK_VIDEO_CUT_WORKSPACE_ROOT`, `SDKWORK_VIDEO_CUT_AUTH_MODE`, and `SDKWORK_VIDEO_CUT_SERVER_TOKEN` are the canonical runtime environment variables.
- Legacy `VIDEO_CUT_*` environment variables are forbidden. Host startup must fail fast and operators must use `SDKWORK_VIDEO_CUT_*` only.
- Any non-`desktop-local` runtime binding `0.0.0.0` must set `SDKWORK_VIDEO_CUT_AUTH_MODE=single-user-token` or `SDKWORK_VIDEO_CUT_AUTH_MODE=reverse-proxy`.
- `single-user-token` mode must provide `SDKWORK_VIDEO_CUT_SERVER_TOKEN`; private API calls require `Authorization: Bearer <token>`.
- `/api/video-cut/v1/health` remains unauthenticated for process managers, Docker healthcheck, and Kubernetes probes.
- `reverse-proxy` mode means auth is enforced before traffic reaches the Host. Docker and Kubernetes manifests use this mode by default because the web runtime proxies the canonical `/api/video-cut/v1` route.
- Node automation clients such as `scripts/run-video-cut-deployment-doctor.mjs` read server-token auth only from `SDKWORK_VIDEO_CUT_SERVER_TOKEN` or explicit CLI arguments. The token is never appended to URLs and is not included in doctor or diagnostics reports.
- Browser-delivered code must not read Host base URLs, deployment modes, or bearer tokens from `VITE_*` build-time environment variables. The static web bundle defaults to same-origin `/api/video-cut/v1`; cross-origin automation may inject `window.__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__ = { hostMode, hostBaseUrl, authToken }` before page code runs. Production web deployments should prefer reverse-proxy auth or short-lived runtime credentials outside the static Vite bundle.
- Browser-facing Node child processes must launch with a sanitized environment that strips every `VITE_*`, `SDKWORK_VIDEO_CUT_*`, and legacy `VIDEO_CUT_*` key. Runtime Host configuration belongs to the Host process, same-origin proxy, or explicit `__SDKWORK_VIDEO_CUT_RUNTIME_CONFIG__` injection, never inherited ambient process env.

## 配置 Schema 治理

- `runtime-config.schema.json` 必须进入 `host/resources/schemas`。
- `.env.example`、Helm values、Docker Compose env、desktop settings UI 必须与 schema 保持一致。
- 每次新增配置必须声明：默认值、适用部署模式、是否 secret、是否可热更新、是否进入 release manifest。
- 配置文档由 schema 生成或通过 parity test 校验。
