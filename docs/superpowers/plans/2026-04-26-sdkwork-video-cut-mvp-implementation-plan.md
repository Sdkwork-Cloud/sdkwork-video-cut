# sdkwork-video-cut MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable local-first MVP with a complete video-cut workbench, settings center, diagnostics, mock host client, tests, and production build.

**Completion status:** Completed. This plan is retained as historical implementation evidence; current source has progressed beyond the original MVP shell into a standalone React/Vite UI plus Rust/Axum Host with canonical `/api/video-cut/v1` contracts, real FFmpeg rendering, private artifact delivery, settings center, diagnostics, deployment artifacts, and governance checks.

**Architecture:** Phase 1 created a standalone React/Vite app following the documented `/api/video-cut/v1` contract through a host-client facade. Later iterations replaced MVP-only seams with the Rust Host, real media analysis/rendering, OpenAI-compatible provider bridge contracts, local/server upload, and release smoke automation while keeping the mock adapter for UI development and conformance testing.

**Tech Stack:** React 19, Vite, TypeScript, Vitest, Testing Library, lucide-react, CSS modules/plain CSS, local mock host client.

---

## File Structure

- Create `package.json`: app scripts and dependencies.
- Create `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`: Vite/TypeScript setup.
- Create `src/main.tsx`, `src/App.tsx`, `src/styles.css`: shell, layout, visual system.
- Create `src/domain/videoCutTypes.ts`: task, settings, capability, artifact types.
- Create `src/services/mockHostClient.ts`: in-memory implementation of health, capabilities, settings, tasks, analyze, render, events.
- Create `src/services/settingsValidation.ts`: schema-like validation for settings.
- Create `src/components/*`: app shell, workbench, settings center, diagnostics, reusable controls.
- Create `src/__tests__/*.test.ts(x)`: tests for settings validation, mock host client, and UI rendering.

## Task 1: Scaffold Vite React App

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`

- [x] Step 1: Create minimal app scaffold and scripts.
- [x] Step 2: Add Vite React config and TypeScript config.
- [x] Step 3: Add product App shell.
- [x] Step 4: Run `pnpm install`.
- [x] Step 5: Run `pnpm build`.

## Task 2: Domain Types And Settings Validation

**Files:**
- Create: `src/domain/videoCutTypes.ts`
- Create: `src/services/settingsValidation.ts`
- Test: `src/__tests__/settingsValidation.test.ts`

- [x] Step 1: Write failing tests for valid settings, invalid base URL, missing model, and unsafe server config.
- [x] Step 2: Run `pnpm test -- --run src/__tests__/settingsValidation.test.ts` and verify failure.
- [x] Step 3: Implement domain types and validation.
- [x] Step 4: Run targeted test and verify pass.

## Task 3: Mock Host Client

**Files:**
- Create: `src/services/mockHostClient.ts`
- Test: `src/__tests__/mockHostClient.test.ts`

- [x] Step 1: Write failing tests for capabilities, settings save, task create, analyze, render, and event emission.
- [x] Step 2: Run targeted tests and verify failure.
- [x] Step 3: Implement deterministic in-memory host client.
- [x] Step 4: Run targeted tests and verify pass.

## Task 4: App Shell And Workbench UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/HomePage.tsx`
- Create: `src/components/WorkbenchPage.tsx`
- Create: `src/components/QueuePage.tsx`
- Create: `src/components/ResultsPage.tsx`
- Test: `src/__tests__/appShell.test.tsx`

- [x] Step 1: Write failing UI tests for navigation, workbench presence, and import/analyze/render actions.
- [x] Step 2: Run targeted UI tests and verify failure.
- [x] Step 3: Implement shell and workbench UI using mock host client.
- [x] Step 4: Run targeted UI tests and verify pass.

## Task 5: Settings Center And Diagnostics

**Files:**
- Create: `src/components/SettingsCenter.tsx`
- Create: `src/components/DiagnosticsPage.tsx`
- Create: `src/components/SettingFields.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/__tests__/settingsCenter.test.tsx`

- [x] Step 1: Write failing UI tests for AI Providers, Speech To Text, Subtitle, Media Tools, Storage, Runtime, Security sections.
- [x] Step 2: Run targeted UI tests and verify failure.
- [x] Step 3: Implement settings center and diagnostics.
- [x] Step 4: Run targeted UI tests and verify pass.

## Task 6: Verification And Dev Server

**Files:**
- Modify as needed from prior tasks.

- [x] Step 1: Run `pnpm test -- --run`.
- [x] Step 2: Run `pnpm build`.
- [x] Step 3: Start dev server with `pnpm dev -- --host 127.0.0.1`.
- [x] Step 4: Provide local URL and remaining roadmap.
