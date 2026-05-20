# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SDKWork Video Cut is a **Tauri v2 desktop application** for AI-powered video processing (smart slicing, transcription, compression, GIF generation, format conversion, enhancement, dedup). The frontend is a React SPA (TypeScript, Vite, Tailwind CSS v4, React Router v7, Pixi.js, Lucide icons) and the native backend is Rust with SQLite (via rusqlite). LLM integration uses the Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`). i18n via `react-i18next`.

The root is only a **workspace orchestrator**. All product code lives under `packages/`.

## Workspace Commands

```bash
pnpm install              # install dependencies (pnpm v10)
pnpm dev                  # dev server at http://127.0.0.1:3000
pnpm build                # typecheck all packages, then build desktop
pnpm clean                # remove generated output (dist, artifacts, target)
pnpm typecheck            # workspace-wide TypeScript check
pnpm test                 # full test suite (architecture checks + feature workflows + service behavior)
pnpm lint                 # architecture check + typecheck
pnpm tauri:dev            # launch Tauri desktop dev mode
pnpm tauri:build          # production Tauri build
pnpm check:autocut-architecture   # architecture constraint enforcement script
```

Key per-package scripts (run via `pnpm --filter @sdkwork/autocut-<pkg>`):
- All packages: `build`, `typecheck`, `test` — all map to `tsc --noEmit`
- Desktop: `dev`, `dev:tauri-web`, `preview`, `tauri:before-dev`, `tauri:dev`, `tauri:build`

## Architecture

### Package Layout (22 packages)

```
packages/
  sdkwork-autocut-desktop/      # Tauri shell: React entry, vite config, Rust backend
  sdkwork-autocut-types/        # Shared TypeScript interfaces (setting models, task models, etc.)
  sdkwork-autocut-core/         # App layout, shared UI components
  sdkwork-autocut-commons/      # Common utilities (ToastProvider, etc.)
  sdkwork-autocut-services/     # Service layer: LLM bridge, native host client, tasks, settings, i18n, STT
  sdkwork-autocut-slicer/       # Smart video slicing UI + clip workflow + slice planner
  sdkwork-autocut-smart-cut-engine/  # AI-driven cut engine: pipeline, filters, content units, speakers, evidence
  sdkwork-autocut-tasks/        # Task list + detail pages
  sdkwork-autocut-home/         # Home page
  sdkwork-autocut-settings/     # Settings page
  sdkwork-autocut-tools/        # Tools page
  sdkwork-autocut-assets/       # Asset library
  sdkwork-autocut-messages/     # Messages/inbox
  sdkwork-autocut-extractor-audio/    # Audio extraction page
  sdkwork-autocut-extractor-text/     # Text extraction page
  sdkwork-autocut-video-compress/     # Video compression
  sdkwork-autocut-video-convert/      # Video format conversion
  sdkwork-autocut-video-enhance/      # Video enhancement
  sdkwork-autocut-video-dedup/        # Video deduplication
  sdkwork-autocut-video-gif/          # GIF generation
  sdkwork-autocut-subtitle-translate/ # Subtitle translation
  sdkwork-autocut-voice-translate/    # Voice/dub translation
```

### Desktop Shell (Tauri v2)

- **Frontend entry**: `packages/sdkwork-autocut-desktop/src/main.tsx` — bootstraps React with i18n, native host client, Vercel AI SDK bridge, smart slice handlers
- **Routing**: `App.tsx` defines all routes via React Router. Each route maps to a `lazyPage()` import from a feature package.
- **Vite config**: `packages/sdkwork-autocut-desktop/vite.config.ts` — custom `manualChunks` splitting each `@sdkwork/autocut-*` feature into its own chunk, plus react/pixi/ai/tauri vendor chunks
- **Rust backend** (`src-tauri/src/`):
  - `main.rs` — Tauri builder with 40+ IPC command handlers
  - `commands.rs` — All `#[tauri::command]` functions (FFmpeg probe, media import, STT, slicing, LLM HTTP, secret management)
  - `media_runtime.rs` — Core media processing runtime: `Command` invocation of FFmpeg/whisper-cli, file management, task lifecycle, SQLite persistence, video slicing, audio extraction, fingerprinting
  - `database_runtime.rs` — SQLite migration runner
  - `database_contract.rs` — Database schema contract (table definitions, column types)
  - `host_contract.rs` — Host capabilities contract (reports what commands are ready)
  - `llm_http_runtime.rs` — LLM HTTP proxy runtime
  - `llm_secret_runtime.rs` — Credential manager integration (keyring)

### Architecture Rules (enforced by `check-autocut-architecture.mjs`)

- Root must not have `src/`, `src-tauri/`, `index.html`, `vite.config.ts`, or `public/`
- All product code lives under `packages/`
- Desktop entry points (`index.html`, `vite.config.ts`, Tauri config) are package-local
- Generated output cleanup must go through `scripts/clean-autocut-generated.mjs`
- Database definitions are governed by `DATABASE_SPEC.md`

### Service Layer (`@sdkwork/autocut-services`)

Key services:
- `native-host-client.service.ts` — Typed IPC bridge to Tauri Rust commands
- `tasks.service.ts` — Task CRUD, progress events, native task lifecycle
- `settings.service.ts` — Dev/release isolated settings (localStorage namespaced by env)
- `speech-transcription.service.ts` — STT probe, model download, transcription orchestration
- `llm.service.ts` — LLM configuration and interaction
- `vercel-ai-sdk-bridge.service.ts` — Vercel AI SDK provider bridge
- `i18n.service.ts` / `i18n-resources.service.ts` — Internationalization
- `events.service.ts` — Event bus

### Smart Cut Engine (`@sdkwork/autocut-smart-cut-engine`)

Modular engine under `src/engine/`:
- `pipeline.ts` — Main orchestration pipeline
- `domain.ts` — Domain model types
- `strategy.ts` — Cut strategy definitions
- `filters.ts`, `filter-plan.ts`, `filter-effects.ts` — Content filtering
- `candidate-selection.ts` — Clip candidate selection
- `content-units.ts`, `content-unit-evidence-link.ts` — Content unit modeling
- `semantic-boundary.ts` — Semantic boundary detection
- `speech-semantic.ts` — Speech semantic analysis
- `speaker.ts`, `speaker-alignment.ts`, `speaker-corrections.ts` — Speaker diarization
- `execution-package.ts` — Execution package for rendering
- `render-contract.ts`, `render-artifacts.ts` — Rendering contract and artifacts
- `evidence-quality.ts` — Evidence quality assessment
- `llm-review.ts` — LLM-based review
- `audit-trace.ts` — Audit trail
- `native-contract.ts` — Native command contract mapping
- `validators.ts` — Schema validators
- `presets.ts`, `slicers.ts`, `report.ts` — Presets, slicer types, reporting
- `speech-first-orchestration.ts`, `visual-scene-orchestration.ts` — Orchestration variants
- `registry-validation.ts` — Registry/plugin validation

### Slicer (`@sdkwork/autocut-slicer`)

- `slicerService.ts` — Main slicer service
- `slicePlanner.ts` — Slice planning logic
- `clipWorkflow.ts` — Clip workflow orchestration
- `smartCutEnginePlanner.ts` — Smart cut engine integration planner
- `smart-slice-timeline/` — Timeline UI components

### Testing Strategy

Testing is done through **architecture-constraint scripts** (`scripts/check-*.mjs`) rather than a traditional test framework. These scripts act as both linters and integration tests:
- `check-autocut-architecture.mjs` — Enforces workspace structure rules
- `check-autocut-service-behavior.mjs` — Service contract verification
- `check-autocut-feature-workflows.mjs` — Feature workflow validation
- `check-autocut-slicer-planner.mjs` — Slicer planner correctness
- `check-smart-cut-engine-*.mjs` — Per-module engine validation
- Various `*.test.mjs` scripts — Unit tests for scripts

Run individual checks:
```bash
node scripts/check-autocut-architecture.mjs
node scripts/check-autocut-service-behavior.mjs
node scripts/check-smart-cut-engine-standard.mjs
```

### Release Process

Release has multiple gates: preflight → native smoke → smart slice sample → evidence → package SBOM → app manifest sync → readiness gates (preview → multiplatform → commercial). Each gate creates evidence JSON under `artifacts/release/`.

### Key Technical Details

- **Package manager**: pnpm v10 with catalog dependencies (see `pnpm-workspace.yaml` for catalog entries)
- **TypeScript**: `~5.8.2`, all packages are `"type": "module"` with `exports` pointing to `src/index.ts`
- **Rust toolchain**: Pinned in `packages/sdkwork-autocut-desktop/rust-toolchain.toml` (currently `1.90.0`, `x86_64-pc-windows-msvc` target)
- **Database**: SQLite via rusqlite, schema in `src-tauri/database/schema/sqlite/`, registry in `src-tauri/database/schema-registry/`
- **FFmpeg**: Bundled as opt-in sidecar via `prepare-autocut-ffmpeg-sidecar.mjs`
- **Speech-to-text**: Whisper-compatible `whisper-cli` binary as sidecar, model downloaded at runtime
- **LLM secrets**: Stored via OS keyring (Windows Credential Manager), never in localStorage
- **Runtime env isolation**: `dev` vs `release` namespaces for settings, secrets, and media storage
- **CSP**: Strict CSP in `tauri.conf.json` allowing only `self`, asset protocol, and dev websocket
- **Config file**: `sdkwork.app.config.json` at root (v3 schema, SDKWork app manifest)
