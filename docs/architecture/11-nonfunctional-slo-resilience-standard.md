# 11 Nonfunctional SLO And Resilience Standard

日期：2026-04-26

## 目标

本标准定义 `sdkwork-video-cut` 的非功能目标、SLO、资源预算、韧性、超时、重试、限流、取消和降级策略。技术选型必须能支撑这些目标，否则不能进入主链路。

## SLO 分层

| 场景 | SLO | 说明 |
| --- | --- | --- |
| desktop-local 启动 | P95 5 秒内 UI 可见，P95 10 秒内 host ready | 不要求 FFmpeg/AI ready，只要求 capability 可查询。 |
| health endpoint | P99 200ms 内返回 | 不做重型检查，只返回进程和基础状态。 |
| capability endpoint | P95 2 秒内返回 | 可缓存工具探测结果；AI health 可异步刷新。 |
| 导入本地视频 | P95 3 秒内完成 manifest 建立 | 大文件复制可异步，UI 必须有进度。 |
| probe | P95 10 秒内完成 2 小时以内 MP4/MOV probe | 超时进入 `MEDIA_PROBE_FAILED`。 |
| 3-10 秒 media smoke | P95 60 秒内完成 | release smoke gate。 |
| render | 目标 `render_realtime_factor <= 2.0` | 90 秒视频 P95 180 秒内，视机器能力降级。 |
| 取消任务 | P95 3 秒内停止新 stage，P95 10 秒内终止外部进程 | 通过 `CancellationToken` + child process kill。 |

这些 SLO 是第一版目标，不是承诺给终端用户的 SLA。实现必须输出指标，后续用真实数据校准。

## 技术选型

| 能力 | 推荐选型 | 用途 |
| --- | --- | --- |
| request timeout | `tower` timeout layer + use case timeout policy | HTTP 层和业务层双重超时。 |
| rate limit/load shed | `tower` middleware | server/container/k8s 避免过载。 |
| cancellation | `tokio_util::sync::CancellationToken` | 任务、provider、FFmpeg 进程取消。 |
| bounded queue | `tokio::sync` + repository-backed queue | MVP 单机，后续可迁移 DB/external queue。 |
| graceful shutdown | `tokio::signal` + shutdown token | server/container/k8s 停机。 |
| retry/backoff | 自研 `RetryPolicy` port | 只对可重试 provider 错误启用。 |
| resource metrics | `tracing` + optional OpenTelemetry | 输出 P95/P99、队列、失败率。 |

## Timeout Budget

每个外部能力必须有 timeout budget：

| 操作 | 默认超时 | 可配置 | 错误码 |
| --- | --- | --- | --- |
| ffprobe | 30s | yes | `MEDIA_PROBE_TIMEOUT` |
| audio extract | 10min | yes | `AUDIO_EXTRACT_TIMEOUT` |
| OpenAI-compatible chat | 120s | yes | `OPENAI_COMPATIBLE_TIMEOUT` |
| OpenAI-compatible transcription | 30min | yes | `OPENAI_COMPATIBLE_TRANSCRIPTION_TIMEOUT` |
| FFmpeg render | source duration * 5，最少 10min | yes | `RENDER_TIMEOUT` |
| artifact write | 5min | yes | `STORAGE_WRITE_TIMEOUT` |

规则：

- timeout 必须由 use case 传入 adapter，不能只依赖 HTTP client 默认值。
- timeout 触发必须写入 stage event。
- timeout 不等于 cancel；cancel 是用户或系统主动中止。

## Retry Policy

只允许对明确可重试错误重试：

- HTTP 429
- HTTP 502/503/504
- provider connection reset
- object storage transient error
- lock conflict

不重试：

- auth failed
- schema invalid after retry
- unsupported capability
- source file invalid
- path denied
- FFmpeg deterministic command error

标准：

```ts
export interface RetryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitter: boolean;
  retryableErrorCodes: string[];
}
```

默认 provider retry 最多 3 次；LLM schema invalid retry 单独计算，最多 1 次。

## Backpressure

必须有三层背压：

- API 层：上传大小、并发请求、任务创建速率。
- 任务层：worker concurrency、queue depth、per-user/per-profile limit。
- 工具层：FFmpeg 并发、线程数、临时目录空间、磁盘剩余量。

当队列满：

- `POST /tasks/{taskId}/analyze` 返回明确错误或进入 queued 状态。
- capability report 暴露 `queueBackpressure: true`。
- doctor 输出当前 queue depth 和 worker state。

## Graceful Shutdown

server/container/k8s 停机流程：

1. 停止接收新任务。
2. 标记 readiness 为 unavailable。
3. 通知 running stages cancel 或 drain。
4. 等待 drain deadline。
5. 强制终止剩余 child processes。
6. 持久化 interrupted state。

K8s `terminationGracePeriodSeconds` 必须大于 drain deadline。

## Degradation

降级必须显式：

- AI 不可用：basic tier，允许手动字幕/基础裁切。
- VAD 不可用：使用 silencedetect，但 capability 标记 speech activity unsupported。
- scene 不可用：不使用 scene score，不能伪造 scene boundary。
- subject tracking 不可用：固定 crop/center crop。
- BGM/SFX 不可用：渲染主视频，并在 render manifest 中记录 `not-configured` status；只有影响交付完整性的情况才提升为 warning。

## Resilience Tests

必须覆盖：

- provider timeout。
- provider 429 retry。
- schema invalid retry。
- FFmpeg non-zero exit。
- user cancel during render。
- process crash and restart recovery。
- full disk before render。
- workspace path denied。
- queue full。
