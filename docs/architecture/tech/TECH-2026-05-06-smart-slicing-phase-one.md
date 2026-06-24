> Migrated from `docs/superpowers/plans/2026-05-06-smart-slicing-phase-one.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Smart Slicing Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement phase-one intelligent slicing for trusted local videos so generated short clips use transcript-aware continuous windows, deterministic boundary repair, selected model routing, and clear duration validation.

**Architecture:** Keep one output clip as one continuous source interval rendered by the existing native `autocut_slice_video` command. Build transcript-derived candidate windows first, let the approved AI SDK bridge rank or adjust candidates when available, then normalize and repair final boundaries deterministically before native rendering.

**Tech Stack:** TypeScript, Vite SSR behavior scripts, `@sdkwork/autocut-services` approved LLM bridge, Tauri native video slicing command.

---

### Task 1: Service Behavior Tests

**Files:**
- Modify: `scripts/check-autocut-service-behavior.mjs`

- [ ] **Step 1: Write failing tests**

Add assertions that:
- `processVideoSlice` passes `params.llmModel` as the LLM request model.
- invalid `minDuration > maxDuration` rejects before creating native work.
- transcript-assisted planning expands weak connector starts backward for continuity.
- LLM candidate plans are selected from transcript candidates and normalized without producing overlapping clips.

- [ ] **Step 2: Run test to verify failure**

Run: `node scripts/check-autocut-service-behavior.mjs`

Expected: FAIL on at least the model-routing and continuity assertions before production changes.

### Task 2: Phase-One Slicing Logic

**Files:**
- Modify: `packages/sdkwork-autocut-slicer/src/service/slicerService.ts`

- [ ] **Step 1: Implement minimal code**

Add deterministic helpers for:
- duration range validation before task creation,
- transcript segment sanitization,
- connector-aware candidate window building,
- candidate scoring based on mode/highlight options,
- LLM candidate prompt and parser with `candidateId` support,
- final repair that clamps duration, sorts, and prevents overlap.

- [ ] **Step 2: Keep AI integration on approved boundary**

Pass `params.llmModel` into `createAutoCutOpenAiCompatibleChatCompletion` and do not add raw HTTP or provider-specific SDK code.

- [ ] **Step 3: Run behavior test**

Run: `node scripts/check-autocut-service-behavior.mjs`

Expected: PASS.

### Task 3: Verification

**Files:**
- Modify only if verification exposes a real issue.

- [ ] **Step 1: Run focused workflow governance**

Run: `node scripts/check-autocut-feature-workflows.mjs`

Expected: PASS.

- [ ] **Step 2: Run slicer package typecheck**

Run: `pnpm --filter @sdkwork/autocut-slicer typecheck`

Expected: PASS.

- [ ] **Step 3: Run root architecture check**

Run: `pnpm check:autocut-architecture`

Expected: PASS.

### Task 4: Planning Kernel Standardization

**Files:**
- Create: `packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts`
- Create: `scripts/check-autocut-slicer-planner.mjs`
- Modify: `packages/sdkwork-autocut-slicer/src/service/slicerService.ts`
- Modify: `packages/sdkwork-autocut-slicer/src/index.ts`
- Modify: `scripts/check-autocut-architecture.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing pure planner test**

Create `scripts/check-autocut-slicer-planner.mjs` that imports `createTranscriptAssistedSlicePlan`, `parseLlmSlicePlan`, `createDeterministicSlicePlan`, and `validateVideoSliceParams` from `slicePlanner.ts`.

Expected behaviors:
- invalid duration ranges reject before task creation,
- connector-led transcript segments are expanded backward,
- transcript plans do not insert fixed filler clips,
- candidate ID parsing keeps deterministic candidate boundaries over LLM millisecond suggestions,
- no-transcript LLM plans still normalize, fill, clamp, and avoid overlap.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-autocut-slicer-planner.mjs`

Expected: FAIL because `slicePlanner.ts` does not exist yet.

- [ ] **Step 3: Extract pure planner module**

Move planner-only types and helpers from `slicerService.ts` into `slicePlanner.ts`. Keep `slicerService.ts` responsible only for task creation, native host orchestration, transcription, LLM request creation, artifact mapping, and task completion.

- [ ] **Step 4: Connect service to planner module**

Import planner functions into `slicerService.ts`. Keep the external service API unchanged.

- [ ] **Step 5: Update governance**

Add `scripts/check-autocut-slicer-planner.mjs` to the root `test` script and `allowedScriptFiles`. Add architecture markers that enforce slicer service delegates planning to `slicePlanner.ts`.

- [ ] **Step 6: Verify**

Run:
- `node scripts/check-autocut-slicer-planner.mjs`
- `node scripts/check-autocut-feature-workflows.mjs`
- `pnpm.cmd typecheck`
- `node --import <temporary child_process patch> scripts/check-autocut-architecture.mjs` only if the current sandbox still blocks `git ls-files`.

Expected: PASS.

