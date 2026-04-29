# sdkwork-video-cut standalone design 文件已拆分

日期：2026-04-26

这个文件名已经不再适合作为正式架构标准入口。`sdkwork-video-cut` 现在不是单一 desktop standalone 形态，而是 local-first + multi-deployment 的产品架构：同一个 Rust host 业务内核同时支持 desktop-local、server-private、web-private、container-private、kubernetes-private。

正式架构文档入口：

- [架构文档地图](../../architecture/00-architecture-map.md)
- [运行时与 API 架构标准](../../architecture/01-runtime-and-api-architecture.md)
- [部署模式架构标准](../../architecture/02-deployment-mode-architecture.md)
- [Provider 与 AI 契约标准](../../architecture/03-provider-contract-and-ai-standards.md)
- [媒体流水线与渲染标准](../../architecture/04-media-pipeline-and-rendering-standards.md)
- [任务引擎与存储标准](../../architecture/05-data-storage-task-engine-standards.md)
- [质量、安全、观测与发布标准](../../architecture/06-quality-security-observability-release-standards.md)
- [技术选型决策矩阵](../../architecture/07-technology-selection-decision-matrix.md)

历史初始集成草案保留在：

- [2026-04-26-sdkwork-video-cut-initial-integrated-architecture-draft.md](./2026-04-26-sdkwork-video-cut-initial-integrated-architecture-draft.md)

治理规则：

- 新实现和评审以 `docs/architecture/00-architecture-map.md` 声明的 authority order 为准。
- 本文件只作为兼容跳转页，不再承载新增架构内容。
- 后续如果进入实现计划，应引用 `docs/architecture/*` 的专题标准，而不是继续追加到这个文件。
