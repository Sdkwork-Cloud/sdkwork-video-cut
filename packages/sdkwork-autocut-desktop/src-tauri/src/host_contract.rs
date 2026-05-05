use std::path::Path;

use serde::Serialize;

use crate::database_contract::{AutoCutDatabaseContract, autocut_database_contract};

pub const AUTOCUT_HOST_CONTRACT_VERSION: &str = "2026-05-05.native-host-contract.v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutHostCapabilities {
    pub contract_version: &'static str,
    pub host_kind: &'static str,
    #[serde(rename = "databaseContractReady")]
    pub database_contract_ready: bool,
    #[serde(rename = "sqliteMigrationReady")]
    pub sqlite_migration_ready: bool,
    #[serde(rename = "databaseHealthCommandReady")]
    pub database_health_command_ready: bool,
    #[serde(rename = "ffmpegProbeCommandReady")]
    pub ffmpeg_probe_command_ready: bool,
    #[serde(rename = "mediaImportCommandReady")]
    pub media_import_command_ready: bool,
    #[serde(rename = "mediaFileDescribeCommandReady")]
    pub media_file_describe_command_ready: bool,
    #[serde(rename = "localVideoFileSelectCommandReady")]
    pub local_video_file_select_command_ready: bool,
    #[serde(rename = "localDirectorySelectCommandReady")]
    pub local_directory_select_command_ready: bool,
    #[serde(rename = "nativeTaskQueryCommandReady")]
    pub native_task_query_command_ready: bool,
    #[serde(rename = "nativeTaskCancelCommandReady")]
    pub native_task_cancel_command_ready: bool,
    #[serde(rename = "nativeTaskRecoveryCommandReady")]
    pub native_task_recovery_command_ready: bool,
    #[serde(rename = "nativeTaskRetryCommandReady")]
    pub native_task_retry_command_ready: bool,
    #[serde(rename = "nativeTaskProgressEventsReady")]
    pub native_task_progress_events_ready: bool,
    #[serde(rename = "nativeWorkerLeaseReady")]
    pub native_worker_lease_ready: bool,
    #[serde(rename = "audioExtractionCommandReady")]
    pub audio_extraction_command_ready: bool,
    #[serde(rename = "audioExtractionFromAssetReady")]
    pub audio_extraction_from_asset_ready: bool,
    #[serde(rename = "videoGifCommandReady")]
    pub video_gif_command_ready: bool,
    #[serde(rename = "videoSliceCommandReady")]
    pub video_slice_command_ready: bool,
    #[serde(rename = "videoCompressCommandReady")]
    pub video_compress_command_ready: bool,
    #[serde(rename = "videoConvertCommandReady")]
    pub video_convert_command_ready: bool,
    #[serde(rename = "videoEnhanceCommandReady")]
    pub video_enhance_command_ready: bool,
    #[serde(rename = "speechTranscriptionCommandReady")]
    pub speech_transcription_command_ready: bool,
    #[serde(rename = "speechTranscriptionToolchainReady")]
    pub speech_transcription_toolchain_ready: bool,
    #[serde(rename = "speechTranscriptionProbeCommandReady")]
    pub speech_transcription_probe_command_ready: bool,
    #[serde(rename = "speechTranscriptionFileSelectCommandReady")]
    pub speech_transcription_file_select_command_ready: bool,
    #[serde(rename = "llmHttpCommandReady")]
    pub llm_http_command_ready: bool,
    #[serde(rename = "llmSecretStoreReady")]
    pub llm_secret_store_ready: bool,
    #[serde(rename = "ffmpegToolchainManifestReady")]
    pub ffmpeg_toolchain_manifest_ready: bool,
    #[serde(rename = "ffmpegToolchainResolverReady")]
    pub ffmpeg_toolchain_resolver_ready: bool,
    #[serde(rename = "ffmpegBundledReady")]
    pub ffmpeg_bundled_ready: bool,
    #[serde(rename = "ffmpegExecutionReady")]
    pub ffmpeg_execution_ready: bool,
    pub supported_commands: &'static [&'static str],
    pub database: &'static AutoCutDatabaseContract,
}

pub fn autocut_host_capabilities() -> AutoCutHostCapabilities {
    let speech_transcription_toolchain_ready = autocut_speech_transcription_toolchain_ready();

    AutoCutHostCapabilities {
        contract_version: AUTOCUT_HOST_CONTRACT_VERSION,
        host_kind: "native-host",
        database_contract_ready: true,
        sqlite_migration_ready: true,
        database_health_command_ready: true,
        ffmpeg_probe_command_ready: true,
        media_import_command_ready: true,
        media_file_describe_command_ready: true,
        local_video_file_select_command_ready: true,
        local_directory_select_command_ready: true,
        native_task_query_command_ready: true,
        native_task_cancel_command_ready: true,
        native_task_recovery_command_ready: true,
        native_task_retry_command_ready: true,
        native_task_progress_events_ready: true,
        native_worker_lease_ready: true,
        audio_extraction_command_ready: true,
        audio_extraction_from_asset_ready: true,
        video_gif_command_ready: true,
        video_slice_command_ready: true,
        video_compress_command_ready: true,
        video_convert_command_ready: true,
        video_enhance_command_ready: true,
        speech_transcription_command_ready: true,
        speech_transcription_toolchain_ready,
        speech_transcription_probe_command_ready: true,
        speech_transcription_file_select_command_ready: true,
        llm_http_command_ready: true,
        llm_secret_store_ready: true,
        ffmpeg_toolchain_manifest_ready: true,
        ffmpeg_toolchain_resolver_ready: true,
        ffmpeg_bundled_ready: false,
        ffmpeg_execution_ready: false,
        supported_commands: &[
            "autocut_host_capabilities",
            "autocut_database_health",
            "autocut_ffmpeg_probe",
            "autocut_import_media_file",
            "autocut_describe_local_media_file",
            "autocut_select_local_video_file",
            "autocut_select_local_directory",
            "autocut_list_native_tasks",
            "autocut_cancel_native_task",
            "autocut_recover_native_tasks",
            "autocut_retry_native_task",
            "autocut_extract_audio",
            "autocut_generate_gif",
            "autocut_slice_video",
            "autocut_transcribe_media",
            "autocut_probe_speech_transcription",
            "autocut_select_speech_transcription_file",
            "autocut_compress_video",
            "autocut_convert_video",
            "autocut_enhance_video",
            "autocut_audio_smoke",
            "autocut_llm_http_request",
            "autocut_save_llm_secret",
            "autocut_get_llm_secret",
            "autocut_delete_llm_secret",
        ],
        database: autocut_database_contract(),
    }
}

fn autocut_speech_transcription_toolchain_ready() -> bool {
    let executable_ready = std::env::var("SDKWORK_AUTOCUT_WHISPER_EXECUTABLE")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let model_ready = std::env::var("SDKWORK_AUTOCUT_WHISPER_MODEL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| Path::new(&value).is_file())
        .unwrap_or(false);

    executable_ready && model_ready
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_report_ffmpeg_toolchain_contract_without_claiming_execution() {
        let capabilities = autocut_host_capabilities();

        assert!(capabilities.ffmpeg_toolchain_manifest_ready);
        assert!(capabilities.ffmpeg_toolchain_resolver_ready);
        assert!(capabilities.media_file_describe_command_ready);
        assert!(capabilities.local_video_file_select_command_ready);
        assert!(capabilities.local_directory_select_command_ready);
        assert!(capabilities.native_task_query_command_ready);
        assert!(capabilities.native_task_cancel_command_ready);
        assert!(capabilities.native_task_recovery_command_ready);
        assert!(capabilities.native_task_retry_command_ready);
        assert!(capabilities.native_task_progress_events_ready);
        assert!(capabilities.native_worker_lease_ready);
        assert!(capabilities.video_gif_command_ready);
        assert!(capabilities.video_slice_command_ready);
        assert!(capabilities.video_compress_command_ready);
        assert!(capabilities.video_convert_command_ready);
        assert!(capabilities.video_enhance_command_ready);
        assert!(capabilities.speech_transcription_command_ready);
        assert!(capabilities.speech_transcription_probe_command_ready);
        assert!(capabilities.speech_transcription_file_select_command_ready);
        assert_eq!(
            capabilities.speech_transcription_toolchain_ready,
            autocut_speech_transcription_toolchain_ready()
        );
        assert!(capabilities.llm_http_command_ready);
        assert!(capabilities.llm_secret_store_ready);
        assert!(!capabilities.ffmpeg_bundled_ready);
        assert!(!capabilities.ffmpeg_execution_ready);
    }
}
