use std::collections::HashMap;

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

use sdkwork_video_cut_host::create_persistent_app_with_runtime_config;
use sdkwork_video_cut_host::runtime_config::RuntimeHostConfig;

fn env(values: &[(&str, &str)]) -> HashMap<String, String> {
    values
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

async fn request_json(
    app: &Router,
    method: Method,
    uri: &str,
    authorization: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(authorization) = authorization {
        builder = builder.header("authorization", authorization);
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::empty()).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    let json = serde_json::from_slice(&bytes).expect("json body");

    (status, json)
}

#[tokio::test]
async fn single_user_token_auth_protects_private_api_except_health() {
    let config = RuntimeHostConfig::from_env_map(&env(&[
        ("SDKWORK_VIDEO_CUT_RUNTIME_MODE", "server-private"),
        ("SDKWORK_VIDEO_CUT_BIND_HOST", "127.0.0.1"),
        ("SDKWORK_VIDEO_CUT_PORT", "6177"),
        ("SDKWORK_VIDEO_CUT_AUTH_MODE", "single-user-token"),
        ("SDKWORK_VIDEO_CUT_SERVER_TOKEN", "server-token"),
    ]))
    .expect("runtime config");
    let app = create_persistent_app_with_runtime_config(config);

    let (health_status, health_body) =
        request_json(&app, Method::GET, "/api/video-cut/v1/health", None).await;
    assert_eq!(health_status, StatusCode::OK);
    assert_eq!(health_body["ok"], true);

    let (missing_status, missing_body) =
        request_json(&app, Method::GET, "/api/video-cut/v1/settings", None).await;
    assert_eq!(missing_status, StatusCode::UNAUTHORIZED);
    assert_eq!(missing_body["ok"], false);
    assert_eq!(missing_body["error"]["code"], "AUTH_REQUIRED");

    let (wrong_status, wrong_body) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/settings",
        Some("Bearer wrong-token"),
    )
    .await;
    assert_eq!(wrong_status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong_body["error"]["code"], "AUTH_INVALID");

    let (ok_status, ok_body) = request_json(
        &app,
        Method::GET,
        "/api/video-cut/v1/settings",
        Some("Bearer server-token"),
    )
    .await;
    assert_eq!(ok_status, StatusCode::OK);
    assert_eq!(ok_body["ok"], true);
}
