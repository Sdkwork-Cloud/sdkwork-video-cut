# ADR-0003: Use FFmpeg As MVP Render Engine

日期：2026-04-26
状态：accepted

## Context

MVP 需要完成真实可发布视频输出：9:16、1080x1920、30fps、MP4、裁切、拼接、混音、字幕烧录、基础音频增强、封面和 render log。手写媒体引擎成本高，浏览器端渲染不适合稳定输出。

## Decision

MVP 使用 FFmpeg/ffprobe/libass 作为媒体探测和渲染基础，通过 `MediaProbePort`、`MediaRenderPort`、`SubtitleRendererPort`、`CommandRunnerPort` 封装。

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| FFmpeg/ffprobe/libass | 成熟、跨平台、滤镜完整、可脚本化 | 命令复杂，需要严格 RenderGraphBuilder 和 command safety |
| GStreamer | 管线能力强 | 学习和部署成本高，MVP 不需要 |
| Browser rendering | 前端预览方便 | 输出稳定性、性能、权限和大文件处理不足 |
| 自研 Rust media engine | 控制力强 | 成本过高，不适合 MVP |

## Consequences

- 所有 FFmpeg 参数由 `RenderGraphBuilder` 从标准模型生成。
- 外部命令只通过 `CommandRunnerPort` 执行。
- render log 进入 artifact，并经过 secret/path redaction。
- FFmpeg build profile 和 license 状态必须进入 release manifest。

## Guardrails

- 不允许用户直接输入任意 FFmpeg filter 字符串。
- 渲染 adapter 不调用 LLM，不修改 `split_plan.json`。
- 缺 FFmpeg/ffprobe 时 capability 降级，不伪造渲染成功。

## Review Trigger

- 需要低延迟预览或服务端大规模并行转码，FFmpeg process 模式成为瓶颈。
- GStreamer 或其他引擎在稳定性/部署/License 上明显优于当前方案。

