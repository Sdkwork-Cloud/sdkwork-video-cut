# sdkwork-video-cut Architecture Entry

`sdkwork-video-cut` 的正式架构标准入口是：

- `docs/architecture/00-architecture-map.md`

产品和视觉设计标准入口是：

- `docs/product/00-product-map.md`
- `docs/design/00-design-map.md`

本项目参考 Magic Studio V2 的架构边界思想，但不是 Magic Studio/MagicCut 子模块，也不依赖 `spring-ai-plus-ai-api` 或 `spring-ai-plus-app-api`。下方 Magic Studio V2 内容仅作为参考标准背景；如果与 `docs/architecture/*` 冲突，以 `docs/architecture/00-architecture-map.md` 的 authority order 为准。

# Magic Studio V2 Architecture Standard

## Status

This file is the root architecture summary for Magic Studio V2 as of 2026-04-23.

If documents disagree, follow them in this order:

1. `docs/magic-studio-unified-host-api-standard.md`
2. `docs/magic-studio-api-route-catalog.md`
3. `docs/standards/magic-studio-package-standard.md`
4. `docs/standards/magic-studio-authority-matrix.md`
5. `docs/standards/magic-studio-rust-server-api-standard.md`
6. `docs/tauri-rust-framework-architecture.md`
7. `docs/platform-runtime-capability-matrix.md`
8. `docs/local-media-toolkit-architecture.md`

## Non-Negotiable Decisions

1. Magic Studio has exactly one business capability kernel:
   - `packages/sdkwork-magic-studio-server/src-host`
2. That kernel is delivered in exactly two host modes:
   - standalone server deployment
   - embedded desktop delivery started by `src-tauri`
3. `src-tauri` is a shell-only host layer, not a second backend.
4. `packages/` is the canonical shared implementation area.
5. Magic Studio package identity is product-specific:
   - directory: `sdkwork-magic-studio-*`
   - manifest name: `@sdkwork/magic-studio-*`
6. Private workspace packages use source-entry manifests.
7. Root `tsconfig.json` is the only canonical alias authority for Magic Studio packages.
8. `tsconfig.npm-sdk.json` and `tsconfig.git-sdk.json` are projection files and must mirror the canonical `magic-studio-types` alias surface.

## Runtime Model

Public runtime kinds:

- `web`
- `server`
- `desktop`

Host families:

- browser-hosted
  - `web`
  - `server`
- desktop shell
  - `desktop`

Rules:

- frontend business flows target canonical Rust HTTP APIs or package/runtime facades
- feature packages do not import `@tauri-apps/*` for business behavior
- business flows do not use custom Tauri invoke commands as a parallel backend
- shared storage, asset resolution, and runtime classification come from canonical shared packages

## Canonical API Snapshot

Current canonical server contract totals:

- `core`: 39 routes
- `app`: 366 routes
- `admin`: 23 routes
- total: 428 routes

Current `app` route family breakdown:

- `assets`: 9 routes
- `auth`: 12 routes
- `capabilities`: 3 routes
- `chat`: 7 routes
- `creation`: 29 routes
- `drive`: 14 routes
- `film`: 77 routes
- `magiccut`: 19 routes
- `generation/images`: 6 routes
- `generation/videos`: 8 routes
- `generation/audio`: 4 routes
- `generation/catalog`: 4 routes
- `generation/music`: 5 routes
- `generation/sfx`: 5 routes
- `generation/characters`: 4 routes
- `generation/tasks`: 4 routes
- `notes`: 16 routes
- `presentations`: 7 routes
- `notifications`: 6 routes
- `portal`: 10 routes
- `plugins`: 1 route
- `prompt`: 1 route
- `settings`: 2 routes
- `trade`: 22 routes
- `user`: 29 routes
- `vip`: 5 routes
- `voices`: 20 routes
- `workspaces`: 37 routes

Current business ownership in the Rust host already includes:

- architecture and execution capability discovery plus creation capability discovery, canonical generation catalog read models, and canonical cross-family generation task governance
- auth/session foundation
- current-user center foundation plus canonical session/device/two-factor security governance
- settings and notifications
- canonical creation batch orchestration and materialization, canonical creation preset lifecycle, canonical creation template lifecycle, canonical creation session handoff, and cross-media creation history
- workspaces/projects plus recent-project discovery, durable open activity, filesystem-backed duplication, archive/restore lifecycle, canonical project-session roaming, canonical project git sync governance with sync-history reads, latest-sync reads, canonical retry lineage, canonical project release packaging, latest-release reads, release soft-delete/restore retention governance, release retention statistics, bounded release pruning, release retention-policy configuration and apply orchestration, release manifest inspection, immutable rebuild orchestration with release lineage, and project release artifact download
- assets and drive
- film project lifecycle plus canonical preset catalog/create/apply, reusable template lifecycle/instantiation, project-owned template snapshot creation, asset inventory, publish history/detail/artifact access, project-level review queue discovery, project-level review portfolio dashboards, project-level reviewer-capacity forecasting, project-level decision-freshness analytics, project-level governance-drift supervision, project-level escalation forecasting, project-level review dependency-graph projection, project-level review intervention planning, project-level review recovery orchestration, project-level approval burn-down supervision, project-level intervention outcome supervision, project-level effectiveness baselining, project-level intervention execution history, typed publish review-state query, host-derived publish review timeline and review-round projections, canonical publish review anchors, canonical publish review activity, canonical publish review decision matrix, canonical publish review readiness, canonical reviewer coverage projections, canonical reviewer backlog and SLA projections, canonical reviewer attention projections, canonical stale-decision and drift projections, canonical anchor responsibility projections, canonical reviewer worklist projections, canonical review-operations dashboard snapshots, canonical review latency and throughput analytics, canonical publish review assignments, explicit publish review submit/resubmit workflow, explicit reviewer-consensus governance, threaded publish review comments, comment resolution, publish approval/request-changes/reopen governance, publish restoration plus publish deletion, asset relink, storyboard publish bundles, script standardization, prepare-analysis orchestration, refresh-analysis orchestration, rebuild-storyboard orchestration, persistent scene-breakdown pre-production planning, persistent shot-variant planning, persistent shooting-plan derivation, script/character/prop analysis, project-graph reads, validation, batch authoring, storyboard generation, shot synchronization, asset binding, import/package ingest, and export packaging
- magiccut project lifecycle, template lifecycle, template update, duplication, template instantiation, render capability discovery, render jobs, artifact access, and honest audio-only export execution
- notes
- chat session metadata lifecycle plus transcript persistence with canonical `chat` app APIs; provider streaming intentionally remains frontend-owned until the Rust kernel owns moderation, attachment resolution, model policy, and streaming lifecycle semantics
- presentations persistence plus slide lifecycle with host-owned durable storage and canonical `presentations` vocabulary
- portal feed publishing, featured/discover retrieval, feed detail, like/unlike, collect/uncollect, share, and author-owned deletion with host-owned durable storage
- trade marketplace task discovery, current-user published and accepted task views, task acceptance, delivery submission, publisher approval or reopen, role-aware cancellation, trade order lifecycle, canonical order statistics, canonical payment initiation and refund, host-owned wallet recharge, wallet balance read-models, transaction history, and sandbox payment callback settlement with durable Rust-owned storage
- VIP plan catalog, current-user membership status, purchase orchestration, subscription history, and subscription cancellation with host-owned durable storage
- prompt optimization
- generation foundation for image, video, audio, music, sfx, and character
- voices foundation for market/workspace/custom speaker registry and speech/clone task lifecycle
- generated AI SDK-backed speech execution for `generation/audio/text-to-speech` and `voices/speech/tasks`
- canonical generated artifact persistence under app-owned `generated-outputs` storage
- operator governance for deployments, runtime audits, job metrics, policy audits, storage providers, execution provider inventory/health/failure supervision with provider detail, reconcile, failure acknowledgement, and retry workflows, plugin enablement, and fleet-level workspace release retention run execution/audit plus schedule lifecycle, update, and manual trigger governance

The next architecture priorities are:

- standardize the remaining generation and voice provider execution behind the existing canonical routes, especially video extend/style-transfer/lip-sync, sfx, and voice-clone
- deepen chat provider-stream execution behind the now-canonical `chat` namespace and presentation prompt-generation/template depth behind the now-canonical `presentations` namespace; keep chat streaming package-local until the Rust kernel owns moderation, attachment resolution, model policy, and streaming lifecycle semantics, and keep presentation generation explicitly unsupported until the kernel owns a real product contract
- keep project-scoped workspace release governance on the canonical `workspaces` surface and fleet execution/audit plus recurring schedule governance on canonical `admin/governance` now that retention-policy read/update/apply, retention-run orchestration, retention-schedule lifecycle, execution provider inventory/health/failure read models, provider detail, reconcile, failure acknowledgement, and retry governance are landed; the next gap is exception windows, rollout policy, fleet recovery history, and deeper execution governance, not editor-local release flows
- deepen creation beyond the new canonical batch planning and materialization surface only when the Rust kernel owns durable execution scheduling, replay policy, pause/resume semantics, and cross-family orchestration governance rather than client-side sequencing
- keep film review-governance on the host-owned read-model path beyond the new canonical project/preset/template/template-snapshot/asset-inventory/publish-history/review-queue/project-review-portfolio/reviewer-capacity/project-review-decision-freshness/project-review-governance-drift/project-review-escalation-forecast/project-review-dependency-graph/project-review-intervention-plan/project-review-recovery-orchestration/project-review-approval-burn-down/project-review-intervention-outcomes/project-review-effectiveness-baseline/project-review-intervention-execution-history/publish-detail/publish-review-state/publish-review-timeline/publish-review-rounds/publish-review-anchors/publish-review-activity/publish-review-decision-matrix/publish-review-readiness/publish-reviewer-coverage/publish-reviewer-backlog/publish-reviewer-attention/publish-review-operations-dashboard/publish-review-stale-decisions/publish-review-latency-analytics/publish-review-anchor-responsibility/publish-review-worklist/publish-review-assignments/publish-review-submit/publish-review-consensus/publish-approve/publish-request-changes/publish-review-comments/publish-review-comment-resolve/publish-reopen/publish-restore/publish-delete/artifact-access/asset-relink/publish/script-standardization/prepare-analysis/refresh-analysis/rebuild-storyboard/scene-breakdown/shot-variant/shooting-plan/graph/validation/batch/storyboard/asset/import/export surface; any further governance depth should add durable host-owned execution state only when the workflow is truly persisted by the kernel, not by client joins
- extend MagicCut render execution depth beyond the current honest audio-only WAV pipeline only when a real server-side composition/render engine exists; do not introduce fake video render semantics
- keep the new `capabilities` family as the canonical machine-readable architecture and execution inventory
- extend portal beyond the new canonical feed lifecycle only when comments, author-follow, moderation, or ranking workflows are truly host-owned instead of package joins
- keep settings and drive-overlay extraction meaning-driven; only promote state that must survive server deployment and desktop embedding with the same product semantics
- continue frontend consumer adoption cleanup so remaining feature packages stop depending on legacy upstream business facades once a canonical host API exists

## Package System

### Foundation Ownership

- `@sdkwork/magic-studio-host-types`
  - host/runtime/server transport contracts and envelopes
- `@sdkwork/magic-studio-host-core`
  - host discovery and canonical connection resolution
- `@sdkwork/magic-studio-server`
  - canonical server contract facade and Rust build entry
- `@sdkwork/magic-studio-types`
  - shared domain and cross-feature product contracts
- `@sdkwork/magic-studio-core`
  - runtime orchestration, platform abstraction, storage topology, server client integration
- `@sdkwork/magic-studio-commons`
  - shared UI and focused helper utilities

### Feature Ownership

Feature packages such as `audio`, `canvas`, `chat`, `chatppt`, `drive`, `editor`, `film`, `image`, `magiccut`, `music`, `notes`, `plugins`, `portal-video`, `prompt`, `trade`, `video`, `vip`, and `workspace` own product capability flows on top of the same runtime and package standards.

Rules:

- one package, one bounded responsibility
- feature packages may depend on foundation packages
- cross-feature dependencies should stay explicit and minimal
- the app shell in `src/` remains thin and compositional

## Packaging Rules

### Manifest Rules

Private Magic Studio packages must use:

- `main`: `./src/index.ts` or `./src/index.tsx`
- `module`: `./src/index.ts` or `./src/index.tsx`
- `types`: `./src/index.ts` or `./src/index.tsx`
- `exports["."].import`: `./src/index.ts` or `./src/index.tsx`
- `exports["."].types`: `./src/index.ts` or `./src/index.tsx`

They must also include:

- `files: ["src", "dist", "README.md"]`

Published package exception:

- `@sdkwork/magic-studio-prompt`
  - keeps root source entry
  - allows `require: "./dist/index.cjs"`
  - allows `./styles: "./dist/style.css"`

### TypeScript Rules

Every Magic Studio package `tsconfig.json` must:

- `extends: "../../tsconfig.json"`
- not redefine `baseUrl`
- not redefine `paths`
- set `noUnusedLocals: false`
- set `noUnusedParameters: false`

### Script Rules

Canonical package typecheck:

```text
node ../../scripts/run-package-typecheck.mjs tsconfig.json
```

The wrapper is authoritative for repo-wide `--noEmit` verification. If a package-local `rootDir` is narrower than the shared workspace alias graph, the wrapper widens the effective typecheck `rootDir` to the common source-graph ancestor rather than pushing that normalization into every package `tsconfig.json`.

Canonical default build for private source-entry packages:

```text
vite build
```

Approved exceptions:

- `@sdkwork/magic-studio-distribution`
  - `node ../../scripts/run-package-typecheck.mjs tsconfig.json`
- `@sdkwork/magic-studio-host-core`
  - `node ../../scripts/run-package-typecheck.mjs tsconfig.json`
- `@sdkwork/magic-studio-host-types`
  - `node ../../scripts/run-package-typecheck.mjs tsconfig.json`
- `@sdkwork/magic-studio-server`
  - `node ../../scripts/run-magic-studio-server-build.mjs`
- `@sdkwork/magic-studio-types`
  - `node ../../scripts/run-package-typecheck.mjs tsconfig.json && vite build`

No package should introduce a raw `tsc && vite build` branch as a private-package special case.

## Boundary Rules

1. `@sdkwork/magic-studio-core` consumes server capabilities through `@sdkwork/magic-studio-server`, not by depending on `@sdkwork/magic-studio-host-core`.
2. Package source code must not deep-import sibling package internals such as `../../other-package/src/*`.
3. Legacy `sdkwork-react-*` naming is retired and must not be reintroduced in package directories, manifests, or package source files.
4. `@sdkwork/magic-studio-types` and `@sdkwork/magic-studio-host-types` are separate authorities:
   - `types` owns shared domain contracts
   - `host-types` owns host/runtime/server transport contracts
5. Low-level runtime and domain code must use focused `@sdkwork/magic-studio-types/<domain>` subpaths instead of the root `@sdkwork/magic-studio-types` facade.
6. The current enforced focused-import scope is:
   - `@sdkwork/magic-studio-core`: `src/ai`, `src/platform`, `src/runtime`, `src/services`, `src/storage`, `src/sdk`
   - `@sdkwork/magic-studio-commons`: `src`
   - `@sdkwork/magic-studio-magiccut`: `src`
   - `@sdkwork/magic-studio-chatppt`: `src/store`, `src/services`
   - `@sdkwork/magic-studio-canvas`: `src/entities`, `src/services`, `src/store`, `src/utils`
   - `@sdkwork/magic-studio-browser`: `src/services`
   - `@sdkwork/magic-studio-editor`: `src/services`
   - `@sdkwork/magic-studio-drive`: `src`
   - `@sdkwork/magic-studio-settings`: `src/data`, `src/services`
   - `@sdkwork/magic-studio-notifications`: `src`
   - `@sdkwork/magic-studio-prompt`: `src/services`, `src/store`
   - `@sdkwork/magic-studio-notes`: `src`
   - `@sdkwork/magic-studio-portal-video`: `src`
   - `@sdkwork/magic-studio-film`: `src`

## Canonical Governance Entry

Use:

```bash
pnpm run check:architecture-standards
pnpm run check:architecture-doc-parity
pnpm run check:package-standards
pnpm run check:runtime-boundaries
pnpm run check:types-alias-parity
pnpm run check:types-import-boundaries
```

This is the canonical non-test audit for:

- package naming
- manifest source-entry rules
- `tsconfig` inheritance rules
- canonical build/typecheck scripts
- architecture authority doc parity for focused-import governance
- retired `sdkwork-react-*` regression detection
- direct `@tauri-apps/*` import regressions outside the core desktop runtime layer
- canonical API route literal regressions outside `@sdkwork/magic-studio-server`
- `@sdkwork/magic-studio-types` alias parity regressions across build-mode projections
- low-level `@sdkwork/magic-studio-types` root-facade regressions

Use `check:architecture-standards` as the default gate. The two narrower commands remain available when you want to focus on one governance surface.

For broader host/runtime/API rules, use the authority documents under `docs/`.

For the current route inventory and next-stage API extraction blueprint, use `docs/magic-studio-api-capability-matrix.md`.
