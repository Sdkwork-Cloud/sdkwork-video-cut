use std::collections::HashMap;
use std::path::Path;

use serde_json::{Value, json};

use crate::models::ManualTranscriptInput;
use crate::speech_transcription::execute_speech_transcription_bridge;

pub(crate) const TRANSCRIPT_SCHEMA_ID: &str = "video-cut.transcript.schema.v1";

pub(crate) fn manual_transcript_document(
    settings: &Value,
    input: &ManualTranscriptInput,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
) -> Result<Value, String> {
    let segments = manual_segments(task_id, input)?;
    let text = input
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            segments
                .iter()
                .filter_map(|segment| segment.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        });
    let duration_seconds = segments
        .iter()
        .filter_map(|segment| segment.get("endMs").and_then(Value::as_u64))
        .max()
        .map(|end_ms| end_ms as f64 / 1000.0)
        .unwrap_or_default();
    let language = input
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let configured = string_at(settings, "/speechToText/languageHint");
            if configured.trim().is_empty() {
                "zh".to_string()
            } else {
                configured
            }
        });

    Ok(json!({
        "schemaId": TRANSCRIPT_SCHEMA_ID,
        "transcriptVersion": 1,
        "taskId": task_id,
        "audioArtifactId": audio_artifact_id,
        "audioPath": audio_artifact_path,
        "providerId": "manual-transcript",
        "adapterVersion": "manual-transcript.adapter.v1",
        "transcriptStatus": "ok",
        "language": language,
        "timestampGranularity": ["segment"],
        "durationSeconds": duration_seconds,
        "text": text,
        "segments": segments,
        "warnings": [],
        "createdAt": crate::contracts::fixed_time()
    }))
}

#[cfg(test)]
fn transcribe_audio_document(
    settings: &Value,
    audio_file_path: &Path,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    audio_available: bool,
) -> Value {
    if !audio_available || !audio_file_path.is_file() {
        return transcript_status_document(
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "audio-unavailable",
            vec![format!(
                "Audio file is not available at {}.",
                audio_file_path.display()
            )],
        );
    }

    if !bool_at(settings, "/speechToText/enabled") {
        return transcript_status_document(
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "provider-unavailable",
            vec!["Speech-to-text provider is disabled.".to_string()],
        );
    }

    let reuse_ai_provider = bool_at(settings, "/speechToText/reuseAiProviderConnection");
    let credential_configured = if reuse_ai_provider {
        bool_at(settings, "/ai/apiKeyConfigured")
    } else {
        bool_at(settings, "/speechToText/apiKeyConfigured")
    };
    let base_url = if reuse_ai_provider {
        string_at(settings, "/ai/baseUrl")
    } else {
        string_at(settings, "/speechToText/baseUrl")
    };
    let model = string_at(settings, "/speechToText/transcriptionModel");

    if base_url.trim().is_empty() || model.trim().is_empty() || !credential_configured {
        return transcript_status_document(
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "provider-unavailable",
            vec!["OpenAI-compatible transcription provider is not fully configured.".to_string()],
        );
    }

    transcript_status_document(
        settings,
        task_id,
        audio_artifact_id,
        audio_artifact_path,
        "provider-unavailable",
        vec![
            "OpenAI-compatible transcription HTTP execution is not linked in this host build."
                .to_string(),
        ],
    )
}

pub(crate) async fn transcribe_audio_document_with_http(
    settings: &Value,
    secrets: &HashMap<String, String>,
    audio_file_path: &Path,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    audio_available: bool,
) -> Value {
    if !audio_available || !audio_file_path.is_file() {
        return transcript_status_document(
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "audio-unavailable",
            vec![format!(
                "Audio file is not available at {}.",
                audio_file_path.display()
            )],
        );
    }

    if !bool_at(settings, "/speechToText/enabled") {
        return transcript_status_document(
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "provider-unavailable",
            vec!["Speech-to-text provider is disabled.".to_string()],
        );
    }

    match execute_speech_transcription_bridge(settings, secrets, audio_file_path).await {
        Ok(result) => transcript_success_document(TranscriptSuccessInput {
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            provider_json: &result.canonical_json,
            granularity: &result.granularity,
            provider_id: &result.provider_id,
            adapter_version: &result.adapter_version,
        }),
        Err(error) => transcript_status_document(
            settings,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            error.transcript_status,
            vec![error.message],
        ),
    }
}

fn transcript_status_document(
    settings: &Value,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    transcript_status: &str,
    warnings: Vec<String>,
) -> Value {
    let granularity = string_at(settings, "/speechToText/timestampGranularity");
    json!({
        "schemaId": TRANSCRIPT_SCHEMA_ID,
        "transcriptVersion": 1,
        "taskId": task_id,
        "audioArtifactId": audio_artifact_id,
        "audioPath": audio_artifact_path,
        "providerId": "openai-compatible-transcription",
        "adapterVersion": "openai-compatible-transcription.adapter.v1",
        "transcriptStatus": transcript_status,
        "language": string_at(settings, "/speechToText/languageHint"),
        "timestampGranularity": [if granularity.trim().is_empty() { "segment" } else { granularity.as_str() }],
        "durationSeconds": 0,
        "text": "",
        "segments": [],
        "warnings": warnings,
        "createdAt": crate::contracts::fixed_time()
    })
}

fn manual_segments(task_id: &str, input: &ManualTranscriptInput) -> Result<Vec<Value>, String> {
    if input.segments.is_empty() {
        return Err("Manual transcript must contain at least one segment.".to_string());
    }
    if input.segments.len() > 1000 {
        return Err("Manual transcript cannot contain more than 1000 segments.".to_string());
    }

    let mut previous_end_ms = 0;
    input
        .segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let text = segment.text.trim();
            if text.is_empty() {
                return Err(format!(
                    "Manual transcript segment {} text is empty.",
                    index + 1
                ));
            }
            if segment.end_ms <= segment.start_ms {
                return Err(format!(
                    "Manual transcript segment {} must have endMs greater than startMs.",
                    index + 1
                ));
            }
            if index > 0 && segment.start_ms < previous_end_ms {
                return Err(format!(
                    "Manual transcript segment {} overlaps the previous segment.",
                    index + 1
                ));
            }
            previous_end_ms = segment.end_ms;

            let mut value = json!({
                "segmentId": format!("{task_id}-manual-transcript-segment-{}", index + 1),
                "startMs": segment.start_ms,
                "endMs": segment.end_ms,
                "text": text
            });
            if let Some(speaker_id) = segment
                .speaker_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                value["speakerId"] = json!(speaker_id);
            }

            Ok(value)
        })
        .collect()
}

struct TranscriptSuccessInput<'a> {
    settings: &'a Value,
    task_id: &'a str,
    audio_artifact_id: &'a str,
    audio_artifact_path: &'a str,
    provider_json: &'a Value,
    granularity: &'a str,
    provider_id: &'a str,
    adapter_version: &'a str,
}

fn transcript_success_document(input: TranscriptSuccessInput<'_>) -> Value {
    let text = input
        .provider_json
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let language = input
        .provider_json
        .get("language")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| string_at(input.settings, "/speechToText/languageHint"));
    let duration_seconds = input
        .provider_json
        .get("duration")
        .and_then(Value::as_f64)
        .unwrap_or_else(|| max_segment_end_seconds(input.provider_json));
    let segments = input
        .provider_json
        .get("segments")
        .and_then(Value::as_array)
        .map(|segments| {
            segments
                .iter()
                .enumerate()
                .filter_map(|(index, segment)| transcript_segment(input.task_id, index, segment))
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default();

    json!({
        "schemaId": TRANSCRIPT_SCHEMA_ID,
        "transcriptVersion": 1,
        "taskId": input.task_id,
        "audioArtifactId": input.audio_artifact_id,
        "audioPath": input.audio_artifact_path,
        "providerId": input.provider_id,
        "adapterVersion": input.adapter_version,
        "transcriptStatus": "ok",
        "language": language,
        "timestampGranularity": [input.granularity],
        "durationSeconds": duration_seconds.max(0.0),
        "text": text,
        "segments": segments,
        "warnings": [],
        "createdAt": crate::contracts::fixed_time()
    })
}

fn transcript_segment(task_id: &str, index: usize, segment: &Value) -> Option<Value> {
    let start = segment.get("start").and_then(Value::as_f64)?;
    let end = segment.get("end").and_then(Value::as_f64)?;
    if end <= start {
        return None;
    }

    let text = segment
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if text.trim().is_empty() {
        return None;
    }

    let mut value = json!({
        "segmentId": format!("{task_id}-transcript-segment-{}", index + 1),
        "startMs": seconds_to_millis(start),
        "endMs": seconds_to_millis(end),
        "text": text
    });
    if let Some(confidence) = segment.get("confidence").and_then(Value::as_f64) {
        value["confidence"] = json!(confidence.clamp(0.0, 1.0));
    }
    if let Some(speaker_id) = segment.get("speaker").and_then(Value::as_str) {
        value["speakerId"] = json!(speaker_id);
    }

    Some(value)
}

fn max_segment_end_seconds(provider_json: &Value) -> f64 {
    provider_json
        .get("segments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|segment| segment.get("end").and_then(Value::as_f64))
        .fold(0.0, f64::max)
}

fn seconds_to_millis(value: f64) -> u64 {
    (value.max(0.0) * 1000.0).round() as u64
}

fn bool_at(settings: &Value, pointer: &str) -> bool {
    settings
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn string_at(settings: &Value, pointer: &str) -> String {
    settings
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use axum::extract::Multipart;
    use axum::http::HeaderMap;
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    use super::{transcribe_audio_document, transcribe_audio_document_with_http};

    #[test]
    fn reports_audio_unavailable_without_faking_segments() {
        let document = transcribe_audio_document(
            &json!({ "speechToText": { "languageHint": "zh", "timestampGranularity": "segment" } }),
            Path::new("missing.wav"),
            "task-001",
            "task-001-audio-source",
            "workspace/projects/default/tasks/task-001/audio/source.wav",
            false,
        );

        assert_eq!(document["schemaId"], "video-cut.transcript.schema.v1");
        assert_eq!(document["transcriptStatus"], "audio-unavailable");
        assert_eq!(document["segments"].as_array().expect("segments").len(), 0);
        assert!(
            !document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn posts_openai_compatible_transcription_and_maps_segments_without_leaking_secret() {
        let captured = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured_for_handler = Arc::clone(&captured);
        let app = Router::new().route(
            "/v1/audio/transcriptions",
            post(move |headers: HeaderMap, multipart: Multipart| {
                let captured = Arc::clone(&captured_for_handler);
                async move { handle_transcription_request(headers, multipart, captured).await }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("mock server");
        });

        let audio_path = std::env::temp_dir().join(format!(
            "video-cut-transcript-{}.wav",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&audio_path, b"fake wav bytes").expect("audio file");
        let mut secrets = HashMap::new();
        secrets.insert(
            "settings://speech-to-text/api-key".to_string(),
            "sk-test-secret".to_string(),
        );

        let document = transcribe_audio_document_with_http(
            &json!({
                "ai": {
                    "enabled": false
                },
                "speechToText": {
                    "enabled": true,
                    "reuseAiProviderConnection": false,
                    "baseUrl": base_url,
                    "apiKeyConfigured": true,
                    "transcriptionModel": "gpt-4o-mini-transcribe",
                    "languageHint": "zh",
                    "timestampGranularity": "segment"
                }
            }),
            &secrets,
            &audio_path,
            "task-001",
            "task-001-audio-source",
            "workspace/projects/default/tasks/task-001/audio/source.wav",
            true,
        )
        .await;
        let _ = std::fs::remove_file(&audio_path);

        assert_eq!(document["schemaId"], "video-cut.transcript.schema.v1");
        assert_eq!(document["transcriptStatus"], "ok");
        assert_eq!(document["text"], "你好，世界");
        assert_eq!(document["segments"][0]["startMs"], 0);
        assert_eq!(document["segments"][0]["endMs"], 1200);
        assert_eq!(document["segments"][0]["text"], "你好，世界");
        assert!(
            document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
        let serialized = document.to_string();
        assert!(!serialized.contains("sk-test-secret"));
        let captured = captured.lock().expect("captured");
        assert!(captured.contains(&"model:gpt-4o-mini-transcribe".to_string()));
        assert!(captured.contains(&"authorization:configured".to_string()));
        assert!(captured.contains(&"file:source.wav".to_string()));
    }

    #[tokio::test]
    async fn posts_volcengine_bigasr_flash_and_maps_utterances_to_standard_transcript() {
        let captured = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured_for_handler = Arc::clone(&captured);
        let app = Router::new().route(
            "/api/v3/auc/bigmodel/recognize/flash",
            post(
                move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                    let captured = Arc::clone(&captured_for_handler);
                    async move { handle_volcengine_request(headers, body, captured).await }
                },
            ),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind volcengine mock server");
        let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("mock server");
        });

        let audio_path = std::env::temp_dir().join(format!(
            "video-cut-volcengine-transcript-{}.wav",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&audio_path, b"fake wav bytes").expect("audio file");
        let mut secrets = HashMap::new();
        secrets.insert(
            "settings://speech-to-text/api-key".to_string(),
            "volcengine-secret".to_string(),
        );

        let document = transcribe_audio_document_with_http(
            &json!({
                "ai": {
                    "enabled": false,
                    "timeoutSeconds": 45,
                    "retryCount": 2
                },
                "speechToText": {
                    "enabled": true,
                    "providerProfile": "volcengine-bigasr-flash",
                    "reuseAiProviderConnection": false,
                    "baseUrl": base_url,
                    "apiKeyConfigured": true,
                    "transcriptionModel": "bigmodel",
                    "languageHint": "zh",
                    "timestampGranularity": "segment",
                    "resourceId": "volc.bigasr.auc"
                }
            }),
            &secrets,
            &audio_path,
            "task-volc",
            "task-volc-audio-source",
            "workspace/projects/default/tasks/task-volc/audio/source.wav",
            true,
        )
        .await;
        let _ = std::fs::remove_file(&audio_path);

        assert_eq!(document["schemaId"], "video-cut.transcript.schema.v1");
        assert_eq!(document["providerId"], "volcengine-bigasr-flash");
        assert_eq!(
            document["adapterVersion"],
            "speech-to-text-bridge.adapter.v1"
        );
        assert_eq!(document["transcriptStatus"], "ok");
        assert_eq!(document["text"], "volcengine transcript");
        assert_eq!(document["segments"][0]["startMs"], 120);
        assert_eq!(document["segments"][0]["endMs"], 960);
        assert_eq!(document["segments"][0]["text"], "volcengine segment");
        assert_eq!(document["segments"][0]["confidence"], 0.91);
        assert!(
            document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
        let serialized = document.to_string();
        assert!(!serialized.contains("volcengine-secret"));
        assert!(!serialized.contains(&audio_path.display().to_string()));

        let captured = captured.lock().expect("captured");
        assert!(captured.contains(&"x-api-key:configured".to_string()));
        assert!(captured.contains(&"resource:volc.bigasr.auc".to_string()));
        assert!(captured.contains(&"audio-data:configured".to_string()));
    }

    #[tokio::test]
    async fn posts_aliyun_qwen_asr_compatible_chat_and_maps_json_content_to_standard_transcript() {
        let captured = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured_for_handler = Arc::clone(&captured);
        let app = Router::new().route(
            "/compatible-mode/v1/chat/completions",
            post(
                move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                    let captured = Arc::clone(&captured_for_handler);
                    async move { handle_aliyun_qwen_request(headers, body, captured).await }
                },
            ),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind aliyun mock server");
        let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("mock server");
        });

        let audio_path = std::env::temp_dir().join(format!(
            "video-cut-aliyun-transcript-{}.wav",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&audio_path, b"fake wav bytes").expect("audio file");
        let mut secrets = HashMap::new();
        secrets.insert(
            "settings://speech-to-text/api-key".to_string(),
            "aliyun-secret".to_string(),
        );

        let document = transcribe_audio_document_with_http(
            &json!({
                "ai": {
                    "enabled": false,
                    "timeoutSeconds": 45,
                    "retryCount": 2
                },
                "speechToText": {
                    "enabled": true,
                    "providerProfile": "aliyun-qwen-asr",
                    "reuseAiProviderConnection": false,
                    "baseUrl": base_url,
                    "apiKeyConfigured": true,
                    "transcriptionModel": "qwen3-asr-flash",
                    "languageHint": "zh",
                    "timestampGranularity": "segment"
                }
            }),
            &secrets,
            &audio_path,
            "task-aliyun",
            "task-aliyun-audio-source",
            "workspace/projects/default/tasks/task-aliyun/audio/source.wav",
            true,
        )
        .await;
        let _ = std::fs::remove_file(&audio_path);

        assert_eq!(document["schemaId"], "video-cut.transcript.schema.v1");
        assert_eq!(document["providerId"], "aliyun-qwen-asr");
        assert_eq!(
            document["adapterVersion"],
            "speech-to-text-bridge.adapter.v1"
        );
        assert_eq!(document["transcriptStatus"], "ok");
        assert_eq!(document["text"], "aliyun transcript");
        assert_eq!(document["segments"][0]["startMs"], 200);
        assert_eq!(document["segments"][0]["endMs"], 1400);
        assert_eq!(document["segments"][0]["text"], "aliyun segment");
        assert!(
            document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
        let serialized = document.to_string();
        assert!(!serialized.contains("aliyun-secret"));
        assert!(!serialized.contains(&audio_path.display().to_string()));

        let captured = captured.lock().expect("captured");
        assert!(captured.contains(&"authorization:configured".to_string()));
        assert!(captured.contains(&"model:qwen3-asr-flash".to_string()));
        assert!(captured.contains(&"input-audio:configured".to_string()));
    }

    async fn handle_transcription_request(
        headers: HeaderMap,
        mut multipart: Multipart,
        captured: Arc<Mutex<Vec<String>>>,
    ) -> Json<serde_json::Value> {
        if headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            == Some("Bearer sk-test-secret")
        {
            captured
                .lock()
                .expect("captured")
                .push("authorization:configured".to_string());
        }

        while let Some(field) = multipart.next_field().await.expect("multipart field") {
            let name = field.name().unwrap_or_default().to_string();
            let file_name = field.file_name().unwrap_or_default().to_string();
            let bytes = field.bytes().await.expect("field bytes");
            if name == "model" {
                captured.lock().expect("captured").push(format!(
                    "model:{}",
                    String::from_utf8(bytes.to_vec()).expect("model")
                ));
            }
            if name == "file" {
                captured
                    .lock()
                    .expect("captured")
                    .push(format!("file:{file_name}"));
            }
        }

        Json(json!({
            "text": "你好，世界",
            "language": "zh",
            "duration": 1.2,
            "segments": [
                {
                    "id": 0,
                    "start": 0.0,
                    "end": 1.2,
                    "text": "你好，世界"
                }
            ]
        }))
    }

    async fn handle_volcengine_request(
        headers: HeaderMap,
        body: serde_json::Value,
        captured: Arc<Mutex<Vec<String>>>,
    ) -> Json<serde_json::Value> {
        if headers
            .get("x-api-key")
            .and_then(|value| value.to_str().ok())
            == Some("volcengine-secret")
        {
            captured
                .lock()
                .expect("captured")
                .push("x-api-key:configured".to_string());
        }
        if let Some(resource_id) = headers
            .get("x-api-resource-id")
            .and_then(|value| value.to_str().ok())
        {
            captured
                .lock()
                .expect("captured")
                .push(format!("resource:{resource_id}"));
        }
        if body
            .pointer("/audio/data")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| !value.is_empty())
        {
            captured
                .lock()
                .expect("captured")
                .push("audio-data:configured".to_string());
        }

        Json(json!({
            "result": {
                "text": "volcengine transcript",
                "utterances": [
                    {
                        "start_time": 120,
                        "end_time": 960,
                        "text": "volcengine segment",
                        "confidence": 0.91
                    }
                ]
            }
        }))
    }

    async fn handle_aliyun_qwen_request(
        headers: HeaderMap,
        body: serde_json::Value,
        captured: Arc<Mutex<Vec<String>>>,
    ) -> Json<serde_json::Value> {
        if headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            == Some("Bearer aliyun-secret")
        {
            captured
                .lock()
                .expect("captured")
                .push("authorization:configured".to_string());
        }
        if let Some(model) = body.get("model").and_then(serde_json::Value::as_str) {
            captured
                .lock()
                .expect("captured")
                .push(format!("model:{model}"));
        }
        if body.to_string().contains("\"input_audio\"") {
            captured
                .lock()
                .expect("captured")
                .push("input-audio:configured".to_string());
        }

        Json(json!({
            "choices": [
                {
                    "message": {
                        "content": "{\"text\":\"aliyun transcript\",\"language\":\"zh\",\"duration\":1.4,\"segments\":[{\"start\":0.2,\"end\":1.4,\"text\":\"aliyun segment\"}]}"
                    }
                }
            ]
        }))
    }
}
