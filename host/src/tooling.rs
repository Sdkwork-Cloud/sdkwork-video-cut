use std::env;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

pub(crate) fn media_tool_capability(settings: &Value) -> Value {
    let ffmpeg_path = settings
        .pointer("/mediaTools/ffmpegPath")
        .and_then(Value::as_str)
        .unwrap_or("ffmpeg");
    let ffprobe_path = settings
        .pointer("/mediaTools/ffprobePath")
        .and_then(Value::as_str)
        .unwrap_or("ffprobe");
    let checks = [
        ("ffmpeg", ffmpeg_path, is_executable_available(ffmpeg_path)),
        (
            "ffprobe",
            ffprobe_path,
            is_executable_available(ffprobe_path),
        ),
    ];
    let missing_tools = checks
        .iter()
        .filter_map(|(name, _, available)| (!available).then_some(*name))
        .collect::<Vec<_>>();

    if missing_tools.is_empty() {
        return json!({
            "status": "ok",
            "label": "FFmpeg and ffprobe are available",
            "checkedTools": {
                "ffmpeg": ffmpeg_path,
                "ffprobe": ffprobe_path
            },
            "missingTools": []
        });
    }

    json!({
        "status": "warn",
        "label": "FFmpeg or ffprobe is not available",
        "actionHint": "Open Settings > Media Tools and configure valid ffmpeg/ffprobe paths.",
        "checkedTools": {
            "ffmpeg": ffmpeg_path,
            "ffprobe": ffprobe_path
        },
        "missingTools": missing_tools
    })
}

fn is_executable_available(command: &str) -> bool {
    let direct = Path::new(command);
    if has_path_separator(command) || direct.is_absolute() {
        return executable_candidates(direct.to_path_buf(), &path_extensions())
            .iter()
            .any(|candidate| candidate.is_file());
    }

    resolve_executable(command, &path_entries(), &path_extensions()).is_some()
}

pub(crate) fn resolve_executable(
    command: &str,
    path_entries: &[PathBuf],
    path_exts: &[String],
) -> Option<PathBuf> {
    path_entries.iter().find_map(|entry| {
        executable_candidates(entry.join(command), path_exts)
            .into_iter()
            .find(|candidate| candidate.is_file())
    })
}

fn executable_candidates(base: PathBuf, path_exts: &[String]) -> Vec<PathBuf> {
    if base.extension().is_some() {
        return vec![base];
    }

    let mut candidates = vec![base.clone()];
    candidates.extend(
        path_exts
            .iter()
            .filter(|extension| !extension.is_empty())
            .map(|extension| base.with_extension(extension.trim_start_matches('.'))),
    );
    candidates
}

fn path_entries() -> Vec<PathBuf> {
    env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default()
}

fn path_extensions() -> Vec<String> {
    env::var("PATHEXT")
        .map(|value| {
            value
                .split(';')
                .filter(|extension| !extension.is_empty())
                .map(|extension| extension.to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_else(|_| vec![".exe".to_string(), ".cmd".to_string(), ".bat".to_string()])
}

fn has_path_separator(command: &str) -> bool {
    command.contains('/') || command.contains('\\')
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{media_tool_capability, resolve_executable};
    use serde_json::json;

    fn temp_tool_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("sdkwork-video-cut-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("temp dir");
        path
    }

    #[test]
    fn resolves_windows_style_executable_from_path_entries() {
        let dir = temp_tool_dir("resolve-ffmpeg");
        let executable = dir.join("ffmpeg.exe");
        fs::write(&executable, b"fake").expect("fake executable");

        let resolved =
            resolve_executable("ffmpeg", std::slice::from_ref(&dir), &[".exe".to_string()]);

        assert_eq!(resolved, Some(executable));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reports_warn_when_required_media_tools_are_missing() {
        let settings = json!({
            "mediaTools": {
                "ffmpegPath": "__missing_ffmpeg__",
                "ffprobePath": "__missing_ffprobe__"
            }
        });

        let report = media_tool_capability(&settings);

        assert_eq!(report["status"], "warn");
        assert_eq!(report["missingTools"], json!(["ffmpeg", "ffprobe"]));
        assert!(
            report["actionHint"]
                .as_str()
                .unwrap()
                .contains("Settings > Media Tools")
        );
    }
}
