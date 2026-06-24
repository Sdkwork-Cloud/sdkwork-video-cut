> Migrated from `docs/specs/smart-cut-engine/01-industry-slicer-taxonomy.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Industry Slicer Taxonomy

## Abstraction

The video industry does not have one universal cutting algorithm. It has different boundary models. The engine must represent those models as strategies.

## Strategy Families

| Family | Slicer | Boundary Unit | Primary Evidence | Typical Use |
| --- | --- | --- | --- | --- |
| Speech | `speech-semantic` | content unit | transcript, speaker | talking head, explainer, course |
| Dialogue | `dialogue-qa` | Q/A pair | transcript, speaker | interview, panel, podcast |
| Topic | `topic-chapter` | topic chapter | transcript, speaker | long interview, meeting, documentary |
| Topic | `meeting-agenda` | agenda section | transcript, speaker, OCR | meetings |
| Topic | `podcast-topic` | story/topic arc | transcript, speaker, audio | podcasts |
| Speech | `knowledge-point` | teaching point | transcript, speaker, OCR | education |
| Visual | `visual-scene` | visual scene | visual | film, documentary, b-roll |
| Visual | `motion-action` | action event | visual, motion | sports, gaming, action |
| Audio | `audio-waveform` | audio event | waveform, activity | cleanup, rough segmentation |
| Music | `music-beat` | beat/phrase | audio, music | music video, rhythm edits |
| Multimodal | `multimodal-highlight` | highlight event | audio, visual, transcript | highlight reels |
| Template | `template-rule` | template window | media metadata | deterministic campaigns |
| Event | `event-detection` | event | audio, visual, event | sports, lectures, commerce |
| Screen | `screen-ocr` | OCR/UI section | OCR, visual | screen recording, slides |
| Commerce | `commerce-live` | product/conversion unit | transcript, speaker, visual | live commerce |
| Documentary | `documentary-chapter` | narrative chapter | visual, audio, transcript | documentary |
| Film | `film-scene` | scene | visual, audio | movies, drama |
| Sports | `sports-event` | score/play event | event, visual, audio | sports clips |
| Gaming | `gaming-highlight` | gameplay event | visual, audio, OCR | games/streaming |
| Vlog | `vlog-story` | story beat | visual, audio, transcript | vlogs |
| Course | `course-chapter` | lesson chapter | transcript, speaker, OCR | courses |
| News | `news-segment` | story segment | transcript, speaker, visual | news |
| Compliance | `compliance` | risk span | transcript, optional media | ads, fluff, risky content |

## Product Preset Vs Slicer

A product preset composes multiple slicers, filters, validators, and renderers. For example:

- `teacher-talking-head-single` uses `speech-semantic` plus `compliance`.
- `interview-one-question-one-answer` uses `dialogue-qa`, `speech-semantic`, and `compliance`.
- `long-interview-matrix` uses `dialogue-qa`, `topic-chapter`, and `compliance`.
- `film-scene-index` uses `film-scene`, `visual-scene`, and `music-beat`.
- `sports-highlight-reel` uses `sports-event` and `multimodal-highlight`.

This separation prevents business modes from hardcoding algorithm details.

## Default Strategy

The default strategy is `speech-semantic` because current original requirements are speech-centric. It still requires speaker evidence, even for a single-person teacher video, because:

- the engine must support correction if diarization finds multiple voices
- repeated takes often look like the same speaker and must be deduplicated by turn/content
- interview and long-interview presets share the same evidence foundation
- future manual speaker correction must not require schema migration

