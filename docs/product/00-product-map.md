# sdkwork-video-cut 产品文档地图

日期：2026-04-26

## 定位

本目录记录 `sdkwork-video-cut` 的产品需求、用户流程、验收标准和版本范围。架构实现边界以 `../architecture/00-architecture-map.md` 为准，视觉和交互实现标准以 `../design/01-ui-visual-design-standard.md` 为准。

## 文档

| 文档 | 作用 |
| --- | --- |
| [01-product-requirements-document.md](./01-product-requirements-document.md) | 定义完整 PRD、用户场景、功能范围、设置中心、验收标准。 |

## 产品不变量

- 这是一个 local-first 的 AI 视频剪辑应用，不是 MagicCut 复刻。
- 应用第一屏必须是可操作工作台或任务入口，不做营销落地页。
- 所有 AI、语音、字幕、媒体、存储、配置能力必须通过 host 的标准 port/adapter 暴露。
- 设置中心必须能配置 LLM、语音转文字、字幕、媒体工具、存储、安全、部署和诊断。
- UI 只能消费 `/api/video-cut/v1/settings`、`/api/video-cut/v1/capabilities` 和任务 API，不自行探测环境、不直接调用模型接口、不保存 secret 明文。

