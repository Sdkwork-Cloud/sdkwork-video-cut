use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::contracts::fixed_time;

const ASSET_PACK_MANIFEST_FILE: &str = "asset-manifest.json";
const ASSET_PACK_SCHEMA_ID: &str = "video-cut.asset-pack-manifest.v1";
const FALLBACK_LICENSE: &str = "unverified-user-provided";
const FALLBACK_SOURCE: &str = "configured-asset-directory";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum AudioAssetStatus {
    Mixed,
    NotConfigured,
    Unavailable,
    Disabled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RenderAudioAsset {
    pub(crate) asset_id: String,
    pub(crate) file_path: PathBuf,
    pub(crate) manifest_path: String,
    pub(crate) sha256: String,
    pub(crate) license: String,
    pub(crate) source: String,
    pub(crate) version: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AudioAssetSlot {
    pub(crate) status: AudioAssetStatus,
    pub(crate) asset: Option<RenderAudioAsset>,
    pub(crate) warning: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RenderAudioAssetSelection {
    pub(crate) bgm: AudioAssetSlot,
    pub(crate) sfx: AudioAssetSlot,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AudioAssetMetadata {
    license: String,
    source: String,
    version: String,
}

pub(crate) fn select_render_audio_assets_for_plan(
    settings: &Value,
    plan: Option<&Value>,
) -> RenderAudioAssetSelection {
    RenderAudioAssetSelection {
        bgm: select_asset_slot(settings, plan, "/assets/bgm", "assets/bgm", "bgm"),
        sfx: select_asset_slot(settings, plan, "/assets/sfx", "assets/sfx", "sfx"),
    }
}

pub(crate) fn asset_catalog_document(settings: &Value) -> Value {
    json!({
        "schemaId": "video-cut.asset-catalog.schema.v1",
        "assetCatalogVersion": 1,
        "generatedAt": fixed_time(),
        "slots": [
            asset_catalog_slot(settings, "/assets/fonts", "assets/fonts", "fonts", &["otf", "ttc", "ttf", "woff", "woff2"]),
            asset_catalog_slot(settings, "/assets/bgm", "assets/bgm", "bgm", &["aac", "flac", "m4a", "mp3", "ogg", "wav"]),
            asset_catalog_slot(settings, "/assets/sfx", "assets/sfx", "sfx", &["aac", "flac", "m4a", "mp3", "ogg", "wav"]),
            asset_catalog_slot(settings, "/assets/coverTemplates", "assets/covers", "coverTemplates", &["jpeg", "jpg", "json", "png", "webp"]),
        ],
    })
}

impl AudioAssetStatus {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            AudioAssetStatus::Mixed => "mixed",
            AudioAssetStatus::NotConfigured => "not-configured",
            AudioAssetStatus::Unavailable => "unavailable",
            AudioAssetStatus::Disabled => "disabled",
        }
    }
}

impl AudioAssetSlot {
    fn not_configured() -> Self {
        Self {
            status: AudioAssetStatus::NotConfigured,
            asset: None,
            warning: None,
        }
    }

    fn unavailable(message: String) -> Self {
        Self {
            status: AudioAssetStatus::Unavailable,
            asset: None,
            warning: Some(message),
        }
    }

    fn disabled() -> Self {
        Self {
            status: AudioAssetStatus::Disabled,
            asset: None,
            warning: None,
        }
    }

    fn mixed(asset: RenderAudioAsset, warning: Option<String>) -> Self {
        Self {
            status: AudioAssetStatus::Mixed,
            asset: Some(asset),
            warning,
        }
    }
}

impl RenderAudioAssetSelection {
    pub(crate) fn has_mixed_assets(&self) -> bool {
        self.bgm.asset.is_some() || self.sfx.asset.is_some()
    }

    pub(crate) fn mixed_assets(&self) -> Vec<&RenderAudioAsset> {
        [&self.bgm, &self.sfx]
            .into_iter()
            .filter_map(|slot| slot.asset.as_ref())
            .collect()
    }

    pub(crate) fn warnings(&self) -> Vec<String> {
        [&self.bgm, &self.sfx]
            .into_iter()
            .filter_map(|slot| slot.warning.clone())
            .collect()
    }
}

fn select_asset_slot(
    settings: &Value,
    plan: Option<&Value>,
    pointer: &str,
    fallback_dir: &str,
    kind: &'static str,
) -> AudioAssetSlot {
    let preference = render_asset_preference(plan, kind);
    if preference.mode == RenderAssetPreferenceMode::Disabled {
        return AudioAssetSlot::disabled();
    }

    let configured_dir = settings
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_dir);
    let dir_path = PathBuf::from(configured_dir);
    if !dir_path.is_dir() {
        return AudioAssetSlot::not_configured();
    }

    let entries = match fs::read_dir(&dir_path) {
        Ok(entries) => entries,
        Err(error) => {
            return AudioAssetSlot::unavailable(format!(
                "{kind} asset directory is not readable: {error}"
            ));
        }
    };

    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_supported_audio_asset(path))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| file_name(path));

    let Some(file_path) = select_candidate_for_preference(candidates, &preference) else {
        return AudioAssetSlot::not_configured();
    };
    let sha256 = match sha256_file(&file_path) {
        Ok(value) => value,
        Err(error) => {
            return AudioAssetSlot::unavailable(format!("{kind} asset is not readable: {error}"));
        }
    };
    let file_name = file_name(&file_path);
    let asset_id = format!("{kind}-{}", &sha256[..16]);
    if preference.mode == RenderAssetPreferenceMode::Asset
        && let Some(expected_asset_id) = preference.asset_id.as_ref()
        && expected_asset_id != &asset_id
    {
        return AudioAssetSlot::unavailable(format!(
            "{kind} selected asset id does not match the configured asset catalog entry."
        ));
    }
    let (metadata, warning) = asset_metadata_for(&dir_path, &file_name, kind, &sha256);

    AudioAssetSlot::mixed(
        RenderAudioAsset {
            asset_id,
            file_path,
            manifest_path: format!("assets://{kind}/{file_name}"),
            sha256,
            license: metadata.license,
            source: metadata.source,
            version: metadata.version,
        },
        warning,
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RenderAssetPreferenceMode {
    Auto,
    Asset,
    Disabled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RenderAssetPreference {
    mode: RenderAssetPreferenceMode,
    asset_id: Option<String>,
    file_name: Option<String>,
}

fn render_asset_preference(plan: Option<&Value>, kind: &'static str) -> RenderAssetPreference {
    let Some(slot) = plan
        .and_then(|plan| plan.pointer(&format!("/renderPreferences/audio/{kind}")))
        .and_then(Value::as_object)
    else {
        return RenderAssetPreference::auto();
    };
    let mode = slot
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .trim();
    match mode {
        "disabled" => RenderAssetPreference::disabled(),
        "asset" => {
            let path = slot.get("path").and_then(Value::as_str).unwrap_or_default();
            let prefix = format!("assets://{kind}/");
            let file_name = path
                .strip_prefix(&prefix)
                .filter(|value| is_safe_asset_file_name(value))
                .map(ToString::to_string);
            let asset_id = slot
                .get("assetId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            RenderAssetPreference {
                mode: RenderAssetPreferenceMode::Asset,
                asset_id,
                file_name,
            }
        }
        _ => RenderAssetPreference::auto(),
    }
}

impl RenderAssetPreference {
    fn auto() -> Self {
        Self {
            mode: RenderAssetPreferenceMode::Auto,
            asset_id: None,
            file_name: None,
        }
    }

    fn disabled() -> Self {
        Self {
            mode: RenderAssetPreferenceMode::Disabled,
            asset_id: None,
            file_name: None,
        }
    }
}

fn select_candidate_for_preference(
    candidates: Vec<PathBuf>,
    preference: &RenderAssetPreference,
) -> Option<PathBuf> {
    if preference.mode != RenderAssetPreferenceMode::Asset {
        return candidates.into_iter().next();
    }

    let Some(selected_file_name) = preference.file_name.as_ref() else {
        return None;
    };

    candidates
        .into_iter()
        .find(|path| file_name(path) == *selected_file_name)
}

fn asset_catalog_slot(
    settings: &Value,
    pointer: &str,
    fallback_dir: &str,
    kind: &'static str,
    supported_extensions: &[&str],
) -> Value {
    let configured_dir = configured_asset_dir(settings, pointer, fallback_dir);
    let dir_path = PathBuf::from(&configured_dir);
    let supported_extensions = supported_extensions
        .iter()
        .map(|extension| extension.to_string())
        .collect::<Vec<_>>();
    let base_slot = |status: &str, entries: Vec<Value>, warnings: Vec<String>| {
        json!({
            "kind": kind,
            "status": status,
            "configuredPath": safe_configured_path(&configured_dir),
            "manifestPath": format!("assets://{kind}/{ASSET_PACK_MANIFEST_FILE}"),
            "supportedExtensions": supported_extensions,
            "entries": entries,
            "warnings": warnings,
        })
    };

    if !dir_path.is_dir() {
        return base_slot("not-configured", Vec::new(), Vec::new());
    }

    let entries = match fs::read_dir(&dir_path) {
        Ok(entries) => entries,
        Err(error) => {
            return base_slot(
                "unavailable",
                Vec::new(),
                vec![format!("{kind} asset directory is not readable: {error}")],
            );
        }
    };

    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && has_supported_extension(path, &supported_extensions))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| file_name(path));

    if candidates.is_empty() {
        return base_slot("not-configured", Vec::new(), Vec::new());
    }

    let mut catalog_entries = Vec::new();
    let mut warnings = Vec::new();
    for file_path in candidates {
        let file_name = file_name(&file_path);
        let sha256 = match sha256_file(&file_path) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(format!("{kind} asset {file_name} is not readable: {error}"));
                continue;
            }
        };
        let size_bytes = fs::metadata(&file_path)
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        let asset_id = format!("{kind}-{}", &sha256[..16]);
        let (metadata, warning) = asset_metadata_for(&dir_path, &file_name, kind, &sha256);
        if let Some(warning) = warning {
            warnings.push(warning);
        }
        catalog_entries.push(json!({
            "assetId": asset_id,
            "path": format!("assets://{kind}/{file_name}"),
            "fileName": file_name,
            "sizeBytes": size_bytes,
            "sha256": sha256,
            "license": metadata.license,
            "source": metadata.source,
            "version": metadata.version,
        }));
    }

    if catalog_entries.is_empty() {
        return base_slot("unavailable", Vec::new(), warnings);
    }

    base_slot("available", catalog_entries, warnings)
}

fn configured_asset_dir(settings: &Value, pointer: &str, fallback_dir: &str) -> String {
    settings
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_dir)
        .to_string()
}

fn safe_configured_path(configured_dir: &str) -> String {
    let path = PathBuf::from(configured_dir);
    if path.is_absolute() {
        "<server-local-path>".to_string()
    } else {
        configured_dir.replace('\\', "/")
    }
}

fn has_supported_extension(path: &Path, supported_extensions: &[String]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|extension| supported_extensions.contains(&extension))
}

fn is_safe_asset_file_name(value: &str) -> bool {
    !value.trim().is_empty()
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && !value.contains("..")
}

fn is_supported_audio_asset(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("aac" | "flac" | "m4a" | "mp3" | "ogg" | "wav")
    )
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("asset")
        .to_string()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn asset_metadata_for(
    dir_path: &Path,
    file_name: &str,
    kind: &'static str,
    sha256: &str,
) -> (AudioAssetMetadata, Option<String>) {
    let manifest_path = dir_path.join(ASSET_PACK_MANIFEST_FILE);
    if !manifest_path.is_file() {
        return fallback_metadata(
            kind,
            sha256,
            format!("{ASSET_PACK_MANIFEST_FILE} is missing"),
        );
    }

    let manifest_text = match fs::read_to_string(&manifest_path) {
        Ok(value) => value,
        Err(error) => {
            return fallback_metadata(
                kind,
                sha256,
                format!("{ASSET_PACK_MANIFEST_FILE} is not readable: {error}"),
            );
        }
    };
    let manifest: Value = match serde_json::from_str(&manifest_text) {
        Ok(value) => value,
        Err(error) => {
            return fallback_metadata(
                kind,
                sha256,
                format!("{ASSET_PACK_MANIFEST_FILE} is not valid JSON: {error}"),
            );
        }
    };

    if manifest.get("schemaId").and_then(Value::as_str) != Some(ASSET_PACK_SCHEMA_ID) {
        return fallback_metadata(
            kind,
            sha256,
            format!("{ASSET_PACK_MANIFEST_FILE} schemaId is not {ASSET_PACK_SCHEMA_ID}"),
        );
    }

    let Some(assets) = manifest.get("assets").and_then(Value::as_array) else {
        return fallback_metadata(
            kind,
            sha256,
            format!("{ASSET_PACK_MANIFEST_FILE} has no assets array"),
        );
    };
    let Some(entry) = assets
        .iter()
        .find(|entry| entry.get("path").and_then(Value::as_str) == Some(file_name))
    else {
        return fallback_metadata(
            kind,
            sha256,
            format!("{ASSET_PACK_MANIFEST_FILE} has no entry for {file_name}"),
        );
    };

    let license = metadata_string(entry, "license");
    let source = metadata_string(entry, "source");
    let version = metadata_string(entry, "version");
    match (license, source, version) {
        (Some(license), Some(source), Some(version)) => (
            AudioAssetMetadata {
                license,
                source,
                version,
            },
            None,
        ),
        _ => fallback_metadata(
            kind,
            sha256,
            format!(
                "{ASSET_PACK_MANIFEST_FILE} entry for {file_name} is missing safe license metadata"
            ),
        ),
    }
}

fn metadata_string(entry: &Value, key: &str) -> Option<String> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && is_safe_metadata_value(value))
        .map(ToString::to_string)
}

fn is_safe_metadata_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let bytes = value.as_bytes();

    !value.contains('\\')
        && !value.contains('\0')
        && !value.contains("..")
        && !value.starts_with('/')
        && !lower.starts_with("file:")
        && !(bytes.len() >= 3
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\')
            && bytes[0].is_ascii_alphabetic())
}

fn fallback_metadata(
    kind: &'static str,
    sha256: &str,
    reason: String,
) -> (AudioAssetMetadata, Option<String>) {
    (
        AudioAssetMetadata {
            license: FALLBACK_LICENSE.to_string(),
            source: FALLBACK_SOURCE.to_string(),
            version: format!("sha256-{}", &sha256[..16]),
        },
        Some(format!(
            "{kind} asset license metadata warning: {reason}; provenance marked {FALLBACK_LICENSE}"
        )),
    )
}
