#[cfg(any(test, windows))]
use std::sync::OnceLock;

use keyring_core::Entry;
use serde::{Deserialize, Serialize};

const AUTOCUT_LLM_SECRET_SERVICE: &str = "com.sdkwork.video-cut.llm";
const AUTOCUT_LLM_SECRET_USER_PREFIX: &str = "autocut-llm";
const MAX_AUTOCUT_LLM_SECRET_NAME_BYTES: usize = 96;
const MAX_AUTOCUT_LLM_SECRET_VALUE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLlmSecretRequest {
    pub secret_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSaveLlmSecretRequest {
    pub secret_name: String,
    pub secret_value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSaveLlmSecretResult {
    pub secret_name: String,
    pub saved: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutGetLlmSecretResult {
    pub secret_name: String,
    pub configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutDeleteLlmSecretResult {
    pub secret_name: String,
    pub deleted: bool,
}

pub fn save_autocut_llm_secret(
    request: AutoCutSaveLlmSecretRequest,
) -> Result<AutoCutSaveLlmSecretResult, String> {
    ensure_autocut_keyring_store()?;
    validate_autocut_secret_value(&request.secret_value)?;
    let normalized_secret_name = normalize_autocut_secret_name(&request.secret_name)?;
    autocut_secret_entry(&normalized_secret_name)?
        .set_password(&request.secret_value)
        .map_err(|error| format!("Failed to save AutoCut LLM secret: {error}"))?;

    Ok(AutoCutSaveLlmSecretResult {
        secret_name: normalized_secret_name,
        saved: true,
    })
}

pub fn get_autocut_llm_secret(
    request: AutoCutLlmSecretRequest,
) -> Result<AutoCutGetLlmSecretResult, String> {
    ensure_autocut_keyring_store()?;
    let normalized_secret_name = normalize_autocut_secret_name(&request.secret_name)?;
    match autocut_secret_entry(&normalized_secret_name)?.get_password() {
        Ok(secret_value) => Ok(AutoCutGetLlmSecretResult {
            secret_name: normalized_secret_name,
            configured: true,
            secret_value: Some(secret_value),
        }),
        Err(keyring_core::Error::NoEntry) => Ok(AutoCutGetLlmSecretResult {
            secret_name: normalized_secret_name,
            configured: false,
            secret_value: None,
        }),
        Err(error) => Err(format!("Failed to read AutoCut LLM secret: {error}")),
    }
}

pub fn delete_autocut_llm_secret(
    request: AutoCutLlmSecretRequest,
) -> Result<AutoCutDeleteLlmSecretResult, String> {
    ensure_autocut_keyring_store()?;
    let normalized_secret_name = normalize_autocut_secret_name(&request.secret_name)?;
    match autocut_secret_entry(&normalized_secret_name)?.delete_credential() {
        Ok(()) => Ok(AutoCutDeleteLlmSecretResult {
            secret_name: normalized_secret_name,
            deleted: true,
        }),
        Err(keyring_core::Error::NoEntry) => Ok(AutoCutDeleteLlmSecretResult {
            secret_name: normalized_secret_name,
            deleted: false,
        }),
        Err(error) => Err(format!("Failed to delete AutoCut LLM secret: {error}")),
    }
}

fn ensure_autocut_keyring_store() -> Result<(), String> {
    #[cfg(test)]
    {
        return Ok(());
    }

    #[cfg(all(not(test), windows))]
    {
        static KEYRING_STORE_INIT: OnceLock<Result<(), String>> = OnceLock::new();
        KEYRING_STORE_INIT
            .get_or_init(|| {
                let store = windows_native_keyring_store::Store::new()
                    .map_err(|error| format!("Failed to initialize AutoCut Windows keyring store: {error}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            })
            .clone()
    }

    #[cfg(all(not(test), not(windows)))]
    {
        Err("AutoCut LLM secret store is only implemented for the Windows desktop host in this build.".to_string())
    }
}

fn autocut_secret_entry(secret_name: &str) -> Result<keyring_core::Entry, String> {
    let user = format!("{AUTOCUT_LLM_SECRET_USER_PREFIX}-{secret_name}");
    Entry::new(AUTOCUT_LLM_SECRET_SERVICE, &user)
        .map_err(|error| format!("Failed to open AutoCut LLM secret entry: {error}"))
}

fn normalize_autocut_secret_name(secret_name: &str) -> Result<String, String> {
    let normalized = secret_name.trim();
    if normalized.is_empty() {
        return Err("AutoCut LLM secret name is required.".to_string());
    }

    if normalized.len() > MAX_AUTOCUT_LLM_SECRET_NAME_BYTES {
        return Err("AutoCut LLM secret name is too long.".to_string());
    }

    if !normalized
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("AutoCut LLM secret name may only contain ASCII letters, numbers, '-' and '_'.".to_string());
    }

    Ok(normalized.to_string())
}

fn validate_autocut_secret_value(secret_value: &str) -> Result<(), String> {
    if secret_value.trim().is_empty() {
        return Err("AutoCut LLM secret value is required.".to_string());
    }

    if secret_value.len() > MAX_AUTOCUT_LLM_SECRET_VALUE_BYTES {
        return Err("AutoCut LLM secret value is too large.".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    static TEST_KEYRING_STORE_INIT: OnceLock<()> = OnceLock::new();

    fn ensure_test_keyring_store() {
        TEST_KEYRING_STORE_INIT.get_or_init(|| {
            keyring_core::set_default_store(mock::Store::new().expect("mock keyring store should initialize"));
        });
    }

    #[test]
    fn saves_reads_and_deletes_llm_secret() {
        ensure_test_keyring_store();
        let secret_name = format!(
            "test_{}",
            std::thread::current()
                .name()
                .unwrap_or("llm_secret_lifecycle")
                .replace(|character: char| !character.is_ascii_alphanumeric(), "_")
        );

        let saved = save_autocut_llm_secret(AutoCutSaveLlmSecretRequest {
            secret_name: secret_name.clone(),
            secret_value: "sk-test-secret".to_string(),
        })
        .expect("LLM secret should save");

        assert_eq!(saved.secret_name, secret_name);
        assert!(saved.saved);

        let loaded = get_autocut_llm_secret(AutoCutLlmSecretRequest {
            secret_name: secret_name.clone(),
        })
        .expect("LLM secret should load");

        assert!(loaded.configured);
        assert_eq!(loaded.secret_value.as_deref(), Some("sk-test-secret"));

        let deleted = delete_autocut_llm_secret(AutoCutLlmSecretRequest {
            secret_name: secret_name.clone(),
        })
        .expect("LLM secret should delete");

        assert!(deleted.deleted);

        let missing = get_autocut_llm_secret(AutoCutLlmSecretRequest { secret_name })
            .expect("missing LLM secret should return an unconfigured result");

        assert!(!missing.configured);
        assert!(missing.secret_value.is_none());
    }

    #[test]
    fn rejects_invalid_secret_names() {
        let error = get_autocut_llm_secret(AutoCutLlmSecretRequest {
            secret_name: "../default".to_string(),
        })
        .expect_err("invalid secret names must be rejected");

        assert!(error.contains("ASCII letters"));
    }

    #[test]
    fn rejects_blank_secret_values() {
        let error = save_autocut_llm_secret(AutoCutSaveLlmSecretRequest {
            secret_name: "blank_value".to_string(),
            secret_value: "  ".to_string(),
        })
        .expect_err("blank secret values must be rejected");

        assert!(error.contains("required"));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "writes to the real Windows Credential Manager; run through scripts/write-autocut-native-release-smoke.mjs --run-real-llm-secret-smoke"]
    fn real_windows_keyring_store_saves_reads_and_deletes_llm_secret() {
        if std::env::var("SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE").as_deref() != Ok("true") {
            panic!("set SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE=true to run the real Windows LLM secret store smoke");
        }

        let previous_store = keyring_core::unset_default_store();
        let real_store = windows_native_keyring_store::Store::new()
            .expect("real Windows keyring store should initialize for release smoke");
        keyring_core::set_default_store(real_store);

        let secret_name = format!(
            "real_smoke_{}",
            std::process::id()
        );
        let secret_value = format!("sk-autocut-real-smoke-{}", std::process::id());
        let cleanup_request = AutoCutLlmSecretRequest {
            secret_name: secret_name.clone(),
        };

        let smoke_result = (|| -> Result<(), String> {
            let _ = delete_autocut_llm_secret(cleanup_request.clone());

            let saved = save_autocut_llm_secret(AutoCutSaveLlmSecretRequest {
                secret_name: secret_name.clone(),
                secret_value: secret_value.clone(),
            })?;

            assert_eq!(saved.secret_name, secret_name);
            assert!(saved.saved);

            let loaded = get_autocut_llm_secret(cleanup_request.clone())?;

            assert!(loaded.configured);
            assert_eq!(loaded.secret_value.as_deref(), Some(secret_value.as_str()));

            let deleted = delete_autocut_llm_secret(cleanup_request.clone())?;

            assert!(deleted.deleted);

            let missing = get_autocut_llm_secret(cleanup_request.clone())?;

            assert!(!missing.configured);
            assert!(missing.secret_value.is_none());
            Ok(())
        })();

        let cleanup_result = delete_autocut_llm_secret(cleanup_request);
        match previous_store {
            Some(store) => keyring_core::set_default_store(store),
            None => {
                keyring_core::unset_default_store();
            }
        }

        smoke_result.expect("real Windows LLM secret store lifecycle should pass");
        cleanup_result.expect("real Windows LLM secret smoke cleanup should complete");
        println!("autocut-real-llm-secret-store-smoke=passed");
    }
}
