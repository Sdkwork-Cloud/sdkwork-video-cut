use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use sdkwork_video_cut_host::create_persistent_app;

fn temp_workspace(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "sdkwork-video-cut-workspace-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("workspace");
    path
}

fn generate_test_mp4(path: &Path) {
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
        .arg("3")
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

async fn upload_test_source_mp4(app: &Router, workspace: &Path, task_id: &str) {
    let source_fixture = workspace.join("manifest-fixture-source.mp4");
    generate_test_mp4(&source_fixture);
    let source_bytes = fs::read(&source_fixture).expect("source fixture");
    let boundary = "video-cut-manifest-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"source.mp4\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\n");
    body.extend_from_slice(&source_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let (upload_status, upload_response) = request_multipart_json(
        app,
        &format!("/api/video-cut/v1/tasks/{task_id}/source/file"),
        boundary,
        body,
    )
    .await;
    assert_eq!(upload_status, StatusCode::OK);
    assert_eq!(upload_response["data"]["kind"], "source");
}

async fn replace_first_plan_range(app: &Router, task_id: &str) {
    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let (_, plan_response) = request_json(app, Method::GET, &plan_uri, None).await;
    let mut plan = plan_response["data"].clone();
    plan["segments"][0]["sourceRange"] = json!({ "startMs": 500, "endMs": 1800 });
    plan["segments"][0]["outputRange"] = json!({ "startMs": 0, "endMs": 1300 });
    let (update_plan_status, _) = request_json(app, Method::PUT, &plan_uri, Some(plan)).await;
    assert_eq!(update_plan_status, StatusCode::OK);
}

#[tokio::test]
async fn task_creation_writes_versioned_workspace_manifest() {
    let workspace = temp_workspace("write-manifest");
    let app = create_persistent_app(workspace.clone());
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "local",
            "type": "long-interview"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    let manifest_path = workspace
        .join("projects")
        .join("default")
        .join("tasks")
        .join(task_id)
        .join("task.json");

    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(&manifest_path).expect("manifest"))
            .expect("manifest json");

    assert_eq!(manifest["taskManifestVersion"], 1);
    assert_eq!(manifest["task"]["taskId"], task_id);
    assert_eq!(manifest["task"]["status"], "draft");
    assert_eq!(manifest["task"]["progress"], 0);
    assert!(manifest["task"]["sourceName"].is_null());
    assert_eq!(
        manifest["artifacts"].as_array().expect("artifacts").len(),
        0
    );
    assert!(manifest_path.with_file_name("events.jsonl").is_file());

    let _ = fs::remove_dir_all(workspace);
}

#[tokio::test]
async fn persistent_app_recovers_tasks_plans_events_and_artifacts_after_restart() {
    let workspace = temp_workspace("reload-manifest");
    let app = create_persistent_app(workspace.clone());
    let (_, create_response) = request_json(
        &app,
        Method::POST,
        "/api/video-cut/v1/tasks",
        Some(json!({
            "title": "local",
            "type": "long-interview"
        })),
    )
    .await;
    let task_id = create_response["data"]["taskId"].as_str().expect("task id");
    upload_test_source_mp4(&app, &workspace, task_id).await;

    let analyze_uri = format!("/api/video-cut/v1/tasks/{task_id}/analyze");
    let render_uri = format!("/api/video-cut/v1/tasks/{task_id}/render");
    let (_, _) = request_json(&app, Method::POST, &analyze_uri, None).await;
    replace_first_plan_range(&app, task_id).await;
    let (_, _) = request_json(&app, Method::POST, &render_uri, None).await;

    let restarted_app = create_persistent_app(workspace.clone());
    let task_uri = format!("/api/video-cut/v1/tasks/{task_id}");
    let plan_uri = format!("/api/video-cut/v1/tasks/{task_id}/plan");
    let events_uri = format!("/api/video-cut/v1/tasks/{task_id}/events");
    let artifacts_uri = format!("/api/video-cut/v1/tasks/{task_id}/artifacts");

    let (task_status, task_response) =
        request_json(&restarted_app, Method::GET, &task_uri, None).await;
    assert_eq!(task_status, StatusCode::OK);
    assert_eq!(task_response["data"]["status"], "succeeded");

    let (plan_status, plan_response) =
        request_json(&restarted_app, Method::GET, &plan_uri, None).await;
    assert_eq!(plan_status, StatusCode::OK);
    assert_eq!(
        plan_response["data"]["schemaId"],
        "video-cut.split-plan.schema.v1"
    );

    let (events_status, events_response) =
        request_json(&restarted_app, Method::GET, &events_uri, None).await;
    assert_eq!(events_status, StatusCode::OK);
    assert!(events_response["data"].as_array().expect("events").len() >= 3);

    let (artifacts_status, artifacts_response) =
        request_json(&restarted_app, Method::GET, &artifacts_uri, None).await;
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

    let _ = fs::remove_dir_all(workspace);
}

#[tokio::test]
async fn persistent_app_saves_settings_without_plaintext_secret_fields() {
    let workspace = temp_workspace("settings-manifest");
    let app = create_persistent_app(workspace.clone());
    let (_, settings_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = settings_response["data"].clone();
    settings["ai"]["enabled"] = json!(true);
    settings["ai"]["apiKeyConfigured"] = json!(true);
    settings["ai"]["apiKey"] = json!("sk-plain-text-should-not-persist");
    settings["ai"]["chatModel"] = json!("gpt-4.1-mini");
    settings["speechToText"]["enabled"] = json!(true);
    settings["speechToText"]["reuseAiProviderConnection"] = json!(true);

    let (put_status, put_response) = request_json(
        &app,
        Method::PUT,
        "/api/video-cut/v1/settings",
        Some(settings),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(put_response["data"]["valid"], true);

    let settings_path = workspace.join("runtime").join("settings.json");
    let raw_settings = fs::read_to_string(&settings_path).expect("settings manifest");
    assert!(!raw_settings.contains("sk-plain-text-should-not-persist"));

    let settings_manifest: Value =
        serde_json::from_str(&raw_settings).expect("settings manifest json");
    assert_eq!(settings_manifest["runtimeSettingsVersion"], 1);
    assert_eq!(settings_manifest["settings"]["ai"]["enabled"], true);
    assert_eq!(
        settings_manifest["settings"]["ai"]["apiKeyConfigured"],
        true
    );
    assert!(settings_manifest["settings"]["ai"]["apiKey"].is_null());

    let restarted_app = create_persistent_app(workspace.clone());
    let (_, restarted_settings_response) = request_json(
        &restarted_app,
        Method::GET,
        "/api/video-cut/v1/settings",
        None,
    )
    .await;
    assert_eq!(restarted_settings_response["data"]["ai"]["enabled"], true);
    assert_eq!(
        restarted_settings_response["data"]["ai"]["apiKeyConfigured"],
        true
    );
    assert!(restarted_settings_response["data"]["ai"]["apiKey"].is_null());

    let _ = fs::remove_dir_all(workspace);
}

#[tokio::test]
async fn persistent_app_normalizes_runtime_settings_with_new_default_fields() {
    let workspace = temp_workspace("settings-normalization");
    let app = create_persistent_app(workspace.clone());
    let (_, settings_response) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    let mut settings = settings_response["data"].clone();
    settings["speechToText"]
        .as_object_mut()
        .expect("speech settings")
        .remove("providerProfile");
    settings["speechToText"]
        .as_object_mut()
        .expect("speech settings")
        .remove("resourceId");

    let settings_path = workspace.join("runtime").join("settings.json");
    fs::create_dir_all(settings_path.parent().expect("settings parent")).expect("runtime dir");
    fs::write(
        &settings_path,
        serde_json::to_vec_pretty(&json!({
            "runtimeSettingsVersion": 1,
            "settings": settings,
            "updatedAt": "2026-04-27T00:00:00.000Z"
        }))
        .expect("settings json"),
    )
    .expect("write settings");

    let restarted_app = create_persistent_app(workspace.clone());
    let (_, restarted_settings_response) = request_json(
        &restarted_app,
        Method::GET,
        "/api/video-cut/v1/settings",
        None,
    )
    .await;

    assert_eq!(
        restarted_settings_response["data"]["speechToText"]["providerProfile"],
        "openai-audio-transcriptions"
    );
    assert_eq!(
        restarted_settings_response["data"]["speechToText"]["resourceId"],
        "volc.bigasr.auc"
    );

    let (_, doctor_response) = request_json(
        &restarted_app,
        Method::GET,
        "/api/video-cut/v1/doctor",
        None,
    )
    .await;
    let validation = doctor_response["data"]["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .find(|check| check["checkId"] == "settingsValidation")
        .expect("settings validation");
    assert_eq!(validation["status"], "ok");

    let _ = fs::remove_dir_all(workspace);
}
