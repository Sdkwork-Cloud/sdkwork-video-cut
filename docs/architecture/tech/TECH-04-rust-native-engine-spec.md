> Migrated from `docs/specs/smart-cut-engine/04-rust-native-engine-spec.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Rust Native Engine Spec

## Role

Rust is the deterministic high-performance layer. TypeScript should not implement heavy media algorithms or ad hoc interval math when Rust can own them consistently.

## Native Responsibilities

1. Media probe
2. Audio waveform and activity analysis
3. Silence, abnormal audio, clipping, and loudness detection
4. Visual shot and scene analysis
5. Frame quality analysis
6. Face track extraction and framing hints
7. OCR frame sampling bridge when enabled
8. Music beat and section extraction bridge when enabled
9. Interval index construction
10. Candidate interval validation
11. Post-filter revalidation
12. Render plan generation
13. FFmpeg execution
14. Artifact probing and checksum generation
15. Cache and temporary file management

## TypeScript Responsibilities

1. Product preset selection
2. Strategy chain orchestration
3. STT provider orchestration
4. Speaker diarization provider orchestration
5. LLM review/ranking orchestration
6. UI task state
7. Quality report presentation
8. Manual speaker correction workflows
9. Plugin/provider configuration

## Native API Shape

The native API should expose stable commands:

- `smart_cut_probe_media`
- `smart_cut_extract_audio_evidence`
- `smart_cut_extract_visual_evidence`
- `smart_cut_extract_music_evidence`
- `smart_cut_build_interval_index`
- `smart_cut_validate_candidates`
- `smart_cut_apply_filter_plan`
- `smart_cut_validate_filtered_plan`
- `smart_cut_render_plan`
- `smart_cut_probe_artifacts`

Each command should use versioned JSON contracts and return fail-closed blockers with remediation hints.

Native command definitions must also declare whether intervals are required and whether those intervals must carry stable content unit ids. Interval-bound commands are:

- `smart_cut_validate_candidates`
- `smart_cut_apply_filter_plan`
- `smart_cut_validate_filtered_plan`
- `smart_cut_render_plan`

These commands must reject empty interval lists, duplicate interval ids, blank content unit ids, raw time-only intervals, invalid integer millisecond ranges, and out-of-source intervals. Every native request must also validate the native schema version, smart cut standard version, run id, registered product preset id, source media identity, and `failClosed: true` before Rust execution starts.

Interval-bound native commands must also carry the deterministic plan identity they are executing. `smart_cut_apply_filter_plan` and `smart_cut_validate_filtered_plan` require a non-empty `filterPlanId` payload. `smart_cut_render_plan` and `smart_cut_probe_artifacts` require a non-empty `renderContractId` payload. A native request without these ids must fail before crossing the Rust boundary, because otherwise artifacts and blockers cannot be tied back to the approved standard contract.

`smart_cut_apply_filter_plan` and `smart_cut_validate_filtered_plan` must return auditable effect reports rather than only rendered media paths. Each effect report must preserve stable effect ids, source candidate ids, filter plan step indexes, retained semantic unit ids, affected speaker ids, source/output ranges, and a reason. TypeScript validation must fail closed when native reports duplicate or blank ids, effects outside the approved plan, effects attached to the wrong source candidate, invalid removed ranges, removed ranges that overlap approved content units, removed semantic units, missing retained units, source-external unit/speaker/transcript contamination, lost speakers, lost transcript segments, missing filtered outputs, or multiple filtered outputs for the same source candidate.

## Performance Rules

- Avoid reading large media into TypeScript memory.
- Keep media paths and asset ids native-side.
- Cache evidence by source fingerprint plus extractor version.
- Parallelize independent extractors.
- Use streaming probe/output when possible.
- Validate all time ranges with integer milliseconds.
- Reject negative, NaN, overlapping, or out-of-source intervals.
- Keep LLM and provider calls outside native execution.

