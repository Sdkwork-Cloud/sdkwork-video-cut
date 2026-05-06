# SDKWork Video Cut

SDKWork Video Cut is a Tauri desktop shell for the AutoCut frontend modules in
`packages/sdkwork-autocut-*`.

The desktop application is defined inside
`packages/sdkwork-autocut-desktop`, matching the package-local desktop
architecture used by `sdkwork-birdcoder`. The repository root only
orchestrates workspace commands.

Product design and visual implementation live under `packages/` and are
protected by `pnpm check:autocut-architecture`.

Desktop native builds use the package-local Rust toolchain pinned at
`packages/sdkwork-autocut-desktop/rust-toolchain.toml`. The current standard is
Rust `1.90.0` with the `x86_64-pc-windows-msvc` target.

## Development

```bash
pnpm install
pnpm dev
```

Default local web URL:

```text
http://127.0.0.1:3000/
```

Development and packaged release use isolated runtime configuration namespaces.
Browser settings written while developing are stored as `autocut_dev_settings`;
packaged release settings are stored as `autocut_release_settings`. LLM API keys
are not stored in browser storage: the native secret store uses `dev-default`
for development and `release-default` for packaged release, so testing a dev
model or key does not overwrite the installed app configuration.

Native media storage is task scoped. The workspace `outputDirectory` configured
in Settings is the desktop media output root. If it is blank or missing, the
native host uses the app data media root. The configured value is sent to native
commands as `outputRootDir` and must be an absolute directory path. Imported
source files are copied into `{outputRootDir}/inputs/`; generated files from
audio extraction, GIF generation, compression, conversion, enhancement, and
smoke tasks are written under `{outputRootDir}/tasks/{task_uuid}/outputs/`.
Native results expose `taskOutputDir`, and the persisted `media_artifact.uri`
must point to a file inside that directory. Native retry restores
`outputRootDir` from the source task `input_json` so retried task results remain
under the same configured output root.

Local speech-to-text is configured in Settings. The desktop app stores the
Whisper-compatible executable path, model path, and default language in the same
dev/release isolated settings namespace, and the Settings Center provides a
toolchain test button through the native probe command. Environment variables
`SDKWORK_AUTOCUT_WHISPER_EXECUTABLE` and `SDKWORK_AUTOCUT_WHISPER_MODEL` remain a
headless fallback. Automatic intelligent slicing uses local transcripts when the
settings-backed toolchain or environment-backed toolchain is ready; transcription
failures are diagnostic-only for slicing and the app falls back to non-transcript
planning without generating fake speech text.

## Desktop Commands

```bash
pnpm tauri:dev
pnpm tauri:build
```

## FFmpeg Sidecar

The default repository state does not bundle a real FFmpeg binary. This is
intentional: `ffmpegBundledReady` and `ffmpegExecutionReady` must stay false
until an approved sidecar and release smoke evidence exist.

To register an approved sidecar, use the package-local preparation command:

```bash
git lfs install
pnpm prepare:ffmpeg-sidecar -- --platform windows-x86_64 --source D:/tools/ffmpeg.exe --accept-license
```

The command copies the binary into
`packages/sdkwork-autocut-desktop/src-tauri/binaries/<platform>/` and rewrites
`ffmpeg.toolchain.json` with the exact `sha256`, `byteSize`, and
`bundledReady` value. Approved FFmpeg sidecar binaries are tracked through Git
LFS by `.gitattributes`; keep the manifest and `.gitkeep` placeholders as
normal text Git objects.

Unsigned preview release preflight:

```bash
pnpm release:smoke-preflight -- --platform windows-x86_64 --skip-executable-smoke
pnpm release:smoke-preflight -- --platform windows-x86_64 --require-bundled
pnpm release:native-smoke -- --run-real-llm-secret-smoke
pnpm release:smart-slice-sample
pnpm release:smart-slice-task -- --task artifacts/smart-slice/smart-slice-task.json
pnpm release:smart-slice-quality -- --task artifacts/smart-slice/smart-slice-task.json
pnpm release:smart-slice-media-artifacts -- --task artifacts/smart-slice/smart-slice-task.json
pnpm release:installer-signature
pnpm release:evidence -- --platform windows-x86_64
pnpm release:preview-ready
```

Formal commercial release adds installer signing:

```bash
pnpm release:sign-installers -- --cert-pfx D:/secure/sdkwork-autocut-release.pfx --cert-password <password>
pnpm release:installer-signature
pnpm release:evidence -- --platform windows-x86_64
pnpm release:commercial-ready
```

Use `--require-bundled` only when the release is expected to ship an approved
sidecar. Without a sidecar, the preflight remains useful and reports the honest
non-bundled state. `pnpm release:native-smoke` writes the ignored native command
smoke evidence for `autocut_host_capabilities`, `autocut_ffmpeg_probe`,
`autocut_audio_smoke`, `autocut_slice_video`, and
`autocut_recover_native_tasks` by running the pinned Rust smoke suite plus the
exact
`media_runtime::tests::video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir`
test. The video slice smoke must emit `autocut-video-slice-smoke=passed`, which
proves real FFmpeg slicing, task-scoped video artifacts, thumbnails, task output
JSON, and database stage completion before release evidence can mark native
video slicing ready. The LLM secret command evidence requires the real Windows
Credential Manager smoke: run
`pnpm release:native-smoke -- --run-real-llm-secret-smoke`, or set
`SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE=true`, before commercial release
evidence. Native smoke uses isolated temporary `CARGO_TARGET_DIR` values named
`sdkwork-autocut-native-smoke-target-rust-*` and
`sdkwork-autocut-native-smoke-target-video-slice-*`, plus
`sdkwork-autocut-native-smoke-target-llm-secret-*`, so it can run beside normal
Cargo tests or Tauri packaging without locking package-local `src-tauri/target`
or reusing the same Windows test executable path.
`pnpm release:smart-slice-sample` generates a real FFmpeg-backed local sample
under ignored `artifacts/smart-slice-media/`, writes
`artifacts/smart-slice/smart-slice-task.json`, then produces the smart slice
quality, media artifact, and sample evidence files used by the aggregate release
gate. It is the repeatable release evidence path when no private exported task
JSON is being attached to the release review.
`pnpm release:sign-installers` runs Authenticode signing for the MSI and NSIS
installer with a real signing source. Use either
`SDKWORK_AUTOCUT_WINDOWS_SIGNING_PFX` plus
`SDKWORK_AUTOCUT_WINDOWS_SIGNING_PASSWORD`, or
`SDKWORK_AUTOCUT_WINDOWS_SIGNING_THUMBPRINT` for a certificate already installed
in the Windows certificate store. `SDKWORK_AUTOCUT_SIGNTOOL_PATH` can point to a
specific `signtool.exe`, and `SDKWORK_AUTOCUT_WINDOWS_SIGNING_TIMESTAMP_URL`
overrides the default timestamp authority. The command fails closed when the
certificate or signing tool is absent.
`pnpm release:installer-signature` writes the ignored MSI/NSIS code-signing
evidence. `pnpm release:evidence` writes structured JSON under
`artifacts/release/` with installer digests, FFmpeg manifest state, preflight
state, native smoke evidence, smart slice quality/media evidence, installer
signature evidence, and the explicit `ffmpegExecutionReady` boundary.
`pnpm release:preview-ready` is the GitHub/internal unsigned preview gate: it
requires bundled FFmpeg execution, real native video slicing smoke, smart slice
quality/media evidence, aggregate release smoke, and MSI/NSIS installer
artifacts, but it allows unsigned installers with an explicit warning. Use this
only when the release notes call the build an unsigned preview.
`pnpm release:commercial-ready` is the final hard gate: it must stay blocked
until bundled FFmpeg integrity, executable smoke, native smoke, smart slice
quality/media evidence, installer signature, and execution readiness are all
true.

## Cleanup

```bash
pnpm clean
```

This removes generated output only: root `dist`, `artifacts/runtime`, desktop
package `dist`, and desktop Tauri `target`/`gen`.

## Quality Gates

```bash
pnpm check:autocut-architecture
node scripts/ensure-autocut-tauri-rust-toolchain.test.mjs
node scripts/prepare-autocut-ffmpeg-sidecar.test.mjs
node scripts/check-autocut-release-smoke-preflight.test.mjs
node scripts/write-autocut-native-release-smoke.test.mjs
node scripts/sign-autocut-release-installers.test.mjs
node scripts/write-autocut-installer-signature-evidence.test.mjs
node scripts/write-autocut-smart-slice-sample-evidence.test.mjs
node scripts/write-autocut-release-evidence.test.mjs
node scripts/check-autocut-preview-release-readiness.test.mjs
node scripts/check-autocut-commercial-release-readiness.test.mjs
pnpm release:smoke-preflight -- --platform windows-x86_64 --skip-executable-smoke
pnpm release:native-smoke -- --run-real-llm-secret-smoke
pnpm release:smart-slice-sample
pnpm release:installer-signature
pnpm release:evidence -- --platform windows-x86_64
pnpm release:preview-ready
pnpm release:sign-installers -- --cert-thumbprint <thumbprint>
pnpm release:installer-signature
pnpm release:evidence -- --platform windows-x86_64
pnpm release:commercial-ready
pnpm typecheck
pnpm test
pnpm build
cargo +1.90.0 check --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml
pnpm tauri:build
```

`pnpm test` runs the Rust toolchain guard contract before workspace package
tests, so the desktop build preflight remains covered even when native package
builds are not executed.

Architecture and module standards are documented in
`ARCHITECT.md` and
`docs/architecture/16-autocut-frontend-module-standard.md`.
