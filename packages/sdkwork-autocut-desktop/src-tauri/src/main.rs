#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database_contract;
mod database_runtime;
mod host_contract;
mod llm_http_runtime;
mod llm_secret_runtime;
mod media_runtime;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::autocut_host_capabilities,
            commands::autocut_database_health,
            commands::autocut_ffmpeg_probe,
            commands::autocut_import_media_file,
            commands::autocut_describe_local_media_file,
            commands::autocut_select_local_video_file,
            commands::autocut_select_local_directory,
            commands::autocut_select_speech_transcription_file,
            commands::autocut_probe_speech_transcription,
            commands::autocut_list_native_tasks,
            commands::autocut_cancel_native_task,
            commands::autocut_recover_native_tasks,
            commands::autocut_retry_native_task,
            commands::autocut_extract_audio,
            commands::autocut_generate_gif,
            commands::autocut_slice_video,
            commands::autocut_transcribe_media,
            commands::autocut_compress_video,
            commands::autocut_convert_video,
            commands::autocut_enhance_video,
            commands::autocut_audio_smoke,
            commands::autocut_llm_http_request,
            commands::autocut_save_llm_secret,
            commands::autocut_get_llm_secret,
            commands::autocut_delete_llm_secret
        ])
        .run(tauri::generate_context!())
        .expect("error while running sdkwork video cut desktop shell");
}
