# 07 Technology Selection Decision Matrix

日期：2026-04-26

## 目标

本矩阵记录关键技术选择、替代方案、拒绝理由和升级条件。实现时不得绕过这里的选型边界。

## 核心矩阵

| 技术域 | 标准选型 | 替代方案 | 决策 |
| --- | --- | --- | --- |
| 桌面壳 | Tauri 2 | Electron | 选 Tauri。Rust 生态一致、安装包轻、适合本地 host 监督。 |
| 前端 | React + Vite + TypeScript | Vue/Svelte/Next.js | 选 React/Vite。贴合现有 apps 生态，不引入 SSR 复杂度。 |
| UI 图标 | lucide-react | 手写 SVG / 重型 UI icon pack | 选 lucide-react。图标语义清晰、体积可控、贴合工具型工作台按钮和状态提示。 |
| UI 组件原语 | 自研轻量组件，Radix UI primitives 作为候选 | 重型全量组件库 | MVP 保持轻量；复杂弹层、菜单、tabs、tooltip、无障碍交互不足时再按组件级引入 Radix。 |
| 客户端状态 | React state/context MVP，Zustand 二阶段 | Redux / MobX | MVP 不引入全局状态框架；任务队列、审阅工作台和跨面板状态复杂后引入 Zustand。 |
| 服务端状态 | host client + SSE/polling MVP，TanStack Query 二阶段 | 手写分散缓存 | MVP 保持请求层清晰；任务列表、artifact、capability、settings 缓存和轮询复杂后引入 TanStack Query。 |
| 表单 | schema-driven controlled form MVP，react-hook-form 二阶段 | 无 schema 的手写表单 | 配置表单必须跟 JSON Schema 对齐；字段规模和校验复杂后引入 react-hook-form + schema resolver。 |
| 媒体预览 | HTML5 video | 前端 FFmpeg / 自研播放器内核 | 选 HTML5 video 作为预览基础。逐帧、波形、标注增强可后续加组件，但不在前端做媒体处理。 |
| Rust HTTP | axum + tower-http | Actix Web | 选 axum。tokio/tower 生态一致，middleware 和 SSE 简洁。 |
| middleware/resilience | tower | 自研 middleware | 选 tower。timeout、limit、load shed 等可组合，贴合 axum。 |
| async runtime | tokio | async-std | 选 tokio。Rust server、subprocess、reqwest 生态主流。 |
| cancellation | tokio-util CancellationToken | 自研 atomic flag | 选 CancellationToken。任务、provider、FFmpeg child process 统一取消语义。 |
| HTTP client | reqwest | hyper low-level | 选 reqwest。multipart、timeout、proxy、TLS 更省工程成本。 |
| CLI 参数 | clap | 手写 env 解析 | 选 clap。用于 host binary、doctor、release smoke 命令入口。 |
| 分层配置 | config crate 或薄封装 | scattered env reads | 选集中配置层。所有配置必须经过 `RuntimeConfigPort`。 |
| API schema | OpenAPI 3.1 | OpenAPI 3.2 / 手写 markdown | MVP 固定 OpenAPI 3.1。3.2 作为后续升级候选；手写 markdown 不作为契约来源。 |
| JSON schema | JSON Schema 2020-12 | 自定义校验 | 选 JSON Schema。统一 LLM/config/API/manifest 校验。 |
| Schema 生成 | schemars | 手写 schema | 优先 schemars 生成，再用人工 review 固化 schema。 |
| 媒体渲染 | FFmpeg/ffprobe/libass | GStreamer | 选 FFmpeg。短视频裁切、混音、字幕烧录能力完整。 |
| 字幕 | ASS | SRT/VTT | 内部选 ASS。SRT/VTT 只用于导入导出。 |
| VAD | Silero VAD ONNX + ONNX Runtime | WebRTC VAD | 选 Silero ONNX。更适合人声区间，WebRTC 可做轻量 fallback。 |
| STT | Host STT bridge + OpenAI verbose JSON canonical contract | 本地 Whisper 优先 / 前端直连云厂商 SDK | 选 Host bridge。业务统一消费 `TranscriptDocument`；OpenAI、火山 BigASR Flash、阿里 Qwen-ASR 都映射为 OpenAI-style verbose JSON；LocalWhisper 只做 fallback。 |
| LLM | OpenAI-compatible `/v1/chat/completions` | Ollama/llama.cpp 私有 API | 选 OpenAI-compatible，拒绝 Ollama/llama.cpp 作为产品契约。 |
| 场景检测 | PySceneDetect 二阶段 | MVP 自研 | 二阶段引入，MVP 不阻塞。 |
| 主体检测 | MediaPipe 二阶段 | 自研 CV | 二阶段引入，先固定裁切。 |
| 稳定 | FFmpeg vidstab/OpenCV 二阶段 | MVP 强制 | 二阶段引入，MVP 轻微缩放居中。 |
| 任务存储 | FileSystem MVP | SQLite/PostgreSQL | MVP 选文件系统，按并发演进。 |
| 数据库实现规范 | `DATABASE_SPEC.md` + project database standard | 直接写 ORM/SQL | 选数据契约优先。MVP 不引入数据库；首次数据库阶段先写契约和 baseline schema，发布后升级才使用 migration。 |
| DB adapter | sqlx | diesel/sea-orm | 进入 SQLite/PostgreSQL 阶段优先 sqlx，迁移和 async 生态直接。 |
| DB schema registry | `docs/database/schema-registry/*.yaml` | 仅靠 DDL 或 row struct | 新表先写契约，再生成或校验 baseline schema、后续 migration、DTO、OpenAPI/JSON Schema。 |
| Artifact | FileSystem MVP | S3-compatible | MVP 选文件系统，k8s 多副本前升级对象存储。 |
| object storage adapter | object_store crate | 直接绑定 AWS SDK | 选 object_store 作为候选 port adapter，避免业务绑定单云厂商。 |
| 观测 | tracing JSON logs | OpenTelemetry only | MVP 选 tracing，server/k8s 可加 OTLP。 |
| 配置诊断 | effective-config.redacted.json | 无诊断 | 必须输出脱敏 effective config，方便跨模式排障。 |
| 能力发现 | CapabilityReport | UI 自行探测 | 必须统一 `/capabilities`，UI/doctor/smoke 共用。 |
| SBOM | CycloneDX | 无 | 必须产出 SBOM。 |
| Rust 测试执行 | cargo test，后续 cargo-nextest | 只跑脚本 smoke | MVP 可 cargo test，测试量上来后引入 nextest。 |
| snapshot test | insta | 手写文本比对 | Prompt/schema/plan/render graph 快照优先使用 insta。 |
| Rust supply-chain | cargo-deny + cargo-audit | 人工看 Cargo.lock | license/advisory/bans 必须自动化。 |
| ADR/技术雷达 | Markdown ADR + scorecard | 口头决策 | 重大选型必须 ADR，trial/adopt/hold 有记录。 |

## 2026-04-27 Implementation Status: STT Provider Bridge

The selected speech-to-text bridge is now implemented behind the Host `SpeechToTextPort` boundary.

- Adopted now: `speechToText.providerProfile` with `openai-audio-transcriptions`, `volcengine-bigasr-flash`, and `aliyun-qwen-asr`.
- Adopted now: OpenAI multipart `/v1/audio/transcriptions` with `response_format=verbose_json`.
- Adopted now: Volcengine BigASR Flash `/api/v3/auc/bigmodel/recognize/flash` with base64 WAV request, `X-Api-Key`, `X-Api-Resource-Id`, request id, and sequence headers.
- Adopted now: Alibaba Qwen-ASR OpenAI-compatible `/compatible-mode/v1/chat/completions` with `input_audio` data URL and JSON object response mapping.
- Adopted now: canonical bridge conformance check `stt.provider.bridge` with safe `providerProfile`, `vendorEndpoint`, `resourceId`, model, language, timestamp granularity, and credential status.
- Adopted now: Settings Center, OpenAPI, mock client, Host settings validation, and runtime env configuration for STT provider profile/resource metadata.
- Still rejected: frontend direct vendor calls, provider raw DTOs in domain artifacts, plaintext API keys in settings/diagnostics/artifacts/logs, and Ollama-specific speech/model APIs.

## 2026-04-27 Implementation Status: Render Stack

The selected FFmpeg/ffprobe/libass media stack is now implemented for the current Host render contract.

- Adopted now: FFmpeg process execution for real uploaded source trimming and MP4 output.
- Adopted now: artifact-relative render log with redaction and real file SHA-256 metadata.
- Adopted now: one canonical `/api/video-cut/v1/tasks/{taskId}/render` contract shared by local and server modes.
- Adopted now: ASS subtitle artifact generation behind the Host subtitle adapter.
- Adopted now: FFmpeg cover PNG extraction behind the Host cover adapter.
- Adopted now: ASS subtitle burn-in through the FFmpeg subtitles/libass filter.
- Adopted now: render attempt provenance manifest `render.json` with schema id `video-cut.render-attempt.schema.v1`.
- Adopted now: basic voice enhancement through the FFmpeg audio preset `voice-basic-loudnorm-afftdn.v1` (`loudnorm` + `afftdn`).
- Adopted now: licensed BGM/SFX asset directory selection, typed `asset-manifest.json` metadata, sanitized asset provenance, user-level `renderPreferences` picking, and FFmpeg `amix` mixing. BGM stays at 20% target volume and remains `not-configured` or `disabled` unless an asset is actually selected and mixed.
- Pending behind existing ports: asset-pack import/curation UI and timeline-positioned SFX.
- Still rejected: browser-side FFmpeg, fake render artifacts, and user-provided raw FFmpeg filter strings.

## 2026-04-27 Implementation Status: Governance And SBOM

The architecture automation gates are now implemented as source-controlled scripts and package commands.

- Adopted now: `check:governance` unified report with architecture, runtime-boundary, security, license/SBOM, release-flow, ADR, and SLO categories.
- Adopted now: category-scoped commands `check:architecture-standards`, `check:runtime-boundaries`, `check:security`, `check:license`, `check:release-flow`, `check:adr`, and `check:slo`.
- Adopted now: `check:media-pipeline` for Host media tests plus frontend media/render contract tests.
- Adopted now: CycloneDX 1.6 SBOM output at `artifacts/governance/sdkwork-video-cut-sbom.cdx.json`.
- Adopted now: desktop-local release package/smoke targets are part of the release matrix alongside server, web, container, and Kubernetes.
- Adopted now: machine-readable runtime profile registry at `deploy/runtime-profiles.yaml`, checked by `check:deployment-matrix`.
- Adopted now: PRD API dependency coverage is tested against `docs/openapi/video-cut-v1.yaml`, so new Host routes must be reflected in the product contract.
- Still rejected: manual-only governance, unchecked route drift between PRD/OpenAPI/Host client, and release evidence without machine-readable reports.

## 拒绝方案

- 不使用 Ollama provider：违反 OpenAI-compatible 统一契约，容易让模型 API 泄漏到业务层。
- 不使用 `spring-ai-plus-ai-api`：项目要求独立运行，不依赖远程业务 API。
- 不使用 `spring-ai-plus-app-api`：本产品不是 app-api 客户端。
- 不默认引入 AGPL 核心依赖：私有化部署和分发风险高。
- 不把 Python 工具作为 MVP 主链路：部署复杂度高；二阶段以可选 adapter 引入。
- 不在前端实现媒体处理：浏览器权限、性能和安全边界不适合。
- 不做完整 NLE 时间线：需求是自动剪辑/审阅，不是通用剪辑软件。
- 不允许 scattered env reads：会让部署模式不可预测，必须集中到 `RuntimeConfigPort`。
- 不允许 UI 自行探测 capability：会导致 desktop/web/server 行为不一致。
- 不允许直接绑定单一对象存储厂商 SDK 到业务层：必须经 `ArtifactRepositoryPort`。
- 不允许无 ADR 引入重大 runtime/provider/storage 技术。

## 升级触发条件

| 从 | 到 | 触发条件 |
| --- | --- | --- |
| FileSystemTaskRepository | SQLiteTaskRepository | 任务列表查询、恢复、并发写入开始复杂。 |
| SQLiteTaskRepository | PostgreSQLTaskRepository | server 多用户、多实例或 k8s 副本需求出现。 |
| FileSystemArtifactRepository | S3CompatibleArtifactRepository | container/k8s 多副本或大规模 artifact 存储需求出现。 |
| in-memory queue | SQLite/DB queue | 需要重启恢复排队任务。 |
| DB queue | external queue | 多实例 worker、优先级、重试策略复杂。 |
| fixed crop | MediaPipe subject tracking | 上半身构图质量成为主要缺陷。 |
| loudnorm/afftdn | RNNoise/DeepFilterNet | 音频质量指标和用户反馈要求更强降噪。 |
| basic logs | OpenTelemetry | server/container/k8s 需要集中排障和指标。 |
| static env config | RuntimeConfigPort + schema | 支持多部署模式、doctor、Helm values parity。 |
| manual checks | governance automation | 开始实现包边界、route、provider、release 约束时。 |
| cargo test only | cargo-nextest | 测试数量增长、需要并发和分组报告时。 |
| manual dependency review | cargo-deny/cargo-audit | 引入第三方 crate 后立即触发。 |
| no ADR | ADR + technology radar | 任一核心技术进入 `trial` 或 `adopt` 前。 |

## 技术引入 Checklist

任何新技术进入主链路前必须满足：

- 有 port。
- 有 adapter。
- 有 capability。
- 有 health check。
- 有 config schema。
- 有 fake adapter。
- 有 conformance test。
- 有 error mapping。
- 有 redaction。
- 有 license/SBOM 记录。
- 有 deployment mode 支持声明。
