# Unified Clip Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Clip as the canonical output of every intelligent slicing engine, with WYSIWYG timeline editing, per-clip processing, render tracking, and database-backed workflow standards.

**Architecture:** Engine-specific analysis may differ, but every slicing workflow must converge on `generate-clips`, then use a shared `studio_clip` timeline model for preview, manual boundary edits, per-clip processing, rendering, verification, and persistence. Runtime state is tracked through `ops_workflow_run`, `ops_step_run`, and `ops_step_item_run`; durable clip/timeline facts live in `studio_*`; large evidence remains artifact-backed JSON.

**Tech Stack:** TypeScript contract types and pure planner helpers, Tauri SQLite schema registry and Rust database contract, existing AutoCut task/workflow scripts.

---

### Task 1: Failing Governance Contracts

**Files:**
- Modify: `scripts/check-autocut-slicer-planner.mjs`

- [ ] **Step 1: Add failing assertions**

Assert that `@sdkwork/autocut-types` exposes canonical `StudioClip`, `StudioTimeline`, workflow step keys, engine template ids, clip processing plans, and timeline edit events.

- [ ] **Step 2: Add DB contract assertions**

Assert SQLite, schema registry, and Rust contract all include `ops_workflow_run`, `ops_step_item_run`, `media_text_track`, `media_text_segment`, `media_content_unit`, `studio_timeline`, `studio_clip`, `studio_clip_source_ref`, and `studio_clip_event`.

- [ ] **Step 3: Run failing test**

Run: `node scripts/check-autocut-slicer-planner.mjs`

Expected: FAIL because the unified Clip standard does not exist yet.

### Task 2: Canonical Types And Workflow Registry

**Files:**
- Modify: `packages/sdkwork-autocut-types/src/index.ts`
- Create: `packages/sdkwork-autocut-slicer/src/service/clipWorkflow.ts`
- Modify: `packages/sdkwork-autocut-slicer/src/index.ts`

- [ ] **Step 1: Implement Clip types**

Add canonical `StudioTimeline`, `StudioClip`, `StudioClipSourceRef`, `StudioClipEvent`, `ClipProcessingPlan`, and WYSIWYG edit event types.

- [ ] **Step 2: Implement workflow registry**

Add engine templates where every intelligent slicing engine converges on `generate-clips`, `timeline-preview-edit`, `refine-clips`, `process-clips`, `render-clips`, `verify-clips`, and `persist-results`.

- [ ] **Step 3: Add pure timeline edit helpers**

Provide boundary adjustment and clip preview range helpers that clamp to source duration and return invalidation hints for per-clip downstream work.

### Task 3: Database Contract

**Files:**
- Modify: `packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql`
- Modify: `packages/sdkwork-autocut-desktop/src-tauri/database/schema-registry/autocut_host_baseline.yaml`
- Modify: `packages/sdkwork-autocut-desktop/src-tauri/src/database_contract.rs`
- Modify: `packages/sdkwork-autocut-desktop/src-tauri/src/database_runtime.rs`
- Modify: `docs/architecture/17-autocut-database-contract-standard.md`

- [ ] **Step 1: Add workflow and clip tables**

Add `ops_workflow_run`, `ops_step_item_run`, `media_text_track`, `media_text_segment`, `media_content_unit`, `studio_timeline`, `studio_clip`, `studio_clip_source_ref`, and `studio_clip_event`.

- [ ] **Step 2: Update Rust contract**

Register the new tables in `AUTOCUT_DATABASE_CONTRACT` and database runtime tests.

- [ ] **Step 3: Update documentation**

Document that all intelligent slicing engines converge through Clip-backed timeline workflow tables.

### Task 4: Slicer Integration

**Files:**
- Modify: `packages/sdkwork-autocut-slicer/src/service/slicerService.ts`
- Modify: `packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx`

- [ ] **Step 1: Produce timeline view model**

When a review session is created, also expose standard `studioTimeline` and `studioClips` snapshots on the task.

- [ ] **Step 2: Use WYSIWYG timeline helpers**

Wire the page to display clip timeline geometry and use standard boundary edit helpers for start/end changes.

### Task 5: Verification

**Files:**
- Modify only if verification exposes a real issue.

- [ ] **Step 1: Run slicer planner governance**

Run: `node scripts/check-autocut-slicer-planner.mjs`

Expected: PASS.

- [ ] **Step 2: Run architecture governance**

Run: `pnpm check:autocut-architecture`

Expected: PASS.

- [ ] **Step 3: Run focused typecheck**

Run: `pnpm --filter @sdkwork/autocut-types typecheck && pnpm --filter @sdkwork/autocut-slicer typecheck`

Expected: PASS.
