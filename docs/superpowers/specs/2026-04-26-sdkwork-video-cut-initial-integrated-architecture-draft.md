# sdkwork-video-cut 初始集成架构草案

> 状态：历史草案。正式架构标准已拆分到 `docs/architecture/00-architecture-map.md` 及其专题文档。本文件保留初始设计上下文，不再作为唯一 authority。

日期：2026-04-26

## 目标

`sdkwork-video-cut` 是一个单机独立运行的 AI 视频剪辑应用，用于把口播、访谈、长访谈素材自动处理成可发布的竖屏短视频。

项目参考 `ARCHITECT.md` 中 Magic Studio V2 的架构边界思想，但不依赖 Magic Studio runtime、`spring-ai-plus-ai-api`、`spring-ai-plus-app-api` 或任何远程业务 API。

“单机独立”是默认产品形态，不等于只能桌面运行。项目必须保持 local-first 能力，同时把同一个 Rust host 内核包装为 server、Docker、Kubernetes 等部署形态，满足个人本机、内网服务器和私有化部署。

核心目标：

- 本机启动、本机分析、本机渲染、本机保存产物。
- 前端只做薄交互层，不承载真实剪辑、AI、渲染或持久化业务。
- 本地 Rust host 是唯一业务能力内核。
- Tauri 只作为桌面壳，不成为第二套后端。
- 通过本地 HTTP API 连接前端和 Rust host。
- 同一个 Rust host 内核必须同时支持 desktop-local、server-private、container-private、kubernetes-private 等部署形态。
- 前端 service layer 在所有部署形态下保持同一套 API facade，不写部署模式分支。
- 使用 FFmpeg/ffprobe 执行真实媒体处理。
- AI 能力通过 provider 抽象接入，统一采用 OpenAI-compatible API 标准；缺失时通过 capability 明确降级。

## 非目标

- 不接入 `spring-ai-plus-ai-api`。
- 不接入 `spring-ai-plus-app-api`。
- 不复用 MagicCut 业务代码。
- 不实现通用时间线剪辑软件。
- 不在前端直接调用 FFmpeg、Whisper、OpenAI-compatible endpoint 或文件系统业务逻辑。
- 不在 `src-tauri` 中实现产品业务后端。
- 不伪造视频渲染、语音增强、AI 分析等能力；做不到必须暴露 unsupported reason。

## README 需求映射

### 类型 1：单人口播

输入张老师单人口播视频，输出一条可发布短视频：

- 输出比例：9:16
- 分辨率：1080x1920
- 帧率：30fps
- 格式：MP4
- 时长：不超过 90 秒
- 删除停顿、咳嗽、重复
- 聚焦上半身，占约 2/3 画面
- 画面稳定
- 语音增强，避免明显混响
- 简体中文逐句字幕
- 字幕使用极宋字体风格、阴影、黄色重点高亮
- 轻音乐 20% 音量
- 自动封面，包含问题和核心观点
- 专业干净风格
- 可插入提示音“叮”

### 类型 2：访谈视频

输入访谈视频，按问答结构批量生成短视频：

- 识别一问一答结构
- 删除无效内容
- 画面稳定和轻微缩放
- 批量生成
- 字幕、包装、输出规则沿用类型 1

### 类型 3：长访谈拆条

输入长访谈，提取矩阵短视频内容：

- 提取问答片段
- 单条 60-180 秒
- 去广告、去废话
- 批量输出多个可发布 MP4

## 架构总览

采用“桌面壳 + 薄前端 + Rust host + 工具链”的 local-first 多部署架构：

```text
sdkwork-video-cut
  Tauri desktop shell
    - 窗口、安装包、启动本地 host、系统集成
  React frontend
    - 上传、配置、预览、任务管理、下载
  Local Rust host
    - 唯一业务能力内核
    - 本地 HTTP API
    - 任务状态、素材、AI 分析、FFmpeg 渲染、artifact 存储
  Local tools
    - ffmpeg
    - ffprobe
    - OpenAI-compatible Chat/Audio endpoint
    - whisper.cpp / faster-whisper 可选离线转写 fallback
  Local storage
    - settings
    - tasks
    - assets
    - analysis
    - render artifacts
```

运行时数据流：

```text
React UI
  -> local HTTP client
  -> Rust host routes
  -> task service
  -> media probe/extract services
  -> AI providers
  -> cut plan service
  -> render service
  -> local artifacts
  -> React UI download/open folder
```

## 部署架构标准

参考 BirdCoder 的部署模式思想，`sdkwork-video-cut` 采用“一个产品能力面 + 多交付形态 + 多运行拓扑”的标准。部署形态可以变化，但前端面对的业务 facade、领域模型、任务状态机、artifact 语义不能变化。

核心不变量：

- 只有一个业务内核：`host/` Rust server。
- `src-tauri/` 只负责桌面壳、启动/监督本地 host、系统集成，不实现业务 use case。
- server、container、kubernetes 都是同一个 Rust host 的部署包装，不允许重新实现一套 Node/Java/Python 后端。
- React 前端只调用 `sdkwork-video-cut-core` 暴露的 host client facade。
- provider、工具链、存储、鉴权、CORS、路径、并发等差异全部由运行时配置和 capability discovery 解决。
- AI 调用只通过 OpenAI-compatible provider port，不通过 `spring-ai-plus-ai-api`、`spring-ai-plus-app-api`、Ollama 或 provider 私有 SDK 直接进入 use case。
- 本地工具调用、文件访问、secret 读取、artifact 存储都必须经过 port/adapter，不能散落在业务流程中。

交付模式：

| Delivery mode | 运行形态 | 标准说明 |
| --- | --- | --- |
| `desktop` | Tauri 桌面应用 | 内嵌或连接 Rust host。桌面壳不拥有业务逻辑。 |
| `web` | 浏览器前端 | 连接 private/server/container/kubernetes 暴露的 canonical host API。 |
| `server` | 原生 Rust host | 单 binary 或 release bundle，服务 API 和构建后的 web assets。 |
| `container` | Docker Compose / OCI image | 运行 server 形态，镜像内置必需媒体工具或启动时 fail closed。 |
| `kubernetes` | Helm-compatible chart | 运行 server 形态，使用 Secret/ConfigMap/PVC/Service/Ingress 管理部署。 |

部署模式：

| Deployment mode | 推荐命令族 | 运行拓扑 | 存储策略 | 适用场景 |
| --- | --- | --- | --- | --- |
| `desktop-local` | `pnpm dev:local`, `pnpm desktop:dev:local`, `pnpm stack:desktop:local` | Tauri 启动本机 Rust host，前端连 `127.0.0.1` 随机安全端口 | 用户本机 app data 目录 | 单机独立使用、离线媒体处理、个人工作站 |
| `desktop-private` | `pnpm desktop:dev:private` | Tauri 不启动业务 host，连接私有 server API | server 端存储 | 桌面壳作为私有部署客户端 |
| `web-private` | `pnpm web:dev:private`, `pnpm stack:web:private` | 浏览器连接私有 server API | server 端存储 | 团队内网 Web 工作台 |
| `server-private` | `pnpm server:dev:private` | 原生 Rust host 服务 API 和 web assets | 本地目录、挂载盘或后续对象存储 adapter | 单机服务器、内网服务器 |
| `container-private` | `pnpm release:package:container` | Docker image 运行 server | volume/PVC/object storage adapter | Docker Compose、私有云 |
| `kubernetes-private` | `pnpm release:package:kubernetes` | Helm chart 运行 server | PVC 或对象存储 adapter | K8s 集群、GPU 节点、集中运维 |

拓扑规则：

- `desktop-local` 允许自动寻找空闲 loopback 端口，并通过启动握手把 baseUrl 注入前端运行时。
- `desktop-private` 和 `web-private` 不允许直接访问本地 FFmpeg、文件系统或 OpenAI-compatible endpoint，所有能力必须经 server host API。
- `server-private` 可以直接使用服务器上的 FFmpeg/ffprobe 和本地文件系统，但仍必须通过 port/adapter。
- `container-private` 和 `kubernetes-private` 必须通过环境变量、Secret、ConfigMap 和挂载卷注入配置，不把 API key、模型路径或输出路径写死到镜像。
- K8s 第一版默认 `replicas: 1`。只有当 `TaskRepositoryPort`、`ArtifactRepositoryPort`、任务锁、队列、对象存储都支持多实例一致性后，才允许水平扩容。

## Canonical API Facade

所有部署模式共用产品级 API 前缀：

```text
/api/video-cut/v1
```

示例 baseUrl：

```text
desktop-local       http://127.0.0.1:{port}/api/video-cut/v1
server-private      https://video-cut.internal.example.com/api/video-cut/v1
container-private   http://localhost:8787/api/video-cut/v1
kubernetes-private  https://video-cut.example.com/api/video-cut/v1
```

`/api/local/v1` 只能作为桌面早期兼容 alias 出现在 host route 层，不能出现在 `packages/sdkwork-video-cut-feature`、`packages/sdkwork-video-cut-core` 或公开文档的主契约中。这样可以保留“本地优先”的产品形态，同时避免 server/docker/k8s 部署时出现语义错误。

禁止：

- 不使用 `/api/app/v1`、`/api/admin/v1` 或任何 `spring-ai-plus-app-api` 路由作为视频剪辑产品契约。
- 不让前端根据 `desktop/server/docker/k8s` 拼不同业务路径。
- 不在 Tauri command 中复制 `/api/video-cut/v1` 已有业务能力。

## 部署配置标准

环境变量命名空间统一使用 `SDKWORK_VIDEO_CUT_*`。桌面本地配置可以来自 settings 文件和系统安全凭据；server/container/k8s 配置必须优先来自 env/Secret/ConfigMap。

配置优先级：

```text
code defaults
  < mode profile
  < config file
  < environment variables
  < command line flags
  < server-side locked policy
```

核心配置：

| 配置项 | 示例 | 说明 |
| --- | --- | --- |
| `SDKWORK_VIDEO_CUT_RUNTIME_MODE` | `desktop-local`, `server-private`, `container-private`, `kubernetes-private` | 运行模式，仅影响拓扑和默认配置，不改变业务 API。 |
| `SDKWORK_VIDEO_CUT_BIND_HOST` | `127.0.0.1`, `0.0.0.0` | server 监听地址。 |
| `SDKWORK_VIDEO_CUT_PORT` | `8787` | server 监听端口；desktop-local 可自动分配。 |
| `SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL` | `https://video-cut.example.com` | 生成下载链接、回调链接和前端运行时配置。 |
| `SDKWORK_VIDEO_CUT_WORKSPACE_ROOT` | `/data/workspaces` | 项目和任务工作目录。 |
| `SDKWORK_VIDEO_CUT_ARTIFACT_ROOT` | `/data/artifacts` | 渲染产物目录。 |
| `SDKWORK_VIDEO_CUT_TEMP_ROOT` | `/tmp/sdkwork-video-cut` | 临时文件目录。 |
| `SDKWORK_VIDEO_CUT_STORAGE_PROVIDER` | `filesystem`, `s3-compatible` | artifact 存储 adapter 选择；MVP 为 `filesystem`。 |
| `SDKWORK_VIDEO_CUT_MAX_UPLOAD_BYTES` | `2147483648` | 上传大小限制。 |
| `SDKWORK_VIDEO_CUT_MAX_SOURCE_DURATION_SECONDS` | `10800` | 单素材最长时长。 |
| `SDKWORK_VIDEO_CUT_WORKER_CONCURRENCY` | `1`, `2` | 本机并发渲染/分析数量，默认保守。 |
| `SDKWORK_VIDEO_CUT_FFMPEG_PATH` | `/usr/bin/ffmpeg` | FFmpeg 路径。 |
| `SDKWORK_VIDEO_CUT_FFPROBE_PATH` | `/usr/bin/ffprobe` | ffprobe 路径。 |
| `SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS` | `https://video-cut.example.com` | Web/server 跨域白名单。 |
| `SDKWORK_VIDEO_CUT_AUTH_MODE` | `none`, `single-user-token`, `reverse-proxy` | MVP 可 `none`，server 部署建议至少 `single-user-token`。 |
| `SDKWORK_VIDEO_CUT_SECRET_PROVIDER` | `local-secure-store`, `env`, `kubernetes-secret` | secret 来源。 |

OpenAI-compatible 配置：

| 配置项 | 说明 |
| --- | --- |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_BASE_URL` | OpenAI-compatible endpoint base URL，不包含 `/v1` 之后的资源路径。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_API_KEY` | API key，只能来自 secret store/env/K8s Secret，不写入 artifact。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_CHAT_MODEL` | 结构化文本分析模型。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL` | 音频转写模型。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_TIMEOUT_SECONDS` | 请求超时。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_SUPPORTS_JSON_SCHEMA` | 是否支持 JSON Schema structured outputs。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_SUPPORTS_JSON_OBJECT` | 是否支持 JSON object mode。 |
| `SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_SUPPORTS_AUDIO_TRANSCRIPTIONS` | 是否支持 `/v1/audio/transcriptions`。 |

配置治理规则：

- 所有配置必须有 machine-readable schema、默认值说明、是否 secret、是否可热更新、适用 deployment mode。
- secret 字段不得进入任务 JSON、渲染日志、浏览器 localStorage、错误 message 或 release manifest。
- capability discovery 必须暴露“能力是否可用”和“不可用原因”，不能只返回 true/false。
- doctor 命令必须检查 FFmpeg、ffprobe、工作目录写权限、OpenAI-compatible provider 连通性、转写模型、结构化输出支持、磁盘空间和可选 GPU/ONNX Runtime。

## Docker 标准

目录标准：

```text
deploy/
  docker/
    README.md
    Dockerfile
    docker-compose.yml
    docker-compose.nvidia-cuda.yml
    docker-compose.amd-rocm.yml
    .env.example
  kubernetes/
    Chart.yaml
    values.yaml
    values.release.yaml
    templates/
      deployment.yaml
      service.yaml
      ingress.yaml
      configmap.yaml
      secret.yaml
      pvc.yaml
      hpa.yaml
      servicemonitor.yaml
```

Docker image 标准：

- 镜像运行的是 `server` 形态，不运行 Tauri。
- 镜像包含 Rust host binary、构建后的 web assets、FFmpeg、ffprobe、libass 和基础字体。
- API key、模型 token、私有 baseUrl 不得写入镜像 layer。
- 默认非 root 用户运行。
- 默认挂载 `/data` 保存 workspace/artifacts/config，挂载 `/tmp/sdkwork-video-cut` 作为临时目录。
- healthcheck 调用 `GET /api/video-cut/v1/health`。
- 镜像启动时如果 FFmpeg/ffprobe 缺失，必须 fail closed 或在 capability 中明确不可渲染，不允许假装成功。
- CUDA/ROCm compose overlay 只声明加速资源和相关环境变量，不改变业务 API。
- Python/MediaPipe/PySceneDetect/WhisperX/pyannote 等第二阶段工具不得默认进入最小 runtime image；应通过 `tools-extended` 或独立 worker profile 引入。

Docker Compose 标准命令：

```bash
docker compose -f deploy/docker/docker-compose.yml up -d
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.nvidia-cuda.yml up -d
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.amd-rocm.yml up -d
```

## Kubernetes 标准

Kubernetes chart 必须是 Helm-compatible，并和 release packaging 共用同一套 values schema。

K8s 资源标准：

- `Deployment`：运行 server image，声明资源 requests/limits。
- `Service`：暴露 HTTP 服务。
- `Ingress`：可选，配置上传大小、超时、TLS。
- `ConfigMap`：非敏感配置。
- `Secret`：OpenAI-compatible API key、server token、对象存储密钥。
- `PVC`：MVP 的 workspace/artifacts 持久化。
- `ServiceMonitor`：可选，接入 Prometheus。
- `HPA`：默认关闭；只有存储、队列和任务锁支持多实例后才打开。

K8s values 必须覆盖：

- image repository/tag/digest
- runtime mode
- public base URL
- storage provider
- workspace/artifact PVC
- OpenAI-compatible provider secret reference
- FFmpeg/ffprobe path
- worker concurrency
- max upload size
- ingress host/TLS
- nodeSelector/tolerations/affinity
- accelerator profile: `none`, `nvidia-cuda`, `amd-rocm`

发布包中的 `values.release.yaml` 必须固定：

- immutable image tag
- optional image digest
- target architecture
- accelerator profile
- chart version
- app version
- release manifest checksum

## 命令矩阵标准

根 `package.json` 建议提供 BirdCoder 风格命令族：

```json
{
  "scripts": {
    "dev": "node scripts/run-video-cut-dev-stack.mjs web --deployment-mode server-private",
    "dev:local": "node scripts/run-workspace-package-script.mjs . desktop:dev:local",
    "dev:private": "node scripts/run-video-cut-dev-stack.mjs web --deployment-mode server-private",

    "desktop:dev:local": "node scripts/run-video-cut-desktop-command.mjs tauri:dev --deployment-mode desktop-local",
    "desktop:dev:private": "node scripts/run-video-cut-desktop-command.mjs tauri:dev --deployment-mode server-private",
    "web:dev:private": "node scripts/run-video-cut-web-command.mjs dev --deployment-mode server-private",
    "server:dev:private": "node scripts/run-video-cut-server-command.mjs dev --deployment-mode server-private",

    "stack:desktop:local": "node scripts/run-video-cut-dev-stack.mjs desktop --deployment-mode desktop-local",
    "stack:desktop:private": "node scripts/run-video-cut-dev-stack.mjs desktop --deployment-mode server-private",
    "stack:web:private": "node scripts/run-video-cut-dev-stack.mjs web --deployment-mode server-private",

    "deployment:show": "node scripts/show-video-cut-deployment-env.mjs desktop-dev --deployment-mode desktop-local",
    "deployment:show:desktop:local": "node scripts/show-video-cut-deployment-env.mjs desktop-dev --deployment-mode desktop-local",
    "deployment:show:server:private": "node scripts/show-video-cut-deployment-env.mjs server-dev --deployment-mode server-private",
    "deployment:doctor": "node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local",
    "deployment:doctor:desktop:local": "node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local",
    "deployment:doctor:server:private": "node scripts/run-video-cut-deployment-doctor.mjs server-dev --deployment-mode server-private",

    "release:package:desktop": "node scripts/release/local-release-command.mjs package desktop",
    "release:package:server": "node scripts/release/local-release-command.mjs package server",
    "release:package:container": "node scripts/release/local-release-command.mjs package container",
    "release:package:kubernetes": "node scripts/release/local-release-command.mjs package kubernetes",
    "release:package:web": "node scripts/release/local-release-command.mjs package web",
    "release:smoke:desktop": "node scripts/release/local-release-command.mjs smoke desktop --release-assets-dir artifacts/release",
    "release:smoke:server": "node scripts/release/local-release-command.mjs smoke server --release-assets-dir artifacts/release",
    "release:smoke:container": "node scripts/release/local-release-command.mjs smoke container --release-assets-dir artifacts/release",
    "release:smoke:kubernetes": "node scripts/release/local-release-command.mjs smoke kubernetes --release-assets-dir artifacts/release",
    "release:smoke:web": "node scripts/release/local-release-command.mjs smoke web --release-assets-dir artifacts/release",
    "release:finalize": "node scripts/release/local-release-command.mjs finalize --release-assets-dir artifacts/release"
  }
}
```

命令 wrapper 负责注入部署配置，业务代码不能读取 `pnpm script name` 推断行为。所有模式最终都必须落到相同的 `RuntimeDeploymentConfig` 标准模型。

## 发布与 Smoke 标准

Release asset family：

- `desktop`：Tauri 安装包、嵌入 host binary、桌面启动 smoke 报告。
- `server`：Rust host binary、web assets、配置样例、systemd/service 样例。
- `container`：Dockerfile、compose 模板、镜像 tag/digest、container smoke 报告。
- `kubernetes`：Helm chart、`values.yaml`、`values.release.yaml`、template/render smoke 报告。
- `web`：静态 web bundle、runtime config 样例、bundle budget 报告。

每次 release 必须产出：

- `release-manifest.json`
- `SHA256SUMS.txt`
- `release-notes.md`
- `quality-gate-execution-report.json`
- 对应 family 的 smoke report

Smoke 最小标准：

- `desktop`：启动 Tauri，嵌入 host health 通过，capability discovery 可读，打开设置页不报错。
- `server`：启动 binary，`GET /api/video-cut/v1/health`、`GET /api/video-cut/v1/capabilities` 通过，临时 workspace 可写。
- `container`：compose up 后 health 通过，容器内 `ffmpeg -version` 和 `ffprobe -version` 可执行。
- `kubernetes`：`helm template` 通过，release values schema 通过；有集群时执行 rollout/health smoke。
- `web`：生产构建通过，runtime config 能指向 `/api/video-cut/v1`，没有部署模式业务分支。
- `media`：有测试素材时，执行 3-10 秒样例渲染，验证 MP4、分辨率、帧率、字幕、render log。

## Rust Host 技术标准

Rust host 是唯一业务内核，建议第一版技术基线：

- async runtime：`tokio`
- HTTP server：`axum`
- middleware/static assets：`tower-http`
- HTTP client：`reqwest`
- serialization：`serde`, `serde_json`
- schema：`schemars`, `jsonschema`
- error：`thiserror`
- logging/tracing：`tracing`, `tracing-subscriber`
- ids：`ulid` 或 `uuid`
- paths：`camino` 或标准 `PathBuf` 封装
- temp files：`tempfile`
- subprocess：`tokio::process::Command`，只能通过 `CommandRunnerPort` 使用
- SSE/progress：axum SSE 或标准轮询 endpoint，前端只消费 `VideoCutProgressEvent`

Rust host 分层：

```text
routes
  -> application use cases
  -> domain services
  -> ports
  -> adapters
  -> external tools/providers/storage
```

禁止：

- route handler 直接拼 FFmpeg 命令。
- route handler 直接调用 OpenAI-compatible HTTP。
- use case 直接读取 env、Secret、ConfigMap。
- adapter 返回第三方 DTO 给 domain/use case。
- 为了部署模式差异复制一套 server。

## 技术选型总原则

技术选型必须服务于“独立运行、可替换、可验证、可部署、可维护”。所有选型都要写清楚为什么选、替代方案是什么、如何被 port 隔离、失败时如何降级。

选型原则：

- 优先选择稳定、维护活跃、License 清晰、跨平台成熟的基础技术。
- 媒体处理优先选择真实工业工具链，不用伪实现替代 FFmpeg 渲染。
- AI 能力只绑定 OpenAI-compatible 协议，不绑定具体厂商 SDK、Ollama、llama.cpp 或 `spring-ai-plus-ai-api`。
- 本地桌面优先轻依赖；server/container/k8s 优先可观测、可配置、可升级。
- MVP 不引入分布式复杂度；通过 port 预留 SQLite、PostgreSQL、S3-compatible、队列和 GPU worker 演进位。
- 可替换能力必须有 conformance test，不允许只靠人工约定维持兼容。
- 涉及外部命令、模型、字体、音频、视频、License 的能力必须有 machine-readable manifest。

## 技术选型矩阵

| 技术域 | MVP 推荐 | 第二阶段候选 | 隔离边界 | 选择理由 |
| --- | --- | --- | --- | --- |
| 桌面壳 | Tauri 2 | 无 | `src-tauri` shell boundary | 轻量、跨平台、Rust 生态一致，适合本地 host 进程监督。 |
| 前端 | React + Vite + TypeScript | TanStack Query/Zustand 视复杂度引入 | `sdkwork-video-cut-feature` | 当前 repo apps 已广泛使用 React/Vite，利于复用工程标准。 |
| UI 组件 | 自研轻量组件 + lucide-react | Radix UI primitives | `sdkwork-video-cut-commons` | 视频工作台需要密集操作界面，避免重 UI 框架绑死。 |
| Rust HTTP | axum + tower-http | 无 | `host/routes` | async Rust、typed extractor、middleware 生态成熟。 |
| async runtime | tokio | 无 | host runtime | Rust server、subprocess、HTTP client、SSE 都可统一。 |
| HTTP client | reqwest | hyper client | provider adapter | OpenAI-compatible、多部分上传、超时和代理配置成熟。 |
| Schema | JSON Schema 2020-12 + schemars/jsonschema | OpenAPI 3.1 schema projection | `contracts/schema` | 统一 LLM 输出、API envelope、配置和 capability 校验。 |
| API 描述 | OpenAPI 3.1 | SDK codegen | `contracts/openapi` | 固化 `/api/video-cut/v1`，防止前端手写漂移。 |
| 媒体探测/渲染 | FFmpeg + ffprobe + libass | GStreamer 只作为远期替代研究 | `MediaProbePort`, `MediaRenderPort` | 工具成熟、跨平台、滤镜能力完整。 |
| 字幕 | ASS + FFmpeg subtitles filter | SRT/VTT 导入导出 | `SubtitleRendererPort` | ASS 支持样式、阴影、高亮，更适合短视频烧录。 |
| VAD | Silero VAD ONNX + ONNX Runtime | WebRTC VAD 作为轻量 fallback | `SpeechActivityDetectorPort` | 对人声区间更稳，ONNX 方便跨平台部署。 |
| 静音检测 | FFmpeg `silencedetect` | 自研 RMS 分析 fallback | `AudioBoundaryDetectorPort` | 快速、可解释、能直接输出候选停顿区间。 |
| ASR | OpenAI-compatible `/v1/audio/transcriptions` | LocalWhisperSpeechToTextAdapter fallback | `SpeechToTextPort` | 首选协议兼容和低维护，离线 fallback 仅负责转写。 |
| 语义分析 | OpenAI-compatible `/v1/chat/completions` structured output | 未来可加 Responses-compatible adapter | `LargeLanguageModelPort` | 业务只认结构化 JSON，不认 provider 私有响应。 |
| 场景检测 | MVP 可关闭 | PySceneDetect | `SceneDetectorPort` | 防止切点落在镜头变化中间。 |
| 主体跟踪 | MVP 固定裁切/轻微缩放 | MediaPipe / OpenCV | `SubjectTrackingPort` | 第二阶段提升上半身构图和稳定性。 |
| 画面稳定 | MVP 轻微缩放居中 | FFmpeg vidstab / OpenCV videostab | `VideoStabilizationPort` | 先保证稳定输出，再逐步提高质量。 |
| 音频增强 | FFmpeg loudnorm/afftdn | RNNoise / DeepFilterNet 研究 | `AudioEnhancementPort` | MVP 可控、跨平台；高级降噪延后。 |
| 任务持久化 | 文件系统 manifest | SQLite WAL；多实例再到 PostgreSQL | `TaskRepositoryPort` | 单机优先，任务增多后可加索引和事务。 |
| Artifact 存储 | 文件系统 | S3-compatible / MinIO | `ArtifactRepositoryPort` | 本地简单，server/k8s 可平滑切换。 |
| 配置 | JSON/TOML + env overlay | 远期策略配置中心 | `RuntimeConfigPort` | 单机和 server 都可解释。 |
| Secret | OS secure store / env / K8s Secret | Vault-compatible adapter | `SecretStorePort` | 防止 API key 进入配置文件和 artifact。 |
| 观测 | tracing JSON logs | OpenTelemetry OTLP exporter | `TelemetryPort` | 单机可读日志，server/k8s 可接入统一观测。 |
| 包供应链 | pnpm + cargo | CycloneDX SBOM | release pipeline | 输出可审计依赖和 License 证据。 |

## 架构分层标准

Rust host 必须按 Clean Architecture + Ports/Adapters 拆分：

```text
api-contracts
  -> route handlers
  -> application use cases
  -> domain services
  -> ports
  -> adapters
  -> infrastructure
```

层级规则：

- `domain` 不依赖 HTTP、FFmpeg、OpenAI-compatible DTO、文件系统、env、数据库。
- `application` 编排 use case、事务边界、状态迁移、进度事件，不直接调用外部系统。
- `ports` 只定义能力契约和标准模型。
- `adapters` 可以依赖第三方 crate、外部命令、HTTP endpoint、数据库或对象存储。
- `routes` 只做鉴权、参数解析、envelope 映射、调用 use case。
- `infrastructure` 负责运行时装配、配置、日志、进程、线程池、缓存。

建议 Rust 目录进一步标准化：

```text
host/src/
  contracts/
    openapi.rs
    schema_registry.rs
  application/
    create_task.rs
    import_source.rs
    analyze_task.rs
    build_plan.rs
    render_task.rs
    cancel_task.rs
  domain/
    task.rs
    plan.rs
    transcript.rs
    media.rs
    artifact.rs
    policy.rs
  ports/
    llm.rs
    speech_to_text.rs
    media_probe.rs
    media_render.rs
    storage.rs
    telemetry.rs
    command_runner.rs
  adapters/
    openai_compatible/
    ffmpeg/
    filesystem/
    sqlite/
    onnx/
  infrastructure/
    config.rs
    secrets.rs
    telemetry.rs
    runtime.rs
```

## 数据契约与 Schema 标准

所有可跨边界的数据都必须有 schema：

- HTTP request/response：OpenAPI 3.1。
- LLM structured output：JSON Schema 2020-12 子集。
- provider capability：JSON Schema。
- runtime config：JSON Schema。
- task/artifact/plan manifest：JSON Schema。
- release manifest：JSON Schema。

Schema 规则：

- 每个 schema 必须有稳定 `$id`、`title`、`version`、`additionalProperties: false`。
- 时间统一使用 RFC 3339 字符串；媒体时间统一使用 seconds double，不使用帧号作为跨层主单位。
- 金额、比例、音量、置信度使用明确范围约束。
- enum 只能追加，不能重命名；删除字段必须走 deprecation。
- 领域模型 version 和 schema version 分离，manifest 必须记录二者。
- LLM 输出 schema 必须比内部 domain schema 更窄，避免模型填充内部字段。
- OpenAPI、TypeScript types、Rust DTO 必须由同一 contract source 生成或通过 parity test 校验。

LLM schema 标准：

- 首选 `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`。
- 不支持 structured outputs 时才允许降级到 `json_object`。
- 降级结果必须通过本地 JSON Schema 校验，失败后最多重试一次。
- 所有时间区间必须再经过 domain validator 校验，不能只信模型。
- 模型 refusal、超时、限流、schema 不支持要映射为独立错误码。

## 任务引擎标准

视频处理必须视为可恢复长任务，不是一次 HTTP 同步调用。

任务模型：

```text
Task
  -> StageRun(import/probe/extract/transcribe/analyze/plan/render/artifact)
  -> StepRun(provider/tool invocation)
  -> Event(progress/log/warning/error/state-change)
  -> Artifact
```

任务引擎规则：

- 每个 stage 必须有 `stageId`、输入摘要、输出 artifact、开始/结束时间、状态、错误码。
- 每个外部调用必须记录 provider id、adapter version、输入 hash、输出 hash、日志路径。
- use case 必须幂等；重复提交 `analyze` 或 `render` 要能复用已有 stage 或生成新的 render attempt。
- 取消必须通过 `CancellationToken` 传递到 provider、command runner 和 render process。
- 崩溃恢复时，`running` stage 标记为 `interrupted`，不得继续假装执行中。
- render attempt 不覆盖旧产物，新产物以 `renderId` 隔离。
- 长任务事件使用 SSE 或轮询，事件落盘保留最近 N 条和关键状态事件。
- 第一版可用内存队列 + 文件锁；server 多任务建议升级 SQLite 队列表；多实例前必须引入分布式锁或外部队列。

## 媒体算法链路标准

媒体算法必须输出可解释中间轨道，不能只输出最终 cut。

标准轨道：

- `mediaInfoTrack`：分辨率、时长、帧率、音轨、编码信息。
- `silenceTrack`：静音区间、阈值、检测参数。
- `speechActivityTrack`：VAD 人声区间、置信度。
- `transcriptTrack`：句子、词、speaker、confidence。
- `sceneTrack`：镜头切换点、置信度。
- `subjectTrack`：人脸/上半身 box、平滑后的 crop window。
- `semanticTrack`：保留、删除、问答、高亮、封面文案、评分。
- `cutDecisionTrack`：候选切点、评分分解、拒绝原因。

切分决策必须可审计：

- 每个 cut segment 必须记录 `boundarySource` 和 `decisionReasons`。
- 每个 rejected range 必须记录原因：`silence`、`cough`、`duplicate`、`ad`、`filler`、`manual`。
- 自动删除不能直接丢失原始时间轴，必须保留 source mapping。
- 字幕 cue 必须和输出时间轴绑定，同时保留 source 时间映射。
- 用户手动调整计划后，`plan.json` 必须记录 override 来源和时间。

## 质量档位标准

不同机器、模型和工具可用性不同，产品必须声明质量档位，而不是隐式变化。

| Quality tier | 必备能力 | 输出承诺 |
| --- | --- | --- |
| `basic` | FFmpeg/ffprobe + 静音检测 + 手动字幕或导入字幕 | 可生成 9:16 MP4，不承诺智能拆条。 |
| `standard` | OpenAI-compatible STT + LLM structured output + ASS subtitle | 支持单人口播自动剪辑、字幕、高亮、封面文案。 |
| `interview` | standard + QA extraction + speaker/scene 辅助 | 支持一问一答拆条。 |
| `pro` | interview + subject tracking + stabilization + enhanced denoise | 支持更高质量构图、稳定、音频增强。 |
| `batch` | standard/pro + durable queue + resumable render | 支持批量任务和失败恢复。 |

capability discovery 必须返回当前档位、缺失能力、可执行功能和建议修复动作。

## 存储与索引标准

MVP 使用文件系统作为 source of truth，但必须按可迁移格式设计。

存储分层：

- `project.json`：项目元数据。
- `task.json`：任务状态机和 stage 摘要。
- `plan.json`：唯一剪辑计划事实来源。
- `transcript.json`：转写事实来源。
- `events.jsonl`：任务事件流。
- `render.json`：单次渲染 attempt。
- `artifacts/manifest.json`：产物索引。

演进路径：

- MVP：`FileSystemTaskRepository` + 原子写入 + 文件锁。
- 单机增强：`SqliteTaskRepository` + WAL + 索引查询 + 文件 artifact。
- 私有 server：SQLite 或 PostgreSQL adapter，视并发和多实例需求选择。
- K8s 多副本：PostgreSQL + S3-compatible artifact + 外部队列/锁，未满足前禁用多副本。

原子写入标准：

- 写入 manifest 必须先写临时文件，再 rename。
- 大文件写入必须记录 size、hash、createdAt。
- artifact 删除必须软删除或进入 retention policy，不直接破坏任务审计。
- 所有路径必须经过 workspace root guard，防止 path traversal。

## 安全标准

安全边界默认保守，尤其是 server/container/k8s。

必须实现：

- 上传文件类型白名单、大小限制、时长限制。
- 路径规范化和 workspace root guard。
- OpenAI-compatible baseUrl SSRF 防护：禁止内网敏感地址默认被远程用户配置；desktop-local 可放宽但要明确提示。
- API key/token 全链路脱敏。
- CORS 默认关闭通配符，server 模式必须显式配置 origin。
- server 模式至少支持 `single-user-token` 或 `reverse-proxy` 鉴权。
- 外部命令只能通过 `CommandRunnerPort`，使用 argv 数组，不拼 shell 字符串。
- FFmpeg 日志进入 artifact 前必须过滤本地绝对敏感路径和 secret。
- release 包必须包含 dependency/license 清单。

禁止：

- 前端保存 OpenAI-compatible API key 到 localStorage。
- 把用户上传文件路径、API key、provider header 写入公开错误信息。
- server 模式默认无鉴权暴露到 `0.0.0.0`。
- 允许用户任意传入 FFmpeg filter 字符串直接执行。

## 观测与诊断标准

日志、指标、追踪必须围绕任务和 provider 统一。

标准字段：

- `taskId`
- `projectId`
- `stageId`
- `renderId`
- `providerId`
- `adapterKind`
- `deploymentMode`
- `runtimeMode`
- `qualityTier`
- `traceId`

观测规则：

- desktop-local 默认写本地 JSONL 日志。
- server/container/k8s 默认 stdout 输出 JSON logs。
- 可选启用 OpenTelemetry OTLP exporter。
- 每个 provider invocation 必须形成 span。
- FFmpeg 执行必须记录命令摘要、参数 hash、退出码、耗时、stderr 日志路径。
- OpenAI-compatible 调用只记录 model、endpoint host、耗时、token/usage，不记录 prompt 原文和 API key。
- doctor 输出必须支持 `--json`，方便 CI 和 release smoke 读取。

## License 与供应链标准

媒体和 AI 工具链必须先过 License gate。

License 分层：

| 类别 | 默认策略 |
| --- | --- |
| MIT/Apache-2.0/BSD/ISC | 默认允许，仍需进入 SBOM。 |
| LGPL | 可作为动态库或外部进程使用，release 必须记录链接/分发方式。 |
| GPL | 默认不进入核心 runtime；如 FFmpeg build 含 GPL 组件，必须标记 release profile。 |
| AGPL | 默认禁止进入核心链路，除非单独评审并隔离为可选外部服务。 |
| 商业/模型 License | 必须记录来源、用途、再分发权限、缓存策略。 |

供应链要求：

- release 产出 CycloneDX SBOM。
- 记录 Rust crate、npm package、系统工具、模型文件、字体、BGM/SFX 素材。
- FFmpeg build profile 必须记录 enabled libraries、GPL/nonfree 状态。
- 模型文件必须有 `model-card.json` 或等效 manifest。
- 字体和音频素材必须有 license manifest。

## 测试与质量门禁标准

测试按层级分开：

- unit：domain、policy、score、time mapping、schema validator。
- port conformance：每个 port 的 fake adapter 和真实 adapter 共享测试。
- contract：OpenAPI route、TypeScript/Rust DTO parity、JSON Schema parity。
- provider：OpenAI-compatible mock server、STT mock server、schema invalid retry。
- media golden：短样例素材，验证输出分辨率、帧率、时长、字幕、音频 loudness。
- command safety：argv 执行、path guard、secret redaction。
- recovery：任务中断、重启、取消、重复提交、render attempt 隔离。
- deployment smoke：desktop/server/container/kubernetes/web。

建议质量门禁：

```bash
pnpm run typecheck
pnpm run test
pnpm run check:contracts
pnpm run check:architecture-standards
pnpm run check:runtime-boundaries
pnpm run check:license
pnpm run deployment:doctor
cargo test --manifest-path host/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run test:media-smoke
pnpm run release:smoke:server
pnpm run release:smoke:container
pnpm run release:smoke:kubernetes
```

质量门禁必须输出机器可读报告，进入 `artifacts/quality/`。

## Prompt 与模型治理标准

Prompt、schema、模型能力和 provider 配置必须被当成可版本化资产治理，不能散落在代码字符串里。

目录标准：

```text
host/resources/
  prompts/
    cut-analysis.v1.prompt.md
    qa-extraction.v1.prompt.md
    filler-detection.v1.prompt.md
    highlight-extraction.v1.prompt.md
    cover-copy.v1.prompt.md
  schemas/
    cut-analysis-result.schema.json
    qa-extraction-result.schema.json
    transcription-normalized.schema.json
  model-profiles/
    openai-compatible-default.json
```

治理规则：

- 每个 prompt 必须声明 `promptId`、`version`、`purpose`、`inputSchemaId`、`outputSchemaId`。
- prompt 不直接包含 API key、baseUrl 或 provider 私有参数。
- prompt 变更必须有 snapshot test，至少验证 mock provider 输出可通过 schema。
- 模型选择不写死到业务 use case，必须来自 `ModelProfileRegistry`。
- provider capability 必须声明是否支持 JSON Schema、JSON object、audio transcription、multipart upload、timestamp granularity、usage reporting。
- 对 OpenAI-compatible chat adapter，必须支持 timeout、retry budget、rate-limit backoff、schema invalid retry、usage capture、redaction。
- 对 OpenAI-compatible transcription adapter，必须支持 multipart upload、language hint、response format mapping、timestamp granularity mapping 和 provider unsupported fallback。
- 所有模型输出必须保存为 `analysis/raw-provider-output.redacted.json` 或只保存 hash；默认不落完整 prompt 和完整原始响应，防止隐私泄露。

## Provider Registry 标准

所有 adapter 必须通过 registry 装配，不允许 use case 直接 new adapter。

```text
ProviderRegistry
  -> ProviderDescriptor[]
  -> capability discovery
  -> health check
  -> configuration schema
  -> adapter factory
```

`ProviderDescriptor` 必须包含：

- `providerId`
- `providerKind`
- `adapterVersion`
- `displayName`
- `capabilities`
- `configurationSchemaId`
- `healthStatus`
- `license`
- `runtimeRequirements`
- `supportedDeploymentModes`

Registry 规则：

- 同一 `ProviderKind` 可有多个 adapter，但 use case 只能依赖 port。
- 默认 adapter 由 runtime config 选择。
- capability 不满足时返回 `CAPABILITY_UNSUPPORTED`，不能运行到一半才失败。
- fake adapter 必须和真实 adapter 实现同一 port，用于 contract test 和 UI dev。

## 前端架构标准

前端是工作台，不是业务内核。

前端分层：

```text
pages
  -> feature components
  -> feature store/view model
  -> sdkwork-video-cut-core client facade
  -> canonical HTTP API
```

前端规则：

- `pages` 和 `components` 不直接拼 API URL。
- `feature` 不知道 deployment mode，只知道 runtime baseUrl 和 capability。
- 所有 task mutation 必须走 `videoCutTaskService`。
- 所有下载/open-folder 行为必须走 `platform` adapter。
- 前端不解析 FFmpeg stderr、不解析 provider 原始响应、不修复 plan 业务规则。
- UI 展示的能力开关来自 `/capabilities`，不能根据本地环境猜测。
- 大文件上传必须支持进度、取消、大小限制提示和失败恢复提示。
- 预览播放器只读取标准 artifact 或 source preview URL，不直接访问任意本地路径。

建议前端技术：

- 状态：小规模先用 React state/context；任务复杂后引入 Zustand。
- 服务端状态：如果轮询/SSE 状态复杂，引入 TanStack Query。
- 表单：配置页可使用 react-hook-form + schema resolver。
- 播放器：HTML5 video 为主；后续需要逐帧/波形再引入专用组件。
- 时间轴预览：MVP 使用片段列表 + subtitle preview，不做完整 NLE timeline。

## 预览与审阅标准

审阅不是非线编时间线，必须围绕 `plan.json`。

审阅能力：

- 片段保留/删除。
- 调整片段入点/出点。
- 调整字幕文本和高亮范围。
- 调整封面标题/核心观点。
- 选择 BGM/SFX。
- 选择输出模板。

审阅规则：

- 用户调整必须写入 `PlanOverride`，不能直接覆盖 AI/规则原始轨道。
- 每次保存计划生成新的 `planRevision`。
- 渲染必须绑定具体 `planRevision`。
- 预览播放可低清代理，最终渲染必须重新从 source + plan 生成。
- 前端只展示 `cutDecisionTrack` 的解释，不重新计算切分评分。

## 扩展机制标准

第一版不做第三方插件市场，但内部扩展点必须标准化。

扩展点：

- provider adapter：LLM、STT、VAD、scene、subject、render、storage。
- preset：输出规格、字幕样式、封面样式、BGM/SFX。
- quality profile：basic/standard/interview/pro/batch。
- deployment profile：desktop/server/container/k8s。

扩展包 manifest：

```json
{
  "id": "sdkwork-video-cut-provider-example",
  "version": "0.1.0",
  "kind": "provider-adapter",
  "providerKinds": ["SpeechToText"],
  "entry": "builtin-or-dynamic",
  "license": "Apache-2.0",
  "capabilitySchemaId": "video-cut.provider-capability.v1",
  "configurationSchemaId": "video-cut.provider-config.v1"
}
```

MVP 只允许 built-in adapter，不加载任意动态代码。后续如支持插件，必须先实现签名、权限、沙箱和 License gate。

## 性能与资源标准

视频剪辑是 CPU/GPU/IO 密集任务，必须有明确资源预算。

默认预算：

- desktop-local 默认并发渲染 `1`。
- server-private 默认并发由 `SDKWORK_VIDEO_CUT_WORKER_CONCURRENCY` 控制。
- 单任务临时目录必须有磁盘空间预检。
- 长视频分析必须分 stage 写入中间产物，避免内存持有完整媒体。
- FFmpeg 线程数可配置，默认不抢占整机。
- 大文件上传和下载使用 streaming，不一次性读入内存。
- 生成字幕、plan、分析结果等 JSON 文件必须有大小上限。

性能指标：

- `probe_duration_ms`
- `audio_extract_duration_ms`
- `transcription_duration_ms`
- `analysis_duration_ms`
- `plan_build_duration_ms`
- `render_duration_ms`
- `render_realtime_factor`
- `artifact_size_bytes`
- `queue_wait_duration_ms`

## 兼容性标准

平台兼容范围：

- Windows 10/11 x64：desktop-local 第一优先级。
- macOS Apple Silicon/x64：第二优先级。
- Linux x64：server/container/k8s 第一优先级。

媒体兼容范围：

- 输入 MVP：MP4/MOV，H.264/H.265，AAC/PCM 常见音频。
- 输出 MVP：MP4，H.264，AAC，1080x1920，30fps。
- 字幕内部：ASS。
- 字幕导入/导出：SRT/VTT 可选。

兼容性规则：

- 不支持的输入必须在 probe 阶段失败，不能等到 render。
- H.265 输入可解码但输出统一 H.264。
- 变量帧率输入必须规范化到 30fps 输出。
- 缺字体时必须 fallback 到内置或系统字体，并记录 warning。
- 缺 BGM/SFX 时不阻塞主视频输出，记录 capability 降级。

## 目录结构

项目根目录使用当前路径：

```text
apps/sdkwork-video-cut/
```

建议结构：

```text
apps/sdkwork-video-cut/
  ARCHITECT.md
  README.md
  package.json
  pnpm-workspace.yaml
  tsconfig.json
  vite.config.ts

  src/
    main.tsx
    App.tsx
    shell/
      AppShell.tsx
      routes.tsx
    pages/
      HomePage.tsx
      TaskDetailPage.tsx
      SettingsPage.tsx

  src-tauri/
    tauri.conf.json
    Cargo.toml
    src/
      main.rs
      local_host.rs
      process_supervisor.rs

  packages/
    sdkwork-video-cut-host-types/
      package.json
      src/
        index.ts
        api.types.ts
        task.types.ts
        render.types.ts
        capability.types.ts

    sdkwork-video-cut-types/
      package.json
      src/
        index.ts
        video-cut.types.ts
        analysis.types.ts
        transcript.types.ts
        subtitle.types.ts
        preset.types.ts

    sdkwork-video-cut-core/
      package.json
      src/
        client/
        platform/
        runtime/
        storage/

    sdkwork-video-cut-commons/
      package.json
      src/
        components/
        utils/

    sdkwork-video-cut-feature/
      package.json
      src/
        index.ts
        pages/
          VideoCutPage.tsx
        components/
          SourceImportPanel.tsx
          CutTypeSelector.tsx
          AnalysisProgress.tsx
          CutPlanReview.tsx
          SubtitleReviewPanel.tsx
          RenderQueuePanel.tsx
          ArtifactDownloadPanel.tsx
        services/
          videoCutTaskService.ts
          videoCutLocalClient.ts
        store/
          videoCutStore.ts
        domain/
          presetLabels.ts
          planPresentation.ts

  host/
    Cargo.toml
    resources/
      prompts/
      schemas/
      model-profiles/
    src/
      main.rs
      app_state.rs
      error.rs
      contracts/
        openapi.rs
        schema_registry.rs
      application/
        create_task.rs
        import_source.rs
        analyze_task.rs
        build_plan.rs
        render_task.rs
        cancel_task.rs
      ports/
        llm.rs
        speech_to_text.rs
        media_probe.rs
        media_render.rs
        storage.rs
        telemetry.rs
        command_runner.rs
      adapters/
        openai_compatible/
        ffmpeg/
        filesystem/
        sqlite/
        onnx/
      infrastructure/
        config.rs
        secrets.rs
        telemetry.rs
        runtime.rs
      routes/
        mod.rs
        health.rs
        capabilities.rs
        settings.rs
        video_cut.rs
      services/
        mod.rs
        video_cut_task_service.rs
        media_probe_service.rs
        media_extract_service.rs
        silence_detect_service.rs
        transcript_service.rs
        text_analysis_service.rs
        cut_plan_service.rs
        subtitle_service.rs
        cover_service.rs
        render_service.rs
        artifact_service.rs
        local_settings_service.rs
      providers/
        mod.rs
        ai_provider.rs
        whisper_provider.rs
        openai_compatible_provider.rs
        no_ai_provider.rs
      media/
        ffmpeg.rs
        ffprobe.rs
        filter_graph.rs
      storage/
        app_storage.rs
        task_repository.rs
        artifact_repository.rs
        asset_repository.rs
      domain/
        task.rs
        transcript.rs
        cut_plan.rs
        render.rs
        capability.rs

  deploy/
    docker/
      README.md
      Dockerfile
      docker-compose.yml
      docker-compose.nvidia-cuda.yml
      docker-compose.amd-rocm.yml
      .env.example
    kubernetes/
      Chart.yaml
      values.yaml
      values.release.yaml
      templates/

  scripts/
    run-video-cut-dev-stack.mjs
    run-video-cut-desktop-command.mjs
    run-video-cut-web-command.mjs
    run-video-cut-server-command.mjs
    show-video-cut-deployment-env.mjs
    run-video-cut-deployment-doctor.mjs
    release/
      local-release-command.mjs
      package-release-assets.mjs
      smoke-desktop-startup.mjs
      smoke-server-health.mjs
      smoke-container-compose.mjs
      smoke-kubernetes-chart.mjs
      smoke-media-render.mjs
```

## 包边界

### `src/`

应用 shell。只负责装配路由、全局布局、运行时初始化。

禁止：

- 放置视频剪辑业务规则。
- 直接调用本地工具。
- 直接访问复杂本地存储。

### `src-tauri/`

桌面 shell。负责窗口、应用生命周期、本地 host 进程监督、系统对话框、打开文件夹等桌面能力。

禁止：

- 实现剪辑、AI 分析、渲染、任务持久化等产品业务。
- 通过 Tauri command 绕过 canonical HTTP API 实现第二套业务入口。

### `host/`

唯一业务能力内核。所有真实业务能力都在这里：

- Canonical HTTP API
- 运行时持久化
- FFmpeg/ffprobe
- AI provider
- 剪辑计划
- 渲染队列
- artifact 管理

### `packages/sdkwork-video-cut-types`

共享领域类型。前端和 host 的传输结构要与这里保持语义一致。

### `packages/sdkwork-video-cut-host-types`

Canonical HTTP API envelope、request、response、capability、task transport 类型。

### `packages/sdkwork-video-cut-core`

运行时、HTTP client、平台能力抽象、连接 canonical host API 的 facade。它只解析 runtime baseUrl，不包含部署模式业务分支。

### `packages/sdkwork-video-cut-feature`

视频剪辑产品 UI 和前端状态。只调用 `core` 暴露的 canonical API facade。

## 标准接口体系

项目采用高内聚、低耦合的端口适配器架构。所有可替换能力都必须封装成标准接口，不允许业务 use case 直接依赖具体工具、模型、命令行参数、第三方 DTO 或 provider 私有字段。

固定分层：

```text
UseCase
  -> Port trait/interface
  -> Provider registry
  -> Adapter implementation
  -> External tool/model/local file/http endpoint
```

核心规则：

- 业务层只依赖 port。
- adapter 只负责把外部能力映射到标准领域模型。
- provider 私有 request/response 不能越过 adapter 边界。
- 所有 provider 都必须暴露 capability、health、configuration schema、diagnostics。
- 所有跨层数据都必须使用 `sdkwork-video-cut-types` 或 `sdkwork-video-cut-host-types` 中的标准模型。
- 所有长任务都必须支持 progress event、cancel token、log path 和 deterministic task state。
- 所有接口都要有 fake adapter 和 conformance test，保证可替换性。

### 必须接口化的能力清单

只要能力会接触外部系统、外部工具、外部模型、宿主环境或可替换实现，就必须先定义 port，再实现 adapter。

AI 与文本能力：

- `LargeLanguageModelPort`：结构化文本分析、问答识别、废话/广告识别、封面文案。
- `SpeechToTextPort`：音频转写、句子/词级时间戳、可选说话人标注。
- `TextNormalizationPort`：中英文标点、繁简转换、口语断句、字幕文本清洗。
- `KeywordHighlightPort`：字幕高亮词和范围生成，可由规则或 LLM adapter 实现。

媒体能力：

- `MediaProbePort`：封装 ffprobe，输出标准 `MediaInfo`。
- `AudioExtractPort`：封装音频抽取和采样率转换。
- `AudioBoundaryDetectorPort`：静音、停顿、咳嗽候选区间检测。
- `SpeechActivityDetectorPort`：VAD 人声区间检测。
- `SceneDetectorPort`：镜头切换检测。
- `SubjectTrackingPort`：人脸、上半身、主体跟踪。
- `AudioEnhancementPort`：loudnorm、降噪、去混响、音量平衡。
- `SubtitlePlannerPort`：字幕切句、样式、时间轴规划。
- `SubtitleRendererPort`：ASS/SRT/VTT 生成与字幕烧录输入。
- `MediaRenderPort`：FFmpeg 渲染执行。
- `CoverRenderPort`：封面图生成。

基础设施能力：

- `RuntimeConfigPort`：读取、合并、校验运行时配置。
- `SecretStorePort`：读取 API key/token，屏蔽 env、本地安全凭据、K8s Secret 差异。
- `ToolLocatorPort`：发现 FFmpeg、ffprobe、ONNX Runtime、模型文件。
- `CommandRunnerPort`：统一执行外部命令，禁止业务层直接调用 shell。
- `TaskRepositoryPort`：任务状态持久化。
- `ArtifactRepositoryPort`：产物保存、下载路径解析、保留策略。
- `ModelAssetRepositoryPort`：本地模型、ONNX 文件、字幕字体、BGM/SFX 资产管理。
- `ProgressEventSinkPort`：SSE、轮询、内存事件总线的标准出口。
- `ClockPort`、`IdGeneratorPort`：时间和 ID 生成，保证测试可控。

`CommandRunnerPort` 必须使用 argv 数组执行命令，不拼接 shell 字符串。所有命令 stdout/stderr 进入受控日志文件，日志进入 artifact 前必须脱敏。

### 通用 Provider 契约

Rust host 中所有 provider 都遵循统一能力契约：

```rust
pub trait VideoCutProvider {
    fn provider_id(&self) -> &'static str;
    fn provider_kind(&self) -> ProviderKind;
    fn inspect_capability(&self) -> ProviderCapability;
    fn health_check(&self) -> ProviderHealth;
    fn configuration_schema(&self) -> ProviderConfigurationSchema;
}

pub enum ProviderKind {
    LargeLanguageModel,
    SpeechToText,
    Subtitle,
    MediaProbe,
    MediaRender,
    AudioBoundary,
    SpeechActivity,
    SceneDetection,
    SubjectTracking,
    AudioEnhancement,
    VideoStabilization,
    CoverRender,
    TextNormalization,
    KeywordHighlight,
    ToolLocator,
    CommandRunner,
    RuntimeConfig,
    SecretStore,
    Telemetry,
    ModelAssetRepository,
    ArtifactStorage,
}
```

统一返回结构：

```rust
pub struct ProviderResult<T> {
    pub data: T,
    pub diagnostics: ProviderDiagnostics,
    pub usage: Option<ProviderUsage>,
}

pub struct ProviderDiagnostics {
    pub provider_id: String,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub log_path: Option<String>,
    pub warnings: Vec<String>,
}
```

错误必须统一映射到 `VideoCutError`，不能把第三方错误原样抛给 use case。

### 大模型标准接口

大模型只负责结构化推理，不负责直接修改任务、写文件或执行渲染。

```rust
pub trait LargeLanguageModelPort: VideoCutProvider {
    fn generate_structured<T>(
        &self,
        request: StructuredGenerationRequest,
        schema: JsonSchema,
        cancel: CancellationToken,
    ) -> Result<ProviderResult<T>, VideoCutError>
    where
        T: serde::de::DeserializeOwned;
}
```

标准输入：

```ts
export interface StructuredGenerationRequest {
  taskId: string;
  purpose:
    | 'cutAnalysis'
    | 'qaExtraction'
    | 'fillerDetection'
    | 'highlightExtraction'
    | 'coverCopy'
    | 'longInterviewScoring';
  model: string;
  systemPrompt: string;
  userPayload: unknown;
  temperature: number;
  maxOutputTokens?: number;
  responseSchemaId: string;
}
```

标准输出要求：

- 必须是 JSON。
- 必须通过 schema 校验。
- 不允许返回 markdown 包裹的 JSON。
- 不允许返回自然语言解释作为业务结果。
- 不允许直接返回 provider 原始响应。

OpenAI-compatible adapter 只是 `LargeLanguageModelPort` 的一个实现：

```text
OpenAICompatibleLlmAdapter
  -> POST /v1/chat/completions
  -> response_format json_schema 或 json_object
  -> parse
  -> schema validate
  -> ProviderResult<T>
```

### 语音转文字标准接口

语音转文字接口不绑定 OpenAI、不绑定 Whisper。OpenAI-compatible transcription 和本地 Whisper 都必须实现同一个 port。

```rust
pub trait SpeechToTextPort: VideoCutProvider {
    fn transcribe(
        &self,
        request: TranscriptionRequest,
        cancel: CancellationToken,
    ) -> Result<ProviderResult<Transcript>, VideoCutError>;
}
```

标准输入：

```ts
export interface TranscriptionRequest {
  taskId: string;
  audioPath: string;
  language?: 'zh-CN' | 'en-US' | 'auto';
  outputGranularity: Array<'segment' | 'word'>;
  preferPunctuation: boolean;
  diarizationMode: 'none' | 'provider' | 'external';
}
```

标准输出：

```ts
export interface Transcript {
  language: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  speakers?: SpeakerTurn[];
  source: {
    providerId: string;
    model?: string;
    granularity: Array<'segment' | 'word'>;
  };
}

export interface TranscriptSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  words?: TranscriptWord[];
  confidence?: number;
}
```

use case 只能消费 `Transcript`，不能知道它来自 `/v1/audio/transcriptions`、whisper.cpp 或其他实现。

### 字幕标准接口

字幕拆成三个标准能力：字幕规划、字幕样式、字幕渲染。

```rust
pub trait SubtitlePlannerPort {
    fn plan_subtitles(
        &self,
        transcript: &Transcript,
        highlights: &[VideoCutHighlight],
        profile: SubtitleProfile,
    ) -> Result<SubtitleDocument, VideoCutError>;
}

pub trait SubtitleRendererPort: VideoCutProvider {
    fn render_subtitle_file(
        &self,
        request: SubtitleRenderRequest,
    ) -> Result<ProviderResult<SubtitleArtifact>, VideoCutError>;
}
```

标准模型：

```ts
export interface SubtitleDocument {
  id: string;
  language: string;
  cues: VideoCutSubtitleCue[];
  style: SubtitleStyleProfile;
}

export interface SubtitleStyleProfile {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  shadowOpacity: number;
  shadowBlurRatio: number;
  safeArea: SubtitleSafeArea;
}
```

MVP adapter：

```text
AssSubtitleRenderer
  -> SubtitleDocument
  -> .ass file
  -> FFmpeg subtitles filter
```

SRT/VTT 只能作为导出或导入格式，不能作为内部字幕主模型。

### 视频切分标准接口

切分由多个小 port 组成，避免形成一个巨大服务。

```rust
pub trait AudioBoundaryDetectorPort: VideoCutProvider {
    fn detect_audio_boundaries(
        &self,
        request: AudioBoundaryRequest,
    ) -> Result<ProviderResult<AudioBoundaryTrack>, VideoCutError>;
}

pub trait SpeechActivityDetectorPort: VideoCutProvider {
    fn detect_speech_activity(
        &self,
        request: SpeechActivityRequest,
    ) -> Result<ProviderResult<SpeechActivityTrack>, VideoCutError>;
}

pub trait SceneDetectorPort: VideoCutProvider {
    fn detect_scenes(
        &self,
        request: SceneDetectionRequest,
    ) -> Result<ProviderResult<SceneTrack>, VideoCutError>;
}

pub trait SplitPlannerPort {
    fn build_split_plan(
        &self,
        request: SplitPlanRequest,
    ) -> Result<VideoSplitPlan, VideoCutError>;
}
```

MVP adapters：

- `FfmpegSilenceDetectorAdapter`
- `SileroVadOnnxAdapter`
- `RuleBasedSplitPlanner`
- `OpenAICompatibleSemanticAnalyzer`

第二阶段 adapters：

- `PySceneDetectAdapter`
- `MediaPipeSubjectTrackerAdapter`
- `WhisperXWordTimestampAdapter`
- `PyannoteSpeakerDiarizationAdapter`

### 渲染标准接口

渲染只消费 `VideoSplitPlan` 和 `RenderRequest`，不能重新推导业务切分结果。

```rust
pub trait MediaRenderPort: VideoCutProvider {
    fn render(
        &self,
        request: RenderRequest,
        cancel: CancellationToken,
        progress: ProgressSink,
    ) -> Result<ProviderResult<RenderArtifactSet>, VideoCutError>;
}
```

MVP adapter：

```text
FfmpegRenderAdapter
  -> VideoSplitPlan
  -> filter graph
  -> output.mp4
  -> subtitles.ass
  -> render.log
```

规则：

- 渲染 adapter 不调用大模型。
- 渲染 adapter 不修改 `split_plan.json`。
- 渲染 adapter 不直接读取 UI 状态。
- 所有 FFmpeg 参数由 `RenderGraphBuilder` 从标准模型生成。

### 存储和 Artifact 标准接口

```rust
pub trait TaskRepositoryPort {
    fn create(&self, task: VideoCutTask) -> Result<VideoCutTask, VideoCutError>;
    fn read(&self, task_id: &str) -> Result<VideoCutTask, VideoCutError>;
    fn update(&self, task: VideoCutTask) -> Result<VideoCutTask, VideoCutError>;
    fn list(&self, query: TaskListQuery) -> Result<TaskPage, VideoCutError>;
}

pub trait ArtifactRepositoryPort {
    fn save_artifact(&self, artifact: ArtifactWriteRequest) -> Result<VideoCutArtifact, VideoCutError>;
    fn list_artifacts(&self, task_id: &str) -> Result<Vec<VideoCutArtifact>, VideoCutError>;
    fn resolve_download_path(&self, artifact_id: &str) -> Result<PathBuf, VideoCutError>;
}
```

第一版实现 `FileSystemTaskRepository` 和 `FileSystemArtifactRepository`。业务层不直接拼路径。

### 进度事件标准接口

所有长耗时能力必须发布标准事件：

```ts
export interface VideoCutProgressEvent {
  taskId: string;
  stage:
    | 'import'
    | 'probe'
    | 'extractAudio'
    | 'transcribe'
    | 'analyze'
    | 'plan'
    | 'render'
    | 'artifact';
  progress: number;
  message: string;
  diagnostics?: {
    providerId?: string;
    logPath?: string;
  };
}
```

前端只消费标准进度事件，不解析 FFmpeg stderr、模型响应或 provider 日志。

### 标准化完成标准

一个能力只有满足以下条件，才允许进入 use case：

- 有 port。
- 有至少一个 adapter。
- 有 capability discovery。
- 有 health check。
- 有 configuration schema。
- 有 fake adapter。
- 有 conformance test。
- 有错误码映射。
- 有日志脱敏规则。
- 有标准输入输出模型。

## Package 标准

私有 workspace 包使用 source-entry manifest：

```json
{
  "main": "./src/index.ts",
  "module": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "files": ["src", "dist", "README.md"]
}
```

TypeScript 包 `tsconfig.json`：

- 继承根 `tsconfig.json`
- 不重新定义 `baseUrl`
- 不重新定义 `paths`
- `noUnusedLocals: false`
- `noUnusedParameters: false`

禁止深度导入 sibling package 内部路径。

## HTTP API

产品 API 使用 `/api/video-cut/v1`，明确区别于 `spring-ai-plus-app-api` 和任何远程业务 API。`desktop-local` 只是把同一套 API 绑定到本机 loopback，不改变路径。

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
```

API response 使用统一 envelope：

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
}
```

## 能力发现

所有部署模式启动后都必须先做 capability discovery；单机桌面、server、container、k8s 只是在 capability 的工具路径、存储和 secret 来源上不同。

```ts
export interface VideoCutCapabilities {
  media: {
    ffmpegAvailable: boolean;
    ffprobeAvailable: boolean;
    videoRenderSupported: boolean;
    audioEnhanceSupported: boolean;
    subtitleBurnSupported: boolean;
    batchRenderSupported: boolean;
    reason?: string;
  };
  ai: {
    transcriptionSupported: boolean;
    textAnalysisSupported: boolean;
    coverCopySupported: boolean;
    provider: 'openaiCompatible' | 'localWhisper' | 'none';
    reason?: string;
  };
  storage: {
    workspaceRoot: string;
    writable: boolean;
    reason?: string;
  };
}
```

无 AI 时降级规则：

- 单人口播：可执行媒体探测、静音检测、固定裁切、手动字幕导入和渲染。
- 访谈视频：没有文本分析 provider 时不自动问答切分。
- 长访谈拆条：没有转写和文本分析 provider 时不可用。

## 核心领域模型

```ts
export type VideoCutType = 'singleSpeaker' | 'interview' | 'longInterview';

export type VideoCutTaskStatus =
  | 'draft'
  | 'sourceReady'
  | 'analyzing'
  | 'planReady'
  | 'rendering'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface VideoCutTask {
  id: string;
  name: string;
  type: VideoCutType;
  status: VideoCutTaskStatus;
  source?: VideoCutSource;
  planId?: string;
  progress: VideoCutProgress;
  createdAt: string;
  updatedAt: string;
  error?: VideoCutError;
}

export interface VideoCutSource {
  fileName: string;
  originalPath: string;
  managedPath: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  hasAudio?: boolean;
}

export interface VideoCutPlan {
  id: string;
  taskId: string;
  type: VideoCutType;
  output: VideoCutOutputProfile;
  segments: VideoCutSegment[];
  subtitles: VideoCutSubtitleCue[];
  highlights: VideoCutHighlight[];
  audio: VideoCutAudioPlan;
  cover: VideoCutCoverPlan;
  render: VideoCutRenderPlan;
}

export interface VideoCutOutputProfile {
  width: 1080;
  height: 1920;
  aspectRatio: '9:16';
  frameRate: 30;
  format: 'mp4';
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
}

export interface VideoCutSegment {
  id: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  outputStartSeconds: number;
  reason: string;
  confidence: number;
}

export interface VideoCutSubtitleCue {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  highlightRanges?: VideoCutSubtitleHighlightRange[];
}
```

## OpenAI-compatible AI Provider

Rust host 内只定义标准 port 和 provider adapter。产品不接入 `spring-ai-plus-ai-api`，也不接入 `spring-ai-plus-app-api`；AI 调用只通过用户配置的 OpenAI-compatible endpoint 执行。

```rust
pub struct OpenAICompatibleLlmAdapter;
pub struct OpenAICompatibleSpeechToTextAdapter;

impl VideoCutProvider for OpenAICompatibleLlmAdapter {}
impl LargeLanguageModelPort for OpenAICompatibleLlmAdapter {}

impl VideoCutProvider for OpenAICompatibleSpeechToTextAdapter {}
impl SpeechToTextPort for OpenAICompatibleSpeechToTextAdapter {}
```

第一版 provider：

- `OpenAICompatibleLlmAdapter`：实现 `LargeLanguageModelPort`，通过 OpenAI-compatible API 标准调用结构化文本分析能力。
- `OpenAICompatibleSpeechToTextAdapter`：实现 `SpeechToTextPort`，通过 OpenAI-compatible API 标准调用音频转写能力。
- `LocalWhisperSpeechToTextAdapter`：可选离线 fallback，调用本机 `whisper.cpp` 或 `faster-whisper`，仅负责转写，不负责语义分析。
- `NoAiProvider`：无 AI 降级，不做自动问答拆条。

Provider 配置通过 `RuntimeConfigPort` 和 `SecretStorePort` 读取。desktop-local 可以写入本地 settings 和系统安全凭据；server/container/k8s 必须使用 env/Secret/ConfigMap，不写死路径。

系统内置 OpenAI-compatible adapters 对接的最小接口：

```http
POST {baseUrl}/v1/chat/completions
POST {baseUrl}/v1/audio/transcriptions
```

`/v1/chat/completions` 用于：

- 问答识别
- 废话/广告识别
- 重复语义识别
- 高亮词生成
- 封面问题和核心观点生成
- 长访谈片段评分

`/v1/audio/transcriptions` 用于：

- 音频转写
- 句子级时间戳
- 可选词级时间戳
- 可选说话人标注

Provider 配置：

```ts
export interface OpenAICompatibleProviderSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  transcriptionModel?: string;
  timeoutSeconds: number;
  supportsStructuredOutputs: boolean;
  supportsJsonObjectMode: boolean;
  supportsAudioTranscriptions: boolean;
  supportsVerboseTranscriptionJson: boolean;
  supportsDiarizedTranscriptionJson: boolean;
}
```

结构化输出策略：

- 优先使用 `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`。
- 如果目标 provider 不支持 JSON Schema structured outputs，则降级为 `response_format: { type: "json_object" }`。
- 降级后必须在 Rust host 内做 JSON Schema 校验和最多一次重试。
- 如果仍无法得到合法结构化结果，任务进入 `failed`，错误码为 `OPENAI_COMPATIBLE_STRUCTURED_OUTPUT_INVALID`。

转写策略：

- 优先调用 OpenAI-compatible `/v1/audio/transcriptions`。
- 如果 provider 不支持音频转写，但本机配置了 `LocalWhisperSpeechToTextAdapter`，可以降级到本地 Whisper。
- 如果两者都不可用，则单人口播只能执行静音检测和手动字幕导入，访谈/长访谈自动拆条不可用。

禁止：

- 不增加 `OllamaProvider`。
- 不调用 Ollama 专有 API。
- 不调用 llama.cpp 专有 API。
- 不把任意 provider 的私有字段泄漏到业务模型。
- 不把 API key 写入任务、日志或 artifact。

## 媒体处理

媒体处理由 Rust host 统一执行：

1. `ffprobe` 读取媒体信息。
2. `ffmpeg` 抽取音频。
3. 静音检测生成候选删除区间。
4. OpenAI-compatible transcription 或 `LocalWhisperSpeechToTextAdapter` 生成 transcript。
5. OpenAI-compatible 文本分析生成保留片段、问答结构、高亮词和封面文案。
6. `cut_plan_service` 合并规则，生成可审阅计划。
7. `render_service` 构建 FFmpeg filter graph。
8. 输出 MP4、SRT、cover、render log。

渲染能力：

- scale/crop 到 1080x1920。
- 使用 trim/concat/select 删除片段。
- 使用 loudnorm/afftdn 做基础音频增强。
- 使用 drawtext 或 subtitles 烧录字幕。
- 使用 amix 混合原声、20% BGM 和提示音。
- 使用 libx264/aac 输出 MP4。

阶段性处理：

- MVP 的画面稳定使用轻微缩放和居中裁切。
- 真正人脸/上半身跟踪和 vidstab 作为后续能力，通过 capability 暴露支持状态。

## 视频切分开源技术方案

视频切分不是简单按固定时间裁剪，而是把音频、人声、字幕、语义、问答、场景和渲染约束融合成一个可审阅的 `split_plan.json`。

### 推荐依赖

MVP 必需：

- FFmpeg / ffprobe：媒体探测、抽音频、裁切、拼接、混音、字幕烧录、MP4 输出。
- FFmpeg `silencedetect`：快速检测静音区间。
- Silero VAD ONNX：检测真实人声区间，避免单纯分贝阈值误判环境噪声。
- ONNX Runtime：在 Rust host 中执行 Silero VAD ONNX 推理。
- OpenAI-compatible `/v1/audio/transcriptions`：优先用于转写和句子时间戳。
- OpenAI-compatible `/v1/chat/completions`：用于结构化语义分析。
- ASS subtitle + libass/FFmpeg subtitles filter：烧录高质量字幕、阴影和高亮。

MVP 可选 fallback：

- whisper.cpp / faster-whisper：当 OpenAI-compatible provider 不支持音频转写时，作为本地转写 fallback。

第二阶段：

- PySceneDetect：检测镜头切换，避免切点落在镜头变化中间。
- MediaPipe Face Detector / Pose Landmarker：做人脸和上半身定位，用于竖屏裁切。
- FFmpeg `vidstabdetect` / `vidstabtransform` 或 OpenCV videostab：真实画面稳定。
- WhisperX：需要词级时间戳时启用。
- pyannote.audio：需要说话人分离时启用。

禁止：

- 不引入 Ollama 专有 provider。
- 不引入 llama.cpp 专有 provider。
- 不把任意模型厂商的专有 API 作为产品业务契约。
- 不默认引入 AGPL 依赖到核心渲染链路。

### 切分流水线

```text
source video
  -> ffprobe media info
  -> ffmpeg extract 16k mono wav
  -> FFmpeg silencedetect
  -> Silero VAD speech ranges
  -> OpenAI-compatible transcription 或 LocalWhisper fallback
  -> sentence timeline
  -> optional scene detection
  -> OpenAI-compatible semantic analysis
  -> candidate cut scoring
  -> split_plan.json
  -> user review
  -> FFmpeg trim/atrim/concat/render
  -> output.mp4 + subtitles.ass + cover.png + render.log
```

### 切分计划

`split_plan.json` 是渲染前的唯一切分事实来源：

```ts
export interface VideoSplitPlan {
  taskId: string;
  sourcePath: string;
  outputProfile: VideoCutOutputProfile;
  tracks: {
    speech: SpeechRange[];
    silence: SilenceRange[];
    transcript: TranscriptSegment[];
    scenes?: SceneRange[];
    speakers?: SpeakerTurn[];
  };
  cuts: VideoCutSegment[];
  rejectedRanges: RejectedRange[];
  subtitles: VideoCutSubtitleCue[];
  renderOptions: VideoCutRenderPlan;
}

export interface VideoCutSegment {
  id: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  outputStartSeconds: number;
  boundarySource: Array<'vad' | 'silence' | 'sentence' | 'scene' | 'speaker' | 'semantic' | 'manual'>;
  reason: string;
  confidence: number;
}
```

### 切点融合规则

候选切点评分使用可解释规则，不在第一版训练模型：

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
- 不生成小于最小时长的片段。
- 单人口播输出不超过 90 秒。
- 长访谈拆条单条必须在 60-180 秒之间。
- 切点前后保留 120-180ms breathing room。
- 语义边界和静音边界冲突时，优先选择最近的静音或句子边界。

### OpenAI-compatible 分析输出

语义分析必须输出结构化 JSON：

```ts
export interface OpenAICompatibleCutAnalysisResult {
  keepSegments: SemanticSegment[];
  removeRanges: SemanticRejectedRange[];
  qaPairs: QaSplit[];
  highlights: VideoCutHighlight[];
  cover: VideoCutCoverPlan;
  warnings: string[];
}
```

使用场景：

- 单人口播：识别重复句、废话、重点高亮和封面文案。
- 访谈视频：识别问题、回答、无效内容和可单独发布的问答段。
- 长访谈拆条：识别 60-180 秒高价值片段，给出标题、核心观点和评分。

Rust host 负责校验返回 JSON：

- 时间范围必须在 source duration 内。
- `startSeconds < endSeconds`。
- 不允许重叠输出片段。
- 不允许生成空 plan。
- 不允许 provider 返回的模型私有字段进入 `split_plan.json`。

## 本地存储

desktop-local 默认工作目录按平台选择，Windows 示例：

```text
%APPDATA%/sdkwork-video-cut/
```

结构：

```text
sdkwork-video-cut/
  config/
    settings.json
  tools/
    ffmpeg/
    models/
  projects/
    {projectId}/
      project.json
      tasks/
        {taskId}/
          task.json
          source/
            input.mp4
          analysis/
            media-info.json
            transcript.json
            silence-ranges.json
            ai-analysis.json
          plan/
            plan.json
          renders/
            {renderId}/
              render.json
              output.mp4
              cover.png
              subtitles.srt
              render.log
```

第一版不引入数据库，不做 schema migration。

server/container/k8s 部署默认目录：

```text
/data/sdkwork-video-cut/
  config/
  projects/
  artifacts/
  cache/
  temp/
```

部署差异必须封装在 `ArtifactRepositoryPort`、`TaskRepositoryPort`、`RuntimeConfigPort` 和 `SecretStorePort` 中。业务层不关心数据来自 `%APPDATA%`、`/data`、PVC 还是后续的 S3-compatible object storage。

## 前端体验

第一屏就是工作台，不做营销页。

页面结构：

- 顶部：任务类型选择、capability 状态、设置入口。
- 左侧：源视频、输出参数、模型和工具配置状态。
- 中间：分析进度、剪辑计划、字幕预览、片段列表。
- 右侧：封面文案、渲染队列、artifact 下载。

主要页面：

- `HomePage`：任务列表和新建任务。
- `TaskDetailPage`：导入、分析、审阅、渲染、下载。
- `SettingsPage`：FFmpeg、OpenAI-compatible provider、可选 Whisper fallback、输出目录、BGM、提示音配置。

## 任务状态机

```text
draft
  -> sourceReady
  -> analyzing
  -> planReady
  -> rendering
  -> succeeded

任意执行状态
  -> failed
  -> cancelled
```

状态必须持久化到 `task.json`。应用重启后可以恢复任务列表，并将未完成的 `analyzing/rendering` 标记为 interrupted 或 failed，附带日志路径。

## 错误码

核心错误码：

- `FFMPEG_NOT_FOUND`
- `FFPROBE_NOT_FOUND`
- `WHISPER_MODEL_NOT_FOUND`
- `OPENAI_COMPATIBLE_PROVIDER_UNAVAILABLE`
- `OPENAI_COMPATIBLE_AUTH_FAILED`
- `OPENAI_COMPATIBLE_RATE_LIMITED`
- `OPENAI_COMPATIBLE_TIMEOUT`
- `OPENAI_COMPATIBLE_UNSUPPORTED_RESPONSE_FORMAT`
- `OPENAI_COMPATIBLE_CHAT_FAILED`
- `OPENAI_COMPATIBLE_TRANSCRIPTION_FAILED`
- `OPENAI_COMPATIBLE_STRUCTURED_OUTPUT_INVALID`
- `PROVIDER_CAPABILITY_MISMATCH`
- `PROVIDER_HEALTH_CHECK_FAILED`
- `PROMPT_SCHEMA_NOT_FOUND`
- `PROMPT_SCHEMA_VERSION_MISMATCH`
- `SOURCE_VIDEO_UNSUPPORTED`
- `SOURCE_IMPORT_FAILED`
- `SOURCE_FILE_TOO_LARGE`
- `SOURCE_DURATION_TOO_LONG`
- `SOURCE_PATH_DENIED`
- `MEDIA_PROBE_FAILED`
- `AUDIO_EXTRACT_FAILED`
- `TRANSCRIPTION_FAILED`
- `TEXT_ANALYSIS_UNSUPPORTED`
- `TEXT_ANALYSIS_FAILED`
- `CUT_PLAN_EMPTY`
- `RENDER_FAILED`
- `OUTPUT_PATH_DENIED`
- `COMMAND_EXECUTION_DENIED`
- `COMMAND_EXIT_NON_ZERO`
- `SECRET_NOT_CONFIGURED`
- `CONFIG_SCHEMA_INVALID`
- `STORAGE_WRITE_FAILED`
- `ARTIFACT_HASH_MISMATCH`
- `CAPABILITY_UNSUPPORTED`

每个错误应包含：

- `code`
- `message`
- `actionHint`
- `logPath`

## MVP 范围

第一版实现闭环：

- Tauri 桌面壳启动 React 前端和本地 Rust host。
- 本地 capability discovery。
- 创建任务。
- 导入本地视频。
- 单人口播模式。
- FFmpeg/ffprobe 媒体探测。
- 抽取音频。
- 静音检测。
- OpenAI-compatible 音频转写；provider 不支持时才使用可选 LocalWhisper fallback。
- 生成逐句中文字幕。
- 生成基础剪辑计划。
- 9:16 1080x1920 裁切。
- BGM 20% 混音。
- 字幕烧录。
- 导出 MP4。
- artifact 列表、下载、打开输出目录。

MVP 暂不包含：

- 真实上半身检测。
- 精准去咳嗽。
- 高质量去混响。
- 长访谈智能爆点评分。
- 模型下载器。
- 内置 FFmpeg 安装包。
- 数据库。

## 后续阶段

第二阶段：

- 访谈问答切分。
- 长访谈 60-180 秒拆条。
- OpenAI-compatible 文本分析 provider。
- 自动封面文案。
- 提示音。
- 批量任务队列。

第三阶段：

- 人脸/人体检测裁切。
- 真实画面稳定。
- 去咳嗽和重复句增强。
- 去广告/废话增强。
- 模型管理器。
- 安装包内置 FFmpeg。
- 多模板包装样式。

## 验证

建议命令：

```bash
pnpm run typecheck
pnpm run test
pnpm run check:package-standards
pnpm run check:runtime-boundaries
pnpm run check:types-import-boundaries
pnpm run deployment:doctor
pnpm run deployment:doctor:server:private
cargo test --manifest-path host/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

媒体 smoke test：

```bash
pnpm run test:media-smoke
pnpm run release:smoke:server
pnpm run release:smoke:container
pnpm run release:smoke:kubernetes
```

验证标准：

- capability 能识别 FFmpeg/ffprobe/OpenAI-compatible provider/Whisper fallback 状态。
- 任务能从 `draft` 流转到 `succeeded`。
- 输出文件为 MP4。
- 输出分辨率为 1080x1920。
- 输出帧率为 30fps。
- 字幕时间合法且不重叠。
- BGM 音量为 20%。
- 缺失工具时返回明确错误和 action hint。
- desktop/server/container/k8s 都指向同一个 `/api/video-cut/v1` contract。
- deployment doctor 能暴露工具、存储、secret、OpenAI-compatible provider 和上传限制状态。
- container/k8s smoke 不要求真实 AI key，但必须能证明缺失 provider 时 capability 降级正确。

## 决策记录

- 选择 Tauri 桌面应用 + 本地 Rust host + React 工作台。
- 不依赖 ai-api 或 app-api。
- 不复用 MagicCut。
- 参考 Magic Studio 架构标准，但使用 `sdkwork-video-cut` 自己的 package 和 API 命名。
- `/api/video-cut/v1` 是所有部署模式的唯一业务入口；`/api/local/v1` 只允许作为桌面兼容 alias。
- Rust host 是唯一业务能力内核。
- 第一版用文件系统持久化，不引入数据库。
- 参考 BirdCoder 部署模式，支持 desktop、web、server、container、kubernetes release family。
- Docker/K8s 是 server 形态包装，不引入第二套后端。
- server/container/k8s 的 secret/config/storage 差异通过 port 和 runtime config 解决，前端保持 branch-free。
