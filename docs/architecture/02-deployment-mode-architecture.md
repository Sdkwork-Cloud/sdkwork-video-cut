# 02 Deployment Mode Architecture

日期：2026-04-26

## 目标

本标准确保不同部署模式共享同一业务内核、同一 API、同一领域语义，同时在启动、存储、secret、网络、安全、发布和 smoke 上各自完整。

## 部署模式矩阵

| Mode | Host topology | Client | Storage | Secret | 标准用途 |
| --- | --- | --- | --- | --- | --- |
| `desktop-local` | Tauri 启动本机 Rust host | Tauri WebView | App data 文件系统 | OS secure store | 个人单机、本地素材、本地渲染 |
| `desktop-private` | 远程 private Rust host | Tauri WebView | server 端 | server secret | 桌面客户端连接内网服务 |
| `web-private` | 远程 private Rust host | Browser | server 端 | server secret | 团队内网 Web 工作台 |
| `server-private` | 原生 Rust host | Browser/Tauri | 本地盘/挂载盘 | env/secure file | 单台私有服务器 |
| `container-private` | Docker image 运行 Rust host | Browser/Tauri | volume | env/compose secret | Docker Compose/私有云 |
| `kubernetes-private` | Helm chart 运行 Rust host | Browser/Tauri | PVC/S3-compatible | K8s Secret | 集群部署、集中运维 |

## 模式不变量

- API route 不变：`/api/video-cut/v1`。
- 任务状态机不变。
- artifact manifest 不变。
- provider port 不变。
- 前端 service layer 不变。
- 质量门禁不变，只是 smoke 环境不同。

## desktop-local 标准

运行方式：

- Tauri shell 启动本机 Rust host。
- host 绑定 `127.0.0.1` 和随机可用端口。
- 启动握手把 `apiBaseUrl` 注入前端。
- host crash 时 shell 负责重启或展示恢复提示。

存储：

```text
%APPDATA%/sdkwork-video-cut/
  config/
  projects/
  artifacts/
  cache/
  logs/
```

规则：

- 默认不需要 server token。
- OpenAI-compatible API key 存 OS secure store，不进 localStorage。
- 可访问本地文件选择器，但业务路径仍由 host 管理。
- 缺 FFmpeg/ffprobe 时 capability 降级，不伪造渲染能力。

## server-private 标准

运行方式：

- 单 Rust binary 服务 API 和 web assets。
- 可用 systemd、Windows service 或进程管理器托管。
- 默认绑定 `127.0.0.1`；绑定 `0.0.0.0` 必须配置 auth 和 CORS。

规则：

- 必须配置 `SDKWORK_VIDEO_CUT_WORKSPACE_ROOT` 和 `SDKWORK_VIDEO_CUT_ARTIFACT_ROOT`。
- 推荐启用 `single-user-token` 或 `reverse-proxy`。
- 直接暴露 Host API 时使用 `SDKWORK_VIDEO_CUT_AUTH_MODE=single-user-token` 和 `SDKWORK_VIDEO_CUT_SERVER_TOKEN`，浏览器 HTTP client、deployment doctor 和自动化脚本通过 `Authorization: Bearer <token>` 调用私有 API。
- 通过统一网关、Nginx、Ingress 或企业 SSO 暴露时使用 `SDKWORK_VIDEO_CUT_AUTH_MODE=reverse-proxy`，Host 只接受代理后的可信流量。
- 上传大小、任务并发、临时目录、CORS 必须显式配置。
- 不允许用 server 本地路径直接暴露 artifact，必须走 artifact repository。
- 浏览器预览、下载 `output.mp4`、`render.log` 等产物必须走 `/api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content`，不得依赖 server 文件系统路径。`server-private` / `web-private` 下媒体元素和下载动作必须先通过带鉴权的 Host client fetch，再转换为短生命周期 `blob:` URL，避免 `<video>`、`<img>` 或普通下载链接丢失 `Authorization` header。

## web-private 标准

运行方式：

- Browser 连接 private Rust host。
- runtime config 提供 `apiBaseUrl`。

规则：

- Web 前端不接触 API key、FFmpeg、文件系统。
- 文件上传必须 streaming，并支持取消和进度。
- CORS 白名单必须匹配实际 origin。
- 所有能力状态来自 `/capabilities`。

## container-private 标准

Docker image 内容：

- Rust host binary
- built web assets
- FFmpeg/ffprobe
- libass
- 基础字体
- healthcheck

目录：

```text
deploy/docker/
  Dockerfile
  docker-compose.yml
  docker-compose.nvidia-cuda.yml
  docker-compose.amd-rocm.yml
  .env.example
```

规则：

- 镜像默认非 root 用户运行。
- `/data` 挂载 workspace/artifacts/config。
- 默认使用标准 `SDKWORK_VIDEO_CUT_*` 环境变量，不再把新配置写入 legacy `VIDEO_CUT_*`。
- Compose 默认 `SDKWORK_VIDEO_CUT_AUTH_MODE=reverse-proxy`，Host 只作为 web proxy 的后端服务暴露。
- Compose 不得通过 `ports` 直接发布 Host 6177；Host 只能在 compose 内部网络 `expose` 给 web proxy。
- API key 只能来自 env/secret，不写入 image layer。
- CUDA/ROCm overlay 只能改变加速资源和环境变量，不改变业务 API。
- Python/MediaPipe/PySceneDetect/WhisperX/pyannote 默认不进最小镜像，应作为 extended profile。

## kubernetes-private 标准

Helm chart 目录：

```text
deploy/kubernetes/
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
```

K8s 规则：

- MVP 默认 `replicaCount: 1`。
- 多副本前必须具备 PostgreSQL/S3-compatible/外部队列或分布式锁。
- Secret 存 OpenAI-compatible API key 和 server token。
- ConfigMap 存非敏感 runtime config。
- ConfigMap 必须使用 `SDKWORK_VIDEO_CUT_RUNTIME_MODE`、`SDKWORK_VIDEO_CUT_BIND_HOST`、`SDKWORK_VIDEO_CUT_PORT`、`SDKWORK_VIDEO_CUT_WORKSPACE_ROOT` 和 `SDKWORK_VIDEO_CUT_AUTH_MODE`。
- 默认 `SDKWORK_VIDEO_CUT_AUTH_MODE=reverse-proxy`，由 Ingress、service mesh 或企业网关承担用户认证。
- Service 只发布 web/http 端口；Host 容器端口只在同 Pod 内被 web proxy 访问，不作为 Service 端口暴露。
- PVC 存 workspace/artifacts，或切换 S3-compatible adapter。
- Ingress 必须配置上传大小和长请求超时。
- GPU 节点通过 `nodeSelector`、`tolerations`、`acceleratorProfile` 配置。

## 命令族

```bash
pnpm dev:local
pnpm desktop:dev:local
pnpm desktop:dev:private
pnpm web:dev:private
pnpm server:dev:private
pnpm stack:desktop:local
pnpm stack:web:private
pnpm deployment:doctor
pnpm deployment:doctor:server:private
pnpm release:package:matrix
pnpm release:package:desktop
pnpm release:package:server
pnpm release:package:container
pnpm release:package:kubernetes
pnpm release:package:web
```

## 部署 Smoke

- desktop：Tauri 启动、host health、capability、设置页。
- server：binary 启动、health/capability、workspace 可写。
- web：runtime config 指向 `/api/video-cut/v1`，无部署模式业务分支。
- container：compose up、health、ffmpeg/ffprobe 可执行。
- kubernetes：helm template、values schema、可选 rollout health。
