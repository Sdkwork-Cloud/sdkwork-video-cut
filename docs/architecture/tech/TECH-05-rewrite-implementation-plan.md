> Migrated from `docs/specs/smart-cut-engine/05-rewrite-implementation-plan.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Smart Cut Engine Rewrite Implementation Plan

## Phase 1: Standard Package

Status: started.

Deliverables:

- `@sdkwork/autocut-smart-cut-engine`
- canonical evidence kinds
- first-class speaker evidence structures
- slicer registry
- filter registry
- validator registry
- product preset registry
- strategy registry validation gate that verifies unique strategy ids, default strategy registration, every preset reference, speech/dialogue speaker requirements, LLM raw-time prohibition, destructive-filter revalidation, speech-first validators, and multimodal evidence coverage
- standard self-report
- execution blueprint API
- candidate plan validation API
- transcript-speaker alignment API and report for deterministic speaker turns and stable turn ids
- shared speaker evidence structure validation API used by provider-stage diarization gates and execution evidence-quality gates
- standard content-unit builder and build report API
- speaker context on content units: turn ids, roles, confidence, stable speaker segment ids, and overlap group ids
- speech semantic candidate planner that consumes standard content units and exposes the build report
- provider-driven speech-first orchestration API that calls STT, validates transcript evidence, calls speaker diarization, validates speaker evidence, runs alignment, speech-semantic planning, LLM raw JSON review, LLM review normalization, execution packaging, provider-aware audit trace creation, and exposes top-level stage statuses/blockers in the required order
- lower-level speech-first execution package orchestration API for already-produced transcript evidence, speaker evidence, and raw LLM review output
- provider-stage fail-closed gates that convert STT, diarization, alignment, content-unit build, and LLM reviewer failures into standard blockers without fabricating downstream LLM evidence or execution packages; STT provider gates reject non-object transcript payloads, malformed transcript containers, non-object segment items, plus missing, duplicate, textless, out-of-source, overlapping, low-confidence, or invalid-confidence transcript segments; diarization provider gates reject non-object speaker payloads and malformed speaker evidence containers, then reuse the shared speaker evidence structure validator to reject non-object speaker evidence items, blank/duplicate speaker profile ids, blank display names, invalid speaker roles or provenance sources, blank/duplicate speaker segment ids, malformed speaker turns, overlap groups with duplicate ids or members, out-of-source ranges, unknown speaker or segment ids, speaker/segment mismatches, missing speaker segment backing, or no real multi-speaker segment overlap, and invalid/ambiguous role assignments
- deterministic speaker-turn fallback builder from transcript and diarization segments for diagnostics only; execution content units must reference real `speakerEvidence.turns`
- LLM candidate review normalizer that rejects raw timestamp cuts and unknown stable ids
- standalone LLM candidate review validation gate that rejects missing or malformed review evidence, wrong evidence kind/schema, missing model id, blank or duplicate ids, unknown stable ids, current-plan-external candidate ids, candidate-external content unit ids, raw timestamp attempts, and reviews that do not cover executable candidate/unit ids
- execution package LLM-review fail-closed gate that delegates to the standalone review validator before filters or render
- deterministic candidate selection that can use validated LLM ranking as a priority signal only after content-unit, quality, duration, and overlap gates pass
- execution package evidence-quality fail-closed gate that rejects missing, non-object, malformed-container, or malformed-item transcript and speaker evidence even when content units are provided; derived alignment, role, and undeclared-overlap checks only run after the speaker evidence structure is safe enough to inspect
- execution package speaker-alignment fail-closed gate that rejects missing alignment reports, blocked alignment reports, alignment reports that no longer match `speakerEvidence.turns`, or transcript coverage counts that no longer match the supplied `transcriptEvidence`
- execution package content-unit-build fail-closed gate that rejects missing build reports and mismatched execution units
- execution package content-unit evidence-link fail-closed gate that verifies units against the supplied transcript segments, speaker profiles, speaker segments, speaker turns, roles, and overlap groups
- execution audit trace and provider execution audit trace with STT stage, speaker-diarization stage, LLM-provider stage, provider ids, speaker-alignment stage, content-unit-build stage, content-unit evidence-link stage, LLM review stage, candidate validation blocker metrics, content-unit structure blocker metrics, and speaker-context blocker metrics
- speaker-aware semantic boundary validation for Q/A role order, unit id order, and overlap group completeness
- candidate validation content-unit structure gate that rejects hand-written content units with invalid ranges, missing transcript traceability, missing speaker ids, missing speaker turn ids, missing speaker roles, cross-speaker unit merges, or weak speaker confidence
- strategy interface contracts for slicers, filters, validators, renderers, STT, speaker diarization, LLM review, native engine adapter, and manual correction storage
- LLM reviewer strategy contract returns raw constrained JSON; normalized `llm-review` evidence is created only by the standard normalizer and validation gates
- static standard check script
- dedicated registry check script wired into the root test chain

Exit criteria:

- `node scripts/check-smart-cut-engine-standard.mjs` passes
- `node scripts/check-smart-cut-engine-registry.mjs` passes
- `node scripts/check-smart-cut-engine-pipeline.mjs` passes
- `node scripts/check-smart-cut-engine-interfaces.mjs` passes
- `node scripts/check-smart-cut-engine-speech-semantic.mjs` passes
- `node scripts/check-smart-cut-engine-llm-review.mjs` passes
- `node scripts/check-smart-cut-engine-speaker-alignment.mjs` passes
- `node scripts/check-smart-cut-engine-content-units.mjs` passes
- `node scripts/check-smart-cut-engine-execution-package.mjs` passes
- `node scripts/check-smart-cut-engine-audit-trace.mjs` passes
- `pnpm --filter @sdkwork/autocut-smart-cut-engine typecheck` passes

## Phase 2: Native Contract

Create Rust/TS JSON contracts for:

- media evidence
- audio evidence
- visual evidence
- speaker evidence references
- content units
- candidate validation
- filter plans
- render plans
- artifact reports

Exit criteria:

- TypeScript and Rust contract tests agree on sample fixtures.
- Invalid intervals fail closed.

## Phase 3: Speech Semantic Engine

Implement the default slicer:

- transcript normalization
- speaker alignment
- speaker turn builder
- Q/A detector
- standard content unit build gate
- deterministic candidate generator
- LLM reviewer/ranker adapter
- semantic completeness validator
- speaker continuity validator

Exit criteria:

- single-person teacher fixture generates one complete <= 90s candidate
- interview fixture generates Q/A clips
- long interview fixture generates 60-180s matrix clips
- LLM raw timestamp output is rejected
- candidate validation rejects raw time-only cuts, low semantic completeness, missing speaker context, broken unit coverage, and preset duration violations

## Phase 4: Filter Graph

Implement post-slice filters:

- speech denoise
- dereverb
- silence trim
- abnormal segment remove
- repeat deduplicate
- ad/fluff remove
- subtitle sync
- smart reframe
- BGM ducking
- SFX
- cover generation

Exit criteria:

- destructive filters trigger revalidation
- semantic boundaries remain valid after filtering
- rendered artifacts include quality evidence

## Phase 5: UI Replacement

Replace legacy smart slicing UI with product presets:

- teacher talking-head single
- interview one Q/A
- long interview matrix
- advanced industry presets
- speaker correction panel
- quality blockers panel
- evidence export

Exit criteria:

- the UI no longer exposes generic modes as business requirements
- every task stores preset id, slicer ids, evidence ids, validation report, filter report, and render report

## Phase 6: Industry Expansion

Add concrete strategy implementations for:

- visual scene
- film scene
- documentary chapter
- music beat
- audio waveform
- sports event
- gaming highlight
- screen OCR
- commerce live

Exit criteria:

- each slicer has fixtures, native evidence requirements, validators, and UI preset wiring

