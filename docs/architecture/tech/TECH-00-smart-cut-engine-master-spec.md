> Migrated from `docs/specs/smart-cut-engine/00-smart-cut-engine-master-spec.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Smart Cut Engine Master Spec

## Goal

Build a new smart video cutting engine around a stable standard, not around the legacy slicer page implementation. The first-class product goal is the original `ORG_REQUIREMENTS.md` smart slicing workflow:

- Type 1: teacher talking-head short video, single publishable vertical MP4, <= 90 seconds.
- Type 2: interview, one question plus one answer per clip, batch output.
- Type 3: long interview matrix, extracted Q/A clips, 60-180 seconds, ads and fluff removed.

The default implementation is speech-first semantic slicing. It must convert speech to timestamped transcript and speaker evidence, build logical content units, cut only complete content units, then run cleanup filters after the content boundary is accepted.

## Non-Negotiable Principles

1. Product preset is not slicer.
2. Slicer decides content boundaries.
3. Filters clean approved slices and must never be the first source of semantic boundaries.
4. Destructive filters must trigger post-filter revalidation.
5. LLM is reviewer/ranker, not an unconstrained timecode generator.
6. Rust/native owns deterministic media analysis, interval validation, cache, render plans, and FFmpeg execution.
7. TypeScript owns product presets, strategy orchestration, UI state, provider calls, and task reporting.
8. Speaker diarization is first-class for spoken and multi-person content.
9. The engine must fail closed when evidence is missing or weak.
10. No legacy compatibility constraint applies to the new app standard.

## Current Implementation Review

The legacy smart slicing implementation contains useful pieces, but it is not a complete implementation of the original requirement:

- It exposes generic modes instead of the three original business modes.
- It plans slices inside the page/service workflow instead of a reusable engine standard.
- It mixes semantic slicing, audio boundary repair, denoise, rendering, and task projection too tightly.
- It does not model speaker evidence as a first-class domain object.
- It does not provide a strategy registry for speech, dialogue, visual scene, music beat, waveform, event, OCR, commerce, compliance, and other industry modes.
- It allows LLM-planned candidates to influence time boundaries too directly.
- It does not represent cover, subtitle styling, BGM, prompt SFX, upper-body framing, and publishability as a preset-level output contract.

The rewrite therefore starts from a new package: `@sdkwork/autocut-smart-cut-engine`.

## Required Pipeline

### 1. Evidence Extraction

Native/Rust extracts deterministic evidence:

- media metadata
- audio activity and waveform
- visual shots, scene boundaries, frame quality, face tracks
- OCR regions when screen or slide content exists
- music beat/section data when applicable
- interval indexes and hash/fingerprint data

Speech and model providers produce:

- transcript segments with timestamps
- word/sentence alignment when available
- speaker diarization segments
- role assignment and speaker-turn alignment

The default public orchestration must call these providers through the standard strategy contracts. Provider output is validated before the next provider or stage runs: STT must return canonical transcript evidence with provider/language metadata and a transcript segment array; transcript segments must be object payloads with stable unique ids, positive source-bounded millisecond ranges, non-overlapping timeline order, normalized text, and confidence in the 0-1 range when confidence is provided. Low-confidence transcript segments block automatic semantic slicing before diarization. Speaker diarization must return canonical speaker evidence arrays for profiles, segments, turns, overlap groups, role assignments, and corrections. Speaker profiles and speaker segments must be valid and stable, with segment ids that reference known profiles. Speaker turns must have stable unique ids, valid in-source ranges, text, transcript references, matching transcript-speaker ownership, and timestamp overlap with the referenced transcript segments. Overlapping speech groups must have stable unique ids, valid in-source ranges, at least two distinct speakers and speaker segments, known speaker and segment references from the same evidence payload, no duplicate members, segment speakers that match group speaker ids, one matching segment for every listed speaker, referenced segments that overlap the group range, and at least two different speaker segments that actually overlap inside the group range. Role assignments must reference known speakers and known turns, carry valid confidence, stay scoped to the same speaker's turns, and avoid ambiguous overlapping roles. Provider exceptions, non-object provider payloads, malformed provider containers, and malformed provider item payloads are converted into standard blockers instead of uncaught workflow failures.

### 2. Speaker-Aware Content Unit Building

The speech pipeline must build stable content units:

- transcript segments
- sentence ids
- speaker turns
- speaker turn ids
- speaker roles
- speaker confidence
- Q/A pairs
- topic blocks
- interruptions and backchannels
- overlapping speech groups
- semantic completeness scores
- continuity scores

The core cut unit is `content-unit`, `speaker-turn`, `qa-pair`, or `topic-chapter`, never an arbitrary timestamp.

### 3. Slicer Strategy Execution

Each slicer declares:

- supported media kinds
- required evidence
- optional evidence
- boundary policy
- speaker policy
- LLM policy
- native acceleration requirement

The default slicer is `speech-semantic`.

### 4. Candidate Review And Ranking

The LLM may:

- rank existing candidates
- explain why a candidate is strong or weak
- mark weak boundaries
- propose merging/splitting by stable unit ids
- identify title, cover angle, keywords, and risk notes

The LLM must not:

- invent raw timestamps
- cut outside candidate/unit ids
- override missing transcript/speaker/audio/visual evidence

Candidate selection may use a validated `rankedCandidateIds` list as a priority signal after deterministic boundary, quality, duration, and unit-id validation. LLM ranking cannot rescue a candidate rejected by these deterministic gates and cannot create or move slice boundaries.

### 5. Validation

Validators run before and after destructive filters:

- evidence coverage
- semantic completeness
- speaker continuity
- boundary integrity
- speaker-aware Q/A role order
- speaker-turn unit id order
- overlap group completeness
- duration contract
- post-filter integrity
- publishability standard
- render artifact integrity

Any missing evidence or invalid boundary blocks publishable output.

### 6. Post-Slice Filters

Filters run after slice boundary approval:

- speech denoise
- dereverb
- silence trim
- abnormal segment removal
- repeated take deduplication
- filler soft trim
- ad/fluff removal
- video stabilization
- smart reframe
- subtitle sync
- keyword highlight
- BGM ducking
- prompt SFX
- cover generation

Destructive filters require revalidation.

### 7. Render Packaging

Renderers package validated slices for product output:

- vertical 9:16 1080x1920 30fps MP4 for short video presets
- sentence-level Chinese subtitles with Jisong font, shadow, keyword highlight, and exact sync
- BGM at 20% for original short-video presets
- prompt SFX
- automatic cover: question plus core point
- upper-body two-thirds framing for teacher talking-head
- stable video and speech enhancement without reverb

## Standard Package

`packages/sdkwork-autocut-smart-cut-engine` defines the canonical standard:

- `domain.ts`: evidence, content-unit, candidate, output profile, media contracts.
- `llm-review.ts`: fail-closed LLM review normalizer and standalone validation gate. It rejects raw timestamp cuts, unknown ids, current-plan-external candidate ids, candidate-external content unit ids, malformed review evidence, blank or duplicate ids, missing model/schema metadata, and any review that does not cover the executable candidate ids and their required content unit ids. Execution must consume the validated normalized review report, not raw model output.
- `speaker.ts`: speaker profile, diarization segment, speaker turn, overlap, role assignment, correction.
- `speaker-evidence-structure.ts`: shared fail-closed speaker evidence structure gate used by provider orchestration and evidence quality. It rejects malformed speaker evidence containers, non-object speaker profile/segment/turn/overlap/role-assignment/correction items, missing diarization, blank or duplicate speaker profile ids, blank display names, invalid speaker roles or provenance sources, blank or duplicate speaker segment and turn ids, invalid confidence, invalid or out-of-source speaker ranges, turns without transcript evidence or text, turn/transcript range mismatch, unknown speaker and transcript references, overlap groups with blank or duplicate ids, invalid or out-of-source ranges, duplicate speakers or segments, unknown references, segment range mismatch, segment speaker mismatch, speakers without matching segments, or no real multi-speaker segment overlap, role assignments with unknown speaker or turn evidence, invalid assignment roles or sources, cross-speaker role evidence, ambiguous overlapping roles, and role/profile conflicts.
- `speaker-alignment.ts`: standard transcript-speaker alignment step that converts timestamped transcript segments plus diarization segments into deterministic speaker turns and an alignment report with stable turn ids.
- `speech-first-orchestration.ts`: default speech-first orchestration gates. `createSmartCutSpeechFirstExecutionPackageFromProviders` is the public provider-driven entrypoint: it calls STT, validates transcript evidence, calls speaker diarization, validates speaker evidence, aligns transcript-speakers, builds speech-semantic content units and candidates, calls the LLM reviewer for raw constrained JSON, normalizes the LLM review, creates the execution package, and returns a provider-aware audit trace. It fails closed without fabricating LLM evidence or execution packages when STT, diarization, alignment, content-unit build, or LLM provider stages fail. `createSmartCutSpeechFirstExecutionPackage` is the lower-level entrypoint for callers that already have transcript evidence, speaker evidence, and raw LLM review output; it owns the deterministic sequence from alignment through execution packaging.
- `slicers.ts`: industry slicer registry.
- `filters.ts`: filter registry and destructive-filter revalidation rules.
- `validators.ts`: validator registry.
- `presets.ts`: product preset registry for original requirements and industry presets.
- `registry-validation.ts`: strategy registry validation gate. It validates unique slicer/filter/validator/preset ids, default slicer and default product preset registration, and that presets only reference registered slicers, filters, validators, and renderers. It also enforces that speech/dialogue slicers require transcript and speaker evidence; dialogue slicers require diarization and role assignment; LLM-enabled slicers cannot create raw time ranges; destructive filters require revalidation; speech-first presets require diarization plus speaker-continuity and semantic-completeness validators; visual and multimodal presets require evidence-coverage validation. The standard report must depend on this gate.
- `pipeline.ts`: execution blueprint, native command plan, and candidate validation rules.
- `native-contract.ts`: Rust-owned command registry and fail-closed native request validation. It version-checks native requests, requires `failClosed: true`, validates run/source/preset identity, declares which native commands require content-unit-backed intervals, and rejects raw time-only intervals, duplicate interval ids, blank unit ids, invalid ranges, and out-of-source ranges before Rust execution.
- `filter-plan.ts`: post-slice filter plan builder and validation gate. It requires filter plans to be generated from the selected product preset and filter registry, blocks filters before candidate validation, rejects stale schema versions, missing source plan ids, blank/duplicate candidate ids, runtime completed-step mismatches, non-sequential filter indexes, registry metadata mismatches, preset filter chain mismatches, missing native filter commands, and incorrect post-filter revalidation flags.
- `filter-effects.ts`: native post-filter output validation gate. It rejects blank/duplicate effect ids, blank/duplicate filtered candidate ids, missing or multiple filtered outputs for one approved source candidate, effects outside the plan, effects bound to another source candidate, missing effect reasons, duplicate applied effects, invalid removed ranges, removed ranges outside the approved source candidate, removed ranges that overlap approved content units, removed ranges attributed to filters outside the plan, missing removed-range reasons, missing retained source ranges, removed semantic units, missing retained semantic unit ids, source-external unit/speaker/transcript contamination, lost speaker coverage, lost transcript segment coverage, and filtered durations outside preset limits.
- `render-contract.ts`: preset-backed render contract builder and validation gate. It rejects stale schema versions, missing filtered plan ids, empty/blank/duplicate candidate ids, renderer ids outside the selected preset, renderer-chain mismatches, output/subtitle/audio/visual profile mismatches, artifact-kind mismatches, batch-output mismatches, missing render validators, missing native render/probe commands, and invalid output profiles before native rendering.
- `render-artifacts.ts`: render artifact validation gate. It verifies required artifact kinds per candidate, rejects artifacts outside the render contract, rejects blank or duplicate artifact identities, rejects duplicate artifact kinds per candidate, validates checksums and byte sizes, probes video/subtitle/cover/quality-report metadata, and fails closed on output-profile or stream mismatches.
- `content-units.ts`: standard content unit builder, scorer, and build report gate.
- `speech-semantic.ts`: default speech semantic candidate planner that consumes standard content units and exposes the build report.
- `pipeline.ts`: revalidates every candidate-referenced content unit for valid unit ranges, transcript traceability, stable speaker ids, speaker turn ids, speaker roles, single-speaker unit ownership, and speaker confidence so hand-written units cannot bypass the content-unit-build gate.
- `content-unit-evidence-link.ts`: verifies each content unit is traceable to the same transcript segments, speaker profiles, speaker segments, speaker turns, speaker roles, and overlap groups passed into execution.
- `execution-package.ts`: fail-closed orchestration package for evidence, speaker alignment, content unit build, content-unit evidence links, LLM review, candidate, filter, render, native, and artifact gates. It always emits an evidence-quality report, requires the standard transcript-speaker alignment report, verifies the alignment report matches `speakerEvidence.turns` and the supplied transcript coverage, requires the standard content-unit build report, delegates LLM review coverage and evidence validation to `validateSmartCutLlmCandidateReviewReport`, verifies the report units match execution units, verifies every content unit against the supplied transcript/speaker evidence, and blocks when transcript, speaker, alignment, build-report, LLM review, or evidence-link data is missing or inconsistent. Render artifacts are accepted only after native post-filter effects are supplied and pass `validateSmartCutFilterEffects`; a package with render results but no validated filter execution result fails before render contract creation.
- `audit-trace.ts`: execution and provider execution audit traces with stage status, blocker groups, provider ids, STT/diarization/LLM-provider stage visibility, speaker-alignment metrics, content unit build metrics, content-unit evidence-link metrics, LLM review metrics, LLM ranked candidate counts, candidate validation blocker counts, candidate content-unit structure blocker counts, and candidate speaker-context blocker counts.
- `strategy.ts`: slicer, filter, validator, renderer, STT, diarization, LLM, native adapter, and manual correction interfaces. The LLM reviewer strategy returns raw constrained JSON, not normalized evidence; the standard LLM normalizer and validation gate are the only path from raw model output to executable review evidence.
- `report.ts`: self-check report.

The package is intentionally independent from the legacy autocut slicer modules.

