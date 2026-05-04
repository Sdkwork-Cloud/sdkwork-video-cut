use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::contracts::default_settings;

const ENV_RUNTIME_MODE: &str = "SDKWORK_VIDEO_CUT_RUNTIME_MODE";
const ENV_BIND_HOST: &str = "SDKWORK_VIDEO_CUT_BIND_HOST";
const ENV_PORT: &str = "SDKWORK_VIDEO_CUT_PORT";
const ENV_PUBLIC_BASE_URL: &str = "SDKWORK_VIDEO_CUT_PUBLIC_BASE_URL";
const ENV_WORKSPACE_ROOT: &str = "SDKWORK_VIDEO_CUT_WORKSPACE_ROOT";
const ENV_ARTIFACT_ROOT: &str = "SDKWORK_VIDEO_CUT_ARTIFACT_ROOT";
const ENV_TEMP_ROOT: &str = "SDKWORK_VIDEO_CUT_TEMP_ROOT";
const ENV_WORKER_CONCURRENCY: &str = "SDKWORK_VIDEO_CUT_WORKER_CONCURRENCY";
const ENV_MAX_UPLOAD_BYTES: &str = "SDKWORK_VIDEO_CUT_MAX_UPLOAD_BYTES";
const ENV_AUTH_MODE: &str = "SDKWORK_VIDEO_CUT_AUTH_MODE";
const ENV_SERVER_TOKEN: &str = "SDKWORK_VIDEO_CUT_SERVER_TOKEN";
const ENV_CORS_ALLOWED_ORIGINS: &str = "SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS";
const ENV_OPENAI_BASE_URL: &str = "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_BASE_URL";
const ENV_OPENAI_API_KEY: &str = "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_API_KEY";
const ENV_OPENAI_CHAT_MODEL: &str = "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_CHAT_MODEL";
const ENV_OPENAI_TRANSCRIPTION_MODEL: &str =
    "SDKWORK_VIDEO_CUT_OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL";
const ENV_STT_BASE_URL: &str = "SDKWORK_VIDEO_CUT_STT_BASE_URL";
const ENV_STT_API_KEY: &str = "SDKWORK_VIDEO_CUT_STT_API_KEY";
const ENV_STT_TRANSCRIPTION_MODEL: &str = "SDKWORK_VIDEO_CUT_STT_TRANSCRIPTION_MODEL";
const ENV_STT_PROVIDER_PROFILE: &str = "SDKWORK_VIDEO_CUT_STT_PROVIDER_PROFILE";
const ENV_STT_RESOURCE_ID: &str = "SDKWORK_VIDEO_CUT_STT_RESOURCE_ID";

const FORBIDDEN_LEGACY_ENV_PREFIX: &str = "VIDEO_CUT_";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeSecret {
    pub secret_ref: String,
    pub secret_value: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHostConfig {
    pub settings: Value,
    pub bind_addr: SocketAddr,
    pub workspace_root: PathBuf,
    pub runtime_secrets: Vec<RuntimeSecret>,
}

impl RuntimeHostConfig {
    pub fn from_process_env() -> Result<Self, String> {
        let env = std::env::vars().collect::<HashMap<_, _>>();
        Self::from_env_map(&env)
    }

    pub fn from_env_map(env: &HashMap<String, String>) -> Result<Self, String> {
        let mut settings = default_settings();
        let mut runtime_secrets = Vec::new();

        reject_legacy_environment_aliases(env)?;
        apply_standard_environment(&mut settings, env, &mut runtime_secrets)?;
        validate_runtime_security(&settings, &runtime_secrets)?;

        let bind_host = string_at(&settings, "/runtime/bindHost").to_string();
        let port = integer_at(&settings, "/runtime/port")?;
        let bind_addr = format!("{bind_host}:{port}")
            .parse::<SocketAddr>()
            .map_err(|error| format!("Invalid runtime bind address {bind_host}:{port}: {error}"))?;
        let workspace_root = PathBuf::from(string_at(&settings, "/storage/workspaceRoot"));

        Ok(Self {
            settings,
            bind_addr,
            workspace_root,
            runtime_secrets,
        })
    }
}

fn reject_legacy_environment_aliases(env: &HashMap<String, String>) -> Result<(), String> {
    let mut legacy_keys = env
        .keys()
        .filter(|key| key.starts_with(FORBIDDEN_LEGACY_ENV_PREFIX))
        .cloned()
        .collect::<Vec<_>>();
    legacy_keys.sort();

    if legacy_keys.is_empty() {
        return Ok(());
    }

    Err(format!(
        "Legacy VIDEO_CUT_* environment variables are not supported. Use SDKWORK_VIDEO_CUT_* only. Offending keys: {}",
        legacy_keys.join(", ")
    ))
}

fn apply_standard_environment(
    settings: &mut Value,
    env: &HashMap<String, String>,
    runtime_secrets: &mut Vec<RuntimeSecret>,
) -> Result<(), String> {
    if let Some(value) = non_blank(env, ENV_RUNTIME_MODE) {
        settings["runtime"]["deploymentMode"] = json!(value);
        settings["security"]["secretProvider"] = json!(secret_provider_for_mode(value));
    }
    if let Some(value) = non_blank(env, ENV_BIND_HOST) {
        settings["runtime"]["bindHost"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_PORT) {
        settings["runtime"]["port"] = json!(parse_u16(ENV_PORT, value)?);
    }
    if let Some(value) = non_blank(env, ENV_PUBLIC_BASE_URL) {
        settings["runtime"]["publicBaseUrl"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_WORKSPACE_ROOT) {
        settings["storage"]["workspaceRoot"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_ARTIFACT_ROOT) {
        settings["storage"]["artifactRoot"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_TEMP_ROOT) {
        settings["storage"]["tempRoot"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_WORKER_CONCURRENCY) {
        settings["mediaTools"]["workerConcurrency"] =
            json!(parse_u64(ENV_WORKER_CONCURRENCY, value)?);
    }
    if let Some(value) = non_blank(env, ENV_MAX_UPLOAD_BYTES) {
        settings["mediaTools"]["maxUploadBytes"] = json!(parse_u64(ENV_MAX_UPLOAD_BYTES, value)?);
    }
    if let Some(value) = non_blank(env, ENV_AUTH_MODE) {
        settings["runtime"]["authMode"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_OPENAI_BASE_URL) {
        settings["ai"]["enabled"] = json!(true);
        settings["ai"]["baseUrl"] = json!(value);
        settings["speechToText"]["baseUrl"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_OPENAI_CHAT_MODEL) {
        settings["ai"]["enabled"] = json!(true);
        settings["ai"]["chatModel"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_OPENAI_TRANSCRIPTION_MODEL) {
        settings["speechToText"]["enabled"] = json!(true);
        settings["speechToText"]["transcriptionModel"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_STT_BASE_URL) {
        settings["speechToText"]["enabled"] = json!(true);
        settings["speechToText"]["reuseAiProviderConnection"] = json!(false);
        settings["speechToText"]["baseUrl"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_STT_TRANSCRIPTION_MODEL) {
        settings["speechToText"]["enabled"] = json!(true);
        settings["speechToText"]["transcriptionModel"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_STT_PROVIDER_PROFILE) {
        settings["speechToText"]["enabled"] = json!(true);
        settings["speechToText"]["providerProfile"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_STT_RESOURCE_ID) {
        settings["speechToText"]["resourceId"] = json!(value);
    }
    if let Some(value) = non_blank(env, ENV_OPENAI_API_KEY) {
        settings["ai"]["enabled"] = json!(true);
        settings["ai"]["apiKeyConfigured"] = json!(true);
        settings["speechToText"]["enabled"] = json!(true);
        settings["speechToText"]["reuseAiProviderConnection"] = json!(true);
        runtime_secrets.push(RuntimeSecret {
            secret_ref: "settings://ai/api-key".to_string(),
            secret_value: value.to_string(),
        });
    }
    if let Some(value) = non_blank(env, ENV_STT_API_KEY) {
        settings["speechToText"]["enabled"] = json!(true);
        settings["speechToText"]["reuseAiProviderConnection"] = json!(false);
        settings["speechToText"]["apiKeyConfigured"] = json!(true);
        runtime_secrets.push(RuntimeSecret {
            secret_ref: "settings://speech-to-text/api-key".to_string(),
            secret_value: value.to_string(),
        });
    }
    if let Some(value) = non_blank(env, ENV_SERVER_TOKEN) {
        runtime_secrets.push(RuntimeSecret {
            secret_ref: "settings://server/token".to_string(),
            secret_value: value.to_string(),
        });
    }
    if let Some(value) = non_blank(env, ENV_CORS_ALLOWED_ORIGINS) {
        settings["security"]["corsAllowedOrigins"] = json!(parse_csv_list(value));
    }

    Ok(())
}

fn validate_runtime_security(
    settings: &Value,
    runtime_secrets: &[RuntimeSecret],
) -> Result<(), String> {
    let deployment_mode = string_at(settings, "/runtime/deploymentMode");
    let bind_host = string_at(settings, "/runtime/bindHost");
    let auth_mode = string_at(settings, "/runtime/authMode");

    if deployment_mode != "desktop-local" && bind_host == "0.0.0.0" && auth_mode == "none" {
        return Err(format!(
            "{ENV_AUTH_MODE} must be single-user-token or reverse-proxy when {deployment_mode} binds 0.0.0.0."
        ));
    }

    if auth_mode == "single-user-token"
        && !runtime_secrets
            .iter()
            .any(|secret| secret.secret_ref == "settings://server/token")
    {
        return Err(format!(
            "{ENV_SERVER_TOKEN} is required when {ENV_AUTH_MODE}=single-user-token."
        ));
    }

    validate_cors_allowed_origins(settings)?;

    Ok(())
}

fn secret_provider_for_mode(mode: &str) -> &'static str {
    match mode {
        "kubernetes-private" => "kubernetes-secret",
        "server-private" | "container-private" => "env",
        _ => "local-secure-store",
    }
}

fn non_blank<'a>(env: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    env.get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn parse_u16(name: &str, value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|error| format!("{name} must be a valid port: {error}"))
}

fn parse_u64(name: &str, value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|error| format!("{name} must be a positive integer: {error}"))
}

fn parse_csv_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn validate_cors_allowed_origins(settings: &Value) -> Result<(), String> {
    let Some(origins) = settings
        .pointer("/security/corsAllowedOrigins")
        .and_then(Value::as_array)
    else {
        return Ok(());
    };

    for origin in origins.iter().filter_map(Value::as_str) {
        let origin = origin.trim();
        if origin == "*" {
            return Err(format!(
                "{ENV_CORS_ALLOWED_ORIGINS} must not contain wildcard origin *."
            ));
        }
        if !is_valid_http_origin(origin) {
            return Err(format!(
                "{ENV_CORS_ALLOWED_ORIGINS} contains invalid HTTP(S) origin: {origin}"
            ));
        }
    }

    Ok(())
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

fn integer_at(settings: &Value, pointer: &str) -> Result<u16, String> {
    settings
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
        .ok_or_else(|| format!("Runtime setting {pointer} must be a valid port."))
}

fn string_at<'a>(settings: &'a Value, pointer: &str) -> &'a str {
    settings
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or("")
}
