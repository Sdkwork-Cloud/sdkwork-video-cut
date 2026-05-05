use crate::database_runtime::{self, AutoCutDatabaseHealth};
use crate::host_contract::{self, AutoCutHostCapabilities};
use crate::llm_http_runtime::{
    self, AutoCutLlmHttpRequest, AutoCutLlmHttpResponse,
};
use crate::llm_secret_runtime::{
    self, AutoCutDeleteLlmSecretResult, AutoCutGetLlmSecretResult, AutoCutLlmSecretRequest,
    AutoCutSaveLlmSecretRequest, AutoCutSaveLlmSecretResult,
};
use crate::media_runtime::{
    self, AutoCutAudioExtractionRequest, AutoCutAudioExtractionResult, AutoCutFfmpegProbe,
    AutoCutLocalMediaFileDescription, AutoCutMediaImportRequest, AutoCutMediaImportResult,
    AutoCutNativeTaskCancelRequest, AutoCutNativeTaskCancelResult, AutoCutNativeTaskQueryRequest,
    AutoCutNativeTaskRecoveryRequest, AutoCutNativeTaskRecoveryResult,
    AutoCutNativeTaskRetryRequest, AutoCutNativeTaskRetryResult, AutoCutNativeTaskSnapshot,
    AutoCutVideoCompressRequest, AutoCutVideoCompressResult, AutoCutVideoConvertRequest,
    AutoCutVideoConvertResult, AutoCutVideoEnhanceRequest, AutoCutVideoEnhanceResult,
    AutoCutVideoGifRequest, AutoCutVideoGifResult, AutoCutVideoSliceRequest,
    AutoCutVideoSliceResult, AutoCutSpeechTranscriptionFileSelectRequest,
    AutoCutSpeechTranscriptionProbe, AutoCutSpeechTranscriptionProbeRequest,
    AutoCutSpeechTranscriptionRequest, AutoCutSpeechTranscriptionResult,
};
use tauri::AppHandle;

#[tauri::command]
pub fn autocut_host_capabilities() -> AutoCutHostCapabilities {
    host_contract::autocut_host_capabilities()
}

#[tauri::command]
pub fn autocut_database_health(app: AppHandle) -> Result<AutoCutDatabaseHealth, String> {
    database_runtime::run_autocut_database_migrations(&app)
}

#[tauri::command]
pub fn autocut_ffmpeg_probe(app: AppHandle) -> AutoCutFfmpegProbe {
    media_runtime::probe_autocut_ffmpeg(&app)
}

#[tauri::command]
pub fn autocut_import_media_file(
    app: AppHandle,
    request: AutoCutMediaImportRequest,
) -> Result<AutoCutMediaImportResult, String> {
    media_runtime::import_autocut_media_file(&app, request)
}

#[tauri::command]
pub fn autocut_describe_local_media_file(
    request: AutoCutMediaImportRequest,
) -> Result<AutoCutLocalMediaFileDescription, String> {
    media_runtime::describe_autocut_local_media_file(request)
}

#[tauri::command]
pub fn autocut_select_local_video_file() -> Result<Option<AutoCutLocalMediaFileDescription>, String> {
    media_runtime::select_autocut_local_video_file()
}

#[tauri::command]
pub fn autocut_select_local_directory() -> Result<Option<String>, String> {
    media_runtime::select_autocut_local_directory()
}

#[tauri::command]
pub fn autocut_select_speech_transcription_file(
    request: AutoCutSpeechTranscriptionFileSelectRequest,
) -> Result<Option<String>, String> {
    media_runtime::select_autocut_speech_transcription_file(request)
}

#[tauri::command]
pub fn autocut_probe_speech_transcription(
    request: AutoCutSpeechTranscriptionProbeRequest,
) -> AutoCutSpeechTranscriptionProbe {
    media_runtime::probe_autocut_speech_transcription(request)
}

#[tauri::command]
pub fn autocut_list_native_tasks(
    app: AppHandle,
    request: AutoCutNativeTaskQueryRequest,
) -> Result<Vec<AutoCutNativeTaskSnapshot>, String> {
    media_runtime::list_autocut_native_tasks(&app, request)
}

#[tauri::command]
pub fn autocut_cancel_native_task(
    app: AppHandle,
    request: AutoCutNativeTaskCancelRequest,
) -> Result<AutoCutNativeTaskCancelResult, String> {
    media_runtime::cancel_autocut_native_task(&app, request)
}

#[tauri::command]
pub fn autocut_recover_native_tasks(
    app: AppHandle,
    request: AutoCutNativeTaskRecoveryRequest,
) -> Result<AutoCutNativeTaskRecoveryResult, String> {
    media_runtime::recover_autocut_native_tasks(&app, request)
}

#[tauri::command]
pub fn autocut_retry_native_task(
    app: AppHandle,
    request: AutoCutNativeTaskRetryRequest,
) -> Result<AutoCutNativeTaskRetryResult, String> {
    media_runtime::retry_autocut_native_task(&app, request)
}

#[tauri::command]
pub fn autocut_extract_audio(
    app: AppHandle,
    request: AutoCutAudioExtractionRequest,
) -> Result<AutoCutAudioExtractionResult, String> {
    media_runtime::extract_autocut_audio_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_generate_gif(
    app: AppHandle,
    request: AutoCutVideoGifRequest,
) -> Result<AutoCutVideoGifResult, String> {
    media_runtime::generate_autocut_gif_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_slice_video(
    app: AppHandle,
    request: AutoCutVideoSliceRequest,
) -> Result<AutoCutVideoSliceResult, String> {
    media_runtime::slice_autocut_video_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_transcribe_media(
    app: AppHandle,
    request: AutoCutSpeechTranscriptionRequest,
) -> Result<AutoCutSpeechTranscriptionResult, String> {
    media_runtime::transcribe_autocut_media_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_compress_video(
    app: AppHandle,
    request: AutoCutVideoCompressRequest,
) -> Result<AutoCutVideoCompressResult, String> {
    media_runtime::compress_autocut_video_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_convert_video(
    app: AppHandle,
    request: AutoCutVideoConvertRequest,
) -> Result<AutoCutVideoConvertResult, String> {
    media_runtime::convert_autocut_video_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_enhance_video(
    app: AppHandle,
    request: AutoCutVideoEnhanceRequest,
) -> Result<AutoCutVideoEnhanceResult, String> {
    media_runtime::enhance_autocut_video_from_asset(&app, request)
}

#[tauri::command]
pub fn autocut_audio_smoke(app: AppHandle) -> Result<AutoCutAudioExtractionResult, String> {
    media_runtime::run_autocut_audio_smoke(&app)
}

#[tauri::command]
pub fn autocut_llm_http_request(
    request: AutoCutLlmHttpRequest,
) -> Result<AutoCutLlmHttpResponse, String> {
    llm_http_runtime::send_autocut_llm_http_request(request)
}

#[tauri::command]
pub fn autocut_save_llm_secret(
    request: AutoCutSaveLlmSecretRequest,
) -> Result<AutoCutSaveLlmSecretResult, String> {
    llm_secret_runtime::save_autocut_llm_secret(request)
}

#[tauri::command]
pub fn autocut_get_llm_secret(
    request: AutoCutLlmSecretRequest,
) -> Result<AutoCutGetLlmSecretResult, String> {
    llm_secret_runtime::get_autocut_llm_secret(request)
}

#[tauri::command]
pub fn autocut_delete_llm_secret(
    request: AutoCutLlmSecretRequest,
) -> Result<AutoCutDeleteLlmSecretResult, String> {
    llm_secret_runtime::delete_autocut_llm_secret(request)
}
