# 12 Contract Versioning And Migration Standard

日期：2026-04-26

## 目标

本标准定义 API、schema、manifest、prompt、provider capability、任务数据和数据库迁移的版本治理。不同部署模式必须能在升级后继续读取旧任务和旧 artifact。

## Version Domains

| Domain | 示例 | 版本规则 |
| --- | --- | --- |
| HTTP API | `/api/video-cut/v1` | route major version。breaking change 才升 v2。 |
| OpenAPI | `openapi.video-cut.v1` | 与 API major 对齐。 |
| JSON Schema | `video-cut.task.schema.v1` | schema 自己演进，可追加字段。 |
| Task manifest | `taskManifestVersion: 1` | 任务读取必须兼容旧版。 |
| Plan | `planVersion: 1` | 渲染绑定具体 plan revision。 |
| Prompt | `cut-analysis.v1` | prompt 变更必须可追踪。 |
| Provider capability | `providerCapabilityVersion: 1` | registry 和 adapter 协议。 |
| Runtime config | `runtimeConfigVersion: 1` | mode profile 和 env parity。 |
| DB baseline schema | integer | 首次引入 SQLite/PostgreSQL adapter 时使用。 |
| DB migrations | timestamp/integer | 已发布数据库结构升级时使用。 |
| DB table contract | semantic version | `docs/database/schema-registry/*.yaml` 使用，遵守 `DATABASE_SPEC.md` 和数据库实现标准。 |

## Compatibility Rules

允许：

- 新增 optional 字段。
- 新增 enum 值，但 UI 必须有 unknown fallback。
- 新增 capability，并默认 false。
- 新增 artifact kind，并保留 generic 展示。

需要 deprecation：

- 字段重命名。
- enum 值替换。
- 默认值语义变化。
- provider capability 语义变化。

breaking：

- 删除必需字段。
- 改变时间单位。
- 改变 artifact 路径语义。
- 改变任务状态机语义。
- 改变 `/api/video-cut/v1` response envelope。

## Schema Evolution

每个 schema 必须包含：

```json
{
  "$id": "video-cut.task.schema.v1",
  "x-version": 1,
  "x-compatibleSince": 1,
  "additionalProperties": false
}
```

规则：

- LLM output schema 禁止直接复用内部 manifest schema。
- schema 变更必须有 fixture：old -> current。
- `additionalProperties: false` 是默认，但 forward-compatible reader 可以保留 unknown raw extension。
- manifest reader 必须先读 version，再选择 migration。

## Data Migration

MVP 文件系统阶段不引入数据库 migration。首版文件 manifest 只需要 `taskManifestVersion` 和当前 reader。只有发布后 manifest 结构发生变化，并且需要读取旧任务目录时，才增加显式文件 manifest migration。

文件 manifest 迁移的未来目录：

```text
migrations/
  file-manifest/
    0002_add_plan_revision.rs
```

SQLite/PostgreSQL 阶段：

- 首次引入数据库时使用 baseline schema，不在新项目脚手架中预置 migration。
- 已发布数据库结构升级时使用 `sqlx` migrations 或兼容迁移器。
- baseline apply 和 migration 必须可重复检测当前版本。
- release smoke 必须跑 baseline apply dry-run；存在 migration 时再跑 migration dry-run。
- downgrade 不作为默认要求，但必须有 rollback plan。
- 表结构契约必须先写入 `docs/database/schema-registry/*.yaml`，再生成或校验 baseline schema / migration。
- baseline schema 使用 `001_baseline.sql`；后续 migration 文件按 `VYYYYMMDD_HHMMSS__verb_module_entity_change.sql` 命名，并声明目的、影响表、锁表风险、回填策略、校验 SQL 和发布顺序。
- `desktop-local` 可以在拿到本地锁和写入 backup marker 后自动执行兼容 migration；`server/container/kubernetes` 的 baseline 初始化和 migration 必须通过显式 command 或受控 Job 执行。

迁移原则：

- 不在读取路径隐式重写大量文件。
- 大规模迁移必须是显式 maintenance task。
- 每次迁移生成 backup marker。
- 失败必须可恢复到迁移前状态。
- 破坏性变更必须走扩展、兼容读、双写、回填、校验、切换读、冻结旧写、收缩流程。
- 字段删除前必须确认 SDK、OpenAPI、数仓、搜索、缓存、CDC consumer 和旧应用版本已切换。

## API Versioning

MVP 只公开：

```text
/api/video-cut/v1
```

规则：

- v1 内不做 breaking change。
- v2 需要新 route prefix，v1 保留一个 deprecation window。
- 前端 core client 必须绑定 API major。
- server `/capabilities` 返回 supported API versions。

## Prompt Versioning

prompt 版本进入 stage diagnostics：

```json
{
  "promptId": "cut-analysis",
  "promptVersion": "v1",
  "inputSchemaId": "video-cut.cut-analysis-input.v1",
  "outputSchemaId": "video-cut.cut-analysis-output.v1"
}
```

规则：

- prompt 版本变化不自动重写旧 analysis。
- 重新分析会生成新的 stage attempt。
- prompt rollback 必须可配置。

## Provider Capability Versioning

Provider registry 必须记录：

- adapter version
- capability schema version
- config schema version
- supported contract versions
- minimum host version

不满足版本要求时 fail fast，不能运行到 use case 中途失败。

## Migration Tests

必须覆盖：

- current task manifest read。
- old task manifest read 只在存在历史发布版本时要求。
- old plan render blocked or migrated 只在存在历史 plan version 时要求。
- old artifact manifest read 只在存在历史 artifact manifest version 时要求。
- old runtime config read 只在存在历史 runtime config version 时要求。
- SQLite/PostgreSQL baseline apply dry-run。
- SQLite/PostgreSQL migration dry-run 只在存在后续 migration 时要求。
- unknown enum fallback。
- deprecated field warning。
