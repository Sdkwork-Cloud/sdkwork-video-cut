use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::providers::{
    SpeechToTextProviderConfig, SpeechToTextProviderProfile, build_speech_to_text_bridge_endpoint,
};

pub(crate) struct SpeechTranscriptionBridgeResult {
    pub(crate) provider_id: String,
    pub(crate) adapter_version: String,
    pub(crate) canonical_json: Value,
    pub(crate) granularity: String,
}

pub(crate) struct SpeechTranscriptionBridgeError {
    pub(crate) transcript_status: &'static str,
    pub(crate) message: String,
}

pub(crate) fn speech_to_text_provider_config_from_settings(
    settings: &Value,
) -> SpeechToTextProviderConfig {
    let reuse_ai_provider = bool_at(settings, "/speechToText/reuseAiProviderConnection");
    let (base_url, api_key_secret_ref) = if reuse_ai_provider {
        (
            string_at(settings, "/ai/baseUrl"),
            secret_ref_if_configured(
                bool_at(settings, "/ai/apiKeyConfigured"),
                "settings://ai/api-key",
            ),
        )
    } else {
        (
            string_at(settings, "/speechToText/baseUrl"),
            secret_ref_if_configured(
                bool_at(settings, "/speechToText/apiKeyConfigured"),
                "settings://speech-to-text/api-key",
            ),
        )
    };

    SpeechToTextProviderConfig {
        provider_id: "runtime-speech-to-text-bridge".to_string(),
        provider_profile: SpeechToTextProviderProfile::from_settings_value(&string_at(
            settings,
            "/speechToText/providerProfile",
        )),
        base_url,
        api_key_secret_ref,
        transcription_model: string_at(settings, "/speechToText/transcriptionModel"),
        language_hint: string_at(settings, "/speechToText/languageHint"),
        timestamp_granularity: timestamp_granularity(settings),
        timeout_seconds: u16_at(settings, "/ai/timeoutSeconds", 45),
        retry_count: u8_at(settings, "/ai/retryCount", 2),
        resource_id: Some(string_at(settings, "/speechToText/resourceId"))
            .filter(|value| !value.trim().is_empty())
            .or_else(|| Some("volc.bigasr.auc".to_string())),
    }
}

pub(crate) async fn execute_speech_transcription_bridge(
    settings: &Value,
    secrets: &HashMap<String, String>,
    audio_file_path: &Path,
) -> Result<SpeechTranscriptionBridgeResult, SpeechTranscriptionBridgeError> {
    let config = speech_to_text_provider_config_from_settings(settings);
    let validation = config.validate();
    if !validation.valid {
        return Err(SpeechTranscriptionBridgeError {
            transcript_status: "provider-unavailable",
            message: "Speech-to-text provider is not fully configured.".to_string(),
        });
    }

    let Some(secret_ref) = config.api_key_secret_ref.as_deref() else {
        return Err(SpeechTranscriptionBridgeError {
            transcript_status: "provider-unavailable",
            message: "Speech-to-text credential reference is not configured.".to_string(),
        });
    };
    let Some(secret) = secrets
        .get(secret_ref)
        .filter(|value| !value.trim().is_empty())
    else {
        return Err(SpeechTranscriptionBridgeError {
            transcript_status: "provider-unavailable",
            message: "Speech-to-text credential is not available in the runtime secret store."
                .to_string(),
        });
    };
    let endpoint = build_speech_to_text_bridge_endpoint(&config).map_err(|error| {
        SpeechTranscriptionBridgeError {
            transcript_status: "provider-unavailable",
            message: error.message,
        }
    })?;
    let audio_bytes =
        std::fs::read(audio_file_path).map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!("Unable to read extracted audio file: {error}."),
        })?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(u64::from(config.timeout_seconds)))
        .build()
        .map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!("Unable to build speech-to-text HTTP client: {error}."),
        })?;

    let provider_json = match config.provider_profile {
        SpeechToTextProviderProfile::OpenAiAudioTranscriptions => {
            post_openai_transcription(&client, &endpoint, secret, &config, audio_bytes).await?
        }
        SpeechToTextProviderProfile::VolcengineBigAsrFlash => {
            post_volcengine_bigasr_flash(&client, &endpoint, secret, &config, audio_bytes).await?
        }
        SpeechToTextProviderProfile::AliyunQwenAsr => {
            post_aliyun_qwen_asr(&client, &endpoint, secret, &config, audio_bytes).await?
        }
    };

    Ok(SpeechTranscriptionBridgeResult {
        provider_id: config.provider_profile.as_str().to_string(),
        adapter_version: "speech-to-text-bridge.adapter.v1".to_string(),
        canonical_json: provider_json,
        granularity: config.timestamp_granularity,
    })
}

async fn post_openai_transcription(
    client: &reqwest::Client,
    endpoint: &str,
    secret: &str,
    config: &SpeechToTextProviderConfig,
    audio_bytes: Vec<u8>,
) -> Result<Value, SpeechTranscriptionBridgeError> {
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("source.wav")
        .mime_str("audio/wav")
        .map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!("Unable to build transcription multipart file part: {error}."),
        })?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", config.transcription_model.clone())
        .text("response_format", "verbose_json")
        .text(
            "timestamp_granularities[]",
            config.timestamp_granularity.clone(),
        );
    if !config.language_hint.trim().is_empty() {
        form = form.text("language", config.language_hint.clone());
    }

    let response = client
        .post(endpoint)
        .bearer_auth(secret)
        .multipart(form)
        .send()
        .await
        .map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!(
                "OpenAI-compatible transcription request failed: {}.",
                sanitize_error_message(&error.to_string())
            ),
        })?;

    read_provider_json_response(response, "OpenAI-compatible transcription").await
}

async fn post_volcengine_bigasr_flash(
    client: &reqwest::Client,
    endpoint: &str,
    secret: &str,
    config: &SpeechToTextProviderConfig,
    audio_bytes: Vec<u8>,
) -> Result<Value, SpeechTranscriptionBridgeError> {
    let request_body = json!({
        "user": {
            "uid": "sdkwork-video-cut"
        },
        "audio": {
            "format": "wav",
            "data": STANDARD.encode(audio_bytes)
        },
        "request": {
            "model_name": config.transcription_model,
            "enable_itn": true,
            "show_utterances": true,
            "show_words": config.timestamp_granularity == "word"
        }
    });

    let response = client
        .post(endpoint)
        .header("X-Api-Key", secret)
        .header(
            "X-Api-Resource-Id",
            config.resource_id.as_deref().unwrap_or("volc.bigasr.auc"),
        )
        .header("X-Api-Request-Id", Uuid::new_v4().to_string())
        .header("X-Api-Sequence", "1")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!(
                "Volcengine BigASR Flash request failed: {}.",
                sanitize_error_message(&error.to_string())
            ),
        })?;
    let provider_json = read_provider_json_response(response, "Volcengine BigASR Flash").await?;

    Ok(volcengine_to_openai_verbose_json(&provider_json))
}

async fn post_aliyun_qwen_asr(
    client: &reqwest::Client,
    endpoint: &str,
    secret: &str,
    config: &SpeechToTextProviderConfig,
    audio_bytes: Vec<u8>,
) -> Result<Value, SpeechTranscriptionBridgeError> {
    let request_body = json!({
        "model": config.transcription_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Transcribe the input audio and return JSON with text, language, duration, and segments."
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": format!("data:audio/wav;base64,{}", STANDARD.encode(audio_bytes)),
                            "format": "wav"
                        }
                    }
                ]
            }
        ],
        "response_format": {
            "type": "json_object"
        },
        "temperature": 0
    });

    let response = client
        .post(endpoint)
        .bearer_auth(secret)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!(
                "Alibaba Qwen-ASR request failed: {}.",
                sanitize_error_message(&error.to_string())
            ),
        })?;
    let provider_json = read_provider_json_response(response, "Alibaba Qwen-ASR").await?;

    Ok(aliyun_qwen_to_openai_verbose_json(
        &provider_json,
        &config.language_hint,
    ))
}

async fn read_provider_json_response(
    response: reqwest::Response,
    label: &str,
) -> Result<Value, SpeechTranscriptionBridgeError> {
    let status = response.status();
    if !status.is_success() {
        return Err(SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!("{label} request failed with status {}.", status.as_u16()),
        });
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| SpeechTranscriptionBridgeError {
            transcript_status: "failed",
            message: format!(
                "{label} response was not valid JSON: {}.",
                sanitize_error_message(&error.to_string())
            ),
        })
}

fn volcengine_to_openai_verbose_json(provider_json: &Value) -> Value {
    let result = provider_json.get("result").unwrap_or(provider_json);
    let text = result
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let segments = result
        .get("utterances")
        .or_else(|| result.get("segments"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .filter_map(|(index, item)| {
                    let start_ms = integer_field(item, &["start_time", "startMs"])?;
                    let end_ms = integer_field(item, &["end_time", "endMs"])?;
                    if end_ms <= start_ms {
                        return None;
                    }
                    let segment_text = item.get("text").and_then(Value::as_str).unwrap_or_default();
                    if segment_text.trim().is_empty() {
                        return None;
                    }

                    let mut segment = json!({
                        "id": index,
                        "start": start_ms as f64 / 1000.0,
                        "end": end_ms as f64 / 1000.0,
                        "text": segment_text
                    });
                    if let Some(confidence) = item.get("confidence").and_then(Value::as_f64) {
                        segment["confidence"] = json!(confidence);
                    }
                    Some(segment)
                })
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default();
    let duration = segments
        .iter()
        .filter_map(|segment| segment.get("end").and_then(Value::as_f64))
        .fold(0.0, f64::max);

    json!({
        "text": text,
        "language": "zh",
        "duration": duration,
        "segments": segments
    })
}

fn aliyun_qwen_to_openai_verbose_json(provider_json: &Value, language_hint: &str) -> Value {
    let content = provider_json
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Ok(parsed) = serde_json::from_str::<Value>(content) {
        return parsed;
    }

    json!({
        "text": content,
        "language": if language_hint.trim().is_empty() { "zh" } else { language_hint },
        "duration": 0,
        "segments": []
    })
}

fn integer_field(value: &Value, fields: &[&str]) -> Option<u64> {
    fields.iter().find_map(|field| {
        value.get(*field).and_then(|item| {
            item.as_u64()
                .or_else(|| item.as_f64().map(|raw| raw.max(0.0) as u64))
        })
    })
}

fn timestamp_granularity(settings: &Value) -> String {
    let granularity = string_at(settings, "/speechToText/timestampGranularity");
    if granularity.trim().is_empty() {
        "segment".to_string()
    } else {
        granularity
    }
}

fn secret_ref_if_configured(configured: bool, secret_ref: &str) -> Option<String> {
    if configured {
        Some(secret_ref.to_string())
    } else {
        None
    }
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
        .replace("X-Api-Key", "[redacted-header]")
        .replace("x-api-key", "[redacted-header]")
}
