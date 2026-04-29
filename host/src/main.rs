use std::net::SocketAddr;

use sdkwork_video_cut_host::create_persistent_app_with_runtime_config;
use sdkwork_video_cut_host::runtime_config::RuntimeHostConfig;

#[tokio::main]
async fn main() {
    let config = RuntimeHostConfig::from_process_env().expect("load video cut runtime config");
    let addr: SocketAddr = config.bind_addr;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind video cut host");

    println!("sdkwork-video-cut host listening on http://{addr}");
    axum::serve(listener, create_persistent_app_with_runtime_config(config))
        .await
        .expect("serve video cut host");
}
