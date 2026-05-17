# 17 AutoCut Database Contract Standard

日期：2026-05-04
状态：accepted

## 目标

本标准把根目录 `DATABASE_SPEC.md` 固化为 `sdkwork-video-cut` 的数据库定义事实来源。任何后续 Host、Tauri 本地存储、服务端协作、迁移脚本、schema registry、SDK DTO 或 OpenAPI 扩展，只能在满足 `DATABASE_SPEC.md` 的前提下定义表结构。

当前 AutoCut 桌面基线仍是纯前端 Tauri 壳和 `packages/sdkwork-autocut-*` 产品模块，没有提交运行时数据库表、DDL 或 schema registry 产物。本标准先冻结准入规则，避免后续为了快速落库产生不符合通用数据库规范的技术债。

## 权威规范

- 根目录 `DATABASE_SPEC.md` 是数据库定义的 canonical standard。
- 新建表最低合规等级为 L1。
- 新表必须先写可移植数据契约，再生成或校验 SQL DDL、ORM 实体、DTO、OpenAPI、SDK 和迁移脚本。
- schema registry 是后续数据库产物的首选事实来源，可以用 YAML 或 JSON 表达表名、字段、逻辑类型、索引、约束、owner、画像、版本和安全策略。
- 任何数据库产物不得只以 TypeScript interface、Rust struct、Java entity 或单一数据库 SQL 作为唯一事实来源。

## 当前落地边界

当前应用不新增物理数据库实现，不恢复旧 `host/database`、`docs/database`、`deploy` 或旧 runtime 队列表。原因是当前需求是全新 Tauri 前端应用标准化，尚未定义真实 Host 写入、同步、多租户、任务队列和持久化边界。

后续只有在明确引入本地 Host 或服务端协作能力时，才允许新增数据库目录。新增时必须同时提交：

- schema registry 表契约；
- 迁移脚本；
- 目标数据库方言说明；
- 数据 owner 和写入所有者；
- 自动化检查规则；
- API/SDK 字段映射；
- 兼容、回填、灰度和回滚或前滚方案。

## 表身份字段硬约束

每张表都必须同时定义 `id` 和 `uuid`。

`id` 的逻辑类型必须是 `int64`，语言映射为 Java/Rust/TypeScript 侧的 long/64 位整数语义。物理数据库可按方言映射为 PostgreSQL `BIGINT`、MySQL `BIGINT`、SQLite `INTEGER`、SQL Server `BIGINT` 或 Oracle `NUMBER(19)`，但契约层必须统一标记为 `int64`。

`uuid` 是外部稳定标识，用于 API、SDK、跨库同步、补偿、导入导出和日志排障。核心业务表必须给 `uuid` 建唯一约束或等价唯一策略。

最低字段基线：

| 字段 | 逻辑类型 | 必须性 | 说明 |
| --- | --- | --- | --- |
| `id` | `int64` | MUST | 内部主键，具备 long/64 位整数语义。 |
| `uuid` | `string(36..64)` | MUST | 外部稳定 ID，推荐 UUID v7、UUID v4、ULID 或 KSUID。 |
| `created_at` | `instant` | MUST | 创建时间，UTC。 |
| `updated_at` | `instant` | MUST | 最近更新时间，UTC。 |
| `version` | `int64` | MUST | 乐观锁或数据版本，初始值为 0。 |

示例契约片段：

```yaml
columns:
  id: { type: int64, required: true, primary_key: true }
  uuid: { type: string, length: 64, required: true, unique: true }
  created_at: { type: instant, required: true }
  updated_at: { type: instant, required: true }
  version: { type: int64, required: true, default: 0 }
```

## Native Host Baseline Artifacts

The package-local native host database baseline is defined under
`packages/sdkwork-autocut-desktop/src-tauri/database/`. Root-level `host/`,
root-level `src-tauri/`, and root-level runtime database folders remain
forbidden.

Required baseline artifacts:

- `database/schema/sqlite/001_baseline.sql`
- `database/schema-registry/autocut_host_baseline.yaml`

The current SQLite baseline covers `media_asset`, `media_artifact`,
`ops_task`, `ops_task_event`, `ops_stage_run`, and `ops_schema_migration`.
Every table MUST keep `id`, `uuid`, `created_at`, `updated_at`, and `version`;
`id` is the logical `int64` identifier and maps to SQLite `INTEGER` storage for
the desktop host.

The native runtime entry point is `run_autocut_database_migrations`, exposed to
the webview only through the controlled `autocut_database_health` Tauri command.
It applies `001_baseline.sql`, writes `ops_schema_migration`, verifies the
schema identity columns, and reports diagnostics without exposing raw SQL
execution to frontend packages.

Native media database writes follow the import-first contract. The
`autocut_import_media_file` command copies a raw local source path into the
desktop media sandbox and writes `media_asset`. Processing commands must then
use `assetUuid` as the boundary, not raw filesystem paths. The configured
workspace `outputDirectory` is passed to native commands as `outputRootDir`.
Audio extraction resolves `media_asset.source_uri`, writes the generated file
under `{outputRootDir}/tasks/{task_uuid}/`, writes `ops_task` and
`ops_stage_run`, and registers `media_artifact.source_asset_uuid` so every
generated artifact remains traceable to the imported source asset. The same
output directory rule applies to GIF generation, video compression, video
conversion, video enhancement, and native smoke artifacts. `{outputRootDir}/inputs/`
is only the imported source sandbox. `media_artifact.uri` must point to the
concrete output file, and both `media_artifact.metadata_json` and
`ops_task.output_json` must include `taskOutputDir`.

The intelligent slicing command `autocut_slice_video` is a multi-artifact native
operation. It still owns exactly one `ops_task` and one `ops_stage_run`, but it
must create one `media_artifact` row per generated slice and one JPEG thumbnail
`media_artifact` row per slice. When real local speech-to-text segments are
supplied with `subtitleFormat: "srt"`, it must also create one SRT subtitle
`media_artifact` row per slice that has overlapping transcript text. All slice
and subtitle files must be stored under `{outputRootDir}/tasks/{task_uuid}/`;
thumbnail files must be stored under `{outputRootDir}/tasks/{task_uuid}/cover/`.
`ops_task.input_json` must persist `assetUuid`, `outputFormat`, `clips`, optional
`subtitleFormat`, optional `subtitleStyleId`, optional `subtitleSegments`, and
the configured `outputRootDir` when present. `ops_task.output_json` must include
`taskOutputDir`, `sliceCount`, and `sliceResults`; each slice result must include
`artifactUuid`, `artifactPath`, `thumbnailArtifactUuid`, `thumbnailArtifactPath`,
`byteSize`, `thumbnailByteSize`, `format`, `startMs`, `durationMs`, and `label`,
plus `subtitleArtifactUuid`, `subtitleArtifactPath`, `subtitleByteSize`, and
`subtitleFormat` when a subtitle artifact was generated.
If source-duration filtering leaves no usable video slice clips, the already
created slice `ops_task` must be marked failed with an audit event, and the
runtime must not complete a task with `sliceCount: 0`.

Native task cancellation uses the existing `ops` tables. No `autocut_*` or
desktop-specific task table is allowed. Cancellation state is represented by
standard integer status values on `ops_task`: processing, completed, failed,
cancel requested, canceled, and interrupted. Cancellation audit entries use
`ops_task_event` event types for cancel requested and canceled. The native host
must update cancellation state only after `taskUuid` resolves to a processing
`ops_task` and a tracked native media process exists in the current desktop
session. That tracked process boundary covers both FFmpeg operations and local
speech-to-text child processes. Untracked, completed, failed, or recovered tasks
must return a typed non-canceled acknowledgement without blind database mutation.

Native task recovery also uses only the existing `ops` tables. The recovery
command is `autocut_recover_native_tasks`, implemented through
`media_runtime.rs` and exposed to the frontend only through
`native-host-client.service.ts`. Recovery must inspect stale non-terminal
`ops_task` rows after desktop startup or explicit diagnostics refresh. If a row
is still tracked by a native media process in the current desktop session,
including FFmpeg and local speech-to-text child processes, recovery must leave
it unchanged. If a stale row is `processing`, recovery marks it `interrupted`;
if it is `cancel_requested`, recovery marks it `canceled`.
Every mutation must write an `ops_task_event` audit row. Recovery must not add a
product-prefixed task table and must not mutate completed, failed, canceled, or
already interrupted rows blindly.
Recovery is lease-aware. Before recovering a candidate, it must expire stale
active `ops_worker_lease` rows whose `expires_at` is not later than the current
SQLite time. If an untracked task still has an active unexpired worker lease,
recovery must defer that task instead of interrupting or canceling it. When an
expired lease drives recovery, the inserted `ops_task_event.payload_json` must
include `leaseUuid`, `leaseStatus`, and `reason: "expiredWorkerLease"` after
passing through `standardize_native_task_event_payload`. The typed
`AutoCutNativeTaskRecoveryResult` must report `expiredLeases` and `deferred`
counts so frontend diagnostics use the native contract instead of querying
SQLite.

Native task retry uses the existing `ops` tables. The retry command is
`autocut_retry_native_task`, exposed through `native-host-client.service.ts`.
Retry may target only `failed`, `canceled`, or `interrupted` source tasks. It
must append a retry requested event to the source task, must create a new `ops_task`
from the source `input_json`, and must return the new retry task
uuid. Retry must not overwrite source task status, progress, error fields,
stages, or artifacts, because those rows are the audit trail for the original
attempt.
When a workspace `outputDirectory` was configured, `ops_task.input_json` must
include `outputRootDir`. Retry must restore it so retried artifacts remain under
`{outputRootDir}/tasks/{task_uuid}/` instead of silently falling back to
the app data media root.

Native task progress uses the existing `ops` tables. The current snapshot is
`ops_task.progress`; every persisted movement must append an
`OPS_TASK_EVENT_TYPE_PROGRESS` row in `ops_task_event`. Progress writes are
allowed only while a task is `processing`, must be monotonic, and must clamp to
the 1..99 range. Only task completion may write progress 100. Interrupted,
canceled, failed, completed, and retry source tasks must keep their historical
progress unchanged. FFmpeg progress text must be parsed through the
`parse_ffmpeg_progress_percent` contract, which maps `out_time_ms`,
`out_time_us`, or `out_time` against a known duration and never reports 100 for
an in-flight task. The native FFmpeg runner must stream `-progress pipe:1`
stdout through `run_tracked_ffmpeg_command_with_progress` and persist accepted
updates through `record_ffmpeg_streaming_progress`; waiting for process exit
before writing progress is not sufficient. Do not add an `autocut_*`,
`video_cut_*`, or product-prefixed progress table.
Tracked native media process cleanup is part of the same consistency contract.
If an FFmpeg progress callback or local speech-to-text poll callback cannot
heartbeat the worker lease, persist progress, or otherwise coordinate with
SQLite, the runtime must stop the child process, join stdout/stderr pipe
readers, remove the tracked process registry entry, and return the original
coordination error with cleanup diagnostics. Native media work must not continue
as orphaned background processing after its `ops_task` coordination path fails.
Local speech-to-text polling must also be throttled by a fixed native media
heartbeat interval. The runtime must heartbeat immediately when the child
process starts, then avoid writing SQLite lease heartbeats on every short wait
loop while the speech process is still running. After the child process exits,
the runtime must force one final heartbeat before joining child pipes and
completing the operation, so a long local transcription cannot finish with a
stale worker lease snapshot.
All `ops_task_event.payload_json` values written by the native host must be
valid JSON and must pass through `standardize_native_task_event_payload` before
insert. The persisted audit JSON and the returned `AutoCutNativeTaskEventSnapshot`
must keep the same stable diagnostic fields: `phase`, `source`, operation when
available, and `progress` for progress/completion events. The frontend receives
both the raw `payloadJson` audit copy and parsed `payload`; direct SQLite reads or
browser-side event payload reconstruction are not allowed.

Native durable execution uses `ops_worker_lease`, not a product-prefixed worker
table. Every native media operation must acquire exactly one active lease before
native media execution, must heartbeat that lease while FFmpeg or local
speech-to-text is still running, and must release it on completed, failed, or
canceled terminal paths. At most one
active lease may exist per `task_uuid`; released and expired rows remain as audit
history. `autocut_list_native_tasks` must expose worker lease snapshots through
`AutoCutNativeTaskSnapshot.workerLeases` so frontend diagnostics never read
SQLite directly. The `nativeWorkerLeaseReady` capability means this lease table,
runtime helper, heartbeat, release, and snapshot contract are present; it does
not by itself make `ffmpegExecutionReady` true.

This baseline is intentionally still a host database contract, not proof that
FFmpeg execution is production-ready. `ffmpegExecutionReady` MUST remain false
until real file sandboxing, durable task execution, stage events, failure
recovery, and FFmpeg smoke verification are implemented.
The release evidence chain must include
`scripts/write-autocut-native-release-smoke.mjs` before the aggregate
`scripts/write-autocut-release-evidence.mjs` run, so `autocut_audio_smoke`,
`autocut_recover_native_tasks`, expired lease recovery, and deferred active lease
behavior have a structured audit artifact under `artifacts/release/`.
It must also include `scripts/write-autocut-installer-signature-evidence.mjs`
and the final `scripts/check-autocut-commercial-release-readiness.mjs` hard gate,
so unsigned installers and incomplete FFmpeg execution readiness cannot be
misreported as commercial release readiness.

示例 SQL 片段：

```sql
id BIGINT NOT NULL,
uuid VARCHAR(64) NOT NULL,
created_at TIMESTAMP NOT NULL,
updated_at TIMESTAMP NOT NULL,
version BIGINT NOT NULL DEFAULT 0
```

## 业务模块前缀注册

AutoCut 的表名必须遵循 `DATABASE_SPEC.md` 中的 `<module_prefix>_<entity_name>` 模型。表名前缀表达业务域，不表达产品名、项目名、公司名、前端应用名或技术栈。

当前预留的业务前缀如下：

| 前缀 | 业务边界 | 代表性未来表名 |
| --- | --- | --- |
| `media` | 媒体资产、素材、转码产物、提取结果和文件引用 | `media_asset`、`media_artifact`、`media_text_extract` |
| `ops` | 任务、队列、阶段执行、事件、诊断、worker lease | `ops_task`、`ops_stage_run`、`ops_task_event` |
| `studio` | 工作台项目、剪辑方案、时间线、用户编辑草稿 | `studio_project`、`studio_timeline`、`studio_clip` |

MUST NOT 使用 `autocut_`、`video_cut_`、`sdkwork_`、`plus_` 作为新表名前缀。它们分别是产品、应用、组织或历史项目命名空间，不是业务模块前缀。部署或产品命名空间应放在 database/schema/catalog 层，而不是物理表名第一段。

除 `media`、`ops`、`studio` 外新增前缀时，必须先更新本标准、schema registry 前缀注册表和治理脚本，再创建表。

## 表契约模板

每张新表设计必须先提交契约，最低包含：

```yaml
table_name: media_asset
table_profile: tenant_entity
owner_team: autocut
compliance_level: L1
contract_version: 1.0.0
system_of_record: true
write_owner: sdkwork-video-cut-host
columns:
  id: { type: int64, required: true, primary_key: true }
  uuid: { type: string, length: 64, required: true, unique: true }
  tenant_id: { type: int64, required: true, default: 0 }
  organization_id: { type: int64, required: true, default: 0 }
  status: { type: enum_int32, required: true }
  created_at: { type: instant, required: true }
  updated_at: { type: instant, required: true }
  version: { type: int64, required: true, default: 0 }
indexes:
  - name: uk_media_asset_uuid
    unique: true
    columns: [uuid]
  - name: idx_media_asset_tenant_status_updated
    columns: [tenant_id, organization_id, status, updated_at, id]
serialization:
  int64: string
  time: iso8601_utc
```

业务字段必须按查询、权限、生命周期、审计和 SDK 需求明确列化。高频查询、唯一约束、状态、租户、owner、时间排序字段不得只藏在 JSON 中。

## 迁移与 Provider

未来引入数据库时，参考 BirdCoder 的 Provider 分层，但不复制其业务模型：

```text
Domain Contract -> Repository -> UnitOfWork -> StorageProvider -> Dialect -> SchemaMigration -> BlobStore
```

规则：

- 本地桌面权威存储优先使用 SQLite，服务端协作权威存储优先使用 PostgreSQL。
- 同一逻辑表在 SQLite 和 PostgreSQL 下必须保持字段语义一致。
- 迁移必须前向演进，结构变更需要 `migrationId` 和契约版本。
- 不允许只写单库脚本而不定义逻辑契约。
- 不允许页面、React hooks 或 `packages` 产品模块直接感知数据库 Provider。

## 治理

`pnpm check:autocut-architecture` 必须覆盖数据库准入：

- 根目录 `DATABASE_SPEC.md` 必须存在，且不得被 `.gitignore` 隐藏；
- 本文件必须作为 AutoCut 数据库契约标准存在；
- `DATABASE_SPEC.md` 必须包含 L1、schema registry、DB061、DB072、`id`、`uuid`、`int64`、`created_at`、`updated_at`、`version` 等关键规范锚点；
- 未来 SQL `CREATE TABLE` 必须使用小写下划线表名，且第一段不得使用 `autocut`、`video_cut`、`sdkwork`、`plus`、`app`、`sys`、`common`；
- 未来 SQL `CREATE TABLE` 必须定义 `id` 和 `uuid`，其中 `id` 必须使用 long/int64 等价存储；
- 未来 YAML schema registry 中的 `table_name` 必须遵循业务模块前缀规则。

该治理只检查准入底线；实际表设计评审仍必须逐条对照 `DATABASE_SPEC.md` 的完整 DB001-DB072 规则。
