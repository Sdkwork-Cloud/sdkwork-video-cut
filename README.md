# SDKWork Video Cut

SDKWork Video Cut is a Tauri desktop shell for the AutoCut frontend modules in
`packages/sdkwork-autocut-*`.

## License

This project is source-available for non-commercial use under the repository
`LICENSE` notice, which applies `AGPL-3.0-or-later` terms with an explicit
non-commercial limitation. Commercial use is not permitted unless you purchase
or obtain a separate commercial license from SDKWork.

Commercial use includes production use by a company or revenue-generating
organization, SaaS or hosted service use, customer projects, paid consulting
deliverables, proprietary redistribution, closed-source integration, and any
other use intended to obtain commercial advantage or monetary compensation.

See `LICENSE` for the repository license notice and `COMMERCIAL-LICENSE.md`
for commercial authorization requirements.

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
smoke tasks are written under `{outputRootDir}/tasks/{task_uuid}/`.
Native results expose `taskOutputDir`, and the persisted `media_artifact.uri`
must point to a file inside that directory. Native retry restores
`outputRootDir` from the source task `input_json` so retried task results remain
under the same configured output root.

Local speech-to-text is configured in Settings and is required for Smart Slice.
The desktop app stores the Whisper-compatible executable path, model path, and
default language in the same dev/release isolated settings namespace, and the
Settings Center provides a toolchain test button through the native probe
command. Environment variables `SDKWORK_AUTOCUT_WHISPER_EXECUTABLE` and
`SDKWORK_AUTOCUT_WHISPER_MODEL` remain a headless fallback. Smart Slice fails
closed until local STT is ready; it must not generate fake transcript text or
render clips without verified transcript evidence.

The recommended model is downloaded by the desktop host into
`{outputRootDir}/models/speech/` when Settings `outputDirectory` is configured,
or into the app data media root when it is blank. The Whisper executable is
resolved from a verified bundled sidecar, `SDKWORK_AUTOCUT_WHISPER_EXECUTABLE`,
or a user-selected absolute Settings path. The app never writes a guessed
executable path into settings.

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

## Speech-to-Text Sidecar

The default repository state may omit the real `whisper-cli` binary. In that
case `speech-transcription.toolchain.json` must keep `bundledReady=false` and
placeholder zero integrity must not be treated as a usable sidecar.

To register an approved local STT sidecar, use:

```bash
git lfs install
pnpm prepare:speech-sidecar -- --platform windows-x86_64 --source D:/tools/whisper-cli.exe --accept-license
pnpm prepare:speech-sidecar -- --platform windows-x86_64 --check --require-bundled
```

The command copies `whisper-cli` into
`packages/sdkwork-autocut-desktop/src-tauri/binaries/<platform>/`, copies
required sibling runtime libraries such as Windows `*.dll`, Linux `*.so`, and
macOS `*.dylib` companion files from the same source directory, and rewrites
`speech-transcription.toolchain.json` with exact `sha256`, `byteSize`,
`companionFiles`, and `bundledReady` values. `pnpm tauri:build` runs the same
`prepare:speech-sidecar -- --check --require-bundled` gate before creating an
installer, so desktop packages cannot silently ship without a verified
`whisper-cli` sidecar and its runtime companions. Release preflight with
`--require-bundled` requires both the FFmpeg sidecar and the speech-to-text
sidecar.

Whisper model files are not bundled into installers because the recommended
offline model is hundreds of MiB. The app downloads the selected model into the
per-user AutoCut media root on first initialization, tries the official
Hugging Face URL first, and may fall back only to vetted Hugging Face mirror
URLs declared by the model preset. Native download validation rejects HTTP,
unknown hosts, URLs whose file name or `ggerganov/whisper.cpp` path does not
match the registered preset, and downloaded bytes whose SHA-256 digest differs
from the pinned model preset digest.

Phase 1 multiplatform preview release standard:

```bash
pnpm release:smoke-preflight -- --platform windows-x86_64 --require-bundled
pnpm release:smoke-preflight -- --platform linux-x86_64 --require-bundled
pnpm release:smoke-preflight -- --platform macos-x86_64 --require-bundled
pnpm release:smoke-preflight -- --platform macos-aarch64 --require-bundled
pnpm release:multiplatform-ready
```

The GitHub workflow `.github/workflows/autocut-desktop-release.yml` builds the
desktop app on native hosted runners: `windows-latest`, `ubuntu-22.04`, and
`macos-latest` for both `x86_64-apple-darwin` and `aarch64-apple-darwin`.
Before each native package build, the workflow prepares platform sidecars:
Windows re-verifies the approved Git LFS FFmpeg and `whisper-cli` resources,
and Linux/macOS run `pnpm prepare:release-sidecars` to fetch or build the
approved platform-native FFmpeg and Whisper CLI tools, then write the same
integrity manifests used by local packaging.
Each runner writes a platform release evidence file under `artifacts/release/`:
`autocut-release-evidence-windows-x86_64.json`,
`autocut-release-evidence-linux-x86_64.json`,
`autocut-release-evidence-macos-x86_64.json`, and
`autocut-release-evidence-macos-aarch64.json`. The aggregate
`pnpm release:multiplatform-ready` gate requires all four evidence files, real
bundled FFmpeg integrity/executable smoke, native video slicing smoke, smart
slice quality/media evidence, and the expected installer kinds:
Windows MSI/NSIS, Linux DEB/AppImage, and macOS DMG/app archive. Unsigned
installers are allowed only as explicit preview warnings.

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
`pnpm release:multiplatform-ready` is the Phase 1 aggregate preview gate for
Windows, Linux/Ubuntu, macOS Intel, and macOS Apple Silicon. It accepts unsigned
preview installers only when every platform has complete runtime and installer
artifact evidence. Phase 2 is the formal commercial gate: macOS must add
Developer ID signing, `spctl` assessment, and notarization evidence; Windows
must add Authenticode signing; Linux must add package signing policy and
`.deb`/`.AppImage` install smoke. `pnpm release:commercial-ready` is the
default four-platform commercial gate and reads
`autocut-release-evidence-<platform>.json` files from `artifacts/release/`.
Use `node scripts/check-autocut-commercial-release-readiness.mjs -- --evidence
artifacts/release/autocut-release-evidence-windows-x86_64.json` only to diagnose
one platform. The default gate must stay blocked until bundled FFmpeg integrity,
executable smoke, native smoke, smart slice quality/media evidence, platform
installer artifacts with real byte sizes and SHA-256 digests, platform
signing/notarization, installer signature, and execution readiness are all true
on every platform.
`pnpm release:app-manifest-ready` validates `sdkwork.app.config.json` before
publication. Inactive preview manifests may keep planned GitHub Release
packages disabled without checksums only when each disabled package records the
commercial activation evidence still required. Active commercial manifests must
enable at least one package, and every enabled package must have a real
SHA-256 checksum, verified platform trust evidence, and CycloneDX or SPDX SBOM
metadata. The upstream SDKWork v3 manifest validator remains a final post-asset
gate because it requires checksums whenever `checksumRequired=true`; do not add
fake checksums before real assets exist.
`pnpm release:package-sbom` writes deterministic per-package CycloneDX JSON
files under `artifacts/release/sbom/` from the current workspace package
manifests, `pnpm-lock.yaml`, desktop `Cargo.toml`, and desktop `Cargo.lock`.
Use `--platform <platform>` in native release jobs so each runner uploads only
the SBOM files for the packages it built. The command fails closed when a
runtime npm dependency cannot be resolved from the lockfile; unresolved versions
must never enter a release SBOM.
`pnpm release:sbom-evidence` turns the actual per-package SBOM files under
`artifacts/release/sbom/` into `artifacts/release/autocut-sbom-evidence.json`.
Each desktop release package must have exactly one CycloneDX JSON
(`*.cdx.json` or `*.cyclonedx.json`) or SPDX JSON (`*.spdx.json`) file named
after the package id, for example `desktop-windows-msi.cdx.json` or
`desktop-linux-deb.spdx.json`. The command computes byte size and SHA-256 from
the file contents and fails closed for missing, empty, invalid, unknown, or
duplicate SBOM files. Use `--release-tag <tag>` to bind the evidence URLs to the
GitHub Release tag; unsigned preview CI may add `--allow-blocked` to publish the
blocker report without inventing SBOM data.
`pnpm release:sync-app-manifest` is the automated bridge from release evidence
to app manifest metadata. It reads
`artifacts/release/autocut-release-evidence-<platform>.json` and
`artifacts/release/autocut-sbom-evidence.json`, then writes package
`checksum`, `checksumAlgorithm`, `sizeBytes`, `metadata.trustEvidence`, and
`metadata.sbom` only when every desktop package has complete release, platform
trust, and SBOM evidence. Use `--dry-run --allow-blocked` in unsigned preview
CI jobs so the workflow publishes a commercial-activation blocker report without
failing the preview release. Use `--activate-commercial` only after the real
release assets, signatures, notarization or Linux trust evidence, and SBOM
files are uploaded and verified.
`pnpm release:evidence-status -- --release-tag <tag>` is the aggregate release
status gate for human and CI diagnostics. It does not create evidence; it
combines the release environment probe, four-platform release evidence,
SBOM evidence, app manifest sync dry run, app manifest readiness,
multiplatform preview readiness, and commercial readiness into one
machine-readable blocker report with recommended next commands. Use
`--allow-blocked --json` only when publishing preview blocker evidence to a
GitHub Release. A commercial release must run the same command without
`--allow-blocked` before tagging or uploading final assets.

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
node scripts/write-autocut-package-sbom-files.test.mjs
node scripts/write-autocut-sbom-evidence.test.mjs
node scripts/sync-autocut-app-manifest-release-evidence.test.mjs
node scripts/check-autocut-app-manifest-release-readiness.test.mjs
node scripts/check-autocut-preview-release-readiness.test.mjs
node scripts/check-autocut-multiplatform-release-readiness.test.mjs
node scripts/check-autocut-release-workflow.test.mjs
node scripts/check-autocut-release-evidence-status.test.mjs
node scripts/check-autocut-commercial-release-readiness.test.mjs
pnpm release:smoke-preflight -- --platform windows-x86_64 --skip-executable-smoke
pnpm release:native-smoke -- --run-real-llm-secret-smoke
pnpm release:smart-slice-sample
pnpm release:installer-signature
pnpm release:evidence -- --platform windows-x86_64
pnpm release:package-sbom -- --platform windows-x86_64
pnpm release:sbom-evidence -- --release-tag v0.1.1 --allow-blocked
pnpm release:sync-app-manifest -- --dry-run --allow-blocked
pnpm release:app-manifest-ready
pnpm release:evidence-status -- --release-tag v0.1.1 --allow-blocked --json
pnpm release:preview-ready
pnpm release:multiplatform-ready
pnpm release:sign-installers -- --cert-thumbprint <thumbprint>
pnpm release:installer-signature
pnpm release:evidence -- --platform windows-x86_64 --output artifacts/release/autocut-release-evidence-windows-x86_64.json
pnpm release:evidence -- --platform linux-x86_64 --output artifacts/release/autocut-release-evidence-linux-x86_64.json
pnpm release:evidence -- --platform macos-x86_64 --output artifacts/release/autocut-release-evidence-macos-x86_64.json
pnpm release:evidence -- --platform macos-aarch64 --output artifacts/release/autocut-release-evidence-macos-aarch64.json
pnpm release:package-sbom
pnpm release:sbom-evidence -- --release-tag v0.1.1
pnpm release:sync-app-manifest -- --activate-commercial
pnpm release:evidence-status -- --release-tag v0.1.1
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

## SDKWork Documentation Contract

Domain: content
Capability: video
Package type: app
Status: INACTIVE

### Public API

Public exports are declared in `specs/component.spec.json` under `contracts.publicExports`.

### Required SDK Surface

- None declared in `specs/component.spec.json`.

### Configuration

Configuration keys and runtime entrypoints are declared in `specs/component.spec.json`.

### SaaS/Private/Local Behavior

This module follows the canonical standards linked from `specs/component.spec.json`, including deployment and runtime configuration rules where applicable.

### Security

Do not add secrets, live tokens, manual auth headers, or app-local credential handling to this module.

### Extension Points

Extension points are limited to declared public exports, runtime entrypoints, SDK clients, events, and config keys.

### Verification

- `pnpm --filter @sdkwork/video-cut typecheck`

### Owner And Status

Owner and lifecycle status are tracked in `specs/component.spec.json`.
