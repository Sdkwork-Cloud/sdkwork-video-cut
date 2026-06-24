> Migrated from `docs/specs/smart-cut-engine/02-speech-semantic-and-speaker-pipeline.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Speech Semantic And Speaker Pipeline

## Why The Legacy Algorithm Is Insufficient

Cutting spoken videos by arbitrary duration, audio activity, or loose LLM time ranges does not protect logical completeness. Real spoken content has:

- setup and payoff
- question and answer dependency
- speaker interruptions
- backchannels
- repeated takes
- corrections and re-statements
- topic transitions
- open-ended connector words
- silence that is part of pacing

Therefore the algorithm must build content units first and only run cleanup filters after the semantic cut is chosen.

## Required Data Structures

### Transcript Evidence

Transcript evidence stores:

- segment id
- start/end milliseconds
- text
- language
- confidence
- optional token ids
- optional speaker id

This is not enough by itself for multi-person content, but it is the base timing layer.

### Speaker Evidence

Speaker evidence is same-level evidence, not metadata hidden inside transcript rows.

It must include:

- `SpeakerProfile`: id, display name, role, confidence, source, voiceprint id
- `SpeakerSegment`: stable id, speaker id, start/end, confidence, channel, overlap group id
- `SpeakerTurn`: stable id, speaker id, start/end, sentence ids, transcript segment ids, text, question/answer/interruption/backchannel flags, topic ids, risks
- `OverlappingSpeechGroup`: stable id, start/end, speaker ids, speaker segment ids, severity
- `SpeakerRoleAssignment`: speaker id, role, confidence, evidence turn ids, source
- `SpeakerCorrection`: rename, assign role, merge, split, or reassign time range

### Content Unit

A content unit is the minimum semantic planning object:

- id
- time range
- unit kind
- speaker ids
- speaker turn ids
- speaker roles
- speaker confidence
- overlap group ids
- transcript segment ids
- evidence ids
- topic ids
- semantic completeness score
- continuity score
- publishability score

The slicer can only create candidates by referencing content unit ids.

## Pipeline

1. Prepare source media.
2. Extract deterministic native media evidence.
3. Run speech-to-text with timestamps.
4. Run speaker diarization.
5. Align transcript segments to speaker segments.
6. Build sentence and speaker-turn layers.
7. Infer speaker roles where needed.
8. Build Q/A pairs, topic blocks, and standard content units.
9. Generate deterministic candidate ranges from content units.
10. Ask LLM to review/rank candidates by stable ids.
11. Validate semantic completeness and speaker continuity.
12. Run post-slice filters.
13. Revalidate destructive filter results.
14. Render publishable artifacts.

The standard public API for this default path is `createSmartCutSpeechFirstExecutionPackageFromProviders`. It owns provider execution and the deterministic standard sequence:

- call `SmartCutSpeechToTextProvider`
- validate transcript evidence before diarization
- call `SmartCutSpeakerDiarizationProvider`
- validate speaker evidence before alignment through the shared `validateSmartCutSpeakerEvidenceStructure` gate
- align transcript segments to speaker segments
- build standard content units and candidates
- call `SmartCutLlmCandidateReviewer` for raw constrained JSON
- normalize and validate LLM review evidence
- create the execution package
- create a provider-aware audit trace

If STT, diarization, alignment, content-unit build, or the LLM provider fails, the result is blocked, includes source/code de-duplicated blockers, and still includes a provider-aware audit trace. It must not fabricate LLM review evidence or an execution package for pre-LLM failures. Provider failures become standard blockers such as `SPEECH_TO_TEXT_PROVIDER_FAILED`, `TRANSCRIPT_EVIDENCE_INVALID`, `TRANSCRIPT_EVIDENCE_KIND_INVALID`, `TRANSCRIPT_SCHEMA_VERSION_INVALID`, `TRANSCRIPT_PROVIDER_MISSING`, `TRANSCRIPT_LANGUAGE_MISSING`, `TRANSCRIPT_SEGMENTS_INVALID`, `MISSING_TRANSCRIPT_EVIDENCE`, `TRANSCRIPT_SEGMENT_INVALID`, `TRANSCRIPT_SEGMENT_ID_MISSING`, `DUPLICATE_TRANSCRIPT_SEGMENT_ID`, `TRANSCRIPT_SEGMENT_TEXT_MISSING`, `INVALID_TRANSCRIPT_SEGMENT_RANGE`, `TRANSCRIPT_SEGMENT_OUT_OF_SOURCE`, `TRANSCRIPT_SEGMENTS_OVERLAP`, `TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID`, `LOW_TRANSCRIPT_CONFIDENCE`, `SPEAKER_DIARIZATION_PROVIDER_FAILED`, `SPEAKER_EVIDENCE_INVALID`, `SPEAKER_EVIDENCE_KIND_INVALID`, `SPEAKER_SCHEMA_VERSION_INVALID`, `SPEAKER_PROFILES_INVALID`, `SPEAKER_SEGMENTS_INVALID`, `SPEAKER_TURNS_INVALID`, `OVERLAP_GROUPS_INVALID`, `SPEAKER_ROLE_ASSIGNMENTS_INVALID`, `SPEAKER_CORRECTIONS_INVALID`, `SPEAKER_PROFILE_INVALID`, `SPEAKER_SEGMENT_INVALID`, `SPEAKER_TURN_INVALID`, `OVERLAP_GROUP_INVALID`, `SPEAKER_ROLE_ASSIGNMENT_INVALID`, `SPEAKER_CORRECTION_INVALID`, `MISSING_SPEAKER_DIARIZATION`, `SPEAKER_PROFILE_ID_MISSING`, `DUPLICATE_SPEAKER_PROFILE_ID`, `SPEAKER_PROFILE_DISPLAY_NAME_MISSING`, `SPEAKER_PROFILE_CONFIDENCE_INVALID`, `SPEAKER_PROFILE_ROLE_INVALID`, `SPEAKER_PROFILE_SOURCE_INVALID`, `SPEAKER_SEGMENT_ID_MISSING`, `DUPLICATE_SPEAKER_SEGMENT_ID`, `SPEAKER_SEGMENT_SPEAKER_ID_MISSING`, `SPEAKER_SEGMENT_CONFIDENCE_INVALID`, `INVALID_SPEAKER_SEGMENT_RANGE`, `UNKNOWN_SPEAKER_REFERENCE`, `SPEAKER_TURN_ID_MISSING`, `DUPLICATE_SPEAKER_TURN_ID`, `INVALID_SPEAKER_TURN_RANGE`, `SPEAKER_TURN_OUT_OF_SOURCE`, `SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS`, `SPEAKER_TURN_TEXT_MISSING`, `SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT`, `SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH`, `SPEAKER_TURN_UNKNOWN_SPEAKER`, `SPEAKER_TURN_SPEAKER_MISMATCH`, `OVERLAP_GROUP_ID_MISSING`, `DUPLICATE_OVERLAP_GROUP_ID`, `INVALID_OVERLAP_GROUP_RANGE`, `OVERLAP_GROUP_OUT_OF_SOURCE`, `OVERLAP_GROUP_WITHOUT_MULTIPLE_SPEAKERS`, `DUPLICATE_OVERLAP_GROUP_SPEAKER`, `OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE`, `OVERLAP_GROUP_WITHOUT_SEGMENTS`, `DUPLICATE_OVERLAP_GROUP_SEGMENT`, `OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE`, `OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH`, `OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH`, `OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT`, `OVERLAP_GROUP_WITHOUT_REAL_OVERLAP`, `SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER`, `SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID`, `SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID`, `SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID`, `SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN`, `SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH`, `SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS`, `SPEAKER_ROLE_ASSIGNMENT_CONFLICT`, or `LLM_REVIEW_PROVIDER_FAILED`.

`createSmartCutSpeechFirstExecutionPackage` is the lower-level gate for callers that already have STT transcript evidence, diarization evidence, and raw LLM review output. It deliberately starts after provider output exists, then owns the deterministic standard sequence from alignment through execution packaging and audit trace creation. Callers should not manually stitch together content-unit, LLM-review, execution-package, and audit calls.

## Multi-Person Rules

- Interviews require interviewer/guest role assignment.
- Role assignment evidence must reference known speakers and known turns, confidence must be 0-1, turn evidence must belong to the same speaker, and overlapping role scopes for one speaker must resolve to exactly one role.
- Q/A clips must include the triggering question and a complete answer.
- Q/A clips must preserve interviewer/host/moderator question followed by guest/teacher/speaker answer role order.
- Candidate `unitIds` must stay in chronological speaker-turn order; validators reject reordered unit ids even when timestamps are otherwise covered.
- Long-interview matrix clips must be 60-180 seconds.
- Meeting clips must preserve decision/action-item context.
- Interruptions may be included only if they clarify the answer or are needed for continuity.
- Backchannels should usually be ignored unless they mark a turn boundary.
- Overlapping speech must be explicitly represented and validated. Each overlap group must be uniquely identified, stay inside the source, reference at least two distinct speakers and segments, avoid duplicate members, ensure referenced segment speakers match the group speakers, ensure every group speaker has a matching referenced segment, ensure referenced segments overlap the group range, and prove at least two different speaker segments actually overlap inside the group range. A candidate must include every content unit in an overlap group or cut outside the overlap.
- Speaker correction must be possible before final render.

## Transcript-Speaker Alignment Gate

The standard alignment step is `alignSmartCutTranscriptSpeakers`. It consumes timestamped `transcriptEvidence` and diarized `speakerEvidence.segments`, then emits an updated `speakerEvidence` with deterministic `speakerEvidence.turns` and a `SmartCutTranscriptSpeakerAlignmentReport`.

The alignment step must:

- sort transcript segments by timestamp
- reject invalid transcript segment ranges
- resolve each transcript segment speaker by declared speaker id when it has reliable diarization overlap, otherwise by maximum diarization overlap
- fail closed when a transcript segment has no reliable speaker overlap
- merge adjacent real-content segments from the same speaker into one speaker turn when the gap is small and the merge does not cross questions or backchannels
- keep filler/backchannel transcript segments as separate low-information speaker turns
- create deterministic turn ids scoped by speaker id and turn order
- rewrite empty role assignment evidence ids to the aligned speaker turn ids for that speaker
- produce a report with transcript count, aligned count, unaligned count, turn count, deterministic turn ids, distinct speaker count, and blocker codes

This alignment step is the only standard source of generated speaker turns. Content-unit construction consumes `speakerEvidence.turns`; it must not invent turn ids internally.

Speaker turns that arrive from provider evidence or direct execution evidence are accepted only when they have stable unique ids, valid in-source time ranges, non-empty normalized text, at least one transcript segment id, known speaker ids, known transcript segment ids, transcript segment speaker ownership that matches the turn speaker, and timestamp overlap with every referenced transcript segment.

Execution packaging must require this alignment report as a first-class gate. The package must block when the report is missing, blocked, when its `turnCount`, `turnIds`, or distinct speaker count no longer match the supplied `speakerEvidence.turns`, or when its transcript coverage counts no longer match the supplied `transcriptEvidence`. This prevents callers from hand-writing speaker turns or copying an alignment report from a different transcript after content units have been built.

## Standard Content Unit Build Gate

The default speech semantic slicer must use the standard content unit builder before it creates any candidate. Execution packaging must still require the original transcript and speaker evidence plus the standard transcript-speaker alignment report; hand-written content units cannot replace the build report, and copied build or alignment reports cannot replace the evidence-quality gate. The execution package must reject missing build reports, missing alignment reports, alignment/speaker-turn mismatches, and any mismatch between `contentUnits` and the build report units. The builder must:

- sort transcript segments by timestamp
- resolve speaker id from the transcript segment or by maximum overlap with diarization segments
- preserve real speaker turn ids, speaker roles, speaker confidence, and overlapping speech group ids
- merge adjacent transcript segments from the same speaker only when both sides contain real content
- keep low-information backchannels and filler-only speech as low-publishability audit units
- infer question and answer boundary units for dialogue presets
- reject dangling connectors, cross-speaker merged units, missing transcript/speaker evidence declarations, missing speaker turns, missing speaker roles, weak speaker confidence, orphan questions, orphan answers, and invalid ranges
- emit a `SmartCutContentUnitBuildReport` with blocker codes and publishable/low-information counts

The default `speech-semantic` planner may still expose a deterministic speaker-turn fallback for alignment diagnostics when provider turns are missing, but generated fallback turns are not valid execution evidence. Candidate boundaries are built from the standard content units, content units must reference real `speakerEvidence.turns`, and the content unit build report must fail closed when turns are missing. If the report is blocked, the execution package must fail closed before post-slice filters or render.

## Content Unit Evidence Link Gate

The execution package must validate that content units and the build report are not merely self-consistent; they must be traceable to the same transcript and speaker evidence supplied to the package. This gate runs before filters and render, and it blocks when any content unit:

- does not declare both `transcript` and `speaker` in `evidenceIds`
- references a transcript segment id that is missing from `transcriptEvidence.segments`
- has a time range or text that no longer matches its referenced transcript segments
- references a speaker id that is missing from `speakerEvidence.profiles`
- lacks speaker-segment overlap for the unit time range
- references a speaker turn id that is missing from `speakerEvidence.turns`
- references a speaker turn whose speaker id or transcript segment ids do not match the unit
- carries a speaker role that is not supported by the speaker profile or role assignments
- references an overlap group that is missing or does not overlap the unit

This gate is separate from evidence quality and content-unit-build validation. Evidence quality proves the raw transcript/speaker evidence is usable. The build report proves the standard builder produced valid content units. The evidence-link gate proves those content units were not copied, hand-written, or mutated away from the exact evidence that will be rendered and audited.

## Candidate Speaker Context Gate

Candidate validation must re-check the structure and speaker context on every referenced content unit even when a caller passes hand-written `contentUnits` without a build report. A candidate is blocked when any referenced unit has:

- invalid time range
- no transcript segment trace
- stable speaker ids
- speaker turn ids
- resolved speaker roles
- multiple speaker ids merged into one unit
- minimum speaker confidence

This duplicate gate is intentional. The content-unit-build report proves the canonical builder produced valid units; candidate validation proves later orchestration code did not bypass or mutate the speaker-aware structure before filters and render. Multi-person clips are represented as ordered single-speaker content units inside one candidate, not as one merged multi-speaker content unit.

## LLM Contract

The LLM receives content units and candidate ids. It may return:

- ranked candidate ids
- merge or split suggestions by unit ids
- title, hook, cover angle, keywords
- semantic risks
- reason codes

It may not return standalone timestamps. Any result without stable ids is rejected.

The LLM reviewer strategy returns raw constrained JSON only. It must not return already-normalized `llm-review` evidence, because normalization and validation are standard gates, not provider responsibilities. Execution packaging must require the normalized LLM review report before post-slice filters or render. The report is validated by the shared `validateSmartCutLlmCandidateReviewReport` gate, not by ad hoc execution-package logic. A package is blocked when the review report is missing, blocked, lacks normalized evidence, has the wrong evidence kind or schema version, omits the reviewer model id, contains raw timestamp cuts, contains blank or duplicate ids, references unknown stable ids, references candidate ids outside the current execution plan, references content unit ids that are not used by executable candidates, or fails to reference the executable candidate ids and their content unit ids. This preserves the rule that LLM output can rank/review candidates but cannot become an unaudited boundary source.

After the LLM review report passes validation, candidate selection may use `rankedCandidateIds` as a priority signal. The ranking is applied only to candidates that already pass deterministic content-unit, quality, preset-duration, and overlap checks; it never creates new boundaries and never allows low-quality or invalid candidates to pass.

