# 05 Data Storage And Task Engine Standards

日期：2026-04-26

## 目标

本标准定义任务引擎、状态机、事件、artifact、存储和队列演进。所有部署模式必须保持相同任务语义。

进入 SQLite、PostgreSQL、DB queue 或 worker lease 阶段时，数据库表、迁移、索引、字段契约和 schema drift 检查必须遵守 [14-database-implementation-standard.md](./14-database-implementation-standard.md)。

## Task Model

```text
Task
  -> StageRun
  -> StepRun
  -> Event
  -> Artifact
```

Stage：

- import
- probe
- extractAudio
- transcribe
- analyze
- plan
- render
- artifact

状态：

```text
draft -> sourceReady -> analyzing -> planReady -> rendering -> succeeded
任意执行状态 -> failed
任意执行状态 -> cancelled
running on crash -> interrupted
```

`POST /api/video-cut/v1/tasks` creates a draft task only. Task creation must not accept `sourceName`, must not create a `kind=source` artifact, must not append an import event, and must not synthesize `source/input.mp4`. The only valid transition from `draft` to `sourceReady` is a successful source metadata attachment or multipart source upload.

## 幂等与恢复

- `analyze` 重复提交时，输入 hash 相同可复用 stage。
- `updateTaskPlan` 保存用户编辑的 split plan 时，必须替换当前 `{taskId}-plan` artifact 的 `sizeBytes` 和 SHA-256，使 artifact manifest 始终指向最新 `plan/plan.json` 内容。
- `updateTaskPlan` must validate the standard `VideoSplitPlan` contract before persistence. `PLAN_INVALID` covers invalid schema, output spec, track provenance, segments, score, or time ranges; `PLAN_TASK_ID_MISMATCH` covers URL/body task ownership mismatch. Rejected updates must not replace `plan/plan.json` or `{taskId}-plan` artifact metadata.
- `render` 重复提交必须生成新的 `renderId`，不覆盖旧产物。
- 取消通过 `CancellationToken` 传递到 provider、command runner、FFmpeg process。
- 应用重启后，running stage 标记 interrupted，并附带日志路径。
- 每个 stage 必须记录输入摘要、输出 artifact、开始/结束时间、错误码。

## 文件系统 Source Of Truth

MVP：

```text
workspace/
  runtime/
    settings.json
  projects/{projectId}/
    project.json
    tasks/{taskId}/
      task.json
      events.jsonl
      source/{safeName}
      analysis/
        media-info.json
        silence-ranges.json
        vad-ranges.json
        transcript.json
        semantic-analysis.json
      plan/
        plan.json
        plan-revisions/
      renders/{renderId}/
        render.json
        output.mp4
        cover.png
        subtitles.ass
        render.log
      artifacts/
        manifest.json
```

`runtime/settings.json` uses `runtimeSettingsVersion: 1`. It may store non-secret runtime configuration and configured markers such as `apiKeyConfigured`; it must not store `apiKey`, token, password, or provider secret plaintext.

## 原子写入

- manifest 先写临时文件，再 rename。
- 大文件记录 size、sha256、createdAt。
- artifact 删除先软删除，再由 retention policy 清理。
- 所有路径必须经过 workspace root guard。
- 不允许业务层手写拼接路径，必须经 repository port。

## 存储演进

| 阶段 | TaskRepository | ArtifactRepository | Queue | 适用部署 |
| --- | --- | --- | --- | --- |
| MVP | FileSystem | FileSystem | in-memory + file lock | desktop-local/server-private |
| 单机增强 | SQLite WAL | FileSystem | SQLite queue | desktop/server |
| 私有服务 | SQLite 或 PostgreSQL | FileSystem/S3-compatible | DB queue | server/container |
| K8s 多副本 | PostgreSQL | S3-compatible | external queue/lock | kubernetes |

K8s 开启多副本前必须具备：

- 共享数据库。
- 共享 artifact storage。
- distributed lock 或外部队列。
- worker lease。
- 幂等 stage execution。

数据库实现边界：

- `FileSystemTaskRepository`、`SQLiteTaskRepository`、`PostgreSQLTaskRepository` 必须通过同一组 repository conformance tests。
- SQLite/PostgreSQL adapter 只能实现 repository、queue、lease、audit、artifact metadata，不允许把业务 use case 写入数据库层。
- 数据库只保存 artifact metadata，不保存视频、音频、字幕、封面等大文件内容。
- 所有任务状态流转、stage run、render attempt 和 queue claim 必须具备幂等键、版本或等价并发控制。

## Source File Persistence

- `CreateTaskInput` contains only task metadata (`title`, `type`). It is not a source import command and must never publish a fake source artifact.
- Source import is valid only through `VideoCutHostClient.uploadTaskSourceFile()` or `VideoCutHostClient.attachTaskSource()`.

真实本地导入必须产生 workspace 文件，而不只是 source metadata。

- Browser `File` 通过 `VideoCutHostClient.uploadTaskSourceFile()` 进入 Host。
- Host 只写入 `workspace/projects/default/tasks/{taskId}/source/{safeName}`。
- `safeName` 必须由 Host 生成，禁止业务层直接信任浏览器文件名。
- `POST /source` metadata attachment and `POST /source/file` multipart upload must use the same Host-side safe basename sanitizer before writing artifact paths.
- `POST /source` metadata attachment and `POST /source/file` multipart upload must use the same source media type policy. Supported source extensions are `mp4`, `mov`, `m4v`, `mkv`, `webm`, `avi`, `mpeg`, and `mpg`. Empty content type and `application/octet-stream` are accepted only with a supported extension; explicit non-video content types are rejected with `SOURCE_FILE_TYPE_UNSUPPORTED` before the current source artifact is replaced.
- source artifact paths must never contain `..`, user-provided `/`, user-provided `\`, or server-local absolute path segments.
- source artifact 的 `path`、`sizeBytes`、`sha256`、`createdAt` 必须写入 task manifest 和 artifact manifest。Multipart uploaded source files must use the uploaded bytes as the source of truth for `sizeBytes` and SHA-256; pseudo hashes are forbidden for real uploaded content.
- 重复上传 source file 时，同一 task 只能保留一个 `kind=source` 的当前 artifact。
- 默认 diagnostics bundle 不包含 source media 内容。

## Analysis Artifact Persistence

`analyze` stage must write stable intermediate artifacts before publishing a plan. The first required artifact is media probing output:

- `analyze` requires a current `kind=source` artifact. If the task is still `draft` or no source artifact exists, the Host must return `SOURCE_FILE_REQUIRED`, keep the task in `draft`, and publish no analysis artifacts.
- Analysis JSON artifacts, extracted audio artifacts, and plan artifacts must publish `sizeBytes` and SHA-256 derived from the exact bytes written to the workspace. Fixed sizes and pseudo hashes are forbidden.
- path: `workspace/projects/default/tasks/{taskId}/analysis/media-info.json`
- artifact id: `{taskId}-media-info`
- kind: `analysis`
- schema id: `video-cut.media-info.schema.v1`
- source artifact: `{taskId}-source`

The file is part of the filesystem source of truth. Re-running `analyze` for the same task may replace the current `{taskId}-media-info` and `{taskId}-plan` artifacts only after the JSON documents have been written successfully. The plan artifact must reference the media-info artifact in `mediaInfoTrack.sourceArtifactId`, so downstream stages can audit exactly which probe output was used. When media probing succeeds, the initial plan range must be clamped to `media-info.format.durationSeconds` so a newly uploaded short source is renderable without a manual range edit.

Failed probing is still persisted as a standard document with `probeStatus=failed` or `probeStatus=source-unavailable` and warnings. This prevents fake-success metadata and keeps task recovery deterministic.

The same rule applies to audio extraction and silence detection:

- `analysis/audio-extract.json` is `{taskId}-audio-extract`.
- `audio/source.wav` is `{taskId}-audio-source` with `kind=audio` when extraction succeeds.
- `analysis/silence-ranges.json` is `{taskId}-silence-ranges`.
- `analysis/vad-ranges.json` is `{taskId}-vad-ranges`.
- `analysis/transcript.json` is `{taskId}-transcript`.
- `analysis/semantic-analysis.json` is `{taskId}-semantic-analysis`.
- re-running `analyze` replaces the current audio/silence/VAD/transcript/semantic analysis artifacts for the task and must not duplicate them in `artifacts/manifest.json`.
- `silenceTrack.sourceArtifactId` references `{taskId}-silence-ranges`.
- `speechActivityTrack.sourceArtifactId` references `{taskId}-vad-ranges`.
- `transcriptTrack.sourceArtifactId` references `{taskId}-transcript`.
- `semanticTrack.sourceArtifactId` references `{taskId}-semantic-analysis`.

VAD persistence follows the same deterministic failure rule as probing and silence detection. If the audio artifact is unavailable, ONNX Runtime is disabled, or the Silero model is missing, `analysis/vad-ranges.json` is still written with `vadStatus=audio-unavailable` or `vadStatus=unavailable`, warnings, and an empty `ranges` array. If the configured ONNX model cannot be initialized or executed, the artifact is written with `vadStatus=failed` and warnings. The system must not synthesize speech ranges to make downstream stages appear successful.

Transcript persistence follows the same rule. If audio is unavailable or the STT provider is not configured/executable, `analysis/transcript.json` is still written with `transcriptStatus=audio-unavailable` or `transcriptStatus=provider-unavailable`, warnings, empty `text`, and an empty `segments` array. The system must not synthesize transcript text to make downstream subtitle or semantic stages appear successful.

Semantic persistence also follows the same rule. If transcript output is unavailable or the AI provider is not configured/executable, `analysis/semantic-analysis.json` is still written with `semanticStatus=transcript-unavailable` or `semanticStatus=provider-unavailable`, warnings, empty `summary`, and empty `topics`/`qaCandidates` arrays. The system must not synthesize semantic facts to make cut scoring appear successful.

## Render Artifact Persistence

`render` stage artifacts are real workspace files, not metadata placeholders.

- Each render request creates a new `renderId` such as `{taskId}-render-1`.
- The Host writes render outputs under `workspace/projects/default/tasks/{taskId}/renders/{renderId}/`.
- A successful FFmpeg render publishes `{renderId}-output` with `kind=render`, path `output.mp4`, actual `sizeBytes`, and content SHA-256.
- The Host also publishes `{renderId}-subtitle` with `kind=subtitle`, `{renderId}-cover` with `kind=cover`, `{renderId}-manifest` with `kind=render-manifest`, and `{renderId}-log` with `kind=log`; all file artifacts use actual `sizeBytes` and content SHA-256.
- Re-running render must not overwrite an older render attempt. It must create a new render directory and artifact set.
- If FFmpeg fails after the attempt has started, the Host persists the redacted `render.log` artifact and marks the task failed.
- The artifact manifest must not contain fake output sizes, fake checksums, plaintext secrets, authorization headers, or server-local absolute media paths.
- Local, server, container, and Kubernetes modes must preserve the same artifact-relative path semantics. Server mode must serve artifacts through the artifact repository contract, not by exposing raw filesystem paths.
- Browser preview and download must use `GET /api/video-cut/v1/tasks/{taskId}/artifacts/{artifactId}/content` for binary content. In authenticated server/private modes, the browser UI must call this endpoint through the Host client so the `Authorization` header is present, then expose only a short-lived `blob:` URL to `<video>`, `<img>`, and download actions. `download` remains a descriptor endpoint; `content` is the only public binary-serving endpoint in v1.
- The artifact content endpoint must support single byte range requests for media playback. A satisfiable `Range: bytes=start-end` request returns `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`, and exact `Content-Length`; an unsatisfied range returns `416` with `Content-Range: bytes */{size}`. All artifact content responses must use `Cache-Control: private, no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`. The endpoint must still enforce artifact workspace boundaries before reading bytes.
- `ArtifactDownloadDescriptor.downloadMode` must be `host-content-endpoint` for filesystem-backed local/server artifacts and must include the relative `url` to the `content` endpoint. Future object-store adapters may use `signed-url` with `expiresAt`.

## Artifact Manifest

```ts
export interface VideoCutArtifact {
  artifactId: string;
  taskId: string;
  renderId?: string;
  kind: 'source' | 'audio' | 'analysis' | 'plan' | 'render' | 'subtitle' | 'cover' | 'render-manifest' | 'log';
  path: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  deletedAt?: string;
}
```

## Events

事件格式：

```ts
export interface VideoCutProgressEvent {
  eventId: string;
  taskId: string;
  stage: string;
  progress: number;
  message: string;
  level?: 'info' | 'warn' | 'error';
  traceId?: string;
  metadata?: {
    recoveryHint?: {
      code: string;
      action: 'upload-source' | 'retry-analysis' | 'retry-render' | 'open-settings' | 'open-diagnostics' | 'review-render-log' | 'none';
      label: string;
      message: string;
      retryable: boolean;
      targetStage?: string;
    };
  };
}
```

Recovery hints are event metadata, not UI-local inference. `metadata.recoveryHint` must be redacted before persistence or API delivery and must not contain API keys, bearer tokens, Authorization headers, raw provider payloads, raw FFmpeg stderr, or server-local absolute paths. When events are stored in `ops_task_event`, the same recovery hint metadata maps into `diagnostics_json`.

事件出口：

- desktop/server：SSE 或轮询。
- 文件：`events.jsonl`。
- server/k8s：可选发布到 observability backend。
