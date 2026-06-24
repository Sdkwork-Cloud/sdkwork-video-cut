> Migrated from `docs/specs/smart-cut-engine/03-filter-validator-render-spec.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Filter Validator Render Spec

## Rule

Semantic slicing happens before cleanup filtering. Filters are not responsible for discovering the logical cut. This preserves content continuity for spoken and dialogue content.

## Filter Classes

### Destructive Filters

Destructive filters alter time, content, audio signal, or media frames enough that validation must run again:

- speech denoise
- dereverb
- silence trim
- abnormal segment remove
- repeat deduplicate
- filler word soft trim
- ad/fluff remove

All destructive filters must declare `requiresRevalidation: true`.

Post-slice filter plans must be generated from the selected product preset and filter registry, not hand-written. Validation must reject stale schema versions, missing source candidate plan ids, empty/blank/duplicate candidate ids, completed-pipeline-step snapshots that do not match the runtime state, filter steps with non-sequential indexes, filter step metadata that differs from the registry, preset filter chain mismatches, missing native filter commands, and a `requiresPostFilterRevalidation` flag that does not match the destructive/revalidation-required filter steps.

Native post-filter effects are also part of the standard contract, not an opaque FFmpeg side effect. Validation must reject blank or duplicate effect ids, blank or duplicate filtered candidate ids, missing filtered outputs, more than one filtered output for the same approved source candidate, applied effects that belong to another source candidate, duplicate applied effect ids, effects outside the approved filter plan, missing effect reasons, missing retained semantic unit ids, removed semantic unit ids, retained ranges outside the approved source candidate, invalid removed ranges, removed ranges outside the approved source candidate, removed ranges that overlap approved content units, removed ranges attributed to filters outside the approved plan, removed ranges without reasons, missing retained source ranges, source-external unit/speaker/transcript contamination, lost speaker coverage, lost transcript segment coverage, and post-filter durations outside the preset contract.

Render artifact validation is reachable only after post-filter effect validation succeeds. Planning packages may create render contracts and native render requests, but completed packages that include rendered artifacts must also include the native filter execution result. The execution package must block render artifacts when filter effects are missing or blocked, so media cleanup cannot be skipped after candidate approval.

### Non-Destructive Packaging Filters

These package a validated slice without changing semantic boundaries:

- video stabilization
- smart reframe
- subtitle sync
- keyword highlight
- BGM ducking
- prompt SFX
- cover generation

They still require artifact validation, but not semantic boundary revalidation unless they shift timing.

## Validators

### Evidence Coverage

Fails if required evidence for a slicer or preset is missing.

### Semantic Completeness

Fails if a slice starts or ends mid-sentence, mid-answer, mid-topic, or without required context.

### Speaker Continuity

Fails if speaker turns are split incorrectly, Q/A roles are missing, overlapping speech is unresolved, or multi-person clips lose attribution.

### Boundary Integrity

Fails if intervals are invalid, out of source range, overlapping incorrectly, or not backed by source media.

### Duration Contract

Fails if preset duration constraints are violated.

### Post-Filter Integrity

Runs after destructive filters and re-checks semantic and media boundaries.

### Publishability Standard

Checks product-level output requirements:

- aspect ratio
- resolution
- frame rate
- subtitle policy
- cover policy
- BGM/SFX policy
- visual framing
- audio enhancement

### Render Artifact Integrity

Checks actual generated files, thumbnails, subtitles, and quality report metadata.

## Rendering

The render plan must be deterministic:

- source-backed intervals
- stable output file names
- validated subtitle track
- validated cover artifact
- validated audio package
- render checksum and byte size
- source media id and preset id

Render contracts are executable only when they preserve the selected product preset. Validation must reject stale schema versions, missing source plan ids, empty/blank/duplicate candidate ids, renderer ids outside the preset, renderer-chain mismatches, output profile mismatches, subtitle profile mismatches, audio packaging mismatches, visual packaging mismatches, artifact-kind mismatches, batch-output mismatches, missing render validators, missing native render/probe commands, and invalid output profiles.

Render artifact validation must also enforce deterministic publication output. Every artifact must have a stable non-empty id, a selected candidate id, a unique artifact id, and at most one artifact of each required kind per candidate. Native output that includes artifact kinds not declared by the render contract must be rejected instead of silently published or ignored.

Rust/native should own interval validation, FFmpeg filtergraph construction, cache lookup, execution, and artifact probing.

