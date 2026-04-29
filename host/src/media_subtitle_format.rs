use serde_json::{Value, json};

use crate::models::SubtitleImportInput;

pub(crate) fn subtitle_import_transcript_document(
    settings: &Value,
    input: &SubtitleImportInput,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
) -> Result<Value, String> {
    let format = normalize_subtitle_format(&input.format)?;
    let cues = parse_subtitle_cues(&format, &input.content)?;
    let language = input
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let configured = string_at(settings, "/speechToText/languageHint");
            if configured.trim().is_empty() {
                "zh".to_string()
            } else {
                configured
            }
        });
    let text = cues
        .iter()
        .map(|cue| cue.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let duration_seconds = cues
        .iter()
        .map(|cue| cue.end_ms)
        .max()
        .map(|end_ms| end_ms as f64 / 1000.0)
        .unwrap_or_default();
    let segments = cues
        .iter()
        .enumerate()
        .map(|(index, cue)| {
            json!({
                "segmentId": format!("{task_id}-subtitle-import-segment-{}", index + 1),
                "startMs": cue.start_ms,
                "endMs": cue.end_ms,
                "text": cue.text
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "schemaId": crate::media_transcript::TRANSCRIPT_SCHEMA_ID,
        "transcriptVersion": 1,
        "taskId": task_id,
        "audioArtifactId": audio_artifact_id,
        "audioPath": audio_artifact_path,
        "providerId": format!("subtitle-import-{format}"),
        "adapterVersion": format!("subtitle-{format}-import.adapter.v1"),
        "transcriptStatus": "ok",
        "language": language,
        "timestampGranularity": ["segment"],
        "durationSeconds": duration_seconds,
        "text": text,
        "segments": segments,
        "warnings": [],
        "createdAt": crate::contracts::fixed_time()
    }))
}

pub(crate) fn export_transcript_document(
    transcript_document: &Value,
    format: &str,
) -> Result<String, String> {
    let format = normalize_subtitle_format(format)?;
    if transcript_document
        .get("transcriptStatus")
        .and_then(Value::as_str)
        != Some("ok")
    {
        return Err("Transcript must be available before subtitle export.".to_string());
    }
    let segments = transcript_document
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "Transcript segments must be available before subtitle export.".to_string()
        })?;

    let mut cues = Vec::new();
    for segment in segments {
        let start_ms = segment
            .get("startMs")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Transcript segment startMs is required.".to_string())?;
        let end_ms = segment
            .get("endMs")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Transcript segment endMs is required.".to_string())?;
        let text = segment
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if text.is_empty() || end_ms <= start_ms {
            continue;
        }
        cues.push(SubtitleCue {
            start_ms,
            end_ms,
            text,
        });
    }

    validate_cues(&cues)?;
    match format.as_str() {
        "srt" => Ok(format_srt(&cues)),
        "vtt" => Ok(format_vtt(&cues)),
        _ => unreachable!("subtitle format already normalized"),
    }
}

pub(crate) fn normalize_subtitle_format(format: &str) -> Result<String, String> {
    match format.trim().to_ascii_lowercase().as_str() {
        "srt" => Ok("srt".to_string()),
        "vtt" | "webvtt" => Ok("vtt".to_string()),
        _ => Err("Subtitle format must be srt or vtt.".to_string()),
    }
}

#[derive(Clone, Debug)]
struct SubtitleCue {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

fn parse_subtitle_cues(format: &str, content: &str) -> Result<Vec<SubtitleCue>, String> {
    if content.trim().is_empty() {
        return Err("Subtitle content is empty.".to_string());
    }

    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let blocks = subtitle_blocks(&normalized);
    let mut cues = Vec::new();
    for block in blocks {
        let Some(cue) = parse_subtitle_block(format, &block)? else {
            continue;
        };
        cues.push(cue);
    }

    validate_cues(&cues)?;
    Ok(cues)
}

fn subtitle_blocks(content: &str) -> Vec<Vec<String>> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(current);
                current = Vec::new();
            }
            continue;
        }
        current.push(line.trim().to_string());
    }
    if !current.is_empty() {
        blocks.push(current);
    }

    blocks
}

fn parse_subtitle_block(format: &str, lines: &[String]) -> Result<Option<SubtitleCue>, String> {
    if lines.is_empty() {
        return Ok(None);
    }
    if format == "vtt" {
        let header = lines[0].trim_start_matches('\u{feff}');
        if header.eq_ignore_ascii_case("webvtt")
            || header.to_ascii_lowercase().starts_with("webvtt ")
            || header.eq_ignore_ascii_case("note")
        {
            return Ok(None);
        }
    }

    let time_line_index = lines
        .iter()
        .position(|line| line.contains("-->"))
        .ok_or_else(|| "Subtitle cue is missing a time range.".to_string())?;
    let text = lines
        .iter()
        .skip(time_line_index + 1)
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return Err("Subtitle cue text is empty.".to_string());
    }
    let (start_ms, end_ms) = parse_time_range(&lines[time_line_index])?;
    Ok(Some(SubtitleCue {
        start_ms,
        end_ms,
        text,
    }))
}

fn parse_time_range(line: &str) -> Result<(u64, u64), String> {
    let mut parts = line.split("-->");
    let start = parts
        .next()
        .ok_or_else(|| "Subtitle cue start timestamp is missing.".to_string())?;
    let end = parts
        .next()
        .ok_or_else(|| "Subtitle cue end timestamp is missing.".to_string())?;
    let start_ms = parse_timestamp_ms(start.trim())?;
    let end_token = end.split_whitespace().next().unwrap_or_default();
    let end_ms = parse_timestamp_ms(end_token)?;
    if end_ms <= start_ms {
        return Err("Subtitle cue end timestamp must be greater than start.".to_string());
    }

    Ok((start_ms, end_ms))
}

fn parse_timestamp_ms(raw: &str) -> Result<u64, String> {
    let normalized = raw.trim().replace(',', ".");
    let parts = normalized.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds_part) = match parts.as_slice() {
        [minutes, seconds] => (0, parse_u64(minutes)?, *seconds),
        [hours, minutes, seconds] => (parse_u64(hours)?, parse_u64(minutes)?, *seconds),
        _ => return Err(format!("Subtitle timestamp is invalid: {raw}.")),
    };
    let mut second_parts = seconds_part.split('.');
    let seconds = parse_u64(second_parts.next().unwrap_or_default())?;
    let millis_raw = second_parts.next().unwrap_or("0");
    let millis = parse_millis(millis_raw)?;

    Ok((((hours * 60 + minutes) * 60 + seconds) * 1000) + millis)
}

fn parse_u64(value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| format!("Subtitle timestamp number is invalid: {value}."))
}

fn parse_millis(value: &str) -> Result<u64, String> {
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_digit()) {
        return Err(format!(
            "Subtitle timestamp milliseconds are invalid: {value}."
        ));
    }
    let mut normalized = value.to_string();
    while normalized.len() < 3 {
        normalized.push('0');
    }
    normalized
        .chars()
        .take(3)
        .collect::<String>()
        .parse::<u64>()
        .map_err(|_| format!("Subtitle timestamp milliseconds are invalid: {value}."))
}

fn validate_cues(cues: &[SubtitleCue]) -> Result<(), String> {
    if cues.is_empty() {
        return Err("Subtitle document must contain at least one cue.".to_string());
    }
    if cues.len() > 1000 {
        return Err("Subtitle document cannot contain more than 1000 cues.".to_string());
    }

    let mut previous_end_ms = 0;
    for (index, cue) in cues.iter().enumerate() {
        if cue.end_ms <= cue.start_ms {
            return Err(format!(
                "Subtitle cue {} endMs must be greater than startMs.",
                index + 1
            ));
        }
        if index > 0 && cue.start_ms < previous_end_ms {
            return Err(format!(
                "Subtitle cue {} overlaps the previous cue.",
                index + 1
            ));
        }
        previous_end_ms = cue.end_ms;
    }

    Ok(())
}

fn format_srt(cues: &[SubtitleCue]) -> String {
    cues.iter()
        .enumerate()
        .map(|(index, cue)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                index + 1,
                format_timestamp(cue.start_ms, ','),
                format_timestamp(cue.end_ms, ','),
                cue.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_vtt(cues: &[SubtitleCue]) -> String {
    let body = cues
        .iter()
        .map(|cue| {
            format!(
                "{} --> {}\n{}\n",
                format_timestamp(cue.start_ms, '.'),
                format_timestamp(cue.end_ms, '.'),
                cue.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("WEBVTT\n\n{body}")
}

fn format_timestamp(value_ms: u64, separator: char) -> String {
    let millis = value_ms % 1000;
    let total_seconds = value_ms / 1000;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}")
}

fn string_at(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}
