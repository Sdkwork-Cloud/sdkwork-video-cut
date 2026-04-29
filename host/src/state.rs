use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::http::StatusCode;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::models::{
    ApiError, ApiErrorEnvelope, TaskRecoveryHint, VideoCutArtifact, VideoCutProgressEvent,
    VideoCutProgressEventMetadata, VideoCutTask,
};
use crate::workspace::FileSystemWorkspace;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) inner: Arc<Mutex<HostState>>,
    workspace: Option<FileSystemWorkspace>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredSourceFile {
    pub(crate) safe_name: String,
    pub(crate) artifact_path: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedSourceFile {
    pub(crate) safe_name: String,
    pub(crate) file_path: PathBuf,
    pub(crate) artifact_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredAnalysisFile {
    pub(crate) artifact_path: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedAudioFile {
    pub(crate) file_path: PathBuf,
    pub(crate) artifact_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedRenderFiles {
    pub(crate) output_file_path: PathBuf,
    pub(crate) subtitle_file_path: PathBuf,
    pub(crate) cover_file_path: PathBuf,
    pub(crate) manifest_file_path: PathBuf,
    pub(crate) log_file_path: PathBuf,
    pub(crate) output_artifact_path: String,
    pub(crate) subtitle_artifact_path: String,
    pub(crate) cover_artifact_path: String,
    pub(crate) manifest_artifact_path: String,
    pub(crate) log_artifact_path: String,
}

#[derive(Default)]
pub(crate) struct HostState {
    pub(crate) settings: Value,
    pub(crate) secrets: HashMap<String, String>,
    pub(crate) tasks: HashMap<String, VideoCutTask>,
    pub(crate) plans: HashMap<String, Value>,
    pub(crate) artifacts: HashMap<String, Vec<VideoCutArtifact>>,
    pub(crate) events: HashMap<String, Vec<VideoCutProgressEvent>>,
}

pub(crate) type HostError = (StatusCode, Json<ApiErrorEnvelope>);

impl AppState {
    pub(crate) fn new(settings: Value) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HostState {
                settings,
                ..HostState::default()
            })),
            workspace: None,
        }
    }

    pub(crate) fn persistent(settings: Value, workspace_root: impl Into<PathBuf>) -> Self {
        Self::persistent_with_secrets(settings, workspace_root, HashMap::new())
    }

    pub(crate) fn persistent_with_secrets(
        settings: Value,
        workspace_root: impl Into<PathBuf>,
        secrets: HashMap<String, String>,
    ) -> Self {
        let workspace = FileSystemWorkspace::new(workspace_root);
        let mut state = workspace
            .load_state(settings)
            .expect("load video cut workspace manifest");
        state.secrets.extend(secrets);

        Self {
            inner: Arc::new(Mutex::new(state)),
            workspace: Some(workspace),
        }
    }

    pub(crate) fn persist_task(&self, state: &HostState, task_id: &str) -> Result<(), HostError> {
        if let Some(workspace) = &self.workspace {
            workspace
                .save_task(state, task_id)
                .map_err(|error| storage_error(error.to_string()))?;
        }

        Ok(())
    }

    pub(crate) fn persist_settings(&self, settings: &Value) -> Result<(), HostError> {
        if let Some(workspace) = &self.workspace {
            workspace
                .save_settings(settings)
                .map_err(|error| storage_error(error.to_string()))?;
        }

        Ok(())
    }

    pub(crate) fn delete_task_manifest(&self, task_id: &str) -> Result<(), HostError> {
        if let Some(workspace) = &self.workspace {
            workspace
                .delete_task(task_id)
                .map_err(|error| storage_error(error.to_string()))?;
        }

        Ok(())
    }

    pub(crate) fn workspace_root(&self, settings: &Value) -> PathBuf {
        if let Some(workspace) = &self.workspace {
            return workspace.root().to_path_buf();
        }

        settings
            .pointer("/storage/workspaceRoot")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("./workspace"))
    }

    pub(crate) fn prepare_task_source_file(
        &self,
        settings: &Value,
        task_id: &str,
        source_name: &str,
    ) -> Result<PreparedSourceFile, HostError> {
        let safe_name = sanitize_source_file_name(source_name);
        let workspace_root = self.workspace_root(settings);
        let source_dir = workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("source");
        fs::create_dir_all(&source_dir).map_err(|error| storage_error(error.to_string()))?;
        let artifact_path =
            format!("workspace/projects/default/tasks/{task_id}/source/{safe_name}");

        Ok(PreparedSourceFile {
            file_path: source_dir.join(&safe_name),
            safe_name,
            artifact_path,
        })
    }

    pub(crate) fn write_task_analysis_json(
        &self,
        settings: &Value,
        task_id: &str,
        file_name: &str,
        document: &Value,
    ) -> Result<StoredAnalysisFile, HostError> {
        let bytes = serde_json::to_vec_pretty(document)
            .map_err(|error| storage_error(error.to_string()))?;
        let workspace_root = self.workspace_root(settings);
        let analysis_dir = workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("analysis");
        fs::create_dir_all(&analysis_dir).map_err(|error| storage_error(error.to_string()))?;
        fs::write(analysis_dir.join(file_name), &bytes)
            .map_err(|error| storage_error(error.to_string()))?;

        Ok(StoredAnalysisFile {
            artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/analysis/{file_name}"
            ),
            size_bytes: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        })
    }

    pub(crate) fn write_task_analysis_text(
        &self,
        settings: &Value,
        task_id: &str,
        file_name: &str,
        content: &str,
    ) -> Result<StoredAnalysisFile, HostError> {
        let workspace_root = self.workspace_root(settings);
        let analysis_dir = workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("analysis");
        fs::create_dir_all(&analysis_dir).map_err(|error| storage_error(error.to_string()))?;
        fs::write(analysis_dir.join(file_name), content.as_bytes())
            .map_err(|error| storage_error(error.to_string()))?;

        Ok(StoredAnalysisFile {
            artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/analysis/{file_name}"
            ),
            size_bytes: content.len() as u64,
            sha256: format!("{:x}", Sha256::digest(content.as_bytes())),
        })
    }

    pub(crate) fn prepare_task_audio_file(
        &self,
        settings: &Value,
        task_id: &str,
        file_name: &str,
    ) -> Result<PreparedAudioFile, HostError> {
        let workspace_root = self.workspace_root(settings);
        let audio_dir = workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("audio");
        fs::create_dir_all(&audio_dir).map_err(|error| storage_error(error.to_string()))?;

        Ok(PreparedAudioFile {
            file_path: audio_dir.join(file_name),
            artifact_path: format!("workspace/projects/default/tasks/{task_id}/audio/{file_name}"),
        })
    }

    pub(crate) fn prepare_task_render_files(
        &self,
        settings: &Value,
        task_id: &str,
        render_id: &str,
    ) -> Result<PreparedRenderFiles, HostError> {
        let workspace_root = self.workspace_root(settings);
        let render_dir = workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("renders")
            .join(render_id);
        fs::create_dir_all(&render_dir).map_err(|error| storage_error(error.to_string()))?;

        Ok(PreparedRenderFiles {
            output_file_path: render_dir.join("output.mp4"),
            subtitle_file_path: render_dir.join("subtitles.ass"),
            cover_file_path: render_dir.join("cover.png"),
            manifest_file_path: render_dir.join("render.json"),
            log_file_path: render_dir.join("render.log"),
            output_artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/renders/{render_id}/output.mp4"
            ),
            subtitle_artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/renders/{render_id}/subtitles.ass"
            ),
            cover_artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/renders/{render_id}/cover.png"
            ),
            manifest_artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/renders/{render_id}/render.json"
            ),
            log_artifact_path: format!(
                "workspace/projects/default/tasks/{task_id}/renders/{render_id}/render.log"
            ),
        })
    }

    pub(crate) fn resolve_artifact_path(&self, settings: &Value, artifact_path: &str) -> PathBuf {
        if let Some(relative_path) = artifact_path.strip_prefix("workspace/") {
            return self.workspace_root(settings).join(relative_path);
        }

        PathBuf::from(artifact_path)
    }
}

pub(crate) fn not_found(task_id: &str) -> HostError {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "TASK_NOT_FOUND".to_string(),
                message: format!("Task not found: {task_id}"),
                trace_id: format!("trace-{task_id}"),
            },
        }),
    )
}

pub(crate) fn task_plan_not_found(task_id: &str) -> HostError {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "TASK_PLAN_NOT_FOUND".to_string(),
                message: format!("Task plan not found: {task_id}"),
                trace_id: format!("trace-{task_id}"),
            },
        }),
    )
}

pub(crate) fn storage_error(message: String) -> HostError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "STORAGE_ERROR".to_string(),
                message,
                trace_id: "trace-storage".to_string(),
            },
        }),
    )
}

pub(crate) fn render_error(message: String) -> HostError {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "RENDER_FAILED".to_string(),
                message,
                trace_id: "trace-render".to_string(),
            },
        }),
    )
}

pub(crate) fn conflict(code: &str, message: String) -> HostError {
    (
        StatusCode::CONFLICT,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: code.to_string(),
                message,
                trace_id: "trace-conflict".to_string(),
            },
        }),
    )
}

pub(crate) fn bad_request(code: &str, message: String) -> HostError {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: code.to_string(),
                message,
                trace_id: "trace-bad-request".to_string(),
            },
        }),
    )
}

pub(crate) fn json_request_invalid(message: String) -> HostError {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "REQUEST_JSON_INVALID".to_string(),
                message,
                trace_id: "trace-json".to_string(),
            },
        }),
    )
}

pub(crate) fn path_parameter_invalid(message: String) -> HostError {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "PATH_PARAMETER_INVALID".to_string(),
                message,
                trace_id: "trace-path".to_string(),
            },
        }),
    )
}

pub(crate) fn query_parameter_invalid(message: String) -> HostError {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "QUERY_PARAMETER_INVALID".to_string(),
                message,
                trace_id: "trace-query".to_string(),
            },
        }),
    )
}

pub(crate) fn route_not_found() -> HostError {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "ROUTE_NOT_FOUND".to_string(),
                message: "API route was not found.".to_string(),
                trace_id: "trace-route".to_string(),
            },
        }),
    )
}

pub(crate) fn method_not_allowed() -> HostError {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "METHOD_NOT_ALLOWED".to_string(),
                message: "HTTP method is not allowed for this API route.".to_string(),
                trace_id: "trace-route".to_string(),
            },
        }),
    )
}

pub(crate) fn unauthorized(code: &str, message: String) -> HostError {
    (
        StatusCode::UNAUTHORIZED,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: code.to_string(),
                message,
                trace_id: "trace-auth".to_string(),
            },
        }),
    )
}

pub(crate) fn payload_too_large(message: String) -> HostError {
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "SOURCE_FILE_TOO_LARGE".to_string(),
                message,
                trace_id: "trace-upload-limit".to_string(),
            },
        }),
    )
}

pub(crate) fn artifact_not_found(task_id: &str, artifact_id: &str) -> HostError {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "ARTIFACT_NOT_FOUND".to_string(),
                message: format!("Artifact not found: {artifact_id} for task: {task_id}"),
                trace_id: format!("trace-{task_id}"),
            },
        }),
    )
}

pub(crate) fn artifact_content_not_found(task_id: &str, artifact_id: &str) -> HostError {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErrorEnvelope {
            ok: false,
            error: ApiError {
                code: "ARTIFACT_CONTENT_NOT_FOUND".to_string(),
                message: format!("Artifact content not found: {artifact_id} for task: {task_id}"),
                trace_id: format!("trace-{task_id}"),
            },
        }),
    )
}

pub(crate) fn sanitize_source_file_name(source_name: &str) -> String {
    let file_name = source_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(source_name)
        .trim();
    let sanitized = file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_' | ' ' | '(' | ')')
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('.')
        .trim()
        .to_string();

    if sanitized.is_empty() {
        "source.bin".to_string()
    } else {
        sanitized
    }
}

pub(crate) fn update_task(
    state: &mut HostState,
    task_id: &str,
    status: &str,
    progress: u8,
    stage: &str,
) -> Result<VideoCutTask, HostError> {
    let task = state
        .tasks
        .get_mut(task_id)
        .ok_or_else(|| not_found(task_id))?;
    task.status = status.to_string();
    task.progress = progress;
    task.current_stage = stage.to_string();
    task.updated_at = crate::contracts::fixed_time();
    Ok(task.clone())
}

pub(crate) fn push_event(
    state: &mut HostState,
    task_id: &str,
    stage: &str,
    progress: u8,
    message: &str,
) {
    push_event_with_metadata(state, task_id, stage, progress, message, None, None);
}

pub(crate) fn push_event_with_metadata(
    state: &mut HostState,
    task_id: &str,
    stage: &str,
    progress: u8,
    message: &str,
    level: Option<&str>,
    metadata: Option<VideoCutProgressEventMetadata>,
) {
    let events = state.events.entry(task_id.to_string()).or_default();
    events.push(VideoCutProgressEvent {
        event_id: format!("{task_id}-event-{}", events.len() + 1),
        task_id: task_id.to_string(),
        stage: stage.to_string(),
        progress,
        message: message.to_string(),
        level: level.map(ToString::to_string),
        trace_id: format!("trace-{task_id}"),
        metadata,
    });
}

pub(crate) fn render_failure_recovery_metadata() -> VideoCutProgressEventMetadata {
    VideoCutProgressEventMetadata {
        recovery_hint: Some(TaskRecoveryHint {
            code: "RENDER_FAILED_REVIEW_LOG".to_string(),
            action: "retry-render".to_string(),
            label: "Review render log and retry render".to_string(),
            message:
                "Open the render log artifact, verify FFmpeg/media settings, then retry rendering this task."
                    .to_string(),
            retryable: true,
            target_stage: Some("render".to_string()),
        }),
    }
}
