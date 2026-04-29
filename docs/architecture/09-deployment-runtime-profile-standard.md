# 09 Deployment Runtime Profile Standard

日期：2026-04-26

## 目标

本标准把每个部署模式打磨成可验收的 runtime profile，避免“能跑”但不可运维、不可恢复、不可发布。

## Readiness Levels

| Level | 含义 | 要求 |
| --- | --- | --- |
| `dev-ready` | 本地开发可用 | 能启动、能 health、能 capability、能跑 fake provider。 |
| `smoke-ready` | 发布 smoke 可用 | 能跑最小真实媒体 smoke，不要求真实 AI key。 |
| `prod-ready` | 私有部署可用 | 有 auth、CORS、持久化、日志、备份、资源限制、doctor。 |
| `scale-ready` | 多实例可用 | 具备共享 DB、共享 artifact、外部队列/锁、worker lease。 |

MVP 目标：

- `desktop-local`: `prod-ready`
- `server-private`: `prod-ready`
- `web-private`: `prod-ready`
- `container-private`: `smoke-ready` 到 `prod-ready`
- `kubernetes-private`: `smoke-ready`，多副本前不得宣称 `scale-ready`

## desktop-local Profile

必须具备：

- Tauri host supervisor。
- 随机 loopback 端口协商。
- host ready handshake。
- crash detection 和 restart policy。
- OS secure store secret。
- app data workspace。
- 打开文件/目录通过 Tauri platform adapter。
- 本地日志目录和诊断导出。

验收：

```bash
pnpm desktop:dev:local
pnpm deployment:doctor:desktop:local -- --json
pnpm workflow:smoke:desktop:local -- --json
```

## desktop-private Profile

必须具备：

- Tauri 不启动业务 host。
- 通过 runtime config 连接 private server。
- 本地只保存 server URL 和非敏感偏好。
- API token 不进入 localStorage。
- 所有能力来自 server `/capabilities`。

验收：

```bash
pnpm desktop:dev:private
pnpm deployment:doctor:desktop:private -- --json
```

## web-private Profile

必须具备：

- runtime config endpoint 或静态 runtime config。
- CORS 与 server 配置一致。
- 上传 progress/cancel。
- token 注入策略明确。
- 不访问本地工具和本地路径。

验收：

```bash
pnpm web:dev:private
pnpm release:smoke:web
```

## server-private Profile

必须具备：

- systemd/Windows service 样例。
- bind host/port 配置。
- auth mode。
- CORS: use `security.corsAllowedOrigins` / `SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS` with explicit HTTP(S) origins only; wildcard `*` is forbidden.
- workspace/artifact/temp root。
- log rotation 建议。
- backup/restore runbook。
- health/capability/doctor。

验收：

```bash
pnpm server:dev:private
pnpm deployment:doctor:server:private -- --json
pnpm workflow:smoke:server:private -- --json
pnpm workflow:smoke:server:managed -- --json
pnpm workflow:smoke:ui:managed -- --json
```

The managed server smoke report must emit `video-cut.managed-server-workflow-smoke.v1` and prove the deployable Host path:
- The Host binary builds before the smoke starts.
- The Host process starts in `server-private` mode with `single-user-token` auth and a redacted workspace root.
- The `/health` endpoint is reachable.
- A nested sanitized `video-cut.http-workflow-smoke.v1` report proves upload, analysis, render, artifact descriptors, full artifact content download, byte range artifact content delivery, private no-store/nosniff artifact content headers, events, redaction, MP4 signature, and `host-content-endpoint` delivery.
- The process cleanup check passes and the report does not include tokens, API keys, `Authorization` headers, or server-local absolute paths.

The managed UI smoke report must emit `video-cut.managed-ui-workflow-smoke.v1` and prove the browser path end-to-end:
- Host and Vite start in an isolated `server-private` runtime with `single-user-token` auth.
- The browser uploads a real MP4 through Workbench, runs analysis, and renders through `/api/video-cut/v1`.
- The browser opens Results and verifies the delivery package: render manifest is visible, delivery integrity status is visible, and output preview/downloads are fetched through `GET /tasks/{taskId}/artifacts/{artifactId}/content`.
- In `server-private` mode, browser media elements must not use raw private API URLs. The UI must fetch artifact content through the authenticated Host client, convert it to a short-lived `blob:` URL for preview/download, and revoke the object URL after use.
- The report must include `ui.resultsPageVerified`, `ui.manifestVisible`, `ui.deliveryPackageVisible`, `ui.artifactContentEndpointFetched`, `ui.artifactContentAuthorizationVerified`, `ui.artifactDownloadButtonVisible`, `ui.artifactDownloadContentFetched`, `ui.artifactDownloadAuthorizationVerified`, `ui.outputPreviewBlobUrl`, and `ui.localPathLeakVisible=false`.
- The browser opens Settings Center, saves write-only LLM/STT secrets through the Host, verifies inputs are cleared, runs provider conformance, runs doctor, exports diagnostics, and verifies redaction.
- The report must include `ui.settingsSaved`, `ui.providerConformanceVerified`, `ui.doctorVerified`, `ui.diagnosticsBundleVerified`, and `ui.settingsRedactionVerified`.
- The report must not include auth tokens, API keys, `Authorization` headers, raw provider payloads, or server-local absolute media paths.

## container-private Profile

必须具备：

- non-root user。
- `/data` volume。
- healthcheck。
- `.env.example`。
- compose base profile。
- CUDA/ROCm overlay profile。
- image label: version, revision, created, source。
- SBOM attachment。

验收：

```bash
docker compose -f deploy/docker/docker-compose.yml up -d
SDKWORK_VIDEO_CUT_HOST_URL=http://127.0.0.1/api/video-cut/v1 pnpm workflow:smoke -- --json
pnpm release:smoke:container
```

The container release smoke report must emit `video-cut.http-workflow-smoke.v1` with `deploymentMode=container-private` and full HTTP workflow evidence: health, create, upload, analyze, plan roundtrip, render, artifact descriptors, artifact content bytes, byte range artifact content bytes, private no-store/nosniff artifact content headers, events, redaction, source size, MP4 signature, and `host-content-endpoint` delivery for output, manifest, and log.

## kubernetes-private Profile

必须具备：

- Helm chart。
- values schema。
- ConfigMap/Secret/PVC。
- Service/Ingress。
- resource requests/limits。
- startup/readiness/liveness probes。
- upload timeout/size annotations。
- `replicaCount: 1` 默认。
- `values.release.yaml` 固定 image tag/digest。

验收：

```bash
helm template sdkwork-video-cut ./deploy/kubernetes -f deploy/kubernetes/values.yaml
SDKWORK_VIDEO_CUT_HOST_URL=https://video-cut.example.com/api/video-cut/v1 pnpm workflow:smoke -- --json
pnpm release:smoke:kubernetes
```

The Kubernetes release smoke report must emit `video-cut.http-workflow-smoke.v1` with `deploymentMode=kubernetes-private` and the same full HTTP workflow plus byte range and security-header artifact delivery evidence required by container smoke. Until shared DB, object storage, and worker lease are implemented, the smoke validates the single-replica private deployment profile only.

## 多副本升级门槛

Kubernetes 只有满足以下条件才允许 `replicaCount > 1`：

- `PostgreSQLTaskRepository` 可用。
- `S3CompatibleArtifactRepository` 可用。
- 队列具备 worker lease。
- stage execution 幂等。
- render attempt 不覆盖。
- task cancel 能跨 worker 生效。
- health/readiness 能反映 worker 状态。

未满足时 Helm chart 必须 fail 或 warning，并保持单副本。

## Backup And Restore

必须定义：

- backup scope：config、projects、tasks、artifacts、logs、model assets。
- restore order：config -> repository -> artifacts -> capability rebuild。
- checksum verification。
- secret 不进入普通 backup，需独立导出/注入。

## Runtime Profile Manifest

机器可读 profile registry 固定为 `deploy/runtime-profiles.yaml`，并由 `pnpm check:deployment-matrix -- --json` 检查。每个发布包必须带对应 profile：

```json
{
  "profileId": "video-cut.server-private.v1",
  "deploymentMode": "server-private",
  "readinessLevel": "prod-ready",
  "apiContract": "/api/video-cut/v1",
  "storageProvider": "filesystem",
  "secretProvider": "env",
  "requiredChecks": ["health", "capability", "workspaceWritable", "ffmpeg", "ffprobe"]
}
```

Release packaging must treat `deploy/runtime-profiles.yaml` as the single source of truth. `release-manifest.json.runtimeProfile` and `quality-gate-execution-report.json.runtimeProfile` must be copied from the registry entry whose `releaseTarget` matches the package target. Release tooling must fail if the registry is missing, has an unsupported `registryVersion`, or lacks the requested target. Release tooling must accept only project-relative `--release-assets-dir` values and must serialize project-relative report/artifact paths only. Release smoke tooling must also validate that the smoke report `deploymentMode` and required evidence match that release target instead of accepting generic `ok=true` reports.
