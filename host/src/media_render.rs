use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::media_assets::RenderAudioAssetSelection;

pub(crate) const AUDIO_FILTER_PRESET: &str = "voice-basic-loudnorm-afftdn.v1";
pub(crate) const AUDIO_FILTER_CHAIN: &str = "loudnorm=I=-16:TP=-1.5:LRA=11,afftdn";
pub(crate) const VOICE_ENHANCEMENT_FILTERS: [&str; 2] = ["loudnorm", "afftdn"];
pub(crate) const BGM_VOLUME_PERCENT: u64 = 20;
pub(crate) const SFX_VOLUME_PERCENT: u64 = 100;

pub(crate) struct RenderVideoRequest<'a> {
    pub(crate) settings: &'a Value,
    pub(crate) plan: &'a Value,
    pub(crate) task_id: &'a str,
    pub(crate) render_id: &'a str,
    pub(crate) source_file_path: &'a Path,
    pub(crate) output_file_path: &'a Path,
    pub(crate) subtitle_file_path: Option<&'a Path>,
    pub(crate) log_file_path: &'a Path,
    pub(crate) source_artifact_id: &'a str,
    pub(crate) source_artifact_path: &'a str,
    pub(crate) output_artifact_path: &'a str,
    pub(crate) subtitle_artifact_path: Option<&'a str>,
    pub(crate) audio_assets: &'a RenderAudioAssetSelection,
}

pub(crate) struct RenderVideoResult {
    pub(crate) output_size_bytes: u64,
    pub(crate) output_sha256: String,
    pub(crate) log_size_bytes: u64,
    pub(crate) log_sha256: String,
}

#[derive(Clone, Copy)]
pub(crate) struct RenderRange {
    pub(crate) start_ms: u64,
    pub(crate) end_ms: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct OutputSpec {
    pub(crate) width: u64,
    pub(crate) height: u64,
    pub(crate) frame_rate: f64,
}

pub(crate) fn render_video_cut(
    request: RenderVideoRequest<'_>,
) -> Result<RenderVideoResult, String> {
    if !request.source_file_path.is_file() {
        let message = format!(
            "Source file is not available for render: {}.",
            request.source_artifact_path
        );
        write_render_log(&request, None, &message)?;
        return Err(message);
    }

    if let Some(parent) = request.output_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Some(parent) = request.log_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Some(subtitle_file_path) = request.subtitle_file_path
        && !subtitle_file_path.is_file()
    {
        let message = "Subtitle file is not available for render burn-in.".to_string();
        write_render_log(&request, None, &message)?;
        return Err(message);
    }

    let render_range = render_range_from_plan(request.plan)?;
    let output_spec = output_spec_from_plan(request.plan);
    let source_input_path = absolute_path(request.source_file_path)?;
    let output_target_path = absolute_path(request.output_file_path)?;
    let ffmpeg_path = request
        .settings
        .pointer("/mediaTools/ffmpegPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("ffmpeg");
    let mut video_filter = format!(
        "scale={}:{}:force_original_aspect_ratio=increase,crop={}:{},fps={},setsar=1",
        output_spec.width,
        output_spec.height,
        output_spec.width,
        output_spec.height,
        format_frame_rate(output_spec.frame_rate)
    );
    if let Some(subtitle_file_path) = request.subtitle_file_path {
        video_filter.push_str(&format!(
            ",subtitles=filename='{}':charenc=UTF-8",
            escape_filter_path(subtitle_file_path)?
        ));
    }
    let start_seconds = seconds_from_ms(render_range.start_ms);
    let duration_seconds = seconds_from_ms(render_range.end_ms - render_range.start_ms);
    let mut command = Command::new(ffmpeg_path);
    command
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y")
        .arg("-i")
        .arg(&source_input_path);

    if let Some(bgm_asset) = request.audio_assets.bgm.asset.as_ref() {
        command
            .arg("-stream_loop")
            .arg("-1")
            .arg("-i")
            .arg(&bgm_asset.file_path);
    }
    if let Some(sfx_asset) = request.audio_assets.sfx.asset.as_ref() {
        command.arg("-i").arg(&sfx_asset.file_path);
    }

    command
        .arg("-ss")
        .arg(&start_seconds)
        .arg("-t")
        .arg(&duration_seconds);

    if request.audio_assets.has_mixed_assets() {
        command
            .arg("-filter_complex")
            .arg(standard_mix_filter(
                &video_filter,
                &duration_seconds,
                request.audio_assets,
            ))
            .arg("-map")
            .arg("[v]")
            .arg("-map")
            .arg("[a]");
    } else {
        command
            .arg("-map")
            .arg("0:v:0")
            .arg("-map")
            .arg("0:a?")
            .arg("-vf")
            .arg(&video_filter)
            .arg("-af")
            .arg(AUDIO_FILTER_CHAIN);
    }

    let output = command
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-movflags")
        .arg("+faststart")
        .arg(&output_target_path)
        .output();

    match output {
        Ok(output) if output.status.success() && request.output_file_path.is_file() => {
            write_render_log(&request, Some(&output), "ok")?;
            let output_size_bytes = fs::metadata(request.output_file_path)
                .map_err(|error| error.to_string())?
                .len();
            if output_size_bytes == 0 {
                return Err("ffmpeg render produced an empty output file.".to_string());
            }
            let log_size_bytes = fs::metadata(request.log_file_path)
                .map_err(|error| error.to_string())?
                .len();
            Ok(RenderVideoResult {
                output_size_bytes,
                output_sha256: sha256_file(request.output_file_path)?,
                log_size_bytes,
                log_sha256: sha256_file(request.log_file_path)?,
            })
        }
        Ok(output) => {
            let message = command_failure_message("ffmpeg render", &output);
            write_render_log(&request, Some(&output), &message)?;
            let _ = fs::remove_file(request.output_file_path);
            Err(message)
        }
        Err(error) => {
            let message = format!("ffmpeg render execution failed: {error}");
            write_render_log(&request, None, &message)?;
            Err(message)
        }
    }
}

pub(crate) fn render_range_from_plan(plan: &Value) -> Result<RenderRange, String> {
    let start_ms = integer_at(plan, "/segments/0/sourceRange/startMs").unwrap_or_default();
    let end_ms = integer_at(plan, "/segments/0/sourceRange/endMs")
        .ok_or_else(|| "Render plan must contain segments[0].sourceRange.endMs.".to_string())?;
    if end_ms <= start_ms {
        return Err(format!(
            "Render source range must be positive, got startMs={start_ms}, endMs={end_ms}."
        ));
    }

    Ok(RenderRange { start_ms, end_ms })
}

pub(crate) fn output_spec_from_plan(plan: &Value) -> OutputSpec {
    OutputSpec {
        width: integer_at(plan, "/outputSpec/width")
            .filter(|value| *value > 0)
            .unwrap_or(1080),
        height: integer_at(plan, "/outputSpec/height")
            .filter(|value| *value > 0)
            .unwrap_or(1920),
        frame_rate: number_at(plan, "/outputSpec/frameRate")
            .filter(|value| *value > 0.0)
            .unwrap_or(30.0),
    }
}

fn write_render_log(
    request: &RenderVideoRequest<'_>,
    output: Option<&Output>,
    status_message: &str,
) -> Result<(), String> {
    let range = render_range_from_plan(request.plan).unwrap_or(RenderRange {
        start_ms: 0,
        end_ms: 0,
    });
    let spec = output_spec_from_plan(request.plan);
    let mut content = String::new();
    content.push_str("schemaId=video-cut.render-log.schema.v1\n");
    content.push_str(&format!("taskId={}\n", request.task_id));
    content.push_str(&format!("renderId={}\n", request.render_id));
    content.push_str(&format!(
        "sourceArtifactId={}\n",
        request.source_artifact_id
    ));
    content.push_str(&format!("source={}\n", request.source_artifact_path));
    content.push_str(&format!("output={}\n", request.output_artifact_path));
    if let Some(subtitle_artifact_path) = request.subtitle_artifact_path {
        content.push_str(&format!("subtitle={subtitle_artifact_path}\n"));
    }
    content.push_str(&format!(
        "subtitleBurnIn={}\n",
        request.subtitle_file_path.is_some()
    ));
    content.push_str(&format!("startMs={}\n", range.start_ms));
    content.push_str(&format!("endMs={}\n", range.end_ms));
    content.push_str(&format!("width={}\n", spec.width));
    content.push_str(&format!("height={}\n", spec.height));
    content.push_str(&format!(
        "frameRate={}\n",
        format_frame_rate(spec.frame_rate)
    ));
    content.push_str(&format!("audioFilterPreset={AUDIO_FILTER_PRESET}\n"));
    content.push_str(&format!(
        "bgmStatus={}\n",
        request.audio_assets.bgm.status.as_str()
    ));
    if let Some(asset) = request.audio_assets.bgm.asset.as_ref() {
        content.push_str(&format!("bgmAsset={}\n", asset.manifest_path));
        content.push_str(&format!("bgmAssetId={}\n", asset.asset_id));
    }
    content.push_str(&format!(
        "sfxStatus={}\n",
        request.audio_assets.sfx.status.as_str()
    ));
    if let Some(asset) = request.audio_assets.sfx.asset.as_ref() {
        content.push_str(&format!("sfxAsset={}\n", asset.manifest_path));
        content.push_str(&format!("sfxAssetId={}\n", asset.asset_id));
    }
    if request.audio_assets.has_mixed_assets() {
        content.push_str("command=ffmpeg -hide_banner -nostdin -loglevel warning -y -i <source> <standard-audio-asset-inputs> -ss <start> -t <duration> -filter_complex <standard-video-audio-mix-filter> -map [v] -map [a] -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart <output>\n");
    } else if request.subtitle_file_path.is_some() {
        content.push_str("command=ffmpeg -hide_banner -nostdin -loglevel warning -y -i <source> -ss <start> -t <duration> -map 0:v:0 -map 0:a? -vf <standard-vertical-filter>,subtitles=<subtitle-ass> -af <standard-voice-enhancement-filter> -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart <output>\n");
    } else {
        content.push_str("command=ffmpeg -hide_banner -nostdin -loglevel warning -y -i <source> -ss <start> -t <duration> -map 0:v:0 -map 0:a? -vf <standard-vertical-filter> -af <standard-voice-enhancement-filter> -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart <output>\n");
    }
    content.push_str(&format!("status={status_message}\n"));

    if let Some(output) = output {
        content.push_str(&format!("exitSuccess={}\n", output.status.success()));
        let stdout = redact_process_output(
            &String::from_utf8_lossy(&output.stdout),
            request.source_file_path,
            request.output_file_path,
            request.subtitle_file_path,
            request.audio_assets,
        );
        let stderr = redact_process_output(
            &String::from_utf8_lossy(&output.stderr),
            request.source_file_path,
            request.output_file_path,
            request.subtitle_file_path,
            request.audio_assets,
        );
        if !stdout.trim().is_empty() {
            content.push_str("stdout:\n");
            content.push_str(stdout.trim());
            content.push('\n');
        }
        if !stderr.trim().is_empty() {
            content.push_str("stderr:\n");
            content.push_str(stderr.trim());
            content.push('\n');
        }
    }

    fs::write(request.log_file_path, content).map_err(|error| error.to_string())
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

fn redact_process_output(
    raw: &str,
    source_path: &Path,
    output_path: &Path,
    subtitle_path: Option<&Path>,
    audio_assets: &RenderAudioAssetSelection,
) -> String {
    let redacted = redact_path(raw, source_path, "<source>");
    let redacted = redact_path(&redacted, output_path, "<output>");
    let mut redacted = if let Some(subtitle_path) = subtitle_path {
        redact_path(&redacted, subtitle_path, "<subtitle>")
    } else {
        redacted
    };

    for asset in audio_assets.mixed_assets() {
        redacted = redact_path(&redacted, &asset.file_path, &asset.manifest_path);
    }

    redacted
}

fn standard_mix_filter(
    video_filter: &str,
    duration_seconds: &str,
    audio_assets: &RenderAudioAssetSelection,
) -> String {
    let mut parts = vec![
        format!("[0:v:0]{video_filter}[v]"),
        format!("[0:a:0]{AUDIO_FILTER_CHAIN}[voice]"),
    ];
    let mut input_index = 1;
    let mut audio_labels = vec!["[voice]".to_string()];

    if audio_assets.bgm.asset.is_some() {
        parts.push(format!(
            "[{input_index}:a:0]volume=0.{BGM_VOLUME_PERCENT:02},atrim=duration={duration_seconds},asetpts=PTS-STARTPTS[bgm]"
        ));
        audio_labels.push("[bgm]".to_string());
        input_index += 1;
    }

    if audio_assets.sfx.asset.is_some() {
        parts.push(format!(
            "[{input_index}:a:0]volume={:.2},atrim=duration={duration_seconds},asetpts=PTS-STARTPTS[sfx]",
            SFX_VOLUME_PERCENT as f64 / 100.0
        ));
        audio_labels.push("[sfx]".to_string());
    }

    parts.push(format!(
        "{}amix=inputs={}:duration=first:dropout_transition=0[a]",
        audio_labels.join(""),
        audio_labels.len()
    ));

    parts.join(";")
}

fn redact_path(raw: &str, path: &Path, placeholder: &str) -> String {
    let redacted = raw.replace(&path.display().to_string(), placeholder);
    if let Ok(absolute_path) = absolute_path(path) {
        return redacted.replace(&absolute_path.display().to_string(), placeholder);
    }

    redacted
}

fn absolute_path(path: &Path) -> Result<std::path::PathBuf, String> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }

    std::env::current_dir()
        .map(|current_dir| current_dir.join(path))
        .map_err(|error| error.to_string())
}

fn escape_filter_path(path: &Path) -> Result<String, String> {
    let absolute = absolute_path(path)?;
    let normalized = absolute.display().to_string().replace('\\', "/");
    Ok(normalized
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace(',', "\\,"))
}

fn integer_at(value: &Value, pointer: &str) -> Option<u64> {
    value.pointer(pointer).and_then(|item| {
        item.as_u64()
            .or_else(|| {
                item.as_i64()
                    .and_then(|raw| (raw >= 0).then_some(raw as u64))
            })
            .or_else(|| item.as_str().and_then(|raw| raw.parse::<u64>().ok()))
    })
}

fn number_at(value: &Value, pointer: &str) -> Option<f64> {
    value.pointer(pointer).and_then(|item| {
        item.as_f64()
            .or_else(|| item.as_str().and_then(|raw| raw.parse::<f64>().ok()))
    })
}

pub(crate) fn seconds_from_ms(value: u64) -> String {
    format!("{:.3}", value as f64 / 1000.0)
}

pub(crate) fn format_frame_rate(value: f64) -> String {
    if value.fract() == 0.0 {
        return format!("{}", value as u64);
    }

    format!("{value:.3}")
}

pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
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
