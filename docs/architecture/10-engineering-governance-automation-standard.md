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
pnpm check:deployment-artifacts
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
pnpm check:release-contracts
pnpm verify:release-signature -- --json --release-assets-dir <dir>
pnpm release:ready -- --json
pnpm release:package:matrix
pnpm release:smoke:ready -- --json
pnpm release:smoke:preflight -- --json
pnpm release:smoke:matrix
pnpm check:release-smoke-readiness -- --json
pnpm check:release-smoke-readiness -- --json --require-ready
```

Current implementation:

- `pnpm check:governance -- --json` emits `video-cut.governance-suite.v1`.
- The report is written to `artifacts/governance/governance-suite-report.json`.
- `pnpm check:architecture-standards`, `pnpm check:runtime-boundaries`, `pnpm check:security`, `pnpm check:license`, `pnpm check:release-flow`, `pnpm check:adr`, and `pnpm check:slo` all run category-scoped slices of `scripts/check-video-cut-governance-suite.mjs`.
- `pnpm check:license` generates `artifacts/governance/sdkwork-video-cut-sbom.cdx.json` in CycloneDX 1.6 format.
- `pnpm check:contracts -- --json` emits `video-cut.openapi-contracts-report.v1`.
- The report is written to `artifacts/governance/openapi-contracts-report.json`.
- The check validates the canonical OpenAPI 3.1 `/api/video-cut/v1` surface, success/error envelopes, runtime diagnostics schemas, provider conformance schemas, source upload, render, subtitle, artifact delivery, media analysis schemas, and `.env.example` browser-runtime boundary without starting Vite/Vitest.
- `pnpm check:deployment-artifacts -- --json` emits `video-cut.deployment-artifacts-report.v1`.
- The report is written to `artifacts/governance/deployment-artifacts-report.json`.
- The check validates Tauri desktop shell delegation, explicit web favicon, Docker multi-target images, Docker Compose private Host exposure, Kubernetes private runtime service/chart templates, `.env.example` canonical `SDKWORK_VIDEO_CUT_*` variables, and `deploy/runtime-profiles.yaml` coverage without starting Vite/Vitest.
- `pnpm check:deployment-matrix -- --json` emits `video-cut.deployment-matrix.v1`.
- The report is written to `artifacts/governance/deployment-matrix-report.json`.
- The check validates the canonical `/api/video-cut/v1` route, doctor scripts, release package/smoke scripts, Docker artifacts, Kubernetes artifacts, and release command script.
- `pnpm check:smoke-evidence -- --json` emits `video-cut.smoke-evidence-contracts-report.v1`.
- The report is written to `artifacts/governance/smoke-evidence-contracts-report.json`.
- The check validates smoke runner parser/factory exports, HTTP artifact content/range/security-header proof fields, managed server private workflow evidence, managed UI private browser delivery evidence, release smoke script report binding, and release smoke validation contracts without starting Vite/Vitest. Standard local smoke report samples are optional warnings by default; explicit `--smoke-report target=path` inputs are strict.
- `pnpm check:release-contracts -- --json --release-assets-dir <dir>` emits `video-cut.release-contracts-report.v1`.
- The report is written to `artifacts/governance/release-contracts-report.json`.
- The check validates generated release package integrity: manifest, quality gate report, local action report, sealed release-root files, recursively sealed package file sets, `SHA256SUMS.txt`, `governance-evidence-bundle.json`, `smoke-evidence-bundle.json` for smoke releases, `provenance.json`, `release-signature.json`, CycloneDX SBOM, artifact hashes/sizes, governance evidence, safe project-relative paths, and redaction.
- `pnpm verify:release-signature -- --json --release-assets-dir <dir>` emits `video-cut.release-signature-verification.v1`.
- The report is written to `artifacts/governance/release-signature-verification-report.json`.
- The verifier validates packaged `release-signature.json` independently from workspace governance state by recomputing the deterministic digest from release package files only.
- `pnpm release:ready -- --json` emits `video-cut.release-ready-report.v1`.
- The report is written to `artifacts/governance/release-ready-report.json` and is the top-level commercial release train gate. It runs `createGovernanceReport({ category: 'all' })`, `createReleaseMatrixReport`, and `createReleaseSmokeReadyReport`, then fails unless governance is `pass`, all five package targets are `pass`, and smoke `readinessStatus=ready`.
- The report must expose `packageStatus`, `smokeStatus`, `promotionEligible`, `environmentStatus`, `environmentBlockers`, `remediationSummary`, nested governance/package matrix/smoke ready summaries, `release-ready-governance`, `release-ready-package-matrix`, `release-ready-smoke-ready`, `release-ready-promotion-eligible`, and `release-ready-redaction-and-path-safety`. `promotionEligible` must be true only when governance passes, packages are ready, and smoke ready is promotion eligible. `smokeStatus` must be classified through the downstream smoke ready promotion contract, so a downstream report with `readinessStatus=ready` but `promotionEligible=false` is `smokeStatus=failed`. Package matrix and smoke ready remain valid diagnostic subcommands, but CI promotion should depend on `release:ready`.
- `pnpm release:package:matrix -- --json` emits `video-cut.release-matrix-report.v1`.
- The report is written to `artifacts/governance/release-matrix-report.json`; target release assets are written under `artifacts/release-matrix/desktop`, `artifacts/release-matrix/server`, `artifacts/release-matrix/web`, `artifacts/release-matrix/container`, and `artifacts/release-matrix/kubernetes`.
- The matrix gate runs `scripts/release/run-release-with-governance.mjs package <target>` for all five targets, requires each target to pass `check:release-contracts` and `verify:release-signature`, validates target coverage and isolated release directories, summarizes manifest/provenance/signature/signature-verification/SBOM evidence, rejects credential or server-local path leaks, and records `RELEASE_MATRIX_TARGET_FAILED` instead of dropping the final report if one target command throws.
- `pnpm release:smoke:ready -- --json` emits `video-cut.release-smoke-ready-report.v1`.
- The ready gate is the commercial smoke promotion command. It writes `artifacts/governance/release-smoke-ready-report.json`, runs `createReleaseSmokePreflightReport`, runs `createReleaseSmokeMatrixReport` with the same preflight evidence, then runs `createReleaseSmokeReadinessReport` with `requireReady=true`.
- The command must expose `requireReady`, `readinessStatus`, `promotionEligible`, `environmentStatus`, `environmentBlockers`, `remediationSummary`, nested preflight/matrix/readiness summaries, `release-smoke-ready-preflight`, `release-smoke-ready-matrix`, `release-smoke-ready-readiness-required`, `release-smoke-ready-promotion-eligible`, and `release-smoke-ready-redaction-and-path-safety`. It must fail unless `readinessStatus=ready`, while still preserving `promotionEligible=false`, blocked environment evidence through `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED`, and safe `RELEASE_SMOKE_READY_FAILED` records.
- `pnpm release:smoke:preflight -- --json` emits `video-cut.release-smoke-preflight-report.v1`.
- The report is written to `artifacts/governance/release-smoke-preflight-report.json` and classifies the real smoke environment as `environmentStatus=ready` or `environmentStatus=blocked`.
- The preflight gate verifies FFmpeg spawn, Cargo spawn, Host Cargo manifest presence, Vite binary presence, Chromium-compatible browser executable availability, loopback port allocation, writable release/smoke/runtime directories, and report redaction/path safety before the real release smoke matrix mutates runtime state. Blocked preflight reports must expose machine-readable `environmentBlockers[]` with `id`, `code`, `category`, and sanitized `evidence`, plus a safe `runnerConfig` snapshot and `remediationActions[]` containing `id`, `code`, `category`, `envVar`, `commandHint`, and `action`.
- `check:release-smoke-readiness`, `release:smoke:ready`, and `release:ready` must expose a top-level `remediationSummary` derived from preflight `remediationActions[]` or propagated `environmentBlockers[]`, preserving only safe `id`, `code`, `category`, `envVar`, `commandHint`, and `action` fields, deduplicating repeated entries, and avoiding local absolute paths or credential-shaped values so CI dashboards can show repair guidance without opening nested reports.
- `release:ready`, `release:smoke:ready`, `release:smoke:matrix`, and `release:smoke:preflight` must share and propagate the same preflight runner overrides: `--ffmpeg-path`, `--cargo-path`, `--chrome-executable-path`, `--bind-host`, and `--timeout-ms`. Defaults may come from `SDKWORK_VIDEO_CUT_FFMPEG_PATH`, `SDKWORK_VIDEO_CUT_CARGO_PATH`, `SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH`, and `SDKWORK_VIDEO_CUT_BIND_HOST`, but top-level gates must pass explicit CLI values through to `createReleaseSmokePreflightReport` unchanged.
- `pnpm release:smoke:matrix -- --json` emits `video-cut.release-smoke-matrix-report.v1`.
- The report is written to `artifacts/governance/release-smoke-matrix-report.json`; target smoke reports are written under `artifacts/release-smoke-matrix/smoke`, and target smoke release packages are written under `artifacts/release-smoke-matrix/desktop`, `artifacts/release-smoke-matrix/server`, `artifacts/release-smoke-matrix/web`, `artifacts/release-smoke-matrix/container`, and `artifacts/release-smoke-matrix/kubernetes`.
- The smoke matrix gate first calls `createReleaseSmokePreflightReport`; only `environmentStatus=ready` allows the real target smoke runners to execute. When preflight is blocked, the matrix writes target records with `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED` and carries the preflight `environmentBlockers[]` into the matrix and target records so environment gaps are not misclassified as product regressions. When preflight passes, it validates each generated smoke report through strict `check:smoke-evidence -- --smoke-report target=path` semantics, packages each passing smoke report through `scripts/release/run-release-with-governance.mjs smoke <target>`, requires release contracts and `verify:release-signature` to pass for packaged smoke evidence, validates target coverage and isolated smoke reports, rejects credential or server-local path leaks, and records `RELEASE_SMOKE_MATRIX_TARGET_FAILED` instead of dropping the final report if one target smoke command throws.
- `pnpm check:release-smoke-readiness -- --json` emits `video-cut.release-smoke-readiness-report.v1`.
- The report is written to `artifacts/governance/release-smoke-readiness-report.json` and validates existing `release-smoke-preflight-report.json` plus `release-smoke-matrix-report.json` without rerunning Host, Vite, browser, FFmpeg, or Cargo workflows.
- The check must classify smoke evidence as `readinessStatus=ready` only when preflight is ready, the matrix passes, all five targets pass, and blockers are empty; classify as `readinessStatus=blocked` only when preflight and matrix are blocked, every target is blocked with `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED`, and standard `environmentBlockers[]` propagate from preflight into the matrix and target records; otherwise classify as `readinessStatus=failed`. The report must include top-level `promotionEligible` and `remediationSummary` in default classification mode and in `--require-ready` mode; `promotionEligible` must be true only for `readinessStatus=ready`.
- `pnpm check:release-smoke-readiness -- --json --require-ready` is the lower-level commercial readiness assertion used by `release:smoke:ready`. The report must set `requireReady=true`, include `release-smoke-readiness-ready-required` and `release-smoke-readiness-promotion-eligible`, and fail unless `readinessStatus=ready`; blocked evidence remains valid diagnostic governance evidence but is not deliverable.
- Default governance-family JSON report fields must serialize project-relative paths for project-local artifacts: `artifacts/governance/governance-suite-report.json`, `artifacts/governance/feature-readiness-report.json`, `artifacts/governance/feature-readiness-policy-report.json`, `artifacts/governance/deployment-artifacts-report.json`, `artifacts/governance/openapi-contracts-report.json`, `artifacts/governance/smoke-evidence-contracts-report.json`, `artifacts/governance/deployment-matrix-report.json`, and `artifacts/governance/database-contracts-report.json`.
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
- `/api/local/v1` is forbidden in Host routing, frontend clients, deployment assets, OpenAPI, and architecture contracts.
- Host runtime fails fast on legacy `VIDEO_CUT_*` environment variables and accepts only `SDKWORK_VIDEO_CUT_*` runtime configuration.
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

`check:contracts` must be a pure Node governance command. It must not depend on Vitest/Vite startup. It must expose `parseOpenApiContractsArgs` and `createOpenApiContractsReport`, write `video-cut.openapi-contracts-report.v1`, and fail if the OpenAPI route surface, schema envelopes, diagnostics/provider/render/artifact/media schemas, or browser runtime environment template drift from the public API architecture.

`check:deployment-artifacts` must be a pure Node governance command. It must not depend on Vitest/Vite startup. It must expose `parseDeploymentArtifactsArgs` and `createDeploymentArtifactsReport`, write `video-cut.deployment-artifacts-report.v1`, and fail if Tauri, Docker, Kubernetes, `.env.example`, web favicon, or runtime profile artifacts drift from the deployment architecture.

`check:smoke-evidence` must be a pure Node governance command. It must not depend on Vitest/Vite startup. It must expose `parseSmokeEvidenceContractsArgs` and `createSmokeEvidenceContractsReport`, write `video-cut.smoke-evidence-contracts-report.v1`, and fail if HTTP workflow smoke, managed server smoke, managed UI smoke, release smoke scripts, release smoke validators, private artifact delivery proof, report redaction, or safe path checks drift from the release evidence architecture.

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
- browser child process env sanitizer guard: browser-facing Vite/Tauri smoke/dev child processes must use `scripts/lib/safe-env.mjs` and strip every `VITE_*`, `SDKWORK_VIDEO_CUT_*`, and legacy `VIDEO_CUT_*` key before launching frontend runtimes.
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
- `release-packages-require-governance-evidence`: package and smoke scripts must run through `scripts/release/run-release-with-governance.mjs`; release packaging must read the standard governance JSON reports for CLI contracts, database contracts, deployment artifacts, deployment matrix, OpenAPI contracts, smoke evidence contracts, feature readiness, feature readiness policy, and the governance suite; `pnpm check:feature-readiness-policy -- --json` must produce `video-cut.feature-readiness-policy-report.v1` at `artifacts/governance/feature-readiness-policy-report.json` before packaging. These reports must be status `pass`, have expected versions and project-relative `reportPath` values, contain no failures, no feature readiness gaps or blocking failures, no credential-shaped data, and no server-local absolute path leaks. The reports must be attached to the release manifest and quality gate report with SHA-256 evidence, including `governance-evidence-deployment-artifacts`, `governance-evidence-openapi-contracts`, `governance-evidence-smoke-evidence-contracts`, and `governance-evidence-feature-readiness-policy`, and the wrapper must call `createReleaseContractsReport` after artifact generation so `RELEASE_CONTRACTS_FAILED` blocks non-conforming packages.
- `release-packages-require-governance-evidence`: the release command must also write `governance-evidence-bundle.json` with `bundleVersion=video-cut.governance-evidence-bundle.v1`; the bundle must embed the nine standard governance reports and their status, summary, SHA-256, and size evidence so the release directory is self-auditable without reading mutable workspace report files.
- `release-packages-require-governance-evidence`: the release command must snapshot every project-relative manifest artifact into the release assets directory at the same relative path, including governance reports, target deployment files, and smoke reports; `check:release-contracts` must validate packaged evidence snapshots first so later workspace report regeneration cannot invalidate an already sealed release package.
- `release-packages-require-governance-evidence`: smoke release packages must also write `smoke-evidence-bundle.json` with `bundleVersion=video-cut.smoke-evidence-bundle.v1`; the bundle must embed the validated smoke report, its project-relative path, report version, summary, SHA-256, size evidence, and target-specific private delivery proof through `createSmokeEvidenceBundle` and `createSmokeEvidenceSummary`.
- `release-packages-require-governance-evidence`: every release package must also write `provenance.json` with `provenanceVersion=video-cut.release-provenance.v1`; `createReleaseProvenance` must record package metadata, build environment, optional git digest, final action-report hash/size proof, standard artifact hash/size proof including `release-notes.md`, and `artifactManifestSha256` for the manifest subject excluding `provenance.json` and `release-signature.json`.
- `release-packages-require-governance-evidence`: every release package must also write `release-signature.json` with `signatureVersion=video-cut.release-signature.v1`; `createReleaseSignature` must emit a `local-deterministic-digest` over the manifest subject, `SHA256SUMS` subject, provenance, release notes, quality gate report, and action report, while excluding `release-signature.json` from self-referential signature subjects.
- `release-packages-require-governance-evidence`: the release wrapper must call `createReleaseSignatureVerificationReport` after `createReleaseContractsReport`; `RELEASE_SIGNATURE_VERIFICATION_FAILED` must block generated packages when `video-cut.release-signature-verification.v1` does not pass, and release reports must include `signatureVerification: toSignatureVerificationEvidence` for deployment pipelines.
- `release-packages-require-governance-evidence`: `release:ready` must point to `scripts/release/run-release-ready.mjs`; `createReleaseReadyReport` must produce `video-cut.release-ready-report.v1`, write `release-ready-report.json`, call `createGovernanceReport`, `createReleaseMatrixReport`, and `createReleaseSmokeReadyReport`, expose `packageStatus`, promotion-safe `smokeStatus`, `promotionEligible`, `environmentStatus`, `environmentBlockers`, and `remediationSummary`, parse and pass through `ffmpegPath`, `cargoPath`, `chromeExecutablePath`, `bindHost`, and `timeoutMs` to the smoke ready gate, classify downstream smoke reports through `classifySmokeStatus`, validate `release-ready-governance`, `release-ready-package-matrix`, `release-ready-smoke-ready`, `release-ready-promotion-eligible`, and `release-ready-redaction-and-path-safety`, fail with `RELEASE_READY_FAILED` when the orchestrator cannot emit safe evidence, and fail commercial release promotion unless governance, package matrix, and smoke ready all pass.
- `release-packages-require-governance-evidence`: `release:package:matrix` must point to `scripts/release/run-release-matrix.mjs`; `createReleaseMatrixReport` must produce `video-cut.release-matrix-report.v1`, use `MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes']`, create isolated target release directories under `artifacts/release-matrix`, require each target's governed package, release contracts, and `verify:release-signature` result to pass, include `release-matrix-target-coverage`, `release-matrix-isolated-assets`, `release-matrix-redaction-and-path-safety`, and record `RELEASE_MATRIX_TARGET_FAILED` for thrown target package commands.
- `release-packages-require-governance-evidence`: `release:smoke:preflight` must point to `scripts/release/check-release-smoke-preflight.mjs`; `createReleaseSmokePreflightReport` must produce `video-cut.release-smoke-preflight-report.v1`, write `release-smoke-preflight-report.json`, expose `environmentStatus`, `environmentBlockers`, `runnerConfig`, and `remediationActions`, verify `release-smoke-preflight-ffmpeg-spawn`, `release-smoke-preflight-cargo-spawn`, `release-smoke-preflight-host-cargo-manifest`, `release-smoke-preflight-vite-bin`, `release-smoke-preflight-browser-executable`, `release-smoke-preflight-local-ports`, `release-smoke-preflight-writable-directories`, and `release-smoke-preflight-redaction-and-path-safety`, classify blockers with `RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED`, `RELEASE_SMOKE_ENV_BROWSER_UNAVAILABLE`, `RELEASE_SMOKE_ENV_PORTS_UNAVAILABLE`, `RELEASE_SMOKE_ENV_WORKSPACE_UNWRITABLE`, `RELEASE_SMOKE_ENV_REQUIRED_FILE_MISSING`, or `RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED`, and fail with `RELEASE_SMOKE_PREFLIGHT_FAILED` when the preflight command cannot emit safe evidence.
- `release-packages-require-governance-evidence`: `release:smoke:matrix` must point to `scripts/release/run-release-smoke-matrix.mjs`; `createReleaseSmokeMatrixReport` must produce `video-cut.release-smoke-matrix-report.v1`, call `createReleaseSmokePreflightReport` through an injectable `preflightImpl`, pass through `ffmpegPath`, `cargoPath`, `chromeExecutablePath`, `bindHost`, and `timeoutMs`, use `MATRIX_TARGETS = ['desktop', 'server', 'web', 'container', 'kubernetes']`, create isolated target smoke report paths under `artifacts/release-smoke-matrix/smoke`, run the real HTTP/managed-server/managed-UI smoke runners only after preflight is ready, validate each target through strict `createSmokeEvidenceContractsReport`, package each passing smoke report through `createReleaseWithGovernanceReport` with `action=smoke`, include `release-smoke-matrix-preflight`, `release-smoke-matrix-target-coverage`, `release-smoke-matrix-isolated-smoke-reports`, `release-smoke-matrix-redaction-and-path-safety`, propagate preflight `environmentBlockers` into matrix and blocked target evidence, record `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED` when the environment is blocked, and record `RELEASE_SMOKE_MATRIX_TARGET_FAILED` for thrown target smoke commands.
- `release-packages-require-governance-evidence`: `check:release-smoke-readiness` must point to `scripts/check-video-cut-release-smoke-readiness.mjs`; `createReleaseSmokeReadinessReport` must produce `video-cut.release-smoke-readiness-report.v1`, write `release-smoke-readiness-report.json`, expose `requireReady`, `readinessStatus`, `promotionEligible`, `environmentStatus`, `environmentBlockers`, and `remediationSummary`, validate `release-smoke-readiness-preflight-report-contract`, `release-smoke-readiness-matrix-report-contract`, `release-smoke-readiness-classification-contract`, `release-smoke-readiness-ready-required`, `release-smoke-readiness-promotion-eligible`, `release-smoke-readiness-environment-blockers`, `release-smoke-readiness-target-coverage`, and `release-smoke-readiness-redaction-and-path-safety`, classify only ready/pass or blocked-with-standard-blockers as pass-worthy governance evidence in default mode, and fail `--require-ready` commercial release promotion unless `readinessStatus=ready`.
- `release-packages-require-governance-evidence`: `release:smoke:ready` must point to `scripts/release/run-release-smoke-ready.mjs`; `createReleaseSmokeReadyReport` must produce `video-cut.release-smoke-ready-report.v1`, write `release-smoke-ready-report.json`, call `createReleaseSmokePreflightReport`, `createReleaseSmokeMatrixReport`, and `createReleaseSmokeReadinessReport`, pass `ffmpegPath`, `cargoPath`, `chromeExecutablePath`, `bindHost`, and `timeoutMs` into preflight and matrix, pass `requireReady=true`, expose `requireReady`, `readinessStatus`, `promotionEligible`, `environmentStatus`, `environmentBlockers`, and `remediationSummary`, validate `release-smoke-ready-preflight`, `release-smoke-ready-matrix`, `release-smoke-ready-readiness-required`, `release-smoke-ready-promotion-eligible`, and `release-smoke-ready-redaction-and-path-safety`, preserve `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED` blocked-target evidence, fail with `RELEASE_SMOKE_READY_FAILED` when the orchestrator cannot emit safe evidence, and fail commercial smoke promotion unless `readinessStatus=ready`.
- `release-contracts-command-present`: `check:release-contracts` must point to `scripts/check-video-cut-release-contracts.mjs`; the script must validate release manifest, release notes, quality gate report, local action report, sealed release-root files through `release-root-generated-files-sealed`, recursively sealed package file sets through `release-package-file-set-sealed`, `SHA256SUMS.txt`, `governance-evidence-bundle.json`, smoke evidence bundles through `checkSmokeEvidenceBundle`, `provenance.json` through `release-provenance-contract`, `release-signature.json` through `release-signature-contract`, CycloneDX SBOM, artifact integrity, governance evidence, credential redaction, and server-local path redaction before a generated package is considered deliverable.
- `release-signature-verifier-command-present`: `verify:release-signature` must point to `scripts/verify-video-cut-release-signature.mjs`; the script must expose `parseReleaseSignatureVerificationArgs` and `createReleaseSignatureVerificationReport`, write `video-cut.release-signature-verification.v1`, validate `release-signature-standard-files-present`, `release-signature-digest-valid`, and `release-signature-verification-redaction-and-path-safety`, and use only packaged release files as signature subjects.
- `openapi-contracts-command-present`: `check:contracts` must point to `scripts/check-video-cut-openapi-contracts.mjs`; the script must expose `parseOpenApiContractsArgs` and `createOpenApiContractsReport`, write `video-cut.openapi-contracts-report.v1`, and validate `canonical-openapi-v1-surface`, `standard-success-error-envelopes`, `multipart-source-file-upload`, `binary-artifact-content-serving`, and `runtime-env-template-no-vite-host-config` without Vitest/Vite runtime dependencies.
- `smoke-evidence-contracts-command-present`: `check:smoke-evidence` must point to `scripts/check-video-cut-smoke-evidence-contracts.mjs`; the script must expose `parseSmokeEvidenceContractsArgs` and `createSmokeEvidenceContractsReport`, write `video-cut.smoke-evidence-contracts-report.v1`, and validate `http-workflow-smoke-contract`, `managed-server-smoke-contract`, `managed-ui-smoke-contract`, `release-smoke-scripts-contract`, and `release-smoke-validation-contract` without Vitest/Vite runtime dependencies.
- `deployment-artifacts-command-present`: `check:deployment-artifacts` must point to `scripts/check-video-cut-deployment-artifacts.mjs`; the script must expose `parseDeploymentArtifactsArgs` and `createDeploymentArtifactsReport`, write `video-cut.deployment-artifacts-report.v1`, and validate `tauri-desktop-shell-contract`, `dockerfile-multi-target-contract`, `docker-compose-private-runtime-contract`, `kubernetes-chart-private-runtime-contract`, and `runtime-profiles-contract` without Vitest/Vite runtime dependencies.
- `release-contracts-command-present`: package root directories must contain only standard release files, the exact current action report, and root-level artifacts explicitly listed in `release-manifest.json`; stale smoke evidence, old target reports, debug notes, and other unmanifested root files must fail `release-root-generated-files-sealed`.
- `release-contracts-command-present`: package directories must contain no unmanifested nested files; stale `smoke/*-smoke-report.json`, stale generated reports, and any unlisted files under release snapshot directories must fail `release-package-file-set-sealed`.
- `release-contracts-command-present`: smoke package validation must include `release-smoke-evidence-bundle-contract`; it must reject missing, stale, non-pass, or redaction-unsafe `smoke-evidence-bundle.json` files and must verify embedded report content with `validateSmokeEvidenceBundle` and `validateSmokeEvidenceSummary`.
- `release-contracts-command-present`: provenance validation must include `release-provenance-contract`; it must reject missing, stale, mismatched, non-manifested, or redaction-unsafe `provenance.json` files and must recompute the manifest subject digest from package artifacts, including `release-notes.md`, instead of trusting mutable workspace state.
- `release-contracts-command-present`: signature validation must include `release-signature-contract`; it must reject missing, stale, mismatched, non-manifested, or redaction-unsafe `release-signature.json` files and must recompute the deterministic digest over the signed subjects, including `release-notes.md`.
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
