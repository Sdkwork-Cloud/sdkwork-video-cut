use serde_json::{Value, json};

use crate::models::VideoCutTask;

pub(crate) fn create_plan(
    task: &VideoCutTask,
    media_info_document: Option<&Value>,
    media_info_artifact_id: Option<&str>,
    silence_ranges_artifact_id: Option<&str>,
    vad_ranges_artifact_id: Option<&str>,
    transcript_artifact_id: Option<&str>,
    semantic_analysis_artifact_id: Option<&str>,
) -> Value {
    let source_range = default_source_range(&task.task_type, media_info_document);
    let output_duration_ms = source_range.end_ms.saturating_sub(source_range.start_ms);
    let segment_warnings = segment_warnings(source_range, media_info_document);
    let tracks = [
        "mediaInfoTrack",
        "silenceTrack",
        "speechActivityTrack",
        "transcriptTrack",
        "sceneTrack",
        "subjectTrack",
        "semanticTrack",
        "cutDecisionTrack",
    ]
    .iter()
    .enumerate()
    .map(|(index, kind)| {
        let source_artifact_id = match *kind {
            "mediaInfoTrack" => media_info_artifact_id
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-source", task.task_id)),
            "silenceTrack" => silence_ranges_artifact_id
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-source", task.task_id)),
            "speechActivityTrack" => vad_ranges_artifact_id
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-source", task.task_id)),
            "transcriptTrack" => transcript_artifact_id
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-source", task.task_id)),
            "semanticTrack" => semantic_analysis_artifact_id
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-source", task.task_id)),
            _ => format!("{}-source", task.task_id),
        };

        json!({
            "kind": kind,
            "sourceArtifactId": source_artifact_id,
            "providerId": format!("host-{kind}"),
            "adapterVersion": "host-adapter.v1",
            "inputHash": pseudo_hash(&format!("{}-{kind}-input", task.task_id)),
            "outputHash": pseudo_hash(&format!("{}-{kind}-output", task.task_id)),
            "parameters": { "deterministic": true, "order": index + 1 },
            "warnings": []
        })
    })
    .collect::<Vec<_>>();

    json!({
        "schemaId": "video-cut.split-plan.schema.v1",
        "planVersion": 1,
        "planId": format!("{}-plan-1", task.task_id),
        "planRevision": 1,
        "taskId": task.task_id,
        "sourceName": task.source_name.clone().unwrap_or_else(|| "source.mp4".to_string()),
        "type": task.task_type,
        "outputSpec": {
            "aspectRatio": "9:16",
            "width": 1080,
            "height": 1920,
            "frameRate": 30,
            "format": "mp4"
        },
        "renderPreferences": {
            "audio": {
                "bgm": { "mode": "auto" },
                "bgmVolumePercent": 20,
                "sfx": { "mode": "auto" },
                "voiceEnhancement": "basic"
            }
        },
        "tracks": tracks,
        "segments": [{
            "segmentId": format!("{}-segment-1", task.task_id),
            "title": "长访谈核心问答拆条",
            "type": task.task_type,
            "sourceRange": { "startMs": source_range.start_ms, "endMs": source_range.end_ms },
            "outputRange": { "startMs": 0, "endMs": output_duration_ms },
            "score": 0.86,
            "decisionReasons": ["sentence-boundary", "silence-boundary", "semantic-boundary", "duration-fit"],
            "hardConstraints": ["no-cut-inside-subtitle-sentence", "no-cut-inside-word-timestamp", "duration-between-60-and-180-seconds"],
            "warnings": segment_warnings
        }],
        "createdAt": fixed_time()
    })
}

#[derive(Clone, Copy)]
struct DefaultSourceRange {
    start_ms: u64,
    end_ms: u64,
}

fn default_source_range(
    task_type: &str,
    media_info_document: Option<&Value>,
) -> DefaultSourceRange {
    let Some(duration_ms) = media_duration_ms(media_info_document) else {
        return DefaultSourceRange {
            start_ms: 12_000,
            end_ms: 132_000,
        };
    };

    if duration_ms == 0 {
        return DefaultSourceRange {
            start_ms: 0,
            end_ms: 1_000,
        };
    }

    let target_duration_ms = match task_type {
        "single-speaker" | "interview-qa" => 90_000,
        "long-interview" => 180_000,
        _ => 120_000,
    };
    let start_ms = if duration_ms > target_duration_ms + 12_000 {
        12_000
    } else {
        0
    };
    let available_ms = duration_ms.saturating_sub(start_ms);
    let selected_duration_ms = available_ms.min(target_duration_ms);

    DefaultSourceRange {
        start_ms,
        end_ms: start_ms + selected_duration_ms,
    }
}

fn media_duration_ms(media_info_document: Option<&Value>) -> Option<u64> {
    let document = media_info_document?;
    if document.get("probeStatus").and_then(Value::as_str) != Some("ok") {
        return None;
    }

    document
        .pointer("/format/durationSeconds")
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
        })
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| (value * 1000.0).floor() as u64)
}

fn segment_warnings(
    source_range: DefaultSourceRange,
    media_info_document: Option<&Value>,
) -> Vec<String> {
    let Some(duration_ms) = media_duration_ms(media_info_document) else {
        return vec![
            "Media duration is unavailable; using conservative fallback source range.".to_string(),
        ];
    };
    let selected_duration_ms = source_range.end_ms.saturating_sub(source_range.start_ms);
    if selected_duration_ms < 60_000 {
        return vec![format!(
            "Source duration is shorter than the standard short-video target: {duration_ms}ms."
        )];
    }

    Vec::new()
}

pub(crate) fn default_settings() -> Value {
    json!({
        "ai": {
            "enabled": false,
            "baseUrl": "https://api.openai.com",
            "apiKeyConfigured": false,
            "chatModel": "gpt-4.1-mini",
            "structuredOutputMode": "json-schema",
            "temperature": 0.2,
            "timeoutSeconds": 45,
            "retryCount": 2
        },
        "speechToText": {
            "enabled": false,
            "providerProfile": "openai-audio-transcriptions",
            "reuseAiProviderConnection": true,
            "baseUrl": "https://api.openai.com",
            "apiKeyConfigured": false,
            "transcriptionModel": "gpt-4o-mini-transcribe",
            "resourceId": "volc.bigasr.auc",
            "languageHint": "zh",
            "timestampGranularity": "segment",
            "diarizationEnabled": false,
            "localWhisperFallbackEnabled": false
        },
        "subtitle": {
            "language": "zh-CN",
            "fontFamily": "极宋",
            "fontFallback": "Noto Serif SC",
            "fontSize": 64,
            "maxLines": 2,
            "shadowOpacity": 0.95,
            "shadowBlur": 0.09,
            "highlightColor": "#ffd84d",
            "position": "bottom-safe"
        },
        "mediaTools": {
            "ffmpegPath": "ffmpeg",
            "ffprobePath": "ffprobe",
            "onnxRuntimeEnabled": true,
            "sileroVadModelPath": "models/silero-vad.onnx",
            "workerConcurrency": 2,
            "maxUploadBytes": 8589934592u64
        },
        "assets": {
            "fonts": "assets/fonts",
            "bgm": "assets/bgm",
            "sfx": "assets/sfx",
            "coverTemplates": "assets/cover-templates"
        },
        "storage": {
            "workspaceRoot": "./workspace",
            "artifactRoot": "./workspace/artifacts",
            "tempRoot": "./workspace/tmp",
            "retentionDays": 30
        },
        "runtime": {
            "deploymentMode": "desktop-local",
            "bindHost": "127.0.0.1",
            "port": 6177,
            "publicBaseUrl": "http://127.0.0.1:6177",
            "authMode": "none"
        },
        "security": {
            "secretProvider": "local-secure-store",
            "corsAllowedOrigins": ["http://127.0.0.1:5173", "http://localhost:5173"],
            "diagnosticsIncludeSourceMedia": false,
            "diagnosticsIncludeTranscript": false,
            "redactionEnabled": true
        }
    })
}

pub(crate) fn pseudo_hash(seed: &str) -> String {
    let mut value = format!("{seed}-sha256");
    value.extend(std::iter::repeat_n('0', 64));
    value.chars().take(64).collect()
}

pub(crate) fn fixed_time() -> String {
    "2026-04-27T00:00:00.000Z".to_string()
}
