# 13 ADR And Technology Radar Standard

日期：2026-04-26

## 目标

本标准定义架构决策记录和技术雷达，确保技术选型可以被追踪、复盘和替换。没有 ADR 的重大技术引入不得进入主链路。

## ADR 目录

```text
docs/architecture/adr/
  0001-use-rust-host-as-single-business-kernel.md
  0002-use-openai-compatible-provider-contract.md
  0003-use-ffmpeg-as-mvp-render-engine.md
```

当前已接受 ADR：

- [ADR-0001: Use Rust Host As Single Business Kernel](./adr/0001-use-rust-host-as-single-business-kernel.md)
- [ADR-0002: Use OpenAI-Compatible Provider Contract](./adr/0002-use-openai-compatible-provider-contract.md)
- [ADR-0003: Use FFmpeg As MVP Render Engine](./adr/0003-use-ffmpeg-as-mvp-render-engine.md)

## ADR Template

```markdown
# ADR-0000: Title

日期：
状态：proposed | accepted | superseded | rejected

## Context

为什么需要决策。

## Decision

决定是什么。

## Options

| Option | Pros | Cons |
| --- | --- | --- |

## Consequences

正面和负面影响。

## Guardrails

必须遵守的边界。

## Review Trigger

什么条件下重新评审。
```

## 必须写 ADR 的情况

- 引入新的 runtime framework。
- 引入新的 provider kind。
- 从文件系统迁移到 SQLite/PostgreSQL。
- 从文件 artifact 迁移到 S3-compatible。
- 允许 Kubernetes 多副本。
- 引入 AGPL/GPL/nonfree 依赖。
- 改变 API major version。
- 改变任务状态机。
- 改变 OpenAI-compatible 契约。
- 引入动态插件机制。

## Technology Radar

技术状态：

| 状态 | 含义 |
| --- | --- |
| `adopt` | 标准选型，可进入主链路。 |
| `trial` | 可用于二阶段或受控 adapter。 |
| `assess` | 可研究，不进入主链路。 |
| `hold` | 禁止或暂缓。 |

当前雷达：

| 技术 | 状态 | 理由 |
| --- | --- | --- |
| Tauri 2 | adopt | 桌面壳标准。 |
| React + Vite | adopt | 前端工作台标准。 |
| lucide-react | adopt | 工具型 UI 图标标准，避免手写 SVG 和重型 icon pack。 |
| HTML5 video | adopt | 媒体预览基础能力，不把媒体处理放到前端。 |
| Rust host + axum | adopt | 唯一业务内核标准。 |
| FFmpeg/ffprobe/libass | adopt | MVP 媒体处理标准。 |
| OpenAI-compatible Chat/STT | adopt | AI provider 标准契约。 |
| Silero VAD ONNX | adopt | MVP VAD 标准。 |
| Zustand | trial | 工作台跨面板状态复杂后引入。 |
| TanStack Query | trial | 服务端状态缓存、轮询和 SSE 状态管理复杂后引入。 |
| react-hook-form | trial | 配置表单复杂后与 schema resolver 配套引入。 |
| Radix UI primitives | assess | 复杂无障碍弹层、菜单、tabs、tooltip 不足时按组件评估。 |
| SQLite | trial | 单机增强阶段任务索引和队列。 |
| PostgreSQL | trial | server/k8s 多实例阶段。 |
| DATABASE_SPEC.md database contract | adopt | SQLite/PostgreSQL 阶段的表契约、命名、baseline schema、后续 migration 和 schema drift 底线。 |
| docs/database schema registry | trial | 进入数据库阶段前启用，用于表契约、字段字典、前缀和 drift 检查。 |
| S3-compatible object storage | trial | k8s 多副本 artifact。 |
| PySceneDetect | trial | 二阶段场景检测。 |
| MediaPipe | trial | 二阶段主体跟踪。 |
| OpenCV videostab | assess | 稳定效果和部署成本需验证。 |
| RNNoise/DeepFilterNet | assess | 音频增强效果和 License 需验证。 |
| GStreamer | assess | 作为远期 FFmpeg 替代研究。 |
| Ollama provider | hold | 不符合 OpenAI-compatible 统一契约。 |
| llama.cpp 专有 API | hold | 不作为产品业务契约。 |
| AGPL core dependency | hold | 私有化部署和分发风险高。 |

## Technology Scorecard

新技术评估必须打分：

| 维度 | 权重 |
| --- | --- |
| 架构边界清晰 | 20 |
| 跨平台可部署 | 15 |
| License 风险低 | 15 |
| 可测试/可 mock | 15 |
| 性能和资源可控 | 10 |
| 维护活跃 | 10 |
| 与现有栈一致 | 10 |
| 文档和社区成熟 | 5 |

低于 80 分不能进入 `adopt`。

## Review Cadence

- MVP 前：每个核心选型必须至少有一次 ADR review。
- 每个 release candidate：检查 `trial` 技术是否需要升降级。
- 每季度或重要依赖变更：刷新 technology radar。
- 出现重大故障：相关 ADR 必须复盘并更新 guardrails。
