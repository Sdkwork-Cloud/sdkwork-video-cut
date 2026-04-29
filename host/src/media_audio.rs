use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::{Value, json};

pub(crate) const AUDIO_EXTRACT_SCHEMA_ID: &str = "video-cut.audio-extract.schema.v1";
pub(crate) const SILENCE_RANGES_SCHEMA_ID: &str = "video-cut.silence-ranges.schema.v1";

const AUDIO_SAMPLE_RATE: u32 = 16_000;
const AUDIO_CHANNELS: u8 = 1;
const SILENCE_NOISE_DB: i16 = -35;
const SILENCE_MIN_DURATION_SECONDS: f64 = 0.3;

pub(crate) struct AudioExtractResult {
    pub(crate) document: Value,
    pub(crate) audio_available: bool,
    pub(crate) audio_size_bytes: u64,
}

pub(crate) struct AudioExtractRequest<'a> {
    pub(crate) settings: &'a Value,
    pub(crate) source_file_path: &'a Path,
    pub(crate) audio_file_path: &'a Path,
    pub(crate) task_id: &'a str,
    pub(crate) source_artifact_id: &'a str,
    pub(crate) source_artifact_path: &'a str,
    pub(crate) audio_artifact_id: &'a str,
    pub(crate) audio_artifact_path: &'a str,
}

pub(crate) fn extract_audio_document(request: AudioExtractRequest<'_>) -> AudioExtractResult {
    if !request.source_file_path.is_file() {
        return AudioExtractResult {
            document: audio_extract_status_document(
                &request,
                "source-unavailable",
                0,
                vec![format!(
                    "Source file is not available at {}.",
                    request.source_file_path.display()
                )],
            ),
            audio_available: false,
            audio_size_bytes: 0,
        };
    }

    if let Some(parent) = request.audio_file_path.parent()
        && let Err(error) = fs::create_dir_all(parent)
    {
        return AudioExtractResult {
            document: audio_extract_status_document(
                &request,
                "failed",
                0,
                vec![format!("Audio output directory creation failed: {error}")],
            ),
            audio_available: false,
            audio_size_bytes: 0,
        };
    }

    let ffmpeg_path = request
        .settings
        .pointer("/mediaTools/ffmpegPath")
        .and_then(Value::as_str)
        .unwrap_or("ffmpeg");
    let output = Command::new(ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(request.source_file_path)
        .arg("-vn")
        .arg("-ac")
        .arg(AUDIO_CHANNELS.to_string())
        .arg("-ar")
        .arg(AUDIO_SAMPLE_RATE.to_string())
        .arg("-acodec")
        .arg("pcm_s16le")
        .arg(request.audio_file_path)
        .output();

    match output {
        Ok(output) if output.status.success() && request.audio_file_path.is_file() => {
            let audio_size_bytes = fs::metadata(request.audio_file_path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
            AudioExtractResult {
                document: audio_extract_status_document(&request, "ok", audio_size_bytes, vec![]),
                audio_available: true,
                audio_size_bytes,
            }
        }
        Ok(output) => {
            let _ = fs::remove_file(request.audio_file_path);
            AudioExtractResult {
                document: audio_extract_status_document(
                    &request,
                    "failed",
                    0,
                    vec![command_failure_warning("ffmpeg audio extraction", &output)],
                ),
                audio_available: false,
                audio_size_bytes: 0,
            }
        }
        Err(error) => AudioExtractResult {
            document: audio_extract_status_document(
                &request,
                "failed",
                0,
                vec![format!("ffmpeg audio extraction execution failed: {error}")],
            ),
            audio_available: false,
            audio_size_bytes: 0,
        },
    }
}

pub(crate) fn detect_silence_ranges_document(
    settings: &Value,
    audio_file_path: &Path,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    audio_available: bool,
) -> Value {
    if !audio_available || !audio_file_path.is_file() {
        return silence_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "audio-unavailable",
            vec![format!(
                "Audio file is not available at {}.",
                audio_file_path.display()
            )],
            vec![],
        );
    }

    let ffmpeg_path = settings
        .pointer("/mediaTools/ffmpegPath")
        .and_then(Value::as_str)
        .unwrap_or("ffmpeg");
    let output = Command::new(ffmpeg_path)
        .arg("-hide_banner")
        .arg("-nostats")
        .arg("-i")
        .arg(audio_file_path)
        .arg("-af")
        .arg(format!(
            "silencedetect=noise={}dB:d={}",
            SILENCE_NOISE_DB, SILENCE_MIN_DURATION_SECONDS
        ))
        .arg("-f")
        .arg("null")
        .arg("-")
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            silence_status_document(
                task_id,
                audio_artifact_id,
                audio_artifact_path,
                "ok",
                vec![],
                parse_silence_ranges(&stderr),
            )
        }
        Ok(output) => silence_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "failed",
            vec![command_failure_warning("ffmpeg silencedetect", &output)],
            vec![],
        ),
        Err(error) => silence_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "failed",
            vec![format!("ffmpeg silencedetect execution failed: {error}")],
            vec![],
        ),
    }
}

fn audio_extract_status_document(
    request: &AudioExtractRequest<'_>,
    extract_status: &str,
    size_bytes: u64,
    warnings: Vec<String>,
) -> Value {
    json!({
        "schemaId": AUDIO_EXTRACT_SCHEMA_ID,
        "audioExtractVersion": 1,
        "taskId": request.task_id,
        "sourceArtifactId": request.source_artifact_id,
        "sourcePath": request.source_artifact_path,
        "audioArtifactId": request.audio_artifact_id,
        "audioPath": request.audio_artifact_path,
        "providerId": "ffmpeg-audio-extract",
        "adapterVersion": "ffmpeg-audio-extract.adapter.v1",
        "extractStatus": extract_status,
        "audio": {
            "format": "wav",
            "codec": "pcm_s16le",
            "sampleRate": AUDIO_SAMPLE_RATE,
            "channels": AUDIO_CHANNELS,
            "sizeBytes": size_bytes
        },
        "warnings": warnings,
        "createdAt": crate::contracts::fixed_time()
    })
}

fn silence_status_document(
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    detection_status: &str,
    warnings: Vec<String>,
    ranges: Vec<Value>,
) -> Value {
    json!({
        "schemaId": SILENCE_RANGES_SCHEMA_ID,
        "silenceRangesVersion": 1,
        "taskId": task_id,
        "audioArtifactId": audio_artifact_id,
        "audioPath": audio_artifact_path,
        "providerId": "ffmpeg-silencedetect",
        "adapterVersion": "ffmpeg-silencedetect.adapter.v1",
        "detectionStatus": detection_status,
        "parameters": {
            "noiseDb": SILENCE_NOISE_DB,
            "minDurationSeconds": SILENCE_MIN_DURATION_SECONDS
        },
        "ranges": ranges,
        "warnings": warnings,
        "createdAt": crate::contracts::fixed_time()
    })
}

fn command_failure_warning(label: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return format!("{label} exited with status {}.", output.status);
    }

    stderr
}

fn parse_silence_ranges(stderr: &str) -> Vec<Value> {
    let mut ranges = Vec::new();
    let mut current_start_seconds = None;

    for line in stderr.lines() {
        if let Some(start_seconds) = number_after(line, "silence_start:") {
            current_start_seconds = Some(start_seconds);
            continue;
        }

        let Some(end_seconds) = number_after(line, "silence_end:") else {
            continue;
        };
        let duration_seconds = number_after(line, "silence_duration:");
        let start_seconds = current_start_seconds
            .or_else(|| duration_seconds.map(|duration| end_seconds - duration))
            .unwrap_or(end_seconds);
        current_start_seconds = None;

        ranges.push(json!({
            "startMs": seconds_to_ms(start_seconds.max(0.0)),
            "endMs": seconds_to_ms(end_seconds.max(start_seconds)),
            "durationMs": seconds_to_ms(duration_seconds.unwrap_or(end_seconds - start_seconds).max(0.0))
        }));
    }

    ranges
}

fn number_after(line: &str, marker: &str) -> Option<f64> {
    let index = line.find(marker)?;
    let tail = line[index + marker.len()..].trim_start();
    let raw_number = tail
        .split(|character: char| character.is_whitespace() || character == '|')
        .find(|part| !part.is_empty())?;
    raw_number.parse::<f64>().ok()
}

fn seconds_to_ms(seconds: f64) -> u64 {
    (seconds * 1000.0).round() as u64
}

#[cfg(test)]
mod tests {
    use super::parse_silence_ranges;

    #[test]
    fn parses_ffmpeg_silencedetect_output_into_millisecond_ranges() {
        let stderr = r#"
[silencedetect @ 000001] silence_start: 1.234
[silencedetect @ 000001] silence_end: 2.5 | silence_duration: 1.266
[silencedetect @ 000001] silence_start: 10
[silencedetect @ 000001] silence_end: 12.25 | silence_duration: 2.25
"#;

        let ranges = parse_silence_ranges(stderr);

        assert_eq!(ranges[0]["startMs"], 1234);
        assert_eq!(ranges[0]["endMs"], 2500);
        assert_eq!(ranges[0]["durationMs"], 1266);
        assert_eq!(ranges[1]["startMs"], 10000);
        assert_eq!(ranges[1]["endMs"], 12250);
        assert_eq!(ranges[1]["durationMs"], 2250);
    }
}
