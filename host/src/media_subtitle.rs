use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::media_render::{render_range_from_plan, sha256_file};

pub(crate) struct RenderSubtitleRequest<'a> {
    pub(crate) settings: &'a Value,
    pub(crate) plan: &'a Value,
    pub(crate) transcript_document: Option<&'a Value>,
    pub(crate) task_id: &'a str,
    pub(crate) render_id: &'a str,
    pub(crate) subtitle_file_path: &'a Path,
}

pub(crate) struct RenderSubtitleResult {
    pub(crate) subtitle_size_bytes: u64,
    pub(crate) subtitle_sha256: String,
    pub(crate) cue_count: usize,
}

struct SubtitleCue {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

pub(crate) fn render_subtitle_ass(
    request: RenderSubtitleRequest<'_>,
) -> Result<RenderSubtitleResult, String> {
    if let Some(parent) = request.subtitle_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let range = render_range_from_plan(request.plan)?;
    let cues = subtitle_cues(request.transcript_document, range.start_ms, range.end_ms);
    let mut warnings = transcript_warnings(request.transcript_document);
    if cues.is_empty() {
        warnings.push("No transcript segments are available for this render range.".to_string());
    }

    let content = ass_document(
        request.settings,
        request.plan,
        request.task_id,
        request.render_id,
        &warnings,
        &cues,
    );
    fs::write(request.subtitle_file_path, content).map_err(|error| error.to_string())?;
    let subtitle_size_bytes = fs::metadata(request.subtitle_file_path)
        .map_err(|error| error.to_string())?
        .len();

    Ok(RenderSubtitleResult {
        subtitle_size_bytes,
        subtitle_sha256: sha256_file(request.subtitle_file_path)?,
        cue_count: cues.len(),
    })
}

fn ass_document(
    settings: &Value,
    plan: &Value,
    task_id: &str,
    render_id: &str,
    warnings: &[String],
    cues: &[SubtitleCue],
) -> String {
    let font_family = string_at(settings, "/subtitle/fontFamily")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            string_at(settings, "/subtitle/fontFallback")
                .unwrap_or_else(|| "Noto Serif SC".to_string())
        });
    let font_size = integer_at(settings, "/subtitle/fontSize").unwrap_or(64);
    let width = integer_at(plan, "/outputSpec/width").unwrap_or(1080);
    let height = integer_at(plan, "/outputSpec/height").unwrap_or(1920);
    let (alignment, margin_v) = subtitle_position(settings);
    let highlight_color = ass_color(
        string_at(settings, "/subtitle/highlightColor")
            .as_deref()
            .unwrap_or("#ffd84d"),
    );

    let mut content = String::new();
    content.push_str("[Script Info]\n");
    content.push_str("; schemaId=video-cut.subtitle-ass.schema.v1\n");
    content.push_str(&format!("; taskId={task_id}\n"));
    content.push_str(&format!("; renderId={render_id}\n"));
    content.push_str("ScriptType: v4.00+\n");
    content.push_str("WrapStyle: 2\n");
    content.push_str("ScaledBorderAndShadow: yes\n");
    content.push_str("YCbCr Matrix: TV.709\n");
    content.push_str(&format!("PlayResX: {width}\n"));
    content.push_str(&format!("PlayResY: {height}\n\n"));

    content.push_str("[V4+ Styles]\n");
    content.push_str("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
    content.push_str(&format!(
        "Style: Default,{},{font_size},&H00FFFFFF,{highlight_color},&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,4,2,{alignment},80,80,{margin_v},1\n\n",
        escape_ass_style_value(&font_family)
    ));

    content.push_str("[Events]\n");
    content.push_str(
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );
    for warning in warnings {
        content.push_str(&format!("; warning: {}\n", escape_ass_comment(warning)));
    }
    for cue in cues {
        content.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            format_ass_timestamp(cue.start_ms),
            format_ass_timestamp(cue.end_ms),
            escape_ass_text(&cue.text)
        ));
    }

    content
}

fn subtitle_cues(
    transcript_document: Option<&Value>,
    render_start_ms: u64,
    render_end_ms: u64,
) -> Vec<SubtitleCue> {
    let Some(document) = transcript_document else {
        return Vec::new();
    };
    if document
        .get("transcriptStatus")
        .and_then(Value::as_str)
        .is_some_and(|status| status != "ok")
    {
        return Vec::new();
    }

    document
        .get("segments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|segment| {
            let start_ms = segment.get("startMs").and_then(Value::as_u64)?;
            let end_ms = segment.get("endMs").and_then(Value::as_u64)?;
            let text = segment.get("text").and_then(Value::as_str)?.trim();
            if text.is_empty() || end_ms <= render_start_ms || start_ms >= render_end_ms {
                return None;
            }

            let output_start_ms = start_ms.max(render_start_ms) - render_start_ms;
            let output_end_ms = end_ms.min(render_end_ms) - render_start_ms;
            (output_end_ms > output_start_ms).then(|| SubtitleCue {
                start_ms: output_start_ms,
                end_ms: output_end_ms,
                text: text.to_string(),
            })
        })
        .collect()
}

fn transcript_warnings(transcript_document: Option<&Value>) -> Vec<String> {
    let Some(document) = transcript_document else {
        return vec!["Transcript artifact is not available.".to_string()];
    };

    let mut warnings = document
        .get("warnings")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if let Some(status) = document.get("transcriptStatus").and_then(Value::as_str)
        && status != "ok"
    {
        warnings.insert(0, format!("Transcript status is {status}."));
    }

    warnings
}

fn subtitle_position(settings: &Value) -> (u8, u64) {
    match string_at(settings, "/subtitle/position").as_deref() {
        Some("top") => (8, 120),
        Some("middle") => (5, 80),
        _ => (2, 180),
    }
}

fn format_ass_timestamp(value_ms: u64) -> String {
    let total_cs = value_ms / 10;
    let centiseconds = total_cs % 100;
    let total_seconds = total_cs / 100;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;
    format!("{hours}:{minutes:02}:{seconds:02}.{centiseconds:02}")
}

fn ass_color(value: &str) -> String {
    let trimmed = value.trim().trim_start_matches('#');
    if trimmed.len() != 6
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return "&H004DD8FF".to_string();
    }

    let red = &trimmed[0..2];
    let green = &trimmed[2..4];
    let blue = &trimmed[4..6];
    format!("&H00{blue}{green}{red}")
}

fn escape_ass_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('{', "(")
        .replace('}', ")")
        .replace('\r', " ")
        .replace('\n', "\\N")
}

fn escape_ass_comment(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

fn escape_ass_style_value(value: &str) -> String {
    value.replace(',', " ")
}

fn string_at(value: &Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn integer_at(value: &Value, pointer: &str) -> Option<u64> {
    value.pointer(pointer).and_then(|item| {
        item.as_u64()
            .or_else(|| {
                item.as_i64()
                    .and_then(|raw| (raw > 0).then_some(raw as u64))
            })
            .or_else(|| item.as_str().and_then(|raw| raw.parse::<u64>().ok()))
    })
}
