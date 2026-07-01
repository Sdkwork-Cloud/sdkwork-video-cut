use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();
    emit_framework_contract_env();
}

fn emit_framework_contract_env() {
    let manifest_path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("../../../database/database.manifest.json");
    let baseline_path = manifest_path
        .parent()
        .expect("database dir")
        .join("ddl/baseline/sqlite/0001_videocut_baseline.sql");

    println!("cargo:rerun-if-changed={}", manifest_path.display());
    println!("cargo:rerun-if-changed={}", baseline_path.display());

    let manifest_raw =
        fs::read_to_string(&manifest_path).expect("read sdkwork-video-cut database manifest");
    let contract_version =
        read_manifest_string_field(&manifest_raw, "contractVersion").expect("contractVersion");
    let module_id = read_manifest_string_field(&manifest_raw, "moduleId").expect("moduleId");

    println!("cargo:rustc-env=VIDEOCUT_FRAMEWORK_CONTRACT_VERSION={contract_version}");
    println!("cargo:rustc-env=VIDEOCUT_FRAMEWORK_MODULE_ID={module_id}");
    println!("cargo:rustc-env=VIDEOCUT_FRAMEWORK_BASELINE_MIGRATION_ID=0001_videocut_baseline");
}

fn read_manifest_string_field(manifest_raw: &str, field_name: &str) -> Option<String> {
    let pattern = format!("\"{field_name}\"");
    let start = manifest_raw.find(&pattern)? + pattern.len();
    let after_key = &manifest_raw[start..];
    let quote = after_key.find('"')? + 1;
    let value_start = quote + start;
    let value_end = manifest_raw[value_start..].find('"')? + value_start;
    Some(manifest_raw[value_start..value_end].to_string())
}
