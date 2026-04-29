mod contracts;
pub mod database_queue;
mod doctor;
mod media_assets;
mod media_audio;
mod media_cover;
mod media_probe;
mod media_render;
mod media_render_manifest;
mod media_semantic;
mod media_subtitle;
mod media_subtitle_format;
mod media_transcript;
mod media_vad;
mod models;
pub mod providers;
pub mod runtime_config;
mod settings;
mod speech_transcription;
mod state;
mod tooling;
mod workspace;

use std::collections::BTreeSet;
use std::io::{ErrorKind, SeekFrom};
use std::path::Path as FsPath;

use axum::body::Body;
use axum::extract::multipart::MultipartRejection;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{
    DefaultBodyLimit, FromRequest, FromRequestParts, Multipart, Path, Query,
    Request as AxumRequest, State,
};
use axum::http::header::{
    ACCEPT_RANGES, AUTHORIZATION, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH,
    CONTENT_RANGE, CONTENT_TYPE, PRAGMA, RANGE,
};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use uuid::Uuid;

use contracts::{create_plan, default_settings, fixed_time, pseudo_hash};
use doctor::{capability_report, deployment_doctor_report, diagnostics_bundle_report};
use media_assets::{asset_catalog_document, select_render_audio_assets_for_plan};
use media_audio::{AudioExtractRequest, detect_silence_ranges_document, extract_audio_document};
use media_cover::{RenderCoverRequest, render_cover_png};
use media_probe::probe_media_info_document;
use media_render::{RenderVideoRequest, render_video_cut, sha256_file};
use media_render_manifest::{RenderAttemptManifestRequest, write_render_attempt_manifest};
use media_semantic::analyze_semantics_document_with_http;
use media_subtitle::{RenderSubtitleRequest, render_subtitle_ass};
use media_subtitle_format::{
    export_transcript_document, normalize_subtitle_format, subtitle_import_transcript_document,
};
use media_transcript::{manual_transcript_document, transcribe_audio_document_with_http};
use media_vad::detect_speech_activity_document;
use models::{
    ApiEnvelope, ArtifactDownloadDescriptor, AttachTaskSourceInput, CreateTaskInput,
    DeleteTaskOutput, DiagnosticSupportBundleRequest, ManualTranscriptInput, SubtitleExportOutput,
    SubtitleExportQuery, SubtitleImportInput, VideoCutArtifact, VideoCutProgressEvent,
    VideoCutTask,
};
use providers::{
    OpenAiCompatibleProviderConfig, ProviderConformanceCheck, ProviderConformanceReport,
    ProviderKind, SpeechToTextProviderConfig, StructuredOutputMode,
    openai_compatible_conformance_report, speech_to_text_conformance_report,
};
use runtime_config::RuntimeHostConfig;
use settings::{extract_runtime_secret_updates, sanitize_settings, validate_settings};
use speech_transcription::speech_to_text_provider_config_from_settings;
use state::{
    AppState, HostError, HostState, StoredSourceFile, artifact_content_not_found,
    artifact_not_found, bad_request, conflict, json_request_invalid, method_not_allowed, not_found,
    path_parameter_invalid, payload_too_large, push_event, push_event_with_metadata,
    query_parameter_invalid, render_error, render_failure_recovery_metadata, route_not_found,
    sanitize_source_file_name, storage_error, task_plan_not_found, unauthorized, update_task,
};

struct ApiJson<T>(T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = HostError;

    async fn from_request(req: AxumRequest, state: &S) -> Result<Self, Self::Rejection> {
        Json::<T>::from_request(req, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(api_json_rejection)
    }
}

fn api_json_rejection(_rejection: JsonRejection) -> HostError {
    json_request_invalid(
        "Request body must be valid JSON matching the endpoint schema.".to_string(),
    )
}

struct ApiMultipart(Multipart);

impl<S> FromRequest<S> for ApiMultipart
where
    S: Send + Sync,
{
    type Rejection = HostError;

    async fn from_request(req: AxumRequest, state: &S) -> Result<Self, Self::Rejection> {
        Multipart::from_request(req, state)
            .await
            .map(Self)
            .map_err(api_multipart_rejection)
    }
}

fn api_multipart_rejection(rejection: MultipartRejection) -> HostError {
    bad_request("MULTIPART_INVALID", rejection.to_string())
}

struct ApiPath<T>(T);

impl<S, T> FromRequestParts<S> for ApiPath<T>
where
    T: DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = HostError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Path::<T>::from_request_parts(parts, state)
            .await
            .map(|Path(value)| Self(value))
            .map_err(api_path_rejection)
    }
}

fn api_path_rejection(rejection: PathRejection) -> HostError {
    path_parameter_invalid(rejection.to_string())
}

struct ApiQuery<T>(T);

impl<S, T> FromRequestParts<S> for ApiQuery<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = HostError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(api_query_rejection)
    }
}

fn api_query_rejection(rejection: QueryRejection) -> HostError {
    query_parameter_invalid(rejection.to_string())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConformanceRequest {
    target: ProviderConformanceTarget,
}

#[derive(Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum ProviderConformanceTarget {
    Ai,
    SpeechToText,
    All,
}

pub fn create_app() -> Router {
    create_app_with_state(AppState::new(default_settings()))
}

pub fn create_persistent_app(workspace_root: impl Into<std::path::PathBuf>) -> Router {
    create_app_with_state(AppState::persistent(default_settings(), workspace_root))
}

pub fn create_persistent_app_with_runtime_config(config: RuntimeHostConfig) -> Router {
    let secrets = config
        .runtime_secrets
        .into_iter()
        .map(|secret| (secret.secret_ref, secret.secret_value))
        .collect();
    create_app_with_state(AppState::persistent_with_secrets(
        config.settings,
        config.workspace_root,
        secrets,
    ))
}

fn create_app_with_state(state: AppState) -> Router {
    let auth_state = state.clone();
    let cors_layer = cors_layer_from_state(&state);
    Router::new()
        .route("/api/video-cut/v1/health", get(health))
        .route("/api/video-cut/v1/capabilities", get(capabilities))
        .route("/api/video-cut/v1/doctor", get(doctor))
        .route(
            "/api/video-cut/v1/diagnostics/bundle",
            get(diagnostics_bundle),
        )
        .route(
            "/api/video-cut/v1/diagnostics/support-bundle",
            post(diagnostics_support_bundle),
        )
        .route(
            "/api/video-cut/v1/providers/openai-compatible/conformance",
            post(provider_conformance),
        )
        .route(
            "/api/video-cut/v1/settings",
            get(get_settings).put(put_settings),
        )
        .route("/api/video-cut/v1/assets/catalog", get(get_asset_catalog))
        .route("/api/video-cut/v1/tasks", get(list_tasks).post(create_task))
        .route(
            "/api/video-cut/v1/tasks/{task_id}",
            get(get_task).delete(delete_task),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/source",
            post(attach_task_source),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/source/file",
            post(upload_task_source_file).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/analyze",
            post(analyze_task),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/plan",
            get(get_task_plan).put(update_task_plan),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/transcript",
            put(put_task_transcript),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/subtitles/import",
            put(put_task_subtitle_import),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/subtitles/export",
            get(get_task_subtitle_export),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/render",
            post(render_task),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/render/batch",
            post(render_task_batch),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/cancel",
            post(cancel_task),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/events",
            get(get_task_events),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/artifacts",
            get(get_task_artifacts),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/artifacts/{artifact_id}/download",
            get(get_artifact_download),
        )
        .route(
            "/api/video-cut/v1/tasks/{task_id}/artifacts/{artifact_id}/content",
            get(get_artifact_content),
        )
        .method_not_allowed_fallback(api_method_not_allowed)
        .fallback(api_route_not_found)
        .route_layer(middleware::from_fn_with_state(auth_state, auth_middleware))
        .layer(cors_layer)
        .with_state(state)
}

fn cors_layer_from_state(state: &AppState) -> CorsLayer {
    let guard = state.inner.lock().expect("state lock");
    cors_layer_from_settings(&guard.settings)
}

fn cors_layer_from_settings(settings: &Value) -> CorsLayer {
    let configured_origins = settings
        .pointer("/security/corsAllowedOrigins")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|origin| HeaderValue::from_str(origin.trim()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            vec![
                HeaderValue::from_static("http://127.0.0.1:5173"),
                HeaderValue::from_static("http://localhost:5173"),
            ]
        });

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(configured_origins))
        .allow_methods(Any)
        .allow_headers(Any)
}

async fn api_route_not_found() -> HostError {
    route_not_found()
}

async fn api_method_not_allowed() -> HostError {
    method_not_allowed()
}

async fn auth_middleware(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, HostError> {
    if request.method() == Method::OPTIONS || request.uri().path() == "/api/video-cut/v1/health" {
        return Ok(next.run(request).await);
    }

    let (auth_mode, expected_token) = {
        let guard = state.inner.lock().expect("state lock");
        (
            string_at(&guard.settings, "/runtime/authMode").to_string(),
            guard.secrets.get("settings://server/token").cloned(),
        )
    };

    if auth_mode != "single-user-token" {
        return Ok(next.run(request).await);
    }

    let Some(expected_token) = expected_token.filter(|token| !token.trim().is_empty()) else {
        return Err(unauthorized(
            "AUTH_REQUIRED",
            "Server token is required for single-user-token auth mode.".to_string(),
        ));
    };
    let Some(header_value) = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return Err(unauthorized(
            "AUTH_REQUIRED",
            "Authorization bearer token is required.".to_string(),
        ));
    };

    if header_value != format!("Bearer {expected_token}") {
        return Err(unauthorized(
            "AUTH_INVALID",
            "Authorization bearer token is invalid.".to_string(),
        ));
    }

    Ok(next.run(request).await)
}

async fn health() -> Json<ApiEnvelope<Value>> {
    ok(json!({ "status": "ok" }))
}

async fn capabilities(State(state): State<AppState>) -> Json<ApiEnvelope<Value>> {
    let guard = state.inner.lock().expect("state lock");
    ok(capability_report(&guard.settings))
}

async fn doctor(State(state): State<AppState>) -> Json<ApiEnvelope<Value>> {
    let guard = state.inner.lock().expect("state lock");
    ok(deployment_doctor_report(&state, &guard.settings))
}

async fn diagnostics_bundle(State(state): State<AppState>) -> Json<ApiEnvelope<Value>> {
    let guard = state.inner.lock().expect("state lock");
    ok(diagnostics_bundle_report(&state, &guard.settings))
}

async fn diagnostics_support_bundle(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<DiagnosticSupportBundleRequest>,
) -> Result<Json<ApiEnvelope<Value>>, HostError> {
    if (input.include_source_media || input.include_transcript) && !input.consent_accepted {
        return Err(bad_request(
            "DIAGNOSTICS_CONSENT_REQUIRED",
            "Explicit user consent is required before diagnostics support attachments can reference source media or transcript artifacts."
                .to_string(),
        ));
    }

    let requested_task_id = input
        .task_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if (input.include_source_media || input.include_transcript) && requested_task_id.is_none() {
        return Err(bad_request(
            "DIAGNOSTICS_TASK_REQUIRED",
            "A taskId is required when diagnostics support attachments are requested.".to_string(),
        ));
    }

    let guard = state.inner.lock().expect("state lock");
    let mut bundle = diagnostics_bundle_report(&state, &guard.settings);
    let mut artifacts = Vec::<Value>::new();
    let mut source_media_included = false;
    let mut transcript_included = false;

    if let Some(task_id) = requested_task_id {
        if !guard.tasks.contains_key(task_id) {
            return Err(not_found(task_id));
        }

        let task_artifacts = guard.artifacts.get(task_id).cloned().unwrap_or_default();
        if input.include_source_media {
            let descriptor = task_artifacts
                .iter()
                .find(|artifact| artifact.kind == "source")
                .map(|artifact| support_attachment_descriptor(task_id, artifact, "sourceMedia"))
                .unwrap_or_else(|| {
                    missing_support_attachment_descriptor(
                        task_id,
                        "sourceMedia",
                        "Source media artifact is not available for this task.",
                    )
                });
            source_media_included = descriptor["included"].as_bool().unwrap_or(false);
            artifacts.push(descriptor);
        }

        if input.include_transcript {
            let transcript_artifact_id = format!("{task_id}-transcript");
            let descriptor = task_artifacts
                .iter()
                .find(|artifact| artifact.artifact_id == transcript_artifact_id)
                .map(|artifact| support_attachment_descriptor(task_id, artifact, "transcript"))
                .unwrap_or_else(|| {
                    missing_support_attachment_descriptor(
                        task_id,
                        "transcript",
                        "Transcript artifact is not available for this task.",
                    )
                });
            transcript_included = descriptor["included"].as_bool().unwrap_or(false);
            artifacts.push(descriptor);
        }
    }

    bundle["includes"]["sourceMedia"] = json!(source_media_included);
    bundle["includes"]["transcript"] = json!(transcript_included);
    bundle["supportRequest"] = json!({
        "schemaId": "video-cut.diagnostics-support-bundle-request.v1",
        "taskId": requested_task_id,
        "includeSourceMedia": input.include_source_media,
        "includeTranscript": input.include_transcript,
        "consentAccepted": input.consent_accepted
    });
    bundle["artifacts"] = Value::Array(artifacts);

    Ok(ok(bundle))
}

fn support_attachment_descriptor(task_id: &str, artifact: &VideoCutArtifact, kind: &str) -> Value {
    if !is_workspace_task_artifact_path(&artifact.path, task_id) {
        return json!({
            "kind": kind,
            "taskId": task_id,
            "artifactId": artifact.artifact_id.clone(),
            "included": false,
            "redacted": true,
            "reason": "Artifact path failed workspace boundary validation."
        });
    }

    json!({
        "kind": kind,
        "taskId": task_id,
        "artifactId": artifact.artifact_id.clone(),
        "path": artifact.path.clone(),
        "contentRef": format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{}/content", artifact.artifact_id),
        "contentType": infer_content_type(&artifact.path),
        "included": true,
        "redacted": false,
        "sizeBytes": artifact.size_bytes,
        "sha256": artifact.sha256.clone()
    })
}

fn missing_support_attachment_descriptor(task_id: &str, kind: &str, reason: &str) -> Value {
    json!({
        "kind": kind,
        "taskId": task_id,
        "included": false,
        "redacted": true,
        "reason": reason
    })
}

async fn provider_conformance(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<ProviderConformanceRequest>,
) -> Json<ApiEnvelope<ProviderConformanceReport>> {
    let guard = state.inner.lock().expect("state lock");
    ok(provider_conformance_report_from_settings(
        &guard.settings,
        &input.target,
    ))
}

async fn get_settings(State(state): State<AppState>) -> Json<ApiEnvelope<Value>> {
    let guard = state.inner.lock().expect("state lock");
    ok(guard.settings.clone())
}

async fn put_settings(
    State(state): State<AppState>,
    ApiJson(mut settings): ApiJson<Value>,
) -> Result<Json<ApiEnvelope<Value>>, HostError> {
    let secret_updates = extract_runtime_secret_updates(&mut settings);
    let validation = validate_settings(&settings);
    if !validation.valid {
        return Ok(ok(json!(validation)));
    }

    let sanitized_settings = sanitize_settings(&settings);
    let mut guard = state.inner.lock().expect("state lock");
    for update in secret_updates {
        guard.secrets.insert(update.secret_ref, update.secret_value);
    }
    guard.settings = sanitized_settings;
    state.persist_settings(&guard.settings)?;
    Ok(ok(json!(validation)))
}

async fn get_asset_catalog(State(state): State<AppState>) -> Json<ApiEnvelope<Value>> {
    let guard = state.inner.lock().expect("state lock");
    ok(asset_catalog_document(&guard.settings))
}

async fn list_tasks(State(state): State<AppState>) -> Json<ApiEnvelope<Vec<VideoCutTask>>> {
    let guard = state.inner.lock().expect("state lock");
    let mut tasks = guard.tasks.values().cloned().collect::<Vec<_>>();
    tasks.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.task_id.cmp(&left.task_id))
    });
    ok(tasks)
}

async fn create_task(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<CreateTaskInput>,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    let mut guard = state.inner.lock().expect("state lock");
    let task_id = format!("task-{}", Uuid::new_v4().simple());
    let task = VideoCutTask {
        task_id: task_id.clone(),
        title: input.title,
        task_type: input.task_type,
        status: "draft".to_string(),
        progress: 0,
        duration_seconds: 168,
        source_name: None,
        updated_at: fixed_time(),
        current_stage: "draft".to_string(),
    };
    guard.tasks.insert(task_id.clone(), task.clone());
    state.persist_task(&guard, &task_id)?;

    Ok(ok(task))
}

fn reject_if_cancelled(task: &VideoCutTask) -> Result<(), HostError> {
    if task.status == "cancelled" {
        return Err(conflict(
            "TASK_CANCELLED",
            format!("Task has been cancelled: {}.", task.task_id),
        ));
    }

    Ok(())
}

fn reject_if_task_busy(task: &VideoCutTask, requested_stage: &str) -> Result<(), HostError> {
    reject_if_cancelled(task)?;
    if task.status == "analyzing" {
        let (code, label) = if requested_stage == "analyze" {
            ("ANALYZE_ALREADY_RUNNING", "Analysis")
        } else {
            ("TASK_BUSY", "Task")
        };
        return Err(conflict(
            code,
            format!("{label} is already running for task: {}.", task.task_id),
        ));
    }
    if task.status == "rendering" {
        let (code, label) = if requested_stage == "render" {
            ("RENDER_ALREADY_RUNNING", "Render")
        } else {
            ("TASK_BUSY", "Task")
        };
        return Err(conflict(
            code,
            format!("{label} is already running for task: {}.", task.task_id),
        ));
    }

    Ok(())
}

fn reject_if_task_running(task: &VideoCutTask) -> Result<(), HostError> {
    if task.status == "analyzing" || task.status == "rendering" {
        return Err(conflict(
            "TASK_BUSY",
            format!("Task is already running for task: {}.", task.task_id),
        ));
    }

    Ok(())
}

fn reject_if_task_terminal(task: &VideoCutTask) -> Result<(), HostError> {
    if task.status == "succeeded" || task.status == "failed" || task.status == "interrupted" {
        return Err(conflict(
            "TASK_TERMINAL",
            format!(
                "Task is already terminal with status {}: {}.",
                task.status, task.task_id
            ),
        ));
    }

    Ok(())
}

fn require_editable_task(guard: &HostState, task_id: &str) -> Result<VideoCutTask, HostError> {
    let task = guard
        .tasks
        .get(task_id)
        .cloned()
        .ok_or_else(|| not_found(task_id))?;
    reject_if_task_busy(&task, "edit")?;
    Ok(task)
}

fn cancelled_task(guard: &HostState, task_id: &str) -> Option<VideoCutTask> {
    guard
        .tasks
        .get(task_id)
        .filter(|task| task.status == "cancelled")
        .cloned()
}

async fn get_task(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    let guard = state.inner.lock().expect("state lock");
    let task = guard
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| not_found(&task_id))?;

    Ok(ok(task))
}

async fn delete_task(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<DeleteTaskOutput>>, HostError> {
    let mut guard = state.inner.lock().expect("state lock");
    let task = guard
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| not_found(&task_id))?;
    reject_if_task_running(&task)?;

    let artifacts_deleted = guard
        .artifacts
        .remove(&task_id)
        .map_or(0, |items| items.len());
    let events_deleted = guard.events.remove(&task_id).map_or(0, |items| items.len());
    guard.plans.remove(&task_id);
    guard.tasks.remove(&task_id);
    state.delete_task_manifest(&task_id)?;

    Ok(ok(DeleteTaskOutput {
        task_id,
        deleted: true,
        artifacts_deleted,
        events_deleted,
    }))
}

async fn attach_task_source(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
    ApiJson(input): ApiJson<AttachTaskSourceInput>,
) -> Result<Json<ApiEnvelope<VideoCutArtifact>>, HostError> {
    let mut guard = state.inner.lock().expect("state lock");
    require_editable_task(&guard, &task_id)?;
    let source_name = sanitize_source_file_name(&input.source_name);
    validate_source_media_type(&source_name, input.content_type.as_deref())?;
    let task = guard
        .tasks
        .get_mut(&task_id)
        .ok_or_else(|| not_found(&task_id))?;
    task.source_name = Some(source_name.clone());
    task.status = "sourceReady".to_string();
    task.progress = task.progress.max(5);
    task.current_stage = "import".to_string();
    task.updated_at = fixed_time();

    let artifact = VideoCutArtifact {
        artifact_id: format!("{task_id}-source"),
        task_id: task_id.clone(),
        render_id: None,
        kind: "source".to_string(),
        path: format!("workspace/projects/default/tasks/{task_id}/source/{source_name}"),
        size_bytes: input.size_bytes.unwrap_or(128_000_000),
        sha256: pseudo_hash(&format!("{task_id}-source")),
        created_at: fixed_time(),
    };
    let task_artifacts = guard.artifacts.entry(task_id.clone()).or_default();
    task_artifacts.retain(|item| item.kind != "source");
    task_artifacts.insert(0, artifact.clone());
    push_event(&mut guard, &task_id, "import", 5, "Source video attached.");
    state.persist_task(&guard, &task_id)?;

    Ok(ok(artifact))
}

async fn remove_upload_temp_file(path: &FsPath) {
    let _ = tokio::fs::remove_file(path).await;
}

async fn replace_uploaded_source_file(
    temp_file_path: &FsPath,
    target_file_path: &FsPath,
    safe_name: &str,
) -> Result<(), HostError> {
    let target_exists = match tokio::fs::try_exists(target_file_path).await {
        Ok(exists) => exists,
        Err(error) => {
            remove_upload_temp_file(temp_file_path).await;
            return Err(storage_error(error.to_string()));
        }
    };
    let mut backup_file_path = None;
    if target_exists {
        let metadata = match tokio::fs::metadata(target_file_path).await {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                remove_upload_temp_file(temp_file_path).await;
                return Err(storage_error(error.to_string()));
            }
        };
        if let Some(metadata) = metadata {
            if !metadata.is_file() {
                remove_upload_temp_file(temp_file_path).await;
                return Err(storage_error(format!(
                    "Source upload target is not a regular file: {}.",
                    target_file_path.display()
                )));
            }

            let next_backup_file_path = target_file_path.with_file_name(format!(
                "{}.{}.replacing",
                safe_name,
                Uuid::new_v4().simple()
            ));
            match tokio::fs::rename(target_file_path, &next_backup_file_path).await {
                Ok(()) => backup_file_path = Some(next_backup_file_path),
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => {
                    remove_upload_temp_file(temp_file_path).await;
                    return Err(storage_error(error.to_string()));
                }
            }
        }
    }

    if let Err(error) = tokio::fs::rename(temp_file_path, target_file_path).await {
        if let Some(backup_file_path) = backup_file_path.as_ref() {
            let _ = tokio::fs::rename(backup_file_path, target_file_path).await;
        }
        remove_upload_temp_file(temp_file_path).await;
        return Err(storage_error(error.to_string()));
    }

    if let Some(backup_file_path) = backup_file_path {
        let _ = tokio::fs::remove_file(backup_file_path).await;
    }

    Ok(())
}

async fn upload_task_source_file(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
    ApiMultipart(mut multipart): ApiMultipart,
) -> Result<Json<ApiEnvelope<VideoCutArtifact>>, HostError> {
    let settings = {
        let guard = state.inner.lock().expect("state lock");
        require_editable_task(&guard, &task_id)?;
        guard.settings.clone()
    };
    let max_upload_bytes = u64_at(
        &settings,
        "/mediaTools/maxUploadBytes",
        8 * 1024 * 1024 * 1024,
    );
    let mut stored_source = None;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|error| bad_request("MULTIPART_INVALID", error.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let file_name = field
            .file_name()
            .map(str::to_string)
            .unwrap_or_else(|| "source.bin".to_string());
        let content_type = field.content_type().map(str::to_string);
        let source_name = sanitize_source_file_name(&file_name);
        validate_source_media_type(&source_name, content_type.as_deref())?;
        let prepared = state.prepare_task_source_file(&settings, &task_id, &source_name)?;
        let temp_file_path = prepared.file_path.with_file_name(format!(
            "{}.{}.uploading",
            prepared.safe_name,
            Uuid::new_v4().simple()
        ));
        let mut file = tokio::fs::File::create(&temp_file_path)
            .await
            .map_err(|error| storage_error(error.to_string()))?;
        let mut hasher = Sha256::new();
        let mut size_bytes = 0_u64;

        loop {
            let chunk = match field.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    drop(file);
                    remove_upload_temp_file(&temp_file_path).await;
                    return Err(bad_request("MULTIPART_INVALID", error.to_string()));
                }
            };
            let Some(next_size_bytes) = size_bytes.checked_add(chunk.len() as u64) else {
                drop(file);
                remove_upload_temp_file(&temp_file_path).await;
                return Err(payload_too_large(
                    "Source file size overflowed.".to_string(),
                ));
            };
            size_bytes = next_size_bytes;
            if size_bytes > max_upload_bytes {
                drop(file);
                remove_upload_temp_file(&temp_file_path).await;
                return Err(payload_too_large(format!(
                    "Source file size {size_bytes} exceeds configured limit {max_upload_bytes}."
                )));
            }

            hasher.update(&chunk);
            if let Err(error) = file.write_all(&chunk).await {
                drop(file);
                remove_upload_temp_file(&temp_file_path).await;
                return Err(storage_error(error.to_string()));
            }
        }
        if let Err(error) = file.flush().await {
            drop(file);
            remove_upload_temp_file(&temp_file_path).await;
            return Err(storage_error(error.to_string()));
        }
        drop(file);
        let editability_check = {
            let guard = state.inner.lock().expect("state lock");
            require_editable_task(&guard, &task_id).map(|_| ())
        };
        if let Err(error) = editability_check {
            remove_upload_temp_file(&temp_file_path).await;
            return Err(error);
        }
        replace_uploaded_source_file(&temp_file_path, &prepared.file_path, &prepared.safe_name)
            .await?;
        stored_source = Some(StoredSourceFile {
            safe_name: prepared.safe_name,
            artifact_path: prepared.artifact_path,
            size_bytes,
            sha256: format!("{:x}", hasher.finalize()),
        });
        break;
    }

    let stored_source = stored_source.ok_or_else(|| {
        bad_request(
            "SOURCE_FILE_REQUIRED",
            "File field is required.".to_string(),
        )
    })?;

    let mut guard = state.inner.lock().expect("state lock");
    require_editable_task(&guard, &task_id)?;
    let task = guard
        .tasks
        .get_mut(&task_id)
        .ok_or_else(|| not_found(&task_id))?;
    task.source_name = Some(stored_source.safe_name.clone());
    task.status = "sourceReady".to_string();
    task.progress = task.progress.max(5);
    task.current_stage = "import".to_string();
    task.updated_at = fixed_time();

    let artifact = VideoCutArtifact {
        artifact_id: format!("{task_id}-source"),
        task_id: task_id.clone(),
        render_id: None,
        kind: "source".to_string(),
        path: stored_source.artifact_path,
        size_bytes: stored_source.size_bytes,
        sha256: stored_source.sha256,
        created_at: fixed_time(),
    };
    let task_artifacts = guard.artifacts.entry(task_id.clone()).or_default();
    task_artifacts.retain(|item| item.kind != "source");
    task_artifacts.insert(0, artifact.clone());
    push_event(
        &mut guard,
        &task_id,
        "import",
        5,
        "Source video uploaded to workspace.",
    );
    state.persist_task(&guard, &task_id)?;

    Ok(ok(artifact))
}

fn validate_source_media_type(
    source_name: &str,
    content_type: Option<&str>,
) -> Result<(), HostError> {
    let extension = source_name
        .rsplit('.')
        .next()
        .filter(|value| *value != source_name)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let extension_allowed = matches!(
        extension.as_str(),
        "mp4" | "mov" | "m4v" | "mkv" | "webm" | "avi" | "mpeg" | "mpg"
    );
    let content_type_allowed = match content_type.map(|value| value.trim().to_ascii_lowercase()) {
        None => true,
        Some(value) if value.is_empty() => true,
        Some(value) if value == "application/octet-stream" => true,
        Some(value) if value.starts_with("video/") => true,
        Some(value) if value == "application/x-matroska" => true,
        Some(_) => false,
    };

    if extension_allowed && content_type_allowed {
        return Ok(());
    }

    Err(bad_request(
        "SOURCE_FILE_TYPE_UNSUPPORTED",
        "Source file must be a supported video file: mp4, mov, m4v, mkv, webm, avi, mpeg, or mpg."
            .to_string(),
    ))
}

fn json_artifact_metadata(document: &Value) -> Result<(u64, String), HostError> {
    let bytes =
        serde_json::to_vec_pretty(document).map_err(|error| storage_error(error.to_string()))?;
    Ok((bytes.len() as u64, format!("{:x}", Sha256::digest(&bytes))))
}

fn validate_split_plan_update(task_id: &str, plan: &Value) -> Result<(), HostError> {
    let Some(document) = plan.as_object() else {
        return Err(plan_invalid("Split plan must be a JSON object."));
    };

    require_const_str(document, "schemaId", "video-cut.split-plan.schema.v1")?;
    require_u64(document, "planVersion", Some(1), Some(1))?;
    require_non_empty_str(document, "planId")?;
    require_u64(document, "planRevision", Some(1), None)?;
    let document_task_id = require_non_empty_str(document, "taskId")?;
    if document_task_id != task_id {
        return Err(bad_request(
            "PLAN_TASK_ID_MISMATCH",
            "Split plan taskId must match the task id from the URL.".to_string(),
        ));
    }
    require_non_empty_str(document, "sourceName")?;
    require_video_cut_type(document, "type")?;
    validate_output_spec(document.get("outputSpec"))?;
    validate_render_preferences(document.get("renderPreferences"))?;
    validate_plan_tracks(document.get("tracks"))?;
    validate_plan_segments(document.get("segments"))?;
    require_non_empty_str(document, "createdAt")?;

    Ok(())
}

fn plan_invalid(message: impl Into<String>) -> HostError {
    bad_request("PLAN_INVALID", message.into())
}

fn require_non_empty_str<'a>(
    document: &'a serde_json::Map<String, Value>,
    field: &str,
) -> Result<&'a str, HostError> {
    document
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            plan_invalid(format!(
                "{field} is required and must be a non-empty string."
            ))
        })
}

fn require_const_str(
    document: &serde_json::Map<String, Value>,
    field: &str,
    expected: &str,
) -> Result<(), HostError> {
    let actual = require_non_empty_str(document, field)?;
    if actual != expected {
        return Err(plan_invalid(format!("{field} must be {expected}.")));
    }
    Ok(())
}

fn require_u64(
    document: &serde_json::Map<String, Value>,
    field: &str,
    min: Option<u64>,
    exact: Option<u64>,
) -> Result<u64, HostError> {
    let value = document
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| plan_invalid(format!("{field} is required and must be an integer.")))?;
    if let Some(expected) = exact
        && value != expected
    {
        return Err(plan_invalid(format!("{field} must be {expected}.")));
    }
    if let Some(minimum) = min
        && value < minimum
    {
        return Err(plan_invalid(format!("{field} must be at least {minimum}.")));
    }
    Ok(value)
}

fn require_video_cut_type(
    document: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<(), HostError> {
    let value = require_non_empty_str(document, field)?;
    if !matches!(value, "single-speaker" | "interview-qa" | "long-interview") {
        return Err(plan_invalid(format!(
            "{field} is not a supported video cut type."
        )));
    }
    Ok(())
}

fn validate_output_spec(value: Option<&Value>) -> Result<(), HostError> {
    let Some(output_spec) = value.and_then(Value::as_object) else {
        return Err(plan_invalid(
            "outputSpec is required and must be an object.",
        ));
    };
    require_const_str(output_spec, "aspectRatio", "9:16")?;
    let width = require_u64(output_spec, "width", Some(1), None)?;
    let height = require_u64(output_spec, "height", Some(1), None)?;
    if (width as u128) * 16 != (height as u128) * 9 {
        return Err(plan_invalid(
            "outputSpec width and height must match the 9:16 aspect ratio.",
        ));
    }
    require_u64(output_spec, "frameRate", Some(30), Some(30))?;
    require_const_str(output_spec, "format", "mp4")?;
    Ok(())
}

fn validate_render_preferences(value: Option<&Value>) -> Result<(), HostError> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(render_preferences) = value.as_object() else {
        return Err(plan_invalid(
            "renderPreferences must be an object when provided.",
        ));
    };
    let Some(audio) = render_preferences.get("audio").and_then(Value::as_object) else {
        return Err(plan_invalid("renderPreferences.audio must be an object."));
    };
    validate_render_asset_preference(audio.get("bgm"), "bgm")?;
    if audio.get("bgmVolumePercent").and_then(Value::as_u64) != Some(20) {
        return Err(plan_invalid(
            "renderPreferences.audio.bgmVolumePercent must be 20.",
        ));
    }
    validate_render_asset_preference(audio.get("sfx"), "sfx")?;
    if audio.get("voiceEnhancement").and_then(Value::as_str) != Some("basic") {
        return Err(plan_invalid(
            "renderPreferences.audio.voiceEnhancement must be basic.",
        ));
    }
    Ok(())
}

fn validate_render_asset_preference(value: Option<&Value>, kind: &str) -> Result<(), HostError> {
    let field = format!("renderPreferences.audio.{kind}");
    let Some(preference) = value.and_then(Value::as_object) else {
        return Err(plan_invalid(format!("{field} must be an object.")));
    };
    let mode = preference
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(|| plan_invalid(format!("{field}.mode is required.")))?;
    match mode {
        "auto" | "disabled" => {
            if preference.contains_key("assetId") || preference.contains_key("path") {
                return Err(plan_invalid(format!(
                    "{field} auto and disabled modes must not include assetId or path."
                )));
            }
        }
        "asset" => {
            let asset_id = preference
                .get("assetId")
                .and_then(Value::as_str)
                .ok_or_else(|| plan_invalid(format!("{field}.assetId is required.")))?;
            let expected_prefix = format!("{kind}-");
            if !asset_id.starts_with(&expected_prefix)
                || asset_id.len() != expected_prefix.len() + 16
                || !asset_id[expected_prefix.len()..]
                    .chars()
                    .all(|value| value.is_ascii_hexdigit())
            {
                return Err(plan_invalid(format!(
                    "{field}.assetId must match the {kind} catalog asset id."
                )));
            }
            let path = preference
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| plan_invalid(format!("{field}.path is required.")))?;
            let expected_path_prefix = format!("assets://{kind}/");
            let Some(file_name) = path.strip_prefix(&expected_path_prefix) else {
                return Err(plan_invalid(format!(
                    "{field}.path must use an assets://{kind}/ logical reference."
                )));
            };
            if !is_safe_asset_file_name(file_name) {
                return Err(plan_invalid(format!(
                    "{field}.path must reference a safe asset file name."
                )));
            }
        }
        _ => {
            return Err(plan_invalid(format!(
                "{field}.mode must be auto, asset, or disabled."
            )));
        }
    }
    Ok(())
}

fn is_safe_asset_file_name(value: &str) -> bool {
    !value.trim().is_empty()
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && !value.contains("..")
}

fn validate_plan_tracks(value: Option<&Value>) -> Result<(), HostError> {
    let Some(tracks) = value.and_then(Value::as_array) else {
        return Err(plan_invalid("tracks is required and must be an array."));
    };
    if tracks.is_empty() {
        return Err(plan_invalid(
            "tracks must contain the standard provenance tracks.",
        ));
    }

    let required_track_kinds = [
        "mediaInfoTrack",
        "silenceTrack",
        "speechActivityTrack",
        "transcriptTrack",
        "sceneTrack",
        "subjectTrack",
        "semanticTrack",
        "cutDecisionTrack",
    ];
    let mut existing_track_kinds = BTreeSet::new();

    for (index, track) in tracks.iter().enumerate() {
        let Some(track_document) = track.as_object() else {
            return Err(plan_invalid(format!("tracks[{index}] must be an object.")));
        };
        let kind = require_non_empty_str(track_document, "kind")?;
        if !required_track_kinds.contains(&kind) {
            return Err(plan_invalid(format!(
                "tracks[{index}].kind is not supported."
            )));
        }
        existing_track_kinds.insert(kind.to_string());
        require_non_empty_str(track_document, "sourceArtifactId")?;
        require_non_empty_str(track_document, "providerId")?;
        require_non_empty_str(track_document, "adapterVersion")?;
        require_non_empty_str(track_document, "inputHash")?;
        require_non_empty_str(track_document, "outputHash")?;
        if !matches!(track_document.get("parameters"), Some(Value::Object(_))) {
            return Err(plan_invalid(format!(
                "tracks[{index}].parameters must be an object."
            )));
        }
        validate_string_array(
            track_document.get("warnings"),
            &format!("tracks[{index}].warnings"),
        )?;
    }

    for required_kind in required_track_kinds {
        if !existing_track_kinds.contains(required_kind) {
            return Err(plan_invalid(format!(
                "tracks must include {required_kind}."
            )));
        }
    }

    Ok(())
}

fn validate_plan_segments(value: Option<&Value>) -> Result<(), HostError> {
    let Some(segments) = value.and_then(Value::as_array) else {
        return Err(plan_invalid("segments is required and must be an array."));
    };
    if segments.is_empty() {
        return Err(plan_invalid(
            "segments must contain at least one split segment.",
        ));
    }

    for (index, segment) in segments.iter().enumerate() {
        let Some(segment_document) = segment.as_object() else {
            return Err(plan_invalid(format!(
                "segments[{index}] must be an object."
            )));
        };
        require_non_empty_str(segment_document, "segmentId")?;
        require_non_empty_str(segment_document, "title")?;
        require_video_cut_type(segment_document, "type")?;
        validate_time_range(
            segment_document.get("sourceRange"),
            &format!("segments[{index}].sourceRange"),
        )?;
        validate_time_range(
            segment_document.get("outputRange"),
            &format!("segments[{index}].outputRange"),
        )?;
        segment_document
            .get("score")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 1.0)
            .ok_or_else(|| {
                plan_invalid(format!("segments[{index}].score must be between 0 and 1."))
            })?;
        validate_decision_reasons(segment_document.get("decisionReasons"), index)?;
        validate_string_array(
            segment_document.get("hardConstraints"),
            &format!("segments[{index}].hardConstraints"),
        )?;
        validate_string_array(
            segment_document.get("warnings"),
            &format!("segments[{index}].warnings"),
        )?;
    }

    Ok(())
}

fn validate_time_range(value: Option<&Value>, field: &str) -> Result<(), HostError> {
    let Some(range) = value.and_then(Value::as_object) else {
        return Err(plan_invalid(format!(
            "{field} is required and must be an object."
        )));
    };
    let start_ms = range
        .get("startMs")
        .and_then(Value::as_u64)
        .ok_or_else(|| plan_invalid(format!("{field}.startMs must be a non-negative integer.")))?;
    let end_ms = range
        .get("endMs")
        .and_then(Value::as_u64)
        .ok_or_else(|| plan_invalid(format!("{field}.endMs must be a non-negative integer.")))?;
    if end_ms <= start_ms {
        return Err(plan_invalid(format!(
            "{field} must have positive duration."
        )));
    }
    Ok(())
}

fn validate_decision_reasons(value: Option<&Value>, segment_index: usize) -> Result<(), HostError> {
    let field = format!("segments[{segment_index}].decisionReasons");
    let Some(reasons) = value.and_then(Value::as_array) else {
        return Err(plan_invalid(format!(
            "{field} is required and must be an array."
        )));
    };
    for (index, reason) in reasons.iter().enumerate() {
        let Some(reason) = reason.as_str() else {
            return Err(plan_invalid(format!("{field}[{index}] must be a string.")));
        };
        if !matches!(
            reason,
            "sentence-boundary"
                | "silence-boundary"
                | "vad-confidence"
                | "semantic-boundary"
                | "duration-fit"
                | "manual-override"
        ) {
            return Err(plan_invalid(format!("{field}[{index}] is not supported.")));
        }
    }
    Ok(())
}

fn validate_string_array(value: Option<&Value>, field: &str) -> Result<(), HostError> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Err(plan_invalid(format!(
            "{field} is required and must be an array."
        )));
    };
    for (index, item) in items.iter().enumerate() {
        if !item.is_string() {
            return Err(plan_invalid(format!("{field}[{index}] must be a string.")));
        }
    }
    Ok(())
}

async fn analyze_task(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    let (task, settings, secrets, source_artifact) = {
        let mut guard = state.inner.lock().expect("state lock");
        let current_task = guard
            .tasks
            .get(&task_id)
            .cloned()
            .ok_or_else(|| not_found(&task_id))?;
        reject_if_task_busy(&current_task, "analyze")?;
        let settings = guard.settings.clone();
        let secrets = guard.secrets.clone();
        let source_artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| items.iter().find(|item| item.kind == "source"))
            .cloned();
        if source_artifact.is_none() {
            return Err(bad_request(
                "SOURCE_FILE_REQUIRED",
                "A source file must be uploaded before analysis.".to_string(),
            ));
        }
        push_event(
            &mut guard,
            &task_id,
            "analyze",
            10,
            "Media analysis started.",
        );
        let task = update_task(&mut guard, &task_id, "analyzing", 10, "analyze")?;
        state.persist_task(&guard, &task_id)?;
        (task, settings, secrets, source_artifact)
    };

    let source_artifact = source_artifact.expect("source artifact checked before analysis starts");
    let (source_file_path, source_artifact_id, source_artifact_path) = (
        state.resolve_artifact_path(&settings, &source_artifact.path),
        source_artifact.artifact_id.clone(),
        source_artifact.path.clone(),
    );

    let media_info_artifact_id = format!("{task_id}-media-info");
    let media_info_document = probe_media_info_document(
        &settings,
        &source_file_path,
        &task_id,
        &source_artifact_id,
        &source_artifact_path,
    );
    let stored_media_info = state.write_task_analysis_json(
        &settings,
        &task_id,
        "media-info.json",
        &media_info_document,
    )?;

    let audio_extract_artifact_id = format!("{task_id}-audio-extract");
    let audio_artifact_id = format!("{task_id}-audio-source");
    let audio_target = state.prepare_task_audio_file(&settings, &task_id, "source.wav")?;
    let audio_extract_result = extract_audio_document(AudioExtractRequest {
        settings: &settings,
        source_file_path: &source_file_path,
        audio_file_path: &audio_target.file_path,
        task_id: &task_id,
        source_artifact_id: &source_artifact_id,
        source_artifact_path: &source_artifact_path,
        audio_artifact_id: &audio_artifact_id,
        audio_artifact_path: &audio_target.artifact_path,
    });
    let stored_audio_extract = state.write_task_analysis_json(
        &settings,
        &task_id,
        "audio-extract.json",
        &audio_extract_result.document,
    )?;

    let silence_ranges_artifact_id = format!("{task_id}-silence-ranges");
    let silence_ranges_document = detect_silence_ranges_document(
        &settings,
        &audio_target.file_path,
        &task_id,
        &audio_artifact_id,
        &audio_target.artifact_path,
        audio_extract_result.audio_available,
    );
    let stored_silence_ranges = state.write_task_analysis_json(
        &settings,
        &task_id,
        "silence-ranges.json",
        &silence_ranges_document,
    )?;

    let vad_ranges_artifact_id = format!("{task_id}-vad-ranges");
    let vad_ranges_document = detect_speech_activity_document(
        &settings,
        &audio_target.file_path,
        &task_id,
        &audio_artifact_id,
        &audio_target.artifact_path,
        audio_extract_result.audio_available,
    );
    let stored_vad_ranges = state.write_task_analysis_json(
        &settings,
        &task_id,
        "vad-ranges.json",
        &vad_ranges_document,
    )?;

    let transcript_artifact_id = format!("{task_id}-transcript");
    let transcript_document = transcribe_audio_document_with_http(
        &settings,
        &secrets,
        &audio_target.file_path,
        &task_id,
        &audio_artifact_id,
        &audio_target.artifact_path,
        audio_extract_result.audio_available,
    )
    .await;
    let stored_transcript = state.write_task_analysis_json(
        &settings,
        &task_id,
        "transcript.json",
        &transcript_document,
    )?;

    let semantic_analysis_artifact_id = format!("{task_id}-semantic-analysis");
    let semantic_analysis_document = analyze_semantics_document_with_http(
        &settings,
        &secrets,
        &transcript_document,
        &task_id,
        &transcript_artifact_id,
    )
    .await;
    let stored_semantic_analysis = state.write_task_analysis_json(
        &settings,
        &task_id,
        "semantic-analysis.json",
        &semantic_analysis_document,
    )?;
    let audio_artifact_sha256 = if audio_extract_result.audio_available {
        Some(sha256_file(&audio_target.file_path).map_err(storage_error)?)
    } else {
        None
    };

    let mut guard = state.inner.lock().expect("state lock");
    if let Some(task) = cancelled_task(&guard, &task_id) {
        return Ok(ok(task));
    }
    let plan_artifact_id = format!("{task_id}-plan");
    let plan_document = create_plan(
        &task,
        Some(&media_info_document),
        Some(&media_info_artifact_id),
        Some(&silence_ranges_artifact_id),
        Some(&vad_ranges_artifact_id),
        Some(&transcript_artifact_id),
        Some(&semantic_analysis_artifact_id),
    );
    let (plan_size_bytes, plan_sha256) = json_artifact_metadata(&plan_document)?;
    guard.plans.insert(task_id.clone(), plan_document);
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .retain(|artifact| {
            artifact.artifact_id != media_info_artifact_id
                && artifact.artifact_id != audio_extract_artifact_id
                && artifact.artifact_id != audio_artifact_id
                && artifact.artifact_id != silence_ranges_artifact_id
                && artifact.artifact_id != vad_ranges_artifact_id
                && artifact.artifact_id != transcript_artifact_id
                && artifact.artifact_id != semantic_analysis_artifact_id
                && artifact.artifact_id != plan_artifact_id
        });
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: media_info_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "analysis".to_string(),
            path: stored_media_info.artifact_path,
            size_bytes: stored_media_info.size_bytes,
            sha256: stored_media_info.sha256,
            created_at: fixed_time(),
        });
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: audio_extract_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "analysis".to_string(),
            path: stored_audio_extract.artifact_path,
            size_bytes: stored_audio_extract.size_bytes,
            sha256: stored_audio_extract.sha256,
            created_at: fixed_time(),
        });
    if audio_extract_result.audio_available {
        guard
            .artifacts
            .entry(task_id.clone())
            .or_default()
            .push(VideoCutArtifact {
                artifact_id: audio_artifact_id,
                task_id: task_id.clone(),
                render_id: None,
                kind: "audio".to_string(),
                path: audio_target.artifact_path,
                size_bytes: audio_extract_result.audio_size_bytes,
                sha256: audio_artifact_sha256
                    .clone()
                    .expect("audio hash when audio artifact is available"),
                created_at: fixed_time(),
            });
    }
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: silence_ranges_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "analysis".to_string(),
            path: stored_silence_ranges.artifact_path,
            size_bytes: stored_silence_ranges.size_bytes,
            sha256: stored_silence_ranges.sha256,
            created_at: fixed_time(),
        });
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: vad_ranges_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "analysis".to_string(),
            path: stored_vad_ranges.artifact_path,
            size_bytes: stored_vad_ranges.size_bytes,
            sha256: stored_vad_ranges.sha256,
            created_at: fixed_time(),
        });
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: transcript_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "analysis".to_string(),
            path: stored_transcript.artifact_path,
            size_bytes: stored_transcript.size_bytes,
            sha256: stored_transcript.sha256,
            created_at: fixed_time(),
        });
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: semantic_analysis_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "analysis".to_string(),
            path: stored_semantic_analysis.artifact_path,
            size_bytes: stored_semantic_analysis.size_bytes,
            sha256: stored_semantic_analysis.sha256,
            created_at: fixed_time(),
        });
    guard
        .artifacts
        .entry(task_id.clone())
        .or_default()
        .push(VideoCutArtifact {
            artifact_id: plan_artifact_id,
            task_id: task_id.clone(),
            render_id: None,
            kind: "plan".to_string(),
            path: format!("workspace/projects/default/tasks/{task_id}/plan/plan.json"),
            size_bytes: plan_size_bytes,
            sha256: plan_sha256,
            created_at: fixed_time(),
        });
    push_event(
        &mut guard,
        &task_id,
        "analyze",
        72,
        "Transcript, semantic analysis, and split plan generated.",
    );
    let task = update_task(&mut guard, &task_id, "planReady", 72, "plan")?;
    state.persist_task(&guard, &task_id)?;

    Ok(ok(task))
}

async fn get_task_plan(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<Value>>, HostError> {
    let guard = state.inner.lock().expect("state lock");
    if !guard.tasks.contains_key(&task_id) {
        return Err(not_found(&task_id));
    }

    let plan = guard
        .plans
        .get(&task_id)
        .cloned()
        .ok_or_else(|| task_plan_not_found(&task_id))?;

    Ok(ok(plan))
}

async fn update_task_plan(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
    ApiJson(plan): ApiJson<Value>,
) -> Result<Json<ApiEnvelope<Value>>, HostError> {
    let mut guard = state.inner.lock().expect("state lock");
    require_editable_task(&guard, &task_id)?;
    validate_split_plan_update(&task_id, &plan)?;
    let (plan_size_bytes, plan_sha256) = json_artifact_metadata(&plan)?;
    guard.plans.insert(task_id.clone(), plan.clone());
    let plan_artifact_id = format!("{task_id}-plan");
    let task_artifacts = guard.artifacts.entry(task_id.clone()).or_default();
    task_artifacts.retain(|artifact| artifact.artifact_id != plan_artifact_id);
    task_artifacts.push(VideoCutArtifact {
        artifact_id: plan_artifact_id,
        task_id: task_id.clone(),
        render_id: None,
        kind: "plan".to_string(),
        path: format!("workspace/projects/default/tasks/{task_id}/plan/plan.json"),
        size_bytes: plan_size_bytes,
        sha256: plan_sha256,
        created_at: fixed_time(),
    });
    state.persist_task(&guard, &task_id)?;
    Ok(ok(plan))
}

async fn put_task_transcript(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
    ApiJson(input): ApiJson<ManualTranscriptInput>,
) -> Result<Json<ApiEnvelope<Value>>, HostError> {
    let (settings, audio_artifact_id, audio_artifact_path) = {
        let guard = state.inner.lock().expect("state lock");
        require_editable_task(&guard, &task_id)?;

        let audio_artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| items.iter().find(|item| item.kind == "audio"));
        (
            guard.settings.clone(),
            audio_artifact
                .map(|artifact| artifact.artifact_id.clone())
                .unwrap_or_else(|| format!("{task_id}-audio-source")),
            audio_artifact
                .map(|artifact| artifact.path.clone())
                .unwrap_or_else(|| {
                    format!("workspace/projects/default/tasks/{task_id}/audio/source.wav")
                }),
        )
    };
    let transcript_document = manual_transcript_document(
        &settings,
        &input,
        &task_id,
        &audio_artifact_id,
        &audio_artifact_path,
    )
    .map_err(|message| bad_request("TRANSCRIPT_INVALID", message))?;
    let transcript_artifact_id = format!("{task_id}-transcript");
    let mut guard = state.inner.lock().expect("state lock");
    require_editable_task(&guard, &task_id)?;
    let stored_transcript = state.write_task_analysis_json(
        &settings,
        &task_id,
        "transcript.json",
        &transcript_document,
    )?;
    let transcript_file_path =
        state.resolve_artifact_path(&settings, &stored_transcript.artifact_path);
    let transcript_sha256 = sha256_file(&transcript_file_path)
        .unwrap_or_else(|_| pseudo_hash(&format!("{task_id}-transcript-manual")));
    let task = guard
        .tasks
        .get_mut(&task_id)
        .ok_or_else(|| not_found(&task_id))?;
    task.status = "planReady".to_string();
    task.progress = task.progress.max(74);
    task.current_stage = "transcript".to_string();
    task.updated_at = fixed_time();

    let task_artifacts = guard.artifacts.entry(task_id.clone()).or_default();
    task_artifacts.retain(|artifact| artifact.artifact_id != transcript_artifact_id);
    task_artifacts.push(VideoCutArtifact {
        artifact_id: transcript_artifact_id,
        task_id: task_id.clone(),
        render_id: None,
        kind: "analysis".to_string(),
        path: stored_transcript.artifact_path,
        size_bytes: stored_transcript.size_bytes,
        sha256: transcript_sha256,
        created_at: fixed_time(),
    });
    push_event(
        &mut guard,
        &task_id,
        "transcript",
        74,
        "Manual transcript imported.",
    );
    state.persist_task(&guard, &task_id)?;

    Ok(ok(transcript_document))
}

async fn put_task_subtitle_import(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
    ApiJson(input): ApiJson<SubtitleImportInput>,
) -> Result<Json<ApiEnvelope<Value>>, HostError> {
    let format = normalize_subtitle_format(&input.format)
        .map_err(|message| bad_request("SUBTITLE_FORMAT_INVALID", message))?;
    let (settings, audio_artifact_id, audio_artifact_path) = {
        let guard = state.inner.lock().expect("state lock");
        require_editable_task(&guard, &task_id)?;
        let audio_artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| items.iter().find(|item| item.kind == "audio"))
            .cloned();
        (
            guard.settings.clone(),
            audio_artifact
                .as_ref()
                .map(|artifact| artifact.artifact_id.clone())
                .unwrap_or_else(|| format!("{task_id}-audio-source")),
            audio_artifact
                .as_ref()
                .map(|artifact| artifact.path.clone())
                .unwrap_or_else(|| {
                    format!("workspace/projects/default/tasks/{task_id}/audio/source.wav")
                }),
        )
    };

    let transcript_document = subtitle_import_transcript_document(
        &settings,
        &input,
        &task_id,
        &audio_artifact_id,
        &audio_artifact_path,
    )
    .map_err(|message| bad_request("SUBTITLE_INVALID", message))?;
    let transcript_artifact_id = format!("{task_id}-transcript");
    let mut guard = state.inner.lock().expect("state lock");
    require_editable_task(&guard, &task_id)?;
    let stored_transcript = state.write_task_analysis_json(
        &settings,
        &task_id,
        "transcript.json",
        &transcript_document,
    )?;
    let transcript_file_path =
        state.resolve_artifact_path(&settings, &stored_transcript.artifact_path);
    let transcript_sha256 = sha256_file(&transcript_file_path)
        .unwrap_or_else(|_| pseudo_hash(&format!("{task_id}-subtitle-import-{format}")));
    let task = guard
        .tasks
        .get_mut(&task_id)
        .ok_or_else(|| not_found(&task_id))?;
    task.status = "planReady".to_string();
    task.progress = task.progress.max(74);
    task.current_stage = "subtitle".to_string();
    task.updated_at = fixed_time();

    let task_artifacts = guard.artifacts.entry(task_id.clone()).or_default();
    task_artifacts.retain(|artifact| artifact.artifact_id != transcript_artifact_id);
    task_artifacts.push(VideoCutArtifact {
        artifact_id: transcript_artifact_id,
        task_id: task_id.clone(),
        render_id: None,
        kind: "analysis".to_string(),
        path: stored_transcript.artifact_path,
        size_bytes: stored_transcript.size_bytes,
        sha256: transcript_sha256,
        created_at: fixed_time(),
    });
    push_event(
        &mut guard,
        &task_id,
        "subtitle",
        74,
        &format!("Subtitle {format} imported."),
    );
    state.persist_task(&guard, &task_id)?;

    Ok(ok(transcript_document))
}

async fn get_task_subtitle_export(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
    ApiQuery(query): ApiQuery<SubtitleExportQuery>,
) -> Result<Json<ApiEnvelope<SubtitleExportOutput>>, HostError> {
    let format = normalize_subtitle_format(query.format.as_deref().unwrap_or("srt"))
        .map_err(|message| bad_request("SUBTITLE_FORMAT_INVALID", message))?;
    let (settings, transcript_artifact) = {
        let guard = state.inner.lock().expect("state lock");
        require_editable_task(&guard, &task_id)?;
        let transcript_artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item.path.ends_with("/analysis/transcript.json"))
            })
            .cloned()
            .ok_or_else(|| {
                bad_request(
                    "TRANSCRIPT_REQUIRED",
                    "Transcript or imported subtitle must be available before subtitle export."
                        .to_string(),
                )
            })?;
        (guard.settings.clone(), transcript_artifact)
    };

    let transcript_path = state.resolve_artifact_path(&settings, &transcript_artifact.path);
    let transcript_document = std::fs::read_to_string(&transcript_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .ok_or_else(|| {
            bad_request(
                "TRANSCRIPT_INVALID",
                "Transcript artifact is not readable JSON.".to_string(),
            )
        })?;
    let content = export_transcript_document(&transcript_document, &format)
        .map_err(|message| bad_request("SUBTITLE_EXPORT_INVALID", message))?;
    let file_name = format!("subtitles-export.{format}");
    let artifact_id = format!("{task_id}-subtitle-export-{format}");

    let mut guard = state.inner.lock().expect("state lock");
    require_editable_task(&guard, &task_id)?;
    let stored_export =
        state.write_task_analysis_text(&settings, &task_id, &file_name, &content)?;
    upsert_task_artifact(
        &mut guard,
        &task_id,
        VideoCutArtifact {
            artifact_id: artifact_id.clone(),
            task_id: task_id.clone(),
            render_id: None,
            kind: "subtitle".to_string(),
            path: stored_export.artifact_path.clone(),
            size_bytes: stored_export.size_bytes,
            sha256: stored_export.sha256,
            created_at: fixed_time(),
        },
    );
    push_event(
        &mut guard,
        &task_id,
        "subtitle",
        76,
        &format!("Subtitle {format} exported."),
    );
    state.persist_task(&guard, &task_id)?;

    Ok(ok(SubtitleExportOutput {
        format,
        content,
        artifact_id,
        path: stored_export.artifact_path,
    }))
}

async fn render_task(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    render_task_with_selection(state, task_id, RenderSelection::FirstSegment).await
}

async fn render_task_batch(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    render_task_with_selection(state, task_id, RenderSelection::AllSegments).await
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum RenderSelection {
    FirstSegment,
    AllSegments,
}

async fn render_task_with_selection(
    state: AppState,
    task_id: String,
    selection: RenderSelection,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    let (settings, selected_plans, source_artifact, transcript_artifact, render_ids) = {
        let mut guard = state.inner.lock().expect("state lock");
        let current_task = guard
            .tasks
            .get(&task_id)
            .cloned()
            .ok_or_else(|| not_found(&task_id))?;
        reject_if_task_busy(&current_task, "render")?;
        let plan = guard
            .plans
            .get(&task_id)
            .cloned()
            .ok_or_else(|| not_found(&task_id))?;
        let selected_plans = render_plans_for_selection(&plan, selection)?;
        let source_artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| items.iter().find(|item| item.kind == "source"))
            .cloned()
            .ok_or_else(|| {
                bad_request(
                    "SOURCE_FILE_REQUIRED",
                    "A source file must be uploaded before rendering.".to_string(),
                )
            })?;
        let transcript_artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item.path.ends_with("/analysis/transcript.json"))
            })
            .cloned();
        let render_attempt = guard
            .artifacts
            .get(&task_id)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.render_id.clone())
                    .collect::<BTreeSet<_>>()
                    .len()
                    + 1
            })
            .unwrap_or(1);
        let render_ids = (0..selected_plans.len())
            .map(|index| format!("{task_id}-render-{}", render_attempt + index))
            .collect::<Vec<_>>();
        let start_message = if selection == RenderSelection::AllSegments {
            format!(
                "Batch FFmpeg render started for {} segments.",
                selected_plans.len()
            )
        } else {
            "FFmpeg render started.".to_string()
        };
        push_event(&mut guard, &task_id, "render", 80, &start_message);
        let _ = update_task(&mut guard, &task_id, "rendering", 80, "render")?;
        state.persist_task(&guard, &task_id)?;

        (
            guard.settings.clone(),
            selected_plans,
            source_artifact,
            transcript_artifact,
            render_ids,
        )
    };

    let source_file_path = state.resolve_artifact_path(&settings, &source_artifact.path);
    let transcript_document = transcript_artifact
        .as_ref()
        .and_then(|artifact| {
            std::fs::read_to_string(state.resolve_artifact_path(&settings, &artifact.path)).ok()
        })
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let audio_assets = selected_plans
        .first()
        .map(|plan| select_render_audio_assets_for_plan(&settings, Some(plan)))
        .unwrap_or_else(|| select_render_audio_assets_for_plan(&settings, None));

    for (index, (plan, render_id)) in selected_plans.iter().zip(render_ids.iter()).enumerate() {
        if let Some(task) = {
            let guard = state.inner.lock().expect("state lock");
            cancelled_task(&guard, &task_id)
        } {
            return Ok(ok(task));
        }
        let render_files = state.prepare_task_render_files(&settings, &task_id, render_id)?;
        let render_result = render_subtitle_ass(RenderSubtitleRequest {
            settings: &settings,
            plan,
            transcript_document: transcript_document.as_ref(),
            task_id: &task_id,
            render_id,
            subtitle_file_path: &render_files.subtitle_file_path,
        })
        .and_then(|subtitle_result| {
            let video_result = render_video_cut(RenderVideoRequest {
                settings: &settings,
                plan,
                task_id: &task_id,
                render_id,
                source_file_path: &source_file_path,
                output_file_path: &render_files.output_file_path,
                subtitle_file_path: Some(&render_files.subtitle_file_path),
                log_file_path: &render_files.log_file_path,
                source_artifact_id: &source_artifact.artifact_id,
                source_artifact_path: &source_artifact.path,
                output_artifact_path: &render_files.output_artifact_path,
                subtitle_artifact_path: Some(&render_files.subtitle_artifact_path),
                audio_assets: &audio_assets,
            })?;
            let cover_result = render_cover_png(RenderCoverRequest {
                settings: &settings,
                plan,
                source_file_path: &source_file_path,
                cover_file_path: &render_files.cover_file_path,
            })?;
            let manifest_result = write_render_attempt_manifest(RenderAttemptManifestRequest {
                plan,
                task_id: &task_id,
                render_id,
                source_artifact_id: &source_artifact.artifact_id,
                transcript_artifact_id: transcript_artifact
                    .as_ref()
                    .map(|artifact| artifact.artifact_id.as_str()),
                output_artifact_id: &format!("{render_id}-output"),
                subtitle_artifact_id: &format!("{render_id}-subtitle"),
                cover_artifact_id: &format!("{render_id}-cover"),
                log_artifact_id: &format!("{render_id}-log"),
                manifest_file_path: &render_files.manifest_file_path,
                subtitle_burn_in: true,
                subtitle_cue_count: subtitle_result.cue_count,
                audio_assets: &audio_assets,
            })?;

            Ok((video_result, subtitle_result, cover_result, manifest_result))
        });

        match render_result {
            Ok((render_result, subtitle_result, cover_result, manifest_result)) => {
                let mut guard = state.inner.lock().expect("state lock");
                if let Some(task) = cancelled_task(&guard, &task_id) {
                    return Ok(ok(task));
                }
                upsert_task_artifact(
                    &mut guard,
                    &task_id,
                    VideoCutArtifact {
                        artifact_id: format!("{render_id}-output"),
                        task_id: task_id.clone(),
                        render_id: Some(render_id.clone()),
                        kind: "render".to_string(),
                        path: render_files.output_artifact_path,
                        size_bytes: render_result.output_size_bytes,
                        sha256: render_result.output_sha256,
                        created_at: fixed_time(),
                    },
                );
                upsert_task_artifact(
                    &mut guard,
                    &task_id,
                    VideoCutArtifact {
                        artifact_id: format!("{render_id}-subtitle"),
                        task_id: task_id.clone(),
                        render_id: Some(render_id.clone()),
                        kind: "subtitle".to_string(),
                        path: render_files.subtitle_artifact_path,
                        size_bytes: subtitle_result.subtitle_size_bytes,
                        sha256: subtitle_result.subtitle_sha256,
                        created_at: fixed_time(),
                    },
                );
                upsert_task_artifact(
                    &mut guard,
                    &task_id,
                    VideoCutArtifact {
                        artifact_id: format!("{render_id}-cover"),
                        task_id: task_id.clone(),
                        render_id: Some(render_id.clone()),
                        kind: "cover".to_string(),
                        path: render_files.cover_artifact_path,
                        size_bytes: cover_result.cover_size_bytes,
                        sha256: cover_result.cover_sha256,
                        created_at: fixed_time(),
                    },
                );
                upsert_task_artifact(
                    &mut guard,
                    &task_id,
                    VideoCutArtifact {
                        artifact_id: format!("{render_id}-manifest"),
                        task_id: task_id.clone(),
                        render_id: Some(render_id.clone()),
                        kind: "render-manifest".to_string(),
                        path: render_files.manifest_artifact_path,
                        size_bytes: manifest_result.manifest_size_bytes,
                        sha256: manifest_result.manifest_sha256,
                        created_at: fixed_time(),
                    },
                );
                upsert_task_artifact(
                    &mut guard,
                    &task_id,
                    VideoCutArtifact {
                        artifact_id: format!("{render_id}-log"),
                        task_id: task_id.clone(),
                        render_id: Some(render_id.clone()),
                        kind: "log".to_string(),
                        path: render_files.log_artifact_path,
                        size_bytes: render_result.log_size_bytes,
                        sha256: render_result.log_sha256,
                        created_at: fixed_time(),
                    },
                );
                state.persist_task(&guard, &task_id)?;
            }
            Err(error) => {
                let mut guard = state.inner.lock().expect("state lock");
                if let Some(task) = cancelled_task(&guard, &task_id) {
                    return Ok(ok(task));
                }
                if render_files.log_file_path.is_file()
                    && let Ok(metadata) = std::fs::metadata(&render_files.log_file_path)
                {
                    upsert_task_artifact(
                        &mut guard,
                        &task_id,
                        VideoCutArtifact {
                            artifact_id: format!("{render_id}-log"),
                            task_id: task_id.clone(),
                            render_id: Some(render_id.clone()),
                            kind: "log".to_string(),
                            path: render_files.log_artifact_path,
                            size_bytes: metadata.len(),
                            sha256: sha256_file(&render_files.log_file_path)
                                .unwrap_or_else(|_| pseudo_hash(&format!("{render_id}-log"))),
                            created_at: fixed_time(),
                        },
                    );
                }
                let message = if selection == RenderSelection::AllSegments {
                    format!(
                        "Batch render failed on segment {}/{}: {error}",
                        index + 1,
                        selected_plans.len()
                    )
                } else {
                    error.clone()
                };
                push_event_with_metadata(
                    &mut guard,
                    &task_id,
                    "render",
                    100,
                    &message,
                    Some("error"),
                    Some(render_failure_recovery_metadata()),
                );
                let _ = update_task(&mut guard, &task_id, "failed", 100, "render")?;
                state.persist_task(&guard, &task_id)?;
                return Err(render_error(error));
            }
        }
    }

    let mut guard = state.inner.lock().expect("state lock");
    if let Some(task) = cancelled_task(&guard, &task_id) {
        return Ok(ok(task));
    }
    let final_message = if selection == RenderSelection::AllSegments {
        format!(
            "Batch rendered {} segments into MP4, subtitles, covers, manifests, and logs.",
            selected_plans.len()
        )
    } else {
        "Rendered MP4, subtitles, cover, and render log.".to_string()
    };
    push_event(&mut guard, &task_id, "render", 100, &final_message);
    let task = update_task(&mut guard, &task_id, "succeeded", 100, "artifact")?;
    state.persist_task(&guard, &task_id)?;

    Ok(ok(task))
}

fn render_plans_for_selection(
    plan: &Value,
    selection: RenderSelection,
) -> Result<Vec<Value>, HostError> {
    match selection {
        RenderSelection::FirstSegment => Ok(vec![plan.clone()]),
        RenderSelection::AllSegments => {
            let segments = plan
                .get("segments")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    bad_request(
                        "PLAN_SEGMENTS_REQUIRED",
                        "Render plan must contain at least one segment.".to_string(),
                    )
                })?;
            if segments.is_empty() {
                return Err(bad_request(
                    "PLAN_SEGMENTS_REQUIRED",
                    "Render plan must contain at least one segment.".to_string(),
                ));
            }

            Ok(segments
                .iter()
                .map(|segment| {
                    let mut selected_plan = plan.clone();
                    selected_plan["segments"] = Value::Array(vec![segment.clone()]);
                    selected_plan
                })
                .collect())
        }
    }
}

fn upsert_task_artifact(guard: &mut HostState, task_id: &str, artifact: VideoCutArtifact) {
    let task_artifacts = guard.artifacts.entry(task_id.to_string()).or_default();
    task_artifacts.retain(|item| item.artifact_id != artifact.artifact_id);
    task_artifacts.push(artifact);
}

fn dedupe_artifacts_by_id(artifacts: Vec<VideoCutArtifact>) -> Vec<VideoCutArtifact> {
    let mut unique = Vec::new();

    for artifact in artifacts {
        if let Some(index) = unique
            .iter()
            .position(|item: &VideoCutArtifact| item.artifact_id == artifact.artifact_id)
        {
            unique.remove(index);
        }
        unique.push(artifact);
    }

    unique
}

async fn cancel_task(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<VideoCutTask>>, HostError> {
    let mut guard = state.inner.lock().expect("state lock");
    let task = guard
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| not_found(&task_id))?;
    reject_if_task_terminal(&task)?;
    let progress = task.progress;
    let task = update_task(&mut guard, &task_id, "cancelled", progress, "cancelled")?;
    push_event(
        &mut guard,
        &task_id,
        "cancelled",
        task.progress,
        "Task cancelled by user.",
    );
    state.persist_task(&guard, &task_id)?;

    Ok(ok(task))
}

async fn get_task_events(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<Vec<VideoCutProgressEvent>>>, HostError> {
    let guard = state.inner.lock().expect("state lock");
    if !guard.tasks.contains_key(&task_id) {
        return Err(not_found(&task_id));
    }

    Ok(ok(guard.events.get(&task_id).cloned().unwrap_or_default()))
}

async fn get_task_artifacts(
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<String>,
) -> Result<Json<ApiEnvelope<Vec<VideoCutArtifact>>>, HostError> {
    let guard = state.inner.lock().expect("state lock");
    if !guard.tasks.contains_key(&task_id) {
        return Err(not_found(&task_id));
    }

    Ok(ok(dedupe_artifacts_by_id(
        guard.artifacts.get(&task_id).cloned().unwrap_or_default(),
    )))
}

async fn get_artifact_download(
    State(state): State<AppState>,
    ApiPath((task_id, artifact_id)): ApiPath<(String, String)>,
) -> Result<Json<ApiEnvelope<ArtifactDownloadDescriptor>>, HostError> {
    let guard = state.inner.lock().expect("state lock");
    if !guard.tasks.contains_key(&task_id) {
        return Err(not_found(&task_id));
    }

    let artifact = guard
        .artifacts
        .get(&task_id)
        .and_then(|items| items.iter().find(|item| item.artifact_id == artifact_id))
        .cloned()
        .ok_or_else(|| artifact_not_found(&task_id, &artifact_id))?;

    Ok(ok(ArtifactDownloadDescriptor {
        artifact_id: artifact.artifact_id,
        task_id: artifact.task_id,
        path: artifact.path.clone(),
        size_bytes: artifact.size_bytes,
        sha256: artifact.sha256,
        content_type: infer_content_type(&artifact.path),
        download_mode: "host-content-endpoint".to_string(),
        url: format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{artifact_id}/content"),
    }))
}

async fn get_artifact_content(
    State(state): State<AppState>,
    ApiPath((task_id, artifact_id)): ApiPath<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, HostError> {
    let (settings, artifact) = {
        let guard = state.inner.lock().expect("state lock");
        if !guard.tasks.contains_key(&task_id) {
            return Err(not_found(&task_id));
        }

        let artifact = guard
            .artifacts
            .get(&task_id)
            .and_then(|items| items.iter().find(|item| item.artifact_id == artifact_id))
            .cloned()
            .ok_or_else(|| artifact_not_found(&task_id, &artifact_id))?;

        (guard.settings.clone(), artifact)
    };

    if !is_workspace_task_artifact_path(&artifact.path, &task_id) {
        return Err(bad_request(
            "ARTIFACT_PATH_INVALID",
            "Artifact content can only be served from the task workspace.".to_string(),
        ));
    }

    let file_path = state.resolve_artifact_path(&settings, &artifact.path);
    if !file_path.is_file() {
        return Err(artifact_content_not_found(&task_id, &artifact_id));
    }

    let total_size = std::fs::metadata(&file_path)
        .map_err(|_| artifact_content_not_found(&task_id, &artifact_id))?
        .len();
    let content_type = infer_content_type(&artifact.path);
    let content_disposition = content_disposition(&artifact.path);
    if let Some(range_header) = headers.get(RANGE).and_then(|value| value.to_str().ok()) {
        let byte_range = match parse_byte_range(range_header, total_size) {
            Ok(range) => range,
            Err(_) => {
                return range_not_satisfiable_response(total_size);
            }
        };
        let mut file = tokio::fs::File::open(&file_path)
            .await
            .map_err(|_| artifact_content_not_found(&task_id, &artifact_id))?;
        file.seek(SeekFrom::Start(byte_range.start))
            .await
            .map_err(|_| artifact_content_not_found(&task_id, &artifact_id))?;
        let stream = ReaderStream::new(file.take(byte_range.length()));
        return Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(CONTENT_TYPE, content_type)
            .header(ACCEPT_RANGES, "bytes")
            .header(CONTENT_RANGE, byte_range.content_range(total_size))
            .header(CONTENT_LENGTH, byte_range.length().to_string())
            .header(CONTENT_DISPOSITION, content_disposition)
            .header(CACHE_CONTROL, "private, no-store")
            .header(PRAGMA, "no-cache")
            .header("x-content-type-options", "nosniff")
            .body(Body::from_stream(stream))
            .map_err(|error| {
                bad_request(
                    "ARTIFACT_RESPONSE_INVALID",
                    format!("Unable to build artifact content response: {error}"),
                )
            });
    }

    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|_| artifact_content_not_found(&task_id, &artifact_id))?;
    let stream = ReaderStream::new(file);
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_LENGTH, total_size.to_string())
        .header(CONTENT_DISPOSITION, content_disposition)
        .header(CACHE_CONTROL, "private, no-store")
        .header(PRAGMA, "no-cache")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .map_err(|error| {
            bad_request(
                "ARTIFACT_RESPONSE_INVALID",
                format!("Unable to build artifact content response: {error}"),
            )
        })
}

#[derive(Clone, Copy)]
struct ByteRange {
    start: u64,
    end: u64,
}

impl ByteRange {
    fn content_range(self, total_size: u64) -> String {
        format!("bytes {}-{}/{}", self.start, self.end, total_size)
    }

    fn length(self) -> u64 {
        self.end - self.start + 1
    }
}

fn parse_byte_range(header_value: &str, total_size: u64) -> Result<ByteRange, ()> {
    if total_size == 0 {
        return Err(());
    }

    let spec = header_value.trim().strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') {
        return Err(());
    }

    let (raw_start, raw_end) = spec.split_once('-').ok_or(())?;
    if raw_start.is_empty() {
        let suffix_length = raw_end.parse::<u64>().map_err(|_| ())?;
        if suffix_length == 0 {
            return Err(());
        }
        let start = total_size.saturating_sub(suffix_length);
        return Ok(ByteRange {
            start,
            end: total_size - 1,
        });
    }

    let start = raw_start.parse::<u64>().map_err(|_| ())?;
    let end = if raw_end.is_empty() {
        total_size - 1
    } else {
        raw_end.parse::<u64>().map_err(|_| ())?.min(total_size - 1)
    };

    if start > end || start >= total_size {
        return Err(());
    }

    Ok(ByteRange { start, end })
}

fn range_not_satisfiable_response(total_size: u64) -> Result<Response, HostError> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_RANGE, format!("bytes */{total_size}"))
        .header(CACHE_CONTROL, "private, no-store")
        .header(PRAGMA, "no-cache")
        .header("x-content-type-options", "nosniff")
        .body(Body::empty())
        .map_err(|error| {
            bad_request(
                "ARTIFACT_RESPONSE_INVALID",
                format!("Unable to build artifact range response: {error}"),
            )
        })
}

fn infer_content_type(path: &str) -> String {
    if path.ends_with(".mp4") {
        return "video/mp4".to_string();
    }

    if path.ends_with(".ass") {
        return "text/x-ssa".to_string();
    }

    if path.ends_with(".srt") {
        return "application/x-subrip".to_string();
    }

    if path.ends_with(".vtt") {
        return "text/vtt".to_string();
    }

    if path.ends_with(".wav") {
        return "audio/wav".to_string();
    }

    if path.ends_with(".png") {
        return "image/png".to_string();
    }

    if path.ends_with(".json") {
        return "application/json".to_string();
    }

    if path.ends_with(".log") || path.ends_with(".txt") {
        return "text/plain".to_string();
    }

    "application/octet-stream".to_string()
}

fn is_workspace_task_artifact_path(path: &str, task_id: &str) -> bool {
    path.starts_with(&format!("workspace/projects/default/tasks/{task_id}/"))
        && !path.contains("..")
        && !path.contains('\\')
}

fn content_disposition(path: &str) -> String {
    let file_name = path.rsplit('/').next().unwrap_or("artifact.bin");
    let mode = if path.ends_with(".mp4") || path.ends_with(".wav") || path.ends_with(".png") {
        "inline"
    } else {
        "attachment"
    };

    format!("{mode}; filename=\"{}\"", file_name.replace('"', "_"))
}

fn provider_conformance_report_from_settings(
    settings: &Value,
    target: &ProviderConformanceTarget,
) -> ProviderConformanceReport {
    match target {
        ProviderConformanceTarget::Ai => openai_compatible_conformance_report(
            &ai_provider_config(settings),
            &[ProviderKind::LargeLanguageModel],
        ),
        ProviderConformanceTarget::SpeechToText => {
            speech_to_text_conformance_report(&speech_to_text_provider_config(settings))
        }
        ProviderConformanceTarget::All => {
            let ai_report = openai_compatible_conformance_report(
                &ai_provider_config(settings),
                &[ProviderKind::LargeLanguageModel],
            );
            let stt_report =
                speech_to_text_conformance_report(&speech_to_text_provider_config(settings));

            merge_provider_reports("runtime-openai-compatible", vec![ai_report, stt_report])
        }
    }
}

fn merge_provider_reports(
    provider_id: &str,
    reports: Vec<ProviderConformanceReport>,
) -> ProviderConformanceReport {
    let status = if reports.iter().any(|report| report.status == "fail") {
        "fail"
    } else {
        "ok"
    };
    let checks = reports
        .into_iter()
        .flat_map(|report| report.checks)
        .collect::<Vec<ProviderConformanceCheck>>();

    ProviderConformanceReport {
        report_version: "video-cut.provider-conformance.v1".to_string(),
        provider_id: provider_id.to_string(),
        status: status.to_string(),
        generated_at: fixed_time(),
        checks,
    }
}

fn ai_provider_config(settings: &Value) -> OpenAiCompatibleProviderConfig {
    OpenAiCompatibleProviderConfig {
        provider_id: "runtime-openai-compatible-ai".to_string(),
        base_url: string_at(settings, "/ai/baseUrl"),
        api_key_secret_ref: secret_ref_if_configured(
            bool_at(settings, "/ai/apiKeyConfigured"),
            "settings://ai/api-key",
        ),
        chat_model: Some(string_at(settings, "/ai/chatModel")),
        transcription_model: None,
        structured_output_mode: structured_output_mode_at(settings),
        timeout_seconds: u16_at(settings, "/ai/timeoutSeconds", 45),
        retry_count: u8_at(settings, "/ai/retryCount", 2),
    }
}

fn speech_to_text_provider_config(settings: &Value) -> SpeechToTextProviderConfig {
    speech_to_text_provider_config_from_settings(settings)
}

fn secret_ref_if_configured(configured: bool, secret_ref: &str) -> Option<String> {
    if configured {
        Some(secret_ref.to_string())
    } else {
        None
    }
}

fn structured_output_mode_at(settings: &Value) -> StructuredOutputMode {
    match string_at(settings, "/ai/structuredOutputMode").as_str() {
        "json-object-fallback" => StructuredOutputMode::JsonObjectFallback,
        _ => StructuredOutputMode::JsonSchema,
    }
}

fn string_at(settings: &Value, pointer: &str) -> String {
    settings
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn bool_at(settings: &Value, pointer: &str) -> bool {
    settings
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn u16_at(settings: &Value, pointer: &str, fallback: u16) -> u16 {
    settings
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(fallback)
}

fn u64_at(settings: &Value, pointer: &str, fallback: u64) -> u64 {
    settings
        .pointer(pointer)
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
}

fn u8_at(settings: &Value, pointer: &str, fallback: u8) -> u8 {
    settings
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
        .unwrap_or(fallback)
}

fn ok<T>(data: T) -> Json<ApiEnvelope<T>>
where
    T: Serialize,
{
    Json(ApiEnvelope { ok: true, data })
}
