use crate::database_runtime::{self, AutoCutDatabaseHealth};
use crate::host_contract::{self, AutoCutHostCapabilities};
use crate::llm_http_runtime::{self, AutoCutLlmHttpRequest, AutoCutLlmHttpResponse};
use crate::llm_secret_runtime::{
    self, AutoCutDeleteLlmSecretResult, AutoCutGetLlmSecretResult, AutoCutLlmSecretRequest,
    AutoCutSaveLlmSecretRequest, AutoCutSaveLlmSecretResult,
};
use crate::media_runtime::{
    self, AutoCutAudioExtractionRequest, AutoCutAudioExtractionResult, AutoCutFfmpegProbe,
    AutoCutLocalMediaFileDescription, AutoCutLocalMediaFileSelectRequest,
    AutoCutLocalMediaPreviewDirectoryRequest, AutoCutLocalMediaPreviewDirectoryResult,
    AutoCutMediaImportRequest, AutoCutMediaImportResult, AutoCutNativeArtifactInFolderRequest,
    AutoCutNativeArtifactInFolderResult, AutoCutNativeTaskCancelRequest,
    AutoCutNativeTaskCancelResult, AutoCutNativeTaskQueryRequest, AutoCutNativeTaskRecoveryRequest,
    AutoCutNativeTaskRecoveryResult, AutoCutNativeTaskRetryRequest, AutoCutNativeTaskRetryResult,
    AutoCutNativeTaskSnapshot, AutoCutSpeechTranscriptionFileSelectRequest,
    AutoCutSpeechTranscriptionModelDownloadRequest, AutoCutSpeechTranscriptionModelDownloadResult,
    AutoCutSpeechTranscriptionProbe, AutoCutSpeechTranscriptionProbeRequest,
    AutoCutSpeechTranscriptionRequest, AutoCutSpeechTranscriptionResult,
    AutoCutVideoCompressRequest, AutoCutVideoCompressResult, AutoCutVideoConvertRequest,
    AutoCutVideoConvertResult, AutoCutVideoEnhanceRequest, AutoCutVideoEnhanceResult,
    AutoCutVideoGifRequest, AutoCutVideoGifResult, AutoCutVideoSliceRequest,
    AutoCutVideoSliceResult,
};
use tauri::AppHandle;

async fn run_autocut_blocking_native_command<TResult, TWork>(
    command_name: &'static str,
    work: TWork,
) -> Result<TResult, String>
where
    TResult: Send + 'static,
    TWork: FnOnce() -> Result<TResult, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("AutoCut native command {command_name} worker failed: {error}"))?
}

#[tauri::command]
pub fn autocut_host_capabilities(app: AppHandle) -> AutoCutHostCapabilities {
    host_contract::autocut_host_capabilities(Some(&app))
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
pub async fn autocut_import_media_file(
    app: AppHandle,
    request: AutoCutMediaImportRequest,
) -> Result<AutoCutMediaImportResult, String> {
    run_autocut_blocking_native_command("autocut_import_media_file", move || {
        media_runtime::import_autocut_media_file(&app, request)
    })
    .await
}

#[tauri::command]
pub fn autocut_describe_local_media_file(
    app: AppHandle,
    request: AutoCutMediaImportRequest,
) -> Result<AutoCutLocalMediaFileDescription, String> {
    media_runtime::describe_autocut_local_media_file(&app, request)
}

#[tauri::command]
pub fn autocut_select_local_media_file(
    app: AppHandle,
    request: AutoCutLocalMediaFileSelectRequest,
) -> Result<Option<AutoCutLocalMediaFileDescription>, String> {
    media_runtime::select_autocut_local_media_file(&app, request)
}

#[tauri::command]
pub fn autocut_select_local_video_file(
    app: AppHandle,
) -> Result<Option<AutoCutLocalMediaFileDescription>, String> {
    media_runtime::select_autocut_local_video_file(&app)
}

#[tauri::command]
pub fn autocut_select_local_directory(app: AppHandle) -> Result<Option<String>, String> {
    media_runtime::select_autocut_local_directory(&app)
}

#[tauri::command]
pub fn autocut_allow_local_media_preview_directory(
    app: AppHandle,
    request: AutoCutLocalMediaPreviewDirectoryRequest,
) -> Result<AutoCutLocalMediaPreviewDirectoryResult, String> {
    media_runtime::allow_autocut_local_media_preview_directory(&app, request)
}

#[tauri::command]
pub fn autocut_open_artifact_in_folder(
    request: AutoCutNativeArtifactInFolderRequest,
) -> Result<AutoCutNativeArtifactInFolderResult, String> {
    media_runtime::open_autocut_artifact_in_folder(request)
}

#[tauri::command]
pub fn autocut_select_speech_transcription_file(
    request: AutoCutSpeechTranscriptionFileSelectRequest,
) -> Result<Option<String>, String> {
    media_runtime::select_autocut_speech_transcription_file(request)
}

#[tauri::command]
pub fn autocut_download_speech_transcription_model(
    app: AppHandle,
    request: AutoCutSpeechTranscriptionModelDownloadRequest,
) -> Result<AutoCutSpeechTranscriptionModelDownloadResult, String> {
    media_runtime::download_autocut_speech_transcription_model(&app, request)
}

#[tauri::command]
pub fn autocut_probe_speech_transcription(
    app: AppHandle,
    request: AutoCutSpeechTranscriptionProbeRequest,
) -> AutoCutSpeechTranscriptionProbe {
    media_runtime::probe_autocut_speech_transcription(&app, request)
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
pub async fn autocut_slice_video(
    app: AppHandle,
    request: AutoCutVideoSliceRequest,
) -> Result<AutoCutVideoSliceResult, String> {
    run_autocut_blocking_native_command("autocut_slice_video", move || {
        media_runtime::slice_autocut_video_from_asset(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_transcribe_media(
    app: AppHandle,
    request: AutoCutSpeechTranscriptionRequest,
) -> Result<AutoCutSpeechTranscriptionResult, String> {
    run_autocut_blocking_native_command("autocut_transcribe_media", move || {
        media_runtime::transcribe_autocut_media_from_asset(&app, request)
    })
    .await
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
