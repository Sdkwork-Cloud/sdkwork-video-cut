use sdkwork_video_cut_host::providers::{
    EndpointKind, OpenAiCompatibleProviderConfig, ProviderDescriptor, ProviderHealthStatus,
    ProviderKind, ProviderValidationError, SpeechToTextProviderConfig, SpeechToTextProviderProfile,
    StructuredOutputMode, build_openai_compatible_endpoint, build_speech_to_text_bridge_endpoint,
    openai_compatible_conformance_report, redact_secret, speech_to_text_conformance_report,
    speech_to_text_provider_profiles,
};

#[test]
fn provider_descriptors_have_standard_identity_and_capability_metadata() {
    let descriptor = ProviderDescriptor::openai_compatible_llm();

    assert_eq!(descriptor.provider_id, "openai-compatible-llm");
    assert_eq!(descriptor.provider_kind, ProviderKind::LargeLanguageModel);
    assert_eq!(descriptor.adapter_version, "openai-compatible.adapter.v1");
    assert_eq!(
        descriptor.capability_schema_id,
        "video-cut.provider-capability.schema.v1"
    );
    assert_eq!(
        descriptor.configuration_schema_id,
        "video-cut.openai-compatible-provider-config.schema.v1"
    );
    assert_eq!(descriptor.health_status, ProviderHealthStatus::Degraded);
    assert!(
        descriptor
            .supported_deployment_modes
            .contains(&"desktop-local".to_string())
    );
    assert!(
        descriptor
            .runtime_requirements
            .contains(&"https-egress".to_string())
    );
}

#[test]
fn openai_compatible_config_builds_standard_chat_and_transcription_endpoints() {
    let config = OpenAiCompatibleProviderConfig {
        provider_id: "primary".to_string(),
        base_url: "https://api.example.com/".to_string(),
        api_key_secret_ref: Some("secret://video-cut/openai".to_string()),
        chat_model: Some("gpt-4.1-mini".to_string()),
        transcription_model: Some("gpt-4o-mini-transcribe".to_string()),
        structured_output_mode: StructuredOutputMode::JsonSchema,
        timeout_seconds: 45,
        retry_count: 2,
    };

    assert_eq!(
        build_openai_compatible_endpoint(&config, EndpointKind::ChatCompletions).unwrap(),
        "https://api.example.com/v1/chat/completions"
    );
    assert_eq!(
        build_openai_compatible_endpoint(&config, EndpointKind::AudioTranscriptions).unwrap(),
        "https://api.example.com/v1/audio/transcriptions"
    );
}

#[test]
fn speech_to_text_provider_profiles_have_canonical_bridge_contracts() {
    let profiles = speech_to_text_provider_profiles();

    assert_eq!(
        profiles,
        vec![
            "openai-audio-transcriptions",
            "volcengine-bigasr-flash",
            "aliyun-qwen-asr"
        ]
    );
    assert_eq!(
        SpeechToTextProviderProfile::OpenAiAudioTranscriptions.as_str(),
        "openai-audio-transcriptions"
    );
    assert_eq!(
        SpeechToTextProviderProfile::VolcengineBigAsrFlash.as_str(),
        "volcengine-bigasr-flash"
    );
    assert_eq!(
        SpeechToTextProviderProfile::AliyunQwenAsr.as_str(),
        "aliyun-qwen-asr"
    );
}

#[test]
fn speech_to_text_bridge_config_builds_vendor_endpoints_and_redacted_conformance() {
    let config = SpeechToTextProviderConfig {
        provider_id: "runtime-stt-volcengine".to_string(),
        provider_profile: SpeechToTextProviderProfile::VolcengineBigAsrFlash,
        base_url: "https://openspeech.bytedance.com".to_string(),
        api_key_secret_ref: Some("settings://speech-to-text/api-key".to_string()),
        transcription_model: "bigmodel".to_string(),
        language_hint: "zh".to_string(),
        timestamp_granularity: "segment".to_string(),
        timeout_seconds: 45,
        retry_count: 2,
        resource_id: Some("volc.bigasr.auc".to_string()),
    };

    assert_eq!(
        build_speech_to_text_bridge_endpoint(&config).unwrap(),
        "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
    );

    let report = speech_to_text_conformance_report(&config);
    let serialized = serde_json::to_string(&report).expect("report json");

    assert_eq!(report.status, "ok");
    assert!(report.checks.iter().any(|check| {
        check.check_id == "stt.provider.bridge"
            && check.status == "ok"
            && check.details["providerProfile"] == "volcengine-bigasr-flash"
            && check.details["canonicalRequest"] == "openai-audio-transcriptions.verbose-json"
            && check.details["vendorEndpoint"]
                == "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
            && check.details["resourceId"] == "volc.bigasr.auc"
            && check.details["credentialStatus"] == "configured"
    }));
    assert!(!serialized.contains("settings://speech-to-text/api-key"));
    assert!(!serialized.contains("\"apiKey\""));
    assert!(!serialized.contains("Authorization"));
}

#[test]
fn openai_compatible_config_rejects_ollama_and_missing_model_settings() {
    let config = OpenAiCompatibleProviderConfig {
        provider_id: "local".to_string(),
        base_url: "http://127.0.0.1:11434".to_string(),
        api_key_secret_ref: None,
        chat_model: Some(" ".to_string()),
        transcription_model: None,
        structured_output_mode: StructuredOutputMode::JsonObjectFallback,
        timeout_seconds: 0,
        retry_count: 12,
    };

    let validation = config.validate_for_required_capabilities(&[
        ProviderKind::LargeLanguageModel,
        ProviderKind::SpeechToText,
    ]);

    assert_eq!(
        validation.errors,
        vec![
            ProviderValidationError::new(
                "baseUrl",
                "OLLAMA_NOT_ALLOWED",
                "Ollama-compatible endpoints are not allowed by this product contract.",
            ),
            ProviderValidationError::new(
                "credential",
                "REQUIRED",
                "Provider credential is required."
            ),
            ProviderValidationError::new(
                "chatModel",
                "REQUIRED",
                "Chat model is required for LLM capability."
            ),
            ProviderValidationError::new(
                "transcriptionModel",
                "REQUIRED",
                "Transcription model is required for speech-to-text capability.",
            ),
            ProviderValidationError::new(
                "timeoutSeconds",
                "OUT_OF_RANGE",
                "Timeout must be between 1 and 600 seconds."
            ),
            ProviderValidationError::new(
                "retryCount",
                "OUT_OF_RANGE",
                "Retry count must be between 0 and 5."
            ),
        ]
    );
}

#[test]
fn secret_redaction_never_exposes_plaintext_secret_values() {
    assert_eq!(redact_secret(Some("sk-live-secret")), "configured");
    assert_eq!(redact_secret(Some("   ")), "not-configured");
    assert_eq!(redact_secret(None), "not-configured");
}

#[test]
fn provider_conformance_report_describes_standard_requests_without_leaking_secrets() {
    let config = OpenAiCompatibleProviderConfig {
        provider_id: "primary".to_string(),
        base_url: "https://api.example.com/v1".to_string(),
        api_key_secret_ref: Some("secret://video-cut/openai".to_string()),
        chat_model: Some("gpt-4.1-mini".to_string()),
        transcription_model: Some("gpt-4o-mini-transcribe".to_string()),
        structured_output_mode: StructuredOutputMode::JsonSchema,
        timeout_seconds: 45,
        retry_count: 2,
    };

    let report = openai_compatible_conformance_report(
        &config,
        &[ProviderKind::LargeLanguageModel, ProviderKind::SpeechToText],
    );
    let serialized = serde_json::to_string(&report).expect("report json");

    assert_eq!(report.report_version, "video-cut.provider-conformance.v1");
    assert_eq!(report.status, "ok");
    assert!(report.checks.iter().any(|check| {
        check.check_id == "llm.endpoint.chatCompletions"
            && check.status == "ok"
            && check.details["endpoint"] == "https://api.example.com/v1/chat/completions"
    }));
    assert!(report.checks.iter().any(|check| {
        check.check_id == "llm.structuredOutput"
            && check.details["responseFormat"]["type"] == "json_schema"
    }));
    assert!(report.checks.iter().any(|check| {
        check.check_id == "stt.endpoint.audioTranscriptions"
            && check.details["endpoint"] == "https://api.example.com/v1/audio/transcriptions"
    }));
    assert!(!serialized.contains("secret://video-cut/openai"));
    assert!(serialized.contains("configured"));
}

#[test]
fn invalid_provider_conformance_report_does_not_emit_secret_reference_field_names() {
    let config = OpenAiCompatibleProviderConfig {
        provider_id: "missing-credential".to_string(),
        base_url: "https://api.example.com/v1".to_string(),
        api_key_secret_ref: None,
        chat_model: Some("gpt-4.1-mini".to_string()),
        transcription_model: Some("gpt-4o-mini-transcribe".to_string()),
        structured_output_mode: StructuredOutputMode::JsonSchema,
        timeout_seconds: 45,
        retry_count: 2,
    };

    let report = openai_compatible_conformance_report(
        &config,
        &[ProviderKind::LargeLanguageModel, ProviderKind::SpeechToText],
    );
    let serialized = serde_json::to_string(&report).expect("report json");

    assert_eq!(report.status, "fail");
    assert!(!serialized.contains("\"apiKey\""));
    assert!(!serialized.contains("apiKeySecretRef"));
    assert!(!serialized.contains("credentialSecretRef"));
    assert!(!serialized.contains("secretRef"));
    assert!(serialized.contains("not-configured"));
    assert!(serialized.contains("credentialStatus"));
}
