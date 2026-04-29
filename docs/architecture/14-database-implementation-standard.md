# 14 Database Implementation Standard

日期：2026-04-26

## 目标

本标准把根目录 [DATABASE_SPEC.md](../../DATABASE_SPEC.md) 落地到 `sdkwork-video-cut` 的实施规范中。`DATABASE_SPEC.md` 是通用数据库定义标准，本文件是本项目在未来进入 SQLite、PostgreSQL、sqlx、任务存储、队列、artifact 元数据和多部署模式时的具体执行规则。

数据库不是 MVP 的强制前提。MVP 仍以文件系统 manifest 作为 source of truth；一旦进入 SQLite、PostgreSQL、DB queue、worker lease、审计表、读模型或多实例部署，就必须遵守本文件。

新项目首版不得为了“看起来完整”预置数据库 migration。首版只有两类情况：

- MVP 不引入数据库：不创建 `host/migrations/`，只保留 JSON Schema、manifest version 和文件系统 repository。
- 首次引入数据库：先定义 table contract 和 baseline schema。只有当已有发布版本、已有持久数据需要从旧结构升级到新结构时，才引入 migration。

## 规范来源

本项目数据库实现必须同时满足：

- `DATABASE_SPEC.md`：通用表结构、字段语义、命名、逻辑类型、迁移和检查规则。
- [05-data-storage-task-engine-standards.md](./05-data-storage-task-engine-standards.md)：任务引擎、artifact、队列和存储演进。
- [12-contract-versioning-and-migration-standard.md](./12-contract-versioning-and-migration-standard.md)：API、schema、manifest、prompt、provider 和 DB migration 版本治理。
- [10-engineering-governance-automation-standard.md](./10-engineering-governance-automation-standard.md)：自动化 gate 和 CI 检查。

如果本文件与 `DATABASE_SPEC.md` 冲突，以 `DATABASE_SPEC.md` 的通用强制规则为底线；本文件只能收紧，不能放松。

## 合规等级

| 场景 | 最低等级 | 说明 |
| --- | --- | --- |
| MVP 文件系统 manifest | 不适用 DB 表等级 | 仍需保持 JSON Schema 和 manifest version。 |
| SQLite 本地任务索引 | L1 | 新建表必须有标识、审计、命名、逻辑类型和基础索引。 |
| SQLite queue / server-private 单机服务 | L2 | 需要幂等、API 序列化、结构演进治理和 owner。 |
| PostgreSQL server/k8s | L2 | 多用户、多实例、队列、lease、artifact metadata 至少 L2。 |
| 审计、安全、凭证引用、导出记录 | L3 | 涉及敏感、合规、留存或关键审计时按 L3 设计。 |

规则：

- 新建业务表不能低于 L1。
- 任务、队列、stage、artifact、provider profile、release、审计相关表默认按 L2 设计。
- 不存储 secret 明文；保存 provider/account 关系时只允许保存 `secret_ref` 或等价引用。
- 任何 L3 表必须有留存、恢复、审计、加密/脱敏和 runbook。

## 数据库边界

数据库 adapter 只能承担持久化、索引、查询、队列、lease 和审计职责。

允许：

- `TaskRepositoryPort` 的 SQLite/PostgreSQL adapter。
- `ArtifactRepositoryPort` 的 artifact metadata adapter。
- `QueuePort`、`WorkerLeasePort`、`IdempotencyPort`、`AuditLogPort`。
- schema registry、migration、schema drift 检测。

禁止：

- use case 直接依赖 `sqlx`、SQL 字符串或数据库连接池。
- domain model 引入数据库 DTO、row struct、SQL enum。
- 把视频、音频、字幕、封面等大二进制内容存入关系数据库。
- 把核心查询字段只放入 JSON。
- 通过数据库表绕过 `/api/video-cut/v1` 或 provider port。

二进制 artifact 的 source of truth 是文件系统或 S3-compatible storage；数据库只保存路径、对象 key、size、sha256、kind、retention、owner 和状态。

## 标准产物

MVP 文件系统阶段只需要 manifest schema、artifact manifest schema 和 repository conformance tests，不需要数据库产物。

进入 SQLite/PostgreSQL 设计阶段时，先建立契约产物：

```text
docs/database/
  prefix-registry.yaml
  schema-registry/
    ops_task.yaml
    ops_stage_run.yaml
    media_artifact.yaml
  exceptions.yaml
  review/
    YYYY-MM-DD-<table>-review.md
```

首次数据库实现使用 baseline schema，不称为 migration：

```text
host/database/
  schema/
    sqlite/
      001_baseline.sql
    postgres/
      001_baseline.sql
```

只有已有发布版本需要升级持久数据时，才建立 migration 目录：

```text
host/migrations/
  sqlite/
    V20260510_101500__add_ops_task_retry_policy.sql
  postgres/
    V20260510_101500__add_ops_task_retry_policy.sql
```

规则：

- 新表先写 `schema-registry/*.yaml` 契约，再写 baseline schema。
- 首版 baseline schema、后续 migration、Rust row struct、DTO、OpenAPI/JSON Schema 必须能追溯到同一份表契约。
- migration 不是新项目脚手架内容，只是已发布持久数据的升级机制。
- 例外必须进入 `exceptions.yaml`，包含原因、风险、owner 和退出条件。
- SQLite 与 PostgreSQL 方言可以分开实现，但逻辑表契约必须一致。

## 受控模块前缀

`sdkwork-video-cut` 不使用产品名、项目名或技术栈名作为表名前缀。禁止使用 `sdkwork_`、`video_cut_`、`plus_`、`app_`、`sys_`、`common_` 作为默认业务表前缀。

本项目允许的初始业务模块前缀：

| 前缀 | 业务域 | 示例表 | 说明 |
| --- | --- | --- | --- |
| `studio` | 工作空间、项目、配置快照 | `studio_project`、`studio_workspace` | 设计时资产和本地项目管理。 |
| `media` | 媒体资源、分析轨道、渲染产物 | `media_source_asset`、`media_artifact` | 视频、音频、字幕、封面和 artifact metadata。 |
| `ops` | 任务、队列、stage、lease、事件 | `ops_task`、`ops_stage_run`、`ops_worker_lease` | 运行时任务引擎和运维事实。 |
| `ai` | prompt、model profile、分析结果缓存 | `ai_model_profile`、`ai_prompt_version` | AI 能力配置和可复现分析元数据，不保存 secret 明文。 |
| `integration` | 外部 provider/account 元数据 | `integration_provider_account` | OpenAI-compatible endpoint、供应商账号引用和连接器元数据。 |
| `iam` | 用户、租户、服务端访问控制 | `iam_user`、`iam_api_token` | 仅 server/web/private 多用户形态需要。 |

新增前缀必须先更新 `docs/database/prefix-registry.yaml`，并通过 `check:database-contracts`。

## 推荐表族

数据库阶段的表设计应优先围绕以下表族，不得为了实现方便建立无边界的“万能任务表”。

| 表 | 画像 | 最低等级 | 写入 owner | 说明 |
| --- | --- | --- | --- | --- |
| `studio_project` | `core_entity` | L1/L2 | project use case | 项目和工作区入口。server 多用户时升到 L2。 |
| `ops_task` | `core_entity` | L2 | task engine | 任务主表，承载状态机、幂等键、当前 stage、失败摘要。 |
| `ops_stage_run` | `event_log` | L2 | task engine | stage attempt、输入输出 hash、耗时、provider diagnostics。 |
| `ops_task_event` | `event_log` | L2 | task engine | 进度事件和 SSE/轮询事件源。 |
| `ops_worker_lease` | `temporary` | L2 | worker runtime | 多 worker/multi-replica lease。 |
| `ops_outbox_event` | `outbox_event` | L2 | task engine | 需要可靠发布事件时启用。 |
| `ops_inbox_event` | `inbox_event` | L2 | integration/worker | 需要消费去重时启用。 |
| `media_source_asset` | `core_entity` | L2 | media repository | 源视频 metadata、hash、probe summary。 |
| `media_analysis_track` | `snapshot` | L2 | analysis pipeline | mediaInfo/silence/vad/transcript/semantic/cutDecision 轨道索引。 |
| `media_render` | `core_entity` | L2 | render pipeline | render attempt、render graph hash、输出状态。 |
| `media_artifact` | `projection` | L2 | artifact repository | artifact metadata，不保存大文件内容。 |
| `ai_prompt_version` | `dictionary_entity` | L2 | provider governance | prompt/schema/model profile 可追踪版本。 |
| `ai_model_profile` | `dictionary_entity` | L2 | provider registry | 模型 profile 和 capability 摘要。 |
| `integration_provider_account` | `dictionary_entity` | L2/L3 | provider registry | provider endpoint/account 元数据，secret 只存引用。 |
| `iam_user` | `user_entity` | L2/L3 | auth use case | server/web 多用户模式才引入。 |

## 公共字段

所有 L1 及以上业务表必须遵守 `DATABASE_SPEC.md` 字段字典：

- `id`：`int64`，由 `IdGeneratorPort` 生成；不把数据库自增 ID 作为跨服务主键策略。
- `uuid`：外部稳定标识，建议 UUID v7、ULID 或等价字符串 ID。
- `created_at`、`updated_at`：UTC instant。
- `version`：乐观锁或数据版本。
- `status`：`int32` enum，必须有 unknown fallback。
- `tenant_id`、`organization_id`、`data_scope`：多用户、多租户或 server/web 模式必备。
- `user_id` 或 `owner_type`/`owner_id`：用户私有资源、项目、artifact、任务归属必备。
- `request_id`、`idempotency_key`、`trace_id`：任务提交、render、provider 回调、队列消费等幂等和追踪场景必备。

API/SDK 序列化规则：

- `int64` 在 TypeScript/JSON 中必须是 string。
- `decimal` 必须是 string 或最小单位整数；不得使用 float/double。
- 时间必须是 ISO 8601 UTC。
- JSON 字段必须有 schema；核心查询、权限过滤、金额、状态、幂等字段不能只存在于 JSON。

## ID 和幂等

数据库实现必须提供 `IdGeneratorPort`：

```text
UseCase
  -> IdGeneratorPort
  -> Rust adapter
  -> snowflake/uuidv7/ulid strategy
```

规则：

- ID 生成策略必须声明时钟回拨、节点冲突和失败处理。
- 对外 API 不默认暴露连续自增主键，优先暴露 `uuid`、`code` 或 `business_no`。
- `POST /tasks`、`POST /analyze`、`POST /render`、队列消费和 provider 回调必须有幂等键或等价唯一约束。
- `render` 重复提交生成新的 `renderId`，但必须能追溯同一 `taskId` 和 plan revision。

## sqlx Adapter 标准

SQLite/PostgreSQL adapter 默认使用 `sqlx`，但 `sqlx` 只能出现在 adapter 层。

规则：

- `domain`、`usecase`、`ports` 不得 import `sqlx`。
- SQL row struct 必须在 adapter 内映射为领域 DTO。
- 事务边界由 repository/queue adapter 显式暴露，use case 不拼 SQL。
- SQLite 使用 WAL 时必须明确 busy timeout、checkpoint、备份和损坏恢复策略。
- PostgreSQL 使用连接池时必须配置 max connections、statement timeout、idle timeout 和 migration lock。
- SQL 查询必须使用参数绑定，不拼接用户输入。
- 所有列表查询必须有排序和分页契约，默认使用 cursor 或 `(updated_at, id)` seek，不以大 offset 作为核心路径。

## Baseline Schema And Migration 标准

首版数据库实现是 baseline schema：

- baseline schema 从 `docs/database/schema-registry/*.yaml` 生成或被其校验。
- baseline schema 可以直接创建全量首版表、索引、约束和 seed/reference 数据。
- baseline schema 不需要扩展/收缩、双写、回填或兼容窗口，因为没有旧版本持久数据。
- baseline schema 进入 release 后即成为 `databaseContractVersion` 的起点。

后续 SQLite/PostgreSQL migration 只用于已发布持久数据升级，必须遵守扩展/收缩流程：

1. 扩展：新增字段、新表、新索引。
2. 兼容读：应用能读旧字段和新字段。
3. 双写：必要时同时写旧字段和新字段。
4. 回填：分批、可恢复、可观测。
5. 校验：数量、空值、唯一性、hash 或抽样比对。
6. 切换读：读路径切到新字段或新表。
7. 冻结旧写：停止旧字段写入。
8. 收缩：确认兼容窗口结束后删除旧字段或旧表。

baseline schema 命名：

```text
001_baseline.sql
```

后续 migration 文件命名：

```text
VYYYYMMDD_HHMMSS__verb_module_entity_change.sql
```

每个后续 migration 文件必须在注释中说明：

- 目的。
- 影响表和字段。
- 是否可回滚，或采用前滚。
- 是否锁表。
- 回填批次和节流策略。
- 校验 SQL。
- 发布顺序要求。

部署规则：

- `desktop-local`：MVP 文件系统阶段无数据库 migration；数据库阶段首次启动可初始化 baseline schema。后续升级允许自动执行兼容 migration，但必须先拿本地锁并写 backup marker。
- `server-private`：启动时只校验版本；baseline 初始化和后续结构变更通过显式 `host db init` / `host migrate --apply` 执行。
- `container-private`：镜像不自动修改外部 DB；baseline 初始化或 migration 由 release command 或 compose job 执行。
- `kubernetes-private`：baseline 初始化或 migration 必须通过 Helm Job 或受控运维命令执行，app pod 只做 schema version readiness。

## 事务、锁和一致性

必须原子化的操作：

- task 状态流转和 stage_run 记录。
- stage output artifact metadata 写入。
- queue claim 和 worker lease。
- render attempt 创建和 plan revision 绑定。
- outbox event 写入。

规则：

- 并发更新使用 `version` 条件更新、唯一约束、数据库锁或 lease，不用“先查再写”的非原子流程。
- 多副本 worker 必须有 `ops_worker_lease` 或外部队列/分布式锁。
- 任务状态机的非法流转必须在应用层和数据库约束中至少一处被阻断。
- outbox/inbox 只有在需要跨进程可靠事件时启用；启用后必须有重试、死信或人工恢复路径。

## 索引和查询契约

每张表的 schema registry 必须声明 query contract。

最低要求：

- `uuid` 唯一索引。
- 多租户列表索引以 `tenant_id` 开头。
- 任务列表索引覆盖 owner、status、updated_at/id。
- stage/event 查询索引覆盖 `task_id`、`stage`、`created_at/id`。
- artifact 查询索引覆盖 `task_id`、`render_id`、`kind`、`created_at/id`。
- 幂等键有唯一约束。
- 软删除表必须声明唯一键如何避开 deleted rows。

索引预算：

- L1 表必须说明基础索引。
- L2/L3 表必须说明容量模型、预期行数、写入 TPS、索引预算。
- 无查询契约支撑的索引不得进入 baseline schema 或后续 migration。

## 安全和隐私

数据库不得成为 secret 扩散点。

规则：

- API key、token、私钥、provider secret 不写普通业务表。
- 允许保存 `secret_ref`、`provider_id`、`endpoint_host`、`model`、`capability_version` 等非敏感元数据。
- 高敏字段必须声明 `sensitivity`、`masking_rule`、加密策略和日志脱敏策略。
- 导出、下载、审计、删除请求必须可追踪。
- 数据留存、TTL、归档和物理删除必须写入表契约。

## 自动化检查

`check:database-contracts` 必须执行：

- `DATABASE_SPEC.md` 中 DB001-DB072 的适用规则。
- `docs/database/prefix-registry.yaml` 中前缀合法。
- `schema-registry/*.yaml` 有 table profile、compliance level、owner、contract version。
- 表名、字段名、索引名、约束名符合命名规则。
- L1+ 表包含 `id`、`created_at`、`updated_at`，核心表包含 `uuid`。
- 多租户表包含 `tenant_id`，相关索引以 `tenant_id` 开头。
- JSON 字段有 schema，核心字段不只在 JSON 中。
- baseline schema 或后续 migration 与 schema registry 可对齐。
- SQLite/PostgreSQL baseline apply dry-run 可执行；存在 migration 时，migration dry-run 也必须可执行。
- schema drift 检查无未登记字段、索引、约束漂移。
- API/SDK/OpenAPI/JSON Schema 与数据库契约的 `int64`、时间、enum 序列化一致。

检查输出必须包含表名、字段名、规则编码、严重级别、证据和修复建议。

## 测试标准

数据库 adapter 必须通过同一组 repository conformance tests：

- FileSystemTaskRepository、SQLiteTaskRepository、PostgreSQLTaskRepository 的任务语义一致。
- create/list/get/update/cancel/retry/recover 行为一致。
- stage idempotency、render attempt、artifact metadata 行为一致。
- baseline schema fixture 可初始化。
- 存在历史发布版本后，migration old -> current fixture 可读。
- SQLite/PostgreSQL baseline dry-run 可执行；存在 migration 时，migration dry-run 可执行。
- 并发 claim queue 只有一个 worker 成功。
- redaction test 证明 secret 不进入 row、log、event、error。

## Review Gate

任何新表或破坏性结构变更进入实现前，必须完成数据库设计评审：

- 已选择表画像和合规等级。
- 已明确事实来源和写入 owner。
- 已定义 ID、uuid、审计字段和状态机。
- 已定义租户/用户/owner 边界。
- 已定义幂等键、唯一约束、查询索引和分页。
- 已定义 JSON schema、敏感字段、留存和删除策略。
- 已给出 SQLite/PostgreSQL 方言映射。
- 首版数据库已设计 baseline schema；后续破坏性变更才需要 migration、回填、校验和回滚/前滚策略。
- 评分低于 80 分的新核心表不得进入主链路。
