# sdkwork-video-cut Product Requirements Document

日期：2026-04-26
状态：draft

## 1. 背景

`sdkwork-video-cut` 是一个面向口播、访谈和长访谈拆条的 AI 视频剪辑应用。它需要把原始视频转成可发布的竖版短视频，支持自动转写、语义分析、切点推荐、字幕生成、封面生成、批量渲染和人工审阅。

产品必须单机独立运行，支持未来 server、container、kubernetes 部署，但不依赖 `spring-ai-plus-ai-api`、`spring-ai-plus-app-api`、Ollama 或 MagicCut 业务代码。模型能力统一使用 OpenAI-compatible 接口标准。

## 2. 产品目标

- 让用户导入单人口播、访谈、长访谈视频后，能在一个工作台中完成分析、审阅、渲染、导出。
- 支持类型 1 单人口播、类型 2 访谈 1 问 1 答切分、类型 3 长访谈批量拆条。
- 提供完整设置中心，允许用户配置 LLM、语音转文字、字幕样式、媒体工具、输出、存储、安全和诊断。
- 保持 local-first：MVP 不依赖远程业务 API，不默认引入数据库，不把媒体处理放到前端。
- 对每个自动化结果提供可解释依据：字幕轨道、静音轨道、VAD 轨道、语义轨道、切点评分、渲染日志。

## 3. 非目标

- 不做通用 NLE 剪辑软件。
- 不做营销 landing page。
- 不在前端直接调用 FFmpeg、OpenAI-compatible endpoint、Whisper 或本地业务路径。
- 不把 API key 存入 localStorage、task、artifact、prompt、log。
- MVP 不提供多人协作、云素材库、在线支付、发布平台账号托管。
- MVP 不引入数据库 migration；文件系统 manifest 是 source of truth。

## 4. 用户角色

| 角色 | 目标 | 关键需求 |
| --- | --- | --- |
| 内容运营 | 快速从长视频中批量产出短视频 | 批量拆条、片段审阅、字幕和封面统一风格、导出清单。 |
| 剪辑助理 | 减少手工剪辑时间 | 自动识别停顿、废话、问答边界、生成可修订计划。 |
| 主讲人/创作者 | 快速得到可发布视频 | 简单导入、默认模板、少配置、结果可预览。 |
| 私有部署管理员 | 管理模型、工具和运行环境 | 设置中心、能力检测、doctor、日志、secret 管理。 |

## 5. 视频类型需求

### 5.1 类型 1 单人口播

输入：一段单人上半身口播视频。

输出：

- 9:16。
- 默认生产 preset 为 1080x1920；本地预览和自动化测试可使用任意正整数 9:16 `outputSpec`（如 360x640），但必须保持 30fps MP4。
- 30fps。
- MP4。
- 时长不超过 90 秒。
- 聚焦上半身，占画面约 2/3。
- 删除停顿、咳嗽、重复。
- 语音增强，降低混响。
- 简体中文逐句字幕，默认极宋风格、阴影、黄色重点高亮。
- BGM 20% 音量，提示音可选，自动封面。

### 5.2 类型 2 访谈

输入：主持人与嘉宾问答视频。

输出：

- 按 1 问 1 答生成候选短视频。
- 删除无效内容、停顿、广告和重复。
- 支持批量生成。
- 画面稳定和轻微缩放。
- 输出规则同类型 1。

### 5.3 类型 3 长访谈拆条

输入：长访谈或长直播回放。

输出：

- 提取多个问答片段。
- 单条 60-180 秒。
- 去广告、去废话、去无效片段。
- 批量生成矩阵短视频。
- 支持按评分、主题、时长、人物、关键词筛选。

## 6. 信息架构

```text
App Shell
  Home / Projects
  Video Cut Workbench
  Batch Queue
  Render Results
  Settings Center
  Diagnostics
```

## 7. 核心页面

### 7.1 Home / Projects

功能：

- 展示最近项目、最近任务、失败任务、待审阅任务。
- 支持新建项目、打开项目目录、导入视频。
- 显示 capability 摘要：AI、STT、FFmpeg、字幕字体、存储是否可用。
- 显示全局任务队列状态。

验收：

- 无模型配置时仍可进入应用和设置中心。
- FFmpeg 不可用时必须显示可修复提示。
- 最近项目不可访问时显示路径错误和移除入口。

### 7.2 Video Cut Workbench

布局：

- 左侧：任务/片段列表、筛选、批量选择。
- 中间：HTML5 video 预览、输出比例框、字幕预览、时间轴概览。
- 右侧：任务参数、切点详情、字幕样式、封面、渲染参数、诊断。
- 底部：分析进度、渲染进度、事件流、错误和日志入口。

功能：

- 导入视频。
- 选择剪辑类型：单人口播、访谈、长访谈。
- 启动分析。
- 查看 transcript、semantic analysis、cut decision。
- 调整片段起止点。
- 修改标题、封面文案、高亮词、字幕文本。
- 单条渲染或批量渲染。
- 查看 artifact、打开输出目录、下载或复制路径。

验收：

- 任何 AI 不可用时，基础导入、预览、手动片段、手动字幕仍可用。
- 分析和渲染必须可取消。
- 刷新或重启后任务状态可恢复，running 状态标记为 interrupted。
- 渲染 adapter 不读取 UI 状态，只消费 `VideoSplitPlan` 和 `RenderRequest`。

### 7.3 Batch Queue

## 2026-04-27 Source Upload Acceptance Addendum

- Workbench local import must restrict the browser file chooser to supported video extensions: `mp4`, `mov`, `m4v`, `mkv`, `webm`, `avi`, `mpeg`, and `mpg`.
- `POST /api/video-cut/v1/tasks/{taskId}/source/file` and `POST /api/video-cut/v1/tasks/{taskId}/source` must share the same Host-side source media type policy.
- Explicit source content types must be `video/*`, `application/x-matroska`, or `application/octet-stream`; explicit non-video types such as `text/plain`, `image/*`, or `application/pdf` must fail.
- Unsupported source media must return the standard error envelope with `SOURCE_FILE_TYPE_UNSUPPORTED` before replacing the current source artifact or task source metadata.

功能：

- 展示等待中、分析中、待审阅、渲染中、成功、失败、取消任务。
- 支持暂停新任务、取消任务、重试失败任务。
- 支持显式选择任务，切换 Workbench 当前上下文。
- 支持删除任务，并同步清理当前 UI 中的 artifacts、events、split plan 选择状态。
- 支持按项目、类型、状态、错误码筛选。
- 支持批量渲染和批量导出 manifest。

验收：

- 队列并发来自 `RuntimeConfigPort`，UI 不自行计算 worker 并发。
- 重试必须生成新的 stage attempt 或 render attempt，不覆盖旧产物。
- 队列每行必须提供 Select、Cancel、Delete 操作；操作失败进入标准错误面板。

### 7.4 Render Results

功能：

- 展示 output.mp4、cover.png、subtitles.ass、render.log。
- 展示 render.json 中的 `sourceRange`、`outputSpec`、`renderGraph`、`subtitleBurnIn`、`subtitleCueCount`。
- 展示输出参数：分辨率、帧率、码率、音频、字幕字体、BGM/SFX。
- 支持打开输出目录、下载、复制文件路径、重新渲染。
- 支持失败诊断：错误码、日志路径、FFmpeg stderr 摘要、traceId。
- Workbench、Settings Center、Diagnostics 操作失败时必须显示标准错误面板：operation title、safe message、error code、HTTP status、traceId、endpoint。

验收：

- render log 必须脱敏。
- 文件缺失或 hash 不一致时必须显示 artifact integrity warning。
- 浏览器只能通过 artifact content endpoint 读取 `render.json`、字幕、日志和视频预览，不允许依赖 server-local path。私有部署下 UI 必须通过带鉴权 Host client 获取二进制 artifact，并使用短生命周期 `blob:` URL 进行预览和下载，不能把需要鉴权的 API URL 直接放到媒体元素或普通链接上。
- HTTP Host client must normalize standard error envelopes consistently for JSON APIs, text artifact reads, and binary artifact reads. Any `{ ok: false, error }` envelope must become `VideoCutHostApiError` with code, HTTP status, traceId, and endpoint instead of being rendered as text or downloaded as a Blob.
- HTTP Host client must reject 2xx JSON API responses that are not standard `{ ok: true, data }` envelopes with `RESPONSE_ENVELOPE_INVALID`, instead of returning `undefined` or untyped payloads.
- Results page must render artifact preview, manifest, and download failures through the normalized `OperationError` metadata model. Inline warnings must preserve code, HTTP status, traceId, and endpoint so local/server support diagnostics stay consistent without exposing server-local paths or secrets.
- Direct artifact content URL helpers are forbidden in the frontend Host client port. UI code must use authenticated Blob/text artifact reader methods and then create short-lived browser `blob:` URLs for media preview and downloads.
- Task plan loading may only suppress `TASK_PLAN_NOT_FOUND`, which means the task exists but analysis has not generated a split plan. Startup and task refresh must not request a split plan for `draft` or `sourceReady` tasks because these states are known to be pre-analysis. `TASK_NOT_FOUND` and other plan loading failures, including 401/403/500 Host errors, must surface through the standard `OperationError` UI with code, HTTP status, traceId, and endpoint.
- Local mock mode must throw the same standard host API error shape as HTTP mode for user-visible failures. Mock failures such as missing tasks, unsupported source media, missing source before analysis, missing artifacts, and diagnostics consent errors must include safe message, code, HTTP status, traceId, and endpoint.
- UI 不解析 FFmpeg stderr 或 provider 原始响应；失败细节只来自标准 error envelope、event、artifact manifest 和脱敏 render log。

### 7.5 Diagnostics

功能：

- 展示 `CapabilityReport`。
- 展示 `DeploymentDoctorReport`。
- 展示脱敏 `effective-config.redacted.json`。
- 支持测试 FFmpeg、ffprobe、OpenAI-compatible LLM、OpenAI-compatible STT、字体、BGM/SFX、workspace 写入。
- 支持导出诊断包。
- 支持在用户本次显式同意后导出诊断支持包附件描述符。

验收：

- 默认诊断包不能包含 API key、token、视频源文件、完整转写文本。
- 源视频或完整转写只能通过 `POST /api/video-cut/v1/diagnostics/support-bundle` 在用户本次显式同意后导出为 Host-relative artifact descriptor，不得导出 server-local 绝对路径。
- 导出后必须提供可下载 JSON 文件，文件名包含部署模式和生成时间，MIME 为 `application/vnd.sdkwork.video-cut.diagnostics+json`。
- UI 只能下载 host 返回的标准 `DiagnosticBundle`，不得自行拼接本地环境信息；下载前必须执行前端脱敏兜底扫描并显示 `redaction verified` 证据。

## 8. 设置中心

设置中心是产品必需能力，不是后期附属页面。它必须覆盖模型、语音、字幕、媒体、输出、存储、安全、部署和诊断。

### 8.1 设置中心原则

- 所有设置必须来自 host 的 config schema。
- UI 通过 `GET /api/video-cut/v1/settings` 读取，通过 `PUT /api/video-cut/v1/settings` 保存。
- UI 通过 `GET /api/video-cut/v1/capabilities` 展示能力，不自行探测本地工具。
- Secret 字段只显示来源、是否已配置、最后验证时间，不显示明文。
- 保存设置前必须本地 schema 校验；保存后由 host 返回有效配置或错误。
- 每个设置项必须有适用部署模式、是否 secret、是否需要重启、是否影响已有任务。

### 8.2 设置导航

```text
Settings Center
  Overview
  AI Providers
  Speech To Text
  Subtitle And Caption
  Media Tools
  Output Presets
  Assets
  Storage
  Runtime
  Security
  Diagnostics
  About
```

### 8.3 Overview

展示：

- 当前部署模式。
- AI readiness。
- STT readiness。
- FFmpeg readiness。
- 工作目录状态。
- 最近一次 doctor 结果。
- 需要用户处理的阻断项。

操作：

- 一键运行 doctor。
- 跳转到对应设置分组。
- 导出脱敏诊断报告。

### 8.4 AI Providers

字段：

| 字段 | 类型 | Secret | 说明 |
| --- | --- | --- | --- |
| provider enabled | boolean | no | 是否启用智能分析。 |
| base URL | url | no | OpenAI-compatible base URL。 |
| API key | secret | yes | 写入 `SecretStorePort`。 |
| chat model | string/select | no | `/v1/chat/completions` 模型。 |
| structured output mode | enum | no | JSON Schema、JSON object fallback。 |
| temperature | number | no | 默认低温，保证稳定。 |
| timeout seconds | number | no | provider 调用超时。 |
| retry count | number | no | 可重试错误次数。 |
| proxy | url optional | no/secret by mode | 私有网络代理。 |

操作：

- Test connection。
- Test structured output。
- Fetch model list，如果 provider 支持。
- Reset to safe defaults。

验收：

- 不支持 JSON Schema structured output 时必须显示降级策略。
- 测试连接只记录 endpoint host、model、耗时、traceId，不记录 key。
- 配置无效时分析按钮进入 disabled + action hint，不阻塞基础手工剪辑。

### 8.5 Speech To Text

字段：

| 字段 | 类型 | Secret | 说明 |
| --- | --- | --- | --- |
| STT provider enabled | boolean | no | 是否启用转写。 |
| provider profile | enum | no | `openai-audio-transcriptions`、`volcengine-bigasr-flash`、`aliyun-qwen-asr` 三种标准桥接 profile。 |
| base URL | url | no | OpenAI-compatible base URL，可复用 AI provider 或单独配置。 |
| API key | secret | yes | 写入 `SecretStorePort`。 |
| transcription model | string/select | no | `/v1/audio/transcriptions` 模型。 |
| resource ID | string | no | 火山 BigASR Flash 的 `X-Api-Resource-Id` 元数据，默认 `volc.bigasr.auc`；OpenAI/阿里 profile 忽略。 |
| language hint | enum/string | no | 默认 `zh`。 |
| timestamp granularity | enum | no | segment、word，按 capability 展示。 |
| diarization | boolean | no | 仅 provider 支持时可启用。 |
| local whisper fallback | boolean | no | 可选 fallback，不作为语义分析 provider。 |

操作：

- Test transcription with sample audio。
- Validate word timestamp capability。
- Validate diarization capability。
- Validate provider bridge conformance。

验收：

- `speechToText.providerProfile` 必须在 Settings Center、OpenAPI、Host settings validation、provider conformance、deployment env 中保持一致。
- 火山 profile 缺少 `resourceId` 时必须返回标准 validation error，不得保存无效配置。
- 阿里 Qwen-ASR 和火山 BigASR Flash 只能通过 Host bridge 调用，前端不得直接调用厂商 API。
- 词级时间戳、说话人分离必须来自 capability，不是默认承诺。
- STT 不可用时允许导入手工 transcript。

### 8.6 Subtitle And Caption

字段：

- 字幕语言：简体中文。
- 字幕格式：内部 `SubtitleDocument`，导出 ASS/SRT/VTT。
- 烧录格式：ASS + libass/FFmpeg subtitles filter。
- 默认字体：极宋；缺失时 fallback 并 warning。
- 字号、行高、最大行数。
- 位置：底部安全区、居中、左右边距。
- 阴影：默认 95% / blur 9%。
- 高亮色：黄色，支持可访问对比校验。
- 关键词高亮策略：LLM、规则、人工。
- 标点和断句策略。

操作：

- Preview subtitle style。
- Validate font availability。
- Import/Export subtitle。
- Reset to publish preset。

验收：

- 字幕 cue 不重叠。
- 字幕不遮挡主体脸部关键区域。
- 缺字体时必须显示 warning 和 fallback 字体。

### 8.7 Media Tools

字段：

- FFmpeg path。
- ffprobe path。
- libass availability。
- ONNX Runtime availability。
- Silero VAD model path。
- temp root。
- worker concurrency。
- max upload bytes。
- hardware acceleration profile，MVP 可 disabled。

操作：

- Auto discover tools。
- Validate FFmpeg。
- Validate ffprobe。
- Validate VAD model。
- Open tool logs。

验收：

- UI 只触发 host tool locator，不自行探测系统路径。
- 工具不可用时必须区分 blocking 和 non-blocking。

### 8.8 Output Presets

字段：

- 输出比例：MVP 固定 9:16。
- 分辨率：默认生产 preset 为 1080x1920；允许正整数 9:16 预览 preset（如 360x640），由 `VideoSplitPlan.outputSpec` 显式记录。
- 帧率：30fps。
- 格式：MP4。
- codec：libx264/aac。
- 最大时长：单人口播 90 秒，长访谈 60-180 秒。
- BGM 音量：默认 20%。
- SFX：提示音开关和音量。
- cover template。

验收：

- 用户不能输入任意 FFmpeg filter 字符串。
- preset 变更只影响新 render request，不回写旧 render artifact。

Implementation acceptance:
- Successful render manifests must include `renderGraph.audioFilterPreset=voice-basic-loudnorm-afftdn.v1`.
- `voiceEnhancement.status=applied` must be backed by actual FFmpeg `loudnorm` and `afftdn` filters in the render command.
- BGM must keep the 20% target volume in the manifest and must be mixed through FFmpeg when a supported file exists under `settings.assets.bgm`. It must be reported as `mixed=true` only when an asset is actually selected and mixed; otherwise it must be `status=not-configured` or `status=disabled`.
- SFX must be mixed through FFmpeg when a supported file exists under `settings.assets.sfx`. It must be reported as `mixed=true` only when an asset is actually selected and mixed; otherwise it must be `status=not-configured` or `status=disabled`.
- Mixed BGM/SFX manifest entries must contain sanitized `assets://...` paths, `assetId`, SHA-256, license, source, and version, and must not contain server-local absolute paths.
- Split plans must carry `renderPreferences.audio` for user-level BGM/SFX decisions. Preferences support `auto`, `asset`, and `disabled`; `asset` mode must use the `assetId` and `assets://...` path returned by `GET /api/video-cut/v1/assets/catalog`.

### 8.9 Assets

字段：

- 字体目录。
- BGM 目录。
- SFX 目录。
- 封面模板目录。
- 模型 asset 目录。

验收：

- asset 必须进入 manifest，记录 license、hash、版本和来源。
- 缺失 asset 必须 fail soft，除非该任务显式依赖。
- BGM/SFX 目录可提供 `asset-manifest.json`，schemaId 固定为 `video-cut.asset-pack-manifest.v1`，每个素材条目必须包含 `path`、`license`、`source`、`version`。
- 缺失素材元数据时允许继续使用用户显式配置目录中的音频文件，但 render manifest 必须记录 `unverified-user-provided` 许可标记、`configured-asset-directory` 来源、确定性的 sha256 版本和 warning。
- Settings Center 必须通过 `GET /api/video-cut/v1/assets/catalog` 展示标准 `AssetCatalog`，包含 fonts、BGM、SFX、coverTemplates 四类 slot、支持扩展名、资产数量、license/source/version 摘要和 warning。
- `AssetCatalog` 只能返回 `assets://...` 逻辑引用和 `<server-local-path>` 脱敏占位，不能向浏览器泄漏 server-local 绝对路径。
- Workbench 必须通过 `VideoSplitPlan.renderPreferences` 保存用户选择的 BGM/SFX；渲染阶段只能解析 `assets://...` 引用，不允许前端或计划文件传入 server-local 物理路径。

### 8.10 Storage

字段：

- workspace root。
- artifact root。
- temp root。
- retention days。
- cleanup policy。
- S3-compatible profile，未来阶段启用。

验收：

- 路径必须通过 workspace root guard。
- 改变根目录前必须提示影响范围。
- server/k8s 模式不显示本地文件选择器，只显示配置来源。

### 8.11 Runtime

字段：

- deployment mode。
- bind host。
- port。
- public base URL。
- auth mode。
- `security.corsAllowedOrigins`: local/server/container/Kubernetes browser clients must use an explicit HTTP(S) CORS origin allowlist; wildcard `*` is forbidden and runtime overrides use `SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS`.
- queue/backpressure。
- graceful shutdown。

验收：

- server 绑定 `0.0.0.0` 且无 auth 时必须 fail fast。
- UI 显示 locked server policy 时，不允许编辑受控字段。

### 8.12 Security

字段：

- secret provider。
- server token configured status。
- redaction policy。
- diagnostics export scope。
- data retention。

验收：

- secret 不进入普通 config、localStorage、log、task、artifact。
- 诊断导出默认脱敏。

## 9. API 依赖

MVP UI 只依赖：

```http
GET  /api/video-cut/v1/health
GET  /api/video-cut/v1/capabilities
GET  /api/video-cut/v1/doctor
GET  /api/video-cut/v1/diagnostics/bundle
POST /api/video-cut/v1/diagnostics/support-bundle
POST /api/video-cut/v1/providers/openai-compatible/conformance
GET  /api/video-cut/v1/settings
PUT  /api/video-cut/v1/settings
GET  /api/video-cut/v1/assets/catalog
POST /api/video-cut/v1/tasks
GET  /api/video-cut/v1/tasks
GET  /api/video-cut/v1/tasks/{taskId}
DELETE /api/video-cut/v1/tasks/{taskId}
POST /api/video-cut/v1/tasks/{taskId}/source
POST /api/video-cut/v1/tasks/{taskId}/source/file
POST /api/video-cut/v1/tasks/{taskId}/analyze
GET  /api/video-cut/v1/tasks/{taskId}/plan
PUT  /api/video-cut/v1/tasks/{taskId}/plan
PUT  /api/video-cut/v1/tasks/{taskId}/transcript
PUT  /api/video-cut/v1/tasks/{taskId}/subtitles/import
GET  /api/video-cut/v1/tasks/{taskId}/subtitles/export
POST /api/video-cut/v1/tasks/{taskId}/render
POST /api/video-cut/v1/tasks/{taskId}/render/batch
POST /api/video-cut/v1/tasks/{taskId}/cancel
GET  /api/video-cut/v1/tasks/{taskId}/events
GET  /api/video-cut/v1/tasks/{taskId}/artifacts
GET  /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/download
GET  /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content
```

All JSON request-body endpoints must return the standard `ApiErrorEnvelope` with `REQUEST_JSON_INVALID` when the body is malformed JSON or cannot be deserialized into the endpoint request schema. The Host must not leak Axum default `text/plain` extractor errors to the browser.

All multipart upload endpoints must return the standard `ApiErrorEnvelope` with `MULTIPART_INVALID` when the multipart body is malformed or the multipart boundary is missing/invalid. Upload business validation must keep domain-specific codes such as `SOURCE_FILE_REQUIRED`, `SOURCE_FILE_TYPE_UNSUPPORTED`, and `SOURCE_FILE_TOO_LARGE`.

All path-parameter endpoints must return the standard `ApiErrorEnvelope` with `PATH_PARAMETER_INVALID` when a path parameter cannot be decoded or deserialized. The Host must not leak framework default `text/plain` path extractor errors to the browser.

All query-parameter endpoints must return the standard `ApiErrorEnvelope` with `QUERY_PARAMETER_INVALID` when query parameters cannot be deserialized. Endpoint-level domain validation must keep domain-specific codes such as `SUBTITLE_FORMAT_INVALID`.

Unknown public API routes under `/api/video-cut/v1` must return the standard `ApiErrorEnvelope` with `ROUTE_NOT_FOUND`. The Host must not leak framework default empty 404 bodies or `text/plain` route errors to the browser.

Known public API routes called with unsupported HTTP methods must return the standard `ApiErrorEnvelope` with `METHOD_NOT_ALLOWED`. The Host must not leak framework default empty 405 bodies or `text/plain` method errors to the browser.

Task creation and source import are separate user-visible operations:

- `POST /api/video-cut/v1/tasks` creates a `draft` task from `title` and `type` only.
- `CreateTaskInput` must not contain `sourceName`; source files enter through `POST /source/file` or `POST /source`.
- The product must not show a task as `sourceReady` until the source upload or metadata attachment succeeds.
- A rejected source upload must leave `sourceName` empty and must not create or replace a `kind=source` artifact.
- `POST /analyze` must return `SOURCE_FILE_REQUIRED` for a draft/no-source task, and the UI Analyze action must remain disabled until a source exists.
- The sample import action must use the same upload boundary as user-selected files; it must not rely on metadata-only source placeholders.
- Uploaded source, analysis, audio, plan, and render artifact integrity fields must use real `sizeBytes` and content SHA-256 values from the persisted bytes.
- Saving a split-plan edit must refresh the current plan artifact metadata so the artifact manifest and `plan/plan.json` cannot drift.
- Saving a split-plan edit must validate the standard `VideoSplitPlan` contract before mutation. Invalid schema/track/segment/range payloads return `PLAN_INVALID`; body `taskId` mismatches return `PLAN_TASK_ID_MISMATCH`; neither case may replace the current plan document or artifact manifest.

## 10. 状态模型

任务状态沿用架构标准：

```text
draft -> sourceReady -> analyzing -> planReady -> rendering -> succeeded
任意执行状态 -> failed
任意执行状态 -> cancelled
running on crash -> interrupted
```

UI 必须为每个状态提供：

- 主操作。
- 次操作。
- 禁用原因。
- 恢复或重试入口。
- 错误详情和 action hint。

## 11. 权限和部署模式

| 模式 | 设置能力 |
| --- | --- |
| desktop-local | 可编辑本地路径、secret、工具发现、模型配置。 |
| desktop-private | 可编辑用户级设置；server policy 锁定项只读。 |
| web-private | 不显示本地文件选择器；路径和 secret 通常只读或由管理员配置。 |
| server-private | 受 auth/CORS/server token 限制；支持管理员设置。 |
| container-private | 显示 env/secret file 来源，不直接编辑容器文件系统。 |
| kubernetes-private | 显示 ConfigMap/Secret/Helm values 来源，普通 UI 不直接写 K8s Secret。 |

## 12. 质量指标

- Desktop P95 5 秒内 UI 可见，P95 10 秒内 host ready。
- 设置中心无 AI/FFmpeg 时仍可打开。
- 保存设置 P95 1 秒内返回本地 schema 校验结果。
- provider test P95 30 秒内超时并返回 action hint。
- 长任务进度事件延迟 P95 小于 2 秒。

## 13. MVP 范围

必须包含：

- Home / Projects。
- Video Cut Workbench。
- Settings Center。
- Diagnostics。
- 类型 1/2/3 的任务创建、分析、计划审阅、渲染、artifact 查看。
- OpenAI-compatible LLM 配置。
- OpenAI-compatible / 火山 BigASR Flash / 阿里 Qwen-ASR STT bridge 配置。
- 字幕样式配置。
- FFmpeg/ffprobe 工具配置和检测。
- workspace/artifact/temp 路径配置。
- capability 和 doctor 展示。

可延后：

- 多用户 IAM。
- PostgreSQL/S3/K8s 多副本。
- WhisperX/pyannote/MediaPipe/PySceneDetect 的 UI 深度配置。
- 完整 NLE 时间线。
- 发布平台账号管理。

## 14. 验收清单

以下条目必须通过 `docs/product/feature-readiness.yaml`、`pnpm check:feature-readiness -- --json`、`pnpm workflow:smoke:server:managed -- --json` 和 `pnpm workflow:smoke:ui:managed -- --json` 持续验证。

- [x] 用户无需配置模型也能打开应用和设置中心。
- [x] 用户能配置 OpenAI-compatible LLM 并测试结构化输出。
- [x] 用户能配置 OpenAI-compatible、火山 BigASR Flash 或阿里 Qwen-ASR STT profile，并通过 Host conformance 测试转写桥接能力。
- [x] 用户能配置字幕字体、阴影、高亮、位置并预览。
- [x] 用户能运行 doctor 并看到清晰 action hint。
- [x] 用户能导入类型 1 视频并得到可发布 MP4。
- [x] 用户能导入访谈视频并生成 1 问 1 答候选片段。
- [x] 用户能导入长访谈并生成 60-180 秒片段列表。
- [x] 用户能审阅和修改 split plan。
- [x] 用户能取消、重试、重新渲染任务。
- [x] 多任务导入后，用户必须能显式选择当前任务；Workbench、Queue、Results 不得隐式混用不同任务的 artifacts、events 或 split plan。
- [x] 所有 secret 均不出现在 localStorage、log、task、artifact、diagnostic export 默认内容中。
- [x] Diagnostics 页面和 Settings Center 都能导出同一份脱敏诊断 JSON 下载文件，并展示脱敏校验证据。
- [x] 设置 UI 与 runtime config schema 保持一致。
## 2026-04-27 Delivery Package Acceptance Addendum

- Render delivery package includes `output.mp4`, `subtitles.ass`, `cover.png`, `render.json`, and `render.log`.
- Browser preview and download use `/api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content`; UI must not depend on server-local file paths. The Host content endpoint must support single byte range requests (`206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`) so rendered video playback can buffer and seek reliably in local, server, container, and Kubernetes deployments. Artifact content responses must also include `Cache-Control: private, no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`.
- `output.mp4` burns `subtitles.ass` through FFmpeg subtitles/libass. If transcript is unavailable, subtitle output remains a valid ASS artifact with diagnostic comments and no fabricated dialogue.
- `render.json` records artifact ids, render graph preset, source range, output spec, subtitle burn-in status, and subtitle cue count.

## 2026-04-27 Split Plan Review Acceptance Addendum

- Workbench must load the generated split plan after analysis.
- Workbench must let users edit the first segment `sourceRange.startMs` and `sourceRange.endMs` through standard form controls.
- Saving a manual edit must call the standard `PUT /api/video-cut/v1/tasks/{taskId}/plan` contract, increment `planRevision`, update `outputRange`, and append `manual-override` to decision reasons.
- Render must consume the persisted plan and must not depend on transient UI state.

## 2026-04-27 Manual Transcript Acceptance Addendum

- When STT is unavailable, users must still be able to import manual transcript text for a selected segment range.
- Manual transcript import must use `PUT /api/video-cut/v1/tasks/{taskId}/transcript`.
- The Host must convert manual input into the standard `TranscriptDocument` schema and replace the current transcript artifact.
- Rendered subtitles must come from the persisted transcript artifact, not from transient UI text state.
- Invalid transcript input, including empty text, non-positive ranges, or overlapping ranges, must fail with the standard error envelope.

## 2026-04-27 Startup Runtime Recovery Acceptance Addendum

- Startup runtime loading must fetch capability, doctor, settings, task list, selected task artifacts, events, and split plan through the `VideoCutHostClient` port.
- If startup loading fails, the UI must show the standard operation error panel with title `Load runtime state failed`.
- The startup error panel must include safe message, error code, HTTP status, trace id, endpoint, and a `Reload runtime state` recovery action.
- A successful reload must refresh the runtime state and remove the error panel without a full browser refresh.

## 2026-04-27 Queue Retry Acceptance Addendum

- Queue rows must provide a `Retry task {sourceName}` action for `failed` and `interrupted` tasks.
- Retry must run through the same `VideoCutHostClient` boundary as manual Workbench operations.
- Render-stage failures retry render; other failed stages retry analysis.
- Retry failures must use the standard operation error panel with title `Retry task failed`.

## 2026-04-27 Task Event Recovery Hint Acceptance Addendum

- Host failure events must expose safe recovery guidance through `VideoCutProgressEvent.metadata.recoveryHint`.
- `metadata.recoveryHint` must include `code`, `action`, `label`, `message`, `retryable`, and optional `targetStage`.
- Recovery hint `message` and `label` must not contain API keys, bearer tokens, Authorization headers, provider raw payloads, FFmpeg raw stderr, or server-local absolute paths.
- Render failures that create a redacted `render.log` artifact must publish recovery hint code `RENDER_FAILED_REVIEW_LOG` with action `retry-render`.
- Workbench event stream and Queue selected-task rows must display the latest task recovery hint from Host event metadata.
- UI retry behavior must remain behind the `VideoCutHostClient` port; UI components may display event recovery hints but must not infer provider, FFmpeg, or filesystem internals directly.

## 2026-04-27 Diagnostics Support Bundle Consent Addendum

- Default `GET /api/video-cut/v1/diagnostics/bundle` remains redacted and must always return `includes.sourceMedia=false` and `includes.transcript=false`.
- `POST /api/video-cut/v1/diagnostics/support-bundle` is the only API that can request source media or transcript support attachment descriptors.
- If `includeSourceMedia=true` or `includeTranscript=true`, the request must include `consentAccepted=true`; otherwise Host returns `DIAGNOSTICS_CONSENT_REQUIRED`.
- Support bundle artifacts may expose only workspace-relative `path`, host-relative `contentRef`, `artifactId`, `sizeBytes`, `sha256`, `contentType`, `included`, and `redacted` metadata.
- Support bundle artifacts must not expose API keys, bearer tokens, Authorization headers, plaintext provider payloads, transcript text embedded in the diagnostics JSON, or server-local absolute paths.
- Diagnostics page and Settings Center must require a selected task, at least one attachment checkbox, and the explicit consent checkbox before enabling support bundle export.
