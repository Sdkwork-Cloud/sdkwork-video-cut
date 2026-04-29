use std::fs;
use std::path::Path;

use serde_json::{Value, json};

use crate::contracts::fixed_time;
use crate::providers::speech_to_text_provider_profiles;
use crate::settings::{sanitize_settings, validate_settings};
use crate::state::AppState;
use crate::tooling::media_tool_capability;

const REDACTED_PATH: &str = "<redacted-path>";

pub(crate) fn capability_report(settings: &Value) -> Value {
    let validation = validate_settings(settings);
    let has_field_error = |prefix: &str| {
        validation
            .errors
            .iter()
            .any(|error| error.field.starts_with(prefix))
    };
    let ai_ready = bool_at(settings, "/ai/enabled")
        && bool_at(settings, "/ai/apiKeyConfigured")
        && !has_field_error("ai.");
    let stt_ready = bool_at(settings, "/speechToText/enabled")
        && (bool_at(settings, "/speechToText/apiKeyConfigured")
            || (bool_at(settings, "/speechToText/reuseAiProviderConnection") && ai_ready))
        && !has_field_error("speechToText.");

    json!({
        "reportVersion": "video-cut.capability.v1",
        "deploymentMode": settings["runtime"]["deploymentMode"].clone(),
        "qualityTier": "basic",
        "health": "ok",
        "ai": if ai_ready {
            json!({
                "status": "ok",
                "label": "LLM ready"
            })
        } else {
            json!({
            "status": "warn",
            "label": "LLM not configured",
            "actionHint": "Open Settings > AI Providers and configure an API key."
            })
        },
        "speechToText": if stt_ready {
            json!({
                "status": "ok",
                "label": "Speech to text ready"
            })
        } else {
            json!({
            "status": "warn",
            "label": "Speech to text not configured",
            "actionHint": "Open Settings > Speech To Text and configure transcription."
            })
        },
        "media": media_tool_capability(settings),
        "storage": { "status": "ok", "label": "Workspace paths configured" },
        "security": { "status": "ok", "label": "Redaction enabled" },
        "providers": provider_contract_policy()
    })
}

pub(crate) fn deployment_doctor_report(state: &AppState, settings: &Value) -> Value {
    let capability = capability_report(settings);
    let media = media_tool_capability(settings);
    let missing_tools = media["missingTools"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let validation = validate_settings(settings);
    let redacted_config = diagnostic_redacted_settings(settings);
    let checks = vec![
        json!({
            "checkId": "health",
            "status": "ok",
            "label": "Host health",
            "actionHint": null
        }),
        workspace_writable_check(&state.workspace_root(settings)),
        media_tool_check("ffmpeg", &media, &missing_tools),
        media_tool_check("ffprobe", &media, &missing_tools),
        json!({
            "checkId": "providerPolicy",
            "status": "ok",
            "label": "OpenAI-compatible provider policy active",
            "actionHint": null
        }),
        settings_validation_check(&validation),
        redaction_check(&redacted_config),
    ];
    let health = report_health(&checks);

    json!({
        "reportVersion": "video-cut.doctor.v1",
        "deploymentMode": settings["runtime"]["deploymentMode"].clone(),
        "generatedAt": fixed_time(),
        "health": health,
        "capability": capability,
        "checks": checks,
        "redactedConfig": redacted_config
    })
}

pub(crate) fn diagnostics_bundle_report(state: &AppState, settings: &Value) -> Value {
    let capability = capability_report(settings);
    let doctor = deployment_doctor_report(state, settings);
    let redacted_config = diagnostic_redacted_settings(settings);

    json!({
        "bundleVersion": "video-cut.diagnostics-bundle.v1",
        "generatedAt": fixed_time(),
        "deploymentMode": settings["runtime"]["deploymentMode"].clone(),
        "includes": {
            "sourceMedia": false,
            "transcript": false
        },
        "capability": capability,
        "doctor": doctor,
        "redactedConfig": redacted_config,
        "artifacts": []
    })
}

fn provider_contract_policy() -> Value {
    json!({
        "providerCapabilityVersion": "video-cut.provider-capability.schema.v1",
        "configurationSchemaId": "video-cut.openai-compatible-provider-config.schema.v1",
        "openAiCompatible": {
            "chatCompletionsEndpoint": "/v1/chat/completions",
            "audioTranscriptionsEndpoint": "/v1/audio/transcriptions",
            "structuredOutputModes": ["json-schema", "json-object-fallback"],
            "ollamaAllowed": false
        },
        "speechToTextProviderProfiles": speech_to_text_provider_profiles(),
        "requiredPorts": [
            "LlmProviderPort",
            "SpeechToTextPort",
            "SubtitlePort",
            "SecretStorePort"
        ]
    })
}

fn workspace_writable_check(workspace_root: &Path) -> Value {
    let probe_path = workspace_root.join(".video-cut-doctor-write-test");
    let result = fs::create_dir_all(workspace_root)
        .and_then(|_| fs::write(&probe_path, b"ok"))
        .and_then(|_| fs::remove_file(&probe_path));

    match result {
        Ok(()) => json!({
            "checkId": "workspaceWritable",
            "status": "ok",
            "label": "Workspace writable",
            "actionHint": null,
            "details": { "path": redact_path_value(&workspace_root.display().to_string()) }
        }),
        Err(error) => json!({
            "checkId": "workspaceWritable",
            "status": "fail",
            "label": "Workspace is not writable",
            "actionHint": "Open Settings > Storage and configure a writable workspace root.",
            "details": {
                "path": redact_path_value(&workspace_root.display().to_string()),
                "error": error.to_string()
            }
        }),
    }
}

fn media_tool_check(tool: &str, media: &Value, missing_tools: &[Value]) -> Value {
    let missing = missing_tools.iter().any(|item| item.as_str() == Some(tool));
    let configured_path = media
        .pointer(&format!("/checkedTools/{tool}"))
        .and_then(Value::as_str)
        .unwrap_or(tool);

    if missing {
        return json!({
            "checkId": tool,
            "status": "fail",
            "label": format!("{tool} unavailable"),
            "actionHint": "Open Settings > Media Tools and configure valid ffmpeg/ffprobe paths.",
            "details": { "path": redact_path_value(configured_path) }
        });
    }

    json!({
        "checkId": tool,
        "status": "ok",
        "label": format!("{tool} available"),
        "actionHint": null,
        "details": { "path": redact_path_value(configured_path) }
    })
}

fn diagnostic_redacted_settings(settings: &Value) -> Value {
    let mut redacted = sanitize_settings(settings);
    if let Some(storage) = redacted.get_mut("storage").and_then(Value::as_object_mut) {
        for key in ["workspaceRoot", "artifactRoot", "tempRoot"] {
            if let Some(value) = storage.get(key).and_then(Value::as_str)
                && is_server_local_path(value)
            {
                storage.insert(key.to_string(), json!(REDACTED_PATH));
            }
        }
    }

    redacted
}

fn redact_path_value(value: &str) -> String {
    if is_server_local_path(value) {
        return REDACTED_PATH.to_string();
    }

    value.to_string()
}

fn is_server_local_path(value: &str) -> bool {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() {
        return false;
    }

    normalized.starts_with('/')
        || (normalized.len() >= 3
            && normalized.as_bytes()[0].is_ascii_alphabetic()
            && normalized.as_bytes()[1] == b':'
            && normalized.as_bytes()[2] == b'/')
}

fn settings_validation_check(validation: &crate::settings::SettingsValidationResult) -> Value {
    if validation.valid {
        return json!({
            "checkId": "settingsValidation",
            "status": "ok",
            "label": "Runtime settings valid",
            "actionHint": null
        });
    }

    json!({
        "checkId": "settingsValidation",
        "status": "fail",
        "label": "Runtime settings invalid",
        "actionHint": "Open Settings and resolve validation errors.",
        "details": { "errors": validation.errors }
    })
}

fn redaction_check(redacted_config: &Value) -> Value {
    let serialized = redacted_config.to_string();
    let has_plain_secret = serialized.contains("\"apiKey\"");
    if has_plain_secret {
        return json!({
            "checkId": "redaction",
            "status": "fail",
            "label": "Diagnostics redaction failed",
            "actionHint": "Do not export diagnostics until secrets are removed."
        });
    }

    json!({
        "checkId": "redaction",
        "status": "ok",
        "label": "Diagnostics redaction enabled",
        "actionHint": null
    })
}

fn report_health(checks: &[Value]) -> &'static str {
    if checks
        .iter()
        .any(|check| check["status"].as_str() == Some("fail"))
    {
        return "degraded";
    }

    if checks
        .iter()
        .any(|check| check["status"].as_str() == Some("warn"))
    {
        return "degraded";
    }

    "ok"
}

fn bool_at(value: &Value, pointer: &str) -> bool {
    value
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}
