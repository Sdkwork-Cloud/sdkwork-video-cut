use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub(crate) struct ApiEnvelope<T>
where
    T: Serialize,
{
    pub(crate) ok: bool,
    pub(crate) data: T,
}

#[derive(Serialize)]
pub(crate) struct ApiErrorEnvelope {
    pub(crate) ok: bool,
    pub(crate) error: ApiError,
}

#[derive(Serialize)]
pub(crate) struct ApiError {
    pub(crate) code: String,
    pub(crate) message: String,
    #[serde(rename = "traceId")]
    pub(crate) trace_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateTaskInput {
    pub(crate) title: String,
    #[serde(rename = "type")]
    pub(crate) task_type: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachTaskSourceInput {
    pub(crate) source_name: String,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) content_type: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualTranscriptInput {
    pub(crate) language: Option<String>,
    pub(crate) text: Option<String>,
    pub(crate) segments: Vec<ManualTranscriptSegment>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualTranscriptSegment {
    pub(crate) start_ms: u64,
    pub(crate) end_ms: u64,
    pub(crate) text: String,
    pub(crate) speaker_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleImportInput {
    pub(crate) format: String,
    pub(crate) content: String,
    pub(crate) language: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleExportQuery {
    pub(crate) format: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticSupportBundleRequest {
    pub(crate) task_id: Option<String>,
    pub(crate) include_source_media: bool,
    pub(crate) include_transcript: bool,
    pub(crate) consent_accepted: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleExportOutput {
    pub(crate) format: String,
    pub(crate) content: String,
    pub(crate) artifact_id: String,
    pub(crate) path: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoCutTask {
    pub(crate) task_id: String,
    pub(crate) title: String,
    #[serde(rename = "type")]
    pub(crate) task_type: String,
    pub(crate) status: String,
    pub(crate) progress: u8,
    pub(crate) duration_seconds: u32,
    pub(crate) source_name: Option<String>,
    pub(crate) updated_at: String,
    pub(crate) current_stage: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoCutArtifact {
    pub(crate) artifact_id: String,
    pub(crate) task_id: String,
    pub(crate) render_id: Option<String>,
    pub(crate) kind: String,
    pub(crate) path: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactDownloadDescriptor {
    pub(crate) artifact_id: String,
    pub(crate) task_id: String,
    pub(crate) path: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) content_type: String,
    pub(crate) download_mode: String,
    pub(crate) url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteTaskOutput {
    pub(crate) task_id: String,
    pub(crate) deleted: bool,
    pub(crate) artifacts_deleted: usize,
    pub(crate) events_deleted: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoCutProgressEvent {
    pub(crate) event_id: String,
    pub(crate) task_id: String,
    pub(crate) stage: String,
    pub(crate) progress: u8,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) level: Option<String>,
    pub(crate) trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) metadata: Option<VideoCutProgressEventMetadata>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoCutProgressEventMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recovery_hint: Option<TaskRecoveryHint>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskRecoveryHint {
    pub(crate) code: String,
    pub(crate) action: String,
    pub(crate) label: String,
    pub(crate) message: String,
    pub(crate) retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_stage: Option<String>,
}
