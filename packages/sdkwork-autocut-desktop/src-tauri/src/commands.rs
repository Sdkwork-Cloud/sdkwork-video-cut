use crate::database_runtime::{self, AutoCutDatabaseHealth};
use crate::host_contract::{self, AutoCutHostCapabilities};
use crate::llm_http_runtime::{self, AutoCutLlmHttpRequest, AutoCutLlmHttpResponse};
use crate::llm_secret_runtime::{
    self, AutoCutDeleteLlmSecretResult, AutoCutGetLlmSecretResult, AutoCutLlmSecretRequest,
    AutoCutSaveLlmSecretRequest, AutoCutSaveLlmSecretResult,
};
use crate::media_runtime::{
    self, AutoCutAudioExtractionRequest, AutoCutAudioExtractionResult,
    AutoCutAudioFingerprintRequest, AutoCutAudioFingerprintResult, AutoCutFfmpegProbe,
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
    AutoCutTaskEvidenceWriteRequest, AutoCutTaskEvidenceWriteResult, AutoCutVideoCompressRequest,
    AutoCutVideoCompressResult, AutoCutVideoConvertRequest, AutoCutVideoConvertResult,
    AutoCutVideoEnhanceRequest, AutoCutVideoEnhanceResult, AutoCutVideoFileFingerprintRequest,
    AutoCutVideoFileFingerprintResult, AutoCutVideoFileIdentityResult, AutoCutVideoGifRequest,
    AutoCutVideoGifResult, AutoCutVideoSliceAudioActivityAnalysisRequest,
    AutoCutVideoSliceAudioActivityAnalysisResult, AutoCutVideoSliceRequest,
    AutoCutVideoSliceResult, AutoCutVisualEvidenceExtractionRequest,
    AutoCutVisualEvidenceExtractionResult,
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

fn failed_autocut_speech_transcription_probe(error: String) -> AutoCutSpeechTranscriptionProbe {
    AutoCutSpeechTranscriptionProbe {
        ready: false,
        executable_ready: false,
        model_ready: false,
        gpu_ready: false,
        gpu_backend: None,
        gpu_diagnostics: Vec::new(),
        executable_path: String::new(),
        model_path: String::new(),
        source_kind: "worker-error".to_string(),
        diagnostics: vec![error],
        version_line: None,
        default_executable_directory: String::new(),
        default_executable_path: String::new(),
        default_model_directory: String::new(),
        default_model_path: String::new(),
        executable_strategy:
            "Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli"
                .to_string(),
    }
}

fn failed_autocut_ffmpeg_probe(error: String) -> AutoCutFfmpegProbe {
    AutoCutFfmpegProbe {
        available: false,
        executable: String::new(),
        source_kind: "worker-error".to_string(),
        manifest_ready: false,
        bundled_ready: false,
        version_line: None,
        diagnostics: vec![error],
    }
}

#[tauri::command]
pub async fn autocut_host_capabilities(app: AppHandle) -> Result<AutoCutHostCapabilities, String> {
    run_autocut_blocking_native_command("autocut_host_capabilities", move || {
        Ok(host_contract::autocut_host_capabilities(Some(&app)))
    })
    .await
}

#[tauri::command]
pub fn autocut_database_health(app: AppHandle) -> Result<AutoCutDatabaseHealth, String> {
    database_runtime::run_autocut_database_migrations(&app)
}

#[tauri::command]
pub async fn autocut_ffmpeg_probe(app: AppHandle) -> AutoCutFfmpegProbe {
    run_autocut_blocking_native_command("autocut_ffmpeg_probe", move || {
        Ok(media_runtime::probe_autocut_ffmpeg(&app))
    })
    .await
    .unwrap_or_else(failed_autocut_ffmpeg_probe)
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
pub async fn autocut_fingerprint_video_file(
    app: AppHandle,
    request: AutoCutVideoFileFingerprintRequest,
) -> Result<AutoCutVideoFileFingerprintResult, String> {
    run_autocut_blocking_native_command("autocut_fingerprint_video_file", move || {
        media_runtime::fingerprint_autocut_video_file(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_probe_video_file_identity(
    app: AppHandle,
    request: AutoCutVideoFileFingerprintRequest,
) -> Result<AutoCutVideoFileIdentityResult, String> {
    run_autocut_blocking_native_command("autocut_probe_video_file_identity", move || {
        media_runtime::probe_autocut_video_file_identity(&app, request)
    })
    .await
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
pub async fn autocut_download_speech_transcription_model(
    app: AppHandle,
    request: AutoCutSpeechTranscriptionModelDownloadRequest,
) -> Result<AutoCutSpeechTranscriptionModelDownloadResult, String> {
    run_autocut_blocking_native_command("autocut_download_speech_transcription_model", move || {
        media_runtime::download_autocut_speech_transcription_model(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_probe_speech_transcription(
    app: AppHandle,
    request: AutoCutSpeechTranscriptionProbeRequest,
) -> AutoCutSpeechTranscriptionProbe {
    run_autocut_blocking_native_command("autocut_probe_speech_transcription", move || {
        Ok(media_runtime::probe_autocut_speech_transcription(
            &app, request,
        ))
    })
    .await
    .unwrap_or_else(failed_autocut_speech_transcription_probe)
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
pub async fn autocut_extract_audio(
    app: AppHandle,
    request: AutoCutAudioExtractionRequest,
) -> Result<AutoCutAudioExtractionResult, String> {
    run_autocut_blocking_native_command("autocut_extract_audio", move || {
        media_runtime::extract_autocut_audio_from_asset(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_extract_audio_fingerprint(
    app: AppHandle,
    request: AutoCutAudioFingerprintRequest,
) -> Result<AutoCutAudioFingerprintResult, String> {
    run_autocut_blocking_native_command("autocut_extract_audio_fingerprint", move || {
        media_runtime::extract_autocut_audio_fingerprint(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_generate_gif(
    app: AppHandle,
    request: AutoCutVideoGifRequest,
) -> Result<AutoCutVideoGifResult, String> {
    run_autocut_blocking_native_command("autocut_generate_gif", move || {
        media_runtime::generate_autocut_gif_from_asset(&app, request)
    })
    .await
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
pub async fn autocut_analyze_video_slice_audio_activity(
    app: AppHandle,
    request: AutoCutVideoSliceAudioActivityAnalysisRequest,
) -> Result<AutoCutVideoSliceAudioActivityAnalysisResult, String> {
    run_autocut_blocking_native_command("autocut_analyze_video_slice_audio_activity", move || {
        media_runtime::analyze_autocut_video_slice_audio_activity(&app, request)
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
pub async fn autocut_extract_visual_evidence(
    app: AppHandle,
    request: AutoCutVisualEvidenceExtractionRequest,
) -> Result<AutoCutVisualEvidenceExtractionResult, String> {
    run_autocut_blocking_native_command("autocut_extract_visual_evidence", move || {
        media_runtime::extract_autocut_visual_evidence(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_write_task_evidence_json(
    app: AppHandle,
    request: AutoCutTaskEvidenceWriteRequest,
) -> Result<AutoCutTaskEvidenceWriteResult, String> {
    run_autocut_blocking_native_command("autocut_write_task_evidence_json", move || {
        media_runtime::write_autocut_task_evidence_json(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_compress_video(
    app: AppHandle,
    request: AutoCutVideoCompressRequest,
) -> Result<AutoCutVideoCompressResult, String> {
    run_autocut_blocking_native_command("autocut_compress_video", move || {
        media_runtime::compress_autocut_video_from_asset(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_convert_video(
    app: AppHandle,
    request: AutoCutVideoConvertRequest,
) -> Result<AutoCutVideoConvertResult, String> {
    run_autocut_blocking_native_command("autocut_convert_video", move || {
        media_runtime::convert_autocut_video_from_asset(&app, request)
    })
    .await
}

#[tauri::command]
pub async fn autocut_enhance_video(
    app: AppHandle,
    request: AutoCutVideoEnhanceRequest,
) -> Result<AutoCutVideoEnhanceResult, String> {
    run_autocut_blocking_native_command("autocut_enhance_video", move || {
        media_runtime::enhance_autocut_video_from_asset(&app, request)
    })
    .await
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
