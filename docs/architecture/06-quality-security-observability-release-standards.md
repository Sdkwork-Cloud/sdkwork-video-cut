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

The command is intentionally local and deterministic. It records required file presence and SHA-256 evidence; image build, Helm rendering, and binary signing can be attached as stricter CI gates without changing the report contract.

The release manifest and quality gate report must copy `runtimeProfile` from `deploy/runtime-profiles.yaml` by matching `releaseTarget`. The release command must fail when the registry is missing, the registry version is unsupported, or the target profile does not exist.

`--release-assets-dir` must be project-relative and must not contain parent-directory segments. Release action reports, `release-manifest.json`, `SHA256SUMS.txt`, `release-notes.md`, and `quality-gate-execution-report.json` must serialize project-relative paths only. Absolute filesystem paths may be used inside the process to write files, but they must not appear in release JSON, smoke evidence, manifests, checksums, or quality reports.

`release:smoke:*` must generate a concrete JSON smoke report before packaging release evidence. The standard path is `artifacts/release/smoke/{target}-smoke-report.json`. The release command must receive the report through `--smoke-report`, validate the target-specific report version, require `ok=true` and `summary.fail=0`, reject sensitive fields, reject server-local absolute paths, and add the report to `release-manifest.json`, `SHA256SUMS.txt`, and `quality-gate-execution-report.json`.

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
