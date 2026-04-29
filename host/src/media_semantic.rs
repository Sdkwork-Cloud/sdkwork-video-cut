use std::collections::HashMap;
use std::time::Duration;

use serde_json::{Value, json};

use crate::providers::{
    EndpointKind, OpenAiCompatibleProviderConfig, StructuredOutputMode,
    build_openai_compatible_endpoint,
};

pub(crate) const SEMANTIC_ANALYSIS_SCHEMA_ID: &str = "video-cut.semantic-analysis.schema.v1";

pub(crate) fn analyze_semantics_document(
    settings: &Value,
    transcript_document: &Value,
    task_id: &str,
    transcript_artifact_id: &str,
) -> Value {
    if transcript_document["transcriptStatus"] != "ok" {
        return semantic_status_document(
            settings,
            task_id,
            transcript_artifact_id,
            "transcript-unavailable",
            vec!["Transcript is unavailable; semantic analysis did not run.".to_string()],
        );
    }

    if !bool_at(settings, "/ai/enabled") {
        return semantic_status_document(
            settings,
            task_id,
            transcript_artifact_id,
            "provider-unavailable",
            vec!["AI provider is disabled.".to_string()],
        );
    }

    let base_url = string_at(settings, "/ai/baseUrl");
    let model = string_at(settings, "/ai/chatModel");
    let credential_configured = bool_at(settings, "/ai/apiKeyConfigured");
    if base_url.trim().is_empty() || model.trim().is_empty() || !credential_configured {
        return semantic_status_document(
            settings,
            task_id,
            transcript_artifact_id,
            "provider-unavailable",
            vec![
                "OpenAI-compatible semantic analysis provider is not fully configured.".to_string(),
            ],
        );
    }

    semantic_status_document(
        settings,
        task_id,
        transcript_artifact_id,
        "provider-unavailable",
        vec![
            "OpenAI-compatible semantic analysis HTTP execution is not linked in this host build."
                .to_string(),
        ],
    )
}

pub(crate) async fn analyze_semantics_document_with_http(
    settings: &Value,
    secrets: &HashMap<String, String>,
    transcript_document: &Value,
    task_id: &str,
    transcript_artifact_id: &str,
) -> Value {
    if transcript_document["transcriptStatus"] != "ok" {
        return analyze_semantics_document(
            settings,
            transcript_document,
            task_id,
            transcript_artifact_id,
        );
    }

    if !bool_at(settings, "/ai/enabled") {
        return analyze_semantics_document(
            settings,
            transcript_document,
            task_id,
            transcript_artifact_id,
        );
    }

    let base_url = string_at(settings, "/ai/baseUrl");
    let model = string_at(settings, "/ai/chatModel");
    let credential_configured = bool_at(settings, "/ai/apiKeyConfigured");
    if base_url.trim().is_empty() || model.trim().is_empty() || !credential_configured {
        return analyze_semantics_document(
            settings,
            transcript_document,
            task_id,
            transcript_artifact_id,
        );
    }

    let secret_ref = "settings://ai/api-key";
    let Some(secret) = secrets
        .get(secret_ref)
        .filter(|value| !value.trim().is_empty())
    else {
        return semantic_status_document(
            settings,
            task_id,
            transcript_artifact_id,
            "provider-unavailable",
            vec![
                "OpenAI-compatible semantic analysis credential is not available in the runtime secret store."
                    .to_string(),
            ],
        );
    };

    let config = OpenAiCompatibleProviderConfig {
        provider_id: "runtime-openai-compatible-ai".to_string(),
        base_url,
        api_key_secret_ref: Some(secret_ref.to_string()),
        chat_model: Some(model.clone()),
        transcription_model: None,
        structured_output_mode: structured_output_mode_at(settings),
        timeout_seconds: u16_at(settings, "/ai/timeoutSeconds", 45),
        retry_count: u8_at(settings, "/ai/retryCount", 2),
    };
    let endpoint = match build_openai_compatible_endpoint(&config, EndpointKind::ChatCompletions) {
        Ok(endpoint) => endpoint,
        Err(error) => {
            return semantic_status_document(
                settings,
                task_id,
                transcript_artifact_id,
                "provider-unavailable",
                vec![error.message],
            );
        }
    };
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(u64::from(config.timeout_seconds)))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return semantic_status_document(
                settings,
                task_id,
                transcript_artifact_id,
                "failed",
                vec![format!(
                    "Unable to build OpenAI-compatible HTTP client: {error}."
                )],
            );
        }
    };
    let response = match client
        .post(endpoint)
        .bearer_auth(secret)
        .json(&semantic_chat_request(
            settings,
            transcript_document,
            &model,
        ))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return semantic_status_document(
                settings,
                task_id,
                transcript_artifact_id,
                "failed",
                vec![format!(
                    "OpenAI-compatible semantic analysis request failed: {}.",
                    sanitize_error_message(&error.to_string())
                )],
            );
        }
    };
    let status = response.status();
    if !status.is_success() {
        return semantic_status_document(
            settings,
            task_id,
            transcript_artifact_id,
            "failed",
            vec![format!(
                "OpenAI-compatible semantic analysis request failed with status {}.",
                status.as_u16()
            )],
        );
    }
    let provider_json = match response.json::<Value>().await {
        Ok(value) => value,
        Err(error) => {
            return semantic_status_document(
                settings,
                task_id,
                transcript_artifact_id,
                "failed",
                vec![format!(
                    "OpenAI-compatible semantic analysis response was not valid JSON: {}.",
                    sanitize_error_message(&error.to_string())
                )],
            );
        }
    };
    let Some(content) = provider_json
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
    else {
        return semantic_status_document(
            settings,
            task_id,
            transcript_artifact_id,
            "failed",
            vec!["OpenAI-compatible semantic analysis response did not include choices[0].message.content.".to_string()],
        );
    };
    let semantic_json = match serde_json::from_str::<Value>(content) {
        Ok(value) => value,
        Err(error) => {
            return semantic_status_document(
                settings,
                task_id,
                transcript_artifact_id,
                "failed",
                vec![format!(
                    "Semantic analysis structured output was not valid JSON: {error}."
                )],
            );
        }
    };

    semantic_success_document(settings, task_id, transcript_artifact_id, &semantic_json)
}

fn semantic_status_document(
    settings: &Value,
    task_id: &str,
    transcript_artifact_id: &str,
    semantic_status: &str,
    warnings: Vec<String>,
) -> Value {
    json!({
        "schemaId": SEMANTIC_ANALYSIS_SCHEMA_ID,
        "semanticAnalysisVersion": 1,
        "taskId": task_id,
        "transcriptArtifactId": transcript_artifact_id,
        "providerId": "openai-compatible-semantic-analysis",
        "adapterVersion": "openai-compatible-semantic-analysis.adapter.v1",
        "semanticStatus": semantic_status,
        "model": string_at(settings, "/ai/chatModel"),
        "summary": "",
        "topics": [],
        "qaCandidates": [],
        "warnings": warnings,
        "createdAt": crate::contracts::fixed_time()
    })
}

fn semantic_success_document(
    settings: &Value,
    task_id: &str,
    transcript_artifact_id: &str,
    semantic_json: &Value,
) -> Value {
    json!({
        "schemaId": SEMANTIC_ANALYSIS_SCHEMA_ID,
        "semanticAnalysisVersion": 1,
        "taskId": task_id,
        "transcriptArtifactId": transcript_artifact_id,
        "providerId": "openai-compatible-semantic-analysis",
        "adapterVersion": "openai-compatible-semantic-analysis.adapter.v1",
        "semanticStatus": "ok",
        "model": string_at(settings, "/ai/chatModel"),
        "summary": semantic_json.get("summary").and_then(Value::as_str).unwrap_or_default(),
        "topics": semantic_json.get("topics").and_then(Value::as_array).map(|topics| {
            topics.iter().filter_map(semantic_topic).collect::<Vec<Value>>()
        }).unwrap_or_default(),
        "qaCandidates": semantic_json.get("qaCandidates").and_then(Value::as_array).map(|candidates| {
            candidates.iter().filter_map(qa_candidate).collect::<Vec<Value>>()
        }).unwrap_or_default(),
        "warnings": [],
        "createdAt": crate::contracts::fixed_time()
    })
}

fn semantic_topic(topic: &Value) -> Option<Value> {
    let topic_id = topic.get("topicId").and_then(Value::as_str)?;
    let label = topic.get("label").and_then(Value::as_str)?;
    let score = topic.get("score").and_then(Value::as_f64).unwrap_or(0.0);
    if topic_id.trim().is_empty() || label.trim().is_empty() {
        return None;
    }

    Some(json!({
        "topicId": topic_id,
        "label": label,
        "score": score.clamp(0.0, 1.0)
    }))
}

fn qa_candidate(candidate: &Value) -> Option<Value> {
    let qa_id = candidate.get("qaId").and_then(Value::as_str)?;
    let question = candidate.get("question").and_then(Value::as_str)?;
    let answer = candidate.get("answer").and_then(Value::as_str)?;
    let source_range = candidate.get("sourceRange")?;
    let start_ms = source_range.get("startMs").and_then(Value::as_u64)?;
    let end_ms = source_range.get("endMs").and_then(Value::as_u64)?;
    if qa_id.trim().is_empty()
        || question.trim().is_empty()
        || answer.trim().is_empty()
        || end_ms <= start_ms
    {
        return None;
    }

    Some(json!({
        "qaId": qa_id,
        "question": question,
        "answer": answer,
        "sourceRange": {
            "startMs": start_ms,
            "endMs": end_ms
        },
        "score": candidate.get("score").and_then(Value::as_f64).unwrap_or(0.0).clamp(0.0, 1.0)
    }))
}

fn semantic_chat_request(settings: &Value, transcript_document: &Value, model: &str) -> Value {
    json!({
        "model": model,
        "temperature": settings.pointer("/ai/temperature").and_then(Value::as_f64).unwrap_or(0.2),
        "messages": [
            {
                "role": "system",
                "content": "Return only JSON that matches the semantic analysis schema. Do not include markdown."
            },
            {
                "role": "user",
                "content": json!({
                    "task": "Analyze transcript for short-form video cutting.",
                    "transcript": transcript_document.get("text").and_then(Value::as_str).unwrap_or_default(),
                    "segments": transcript_document.get("segments").cloned().unwrap_or_else(|| json!([]))
                }).to_string()
            }
        ],
        "response_format": response_format(settings)
    })
}

fn response_format(settings: &Value) -> Value {
    match string_at(settings, "/ai/structuredOutputMode").as_str() {
        "json-object-fallback" => json!({ "type": "json_object" }),
        _ => json!({
            "type": "json_schema",
            "json_schema": {
                "name": "video_cut_semantic_analysis",
                "strict": true,
                "schema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["summary", "topics", "qaCandidates"],
                    "properties": {
                        "summary": { "type": "string" },
                        "topics": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["topicId", "label", "score"],
                                "properties": {
                                    "topicId": { "type": "string" },
                                    "label": { "type": "string" },
                                    "score": { "type": "number" }
                                }
                            }
                        },
                        "qaCandidates": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["qaId", "question", "answer", "sourceRange", "score"],
                                "properties": {
                                    "qaId": { "type": "string" },
                                    "question": { "type": "string" },
                                    "answer": { "type": "string" },
                                    "sourceRange": {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": ["startMs", "endMs"],
                                        "properties": {
                                            "startMs": { "type": "integer" },
                                            "endMs": { "type": "integer" }
                                        }
                                    },
                                    "score": { "type": "number" }
                                }
                            }
                        }
                    }
                }
            }
        }),
    }
}

fn bool_at(settings: &Value, pointer: &str) -> bool {
    settings
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn structured_output_mode_at(settings: &Value) -> StructuredOutputMode {
    match string_at(settings, "/ai/structuredOutputMode").as_str() {
        "json-object-fallback" => StructuredOutputMode::JsonObjectFallback,
        _ => StructuredOutputMode::JsonSchema,
    }
}

fn u16_at(settings: &Value, pointer: &str, fallback: u16) -> u16 {
    settings
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(fallback)
}

fn u8_at(settings: &Value, pointer: &str, fallback: u8) -> u8 {
    settings
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
        .unwrap_or(fallback)
}

fn sanitize_error_message(message: &str) -> String {
    message
        .replace("Authorization", "[redacted-header]")
        .replace("authorization", "[redacted-header]")
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
    use std::sync::{Arc, Mutex};

    use axum::extract::Json as AxumJson;
    use axum::http::HeaderMap;
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    use super::{analyze_semantics_document, analyze_semantics_document_with_http};

    #[test]
    fn reports_transcript_unavailable_without_faking_topics() {
        let document = analyze_semantics_document(
            &json!({ "ai": { "chatModel": "gpt-4.1-mini" } }),
            &json!({ "transcriptStatus": "audio-unavailable" }),
            "task-001",
            "task-001-transcript",
        );

        assert_eq!(
            document["schemaId"],
            "video-cut.semantic-analysis.schema.v1"
        );
        assert_eq!(document["semanticStatus"], "transcript-unavailable");
        assert_eq!(document["topics"].as_array().expect("topics").len(), 0);
        assert!(
            !document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn posts_openai_compatible_chat_completion_and_maps_structured_semantics_without_leaking_secret()
     {
        let captured = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured_for_handler = Arc::clone(&captured);
        let app = Router::new().route(
            "/v1/chat/completions",
            post(
                move |headers: HeaderMap, AxumJson(body): AxumJson<serde_json::Value>| {
                    let captured = Arc::clone(&captured_for_handler);
                    async move { handle_chat_completion_request(headers, body, captured).await }
                },
            ),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("mock server");
        });

        let mut secrets = HashMap::new();
        secrets.insert(
            "settings://ai/api-key".to_string(),
            "sk-semantic-secret".to_string(),
        );
        let document = analyze_semantics_document_with_http(
            &json!({
                "ai": {
                    "enabled": true,
                    "baseUrl": base_url,
                    "apiKeyConfigured": true,
                    "chatModel": "gpt-4.1-mini",
                    "structuredOutputMode": "json-schema",
                    "temperature": 0.2,
                    "timeoutSeconds": 45,
                    "retryCount": 0
                }
            }),
            &secrets,
            &json!({
                "transcriptStatus": "ok",
                "text": "什么是标准化？标准化就是把边界、契约和验证都固定下来。",
                "segments": [
                    {
                        "segmentId": "segment-1",
                        "startMs": 0,
                        "endMs": 1800,
                        "text": "什么是标准化？标准化就是把边界、契约和验证都固定下来。"
                    }
                ]
            }),
            "task-001",
            "task-001-transcript",
        )
        .await;

        assert_eq!(
            document["schemaId"],
            "video-cut.semantic-analysis.schema.v1"
        );
        assert_eq!(document["semanticStatus"], "ok");
        assert_eq!(document["summary"], "标准化要固定边界、契约和验证。");
        assert_eq!(document["topics"][0]["label"], "标准化");
        assert_eq!(document["qaCandidates"][0]["question"], "什么是标准化？");
        assert!(
            document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
        let serialized = document.to_string();
        assert!(!serialized.contains("sk-semantic-secret"));
        let captured = captured.lock().expect("captured");
        assert!(captured.contains(&"authorization:configured".to_string()));
        assert!(captured.contains(&"model:gpt-4.1-mini".to_string()));
        assert!(captured.contains(&"response_format:json_schema".to_string()));
    }

    async fn handle_chat_completion_request(
        headers: HeaderMap,
        body: serde_json::Value,
        captured: Arc<Mutex<Vec<String>>>,
    ) -> Json<serde_json::Value> {
        if headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            == Some("Bearer sk-semantic-secret")
        {
            captured
                .lock()
                .expect("captured")
                .push("authorization:configured".to_string());
        }
        captured.lock().expect("captured").push(format!(
            "model:{}",
            body["model"].as_str().unwrap_or_default()
        ));
        captured.lock().expect("captured").push(format!(
            "response_format:{}",
            body["response_format"]["type"].as_str().unwrap_or_default()
        ));

        Json(json!({
            "choices": [
                {
                    "message": {
                        "content": serde_json::to_string(&json!({
                            "summary": "标准化要固定边界、契约和验证。",
                            "topics": [
                                {
                                    "topicId": "topic-1",
                                    "label": "标准化",
                                    "score": 0.92
                                }
                            ],
                            "qaCandidates": [
                                {
                                    "qaId": "qa-1",
                                    "question": "什么是标准化？",
                                    "answer": "把边界、契约和验证固定下来。",
                                    "sourceRange": {
                                        "startMs": 0,
                                        "endMs": 1800
                                    },
                                    "score": 0.88
                                }
                            ]
                        })).expect("semantic json")
                    }
                }
            ]
        }))
    }
}
