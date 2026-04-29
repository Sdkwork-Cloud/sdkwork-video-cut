use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    LargeLanguageModel,
    SpeechToText,
    TextNormalization,
    KeywordHighlight,
    Subtitle,
    MediaProbe,
    MediaRender,
    AudioBoundary,
    SpeechActivity,
    SceneDetection,
    SubjectTracking,
    VideoStabilization,
    AudioEnhancement,
    CoverRender,
    ToolLocator,
    CommandRunner,
    RuntimeConfig,
    SecretStore,
    Telemetry,
    TaskStorage,
    ArtifactStorage,
    ModelAssetRepository,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderHealthStatus {
    Ok,
    Degraded,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub provider_id: String,
    pub provider_kind: ProviderKind,
    pub adapter_version: String,
    pub display_name: String,
    pub capability_schema_id: String,
    pub configuration_schema_id: String,
    pub health_status: ProviderHealthStatus,
    pub license: String,
    pub supported_deployment_modes: Vec<String>,
    pub runtime_requirements: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StructuredOutputMode {
    JsonSchema,
    JsonObjectFallback,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EndpointKind {
    ChatCompletions,
    AudioTranscriptions,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpeechToTextProviderProfile {
    OpenAiAudioTranscriptions,
    VolcengineBigAsrFlash,
    AliyunQwenAsr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleProviderConfig {
    pub provider_id: String,
    pub base_url: String,
    pub api_key_secret_ref: Option<String>,
    pub chat_model: Option<String>,
    pub transcription_model: Option<String>,
    pub structured_output_mode: StructuredOutputMode,
    pub timeout_seconds: u16,
    pub retry_count: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechToTextProviderConfig {
    pub provider_id: String,
    pub provider_profile: SpeechToTextProviderProfile,
    pub base_url: String,
    pub api_key_secret_ref: Option<String>,
    pub transcription_model: String,
    pub language_hint: String,
    pub timestamp_granularity: String,
    pub timeout_seconds: u16,
    pub retry_count: u8,
    pub resource_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderValidationResult {
    pub valid: bool,
    pub errors: Vec<ProviderValidationError>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderValidationError {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConformanceReport {
    pub report_version: String,
    pub provider_id: String,
    pub status: String,
    pub generated_at: String,
    pub checks: Vec<ProviderConformanceCheck>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConformanceCheck {
    pub check_id: String,
    pub status: String,
    pub label: String,
    pub action_hint: Option<String>,
    pub details: Value,
}

pub trait LlmProviderPort {
    fn descriptor(&self) -> ProviderDescriptor;
}

pub trait SpeechToTextPort {
    fn descriptor(&self) -> ProviderDescriptor;
}

pub trait SubtitlePort {
    fn descriptor(&self) -> ProviderDescriptor;
}

pub trait SecretStorePort {
    fn descriptor(&self) -> ProviderDescriptor;
}

impl ProviderDescriptor {
    pub fn openai_compatible_llm() -> Self {
        Self {
            provider_id: "openai-compatible-llm".to_string(),
            provider_kind: ProviderKind::LargeLanguageModel,
            adapter_version: "openai-compatible.adapter.v1".to_string(),
            display_name: "OpenAI-Compatible LLM".to_string(),
            capability_schema_id: "video-cut.provider-capability.schema.v1".to_string(),
            configuration_schema_id: "video-cut.openai-compatible-provider-config.schema.v1"
                .to_string(),
            health_status: ProviderHealthStatus::Degraded,
            license: "user-provided-endpoint".to_string(),
            supported_deployment_modes: standard_deployment_modes(),
            runtime_requirements: vec!["https-egress".to_string(), "secret-store".to_string()],
        }
    }

    pub fn openai_compatible_speech_to_text() -> Self {
        Self {
            provider_id: "openai-compatible-stt".to_string(),
            provider_kind: ProviderKind::SpeechToText,
            adapter_version: "openai-compatible.adapter.v1".to_string(),
            display_name: "OpenAI-Compatible Speech To Text".to_string(),
            capability_schema_id: "video-cut.provider-capability.schema.v1".to_string(),
            configuration_schema_id: "video-cut.openai-compatible-provider-config.schema.v1"
                .to_string(),
            health_status: ProviderHealthStatus::Degraded,
            license: "user-provided-endpoint".to_string(),
            supported_deployment_modes: standard_deployment_modes(),
            runtime_requirements: vec!["https-egress".to_string(), "secret-store".to_string()],
        }
    }

    pub fn subtitle_renderer() -> Self {
        Self {
            provider_id: "internal-subtitle-renderer".to_string(),
            provider_kind: ProviderKind::Subtitle,
            adapter_version: "subtitle-renderer.adapter.v1".to_string(),
            display_name: "Internal Subtitle Renderer".to_string(),
            capability_schema_id: "video-cut.provider-capability.schema.v1".to_string(),
            configuration_schema_id: "video-cut.subtitle-provider-config.schema.v1".to_string(),
            health_status: ProviderHealthStatus::Ok,
            license: "internal".to_string(),
            supported_deployment_modes: standard_deployment_modes(),
            runtime_requirements: vec!["ffmpeg-filter-graph".to_string()],
        }
    }

    pub fn secret_store() -> Self {
        Self {
            provider_id: "standard-secret-store".to_string(),
            provider_kind: ProviderKind::SecretStore,
            adapter_version: "secret-store.adapter.v1".to_string(),
            display_name: "Standard Secret Store".to_string(),
            capability_schema_id: "video-cut.provider-capability.schema.v1".to_string(),
            configuration_schema_id: "video-cut.secret-store-config.schema.v1".to_string(),
            health_status: ProviderHealthStatus::Degraded,
            license: "internal".to_string(),
            supported_deployment_modes: standard_deployment_modes(),
            runtime_requirements: vec!["redaction".to_string()],
        }
    }
}

impl ProviderValidationError {
    pub fn new(field: &str, code: &str, message: &str) -> Self {
        Self {
            field: field.to_string(),
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

impl SpeechToTextProviderProfile {
    pub fn as_str(&self) -> &'static str {
        match self {
            SpeechToTextProviderProfile::OpenAiAudioTranscriptions => "openai-audio-transcriptions",
            SpeechToTextProviderProfile::VolcengineBigAsrFlash => "volcengine-bigasr-flash",
            SpeechToTextProviderProfile::AliyunQwenAsr => "aliyun-qwen-asr",
        }
    }

    pub fn from_settings_value(value: &str) -> Self {
        match value.trim() {
            "volcengine-bigasr-flash" => SpeechToTextProviderProfile::VolcengineBigAsrFlash,
            "aliyun-qwen-asr" => SpeechToTextProviderProfile::AliyunQwenAsr,
            _ => SpeechToTextProviderProfile::OpenAiAudioTranscriptions,
        }
    }
}

impl OpenAiCompatibleProviderConfig {
    pub fn validate_for_required_capabilities(
        &self,
        required_capabilities: &[ProviderKind],
    ) -> ProviderValidationResult {
        let mut errors = Vec::new();
        let normalized_base_url = normalize_base_url(&self.base_url);

        if normalized_base_url.is_empty()
            || !(normalized_base_url.starts_with("https://")
                || normalized_base_url.starts_with("http://"))
        {
            errors.push(ProviderValidationError::new(
                "baseUrl",
                "INVALID_URL",
                "Base URL must be an absolute HTTP or HTTPS URL.",
            ));
        }

        if is_ollama_endpoint(&normalized_base_url) {
            errors.push(ProviderValidationError::new(
                "baseUrl",
                "OLLAMA_NOT_ALLOWED",
                "Ollama-compatible endpoints are not allowed by this product contract.",
            ));
        }

        if self
            .api_key_secret_ref
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
        {
            errors.push(ProviderValidationError::new(
                "credential",
                "REQUIRED",
                "Provider credential is required.",
            ));
        }

        if required_capabilities.contains(&ProviderKind::LargeLanguageModel)
            && is_blank(self.chat_model.as_deref())
        {
            errors.push(ProviderValidationError::new(
                "chatModel",
                "REQUIRED",
                "Chat model is required for LLM capability.",
            ));
        }

        if required_capabilities.contains(&ProviderKind::SpeechToText)
            && is_blank(self.transcription_model.as_deref())
        {
            errors.push(ProviderValidationError::new(
                "transcriptionModel",
                "REQUIRED",
                "Transcription model is required for speech-to-text capability.",
            ));
        }

        if self.timeout_seconds == 0 || self.timeout_seconds > 600 {
            errors.push(ProviderValidationError::new(
                "timeoutSeconds",
                "OUT_OF_RANGE",
                "Timeout must be between 1 and 600 seconds.",
            ));
        }

        if self.retry_count > 5 {
            errors.push(ProviderValidationError::new(
                "retryCount",
                "OUT_OF_RANGE",
                "Retry count must be between 0 and 5.",
            ));
        }

        ProviderValidationResult {
            valid: errors.is_empty(),
            errors,
        }
    }
}

impl SpeechToTextProviderConfig {
    pub fn validate(&self) -> ProviderValidationResult {
        let mut errors = Vec::new();
        let normalized_base_url = normalize_base_url(&self.base_url);

        if normalized_base_url.is_empty()
            || !(normalized_base_url.starts_with("https://")
                || normalized_base_url.starts_with("http://"))
        {
            errors.push(ProviderValidationError::new(
                "baseUrl",
                "INVALID_URL",
                "Base URL must be an absolute HTTP or HTTPS URL.",
            ));
        }

        if is_ollama_endpoint(&normalized_base_url) {
            errors.push(ProviderValidationError::new(
                "baseUrl",
                "OLLAMA_NOT_ALLOWED",
                "Ollama-compatible endpoints are not allowed by this product contract.",
            ));
        }

        if self
            .api_key_secret_ref
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
        {
            errors.push(ProviderValidationError::new(
                "credential",
                "REQUIRED",
                "Provider credential is required.",
            ));
        }

        if self.transcription_model.trim().is_empty() {
            errors.push(ProviderValidationError::new(
                "transcriptionModel",
                "REQUIRED",
                "Transcription model is required for speech-to-text capability.",
            ));
        }

        if matches!(
            self.provider_profile,
            SpeechToTextProviderProfile::VolcengineBigAsrFlash
        ) && self
            .resource_id
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
        {
            errors.push(ProviderValidationError::new(
                "resourceId",
                "REQUIRED",
                "Volcengine BigASR Flash requires a resource id.",
            ));
        }

        if self.timeout_seconds == 0 || self.timeout_seconds > 600 {
            errors.push(ProviderValidationError::new(
                "timeoutSeconds",
                "OUT_OF_RANGE",
                "Timeout must be between 1 and 600 seconds.",
            ));
        }

        if self.retry_count > 5 {
            errors.push(ProviderValidationError::new(
                "retryCount",
                "OUT_OF_RANGE",
                "Retry count must be between 0 and 5.",
            ));
        }

        ProviderValidationResult {
            valid: errors.is_empty(),
            errors,
        }
    }
}

pub fn build_openai_compatible_endpoint(
    config: &OpenAiCompatibleProviderConfig,
    endpoint_kind: EndpointKind,
) -> Result<String, ProviderValidationError> {
    let base_url = normalize_base_url(&config.base_url);
    if base_url.is_empty() || !(base_url.starts_with("https://") || base_url.starts_with("http://"))
    {
        return Err(ProviderValidationError::new(
            "baseUrl",
            "INVALID_URL",
            "Base URL must be an absolute HTTP or HTTPS URL.",
        ));
    }

    let path = match endpoint_kind {
        EndpointKind::ChatCompletions => "chat/completions",
        EndpointKind::AudioTranscriptions => "audio/transcriptions",
    };

    Ok(format!("{base_url}/v1/{path}"))
}

pub fn speech_to_text_provider_profiles() -> Vec<&'static str> {
    [
        SpeechToTextProviderProfile::OpenAiAudioTranscriptions,
        SpeechToTextProviderProfile::VolcengineBigAsrFlash,
        SpeechToTextProviderProfile::AliyunQwenAsr,
    ]
    .iter()
    .map(SpeechToTextProviderProfile::as_str)
    .collect()
}

pub fn build_speech_to_text_bridge_endpoint(
    config: &SpeechToTextProviderConfig,
) -> Result<String, ProviderValidationError> {
    let base_url = normalize_base_url(&config.base_url);
    if base_url.is_empty() || !(base_url.starts_with("https://") || base_url.starts_with("http://"))
    {
        return Err(ProviderValidationError::new(
            "baseUrl",
            "INVALID_URL",
            "Base URL must be an absolute HTTP or HTTPS URL.",
        ));
    }

    let path = match config.provider_profile {
        SpeechToTextProviderProfile::OpenAiAudioTranscriptions => "v1/audio/transcriptions",
        SpeechToTextProviderProfile::VolcengineBigAsrFlash => "api/v3/auc/bigmodel/recognize/flash",
        SpeechToTextProviderProfile::AliyunQwenAsr => "compatible-mode/v1/chat/completions",
    };

    Ok(format!("{base_url}/{path}"))
}

pub fn redact_secret(secret: Option<&str>) -> &'static str {
    if secret.map(str::trim).unwrap_or_default().is_empty() {
        "not-configured"
    } else {
        "configured"
    }
}

pub fn speech_to_text_conformance_report(
    config: &SpeechToTextProviderConfig,
) -> ProviderConformanceReport {
    let validation = config.validate();
    let mut checks = Vec::new();

    if !validation.valid {
        checks.push(ProviderConformanceCheck {
            check_id: "provider.config.validation".to_string(),
            status: "fail".to_string(),
            label: "Speech-to-text provider configuration validation".to_string(),
            action_hint: Some(
                "Fix speech-to-text provider settings before running media analysis.".to_string(),
            ),
            details: json!({
                "errors": validation.errors,
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref()),
                "providerProfile": config.provider_profile.as_str()
            }),
        });
    }

    checks.push(speech_bridge_check(config, validation.valid));

    ProviderConformanceReport {
        report_version: "video-cut.provider-conformance.v1".to_string(),
        provider_id: config.provider_id.clone(),
        status: if validation.valid { "ok" } else { "fail" }.to_string(),
        generated_at: "2026-04-27T00:00:00.000Z".to_string(),
        checks,
    }
}

pub fn openai_compatible_conformance_report(
    config: &OpenAiCompatibleProviderConfig,
    required_capabilities: &[ProviderKind],
) -> ProviderConformanceReport {
    let validation = config.validate_for_required_capabilities(required_capabilities);
    let mut checks = Vec::new();

    if !validation.valid {
        checks.push(ProviderConformanceCheck {
            check_id: "provider.config.validation".to_string(),
            status: "fail".to_string(),
            label: "Provider configuration validation".to_string(),
            action_hint: Some("Fix provider settings before running media analysis.".to_string()),
            details: json!({
                "errors": validation.errors,
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref())
            }),
        });
    }

    if required_capabilities.contains(&ProviderKind::LargeLanguageModel) {
        checks.push(endpoint_check(
            "llm.endpoint.chatCompletions",
            "LLM chat completions endpoint",
            config,
            EndpointKind::ChatCompletions,
            json!({
                "method": "POST",
                "model": config.chat_model.as_deref().unwrap_or_default(),
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref()),
                "timeoutSeconds": config.timeout_seconds,
                "retryCount": config.retry_count
            }),
        ));
        checks.push(ProviderConformanceCheck {
            check_id: "llm.structuredOutput".to_string(),
            status: check_status(validation.valid).to_string(),
            label: "LLM structured output request contract".to_string(),
            action_hint: action_hint(validation.valid, "Use JSON schema mode when the provider supports it; otherwise use json_object fallback."),
            details: json!({
                "responseFormat": structured_response_format(&config.structured_output_mode),
                "schemaId": "video-cut.provider-conformance.response-format.v1"
            }),
        });
    }

    if required_capabilities.contains(&ProviderKind::SpeechToText) {
        checks.push(endpoint_check(
            "stt.endpoint.audioTranscriptions",
            "Speech-to-text audio transcriptions endpoint",
            config,
            EndpointKind::AudioTranscriptions,
            json!({
                "method": "POST",
                "multipart": true,
                "model": config.transcription_model.as_deref().unwrap_or_default(),
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref()),
                "timeoutSeconds": config.timeout_seconds,
                "retryCount": config.retry_count
            }),
        ));
    }

    ProviderConformanceReport {
        report_version: "video-cut.provider-conformance.v1".to_string(),
        provider_id: config.provider_id.clone(),
        status: if validation.valid { "ok" } else { "fail" }.to_string(),
        generated_at: "2026-04-27T00:00:00.000Z".to_string(),
        checks,
    }
}

fn speech_bridge_check(
    config: &SpeechToTextProviderConfig,
    valid: bool,
) -> ProviderConformanceCheck {
    match build_speech_to_text_bridge_endpoint(config) {
        Ok(endpoint) => ProviderConformanceCheck {
            check_id: "stt.provider.bridge".to_string(),
            status: check_status(valid).to_string(),
            label: "Speech-to-text provider bridge contract".to_string(),
            action_hint: action_hint(
                valid,
                "Configure STT provider base URL, model, credential, and vendor profile metadata.",
            ),
            details: json!({
                "providerProfile": config.provider_profile.as_str(),
                "canonicalRequest": "openai-audio-transcriptions.verbose-json",
                "canonicalResponse": "openai-audio-transcriptions.verbose-json",
                "vendorEndpoint": endpoint,
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref()),
                "model": config.transcription_model,
                "languageHint": config.language_hint,
                "timestampGranularity": config.timestamp_granularity,
                "resourceId": config.resource_id.as_deref().unwrap_or_default(),
                "timeoutSeconds": config.timeout_seconds,
                "retryCount": config.retry_count
            }),
        },
        Err(error) => ProviderConformanceCheck {
            check_id: "stt.provider.bridge".to_string(),
            status: "fail".to_string(),
            label: "Speech-to-text provider bridge contract".to_string(),
            action_hint: Some(error.message.clone()),
            details: json!({
                "error": error,
                "providerProfile": config.provider_profile.as_str(),
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref())
            }),
        },
    }
}

fn normalize_base_url(base_url: &str) -> String {
    let mut value = base_url.trim().trim_end_matches('/').to_string();
    if value.ends_with("/v1") {
        value.truncate(value.len() - 3);
    }
    value.trim_end_matches('/').to_string()
}

fn is_blank(value: Option<&str>) -> bool {
    value.map(str::trim).unwrap_or_default().is_empty()
}

fn is_ollama_endpoint(base_url: &str) -> bool {
    let lower = base_url.to_ascii_lowercase();
    lower.contains("ollama")
        || lower.contains("127.0.0.1:11434")
        || lower.contains("localhost:11434")
}

fn standard_deployment_modes() -> Vec<String> {
    [
        "desktop-local",
        "desktop-private",
        "web-private",
        "server-private",
        "container-private",
        "kubernetes-private",
    ]
    .iter()
    .map(|mode| mode.to_string())
    .collect()
}

fn endpoint_check(
    check_id: &str,
    label: &str,
    config: &OpenAiCompatibleProviderConfig,
    endpoint_kind: EndpointKind,
    extra_details: Value,
) -> ProviderConformanceCheck {
    match build_openai_compatible_endpoint(config, endpoint_kind) {
        Ok(endpoint) => ProviderConformanceCheck {
            check_id: check_id.to_string(),
            status: "ok".to_string(),
            label: label.to_string(),
            action_hint: None,
            details: merge_json_objects(json!({ "endpoint": endpoint }), extra_details),
        },
        Err(error) => ProviderConformanceCheck {
            check_id: check_id.to_string(),
            status: "fail".to_string(),
            label: label.to_string(),
            action_hint: Some(error.message.clone()),
            details: json!({
                "error": error,
                "credentialStatus": redact_secret(config.api_key_secret_ref.as_deref())
            }),
        },
    }
}

fn check_status(valid: bool) -> &'static str {
    if valid { "ok" } else { "fail" }
}

fn action_hint(valid: bool, hint: &str) -> Option<String> {
    if valid { None } else { Some(hint.to_string()) }
}

fn structured_response_format(mode: &StructuredOutputMode) -> Value {
    match mode {
        StructuredOutputMode::JsonSchema => json!({
            "type": "json_schema",
            "jsonSchema": {
                "name": "video_cut_provider_conformance",
                "strict": true,
                "schema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["status"],
                    "properties": {
                        "status": { "type": "string", "enum": ["ok"] }
                    }
                }
            }
        }),
        StructuredOutputMode::JsonObjectFallback => json!({
            "type": "json_object"
        }),
    }
}

fn merge_json_objects(mut left: Value, right: Value) -> Value {
    if let (Some(left), Some(right)) = (left.as_object_mut(), right.as_object()) {
        for (key, value) in right {
            left.insert(key.clone(), value.clone());
        }
    }

    left
}
