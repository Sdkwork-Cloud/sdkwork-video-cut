# 通用数据库定义标准规范

- 版本：1.0
- 定位：跨语言、跨框架、跨 ORM、跨数据库产品的表结构定义标准
- 适用对象：后端服务、数据平台、SDK 生成器、DDL/结构变更脚本、审计工具、数据库设计评审

本文档定义一套通用数据库表结构标准。它不绑定 Java、Spring、JPA、Hibernate、Rust、Python、TypeScript、Go、PHP、C# 或任何单一技术栈，也不要求所有应用使用同一个 ORM 或同一套基础类。它的目标是把表结构抽象成稳定的数据契约，使不同语言、不同框架、不同数据库之间可以共享数据语义、生成 SDK、拆分服务、替换数据库并长期演进。

本文以关系数据库为主契约来源，同时给出文档库、列式库、搜索索引、事件流、读模型的派生规则。任何工程中的实体基类、历史 DDL、结构变更脚本或代码生成器，只能作为兼容映射参考；通用规范应以本文定义的字段语义、逻辑类型、约束、索引、结构演进规则和跨语言序列化规则为准。

## 1. 规范等级

本文使用 RFC 风格的约束词：

| 词 | 含义 |
| --- | --- |
| MUST | 强制要求。不满足即不符合本规范。 |
| MUST NOT | 强制禁止。不允许以项目习惯绕过。 |
| SHOULD | 强烈建议。只有在有明确理由、风险记录和替代方案时可以偏离。 |
| SHOULD NOT | 强烈不建议。偏离时必须记录原因。 |
| MAY | 可选能力。由业务域、性能、合规或部署条件决定。 |

合规等级：

| 等级 | 名称 | 适用场景 | 最低要求 |
| --- | --- | --- | --- |
| L0 | Legacy Compatible | 存量系统过渡 | 标准字段映射表、兼容边界、风险说明 |
| L1 | Portable Core | 新业务表最低标准 | 标识、审计、命名、逻辑类型、基础索引 |
| L2 | Service Ready | 多服务共享或拆分 | 多租户/归属、幂等、API 序列化、结构演进治理 |
| L3 | Enterprise Grade | 金融、支付、合规、高可用 | 审计、隐私、生命周期、事件一致性、自动化检查 |

新建核心业务表 MUST 达到 L1。多租户、支付、账户、权限、消息、第三方回调、跨服务写入表 MUST 达到 L2。涉及资金、凭证、隐私、法务留存、关键审计的表 SHOULD 达到 L3。

### 1.1 标准产物

任何采用本规范的项目 SHOULD 形成以下标准产物，而不是只在某个语言模型或 ORM 注解中隐式表达：

| 产物 | 要求 |
| --- | --- |
| 表结构契约 | 记录表名、字段、逻辑类型、约束、索引、owner、画像和合规等级 |
| 业务模块前缀注册表 | 记录允许使用的 `<module_prefix>`、业务边界、owner 和示例 |
| 公共字段字典 | 记录 `id`、`uuid`、`tenant_id`、`created_at` 等公共字段唯一语义 |
| 逻辑类型映射表 | 记录逻辑类型到 PostgreSQL、MySQL、SQLite、SQL Server、Oracle 等数据库的映射 |
| 跨语言序列化规则 | 记录 `int64`、decimal、instant、enum、json 在 API/SDK 中的表达 |
| 自动化检查规则 | 记录 schema linter、CI、代码生成器需要检查的规则编号 |
| 例外登记表 | 记录历史兼容、工具元数据表、临时表、外部 raw 表等例外原因和退出条件 |

最低落地要求：

- 新表设计 MUST 先写契约，再生成或校验 DDL、ORM、DTO、SDK。
- 新业务模块 MUST 先登记前缀，再创建表。
- 任何例外 MUST 可追踪，不能成为团队习惯。
- 多语言服务 MUST 以契约为准，不以某个语言的类名、注解或结构变更脚本为准。

## 2. 适用范围

适用场景：

- 多语言后端：Rust、Python、TypeScript/Node.js、Java/Kotlin、Go、PHP、C#/.NET、Ruby、Elixir 等服务共享数据库或同步数据。
- 多数据库部署：PostgreSQL、MySQL/MariaDB、SQLite、SQL Server、Oracle、ClickHouse、国产数据库、云数据库之间替换、同步和互通。
- 单体拆微服务：从单一业务库逐步拆分为服务库、事件库、读模型库、搜索索引库、审计库。
- 多租户系统：按租户、组织、工作区、应用、项目、用户、主体归属隔离数据。
- SDK/API 生成：数据库字段稳定映射到 OpenAPI、GraphQL、gRPC、TypeScript SDK、Python SDK、Rust DTO、Go client、C# client。
- 历史库治理：旧表逐步补齐审计字段、租户字段、唯一键、幂等键、状态字段和契约版本。
- 数据平台协作：数仓、湖仓、CDC、报表、归档和脱敏链路需要稳定字段语义。

不绑定内容：

- 不规定必须使用某种语言、框架、ORM、结构变更工具或代码生成器。
- 不规定必须使用 PostgreSQL、MySQL 或任一数据库。
- 不要求所有表都建立数据库外键。
- 不要求所有服务使用同一套基础类。
- 不要求所有业务都暴露内部主键。
- 不要求为了“通用”牺牲明确的业务约束。

## 3. 核心原则

1. **数据契约优先**：字段名、类型、约束和语义比 ORM 注解或语言类名更稳定。
2. **逻辑类型先行**：先定义 `int64`、`instant`、`decimal`、`json` 等逻辑类型，再映射到具体数据库类型。
3. **跨语言安全**：`int64`、`decimal`、时间、枚举、JSON 的 API 表达必须避免精度和时区错误。
4. **隔离条件显式**：租户、组织、用户、owner、数据范围不能只靠口头约定。
5. **变更可灰度**：任何破坏性结构变更必须经过扩展、兼容、校验、切换、收缩，不得只靠一次性脚本假设成功。
6. **核心查询列化**：高频查询、唯一约束、排序、权限过滤字段 MUST 是独立列，不能只藏在 JSON 中。
7. **可审计可追踪**：核心业务数据必须能回答谁创建、何时创建、属于谁、为何变化、如何重放或补偿。
8. **历史兼容可映射**：存量字段可以短期保留，但必须有标准字段映射、兼容边界和退出说明。
9. **数据库能力分层**：可以使用数据库特性优化，但公共契约不能依赖不可移植的专有特性。
10. **工具可检查**：规范必须能被 schema linter、结构变更审查、代码生成器和 CI 部分自动验证。

## 4. 可移植数据契约

通用表结构不直接等于某个数据库 DDL，也不等于某个语言的实体类。标准的中间层称为可移植数据契约，包含：

| 契约元素 | 必须描述 |
| --- | --- |
| `table_name` | 标准表名、业务域、所有者团队 |
| `table_profile` | 表画像，例如业务实体、日志、账本、读模型 |
| `columns` | 字段名、逻辑类型、长度/精度、空值策略、默认值 |
| `constraints` | 主键、唯一键、检查约束、外键或应用级引用 |
| `indexes` | 查询目标、字段顺序、唯一性、部分索引条件 |
| `ownership` | 租户、组织、用户、owner、平台共享数据规则 |
| `lifecycle` | 创建、更新、删除、归档、留存、清理策略 |
| `serialization` | API/SDK 字段名、`int64`、decimal、时间、枚举表达 |
| `evolution` | 契约版本、兼容期、弃用策略、校验方式、收缩条件 |
| `security` | 敏感字段、加密、脱敏、访问审计 |

推荐以 YAML、JSON、DSL、注解扫描结果或结构变更清单维护该契约。DDL、ORM 模型、SDK DTO、OpenAPI schema 都 SHOULD 从契约生成或经过契约校验。

示例：

```yaml
table_name: commerce_payment
table_profile: ledger_event
owner_team: commerce
compliance_level: L3
columns:
  id: { type: int64, required: true, primary_key: true }
  uuid: { type: string, length: 64, required: true, unique: true }
  tenant_id: { type: int64, required: true }
  organization_id: { type: int64, required: true, default: 0 }
  amount: { type: decimal, precision: 18, scale: 2, required: true }
  currency: { type: string, length: 10, required: true }
  status: { type: enum_int32, required: true }
  created_at: { type: instant, required: true }
  updated_at: { type: instant, required: true }
indexes:
  - name: uk_commerce_payment_uuid
    unique: true
    columns: [uuid]
  - name: idx_commerce_payment_tenant_status_created
    columns: [tenant_id, organization_id, status, created_at]
serialization:
  int64: string
  decimal: string
  time: iso8601_utc
```

### 4.1 事实来源和服务边界

每张表 MUST 明确事实来源和写入所有者：

| 属性 | 说明 |
| --- | --- |
| `system_of_record` | 是否为事实来源。主表、账本、审计日志通常为 true；读模型、搜索索引通常为 false。 |
| `write_owner` | 允许写入该表的服务、任务或数据管道。 |
| `read_consumers` | 依赖该表的主要服务、报表、搜索、数仓或 SDK。 |
| `change_channel` | 变更传播方式，例如 CDC、outbox、批处理、API 同步。 |
| `compatibility_window` | 字段变更需要兼容的最短时间。 |

规则：

- 一张核心业务表 SHOULD 只有一个写入所有者。多服务写同一张表时，必须有统一写入网关、存储过程、事件命令模型或清晰的并发控制。
- 跨服务共享表 MUST 有契约版本和变更通知机制。
- 读模型、搜索索引、缓存表 MUST 声明其来源表和重建方式。
- 任何服务不得因为“能连上数据库”就直接写入其它服务拥有的表。

### 4.2 Schema Registry

大型系统 SHOULD 维护 schema registry，用于管理表契约、字段字典、结构演进状态和 SDK 映射。schema registry 可以是代码仓库中的 YAML/JSON 文件、数据库元数据表、OpenAPI 扩展、数据目录系统或内部平台。

schema registry 至少 SHOULD 支持：

- 查询字段语义、敏感等级、逻辑类型和序列化方式。
- 校验 DDL 与契约是否一致。
- 生成或校验 ORM 模型、DTO、OpenAPI、GraphQL、gRPC schema。
- 记录破坏性变更、兼容窗口和演进进度。
- 标识事实来源、读模型、数据 owner 和下游消费者。

### 4.3 领域边界和建模粒度

表结构必须服务业务领域边界，而不是把所有数据放进一个“万能表”或跨多个服务共享同一张表。

| 概念 | 标准要求 |
| --- | --- |
| 业务域 | 每张核心表 MUST 归属一个业务域，例如 iam、commerce、content、notification |
| bounded context | 跨服务共享语义前 MUST 明确上下文，避免同名字段在不同领域含义不同 |
| aggregate root | 强一致写入 SHOULD 围绕聚合根设计，聚合内使用事务，聚合间使用事件 |
| shared kernel | 多服务共享字段必须进入公共契约，不能靠复制粘贴 DTO 维持一致 |
| anti-corruption layer | 外部系统字段 SHOULD 通过适配层映射到内部标准字段 |

规则：

- 表名、字段名、枚举名 SHOULD 能反映所属业务域，避免 `common_data`、`system_record`、`business_info` 这类无边界名称。
- 一个字段在不同业务域含义不同时，MUST 使用不同字段名或在契约中标注上下文，不能用同一个 `type`、`status`、`source` 承载多套含义。
- 跨服务 join 不应成为核心在线路径。需要跨服务查询时，SHOULD 通过读模型、搜索索引、API composition 或事件投影实现。
- 主数据表和交易事实表 SHOULD 分开设计。例如用户资料是主数据，订单、支付、流水是事实数据。
- 外部系统 ID 必须使用 `external_*` 或带 provider 前缀的字段，不得混入内部 `id` 语义。

### 4.4 范式、反范式和快照

通用标准不要求所有表达到同一范式，但必须说明为何拆表或冗余。

| 设计 | 适用场景 | 风险 |
| --- | --- | --- |
| 规范化 | 主数据、配置、权限、强一致引用 | join 增多、跨服务拆分困难 |
| 反规范化 | 列表读模型、搜索、报表、历史快照 | 冗余字段漂移 |
| 快照 | 订单、合同、支付请求、审计事件 | 快照字段版本膨胀 |
| 宽表 | 报表、列表页、离线分析 | 写入成本高、字段治理难 |
| EAV | 动态属性、低频扩展 | 查询和约束弱，不能承载核心字段 |

规则：

- 事实数据 SHOULD 保存发生当时的关键快照，例如订单商品名、价格、买家信息，避免历史事实随主数据变化。
- 快照字段 MUST 有 schema version，并能说明来源对象和采集时间。
- 读模型中的冗余字段 MUST 有重建路径和漂移校验。
- EAV 模型 MUST NOT 用于金额、状态、租户、权限、幂等等核心字段。
- 反规范化字段 SHOULD 在名称或契约中标注来源，例如 `seller_name_snapshot`、`product_title_snapshot`。

## 5. 表画像

表画像决定必备字段、索引、约束、写入策略和结构演进要求。新表 MUST 先选择一个主画像，可以叠加多个附加画像。

### 5.1 主画像

| 画像 | 用途 | 必备字段组 |
| --- | --- | --- |
| `core_entity` | 用户、订单、商品、文件、会话等核心业务对象 | 标识、审计、生命周期 |
| `tenant_entity` | SaaS、多组织、多应用数据 | 标识、审计、租户、生命周期 |
| `user_entity` | 用户私有数据、用户创建内容 | 标识、审计、租户、用户、生命周期 |
| `owner_entity` | 可归属不同主体的资源 | 标识、审计、owner、生命周期 |
| `tree_entity` | 分类、目录、组织、项目树 | 标识、审计、父节点、路径、排序 |
| `relation_entity` | 用户角色、订单商品、标签关系 | 标识、审计、关系唯一键 |
| `dictionary_entity` | 字典、配置、渠道、枚举扩展 | 标识、code、状态、版本 |
| `event_log` | 回调、任务、操作记录、异步事件 | 标识、幂等、payload、处理状态 |
| `ledger_entry` | 账户流水、余额变化、积分流水 | 标识、账本方向、金额、幂等、不可变 |
| `audit_log` | 安全审计、后台操作、合规追踪 | 标识、操作者、目标对象、请求链路、不可变 |
| `outbox_event` | 本地事务后发布事件 | 标识、聚合对象、事件类型、payload、发布状态 |
| `inbox_event` | 消费方去重和处理记录 | 标识、消息来源、幂等键、处理状态 |
| `projection` | 读模型、列表缓存、聚合视图 | 来源对象、同步版本、重建标记 |
| `snapshot` | 历史快照、订单快照、配置快照 | 来源对象、版本、快照内容 |
| `temporary` | 临时导入、短期缓存、中间结果 | 标识、过期时间、清理策略 |

### 5.2 字段组

| 字段组 | 字段 | 说明 |
| --- | --- | --- |
| `identity` | `id`, `uuid` | 内部关联和外部稳定标识 |
| `audit` | `created_at`, `updated_at`, `version` | 创建、更新、乐观锁 |
| `actor_audit` | `created_by`, `updated_by`, `operator_id` | 操作人追踪 |
| `tenant_scope` | `tenant_id`, `organization_id`, `data_scope` | 租户和组织隔离 |
| `user_scope` | `user_id` | 用户私有或用户归属 |
| `owner_scope` | `owner_type`, `owner_id` | 多主体归属 |
| `lifecycle` | `status`, `deleted_at`, `deleted_by`, `archived_at` | 生命周期和软删除 |
| `tree` | `parent_id`, `parent_uuid`, `path`, `level_no`, `sort_order` | 树形结构 |
| `idempotency` | `request_id`, `idempotency_key`, `external_event_id`, `payload_hash` | 幂等与重放 |
| `trace` | `trace_id`, `span_id`, `source_system`, `source_version` | 链路追踪和来源 |
| `retention` | `expire_at`, `retention_until`, `legal_hold` | 留存、TTL、法务冻结 |

### 5.3 画像最低字段

| 画像 | MUST |
| --- | --- |
| `core_entity` | `id`, `uuid`, `created_at`, `updated_at`, `version`, `status` |
| `tenant_entity` | `core_entity` + `tenant_id`, `organization_id`, `data_scope` |
| `user_entity` | `tenant_entity` + `user_id` |
| `owner_entity` | `tenant_entity` + `owner_type`, `owner_id` |
| `tree_entity` | `tenant_entity` + `parent_id`, `parent_uuid`, `sort_order` |
| `relation_entity` | `id`, `uuid`, 两端引用 ID, 关系唯一键, `created_at` |
| `dictionary_entity` | `id`, `uuid`, `code`, `name`, `status`, `created_at`, `updated_at`, `version` |
| `event_log` | `id`, `uuid`, `created_at`, `status`, `idempotency_key` 或 `external_event_id`, `payload_hash` |
| `ledger_entry` | `id`, `uuid`, `created_at`, `account_id`, `direction`, `amount`, `currency`, `business_no`, `idempotency_key` |
| `audit_log` | `id`, `uuid`, `created_at`, `operator_id`, `action`, `target_type`, `target_id`, `request_id` |
| `outbox_event` | `id`, `uuid`, `aggregate_type`, `aggregate_id`, `event_type`, `event_version`, `payload`, `status`, `created_at` |
| `inbox_event` | `id`, `uuid`, `source_system`, `message_id`, `consumer_name`, `status`, `created_at` |
| `projection` | `id`, `source_type`, `source_id`, `source_version`, `updated_at`, `rebuild_version` |
| `temporary` | `id`, `created_at`, `expire_at` |

## 6. 标准字段字典

字段字典定义公共字段的唯一语义。任何业务表只要使用同名字段，就 MUST 遵守该语义。

### 6.1 标识字段

| 字段 | 逻辑类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `int64` | MUST | 内部主键，单表唯一，推荐全局唯一 |
| `uuid` | `string(36..64)` | SHOULD | 外部稳定标识，用于 API、同步、补偿、跨库引用 |
| `code` | `string(32..128)` | MAY | 业务编码、字典编码、可读引用 |
| `business_no` | `string(32..128)` | MAY | 业务单号，例如订单号、支付单号 |

规则：

- `id` MUST 使用 64 位整数或可稳定映射到 64 位的内部 ID。推荐雪花 ID、号段服务、数据库序列批量领取、ULID/UUID 派生策略。新系统 SHOULD NOT 依赖单库自增 ID 作为跨服务主键策略。
- `uuid` SHOULD 全局唯一，推荐 UUID v7、UUID v4、ULID、KSUID 或组织统一字符串 ID。对外 API 优先暴露 `uuid`、`code` 或 `business_no`，不要默认暴露内部自增 ID。
- `code` 用于人类可读或配置引用，MUST 明确唯一范围，例如全局唯一、租户内唯一、类型内唯一。
- `business_no` 一旦对外发布 MUST 不可复用。

### 6.2 审计字段

| 字段 | 逻辑类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `created_at` | `instant` | MUST | 创建时间，UTC |
| `updated_at` | `instant` | MUST | 最近更新时间，UTC |
| `version` | `int64` | MUST | 乐观锁或数据版本，初始 0 |
| `created_by` | `int64` | SHOULD | 创建人 |
| `updated_by` | `int64` | SHOULD | 最近更新人 |

规则：

- 新表 MUST 使用 `created_at`、`updated_at`，不要使用 `created_time`、`update_time`、`gmt_create` 等变体作为标准字段。
- 存储精度 SHOULD 至少毫秒，L3 表 SHOULD 支持微秒。
- 审计时间 MUST 由服务端或数据库端可信时间生成。客户端传入时间只能作为业务时间字段，不能覆盖审计时间。
- `version` MUST 在并发更新时参与条件更新，或有等价的数据版本机制。
- 存量系统使用短字段 `v` 时，可在兼容期保留，但契约层 MUST 映射为 `version`。

### 6.3 租户和组织字段

| 字段 | 逻辑类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tenant_id` | `int64` | 多租户表 MUST | 租户 ID |
| `organization_id` | `int64` | 多组织表 MUST | 组织 ID，没有组织时为 0 |
| `workspace_id` | `int64` | MAY | 工作区 ID |
| `project_id` | `int64` | MAY | 项目 ID |
| `data_scope` | `int32` 或 enum | 多租户表 SHOULD | 数据可见范围 |

`data_scope` 推荐值：

| 值 | 名称 | 含义 |
| ---: | --- | --- |
| `0` | `DEFAULT` | 未指定或沿用默认范围 |
| `1` | `PRIVATE` | 私有数据，只对所属主体可见 |
| `2` | `ORGANIZATION` | 组织内可见 |
| `3` | `TENANT` | 租户内可见 |
| `4` | `PUBLIC` | 平台公开或全局可见 |

规则：

- 多租户表查询 MUST 显式带上 `tenant_id` 条件，除平台级管理、离线治理任务和明确授权的跨租户任务。
- `tenant_id = 0` 表示平台共享数据，MUST 在表契约中声明。
- `organization_id = 0` 表示租户级数据，不代表未知或空。
- 跨租户引用 MUST 同时校验 `tenant_id` 或声明为平台共享引用。
- RLS、ORM filter、repository wrapper、SQL builder、存储过程、数据访问网关都只是实现方式，核心要求是隔离条件不能被业务代码随意绕过。

### 6.4 用户和主体字段

| 字段 | 逻辑类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | `int64` | 用户数据 MUST | 用户 ID |
| `owner_type` | `string(32)` 或 `int32` | 多主体归属 MUST | 主体类型 |
| `owner_id` | `int64` | 多主体归属 MUST | 主体 ID |
| `operator_id` | `int64` | 操作记录 SHOULD | 当前操作人 |
| `operator_type` | `string(32)` 或 `int32` | MAY | USER、SYSTEM、ADMIN、JOB、SERVICE |

规则：

- `owner_type/owner_id` 用于资源可能归属于用户、组织、租户、应用、项目、服务账号等不同主体的场景。
- `owner_type` 若对外暴露 SHOULD 使用字符串枚举，例如 `USER`、`ORG`、`TENANT`、`APP`、`PROJECT`。高频内部表 MAY 使用整数枚举，但必须有稳定映射。
- `operator_id` 表示执行动作的主体，不等于数据所有者。
- 匿名或设备级数据 MUST 有等价主体字段，例如 `device_id`、`session_id`，且必须明确清理和合并策略。

### 6.5 生命周期字段

| 字段 | 逻辑类型 | 说明 |
| --- | --- | --- |
| `status` | `int32` 或 `string(32)` | 业务生命周期状态 |
| `deleted_at` | `instant` | 软删除时间 |
| `deleted_by` | `int64` | 删除人 |
| `archived_at` | `instant` | 归档时间 |
| `expire_at` | `instant` | 过期时间 |
| `retention_until` | `instant` | 最短留存到期时间 |
| `legal_hold` | `boolean` | 法务冻结，禁止清理 |

规则：

- 核心业务表 SHOULD 用 `status` 表达生命周期。`is_deleted` 只适合极简单软删除，不适合复杂状态机。
- 有审计要求的删除 MUST 记录 `deleted_at` 和 `deleted_by`，或写入不可变审计日志。
- 物理删除 MAY 用于临时表、缓存表、过期中间数据、测试数据或法规要求的删除，但必须明确影响范围。
- 清理任务 MUST 遵守 `retention_until` 和 `legal_hold`。

### 6.6 树形字段

| 字段 | 逻辑类型 | 说明 |
| --- | --- | --- |
| `parent_id` | `int64` | 父节点内部 ID，根节点为 0 |
| `parent_uuid` | `string(64)` | 父节点外部 ID，根节点为 `0` |
| `path` | `string(1000..4000)` | 祖先路径，可用 `/1/2/3/` |
| `level_no` | `int32` | 层级，根节点为 0 |
| `sort_order` | `int32` | 同级排序 |

规则：

- 树形表 MUST 避免仅依赖递归查询作为唯一读取路径。高频场景 SHOULD 维护 `path` 或闭包表。
- 跨库同步、API 或离线导入时 SHOULD 使用 `parent_uuid`。
- `parent_id > 0` 时 SHOULD 同时提供 `parent_uuid`，避免跨库 ID 重映射时丢失父子关系。

### 6.7 幂等和链路字段

| 字段 | 逻辑类型 | 说明 |
| --- | --- | --- |
| `request_id` | `string(64..128)` | 请求 ID，贯穿链路 |
| `trace_id` | `string(64..128)` | 分布式追踪 ID |
| `idempotency_key` | `string(128..200)` | 幂等键 |
| `external_event_id` | `string(128..255)` | 第三方事件 ID |
| `payload_hash` | `string(64..128)` | payload 摘要 |
| `source_system` | `string(32..64)` | 来源系统 |
| `source_version` | `string(32..64)` | 来源版本 |

规则：

- 支付、退款、Webhook、消息消费、批量导入、任务执行、账号变动、文件上传完成通知 MUST 有幂等字段和唯一约束。
- `request_id` 用于追踪，不一定唯一；`idempotency_key` 用于去重，必须定义唯一范围。
- `payload_hash` SHOULD 使用 SHA-256 或组织认可算法，不存储高敏原文摘要前必须评估重识别风险。

### 6.8 空值和默认值

空值策略 MUST 明确表达业务语义：

| 场景 | 推荐策略 |
| --- | --- |
| 必须存在的业务字段 | `NOT NULL`，由应用或数据库默认值填充 |
| 未知值 | 允许 `NULL`，但必须说明未知来源 |
| 不适用 | 优先使用单独状态或类型字段说明，不要滥用 `NULL` |
| 数量和金额 | 通常 `NOT NULL DEFAULT 0`，但要区分“无记录”和“零值” |
| 租户级组织字段 | `organization_id NOT NULL DEFAULT 0` |
| 根节点 | `parent_id NOT NULL DEFAULT 0`、`parent_uuid NOT NULL DEFAULT '0'` |

规则：

- `NULL`、空字符串、0、`UNKNOWN` 不能混用表达同一个含义。
- 新增非空字段 MUST 先以可空或默认值方式扩展，完成回填后再加非空约束。
- 默认值不能掩盖缺失上下文。例如多租户业务写入缺少 `tenant_id` 时，不应静默写成 0，除非明确是平台共享数据。
- 布尔字段 SHOULD 避免三态。如果确需三态，字段名和文档必须说明 `NULL` 的含义。

### 6.9 字段注释和数据字典

生产表 SHOULD 有列注释或外部数据字典。注释不是展示文案，而是数据语义说明。

字段说明至少包含：

- 业务含义。
- 单位或精度。
- 枚举值或引用字典。
- 是否敏感。
- 是否可为空。
- 默认值含义。
- 是否对外暴露。

示例：

```yaml
amount:
  type: decimal
  precision: 18
  scale: 2
  required: true
  unit: currency_minor_or_major_unit_by_domain
  sensitive: false
  description: 支付金额，按 currency 指定币种解释
```

### 6.10 ID 生成和公开标识

ID 策略是跨语言、跨数据库、跨区域同步和互通的基础设施能力，必须在契约中明确。

| ID 类型 | 用途 | 推荐策略 |
| --- | --- | --- |
| `id` | 内部主键、join、审计引用 | 64 位整数，雪花 ID、号段、数据库序列批量领取 |
| `uuid` | 外部引用、同步、API、事件 | UUID v7、UUID v4、ULID、KSUID 或组织统一字符串 ID |
| `business_no` | 业务单号、人工排障、对账 | 业务域前缀 + 时间/序列/随机段，避免泄露规模 |
| `external_*_id` | 第三方系统 ID | provider + 外部 ID 联合唯一 |

规则：

- ID 生成器 MUST 明确节点 ID、时钟回拨、序列溢出、重启恢复和监控策略。
- 雪花 ID 或时间有序 ID 在多区域部署时 MUST 处理 clock rollback，不能假设机器时钟永远单调。
- 对外公开 ID SHOULD 使用 `uuid`、ULID、KSUID 或业务单号，不直接暴露连续自增 ID。
- 业务单号不能只由时间戳组成，必须考虑并发、重试、预测风险和人工录入校验。
- 第三方 ID MUST 以 `provider + external_id` 作为唯一边界，不能假设外部 ID 全局唯一。
- 批量导入、离线写入、边缘节点写入 MUST 使用与在线服务兼容的 ID 策略。
- ID 生成失败必须失败关闭，不得退化为本地随机短 ID 或数据库自增，除非契约明确允许。

## 7. 命名规范

### 7.1 表名

MUST：

- 使用小写下划线：`commerce_payment`、`iam_role_permission`。
- 使用明确业务名，不使用纯技术名。
- 在多业务域系统中 SHOULD 使用域前缀：`iam_`、`commerce_`、`content_`、`notification_`。
- 关联表 SHOULD 使用两端实体名并保留业务模块前缀：`iam_user_role`、`commerce_order_item`。
- 新建业务表的第一段 MUST 是业务模块前缀，格式为 `<module_prefix>_<entity_name>`。
- 实体名称 SHOULD 使用单数名词。集合、历史、事件、快照、明细等语义通过 `item`、`history`、`event`、`snapshot`、`detail` 等后缀表达，而不是简单使用复数。

SHOULD NOT：

- 大小写混用：`UserRole`、`T_UserInfo`。
- 随意缩写：`usr`、`ord_itm`。
- 使用数据库保留字。若业务名是 `order`，落地时使用 `commerce_order`、`sales_order` 或 `commerce_order_record`。
- 把存储实现写进业务表名，例如 `redis_user_cache`。确实是适配表或缓存表时可例外。

### 7.1.1 业务模块前缀

表名前缀用于表达业务模块边界，不用于表达产品名、公司名、项目名、语言、框架或数据库产品。标准格式：

```text
<module_prefix>_<bounded_context?>_<entity_name>[_profile]
```

示例：

| 表名 | 模块前缀 | 说明 |
| --- | --- | --- |
| `iam_user` | `iam` | 身份和访问管理用户 |
| `iam_role_permission` | `iam` | 权限关系表 |
| `commerce_order` | `commerce` | 交易订单 |
| `commerce_payment_webhook_event` | `commerce` | 支付回调事件 |
| `content_article` | `content` | 内容文章 |
| `media_file_part` | `media` | 文件分片 |
| `ai_model_price` | `ai` | AI 模型价格 |
| `integration_channel_account` | `integration` | 外部渠道账号 |
| `studio_project_content` | `studio` | 设计时项目内容 |
| `ops_claw_schedule_task` | `ops` | 运营/任务调度 |
| `data_datasource_table` | `data` | 数据源元数据 |

规则：

- `<module_prefix>` MUST 来自受控模块前缀注册表。
- 模块前缀 MUST 表达业务域，不得使用 `plus_`、`app_`、`sys_`、`common_` 这类项目或泛化前缀作为全局默认前缀。
- 产品、公司、部署环境前缀 SHOULD 放在 database/schema/catalog 层，例如 `plus_business.commerce_order`，不要放在物理表名第一段。
- 模块前缀 MUST 稳定，不随编程语言、框架、前端应用、部署环境、租户或产品线变化。
- 同一模块内表名不得只靠通用名区分，例如 `content_data`、`content_info` 不合格。
- 跨模块共享表必须选择事实来源模块前缀。例如用户角色属于 `iam_`，不应命名为 `user_role` 或 `plus_user_role`。
- 模块拆分时，旧模块前缀不能被新模块复用为不同含义。

模块前缀注册表示例：

| 前缀 | 业务域 | 示例表 |
| --- | --- | --- |
| `iam` | 身份、租户、组织、RBAC、API key、安全策略 | `iam_user`、`iam_tenant`、`iam_role_permission` |
| `commerce` | 订单、支付、退款、账户、优惠券、VIP、商品、发票 | `commerce_order`、`commerce_payment`、`commerce_coupon` |
| `ai` | Agent、模型、提示词、生成任务、AI 工具 | `ai_agent`、`ai_model_info`、`ai_prompt` |
| `content` | 文章、评论、收藏、标签、分享、详情页、投票 | `content_article`、`content_comment` |
| `media` | 文件、图片、视频、语音、音乐、数字人、媒体发布记录 | `media_file`、`media_video` |
| `comms` | 会话、消息、IM、RTC、话题 | `comms_conversation`、`comms_message` |
| `data` | 数据源、schema、table、column、向量库、知识库、记忆 | `data_datasource`、`data_vector_store` |
| `ops` | 调度、通知、邮件、反馈、访问记录、短链、网络、爬取 | `ops_schedule_task`、`ops_notification` |
| `integration` | 外部渠道、连接器、供应商账号、代理配置 | `integration_channel`、`integration_channel_account` |
| `studio` | 工作空间、项目、应用、文档页、模板等设计时资产 | `studio_workspace`、`studio_project`、`studio_app` |
| `game` | 游戏、房间、比赛、积分、排行榜 | `game_room`、`game_leaderboard` |
| `recruit` | 招聘、简历、职位、投递、人才池 | `recruit_resume`、`recruit_delivery` |

现有历史表如果已经使用项目级前缀，例如 `plus_*`，只能作为 L0 legacy compatible 命名。新表 MUST 使用业务模块前缀。本文当前目标是制定标准和标注合规差距，不要求本轮执行物理表 rename；如果未来另行立项做物理改名，必须单独输出变更方案。

模块归属判定优先级：

1. 先判定事实来源 owner，而不是当前代码包名或服务名。
2. 表达身份、租户、组织、权限、API key、安全策略的表归入 `iam_`。
3. 表达订单、账户余额、支付、退款、商品、优惠券、会员、发票、佣金伙伴的表归入 `commerce_`。
4. 表达 Agent、模型、提示词、AI 工具、技能、插件、生成配置、AI 调用/用量事实的表归入 `ai_`。
5. 表达外部渠道、连接器、供应商账号、代理配置的表归入 `integration_`，不要因为它被 AI 使用就归入 `ai_`。
6. 表达工作空间、项目、应用、文档页、PPT 模板等设计时资产的表归入 `studio_`，不要使用 `app_`、`project_` 作为全局前缀。
7. 表达二进制/媒体资源、媒体发布记录、文件分片、图片、视频、音频、数字人的表归入 `media_`。
8. 如果一个表跨多个模块，优先使用唯一写入方或事实来源模块；其它模块通过视图、投影表、事件或 API 读取。

### 7.1.2 前缀判定模型

表名命名分三层，不得混用：

| 层 | 示例 | 责任 |
| --- | --- | --- |
| 部署命名空间 | database/schema/catalog，例如 `plus_business` | 隔离产品、环境、租户、部署单元 |
| 业务模块前缀 | `iam_`、`commerce_`、`content_` | 隔离业务域和 owner |
| 实体名称 | `user`、`order_item`、`payment_webhook_event` | 表达业务对象 |

判定算法：

1. 取表名第一段，即第一个 `_` 前的 token。
2. 如果第一段不在模块前缀注册表中，则判为不合规。
3. 如果第一段是产品名、项目名、公司名、环境名、技术栈名或泛化词，则判为不合规。
4. 如果表名没有第二段实体名称，则判为不合规。
5. 如果表名对应多个 owner，必须选择事实来源 owner 的模块前缀。
6. 如果是桥接表，使用事实关系所在模块前缀；关系两端实体名称可以出现在后续段。
7. 如果是 outbox、inbox、audit、ledger、projection 等技术画像，仍然必须带业务模块前缀，例如 `commerce_outbox_event`、`iam_audit_log`。

不合规示例：

| 表名 | 问题 | 建议 |
| --- | --- | --- |
| `plus_user` | `plus` 是产品名，不是业务模块 | `iam_user` |
| `app_order` | `app` 是应用层，不是业务域 | `commerce_order` |
| `sys_config` | `sys` 语义过泛 | `ops_config` 或具体模块配置表 |
| `common_dict` | `common` 无 owner | `iam_dictionary` 或 `ops_dictionary` |
| `user_role` | 缺少模块前缀 | `iam_user_role` |
| `payment` | 缺少模块前缀 | `commerce_payment` |

### 7.1.3 模块前缀注册治理

业务模块前缀不是开发者临时发明的字符串，而是组织级数据契约的一部分。每个可用前缀 MUST 在注册表中登记，并进入代码生成、schema linter、数据库评审和文档示例的同一份配置。

前缀注册项 MUST 包含：

| 字段 | 要求 |
| --- | --- |
| `prefix` | 小写字母开头，仅允许小写字母、数字，推荐 2 到 16 个字符 |
| `domain_name` | 业务域名称，例如 Identity Access、Commerce、Studio |
| `owner_team` | 负责该业务域表结构标准的团队或 owner |
| `bounded_context` | 该前缀覆盖的上下文边界 |
| `write_policy` | 单写入 owner、多写入网关、事件写入或离线写入策略 |
| `table_examples` | 至少 3 个代表性标准表名 |
| `forbidden_aliases` | 不允许作为该域别名的前缀，例如 `app`、`sys`、`common` |
| `status` | `ACTIVE`、`DEPRECATED`、`RESERVED` |
| `valid_from` | 前缀生效版本或日期 |

前缀注册规则：

- 新前缀 MUST 通过数据架构评审，不能由单个应用、单个语言仓库或单个 ORM 模块自行引入。
- 一个业务域 SHOULD 只有一个主前缀；确需拆分时，必须说明新旧边界和事实来源变化。
- 前缀一旦发布 MUST NOT 复用为其它含义。废弃前缀只能标记为 `DEPRECATED` 或 `RESERVED`。
- `app`、`web`、`api`、`service`、`server`、`admin`、`backend`、`frontend`、`java`、`python`、`rust`、`ts`、`mysql`、`pg`、`db`、`sys`、`common`、`base`、`core` 不得作为默认业务前缀。
- 产品名、公司名、项目名、客户名、租户名、环境名不进入表名前缀；这些信息放在 database/schema/catalog、部署配置、租户字段或数据目录中。

### 7.1.4 表名构造细则

标准表名由业务模块、上下文、实体和画像后缀组成。推荐优先使用短而明确的结构：

```text
<module_prefix>_<entity>
<module_prefix>_<entity>_<sub_entity>
<module_prefix>_<context>_<entity>
<module_prefix>_<entity>_<profile>
```

常见表型命名：

| 表型 | 格式 | 示例 | 说明 |
| --- | --- | --- | --- |
| 主实体 | `<module>_<entity>` | `iam_user`、`commerce_order` | 领域内核心事实对象 |
| 子实体 | `<module>_<parent>_<child>` | `commerce_order_item` | 生命周期依赖父实体 |
| 关系表 | `<module>_<left>_<right>` | `iam_user_role` | 关系事实属于该模块 |
| 历史表 | `<module>_<entity>_history` | `commerce_account_history` | 可变对象的历史轨迹 |
| 账本表 | `<module>_<entity>_ledger` | `commerce_account_ledger` | 不可变资金或额度流水 |
| 事件表 | `<module>_<entity>_event` | `commerce_payment_event` | 领域事件或业务事件 |
| 回调表 | `<module>_<provider>_<event>` | `commerce_stripe_webhook_event` | 第三方回调需要 provider 边界 |
| 快照表 | `<module>_<entity>_snapshot` | `content_document_snapshot` | 某一时点状态 |
| 投影表 | `<module>_<entity>_projection` | `comms_conversation_projection` | 读模型或查询优化 |
| Outbox | `<module>_outbox_event` | `commerce_outbox_event` | 模块内事务消息 |
| Inbox | `<module>_inbox_event` | `integration_inbox_event` | 模块内消费幂等 |
| 字典表 | `<module>_<entity>_dictionary` | `iam_security_dictionary` | 有明确 owner 的枚举/字典 |
| 临时表 | `<module>_<entity>_staging` | `data_import_staging` | 导入、清洗或过渡数据 |
| 缓存表 | `<module>_<entity>_cache` | `content_feed_cache` | 可重建缓存，必须声明 TTL |

命名细则：

- 表名 SHOULD 控制在 63 个字符以内，以兼容 PostgreSQL 等默认标识符长度；超过时应缩短上下文而不是丢失业务含义。
- 实体词 SHOULD 使用单数：`user`、`order`、`message`；列表和集合语义通过关系或子实体表达。
- `record`、`data`、`info`、`detail` 不能单独作为实体名；只有在明确业务对象后才能作为后缀，例如 `invoke_record`、`order_detail`。
- 第三方来源表必须带 provider 或 external 边界，例如 `integration_slack_channel`、`commerce_stripe_webhook_event`。
- 读模型、缓存、搜索投影不应抢占事实表名称，必须用 `_projection`、`_cache`、`_search_index` 等后缀说明派生属性。

### 7.1.5 例外和兼容边界

标准允许少量例外，但例外必须显式登记，不能扩散成新的默认规则。

允许例外：

- 数据库系统表、ORM 内部表、结构变更工具元数据表 MAY 使用工具约定名称，例如 `flyway_schema_history`、`databasechangelog`。
- 临时实验表 MAY 使用 `tmp_` 前缀，但不得进入生产契约，不得被业务代码长期依赖。
- 外部系统原始落地表 MAY 使用 `<module>_<provider>_<entity>_raw`，但必须声明清洗后的标准目标表。
- 多租户物理分表 MAY 在表名后追加分片后缀，例如 `commerce_order_202604`，但逻辑契约表名仍是 `commerce_order`。

禁止例外：

- 不得因为表由 Java、Python、Rust、TypeScript 服务创建而使用语言前缀。
- 不得因为表位于 backend、admin、server、api 工程而使用应用层前缀。
- 不得用 `common_` 承接所有跨模块数据；跨模块表必须选择事实来源 owner。
- 不得为了规避命名冲突在表名中追加随机数、开发者姓名、仓库名或环境名。

### 7.2 字段名

MUST：

- 使用小写下划线：`created_at`、`payment_expire_at`。
- 外部引用使用 `<entity>_id`、`<entity>_uuid`、`<entity>_code`。
- 时间点使用 `_at`：`published_at`、`processed_at`。
- 持续时长带单位：`duration_ms`、`timeout_seconds`。
- 金额使用 `_amount`，币种使用 `currency`。
- 数量使用 `_count` 或业务单位，例如 `token_count`。

MUST NOT：

- 使用含义模糊字段：`data`、`info`、`flag`、`type1`、`misc`。
- 混合风格：`createTime`、`Create_Time`。
- 使用无单位数字字段：`duration`、`size`、`limit`，除非字段注释和契约中明确单位。

### 7.3 索引和约束名

| 类型 | 前缀 | 示例 |
| --- | --- | --- |
| 主键 | `pk_` | `pk_commerce_payment` |
| 唯一约束/唯一索引 | `uk_` | `uk_commerce_payment_business_no` |
| 普通索引 | `idx_` | `idx_commerce_payment_tenant_status_created` |
| 外键 | `fk_` | `fk_order_user` |
| 检查约束 | `chk_` | `chk_payment_amount_non_negative` |
| JSON 索引 | `gin_`、`idx_` | `gin_product_metadata` |
| 全文索引 | `fts_` | `fts_article_content` |

规则：

- 索引名 SHOULD 表达业务字段，不使用 ORM 自动生成的随机名称作为标准名。
- 名称长度受限的数据库可以缩短，但 MUST 保持可读和可追踪。
- 结构变更脚本中的约束名 MUST 稳定，便于回滚和跨环境比对。

## 8. 逻辑类型

### 8.1 类型映射矩阵

| 逻辑类型 | PostgreSQL | MySQL/MariaDB | SQLite | SQL Server | Oracle | ClickHouse | 跨语言建议 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `int64` | `BIGINT` | `BIGINT` | `INTEGER` | `BIGINT` | `NUMBER(19,0)` | `Int64` | TS JSON 字符串；Rust `i64`；Python `int`；Go `int64`；C# `long` |
| `int32` | `INTEGER` | `INT` | `INTEGER` | `INT` | `NUMBER(10,0)` | `Int32` | 普通整数 |
| `string(n)` | `VARCHAR(n)` | `VARCHAR(n)` | `TEXT` | `NVARCHAR(n)` | `VARCHAR2(n)` | `String` | UTF-8 字符串 |
| `text` | `TEXT` | `TEXT` | `TEXT` | `NVARCHAR(MAX)` | `CLOB` | `String` | 大文本 |
| `boolean` | `BOOLEAN` | `BOOLEAN` 或 `TINYINT(1)` | `INTEGER` 0/1 | `BIT` | `NUMBER(1,0)` | `Bool` | `bool` |
| `instant` | `TIMESTAMPTZ` | `DATETIME(6)` UTC | ISO8601 `TEXT` 或 epoch ms | `DATETIMEOFFSET` | `TIMESTAMP WITH TIME ZONE` | `DateTime64` UTC | ISO 8601 UTC |
| `date` | `DATE` | `DATE` | ISO8601 `TEXT` | `DATE` | `DATE` | `Date` | 日期，不带时区 |
| `decimal(p,s)` | `NUMERIC(p,s)` | `DECIMAL(p,s)` | `TEXT` 或最小单位整数 | `DECIMAL(p,s)` | `NUMBER(p,s)` | `Decimal(p,s)` | JSON 字符串 |
| `json` | `JSONB` | `JSON` | `TEXT` | `NVARCHAR(MAX)` + 校验 | `JSON` 或 `CLOB` | `String` 或 `JSON` | 有 schema 的对象 |
| `bytes` | `BYTEA` | `BLOB` | `BLOB` | `VARBINARY(MAX)` | `BLOB` | `String` base64 | byte array |
| `uuid_string` | `UUID` 或 `VARCHAR(64)` | `VARCHAR(64)` | `TEXT` | `UNIQUEIDENTIFIER` 或 `NVARCHAR(64)` | `VARCHAR2(64)` | `String` | 字符串契约 |
| `geo_point` | PostGIS `geometry(Point,4326)` | `POINT SRID 4326` | `longitude/latitude` 双列 | `geography` | Spatial | tuple | `{lat,lng}` |
| `vector` | `vector(n)` 扩展 | 专用扩展或 BLOB | BLOB/TEXT | 专用扩展 | 专用扩展 | Array(Float32) | 派生能力，不作核心契约 |

规则：

- 公共契约 MUST 使用逻辑类型，不直接把某个数据库的方言类型当作唯一标准。
- 生产 DDL MAY 使用数据库特性优化，但必须提供可移植的降级映射。
- `json` 在 SQLite、SQL Server、Oracle 等不同数据库中实现差异较大，契约层 MUST 定义 JSON Schema 或语言 DTO。
- 向量、空间、全文、数组等高级类型 SHOULD 作为派生能力，不作为跨数据库最低契约。

### 8.2 长度和精度

| 逻辑内容 | 推荐类型 |
| --- | --- |
| UUID/ULID | `string(36..64)` |
| 短 code | `string(32..64)` |
| 业务单号 | `string(32..128)` |
| 标题/名称 | `string(100..255)` |
| URL | `string(500..2000)` |
| MIME type | `string(100)` |
| IP 地址 | `string(45)` |
| User-Agent | `string(500..1000)` |
| Hash | `string(64..128)` |
| 错误消息 | `string(1000..4000)` |
| 金额 | `decimal(18,2)` 或 `decimal(19,4)` |
| 汇率 | `decimal(18,8)` |
| 百分比 | `decimal(9,6)` |

字段长度 MUST 由业务上限、索引限制和目标数据库共同决定。不要把所有字符串都定义为 `VARCHAR(255)`。

### 8.3 字符集、排序规则和文本规范化

跨数据库移植或同步时，字符集和排序规则会直接影响唯一约束、排序结果、模糊查询和索引长度。表契约 MUST 明确文本字段的比较语义。

| 场景 | 推荐策略 |
| --- | --- |
| 普通业务文本 | UTF-8，保留原文 |
| 登录名、邮箱、手机号 | 保存原文，同时保存规范化列 |
| 大小写不敏感唯一 | 使用 `*_normalized` 列或数据库明确的 case-insensitive 类型 |
| 多语言排序 | 不依赖数据库默认排序，必要时使用 locale-aware 排序键 |
| URL、code、业务单号 | 通常使用大小写敏感比较，除非业务明确不敏感 |

规则：

- 新系统 MUST 使用 UTF-8 或等价 Unicode 字符集。
- 不能假设 MySQL、PostgreSQL、SQLite、SQL Server、Oracle 的默认大小写敏感性一致。
- 邮箱、用户名、手机号等登录标识 SHOULD 使用 `email_normalized`、`username_normalized`、`phone_e164` 等规范化列建立唯一键。
- Unicode 文本 SHOULD 统一规范化形式，例如 NFC，避免肉眼相同但字节不同导致唯一性绕过。
- 模糊搜索、拼音搜索、分词搜索不应直接依赖 OLTP 主表的 `LIKE '%keyword%'`，应使用搜索索引、全文索引或投影列。
- 跨库移植前 MUST 检查目标数据库排序规则是否会导致原本可共存的数据发生唯一键冲突。

## 9. 标准 DDL 模板

### 9.1 便携业务表模板

```sql
CREATE TABLE content_resource (
    id BIGINT NOT NULL,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL DEFAULT 0,
    organization_id BIGINT NOT NULL DEFAULT 0,
    data_scope INTEGER NOT NULL DEFAULT 1,
    user_id BIGINT,
    owner_type VARCHAR(32),
    owner_id BIGINT,
    name VARCHAR(100) NOT NULL,
    status INTEGER NOT NULL,
    metadata JSON,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP,
    deleted_by BIGINT,
    PRIMARY KEY (id),
    CONSTRAINT uk_content_resource_uuid UNIQUE (uuid)
);
```

推荐索引：

```sql
CREATE INDEX idx_content_resource_tenant_status_updated
    ON content_resource (tenant_id, organization_id, status, updated_at);

CREATE INDEX idx_content_resource_user_updated
    ON content_resource (tenant_id, organization_id, user_id, updated_at);

CREATE INDEX idx_content_resource_owner
    ON content_resource (owner_type, owner_id);
```

### 9.2 PostgreSQL 推荐模板

```sql
CREATE TABLE content_resource_pg (
    id BIGINT PRIMARY KEY,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL DEFAULT 0,
    organization_id BIGINT NOT NULL DEFAULT 0,
    data_scope INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(100) NOT NULL,
    status INTEGER NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uk_content_resource_pg_uuid UNIQUE (uuid),
    CONSTRAINT chk_content_resource_pg_scope CHECK (tenant_id >= 0 AND organization_id >= 0)
);

CREATE INDEX idx_content_resource_pg_tenant_status_updated
    ON content_resource_pg (tenant_id, organization_id, status, updated_at DESC);

CREATE INDEX gin_content_resource_pg_metadata
    ON content_resource_pg USING GIN (metadata);
```

### 9.3 MySQL 推荐模板

```sql
CREATE TABLE content_resource_mysql (
    id BIGINT NOT NULL,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL DEFAULT 0,
    organization_id BIGINT NOT NULL DEFAULT 0,
    data_scope INT NOT NULL DEFAULT 1,
    name VARCHAR(100) NOT NULL,
    status INT NOT NULL,
    metadata JSON,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at DATETIME(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_content_resource_mysql_uuid (uuid),
    KEY idx_content_resource_mysql_tenant_status_updated
        (tenant_id, organization_id, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

MySQL 5.7 或兼容数据库不支持某些检查约束时，MUST 在应用层和数据质量校验中补齐。

### 9.4 SQLite 推荐模板

```sql
CREATE TABLE content_resource_sqlite (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    data_scope INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    status INTEGER NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    UNIQUE (uuid)
);

CREATE INDEX idx_content_resource_sqlite_tenant_status_updated
    ON content_resource_sqlite (tenant_id, organization_id, status, updated_at);
```

SQLite 中 `instant` SHOULD 存 ISO 8601 UTC 字符串或 epoch milliseconds。团队必须统一一种表达，不得混用。

## 10. 索引规范

### 10.1 必备索引

| 场景 | 推荐索引 |
| --- | --- |
| 外部 ID 查询 | `UNIQUE (uuid)` |
| 租户状态列表 | `(tenant_id, organization_id, status, updated_at)` |
| 用户数据列表 | `(tenant_id, organization_id, user_id, updated_at)` |
| owner 查询 | `(tenant_id, owner_type, owner_id)` |
| 业务编号 | `UNIQUE (tenant_id, business_no)` 或全局唯一 |
| code 查询 | `UNIQUE (tenant_id, code)` 或全局唯一 |
| 状态轮询 | `(status, created_at)` 或 `(status, expire_at)` |
| 回调幂等 | `UNIQUE (provider, external_event_id)` |
| 消费者去重 | `UNIQUE (source_system, message_id, consumer_name)` |
| 树形子节点 | `(tenant_id, organization_id, parent_id, status, sort_order)` |
| 软删除列表 | `(tenant_id, status, deleted_at)` 或过滤索引 |

### 10.2 组合索引顺序

组合索引字段顺序 SHOULD 遵循：

1. 隔离字段：`tenant_id`、`organization_id`、`workspace_id`
2. 高选择性等值字段：`user_id`、`owner_id`、`business_no`
3. 类型和状态：`type`、`category`、`status`
4. 范围字段：`created_at`、`updated_at`、`expire_at`
5. 排序字段：`sort_order`、`id`

示例：

```sql
CREATE INDEX idx_commerce_order_user_status_updated
    ON commerce_order (tenant_id, organization_id, user_id, status, updated_at);
```

规则：

- 不要为每个字段单独建索引。索引必须服务明确查询。
- 唯一约束 MUST 包含正确业务边界。例如租户内唯一应包含 `tenant_id`。
- 高频更新字段不应放入过多索引，避免写放大。
- 分页列表 SHOULD 使用稳定排序字段，例如 `(updated_at, id)` 或 `(created_at, id)`。
- 大表索引创建 MUST 使用在线创建能力或灰度窗口，避免长时间锁表。

### 10.3 JSON、全文、空间索引

- PostgreSQL JSON 高频查询 MAY 使用 GIN，但核心过滤字段仍 SHOULD 拆列。
- MySQL JSON 高频查询 SHOULD 使用生成列加索引。
- SQLite 搜索场景 MAY 使用 FTS5 或投影列。
- 复杂搜索 SHOULD 同步到 Elasticsearch、OpenSearch、Meilisearch、Typesense 或数据库全文索引。
- 空间数据公共契约 SHOULD 同时提供 `longitude`、`latitude`，数据库空间列可作为优化列。

### 10.4 分区、分片和冷热数据

大表设计 SHOULD 在建表阶段说明未来分区或分片策略，即使第一阶段不启用。

| 场景 | 推荐策略 |
| --- | --- |
| 按租户隔离的大表 | `tenant_id` 参与分片键或分区键 |
| 时间序列日志 | 按 `created_at` 月/周/日分区 |
| 账本流水 | 按租户 + 时间或账户 + 时间设计 |
| Webhook/任务记录 | 按 `created_at` 分区，并有 TTL/归档 |
| 平台共享配置 | 不分片或按 `code` hash |

规则：

- 分片键 MUST 出现在高频查询条件中。
- 分片策略不能破坏唯一约束语义。全局唯一键需要全局 ID、全局索引、号段或协调服务。
- 分区裁剪依赖的字段 MUST 在查询中显式出现。
- 冷热分离后的历史数据查询入口 MUST 明确，避免应用误以为主表包含全量历史。
- 分片/分区属于物理策略，不能改变公共字段语义。

### 10.5 索引预算和容量模型

索引是写入成本、存储成本和结构演进成本。大表不能只按“查询可能会用到”来加索引。

每张 L2/L3 表 SHOULD 记录容量模型：

| 项 | 说明 |
| --- | --- |
| 当前行数 | 设计或上线时预估 |
| 年增长量 | 按业务峰值估算 |
| 单行大小 | 包括 JSON、文本、索引字段 |
| 写入 TPS | 平均值和峰值 |
| 读写比例 | 判断索引收益 |
| 索引数量 | 普通索引、唯一索引、表达式索引 |
| 最大保留期 | 影响总行数和归档策略 |

规则：

- 高频写入表 SHOULD 设置索引预算，例如核心写入路径索引不超过 5 个，超出必须说明收益。
- 每个索引 MUST 绑定至少一个查询契约或约束目的。
- 重复前缀索引 SHOULD 合并。例如已有 `(tenant_id, user_id, status, updated_at)` 时，通常不再需要 `(tenant_id, user_id)`，除非查询计划证明需要。
- 大字段、低选择性字段、频繁变化字段 SHOULD 避免单独索引。
- 容量超过百万级行的表 SHOULD 在设计期说明归档、分区或冷热策略。
- 上线后 SHOULD 定期清理未使用索引，但删除索引也必须走结构变更评审。

## 11. 约束和关系完整性

### 11.1 主键

- 每张持久业务表 MUST 有主键。
- 核心业务表 SHOULD 使用单列 `id` 主键，便于 SDK、消息、审计、读模型统一处理。
- 极简关联表 MAY 使用复合主键，但一旦需要审计、状态、扩展字段、软删除或同步，SHOULD 改为带 `id` 的关系实体表。

### 11.2 唯一约束

唯一约束 MUST 反映真实业务边界：

```sql
CREATE UNIQUE INDEX uk_user_email_tenant
    ON user_account (tenant_id, email_normalized);

CREATE UNIQUE INDEX uk_payment_provider_event
    ON payment_webhook_event (provider, external_event_id);
```

软删除表中若允许删除后重建同名数据，必须明确策略：

- 使用状态参与唯一键：`UNIQUE (tenant_id, code, status)`。
- 使用过滤唯一索引：仅对未删除记录唯一。
- 使用历史版本表保存旧数据，主表保持唯一。

### 11.3 外键

| 场景 | 建议 |
| --- | --- |
| 同库核心强一致关系 | SHOULD 建数据库外键 |
| 配置字典关系 | MAY 使用 code 引用 |
| 高频日志、流水、事件 | MAY 不建外键，但 MUST 建引用索引 |
| 跨服务、跨库、跨租户引用 | MUST NOT 建数据库外键，使用事件、补偿和校验任务 |
| 历史归档表 | SHOULD 谨慎建外键，避免归档受阻 |

外键列 MUST 有索引。跨租户 join MUST 校验租户边界，不能只按 `id` 关联。

### 11.4 检查约束

检查约束 SHOULD 用于不依赖业务上下文的规则：

```sql
ALTER TABLE commerce_account_balance
    ADD CONSTRAINT chk_commerce_account_balance_non_negative
    CHECK (available_amount >= 0 AND frozen_amount >= 0);
```

数据库不支持检查约束时，MUST 在写入层和数据质量任务中补齐。

### 11.5 事务、隔离级别和并发

表结构设计必须说明关键写入的并发控制方式。不同语言和 ORM 的默认事务行为不同，不能把并发正确性寄托在框架默认值上。

| 场景 | 推荐控制方式 |
| --- | --- |
| 普通资料更新 | `version` 乐观锁 |
| 库存扣减 | 条件更新 + 幂等键 + 业务单号 |
| 余额变更 | 账户行锁或串行化命令 + append-only 流水 |
| 唯一资源创建 | 数据库唯一约束作为最终防线 |
| 任务抢占 | `status` 条件更新、skip locked 或租约字段 |
| 跨服务状态推进 | outbox 事件 + 消费端幂等 |

规则：

- 更新核心业务表 SHOULD 带 `version` 条件：`WHERE id = :id AND version = :version`。
- 金额、库存、配额、次数限制 MUST 使用数据库条件更新、锁、唯一约束或串行化队列保证正确性。
- 数据库唯一约束是防重复创建的最终防线，不能只依赖应用层先查再插。
- 事务中写入业务状态和 outbox 事件 MUST 保持原子性。
- 长事务、用户交互事务、跨网络调用事务 SHOULD 避免。需要调用外部系统时，优先使用状态机和补偿。
- 关键业务 MUST 明确目标数据库隔离级别，并记录在契约或设计文档中。

### 11.6 多区域、复制和读一致性

多区域部署、读写分离和多主写入会改变数据可见性，必须进入表契约或部署契约。

| 架构 | 风险 | 标准要求 |
| --- | --- | --- |
| 主从复制 | replica lag 导致读旧数据 | 写后读路径必须可读主库或携带一致性策略 |
| 多区域只读副本 | 跨区域延迟 | API 必须声明可接受延迟 |
| 多主写入 | 冲突和唯一键竞争 | 必须有冲突解决策略和全局 ID |
| 分片数据库 | 跨分片唯一和事务困难 | 唯一键、事务边界、查询路由必须明确 |
| 边缘写入 | 离线合并冲突 | 必须有版本向量、事件合并或人工冲突处理 |

规则：

- L3 表 MUST 声明读一致性要求：strong、read-your-writes、bounded-staleness 或 eventual。
- 写后立即查询的 API MUST 避免读到落后副本。
- 唯一约束在多区域写入下必须有全局协调策略，不能只依赖单区域局部唯一。
- 事件顺序不能简单依赖创建时间；跨区域事件 SHOULD 使用单调版本、序列号或聚合内版本。
- 数据驻留要求必须明确，例如某些租户或 PII 不得跨区域复制。
- 跨境同步必须进入安全合规评审，包含脱敏、加密、访问审计和删除传播。

## 12. 枚举规范

### 12.1 整数枚举

内部高频状态 SHOULD 使用整数枚举。

| 值 | 名称 | 含义 |
| ---: | --- | --- |
| `1` | `ACTIVE` | 正常 |
| `2` | `INACTIVE` | 停用 |
| `3` | `ARCHIVED` | 归档 |
| `9` | `DELETED` | 删除 |

规则：

- 枚举值发布后 MUST NOT 复用为其它含义。
- 新增值 MUST 追加，不能重排。
- SDK MUST 能处理未知枚举值。
- 检查约束更新 MUST 先于应用写入新值。
- 数仓和审计文档 MUST 保存枚举值与名称映射。

### 12.2 字符串枚举

以下场景 MAY 使用字符串枚举：

- 外部协议原生字符串，例如支付渠道、云厂商区域、Webhook 状态。
- 对外 API 稳定契约，例如 `status = "ACTIVE"`。
- 人工读库排障和数据分析频繁依赖直观值。

规则：

- 字符串枚举 MUST 使用大写蛇形：`PENDING_REVIEW`。
- 不要把显示文案作为枚举值。显示文案应进入 i18n 或字典表。
- 重命名字符串枚举属于破坏性变更，必须走结构演进流程。

### 12.3 字典表

动态枚举、运营配置、可扩展类型 SHOULD 使用字典表：

```sql
CREATE TABLE iam_dictionary (
    id BIGINT PRIMARY KEY,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL DEFAULT 0,
    dict_type VARCHAR(64) NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    status INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSON,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_iam_dictionary_type_code UNIQUE (tenant_id, dict_type, code),
    CONSTRAINT uk_iam_dictionary_uuid UNIQUE (uuid)
);
```

### 12.4 参考数据和种子数据

参考数据、种子数据、lookup table 是系统行为的一部分，不能靠人工在生产库随意插入。

| 类型 | 示例 | 管理方式 |
| --- | --- | --- |
| reference data | 国家、币种、行业、地区、系统内置权限 | 版本化发布或受控配置发布 |
| seed data | 初始管理员角色、默认套餐、内置模板 | 可重复执行的幂等脚本 |
| lookup table | 状态映射、外部渠道 code、税率表 | 有 owner、版本、生效时间 |
| feature config | 灰度开关、实验配置 | 配置中心或配置表，带审计 |

规则：

- 种子脚本 MUST 幂等，重复执行不能产生重复数据。
- 参考数据 SHOULD 有 `code`、`name`、`status`、`effective_from`、`effective_to`、`version`。
- 生产参考数据变更 MUST 有审计、审批或配置发布记录。
- 不同环境的参考数据必须可比较，避免开发、测试、生产 code 不一致。
- SDK 或前端依赖的 reference data SHOULD 有导出版本，避免硬编码过期枚举。
- lookup table 中的 code 一旦对外发布，MUST NOT 复用为新含义。

## 13. JSON 和半结构化数据

### 13.1 适合放 JSON 的内容

- 第三方回调原始 payload。
- 表单配置、工作流配置、模型参数、UI 配置。
- 业务对象快照，例如订单创建时的买家、卖家、商品信息。
- 扩展元数据、低频查询字段、实验字段。
- 事件 payload、审计前后差异。

### 13.2 不应只放 JSON 的内容

以下字段 MUST 拆成独立列：

- 状态：`status`
- 隔离字段：`tenant_id`、`organization_id`、`user_id`、`owner_id`
- 金额和币种：`amount`、`currency`
- 幂等键：`idempotency_key`、`request_id`、`external_event_id`
- 业务编号：`business_no`、`order_no`、`out_trade_no`
- 时间范围：`start_at`、`end_at`、`expire_at`
- 高频筛选：`category_id`、`type`、`channel`
- 唯一约束字段

### 13.3 JSON 契约

每个 JSON 字段 MUST 至少有一种结构契约：

- JSON Schema 文件。
- OpenAPI schema。
- TypeScript interface 或 Zod schema。
- Python Pydantic model。
- Rust serde struct。
- Go struct。
- C# record/class。
- Java/Kotlin DTO。

规则：

- `metadata JSON` 不能成为无约束垃圾桶。
- JSON 结构变更 MUST 有版本字段或兼容读取逻辑。
- 高频 JSON 字段拆列时 MUST 经过双写和一致性校验。
- 敏感数据不应混入通用 `metadata`，否则脱敏和访问控制难以执行。

## 14. 金额、计量和精度

### 14.1 金额

标准金额：

```sql
amount DECIMAL(18, 2) NOT NULL,
currency VARCHAR(10) NOT NULL
```

高精度计价：

```sql
unit_price DECIMAL(19, 4) NOT NULL,
exchange_rate DECIMAL(18, 8)
```

规则：

- 金额 MUST NOT 使用 `FLOAT` 或 `DOUBLE`。
- 多币种场景 MUST 有 `currency`。
- 金融、支付、余额、账本场景中 decimal 在 JSON 中 MUST 使用字符串。
- 金额精度必须由业务域定义。支付通常 2 位，小额计费可 4 到 8 位，链上资产或模型计费可更高。

### 14.2 币种、舍入和税费

金额字段不仅要有精度，还必须定义币种、舍入模式和税费口径。

规则：

- 法币币种 SHOULD 使用 ISO 4217 三位代码，例如 `USD`、`CNY`、`EUR`。
- 非法币资产、积分、token MUST 有资产字典，定义精度、展示单位、最小变更单位。
- 涉及计费、税费、折扣、汇率的表 MUST 声明 rounding mode，例如 HALF_UP、HALF_EVEN、DOWN。
- 税前金额、税额、税后金额 SHOULD 拆列，例如 `subtotal_amount`、`tax_amount`、`total_amount`。
- 汇率必须记录来源、基准币种、报价时间和精度。
- 不能在不同服务中分别计算最终金额。最终入账金额必须由一个事实来源服务生成，并写入账本或订单事实表。

### 14.3 积分、余额、token、库存

- 积分、点数、token 数 SHOULD 使用整数。
- 高并发余额 MUST 使用流水表和余额表，余额表可作为当前状态，流水表作为事实来源。
- 库存扣减 MUST 有幂等键、业务单号和补偿机制。
- 账户类表 SHOULD 记录 `available_amount`、`frozen_amount`、`total_amount` 或等价字段。

### 14.4 单位

字段名或契约 MUST 明确单位：

| 场景 | 推荐字段 |
| --- | --- |
| 毫秒耗时 | `duration_ms` |
| 秒级 TTL | `ttl_seconds` |
| 字节大小 | `size_bytes` |
| token 数 | `token_count` |
| 百分比 | `ratio` 或 `rate` + decimal 精度 |

## 15. 时间规范

统一规则：

- 存储 MUST 使用 UTC 或可无歧义转换到 UTC 的类型。
- API MUST 返回 ISO 8601，例如 `2026-04-26T08:30:00Z`。
- 不允许在同一字段中混用本地时区、UTC、epoch 秒、epoch 毫秒。
- 定时任务、过期时间、账期 MUST 明确时间单位和时区。
- 日期 `date` 与时刻 `instant` MUST 区分。生日、账期日、自然日使用 `date`；创建时间、过期时间使用 `instant`。

常用字段：

| 字段 | 含义 |
| --- | --- |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `deleted_at` | 删除时间 |
| `archived_at` | 归档时间 |
| `started_at` | 开始时间 |
| `finished_at` | 完成时间 |
| `processed_at` | 处理时间 |
| `expire_at` | 过期时间 |
| `effective_from` | 生效开始 |
| `effective_to` | 生效结束 |

## 16. 多租户和权限过滤

### 16.1 请求上下文

所有服务、任务、消息消费者、批处理都 MUST 维护等价上下文：

```json
{
  "tenant_id": "1",
  "organization_id": "10",
  "workspace_id": "100",
  "user_id": "10001",
  "roles": ["ADMIN"],
  "data_scope": 1,
  "request_id": "req_202604260001",
  "trace_id": "trace_202604260001"
}
```

### 16.2 查询规则

普通用户查询：

```sql
WHERE tenant_id = :tenant_id
  AND organization_id IN (:allowed_organization_ids)
  AND user_id = :user_id
```

租户管理员查询：

```sql
WHERE tenant_id = :tenant_id
```

平台管理员查询：

```sql
WHERE (:is_platform_admin = true)
```

平台级查询 MUST 显式声明权限，不允许因为上下文缺失而默认全表查询。

### 16.3 实现方式

| 技术栈 | 可选实现 |
| --- | --- |
| TypeScript/Node.js | Prisma middleware、TypeORM subscriber、Drizzle wrapper、repository wrapper |
| Python | SQLAlchemy session scope、FastAPI dependency、Django manager、repository wrapper |
| Rust | sqlx query builder、SeaORM filter、Diesel wrapper、service repository |
| Go | sqlc 查询模板、repository wrapper、context-aware DAO |
| Java/Kotlin | MyBatis interceptor、jOOQ DSL wrapper、JPA filter、repository base |
| PHP | Laravel global scope、Doctrine filter、repository wrapper |
| C#/.NET | EF Core global query filter、Dapper repository wrapper |

核心要求不是使用哪种框架，而是：租户过滤 MUST 是基础设施能力，并且有测试证明普通查询无法绕过。

### 16.4 测试要求

多租户表 SHOULD 至少有以下测试：

- 未设置租户上下文时拒绝写入或显式写入平台共享数据。
- 普通用户只能读取本租户数据。
- 组织用户不能读取其它组织私有数据。
- 平台管理员查询必须显式授权。
- 批处理任务必须设置租户范围或声明跨租户任务。
- `tenant_id = 0` 的共享数据读取路径明确。

### 16.5 RBAC、ABAC 和策略字段

权限过滤不应只依赖角色名。复杂系统 SHOULD 把 RBAC、ABAC 和数据策略分层表达。

| 模型 | 适用场景 | 数据库要求 |
| --- | --- | --- |
| RBAC | 后台菜单、角色权限、管理操作 | 角色、权限、关系表有唯一约束和租户边界 |
| ABAC | 按部门、地区、数据等级、资源属性授权 | 资源表有可过滤属性，策略表有版本 |
| RLS | 数据库原生行级安全 | 策略必须能从契约生成或审计 |
| Policy-as-code | 多语言服务共享授权策略 | 策略版本、测试用例和回滚路径必须明确 |

规则：

- 权限策略字段 SHOULD 与业务字段分离，例如 `visibility`、`classification`、`data_scope`、`owner_type/owner_id`。
- 高敏数据表 MUST 记录访问审计策略，不只是写入审计。
- 数据库 RLS 可以作为强防线，但应用层仍必须传递清晰的访问上下文。
- ABAC 策略引用的字段 MUST 是独立列并建立必要索引，不能藏在 JSON 中。
- 策略变更属于安全变更，MUST 有版本、测试和回滚方案。

## 17. 幂等和一致性

### 17.1 必须幂等的操作

以下操作 MUST 设计幂等键：

- 创建订单。
- 发起支付。
- 支付回调。
- 退款申请和退款回调。
- 消息投递和消费。
- 第三方 Webhook。
- 文件上传完成通知。
- 批量导入。
- 定时任务执行。
- 账户余额、积分、库存变更。

### 17.2 幂等表模板

```sql
CREATE TABLE ops_idempotency_record (
    id BIGINT PRIMARY KEY,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL DEFAULT 0,
    idempotency_key VARCHAR(160) NOT NULL,
    request_id VARCHAR(128),
    payload_hash VARCHAR(128),
    target_type VARCHAR(64) NOT NULL,
    target_id BIGINT,
    status VARCHAR(32) NOT NULL,
    response_snapshot JSON,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    expire_at TIMESTAMP,
    CONSTRAINT uk_ops_idempotency_record_key UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT uk_ops_idempotency_record_uuid UNIQUE (uuid)
);
```

### 17.3 事件一致性

分布式系统不能仅靠“代码里先写库再发消息”保证可靠事件。涉及跨服务同步时 SHOULD 使用 outbox/inbox。

Outbox 模板：

```sql
CREATE TABLE ops_outbox_event (
    id BIGINT PRIMARY KEY,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL DEFAULT 0,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    aggregate_uuid VARCHAR(64),
    event_type VARCHAR(100) NOT NULL,
    event_version INTEGER NOT NULL,
    event_key VARCHAR(160) NOT NULL,
    payload JSON NOT NULL,
    payload_hash VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP,
    published_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_ops_outbox_event_key UNIQUE (event_key),
    CONSTRAINT uk_ops_outbox_event_uuid UNIQUE (uuid)
);
```

Inbox 模板：

```sql
CREATE TABLE ops_inbox_event (
    id BIGINT PRIMARY KEY,
    uuid VARCHAR(64) NOT NULL,
    source_system VARCHAR(64) NOT NULL,
    message_id VARCHAR(160) NOT NULL,
    consumer_name VARCHAR(100) NOT NULL,
    payload_hash VARCHAR(128),
    status VARCHAR(32) NOT NULL,
    error_message VARCHAR(1000),
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_ops_inbox_event_message_consumer
        UNIQUE (source_system, message_id, consumer_name),
    CONSTRAINT uk_ops_inbox_event_uuid UNIQUE (uuid)
);
```

规则：

- Outbox 事件 MUST 与业务状态在同一事务写入。
- Inbox MUST 以消息 ID 和消费者名去重。
- “Exactly once” 应理解为业务幂等后的效果一次，不应依赖消息中间件承诺。
- 事件 payload MUST 有版本字段，消费者 MUST 兼容未知字段。

## 18. 日志、审计和账本

### 18.1 不可变记录

以下表 SHOULD 采用 append-only：

- 账户流水。
- 积分流水。
- 支付、退款、清结算记录。
- 安全审计日志。
- 第三方回调原始事件。
- 关键业务状态变更历史。

append-only 表允许补充处理状态，但 MUST NOT 覆盖事实字段，例如原始金额、原始 payload、原始操作者。

### 18.2 账本字段

账本表 SHOULD 包含：

| 字段 | 说明 |
| --- | --- |
| `account_id` | 账户 ID |
| `ledger_type` | 账本类型 |
| `direction` | `DEBIT` 或 `CREDIT` |
| `amount` | 变更金额 |
| `currency` | 币种或资产类型 |
| `balance_before` | 变更前余额 |
| `balance_after` | 变更后余额 |
| `business_type` | 业务类型 |
| `business_no` | 业务单号 |
| `idempotency_key` | 幂等键 |

规则：

- 资金和积分流水 MUST 有唯一业务键，防止重复入账。
- 余额快照 SHOULD 能由流水重算或校验。
- 冲正 SHOULD 追加反向流水，不直接修改原流水金额。

### 18.3 审计字段

审计日志 SHOULD 包含：

- `operator_id`
- `operator_type`
- `action`
- `target_type`
- `target_id`
- `target_uuid`
- `request_id`
- `trace_id`
- `source_ip`
- `user_agent`
- `before_snapshot`
- `after_snapshot`

审计日志 MUST 避免记录完整密码、token、密钥、银行卡号、身份证号等高敏数据。

## 19. 安全和合规

### 19.1 敏感字段分类

| 分类 | 示例 | 存储策略 |
| --- | --- | --- |
| 凭证 | 密码、API key、access token、refresh token、私钥 | 不可逆哈希、加密、摘要或密钥管理系统 |
| 高敏 PII | 身份证号、银行卡号、手机号、邮箱、地址 | 加密、脱敏、盲索引、访问审计 |
| 业务敏感 | 价格策略、风控结果、内部备注 | 权限控制、审计、必要时加密 |
| 公开信息 | 昵称、公开描述、公开商品名 | 常规存储 |

规则：

- 密码 MUST 只存强哈希，不存可逆密文。
- token/key SHOULD 只存摘要；必须回显的 token/key MUST 加密存储并限制读取。
- 需要等值检索的敏感字段 MAY 使用盲索引，例如 `email_hash`。
- 日志、审计、错误表 MUST NOT 记录完整密钥、密码、token。
- 字段契约 MUST 标注敏感等级，便于 SDK、日志、数据导出自动脱敏。

### 19.2 加密和密钥轮换

- 加密字段 SHOULD 记录 `key_id` 或密钥版本。
- 密钥轮换 MUST 有双读或后台重加密策略。
- 加密后仍需搜索的字段 MUST 设计盲索引或搜索代理，不能依赖明文 LIKE。
- 加密字段排序和范围查询能力受限，设计前必须确认业务查询模式。

### 19.3 数据留存

- 表契约 SHOULD 明确留存期限。
- 可删除数据 MUST 定义删除方式：软删除、匿名化、物理删除、归档。
- 法务冻结字段 `legal_hold` 一旦为 true，清理任务 MUST 跳过。
- 备份、日志、搜索索引和下游数仓必须纳入删除或匿名化范围。

### 19.4 脱敏、最小权限和数据出口

安全标准必须覆盖数据被读取、导出、同步和展示的路径。

| 场景 | 标准策略 |
| --- | --- |
| API 返回 | 默认不返回敏感字段，必要时按权限脱敏 |
| 管理后台 | 高敏字段二次确认、操作审计、字段级授权 |
| 日志输出 | 默认脱敏，禁止完整 token/key/password |
| 数据导出 | 导出任务记录申请人、范围、字段、审批、过期时间 |
| SDK | 敏感字段默认不生成写入/读取快捷方法，或标注高风险 |
| 数仓同步 | 分层脱敏，生产明细和分析宽表权限分离 |

规则：

- 字段契约 MUST 标注 `sensitivity`，例如 `PUBLIC`、`INTERNAL`、`CONFIDENTIAL`、`SECRET`。
- 高敏字段 SHOULD 标注 `masking_rule`，例如手机号 `138****8000`、邮箱局部脱敏、证件号尾号可见。
- 数据出口 MUST 有审计记录，包括导出人、时间、查询条件、字段列表、文件位置、过期时间。
- 不同环境的数据策略必须明确。测试、开发、演示环境 SHOULD 使用脱敏数据，不得直接复制生产高敏明文。
- 访问控制应遵循最小权限。服务账号只能访问其拥有或明确授权的表和字段。

## 20. API 和 SDK 契约

### 20.1 字段命名

推荐 API JSON 使用 `snake_case`，与数据库字段一致：

```json
{
  "id": "7401015123001008128",
  "uuid": "018f6f56-8d8f-7c35-baa6-0fdc2c911001",
  "created_at": "2026-04-26T08:30:00Z",
  "updated_at": "2026-04-26T08:31:00Z",
  "version": "1",
  "tenant_id": "1",
  "organization_id": "10",
  "status": 1
}
```

如果前端或 SDK 选择 `camelCase`，转换必须在 SDK 或 API adapter 层完成，数据库契约仍保持 `snake_case`。

### 20.2 序列化规则

| 逻辑类型 | JSON 表达 | 原因 |
| --- | --- | --- |
| `int64` | 字符串 | 避免 JavaScript number 精度丢失 |
| `decimal` | 字符串 | 避免浮点误差 |
| `instant` | ISO 8601 UTC 字符串 | 跨语言、跨时区一致 |
| `date` | `YYYY-MM-DD` | 不带时区 |
| `bytes` | base64 字符串 | JSON 兼容 |
| `enum_int32` | number + 文档映射 | 内部紧凑 |
| `enum_string` | 大写蛇形字符串 | 对外可读 |

### 20.3 版本和并发

- 更新接口 SHOULD 携带 `version` 或 ETag，避免丢失更新。
- 批量接口 MUST 明确部分成功策略。
- 分页 SHOULD 使用游标或稳定排序。大表不建议只用 offset。
- 删除接口 MUST 明确是软删除、归档、匿名化还是物理删除。

### 20.4 OpenAPI、GraphQL、gRPC

OpenAPI：

- `int64` 字段 SHOULD 声明为 `type: string`，并通过 `format` 或扩展标注原始逻辑类型。
- decimal 字段 SHOULD 声明为字符串，并说明精度。
- 时间字段 MUST 声明为 ISO 8601 UTC。
- 敏感字段 SHOULD 使用扩展标记，例如 `x-sensitive: true`。

GraphQL：

- `int64` 和 decimal SHOULD 使用自定义 scalar，例如 `LongString`、`DecimalString`。
- 不要使用 GraphQL `Int` 表示 64 位整数，因为 GraphQL `Int` 是 32 位有符号整数。
- 时间 SHOULD 使用 `DateTime` scalar，并强制 UTC。

gRPC/Protobuf：

- 内部 gRPC MAY 使用 `int64`，但任何会转 JSON 的 gateway MUST 按字符串策略处理。
- decimal SHOULD 用字符串或 `{ units, nanos }` 等明确结构，不能用 double。
- 时间 SHOULD 使用 `google.protobuf.Timestamp`，并在边界层转为 ISO 8601 UTC。

### 20.5 查询、排序和分页契约

数据库索引必须服务明确的查询契约。任何对外列表 API 或跨服务查询接口 SHOULD 先定义查询形态，再设计索引。

查询契约至少包含：

| 项 | 说明 |
| --- | --- |
| 过滤字段 | 可作为 where 条件的字段 |
| 排序字段 | 允许排序的字段和默认排序 |
| 分页方式 | cursor、seek、offset 的选择 |
| 最大 page size | 防止无限制查询 |
| 租户边界 | 查询是否必须带 `tenant_id`、`organization_id`、`user_id` |
| 一致性 | 是否允许读延迟、是否读主库 |

规则：

- 大表列表 SHOULD 使用 seek/cursor pagination，例如 `(updated_at, id)` 游标。
- offset pagination 只适合小表、后台低频查询或已限制最大页数的场景。
- 排序字段必须稳定；只按 `updated_at` 排序可能产生重复或漏读，SHOULD 增加 `id` 作为 tie-breaker。
- 对外 API MUST 限制 `page_size` 上限。
- 不允许把任意字段排序、任意字段过滤暴露给前端，除非有查询网关、索引保护和成本控制。
- 查询契约变化会影响索引和 SDK，必须进入 schema review。

## 21. 多语言实现契约

没有统一 ORM 基类时，每个服务 MUST 在写入层完成标准字段填充。

| 字段 | 写入责任 |
| --- | --- |
| `id` | 调统一 ID 生成器 |
| `uuid` | 生成 UUID/ULID |
| `created_at` | 创建时填 UTC 当前时间 |
| `updated_at` | 创建和更新时填 UTC 当前时间 |
| `version` | 创建为 0，更新时递增 |
| `tenant_id` | 从认证、任务或消息上下文解析 |
| `organization_id` | 从上下文或业务归属解析 |
| `user_id` | 从当前用户或业务参数解析 |
| `data_scope` | 按业务可见性设置 |
| `request_id` | 从请求链路传递 |

### 21.1 TypeScript

```ts
export type Int64String = string;
export type DecimalString = string;

export interface BaseRecord {
  id: Int64String;
  uuid: string;
  created_at: string;
  updated_at: string;
  version: Int64String;
}

export interface TenantScopedRecord extends BaseRecord {
  tenant_id: Int64String;
  organization_id: Int64String;
  data_scope: number;
}
```

```ts
function prepareInsert<T extends Record<string, unknown>>(
  data: T,
  ctx: RequestContext,
): T & Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...data,
    id: generateInt64IdAsString(),
    uuid: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    version: "0",
    tenant_id: ctx.tenant_id,
    organization_id: ctx.organization_id ?? "0",
    data_scope: data.data_scope ?? 1,
    request_id: ctx.request_id,
  };
}
```

### 21.2 Python

```python
from datetime import datetime, timezone
from decimal import Decimal
from pydantic import BaseModel

class BaseRecord(BaseModel):
    id: int
    uuid: str
    created_at: datetime
    updated_at: datetime
    version: int

class TenantScopedRecord(BaseRecord):
    tenant_id: int
    organization_id: int
    data_scope: int
```

```python
from uuid import uuid4

def prepare_insert(data: dict, ctx: RequestContext) -> dict:
    now = datetime.now(timezone.utc)
    return {
        **data,
        "id": generate_int64_id(),
        "uuid": str(uuid4()),
        "created_at": now,
        "updated_at": now,
        "version": 0,
        "tenant_id": ctx.tenant_id,
        "organization_id": ctx.organization_id or 0,
        "data_scope": data.get("data_scope", 1),
        "request_id": ctx.request_id,
    }
```

### 21.3 Rust

```rust
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseRecord {
    pub id: i64,
    pub uuid: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantScopedRecord {
    #[serde(flatten)]
    pub base: BaseRecord,
    pub tenant_id: i64,
    pub organization_id: i64,
    pub data_scope: i32,
}
```

Rust 中金额 MUST NOT 使用 `f64`。推荐 `rust_decimal::Decimal` 或整数最小单位。

### 21.4 Go

```go
type BaseRecord struct {
    ID        int64     `json:"id,string"`
    UUID      string    `json:"uuid"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
    Version   int64     `json:"version,string"`
}
```

Go 的 JSON 对外 SHOULD 对 `int64` 使用 `,string`。

### 21.5 C#

```csharp
public sealed record BaseRecord(
    long Id,
    string Uuid,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    long Version
);
```

对外 JSON 若面向浏览器，`long` SHOULD 序列化为字符串。

### 21.6 PHP

PHP 在 32 位环境中不能安全承载 64 位整数。跨环境 SDK SHOULD 把 `int64` 当作字符串处理。金额 SHOULD 使用字符串或 decimal 扩展，不使用 float。

### 21.7 Java/Kotlin

Java/Kotlin 可以使用 JPA、MyBatis、jOOQ、JDBC、Exposed、Quarkus Panache 或手写 SQL。标准只要求字段语义一致，不要求依赖某个 ORM。`Instant`、`Long`、`BigDecimal` SHOULD 分别映射 `instant`、`int64`、`decimal`。

## 22. 结构演进规范

### 22.1 契约版本

数据库契约 SHOULD 使用语义化版本或等价版本策略：

| 版本变化 | 含义 | 示例 |
| --- | --- | --- |
| PATCH | 不影响应用语义的兼容修复 | 增加注释、增加非唯一索引 |
| MINOR | 向后兼容能力增加 | 新增可空字段、新增枚举值、JSON 新增可选字段 |
| MAJOR | 破坏性变更 | 删除字段、字段改义、唯一键边界变化、decimal 精度降低 |

规则：

- 共享表、跨服务事件、SDK 暴露字段 MUST 有契约版本。
- MAJOR 变更 MUST 有兼容窗口和变更公告。
- SDK、OpenAPI、GraphQL、gRPC schema 的版本必须能追溯到数据库契约版本。
- 存量字段废弃 SHOULD 使用 `deprecated_at`、契约注释或 schema registry 标记，不要直接删除。
- 过了兼容窗口仍有消费者使用旧字段时，收缩步骤必须延期或升级消费者。

### 22.2 结构变更文件命名

结构变更文件 SHOULD 可排序、可追踪、可回滚：

```text
V20260426_101500__add_commerce_payment_idempotency.sql
V20260426_102000__backfill_commerce_payment_uuid.sql
V20260426_103000__add_commerce_payment_constraints.sql
```

每个结构变更 MUST 写明：

- 目的。
- 影响表和字段。
- 是否可回滚。
- 是否锁表。
- 回填批次和节流策略。
- 校验 SQL。
- 发布顺序要求。

### 22.3 扩展和收缩流程

破坏性变更 MUST 使用以下流程：

1. **扩展**：新增字段、新表或新索引，不删除旧字段。
2. **兼容读**：应用能读旧字段和新字段。
3. **双写**：应用同时写旧字段和新字段。
4. **回填**：批量补齐历史数据。
5. **校验**：数量、哈希、抽样、业务查询比对。
6. **切换读**：读路径切到新字段或新表。
7. **冻结旧写**：停止旧字段写入。
8. **收缩**：确认所有版本下线后删除旧字段或旧表。

### 22.4 兼容性规则

向后兼容变更：

- 新增可空字段。
- 新增有默认值字段。
- 新增非唯一索引。
- 新增枚举值，但旧 SDK 能处理未知值。
- JSON 增加可选字段。

破坏性变更：

- 删除字段。
- 字段重命名。
- 改变字段含义。
- 缩短字段长度。
- 降低 decimal 精度。
- 把可空改非空但未完成回填。
- 修改枚举值含义。
- 更改唯一约束边界。

破坏性变更 MUST 有结构演进设计和兼容窗口。

### 22.5 历史字段标准化

| 历史字段 | 标准字段 | 处理方式 |
| --- | --- | --- |
| `created_time` | `created_at` | 新增标准字段，转 UTC 回填，双写，切换 |
| `updated_time` | `updated_at` | 新增标准字段，转 UTC 回填，双写，切换 |
| `create_user` | `created_by` 或 `operator_id` | 按语义拆分 |
| `update_user` | `updated_by` | 按语义标准化 |
| `is_deleted` | `status/deleted_at` | 简单表可保留，复杂表标准化 |
| `auto_increment id` | 应用生成 `id` | 存量保留，新写入切换 |
| `varchar json` | `json/jsonb` 或契约 JSON | 校验合法 JSON 后转换 |
| `v` | `version` | 契约层映射，长期统一 |

### 22.6 数据校验

结构演进校验 SHOULD 包含：

```sql
-- 数量校验
SELECT COUNT(*) FROM source_table;
SELECT COUNT(*) FROM target_table;

-- 空值校验
SELECT COUNT(*) FROM target_table WHERE uuid IS NULL;

-- 唯一性校验
SELECT uuid, COUNT(*)
FROM target_table
GROUP BY uuid
HAVING COUNT(*) > 1;

-- 抽样校验
SELECT id, old_field, new_field
FROM target_table
WHERE old_field <> new_field
LIMIT 100;
```

大表结构演进 SHOULD 使用分批、可恢复、可观测的回填任务，并记录进度。

### 22.7 数据库方言移植

移植到 PostgreSQL：

- `DATETIME(6)` 转 `TIMESTAMPTZ`。
- `JSON` 转 `JSONB`。
- `TINYINT(1)` 转 `BOOLEAN`。
- MySQL 字符集和排序规则差异会影响唯一约束，必须预先检测。
- MySQL `0000-00-00` 等非法日期必须清洗。

移植到 MySQL：

- `TIMESTAMPTZ` 转 UTC `DATETIME(6)`。
- `JSONB` 转 `JSON`。
- PostgreSQL partial index、GIN/GIST、expression index 需要重新设计。
- 大字段索引长度和排序规则限制需要评估。

移植到 SQLite：

- 时间统一存 ISO 8601 或 epoch milliseconds。
- decimal 存字符串或最小单位整数。
- JSON 存 `TEXT` 并由应用校验。
- 外键需确认 `PRAGMA foreign_keys = ON`。

移植到 ClickHouse：

- ClickHouse 更适合作为分析和日志库，不应直接替代强事务 OLTP 主库。
- 主键、唯一约束和更新语义与 OLTP 数据库不同，必须按读模型或事件日志重新设计。

### 22.8 CDC 和下游兼容

如果数据库变更通过 CDC、binlog、logical replication、消息队列、ETL 或数仓任务同步，下游兼容必须进入结构演进计划。

规则：

- 删除字段前 MUST 确认 CDC consumer、数仓、报表、搜索索引、缓存、SDK 生成器均已切换。
- 字段重命名 SHOULD 视为“新增新字段 + 双写 + 下游切换 + 删除旧字段”，不要直接 rename。
- 枚举新增值 MUST 提前通知下游，消费者必须能处理未知值。
- JSON payload 新增字段必须保持向后兼容；删除或改义属于破坏性变更。
- CDC 事件 SHOULD 带 schema version 或结构变更版本，便于消费者灰度处理。
- 回填任务 SHOULD 标记来源，避免触发误告警或重复业务动作。

### 22.9 回滚和前滚

数据库变更不总能安全回滚。每个结构变更 MUST 明确采用回滚还是前滚：

| 类型 | 策略 |
| --- | --- |
| 新增表/字段 | 通常可回滚，但需确认应用版本 |
| 新增索引 | 可回滚，注意耗时 |
| 数据回填 | 通常采用前滚修复，回滚前需备份旧值 |
| 字段删除 | 不允许直接回滚，必须依赖备份或重新回填 |
| 类型收缩 | 高风险，必须先验证无截断 |
| 唯一约束变更 | 需提前清理冲突数据 |

发布顺序 SHOULD 先部署兼容应用，再执行扩展变更，再切换读写，最后收缩。

### 22.10 Schema Drift 和环境一致性

schema drift 指数据库实际结构、结构变更脚本、ORM 模型、schema registry、OpenAPI/SDK 之间发生不一致。大型系统必须主动检测，而不是等运行时报错。

必须比对的对象：

- 生产数据库实际 schema。
- 结构变更脚本最终状态。
- schema registry 契约。
- ORM/entity/model 定义。
- OpenAPI、GraphQL、gRPC schema。
- SDK DTO。
- CDC、数仓、搜索索引 mapping。

规则：

- CI SHOULD 在合并前执行 schema diff，发现未登记字段、类型漂移、索引漂移、约束漂移时阻断。
- 生产环境 SHOULD 定期导出 schema，与契约做 drift 检测。
- 紧急手工变更必须在 24 小时内补齐结构变更脚本和契约记录。
- 不允许只改 ORM 模型而不提交结构变更记录，也不允许只改数据库不更新 API/SDK 契约。
- 测试环境、预发环境、生产环境的参考数据和 schema 版本 SHOULD 可自动比对。
- 漂移修复必须优先保护数据，不得直接 drop 未知字段，除非确认无消费者和无数据价值。

## 23. 数据生命周期

### 23.1 状态机

核心业务表 SHOULD 定义状态机，而不是只定义状态枚举。状态机文档至少包含：

- 初始状态。
- 允许的状态流转。
- 终态。
- 失败和补偿状态。
- 是否允许恢复。
- 谁可以触发流转。

### 23.2 归档

大表归档 SHOULD 明确：

- 归档触发条件。
- 主表保留期限。
- 归档表结构是否与主表一致。
- 归档后查询入口。
- 外键和唯一约束如何处理。
- 恢复策略。

### 23.3 TTL 和清理

临时表、导入表、任务中间表、幂等记录 MAY 使用 TTL 清理：

- 必须有 `expire_at` 或等价字段。
- 清理任务必须限速。
- 清理任务必须跳过 `legal_hold = true`。
- 重要数据清理前 SHOULD 有审计或归档。

### 23.4 备份和恢复

表契约 SHOULD 标注恢复等级：

| 等级 | 说明 |
| --- | --- |
| R0 | 可重建数据，例如缓存、临时表、读模型 |
| R1 | 可从上游重放恢复，例如 outbox 派生数据 |
| R2 | 需要常规备份恢复，例如普通业务表 |
| R3 | 关键数据，需要 PITR、异地备份、恢复演练，例如账本、支付、审计 |

规则：

- 关键业务表 MUST 有恢复点目标 RPO 和恢复时间目标 RTO。
- 结构变更前 SHOULD 评估是否需要快照备份。
- 删除、匿名化、归档必须考虑备份和下游副本。
- 恢复演练结果 SHOULD 进入评审证据。

## 24. 派生数据和读模型

读模型、搜索索引、缓存表、数据仓库表不是事实来源，必须能重建。

读模型表 SHOULD 包含：

| 字段 | 说明 |
| --- | --- |
| `source_type` | 来源对象类型 |
| `source_id` | 来源对象 ID |
| `source_uuid` | 来源对象 UUID |
| `source_version` | 来源对象版本 |
| `rebuild_version` | 读模型构建版本 |
| `synced_at` | 最近同步时间 |

规则：

- 读模型不能成为唯一事实来源，除非契约明确它就是主表。
- 读模型同步 MUST 有幂等和重放能力。
- 搜索索引字段 SHOULD 从契约生成，避免与数据库字段语义漂移。
- 投影字段缺失或延迟 MUST 在 API 语义中说明。

### 24.1 数据质量规则

核心表 SHOULD 定义数据质量规则，供 CI、结构演进校验、离线巡检和告警使用。

| 规则类型 | 示例 |
| --- | --- |
| 完整性 | `uuid` 非空、`tenant_id` 非空、金额非空 |
| 唯一性 | `business_no` 无重复、幂等键无重复 |
| 合法性 | 枚举值在允许集合内、金额非负 |
| 一致性 | 流水汇总等于余额、订单支付状态一致 |
| 时序性 | `created_at <= updated_at`、`started_at <= finished_at` |
| 引用性 | 引用对象存在，跨服务引用可通过 API 或快照校验 |

数据质量任务 SHOULD 输出：

- 规则编号。
- 影响表和字段。
- 异常行数。
- 样例主键。
- 首次发现时间。
- 所属团队。
- 修复状态。

### 24.2 可观测性指标

关键表 SHOULD 配套运行指标：

| 指标 | 说明 |
| --- | --- |
| 写入 TPS | 判断容量和索引写放大 |
| 慢查询次数 | 判断索引和查询契约是否失配 |
| 死锁/锁等待 | 判断事务边界是否过大 |
| 唯一键冲突 | 判断幂等、重试或攻击行为 |
| 回填进度 | 判断结构演进是否可控 |
| CDC 延迟 | 判断下游一致性 |
| 数据质量异常数 | 判断契约被破坏程度 |

L3 表 SHOULD 有仪表盘和告警阈值。结构变更窗口内 SHOULD 临时提高监控粒度。

### 24.3 数据血缘和数据目录

跨语言、跨数据库、跨服务同步或替换时，必须能回答字段从哪里来、流向哪里、谁在使用。

数据目录 SHOULD 记录：

| 项 | 说明 |
| --- | --- |
| source_table | 来源表 |
| source_column | 来源字段 |
| transform | 转换规则 |
| target_table | 目标表、索引、topic、报表或 SDK 字段 |
| owner | 负责团队 |
| freshness | 数据延迟要求 |
| quality_rule | 质量规则 |
| deprecation | 废弃计划 |

规则：

- 进入数仓、湖仓、搜索、缓存、消息 topic 的字段 SHOULD 有 lineage 记录。
- 字段删除或改义前 MUST 查询血缘，确认下游消费者已经切换。
- 手工报表、临时脚本、外部 BI 如果依赖生产表，也应登记为消费者。
- 数据目录 SHOULD 与 schema registry 共享字段 ID 或稳定路径，避免字段重命名后血缘断裂。
- L3 表的关键字段 SHOULD 标注数据新鲜度 SLO，例如 CDC 延迟小于 5 分钟。

## 25. 非关系数据库适配

本规范以关系表为标准契约。使用文档库、键值库、图数据库、搜索引擎、列式库时，应按以下方式适配：

| 存储类型 | 适配方式 |
| --- | --- |
| 文档库 | 文档必须包含 `id/uuid/created_at/updated_at/version` 等等价字段，核心查询字段仍需独立索引 |
| 键值库 | key 命名必须包含租户和业务边界，value schema 必须版本化 |
| 搜索引擎 | 索引是读模型，必须有来源对象和同步版本 |
| 列式库 | 作为日志、分析、审计派生库，不替代强事务主表 |
| 图数据库 | 节点和边仍需稳定 ID、类型、版本、审计字段 |
| 对象存储 | 元数据表必须记录对象 key、hash、大小、MIME、owner、生命周期 |
| 湖仓/数仓 | 表必须保留来源系统、同步批次、schema version 和数据日期 |
| 流式平台 | 消息 key、事件版本、幂等键和消费者去重策略必须明确 |

跨存储移植时，关系契约作为基准语义，不以某个派生存储的字段格式反向污染核心表结构。

规则：

- MongoDB、DynamoDB、Cassandra 等文档或宽列存储可以使用嵌套结构，但核心过滤和唯一字段仍需要明确索引。
- Redis 等缓存系统只能作为派生数据或短期状态，不能成为没有持久化契约的事实来源。
- Kafka、Pulsar、RabbitMQ 等事件系统中的消息 schema 必须版本化，并能映射回数据库契约。
- S3、OSS、MinIO 等对象存储中的文件必须有元数据表或 manifest，不允许只把对象 key 散落在业务 JSON 中。
- Snowflake、BigQuery、Databricks、Hive、Iceberg、Delta Lake 等分析表必须标注来源、批次、延迟和字段血缘。

## 26. 自动化检查规则

CI、结构变更工具或 schema linter SHOULD 实现以下规则。

| 编码 | 等级 | 规则 |
| --- | --- | --- |
| DB001 | MUST | 表名和字段名为小写下划线 |
| DB002 | MUST | 持久业务表有主键 |
| DB003 | MUST | L1 及以上业务表有 `id`、`created_at`、`updated_at` |
| DB004 | SHOULD | 核心业务表有 `uuid` 唯一约束 |
| DB005 | MUST | 多租户表有 `tenant_id` |
| DB006 | MUST | 多租户列表索引以 `tenant_id` 开头 |
| DB007 | MUST | 金额字段不用 float/double |
| DB008 | MUST | `int64` API 序列化策略已声明 |
| DB009 | SHOULD | 状态字段有枚举文档或字典表 |
| DB010 | MUST | 幂等场景有唯一键 |
| DB011 | SHOULD | JSON 字段有 schema 或 DTO |
| DB012 | MUST | 敏感字段有分类和存储策略 |
| DB013 | MUST | 破坏性结构变更有扩展收缩计划 |
| DB014 | SHOULD | 外键列有索引 |
| DB015 | SHOULD | 大表新增索引说明在线策略 |
| DB016 | MUST | 时间字段统一 UTC/ISO 8601 策略 |
| DB017 | SHOULD | 软删除表唯一键策略明确 |
| DB018 | MUST | L3 表有审计、留存、回滚和校验方案 |
| DB019 | SHOULD | 派生表有来源对象和同步版本 |
| DB020 | MUST | 平台级跨租户查询显式授权 |
| DB021 | MUST | 共享表有事实来源和写入所有者 |
| DB022 | SHOULD | 契约有版本号和兼容窗口 |
| DB023 | MUST | 大小写不敏感唯一字段有规范化策略 |
| DB024 | SHOULD | 大表有分区、分片或增长治理说明 |
| DB025 | MUST | 关键并发写入有锁、版本、条件更新或唯一约束 |
| DB026 | SHOULD | 列表查询有排序和分页契约 |
| DB027 | MUST | 对外 API 限制最大 page size |
| DB028 | SHOULD | L3 表有 RPO/RTO 和恢复演练证据 |
| DB029 | SHOULD | CDC 下游兼容进入结构演进计划 |
| DB030 | MUST | 字段删除前确认 SDK、数仓、搜索、缓存消费者已切换 |
| DB031 | SHOULD | 数据质量规则覆盖完整性、唯一性、合法性、一致性 |
| DB032 | SHOULD | 关键表有慢查询、锁等待、CDC 延迟和数据质量监控 |
| DB033 | MUST | 密码、token、私钥不出现在日志、审计、错误表明文字段中 |
| DB034 | SHOULD | 对象存储资源有元数据表或 manifest |
| DB035 | MUST | 事件 schema 有事件版本和消费者未知字段兼容策略 |
| DB036 | SHOULD | 文本唯一字段声明字符集、排序规则和规范化方式 |
| DB037 | MUST | 核心表声明业务域和写入 owner |
| DB038 | SHOULD | 跨服务共享语义声明 bounded context |
| DB039 | SHOULD | 快照和反规范化字段声明来源和 schema version |
| DB040 | MUST | EAV/JSON 不承载金额、状态、租户、权限、幂等等核心字段 |
| DB041 | SHOULD | L2/L3 表有容量模型和索引预算 |
| DB042 | SHOULD | 重复或无查询契约绑定的索引进入清理清单 |
| DB043 | MUST | 高敏字段声明 sensitivity 和 masking_rule |
| DB044 | SHOULD | 数据导出路径有审计和过期策略 |
| DB045 | SHOULD | 进入数仓、搜索、缓存、topic 的字段有 lineage |
| DB046 | SHOULD | L3 关键字段声明 freshness SLO |
| DB047 | MUST | ABAC/RLS 策略依赖字段不得只存在于 JSON |
| DB048 | SHOULD | Policy-as-code 策略有版本、测试和回滚方案 |
| DB049 | MUST | ID 生成策略声明时钟回拨、节点冲突和失败处理 |
| DB050 | SHOULD | 对外公开 ID 不直接使用连续自增主键 |
| DB051 | MUST | 第三方 ID 使用 provider + external_id 唯一边界 |
| DB052 | MUST | 金额字段声明币种、精度和 rounding mode |
| DB053 | SHOULD | 税费、折扣、汇率字段声明计算口径和事实来源 |
| DB054 | MUST | L3 表声明读一致性要求和副本延迟策略 |
| DB055 | MUST | 数据驻留和跨境同步要求进入安全评审 |
| DB056 | SHOULD | reference/seed/lookup 数据由幂等脚本或受控发布管理 |
| DB057 | MUST | 对外发布的 reference code 不得复用为新含义 |
| DB058 | SHOULD | CI 或巡检执行 schema drift 检测 |
| DB059 | MUST | ORM、DDL、schema registry、API/SDK 契约变更保持同步 |
| DB060 | SHOULD | L3 表有运维 runbook 和演练记录 |
| DB061 | MUST | 新建业务表第一段为受控业务模块前缀 |
| DB062 | MUST | 表名前缀不得使用产品名、项目名、公司名或技术栈名作为默认业务前缀 |
| DB063 | SHOULD | 产品/部署命名空间放在 schema/catalog/database 层，而不是表名第一段 |
| DB064 | MUST | 模块前缀必须登记 owner、bounded context 和示例表 |
| DB065 | MUST | 跨模块共享表使用事实来源模块前缀 |
| DB066 | SHOULD | 存量项目级前缀表有目标模块前缀映射和标准化整改说明 |
| DB067 | MUST | 同一物理表名被多个实体/契约映射时有共享语义说明或冲突整改计划 |
| DB068 | MUST | 存量表名前缀合规差距标注 P0/P1/P2/P3 优先级和风险原因 |
| DB069 | MUST | `owner-review` 表完成事实来源 owner 确认后才能进入标准目标名确认 |
| DB070 | SHOULD | 外部渠道、连接器、供应商账号表使用 `integration_` 前缀 |
| DB071 | SHOULD | 工作空间、项目、应用、模板等设计时资产使用 `studio_` 或更具体业务前缀 |
| DB072 | SHOULD | 实体注解、DDL、结构变更脚本、审计文件和 schema linter 规则保持同一前缀注册表 |

检查输出 SHOULD 标注表名、字段名、规则编码、严重级别、修复建议。

## 27. 设计评审清单

### 27.1 新表评审

- [ ] 已选择表画像和合规等级。
- [ ] 已明确事实来源，是否为主表、读模型、日志、派生索引。
- [ ] 已定义 `id` 生成策略。
- [ ] 已定义 `uuid` 或等价外部稳定 ID。
- [ ] 已包含 `created_at/updated_at/version`，或说明为什么不需要。
- [ ] 已明确是否需要 `tenant_id/organization_id/data_scope`。
- [ ] 已明确是否需要 `user_id`、`owner_type/owner_id`。
- [ ] 已定义 `status` 和状态机。
- [ ] 已定义软删除、归档、物理删除策略。
- [ ] 已定义唯一键和业务边界。
- [ ] 已定义高频查询和对应索引。
- [ ] 金额、decimal、时间、int64、JSON 序列化已明确。
- [ ] 高频查询字段没有只放在 JSON 中。
- [ ] 枚举支持未知值。
- [ ] 敏感字段已分类和脱敏。
- [ ] 幂等场景有唯一约束。
- [ ] 跨服务事件有 outbox/inbox 或等价可靠机制。
- [ ] 已给出 PostgreSQL/MySQL/SQLite 等目标数据库映射。
- [ ] 已给出 TypeScript/Python/Rust/Go/Java/C#/PHP 等目标语言映射。
- [ ] 已设计结构演进、回填、校验和回滚策略。

### 27.2 结构变更评审

- [ ] 是否破坏兼容。
- [ ] 是否需要双写。
- [ ] 是否需要回填。
- [ ] 是否会锁表。
- [ ] 是否影响索引大小和写入性能。
- [ ] 是否影响 SDK/API。
- [ ] 是否影响 CDC、数仓、搜索索引。
- [ ] 是否有校验 SQL。
- [ ] 是否有回滚或前滚方案。
- [ ] 是否有灰度发布顺序。

### 27.3 安全评审

- [ ] 是否包含密码、token、key、私钥。
- [ ] 是否包含 PII。
- [ ] 是否需要加密、哈希、盲索引。
- [ ] 日志和审计是否会泄露敏感信息。
- [ ] 数据导出是否需要脱敏。
- [ ] 数据保留和删除是否符合法规。

### 27.4 评审评分

建议用 100 分制记录数据库设计成熟度。低于 80 分的新核心表不应进入生产。

| 类别 | 分值 | 检查重点 |
| --- | ---: | --- |
| 字段契约 | 15 | 标识、审计、命名、逻辑类型、空值策略 |
| 隔离和权限 | 15 | 租户、组织、用户、owner、平台共享数据 |
| 约束和索引 | 15 | 主键、唯一键、查询索引、外键或应用级校验 |
| 结构演进能力 | 15 | 扩展收缩、回填、校验、回滚/前滚、CDC |
| 跨语言/API | 10 | int64、decimal、时间、枚举、SDK 映射 |
| 安全合规 | 10 | 敏感字段、加密、脱敏、审计、留存 |
| 可观测和幂等 | 10 | request_id、trace_id、idempotency_key、事件一致性 |
| 数据生命周期 | 10 | 状态机、软删除、归档、TTL、法务冻结 |

评审结论 SHOULD 记录为：

- `APPROVED`：可进入实现。
- `APPROVED_WITH_NOTES`：允许实现，但必须跟踪整改项。
- `REVISE_REQUIRED`：必须修改后重新评审。
- `REJECTED`：设计方向不符合数据契约或业务风险不可接受。

### 27.5 标准表设计说明模板

每张新核心表 SHOULD 附带一份表设计说明。可以是 Markdown、YAML、JSON 或 schema registry 记录。

```yaml
table: content_document
title: 内容文档
domain: content
bounded_context: content-authoring
profile: user_entity
compliance_level: L2
system_of_record: true
write_owner: content-service
read_consumers:
  - app-api
  - search-indexer
  - warehouse-sync
contract_version: 1.2.0
compatibility_window: 30d
id_strategy:
  type: snowflake
  clock_rollback: reject_and_alert
  public_id: uuid
tenant_strategy:
  required: true
  shared_tenant_id: 0
api_serialization:
  int64: string
  decimal: string
  time: iso8601_utc
query_contract:
  default_sort: [updated_at, id]
  pagination: cursor
  max_page_size: 100
capacity:
  expected_rows_1y: 10000000
  peak_write_tps: 500
  index_budget: 6
consistency:
  read_model: read_your_writes
  replica_lag_budget: 5s
lifecycle:
  delete_mode: soft_delete
  retention: 3y
security:
  sensitivity: INTERNAL
  pii: false
  masking_rule: none
  encrypted_fields: []
evolution:
  rollout: expand_backfill_compatible_contract
  cdc_consumers: [warehouse-sync, search-indexer]
schema_drift:
  check_in_ci: true
  check_in_prod: daily
lineage:
  downstream:
    - search_index: content_document_idx
    - warehouse_table: dwd_content_document
quality_rules:
  - uuid_not_null
  - tenant_scope_required
  - created_before_updated
runbook:
  owner: content-platform
  backfill_pause: supported
  restore_level: R2
```

评审时 SHOULD 优先审这份契约，再审物理 DDL 或 ORM 代码。

## 28. 反模式

MUST NOT：

- 把租户 ID 只放在 JSON。
- 支付回调没有唯一事件约束。
- 金额使用 float/double。
- JavaScript 前端直接接收 64 位整数 number。
- 同一时间字段混用本地时间和 UTC。
- 在应用已经上线后直接删除字段。
- 用字符串文案作为枚举值。
- 用 `metadata` 存所有核心业务字段。
- 软删除表唯一键策略不明确。
- 平台管理接口因为缺少租户上下文而默认全表查询。
- 跨服务引用依赖数据库外键。
- 只改余额不写流水。
- 消息消费没有 inbox 去重或等价幂等机制。

SHOULD NOT：

- 所有字符串无脑 `VARCHAR(255)`。
- 所有表无脑继承同一字段组。
- 为低频字段建立大量索引。
- 让 ORM 自动命名生产约束。
- 在公共契约里暴露某个数据库专有类型作为唯一类型。
- 把 API 字段命名和数据库命名在各服务中随意转换。

## 29. 落地路线

### 29.1 新系统

1. 建立可移植数据契约模板。
2. 确定目标数据库方言和最低兼容数据库。
3. 建表前完成画像、字段、索引、结构演进、安全评审。
4. 从契约生成 DDL、ORM 模型、OpenAPI schema、SDK DTO 或反向校验。
5. CI 接入 schema linter。
6. 发布后所有字段变更必须走结构演进流程。

### 29.2 存量系统

1. 扫描现有表结构和访问路径。
2. 给每张表标注画像和合规等级。
3. 建立历史字段到标准字段的映射。
4. 优先补齐高风险表：租户、支付、账户、权限、Webhook、审计。
5. 对外契约先统一字段语义，再逐步改物理字段。
6. 结构演进期间允许兼容字段存在，但必须有退出计划。

### 29.3 多团队治理

- 每个业务域 SHOULD 有 schema owner。
- 公共字段变更 MUST 评审。
- 跨服务表或共享表 MUST 有契约版本。
- SDK 生成器和数据库结构变更工具 SHOULD 读取同一份契约。
- 数据平台、搜索、审计、报表变更必须纳入评审。

### 29.4 环境、测试数据和运维手册

标准必须覆盖从开发到生产的全链路，而不是只覆盖建表时刻。

环境要求：

- 开发、测试、预发、生产 SHOULD 使用同一套结构变更机制。
- 测试数据 fixture SHOULD 版本化，并与参考数据版本匹配。
- 测试环境不得依赖生产高敏明文数据。需要生产样本时必须脱敏、抽样和审批。
- 预发环境 SHOULD 使用接近生产的 schema、索引、数据量和配置，避免小数据量掩盖慢查询。
- 数据库初始化脚本必须可重复执行，不能依赖人工执行顺序。

运维 runbook SHOULD 包含：

- 新增字段发布步骤。
- 回填任务启动、暂停、恢复、终止方式。
- 索引在线创建和回滚方式。
- 慢查询应急处理。
- 复制延迟和 CDC 延迟处理。
- 误删、误更新、错误结构变更的恢复流程。
- 数据导出和删除请求处理流程。
- schema drift 处置流程。

L3 表的 runbook MUST 至少每半年演练一次，并记录演练结果。

## 30. 既有系统兼容映射附录

本节只用于把既有 Java/JPA 风格系统映射到通用规范，不能作为新系统的主体设计依据。Rust、Python、TypeScript、Go、PHP、C# 等服务应直接实现本文的标准字段语义，而不是依赖这些类名。

| 既有概念 | 通用规范 |
| --- | --- |
| `PlusBaseEntity` | `tenant_entity`：`id/uuid/created_at/updated_at/version/tenant_id/organization_id/data_scope` |
| `PlusBaseIdEntity` | `core_entity`：`id/uuid/created_at/updated_at/version` |
| `PlusUserBaseEntity` | `user_entity`：`tenant_entity + user_id` |
| `PlusBaseTreeEntity` | `tree_entity`：`tenant_entity + parent_id/parent_uuid/path/level_no/sort_order` |
| `PlusOwnerSupportEntity` | `owner_scope`：`owner_type/owner_id` |
| `v` | `version` 的历史短字段形式 |
| `created_time` | 标准化为 `created_at` |
| `updated_time` | 标准化为 `updated_at` |
| Java enum converter | 通用枚举映射器，其它语言也必须有等价映射 |
| Hibernate filter | 通用租户、组织、用户查询过滤规则的一种实现 |

既有服务可以继续使用原有基础类，但跨语言、跨服务、跨数据库的公共契约应输出本文的通用字段命名和语义。

### 30.1 当前工程表名前缀兼容映射

对 `spring-ai-plus-business-entity/src/main/java/com/sdkwork/spring/ai/plus/entity` 的实体表定义进行扫描，用于校验本规范对既有系统的兼容映射能力，当前结论：

- 扫描 `278` 个 Java 文件，识别到 `196` 个 `@Entity + @Table(name=...)` 实体表定义。
- 实体表唯一物理表名为 `193` 个。
- 所有实体表名第一段均为 `plus`。
- `src/main/resources/database` 下 `7` 个 SQL 结构变更文件包含 `56` 处 `create table/alter table` 表引用，涉及 `23` 个唯一表名，第一段也全部为 `plus`。
- `plus` 是产品/项目级命名空间，不是业务模块前缀。
- 当前实体和 SQL 表名不满足新标准 `<module_prefix>_<entity_name>` 的 L1 命名要求，只能视为 L0 legacy compatible。
- 发现 3 组实体共享同一物理表名，需要单独评审是否为有意复用还是命名冲突。
- 全量实体映射、目标前缀、合规优先级和风险标记已固化到 `DATABASE_TABLE_PREFIX_AUDIT.md`，用于标准化评审和工具校验。
- 本模块提供 `scripts/check-table-prefix.ps1` 作为本地巡检入口；默认 report 模式用于观察 legacy 状态，`-Strict` 模式可接入 CI 阻断新非标准表名。

重复表名清单：

| 表名 | 实体 |
| --- | --- |
| `plus_agent_skill` | `PlusAgentSkill`、`PlusSkill` |
| `plus_agent_skill_package` | `PlusAgentSkillPackage`、`PlusSkillBundle` |
| `plus_user_agent_skill` | `PlusUserAgentSkill`、`PlusUserSkillInstall` |

存量表目标前缀建议：

| 当前包模块 | 目标业务前缀 | 说明 |
| --- | --- | --- |
| `agent`, `model`, `prompt`, `tool`, `generation`, `character`, `skill`, `plugin`, `usage` | `ai` | AI 能力域 |
| `record` 中的调用/用量事实 | `ai` | AI 调用记录、调用明细、用量事实 |
| `user`, `tenant`, `organization`, `rbac`, `security`, `invitation` | `iam` | 身份、租户、权限、安全 |
| `platform` 中的 API key、安全策略 | `iam` | 访问凭证和 API 安全策略 |
| `platform` 中的 channel/account/proxy/resource | `integration` | 外部渠道、供应商连接器和代理配置 |
| `app`, `project`, `workspace`, `docs`, `ppt` | `studio` | 设计时工作空间、项目、应用、文档页、模板 |
| `trade`, `account`, `currency`, `coupon`, `product`, `vip`, `card`, `invoice`, `shop`, `partner` | `commerce` | 交易、账户、商品、会员、佣金伙伴 |
| `article`, `comments`, `collection`, `favorite`, `feeds`, `news`, `tags`, `share`, `detail`, `category`, `vote` | `content` | 内容和互动 |
| `files`, `image`, `video`, `voice`, `music`, `human`，以及媒体发布记录 | `media` | 文件和媒体资源 |
| `conversation`, `message`, `topic`, `im`, `rtc`, `sns` | `comms` | 会话、消息、实时通信、社交关系 |
| `datasource`, `vectorstore`, `memory`, `knowledge` | `data` | 数据源、知识和向量数据 |
| `claw`, `schedule`, `events`, `notification`, `email`, `net`, `url`, `feedback`, `visit` | `ops` | 运营、任务和系统事件 |
| `game` | `game` | 游戏域 |
| `recruit` | `recruit` | 招聘域 |

标准命名目标示例：

| 当前表 | 标准目标名 |
| --- | --- |
| `plus_user` | `iam_user` |
| `plus_role_permission` | `iam_role_permission` |
| `plus_order` | `commerce_order` |
| `plus_payment_webhook_event` | `commerce_payment_webhook_event` |
| `plus_ai_agent` | `ai_agent` |
| `plus_ai_model_info` | `ai_model_info` |
| `plus_usage_record` | `ai_usage_record` |
| `plus_channel_account` | `integration_channel_account` |
| `plus_app` | `studio_app` |
| `plus_project` | `studio_project` |
| `plus_workspace` | `studio_workspace` |
| `plus_chat_message` | `comms_chat_message` |
| `plus_file` | `media_file` |
| `plus_media_publish_record` | `media_publish_record` |
| `plus_claw_schedule_task` | `ops_claw_schedule_task` |

标准整改优先级：

| 优先级 | 当前数量 | 判定标准 | 处理要求 |
| --- | ---: | --- | --- |
| P0 | 6 | 重复物理表名或目标表名冲突 | 先解决实体映射冲突，禁止把冲突带入标准命名 |
| P1 | 38 | 核心事实表、跨模块表、owner 需要复核的表 | 完成 owner-review 和事实来源确认 |
| P2 | 129 | 业务归属清晰的普通领域表 | 作为新表、新模块、后续标准化工作的默认目标名 |
| P3 | 23 | 历史、事件、日志、快照、访问记录等 append/operational 数据 | 结合保留策略和归档策略确认标准目标名 |

标准执行边界：

- 本节只定义表名前缀标准、当前合规差距和标准目标名，不要求本轮修改任何物理表、实体注解或 SQL 文件。
- 新表和新模块必须直接使用标准业务前缀。
- 存量 `plus_*` 表先作为 L0 legacy compatible 记录，不因为本规范自动触发数据库改名。
- 如果未来单独提出物理改名需求，才需要另行设计兼容视图、双写、回填、校验和回滚/前滚方案。
- 重复物理表名必须先完成语义审计，再决定是保留共享、拆分模型，还是修正实体映射。
- `owner-review` 表必须先确认事实来源模块，例如 `plus_app`、`plus_project`、`plus_workspace` 归入 `studio_` 后，引用它们的字段注释、外键、索引名也要同步更新为目标语义。

## 31. 最小合规示例

一个 L2 多租户业务表至少应长这样：

```sql
CREATE TABLE content_document (
    id BIGINT NOT NULL,
    uuid VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL,
    organization_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL,
    data_scope INTEGER NOT NULL DEFAULT 1,
    title VARCHAR(200) NOT NULL,
    status INTEGER NOT NULL,
    metadata JSON,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP,
    deleted_by BIGINT,
    PRIMARY KEY (id),
    CONSTRAINT uk_content_document_uuid UNIQUE (uuid)
);

CREATE INDEX idx_content_document_tenant_user_status_updated
    ON content_document (tenant_id, organization_id, user_id, status, updated_at);
```

对应契约必须说明：

- `id` 由哪个 ID 服务生成。
- `uuid` 对外暴露。
- `tenant_id/organization_id/user_id` 从哪里解析。
- `status` 的枚举和值含义。
- `metadata` 的 schema。
- `int64` 在 API 中作为字符串。
- 删除是软删除，使用 `deleted_at/deleted_by`。
- 更新使用 `version` 防止并发覆盖。

## 32. 总结

本规范的核心不是统一编程语言，也不是统一 ORM，而是统一数据语义：

- `id` 和 `uuid` 解决内部关联、外部引用、跨库同步。
- `created_at`、`updated_at`、`version` 解决审计和并发。
- `tenant_id`、`organization_id`、`user_id`、`owner_type`、`owner_id`、`data_scope` 解决隔离和归属。
- `status`、`deleted_at`、`archived_at`、`retention_until` 解决生命周期。
- `request_id`、`idempotency_key`、`external_event_id`、`payload_hash` 解决幂等和追踪。
- 逻辑类型映射让 PostgreSQL、MySQL、SQLite、SQL Server、Oracle、ClickHouse 等数据库可以互相移植、同步或替换。
- 序列化契约让 Rust、Python、TypeScript、Java、Go、PHP、C# 等服务可以安全共享同一套表结构。
- 结构演进治理、自动化检查和评审清单保证标准可以长期执行，而不是停留在文档。

只要不同应用架构遵循这些字段语义、类型映射、索引边界、权限隔离、结构演进流程和跨语言序列化规则，就能在技术栈变化、服务拆分、数据库替换和团队扩张时保持数据可读、可移植、可审计、可扩展。
