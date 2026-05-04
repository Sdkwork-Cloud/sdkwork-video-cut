# 06 Quality Security Observability Release Standards

日期：2026-04-26

## 目标

本标准定义质量门禁、安全、观测、License、供应链和发布。不同部署模式必须通过各自 smoke，同时保持同一产品契约。

## Quality Gates

```bash
pnpm run typecheck
pnpm run test
pnpm run check:contracts
pnpm run check:architecture-standards
pnpm run check:runtime-boundaries
pnpm run check:license
pnpm run deployment:doctor
cargo test --manifest-path host/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run test:media-smoke
pnpm run release:smoke:desktop
pnpm run release:smoke:server
pnpm run release:smoke:container
pnpm run release:smoke:kubernetes
pnpm run release:ready -- --json
pnpm run release:smoke:preflight -- --json
pnpm run release:smoke:ready -- --json
pnpm run release:smoke:web
```

测试类型：

- unit
- port conformance
- contract
- provider mock
- media golden
- command safety
- recovery
- deployment smoke

## Security

必须实现：

- 上传文件白名单、大小限制、时长限制。
- path traversal 防护。
- workspace root guard。
- OpenAI-compatible baseUrl SSRF 防护。
- API key/token 脱敏。
- server 模式显式 CORS。
- `single-user-token` 或 `reverse-proxy` 鉴权。
- 外部命令只能通过 `CommandRunnerPort`。
- 不允许用户直接传任意 FFmpeg filter。

禁止：

- 前端 localStorage 保存 API key。
- server 模式默认无鉴权暴露到 `0.0.0.0`。
- artifact/log 泄漏 API key、Authorization header、完整 prompt。

## Observability

标准字段：

- `taskId`
- `projectId`
- `stageId`
- `renderId`
- `providerId`
- `adapterKind`
- `deploymentMode`
- `qualityTier`
- `traceId`

模式：

- desktop-local：本地 JSONL 日志。
- server/container/k8s：stdout JSON logs。
- 可选：OpenTelemetry OTLP exporter。

每个 provider invocation 必须形成 span。FFmpeg 执行必须记录命令摘要、参数 hash、退出码、耗时和日志路径。

## License And SBOM

License 策略：

| License | 默认策略 |
| --- | --- |
| MIT/Apache-2.0/BSD/ISC | 允许，进入 SBOM。 |
| LGPL | 可用，记录链接和分发方式。 |
| GPL | 默认不进核心 runtime；FFmpeg GPL profile 必须显式标记。 |
| AGPL | 默认禁止进入核心链路。 |
| 商业/模型 License | 必须记录来源、用途、再分发权限。 |

Release 必须产出：

- CycloneDX SBOM。
- Rust crate/npm package/system tool 清单。
- FFmpeg build profile。
- model-card 或模型 manifest。
- 字体、BGM、SFX license manifest。

## Release Families

- desktop：Tauri 安装包、host binary、desktop smoke。
- server：Rust host binary、web assets、service 样例。
- container：Dockerfile、compose、image tag/digest、container smoke。
- kubernetes：Helm chart、values.release.yaml、helm smoke。
- web：静态 web bundle、runtime config 样例、bundle report。

每次 release 必须产出：

- `release-manifest.json`
- `SHA256SUMS.txt`
- `release-notes.md`
- `quality-gate-execution-report.json`
- smoke report

MVP local release command has implemented these standard artifacts for `desktop`, `server`, `web`, `container`, and `kubernetes` targets. `package` and `smoke` actions write:

- `{target}-{action}-report.json`
- `release-manifest.json`
- `SHA256SUMS.txt`
- `release-notes.md`
- `quality-gate-execution-report.json`
- `governance-evidence-bundle.json`
- `sdkwork-video-cut-sbom.cdx.json`
- `provenance.json`
- `release-signature.json`
- `smoke-evidence-bundle.json` for `smoke` actions

The command is intentionally local and deterministic. It records required file presence and SHA-256 evidence; image build, Helm rendering, and binary signing can be attached as stricter CI gates without changing the report contract.

Release packaging must consume the governance evidence that was produced before packaging. The package and smoke scripts must go through `scripts/release/run-release-with-governance.mjs`, which first regenerates the standard Node governance reports and then invokes the local release command. `release-manifest.json` and `quality-gate-execution-report.json` must include the project-relative paths and checksums for `artifacts/governance/cli-contracts-report.json`, `database-contracts-report.json`, `deployment-artifacts-report.json`, `deployment-matrix-report.json`, `openapi-contracts-report.json`, `smoke-evidence-contracts-report.json`, `feature-readiness-report.json`, `feature-readiness-policy-report.json`, and `governance-suite-report.json`. The feature readiness policy report must be produced by `pnpm check:feature-readiness-policy -- --json` with `reportVersion=video-cut.feature-readiness-policy-report.v1`. The release command must fail when any required governance report is missing, has an unsupported `reportVersion`, reports a non-pass status, contains failing checks, contains feature readiness gaps or blocking failures, serializes an unexpected `reportPath`, contains credential-shaped data, or leaks a server-local absolute path.

Every generated release package must also pass `pnpm check:release-contracts -- --json --release-assets-dir <dir>` before it can be treated as deliverable. The release wrapper must call `createReleaseContractsReport` immediately after writing package artifacts and fail the package/smoke command when `video-cut.release-contracts-report.v1` is not `pass`. The gate emits `video-cut.release-contracts-report.v1` to `artifacts/governance/release-contracts-report.json` and validates the release package as a sealed artifact: required standard files are present, the release root contains only standard files, the current action report, and root-level files explicitly listed in `release-manifest.json`, every file anywhere under the release directory is either a standard file, the current action report, or listed in `release-manifest.json`, the manifest, quality gate report, local action report, runtime profile, and contract versions agree, every manifest artifact has a safe project-relative path with matching SHA-256 and size evidence, `release-notes.md` is listed in the manifest and sealed by `SHA256SUMS.txt`, `provenance.json`, and `release-signature.json`, `SHA256SUMS.txt` exactly matches manifest artifact order, `provenance.json` and `release-signature.json` are valid, the CycloneDX SBOM is valid, governance evidence checks are present and passing, smoke evidence bundles are present only for smoke releases, and release JSON contains no credential-shaped data or server-local absolute path leaks.

Generated release packages must then pass the independent packaged-signature verifier before delivery. `pnpm verify:release-signature -- --json --release-assets-dir <dir>` emits `video-cut.release-signature-verification.v1` to `artifacts/governance/release-signature-verification-report.json` and recomputes the deterministic `release-signature.json` digest using only files inside the release assets directory: `release-manifest.json`, `SHA256SUMS.txt`, `provenance.json`, `release-notes.md`, `quality-gate-execution-report.json`, and the current `{target}-{action}-report.json`. The release wrapper must call `createReleaseSignatureVerificationReport` after `check:release-contracts` and fail with `RELEASE_SIGNATURE_VERIFICATION_FAILED` if the packaged signature cannot be verified independently of mutable workspace governance files.

Commercial release trains must use `pnpm release:ready -- --json` before delivery. The command writes `video-cut.release-ready-report.v1` to `artifacts/governance/release-ready-report.json`, runs the full governance suite, runs the governed package matrix, runs the commercial smoke ready gate, and fails unless governance is `pass`, all five package targets are `pass`, and smoke `readinessStatus=ready`. The report must expose `packageStatus`, `smokeStatus`, `promotionEligible`, `environmentStatus`, `environmentBlockers[]`, `remediationSummary`, nested governance/package matrix/smoke ready evidence, `release-ready-governance`, `release-ready-package-matrix`, `release-ready-smoke-ready`, `release-ready-promotion-eligible`, and `release-ready-redaction-and-path-safety`. `promotionEligible` must be `true` only when governance passes, the package matrix is ready, and the smoke ready report is itself promotion eligible; blocked or failed reports must preserve `promotionEligible=false`. `smokeStatus` is a promotion-safe aggregate status: it may be `ready` only when downstream smoke ready reports `status=pass`, `requireReady=true`, `readinessStatus=ready`, `promotionEligible=true`, and a passing `release-smoke-ready-promotion-eligible` check; any downstream report that is `ready` but not promotion eligible must be classified as `smokeStatus=failed`, not `ready`. `pnpm release:package:matrix -- --json` remains the package subgate: it runs the governed package flow for `desktop`, `server`, `web`, `container`, and `kubernetes` into isolated directories under `artifacts/release-matrix/<target>`, requires every target package to pass `check:release-contracts` and `verify:release-signature`, and writes `video-cut.release-matrix-report.v1` to `artifacts/governance/release-matrix-report.json`.

Commercial smoke release trains must use `pnpm release:smoke:ready -- --json` as the single promotion gate. The command writes `video-cut.release-smoke-ready-report.v1` to `artifacts/governance/release-smoke-ready-report.json`, runs release smoke preflight, runs the smoke matrix with the same preflight evidence, then runs readiness classification with `requireReady=true`. It must fail unless `readinessStatus=ready`, and it must still preserve a safe failed report with `promotionEligible=false`, `environmentStatus`, `environmentBlockers[]`, `remediationSummary`, preflight evidence, matrix evidence, readiness evidence, `release-smoke-ready-readiness-required`, `release-smoke-ready-promotion-eligible`, and `release-smoke-ready-redaction-and-path-safety` when the runner is blocked or unsafe. `promotionEligible` must be `true` only when nested readiness reports `status=pass`, `requireReady=true`, `readinessStatus=ready`, and `promotionEligible=true`.

The underlying dedicated preflight remains the first stage of the ready gate. `pnpm release:smoke:preflight -- --json` writes `video-cut.release-smoke-preflight-report.v1` to `artifacts/governance/release-smoke-preflight-report.json` and must prove FFmpeg spawn, Cargo spawn, Host Cargo manifest presence, Vite binary presence, Chromium-compatible browser executable availability, loopback port allocation, writable release/smoke/runtime directories, and report redaction/path safety. The report must expose `environmentStatus=ready` before `release:smoke:matrix` can execute real smoke targets; `environmentStatus=blocked` is a release environment blocker, not a product regression. Blocked preflight reports must include machine-readable `environmentBlockers[]` entries with `id`, `code`, `category`, and sanitized `evidence`; standard blocker codes include `RELEASE_SMOKE_ENV_TOOL_SPAWN_BLOCKED`, `RELEASE_SMOKE_ENV_BROWSER_UNAVAILABLE`, `RELEASE_SMOKE_ENV_PORTS_UNAVAILABLE`, `RELEASE_SMOKE_ENV_WORKSPACE_UNWRITABLE`, `RELEASE_SMOKE_ENV_REQUIRED_FILE_MISSING`, and `RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED`. The same report must expose a safe `runnerConfig` snapshot and `remediationActions[]` with `id`, `code`, `category`, `envVar`, `commandHint`, and `action` so CI operators can repair blocked runners without reading raw logs. These fields must be redacted by the standard report safety helper and must not contain local absolute paths or credential-shaped values.

Smoke readiness, smoke ready, and release ready reports must summarize preflight remediation through `remediationSummary.total` and `remediationSummary.actions[]`. Each action must preserve only safe `id`, `code`, `category`, `envVar`, `commandHint`, and `action` fields, deduplicate repeated preflight/matrix/readiness entries, and omit raw runner paths, credentials, or ad hoc debug fields. CI dashboards should be able to show this summary directly from whichever top-level report they ingest without parsing nested preflight reports.

`release:ready`, `release:smoke:ready`, `release:smoke:matrix`, and `release:smoke:preflight` must accept the same real-runner preflight overrides: `--ffmpeg-path`, `--cargo-path`, `--chrome-executable-path`, `--bind-host`, and `--timeout-ms`. The top-level gates must pass these values through to preflight unchanged so CI runners with pinned tool locations, isolated Chrome installs, custom loopback bindings, or longer cold-start budgets can be validated without wrapper scripts or PATH mutation. Environment variables `SDKWORK_VIDEO_CUT_FFMPEG_PATH`, `SDKWORK_VIDEO_CUT_CARGO_PATH`, `SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH`, and `SDKWORK_VIDEO_CUT_BIND_HOST` remain the default source when CLI flags are omitted.

`release:smoke:matrix` must call `createReleaseSmokePreflightReport` before target smoke execution. When preflight is blocked, the matrix writes `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED` target evidence, copies the preflight `environmentBlockers[]` into the matrix report and each blocked target record, and exits with a safe failed report without starting Host, Vite, browser, or FFmpeg smoke workflows. When preflight is ready, the matrix runs the five real target smoke commands, validates strict smoke evidence, packages each passing smoke report with governed release evidence, and remains non-deliverable until `video-cut.release-smoke-matrix-report.v1` is `pass`.

`pnpm check:release-smoke-readiness -- --json` must validate the emitted preflight and matrix reports without rerunning Host, Vite, browser, FFmpeg, or Cargo workflows. It writes `video-cut.release-smoke-readiness-report.v1` to `artifacts/governance/release-smoke-readiness-report.json` and classifies reports as `readinessStatus=ready`, `readinessStatus=blocked`, or `readinessStatus=failed`. `ready` requires a passing preflight, a passing smoke matrix, all five target smoke records passing, and no environment blockers. `blocked` requires failed/blocked preflight and matrix reports, a non-empty standard `environmentBlockers[]`, inherited blockers on every blocked target record, `targetSummary.blocked=5`, and `RELEASE_SMOKE_MATRIX_PREFLIGHT_BLOCKED` on every target. The report must expose `promotionEligible=true` only when `readinessStatus=ready`; blocked diagnostic reports may have `status=pass` in default classification mode, but must still expose `promotionEligible=false` and `release-smoke-readiness-promotion-eligible` evidence so CI dashboards cannot confuse valid blocked diagnostics with commercial promotion. The report must expose top-level `remediationSummary` in both default classification mode and `--require-ready` mode, so release dashboards can show safe repair actions without reading nested reports. `failed` means the reports are missing, unsafe, structurally invalid, or represent product smoke failure rather than an environment blocker. Classification mode may pass with `blocked` evidence so constrained runners can preserve actionable diagnostics, but commercial release promotion must run `pnpm check:release-smoke-readiness -- --json --require-ready`; that report must set `requireReady=true`, include `release-smoke-readiness-ready-required`, and fail unless `readinessStatus=ready`.

Release packages must be self-auditable. The release command must write `governance-evidence-bundle.json` with `bundleVersion=video-cut.governance-evidence-bundle.v1` into the release assets directory. The bundle must embed the standard CLI, database, deployment artifacts, deployment matrix, OpenAPI, smoke evidence, feature readiness, feature readiness policy, and governance suite reports, plus each report's expected command, report version, project-relative report path, summary, status, SHA-256, and byte size. The embedded feature readiness policy evidence must include `check:feature-readiness-policy` and `video-cut.feature-readiness-policy-report.v1`. `release-manifest.json` and `SHA256SUMS.txt` must include this bundle, and `check:release-contracts` must fail if the bundle is missing, stale, incomplete, non-pass, or contains credential-shaped data or server-local absolute path leaks.

Release package root directories must be sealed. `check:release-contracts` must include `release-root-generated-files-sealed` and fail when a root file is not one of the standard release files, the exact `{target}-{action}-report.json` for the manifest, or a root-level artifact explicitly listed in `release-manifest.json`. Package actions must fail if stale `smoke-evidence-bundle.json` remains at the release root, and all unmanifested debug notes, stale reports, or ad hoc files must be removed before delivery.

Release package file sets must be sealed recursively. `check:release-contracts` must include `release-package-file-set-sealed` and fail when any file under nested directories such as `smoke/`, `deploy/`, `dist/`, `host/`, `docs/`, or `artifacts/` is present without a corresponding `release-manifest.json` artifact record. The local release command must recursively remove generated stale release reports and stale smoke reports before writing a new package, while preserving the current smoke report path passed through `--smoke-report`.

Smoke release packages must also be self-auditable. For every `action=smoke` package, the release command must write `smoke-evidence-bundle.json` with `bundleVersion=video-cut.smoke-evidence-bundle.v1` into the release assets directory. The bundle must embed the full validated smoke report, the project-relative `smokeReportPath`, report version, `ok`, deployment mode, summary, SHA-256, byte size, and a target-specific evidence summary for private artifact delivery. `check:release-contracts` must fail smoke packages when the bundle is missing from the manifest, stale against the source smoke report, missing the embedded report, missing HTTP content/range/security-header proof, missing managed-server workflow proof, missing web browser `blob:` delivery proof, or containing credential-shaped data or server-local absolute path leaks.

Release packages must carry deterministic provenance. The release command must write `provenance.json` with `provenanceVersion=video-cut.release-provenance.v1` into the release assets directory and include it in `release-manifest.json` and `SHA256SUMS.txt`. The provenance file must record product, action, target, status, generated timestamp, normalized release assets directory, package name/version/package manager, Node platform/runtime, git commit/branch/dirty digest when available, standard artifact SHA-256/size proof including `release-notes.md` and the final local action report, and `subject.artifactManifestSha256`, which is the SHA-256 of the manifest artifact records excluding `provenance.json` and `release-signature.json`. `check:release-contracts` must include `release-provenance-contract` and fail a package when provenance is missing, not listed in the manifest, stale against the manifest subject, mismatched with `package.json`, missing standard artifact hash/size proof, or containing credential-shaped data or server-local absolute path leaks.

Release packages must also carry a deterministic local signature digest. The release command must write `release-signature.json` with `signatureVersion=video-cut.release-signature.v1`, `signatureKind=local-deterministic-digest`, and a SHA-256 signature over a canonical payload that covers the manifest subject, `SHA256SUMS` subject, `provenance.json`, `release-notes.md`, quality gate report, and final local action report. To avoid self-referential hashes, the manifest and checksum subjects inside the signature must exclude `release-signature.json` itself, and the provenance subject must exclude both `provenance.json` and `release-signature.json`. `check:release-contracts` must include `release-signature-contract` and fail a package when the signature file is missing, not listed in the manifest, stale against the signed subjects, mismatched with action/target/status, or redaction-unsafe.

Release artifacts must be sealed at package creation time. Every project-relative artifact referenced by `release-manifest.json`, including governance reports, target deployment files, and smoke reports, must be copied into the release assets directory at the same project-relative path. `check:release-contracts` must resolve artifact hashes and governance bundle hashes from packaged evidence snapshots before consulting mutable workspace files. A release package that passed when generated must remain contract-verifiable after later governance reports or workspace evidence are regenerated.

The release manifest and quality gate report must copy `runtimeProfile` from `deploy/runtime-profiles.yaml` by matching `releaseTarget`. The release command must fail when the registry is missing, the registry version is unsupported, or the target profile does not exist.

`--release-assets-dir` must be project-relative and must not contain parent-directory segments. Release action reports, `release-manifest.json`, `SHA256SUMS.txt`, `release-notes.md`, `provenance.json`, `release-signature.json`, and `quality-gate-execution-report.json` must serialize project-relative paths only. Absolute filesystem paths may be used inside the process to write files, but they must not appear in release JSON, smoke evidence, manifests, checksums, provenance, signatures, or quality reports.

`release:smoke:*` must generate a concrete JSON smoke report before packaging release evidence. The standard path is `artifacts/release/smoke/{target}-smoke-report.json`. The release command must receive the report through `--smoke-report`, validate the target-specific report version, require `ok=true` and `summary.fail=0`, reject sensitive fields, reject server-local absolute paths, add the report to `release-manifest.json`, `SHA256SUMS.txt`, and `quality-gate-execution-report.json`, and seal the same report inside `smoke-evidence-bundle.json`.

For the `desktop`, `container`, and `kubernetes` targets, release smoke validation must reject HTTP workflow reports that do not prove the full canonical workflow: health, task creation, multipart source upload, analysis, plan read/write roundtrip, render, artifact list, download descriptors, full artifact content download, byte range artifact content delivery, private no-store/nosniff artifact content headers, task events, redaction, non-empty `taskId`, source size, output MP4 signature, range byte count, and `host-content-endpoint` delivery for output, render manifest, and log artifacts. The report `deploymentMode` must match the target runtime profile.

For the `server` target, release smoke validation must reject managed server reports that do not prove Host build, process start, health, nested workflow smoke, process cleanup, redaction, `runtime.authMode=single-user-token`, and a sanitized nested `video-cut.http-workflow-smoke.v1` report with the same upload/render/artifact content/range/security-header evidence required by HTTP workflow targets.

For the `web` target, release smoke validation must also reject reports that do not prove private browser artifact delivery. The report must include explicit true values for `ui.artifactContentEndpointFetched`, `ui.artifactContentAuthorizationVerified`, `ui.artifactDownloadButtonVisible`, `ui.artifactDownloadContentFetched`, `ui.artifactDownloadAuthorizationVerified`, `ui.outputPreviewBlobUrl`, `ui.resultsPageVerified`, Settings Center conformance fields, doctor/diagnostics fields, and must include `ui.localPathLeakVisible=false`.

## Deployment Doctor

doctor 必须支持 `--json`，检查：

- FFmpeg/ffprobe
- workspace/artifact/temp 写权限
- 磁盘空间
- OpenAI-compatible baseUrl 连通性
- chat model / transcription model
- structured output 能力
- secret 来源
- CORS/auth 配置
- container/k8s volume
- optional GPU/ONNX Runtime

MVP 命令入口：

```bash
pnpm deployment:doctor -- --json
pnpm deployment:doctor:desktop:local -- --json
pnpm deployment:doctor:server:private -- --host-url http://127.0.0.1:6177/api/video-cut/v1 --json
```

当前 CLI 报告版本为 `video-cut.deployment-doctor.cli.v1`，只通过标准 `/health`、`/capabilities`、`/doctor` HTTP contract 采集证据，不直接在前端或脚本中探测 FFmpeg、文件系统、OpenAI-compatible endpoint 或 secret。
CLI 必须对 Host 返回值再执行一层兜底脱敏：不得输出 API key、bearer token、`Authorization` header、server-local absolute workspace/artifact/temp path；本地绝对路径统一替换为 `<redacted-path>`。

## Diagnostics Bundle

MVP 标准端点：

```http
GET /api/video-cut/v1/diagnostics/bundle
POST /api/video-cut/v1/diagnostics/support-bundle
```

输出版本为 `video-cut.diagnostics-bundle.v1`，默认只包含：

- `CapabilityReport`
- `DeploymentDoctorReport`
- 脱敏 `redactedConfig`
- 脱敏 artifact 摘要

默认不得包含：

- API key、token、Authorization header
- server-local absolute workspace、artifact、temp path
- 源视频文件
- 完整 transcript
- prompt 原文

Sensitive support attachments use a separate explicit-consent endpoint:

- `POST /api/video-cut/v1/diagnostics/support-bundle` accepts `DiagnosticSupportBundleRequest`.
- `includeSourceMedia=true` or `includeTranscript=true` requires `consentAccepted=true`; otherwise Host returns `DIAGNOSTICS_CONSENT_REQUIRED`.
- The endpoint returns the same `video-cut.diagnostics-bundle.v1` envelope with `supportRequest` evidence and `DiagnosticBundleArtifact` descriptors.
- Attachment descriptors may include only `kind`, `taskId`, `artifactId`, workspace-relative `path`, host-relative `contentRef`, `contentType`, `included`, `redacted`, `reason`, `sizeBytes`, and `sha256`.
- The diagnostics JSON must not embed source media bytes or transcript text; artifact bytes remain behind the authenticated artifact content endpoint.
- `contentRef` must be host-relative (`/api/video-cut/v1/.../content`) and must never contain server-local absolute paths.

UI 导出标准：

- Diagnostics 页面和 Settings Center 只能通过 `GET /api/video-cut/v1/diagnostics/bundle` 获取默认脱敏诊断包；敏感附件只能通过 `POST /api/video-cut/v1/diagnostics/support-bundle` 并带本次显式同意导出。
- 浏览器下载文件必须使用 `application/vnd.sdkwork.video-cut.diagnostics+json`，文件名格式为 `sdkwork-video-cut-diagnostics-{deploymentMode}-{generatedAt}.json`。
- 前端必须在生成下载链接前执行脱敏兜底扫描，至少拦截 `apiKey` 字段、Bearer token、Authorization header、password 字段、常见 token 字段和 server-local absolute path。
- 下载 UI 必须展示 `redaction verified`、文件名和大小，便于 local、server、container、kubernetes 模式下交付给运维或支持人员。
