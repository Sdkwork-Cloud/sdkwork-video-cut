use std::collections::HashMap;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::{StatusCode, Url};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::database_runtime;

const AUTOCUT_MEDIA_ROOT_DIR: &str = "media";
const AUTOCUT_MEDIA_INPUT_DIR: &str = "inputs";
const AUTOCUT_MEDIA_TASK_DIR: &str = "tasks";
const AUTOCUT_MEDIA_TASK_COVER_DIR: &str = "cover";
const AUTOCUT_MEDIA_MODEL_DIR: &str = "models";
const AUTOCUT_MEDIA_SPEECH_MODEL_DIR: &str = "speech";
const AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_MODEL_FILE_NAME: &str = "ggml-large-v3-turbo-q5_0.bin";
pub(crate) const AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS_EVENT: &str =
    "autocut-speech-transcription-model-download-progress";
pub(crate) const AUTOCUT_NATIVE_TASK_PROGRESS_EVENT: &str = "autocut-native-task-progress";
#[cfg(windows)]
const AUTOCUT_WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;
const AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_JSON: &str =
    include_str!("../binaries/ffmpeg.toolchain.json");
const AUTOCUT_FFMPEG_TOOLCHAIN_MANIFEST_FILE_NAME: &str = "ffmpeg.toolchain.json";
const AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_JSON: &str =
    include_str!("../binaries/speech-transcription.toolchain.json");
const AUTOCUT_SPEECH_TOOLCHAIN_MANIFEST_FILE_NAME: &str = "speech-transcription.toolchain.json";
const DEFAULT_FFMPEG_EXECUTABLE: &str = "ffmpeg";

fn new_autocut_hidden_child_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        command.creation_flags(AUTOCUT_WINDOWS_CREATE_NO_WINDOW);
    }
    command
}

const SUPPORTED_VIDEO_FILE_DIALOG_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "flv", "m4v", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp",
    "3g2", "wmv", "asf", "ogv", "vob",
];
const SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "aiff", "aif", "alac", "amr", "oga",
    "spx", "ac3", "eac3", "weba",
];
const AUTOCUT_ALL_FILES_DIALOG_EXTENSIONS: &[&str] = &["*"];
pub(crate) const SUPPORTED_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS: &[&str] =
    &["bin", "gguf", "onnx", "pt", "safetensors"];
const MAX_SPEECH_TRANSCRIPT_JSON_BYTES: usize = 16 * 1024 * 1024;
const MAX_SPEECH_TRANSCRIPT_SEGMENTS: usize = 20_000;
const SPEECH_TRANSCRIPT_QUALITY_GUARD_SCHEMA: &str = "smart-slice.stt-quality-guard.v1";
const MIN_USEFUL_SPEECH_CHUNK_WAV_BYTES: u64 = 4 * 1024;
const AUTOCUT_LONG_SPEECH_TRANSCRIPTION_THRESHOLD_MS: i64 = 8 * 60 * 1000;
const AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_DURATION_MS: i64 = 6 * 60 * 1000;
const AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_OVERLAP_MS: i64 = 2 * 1000;
const AUTOCUT_LONG_SPEECH_TRANSCRIPTION_MIN_TAIL_CHUNK_MS: i64 = 90 * 1000;
pub(crate) const MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const TRUSTED_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_HOSTS: &[&str] =
    &["huggingface.co", "hf-mirror.com"];
const SUPPORTED_AUDIO_FORMATS: &[&str] = &["mp3", "wav", "flac", "aac"];
const SUPPORTED_AUDIO_QUALITIES: &[&str] = &["128", "192", "256", "320"];
const SUPPORTED_AUDIO_CHANNELS: &[&str] = &["mono", "stereo", "smart-stereo"];
const SUPPORTED_VIDEO_GIF_FPS: &[&str] = &["10", "15", "24"];
const SUPPORTED_VIDEO_GIF_RESOLUTIONS: &[(&str, i64)] =
    &[("320p", 320), ("480p", 480), ("720p", 720)];
const SUPPORTED_VIDEO_COMPRESS_MODES: &[&str] = &["quality", "balanced", "extreme"];
const SUPPORTED_VIDEO_CONVERT_FORMATS: &[&str] = &["mp4", "mkv", "avi", "mov", "flv", "webm"];
const SUPPORTED_VIDEO_CONVERT_VIDEO_CODECS: &[&str] = &["h264", "h265", "vp9", "mpeg4", "copy"];
const SUPPORTED_VIDEO_CONVERT_AUDIO_CODECS: &[&str] = &["aac", "mp3", "opus", "copy"];
const AUTOCUT_VISUAL_EVIDENCE_SUPPORTED_PROFILES: &[&str] = &["shot-boundary-v1", "scene-index-v1"];
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
const MEDIA_ARTIFACT_TYPE_VISUAL_EVIDENCE: i64 = 10;
const MEDIA_ARTIFACT_TYPE_AUDIO_FINGERPRINT: i64 = 11;
const OPS_TASK_TYPE_AUDIO_EXTRACTION: i64 = 1;
const OPS_TASK_TYPE_VIDEO_GIF: i64 = 2;
const OPS_TASK_TYPE_VIDEO_COMPRESS: i64 = 3;
const OPS_TASK_TYPE_VIDEO_CONVERT: i64 = 4;
const OPS_TASK_TYPE_VIDEO_ENHANCE: i64 = 5;
const OPS_TASK_TYPE_VIDEO_SLICE: i64 = 6;
const OPS_TASK_TYPE_SPEECH_TRANSCRIPTION: i64 = 7;
const OPS_TASK_TYPE_VISUAL_EVIDENCE: i64 = 8;
const OPS_TASK_TYPE_AUDIO_FINGERPRINT: i64 = 9;
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
const OPS_STAGE_TYPE_VISUAL_EVIDENCE: i64 = 8;
const OPS_STAGE_TYPE_AUDIO_FINGERPRINT: i64 = 9;
const VIDEO_SLICE_CLEAR_DISPLAY_MATRIX_FILTER: &str = "sidedata=mode=delete:type=DISPLAYMATRIX";
const SMART_SLICE_AUDIO_CLEANUP_PROFILE: &str = "smart-slice-speech-denoise-v1";
const SMART_SLICE_AUDIO_ACTIVITY_SILENCE_DETECT_FILTER: &str = "silencedetect=noise=-35dB:d=0.08";
const SMART_SLICE_AUDIO_ACTIVITY_EDGE_TOLERANCE_MS: i64 = 120;
const SMART_SLICE_POSTPROCESS_SILENCE_PAD_MS: i64 = 80;
const SMART_SLICE_POSTPROCESS_MIN_SILENCE_TRIM_MS: i64 = 350;
const SMART_SLICE_POSTPROCESS_MIN_RETAINED_SEGMENT_MS: i64 = 120;
const SMART_SLICE_MAX_SOURCE_SEGMENTS: usize = 80;
const VIDEO_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS: i64 = 80;
const VIDEO_SLICE_SUBTITLE_MAX_LATIN_CHARS: usize = 34;
const VIDEO_SLICE_SUBTITLE_MAX_CJK_UNITS: usize = 18;
const VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS: i64 = 3_600;
const VIDEO_SLICE_SUBTITLE_SENTENCE_COMPLETE_GRACE_MS: i64 = 900;
const VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS: i64 = 650;
const WHISPER_SUBTITLE_FRIENDLY_MAX_SEGMENT_CHARS: &str = "34";
const SMART_SLICE_BOUNDARY_DECISION_SOURCES: &[&str] = &["transcript", "audio", "combined"];
const SMART_SLICE_TAIL_TREATMENTS: &[&str] = &["none", "semantic-extend", "fade-out"];
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

#[derive(Debug, Clone)]
enum AutoCutNativeMediaPipeEvent {
    WhisperProgress(i64),
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct AutoCutMediaStreamEvidence {
    has_audio_stream: bool,
    has_video_stream: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct AutoCutMediaProbeEvidence {
    has_audio_stream: bool,
    has_video_stream: bool,
    duration_ms: Option<i64>,
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
    #[serde(default)]
    acceleration_backend: Option<String>,
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
    pub has_audio_stream: bool,
    pub has_video_stream: bool,
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
    pub has_audio_stream: bool,
    pub has_video_stream: bool,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoFileFingerprintRequest {
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoFileFingerprintResult {
    pub source_path: String,
    pub byte_size: u64,
    pub modified_at_ms: u128,
    pub sha256: String,
    pub algorithm: &'static str,
    pub fingerprint_version: &'static str,
    pub file_identity_version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoFileIdentityResult {
    pub source_path: String,
    pub byte_size: u64,
    pub modified_at_ms: u128,
    pub file_identity_version: &'static str,
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
    pub output_quality: String,
    pub output_channel: String,
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
pub struct AutoCutAudioFingerprintRequest {
    pub asset_uuid: String,
    pub source_path: Option<String>,
    pub workflow_task_id: Option<String>,
    pub fingerprint_profile: String,
    pub sample_rate_hz: Option<i64>,
    pub window_duration_ms: Option<i64>,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutAudioFingerprintPayload {
    pub algorithm: String,
    pub hash: String,
    pub energy_buckets: Vec<u8>,
    pub silence_ratio: f64,
    pub spectral_centroid_buckets: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutAudioFingerprintResult {
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub provider: String,
    pub profile: String,
    pub ready: bool,
    pub duration_ms: i64,
    pub sample_rate_hz: i64,
    pub window_duration_ms: i64,
    pub fingerprint: AutoCutAudioFingerprintPayload,
    pub diagnostics: Vec<String>,
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

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceSourceSegment {
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
    pub source_segments: Option<Vec<AutoCutVideoSliceSourceSegment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_silence_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub internal_silence_trim_count: Option<i64>,
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
    pub audio_cleanup_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noise_reduction_applied: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_decision_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_activity_start_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_activity_end_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_activity_confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_activity_analysis_filter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leading_silence_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trailing_silence_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leading_silence_trim_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trailing_silence_trim_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tail_treatment: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risks: Option<Vec<String>>,
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
    pub workflow_task_id: Option<String>,
    pub clips: Vec<AutoCutVideoSliceClipRequest>,
    pub output_format: String,
    pub output_root_dir: Option<String>,
    pub render_profile: Option<AutoCutVideoSliceRenderProfile>,
    #[serde(default = "default_smart_slice_noise_reduction")]
    pub noise_reduction: bool,
    pub subtitle_format: Option<String>,
    pub subtitle_mode: Option<String>,
    pub subtitle_style_id: Option<String>,
    pub subtitle_segments: Option<Vec<AutoCutSpeechTranscriptionSegment>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceAudioActivityAnalysisRequest {
    pub asset_uuid: String,
    pub workflow_task_id: Option<String>,
    pub profile: String,
    #[serde(default = "default_smart_slice_noise_reduction")]
    pub apply_noise_reduction: bool,
    pub output_root_dir: Option<String>,
    pub clips: Vec<AutoCutVideoSliceClipRequest>,
}

fn default_smart_slice_noise_reduction() -> bool {
    false
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceAudioActivityAnalysis {
    pub index: i64,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_activity_start_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_activity_end_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leading_silence_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trailing_silence_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub internal_silence_intervals: Option<Vec<AutoCutVideoSliceSourceSegment>>,
    pub confidence: f64,
    pub analysis_filter: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVideoSliceAudioActivityAnalysisResult {
    pub asset_uuid: String,
    pub profile: String,
    pub analyses: Vec<AutoCutVideoSliceAudioActivityAnalysis>,
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
    pub audio_cleanup_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub noise_reduction_applied: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary_decision_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_activity_start_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_activity_end_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_activity_confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_activity_analysis_filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leading_silence_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trailing_silence_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leading_silence_trim_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trailing_silence_trim_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_segments: Option<Vec<AutoCutVideoSliceSourceSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rendered_duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_silence_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub internal_silence_trim_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tail_treatment: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risks: Option<Vec<String>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<AutoCutSpeechTranscriptionWord>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionWord {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probability: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptionRequest {
    pub asset_uuid: String,
    pub workflow_task_id: Option<String>,
    pub provider_id: Option<String>,
    pub stt_preset_id: Option<String>,
    pub stt_execution_profile: Option<String>,
    pub whisper_chunk_parallelism: Option<usize>,
    pub whisper_chunk_thread_count: Option<usize>,
    pub whisper_chunk_source_strategy: Option<String>,
    pub whisper_audio_context: Option<usize>,
    pub whisper_beam_size: Option<usize>,
    pub whisper_best_of: Option<usize>,
    #[serde(default)]
    pub whisper_no_fallback: bool,
    pub language: Option<String>,
    pub output_root_dir: Option<String>,
    pub executable_path: Option<String>,
    pub model_path: Option<String>,
    pub workflow_purpose: Option<String>,
    #[serde(default)]
    pub dedupe_repeated_speech: bool,
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
    pub stt_preset_id: Option<String>,
    pub execution_profile: Option<String>,
    pub segments: Vec<AutoCutSpeechTranscriptionSegment>,
    pub text: String,
    pub quality_guard: AutoCutSpeechTranscriptQualityGuard,
    pub ffmpeg_executable: String,
    pub speech_executable: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptQualityGuard {
    pub schema: String,
    pub status: String,
    pub passed: bool,
    pub scope: String,
    pub chunk_id: String,
    pub retry_count: usize,
    pub risk_count: usize,
    pub risks: Vec<AutoCutSpeechTranscriptQualityRisk>,
    pub metrics: AutoCutSpeechTranscriptQualityMetrics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptQualityRisk {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutSpeechTranscriptQualityMetrics {
    pub segment_count: usize,
    pub text_length: usize,
    pub unique_character_ratio: f64,
    pub replacement_character_count: usize,
    pub repeated_phrase_run_count: usize,
    pub duplicate_window_ratio: f64,
    pub tiny_segment_ratio: f64,
}

impl Default for AutoCutSpeechTranscriptQualityMetrics {
    fn default() -> Self {
        Self {
            segment_count: 0,
            text_length: 0,
            unique_character_ratio: 1.0,
            replacement_character_count: 0,
            repeated_phrase_run_count: 0,
            duplicate_window_ratio: 0.0,
            tiny_segment_ratio: 0.0,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct AutoCutSpeechTranscriptionExecutionOptions {
    stt_preset_id: Option<String>,
    execution_profile: Option<String>,
    whisper_chunk_parallelism: Option<usize>,
    whisper_chunk_thread_count: Option<usize>,
    chunk_source_strategy: AutoCutSpeechChunkSourceStrategy,
    whisper_audio_context: Option<usize>,
    whisper_beam_size: Option<usize>,
    whisper_best_of: Option<usize>,
    whisper_no_fallback: bool,
}

#[derive(Debug, Clone)]
struct AutoCutSpeechAudioChunkPlan {
    id: String,
    index: usize,
    start_ms: i64,
    end_ms: i64,
    audio_path: PathBuf,
    transcript_stem: PathBuf,
    transcript_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoCutSpeechChunkPipelineStep {
    ExtractAudio,
    TranscribeAudio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoCutSpeechChunkAudioSourceKind {
    ExtractedWav,
    SourceMediaDirect,
}

impl AutoCutSpeechChunkAudioSourceKind {
    fn as_manifest_value(self) -> &'static str {
        match self {
            Self::ExtractedWav => "extracted-wav",
            Self::SourceMediaDirect => "source-media-direct",
        }
    }

    fn full_audio_extracted(self) -> bool {
        matches!(self, Self::ExtractedWav)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoCutSpeechChunkSourceStrategy {
    AudioFirst,
    SourceDirect,
}

impl Default for AutoCutSpeechChunkSourceStrategy {
    fn default() -> Self {
        Self::AudioFirst
    }
}

impl AutoCutSpeechChunkSourceStrategy {
    fn as_manifest_value(self) -> &'static str {
        match self {
            Self::AudioFirst => "audio-first",
            Self::SourceDirect => "source-direct",
        }
    }

    fn from_profile(profile: Option<&str>) -> Self {
        match profile.unwrap_or_default().trim() {
            "fast-preview" | "balanced" | "source-direct" => Self::SourceDirect,
            "quality" | "" => Self::AudioFirst,
            _ => Self::AudioFirst,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVisualEvidenceExtractionRequest {
    pub asset_uuid: String,
    pub source_path: Option<String>,
    pub workflow_task_id: Option<String>,
    pub visual_evidence_profile: String,
    pub scene_change_threshold: Option<f64>,
    pub min_shot_duration_ms: Option<i64>,
    pub include_frame_quality: Option<bool>,
    pub include_frame_fingerprint: Option<bool>,
    pub output_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVisualEvidenceShot {
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVisualEvidenceSceneBoundary {
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVisualEvidenceFrameQualitySample {
    pub at_ms: i64,
    pub blur_score: f64,
    pub exposure_score: f64,
    pub stability_score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVisualEvidenceFrameFingerprintSample {
    pub at_ms: i64,
    pub algorithm: &'static str,
    pub hash: String,
    pub mean_luma: f64,
    pub histogram: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutVisualEvidenceExtractionResult {
    pub task_uuid: String,
    pub source_asset_uuid: String,
    pub provider: String,
    pub profile: String,
    pub ready: bool,
    pub shots: Vec<AutoCutVisualEvidenceShot>,
    pub scene_boundaries: Vec<AutoCutVisualEvidenceSceneBoundary>,
    pub frame_quality: Option<Vec<AutoCutVisualEvidenceFrameQualitySample>>,
    pub frame_fingerprints: Option<Vec<AutoCutVisualEvidenceFrameFingerprintSample>>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutTaskEvidenceWriteRequest {
    pub workflow_task_id: String,
    pub output_root_dir: Option<String>,
    pub relative_path: String,
    pub content_json: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutTaskEvidenceWriteResult {
    pub task_uuid: String,
    pub task_output_dir: String,
    pub artifact_path: String,
    pub relative_path: String,
    pub byte_size: u64,
    pub content_sha256: String,
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
    pub gpu_ready: bool,
    pub gpu_backend: Option<String>,
    pub gpu_diagnostics: Vec<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutNativeTaskProgressEvent {
    pub task_uuid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_uuid: Option<String>,
    pub event_type: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    pub payload: Value,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoCutMediaImportTransferStrategy {
    HardLink,
    Copy,
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

#[derive(Debug, Default)]
struct AutoCutVideoSliceEncoderSession {
    preferred_candidate_index: Option<usize>,
    stream_copy_disabled: bool,
}

#[derive(Debug)]
struct AutoCutAudioFingerprintAccumulator {
    samples_per_window: usize,
    total_samples: usize,
    current_window_samples: usize,
    current_sum_squares: f64,
    current_zero_crossings: usize,
    current_previous_sample: Option<f64>,
    pending_byte: Option<u8>,
    rms_windows: Vec<f64>,
    zcr_windows: Vec<f64>,
}

#[derive(Debug, Clone)]
struct AutoCutSpeechToolchain {
    executable: String,
    model_path: String,
    source_kind: String,
    acceleration_backend: Option<String>,
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
    has_video_stream: bool,
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
    match new_autocut_hidden_child_command(&toolchain.executable)
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

pub fn fingerprint_autocut_video_file(
    app: &AppHandle,
    request: AutoCutVideoFileFingerprintRequest,
) -> Result<AutoCutVideoFileFingerprintResult, String> {
    let _command_contract = "autocut_fingerprint_video_file";
    let result = fingerprint_autocut_video_file_from_path(Path::new(&request.source_path))?;
    allow_autocut_asset_protocol_file_parent_scope(app, Path::new(&result.source_path))?;

    Ok(result)
}

pub fn probe_autocut_video_file_identity(
    app: &AppHandle,
    request: AutoCutVideoFileFingerprintRequest,
) -> Result<AutoCutVideoFileIdentityResult, String> {
    let _command_contract = "autocut_probe_video_file_identity";
    let result = probe_autocut_video_file_identity_from_path(Path::new(&request.source_path))?;
    allow_autocut_asset_protocol_file_parent_scope(app, Path::new(&result.source_path))?;

    Ok(result)
}

pub fn extract_autocut_audio_fingerprint(
    app: &AppHandle,
    request: AutoCutAudioFingerprintRequest,
) -> Result<AutoCutAudioFingerprintResult, String> {
    let _command_contract = "autocut_extract_audio_fingerprint";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    extract_autocut_audio_fingerprint_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

fn fingerprint_autocut_video_file_from_path(
    source_path: &Path,
) -> Result<AutoCutVideoFileFingerprintResult, String> {
    let source_path = ensure_safe_import_source_path(source_path)?;
    let identity = probe_autocut_video_file_identity_from_canonical_path(&source_path)?;

    Ok(AutoCutVideoFileFingerprintResult {
        source_path: identity.source_path,
        byte_size: identity.byte_size,
        modified_at_ms: identity.modified_at_ms,
        sha256: calculate_file_sha256(&source_path)?,
        algorithm: "sha256",
        fingerprint_version: "2026-05-15.video-file-fingerprint.v1",
        file_identity_version: identity.file_identity_version,
    })
}

fn probe_autocut_video_file_identity_from_path(
    source_path: &Path,
) -> Result<AutoCutVideoFileIdentityResult, String> {
    let source_path = ensure_safe_import_source_path(source_path)?;
    probe_autocut_video_file_identity_from_canonical_path(&source_path)
}

fn probe_autocut_video_file_identity_from_canonical_path(
    source_path: &Path,
) -> Result<AutoCutVideoFileIdentityResult, String> {
    let metadata = fs::metadata(source_path).map_err(|error| {
        format!(
            "read AutoCut video file identity source metadata failed for {}: {error}",
            source_path.display()
        )
    })?;
    let modified_at_ms = metadata
        .modified()
        .map_err(|error| {
            format!(
                "read AutoCut video file identity modified time failed for {}: {error}",
                source_path.display()
            )
        })?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            format!(
                "normalize AutoCut video file identity modified time failed for {}: {error}",
                source_path.display()
            )
        })?
        .as_millis();

    Ok(AutoCutVideoFileIdentityResult {
        source_path: source_path.display().to_string(),
        byte_size: metadata.len(),
        modified_at_ms,
        file_identity_version: "2026-05-15.video-file-identity.v1",
    })
}

#[cfg(test)]
fn fingerprint_autocut_video_file_from_path_for_test(
    source_path: &Path,
) -> Result<AutoCutVideoFileFingerprintResult, String> {
    fingerprint_autocut_video_file_from_path(source_path)
}

#[cfg(test)]
fn probe_autocut_video_file_identity_from_path_for_test(
    source_path: &Path,
) -> Result<AutoCutVideoFileIdentityResult, String> {
    probe_autocut_video_file_identity_from_path(source_path)
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
    dialog = dialog.add_filter("All files", AUTOCUT_ALL_FILES_DIALOG_EXTENSIONS);

    let Some(source_path) = dialog.pick_file() else {
        return Ok(None);
    };

    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    let description = describe_autocut_local_media_file_from_path(&source_path, Some(&toolchain))?;
    if !requested_autocut_media_streams_match_description(&requested_media_types, &description) {
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
    if !requested_autocut_media_streams_match_description(&["video".to_string()], &description) {
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
        match new_autocut_hidden_child_command(&toolchain.executable)
            .arg("--help")
            .output()
        {
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
    let gpu_probe = probe_autocut_speech_gpu_acceleration(&toolchain, version_line.as_deref());

    AutoCutSpeechTranscriptionProbe {
        ready: diagnostics.is_empty() && toolchain.ready,
        executable_ready: toolchain.executable_ready,
        model_ready: toolchain.model_ready,
        gpu_ready: gpu_probe.ready,
        gpu_backend: gpu_probe.backend,
        gpu_diagnostics: gpu_probe.diagnostics,
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
        Some(app),
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn analyze_autocut_video_slice_audio_activity(
    app: &AppHandle,
    request: AutoCutVideoSliceAudioActivityAnalysisRequest,
) -> Result<AutoCutVideoSliceAudioActivityAnalysisResult, String> {
    let _command_contract = "autocut_analyze_video_slice_audio_activity";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    analyze_autocut_video_slice_audio_activity_in_root_with_toolchain(
        Some(app),
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
        Some(app),
        &connection,
        &media_root,
        request,
        &ffmpeg_toolchain,
        &speech_toolchain,
    )
}

pub fn extract_autocut_visual_evidence(
    app: &AppHandle,
    request: AutoCutVisualEvidenceExtractionRequest,
) -> Result<AutoCutVisualEvidenceExtractionResult, String> {
    let _command_contract = "autocut_extract_visual_evidence";
    let connection = database_runtime::open_autocut_database_connection(app)?;
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    let toolchain = resolve_autocut_ffmpeg_toolchain_for_app(app);
    extract_autocut_visual_evidence_in_root_with_toolchain(
        &connection,
        &media_root,
        request,
        &toolchain,
    )
}

pub fn write_autocut_task_evidence_json(
    app: &AppHandle,
    request: AutoCutTaskEvidenceWriteRequest,
) -> Result<AutoCutTaskEvidenceWriteResult, String> {
    let _command_contract = "autocut_write_task_evidence_json";
    let media_root = autocut_media_root_for_request(app, request.output_root_dir.as_deref())?;
    write_autocut_task_evidence_json_in_root(&media_root, request)
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
        let mut command = new_autocut_hidden_child_command("explorer");
        command.arg(format!("/select,{}", artifact_path.display()));
        return Ok(command);
    }
    if cfg!(target_os = "macos") {
        let mut command = new_autocut_hidden_child_command("open");
        command.arg("-R");
        command.arg(artifact_path);
        return Ok(command);
    }
    if cfg!(target_os = "linux") {
        let mut command = new_autocut_hidden_child_command("xdg-open");
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
            && task_output_dir.file_name().and_then(|name| name.to_str()) == Some(task_uuid)
            && task_output_dir
                .parent()
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
                == Some(AUTOCUT_MEDIA_TASK_DIR)
        {
            return task_output_dir
                .parent()
                .and_then(Path::parent)
                .filter(|root| root.is_absolute())
                .map(Path::to_path_buf);
        }
        if task_output_dir.is_absolute()
            && task_output_dir.file_name().and_then(|name| name.to_str()) == Some("outputs")
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

    let output_dir = root.join(AUTOCUT_MEDIA_TASK_DIR).join(normalized_task_uuid);
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

fn write_autocut_task_evidence_json_in_root(
    root: &Path,
    request: AutoCutTaskEvidenceWriteRequest,
) -> Result<AutoCutTaskEvidenceWriteResult, String> {
    let task_uuid = normalize_required_task_uuid(&request.workflow_task_id)?;
    let task_output_dir = autocut_task_output_dir(root, &task_uuid)?;
    let relative_path = normalize_autocut_task_evidence_relative_json_path(&request.relative_path)?;
    let artifact_path = task_output_dir.join(&relative_path);
    let artifact_parent = artifact_path.parent().ok_or_else(|| {
        "AutoCut task evidence JSON path must have a parent directory".to_string()
    })?;
    fs::create_dir_all(artifact_parent)
        .map_err(|error| format!("create AutoCut task evidence directory failed: {error}"))?;

    let canonical_task_output_dir = task_output_dir
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut task output directory failed: {error}"))?;
    let canonical_parent = artifact_parent
        .canonicalize()
        .map_err(|error| format!("canonicalize AutoCut task evidence directory failed: {error}"))?;
    if !canonical_parent.starts_with(&canonical_task_output_dir) {
        return Err(
            "AutoCut task evidence JSON path must stay under the task output directory".to_string(),
        );
    }

    let serialized = serde_json::to_vec_pretty(&request.content_json)
        .map_err(|error| format!("serialize AutoCut task evidence JSON failed: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let content_sha256 = format!("{:x}", hasher.finalize());
    let temporary_path = artifact_path.with_extension("json.tmp");
    let _ = fs::remove_file(&temporary_path);
    fs::write(&temporary_path, &serialized)
        .map_err(|error| format!("write AutoCut task evidence temp JSON failed: {error}"))?;
    if artifact_path.exists() {
        fs::remove_file(&artifact_path)
            .map_err(|error| format!("replace AutoCut task evidence JSON failed: {error}"))?;
    }
    fs::rename(&temporary_path, &artifact_path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        format!("commit AutoCut task evidence JSON failed: {error}")
    })?;
    let byte_size = fs::metadata(&artifact_path)
        .map_err(|error| format!("read AutoCut task evidence JSON metadata failed: {error}"))?
        .len();

    Ok(AutoCutTaskEvidenceWriteResult {
        task_uuid,
        task_output_dir: canonical_task_output_dir.display().to_string(),
        artifact_path: artifact_path.display().to_string(),
        relative_path,
        byte_size,
        content_sha256,
    })
}

fn normalize_autocut_task_evidence_relative_json_path(
    relative_path: &str,
) -> Result<String, String> {
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("AutoCut task evidence JSON relativePath must be non-empty".to_string());
    }
    if normalized.starts_with('/') || Path::new(&normalized).is_absolute() {
        return Err("AutoCut task evidence JSON relativePath must be relative".to_string());
    }
    if !normalized.ends_with(".json") {
        return Err("AutoCut task evidence relativePath must end with .json".to_string());
    }
    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(
            "AutoCut task evidence JSON relativePath must not contain empty segments or parent traversal"
                .to_string(),
        );
    }
    if normalized.chars().any(|character| {
        !(character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/'))
    }) {
        return Err(
            "AutoCut task evidence JSON relativePath contains unsupported characters".to_string(),
        );
    }

    Ok(normalized)
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

fn normalize_audio_quality(quality: &str) -> Result<String, String> {
    let normalized = quality.trim().trim_end_matches("kbps").trim();
    if SUPPORTED_AUDIO_QUALITIES.contains(&normalized) {
        return Ok(normalized.to_string());
    }

    Err(format!(
        "unsupported audio quality '{quality}', expected one of {} kbps",
        SUPPORTED_AUDIO_QUALITIES.join(", ")
    ))
}

fn normalize_audio_channel(channel: &str) -> Result<String, String> {
    let normalized = channel.trim().to_ascii_lowercase();
    if SUPPORTED_AUDIO_CHANNELS.contains(&normalized.as_str()) {
        return Ok(normalized);
    }

    Err(format!(
        "unsupported audio channel '{channel}', expected one of {}",
        SUPPORTED_AUDIO_CHANNELS.join(", ")
    ))
}

fn normalize_audio_fingerprint_profile(profile: &str) -> Result<String, String> {
    let normalized = profile.trim().to_ascii_lowercase();
    if normalized == "audio-energy-v1" {
        return Ok(normalized);
    }

    Err(format!(
        "unsupported audio fingerprint profile '{profile}', expected audio-energy-v1"
    ))
}

fn normalize_audio_fingerprint_sample_rate_hz(value: Option<i64>) -> Result<i64, String> {
    let normalized = value.unwrap_or(16_000);
    if (8_000..=48_000).contains(&normalized) {
        return Ok(normalized);
    }

    Err(format!(
        "audio fingerprint sampleRateHz must be between 8000 and 48000, got {normalized}"
    ))
}

fn normalize_audio_fingerprint_window_duration_ms(value: Option<i64>) -> Result<i64, String> {
    let normalized = value.unwrap_or(1_000);
    if (250..=4_000).contains(&normalized) {
        return Ok(normalized);
    }

    Err(format!(
        "audio fingerprint windowDurationMs must be between 250 and 4000, got {normalized}"
    ))
}

fn flac_compression_level_for_quality(quality: &str) -> &'static str {
    match quality {
        "320" => "5",
        "256" => "8",
        "192" => "10",
        "128" => "12",
        _ => "8",
    }
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

fn append_video_slice_clear_display_matrix_filter(filter_chain: Option<String>) -> String {
    match filter_chain {
        Some(filter_chain) => format!("{filter_chain},{VIDEO_SLICE_CLEAR_DISPLAY_MATRIX_FILTER}"),
        None => VIDEO_SLICE_CLEAR_DISPLAY_MATRIX_FILTER.to_string(),
    }
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

fn normalize_video_slice_subtitle_style_id(style_id: Option<&str>) -> Option<String> {
    style_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| match value {
            "tiktok" | "variety" | "gradient-cyan" | "fire" | "neon" | "gold" | "retro-pop"
            | "thick-border" | "minimal" | "clean-default" | "title-retro" | "3d-block"
            | "bubble-gum" => value.to_string(),
            _ => "tiktok".to_string(),
        })
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
        matches!(self, Self::Srt | Self::Burned | Self::Both)
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
                source_segments: normalize_video_slice_source_segments(clip, index + 1)?,
                rendered_duration_ms: normalize_video_slice_rendered_duration_ms(clip),
                removed_silence_ms: normalize_video_slice_removed_silence_ms(clip),
                internal_silence_trim_count: normalize_video_slice_internal_silence_trim_count(
                    clip,
                ),
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

    let safe_ranges = merged_ranges
        .into_iter()
        .filter(|range| range.end_ms - range.start_ms <= 3_000)
        .collect::<Vec<_>>();

    Ok((!safe_ranges.is_empty()).then_some(safe_ranges))
}

fn normalize_video_slice_source_segments(
    clip: &AutoCutVideoSliceClipRequest,
    clip_number: usize,
) -> Result<Option<Vec<AutoCutVideoSliceSourceSegment>>, String> {
    let Some(segments) = clip
        .source_segments
        .as_ref()
        .filter(|segments| !segments.is_empty())
    else {
        return Ok(None);
    };

    if segments.len() > SMART_SLICE_MAX_SOURCE_SEGMENTS {
        return Err(format!(
            "AutoCut video slice clip {clip_number} supports at most {SMART_SLICE_MAX_SOURCE_SEGMENTS} sourceSegments"
        ));
    }

    let source_start_ms = clip.source_start_ms.unwrap_or(clip.start_ms);
    let source_end_ms = clip
        .source_end_ms
        .unwrap_or(clip.start_ms.saturating_add(clip.duration_ms));
    let mut normalized_segments = Vec::with_capacity(segments.len());
    let mut previous_end_ms: Option<i64> = None;
    for (segment_index, segment) in segments.iter().enumerate() {
        let segment_number = segment_index + 1;
        let start_ms = segment.start_ms.max(source_start_ms).min(source_end_ms);
        let end_ms = segment.end_ms.max(source_start_ms).min(source_end_ms);
        if end_ms <= start_ms {
            continue;
        }
        if previous_end_ms.is_some_and(|previous_end_ms| start_ms < previous_end_ms) {
            return Err(format!(
                "AutoCut video slice clip {clip_number} sourceSegments[{segment_number}] must be ordered and non-overlapping"
            ));
        }
        normalized_segments.push(AutoCutVideoSliceSourceSegment { start_ms, end_ms });
        previous_end_ms = Some(end_ms);
    }

    if normalized_segments.len() <= 1 {
        return Ok(None);
    }
    if normalized_segments
        .first()
        .map(|segment| segment.start_ms != source_start_ms)
        .unwrap_or(false)
        || normalized_segments
            .last()
            .map(|segment| segment.end_ms != source_end_ms)
            .unwrap_or(false)
    {
        return Err(format!(
            "AutoCut video slice clip {clip_number} source range must span retained sourceSegments"
        ));
    }

    Ok(Some(normalized_segments))
}

fn normalize_video_slice_rendered_duration_ms(clip: &AutoCutVideoSliceClipRequest) -> Option<i64> {
    clip.rendered_duration_ms
        .filter(|duration_ms| *duration_ms > 0)
}

fn normalize_video_slice_removed_silence_ms(clip: &AutoCutVideoSliceClipRequest) -> Option<i64> {
    clip.removed_silence_ms
        .filter(|duration_ms| *duration_ms > 0)
}

fn normalize_video_slice_internal_silence_trim_count(
    clip: &AutoCutVideoSliceClipRequest,
) -> Option<i64> {
    clip.internal_silence_trim_count.filter(|count| *count > 0)
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
    let source_end_ms = clip
        .source_end_ms
        .unwrap_or(clip.start_ms + clip.duration_ms);
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
    let first_transcript_segment_start_ms = transcript_segments
        .first()
        .map(|segment| segment.start_ms)
        .ok_or_else(|| {
            format!(
                "AutoCut video slice clip {clip_number} speech range must stay covered by structured transcript segment boundaries"
            )
        })?;
    let last_transcript_segment_end_ms = transcript_segments
        .last()
        .map(|segment| segment.end_ms)
        .ok_or_else(|| {
            format!(
                "AutoCut video slice clip {clip_number} speech range must stay covered by structured transcript segment boundaries"
            )
        })?;
    if first_transcript_segment_start_ms
        > speech_start_ms + VIDEO_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
        || last_transcript_segment_end_ms
            < speech_end_ms - VIDEO_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    {
        return Err(format!(
            "AutoCut video slice clip {clip_number} speech range must stay covered by structured transcript segment boundaries"
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

    if clip
        .transcript_coverage_score
        .filter(|score| *score >= 0.8)
        .is_none()
    {
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
    ensure_video_slice_clip_audio_cleanup_evidence(clip, clip_number)?;

    Ok(())
}

fn ensure_video_slice_clip_audio_cleanup_evidence(
    clip: &AutoCutVideoSliceClipRequest,
    clip_number: usize,
) -> Result<(), String> {
    if let Some(profile) = clip.audio_cleanup_profile.as_deref() {
        if profile.trim() != SMART_SLICE_AUDIO_CLEANUP_PROFILE {
            return Err(format!(
                "AutoCut video slice clip {clip_number} audioCleanupProfile must be {SMART_SLICE_AUDIO_CLEANUP_PROFILE}"
            ));
        }
    }
    if let Some(boundary_decision_source) = clip.boundary_decision_source.as_deref() {
        if !SMART_SLICE_BOUNDARY_DECISION_SOURCES.contains(&boundary_decision_source) {
            return Err(format!(
                "AutoCut video slice clip {clip_number} boundaryDecisionSource must be transcript, audio, or combined"
            ));
        }
    }
    if let Some(leading_silence_trim_ms) = clip.leading_silence_trim_ms {
        if leading_silence_trim_ms < 0 {
            return Err(format!(
                "AutoCut video slice clip {clip_number} leadingSilenceTrimMs must be non-negative"
            ));
        }
    }
    if let Some(trailing_silence_trim_ms) = clip.trailing_silence_trim_ms {
        if trailing_silence_trim_ms < 0 {
            return Err(format!(
                "AutoCut video slice clip {clip_number} trailingSilenceTrimMs must be non-negative"
            ));
        }
    }
    if let Some(tail_treatment) = clip.tail_treatment.as_deref() {
        if !SMART_SLICE_TAIL_TREATMENTS.contains(&tail_treatment) {
            return Err(format!(
                "AutoCut video slice clip {clip_number} tailTreatment must be none, semantic-extend, or fade-out"
            ));
        }
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

fn normalize_visual_evidence_profile(profile: &str) -> Result<String, String> {
    let normalized = profile.trim();
    if normalized.is_empty() {
        return Err(
            "AutoCut visual evidence extraction requires visualEvidenceProfile.".to_string(),
        );
    }
    if !AUTOCUT_VISUAL_EVIDENCE_SUPPORTED_PROFILES.contains(&normalized) {
        return Err(format!(
            "AutoCut visual evidence extraction profile {normalized} is not supported."
        ));
    }
    Ok(normalized.to_string())
}

fn ensure_visual_evidence_threshold(value: Option<f64>) -> Result<(), String> {
    if let Some(threshold) = value {
        if !threshold.is_finite() || threshold <= 0.0 || threshold >= 1.0 {
            return Err(format!(
                "AutoCut visual evidence extraction sceneChangeThreshold {threshold} must be strictly between 0 and 1."
            ));
        }
    }
    Ok(())
}

fn ensure_visual_evidence_min_shot_duration(value: Option<i64>) -> Result<(), String> {
    if let Some(duration_ms) = value {
        if duration_ms <= 0 {
            return Err(format!(
                "AutoCut visual evidence extraction minShotDurationMs {duration_ms} must be a positive integer millisecond value."
            ));
        }
    }
    Ok(())
}

fn normalize_path_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_autocut_whisper_chunk_option(
    value: Option<usize>,
    field_name: &str,
) -> Result<Option<usize>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if (1..=8).contains(&value) {
        Ok(Some(value))
    } else {
        Err(format!(
            "AutoCut speech-to-text workflow {field_name} must be an integer from 1 to 8."
        ))
    }
}

fn normalize_autocut_whisper_decode_option(
    value: Option<usize>,
    field_name: &str,
    min_value: usize,
    max_value: usize,
) -> Result<Option<usize>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if (min_value..=max_value).contains(&value) {
        Ok(Some(value))
    } else {
        Err(format!(
            "AutoCut speech-to-text workflow {field_name} must be an integer from {min_value} to {max_value}."
        ))
    }
}

fn normalize_speech_transcription_execution_options(
    request: &AutoCutSpeechTranscriptionRequest,
) -> Result<AutoCutSpeechTranscriptionExecutionOptions, String> {
    let execution_profile = normalize_path_text(request.stt_execution_profile.as_deref());
    let default_greedy_decode = matches!(
        execution_profile.as_deref().unwrap_or_default().trim(),
        "fast-preview" | "balanced"
    );
    Ok(AutoCutSpeechTranscriptionExecutionOptions {
        stt_preset_id: normalize_path_text(request.stt_preset_id.as_deref()),
        execution_profile: execution_profile.clone(),
        whisper_chunk_parallelism: normalize_autocut_whisper_chunk_option(
            request.whisper_chunk_parallelism,
            "whisperChunkParallelism",
        )?,
        whisper_chunk_thread_count: normalize_autocut_whisper_chunk_option(
            request.whisper_chunk_thread_count,
            "whisperChunkThreadCount",
        )?,
        chunk_source_strategy: normalize_autocut_speech_chunk_source_strategy(
            request.whisper_chunk_source_strategy.as_deref(),
            execution_profile.as_deref(),
        )?,
        whisper_audio_context: normalize_autocut_whisper_decode_option(
            request.whisper_audio_context,
            "whisperAudioContext",
            1,
            1_500,
        )?,
        whisper_beam_size: normalize_autocut_whisper_decode_option(
            request.whisper_beam_size,
            "whisperBeamSize",
            1,
            8,
        )?
        .or(if default_greedy_decode { Some(1) } else { None }),
        whisper_best_of: normalize_autocut_whisper_decode_option(
            request.whisper_best_of,
            "whisperBestOf",
            1,
            8,
        )?
        .or(if default_greedy_decode { Some(1) } else { None }),
        whisper_no_fallback: request.whisper_no_fallback || default_greedy_decode,
    })
}

fn normalize_autocut_speech_chunk_source_strategy(
    value: Option<&str>,
    execution_profile: Option<&str>,
) -> Result<AutoCutSpeechChunkSourceStrategy, String> {
    let Some(value) = normalize_path_text(value) else {
        return Ok(AutoCutSpeechChunkSourceStrategy::from_profile(
            execution_profile,
        ));
    };
    match value.as_str() {
        "audio-first" => Ok(AutoCutSpeechChunkSourceStrategy::AudioFirst),
        "source-direct" => Ok(AutoCutSpeechChunkSourceStrategy::SourceDirect),
        _ => Err(format!(
            "AutoCut speech-to-text workflow whisperChunkSourceStrategy must be audio-first or source-direct, got {value}."
        )),
    }
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
                words: normalize_video_slice_subtitle_words(
                    segment.words,
                    segment.start_ms.max(0),
                    segment.end_ms.max(0),
                ),
            })
        })
        .collect()
}

fn normalize_video_slice_subtitle_words(
    words: Option<Vec<AutoCutSpeechTranscriptionWord>>,
    segment_start_ms: i64,
    segment_end_ms: i64,
) -> Option<Vec<AutoCutSpeechTranscriptionWord>> {
    let mut normalized_words = words
        .unwrap_or_default()
        .into_iter()
        .filter_map(|word| {
            let text = word.text.trim();
            if text.is_empty() || word.end_ms <= word.start_ms {
                return None;
            }
            let start_ms = word.start_ms.max(segment_start_ms);
            let end_ms = word.end_ms.min(segment_end_ms);
            if end_ms <= start_ms {
                return None;
            }

            Some(AutoCutSpeechTranscriptionWord {
                start_ms,
                end_ms,
                text: text.chars().take(80).collect(),
                probability: word
                    .probability
                    .filter(|probability| probability.is_finite())
                    .map(|probability| probability.clamp(0.0, 1.0)),
            })
        })
        .collect::<Vec<_>>();

    normalized_words.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then_with(|| first.end_ms.cmp(&second.end_ms))
    });

    let mut repaired_words: Vec<AutoCutSpeechTranscriptionWord> = Vec::new();
    for word in normalized_words {
        let start_ms = repaired_words
            .last()
            .map(|previous| word.start_ms.max(previous.end_ms))
            .unwrap_or(word.start_ms);
        if word.end_ms <= start_ms {
            continue;
        }
        repaired_words.push(AutoCutSpeechTranscriptionWord { start_ms, ..word });
    }

    if repaired_words.is_empty() {
        None
    } else {
        Some(repaired_words)
    }
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
        source_segments: clip.source_segments.clone(),
        rendered_duration_ms: clip.rendered_duration_ms,
        removed_silence_ms: clip.removed_silence_ms,
        internal_silence_trim_count: clip.internal_silence_trim_count,
        source_start_ms: clip.source_start_ms,
        source_end_ms: clip.source_end_ms,
        speech_start_ms: clip.speech_start_ms,
        speech_end_ms: clip.speech_end_ms,
        boundary_padding_before_ms: clip.boundary_padding_before_ms,
        boundary_padding_after_ms: clip.boundary_padding_after_ms,
        audio_cleanup_profile: clip.audio_cleanup_profile.clone(),
        noise_reduction_applied: clip.noise_reduction_applied,
        boundary_decision_source: clip.boundary_decision_source.clone(),
        audio_activity_start_ms: clip.audio_activity_start_ms,
        audio_activity_end_ms: clip.audio_activity_end_ms,
        audio_activity_confidence: clip.audio_activity_confidence,
        audio_activity_analysis_filter: clip.audio_activity_analysis_filter.clone(),
        leading_silence_ms: clip.leading_silence_ms,
        trailing_silence_ms: clip.trailing_silence_ms,
        leading_silence_trim_ms: clip.leading_silence_trim_ms,
        trailing_silence_trim_ms: clip.trailing_silence_trim_ms,
        tail_treatment: clip.tail_treatment.clone(),
        transcript_text: clip.transcript_text.clone(),
        transcript_segments: clip.transcript_segments.clone(),
        transcript_segment_count: clip.transcript_segment_count,
        transcript_coverage_score: clip.transcript_coverage_score,
        speech_continuity_grade: clip.speech_continuity_grade.clone(),
        risks: clip.risks.clone(),
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
    download_validated_autocut_speech_transcription_model_in_root(root, request, app)
}

fn download_validated_autocut_speech_transcription_model_in_root(
    root: &Path,
    request: AutoCutSpeechTranscriptionModelDownloadRequest,
    app: Option<&AppHandle>,
) -> Result<AutoCutSpeechTranscriptionModelDownloadResult, String> {
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
            downloaded: true,
            source_url: request.url.clone(),
            sha256: request.sha256,
        });
    }

    let temporary_path = canonical_model_directory.join(format!("{}.download", request.file_name));
    emit_autocut_speech_transcription_model_download_progress(
        app, &request, "started", 0, None, None, None,
    );
    let mut download_errors = Vec::new();
    let mut successful_source_url = None::<String>;
    let mut byte_size = 0_u64;
    for source_url in &download_urls {
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
        || !request
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
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
            "AutoCut speech transcription model download primary URL must be first.".to_string(),
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

    let partial_byte_size = fs::metadata(target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut request_builder = client.get(source_url);
    if partial_byte_size > 0 {
        request_builder = request_builder.header(RANGE, format!("bytes={partial_byte_size}-"));
    }
    let mut response = request_builder
        .send()
        .map_err(|error| format!("download AutoCut speech transcription model failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::RANGE_NOT_SATISFIABLE && partial_byte_size > 0 {
            if verify_file_sha256_for_label(
                target_path,
                &request.sha256,
                "complete partial AutoCut speech transcription model download",
            )
            .is_ok()
            {
                return Ok(partial_byte_size);
            }
            let _ = fs::remove_file(target_path);
            return download_autocut_speech_transcription_model_file_with_progress(
                request,
                source_url,
                target_path,
                app,
            );
        }
        return Err(format!(
            "download AutoCut speech transcription model failed with HTTP status {}",
            status
        ));
    }

    let (resume_byte_size, total_bytes, append_to_partial) =
        resolve_autocut_speech_model_download_response_state(
            partial_byte_size,
            status,
            response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok()),
            response.content_length(),
        )
        .map_err(|error| {
            let _ = fs::remove_file(target_path);
            error
        })?;
    let mut output_options = fs::OpenOptions::new();
    output_options.create(true).write(true);
    if append_to_partial {
        output_options.append(true);
    } else {
        output_options.truncate(true);
    }
    let mut output = output_options.open(target_path).map_err(|error| {
        format!("open AutoCut speech transcription model temp file failed: {error}")
    })?;
    let mut byte_size = resume_byte_size;
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
            || last_emitted_progress
                .map(|last| progress.saturating_sub(last) >= 2)
                .unwrap_or(true)
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
    if let Some(total_bytes) = total_bytes {
        if byte_size < total_bytes {
            return Err(format!(
                "AutoCut speech transcription model download did not finish: expected {total_bytes} bytes, received {byte_size} bytes. Retry will resume from the preserved partial .download file."
            ));
        }
    }

    Ok(byte_size)
}

fn resolve_autocut_speech_model_download_response_state(
    partial_byte_size: u64,
    status: StatusCode,
    content_range: Option<&str>,
    content_length: Option<u64>,
) -> Result<(u64, Option<u64>, bool), String> {
    if partial_byte_size == 0 {
        if status == StatusCode::PARTIAL_CONTENT {
            let parsed_range = parse_autocut_http_content_range(content_range.ok_or_else(|| {
                "AutoCut speech transcription model partial download response is missing Content-Range.".to_string()
            })?)?;
            if parsed_range.start != 0 {
                return Err(
                    "AutoCut speech transcription model partial download response starts after byte 0."
                        .to_string(),
                );
            }
            return Ok((0, Some(parsed_range.total), false));
        }
        return Ok((0, content_length, false));
    }

    if status == StatusCode::PARTIAL_CONTENT {
        let parsed_range = parse_autocut_http_content_range(content_range.ok_or_else(|| {
            "AutoCut speech transcription model resume response is missing Content-Range."
                .to_string()
        })?)?;
        if parsed_range.start != partial_byte_size {
            return Err(format!(
                "AutoCut speech transcription model resume response starts at byte {}, expected {partial_byte_size}.",
                parsed_range.start
            ));
        }
        if parsed_range.total < partial_byte_size {
            return Err(
                "AutoCut speech transcription model resume response reports a total smaller than the existing partial file."
                    .to_string(),
            );
        }
        return Ok((partial_byte_size, Some(parsed_range.total), true));
    }

    Ok((0, content_length, false))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AutoCutHttpContentRange {
    start: u64,
    end: u64,
    total: u64,
}

fn parse_autocut_http_content_range(value: &str) -> Result<AutoCutHttpContentRange, String> {
    let normalized = value.trim();
    let Some(range) = normalized.strip_prefix("bytes ") else {
        return Err(format!(
            "AutoCut speech transcription model Content-Range must use bytes units: {value}"
        ));
    };
    let Some((bounds, total_value)) = range.split_once('/') else {
        return Err(format!(
            "AutoCut speech transcription model Content-Range is malformed: {value}"
        ));
    };
    let Some((start_value, end_value)) = bounds.split_once('-') else {
        return Err(format!(
            "AutoCut speech transcription model Content-Range byte bounds are malformed: {value}"
        ));
    };
    let start = start_value.parse::<u64>().map_err(|error| {
        format!("parse AutoCut speech transcription model Content-Range start failed: {error}")
    })?;
    let end = end_value.parse::<u64>().map_err(|error| {
        format!("parse AutoCut speech transcription model Content-Range end failed: {error}")
    })?;
    let total = total_value.parse::<u64>().map_err(|error| {
        format!("parse AutoCut speech transcription model Content-Range total failed: {error}")
    })?;
    if end < start {
        return Err(format!(
            "AutoCut speech transcription model Content-Range end precedes start: {value}"
        ));
    }
    if total <= end {
        return Err(format!(
            "AutoCut speech transcription model Content-Range total is not larger than the end byte: {value}"
        ));
    }

    Ok(AutoCutHttpContentRange { start, end, total })
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
            "{label} SHA-256 checksum mismatch: expected {expected_sha256}, actual {digest}."
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

    let import_transfer_strategy =
        transfer_media_import_source_into_sandbox(&source_path, &sandbox_path)
            .map_err(|error| format!("import media source into AutoCut sandbox failed: {error}"))?;

    let sandbox_path = ensure_safe_media_path(&canonical_input_root, &sandbox_path)?;
    let metadata = fs::metadata(&sandbox_path)
        .map_err(|error| format!("read imported media metadata failed: {error}"))?;
    if metadata.len() == 0 {
        return Err("imported media file is empty".to_string());
    }

    let media_probe_evidence = probe_autocut_media_evidence(Some(toolchain), &sandbox_path);
    let stream_evidence = media_probe_evidence.stream_evidence();
    let media_type =
        resolve_media_type_from_stream_evidence(&source_extension, stream_evidence).to_string();
    let has_audio_stream = stream_evidence.has_audio_stream;
    let has_video_stream = stream_evidence.has_video_stream;
    let mime_type = media_mime_type(&source_extension, &media_type).to_string();
    let duration_ms = if media_type == "video" || media_type == "audio" {
        media_probe_evidence.duration_ms
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
                    "hasAudioStream": has_audio_stream,
                    "hasVideoStream": has_video_stream,
                    "durationMs": duration_ms,
                    "importTransferStrategy": format_autocut_media_import_transfer_strategy(import_transfer_strategy),
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
        has_audio_stream,
        has_video_stream,
        duration_ms,
    })
}

fn transfer_media_import_source_into_sandbox(
    source_path: &Path,
    sandbox_path: &Path,
) -> Result<AutoCutMediaImportTransferStrategy, String> {
    if sandbox_path.exists() {
        fs::remove_file(sandbox_path).map_err(|error| {
            format!("remove existing AutoCut sandbox import target failed before transfer: {error}")
        })?;
    }

    match fs::hard_link(source_path, sandbox_path) {
        Ok(()) => Ok(AutoCutMediaImportTransferStrategy::HardLink),
        Err(hard_link_error) => match fs::copy(source_path, sandbox_path) {
            Ok(_) => Ok(AutoCutMediaImportTransferStrategy::Copy),
            Err(copy_error) => Err(format!(
                "hard-link failed: {hard_link_error}; copy failed: {copy_error}"
            )),
        },
    }
}

fn format_autocut_media_import_transfer_strategy(
    strategy: AutoCutMediaImportTransferStrategy,
) -> &'static str {
    match strategy {
        AutoCutMediaImportTransferStrategy::HardLink => "hard-link",
        AutoCutMediaImportTransferStrategy::Copy => "copy",
    }
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
    let media_probe_evidence = probe_autocut_media_evidence(toolchain, &source_path);
    let stream_evidence = media_probe_evidence.stream_evidence();
    let media_type =
        resolve_media_type_from_stream_evidence(&source_extension, stream_evidence).to_string();
    let has_audio_stream = stream_evidence.has_audio_stream;
    let has_video_stream = stream_evidence.has_video_stream;
    let mime_type = media_mime_type(&source_extension, &media_type).to_string();
    let duration_ms = if media_type == "video" || media_type == "audio" {
        media_probe_evidence.duration_ms
    } else {
        None
    };

    Ok(AutoCutLocalMediaFileDescription {
        source_path: source_path.display().to_string(),
        byte_size: metadata.len(),
        name: source_name,
        media_type,
        mime_type,
        has_audio_stream,
        has_video_stream,
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

fn requested_autocut_media_streams_match_description(
    media_types: &[String],
    description: &AutoCutLocalMediaFileDescription,
) -> bool {
    media_types.iter().any(|media_type| {
        (media_type == "audio" && description.has_audio_stream)
            || (media_type == "video" && description.has_video_stream)
    })
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
    let quality = normalize_audio_quality(&request.output_quality)?;
    let channel = normalize_audio_channel(&request.output_channel)?;
    let task_uuid = autocut_task_uuid("audio")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "outputFormat": format.clone(),
            "outputQuality": quality.clone(),
            "outputChannel": channel.clone()
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
        &quality,
        &channel,
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
    let task_uuid = autocut_task_uuid("gif")?;
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
    app: Option<&AppHandle>,
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
    let apply_audio_noise_reduction = request.noise_reduction;
    let mut clips = normalize_video_slice_clips(&request.clips)?;
    clips.iter_mut().for_each(|clip| {
        if clip.audio_cleanup_profile.is_none() {
            clip.audio_cleanup_profile = Some(SMART_SLICE_AUDIO_CLEANUP_PROFILE.to_string());
        }
        clip.noise_reduction_applied = Some(apply_audio_noise_reduction);
        if clip.boundary_decision_source.is_none() {
            clip.boundary_decision_source = Some("transcript".to_string());
        }
        if clip.leading_silence_trim_ms.is_none() {
            clip.leading_silence_trim_ms = Some(0);
        }
        if clip.trailing_silence_trim_ms.is_none() {
            clip.trailing_silence_trim_ms = Some(0);
        }
        if clip.tail_treatment.is_none() {
            clip.tail_treatment = Some("none".to_string());
        }
    });
    let render_profile = normalize_video_slice_render_profile(request.render_profile)?;
    let subtitle_format =
        normalize_video_slice_subtitle_format(request.subtitle_format.as_deref())?;
    let subtitle_segments = normalize_video_slice_subtitle_segments(request.subtitle_segments);
    let subtitle_mode = normalize_video_slice_subtitle_mode(
        request.subtitle_mode.as_deref(),
        subtitle_format.as_deref(),
        !subtitle_segments.is_empty(),
    )?;
    let subtitle_style_id =
        normalize_video_slice_subtitle_style_id(request.subtitle_style_id.as_deref());
    let source_probe_evidence = probe_autocut_media_evidence(Some(toolchain), &input_path);
    let source_duration_ms = source_probe_evidence.duration_ms;
    let source_has_audio_stream = source_probe_evidence.has_audio_stream;
    let task_uuid = autocut_task_uuid("slice")?;
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
            "subtitleStyleId": subtitle_style_id,
            "subtitleSegments": subtitle_segments.clone()
        }),
    );
    if let Some(workflow_task_id) = normalize_path_text(request.workflow_task_id.as_deref()) {
        input_json["workflowTaskId"] = json!(workflow_task_id);
    }
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
            "workflowTaskId": request.workflow_task_id,
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
            "workflowTaskId": request.workflow_task_id,
            "stepId": "native-render",
            "message": "Native FFmpeg render command prepared.",
            "phase": "ffmpeg-command-prepared"
        }),
    )?;

    let slicing = run_ffmpeg_video_slices(
        app,
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &task_output_dir,
        &clips,
        &output_format,
        render_profile.as_ref(),
        apply_audio_noise_reduction,
        source_has_audio_stream,
        subtitle_format.as_deref(),
        subtitle_mode,
        subtitle_style_id.as_deref(),
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
                        duration_ms: video_slice_rendered_duration_ms(&slice_output.clip),
                        label: slice_output.clip.label.clone(),
                        source_start_ms: slice_output.clip.source_start_ms,
                        source_end_ms: slice_output.clip.source_end_ms,
                        speech_start_ms: slice_output.clip.speech_start_ms,
                        speech_end_ms: slice_output.clip.speech_end_ms,
                        boundary_padding_before_ms: slice_output.clip.boundary_padding_before_ms,
                        boundary_padding_after_ms: slice_output.clip.boundary_padding_after_ms,
                        audio_cleanup_profile: slice_output.clip.audio_cleanup_profile.clone(),
                        noise_reduction_applied: slice_output.clip.noise_reduction_applied,
                        boundary_decision_source: slice_output
                            .clip
                            .boundary_decision_source
                            .clone(),
                        audio_activity_start_ms: slice_output.clip.audio_activity_start_ms,
                        audio_activity_end_ms: slice_output.clip.audio_activity_end_ms,
                        audio_activity_confidence: slice_output.clip.audio_activity_confidence,
                        audio_activity_analysis_filter: slice_output
                            .clip
                            .audio_activity_analysis_filter
                            .clone(),
                        leading_silence_ms: slice_output.clip.leading_silence_ms,
                        trailing_silence_ms: slice_output.clip.trailing_silence_ms,
                        leading_silence_trim_ms: slice_output.clip.leading_silence_trim_ms,
                        trailing_silence_trim_ms: slice_output.clip.trailing_silence_trim_ms,
                        source_segments: slice_output.clip.source_segments.clone(),
                        rendered_duration_ms: Some(video_slice_rendered_duration_ms(
                            &slice_output.clip,
                        )),
                        removed_silence_ms: slice_output.clip.removed_silence_ms,
                        internal_silence_trim_count: slice_output.clip.internal_silence_trim_count,
                        tail_treatment: slice_output.clip.tail_treatment.clone(),
                        transcript_text: slice_output.clip.transcript_text.clone(),
                        transcript_segments: slice_output.clip.transcript_segments.clone(),
                        transcript_segment_count: slice_output.clip.transcript_segment_count,
                        transcript_coverage_score: slice_output.clip.transcript_coverage_score,
                        speech_continuity_grade: slice_output.clip.speech_continuity_grade.clone(),
                        risks: slice_output.clip.risks.clone(),
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

fn analyze_autocut_video_slice_audio_activity_in_root_with_toolchain(
    _app: Option<&AppHandle>,
    connection: &Connection,
    root: &Path,
    request: AutoCutVideoSliceAudioActivityAnalysisRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVideoSliceAudioActivityAnalysisResult, String> {
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

    if request.profile.trim() != SMART_SLICE_AUDIO_CLEANUP_PROFILE {
        return Err(format!(
            "AutoCut Smart Slice audio activity analysis requires profile {SMART_SLICE_AUDIO_CLEANUP_PROFILE}."
        ));
    }
    let _workflow_task_id = normalize_path_text(request.workflow_task_id.as_deref());
    let clips = normalize_video_slice_clips(&request.clips)?;
    let source_probe_evidence = probe_autocut_media_evidence(Some(toolchain), &input_path);
    let source_duration_ms = source_probe_evidence.duration_ms;
    let clips = adjust_video_slice_clips_for_source_duration(&clips, source_duration_ms)?;
    let source_has_audio_stream = source_probe_evidence.has_audio_stream;
    if !source_has_audio_stream {
        return Err(
            "AutoCut Smart Slice audio activity analysis requires a source audio stream."
                .to_string(),
        );
    }

    let analyses = clips
        .iter()
        .enumerate()
        .map(|(index, clip)| {
            run_ffmpeg_video_slice_audio_activity_analysis(
                toolchain,
                &input_path,
                clip,
                index,
                request.apply_noise_reduction,
            )
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(AutoCutVideoSliceAudioActivityAnalysisResult {
        asset_uuid: asset.uuid,
        profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE.to_string(),
        analyses,
    })
}

fn transcribe_autocut_media_from_asset_in_root_with_toolchain(
    app: Option<&AppHandle>,
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
    let task_uuid = autocut_task_uuid("text")?;
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
    let execution_options = normalize_speech_transcription_execution_options(&request)?;
    if let Some(stt_preset_id) = execution_options.stt_preset_id.as_deref() {
        input_json["sttPresetId"] = json!(stt_preset_id);
    }
    if let Some(execution_profile) = execution_options.execution_profile.as_deref() {
        input_json["sttExecutionProfile"] = json!(execution_profile);
    }
    if let Some(whisper_chunk_parallelism) = execution_options.whisper_chunk_parallelism {
        input_json["whisperChunkParallelism"] = json!(whisper_chunk_parallelism);
    }
    if let Some(whisper_chunk_thread_count) = execution_options.whisper_chunk_thread_count {
        input_json["whisperChunkThreadCount"] = json!(whisper_chunk_thread_count);
    }
    input_json["whisperChunkSourceStrategy"] =
        json!(execution_options.chunk_source_strategy.as_manifest_value());
    if let Some(whisper_audio_context) = execution_options.whisper_audio_context {
        input_json["whisperAudioContext"] = json!(whisper_audio_context);
    }
    if let Some(whisper_beam_size) = execution_options.whisper_beam_size {
        input_json["whisperBeamSize"] = json!(whisper_beam_size);
    }
    if let Some(whisper_best_of) = execution_options.whisper_best_of {
        input_json["whisperBestOf"] = json!(whisper_best_of);
    }
    if execution_options.whisper_no_fallback {
        input_json["whisperNoFallback"] = json!(true);
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
    if let Some(workflow_task_id) = normalize_path_text(request.workflow_task_id.as_deref()) {
        input_json["workflowTaskId"] = json!(workflow_task_id);
    }
    if request.dedupe_repeated_speech {
        input_json["dedupeRepeatedSpeech"] = json!(true);
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
            "workflowTaskId": request.workflow_task_id,
            "language": language.clone(),
            "sttPresetId": execution_options.stt_preset_id.as_deref(),
            "executionProfile": execution_options.execution_profile.as_deref(),
            "whisperChunkParallelism": execution_options.whisper_chunk_parallelism,
            "whisperChunkThreadCount": execution_options.whisper_chunk_thread_count,
            "whisperChunkSourceStrategy": execution_options.chunk_source_strategy.as_manifest_value(),
            "whisperAudioContext": execution_options.whisper_audio_context,
            "whisperBeamSize": execution_options.whisper_beam_size,
            "whisperBestOf": execution_options.whisper_best_of,
            "whisperNoFallback": execution_options.whisper_no_fallback
        })
        .to_string(),
    )?;
    record_ops_task_progress_for_app(
        app,
        connection,
        &task_uuid,
        1,
        json!({
            "assetUuid": asset.uuid,
            "operation": spec.operation,
            "workflowTaskId": request.workflow_task_id,
            "stepId": "speech-to-text",
            "message": "Native speech-to-text task prepared.",
            "phase": "speech-transcription-prepared",
            "sttPresetId": execution_options.stt_preset_id.as_deref(),
            "executionProfile": execution_options.execution_profile.as_deref(),
            "whisperChunkSourceStrategy": execution_options.chunk_source_strategy.as_manifest_value(),
            "whisperAudioContext": execution_options.whisper_audio_context,
            "whisperBeamSize": execution_options.whisper_beam_size,
            "whisperBestOf": execution_options.whisper_best_of,
            "whisperNoFallback": execution_options.whisper_no_fallback
        }),
    )?;

    let transcription = run_local_speech_transcription(
        app,
        connection,
        &task_uuid,
        ffmpeg_toolchain,
        speech_toolchain,
        &input_path,
        &task_output_dir,
        &language,
        &worker_lease,
        &execution_options,
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
                    "segmentCount": result.segments.len(),
                    "sttPresetId": result.stt_preset_id.as_deref(),
                    "executionProfile": result.execution_profile.as_deref(),
                    "qualityGuard": result.quality_guard
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
                stt_preset_id: result.stt_preset_id,
                execution_profile: result.execution_profile,
                segments: result.segments,
                text: result.text,
                quality_guard: result.quality_guard,
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

fn extract_autocut_visual_evidence_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutVisualEvidenceExtractionRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutVisualEvidenceExtractionResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let (asset, input_path) =
        resolve_visual_evidence_input_asset(connection, &root, &request, toolchain)?;
    let profile = normalize_visual_evidence_profile(&request.visual_evidence_profile)?;
    ensure_visual_evidence_threshold(request.scene_change_threshold)?;
    ensure_visual_evidence_min_shot_duration(request.min_shot_duration_ms)?;
    let workflow_task_id = normalize_path_text(request.workflow_task_id.as_deref());
    let include_frame_quality = request.include_frame_quality.unwrap_or(false);
    let include_frame_fingerprint = request.include_frame_fingerprint.unwrap_or(false);
    let scene_change_threshold = request.scene_change_threshold.unwrap_or(0.28);
    let min_shot_duration_ms = request.min_shot_duration_ms.unwrap_or(300);
    let task_uuid = autocut_task_uuid("visual-evidence")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let evidence_path = task_output_dir.join("visual-evidence.json");
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "operation": "visualEvidenceExtraction",
            "workflowTaskId": workflow_task_id,
            "visualEvidenceProfile": profile.clone(),
            "sceneChangeThreshold": scene_change_threshold,
            "minShotDurationMs": min_shot_duration_ms,
            "includeFrameQuality": include_frame_quality,
            "includeFrameFingerprint": include_frame_fingerprint,
            "provider": "ffmpeg-scene"
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "visualEvidenceExtraction",
        task_type: OPS_TASK_TYPE_VISUAL_EVIDENCE,
        stage_type: OPS_STAGE_TYPE_VISUAL_EVIDENCE,
        artifact_type: MEDIA_ARTIFACT_TYPE_VISUAL_EVIDENCE,
        artifact_name_suffix: "visual-evidence.json".to_string(),
        mime_type: "application/json",
        input_json,
        failure_error_code: "FFMPEG_VISUAL_EVIDENCE_FAILED",
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
            "provider": "ffmpeg-scene",
            "profile": profile.clone()
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
            "phase": "ffmpeg-scene-command-prepared",
            "provider": "ffmpeg-scene"
        }),
    )?;

    let extraction = run_ffmpeg_visual_evidence_extraction(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &profile,
        scene_change_threshold,
        min_shot_duration_ms,
        include_frame_quality,
        include_frame_fingerprint,
        &worker_lease,
    );
    match extraction {
        Ok(mut result) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            result.task_uuid = task_uuid.clone();
            result.source_asset_uuid = asset.uuid.clone();
            fs::write(
                &evidence_path,
                serde_json::to_vec_pretty(&result).map_err(|error| {
                    format!("serialize AutoCut visual evidence failed: {error}")
                })?,
            )
            .map_err(|error| format!("write AutoCut visual evidence artifact failed: {error}"))?;
            let byte_size = fs::metadata(&evidence_path)
                .map_err(|error| {
                    format!("read AutoCut visual evidence artifact metadata failed: {error}")
                })?
                .len();
            let operation_output = AutoCutMediaOperationOutput {
                artifact_path: evidence_path.display().to_string(),
                task_output_dir: task_output_dir.display().to_string(),
                byte_size,
                format: "json".to_string(),
                ffmpeg_executable: toolchain.executable.clone(),
            };
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_visual_evidence_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
                &result,
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
                    "provider": result.provider,
                    "profile": result.profile,
                    "shotCount": result.shots.len(),
                    "sceneBoundaryCount": result.scene_boundaries.len()
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(result)
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

fn resolve_visual_evidence_input_asset(
    connection: &Connection,
    root: &Path,
    request: &AutoCutVisualEvidenceExtractionRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<(AutoCutRegisteredMediaAsset, PathBuf), String> {
    if let Some(source_path) = request
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let input_path = ensure_safe_import_source_path(Path::new(source_path))?;
        let stream_evidence = probe_autocut_media_stream_evidence(Some(toolchain), &input_path);
        if !stream_evidence.has_video_stream {
            return Err(
                "AutoCut visual evidence extraction requires source media with a video stream."
                    .to_string(),
            );
        }
        let asset_uuid = request.asset_uuid.trim();
        if asset_uuid.is_empty() {
            return Err(
                "assetUuid is required for AutoCut native visual evidence extraction".to_string(),
            );
        }
        let source_name = input_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| "source-video".to_string());
        return Ok((
            AutoCutRegisteredMediaAsset {
                uuid: asset_uuid.to_string(),
                name: source_name,
                source_uri: input_path.display().to_string(),
                has_video_stream: true,
            },
            input_path,
        ));
    }

    let asset = read_media_asset(connection, &request.asset_uuid)?;
    if !asset.has_video_stream {
        return Err(
            "AutoCut visual evidence extraction requires source media with a video stream."
                .to_string(),
        );
    }
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

    Ok((asset, input_path))
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
    let task_uuid = autocut_task_uuid("compress")?;
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
    let task_uuid = autocut_task_uuid("convert")?;
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
    let task_uuid = autocut_task_uuid("enhance")?;
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
    let smoke_task_uuid = autocut_task_uuid("smoke")?;
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

fn extract_autocut_audio_fingerprint_in_root_with_toolchain(
    connection: &Connection,
    root: &Path,
    request: AutoCutAudioFingerprintRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<AutoCutAudioFingerprintResult, String> {
    let root = resolve_autocut_request_media_root(root, request.output_root_dir.as_deref())?;
    let (asset, input_path) =
        resolve_audio_fingerprint_input_asset(connection, &root, &request, toolchain)?;
    let profile = normalize_audio_fingerprint_profile(&request.fingerprint_profile)?;
    let sample_rate_hz = normalize_audio_fingerprint_sample_rate_hz(request.sample_rate_hz)?;
    let window_duration_ms =
        normalize_audio_fingerprint_window_duration_ms(request.window_duration_ms)?;
    let workflow_task_id = normalize_path_text(request.workflow_task_id.as_deref());
    let task_uuid = autocut_task_uuid("audio-fingerprint")?;
    let artifact_uuid = autocut_uuid("media-artifact")?;
    let task_output_dir = autocut_task_output_dir(&root, &task_uuid)?;
    let fingerprint_path = task_output_dir.join("audio-fingerprint.json");
    let output_root_dir =
        autocut_operation_output_root_dir_payload(&root, request.output_root_dir.as_deref());
    let mut input_json = create_autocut_task_input_json(
        &asset,
        json!({
            "operation": "audioFingerprintExtraction",
            "sourcePath": request.source_path.as_deref().map(str::trim).filter(|value| !value.is_empty()),
            "workflowTaskId": workflow_task_id,
            "fingerprintProfile": profile.clone(),
            "sampleRateHz": sample_rate_hz,
            "windowDurationMs": window_duration_ms,
            "provider": "ffmpeg-audio"
        }),
    );
    insert_autocut_output_root_dir_payload(&mut input_json, output_root_dir.as_deref());
    let spec = AutoCutMediaOperationSpec {
        operation: "audioFingerprintExtraction",
        task_type: OPS_TASK_TYPE_AUDIO_FINGERPRINT,
        stage_type: OPS_STAGE_TYPE_AUDIO_FINGERPRINT,
        artifact_type: MEDIA_ARTIFACT_TYPE_AUDIO_FINGERPRINT,
        artifact_name_suffix: "audio-fingerprint.json".to_string(),
        mime_type: "application/json",
        input_json,
        failure_error_code: "FFMPEG_AUDIO_FINGERPRINT_FAILED",
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
            "provider": "ffmpeg-audio",
            "profile": profile.clone()
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
            "phase": "ffmpeg-audio-fingerprint-command-prepared",
            "provider": "ffmpeg-audio"
        }),
    )?;

    let extraction = run_ffmpeg_audio_fingerprint_extraction(
        connection,
        &task_uuid,
        toolchain,
        &input_path,
        &profile,
        sample_rate_hz,
        window_duration_ms,
        &worker_lease,
    );
    match extraction {
        Ok(mut result) => {
            if finish_canceled_operation_if_requested(connection, &task_uuid, &asset, &spec)? {
                release_ops_worker_lease(connection, &worker_lease, "canceled")?;
                return Err("AutoCut native task was canceled by user request".to_string());
            }
            result.task_uuid = task_uuid.clone();
            result.source_asset_uuid = asset.uuid.clone();
            fs::write(
                &fingerprint_path,
                serde_json::to_vec_pretty(&result).map_err(|error| {
                    format!("serialize AutoCut audio fingerprint failed: {error}")
                })?,
            )
            .map_err(|error| format!("write AutoCut audio fingerprint artifact failed: {error}"))?;
            let byte_size = fs::metadata(&fingerprint_path)
                .map_err(|error| {
                    format!("read AutoCut audio fingerprint artifact metadata failed: {error}")
                })?
                .len();
            let operation_output = AutoCutMediaOperationOutput {
                artifact_path: fingerprint_path.display().to_string(),
                task_output_dir: task_output_dir.display().to_string(),
                byte_size,
                format: "json".to_string(),
                ffmpeg_executable: toolchain.executable.clone(),
            };
            insert_ops_stage_run(connection, &task_uuid, &spec, OPS_STATUS_COMPLETED, None)?;
            complete_ops_audio_fingerprint_task(
                connection,
                &task_uuid,
                &asset.uuid,
                &artifact_uuid,
                &operation_output,
                &result,
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
                    "provider": result.provider,
                    "profile": result.profile,
                    "durationMs": result.duration_ms,
                    "energyBucketCount": result.fingerprint.energy_buckets.len()
                })
                .to_string(),
            )?;
            release_ops_worker_lease(connection, &worker_lease, "completed")?;

            Ok(result)
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

fn resolve_audio_fingerprint_input_asset(
    connection: &Connection,
    root: &Path,
    request: &AutoCutAudioFingerprintRequest,
    toolchain: &AutoCutFfmpegToolchain,
) -> Result<(AutoCutRegisteredMediaAsset, PathBuf), String> {
    if let Some(source_path) = request
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let input_path = ensure_safe_import_source_path(Path::new(source_path))?;
        let stream_evidence = probe_autocut_media_stream_evidence(Some(toolchain), &input_path);
        if !stream_evidence.has_audio_stream {
            return Err(
                "AutoCut audio fingerprint extraction requires source media with an audio stream."
                    .to_string(),
            );
        }
        let asset_uuid = request.asset_uuid.trim();
        if asset_uuid.is_empty() {
            return Err(
                "assetUuid is required for AutoCut native audio fingerprint extraction".to_string(),
            );
        }
        let source_name = input_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| "source-audio".to_string());
        return Ok((
            AutoCutRegisteredMediaAsset {
                uuid: asset_uuid.to_string(),
                name: source_name,
                source_uri: input_path.display().to_string(),
                has_video_stream: stream_evidence.has_video_stream,
            },
            input_path,
        ));
    }

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
    if !ffmpeg_media_has_audio_stream(toolchain, &input_path) {
        return Err(
            "AutoCut audio fingerprint extraction requires source media with an audio stream."
                .to_string(),
        );
    }

    Ok((asset, input_path))
}

fn run_ffmpeg_sine_smoke(
    toolchain: &AutoCutFfmpegToolchain,
    output_path: &Path,
) -> Result<AutoCutAudioExtractionResult, String> {
    let output = new_autocut_hidden_child_command(&toolchain.executable)
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
    mut on_poll: impl FnMut(Option<i64>) -> Result<(), String>,
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

fn append_whisper_progress_output_args(command: &mut Command) {
    command.arg("-pp");
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
    on_poll: &mut impl FnMut(Option<i64>) -> Result<(), String>,
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
    let (pipe_event_sender, pipe_event_receiver) = mpsc::channel::<AutoCutNativeMediaPipeEvent>();
    let stderr_pipe_event_sender = pipe_event_sender.clone();
    let stdout_reader = thread::spawn(move || read_child_pipe_by_line(&mut stdout, |_| {}));
    let stderr_reader = thread::spawn(move || {
        read_child_pipe_by_line(&mut stderr, move |line| {
            if let Some(progress) = parse_whisper_progress_percent(line) {
                let _ = stderr_pipe_event_sender
                    .send(AutoCutNativeMediaPipeEvent::WhisperProgress(progress));
            }
        })
    });
    let mut throttled_poll = AutoCutThrottledPoll::new(NATIVE_MEDIA_POLL_HEARTBEAT_INTERVAL);
    let mut native_progress_state = AutoCutNativeMediaProgressState::default();

    let status = loop {
        if let Err(error) = drain_native_media_progress_updates(
            &pipe_event_receiver,
            &mut native_progress_state,
            on_poll,
        ) {
            return Err(stop_and_join_tracked_native_media_child_after_error(
                tracked_child,
                stdout_reader,
                stderr_reader,
                "native media progress callback failure",
                error,
            ));
        }
        if let Err(error) = throttled_poll.run_if_due(&mut || on_poll(None)) {
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
    if let Err(error) = drain_native_media_progress_updates(
        &pipe_event_receiver,
        &mut native_progress_state,
        on_poll,
    ) {
        return Err(stop_and_join_tracked_native_media_child_after_error(
            tracked_child,
            stdout_reader,
            stderr_reader,
            "native media final progress callback failure",
            error,
        ));
    }
    if let Err(error) = throttled_poll.run_now(&mut || on_poll(None)) {
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
    drain_native_media_progress_updates(&pipe_event_receiver, &mut native_progress_state, on_poll)?;

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

#[derive(Debug, Default)]
struct AutoCutNativeMediaProgressState {
    last_whisper_progress: Option<i64>,
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

fn stop_and_join_tracked_native_media_child_after_pipe_error(
    tracked_child: &Arc<Mutex<Child>>,
    stderr_reader: thread::JoinHandle<Result<Vec<u8>, String>>,
    reason: &str,
    original_error: String,
) -> String {
    let cleanup_errors = [
        stop_tracked_native_media_child(tracked_child, reason).err(),
        join_child_pipe_reader(stderr_reader, "AutoCut audio fingerprint stderr").err(),
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

fn drain_native_media_progress_updates(
    pipe_event_receiver: &mpsc::Receiver<AutoCutNativeMediaPipeEvent>,
    progress_state: &mut AutoCutNativeMediaProgressState,
    on_poll: &mut impl FnMut(Option<i64>) -> Result<(), String>,
) -> Result<(), String> {
    loop {
        match pipe_event_receiver.try_recv() {
            Ok(AutoCutNativeMediaPipeEvent::WhisperProgress(progress)) => {
                if progress_state
                    .last_whisper_progress
                    .map(|last_progress| progress > last_progress)
                    .unwrap_or(true)
                {
                    progress_state.last_whisper_progress = Some(progress);
                    on_poll(Some(progress))?;
                }
            }
            Err(mpsc::TryRecvError::Empty) => return Ok(()),
            Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
        }
    }
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

fn parse_whisper_progress_percent(progress_line: &str) -> Option<i64> {
    let normalized_line = progress_line.trim();
    let progress_marker_index = normalized_line.rfind("progress =")?;
    let progress_value = normalized_line[progress_marker_index + "progress =".len()..]
        .trim()
        .strip_suffix('%')?
        .trim();
    let parsed_progress = progress_value.parse::<i64>().ok()?;
    if (0..=100).contains(&parsed_progress) {
        Some(parsed_progress)
    } else {
        None
    }
}

fn run_ffmpeg_audio_extract(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    format: &str,
    quality: &str,
    channel: &str,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutAudioExtractionResult, String> {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args(["-vn"]);
    match channel {
        "mono" => {
            command.args(["-ac", "1"]);
        }
        "stereo" => {
            command.args(["-ac", "2"]);
        }
        "smart-stereo" => {
            command.args(["-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "2"]);
        }
        _ => return Err(format!("unsupported normalized audio channel '{channel}'")),
    }

    match format {
        "mp3" => {
            let bitrate = format!("{quality}k");
            command.args(["-acodec", "libmp3lame", "-b:a", bitrate.as_str()]);
        }
        "wav" => {
            command.args(["-acodec", "pcm_s16le"]);
        }
        "flac" => {
            command.args([
                "-acodec",
                "flac",
                "-compression_level",
                flac_compression_level_for_quality(quality),
            ]);
        }
        "aac" => {
            let bitrate = format!("{quality}k");
            command.args(["-acodec", "aac", "-b:a", bitrate.as_str()]);
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
            record_ffmpeg_streaming_progress(
                None,
                connection,
                task_uuid,
                progress,
                "audioExtraction",
            )
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

fn run_ffmpeg_audio_fingerprint_extraction(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    profile: &str,
    sample_rate_hz: i64,
    window_duration_ms: i64,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutAudioFingerprintResult, String> {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args([
        "-vn",
        "-ac",
        "1",
        "-ar",
        sample_rate_hz.to_string().as_str(),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "pipe:1",
    ]);
    let tracked_child = spawn_tracked_native_media_command(
        task_uuid,
        &mut command,
        "audio fingerprint extraction",
    )?;
    let mut accumulator =
        AutoCutAudioFingerprintAccumulator::new(sample_rate_hz, window_duration_ms)?;
    let output =
        wait_for_tracked_audio_fingerprint_output(&tracked_child, &mut accumulator, &mut || {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            Ok(())
        });
    let cleanup = remove_tracked_native_media_process(task_uuid);
    let output = match (output, cleanup) {
        (Ok(output), Ok(())) => output,
        (Ok(_), Err(cleanup_error)) => return Err(cleanup_error),
        (Err(error), Ok(())) => return Err(error),
        (Err(error), Err(cleanup_error)) => {
            return Err(append_cleanup_diagnostics(error, [cleanup_error]));
        }
    };
    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg audio fingerprint extraction failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
    record_ffmpeg_streaming_progress(
        None,
        connection,
        task_uuid,
        70,
        "audioFingerprintExtraction",
    )?;
    build_audio_fingerprint_result_from_windows(
        accumulator.finish(),
        profile,
        sample_rate_hz,
        window_duration_ms,
    )
}

fn wait_for_tracked_audio_fingerprint_output(
    tracked_child: &Arc<Mutex<Child>>,
    accumulator: &mut AutoCutAudioFingerprintAccumulator,
    on_pcm_chunk: &mut impl FnMut() -> Result<(), String>,
) -> Result<Output, String> {
    let (stdout, mut stderr) = {
        let mut child = tracked_child.lock().map_err(|error| {
            format!("lock AutoCut audio fingerprint process pipes failed: {error}")
        })?;
        (child.stdout.take(), child.stderr.take())
    };
    let stderr_reader = thread::spawn(move || read_child_pipe_by_line(&mut stderr, |_| {}));
    let mut stdout = match stdout {
        Some(stdout) => stdout,
        None => {
            return Err(stop_and_join_tracked_native_media_child_after_pipe_error(
                tracked_child,
                stderr_reader,
                "audio fingerprint stdout capture failure",
                "AutoCut audio fingerprint extraction failed to capture FFmpeg PCM stdout"
                    .to_string(),
            ));
        }
    };
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes_read = match stdout.read(&mut buffer) {
            Ok(bytes_read) => bytes_read,
            Err(error) => {
                return Err(stop_and_join_tracked_native_media_child_after_pipe_error(
                    tracked_child,
                    stderr_reader,
                    "audio fingerprint PCM read failure",
                    format!("read AutoCut FFmpeg audio fingerprint PCM stream failed: {error}"),
                ));
            }
        };
        if bytes_read == 0 {
            break;
        }
        accumulator.push_bytes(&buffer[..bytes_read]);
        if let Err(error) = on_pcm_chunk() {
            return Err(stop_and_join_tracked_native_media_child_after_pipe_error(
                tracked_child,
                stderr_reader,
                "audio fingerprint PCM callback failure",
                error,
            ));
        }
    }

    let status = match tracked_child.lock() {
        Ok(mut child) => child.wait().map_err(|error| {
            format!("wait AutoCut FFmpeg audio fingerprint extraction failed: {error}")
        }),
        Err(error) => Err(format!(
            "lock AutoCut audio fingerprint process wait failed: {error}"
        )),
    };
    let status = match status {
        Ok(status) => status,
        Err(error) => {
            let stderr_cleanup =
                join_child_pipe_reader(stderr_reader, "AutoCut audio fingerprint stderr").err();
            return Err(append_cleanup_diagnostics(
                error,
                stderr_cleanup.into_iter(),
            ));
        }
    };
    let stderr = join_child_pipe_reader(stderr_reader, "AutoCut audio fingerprint stderr")?;

    Ok(Output {
        status,
        stdout: Vec::new(),
        stderr,
    })
}

impl AutoCutAudioFingerprintAccumulator {
    fn new(sample_rate_hz: i64, window_duration_ms: i64) -> Result<Self, String> {
        if sample_rate_hz <= 0 || window_duration_ms <= 0 {
            return Err(
                "AutoCut audio fingerprint requires positive sample rate and window duration"
                    .to_string(),
            );
        }
        let samples_per_window = ((sample_rate_hz as f64) * (window_duration_ms as f64 / 1000.0))
            .round()
            .max(1.0) as usize;
        Ok(Self {
            samples_per_window,
            total_samples: 0,
            current_window_samples: 0,
            current_sum_squares: 0.0,
            current_zero_crossings: 0,
            current_previous_sample: None,
            pending_byte: None,
            rms_windows: Vec::new(),
            zcr_windows: Vec::new(),
        })
    }

    fn push_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if let Some(previous_byte) = self.pending_byte.take() {
                let sample = i16::from_le_bytes([previous_byte, *byte]) as f64 / i16::MAX as f64;
                self.push_sample(sample);
            } else {
                self.pending_byte = Some(*byte);
            }
        }
    }

    fn push_sample(&mut self, sample: f64) {
        if let Some(previous) = self.current_previous_sample {
            if (previous < 0.0 && sample >= 0.0) || (previous >= 0.0 && sample < 0.0) {
                self.current_zero_crossings += 1;
            }
        }
        self.current_previous_sample = Some(sample);
        self.current_sum_squares += sample * sample;
        self.current_window_samples += 1;
        self.total_samples += 1;
        if self.current_window_samples >= self.samples_per_window {
            self.flush_window();
        }
    }

    fn flush_window(&mut self) {
        if self.current_window_samples == 0 {
            return;
        }

        let rms = (self.current_sum_squares / self.current_window_samples as f64).sqrt();
        let zcr_denominator = self.current_window_samples.saturating_sub(1).max(1);
        let zcr = self.current_zero_crossings as f64 / zcr_denominator as f64;
        self.rms_windows.push(rms);
        self.zcr_windows.push(zcr);
        self.current_window_samples = 0;
        self.current_sum_squares = 0.0;
        self.current_zero_crossings = 0;
        self.current_previous_sample = None;
    }

    fn finish(mut self) -> (usize, Vec<f64>, Vec<f64>) {
        self.pending_byte = None;
        self.flush_window();
        (self.total_samples, self.rms_windows, self.zcr_windows)
    }
}

fn build_audio_fingerprint_result_from_windows(
    windows: (usize, Vec<f64>, Vec<f64>),
    profile: &str,
    sample_rate_hz: i64,
    window_duration_ms: i64,
) -> Result<AutoCutAudioFingerprintResult, String> {
    let (sample_count, rms_windows, zcr_windows) = windows;
    if sample_count == 0 {
        return Err("AutoCut audio fingerprint decoded no PCM samples".to_string());
    }

    if rms_windows.is_empty() {
        return Err("AutoCut audio fingerprint produced no analysis windows".to_string());
    }

    let max_rms = rms_windows
        .iter()
        .copied()
        .fold(0.0_f64, f64::max)
        .max(0.000_001);
    let energy_buckets = rms_windows
        .iter()
        .map(|rms| ((rms / max_rms).clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect::<Vec<_>>();
    let spectral_centroid_buckets = zcr_windows
        .iter()
        .map(|zcr| (zcr.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect::<Vec<_>>();
    let silence_threshold = max_rms * 0.08;
    let silent_count = rms_windows
        .iter()
        .filter(|rms| **rms <= silence_threshold)
        .count();
    let silence_ratio = silent_count as f64 / rms_windows.len() as f64;
    let duration_ms = ((sample_count as f64 / sample_rate_hz as f64) * 1000.0).round() as i64;
    let hash = create_audio_fingerprint_hash(
        profile,
        sample_rate_hz,
        window_duration_ms,
        duration_ms,
        &energy_buckets,
        &spectral_centroid_buckets,
        silence_ratio,
    );

    Ok(AutoCutAudioFingerprintResult {
        task_uuid: String::new(),
        source_asset_uuid: String::new(),
        provider: "ffmpeg-audio".to_string(),
        profile: profile.to_string(),
        ready: true,
        duration_ms,
        sample_rate_hz,
        window_duration_ms,
        fingerprint: AutoCutAudioFingerprintPayload {
            algorithm: "audio-energy-v1".to_string(),
            hash,
            energy_buckets,
            silence_ratio: round_unit_f64(silence_ratio),
            spectral_centroid_buckets: Some(spectral_centroid_buckets),
        },
        diagnostics: vec![format!(
            "ffmpeg-audio provider sampleRateHz={sample_rate_hz} windowDurationMs={window_duration_ms} windowCount={} streaming=true",
            rms_windows.len()
        )],
    })
}

fn create_audio_fingerprint_hash(
    profile: &str,
    sample_rate_hz: i64,
    window_duration_ms: i64,
    duration_ms: i64,
    energy_buckets: &[u8],
    spectral_centroid_buckets: &[u8],
    silence_ratio: f64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(profile.as_bytes());
    hasher.update(sample_rate_hz.to_le_bytes());
    hasher.update(window_duration_ms.to_le_bytes());
    hasher.update((duration_ms / 250).to_le_bytes());
    hasher.update(((silence_ratio * 100.0).round() as i64).to_le_bytes());
    hasher.update(energy_buckets);
    hasher.update(spectral_centroid_buckets);
    format!("{:x}", hasher.finalize())
}

fn round_unit_f64(value: f64) -> f64 {
    ((value.clamp(0.0, 1.0) * 1000.0).round()) / 1000.0
}

fn run_ffmpeg_speech_audio_extract(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<(), String> {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
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
                app,
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

fn extract_local_whisper_standard_audio(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    task_output_dir: &Path,
    worker_lease: &AutoCutOpsWorkerLease,
    progress_start: i64,
    progress_done: i64,
) -> Result<PathBuf, String> {
    let audio_path =
        task_output_dir.join(format!("speech-audio-{}.wav", monotonic_artifact_suffix()?));
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        progress_start,
        json!({
            "operation": "speechTranscription",
            "stepId": "extract-audio",
            "phase": "speech-audio-extracting",
            "speechSourceKind": AutoCutSpeechChunkAudioSourceKind::ExtractedWav.as_manifest_value(),
            "message": "Extracting 16 kHz mono speech audio for local transcription."
        }),
    )?;
    run_ffmpeg_speech_audio_extract(
        app,
        connection,
        task_uuid,
        ffmpeg_toolchain,
        input_path,
        &audio_path,
        worker_lease,
    )?;
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        progress_done,
        json!({
            "operation": "speechTranscription",
            "stepId": "extract-audio",
            "phase": "speech-audio-extracted",
            "speechSourceKind": AutoCutSpeechChunkAudioSourceKind::ExtractedWav.as_manifest_value(),
            "message": "Speech audio extracted and ready for transcription."
        }),
    )?;
    Ok(audio_path)
}

fn run_local_speech_transcription(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    speech_toolchain: &AutoCutSpeechToolchain,
    input_path: &Path,
    task_output_dir: &Path,
    language: &str,
    worker_lease: &AutoCutOpsWorkerLease,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<AutoCutSpeechTranscriptionResult, String> {
    if !speech_toolchain.ready {
        return Err(format!(
            "AutoCut local speech transcription toolchain is not configured: {}",
            speech_toolchain.diagnostics.join("; ")
        ));
    }

    let source_duration_ms = read_ffmpeg_media_duration_millis(ffmpeg_toolchain, input_path)?;
    let (transcript_path, transcript_source_path) = if should_use_chunked_local_speech_transcription(
        source_duration_ms,
    ) {
        let (speech_source_path, speech_source_kind, speech_duration_ms) = match execution_options
            .chunk_source_strategy
        {
            AutoCutSpeechChunkSourceStrategy::AudioFirst => {
                record_ops_task_progress_for_app(
                    app,
                    connection,
                    task_uuid,
                    10,
                    json!({
                        "operation": "speechTranscription",
                        "stepId": "extract-audio",
                        "phase": "chunked-speech-audio-extracting",
                        "sourceKind": speech_toolchain.source_kind,
                        "speechSourceKind": AutoCutSpeechChunkAudioSourceKind::ExtractedWav.as_manifest_value(),
                        "sourceDurationMs": source_duration_ms,
                        "chunkSourceStrategy": execution_options.chunk_source_strategy.as_manifest_value(),
                        "message": "Long media detected. Extracting reusable speech audio before chunked local transcription."
                    }),
                )?;
                let audio_path = extract_local_whisper_standard_audio(
                    app,
                    connection,
                    task_uuid,
                    ffmpeg_toolchain,
                    input_path,
                    task_output_dir,
                    worker_lease,
                    12,
                    35,
                )?;
                let audio_duration_ms =
                    read_ffmpeg_media_duration_millis(ffmpeg_toolchain, &audio_path)?;
                (
                    audio_path,
                    AutoCutSpeechChunkAudioSourceKind::ExtractedWav,
                    audio_duration_ms,
                )
            }
            AutoCutSpeechChunkSourceStrategy::SourceDirect => {
                record_ops_task_progress_for_app(
                    app,
                    connection,
                    task_uuid,
                    10,
                    json!({
                        "operation": "speechTranscription",
                        "stepId": "speech-to-text",
                        "phase": "source-media-direct-chunking",
                        "sourceKind": speech_toolchain.source_kind,
                        "speechSourceKind": AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect.as_manifest_value(),
                        "sourceDurationMs": source_duration_ms,
                        "chunkSourceStrategy": execution_options.chunk_source_strategy.as_manifest_value(),
                        "message": "Long media detected. Using source-media chunking for local transcription."
                    }),
                )?;
                (
                    input_path.to_path_buf(),
                    AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect,
                    source_duration_ms,
                )
            }
        };
        record_ops_task_progress_for_app(
            app,
            connection,
            task_uuid,
            40,
            json!({
                    "operation": "speechTranscription",
                    "stepId": "speech-to-text",
                    "phase": "local-whisper-chunk-plan-ready",
                    "sourceKind": speech_toolchain.source_kind,
                    "speechSourceKind": speech_source_kind.as_manifest_value(),
                    "sourceDurationMs": source_duration_ms,
                "audioDurationMs": speech_duration_ms,
                "chunkSourceStrategy": execution_options.chunk_source_strategy.as_manifest_value(),
                "whisperAudioContext": execution_options.whisper_audio_context,
                "whisperBeamSize": execution_options.whisper_beam_size,
                "whisperBestOf": execution_options.whisper_best_of,
                "whisperNoFallback": execution_options.whisper_no_fallback,
                "message": "Preparing chunked local transcription."
            }),
        )?;
        let transcript_path = run_chunked_local_whisper_transcription(
            app,
            connection,
            task_uuid,
            ffmpeg_toolchain,
            speech_toolchain,
            &speech_source_path,
            speech_source_kind,
            task_output_dir,
            language,
            speech_duration_ms,
            worker_lease,
            execution_options,
        )?;
        (transcript_path, speech_source_path)
    } else {
        let audio_path = extract_local_whisper_standard_audio(
            app,
            connection,
            task_uuid,
            ffmpeg_toolchain,
            input_path,
            task_output_dir,
            worker_lease,
            10,
            40,
        )?;
        let transcript_stem = task_output_dir.join(format!(
            "speech-transcript-{}",
            monotonic_artifact_suffix()?
        ));
        let transcript_path = run_local_whisper_transcription(
            app,
            connection,
            task_uuid,
            speech_toolchain,
            &audio_path,
            &transcript_stem,
            language,
            worker_lease,
            execution_options,
        )?;
        (transcript_path, audio_path)
    };
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        80,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "transcript-parsing",
            "sourceKind": speech_toolchain.source_kind,
            "message": "Parsing local Whisper transcript JSON."
        }),
    )?;
    let transcript_json = read_whisper_transcript_json_file(&transcript_path).map_err(|error| {
        format!(
            "AutoCut local Whisper transcript read failed. language={language} sourceKind={} audioPath={} transcriptPath={} {error}",
            speech_toolchain.source_kind,
            transcript_source_path.display(),
            transcript_path.display()
        )
    })?;
    let segments = parse_whisper_transcript_json(&transcript_json).map_err(|error| {
        format!(
            "AutoCut local Whisper transcript parse failed. language={language} sourceKind={} audioPath={} transcriptPath={} transcriptCharLength={} {} {error}",
            speech_toolchain.source_kind,
            transcript_source_path.display(),
            transcript_path.display(),
            transcript_json.len(),
            format_whisper_transcript_existing_file_diagnostics(&transcript_path)
        )
    })?;
    let quality_guard =
        ensure_speech_transcript_quality(&segments, "local-whisper-transcript", None, false)?;
    let text = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        85,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "transcript-parsed",
            "sourceKind": speech_toolchain.source_kind,
            "message": "Local Whisper transcript parsed.",
            "segmentCount": segments.len(),
            "qualityGuard": quality_guard
        }),
    )?;

    Ok(AutoCutSpeechTranscriptionResult {
        artifact_uuid: String::new(),
        task_uuid: task_uuid.to_string(),
        source_asset_uuid: String::new(),
        transcript_path: transcript_path.display().to_string(),
        task_output_dir: task_output_dir.display().to_string(),
        language: language.to_string(),
        stt_preset_id: execution_options.stt_preset_id.clone(),
        execution_profile: execution_options.execution_profile.clone(),
        segments,
        text,
        quality_guard,
        ffmpeg_executable: ffmpeg_toolchain.executable.clone(),
        speech_executable: speech_toolchain.executable.clone(),
    })
}

fn run_local_whisper_transcription(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    speech_toolchain: &AutoCutSpeechToolchain,
    audio_path: &Path,
    transcript_stem: &Path,
    language: &str,
    worker_lease: &AutoCutOpsWorkerLease,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<PathBuf, String> {
    let whisper_thread_count = resolve_autocut_whisper_thread_count();
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        45,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-started",
            "sourceKind": speech_toolchain.source_kind,
            "language": language,
            "threadCount": whisper_thread_count,
            "whisperAudioContext": execution_options.whisper_audio_context,
            "whisperBeamSize": execution_options.whisper_beam_size,
            "whisperBestOf": execution_options.whisper_best_of,
            "whisperNoFallback": execution_options.whisper_no_fallback,
            "message": "Local Whisper transcription started."
        }),
    )?;
    let mut command = build_local_whisper_transcription_command(
        speech_toolchain,
        audio_path,
        transcript_stem,
        language,
        whisper_thread_count.as_str(),
        execution_options,
    );
    let output = run_tracked_native_media_command(
        task_uuid,
        &mut command,
        "local Whisper transcription",
        |progress| {
            heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            if let Some(progress) = progress {
                record_local_whisper_streaming_progress(
                    app,
                    connection,
                    task_uuid,
                    progress,
                    speech_toolchain.source_kind.as_str(),
                )?;
            }
            Ok(())
        },
    )?;
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        75,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-completed",
            "sourceKind": speech_toolchain.source_kind,
            "message": "Local Whisper transcription completed."
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

fn run_chunked_local_whisper_transcription(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    speech_toolchain: &AutoCutSpeechToolchain,
    speech_source_path: &Path,
    speech_source_kind: AutoCutSpeechChunkAudioSourceKind,
    task_output_dir: &Path,
    language: &str,
    audio_duration_ms: i64,
    worker_lease: &AutoCutOpsWorkerLease,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<PathBuf, String> {
    let chunks_dir = task_output_dir.join(format!(
        "speech-transcript-chunks-{}",
        monotonic_artifact_suffix()?
    ));
    fs::create_dir_all(&chunks_dir)
        .map_err(|error| format!("create AutoCut speech chunk directory failed: {error}"))?;
    let chunks = create_autocut_speech_audio_chunk_plan(
        &chunks_dir,
        audio_duration_ms,
        AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_DURATION_MS,
        AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_OVERLAP_MS,
    );
    if chunks.is_empty() {
        return Err("AutoCut chunked local Whisper transcription has no audio chunks.".to_string());
    }
    let parallelism = execution_options
        .whisper_chunk_parallelism
        .unwrap_or_else(resolve_autocut_whisper_chunk_parallelism);
    let chunk_thread_count = execution_options
        .whisper_chunk_thread_count
        .map(|value| value.to_string())
        .unwrap_or_else(|| resolve_autocut_whisper_chunk_thread_count(parallelism));
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        45,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-chunked-started",
            "sourceKind": speech_toolchain.source_kind,
            "language": language,
            "audioDurationMs": audio_duration_ms,
            "chunkCount": chunks.len(),
            "parallelism": parallelism,
            "chunkThreadCount": chunk_thread_count,
            "sttPresetId": execution_options.stt_preset_id.as_deref(),
            "executionProfile": execution_options.execution_profile.as_deref(),
            "whisperAudioContext": execution_options.whisper_audio_context,
            "whisperBeamSize": execution_options.whisper_beam_size,
            "whisperBestOf": execution_options.whisper_best_of,
            "whisperNoFallback": execution_options.whisper_no_fallback,
            "message": "Long audio detected. Local Whisper chunked transcription started."
        }),
    )?;

    transcribe_local_whisper_chunks_parallel(
        app,
        connection,
        task_uuid,
        ffmpeg_toolchain,
        speech_toolchain,
        speech_source_path,
        speech_source_kind,
        language,
        &chunks,
        parallelism,
        chunk_thread_count.as_str(),
        worker_lease,
        execution_options,
    )?;

    let (chunk_segments, quality_guard) = read_guarded_local_whisper_chunk_segments(
        speech_toolchain,
        language,
        &chunks,
        chunk_thread_count.as_str(),
        execution_options,
    )?;
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        72,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-quality-guarded",
            "sourceKind": speech_toolchain.source_kind,
            "qualityGuard": quality_guard,
            "message": "Local Whisper chunk transcripts passed STT quality guard."
        }),
    )?;

    let merged_segments = merge_autocut_speech_audio_chunk_segments(&chunks, &chunk_segments);
    if merged_segments.is_empty() {
        return Err(
            "AutoCut chunked local Whisper transcription produced no merged segments.".to_string(),
        );
    }
    let transcript_path = task_output_dir.join(format!(
        "speech-transcript-{}.json",
        monotonic_artifact_suffix()?
    ));
    write_merged_whisper_transcript_json(&transcript_path, language, &merged_segments)?;
    write_autocut_speech_chunk_manifest(
        &task_output_dir.join("speech-transcript-chunk-manifest.json"),
        speech_source_path,
        speech_source_kind,
        audio_duration_ms,
        &chunks_dir,
        &chunks,
        parallelism,
        chunk_thread_count.as_str(),
        execution_options,
        &quality_guard,
    )?;
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        75,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-chunked-completed",
            "sourceKind": speech_toolchain.source_kind,
            "message": "Chunked local Whisper transcription completed.",
            "chunkCount": chunks.len(),
            "segmentCount": merged_segments.len(),
            "sttPresetId": execution_options.stt_preset_id.as_deref(),
            "executionProfile": execution_options.execution_profile.as_deref(),
            "qualityGuard": quality_guard
        }),
    )?;

    Ok(transcript_path)
}

fn read_guarded_local_whisper_chunk_segments(
    speech_toolchain: &AutoCutSpeechToolchain,
    language: &str,
    chunks: &[AutoCutSpeechAudioChunkPlan],
    chunk_thread_count: &str,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<
    (
        Vec<Vec<AutoCutSpeechTranscriptionSegment>>,
        AutoCutSpeechTranscriptQualityGuard,
    ),
    String,
> {
    let mut chunk_segments = Vec::new();
    let mut combined_guard =
        create_combined_speech_transcript_quality_guard("chunked-local-whisper");
    let mut retry_count = 0_usize;
    for chunk in chunks {
        let transcript_json = read_whisper_transcript_json_file(&chunk.transcript_path).map_err(|error| {
            format!(
                "AutoCut local Whisper chunk transcript read failed. chunkId={} transcriptPath={} {error}",
                chunk.id,
                chunk.transcript_path.display()
            )
        })?;
        let segments = parse_whisper_transcript_json_allow_empty(&transcript_json).map_err(|error| {
            format!(
                "AutoCut local Whisper chunk transcript parse failed. chunkId={} transcriptPath={} {error}",
                chunk.id,
                chunk.transcript_path.display()
            )
        })?;
        let mut guard = evaluate_speech_transcript_quality(
            &segments,
            "local-whisper-chunk",
            Some(chunk.id.as_str()),
            true,
        );
        if !guard.passed && execution_options.whisper_audio_context.is_some() {
            let retry_segments = retry_local_whisper_chunk_with_stable_decode(
                speech_toolchain,
                language,
                chunk,
                chunk_thread_count,
                execution_options,
            )?;
            guard = evaluate_speech_transcript_quality(
                &retry_segments,
                "local-whisper-chunk-stable-retry",
                Some(chunk.id.as_str()),
                true,
            );
            guard.retry_count = 1;
            retry_count += 1;
            if guard.passed {
                chunk_segments.push(retry_segments);
                merge_speech_transcript_quality_guard(&mut combined_guard, &guard);
                continue;
            }
        }
        if !guard.passed {
            return Err(format!(
                "AutoCut STT quality guard failed. chunkId={} risks={}",
                chunk.id,
                guard
                    .risks
                    .iter()
                    .map(|risk| risk.code.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        merge_speech_transcript_quality_guard(&mut combined_guard, &guard);
        chunk_segments.push(segments);
    }
    combined_guard.retry_count = retry_count;
    if retry_count > 0 {
        combined_guard.status = "passed-after-retry".to_string();
    }
    Ok((chunk_segments, combined_guard))
}

fn transcribe_local_whisper_chunks_parallel(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    speech_toolchain: &AutoCutSpeechToolchain,
    speech_source_path: &Path,
    speech_source_kind: AutoCutSpeechChunkAudioSourceKind,
    language: &str,
    chunks: &[AutoCutSpeechAudioChunkPlan],
    parallelism: usize,
    chunk_thread_count: &str,
    worker_lease: &AutoCutOpsWorkerLease,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<(), String> {
    let queue = Arc::new(Mutex::new(
        chunks
            .iter()
            .filter(|chunk| !chunk.transcript_path.is_file())
            .cloned()
            .collect::<Vec<_>>(),
    ));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let worker_count = parallelism.max(1).min(chunks.len().max(1));
    thread::scope(|scope| {
        for _ in 0..worker_count {
            let queue = Arc::clone(&queue);
            let errors = Arc::clone(&errors);
            scope.spawn(move || {
                loop {
                    let chunk = {
                        let mut queue = match queue.lock() {
                            Ok(queue) => queue,
                            Err(error) => {
                                if let Ok(mut errors) = errors.lock() {
                                    errors.push(format!(
                                        "lock AutoCut Whisper chunk queue failed: {error}"
                                    ));
                                }
                                return;
                            }
                        };
                        queue.pop()
                    };
                    let Some(chunk) = chunk else {
                        return;
                    };
                    if let Err(error) = run_autocut_speech_chunk_pipeline_step(
                        ffmpeg_toolchain,
                        speech_toolchain,
                        speech_source_path,
                        speech_source_kind,
                        language,
                        chunk_thread_count,
                        &chunk,
                        AutoCutSpeechChunkPipelineStep::ExtractAudio,
                        execution_options,
                    ) {
                        if let Ok(mut errors) = errors.lock() {
                            errors.push(error);
                        }
                        continue;
                    }
                    if chunk.transcript_path.is_file() {
                        continue;
                    }
                    if let Err(error) = run_autocut_speech_chunk_pipeline_step(
                        ffmpeg_toolchain,
                        speech_toolchain,
                        speech_source_path,
                        speech_source_kind,
                        language,
                        chunk_thread_count,
                        &chunk,
                        AutoCutSpeechChunkPipelineStep::TranscribeAudio,
                        execution_options,
                    ) {
                        if let Ok(mut errors) = errors.lock() {
                            errors.push(error);
                        }
                    }
                }
            });
        }
    });
    heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        70,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-chunks-transcribed",
            "sourceKind": speech_toolchain.source_kind,
            "message": "Local Whisper audio chunks transcribed.",
            "chunkCount": chunks.len(),
            "parallelism": parallelism,
            "whisperAudioContext": execution_options.whisper_audio_context,
            "whisperBeamSize": execution_options.whisper_beam_size,
            "whisperBestOf": execution_options.whisper_best_of,
            "whisperNoFallback": execution_options.whisper_no_fallback
        }),
    )?;
    let errors = errors
        .lock()
        .map_err(|error| format!("lock AutoCut Whisper chunk errors failed: {error}"))?;
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(())
}

fn run_autocut_speech_chunk_pipeline_step(
    ffmpeg_toolchain: &AutoCutFfmpegToolchain,
    speech_toolchain: &AutoCutSpeechToolchain,
    speech_source_path: &Path,
    speech_source_kind: AutoCutSpeechChunkAudioSourceKind,
    language: &str,
    chunk_thread_count: &str,
    chunk: &AutoCutSpeechAudioChunkPlan,
    step: AutoCutSpeechChunkPipelineStep,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<(), String> {
    match step {
        AutoCutSpeechChunkPipelineStep::ExtractAudio => {
            if chunk.audio_path.is_file() {
                return Ok(());
            }
            let mut command = build_ffmpeg_speech_audio_chunk_extract_command(
                ffmpeg_toolchain,
                speech_source_path,
                speech_source_kind,
                chunk,
            );
            let output = command.output().map_err(|error| {
                format!(
                    "run AutoCut FFmpeg speech chunk extraction failed for {}: {error}",
                    chunk.id
                )
            })?;
            if !output.status.success() || !chunk.audio_path.is_file() {
                return Err(format!(
                    "AutoCut FFmpeg speech chunk extraction failed for {} with status {}: {}",
                    chunk.id,
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            if !is_useful_speech_audio_chunk(&chunk.audio_path) {
                write_empty_whisper_transcript_json(&chunk.transcript_path, language)?;
            }
            Ok(())
        }
        AutoCutSpeechChunkPipelineStep::TranscribeAudio => {
            if chunk.transcript_path.is_file() {
                return Ok(());
            }
            let mut command = build_local_whisper_transcription_command(
                speech_toolchain,
                &chunk.audio_path,
                &chunk.transcript_stem,
                language,
                chunk_thread_count,
                execution_options,
            );
            let output = command.output().map_err(|error| {
                format!(
                    "run AutoCut local Whisper chunk {} failed: {error}",
                    chunk.id
                )
            })?;
            if !output.status.success() || !chunk.transcript_path.is_file() {
                return Err(format!(
                    "AutoCut local Whisper chunk {} failed with status {}: {}",
                    chunk.id,
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            Ok(())
        }
    }
}

fn build_local_whisper_transcription_command(
    speech_toolchain: &AutoCutSpeechToolchain,
    audio_path: &Path,
    transcript_stem: &Path,
    language: &str,
    whisper_thread_count: &str,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Command {
    let mut command = new_autocut_hidden_child_command(&speech_toolchain.executable);
    command
        .args(["-m", speech_toolchain.model_path.as_str()])
        .args(["-t", whisper_thread_count])
        .args(["-f"])
        .arg(audio_path)
        .args(["-oj", "-ojf", "-of"])
        .arg(transcript_stem)
        .args(["-ml", WHISPER_SUBTITLE_FRIENDLY_MAX_SEGMENT_CHARS, "-sow"]);
    if let Some(whisper_audio_context) = execution_options.whisper_audio_context {
        command.args(["-ac", whisper_audio_context.to_string().as_str()]);
    }
    if let Some(whisper_beam_size) = execution_options.whisper_beam_size {
        command.args(["-bs", whisper_beam_size.to_string().as_str()]);
    }
    if let Some(whisper_best_of) = execution_options.whisper_best_of {
        command.args(["-bo", whisper_best_of.to_string().as_str()]);
    }
    if execution_options.whisper_no_fallback {
        command.arg("-nf");
    }
    command.args(["-l", language]);
    append_whisper_progress_output_args(&mut command);
    command
}

fn build_ffmpeg_speech_audio_chunk_extract_command(
    toolchain: &AutoCutFfmpegToolchain,
    speech_source_path: &Path,
    speech_source_kind: AutoCutSpeechChunkAudioSourceKind,
    chunk: &AutoCutSpeechAudioChunkPlan,
) -> Command {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command
        .args(["-hide_banner", "-nostdin", "-y", "-ss"])
        .arg(format_seconds(chunk.start_ms))
        .args(["-t"])
        .arg(format_seconds(chunk.end_ms - chunk.start_ms))
        .args(["-i"])
        .arg(speech_source_path);
    if matches!(
        speech_source_kind,
        AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect
    ) {
        command.arg("-vn");
    }
    command
        .args(["-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le"])
        .arg(&chunk.audio_path);
    command
}

fn create_autocut_speech_audio_chunk_plan(
    chunks_dir: &Path,
    audio_duration_ms: i64,
    chunk_duration_ms: i64,
    chunk_overlap_ms: i64,
) -> Vec<AutoCutSpeechAudioChunkPlan> {
    let normalized_audio_duration_ms = audio_duration_ms.max(0);
    let normalized_chunk_duration_ms = chunk_duration_ms.max(1_000);
    let normalized_chunk_overlap_ms =
        chunk_overlap_ms.clamp(0, normalized_chunk_duration_ms.saturating_sub(1_000));
    let mut chunks = Vec::new();
    let mut start_ms = 0_i64;
    let mut index = 1_usize;
    while start_ms < normalized_audio_duration_ms {
        let mut end_ms =
            (start_ms + normalized_chunk_duration_ms).min(normalized_audio_duration_ms);
        let remaining_ms = normalized_audio_duration_ms.saturating_sub(end_ms);
        if remaining_ms > 0 && remaining_ms < AUTOCUT_LONG_SPEECH_TRANSCRIPTION_MIN_TAIL_CHUNK_MS {
            end_ms = normalized_audio_duration_ms;
        }
        let id = format!("chunk-{index:04}");
        let transcript_stem = chunks_dir.join(&id);
        chunks.push(AutoCutSpeechAudioChunkPlan {
            id,
            index,
            start_ms,
            end_ms,
            audio_path: transcript_stem.with_extension("wav"),
            transcript_stem: transcript_stem.clone(),
            transcript_path: transcript_stem.with_extension("json"),
        });
        if end_ms >= normalized_audio_duration_ms {
            break;
        }
        start_ms = (end_ms - normalized_chunk_overlap_ms).max(start_ms + 1_000);
        index += 1;
    }
    chunks
}

fn should_use_chunked_local_speech_transcription(audio_duration_ms: i64) -> bool {
    audio_duration_ms > AUTOCUT_LONG_SPEECH_TRANSCRIPTION_THRESHOLD_MS
}

fn merge_autocut_speech_audio_chunk_segments(
    chunks: &[AutoCutSpeechAudioChunkPlan],
    chunk_segments: &[Vec<AutoCutSpeechTranscriptionSegment>],
) -> Vec<AutoCutSpeechTranscriptionSegment> {
    let mut merged_segments = Vec::new();
    for (chunk, segments) in chunks.iter().zip(chunk_segments.iter()) {
        for segment in segments {
            let start_ms = chunk.start_ms + segment.start_ms.max(0);
            let end_ms = (chunk.start_ms + segment.end_ms.max(segment.start_ms)).min(chunk.end_ms);
            if end_ms <= start_ms || segment.text.trim().is_empty() {
                continue;
            }
            merged_segments.push(AutoCutSpeechTranscriptionSegment {
                start_ms,
                end_ms,
                text: segment.text.trim().to_string(),
                speaker: segment.speaker.clone(),
                words: segment.words.as_ref().map(|words| {
                    words
                        .iter()
                        .filter_map(|word| {
                            let word_start_ms = chunk.start_ms + word.start_ms.max(0);
                            let word_end_ms =
                                (chunk.start_ms + word.end_ms.max(word.start_ms)).min(chunk.end_ms);
                            if word_end_ms <= word_start_ms || word.text.trim().is_empty() {
                                return None;
                            }
                            Some(AutoCutSpeechTranscriptionWord {
                                start_ms: word_start_ms,
                                end_ms: word_end_ms,
                                text: word.text.trim().to_string(),
                                probability: word.probability,
                            })
                        })
                        .collect::<Vec<_>>()
                }),
            });
        }
    }
    merged_segments.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then_with(|| first.end_ms.cmp(&second.end_ms))
    });
    dedupe_autocut_chunk_overlap_segments(merged_segments)
}

fn dedupe_autocut_chunk_overlap_segments(
    segments: Vec<AutoCutSpeechTranscriptionSegment>,
) -> Vec<AutoCutSpeechTranscriptionSegment> {
    let mut deduped: Vec<AutoCutSpeechTranscriptionSegment> = Vec::new();
    for segment in segments {
        if let Some(previous) = deduped.last_mut() {
            let duplicate_text = previous.text == segment.text;
            let duplicate_range = (previous.start_ms - segment.start_ms).abs()
                <= AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_OVERLAP_MS + 500
                && (previous.end_ms - segment.end_ms).abs()
                    <= AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_OVERLAP_MS + 500;
            if duplicate_text && duplicate_range {
                previous.end_ms = previous.end_ms.max(segment.end_ms);
                continue;
            }
        }
        deduped.push(segment);
    }
    repair_autocut_chunk_overlap_timeline(deduped)
}

fn repair_autocut_chunk_overlap_timeline(
    segments: Vec<AutoCutSpeechTranscriptionSegment>,
) -> Vec<AutoCutSpeechTranscriptionSegment> {
    let mut repaired: Vec<AutoCutSpeechTranscriptionSegment> = Vec::new();
    for mut segment in segments {
        if let Some(previous) = repaired.last() {
            if segment.start_ms < previous.end_ms {
                segment.start_ms = previous.end_ms;
                if let Some(words) = segment.words.take() {
                    let clipped_words = clip_autocut_speech_words_to_segment(
                        words,
                        segment.start_ms,
                        segment.end_ms,
                    );
                    if !clipped_words.is_empty() {
                        segment.words = Some(clipped_words);
                    }
                }
            }
        }
        if segment.end_ms <= segment.start_ms || segment.text.trim().is_empty() {
            continue;
        }
        repaired.push(segment);
    }
    repaired
}

fn clip_autocut_speech_words_to_segment(
    words: Vec<AutoCutSpeechTranscriptionWord>,
    segment_start_ms: i64,
    segment_end_ms: i64,
) -> Vec<AutoCutSpeechTranscriptionWord> {
    words
        .into_iter()
        .filter_map(|mut word| {
            word.start_ms = word.start_ms.max(segment_start_ms);
            word.end_ms = word.end_ms.min(segment_end_ms);
            if word.end_ms <= word.start_ms || word.text.trim().is_empty() {
                return None;
            }
            Some(word)
        })
        .collect()
}

fn write_merged_whisper_transcript_json(
    transcript_path: &Path,
    language: &str,
    segments: &[AutoCutSpeechTranscriptionSegment],
) -> Result<(), String> {
    let parent = transcript_path.parent().ok_or_else(|| {
        "AutoCut merged Whisper transcript path must have a parent directory".to_string()
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!("create AutoCut merged Whisper transcript directory failed: {error}")
    })?;
    let transcription = segments
        .iter()
        .map(|segment| {
            let mut entry = json!({
                "offsets": {
                    "from": segment.start_ms,
                    "to": segment.end_ms,
                },
                "start": segment.start_ms as f64 / 1000.0,
                "end": segment.end_ms as f64 / 1000.0,
                "text": segment.text,
            });
            if let Value::Object(ref mut object) = entry {
                if let Some(speaker) = segment.speaker.as_deref() {
                    object.insert("speaker".to_string(), Value::String(speaker.to_string()));
                }
                if let Some(words) = segment.words.as_ref().filter(|words| !words.is_empty()) {
                    object.insert(
                        "words".to_string(),
                        Value::Array(
                            words
                                .iter()
                                .map(|word| {
                                    let mut word_entry = json!({
                                        "offsets": {
                                            "from": word.start_ms,
                                            "to": word.end_ms,
                                        },
                                        "start": word.start_ms as f64 / 1000.0,
                                        "end": word.end_ms as f64 / 1000.0,
                                        "text": word.text,
                                    });
                                    if let Value::Object(ref mut word_object) = word_entry {
                                        if let Some(probability) = word.probability {
                                            word_object.insert(
                                                "probability".to_string(),
                                                json!(probability),
                                            );
                                        }
                                    }
                                    word_entry
                                })
                                .collect(),
                        ),
                    );
                }
            }
            entry
        })
        .collect::<Vec<_>>();
    let transcript_json = json!({
        "result": {
            "language": language,
            "source": "autocut-local-whisper-chunked-merge",
        },
        "transcription": transcription,
    });
    write_json_atomic(
        transcript_path,
        &transcript_json,
        "AutoCut merged Whisper transcript JSON",
    )
}

fn write_empty_whisper_transcript_json(
    transcript_path: &Path,
    language: &str,
) -> Result<(), String> {
    let transcript_json = json!({
        "result": {
            "language": language,
            "source": "autocut-empty-audio-chunk",
        },
        "transcription": [],
    });
    write_json_atomic(
        transcript_path,
        &transcript_json,
        "AutoCut empty Whisper chunk transcript JSON",
    )
}

fn is_useful_speech_audio_chunk(audio_path: &Path) -> bool {
    fs::metadata(audio_path)
        .map(|metadata| metadata.is_file() && metadata.len() >= MIN_USEFUL_SPEECH_CHUNK_WAV_BYTES)
        .unwrap_or(false)
}

fn write_autocut_speech_chunk_manifest(
    manifest_path: &Path,
    speech_source_path: &Path,
    speech_source_kind: AutoCutSpeechChunkAudioSourceKind,
    audio_duration_ms: i64,
    chunks_dir: &Path,
    chunks: &[AutoCutSpeechAudioChunkPlan],
    parallelism: usize,
    chunk_thread_count: &str,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
    quality_guard: &AutoCutSpeechTranscriptQualityGuard,
) -> Result<(), String> {
    let ready_count = chunks
        .iter()
        .filter(|chunk| chunk.transcript_path.is_file())
        .count();
    let manifest = json!({
        "schema": "smart-slice.large-media-stt-chunks.v1",
        "audioPath": speech_source_path.display().to_string(),
        "speechSourcePath": speech_source_path.display().to_string(),
        "speechSourceKind": speech_source_kind.as_manifest_value(),
        "fullAudioExtracted": speech_source_kind.full_audio_extracted(),
        "chunkSourceStrategy": execution_options.chunk_source_strategy.as_manifest_value(),
        "audioDurationMs": audio_duration_ms,
        "chunksDir": chunks_dir.display().to_string(),
        "chunkDurationMs": AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_DURATION_MS,
        "chunkOverlapMs": AUTOCUT_LONG_SPEECH_TRANSCRIPTION_CHUNK_OVERLAP_MS,
        "parallelism": parallelism,
        "chunkThreadCount": chunk_thread_count,
        "sttPresetId": execution_options.stt_preset_id.as_deref(),
        "executionProfile": execution_options.execution_profile.as_deref(),
        "whisperAudioContext": execution_options.whisper_audio_context,
        "whisperBeamSize": execution_options.whisper_beam_size,
        "whisperBestOf": execution_options.whisper_best_of,
        "whisperNoFallback": execution_options.whisper_no_fallback,
        "qualityGuard": quality_guard,
        "chunkCount": chunks.len(),
        "readyCount": ready_count,
        "chunks": chunks
            .iter()
            .map(|chunk| {
                json!({
                    "id": chunk.id,
                    "index": chunk.index,
                    "startMs": chunk.start_ms,
                    "endMs": chunk.end_ms,
                    "audioPath": chunk.audio_path.display().to_string(),
                    "transcriptPath": chunk.transcript_path.display().to_string(),
                    "ready": chunk.transcript_path.is_file(),
                })
            })
            .collect::<Vec<_>>(),
    });
    write_json_atomic(
        manifest_path,
        &manifest,
        "AutoCut speech chunk manifest JSON",
    )
}

fn write_json_atomic(path: &Path, value: &Value, label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{label} path must have a parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create {label} directory failed: {error}"))?;
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize {label} failed: {error}"))?;
    let temporary_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("json")
    ));
    let _ = fs::remove_file(&temporary_path);
    fs::write(&temporary_path, serialized)
        .map_err(|error| format!("write {label} temp file failed: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace {label} failed: {error}"))?;
    }
    fs::rename(&temporary_path, path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        format!("commit {label} failed: {error}")
    })
}

fn format_seconds(value_ms: i64) -> String {
    format!("{:.3}", value_ms.max(0) as f64 / 1000.0)
}

fn resolve_autocut_whisper_chunk_parallelism() -> usize {
    let available_threads = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(4);
    std::env::var("SDKWORK_AUTOCUT_WHISPER_CHUNK_PARALLELISM")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or_else(|| available_threads.saturating_div(3).max(2))
        .clamp(1, 6)
}

fn resolve_autocut_whisper_chunk_thread_count(parallelism: usize) -> String {
    let available_threads = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(4);
    let fallback = available_threads
        .saturating_div(parallelism.max(1))
        .clamp(1, 8);
    std::env::var("SDKWORK_AUTOCUT_WHISPER_CHUNK_THREADS")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
        .clamp(1, 8)
        .to_string()
}

fn resolve_autocut_whisper_thread_count() -> String {
    let available_threads = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(4);
    available_threads.clamp(2, 8).to_string()
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
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
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
            record_ffmpeg_streaming_progress(None, connection, task_uuid, progress, "videoGif")
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
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    task_output_dir: &Path,
    clips: &[AutoCutVideoSliceClipRequest],
    output_format: &str,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
    subtitle_format: Option<&str>,
    subtitle_mode: AutoCutVideoSliceSubtitleMode,
    subtitle_style_id: Option<&str>,
    subtitle_segments: &[AutoCutSpeechTranscriptionSegment],
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<Vec<AutoCutVideoSliceOperationOutput>, String> {
    let total_clips = clips.len();
    let mut outputs = Vec::with_capacity(total_clips);
    let cover_dir = autocut_task_cover_dir(task_output_dir)?;
    let mut encoder_session = AutoCutVideoSliceEncoderSession::default();

    for (index, clip) in clips.iter().enumerate() {
        record_ops_task_progress_for_app(
            app,
            connection,
            task_uuid,
            weighted_slice_progress(1, index, total_clips),
            json!({
                "operation": "videoSlice",
                "stepId": "native-render",
                "phase": "ffmpeg-video-slice-started",
                "source": "native-host",
                "clipIndex": index + 1,
                "clipCount": total_clips,
                "message": "Rendering video slice with native FFmpeg."
            }),
        )?;
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
        let audio_postprocess_decision = should_run_video_slice_audio_cleanup_postprocess(
            clip,
            apply_audio_noise_reduction,
            source_has_audio_stream,
        );
        let raw_output_path = if audio_postprocess_decision.should_run() {
            create_video_slice_audio_cleanup_work_path(
                task_output_dir,
                index,
                "raw",
                output_format,
            )?
        } else {
            output_path.clone()
        };
        let render_pass_clip =
            create_video_slice_render_pass_clip(clip, audio_postprocess_decision);
        let apply_render_pass_audio_cleanup =
            should_apply_video_slice_audio_cleanup_during_render_pass(
                audio_postprocess_decision,
                apply_audio_noise_reduction,
            );
        let video_output = run_ffmpeg_video_slice(
            app,
            connection,
            task_uuid,
            toolchain,
            input_path,
            &raw_output_path,
            &render_pass_clip,
            render_profile,
            apply_render_pass_audio_cleanup,
            source_has_audio_stream,
            burned_subtitle_path.as_deref(),
            subtitle_style_id,
            index,
            total_clips,
            worker_lease,
            &mut encoder_session,
        )?;
        let (video_output, final_clip) = if audio_postprocess_decision.should_run() {
            run_ffmpeg_video_slice_audio_cleanup_postprocess(
                app,
                connection,
                task_uuid,
                toolchain,
                &raw_output_path,
                &output_path,
                clip,
                apply_audio_noise_reduction,
                index,
                total_clips,
                worker_lease,
                &mut encoder_session,
            )?
        } else {
            record_ops_task_progress_for_app(
                app,
                connection,
                task_uuid,
                weighted_slice_progress(95, index, total_clips),
                json!({
                    "operation": "videoSlice",
                    "stepId": "native-render",
                    "phase": "ffmpeg-video-slice-postprocess-skipped",
                    "source": "native-host",
                    "clipIndex": index + 1,
                    "clipCount": total_clips,
                    "postprocessSkipReason": audio_postprocess_decision.reason(),
                    "message": "Skipped redundant post-cut audio analysis because the upstream Smart Slice cleanup plan is ready."
                }),
            )?;
            (
                video_output,
                create_video_slice_final_clip_after_skipped_postprocess(
                    clip,
                    apply_audio_noise_reduction,
                ),
            )
        };
        let thumbnail_path = cover_dir.join(format!(
            "video-slice-{:02}-thumbnail-{}.jpg",
            index + 1,
            monotonic_artifact_suffix()?
        ));
        let thumbnail_output = run_ffmpeg_video_slice_thumbnail(
            app,
            connection,
            task_uuid,
            toolchain,
            input_path,
            &thumbnail_path,
            &final_clip,
            render_profile,
            index,
            total_clips,
            worker_lease,
        )?;
        let subtitle_output = write_video_slice_subtitle_artifact(
            task_output_dir,
            &final_clip,
            index,
            if subtitle_mode.writes_srt_sidecar() {
                subtitle_format
            } else {
                None
            },
            subtitle_segments,
        )?;
        outputs.push(AutoCutVideoSliceOperationOutput {
            clip: final_clip,
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

fn create_video_slice_audio_cleanup_work_path(
    task_output_dir: &Path,
    clip_index: usize,
    stage: &str,
    output_format: &str,
) -> Result<PathBuf, String> {
    Ok(task_output_dir.join(format!(
        "video-slice-{:02}-{stage}-{}.{}",
        clip_index + 1,
        monotonic_artifact_suffix()?,
        output_format
    )))
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
    let mut entries = Vec::new();

    for segment in subtitle_segments {
        for (relative_start_ms, relative_end_ms) in
            build_video_slice_rendered_subtitle_ranges(clip, segment)
        {
            if relative_end_ms <= relative_start_ms {
                continue;
            }
            for (cue_start_ms, cue_end_ms, cue_text) in
                build_video_slice_paced_subtitle_cues(segment, relative_start_ms, relative_end_ms)
            {
                if cue_end_ms <= cue_start_ms || cue_text.is_empty() {
                    continue;
                }
                entries.push(format!(
                    "{}\n{} --> {}\n{}\n",
                    entries.len() + 1,
                    format_srt_timestamp(cue_start_ms),
                    format_srt_timestamp(cue_end_ms),
                    cue_text
                ));
            }
        }
    }

    entries.join("\n")
}

fn build_video_slice_paced_subtitle_cues(
    segment: &AutoCutSpeechTranscriptionSegment,
    relative_start_ms: i64,
    relative_end_ms: i64,
) -> Vec<(i64, i64, String)> {
    let text = format_srt_segment_text(segment);
    if text.is_empty() {
        return Vec::new();
    }

    let duration_ms = relative_end_ms.saturating_sub(relative_start_ms).max(0);
    if duration_ms <= VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS {
        return vec![(relative_start_ms, relative_end_ms, wrap_srt_text(&text))];
    }
    if let Some(word_timed_cues) =
        build_video_slice_word_timed_subtitle_cues(segment, relative_start_ms, relative_end_ms)
    {
        return word_timed_cues;
    }
    let chunks = fit_video_slice_subtitle_chunks_to_duration(
        split_video_slice_subtitle_text_into_paced_chunks(&text),
        duration_ms,
    );
    if chunks.len() <= 1 {
        return vec![(relative_start_ms, relative_end_ms, wrap_srt_text(&text))];
    }

    let total_weight = chunks
        .iter()
        .map(|chunk| subtitle_display_units(chunk).max(1) as i64)
        .sum::<i64>()
        .max(chunks.len() as i64);
    let mut cursor_ms = relative_start_ms;
    let mut cues = Vec::with_capacity(chunks.len());

    for (index, chunk) in chunks.iter().enumerate() {
        let remaining_chunks = chunks.len().saturating_sub(index);
        let is_last = index + 1 == chunks.len();
        let target_duration_ms = if is_last {
            relative_end_ms.saturating_sub(cursor_ms)
        } else {
            (duration_ms * subtitle_display_units(chunk).max(1) as i64 / total_weight).clamp(
                VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS,
                VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS,
            )
        };
        let remaining_after_this_cue = remaining_chunks.saturating_sub(1) as i64;
        let latest_end_ms = relative_end_ms
            .saturating_sub(remaining_after_this_cue * VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS);
        let earliest_end_ms = relative_end_ms
            .saturating_sub(remaining_after_this_cue * VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS);
        let cue_end_ms = if is_last {
            relative_end_ms
        } else {
            cursor_ms
                .saturating_add(VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS)
                .max(
                    cursor_ms
                        .saturating_add(target_duration_ms)
                        .max(earliest_end_ms)
                        .min(latest_end_ms),
                )
        };
        if cue_end_ms > cursor_ms {
            cues.push((cursor_ms, cue_end_ms, wrap_srt_text(chunk)));
            cursor_ms = cue_end_ms;
        }
    }

    cues
}

fn build_video_slice_word_timed_subtitle_cues(
    segment: &AutoCutSpeechTranscriptionSegment,
    relative_start_ms: i64,
    relative_end_ms: i64,
) -> Option<Vec<(i64, i64, String)>> {
    let words = segment.words.as_ref()?;
    if words.is_empty() {
        return None;
    }
    let segment_start_ms = segment.start_ms;
    let segment_end_ms = segment.end_ms;
    if segment_end_ms <= segment_start_ms {
        return None;
    }

    let mut cues = Vec::new();
    let mut current_words: Vec<&AutoCutSpeechTranscriptionWord> = Vec::new();
    for word in words {
        let overlap_start_ms = word.start_ms.max(segment_start_ms);
        let overlap_end_ms = word.end_ms.min(segment_end_ms);
        if overlap_end_ms <= overlap_start_ms {
            continue;
        }
        let candidate_text = join_video_slice_subtitle_words(&current_words, Some(word));
        if !current_words.is_empty()
            && should_flush_video_slice_word_timed_subtitle_cue(
                &current_words,
                word,
                &candidate_text,
            )
        {
            push_video_slice_word_timed_subtitle_cue(
                &mut cues,
                &current_words,
                segment_start_ms,
                relative_start_ms,
                relative_end_ms,
            );
            current_words.clear();
        }
        current_words.push(word);
    }
    push_video_slice_word_timed_subtitle_cue(
        &mut cues,
        &current_words,
        segment_start_ms,
        relative_start_ms,
        relative_end_ms,
    );

    if !cues.is_empty() { Some(cues) } else { None }
}

fn should_flush_video_slice_word_timed_subtitle_cue(
    current_words: &[&AutoCutSpeechTranscriptionWord],
    next_word: &AutoCutSpeechTranscriptionWord,
    candidate_text: &str,
) -> bool {
    let Some(first_word) = current_words.first() else {
        return false;
    };
    let Some(last_word) = current_words.last() else {
        return false;
    };
    let max_units = if candidate_text.chars().any(is_cjk_character) {
        VIDEO_SLICE_SUBTITLE_MAX_CJK_UNITS
    } else {
        VIDEO_SLICE_SUBTITLE_MAX_LATIN_CHARS
    };
    let next_word_is_standalone_punctuation = next_word
        .text
        .chars()
        .next()
        .is_some_and(is_subtitle_punctuation);
    let display_overflow = !next_word_is_standalone_punctuation
        && subtitle_display_units(candidate_text) > max_units.saturating_mul(2);
    let punctuation_boundary = last_word
        .text
        .chars()
        .last()
        .is_some_and(is_subtitle_sentence_terminal_punctuation)
        && last_word.end_ms.saturating_sub(first_word.start_ms)
            >= VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS;
    let next_word_completes_sentence = next_word
        .text
        .chars()
        .last()
        .is_some_and(is_subtitle_sentence_terminal_punctuation);
    let duration_limit_ms = if next_word_completes_sentence {
        VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS + VIDEO_SLICE_SUBTITLE_SENTENCE_COMPLETE_GRACE_MS
    } else {
        VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS
    };
    let duration_overflow =
        next_word.end_ms.saturating_sub(first_word.start_ms) > duration_limit_ms;

    display_overflow || duration_overflow || punctuation_boundary
}

fn push_video_slice_word_timed_subtitle_cue(
    cues: &mut Vec<(i64, i64, String)>,
    words: &[&AutoCutSpeechTranscriptionWord],
    segment_start_ms: i64,
    relative_start_ms: i64,
    relative_end_ms: i64,
) {
    let (Some(first_word), Some(last_word)) = (words.first(), words.last()) else {
        return;
    };
    let cue_start_ms = relative_start_ms
        .saturating_add(first_word.start_ms.saturating_sub(segment_start_ms))
        .clamp(relative_start_ms, relative_end_ms);
    let cue_end_ms = relative_start_ms
        .saturating_add(last_word.end_ms.saturating_sub(segment_start_ms))
        .clamp(relative_start_ms, relative_end_ms);
    let text = join_video_slice_subtitle_words(words, None);
    if cue_end_ms > cue_start_ms && !text.is_empty() {
        cues.push((cue_start_ms, cue_end_ms, wrap_srt_text(&text)));
    }
}

fn join_video_slice_subtitle_words(
    words: &[&AutoCutSpeechTranscriptionWord],
    next_word: Option<&AutoCutSpeechTranscriptionWord>,
) -> String {
    words
        .iter()
        .copied()
        .chain(next_word)
        .fold(String::new(), |current, word| {
            join_video_slice_subtitle_text_unit(&current, word.text.trim())
        })
        .trim()
        .to_string()
}

fn fit_video_slice_subtitle_chunks_to_duration(
    mut chunks: Vec<String>,
    duration_ms: i64,
) -> Vec<String> {
    let max_chunk_count = (duration_ms / VIDEO_SLICE_SUBTITLE_MIN_CUE_DURATION_MS).max(1) as usize;
    let target_chunk_count = ((duration_ms + VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS - 1)
        / VIDEO_SLICE_SUBTITLE_MAX_CUE_DURATION_MS)
        .max(1) as usize;
    let target_chunk_count = target_chunk_count.min(max_chunk_count);
    chunks.retain(|chunk| !chunk.trim().is_empty());
    if chunks.is_empty() {
        return Vec::new();
    }

    while chunks.len() > max_chunk_count {
        let merge_index = find_video_slice_subtitle_chunk_merge_index(&chunks);
        let merged = join_video_slice_subtitle_text_unit(
            chunks
                .get(merge_index)
                .map(String::as_str)
                .unwrap_or_default(),
            chunks
                .get(merge_index + 1)
                .map(String::as_str)
                .unwrap_or_default(),
        );
        chunks.splice(merge_index..=merge_index + 1, [merged]);
    }

    while chunks.len() < target_chunk_count {
        let Some(split_index) = find_video_slice_subtitle_chunk_split_index(&chunks) else {
            break;
        };
        let Some(split_chunks) = split_video_slice_subtitle_chunk_near_half(
            chunks
                .get(split_index)
                .map(String::as_str)
                .unwrap_or_default(),
        ) else {
            break;
        };
        chunks.splice(split_index..=split_index, split_chunks);
    }

    chunks
}

fn find_video_slice_subtitle_chunk_merge_index(chunks: &[String]) -> usize {
    chunks
        .windows(2)
        .enumerate()
        .min_by_key(|(_, items)| {
            subtitle_display_units(&items[0]) + subtitle_display_units(&items[1])
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn find_video_slice_subtitle_chunk_split_index(chunks: &[String]) -> Option<usize> {
    chunks
        .iter()
        .enumerate()
        .filter(|(_, chunk)| split_video_slice_subtitle_text_units(chunk).len() >= 2)
        .max_by_key(|(_, chunk)| subtitle_display_units(chunk))
        .map(|(index, _)| index)
}

fn split_video_slice_subtitle_chunk_near_half(chunk: &str) -> Option<[String; 2]> {
    let units = split_video_slice_subtitle_text_units(chunk);
    if units.len() < 2 {
        return None;
    }

    let target_weight = subtitle_display_units(chunk).max(1) / 2;
    let mut left = String::new();
    let mut split_after_index = 0;
    for (index, unit) in units.iter().take(units.len() - 1).enumerate() {
        left = join_video_slice_subtitle_text_unit(&left, unit);
        split_after_index = index;
        if subtitle_display_units(&left) >= target_weight {
            break;
        }
    }

    let first_chunk = trim_subtitle_chunk_punctuation(
        &units[..=split_after_index]
            .iter()
            .fold(String::new(), |current, unit| {
                join_video_slice_subtitle_text_unit(&current, unit)
            }),
    );
    let second_chunk = trim_subtitle_chunk_punctuation(
        &units[split_after_index + 1..]
            .iter()
            .fold(String::new(), |current, unit| {
                join_video_slice_subtitle_text_unit(&current, unit)
            }),
    );
    if first_chunk.is_empty() || second_chunk.is_empty() {
        None
    } else {
        Some([first_chunk, second_chunk])
    }
}

fn split_video_slice_subtitle_text_into_paced_chunks(text: &str) -> Vec<String> {
    let normalized = normalize_srt_text(text);
    if normalized.is_empty() {
        return Vec::new();
    }

    let units = split_video_slice_subtitle_text_units(&normalized);
    let mut chunks = Vec::new();
    let mut current = String::new();
    for unit in units {
        let candidate = join_video_slice_subtitle_text_unit(&current, &unit);
        if !current.is_empty()
            && should_start_new_video_slice_subtitle_chunk(&current, &candidate, &unit)
        {
            chunks.push(trim_subtitle_chunk_punctuation(&current));
            current = unit;
        } else {
            current = candidate;
        }
    }
    if !current.trim().is_empty() {
        chunks.push(trim_subtitle_chunk_punctuation(&current));
    }

    chunks
        .into_iter()
        .filter(|chunk| !chunk.trim().is_empty())
        .collect()
}

fn split_video_slice_subtitle_text_units(text: &str) -> Vec<String> {
    if text.chars().any(is_cjk_character) {
        let mut units = Vec::new();
        let mut latin = String::new();
        for character in text.chars() {
            if character.is_whitespace() {
                if !latin.trim().is_empty() {
                    units.push(latin.trim().to_string());
                }
                latin.clear();
                continue;
            }
            if is_cjk_character(character) || is_subtitle_punctuation(character) {
                if !latin.trim().is_empty() {
                    units.push(latin.trim().to_string());
                }
                latin.clear();
                units.push(character.to_string());
            } else {
                latin.push(character);
            }
        }
        if !latin.trim().is_empty() {
            units.push(latin.trim().to_string());
        }
        return units;
    }

    text.split_whitespace()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn join_video_slice_subtitle_text_unit(current: &str, unit: &str) -> String {
    if current.is_empty() {
        return unit.to_string();
    }
    if unit.chars().next().is_some_and(is_subtitle_punctuation)
        || current.chars().last().is_some_and(is_cjk_character)
        || unit.chars().next().is_some_and(is_cjk_character)
    {
        format!("{current}{unit}")
    } else {
        format!("{current} {unit}")
    }
}

fn should_start_new_video_slice_subtitle_chunk(current: &str, candidate: &str, unit: &str) -> bool {
    let max_units = if candidate.chars().any(is_cjk_character) {
        VIDEO_SLICE_SUBTITLE_MAX_CJK_UNITS
    } else {
        VIDEO_SLICE_SUBTITLE_MAX_LATIN_CHARS
    };
    subtitle_display_units(candidate) > max_units
        && !unit.chars().next().is_some_and(is_subtitle_punctuation)
        && subtitle_display_units(current) >= (max_units / 2).max(6)
}

fn wrap_srt_text(text: &str) -> String {
    let chunks = split_video_slice_subtitle_text_into_paced_chunks(text);
    if chunks.len() <= 1 {
        return normalize_srt_text(text);
    }

    chunks.join("\n")
}

fn trim_subtitle_chunk_punctuation(text: &str) -> String {
    text.trim()
        .trim_start_matches(is_subtitle_punctuation)
        .trim()
        .to_string()
}

fn subtitle_display_units(text: &str) -> usize {
    text.chars()
        .map(|character| if is_cjk_character(character) { 2 } else { 1 })
        .sum()
}

fn is_cjk_character(character: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&character)
        || ('\u{3400}'..='\u{4dbf}').contains(&character)
        || ('\u{f900}'..='\u{faff}').contains(&character)
}

fn is_subtitle_punctuation(character: char) -> bool {
    matches!(
        character,
        ',' | '.' | ';' | ':' | '!' | '?' | '，' | '。' | '！' | '？' | '、' | '；' | '：'
    )
}

fn is_subtitle_sentence_terminal_punctuation(character: char) -> bool {
    matches!(
        character,
        '.' | '!' | '?' | '\u{3002}' | '\u{ff01}' | '\u{ff1f}'
    )
}

fn build_video_slice_rendered_subtitle_ranges(
    clip: &AutoCutVideoSliceClipRequest,
    segment: &AutoCutSpeechTranscriptionSegment,
) -> Vec<(i64, i64)> {
    if let Some(source_segments) = video_slice_compacted_source_segments(clip) {
        let mut ranges = Vec::new();
        let mut rendered_cursor_ms = 0;
        for source_segment in source_segments {
            let overlap_start_ms = segment.start_ms.max(source_segment.start_ms);
            let overlap_end_ms = segment.end_ms.min(source_segment.end_ms);
            if overlap_end_ms > overlap_start_ms {
                ranges.push((
                    rendered_cursor_ms + overlap_start_ms - source_segment.start_ms,
                    rendered_cursor_ms + overlap_end_ms - source_segment.start_ms,
                ));
            }
            rendered_cursor_ms += source_segment
                .end_ms
                .saturating_sub(source_segment.start_ms)
                .max(0);
        }
        return ranges;
    }

    let clip_start_ms = clip.start_ms;
    let clip_end_ms = clip.start_ms.saturating_add(clip.duration_ms);
    let overlap_start_ms = segment.start_ms.max(clip_start_ms);
    let overlap_end_ms = segment.end_ms.min(clip_end_ms);
    if overlap_end_ms <= overlap_start_ms {
        return Vec::new();
    }

    vec![(
        overlap_start_ms.saturating_sub(clip_start_ms),
        overlap_end_ms.saturating_sub(clip_start_ms),
    )]
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
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    subtitle_style_id: Option<&str>,
) -> Option<String> {
    let Some(burned_subtitle_path) = burned_subtitle_path else {
        return filter_chain;
    };
    let force_style =
        build_video_slice_burned_subtitle_force_style(render_profile, subtitle_style_id);
    let subtitle_filter = format!(
        "subtitles='{}':force_style='{}'",
        escape_ffmpeg_filter_path(burned_subtitle_path),
        force_style
    );

    Some(match filter_chain {
        Some(filter_chain) => format!("{filter_chain},{subtitle_filter}"),
        None => subtitle_filter,
    })
}

fn build_video_slice_burned_subtitle_force_style(
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    subtitle_style_id: Option<&str>,
) -> String {
    let dimensions = render_profile
        .and_then(|profile| video_slice_render_dimensions(profile.target_aspect_ratio.as_str()))
        .unwrap_or((1080, 1920));
    let style = video_slice_burned_subtitle_style_preset(subtitle_style_id);
    format!(
        "FontName={},Alignment=2,MarginL={},MarginR={},MarginV={},Fontsize={},PrimaryColour={},OutlineColour={},BorderStyle=1,Outline={},Shadow={},WrapStyle=2,Bold={},Encoding=1",
        style.font_name,
        video_slice_subtitle_horizontal_margin(dimensions),
        video_slice_subtitle_horizontal_margin(dimensions),
        video_slice_subtitle_vertical_margin(dimensions),
        video_slice_subtitle_font_size(dimensions, style.font_scale),
        style.primary_colour,
        style.outline_colour,
        video_slice_subtitle_outline_size(dimensions, style.outline_scale),
        style.shadow,
        if style.bold { 1 } else { 0 }
    )
}

#[derive(Debug, Clone, Copy)]
struct AutoCutVideoSliceSubtitleStylePreset {
    font_name: &'static str,
    primary_colour: &'static str,
    outline_colour: &'static str,
    font_scale: f64,
    outline_scale: f64,
    shadow: i64,
    bold: bool,
}

fn video_slice_burned_subtitle_style_preset(
    subtitle_style_id: Option<&str>,
) -> AutoCutVideoSliceSubtitleStylePreset {
    match subtitle_style_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tiktok")
    {
        "tiktok" => AutoCutVideoSliceSubtitleStylePreset {
            font_name: "Microsoft YaHei",
            primary_colour: "&H00FFEB00",
            outline_colour: "&H005000FF",
            font_scale: 1.0,
            outline_scale: 1.0,
            shadow: 1,
            bold: true,
        },
        "minimal" | "clean-default" => AutoCutVideoSliceSubtitleStylePreset {
            font_name: "Microsoft YaHei",
            primary_colour: "&H00FFFFFF",
            outline_colour: "&H00000000",
            font_scale: 0.93,
            outline_scale: 0.75,
            shadow: 1,
            bold: false,
        },
        "variety" | "gold" | "fire" | "thick-border" => AutoCutVideoSliceSubtitleStylePreset {
            font_name: "Microsoft YaHei",
            primary_colour: "&H0000FCFF",
            outline_colour: "&H00000000",
            font_scale: 1.04,
            outline_scale: 1.25,
            shadow: 1,
            bold: true,
        },
        "neon" | "gradient-cyan" | "retro-pop" | "title-retro" | "3d-block" | "bubble-gum" => {
            AutoCutVideoSliceSubtitleStylePreset {
                font_name: "Microsoft YaHei",
                primary_colour: "&H00FFFFFF",
                outline_colour: "&H00FF26D9",
                font_scale: 0.98,
                outline_scale: 0.9,
                shadow: 1,
                bold: true,
            }
        }
        _ => AutoCutVideoSliceSubtitleStylePreset {
            font_name: "Microsoft YaHei",
            primary_colour: "&H00FFFFFF",
            outline_colour: "&H00000000",
            font_scale: 1.0,
            outline_scale: 0.85,
            shadow: 1,
            bold: false,
        },
    }
}

fn video_slice_subtitle_horizontal_margin(dimensions: (i64, i64)) -> i64 {
    let (width, height) = dimensions;
    let ratio = if height > width { 0.059 } else { 0.075 };
    ((width as f64) * ratio).round().clamp(48.0, 144.0) as i64
}

fn video_slice_subtitle_vertical_margin(dimensions: (i64, i64)) -> i64 {
    let (width, height) = dimensions;
    let ratio = if height > width { 0.0875 } else { 0.065 };
    ((height as f64) * ratio).round().clamp(70.0, 168.0) as i64
}

fn video_slice_subtitle_font_size(dimensions: (i64, i64), style_scale: f64) -> i64 {
    let (width, height) = dimensions;
    let base = if height > width {
        (width as f64) * 0.05
    } else {
        (height as f64) * 0.04
    };
    (base * style_scale).round().clamp(34.0, 54.0) as i64
}

fn video_slice_subtitle_outline_size(dimensions: (i64, i64), style_scale: f64) -> i64 {
    let (width, height) = dimensions;
    let short_edge = width.min(height) as f64;
    (short_edge * 0.0037 * style_scale).round().clamp(2.0, 7.0) as i64
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
    command.args([
        "-metadata:s:v:0",
        "rotate=",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
    ]);
}

fn video_slice_stream_copy_fast_path_allowed(
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
    burned_subtitle_path: Option<&Path>,
) -> bool {
    render_profile.is_none()
        && burned_subtitle_path.is_none()
        && video_slice_compacted_source_segments(clip).is_none()
        && ffmpeg_video_slice_audio_filter(
            clip,
            apply_audio_noise_reduction,
            source_has_audio_stream,
        )
        .is_none()
}

fn ffmpeg_video_slice_audio_noise_reduction_filter() -> &'static str {
    "highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25"
}

fn ffmpeg_video_slice_audio_loudness_filter() -> &'static str {
    "loudnorm=I=-16:TP=-1.5:LRA=11"
}

fn video_slice_rendered_duration_ms(clip: &AutoCutVideoSliceClipRequest) -> i64 {
    clip.source_segments
        .as_deref()
        .filter(|segments| !segments.is_empty())
        .map(|segments| {
            segments
                .iter()
                .map(|segment| segment.end_ms.saturating_sub(segment.start_ms).max(0))
                .sum::<i64>()
        })
        .filter(|duration_ms| *duration_ms > 0)
        .or(clip.rendered_duration_ms)
        .unwrap_or(clip.duration_ms)
}

fn ffmpeg_video_slice_audio_activity_analysis_filter(apply_audio_noise_reduction: bool) -> String {
    let mut filters = Vec::new();
    if apply_audio_noise_reduction {
        filters.push(ffmpeg_video_slice_audio_noise_reduction_filter());
    }
    filters.push(SMART_SLICE_AUDIO_ACTIVITY_SILENCE_DETECT_FILTER);
    filters.join(",")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoCutVideoSliceAudioPostprocessDecision {
    RunMissingCleanupPlan,
    SkipNoAudioStream,
    SkipPrecomputedSourceSegments,
    SkipUpstreamAudioActivityPlan,
}

impl AutoCutVideoSliceAudioPostprocessDecision {
    fn should_run(self) -> bool {
        matches!(self, Self::RunMissingCleanupPlan)
    }

    fn reason(self) -> &'static str {
        match self {
            Self::RunMissingCleanupPlan => "missing-cleanup-plan",
            Self::SkipNoAudioStream => "no-audio-stream",
            Self::SkipPrecomputedSourceSegments => "precomputed-source-segments",
            Self::SkipUpstreamAudioActivityPlan => "upstream-audio-activity-plan",
        }
    }
}

fn has_video_slice_precomputed_source_segments(clip: &AutoCutVideoSliceClipRequest) -> bool {
    video_slice_compacted_source_segments(clip).is_some()
}

fn has_trusted_video_slice_upstream_audio_activity_plan(
    clip: &AutoCutVideoSliceClipRequest,
    _apply_audio_noise_reduction: bool,
) -> bool {
    let source_start_ms = clip.source_start_ms.unwrap_or(clip.start_ms);
    let source_end_ms = clip
        .source_end_ms
        .unwrap_or_else(|| clip.start_ms.saturating_add(clip.duration_ms));
    let Some(audio_activity_start_ms) = clip.audio_activity_start_ms else {
        return false;
    };
    let Some(audio_activity_end_ms) = clip.audio_activity_end_ms else {
        return false;
    };
    let Some(audio_activity_confidence) = clip.audio_activity_confidence else {
        return false;
    };
    let Some(audio_activity_analysis_filter) = clip
        .audio_activity_analysis_filter
        .as_deref()
        .map(str::trim)
    else {
        return false;
    };
    let raw_analysis_filter = ffmpeg_video_slice_audio_activity_analysis_filter(false);
    let denoised_analysis_filter = ffmpeg_video_slice_audio_activity_analysis_filter(true);

    audio_activity_confidence >= 0.8
        && audio_activity_start_ms >= source_start_ms
        && audio_activity_end_ms <= source_end_ms
        && audio_activity_end_ms > audio_activity_start_ms
        && (audio_activity_analysis_filter == raw_analysis_filter
            || audio_activity_analysis_filter == denoised_analysis_filter)
        && clip.noise_reduction_applied.is_some()
}

fn should_run_video_slice_audio_cleanup_postprocess(
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
) -> AutoCutVideoSliceAudioPostprocessDecision {
    if !source_has_audio_stream {
        return AutoCutVideoSliceAudioPostprocessDecision::SkipNoAudioStream;
    }
    if has_video_slice_precomputed_source_segments(clip) {
        return AutoCutVideoSliceAudioPostprocessDecision::SkipPrecomputedSourceSegments;
    }
    if has_trusted_video_slice_upstream_audio_activity_plan(clip, apply_audio_noise_reduction) {
        return AutoCutVideoSliceAudioPostprocessDecision::SkipUpstreamAudioActivityPlan;
    }

    AutoCutVideoSliceAudioPostprocessDecision::RunMissingCleanupPlan
}

fn create_video_slice_render_pass_clip(
    clip: &AutoCutVideoSliceClipRequest,
    audio_postprocess_decision: AutoCutVideoSliceAudioPostprocessDecision,
) -> AutoCutVideoSliceClipRequest {
    if audio_postprocess_decision.should_run() {
        create_video_slice_initial_render_clip(clip)
    } else {
        clip.clone()
    }
}

fn should_apply_video_slice_audio_cleanup_during_render_pass(
    audio_postprocess_decision: AutoCutVideoSliceAudioPostprocessDecision,
    apply_audio_noise_reduction: bool,
) -> bool {
    !audio_postprocess_decision.should_run() && apply_audio_noise_reduction
}

fn create_video_slice_final_clip_after_skipped_postprocess(
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
) -> AutoCutVideoSliceClipRequest {
    let mut final_clip = clip.clone();
    final_clip.noise_reduction_applied = Some(apply_audio_noise_reduction);
    if final_clip.audio_activity_start_ms.is_some()
        && final_clip.audio_activity_end_ms.is_some()
        && final_clip.audio_activity_confidence.is_some()
    {
        final_clip.audio_activity_analysis_filter = Some(
            ffmpeg_video_slice_audio_activity_analysis_filter(apply_audio_noise_reduction),
        );
    }
    final_clip
}

fn ffmpeg_video_slice_audio_filter(
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
) -> Option<String> {
    if !source_has_audio_stream {
        return None;
    }

    let mut filters = Vec::new();
    if apply_audio_noise_reduction {
        filters.push(ffmpeg_video_slice_audio_noise_reduction_filter().to_string());
    }

    for range in clip.audio_mute_ranges.as_deref().unwrap_or_default() {
        if range.end_ms <= range.start_ms {
            continue;
        }
        let relative_start_ms = range.start_ms.saturating_sub(clip.start_ms).max(0);
        let relative_end_ms = range
            .end_ms
            .saturating_sub(clip.start_ms)
            .min(clip.duration_ms);
        if relative_end_ms <= relative_start_ms {
            continue;
        }
        filters.push(format!(
            "volume=enable='between(t,{},{})':volume=0",
            seconds_arg_from_millis(relative_start_ms),
            seconds_arg_from_millis(relative_end_ms)
        ));
    }

    if matches!(clip.tail_treatment.as_deref(), Some("fade-out")) && clip.duration_ms > 300 {
        let fade_duration_ms = 180.min(clip.duration_ms / 3).max(80);
        let fade_start_ms = clip.duration_ms.saturating_sub(fade_duration_ms);
        filters.push(format!(
            "afade=t=out:st={}:d={}",
            seconds_arg_from_millis(fade_start_ms),
            seconds_arg_from_millis(fade_duration_ms)
        ));
    }

    if apply_audio_noise_reduction {
        filters.push(ffmpeg_video_slice_audio_loudness_filter().to_string());
    }

    (!filters.is_empty()).then(|| filters.join(","))
}

fn build_ffmpeg_video_slice_audio_activity_analysis_command(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
) -> Command {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y"]);
    command.args(["-ss", seconds_arg_from_millis(clip.start_ms).as_str()]);
    command.args(["-i"]);
    command.arg(input_path);
    command.args(["-t", seconds_arg_from_millis(clip.duration_ms).as_str()]);
    command.args(["-vn", "-map", "0:a:0"]);
    let analysis_filter =
        ffmpeg_video_slice_audio_activity_analysis_filter(apply_audio_noise_reduction);
    command.args(["-af", analysis_filter.as_str(), "-f", "null", "-"]);
    command
}

fn run_ffmpeg_video_slice_audio_activity_analysis(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    index: usize,
    apply_audio_noise_reduction: bool,
) -> Result<AutoCutVideoSliceAudioActivityAnalysis, String> {
    let mut command = build_ffmpeg_video_slice_audio_activity_analysis_command(
        toolchain,
        input_path,
        clip,
        apply_audio_noise_reduction,
    );
    let output = command.output().map_err(|error| {
        format!(
            "run AutoCut Smart Slice audio activity analysis for clip {} failed: {error}",
            index + 1
        )
    })?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!(
            "AutoCut Smart Slice audio activity analysis for clip {} failed with status {}: {}",
            index + 1,
            output.status,
            stderr.trim()
        ));
    }

    create_video_slice_audio_activity_analysis_from_silencedetect_stderr(
        clip,
        index,
        apply_audio_noise_reduction,
        stderr.as_ref(),
    )
}

fn run_ffmpeg_visual_evidence_extraction(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    profile: &str,
    scene_change_threshold: f64,
    min_shot_duration_ms: i64,
    include_frame_quality: bool,
    include_frame_fingerprint: bool,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<AutoCutVisualEvidenceExtractionResult, String> {
    heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
    let source_duration_ms = read_ffmpeg_media_duration_millis(toolchain, input_path)?;
    if source_duration_ms <= 0 {
        return Err(
            "AutoCut visual evidence extraction requires a positive source duration.".to_string(),
        );
    }
    record_ops_task_progress(
        connection,
        task_uuid,
        15,
        json!({
            "operation": "visualEvidenceExtraction",
            "phase": "source-duration-probed",
            "provider": "ffmpeg-scene",
            "sourceDurationMs": source_duration_ms
        }),
    )?;

    let mut scene_command = new_autocut_hidden_child_command(&toolchain.executable);
    scene_command
        .args(["-hide_banner", "-nostdin", "-y"])
        .arg("-i")
        .arg(input_path)
        .args([
            "-vf",
            format!("select='gt(scene,{scene_change_threshold})',showinfo").as_str(),
            "-an",
            "-f",
            "null",
            "-",
        ]);
    let output = run_tracked_visual_evidence_ffmpeg_command(
        connection,
        task_uuid,
        &mut scene_command,
        "visual scene extraction",
        worker_lease,
    )?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg visual scene extraction failed with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    record_ops_task_progress(
        connection,
        task_uuid,
        55,
        json!({
            "operation": "visualEvidenceExtraction",
            "phase": "ffmpeg-scene-analysis-completed",
            "provider": "ffmpeg-scene"
        }),
    )?;

    let scene_change_points = parse_ffmpeg_showinfo_pts_times_to_millis(stderr.as_ref());
    let shots = create_visual_evidence_shots_from_scene_changes(
        &scene_change_points,
        source_duration_ms,
        min_shot_duration_ms,
    )?;
    let scene_boundaries = create_visual_evidence_scene_boundaries(profile, &shots);
    let frame_quality = include_frame_quality.then(|| {
        create_visual_evidence_frame_quality_samples(source_duration_ms, &scene_change_points)
    });
    heartbeat_ops_worker_lease(connection, worker_lease, 100)?;
    let frame_fingerprints = if include_frame_fingerprint {
        Some(create_visual_evidence_frame_fingerprints(
            connection,
            task_uuid,
            toolchain,
            input_path,
            source_duration_ms,
            &shots,
            worker_lease,
        )?)
    } else {
        None
    };
    record_ops_task_progress(
        connection,
        task_uuid,
        80,
        json!({
            "operation": "visualEvidenceExtraction",
            "phase": "visual-evidence-normalized",
            "provider": "ffmpeg-scene",
            "shotCount": shots.len(),
            "sceneBoundaryCount": scene_boundaries.len(),
            "frameFingerprintSampleCount": frame_fingerprints.as_ref().map(Vec::len).unwrap_or(0)
        }),
    )?;

    Ok(AutoCutVisualEvidenceExtractionResult {
        task_uuid: String::new(),
        source_asset_uuid: String::new(),
        provider: "ffmpeg-scene".to_string(),
        profile: profile.to_string(),
        ready: true,
        shots,
        scene_boundaries,
        frame_quality,
        frame_fingerprints,
        diagnostics: vec![
            format!(
                "ffmpeg-scene provider threshold={scene_change_threshold} minShotDurationMs={min_shot_duration_ms} includeFrameFingerprint={include_frame_fingerprint}"
            ),
            format!("sourceDurationMs={source_duration_ms}"),
        ],
    })
}

fn run_tracked_visual_evidence_ffmpeg_command(
    connection: &Connection,
    task_uuid: &str,
    command: &mut Command,
    operation_label: &str,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<Output, String> {
    run_tracked_native_media_command(task_uuid, command, operation_label, |_| {
        heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
        Ok(())
    })
}

fn parse_ffmpeg_showinfo_pts_times_to_millis(stderr: &str) -> Vec<i64> {
    let mut points = stderr
        .lines()
        .filter_map(parse_ffmpeg_showinfo_pts_time_to_millis)
        .filter(|point| *point > 0)
        .collect::<Vec<_>>();
    points.sort_unstable();
    points.dedup_by(|left, right| left.abs_diff(*right) <= 20);
    points
}

fn parse_ffmpeg_showinfo_pts_time_to_millis(line: &str) -> Option<i64> {
    let marker = "pts_time:";
    let start = line.find(marker)? + marker.len();
    let value = line[start..].split_whitespace().next()?.trim();
    seconds_text_to_millis(value)
}

fn seconds_text_to_millis(value: &str) -> Option<i64> {
    let seconds = value.parse::<f64>().ok()?;
    if !seconds.is_finite() {
        return None;
    }
    Some((seconds * 1_000.0).round() as i64)
}

fn create_visual_evidence_shots_from_scene_changes(
    scene_change_points: &[i64],
    source_duration_ms: i64,
    min_shot_duration_ms: i64,
) -> Result<Vec<AutoCutVisualEvidenceShot>, String> {
    let mut boundaries = vec![0];
    for point in scene_change_points {
        let point = (*point).clamp(0, source_duration_ms);
        let Some(previous) = boundaries.last().copied() else {
            continue;
        };
        if point - previous >= min_shot_duration_ms
            && source_duration_ms.saturating_sub(point) >= min_shot_duration_ms
        {
            boundaries.push(point);
        }
    }
    if boundaries.last().copied() != Some(source_duration_ms) {
        boundaries.push(source_duration_ms);
    }
    boundaries.sort_unstable();
    boundaries.dedup();

    let mut shots = Vec::new();
    for window in boundaries.windows(2) {
        let start_ms = window[0].clamp(0, source_duration_ms);
        let end_ms = window[1].clamp(0, source_duration_ms);
        if end_ms <= start_ms {
            continue;
        }
        shots.push(AutoCutVisualEvidenceShot {
            id: format!("shot-{:03}", shots.len() + 1),
            start_ms,
            end_ms,
            confidence: if scene_change_points.is_empty() {
                0.82
            } else {
                0.91
            },
        });
    }

    if shots.is_empty() && source_duration_ms > 0 {
        shots.push(AutoCutVisualEvidenceShot {
            id: "shot-001".to_string(),
            start_ms: 0,
            end_ms: source_duration_ms,
            confidence: 0.82,
        });
    }
    if shots.is_empty() {
        return Err(
            "AutoCut visual evidence extraction produced no timestamped shot ranges.".to_string(),
        );
    }
    Ok(shots)
}

fn create_visual_evidence_scene_boundaries(
    profile: &str,
    shots: &[AutoCutVisualEvidenceShot],
) -> Vec<AutoCutVisualEvidenceSceneBoundary> {
    if profile == "shot-boundary-v1" {
        return Vec::new();
    }
    shots
        .iter()
        .map(|shot| AutoCutVisualEvidenceSceneBoundary {
            start_ms: shot.start_ms,
            end_ms: shot.end_ms,
        })
        .collect()
}

fn create_visual_evidence_frame_quality_samples(
    source_duration_ms: i64,
    scene_change_points: &[i64],
) -> Vec<AutoCutVisualEvidenceFrameQualitySample> {
    let mut sample_points = vec![
        0,
        source_duration_ms / 2,
        source_duration_ms.saturating_sub(1).max(0),
    ];
    sample_points.extend(scene_change_points.iter().copied());
    sample_points.sort_unstable();
    sample_points.dedup();
    sample_points
        .into_iter()
        .filter(|at_ms| *at_ms >= 0 && *at_ms <= source_duration_ms)
        .take(24)
        .map(|at_ms| AutoCutVisualEvidenceFrameQualitySample {
            at_ms,
            blur_score: 0.88,
            exposure_score: 0.88,
            stability_score: 0.86,
        })
        .collect()
}

fn create_visual_evidence_frame_fingerprints(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    source_duration_ms: i64,
    shots: &[AutoCutVisualEvidenceShot],
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<Vec<AutoCutVisualEvidenceFrameFingerprintSample>, String> {
    let sample_points =
        create_visual_evidence_frame_fingerprint_sample_points(source_duration_ms, shots);
    let mut fingerprints = Vec::new();
    for at_ms in sample_points {
        if let Some(pixels) = extract_visual_evidence_luma_frame_pixels(
            connection,
            task_uuid,
            toolchain,
            input_path,
            at_ms,
            worker_lease,
        )? {
            fingerprints.push(create_visual_evidence_frame_fingerprint_sample(
                at_ms, &pixels,
            )?);
        }
    }
    if fingerprints.is_empty() {
        return Err(
            "AutoCut visual evidence extraction produced no frame fingerprints.".to_string(),
        );
    }
    Ok(fingerprints)
}

fn create_visual_evidence_frame_fingerprint_sample_points(
    source_duration_ms: i64,
    shots: &[AutoCutVisualEvidenceShot],
) -> Vec<i64> {
    let safe_end_ms = if source_duration_ms > 500 {
        source_duration_ms.saturating_sub(300)
    } else {
        0
    };
    let mut points = vec![
        0,
        (source_duration_ms / 2).clamp(0, safe_end_ms),
        safe_end_ms,
    ];
    for shot in shots.iter().take(9) {
        let midpoint = shot.start_ms + (shot.end_ms - shot.start_ms).max(0) / 2;
        points.push(midpoint.clamp(0, safe_end_ms));
    }
    points.sort_unstable();
    points.dedup_by(|left, right| left.abs_diff(*right) <= 250);
    points.into_iter().take(12).collect()
}

fn extract_visual_evidence_luma_frame_pixels(
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    at_ms: i64,
    worker_lease: &AutoCutOpsWorkerLease,
) -> Result<Option<Vec<u8>>, String> {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command
        .args(["-hide_banner", "-nostdin", "-v", "error", "-ss"])
        .arg(seconds_arg_from_millis(at_ms).as_str())
        .arg("-i")
        .arg(input_path)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=8:8:flags=area,format=gray",
            "-f",
            "rawvideo",
            "pipe:1",
        ]);
    let output = run_tracked_visual_evidence_ffmpeg_command(
        connection,
        task_uuid,
        &mut command,
        "visual frame fingerprint extraction",
        worker_lease,
    )?;
    if !output.status.success() {
        return Err(format!(
            "AutoCut FFmpeg visual frame fingerprint extraction failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if output.stdout.is_empty() {
        return Ok(None);
    }
    if output.stdout.len() != 64 {
        return Err(format!(
            "AutoCut FFmpeg visual frame fingerprint extraction expected 64 luma bytes, got {}.",
            output.stdout.len()
        ));
    }
    Ok(Some(output.stdout))
}

fn create_visual_evidence_frame_fingerprint_sample(
    at_ms: i64,
    pixels: &[u8],
) -> Result<AutoCutVisualEvidenceFrameFingerprintSample, String> {
    if pixels.len() != 64 {
        return Err(
            "AutoCut visual frame fingerprint requires exactly 64 luma pixels.".to_string(),
        );
    }
    let mean = pixels.iter().map(|value| *value as f64).sum::<f64>() / pixels.len() as f64;
    let mut bits: u64 = 0;
    for (index, value) in pixels.iter().enumerate() {
        if (*value as f64) >= mean {
            bits |= 1_u64 << (63 - index);
        }
    }
    let mut histogram_counts = [0_u32; 8];
    for value in pixels {
        let bucket =
            ((*value as usize) * histogram_counts.len() / 256).min(histogram_counts.len() - 1);
        histogram_counts[bucket] += 1;
    }
    let histogram = histogram_counts
        .iter()
        .map(|count| ((*count as f64 / pixels.len() as f64) * 10_000.0).round() / 10_000.0)
        .collect::<Vec<_>>();

    Ok(AutoCutVisualEvidenceFrameFingerprintSample {
        at_ms,
        algorithm: "ahash-8x8-luma-v1",
        hash: format!("{bits:016x}"),
        mean_luma: ((mean / 255.0) * 10_000.0).round() / 10_000.0,
        histogram,
    })
}

#[derive(Debug, Clone)]
struct AutoCutSilenceInterval {
    start_ms: i64,
    end_ms: i64,
}

fn create_video_slice_audio_activity_analysis_from_silencedetect_stderr(
    clip: &AutoCutVideoSliceClipRequest,
    index: usize,
    apply_audio_noise_reduction: bool,
    stderr: &str,
) -> Result<AutoCutVideoSliceAudioActivityAnalysis, String> {
    let duration_ms = clip.duration_ms.max(0);
    let intervals = parse_ffmpeg_silencedetect_intervals(stderr, duration_ms);
    let leading_silence_ms = intervals
        .iter()
        .find(|interval| interval.start_ms <= SMART_SLICE_AUDIO_ACTIVITY_EDGE_TOLERANCE_MS)
        .map(|interval| interval.end_ms.clamp(0, duration_ms));
    let trailing_silence_ms = intervals
        .iter()
        .rev()
        .find(|interval| {
            interval.end_ms >= duration_ms - SMART_SLICE_AUDIO_ACTIVITY_EDGE_TOLERANCE_MS
        })
        .map(|interval| duration_ms.saturating_sub(interval.start_ms.clamp(0, duration_ms)));
    let activity_start_offset_ms = leading_silence_ms.unwrap_or(0).clamp(0, duration_ms);
    let activity_end_offset_ms = duration_ms
        .saturating_sub(trailing_silence_ms.unwrap_or(0))
        .clamp(0, duration_ms);

    if activity_end_offset_ms <= activity_start_offset_ms {
        return Err(format!(
            "AutoCut Smart Slice audio activity analysis for clip {} requires high-confidence audio activity before native rendering.",
            index + 1
        ));
    }
    let audio_activity_start_ms = Some(clip.start_ms.saturating_add(activity_start_offset_ms));
    let audio_activity_end_ms = Some(clip.start_ms.saturating_add(activity_end_offset_ms));
    let confidence = 0.86;
    let internal_silence_intervals = intervals
        .iter()
        .filter(|interval| {
            interval.start_ms > SMART_SLICE_AUDIO_ACTIVITY_EDGE_TOLERANCE_MS
                && interval.end_ms < duration_ms - SMART_SLICE_AUDIO_ACTIVITY_EDGE_TOLERANCE_MS
                && interval.end_ms > interval.start_ms
        })
        .map(|interval| AutoCutVideoSliceSourceSegment {
            start_ms: clip.start_ms.saturating_add(interval.start_ms),
            end_ms: clip.start_ms.saturating_add(interval.end_ms),
        })
        .collect::<Vec<_>>();

    Ok(AutoCutVideoSliceAudioActivityAnalysis {
        index: i64::try_from(index).unwrap_or(i64::MAX),
        start_ms: clip.start_ms,
        duration_ms: clip.duration_ms,
        source_start_ms: clip.source_start_ms.unwrap_or(clip.start_ms),
        source_end_ms: clip
            .source_end_ms
            .unwrap_or(clip.start_ms.saturating_add(clip.duration_ms)),
        audio_activity_start_ms,
        audio_activity_end_ms,
        leading_silence_ms,
        trailing_silence_ms,
        internal_silence_intervals: (!internal_silence_intervals.is_empty())
            .then_some(internal_silence_intervals),
        confidence,
        analysis_filter: ffmpeg_video_slice_audio_activity_analysis_filter(
            apply_audio_noise_reduction,
        ),
    })
}

fn parse_ffmpeg_silencedetect_intervals(
    stderr: &str,
    duration_ms: i64,
) -> Vec<AutoCutSilenceInterval> {
    let mut intervals = Vec::new();
    let mut open_start_ms = None::<i64>;
    for line in stderr.lines() {
        if let Some(start_ms) = parse_ffmpeg_silencedetect_value_ms(line, "silence_start:") {
            open_start_ms = Some(start_ms.clamp(0, duration_ms.max(0)));
        }
        if let Some(end_ms) = parse_ffmpeg_silencedetect_value_ms(line, "silence_end:") {
            let end_ms = end_ms.clamp(0, duration_ms.max(0));
            let start_ms = open_start_ms.take().unwrap_or(0).clamp(0, end_ms);
            if end_ms > start_ms {
                intervals.push(AutoCutSilenceInterval { start_ms, end_ms });
            }
        }
    }

    if let Some(start_ms) = open_start_ms {
        let start_ms = start_ms.clamp(0, duration_ms.max(0));
        let end_ms = duration_ms.max(0);
        if end_ms > start_ms {
            intervals.push(AutoCutSilenceInterval { start_ms, end_ms });
        }
    }

    intervals
}

fn parse_ffmpeg_silencedetect_value_ms(line: &str, marker: &str) -> Option<i64> {
    let value_start = line.find(marker)? + marker.len();
    let value_text = line[value_start..].trim().split_whitespace().next()?;
    value_text
        .parse::<f64>()
        .ok()
        .filter(|seconds| seconds.is_finite())
        .map(|seconds| (seconds * 1_000.0).round() as i64)
}

fn create_video_slice_initial_render_clip(
    clip: &AutoCutVideoSliceClipRequest,
) -> AutoCutVideoSliceClipRequest {
    let mut render_clip = clip.clone();
    render_clip.source_segments = None;
    render_clip.audio_mute_ranges = None;
    render_clip.rendered_duration_ms = None;
    render_clip.removed_silence_ms = None;
    render_clip.internal_silence_trim_count = None;
    render_clip.tail_treatment = Some("none".to_string());
    render_clip
}

fn video_slice_relative_source_segments(
    clip: &AutoCutVideoSliceClipRequest,
    source_segments: Option<Vec<AutoCutVideoSliceSourceSegment>>,
) -> Option<Vec<AutoCutVideoSliceSourceSegment>> {
    let clip_start_ms = clip.start_ms;
    let clip_end_ms = clip.start_ms.saturating_add(clip.duration_ms);
    let segments = source_segments?;
    let relative_segments = segments
        .into_iter()
        .filter_map(|segment| {
            let start_ms = segment.start_ms.max(clip_start_ms).min(clip_end_ms);
            let end_ms = segment.end_ms.max(clip_start_ms).min(clip_end_ms);
            (end_ms > start_ms).then_some(AutoCutVideoSliceSourceSegment {
                start_ms: start_ms.saturating_sub(clip_start_ms),
                end_ms: end_ms.saturating_sub(clip_start_ms),
            })
        })
        .collect::<Vec<_>>();

    (relative_segments.len() > 1).then_some(relative_segments)
}

fn create_video_slice_postprocess_clip(
    clip: &AutoCutVideoSliceClipRequest,
    source_segments: Option<Vec<AutoCutVideoSliceSourceSegment>>,
) -> AutoCutVideoSliceClipRequest {
    let relative_source_segments = video_slice_relative_source_segments(clip, source_segments);
    let mut cleanup_clip = clip.clone();
    cleanup_clip.start_ms = 0;
    cleanup_clip.duration_ms = clip.duration_ms;
    cleanup_clip.source_start_ms = Some(0);
    cleanup_clip.source_end_ms = Some(clip.duration_ms);
    cleanup_clip.source_segments = relative_source_segments;
    cleanup_clip.rendered_duration_ms = cleanup_clip.source_segments.as_deref().map(|segments| {
        segments
            .iter()
            .map(|segment| segment.end_ms.saturating_sub(segment.start_ms).max(0))
            .sum::<i64>()
    });
    cleanup_clip.audio_mute_ranges = clip.audio_mute_ranges.as_ref().map(|ranges| {
        ranges
            .iter()
            .filter_map(|range| {
                let start_ms = range
                    .start_ms
                    .max(clip.start_ms)
                    .min(clip.start_ms + clip.duration_ms);
                let end_ms = range
                    .end_ms
                    .max(clip.start_ms)
                    .min(clip.start_ms + clip.duration_ms);
                (end_ms > start_ms).then_some(AutoCutVideoSliceAudioMuteRange {
                    start_ms: start_ms.saturating_sub(clip.start_ms),
                    end_ms: end_ms.saturating_sub(clip.start_ms),
                })
            })
            .collect::<Vec<_>>()
    });
    if cleanup_clip
        .audio_mute_ranges
        .as_ref()
        .is_some_and(Vec::is_empty)
    {
        cleanup_clip.audio_mute_ranges = None;
    }
    cleanup_clip
}

fn retained_video_slice_segments_from_silence_intervals(
    duration_ms: i64,
    intervals: &[AutoCutSilenceInterval],
) -> Option<Vec<AutoCutVideoSliceSourceSegment>> {
    let duration_ms = duration_ms.max(0);
    let mut retained_segments = Vec::new();
    let mut cursor_ms = 0;
    let mut sorted_intervals = intervals
        .iter()
        .filter_map(|interval| {
            let start_ms = interval.start_ms.clamp(0, duration_ms);
            let end_ms = interval.end_ms.clamp(0, duration_ms);
            (end_ms > start_ms).then_some(AutoCutSilenceInterval { start_ms, end_ms })
        })
        .collect::<Vec<_>>();
    sorted_intervals.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then(first.end_ms.cmp(&second.end_ms))
    });

    let mut removed_silence_ms = 0;
    for interval in sorted_intervals {
        if interval.end_ms - interval.start_ms < SMART_SLICE_POSTPROCESS_MIN_SILENCE_TRIM_MS {
            continue;
        }
        let retain_end_ms = (interval.start_ms + SMART_SLICE_POSTPROCESS_SILENCE_PAD_MS)
            .clamp(cursor_ms, duration_ms);
        if retain_end_ms - cursor_ms >= SMART_SLICE_POSTPROCESS_MIN_RETAINED_SEGMENT_MS {
            retained_segments.push(AutoCutVideoSliceSourceSegment {
                start_ms: cursor_ms,
                end_ms: retain_end_ms,
            });
        }
        let next_cursor_ms = (interval.end_ms - SMART_SLICE_POSTPROCESS_SILENCE_PAD_MS)
            .clamp(retain_end_ms, duration_ms);
        removed_silence_ms += next_cursor_ms.saturating_sub(retain_end_ms).max(0);
        cursor_ms = next_cursor_ms;
    }

    if duration_ms - cursor_ms >= SMART_SLICE_POSTPROCESS_MIN_RETAINED_SEGMENT_MS {
        retained_segments.push(AutoCutVideoSliceSourceSegment {
            start_ms: cursor_ms,
            end_ms: duration_ms,
        });
    }

    if retained_segments.len() > 1 && removed_silence_ms > 0 {
        Some(retained_segments)
    } else {
        None
    }
}

fn create_video_slice_postprocess_segments_from_silence(
    clip: &AutoCutVideoSliceClipRequest,
    intervals: &[AutoCutSilenceInterval],
) -> Option<Vec<AutoCutVideoSliceSourceSegment>> {
    retained_video_slice_segments_from_silence_intervals(clip.duration_ms, intervals).map(
        |segments| {
            segments
                .into_iter()
                .map(|segment| AutoCutVideoSliceSourceSegment {
                    start_ms: clip.start_ms.saturating_add(segment.start_ms),
                    end_ms: clip.start_ms.saturating_add(segment.end_ms),
                })
                .collect()
        },
    )
}

fn video_slice_filter_chain_for_encoder_candidate(
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    burned_subtitle_path: Option<&Path>,
    subtitle_style_id: Option<&str>,
    candidate: &AutoCutVideoSliceEncoderCandidate,
) -> Option<String> {
    let filter_chain = append_video_slice_burned_subtitle_filter(
        video_slice_render_filter_chain(render_profile),
        burned_subtitle_path,
        render_profile,
        subtitle_style_id,
    );
    let filter_chain = Some(append_video_slice_clear_display_matrix_filter(filter_chain));
    match (filter_chain, candidate.filter_chain_suffix.as_deref()) {
        (Some(filter_chain), Some(suffix)) => Some(format!("{filter_chain},{suffix}")),
        (Some(filter_chain), None) => Some(filter_chain),
        (None, Some(suffix)) => Some(suffix.to_string()),
        (None, None) => None,
    }
}

struct AutoCutVideoSliceComplexFilter {
    filter_complex: String,
    video_label: String,
    audio_label: Option<String>,
}

fn video_slice_compacted_source_segments(
    clip: &AutoCutVideoSliceClipRequest,
) -> Option<&[AutoCutVideoSliceSourceSegment]> {
    let segments = clip
        .source_segments
        .as_deref()?
        .iter()
        .filter(|segment| segment.end_ms > segment.start_ms)
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return None;
    }

    if segments.len() == 1 {
        let segment = segments[0];
        let clip_start_ms = clip.source_start_ms.unwrap_or(clip.start_ms);
        let clip_end_ms = clip
            .source_end_ms
            .unwrap_or(clip.start_ms.saturating_add(clip.duration_ms));
        if segment.start_ms <= clip_start_ms && segment.end_ms >= clip_end_ms {
            return None;
        }
    }

    clip.source_segments.as_deref()
}

fn ffmpeg_video_slice_compacted_audio_mute_ranges(
    clip: &AutoCutVideoSliceClipRequest,
) -> Vec<AutoCutVideoSliceAudioMuteRange> {
    let Some(source_segments) = video_slice_compacted_source_segments(clip) else {
        return Vec::new();
    };
    let mut output_ranges = Vec::new();
    let mut rendered_cursor_ms = 0;
    for source_segment in source_segments {
        for range in clip.audio_mute_ranges.as_deref().unwrap_or_default() {
            let overlap_start_ms = range.start_ms.max(source_segment.start_ms);
            let overlap_end_ms = range.end_ms.min(source_segment.end_ms);
            if overlap_end_ms <= overlap_start_ms {
                continue;
            }
            output_ranges.push(AutoCutVideoSliceAudioMuteRange {
                start_ms: rendered_cursor_ms + overlap_start_ms - source_segment.start_ms,
                end_ms: rendered_cursor_ms + overlap_end_ms - source_segment.start_ms,
            });
        }
        rendered_cursor_ms += source_segment
            .end_ms
            .saturating_sub(source_segment.start_ms)
            .max(0);
    }

    output_ranges
}

fn ffmpeg_video_slice_compacted_audio_filter(
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
) -> Option<String> {
    if !source_has_audio_stream {
        return None;
    }

    let rendered_duration_ms = video_slice_rendered_duration_ms(clip);
    let mut filters = Vec::new();
    if apply_audio_noise_reduction {
        filters.push(ffmpeg_video_slice_audio_noise_reduction_filter().to_string());
    }

    for range in ffmpeg_video_slice_compacted_audio_mute_ranges(clip) {
        if range.end_ms <= range.start_ms {
            continue;
        }
        filters.push(format!(
            "volume=enable='between(t,{},{})':volume=0",
            seconds_arg_from_millis(range.start_ms),
            seconds_arg_from_millis(range.end_ms)
        ));
    }

    if matches!(clip.tail_treatment.as_deref(), Some("fade-out")) && rendered_duration_ms > 300 {
        let fade_duration_ms = 180.min(rendered_duration_ms / 3).max(80);
        let fade_start_ms = rendered_duration_ms.saturating_sub(fade_duration_ms);
        filters.push(format!(
            "afade=t=out:st={}:d={}",
            seconds_arg_from_millis(fade_start_ms),
            seconds_arg_from_millis(fade_duration_ms)
        ));
    }

    if apply_audio_noise_reduction {
        filters.push(ffmpeg_video_slice_audio_loudness_filter().to_string());
    }

    (!filters.is_empty()).then(|| filters.join(","))
}

fn build_ffmpeg_video_slice_compacted_filter_complex(
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    burned_subtitle_path: Option<&Path>,
    subtitle_style_id: Option<&str>,
    candidate: &AutoCutVideoSliceEncoderCandidate,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
) -> Option<AutoCutVideoSliceComplexFilter> {
    let source_segments = video_slice_compacted_source_segments(clip)?;
    let mut filters = Vec::new();
    let mut concat_inputs = String::new();
    for (index, _segment) in source_segments.iter().enumerate() {
        filters.push(format!("[{index}:v:0]setpts=PTS-STARTPTS[v{index}]"));
        concat_inputs.push_str(format!("[v{index}]").as_str());
        if source_has_audio_stream {
            filters.push(format!("[{index}:a:0]asetpts=PTS-STARTPTS[a{index}]"));
            concat_inputs.push_str(format!("[a{index}]").as_str());
        }
    }

    if source_has_audio_stream {
        filters.push(format!(
            "{concat_inputs}concat=n={}:v=1:a=1[vcat][acat]",
            source_segments.len()
        ));
    } else {
        filters.push(format!(
            "{concat_inputs}concat=n={}:v=1:a=0[vcat]",
            source_segments.len()
        ));
    }

    let video_label = if let Some(filter_chain) = video_slice_filter_chain_for_encoder_candidate(
        render_profile,
        burned_subtitle_path,
        subtitle_style_id,
        candidate,
    ) {
        filters.push(format!("[vcat]{filter_chain}[vout]"));
        "[vout]".to_string()
    } else {
        "[vcat]".to_string()
    };

    let audio_label = if source_has_audio_stream {
        if let Some(audio_filter) = ffmpeg_video_slice_compacted_audio_filter(
            clip,
            apply_audio_noise_reduction,
            source_has_audio_stream,
        ) {
            filters.push(format!("[acat]{audio_filter}[aout]"));
            Some("[aout]".to_string())
        } else {
            Some("[acat]".to_string())
        }
    } else {
        None
    };

    Some(AutoCutVideoSliceComplexFilter {
        filter_complex: filters.join(";"),
        video_label,
        audio_label,
    })
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
    source_has_audio_stream: bool,
    burned_subtitle_path: Option<&Path>,
    subtitle_style_id: Option<&str>,
    candidate: &AutoCutVideoSliceEncoderCandidate,
) -> Command {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y"]);
    for arg in &candidate.pre_input_args {
        command.arg(arg);
    }
    if candidate.video_codec == "copy"
        && video_slice_stream_copy_fast_path_allowed(
            clip,
            render_profile,
            apply_audio_noise_reduction,
            source_has_audio_stream,
            burned_subtitle_path,
        )
    {
        command.args(["-ss", seconds_arg_from_millis(clip.start_ms).as_str()]);
        command.args(["-i"]);
        command.arg(input_path);
        command.args(["-t", seconds_arg_from_millis(clip.duration_ms).as_str()]);
        command.args(["-map", "0:v:0", "-map", "0:a?", "-c", "copy"]);
        command.args(["-movflags", "+faststart"]);
        append_ffmpeg_progress_output_args(&mut command);
        command.arg(output_path);
        return command;
    }
    if let Some(source_segments) = video_slice_compacted_source_segments(clip) {
        for segment in source_segments {
            command.args(["-ss", seconds_arg_from_millis(segment.start_ms).as_str()]);
            command.args([
                "-t",
                seconds_arg_from_millis(segment.end_ms.saturating_sub(segment.start_ms)).as_str(),
            ]);
            command.args(["-i"]);
            command.arg(input_path);
        }
        if let Some(complex_filter) = build_ffmpeg_video_slice_compacted_filter_complex(
            clip,
            render_profile,
            burned_subtitle_path,
            subtitle_style_id,
            candidate,
            apply_audio_noise_reduction,
            source_has_audio_stream,
        ) {
            command.args(["-filter_complex", complex_filter.filter_complex.as_str()]);
            command.args(["-map", complex_filter.video_label.as_str()]);
            if let Some(audio_label) = complex_filter.audio_label {
                command.args(["-map", audio_label.as_str()]);
            }
            append_ffmpeg_video_slice_encoder_args(&mut command, candidate);
            append_ffmpeg_progress_output_args(&mut command);
            command.arg(output_path);
            return command;
        }
    }
    command.args(["-ss", seconds_arg_from_millis(clip.start_ms).as_str()]);
    command.args(["-i"]);
    command.arg(input_path);
    command.args(["-t", seconds_arg_from_millis(clip.duration_ms).as_str()]);
    command.args(["-map", "0:v:0", "-map", "0:a?"]);
    let filter_chain = video_slice_filter_chain_for_encoder_candidate(
        render_profile,
        burned_subtitle_path,
        subtitle_style_id,
        candidate,
    );
    if let Some(filter_chain) = filter_chain {
        command.args(["-vf", filter_chain.as_str()]);
    }
    if let Some(audio_filter) =
        ffmpeg_video_slice_audio_filter(clip, apply_audio_noise_reduction, source_has_audio_stream)
    {
        command.args(["-af", audio_filter.as_str()]);
    }
    append_ffmpeg_video_slice_encoder_args(&mut command, candidate);
    append_ffmpeg_progress_output_args(&mut command);
    command.arg(output_path);
    command
}

fn build_ffmpeg_video_slice_stream_copy_command(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
    burned_subtitle_path: Option<&Path>,
) -> Option<Command> {
    if !video_slice_stream_copy_fast_path_allowed(
        clip,
        render_profile,
        apply_audio_noise_reduction,
        source_has_audio_stream,
        burned_subtitle_path,
    ) {
        return None;
    }

    let candidate = AutoCutVideoSliceEncoderCandidate {
        label: "stream-copy-fast-path".to_string(),
        video_codec: "copy".to_string(),
        pre_input_args: Vec::new(),
        encoder_args: Vec::new(),
        filter_chain_suffix: None,
        requires_hardware: false,
    };
    Some(build_ffmpeg_video_slice_command(
        toolchain,
        input_path,
        output_path,
        clip,
        render_profile,
        apply_audio_noise_reduction,
        source_has_audio_stream,
        burned_subtitle_path,
        None,
        &candidate,
    ))
}

#[cfg(test)]
fn build_ffmpeg_video_slice_audio_cleanup_postprocess_command(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
    candidate: &AutoCutVideoSliceEncoderCandidate,
) -> Command {
    build_ffmpeg_video_slice_command(
        toolchain,
        input_path,
        output_path,
        clip,
        None,
        apply_audio_noise_reduction,
        source_has_audio_stream,
        None,
        None,
        candidate,
    )
}

fn build_ffmpeg_video_slice_audio_cleanup_silence_analysis_command(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    duration_ms: i64,
    apply_audio_noise_reduction: bool,
) -> Command {
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
    command.args(["-hide_banner", "-nostdin", "-y", "-i"]);
    command.arg(input_path);
    command.args(["-t", seconds_arg_from_millis(duration_ms.max(0)).as_str()]);
    command.args(["-vn", "-map", "0:a:0"]);
    let analysis_filter =
        ffmpeg_video_slice_audio_activity_analysis_filter(apply_audio_noise_reduction);
    command.args(["-af", analysis_filter.as_str(), "-f", "null", "-"]);
    command
}

fn run_ffmpeg_video_slice_audio_cleanup_silence_analysis(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    duration_ms: i64,
    clip_index: usize,
    apply_audio_noise_reduction: bool,
) -> Result<Vec<AutoCutSilenceInterval>, String> {
    let mut command = build_ffmpeg_video_slice_audio_cleanup_silence_analysis_command(
        toolchain,
        input_path,
        duration_ms,
        apply_audio_noise_reduction,
    );
    let output = command.output().map_err(|error| {
        format!(
            "run AutoCut video slice {} post-cut audio silence analysis failed: {error}",
            clip_index + 1
        )
    })?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!(
            "AutoCut video slice {} post-cut audio silence analysis failed with status {}: {}",
            clip_index + 1,
            output.status,
            stderr.trim()
        ));
    }

    Ok(parse_ffmpeg_silencedetect_intervals(
        stderr.as_ref(),
        duration_ms,
    ))
}

fn create_video_slice_final_clip_after_postprocess(
    clip: &AutoCutVideoSliceClipRequest,
    source_segments: Option<Vec<AutoCutVideoSliceSourceSegment>>,
) -> AutoCutVideoSliceClipRequest {
    let mut final_clip = clip.clone();
    final_clip.source_segments = source_segments;
    if let Some(source_segments) = final_clip.source_segments.as_deref() {
        let rendered_duration_ms = source_segments
            .iter()
            .map(|segment| segment.end_ms.saturating_sub(segment.start_ms).max(0))
            .sum::<i64>();
        let removed_silence_ms = final_clip
            .duration_ms
            .saturating_sub(rendered_duration_ms)
            .max(0);
        final_clip.rendered_duration_ms = Some(rendered_duration_ms);
        final_clip.removed_silence_ms = (removed_silence_ms > 0).then_some(removed_silence_ms);
        final_clip.internal_silence_trim_count = (source_segments.len() > 1)
            .then_some(i64::try_from(source_segments.len().saturating_sub(1)).unwrap_or(i64::MAX));
        final_clip.leading_silence_trim_ms = source_segments
            .first()
            .map(|segment| segment.start_ms.saturating_sub(final_clip.start_ms).max(0));
        final_clip.trailing_silence_trim_ms = source_segments.last().map(|segment| {
            final_clip
                .start_ms
                .saturating_add(final_clip.duration_ms)
                .saturating_sub(segment.end_ms)
                .max(0)
        });
    }

    final_clip.noise_reduction_applied.get_or_insert(false);
    final_clip
}

fn cleanup_video_slice_intermediate_artifact(path: &Path) {
    let _ = fs::remove_file(path);
}

fn run_ffmpeg_video_slice_audio_cleanup_postprocess(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    raw_output_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    apply_audio_noise_reduction: bool,
    clip_index: usize,
    total_clips: usize,
    worker_lease: &AutoCutOpsWorkerLease,
    encoder_session: &mut AutoCutVideoSliceEncoderSession,
) -> Result<(AutoCutMediaOperationOutput, AutoCutVideoSliceClipRequest), String> {
    let intervals = run_ffmpeg_video_slice_audio_cleanup_silence_analysis(
        toolchain,
        raw_output_path,
        clip.duration_ms,
        clip_index,
        apply_audio_noise_reduction,
    )?;
    let detected_source_segments =
        create_video_slice_postprocess_segments_from_silence(clip, &intervals);
    let postprocess_clip =
        create_video_slice_postprocess_clip(clip, detected_source_segments.clone());
    let video_output = run_ffmpeg_video_slice_with_encoder_fallback(
        app,
        connection,
        task_uuid,
        toolchain,
        raw_output_path,
        output_path,
        &postprocess_clip,
        None,
        apply_audio_noise_reduction,
        true,
        None,
        None,
        clip_index,
        total_clips,
        worker_lease,
        encoder_session,
    )?;
    cleanup_video_slice_intermediate_artifact(raw_output_path);
    let mut final_clip =
        create_video_slice_final_clip_after_postprocess(clip, detected_source_segments);
    final_clip.noise_reduction_applied = Some(apply_audio_noise_reduction);
    final_clip.audio_activity_analysis_filter = Some(
        ffmpeg_video_slice_audio_activity_analysis_filter(apply_audio_noise_reduction),
    );
    Ok((video_output, final_clip))
}

fn ordered_video_slice_encoder_candidate_indexes(
    candidate_count: usize,
    encoder_session: &AutoCutVideoSliceEncoderSession,
) -> Vec<usize> {
    let mut indexes = (0..candidate_count).collect::<Vec<_>>();
    let Some(preferred_index) = encoder_session.preferred_candidate_index else {
        return indexes;
    };
    if preferred_index >= candidate_count {
        return indexes;
    }
    indexes.retain(|index| *index != preferred_index);
    indexes.insert(0, preferred_index);
    indexes
}

fn run_ffmpeg_video_slice_with_encoder_fallback(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
    burned_subtitle_path: Option<&Path>,
    subtitle_style_id: Option<&str>,
    clip_index: usize,
    total_clips: usize,
    worker_lease: &AutoCutOpsWorkerLease,
    encoder_session: &mut AutoCutVideoSliceEncoderSession,
) -> Result<AutoCutMediaOperationOutput, String> {
    let candidates = autocut_video_slice_encoder_candidates();
    let mut attempts = Vec::new();

    if !encoder_session.stream_copy_disabled {
        if let Some(mut command) = build_ffmpeg_video_slice_stream_copy_command(
            toolchain,
            input_path,
            output_path,
            clip,
            render_profile,
            apply_audio_noise_reduction,
            source_has_audio_stream,
            burned_subtitle_path,
        ) {
            let _ = heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
            insert_ops_task_event(
                connection,
                task_uuid,
                OPS_TASK_EVENT_TYPE_PROGRESS,
                json!({
                    "operation": "videoSlice",
                    "phase": "ffmpeg-video-slice-stream-copy-attempt",
                    "source": "native-host",
                    "clipIndex": clip_index + 1,
                    "clipCount": total_clips,
                    "encoderLabel": "stream-copy-fast-path",
                    "videoCodec": "copy",
                    "requiresHardware": false,
                    "attempt": 1,
                    "message": "Trying stream-copy fast path before re-encoding."
                })
                .to_string(),
            )?;
            let output = run_tracked_ffmpeg_command_with_progress(
                task_uuid,
                &mut command,
                "video slicing stream-copy fast path",
                |progress| {
                    heartbeat_ops_worker_lease(connection, worker_lease, 120)?;
                    let weighted_progress =
                        weighted_slice_progress(progress, clip_index, total_clips);
                    record_ffmpeg_streaming_progress(
                        app,
                        connection,
                        task_uuid,
                        weighted_progress,
                        "videoSlice",
                    )
                },
            )?;

            if output.status.success() {
                return build_media_operation_output(
                    output_path,
                    "mp4",
                    toolchain.executable.clone(),
                );
            }

            encoder_session.stream_copy_disabled = true;
            attempts.push(AutoCutVideoSliceEncoderAttemptDiagnostic {
                label: "stream-copy-fast-path".to_string(),
                video_codec: "copy".to_string(),
                status: output.status.to_string(),
                stderr_tail: stderr_tail_for_video_slice_diagnostics(&output.stderr),
            });
            remove_partial_video_slice_output(output_path)?;
        }
    }

    let candidate_indexes =
        ordered_video_slice_encoder_candidate_indexes(candidates.len(), encoder_session);
    for candidate_index in candidate_indexes {
        let Some(candidate) = candidates.get(candidate_index) else {
            continue;
        };
        if candidate_index > 0 || !attempts.is_empty() {
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
            source_has_audio_stream,
            burned_subtitle_path,
            subtitle_style_id,
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
                    app,
                    connection,
                    task_uuid,
                    weighted_progress,
                    "videoSlice",
                )
            },
        )?;

        if output.status.success() {
            encoder_session.preferred_candidate_index = Some(candidate_index);
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
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
    output_path: &Path,
    clip: &AutoCutVideoSliceClipRequest,
    render_profile: Option<&AutoCutVideoSliceRenderProfile>,
    apply_audio_noise_reduction: bool,
    source_has_audio_stream: bool,
    burned_subtitle_path: Option<&Path>,
    subtitle_style_id: Option<&str>,
    clip_index: usize,
    total_clips: usize,
    worker_lease: &AutoCutOpsWorkerLease,
    encoder_session: &mut AutoCutVideoSliceEncoderSession,
) -> Result<AutoCutMediaOperationOutput, String> {
    run_ffmpeg_video_slice_with_encoder_fallback(
        app,
        connection,
        task_uuid,
        toolchain,
        input_path,
        output_path,
        clip,
        render_profile,
        apply_audio_noise_reduction,
        source_has_audio_stream,
        burned_subtitle_path,
        subtitle_style_id,
        clip_index,
        total_clips,
        worker_lease,
        encoder_session,
    )
}

fn run_ffmpeg_video_slice_thumbnail(
    app: Option<&AppHandle>,
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
    let thumbnail_at_ms = video_slice_source_time_for_rendered_offset_ms(
        clip,
        (video_slice_rendered_duration_ms(clip) / 2).max(1),
    );
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
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
            record_ffmpeg_streaming_progress(
                app,
                connection,
                task_uuid,
                weighted_progress,
                "videoSlice",
            )
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

fn video_slice_source_time_for_rendered_offset_ms(
    clip: &AutoCutVideoSliceClipRequest,
    offset_ms: i64,
) -> i64 {
    if let Some(source_segments) = video_slice_compacted_source_segments(clip) {
        let mut rendered_cursor_ms = 0;
        for segment in source_segments {
            let segment_duration_ms = segment.end_ms.saturating_sub(segment.start_ms).max(0);
            if offset_ms <= rendered_cursor_ms + segment_duration_ms {
                return segment
                    .start_ms
                    .saturating_add(offset_ms.saturating_sub(rendered_cursor_ms));
            }
            rendered_cursor_ms += segment_duration_ms;
        }

        return source_segments
            .last()
            .map(|segment| segment.start_ms)
            .unwrap_or(clip.start_ms);
    }

    clip.start_ms.saturating_add((clip.duration_ms / 2).max(1))
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
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
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
            record_ffmpeg_streaming_progress(None, connection, task_uuid, progress, "videoCompress")
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
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
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
            record_ffmpeg_streaming_progress(None, connection, task_uuid, progress, "videoConvert")
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
    let mut command = new_autocut_hidden_child_command(&toolchain.executable);
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
            record_ffmpeg_streaming_progress(None, connection, task_uuid, progress, "videoEnhance")
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
            SELECT uuid, name, source_uri, metadata_json
            FROM media_asset
            WHERE uuid = ?1
              AND status = ?2
            "#,
            params![normalized_uuid, OPS_STATUS_COMPLETED],
            |row| {
                let metadata_json = row.get::<_, String>(3)?;
                let metadata: Value = serde_json::from_str(&metadata_json).unwrap_or(Value::Null);
                Ok(AutoCutRegisteredMediaAsset {
                    uuid: row.get::<_, String>(0)?,
                    name: row.get::<_, String>(1)?,
                    source_uri: row.get::<_, String>(2)?,
                    has_video_stream: metadata
                        .get("hasVideoStream")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
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
        OPS_TASK_TYPE_AUDIO_FINGERPRINT => {
            let retry_request = read_audio_fingerprint_retry_request(&source_task)?;
            extract_autocut_audio_fingerprint_in_root_with_toolchain(
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
                None,
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
                None,
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

impl AutoCutMediaProbeEvidence {
    fn stream_evidence(self) -> AutoCutMediaStreamEvidence {
        AutoCutMediaStreamEvidence {
            has_audio_stream: self.has_audio_stream,
            has_video_stream: self.has_video_stream,
        }
    }
}

fn parse_ffmpeg_media_probe_evidence(ffmpeg_output: &str) -> AutoCutMediaProbeEvidence {
    AutoCutMediaProbeEvidence {
        has_audio_stream: ffmpeg_output
            .lines()
            .any(|line| line.contains("Stream #") && line.contains("Audio:")),
        has_video_stream: ffmpeg_output
            .lines()
            .any(|line| line.contains("Stream #") && line.contains("Video:")),
        duration_ms: parse_ffmpeg_duration_millis(ffmpeg_output),
    }
}

fn probe_autocut_media_evidence(
    toolchain: Option<&AutoCutFfmpegToolchain>,
    input_path: &Path,
) -> AutoCutMediaProbeEvidence {
    let Some(toolchain) = toolchain else {
        return AutoCutMediaProbeEvidence::default();
    };

    let Ok(output) = new_autocut_hidden_child_command(&toolchain.executable)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(input_path)
        .output()
    else {
        return AutoCutMediaProbeEvidence::default();
    };
    parse_ffmpeg_media_probe_evidence(String::from_utf8_lossy(&output.stderr).as_ref())
}

fn read_ffmpeg_media_duration_millis(
    toolchain: &AutoCutFfmpegToolchain,
    input_path: &Path,
) -> Result<i64, String> {
    let output = new_autocut_hidden_child_command(&toolchain.executable)
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
    let Ok(output) = new_autocut_hidden_child_command(&toolchain.executable)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(input_path)
        .output()
    else {
        return false;
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr
        .lines()
        .any(|line| line.contains("Stream #") && line.contains("Audio:"))
}

fn probe_autocut_media_stream_evidence(
    toolchain: Option<&AutoCutFfmpegToolchain>,
    input_path: &Path,
) -> AutoCutMediaStreamEvidence {
    probe_autocut_media_evidence(toolchain, input_path).stream_evidence()
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
        std::env::var("SDKWORK_AUTOCUT_WHISPER_MODEL")
            .ok()
            .as_deref(),
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
            resolve_autocut_default_bundled_speech_executable_path(manifest_paths, os, arch)
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
    let bundled_acceleration_backend = bundled_executable
        .as_ref()
        .and_then(|toolchain| toolchain.acceleration_backend.clone());
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
    let discovered_executable = if explicit_executable.is_none()
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
    let model_path = explicit_model_path
        .or(env_model_value)
        .or(default_model_value);
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
    let executable_acceleration_backend = if executable_source_kind == Some("bundled-sidecar") {
        bundled_acceleration_backend
    } else {
        None
    };

    let Some(executable) = executable else {
        diagnostics.push("AutoCut local speech transcription executablePath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.".to_string());
        return AutoCutSpeechToolchain {
            executable: String::new(),
            model_path: String::new(),
            source_kind: resolved_source_kind,
            acceleration_backend: None,
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
            acceleration_backend: None,
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
        acceleration_backend: executable_acceleration_backend,
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
        candidates.push(PathBuf::from(
            r"C:\Program Files\whisper.cpp\whisper-cli.exe",
        ));
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
        error.replace(
            "bundled FFmpeg sidecar",
            "bundled speech transcription sidecar",
        )
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
        acceleration_backend: normalize_autocut_speech_acceleration_backend(
            platform.acceleration_backend.as_deref(),
        )
        .ok()
        .flatten(),
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
            error.replace(
                "bundled FFmpeg sidecar",
                "bundled speech transcription sidecar companion",
            )
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
        normalize_autocut_speech_acceleration_backend(platform.acceleration_backend.as_deref())
            .map_err(|error| {
                format!("speech toolchain manifest platform {platform_key} {error}")
            })?;
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

fn normalize_autocut_speech_acceleration_backend(
    backend: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(backend) = backend else {
        return Ok(Some("cpu".to_string()));
    };
    let normalized_backend = backend.trim().to_ascii_lowercase();
    if normalized_backend.is_empty() {
        return Err("accelerationBackend must be non-empty when declared".to_string());
    }
    let supported = [
        "cpu", "cuda", "vulkan", "metal", "coreml", "openvino", "kompute",
    ];
    if supported
        .iter()
        .any(|candidate| *candidate == normalized_backend)
    {
        return Ok(Some(normalized_backend));
    }

    Err(format!(
        "accelerationBackend must be one of {}",
        supported.join(", ")
    ))
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

#[derive(Debug, Clone, Default)]
struct AutoCutSpeechGpuProbe {
    ready: bool,
    backend: Option<String>,
    diagnostics: Vec<String>,
}

fn probe_autocut_speech_gpu_acceleration(
    toolchain: &AutoCutSpeechToolchain,
    help_text: Option<&str>,
) -> AutoCutSpeechGpuProbe {
    let executable_path = Path::new(&toolchain.executable);
    let executable_dir = executable_path.parent().unwrap_or_else(|| Path::new(""));
    probe_autocut_speech_gpu_acceleration_in_directory(
        toolchain.executable_ready && !toolchain.executable.trim().is_empty(),
        executable_dir,
        toolchain.acceleration_backend.as_deref(),
        help_text,
    )
}

fn probe_autocut_speech_gpu_acceleration_in_directory(
    executable_ready: bool,
    executable_dir: &Path,
    declared_backend: Option<&str>,
    help_text: Option<&str>,
) -> AutoCutSpeechGpuProbe {
    if !executable_ready {
        return AutoCutSpeechGpuProbe {
            diagnostics: vec![
                "AutoCut GPU STT probe skipped because local whisper-cli is not executable-ready."
                    .to_string(),
            ],
            ..AutoCutSpeechGpuProbe::default()
        };
    }

    if let Some(backend) = declared_backend.and_then(|value| {
        normalize_autocut_speech_acceleration_backend(Some(value))
            .ok()
            .flatten()
    }) {
        if backend == "cpu" {
            return AutoCutSpeechGpuProbe {
                ready: false,
                backend: None,
                diagnostics: vec![
                    "AutoCut local speech-to-text runtime declares accelerationBackend=cpu; GPU local STT requires a CUDA, Vulkan, Metal, Core ML, Kompute, or OpenVINO runtime.".to_string(),
                ],
            };
        }
        return AutoCutSpeechGpuProbe {
            ready: true,
            backend: Some(backend.clone()),
            diagnostics: vec![format!(
                "AutoCut local speech-to-text GPU backend declared by manifest: {backend}."
            )],
        };
    }

    if let Some(backend) = detect_autocut_speech_gpu_backend(executable_dir, help_text) {
        return AutoCutSpeechGpuProbe {
            ready: true,
            backend: Some(backend.clone()),
            diagnostics: vec![format!(
                "AutoCut local speech-to-text GPU backend detected: {backend}."
            )],
        };
    }

    AutoCutSpeechGpuProbe {
        ready: false,
        backend: None,
        diagnostics: vec![
            "AutoCut local speech-to-text GPU backend was not detected. The current whisper-cli appears to be CPU-only; install or package a CUDA, Vulkan, Metal, Core ML, or OpenVINO enabled whisper.cpp runtime to enable GPU local STT.".to_string(),
        ],
    }
}

fn detect_autocut_speech_gpu_backend(
    executable_dir: &Path,
    help_text: Option<&str>,
) -> Option<String> {
    if let Some(backend) = detect_autocut_speech_gpu_backend_from_companions(executable_dir) {
        return Some(backend);
    }

    let help_text = help_text.unwrap_or_default().to_ascii_lowercase();
    if help_text.contains("core ml") || help_text.contains("coreml") {
        return Some("coreml".to_string());
    }
    if help_text.contains("ggml-metal") || help_text.contains("metal") {
        return Some("metal".to_string());
    }
    None
}

fn detect_autocut_speech_gpu_backend_from_companions(executable_dir: &Path) -> Option<String> {
    if directory_contains_file_name_fragment(executable_dir, &["ggml-cuda", "cublas", "cudart"]) {
        return Some("cuda".to_string());
    }
    if directory_contains_file_name_fragment(executable_dir, &["ggml-vulkan", "vulkan"]) {
        return Some("vulkan".to_string());
    }
    if directory_contains_file_name_fragment(executable_dir, &["ggml-metal", "metal"]) {
        return Some("metal".to_string());
    }
    if directory_contains_file_name_fragment(executable_dir, &["ggml-kompute", "kompute"]) {
        return Some("kompute".to_string());
    }
    if directory_contains_file_name_fragment(executable_dir, &["openvino"]) {
        return Some("openvino".to_string());
    }
    if directory_contains_file_name_fragment(executable_dir, &["coreml"]) {
        return Some("coreml".to_string());
    }
    None
}

fn directory_contains_file_name_fragment(directory: &Path, fragments: &[&str]) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|entry| {
        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        fragments
            .iter()
            .any(|fragment| file_name.contains(fragment))
    })
}

fn parse_whisper_transcript_json(
    source: &str,
) -> Result<Vec<AutoCutSpeechTranscriptionSegment>, String> {
    let segments = parse_whisper_transcript_json_allow_empty(source)?;
    if segments.is_empty() {
        return Err(
            "AutoCut Whisper transcript JSON contains no usable transcript segments".to_string(),
        );
    }
    Ok(segments)
}

fn parse_whisper_transcript_json_allow_empty(
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
        let words = read_whisper_segment_words(segment_value, start_ms, end_ms);
        segments.push(AutoCutSpeechTranscriptionSegment {
            start_ms,
            end_ms,
            text,
            speaker,
            words,
        });
    }

    segments.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then_with(|| first.end_ms.cmp(&second.end_ms))
    });

    Ok(segments)
}

fn ensure_speech_transcript_quality(
    segments: &[AutoCutSpeechTranscriptionSegment],
    scope: &str,
    chunk_id: Option<&str>,
    allow_empty: bool,
) -> Result<AutoCutSpeechTranscriptQualityGuard, String> {
    let guard = evaluate_speech_transcript_quality(segments, scope, chunk_id, allow_empty);
    if guard.passed {
        Ok(guard)
    } else {
        Err(format!(
            "AutoCut STT quality guard failed. scope={} chunkId={} risks={}",
            guard.scope,
            guard.chunk_id,
            guard
                .risks
                .iter()
                .map(|risk| risk.code.as_str())
                .collect::<Vec<_>>()
                .join(",")
        ))
    }
}

fn evaluate_speech_transcript_quality(
    segments: &[AutoCutSpeechTranscriptionSegment],
    scope: &str,
    chunk_id: Option<&str>,
    allow_empty: bool,
) -> AutoCutSpeechTranscriptQualityGuard {
    let mut guard = AutoCutSpeechTranscriptQualityGuard {
        schema: SPEECH_TRANSCRIPT_QUALITY_GUARD_SCHEMA.to_string(),
        status: "passed".to_string(),
        passed: true,
        scope: scope.to_string(),
        chunk_id: chunk_id.unwrap_or_default().to_string(),
        retry_count: 0,
        risk_count: 0,
        risks: Vec::new(),
        metrics: AutoCutSpeechTranscriptQualityMetrics::default(),
    };
    let normalized_segments = segments
        .iter()
        .filter(|segment| !segment.text.trim().is_empty() && segment.end_ms > segment.start_ms)
        .collect::<Vec<_>>();
    let compact_text = normalized_segments
        .iter()
        .map(|segment| segment.text.split_whitespace().collect::<String>())
        .collect::<Vec<_>>()
        .join("");
    let characters = compact_text.chars().collect::<Vec<_>>();
    let unique_characters = characters.iter().copied().collect::<HashSet<_>>();
    let replacement_character_count = compact_text
        .chars()
        .filter(|character| *character == '\u{fffd}')
        .count();
    let repeated_phrase_runs = detect_speech_transcript_repeated_phrase_runs(&characters);
    let duplicate_window_ratio = calculate_speech_transcript_duplicate_window_ratio(&characters);
    let tiny_segment_count = normalized_segments
        .iter()
        .filter(|segment| {
            segment.end_ms.saturating_sub(segment.start_ms) <= 700
                && segment.text.trim().chars().count() <= 4
        })
        .count();
    guard.metrics = AutoCutSpeechTranscriptQualityMetrics {
        segment_count: normalized_segments.len(),
        text_length: characters.len(),
        unique_character_ratio: if characters.is_empty() {
            1.0
        } else {
            unique_characters.len() as f64 / characters.len() as f64
        },
        replacement_character_count,
        repeated_phrase_run_count: repeated_phrase_runs.len(),
        duplicate_window_ratio,
        tiny_segment_ratio: if normalized_segments.is_empty() {
            0.0
        } else {
            tiny_segment_count as f64 / normalized_segments.len() as f64
        },
    };

    if normalized_segments.is_empty() && allow_empty {
        guard.status = "passed-empty".to_string();
        return guard;
    }
    if normalized_segments.is_empty() {
        guard.risks.push(AutoCutSpeechTranscriptQualityRisk {
            code: "empty-transcript".to_string(),
            severity: "blocker".to_string(),
            message: "Transcript contains no usable timestamped speech segments.".to_string(),
            example: None,
            count: None,
            ratio: None,
        });
    }
    if replacement_character_count > 0 {
        guard.risks.push(AutoCutSpeechTranscriptQualityRisk {
            code: "replacement-character".to_string(),
            severity: "blocker".to_string(),
            message: "Transcript contains Unicode replacement characters.".to_string(),
            example: None,
            count: Some(replacement_character_count),
            ratio: None,
        });
    }
    if let Some(first_run) = repeated_phrase_runs.first() {
        guard.risks.push(AutoCutSpeechTranscriptQualityRisk {
            code: "repeated-phrase-loop".to_string(),
            severity: "blocker".to_string(),
            message: "Transcript contains adjacent repeated phrase loops.".to_string(),
            example: Some(first_run.phrase.clone()),
            count: Some(repeated_phrase_runs.len()),
            ratio: None,
        });
    }
    if guard.metrics.text_length >= 24 && guard.metrics.unique_character_ratio < 0.16 {
        guard.risks.push(AutoCutSpeechTranscriptQualityRisk {
            code: "low-unique-character-ratio".to_string(),
            severity: "blocker".to_string(),
            message: "Transcript has extremely low character variety for its length.".to_string(),
            example: None,
            count: None,
            ratio: Some(round_unit_f64(guard.metrics.unique_character_ratio)),
        });
    }
    if guard.metrics.text_length >= 48 && guard.metrics.duplicate_window_ratio >= 0.42 {
        guard.risks.push(AutoCutSpeechTranscriptQualityRisk {
            code: "duplicate-window-ratio".to_string(),
            severity: "blocker".to_string(),
            message: "Transcript has too many repeated text windows.".to_string(),
            example: None,
            count: None,
            ratio: Some(round_unit_f64(guard.metrics.duplicate_window_ratio)),
        });
    }
    if normalized_segments.len() >= 8 && guard.metrics.tiny_segment_ratio > 0.7 {
        guard.risks.push(AutoCutSpeechTranscriptQualityRisk {
            code: "tiny-segment-spam".to_string(),
            severity: "blocker".to_string(),
            message: "Transcript has too many tiny low-information segments.".to_string(),
            example: None,
            count: None,
            ratio: Some(round_unit_f64(guard.metrics.tiny_segment_ratio)),
        });
    }
    guard.risk_count = guard.risks.len();
    guard.passed = guard.risk_count == 0;
    guard.status = if guard.passed {
        "passed".to_string()
    } else {
        "failed".to_string()
    };
    guard
}

fn create_combined_speech_transcript_quality_guard(
    scope: &str,
) -> AutoCutSpeechTranscriptQualityGuard {
    AutoCutSpeechTranscriptQualityGuard {
        schema: SPEECH_TRANSCRIPT_QUALITY_GUARD_SCHEMA.to_string(),
        status: "passed".to_string(),
        passed: true,
        scope: scope.to_string(),
        chunk_id: String::new(),
        retry_count: 0,
        risk_count: 0,
        risks: Vec::new(),
        metrics: AutoCutSpeechTranscriptQualityMetrics::default(),
    }
}

fn merge_speech_transcript_quality_guard(
    target: &mut AutoCutSpeechTranscriptQualityGuard,
    source: &AutoCutSpeechTranscriptQualityGuard,
) {
    for risk in &source.risks {
        target.risks.push(risk.clone());
    }
    target.risk_count = target.risks.len();
    target.passed = target.risk_count == 0;
    target.status = if target.passed {
        "passed".to_string()
    } else {
        "failed".to_string()
    };
    target.metrics.segment_count += source.metrics.segment_count;
    target.metrics.text_length += source.metrics.text_length;
    target.metrics.replacement_character_count += source.metrics.replacement_character_count;
    target.metrics.repeated_phrase_run_count += source.metrics.repeated_phrase_run_count;
    target.metrics.unique_character_ratio = target
        .metrics
        .unique_character_ratio
        .min(source.metrics.unique_character_ratio);
    target.metrics.duplicate_window_ratio = target
        .metrics
        .duplicate_window_ratio
        .max(source.metrics.duplicate_window_ratio);
    target.metrics.tiny_segment_ratio = target
        .metrics
        .tiny_segment_ratio
        .max(source.metrics.tiny_segment_ratio);
}

fn retry_local_whisper_chunk_with_stable_decode(
    speech_toolchain: &AutoCutSpeechToolchain,
    language: &str,
    chunk: &AutoCutSpeechAudioChunkPlan,
    chunk_thread_count: &str,
    execution_options: &AutoCutSpeechTranscriptionExecutionOptions,
) -> Result<Vec<AutoCutSpeechTranscriptionSegment>, String> {
    let retry_options = AutoCutSpeechTranscriptionExecutionOptions {
        whisper_audio_context: None,
        whisper_beam_size: execution_options.whisper_beam_size.or(Some(1)),
        whisper_best_of: execution_options.whisper_best_of.or(Some(1)),
        whisper_no_fallback: execution_options.whisper_no_fallback,
        ..execution_options.clone()
    };
    let retry_stem = chunk
        .transcript_stem
        .with_file_name(format!("{}-stable-retry", chunk.id));
    let mut command = build_local_whisper_transcription_command(
        speech_toolchain,
        &chunk.audio_path,
        &retry_stem,
        language,
        chunk_thread_count,
        &retry_options,
    );
    let output = command.output().map_err(|error| {
        format!(
            "run AutoCut local Whisper stable retry for chunk {} failed: {error}",
            chunk.id
        )
    })?;
    let retry_transcript_path = retry_stem.with_extension("json");
    if !output.status.success() || !retry_transcript_path.is_file() {
        return Err(format!(
            "AutoCut local Whisper stable retry for chunk {} failed with status {}: {}",
            chunk.id,
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let transcript_json = read_whisper_transcript_json_file(&retry_transcript_path).map_err(|error| {
        format!(
            "AutoCut local Whisper stable retry transcript read failed. chunkId={} transcriptPath={} {error}",
            chunk.id,
            retry_transcript_path.display()
        )
    })?;
    let retry_segments = parse_whisper_transcript_json_allow_empty(&transcript_json).map_err(|error| {
        format!(
            "AutoCut local Whisper stable retry transcript parse failed. chunkId={} transcriptPath={} {error}",
            chunk.id,
            retry_transcript_path.display()
        )
    })?;
    fs::copy(&retry_transcript_path, &chunk.transcript_path).map_err(|error| {
        format!(
            "replace AutoCut local Whisper chunk transcript after stable retry failed. chunkId={} {error}",
            chunk.id
        )
    })?;
    Ok(retry_segments)
}

#[derive(Debug, Clone)]
struct SpeechTranscriptRepeatedPhraseRun {
    phrase: String,
    start_char: usize,
    count: usize,
}

fn detect_speech_transcript_repeated_phrase_runs(
    characters: &[char],
) -> Vec<SpeechTranscriptRepeatedPhraseRun> {
    if characters.len() < 12 {
        return Vec::new();
    }
    let max_phrase_length = 18.min(characters.len() / 3);
    let mut runs = Vec::new();
    for phrase_length in 2..=max_phrase_length {
        let mut index = 0;
        while index + phrase_length * 3 <= characters.len() {
            let phrase = characters[index..index + phrase_length]
                .iter()
                .collect::<String>();
            if speech_transcript_phrase_is_low_signal(&phrase) {
                index += 1;
                continue;
            }
            let mut count = 1;
            while index + phrase_length * (count + 1) <= characters.len()
                && characters[index + phrase_length * count..index + phrase_length * (count + 1)]
                    .iter()
                    .collect::<String>()
                    == phrase
            {
                count += 1;
            }
            if count >= 3 {
                runs.push(SpeechTranscriptRepeatedPhraseRun {
                    phrase,
                    start_char: index,
                    count,
                });
                index += phrase_length * count;
            } else {
                index += 1;
            }
        }
    }
    dedupe_speech_transcript_repeated_phrase_runs(runs)
}

fn dedupe_speech_transcript_repeated_phrase_runs(
    mut runs: Vec<SpeechTranscriptRepeatedPhraseRun>,
) -> Vec<SpeechTranscriptRepeatedPhraseRun> {
    runs.sort_by(|first, second| {
        first
            .start_char
            .cmp(&second.start_char)
            .then_with(|| second.phrase.len().cmp(&first.phrase.len()))
    });
    let mut deduped: Vec<SpeechTranscriptRepeatedPhraseRun> = Vec::new();
    for run in runs {
        let overlaps_existing = deduped.iter().any(|existing| {
            run.start_char >= existing.start_char
                && run.start_char
                    < existing.start_char + existing.phrase.chars().count() * existing.count
        });
        if !overlaps_existing {
            deduped.push(run);
        }
    }
    deduped
}

fn calculate_speech_transcript_duplicate_window_ratio(characters: &[char]) -> f64 {
    if characters.len() < 48 {
        return 0.0;
    }
    let window_size = 8;
    let mut windows: HashMap<String, usize> = HashMap::new();
    let mut total = 0_usize;
    for index in 0..=characters.len().saturating_sub(window_size) {
        let window = characters[index..index + window_size]
            .iter()
            .collect::<String>();
        if speech_transcript_phrase_is_low_signal(&window) {
            continue;
        }
        *windows.entry(window).or_default() += 1;
        total += 1;
    }
    if total == 0 {
        return 0.0;
    }
    let duplicate_count = windows
        .values()
        .map(|count| count.saturating_sub(1))
        .sum::<usize>();
    duplicate_count as f64 / total as f64
}

fn speech_transcript_phrase_is_low_signal(value: &str) -> bool {
    let mut has_signal = false;
    for character in value.chars() {
        if character.is_alphanumeric() || is_cjk_character(character) {
            has_signal = true;
            break;
        }
    }
    !has_signal
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

    let bytes = fs::read(path)
        .map_err(|error| format!("read AutoCut speech transcript JSON failed: {error}"))?;
    decode_whisper_transcript_json_bytes(path, &bytes)
}

fn decode_whisper_transcript_json_bytes(path: &Path, bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err(format!(
            "AutoCut speech transcript JSON is empty. {}",
            format_whisper_transcript_file_diagnostics(path, bytes)
        ));
    }

    let decoded = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        std::str::from_utf8(&bytes[3..])
            .map(str::to_string)
            .map_err(|error| {
                format!(
                    "decode AutoCut speech transcript JSON as UTF-8 BOM failed: {error}. {}",
                    format_whisper_transcript_file_diagnostics(path, bytes)
                )
            })?
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        decode_whisper_transcript_utf16(path, bytes, &bytes[2..], true)?
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        decode_whisper_transcript_utf16(path, bytes, &bytes[2..], false)?
    } else {
        match std::str::from_utf8(bytes) {
            Ok(source) => source.to_string(),
            Err(error) => {
                let lossy_source = String::from_utf8_lossy(bytes).into_owned();
                if whisper_transcript_source_has_json_shape(&lossy_source) {
                    lossy_source
                } else {
                    return Err(format!(
                        "decode AutoCut speech transcript JSON as UTF-8 failed: {error}. {}",
                        format_whisper_transcript_file_diagnostics(path, bytes)
                    ));
                }
            }
        }
    };

    let decoded = decoded.trim_start_matches('\u{feff}').to_string();
    if !whisper_transcript_source_has_json_shape(&decoded) {
        return Err(format!(
            "AutoCut speech transcript JSON does not start with a JSON object or array. {}",
            format_whisper_transcript_file_diagnostics(path, bytes)
        ));
    }

    Ok(decoded)
}

fn decode_whisper_transcript_utf16(
    path: &Path,
    diagnostic_bytes: &[u8],
    bytes: &[u8],
    little_endian: bool,
) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err(format!(
            "decode AutoCut speech transcript JSON as UTF-16 failed: odd byte length. {}",
            format_whisper_transcript_file_diagnostics(path, diagnostic_bytes)
        ));
    }

    let units = bytes
        .chunks_exact(2)
        .map(|chunk| {
            if little_endian {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect::<Vec<_>>();

    String::from_utf16(&units).map_err(|error| {
        format!(
            "decode AutoCut speech transcript JSON as UTF-16 failed: {error}. {}",
            format_whisper_transcript_file_diagnostics(path, diagnostic_bytes)
        )
    })
}

fn whisper_transcript_source_has_json_shape(source: &str) -> bool {
    matches!(source.trim_start().chars().next(), Some('{') | Some('['))
}

fn format_whisper_transcript_file_diagnostics(path: &Path, bytes: &[u8]) -> String {
    let first_bytes = bytes
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "path={} byteSize={} firstBytes={}",
        path.display(),
        bytes.len(),
        if first_bytes.is_empty() {
            "<empty>".to_string()
        } else {
            first_bytes
        }
    )
}

fn format_whisper_transcript_existing_file_diagnostics(path: &Path) -> String {
    match fs::read(path) {
        Ok(bytes) => format_whisper_transcript_file_diagnostics(path, &bytes),
        Err(error) => format!("path={} readDiagnosticsFailed={error}", path.display()),
    }
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

fn read_whisper_segment_words(
    segment: &Value,
    segment_start_ms: i64,
    segment_end_ms: i64,
) -> Option<Vec<AutoCutSpeechTranscriptionWord>> {
    let words_value = segment
        .get("words")
        .and_then(Value::as_array)
        .or_else(|| segment.get("tokens").and_then(Value::as_array))
        .or_else(|| segment.get("word_timestamps").and_then(Value::as_array))?;
    let mut words = Vec::new();
    for word_value in words_value {
        let text = read_whisper_word_text(word_value);
        if text.is_empty() {
            continue;
        }
        let Some(start_ms) = read_whisper_word_boundary_ms(word_value, true) else {
            continue;
        };
        let Some(end_ms) = read_whisper_word_boundary_ms(word_value, false) else {
            continue;
        };
        let start_ms = start_ms.max(segment_start_ms);
        let end_ms = end_ms.min(segment_end_ms);
        if end_ms <= start_ms {
            continue;
        }
        words.push(AutoCutSpeechTranscriptionWord {
            start_ms,
            end_ms,
            text,
            probability: read_whisper_word_probability(word_value),
        });
    }

    words.sort_by(|first, second| {
        first
            .start_ms
            .cmp(&second.start_ms)
            .then_with(|| first.end_ms.cmp(&second.end_ms))
    });
    let mut repaired_words: Vec<AutoCutSpeechTranscriptionWord> = Vec::with_capacity(words.len());
    for word in words {
        let start_ms = repaired_words
            .last()
            .map(|previous| word.start_ms.max(previous.end_ms))
            .unwrap_or(word.start_ms);
        if word.end_ms <= start_ms {
            continue;
        }
        repaired_words.push(AutoCutSpeechTranscriptionWord { start_ms, ..word });
    }

    if repaired_words.is_empty() {
        None
    } else {
        Some(repaired_words)
    }
}

fn read_whisper_word_text(word: &Value) -> String {
    if let Some(text) = word.as_str() {
        return clean_whisper_word_text(text);
    }
    word.get("text")
        .or_else(|| word.get("word"))
        .or_else(|| word.get("token"))
        .and_then(Value::as_str)
        .map(clean_whisper_word_text)
        .filter(|text| !text.is_empty())
        .unwrap_or_default()
}

fn clean_whisper_word_text(text: &str) -> String {
    let text = text.trim();
    if text.contains('\u{fffd}') {
        String::new()
    } else {
        text.to_string()
    }
}

fn read_whisper_word_boundary_ms(word: &Value, is_start: bool) -> Option<i64> {
    let millisecond_field_names: &[&str] = if is_start { &["start_ms"] } else { &["end_ms"] };
    for field_name in millisecond_field_names {
        if let Some(value) = word.get(field_name).and_then(whisper_time_to_ms) {
            return Some(value);
        }
    }
    let second_field_names: &[&str] = if is_start {
        &["start", "from", "t0"]
    } else {
        &["end", "to", "t1"]
    };
    for field_name in second_field_names {
        if let Some(value) = word
            .get(field_name)
            .and_then(whisper_segment_boundary_time_to_ms)
        {
            return Some(value);
        }
    }
    let index = if is_start { 0 } else { 1 };
    read_whisper_indexed_time(word, "offsets", index)
        .and_then(whisper_time_to_ms)
        .or_else(|| {
            read_whisper_indexed_time(word, "timestamps", index)
                .and_then(whisper_segment_boundary_time_to_ms)
        })
        .or_else(|| {
            read_whisper_indexed_time(word, "timestamp", index)
                .and_then(whisper_segment_boundary_time_to_ms)
        })
}

fn read_whisper_word_probability(word: &Value) -> Option<f64> {
    word.get("probability")
        .or_else(|| word.get("prob"))
        .or_else(|| word.get("p"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, 1.0))
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

fn retry_optional_bool_field(
    task: &AutoCutRetrySourceTask,
    field_name: &str,
) -> Result<Option<bool>, String> {
    let payload = retry_source_payload(task)?;
    Ok(payload.get(field_name).and_then(serde_json::Value::as_bool))
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

fn retry_optional_usize_field(
    task: &AutoCutRetrySourceTask,
    field_name: &str,
) -> Result<Option<usize>, String> {
    let payload = retry_source_payload(task)?;
    payload
        .get(field_name)
        .and_then(serde_json::Value::as_u64)
        .map(|value| {
            usize::try_from(value).map_err(|_| {
                format!(
                    "AutoCut retry source task {} has {} outside the supported usize range",
                    task.uuid, field_name
                )
            })
        })
        .transpose()
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
        output_quality: retry_string_field(task, "outputQuality", None)?,
        output_channel: retry_string_field(task, "outputChannel", None)?,
        output_root_dir: retry_output_root_dir(task)?,
    })
}

fn read_audio_fingerprint_retry_request(
    task: &AutoCutRetrySourceTask,
) -> Result<AutoCutAudioFingerprintRequest, String> {
    let payload = retry_source_payload(task)?;
    Ok(AutoCutAudioFingerprintRequest {
        asset_uuid: retry_asset_uuid(task)?,
        source_path: retry_optional_string_field(task, "sourcePath")?,
        workflow_task_id: retry_optional_string_field(task, "workflowTaskId")?,
        fingerprint_profile: retry_string_field(
            task,
            "fingerprintProfile",
            Some("audio-energy-v1"),
        )?,
        sample_rate_hz: payload
            .get("sampleRateHz")
            .and_then(serde_json::Value::as_i64),
        window_duration_ms: payload
            .get("windowDurationMs")
            .and_then(serde_json::Value::as_i64),
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
        workflow_task_id: retry_optional_string_field(task, "workflowTaskId")?,
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
        noise_reduction: retry_bool_field(
            task,
            "noiseReduction",
            default_smart_slice_noise_reduction(),
        )?,
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
        workflow_task_id: retry_optional_string_field(task, "workflowTaskId")?,
        provider_id: retry_optional_string_field(task, "providerId")?,
        stt_preset_id: retry_optional_string_field(task, "sttPresetId")?,
        stt_execution_profile: retry_optional_string_field(task, "sttExecutionProfile")?,
        whisper_chunk_parallelism: retry_optional_usize_field(task, "whisperChunkParallelism")?,
        whisper_chunk_thread_count: retry_optional_usize_field(task, "whisperChunkThreadCount")?,
        whisper_chunk_source_strategy: retry_optional_string_field(
            task,
            "whisperChunkSourceStrategy",
        )?,
        whisper_audio_context: retry_optional_usize_field(task, "whisperAudioContext")?,
        whisper_beam_size: retry_optional_usize_field(task, "whisperBeamSize")?,
        whisper_best_of: retry_optional_usize_field(task, "whisperBestOf")?,
        whisper_no_fallback: retry_optional_bool_field(task, "whisperNoFallback")?.unwrap_or(false),
        language: Some(retry_string_field(task, "language", Some("auto"))?),
        output_root_dir: retry_output_root_dir(task)?,
        executable_path: retry_optional_string_field(task, "executablePath")?,
        model_path: retry_optional_string_field(task, "modelPath")?,
        workflow_purpose: retry_optional_string_field(task, "workflowPurpose")?,
        dedupe_repeated_speech: retry_optional_bool_field(task, "dedupeRepeatedSpeech")?
            .unwrap_or(false),
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
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    progress: i64,
    operation: &str,
) -> Result<(), String> {
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        progress,
        json!({
            "operation": operation,
            "stepId": if operation == "speechTranscription" { "extract-audio" } else if operation == "videoSlice" { "native-render" } else { "native-ffmpeg" },
            "phase": "ffmpeg-progress-streamed",
            "source": "ffmpeg-progress",
            "message": "Native FFmpeg progress updated."
        }),
    )?;
    Ok(())
}

fn record_local_whisper_streaming_progress(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    provider_progress: i64,
    source_kind: &str,
) -> Result<(), String> {
    let task_progress = map_local_whisper_cli_progress_to_task_progress(provider_progress);
    record_ops_task_progress_for_app(
        app,
        connection,
        task_uuid,
        task_progress,
        json!({
            "operation": "speechTranscription",
            "stepId": "speech-to-text",
            "phase": "local-whisper-progress",
            "source": "whisper-cli-progress",
            "sourceKind": source_kind,
            "providerProgress": provider_progress.clamp(0, 100),
            "message": format!("Local Whisper transcription progress {provider_progress}%."),
        }),
    )?;
    Ok(())
}

fn map_local_whisper_cli_progress_to_task_progress(provider_progress: i64) -> i64 {
    let clamped_progress = provider_progress.clamp(0, 100);
    (45 + ((clamped_progress * 29 + 50) / 100)).clamp(46, 74)
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
    record_ops_task_progress_payload(connection, task_uuid, progress, payload)
        .map(|result| result.is_some())
}

fn record_ops_task_progress_for_app(
    app: Option<&AppHandle>,
    connection: &Connection,
    task_uuid: &str,
    progress: i64,
    payload: Value,
) -> Result<bool, String> {
    let progress_event =
        record_ops_task_progress_payload(connection, task_uuid, progress, payload)?;
    if let (Some(app), Some(progress_event)) = (app, progress_event.as_ref()) {
        let _ = app.emit(AUTOCUT_NATIVE_TASK_PROGRESS_EVENT, progress_event);
    }

    Ok(progress_event.is_some())
}

fn record_ops_task_progress_payload(
    connection: &Connection,
    task_uuid: &str,
    progress: i64,
    payload: Value,
) -> Result<Option<AutoCutNativeTaskProgressEvent>, String> {
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
        return Ok(None);
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
    if !payload_json.contains_key("workflowTaskId") {
        if let Some(workflow_task_id) =
            read_ops_task_input_string_field(connection, &normalized_task_uuid, "workflowTaskId")?
        {
            payload_json.insert("workflowTaskId".to_string(), json!(workflow_task_id));
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
        Value::Object(payload_json.clone()).to_string(),
    )?;
    Ok(Some(create_native_task_progress_event(
        &normalized_task_uuid,
        OPS_TASK_EVENT_TYPE_PROGRESS,
        Value::Object(payload_json),
    )))
}

fn create_native_task_progress_event(
    task_uuid: &str,
    event_type: i64,
    payload: Value,
) -> AutoCutNativeTaskProgressEvent {
    let payload_object = payload.as_object();
    let progress = payload_object
        .and_then(|payload| payload.get("progress"))
        .and_then(Value::as_i64);
    let operation = read_json_string(payload_object, "operation");
    let phase = read_json_string(payload_object, "phase");
    let step_id = read_json_string(payload_object, "stepId");
    let message = read_json_string(payload_object, "message");
    let severity = read_json_string(payload_object, "severity");
    let source = read_json_string(payload_object, "source");
    let workflow_task_id = read_json_string(payload_object, "workflowTaskId");

    AutoCutNativeTaskProgressEvent {
        task_uuid: task_uuid.to_string(),
        workflow_task_id,
        native_task_id: Some(task_uuid.to_string()),
        event_uuid: None,
        event_type,
        progress,
        operation,
        phase,
        step_id,
        message,
        severity,
        source,
        timestamp: None,
        payload,
    }
}

fn read_json_string(payload: Option<&Map<String, Value>>, key: &str) -> Option<String> {
    payload?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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
                    "qualityGuard": result.quality_guard,
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

fn complete_ops_visual_evidence_task(
    connection: &Connection,
    task_uuid: &str,
    asset_uuid: &str,
    artifact_uuid: &str,
    result: &AutoCutMediaOperationOutput,
    evidence: &AutoCutVisualEvidenceExtractionResult,
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
                    "provider": evidence.provider,
                    "profile": evidence.profile,
                    "ready": evidence.ready,
                    "shotCount": evidence.shots.len(),
                    "sceneBoundaryCount": evidence.scene_boundaries.len(),
                    "frameQualitySampleCount": evidence.frame_quality.as_ref().map(Vec::len).unwrap_or(0),
                    "frameFingerprintSampleCount": evidence.frame_fingerprints.as_ref().map(Vec::len).unwrap_or(0),
                    "shots": evidence.shots,
                    "sceneBoundaries": evidence.scene_boundaries,
                    "frameQuality": evidence.frame_quality,
                    "frameFingerprints": evidence.frame_fingerprints,
                    "diagnostics": evidence.diagnostics,
                    "format": result.format,
                    "byteSize": result.byte_size
                })
                .to_string(),
                task_uuid,
            ],
        )
        .map_err(|error| format!("complete AutoCut visual evidence ops_task failed: {error}"))?;

    Ok(())
}

fn complete_ops_audio_fingerprint_task(
    connection: &Connection,
    task_uuid: &str,
    asset_uuid: &str,
    artifact_uuid: &str,
    result: &AutoCutMediaOperationOutput,
    fingerprint: &AutoCutAudioFingerprintResult,
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
                    "provider": fingerprint.provider,
                    "profile": fingerprint.profile,
                    "ready": fingerprint.ready,
                    "durationMs": fingerprint.duration_ms,
                    "sampleRateHz": fingerprint.sample_rate_hz,
                    "windowDurationMs": fingerprint.window_duration_ms,
                    "fingerprint": fingerprint.fingerprint,
                    "diagnostics": fingerprint.diagnostics,
                    "format": result.format,
                    "byteSize": result.byte_size
                })
                .to_string(),
                task_uuid,
            ],
        )
        .map_err(|error| format!("complete AutoCut audio fingerprint ops_task failed: {error}"))?;

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
    read_ops_task_input_string_field(connection, task_uuid, "operation")
}

fn read_ops_task_input_string_field(
    connection: &Connection,
    task_uuid: &str,
    field_name: &str,
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
        .get(field_name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
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

fn autocut_task_uuid(task_type: &str) -> Result<String, String> {
    Ok(format!(
        "task-native-{}-{}",
        normalize_autocut_task_uuid_type(task_type),
        autocut_uuid_v7()?
    ))
}

fn normalize_autocut_task_uuid_type(task_type: &str) -> String {
    let mut normalized = String::new();
    let mut previous_was_separator = false;
    for character in task_type.trim().chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !previous_was_separator && !normalized.is_empty() {
            normalized.push('-');
            previous_was_separator = true;
        }
    }
    while normalized.ends_with('-') {
        normalized.pop();
    }
    if normalized.is_empty() {
        "task".to_string()
    } else {
        normalized
    }
}

fn autocut_uuid_v7() -> Result<String, String> {
    Ok(Uuid::now_v7().to_string())
}

fn u64_to_i64(value: u64, column_name: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("{column_name} exceeds int64 storage"))
}

fn classify_media_type(extension: &str) -> &'static str {
    match extension {
        "gif" => "gif",
        "png" | "jpg" | "jpeg" | "webp" => "image",
        _ => "binary",
    }
}

fn resolve_media_type_from_stream_evidence<'a>(
    extension: &str,
    stream_evidence: AutoCutMediaStreamEvidence,
) -> &'a str {
    if stream_evidence.has_video_stream {
        return "video";
    }
    if stream_evidence.has_audio_stream {
        return "audio";
    }

    classify_media_type(extension)
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
        "mpg" | "mpeg" => "video/mpeg",
        "ts" | "mts" | "m2ts" => "video/mp2t",
        "3gp" => "video/3gpp",
        "3g2" => "video/3gpp2",
        "wmv" => "video/x-ms-wmv",
        "asf" => "video/x-ms-asf",
        "ogv" => "video/ogg",
        "vob" => "video/dvd",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "wma" => "audio/x-ms-wma",
        "aiff" | "aif" => "audio/aiff",
        "alac" => "audio/alac",
        "amr" => "audio/amr",
        "oga" => "audio/ogg",
        "spx" => "audio/ogg",
        "ac3" => "audio/ac3",
        "eac3" => "audio/eac3",
        "weba" => "audio/webm",
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
    use std::net::TcpListener;

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

    fn start_single_response_http_server<F>(
        response_writer: F,
    ) -> (String, thread::JoinHandle<String>)
    where
        F: FnOnce(String, std::net::TcpStream) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test HTTP server");
        let url = format!(
            "http://{}",
            listener.local_addr().expect("read local test HTTP address")
        );
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test HTTP request");
            let mut request_bytes = Vec::new();
            let mut buffer = [0_u8; 1024];
            loop {
                let read_bytes = stream
                    .read(&mut buffer)
                    .expect("read test HTTP request bytes");
                if read_bytes == 0 {
                    break;
                }
                request_bytes.extend_from_slice(&buffer[..read_bytes]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&request_bytes).to_string();
            response_writer(request.clone(), stream);
            request
        });

        (url, handle)
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
                words: None,
            }]),
            transcript_segment_count: Some(1),
            transcript_coverage_score: Some(1.0),
            speech_continuity_grade: Some("strong".to_string()),
            audio_cleanup_profile: Some(SMART_SLICE_AUDIO_CLEANUP_PROFILE.to_string()),
            noise_reduction_applied: Some(true),
            boundary_decision_source: Some("transcript".to_string()),
            leading_silence_trim_ms: Some(0),
            trailing_silence_trim_ms: Some(0),
            tail_treatment: Some("none".to_string()),
            ..AutoCutVideoSliceClipRequest::default()
        }
    }

    #[test]
    fn native_task_uuid_uses_uuid_v7_contract() {
        let first = autocut_task_uuid("slice").expect("create first native task uuid");
        let second = autocut_task_uuid("slice").expect("create second native task uuid");
        assert_ne!(
            first, second,
            "native task UUIDv7 ids must stay unique across adjacent calls"
        );
        assert!(
            first.starts_with("task-native-slice-"),
            "native slice task id must expose a simple task-native type prefix: {first}"
        );
        assert!(
            autocut_task_uuid("Voice Translate")
                .expect("create normalized native task uuid")
                .starts_with("task-native-voice-translate-"),
            "native task id must normalize multi-word task types"
        );

        let uuid = first
            .strip_prefix("task-native-slice-")
            .expect("native task id should include UUID suffix");
        assert_eq!(
            uuid.len(),
            36,
            "UUIDv7 suffix must use hyphenated UUID text"
        );
        assert!(
            uuid.chars()
                .all(|character| character.is_ascii_hexdigit() || character == '-'),
            "UUIDv7 suffix must contain only lowercase hex digits and hyphens: {uuid}"
        );
        assert_eq!(
            uuid.as_bytes()[14],
            b'7',
            "UUIDv7 suffix must set the RFC 9562 version field"
        );
        assert!(
            matches!(uuid.as_bytes()[19], b'8' | b'9' | b'a' | b'b'),
            "UUIDv7 suffix must set the RFC 4122/RFC 9562 variant field"
        );

        let mut generated = Vec::new();
        for _ in 0..128 {
            generated.push(autocut_task_uuid("slice").expect("create unique native task uuid"));
        }
        let mut unique = generated.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(
            unique.len(),
            generated.len(),
            "native UUIDv7 task ids must not repeat within one process"
        );
    }

    #[test]
    fn smart_slice_native_requests_default_to_raw_audio_when_noise_reduction_is_omitted() {
        let slice_request: AutoCutVideoSliceRequest = serde_json::from_value(json!({
            "assetUuid": "media-asset-default-raw-audio",
            "clips": [smart_slice_test_clip(0, 1_000, "Default raw audio")],
            "outputFormat": "mp4"
        }))
        .expect("deserialize slice request without noiseReduction");
        assert!(
            !slice_request.noise_reduction,
            "native Smart Slice rendering must preserve raw audio when callers omit noiseReduction"
        );

        let analysis_request: AutoCutVideoSliceAudioActivityAnalysisRequest =
            serde_json::from_value(json!({
                "assetUuid": "media-asset-default-raw-audio",
                "profile": SMART_SLICE_AUDIO_CLEANUP_PROFILE,
                "clips": [smart_slice_test_clip(0, 1_000, "Default boundary raw audio")]
            }))
            .expect("deserialize audio activity request without applyNoiseReduction");
        assert!(
            !analysis_request.apply_noise_reduction,
            "native Smart Slice boundary analysis must preserve raw audio when callers omit applyNoiseReduction"
        );
    }

    #[test]
    fn smart_slice_native_requests_honor_disabled_noise_reduction() {
        let slice_request: AutoCutVideoSliceRequest = serde_json::from_value(json!({
            "assetUuid": "media-asset-disabled-denoise",
            "clips": [smart_slice_test_clip(0, 1_000, "Disabled denoise")],
            "outputFormat": "mp4",
            "noiseReduction": false
        }))
        .expect("deserialize slice request with disabled noiseReduction");
        assert!(
            !slice_request.noise_reduction,
            "native Smart Slice rendering must honor noiseReduction=false for clean source audio"
        );

        let analysis_request: AutoCutVideoSliceAudioActivityAnalysisRequest =
            serde_json::from_value(json!({
                "assetUuid": "media-asset-disabled-denoise",
                "profile": SMART_SLICE_AUDIO_CLEANUP_PROFILE,
                "applyNoiseReduction": false,
                "clips": [smart_slice_test_clip(0, 1_000, "Disabled boundary denoise")]
            }))
            .expect("deserialize audio activity request with disabled applyNoiseReduction");
        assert!(
            !analysis_request.apply_noise_reduction,
            "native Smart Slice boundary analysis must honor applyNoiseReduction=false for clean source audio"
        );
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

    fn test_system_ffmpeg_toolchain_from_env(
        env_override: Option<String>,
    ) -> AutoCutFfmpegToolchain {
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
        let output = new_autocut_hidden_child_command(&toolchain.executable)
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

    fn run_ffmpeg_scene_change_test_video(
        toolchain: &AutoCutFfmpegToolchain,
        output_path: &Path,
    ) -> Result<(), String> {
        let output = new_autocut_hidden_child_command(&toolchain.executable)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:size=96x96:rate=10:duration=0.8",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:size=96x96:rate=10:duration=0.8",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
                "-map",
                "[v]",
                "-c:v",
                "mpeg4",
                "-q:v",
                "5",
            ])
            .arg(output_path)
            .output()
            .map_err(|error| {
                format!("run AutoCut FFmpeg scene-change test video failed: {error}")
            })?;

        if !output.status.success() {
            return Err(format!(
                "AutoCut FFmpeg scene-change test video failed with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(())
    }

    #[test]
    fn visual_evidence_extraction_from_asset_registers_source_backed_shots() {
        let root = unique_temp_dir("sdkwork-autocut-visual-evidence");
        let source_root = unique_temp_dir("sdkwork-autocut-visual-evidence-source");
        let source_path = source_root.join("source-scene-change.mp4");
        let toolchain = test_system_ffmpeg_toolchain();
        run_ffmpeg_scene_change_test_video(&toolchain, &source_path)
            .expect("generate scene-change visual evidence source video");
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
        .expect("import visual evidence source");

        let result = extract_autocut_visual_evidence_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVisualEvidenceExtractionRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                source_path: None,
                workflow_task_id: Some("workflow-visual-evidence-test".to_string()),
                visual_evidence_profile: "scene-index-v1".to_string(),
                scene_change_threshold: Some(0.08),
                min_shot_duration_ms: Some(250),
                include_frame_quality: Some(true),
                include_frame_fingerprint: Some(true),
                output_root_dir: None,
            },
            &toolchain,
        )
        .expect("extract source-backed visual evidence");

        assert_eq!(result.source_asset_uuid, import_result.asset_uuid);
        assert_eq!(result.profile, "scene-index-v1");
        assert!(
            result.ready,
            "visual evidence extraction must report ready after source-backed FFmpeg analysis"
        );
        assert!(
            result.shots.len() >= 2,
            "scene-change visual evidence should contain at least two shot ranges: {:?}",
            result.shots
        );
        assert!(
            result.scene_boundaries.len() >= 2,
            "scene-index profile should expose scene boundaries covered by shot evidence"
        );
        assert_eq!(
            result.shots.first().map(|shot| shot.start_ms),
            Some(0),
            "visual shot evidence must start at source timeline zero"
        );
        for (index, shot) in result.shots.iter().enumerate() {
            assert!(
                shot.id.starts_with("shot-"),
                "visual shot {} must have a stable shot id: {}",
                index + 1,
                shot.id
            );
            assert!(
                shot.end_ms > shot.start_ms,
                "visual shot ranges must have positive duration"
            );
            assert!(
                (0.0..=1.0).contains(&shot.confidence),
                "visual shot confidence must be normalized to 0-1"
            );
            if let Some(previous) = index.checked_sub(1).and_then(|item| result.shots.get(item)) {
                assert!(
                    previous.end_ms <= shot.start_ms,
                    "visual shot ranges must be ordered and non-overlapping"
                );
            }
        }
        for scene in &result.scene_boundaries {
            assert!(
                result
                    .shots
                    .iter()
                    .any(|shot| shot.start_ms <= scene.start_ms && shot.end_ms >= scene.end_ms),
                "scene boundary must be fully covered by a returned shot range"
            );
        }
        assert!(
            result
                .frame_quality
                .as_ref()
                .is_some_and(|samples| !samples.is_empty()),
            "includeFrameQuality should return source-timeline frame quality samples"
        );
        let frame_fingerprints = result.frame_fingerprints.as_ref().expect(
            "includeFrameFingerprint should return source-timeline perceptual frame fingerprints",
        );
        assert!(
            !frame_fingerprints.is_empty(),
            "visual evidence should include at least one perceptual frame fingerprint"
        );
        for sample in frame_fingerprints {
            assert_eq!(sample.algorithm, "ahash-8x8-luma-v1");
            assert_eq!(
                sample.hash.len(),
                16,
                "aHash fingerprint must be 64 bits encoded as 16 hex chars"
            );
            assert!(
                sample
                    .hash
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()),
                "aHash fingerprint must be hexadecimal: {}",
                sample.hash
            );
            assert!(
                (0.0..=1.0).contains(&sample.mean_luma),
                "visual frame mean luma must be normalized"
            );
            assert_eq!(
                sample.histogram.len(),
                8,
                "visual frame histogram must use the stable 8-bucket contract"
            );
        }
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("ffmpeg-scene")),
            "visual evidence diagnostics should identify the FFmpeg scene provider"
        );

        let snapshots = list_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskQueryRequest {
                task_uuid: Some(result.task_uuid.clone()),
                limit: Some(1),
            },
        )
        .expect("query visual evidence native task");
        assert_eq!(snapshots.len(), 1);
        let snapshot = &snapshots[0];
        assert_eq!(snapshot.status, OPS_STATUS_COMPLETED);
        assert_eq!(snapshot.progress, 100);
        assert_eq!(
            snapshot.source_asset_uuid.as_deref(),
            Some(import_result.asset_uuid.as_str())
        );
        assert_eq!(snapshot.stages.len(), 1);
        assert_eq!(snapshot.stages[0].status, OPS_STATUS_COMPLETED);
        let output_json: Value =
            serde_json::from_str(&snapshot.output_json).expect("parse visual evidence task output");
        assert_eq!(output_json["provider"], "ffmpeg-scene");
        assert_eq!(output_json["shotCount"], result.shots.len());
        assert!(
            snapshot
                .events
                .iter()
                .any(|event| event.event_type == OPS_TASK_EVENT_TYPE_COMPLETED),
            "visual evidence native task must emit a completed event"
        );
    }

    #[test]
    fn visual_evidence_extraction_accepts_trusted_source_path_without_registered_asset() {
        let root = unique_temp_dir("sdkwork-autocut-visual-evidence-source-path");
        let source_root = unique_temp_dir("sdkwork-autocut-visual-evidence-source-path-input");
        let source_path = source_root.join("library-asset-scene-change.mp4");
        let toolchain = test_system_ffmpeg_toolchain();
        run_ffmpeg_scene_change_test_video(&toolchain, &source_path)
            .expect("generate source-path visual evidence source video");
        let connection = prepared_connection();

        let result = extract_autocut_visual_evidence_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutVisualEvidenceExtractionRequest {
                asset_uuid: "asset-library-visual-evidence".to_string(),
                source_path: Some(source_path.display().to_string()),
                workflow_task_id: Some("workflow-source-path-visual-evidence-test".to_string()),
                visual_evidence_profile: "scene-index-v1".to_string(),
                scene_change_threshold: Some(0.08),
                min_shot_duration_ms: Some(250),
                include_frame_quality: Some(true),
                include_frame_fingerprint: Some(true),
                output_root_dir: None,
            },
            &toolchain,
        )
        .expect("extract source-path visual evidence");

        assert_eq!(result.source_asset_uuid, "asset-library-visual-evidence");
        assert!(
            result.ready,
            "source-path visual evidence extraction must report ready"
        );
        assert!(
            result.shots.len() >= 2,
            "source-path visual evidence should contain source-backed shot ranges"
        );
        let snapshots = list_autocut_native_tasks_on_connection(
            &connection,
            AutoCutNativeTaskQueryRequest {
                task_uuid: Some(result.task_uuid.clone()),
                limit: Some(1),
            },
        )
        .expect("query source-path visual evidence task");
        assert_eq!(snapshots.len(), 1);
        assert_eq!(
            snapshots[0].source_asset_uuid.as_deref(),
            Some("asset-library-visual-evidence")
        );
        let input_json: Value = serde_json::from_str(&snapshots[0].input_json)
            .expect("parse source-path visual evidence task input");
        assert_eq!(input_json["assetUuid"], "asset-library-visual-evidence");
        assert_eq!(input_json["sourceName"], "library-asset-scene-change.mp4");
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
    fn video_slice_encoder_session_reuses_first_successful_encoder_for_large_batches() {
        let session = AutoCutVideoSliceEncoderSession {
            preferred_candidate_index: Some(2),
            stream_copy_disabled: false,
        };

        assert_eq!(
            ordered_video_slice_encoder_candidate_indexes(5, &session),
            vec![2, 0, 1, 3, 4],
            "large multi-slice batches should try the encoder that already succeeded before repeating slower fallback probes"
        );
        assert_eq!(
            ordered_video_slice_encoder_candidate_indexes(
                3,
                &AutoCutVideoSliceEncoderSession::default()
            ),
            vec![0, 1, 2],
            "first slice must keep the normal hardware-priority encoder order"
        );
        assert_eq!(
            ordered_video_slice_encoder_candidate_indexes(
                2,
                &AutoCutVideoSliceEncoderSession {
                    preferred_candidate_index: Some(9),
                    stream_copy_disabled: false,
                }
            ),
            vec![0, 1],
            "stale preferred encoder indexes must not corrupt candidate order"
        );
        assert!(
            !AutoCutVideoSliceEncoderSession::default().stream_copy_disabled,
            "stream-copy fast path should be available until a concrete source proves it cannot be copied safely"
        );
    }

    #[test]
    fn video_slice_plain_continuous_clip_uses_stream_copy_fast_path() {
        let toolchain = test_system_ffmpeg_toolchain();
        let clip = smart_slice_test_clip(12_000, 8_000, "Plain fast slice");
        let command = build_ffmpeg_video_slice_stream_copy_command(
            &toolchain,
            Path::new("large-source.mp4"),
            Path::new("slice.mp4"),
            &clip,
            None,
            false,
            true,
            None,
        )
        .expect("plain continuous clip should be eligible for stream-copy fast path");
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2).any(|items| items == ["-c", "copy"]),
            "plain continuous large-file slices should avoid full decode/re-encode when no render filters, subtitles, denoise, mute ranges, or fade are required: {args:?}"
        );
        assert!(
            !args.iter().any(|arg| arg == "-vf"
                || arg == "-af"
                || arg == "-c:v"
                || arg == "-filter_complex"),
            "plain fast-path slicing must not attach filters or video encoders: {args:?}"
        );

        let reencode_command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("large-source.mp4"),
            Path::new("slice.mp4"),
            &clip,
            None,
            false,
            true,
            None,
            None,
            &autocut_video_slice_cpu_encoder_candidate(),
        );
        let reencode_args = reencode_command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            reencode_args
                .windows(2)
                .any(|items| items == ["-c:v", "libx264"]),
            "fallback re-encode command must remain available when stream-copy cannot be used: {reencode_args:?}"
        );
    }

    #[test]
    fn video_slice_filtered_clip_keeps_reencode_path_for_visual_correctness() {
        let toolchain = test_system_ffmpeg_toolchain();
        let candidate = autocut_video_slice_cpu_encoder_candidate();
        let clip = smart_slice_test_clip(12_000, 8_000, "Portrait render");
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("phone-source.mp4"),
            Path::new("slice.mp4"),
            &clip,
            Some(&AutoCutVideoSliceRenderProfile {
                target_aspect_ratio: "9:16".to_string(),
                object_fit: "contain".to_string(),
            }),
            false,
            true,
            None,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2).any(|items| items == ["-c:v", "libx264"]),
            "render-profile slicing must still re-encode so aspect ratio and rotation metadata are normalized: {args:?}"
        );
        assert!(
            args.windows(2).any(|items| items[0] == "-vf"
                && items[1].contains(VIDEO_SLICE_CLEAR_DISPLAY_MATRIX_FILTER)),
            "filtered rendering must keep display-matrix cleanup for phone portrait sources: {args:?}"
        );
        assert!(
            !args.windows(2).any(|items| items == ["-c", "copy"]),
            "filtered rendering must not use stream copy because filters would be skipped: {args:?}"
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
        clip.tail_treatment = Some("fade-out".to_string());
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
            true,
            None,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            args.windows(2).any(|items| {
                items[0] == "-af"
                    && items[1].contains(ffmpeg_video_slice_audio_noise_reduction_filter())
                    && items[1].contains("volume=enable='between(t,0.250,0.550)':volume=0")
                    && items[1].contains("afade=t=out:st=0.820:d=0.180")
                    && items[1].contains(ffmpeg_video_slice_audio_loudness_filter())
                    && items[1].find(ffmpeg_video_slice_audio_noise_reduction_filter())
                        < items[1].find("volume=enable='between(t,0.250,0.550)':volume=0")
                    && items[1].find("volume=enable='between(t,0.250,0.550)':volume=0")
                        < items[1].find("afade=t=out:st=0.820:d=0.180")
                    && items[1].find("afade=t=out:st=0.820:d=0.180")
                        < items[1].find(ffmpeg_video_slice_audio_loudness_filter())
            }),
            "enabled smart-slice noise reduction must denoise before muting recognized noise fragments, fade trimmed tails, and normalize loudness last"
        );

        clip.audio_mute_ranges = None;
        clip.tail_treatment = None;
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &clip,
            None,
            false,
            true,
            None,
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
            true,
            None,
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

        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &clip,
            None,
            false,
            false,
            None,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            !args.iter().any(|arg| arg == "-af"),
            "smart-slice audio mute ranges must not add audio filters when the source has no audio stream"
        );
    }

    #[test]
    fn video_slice_initial_render_defers_audio_cleanup_until_postprocess() {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut clip = smart_slice_test_clip(1_000, 10_000, "Raw first");
        clip.source_start_ms = Some(1_000);
        clip.source_end_ms = Some(11_000);
        clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 1_000,
                end_ms: 3_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 8_000,
                end_ms: 11_000,
            },
        ]);
        clip.audio_mute_ranges = Some(vec![AutoCutVideoSliceAudioMuteRange {
            start_ms: 8_400,
            end_ms: 8_800,
        }]);
        clip.tail_treatment = Some("fade-out".to_string());

        let raw_render_clip = create_video_slice_initial_render_clip(&clip);
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("source.mp4"),
            Path::new("raw-slice.mp4"),
            &raw_render_clip,
            None,
            false,
            true,
            None,
            None,
            &autocut_video_slice_cpu_encoder_candidate(),
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|items| items == ["-ss", "1.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "10.000"]));
        assert_eq!(
            args.iter().filter(|arg| arg.as_str() == "-i").count(),
            1,
            "initial slicing must cut one continuous source interval before audio cleanup"
        );
        assert!(
            !args
                .iter()
                .any(|arg| arg == "-filter_complex" || arg == "-af"),
            "initial slicing must not denoise, mute, or compact silence before the slice artifact exists: {args:?}"
        );
    }

    #[test]
    fn video_slice_audio_cleanup_postprocess_denoises_then_compacts_silence_after_slice() {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut clip = smart_slice_test_clip(10_000, 8_000, "Clean after cut");
        clip.source_start_ms = Some(10_000);
        clip.source_end_ms = Some(18_000);
        clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 10_000,
                end_ms: 12_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 15_000,
                end_ms: 18_000,
            },
        ]);
        clip.audio_mute_ranges = Some(vec![AutoCutVideoSliceAudioMuteRange {
            start_ms: 15_300,
            end_ms: 15_700,
        }]);
        clip.rendered_duration_ms = Some(5_000);
        clip.removed_silence_ms = Some(3_000);
        clip.internal_silence_trim_count = Some(1);

        let cleanup_clip = create_video_slice_postprocess_clip(&clip, clip.source_segments.clone());
        let command = build_ffmpeg_video_slice_audio_cleanup_postprocess_command(
            &toolchain,
            Path::new("raw-slice.mp4"),
            Path::new("clean-slice.mp4"),
            &cleanup_clip,
            true,
            true,
            &autocut_video_slice_cpu_encoder_candidate(),
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args.iter().filter(|arg| arg.as_str() == "-i").count(),
            2,
            "postprocessing must reopen the generated slice artifact and concatenate retained speech islands"
        );
        assert!(args.windows(2).any(|items| items == ["-ss", "0.000"]));
        assert!(args.windows(2).any(|items| items == ["-ss", "5.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "2.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "3.000"]));
        assert!(
            args.windows(2).any(|items| {
                items[0] == "-filter_complex"
                    && items[1].contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]")
                    && items[1].contains("[acat]highpass=f=80")
                    && items[1].contains("afftdn=nr=10:nf=-25")
                    && items[1].contains("volume=enable='between(t,2.300,2.700)':volume=0")
                    && items[1].contains(ffmpeg_video_slice_audio_loudness_filter())
                    && items[1].find(ffmpeg_video_slice_audio_noise_reduction_filter())
                        < items[1].find("volume=enable='between(t,2.300,2.700)':volume=0")
                    && items[1].find("volume=enable='between(t,2.300,2.700)':volume=0")
                        < items[1].find(ffmpeg_video_slice_audio_loudness_filter())
            }),
            "post-cut cleanup must denoise first, apply silence/noise cleanup on the cut artifact timeline, and normalize loudness last: {args:?}"
        );
    }

    #[test]
    fn video_slice_audio_postprocess_skips_upstream_audio_activity_plan_for_large_file_rendering() {
        let mut clip = smart_slice_test_clip(12_000, 45_000, "Upstream audio plan");
        clip.noise_reduction_applied = Some(false);
        clip.audio_activity_start_ms = Some(12_120);
        clip.audio_activity_end_ms = Some(56_780);
        clip.audio_activity_confidence = Some(0.96);
        clip.audio_activity_analysis_filter =
            Some(ffmpeg_video_slice_audio_activity_analysis_filter(false));

        let decision = should_run_video_slice_audio_cleanup_postprocess(&clip, false, true);

        assert_eq!(
            decision,
            AutoCutVideoSliceAudioPostprocessDecision::SkipUpstreamAudioActivityPlan,
            "native rendering must not re-run post-cut silence analysis when the Smart Slice service already supplied trusted audio boundary evidence"
        );
        assert!(
            !decision.should_run(),
            "large-file speech slices with trusted upstream cleanup evidence should render in one native pass"
        );
    }

    #[test]
    fn video_slice_audio_postprocess_skips_precomputed_source_segments_for_one_pass_rendering() {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut clip = smart_slice_test_clip(10_000, 12_000, "Precomputed speech islands");
        clip.noise_reduction_applied = Some(false);
        clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 10_000,
                end_ms: 14_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 18_000,
                end_ms: 22_000,
            },
        ]);
        clip.rendered_duration_ms = Some(8_000);
        clip.removed_silence_ms = Some(4_000);
        clip.internal_silence_trim_count = Some(1);

        let decision = should_run_video_slice_audio_cleanup_postprocess(&clip, false, true);
        assert_eq!(
            decision,
            AutoCutVideoSliceAudioPostprocessDecision::SkipPrecomputedSourceSegments,
            "sourceSegments are already the approved post-boundary filter plan and must be consumed directly"
        );

        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("large-source.mp4"),
            Path::new("slice.mp4"),
            &clip,
            None,
            false,
            true,
            None,
            None,
            &autocut_video_slice_cpu_encoder_candidate(),
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args.iter().filter(|arg| arg.as_str() == "-i").count(),
            2,
            "one-pass native rendering must open the original source islands directly instead of rendering raw output and re-opening it"
        );
        assert!(
            args.windows(2)
                .any(|items| items[0] == "-filter_complex"
                    && items[1].contains("concat=n=2:v=1:a=1")),
            "one-pass native rendering must concatenate approved sourceSegments in a single FFmpeg command: {args:?}"
        );
    }

    #[test]
    fn video_slice_audio_postprocess_skipped_render_pass_keeps_cleanup_filters() {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut clip = smart_slice_test_clip(10_000, 12_000, "One pass cleanup filters");
        clip.noise_reduction_applied = Some(true);
        clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 10_000,
                end_ms: 14_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 18_000,
                end_ms: 22_000,
            },
        ]);
        clip.rendered_duration_ms = Some(8_000);
        clip.removed_silence_ms = Some(4_000);
        clip.internal_silence_trim_count = Some(1);
        clip.audio_mute_ranges = Some(vec![AutoCutVideoSliceAudioMuteRange {
            start_ms: 18_500,
            end_ms: 19_000,
        }]);
        clip.tail_treatment = Some("fade-out".to_string());

        let decision = should_run_video_slice_audio_cleanup_postprocess(&clip, true, true);
        let render_pass_clip = create_video_slice_render_pass_clip(&clip, decision);
        let apply_render_pass_audio_cleanup =
            should_apply_video_slice_audio_cleanup_during_render_pass(decision, true);
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("large-source.mp4"),
            Path::new("slice.mp4"),
            &render_pass_clip,
            None,
            apply_render_pass_audio_cleanup,
            true,
            None,
            None,
            &autocut_video_slice_cpu_encoder_candidate(),
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2).any(|items| {
                items[0] == "-filter_complex"
                    && items[1].contains("[acat]highpass=f=80")
                    && items[1].contains("afftdn=nr=10:nf=-25")
                    && items[1].contains("volume=enable='between(t,4.500,5.000)':volume=0")
                    && items[1].contains("afade=t=out")
                    && items[1].contains(ffmpeg_video_slice_audio_loudness_filter())
            }),
            "skipping redundant postprocess must still apply denoise, mute ranges, and tail treatment during the single render pass: {args:?}"
        );
    }

    #[test]
    fn video_slice_audio_postprocess_runs_only_when_cleanup_plan_is_missing() {
        let mut missing_cleanup_plan_clip =
            smart_slice_test_clip(0, 10_000, "Missing cleanup plan");
        missing_cleanup_plan_clip.noise_reduction_applied = Some(false);

        assert_eq!(
            should_run_video_slice_audio_cleanup_postprocess(
                &missing_cleanup_plan_clip,
                false,
                true,
            ),
            AutoCutVideoSliceAudioPostprocessDecision::RunMissingCleanupPlan,
            "native fallback postprocessing should run only when the upstream Smart Slice cleanup plan is unavailable"
        );
        assert!(
            should_run_video_slice_audio_cleanup_postprocess(
                &missing_cleanup_plan_clip,
                false,
                true,
            )
            .should_run(),
            "missing upstream cleanup evidence still needs the native post-cut safety fallback"
        );
        assert_eq!(
            should_run_video_slice_audio_cleanup_postprocess(
                &missing_cleanup_plan_clip,
                false,
                false,
            ),
            AutoCutVideoSliceAudioPostprocessDecision::SkipNoAudioStream,
            "video-only sources should never enter audio cleanup postprocessing"
        );
    }

    #[test]
    fn video_slice_postprocess_segments_are_derived_from_cut_artifact_silence() {
        let raw_clip = smart_slice_test_clip(20_000, 9_000, "Detected silence");
        let intervals = parse_ffmpeg_silencedetect_intervals(
            "[silencedetect @ 000] silence_start: 0\n\
             [silencedetect @ 000] silence_end: 0.620 | silence_duration: 0.620\n\
             [silencedetect @ 000] silence_start: 3.000\n\
             [silencedetect @ 000] silence_end: 5.250 | silence_duration: 2.250\n\
             [silencedetect @ 000] silence_start: 8.520\n\
             [silencedetect @ 000] silence_end: 9.000 | silence_duration: 0.480\n",
            raw_clip.duration_ms,
        );

        let retained_segments =
            create_video_slice_postprocess_segments_from_silence(&raw_clip, &intervals);

        assert_eq!(
            retained_segments,
            Some(vec![
                AutoCutVideoSliceSourceSegment {
                    start_ms: 20_540,
                    end_ms: 23_080,
                },
                AutoCutVideoSliceSourceSegment {
                    start_ms: 25_170,
                    end_ms: 28_600,
                },
            ]),
            "post-cut silence detection must translate retained ranges back to original source time for result evidence"
        );
    }

    #[test]
    fn video_slice_source_segments_render_with_ffmpeg_concat_filter() {
        let toolchain = test_system_ffmpeg_toolchain();
        let mut clip = smart_slice_test_clip(1_000, 10_000, "Compacted speech");
        clip.source_start_ms = Some(1_000);
        clip.source_end_ms = Some(11_000);
        clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 1_000,
                end_ms: 3_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 8_000,
                end_ms: 11_000,
            },
        ]);
        clip.rendered_duration_ms = Some(5_000);
        clip.removed_silence_ms = Some(5_000);
        clip.internal_silence_trim_count = Some(1);
        let candidate = autocut_video_slice_cpu_encoder_candidate();
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("source.mp4"),
            Path::new("slice.mp4"),
            &clip,
            Some(&AutoCutVideoSliceRenderProfile {
                target_aspect_ratio: "9:16".to_string(),
                object_fit: "cover".to_string(),
            }),
            true,
            true,
            None,
            None,
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-i").count(), 2);
        assert!(args.windows(2).any(|items| items == ["-ss", "1.000"]));
        assert!(args.windows(2).any(|items| items == ["-ss", "8.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "2.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "3.000"]));
        assert!(
            args.windows(2).any(|items| {
                items[0] == "-filter_complex"
                    && items[1].contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]")
                    && items[1].contains("[vcat]scale=1080:1920")
                    && items[1].contains("[acat]highpass=f=80")
                    && items[1].contains("[aout]")
            }),
            "sourceSegments must render through a single concat filter graph with post-concat video and audio cleanup"
        );
        assert!(args.windows(2).any(|items| items == ["-map", "[vout]"]));
        assert!(args.windows(2).any(|items| items == ["-map", "[aout]"]));
        assert!(
            !args.iter().any(|arg| arg == "-vf" || arg == "-af"),
            "sourceSegments concat rendering must use filter_complex instead of separate -vf/-af filters"
        );
    }

    #[test]
    fn video_slice_rendering_clears_stale_rotation_metadata_after_filters() {
        let toolchain = test_system_ffmpeg_toolchain();
        let candidate = autocut_video_slice_cpu_encoder_candidate();
        let input_path = Path::new("phone-portrait-source.mp4");
        let output_path = Path::new("slice.mp4");
        let render_profile = AutoCutVideoSliceRenderProfile {
            target_aspect_ratio: "9:16".to_string(),
            object_fit: "cover".to_string(),
        };

        let continuous_clip = smart_slice_test_clip(1_000, 5_000, "Continuous portrait");
        let continuous_command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &continuous_clip,
            Some(&render_profile),
            false,
            true,
            None,
            None,
            &candidate,
        );
        let continuous_args = continuous_command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            continuous_args
                .windows(2)
                .any(|items| items == ["-metadata:s:v:0", "rotate="]),
            "continuous smart-slice rendering must clear stale phone rotation metadata after FFmpeg autorotates the filtered pixels"
        );
        assert!(
            continuous_args.windows(2).any(|items| items[0] == "-vf"
                && items[1].contains(VIDEO_SLICE_CLEAR_DISPLAY_MATRIX_FILTER)),
            "continuous smart-slice rendering must delete display-matrix side data after video filters so players do not rotate the output again"
        );
        assert!(
            !continuous_args.iter().any(|arg| arg == "-noautorotate"),
            "smart-slice rendering must not disable FFmpeg autorotation for phone portrait sources"
        );

        let mut compacted_clip = smart_slice_test_clip(1_000, 10_000, "Compacted portrait");
        compacted_clip.source_start_ms = Some(1_000);
        compacted_clip.source_end_ms = Some(11_000);
        compacted_clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 1_000,
                end_ms: 3_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 8_000,
                end_ms: 11_000,
            },
        ]);
        compacted_clip.rendered_duration_ms = Some(5_000);
        compacted_clip.removed_silence_ms = Some(5_000);
        compacted_clip.internal_silence_trim_count = Some(1);
        let compacted_command = build_ffmpeg_video_slice_command(
            &toolchain,
            input_path,
            output_path,
            &compacted_clip,
            Some(&render_profile),
            false,
            true,
            None,
            None,
            &candidate,
        );
        let compacted_args = compacted_command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(
            compacted_args
                .windows(2)
                .any(|items| items == ["-metadata:s:v:0", "rotate="]),
            "sourceSegments concat rendering must clear stale phone rotation metadata so players do not rotate an already-upright 9:16 output again"
        );
        assert!(
            compacted_args
                .windows(2)
                .any(|items| items[0] == "-filter_complex"
                    && items[1].contains(VIDEO_SLICE_CLEAR_DISPLAY_MATRIX_FILTER)),
            "sourceSegments concat rendering must delete display-matrix side data inside the concat filter graph"
        );
        assert!(
            !compacted_args.iter().any(|arg| arg == "-noautorotate"),
            "sourceSegments concat rendering must keep FFmpeg autorotation enabled for phone portrait sources"
        );
    }

    #[test]
    fn video_slice_source_segments_remap_subtitle_timestamps_to_rendered_time() {
        let mut clip = smart_slice_test_clip(1_000, 10_000, "Compacted subtitles");
        clip.source_start_ms = Some(1_000);
        clip.source_end_ms = Some(11_000);
        clip.source_segments = Some(vec![
            AutoCutVideoSliceSourceSegment {
                start_ms: 1_000,
                end_ms: 3_000,
            },
            AutoCutVideoSliceSourceSegment {
                start_ms: 8_000,
                end_ms: 11_000,
            },
        ]);
        let subtitle_text = build_video_slice_srt(
            &clip,
            &[AutoCutSpeechTranscriptionSegment {
                start_ms: 8_500,
                end_ms: 9_500,
                text: "Second source island starts after the removed silence.".to_string(),
                speaker: None,
                words: None,
            }],
        );

        assert!(
            subtitle_text.contains("00:00:02,500 --> 00:00:03,500"),
            "subtitle timestamps must be remapped onto the compacted rendered timeline"
        );
    }

    #[test]
    fn video_slice_srt_subtitles_are_paced_and_wrapped_for_short_video() {
        let clip = smart_slice_test_clip(0, 12_000, "Paced subtitles");
        let subtitle_text = build_video_slice_srt(
            &clip,
            &[AutoCutSpeechTranscriptionSegment {
                start_ms: 0,
                end_ms: 12_000,
                text: "A polished subtitle reveals the words being spoken now and avoids covering the whole sentence for the entire clip."
                    .to_string(),
                speaker: None,
                words: None,
            }],
        );

        assert!(
            subtitle_text.contains("00:00:00,000 --> 00:00:"),
            "paced subtitle output should start at the original speech start"
        );
        assert!(
            subtitle_text.contains("\n2\n"),
            "long speech subtitles must be split into multiple timed cues"
        );
        assert!(
            !subtitle_text.contains("entire clip.\n\n"),
            "the full long sentence must not be rendered as one subtitle cue"
        );
        assert!(
            subtitle_text.lines().filter(|line| line.len() > 34).count() == 0,
            "short-video subtitles must hard-wrap long cue text before SRT/ASS rendering: {subtitle_text}"
        );
    }

    #[test]
    fn video_slice_srt_subtitles_keep_cjk_cues_short_for_speech_progress() {
        let clip = smart_slice_test_clip(0, 12_000, "Paced Chinese subtitles");
        let subtitle_text = build_video_slice_srt(
            &clip,
            &[AutoCutSpeechTranscriptionSegment {
                start_ms: 0,
                end_ms: 12_000,
                text: "真正好的字幕应该跟着讲话一点一点出现，而不是一整句话长时间压在画面底部影响观看。"
                    .to_string(),
                speaker: None,
                words: None,
            }],
        );

        assert!(
            subtitle_text.contains("\n4\n"),
            "long CJK speech must be split into enough paced cues to follow speech progress: {subtitle_text}"
        );
        assert!(
            !subtitle_text.contains(
                "真正好的字幕应该跟着讲话一点一点出现，而不是一整句话长时间压在画面底部影响观看。"
            ),
            "the full CJK sentence must not be rendered as one long subtitle cue"
        );
        for subtitle_line in subtitle_text.lines().filter(|line| {
            let line = line.trim();
            !line.is_empty() && !line.contains("-->") && line.parse::<usize>().is_err()
        }) {
            assert!(
                subtitle_display_units(subtitle_line) <= 20,
                "CJK subtitle cue lines must stay compact enough for vertical short-video safe areas: {subtitle_text}"
            );
        }
    }

    #[test]
    fn video_slice_srt_subtitles_use_word_timestamps_when_available() {
        let clip = smart_slice_test_clip(0, 6_000, "Word timed subtitles");
        let subtitle_text = build_video_slice_srt(
            &clip,
            &[AutoCutSpeechTranscriptionSegment {
                start_ms: 0,
                end_ms: 6_000,
                text:
                    "Professional captions follow spoken words. They should not guess the rhythm."
                        .to_string(),
                speaker: None,
                words: Some(vec![
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 0,
                        end_ms: 500,
                        text: "Professional".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 500,
                        end_ms: 1_000,
                        text: "captions".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 1_000,
                        end_ms: 1_500,
                        text: "follow".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 1_500,
                        end_ms: 2_200,
                        text: "spoken".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 2_200,
                        end_ms: 2_700,
                        text: "words.".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 2_700,
                        end_ms: 3_300,
                        text: "They".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 3_300,
                        end_ms: 4_000,
                        text: "should".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 4_000,
                        end_ms: 4_600,
                        text: "not".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 4_600,
                        end_ms: 5_200,
                        text: "guess".to_string(),
                        probability: Some(0.98),
                    },
                    AutoCutSpeechTranscriptionWord {
                        start_ms: 5_200,
                        end_ms: 6_000,
                        text: "rhythm.".to_string(),
                        probability: Some(0.98),
                    },
                ]),
            }],
        );

        assert!(
            subtitle_text.contains(
                "00:00:00,000 --> 00:00:02,700\nProfessional captions follow\nspoken words."
            ),
            "word-timed subtitles must end the first cue on the spoken sentence boundary: {subtitle_text}"
        );
        assert!(
            subtitle_text.contains("00:00:02,700 --> 00:00:06,000\nThey should not guess rhythm."),
            "word-timed subtitles must start the next cue at the next spoken word boundary: {subtitle_text}"
        );
    }

    #[test]
    fn video_slice_srt_word_timed_subtitles_attach_standalone_cjk_punctuation() {
        let clip = smart_slice_test_clip(0, 5_000, "Word timed CJK punctuation");
        let words = [
            ("\u{4e13}\u{4e1a}", 0, 520),
            ("\u{5b57}\u{5e55}", 520, 1_040),
            ("\u{5e94}\u{8be5}", 1_040, 1_560),
            ("\u{8ddf}\u{7740}", 1_560, 2_080),
            ("\u{8bb2}\u{8bdd}", 2_080, 2_600),
            ("\u{4e00}\u{70b9}", 2_600, 3_120),
            ("\u{4e00}\u{70b9}", 3_120, 3_640),
            ("\u{81ea}\u{7136}", 3_640, 4_160),
            ("\u{51fa}\u{73b0}", 4_160, 4_800),
            ("\u{3002}", 4_800, 5_000),
        ]
        .into_iter()
        .map(|(text, start_ms, end_ms)| AutoCutSpeechTranscriptionWord {
            start_ms,
            end_ms,
            text: text.to_string(),
            probability: Some(0.98),
        })
        .collect::<Vec<_>>();
        let subtitle_text = build_video_slice_srt(
            &clip,
            &[AutoCutSpeechTranscriptionSegment {
                start_ms: 0,
                end_ms: 5_000,
                text: "\u{4e13}\u{4e1a}\u{5b57}\u{5e55}\u{5e94}\u{8be5}\u{8ddf}\u{7740}\u{8bb2}\u{8bdd}\u{4e00}\u{70b9}\u{4e00}\u{70b9}\u{81ea}\u{7136}\u{51fa}\u{73b0}\u{3002}".to_string(),
                speaker: None,
                words: Some(words),
            }],
        );

        assert!(
            !subtitle_text.lines().any(|line| line.trim() == "\u{3002}"),
            "standalone CJK punctuation must be attached to the previous spoken subtitle cue: {subtitle_text}"
        );
        assert!(
            subtitle_text.contains("\u{51fa}\u{73b0}\u{3002}"),
            "the final CJK punctuation should remain visible with the word it completes: {subtitle_text}"
        );
    }

    #[test]
    fn burned_subtitle_force_style_adapts_to_render_profile_and_style_id() {
        let portrait_profile = AutoCutVideoSliceRenderProfile {
            target_aspect_ratio: "9:16".to_string(),
            object_fit: "contain".to_string(),
        };
        let portrait_tiktok_style =
            build_video_slice_burned_subtitle_force_style(Some(&portrait_profile), Some("tiktok"));
        assert!(
            portrait_tiktok_style.contains("WrapStyle=2"),
            "burned subtitle style must enable smart wrapping inside the video frame"
        );
        assert!(
            portrait_tiktok_style.contains("FontName=Microsoft YaHei")
                && portrait_tiktok_style.contains("BorderStyle=1")
                && portrait_tiktok_style.contains("Encoding=1"),
            "burned subtitle style must use a CJK-safe font and explicit ASS border/encoding parameters: {portrait_tiktok_style}"
        );
        assert!(
            portrait_tiktok_style.contains("MarginL=64")
                && portrait_tiktok_style.contains("MarginR=64"),
            "portrait subtitles must keep text inside horizontal safe areas: {portrait_tiktok_style}"
        );
        assert!(
            portrait_tiktok_style.contains("MarginV=168"),
            "portrait subtitles must be lifted above short-video bottom UI controls: {portrait_tiktok_style}"
        );
        assert!(
            portrait_tiktok_style.contains("Fontsize=54"),
            "portrait subtitles must use readable vertical-video text size after 1080x1920 rendering: {portrait_tiktok_style}"
        );
        assert!(
            portrait_tiktok_style.contains("PrimaryColour=&H00FFEB00")
                && portrait_tiktok_style.contains("OutlineColour=&H005000FF"),
            "requested tiktok subtitle style must affect burned subtitle colors: {portrait_tiktok_style}"
        );

        let landscape_profile = AutoCutVideoSliceRenderProfile {
            target_aspect_ratio: "16:9".to_string(),
            object_fit: "contain".to_string(),
        };
        let landscape_minimal_style = build_video_slice_burned_subtitle_force_style(
            Some(&landscape_profile),
            Some("minimal"),
        );
        assert!(
            landscape_minimal_style.contains("MarginL=144")
                && landscape_minimal_style.contains("MarginR=144"),
            "landscape subtitles must adapt to wider horizontal safe areas: {landscape_minimal_style}"
        );
        assert!(
            landscape_minimal_style.contains("MarginV=70"),
            "landscape subtitles must use a lower bottom safe area than portrait clips: {landscape_minimal_style}"
        );
        assert!(
            landscape_minimal_style.contains("Fontsize=40"),
            "minimal landscape subtitle style must scale down from portrait defaults: {landscape_minimal_style}"
        );
        assert!(
            landscape_minimal_style.contains("PrimaryColour=&H00FFFFFF")
                && landscape_minimal_style.contains("OutlineColour=&H00000000")
                && landscape_minimal_style.contains("Bold=0"),
            "minimal subtitle style must render clean white text with a black outline: {landscape_minimal_style}"
        );
    }

    #[test]
    fn video_slice_burned_subtitle_filter_uses_requested_style_id() {
        let toolchain = test_system_ffmpeg_toolchain();
        let candidate = autocut_video_slice_cpu_encoder_candidate();
        let clip = smart_slice_test_clip(0, 2_000, "Styled subtitle");
        let render_profile = AutoCutVideoSliceRenderProfile {
            target_aspect_ratio: "9:16".to_string(),
            object_fit: "contain".to_string(),
        };
        let command = build_ffmpeg_video_slice_command(
            &toolchain,
            Path::new("source.mp4"),
            Path::new("slice.mp4"),
            &clip,
            Some(&render_profile),
            false,
            true,
            Some(Path::new("subtitle.srt")),
            Some("minimal"),
            &candidate,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2).any(|items| {
                items[0] == "-vf"
                    && items[1].contains("subtitles='subtitle.srt'")
                    && items[1].contains("Fontsize=50")
                    && items[1].contains("PrimaryColour=&H00FFFFFF")
                    && items[1].contains("OutlineColour=&H00000000")
                    && items[1].contains("Bold=0")
            }),
            "burned subtitle FFmpeg filter must use the selected subtitleStyleId: {args:?}"
        );
    }

    #[test]
    fn burned_subtitle_force_style_uses_short_video_safe_area_and_wrapping() {
        assert!(
            build_video_slice_burned_subtitle_force_style(None, None).contains("WrapStyle=2"),
            "burned subtitle style must enable smart wrapping inside the video frame"
        );
        assert!(
            build_video_slice_burned_subtitle_force_style(None, None)
                .contains("FontName=Microsoft YaHei")
                && build_video_slice_burned_subtitle_force_style(None, None)
                    .contains("BorderStyle=1")
                && build_video_slice_burned_subtitle_force_style(None, None).contains("Encoding=1"),
            "burned subtitle default style must use a CJK-safe font and explicit ASS border/encoding parameters"
        );
        assert!(
            build_video_slice_burned_subtitle_force_style(None, None).contains("MarginL=64")
                && build_video_slice_burned_subtitle_force_style(None, None).contains("MarginR=64"),
            "burned subtitle style must keep text inside horizontal safe areas"
        );
        assert!(
            build_video_slice_burned_subtitle_force_style(None, None).contains("MarginV=168"),
            "burned subtitle style must lift captions above short-video bottom UI controls"
        );
        assert!(
            build_video_slice_burned_subtitle_force_style(None, None).contains("Fontsize=54"),
            "burned subtitle style must use readable vertical-video text size after 1080x1920 rendering"
        );
    }

    #[test]
    fn local_whisper_transcription_command_uses_subtitle_friendly_segments_and_explicit_auto_language()
     {
        let speech_toolchain = AutoCutSpeechToolchain {
            executable: "whisper-cli".to_string(),
            model_path: "models/ggml-large-v3-turbo-q5_0.bin".to_string(),
            source_kind: "test".to_string(),
            acceleration_backend: None,
            executable_ready: true,
            model_ready: true,
            ready: true,
            diagnostics: Vec::new(),
            default_executable_directory: String::new(),
            default_executable_path: String::new(),
            default_model_directory: String::new(),
            default_model_path: String::new(),
            executable_strategy: String::new(),
        };
        let command = build_local_whisper_transcription_command(
            &speech_toolchain,
            Path::new("audio.wav"),
            Path::new("transcript"),
            "auto",
            "6",
            &AutoCutSpeechTranscriptionExecutionOptions::default(),
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2).any(|items| items == ["-ml", "34"]),
            "local Whisper must limit STT segment length so subtitles can track speech progress"
        );
        assert!(
            args.iter().any(|arg| arg == "-sow"),
            "local Whisper must split on word boundaries when max-len is active"
        );
        assert!(
            args.windows(2).any(|items| items == ["-l", "auto"]),
            "local Whisper must pass -l auto because whisper-cli defaults to English without an explicit language"
        );
        assert!(
            args.iter().any(|arg| arg == "-oj"),
            "local Whisper must request JSON transcript output"
        );
        assert!(
            args.iter().any(|arg| arg == "-ojf"),
            "local Whisper must request full JSON so subtitle generation can use word/token timestamps when whisper.cpp emits valid token text"
        );
    }

    #[test]
    fn local_whisper_transcription_command_applies_measured_decode_settings() {
        let speech_toolchain = AutoCutSpeechToolchain {
            executable: "whisper-cli".to_string(),
            model_path: "models/ggml-large-v3-turbo-q5_0.bin".to_string(),
            source_kind: "test".to_string(),
            acceleration_backend: None,
            executable_ready: true,
            model_ready: true,
            ready: true,
            diagnostics: Vec::new(),
            default_executable_directory: String::new(),
            default_executable_path: String::new(),
            default_model_directory: String::new(),
            default_model_path: String::new(),
            executable_strategy: String::new(),
        };
        let execution_options = AutoCutSpeechTranscriptionExecutionOptions {
            whisper_audio_context: Some(768),
            whisper_beam_size: Some(1),
            whisper_best_of: Some(1),
            whisper_no_fallback: true,
            ..AutoCutSpeechTranscriptionExecutionOptions::default()
        };
        let command = build_local_whisper_transcription_command(
            &speech_toolchain,
            Path::new("audio.wav"),
            Path::new("transcript"),
            "auto",
            "6",
            &execution_options,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|items| items == ["-ac", "768"]));
        assert!(args.windows(2).any(|items| items == ["-bs", "1"]));
        assert!(args.windows(2).any(|items| items == ["-bo", "1"]));
        assert!(args.iter().any(|arg| arg == "-nf"));
    }

    #[test]
    fn speech_transcript_quality_guard_blocks_repeated_phrase_loops() {
        let segments = vec![AutoCutSpeechTranscriptionSegment {
            start_ms: 1_000,
            end_ms: 12_000,
            text: "\u{66f4}\u{52a0}\u{4e0d}\u{4f1a}\u{53bb}\u{66f4}\u{52a0}\u{4e0d}\u{4f1a}\u{53bb}\u{66f4}\u{52a0}\u{4e0d}\u{4f1a}\u{53bb}\u{66f4}\u{52a0}\u{4e0d}\u{4f1a}\u{53bb}".to_string(),
            speaker: Some("Speaker 1".to_string()),
            words: None,
        }];

        let guard =
            evaluate_speech_transcript_quality(&segments, "local-whisper-transcript", None, false);

        assert!(!guard.passed);
        assert!(
            guard
                .risks
                .iter()
                .any(|risk| risk.code == "repeated-phrase-loop"),
            "quality guard must identify repeated hallucinated speech loops: {:?}",
            guard.risks
        );
    }

    #[test]
    fn speech_transcript_quality_guard_allows_empty_chunks_but_blocks_empty_final_transcript() {
        let chunk_guard = evaluate_speech_transcript_quality(
            &[],
            "local-whisper-chunk",
            Some("chunk-0003"),
            true,
        );
        let final_guard =
            evaluate_speech_transcript_quality(&[], "local-whisper-transcript", None, false);

        assert!(chunk_guard.passed);
        assert_eq!(chunk_guard.status, "passed-empty");
        assert!(!final_guard.passed);
        assert!(
            final_guard
                .risks
                .iter()
                .any(|risk| risk.code == "empty-transcript"),
            "final transcript cannot be empty even when individual chunks may be silent"
        );
    }

    #[test]
    fn speech_gpu_probe_does_not_treat_cpu_help_flags_as_gpu_backend() {
        let root = unique_temp_dir("sdkwork-autocut-speech-cpu-gpu-probe");
        let help_text = "--no-gpu disable GPU\n--device GPU device ID\n--ov-e-device CPU";

        let backend = detect_autocut_speech_gpu_backend(&root, Some(help_text));

        assert_eq!(backend, None);
    }

    #[test]
    fn speech_gpu_probe_detects_cuda_companion_runtime() {
        let root = unique_temp_dir("sdkwork-autocut-speech-cuda-gpu-probe");
        fs::write(root.join("ggml-cuda.dll"), b"cuda").expect("write cuda companion fixture");

        let backend = detect_autocut_speech_gpu_backend(&root, Some("--no-gpu"));

        assert_eq!(backend.as_deref(), Some("cuda"));
    }

    #[test]
    fn speech_gpu_probe_detects_explicit_metal_help_text() {
        let root = unique_temp_dir("sdkwork-autocut-speech-metal-help-probe");
        let help_text = "whisper.cpp backends: metal, cpu";

        let backend = detect_autocut_speech_gpu_backend(&root, Some(help_text));

        assert_eq!(backend.as_deref(), Some("metal"));
    }

    #[test]
    fn speech_toolchain_manifest_declares_cpu_acceleration_backend() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-cpu-backend-manifest");
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
                  "accelerationBackend": "cpu",
                  "integrity": {
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                    "byteSize": 0
                  }
                }
              }
            }"#,
        )
        .expect("write CPU acceleration manifest");

        let manifest = parse_autocut_speech_toolchain_manifest(&manifest_path)
            .expect("parse CPU acceleration manifest");

        assert_eq!(
            manifest
                .platforms
                .get("windows-x86_64")
                .and_then(|platform| platform.acceleration_backend.as_deref()),
            Some("cpu"),
        );
        validate_autocut_speech_toolchain_manifest(&manifest)
            .expect("CPU acceleration backend should be a valid explicit speech runtime contract");
    }

    #[test]
    fn speech_gpu_probe_prefers_manifest_gpu_backend_declaration() {
        let root = unique_temp_dir("sdkwork-autocut-speech-declared-cuda-gpu-probe");
        let probe = probe_autocut_speech_gpu_acceleration_in_directory(
            true,
            &root,
            Some("cuda"),
            Some("--no-gpu disable GPU\n--device GPU device ID"),
        );

        assert!(probe.ready);
        assert_eq!(probe.backend.as_deref(), Some("cuda"));
        assert!(
            probe
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("manifest")),
            "declared GPU backend should be observable in diagnostics: {:?}",
            probe.diagnostics
        );
    }

    #[test]
    fn speech_toolchain_resolver_carries_bundled_acceleration_backend_into_probe() {
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-bundled-cuda-backend");
        let manifest_path = manifest_root.join("speech-transcription.toolchain.json");
        let windows_sidecar_dir = manifest_root.join("windows-x86_64");
        let windows_sidecar_path = windows_sidecar_dir.join("whisper-cli.exe");
        fs::create_dir_all(&windows_sidecar_dir).expect("create speech sidecar dir");
        let sidecar_bytes = b"windows whisper cli cuda fixture";
        fs::write(&windows_sidecar_path, sidecar_bytes)
            .expect("write bundled speech sidecar fixture");
        let sidecar_sha256 = sha256_hex(sidecar_bytes);
        let model_path = manifest_root.join("ggml-large-v3-turbo.bin");
        write_minimal_valid_speech_model(&model_path);
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
                      "accelerationBackend": "cuda",
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
        .expect("write CUDA speech toolchain manifest");

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
        let probe = probe_autocut_speech_gpu_acceleration(&toolchain, Some("--no-gpu"));

        assert_eq!(toolchain.acceleration_backend.as_deref(), Some("cuda"));
        assert!(probe.ready);
        assert_eq!(probe.backend.as_deref(), Some("cuda"));
    }

    #[test]
    fn long_speech_transcription_plans_overlapping_audio_chunks_for_parallel_whisper() {
        let chunks =
            create_autocut_speech_audio_chunk_plan(Path::new("chunks"), 1_360_000, 600_000, 2_000);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].id, "chunk-0001");
        assert_eq!(chunks[0].index, 1);
        assert_eq!(chunks[0].start_ms, 0);
        assert_eq!(chunks[0].end_ms, 600_000);
        assert_eq!(chunks[1].start_ms, 598_000);
        assert_eq!(chunks[1].end_ms, 1_198_000);
        assert_eq!(chunks[2].start_ms, 1_196_000);
        assert_eq!(chunks[2].end_ms, 1_360_000);
        assert!(chunks[0].audio_path.ends_with("chunk-0001.wav"));
        assert!(chunks[0].transcript_stem.ends_with("chunk-0001"));
        assert!(chunks[0].transcript_path.ends_with("chunk-0001.json"));
        assert!(should_use_chunked_local_speech_transcription(1_260_001));
        assert!(should_use_chunked_local_speech_transcription(600_000));
        assert!(!should_use_chunked_local_speech_transcription(240_000));
    }

    #[test]
    fn long_speech_transcription_absorbs_short_tail_into_previous_chunk() {
        let chunks =
            create_autocut_speech_audio_chunk_plan(Path::new("chunks"), 725_000, 360_000, 2_000);

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[1].start_ms, 358_000);
        assert_eq!(chunks[1].end_ms, 725_000);
    }

    #[test]
    fn long_speech_transcription_empty_audio_chunk_writes_empty_transcript() {
        let root = unique_temp_dir("sdkwork-autocut-empty-audio-chunk");
        let transcript_path = root.join("chunk-0002.json");
        let audio_path = root.join("chunk-0002.wav");
        fs::create_dir_all(&root).expect("create empty chunk fixture dir");
        fs::write(&audio_path, [0_u8; 98]).expect("write WAV header only fixture");

        assert!(!is_useful_speech_audio_chunk(&audio_path));
        write_empty_whisper_transcript_json(&transcript_path, "zh")
            .expect("write empty transcript for empty chunk");
        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("read empty chunk transcript");
        let segments = parse_whisper_transcript_json_allow_empty(&source)
            .expect("empty chunk transcript should parse as zero segments");
        let guard = evaluate_speech_transcript_quality(
            &segments,
            "local-whisper-chunk",
            Some("chunk-0002"),
            true,
        );

        assert!(segments.is_empty());
        assert!(guard.passed);
        assert_eq!(guard.status, "passed-empty");
    }

    #[test]
    fn chunked_speech_transcription_defaults_to_source_direct_strategy_for_fast_cpu_profiles() {
        let request = AutoCutSpeechTranscriptionRequest {
            asset_uuid: "asset-1".to_string(),
            workflow_task_id: Some("task-1".to_string()),
            provider_id: Some("local-whisper-cli".to_string()),
            stt_preset_id: Some(" smart-slice-balanced-local ".to_string()),
            stt_execution_profile: Some(" balanced ".to_string()),
            whisper_chunk_parallelism: Some(3),
            whisper_chunk_thread_count: Some(2),
            whisper_chunk_source_strategy: None,
            whisper_audio_context: None,
            whisper_beam_size: None,
            whisper_best_of: None,
            whisper_no_fallback: false,
            language: Some("auto".to_string()),
            output_root_dir: None,
            executable_path: None,
            model_path: None,
            workflow_purpose: Some("smart-slice-transcript-evidence".to_string()),
            dedupe_repeated_speech: false,
        };

        let options = normalize_speech_transcription_execution_options(&request)
            .expect("balanced STT options should normalize");

        assert_eq!(
            options.chunk_source_strategy,
            AutoCutSpeechChunkSourceStrategy::SourceDirect
        );
        assert_eq!(options.whisper_audio_context, None);
        assert_eq!(options.whisper_beam_size, Some(1));
        assert_eq!(options.whisper_best_of, Some(1));
        assert!(options.whisper_no_fallback);
    }

    #[test]
    fn speech_transcription_execution_options_normalize_measured_whisper_decode_settings() {
        let request = AutoCutSpeechTranscriptionRequest {
            asset_uuid: "asset-1".to_string(),
            workflow_task_id: Some("task-1".to_string()),
            provider_id: Some("local-whisper-cli".to_string()),
            stt_preset_id: Some(" smart-slice-balanced-local ".to_string()),
            stt_execution_profile: Some(" balanced ".to_string()),
            whisper_chunk_parallelism: Some(3),
            whisper_chunk_thread_count: Some(2),
            whisper_chunk_source_strategy: Some("source-direct".to_string()),
            whisper_audio_context: Some(768),
            whisper_beam_size: Some(1),
            whisper_best_of: Some(1),
            whisper_no_fallback: true,
            language: Some("auto".to_string()),
            output_root_dir: None,
            executable_path: None,
            model_path: None,
            workflow_purpose: Some("smart-slice-transcript-evidence".to_string()),
            dedupe_repeated_speech: false,
        };

        let options = normalize_speech_transcription_execution_options(&request)
            .expect("balanced STT decode options should normalize");

        assert_eq!(options.whisper_audio_context, Some(768));
        assert_eq!(options.whisper_beam_size, Some(1));
        assert_eq!(options.whisper_best_of, Some(1));
        assert!(options.whisper_no_fallback);
    }

    #[test]
    fn speech_transcription_execution_options_reject_invalid_decode_settings() {
        let request = AutoCutSpeechTranscriptionRequest {
            asset_uuid: "asset-1".to_string(),
            workflow_task_id: Some("task-1".to_string()),
            provider_id: Some("local-whisper-cli".to_string()),
            stt_preset_id: Some(" smart-slice-balanced-local ".to_string()),
            stt_execution_profile: Some(" balanced ".to_string()),
            whisper_chunk_parallelism: Some(3),
            whisper_chunk_thread_count: Some(2),
            whisper_chunk_source_strategy: Some("source-direct".to_string()),
            whisper_audio_context: Some(4_096),
            whisper_beam_size: Some(0),
            whisper_best_of: Some(9),
            whisper_no_fallback: true,
            language: Some("auto".to_string()),
            output_root_dir: None,
            executable_path: None,
            model_path: None,
            workflow_purpose: Some("smart-slice-transcript-evidence".to_string()),
            dedupe_repeated_speech: false,
        };

        let error = normalize_speech_transcription_execution_options(&request)
            .expect_err("invalid decode settings must fail closed");

        assert!(
            error.contains("whisperAudioContext")
                || error.contains("whisperBeamSize")
                || error.contains("whisperBestOf")
        );
    }

    #[test]
    fn chunked_speech_transcription_rejects_unknown_chunk_source_strategy() {
        let request = AutoCutSpeechTranscriptionRequest {
            asset_uuid: "asset-1".to_string(),
            workflow_task_id: Some("task-1".to_string()),
            provider_id: Some("local-whisper-cli".to_string()),
            stt_preset_id: Some(" smart-slice-balanced-local ".to_string()),
            stt_execution_profile: Some(" balanced ".to_string()),
            whisper_chunk_parallelism: Some(3),
            whisper_chunk_thread_count: Some(2),
            whisper_chunk_source_strategy: Some("video-first".to_string()),
            whisper_audio_context: None,
            whisper_beam_size: None,
            whisper_best_of: None,
            whisper_no_fallback: false,
            language: Some("auto".to_string()),
            output_root_dir: None,
            executable_path: None,
            model_path: None,
            workflow_purpose: Some("smart-slice-transcript-evidence".to_string()),
            dedupe_repeated_speech: false,
        };

        let error = normalize_speech_transcription_execution_options(&request)
            .expect_err("unknown chunk source strategy must fail closed");

        assert!(error.contains("whisperChunkSourceStrategy"));
    }

    #[test]
    fn long_speech_transcription_chunk_extract_command_uses_audio_only_seek_window() {
        let toolchain = test_system_ffmpeg_toolchain();
        let chunk =
            create_autocut_speech_audio_chunk_plan(Path::new("chunks"), 240_000, 60_000, 2_000)
                .remove(1);
        let command = build_ffmpeg_speech_audio_chunk_extract_command(
            &toolchain,
            Path::new("speech.wav"),
            AutoCutSpeechChunkAudioSourceKind::ExtractedWav,
            &chunk,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|items| items == ["-ss", "58.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "60.000"]));
        assert!(args.windows(2).any(|items| items == ["-i", "speech.wav"]));
        assert!(args.windows(2).any(|items| items == ["-ac", "1"]));
        assert!(args.windows(2).any(|items| items == ["-ar", "16000"]));
        assert!(
            !args.iter().any(|arg| arg == "-vn"),
            "chunk extraction operates on extracted speech audio, not the source video stream"
        );
    }

    #[test]
    fn long_speech_transcription_source_chunk_extract_command_skips_video_decode() {
        let toolchain = test_system_ffmpeg_toolchain();
        let chunk =
            create_autocut_speech_audio_chunk_plan(Path::new("chunks"), 240_000, 60_000, 2_000)
                .remove(1);
        let command = build_ffmpeg_speech_audio_chunk_extract_command(
            &toolchain,
            Path::new("source.mp4"),
            AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect,
            &chunk,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|items| items == ["-ss", "58.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "60.000"]));
        assert!(args.windows(2).any(|items| items == ["-i", "source.mp4"]));
        assert!(
            args.iter().any(|arg| arg == "-vn"),
            "direct source-media chunk extraction must skip video decode for large-file STT speed"
        );
        assert!(args.windows(2).any(|items| items == ["-ac", "1"]));
        assert!(args.windows(2).any(|items| items == ["-ar", "16000"]));
    }

    #[test]
    fn long_speech_transcription_chunk_pipeline_resumes_finished_artifacts() {
        let root = unique_temp_dir("sdkwork-autocut-speech-chunk-pipeline-resume");
        let chunks_dir = root.join("chunks");
        fs::create_dir_all(&chunks_dir).expect("create chunk dir");
        let chunk =
            create_autocut_speech_audio_chunk_plan(&chunks_dir, 60_000, 60_000, 2_000).remove(0);
        fs::write(&chunk.audio_path, b"ready wav").expect("write ready chunk wav");
        fs::write(&chunk.transcript_path, b"{\"transcription\":[]}")
            .expect("write ready transcript");
        let missing_binary_toolchain = AutoCutFfmpegToolchain {
            executable: root.join("missing-ffmpeg.exe").display().to_string(),
            source_kind: "test".to_string(),
            manifest_ready: false,
            bundled_ready: false,
            diagnostics: Vec::new(),
        };
        let missing_speech_toolchain = AutoCutSpeechToolchain {
            executable: root.join("missing-whisper.exe").display().to_string(),
            model_path: "missing-model.bin".to_string(),
            source_kind: "test".to_string(),
            acceleration_backend: None,
            executable_ready: false,
            model_ready: false,
            ready: true,
            diagnostics: Vec::new(),
            default_executable_directory: String::new(),
            default_executable_path: String::new(),
            default_model_directory: String::new(),
            default_model_path: String::new(),
            executable_strategy: String::new(),
        };

        run_autocut_speech_chunk_pipeline_step(
            &missing_binary_toolchain,
            &missing_speech_toolchain,
            Path::new("source.mp4"),
            AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect,
            "auto",
            "2",
            &chunk,
            AutoCutSpeechChunkPipelineStep::ExtractAudio,
            &AutoCutSpeechTranscriptionExecutionOptions::default(),
        )
        .expect("finished chunk audio should skip extraction");
        run_autocut_speech_chunk_pipeline_step(
            &missing_binary_toolchain,
            &missing_speech_toolchain,
            Path::new("source.mp4"),
            AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect,
            "auto",
            "2",
            &chunk,
            AutoCutSpeechChunkPipelineStep::TranscribeAudio,
            &AutoCutSpeechTranscriptionExecutionOptions::default(),
        )
        .expect("finished chunk transcript should skip transcription");
    }

    #[test]
    fn long_speech_transcription_merges_chunk_segments_back_to_source_timeline() {
        let chunks =
            create_autocut_speech_audio_chunk_plan(Path::new("chunks"), 1_360_000, 600_000, 2_000);
        let merged = merge_autocut_speech_audio_chunk_segments(
            &chunks,
            &[
                vec![AutoCutSpeechTranscriptionSegment {
                    start_ms: 1_000,
                    end_ms: 5_000,
                    text: "Opening topic.".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                    words: Some(vec![AutoCutSpeechTranscriptionWord {
                        start_ms: 1_500,
                        end_ms: 2_000,
                        text: "Opening".to_string(),
                        probability: Some(0.98),
                    }]),
                }],
                vec![AutoCutSpeechTranscriptionSegment {
                    start_ms: 3_000,
                    end_ms: 9_000,
                    text: "Second topic.".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                    words: None,
                }],
                vec![AutoCutSpeechTranscriptionSegment {
                    start_ms: 3_000,
                    end_ms: 5_000,
                    text: "Final conclusion.".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                    words: None,
                }],
            ],
        );

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].start_ms, 1_000);
        assert_eq!(merged[0].end_ms, 5_000);
        assert_eq!(merged[0].words.as_ref().unwrap()[0].start_ms, 1_500);
        assert_eq!(merged[1].start_ms, 601_000);
        assert_eq!(merged[1].end_ms, 607_000);
        assert_eq!(merged[2].start_ms, 1_199_000);
        assert_eq!(merged[2].end_ms, 1_201_000);
    }

    #[test]
    fn long_speech_transcription_repairs_partial_chunk_overlap_timeline() {
        let chunks =
            create_autocut_speech_audio_chunk_plan(Path::new("chunks"), 180_000, 60_000, 2_000);
        let merged = merge_autocut_speech_audio_chunk_segments(
            &chunks,
            &[
                vec![AutoCutSpeechTranscriptionSegment {
                    start_ms: 57_240,
                    end_ms: 60_000,
                    text: "The first chunk has a closing phrase.".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                    words: Some(vec![AutoCutSpeechTranscriptionWord {
                        start_ms: 57_240,
                        end_ms: 60_000,
                        text: "phrase".to_string(),
                        probability: Some(0.91),
                    }]),
                }],
                vec![
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 1_500,
                        end_ms: 3_860,
                        text: "A partially repeated overlap must not move backward.".to_string(),
                        speaker: Some("Speaker 1".to_string()),
                        words: Some(vec![AutoCutSpeechTranscriptionWord {
                            start_ms: 1_500,
                            end_ms: 3_860,
                            text: "overlap".to_string(),
                            probability: Some(0.88),
                        }]),
                    },
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 3_860,
                        end_ms: 6_460,
                        text: "Then the next chunk continues normally.".to_string(),
                        speaker: Some("Speaker 1".to_string()),
                        words: None,
                    },
                ],
                vec![],
            ],
        );

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].start_ms, 57_240);
        assert_eq!(merged[0].end_ms, 60_000);
        assert_eq!(merged[1].start_ms, 60_000);
        assert_eq!(merged[1].end_ms, 61_860);
        assert_eq!(merged[1].words.as_ref().unwrap()[0].start_ms, 60_000);
        assert_eq!(merged[1].words.as_ref().unwrap()[0].end_ms, 61_860);
        assert_eq!(merged[2].start_ms, 61_860);
        assert!(
            merged
                .windows(2)
                .all(|items| items[1].start_ms >= items[0].end_ms),
            "merged chunk transcript segments must be strictly ordered and non-overlapping"
        );
    }

    #[test]
    fn long_speech_transcription_writes_merged_transcript_as_parseable_whisper_json() {
        let root = unique_temp_dir("sdkwork-autocut-merged-whisper-transcript");
        let transcript_path = root.join("speech-transcript.json");
        let segments = vec![AutoCutSpeechTranscriptionSegment {
            start_ms: 1_000,
            end_ms: 4_500,
            text: "Opening topic.".to_string(),
            speaker: Some("speaker_1".to_string()),
            words: Some(vec![AutoCutSpeechTranscriptionWord {
                start_ms: 1_100,
                end_ms: 1_600,
                text: "Opening".to_string(),
                probability: Some(0.97),
            }]),
        }];

        write_merged_whisper_transcript_json(&transcript_path, "auto", &segments)
            .expect("write merged transcript JSON");
        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("read merged transcript JSON");
        let parsed = parse_whisper_transcript_json(&source)
            .expect("merged transcript JSON should use the same parser contract");
        let value: Value = serde_json::from_str(&source).expect("parse merged transcript value");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].start_ms, 1_000);
        assert_eq!(parsed[0].end_ms, 4_500);
        assert_eq!(parsed[0].speaker.as_deref(), Some("speaker_1"));
        assert_eq!(
            value.pointer("/result/language").and_then(Value::as_str),
            Some("auto")
        );
        assert_eq!(
            value
                .pointer("/transcription/0/offsets/from")
                .and_then(Value::as_i64),
            Some(1_000)
        );
    }

    #[test]
    fn long_speech_transcription_writes_observable_chunk_manifest() {
        let root = unique_temp_dir("sdkwork-autocut-speech-chunk-manifest");
        let chunks_dir = root.join("chunks");
        fs::create_dir_all(&chunks_dir).expect("create chunk dir");
        let chunks = create_autocut_speech_audio_chunk_plan(&chunks_dir, 180_000, 60_000, 2_000);
        let manifest_path = root.join("speech-transcript-chunk-manifest.json");
        let quality_guard = create_combined_speech_transcript_quality_guard("test");

        write_autocut_speech_chunk_manifest(
            &manifest_path,
            Path::new("speech.wav"),
            AutoCutSpeechChunkAudioSourceKind::ExtractedWav,
            180_000,
            &chunks_dir,
            &chunks,
            2,
            "4",
            &AutoCutSpeechTranscriptionExecutionOptions::default(),
            &quality_guard,
        )
        .expect("write chunk manifest");
        let manifest_source =
            fs::read_to_string(&manifest_path).expect("read speech chunk manifest JSON");
        let manifest: Value =
            serde_json::from_str(&manifest_source).expect("parse speech chunk manifest JSON");

        assert_eq!(
            manifest.get("schema").and_then(Value::as_str),
            Some("smart-slice.large-media-stt-chunks.v1")
        );
        assert_eq!(
            manifest.get("audioDurationMs").and_then(Value::as_i64),
            Some(180_000)
        );
        assert_eq!(manifest.get("parallelism").and_then(Value::as_u64), Some(2));
        assert_eq!(
            manifest.get("chunkThreadCount").and_then(Value::as_str),
            Some("4")
        );
        assert_eq!(
            manifest.get("speechSourceKind").and_then(Value::as_str),
            Some("extracted-wav")
        );
        assert_eq!(
            manifest.get("fullAudioExtracted").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            manifest.get("chunkSourceStrategy").and_then(Value::as_str),
            Some("audio-first")
        );
        assert_eq!(
            manifest
                .pointer("/qualityGuard/status")
                .and_then(Value::as_str),
            Some("passed")
        );
        assert_eq!(
            manifest.pointer("/chunks/0/id").and_then(Value::as_str),
            Some("chunk-0001")
        );
        assert_eq!(
            manifest
                .pointer("/chunks/1/startMs")
                .and_then(Value::as_i64),
            Some(58_000)
        );
    }

    #[test]
    fn long_speech_transcription_writes_source_direct_chunk_manifest() {
        let root = unique_temp_dir("sdkwork-autocut-source-direct-speech-chunk-manifest");
        let chunks_dir = root.join("chunks");
        fs::create_dir_all(&chunks_dir).expect("create chunk dir");
        let chunks = create_autocut_speech_audio_chunk_plan(&chunks_dir, 180_000, 60_000, 2_000);
        let manifest_path = root.join("speech-transcript-chunk-manifest.json");
        let quality_guard = create_combined_speech_transcript_quality_guard("test");

        write_autocut_speech_chunk_manifest(
            &manifest_path,
            Path::new("source.mp4"),
            AutoCutSpeechChunkAudioSourceKind::SourceMediaDirect,
            180_000,
            &chunks_dir,
            &chunks,
            3,
            "2",
            &AutoCutSpeechTranscriptionExecutionOptions::default(),
            &quality_guard,
        )
        .expect("write source-direct chunk manifest");
        let manifest_source =
            fs::read_to_string(&manifest_path).expect("read source-direct manifest JSON");
        let manifest: Value =
            serde_json::from_str(&manifest_source).expect("parse source-direct manifest JSON");

        assert_eq!(
            manifest.get("speechSourcePath").and_then(Value::as_str),
            Some("source.mp4")
        );
        assert_eq!(
            manifest.get("audioPath").and_then(Value::as_str),
            Some("source.mp4")
        );
        assert_eq!(
            manifest.get("speechSourceKind").and_then(Value::as_str),
            Some("source-media-direct")
        );
        assert_eq!(
            manifest.get("fullAudioExtracted").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            manifest.get("chunkSourceStrategy").and_then(Value::as_str),
            Some("audio-first")
        );
    }

    #[test]
    fn speech_transcription_execution_options_reject_invalid_chunk_strategy() {
        let request = AutoCutSpeechTranscriptionRequest {
            asset_uuid: "asset-1".to_string(),
            workflow_task_id: Some("task-1".to_string()),
            provider_id: Some("local-whisper-cli".to_string()),
            stt_preset_id: Some(" smart-slice-fast-preview ".to_string()),
            stt_execution_profile: Some(" fast-preview ".to_string()),
            whisper_chunk_parallelism: Some(0),
            whisper_chunk_thread_count: Some(2),
            whisper_chunk_source_strategy: None,
            whisper_audio_context: None,
            whisper_beam_size: None,
            whisper_best_of: None,
            whisper_no_fallback: false,
            language: Some("auto".to_string()),
            output_root_dir: None,
            executable_path: None,
            model_path: None,
            workflow_purpose: Some("smart-slice-transcript-evidence".to_string()),
            dedupe_repeated_speech: false,
        };

        let error = normalize_speech_transcription_execution_options(&request)
            .expect_err("zero chunk parallelism must be rejected before native STT starts");

        assert!(error.contains("whisperChunkParallelism"));
        assert!(error.contains("1 to 8"));
    }

    #[test]
    fn long_speech_transcription_writes_strategy_options_to_chunk_manifest() {
        let root = unique_temp_dir("sdkwork-autocut-speech-chunk-strategy-manifest");
        let chunks_dir = root.join("chunks");
        fs::create_dir_all(&chunks_dir).expect("create chunk dir");
        let chunks = create_autocut_speech_audio_chunk_plan(&chunks_dir, 180_000, 60_000, 2_000);
        let manifest_path = root.join("speech-transcript-chunk-manifest.json");
        let execution_options = AutoCutSpeechTranscriptionExecutionOptions {
            stt_preset_id: Some("smart-slice-fast-preview".to_string()),
            execution_profile: Some("fast-preview".to_string()),
            whisper_chunk_parallelism: Some(3),
            whisper_chunk_thread_count: Some(2),
            chunk_source_strategy: AutoCutSpeechChunkSourceStrategy::AudioFirst,
            whisper_audio_context: Some(512),
            whisper_beam_size: Some(1),
            whisper_best_of: Some(1),
            whisper_no_fallback: true,
        };
        let quality_guard = create_combined_speech_transcript_quality_guard("test");

        write_autocut_speech_chunk_manifest(
            &manifest_path,
            Path::new("speech.wav"),
            AutoCutSpeechChunkAudioSourceKind::ExtractedWav,
            180_000,
            &chunks_dir,
            &chunks,
            3,
            "2",
            &execution_options,
            &quality_guard,
        )
        .expect("write chunk strategy manifest");
        let manifest_source =
            fs::read_to_string(&manifest_path).expect("read speech chunk strategy manifest JSON");
        let manifest: Value = serde_json::from_str(&manifest_source)
            .expect("parse speech chunk strategy manifest JSON");

        assert_eq!(
            manifest.get("sttPresetId").and_then(Value::as_str),
            Some("smart-slice-fast-preview")
        );
        assert_eq!(
            manifest.get("executionProfile").and_then(Value::as_str),
            Some("fast-preview")
        );
        assert_eq!(manifest.get("parallelism").and_then(Value::as_u64), Some(3));
        assert_eq!(
            manifest.get("chunkThreadCount").and_then(Value::as_str),
            Some("2")
        );
        assert_eq!(
            manifest.get("whisperAudioContext").and_then(Value::as_u64),
            Some(512)
        );
        assert_eq!(
            manifest.get("whisperBeamSize").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            manifest.get("whisperBestOf").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            manifest.get("whisperNoFallback").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn video_slice_audio_activity_analysis_uses_denoised_silencedetect_filter() {
        let toolchain = test_system_ffmpeg_toolchain();
        let clip = smart_slice_test_clip(5_000, 30_000, "Boundary analysis");
        let command = build_ffmpeg_video_slice_audio_activity_analysis_command(
            &toolchain,
            Path::new("source.mp4"),
            &clip,
            true,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|items| items == ["-ss", "5.000"]));
        assert!(args.windows(2).any(|items| items == ["-t", "30.000"]));
        assert!(
            args.windows(2).any(|items| {
                items[0] == "-af"
                    && items[1] == ffmpeg_video_slice_audio_activity_analysis_filter(true)
                    && items[1].contains("afftdn=nr=10:nf=-25")
                    && items[1].ends_with("silencedetect=noise=-35dB:d=0.08")
                    && !items[1].contains(ffmpeg_video_slice_audio_loudness_filter())
            }),
            "audio boundary analysis must detect speech activity after denoise but before loudness normalization"
        );
    }

    #[test]
    fn video_slice_audio_activity_analysis_preserves_raw_audio_when_denoise_is_disabled() {
        let toolchain = test_system_ffmpeg_toolchain();
        let clip = smart_slice_test_clip(5_000, 30_000, "Raw boundary analysis");
        let command = build_ffmpeg_video_slice_audio_activity_analysis_command(
            &toolchain,
            Path::new("source.mp4"),
            &clip,
            false,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2).any(|items| {
                items[0] == "-af"
                    && items[1] == "silencedetect=noise=-35dB:d=0.08"
                    && !items[1].contains("afftdn")
                    && !items[1].contains(ffmpeg_video_slice_audio_loudness_filter())
            }),
            "raw audio boundary analysis must avoid denoise and loudness filters for clean source audio"
        );
    }

    #[test]
    fn video_slice_audio_activity_analysis_honors_requested_denoise_filter() {
        let root = unique_temp_dir("sdkwork-autocut-audio-activity-denoise-root");
        let source_root = unique_temp_dir("sdkwork-autocut-audio-activity-denoise-source");
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

        let analysis_result = analyze_autocut_video_slice_audio_activity_in_root_with_toolchain(
            None,
            &connection,
            &root,
            AutoCutVideoSliceAudioActivityAnalysisRequest {
                asset_uuid: import_result.asset_uuid,
                workflow_task_id: None,
                profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE.to_string(),
                apply_noise_reduction: true,
                output_root_dir: None,
                clips: vec![smart_slice_test_clip(0, 1_000, "Denoised activity")],
            },
            &toolchain,
        )
        .expect("analyze denoised audio activity");

        assert_eq!(
            analysis_result.analyses[0].analysis_filter,
            ffmpeg_video_slice_audio_activity_analysis_filter(true),
            "native Smart Slice audio activity analysis must record the requested denoised filter so frontend trust gates can accept denoise fallback evidence"
        );
    }

    #[test]
    fn video_slice_audio_activity_analysis_rejects_all_silence_instead_of_stt_fallback() {
        let clip = smart_slice_test_clip(5_000, 30_000, "All silence boundary analysis");
        let error = create_video_slice_audio_activity_analysis_from_silencedetect_stderr(
            &clip,
            0,
            true,
            "[silencedetect @ 000] silence_start: 0\n[silencedetect @ 000] silence_end: 30 | silence_duration: 30\n",
        )
        .expect_err("all-silence clips must not fall back to transcript timing");

        assert!(
            error.contains("high-confidence audio activity"),
            "all-silence audio boundary analysis should explain the activity evidence requirement: {error}"
        );
    }

    #[test]
    fn video_slice_audio_activity_analysis_reports_internal_silence_intervals() {
        let clip = smart_slice_test_clip(57_140, 36_160, "Internal silence boundary analysis");
        let analysis = create_video_slice_audio_activity_analysis_from_silencedetect_stderr(
            &clip,
            0,
            false,
            "[silencedetect @ 000] silence_start: 0\n\
             [silencedetect @ 000] silence_end: 0.200 | silence_duration: 0.200\n\
             [silencedetect @ 000] silence_start: 7.810\n\
             [silencedetect @ 000] silence_end: 14.950 | silence_duration: 7.140\n\
             [silencedetect @ 000] silence_start: 20.890\n\
             [silencedetect @ 000] silence_end: 22.530 | silence_duration: 1.640\n\
             [silencedetect @ 000] silence_start: 35.800\n\
             [silencedetect @ 000] silence_end: 36.160 | silence_duration: 0.360\n",
        )
        .expect("parse internal silence intervals");

        assert_eq!(
            analysis.internal_silence_intervals,
            Some(vec![
                AutoCutVideoSliceSourceSegment {
                    start_ms: 64_950,
                    end_ms: 72_090,
                },
                AutoCutVideoSliceSourceSegment {
                    start_ms: 78_030,
                    end_ms: 79_670,
                },
            ]),
            "native audio activity analysis must expose internal acoustic silence intervals on the source timeline"
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
        let output = new_autocut_hidden_child_command(&toolchain.executable)
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
        let output = new_autocut_hidden_child_command(&toolchain.executable)
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

    fn run_ffmpeg_test_video_with_middle_silence(
        toolchain: &AutoCutFfmpegToolchain,
        output_path: &Path,
    ) -> Result<(), String> {
        let output = new_autocut_hidden_child_command(&toolchain.executable)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=128x128:rate=30:duration=4.0",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=1.0",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=mono:sample_rate=44100:d=2.0",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1200:duration=1.0",
                "-filter_complex",
                "[1:a][2:a][3:a]concat=n=3:v=0:a=1[aout]",
                "-map",
                "0:v:0",
                "-map",
                "[aout]",
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
            .map_err(|error| format!("run AutoCut FFmpeg silence fixture failed: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "AutoCut FFmpeg silence fixture failed with status {}: {}",
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
        let output = new_autocut_hidden_child_command(&toolchain.executable)
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
        let mut command = new_autocut_hidden_child_command(toolchain.executable);
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
        let mut command =
            new_autocut_hidden_child_command(test_system_ffmpeg_toolchain().executable);
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
                |_| Ok(()),
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
        let mut command =
            new_autocut_hidden_child_command(test_system_ffmpeg_toolchain().executable);
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

        let error = wait_for_tracked_native_media_output(&tracked_child, &mut |_| {
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
        let mut command =
            new_autocut_hidden_child_command(test_system_ffmpeg_toolchain().executable);
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
            |_| Err("synthetic poll failure".to_string()),
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
    fn local_whisper_thread_count_is_bounded_for_desktop_responsiveness() {
        let thread_count = resolve_autocut_whisper_thread_count()
            .parse::<usize>()
            .expect("local Whisper thread count must be numeric");
        assert!(
            (2..=8).contains(&thread_count),
            "local Whisper thread count should stay between 2 and 8, got {thread_count}"
        );
    }

    #[test]
    fn whisper_progress_parser_accepts_whisper_cpp_callback_lines() {
        assert_eq!(
            parse_whisper_progress_percent("whisper_print_progress_callback: progress =  10%"),
            Some(10)
        );
        assert_eq!(
            parse_whisper_progress_percent("whisper_print_progress_callback: progress = 100%"),
            Some(100)
        );
        assert_eq!(parse_whisper_progress_percent("progress =   7%"), Some(7));
        assert_eq!(
            parse_whisper_progress_percent("whisper: progress = ready"),
            None
        );
        assert_eq!(parse_whisper_progress_percent("progress = 101%"), None);
    }

    #[test]
    fn local_whisper_progress_updates_processing_task_from_provider_percent() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        record_ops_task_progress(
            &connection,
            &task_uuid,
            45,
            json!({
                "operation": "speechTranscription",
                "stepId": "speech-to-text",
                "phase": "local-whisper-started"
            }),
        )
        .expect("record started progress");

        record_local_whisper_streaming_progress(None, &connection, &task_uuid, 50, "system-path")
            .expect("record local Whisper streaming progress");

        assert_eq!(
            read_task_progress(&connection, &task_uuid),
            map_local_whisper_cli_progress_to_task_progress(50)
        );
        let progress_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_PROGRESS);
        assert_eq!(progress_payload["operation"], "speechTranscription");
        assert_eq!(progress_payload["stepId"], "speech-to-text");
        assert_eq!(progress_payload["phase"], "local-whisper-progress");
        assert_eq!(progress_payload["source"], "whisper-cli-progress");
        assert_eq!(progress_payload["sourceKind"], "system-path");
        assert_eq!(progress_payload["providerProgress"], 50);
        assert_eq!(
            progress_payload["message"],
            "Local Whisper transcription progress 50%."
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
        record_ffmpeg_streaming_progress(None, &connection, &task_uuid, 42, "audioExtraction")
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
    fn native_task_progress_event_payload_is_standardized_for_desktop_bridge() {
        let event = create_native_task_progress_event(
            "ops-task-progress-contract",
            OPS_TASK_EVENT_TYPE_PROGRESS,
            json!({
                "workflowTaskId": "workflow-task-progress-contract",
                "operation": "speechTranscription",
                "phase": "local-whisper-started",
                "stepId": "speech-to-text",
                "message": "Local Whisper transcription started.",
                "severity": "info",
                "source": "native-host",
                "progress": 45
            }),
        );

        assert_eq!(event.task_uuid, "ops-task-progress-contract");
        assert_eq!(
            event.workflow_task_id.as_deref(),
            Some("workflow-task-progress-contract")
        );
        assert_eq!(
            event.native_task_id.as_deref(),
            Some("ops-task-progress-contract")
        );
        assert_eq!(event.operation.as_deref(), Some("speechTranscription"));
        assert_eq!(event.phase.as_deref(), Some("local-whisper-started"));
        assert_eq!(event.step_id.as_deref(), Some("speech-to-text"));
        assert_eq!(
            event.message.as_deref(),
            Some("Local Whisper transcription started.")
        );
        assert_eq!(event.progress, Some(45));
        assert_eq!(
            event.payload["workflowTaskId"],
            "workflow-task-progress-contract"
        );
    }

    #[test]
    fn ops_task_progress_inherits_workflow_task_id_from_task_input() {
        let connection = prepared_connection();
        let task_uuid = autocut_uuid("ops-task").expect("create task uuid");
        insert_processing_task_fixture(&connection, &task_uuid);
        connection
            .execute(
                "UPDATE ops_task SET input_json = ?1 WHERE uuid = ?2",
                params![
                    json!({
                        "operation": "speechTranscription",
                        "workflowTaskId": "workflow-task-from-input"
                    })
                    .to_string(),
                    task_uuid.as_str()
                ],
            )
            .expect("set workflow task id fixture");

        record_ops_task_progress(
            &connection,
            &task_uuid,
            45,
            json!({
                "phase": "local-whisper-started",
                "stepId": "speech-to-text"
            }),
        )
        .expect("record inherited workflow task progress");

        let progress_payload =
            read_task_event_payload(&connection, &task_uuid, OPS_TASK_EVENT_TYPE_PROGRESS);
        assert_eq!(progress_payload["operation"], "speechTranscription");
        assert_eq!(
            progress_payload["workflowTaskId"],
            "workflow-task-from-input"
        );
        assert_eq!(progress_payload["stepId"], "speech-to-text");
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
    fn ffmpeg_toolchain_resolver_accepts_verified_platform_sidecar_without_global_manifest_readiness()
     {
        let manifest_root = unique_temp_dir("sdkwork-autocut-ffmpeg-platform-bundled-sidecar");
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
    fn media_import_links_source_file_into_sandbox_and_registers_asset() {
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
            "imported source must be transferred under the media input sandbox"
        );
        assert_eq!(
            fs::read(&sandbox_path).expect("read imported file"),
            b"autocut source bytes"
        );

        let source_metadata = fs::metadata(&source_path).expect("read source metadata");
        let sandbox_metadata = fs::metadata(&sandbox_path).expect("read sandbox metadata");
        assert_eq!(
            sandbox_metadata.len(),
            source_metadata.len(),
            "import transfer must preserve source byte size"
        );

        let (row_count, uuid, source_uri, byte_size, metadata_json) = connection
            .query_row(
                "SELECT COUNT(*), MAX(uuid), MAX(source_uri), MAX(byte_size), MAX(metadata_json) FROM media_asset",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .expect("query imported asset");
        assert_eq!(row_count, 1);
        assert_eq!(uuid, result.asset_uuid);
        assert_eq!(source_uri, result.sandbox_path);
        assert_eq!(byte_size, 20);
        let metadata: Value =
            serde_json::from_str(&metadata_json).expect("parse import metadata JSON");
        assert!(
            ["hard-link", "copy"].contains(
                &metadata["importTransferStrategy"]
                    .as_str()
                    .unwrap_or_default()
            ),
            "import metadata must record whether the large-file transfer used hard-link or copy: {metadata_json}"
        );
    }

    #[test]
    fn media_import_transfer_prefers_hard_link_for_large_file_efficiency() {
        let root = unique_temp_dir("sdkwork-autocut-media-import-link");
        let source_path = root.join("large-source.mp4");
        let sandbox_path = root.join("linked-source.mp4");
        fs::write(&source_path, b"large source bytes").expect("write source media");

        let strategy = transfer_media_import_source_into_sandbox(&source_path, &sandbox_path)
            .expect("transfer source into sandbox");

        assert_eq!(
            strategy,
            AutoCutMediaImportTransferStrategy::HardLink,
            "same-directory media import should avoid copying large files by hard-linking first"
        );
        assert_eq!(
            fs::read(&sandbox_path).expect("read sandbox media"),
            b"large source bytes"
        );
        assert_eq!(
            format_autocut_media_import_transfer_strategy(strategy),
            "hard-link"
        );
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
        assert_eq!(description.media_type, "binary");
        assert_eq!(description.mime_type, "video/mp4");
        assert!(
            !description.has_audio_stream,
            "describing without FFmpeg must not invent audio-stream evidence from extension labels"
        );
        assert!(
            !description.has_video_stream,
            "describing without FFmpeg must not invent video-stream evidence from extension labels"
        );
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
    fn video_file_fingerprint_reports_streamed_sha256_and_canonical_metadata() {
        let source_root = unique_temp_dir("sdkwork-autocut-video-file-fingerprint");
        let source_path = source_root.join("renamed duplicate.mp4");
        let source_bytes = b"autocut native fingerprint bytes";
        fs::write(&source_path, source_bytes).expect("write source media");

        let fingerprint = fingerprint_autocut_video_file_from_path_for_test(&source_path)
            .expect("fingerprint local video file");

        assert_eq!(
            fingerprint.source_path,
            source_path
                .canonicalize()
                .expect("canonicalize source path")
                .display()
                .to_string()
        );
        assert_eq!(fingerprint.byte_size, source_bytes.len() as u64);
        assert!(
            fingerprint.modified_at_ms > 0,
            "video file fingerprint must include lightweight file identity metadata for cache validation"
        );
        assert_eq!(fingerprint.sha256, sha256_hex(source_bytes));
        assert_eq!(fingerprint.algorithm, "sha256");
        assert_eq!(
            fingerprint.fingerprint_version,
            "2026-05-15.video-file-fingerprint.v1"
        );
        assert_eq!(
            fingerprint.file_identity_version,
            "2026-05-15.video-file-identity.v1"
        );
    }

    #[test]
    fn video_file_identity_probe_reports_canonical_metadata_without_hashing() {
        let source_root = unique_temp_dir("sdkwork-autocut-video-file-identity");
        let source_path = source_root.join("identity checked duplicate.mp4");
        let source_bytes = b"autocut native identity bytes";
        fs::write(&source_path, source_bytes).expect("write source media");

        let identity = probe_autocut_video_file_identity_from_path_for_test(&source_path)
            .expect("probe local video file identity");

        assert_eq!(
            identity.source_path,
            source_path
                .canonicalize()
                .expect("canonicalize source path")
                .display()
                .to_string()
        );
        assert_eq!(identity.byte_size, source_bytes.len() as u64);
        assert!(
            identity.modified_at_ms > 0,
            "video file identity probe must expose modifiedAtMs for cache invalidation"
        );
        assert_eq!(
            identity.file_identity_version,
            "2026-05-15.video-file-identity.v1"
        );
    }

    #[test]
    fn audio_fingerprint_extraction_from_source_path_writes_stable_native_evidence() {
        let root = unique_temp_dir("sdkwork-autocut-audio-fingerprint");
        let source_root = unique_temp_dir("sdkwork-autocut-audio-fingerprint-source");
        let source_path = source_root.join("speaker-audio.mp4");
        let toolchain = test_system_ffmpeg_toolchain();
        run_ffmpeg_test_video_with_audio(&toolchain, &source_path)
            .expect("generate source video with audio");
        let connection = prepared_connection();

        let first = extract_autocut_audio_fingerprint_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutAudioFingerprintRequest {
                asset_uuid: "source-path-audio-fingerprint".to_string(),
                source_path: Some(source_path.display().to_string()),
                workflow_task_id: Some("workflow-audio-fingerprint-test".to_string()),
                fingerprint_profile: "audio-energy-v1".to_string(),
                sample_rate_hz: Some(16_000),
                window_duration_ms: Some(1_000),
                output_root_dir: None,
            },
            &toolchain,
        )
        .expect("extract source-path audio fingerprint");
        let second = extract_autocut_audio_fingerprint_in_root_with_toolchain(
            &connection,
            &root,
            AutoCutAudioFingerprintRequest {
                asset_uuid: "source-path-audio-fingerprint-repeat".to_string(),
                source_path: Some(source_path.display().to_string()),
                workflow_task_id: Some("workflow-audio-fingerprint-repeat-test".to_string()),
                fingerprint_profile: "audio-energy-v1".to_string(),
                sample_rate_hz: Some(16_000),
                window_duration_ms: Some(1_000),
                output_root_dir: None,
            },
            &toolchain,
        )
        .expect("extract repeated source-path audio fingerprint");

        assert!(first.ready);
        assert_eq!(first.provider, "ffmpeg-audio");
        assert_eq!(first.profile, "audio-energy-v1");
        assert_eq!(first.sample_rate_hz, 16_000);
        assert_eq!(first.window_duration_ms, 1_000);
        assert!(first.duration_ms >= 1_000);
        assert_eq!(first.fingerprint.algorithm, "audio-energy-v1");
        assert_eq!(
            first.fingerprint.hash.len(),
            64,
            "audio fingerprint hash must be a sha256 hex digest"
        );
        assert!(
            first
                .fingerprint
                .hash
                .chars()
                .all(|character| character.is_ascii_hexdigit()),
            "audio fingerprint hash must be hexadecimal"
        );
        assert!(
            first.fingerprint.energy_buckets.len() >= 2,
            "audio fingerprint must expose non-empty energy buckets"
        );
        assert!(
            first
                .fingerprint
                .spectral_centroid_buckets
                .as_ref()
                .map(|buckets| buckets.len() == first.fingerprint.energy_buckets.len())
                .unwrap_or(false),
            "audio fingerprint spectral buckets must align with energy buckets"
        );
        assert_eq!(
            first.fingerprint.hash, second.fingerprint.hash,
            "same decoded audio should produce a stable native audio fingerprint"
        );
        let output_json = connection
            .query_row(
                "SELECT output_json FROM ops_task WHERE uuid = ?1",
                [first.task_uuid.as_str()],
                |row| row.get::<_, String>(0),
            )
            .expect("read audio fingerprint task output");
        let output: Value =
            serde_json::from_str(&output_json).expect("parse audio fingerprint output");
        assert_eq!(output["provider"], "ffmpeg-audio");
        assert_eq!(output["fingerprint"]["hash"], first.fingerprint.hash);
        let task_output_dir = output["taskOutputDir"]
            .as_str()
            .expect("audio fingerprint task outputDir");
        assert!(
            Path::new(task_output_dir)
                .join("audio-fingerprint.json")
                .is_file(),
            "audio fingerprint extraction must write a JSON artifact under the task output directory"
        );
    }

    #[test]
    fn local_media_describe_does_not_trust_extension_labels_as_stream_evidence() {
        let source_root = unique_temp_dir("sdkwork-autocut-local-media-describe-stream-proof");
        let source_path = source_root.join("not-actually-video.mp4");
        fs::write(&source_path, b"plain bytes with a misleading extension")
            .expect("write mislabeled source media");
        let description = describe_autocut_local_media_file_from_path(
            &source_path,
            Some(&test_system_ffmpeg_toolchain()),
        )
        .expect("describe mislabeled local media file");

        assert_eq!(
            description.media_type, "binary",
            "FFmpeg stream evidence, not a .mp4 extension, must determine whether a file is usable video"
        );
        assert!(
            !description.has_audio_stream,
            "mislabeled local media must not claim audio stream evidence"
        );
        assert!(
            !description.has_video_stream,
            "mislabeled local media must not claim video stream evidence"
        );
    }

    #[test]
    fn ffmpeg_media_probe_evidence_parses_streams_and_duration_from_single_output() {
        let stderr = r#"
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0(und): Video: h264 (High), yuv420p(progressive), 1920x1080, 30 fps
  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s
"#;

        let evidence = parse_ffmpeg_media_probe_evidence(stderr);

        assert!(evidence.has_audio_stream);
        assert!(evidence.has_video_stream);
        assert_eq!(evidence.duration_ms, Some(62_500));
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
                output_quality: "320".to_string(),
                output_channel: "stereo".to_string(),
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
    fn audio_extraction_applies_quality_and_channel_contract() {
        let root = unique_temp_dir("sdkwork-autocut-audio-quality-channel-root");
        let source_root = unique_temp_dir("sdkwork-autocut-audio-quality-channel-source");
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
                output_format: "mp3".to_string(),
                output_quality: "256".to_string(),
                output_channel: "smart-stereo".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract smart stereo MP3 from imported asset");

        let input = read_ops_task_input_json(&connection, &extraction_result.task_uuid);
        assert_eq!(input["outputFormat"], "mp3");
        assert_eq!(input["outputQuality"], "256");
        assert_eq!(input["outputChannel"], "smart-stereo");
        assert_eq!(extraction_result.format, "mp3");
        assert!(
            Path::new(&extraction_result.artifact_path).is_file(),
            "audio extraction must write a real MP3 artifact after applying quality and channel settings"
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
                output_quality: "320".to_string(),
                output_channel: "stereo".to_string(),
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
        let task_output_dir = configured_root.join(AUTOCUT_MEDIA_TASK_DIR).join(task_uuid);
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
                    "taskOutputDir": "relative/tasks/ops-task-relative-output"
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
            let mut command = new_autocut_hidden_child_command(toolchain.executable);
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
            has_video_stream: false,
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
            let mut command = new_autocut_hidden_child_command(toolchain.executable);
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
                "outputFormat": "wav",
                "outputQuality": "320",
                "outputChannel": "stereo"
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
        let retry_input = read_ops_task_input_json(&connection, &retry_result.retry_task_uuid);
        assert_eq!(retry_input["outputFormat"], "wav");
        assert_eq!(retry_input["outputQuality"], "320");
        assert_eq!(retry_input["outputChannel"], "stereo");
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
                "outputQuality": "320",
                "outputChannel": "stereo",
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
                output_quality: "320".to_string(),
                output_channel: "stereo".to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract audio from imported asset");

        let task_output_dir = root
            .join("tasks")
            .join(&result.task_uuid)
            .canonicalize()
            .expect("canonical task output directory");
        assert!(
            Path::new(&result.artifact_path).starts_with(&task_output_dir),
            "audio artifact must be written directly under the task output directory"
        );
        assert!(
            Path::new(&result.artifact_path).is_file(),
            "audio artifact file must exist in the task output directory"
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
                output_quality: "320".to_string(),
                output_channel: "stereo".to_string(),
                output_root_dir: Some(configured_root.display().to_string()),
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("extract audio into configured output root");

        let task_output_dir = canonical_configured_root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(&result.task_uuid)
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
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
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
                            words: None,
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
        for slice in &slice_result.slices {
            assert_eq!(
                slice.audio_cleanup_profile.as_deref(),
                Some(SMART_SLICE_AUDIO_CLEANUP_PROFILE),
                "native slice artifacts must preserve the canonical Smart Slice audio cleanup profile"
            );
            assert_eq!(
                slice.noise_reduction_applied,
                Some(false),
                "native slice artifacts must report the requested Smart Slice noise-reduction decision"
            );
            assert_eq!(
                slice.boundary_decision_source.as_deref(),
                Some("transcript"),
                "native slice artifacts must expose the boundary decision source"
            );
            assert_eq!(
                slice.leading_silence_trim_ms,
                Some(0),
                "native slice artifacts must emit explicit zero leading trim evidence"
            );
            assert_eq!(
                slice.trailing_silence_trim_ms,
                Some(0),
                "native slice artifacts must emit explicit zero trailing trim evidence"
            );
            assert_eq!(
                slice.tail_treatment.as_deref(),
                Some("none"),
                "native slice artifacts must expose the final tail cleanup treatment"
            );
        }
        let task_output_dir = root
            .join(AUTOCUT_MEDIA_TASK_DIR)
            .join(&slice_result.task_uuid)
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
                .contains("/cover/"),
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
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
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
    fn video_slice_from_asset_postprocesses_generated_slice_to_remove_middle_silence() {
        let root = unique_temp_dir("sdkwork-autocut-video-slice-postprocess-root");
        let source_root = unique_temp_dir("sdkwork-autocut-video-slice-postprocess-source");
        let source_path = source_root.join("clip-with-middle-silence.mp4");
        let toolchain = test_system_ffmpeg_toolchain();
        run_ffmpeg_test_video_with_middle_silence(&toolchain, &source_path)
            .expect("create video fixture with middle silence");
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
        .expect("import video fixture with middle silence");

        let slice_result = slice_autocut_video_from_asset_in_root_with_toolchain(
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
                clips: vec![smart_slice_test_clip(0, 4_000, "Remove middle silence")],
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
        .expect("slice video and postprocess generated artifact");

        let slice = &slice_result.slices[0];
        assert!(
            slice.duration_ms < 3_000,
            "final slice duration should shrink after post-cut silence removal, got {}",
            slice.duration_ms
        );
        assert!(
            slice.removed_silence_ms.unwrap_or_default() >= 1_500,
            "native result must report removed silence from the generated slice artifact"
        );
        assert!(
            slice
                .source_segments
                .as_ref()
                .is_some_and(|segments| segments.len() >= 2),
            "native result must expose retained source segments after post-cut silence removal"
        );
        assert_eq!(
            slice.noise_reduction_applied,
            Some(true),
            "final artifact must report the post-cut denoise decision"
        );
        assert_ffmpeg_video_has_audible_audio(&toolchain, Path::new(&slice.artifact_path))
            .expect("postprocessed slice should preserve audible speech audio");
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
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
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
                        words: None,
                    },
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 150,
                        end_ms: 300,
                        text: "opening highlight".to_string(),
                        speaker: Some("Speaker 1".to_string()),
                        words: None,
                    },
                    AutoCutSpeechTranscriptionSegment {
                        start_ms: 320,
                        end_ms: 450,
                        text: "closing note".to_string(),
                        speaker: None,
                        words: None,
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
                    words: None,
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 1_300,
                    end_ms: 2_200,
                    text: "inside line".to_string(),
                    speaker: None,
                    words: None,
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 2_900,
                    end_ms: 3_500,
                    text: "tail overlap".to_string(),
                    speaker: None,
                    words: None,
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 3_500,
                    end_ms: 4_000,
                    text: "outside line".to_string(),
                    speaker: None,
                    words: None,
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
    fn video_slice_filters_merged_audio_mute_ranges_that_would_create_long_silence() {
        let mut clip = smart_slice_test_clip(0, 10_000, "Merged noise");
        clip.audio_mute_ranges = Some(vec![
            AutoCutVideoSliceAudioMuteRange {
                start_ms: 3_000,
                end_ms: 5_000,
            },
            AutoCutVideoSliceAudioMuteRange {
                start_ms: 5_000,
                end_ms: 7_000,
            },
        ]);

        let clips =
            normalize_video_slice_clips(&[clip]).expect("normalize smart slice audio mute ranges");

        assert!(
            clips[0].audio_mute_ranges.is_none(),
            "merged smart-slice mute ranges longer than 3000ms should be filtered instead of creating a long silent hole"
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
    fn video_slice_rejects_invalid_audio_cleanup_evidence_before_rendering() {
        let mut invalid_profile_clip = smart_slice_test_clip(0, 1_000, "Invalid profile");
        invalid_profile_clip.audio_cleanup_profile = Some("legacy-cleanup".to_string());
        let profile_error = normalize_video_slice_clips(&[invalid_profile_clip])
            .expect_err("invalid Smart Slice cleanup profiles must fail closed");
        assert!(
            profile_error.contains("audioCleanupProfile"),
            "invalid cleanup profile rejection should name the bad field: {profile_error}"
        );

        let mut invalid_boundary_clip = smart_slice_test_clip(0, 1_000, "Invalid boundary");
        invalid_boundary_clip.boundary_decision_source = Some("guess".to_string());
        let boundary_error = normalize_video_slice_clips(&[invalid_boundary_clip])
            .expect_err("invalid Smart Slice boundary decision evidence must fail closed");
        assert!(
            boundary_error.contains("boundaryDecisionSource"),
            "invalid boundary source rejection should name the bad field: {boundary_error}"
        );

        let mut invalid_trim_clip = smart_slice_test_clip(0, 1_000, "Invalid trim");
        invalid_trim_clip.leading_silence_trim_ms = Some(-1);
        let trim_error = normalize_video_slice_clips(&[invalid_trim_clip])
            .expect_err("negative Smart Slice trim evidence must fail closed");
        assert!(
            trim_error.contains("leadingSilenceTrimMs"),
            "invalid trim rejection should name the bad field: {trim_error}"
        );

        let mut invalid_tail_clip = smart_slice_test_clip(0, 1_000, "Invalid tail");
        invalid_tail_clip.tail_treatment = Some("hard-cut".to_string());
        let tail_error = normalize_video_slice_clips(&[invalid_tail_clip])
            .expect_err("invalid Smart Slice tail treatment evidence must fail closed");
        assert!(
            tail_error.contains("tailTreatment"),
            "invalid tail treatment rejection should name the bad field: {tail_error}"
        );
    }

    #[test]
    fn video_slice_accepts_audio_refined_speech_range_covered_by_transcript_segments() {
        let clips = normalize_video_slice_clips(&[AutoCutVideoSliceClipRequest {
            start_ms: 1_000,
            duration_ms: 10_000,
            label: "Audio refined speech range".to_string(),
            output_file_name: None,
            source_start_ms: Some(1_000),
            source_end_ms: Some(11_000),
            speech_start_ms: Some(1_200),
            speech_end_ms: Some(10_800),
            boundary_padding_before_ms: Some(200),
            boundary_padding_after_ms: Some(200),
            transcript_text: Some("Opening context. Closing context.".to_string()),
            transcript_segments: Some(vec![
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 1_000,
                    end_ms: 5_600,
                    text: "Opening context.".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                    words: None,
                },
                AutoCutSpeechTranscriptionSegment {
                    start_ms: 5_700,
                    end_ms: 11_000,
                    text: "Closing context.".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                    words: None,
                },
            ]),
            transcript_segment_count: Some(2),
            transcript_coverage_score: Some(0.96),
            speech_continuity_grade: Some("strong".to_string()),
            ..AutoCutVideoSliceClipRequest::default()
        }])
        .expect("audio-refined smart slice speech range covered by transcript segments");

        assert_eq!(
            clips[0].speech_start_ms,
            Some(1_200),
            "native video slicing should preserve audio-refined speechStartMs"
        );
        assert_eq!(
            clips[0].speech_end_ms,
            Some(10_800),
            "native video slicing should preserve audio-refined speechEndMs"
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
    fn video_slice_burned_subtitle_mode_persists_editable_srt_sidecar() {
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
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
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
                    words: None,
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
        let subtitle_path = slice_result.slices[0]
            .subtitle_artifact_path
            .as_deref()
            .expect("burned subtitle mode must still return an editable SRT sidecar");
        assert_eq!(
            slice_result.slices[0].subtitle_format.as_deref(),
            Some("srt"),
            "burned subtitle mode must publish the sidecar format for later subtitle editing"
        );
        assert!(
            Path::new(subtitle_path).is_file(),
            "burned subtitle mode must persist the editable SRT file"
        );
        let subtitle_text =
            fs::read_to_string(subtitle_path).expect("read burned-mode editable subtitle sidecar");
        assert!(
            subtitle_text.contains("burn this subtitle"),
            "burned subtitle sidecar must preserve the slice subtitle text for later editing"
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
            .expect("query burned subtitle editable sidecar media artifact rows");
        assert_eq!(subtitle_artifact_count, 1);

        let task_output_json = connection
            .query_row(
                "SELECT output_json FROM ops_task WHERE uuid = ?1",
                params![slice_result.task_uuid.as_str()],
                |row| row.get::<_, String>(0),
            )
            .expect("query burned subtitle ops_task output_json");
        let task_output: Value = serde_json::from_str(&task_output_json)
            .expect("parse burned subtitle task output JSON");
        assert_eq!(
            task_output["sliceResults"][0]["subtitleArtifactPath"], subtitle_path,
            "slice task output JSON must persist the burned-mode editable subtitle path"
        );
        assert_eq!(
            task_output["subtitleArtifactCount"], 1,
            "burned subtitle mode must count the generated editable subtitle sidecar"
        );
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
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
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
            None,
            &connection,
            &root,
            AutoCutVideoSliceRequest {
                asset_uuid: import_result.asset_uuid.clone(),
                workflow_task_id: None,
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
    fn parse_whisper_transcript_json_preserves_word_level_timestamps_for_subtitles() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "transcription": [
                {
                  "timestamps": { "from": "00:00:02.000", "to": "00:00:04.200" },
                  "text": "专业 字幕 跟随 讲话",
                  "tokens": [
                    { "text": "专业", "timestamps": { "from": "00:00:02.000", "to": "00:00:02.500" }, "p": 0.95 },
                    { "text": "字幕", "offsets": { "from": 2500, "to": 3000 }, "p": 0.94 },
                    { "text": "跟随", "t0": 3.0, "t1": 3.6, "p": 0.93 },
                    { "text": "讲话", "start": 3.6, "end": 4.2, "p": 0.92 }
                  ]
                }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON with word timestamps");

        let words = segments[0]
            .words
            .as_ref()
            .expect("word timestamps should be preserved from full Whisper JSON");
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].text, "专业");
        assert_eq!(words[0].start_ms, 2000);
        assert_eq!(words[0].end_ms, 2500);
        assert_eq!(words[3].text, "讲话");
        assert_eq!(words[3].start_ms, 3600);
        assert_eq!(words[3].end_ms, 4200);
    }

    #[test]
    fn parse_whisper_transcript_json_treats_word_start_ms_end_ms_as_milliseconds() {
        let segments = parse_whisper_transcript_json(
            r#"
            {
              "segments": [
                {
                  "start": 2,
                  "end": 5,
                  "text": "millisecond word fields",
                  "words": [
                    { "text": "millisecond", "start_ms": 2100, "end_ms": 3200 },
                    { "text": "fields", "start_ms": 3200, "end_ms": 4800 }
                  ]
                }
              ]
            }
            "#,
        )
        .expect("parse whisper transcript JSON with millisecond word fields");

        let words = segments[0]
            .words
            .as_ref()
            .expect("word timestamps should be preserved");
        assert_eq!(words[0].start_ms, 2100);
        assert_eq!(words[0].end_ms, 3200);
        assert_eq!(words[1].start_ms, 3200);
        assert_eq!(words[1].end_ms, 4800);
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
    fn read_whisper_transcript_json_file_accepts_utf8_bom() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-utf8-bom-speech-json");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(
            br#"{"segments":[{"start":0,"end":1,"text":"utf8 bom transcript"}]}"#,
        );
        fs::write(&transcript_path, bytes).expect("write UTF-8 BOM transcript fixture");

        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("UTF-8 BOM transcript JSON should be readable");
        let segments =
            parse_whisper_transcript_json(&source).expect("UTF-8 BOM transcript JSON should parse");

        assert_eq!(segments[0].text, "utf8 bom transcript");
    }

    #[test]
    fn read_whisper_transcript_json_file_accepts_utf16le_bom() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-utf16le-speech-json");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        let source = r#"{"segments":[{"start":0,"end":1,"text":"utf16 transcript"}]}"#;
        let mut bytes = vec![0xff, 0xfe];
        for unit in source.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        fs::write(&transcript_path, bytes).expect("write UTF-16LE transcript fixture");

        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("UTF-16LE transcript JSON should be readable");
        let segments =
            parse_whisper_transcript_json(&source).expect("UTF-16LE transcript JSON should parse");

        assert_eq!(segments[0].text, "utf16 transcript");
    }

    #[test]
    fn read_whisper_transcript_json_file_accepts_utf16be_bom() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-utf16be-speech-json");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        let source = r#"{"segments":[{"start":0,"end":1,"text":"utf16be transcript"}]}"#;
        let mut bytes = vec![0xfe, 0xff];
        for unit in source.encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        fs::write(&transcript_path, bytes).expect("write UTF-16BE transcript fixture");

        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("UTF-16BE transcript JSON should be readable");
        let segments =
            parse_whisper_transcript_json(&source).expect("UTF-16BE transcript JSON should parse");

        assert_eq!(segments[0].text, "utf16be transcript");
    }

    #[test]
    fn read_whisper_transcript_json_file_recovers_invalid_whisper_full_json_token_utf8() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-lossy-whisper-token-json");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(
            br#"{"transcription":[{"offsets":{"from":0,"to":1000},"text":"hello transcript","tokens":[{"text":""#,
        );
        bytes.extend_from_slice(&[0xe8, 0x81]);
        bytes.extend_from_slice(br#"","offsets":{"from":0,"to":100}}]}]}"#);
        fs::write(&transcript_path, bytes).expect("write invalid Whisper full JSON fixture");

        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("Whisper full JSON with split UTF-8 token bytes should be recoverable");
        let segments = parse_whisper_transcript_json(&source)
            .expect("recovered Whisper full JSON should parse transcript segments");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "hello transcript");
        assert!(
            segments[0]
                .words
                .as_ref()
                .map(Vec::is_empty)
                .unwrap_or(true),
            "lossy replacement token text must not be used as word-level subtitle evidence"
        );
    }

    #[test]
    fn read_whisper_transcript_json_file_rejects_binary_payloads_with_diagnostics() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-binary-speech-json");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        fs::write(
            &transcript_path,
            [0x00, 0xff, 0x7f, 0x13, 0x42, 0x00, 0x01, 0x02],
        )
        .expect("write binary transcript fixture");

        let error = read_whisper_transcript_json_file(&transcript_path)
            .expect_err("binary transcript payloads must fail with diagnostics");

        assert!(
            error.contains("speech-transcript.json")
                && error.contains("byteSize=8")
                && error.contains("firstBytes=00 FF 7F 13 42 00 01 02"),
            "binary transcript diagnostics should include path, size, and byte prefix: {error}"
        );
    }

    #[test]
    fn whisper_transcript_parse_failure_diagnostics_include_file_context() {
        let transcript_dir = unique_temp_dir("sdkwork-autocut-invalid-shape-speech-json");
        let transcript_path = transcript_dir.join("speech-transcript.json");
        fs::write(&transcript_path, br#"{"notSegments":[]}"#)
            .expect("write invalid transcript JSON fixture");
        let source = read_whisper_transcript_json_file(&transcript_path)
            .expect("invalid-shape transcript JSON is still readable");
        let parse_error = parse_whisper_transcript_json(&source)
            .expect_err("invalid transcript shape must fail parsing");
        let contextual_error = format!(
            "AutoCut local Whisper transcript parse failed. language=auto sourceKind=test audioPath=audio.wav transcriptPath={} transcriptCharLength={} {} {parse_error}",
            transcript_path.display(),
            source.len(),
            format_whisper_transcript_existing_file_diagnostics(&transcript_path)
        );

        assert!(
            contextual_error.contains("language=auto")
                && contextual_error.contains("transcriptPath=")
                && contextual_error.contains("byteSize=18")
                && contextual_error.contains("firstBytes=7B 22 6E 6F 74 53 65 67"),
            "parse diagnostics should include runtime language and transcript file context: {contextual_error}"
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
            acceleration_backend: None,
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
            None,
            &connection,
            &root,
            AutoCutSpeechTranscriptionRequest {
                asset_uuid: import_result.asset_uuid,
                workflow_task_id: None,
                provider_id: Some("local-whisper-cli".to_string()),
                stt_preset_id: None,
                stt_execution_profile: None,
                whisper_chunk_parallelism: None,
                whisper_chunk_thread_count: None,
                whisper_chunk_source_strategy: None,
                whisper_audio_context: None,
                whisper_beam_size: None,
                whisper_best_of: None,
                whisper_no_fallback: false,
                language: Some("zh".to_string()),
                output_root_dir: None,
                executable_path: None,
                model_path: None,
                workflow_purpose: None,
                dedupe_repeated_speech: false,
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
        let manifest_root = unique_temp_dir("sdkwork-autocut-speech-platform-bundled-sidecar");
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

        assert_eq!(
            toolchain.model_path,
            default_model_path.display().to_string()
        );
        assert_eq!(
            toolchain.default_model_path,
            default_model_path.display().to_string()
        );
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
        let sidecar_path = manifest_root.join("windows-x86_64").join("whisper-cli.exe");
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
            error.contains("byteSize mismatch")
                || error.contains("checksum mismatch")
                || error.contains("placeholder integrity"),
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
    fn speech_model_download_resumes_existing_partial_file_with_http_range() {
        let target_dir = unique_temp_dir("sdkwork-autocut-speech-resume-range");
        let target_path = target_dir.join("ggml-resumable.bin.download");
        fs::write(&target_path, b"hello ").expect("write partial model download");
        let (url, request_handle) = start_single_response_http_server(|_, mut stream| {
            stream
                .write_all(
                    b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 6-10/11\r\nConnection: close\r\n\r\nworld",
                )
                .expect("write partial content response");
        });
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "resume-range".to_string(),
            file_name: "ggml-resumable.bin".to_string(),
            url: url.clone(),
            mirror_urls: None,
            sha256: sha256_hex(b"hello world"),
            output_root_dir: None,
        };

        let downloaded_byte_size = download_autocut_speech_transcription_model_file_with_progress(
            &request,
            &url,
            &target_path,
            None,
        )
        .expect("resumable model download should append the remaining bytes");
        let raw_request = request_handle.join().expect("read test HTTP request");
        let normalized_raw_request = raw_request.to_ascii_lowercase();

        assert!(
            normalized_raw_request.contains("range: bytes=6-"),
            "existing partial download must be resumed with a matching HTTP Range header: {raw_request}"
        );
        assert_eq!(downloaded_byte_size, 11);
        assert_eq!(
            fs::read(&target_path).expect("read resumed model download"),
            b"hello world"
        );
    }

    #[test]
    fn speech_model_download_restarts_when_server_ignores_resume_range() {
        let target_dir = unique_temp_dir("sdkwork-autocut-speech-resume-fallback");
        let target_path = target_dir.join("ggml-resumable.bin.download");
        fs::write(&target_path, b"stale-partial").expect("write stale partial model download");
        let (url, request_handle) = start_single_response_http_server(|_, mut stream| {
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello world",
                )
                .expect("write full content response");
        });
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "resume-fallback".to_string(),
            file_name: "ggml-resumable.bin".to_string(),
            url: url.clone(),
            mirror_urls: None,
            sha256: sha256_hex(b"hello world"),
            output_root_dir: None,
        };

        let downloaded_byte_size = download_autocut_speech_transcription_model_file_with_progress(
            &request,
            &url,
            &target_path,
            None,
        )
        .expect("server without Range support should trigger a clean full restart");
        let raw_request = request_handle.join().expect("read test HTTP request");
        let normalized_raw_request = raw_request.to_ascii_lowercase();

        assert!(
            normalized_raw_request.contains("range: bytes=13-"),
            "existing partial download should still ask the server for a resume range before falling back: {raw_request}"
        );
        assert_eq!(downloaded_byte_size, 11);
        assert_eq!(
            fs::read(&target_path).expect("read restarted model download"),
            b"hello world"
        );
    }

    #[test]
    fn speech_model_download_in_root_preserves_partial_file_for_resumable_retry() {
        let root = unique_temp_dir("sdkwork-autocut-speech-root-resume");
        let model_directory = root
            .join(AUTOCUT_MEDIA_MODEL_DIR)
            .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
        fs::create_dir_all(&model_directory).expect("create speech model directory");
        let temporary_path = model_directory.join("ggml-resumable.bin.download");
        fs::write(&temporary_path, b"hello ").expect("write existing partial download");
        let (server_url, request_handle) = start_single_response_http_server(
            |request, mut stream| {
                assert!(
                    request.to_ascii_lowercase().contains("range: bytes=6-"),
                    "download orchestration must preserve existing .download bytes for the native resume request: {request}"
                );
                stream
                .write_all(
                    b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 6-10/11\r\nConnection: close\r\n\r\nworld",
                )
                .expect("write partial content response");
            },
        );
        let download_url =
            format!("{server_url}/ggerganov/whisper.cpp/resolve/main/ggml-resumable.bin");
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "root-resume".to_string(),
            file_name: "ggml-resumable.bin".to_string(),
            url: download_url,
            mirror_urls: None,
            sha256: sha256_hex(b"hello world"),
            output_root_dir: None,
        };

        let result =
            download_validated_autocut_speech_transcription_model_in_root(&root, request, None)
                .expect("download orchestration should resume and install the verified model");
        let raw_request = request_handle.join().expect("read test HTTP request");
        let model_path = model_directory.join("ggml-resumable.bin");

        assert!(
            raw_request.to_ascii_lowercase().contains("range: bytes=6-"),
            "native model download should send the Range header from orchestration: {raw_request}"
        );
        assert_eq!(result.byte_size, 11);
        assert_eq!(
            fs::read(&model_path).expect("read installed model"),
            b"hello world"
        );
        assert!(
            !temporary_path.exists(),
            "verified resumed temp file should be atomically moved into the model path"
        );
    }

    #[test]
    fn speech_model_download_in_root_keeps_interrupted_partial_for_next_retry() {
        let root = unique_temp_dir("sdkwork-autocut-speech-interrupted-download");
        let model_directory = root
            .join(AUTOCUT_MEDIA_MODEL_DIR)
            .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
        fs::create_dir_all(&model_directory).expect("create speech model directory");
        let temporary_path = model_directory.join("ggml-interrupted.bin.download");
        let (server_url, request_handle) = start_single_response_http_server(|_, mut stream| {
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello ",
                )
                .expect("write interrupted full response");
        });
        let download_url =
            format!("{server_url}/ggerganov/whisper.cpp/resolve/main/ggml-interrupted.bin");
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "interrupted-download".to_string(),
            file_name: "ggml-interrupted.bin".to_string(),
            url: download_url,
            mirror_urls: None,
            sha256: sha256_hex(b"hello world"),
            output_root_dir: None,
        };

        let error =
            download_validated_autocut_speech_transcription_model_in_root(&root, request, None)
                .expect_err("interrupted model download should fail before installation");
        let _ = request_handle.join().expect("read test HTTP request");

        assert!(
            error.contains("did not finish") || error.contains("download failed"),
            "interrupted download error should explain that the transfer did not complete: {error}"
        );
        assert_eq!(
            fs::read(&temporary_path).expect("read preserved interrupted download"),
            b"hello "
        );
    }

    #[test]
    fn speech_model_download_in_root_removes_complete_file_after_sha256_mismatch() {
        let root = unique_temp_dir("sdkwork-autocut-speech-checksum-mismatch");
        let model_directory = root
            .join(AUTOCUT_MEDIA_MODEL_DIR)
            .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
        let temporary_path = model_directory.join("ggml-mismatch.bin.download");
        let (server_url, request_handle) = start_single_response_http_server(|_, mut stream| {
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nwrong content",
                )
                .expect("write checksum mismatch response");
        });
        let download_url =
            format!("{server_url}/ggerganov/whisper.cpp/resolve/main/ggml-mismatch.bin");
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "checksum-mismatch".to_string(),
            file_name: "ggml-mismatch.bin".to_string(),
            url: download_url,
            mirror_urls: None,
            sha256: sha256_hex(b"expected content"),
            output_root_dir: None,
        };

        let error =
            download_validated_autocut_speech_transcription_model_in_root(&root, request, None)
                .expect_err("complete but corrupted model download must fail checksum validation");
        let _ = request_handle.join().expect("read test HTTP request");

        assert!(
            error.contains("SHA-256 checksum mismatch"),
            "checksum mismatch error should name SHA-256 explicitly: {error}"
        );
        assert!(
            !temporary_path.exists(),
            "complete corrupted download should be removed so the next retry starts from a clean file"
        );
    }

    #[test]
    fn speech_model_download_installs_complete_partial_after_range_not_satisfiable() {
        let root = unique_temp_dir("sdkwork-autocut-speech-complete-partial-416");
        let model_directory = root
            .join(AUTOCUT_MEDIA_MODEL_DIR)
            .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
        fs::create_dir_all(&model_directory).expect("create speech model directory");
        let temporary_path = model_directory.join("ggml-complete.bin.download");
        fs::write(&temporary_path, b"hello world").expect("write complete temp model download");
        let (server_url, request_handle) = start_single_response_http_server(|_, mut stream| {
            stream
                .write_all(
                    b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */11\r\nConnection: close\r\n\r\n",
                )
                .expect("write range not satisfiable response");
        });
        let download_url =
            format!("{server_url}/ggerganov/whisper.cpp/resolve/main/ggml-complete.bin");
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "complete-partial-416".to_string(),
            file_name: "ggml-complete.bin".to_string(),
            url: download_url,
            mirror_urls: None,
            sha256: sha256_hex(b"hello world"),
            output_root_dir: None,
        };

        let result =
            download_validated_autocut_speech_transcription_model_in_root(&root, request, None)
                .expect("complete verified .download should be installed after HTTP 416");
        let raw_request = request_handle.join().expect("read test HTTP request");
        let model_path = model_directory.join("ggml-complete.bin");

        assert!(
            raw_request
                .to_ascii_lowercase()
                .contains("range: bytes=11-"),
            "complete temp file should be checked with a resume range before accepting HTTP 416: {raw_request}"
        );
        assert_eq!(result.byte_size, 11);
        assert_eq!(
            fs::read(&model_path).expect("read installed model"),
            b"hello world"
        );
        assert!(
            !temporary_path.exists(),
            "complete verified temp file should be moved into the installed model path"
        );
    }

    #[test]
    fn speech_model_download_marks_verified_existing_model_as_downloaded() {
        let root = unique_temp_dir("sdkwork-autocut-speech-existing-downloaded");
        let model_directory = root
            .join(AUTOCUT_MEDIA_MODEL_DIR)
            .join(AUTOCUT_MEDIA_SPEECH_MODEL_DIR);
        fs::create_dir_all(&model_directory).expect("create speech model directory");
        let model_path = model_directory.join("ggml-existing.bin");
        fs::write(&model_path, b"verified existing model").expect("write existing model");
        let request = AutoCutSpeechTranscriptionModelDownloadRequest {
            provider_id: "local-whisper-cli".to_string(),
            preset_id: "existing-downloaded".to_string(),
            file_name: "ggml-existing.bin".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-existing.bin"
                .to_string(),
            mirror_urls: None,
            sha256: sha256_hex(b"verified existing model"),
            output_root_dir: None,
        };

        let result = download_autocut_speech_transcription_model_in_root(&root, request, None)
            .expect("verified existing model should be accepted without downloading again");

        assert!(
            result.downloaded,
            "verified existing local model must be reported as already downloaded and available"
        );
        assert_eq!(result.byte_size, 23);
        assert!(
            result
                .model_path
                .ends_with("models\\speech\\ggml-existing.bin")
                || result
                    .model_path
                    .ends_with("models/speech/ggml-existing.bin"),
            "existing model result should point at the managed installed model path: {}",
            result.model_path
        );
        assert_eq!(
            fs::read(&model_path).expect("read verified existing model"),
            b"verified existing model"
        );
    }

    #[test]
    fn speech_model_download_rejects_mismatched_resume_content_range() {
        let error = resolve_autocut_speech_model_download_response_state(
            6,
            StatusCode::PARTIAL_CONTENT,
            Some("bytes 5-10/11"),
            Some(6),
        )
        .expect_err("resume response must start exactly at the existing partial byte size");

        assert!(
            error.contains("expected 6"),
            "mismatched resume Content-Range should explain the expected start byte: {error}"
        );
    }

    #[test]
    fn speech_model_download_rejects_malformed_content_range() {
        let error = parse_autocut_http_content_range("items 0-10/11")
            .expect_err("model download Content-Range must use bytes units");

        assert!(
            error.contains("bytes units"),
            "malformed Content-Range should explain the accepted units: {error}"
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
            sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2".to_string(),
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
            sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2".to_string(),
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
        assert_eq!(
            expected_sha256,
            calculate_file_sha256(&model_path).expect("hash replacement")
        );
    }

    #[test]
    fn speech_transcription_probe_validates_model_path_without_fake_readiness() {
        let probe = probe_autocut_speech_transcription_for_request(
            AutoCutSpeechTranscriptionProbeRequest {
                provider_id: Some("local-whisper-cli".to_string()),
                executable_path: Some("whisper-cli".to_string()),
                model_path: Some("Z:/missing/ggml-large-v3-turbo.bin".to_string()),
                source_kind: Some("settings".to_string()),
                output_root_dir: None,
            },
        );

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
            assert!(
                media_mime_type(extension, "video").starts_with("video/"),
                "video chooser extension {extension} must expose a video MIME type"
            );
            assert_eq!(
                resolve_media_type_from_stream_evidence(
                    extension,
                    AutoCutMediaStreamEvidence {
                        has_audio_stream: false,
                        has_video_stream: true,
                    },
                ),
                "video",
                "video chooser extension {extension} must only become video after stream evidence confirms video"
            );
        }
    }

    #[test]
    fn local_media_file_dialog_audio_extensions_match_media_classification() {
        for extension in SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS {
            assert!(
                media_mime_type(extension, "audio").starts_with("audio/"),
                "audio chooser extension {extension} must expose an audio MIME type"
            );
            assert_eq!(
                resolve_media_type_from_stream_evidence(
                    extension,
                    AutoCutMediaStreamEvidence {
                        has_audio_stream: true,
                        has_video_stream: false,
                    },
                ),
                "audio",
                "audio chooser extension {extension} must only become audio after stream evidence confirms audio"
            );
        }
    }

    #[test]
    fn local_media_chooser_matches_requested_types_against_stream_evidence() {
        let video_description = AutoCutLocalMediaFileDescription {
            source_path: "D:/media/mislabeled.mp4".to_string(),
            byte_size: 100,
            name: "mislabeled.mp4".to_string(),
            media_type: "video".to_string(),
            mime_type: "video/mp4".to_string(),
            has_audio_stream: false,
            has_video_stream: false,
            duration_ms: None,
        };
        assert!(
            !requested_autocut_media_streams_match_description(
                &["video".to_string()],
                &video_description
            ),
            "trusted chooser must reject video-labeled descriptions without video-stream evidence"
        );

        let audio_bearing_description = AutoCutLocalMediaFileDescription {
            source_path: "D:/media/voice.mp4".to_string(),
            byte_size: 100,
            name: "voice.mp4".to_string(),
            media_type: "audio".to_string(),
            mime_type: "audio/mp4".to_string(),
            has_audio_stream: true,
            has_video_stream: false,
            duration_ms: None,
        };
        assert!(
            requested_autocut_media_streams_match_description(
                &["audio".to_string(), "video".to_string()],
                &audio_bearing_description
            ),
            "trusted chooser must accept any requested audio-bearing container by audio-stream evidence"
        );
        assert!(
            !requested_autocut_media_streams_match_description(
                &["video".to_string()],
                &audio_bearing_description
            ),
            "trusted chooser must not accept audio-only media for video-stream workflows"
        );
    }

    #[test]
    fn local_media_file_dialog_includes_all_files_for_probe_validated_unknown_extensions() {
        assert_eq!(
            AUTOCUT_ALL_FILES_DIALOG_EXTENSIONS,
            &["*"],
            "media chooser must expose all files so unknown-extension audio/video can reach FFmpeg stream probing"
        );
    }

    #[test]
    fn local_media_file_import_classifies_unknown_extensions_from_real_media_streams() {
        let root = unique_temp_dir("sdkwork-autocut-unknown-extension-import-root");
        let source_root = unique_temp_dir("sdkwork-autocut-unknown-extension-source");
        let video_source_path = source_root.join("camera-export.media");
        let video_fixture_path = source_root.join("camera-export.mp4");
        run_ffmpeg_test_video(&test_system_ffmpeg_toolchain(), &video_fixture_path)
            .expect("create unknown-extension video fixture");
        fs::rename(&video_fixture_path, &video_source_path)
            .expect("rename video fixture to unknown extension");
        let audio_source_path = source_root.join("voice-note.audiofile");
        let audio_fixture_path = source_root.join("voice-note.wav");
        run_ffmpeg_test_audio(&test_system_ffmpeg_toolchain(), &audio_fixture_path)
            .expect("create unknown-extension audio fixture");
        fs::rename(&audio_fixture_path, &audio_source_path)
            .expect("rename audio fixture to unknown extension");
        let connection = prepared_connection();

        let imported_video = import_autocut_media_file_in_root(
            &connection,
            &root,
            AutoCutMediaImportRequest {
                source_path: video_source_path.display().to_string(),
                output_root_dir: None,
            },
            &test_system_ffmpeg_toolchain(),
        )
        .expect("import unknown-extension video");
        let audio_description = describe_autocut_local_media_file_from_path(
            &audio_source_path,
            Some(&test_system_ffmpeg_toolchain()),
        )
        .expect("describe unknown-extension audio");

        assert_eq!(
            imported_video.media_type, "video",
            "unknown extensions should be classified as video when FFmpeg detects a video stream"
        );
        assert!(
            imported_video.has_video_stream,
            "unknown-extension imported video should report verified video stream evidence"
        );
        assert!(
            !imported_video.has_audio_stream,
            "unknown-extension video-only fixture should not claim an audio stream"
        );
        assert_eq!(
            audio_description.media_type, "audio",
            "unknown extensions should be classified as audio when FFmpeg detects an audio stream"
        );
        assert!(
            audio_description.has_audio_stream,
            "unknown-extension described audio should report verified audio stream evidence"
        );
        assert!(
            !audio_description.has_video_stream,
            "unknown-extension described audio should not claim a video stream"
        );
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
