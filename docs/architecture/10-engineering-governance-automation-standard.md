# 10 Engineering Governance Automation Standard

日期：2026-04-26

## 目标

本标准定义架构约束如何被自动化检查。没有自动化检查的标准容易退化成注释，本项目必须把关键边界做成 contract/gate。

## Governance Commands

建议根 `package.json` 提供：

```bash
pnpm check:architecture-standards
pnpm check:runtime-boundaries
pnpm check:contracts
pnpm check:deployment-matrix
pnpm deployment:doctor -- --json
pnpm check:provider-conformance
pnpm check:media-pipeline
pnpm check:security
pnpm check:license
pnpm check:release-flow
pnpm check:multi-mode
pnpm check:adr
pnpm check:slo
pnpm check:migrations
pnpm check:database-contracts
```

Current implementation:

- `pnpm check:governance -- --json` emits `video-cut.governance-suite.v1`.
- The report is written to `artifacts/governance/governance-suite-report.json`.
- `pnpm check:architecture-standards`, `pnpm check:runtime-boundaries`, `pnpm check:security`, `pnpm check:license`, `pnpm check:release-flow`, `pnpm check:adr`, and `pnpm check:slo` all run category-scoped slices of `scripts/check-video-cut-governance-suite.mjs`.
- `pnpm check:license` generates `artifacts/governance/sdkwork-video-cut-sbom.cdx.json` in CycloneDX 1.6 format.
- `pnpm check:deployment-matrix -- --json` emits `video-cut.deployment-matrix.v1`.
- The report is written to `artifacts/governance/deployment-matrix-report.json`.
- The check validates the canonical `/api/video-cut/v1` route, doctor scripts, release package/smoke scripts, Docker artifacts, Kubernetes artifacts, and release command script.
- Default governance-family JSON report fields must serialize project-relative paths for project-local artifacts: `artifacts/governance/governance-suite-report.json`, `artifacts/governance/feature-readiness-report.json`, `artifacts/governance/deployment-matrix-report.json`, and `artifacts/governance/database-contracts-report.json`.
- Absolute paths may be used internally to write reports, and externally supplied absolute `--report-dir` values may remain absolute for test isolation or automation-owned output locations.
- Generated governance reports are runtime artifacts and are not source-controlled.

## Architecture Checks

`check:architecture-standards` 必须检查：

- `docs/architecture/00-architecture-map.md` 存在。
- authority order 中列出的文件存在。
- 禁止向 `standalone-design` 追加正式架构内容。
- `ARCHITECT.md` 指向 `docs/architecture/00-architecture-map.md`。
- package 命名使用 `sdkwork-video-cut-*`。
- source-entry manifest 规则。
- TypeScript path alias parity。
- ADR 文件编号连续，accepted 决策有 review trigger。
- technology radar 中 `adopt` 技术必须在选型矩阵中出现。

## Runtime Boundary Checks

`check:runtime-boundaries` 必须检查：

- `src-tauri` 不实现业务 use case。
- 前端不直接调用 FFmpeg、OpenAI-compatible endpoint、Whisper、本地业务路径。
- feature package 不硬编码 `/api/local/v1`。
- canonical route 只能是 `/api/video-cut/v1`。
- use case 不读取 env/Secret/ConfigMap。
- adapter DTO 不泄漏到 domain。

## Contract Checks

`check:contracts` 必须检查：

- OpenAPI 3.1 schema 可解析。
- route inventory 与 Rust routes 一致。
- TypeScript host types 与 Rust DTO parity。
- JSON Schema `$id` 唯一。
- LLM output schema 有 `additionalProperties: false`。
- runtime config schema 与 `.env.example`、Helm values、settings UI 字段一致。
- API/schema/manifest/prompt/provider 版本字段存在。
- old fixture migration tests 只在存在历史 schema/manifest 版本时要求。

## Provider Conformance Checks

每个 provider adapter 必须跑：

- fake adapter conformance。
- real adapter disabled smoke。
- capability schema。
- health check。
- unsupported capability。
- timeout/cancel。
- redaction。
- error mapping。

当前最小自动化门禁：

- `host/tests/provider_contract_test.rs` 覆盖 `video-cut.provider-conformance.v1` dry-run report、端点拼接、结构化输出声明和 secret redaction。
- `host/tests/host_contract_test.rs` 覆盖 `POST /api/video-cut/v1/providers/openai-compatible/conformance` canonical envelope。
- `src/__tests__/httpHostClient.test.ts` 覆盖 `VideoCutHostClient.runProviderConformance()` 只调用 host API。
- `src/__tests__/mockHostClient.test.ts` 覆盖 fake adapter conformance 和前端 redaction。
- `src/__tests__/settingsCenter.test.tsx` 覆盖设置中心测试入口。
- `src/__tests__/openApiContract.test.ts` 覆盖 OpenAPI path 和 schema。

门禁规则：provider conformance report 中不得出现 `apiKey`、secret ref、Authorization header、token 或明文密钥；只能出现 `credentialStatus`。

## Deployment Matrix Checks

`check:deployment-matrix` 必须检查：

- `desktop-local` 有 dev/package/smoke 命令。
- `server-private` 有 dev/package/smoke 命令。
- `container-private` 有 Dockerfile/compose/smoke。
- `kubernetes-private` 有 Chart/values/template smoke。
- release family: desktop/server/web/container/kubernetes 都存在 package + smoke。
- `deploy/runtime-profiles.yaml` runtime profile manifest 与 deployment docs 一致。
- readiness level 与 runtime profile manifest 一致。

## Security Checks

Additional active security gates:

- render asset preference guard: Workbench stores user BGM/SFX choices only in `VideoSplitPlan.renderPreferences.audio`; Host and TypeScript contracts validate `auto`, `asset`, and `disabled`; `asset` mode may only reference an `assetId` and `assets://...` path returned by `GET /assets/catalog`; render manifests and logs must not expose server-local paths.
- task event recovery hint guard: Host failure events must publish safe `VideoCutProgressEvent.metadata.recoveryHint` metadata; OpenAPI, frontend types, Workbench, Queue, contract tests, and governance tests must keep the schema aligned; recovery hints must not contain secrets, Authorization headers, raw provider payloads, FFmpeg raw stderr, or server-local absolute paths.
- diagnostics support bundle consent guard: `POST /diagnostics/support-bundle` must require `consentAccepted=true` before source media or transcript attachment descriptors are returned; Host, OpenAPI, HTTP/mock clients, Diagnostics page, Settings Center, frontend redaction scan, contract tests, and governance tests must prove descriptors use host-relative `contentRef` and never expose server-local absolute paths.
- JSON request rejection envelope guard: every Host JSON request-body extractor must normalize malformed or schema-incompatible JSON into `ApiErrorEnvelope` with `REQUEST_JSON_INVALID`; Axum default `text/plain` extractor bodies must not escape through public `/api/video-cut/v1` endpoints.
- multipart request rejection envelope guard: every Host multipart upload extractor must normalize malformed multipart bodies, missing boundaries, and extractor-level multipart failures into `ApiErrorEnvelope` with `MULTIPART_INVALID`; upload business validation keeps dedicated domain codes such as `SOURCE_FILE_REQUIRED`, `SOURCE_FILE_TYPE_UNSUPPORTED`, and `SOURCE_FILE_TOO_LARGE`.
- path parameter rejection envelope guard: every Host path-parameter extractor must normalize invalid percent-decoding, invalid UTF-8, missing path params, and path deserialization failures into `ApiErrorEnvelope` with `PATH_PARAMETER_INVALID`; Axum default `text/plain` path extractor bodies must not escape through public `/api/video-cut/v1` endpoints.
- query parameter extraction standard guard: every Host query-parameter extractor must go through the standard query boundary and map query deserialization failures into `ApiErrorEnvelope` with `QUERY_PARAMETER_INVALID`; endpoint domain validation keeps dedicated codes such as `SUBTITLE_FORMAT_INVALID`.
- HTTP Host client error normalization guard: the browser HTTP adapter must parse standard `{ ok: false, error }` envelopes consistently for JSON APIs, text artifact reads, and binary artifact reads, and must throw `VideoCutHostApiError` with code, HTTP status, traceId, and endpoint instead of rendering error envelopes as text or Blob content.
- HTTP Host client success envelope guard: the browser HTTP adapter must reject 2xx JSON API responses that are not standard `{ ok: true, data }` envelopes with `RESPONSE_ENVELOPE_INVALID`, preventing malformed Host/proxy responses from entering UI state as `undefined` or untyped data.
- runtime CORS origin allowlist guard: Host CORS must use `security.corsAllowedOrigins` and `SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS`, reject wildcard origins, and must not use `allow_origin(Any)`.
- Results artifact error metadata guard: Results page artifact preview, render-manifest loading, and artifact download failures must render the normalized `OperationError` metadata inline, including code, HTTP status, traceId, and endpoint.
- public artifact content URL helper guard: frontend Host client ports must not expose `getArtifactContentUrl` or any equivalent reusable private URL helper; UI artifact preview/download code must use authenticated Blob/text readers and short-lived `blob:` URLs.
- task plan load error propagation guard: startup and task refresh must not request `getTaskPlan` for `draft` or `sourceReady` tasks because analysis has not produced a plan yet; for post-analysis tasks they must not use broad `catch(() => undefined)` or broad HTTP 404 checks; only `TASK_PLAN_NOT_FOUND` may become an empty selected plan, while `TASK_NOT_FOUND` and all other Host failures reach `OperationError`.
- mock Host client standard error guard: local mock mode public Host client methods must throw `VideoCutHostApiError` from the shared domain error contract for user-visible failures, preserving code, HTTP status, traceId, and endpoint just like HTTP Host mode.
- API route not found envelope guard: unknown public `/api/video-cut/v1` routes must return `ApiErrorEnvelope` with `ROUTE_NOT_FOUND`; framework default empty or `text/plain` 404 bodies must not escape through the public API surface.
- API method not allowed envelope guard: unsupported methods on known public `/api/video-cut/v1` routes must return `ApiErrorEnvelope` with `METHOD_NOT_ALLOWED`; framework default empty or `text/plain` 405 bodies must not escape through the public API surface.

`check:security` 必须检查：

- 没有 API key/token 默认值。
- 没有 `localStorage` 保存 secret。
- server `0.0.0.0` profile 必须有 auth。
- path guard tests 存在。
- task creation guard 存在：Host、mock adapter、OpenAPI、TypeScript contract 和 contract tests 必须共同证明 `POST /tasks` 只创建 `draft` 任务，不接受 `sourceName`、不发布 `kind=source` artifact、不生成 import event、不合成 `input.mp4`。
- analyze source guard 存在：Host、mock adapter、Workbench 和 contract tests 必须共同证明无 source artifact 的 `draft` 任务不能进入分析链路，并返回 `SOURCE_FILE_REQUIRED`。
- sample import guard 存在：Workbench 示例导入必须走 `uploadTaskSourceFile()`，使用内置小型 MP4 `File`，禁止用 metadata-only source placeholder 冒充真实上传。
- source media type guard 存在：Host、mock adapter、Workbench、OpenAPI 和 contract tests 必须共同覆盖 `SOURCE_FILE_TYPE_UNSUPPORTED`，防止非视频文件替换 source artifact。
- asset catalog guard 存在：Host、OpenAPI、HTTP/mock client、Settings Center 和 contract tests 必须共同覆盖 `GET /assets/catalog`，并证明 `AssetCatalog` 只返回 `assets://...` 逻辑引用和 `<server-local-path>` 脱敏占位，不泄漏 server-local 绝对路径。
- task event recovery hint guard 存在：Host、OpenAPI、frontend type、Workbench、Queue 和 contract tests 必须共同覆盖 `VideoCutProgressEvent.metadata.recoveryHint`；失败恢复建议只能包含安全 code/action/label/message/retryable/targetStage 元数据，不得泄漏 secret、token、Authorization header、provider raw payload、FFmpeg raw stderr 或 server-local 绝对路径。
- diagnostics support bundle consent guard 存在：Host、OpenAPI、frontend type、HTTP/mock client、Diagnostics page、Settings Center 和 contract tests 必须共同覆盖 `DiagnosticSupportBundleRequest`；`includeSourceMedia` 或 `includeTranscript` 为 true 时必须要求本次显式 consent，返回内容只能是 workspace-relative path 和 host-relative contentRef 描述符。
- JSON request rejection envelope guard 存在：Host 的 JSON 入参必须通过统一 extractor 映射为标准 `ApiErrorEnvelope`；malformed JSON、content-type 错误或 schema deserialize 错误必须返回 `REQUEST_JSON_INVALID`，不能返回框架默认 `text/plain` 响应。
- artifact metadata content-hash guard 存在：真实上传 source、analysis JSON、audio 和 plan artifact 的 `sizeBytes`/`sha256` 必须来自实际文件或序列化 JSON bytes，禁止固定 size 和 pseudo hash。
- plan update integrity guard 存在：`updateTaskPlan` 在 Host 和 mock adapter 中必须刷新 `{taskId}-plan` artifact 的 `sizeBytes`/`sha256`，防止保存后的计划文件与 artifact manifest 漂移。
- plan update validation guard 存在：`updateTaskPlan` 必须在写入前校验 `VideoSplitPlan` schema、task ownership、output spec、tracks、segments 和 time ranges；`PLAN_INVALID` 或 `PLAN_TASK_ID_MISMATCH` 不得替换当前 plan artifact。
- command runner 不使用 shell string。
- FFmpeg filter 不接受原始用户字符串。
- log redaction test 存在。

## License Checks

`check:license` 必须检查：

- npm/cargo dependencies license。
- FFmpeg build profile。
- model asset manifest。
- fonts manifest。
- BGM/SFX manifest。
- AGPL 依赖默认禁止进入核心 runtime。
- CycloneDX SBOM 生成。

## Release Flow Checks

`check:release-flow` 必须检查：

- `release-manifest.json` schema。
- `SHA256SUMS.txt`。
- `release-notes.md`。
- `sdkwork-video-cut-sbom.cdx.json` CycloneDX SBOM。
- smoke reports。
- quality report。
- values.release.yaml 固定 image tag/digest。
- release manifest 包含 API/schema/provider/runtime profile version。
- release manifest runtime profile must be loaded from `deploy/runtime-profiles.yaml`, not from an inline release-script profile map.
- release smoke scripts must generate target smoke reports with `--report-path` and package them through release command `--smoke-report` validation.
- `release-reports-use-project-relative-paths`: release reports must serialize project-relative paths only, must strip internal absolute paths from release manifest artifact records, and must reject sensitive values plus server-local absolute path leaks in smoke evidence.
- `release-smoke-requires-private-artifact-delivery-proof`: release smoke validation must require private artifact content endpoint evidence, MP4 byte-range evidence, private `no-store`/`nosniff` security headers, and browser `blob:` delivery proof for web smoke.

## SLO Checks

`check:slo` 必须检查：

- health endpoint 不是重型检查。
- capability endpoint 可缓存工具探测。
- timeout budget 覆盖 provider、probe、extract、render、artifact write。
- retry policy 只覆盖可重试错误。
- queue/backpressure 配置存在。
- graceful shutdown/drain 配置存在。

## Migration Checks

`check:migrations` 必须检查：

- manifest schema 有 version。
- 当前 manifest fixture 可读。
- old fixture 只在存在历史发布版本时要求可读。
- 数据库未启用时不得要求 `host/migrations/` 存在。
- 数据库首次启用时 baseline apply dry-run 可执行。
- 存在 migration 时，migration dry-run 可执行。
- plan revision 与 render attempt 绑定。
- prompt/schema/provider capability version 写入 diagnostics。
- SQLite/PostgreSQL baseline schema 和后续 migration 遵守 [14-database-implementation-standard.md](./14-database-implementation-standard.md) 的命名、注释、dry-run、回填和校验要求。

## Database Contract Checks

`check:database-contracts` 必须检查：

- `DATABASE_SPEC.md` 中 DB001-DB072 的适用规则。
- `docs/database/prefix-registry.yaml` 存在且前缀不使用产品名、项目名、技术栈名。
- `docs/database/schema-registry/*.yaml` 中每张表有 profile、compliance level、owner、contract version。
- 表名、字段名、索引名、约束名符合小写下划线和模块前缀规范。
- L1+ 表包含 `id`、`created_at`、`updated_at`，核心表有 `uuid`。
- 多租户表有 `tenant_id`，多租户列表索引以 `tenant_id` 开头。
- JSON 字段有 schema，金额、状态、租户、权限、幂等等核心字段不只存在于 JSON。
- baseline schema 或后续 migration 与 schema registry 对齐；数据库启用时 SQLite/PostgreSQL dry-run 可执行。
- API/SDK/OpenAPI/JSON Schema 与数据库契约的 `int64`、时间、enum 序列化一致。
- schema drift 检测无未登记字段、索引、约束漂移。

## CI 分层

| Tier | 命令 | 触发 |
| --- | --- | --- |
| fast | typecheck、unit、architecture docs | 每次提交。 |
| standard | contracts、provider fake、security、license | PR。 |
| release | media smoke、desktop/server/container/k8s smoke、SBOM | release candidate。 |

## Governance Report

所有治理命令必须支持 JSON 输出：

```json
{
  "status": "pass",
  "command": "check:multi-mode",
  "checkedAt": "2026-04-26T00:00:00Z",
  "checks": [
    {
      "id": "canonical-api-route",
      "status": "pass",
      "evidence": "/api/video-cut/v1"
    }
  ]
}
```

报告进入：

```text
artifacts/quality/
artifacts/governance/
artifacts/release/
```
