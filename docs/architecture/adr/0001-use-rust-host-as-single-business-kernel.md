# ADR-0001: Use Rust Host As Single Business Kernel

日期：2026-04-26
状态：accepted

## Context

`sdkwork-video-cut` 需要同时支持 desktop-local、server-private、web-private、container-private、kubernetes-private。如果每个宿主形态各自实现业务能力，会导致 API、任务状态、媒体处理、provider 调用、artifact 管理出现分叉。

## Decision

使用 `host/` Rust server 作为唯一业务内核。Tauri、Web、server、container、kubernetes 都通过 `/api/video-cut/v1` 访问同一内核。

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| Rust host single kernel | 同一业务语义、跨部署一致、适合媒体进程和本地工具监督 | 初期需要定义清晰 port/adapter 和 HTTP contract |
| Tauri command 承载桌面业务 | 桌面开发快 | server/container/k8s 必然复制业务 |
| Node backend | 前端团队上手快 | 媒体进程、跨平台打包、系统集成不如 Rust 稳 |
| Java/Spring backend | 生态成熟 | 与独立桌面/local-first 目标不匹配，容易引入 ai-api/app-api 依赖 |

## Consequences

- 所有 use case、任务、provider、渲染、存储都在 Rust host。
- `src-tauri` 只做 shell 和 host supervisor。
- 前端只通过 core client 调用 canonical API。
- 所有部署模式必须通过同一 contract smoke。

## Guardrails

- `src-tauri` 禁止实现业务 use case。
- feature package 禁止直接调用本地工具或 provider endpoint。
- canonical route 只能是 `/api/video-cut/v1`。

## Review Trigger

- Rust host 无法满足目标平台性能或打包要求。
- 出现必须由宿主原生层承载的能力，且无法通过 platform adapter 表达。

