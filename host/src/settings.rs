use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeSecretUpdate {
    pub(crate) secret_ref: String,
    pub(crate) secret_value: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsValidationResult {
    pub(crate) valid: bool,
    pub(crate) errors: Vec<SettingsValidationError>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsValidationError {
    pub(crate) field: String,
    pub(crate) code: String,
    pub(crate) message: String,
}

pub(crate) fn validate_settings(settings: &Value) -> SettingsValidationResult {
    let mut errors = Vec::new();
    let ai_enabled = bool_at(settings, "/ai/enabled");
    let ai_api_key_configured = bool_at(settings, "/ai/apiKeyConfigured");
    let ai_base_url = string_at(settings, "/ai/baseUrl");

    if ai_enabled {
        validate_base_url(&mut errors, "ai.baseUrl", ai_base_url);

        if !ai_api_key_configured {
            push_required(&mut errors, "ai.apiKey", "AI provider API key");
        }

        if is_blank(string_at(settings, "/ai/chatModel")) {
            push_required(&mut errors, "ai.chatModel", "Chat model");
        }
    }

    let stt_enabled = bool_at(settings, "/speechToText/enabled");
    if stt_enabled {
        let provider_profile = string_at(settings, "/speechToText/providerProfile");
        if !is_supported_speech_provider_profile(provider_profile) {
            errors.push(SettingsValidationError::new(
                "speechToText.providerProfile",
                "UNSUPPORTED_PROVIDER_PROFILE",
                "Speech-to-text provider profile must be one of the standard bridge profiles.",
            ));
        }

        let reuse_ai_provider = bool_at(settings, "/speechToText/reuseAiProviderConnection");
        if !reuse_ai_provider {
            validate_base_url(
                &mut errors,
                "speechToText.baseUrl",
                string_at(settings, "/speechToText/baseUrl"),
            );
        }

        if is_blank(string_at(settings, "/speechToText/transcriptionModel")) {
            push_required(
                &mut errors,
                "speechToText.transcriptionModel",
                "Transcription model",
            );
        }

        if provider_profile == "volcengine-bigasr-flash"
            && is_blank(string_at(settings, "/speechToText/resourceId"))
        {
            push_required(
                &mut errors,
                "speechToText.resourceId",
                "Volcengine BigASR Flash resource ID",
            );
        }

        let stt_api_key_configured = bool_at(settings, "/speechToText/apiKeyConfigured");
        let can_reuse_ai_credential = reuse_ai_provider && ai_enabled && ai_api_key_configured;
        if !stt_api_key_configured && !can_reuse_ai_credential {
            push_required(&mut errors, "speechToText.apiKey", "Speech-to-text API key");
        }
    }

    if string_at(settings, "/runtime/deploymentMode") != "desktop-local"
        && string_at(settings, "/runtime/bindHost") == "0.0.0.0"
        && string_at(settings, "/runtime/authMode") == "none"
    {
        errors.push(SettingsValidationError::new(
            "runtime.authMode",
            "AUTH_REQUIRED",
            "Server modes that bind 0.0.0.0 must enable auth or reverse proxy protection.",
        ));
    }

    for origin in string_array_at(settings, "/security/corsAllowedOrigins") {
        let origin = origin.trim();
        if origin == "*" {
            errors.push(SettingsValidationError::new(
                "security.corsAllowedOrigins",
                "CORS_ORIGIN_WILDCARD_NOT_ALLOWED",
                "CORS origins must be explicit HTTP(S) origins; wildcard origin is not allowed.",
            ));
        } else if !is_valid_http_origin(origin) {
            errors.push(SettingsValidationError::new(
                "security.corsAllowedOrigins",
                "INVALID_URL",
                "CORS origins must be valid HTTP(S) origins.",
            ));
        }
    }

    if integer_at(settings, "/mediaTools/workerConcurrency") < 1 {
        errors.push(SettingsValidationError::new(
            "mediaTools.workerConcurrency",
            "OUT_OF_RANGE",
            "Worker concurrency must be at least 1.",
        ));
    }

    SettingsValidationResult {
        valid: errors.is_empty(),
        errors,
    }
}

pub(crate) fn sanitize_settings(settings: &Value) -> Value {
    let mut sanitized = settings.clone();
    remove_secret_field(&mut sanitized, "ai");
    remove_secret_field(&mut sanitized, "speechToText");
    sanitized
}

pub(crate) fn extract_runtime_secret_updates(settings: &mut Value) -> Vec<RuntimeSecretUpdate> {
    let mut updates = Vec::new();
    extract_section_secret(settings, "ai", "settings://ai/api-key", &mut updates);
    extract_section_secret(
        settings,
        "speechToText",
        "settings://speech-to-text/api-key",
        &mut updates,
    );
    updates
}

impl SettingsValidationError {
    fn new(field: &str, code: &str, message: &str) -> Self {
        Self {
            field: field.to_string(),
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

fn validate_base_url(errors: &mut Vec<SettingsValidationError>, field: &str, value: &str) {
    if !is_valid_http_url(value) {
        errors.push(SettingsValidationError::new(
            field,
            "INVALID_URL",
            "OpenAI-compatible base URL must be a valid HTTP(S) URL.",
        ));
    }

    if is_ollama_endpoint(value) {
        errors.push(SettingsValidationError::new(
            field,
            "OLLAMA_NOT_ALLOWED",
            "Ollama-compatible endpoints are not allowed by this product contract.",
        ));
    }
}

fn push_required(errors: &mut Vec<SettingsValidationError>, field: &str, label: &str) {
    errors.push(SettingsValidationError::new(
        field,
        "REQUIRED",
        &format!("{label} is required."),
    ));
}

fn is_valid_http_url(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    (value.starts_with("http://") || value.starts_with("https://")) && value.len() > "http://".len()
}

fn is_valid_http_origin(value: &str) -> bool {
    let value = value.trim();
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };

    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
        && value == url.origin().ascii_serialization()
}

fn is_ollama_endpoint(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.contains("ollama")
        || value.contains("localhost:11434")
        || value.contains("127.0.0.1:11434")
}

fn is_blank(value: &str) -> bool {
    value.trim().is_empty()
}

fn is_supported_speech_provider_profile(value: &str) -> bool {
    matches!(
        value.trim(),
        "openai-audio-transcriptions" | "volcengine-bigasr-flash" | "aliyun-qwen-asr"
    )
}

fn bool_at(value: &Value, pointer: &str) -> bool {
    value
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn string_at<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value.pointer(pointer).and_then(Value::as_str).unwrap_or("")
}

fn integer_at(value: &Value, pointer: &str) -> i64 {
    value.pointer(pointer).and_then(Value::as_i64).unwrap_or(0)
}

fn string_array_at<'a>(value: &'a Value, pointer: &str) -> Vec<&'a str> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn remove_secret_field(settings: &mut Value, section: &str) {
    if let Some(section) = settings.get_mut(section).and_then(Value::as_object_mut) {
        section.remove("apiKey");
    }
}

fn extract_section_secret(
    settings: &mut Value,
    section: &str,
    secret_ref: &str,
    updates: &mut Vec<RuntimeSecretUpdate>,
) {
    let Some(section) = settings.get_mut(section).and_then(Value::as_object_mut) else {
        return;
    };
    let secret_value = section
        .remove("apiKey")
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();

    if secret_value.trim().is_empty() {
        return;
    }

    section.insert("apiKeyConfigured".to_string(), Value::Bool(true));
    updates.push(RuntimeSecretUpdate {
        secret_ref: secret_ref.to_string(),
        secret_value,
    });
}
