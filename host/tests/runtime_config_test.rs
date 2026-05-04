use std::collections::HashMap;

use sdkwork_video_cut_host::runtime_config::RuntimeHostConfig;

fn env(values: &[(&str, &str)]) -> HashMap<String, String> {
    values
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

#[test]
fn runtime_config_maps_standard_environment_into_effective_settings() {
    let config = RuntimeHostConfig::from_env_map(&env(&[
        ("SDKWORK_VIDEO_CUT_RUNTIME_MODE", "server-private"),
        ("SDKWORK_VIDEO_CUT_BIND_HOST", "0.0.0.0"),
        ("SDKWORK_VIDEO_CUT_PORT", "6188"),
        (
            "SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL",
            "https://video.example.test",
        ),
        (
            "SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS",
            "https://video.example.test, http://127.0.0.1:5173",
        ),
        ("SDKWORK_VIDEO_CUT_WORKSPACE_ROOT", "D:/video-cut/workspace"),
        ("SDKWORK_VIDEO_CUT_ARTIFACT_ROOT", "D:/video-cut/artifacts"),
        ("SDKWORK_VIDEO_CUT_TEMP_ROOT", "D:/video-cut/tmp"),
        ("SDKWORK_VIDEO_CUT_WORKER_CONCURRENCY", "6"),
        ("SDKWORK_VIDEO_CUT_MAX_UPLOAD_BYTES", "104857600"),
        ("SDKWORK_VIDEO_CUT_AUTH_MODE", "single-user-token"),
        ("SDKWORK_VIDEO_CUT_SERVER_TOKEN", "server-env-token"),
        (
            "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_BASE_URL",
            "https://llm.example.test/v1",
        ),
        (
            "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_API_KEY",
            "sk-env-secret",
        ),
        (
            "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_CHAT_MODEL",
            "gpt-5.4-mini",
        ),
        (
            "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL",
            "gpt-4o-mini-transcribe",
        ),
        (
            "SDKWORK_VIDEO_CUT_STT_BASE_URL",
            "https://openspeech.bytedance.com",
        ),
        ("SDKWORK_VIDEO_CUT_STT_API_KEY", "stt-env-secret"),
        ("SDKWORK_VIDEO_CUT_STT_TRANSCRIPTION_MODEL", "bigmodel"),
        (
            "SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE",
            "volcengine-bigasr-flash",
        ),
        ("SDKWORK_VIDEO_CUT_STT_RESOURCE_ID", "volc.bigasr.auc"),
    ]))
    .expect("runtime config");

    assert_eq!(config.bind_addr.to_string(), "0.0.0.0:6188");
    assert_eq!(
        config.workspace_root.to_string_lossy(),
        "D:/video-cut/workspace"
    );
    assert_eq!(
        config.settings["runtime"]["deploymentMode"],
        "server-private"
    );
    assert_eq!(
        config.settings["runtime"]["publicBaseUrl"],
        "https://video.example.test"
    );
    assert_eq!(
        config.settings["security"]["corsAllowedOrigins"],
        serde_json::json!(["https://video.example.test", "http://127.0.0.1:5173"])
    );
    assert_eq!(config.settings["runtime"]["authMode"], "single-user-token");
    assert_eq!(
        config.settings["storage"]["artifactRoot"],
        "D:/video-cut/artifacts"
    );
    assert_eq!(config.settings["storage"]["tempRoot"], "D:/video-cut/tmp");
    assert_eq!(config.settings["mediaTools"]["workerConcurrency"], 6);
    assert_eq!(config.settings["mediaTools"]["maxUploadBytes"], 104857600);
    assert_eq!(config.settings["ai"]["enabled"], true);
    assert_eq!(
        config.settings["ai"]["baseUrl"],
        "https://llm.example.test/v1"
    );
    assert_eq!(config.settings["ai"]["chatModel"], "gpt-5.4-mini");
    assert_eq!(config.settings["ai"]["apiKeyConfigured"], true);
    assert!(config.settings["ai"].get("apiKey").is_none());
    assert_eq!(config.settings["speechToText"]["enabled"], true);
    assert_eq!(
        config.settings["speechToText"]["transcriptionModel"],
        "bigmodel"
    );
    assert_eq!(
        config.settings["speechToText"]["reuseAiProviderConnection"],
        false
    );
    assert_eq!(
        config.settings["speechToText"]["baseUrl"],
        "https://openspeech.bytedance.com"
    );
    assert_eq!(config.settings["speechToText"]["apiKeyConfigured"], true);
    assert_eq!(
        config.settings["speechToText"]["providerProfile"],
        "volcengine-bigasr-flash"
    );
    assert_eq!(
        config.settings["speechToText"]["resourceId"],
        "volc.bigasr.auc"
    );
    assert_eq!(config.runtime_secrets.len(), 3);
    assert_eq!(
        config.runtime_secrets[0].secret_ref,
        "settings://ai/api-key"
    );
    assert_eq!(config.runtime_secrets[0].secret_value, "sk-env-secret");
    assert_eq!(
        config.runtime_secrets[1].secret_ref,
        "settings://speech-to-text/api-key"
    );
    assert_eq!(config.runtime_secrets[1].secret_value, "stt-env-secret");
    assert_eq!(
        config.runtime_secrets[2].secret_ref,
        "settings://server/token"
    );
}

#[test]
fn runtime_config_rejects_legacy_video_cut_environment_aliases() {
    let error = RuntimeHostConfig::from_env_map(&env(&[
        ("VIDEO_CUT_HOST_BIND", "127.0.0.1:6000"),
        ("SDKWORK_VIDEO_CUT_BIND_HOST", "127.0.0.1"),
        ("SDKWORK_VIDEO_CUT_PORT", "6199"),
    ]))
    .expect_err("new runtime standard must reject legacy VIDEO_CUT_* aliases");

    assert!(error.contains("VIDEO_CUT_HOST_BIND"));
    assert!(error.contains("SDKWORK_VIDEO_CUT_*"));
}

#[test]
fn runtime_config_rejects_cors_allowed_origin_with_path() {
    let error = RuntimeHostConfig::from_env_map(&env(&[(
        "SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS",
        "https://video.example.test/app",
    )]))
    .expect_err("CORS allowlist entries must be origins, not URLs with paths");

    assert!(error.contains("SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS"));
    assert!(error.contains("invalid HTTP(S) origin"));
}

#[test]
fn runtime_config_rejects_server_bind_without_auth() {
    let env = HashMap::from([
        (
            "SDKWORK_VIDEO_CUT_RUNTIME_MODE".to_string(),
            "server-private".to_string(),
        ),
        (
            "SDKWORK_VIDEO_CUT_BIND_HOST".to_string(),
            "0.0.0.0".to_string(),
        ),
    ]);

    let error = RuntimeHostConfig::from_env_map(&env).expect_err("runtime config must fail fast");

    assert!(error.contains("SDKWORK_VIDEO_CUT_AUTH_MODE"));
    assert!(error.contains("server-private"));
}

#[test]
fn runtime_config_requires_server_token_for_single_user_token_auth() {
    let env = HashMap::from([
        (
            "SDKWORK_VIDEO_CUT_RUNTIME_MODE".to_string(),
            "server-private".to_string(),
        ),
        (
            "SDKWORK_VIDEO_CUT_BIND_HOST".to_string(),
            "0.0.0.0".to_string(),
        ),
        (
            "SDKWORK_VIDEO_CUT_AUTH_MODE".to_string(),
            "single-user-token".to_string(),
        ),
    ]);

    let error = RuntimeHostConfig::from_env_map(&env).expect_err("server token must be required");

    assert!(error.contains("SDKWORK_VIDEO_CUT_SERVER_TOKEN"));
}
