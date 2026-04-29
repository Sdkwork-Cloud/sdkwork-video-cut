use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

use crate::media_render::{
    output_spec_from_plan, render_range_from_plan, seconds_from_ms, sha256_file,
};

pub(crate) struct RenderCoverRequest<'a> {
    pub(crate) settings: &'a Value,
    pub(crate) plan: &'a Value,
    pub(crate) source_file_path: &'a Path,
    pub(crate) cover_file_path: &'a Path,
}

pub(crate) struct RenderCoverResult {
    pub(crate) cover_size_bytes: u64,
    pub(crate) cover_sha256: String,
}

pub(crate) fn render_cover_png(
    request: RenderCoverRequest<'_>,
) -> Result<RenderCoverResult, String> {
    if !request.source_file_path.is_file() {
        return Err("Source file is not available for cover rendering.".to_string());
    }
    if let Some(parent) = request.cover_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let range = render_range_from_plan(request.plan)?;
    let midpoint_ms = range.start_ms + (range.end_ms - range.start_ms) / 2;
    let output_spec = output_spec_from_plan(request.plan);
    let ffmpeg_path = request
        .settings
        .pointer("/mediaTools/ffmpegPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("ffmpeg");
    let video_filter = format!(
        "scale={}:{}:force_original_aspect_ratio=increase,crop={}:{},setsar=1",
        output_spec.width, output_spec.height, output_spec.width, output_spec.height
    );
    let output = Command::new(ffmpeg_path)
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y")
        .arg("-ss")
        .arg(seconds_from_ms(midpoint_ms))
        .arg("-i")
        .arg(request.source_file_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-map")
        .arg("0:v:0")
        .arg("-vf")
        .arg(video_filter)
        .arg("-f")
        .arg("image2")
        .arg(request.cover_file_path)
        .output();

    match output {
        Ok(output) if output.status.success() && request.cover_file_path.is_file() => {
            let cover_size_bytes = fs::metadata(request.cover_file_path)
                .map_err(|error| error.to_string())?
                .len();
            if cover_size_bytes == 0 {
                return Err("ffmpeg cover render produced an empty file.".to_string());
            }
            Ok(RenderCoverResult {
                cover_size_bytes,
                cover_sha256: sha256_file(request.cover_file_path)?,
            })
        }
        Ok(output) => {
            let _ = fs::remove_file(request.cover_file_path);
            Err(command_failure_message("ffmpeg cover render", &output))
        }
        Err(error) => Err(format!("ffmpeg cover render execution failed: {error}")),
    }
}

fn command_failure_message(command_name: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let summary = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("no stderr");
    format!(
        "{command_name} failed with status {}: {summary}",
        output.status
    )
}
