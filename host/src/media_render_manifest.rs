use std::fs;
use std::path::Path;

use serde_json::{Value, json};

use crate::contracts::fixed_time;
use crate::media_assets::{AudioAssetSlot, AudioAssetStatus, RenderAudioAssetSelection};
use crate::media_render::{
    AUDIO_FILTER_PRESET, BGM_VOLUME_PERCENT, VOICE_ENHANCEMENT_FILTERS, output_spec_from_plan,
    render_range_from_plan, sha256_file,
};

pub(crate) struct RenderAttemptManifestRequest<'a> {
    pub(crate) plan: &'a Value,
    pub(crate) task_id: &'a str,
    pub(crate) render_id: &'a str,
    pub(crate) source_artifact_id: &'a str,
    pub(crate) transcript_artifact_id: Option<&'a str>,
    pub(crate) output_artifact_id: &'a str,
    pub(crate) subtitle_artifact_id: &'a str,
    pub(crate) cover_artifact_id: &'a str,
    pub(crate) log_artifact_id: &'a str,
    pub(crate) manifest_file_path: &'a Path,
    pub(crate) subtitle_burn_in: bool,
    pub(crate) subtitle_cue_count: usize,
    pub(crate) audio_assets: &'a RenderAudioAssetSelection,
}

pub(crate) struct RenderAttemptManifestResult {
    pub(crate) manifest_size_bytes: u64,
    pub(crate) manifest_sha256: String,
}

pub(crate) fn write_render_attempt_manifest(
    request: RenderAttemptManifestRequest<'_>,
) -> Result<RenderAttemptManifestResult, String> {
    if let Some(parent) = request.manifest_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let render_range = render_range_from_plan(request.plan)?;
    let output_spec = output_spec_from_plan(request.plan);
    let document = json!({
        "schemaId": "video-cut.render-attempt.schema.v1",
        "renderAttemptVersion": 1,
        "taskId": request.task_id,
        "renderId": request.render_id,
        "planId": string_at(request.plan, "/planId"),
        "planRevision": integer_at(request.plan, "/planRevision").unwrap_or(1),
        "sourceArtifactId": request.source_artifact_id,
        "transcriptArtifactId": request.transcript_artifact_id,
        "outputArtifactId": request.output_artifact_id,
        "subtitleArtifactId": request.subtitle_artifact_id,
        "coverArtifactId": request.cover_artifact_id,
        "logArtifactId": request.log_artifact_id,
        "subtitleBurnIn": request.subtitle_burn_in,
        "subtitleCueCount": request.subtitle_cue_count,
        "sourceRange": {
            "startMs": render_range.start_ms,
            "endMs": render_range.end_ms
        },
        "outputSpec": {
            "aspectRatio": "9:16",
            "width": output_spec.width,
            "height": output_spec.height,
            "frameRate": output_spec.frame_rate,
            "format": "mp4"
        },
        "renderGraph": {
            "engine": "ffmpeg",
            "adapterVersion": "ffmpeg-media-render.adapter.v1",
            "videoFilterPreset": if request.subtitle_burn_in {
                "standard-vertical-scale-crop-fps-ass-burn-in.v1"
            } else {
                "standard-vertical-scale-crop-fps.v1"
            },
            "audioFilterPreset": AUDIO_FILTER_PRESET,
            "voiceEnhancement": {
                "status": "applied",
                "filters": VOICE_ENHANCEMENT_FILTERS
            },
            "bgm": bgm_manifest(&request.audio_assets.bgm),
            "sfx": sfx_manifest(&request.audio_assets.sfx),
            "codec": {
                "video": "libx264",
                "audio": "aac"
            }
        },
        "warnings": request.audio_assets.warnings(),
        "createdAt": fixed_time()
    });
    let bytes = serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?;
    fs::write(request.manifest_file_path, bytes).map_err(|error| error.to_string())?;

    Ok(RenderAttemptManifestResult {
        manifest_size_bytes: fs::metadata(request.manifest_file_path)
            .map_err(|error| error.to_string())?
            .len(),
        manifest_sha256: sha256_file(request.manifest_file_path)?,
    })
}

fn bgm_manifest(slot: &AudioAssetSlot) -> Value {
    let mut value = json!({
        "status": slot.status.as_str(),
        "mixed": slot.status == AudioAssetStatus::Mixed,
        "volumePercent": BGM_VOLUME_PERCENT
    });
    add_asset_manifest(&mut value, slot);
    value
}

fn sfx_manifest(slot: &AudioAssetSlot) -> Value {
    let mut value = json!({
        "status": slot.status.as_str(),
        "mixed": slot.status == AudioAssetStatus::Mixed
    });
    add_asset_manifest(&mut value, slot);
    value
}

fn add_asset_manifest(value: &mut Value, slot: &AudioAssetSlot) {
    let Some(asset) = slot.asset.as_ref() else {
        return;
    };
    value["asset"] = json!({
        "assetId": asset.asset_id,
        "path": asset.manifest_path,
        "sha256": asset.sha256,
        "license": asset.license,
        "source": asset.source,
        "version": asset.version
    });
}

fn string_at(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
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
