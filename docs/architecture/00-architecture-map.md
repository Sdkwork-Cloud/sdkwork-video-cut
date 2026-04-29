# sdkwork-video-cut 架构文档地图

日期：2026-04-26

## 定位

`sdkwork-video-cut` 是 local-first 的 AI 视频剪辑应用，不是 MagicCut 复刻，也不依赖 `spring-ai-plus-ai-api` 或 `spring-ai-plus-app-api`。产品使用一个 Rust host 业务内核，通过不同宿主和交付包装支持 desktop-local、server-private、web-private、container-private、kubernetes-private。

`docs/superpowers/specs/2026-04-26-sdkwork-video-cut-standalone-design.md` 这个文件名只适合作为早期“单机独立应用”草案，不适合作为多部署架构标准入口。正式架构标准拆分到本目录。

## Authority Order

如果文档之间存在冲突，按以下顺序判定：

1. `00-architecture-map.md`：文档边界、authority order、命名规则。
2. `01-runtime-and-api-architecture.md`：唯一业务内核、API facade、运行时边界。
3. `02-deployment-mode-architecture.md`：desktop/server/web/container/kubernetes 部署标准。
4. `03-provider-contract-and-ai-standards.md`：OpenAI-compatible、STT、LLM、provider registry、prompt/schema 治理。
5. `04-media-pipeline-and-rendering-standards.md`：FFmpeg、VAD、字幕、切分、渲染、媒体算法链路。
6. `05-data-storage-task-engine-standards.md`：任务引擎、状态机、事件、存储、队列、artifact。
7. `06-quality-security-observability-release-standards.md`：质量门禁、安全、观测、License、SBOM、发布。
8. `07-technology-selection-decision-matrix.md`：技术选型、候选方案、拒绝方案、升级条件。
9. `08-runtime-configuration-and-capability-standard.md`：运行时配置、能力发现、doctor、mode profile。
10. `09-deployment-runtime-profile-standard.md`：不同部署模式的 readiness、运维剖面、验收门槛。
11. `10-engineering-governance-automation-standard.md`：架构约束、contract、CI、release 的自动化治理。
12. `11-nonfunctional-slo-resilience-standard.md`：非功能指标、SLO、超时、重试、背压、降级、韧性。
13. `12-contract-versioning-and-migration-standard.md`：API、schema、manifest、prompt、provider、数据迁移版本治理。
14. `13-adr-and-technology-radar-standard.md`：架构决策记录、技术雷达、技术引入评分。
15. `14-database-implementation-standard.md`：SQLite/PostgreSQL、表契约、sqlx、migration、schema registry、数据库治理。
16. `15-database-queue-baseline-implementation.md`：记录当前已落地的数据库队列 baseline、port 边界和快速检查命令。
17. `../superpowers/specs/2026-04-26-sdkwork-video-cut-initial-integrated-architecture-draft.md`：历史集成草案，仅作背景。

## 命名标准

正式架构文档使用 `NN-topic-standard.md` 或 `NN-topic-architecture.md`：

- `architecture`：描述拓扑、边界、运行时、部署形态。
- `standard`：描述必须遵守的工程、契约、测试、发布规则。
- `matrix`：描述选型、权衡、替代方案和升级条件。

禁止继续把所有内容追加到单个 `standalone-design` 文件。不同架构模式必须拥有明确专题文件，避免实现阶段误读。

## 架构不变量

- 一个业务内核：`host/` Rust server。
- 一个产品 API facade：`/api/video-cut/v1`。
- 一个领域模型体系：`sdkwork-video-cut-types` + `sdkwork-video-cut-host-types`。
- 一个 provider 标准：所有 AI、媒体、存储、命令、配置、secret 能力都走 port/adapter。
- 一个部署配置模型：`RuntimeDeploymentConfig`。
- 一个任务引擎：所有分析、切分、渲染都是可恢复长任务。
- 一个发布矩阵：desktop、server、web、container、kubernetes 都有 package 和 smoke。

## 文档族

| 文档 | 作用 |
| --- | --- |
| [01-runtime-and-api-architecture.md](./01-runtime-and-api-architecture.md) | 定义 Rust host 唯一内核、Tauri shell 边界、前端 facade、canonical API。 |
| [02-deployment-mode-architecture.md](./02-deployment-mode-architecture.md) | 定义 desktop-local、desktop-private、web-private、server-private、container-private、kubernetes-private。 |
| [03-provider-contract-and-ai-standards.md](./03-provider-contract-and-ai-standards.md) | 定义 OpenAI-compatible 接口、LLM/STT port、provider registry、prompt/schema/model profile。 |
| [04-media-pipeline-and-rendering-standards.md](./04-media-pipeline-and-rendering-standards.md) | 定义 FFmpeg、Silero VAD、字幕、切点融合、渲染图、媒体 artifact。 |
| [05-data-storage-task-engine-standards.md](./05-data-storage-task-engine-standards.md) | 定义任务状态机、stage、事件、artifact、文件系统/SQLite/PostgreSQL/S3 演进。 |
| [06-quality-security-observability-release-standards.md](./06-quality-security-observability-release-standards.md) | 定义质量门禁、安全、OpenTelemetry、License、SBOM、release family。 |
| [07-technology-selection-decision-matrix.md](./07-technology-selection-decision-matrix.md) | 定义技术选型矩阵、替代方案、拒绝方案、升级触发条件。 |
| [08-runtime-configuration-and-capability-standard.md](./08-runtime-configuration-and-capability-standard.md) | 定义运行时配置、模式 profile、能力发现、doctor 和 config schema。 |
| [09-deployment-runtime-profile-standard.md](./09-deployment-runtime-profile-standard.md) | 定义各部署模式的 readiness、运行剖面、运维验收和多副本门槛。 |
| [10-engineering-governance-automation-standard.md](./10-engineering-governance-automation-standard.md) | 定义架构约束如何通过 contract、CI、release gate 自动化执行。 |
| [11-nonfunctional-slo-resilience-standard.md](./11-nonfunctional-slo-resilience-standard.md) | 定义 SLO、资源预算、超时、重试、取消、背压和降级策略。 |
| [12-contract-versioning-and-migration-standard.md](./12-contract-versioning-and-migration-standard.md) | 定义 API/schema/manifest/prompt/provider/data migration 版本治理。 |
| [13-adr-and-technology-radar-standard.md](./13-adr-and-technology-radar-standard.md) | 定义 ADR、技术雷达、技术引入 scorecard 和复盘节奏。 |
| [14-database-implementation-standard.md](./14-database-implementation-standard.md) | 定义 DATABASE_SPEC.md 在本项目中的数据库实现、表契约、sqlx、migration 和 schema drift 标准。 |
| [15-database-queue-baseline-implementation.md](./15-database-queue-baseline-implementation.md) | 记录已实现的 DB queue baseline、`TaskQueuePort`、SQLite adapter、baseline schema 和治理 gate。 |
| [adr/](./adr/) | 保存已接受或待评审的架构决策记录。 |

## 产品与设计文档

| 文档 | 作用 |
| --- | --- |
| [../product/00-product-map.md](../product/00-product-map.md) | 定义产品文档入口。 |
| [../product/01-product-requirements-document.md](../product/01-product-requirements-document.md) | 定义 PRD、完整操作界面、设置中心和验收标准。 |
| [../design/00-design-map.md](../design/00-design-map.md) | 定义设计文档入口。 |
| [../design/01-ui-visual-design-standard.md](../design/01-ui-visual-design-standard.md) | 定义 UI 视觉、布局、组件、设置中心和响应式标准。 |

## 与参考项目的关系

- 参考 Magic Studio 的“一个 host 内核 + 薄 shell + package 边界 + canonical route”思想。
- 参考 BirdCoder 的 desktop/server/web/container/kubernetes release family 和命令矩阵。
- 不复制 MagicCut 业务代码。
- 不依赖 Spring AI Plus 的 ai-api/app-api 服务。
- 不引入 Ollama provider 或 llama.cpp 专有 API 作为产品契约。

## 外部标准参考

技术标准落地时优先参考官方文档：

- Tauri architecture: https://v2.tauri.app/concept/architecture/
- OpenAPI Specification: https://spec.openapis.org/oas/
- JSON Schema: https://json-schema.org/
- Kubernetes Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- Kubernetes Persistent Volumes: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
- Docker Compose production: https://docs.docker.com/compose/how-tos/production/
- Helm docs: https://helm.sh/docs
- OpenTelemetry Rust: https://opentelemetry.io/docs/languages/rust/
- CycloneDX specification: https://cyclonedx.org/specification/overview
- clap docs: https://docs.rs/clap/
- schemars docs: https://docs.rs/schemars/
- tower docs: https://docs.rs/tower/
- tokio-util CancellationToken: https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html
- sqlx docs: https://docs.rs/sqlx/
- object_store docs: https://docs.rs/object_store/
- cargo-deny: https://embarkstudios.github.io/cargo-deny/
- cargo-nextest: https://nexte.st/
- insta snapshot testing: https://docs.rs/insta/
