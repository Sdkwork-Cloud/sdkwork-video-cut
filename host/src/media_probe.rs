use std::path::Path;
use std::process::Command;

use serde_json::{Value, json};

pub(crate) const MEDIA_INFO_SCHEMA_ID: &str = "video-cut.media-info.schema.v1";

pub(crate) fn probe_media_info_document(
    settings: &Value,
    source_file_path: &Path,
    task_id: &str,
    source_artifact_id: &str,
    source_artifact_path: &str,
) -> Value {
    if !source_file_path.is_file() {
        return media_info_status_document(
            task_id,
            source_artifact_id,
            source_artifact_path,
            "source-unavailable",
            vec![format!(
                "Source file is not available at {}.",
                source_file_path.display()
            )],
        );
    }

    let ffprobe_path = settings
        .pointer("/mediaTools/ffprobePath")
        .and_then(Value::as_str)
        .unwrap_or("ffprobe");
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_format")
        .arg("-show_streams")
        .arg(source_file_path)
        .output();

    match output {
        Ok(output) if output.status.success() => {
            match serde_json::from_slice::<Value>(&output.stdout) {
                Ok(ffprobe) => media_info_document_from_ffprobe(
                    task_id,
                    source_artifact_id,
                    source_artifact_path,
                    &ffprobe,
                ),
                Err(error) => media_info_status_document(
                    task_id,
                    source_artifact_id,
                    source_artifact_path,
                    "failed",
                    vec![format!("ffprobe returned invalid JSON: {error}")],
                ),
            }
        }
        Ok(output) => media_info_status_document(
            task_id,
            source_artifact_id,
            source_artifact_path,
            "failed",
            vec![String::from_utf8_lossy(&output.stderr).trim().to_string()],
        ),
        Err(error) => media_info_status_document(
            task_id,
            source_artifact_id,
            source_artifact_path,
            "failed",
            vec![format!("ffprobe execution failed: {error}")],
        ),
    }
}

pub(crate) fn media_info_document_from_ffprobe(
    task_id: &str,
    source_artifact_id: &str,
    source_path: &str,
    ffprobe: &Value,
) -> Value {
    let streams = ffprobe
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let video_streams = streams
        .iter()
        .filter(|stream| stream["codec_type"].as_str() == Some("video"))
        .map(video_stream_from_ffprobe)
        .collect::<Vec<_>>();
    let audio_streams = streams
        .iter()
        .filter(|stream| stream["codec_type"].as_str() == Some("audio"))
        .map(audio_stream_from_ffprobe)
        .collect::<Vec<_>>();
    let format = ffprobe.get("format").unwrap_or(&Value::Null);

    json!({
        "schemaId": MEDIA_INFO_SCHEMA_ID,
        "mediaInfoVersion": 1,
        "taskId": task_id,
        "sourceArtifactId": source_artifact_id,
        "sourcePath": source_path,
        "providerId": "ffprobe-media-probe",
        "adapterVersion": "ffprobe-media-probe.adapter.v1",
        "probeStatus": "ok",
        "format": {
            "formatName": string_at(format, "format_name"),
            "durationSeconds": number_at(format, "duration"),
            "bitRate": integer_at(format, "bit_rate")
        },
        "videoStreams": video_streams,
        "audioStreams": audio_streams,
        "warnings": [],
        "createdAt": crate::contracts::fixed_time()
    })
}

fn video_stream_from_ffprobe(stream: &Value) -> Value {
    json!({
        "index": integer_at(stream, "index"),
        "codec": string_at(stream, "codec_name"),
        "width": integer_at(stream, "width"),
        "height": integer_at(stream, "height"),
        "frameRate": frame_rate_at(stream),
    })
}

fn audio_stream_from_ffprobe(stream: &Value) -> Value {
    json!({
        "index": integer_at(stream, "index"),
        "codec": string_at(stream, "codec_name"),
        "sampleRate": integer_at(stream, "sample_rate"),
        "channels": integer_at(stream, "channels"),
    })
}

fn string_at(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn integer_at(value: &Value, field: &str) -> u64 {
    value
        .get(field)
        .and_then(|item| {
            item.as_u64()
                .or_else(|| item.as_str().and_then(|raw| raw.parse::<u64>().ok()))
        })
        .unwrap_or_default()
}

fn number_at(value: &Value, field: &str) -> f64 {
    value
        .get(field)
        .and_then(|item| {
            item.as_f64()
                .or_else(|| item.as_str().and_then(|raw| raw.parse::<f64>().ok()))
        })
        .unwrap_or_default()
}

fn frame_rate_at(stream: &Value) -> f64 {
    ["avg_frame_rate", "r_frame_rate"]
        .iter()
        .find_map(|field| {
            stream
                .get(*field)
                .and_then(Value::as_str)
                .and_then(parse_ratio)
                .filter(|value| *value > 0.0)
        })
        .unwrap_or_default()
}

fn parse_ratio(raw: &str) -> Option<f64> {
    let (left, right) = raw.split_once('/')?;
    let numerator = left.parse::<f64>().ok()?;
    let denominator = right.parse::<f64>().ok()?;
    if denominator == 0.0 {
        return None;
    }

    Some(numerator / denominator)
}

fn media_info_status_document(
    task_id: &str,
    source_artifact_id: &str,
    source_path: &str,
    probe_status: &str,
    warnings: Vec<String>,
) -> Value {
    json!({
        "schemaId": MEDIA_INFO_SCHEMA_ID,
        "mediaInfoVersion": 1,
        "taskId": task_id,
        "sourceArtifactId": source_artifact_id,
        "sourcePath": source_path,
        "providerId": "ffprobe-media-probe",
        "adapterVersion": "ffprobe-media-probe.adapter.v1",
        "probeStatus": probe_status,
        "format": {
            "formatName": "",
            "durationSeconds": 0.0,
            "bitRate": 0
        },
        "videoStreams": [],
        "audioStreams": [],
        "warnings": warnings,
        "createdAt": crate::contracts::fixed_time()
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::media_info_document_from_ffprobe;

    #[test]
    fn parses_ffprobe_json_into_standard_media_info_document() {
        let ffprobe = json!({
            "format": {
                "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
                "duration": "12.345",
                "bit_rate": "1200000"
            },
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "30000/1001",
                    "avg_frame_rate": "30000/1001"
                },
                {
                    "index": 1,
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "sample_rate": "48000",
                    "channels": 2
                }
            ]
        });

        let document = media_info_document_from_ffprobe(
            "task-001",
            "task-001-source",
            "workspace/projects/default/tasks/task-001/source/input.mp4",
            &ffprobe,
        );

        assert_eq!(document["schemaId"], "video-cut.media-info.schema.v1");
        assert_eq!(document["probeStatus"], "ok");
        assert_eq!(document["taskId"], "task-001");
        assert_eq!(document["sourceArtifactId"], "task-001-source");
        assert_eq!(document["format"]["durationSeconds"], 12.345);
        assert_eq!(document["format"]["bitRate"], 1200000);
        assert_eq!(document["videoStreams"][0]["codec"], "h264");
        assert_eq!(document["videoStreams"][0]["width"], 1920);
        assert_eq!(document["videoStreams"][0]["height"], 1080);
        assert_eq!(document["videoStreams"][0]["frameRate"], 29.97002997002997);
        assert_eq!(document["audioStreams"][0]["codec"], "aac");
        assert_eq!(document["audioStreams"][0]["sampleRate"], 48000);
        assert_eq!(document["audioStreams"][0]["channels"], 2);
    }
}
