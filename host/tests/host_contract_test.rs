use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

use sdkwork_video_cut_host::{create_app, create_persistent_app};

fn temp_workspace(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-{name}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("workspace");
    path
}

fn generate_test_mp4(path: &Path, duration_seconds: u32) {
    let status = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("testsrc2=size=320x240:rate=30")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("anullsrc=r=16000:cl=mono")
        .arg("-t")
        .arg(duration_seconds.to_string())
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-shortest")
        .arg(path)
        .status()
        .expect("ffmpeg fixture command");
    assert!(status.success(), "ffmpeg should generate test mp4");
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn generate_black_mp4(path: &Path, duration_seconds: u32) {
    let status = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("color=c=black:s=320x240:r=30")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("anullsrc=r=16000:cl=mono")
        .arg("-t")
        .arg(duration_seconds.to_string())
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-shortest")
        .arg(path)
        .status()
        .expect("ffmpeg black fixture command");
    assert!(status.success(), "ffmpeg should generate black mp4");
}

fn generate_test_wav(path: &Path, frequency: u32, duration_seconds: u32) {
    let status = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg(format!("sine=frequency={frequency}:sample_rate=16000"))
        .arg("-t")
        .arg(duration_seconds.to_string())
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(path)
        .status()
        .expect("ffmpeg wav fixture command");
    assert!(status.success(), "ffmpeg should generate test wav");
}

fn count_bright_pixels_in_bottom_third(path: &Path) -> usize {
    let output = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg("0.700")
        .arg("-i")
        .arg(path)
        .arg("-vf")
        .arg("crop=iw:ih/3:0:ih*2/3,scale=96:96")
        .arg("-frames:v")
        .arg("1")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgb24")
        .arg("-")
        .output()
        .expect("ffmpeg frame sample command");
    assert!(
        output.status.success(),
        "ffmpeg should sample rendered frame"
    );

    output
        .stdout
        .chunks_exact(3)
        .filter(|pixel| pixel.iter().any(|channel| *channel > 32))
        .count()
}

fn multipart_file_body(
    boundary: &str,
    file_name: &str,
    content_type: &str,
    bytes: &[u8],
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

async fn request_json(
    app: &Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(match body {
            Some(value) => Body::from(value.to_string()),
            None => Body::empty(),
        })
        .expect("request");

    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    let json: Value = serde_json::from_slice(&bytes).expect("json body");

    (status, json)
}

async fn request_raw(
    app: &Router,
    method: Method,
    uri: &str,
    content_type: &str,
    body: &str,
) -> (StatusCode, HeaderMap, String) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", content_type)
        .body(Body::from(body.to_string()))
        .expect("request");

    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    let body = String::from_utf8(bytes.to_vec()).expect("utf8 body");

    (status, headers, body)
}

async fn request_multipart_json(
    app: &Router,
    uri: &str,
    boundary: &str,
    body: Vec<u8>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .expect("request");

    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    let json: Value = serde_json::from_slice(&bytes).expect("json body");

    (status, json)
}

async fn request_bytes(
    app: &Router,
    method: Method,
    uri: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    request_bytes_with_headers(app, method, uri, &[]).await
}

async fn request_bytes_with_headers(
    app: &Router,
    method: Method,
    uri: &str,
    headers: &[(&str, &str)],
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut request_builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        request_builder = request_builder.header(*name, *value);
    }
    let request = request_builder.body(Body::empty()).expect("request");

    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes")
        .to_vec();

    (status, headers, bytes)
}

fn assert_private_artifact_security_headers(headers: &HeaderMap) {
    assert_eq!(
        headers
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("private, no-store")
    );
    assert_eq!(
        headers.get("pragma").and_then(|value| value.to_str().ok()),
        Some("no-cache")
    );
    assert_eq!(
        headers
            .get("x-content-type-options")
            .and_then(|value| value.to_str().ok()),
        Some("nosniff")
    );
}

async fn upload_test_source_mp4(
    app: &Router,
    workspace_root: &Path,
    task_id: &str,
    boundary: &str,
) {
    let source_fixture = workspace_root.join(format!("{boundary}.mp4"));
    generate_test_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let upload_body = multipart_file_body(boundary, "source.mp4", "video/mp4", &source_bytes);
    let (upload_status, upload_response) = request_multipart_json(
        app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        upload_body,
    )
    .await;

    assert_eq!(upload_status, StatusCode::OK);
    assert_eq!(upload_response["data"]["kind"], "source");
}

async fn upload_source_file(
    app: &Router,
    task_id: &str,
    boundary: &str,
    file_name: &str,
    content_type: &str,
    source_bytes: Vec<u8>,
) {
    let upload_body = multipart_file_body(boundary, file_name, content_type, &source_bytes);
    let (upload_status, upload_response) = request_multipart_json(
        app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        upload_body,
    )
    .await;

    assert_eq!(upload_status, StatusCode::OK);
    assert_eq!(upload_response["data"]["kind"], "source");
}

#[tokio::test]
async fn uploads_source_files_larger_than_axum_default_body_limit() {
    let app = create_app();
    let (create_status, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "large local upload",
            "type": "single-speaker"
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::OK);
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let source_bytes = vec![7_u8; 3 * 1024 * 1024];
    let boundary = "large-upload-boundary";
    let upload_body = multipart_file_body(boundary, "large-local.mp4", "video/mp4", &source_bytes);
    let (upload_status, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        upload_body,
    )
    .await;

    assert_eq!(upload_status, StatusCode::OK);
    assert_eq!(upload_response["data"]["kind"], "source");
    assert_eq!(
        upload_response["data"]["sizeBytes"],
        source_bytes.len() as u64
    );
}

#[test]
fn upload_handler_streams_multipart_file_chunks_before_enforcing_size_limit() {
    let source = include_str!("../src/lib.rs");
    let (_, upload_handler) = source
        .split_once("async fn upload_task_source_file")
        .expect("upload handler");
    let upload_handler = upload_handler
        .split_once("\nasync fn analyze_task")
        .expect("next handler")
        .0;

    assert!(
        upload_handler.contains(".chunk()"),
        "source upload must read multipart data incrementally"
    );
    assert!(
        !upload_handler.contains(".bytes()\n"),
        "source upload must not buffer the complete multipart file before size validation"
    );
    assert!(
        source.contains("tokio::fs::try_exists"),
        "source upload must use async filesystem checks in the upload path"
    );
    assert!(
        !upload_handler.contains(".file_path.exists()"),
        "source upload must not run blocking Path::exists checks inside the async handler"
    );
}

#[test]
fn artifact_content_endpoint_streams_full_file_responses() {
    let source = include_str!("../src/lib.rs");
    let (_, artifact_handler) = source
        .split_once("async fn get_artifact_content")
        .expect("artifact content handler");
    let artifact_handler = artifact_handler
        .split_once("\n#[derive(Clone, Copy)]")
        .expect("byte range type")
        .0;

    assert!(
        artifact_handler.contains("Body::from_stream"),
        "full artifact responses must stream from disk instead of allocating the whole file"
    );
    assert!(
        !artifact_handler.contains("std::fs::read(&file_path)"),
        "full artifact responses must not read the whole artifact into memory"
    );
}

#[test]
fn write_handlers_recheck_task_editability_immediately_before_publishing_files() {
    let source = include_str!("../src/lib.rs");
    let (_, upload_handler) = source
        .split_once("async fn upload_task_source_file")
        .expect("upload handler");
    let upload_handler = upload_handler
        .split_once("\nfn validate_source_media_type")
        .expect("source validation")
        .0;
    let upload_rechecks = upload_handler.matches("require_editable_task").count();
    assert!(
        upload_rechecks >= 2,
        "source upload must re-check task editability after streaming the file and before publishing it"
    );

    let (_, transcript_handler) = source
        .split_once("async fn put_task_transcript")
        .expect("transcript handler");
    let transcript_handler = transcript_handler
        .split_once("\nasync fn put_task_subtitle_import")
        .expect("subtitle import handler")
        .0;
    let transcript_guard_position = transcript_handler
        .find("let mut guard = state.inner.lock()")
        .expect("transcript final guard");
    let transcript_write_position = transcript_handler
        .find("state.write_task_analysis_json")
        .expect("transcript artifact write");
    assert!(
        transcript_guard_position < transcript_write_position,
        "manual transcript import must re-check task editability before replacing transcript.json"
    );

    let (_, subtitle_handler) = source
        .split_once("async fn put_task_subtitle_import")
        .expect("subtitle import handler");
    let subtitle_handler = subtitle_handler
        .split_once("\nasync fn get_task_subtitle_export")
        .expect("subtitle export handler")
        .0;
    let subtitle_guard_position = subtitle_handler
        .find("let mut guard = state.inner.lock()")
        .expect("subtitle final guard");
    let subtitle_write_position = subtitle_handler
        .find("state.write_task_analysis_json")
        .expect("subtitle artifact write");
    assert!(
        subtitle_guard_position < subtitle_write_position,
        "subtitle import must re-check task editability before replacing transcript.json"
    );
}

#[tokio::test]
async fn create_task_without_source_does_not_publish_fake_source_artifact() {
    let app = create_app();

    let (create_status, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "empty task",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    assert_eq!(create_status, StatusCode::OK);
    assert_eq!(create_response["data"]["status"], "draft");
    assert_eq!(create_response["data"]["progress"], 0);
    assert_eq!(create_response["data"]["currentStage"], "draft");
    assert!(create_response["data"]["sourceName"].is_null());

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    assert!(
        artifacts_response["data"]
            .as_array()
            .expect("artifacts")
            .iter()
            .all(|artifact| artifact["kind"] != "source")
    );
}

#[tokio::test]
async fn list_tasks_returns_a_stable_most_recent_first_order() {
    let app = create_app();
    let (_, first_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "first task",
            "type": "single-speaker"
        })),
    )
    .await;
    let (_, second_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "second task",
            "type": "single-speaker"
        })),
    )
    .await;
    let first_task_id = first_response["data"]["taskId"]
        .as_str()
        .expect("first task id");
    let second_task_id = second_response["data"]["taskId"]
        .as_str()
        .expect("second task id");
    let mut expected_ids = vec![first_task_id.to_string(), second_task_id.to_string()];
    expected_ids.sort_by(|left, right| right.cmp(left));

    let (list_status, list_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/tasks", None).await;
    let actual_ids = list_response["data"]
        .as_array()
        .expect("tasks")
        .iter()
        .map(|task| task["taskId"].as_str().expect("task id").to_string())
        .collect::<Vec<_>>();

    assert_eq!(list_status, StatusCode::OK);
    assert_eq!(actual_ids, expected_ids);
}

async fn replace_first_plan_range(app: &Router, task_id: &str, start_ms: u64, end_ms: u64) {
    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(app, Method::GET, &plan_uri, None).await;
    let mut plan = plan_response["data"].clone();
    plan["segments"][0]["sourceRange"] = json!({ "startMs": start_ms, "endMs": end_ms });
    plan["segments"][0]["outputRange"] =
        json!({ "startMs": 0, "endMs": end_ms.saturating_sub(start_ms) });
    let (update_plan_status, _) = request_json(app, Method::PUT, &plan_uri, Some(plan)).await;

    assert_eq!(update_plan_status, StatusCode::OK);
}

fn plan_artifact_integrity(artifacts_response: &Value, task_id: &str) -> (Value, Value) {
    let plan_artifact = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .find(|artifact| artifact["artifactId"] == format!("{task_id}-plan"))
        .expect("plan artifact");

    (
        plan_artifact["sizeBytes"].clone(),
        plan_artifact["sha256"].clone(),
    )
}

fn overwrite_task_manifest_status(
    workspace_root: &Path,
    task_id: &str,
    status: &str,
    current_stage: &str,
) {
    let task_manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("task.json");
    let mut task_manifest: Value =
        serde_json::from_slice(&fs::read(&task_manifest_path).expect("task manifest"))
            .expect("task manifest json");
    task_manifest["task"]["status"] = json!(status);
    task_manifest["task"]["currentStage"] = json!(current_stage);
    fs::write(
        task_manifest_path,
        serde_json::to_vec_pretty(&task_manifest).expect("task manifest bytes"),
    )
    .expect("write task manifest");
}

fn overwrite_transcript_with_ok_segment(workspace_root: &Path, task_id: &str) {
    let transcript_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis")
        .join("transcript.json");
    let transcript = json!({
        "schemaId": "video-cut.transcript.schema.v1",
        "transcriptVersion": 1,
        "taskId": task_id,
        "audioArtifactId": format!("{task_id}-audio-source"),
        "audioPath": format!("workspace/projects/default/tasks/{task_id}/audio/source.wav"),
        "providerId": "manual-test-transcript",
        "adapterVersion": "manual-test-transcript.adapter.v1",
        "transcriptStatus": "ok",
        "language": "en",
        "timestampGranularity": ["segment"],
        "durationSeconds": 1.3,
        "text": "Subtitle Burn In",
        "segments": [
            {
                "segmentId": format!("{task_id}-manual-transcript-segment-1"),
                "startMs": 500,
                "endMs": 1800,
                "text": "Subtitle Burn In"
            }
        ],
        "warnings": [],
        "createdAt": "2026-04-27T00:00:00.000Z"
    });
    fs::write(
        transcript_path,
        serde_json::to_vec_pretty(&transcript).expect("transcript json"),
    )
    .expect("write transcript");
}

#[tokio::test]
async fn health_uses_canonical_envelope() {
    let app = create_app();
    let (status, body) = request_json(&app, Method::GET, "/api/video-cut/v1/health", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["data"]["status"], "ok");
}

#[tokio::test]
async fn cors_preflight_uses_configured_origin_allowlist() {
    let app = create_app();

    let (allowed_status, allowed_headers, _) = request_bytes_with_headers(
        &app,
        Method::OPTIONS,
        "/api/video-cut/v1/tasks",
        &[
            ("origin", "http://127.0.0.1:5173"),
            ("access-control-request-method", "POST"),
            (
                "access-control-request-headers",
                "authorization,content-type",
            ),
        ],
    )
    .await;
    assert_eq!(allowed_status, StatusCode::OK);
    assert_eq!(
        allowed_headers
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://127.0.0.1:5173")
    );

    let (blocked_status, blocked_headers, _) = request_bytes_with_headers(
        &app,
        Method::OPTIONS,
        "/api/video-cut/v1/tasks",
        &[
            ("origin", "https://untrusted.example.com"),
            ("access-control-request-method", "POST"),
            ("access-control-request-headers", "authorization"),
        ],
    )
    .await;
    assert_eq!(blocked_status, StatusCode::OK);
    assert_eq!(blocked_headers.get("access-control-allow-origin"), None);
}

#[tokio::test]
async fn unknown_api_routes_return_standard_error_envelope() {
    let app = create_app();
    let (status, headers, body) = request_raw(
        &app,
        Method::GET,
        "/api/video-cut/v1/not-a-route",
        "application/json",
        "",
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .starts_with("application/json")
    );
    let body: Value = serde_json::from_str(&body).expect("json error envelope");
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "ROUTE_NOT_FOUND");
    assert_eq!(body["error"]["traceId"], "trace-route");
}

#[tokio::test]
async fn unsupported_api_methods_return_standard_error_envelope() {
    let app = create_app();
    let (status, headers, body) = request_raw(
        &app,
        Method::POST,
        "/api/video-cut/v1/health",
        "application/json",
        "",
    )
    .await;

    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    assert!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .starts_with("application/json")
    );
    let body: Value = serde_json::from_str(&body).expect("json error envelope");
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "METHOD_NOT_ALLOWED");
    assert_eq!(body["error"]["traceId"], "trace-route");
}

#[tokio::test]
async fn invalid_path_parameters_return_standard_error_envelope() {
    let app = create_app();
    let (status, headers, body) = request_raw(
        &app,
        Method::GET,
        "/api/video-cut/v1/tasks/%E0%A4%A",
        "application/json",
        "",
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .starts_with("application/json")
    );
    let body: Value = serde_json::from_str(&body).expect("json error envelope");
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "PATH_PARAMETER_INVALID");
    assert_eq!(body["error"]["traceId"], "trace-path");
}

#[tokio::test]
async fn malformed_json_requests_return_standard_error_envelope() {
    let app = create_app();
    let (status, headers, body) = request_raw(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        "application/json",
        "{\"title\":",
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .starts_with("application/json")
    );
    let body: Value = serde_json::from_str(&body).expect("json error envelope");
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "REQUEST_JSON_INVALID");
    assert_eq!(body["error"]["traceId"], "trace-json");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("valid JSON")
    );
}

#[tokio::test]
async fn malformed_multipart_requests_return_standard_error_envelope() {
    let app = create_app();
    let (status, headers, body) = request_raw(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks/task-0001/source/file",
        "multipart/form-data",
        "not a multipart request",
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .starts_with("application/json")
    );
    let body: Value = serde_json::from_str(&body).expect("json error envelope");
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "MULTIPART_INVALID");
    assert_eq!(body["error"]["traceId"], "trace-bad-request");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("multipart")
    );
}

#[tokio::test]
async fn task_flow_generates_plan_and_render_artifacts() {
    let workspace_root = temp_workspace("task-flow");
    let app = create_persistent_app(&workspace_root);
    let create_body = json!({
        "title": "local",
        "type": "long-interview"
    });
    let (create_status, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(create_body),
    )
    .await;
    assert_eq!(create_status, StatusCode::OK);
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-task-flow-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, analyze_response) =
        request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    assert_eq!(analyze_response["data"]["status"], "planReady");

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (plan_status, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    assert_eq!(plan_status, StatusCode::OK);
    assert_eq!(
        plan_response["data"]["schemaId"],
        "video-cut.split-plan.schema.v1"
    );
    assert_eq!(
        plan_response["data"]["tracks"]
            .as_array()
            .expect("tracks")
            .len(),
        8
    );
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    assert_eq!(render_response["data"]["status"], "succeeded");

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (artifacts_status, artifacts_response) =
        request_json(&app, Method::GET, &artifacts_uri, None).await;
    assert_eq!(artifacts_status, StatusCode::OK);
    assert!(
        artifacts_response["data"]
            .as_array()
            .expect("artifacts")
            .iter()
            .any(|artifact| artifact["path"]
                .as_str()
                .unwrap_or_default()
                .ends_with("output.mp4"))
    );
    assert!(
        artifacts_response["data"]
            .as_array()
            .expect("artifacts")
            .iter()
            .all(|artifact| artifact["path"]
                .as_str()
                .unwrap_or_default()
                .starts_with("workspace/projects/default/tasks/"))
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn capabilities_publish_provider_contract_policy() {
    let app = create_app();
    let (status, body) =
        request_json(&app, Method::GET, "/api/video-cut/v1/capabilities", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["data"]["providers"]["providerCapabilityVersion"],
        "video-cut.provider-capability.schema.v1"
    );
    assert_eq!(
        body["data"]["providers"]["openAiCompatible"]["chatCompletionsEndpoint"],
        "/v1/chat/completions"
    );
    assert_eq!(
        body["data"]["providers"]["openAiCompatible"]["audioTranscriptionsEndpoint"],
        "/v1/audio/transcriptions"
    );
    assert_eq!(
        body["data"]["providers"]["openAiCompatible"]["ollamaAllowed"],
        false
    );
}

#[tokio::test]
async fn capabilities_reflect_saved_provider_settings_without_leaking_secrets() {
    let app = create_app();
    let (_, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = default_response["data"].clone();
    settings["ai"]["enabled"] = json!(true);
    settings["ai"]["apiKeyConfigured"] = json!(true);
    settings["ai"]["apiKey"] = json!("sk-capability-secret");
    settings["speechToText"]["enabled"] = json!(true);
    settings["speechToText"]["reuseAiProviderConnection"] = json!(false);
    settings["speechToText"]["apiKeyConfigured"] = json!(true);
    settings["speechToText"]["apiKey"] = json!("sk-stt-capability-secret");

    let (put_status, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(put_response["data"]["valid"], true);

    let (status, body) =
        request_json(&app, Method::GET, "/api/video-cut/v1/capabilities", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["ai"]["status"], "ok");
    assert_eq!(body["data"]["ai"]["label"], "LLM ready");
    assert_eq!(body["data"]["speechToText"]["status"], "ok");
    assert_eq!(
        body["data"]["speechToText"]["label"],
        "Speech to text ready"
    );
    let serialized = body["data"].to_string();
    assert!(!serialized.contains("sk-capability-secret"));
    assert!(!serialized.contains("sk-stt-capability-secret"));
    assert!(!serialized.contains("\"apiKey\""));
}

#[tokio::test]
async fn doctor_report_reuses_capability_and_redacts_effective_config() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-doctor-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);

    let (_, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = default_response["data"].clone();
    settings["ai"]["enabled"] = json!(true);
    settings["ai"]["apiKeyConfigured"] = json!(true);
    settings["ai"]["apiKey"] = json!("sk-plain-doctor-secret");
    settings["speechToText"]["enabled"] = json!(true);
    settings["speechToText"]["reuseAiProviderConnection"] = json!(true);
    settings["speechToText"]["apiKey"] = json!("sk-plain-stt-secret");

    let (put_status, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(put_response["data"]["valid"], true);

    let (status, body) = request_json(&app, Method::GET, "/api/video-cut/v1/doctor", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["data"]["reportVersion"], "video-cut.doctor.v1");
    assert_eq!(
        body["data"]["capability"]["reportVersion"],
        "video-cut.capability.v1"
    );
    assert_eq!(
        body["data"]["capability"]["providers"]["openAiCompatible"]["ollamaAllowed"],
        false
    );
    let check_ids: Vec<&str> = body["data"]["checks"]
        .as_array()
        .expect("doctor checks")
        .iter()
        .filter_map(|check| check["checkId"].as_str())
        .collect();
    assert!(check_ids.contains(&"health"));
    assert!(check_ids.contains(&"workspaceWritable"));
    assert!(check_ids.contains(&"ffmpeg"));
    assert!(check_ids.contains(&"ffprobe"));
    assert!(check_ids.contains(&"providerPolicy"));
    assert!(check_ids.contains(&"settingsValidation"));
    assert!(check_ids.contains(&"redaction"));

    let serialized = body["data"]["redactedConfig"].to_string();
    assert!(!serialized.contains("sk-plain-doctor-secret"));
    assert!(!serialized.contains("sk-plain-stt-secret"));
    assert!(serialized.contains("apiKeyConfigured"));
}

#[tokio::test]
async fn doctor_report_redacts_server_local_workspace_paths() {
    let workspace_root = temp_workspace("doctor-path-redaction");
    let app = create_persistent_app(&workspace_root);
    let (_, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = default_response["data"].clone();
    settings["storage"]["workspaceRoot"] = json!(workspace_root.display().to_string());
    settings["storage"]["artifactRoot"] =
        json!(workspace_root.join("artifacts").display().to_string());
    settings["storage"]["tempRoot"] = json!(workspace_root.join("tmp").display().to_string());
    let (_, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(put_response["data"]["valid"], true);

    let (status, body) = request_json(&app, Method::GET, "/api/video-cut/v1/doctor", None).await;

    assert_eq!(status, StatusCode::OK);
    let raw_workspace_path = workspace_root.display().to_string();
    let json_escaped_workspace_path = raw_workspace_path.replace('\\', "\\\\");
    let serialized = body["data"].to_string();
    assert!(!serialized.contains(&raw_workspace_path));
    assert!(!serialized.contains(&json_escaped_workspace_path));
    assert_eq!(
        body["data"]["redactedConfig"]["storage"]["workspaceRoot"],
        "<redacted-path>"
    );
    assert_eq!(
        body["data"]["redactedConfig"]["storage"]["artifactRoot"],
        "<redacted-path>"
    );
    assert_eq!(
        body["data"]["redactedConfig"]["storage"]["tempRoot"],
        "<redacted-path>"
    );
    let workspace_check = body["data"]["checks"]
        .as_array()
        .expect("doctor checks")
        .iter()
        .find(|check| check["checkId"] == "workspaceWritable")
        .expect("workspace writable check");
    assert_eq!(workspace_check["details"]["path"], "<redacted-path>");
}

#[tokio::test]
async fn diagnostics_bundle_exports_redacted_runtime_evidence() {
    let app = create_app();
    let (_, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = default_response["data"].clone();
    settings["ai"]["enabled"] = json!(true);
    settings["ai"]["apiKeyConfigured"] = json!(true);
    settings["ai"]["apiKey"] = json!("sk-plain-diagnostics-secret");

    let (_, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(put_response["data"]["valid"], true);

    let (status, body) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/diagnostics/bundle",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(
        body["data"]["bundleVersion"],
        "video-cut.diagnostics-bundle.v1"
    );
    assert_eq!(
        body["data"]["capability"]["reportVersion"],
        "video-cut.capability.v1"
    );
    assert_eq!(
        body["data"]["doctor"]["reportVersion"],
        "video-cut.doctor.v1"
    );
    assert_eq!(body["data"]["includes"]["sourceMedia"], false);
    assert_eq!(body["data"]["includes"]["transcript"], false);
    let serialized = body["data"].to_string();
    assert!(!serialized.contains("sk-plain-diagnostics-secret"));
    assert!(!serialized.contains("\"apiKey\""));
}

#[tokio::test]
async fn diagnostics_support_bundle_requires_explicit_consent_for_sensitive_attachments() {
    let app = create_app();

    let (status, body) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/diagnostics/support-bundle",
        Some(json!({
            "taskId": "task-demo",
            "includeSourceMedia": true,
            "includeTranscript": false,
            "consentAccepted": false
        })),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"]["code"], "DIAGNOSTICS_CONSENT_REQUIRED");
}

#[tokio::test]
async fn diagnostics_support_bundle_exports_safe_attachment_descriptors_after_consent() {
    let app = create_app();
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "Support bundle task",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let source_uri = format!("/api/video-cut/v1/tasks/{task_id}/source");
    let (source_status, _) = request_json(
        &app,
        Method::POST,
        &source_uri,
        Some(json!({
            "sourceName": "support-input.mp4",
            "contentType": "video/mp4",
            "sizeBytes": 1024
        })),
    )
    .await;
    assert_eq!(source_status, StatusCode::OK);

    let transcript_uri = format!("/api/video-cut/v1/tasks/{task_id}/transcript");
    let (transcript_status, _) = request_json(
        &app,
        Method::PUT,
        &transcript_uri,
        Some(json!({
            "language": "zh",
            "text": "support transcript",
            "segments": [
                {
                    "startMs": 0,
                    "endMs": 1500,
                    "text": "support transcript",
                    "speakerId": "speaker-1"
                }
            ]
        })),
    )
    .await;
    assert_eq!(transcript_status, StatusCode::OK);

    let (status, body) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/diagnostics/support-bundle",
        Some(json!({
            "taskId": task_id,
            "includeSourceMedia": true,
            "includeTranscript": true,
            "consentAccepted": true
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(
        body["data"]["bundleVersion"],
        "video-cut.diagnostics-bundle.v1"
    );
    assert_eq!(body["data"]["includes"]["sourceMedia"], true);
    assert_eq!(body["data"]["includes"]["transcript"], true);
    assert_eq!(
        body["data"]["supportRequest"]["schemaId"],
        "video-cut.diagnostics-support-bundle-request.v1"
    );
    let artifacts = body["data"]["artifacts"].as_array().expect("artifacts");
    assert!(artifacts.iter().any(|artifact| {
        artifact["kind"] == "sourceMedia"
            && artifact["artifactId"] == format!("{task_id}-source")
            && artifact["included"] == true
            && artifact["contentRef"]
                .as_str()
                .unwrap_or_default()
                .contains("/content")
    }));
    assert!(artifacts.iter().any(|artifact| {
        artifact["kind"] == "transcript"
            && artifact["artifactId"] == format!("{task_id}-transcript")
            && artifact["included"] == true
            && artifact["path"]
                .as_str()
                .unwrap_or_default()
                .starts_with("workspace/projects/default/tasks/")
    }));
    let serialized = body["data"].to_string();
    assert!(!serialized.contains("\\\\"));
    assert!(!serialized.contains("D:"));
    assert!(!serialized.contains("\"apiKey\""));
}

#[tokio::test]
async fn provider_conformance_endpoint_builds_redacted_report_from_runtime_settings() {
    let app = create_app();
    let (_, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = default_response["data"].clone();
    settings["ai"]["enabled"] = json!(true);
    settings["ai"]["baseUrl"] = json!("https://api.example.com/v1");
    settings["ai"]["apiKeyConfigured"] = json!(true);
    settings["ai"]["apiKey"] = json!("sk-plain-provider-secret");
    settings["ai"]["chatModel"] = json!("gpt-4.1-mini");
    settings["speechToText"]["enabled"] = json!(true);
    settings["speechToText"]["reuseAiProviderConnection"] = json!(true);
    settings["speechToText"]["transcriptionModel"] = json!("gpt-4o-mini-transcribe");

    let (put_status, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(put_response["data"]["valid"], true);

    let (status, body) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/providers/openai-compatible/conformance",
        Some(json!({ "target": "all" })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(
        body["data"]["reportVersion"],
        "video-cut.provider-conformance.v1"
    );
    assert_eq!(body["data"]["status"], "ok");
    let checks = body["data"]["checks"].as_array().expect("checks");
    assert!(checks.iter().any(|check| {
        check["checkId"] == "llm.endpoint.chatCompletions"
            && check["details"]["endpoint"] == "https://api.example.com/v1/chat/completions"
    }));
    assert!(checks.iter().any(|check| {
        check["checkId"] == "stt.provider.bridge"
            && check["details"]["providerProfile"] == "openai-audio-transcriptions"
            && check["details"]["canonicalRequest"] == "openai-audio-transcriptions.verbose-json"
            && check["details"]["vendorEndpoint"]
                == "https://api.example.com/v1/audio/transcriptions"
    }));
    let serialized = body.to_string();
    assert!(!serialized.contains("sk-plain-provider-secret"));
    assert!(!serialized.contains("\"apiKey\""));
    assert!(serialized.contains("configured"));
}

#[tokio::test]
async fn put_settings_validates_provider_and_runtime_rules_before_persisting() {
    let app = create_app();
    let (default_status, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    assert_eq!(default_status, StatusCode::OK);
    let default_settings = default_response["data"].clone();

    let mut invalid_settings = default_settings.clone();
    invalid_settings["ai"]["enabled"] = json!(true);
    invalid_settings["ai"]["baseUrl"] = json!("http://127.0.0.1:11434");
    invalid_settings["ai"]["apiKeyConfigured"] = json!(false);
    invalid_settings["ai"]["chatModel"] = json!(" ");
    invalid_settings["speechToText"]["enabled"] = json!(true);
    invalid_settings["speechToText"]["providerProfile"] = json!("volcengine-bigasr-flash");
    invalid_settings["speechToText"]["resourceId"] = json!(" ");
    invalid_settings["speechToText"]["reuseAiProviderConnection"] = json!(true);
    invalid_settings["speechToText"]["apiKeyConfigured"] = json!(false);
    invalid_settings["runtime"]["deploymentMode"] = json!("server-private");
    invalid_settings["runtime"]["bindHost"] = json!("0.0.0.0");
    invalid_settings["runtime"]["authMode"] = json!("none");
    invalid_settings["security"]["corsAllowedOrigins"] = json!(["https://video.example.test/app"]);
    invalid_settings["mediaTools"]["workerConcurrency"] = json!(0);

    let (put_status, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(invalid_settings),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(put_response["data"]["valid"], false);
    assert!(
        put_response["data"]["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "OLLAMA_NOT_ALLOWED" && error["field"] == "ai.baseUrl")
    );
    assert!(
        put_response["data"]["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "AUTH_REQUIRED" && error["field"] == "runtime.authMode")
    );
    assert!(
        put_response["data"]["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "REQUIRED" && error["field"] == "speechToText.resourceId")
    );
    assert!(
        put_response["data"]["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "INVALID_URL"
                && error["field"] == "security.corsAllowedOrigins")
    );

    let (_, current_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    assert_eq!(current_response["data"], default_settings);
}

#[tokio::test]
async fn put_settings_extracts_plaintext_provider_keys_without_persisting_them() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-secret-store-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, default_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = default_response["data"].clone();
    settings["ai"]["enabled"] = json!(true);
    settings["ai"]["baseUrl"] = json!("https://api.example.com");
    settings["ai"]["apiKeyConfigured"] = json!(false);
    settings["ai"]["apiKey"] = json!("sk-plain-ai-secret");
    settings["ai"]["chatModel"] = json!("gpt-4.1-mini");
    settings["speechToText"]["enabled"] = json!(true);
    settings["speechToText"]["reuseAiProviderConnection"] = json!(false);
    settings["speechToText"]["baseUrl"] = json!("https://stt.example.com");
    settings["speechToText"]["apiKeyConfigured"] = json!(false);
    settings["speechToText"]["apiKey"] = json!("sk-plain-stt-secret");
    settings["speechToText"]["transcriptionModel"] = json!("gpt-4o-mini-transcribe");

    let (put_status, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;

    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(put_response["data"]["valid"], true);

    let (_, current_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let current_settings = &current_response["data"];
    assert_eq!(current_settings["ai"]["apiKeyConfigured"], true);
    assert_eq!(current_settings["speechToText"]["apiKeyConfigured"], true);
    let current_serialized = current_settings.to_string();
    assert!(!current_serialized.contains("sk-plain-ai-secret"));
    assert!(!current_serialized.contains("sk-plain-stt-secret"));
    assert!(!current_serialized.contains("\"apiKey\""));

    let settings_file = workspace_root.join("runtime").join("settings.json");
    let persisted_settings = fs::read_to_string(settings_file).expect("persisted settings");
    assert!(!persisted_settings.contains("sk-plain-ai-secret"));
    assert!(!persisted_settings.contains("sk-plain-stt-secret"));
    assert!(!persisted_settings.contains("\"apiKey\""));

    let (_, doctor_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/doctor", None).await;
    let (_, diagnostics_response) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/diagnostics/bundle",
        None,
    )
    .await;
    let (_, conformance_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/providers/openai-compatible/conformance",
        Some(json!({ "target": "all" })),
    )
    .await;
    let combined_serialized = format!(
        "{}{}{}",
        doctor_response, diagnostics_response, conformance_response
    );
    assert!(!combined_serialized.contains("sk-plain-ai-secret"));
    assert!(!combined_serialized.contains("sk-plain-stt-secret"));
    assert!(!combined_serialized.contains("\"apiKey\""));
    assert_eq!(conformance_response["data"]["status"], "ok");
    assert!(combined_serialized.contains("configured"));
}

#[tokio::test]
async fn task_lifecycle_endpoints_match_public_contract() {
    let app = create_app();
    let create_body = json!({
        "title": "local",
        "type": "long-interview"
    });
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(create_body),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let task_uri = format!("/api/video-cut/v1/tasks/{task_id}");
    let (get_status, get_response) = request_json(&app, Method::GET, &task_uri, None).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(get_response["data"]["taskId"], task_id);

    let source_uri = format!("/api/video-cut/v1/tasks/{task_id}/source");
    let (source_status, source_response) = request_json(
        &app,
        Method::POST,
        &source_uri,
        Some(json!({
            "sourceName": "replacement.mp4",
            "sizeBytes": 2048,
            "contentType": "video/mp4"
        })),
    )
    .await;
    assert_eq!(source_status, StatusCode::OK);
    assert_eq!(source_response["data"]["kind"], "source");
    assert_eq!(source_response["data"]["sizeBytes"], 2048);

    let cancel_uri = format!("/api/video-cut/v1/tasks/{task_id}/cancel");
    let (cancel_status, cancel_response) =
        request_json(&app, Method::POST, &cancel_uri, None).await;
    assert_eq!(cancel_status, StatusCode::OK);
    assert_eq!(cancel_response["data"]["status"], "cancelled");

    let download_uri =
        format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{task_id}-source/download");
    let (download_status, download_response) =
        request_json(&app, Method::GET, &download_uri, None).await;
    assert_eq!(download_status, StatusCode::OK);
    assert_eq!(
        download_response["data"]["downloadMode"],
        "host-content-endpoint"
    );
    assert_eq!(
        download_response["data"]["url"],
        format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{task_id}-source/content")
    );
    assert_eq!(download_response["data"]["contentType"], "video/mp4");

    let (delete_status, delete_response) =
        request_json(&app, Method::DELETE, &task_uri, None).await;
    assert_eq!(delete_status, StatusCode::OK);
    assert_eq!(delete_response["data"]["deleted"], true);
    assert_eq!(delete_response["data"]["taskId"], task_id);

    let (missing_status, missing_response) = request_json(&app, Method::GET, &task_uri, None).await;
    assert_eq!(missing_status, StatusCode::NOT_FOUND);
    assert_eq!(missing_response["ok"], false);
    assert_eq!(missing_response["error"]["code"], "TASK_NOT_FOUND");
}

#[tokio::test]
async fn get_task_plan_returns_task_plan_not_found_for_existing_task_without_plan() {
    let app = create_app();
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "draft plan",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (plan_status, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;

    assert_eq!(plan_status, StatusCode::NOT_FOUND);
    assert_eq!(plan_response["ok"], false);
    assert_eq!(plan_response["error"]["code"], "TASK_PLAN_NOT_FOUND");
    assert_eq!(
        plan_response["error"]["message"],
        format!("Task plan not found: {task_id}")
    );
    assert_eq!(
        plan_response["error"]["traceId"],
        format!("trace-{task_id}")
    );
}

#[tokio::test]
async fn get_task_plan_returns_task_not_found_for_unknown_task() {
    let app = create_app();
    let (plan_status, plan_response) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/tasks/missing-task/plan",
        None,
    )
    .await;

    assert_eq!(plan_status, StatusCode::NOT_FOUND);
    assert_eq!(plan_response["ok"], false);
    assert_eq!(plan_response["error"]["code"], "TASK_NOT_FOUND");
}

#[tokio::test]
async fn task_events_and_artifacts_return_task_not_found_for_unknown_task() {
    let app = create_app();
    let (events_status, events_response) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/tasks/missing-task/events",
        None,
    )
    .await;
    assert_eq!(events_status, StatusCode::NOT_FOUND);
    assert_eq!(events_response["error"]["code"], "TASK_NOT_FOUND");

    let (artifacts_status, artifacts_response) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/tasks/missing-task/artifacts",
        None,
    )
    .await;
    assert_eq!(artifacts_status, StatusCode::NOT_FOUND);
    assert_eq!(artifacts_response["error"]["code"], "TASK_NOT_FOUND");
}

#[tokio::test]
async fn attach_task_source_sanitizes_metadata_source_name_before_manifest_path() {
    let app = create_app();
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "metadata source",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let source_uri = format!("/api/video-cut/v1/tasks/{task_id}/source");
    let (source_status, source_response) = request_json(
        &app,
        Method::POST,
        &source_uri,
        Some(json!({
            "sourceName": "..\\evil/clip.mp4",
            "sizeBytes": 2048,
            "contentType": "video/mp4"
        })),
    )
    .await;

    assert_eq!(source_status, StatusCode::OK);
    assert_eq!(
        source_response["data"]["path"],
        format!("workspace/projects/default/tasks/{task_id}/source/clip.mp4")
    );
    assert_eq!(source_response["data"]["kind"], "source");
}

#[tokio::test]
async fn attach_task_source_rejects_non_video_source_media() {
    let app = create_app();
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "bad source",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let (source_status, source_response) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/source"),
        Some(json!({
            "sourceName": "notes.txt",
            "sizeBytes": 2048,
            "contentType": "text/plain"
        })),
    )
    .await;

    assert_eq!(source_status, StatusCode::BAD_REQUEST);
    assert_eq!(source_response["ok"], false);
    assert_eq!(
        source_response["error"]["code"],
        "SOURCE_FILE_TYPE_UNSUPPORTED"
    );
}

#[tokio::test]
async fn analyze_task_without_source_is_rejected_without_publishing_artifacts() {
    let app = create_app();

    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "empty analysis",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let (analyze_status, analyze_response) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/analyze"),
        None,
    )
    .await;

    assert_eq!(analyze_status, StatusCode::BAD_REQUEST);
    assert_eq!(analyze_response["ok"], false);
    assert_eq!(analyze_response["error"]["code"], "SOURCE_FILE_REQUIRED");

    let (_, task_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}"),
        None,
    )
    .await;
    assert_eq!(task_response["data"]["status"], "draft");
    assert_eq!(task_response["data"]["progress"], 0);

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    assert_eq!(
        artifacts_response["data"]
            .as_array()
            .expect("artifacts")
            .len(),
        0
    );
}

#[tokio::test]
async fn upload_task_source_file_writes_safe_workspace_artifact() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-upload-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "local upload",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-upload-boundary";
    let source_bytes = b"video bytes from browser";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"..\\evil clip.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\n");
    body.extend_from_slice(source_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let (upload_status, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;

    assert_eq!(upload_status, StatusCode::OK);
    assert_eq!(upload_response["ok"], true);
    assert_eq!(upload_response["data"]["kind"], "source");
    assert_eq!(
        upload_response["data"]["sizeBytes"],
        source_bytes.len() as u64
    );
    assert_eq!(upload_response["data"]["sha256"], sha256_hex(source_bytes));
    let artifact_path = upload_response["data"]["path"]
        .as_str()
        .expect("artifact path");
    assert!(artifact_path.ends_with("/source/evil clip.mp4"));
    assert!(!artifact_path.contains(".."));

    let stored_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("source")
        .join("evil clip.mp4");
    assert_eq!(fs::read(stored_path).expect("stored source"), source_bytes);

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let source_artifacts = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .filter(|artifact| artifact["kind"] == "source")
        .count();
    assert_eq!(source_artifacts, 1);

    let (_, task_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}"),
        None,
    )
    .await;
    assert_eq!(task_response["data"]["sourceName"], "evil clip.mp4");
}

#[tokio::test]
async fn upload_task_source_file_keeps_existing_source_when_replacement_exceeds_limit() {
    let workspace_root = temp_workspace("upload-limit-replacement");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "oversized replacement",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let initial_bytes = b"initial video bytes";
    let initial_boundary = "video-cut-upload-initial-boundary";
    let initial_body =
        multipart_file_body(initial_boundary, "source.mp4", "video/mp4", initial_bytes);
    let (initial_status, initial_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        initial_boundary,
        initial_body,
    )
    .await;
    assert_eq!(initial_status, StatusCode::OK);
    assert_eq!(
        initial_response["data"]["sha256"],
        sha256_hex(initial_bytes)
    );

    let (_, settings_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = settings_response["data"].clone();
    settings["mediaTools"]["maxUploadBytes"] = json!(8);
    let (settings_status, settings_body) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(settings_status, StatusCode::OK);
    assert_eq!(settings_body["data"]["valid"], true);

    let replacement_bytes = b"replacement bytes above limit";
    let replacement_boundary = "video-cut-upload-replacement-boundary";
    let replacement_body = multipart_file_body(
        replacement_boundary,
        "source.mp4",
        "video/mp4",
        replacement_bytes,
    );
    let (replacement_status, replacement_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        replacement_boundary,
        replacement_body,
    )
    .await;
    assert_eq!(replacement_status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        replacement_response["error"]["code"],
        "SOURCE_FILE_TOO_LARGE"
    );

    let stored_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("source")
        .join("source.mp4");
    assert_eq!(
        fs::read(&stored_path).expect("stored source"),
        initial_bytes
    );
    let source_dir = stored_path.parent().expect("source dir");
    let temporary_files = fs::read_dir(source_dir)
        .expect("source dir entries")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.contains(".uploading") || name.contains(".replacing"))
        .collect::<Vec<_>>();
    assert!(
        temporary_files.is_empty(),
        "failed uploads must not leave temporary files: {temporary_files:?}"
    );

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let source_artifact = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .find(|artifact| artifact["kind"] == "source")
        .expect("source artifact");
    assert_eq!(
        source_artifact["sizeBytes"],
        json!(initial_bytes.len() as u64)
    );
    assert_eq!(source_artifact["sha256"], sha256_hex(initial_bytes));

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn upload_task_source_file_rejects_non_video_source_media() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-upload-format-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "bad upload",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-upload-format-boundary";
    let upload_body = multipart_file_body(boundary, "notes.txt", "text/plain", b"not video");

    let (upload_status, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        upload_body,
    )
    .await;

    assert_eq!(upload_status, StatusCode::BAD_REQUEST);
    assert_eq!(upload_response["ok"], false);
    assert_eq!(
        upload_response["error"]["code"],
        "SOURCE_FILE_TYPE_UNSUPPORTED"
    );

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    assert!(
        artifacts_response["data"]
            .as_array()
            .expect("artifacts")
            .iter()
            .all(|artifact| artifact["kind"] != "source")
    );

    let (_, task_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}"),
        None,
    )
    .await;
    assert!(task_response["data"]["sourceName"].is_null());
}

#[tokio::test]
async fn analyze_task_writes_standard_media_info_artifact() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-media-info-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "media info",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-media-info-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"source.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\nnot-a-real-video");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let (_, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;
    assert_eq!(upload_response["ok"], true);

    let (analyze_status, analyze_response) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/analyze"),
        None,
    )
    .await;

    assert_eq!(analyze_status, StatusCode::OK);
    assert_eq!(analyze_response["data"]["status"], "planReady");
    let media_info_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis")
        .join("media-info.json");
    let media_info_bytes = fs::read(&media_info_path).expect("media info json");
    let media_info: Value = serde_json::from_slice(&media_info_bytes).expect("media info document");
    assert_eq!(media_info["schemaId"], "video-cut.media-info.schema.v1");
    assert_eq!(media_info["taskId"], task_id);
    assert_eq!(media_info["sourceArtifactId"], format!("{task_id}-source"));
    assert_eq!(media_info["probeStatus"], "failed");

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    let media_info_artifact = artifacts
        .iter()
        .find(|artifact| artifact["artifactId"] == format!("{task_id}-media-info"))
        .expect("media info artifact");
    assert_eq!(media_info_artifact["kind"], "analysis");
    assert!(
        media_info_artifact["path"]
            .as_str()
            .unwrap_or_default()
            .ends_with("analysis/media-info.json")
    );
    assert_eq!(
        media_info_artifact["sizeBytes"],
        media_info_bytes.len() as u64
    );
    assert_eq!(media_info_artifact["sha256"], sha256_hex(&media_info_bytes));
    let plan_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("plan")
        .join("plan.json");
    let plan_bytes = fs::read(&plan_path).expect("plan json");
    let plan_artifact = artifacts
        .iter()
        .find(|artifact| artifact["artifactId"] == format!("{task_id}-plan"))
        .expect("plan artifact");
    assert_eq!(plan_artifact["sizeBytes"], plan_bytes.len() as u64);
    assert_eq!(plan_artifact["sha256"], sha256_hex(&plan_bytes));

    let (_, plan_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/plan"),
        None,
    )
    .await;
    let media_info_track = plan_response["data"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .find(|track| track["kind"] == "mediaInfoTrack")
        .expect("media info track");
    assert_eq!(
        media_info_track["sourceArtifactId"],
        format!("{task_id}-media-info")
    );
}

#[tokio::test]
async fn update_task_plan_refreshes_plan_artifact_integrity_metadata() {
    let workspace_root = temp_workspace("update-plan-artifact-metadata");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "plan edit",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-update-plan-metadata-boundary",
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);

    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let plan_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("plan")
        .join("plan.json");
    let plan_bytes = fs::read(plan_path).expect("updated plan json");
    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let plan_artifact = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .find(|artifact| artifact["artifactId"] == format!("{task_id}-plan"))
        .expect("plan artifact");
    assert_eq!(plan_artifact["sizeBytes"], plan_bytes.len() as u64);
    assert_eq!(plan_artifact["sha256"], sha256_hex(&plan_bytes));
}

#[tokio::test]
async fn update_task_plan_rejects_task_id_mismatch_without_replacing_plan_artifact() {
    let workspace_root = temp_workspace("update-plan-task-id-mismatch");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "plan ownership",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-update-plan-owner-boundary",
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let mut mismatched_plan = plan_response["data"].clone();
    mismatched_plan["taskId"] = json!("task-other");
    let (_, artifacts_before) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let original_integrity = plan_artifact_integrity(&artifacts_before, task_id);

    let (update_status, update_response) =
        request_json(&app, Method::PUT, &plan_uri, Some(mismatched_plan)).await;

    assert_eq!(update_status, StatusCode::BAD_REQUEST);
    assert_eq!(update_response["error"]["code"], "PLAN_TASK_ID_MISMATCH");
    let (_, plan_after_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    assert_eq!(plan_after_response["data"]["taskId"], task_id);
    let (_, artifacts_after) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    assert_eq!(
        plan_artifact_integrity(&artifacts_after, task_id),
        original_integrity
    );
}

#[tokio::test]
async fn update_task_plan_rejects_invalid_split_plan_without_replacing_plan_artifact() {
    let workspace_root = temp_workspace("update-plan-invalid-contract");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "plan contract",
            "type": "long-interview"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-update-plan-invalid-boundary",
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let mut invalid_plan = plan_response["data"].clone();
    invalid_plan["segments"] = json!([]);
    let (_, artifacts_before) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let original_integrity = plan_artifact_integrity(&artifacts_before, task_id);

    let (update_status, update_response) =
        request_json(&app, Method::PUT, &plan_uri, Some(invalid_plan)).await;

    assert_eq!(update_status, StatusCode::BAD_REQUEST);
    assert_eq!(update_response["error"]["code"], "PLAN_INVALID");
    assert!(
        update_response["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("segments")
    );
    let (_, plan_after_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    assert!(
        !plan_after_response["data"]["segments"]
            .as_array()
            .expect("segments")
            .is_empty()
    );
    let (_, artifacts_after) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    assert_eq!(
        plan_artifact_integrity(&artifacts_after, task_id),
        original_integrity
    );
}

#[tokio::test]
async fn asset_catalog_lists_configured_audio_asset_packs_without_leaking_local_paths() {
    let workspace_root = temp_workspace("asset-catalog");
    let bgm_dir = workspace_root.join("licensed-assets").join("bgm");
    let sfx_dir = workspace_root.join("licensed-assets").join("sfx");
    fs::create_dir_all(&bgm_dir).expect("bgm dir");
    fs::create_dir_all(&sfx_dir).expect("sfx dir");
    let bgm_path = bgm_dir.join("licensed-bgm.wav");
    let sfx_path = sfx_dir.join("licensed-sfx.wav");
    generate_test_wav(&bgm_path, 440, 1);
    generate_test_wav(&sfx_path, 880, 1);
    fs::write(
        bgm_dir.join("asset-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaId": "video-cut.asset-pack-manifest.v1",
            "assets": [{
                "path": "licensed-bgm.wav",
                "license": "CC0-1.0",
                "source": "https://example.invalid/sdkwork-bgm-pack",
                "version": "2026.04"
            }]
        }))
        .expect("bgm asset manifest json"),
    )
    .expect("bgm asset manifest");
    let bgm_bytes = fs::read(&bgm_path).expect("bgm bytes");

    let app = create_persistent_app(&workspace_root);
    let (_, settings_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = settings_response["data"].clone();
    settings["assets"]["bgm"] = json!(bgm_dir.display().to_string());
    settings["assets"]["sfx"] = json!(sfx_dir.display().to_string());
    let (settings_status, settings_body) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(settings_status, StatusCode::OK);
    assert_eq!(settings_body["data"]["valid"], true);

    let (catalog_status, catalog_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/assets/catalog", None).await;

    assert_eq!(catalog_status, StatusCode::OK);
    let catalog = &catalog_response["data"];
    assert_eq!(catalog["schemaId"], "video-cut.asset-catalog.schema.v1");
    assert_eq!(catalog["assetCatalogVersion"], 1);
    let bgm_slot = catalog["slots"]
        .as_array()
        .expect("slots")
        .iter()
        .find(|slot| slot["kind"] == "bgm")
        .expect("bgm slot");
    assert_eq!(bgm_slot["status"], "available");
    assert_eq!(bgm_slot["configuredPath"], "<server-local-path>");
    assert_eq!(bgm_slot["manifestPath"], "assets://bgm/asset-manifest.json");
    assert_eq!(
        bgm_slot["entries"][0]["path"],
        "assets://bgm/licensed-bgm.wav"
    );
    assert_eq!(bgm_slot["entries"][0]["fileName"], "licensed-bgm.wav");
    assert_eq!(bgm_slot["entries"][0]["sizeBytes"], bgm_bytes.len() as u64);
    assert_eq!(bgm_slot["entries"][0]["sha256"], sha256_hex(&bgm_bytes));
    assert_eq!(bgm_slot["entries"][0]["license"], "CC0-1.0");
    assert_eq!(
        bgm_slot["entries"][0]["source"],
        "https://example.invalid/sdkwork-bgm-pack"
    );
    assert_eq!(bgm_slot["entries"][0]["version"], "2026.04");

    let sfx_slot = catalog["slots"]
        .as_array()
        .expect("slots")
        .iter()
        .find(|slot| slot["kind"] == "sfx")
        .expect("sfx slot");
    assert_eq!(sfx_slot["status"], "available");
    assert_eq!(
        sfx_slot["entries"][0]["license"],
        "unverified-user-provided"
    );
    assert!(
        sfx_slot["warnings"][0]
            .as_str()
            .unwrap_or_default()
            .contains("asset-manifest.json is missing")
    );

    let serialized_catalog = catalog.to_string();
    assert!(!serialized_catalog.contains(&workspace_root.display().to_string()));
    assert!(!serialized_catalog.contains(&bgm_dir.display().to_string()));
    assert!(!serialized_catalog.contains(&sfx_dir.display().to_string()));
}

#[tokio::test]
async fn analyze_task_writes_standard_audio_and_silence_artifacts() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-audio-silence-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "audio silence",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-audio-silence-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"source.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\nnot-a-real-video");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let (_, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;
    assert_eq!(upload_response["ok"], true);

    let (analyze_status, analyze_response) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/analyze"),
        None,
    )
    .await;
    assert_eq!(analyze_status, StatusCode::OK);
    assert_eq!(analyze_response["data"]["status"], "planReady");

    let analysis_dir = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis");
    let audio_extract: Value = serde_json::from_slice(
        &fs::read(analysis_dir.join("audio-extract.json")).expect("audio extract json"),
    )
    .expect("audio extract document");
    assert_eq!(
        audio_extract["schemaId"],
        "video-cut.audio-extract.schema.v1"
    );
    assert_eq!(audio_extract["taskId"], task_id);
    assert_eq!(
        audio_extract["sourceArtifactId"],
        format!("{task_id}-source")
    );
    assert_eq!(
        audio_extract["audioArtifactId"],
        format!("{task_id}-audio-source")
    );
    assert_eq!(audio_extract["extractStatus"], "failed");
    assert!(
        !audio_extract["warnings"]
            .as_array()
            .expect("warnings")
            .is_empty()
    );

    let silence_ranges: Value = serde_json::from_slice(
        &fs::read(analysis_dir.join("silence-ranges.json")).expect("silence ranges json"),
    )
    .expect("silence ranges document");
    assert_eq!(
        silence_ranges["schemaId"],
        "video-cut.silence-ranges.schema.v1"
    );
    assert_eq!(silence_ranges["taskId"], task_id);
    assert_eq!(
        silence_ranges["audioArtifactId"],
        format!("{task_id}-audio-source")
    );
    assert_eq!(silence_ranges["detectionStatus"], "audio-unavailable");
    assert!(
        !silence_ranges["warnings"]
            .as_array()
            .expect("warnings")
            .is_empty()
    );

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    assert!(artifacts.iter().any(|artifact| {
        artifact["artifactId"] == format!("{task_id}-audio-extract")
            && artifact["kind"] == "analysis"
            && artifact["path"]
                .as_str()
                .unwrap_or_default()
                .ends_with("analysis/audio-extract.json")
    }));
    assert!(artifacts.iter().any(|artifact| {
        artifact["artifactId"] == format!("{task_id}-silence-ranges")
            && artifact["kind"] == "analysis"
            && artifact["path"]
                .as_str()
                .unwrap_or_default()
                .ends_with("analysis/silence-ranges.json")
    }));

    let (_, plan_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/plan"),
        None,
    )
    .await;
    let silence_track = plan_response["data"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .find(|track| track["kind"] == "silenceTrack")
        .expect("silence track");
    assert_eq!(
        silence_track["sourceArtifactId"],
        format!("{task_id}-silence-ranges")
    );
}

#[tokio::test]
async fn analyze_task_writes_standard_speech_activity_artifact() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-vad-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "speech activity",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-vad-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"source.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\nnot-a-real-video");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let (_, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;
    assert_eq!(upload_response["ok"], true);

    let (analyze_status, _) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/analyze"),
        None,
    )
    .await;
    assert_eq!(analyze_status, StatusCode::OK);

    let vad_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis")
        .join("vad-ranges.json");
    let vad_ranges: Value = serde_json::from_slice(&fs::read(vad_path).expect("vad ranges json"))
        .expect("vad ranges document");
    assert_eq!(vad_ranges["schemaId"], "video-cut.vad-ranges.schema.v1");
    assert_eq!(vad_ranges["taskId"], task_id);
    assert_eq!(
        vad_ranges["audioArtifactId"],
        format!("{task_id}-audio-source")
    );
    assert_eq!(vad_ranges["vadStatus"], "audio-unavailable");
    assert!(
        !vad_ranges["warnings"]
            .as_array()
            .expect("warnings")
            .is_empty()
    );

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    assert!(artifacts.iter().any(|artifact| {
        artifact["artifactId"] == format!("{task_id}-vad-ranges")
            && artifact["kind"] == "analysis"
            && artifact["path"]
                .as_str()
                .unwrap_or_default()
                .ends_with("analysis/vad-ranges.json")
    }));

    let (_, plan_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/plan"),
        None,
    )
    .await;
    let speech_activity_track = plan_response["data"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .find(|track| track["kind"] == "speechActivityTrack")
        .expect("speech activity track");
    assert_eq!(
        speech_activity_track["sourceArtifactId"],
        format!("{task_id}-vad-ranges")
    );
}

#[tokio::test]
async fn analyze_task_writes_standard_transcript_artifact() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-transcript-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "transcript",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-transcript-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"source.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\nnot-a-real-video");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let (_, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;
    assert_eq!(upload_response["ok"], true);

    let (analyze_status, _) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/analyze"),
        None,
    )
    .await;
    assert_eq!(analyze_status, StatusCode::OK);

    let transcript_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis")
        .join("transcript.json");
    let transcript: Value =
        serde_json::from_slice(&fs::read(transcript_path).expect("transcript json"))
            .expect("transcript document");
    assert_eq!(transcript["schemaId"], "video-cut.transcript.schema.v1");
    assert_eq!(transcript["taskId"], task_id);
    assert_eq!(
        transcript["audioArtifactId"],
        format!("{task_id}-audio-source")
    );
    assert_eq!(transcript["transcriptStatus"], "audio-unavailable");
    assert_eq!(
        transcript["segments"]
            .as_array()
            .expect("transcript segments")
            .len(),
        0
    );
    assert!(
        !transcript["warnings"]
            .as_array()
            .expect("warnings")
            .is_empty()
    );

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    assert!(artifacts.iter().any(|artifact| {
        artifact["artifactId"] == format!("{task_id}-transcript")
            && artifact["kind"] == "analysis"
            && artifact["path"]
                .as_str()
                .unwrap_or_default()
                .ends_with("analysis/transcript.json")
    }));

    let (_, plan_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/plan"),
        None,
    )
    .await;
    let transcript_track = plan_response["data"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .find(|track| track["kind"] == "transcriptTrack")
        .expect("transcript track");
    assert_eq!(
        transcript_track["sourceArtifactId"],
        format!("{task_id}-transcript")
    );
}

#[tokio::test]
async fn analyze_task_writes_standard_semantic_analysis_artifact() {
    let workspace_root = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-semantic-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "semantic",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let boundary = "video-cut-semantic-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"source.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\nnot-a-real-video");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let (_, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;
    assert_eq!(upload_response["ok"], true);

    let (analyze_status, _) = request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/analyze"),
        None,
    )
    .await;
    assert_eq!(analyze_status, StatusCode::OK);

    let semantic_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis")
        .join("semantic-analysis.json");
    let semantic: Value =
        serde_json::from_slice(&fs::read(semantic_path).expect("semantic analysis json"))
            .expect("semantic analysis document");
    assert_eq!(
        semantic["schemaId"],
        "video-cut.semantic-analysis.schema.v1"
    );
    assert_eq!(semantic["taskId"], task_id);
    assert_eq!(
        semantic["transcriptArtifactId"],
        format!("{task_id}-transcript")
    );
    assert_eq!(semantic["semanticStatus"], "transcript-unavailable");
    assert_eq!(semantic["topics"].as_array().expect("topics").len(), 0);
    assert_eq!(
        semantic["qaCandidates"]
            .as_array()
            .expect("qa candidates")
            .len(),
        0
    );
    assert!(
        !semantic["warnings"]
            .as_array()
            .expect("warnings")
            .is_empty()
    );

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    assert!(artifacts.iter().any(|artifact| {
        artifact["artifactId"] == format!("{task_id}-semantic-analysis")
            && artifact["kind"] == "analysis"
            && artifact["path"]
                .as_str()
                .unwrap_or_default()
                .ends_with("analysis/semantic-analysis.json")
    }));

    let (_, plan_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/plan"),
        None,
    )
    .await;
    let semantic_track = plan_response["data"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .find(|track| track["kind"] == "semanticTrack")
        .expect("semantic track");
    assert_eq!(
        semantic_track["sourceArtifactId"],
        format!("{task_id}-semantic-analysis")
    );
}

#[tokio::test]
async fn repeated_analyze_replaces_current_plan_and_media_info_artifacts() {
    let app = create_app();
    let create_body = json!({
        "title": "repeat analyze",
        "type": "single-speaker"
    });
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(create_body),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    request_json(
        &app,
        Method::POST,
        &format!("/api/video-cut/v1/tasks/{task_id}/source"),
        Some(json!({
            "sourceName": "local.mp4",
            "sizeBytes": 2048,
            "contentType": "video/mp4"
        })),
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");

    let (first_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    let (second_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;

    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::OK);

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) = request_json(&app, Method::GET, &artifacts_uri, None).await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");

    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-media-info"))
            .count(),
        1
    );
    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-plan"))
            .count(),
        1
    );
    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-audio-extract"))
            .count(),
        1
    );
    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-silence-ranges"))
            .count(),
        1
    );
    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-vad-ranges"))
            .count(),
        1
    );
    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-transcript"))
            .count(),
        1
    );
    assert_eq!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-semantic-analysis"))
            .count(),
        1
    );
    assert!(
        artifacts
            .iter()
            .filter(|artifact| artifact["artifactId"] == format!("{task_id}-audio-source"))
            .count()
            <= 1
    );
}

#[tokio::test]
async fn artifact_content_endpoint_serves_render_output_bytes_for_server_mode() {
    let workspace_root = temp_workspace("artifact-content");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "artifact content",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-artifact-content-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, _) = request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) = request_json(&app, Method::GET, &artifacts_uri, None).await;
    let render_artifact = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .find(|artifact| artifact["kind"] == "render")
        .expect("render artifact");
    let log_artifact = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .find(|artifact| artifact["kind"] == "log")
        .expect("log artifact");
    let artifact_id = render_artifact["artifactId"].as_str().expect("artifact id");
    let expected_size = render_artifact["sizeBytes"].as_u64().expect("size") as usize;

    let (content_status, headers, bytes) = request_bytes(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{artifact_id}/content"),
    )
    .await;

    assert_eq!(content_status, StatusCode::OK);
    assert_private_artifact_security_headers(&headers);
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("video/mp4")
    );
    assert_eq!(bytes.len(), expected_size);
    assert!(bytes.starts_with(&[0, 0, 0]));

    let (range_status, range_headers, range_bytes) = request_bytes_with_headers(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{artifact_id}/content"),
        &[("range", "bytes=0-11")],
    )
    .await;
    assert_eq!(range_status, StatusCode::PARTIAL_CONTENT);
    assert_private_artifact_security_headers(&range_headers);
    assert_eq!(
        range_headers
            .get("accept-ranges")
            .and_then(|value| value.to_str().ok()),
        Some("bytes")
    );
    let expected_content_range = format!("bytes 0-11/{expected_size}");
    assert_eq!(
        range_headers
            .get("content-range")
            .and_then(|value| value.to_str().ok()),
        Some(expected_content_range.as_str())
    );
    assert_eq!(
        range_headers
            .get("content-length")
            .and_then(|value| value.to_str().ok()),
        Some("12")
    );
    assert_eq!(range_bytes, bytes[0..12].to_vec());

    let unsatisfied_range = format!("bytes={expected_size}-{}", expected_size + 10);
    let (unsatisfied_status, unsatisfied_headers, _) = request_bytes_with_headers(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{artifact_id}/content"),
        &[("range", unsatisfied_range.as_str())],
    )
    .await;
    assert_eq!(unsatisfied_status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_private_artifact_security_headers(&unsatisfied_headers);
    let expected_unsatisfied_content_range = format!("bytes */{expected_size}");
    assert_eq!(
        unsatisfied_headers
            .get("content-range")
            .and_then(|value| value.to_str().ok()),
        Some(expected_unsatisfied_content_range.as_str())
    );

    let log_artifact_id = log_artifact["artifactId"]
        .as_str()
        .expect("log artifact id");
    let (log_status, log_headers, log_bytes) = request_bytes(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{log_artifact_id}/content"),
    )
    .await;
    assert_eq!(log_status, StatusCode::OK);
    assert_private_artifact_security_headers(&log_headers);
    assert_eq!(
        log_headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/plain")
    );
    assert!(String::from_utf8_lossy(&log_bytes).contains("renderId="));

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn render_task_failure_redacts_absolute_workspace_paths() {
    let workspace_root = temp_workspace("render-redaction");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "bad render source",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let boundary = "video-cut-render-redaction-boundary";
    let upload_body = multipart_file_body(
        boundary,
        "source.mp4",
        "video/mp4",
        b"not a valid video container",
    );
    let (upload_status, _) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        upload_body,
    )
    .await;
    assert_eq!(upload_status, StatusCode::OK);

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 0, 1000).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(render_response["ok"], false);
    assert_eq!(render_response["error"]["code"], "RENDER_FAILED");
    let workspace_literal = workspace_root.display().to_string();
    assert!(!render_response.to_string().contains(&workspace_literal));

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let log_artifact = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .find(|artifact| artifact["kind"] == "log")
        .expect("failed render log artifact");
    assert_eq!(log_artifact["renderId"], format!("{task_id}-render-1"));
    let render_log_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.log");
    let render_log = fs::read_to_string(render_log_path).expect("render log");
    assert!(!render_log.contains(&workspace_literal));
    assert!(render_log.contains("<source>"));

    let (_, events_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/events"),
        None,
    )
    .await;
    let events = events_response["data"].as_array().expect("events");
    let render_failure_event = events
        .iter()
        .rev()
        .find(|event| event["stage"] == "render" && event["level"] == "error")
        .expect("render failure event");
    assert_eq!(
        render_failure_event["metadata"]["recoveryHint"]["code"],
        "RENDER_FAILED_REVIEW_LOG"
    );
    assert_eq!(
        render_failure_event["metadata"]["recoveryHint"]["action"],
        "retry-render"
    );
    assert_eq!(
        render_failure_event["metadata"]["recoveryHint"]["label"],
        "Review render log and retry render"
    );
    assert_eq!(
        render_failure_event["metadata"]["recoveryHint"]["retryable"],
        true
    );
    assert!(
        !render_failure_event
            .to_string()
            .contains(&workspace_literal)
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn render_task_cuts_uploaded_source_file_into_real_output_artifact() {
    let workspace_root = temp_workspace("real-render");
    let source_fixture = workspace_root.join("fixture-source.mp4");
    generate_test_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "real render",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let boundary = "video-cut-real-render-boundary";
    let upload_body = multipart_file_body(boundary, "source.mp4", "video/mp4", &source_bytes);
    let (upload_status, upload_response) = request_multipart_json(
        &app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        upload_body,
    )
    .await;
    assert_eq!(upload_status, StatusCode::OK);
    assert_eq!(upload_response["data"]["kind"], "source");

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let mut plan = plan_response["data"].clone();
    plan["segments"][0]["sourceRange"] = json!({ "startMs": 500, "endMs": 1800 });
    plan["segments"][0]["outputRange"] = json!({ "startMs": 0, "endMs": 1300 });
    let (update_plan_status, _) =
        request_json(&app, Method::PUT, &plan_uri, Some(plan.clone())).await;
    assert_eq!(update_plan_status, StatusCode::OK);

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    assert_eq!(render_response["data"]["status"], "succeeded");

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) = request_json(&app, Method::GET, &artifacts_uri, None).await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    let render_artifact = artifacts
        .iter()
        .find(|artifact| artifact["kind"] == "render")
        .expect("render artifact");
    assert_eq!(render_artifact["renderId"], format!("{task_id}-render-1"));
    assert_eq!(
        render_artifact["path"],
        format!("workspace/projects/default/tasks/{task_id}/renders/{task_id}-render-1/output.mp4")
    );
    let output_size = render_artifact["sizeBytes"].as_u64().expect("render size");
    assert!(output_size > 0);

    let output_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("output.mp4");
    assert!(output_path.is_file(), "render output should exist");
    assert_eq!(
        fs::metadata(&output_path).expect("output metadata").len(),
        output_size
    );

    let probe_output = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(&output_path)
        .output()
        .expect("ffprobe output command");
    assert!(
        probe_output.status.success(),
        "render output should be probeable"
    );
    let duration = String::from_utf8_lossy(&probe_output.stdout)
        .trim()
        .parse::<f64>()
        .expect("render output duration");
    assert!(duration > 0.5);
    assert!(duration < 2.5);

    let log_artifact = artifacts
        .iter()
        .find(|artifact| artifact["kind"] == "log")
        .expect("render log artifact");
    assert_eq!(log_artifact["renderId"], format!("{task_id}-render-1"));
    let log_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.log");
    let render_log = fs::read_to_string(log_path).expect("render log");
    assert!(render_log.contains("renderId="));
    assert!(!render_log.contains("Authorization"));
    assert!(!render_log.contains("Bearer "));
    assert!(!render_log.contains("apiKey"));
    assert!(!render_log.contains("sk-plain"));

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn batch_render_task_creates_one_render_attempt_per_plan_segment() {
    let workspace_root = temp_workspace("batch-render");
    let source_fixture = workspace_root.join("batch-source.mp4");
    generate_test_mp4(&source_fixture, 4);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "batch render",
            "type": "long-interview"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_source_file(
        &app,
        task_id,
        "video-cut-batch-render-boundary",
        "batch-source.mp4",
        "video/mp4",
        source_bytes,
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let mut plan = plan_response["data"].clone();
    plan["outputSpec"]["width"] = json!(360);
    plan["outputSpec"]["height"] = json!(640);
    let mut first_segment = plan["segments"][0].clone();
    first_segment["segmentId"] = json!(format!("{task_id}-segment-1"));
    first_segment["sourceRange"] = json!({ "startMs": 500, "endMs": 1300 });
    first_segment["outputRange"] = json!({ "startMs": 0, "endMs": 800 });
    let mut second_segment = first_segment.clone();
    second_segment["segmentId"] = json!(format!("{task_id}-segment-2"));
    second_segment["sourceRange"] = json!({ "startMs": 1700, "endMs": 2600 });
    second_segment["outputRange"] = json!({ "startMs": 0, "endMs": 900 });
    plan["segments"] = json!([first_segment, second_segment]);
    let (update_plan_status, _) =
        request_json(&app, Method::PUT, &plan_uri, Some(plan.clone())).await;
    assert_eq!(update_plan_status, StatusCode::OK);

    let batch_render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render/batch");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &batch_render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK, "{render_response}");
    assert_eq!(render_response["data"]["status"], "succeeded");

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) = request_json(&app, Method::GET, &artifacts_uri, None).await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    let render_ids = artifacts
        .iter()
        .filter(|artifact| artifact["kind"] == "render")
        .map(|artifact| {
            artifact["renderId"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        render_ids,
        vec![format!("{task_id}-render-1"), format!("{task_id}-render-2")]
    );

    for (index, expected_range) in [(1, (500, 1300)), (2, (1700, 2600))] {
        let manifest_path = workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("renders")
            .join(format!("{task_id}-render-{index}"))
            .join("render.json");
        let manifest: Value =
            serde_json::from_slice(&fs::read(manifest_path).expect("render manifest"))
                .expect("render manifest json");
        assert_eq!(manifest["renderId"], format!("{task_id}-render-{index}"));
        assert_eq!(manifest["sourceRange"]["startMs"], expected_range.0);
        assert_eq!(manifest["sourceRange"]["endMs"], expected_range.1);
    }

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn analyze_task_generates_renderable_default_plan_from_media_duration() {
    let workspace_root = temp_workspace("renderable-plan-duration");
    let source_fixture = workspace_root.join("short-source.mp4");
    generate_test_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "renderable default plan",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_source_file(
        &app,
        task_id,
        "video-cut-renderable-plan-boundary",
        "short-source.mp4",
        "video/mp4",
        source_bytes,
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, analyze_response) =
        request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    assert_eq!(analyze_response["data"]["status"], "planReady");

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let source_range = &plan_response["data"]["segments"][0]["sourceRange"];
    assert_eq!(source_range["startMs"], 0);
    assert!(
        source_range["endMs"].as_u64().expect("end ms") <= 3_000,
        "default source range must fit inside the probed media duration"
    );
    assert_eq!(
        plan_response["data"]["segments"][0]["outputRange"]["endMs"],
        source_range["endMs"]
    );

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    assert_eq!(render_response["data"]["status"], "succeeded");
}

#[tokio::test]
async fn render_task_publishes_subtitle_ass_and_cover_artifacts_for_delivery_package() {
    let workspace_root = temp_workspace("render-package");
    let app = create_persistent_app(&workspace_root);
    let create_body = json!({
        "title": "delivery package",
        "type": "single-speaker"
    });
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(create_body),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-render-package-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    assert_eq!(render_response["data"]["status"], "succeeded");

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) = request_json(&app, Method::GET, &artifacts_uri, None).await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");

    let subtitle_artifact = artifacts
        .iter()
        .find(|artifact| artifact["kind"] == "subtitle")
        .expect("subtitle artifact");
    assert_eq!(subtitle_artifact["renderId"], format!("{task_id}-render-1"));
    assert_eq!(
        subtitle_artifact["path"],
        format!(
            "workspace/projects/default/tasks/{task_id}/renders/{task_id}-render-1/subtitles.ass"
        )
    );

    let cover_artifact = artifacts
        .iter()
        .find(|artifact| artifact["kind"] == "cover")
        .expect("cover artifact");
    assert_eq!(cover_artifact["renderId"], format!("{task_id}-render-1"));
    assert_eq!(
        cover_artifact["path"],
        format!("workspace/projects/default/tasks/{task_id}/renders/{task_id}-render-1/cover.png")
    );
    assert!(cover_artifact["sizeBytes"].as_u64().expect("cover size") > 0);

    let subtitle_id = subtitle_artifact["artifactId"]
        .as_str()
        .expect("subtitle id");
    let (subtitle_status, subtitle_headers, subtitle_bytes) = request_bytes(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{subtitle_id}/content"),
    )
    .await;
    assert_eq!(subtitle_status, StatusCode::OK);
    assert_eq!(
        subtitle_headers
            .get("content-type")
            .expect("subtitle content type"),
        "text/x-ssa"
    );
    let subtitle_text = String::from_utf8(subtitle_bytes).expect("subtitle ass");
    assert!(subtitle_text.contains("[Script Info]"));
    assert!(subtitle_text.contains("[Events]"));

    let cover_id = cover_artifact["artifactId"].as_str().expect("cover id");
    let (cover_status, cover_headers, cover_bytes) = request_bytes(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{cover_id}/content"),
    )
    .await;
    assert_eq!(cover_status, StatusCode::OK);
    assert_eq!(
        cover_headers
            .get("content-type")
            .expect("cover content type"),
        "image/png"
    );
    assert_eq!(&cover_bytes[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);

    let manifest_artifact = artifacts
        .iter()
        .find(|artifact| artifact["kind"] == "render-manifest")
        .expect("render manifest artifact");
    assert_eq!(manifest_artifact["renderId"], format!("{task_id}-render-1"));
    assert_eq!(
        manifest_artifact["path"],
        format!(
            "workspace/projects/default/tasks/{task_id}/renders/{task_id}-render-1/render.json"
        )
    );
    let manifest_id = manifest_artifact["artifactId"]
        .as_str()
        .expect("manifest id");
    let (manifest_status, manifest_headers, manifest_bytes) = request_bytes(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{manifest_id}/content"),
    )
    .await;
    assert_eq!(manifest_status, StatusCode::OK);
    assert_eq!(
        manifest_headers
            .get("content-type")
            .expect("manifest content type"),
        "application/json"
    );
    let manifest: Value = serde_json::from_slice(&manifest_bytes).expect("render manifest json");
    assert_eq!(manifest["schemaId"], "video-cut.render-attempt.schema.v1");
    assert_eq!(manifest["taskId"], task_id);
    assert_eq!(manifest["renderId"], format!("{task_id}-render-1"));
    assert_eq!(manifest["sourceArtifactId"], format!("{task_id}-source"));
    assert_eq!(
        manifest["outputArtifactId"],
        format!("{task_id}-render-1-output")
    );
    assert_eq!(
        manifest["subtitleArtifactId"],
        format!("{task_id}-render-1-subtitle")
    );
    assert_eq!(
        manifest["coverArtifactId"],
        format!("{task_id}-render-1-cover")
    );
    assert_eq!(manifest["logArtifactId"], format!("{task_id}-render-1-log"));
    assert_eq!(manifest["subtitleBurnIn"], true);
    assert_eq!(manifest["subtitleCueCount"], 0);
    assert_eq!(
        manifest["renderGraph"]["audioFilterPreset"],
        "voice-basic-loudnorm-afftdn.v1"
    );
    assert_eq!(
        manifest["renderGraph"]["voiceEnhancement"]["status"],
        "applied"
    );
    assert_eq!(
        manifest["renderGraph"]["voiceEnhancement"]["filters"],
        json!(["loudnorm", "afftdn"])
    );
    assert_eq!(manifest["renderGraph"]["bgm"]["volumePercent"], 20);
    assert_eq!(manifest["renderGraph"]["bgm"]["mixed"], false);
    assert_eq!(manifest["renderGraph"]["bgm"]["status"], "not-configured");
    assert_eq!(manifest["renderGraph"]["sfx"]["mixed"], false);

    let log_artifact = artifacts
        .iter()
        .find(|artifact| artifact["kind"] == "log")
        .expect("render log artifact");
    let log_id = log_artifact["artifactId"].as_str().expect("log id");
    let (log_status, _, log_bytes) = request_bytes(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts/{log_id}/content"),
    )
    .await;
    assert_eq!(log_status, StatusCode::OK);
    let log_text = String::from_utf8(log_bytes).expect("render log text");
    assert!(log_text.contains("audioFilterPreset=voice-basic-loudnorm-afftdn.v1"));
    assert!(log_text.contains("-af <standard-voice-enhancement-filter>"));

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn render_task_mixes_configured_bgm_and_sfx_assets_without_leaking_paths() {
    let workspace_root = temp_workspace("render-audio-assets");
    let bgm_dir = workspace_root.join("licensed-assets").join("bgm");
    let sfx_dir = workspace_root.join("licensed-assets").join("sfx");
    fs::create_dir_all(&bgm_dir).expect("bgm dir");
    fs::create_dir_all(&sfx_dir).expect("sfx dir");
    generate_test_wav(&bgm_dir.join("licensed-bgm.wav"), 440, 2);
    generate_test_wav(&sfx_dir.join("licensed-sfx.wav"), 880, 1);
    fs::write(
        bgm_dir.join("asset-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaId": "video-cut.asset-pack-manifest.v1",
            "assets": [{
                "path": "licensed-bgm.wav",
                "license": "CC0-1.0",
                "source": "https://example.invalid/sdkwork-bgm-pack",
                "version": "2026.04"
            }]
        }))
        .expect("bgm asset manifest json"),
    )
    .expect("bgm asset manifest");
    fs::write(
        sfx_dir.join("asset-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaId": "video-cut.asset-pack-manifest.v1",
            "assets": [{
                "path": "licensed-sfx.wav",
                "license": "CC0-1.0",
                "source": "https://example.invalid/sdkwork-sfx-pack",
                "version": "2026.04"
            }]
        }))
        .expect("sfx asset manifest json"),
    )
    .expect("sfx asset manifest");

    let app = create_persistent_app(&workspace_root);
    let (_, settings_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = settings_response["data"].clone();
    settings["assets"]["bgm"] = json!(bgm_dir.display().to_string());
    settings["assets"]["sfx"] = json!(sfx_dir.display().to_string());
    let (settings_status, settings_body) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(settings_status, StatusCode::OK);
    assert_eq!(settings_body["data"]["valid"], true);

    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "audio assets",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-render-audio-assets-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    assert_eq!(render_response["data"]["status"], "succeeded");

    let manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.json");
    let manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).expect("render manifest"))
            .expect("render manifest json");
    assert_eq!(manifest["renderGraph"]["bgm"]["status"], "mixed");
    assert_eq!(manifest["renderGraph"]["bgm"]["mixed"], true);
    assert_eq!(manifest["renderGraph"]["bgm"]["volumePercent"], 20);
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["path"],
        "assets://bgm/licensed-bgm.wav"
    );
    assert!(
        manifest["renderGraph"]["bgm"]["asset"]["assetId"]
            .as_str()
            .expect("bgm asset id")
            .starts_with("bgm-")
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["sha256"]
            .as_str()
            .expect("bgm sha")
            .len(),
        64
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["license"],
        "CC0-1.0"
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["source"],
        "https://example.invalid/sdkwork-bgm-pack"
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["version"],
        "2026.04"
    );
    assert_eq!(manifest["renderGraph"]["sfx"]["status"], "mixed");
    assert_eq!(manifest["renderGraph"]["sfx"]["mixed"], true);
    assert_eq!(
        manifest["renderGraph"]["sfx"]["asset"]["path"],
        "assets://sfx/licensed-sfx.wav"
    );
    assert!(
        manifest["renderGraph"]["sfx"]["asset"]["assetId"]
            .as_str()
            .expect("sfx asset id")
            .starts_with("sfx-")
    );
    assert_eq!(
        manifest["renderGraph"]["sfx"]["asset"]["license"],
        "CC0-1.0"
    );
    assert_eq!(
        manifest["renderGraph"]["sfx"]["asset"]["source"],
        "https://example.invalid/sdkwork-sfx-pack"
    );
    assert_eq!(
        manifest["renderGraph"]["sfx"]["asset"]["version"],
        "2026.04"
    );

    let render_log = fs::read_to_string(
        workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("renders")
            .join(format!("{task_id}-render-1"))
            .join("render.log"),
    )
    .expect("render log");
    assert!(render_log.contains("bgmStatus=mixed"));
    assert!(render_log.contains("sfxStatus=mixed"));
    assert!(render_log.contains("bgmAsset=assets://bgm/licensed-bgm.wav"));
    assert!(render_log.contains("sfxAsset=assets://sfx/licensed-sfx.wav"));
    assert!(render_log.contains("-filter_complex <standard-video-audio-mix-filter>"));
    assert!(!render_log.contains(&workspace_root.display().to_string()));
    assert!(
        !manifest
            .to_string()
            .contains(&workspace_root.display().to_string())
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn render_task_uses_plan_selected_audio_assets_without_leaking_paths() {
    let workspace_root = temp_workspace("render-selected-audio-assets");
    let bgm_dir = workspace_root.join("licensed-assets").join("bgm");
    let sfx_dir = workspace_root.join("licensed-assets").join("sfx");
    fs::create_dir_all(&bgm_dir).expect("bgm dir");
    fs::create_dir_all(&sfx_dir).expect("sfx dir");
    generate_test_wav(&bgm_dir.join("first-bgm.wav"), 330, 2);
    generate_test_wav(&bgm_dir.join("selected-bgm.wav"), 660, 2);
    generate_test_wav(&sfx_dir.join("licensed-sfx.wav"), 880, 1);
    fs::write(
        bgm_dir.join("asset-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaId": "video-cut.asset-pack-manifest.v1",
            "assets": [
                {
                    "path": "first-bgm.wav",
                    "license": "CC0-1.0",
                    "source": "https://example.invalid/sdkwork-bgm-pack",
                    "version": "2026.04"
                },
                {
                    "path": "selected-bgm.wav",
                    "license": "CC0-1.0",
                    "source": "https://example.invalid/sdkwork-selected-bgm-pack",
                    "version": "2026.05"
                }
            ]
        }))
        .expect("bgm asset manifest json"),
    )
    .expect("bgm asset manifest");
    fs::write(
        sfx_dir.join("asset-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaId": "video-cut.asset-pack-manifest.v1",
            "assets": [{
                "path": "licensed-sfx.wav",
                "license": "CC0-1.0",
                "source": "https://example.invalid/sdkwork-sfx-pack",
                "version": "2026.04"
            }]
        }))
        .expect("sfx asset manifest json"),
    )
    .expect("sfx asset manifest");

    let app = create_persistent_app(&workspace_root);
    let (_, settings_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = settings_response["data"].clone();
    settings["assets"]["bgm"] = json!(bgm_dir.display().to_string());
    settings["assets"]["sfx"] = json!(sfx_dir.display().to_string());
    let (settings_status, settings_body) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(settings_status, StatusCode::OK);
    assert_eq!(settings_body["data"]["valid"], true);

    let (_, catalog_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/assets/catalog", None).await;
    let bgm_slot = catalog_response["data"]["slots"]
        .as_array()
        .expect("catalog slots")
        .iter()
        .find(|slot| slot["kind"] == "bgm")
        .expect("bgm slot");
    let selected_bgm = bgm_slot["entries"]
        .as_array()
        .expect("bgm entries")
        .iter()
        .find(|entry| entry["fileName"] == "selected-bgm.wav")
        .expect("selected bgm catalog entry");

    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "selected audio assets",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-render-selected-audio-assets-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let mut plan = plan_response["data"].clone();
    plan["planRevision"] = json!(plan["planRevision"].as_u64().expect("plan revision") + 1);
    plan["renderPreferences"]["audio"]["bgm"] = json!({
        "mode": "asset",
        "assetId": selected_bgm["assetId"],
        "path": selected_bgm["path"]
    });
    plan["renderPreferences"]["audio"]["sfx"] = json!({ "mode": "disabled" });
    let (update_plan_status, update_plan_response) =
        request_json(&app, Method::PUT, &plan_uri, Some(plan.clone())).await;
    assert_eq!(update_plan_status, StatusCode::OK, "{update_plan_response}");

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK, "{render_response}");

    let manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.json");
    let manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).expect("render manifest"))
            .expect("render manifest json");
    assert_eq!(manifest["renderGraph"]["bgm"]["status"], "mixed");
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["assetId"],
        selected_bgm["assetId"]
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["path"],
        "assets://bgm/selected-bgm.wav"
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["source"],
        "https://example.invalid/sdkwork-selected-bgm-pack"
    );
    assert_eq!(
        manifest["renderGraph"]["bgm"]["asset"]["version"],
        "2026.05"
    );
    assert_eq!(manifest["renderGraph"]["sfx"]["status"], "disabled");
    assert_eq!(manifest["renderGraph"]["sfx"]["mixed"], false);
    assert!(manifest["renderGraph"]["sfx"].get("asset").is_none());

    let render_log = fs::read_to_string(
        workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("renders")
            .join(format!("{task_id}-render-1"))
            .join("render.log"),
    )
    .expect("render log");
    assert!(render_log.contains("bgmAsset=assets://bgm/selected-bgm.wav"));
    assert!(render_log.contains("sfxStatus=disabled"));
    assert!(!render_log.contains("first-bgm.wav"));
    assert!(!render_log.contains(&workspace_root.display().to_string()));
    assert!(
        !manifest
            .to_string()
            .contains(&workspace_root.display().to_string())
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn render_task_burns_transcript_backed_ass_subtitles_into_output_mp4() {
    let workspace_root = temp_workspace("subtitle-burn");
    let source_fixture = workspace_root.join("black-source.mp4");
    generate_black_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "subtitle burn",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_source_file(
        &app,
        task_id,
        "video-cut-subtitle-burn-boundary",
        "black-source.mp4",
        "video/mp4",
        source_bytes,
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    overwrite_transcript_with_ok_segment(&workspace_root, task_id);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    assert_eq!(render_response["data"]["status"], "succeeded");

    let output_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("output.mp4");
    let bright_pixels = count_bright_pixels_in_bottom_third(&output_path);
    assert!(
        bright_pixels > 100,
        "burned subtitle should introduce bright pixels in a black source frame, got {bright_pixels}"
    );

    let render_log = fs::read_to_string(
        workspace_root
            .join("projects")
            .join("default")
            .join("tasks")
            .join(task_id)
            .join("renders")
            .join(format!("{task_id}-render-1"))
            .join("render.log"),
    )
    .expect("render log");
    assert!(render_log.contains("subtitleBurnIn=true"));
    assert!(!render_log.contains(&workspace_root.display().to_string()));

    let manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.json");
    let manifest: Value =
        serde_json::from_slice(&fs::read(manifest_path).expect("render manifest"))
            .expect("render manifest json");
    assert_eq!(manifest["subtitleBurnIn"], true);
    assert_eq!(manifest["subtitleCueCount"], 1);

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn put_manual_transcript_writes_standard_artifact_and_drives_subtitle_burn_in() {
    let workspace_root = temp_workspace("manual-transcript");
    let source_fixture = workspace_root.join("manual-transcript-source.mp4");
    generate_black_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "manual transcript",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_source_file(
        &app,
        task_id,
        "video-cut-manual-transcript-boundary",
        "manual-transcript-source.mp4",
        "video/mp4",
        source_bytes,
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let transcript_uri = format!("/api/video-cut/v1/tasks/{task_id}/transcript");
    let (transcript_status, transcript_response) = request_json(
        &app,
        Method::PUT,
        &transcript_uri,
        Some(json!({
            "language": "en",
            "segments": [
                {
                    "startMs": 500,
                    "endMs": 1800,
                    "text": "Manual subtitle"
                }
            ]
        })),
    )
    .await;
    assert_eq!(transcript_status, StatusCode::OK);
    assert_eq!(
        transcript_response["data"]["schemaId"],
        "video-cut.transcript.schema.v1"
    );
    assert_eq!(transcript_response["data"]["transcriptStatus"], "ok");
    assert_eq!(
        transcript_response["data"]["providerId"],
        "manual-transcript"
    );
    assert_eq!(
        transcript_response["data"]["segments"][0]["text"],
        "Manual subtitle"
    );

    let transcript_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("analysis")
        .join("transcript.json");
    let transcript: Value =
        serde_json::from_slice(&fs::read(transcript_path).expect("transcript json"))
            .expect("transcript document");
    assert_eq!(transcript["providerId"], "manual-transcript");
    assert_eq!(transcript["segments"][0]["startMs"], 500);

    let (_, artifacts_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}/artifacts"),
        None,
    )
    .await;
    let transcript_artifacts = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .filter(|artifact| artifact["artifactId"] == format!("{task_id}-transcript"))
        .count();
    assert_eq!(transcript_artifacts, 1);

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, _) = request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    let output_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("output.mp4");
    let bright_pixels = count_bright_pixels_in_bottom_third(&output_path);
    assert!(
        bright_pixels > 100,
        "manual transcript subtitle should burn into output, got {bright_pixels}"
    );

    let manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.json");
    let manifest: Value =
        serde_json::from_slice(&fs::read(manifest_path).expect("render manifest"))
            .expect("render manifest json");
    assert_eq!(manifest["subtitleCueCount"], 1);
    assert_eq!(
        manifest["transcriptArtifactId"],
        format!("{task_id}-transcript")
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn subtitle_import_and_export_support_srt_and_vtt_standard_adapters() {
    let workspace_root = temp_workspace("subtitle-import-export");
    let source_fixture = workspace_root.join("subtitle-source.mp4");
    generate_black_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "subtitle import export",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_source_file(
        &app,
        task_id,
        "video-cut-subtitle-import-boundary",
        "subtitle-source.mp4",
        "video/mp4",
        source_bytes,
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);

    let import_uri = format!("/api/video-cut/v1/tasks/{task_id}/subtitles/import");
    let (import_status, import_response) = request_json(
        &app,
        Method::PUT,
        &import_uri,
        Some(json!({
            "format": "srt",
            "language": "en",
            "content": "1\n00:00:00,500 --> 00:00:01,800\nHello world\n\n2\n00:00:02,000 --> 00:00:02,700\nSecond cue\n"
        })),
    )
    .await;
    assert_eq!(import_status, StatusCode::OK);
    assert_eq!(
        import_response["data"]["schemaId"],
        "video-cut.transcript.schema.v1"
    );
    assert_eq!(import_response["data"]["providerId"], "subtitle-import-srt");
    assert_eq!(import_response["data"]["segments"][0]["startMs"], 500);
    assert_eq!(import_response["data"]["segments"][0]["endMs"], 1800);
    assert_eq!(
        import_response["data"]["segments"][0]["text"],
        "Hello world"
    );

    let export_uri = format!("/api/video-cut/v1/tasks/{task_id}/subtitles/export?format=vtt");
    let (export_status, export_response) = request_json(&app, Method::GET, &export_uri, None).await;
    assert_eq!(export_status, StatusCode::OK);
    assert_eq!(export_response["data"]["format"], "vtt");
    let content = export_response["data"]["content"]
        .as_str()
        .expect("export content");
    assert!(content.starts_with("WEBVTT"));
    assert!(content.contains("00:00:00.500 --> 00:00:01.800"));
    assert!(content.contains("Hello world"));

    replace_first_plan_range(&app, task_id, 500, 1800).await;
    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, _) = request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK);
    let manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("renders")
        .join(format!("{task_id}-render-1"))
        .join("render.json");
    let manifest: Value =
        serde_json::from_slice(&fs::read(manifest_path).expect("render manifest"))
            .expect("render manifest json");
    assert_eq!(manifest["subtitleCueCount"], 1);

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn subtitle_import_rejects_overlapping_cues_before_replacing_transcript() {
    let workspace_root = temp_workspace("subtitle-overlap");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "subtitle overlap",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");

    let import_uri = format!("/api/video-cut/v1/tasks/{task_id}/subtitles/import");
    let (import_status, import_response) = request_json(
        &app,
        Method::PUT,
        &import_uri,
        Some(json!({
            "format": "vtt",
            "content": "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFirst\n\n00:00:01.500 --> 00:00:03.000\nOverlap\n"
        })),
    )
    .await;

    assert_eq!(import_status, StatusCode::BAD_REQUEST);
    assert_eq!(import_response["ok"], false);
    assert_eq!(import_response["error"]["code"], "SUBTITLE_INVALID");

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn render_task_supports_relative_workspace_root_with_subtitle_burn_in() {
    let relative_workspace = PathBuf::from(format!(
        "target/sdkwork-video-cut-relative-workspace-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let _ = fs::remove_dir_all(&relative_workspace);
    fs::create_dir_all(&relative_workspace).expect("relative workspace");
    let source_fixture = relative_workspace.join("relative-source.mp4");
    generate_test_mp4(&source_fixture, 3);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let app = create_persistent_app(&relative_workspace);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "relative workspace render",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_source_file(
        &app,
        task_id,
        "video-cut-relative-render-boundary",
        "relative-source.mp4",
        "video/mp4",
        source_bytes,
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK, "{render_response}");
    assert_eq!(render_response["data"]["status"], "succeeded");

    let _ = fs::remove_dir_all(relative_workspace);
}

#[tokio::test]
async fn repeated_render_creates_distinct_render_attempt_artifacts() {
    let workspace_root = temp_workspace("repeat-render");
    let app = create_persistent_app(&workspace_root);
    let create_body = json!({
        "title": "repeat render",
        "type": "long-interview"
    });
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(create_body),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-repeat-render-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    request_json(&app, Method::POST, &analyze_uri, None).await;
    replace_first_plan_range(&app, task_id, 500, 1800).await;
    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");

    let (first_status, _) = request_json(&app, Method::POST, &render_uri, None).await;
    let (second_status, _) = request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::OK);

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) = request_json(&app, Method::GET, &artifacts_uri, None).await;
    let render_ids = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .filter(|artifact| artifact["kind"] == "render")
        .map(|artifact| {
            artifact["renderId"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect::<Vec<_>>();

    assert_eq!(
        render_ids,
        vec![format!("{task_id}-render-1"), format!("{task_id}-render-2")]
    );

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn analyzing_tasks_reject_duplicate_analyze_requests() {
    let workspace_root = temp_workspace("analyze-conflict");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "concurrent analyze",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-analyze-conflict-boundary",
    )
    .await;
    overwrite_task_manifest_status(&workspace_root, task_id, "analyzing", "analyze");

    let restarted_app = create_persistent_app(&workspace_root);
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, analyze_response) =
        request_json(&restarted_app, Method::POST, &analyze_uri, None).await;

    assert_eq!(analyze_status, StatusCode::CONFLICT);
    assert_eq!(analyze_response["error"]["code"], "ANALYZE_ALREADY_RUNNING");

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn cancelled_tasks_reject_render_requests_without_overwriting_status() {
    let workspace_root = temp_workspace("cancelled-render");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "cancelled render",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-cancelled-render-boundary",
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;
    overwrite_task_manifest_status(&workspace_root, task_id, "cancelled", "cancelled");

    let restarted_app = create_persistent_app(&workspace_root);
    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&restarted_app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::CONFLICT);
    assert_eq!(render_response["error"]["code"], "TASK_CANCELLED");

    let (_, task_response) = request_json(
        &restarted_app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}"),
        None,
    )
    .await;
    assert_eq!(task_response["data"]["status"], "cancelled");

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn terminal_tasks_reject_cancel_without_overwriting_status() {
    let workspace_root = temp_workspace("terminal-cancel-guard");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "terminal cancel guard",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-terminal-cancel-boundary",
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;
    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, render_response) =
        request_json(&app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::OK, "{render_response}");
    assert_eq!(render_response["data"]["status"], "succeeded");

    let cancel_uri = format!("/api/video-cut/v1/tasks/{task_id}/cancel");
    let (cancel_status, cancel_response) =
        request_json(&app, Method::POST, &cancel_uri, None).await;
    assert_eq!(cancel_status, StatusCode::CONFLICT);
    assert_eq!(cancel_response["error"]["code"], "TASK_TERMINAL");

    let (_, task_response) = request_json(
        &app,
        Method::GET,
        &format!("/api/video-cut/v1/tasks/{task_id}"),
        None,
    )
    .await;
    assert_eq!(task_response["data"]["status"], "succeeded");
    assert_eq!(task_response["data"]["currentStage"], "artifact");

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn rendering_tasks_reject_plan_transcript_and_subtitle_mutations_without_overwriting_status()
{
    let workspace_root = temp_workspace("rendering-edit-guard");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "rendering edit guard",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-rendering-edit-guard-boundary",
    )
    .await;
    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(&app, Method::GET, &plan_uri, None).await;
    let plan_before = plan_response["data"].clone();
    overwrite_task_manifest_status(&workspace_root, task_id, "rendering", "render");

    let restarted_app = create_persistent_app(&workspace_root);
    let (plan_update_status, plan_update_response) =
        request_json(&restarted_app, Method::PUT, &plan_uri, Some(plan_before)).await;
    assert_eq!(plan_update_status, StatusCode::CONFLICT);
    assert_eq!(plan_update_response["error"]["code"], "TASK_BUSY");

    let transcript_uri = format!("/api/video-cut/v1/tasks/{task_id}/transcript");
    let (transcript_status, transcript_response) = request_json(
        &restarted_app,
        Method::PUT,
        &transcript_uri,
        Some(json!({
            "language": "en",
            "segments": [
                {
                    "startMs": 500,
                    "endMs": 1800,
                    "text": "Should not replace while rendering"
                }
            ]
        })),
    )
    .await;
    assert_eq!(transcript_status, StatusCode::CONFLICT);
    assert_eq!(transcript_response["error"]["code"], "TASK_BUSY");

    let import_uri = format!("/api/video-cut/v1/tasks/{task_id}/subtitles/import");
    let (subtitle_status, subtitle_response) = request_json(
        &restarted_app,
        Method::PUT,
        &import_uri,
        Some(json!({
            "format": "srt",
            "language": "en",
            "content": "1\n00:00:00,500 --> 00:00:01,800\nShould not import\n"
        })),
    )
    .await;
    assert_eq!(subtitle_status, StatusCode::CONFLICT);
    assert_eq!(subtitle_response["error"]["code"], "TASK_BUSY");

    let export_uri = format!("/api/video-cut/v1/tasks/{task_id}/subtitles/export?format=vtt");
    let (export_status, export_response) =
        request_json(&restarted_app, Method::GET, &export_uri, None).await;
    assert_eq!(export_status, StatusCode::CONFLICT);
    assert_eq!(export_response["error"]["code"], "TASK_BUSY");

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) =
        request_json(&restarted_app, Method::GET, &artifacts_uri, None).await;
    let exported_subtitles = artifacts_response["data"]
        .as_array()
        .expect("artifacts")
        .iter()
        .filter(|artifact| {
            artifact["artifactId"]
                .as_str()
                .unwrap_or_default()
                .starts_with(&format!("{task_id}-subtitle-export-"))
        })
        .count();
    assert_eq!(exported_subtitles, 0);

    let task_uri = format!("/api/video-cut/v1/tasks/{task_id}");
    let (delete_status, delete_response) =
        request_json(&restarted_app, Method::DELETE, &task_uri, None).await;
    assert_eq!(delete_status, StatusCode::CONFLICT);
    assert_eq!(delete_response["error"]["code"], "TASK_BUSY");

    let (_, task_response) = request_json(&restarted_app, Method::GET, &task_uri, None).await;
    assert_eq!(task_response["data"]["status"], "rendering");
    assert_eq!(task_response["data"]["currentStage"], "render");

    let _ = fs::remove_dir_all(workspace_root);
}

#[tokio::test]
async fn rendering_tasks_reject_new_render_requests_and_normalize_duplicate_artifacts() {
    let workspace_root = temp_workspace("rendering-render-dedup");
    let app = create_persistent_app(&workspace_root);
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "concurrent render",
            "type": "single-speaker"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(
        &app,
        &workspace_root,
        task_id,
        "video-cut-rendering-dedup-boundary",
    )
    .await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let (analyze_status, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    assert_eq!(analyze_status, StatusCode::OK);
    replace_first_plan_range(&app, task_id, 500, 1800).await;

    let task_manifest_path = workspace_root
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("task.json");
    let mut task_manifest: Value =
        serde_json::from_slice(&fs::read(&task_manifest_path).expect("task manifest"))
            .expect("task manifest json");
    task_manifest["task"]["status"] = json!("rendering");
    task_manifest["task"]["currentStage"] = json!("render");
    let duplicate_artifact = task_manifest["artifacts"][0].clone();
    task_manifest["artifacts"]
        .as_array_mut()
        .expect("artifacts")
        .push(duplicate_artifact);
    fs::write(
        &task_manifest_path,
        serde_json::to_vec_pretty(&task_manifest).expect("task manifest bytes"),
    )
    .expect("write task manifest");

    let restarted_app = create_persistent_app(&workspace_root);
    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (render_status, conflict_response) =
        request_json(&restarted_app, Method::POST, &render_uri, None).await;
    assert_eq!(render_status, StatusCode::CONFLICT);
    assert_eq!(conflict_response["error"]["code"], "RENDER_ALREADY_RUNNING");

    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");
    let (_, artifacts_response) =
        request_json(&restarted_app, Method::GET, &artifacts_uri, None).await;
    let artifacts = artifacts_response["data"].as_array().expect("artifacts");
    let mut artifact_ids = std::collections::HashSet::new();
    for artifact in artifacts {
        let artifact_id = artifact["artifactId"].as_str().expect("artifact id");
        assert!(
            artifact_ids.insert(artifact_id.to_string()),
            "duplicate artifactId returned: {artifact_id}"
        );
    }
    let _ = fs::remove_dir_all(workspace_root);
}
