# 16 AutoCut Frontend Module Standard

## Generated Output Cleanup Standard

`pnpm clean` MUST delegate to `scripts/clean-autocut-generated.mjs`.
Inline shell or inline Node deletion logic in `package.json` is forbidden.
The cleanup script may remove only audited generated paths inside the workspace:
root `dist/`, `artifacts/runtime/`, `packages/sdkwork-autocut-desktop/dist/`,
`packages/sdkwork-autocut-desktop/src-tauri/target/`, and
`packages/sdkwork-autocut-desktop/src-tauri/gen/`.
New generated paths MUST first be added to this standard and to
`scripts/check-autocut-architecture.mjs`.

## Configured Output Directory Standard

The workspace `outputDirectory` in Settings is the configurable native media
output root and is stored in the same runtime-scoped settings namespace as other
workspace preferences. Development uses `autocut_dev_settings`; packaged release
uses `autocut_release_settings`. Switching environments must not reuse another
environment's output root.

Feature services must resolve the configured root through
`resolveAutoCutOutputRootDir` and pass it to native import and processing
commands as `outputRootDir`. `outputRootDir` must be an absolute directory path.
If it is blank or missing, the native host uses the app data media root.
Imported source copies are stored under `{outputRootDir}/inputs/`; generated
task results are stored under `{outputRootDir}/tasks/{task_uuid}/outputs/`.
`ops_task.input_json` must record `outputRootDir` when one was configured so
`autocut_retry_native_task` can preserve the source task output root.

## Task Result Traceability

Task result traceability is a required frontend domain contract. When a
processing workflow starts from an asset-library selection, `AppTask` MUST store
`sourceFileId?: string` from the submitted `fileId`. `AppTask` MUST store
`generatedAssetIds?: string[]` after a processing workflow completes.
Every generated `AppAsset` MUST store `sourceTaskId?: string` and
`sourceTaskType?: TaskType`. Processing services MUST create generated asset IDs
as local values before `addAsset(...)`, persist those same IDs in
`generatedAssetIds`, and keep emitted asset event payloads identical to stored
assets. Imported user assets, folders, uploaded files, and external URLs may
leave source/output trace fields unset when they are not selected from the asset
library or produced by a task.

## Service-layer source validation

Processing workflow services MUST validate their source media before creating a
task, generated asset, message, progress timer, or event. The validation boundary
is `validateAutoCutProcessingSource` from
`@sdkwork/autocut-services/service/processing-source.service.ts` and must not be
reimplemented in pages.

Every non-slicer processing workflow requires either an uploaded `File` or a
selected asset `fileId`. The slicer workflow may additionally accept an external
source URL only when it explicitly passes `allowExternalUrl: true`; accepted URLs
must parse as `http:` or `https:`. Blank URLs, missing source media, and unsafe
protocols such as `javascript:` or `file:` MUST be rejected before `addTask`,
`addAsset`, or `addMessage` can run. UI disabled states remain a usability hint;
service-layer validation is the source of truth.

## Native Host Contract Baseline

The desktop package now owns a package-local native host contract baseline under
`packages/sdkwork-autocut-desktop/src-tauri/`. The host capability command is
`autocut_host_capabilities`. It reports the native host contract version,
database contract readiness, media command readiness, supported command names,
and the honest `ffmpegExecutionReady` flag.

The native database command exposed to the webview is `autocut_database_health`.
It may initialize the package-local SQLite baseline through
`run_autocut_database_migrations` and returns health data for diagnostics. The
host capabilities response includes `sqliteMigrationReady` and
`databaseHealthCommandReady` so the frontend can distinguish a usable database
contract from a media-processing engine.

The native media commands exposed to the webview are `autocut_ffmpeg_probe`,
`autocut_import_media_file`, `autocut_describe_local_media_file`,
`autocut_select_local_video_file`,
`autocut_select_local_directory`,
`autocut_list_native_tasks`, `autocut_cancel_native_task`,
`autocut_recover_native_tasks`, `autocut_retry_native_task`,
`autocut_extract_audio`, `autocut_generate_gif`,
`autocut_compress_video`, `autocut_convert_video`,
`autocut_enhance_video`, and
`autocut_audio_smoke`. They are implemented through the package-local
`media_runtime.rs` boundary, use `Command::new` with argument arrays, and do
not execute through shell strings.
`autocut_import_media_file` is the only command that may accept a raw local file
path from the frontend. It copies the source into the native AutoCut media input
sandbox, writes `media_asset`, and returns `assetUuid`.

`autocut_describe_local_media_file` is a read-only desktop file selection bridge.
It may accept a raw local path only when that path came from Tauri desktop file
drop integration. It validates that the path is absolute, exists, and points to a
file, then returns canonical `sourcePath`, `name`, `byteSize`, `mediaType`, and
`mimeType`. It must not copy media, write database rows, or substitute for
`autocut_import_media_file`.

`autocut_select_local_video_file` is the trusted desktop video chooser bridge.
It opens the operating-system file picker through the contracted native host
runtime, restricts selection to supported video extensions, validates the chosen
file through the same canonical local media descriptor path as
`autocut_describe_local_media_file`, and returns `null` when the user cancels.
Frontend entry points such as the homepage smart slicing action must prefer this
command through `native-host-client.service.ts`, convert its descriptor through
`createAutoCutTrustedLocalFile`, and fall back to an HTML `input type="file"`
only when the native host is unavailable.

`autocut_select_local_directory` is the trusted desktop directory chooser
bridge. It opens the operating-system folder picker through the contracted
native host runtime, returns a canonical absolute directory path, creates the
directory if needed, and returns `null` when the user cancels. Settings must use
this command through `selectAutoCutTrustedLocalDirectory` for
`defaultStoragePath` and `outputDirectory` updates; frontend code must not
synthesize Windows-only paths such as `\Exports` when no directory was selected.

`autocut_list_native_tasks` is the read-only native task observability bridge.
It returns persisted `ops_task` snapshots with embedded `ops_stage_run` and
`ops_task_event` snapshots. Frontend packages must use this command through
`native-host-client.service.ts` when they need native execution diagnostics; they
must not read SQLite directly or infer native task state from generated artifact
paths.

`autocut_cancel_native_task` is the native task cancellation bridge. Frontend
packages must call it only through `native-host-client.service.ts` with
`taskUuid`. The native host may cancel only an active FFmpeg child process that
is tracked in the current desktop session. If the task is completed, failed,
not processing, or has no tracked process, the command must return a typed
non-canceled acknowledgement without mutating persisted task state. When a
tracked process is canceled, `ops_task.status` moves to cancel requested first,
and the native runtime records cancel requested / canceled events through
`ops_task_event` so later task snapshots remain auditable.

`autocut_recover_native_tasks` is the native task recovery bridge. The desktop
entrypoint must trigger it through `native-host-client.service.ts` during native
host setup, and feature packages may call it only through that service. The
native host must not rewrite current-session tracked work. It may recover stale
`processing` rows to interrupted and stale `cancel_requested` rows to canceled,
recording `ops_task_event` audit entries so task snapshots explain why a task no
longer appears active after a crash, process exit, or app restart. Recovery is
worker-lease aware: it first expires stale `ops_worker_lease` rows, includes
`leaseUuid`, `leaseStatus`, and `reason: "expiredWorkerLease"` in recovery event
payloads when a lease expiry caused recovery, and defers untracked tasks that
still have an active unexpired lease. `AutoCutNativeTaskRecoveryResult` exposes
`expiredLeases` and `deferred` so diagnostics do not infer lease outcomes from
SQLite or UI state.

`autocut_retry_native_task` is the native task retry bridge. Frontend packages
must call it only through `native-host-client.service.ts` with `taskUuid`. The
native host may retry only failed, canceled, or interrupted native tasks. Retry
must create a new `ops_task` from the source task's persisted `input_json`,
return the new retry task uuid, and append a retry requested audit event to the
source task. It must not rewrite the source task's terminal state or infer retry
parameters from UI-only task records.

`autocut_extract_audio` is an assetUuid based operation. Frontend packages must
pass `assetUuid`, not a raw path, and the native host resolves
`media_asset.source_uri`, runs FFmpeg against the sandbox copy, writes the
artifact under `{outputRootDir}/tasks/{task_uuid}/outputs/`, returns `taskOutputDir`, and
registers `media_artifact`, `ops_task`, and `ops_stage_run` for traceability.

`autocut_generate_gif` is an assetUuid based operation. Frontend packages must
pass `assetUuid`, `fps`, `resolution`, and `dither`, not a raw local path. The
native host resolves the imported sandbox copy from `media_asset.source_uri`,
validates the supported GIF encoding options, runs FFmpeg with a deterministic
palette filter, writes an `image/gif` artifact under
`{outputRootDir}/tasks/{task_uuid}/outputs/`, returns `taskOutputDir`, and registers
`media_artifact`, `ops_task`, and `ops_stage_run`.

`autocut_slice_video` is an assetUuid based operation for the intelligent
slicer. Frontend packages must pass `assetUuid`, a bounded `clips` array with
`startMs`, `durationMs`, and `label`, plus `outputFormat: "mp4"`, not a raw
local path. The slicer service may use the approved OpenAI-compatible AI SDK
bridge to plan clips; if LLM configuration is unavailable it must fall back to a
deterministic bounded plan. LLM output is only a candidate plan: the slicer
service must sort candidates by `startMs`, clamp `durationMs` to the configured
minimum and maximum, fill deterministic non-overlapping gaps until the standard
clip count is reached, and only then invoke the native command. The native host
resolves the imported sandbox copy, validates clip count and duration, runs
FFmpeg once per clip, writes every
`video/mp4` slice under the same `{outputRootDir}/tasks/{task_uuid}/outputs/`,
generates a JPEG thumbnail for each slice under the same `outputs/` directory,
returns `taskOutputDir`, and registers one `media_artifact` row per video slice
plus one thumbnail artifact row per slice. The typed result must include
`artifactPath` and `thumbnailArtifactPath`; frontend services must convert both
through `createAssetUrl` before storing task `sliceResults` and generated assets.
`ops_task.output_json` must include `sliceResults` so retry and diagnostics do
not depend on frontend state.

`autocut_transcribe_media` is an assetUuid based local speech-to-text operation.
Frontend packages must pass `assetUuid`, optional `language`, optional
`outputRootDir`, and the settings-backed local speech-to-text `executablePath`
plus `modelPath` when the user configured them in Settings. They must not pass a
raw media path. The native host resolves the imported sandbox copy from
`media_asset.source_uri`, extracts mono 16 kHz WAV audio with FFmpeg, then
invokes a local Whisper-compatible command. The local speech toolchain is
configured through the Settings Center first; environment variables
`SDKWORK_AUTOCUT_WHISPER_EXECUTABLE` and `SDKWORK_AUTOCUT_WHISPER_MODEL` remain a
headless fallback only. `speechTranscriptionCommandReady` means the command
contract exists. `speechTranscriptionToolchainReady` reports environment-backed
readiness and may remain false even when settings-backed paths are valid, so
feature workflows must use `(speechTranscriptionToolchainReady ||
speechRuntimeConfig.configured)` before calling transcription.
`speechTranscriptionProbeCommandReady` and
`speechTranscriptionFileSelectCommandReady` are the Settings Center contract for
testing and selecting the local toolchain. The native host must fail closed when
the toolchain is not configured and must not fabricate transcript text.
Successful runs write a JSON transcript under
`{outputRootDir}/tasks/{task_uuid}/outputs/`, register a `media_artifact`
transcript artifact, and return `segments` with `startMs`, `endMs`, `text`, and
optional `speaker`.

The intelligent slicer is transcript-assisted when local speech transcription is
available. The slicer service may call `autocut_transcribe_media` after
`autocut_import_media_file` and before `autocut_slice_video`. Transcript segment
timing and text are added to the approved OpenAI-compatible AI SDK planning
prompt; if the LLM is unavailable, the service must still use transcript segment
timing as a deterministic semantic candidate plan. This is the required
transcript-assisted intelligent slicing contract. Local transcription failures
must be reported through diagnostics and must degrade to the existing
non-transcript slicing plan instead of failing the whole slicing task.
When the user enables subtitle generation and local transcript segments exist,
the slicer service must pass `subtitleFormat: "srt"` and the real
`subtitleSegments` to `autocut_slice_video`. The native result may include
`subtitleArtifactPath`, `subtitleArtifactUuid`, `subtitleByteSize`, and
`subtitleFormat` per slice; frontend services must convert subtitle paths
through `createAssetUrl` before storing `sliceResults.subtitleUrl`. Frontend
packages must not generate fake subtitle files when no local transcript segments
are available.

`autocut_compress_video` is an assetUuid based operation. Frontend packages must
pass `assetUuid` and `compressionMode`, not a raw local path. The native host
resolves the imported sandbox copy from `media_asset.source_uri`, validates the
supported compression mode, runs FFmpeg with `libx264`, `-crf`, `-preset`, and
`-movflags +faststart`, writes a `video/mp4` artifact under
`{outputRootDir}/tasks/{task_uuid}/outputs/`, returns `taskOutputDir`, and registers
`media_artifact`, `ops_task`, and `ops_stage_run`. The typed result must include
`originalByteSize` and `byteSize` so the frontend can persist `fileSizeStats`
without inspecting local files.

`autocut_convert_video` is an assetUuid based operation. Frontend packages must
pass `assetUuid`, `targetFormat`, `videoCodec`, `audioCodec`, and `resolution`,
not a raw local path. The native host resolves the imported sandbox copy from
`media_asset.source_uri`, validates target container, codec, and resolution
against a whitelist, runs FFmpeg with command arguments, writes a video artifact
under `{outputRootDir}/tasks/{task_uuid}/outputs/`, returns `taskOutputDir`, and
registers `media_artifact`, `ops_task`, and `ops_stage_run`. `auto` codec
selections are normalized by the native host to deterministic defaults for the
target container.

`autocut_enhance_video` is an assetUuid based operation. Frontend packages must
pass `assetUuid`, `targetResolution`, `enhanceMode`, and `frameRate`, not a raw
local path. The native host resolves the imported sandbox copy from
`media_asset.source_uri`, validates resolution, mode, and frame rate against a
whitelist, runs FFmpeg with deterministic `scale`, `unsharp`, and color
adjustment filters, writes a `video/mp4` artifact under
`{outputRootDir}/tasks/{task_uuid}/outputs/`, returns `taskOutputDir`, and registers
`media_artifact`, `ops_task`, and `ops_stage_run`. This native baseline is
deterministic FFmpeg enhancement, not a claim that AI super-resolution runtime
is bundled.

The workspace `outputDirectory` in Settings is the configurable native media
output root. If it is blank or missing, the native host uses the app data media
root. Feature services must resolve it through `resolveAutoCutOutputRootDir`
and pass it to native import and processing commands as `outputRootDir`.
`outputRootDir` must be an absolute directory path. Imported source copies are
stored under `{outputRootDir}/inputs/`; generated task results are stored under
`{outputRootDir}/tasks/{task_uuid}/outputs/`. `ops_task.input_json` must record
`outputRootDir` when one was configured so `autocut_retry_native_task` can
preserve the source task's output root.

`{outputRootDir}/inputs/` is the imported source asset sandbox only. Frontend
packages must not treat it as an output folder, and they must not infer task
ownership from file names. Every native media result must expose `artifactPath`
inside its own `taskOutputDir`; `media_artifact.uri`,
`media_artifact.metadata_json`, and `ops_task.output_json` are the durable
traceability surface.

Frontend code must access these commands only through
`native-host-client.service.ts` in `@sdkwork/autocut-services`. The service
defines the typed command contract, the browser unsupported fallback, and the
standard `configureAutoCutNativeHostClient` hook used by the desktop shell.
Feature packages and pages must not call raw Tauri `invoke`, inspect
`window.__TAURI__`, or duplicate command strings.

The desktop shell may depend on `@tauri-apps/api` only for the package-local
`src/native-host.ts` adapter. That adapter maps Tauri `invoke` into
`createAutoCutNativeHostClient`, maps native artifact paths through
`convertFileSrc` so generated audio/video URLs use the Tauri asset protocol
instead of raw local paths or `file://` URLs, and listens to
`getCurrentWebview().onDragDropEvent` to convert desktop drop paths into typed
trusted file source descriptors. Feature packages must receive only the typed
`AutoCutNativeHostClient` abstraction from `@sdkwork/autocut-services`.

Browser `File` objects do not expose a trustworthy absolute local path. A
workflow may call `autocut_import_media_file` only when the selected file object
contains an explicit desktop-provided `path` or `sourcePath`. If the source is a
normal browser upload without that trusted path metadata, the feature service
must keep the existing browser/mock workflow rather than guessing paths,
constructing `file://` URLs, or bypassing the import-first asset boundary. The
audio extractor service is the current native-capable reference workflow: when
native media import and assetUuid extraction are ready, and a trusted desktop
source path is present, it runs `importMediaFile -> extractAudio`, converts the
artifact path to a safe asset URL, persists the generated `AppAsset`, and
completes the `AppTask` with `generatedAssetIds` plus `audioUrl`.

The video GIF service follows the same import-first native workflow. When
native media import and `videoGifCommandReady` are ready, and a trusted desktop
source path is present, it runs `importMediaFile -> generateGif` by `assetUuid`,
converts the returned `artifactPath` through the native asset URL factory,
persists the generated image `AppAsset`, and completes the `AppTask` with
`generatedAssetIds` plus `gifUrl`.

The video compression service follows the same import-first native workflow.
When native media import and `videoCompressCommandReady` are ready, and a
trusted desktop source path is present, it runs
`importMediaFile -> compressVideo` by `assetUuid`, converts the returned
`artifactPath` through the native asset URL factory, persists the generated
video `AppAsset`, and completes the `AppTask` with `generatedAssetIds`,
`videoUrl`, and `fileSizeStats`.

The video conversion service follows the same import-first native workflow.
When native media import and `videoConvertCommandReady` are ready, and a
trusted desktop source path is present, it runs
`importMediaFile -> convertVideo` by `assetUuid`, converts the returned
`artifactPath` through the native asset URL factory, persists the generated
video `AppAsset`, and completes the `AppTask` with `generatedAssetIds` plus
`videoUrl`.

The video enhancement service follows the same import-first native workflow.
When native media import and `videoEnhanceCommandReady` are ready, and a
trusted desktop source path is present, it runs
`importMediaFile -> enhanceVideo` by `assetUuid`, converts the returned
`artifactPath` through the native asset URL factory, persists the generated
video `AppAsset`, and completes the `AppTask` with `generatedAssetIds` plus
`videoUrl`.

`@sdkwork/autocut-commons` owns the browser-safe trusted file source bridge in
`trusted-file-source.service.ts`. `FileUpload` may listen to
`listenAutoCutTrustedFileSourceDrop`, create `File`-compatible values through
`createAutoCutTrustedLocalFile`, and then reuse the same validation path used for
HTML selected files. The bridge preserves `sourcePath`, `path`, `byteSize`,
`mediaType`, `name`, `type`, and `size` without changing the component's visual
design. Feature services must read trusted local paths through
`resolveAutoCutTrustedSourcePath` instead of casting arbitrary `File` objects or
guessing platform-specific path fields.

The host capabilities response includes `ffmpegProbeCommandReady`,
`mediaImportCommandReady`, `mediaFileDescribeCommandReady`,
`localVideoFileSelectCommandReady`, `nativeTaskQueryCommandReady`,
`nativeTaskCancelCommandReady`,
`nativeTaskRecoveryCommandReady`,
`nativeTaskRetryCommandReady`,
`nativeTaskProgressEventsReady`,
`nativeWorkerLeaseReady`,
`audioExtractionCommandReady`,
`audioExtractionFromAssetReady`, `videoGifCommandReady`,
`videoCompressCommandReady`, `videoConvertCommandReady`,
`videoEnhanceCommandReady`,
`ffmpegToolchainManifestReady`,
`ffmpegToolchainResolverReady`, and `ffmpegBundledReady`.
`nativeTaskProgressEventsReady` means the native host persists task progress
through `ops_task.progress` and appends `OPS_TASK_EVENT_TYPE_PROGRESS` audit
events that are exposed by `autocut_list_native_tasks`. Frontend modules must
render native progress from `AutoCutNativeTaskSnapshot.progress` and the returned
event snapshots only. They must not read SQLite directly, invent a browser-side
native progress timer, or infer native progress from artifact files. The native
host owns realtime persistence by streaming FFmpeg `-progress pipe:1` output
through `run_tracked_ffmpeg_command_with_progress`; frontend packages only poll
or refresh the typed task snapshots.
Every `AutoCutNativeTaskEventSnapshot` must expose both `payloadJson` and
`payload`: `payloadJson` is the raw audit JSON persisted in `ops_task_event`,
while `payload` is the parsed, stable frontend contract. Native task event
payloads must contain `phase` and `source`; progress events must additionally
contain `operation` and `progress`. Completed events must expose `progress: 100`.
Frontend packages must consume the typed `payload` object and keep `payloadJson`
only for audit/debug display.
`nativeWorkerLeaseReady` means native media operations persist durable worker
lease rows in `ops_worker_lease` and expose them as
`AutoCutNativeTaskSnapshot.workerLeases`. Frontend diagnostics may render worker
lease status, heartbeat, expiry, and release timestamps from typed snapshots
only. Frontend packages must not query SQLite, synthesize worker ownership, or
infer lease state from FFmpeg process presence.
Recovery diagnostics must use `AutoCutNativeTaskRecoveryResult.expiredLeases`,
`AutoCutNativeTaskRecoveryResult.deferred`, and typed task event `payload`
fields. A task deferred by active lease is still considered in-flight by the
native host and must not be force-completed or force-failed by frontend code.
The package-local FFmpeg toolchain manifest is
`packages/sdkwork-autocut-desktop/src-tauri/binaries/ffmpeg.toolchain.json`.
It must carry `contractVersion`, FFmpeg license metadata, platform-specific
sidecar paths, and sidecar integrity metadata (`sha256` and `byteSize`). The
Tauri bundle resource map reserves `binaries/windows-x86_64`,
`binaries/linux-x86_64`, `binaries/macos-x86_64`, and
`binaries/macos-aarch64` as the only standardized sidecar directories.
`ffmpegToolchainManifestReady` and `ffmpegToolchainResolverReady` mean only that
the manifest contract and resolver order are standardized. The resolver order is
`SDKWORK_AUTOCUT_FFMPEG` environment override, bundled sidecar from Tauri
`resource_dir`, bundled sidecar from the package-local source manifest during
development, then the manifest `requiredBinary` on `PATH` as a development
fallback. A sidecar is usable only after the resolver verifies that its file size
and SHA-256 digest match the manifest. The typed `AutoCutFfmpegProbe` response exposed by
`native-host-client.service.ts` must include `sourceKind`, `manifestReady`, and
`bundledReady` so diagnostics can distinguish environment, sidecar, and PATH
resolution. `ffmpegBundledReady` MUST remain `false` until a real FFmpeg sidecar
is packaged as a deterministic desktop runtime asset. `ffmpegExecutionReady`
MUST remain `false` until bundled FFmpeg, durable background task recovery,
downloadable artifact UX, and release smoke evidence are implemented. Pages and
feature packages must not call arbitrary Tauri commands, open raw local paths,
or treat the native host baseline as a completed media engine.
Sidecar registration is standardized through
`scripts/prepare-autocut-ffmpeg-sidecar.mjs`; it must be called with
`--platform`, `--source`, and `--accept-license` so the manifest is updated from
an explicit, license-acknowledged binary. Release verification is standardized
through `scripts/check-autocut-release-smoke-preflight.mjs`; the normal mode may
pass while reporting `bundledReady=false`, while release builds that claim a
bundled FFmpeg must run it with `--require-bundled`. Frontend modules must use
only the typed capability and probe flags returned by `native-host-client.service.ts`.
Release evidence is standardized through `scripts/write-autocut-release-evidence.mjs`.
It writes an ignored JSON artifact under `artifacts/release/` with installer
digests, FFmpeg manifest state, preflight state, native smoke evidence,
installer signature evidence, and the derived `ffmpegExecutionReady` boundary.
Native smoke evidence is standardized through
`scripts/write-autocut-native-release-smoke.mjs`; it records the Rust-backed
evidence matrix for `autocut_host_capabilities`, `autocut_ffmpeg_probe`,
`autocut_audio_smoke`, and `autocut_recover_native_tasks`. LLM secret command
readiness must come from the real Windows Credential Manager smoke, not from the
default mock keyring unit test. Run
`pnpm release:native-smoke -- --run-real-llm-secret-smoke`, or set
`SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE=true`, before aggregate release
evidence is written so `realLlmSecretStoreSmokeReady` and the three LLM secret
command matrix entries are honestly ready. The native smoke writer must set
isolated temporary `CARGO_TARGET_DIR` values named
`sdkwork-autocut-native-smoke-target-rust-*` and
`sdkwork-autocut-native-smoke-target-llm-secret-*`, so release evidence
generation does not lock package-local `src-tauri/target` or reuse a Windows
test executable path during parallel test or packaging runs.
Installer signing evidence is standardized through
`scripts/write-autocut-installer-signature-evidence.mjs`, and the final hard
gate is `scripts/check-autocut-commercial-release-readiness.mjs`. This gate must
stay blocked until sidecar integrity, executable smoke, native smoke, installer
signature, aggregate release smoke, and `ffmpegExecutionReady` are all true.
This evidence is a release artifact, not frontend runtime state, and packages
must not read it directly.

The current allowed `src-tauri/src/` files are `main.rs`, `commands.rs`,
`host_contract.rs`, `database_contract.rs`, `database_runtime.rs`, and
`media_runtime.rs`. The current allowed `src-tauri/` database files are the
SQLite baseline `database/schema/sqlite/001_baseline.sql` and schema registry
`database/schema-registry/autocut_host_baseline.yaml`.

## Desktop Rust Toolchain Standard

The desktop package MUST own a package-local Rust toolchain file at
`packages/sdkwork-autocut-desktop/rust-toolchain.toml`.
It pins Rust `1.90.0` and the `x86_64-pc-windows-msvc` target so Tauri release
builds do not depend on whatever global `stable` toolchain is active on the
developer machine.

Root `pnpm tauri:build` delegates to `@sdkwork/autocut-desktop`, so rustup
resolves this package-local toolchain automatically. Direct Rust verification
from the repository root MUST use:

```bash
cargo +1.90.0 check --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml
```

The guard script MUST remain covered by its executable contract:

```bash
node scripts/ensure-autocut-tauri-rust-toolchain.test.mjs
```

Root `pnpm test` MUST run this contract before recursive package tests.

日期：2026-05-04
状态：accepted

## 目标

本标准把 `packages/sdkwork-autocut-*` 中已经定义的 AutoCut 产品设计、
视觉效果和功能模块固化为 `sdkwork-video-cut` 桌面应用的前端模块标准。

当前应用是全新的 Tauri 桌面应用。桌面应用必须定义在 package 内，
即 `packages/sdkwork-autocut-desktop`，不得在仓库根目录定义 `src`、
`src-tauri`、`index.html`、`vite.config.ts` 或 `public` 作为应用入口。

标准化工作不得重做页面视觉，不得改变产品布局、文案和交互语义，不得把业务
逻辑重新塞回桌面 shell。

## 模块清单

根桌面 shell 只装配以下功能模块：

| Package | Responsibility |
| --- | --- |
| `@sdkwork/autocut-desktop` | package-local Tauri/Vite/React desktop shell |
| `@sdkwork/autocut-core` | 应用布局、导航和 shell 级组合组件 |
| `@sdkwork/autocut-commons` | Button、Card、FileUpload、Toast 等共享 UI |
| `@sdkwork/autocut-types` | AutoCut 前端领域类型 |
| `@sdkwork/autocut-services` | 共享 mock 数据、资产、消息、任务、工具和模拟进度服务 |
| `@sdkwork/autocut-home` | 首页工作入口 |
| `@sdkwork/autocut-tools` | 工具中心 |
| `@sdkwork/autocut-assets` | 本地资产视图和导入入口 |
| `@sdkwork/autocut-tasks` | 任务列表和任务详情 |
| `@sdkwork/autocut-messages` | 消息中心 |
| `@sdkwork/autocut-settings` | 设置中心 |
| `@sdkwork/autocut-slicer` | 智能切片工作台 |
| `@sdkwork/autocut-extractor-text` | 文档提取 |
| `@sdkwork/autocut-extractor-audio` | 视频提音 |
| `@sdkwork/autocut-video-gif` | 视频转 GIF |
| `@sdkwork/autocut-video-compress` | 视频压缩 |
| `@sdkwork/autocut-video-convert` | 视频格式转换 |
| `@sdkwork/autocut-video-enhance` | 视频高清化 |
| `@sdkwork/autocut-subtitle-translate` | 视频字幕翻译 |
| `@sdkwork/autocut-voice-translate` | 视频人声翻译 |

## 根目录边界

仓库根目录只负责 workspace 编排：

- `package.json` 定义统一命令和根级编排依赖；
- `pnpm-workspace.yaml` 定义 workspace 与 catalog；
- `tsconfig.json` 定义公共 TypeScript 基线；
- `scripts/` 保存治理脚本；
- `docs/` 保存当前标准文档；
- `DATABASE_SPEC.md` 保存数据库定义标准。

根目录不得保留应用运行入口：

- 不得有根 `src/`；
- 不得有根 `src-tauri/`；
- 不得有根 `index.html`；
- 不得有根 `vite.config.ts`；
- 不得有根 `public/`；
- 不得把根 `dist/` 当作源文件提交。

新增根级文件必须先进入架构标准和治理脚本，否则视为架构漂移。

## Desktop Package 边界

`packages/sdkwork-autocut-desktop` 是唯一桌面应用 package。

它可以包含：

- `src/App.tsx`：路由表、Provider 和 layout 组合；
- `src/main.tsx`：React bootstrap；
- `src/index.ts`：desktop package public export；
- `src/index.css`：唯一全局样式入口；
- `src/vite-env.d.ts`：Vite 类型声明；
- `index.html`：桌面 Web 入口；
- `vite.config.ts`：package-local Vite 配置；
- `public/`：桌面静态资源；
- `src-tauri/`：Tauri v2 配置与 Rust crate。

desktop package 根层只允许：

```text
dist/
index.html
node_modules/
package.json
public/
src/
src-tauri/
tsconfig.json
vite.config.ts
```

其中 `dist/` 和 `node_modules/` 是生成物或依赖目录，不得作为源文件提交。
`public/` 当前只允许 `favicon.svg`。新增桌面静态资源必须先进入标准和治理脚本。

它不得包含：

- AutoCut 业务 service；
- mock 数据；
- 任务、资产、消息处理规则；
- 可复用业务组件；
- 模型、FFmpeg、本地路径或 Host API 业务集成实现。

`App.tsx` 必须通过 `AUTOCUT_ROUTES` 统一声明根路由，并 lazy-load
`@sdkwork/autocut-*` 功能 package。新增功能入口时必须先进入路由表和
package 依赖声明。

## Package 边界

每个 package 必须满足：

- 目录名使用 `sdkwork-autocut-<module>`；
- manifest 名称使用 `@sdkwork/autocut-<module>`；
- manifest 版本必须与根 `package.json` 和 Tauri 应用版本一致；
- 内部依赖使用 `workspace:*`；
- public API 只能通过 `src/index.ts` 导出；
- package-local `tsconfig.json` 只检查本 package 的 `src`；
- `package.json` 提供 `build`、`typecheck`、`test` 脚本；
- `exports` 指向 `./src/index.ts`。

非 desktop package 的 `src/` 根层只允许保留 `index.ts`。页面、组件、
服务、类型、hooks 和状态文件必须进入对应子目录，避免根层堆积隐式业务逻辑。

依赖声明必须显式：

- import 其他 AutoCut package 时，当前 package 必须以 `workspace:*`
  声明依赖；
- desktop package 必须声明所有根路由直接装配的 AutoCut package；
- import `react`、`react-dom`、`react-router-dom`、`lucide-react`、
  `pixi.js` 等外部库时，当前 package 必须在 manifest 中声明直接依赖；
- package 源码不得通过 `@/` 根别名或 `../../` 形式跨 package 引用源码；
- TypeScript 和 Vite 只能暴露 `@sdkwork/autocut-*` 命名空间别名；
- 外部版本统一走 `pnpm-workspace.yaml` catalog。

业务 package 推荐结构：

```text
src/
  pages/
  components/
  service/
  types/
  hooks/
  store/
  index.ts
```

目录只在模块实际需要时创建；但拥有业务处理函数的模块必须使用
`src/service/`。

## Service 层规则

`service/` 负责：

- mock 数据；
- browser storage 适配；
- 任务、资产、消息增删改查；
- 进度模拟；
- 文件处理 workflow 编排；
- 默认值、错误和状态转换。

页面和组件只允许调用 service。页面可以保留 React 状态、表单状态、视觉行为
和用户交互绑定，但不得直接持有大型 mock 数据或跨模块复制业务流程。

共享底层写入函数不得直接从页面调用来拼装业务对象。例如资产页面只能把
`File` 交给 `importAssetFile` 这类 workflow 函数；资产 ID、资产类型推断、
Blob URL、时间戳和事件发布必须留在 `@sdkwork/autocut-services` 内部。

浏览器资源适配必须集中到 service helper：

- 页面不得直接 `new Blob(...)`；
- 页面不得直接 `URL.createObjectURL(...)`；
- 页面不得直接 `URL.revokeObjectURL(...)`；
- 页面不得手写 `document.createElement('a')` 下载锚点；
- 文本结果格式化、TXT 导出、通用 URL 下载和对象 URL 生命周期必须通过
  `download.service.ts`。

页面也不得直接调用浏览器全局交互 API，例如 `confirm(...)`、
`navigator.clipboard.writeText(...)` 或 `window.open(...)`。确认弹窗、剪贴板
写入和外部预览窗口必须通过 `browser.service.ts`。

业务 service 不得直接用 `Date.now()` 或 `new Date().toISOString()` 拼接任务、
资产、消息和诊断记录的 ID 或时间戳。实体 ID、当前时间戳和 mock 相对时间必须
通过 `identity.service.ts` 创建。

时间解析、毫秒转换、倒序排序和本地化展示必须集中到 `datetime.service.ts`。
页面、组件和业务 service 不得散落 `new Date(...)`、`Date.parse(...)`、
`.getTime()` 或 `.toLocaleString(...)` 来处理业务时间。

package 源码不得直接调用 `console.log`、`console.warn` 或 `console.error`。
运行时问题必须通过 AutoCut 诊断服务上报。

浏览器 key-value 存储必须集中到 `storage.service.ts`。页面、组件和其他 service
不得直接调用 `localStorage`、`sessionStorage`，也不得手写 `autocut_` 存储 key。
`runtime-environment.service.ts` 是运行环境命名空间事实来源，desktop 入口必须在
native host 和 AI SDK bridge 初始化前调用 `configureAutoCutRuntimeEnvironment`。
Vite 开发模式使用 `dev`，打包发布模式使用 `release`。所有浏览器持久化 key 必须
由 `createAutoCutStorageKey` 生成，并带运行环境前缀：开发设置使用
`autocut_dev_settings`，发布设置使用 `autocut_release_settings`；任务、资产和消息同样
使用 `autocut_dev_*` 或 `autocut_release_*`。LLM API Key 不得进入浏览器存储，
只能通过 Tauri 原生命令保存到系统密钥库；密钥名称也必须带运行环境前缀，开发使用
`dev-default`，发布使用 `release-default`。内存态 transient API Key 必须按运行环境
隔离，切换 dev/release 后不得复用另一个环境的 API Key 或模型配置。

远程 mock 媒体资源必须集中到 `media-fixtures.service.ts`。示例视频、音频、GIF
和缩略图 URL 不得散落在页面、业务 service 或 mock 数据中。

## AutoCut 事件契约

AutoCut 前端模块之间的任务、资产和消息刷新必须通过
`@sdkwork/autocut-services` 提供的统一事件契约完成：

- 事件名称只能由 `AUTOCUT_EVENTS` 定义；
- service 层发布事件必须使用 `dispatchAutoCutEvent`；
- 页面和组件监听事件必须使用 `listenAutoCutEvent`；
- 事件 payload 必须由 `AutoCutEventPayloadMap` 明确定义；
- `autocut-*` 字符串不得散落在其他文件中；
- 不得用 `(e: any)` 或 `as EventListener` 绕过事件 payload 类型。

## 领域类型一致性

`@sdkwork/autocut-types` 必须提供领域枚举的 canonical 常量。当前任务类型必须由
`AUTOCUT_TASK_TYPES` 定义，并通过
`export type TaskType = typeof AUTOCUT_TASK_TYPES[number]` 推导。

任务状态必须由 `AUTOCUT_TASK_STATUS` 定义，并通过 `TaskStatus` 推导。页面和
service 不得散落 `'pending'`、`'processing'`、`'completed'`、`'failed'` 这类
状态字符串。

任务列表图标映射和任务详情二次处理路由必须使用 `Record<TaskType, ...>`，保证
新增或改名任务类型时编译期暴露遗漏。

所有 package 源码不得使用裸 `any`、`@ts-ignore`、`@ts-expect-error`、
`eslint-disable`、`TODO` 或 `FIXME` 绕过类型系统和工程治理。
root `tsconfig.json` 必须启用 `strict`、`exactOptionalPropertyTypes`、
`noUncheckedIndexedAccess`、`noUnusedLocals` 和 `noUnusedParameters`。
任何未使用的 import、局部变量、函数参数或占位状态都必须在编译阶段失败；
任何可选字段传递和数组/索引访问都必须显式处理缺失边界，不能把死代码或
隐式 `undefined` 留到后续人工审查。

每个 package 的 `tsconfig.json` 必须继承根 `../../tsconfig.json`，不得在包内
重新定义或放宽 TypeScript 严格基线。非 desktop package 的 `include` 只能是
`src`，确保包级检查只覆盖自己的源码边界；desktop package 的 `tsconfig.json` 必须额外包含 `vite.config.ts`，确保 package-local Vite 配置与桌面入口一起接受
同一套严格类型检查。

package 源码不得使用 TypeScript 非空断言。所有 DOM 查询、可选字段、路由映射、
媒体 URL 和事件 payload 都必须通过局部变量、条件分支或显式错误处理完成类型收窄，
不得用 `value!` 绕过 `strict`、`exactOptionalPropertyTypes` 和
`noUncheckedIndexedAccess` 的边界检查。

## 视觉保护规则

标准化工作不得改变 `packages` 下页面的产品结构和视觉语言：

- 不重写页面布局；
- 不替换 Tailwind class；
- 不删除现有交互；
- 不把工作台改成 landing page；
- 只允许为架构分层修改 import/export 路径和 service/helper 边界。

## 数据库定义标准

根目录 `DATABASE_SPEC.md` 是当前应用的数据库定义事实来源，不能作为旧文件删除
或隐藏。当前 Tauri 桌面基线不提交运行时数据库表，也不恢复旧 `host/database`
或 `docs/database` 目录。

后续一旦引入本地 Host、SQLite、PostgreSQL、迁移脚本或 schema registry，必须
先遵循 `docs/architecture/17-autocut-database-contract-standard.md`。

数据库表设计的硬性底线：

- 每张表都必须定义 `id`；
- 每张表都必须定义 `uuid`；
- `id` 的逻辑类型必须是 `int64`，对应 Java/Rust/TypeScript 侧的 long/64 位
  整数语义；
- 新建表最低合规等级为 L1；
- 表名必须使用业务模块前缀；
- 不得使用 `autocut_`、`video_cut_`、`sdkwork_`、`plus_`、`app_`、`sys_`、
  `common_` 等产品、应用、组织或历史项目命名空间作为表名前缀。

## Tauri 桌面标准

Tauri 桌面壳只负责：

- 启动 Vite 前端；
- 打包 package-local `dist/`；
- 打开桌面窗口；
- 提供 CSP；
- 未来托管本地 Host 进程或 native capability 边界。

Tauri 壳不得实现 AutoCut 业务逻辑。

根命令必须代理到 desktop package：

```bash
pnpm tauri:before-dev
pnpm tauri:dev
pnpm tauri:build
```

desktop package 内命令必须从 `packages/sdkwork-autocut-desktop` 上下文执行：

```bash
pnpm --filter @sdkwork/autocut-desktop tauri:dev
pnpm --filter @sdkwork/autocut-desktop tauri:build
```

根 `package.json`、所有 `packages/*/package.json`、
`packages/sdkwork-autocut-desktop/src-tauri/tauri.conf.json` 和
`packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml` 必须使用同一应用版本。
当前新应用基线版本为 `0.1.0`。

Rust 桌面 crate 名称固定为 `sdkwork-video-cut-desktop`，edition 固定为 `2024`。
`index.html` 的 `<title>` 必须与 Tauri `productName` 保持一致。

本地 Web 开发服务必须绑定 `127.0.0.1:3000` 并使用 strict port。Tauri 开发 Web
服务必须绑定 `127.0.0.1:5173` 并使用 strict port。

浏览器包不得直接注入模型密钥或 AI Studio 运行时变量。任何模型、FFmpeg、本地
路径、鉴权或 Host 集成都必须由后续明确的 Tauri/Host service contract 承接。

Tauri 配置必须提供非空 CSP。默认策略至少要求 `default-src 'self'`，不得使用
通配 source。样式不得通过 `@import url(...)` 拉取远程 CSS 或 Google Fonts。

`packages/sdkwork-autocut-desktop/src-tauri/gen/` 是 Tauri 工具链生成目录，必须
被 `.gitignore` 忽略，不能作为手写架构源参与模块边界，也不得被 git 跟踪。

`src-tauri/` 根层只允许 `build.rs`、`Cargo.lock`、`Cargo.toml`、`gen/`、`icons/`、
`src/`、`target/` 和 `tauri.conf.json`。`icons/` 当前只允许 `icon.ico`；
`src-tauri/src/` 当前只允许薄启动文件 `main.rs`。

在明确 native host contract 前，Tauri crate 不得新增 `tauri-plugin-*`、`tokio`、
`reqwest`、`rusqlite`、`sqlx` 等原生插件、异步运行时、HTTP 或数据库依赖。
需要本地 Host、SQLite、FFmpeg、文件系统能力或网络能力时，必须先更新架构标准、
权限模型、数据库契约和治理脚本。

## 治理

`pnpm check:autocut-architecture` 是当前标准的可执行验收门。

它必须检查：

- package 命名、manifest 字段、`workspace:*` 内部依赖；
- desktop package 拥有 Tauri/Vite/HTML/static 入口；
- 根目录不保留应用入口；
- package-local `tsconfig.json`；
- service 层；
- root TypeScript include/exclude；
- 禁止旧 AI Studio、Node server、host、deploy、models 等遗留源树；
- 检查直接依赖声明和跨层 import 边界；
- 检查 package `src/` 根层只保留 public `index.ts`；
- 检查任务类型由 `AUTOCUT_TASK_TYPES` 统一声明；
- 检查任务状态由 `AUTOCUT_TASK_STATUS` 统一声明；
- 检查 AutoCut 事件由 `AUTOCUT_EVENTS`、`dispatchAutoCutEvent`、
  `listenAutoCutEvent` 和 `AutoCutEventPayloadMap` 统一声明；
- 检查 package 源码无直接 console、裸 `any`、类型抑制和临时标记；
- 检查 Blob/object URL/download/browser storage/datetime/diagnostics/media fixture
  都通过统一 service helper；
- 检查 runtime-environment.service.ts、autocut_dev_settings、
  autocut_release_settings、dev-default 和 release-default，确保开发与发布环境的
  设置、LLM 密钥和内存态 API Key 互相隔离；
- 检查 `DATABASE_SPEC.md` 和 AutoCut 数据库契约标准存在，并校验未来表定义必须
  有 `id`、`uuid`，且 `id` 使用 long/int64 语义；
- 检查 Tauri CSP、loopback devUrl、bundle 开关和 generated 目录忽略规则；
- 检查根路由由 `AUTOCUT_ROUTES` 统一声明并覆盖所有 AutoCut 产品模块。
