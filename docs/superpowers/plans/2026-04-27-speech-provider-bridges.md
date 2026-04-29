# Speech Provider Bridges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Volcengine and Alibaba Cloud speech-to-text providers behind a canonical OpenAI-style transcription contract without leaking vendor details into media analysis, subtitle, render, diagnostics, or UI state.

**Architecture:** Introduce `SpeechToTextProviderProfile` and a Host-side bridge layer. The bridge accepts one canonical transcription request, executes the vendor-specific HTTP request, maps vendor responses to OpenAI-style verbose JSON, then reuses the existing `TranscriptDocument` output contract. UI settings and provider conformance expose profile selection and redacted capability evidence only.

**Tech Stack:** Rust 2024, Axum test servers, reqwest JSON/multipart clients, serde_json, TypeScript React settings UI, Vitest/OpenAPI contract checks.

---

### Task 1: Provider Profile Contract And Conformance

**Files:**
- Modify: `host/src/providers.rs`
- Modify: `host/src/lib.rs`
- Modify: `host/src/doctor.rs`
- Test: `host/tests/provider_contract_test.rs`
- Modify: `docs/openapi/video-cut-v1.yaml`
- Test: `src/__tests__/openApiContract.test.ts`

- [x] Step 1: Write failing Rust tests for supported STT profiles.
- [x] Step 2: Run `cargo test --manifest-path host/Cargo.toml --test provider_contract_test speech_to_text_provider_profiles -- --nocapture` and verify RED.
- [x] Step 3: Add `SpeechToTextProviderProfile`, `SpeechToTextProviderConfig`, bridge endpoint builder, and conformance check details.
- [x] Step 4: Wire `provider_conformance_report_from_settings()` to use the STT bridge config for `speechToText` and `all`.
- [x] Step 5: Add capability policy `speechToTextProviderProfiles`.
- [x] Step 6: Update OpenAPI contract and TypeScript contract tests.
- [x] Step 7: Run the targeted Rust and OpenAPI tests to verify GREEN.

### Task 2: Host STT Bridge Execution

**Files:**
- Create: `host/src/speech_transcription.rs`
- Modify: `host/src/media_transcript.rs`
- Modify: `host/src/lib.rs`
- Test: `host/src/media_transcript.rs`

- [x] Step 1: Write failing async tests for `openai-audio-transcriptions`, `volcengine-bigasr-flash`, and `aliyun-qwen-asr` bridge execution using local Axum mock servers.
- [x] Step 2: Run `cargo test --manifest-path host/Cargo.toml media_transcript -- --nocapture` and verify RED.
- [x] Step 3: Move provider request execution into `speech_transcription.rs` with one canonical result type.
- [x] Step 4: Implement OpenAI multipart bridge preserving existing behavior.
- [x] Step 5: Implement Volcengine BigASR Flash JSON bridge:
  - endpoint `/api/v3/auc/bigmodel/recognize/flash`
  - `X-Api-Key`, `X-Api-Resource-Id`, `X-Api-Request-Id`, `X-Api-Sequence`
  - request body with `audio.data` base64
  - map `result.text` and `result.utterances[].start_time/end_time/text/words` into canonical segments.
- [x] Step 6: Implement Alibaba Qwen-ASR bridge:
  - endpoint `/compatible-mode/v1/chat/completions`
  - bearer auth
  - `input_audio` data URL payload
  - map direct text or JSON content into canonical segments.
- [x] Step 7: Preserve secret redaction, safe warning messages, and no server-local path leakage.
- [x] Step 8: Run `cargo test --manifest-path host/Cargo.toml media_transcript -- --nocapture` to verify GREEN.

### Task 3: Settings Center And Validation

**Files:**
- Modify: `src/domain/videoCutTypes.ts`
- Modify: `src/services/settingsValidation.ts`
- Modify: `src/services/settingsDraft.ts`
- Modify: `src/services/mockHostClient.ts`
- Modify: `src/components/settings/SettingsPanels.tsx`
- Test: `src/__tests__/settingsCenter.test.tsx`
- Test: `src/__tests__/settingsValidation.test.ts`
- Test: `src/__tests__/mockHostClient.test.ts`

- [x] Step 1: Write failing UI/domain tests for STT provider profile selection and conformance evidence.
- [x] Step 2: Run targeted Vitest tests and verify RED.
- [x] Step 3: Add `SpeechToTextProviderProfile` to TypeScript settings.
- [x] Step 4: Add Settings Center select control with profiles:
  - `openai-audio-transcriptions`
  - `volcengine-bigasr-flash`
  - `aliyun-qwen-asr`
- [x] Step 5: Update mock conformance and validation so each profile uses the same canonical capability report shape.
- [x] Step 6: Run targeted Vitest tests to verify GREEN.

### Task 4: Documentation And Full Verification

**Files:**
- Modify: `docs/architecture/03-provider-contract-and-ai-standards.md`
- Modify: `docs/architecture/07-technology-selection-decision-matrix.md`
- Modify: `docs/product/01-product-requirements-document.md`
- Modify: `docs/product/feature-readiness.yaml`
- Modify: `README.md`

- [x] Step 1: Document provider profiles, bridge behavior, official vendor endpoints, redaction rules, and fallback behavior.
- [x] Step 2: Run format, Rust tests, frontend tests, build, OpenAPI, provider conformance, deployment, database, and feature readiness checks.
- [x] Step 3: Restart local Host if needed and run deployment doctor.
