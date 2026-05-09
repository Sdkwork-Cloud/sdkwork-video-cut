use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::Url;
use reqwest::blocking::Client;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::database_runtime;

const AUTOCUT_MEDIA_ROOT_DIR: &str = "media";
const AUTOCUT_MEDIA_INPUT_DIR: &str = "inputs";
const AUTOCUT_MEDIA_TASK_DIR: &str = "tasks";
const AUTOCUT_MEDIA_TASK_OUTPUT_DIR: &str = "outputs";
const AUTOCUT_MEDIA_TASK_COVER_DIR: &str = "cover";
const AUTOCUT_MEDIA_MODEL_DIR: &str = "models";
const AUTOCUT_MEDIA_SPEECH_MODEL_DIR: &str = "speech";
const AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_MODEL_FILE_NAME: &str =
    "ggml-large-v3-turbo-q5_0.bin";
pub(crate) const AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS_EVENT: &str =
    "autocut-speech-transcription-model-download-progress";
const AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_JSON: &str =
    include_str!("../binaries/ffmpeg.toolchain.json");
const AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_FILE_NAME: &str = "ffmpeg.toolchain.json";
const AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_JSON: &str =
    include_str!("../binaries/speech-transcription.toolchain.json");
const AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_FILE_NAME: &str =
    "speech-transcription.toolchain.json";
const DEFAULT_FFMPEG_EXECUTABLE: &str = "ffmpeg";
const SUPPORTED_VIDEO_FILE_DIALOG_EXTENSIONS: &[&str] =
    &["mp4", "mov", "mkv", "webm", "avi", "flv", "m4v"];
const SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS: &[&str] =
    &["mp3", "wav", "flac", "aac", "m4a", "ogg"];
pub(crate) const SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS: &[&str] =
    &["bin", "gguf", "onnx", "pt", "safetensors"];
const MAX_SPEECH_TRANSCRIPT_JSON_BYTES: usize = 16 * 1024 * 1024;
const MAX_SPEECH_TRANSCRIPT_SEGMENTS: usize = 20_000;
pub(crate) const MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const TRUSTED_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_HOSTS: &[&str] =
    &["huggingface.co", "hf-mirror.com"];
const SUPPORTED_AUDIO_FORMATS: &[&str] = &["mp3", "wav", "flac", "aac"];
const SUPPORTED_VIDEO_GIF_FPS: &[&str] = &["10", "15", "24"];
const SUPPORTED_VIDEO_GIF_RESOLUTIONS: &[(&str, i64)] =
    &[("320p", 320), ("480p", 480), ("720p", 720)];
const SUPPORTED_VIDEO_COMPRESS_MODES: &[&str] = &["quality", "balanced", "extreme"];
const SUPPORTED_VIDEO_CONVERT_FORMATS: &[&str] = &["mp4", "mkv", "avi", "mov", "flv", "webm"];
const SUPPORTED_VIDEO_CONVERT_VIDEO_CODECS: &[&str] = &["h264", "h265", "vp9", "mpeg4", "copy"];
const SUPPORTED_VIDEO_CONVERT_AUDIO_CODECS: &[&str] = &["aac", "mp3", "opus", "copy"];
const MEDIA_ASSET_TYPE_IMPORTED: i64 = 1;
const MEDIA_ARTIFACT_TYPE_AUDIO: i64 = 1;
const MEDIA_ARTIFACT_TYPE_GIF: i64 = 2;
const MEDIA_ARTIFACT_TYPE_VIDEO_COMPRESSED: i64 = 3;
const MEDIA_ARTIFACT_TYPE_VIDEO_CONVERTED: i64 = 4;
const MEDIA_ARTIFACT_TYPE_VIDEO_ENHANCED: i64 = 5;
const MEDIA_ARTIFACT_TYPE_VIDEO_SLICE: i64 = 6;
const MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL: i64 = 7;
const MEDIA_ARTIFACT_TYPE_TRANSCRIPT: i64 = 8;
const MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_SUBTITLE: i64 = 9;
const OPS_TASK_TYPE_AUDIO_EXTRACTION: i64 = 1;
const OPS_TASK_TYPE_VIDEO_GIF: i64 = 2;
const OPS_TASK_TYPE_VIDEO_COMPRESS: i64 = 3;
const OPS_TASK_TYPE_VIDEO_CONVERT: i64 = 4;
const OPS_TASK_TYPE_VIDEO_ENHANCE: i64 = 5;
const OPS_TASK_TYPE_VIDEO_SLICE: i64 = 6;
const OPS_TASK_TYPE_SPEECH_TRANSCRIPTION: i64 = 7;
const OPS_TASK_EVENT_TYPE_STARTED: i64 = 1;
const OPS_TASK_EVENT_TYPE_COMPLETED: i64 = 2;
const OPS_TASK_EVENT_TYPE_FAILED: i64 = 3;
const OPS_TASK_EVENT_TYPE_CANCEL_REQUESTED: i64 = 4;
const OPS_TASK_EVENT_TYPE_CANCELED: i64 = 5;
const OPS_TASK_EVENT_TYPE_INTERRUPTED: i64 = 6;
const OPS_TASK_EVENT_TYPE_RETRY_REQUESTED: i64 = 7;
const OPS_TASK_EVENT_TYPE_PROGRESS: i64 = 8;
const OPS_STAGE_TYPE_AUDIO_EXTRACTION: i64 = 1;
const OPS_STAGE_TYPE_VIDEO_GIF: i64 = 2;
const OPS_STAGE_TYPE_VIDEO_COMPRESS: i64 = 3;
const OPS_STAGE_TYPE_VIDEO_CONVERT: i64 = 4;
const OPS_STAGE_TYPE_VIDEO_ENHANCE: i64 = 5;
const OPS_STAGE_TYPE_VIDEO_SLICE: i64 = 6;
const OPS_STAGE_TYPE_SPEECH_TRANSCRIPTION: i64 = 7;
const VIDEO_SLICE_BURNED_SUBTITLE_FORCE_STYLE: &str =
    "Alignment=2,MarginV=36,Fontsize=24,Outline=2,Shadow=1";
const OPS_STATUS_PROCESSING: i64 = 1;
const OPS_STATUS_COMPLETED: i64 = 2;
const OPS_STATUS_FAILED: i64 = 3;
const OPS_STATUS_CANCEL_REQUESTED: i64 = 4;
const OPS_STATUS_CANCELED: i64 = 5;
const OPS_STATUS_INTERRUPTED: i64 = 6;
const OPS_WORKER_LEASE_STATUS_ACTIVE: i64 = 1;
const OPS_WORKER_LEASE_STATUS_RELEASED: i64 = 2;
const OPS_WORKER_LEASE_STATUS_EXPIRED: i64 = 3;
const AUTOCUT_LOCAL_TENANT_ID: i64 = 0;
const AUTOCUT_LOCAL_ORGANIZATION_ID: i64 = 0;
const NATIVE_MEDIA_POLL_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);

static AUTOCUT_UUID_COUNTER: AtomicU64 = AtomicU64::new(1);
static AUTOCUT_TRACKED_NATIVE_MEDIA_PROCESSES: OnceLock<
    Mutex<HashMap<String, AutoCutTrackedNativeMediaProcess>>,
> = OnceLock::new();

#[derive(Debug, Clone)]
struct AutoCutTrackedNativeMediaProcess {
    task_uuid: String,
    child: Arc<Mutex<Child>>,
}

#[derive(Debug, Clone)]
enum AutoCutFfmpegPipeEvent {
    Duration(i64),
    ProgressTime(i64),
}

#[derive(Debug, Default)]
struct AutoCutFfmpegProgressStreamState {
    total_duration_ms: Option<i64>,
    last_progress_time_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutFfmpegProbe {
    pub available: bool,
    pub executable: String,
    pub source_kind: String,
    pub manifest_ready: bool,
    pub bundled_ready: bool,
    pub version_line: Option<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutFfmpegToolchain {
    pub executable: String,
    pub source_kind: String,
    pub manifest_ready: bool,
    pub bundled_ready: bool,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoCutFfmpegToolchainManifest {
    tool: String,
    contract_version: String,
    #[serde(rename = "bundledReady")]
    _bundled_ready: bool,
    required_binary: String,
    license: AutoCutFfmpegToolchainLicense,
    platforms: std::collections::HashMap<String, AutoCutFfmpegPlatformToolchain>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoCutFfmpegToolchainLicense {
    name: String,
    spdx_expression: String,
    notice: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoCutFfmpegPlatformToolchain {
    relative_path: String,
    binary_name: String,
    integrity: AutoCutFfmpegPlatformIntegrity,
    #[serde(default)]
    companion_files: Vec<AutoCutToolchainCompanionFile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoCutFfmpegPlatformIntegrity {
    sha256: String,
    byte_size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoCutToolchainCompanionFile {
    relative_path: String,
    integrity: AutoCutFfmpegPlatformIntegrity,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoCutSpeechToolchainManifest {
    tool: String,
    contract_version: String,
    bundled_ready: bool,
    required_binary: String,
    license: AutoCutFfmpegToolchainLicense,
    platforms: std::collections::HashMap<String, AutoCutFfmpegPlatformToolchain>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutMediaImportRequest {
    pub source_path: String,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutMediaImportResult {
    pub asset_uuid: String,
    pub sandbox_path: String,
    pub byte_size: u64,
    pub name: String,
    pub media_type: String,
    pub mime_type: String,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLocalMediaFileDescription {
    pub source_path: String,
    pub byte_size: u64,
    pub name: String,
    pub media_type: String,
    pub mime_type: String,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLocalMediaFileSelectRequest {
    pub media_types: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLocalMediaPreviewDirectoryRequest {
    pub directory_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLocalMediaPreviewDirectoryResult {
    pub directory_path: String,
    pub allowed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeArtifactInFolderRequest {
    pub artifact_path: String,
    pub task_output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeArtifactInFolderResult {
    pub artifact_path: String,
    pub containing_directory_path: String,
    pub opened: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutAudioExtractionRequest {
    pub asset_uuid: String,
    pub output_format: String,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutAudioExtractionResult {
    pub artifact_uuid: String,
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub artifact_path: String,
    pub task_output_dir: String,
    pub byte_size: u64,
    pub format: String,
    pub ffmpeg_executable: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoGifRequest {
    pub asset_uuid: String,
    pub fps: String,
    pub resolution: String,
    pub dither: bool,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoGifResult {
    pub artifact_uuid: String,
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub artifact_path: String,
    pub task_output_dir: String,
    pub byte_size: u64,
    pub format: String,
    pub ffmpeg_executable: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceAudioMuteRange {
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceClipRequest {
    pub start_ms: i64,
    pub duration_ms: i64,
    pub label: String,
    pub output_file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_mute_ranges: Option<Vec<AutoCutVideoSliceAudioMuteRange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_start_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_end_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech_start_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech_end_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_padding_before_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_padding_after_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_segments: Option<Vec<AutoCutSpeechTranscriptionSegment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_segment_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_coverage_score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech_continuity_grade: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceRenderProfile {
    pub target_aspect_ratio: String,
    pub object_fit: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceRequest {
    pub asset_uuid: String,
    pub clips: Vec<AutoCutVideoSliceClipRequest>,
    pub output_format: String,
    pub output_root_dir: Option<String>,
    pub render_profile: Option<AutoCutVideoSliceRenderProfile>,
    #[serde(default)]
    pub noise_reduction: bool,
    pub subtitle_format: Option<String>,
    pub subtitle_mode: Option<String>,
    pub subtitle_style_id: Option<String>,
    pub subtitle_segments: Option<Vec<AutoCutSpeechTranscriptionSegment>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceArtifactResult {
    pub artifact_uuid: String,
    pub artifact_path: String,
    pub thumbnail_artifact_uuid: String,
    pub thumbnail_artifact_path: String,
    pub subtitle_artifact_uuid: Option<String>,
    pub subtitle_artifact_path: Option<String>,
    pub task_output_dir: String,
    pub byte_size: u64,
    pub thumbnail_byte_size: u64,
    pub subtitle_byte_size: Option<u64>,
    pub subtitle_format: Option<String>,
    pub format: String,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_start_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_end_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_start_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_end_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary_padding_before_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary_padding_after_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_segments: Option<Vec<AutoCutSpeechTranscriptionSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_segment_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_coverage_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_continuity_grade: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceResult {
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub task_output_dir: String,
    pub slices: Vec<AutoCutVideoSliceArtifactResult>,
    pub ffmpeg_executable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub speaker: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionRequest {
    pub asset_uuid: String,
    pub provider_id: Option<String>,
    pub language: Option<String>,
    pub output_root_dir: Option<String>,
    pub executable_path: Option<String>,
    pub model_path: Option<String>,
    pub workflow_purpose: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionResult {
    pub artifact_uuid: String,
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub transcript_path: String,
    pub task_output_dir: String,
    pub language: String,
    pub segments: Vec<AutoCutSpeechTranscriptionSegment>,
    pub text: String,
    pub ffmpeg_executable: String,
    pub speech_executable: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionProbeRequest {
    pub provider_id: Option<String>,
    pub executable_path: Option<String>,
    pub model_path: Option<String>,
    pub source_kind: Option<String>,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionProbe {
    pub ready: bool,
    pub executable_ready: bool,
    pub model_ready: bool,
    pub executable_path: String,
    pub model_path: String,
    pub source_kind: String,
    pub diagnostics: Vec<String>,
    pub version_line: Option<String>,
    pub default_executable_directory: String,
    pub default_executable_path: String,
    pub default_model_directory: String,
    pub default_model_path: String,
    pub executable_strategy: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionFileSelectRequest {
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionModelDownloadRequest {
    pub provider_id: String,
    pub preset_id: String,
    pub file_name: String,
    pub url: String,
    pub mirror_urls: Option<Vec<String>>,
    pub sha256: String,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionModelDownloadResult {
    pub provider_id: String,
    pub preset_id: String,
    pub file_name: String,
    pub model_path: String,
    pub byte_size: u64,
    pub downloaded: bool,
    pub source_url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionModelDownloadProgressEvent {
    pub provider_id: String,
    pub preset_id: String,
    pub file_name: String,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<u8>,
    pub model_path: Option<String>,
    pub source_url: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoCompressRequest {
    pub asset_uuid: String,
    pub compression_mode: String,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoCompressResult {
    pub artifact_uuid: String,
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub artifact_path: String,
    pub task_output_dir: String,
    pub byte_size: u64,
    pub original_byte_size: u64,
    pub format: String,
    pub ffmpeg_executable: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoConvertRequest {
    pub asset_uuid: String,
    pub target_format: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub resolution: String,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoConvertResult {
    pub artifact_uuid: String,
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub artifact_path: String,
    pub task_output_dir: String,
    pub byte_size: u64,
    pub format: String,
    pub ffmpeg_executable: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoEnhanceRequest {
    pub asset_uuid: String,
    pub target_resolution: String,
    pub enhance_mode: String,
    pub frame_rate: String,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoEnhanceResult {
    pub artifact_uuid: String,
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub artifact_path: String,
    pub task_output_dir: String,
    pub byte_size: u64,
    pub format: String,
    pub ffmpeg_executable: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskQueryRequest {
    pub limit: Option<u32>,
    pub task_uuid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskCancelRequest {
    pub task_uuid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskCancelResult {
    pub task_uuid: String,
    pub status: i64,
    pub canceled: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskRecoveryRequest {
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskRecoveryResult {
    pub inspected: i64,
    pub recovered: i64,
    pub interrupted: i64,
    pub canceled: i64,
    pub expired_leases: i64,
    pub deferred: i64,
    pub task_uuids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskRetryRequest {
    pub task_uuid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskRetryResult {
    pub task_uuid: String,
    pub retry_task_uuid: String,
    pub status: i64,
    pub retried: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskSnapshot {
    pub uuid: String,
    pub task_type: i64,
    pub status: i64,
    pub progress: i64,
    pub source_asset_uuid: Option<String>,
    pub input_json: String,
    pub output_json: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub stages: Vec<AutoCutNativeStageRunSnapshot>,
    pub events: Vec<AutoCutNativeTaskEventSnapshot>,
    pub worker_leases: Vec<AutoCutNativeWorkerLeaseSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeStageRunSnapshot {
    pub uuid: String,
    pub stage_type: i64,
    pub status: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub diagnostics_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskEventSnapshot {
    pub uuid: String,
    pub event_type: i64,
    pub payload: Value,
    pub payload_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeWorkerLeaseSnapshot {
    pub uuid: String,
    pub worker_id: String,
    pub lease_status: i64,
    pub lease_token: String,
    pub acquired_at: String,
    pub heartbeat_at: String,
    pub expires_at: String,
    pub released_at: Option<String>,
    pub diagnostics_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
struct AutoCutMediaOperationOutput {
    artifact_path: String,
    task_output_dir: String,
    byte_size: u64,
    format: String,
    ffmpeg_executable: String,
}

#[derive(Debug, Clone)]
struct AutoCutVideoSliceOperationOutput {
    clip: AutoCutVideoSliceClipRequest,
    video_output: AutoCutMediaOperationOutput,
    thumbnail_output: AutoCutMediaOperationOutput,
    subtitle_output: Option<AutoCutMediaOperationOutput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AutoCutVideoSliceEncoderCandidate {
    label: String,
    video_codec: String,
    pre_input_args: Vec<String>,
    encoder_args: Vec<String>,
    filter_chain_suffix: Option<String>,
    requires_hardware: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AutoCutVideoSliceEncoderAttemptDiagnostic {
    label: String,
    video_codec: String,
    status: String,
    stderr_tail: String,
}

#[derive(Debug, Clone)]
struct AutoCutSpeechToolchain {
    executable: String,
    model_path: String,
    source_kind: String,
    executable_ready: bool,
    model_ready: bool,
    ready: bool,
    diagnostics: Vec<String>,
    default_executable_directory: String,
    default_executable_path: String,
    default_model_directory: String,
    default_model_path: String,
    executable_strategy: String,
}

#[derive(Debug, Clone)]
struct AutoCutMediaOperationSpec {
    operation: &'static str,
    task_type: i64,
    stage_type: i64,
    artifact_type: i64,
    artifact_name_suffix: String,
    mime_type: &'static str,
    input_json: serde_json::Value,
    failure_error_code: &'static str,
}

#[derive(Debug, Clone)]
struct AutoCutRegisteredMediaAsset {
    uuid: String,
    name: String,
    source_uri: String,
}

#[derive(Debug, Clone)]
struct AutoCutRetrySourceTask {
    uuid: String,
    task_type: i64,
    status: i64,
    source_asset_uuid: Option<String>,
    input_json: String,
}

#[derive(Debug, Clone)]
struct AutoCutOpsWorkerLease {
    uuid: String,
    task_uuid: String,
    worker_id: String,
    lease_status: i64,
    lease_token: String,
}

#[derive(Debug, Clone)]
struct AutoCutRecoveryLeaseSignal {
    lease_uuid: String,
    lease_status: i64,
    reason: &'static str,
}

pub fn probe_autocut_ffmpeg(app: &AppHandle) -> AutoCutFfmpegProbe {
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    match Command::new(&toolchain.executable)
        .args(["-version"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let version_text = String::from_utf8_lossy(&output.stdout);
            AutoCutFfmpegProbe {
                available: true,
                executable: toolchain.executable,
                source_kind: toolchain.source_kind,
                manifest_ready: toolchain.manifest_ready,
                bundled_ready: toolchain.bundled_ready,
                version_line: version_text.lines().next().map(str::to_string),
                diagnostics: toolchain.diagnostics,
            }
        }
        Ok(output) => AutoCutFfmpegProbe {
            available: false,
            executable: toolchain.executable,
            source_kind: toolchain.source_kind,
            manifest_ready: toolchain.manifest_ready,
            bundled_ready: toolchain.bundled_ready,
            version_line: None,
            diagnostics: append_diagnostic(
                toolchain.diagnostics,
                format!(
                    "ffmpeg -version exited with status {}: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            ),
        },
        Err(error) => AutoCutFfmpegProbe {
            available: false,
            executable: toolchain.executable,
            source_kind: toolchain.source_kind,
            manifest_ready: toolchain.manifest_ready,
            bundled_ready: toolchain.bundled_ready,
            version_line: None,
            diagnostics: append_diagnostic(
                toolchain.diagnostics,
                format!("ffmpeg probe failed: {error}"),
            ),
        },
    }
}

pub fn import_autocut_media_file(
    app: &AppHandle,
    request: AutoCutMediaImportRequest,
) -> Result<AutoCutMediaImportResult, String> {
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    import_autocut_media_file_in_root(&connection, &media_root, request, &toolchain)
}

pub fn describe_autocut_local_media_file(
    app: &AppHandle,
    request: AutoCutMediaImportRequest,
) -> Result<AutoCutLocalMediaFileDescription, String> {
    let _command_contract = "autocut_describe_local_media_file";
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    describe_autocut_local_media_file_from_path(Path::new(&request.source_path), Some(&toolchain))
}

pub fn select_autocut_local_media_file(
    app: &AppHandle,
    request: AutoCutLocalMediaFileSelectRequest,
) -> Result<Option<AutoCutLocalMediaFileDescription>, String> {
    let requested_media_types = normalize_autocut_media_file_select_types(&request.media_types)?;
    let mut dialog = rfd::FileDialog::new().set_title("Select audio or video file");
    if requested_media_types
        .iter()
        .any(|media_type| media_type == "video")
    {
        dialog = dialog.add_filter("Video", SUPPORTED_VIDEO_FILE_DIALOG_EXTENSIONS);
    }
    if requested_media_types
        .iter()
        .any(|media_type| media_type == "audio")
    {
        dialog = dialog.add_filter("Audio", SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS);
    }

    let Some(source_path) = dialog.pick_file() else {
        return Ok(None);
    };

    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    let description = describe_autocut_local_media_file_from_path(&source_path, Some(&toolchain))?;
    if !requested_media_types
        .iter()
        .any(|media_type| media_type == &description.media_type)
    {
        return Err(format!(
            "selected AutoCut source file must be one of: {}",
            requested_media_types.join(", ")
        ));
    }
    allow_autocut_asset_protocol_file_parent_scope(app, Path::new(&description.source_path))?;

    Ok(Some(description))
}

pub fn select_autocut_local_video_file(
    app: &AppHandle,
) -> Result<Option<AutoCutLocalMediaFileDescription>, String> {
    let Some(source_path) = rfd::FileDialog::new()
        .set_title("Select video file")
        .add_filter("Video", SUPPORTED_VIDEO_FILE_DIALOG_EXTENSIONS)
        .pick_file()
    else {
        return Ok(None);
    };

    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    let description = describe_autocut_local_media_file_from_path(&source_path, Some(&toolchain))?;
    if description.media_type != "video" {
        return Err("selected AutoCut source file must be a video file".to_string());
    }
    allow_autocut_asset_protocol_file_parent_scope(app, Path::new(&description.source_path))?;

    Ok(Some(description))
}

pub fn select_autocut_local_directory(app: &AppHandle) -> Result<Option<String>, String> {
    let Some(directory_path) = rfd::FileDialog::new()
        .set_title("Select AutoCut directory")
        .pick_folder()
    else {
        return Ok(None);
    };

    if !directory_path.is_absolute() {
        return Err("selected AutoCut directory must be an absolute path".to_string());
    }

    fs::create_dir_all(&directory_path)
        .map_err(|error| format!("create selected AutoCut directory failed: {error}"))?;

    let directory_path = directory_path
        .canonicalize()
        .map_err(|error| format!("canonicalize selected AutoCut directory failed: {error}"))?;
    allow_autocut_asset_protocol_directory_scope(app, &directory_path)?;

    Ok(Some(directory_path.display().to_string()))
}

pub fn allow_autocut_local_media_preview_directory(
    app: &AppHandle,
    request: AutoCutLocalMediaPreviewDirectoryRequest,
) -> Result<AutoCutLocalMediaPreviewDirectoryResult, String> {
    let directory_path = ensure_autocut_preview_directory_path(Path::new(&request.directory_path))?;
    allow_autocut_asset_protocol_directory_scope(app, &directory_path)?;

    Ok(AutoCutLocalMediaPreviewDirectoryResult {
        directory_path: directory_path.display().to_string(),
        allowed: true,
    })
}

pub fn open_autocut_artifact_in_folder(
    request: AutoCutNativeArtifactInFolderRequest,
) -> Result<AutoCutNativeArtifactInFolderResult, String> {
    let artifact_path =
        ensure_existing_autocut_artifact_file_path(Path::new(&request.artifact_path))?;
    if let Some(task_output_dir) = request.task_output_dir.as_deref() {
        let task_output_dir =
            ensure_existing_autocut_preview_directory_path(Path::new(task_output_dir))?;
        if !artifact_path.starts_with(&task_output_dir) {
            return Err(format!(
                "AutoCut generated artifact path is outside its task output directory: {}",
                artifact_path.display()
            ));
        }
    }
    let containing_directory_path = artifact_path
        .parent()
        .ok_or_else(|| {
            format!(
                "AutoCut generated artifact has no containing directory: {}",
                artifact_path.display()
            )
        })?
        .to_path_buf();
    spawn_autocut_artifact_folder_reveal_command(&artifact_path, &containing_directory_path)?;

    Ok(AutoCutNativeArtifactInFolderResult {
        artifact_path: artifact_path.display().to_string(),
        containing_directory_path: containing_directory_path.display().to_string(),
        opened: true,
    })
}

pub fn select_autocut_speech_transcription_file(
    request: AutoCutSpeechTranscriptionFileSelectRequest,
) -> Result<Option<String>, String> {
    let kind = request.kind.trim();
    let dialog = if kind == "executable" {
        rfd::FileDialog::new()
            .set_title("Select local speech transcription executable")
            .add_filter("Executable", &["exe", "cmd", "bat", "sh", "bin"])
    } else if kind == "model" {
        rfd::FileDialog::new()
            .set_title("Select local speech transcription model")
            .add_filter("Model", SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS)
    } else {
        return Err(
            "AutoCut speech transcription file chooser kind must be executable or model"
                .to_string(),
        );
    };

    let Some(path) = dialog.pick_file() else {
        return Ok(None);
    };
    if !path.is_absolute() {
        return Err(
            "selected AutoCut speech transcription file must be an absolute path".to_string(),
        );
    }
    if !path.is_file() {
        return Err(format!(
            "selected AutoCut speech transcription file does not exist: {}",
            path.display()
        ));
    }

    Ok(Some(path.display().to_string()))
}

pub fn download_autocut_speech_transcription_model(
    app: &AppHandle,
    request: AutoCutSpeechTranscriptionModelDownloadRequest,
) -> Result<AutoCutSpeechTranscriptionModelDownloadResult, String> {
    let root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    download_autocut_speech_transcription_model_in_root(&root, request, Some(app))
}

pub fn probe_autocut_speech_transcription(
    app: &AppHandle,
    request: AutoCutSpeechTranscriptionProbeRequest,
) -> AutoCutSpeechTranscriptionProbe {
    let default_model_path =
        autocut_default_speech_model_path_for_request(app, request.output_root_dir.as_deref()).ok();
    let default_executable_path = autocut_default_speech_executable_path(app).ok();
    let toolchain = resolve_autocut_speech_toolchain_for_app_request(
        Some(app),
        request.executable_path.as_deref(),
        request.model_path.as_deref(),
        request.source_kind.as_deref(),
        default_executable_path.as_deref(),
        default_model_path.as_deref(),
    );
    probe_autocut_speech_transcription_with_toolchain(request, toolchain)
}

#[cfg(test)]
fn probe_autocut_speech_transcription_for_request(
    request: AutoCutSpeechTranscriptionProbeRequest,
) -> AutoCutSpeechTranscriptionProbe {
    let toolchain = resolve_autocut_speech_toolchain_for_request(
        request.executable_path.as_deref(),
        request.model_path.as_deref(),
        request.source_kind.as_deref(),
        None,
        None,
    );
    probe_autocut_speech_transcription_with_toolchain(request, toolchain)
}

fn probe_autocut_speech_transcription_with_toolchain(
    request: AutoCutSpeechTranscriptionProbeRequest,
    toolchain: AutoCutSpeechToolchain,
) -> AutoCutSpeechTranscriptionProbe {
    let mut diagnostics = toolchain.diagnostics.clone();
    if let Some(provider_id) = normalize_path_text(request.provider_id.as_deref()) {
        if !matches!(provider_id.as_str(), "local-whisper-cli") {
            diagnostics.push(format!(
                "AutoCut native speech transcription probe only supports local providers, got providerId {provider_id}"
            ));
        }
    }
    let version_line = if toolchain.ready {
        match Command::new(&toolchain.executable).arg("--help").output() {
            Ok(output) => read_speech_toolchain_version_line(&output),
            Err(error) => {
                diagnostics.push(format!(
                    "AutoCut speech transcription probe could not execute help: {error}"
                ));
                None
            }
        }
    } else {
        None
    };

    AutoCutSpeechTranscriptionProbe {
        ready: diagnostics.is_empty() && toolchain.ready,
        executable_ready: toolchain.executable_ready,
        model_ready: toolchain.model_ready,
        executable_path: toolchain.executable,
        model_path: toolchain.model_path,
        source_kind: toolchain.source_kind,
        diagnostics,
        version_line,
        default_executable_directory: toolchain.default_executable_directory,
        default_executable_path: toolchain.default_executable_path,
        default_model_directory: toolchain.default_model_directory,
        default_model_path: toolchain.default_model_path,
        executable_strategy: toolchain.executable_strategy,
    }
}

pub fn extract_autocut_audio_from_asset(
    app: &AppHandle,
    request: AutoCutAudioExtractionRequest,
) -> Result<AutoCutAudioExtractionResult, String> {
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    extract_autocut_audio_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn generate_autocut_gif_from_asset(
    app: &AppHandle,
    request: AutoCutVideoGifRequest,
) -> Result<AutoCutVideoGifResult, String> {
    let _command_contract = "autocut_generate_gif";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    generate_autocut_gif_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn slice_autocut_video_from_asset(
    app: &AppHandle,
    request: AutoCutVideoSliceRequest,
) -> Result<AutoCutVideoSliceResult, String> {
    let _command_contract = "autocut_slice_video";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    slice_autocut_video_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn transcribe_autocut_media_from_asset(
    app: &AppHandle,
    request: AutoCutSpeechTranscriptionRequest,
) -> Result<AutoCutSpeechTranscriptionResult, String> {
    let _command_contract = "autocut_transcribe_media";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let ffmpeg_toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    let speech_toolchain = resolve_autocut_speech_toolchain_for_app_request(
        Some(app),
        request.executable_path.as_deref(),
        request.model_path.as_deref(),
        Some("settings"),
        autocut_default_speech_executable_path(app).ok().as_deref(),
        None,
    );
    transcribe_autocut_media_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &ffmpeg_toolchain,
        &speech_toolchain,
    )
}

pub fn compress_autocut_video_from_asset(
    app: &AppHandle,
    request: AutoCutVideoCompressRequest,
) -> Result<AutoCutVideoCompressResult, String> {
    let _command_contract = "autocut_compress_video";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    compress_autocut_video_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn convert_autocut_video_from_asset(
    app: &AppHandle,
    request: AutoCutVideoConvertRequest,
) -> Result<AutoCutVideoConvertResult, String> {
    let _command_contract = "autocut_convert_video";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    convert_autocut_video_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn enhance_autocut_video_from_asset(
    app: &AppHandle,
    request: AutoCutVideoEnhanceRequest,
) -> Result<AutoCutVideoEnhanceResult, String> {
    let _command_contract = "autocut_enhance_video";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    enhance_autocut_video_from_asset_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn run_autocut_audio_smoke(app: &AppHandle) -> Result<AutoCutAudioExtractionResult, String> {
    let media_root = autocut_media_root(app)?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    run_autocut_audio_smoke_in_root_with_toolchain(&media_root, &toolchain)
}

pub fn list_autocut_native_tasks(
    app: &AppHandle,
    request: AutoCutNativeTaskQueryRequest,
) -> Result<Vec<AutoCutNativeTaskSnapshot>, String> {
    let _command_contract = "autocut_list_native_tasks";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let snapshots = list_autocut_native_tasks_on_connection(&connection, request)?;
    allow_autocut_native_task_preview_scopes(app, &snapshots);
    Ok(snapshots)
}

pub fn cancel_autocut_native_task(
    app: &AppHandle,
    request: AutoCutNativeTaskCancelRequest,
) -> Result<AutoCutNativeTaskCancelResult, String> {
    let _command_contract = "autocut_cancel_native_task";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    cancel_autocut_native_task_on_connection(&connection, request)
}

pub fn recover_autocut_native_tasks(
    app: &AppHandle,
    request: AutoCutNativeTaskRecoveryRequest,
) -> Result<AutoCutNativeTaskRecoveryResult, String> {
    let _command_contract = "autocut_recover_native_tasks";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    recover_autocut_native_tasks_on_connection(&connection, request)
}

pub fn retry_autocut_native_task(
    app: &AppHandle,
    request: AutoCutNativeTaskRetryRequest,
) -> Result<AutoCutNativeTaskRetryResult, String> {
    let _command_contract = "autocut_retry_native_task";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root(app)?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    retry_autocut_native_task_in_root_with_toolchain(&connection, &media_root, request, &toolchain)
}

fn autocut_media_root(app: &AppHandle) -> Result<PathBuf, String> {
    let mut app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve AutoCut app data directory failed: {error}"))?;
    app_data_dir.push(AUTOCUT_MEDIA_ROOT_DIR);
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("create AutoCut media directory failed: {error}"))?;
    app_data_dir
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut media directory failed: {error}"))
}

fn autocut_media_root_for_request(
    app: &AppHandle,
    output_root_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let media_root = match output_root_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(output_root_dir) => {
            let output_root = PathBuf::from(output_root_dir);
            if !output_root.is_absolute() {
                return Err("AutoCut outputRootDir must be an absolute directory path".to_string());
            }
            fs::create_dir_all(&output_root).map_err(|error| {
                format!("create configured AutoCut output directory failed: {error}")
            })?;
            output_root.canonicalize().map_err(|error| {
                format!("canonicalize configured AutoCut output directory failed: {error}")
            })?
        }
        None => autocut_media_root(app)?,
    };
    allow_autocut_asset_protocol_directory_scope(app, &media_root)?;
    Ok(media_root)
}

fn autocut_default_speech_model_path_for_request(
    app: &AppHandle,
    output_root_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let model_directory = autocut_media_root_for_request(app, output_root_dir)?
        .join(AUTOCUT_MEDIA_MODEL_DIR)
        .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
    fs::create_dir_all(&model_directory)
        .map_err(|error| format!("create AutoCut speech model directory failed: {error}"))?;
    let canonical_model_directory = model_directory
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut speech model directory failed: {error}"))?;
    Ok(canonical_model_directory.join(AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_MODEL_FILE_NAME))
}

fn autocut_default_speech_executable_path(app: &AppHandle) -> Result<PathBuf, String> {
    resolve_autocut_default_bundled_speech_executable_path(
        &autocut_speech_toolchain_manifest_candidate_paths(Some(app)),
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
    .ok_or_else(|| "AutoCut speech toolchain manifest has no default bundled whisper-cli sidecar target for this platform.".to_string())
}

fn ensure_autocut_preview_directory_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("AutoCut local media preview directory must be an absolute path".to_string());
    }

    fs::create_dir_all(path)
        .map_err(|error| format!("create AutoCut local media preview directory failed: {error}"))?;
    let directory_path = path.canonicalize().map_err(|error| {
        format!("canonicalize AutoCut local media preview directory failed: {error}")
    })?;
    if !directory_path.is_dir() {
        return Err(format!(
            "AutoCut local media preview directory is not a directory: {}",
            directory_path.display()
        ));
    }

    Ok(directory_path)
}

fn ensure_existing_autocut_preview_directory_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("AutoCut local media preview directory must be an absolute path".to_string());
    }

    let directory_path = path.canonicalize().map_err(|error| {
        format!("canonicalize AutoCut local media preview directory failed: {error}")
    })?;
    if !directory_path.is_dir() {
        return Err(format!(
            "AutoCut local media preview directory is not a directory: {}",
            directory_path.display()
        ));
    }

    Ok(directory_path)
}

fn ensure_existing_autocut_artifact_file_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("AutoCut generated artifact path must be an absolute path".to_string());
    }

    let artifact_path = path
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut generated artifact path failed: {error}"))?;
    if !artifact_path.is_file() {
        return Err(format!(
            "AutoCut generated artifact path is not a file: {}",
            artifact_path.display()
        ));
    }

    Ok(artifact_path)
}

fn spawn_autocut_artifact_folder_reveal_command(
    artifact_path: &Path,
    containing_directory_path: &Path,
) -> Result<(), String> {
    let mut command =
        build_autocut_artifact_folder_reveal_command(artifact_path, containing_directory_path)?;
    command.spawn().map(|_| ()).map_err(|error| {
        format!("open AutoCut generated artifact containing folder failed: {error}")
    })
}

fn build_autocut_artifact_folder_reveal_command(
    artifact_path: &Path,
    containing_directory_path: &Path,
) -> Result<Command, String> {
    if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", artifact_path.display()));
        return Ok(command);
    }
    if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R");
        command.arg(artifact_path);
        return Ok(command);
    }
    if cfg!(target_os = "linux") {
        let mut command = Command::new("xdg-open");
        command.arg(containing_directory_path);
        return Ok(command);
    }

    Err("AutoCut generated artifact folder opening is not supported on this platform".to_string())
}

fn allow_autocut_asset_protocol_file_parent_scope(
    app: &AppHandle,
    file_path: &Path,
) -> Result<(), String> {
    let parent = file_path.parent().ok_or_else(|| {
        format!(
            "AutoCut local media preview file has no parent directory: {}",
            file_path.display()
        )
    })?;
    allow_autocut_asset_protocol_directory_scope(app, parent)
}

fn allow_autocut_asset_protocol_directory_scope(
    app: &AppHandle,
    directory_path: &Path,
) -> Result<(), String> {
    let directory_path = ensure_autocut_preview_directory_path(directory_path)?;
    let scopes = app.state::<tauri::scope::Scopes>();
    scopes
        .allow_directory(directory_path, true)
        .map_err(|error| format!("grant AutoCut asset protocol preview directory failed: {error}"))
}

fn allow_existing_autocut_asset_protocol_directory_scope(
    app: &AppHandle,
    directory_path: &Path,
) -> Result<(), String> {
    let directory_path = ensure_existing_autocut_preview_directory_path(directory_path)?;
    let scopes = app.state::<tauri::scope::Scopes>();
    scopes
        .allow_directory(directory_path, true)
        .map_err(|error| format!("grant AutoCut asset protocol preview directory failed: {error}"))
}

fn allow_autocut_native_task_preview_scopes(
    app: &AppHandle,
    snapshots: &[AutoCutNativeTaskSnapshot],
) {
    for directory_path in collect_autocut_native_task_preview_directories(snapshots) {
        if allow_existing_autocut_asset_protocol_directory_scope(app, &directory_path).is_err() {
            continue;
        }
    }
}

fn collect_autocut_native_task_preview_directories(
    snapshots: &[AutoCutNativeTaskSnapshot],
) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    for snapshot in snapshots {
        for source in [&snapshot.input_json, &snapshot.output_json] {
            let Some(directory) = read_autocut_task_output_root_dir(source, &snapshot.uuid) else {
                continue;
            };
            if directories.iter().any(|existing| existing == &directory) {
                continue;
            }
            directories.push(directory);
        }
    }

    directories
}

fn read_autocut_task_output_root_dir(json_source: &str, task_uuid: &str) -> Option<PathBuf> {
    let value = serde_json::from_str::<Value>(json_source).ok()?;
    let task_output_dir = value
        .get("taskOutputDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if let Some(task_output_dir) = task_output_dir {
        if task_output_dir.is_absolute()
            && task_output_dir.file_name().and_then(|name| name.to_str())
                == Some(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
            && task_output_dir
                .parent()
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
                == Some(task_uuid)
            && task_output_dir
                .parent()
                .and_then(Path::parent)
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
                == Some(AUTOCUT_MEDIA_TASK_DIR)
        {
            return task_output_dir
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent)
                .filter(|root| root.is_absolute())
                .map(Path::to_path_buf);
        }
    }

    value
        .get("outputRootDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn resolve_autocut_request_media_root(
    default_root: &Path,
    output_root_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(output_root_dir) = output_root_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return default_root
            .canonicalize()
            .map_err(|error| format!("canonicalize AutoCut media directory failed: {error}"));
    };

    let output_root = PathBuf::from(output_root_dir);
    if !output_root.is_absolute() {
        return Err("AutoCut outputRootDir must be an absolute directory path".to_string());
    }
    fs::create_dir_all(&output_root)
        .map_err(|error| format!("create configured AutoCut output directory failed: {error}"))?;
    let output_root = output_root.canonicalize().map_err(|error| {
        format!("canonicalize configured AutoCut output directory failed: {error}")
    })?;
    Ok(output_root)
}

fn autocut_operation_output_root_dir_payload(
    resolved_root: &Path,
    output_root_dir: Option<&str>,
) -> Option<String> {
    output_root_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|_| resolved_root.display().to_string())
}

fn insert_autocut_output_root_dir_payload(input_json: &mut Value, output_root_dir: Option<&str>) {
    let Some(output_root_dir) = output_root_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };

    if let Value::Object(input) = input_json {
        input.insert("outputRootDir".to_string(), json!(output_root_dir));
    }
}

fn create_autocut_task_input_json(asset: &AutoCutRegisteredMediaAsset, payload: Value) -> Value {
    let input = match payload {
        Value::Object(input) => input,
        other => {
            let mut input = Map::new();
            input.insert("details".to_string(), other);
            input
        }
    };
    let mut input = input;
    input.insert("assetUuid".to_string(), json!(asset.uuid.clone()));
    input.insert("sourceName".to_string(), json!(asset.name.clone()));
    Value::Object(input)
}

fn resolve_autocut_ffmpeg_toolchain_for_app(app: &AppHandle) -> AutoCutFfmpegToolchain {
    resolve_autocut_ffmpeg_toolchain_from_candidate_manifests(
        &autocut_ffmpeg_toolchain_manifest_candidate_paths(Some(app)),
        std::env::var("SDKWORK_AUTOCUT_FFMPEG").ok().as_deref(),
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
    .unwrap_or_else(|error| AutoCutFfmpegToolchain {
        executable: DEFAULT_FFMPEG_EXECUTABLE.to_string(),
        source_kind: "system-path".to_string(),
        manifest_ready: false,
        bundled_ready: false,
        diagnostics: vec![error],
    })
}

fn autocut_ffmpeg_toolchain_manifest_candidate_paths(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut manifest_paths = Vec::new();
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            manifest_paths.push(
                resource_dir
                    .join("binaries")
                    .join(AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_FILE_NAME),
            );
        }
    }
    manifest_paths.push(autocut_source_ffmpeg_toolchain_manifest_path());
    manifest_paths
}

fn autocut_source_ffmpeg_toolchain_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_FILE_NAME)
}

fn resolve_autocut_ffmpeg_toolchain_from_candidate_manifests(
    manifest_paths: &[PathBuf],
    env_override: Option<&str>,
    os: &str,
    arch: &str,
) -> Result<AutoCutFfmpegToolchain, String> {
    if manifest_paths.is_empty() {
        return Err("FFmpeg toolchain resolver has no candidate manifests".to_string());
    }

    let env_value = env_override
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(executable) = env_value {
        return Ok(AutoCutFfmpegToolchain {
            executable: executable.to_string(),
            source_kind: "environment".to_string(),
            manifest_ready: manifest_paths
                .iter()
                .any(|manifest_path| manifest_path.is_file()),
            bundled_ready: false,
            diagnostics: vec![
                "SDKWORK_AUTOCUT_FFMPEG overrides the package-local FFmpeg toolchain manifest"
                    .to_string(),
            ],
        });
    }

    let mut diagnostics = Vec::new();
    let mut path_fallback: Option<AutoCutFfmpegToolchain> = None;
    for manifest_path in manifest_paths {
        match resolve_autocut_ffmpeg_toolchain_from_manifest(manifest_path, None, os, arch) {
            Ok(mut toolchain) => {
                if toolchain.source_kind == "bundled-sidecar" {
                    toolchain.diagnostics.splice(0..0, diagnostics);
                    return Ok(toolchain);
                }

                let mut fallback_diagnostics = diagnostics.clone();
                fallback_diagnostics.append(&mut toolchain.diagnostics);
                if path_fallback.is_none() {
                    path_fallback = Some(AutoCutFfmpegToolchain {
                        diagnostics: fallback_diagnostics.clone(),
                        ..toolchain
                    });
                }
                diagnostics = fallback_diagnostics;
            }
            Err(error) => diagnostics.push(error),
        }
    }

    if let Some(mut toolchain) = path_fallback {
        toolchain.diagnostics = diagnostics;
        return Ok(toolchain);
    }

    Ok(AutoCutFfmpegToolchain {
        executable: DEFAULT_FFMPEG_EXECUTABLE.to_string(),
        source_kind: "system-path".to_string(),
        manifest_ready: false,
        bundled_ready: false,
        diagnostics,
    })
}

fn resolve_autocut_ffmpeg_toolchain_from_manifest(
    manifest_path: &Path,
    env_override: Option<&str>,
    os: &str,
    arch: &str,
) -> Result<AutoCutFfmpegToolchain, String> {
    let manifest = parse_autocut_ffmpeg_toolchain_manifest(manifest_path)?;
    let mut diagnostics = Vec::new();
    let manifest_ready = fs::read_to_string(manifest_path)
        .map(|source| source.contains("\"tool\"") && source.contains("\"ffmpeg\""))
        .unwrap_or(false);

    if manifest.tool != "ffmpeg" {
        return Err(format!(
            "FFmpeg toolchain manifest declares unsupported tool {}",
            manifest.tool
        ));
    }

    let env_value = env_override
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(executable) = env_value {
        diagnostics.push(
            "SDKWORK_AUTOCUT_FFMPEG overrides the package-local FFmpeg toolchain manifest"
                .to_string(),
        );
        return Ok(AutoCutFfmpegToolchain {
            executable: executable.to_string(),
            source_kind: "environment".to_string(),
            manifest_ready,
            bundled_ready: false,
            diagnostics,
        });
    }

    validate_autocut_ffmpeg_toolchain_manifest(&manifest)?;

    let platform_key = autocut_ffmpeg_platform_key(os, arch);
    let platform = manifest
        .platforms
        .get(platform_key.as_str())
        .ok_or_else(|| {
            format!("FFmpeg toolchain manifest has no platform entry for {platform_key}")
        })?;
    let sidecar_path = manifest_path
        .parent()
        .ok_or_else(|| {
            format!(
                "resolve FFmpeg toolchain manifest parent failed: {}",
                manifest_path.display()
            )
        })?
        .to_path_buf();
    let sidecar_path = join_autocut_manifest_relative_path(&sidecar_path, &platform.relative_path);
    if sidecar_path.is_file() {
        if let Err(error) = verify_autocut_ffmpeg_sidecar_integrity(&sidecar_path, platform) {
            diagnostics.push(error);
            return Ok(AutoCutFfmpegToolchain {
                executable: resolve_ffmpeg_executable_from_toolchain(&manifest.required_binary),
                source_kind: "system-path".to_string(),
                manifest_ready,
                bundled_ready: false,
                diagnostics,
            });
        }
        return Ok(AutoCutFfmpegToolchain {
            executable: sidecar_path.display().to_string(),
            source_kind: "bundled-sidecar".to_string(),
            manifest_ready,
            bundled_ready: true,
            diagnostics,
        });
    }

    diagnostics.push(format!(
        "missing bundled FFmpeg sidecar {}; falling back to {} on PATH",
        sidecar_path.display(),
        manifest.required_binary
    ));
    Ok(AutoCutFfmpegToolchain {
        executable: resolve_ffmpeg_executable_from_toolchain(&manifest.required_binary),
        source_kind: "system-path".to_string(),
        manifest_ready,
        bundled_ready: false,
        diagnostics,
    })
}

fn parse_autocut_ffmpeg_toolchain_manifest(
    manifest_path: &Path,
) -> Result<AutoCutFfmpegToolchainManifest, String> {
    let source = fs::read_to_string(manifest_path).map_err(|error| {
        format!(
            "read FFmpeg toolchain manifest {} failed: {error}",
            manifest_path.display()
        )
    })?;
    let embedded_manifest = AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_JSON;
    serde_json::from_str(&source)
        .map_err(|error| format!("parse FFmpeg toolchain manifest failed: {error}"))
        .and_then(|manifest: AutoCutFfmpegToolchainManifest| {
            if embedded_manifest.contains("\"tool\"") {
                Ok(manifest)
            } else {
                Err("embedded FFmpeg toolchain manifest contract is invalid".to_string())
            }
        })
}

fn validate_autocut_ffmpeg_toolchain_manifest(
    manifest: &AutoCutFfmpegToolchainManifest,
) -> Result<(), String> {
    if manifest.contract_version.trim().is_empty() {
        return Err("FFmpeg toolchain manifest contractVersion must be non-empty".to_string());
    }
    if manifest.license.name.trim().is_empty()
        || manifest.license.spdx_expression.trim().is_empty()
        || manifest.license.notice.trim().is_empty()
    {
        return Err("FFmpeg toolchain manifest license metadata must be complete".to_string());
    }
    for (platform_key, platform) in &manifest.platforms {
        if platform.relative_path.trim().is_empty() {
            return Err(format!(
                "FFmpeg toolchain manifest platform {platform_key} relativePath must be non-empty"
            ));
        }
        if platform.binary_name.trim().is_empty() {
            return Err(format!(
                "FFmpeg toolchain manifest platform {platform_key} binaryName must be non-empty"
            ));
        }
        if !platform.relative_path.ends_with(&platform.binary_name) {
            return Err(format!(
                "FFmpeg toolchain manifest platform {platform_key} binaryName must match relativePath"
            ));
        }
        if platform.relative_path.contains("..")
            || Path::new(&platform.relative_path).is_absolute()
            || platform
                .relative_path
                .split(['/', '\\'])
                .any(|segment| segment.is_empty())
        {
            return Err(format!(
                "FFmpeg toolchain manifest platform {platform_key} relativePath must be a safe relative path"
            ));
        }
        if platform.integrity.sha256.len() != 64
            || !platform
                .integrity
                .sha256
                .chars()
                .all(|ch| ch.is_ascii_hexdigit())
        {
            return Err(format!(
                "FFmpeg toolchain manifest platform {platform_key} sha256 must be a 64 character hex digest"
            ));
        }
    }
    Ok(())
}

fn verify_autocut_ffmpeg_sidecar_integrity(
    sidecar_path: &Path,
    platform: &AutoCutFfmpegPlatformToolchain,
) -> Result<(), String> {
    verify_autocut_ffmpeg_sidecar_integrity_with_integrity(sidecar_path, &platform.integrity)
}

fn verify_autocut_ffmpeg_sidecar_integrity_with_integrity(
    sidecar_path: &Path,
    integrity: &AutoCutFfmpegPlatformIntegrity,
) -> Result<(), String> {
    let metadata = fs::metadata(sidecar_path).map_err(|error| {
        format!(
            "read bundled FFmpeg sidecar metadata {} failed: {error}",
            sidecar_path.display()
        )
    })?;
    if metadata.len() != integrity.byte_size {
        return Err(format!(
            "bundled FFmpeg sidecar byteSize mismatch for {}: manifest={}, actual={}",
            sidecar_path.display(),
            integrity.byte_size,
            metadata.len()
        ));
    }
    let bytes = fs::read(sidecar_path).map_err(|error| {
        format!(
            "read bundled FFmpeg sidecar {} failed: {error}",
            sidecar_path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = format!("{:x}", hasher.finalize());
    if !digest.eq_ignore_ascii_case(&integrity.sha256) {
        return Err(format!(
            "bundled FFmpeg sidecar checksum mismatch for {}: manifest={}, actual={digest}",
            sidecar_path.display(),
            integrity.sha256
        ));
    }
    Ok(())
}

fn resolve_ffmpeg_executable_from_toolchain(required_binary: &str) -> String {
    let trimmed = required_binary.trim();
    if trimmed.is_empty() {
        DEFAULT_FFMPEG_EXECUTABLE.to_string()
    } else {
        trimmed.to_string()
    }
}

fn autocut_ffmpeg_platform_key(os: &str, arch: &str) -> String {
    let normalized_os = match os {
        "win32" => "windows",
        "macos" => "macos",
        "darwin" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    };
    let normalized_arch = match arch {
        "x64" => "x86_64",
        "x86_64" => "x86_64",
        "amd64" => "x86_64",
        "arm64" => "aarch64",
        "aarch64" => "aarch64",
        other => other,
    };
    format!("{normalized_os}-{normalized_arch}")
}

fn append_diagnostic(mut diagnostics: Vec<String>, diagnostic: String) -> Vec<String> {
    diagnostics.push(diagnostic);
    diagnostics
}

fn ensure_safe_media_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("source media path must be absolute".to_string());
    }

    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("source media path must not contain parent traversal".to_string());
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("canonicalize media root failed: {error}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("canonicalize media path failed: {error}"))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(format!(
            "source media path must stay under AutoCut media root: {}",
            canonical_root.display()
        ));
    }

    Ok(canonical_path)
}

fn autocut_task_output_dir(root: &Path, task_uuid: &str) -> Result<PathBuf, String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    if normalized_task_uuid
        .chars()
        .any(|character| !(character.is_ascii_alphanumeric() || character == '-'))
    {
        return Err("taskUuid contains unsupported path characters".to_string());
    }

    let output_dir = root
        .join(AUTOCUT_MEDIA_TASK_DIR)
        .join(normalized_task_uuid)
        .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("create AutoCut task output directory failed: {error}"))?;

    let canonical_media_root = root
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut media root failed: {error}"))?;
    let canonical_output_dir = output_dir
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut task output directory failed: {error}"))?;
    if !canonical_output_dir.starts_with(canonical_media_root) {
        return Err("AutoCut task output directory must stay under the media root".to_string());
    }

    Ok(canonical_output_dir)
}

fn autocut_task_cover_dir(task_output_dir: &Path) -> Result<PathBuf, String> {
    let cover_dir = task_output_dir.join(AUTOCUT_MEDIA_TASK_COVER_DIR);
    fs::create_dir_all(&cover_dir)
        .map_err(|error| format!("create AutoCut task cover directory failed: {error}"))?;

    let canonical_task_output_dir = task_output_dir
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut task output directory failed: {error}"))?;
    let canonical_cover_dir = cover_dir
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut task cover directory failed: {error}"))?;
    if !canonical_cover_dir.starts_with(&canonical_task_output_dir) {
        return Err(
            "AutoCut task cover directory must stay under the task output directory".to_string(),
        );
    }

    Ok(canonical_cover_dir)
}

fn ensure_safe_import_source_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("media import source path must be absolute".to_string());
    }

    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("media import source path must not contain parent traversal".to_string());
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("media import source file does not exist: {error}"))?;
    if !canonical_path.is_file() {
        return Err(format!(
            "media import source path must be a file: {}",
            canonical_path.display()
        ));
    }

    Ok(canonical_path)
}

fn normalize_audio_format(format: &str) -> Result<String, String> {
    let normalized = format.trim().to_ascii_lowercase();
    if SUPPORTED_AUDIO_FORMATS.contains(&normalized.as_str()) {
        return Ok(normalized);
    }

    Err(format!(
        "unsupported audio format '{format}', expected one of {}",
        SUPPORTED_AUDIO_FORMATS.join(", ")
    ))
}

fn normalize_video_gif_fps(fps: &str) -> Result<String, String> {
    let normalized = fps.trim();
    if SUPPORTED_VIDEO_GIF_FPS.contains(&normalized) {
        return Ok(normalized.to_string());
    }

    Err(format!(
        "unsupported video GIF fps '{fps}', expected one of {}",
        SUPPORTED_VIDEO_GIF_FPS.join(", ")
    ))
}

fn normalize_video_gif_resolution(resolution: &str) -> Result<(String, i64), String> {
    let normalized = resolution.trim().to_ascii_lowercase();
    SUPPORTED_VIDEO_GIF_RESOLUTIONS
        .iter()
        .find(|(label, _height)| *label == normalized)
        .map(|(label, height)| (label.to_string(), *height))
        .ok_or_else(|| {
            let supported = SUPPORTED_VIDEO_GIF_RESOLUTIONS
                .iter()
                .map(|(label, _height)| *label)
                .collect::<Vec<_>>()
                .join(", ");
            format!("unsupported video GIF resolution '{resolution}', expected one of {supported}")
        })
}

fn normalize_video_compress_mode(mode: &str) -> Result<String, String> {
    let normalized = mode.trim().to_ascii_lowercase();
    if SUPPORTED_VIDEO_COMPRESS_MODES.contains(&normalized.as_str()) {
        return Ok(normalized);
    }

    Err(format!(
        "unsupported video compression mode '{mode}', expected one of {}",
        SUPPORTED_VIDEO_COMPRESS_MODES.join(", ")
    ))
}

fn video_compress_encoding_profile(mode: &str) -> Result<(&'static str, &'static str), String> {
    match mode {
        "quality" => Ok(("20", "medium")),
        "balanced" => Ok(("26", "medium")),
        "extreme" => Ok(("32", "slow")),
        _ => Err(format!(
            "unsupported normalized video compression mode '{mode}'"
        )),
    }
}

fn normalize_video_convert_format(format: &str) -> Result<String, String> {
    let normalized = format.trim().to_ascii_lowercase();
    if SUPPORTED_VIDEO_CONVERT_FORMATS.contains(&normalized.as_str()) {
        return Ok(normalized);
    }

    Err(format!(
        "unsupported video convert format '{format}', expected one of {}",
        SUPPORTED_VIDEO_CONVERT_FORMATS.join(", ")
    ))
}

fn normalize_video_convert_codec(
    codec: &str,
    codec_kind: &str,
    target_format: &str,
) -> Result<String, String> {
    let normalized = codec.trim().to_ascii_lowercase();
    if normalized.is_empty() || normalized == "auto" {
        return Ok(default_video_convert_codec(codec_kind, target_format).to_string());
    }

    let supported = match codec_kind {
        "video" => SUPPORTED_VIDEO_CONVERT_VIDEO_CODECS,
        "audio" => SUPPORTED_VIDEO_CONVERT_AUDIO_CODECS,
        _ => {
            return Err(format!(
                "unsupported video convert codec kind '{codec_kind}'"
            ));
        }
    };
    if supported.contains(&normalized.as_str()) {
        return Ok(normalized);
    }

    Err(format!(
        "unsupported {codec_kind} codec '{codec}', expected one of {}",
        supported.join(", ")
    ))
}

fn default_video_convert_codec(codec_kind: &str, target_format: &str) -> &'static str {
    match (codec_kind, target_format) {
        ("video", "webm") => "vp9",
        ("audio", "webm") => "opus",
        ("video", "avi") => "mpeg4",
        ("audio", "avi") => "mp3",
        ("video", _) => "h264",
        ("audio", _) => "aac",
        _ => "copy",
    }
}

fn normalize_video_convert_resolution(resolution: &str) -> Result<Option<i64>, String> {
    let normalized = resolution.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "auto" | "original" => Ok(None),
        "480p" => Ok(Some(480)),
        "720p" => Ok(Some(720)),
        "1080p" => Ok(Some(1080)),
        "4k" | "2160p" => Ok(Some(2160)),
        _ => Err(format!(
            "unsupported video convert resolution '{resolution}', expected original, 480p, 720p, 1080p, or 4k"
        )),
    }
}

fn video_convert_mime_type(format: &str) -> &'static str {
    match format {
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "flv" => "video/x-flv",
        "webm" => "video/webm",
        _ => "video/octet-stream",
    }
}

fn normalize_video_enhance_resolution(resolution: &str) -> Result<(String, i64), String> {
    let normalized = resolution.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "720p" => Ok(("720p".to_string(), 720)),
        "1080p" => Ok(("1080p".to_string(), 1080)),
        "2k" | "1440p" => Ok(("2k".to_string(), 1440)),
        "4k" | "2160p" => Ok(("4k".to_string(), 2160)),
        _ => Err(format!(
            "unsupported video enhance resolution '{resolution}', expected 720p, 1080p, 2k, or 4k"
        )),
    }
}

fn normalize_video_enhance_mode(mode: &str) -> Result<String, String> {
    let normalized = mode.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "anime" | "real" | "face" | "balanced" => Ok(normalized),
        _ => Err(format!(
            "unsupported video enhance mode '{mode}', expected anime, real, face, or balanced"
        )),
    }
}

fn normalize_video_enhance_frame_rate(frame_rate: &str) -> Result<Option<String>, String> {
    let normalized = frame_rate.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "auto" | "original" => Ok(None),
        "24" | "30" | "60" => Ok(Some(normalized)),
        _ => Err(format!(
            "unsupported video enhance frame rate '{frame_rate}', expected original, 24, 30, or 60"
        )),
    }
}

fn video_enhance_filter_chain(height: i64, mode: &str, frame_rate: Option<&str>) -> String {
    let mut filters = vec![format!("scale=-2:{height}:flags=lanczos")];
    if let Some(fps) = frame_rate {
        filters.push(format!("fps={fps}"));
    }
    match mode {
        "anime" => {
            filters.push("unsharp=5:5:0.85:3:3:0.35".to_string());
            filters.push("eq=contrast=1.04:saturation=1.08".to_string());
        }
        "face" => {
            filters.push("unsharp=3:3:0.55:3:3:0.2".to_string());
            filters.push("eq=contrast=1.02:saturation=1.03".to_string());
        }
        "real" | "balanced" => {
            filters.push("unsharp=5:5:0.65:3:3:0.25".to_string());
            filters.push("eq=contrast=1.03:saturation=1.04".to_string());
        }
        _ => {
            filters.push("unsharp=5:5:0.65:3:3:0.25".to_string());
        }
    }
    filters.join(",")
}

fn normalize_video_slice_format(format: &str) -> Result<String, String> {
    let normalized = format.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "mp4" => Ok("mp4".to_string()),
        _ => Err("unsupported video slice outputFormat, expected mp4".to_string()),
    }
}

fn normalize_video_slice_render_profile(
    render_profile: Option<AutoCutVideoSliceRenderProfile>,
) -> Result<Option<AutoCutVideoSliceRenderProfile>, String> {
    let Some(render_profile) = render_profile else {
        return Ok(None);
    };

    let target_aspect_ratio = render_profile.target_aspect_ratio.trim();
    if target_aspect_ratio.is_empty() || target_aspect_ratio == "auto" {
        return Ok(None);
    }

    let target_aspect_ratio = match target_aspect_ratio {
        "16:9" | "9:16" | "1:1" | "4:3" => target_aspect_ratio.to_string(),
        _ => {
            return Err(format!(
                "AutoCut video slicing renderProfile targetAspectRatio is unsupported: {target_aspect_ratio}"
            ));
        }
    };

    let object_fit = match render_profile.object_fit.trim() {
        "" | "contain" => "contain".to_string(),
        "cover" => "cover".to_string(),
        value => {
            return Err(format!(
                "AutoCut video slicing renderProfile objectFit is unsupported: {value}"
            ));
        }
    };

    Ok(Some(AutoCutVideoSliceRenderProfile {
        target_aspect_ratio,
        object_fit,
    }))
}

fn video_slice_render_dimensions(target_aspect_ratio: &str) -> Option<(i64, i64)> {
    match target_aspect_ratio {
        "16:9" => Some((1920, 1080)),
        "9:16" => Some((1080, 1920)),
        "1:1" => Some((1080, 1080)),
        "4:3" => Some((1440, 1080)),
        _ => None,
    }
}

fn video_slice_render_filter_chain(
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
) -> Option<String> {
    let render_profile = render_profile?;
    let (target_width, target_height) =
        video_slice_render_dimensions(render_profile.target_aspect_ratio.as_str())?;

    let filter_chain = if render_profile.object_fit == "cover" {
        format!(
            "scale={target_width}:{target_height}:force_original_aspect_ratio=increase:flags=lanczos,crop={target_width}:{target_height}"
        )
    } else {
        format!(
            "scale={target_width}:{target_height}:force_original_aspect_ratio=decrease:flags=lanczos,pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2"
        )
    };

    Some(format!("{filter_chain},setsar=1"))
}

fn normalize_video_slice_subtitle_format(format: Option<&str>) -> Result<Option<String>, String> {
    let Some(format) = format.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    match format.to_ascii_lowercase().as_str() {
        "srt" => Ok(Some("srt".to_string())),
        _ => Err("unsupported video slice subtitleFormat, expected srt".to_string()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoCutVideoSliceSubtitleMode {
    None,
    Srt,
    Burned,
    Both,
}

impl AutoCutVideoSliceSubtitleMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Srt => "srt",
            Self::Burned => "burned",
            Self::Both => "both",
        }
    }

    fn writes_srt_sidecar(self) -> bool {
        matches!(self, Self::Srt | Self::Both)
    }

    fn burns_into_video(self) -> bool {
        matches!(self, Self::Burned | Self::Both)
    }
}

fn normalize_video_slice_subtitle_mode(
    mode: Option<&str>,
    subtitle_format: Option<&str>,
    has_subtitle_segments: bool,
) -> Result<AutoCutVideoSliceSubtitleMode, String> {
    if !has_subtitle_segments {
        return Ok(AutoCutVideoSliceSubtitleMode::None);
    }

    let Some(mode) = mode.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(if subtitle_format == Some("srt") {
            AutoCutVideoSliceSubtitleMode::Srt
        } else {
            return Err("video slice subtitleSegments require subtitleFormat srt".to_string());
        });
    };

    let normalized_mode = mode.to_ascii_lowercase();
    let subtitle_mode = match normalized_mode.as_str() {
        "none" => {
            Err("video slice subtitleMode none cannot be used with subtitle segments".to_string())
        }
        "srt" => Ok(AutoCutVideoSliceSubtitleMode::Srt),
        "burned" => Ok(AutoCutVideoSliceSubtitleMode::Burned),
        "both" => Ok(AutoCutVideoSliceSubtitleMode::Both),
        _ => Err(
            "unsupported video slice subtitleMode, expected none, srt, burned, or both".to_string(),
        ),
    }?;

    if subtitle_format != Some("srt") {
        return Err(format!(
            "video slice subtitleMode {normalized_mode} requires subtitleFormat srt"
        ));
    }

    Ok(subtitle_mode)
}

fn normalize_video_slice_clips(
    clips: &[AutoCutVideoSliceClipRequest],
) -> Result<Vec<AutoCutVideoSliceClipRequest>, String> {
    if clips.is_empty() {
        return Err("AutoCut video slicing requires at least one clip".to_string());
    }
    if clips.len() > 20 {
        return Err("AutoCut video slicing supports at most 20 clips per task".to_string());
    }

    clips
        .iter()
        .enumerate()
        .map(|(index, clip)| {
            if clip.start_ms < 0 {
                return Err(format!(
                    "AutoCut video slice clip {} startMs must be non-negative",
                    index + 1
                ));
            }
            if clip.duration_ms <= 0 || clip.duration_ms > 10 * 60 * 1_000 {
                return Err(format!(
                    "AutoCut video slice clip {} durationMs must be between 1 and 600000",
                    index + 1
                ));
            }
            ensure_video_slice_clip_transcript_evidence(clip, index + 1)?;

            Ok(AutoCutVideoSliceClipRequest {
                start_ms: clip.start_ms,
                duration_ms: clip.duration_ms,
                label: sanitize_video_slice_label(&clip.label, index),
                output_file_name: normalize_video_slice_output_file_name(
                    clip.output_file_name.as_deref(),
                    &clip.label,
                    index,
                    "mp4",
                ),
                audio_mute_ranges: normalize_video_slice_audio_mute_ranges(clip, index + 1)?,
                ..clone_video_slice_clip_evidence(clip)
            })
        })
        .collect()
}

fn normalize_video_slice_audio_mute_ranges(
    clip: &AutoCutVideoSliceClipRequest,
    clip_number: usize,
) -> Result<Option<Vec<AutoCutVideoSliceAudioMuteRange>>, String> {
    let Some(ranges) = clip
        .audio_mute_ranges
        .as_ref()
        .filter(|ranges| !ranges.is_empty())
    else {
        return Ok(None);
    };

    if ranges.len() > 50 {
        return Err(format!(
            "AutoCut video slice clip {clip_number} supports at most 50 audio mute ranges"
        ));
    }

    let clip_end_ms = clip.start_ms.saturating_add(clip.duration_ms);
    let mut normalized_ranges = Vec::new();
    for range in ranges {
        let start_ms = range.start_ms.max(clip.start_ms).min(clip_end_ms);
        let end_ms = range.end_ms.max(clip.start_ms).min(clip_end_ms);
        if end_ms <= start_ms {
            continue;
        }
        if end_ms - start_ms > 3_000 {
            return Err(format!(
                "AutoCut video slice clip {clip_number} audio mute ranges must not exceed 3000ms"
            ));
        }
        normalized_ranges.push(AutoCutVideoSliceAudioMuteRange { start_ms, end_ms });
    }

    normalized_ranges.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then(first.end_ms.cmp(&second.end_ms))
    });
    let mut merged_ranges: Vec<AutoCutVideoSliceAudioMuteRange> = Vec::new();
    for range in normalized_ranges {
        let Some(previous_range) = merged_ranges.last_mut() else {
            merged_ranges.push(range);
            continue;
        };
        if range.start_ms > previous_range.end_ms {
            merged_ranges.push(range);
        } else {
            previous_range.end_ms = previous_range.end_ms.max(range.end_ms);
        }
    }

    Ok((!merged_ranges.is_empty()).then_some(merged_ranges))
}

fn ensure_video_slice_clip_transcript_evidence(
    clip: &AutoCutVideoSliceClipRequest,
    clip_number: usize,
) -> Result<(), String> {
    let transcript_segments = clip.transcript_segments.as_ref().filter(|segments| !segments.is_empty()).ok_or_else(|| {
        format!(
            "AutoCut video slice clip {clip_number} requires speech-to-text transcript evidence before native rendering"
        )
    })?;
    let transcript_text = clip
        .transcript_text
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| {
            format!(
                "AutoCut video slice clip {clip_number} requires visible speech-to-text transcript evidence before native rendering"
            )
        })?;
    let expected_text = transcript_segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if expected_text.is_empty() {
        return Err(format!(
            "AutoCut video slice clip {clip_number} requires non-empty speech-to-text transcript segment text"
        ));
    }
    if normalize_transcript_evidence_text(transcript_text)
        != normalize_transcript_evidence_text(&expected_text)
    {
        return Err(format!(
            "AutoCut video slice clip {clip_number} transcriptText must match structured speech-to-text transcriptSegments"
        ));
    }
    if clip.transcript_segment_count != Some(transcript_segments.len() as i64) {
        return Err(format!(
            "AutoCut video slice clip {clip_number} transcriptSegmentCount must match structured speech-to-text transcriptSegments"
        ));
    }

    let source_start_ms = clip.source_start_ms.unwrap_or(clip.start_ms);
    let source_end_ms = clip.source_end_ms.unwrap_or(clip.start_ms + clip.duration_ms);
    if source_end_ms <= source_start_ms {
        return Err(format!(
            "AutoCut video slice clip {clip_number} sourceEndMs must be after sourceStartMs"
        ));
    }
    if source_start_ms < clip.start_ms || source_end_ms > clip.start_ms + clip.duration_ms {
        return Err(format!(
            "AutoCut video slice clip {clip_number} source range must stay inside rendered clip timing"
        ));
    }

    let speech_start_ms = clip.speech_start_ms.ok_or_else(|| {
        format!(
            "AutoCut video slice clip {clip_number} requires speechStartMs from speech-to-text evidence"
        )
    })?;
    let speech_end_ms = clip.speech_end_ms.ok_or_else(|| {
        format!(
            "AutoCut video slice clip {clip_number} requires speechEndMs from speech-to-text evidence"
        )
    })?;
    if speech_end_ms <= speech_start_ms
        || speech_start_ms < source_start_ms
        || speech_end_ms > source_end_ms
    {
        return Err(format!(
            "AutoCut video slice clip {clip_number} speech range must stay inside its source range"
        ));
    }
    if transcript_segments.first().map(|segment| segment.start_ms) != Some(speech_start_ms)
        || transcript_segments.last().map(|segment| segment.end_ms) != Some(speech_end_ms)
    {
        return Err(format!(
            "AutoCut video slice clip {clip_number} speech range must match transcript segment boundaries"
        ));
    }

    let mut previous_end_ms: Option<i64> = None;
    for (segment_index, segment) in transcript_segments.iter().enumerate() {
        let segment_number = segment_index + 1;
        if segment.text.trim().is_empty() {
            return Err(format!(
                "AutoCut video slice clip {clip_number} transcript segment {segment_number} must contain recognized speech text"
            ));
        }
        if segment.end_ms <= segment.start_ms
            || segment.start_ms < source_start_ms
            || segment.end_ms > source_end_ms
        {
            return Err(format!(
                "AutoCut video slice clip {clip_number} transcript segment {segment_number} must stay inside the source range"
            ));
        }
        if previous_end_ms.is_some_and(|previous| segment.start_ms < previous) {
            return Err(format!(
                "AutoCut video slice clip {clip_number} transcript segments must be ordered and non-overlapping"
            ));
        }
        previous_end_ms = Some(segment.end_ms);
    }

    if clip.transcript_coverage_score.filter(|score| *score >= 0.8).is_none() {
        return Err(format!(
            "AutoCut video slice clip {clip_number} transcriptCoverageScore must be at least 0.8"
        ));
    }
    if !matches!(
        clip.speech_continuity_grade.as_deref(),
        Some("strong") | Some("repaired")
    ) {
        return Err(format!(
            "AutoCut video slice clip {clip_number} speechContinuityGrade must be strong or repaired"
        ));
    }

    Ok(())
}

fn normalize_transcript_evidence_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_speech_transcription_language(language: Option<&str>) -> Result<String, String> {
    let normalized = language
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("auto");
    if normalized.eq_ignore_ascii_case("auto") {
        return Ok("auto".to_string());
    }
    if normalized.len() > 35 {
        return Err("AutoCut speech transcription language must be auto or a valid BCP-47 language tag up to 35 characters.".to_string());
    }

    let canonical = normalized
        .replace('_', "-")
        .split('-')
        .enumerate()
        .map(|(index, part)| {
            if index == 0 {
                part.to_ascii_lowercase()
            } else {
                part.to_ascii_uppercase()
            }
        })
        .collect::<Vec<_>>()
        .join("-");
    if is_supported_speech_transcription_language_tag(&canonical) {
        Ok(canonical)
    } else {
        Err("AutoCut speech transcription language must be auto or a valid BCP-47 language tag such as zh, en, fr, or ja-JP.".to_string())
    }
}

fn is_supported_speech_transcription_language_tag(language: &str) -> bool {
    let mut parts = language.split('-');
    let Some(primary) = parts.next() else {
        return false;
    };
    if !(2..=3).contains(&primary.len())
        || !primary
            .chars()
            .all(|character| character.is_ascii_lowercase())
    {
        return false;
    }
    let mut subtag_count = 0;
    for part in parts {
        subtag_count += 1;
        if subtag_count > 2
            || !(2..=8).contains(&part.len())
            || !part
                .chars()
                .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
        {
            return false;
        }
    }

    true
}

fn normalize_path_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_video_slice_subtitle_segments(
    segments: Option<Vec<AutoCutSpeechTranscriptionSegment>>,
) -> Vec<AutoCutSpeechTranscriptionSegment> {
    segments
        .unwrap_or_default()
        .into_iter()
        .filter_map(|segment| {
            let text = segment.text.trim();
            if text.is_empty() || segment.end_ms <= segment.start_ms || segment.end_ms <= 0 {
                return None;
            }

            Some(AutoCutSpeechTranscriptionSegment {
                start_ms: segment.start_ms.max(0),
                end_ms: segment.end_ms.max(0),
                text: text.chars().take(500).collect(),
                speaker: segment
                    .speaker
                    .as_deref()
                    .map(str::trim)
                    .filter(|speaker| !speaker.is_empty())
                    .map(|speaker| speaker.chars().take(80).collect()),
            })
        })
        .collect()
}

fn adjust_video_slice_clips_for_source_duration(
    clips: &[AutoCutVideoSliceClipRequest],
    source_duration_ms: Option<i64>,
) -> Result<Vec<AutoCutVideoSliceClipRequest>, String> {
    let Some(source_duration_ms) = source_duration_ms.filter(|duration| *duration > 0) else {
        return Ok(clips.to_vec());
    };

    let adjusted = clips
        .iter()
        .filter_map(|clip| {
            if clip.start_ms >= source_duration_ms {
                return None;
            }
            let remaining_ms = source_duration_ms.saturating_sub(clip.start_ms);
            let duration_ms = clip.duration_ms.min(remaining_ms);
            if duration_ms <= 0 {
                return None;
            }

            Some(AutoCutVideoSliceClipRequest {
                start_ms: clip.start_ms,
                duration_ms,
                label: clip.label.clone(),
                output_file_name: clip.output_file_name.clone(),
                ..clone_video_slice_clip_evidence(clip)
            })
        })
        .collect::<Vec<_>>();

    if adjusted.is_empty() {
        return Err(
            "AutoCut video slicing found no clips inside the source media duration".to_string(),
        );
    }

    Ok(adjusted)
}

fn clone_video_slice_clip_evidence(
    clip: &AutoCutVideoSliceClipRequest,
) -> AutoCutVideoSliceClipRequest {
    AutoCutVideoSliceClipRequest {
        audio_mute_ranges: clip.audio_mute_ranges.clone(),
        source_start_ms: clip.source_start_ms,
        source_end_ms: clip.source_end_ms,
        speech_start_ms: clip.speech_start_ms,
        speech_end_ms: clip.speech_end_ms,
        boundary_padding_before_ms: clip.boundary_padding_before_ms,
        boundary_padding_after_ms: clip.boundary_padding_after_ms,
        transcript_text: clip.transcript_text.clone(),
        transcript_segments: clip.transcript_segments.clone(),
        transcript_segment_count: clip.transcript_segment_count,
        transcript_coverage_score: clip.transcript_coverage_score,
        speech_continuity_grade: clip.speech_continuity_grade.clone(),
        ..AutoCutVideoSliceClipRequest::default()
    }
}

fn sanitize_video_slice_label(label: &str, index: usize) -> String {
    let normalized = label
        .trim()
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || *character == '-'
                || *character == '_'
                || character.is_ascii_whitespace()
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        format!("Highlight {}", index + 1)
    } else {
        normalized.chars().take(60).collect()
    }
}

fn normalize_video_slice_output_file_name(
    requested_file_name: Option<&str>,
    label: &str,
    index: usize,
    output_format: &str,
) -> Option<String> {
    let source = requested_file_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(label);
    let normalized_source = source.replace('\\', "/");
    let without_directories = normalized_source
        .rsplit('/')
        .next()
        .unwrap_or(source)
        .trim();
    let without_extension = without_directories
        .strip_suffix(&format!(".{output_format}"))
        .or_else(|| {
            without_directories.strip_suffix(&format!(".{}", output_format.to_ascii_uppercase()))
        })
        .unwrap_or(without_directories);
    let stem = sanitize_autocut_file_name_stem(without_extension);
    let expected_prefix = format!("{:02}-", index + 1);
    let fallback = format!("video-slice-{:02}", index + 1);
    let normalized_stem = if stem.is_empty() { fallback } else { stem };
    let indexed_stem = if normalized_stem.starts_with(&expected_prefix) {
        normalized_stem
    } else {
        format!("{expected_prefix}{normalized_stem}")
    };
    let truncated = indexed_stem.chars().take(96).collect::<String>();

    Some(format!("{truncated}.{output_format}"))
}

fn sanitize_autocut_file_name_stem(value: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_was_separator = false;

    for character in value.trim().chars().flat_map(char::to_lowercase) {
        let is_safe_text = character.is_alphanumeric();
        if is_safe_text {
            sanitized.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator {
            sanitized.push('-');
            previous_was_separator = true;
        }
    }

    sanitized.trim_matches('-').to_string()
}

fn download_autocut_speech_transcription_model_in_root(
    root: &Path,
    request: AutoCutSpeechTranscriptionModelDownloadRequest,
    app: Option<&AppHandle>,
) -> Result<AutoCutSpeechTranscriptionModelDownloadResult, String> {
    validate_autocut_speech_transcription_model_download_request(&request)?;
    let download_urls = autocut_speech_transcription_model_download_urls(&request);
    let model_directory = root
        .join(AUTOCUT_MEDIA_MODEL_DIR)
        .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
    fs::create_dir_all(&model_directory)
        .map_err(|error| format!("create AutoCut speech model directory failed: {error}"))?;
    let canonical_model_directory = model_directory
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut speech model directory failed: {error}"))?;
    let target_path = canonical_model_directory.join(&request.file_name);
    if let Some(byte_size) =
        validate_existing_autocut_speech_transcription_model(&target_path, &request)?
    {
        emit_autocut_speech_transcription_model_download_progress(
            app,
            &request,
            "skipped",
            byte_size,
            Some(byte_size),
            Some(target_path.display().to_string()),
            None,
        );
        return Ok(AutoCutSpeechTranscriptionModelDownloadResult {
            provider_id: request.provider_id,
            preset_id: request.preset_id,
            file_name: request.file_name,
            model_path: target_path.display().to_string(),
            byte_size,
            downloaded: false,
            source_url: request.url.clone(),
            sha256: request.sha256,
        });
    }

    let temporary_path = canonical_model_directory.join(format!("{}.download", request.file_name));
    emit_autocut_speech_transcription_model_download_progress(
        app,
        &request,
        "started",
        0,
        None,
        None,
        None,
    );
    let mut download_errors = Vec::new();
    let mut successful_source_url = None::<String>;
    let mut byte_size = 0_u64;
    for source_url in &download_urls {
        let _ = fs::remove_file(&temporary_path);
        match download_autocut_speech_transcription_model_file_with_progress(
            &request,
            source_url,
            &temporary_path,
            app,
        ) {
            Ok(downloaded_byte_size) => {
                byte_size = downloaded_byte_size;
                successful_source_url = Some(source_url.clone());
                break;
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary_path);
                download_errors.push(format!("{source_url}: {error}"));
            }
        }
    }
    let Some(successful_source_url) = successful_source_url else {
        let error = format!(
            "download AutoCut speech transcription model failed for every trusted source: {}",
            download_errors.join("; ")
        );
        emit_autocut_speech_transcription_model_download_progress(
            app,
            &request,
            "failed",
            0,
            None,
            None,
            Some(error.clone()),
        );
        return Err(error);
    };
    if byte_size == 0 {
        let _ = fs::remove_file(&temporary_path);
        let error =
            "AutoCut speech transcription model download returned an empty file.".to_string();
        emit_autocut_speech_transcription_model_download_progress(
            app,
            &request,
            "failed",
            0,
            None,
            None,
            Some(error.clone()),
        );
        return Err(error);
    }
    verify_file_sha256_for_label(
        &temporary_path,
        &request.sha256,
        "AutoCut speech transcription model",
    )
    .map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        emit_autocut_speech_transcription_model_download_progress(
            app,
            &request,
            "failed",
            byte_size,
            Some(byte_size),
            None,
            Some(error.clone()),
        );
        error
    })?;
    fs::rename(&temporary_path, &target_path)
        .map_err(|error| format!("install AutoCut speech transcription model failed: {error}"))?;
    let canonical_model_path = target_path
        .canonicalize()
        .map_err(|error| format!("canonicalize installed AutoCut speech model failed: {error}"))?;
    emit_autocut_speech_transcription_model_download_progress(
        app,
        &request,
        "completed",
        byte_size,
        Some(byte_size),
        Some(canonical_model_path.display().to_string()),
        None,
    );

    Ok(AutoCutSpeechTranscriptionModelDownloadResult {
        provider_id: request.provider_id,
        preset_id: request.preset_id,
        file_name: request.file_name,
        model_path: canonical_model_path.display().to_string(),
        byte_size,
        downloaded: true,
        source_url: successful_source_url,
        sha256: request.sha256,
    })
}

fn validate_autocut_speech_transcription_model_download_request(
    request: &AutoCutSpeechTranscriptionModelDownloadRequest,
) -> Result<(), String> {
    if request.provider_id.trim() != "local-whisper-cli" {
        return Err(
            "AutoCut speech transcription model download only supports local-whisper-cli."
                .to_string(),
        );
    }
    if request.preset_id.trim().is_empty() {
        return Err("AutoCut speech transcription model download requires presetId.".to_string());
    }
    let file_name = request.file_name.trim();
    if file_name.is_empty() || file_name != request.file_name {
        return Err(
            "AutoCut speech transcription model download requires a normalized fileName."
                .to_string(),
        );
    }
    if Path::new(file_name)
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err("AutoCut speech transcription model download fileName must not contain path separators.".to_string());
    }
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS
        .iter()
        .any(|supported| *supported == extension)
    {
        return Err(format!(
            "AutoCut speech transcription model download fileName must use a supported model file extension: {}.",
            SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.join(", ")
        ));
    }
    if request.sha256.len() != 64
        || !request.sha256.chars().all(|character| character.is_ascii_hexdigit())
    {
        return Err(
            "AutoCut speech transcription model download requires a pinned SHA-256 model digest."
                .to_string(),
        );
    }

    let download_urls = autocut_speech_transcription_model_download_urls(request);
    if download_urls.is_empty() {
        return Err(
            "AutoCut speech transcription model download requires at least one trusted source URL."
                .to_string(),
        );
    }
    if download_urls[0] != request.url.trim() {
        return Err(
            "AutoCut speech transcription model download primary URL must be first."
                .to_string(),
        );
    }
    for source_url in download_urls {
        validate_autocut_speech_transcription_model_download_url(&source_url, file_name)?;
    }

    Ok(())
}

fn autocut_speech_transcription_model_download_urls(
    request: &AutoCutSpeechTranscriptionModelDownloadRequest,
) -> Vec<String> {
    let mut urls = vec![request.url.trim().to_string()];
    if let Some(mirror_urls) = &request.mirror_urls {
        for mirror_url in mirror_urls {
            let normalized = mirror_url.trim().to_string();
            if !normalized.is_empty() && !urls.iter().any(|url| url == &normalized) {
                urls.push(normalized);
            }
        }
    }
    urls.retain(|url| !url.is_empty());
    urls
}

fn validate_existing_autocut_speech_transcription_model(
    target_path: &Path,
    request: &AutoCutSpeechTranscriptionModelDownloadRequest,
) -> Result<Option<u64>, String> {
    if !target_path.exists() {
        return Ok(None);
    }

    let byte_size = fs::metadata(target_path)
        .map_err(|error| format!("read existing AutoCut speech model metadata failed: {error}"))?
        .len();
    if byte_size == 0 {
        let _ = fs::remove_file(target_path);
        return Ok(None);
    }

    match verify_file_sha256_for_label(
        target_path,
        &request.sha256,
        "existing AutoCut speech transcription model",
    ) {
        Ok(()) => Ok(Some(byte_size)),
        Err(error) => {
            fs::remove_file(target_path).map_err(|remove_error| {
                format!(
                    "remove invalid existing AutoCut speech transcription model failed after {error}: {remove_error}"
                )
            })?;
            Ok(None)
        }
    }
}

fn validate_autocut_speech_transcription_model_download_url(
    source_url: &str,
    file_name: &str,
) -> Result<(), String> {
    let parsed_url = Url::parse(source_url).map_err(|error| {
        format!("AutoCut speech transcription model download URL is invalid: {error}")
    })?;
    if parsed_url.scheme() != "https"
        || !parsed_url
            .host_str()
            .map(|host| TRUSTED_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_HOSTS.contains(&host))
            .unwrap_or(false)
    {
        return Err("AutoCut speech transcription model download URL must use a trusted HTTPS Hugging Face source.".to_string());
    }
    let path_segments = parsed_url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    let url_file_name = path_segments.last().copied().unwrap_or("");
    if url_file_name != file_name {
        return Err(
            "AutoCut speech transcription model download URL file name must match fileName."
                .to_string(),
        );
    }
    if path_segments.len() < 5
        || path_segments[0] != "ggerganov"
        || path_segments[1] != "whisper.cpp"
        || path_segments[2] != "resolve"
        || path_segments[3] != "main"
    {
        return Err("AutoCut speech transcription model download URL must target the trusted ggerganov/whisper.cpp model path.".to_string());
    }
    Ok(())
}

fn download_autocut_speech_transcription_model_file_with_progress(
    request: &AutoCutSpeechTranscriptionModelDownloadRequest,
    source_url: &str,
    target_path: &Path,
    app: Option<&AppHandle>,
) -> Result<u64, String> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|error| format!("build AutoCut speech model download client failed: {error}"))?;
    let mut response = client
        .get(source_url)
        .send()
        .map_err(|error| format!("download AutoCut speech transcription model failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "download AutoCut speech transcription model failed with HTTP status {}",
            response.status()
        ));
    }

    let mut output = fs::File::create(target_path).map_err(|error| {
        format!("create AutoCut speech transcription model temp file failed: {error}")
    })?;
    let total_bytes = response.content_length();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    let mut last_emitted_progress = None::<u8>;
    loop {
        let read_bytes = response.read(&mut buffer).map_err(|error| {
            format!("read AutoCut speech transcription model download failed: {error}")
        })?;
        if read_bytes == 0 {
            break;
        }
        output.write_all(&buffer[..read_bytes]).map_err(|error| {
            format!("write AutoCut speech transcription model temp file failed: {error}")
        })?;
        byte_size += read_bytes as u64;
        if byte_size > MAX_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES {
            let _ = fs::remove_file(target_path);
            return Err(
                "AutoCut speech transcription model download exceeds the maximum allowed size."
                    .to_string(),
            );
        }

        let progress = calculate_autocut_speech_model_download_progress(byte_size, total_bytes);
        if total_bytes.is_none()
            || progress >= 100
            || last_emitted_progress.map(|last| progress.saturating_sub(last) >= 2).unwrap_or(true)
        {
            emit_autocut_speech_transcription_model_download_progress_for_source(
                app,
                request,
                source_url,
                "downloading",
                byte_size,
                total_bytes,
                None,
                None,
            );
            last_emitted_progress = Some(progress);
        }
    }
    if byte_size > MAX_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES {
        let _ = fs::remove_file(target_path);
        return Err(
            "AutoCut speech transcription model download exceeds the maximum allowed size."
                .to_string(),
        );
    }

    Ok(byte_size)
}

fn emit_autocut_speech_transcription_model_download_progress(
    app: Option<&AppHandle>,
    request: &AutoCutSpeechTranscriptionModelDownloadRequest,
    phase: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    model_path: Option<String>,
    error_message: Option<String>,
) {
    emit_autocut_speech_transcription_model_download_progress_for_source(
        app,
        request,
        &request.url,
        phase,
        downloaded_bytes,
        total_bytes,
        model_path,
        error_message,
    );
}

fn emit_autocut_speech_transcription_model_download_progress_for_source(
    app: Option<&AppHandle>,
    request: &AutoCutSpeechTranscriptionModelDownloadRequest,
    source_url: &str,
    phase: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    model_path: Option<String>,
    error_message: Option<String>,
) {
    let Some(app) = app else {
        return;
    };
    let event = AutoCutSpeechTranscriptionModelDownloadProgressEvent {
        provider_id: request.provider_id.clone(),
        preset_id: request.preset_id.clone(),
        file_name: request.file_name.clone(),
        phase: phase.to_string(),
        downloaded_bytes,
        total_bytes,
        progress: Some(calculate_autocut_speech_model_download_progress(
            downloaded_bytes,
            total_bytes,
        )),
        model_path,
        source_url: Some(source_url.to_string()),
        error_message,
    };
    let _ = app.emit(
        AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS_EVENT,
        event,
    );
}

fn calculate_autocut_speech_model_download_progress(
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) -> u8 {
    let Some(total_bytes) = total_bytes.filter(|value| *value > 0) else {
        return 0;
    };
    let percent = downloaded_bytes.saturating_mul(100) / total_bytes;
    percent.min(100) as u8
}

fn verify_file_sha256_for_label(
    path: &Path,
    expected_sha256: &str,
    label: &str,
) -> Result<(), String> {
    let digest = calculate_file_sha256(path)?;
    if !digest.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "{label} checksum mismatch: expected {expected_sha256}, actual {digest}."
        ));
    }

    Ok(())
}

fn calculate_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("open file for SHA-256 validation failed: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read_bytes = file
            .read(&mut buffer)
            .map_err(|error| format!("read file for SHA-256 validation failed: {error}"))?;
        if read_bytes == 0 {
            break;
        }
        hasher.update(&buffer[..read_bytes]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn import_autocut_media_file_in_root(
    connection: &Connection,
    root: &Path,
    request: AutoCutMediaImportRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutMediaImportResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;
    let canonical_input_root = input_root
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut media input directory failed: {error}"))?;
    let canonical_media_root = root
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut media root failed: {error}"))?;

    let source_path = ensure_safe_import_source_path(Path::new(&request.source_path))?;
    if source_path.starts_with(canonical_media_root) {
        return Err(
            "media import source path must be outside the AutoCut media sandbox".to_string(),
        );
    }

    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "resolve media import source file name failed: {}",
                source_path.display()
            )
        })?;
    let source_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let asset_uuid = autocut_uuid("media-asset")?;
    let sandbox_file_name = if source_extension.is_empty() {
        asset_uuid.clone()
    } else {
        format!("{asset_uuid}.{source_extension}")
    };
    let sandbox_path = canonical_input_root.join(sandbox_file_name);

    fs::copy(&source_path, &sandbox_path).map_err(|error| {
        format!("copy media import source into AutoCut sandbox failed: {error}")
    })?;

    let sandbox_path = ensure_safe_media_path(&canonical_input_root, &sandbox_path)?;
    let metadata = fs::metadata(&sandbox_path)
        .map_err(|error| format!("read imported media metadata failed: {error}"))?;
    if metadata.len() == 0 {
        return Err("imported media file is empty".to_string());
    }

    let media_type = classify_media_type(&source_extension).to_string();
    let mime_type = media_mime_type(&source_extension, &media_type).to_string();
    let duration_ms = if media_type == "video" {
        read_ffmpeg_media_duration_millis(toolchain, &sandbox_path).ok()
    } else {
        None
    };
    connection
        .execute(
            r#"
            INSERT INTO media_asset (
                uuid,
                tenant_id,
                organization_id,
                owner_type,
                owner_id,
                name,
                asset_type,
                source_uri,
                mime_type,
                byte_size,
                status,
                metadata_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                'local_user',
                0,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                asset_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                source_name,
                MEDIA_ASSET_TYPE_IMPORTED,
                sandbox_path.display().to_string(),
                mime_type,
                u64_to_i64(metadata.len(), "media_asset.byte_size")?,
                OPS_STATUS_COMPLETED,
                json!({
                    "sourcePath": source_path.display().to_string(),
                    "mediaType": media_type,
                    "durationMs": duration_ms,
                    "importedBy": "autocut_import_media_file"
                })
                .to_string(),
            ],
        )
        .map_err(|error| format!("insert AutoCut media_asset failed: {error}"))?;

    Ok(AutoCutMediaImportResult {
        asset_uuid,
        sandbox_path: sandbox_path.display().to_string(),
        byte_size: metadata.len(),
        name: source_name,
        media_type,
        mime_type,
        duration_ms,
    })
}

fn describe_autocut_local_media_file_from_path(
    source_path: &Path,
    toolchain: Option<&AutoCutFfmpegToolchain>,
) -> Result<AutoCutLocalMediaFileDescription, String> {
    let source_path = ensure_safe_import_source_path(source_path)?;
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "resolve local media file name failed: {}",
                source_path.display()
            )
        })?;
    let source_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let metadata = fs::metadata(&source_path)
        .map_err(|error| format!("read local media file metadata failed: {error}"))?;
    let media_type = classify_media_type(&source_extension).to_string();
    let mime_type = media_mime_type(&source_extension, &media_type).to_string();
    let duration_ms = if media_type == "video" {
        toolchain.and_then(|ffmpeg_toolchain| {
            read_ffmpeg_media_duration_millis(ffmpeg_toolchain, &source_path).ok()
        })
    } else {
        None
    };

    Ok(AutoCutLocalMediaFileDescription {
        source_path: source_path.display().to_string(),
        byte_size: metadata.len(),
        name: source_name,
        media_type,
        mime_type,
        duration_ms,
    })
}

fn normalize_autocut_media_file_select_types(
    media_types: &[String],
) -> Result<Vec<String>, String> {
    let mut normalized_types = Vec::new();
    for media_type in media_types {
        let normalized = media_type.trim().to_ascii_lowercase();
        if normalized != "audio" && normalized != "video" {
            return Err(
                "AutoCut local media chooser mediaTypes must contain only audio or video"
                    .to_string(),
            );
        }
        if !normalized_types.contains(&normalized) {
            normalized_types.push(normalized);
        }
    }

    if normalized_types.is_empty() {
        normalized_types.push("audio".to_string());
        normalized_types.push("video".to_string());
    }

    Ok(normalized_types)
}

fn extract_autocut_audio_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutAudioExtractionRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutAudioExtractionResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let format = normalize_audio_format(&request.output_format)?;
    let task_uuid = autocut_uuid("ops-task")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "outputFormat": format.clone()
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "audioExtraction",
        task_type: OPS_TASK_TYPE_AUDIO_EXTRACTION,
        stage_type: OPS_STAGE_TYPE_AUDIO_EXTRACTION,
        artifact_type: MEDIA_ARTIFACT_TYPE_AUDIO,
        artifact_name_suffix: format!("audio.{format}"),
        mime_type: audio_mime_type(&format),
        input_json,
        failure_error_code: "FFMPEG_AUDIO_EXTRACTION_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let output_path = task_output_dir.join(format!(
        "audio-extract-{}.{}",
        monotonic_artifact_suffix()?,
        format
    ));
    let extraction = run_ffmpeg_audio_extract(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &output_path,
        &format,
        &worker_lease,
    );
    match extraction {
        Ok(extraction_result) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            let operation_output = AutoCutMediaOperationOutput {
                artifact_path: extraction_result.artifact_path.clone(),
                task_output_dir: extraction_result.task_output_dir.clone(),
                byte_size: extraction_result.byte_size,
                format: extraction_result.format.clone(),
                ffmpeg_executable: extraction_result.ffmpeg_executable.clone(),
            };
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
            )?;
            insert_media_artifact(
                connection,
                &artifact_uuid,
                &task_uuid,
                &asset,
                &operation_output,
                &spec,
            )?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "artifactUuid": artifact_uuid,
                    "artifactPath": extraction_result.artifact_path.clone(),
                    "taskOutputDir": extraction_result.task_output_dir.clone(),
                    "byteSize": extraction_result.byte_size
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutAudioExtractionResult {
                artifact_uuid,
                task_uuid,
                source_asset_uuid: asset.uuid,
                artifact_path: extraction_result.artifact_path,
                task_output_dir: extraction_result.task_output_dir,
                byte_size: extraction_result.byte_size,
                format: extraction_result.format,
                ffmpeg_executable: extraction_result.ffmpeg_executable,
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn generate_autocut_gif_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutVideoGifRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVideoGifResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let fps = normalize_video_gif_fps(&request.fps)?;
    let (resolution, height) = normalize_video_gif_resolution(&request.resolution)?;
    let task_uuid = autocut_uuid("ops-task")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "fps": fps.clone(),
            "resolution": resolution.clone(),
            "dither": request.dither
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "videoGif",
        task_type: OPS_TASK_TYPE_VIDEO_GIF,
        stage_type: OPS_STAGE_TYPE_VIDEO_GIF,
        artifact_type: MEDIA_ARTIFACT_TYPE_GIF,
        artifact_name_suffix: "gif.gif".to_string(),
        mime_type: "image/gif",
        input_json,
        failure_error_code: "FFMPEG_VIDEO_GIF_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "fps": fps.clone(),
            "resolution": resolution.clone(),
            "dither": request.dither
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let output_path =
        task_output_dir.join(format!("video-gif-{}.gif", monotonic_artifact_suffix()?));
    let generation = run_ffmpeg_video_gif(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &output_path,
        &fps,
        height,
        request.dither,
        &worker_lease,
    );
    match generation {
        Ok(operation_output) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
            )?;
            insert_media_artifact(
                connection,
                &artifact_uuid,
                &task_uuid,
                &asset,
                &operation_output,
                &spec,
            )?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "artifactUuid": artifact_uuid,
                    "artifactPath": operation_output.artifact_path.clone(),
                    "taskOutputDir": operation_output.task_output_dir.clone(),
                    "byteSize": operation_output.byte_size
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutVideoGifResult {
                artifact_uuid,
                task_uuid,
                source_asset_uuid: asset.uuid,
                artifact_path: operation_output.artifact_path,
                task_output_dir: operation_output.task_output_dir,
                byte_size: operation_output.byte_size,
                format: operation_output.format,
                ffmpeg_executable: operation_output.ffmpeg_executable,
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn slice_autocut_video_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutVideoSliceRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVideoSliceResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let output_format = normalize_video_slice_format(&request.output_format)?;
    let clips = normalize_video_slice_clips(&request.clips)?;
    let render_profile = normalize_video_slice_render_profile(request.render_profile)?;
    let subtitle_format =
        normalize_video_slice_subtitle_format(request.subtitle_format.as_deref())?;
    let subtitle_segments = normalize_video_slice_subtitle_segments(request.subtitle_segments);
    let subtitle_mode = normalize_video_slice_subtitle_mode(
        request.subtitle_mode.as_deref(),
        subtitle_format.as_deref(),
        !subtitle_segments.is_empty(),
    )?;
    let source_duration_ms = read_ffmpeg_media_duration_millis(toolchain, &input_path).ok();
    let apply_audio_noise_reduction =
        request.noise_reduction && ffmpeg_media_has_audio_stream(toolchain, &input_path);
    let task_uuid = autocut_uuid("ops-task")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "outputFormat": output_format.clone(),
            "renderProfile": render_profile.clone(),
            "noiseReduction": request.noise_reduction,
            "clips": clips,
            "requestedClips": clips,
            "subtitleFormat": subtitle_format,
            "subtitleMode": subtitle_mode.as_str(),
            "subtitleStyleId": request.subtitle_style_id,
            "subtitleSegments": subtitle_segments.clone()
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "videoSlice",
        task_type: OPS_TASK_TYPE_VIDEO_SLICE,
        stage_type: OPS_STAGE_TYPE_VIDEO_SLICE,
        artifact_type: MEDIA_ARTIFACT_TYPE_VIDEO_SLICE,
        artifact_name_suffix: "slice.mp4".to_string(),
        mime_type: "video/mp4",
        input_json,
        failure_error_code: "FFMPEG_VIDEO_SLICE_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let clips = match adjust_video_slice_clips_for_source_duration(&clips, source_duration_ms) {
        Ok(clips) => clips,
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            return Err(error);
        }
    };
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "outputFormat": output_format.clone(),
            "clipCount": clips.len()
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let slicing = run_ffmpeg_video_slices(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &task_output_dir,
        &clips,
        &output_format,
        render_profile.as_ref(),
        apply_audio_noise_reduction,
        subtitle_format.as_deref(),
        subtitle_mode,
        &subtitle_segments,
        &worker_lease,
    );
    match slicing {
        Ok(slice_outputs) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            let slice_artifacts = slice_outputs
                .into_iter()
                .enumerate()
                .map(|(index, slice_output)| {
                    let artifact_uuid = autocut_uuid("media-artifact")?;
                    let thumbnail_artifact_uuid = autocut_uuid("media-artifact")?;
                    let subtitle_artifact_uuid = slice_output
                        .subtitle_output
                        .as_ref()
                        .map(|_| autocut_uuid("media-artifact"))
                        .transpose()?;
                    let artifact_result = AutoCutVideoSliceArtifactResult {
                        artifact_uuid: artifact_uuid.clone(),
                        artifact_path: slice_output.video_output.artifact_path.clone(),
                        thumbnail_artifact_uuid: thumbnail_artifact_uuid.clone(),
                        thumbnail_artifact_path: slice_output
                            .thumbnail_output
                            .artifact_path
                            .clone(),
                        subtitle_artifact_uuid: subtitle_artifact_uuid.clone(),
                        subtitle_artifact_path: slice_output
                            .subtitle_output
                            .as_ref()
                            .map(|subtitle| subtitle.artifact_path.clone()),
                        task_output_dir: slice_output.video_output.task_output_dir.clone(),
                        byte_size: slice_output.video_output.byte_size,
                        thumbnail_byte_size: slice_output.thumbnail_output.byte_size,
                        subtitle_byte_size: slice_output
                            .subtitle_output
                            .as_ref()
                            .map(|subtitle| subtitle.byte_size),
                        subtitle_format: slice_output
                            .subtitle_output
                            .as_ref()
                            .map(|subtitle| subtitle.format.clone()),
                        format: slice_output.video_output.format.clone(),
                        start_ms: slice_output.clip.start_ms,
                        duration_ms: slice_output.clip.duration_ms,
                        label: slice_output.clip.label.clone(),
                        source_start_ms: slice_output.clip.source_start_ms,
                        source_end_ms: slice_output.clip.source_end_ms,
                        speech_start_ms: slice_output.clip.speech_start_ms,
                        speech_end_ms: slice_output.clip.speech_end_ms,
                        boundary_padding_before_ms: slice_output.clip.boundary_padding_before_ms,
                        boundary_padding_after_ms: slice_output.clip.boundary_padding_after_ms,
                        transcript_text: slice_output.clip.transcript_text.clone(),
                        transcript_segments: slice_output.clip.transcript_segments.clone(),
                        transcript_segment_count: slice_output.clip.transcript_segment_count,
                        transcript_coverage_score: slice_output.clip.transcript_coverage_score,
                        speech_continuity_grade: slice_output.clip.speech_continuity_grade.clone(),
                    };
                    insert_media_slice_artifact(
                        connection,
                        &artifact_uuid,
                        &task_uuid,
                        &asset,
                        &slice_output.video_output,
                        &spec,
                        &slice_output.clip,
                        index,
                    )?;
                    insert_media_slice_thumbnail_artifact(
                        connection,
                        &thumbnail_artifact_uuid,
                        &task_uuid,
                        &asset,
                        &slice_output.thumbnail_output,
                        &spec,
                        &slice_output.clip,
                        index,
                        &artifact_uuid,
                    )?;
                    if let (Some(subtitle_uuid), Some(subtitle_output)) = (
                        subtitle_artifact_uuid.as_deref(),
                        slice_output.subtitle_output.as_ref(),
                    ) {
                        insert_media_slice_subtitle_artifact(
                            connection,
                            subtitle_uuid,
                            &task_uuid,
                            &asset,
                            subtitle_output,
                            &spec,
                            &slice_output.clip,
                            index,
                            &artifact_uuid,
                        )?;
                    }
                    Ok(artifact_result)
                })
                .collect::<Result<Vec<_>, String>>()?;
            complete_ops_slice_task(connection, &task_uuid, &asset.uuid, &slice_artifacts)?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "taskOutputDir": task_output_dir.display().to_string(),
                    "sliceCount": slice_artifacts.len(),
                    "sliceResults": slice_artifacts
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutVideoSliceResult {
                task_uuid,
                source_asset_uuid: asset.uuid,
                task_output_dir: task_output_dir.display().to_string(),
                slices: slice_artifacts,
                ffmpeg_executable: toolchain.executable.clone(),
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn transcribe_autocut_media_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutSpeechTranscriptionRequest,
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    speech_toolchain: &AutoCutSpeechToolchain,
) -> Result<AutoCutSpeechTranscriptionResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let language = normalize_speech_transcription_language(request.language.as_deref())?;
    let task_uuid = autocut_uuid("ops-task")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "language": language.clone()
        }),
    );
    if let Some(provider_id) = normalize_path_text(request.provider_id.as_deref()) {
        input_json["providerId"] = json!(provider_id);
    }
    if let Some(executable_path) = normalize_path_text(request.executable_path.as_deref()) {
        input_json["executablePath"] = json!(executable_path);
    }
    if let Some(model_path) = normalize_path_text(request.model_path.as_deref()) {
        input_json["modelPath"] = json!(model_path);
    }
    if let Some(workflow_purpose) = normalize_path_text(request.workflow_purpose.as_deref()) {
        input_json["workflowPurpose"] = json!(workflow_purpose);
    }
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "speechTranscription",
        task_type: OPS_TASK_TYPE_SPEECH_TRANSCRIPTION,
        stage_type: OPS_STAGE_TYPE_SPEECH_TRANSCRIPTION,
        artifact_type: MEDIA_ARTIFACT_TYPE_TRANSCRIPT,
        artifact_name_suffix: "transcript.json".to_string(),
        mime_type: "application/json",
        input_json,
        failure_error_code: "LOCAL_SPEECH_TRANSCRIPTION_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "language": language.clone()
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "speech-transcription-prepared"
        }),
    )?;

    let transcription = run_local_speech_transcription(
        connection,
        &task_uuid,
        ffmpeg_toolchain,
        speech_toolchain,
        &input_path,
        &task_output_dir,
        &language,
        &worker_lease,
    );
    match transcription {
        Ok(result) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            let transcript_byte_size = fs::metadata(&result.transcript_path)
                .map_err(|error| {
                    format!("read AutoCut transcript artifact metadata failed: {error}")
                })?
                .len();
            let operation_output = AutoCutMediaOperationOutput {
                artifact_path: result.transcript_path.clone(),
                task_output_dir: result.task_output_dir.clone(),
                byte_size: transcript_byte_size,
                format: "json".to_string(),
                ffmpeg_executable: result.ffmpeg_executable.clone(),
            };
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_transcription_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &result,
                transcript_byte_size,
            )?;
            insert_media_artifact(
                connection,
                &artifact_uuid,
                &task_uuid,
                &asset,
                &operation_output,
                &spec,
            )?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "artifactUuid": artifact_uuid,
                    "transcriptPath": result.transcript_path.clone(),
                    "taskOutputDir": result.task_output_dir.clone(),
                    "segmentCount": result.segments.len()
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutSpeechTranscriptionResult {
                artifact_uuid,
                task_uuid,
                source_asset_uuid: asset.uuid,
                transcript_path: result.transcript_path,
                task_output_dir: result.task_output_dir,
                language: result.language,
                segments: result.segments,
                text: result.text,
                ffmpeg_executable: result.ffmpeg_executable,
                speech_executable: result.speech_executable,
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn compress_autocut_video_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutVideoCompressRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVideoCompressResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let original_byte_size = fs::metadata(&input_path)
        .map_err(|error| format!("read source video metadata failed: {error}"))?
        .len();
    let compression_mode = normalize_video_compress_mode(&request.compression_mode)?;
    let (crf, preset) = video_compress_encoding_profile(&compression_mode)?;
    let task_uuid = autocut_uuid("ops-task")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "compressionMode": compression_mode.clone(),
            "crf": crf,
            "preset": preset
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "videoCompress",
        task_type: OPS_TASK_TYPE_VIDEO_COMPRESS,
        stage_type: OPS_STAGE_TYPE_VIDEO_COMPRESS,
        artifact_type: MEDIA_ARTIFACT_TYPE_VIDEO_COMPRESSED,
        artifact_name_suffix: "compressed.mp4".to_string(),
        mime_type: "video/mp4",
        input_json,
        failure_error_code: "FFMPEG_VIDEO_COMPRESS_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "compressionMode": compression_mode.clone()
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let output_path = task_output_dir.join(format!(
        "video-compress-{}.mp4",
        monotonic_artifact_suffix()?
    ));
    let compression = run_ffmpeg_video_compress(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &output_path,
        crf,
        preset,
        &worker_lease,
    );
    match compression {
        Ok(operation_output) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
            )?;
            insert_media_artifact(
                connection,
                &artifact_uuid,
                &task_uuid,
                &asset,
                &operation_output,
                &spec,
            )?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "artifactUuid": artifact_uuid,
                    "artifactPath": operation_output.artifact_path.clone(),
                    "taskOutputDir": operation_output.task_output_dir.clone(),
                    "byteSize": operation_output.byte_size,
                    "originalByteSize": original_byte_size
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutVideoCompressResult {
                artifact_uuid,
                task_uuid,
                source_asset_uuid: asset.uuid,
                artifact_path: operation_output.artifact_path,
                task_output_dir: operation_output.task_output_dir,
                byte_size: operation_output.byte_size,
                original_byte_size,
                format: operation_output.format,
                ffmpeg_executable: operation_output.ffmpeg_executable,
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn convert_autocut_video_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutVideoConvertRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVideoConvertResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let target_format = normalize_video_convert_format(&request.target_format)?;
    let video_codec = normalize_video_convert_codec(&request.video_codec, "video", &target_format)?;
    let audio_codec = normalize_video_convert_codec(&request.audio_codec, "audio", &target_format)?;
    let target_height = normalize_video_convert_resolution(&request.resolution)?;
    let task_uuid = autocut_uuid("ops-task")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "targetFormat": target_format.clone(),
            "videoCodec": video_codec.clone(),
            "audioCodec": audio_codec.clone(),
            "resolution": request.resolution
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "videoConvert",
        task_type: OPS_TASK_TYPE_VIDEO_CONVERT,
        stage_type: OPS_STAGE_TYPE_VIDEO_CONVERT,
        artifact_type: MEDIA_ARTIFACT_TYPE_VIDEO_CONVERTED,
        artifact_name_suffix: format!("converted.{target_format}"),
        mime_type: video_convert_mime_type(&target_format),
        input_json,
        failure_error_code: "FFMPEG_VIDEO_CONVERT_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "targetFormat": target_format.clone()
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let output_path = task_output_dir.join(format!(
        "video-convert-{}.{}",
        monotonic_artifact_suffix()?,
        target_format
    ));
    let conversion = run_ffmpeg_video_convert(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &output_path,
        &target_format,
        &video_codec,
        &audio_codec,
        target_height,
        &worker_lease,
    );
    match conversion {
        Ok(operation_output) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
            )?;
            insert_media_artifact(
                connection,
                &artifact_uuid,
                &task_uuid,
                &asset,
                &operation_output,
                &spec,
            )?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "artifactUuid": artifact_uuid,
                    "artifactPath": operation_output.artifact_path.clone(),
                    "taskOutputDir": operation_output.task_output_dir.clone(),
                    "byteSize": operation_output.byte_size,
                    "format": operation_output.format.clone()
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutVideoConvertResult {
                artifact_uuid,
                task_uuid,
                source_asset_uuid: asset.uuid,
                artifact_path: operation_output.artifact_path,
                task_output_dir: operation_output.task_output_dir,
                byte_size: operation_output.byte_size,
                format: operation_output.format,
                ffmpeg_executable: operation_output.ffmpeg_executable,
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn enhance_autocut_video_from_asset_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutVideoEnhanceRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVideoEnhanceResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let asset = read_media_asset(connection, &request.asset_uuid)?;
    let input_root = root.join(AUTOCUT_MEDIA_INPUT_DIR);
    fs::create_dir_all(&input_root)
        .map_err(|error| format!("create AutoCut media input directory failed: {error}"))?;

    let input_path = ensure_safe_media_path(&input_root, Path::new(&asset.source_uri))?;
    if !input_path.is_file() {
        return Err(format!(
            "registered source media file does not exist under AutoCut media inputs: {}",
            input_path.display()
        ));
    }

    let (target_resolution, target_height) =
        normalize_video_enhance_resolution(&request.target_resolution)?;
    let enhance_mode = normalize_video_enhance_mode(&request.enhance_mode)?;
    let frame_rate = normalize_video_enhance_frame_rate(&request.frame_rate)?;
    let task_uuid = autocut_uuid("ops-task")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "targetResolution": target_resolution.clone(),
            "enhanceMode": enhance_mode.clone(),
            "frameRate": frame_rate.clone().unwrap_or_else(|| "original".to_string())
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "videoEnhance",
        task_type: OPS_TASK_TYPE_VIDEO_ENHANCE,
        stage_type: OPS_STAGE_TYPE_VIDEO_ENHANCE,
        artifact_type: MEDIA_ARTIFACT_TYPE_VIDEO_ENHANCED,
        artifact_name_suffix: "enhanced.mp4".to_string(),
        mime_type: "video/mp4",
        input_json,
        failure_error_code: "FFMPEG_VIDEO_ENHANCE_FAILED",
    };
    insert_ops_task(connection, &task_uuid, &asset.uuid, &spec)?;
    let worker_lease = begin_native_media_task_worker_lease(connection, &task_uuid, &spec)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_STARTED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "targetResolution": target_resolution.clone(),
            "enhanceMode": enhance_mode.clone()
        })
        .to_string(),
    )?;
    record_ops_task_progress(
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let output_path = task_output_dir.join(format!(
        "video-enhance-{}.mp4",
        monotonic_artifact_suffix()?
    ));
    let enhancement = run_ffmpeg_video_enhance(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &output_path,
        target_height,
        &enhance_mode,
        frame_rate.as_deref(),
        &worker_lease,
    );
    match enhancement {
        Ok(operation_output) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
            )?;
            insert_media_artifact(
                connection,
                &artifact_uuid,
                &task_uuid,
                &asset,
                &operation_output,
                &spec,
            )?;
            insert_ops_task_event(
                connection,
                &task_uuid,
                OPS_TASK_EVENT_TYPE_COMPLETED,
                json!({
                    "operation": spec.operation,
                    "artifactUuid": artifact_uuid,
                    "artifactPath": operation_output.artifact_path.clone(),
                    "taskOutputDir": operation_output.task_output_dir.clone(),
                    "byteSize": operation_output.byte_size
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(AutoCutVideoEnhanceResult {
                artifact_uuid,
                task_uuid,
                source_asset_uuid: asset.uuid,
                artifact_path: operation_output.artifact_path,
                task_output_dir: operation_output.task_output_dir,
                byte_size: operation_output.byte_size,
                format: operation_output.format,
                ffmpeg_executable: operation_output.ffmpeg_executable,
            })
        }
        Err(error) => {
            record_failed_or_canceled_operation(
                connection,
                &task_uuid,
                &asset,
                &spec,
                error.as_str(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "failed")?;
            Err(error)
        }
    }
}

fn run_autocut_audio_smoke_in_root_with_toolchain(
    root: &Path,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutAudioExtractionResult, String> {
    let smoke_task_uuid = autocut_uuid("ops-task-smoke")?;
    let task_output_dir = autocut_task_output_dir(root, &smoke_task_uuid)?;
    fs::create_dir_all(&task_output_dir).map_err(|error| {
        format!("create AutoCut audio smoke artifact directory failed: {error}")
    })?;
    let output_path =
        task_output_dir.join(format!("audio-smoke-{}.wav", monotonic_artifact_suffix()?));

    let mut result = run_ffmpeg_sine_smoke(toolchain, &output_path)?;
    result.task_uuid = smoke_task_uuid;
    result.task_output_dir = task_output_dir.display().to_string();
    Ok(result)
}

fn run_ffmpeg_sine_smoke(
    toolchain: &AutoCutFfmpegToolchain,
    output_path: &Path,
) -> Result<AutoCutAudioExtractionResult, String> {
    let output = Command::new(&toolchain.executable)
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=0.2",
            "-vn",
            "-acodec",
            "pcm_s16le",
        ])
        .arg(output_path)
        .output()
        .map_err(|error| format!("run AutoCut FFmpeg audio smoke failed: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg audio smoke failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_audio_result(output_path, "wav", toolchain.executable.clone())
}

fn run_tracked_ffmpeg_command_with_progress(
    task_uuid: &str,
    command: &mut Command,
    operation_label: &str,
    mut on_progress: impl FnMut(i64) -> Result<(), String>,
) -> Result<Output, String> {
    let tracked_child = spawn_tracked_native_media_command(
        task_uuid,
        command,
        &format!("FFmpeg {operation_label}"),
    )?;
    let output = wait_for_tracked_ffmpeg_output(&tracked_child, &mut on_progress);
    remove_tracked_native_media_process(task_uuid)?;
    output
}

fn run_tracked_native_media_command(
    task_uuid: &str,
    command: &mut Command,
    operation_label: &str,
    mut on_poll: impl FnMut() -> Result<(), String>,
) -> Result<Output, String> {
    let tracked_child = spawn_tracked_native_media_command(task_uuid, command, operation_label)?;
    let output = wait_for_tracked_native_media_output(&tracked_child, &mut on_poll);
    remove_tracked_native_media_process(task_uuid)?;
    output
}

fn spawn_tracked_native_media_command(
    task_uuid: &str,
    command: &mut Command,
    operation_label: &str,
) -> Result<Arc<Mutex<Child>>, String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|error| format!("run AutoCut native media {operation_label} failed: {error}"))?;
    let tracked_child = Arc::new(Mutex::new(child));
    {
        let mut registry = tracked_native_media_processes().lock().map_err(|error| {
            format!("lock AutoCut native media process registry failed: {error}")
        })?;
        registry.insert(
            normalized_task_uuid.clone(),
            AutoCutTrackedNativeMediaProcess {
                task_uuid: normalized_task_uuid.clone(),
                child: Arc::clone(&tracked_child),
            },
        );
    }

    Ok(tracked_child)
}

fn append_ffmpeg_progress_output_args(command: &mut Command) {
    command.args(["-progress", "pipe:1", "-nostats"]);
}

fn wait_for_tracked_ffmpeg_output(
    tracked_child: &Arc<Mutex<Child>>,
    on_progress: &mut impl FnMut(i64) -> Result<(), String>,
) -> Result<Output, String> {
    let mut stdout = tracked_child
        .lock()
        .map_err(|error| format!("lock AutoCut FFmpeg process stdout failed: {error}"))?
        .stdout
        .take();
    let mut stderr = tracked_child
        .lock()
        .map_err(|error| format!("lock AutoCut FFmpeg process stderr failed: {error}"))?
        .stderr
        .take();

    let (pipe_event_sender, pipe_event_receiver) = mpsc::channel::<AutoCutFfmpegPipeEvent>();
    let stdout_pipe_event_sender = pipe_event_sender.clone();
    let stdout_reader = thread::spawn(move || {
        read_child_pipe_by_line(&mut stdout, move |line| {
            if let Some(progress_time_ms) = parse_ffmpeg_progress_time_millis(line) {
                let _ = stdout_pipe_event_sender
                    .send(AutoCutFfmpegPipeEvent::ProgressTime(progress_time_ms));
            }
        })
    });
    let stderr_reader = thread::spawn(move || {
        read_child_pipe_by_line(&mut stderr, move |line| {
            if let Some(duration_ms) = parse_ffmpeg_duration_millis(line) {
                let _ = pipe_event_sender.send(AutoCutFfmpegPipeEvent::Duration(duration_ms));
            }
        })
    });
    let mut progress_state = AutoCutFfmpegProgressStreamState::default();

    let status = loop {
        if let Err(error) =
            drain_ffmpeg_progress_updates(&pipe_event_receiver, &mut progress_state, on_progress)
        {
            return Err(stop_and_join_tracked_native_media_child_after_error(
                tracked_child,
                stdout_reader,
                stderr_reader,
                "FFmpeg progress callback failure",
                error,
            ));
        }
        if let Some(status) = tracked_child
            .lock()
            .map_err(|error| format!("lock AutoCut FFmpeg process wait failed: {error}"))?
            .try_wait()
            .map_err(|error| format!("wait for AutoCut FFmpeg process failed: {error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(20));
    };
    if let Err(error) =
        drain_ffmpeg_progress_updates(&pipe_event_receiver, &mut progress_state, on_progress)
    {
        return Err(stop_and_join_tracked_native_media_child_after_error(
            tracked_child,
            stdout_reader,
            stderr_reader,
            "FFmpeg final progress callback failure",
            error,
        ));
    }
    let stdout = join_child_pipe_reader(stdout_reader, "AutoCut FFmpeg stdout")?;
    if let Err(error) =
        drain_ffmpeg_progress_updates(&pipe_event_receiver, &mut progress_state, on_progress)
    {
        let stderr_cleanup = join_child_pipe_reader(stderr_reader, "AutoCut FFmpeg stderr").err();
        return Err(append_cleanup_diagnostics(
            error,
            stderr_cleanup.into_iter(),
        ));
    }
    let stderr = join_child_pipe_reader(stderr_reader, "AutoCut FFmpeg stderr")?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn wait_for_tracked_native_media_output(
    tracked_child: &Arc<Mutex<Child>>,
    on_poll: &mut impl FnMut() -> Result<(), String>,
) -> Result<Output, String> {
    let mut stdout = tracked_child
        .lock()
        .map_err(|error| format!("lock AutoCut native media process stdout failed: {error}"))?
        .stdout
        .take();
    let mut stderr = tracked_child
        .lock()
        .map_err(|error| format!("lock AutoCut native media process stderr failed: {error}"))?
        .stderr
        .take();
    let stdout_reader = thread::spawn(move || read_child_pipe_by_line(&mut stdout, |_| {}));
    let stderr_reader = thread::spawn(move || read_child_pipe_by_line(&mut stderr, |_| {}));
    let mut throttled_poll = AutoCutThrottledPoll::new(NATIVE_MEDIA_POLL_HEARTBEAT_INTERVAL);

    let status = loop {
        if let Err(error) = throttled_poll.run_if_due(on_poll) {
            return Err(stop_and_join_tracked_native_media_child_after_error(
                tracked_child,
                stdout_reader,
                stderr_reader,
                "native media poll callback failure",
                error,
            ));
        }
        if let Some(status) = tracked_child
            .lock()
            .map_err(|error| format!("lock AutoCut native media process wait failed: {error}"))?
            .try_wait()
            .map_err(|error| format!("wait for AutoCut native media process failed: {error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(20));
    };
    if let Err(error) = throttled_poll.run_now(on_poll) {
        return Err(stop_and_join_tracked_native_media_child_after_error(
            tracked_child,
            stdout_reader,
            stderr_reader,
            "native media final poll callback failure",
            error,
        ));
    }
    let stdout = join_child_pipe_reader(stdout_reader, "AutoCut native media stdout")?;
    let stderr = join_child_pipe_reader(stderr_reader, "AutoCut native media stderr")?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

struct AutoCutThrottledPoll {
    interval: Duration,
    last_run: Option<Instant>,
}

impl AutoCutThrottledPoll {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_run: None,
        }
    }

    fn run_if_due(
        &mut self,
        action: &mut impl FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        let now = Instant::now();
        let is_due = self
            .last_run
            .map(|last_run| now.duration_since(last_run) >= self.interval)
            .unwrap_or(true);
        if is_due {
            action()?;
            self.last_run = Some(now);
        }
        Ok(())
    }

    fn run_now(&mut self, action: &mut impl FnMut() -> Result<(), String>) -> Result<(), String> {
        action()?;
        self.last_run = Some(Instant::now());
        Ok(())
    }
}

fn join_child_pipe_reader(
    reader: thread::JoinHandle<Result<Vec<u8>, String>>,
    label: &str,
) -> Result<Vec<u8>, String> {
    reader
        .join()
        .map_err(|_| format!("read {label} panicked"))?
}

fn stop_and_join_tracked_native_media_child_after_error(
    tracked_child: &Arc<Mutex<Child>>,
    stdout_reader: thread::JoinHandle<Result<Vec<u8>, String>>,
    stderr_reader: thread::JoinHandle<Result<Vec<u8>, String>>,
    reason: &str,
    original_error: String,
) -> String {
    let cleanup_errors = [
        stop_tracked_native_media_child(tracked_child, reason).err(),
        join_child_pipe_reader(stdout_reader, "AutoCut native media stdout").err(),
        join_child_pipe_reader(stderr_reader, "AutoCut native media stderr").err(),
    ];
    append_cleanup_diagnostics(original_error, cleanup_errors.into_iter().flatten())
}

fn append_cleanup_diagnostics(
    original_error: String,
    cleanup_errors: impl IntoIterator<Item = String>,
) -> String {
    let diagnostics = cleanup_errors.into_iter().collect::<Vec<_>>();
    if diagnostics.is_empty() {
        original_error
    } else {
        format!(
            "{original_error}; cleanup diagnostics: {}",
            diagnostics.join("; ")
        )
    }
}

fn stop_tracked_native_media_child(
    tracked_child: &Arc<Mutex<Child>>,
    reason: &str,
) -> Result<(), String> {
    let mut child = tracked_child.lock().map_err(|error| {
        format!("lock AutoCut native media process for cleanup failed: {error}")
    })?;
    if child
        .try_wait()
        .map_err(|error| {
            format!("inspect AutoCut native media process for cleanup failed: {error}")
        })?
        .is_none()
    {
        child.kill().map_err(|error| {
            format!("stop AutoCut native media process after {reason} failed: {error}")
        })?;
        let _ = child.wait();
    }
    Ok(())
}

fn read_child_pipe_by_line(
    pipe: &mut Option<impl Read>,
    mut on_line: impl FnMut(&str),
) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    if let Some(reader) = pipe {
        let mut buffered_reader = BufReader::new(reader);
        loop {
            let mut line = Vec::new();
            let bytes_read = buffered_reader
                .read_until(b'\n', &mut line)
                .map_err(|error| {
                    format!("read AutoCut native media process pipe failed: {error}")
                })?;
            if bytes_read == 0 {
                break;
            }
            buffer.extend_from_slice(&line);
            if let Ok(line_text) = std::str::from_utf8(&line) {
                on_line(line_text.trim_end_matches(['\r', '\n']));
            }
        }
    }
    Ok(buffer)
}

fn drain_ffmpeg_progress_updates(
    pipe_event_receiver: &mpsc::Receiver<AutoCutFfmpegPipeEvent>,
    progress_state: &mut AutoCutFfmpegProgressStreamState,
    on_progress: &mut impl FnMut(i64) -> Result<(), String>,
) -> Result<(), String> {
    loop {
        match pipe_event_receiver.try_recv() {
            Ok(AutoCutFfmpegPipeEvent::Duration(duration_ms)) => {
                progress_state.total_duration_ms = Some(duration_ms);
                if let Some(progress_time_ms) = progress_state.last_progress_time_ms {
                    if let Some(progress) =
                        parse_ffmpeg_progress_time_percent(progress_time_ms, duration_ms)
                    {
                        on_progress(progress)?;
                    }
                }
            }
            Ok(AutoCutFfmpegPipeEvent::ProgressTime(progress_time_ms)) => {
                progress_state.last_progress_time_ms = Some(progress_time_ms);
                if let Some(duration_ms) = progress_state.total_duration_ms {
                    if let Some(progress) =
                        parse_ffmpeg_progress_time_percent(progress_time_ms, duration_ms)
                    {
                        on_progress(progress)?;
                    }
                }
            }
            Err(mpsc::TryRecvError::Empty) => return Ok(()),
            Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn run_ffmpeg_audio_extract(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    format: &str,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutAudioExtractionResult, String> {
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args(["-vn"]);

    match format {
        "mp3" => {
            command.args(["-acodec", "libmp3lame", "-b:a", "192k"]);
        }
        "wav" => {
            command.args(["-acodec", "pcm_s16le"]);
        }
        "flac" => {
            command.args(["-acodec", "flac"]);
        }
        "aac" => {
            command.args(["-acodec", "aac", "-b:a", "192k"]);
        }
        _ => return Err(format!("unsupported normalized audio format '{format}'")),
    }

    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "audio extraction",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            record_ffmpeg_streaming_progress(connection, task_uuid, progress, "audioExtraction")
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg audio extraction failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_audio_result(output_path, format, toolchain.executable.clone())
}

fn run_ffmpeg_speech_audio_extract(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<(), String> {
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args(["-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le"]);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "speech audio extraction",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            record_ffmpeg_streaming_progress(
                connection,
                task_uuid,
                progress.clamp(1, 35),
                "speechTranscription",
            )
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg speech audio extraction failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(())
}

fn run_local_speech_transcription(
    connection: &Connection,
    task_uuid: &str,
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    speech_toolchain: &AutoCutSpeechToolchain,
    input_path: &Path,
    task_output_dir: &Path,
    language: &str,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutSpeechTranscriptionResult, String> {
    if !speech_toolchain.ready {
        return Err(format!(
            "AutoCut local speech transcription toolchain is not configured: {}",
            speech_toolchain.diagnostics.join("; ")
        ));
    }

    let audio_path =
        task_output_dir.join(format!("speech-audio-{}.wav", monotonic_artifact_suffix()?));
    run_ffmpeg_speech_audio_extract(
        connection,
        task_uuid,
        ffmpeg_toolchain,
        input_path,
        &audio_path,
        worker_lease,
    )?;
    record_ops_task_progress(
        connection,
        task_uuid,
        40,
        json!({
            "operation": "speechTranscription",
            "phase": "speech-audio-extracted",
            "sourceKind": speech_toolchain.source_kind
        }),
    )?;

    let transcript_stem = task_output_dir.join(format!(
        "speech-transcript-{}",
        monotonic_artifact_suffix()?
    ));
    let transcript_path = run_local_whisper_transcription(
        connection,
        task_uuid,
        speech_toolchain,
        &audio_path,
        &transcript_stem,
        language,
        worker_lease,
    )?;
    let transcript_json = read_whisper_transcript_json_file(&transcript_path)?;
    let segments = parse_whisper_transcript_json(&transcript_json)?;
    let text = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(AutoCutSpeechTranscriptionResult {
        artifact_uuid: String::new(),
        task_uuid: task_uuid.to_string(),
        source_asset_uuid: String::new(),
        transcript_path: transcript_path.display().to_string(),
        task_output_dir: task_output_dir.display().to_string(),
        language: language.to_string(),
        segments,
        text,
        ffmpeg_executable: ffmpeg_toolchain.executable.clone(),
        speech_executable: speech_toolchain.executable.clone(),
    })
}

fn run_local_whisper_transcription(
    connection: &Connection,
    task_uuid: &str,
    speech_toolchain: &AutoCutSpeechToolchain,
    audio_path: &Path,
    transcript_stem: &Path,
    language: &str,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<PathBuf, String> {
    let mut command = Command::new(&speech_toolchain.executable);
    command
        .args(["-m", speech_toolchain.model_path.as_str()])
        .args(["-f"])
        .arg(audio_path)
        .args(["-oj", "-of"])
        .arg(transcript_stem);
    if !language.eq_ignore_ascii_case("auto") {
        command.args(["-l", language]);
    }
    let output = run_tracked_native_media_command(
        task_uuid,
        &mut command,
        "local Whisper transcription",
        || {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            Ok(())
        },
    )?;
    record_ops_task_progress(
        connection,
        task_uuid,
        75,
        json!({
            "operation": "speechTranscription",
            "phase": "local-whisper-completed",
            "sourceKind": speech_toolchain.source_kind
        }),
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut local Whisper transcription failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let transcript_path = transcript_stem.with_extension("json");
    if !transcript_path.is_file() {
        return Err(format!(
            "AutoCut local Whisper transcription did not produce JSON output: {}",
            transcript_path.display()
        ));
    }

    Ok(transcript_path)
}

fn run_ffmpeg_video_gif(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    fps: &str,
    height: i64,
    dither: bool,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    let palette_filter = format!(
        "fps={fps},scale=-2:{height}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither={}",
        if dither { "sierra2_4a" } else { "none" }
    );
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args(["-filter_complex", palette_filter.as_str(), "-loop", "0"]);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "video GIF generation",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            record_ffmpeg_streaming_progress(connection, task_uuid, progress, "videoGif")
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg video GIF generation failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_media_operation_output(output_path, "gif", toolchain.executable.clone())
}

fn run_ffmpeg_video_slices(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    task_output_dir: &Path,
    clips: &[AutoCutVideoSliceClipRequest],
    output_format: &str,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    subtitle_format: Option<&str>,
    subtitle_mode: AutoCutVideoSliceSubtitleMode,
    subtitle_segments: &[AutoCutSpeechTranscriptionSegment],
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<Vec<AutoCutVideoSliceOperationOutput>, String> {
    let total_clips = clips.len();
    let mut outputs = Vec::with_capacity(total_clips);
    let cover_dir = autocut_task_cover_dir(task_output_dir)?;

    for (index, clip) in clips.iter().enumerate() {
        let output_file_name = match clip.output_file_name.as_ref() {
            Some(output_file_name) => output_file_name.clone(),
            None => format!(
                "video-slice-{:02}-{}.{}",
                index + 1,
                monotonic_artifact_suffix()?,
                output_format
            ),
        };
        let output_path = task_output_dir.join(output_file_name);
        let burned_subtitle_path = write_video_slice_burned_subtitle_filter_artifact(
            task_output_dir,
            clip,
            index,
            subtitle_mode,
            subtitle_segments,
        )?;
        let video_output = run_ffmpeg_video_slice(
            connection,
            task_uuid,
            toolchain,
            input_path,
            &output_path,
            clip,
            render_profile,
            apply_audio_noise_reduction,
            burned_subtitle_path.as_deref(),
            index,
            total_clips,
            worker_lease,
        )?;
        let thumbnail_path = cover_dir.join(format!(
            "video-slice-{:02}-thumbnail-{}.jpg",
            index + 1,
            monotonic_artifact_suffix()?
        ));
        let thumbnail_output = run_ffmpeg_video_slice_thumbnail(
            connection,
            task_uuid,
            toolchain,
            input_path,
            &thumbnail_path,
            clip,
            render_profile,
            index,
            total_clips,
            worker_lease,
        )?;
        let subtitle_output = write_video_slice_subtitle_artifact(
            task_output_dir,
            clip,
            index,
            if subtitle_mode.writes_srt_sidecar() {
                subtitle_format
            } else {
                None
            },
            subtitle_segments,
        )?;
        outputs.push(AutoCutVideoSliceOperationOutput {
            clip: clip.clone(),
            video_output,
            thumbnail_output,
            subtitle_output,
        });
    }

    Ok(outputs)
}

fn write_video_slice_subtitle_artifact(
    task_output_dir: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    clip_index: usize,
    subtitle_format: Option<&str>,
    subtitle_segments: &[AutoCutSpeechTranscriptionSegment],
) -> Result<Option<AutoCutMediaOperationOutput>, String> {
    if subtitle_format != Some("srt") || subtitle_segments.is_empty() {
        return Ok(None);
    }

    let subtitle_text = build_video_slice_srt(clip, subtitle_segments);
    if subtitle_text.trim().is_empty() {
        return Ok(None);
    }

    let output_path = task_output_dir.join(format!(
        "video-slice-{:02}-subtitle-{}.srt",
        clip_index + 1,
        monotonic_artifact_suffix()?
    ));
    fs::write(&output_path, subtitle_text)
        .map_err(|error| format!("write AutoCut video slice subtitle artifact failed: {error}"))?;
    build_media_operation_output(&output_path, "srt", "local-subtitle-writer".to_string()).map(Some)
}

fn write_video_slice_burned_subtitle_filter_artifact(
    task_output_dir: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    clip_index: usize,
    subtitle_mode: AutoCutVideoSliceSubtitleMode,
    subtitle_segments: &[AutoCutSpeechTranscriptionSegment],
) -> Result<Option<PathBuf>, String> {
    if !subtitle_mode.burns_into_video() || subtitle_segments.is_empty() {
        return Ok(None);
    }

    let subtitle_text = build_video_slice_srt(clip, subtitle_segments);
    if subtitle_text.trim().is_empty() {
        return Ok(None);
    }

    let output_path = task_output_dir.join(format!(
        "video-slice-{:02}-burned-subtitle-{}.srt",
        clip_index + 1,
        monotonic_artifact_suffix()?
    ));
    fs::write(&output_path, subtitle_text).map_err(|error| {
        format!("write AutoCut video slice burned subtitle filter artifact failed: {error}")
    })?;

    Ok(Some(output_path))
}

fn build_video_slice_srt(
    clip: &AutoCutVideoSliceClipRequest,
    subtitle_segments: &[AutoCutSpeechTranscriptionSegment],
) -> String {
    let clip_start_ms = clip.start_ms;
    let clip_end_ms = clip.start_ms.saturating_add(clip.duration_ms);
    let mut entries = Vec::new();

    for segment in subtitle_segments {
        let overlap_start_ms = segment.start_ms.max(clip_start_ms);
        let overlap_end_ms = segment.end_ms.min(clip_end_ms);
        if overlap_end_ms <= overlap_start_ms {
            continue;
        }

        let relative_start_ms = overlap_start_ms.saturating_sub(clip_start_ms);
        let relative_end_ms = overlap_end_ms.saturating_sub(clip_start_ms);
        let text = format_srt_segment_text(segment);
        if text.is_empty() {
            continue;
        }

        entries.push(format!(
            "{}\n{} --> {}\n{}\n",
            entries.len() + 1,
            format_srt_timestamp(relative_start_ms),
            format_srt_timestamp(relative_end_ms),
            text
        ));
    }

    entries.join("\n")
}

fn format_srt_segment_text(segment: &AutoCutSpeechTranscriptionSegment) -> String {
    let text = normalize_srt_text(&segment.text);
    if text.is_empty() {
        return String::new();
    }

    match segment
        .speaker
        .as_deref()
        .map(normalize_srt_text)
        .filter(|speaker| !speaker.is_empty())
    {
        Some(speaker) => format!("{speaker}: {text}"),
        None => text,
    }
}

fn normalize_srt_text(value: &str) -> String {
    value
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .collect()
}

fn format_srt_timestamp(milliseconds: i64) -> String {
    let milliseconds = milliseconds.max(0);
    let hours = milliseconds / 3_600_000;
    let minutes = (milliseconds % 3_600_000) / 60_000;
    let seconds = (milliseconds % 60_000) / 1_000;
    let millis = milliseconds % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

fn append_video_slice_burned_subtitle_filter(
    filter_chain: Option<String>,
    burned_subtitle_path: Option<&Path>,
) -> Option<String> {
    let Some(burned_subtitle_path) = burned_subtitle_path else {
        return filter_chain;
    };
    let subtitle_filter = format!(
        "subtitles='{}':force_style='{}'",
        escape_ffmpeg_filter_path(burned_subtitle_path),
        VIDEO_SLICE_BURNED_SUBTITLE_FORCE_STYLE
    );

    Some(match filter_chain {
        Some(filter_chain) => format!("{filter_chain},{subtitle_filter}"),
        None => subtitle_filter,
    })
}

fn escape_ffmpeg_filter_path(path: &Path) -> String {
    path.display()
        .to_string()
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

fn autocut_video_slice_encoder_candidates() -> Vec<AutoCutVideoSliceEncoderCandidate> {
    let mut candidates = Vec::new();

    if cfg!(target_os = "windows") {
        candidates.push(AutoCutVideoSliceEncoderCandidate {
            label: "windows-nvidia-nvenc".to_string(),
            video_codec: "h264_nvenc".to_string(),
            pre_input_args: Vec::new(),
            encoder_args: vec![
                "-preset".to_string(),
                "p4".to_string(),
                "-tune".to_string(),
                "hq".to_string(),
                "-cq".to_string(),
                "23".to_string(),
                "-b:v".to_string(),
                "0".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ],
            filter_chain_suffix: None,
            requires_hardware: true,
        });
        candidates.push(AutoCutVideoSliceEncoderCandidate {
            label: "windows-intel-quick-sync".to_string(),
            video_codec: "h264_qsv".to_string(),
            pre_input_args: Vec::new(),
            encoder_args: vec![
                "-preset".to_string(),
                "veryfast".to_string(),
                "-global_quality".to_string(),
                "23".to_string(),
                "-look_ahead".to_string(),
                "0".to_string(),
            ],
            filter_chain_suffix: None,
            requires_hardware: true,
        });
        candidates.push(AutoCutVideoSliceEncoderCandidate {
            label: "windows-amd-amf".to_string(),
            video_codec: "h264_amf".to_string(),
            pre_input_args: Vec::new(),
            encoder_args: vec![
                "-quality".to_string(),
                "balanced".to_string(),
                "-usage".to_string(),
                "transcoding".to_string(),
                "-rc".to_string(),
                "cqp".to_string(),
                "-qp_i".to_string(),
                "23".to_string(),
                "-qp_p".to_string(),
                "23".to_string(),
                "-qp_b".to_string(),
                "23".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ],
            filter_chain_suffix: None,
            requires_hardware: true,
        });
    }

    if cfg!(target_os = "macos") {
        candidates.push(AutoCutVideoSliceEncoderCandidate {
            label: "macos-apple-videotoolbox".to_string(),
            video_codec: "h264_videotoolbox".to_string(),
            pre_input_args: Vec::new(),
            encoder_args: vec![
                "-allow_sw".to_string(),
                "1".to_string(),
                "-realtime".to_string(),
                "0".to_string(),
                "-b:v".to_string(),
                "6M".to_string(),
                "-maxrate".to_string(),
                "8M".to_string(),
                "-bufsize".to_string(),
                "12M".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ],
            filter_chain_suffix: None,
            requires_hardware: true,
        });
    }

    if cfg!(target_os = "linux") {
        if let Some(vaapi_device) = autocut_linux_vaapi_render_device() {
            candidates.push(AutoCutVideoSliceEncoderCandidate {
                label: "linux-vaapi".to_string(),
                video_codec: "h264_vaapi".to_string(),
                pre_input_args: vec![
                    "-vaapi_device".to_string(),
                    vaapi_device.display().to_string(),
                ],
                encoder_args: vec![
                    "-qp".to_string(),
                    "23".to_string(),
                    "-profile:v".to_string(),
                    "high".to_string(),
                ],
                filter_chain_suffix: Some("format=nv12,hwupload".to_string()),
                requires_hardware: true,
            });
        }
        candidates.push(AutoCutVideoSliceEncoderCandidate {
            label: "linux-nvidia-nvenc".to_string(),
            video_codec: "h264_nvenc".to_string(),
            pre_input_args: Vec::new(),
            encoder_args: vec![
                "-preset".to_string(),
                "p4".to_string(),
                "-tune".to_string(),
                "hq".to_string(),
                "-cq".to_string(),
                "23".to_string(),
                "-b:v".to_string(),
                "0".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ],
            filter_chain_suffix: None,
            requires_hardware: true,
        });
        candidates.push(AutoCutVideoSliceEncoderCandidate {
            label: "linux-intel-quick-sync".to_string(),
            video_codec: "h264_qsv".to_string(),
            pre_input_args: Vec::new(),
            encoder_args: vec![
                "-preset".to_string(),
                "veryfast".to_string(),
                "-global_quality".to_string(),
                "23".to_string(),
                "-look_ahead".to_string(),
                "0".to_string(),
            ],
            filter_chain_suffix: None,
            requires_hardware: true,
        });
    }

    candidates.push(autocut_video_slice_cpu_encoder_candidate());
    candidates
}

fn autocut_video_slice_cpu_encoder_candidate() -> AutoCutVideoSliceEncoderCandidate {
    AutoCutVideoSliceEncoderCandidate {
        label: "portable-cpu-libx264".to_string(),
        video_codec: "libx264".to_string(),
        pre_input_args: Vec::new(),
        encoder_args: vec![
            "-preset".to_string(),
            "veryfast".to_string(),
            "-crf".to_string(),
            "23".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ],
        filter_chain_suffix: None,
        requires_hardware: false,
    }
}

fn autocut_linux_vaapi_render_device() -> Option<PathBuf> {
    let render_dir = Path::new("/dev/dri");
    let entries = fs::read_dir(render_dir).ok()?;
    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("renderD"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.into_iter().find(|path| path.is_file())
}

fn append_ffmpeg_video_slice_encoder_args(
    command: &mut Command,
    candidate: &AutoCutVideoSliceEncoderCandidate,
) {
    command.args(["-c:v", candidate.video_codec.as_str()]);
    for arg in &candidate.encoder_args {
        command.arg(arg);
    }
    command.args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]);
}

fn ffmpeg_video_slice_audio_noise_reduction_filter() -> &'static str {
    "highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"
}

fn ffmpeg_video_slice_audio_filter(clip: &AutoCutVideoSliceClipRequest, apply_audio_noise_reduction: bool) -> Option<String> {
    let mut filters = Vec::new();
    if apply_audio_noise_reduction {
        filters.push(ffmpeg_video_slice_audio_noise_reduction_filter().to_string());
    }

    for range in clip.audio_mute_ranges.as_deref().unwrap_or_default() {
        if range.end_ms <= range.start_ms {
            continue;
        }
        let relative_start_ms = range.start_ms.saturating_sub(clip.start_ms).max(0);
        let relative_end_ms = range.end_ms.saturating_sub(clip.start_ms).min(clip.duration_ms);
        if relative_end_ms <= relative_start_ms {
            continue;
        }
        filters.push(format!(
            "volume=enable='between(t,{},{})':volume=0",
            seconds_arg_from_millis(relative_start_ms),
            seconds_arg_from_millis(relative_end_ms)
        ));
    }

    (!filters.is_empty()).then(|| filters.join(","))
}

fn video_slice_filter_chain_for_encoder_candidate(
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    burned_subtitle_path: Option<&Path>,
    candidate: &AutoCutVideoSliceEncoderCandidate,
) -> Option<String> {
    let filter_chain = append_video_slice_burned_subtitle_filter(
        video_slice_render_filter_chain(render_profile),
        burned_subtitle_path,
    );
    match (filter_chain, candidate.filter_chain_suffix.as_deref()) {
        (Some(filter_chain), Some(suffix)) => Some(format!("{filter_chain},{suffix}")),
        (Some(filter_chain), None) => Some(filter_chain),
        (None, Some(suffix)) => Some(suffix.to_string()),
        (None, None) => None,
    }
}

fn remove_partial_video_slice_output(output_path: &Path) -> Result<(), String> {
    match fs::remove_file(output_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "remove partial AutoCut video slice output before encoder retry failed: {error}"
        )),
    }
}

fn stderr_tail_for_video_slice_diagnostics(stderr: &[u8]) -> String {
    const MAX_DIAGNOSTIC_CHARS: usize = 4_000;
    let stderr = String::from_utf8_lossy(stderr);
    let trimmed = stderr.trim();
    if trimmed.chars().count() <= MAX_DIAGNOSTIC_CHARS {
        return trimmed.to_string();
    }
    let tail = trimmed
        .chars()
        .rev()
        .take(MAX_DIAGNOSTIC_CHARS)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("...{tail}")
}

fn format_video_slice_encoder_attempt_diagnostics(
    attempts: &[AutoCutVideoSliceEncoderAttemptDiagnostic],
) -> String {
    attempts
        .iter()
        .map(|attempt| {
            let stderr_tail = if attempt.stderr_tail.trim().is_empty() {
                "no stderr captured".to_string()
            } else {
                attempt.stderr_tail.clone()
            };
            format!(
                "{} [{}] status={} stderr={}",
                attempt.label, attempt.video_codec, attempt.status, stderr_tail
            )
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

fn build_ffmpeg_video_slice_command(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    burned_subtitle_path: Option<&Path>,
    candidate: &AutoCutVideoSliceEncoderCandidate,
) -> Command {
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y"]);
    for arg in &candidate.pre_input_args {
        command.arg(arg);
    }
    command.args(["-ss", seconds_arg_from_millis(clip.start_ms).as_str()]);
    command.args(["-i"]);
    command.arg(input_path);
    command.args(["-t", seconds_arg_from_millis(clip.duration_ms).as_str()]);
    command.args(["-map", "0:v:0", "-map", "0:a?"]);
    let filter_chain = video_slice_filter_chain_for_encoder_candidate(
        render_profile,
        burned_subtitle_path,
        candidate,
    );
    if let Some(filter_chain) = filter_chain {
        command.args(["-vf", filter_chain.as_str()]);
    }
    if let Some(audio_filter) =
        ffmpeg_video_slice_audio_filter(clip, apply_audio_noise_reduction)
    {
        command.args(["-af", audio_filter.as_str()]);
    }
    append_ffmpeg_video_slice_encoder_args(&mut command, candidate);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    command
}

fn run_ffmpeg_video_slice_with_encoder_fallback(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    burned_subtitle_path: Option<&Path>,
    clip_index: usize,
    total_clips: usize,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    let candidates = autocut_video_slice_encoder_candidates();
    let mut attempts = Vec::new();

    for (candidate_index, candidate) in candidates.iter().enumerate() {
        if candidate_index > 0 {
            remove_partial_video_slice_output(output_path)?;
        }
        let _ = heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
        insert_ops_task_event(
            connection,
            task_uuid,
            OPS_TASK_EVENT_TYPE_PROGRESS,
            json!({
                "operation": "videoSlice",
                "phase": "ffmpeg-video-slice-encoder-attempt",
                "source": "native-host",
                "clipIndex": clip_index + 1,
                "clipCount": total_clips,
                "encoderLabel": candidate.label,
                "videoCodec": candidate.video_codec,
                "requiresHardware": candidate.requires_hardware,
                "attempt": candidate_index + 1,
                "attemptCount": candidates.len()
            })
            .to_string(),
        )?;
        let mut command = build_ffmpeg_video_slice_command(
            toolchain,
            input_path,
            output_path,
            clip,
            render_profile,
            apply_audio_noise_reduction,
            burned_subtitle_path,
            candidate,
        );
        let output = run_tracked_ffmpeg_command_with_progress(
            task_uuid,
            &mut command,
            &format!("video slicing with {}", candidate.label),
            |progress| {
                heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
                let weighted_progress = weighted_slice_progress(progress, clip_index, total_clips);
                record_ffmpeg_streaming_progress(
                    connection,
                    task_uuid,
                    weighted_progress,
                    "videoSlice",
                )
            },
        )?;

        if output.status.success() {
            return build_media_operation_output(output_path, "mp4", toolchain.executable.clone());
        }

        attempts.push(AutoCutVideoSliceEncoderAttemptDiagnostic {
            label: candidate.label.clone(),
            video_codec: candidate.video_codec.clone(),
            status: output.status.to_string(),
            stderr_tail: stderr_tail_for_video_slice_diagnostics(&output.stderr),
        });
    }

    let cleanup_error = remove_partial_video_slice_output(output_path).err();
    let diagnostics = format_video_slice_encoder_attempt_diagnostics(&attempts);
    let cleanup_diagnostics = cleanup_error
        .map(|error| format!("; cleanup diagnostics: {error}"))
        .unwrap_or_default();
    Err(format!(
        "AutoCut FFmpeg video slicing failed after trying platform hardware encoders and the libx264 CPU fallback. Encoder attempts: {diagnostics}{cleanup_diagnostics}"
    ))
}

fn run_ffmpeg_video_slice(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    burned_subtitle_path: Option<&Path>,
    clip_index: usize,
    total_clips: usize,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    run_ffmpeg_video_slice_with_encoder_fallback(
        connection,
        task_uuid,
        toolchain,
        input_path,
        output_path,
        clip,
        render_profile,
        apply_audio_noise_reduction,
        burned_subtitle_path,
        clip_index,
        total_clips,
        worker_lease,
    )
}

fn run_ffmpeg_video_slice_thumbnail(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    clip_index: usize,
    total_clips: usize,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    let thumbnail_at_ms = clip.start_ms.saturating_add((clip.duration_ms / 2).max(1));
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y"]);
    command.args(["-ss", seconds_arg_from_millis(thumbnail_at_ms).as_str()]);
    command.args(["-i"]);
    command.arg(input_path);
    let thumbnail_filter = video_slice_render_filter_chain(render_profile)
        .map(|filter_chain| format!("{filter_chain},scale=320:-2:flags=lanczos"))
        .unwrap_or_else(|| "scale=320:-2:flags=lanczos".to_string());
    command.args([
        "-frames:v",
        "1",
        "-vf",
        thumbnail_filter.as_str(),
        "-q:v",
        "3",
    ]);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "video slice thumbnail generation",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            let weighted_progress = weighted_slice_progress(progress, clip_index, total_clips);
            record_ffmpeg_streaming_progress(connection, task_uuid, weighted_progress, "videoSlice")
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg video slice thumbnail generation failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_media_operation_output(output_path, "jpg", toolchain.executable.clone())
}

fn seconds_arg_from_millis(milliseconds: i64) -> String {
    let seconds = milliseconds / 1_000;
    let millis = milliseconds.rem_euclid(1_000);
    format!("{seconds}.{millis:03}")
}

fn weighted_slice_progress(progress: i64, clip_index: usize, total_clips: usize) -> i64 {
    if total_clips == 0 {
        return progress.clamp(1, 99);
    }

    let total = i64::try_from(total_clips).unwrap_or(1).max(1);
    let index = i64::try_from(clip_index).unwrap_or(0);
    let base = index.saturating_mul(98) / total;
    let span = 98 / total;
    (1 + base + progress.clamp(1, 99).saturating_mul(span.max(1)) / 100).clamp(1, 99)
}

fn run_ffmpeg_video_compress(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    crf: &str,
    preset: &str,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args([
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
    ]);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "video compression",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            record_ffmpeg_streaming_progress(connection, task_uuid, progress, "videoCompress")
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg video compression failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_media_operation_output(output_path, "mp4", toolchain.executable.clone())
}

fn run_ffmpeg_video_convert(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    target_format: &str,
    video_codec: &str,
    audio_codec: &str,
    target_height: Option<i64>,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args(["-map", "0:v:0", "-map", "0:a?"]);
    append_video_convert_video_codec_args(&mut command, video_codec)?;
    append_video_convert_audio_codec_args(&mut command, audio_codec)?;
    if let Some(height) = target_height {
        let filter = format!("scale=-2:{height}:flags=lanczos");
        command.args(["-vf", filter.as_str()]);
    }
    if target_format == "mp4" || target_format == "mov" {
        command.args(["-movflags", "+faststart"]);
    }
    if target_format == "webm" {
        command.args(["-deadline", "good", "-cpu-used", "4"]);
    }

    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "video conversion",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            record_ffmpeg_streaming_progress(connection, task_uuid, progress, "videoConvert")
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg video conversion failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_media_operation_output(output_path, target_format, toolchain.executable.clone())
}

fn append_video_convert_video_codec_args(
    command: &mut Command,
    video_codec: &str,
) -> Result<(), String> {
    match video_codec {
        "h264" => {
            command.args(["-c:v", "libx264", "-preset", "medium", "-crf", "23"]);
        }
        "h265" => {
            command.args(["-c:v", "libx265", "-preset", "medium", "-crf", "28"]);
        }
        "vp9" => {
            command.args(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32"]);
        }
        "mpeg4" => {
            command.args(["-c:v", "mpeg4", "-q:v", "5"]);
        }
        "copy" => {
            command.args(["-c:v", "copy"]);
        }
        _ => {
            return Err(format!(
                "unsupported normalized video codec '{video_codec}'"
            ));
        }
    }

    Ok(())
}

fn append_video_convert_audio_codec_args(
    command: &mut Command,
    audio_codec: &str,
) -> Result<(), String> {
    match audio_codec {
        "aac" => {
            command.args(["-c:a", "aac", "-b:a", "160k"]);
        }
        "mp3" => {
            command.args(["-c:a", "libmp3lame", "-b:a", "192k"]);
        }
        "opus" => {
            command.args(["-c:a", "libopus", "-b:a", "128k"]);
        }
        "copy" => {
            command.args(["-c:a", "copy"]);
        }
        _ => {
            return Err(format!(
                "unsupported normalized audio codec '{audio_codec}'"
            ));
        }
    }

    Ok(())
}

fn run_ffmpeg_video_enhance(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    target_height: i64,
    enhance_mode: &str,
    frame_rate: Option<&str>,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutMediaOperationOutput, String> {
    let filter_chain = video_enhance_filter_chain(target_height, enhance_mode, frame_rate);
    let mut command = Command::new(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args([
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        filter_chain.as_str(),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
    ]);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    let output = run_tracked_ffmpeg_command_with_progress(
        task_uuid,
        &mut command,
        "video enhancement",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            record_ffmpeg_streaming_progress(connection, task_uuid, progress, "videoEnhance")
        },
    )?;

    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg video enhancement failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    build_media_operation_output(output_path, "mp4", toolchain.executable.clone())
}

fn build_audio_result(
    output_path: &Path,
    format: &str,
    ffmpeg_executable: String,
) -> Result<AutoCutAudioExtractionResult, String> {
    let metadata = fs::metadata(output_path)
        .map_err(|error| format!("read AutoCut audio artifact metadata failed: {error}"))?;
    if metadata.len() == 0 {
        return Err("AutoCut audio artifact is empty".to_string());
    }

    Ok(AutoCutAudioExtractionResult {
        artifact_uuid: String::new(),
        task_uuid: String::new(),
        source_asset_uuid: String::new(),
        artifact_path: output_path.display().to_string(),
        task_output_dir: output_path
            .parent()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        byte_size: metadata.len(),
        format: format.to_string(),
        ffmpeg_executable,
    })
}

fn build_media_operation_output(
    output_path: &Path,
    format: &str,
    ffmpeg_executable: String,
) -> Result<AutoCutMediaOperationOutput, String> {
    let metadata = fs::metadata(output_path)
        .map_err(|error| format!("read AutoCut media artifact metadata failed: {error}"))?;
    if metadata.len() == 0 {
        return Err("AutoCut media artifact is empty".to_string());
    }

    Ok(AutoCutMediaOperationOutput {
        artifact_path: output_path.display().to_string(),
        task_output_dir: output_path
            .parent()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        byte_size: metadata.len(),
        format: format.to_string(),
        ffmpeg_executable,
    })
}

fn read_media_asset(
    connection: &Connection,
    asset_uuid: &str,
) -> Result<AutoCutRegisteredMediaAsset, String> {
    let normalized_uuid = asset_uuid.trim();
    if normalized_uuid.is_empty() {
        return Err("assetUuid is required for AutoCut native media processing".to_string());
    }

    connection
        .query_row(
            r#"
            SELECT uuid, name, source_uri
            FROM media_asset
            WHERE uuid = ?1
              AND status = ?2
            "#,
            params![normalized_uuid, OPS_STATUS_COMPLETED],
            |row| {
                Ok(AutoCutRegisteredMediaAsset {
                    uuid: row.get::<_, String>(0)?,
                    name: row.get::<_, String>(1)?,
                    source_uri: row.get::<_, String>(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("read AutoCut media_asset failed: {error}"))?
        .ok_or_else(|| format!("media_asset not found for assetUuid {normalized_uuid}"))
}

fn list_autocut_native_tasks_on_connection(
    connection: &Connection,
    request: AutoCutNativeTaskQueryRequest,
) -> Result<Vec<AutoCutNativeTaskSnapshot>, String> {
    let normalized_task_uuid = request
        .task_uuid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let limit = normalize_native_task_query_limit(request.limit);

    let mut statement = if normalized_task_uuid.is_some() {
        connection
            .prepare(
                r#"
                SELECT
                    uuid,
                    task_type,
                    status,
                    progress,
                    source_asset_uuid,
                    input_json,
                    output_json,
                    error_code,
                    error_message,
                    created_at,
                    updated_at
                FROM ops_task
                WHERE uuid = ?1
                ORDER BY updated_at DESC, id DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| format!("prepare AutoCut native task query failed: {error}"))?
    } else {
        connection
            .prepare(
                r#"
                SELECT
                    uuid,
                    task_type,
                    status,
                    progress,
                    source_asset_uuid,
                    input_json,
                    output_json,
                    error_code,
                    error_message,
                    created_at,
                    updated_at
                FROM ops_task
                ORDER BY updated_at DESC, id DESC
                LIMIT ?1
                "#,
            )
            .map_err(|error| format!("prepare AutoCut native task query failed: {error}"))?
    };

    let mut task_rows = Vec::new();
    if let Some(task_uuid) = normalized_task_uuid {
        let rows = statement
            .query_map(params![task_uuid, limit], read_native_task_row)
            .map_err(|error| format!("query AutoCut native task snapshots failed: {error}"))?;
        for row in rows {
            task_rows.push(
                row.map_err(|error| format!("read AutoCut native task snapshot failed: {error}"))?,
            );
        }
    } else {
        let rows = statement
            .query_map(params![limit], read_native_task_row)
            .map_err(|error| format!("query AutoCut native task snapshots failed: {error}"))?;
        for row in rows {
            task_rows.push(
                row.map_err(|error| format!("read AutoCut native task snapshot failed: {error}"))?,
            );
        }
    }

    let mut snapshots = Vec::with_capacity(task_rows.len());
    for mut task in task_rows {
        task.stages = read_native_stage_runs(connection, &task.uuid)?;
        task.events = read_native_task_events(connection, &task.uuid)?;
        task.worker_leases = read_native_worker_leases(connection, &task.uuid)?;
        snapshots.push(task);
    }

    Ok(snapshots)
}

fn normalize_native_task_query_limit(limit: Option<u32>) -> i64 {
    i64::from(limit.unwrap_or(20).clamp(1, 100))
}

fn read_native_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutoCutNativeTaskSnapshot> {
    Ok(AutoCutNativeTaskSnapshot {
        uuid: row.get::<_, String>(0)?,
        task_type: row.get::<_, i64>(1)?,
        status: row.get::<_, i64>(2)?,
        progress: row.get::<_, i64>(3)?,
        source_asset_uuid: row.get::<_, Option<String>>(4)?,
        input_json: row.get::<_, String>(5)?,
        output_json: row.get::<_, String>(6)?,
        error_code: row.get::<_, Option<String>>(7)?,
        error_message: row.get::<_, Option<String>>(8)?,
        created_at: row.get::<_, String>(9)?,
        updated_at: row.get::<_, String>(10)?,
        stages: Vec::new(),
        events: Vec::new(),
        worker_leases: Vec::new(),
    })
}

fn read_native_stage_runs(
    connection: &Connection,
    task_uuid: &str,
) -> Result<Vec<AutoCutNativeStageRunSnapshot>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                uuid,
                stage_type,
                status,
                started_at,
                finished_at,
                diagnostics_json,
                created_at,
                updated_at
            FROM ops_stage_run
            WHERE task_uuid = ?1
            ORDER BY id ASC
            "#,
        )
        .map_err(|error| format!("prepare AutoCut native stage query failed: {error}"))?;
    let rows = statement
        .query_map([task_uuid], |row| {
            Ok(AutoCutNativeStageRunSnapshot {
                uuid: row.get::<_, String>(0)?,
                stage_type: row.get::<_, i64>(1)?,
                status: row.get::<_, i64>(2)?,
                started_at: row.get::<_, Option<String>>(3)?,
                finished_at: row.get::<_, Option<String>>(4)?,
                diagnostics_json: row.get::<_, String>(5)?,
                created_at: row.get::<_, String>(6)?,
                updated_at: row.get::<_, String>(7)?,
            })
        })
        .map_err(|error| format!("query AutoCut native stage snapshots failed: {error}"))?;

    let mut stages = Vec::new();
    for row in rows {
        stages.push(
            row.map_err(|error| format!("read AutoCut native stage snapshot failed: {error}"))?,
        );
    }
    Ok(stages)
}

fn read_native_task_events(
    connection: &Connection,
    task_uuid: &str,
) -> Result<Vec<AutoCutNativeTaskEventSnapshot>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                uuid,
                event_type,
                payload_json,
                created_at,
                updated_at
            FROM ops_task_event
            WHERE task_uuid = ?1
            ORDER BY id ASC
            "#,
        )
        .map_err(|error| format!("prepare AutoCut native task event query failed: {error}"))?;
    let rows = statement
        .query_map([task_uuid], |row| {
            let payload_json = row.get::<_, String>(2)?;
            let payload = parse_native_task_event_payload(&payload_json);
            Ok(AutoCutNativeTaskEventSnapshot {
                uuid: row.get::<_, String>(0)?,
                event_type: row.get::<_, i64>(1)?,
                payload,
                payload_json,
                created_at: row.get::<_, String>(3)?,
                updated_at: row.get::<_, String>(4)?,
            })
        })
        .map_err(|error| format!("query AutoCut native task event snapshots failed: {error}"))?;

    let mut events = Vec::new();
    for row in rows {
        events.push(
            row.map_err(|error| {
                format!("read AutoCut native task event snapshot failed: {error}")
            })?,
        );
    }
    Ok(events)
}

fn read_native_worker_leases(
    connection: &Connection,
    task_uuid: &str,
) -> Result<Vec<AutoCutNativeWorkerLeaseSnapshot>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                uuid,
                worker_id,
                lease_status,
                lease_token,
                acquired_at,
                heartbeat_at,
                expires_at,
                released_at,
                diagnostics_json,
                created_at,
                updated_at
            FROM ops_worker_lease
            WHERE task_uuid = ?1
            ORDER BY id ASC
            "#,
        )
        .map_err(|error| format!("prepare AutoCut native worker lease query failed: {error}"))?;
    let rows = statement
        .query_map([task_uuid], |row| {
            Ok(AutoCutNativeWorkerLeaseSnapshot {
                uuid: row.get::<_, String>(0)?,
                worker_id: row.get::<_, String>(1)?,
                lease_status: row.get::<_, i64>(2)?,
                lease_token: row.get::<_, String>(3)?,
                acquired_at: row.get::<_, String>(4)?,
                heartbeat_at: row.get::<_, String>(5)?,
                expires_at: row.get::<_, String>(6)?,
                released_at: row.get::<_, Option<String>>(7)?,
                diagnostics_json: row.get::<_, String>(8)?,
                created_at: row.get::<_, String>(9)?,
                updated_at: row.get::<_, String>(10)?,
            })
        })
        .map_err(|error| format!("query AutoCut native worker lease snapshots failed: {error}"))?;

    let mut worker_leases = Vec::new();
    for row in rows {
        worker_leases.push(row.map_err(|error| {
            format!("read AutoCut native worker lease snapshot failed: {error}")
        })?);
    }
    Ok(worker_leases)
}

fn cancel_autocut_native_task_on_connection(
    connection: &Connection,
    request: AutoCutNativeTaskCancelRequest,
) -> Result<AutoCutNativeTaskCancelResult, String> {
    let task_uuid = normalize_required_task_uuid(&request.task_uuid)?;
    let current_status = read_ops_task_status(connection, &task_uuid)?
        .ok_or_else(|| format!("ops_task not found for taskUuid {task_uuid}"))?;

    if current_status != OPS_STATUS_PROCESSING {
        return Ok(AutoCutNativeTaskCancelResult {
            task_uuid,
            status: current_status,
            canceled: false,
            message: "AutoCut native task is not in a cancellable processing state.".to_string(),
        });
    }

    if !has_tracked_native_media_process(&task_uuid) {
        return Ok(AutoCutNativeTaskCancelResult {
            task_uuid,
            status: current_status,
            canceled: false,
            message:
                "AutoCut native task has no active tracked native media process in this desktop session."
                    .to_string(),
        });
    }

    mark_ops_task_cancel_requested(connection, &task_uuid)?;
    insert_ops_task_event(
        connection,
        &task_uuid,
        OPS_TASK_EVENT_TYPE_CANCEL_REQUESTED,
        json!({
            "taskUuid": task_uuid,
            "operation": "cancelNativeTask"
        })
        .to_string(),
    )?;

    if !cancel_tracked_native_media_process(&task_uuid)? {
        return Ok(AutoCutNativeTaskCancelResult {
            task_uuid,
            status: OPS_STATUS_CANCEL_REQUESTED,
            canceled: false,
            message: "AutoCut native task process already exited after cancellation was requested."
                .to_string(),
        });
    }

    Ok(AutoCutNativeTaskCancelResult {
        task_uuid,
        status: OPS_STATUS_CANCEL_REQUESTED,
        canceled: true,
        message: "AutoCut native task cancellation was requested.".to_string(),
    })
}

fn recover_autocut_native_tasks_on_connection(
    connection: &Connection,
    request: AutoCutNativeTaskRecoveryRequest,
) -> Result<AutoCutNativeTaskRecoveryResult, String> {
    let limit = normalize_native_task_query_limit(request.limit);
    let mut statement = connection
        .prepare(
            r#"
            SELECT uuid, status
            FROM ops_task
            WHERE status IN (?1, ?2)
            ORDER BY updated_at ASC, id ASC
            LIMIT ?3
            "#,
        )
        .map_err(|error| format!("prepare AutoCut native task recovery query failed: {error}"))?;
    let rows = statement
        .query_map(
            params![OPS_STATUS_PROCESSING, OPS_STATUS_CANCEL_REQUESTED, limit],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| {
            format!("query AutoCut native task recovery candidates failed: {error}")
        })?;

    let mut candidates = Vec::new();
    for row in rows {
        candidates.push(row.map_err(|error| {
            format!("read AutoCut native task recovery candidate failed: {error}")
        })?);
    }

    let mut recovered_task_uuids = Vec::new();
    let mut interrupted = 0;
    let mut canceled = 0;
    let mut expired_leases = 0;
    let mut deferred = 0;
    for (task_uuid, status) in &candidates {
        expired_leases += expire_stale_ops_worker_leases(connection, task_uuid)?;
        if has_tracked_native_media_process(task_uuid) {
            continue;
        }
        if has_active_ops_worker_lease(connection, task_uuid)? {
            deferred += 1;
            continue;
        }
        let lease_signal = read_recovery_lease_signal(connection, task_uuid)?;

        match status {
            &OPS_STATUS_PROCESSING => {
                if mark_ops_task_interrupted(connection, task_uuid)? {
                    insert_ops_task_event(
                        connection,
                        task_uuid,
                        OPS_TASK_EVENT_TYPE_INTERRUPTED,
                        native_task_recovery_event_payload(
                            task_uuid,
                            "untrackedProcessingTask",
                            lease_signal.as_ref(),
                        )?,
                    )?;
                    interrupted += 1;
                    recovered_task_uuids.push(task_uuid.clone());
                }
            }
            &OPS_STATUS_CANCEL_REQUESTED => {
                if mark_ops_task_canceled(connection, task_uuid)? {
                    insert_ops_task_event(
                        connection,
                        task_uuid,
                        OPS_TASK_EVENT_TYPE_CANCELED,
                        native_task_recovery_event_payload(
                            task_uuid,
                            "untrackedCancelRequestedTask",
                            lease_signal.as_ref(),
                        )?,
                    )?;
                    canceled += 1;
                    recovered_task_uuids.push(task_uuid.clone());
                }
            }
            _ => {}
        }
    }

    Ok(AutoCutNativeTaskRecoveryResult {
        inspected: i64::try_from(candidates.len()).map_err(|_| {
            "AutoCut native task recovery inspected count exceeds int64".to_string()
        })?,
        recovered: i64::try_from(recovered_task_uuids.len())
            .map_err(|_| "AutoCut native task recovery count exceeds int64".to_string())?,
        interrupted,
        canceled,
        expired_leases,
        deferred,
        task_uuids: recovered_task_uuids,
    })
}

fn retry_autocut_native_task_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutNativeTaskRetryRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutNativeTaskRetryResult, String> {
    let task_uuid = normalize_required_task_uuid(&request.task_uuid)?;
    let source_task = read_retry_source_task(connection, &task_uuid)?
        .ok_or_else(|| format!("ops_task not found for taskUuid {task_uuid}"))?;
    if !is_retryable_ops_task_status(source_task.status) {
        return Err(format!(
            "AutoCut native task {} is not in a retryable state.",
            source_task.uuid
        ));
    }

    insert_ops_task_event(
        connection,
        &source_task.uuid,
        OPS_TASK_EVENT_TYPE_RETRY_REQUESTED,
        json!({
            "taskUuid": source_task.uuid,
            "operation": "retryNativeTask"
        })
        .to_string(),
    )?;

    let retry_task_uuid = match source_task.task_type {
        OPS_TASK_TYPE_AUDIO_EXTRACTION => {
            let retry_request = read_audio_retry_request(&source_task)?;
            extract_autocut_audio_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
            )?
            .task_uuid
        }
        OPS_TASK_TYPE_VIDEO_GIF => {
            let retry_request = read_video_gif_retry_request(&source_task)?;
            generate_autocut_gif_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
            )?
            .task_uuid
        }
        OPS_TASK_TYPE_VIDEO_SLICE => {
            let retry_request = read_video_slice_retry_request(&source_task)?;
            slice_autocut_video_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
            )?
            .task_uuid
        }
        OPS_TASK_TYPE_SPEECH_TRANSCRIPTION => {
            let retry_request = read_speech_transcription_retry_request(&source_task)?;
            let speech_toolchain = resolve_autocut_speech_toolchain();
            transcribe_autocut_media_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
                &speech_toolchain,
            )?
            .task_uuid
        }
        OPS_TASK_TYPE_VIDEO_COMPRESS => {
            let retry_request = read_video_compress_retry_request(&source_task)?;
            compress_autocut_video_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
            )?
            .task_uuid
        }
        OPS_TASK_TYPE_VIDEO_CONVERT => {
            let retry_request = read_video_convert_retry_request(&source_task)?;
            convert_autocut_video_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
            )?
            .task_uuid
        }
        OPS_TASK_TYPE_VIDEO_ENHANCE => {
            let retry_request = read_video_enhance_retry_request(&source_task)?;
            enhance_autocut_video_from_asset_in_root_with_toolchain(
                connection,
                root,
                retry_request,
                toolchain,
            )?
            .task_uuid
        }
        _ => {
            return Err(format!(
                "AutoCut native task {} has unsupported retry task type {}.",
                source_task.uuid, source_task.task_type
            ));
        }
    };
    let retry_status = read_ops_task_status(connection, &retry_task_uuid)?
        .ok_or_else(|| format!("retry ops_task not found for taskUuid {retry_task_uuid}"))?;

    Ok(AutoCutNativeTaskRetryResult {
        task_uuid: source_task.uuid,
        retry_task_uuid,
        status: retry_status,
        retried: true,
        message: "AutoCut native task retry created a new task.".to_string(),
    })
}

fn normalize_required_task_uuid(task_uuid: &str) -> Result<String, String> {
    let normalized_task_uuid = task_uuid.trim();
    if normalized_task_uuid.is_empty() {
        return Err("taskUuid is required for AutoCut native task cancellation".to_string());
    }
    Ok(normalized_task_uuid.to_string())
}

fn parse_ffmpeg_progress_percent(progress_output: &str, total_duration_ms: i64) -> Option<i64> {
    if total_duration_ms <= 0 {
        return None;
    }

    let mut out_time_ms = None;
    for line in progress_output.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let normalized_key = key.trim();
        let normalized_value = value.trim();
        let candidate = match normalized_key {
            "out_time_ms" | "out_time_us" => normalized_value
                .parse::<i64>()
                .ok()
                .map(|value| value / 1_000),
            "out_time" => parse_ffmpeg_out_time_to_millis(normalized_value),
            _ => None,
        };
        if let Some(candidate) = candidate {
            out_time_ms = Some(candidate);
        }
    }

    let out_time_ms = out_time_ms?;
    ffmpeg_progress_percent_from_millis(out_time_ms, total_duration_ms)
}

fn parse_ffmpeg_progress_time_millis(progress_line: &str) -> Option<i64> {
    let (key, value) = progress_line.split_once('=')?;
    let normalized_value = value.trim();
    match key.trim() {
        "out_time_ms" | "out_time_us" => normalized_value
            .parse::<i64>()
            .ok()
            .map(|value| value / 1_000),
        "out_time" => parse_ffmpeg_out_time_to_millis(normalized_value),
        _ => None,
    }
}

fn parse_ffmpeg_progress_time_percent(
    progress_time_ms: i64,
    total_duration_ms: i64,
) -> Option<i64> {
    parse_ffmpeg_progress_percent(
        &format!("out_time_ms={}", progress_time_ms.saturating_mul(1_000)),
        total_duration_ms,
    )
}

fn ffmpeg_progress_percent_from_millis(out_time_ms: i64, total_duration_ms: i64) -> Option<i64> {
    if total_duration_ms <= 0 {
        return None;
    }
    if out_time_ms <= 0 {
        return Some(1);
    }
    let raw_percent = out_time_ms.saturating_mul(100) / total_duration_ms;
    Some(raw_percent.clamp(1, 99))
}

fn parse_ffmpeg_duration_millis(ffmpeg_output: &str) -> Option<i64> {
    for line in ffmpeg_output.lines() {
        let Some(duration_start) = line.find("Duration:") else {
            continue;
        };
        let duration_text = line[duration_start + "Duration:".len()..]
            .split(',')
            .next()?
            .trim();
        if duration_text == "N/A" {
            continue;
        }
        if let Some(duration_ms) = parse_ffmpeg_out_time_to_millis(duration_text) {
            return Some(duration_ms);
        }
    }
    None
}

fn read_ffmpeg_media_duration_millis(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
) -> Result<i64, String> {
    let output = Command::new(&toolchain.executable)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(input_path)
        .output()
        .map_err(|error| format!("run AutoCut FFmpeg duration probe failed: {error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_duration_millis(stderr.as_ref()).ok_or_else(|| {
        format!(
            "AutoCut FFmpeg duration probe could not read media duration for {}",
            input_path.display()
        )
    })
}

fn ffmpeg_media_has_audio_stream(toolchain: &AutoCutFfmpegToolchain, input_path: &Path) -> bool {
    let Ok(output) = Command::new(&toolchain.executable)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(input_path)
        .output()
    else {
        return false;
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr.lines().any(|line| line.contains("Stream #") && line.contains("Audio:"))
}

pub(crate) fn autocut_speech_transcription_toolchain_ready() -> bool {
    resolve_autocut_speech_toolchain().ready
}

pub(crate) fn autocut_speech_transcription_toolchain_ready_for_app(app: &AppHandle) -> bool {
    let default_executable_path = autocut_default_speech_executable_path(app).ok();
    let default_model_path = autocut_default_speech_model_path_for_request(app, None).ok();
    resolve_autocut_speech_toolchain_for_app_request(
        Some(app),
        None,
        None,
        None,
        default_executable_path.as_deref(),
        default_model_path.as_deref(),
    )
    .ready
}

fn resolve_autocut_speech_toolchain() -> AutoCutSpeechToolchain {
    resolve_autocut_speech_toolchain_for_request(None, None, None, None, None)
}

fn resolve_autocut_speech_toolchain_for_request(
    executable_path: Option<&str>,
    model_path: Option<&str>,
    source_kind: Option<&str>,
    default_installed_executable_path: Option<&Path>,
    default_model_path: Option<&Path>,
) -> AutoCutSpeechToolchain {
    resolve_autocut_speech_toolchain_for_app_request(
        None,
        executable_path,
        model_path,
        source_kind,
        default_installed_executable_path,
        default_model_path,
    )
}

fn resolve_autocut_speech_toolchain_for_app_request(
    app: Option<&AppHandle>,
    executable_path: Option<&str>,
    model_path: Option<&str>,
    source_kind: Option<&str>,
    default_installed_executable_path: Option<&Path>,
    default_model_path: Option<&Path>,
) -> AutoCutSpeechToolchain {
    resolve_autocut_speech_toolchain_from_candidate_manifests(
        executable_path,
        model_path,
        source_kind,
        &autocut_speech_toolchain_manifest_candidate_paths(app),
        default_installed_executable_path,
        std::env::var("SDKWORK_AUTOCUT_WHISPER_EXECUTABLE")
            .ok()
            .as_deref(),
        std::env::var("SDKWORK_AUTOCUT_WHISPER_MODEL").ok().as_deref(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        default_model_path,
        std::env::var("PATH").ok().as_deref(),
        &autocut_common_speech_executable_candidate_paths(),
    )
}

fn resolve_autocut_speech_toolchain_from_candidate_manifests(
    executable_path: Option<&str>,
    model_path: Option<&str>,
    source_kind: Option<&str>,
    manifest_paths: &[PathBuf],
    default_installed_executable_path: Option<&Path>,
    env_executable: Option<&str>,
    env_model_path: Option<&str>,
    os: &str,
    arch: &str,
    default_model_path: Option<&Path>,
    path_env: Option<&str>,
    common_executable_candidate_paths: &[PathBuf],
) -> AutoCutSpeechToolchain {
    let default_model_path_value = default_model_path.map(|path| path.display().to_string());
    let default_model_directory = default_model_path
        .and_then(Path::parent)
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    let default_model_path_text = default_model_path_value.clone().unwrap_or_default();
    let default_executable_path = default_installed_executable_path
        .map(Path::to_path_buf)
        .or_else(|| {
            resolve_autocut_default_bundled_speech_executable_path(
                manifest_paths,
                os,
                arch,
            )
        });
    let default_executable_path_text = default_executable_path
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    let default_executable_directory = default_executable_path
        .as_ref()
        .and_then(|path| path.parent())
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    let executable_strategy =
        "Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli"
            .to_string();
    let explicit_executable = executable_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let explicit_model_path = model_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let resolved_source_kind = if explicit_executable.is_some() || explicit_model_path.is_some() {
        source_kind
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("settings")
            .to_string()
    } else {
        "env".to_string()
    };
    let env_executable_value = env_executable
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let env_model_value = env_model_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let bundled_executable = if explicit_executable.is_none() && env_executable_value.is_none() {
        resolve_autocut_bundled_speech_executable_from_candidate_manifests(manifest_paths, os, arch)
    } else {
        None
    };
    let mut diagnostics = bundled_executable
        .as_ref()
        .map(|toolchain| toolchain.diagnostics.clone())
        .unwrap_or_default();
    let bundled_executable_path = bundled_executable
        .as_ref()
        .map(|toolchain| toolchain.executable.clone());
    let installed_executable = if explicit_executable.is_none()
        && env_executable_value.is_none()
        && bundled_executable_path.is_none()
    {
        default_installed_executable_path
            .filter(|path| path.is_file())
            .map(Path::to_path_buf)
    } else {
        None
    };
    let installed_executable_path = installed_executable
        .as_ref()
        .map(|path| path.display().to_string());
    let discovered_executable =
        if explicit_executable.is_none()
            && env_executable_value.is_none()
            && bundled_executable_path.is_none()
            && installed_executable_path.is_none()
        {
            resolve_autocut_speech_executable_from_system_candidates(
                path_env,
                common_executable_candidate_paths,
                os,
            )
        } else {
            None
        };
    let discovered_executable_path = discovered_executable
        .as_ref()
        .map(|path| path.display().to_string());
    let executable = explicit_executable
        .or(env_executable_value)
        .or_else(|| bundled_executable_path.clone())
        .or_else(|| installed_executable_path.clone())
        .or_else(|| discovered_executable_path.clone());
    let default_model_value = default_model_path
        .filter(|path| path.is_file())
        .map(|path| path.display().to_string());
    let model_path = explicit_model_path.or(env_model_value).or(default_model_value);
    let executable_source_kind = bundled_executable_path
        .as_deref()
        .filter(|bundled_path| executable.as_deref() == Some(*bundled_path))
        .map(|_| "bundled-sidecar")
        .or_else(|| {
            installed_executable_path
                .as_deref()
                .filter(|installed_path| executable.as_deref() == Some(*installed_path))
                .map(|_| "app-data-runtime")
        })
        .or_else(|| {
            discovered_executable_path
                .as_deref()
                .filter(|discovered_path| executable.as_deref() == Some(*discovered_path))
                .map(|_| "system-path")
        });

    let Some(executable) = executable else {
        diagnostics.push("AutoCut local speech transcription executablePath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.".to_string());
        return AutoCutSpeechToolchain {
            executable: String::new(),
            model_path: String::new(),
            source_kind: resolved_source_kind,
            executable_ready: false,
            model_ready: false,
            ready: false,
            diagnostics,
            default_executable_directory,
            default_executable_path: default_executable_path_text,
            default_model_directory,
            default_model_path: default_model_path_text,
            executable_strategy,
        };
    };
    let Some(model_path) = model_path else {
        diagnostics.push("AutoCut local speech transcription modelPath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_MODEL, and the default local model path.".to_string());
        return AutoCutSpeechToolchain {
            executable,
            model_path: String::new(),
            source_kind: executable_source_kind
                .unwrap_or(resolved_source_kind.as_str())
                .to_string(),
            executable_ready: true,
            model_ready: false,
            ready: false,
            diagnostics,
            default_executable_directory,
            default_executable_path: default_executable_path_text,
            default_model_directory,
            default_model_path: default_model_path_text,
            executable_strategy,
        };
    };
    let mut executable_ready = true;
    let mut model_ready = true;
    if let Err(error) = ensure_supported_speech_executable_file_path(&executable) {
        executable_ready = false;
        diagnostics.push(error);
    }
    if let Err(error) = ensure_supported_speech_model_file_path(&model_path) {
        model_ready = false;
        diagnostics.push(error);
    }

    AutoCutSpeechToolchain {
        executable,
        model_path,
        source_kind: executable_source_kind
            .unwrap_or(resolved_source_kind.as_str())
            .to_string(),
        executable_ready,
        model_ready,
        ready: diagnostics.is_empty(),
        diagnostics,
        default_executable_directory,
        default_executable_path: default_executable_path_text,
        default_model_directory,
        default_model_path: default_model_path_text,
        executable_strategy,
    }
}

fn resolve_autocut_default_bundled_speech_executable_path(
    manifest_paths: &[PathBuf],
    os: &str,
    arch: &str,
) -> Option<PathBuf> {
    for manifest_path in manifest_paths {
        if let Ok(manifest) = parse_autocut_speech_toolchain_manifest(manifest_path) {
            if validate_autocut_speech_toolchain_manifest(&manifest).is_err() {
                continue;
            }
            let platform_key = autocut_ffmpeg_platform_key(os, arch);
            if let Some(platform) = manifest.platforms.get(platform_key.as_str()) {
                if let Some(parent) = manifest_path.parent() {
                    return Some(join_autocut_manifest_relative_path(
                        parent,
                        &platform.relative_path,
                    ));
                }
            }
        }
    }

    None
}

fn resolve_autocut_speech_executable_from_system_candidates(
    path_env: Option<&str>,
    common_executable_candidate_paths: &[PathBuf],
    os: &str,
) -> Option<PathBuf> {
    let binary_names = autocut_speech_executable_binary_names(os);
    for directory in split_autocut_system_path_directories(path_env, os) {
        for binary_name in &binary_names {
            let candidate = directory.join(binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for candidate in common_executable_candidate_paths {
        if candidate.is_file() {
            return Some(candidate.clone());
        }
    }
    None
}

fn split_autocut_system_path_directories(path_env: Option<&str>, os: &str) -> Vec<PathBuf> {
    path_env
        .unwrap_or_default()
        .split(if os == "windows" { ';' } else { ':' })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn autocut_speech_executable_binary_names(os: &str) -> Vec<&'static str> {
    if os == "windows" {
        vec!["whisper-cli.exe", "whisper.exe", "main.exe"]
    } else {
        vec!["whisper-cli", "whisper", "main"]
    }
}

fn autocut_common_speech_executable_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(windows) {
        candidates.push(PathBuf::from(r"C:\Program Files\whisper.cpp\whisper-cli.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files\whisper.cpp\main.exe"));
        candidates.push(PathBuf::from(r"C:\tools\whisper-cli.exe"));
        candidates.push(PathBuf::from(r"C:\tools\whisper.cpp\whisper-cli.exe"));
    } else if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/whisper-cli"));
        candidates.push(PathBuf::from("/usr/local/bin/whisper-cli"));
        candidates.push(PathBuf::from("/opt/local/bin/whisper-cli"));
    } else {
        candidates.push(PathBuf::from("/usr/local/bin/whisper-cli"));
        candidates.push(PathBuf::from("/usr/bin/whisper-cli"));
        candidates.push(PathBuf::from("/opt/whisper.cpp/whisper-cli"));
    }
    candidates
}

fn autocut_speech_toolchain_manifest_candidate_paths(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut manifest_paths = Vec::new();
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            manifest_paths.push(
                resource_dir
                    .join("binaries")
                    .join(AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_FILE_NAME),
            );
        }
    }
    manifest_paths.push(autocut_source_speech_toolchain_manifest_path());
    manifest_paths
}

fn autocut_source_speech_toolchain_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_FILE_NAME)
}

fn resolve_autocut_bundled_speech_executable_from_candidate_manifests(
    manifest_paths: &[PathBuf],
    os: &str,
    arch: &str,
) -> Option<AutoCutSpeechToolchain> {
    let mut diagnostics = Vec::new();
    for manifest_path in manifest_paths {
        match resolve_autocut_bundled_speech_executable_from_manifest(manifest_path, os, arch) {
            Ok(mut toolchain) => {
                toolchain.diagnostics.splice(0..0, diagnostics);
                return Some(toolchain);
            }
            Err(error) => diagnostics.push(error),
        }
    }

    None
}

fn resolve_autocut_bundled_speech_executable_from_manifest(
    manifest_path: &Path,
    os: &str,
    arch: &str,
) -> Result<AutoCutSpeechToolchain, String> {
    let manifest = parse_autocut_speech_toolchain_manifest(manifest_path)?;
    validate_autocut_speech_toolchain_manifest(&manifest)?;
    let platform_key = autocut_ffmpeg_platform_key(os, arch);
    let platform = manifest
        .platforms
        .get(platform_key.as_str())
        .ok_or_else(|| {
            format!("speech toolchain manifest has no platform entry for {platform_key}")
        })?;
    let sidecar_path = manifest_path
        .parent()
        .ok_or_else(|| {
            format!(
                "resolve speech toolchain manifest parent failed: {}",
                manifest_path.display()
            )
        })?
        .to_path_buf();
    let sidecar_path = join_autocut_manifest_relative_path(&sidecar_path, &platform.relative_path);
    if !sidecar_path.is_file() {
        return Err(format!(
            "missing bundled speech transcription sidecar {}",
            sidecar_path.display()
        ));
    }
    verify_autocut_ffmpeg_sidecar_integrity(&sidecar_path, platform).map_err(|error| {
        error.replace("bundled FFmpeg sidecar", "bundled speech transcription sidecar")
    })?;
    let sidecar_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "resolve speech toolchain manifest parent failed: {}",
            manifest_path.display()
        )
    })?;
    verify_autocut_speech_sidecar_companion_files(sidecar_root, platform)?;

    Ok(AutoCutSpeechToolchain {
        executable: sidecar_path.display().to_string(),
        model_path: String::new(),
        source_kind: "bundled-sidecar".to_string(),
        executable_ready: true,
        model_ready: false,
        ready: false,
        diagnostics: Vec::new(),
        default_executable_directory: sidecar_path
            .parent()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        default_executable_path: sidecar_path.display().to_string(),
        default_model_directory: String::new(),
        default_model_path: String::new(),
        executable_strategy: "verified bundled sidecar".to_string(),
    })
}

fn verify_autocut_speech_sidecar_companion_files(
    sidecar_root: &Path,
    platform: &AutoCutFfmpegPlatformToolchain,
) -> Result<(), String> {
    for companion_file in &platform.companion_files {
        let companion_path =
            join_autocut_manifest_relative_path(sidecar_root, &companion_file.relative_path);
        if !companion_path.is_file() {
            return Err(format!(
                "missing bundled speech transcription sidecar companion {}",
                companion_path.display()
            ));
        }
        verify_autocut_ffmpeg_sidecar_integrity_with_integrity(
            &companion_path,
            &companion_file.integrity,
        )
        .map_err(|error| {
            error.replace("bundled FFmpeg sidecar", "bundled speech transcription sidecar companion")
        })?;
    }

    Ok(())
}

fn join_autocut_manifest_relative_path(parent: &Path, relative_path: &str) -> PathBuf {
    relative_path
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .fold(parent.to_path_buf(), |path, segment| path.join(segment))
}

fn parse_autocut_speech_toolchain_manifest(
    manifest_path: &Path,
) -> Result<AutoCutSpeechToolchainManifest, String> {
    let source = fs::read_to_string(manifest_path).map_err(|error| {
        format!(
            "read speech toolchain manifest {} failed: {error}",
            manifest_path.display()
        )
    })?;
    let embedded_manifest = AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_JSON;
    serde_json::from_str(&source)
        .map_err(|error| format!("parse speech toolchain manifest failed: {error}"))
        .and_then(|manifest: AutoCutSpeechToolchainManifest| {
            if embedded_manifest.contains("\"tool\"") {
                Ok(manifest)
            } else {
                Err("embedded speech toolchain manifest contract is invalid".to_string())
            }
        })
}

fn validate_autocut_speech_toolchain_manifest(
    manifest: &AutoCutSpeechToolchainManifest,
) -> Result<(), String> {
    if manifest.tool != "whisper-cli" {
        return Err(format!(
            "speech toolchain manifest declares unsupported tool {}",
            manifest.tool
        ));
    }
    if manifest.contract_version.trim().is_empty() {
        return Err("speech toolchain manifest contractVersion must be non-empty".to_string());
    }
    if manifest.required_binary.trim().is_empty() {
        return Err("speech toolchain manifest requiredBinary must be non-empty".to_string());
    }
    if manifest.license.name.trim().is_empty()
        || manifest.license.spdx_expression.trim().is_empty()
        || manifest.license.notice.trim().is_empty()
    {
        return Err("speech toolchain manifest license metadata must be complete".to_string());
    }
    for (platform_key, platform) in &manifest.platforms {
        if platform.relative_path.trim().is_empty() {
            return Err(format!(
                "speech toolchain manifest platform {platform_key} relativePath must be non-empty"
            ));
        }
        if platform.binary_name.trim().is_empty() {
            return Err(format!(
                "speech toolchain manifest platform {platform_key} binaryName must be non-empty"
            ));
        }
        if !platform.relative_path.ends_with(&platform.binary_name) {
            return Err(format!(
                "speech toolchain manifest platform {platform_key} binaryName must match relativePath"
            ));
        }
        if platform.relative_path.contains("..")
            || Path::new(&platform.relative_path).is_absolute()
            || platform
                .relative_path
                .split(['/', '\\'])
                .any(|segment| segment.is_empty())
        {
            return Err(format!(
                "speech toolchain manifest platform {platform_key} relativePath must be a safe relative path"
            ));
        }
        for companion_file in &platform.companion_files {
            validate_autocut_speech_toolchain_companion_file(platform_key, companion_file)?;
        }
        if platform.integrity.sha256.len() != 64
            || !platform
                .integrity
                .sha256
                .chars()
                .all(|ch| ch.is_ascii_hexdigit())
        {
            return Err(format!(
                "speech toolchain manifest platform {platform_key} sha256 must be a 64 character hex digest"
            ));
        }
        if manifest.bundled_ready
            && (platform.integrity.byte_size == 0
                || platform.integrity.sha256
                    == "0000000000000000000000000000000000000000000000000000000000000000")
        {
            return Err(format!(
                "speech toolchain manifest platform {platform_key} cannot claim bundled readiness with placeholder integrity"
            ));
        }
    }

    Ok(())
}

fn validate_autocut_speech_toolchain_companion_file(
    platform_key: &str,
    companion_file: &AutoCutToolchainCompanionFile,
) -> Result<(), String> {
    if companion_file.relative_path.trim().is_empty() {
        return Err(format!(
            "speech toolchain manifest platform {platform_key} companion relativePath must be non-empty"
        ));
    }
    if companion_file.relative_path.contains("..")
        || Path::new(&companion_file.relative_path).is_absolute()
        || companion_file
            .relative_path
            .split(['/', '\\'])
            .any(|segment| segment.is_empty())
    {
        return Err(format!(
            "speech toolchain manifest platform {platform_key} companion relativePath must be a safe relative path"
        ));
    }
    if companion_file.integrity.sha256.len() != 64
        || !companion_file
            .integrity
            .sha256
            .chars()
            .all(|ch| ch.is_ascii_hexdigit())
    {
        return Err(format!(
            "speech toolchain manifest platform {platform_key} companion sha256 must be a 64 character hex digest"
        ));
    }

    Ok(())
}

fn ensure_supported_speech_executable_file_path(executable_path: &str) -> Result<(), String> {
    let path = Path::new(executable_path);
    if !path.is_absolute() {
        return Err(
            "AutoCut local speech transcription executablePath must be an absolute local executable file path."
                .to_string(),
        );
    }
    if !path.is_file() {
        return Err(format!(
            "AutoCut local speech transcription executablePath does not point to a readable file: {executable_path}"
        ));
    }

    Ok(())
}

fn ensure_supported_speech_model_file_path(model_path: &str) -> Result<(), String> {
    let path = Path::new(model_path);
    if !path.is_absolute() {
        return Err(
            "AutoCut local speech transcription modelPath must be an absolute local model file path."
                .to_string(),
        );
    }
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|file_name| file_name.ends_with(".download"))
        .unwrap_or(false)
    {
        return Err(
            "AutoCut local speech transcription modelPath points to a partial .download file; use the Settings model downloader again and select the installed model file.".to_string(),
        );
    }
    if !path.is_file() {
        return Err(format!(
            "AutoCut local speech transcription modelPath does not point to a readable file: {model_path}"
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS
        .iter()
        .any(|supported| *supported == extension)
    {
        return Err(format!(
            "AutoCut local speech transcription modelPath must use a supported model file extension: {}.",
            SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.join(", ")
        ));
    }
    let byte_size = fs::metadata(path)
        .map_err(|error| {
            format!("read AutoCut local speech transcription model metadata failed: {error}")
        })?
        .len();
    if byte_size < MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES {
        return Err(format!(
            "AutoCut local speech transcription modelPath is missing or incomplete: {model_path} is {byte_size} bytes, below the minimum viable local STT model size. Use the Settings recommended offline Whisper model downloader again."
        ));
    }

    Ok(())
}

fn read_speech_toolchain_version_line(output: &Output) -> Option<String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn parse_whisper_transcript_json(
    source: &str,
) -> Result<Vec<AutoCutSpeechTranscriptionSegment>, String> {
    if source.len() > MAX_SPEECH_TRANSCRIPT_JSON_BYTES {
        return Err(format!(
            "AutoCut Whisper transcript JSON is too large: {} bytes exceeds {} bytes",
            source.len(),
            MAX_SPEECH_TRANSCRIPT_JSON_BYTES
        ));
    }

    let value: Value = serde_json::from_str(source)
        .map_err(|error| format!("parse AutoCut Whisper transcript JSON failed: {error}"))?;
    let segments_value = read_whisper_segments_array(&value)?;
    if segments_value.len() > MAX_SPEECH_TRANSCRIPT_SEGMENTS {
        return Err(format!(
            "AutoCut Whisper transcript JSON contains too many segments: {} exceeds {}",
            segments_value.len(),
            MAX_SPEECH_TRANSCRIPT_SEGMENTS
        ));
    }

    let mut segments = Vec::new();
    for segment_value in segments_value {
        let text = segment_value
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }
        let start_ms =
            read_whisper_segment_time_ms(segment_value, "start", "start_ms", "offsets", 0)?;
        let end_ms = read_whisper_segment_time_ms(segment_value, "end", "end_ms", "offsets", 1)?;
        if end_ms <= start_ms {
            continue;
        }
        let speaker = segment_value
            .get("speaker")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        segments.push(AutoCutSpeechTranscriptionSegment {
            start_ms,
            end_ms,
            text,
            speaker,
        });
    }

    if segments.is_empty() {
        return Err(
            "AutoCut Whisper transcript JSON contains no usable transcript segments".to_string(),
        );
    }

    segments.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then_with(|| first.end_ms.cmp(&second.end_ms))
    });

    Ok(segments)
}

fn read_whisper_transcript_json_file(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("inspect AutoCut speech transcript JSON failed: {error}"))?;
    let byte_size = metadata.len();
    if byte_size > MAX_SPEECH_TRANSCRIPT_JSON_BYTES as u64 {
        return Err(format!(
            "AutoCut speech transcript JSON is too large: {byte_size} bytes exceeds {} bytes",
            MAX_SPEECH_TRANSCRIPT_JSON_BYTES
        ));
    }

    fs::read_to_string(path)
        .map_err(|error| format!("read AutoCut speech transcript JSON failed: {error}"))
}

fn read_whisper_segments_array(value: &Value) -> Result<&Vec<Value>, String> {
    value
        .get("transcription")
        .and_then(Value::as_array)
        .or_else(|| value.get("segments").and_then(Value::as_array))
        .or_else(|| value.get("chunks").and_then(Value::as_array))
        .or_else(|| value.get("result").and_then(|result| result.get("segments")).and_then(Value::as_array))
        .or_else(|| value.get("result").and_then(|result| result.get("chunks")).and_then(Value::as_array))
        .ok_or_else(|| "AutoCut Whisper transcript JSON must contain transcription, segments, chunks, result.segments, or result.chunks array".to_string())
}

fn read_whisper_segment_time_ms(
    segment: &Value,
    field_name: &str,
    milliseconds_field_name: &str,
    offsets_field_name: &str,
    offsets_index: usize,
) -> Result<i64, String> {
    if let Some(value) = segment.get(field_name) {
        return whisper_segment_boundary_time_to_ms(value)
            .ok_or_else(|| format!("AutoCut Whisper segment {field_name} is not a valid time"));
    }
    if let Some(value) = segment.get(milliseconds_field_name) {
        return whisper_time_to_ms(value).ok_or_else(|| {
            format!(
                "AutoCut Whisper segment {milliseconds_field_name} is not a valid millisecond time"
            )
        });
    }
    if let Some(offset_value) =
        read_whisper_indexed_time(segment, offsets_field_name, offsets_index)
    {
        return whisper_time_to_ms(offset_value).ok_or_else(|| {
            format!(
                "AutoCut Whisper segment {offsets_field_name}[{offsets_index}] is not a valid time"
            )
        });
    }
    if let Some(timestamp_value) = read_whisper_indexed_time(segment, "timestamps", offsets_index) {
        return whisper_segment_boundary_time_to_ms(timestamp_value).ok_or_else(|| {
            format!("AutoCut Whisper segment timestamps[{offsets_index}] is not a valid time")
        });
    }
    if let Some(timestamp_value) = read_whisper_indexed_time(segment, "timestamp", offsets_index) {
        return whisper_segment_boundary_time_to_ms(timestamp_value).ok_or_else(|| {
            format!("AutoCut Whisper segment timestamp[{offsets_index}] is not a valid time")
        });
    }
    Err(format!(
        "AutoCut Whisper segment is missing {field_name}, {milliseconds_field_name}, {offsets_field_name}[{offsets_index}], timestamps[{offsets_index}], or timestamp[{offsets_index}]"
    ))
}

fn read_whisper_indexed_time<'a>(
    segment: &'a Value,
    field_name: &str,
    offsets_index: usize,
) -> Option<&'a Value> {
    segment.get(field_name).and_then(|offsets| {
        offsets
            .as_array()
            .and_then(|offsets| offsets.get(offsets_index))
            .or_else(|| {
                offsets.as_object().and_then(|offsets| {
                    let object_field = if offsets_index == 0 { "from" } else { "to" };
                    offsets.get(object_field)
                })
            })
    })
}

fn whisper_time_to_ms(value: &Value) -> Option<i64> {
    if let Some(milliseconds) = value.as_i64() {
        return Some(milliseconds);
    }
    if let Some(time_text) = value.as_str() {
        return parse_whisper_timestamp_to_millis(time_text);
    }
    value
        .as_f64()
        .filter(|seconds| seconds.is_finite())
        .map(|seconds| (seconds * 1_000.0).round() as i64)
}

fn whisper_segment_boundary_time_to_ms(value: &Value) -> Option<i64> {
    if let Some(time_text) = value.as_str() {
        return parse_whisper_timestamp_to_millis(time_text);
    }
    value
        .as_f64()
        .filter(|seconds| seconds.is_finite())
        .map(|seconds| (seconds * 1_000.0).round() as i64)
}

fn parse_whisper_timestamp_to_millis(value: &str) -> Option<i64> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }

    if normalized.contains(':') {
        return parse_ffmpeg_out_time_to_millis(&normalized.replace(',', "."));
    }

    normalized
        .parse::<f64>()
        .ok()
        .filter(|seconds| seconds.is_finite())
        .map(|seconds| (seconds * 1_000.0).round() as i64)
}

fn parse_ffmpeg_out_time_to_millis(value: &str) -> Option<i64> {
    let mut parts = value.trim().split(':');
    let hours = parts.next()?.parse::<i64>().ok()?;
    let minutes = parts.next()?.parse::<i64>().ok()?;
    let seconds = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let (seconds_text, fraction_text) = seconds
        .split_once('.')
        .map_or((seconds, ""), |(whole, fraction)| (whole, fraction));
    let seconds = seconds_text.parse::<i64>().ok()?;
    let fraction_ms = if fraction_text.is_empty() {
        0
    } else {
        let millis_text = fraction_text.chars().take(3).collect::<String>();
        let padded_millis_text = format!("{millis_text:0<3}");
        padded_millis_text.parse::<i64>().ok()?
    };

    Some(((hours * 60 + minutes) * 60 + seconds) * 1_000 + fraction_ms)
}

fn read_ops_task_status(connection: &Connection, task_uuid: &str) -> Result<Option<i64>, String> {
    connection
        .query_row(
            "SELECT status FROM ops_task WHERE uuid = ?1",
            [task_uuid],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("read AutoCut ops_task status failed: {error}"))
}

fn native_task_recovery_event_payload(
    task_uuid: &str,
    default_reason: &str,
    lease_signal: Option<&AutoCutRecoveryLeaseSignal>,
) -> Result<String, String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    let mut payload = json!({
        "taskUuid": normalized_task_uuid,
        "operation": "recoverNativeTasks",
        "reason": default_reason
    });

    if let Some(signal) = lease_signal {
        payload["leaseUuid"] = json!(signal.lease_uuid);
        payload["leaseStatus"] = json!(signal.lease_status);
        payload["reason"] = json!(signal.reason);
    }

    Ok(payload.to_string())
}

fn read_retry_source_task(
    connection: &Connection,
    task_uuid: &str,
) -> Result<Option<AutoCutRetrySourceTask>, String> {
    connection
        .query_row(
            r#"
            SELECT uuid, task_type, status, source_asset_uuid, input_json
            FROM ops_task
            WHERE uuid = ?1
            "#,
            [task_uuid],
            |row| {
                Ok(AutoCutRetrySourceTask {
                    uuid: row.get::<_, String>(0)?,
                    task_type: row.get::<_, i64>(1)?,
                    status: row.get::<_, i64>(2)?,
                    source_asset_uuid: row.get::<_, Option<String>>(3)?,
                    input_json: row.get::<_, String>(4)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("read AutoCut retry source task failed: {error}"))
}

fn is_retryable_ops_task_status(status: i64) -> bool {
    matches!(
        status,
        OPS_STATUS_FAILED | OPS_STATUS_CANCELED | OPS_STATUS_INTERRUPTED
    )
}

fn retry_source_payload(task: &AutoCutRetrySourceTask) -> Result<serde_json::Value, String> {
    serde_json::from_str(&task.input_json)
        .map_err(|error| format!("parse AutoCut retry input_json failed: {error}"))
}

fn retry_asset_uuid(task: &AutoCutRetrySourceTask) -> Result<String, String> {
    let payload = retry_source_payload(task)?;
    let payload_asset_uuid = payload
        .get("assetUuid")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    payload_asset_uuid
        .or_else(|| task.source_asset_uuid.clone())
        .ok_or_else(|| format!("AutoCut retry source task {} has no assetUuid", task.uuid))
}

fn retry_string_field(
    task: &AutoCutRetrySourceTask,
    field_name: &str,
    default_value: Option<&str>,
) -> Result<String, String> {
    let payload = retry_source_payload(task)?;
    if let Some(value) = payload
        .get(field_name)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(value.to_string());
    }
    default_value.map(str::to_string).ok_or_else(|| {
        format!(
            "AutoCut retry source task {} has no required {}",
            task.uuid, field_name
        )
    })
}

fn retry_bool_field(
    task: &AutoCutRetrySourceTask,
    field_name: &str,
    default_value: bool,
) -> Result<bool, String> {
    let payload = retry_source_payload(task)?;
    Ok(payload
        .get(field_name)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(default_value))
}

fn retry_optional_string_field(
    task: &AutoCutRetrySourceTask,
    field_name: &str,
) -> Result<Option<String>, String> {
    let payload = retry_source_payload(task)?;
    Ok(payload
        .get(field_name)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn retry_output_root_dir(task: &AutoCutRetrySourceTask) -> Result<Option<String>, String> {
    let payload = retry_source_payload(task)?;
    Ok(payload
        .get("outputRootDir")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn read_audio_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutAudioExtractionRequest, String> {
    Ok(AutoCutAudioExtractionRequest {
        asset_uuid: retry_asset_uuid(task)?,
        output_format: retry_string_field(task, "outputFormat", None)?,
        output_root_dir: retry_output_root_dir(task)?,
    })
}

fn read_video_gif_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutVideoGifRequest, String> {
    Ok(AutoCutVideoGifRequest {
        asset_uuid: retry_asset_uuid(task)?,
        fps: retry_string_field(task, "fps", None)?,
        resolution: retry_string_field(task, "resolution", None)?,
        dither: retry_bool_field(task, "dither", true)?,
        output_root_dir: retry_output_root_dir(task)?,
    })
}

fn read_video_compress_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutVideoCompressRequest, String> {
    Ok(AutoCutVideoCompressRequest {
        asset_uuid: retry_asset_uuid(task)?,
        compression_mode: retry_string_field(task, "compressionMode", None)?,
        output_root_dir: retry_output_root_dir(task)?,
    })
}

fn read_video_slice_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutVideoSliceRequest, String> {
    let payload = retry_source_payload(task)?;
    let clips = payload
        .get("clips")
        .cloned()
        .ok_or_else(|| format!("AutoCut retry source task {} has no clips", task.uuid))
        .and_then(|value| {
            serde_json::from_value::<Vec<AutoCutVideoSliceClipRequest>>(value)
                .map_err(|error| format!("parse AutoCut video slice retry clips failed: {error}"))
        })?;
    ensure_video_slice_retry_clips_have_transcript_evidence(&task.uuid, &clips)?;

    Ok(AutoCutVideoSliceRequest {
        asset_uuid: retry_asset_uuid(task)?,
        clips,
        output_format: retry_string_field(task, "outputFormat", Some("mp4"))?,
        output_root_dir: retry_output_root_dir(task)?,
        render_profile: payload
            .get("renderProfile")
            .cloned()
            .map(|value| {
                serde_json::from_value::<AutoCutVideoSliceRenderProfile>(value).map_err(|error| {
                    format!("parse AutoCut video slice retry renderProfile failed: {error}")
                })
            })
            .transpose()?,
        noise_reduction: retry_bool_field(task, "noiseReduction", false)?,
        subtitle_format: retry_optional_string_field(task, "subtitleFormat")?,
        subtitle_mode: retry_optional_string_field(task, "subtitleMode")?,
        subtitle_style_id: retry_optional_string_field(task, "subtitleStyleId")?,
        subtitle_segments: payload
            .get("subtitleSegments")
            .cloned()
            .map(|value| {
                serde_json::from_value::<Vec<AutoCutSpeechTranscriptionSegment>>(value).map_err(
                    |error| {
                        format!("parse AutoCut video slice retry subtitleSegments failed: {error}")
                    },
                )
            })
            .transpose()?,
    })
}

fn ensure_video_slice_retry_clips_have_transcript_evidence(
    task_uuid: &str,
    clips: &[AutoCutVideoSliceClipRequest],
) -> Result<(), String> {
    for (index, clip) in clips.iter().enumerate() {
        let clip_number = index + 1;
        if clip
            .transcript_segments
            .as_ref()
            .filter(|segments| !segments.is_empty())
            .is_none()
            || clip
                .transcript_text
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .is_none()
        {
            return Err(format!(
                "AutoCut native video slice retry cannot reuse transcript-less legacy clips from task {task_uuid}; clip {clip_number} is missing speech-to-text transcript evidence. Re-run Smart Slice after speech-to-text setup so every generated clip has verified transcript evidence."
            ));
        }
    }

    Ok(())
}

fn read_speech_transcription_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutSpeechTranscriptionRequest, String> {
    Ok(AutoCutSpeechTranscriptionRequest {
        asset_uuid: retry_asset_uuid(task)?,
        provider_id: retry_optional_string_field(task, "providerId")?,
        language: Some(retry_string_field(task, "language", Some("auto"))?),
        output_root_dir: retry_output_root_dir(task)?,
        executable_path: retry_optional_string_field(task, "executablePath")?,
        model_path: retry_optional_string_field(task, "modelPath")?,
        workflow_purpose: retry_optional_string_field(task, "workflowPurpose")?,
    })
}

fn read_video_convert_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutVideoConvertRequest, String> {
    Ok(AutoCutVideoConvertRequest {
        asset_uuid: retry_asset_uuid(task)?,
        target_format: retry_string_field(task, "targetFormat", None)?,
        video_codec: retry_string_field(task, "videoCodec", None)?,
        audio_codec: retry_string_field(task, "audioCodec", None)?,
        resolution: retry_string_field(task, "resolution", Some("original"))?,
        output_root_dir: retry_output_root_dir(task)?,
    })
}

fn read_video_enhance_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutVideoEnhanceRequest, String> {
    Ok(AutoCutVideoEnhanceRequest {
        asset_uuid: retry_asset_uuid(task)?,
        target_resolution: retry_string_field(task, "targetResolution", None)?,
        enhance_mode: retry_string_field(task, "enhanceMode", None)?,
        frame_rate: retry_string_field(task, "frameRate", Some("original"))?,
        output_root_dir: retry_output_root_dir(task)?,
    })
}

fn mark_ops_task_cancel_requested(connection: &Connection, task_uuid: &str) -> Result<(), String> {
    let changed = connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                error_code = 'CANCEL_REQUESTED',
                error_message = 'AutoCut native task cancellation was requested.',
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?2
              AND status = ?3
            "#,
            params![
                OPS_STATUS_CANCEL_REQUESTED,
                task_uuid,
                OPS_STATUS_PROCESSING
            ],
        )
        .map_err(|error| format!("mark AutoCut ops_task cancel requested failed: {error}"))?;

    if changed == 1 {
        Ok(())
    } else {
        Err(format!(
            "AutoCut ops_task {task_uuid} is not in processing state for cancellation"
        ))
    }
}

fn mark_ops_task_canceled(connection: &Connection, task_uuid: &str) -> Result<bool, String> {
    let changed = connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                error_code = 'CANCELED',
                error_message = 'AutoCut native task was canceled by user request.',
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?2
              AND status = ?3
            "#,
            params![OPS_STATUS_CANCELED, task_uuid, OPS_STATUS_CANCEL_REQUESTED],
        )
        .map_err(|error| format!("mark AutoCut ops_task canceled failed: {error}"))?;

    Ok(changed == 1)
}

fn mark_ops_task_interrupted(connection: &Connection, task_uuid: &str) -> Result<bool, String> {
    let changed = connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                error_code = 'INTERRUPTED',
                error_message = 'AutoCut native task was interrupted because no active tracked native media process exists in this desktop session.',
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?2
              AND status = ?3
            "#,
            params![OPS_STATUS_INTERRUPTED, task_uuid, OPS_STATUS_PROCESSING],
        )
        .map_err(|error| format!("mark AutoCut ops_task interrupted failed: {error}"))?;

    Ok(changed == 1)
}

fn record_failed_or_canceled_operation(
    connection: &Connection,
    task_uuid: &str,
    asset: &AutoCutRegisteredMediaAsset,
    spec: &AutoCutMediaOperationSpec,
    error: &str,
) -> Result<(), String> {
    if finish_canceled_operation_if_requested(connection, task_uuid, asset, spec)? {
        return Ok(());
    }

    insert_ops_stage_run(connection, task_uuid, spec, OPS_STATUS_FAILED, Some(error))?;
    fail_ops_task(connection, task_uuid, spec.failure_error_code, error)?;
    insert_ops_task_event(
        connection,
        task_uuid,
        OPS_TASK_EVENT_TYPE_FAILED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "errorMessage": error
        })
        .to_string(),
    )?;
    Ok(())
}

fn record_ffmpeg_streaming_progress(
    connection: &Connection,
    task_uuid: &str,
    progress: i64,
    operation: &str,
) -> Result<(), String> {
    record_ops_task_progress(
        connection,
        task_uuid,
        progress,
        json!({
            "operation": operation,
            "phase": "ffmpeg-progress-streamed",
            "source": "ffmpeg-progress"
        }),
    )?;
    Ok(())
}

fn begin_native_media_task_worker_lease(
    connection: &Connection,
    task_uuid: &str,
    spec: &AutoCutMediaOperationSpec,
) -> Result<AutoCutOpsWorkerLease, String> {
    acquire_ops_worker_lease(
        connection,
        task_uuid,
        "autocut-native-media-worker",
        120,
        json!({
            "operation": spec.operation,
            "taskType": spec.task_type,
            "source": "native-host"
        }),
    )?
    .ok_or_else(|| {
        format!(
            "AutoCut native task {} could not acquire an active worker lease for {}.",
            task_uuid, spec.operation
        )
    })
}

fn finish_canceled_operation_if_requested(
    connection: &Connection,
    task_uuid: &str,
    asset: &AutoCutRegisteredMediaAsset,
    spec: &AutoCutMediaOperationSpec,
) -> Result<bool, String> {
    if read_ops_task_status(connection, task_uuid)? != Some(OPS_STATUS_CANCEL_REQUESTED) {
        return Ok(false);
    }

    insert_ops_stage_run(
        connection,
        task_uuid,
        spec,
        OPS_STATUS_CANCELED,
        Some("Native media process was canceled by user request"),
    )?;
    let canceled = mark_ops_task_canceled(connection, task_uuid)?;
    if !canceled {
        return Ok(false);
    }
    insert_ops_task_event(
        connection,
        task_uuid,
        OPS_TASK_EVENT_TYPE_CANCELED,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation
        })
        .to_string(),
    )?;
    Ok(true)
}

fn tracked_native_media_processes()
-> &'static Mutex<HashMap<String, AutoCutTrackedNativeMediaProcess>> {
    AUTOCUT_TRACKED_NATIVE_MEDIA_PROCESSES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn has_tracked_native_media_process(task_uuid: &str) -> bool {
    let Ok(normalized_task_uuid) = normalize_required_task_uuid(task_uuid) else {
        return false;
    };
    tracked_native_media_processes()
        .lock()
        .map(|registry| registry.contains_key(&normalized_task_uuid))
        .unwrap_or(false)
}

fn cancel_tracked_native_media_process(task_uuid: &str) -> Result<bool, String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    let tracked_process = tracked_native_media_processes()
        .lock()
        .map_err(|error| format!("lock AutoCut native media process registry failed: {error}"))?
        .get(&normalized_task_uuid)
        .cloned();

    let Some(tracked_process) = tracked_process else {
        return Ok(false);
    };

    if tracked_process.task_uuid != normalized_task_uuid {
        return Err("AutoCut native media process registry task uuid mismatch".to_string());
    }

    let mut child = tracked_process
        .child
        .lock()
        .map_err(|error| format!("lock AutoCut native media process failed: {error}"))?;
    if child
        .try_wait()
        .map_err(|error| format!("inspect AutoCut native media process failed: {error}"))?
        .is_some()
    {
        return Ok(false);
    }
    child
        .kill()
        .map_err(|error| format!("cancel AutoCut native media process failed: {error}"))?;
    Ok(true)
}

fn remove_tracked_native_media_process(task_uuid: &str) -> Result<(), String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    tracked_native_media_processes()
        .lock()
        .map_err(|error| format!("lock AutoCut native media process registry failed: {error}"))?
        .remove(&normalized_task_uuid);
    Ok(())
}

fn acquire_ops_worker_lease(
    connection: &Connection,
    task_uuid: &str,
    worker_id: &str,
    ttl_seconds: i64,
    diagnostics: Value,
) -> Result<Option<AutoCutOpsWorkerLease>, String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    let normalized_worker_id = worker_id.trim();
    if normalized_worker_id.is_empty() {
        return Err("AutoCut worker id is required".to_string());
    }
    let lease_ttl_seconds = ttl_seconds.clamp(1, 86_400);
    expire_stale_ops_worker_leases(connection, &normalized_task_uuid)?;
    let lease_uuid = autocut_uuid("ops-worker-lease")?;
    let lease_token = autocut_uuid("ops-worker-lease-token")?;
    let inserted = connection
        .execute(
            r#"
            INSERT OR IGNORE INTO ops_worker_lease (
                uuid,
                tenant_id,
                organization_id,
                worker_id,
                task_uuid,
                lease_status,
                lease_token,
                acquired_at,
                heartbeat_at,
                expires_at,
                diagnostics_json,
                created_at,
                updated_at,
                version
            )
            SELECT
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                datetime('now'),
                datetime('now'),
                datetime('now', '+' || ?8 || ' seconds'),
                ?9,
                datetime('now'),
                datetime('now'),
                0
            WHERE EXISTS (
                SELECT 1 FROM ops_task WHERE uuid = ?5 AND status IN (?10, ?11)
            )
            "#,
            params![
                lease_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                normalized_worker_id,
                normalized_task_uuid,
                OPS_WORKER_LEASE_STATUS_ACTIVE,
                lease_token,
                lease_ttl_seconds,
                diagnostics.to_string(),
                OPS_STATUS_PROCESSING,
                OPS_STATUS_CANCEL_REQUESTED,
            ],
        )
        .map_err(|error| format!("acquire AutoCut ops_worker_lease failed: {error}"))?;

    if inserted != 1 {
        return Ok(None);
    }

    Ok(Some(AutoCutOpsWorkerLease {
        uuid: lease_uuid,
        task_uuid: normalized_task_uuid,
        worker_id: normalized_worker_id.to_string(),
        lease_status: OPS_WORKER_LEASE_STATUS_ACTIVE,
        lease_token,
    }))
}

fn heartbeat_ops_worker_lease(
    connection: &Connection,
    lease: &AutoCutOpsWorkerLease,
    ttl_seconds: i64,
) -> Result<bool, String> {
    if lease.lease_status != OPS_WORKER_LEASE_STATUS_ACTIVE {
        return Ok(false);
    }
    let lease_ttl_seconds = ttl_seconds.clamp(1, 86_400);
    let changed = connection
        .execute(
            r#"
            UPDATE ops_worker_lease
            SET heartbeat_at = datetime('now'),
                expires_at = datetime('now', '+' || ?1 || ' seconds'),
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?2
              AND task_uuid = ?3
              AND worker_id = ?4
              AND lease_token = ?5
              AND lease_status = ?6
            "#,
            params![
                lease_ttl_seconds,
                lease.uuid,
                lease.task_uuid,
                lease.worker_id,
                lease.lease_token,
                OPS_WORKER_LEASE_STATUS_ACTIVE,
            ],
        )
        .map_err(|error| format!("heartbeat AutoCut ops_worker_lease failed: {error}"))?;
    Ok(changed == 1)
}

fn release_ops_worker_lease(
    connection: &Connection,
    lease: &AutoCutOpsWorkerLease,
    reason: &str,
) -> Result<bool, String> {
    if lease.lease_status != OPS_WORKER_LEASE_STATUS_ACTIVE {
        return Ok(false);
    }
    let diagnostics = json!({
        "releaseReason": reason,
        "source": "native-host"
    });
    let changed = connection
        .execute(
            r#"
            UPDATE ops_worker_lease
            SET lease_status = ?1,
                released_at = datetime('now'),
                diagnostics_json = ?2,
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?3
              AND task_uuid = ?4
              AND worker_id = ?5
              AND lease_token = ?6
              AND lease_status = ?7
            "#,
            params![
                OPS_WORKER_LEASE_STATUS_RELEASED,
                diagnostics.to_string(),
                lease.uuid,
                lease.task_uuid,
                lease.worker_id,
                lease.lease_token,
                OPS_WORKER_LEASE_STATUS_ACTIVE,
            ],
        )
        .map_err(|error| format!("release AutoCut ops_worker_lease failed: {error}"))?;
    Ok(changed == 1)
}

fn expire_stale_ops_worker_leases(connection: &Connection, task_uuid: &str) -> Result<i64, String> {
    let changed = connection
        .execute(
            r#"
            UPDATE ops_worker_lease
            SET lease_status = ?1,
                released_at = datetime('now'),
                updated_at = datetime('now'),
                version = version + 1
            WHERE task_uuid = ?2
              AND lease_status = ?3
              AND expires_at <= datetime('now')
            "#,
            params![
                OPS_WORKER_LEASE_STATUS_EXPIRED,
                task_uuid,
                OPS_WORKER_LEASE_STATUS_ACTIVE,
            ],
        )
        .map_err(|error| format!("expire stale AutoCut ops_worker_lease failed: {error}"))?;
    Ok(changed as i64)
}

fn read_recovery_lease_signal(
    connection: &Connection,
    task_uuid: &str,
) -> Result<Option<AutoCutRecoveryLeaseSignal>, String> {
    connection
        .query_row(
            r#"
            SELECT uuid, lease_status
            FROM ops_worker_lease
            WHERE task_uuid = ?1
              AND lease_status = ?2
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            "#,
            params![task_uuid, OPS_WORKER_LEASE_STATUS_EXPIRED],
            |row| {
                Ok(AutoCutRecoveryLeaseSignal {
                    lease_uuid: row.get::<_, String>(0)?,
                    lease_status: row.get::<_, i64>(1)?,
                    reason: "expiredWorkerLease",
                })
            },
        )
        .optional()
        .map_err(|error| format!("read AutoCut recovery worker lease signal failed: {error}"))
}

fn has_active_ops_worker_lease(connection: &Connection, task_uuid: &str) -> Result<bool, String> {
    let active_count = connection
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM ops_worker_lease
            WHERE task_uuid = ?1
              AND lease_status = ?2
              AND expires_at > datetime('now')
            "#,
            params![task_uuid, OPS_WORKER_LEASE_STATUS_ACTIVE],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("read active AutoCut ops_worker_lease failed: {error}"))?;
    Ok(active_count > 0)
}

fn insert_ops_task(
    connection: &Connection,
    task_uuid: &str,
    asset_uuid: &str,
    spec: &AutoCutMediaOperationSpec,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO ops_task (
                uuid,
                tenant_id,
                organization_id,
                task_type,
                status,
                progress,
                source_asset_uuid,
                input_json,
                output_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                0,
                ?6,
                ?7,
                '{}',
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                task_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                spec.task_type,
                OPS_STATUS_PROCESSING,
                asset_uuid,
                spec.input_json.to_string(),
            ],
        )
        .map_err(|error| format!("insert AutoCut ops_task failed: {error}"))?;

    Ok(())
}

fn record_ops_task_progress(
    connection: &Connection,
    task_uuid: &str,
    progress: i64,
    payload: Value,
) -> Result<bool, String> {
    let normalized_task_uuid = normalize_required_task_uuid(task_uuid)?;
    let clamped_progress = progress.clamp(1, 99);
    let changed = connection
        .execute(
            r#"
            UPDATE ops_task
            SET progress = ?1,
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?2
              AND status = ?3
              AND progress < ?1
              AND progress < 100
            "#,
            params![
                clamped_progress,
                normalized_task_uuid.as_str(),
                OPS_STATUS_PROCESSING
            ],
        )
        .map_err(|error| format!("record AutoCut ops_task progress failed: {error}"))?;

    if changed != 1 {
        return Ok(false);
    }

    let mut payload_json = match payload {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("details".to_string(), other);
            map
        }
    };
    payload_json.insert("progress".to_string(), json!(clamped_progress));
    if !payload_json.contains_key("operation") {
        if let Some(operation) = read_ops_task_input_operation(connection, &normalized_task_uuid)? {
            payload_json.insert("operation".to_string(), json!(operation));
        }
    }
    if !payload_json.contains_key("phase") {
        payload_json.insert("phase".to_string(), json!("native-progress"));
    }
    if !payload_json.contains_key("source") {
        payload_json.insert("source".to_string(), json!("native-host"));
    }
    insert_ops_task_event(
        connection,
        &normalized_task_uuid,
        OPS_TASK_EVENT_TYPE_PROGRESS,
        Value::Object(payload_json).to_string(),
    )?;
    Ok(true)
}

fn complete_ops_task(
    connection: &Connection,
    task_uuid: &str,
    asset_uuid: &str,
    artifact_uuid: &str,
    result: &AutoCutMediaOperationOutput,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                progress = 100,
                output_json = ?2,
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?3
            "#,
            params![
                OPS_STATUS_COMPLETED,
                json!({
                    "assetUuid": asset_uuid,
                    "artifactUuid": artifact_uuid,
                    "artifactPath": result.artifact_path,
                    "taskOutputDir": result.task_output_dir,
                    "format": result.format,
                    "byteSize": result.byte_size
                })
                .to_string(),
                task_uuid,
            ],
        )
        .map_err(|error| format!("complete AutoCut ops_task failed: {error}"))?;

    Ok(())
}

fn complete_ops_slice_task(
    connection: &Connection,
    task_uuid: &str,
    asset_uuid: &str,
    slice_artifacts: &[AutoCutVideoSliceArtifactResult],
) -> Result<(), String> {
    let task_output_dir = slice_artifacts
        .first()
        .map(|slice| slice.task_output_dir.clone())
        .unwrap_or_default();
    let subtitle_artifact_count = slice_artifacts
        .iter()
        .filter(|slice| slice.subtitle_artifact_uuid.is_some())
        .count();
    connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                progress = 100,
                output_json = ?2,
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?3
            "#,
            params![
                OPS_STATUS_COMPLETED,
                json!({
                    "assetUuid": asset_uuid,
                    "taskOutputDir": task_output_dir,
                    "sliceCount": slice_artifacts.len(),
                    "subtitleArtifactCount": subtitle_artifact_count,
                    "sliceResults": slice_artifacts
                })
                .to_string(),
                task_uuid,
            ],
        )
        .map_err(|error| format!("complete AutoCut video slice ops_task failed: {error}"))?;

    Ok(())
}

fn complete_ops_transcription_task(
    connection: &Connection,
    task_uuid: &str,
    asset_uuid: &str,
    artifact_uuid: &str,
    result: &AutoCutSpeechTranscriptionResult,
    byte_size: u64,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                progress = 100,
                output_json = ?2,
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?3
            "#,
            params![
                OPS_STATUS_COMPLETED,
                json!({
                    "assetUuid": asset_uuid,
                    "artifactUuid": artifact_uuid,
                    "transcriptPath": result.transcript_path,
                    "taskOutputDir": result.task_output_dir,
                    "language": result.language,
                    "segmentCount": result.segments.len(),
                    "segments": result.segments,
                    "text": result.text,
                    "byteSize": byte_size
                })
                .to_string(),
                task_uuid,
            ],
        )
        .map_err(|error| {
            format!("complete AutoCut speech transcription ops_task failed: {error}")
        })?;

    Ok(())
}

fn fail_ops_task(
    connection: &Connection,
    task_uuid: &str,
    error_code: &str,
    error_message: &str,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            UPDATE ops_task
            SET status = ?1,
                error_code = ?2,
                error_message = ?3,
                updated_at = datetime('now'),
                version = version + 1
            WHERE uuid = ?4
            "#,
            params![OPS_STATUS_FAILED, error_code, error_message, task_uuid],
        )
        .map_err(|error| format!("fail AutoCut ops_task failed: {error}"))?;

    Ok(())
}

fn insert_ops_task_event(
    connection: &Connection,
    task_uuid: &str,
    event_type: i64,
    payload_json: String,
) -> Result<(), String> {
    let payload_json = standardize_native_task_event_payload(event_type, &payload_json).to_string();
    connection
        .execute(
            r#"
            INSERT INTO ops_task_event (
                uuid,
                tenant_id,
                organization_id,
                task_uuid,
                event_type,
                payload_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                autocut_uuid("ops-task-event")?,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                task_uuid,
                event_type,
                payload_json,
            ],
        )
        .map_err(|error| format!("insert AutoCut ops_task_event failed: {error}"))?;

    Ok(())
}

fn parse_native_task_event_payload(payload_json: &str) -> Value {
    serde_json::from_str(payload_json).unwrap_or_else(|_| {
        json!({
            "phase": "invalid-json",
            "source": "native-host",
            "rawPayloadJson": payload_json
        })
    })
}

fn standardize_native_task_event_payload(event_type: i64, payload_json: &str) -> Value {
    let mut payload = match serde_json::from_str::<Value>(payload_json) {
        Ok(Value::Object(map)) => map,
        Ok(other) => {
            let mut map = Map::new();
            map.insert("details".to_string(), other);
            map
        }
        Err(_) => {
            let mut map = Map::new();
            map.insert("rawPayloadJson".to_string(), json!(payload_json));
            map
        }
    };

    if !payload.contains_key("phase") {
        payload.insert(
            "phase".to_string(),
            json!(native_task_event_phase(event_type)),
        );
    }
    if !payload.contains_key("source") {
        payload.insert("source".to_string(), json!("native-host"));
    }
    if event_type == OPS_TASK_EVENT_TYPE_COMPLETED && !payload.contains_key("progress") {
        payload.insert("progress".to_string(), json!(100));
    }
    Value::Object(payload)
}

fn native_task_event_phase(event_type: i64) -> &'static str {
    match event_type {
        OPS_TASK_EVENT_TYPE_STARTED => "native-task-started",
        OPS_TASK_EVENT_TYPE_COMPLETED => "native-task-completed",
        OPS_TASK_EVENT_TYPE_FAILED => "native-task-failed",
        OPS_TASK_EVENT_TYPE_CANCEL_REQUESTED => "native-task-cancel-requested",
        OPS_TASK_EVENT_TYPE_CANCELED => "native-task-canceled",
        OPS_TASK_EVENT_TYPE_INTERRUPTED => "native-task-interrupted",
        OPS_TASK_EVENT_TYPE_RETRY_REQUESTED => "native-task-retry-requested",
        OPS_TASK_EVENT_TYPE_PROGRESS => "native-task-progress",
        _ => "native-task-event",
    }
}

fn read_ops_task_input_operation(
    connection: &Connection,
    task_uuid: &str,
) -> Result<Option<String>, String> {
    let input_json = connection
        .query_row(
            "SELECT input_json FROM ops_task WHERE uuid = ?1",
            [task_uuid],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("read AutoCut ops_task input_json failed: {error}"))?;
    let Some(input_json) = input_json else {
        return Ok(None);
    };
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(&input_json) else {
        return Ok(None);
    };
    Ok(input
        .get("operation")
        .and_then(Value::as_str)
        .map(str::to_string))
}

fn insert_ops_stage_run(
    connection: &Connection,
    task_uuid: &str,
    spec: &AutoCutMediaOperationSpec,
    status: i64,
    error_message: Option<&str>,
) -> Result<(), String> {
    let diagnostics_json = match error_message {
        Some(message) => json!({ "errorMessage": message }).to_string(),
        None => json!({ "stage": spec.operation }).to_string(),
    };

    connection
        .execute(
            r#"
            INSERT INTO ops_stage_run (
                uuid,
                tenant_id,
                organization_id,
                task_uuid,
                stage_type,
                status,
                started_at,
                finished_at,
                diagnostics_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                datetime('now'),
                datetime('now'),
                ?7,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                autocut_uuid("ops-stage-run")?,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                task_uuid,
                spec.stage_type,
                status,
                diagnostics_json,
            ],
        )
        .map_err(|error| format!("insert AutoCut ops_stage_run failed: {error}"))?;

    Ok(())
}

fn insert_media_artifact(
    connection: &Connection,
    artifact_uuid: &str,
    task_uuid: &str,
    asset: &AutoCutRegisteredMediaAsset,
    result: &AutoCutMediaOperationOutput,
    spec: &AutoCutMediaOperationSpec,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO media_artifact (
                uuid,
                tenant_id,
                organization_id,
                task_uuid,
                source_asset_uuid,
                name,
                artifact_type,
                uri,
                mime_type,
                byte_size,
                status,
                metadata_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                ?11,
                ?12,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                artifact_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                task_uuid,
                asset.uuid,
                format!("{} {}", asset.name, spec.artifact_name_suffix),
                spec.artifact_type,
                result.artifact_path,
                spec.mime_type,
                u64_to_i64(result.byte_size, "media_artifact.byte_size")?,
                OPS_STATUS_COMPLETED,
                json!({
                    "sourceAssetUuid": asset.uuid,
                    "taskUuid": task_uuid,
                    "operation": spec.operation,
                    "format": result.format,
                    "taskOutputDir": result.task_output_dir,
                    "ffmpegExecutable": result.ffmpeg_executable
                })
                .to_string(),
            ],
        )
        .map_err(|error| format!("insert AutoCut media_artifact failed: {error}"))?;

    Ok(())
}

fn insert_media_slice_artifact(
    connection: &Connection,
    artifact_uuid: &str,
    task_uuid: &str,
    asset: &AutoCutRegisteredMediaAsset,
    result: &AutoCutMediaOperationOutput,
    spec: &AutoCutMediaOperationSpec,
    clip: &AutoCutVideoSliceClipRequest,
    clip_index: usize,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO media_artifact (
                uuid,
                tenant_id,
                organization_id,
                task_uuid,
                source_asset_uuid,
                name,
                artifact_type,
                uri,
                mime_type,
                byte_size,
                status,
                metadata_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                ?11,
                ?12,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                artifact_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                task_uuid,
                asset.uuid,
                format!("{} slice {:02} {}", asset.name, clip_index + 1, clip.label),
                spec.artifact_type,
                result.artifact_path,
                spec.mime_type,
                u64_to_i64(result.byte_size, "media_artifact.byte_size")?,
                OPS_STATUS_COMPLETED,
                json!({
                    "sourceAssetUuid": asset.uuid,
                    "taskUuid": task_uuid,
                    "operation": spec.operation,
                    "format": result.format,
                    "taskOutputDir": result.task_output_dir,
                    "ffmpegExecutable": result.ffmpeg_executable,
                    "startMs": clip.start_ms,
                    "durationMs": clip.duration_ms,
                    "label": clip.label,
                    "clipIndex": clip_index
                })
                .to_string(),
            ],
        )
        .map_err(|error| format!("insert AutoCut video slice media_artifact failed: {error}"))?;

    Ok(())
}

fn insert_media_slice_thumbnail_artifact(
    connection: &Connection,
    artifact_uuid: &str,
    task_uuid: &str,
    asset: &AutoCutRegisteredMediaAsset,
    result: &AutoCutMediaOperationOutput,
    spec: &AutoCutMediaOperationSpec,
    clip: &AutoCutVideoSliceClipRequest,
    clip_index: usize,
    slice_artifact_uuid: &str,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO media_artifact (
                uuid,
                tenant_id,
                organization_id,
                task_uuid,
                source_asset_uuid,
                name,
                artifact_type,
                uri,
                mime_type,
                byte_size,
                status,
                metadata_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                ?11,
                ?12,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                artifact_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                task_uuid,
                asset.uuid,
                format!(
                    "{} slice {:02} thumbnail {}",
                    asset.name,
                    clip_index + 1,
                    clip.label
                ),
                MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL,
                result.artifact_path,
                "image/jpeg",
                u64_to_i64(result.byte_size, "media_artifact.byte_size")?,
                OPS_STATUS_COMPLETED,
                json!({
                    "sourceAssetUuid": asset.uuid,
                    "taskUuid": task_uuid,
                    "operation": spec.operation,
                    "format": result.format,
                    "taskOutputDir": result.task_output_dir,
                    "ffmpegExecutable": result.ffmpeg_executable,
                    "startMs": clip.start_ms,
                    "durationMs": clip.duration_ms,
                    "label": clip.label,
                    "clipIndex": clip_index,
                    "sliceArtifactUuid": slice_artifact_uuid
                })
                .to_string(),
            ],
        )
        .map_err(|error| {
            format!("insert AutoCut video slice thumbnail media_artifact failed: {error}")
        })?;

    Ok(())
}

fn insert_media_slice_subtitle_artifact(
    connection: &Connection,
    artifact_uuid: &str,
    task_uuid: &str,
    asset: &AutoCutRegisteredMediaAsset,
    result: &AutoCutMediaOperationOutput,
    spec: &AutoCutMediaOperationSpec,
    clip: &AutoCutVideoSliceClipRequest,
    clip_index: usize,
    slice_artifact_uuid: &str,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO media_artifact (
                uuid,
                tenant_id,
                organization_id,
                task_uuid,
                source_asset_uuid,
                name,
                artifact_type,
                uri,
                mime_type,
                byte_size,
                status,
                metadata_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                ?11,
                ?12,
                datetime('now'),
                datetime('now'),
                0
            )
            "#,
            params![
                artifact_uuid,
                AUTOCUT_LOCAL_TENANT_ID,
                AUTOCUT_LOCAL_ORGANIZATION_ID,
                task_uuid,
                asset.uuid,
                format!(
                    "{} slice {:02} subtitle {}",
                    asset.name,
                    clip_index + 1,
                    clip.label
                ),
                MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_SUBTITLE,
                result.artifact_path,
                "application/x-subrip",
                u64_to_i64(result.byte_size, "media_artifact.byte_size")?,
                OPS_STATUS_COMPLETED,
                json!({
                    "sourceAssetUuid": asset.uuid,
                    "taskUuid": task_uuid,
                    "operation": spec.operation,
                    "format": result.format,
                    "taskOutputDir": result.task_output_dir,
                    "startMs": clip.start_ms,
                    "durationMs": clip.duration_ms,
                    "label": clip.label,
                    "clipIndex": clip_index,
                    "sliceArtifactUuid": slice_artifact_uuid
                })
                .to_string(),
            ],
        )
        .map_err(|error| {
            format!("insert AutoCut video slice subtitle media_artifact failed: {error}")
        })?;

    Ok(())
}

fn autocut_uuid(prefix: &str) -> Result<String, String> {
    let nanos = monotonic_artifact_suffix()?;
    let counter = AUTOCUT_UUID_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(format!("{prefix}-{nanos:032x}-{counter:016x}"))
}

fn u64_to_i64(value: u64, column_name: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("{column_name} exceeds int64 storage"))
}

fn classify_media_type(extension: &str) -> &'static str {
    match extension {
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "flv" | "m4v" => "video",
        "mp3" | "wav" | "flac" | "aac" | "m4a" | "ogg" => "audio",
        "gif" => "gif",
        "png" | "jpg" | "jpeg" | "webp" => "image",
        _ => "binary",
    }
}

fn media_mime_type(extension: &str, media_type: &str) -> &'static str {
    match extension {
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "flv" => "video/x-flv",
        "m4v" => "video/x-m4v",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "gif" => "image/gif",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ if media_type == "audio" => "audio/octet-stream",
        _ if media_type == "video" => "video/octet-stream",
        _ => "application/octet-stream",
    }
}

fn audio_mime_type(format: &str) -> &'static str {
    match format {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        _ => "audio/octet-stream",
    }
}

fn monotonic_artifact_suffix() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| format!("read system time for AutoCut artifact suffix failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("read system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{name}-{suffix}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_minimal_valid_speech_model(path: &Path) {
        let file = fs::File::create(path).expect("create speech model fixture");
        file.set_len(MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES)
            .expect("size speech model fixture");
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn smart_slice_test_clip(
        start_ms: i64,
        duration_ms: i64,
        label: &str,
    ) -> AutoCutVideoSliceClipRequest {
        let speech_start_ms = start_ms;
        let speech_end_ms = start_ms + duration_ms;
        let transcript_text = format!("{label} transcript evidence.");
        AutoCutVideoSliceClipRequest {
            start_ms,
            duration_ms,
            label: label.to_string(),
            output_file_name: None,
            audio_mute_ranges: None,
            source_start_ms: Some(start_ms),
            source_end_ms: Some(speech_end_ms),
            speech_start_ms: Some(speech_start_ms),
            speech_end_ms: Some(speech_end_ms),
            boundary_padding_before_ms: Some(0),
            boundary_padding_after_ms: Some(0),
            transcript_text: Some(transcript_text.clone()),
            transcript_segments: Some(vec![AutoCutSpeechTranscriptionSegment {
                start_ms: speech_start_ms,
                end_ms: speech_end_ms,
                text: transcript_text,
                speaker: Some("Speaker 1".to_string()),
            }]),
            transcript_segment_count: Some(1),
            transcript_coverage_score: Some(1.0),
            speech_continuity_grade: Some("strong".to_string()),
        }
    }

    fn prepared_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory sqlite");
        connection
            .execute_batch(crate::database_runtime::AUTOCUT_SQLITE_BASELINE_SQL)
            .expect("apply baseline schema");
        connection
    }

    fn read_ops_task_input_json(connection: &Connection, task_uuid: &str) -> Value {
        let input_json = connection
            .query_row(
                "SELECT input_json FROM ops_task WHERE uuid = ?1",
                [task_uuid],
                |row| row.get::<_, String>(0),
            )
            .expect("query ops_task input_json");
        serde_json::from_str(&input_json).expect("parse ops_task input_json")
    }

    fn assert_ops_task_input_has_source_name(
        connection: &Connection,
        task_uuid: &str,
        asset_uuid: &str,
        source_name: &str,
    ) {
        let input = read_ops_task_input_json(connection, task_uuid);
        assert_eq!(input["assetUuid"], asset_uuid);
        assert_eq!(input["sourceName"], source_name);
    }

    fn test_system_ffmpeg_toolchain() -> AutoCutFfmpegToolchain {
        test_system_ffmpeg_toolchain_from_env(std::env::var("SDKWORK_AUTOCUT_FFMPEG").ok())
    }

    fn test_system_ffmpeg_toolchain_from_env(env_override: Option<String>) -> AutoCutFfmpegToolchain {
        if let Some(executable) = env_override.map(|value| value.trim().to_string()) {
            if !executable.is_empty() {
                return AutoCutFfmpegToolchain {
                    executable,
                    source_kind: "environment".to_string(),
                    manifest_ready: true,
                    bundled_ready: false,
                    diagnostics: vec![
                        "SDKWORK_AUTOCUT_FFMPEG overrides the test FFmpeg toolchain".to_string(),
                    ],
                };
            }
        }
        AutoCutFfmpegToolchain {
            executable: DEFAULT_FFMPEG_EXECUTABLE.to_string(),
            source_kind: "system-path".to_string(),
            manifest_ready: true,
            bundled_ready: false,
            diagnostics: Vec::new(),
        }
    }

    #[test]
    fn test_system_ffmpeg_toolchain_uses_release_smoke_environment_override() {
        let expected = "D:/release-sidecars/ffmpeg.exe";
        let toolchain = test_system_ffmpeg_toolchain_from_env(Some(expected.to_string()));

        assert_eq!(toolchain.executable, expected);
        assert_eq!(toolchain.source_kind, "environment");
        assert!(toolchain.manifest_ready);
        assert!(!toolchain.bundled_ready);
    }

    fn run_ffmpeg_test_video(
        toolchain: &AutoCutFfmpegToolchain,
        output_path: &Path,
    ) -> Result<(), String> {
        let output = Command::new(&toolchain.executable)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=96x96:rate=10:duration=0.5",
                "-c:v",
                "mpeg4",
                "-q:v",
                "5",
            ])
            .arg(output_path)
            .output()
            .map_err(|error| format!("run AutoCut FFmpeg test video failed: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "AutoCut FFmpeg test video failed with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(())
    }

    #[test]
    fn video_slice_encoder_candidates_prioritize_platform_hardware_and_end_with_cpu_fallback() {
        let candidates = autocut_video_slice_encoder_candidates();
        assert!(
            !candidates.is_empty(),
            "native video slicing must always expose at least a CPU encoder candidate"
        );
        let last = candidates
            .last()
            .expect("video slice encoder candidates include CPU fallback");
        assert_eq!(last.video_codec, "libx264");
        assert!(
            !last.requires_hardware,
            "final video slice encoder candidate must be the portable CPU fallback"
        );
        assert_eq!(
            candidates
                .iter()
                .filter(|candidate| candidate.video_codec == "libx264")
                .count(),
            1,
            "libx264 CPU fallback should appear exactly once"
        );
        if candidates.len() > 1 {
            assert!(
                candidates[..candidates.len() - 1]
                    .iter()
                    .all(|candidate| candidate.requires_hardware),
                "all candidates before the CPU fallback should be hardware attempts"
            );
        }

        let codecs = candidates
            .iter()
            .map(|candidate| candidate.video_codec.as_str())
            .collect::<Vec<_>>();
        if cfg!(target_os = "windows") {
            assert!(codecs.contains(&"h264_nvenc"));
            assert!(codecs.contains(&"h264_qsv"));
            assert!(codecs.contains(&"h264_amf"));
        }
        if cfg!(target_os = "macos") {
            assert!(codecs.contains(&"h264_videotoolbox"));
        }
        if cfg!(target_os = "linux") {
            assert!(codecs.contains(&"h264_nvenc"));
            assert!(codecs.contains(&"h264_qsv"));
            if autocut_linux_vaapi_render_device().is_some() {
                assert!(codecs.contains(&"h264_vaapi"));
            }
        }
    }

    #[test]
    fn video_slice_cpu_encoder_candidate_uses_compatible_libx264_output() {
        let candidate = autocut_video_slice_cpu_encoder_candidate();
        assert_eq!(candidate.label, "portable-cpu-libx264");
        assert_eq!(candidate.video_codec, "libx264");
        assert!(!candidate.requires_hardware);
        assert!(candidate.pre_input_args.is_empty());
        assert!(candidate.filter_chain_suffix.is_none());
        assert!(
            candidate
                .encoder_args
                .windows(2)
                .any(|args| args == ["-preset", "veryfast"])
        );
        assert!(
            candidate
                .encoder_args
                .windows(2)
                .any(|args| args == ["-crf", "23"])
        );
        assert!(
            candidate
                .encoder_args
                .windows(2)
                .any(|args| args == ["-pix_fmt", "yuv420p"])
        );
    }

    #[test]
    fn video_slice_noise_reduction_adds_audio_filter_only_when_requested() {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut clip = smart_slice_test_clip(0, 1_000, "Denoised");
        clip.audio_mute_ranges = Some(vec![AutoCutVideoSliceAudioMuteRange {
            start_ms: 250,
            end_ms: 550,
        }]);
        let candidate = autocut_video_slice_cpu_encoder_candidate();
        let output_path = Path::new("slice.mp4");
        let input_path = Path::new("source.mp4");

        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &clip,
            None,
            true,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            args.windows(2).any(|items| {
                items[0] == "-af" &&
                    items[1].contains(ffmpeg_video_slice_audio_noise_reduction_filter()) &&
                    items[1].contains("volume=enable='between(t,0.250,0.550)':volume=0")
            }),
            "enabled smart-slice noise reduction must add the professional audio filter chain and mute recognized noise fragments"
        );

        clip.audio_mute_ranges = None;
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &clip,
            None,
            false,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            !args.iter().any(|arg| arg == "-af"),
            "disabled smart-slice noise reduction must not alter audio"
        );

        let mut clip = smart_slice_test_clip(1_000, 2_000, "Muted noise");
        clip.audio_mute_ranges = Some(vec![AutoCutVideoSliceAudioMuteRange {
            start_ms: 1_300,
            end_ms: 1_700,
        }]);
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &clip,
            None,
            false,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            args.windows(2).any(|items| {
                items[0] == "-af" && items[1] == "volume=enable='between(t,0.300,0.700)':volume=0"
            }),
            "smart-slice recognized cough/music fragments must be muted even when broadband denoise is disabled"
        );
    }

    #[test]
    fn video_slice_encoder_attempt_diagnostics_preserve_all_candidate_failures() {
        let diagnostics = format_video_slice_encoder_attempt_diagnostics(&[
            AutoCutVideoSliceEncoderAttemptDiagnostic {
                label: "gpu-first".to_string(),
                video_codec: "h264_nvenc".to_string(),
                status: "exit status: 1".to_string(),
                stderr_tail: "Cannot load libcuda.so.1".to_string(),
            },
            AutoCutVideoSliceEncoderAttemptDiagnostic {
                label: "cpu-last".to_string(),
                video_codec: "libx264".to_string(),
                status: "exit status: 2".to_string(),
                stderr_tail: String::new(),
            },
        ]);

        assert!(diagnostics.contains("gpu-first [h264_nvenc]"));
        assert!(diagnostics.contains("Cannot load libcuda.so.1"));
        assert!(diagnostics.contains("cpu-last [libx264]"));
        assert!(diagnostics.contains("no stderr captured"));
    }

    fn run_ffmpeg_test_audio(
        toolchain: &AutoCutFfmpegToolchain,
        output_path: &Path,
    ) -> Result<(), String> {
        let output = Command::new(&toolchain.executable)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=1.2",
                "-vn",
                "-acodec",
                "pcm_s16le",
            ])
            .arg(output_path)
            .output()
            .map_err(|error| format!("run AutoCut FFmpeg test audio failed: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "AutoCut FFmpeg test audio failed with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(())
    }

    fn run_ffmpeg_test_video_with_audio(
        toolchain: &AutoCutFfmpegToolchain,
        output_path: &Path,
    ) -> Result<(), String> {
        let output = Command::new(&toolchain.executable)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=128x128:rate=30:duration=2.0",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=2.0",
                "-shortest",
                "-c:v",
                "libx264",
                "-g",
                "90",
                "-keyint_min",
                "90",
                "-sc_threshold",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
            ])
            .arg(output_path)
            .output()
            .map_err(|error| format!("run AutoCut FFmpeg test video with audio failed: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "AutoCut FFmpeg test video with audio failed with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(())
    }

    fn assert_ffmpeg_video_has_audible_audio(
        toolchain: &AutoCutFfmpegToolchain,
        input_path: &Path,
    ) -> Result<(), String> {
        let output = Command::new(&toolchain.executable)
            .args(["-hide_banner", "-nostdin", "-i"])
            .arg(input_path)
            .args(["-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"])
            .output()
            .map_err(|error| format!("run AutoCut FFmpeg audio assertion failed: {error}"))?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            return Err(format!(
                "AutoCut FFmpeg audio assertion failed with status {}: {}",
                output.status,
                stderr.trim()
            ));
        }

        let mean_volume_db = stderr.lines().find_map(|line| {
            let (_, value) = line.split_once("mean_volume:")?;
            value.trim().split_whitespace().next()?.parse::<f64>().ok()
        });
        let Some(mean_volume_db) = mean_volume_db else {
            return Err(format!(
                "AutoCut FFmpeg audio assertion could not read mean_volume for {}",
                input_path.display()
            ));
        };
        if !mean_volume_db.is_finite() || mean_volume_db <= -60.0 {
            return Err(format!(
                "AutoCut FFmpeg audio assertion expected audible audio, got mean_volume {mean_volume_db} dB"
            ));
        }

        Ok(())
    }

    fn insert_processing_task_fixture(connection: &Connection, task_uuid: &str) {
        connection
            .execute(
                r#"
                INSERT INTO ops_task (
                    uuid,
                    tenant_id,
                    organization_id,
                    task_type,
                    status,
                    progress,
                    source_asset_uuid,
                    input_json,
                    output_json,
                    created_at,
                    updated_at,
                    version
                )
                VALUES (
                    ?1,
                    0,
                    0,
                    ?2,
                    ?3,
                    0,
                    'media-asset-cancel-test',
                    '{"operation":"cancelTest"}',
                    '{}',
                    datetime('now'),
                    datetime('now'),
                    0
                )
                "#,
                params![
                    task_uuid,
                    OPS_TASK_TYPE_AUDIO_EXTRACTION,
                    OPS_STATUS_PROCESSING
                ],
            )
            .expect("insert processing task fixture");
    }

    fn read_task_progress(connection: &Connection, task_uuid: &str) -> i64 {
        connection
            .query_row(
                "SELECT progress FROM ops_task WHERE uuid = ?1",
                [task_uuid],
                |row| row.get::<_, i64>(0),
            )
            .expect("query task progress")
    }

    fn read_task_event_payload(connection: &Connection, task_uuid: &str, event_type: i64) -> Value {
        let payload_json = connection
            .query_row(
                "SELECT payload_json FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2 ORDER BY id DESC LIMIT 1",
                params![task_uuid, event_type],
                |row| row.get::<_, String>(0),
            )
            .expect("query task event payload");
        serde_json::from_str(&payload_json).expect("task event payload must be valid JSON")
    }

    fn read_worker_lease_status(connection: &Connection, lease_uuid: &str) -> i64 {
        connection
            .query_row(
                "SELECT lease_status FROM ops_worker_lease WHERE uuid = ?1",
                [lease_uuid],
                |row| row.get::<_, i64>(0),
            )
            .expect("query worker lease status")
    }

    fn force_worker_lease_expired(connection: &Connection, lease_uuid: &str) {
        connection
            .execute(
                "UPDATE ops_worker_lease SET expires_at = datetime('now', '-10 seconds') WHERE uuid = ?1",
                [lease_uuid],
            )
            .expect("force worker lease expiry");
    }

    fn wait_until_tracked_native_media_process(task_uuid: &str) {
        let deadline = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("read system time")
            .as_millis()
            + 5_000;
        while !has_tracked_native_media_process(task_uuid) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("read system time")
                .as_millis();
            assert!(
                now < deadline,
                "timed out waiting for tracked native media process {task_uuid}"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    fn progress_streaming_test_command(input_path: &Path) -> Command {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut command = Command::new(toolchain.executable);
        command.args(["-hide_banner", "-nostdin", "-y", "-re", "-i"]);
        command.arg(input_path);
        command.args(["-vn", "-f", "null", "-"]);
        append_ffmpeg_progress_output_args(&mut command);
        command
    }

    #[test]
    fn tracked_ffmpeg_command_streams_progress_before_process_exit() {
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        let input_path = unique_temp_dir("sdkwork-autocut-progress-streaming").join("source.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &input_path)
            .expect("create progress streaming source audio");
        let observed_progress = Arc::new(Mutex::new(Vec::<i64>::new()));
        let runner_progress = Arc::clone(&observed_progress);
        let runner_task_uuid = task_uuid.clone();

        let runner = std::thread::spawn(move || {
            let mut command = progress_streaming_test_command(&input_path);
            run_tracked_ffmpeg_command_with_progress(
                &runner_task_uuid,
                &mut command,
                "progress streaming test",
                |progress| {
                    runner_progress
                        .lock()
                        .expect("lock observed progress")
                        .push(progress);
                    Ok(())
                },
            )
        });

        wait_until_tracked_native_media_process(&task_uuid);
        let deadline = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("read system time")
            .as_millis()
            + 1_000;
        loop {
            if !observed_progress
                .lock()
                .expect("lock observed progress")
                .is_empty()
            {
                break;
            }
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("read system time")
                .as_millis();
            assert!(
                now < deadline,
                "progress callback must fire before the test process exits"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(
            has_tracked_native_media_process(&task_uuid),
            "progress must be observed while the process is still tracked"
        );

        let output = runner
            .join()
            .expect("progress streaming runner should not panic")
            .expect("progress streaming command should succeed");
        assert!(output.status.success());
        let progress_values = observed_progress.lock().expect("lock observed progress");
        assert!(
            progress_values
                .iter()
                .all(|progress| (1..=99).contains(progress)),
            "streamed progress values must stay inside the in-flight range: {progress_values:?}"
        );
    }

    #[test]
    fn tracked_local_speech_command_can_be_canceled_through_native_task_boundary() {
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        let mut command = Command::new(test_system_ffmpeg_toolchain().executable);
        command.args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=30",
            "-f",
            "null",
            "-",
        ]);
        let runner_task_uuid = task_uuid.clone();

        let runner = std::thread::spawn(move || {
            run_tracked_native_media_command(
                &runner_task_uuid,
                &mut command,
                "local speech cancellation test",
                || Ok(()),
            )
        });

        wait_until_tracked_native_media_process(&task_uuid);
        assert!(
            cancel_tracked_native_media_process(&task_uuid)
                .expect("cancel tracked native media process"),
            "tracked local speech command should accept cancellation through the native media task boundary"
        );
        let output = runner
            .join()
            .expect("tracked local speech runner should not panic")
            .expect("tracked local speech runner should return an output after cancellation");
        assert!(
            !output.status.success(),
            "canceled local speech process must exit unsuccessfully"
        );
        assert!(
            !has_tracked_native_media_process(&task_uuid),
            "tracked local speech registry entry must be removed after process exit"
        );
    }

    #[test]
    fn tracked_native_media_command_kills_child_when_poll_callback_fails() {
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        let mut command = Command::new(test_system_ffmpeg_toolchain().executable);
        command.args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=30",
            "-f",
            "null",
            "-",
        ]);
        let tracked_child = spawn_tracked_native_media_command(
            &task_uuid,
            &mut command,
            "poll failure cleanup test",
        )
        .expect("spawn tracked native media process");
        wait_until_tracked_native_media_process(&task_uuid);

        let error = wait_for_tracked_native_media_output(&tracked_child, &mut || {
            Err("synthetic poll failure".to_string())
        })
        .expect_err("poll failure should be returned to the caller");

        assert_eq!(error, "synthetic poll failure");
        let status = tracked_child
            .lock()
            .expect("lock tracked child after poll failure")
            .try_wait()
            .expect("inspect tracked child after poll failure");
        assert!(
            status.is_some(),
            "tracked native media child must be stopped when polling fails"
        );
        remove_tracked_native_media_process(&task_uuid).expect("remove tracked cleanup fixture");
    }

    #[test]
    fn tracked_native_media_command_removes_registry_when_poll_callback_fails() {
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        let mut command = Command::new(test_system_ffmpeg_toolchain().executable);
        command.args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:duration=30",
            "-f",
            "null",
            "-",
        ]);

        let error = run_tracked_native_media_command(
            &task_uuid,
            &mut command,
            "poll failure registry cleanup test",
            || Err("synthetic poll failure".to_string()),
        )
        .expect_err("poll failure should be returned to the caller");

        assert_eq!(error, "synthetic poll failure");
        assert!(
            !has_tracked_native_media_process(&task_uuid),
            "tracked native media registry entry must be removed after command failure"
        );
    }

    #[test]
    fn native_media_poll_throttler_runs_immediately_then_waits_for_interval() {
        let mut poll = AutoCutThrottledPoll::new(Duration::from_secs(60));
        let mut poll_count = 0;
        poll.run_if_due(&mut || {
            poll_count += 1;
            Ok(())
        })
        .expect("initial throttled poll");
        poll.run_if_due(&mut || {
            poll_count += 1;
            Ok(())
        })
        .expect("second throttled poll");

        assert_eq!(
            poll_count, 1,
            "native media poll throttling should avoid heartbeat writes on every process wait iteration"
        );
    }

    #[test]
    fn native_media_poll_throttler_can_force_final_run() {
        let mut poll = AutoCutThrottledPoll::new(Duration::from_secs(60));
        let mut poll_count = 0;
        poll.run_if_due(&mut || {
            poll_count += 1;
            Ok(())
        })
        .expect("initial throttled poll");
        poll.run_if_due(&mut || {
            poll_count += 1;
            Ok(())
        })
        .expect("second throttled poll");
        poll.run_now(&mut || {
            poll_count += 1;
            Ok(())
        })
        .expect("forced final poll");

        assert_eq!(
            poll_count, 2,
            "native media poll throttling should support a final heartbeat after process exit"
        );
    }

    #[test]
    fn ffmpeg_progress_parser_maps_out_time_to_clamped_percent() {
        assert_eq!(
            parse_ffmpeg_duration_millis(
                "Input #0, wav, from 'voice.wav':\n  Duration: 00:00:10.000000, bitrate: 768 kb/s\n"
            ),
            Some(10_000)
        );
        assert_eq!(
            parse_ffmpeg_progress_percent(
                "frame=1\nout_time_ms=2500000\nprogress=continue\n",
                10_000
            ),
            Some(25)
        );
        assert_eq!(
            parse_ffmpeg_progress_percent("out_time_us=100000\nprogress=continue\n", 1_000),
            Some(10)
        );
        assert_eq!(
            parse_ffmpeg_progress_percent("out_time=00:00:07.500000\nprogress=continue\n", 10_000),
            Some(75)
        );
        assert_eq!(
            parse_ffmpeg_progress_percent("out_time_ms=12000000\nprogress=end\n", 10_000),
            Some(99)
        );
        assert_eq!(
            parse_ffmpeg_progress_percent("out_time_ms=1000000\nprogress=continue\n", 0),
            None
        );
    }

    #[test]
    fn ops_task_progress_updates_processing_task_monotonically_and_records_event() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);

        let first_update = record_ops_task_progress(
            &connection,
            &task_uuid,
            10,
            json!({ "phase": "ffmpeg-spawned" }),
        )
        .expect("record first task progress");
        let regressing_update =
            record_ops_task_progress(&connection, &task_uuid, 5, json!({ "phase": "regression" }))
                .expect("ignore regressing task progress");
        let capped_update =
            record_ops_task_progress(&connection, &task_uuid, 120, json!({ "phase": "almost" }))
                .expect("record capped task progress");

        assert!(first_update);
        assert!(!regressing_update);
        assert!(capped_update);
        assert_eq!(read_task_progress(&connection, &task_uuid), 99);
        let progress_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_PROGRESS],
                |row| row.get::<_, i64>(0),
            )
            .expect("query progress events");
        assert_eq!(progress_event_count, 2);
        let progress_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_PROGRESS);
        assert_eq!(progress_payload["operation"], "cancelTest");
        assert_eq!(progress_payload["phase"], "almost");
        assert_eq!(progress_payload["source"], "native-host");
        assert_eq!(progress_payload["progress"], 99);
    }

    #[test]
    fn native_task_event_snapshots_expose_structured_payload_with_raw_json_audit_copy() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        record_ffmpeg_streaming_progress(&connection, &task_uuid, 42, "audioExtraction")
            .expect("record streaming progress");

        let events = read_native_task_events(&connection, &task_uuid)
            .expect("read native task event snapshots");

        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.event_type, OPS_TASK_EVENT_TYPE_PROGRESS);
        assert!(event.payload_json.contains("\"progress\":42"));
        assert_eq!(event.payload["operation"], "audioExtraction");
        assert_eq!(event.payload["phase"], "ffmpeg-progress-streamed");
        assert_eq!(event.payload["source"], "ffmpeg-progress");
        assert_eq!(event.payload["progress"], 42);
    }

    #[test]
    fn ops_task_event_payloads_are_standardized_for_native_observability() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);

        insert_ops_task_event(
            &connection,
            &task_uuid,
            OPS_TASK_EVENT_TYPE_STARTED,
            json!({ "operation": "audioExtraction" }).to_string(),
        )
        .expect("insert started event");
        insert_ops_task_event(
            &connection,
            &task_uuid,
            OPS_TASK_EVENT_TYPE_COMPLETED,
            json!({ "operation": "audioExtraction", "artifactUuid": "media-artifact-contract" })
                .to_string(),
        )
        .expect("insert completed event");

        let started_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_STARTED);
        let completed_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_COMPLETED);

        assert_eq!(started_payload["operation"], "audioExtraction");
        assert_eq!(started_payload["phase"], "native-task-started");
        assert_eq!(started_payload["source"], "native-host");
        assert_eq!(completed_payload["operation"], "audioExtraction");
        assert_eq!(completed_payload["phase"], "native-task-completed");
        assert_eq!(completed_payload["source"], "native-host");
        assert_eq!(completed_payload["progress"], 100);
    }

    #[test]
    fn worker_lease_lifecycle_allows_single_active_owner_heartbeat_release_and_reacquire() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);

        let lease = acquire_ops_worker_lease(
            &connection,
            &task_uuid,
            "worker-a",
            30,
            json!({ "operation": "leaseTest" }),
        )
        .expect("worker-a acquires lease")
        .expect("lease should be acquired");
        let blocked = acquire_ops_worker_lease(
            &connection,
            &task_uuid,
            "worker-b",
            30,
            json!({ "operation": "leaseTest" }),
        )
        .expect("worker-b lease attempt should not fail");

        assert!(blocked.is_none(), "active lease must block another worker");
        assert_eq!(lease.task_uuid, task_uuid);
        assert_eq!(lease.worker_id, "worker-a");
        assert_eq!(lease.lease_status, OPS_WORKER_LEASE_STATUS_ACTIVE);

        heartbeat_ops_worker_lease(&connection, &lease, 60).expect("heartbeat active worker lease");
        release_ops_worker_lease(&connection, &lease, "completed")
            .expect("release active worker lease");

        let reacquired = acquire_ops_worker_lease(
            &connection,
            &task_uuid,
            "worker-b",
            30,
            json!({ "operation": "leaseTest" }),
        )
        .expect("worker-b reacquires lease after release")
        .expect("released lease should allow reacquire");
        assert_eq!(reacquired.worker_id, "worker-b");
        assert_ne!(reacquired.uuid, lease.uuid);
    }

    #[test]
    fn ops_task_progress_does_not_mutate_terminal_task_or_write_event() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        connection
            .execute(
                "UPDATE ops_task SET status = ?1, progress = 100 WHERE uuid = ?2",
                params![OPS_STATUS_COMPLETED, task_uuid.as_str()],
            )
            .expect("mark task completed");

        let changed = record_ops_task_progress(
            &connection,
            &task_uuid,
            50,
            json!({ "phase": "late-progress" }),
        )
        .expect("ignore terminal task progress");

        assert!(!changed);
        assert_eq!(read_task_progress(&connection, &task_uuid), 100);
        let progress_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_PROGRESS],
                |row| row.get::<_, i64>(0),
            )
            .expect("query progress events");
        assert_eq!(progress_event_count, 0);
    }

    #[test]
    fn ffmpeg_toolchain_resolver_uses_env_override_before_manifest_sidecar() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-ffmpeg-toolchain-env");
        let manifest_path = manifest_root.join("ffmpeg.toolchain.json");
        fs::write(
            &manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": true,
              "requiredBinary": "ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "ffmpeg.exe",
                  "binaryName": "ffmpeg.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write toolchain manifest");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_manifest(
            &manifest_path,
            Some("D:/tools/ffmpeg.exe"),
            "windows",
            "x86_64",
        )
        .expect("resolve FFmpeg toolchain");

        assert_eq!(toolchain.executable, "D:/tools/ffmpeg.exe");
        assert_eq!(toolchain.source_kind, "environment");
        assert!(toolchain.manifest_ready);
        assert!(!toolchain.bundled_ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|message| message.contains("SDKWORK_AUTOCUT_FFMPEG")),
            "environment override diagnostics should name SDKWORK_AUTOCUT_FFMPEG: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn ffmpeg_toolchain_resolver_uses_env_override_even_when_manifest_is_missing() {
        let missing_manifest_path = unique_temp_dir("sdkwork-autocut-ffmpeg-missing-env")
            .join("missing")
            .join("ffmpeg.toolchain.json");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_candidate_manifests(
            &[missing_manifest_path],
            Some("D:/tools/ffmpeg.exe"),
            "windows",
            "x86_64",
        )
        .expect("resolve FFmpeg toolchain from environment override");

        assert_eq!(toolchain.executable, "D:/tools/ffmpeg.exe");
        assert_eq!(toolchain.source_kind, "environment");
        assert!(!toolchain.manifest_ready);
        assert!(!toolchain.bundled_ready);
    }

    #[test]
    fn ffmpeg_toolchain_resolver_reports_missing_sidecar_without_claiming_bundled_readiness() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-ffmpeg-toolchain-missing");
        let manifest_path = manifest_root.join("ffmpeg.toolchain.json");
        fs::write(
            &manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": true,
              "requiredBinary": "ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "ffmpeg.exe",
                  "binaryName": "ffmpeg.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write toolchain manifest");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_manifest(
            &manifest_path,
            None,
            "windows",
            "x86_64",
        )
        .expect("resolve missing FFmpeg sidecar");

        assert_eq!(toolchain.executable, DEFAULT_FFMPEG_EXECUTABLE);
        assert_eq!(toolchain.source_kind, "system-path");
        assert!(toolchain.manifest_ready);
        assert!(!toolchain.bundled_ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|message| message.contains("missing bundled FFmpeg")),
            "missing sidecar diagnostics should be explicit: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn ffmpeg_toolchain_resolver_accepts_verified_platform_sidecar_without_global_manifest_readiness(
    ) {
        let manifest_root =
            unique_temp_dir("sdkwork-autocut-ffmpeg-platform-bundled-sidecar");
        let manifest_path = manifest_root.join("ffmpeg.toolchain.json");
        let windows_sidecar_path = manifest_root.join("windows-x86_64").join("ffmpeg.exe");
        fs::create_dir_all(windows_sidecar_path.parent().expect("sidecar parent"))
            .expect("create FFmpeg sidecar dir");
        let sidecar_bytes = b"windows ffmpeg sidecar fixture";
        fs::write(&windows_sidecar_path, sidecar_bytes)
            .expect("write bundled FFmpeg sidecar fixture");
        let sidecar_sha256 = sha256_hex(sidecar_bytes);
        fs::write(
            &manifest_path,
            format!(
                r#"{{
                  "tool": "ffmpeg",
                  "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
                  "bundledReady": false,
                  "requiredBinary": "ffmpeg",
                  "license": {{
                    "name": "FFmpeg",
                    "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                    "notice": "Test manifest only."
                  }},
                  "platforms": {{
                    "windows-x86_64": {{
                      "relativePath": "windows-x86_64/ffmpeg.exe",
                      "binaryName": "ffmpeg.exe",
                      "integrity": {{
                        "sha256": "{sidecar_sha256}",
                        "byteSize": {}
                      }}
                    }},
                    "linux-x86_64": {{
                      "relativePath": "linux-x86_64/ffmpeg",
                      "binaryName": "ffmpeg",
                      "integrity": {{
                        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                        "byteSize": 0
                      }}
                    }}
                  }}
                }}"#,
                sidecar_bytes.len()
            ),
        )
        .expect("write FFmpeg toolchain manifest");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_manifest(
            &manifest_path,
            None,
            "windows",
            "x86_64",
        )
        .expect("resolve FFmpeg toolchain");

        assert_eq!(
            toolchain.executable,
            windows_sidecar_path.display().to_string()
        );
        assert_eq!(toolchain.source_kind, "bundled-sidecar");
        assert!(toolchain.manifest_ready);
        assert!(
            toolchain.bundled_ready,
            "verified current-platform FFmpeg sidecar should be bundled-ready even before all platform sidecars are bundled: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn ffmpeg_toolchain_resolver_rejects_sidecar_with_mismatched_checksum() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-ffmpeg-toolchain-integrity");
        let manifest_path = manifest_root.join("ffmpeg.toolchain.json");
        let sidecar_path = manifest_root.join("ffmpeg.exe");
        fs::write(&sidecar_path, b"untrusted sidecar bytes").expect("write sidecar fixture");
        fs::write(
            &manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": true,
              "requiredBinary": "ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "ffmpeg.exe",
                  "binaryName": "ffmpeg.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 23
                  }
                }
              }
            }"#,
        )
        .expect("write toolchain manifest");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_manifest(
            &manifest_path,
            None,
            "windows",
            "x86_64",
        )
        .expect("resolve FFmpeg toolchain");

        assert_eq!(toolchain.executable, DEFAULT_FFMPEG_EXECUTABLE);
        assert_eq!(toolchain.source_kind, "system-path");
        assert!(!toolchain.bundled_ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|message| message.contains("checksum")),
            "mismatched sidecar diagnostics should mention checksum: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn ffmpeg_toolchain_resolver_prefers_runtime_resource_manifest_before_source_manifest() {
        let source_root = unique_temp_dir("sdkwork-autocut-ffmpeg-source-manifest");
        let source_manifest_path = source_root.join("ffmpeg.toolchain.json");
        fs::write(
            &source_manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": false,
              "requiredBinary": "source-ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "source-ffmpeg.exe",
                  "binaryName": "source-ffmpeg.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write source toolchain manifest");

        let runtime_root = unique_temp_dir("sdkwork-autocut-ffmpeg-runtime-manifest");
        let runtime_binaries_root = runtime_root.join("binaries");
        fs::create_dir_all(&runtime_binaries_root).expect("create runtime binaries dir");
        let runtime_manifest_path = runtime_binaries_root.join("ffmpeg.toolchain.json");
        let runtime_sidecar_path = runtime_binaries_root.join("ffmpeg.exe");
        fs::write(&runtime_sidecar_path, b"runtime sidecar placeholder")
            .expect("write runtime sidecar");
        fs::write(
            &runtime_manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": true,
              "requiredBinary": "runtime-ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "ffmpeg.exe",
                  "binaryName": "ffmpeg.exe",
                  "integrity": {
                    "sha256": "c77c82f88c127312fe19d4fc939d83b11bc6466ccae1f56dd1ed7ccb10df0d16",
                    "byteSize": 27
                  }
                }
              }
            }"#,
        )
        .expect("write runtime toolchain manifest");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_candidate_manifests(
            &[runtime_manifest_path, source_manifest_path],
            None,
            "windows",
            "x86_64",
        )
        .expect("resolve runtime FFmpeg toolchain");

        assert_eq!(
            toolchain.executable,
            runtime_sidecar_path.display().to_string()
        );
        assert_eq!(toolchain.source_kind, "bundled-sidecar");
        assert!(toolchain.manifest_ready);
        assert!(toolchain.bundled_ready);
    }

    #[test]
    fn ffmpeg_toolchain_resolver_checks_source_sidecar_before_path_fallback() {
        let runtime_root = unique_temp_dir("sdkwork-autocut-ffmpeg-runtime-missing-sidecar");
        let runtime_binaries_root = runtime_root.join("binaries");
        fs::create_dir_all(&runtime_binaries_root).expect("create runtime binaries dir");
        let runtime_manifest_path = runtime_binaries_root.join("ffmpeg.toolchain.json");
        fs::write(
            &runtime_manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": false,
              "requiredBinary": "runtime-ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "ffmpeg.exe",
                  "binaryName": "ffmpeg.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write runtime manifest without sidecar");

        let source_root = unique_temp_dir("sdkwork-autocut-ffmpeg-source-sidecar");
        let source_manifest_path = source_root.join("ffmpeg.toolchain.json");
        let source_sidecar_path = source_root.join("source-ffmpeg.exe");
        fs::write(&source_sidecar_path, b"source sidecar placeholder")
            .expect("write source sidecar");
        fs::write(
            &source_manifest_path,
            r#"{
              "tool": "ffmpeg",
              "contractVersion": "2026-05-05.ffmpeg-toolchain.v1",
              "bundledReady": true,
              "requiredBinary": "source-ffmpeg",
              "license": {
                "name": "FFmpeg",
                "spdxExpression": "LGPL-2.1-or-later OR GPL-2.0-or-later",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "source-ffmpeg.exe",
                  "binaryName": "source-ffmpeg.exe",
                  "integrity": {
                    "sha256": "0a12a223d95ee4b82f52a24a094fddd9ff8821e71ae6eca44497dbdbc2ac5df3",
                    "byteSize": 26
                  }
                }
              }
            }"#,
        )
        .expect("write source manifest with sidecar");

        let toolchain = resolve_autocut_ffmpeg_toolchain_from_candidate_manifests(
            &[runtime_manifest_path, source_manifest_path],
            None,
            "windows",
            "x86_64",
        )
        .expect("resolve FFmpeg toolchain from source sidecar");

        assert_eq!(
            toolchain.executable,
            source_sidecar_path.display().to_string()
        );
        assert_eq!(toolchain.source_kind, "bundled-sidecar");
        assert!(toolchain.bundled_ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|message| message.contains("missing bundled FFmpeg")),
            "runtime missing sidecar diagnostic should be retained: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn safe_media_path_rejects_traversal_and_relative_paths() {
        let root = unique_temp_dir("sdkwork-autocut-media-path");

        assert!(
            ensure_safe_media_path(&root, Path::new("relative.mp4")).is_err(),
            "relative media paths must not be accepted"
        );
        assert!(
            ensure_safe_media_path(&root, &root.join("..").join("escape.mp4")).is_err(),
            "paths that escape the media root must not be accepted"
        );
    }

    #[test]
    fn media_import_copies_source_file_into_sandbox_and_registers_asset() {
        let root = unique_temp_dir("sdkwork-autocut-media-import-root");
        let source_root = unique_temp_dir("sdkwork-autocut-media-import-source");
        let source_path = source_root.join("source clip.mp4");
        fs::write(&source_path, b"autocut source bytes").expect("write source media");
        let connection = prepared_connection();

        let result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import media file");

        assert!(
            !result.asset_uuid.is_empty(),
            "import result must expose an asset uuid"
        );
        assert_eq!(result.name, "source clip.mp4");
        assert_eq!(result.byte_size, 20);

        let sandbox_path = PathBuf::from(&result.sandbox_path);
        let expected_input_root = root
            .join(AUTOCUT_MEDIA_INPUT_DIR)
            .canonicalize()
            .expect("canonicalize expected input root");
        assert!(
            sandbox_path.starts_with(expected_input_root),
            "imported source must be copied under the media input sandbox"
        );
        assert_eq!(
            fs::read(&sandbox_path).expect("read imported file"),
            b"autocut source bytes"
        );

        let (row_count, uuid, source_uri, byte_size) = connection
            .query_row(
                "SELECT COUNT(*), MAX(uuid), MAX(source_uri), MAX(byte_size) FROM media_asset",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .expect("query imported asset");
        assert_eq!(row_count, 1);
        assert_eq!(uuid, result.asset_uuid);
        assert_eq!(source_uri, result.sandbox_path);
        assert_eq!(byte_size, 20);
    }

    #[test]
    fn local_media_describe_reports_canonical_path_and_metadata_without_importing() {
        let source_root = unique_temp_dir("sdkwork-autocut-local-media-describe");
        let source_path = source_root.join("source clip.mp4");
        fs::write(&source_path, b"autocut source bytes").expect("write source media");
        let description = describe_autocut_local_media_file_from_path(&source_path, None)
            .expect("describe local media file");

        assert_eq!(description.name, "source clip.mp4");
        assert_eq!(description.byte_size, 20);
        assert_eq!(description.media_type, "video");
        assert_eq!(description.mime_type, "video/mp4");
        assert_eq!(
            description.source_path,
            source_path
                .canonicalize()
                .expect("canonicalize source path")
                .display()
                .to_string()
        );
    }

    #[test]
    fn media_import_rejects_relative_and_missing_source_paths() {
        let root = unique_temp_dir("sdkwork-autocut-media-import-invalid");
        let connection = prepared_connection();

        let relative_error = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: "relative.mp4".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect_err("relative imports must be rejected");
        assert!(
            relative_error.contains("absolute"),
            "relative path diagnostic should explain the absolute path requirement: {relative_error}"
        );

        let missing_error = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: root.join("missing.mp4").display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect_err("missing imports must be rejected");
        assert!(
            missing_error.contains("does not exist"),
            "missing path diagnostic should explain the source file is absent: {missing_error}"
        );
    }

    #[test]
    fn audio_extraction_from_asset_registers_artifact_task_and_stage_rows() {
        let root = unique_temp_dir("sdkwork-autocut-asset-extraction-root");
        let source_root = unique_temp_dir("sdkwork-autocut-asset-extraction-source");
        let source_path = source_root.join("voice.wav");
        run_ffmpeg_sine_smoke(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source audio");

        let extraction_result = extract_autocut_audio_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutAudioExtractionRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                output_format: "wav".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract audio from imported asset");

        assert_eq!(
            extraction_result.source_asset_uuid,
            import_result.asset_uuid
        );
        assert_ops_task_input_has_source_name(
            &connection,
            &extraction_result.task_uuid,
            &import_result.asset_uuid,
            &import_result.name,
        );
        assert!(
            !extraction_result.artifact_uuid.is_empty(),
            "audio extraction must expose the media_artifact uuid"
        );
        assert!(
            !extraction_result.task_uuid.is_empty(),
            "audio extraction must expose the ops_task uuid"
        );
        assert!(
            Path::new(&extraction_result.artifact_path).starts_with(
                root.join(AUTOCUT_MEDIA_TASK_DIR)
                    .join(&extraction_result.task_uuid)
                    .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
                    .canonicalize()
                    .expect("canonical audio task output directory")
            ),
            "audio artifact must stay inside its task output directory"
        );

        let artifact_count = connection
            .query_row(
                "SELECT COUNT(*) FROM media_artifact WHERE uuid = ?1 AND task_uuid = ?2 AND source_asset_uuid = ?3",
                [
                    extraction_result.artifact_uuid.as_str(),
                    extraction_result.task_uuid.as_str(),
                    extraction_result.source_asset_uuid.as_str(),
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query media_artifact row");
        assert_eq!(artifact_count, 1);

        let task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE uuid = ?1 AND source_asset_uuid = ?2 AND status = 2 AND progress = 100",
                [
                    extraction_result.task_uuid.as_str(),
                    extraction_result.source_asset_uuid.as_str(),
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query ops_task row");
        assert_eq!(task_count, 1);

        let stage_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_stage_run WHERE task_uuid = ?1 AND status = 2",
                [extraction_result.task_uuid.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .expect("query ops_stage_run row");
        assert_eq!(stage_count, 1);

        let progress_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![
                    extraction_result.task_uuid.as_str(),
                    OPS_TASK_EVENT_TYPE_PROGRESS
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query progress audit events");
        assert!(
            progress_event_count >= 2,
            "audio extraction must persist command preparation and FFmpeg output progress events"
        );
        let released_lease_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_worker_lease WHERE task_uuid = ?1 AND lease_status = ?2",
                params![
                    extraction_result.task_uuid.as_str(),
                    OPS_WORKER_LEASE_STATUS_RELEASED
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query released worker lease count");
        assert_eq!(
            released_lease_count, 1,
            "audio extraction must acquire and release exactly one worker lease"
        );
    }

    #[test]
    fn native_task_query_returns_task_stage_and_event_snapshots() {
        let root = unique_temp_dir("sdkwork-autocut-native-task-query-root");
        let source_root = unique_temp_dir("sdkwork-autocut-native-task-query-source");
        let source_path = source_root.join("voice.wav");
        run_ffmpeg_sine_smoke(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source audio");

        let extraction_result = extract_autocut_audio_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutAudioExtractionRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                output_format: "wav".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract audio from imported asset");

        let snapshots = list_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskQueryRequest {
                limit: Some(10),
                task_uuid: Some(extraction_result.task_uuid.clone()),
            },
        )
        .expect("list native task snapshots");

        assert_eq!(snapshots.len(), 1);
        let snapshot = &snapshots[0];
        assert_eq!(snapshot.uuid, extraction_result.task_uuid);
        assert_eq!(snapshot.source_asset_uuid, Some(import_result.asset_uuid));
        assert_eq!(snapshot.status, OPS_STATUS_COMPLETED);
        assert_eq!(snapshot.progress, 100);
        assert_eq!(snapshot.stages.len(), 1);
        assert_eq!(snapshot.stages[0].status, OPS_STATUS_COMPLETED);
        assert_eq!(snapshot.worker_leases.len(), 1);
        assert_eq!(
            snapshot.worker_leases[0].lease_status,
            OPS_WORKER_LEASE_STATUS_RELEASED
        );
        assert_eq!(
            snapshot.worker_leases[0].worker_id,
            "autocut-native-media-worker"
        );
        assert!(
            snapshot.events.len() >= 2,
            "task query must include started and completed events: {:?}",
            snapshot.events
        );
        assert!(
            snapshot
                .events
                .iter()
                .any(|event| event.event_type == OPS_TASK_EVENT_TYPE_STARTED),
            "task query must include the started event"
        );
        let started_event = snapshot
            .events
            .iter()
            .find(|event| event.event_type == OPS_TASK_EVENT_TYPE_STARTED)
            .expect("task query must include the started event");
        let input_json: Value =
            serde_json::from_str(&snapshot.input_json).expect("parse snapshot input JSON");
        assert_eq!(input_json["sourceName"], import_result.name);
        assert_eq!(started_event.payload["operation"], "audioExtraction");
        assert_eq!(started_event.payload["phase"], "native-task-started");
        assert_eq!(started_event.payload["source"], "native-host");
        assert!(
            snapshot
                .events
                .iter()
                .filter(|event| event.event_type == OPS_TASK_EVENT_TYPE_PROGRESS)
                .all(|event| event.payload["operation"] == "audioExtraction"
                    && event.payload["source"].is_string()
                    && event.payload["progress"].is_i64()),
            "task query progress events must expose stable progress payload fields"
        );
        let completed_event = snapshot
            .events
            .iter()
            .find(|event| event.event_type == OPS_TASK_EVENT_TYPE_COMPLETED)
            .expect("task query must include the completed event");
        assert_eq!(completed_event.payload["operation"], "audioExtraction");
        assert_eq!(completed_event.payload["phase"], "native-task-completed");
        assert_eq!(completed_event.payload["source"], "native-host");
        assert_eq!(completed_event.payload["progress"], 100);
        assert!(
            snapshot
                .events
                .iter()
                .any(|event| event.event_type == OPS_TASK_EVENT_TYPE_COMPLETED),
            "task query must include the completed event"
        );
    }

    #[test]
    fn native_task_preview_scope_collection_uses_only_absolute_output_roots() {
        let configured_root = unique_temp_dir("sdkwork-autocut-preview-scope-output-root");
        let task_uuid = "ops-task-preview-scope";
        let task_output_dir = configured_root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(task_uuid)
            .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR);
        let snapshots = vec![
            AutoCutNativeTaskSnapshot {
                uuid: task_uuid.to_string(),
                task_type: OPS_TASK_TYPE_VIDEO_SLICE,
                status: OPS_STATUS_COMPLETED,
                progress: 100,
                source_asset_uuid: Some("asset-preview-scope".to_string()),
                input_json: json!({
                    "outputRootDir": configured_root.display().to_string()
                })
                .to_string(),
                output_json: json!({
                    "taskOutputDir": task_output_dir.display().to_string(),
                    "sliceResults": [
                        {
                            "artifactPath": task_output_dir.join("slice-001.mp4").display().to_string(),
                            "thumbnailArtifactPath": task_output_dir.join(AUTOCUT_MEDIA_TASK_COVER_DIR).join("slice-001.jpg").display().to_string()
                        }
                    ]
                })
                .to_string(),
                error_code: None,
                error_message: None,
                created_at: "2026-05-06T00:00:00Z".to_string(),
                updated_at: "2026-05-06T00:00:01Z".to_string(),
                stages: Vec::new(),
                events: Vec::new(),
                worker_leases: Vec::new(),
            },
            AutoCutNativeTaskSnapshot {
                uuid: "ops-task-relative-output".to_string(),
                task_type: OPS_TASK_TYPE_AUDIO_EXTRACTION,
                status: OPS_STATUS_COMPLETED,
                progress: 100,
                source_asset_uuid: Some("asset-relative-output".to_string()),
                input_json: json!({
                    "outputRootDir": "relative-output-root"
                })
                .to_string(),
                output_json: json!({
                    "taskOutputDir": "relative/tasks/ops-task-relative-output/outputs"
                })
                .to_string(),
                error_code: None,
                error_message: None,
                created_at: "2026-05-06T00:00:02Z".to_string(),
                updated_at: "2026-05-06T00:00:03Z".to_string(),
                stages: Vec::new(),
                events: Vec::new(),
                worker_leases: Vec::new(),
            },
        ];

        let directories = collect_autocut_native_task_preview_directories(&snapshots);

        assert_eq!(
            directories,
            vec![configured_root],
            "preview scope collection must restore each absolute configured output root once and ignore relative history"
        );
    }

    #[test]
    fn native_task_cancel_does_not_mutate_untracked_processing_task() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);

        let cancel_result = cancel_autocut_native_task_on_connection(
            &connection,
            AutoCutNativeTaskCancelRequest {
                task_uuid: task_uuid.clone(),
            },
        )
        .expect("cancel untracked task");

        assert_eq!(cancel_result.task_uuid, task_uuid);
        assert_eq!(cancel_result.status, OPS_STATUS_PROCESSING);
        assert!(!cancel_result.canceled);

        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_PROCESSING);
        let cancel_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type IN (?2, ?3)",
                params![
                    task_uuid.as_str(),
                    OPS_TASK_EVENT_TYPE_CANCEL_REQUESTED,
                    OPS_TASK_EVENT_TYPE_CANCELED
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query cancel events");
        assert_eq!(cancel_event_count, 0);
    }

    #[test]
    fn native_task_cancel_kills_tracked_ffmpeg_process_and_records_cancel_request() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        let output_path =
            unique_temp_dir("sdkwork-autocut-native-cancel").join("cancelled-audio.wav");
        let runner_task_uuid = task_uuid.clone();
        let toolchain = test_system_ffmpeg_toolchain();

        let runner = std::thread::spawn(move || {
            let mut command = Command::new(toolchain.executable);
            command.args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-re",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=30",
                "-vn",
                "-acodec",
                "pcm_s16le",
            ]);
            command.arg(output_path);
            run_tracked_ffmpeg_command_with_progress(
                &runner_task_uuid,
                &mut command,
                "cancel test",
                |_| Ok(()),
            )
        });

        wait_until_tracked_native_media_process(&task_uuid);
        let cancel_result = cancel_autocut_native_task_on_connection(
            &connection,
            AutoCutNativeTaskCancelRequest {
                task_uuid: task_uuid.clone(),
            },
        )
        .expect("cancel tracked task");

        assert_eq!(cancel_result.task_uuid, task_uuid);
        assert_eq!(cancel_result.status, OPS_STATUS_CANCEL_REQUESTED);
        assert!(cancel_result.canceled);

        let output = runner
            .join()
            .expect("tracked FFmpeg runner should not panic")
            .expect("tracked FFmpeg runner should return an output after cancellation");
        assert!(
            !output.status.success(),
            "canceled FFmpeg process must exit unsuccessfully"
        );
        assert!(
            !has_tracked_native_media_process(&task_uuid),
            "tracked FFmpeg registry entry must be removed after process exit"
        );

        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_CANCEL_REQUESTED);
        let cancel_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_CANCEL_REQUESTED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query cancel requested event");
        assert_eq!(cancel_event_count, 1);
    }

    #[test]
    fn canceled_successful_operation_records_canceled_state_before_completion() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        mark_ops_task_cancel_requested(&connection, &task_uuid).expect("mark cancel requested");
        let asset = AutoCutRegisteredMediaAsset {
            uuid: "media-asset-cancel-success".to_string(),
            name: "cancel-success.wav".to_string(),
            source_uri: "cancel-success.wav".to_string(),
        };
        let spec = AutoCutMediaOperationSpec {
            operation: "cancelSuccess",
            task_type: OPS_TASK_TYPE_AUDIO_EXTRACTION,
            stage_type: OPS_STAGE_TYPE_AUDIO_EXTRACTION,
            artifact_type: MEDIA_ARTIFACT_TYPE_AUDIO,
            artifact_name_suffix: "audio.wav".to_string(),
            mime_type: "audio/wav",
            input_json: json!({ "operation": "cancelSuccess" }),
            failure_error_code: "CANCEL_SUCCESS_TEST_FAILED",
        };

        let canceled =
            finish_canceled_operation_if_requested(&connection, &task_uuid, &asset, &spec)
                .expect("finish canceled operation");

        assert!(canceled);
        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_CANCELED);
        let canceled_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_CANCELED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query canceled event");
        assert_eq!(canceled_event_count, 1);
    }

    #[test]
    fn native_task_recovery_marks_untracked_processing_task_interrupted() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        let lease = acquire_ops_worker_lease(
            &connection,
            &task_uuid,
            "worker-recovery-expired-processing",
            30,
            json!({ "operation": "cancelTest" }),
        )
        .expect("acquire recovery fixture lease")
        .expect("lease should be active");
        force_worker_lease_expired(&connection, &lease.uuid);

        let recovery_result = recover_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskRecoveryRequest { limit: Some(20) },
        )
        .expect("recover native tasks");

        assert_eq!(recovery_result.inspected, 1);
        assert_eq!(recovery_result.recovered, 1);
        assert_eq!(recovery_result.interrupted, 1);
        assert_eq!(recovery_result.canceled, 0);
        assert_eq!(recovery_result.expired_leases, 1);
        assert_eq!(recovery_result.deferred, 0);
        assert_eq!(recovery_result.task_uuids, vec![task_uuid.clone()]);
        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_INTERRUPTED);
        let interrupted_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_INTERRUPTED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query interrupted event");
        assert_eq!(interrupted_event_count, 1);
        assert_eq!(
            read_worker_lease_status(&connection, &lease.uuid),
            OPS_WORKER_LEASE_STATUS_EXPIRED,
        );
        let interrupted_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_INTERRUPTED);
        assert_eq!(interrupted_payload["leaseUuid"], lease.uuid);
        assert_eq!(
            interrupted_payload["leaseStatus"],
            OPS_WORKER_LEASE_STATUS_EXPIRED
        );
        assert_eq!(interrupted_payload["reason"], "expiredWorkerLease");
    }

    #[test]
    fn native_task_recovery_marks_untracked_cancel_requested_task_canceled() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        mark_ops_task_cancel_requested(&connection, &task_uuid).expect("mark cancel requested");
        let lease = acquire_ops_worker_lease(
            &connection,
            &task_uuid,
            "worker-recovery-expired-cancel",
            30,
            json!({ "operation": "cancelTest" }),
        )
        .expect("acquire cancel recovery fixture lease")
        .expect("lease should be active");
        force_worker_lease_expired(&connection, &lease.uuid);

        let recovery_result = recover_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskRecoveryRequest { limit: Some(20) },
        )
        .expect("recover native tasks");

        assert_eq!(recovery_result.inspected, 1);
        assert_eq!(recovery_result.recovered, 1);
        assert_eq!(recovery_result.interrupted, 0);
        assert_eq!(recovery_result.canceled, 1);
        assert_eq!(recovery_result.expired_leases, 1);
        assert_eq!(recovery_result.deferred, 0);
        assert_eq!(recovery_result.task_uuids, vec![task_uuid.clone()]);
        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_CANCELED);
        let canceled_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_CANCELED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query canceled event");
        assert_eq!(canceled_event_count, 1);
        assert_eq!(
            read_worker_lease_status(&connection, &lease.uuid),
            OPS_WORKER_LEASE_STATUS_EXPIRED,
        );
        let canceled_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_CANCELED);
        assert_eq!(canceled_payload["leaseUuid"], lease.uuid);
        assert_eq!(
            canceled_payload["leaseStatus"],
            OPS_WORKER_LEASE_STATUS_EXPIRED
        );
        assert_eq!(canceled_payload["reason"], "expiredWorkerLease");
    }

    #[test]
    fn native_task_recovery_defers_untracked_processing_task_with_active_unexpired_lease() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        let lease = acquire_ops_worker_lease(
            &connection,
            &task_uuid,
            "worker-recovery-active-processing",
            120,
            json!({ "operation": "cancelTest" }),
        )
        .expect("acquire active recovery fixture lease")
        .expect("lease should be active");

        let recovery_result = recover_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskRecoveryRequest { limit: Some(20) },
        )
        .expect("recover native tasks");

        assert_eq!(recovery_result.inspected, 1);
        assert_eq!(recovery_result.recovered, 0);
        assert_eq!(recovery_result.interrupted, 0);
        assert_eq!(recovery_result.canceled, 0);
        assert_eq!(recovery_result.expired_leases, 0);
        assert_eq!(recovery_result.deferred, 1);
        assert!(recovery_result.task_uuids.is_empty());
        assert_eq!(
            read_ops_task_status(&connection, &task_uuid)
                .expect("read processing task")
                .expect("task exists"),
            OPS_STATUS_PROCESSING,
        );
        assert_eq!(
            read_worker_lease_status(&connection, &lease.uuid),
            OPS_WORKER_LEASE_STATUS_ACTIVE,
        );
        let interrupted_event_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![task_uuid.as_str(), OPS_TASK_EVENT_TYPE_INTERRUPTED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query interrupted events");
        assert_eq!(interrupted_event_count, 0);
    }

    #[test]
    fn native_task_recovery_does_not_mutate_terminal_tasks() {
        let connection = prepared_connection();
        let completed_task_uuid = autocut_uuid("ops-task").expect("create completed task uuid");
        let failed_task_uuid = autocut_uuid("ops-task").expect("create failed task uuid");
        let canceled_task_uuid = autocut_uuid("ops-task").expect("create canceled task uuid");
        insert_processing_task_fixture(&connection, &completed_task_uuid);
        insert_processing_task_fixture(&connection, &failed_task_uuid);
        insert_processing_task_fixture(&connection, &canceled_task_uuid);
        connection
            .execute(
                "UPDATE ops_task SET status = ?1 WHERE uuid = ?2",
                params![OPS_STATUS_COMPLETED, completed_task_uuid.as_str()],
            )
            .expect("mark completed fixture");
        connection
            .execute(
                "UPDATE ops_task SET status = ?1 WHERE uuid = ?2",
                params![OPS_STATUS_FAILED, failed_task_uuid.as_str()],
            )
            .expect("mark failed fixture");
        connection
            .execute(
                "UPDATE ops_task SET status = ?1 WHERE uuid = ?2",
                params![OPS_STATUS_CANCELED, canceled_task_uuid.as_str()],
            )
            .expect("mark canceled fixture");

        let recovery_result = recover_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskRecoveryRequest { limit: Some(20) },
        )
        .expect("recover native tasks");

        assert_eq!(recovery_result.inspected, 0);
        assert_eq!(recovery_result.recovered, 0);
        assert_eq!(recovery_result.interrupted, 0);
        assert_eq!(recovery_result.canceled, 0);
        assert_eq!(recovery_result.expired_leases, 0);
        assert_eq!(recovery_result.deferred, 0);
        assert!(recovery_result.task_uuids.is_empty());
        assert_eq!(
            read_ops_task_status(&connection, &completed_task_uuid)
                .expect("read completed")
                .expect("completed exists"),
            OPS_STATUS_COMPLETED,
        );
        assert_eq!(
            read_ops_task_status(&connection, &failed_task_uuid)
                .expect("read failed")
                .expect("failed exists"),
            OPS_STATUS_FAILED,
        );
        assert_eq!(
            read_ops_task_status(&connection, &canceled_task_uuid)
                .expect("read canceled")
                .expect("canceled exists"),
            OPS_STATUS_CANCELED,
        );
    }

    #[test]
    fn native_task_recovery_does_not_mutate_tracked_processing_task() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        let output_path =
            unique_temp_dir("sdkwork-autocut-native-recovery-tracked").join("tracked-audio.wav");
        let runner_task_uuid = task_uuid.clone();
        let toolchain = test_system_ffmpeg_toolchain();

        let runner = std::thread::spawn(move || {
            let mut command = Command::new(toolchain.executable);
            command.args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-re",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=30",
                "-vn",
                "-acodec",
                "pcm_s16le",
            ]);
            command.arg(output_path);
            run_tracked_ffmpeg_command_with_progress(
                &runner_task_uuid,
                &mut command,
                "recovery tracked test",
                |_| Ok(()),
            )
        });

        wait_until_tracked_native_media_process(&task_uuid);
        let recovery_result = recover_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskRecoveryRequest { limit: Some(20) },
        )
        .expect("recover native tasks with tracked process");

        assert_eq!(recovery_result.inspected, 1);
        assert_eq!(recovery_result.recovered, 0);
        assert_eq!(recovery_result.interrupted, 0);
        assert_eq!(recovery_result.canceled, 0);
        assert_eq!(recovery_result.expired_leases, 0);
        assert_eq!(recovery_result.deferred, 0);
        assert!(recovery_result.task_uuids.is_empty());
        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_PROCESSING);

        cancel_tracked_native_media_process(&task_uuid).expect("cancel tracked recovery fixture");
        let output = runner
            .join()
            .expect("tracked FFmpeg runner should not panic")
            .expect("tracked FFmpeg runner should return an output after cleanup");
        assert!(
            !output.status.success(),
            "cleanup should stop the long-running FFmpeg fixture"
        );
    }

    #[test]
    fn native_task_retry_creates_new_task_from_interrupted_audio_extraction() {
        let root = unique_temp_dir("sdkwork-autocut-native-retry-audio-root");
        let source_root = unique_temp_dir("sdkwork-autocut-native-retry-audio-source");
        let source_path = source_root.join("source.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source media");
        let original_task_uuid = autocut_uuid("ops-task").expect("create original task uuid");
        let retry_spec = AutoCutMediaOperationSpec {
            operation: "audioExtraction",
            task_type: OPS_TASK_TYPE_AUDIO_EXTRACTION,
            stage_type: OPS_STAGE_TYPE_AUDIO_EXTRACTION,
            artifact_type: MEDIA_ARTIFACT_TYPE_AUDIO,
            artifact_name_suffix: "audio.wav".to_string(),
            mime_type: "audio/wav",
            input_json: json!({
                "assetUuid": import_result.asset_uuid,
                "outputFormat": "wav"
            }),
            failure_error_code: "FFMPEG_AUDIO_EXTRACTION_FAILED",
        };
        insert_ops_task(
            &connection,
            &original_task_uuid,
            &import_result.asset_uuid,
            &retry_spec,
        )
        .expect("insert retry source task");
        mark_ops_task_interrupted(&connection, &original_task_uuid).expect("mark interrupted");

        let retry_result = retry_autocut_native_task_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutNativeTaskRetryRequest {
                task_uuid: original_task_uuid.clone(),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("retry interrupted task");

        assert_eq!(retry_result.task_uuid, original_task_uuid);
        assert_ne!(retry_result.retry_task_uuid, retry_result.task_uuid);
        assert_eq!(retry_result.status, OPS_STATUS_COMPLETED);
        assert!(retry_result.retried);
        let original_status = read_ops_task_status(&connection, &retry_result.task_uuid)
            .expect("read original status")
            .expect("original exists");
        assert_eq!(original_status, OPS_STATUS_INTERRUPTED);
        let retry_status = read_ops_task_status(&connection, &retry_result.retry_task_uuid)
            .expect("read retry status")
            .expect("retry exists");
        assert_eq!(retry_status, OPS_STATUS_COMPLETED);
        let retry_requested_events = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task_event WHERE task_uuid = ?1 AND event_type = ?2",
                params![
                    retry_result.task_uuid.as_str(),
                    OPS_TASK_EVENT_TYPE_RETRY_REQUESTED
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query retry requested event");
        assert_eq!(retry_requested_events, 1);
    }

    #[test]
    fn native_task_retry_preserves_configured_output_root() {
        let default_root = unique_temp_dir("sdkwork-autocut-native-retry-default-root");
        let configured_root = unique_temp_dir("sdkwork-autocut-native-retry-output-root");
        let source_root = unique_temp_dir("sdkwork-autocut-native-retry-output-source");
        let source_path = source_root.join("source.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &default_root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: Some(configured_root.display().to_string()),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source media into configured output root");
        let original_task_uuid = autocut_uuid("ops-task").expect("create original task uuid");
        let retry_spec = AutoCutMediaOperationSpec {
            operation: "audioExtraction",
            task_type: OPS_TASK_TYPE_AUDIO_EXTRACTION,
            stage_type: OPS_STAGE_TYPE_AUDIO_EXTRACTION,
            artifact_type: MEDIA_ARTIFACT_TYPE_AUDIO,
            artifact_name_suffix: "audio.wav".to_string(),
            mime_type: "audio/wav",
            input_json: json!({
                "assetUuid": import_result.asset_uuid,
                "outputFormat": "wav",
                "outputRootDir": configured_root.display().to_string()
            }),
            failure_error_code: "FFMPEG_AUDIO_EXTRACTION_FAILED",
        };
        insert_ops_task(
            &connection,
            &original_task_uuid,
            &import_result.asset_uuid,
            &retry_spec,
        )
        .expect("insert retry source task with configured output root");
        mark_ops_task_interrupted(&connection, &original_task_uuid).expect("mark interrupted");

        let retry_result = retry_autocut_native_task_in_root_with_toolchain(
            &connection,
            &default_root,
            AutoCutNativeTaskRetryRequest {
                task_uuid: original_task_uuid,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("retry interrupted task with configured output root");

        let canonical_configured_root = configured_root
            .canonicalize()
            .expect("canonical configured output root");
        let retry_output_json = connection
            .query_row(
                "SELECT output_json FROM ops_task WHERE uuid = ?1",
                [retry_result.retry_task_uuid.as_str()],
                |row| row.get::<_, String>(0),
            )
            .expect("read retry output JSON");
        let retry_output: Value =
            serde_json::from_str(&retry_output_json).expect("retry output JSON");
        let retry_task_output_dir = retry_output["taskOutputDir"]
            .as_str()
            .expect("retry task output dir");
        assert!(
            Path::new(retry_task_output_dir).starts_with(
                canonical_configured_root
                    .join(AUTOCUT_MEDIA_TASK_DIR)
                    .join(&retry_result.retry_task_uuid)
                    .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
            ),
            "retry task output directory must stay under the configured output root"
        );
    }

    #[test]
    fn native_task_retry_rejects_legacy_video_slices_without_speech_to_text_evidence() {
        let root = unique_temp_dir("sdkwork-autocut-native-retry-legacy-slice-root");
        let source_root = unique_temp_dir("sdkwork-autocut-native-retry-legacy-slice-source");
        let source_path = source_root.join("source.mp4");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source media");
        let original_task_uuid = autocut_uuid("ops-task").expect("create original task uuid");
        let retry_spec = AutoCutMediaOperationSpec {
            operation: "videoSlice",
            task_type: OPS_TASK_TYPE_VIDEO_SLICE,
            stage_type: OPS_STAGE_TYPE_VIDEO_SLICE,
            artifact_type: MEDIA_ARTIFACT_TYPE_VIDEO_SLICE,
            artifact_name_suffix: "slice.mp4".to_string(),
            mime_type: "video/mp4",
            input_json: json!({
                "assetUuid": import_result.asset_uuid,
                "outputFormat": "mp4",
                "clips": [
                    {
                        "startMs": 0,
                        "durationMs": 45_000,
                        "label": "Smart slice 1",
                        "outputFileName": "01-smart-slice-1.mp4"
                    }
                ]
            }),
            failure_error_code: "FFMPEG_VIDEO_SLICE_FAILED",
        };
        insert_ops_task(
            &connection,
            &original_task_uuid,
            &import_result.asset_uuid,
            &retry_spec,
        )
        .expect("insert legacy video slice retry source task");
        mark_ops_task_interrupted(&connection, &original_task_uuid).expect("mark interrupted");

        let retry_error = retry_autocut_native_task_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutNativeTaskRetryRequest {
                task_uuid: original_task_uuid.clone(),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect_err("legacy video slice retry must fail before reusing transcript-less clips");

        assert!(
            retry_error.contains("Re-run Smart Slice after speech-to-text setup"),
            "legacy retry rejection should tell the user to rerun Smart Slice with STT: {retry_error}"
        );
        assert!(
            retry_error.contains("speech-to-text transcript evidence"),
            "legacy retry rejection should explain the missing STT evidence contract: {retry_error}"
        );
        let original_status = read_ops_task_status(&connection, &original_task_uuid)
            .expect("read original status")
            .expect("original exists");
        assert_eq!(original_status, OPS_STATUS_INTERRUPTED);
        let retry_task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE uuid != ?1 AND task_type = ?2",
                params![original_task_uuid.as_str(), OPS_TASK_TYPE_VIDEO_SLICE],
                |row| row.get::<_, i64>(0),
            )
            .expect("query retry task count");
        assert_eq!(
            retry_task_count, 0,
            "legacy transcript-less video slice retry must not create a replacement task"
        );
    }

    #[test]
    fn native_task_retry_rejects_processing_task_without_mutation() {
        let root = unique_temp_dir("sdkwork-autocut-native-retry-processing-root");
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create processing task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);

        let retry_error = retry_autocut_native_task_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutNativeTaskRetryRequest {
                task_uuid: task_uuid.clone(),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect_err("processing task must not be retried");

        assert!(
            retry_error.contains("not in a retryable state"),
            "unexpected retry error: {retry_error}"
        );
        let task_status = read_ops_task_status(&connection, &task_uuid)
            .expect("read task status")
            .expect("task exists");
        assert_eq!(task_status, OPS_STATUS_PROCESSING);
    }

    #[test]
    fn native_media_task_writes_artifact_inside_its_task_output_directory() {
        let root = unique_temp_dir("sdkwork-autocut-task-output-root");
        let source_root = unique_temp_dir("sdkwork-autocut-task-output-source");
        let source_path = source_root.join("source.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source audio");

        let result = extract_autocut_audio_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutAudioExtractionRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                output_format: "wav".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract audio from imported asset");

        let task_output_dir = root
            .join("tasks")
            .join(&result.task_uuid)
            .join("outputs")
            .canonicalize()
            .expect("canonical task output directory");
        assert!(
            Path::new(&result.artifact_path).starts_with(&task_output_dir),
            "audio artifact must be written under the task outputs directory"
        );
        assert!(
            Path::new(&result.artifact_path).is_file(),
            "audio artifact file must exist in the task outputs directory"
        );

        let (artifact_uri, artifact_metadata_json, task_output_json) = connection
            .query_row(
                r#"
                SELECT media_artifact.uri, media_artifact.metadata_json, ops_task.output_json
                FROM media_artifact
                INNER JOIN ops_task ON ops_task.uuid = media_artifact.task_uuid
                WHERE media_artifact.uuid = ?1
                "#,
                [result.artifact_uuid.as_str()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("query task-scoped artifact storage metadata");
        let artifact_metadata: Value =
            serde_json::from_str(&artifact_metadata_json).expect("artifact metadata JSON");
        let task_output: Value = serde_json::from_str(&task_output_json).expect("task output JSON");

        assert_eq!(artifact_uri, result.artifact_path);
        assert_eq!(
            task_output["taskOutputDir"],
            task_output_dir.display().to_string()
        );
        assert_eq!(
            artifact_metadata["taskOutputDir"],
            task_output_dir.display().to_string()
        );
    }

    #[test]
    fn native_media_task_writes_artifact_inside_configured_output_root() {
        let default_root = unique_temp_dir("sdkwork-autocut-configured-default-root");
        let configured_root = unique_temp_dir("sdkwork-autocut-configured-output-root");
        let source_root = unique_temp_dir("sdkwork-autocut-configured-output-source");
        let source_path = source_root.join("source.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &default_root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: Some(configured_root.display().to_string()),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source audio into configured output root");

        let canonical_configured_root = configured_root
            .canonicalize()
            .expect("canonical configured output root");
        assert!(
            Path::new(&import_result.sandbox_path).starts_with(&canonical_configured_root),
            "imported media must use the configured output root"
        );

        let result = extract_autocut_audio_from_asset_in_root_with_toolchain(
            &connection,
            &default_root,
            AutoCutAudioExtractionRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                output_format: "wav".to_string(),
                output_root_dir: Some(configured_root.display().to_string()),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract audio into configured output root");

        let task_output_dir = canonical_configured_root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(&result.task_uuid)
            .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
            .canonicalize()
            .expect("canonical configured task output directory");
        assert!(
            Path::new(&result.artifact_path).starts_with(&task_output_dir),
            "audio artifact must stay inside the configured task output directory"
        );
        assert_eq!(
            result.task_output_dir,
            task_output_dir.display().to_string()
        );
    }

    #[test]
    fn video_gif_generation_from_asset_registers_gif_artifact_task_and_stage_rows() {
        let root = unique_temp_dir("sdkwork-autocut-video-gif-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-gif-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let gif_result = generate_autocut_gif_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoGifRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                fps: "10".to_string(),
                resolution: "320p".to_string(),
                dither: true,
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("generate video GIF from imported asset");

        assert_eq!(gif_result.source_asset_uuid, import_result.asset_uuid);
        assert_ops_task_input_has_source_name(
            &connection,
            &gif_result.task_uuid,
            &import_result.asset_uuid,
            &import_result.name,
        );
        assert_eq!(gif_result.format, "gif");
        assert!(gif_result.byte_size > 0, "GIF artifact must be non-empty");
        assert!(
            Path::new(&gif_result.artifact_path).starts_with(
                root.join(AUTOCUT_MEDIA_TASK_DIR)
                    .join(&gif_result.task_uuid)
                    .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
                    .canonicalize()
                    .expect("canonical GIF task output directory")
            ),
            "GIF artifact must stay inside its task output directory"
        );

        let (artifact_count, mime_type, artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE uuid = ?1 AND task_uuid = ?2 AND source_asset_uuid = ?3",
                [
                    gif_result.artifact_uuid.as_str(),
                    gif_result.task_uuid.as_str(),
                    gif_result.source_asset_uuid.as_str(),
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query GIF media_artifact row");
        assert_eq!(artifact_count, 1);
        assert_eq!(mime_type, "image/gif");
        assert_eq!(artifact_type, MEDIA_ARTIFACT_TYPE_GIF);

        let task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE uuid = ?1 AND task_type = ?2 AND source_asset_uuid = ?3 AND status = 2 AND progress = 100",
                params![
                    gif_result.task_uuid.as_str(),
                    OPS_TASK_TYPE_VIDEO_GIF,
                    gif_result.source_asset_uuid.as_str(),
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query GIF ops_task row");
        assert_eq!(task_count, 1);

        let stage_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_stage_run WHERE task_uuid = ?1 AND stage_type = ?2 AND status = 2",
                params![gif_result.task_uuid.as_str(), OPS_STAGE_TYPE_VIDEO_GIF],
                |row| row.get::<_, i64>(0),
            )
            .expect("query GIF ops_stage_run row");
        assert_eq!(stage_count, 1);
    }

    #[test]
    fn video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let slice_result = slice_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                clips: vec![
                    AutoCutVideoSliceClipRequest {
                        start_ms: 0,
                        duration_ms: 180,
                        label: "Opening".to_string(),
                        output_file_name: Some("../01-Clear Product Hook.MP4".to_string()),
                        source_start_ms: Some(0),
                        source_end_ms: Some(180),
                        transcript_text: Some(
                            "Opening transcript survives native task output.".to_string(),
                        ),
                        transcript_segments: Some(vec![AutoCutSpeechTranscriptionSegment {
                            start_ms: 10,
                            end_ms: 160,
                            text: "Opening transcript survives native task output.".to_string(),
                            speaker: Some("Speaker 1".to_string()),
                        }]),
                        transcript_segment_count: Some(1),
                        speech_start_ms: Some(10),
                        speech_end_ms: Some(160),
                        boundary_padding_before_ms: Some(10),
                        boundary_padding_after_ms: Some(20),
                        transcript_coverage_score: Some(0.96),
                        speech_continuity_grade: Some("strong".to_string()),
                        ..AutoCutVideoSliceClipRequest::default()
                    },
                    AutoCutVideoSliceClipRequest {
                        start_ms: 180,
                        duration_ms: 180,
                        label: "Moment".to_string(),
                        output_file_name: None,
                        ..smart_slice_test_clip(180, 180, "Moment")
                    },
                ],
                output_format: "mp4".to_string(),
                output_root_dir: None,
                render_profile: None,
                noise_reduction: false,
                subtitle_format: None,
                subtitle_mode: None,
                subtitle_style_id: None,
                subtitle_segments: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("slice video from imported asset");

        assert_eq!(slice_result.source_asset_uuid, import_result.asset_uuid);
        assert_ops_task_input_has_source_name(
            &connection,
            &slice_result.task_uuid,
            &import_result.asset_uuid,
            &import_result.name,
        );
        assert_eq!(slice_result.slices.len(), 2);
        assert!(
            slice_result.slices[0]
                .artifact_path
                .replace('\\', "/")
                .ends_with("/01-clear-product-hook.mp4"),
            "requested smart slice outputFileName must be sanitized and used for the physical artifact path"
        );
        let task_output_dir = root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(&slice_result.task_uuid)
            .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
            .canonicalize()
            .expect("canonical slice task output directory");
        let task_cover_dir = task_output_dir
            .join(AUTOCUT_MEDIA_TASK_COVER_DIR)
            .canonicalize()
            .expect("canonical slice task cover directory");
        assert_eq!(
            slice_result.task_output_dir,
            task_output_dir.display().to_string()
        );
        for slice in &slice_result.slices {
            assert_eq!(slice.format, "mp4");
            assert!(slice.byte_size > 0, "slice artifact must be non-empty");
            assert!(
                Path::new(&slice.artifact_path).starts_with(&task_output_dir),
                "slice artifact must stay inside its task output directory"
            );
            assert!(
                Path::new(&slice.artifact_path).is_file(),
                "slice artifact file must exist"
            );
            assert!(
                Path::new(&slice.thumbnail_artifact_path).starts_with(&task_output_dir),
                "slice thumbnail must stay inside its task output directory"
            );
            assert!(
                Path::new(&slice.thumbnail_artifact_path).starts_with(&task_cover_dir),
                "slice thumbnail must stay inside the dedicated task cover directory"
            );
            assert!(
                Path::new(&slice.thumbnail_artifact_path).is_file(),
                "slice thumbnail file must exist"
            );
            assert!(
                slice.thumbnail_byte_size > 0,
                "slice thumbnail artifact must be non-empty"
            );
        }

        let (artifact_count, mime_type, artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE task_uuid = ?1 AND source_asset_uuid = ?2 AND artifact_type = ?3",
                params![
                    slice_result.task_uuid.as_str(),
                    slice_result.source_asset_uuid.as_str(),
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE,
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query slice media_artifact rows");
        assert_eq!(artifact_count, 2);
        assert_eq!(mime_type, "video/mp4");
        assert_eq!(artifact_type, MEDIA_ARTIFACT_TYPE_VIDEO_SLICE);
        let (thumbnail_count, thumbnail_mime_type, thumbnail_artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE task_uuid = ?1 AND source_asset_uuid = ?2 AND artifact_type = ?3",
                params![
                    slice_result.task_uuid.as_str(),
                    slice_result.source_asset_uuid.as_str(),
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL,
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query slice thumbnail media_artifact rows");
        assert_eq!(thumbnail_count, 2);
        assert_eq!(thumbnail_mime_type, "image/jpeg");
        assert_eq!(
            thumbnail_artifact_type,
            MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL
        );

        let task_output_json = connection
            .query_row(
                "SELECT output_json FROM ops_task WHERE uuid = ?1 AND task_type = ?2 AND status = ?3 AND progress = 100",
                params![
                    slice_result.task_uuid.as_str(),
                    OPS_TASK_TYPE_VIDEO_SLICE,
                    OPS_STATUS_COMPLETED,
                ],
                |row| row.get::<_, String>(0),
            )
            .expect("query slice ops_task output_json");
        let task_output: Value =
            serde_json::from_str(&task_output_json).expect("parse slice task output JSON");
        assert_eq!(task_output["taskOutputDir"], slice_result.task_output_dir);
        assert_eq!(
            task_output["sliceResults"].as_array().map(Vec::len),
            Some(2)
        );
        assert!(
            task_output["sliceResults"][0]["thumbnailArtifactPath"].is_string(),
            "slice task output JSON must persist thumbnailArtifactPath"
        );
        assert!(
            task_output["sliceResults"][0]["thumbnailArtifactPath"]
                .as_str()
                .unwrap_or_default()
                .replace('\\', "/")
                .contains("/outputs/cover/"),
            "slice task output JSON must persist thumbnailArtifactPath inside the task cover directory"
        );
        assert_eq!(
            task_output["sliceResults"][0]["transcriptText"],
            "Opening transcript survives native task output.",
            "slice task output JSON must persist slice-level speech-to-text transcript text"
        );
        assert_eq!(
            task_output["sliceResults"][0]["transcriptSegments"][0]["text"],
            "Opening transcript survives native task output.",
            "slice task output JSON must persist structured slice-level transcript segments"
        );
        assert_eq!(
            task_output["sliceResults"][0]["speechStartMs"], 10,
            "slice task output JSON must persist unpadded speech start"
        );
        assert_eq!(
            task_output["sliceResults"][0]["boundaryPaddingAfterMs"], 20,
            "slice task output JSON must persist professional trailing speech padding"
        );

        let stage_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_stage_run WHERE task_uuid = ?1 AND stage_type = ?2 AND status = 2",
                params![slice_result.task_uuid.as_str(), OPS_STAGE_TYPE_VIDEO_SLICE],
                |row| row.get::<_, i64>(0),
            )
            .expect("query slice ops_stage_run row");
        assert_eq!(stage_count, 1);
        println!("autocut-video-slice-smoke=passed");
    }

    #[test]
    fn video_slice_from_asset_preserves_audible_audio_stream() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-audio-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-audio-source");
        let source_path = source_root.join("clip-with-audio.mp4");
        let toolchain = test_system_ffmpeg_toolchain();
        run_ffmpeg_test_video_with_audio(&toolchain, &source_path)
            .expect("create source video with audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &toolchain,
        )
        .expect("import source video with audio");

        let slice_result = slice_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                clips: vec![smart_slice_test_clip(700, 800, "Audible")],
                output_format: "mp4".to_string(),
                output_root_dir: None,
                render_profile: None,
                noise_reduction: true,
                subtitle_format: None,
                subtitle_mode: None,
                subtitle_style_id: None,
                subtitle_segments: None,
            },
            &toolchain,
        )
        .expect("slice video from imported asset with audio");

        let artifact_path = Path::new(&slice_result.slices[0].artifact_path);
        assert_ffmpeg_video_has_audible_audio(&toolchain, artifact_path)
            .expect("sliced video should preserve an audible audio stream");
    }

    #[test]
    fn video_slice_from_asset_writes_task_scoped_srt_subtitle_artifacts() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-subtitle-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-subtitle-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let slice_result = slice_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                clips: vec![smart_slice_test_clip(100, 300, "Opening")],
                output_format: "mp4".to_string(),
                output_root_dir: None,
                render_profile: None,
                noise_reduction: false,
                subtitle_format: Some("srt".to_string()),
                subtitle_mode: None,
                subtitle_style_id: Some("clean-default".to_string()),
                subtitle_segments: Some(vec![
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 50,
                        end_ms: 150,
                        text: "before opening".to_string(),
                        speaker: Some("Speaker 1".to_string()),
                    },
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 150,
                        end_ms: 300,
                        text: "opening highlight".to_string(),
                        speaker: Some("Speaker 1".to_string()),
                    },
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 320,
                        end_ms: 450,
                        text: "closing note".to_string(),
                        speaker: None,
                    },
                ]),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("slice video with task-scoped subtitle artifacts");

        assert_eq!(slice_result.slices.len(), 1);
        let subtitle_path = slice_result.slices[0]
            .subtitle_artifact_path
            .as_deref()
            .expect("subtitle artifact path should be returned");
        let task_output_dir = root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(&slice_result.task_uuid)
            .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
            .canonicalize()
            .expect("canonical slice task output directory");
        assert!(
            Path::new(subtitle_path).starts_with(&task_output_dir),
            "subtitle artifact must stay inside the slice task output directory"
        );
        assert!(
            Path::new(subtitle_path).is_file(),
            "subtitle artifact file must exist"
        );
        let subtitle_text = fs::read_to_string(subtitle_path).expect("read generated subtitle");
        assert!(
            subtitle_text.contains("00:00:00,000 --> 00:00:00,050"),
            "subtitle timings must be relative to the slice start"
        );
        assert!(
            subtitle_text.contains("Speaker 1: before opening"),
            "subtitle text should include speaker labels when available"
        );
        assert!(
            subtitle_text.contains("opening highlight"),
            "subtitle text should include transcript overlap text"
        );

        let (subtitle_count, subtitle_mime_type, subtitle_artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE task_uuid = ?1 AND source_asset_uuid = ?2 AND artifact_type = ?3",
                params![
                    slice_result.task_uuid.as_str(),
                    slice_result.source_asset_uuid.as_str(),
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_SUBTITLE,
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query slice subtitle media_artifact rows");
        assert_eq!(subtitle_count, 1);
        assert_eq!(subtitle_mime_type, "application/x-subrip");
        assert_eq!(
            subtitle_artifact_type,
            MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_SUBTITLE
        );

        let task_output_json = connection
            .query_row(
                "SELECT output_json FROM ops_task WHERE uuid = ?1",
                params![slice_result.task_uuid.as_str()],
                |row| row.get::<_, String>(0),
            )
            .expect("query slice subtitle ops_task output_json");
        let task_output: Value =
            serde_json::from_str(&task_output_json).expect("parse slice subtitle task output JSON");
        assert!(
            task_output["sliceResults"][0]["subtitleArtifactPath"].is_string(),
            "slice task output JSON must persist subtitleArtifactPath"
        );
        assert_eq!(task_output["sliceResults"][0]["subtitleFormat"], "srt");
        assert_eq!(
            task_output["subtitleArtifactCount"], 1,
            "slice task output JSON must count generated subtitle artifacts, not input subtitle segments"
        );

        let task_input_json = connection
            .query_row(
                "SELECT input_json FROM ops_task WHERE uuid = ?1",
                params![slice_result.task_uuid.as_str()],
                |row| row.get::<_, String>(0),
            )
            .expect("query slice subtitle ops_task input_json");
        let task_input: Value =
            serde_json::from_str(&task_input_json).expect("parse slice subtitle task input JSON");
        assert!(
            task_input.get("subtitleArtifactCount").is_none(),
            "slice task input JSON must not report requested subtitle segment count as generated artifact count"
        );
    }

    #[test]
    fn video_slice_srt_subtitles_are_clipped_to_slice_boundaries() {
        let clip = AutoCutVideoSliceClipRequest {
            start_ms: 1_000,
            duration_ms: 2_000,
            label: "Boundary".to_string(),
            output_file_name: None,
            ..AutoCutVideoSliceClipRequest::default()
        };
        let subtitle_text = build_video_slice_srt(
            &clip,
            &[
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 500,
                    end_ms: 1_200,
                    text: "prefix overlap".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 1_300,
                    end_ms: 2_200,
                    text: "inside line".to_string(),
                    speaker: None,
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 2_900,
                    end_ms: 3_500,
                    text: "tail overlap".to_string(),
                    speaker: None,
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 3_500,
                    end_ms: 4_000,
                    text: "outside line".to_string(),
                    speaker: None,
                },
            ],
        );

        assert!(
            subtitle_text.contains("00:00:00,000 --> 00:00:00,200"),
            "subtitle segment starting before the clip must be clamped to zero"
        );
        assert!(
            subtitle_text.contains("00:00:01,900 --> 00:00:02,000"),
            "subtitle segment ending after the clip must be clamped to the clip duration"
        );
        assert!(
            !subtitle_text.contains("outside line"),
            "subtitle segments outside the clip must be excluded"
        );
        assert!(
            !subtitle_text.contains("00:00:02,001"),
            "subtitle timestamps must never exceed the clip duration"
        );
    }

    #[test]
    fn video_slice_subtitle_mode_rejects_contradictory_enabled_requests() {
        let disabled_error = normalize_video_slice_subtitle_mode(Some("none"), Some("srt"), true)
            .expect_err("subtitle segments with explicit none mode must fail closed");
        assert!(
            disabled_error.contains("subtitleMode none cannot be used with subtitle segments"),
            "none-mode rejection should explain the contradictory subtitle request: {disabled_error}"
        );

        let sidecar_error = normalize_video_slice_subtitle_mode(Some("both"), None, true)
            .expect_err("both mode without an SRT subtitle format must fail closed");
        assert!(
            sidecar_error.contains("subtitleMode both requires subtitleFormat srt"),
            "both-mode rejection should explain the missing SRT subtitle sidecar contract: {sidecar_error}"
        );
    }

    #[test]
    fn video_slice_output_file_names_are_sanitized_and_indexed() {
        let clips = normalize_video_slice_clips(&[
            AutoCutVideoSliceClipRequest {
                label: "Clear Product Hook".to_string(),
                output_file_name: Some("../Clear Product Hook?.MP4".to_string()),
                ..smart_slice_test_clip(0, 1_000, "Clear Product Hook")
            },
            AutoCutVideoSliceClipRequest {
                label: "../../爆发原因".to_string(),
                output_file_name: Some("../爆发原因?.mp4".to_string()),
                ..smart_slice_test_clip(1_000, 1_000, "../../爆发原因")
            },
        ])
        .expect("normalize requested smart slice file names");

        assert_eq!(
            clips[0].output_file_name.as_deref(),
            Some("01-clear-product-hook.mp4")
        );
        assert_eq!(
            clips[1].output_file_name.as_deref(),
            Some("02-爆发原因.mp4")
        );
    }

    #[test]
    fn video_slice_rejects_clips_without_speech_to_text_evidence_before_rendering() {
        let error = normalize_video_slice_clips(&[AutoCutVideoSliceClipRequest {
            start_ms: 0,
            duration_ms: 45_000,
            label: "Fixed interval without STT".to_string(),
            output_file_name: None,
            ..AutoCutVideoSliceClipRequest::default()
        }])
        .expect_err("video slicing must fail closed before rendering clips without STT evidence");

        assert!(
            error.contains("speech-to-text transcript evidence"),
            "missing STT evidence rejection should explain the transcript evidence contract: {error}"
        );
    }

    #[test]
    fn open_artifact_folder_validation_rejects_relative_and_missing_paths() {
        let relative_error = ensure_existing_autocut_artifact_file_path(Path::new("relative.mp4"))
            .expect_err("relative artifact paths must be rejected");
        assert!(
            relative_error.contains("absolute path"),
            "relative path rejection should explain the absolute path contract: {relative_error}"
        );

        let missing_path =
            unique_temp_dir("sdkwork-autocut-missing-open-folder").join("missing.mp4");
        let missing_error = ensure_existing_autocut_artifact_file_path(&missing_path)
            .expect_err("missing artifact files must be rejected");
        assert!(
            missing_error.contains("canonicalize AutoCut generated artifact path failed"),
            "missing path rejection should happen before opening the system file manager: {missing_error}"
        );
    }

    #[test]
    fn video_slice_burned_subtitle_mode_renders_without_srt_sidecar() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-burned-subtitle-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-burned-subtitle-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let slice_result = slice_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                clips: vec![smart_slice_test_clip(0, 300, "Burned")],
                output_format: "mp4".to_string(),
                output_root_dir: None,
                render_profile: None,
                noise_reduction: false,
                subtitle_format: Some("srt".to_string()),
                subtitle_mode: Some("burned".to_string()),
                subtitle_style_id: Some("clean-default".to_string()),
                subtitle_segments: Some(vec![AutoCutSpeechTranscriptionSegment {
                    start_ms: 0,
                    end_ms: 250,
                    text: "burn this subtitle".to_string(),
                    speaker: None,
                }]),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("slice video with burned subtitle mode");

        assert_eq!(slice_result.slices.len(), 1);
        assert!(
            slice_result.slices[0].byte_size > 0,
            "burned subtitle slice video artifact must be generated"
        );
        assert_eq!(
            slice_result.slices[0].subtitle_artifact_path, None,
            "burned-only subtitle mode must not create an SRT sidecar"
        );

        let subtitle_artifact_count = connection
            .query_row(
                "SELECT COUNT(*) FROM media_artifact WHERE task_uuid = ?1 AND artifact_type = ?2",
                params![
                    slice_result.task_uuid.as_str(),
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_SUBTITLE,
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query burned-only subtitle media artifact rows");
        assert_eq!(subtitle_artifact_count, 0);
    }

    #[test]
    fn video_slice_skips_clips_that_start_after_source_duration() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-short-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-short-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create short source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import short source video");

        let slice_result = slice_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                clips: vec![
                    smart_slice_test_clip(0, 200, "Valid"),
                    smart_slice_test_clip(10_000, 200, "OutOfRange"),
                ],
                output_format: "mp4".to_string(),
                output_root_dir: None,
                render_profile: None,
                noise_reduction: false,
                subtitle_format: None,
                subtitle_mode: None,
                subtitle_style_id: None,
                subtitle_segments: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("slice short video while skipping out-of-range clips");

        assert_eq!(slice_result.slices.len(), 1);
        assert_eq!(slice_result.slices[0].label, "Valid");
        let artifact_count = connection
            .query_row(
                "SELECT COUNT(*) FROM media_artifact WHERE task_uuid = ?1 AND artifact_type = ?2",
                params![
                    slice_result.task_uuid.as_str(),
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query short slice artifact rows");
        assert_eq!(artifact_count, 1);
        let thumbnail_count = connection
            .query_row(
                "SELECT COUNT(*) FROM media_artifact WHERE task_uuid = ?1 AND artifact_type = ?2",
                params![
                    slice_result.task_uuid.as_str(),
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query short slice thumbnail artifact rows");
        assert_eq!(thumbnail_count, 1);
    }

    #[test]
    fn video_slice_fails_when_all_clips_are_outside_source_duration() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-empty-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-empty-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create short source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import short source video");

        let error = slice_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                clips: vec![smart_slice_test_clip(10_000, 200, "OutOfRange")],
                output_format: "mp4".to_string(),
                output_root_dir: None,
                render_profile: None,
                noise_reduction: false,
                subtitle_format: None,
                subtitle_mode: None,
                subtitle_style_id: None,
                subtitle_segments: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect_err("all out-of-range clips must fail instead of completing an empty slice task");

        assert!(
            error.contains("no clips inside the source media duration"),
            "empty slice failure should explain that no clips are usable: {error}"
        );
        let failed_task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE task_type = ?1 AND status = ?2 AND error_code = 'FFMPEG_VIDEO_SLICE_FAILED'",
                params![OPS_TASK_TYPE_VIDEO_SLICE, OPS_STATUS_FAILED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query failed empty slice task row");
        assert_eq!(failed_task_count, 1);
        let slice_artifact_count = connection
            .query_row(
                "SELECT COUNT(*) FROM media_artifact WHERE artifact_type IN (?1, ?2)",
                params![
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE,
                    MEDIA_ARTIFACT_TYPE_VIDEO_SLICE_THUMBNAIL
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query empty slice artifact rows");
        assert_eq!(slice_artifact_count, 0);
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_segment_timeline() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "transcription": [
                { "offsets": { "from": 0, "to": 1250 }, "text": " ignored object offsets " },
                { "offsets": [0, 1250], "text": "hello" },
                { "start": 1.5, "end": 3.25, "speaker": "Speaker 2", "text": "world" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON");

        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].start_ms, 0);
        assert_eq!(segments[0].end_ms, 1250);
        assert_eq!(segments[0].text, "ignored object offsets");
        assert_eq!(segments[1].start_ms, 0);
        assert_eq!(segments[1].end_ms, 1250);
        assert_eq!(segments[1].text, "hello");
        assert_eq!(segments[2].start_ms, 1500);
        assert_eq!(segments[2].end_ms, 3250);
        assert_eq!(segments[2].speaker.as_deref(), Some("Speaker 2"));
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_timestamp_objects() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                { "timestamps": { "from": "00:00:02.500", "to": "00:00:05.250" }, "text": " intro " },
                { "start": "00:01:00.000", "end": "00:01:04.500", "text": "chapter" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON with timestamp objects");

        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_ms, 2500);
        assert_eq!(segments[0].end_ms, 5250);
        assert_eq!(segments[0].text, "intro");
        assert_eq!(segments[1].start_ms, 60000);
        assert_eq!(segments[1].end_ms, 64500);
        assert_eq!(segments[1].text, "chapter");
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_comma_fraction_timestamps() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                { "timestamps": { "from": "00:00:02,500", "to": "00:00:05,250" }, "text": "comma timestamp" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON with comma timestamp fractions");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 2500);
        assert_eq!(segments[0].end_ms, 5250);
        assert_eq!(segments[0].text, "comma timestamp");
    }

    #[test]
    fn parse_whisper_transcript_json_treats_direct_start_end_numbers_as_seconds() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                { "start": 5, "end": 12, "text": "integer second segment" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON direct second timestamps");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 5000);
        assert_eq!(segments[0].end_ms, 12000);
    }

    #[test]
    fn parse_whisper_transcript_json_treats_timestamp_object_numbers_as_seconds() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                { "timestamps": { "from": 2, "to": 7.5 }, "text": "numeric timestamp segment" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON numeric timestamp objects");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 2000);
        assert_eq!(segments[0].end_ms, 7500);
    }

    #[test]
    fn parse_whisper_transcript_json_sorts_segments_by_start_time() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                { "start": 8, "end": 10, "text": "second" },
                { "start": 1, "end": 3, "text": "first" },
                { "start": 4, "end": 6, "text": "middle" }
              ]
            }
            "#,
        )
        .expect("parse out-of-order whisper transcript JSON");

        assert_eq!(
            segments
                .iter()
                .map(|segment| segment.text.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "middle", "second"]
        );
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_explicit_millisecond_fields() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                { "start_ms": 1250, "end_ms": 3500, "text": "millisecond fields" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON with explicit millisecond fields");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 1250);
        assert_eq!(segments[0].end_ms, 3500);
        assert_eq!(segments[0].text, "millisecond fields");
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_nested_result_segments() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "result": {
                "segments": [
                  { "start": 1, "end": 2.5, "text": "nested result" }
                ]
              }
            }
            "#,
        )
        .expect("parse whisper transcript JSON with nested result segments");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 1000);
        assert_eq!(segments[0].end_ms, 2500);
        assert_eq!(segments[0].text, "nested result");
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_chunk_timestamp_arrays() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "chunks": [
                { "timestamp": [1.0, 2.5], "text": " chunk one " },
                { "timestamp": [2.5, 4.0], "text": "chunk two" }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON with chunk timestamp arrays");

        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_ms, 1000);
        assert_eq!(segments[0].end_ms, 2500);
        assert_eq!(segments[0].text, "chunk one");
        assert_eq!(segments[1].start_ms, 2500);
        assert_eq!(segments[1].end_ms, 4000);
        assert_eq!(segments[1].text, "chunk two");
    }

    #[test]
    fn parse_whisper_transcript_json_accepts_nested_result_chunks() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "result": {
                "chunks": [
                  { "timestamp": [0.25, 1.75], "text": "nested chunk" }
                ]
              }
            }
            "#,
        )
        .expect("parse whisper transcript JSON with nested result chunks");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 250);
        assert_eq!(segments[0].end_ms, 1750);
        assert_eq!(segments[0].text, "nested chunk");
    }

    #[test]
    fn parse_whisper_transcript_json_rejects_oversized_payloads_before_deserialization() {
        let oversized_source = format!(
            "{{\"segments\":[{{\"start\":0,\"end\":1,\"text\":\"{}\"}}]}}",
            "x".repeat(MAX_SPEECH_TRANSCRIPT_JSON_BYTES + 1),
        );
        let error = parse_whisper_transcript_json(&oversized_source)
            .expect_err("oversized transcript JSON must fail before deserialization");

        assert!(
            error.contains("too large"),
            "oversized transcript JSON error should explain the size limit: {error}"
        );
    }

    #[test]
    fn parse_whisper_transcript_json_rejects_excessive_segment_counts() {
        let segments_json = (0..=MAX_SPEECH_TRANSCRIPT_SEGMENTS)
            .map(|index| {
                format!(
                    "{{\"start\":{index},\"end\":{},\"text\":\"segment {index}\"}}",
                    index + 1
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let source = format!("{{\"segments\":[{segments_json}]}}");
        let error = parse_whisper_transcript_json(&source)
            .expect_err("excessive transcript segment counts must fail closed");

        assert!(
            error.contains("too many"),
            "excessive segment count error should explain the segment limit: {error}"
        );
    }

    #[test]
    fn read_whisper_transcript_json_file_rejects_oversized_files_before_loading() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-oversized-speech-json");
        fs::create_dir_all(&transcript_dir).expect("create oversized transcript fixture directory");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        fs::write(
            &transcript_path,
            format!(
                "{{\"segments\":[{{\"start\":0,\"end\":1,\"text\":\"{}\"}}]}}",
                "x".repeat(MAX_SPEECH_TRANSCRIPT_JSON_BYTES + 1),
            ),
        )
        .expect("write oversized transcript fixture");

        let error = read_whisper_transcript_json_file(&transcript_path)
            .expect_err("oversized transcript files must fail before read_to_string");

        assert!(
            error.contains("too large"),
            "oversized transcript file error should explain the size limit: {error}"
        );
    }

    #[test]
    fn speech_transcription_language_rejects_unsafe_tokens_instead_of_sanitizing() {
        let error = normalize_speech_transcription_language(Some("zh; rm -rf"))
            .expect_err("unsafe language tokens must fail closed instead of being sanitized");

        assert!(
            error.contains("language"),
            "language validation error should explain the invalid speech transcription language: {error}"
        );
    }

    #[test]
    fn speech_transcription_language_normalizes_bcp47_underscore_tags() {
        let language = normalize_speech_transcription_language(Some(" ja_jp "))
            .expect("common BCP-47 underscore language tags should normalize");

        assert_eq!(language, "ja-JP");
    }

    #[test]
    fn speech_transcription_requires_local_toolchain_without_fake_transcript() {
        let root = unique_temp_dir("sdkwork-autocut-speech-missing-toolchain-root");
        let source_root = unique_temp_dir("sdkwork-autocut-speech-missing-toolchain-source");
        let source_path = source_root.join("clip.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source audio fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source audio");
        let missing_speech_toolchain = AutoCutSpeechToolchain {
            executable: String::new(),
            model_path: String::new(),
            source_kind: "env".to_string(),
            executable_ready: false,
            model_ready: false,
            ready: false,
            diagnostics: vec![
                "AutoCut local speech transcription executablePath is not configured".to_string(),
            ],
            default_executable_directory: String::new(),
            default_executable_path: String::new(),
            default_model_directory: String::new(),
            default_model_path: String::new(),
            executable_strategy: String::new(),
        };

        let error = transcribe_autocut_media_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutSpeechTranscriptionRequest {
                asset_uuid: import_result.asset_uuid,
                provider_id: Some("local-whisper-cli".to_string()),
                language: Some("zh".to_string()),
                output_root_dir: None,
                executable_path: None,
                model_path: None,
                workflow_purpose: None,
            },
            &test_system_ffmpeg_toolchain(),
            &missing_speech_toolchain,
        )
        .expect_err("missing local speech toolchain must fail closed");

        assert!(
            error.contains("executablePath"),
            "missing toolchain error should explain the required local speech transcription executable path"
        );
        let failed_task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE task_type = ?1 AND status = ?2 AND error_code = 'LOCAL_SPEECH_TRANSCRIPTION_FAILED'",
                params![OPS_TASK_TYPE_SPEECH_TRANSCRIPTION, OPS_STATUS_FAILED],
                |row| row.get::<_, i64>(0),
            )
            .expect("query failed speech transcription task");
        assert_eq!(failed_task_count, 1);
        let transcript_artifact_count = connection
            .query_row(
                "SELECT COUNT(*) FROM media_artifact WHERE artifact_type = ?1",
                params![MEDIA_ARTIFACT_TYPE_TRANSCRIPT],
                |row| row.get::<_, i64>(0),
            )
            .expect("query transcript media artifact rows");
        assert_eq!(transcript_artifact_count, 0);
    }

    #[test]
    fn speech_toolchain_explicit_settings_override_env_fallback() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-settings-model");
        let executable_path = model_root.join("whisper-cli.exe");
        let model_path = model_root.join("ggml-large-v3-turbo.bin");
        fs::write(&executable_path, b"tool").expect("write speech executable fixture");
        write_minimal_valid_speech_model(&model_path);

        let toolchain = resolve_autocut_speech_toolchain_for_request(
            Some(executable_path.to_str().expect("executable path")),
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            None,
            None,
        );

        assert_eq!(toolchain.executable, executable_path.display().to_string());
        assert_eq!(toolchain.model_path, model_path.display().to_string());
        assert_eq!(toolchain.source_kind, "settings");
        assert!(
            toolchain.ready,
            "explicit settings should be accepted without reading environment variables"
        );
    }

    #[test]
    fn speech_toolchain_resolver_uses_bundled_whisper_sidecar_when_executable_is_not_configured() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-bundled-sidecar");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        let sidecar_path = manifest_root.join("whisper-cli.exe");
        let sidecar_bytes = b"whisper cli sidecar fixture";
        fs::write(&sidecar_path, sidecar_bytes).expect("write bundled speech sidecar fixture");
        let sidecar_sha256 = sha256_hex(sidecar_bytes);
        fs::write(
            &manifest_path,
            format!(
                r#"{{
                  "tool": "whisper-cli",
                  "contractVersion": "2026-05-08.speech-toolchain.v1",
                  "bundledReady": true,
                  "requiredBinary": "whisper-cli",
                  "license": {{
                    "name": "whisper.cpp",
                    "spdxExpression": "MIT",
                    "notice": "Test manifest only."
                  }},
                  "platforms": {{
                    "windows-x86_64": {{
                      "relativePath": "whisper-cli.exe",
                      "binaryName": "whisper-cli.exe",
                      "integrity": {{
                        "sha256": "{sidecar_sha256}",
                        "byteSize": {}
                      }}
                    }}
                  }}
                }}"#,
                sidecar_bytes.len()
            ),
        )
        .expect("write speech toolchain manifest");
        let model_path = manifest_root.join("ggml-large-v3-turbo.bin");
        write_minimal_valid_speech_model(&model_path);

        let toolchain = resolve_autocut_speech_toolchain_from_candidate_manifests(
            None,
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            &[manifest_path],
            None,
            None,
            None,
            "windows",
            "x86_64",
            None,
            None,
            &[],
        );

        assert_eq!(toolchain.executable, sidecar_path.display().to_string());
        assert_eq!(toolchain.model_path, model_path.display().to_string());
        assert_eq!(toolchain.source_kind, "bundled-sidecar");
        assert_eq!(
            toolchain.default_executable_path,
            sidecar_path.display().to_string()
        );
        assert!(
            toolchain.ready,
            "bundled whisper-cli sidecar plus configured model should be execution ready: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn speech_toolchain_resolver_accepts_verified_platform_sidecar_without_global_manifest_readiness()
     {
        let manifest_root =
            unique_temp_dir("sdkwork-autocut-speech-platform-bundled-sidecar");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        let windows_sidecar_path = manifest_root.join("windows-x86_64").join("whisper-cli.exe");
        fs::create_dir_all(windows_sidecar_path.parent().expect("sidecar parent"))
            .expect("create speech sidecar dir");
        let sidecar_bytes = b"windows whisper cli sidecar fixture";
        fs::write(&windows_sidecar_path, sidecar_bytes)
            .expect("write bundled speech sidecar fixture");
        let sidecar_sha256 = sha256_hex(sidecar_bytes);
        fs::write(
            &manifest_path,
            format!(
                r#"{{
                  "tool": "whisper-cli",
                  "contractVersion": "2026-05-08.speech-toolchain.v1",
                  "bundledReady": false,
                  "requiredBinary": "whisper-cli",
                  "license": {{
                    "name": "whisper.cpp",
                    "spdxExpression": "MIT",
                    "notice": "Test manifest only."
                  }},
                  "platforms": {{
                    "windows-x86_64": {{
                      "relativePath": "windows-x86_64/whisper-cli.exe",
                      "binaryName": "whisper-cli.exe",
                      "integrity": {{
                        "sha256": "{sidecar_sha256}",
                        "byteSize": {}
                      }}
                    }},
                    "linux-x86_64": {{
                      "relativePath": "linux-x86_64/whisper-cli",
                      "binaryName": "whisper-cli",
                      "integrity": {{
                        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                        "byteSize": 0
                      }}
                    }}
                  }}
                }}"#,
                sidecar_bytes.len()
            ),
        )
        .expect("write speech toolchain manifest");
        let model_path = manifest_root.join("ggml-large-v3-turbo.bin");
        write_minimal_valid_speech_model(&model_path);

        let toolchain = resolve_autocut_speech_toolchain_from_candidate_manifests(
            None,
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            &[manifest_path],
            None,
            None,
            None,
            "windows",
            "x86_64",
            None,
            None,
            &[],
        );

        assert_eq!(
            toolchain.executable,
            windows_sidecar_path.display().to_string()
        );
        assert_eq!(toolchain.source_kind, "bundled-sidecar");
        assert!(
            toolchain.ready,
            "verified current-platform sidecar should be execution ready even before all platform sidecars are bundled: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn speech_toolchain_resolver_rejects_missing_bundled_companion_files() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-missing-companion");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        let windows_sidecar_path = manifest_root.join("windows-x86_64").join("whisper-cli.exe");
        fs::create_dir_all(windows_sidecar_path.parent().expect("sidecar parent"))
            .expect("create speech sidecar dir");
        let sidecar_bytes = b"windows whisper cli sidecar fixture";
        fs::write(&windows_sidecar_path, sidecar_bytes)
            .expect("write bundled speech sidecar fixture");
        let sidecar_sha256 = sha256_hex(sidecar_bytes);
        fs::write(
            &manifest_path,
            format!(
                r#"{{
                  "tool": "whisper-cli",
                  "contractVersion": "2026-05-08.speech-toolchain.v1",
                  "bundledReady": false,
                  "requiredBinary": "whisper-cli",
                  "license": {{
                    "name": "whisper.cpp",
                    "spdxExpression": "MIT",
                    "notice": "Test manifest only."
                  }},
                  "platforms": {{
                    "windows-x86_64": {{
                      "relativePath": "windows-x86_64/whisper-cli.exe",
                      "binaryName": "whisper-cli.exe",
                      "integrity": {{
                        "sha256": "{sidecar_sha256}",
                        "byteSize": {}
                      }},
                      "companionFiles": [
                        {{
                          "relativePath": "windows-x86_64/whisper.dll",
                          "integrity": {{
                            "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                            "byteSize": 12
                          }}
                        }}
                      ]
                    }}
                  }}
                }}"#,
                sidecar_bytes.len()
            ),
        )
        .expect("write speech toolchain manifest");

        let error = resolve_autocut_bundled_speech_executable_from_manifest(
            &manifest_path,
            "windows",
            "x86_64",
        )
        .expect_err("bundled speech sidecar must reject missing companion DLLs");

        assert!(
            error.contains("companion"),
            "missing companion diagnostics should explain the runtime dependency: {error}"
        );
    }

    #[test]
    fn speech_toolchain_resolver_discovers_whisper_cli_from_system_path_when_not_configured() {
        let path_root = unique_temp_dir("sdkwork-autocut-speech-system-path");
        let executable_path = path_root.join("whisper-cli.exe");
        fs::write(&executable_path, b"tool").expect("write PATH speech executable fixture");
        let model_path = path_root.join("ggml-large-v3-turbo.bin");
        write_minimal_valid_speech_model(&model_path);

        let toolchain = resolve_autocut_speech_toolchain_from_candidate_manifests(
            None,
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            &[],
            None,
            None,
            None,
            "windows",
            "x86_64",
            None,
            Some(path_root.to_str().expect("PATH root")),
            &[],
        );

        assert_eq!(toolchain.executable, executable_path.display().to_string());
        assert_eq!(toolchain.source_kind, "system-path");
        assert!(
            toolchain.ready,
            "system PATH whisper-cli plus configured model should be execution ready: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn speech_toolchain_resolver_discovers_whisper_cli_from_unix_common_candidates_when_not_configured()
     {
        let path_root = unique_temp_dir("sdkwork-autocut-speech-unix-common-candidates");
        let executable_path = path_root.join("whisper-cli");
        fs::write(&executable_path, b"tool").expect("write PATH speech executable fixture");
        let model_path = path_root.join("ggml-large-v3-turbo.bin");
        write_minimal_valid_speech_model(&model_path);

        for os in ["linux", "macos"] {
            let toolchain = resolve_autocut_speech_toolchain_from_candidate_manifests(
                None,
                Some(model_path.to_str().expect("model path")),
                Some("settings"),
                &[],
                None,
                None,
                None,
                os,
                "x86_64",
                None,
                None,
                &[executable_path.clone()],
            );

            assert_eq!(toolchain.executable, executable_path.display().to_string());
            assert_eq!(toolchain.source_kind, "system-path");
            assert!(
                toolchain.ready,
                "{os} PATH whisper-cli plus configured model should be execution ready: {:?}",
                toolchain.diagnostics
            );
        }
    }

    #[test]
    fn speech_toolchain_system_path_split_preserves_windows_drive_letters() {
        let paths = split_autocut_system_path_directories(
            Some(r"C:\tools\whisper;D:\portable\whisper"),
            "windows",
        );

        assert_eq!(paths[0], PathBuf::from(r"C:\tools\whisper"));
        assert_eq!(paths[1], PathBuf::from(r"D:\portable\whisper"));
    }

    #[test]
    fn speech_toolchain_resolver_uses_existing_default_model_path_when_model_is_not_configured() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-default-model");
        let executable_path = model_root.join("whisper-cli.exe");
        fs::write(&executable_path, b"tool").expect("write speech executable fixture");
        let default_model_path = model_root.join("ggml-large-v3-turbo-q5_0.bin");
        write_minimal_valid_speech_model(&default_model_path);

        let toolchain = resolve_autocut_speech_toolchain_from_candidate_manifests(
            Some(executable_path.to_str().expect("executable path")),
            None,
            Some("settings"),
            &[],
            None,
            None,
            None,
            "windows",
            "x86_64",
            Some(default_model_path.as_path()),
            None,
            &[],
        );

        assert_eq!(toolchain.model_path, default_model_path.display().to_string());
        assert_eq!(toolchain.default_model_path, default_model_path.display().to_string());
        assert!(toolchain.model_ready);
        assert!(
            toolchain.ready,
            "existing default model path should be accepted without a saved modelPath: {:?}",
            toolchain.diagnostics
        );
    }

    #[test]
    fn speech_toolchain_resolver_reports_default_bundled_whisper_target_without_fake_readiness() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-default-sidecar-target");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        fs::write(
            &manifest_path,
            r#"{
              "tool": "whisper-cli",
              "contractVersion": "2026-05-08.speech-toolchain.v1",
              "bundledReady": false,
              "requiredBinary": "whisper-cli",
              "license": {
                "name": "whisper.cpp",
                "spdxExpression": "MIT",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "windows-x86_64/whisper-cli.exe",
                  "binaryName": "whisper-cli.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                },
                "linux-x86_64": {
                  "relativePath": "linux-x86_64/whisper-cli",
                  "binaryName": "whisper-cli",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                },
                "macos-x86_64": {
                  "relativePath": "macos-x86_64/whisper-cli",
                  "binaryName": "whisper-cli",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                },
                "macos-aarch64": {
                  "relativePath": "macos-aarch64/whisper-cli",
                  "binaryName": "whisper-cli",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write speech sidecar target manifest");

        for (os, arch, relative_path) in [
            ("windows", "x86_64", "windows-x86_64/whisper-cli.exe"),
            ("win32", "x64", "windows-x86_64/whisper-cli.exe"),
            ("linux", "x86_64", "linux-x86_64/whisper-cli"),
            ("linux", "x64", "linux-x86_64/whisper-cli"),
            ("macos", "x86_64", "macos-x86_64/whisper-cli"),
            ("darwin", "x64", "macos-x86_64/whisper-cli"),
            ("macos", "aarch64", "macos-aarch64/whisper-cli"),
            ("darwin", "arm64", "macos-aarch64/whisper-cli"),
        ] {
            let toolchain = resolve_autocut_speech_toolchain_from_candidate_manifests(
                None,
                None,
                None,
                &[manifest_path.clone()],
                None,
                None,
                None,
                os,
                arch,
                None,
                None,
                &[],
            );

            let expected_path = relative_path
                .split('/')
                .fold(manifest_root.clone(), |path, segment| path.join(segment));
            assert_eq!(
                toolchain.default_executable_path,
                expected_path.display().to_string()
            );
            assert_eq!(toolchain.executable, "");
            assert!(!toolchain.executable_ready);
            assert!(!toolchain.ready);
        }
    }

    #[test]
    fn speech_bundled_sidecar_does_not_accept_unverified_existing_target() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-existing-unverified");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        let sidecar_path = manifest_root
            .join("windows-x86_64")
            .join("whisper-cli.exe");
        fs::create_dir_all(sidecar_path.parent().expect("sidecar parent"))
            .expect("create speech sidecar directory");
        fs::write(&sidecar_path, b"unverified placeholder executable")
            .expect("write existing unverified speech executable");
        fs::write(
            &manifest_path,
            r#"{
              "tool": "whisper-cli",
              "contractVersion": "2026-05-08.speech-toolchain.v1",
              "bundledReady": false,
              "requiredBinary": "whisper-cli",
              "license": {
                "name": "whisper.cpp",
                "spdxExpression": "MIT",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "windows-x86_64/whisper-cli.exe",
                  "binaryName": "whisper-cli.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write placeholder speech executable manifest");

        let error = resolve_autocut_bundled_speech_executable_from_manifest(
            &manifest_path,
            "windows",
            "x86_64",
        )
        .expect_err("placeholder speech sidecar must not verify as bundled ready");

        assert!(
            error.contains("byteSize mismatch") ||
                error.contains("checksum mismatch") ||
                error.contains("placeholder integrity"),
            "placeholder manifest integrity must not mark a packaged sidecar executable as verified: {error}"
        );
    }

    #[test]
    fn speech_toolchain_manifest_rejects_placeholder_integrity_when_bundled_ready() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-placeholder-integrity");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        let sidecar_path = manifest_root.join("whisper-cli.exe");
        fs::write(&sidecar_path, b"placeholder speech sidecar")
            .expect("write placeholder speech sidecar fixture");
        fs::write(
            &manifest_path,
            r#"{
              "tool": "whisper-cli",
              "contractVersion": "2026-05-08.speech-toolchain.v1",
              "bundledReady": true,
              "requiredBinary": "whisper-cli",
              "license": {
                "name": "whisper.cpp",
                "spdxExpression": "MIT",
                "notice": "Test manifest only."
              },
              "platforms": {
                "windows-x86_64": {
                  "relativePath": "whisper-cli.exe",
                  "binaryName": "whisper-cli.exe",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write placeholder speech toolchain manifest");

        let error = resolve_autocut_bundled_speech_executable_from_manifest(
            &manifest_path,
            "windows",
            "x86_64",
        )
        .expect_err("placeholder bundled speech manifests must be rejected");

        assert!(
            error.contains("placeholder integrity"),
            "placeholder manifest error should explain the integrity contract: {error}"
        );
    }

    #[test]
    fn speech_toolchain_rejects_relative_model_paths() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-relative-model");
        let executable_path = model_root.join("whisper-cli.exe");
        fs::write(&executable_path, b"tool").expect("write speech executable fixture");

        let toolchain = resolve_autocut_speech_toolchain_for_request(
            Some(executable_path.to_str().expect("executable path")),
            Some("models/ggml-large-v3-turbo.bin"),
            Some("settings"),
            None,
            None,
        );

        assert!(!toolchain.ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("absolute local model file path")),
            "relative modelPath diagnostics should explain the absolute local model file path contract"
        );
    }

    #[test]
    fn speech_toolchain_rejects_relative_executable_paths() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-relative-executable");
        let model_path = model_root.join("ggml-large-v3-turbo.bin");
        write_minimal_valid_speech_model(&model_path);

        let toolchain = resolve_autocut_speech_toolchain_for_request(
            Some("tools/whisper-cli.exe"),
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            None,
            None,
        );

        assert!(!toolchain.ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("absolute local executable file path")),
            "relative executablePath diagnostics should explain the absolute local executable file path contract"
        );
    }

    #[test]
    fn speech_toolchain_rejects_unsupported_model_extensions() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-unsupported-model");
        let executable_path = model_root.join("whisper-cli.exe");
        let model_path = model_root.join("ggml-large-v3-turbo.txt");
        fs::write(&executable_path, b"tool").expect("write speech executable fixture");
        fs::write(&model_path, b"model").expect("write unsupported model fixture");

        let toolchain = resolve_autocut_speech_toolchain_for_request(
            Some(executable_path.to_str().expect("executable path")),
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            None,
            None,
        );

        assert!(!toolchain.ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("supported model file extension")),
            "unsupported model extension diagnostics should list the supported model file extension contract"
        );
    }

    #[test]
    fn speech_toolchain_rejects_partial_download_model_files() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-partial-download-model");
        let executable_path = model_root.join("whisper-cli.exe");
        let model_path = model_root.join("ggml-large-v3-turbo.bin.download");
        fs::write(&executable_path, b"tool").expect("write speech executable fixture");
        fs::write(&model_path, b"partial").expect("write partial model fixture");

        let toolchain = resolve_autocut_speech_toolchain_for_request(
            Some(executable_path.to_str().expect("executable path")),
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            None,
            None,
        );

        assert!(!toolchain.ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("partial .download file")),
            "partial model diagnostics should explain that .download files must not be selected"
        );
    }

    #[test]
    fn speech_toolchain_rejects_too_small_model_files() {
        let model_root = unique_temp_dir("sdkwork-autocut-speech-small-model");
        let executable_path = model_root.join("whisper-cli.exe");
        let model_path = model_root.join("ggml-large-v3-turbo.bin");
        fs::write(&executable_path, b"tool").expect("write speech executable fixture");
        fs::write(&model_path, b"incomplete").expect("write too-small model fixture");

        let toolchain = resolve_autocut_speech_toolchain_for_request(
            Some(executable_path.to_str().expect("executable path")),
            Some(model_path.to_str().expect("model path")),
            Some("settings"),
            None,
            None,
        );

        assert!(!toolchain.ready);
        assert!(
            toolchain
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("missing or incomplete")),
            "too-small model diagnostics should guide users to download the offline Whisper model again"
        );
    }

    #[test]
    fn speech_model_download_progress_calculates_percent_for_known_total() {
        assert_eq!(
            calculate_autocut_speech_model_download_progress(50, Some(200)),
            25
        );
        assert_eq!(
            calculate_autocut_speech_model_download_progress(250, Some(200)),
            100
        );
    }

    #[test]
    fn speech_model_download_progress_keeps_unknown_total_visible() {
        assert_eq!(
            calculate_autocut_speech_model_download_progress(50, None),
            0
        );
        assert_eq!(
            calculate_autocut_speech_model_download_progress(50, Some(0)),
            0
        );
    }

    #[test]
    fn speech_model_download_request_accepts_vetted_hugging_face_mirror_urls() {
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "whisper-cpp-large-v3-turbo-q5".to_string(),
            file_name: "ggml-large-v3-turbo-q5_0.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            mirror_urls: Some(vec![
                "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            ]),
            sha256: "edb2095566f2da8d5a5e8a14438ccd70a713fe75a3ec5f0899c47d22338755d4".to_string(),
            output_root_dir: None,
        };

        validate_autocut_speech_transcription_model_download_request(&request)
            .expect("vetted Hugging Face mirror should be accepted");
        assert_eq!(
            autocut_speech_transcription_model_download_urls(&request),
            vec![
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
                "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            ],
        );
    }

    #[test]
    fn speech_model_download_request_rejects_untrusted_mirror_urls() {
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "whisper-cpp-large-v3-turbo-q5".to_string(),
            file_name: "ggml-large-v3-turbo-q5_0.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            mirror_urls: Some(vec![
                "https://example.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            ]),
            sha256: "edb2095566f2da8d5a5e8a14438ccd70a713fe75a3ec5f0899c47d22338755d4".to_string(),
            output_root_dir: None,
        };

        let error = validate_autocut_speech_transcription_model_download_request(&request)
            .expect_err("untrusted model mirror URL should be rejected");
        assert!(
            error.contains("trusted HTTPS Hugging Face source"),
            "untrusted mirror error should explain trusted source contract: {error}"
        );
    }

    #[test]
    fn speech_model_download_request_requires_pinned_sha256_digest() {
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "whisper-cpp-large-v3-turbo-q5".to_string(),
            file_name: "ggml-large-v3-turbo-q5_0.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            mirror_urls: None,
            sha256: "not-a-real-digest".to_string(),
            output_root_dir: None,
        };

        let error = validate_autocut_speech_transcription_model_download_request(&request)
            .expect_err("model downloads must pin the model digest");
        assert!(
            error.contains("pinned SHA-256 model digest"),
            "missing digest error should explain pinned model digest contract: {error}"
        );
    }

    #[test]
    fn speech_model_download_replaces_invalid_existing_model_instead_of_skipping() {
        let root = unique_temp_dir("sdkwork-autocut-speech-invalid-existing-model");
        let model_directory = root
            .join(AUTOCUT_MEDIA_MODEL_DIR)
            .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
        fs::create_dir_all(&model_directory).expect("create speech model dir");
        let model_path = model_directory.join("ggml-invalid-existing.bin");
        fs::write(&model_path, b"partial model").expect("write invalid existing model");
        let expected_sha256 = sha256_hex(b"valid replacement model");
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "invalid-existing-model".to_string(),
            file_name: "ggml-invalid-existing.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-invalid-existing.bin".to_string(),
            mirror_urls: None,
            sha256: expected_sha256.clone(),
            output_root_dir: None,
        };

        let existing_result =
            validate_existing_autocut_speech_transcription_model(&model_path, &request)
                .expect("invalid existing model should be removable");

        assert_eq!(existing_result, None);
        assert!(
            !model_path.exists(),
            "invalid existing model should be removed before retrying download"
        );
        fs::write(&model_path, b"valid replacement model").expect("write valid replacement model");
        let valid_result =
            validate_existing_autocut_speech_transcription_model(&model_path, &request)
                .expect("valid replacement model should pass checksum");
        assert_eq!(valid_result, Some(23));
        assert_eq!(expected_sha256, calculate_file_sha256(&model_path).expect("hash replacement"));
    }

    #[test]
    fn speech_transcription_probe_validates_model_path_without_fake_readiness() {
        let probe = probe_autocut_speech_transcription_for_request(AutoCutSpeechTranscriptionProbeRequest {
            provider_id: Some("local-whisper-cli".to_string()),
            executable_path: Some("whisper-cli".to_string()),
            model_path: Some("Z:/missing/ggml-large-v3-turbo.bin".to_string()),
            source_kind: Some("settings".to_string()),
            output_root_dir: None,
        });

        assert!(!probe.ready);
        assert_eq!(probe.source_kind, "settings");
        assert!(
            probe
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("modelPath")),
            "probe diagnostics should explain missing modelPath"
        );
    }

    #[test]
    fn local_media_file_select_types_default_to_audio_and_video() {
        let requested_types: Vec<String> = Vec::new();
        assert_eq!(
            normalize_autocut_media_file_select_types(&requested_types)
                .expect("empty local media selector types should default"),
            vec!["audio".to_string(), "video".to_string()]
        );
    }

    #[test]
    fn local_media_file_select_types_are_normalized_and_deduplicated() {
        assert_eq!(
            normalize_autocut_media_file_select_types(&[
                " Video ".to_string(),
                "audio".to_string(),
                "VIDEO".to_string(),
            ])
            .expect("local media selector types should normalize"),
            vec!["video".to_string(), "audio".to_string()]
        );
    }

    #[test]
    fn local_media_file_select_types_reject_unsupported_media() {
        let error = normalize_autocut_media_file_select_types(&["image".to_string()])
            .expect_err("unsupported local media selector types must be rejected");
        assert!(
            error.contains("audio or video"),
            "unsupported selector media type error should explain the allowed media types"
        );
    }

    #[test]
    fn local_media_file_dialog_video_extensions_match_media_classification() {
        for extension in SUPPORTED_VIDEO_FILE_DIALOG_EXTENSIONS {
            assert_eq!(
                classify_media_type(extension),
                "video",
                "video chooser extension {extension} must be classified as video"
            );
            assert!(
                media_mime_type(extension, "video").starts_with("video/"),
                "video chooser extension {extension} must expose a video MIME type"
            );
        }
    }

    #[test]
    fn local_media_file_dialog_audio_extensions_match_media_classification() {
        for extension in SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS {
            assert_eq!(
                classify_media_type(extension),
                "audio",
                "audio chooser extension {extension} must be classified as audio"
            );
            assert!(
                media_mime_type(extension, "audio").starts_with("audio/"),
                "audio chooser extension {extension} must expose an audio MIME type"
            );
        }
    }

    #[test]
    fn video_compression_from_asset_registers_video_artifact_task_and_stage_rows() {
        let root = unique_temp_dir("sdkwork-autocut-video-compress-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-compress-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let compress_result = compress_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoCompressRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                compression_mode: "balanced".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("compress video from imported asset");

        assert_eq!(compress_result.source_asset_uuid, import_result.asset_uuid);
        assert_ops_task_input_has_source_name(
            &connection,
            &compress_result.task_uuid,
            &import_result.asset_uuid,
            &import_result.name,
        );
        assert_eq!(compress_result.format, "mp4");
        assert_eq!(compress_result.original_byte_size, import_result.byte_size);
        assert!(
            compress_result.byte_size > 0,
            "compressed video artifact must be non-empty"
        );
        assert!(
            Path::new(&compress_result.artifact_path).starts_with(
                root.join(AUTOCUT_MEDIA_TASK_DIR)
                    .join(&compress_result.task_uuid)
                    .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
                    .canonicalize()
                    .expect("canonical compression task output directory")
            ),
            "compressed video artifact must stay inside its task output directory"
        );

        let (artifact_count, mime_type, artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE uuid = ?1 AND task_uuid = ?2 AND source_asset_uuid = ?3",
                [
                    compress_result.artifact_uuid.as_str(),
                    compress_result.task_uuid.as_str(),
                    compress_result.source_asset_uuid.as_str(),
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query compressed video media_artifact row");
        assert_eq!(artifact_count, 1);
        assert_eq!(mime_type, "video/mp4");
        assert_eq!(artifact_type, MEDIA_ARTIFACT_TYPE_VIDEO_COMPRESSED);

        let task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE uuid = ?1 AND task_type = ?2 AND source_asset_uuid = ?3 AND status = 2 AND progress = 100",
                params![
                    compress_result.task_uuid.as_str(),
                    OPS_TASK_TYPE_VIDEO_COMPRESS,
                    compress_result.source_asset_uuid.as_str(),
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query compressed video ops_task row");
        assert_eq!(task_count, 1);

        let stage_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_stage_run WHERE task_uuid = ?1 AND stage_type = ?2 AND status = 2",
                params![
                    compress_result.task_uuid.as_str(),
                    OPS_STAGE_TYPE_VIDEO_COMPRESS
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query compressed video ops_stage_run row");
        assert_eq!(stage_count, 1);
    }

    #[test]
    fn video_conversion_from_asset_registers_video_artifact_task_and_stage_rows() {
        let root = unique_temp_dir("sdkwork-autocut-video-convert-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-convert-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let convert_result = convert_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoConvertRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                target_format: "webm".to_string(),
                video_codec: "vp9".to_string(),
                audio_codec: "opus".to_string(),
                resolution: "480p".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("convert video from imported asset");

        assert_eq!(convert_result.source_asset_uuid, import_result.asset_uuid);
        assert_ops_task_input_has_source_name(
            &connection,
            &convert_result.task_uuid,
            &import_result.asset_uuid,
            &import_result.name,
        );
        assert_eq!(convert_result.format, "webm");
        assert!(
            convert_result.byte_size > 0,
            "converted video artifact must be non-empty"
        );
        assert!(
            Path::new(&convert_result.artifact_path).starts_with(
                root.join(AUTOCUT_MEDIA_TASK_DIR)
                    .join(&convert_result.task_uuid)
                    .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
                    .canonicalize()
                    .expect("canonical conversion task output directory")
            ),
            "converted video artifact must stay inside its task output directory"
        );

        let (artifact_count, mime_type, artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE uuid = ?1 AND task_uuid = ?2 AND source_asset_uuid = ?3",
                [
                    convert_result.artifact_uuid.as_str(),
                    convert_result.task_uuid.as_str(),
                    convert_result.source_asset_uuid.as_str(),
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query converted video media_artifact row");
        assert_eq!(artifact_count, 1);
        assert_eq!(mime_type, "video/webm");
        assert_eq!(artifact_type, MEDIA_ARTIFACT_TYPE_VIDEO_CONVERTED);

        let task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE uuid = ?1 AND task_type = ?2 AND source_asset_uuid = ?3 AND status = 2 AND progress = 100",
                params![
                    convert_result.task_uuid.as_str(),
                    OPS_TASK_TYPE_VIDEO_CONVERT,
                    convert_result.source_asset_uuid.as_str(),
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query converted video ops_task row");
        assert_eq!(task_count, 1);

        let stage_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_stage_run WHERE task_uuid = ?1 AND stage_type = ?2 AND status = 2",
                params![convert_result.task_uuid.as_str(), OPS_STAGE_TYPE_VIDEO_CONVERT],
                |row| row.get::<_, i64>(0),
            )
            .expect("query converted video ops_stage_run row");
        assert_eq!(stage_count, 1);
    }

    #[test]
    fn video_enhancement_from_asset_registers_video_artifact_task_and_stage_rows() {
        let root = unique_temp_dir("sdkwork-autocut-video-enhance-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-enhance-source");
        let source_path = source_root.join("clip.avi");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &source_path)
            .expect("create source video fixture");
        let connection = prepared_connection();
        let import_result = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import source video");

        let enhance_result = enhance_autocut_video_from_asset_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVideoEnhanceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                target_resolution: "720p".to_string(),
                enhance_mode: "real".to_string(),
                frame_rate: "24".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("enhance video from imported asset");

        assert_eq!(enhance_result.source_asset_uuid, import_result.asset_uuid);
        assert_ops_task_input_has_source_name(
            &connection,
            &enhance_result.task_uuid,
            &import_result.asset_uuid,
            &import_result.name,
        );
        assert_eq!(enhance_result.format, "mp4");
        assert!(
            enhance_result.byte_size > 0,
            "enhanced video artifact must be non-empty"
        );
        assert!(
            Path::new(&enhance_result.artifact_path).starts_with(
                root.join(AUTOCUT_MEDIA_TASK_DIR)
                    .join(&enhance_result.task_uuid)
                    .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
                    .canonicalize()
                    .expect("canonical enhancement task output directory")
            ),
            "enhanced video artifact must stay inside its task output directory"
        );

        let (artifact_count, mime_type, artifact_type) = connection
            .query_row(
                "SELECT COUNT(*), MAX(mime_type), MAX(artifact_type) FROM media_artifact WHERE uuid = ?1 AND task_uuid = ?2 AND source_asset_uuid = ?3",
                [
                    enhance_result.artifact_uuid.as_str(),
                    enhance_result.task_uuid.as_str(),
                    enhance_result.source_asset_uuid.as_str(),
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query enhanced video media_artifact row");
        assert_eq!(artifact_count, 1);
        assert_eq!(mime_type, "video/mp4");
        assert_eq!(artifact_type, MEDIA_ARTIFACT_TYPE_VIDEO_ENHANCED);

        let task_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_task WHERE uuid = ?1 AND task_type = ?2 AND source_asset_uuid = ?3 AND status = 2 AND progress = 100",
                params![
                    enhance_result.task_uuid.as_str(),
                    OPS_TASK_TYPE_VIDEO_ENHANCE,
                    enhance_result.source_asset_uuid.as_str(),
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("query enhanced video ops_task row");
        assert_eq!(task_count, 1);

        let stage_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_stage_run WHERE task_uuid = ?1 AND stage_type = ?2 AND status = 2",
                params![enhance_result.task_uuid.as_str(), OPS_STAGE_TYPE_VIDEO_ENHANCE],
                |row| row.get::<_, i64>(0),
            )
            .expect("query enhanced video ops_stage_run row");
        assert_eq!(stage_count, 1);
    }

    #[test]
    fn audio_smoke_generates_non_empty_artifact_with_ffmpeg() {
        let root = unique_temp_dir("sdkwork-autocut-audio-smoke");

        let result =
            run_autocut_audio_smoke_in_root_with_toolchain(&root, &test_system_ffmpeg_toolchain())
                .expect("run audio smoke");

        assert!(
            result.byte_size > 0,
            "audio smoke artifact must be non-empty"
        );
        let expected_task_output_dir = root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(&result.task_uuid)
            .join(AUTOCUT_MEDIA_TASK_OUTPUT_DIR)
            .canonicalize()
            .expect("canonical audio smoke task output directory");
        assert!(
            Path::new(&result.artifact_path).starts_with(&expected_task_output_dir),
            "audio smoke artifact must stay inside its task output directory"
        );
        assert_eq!(
            result.task_output_dir,
            expected_task_output_dir.display().to_string()
        );
    }
}
