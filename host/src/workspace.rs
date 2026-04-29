use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::models::{VideoCutArtifact, VideoCutProgressEvent, VideoCutTask};
use crate::state::HostState;

const DEFAULT_PROJECT_ID: &str = "default";
const RUNTIME_SETTINGS_VERSION: u32 = 1;
const TASK_MANIFEST_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct FileSystemWorkspace {
    root: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskManifest {
    task_manifest_version: u32,
    task: VideoCutTask,
    #[serde(default)]
    plan: Option<Value>,
    #[serde(default)]
    artifacts: Vec<VideoCutArtifact>,
    #[serde(default)]
    events: Vec<VideoCutProgressEvent>,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactManifest<'a> {
    artifact_manifest_version: u32,
    task_id: &'a str,
    artifacts: &'a [VideoCutArtifact],
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettingsManifest {
    runtime_settings_version: u32,
    settings: Value,
    updated_at: String,
}

impl FileSystemWorkspace {
    pub(crate) fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn load_state(&self, settings: Value) -> io::Result<HostState> {
        let settings = self.load_settings(settings)?;
        let mut state = HostState {
            settings,
            ..HostState::default()
        };
        let tasks_root = self.tasks_root();
        if !tasks_root.exists() {
            return Ok(state);
        }

        for entry in fs::read_dir(tasks_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let manifest_path = entry.path().join("task.json");
            if !manifest_path.is_file() {
                continue;
            }

            let manifest: TaskManifest = read_json(&manifest_path)?;
            if manifest.task_manifest_version != TASK_MANIFEST_VERSION {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "Unsupported task manifest version {} in {}",
                        manifest.task_manifest_version,
                        manifest_path.display()
                    ),
                ));
            }

            let task_id = manifest.task.task_id.clone();
            if let Some(plan) = manifest.plan {
                state.plans.insert(task_id.clone(), plan);
            }
            state
                .artifacts
                .insert(task_id.clone(), dedupe_artifacts_by_id(manifest.artifacts));
            state.events.insert(task_id.clone(), manifest.events);
            state.tasks.insert(task_id, manifest.task);
        }

        Ok(state)
    }

    pub(crate) fn save_settings(&self, settings: &Value) -> io::Result<()> {
        write_json_atomic(
            &self.runtime_settings_path(),
            &RuntimeSettingsManifest {
                runtime_settings_version: RUNTIME_SETTINGS_VERSION,
                settings: settings.clone(),
                updated_at: crate::contracts::fixed_time(),
            },
        )
    }

    pub(crate) fn save_task(&self, state: &HostState, task_id: &str) -> io::Result<()> {
        let task = state.tasks.get(task_id).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("Task not found in workspace state: {task_id}"),
            )
        })?;
        let artifacts =
            dedupe_artifacts_by_id(state.artifacts.get(task_id).cloned().unwrap_or_default());
        let events = state.events.get(task_id).cloned().unwrap_or_default();
        let plan = state.plans.get(task_id).cloned();
        let task_dir = self.task_dir(task_id)?;
        fs::create_dir_all(&task_dir)?;

        let manifest = TaskManifest {
            task_manifest_version: TASK_MANIFEST_VERSION,
            task: task.clone(),
            plan: plan.clone(),
            artifacts,
            events,
            updated_at: task.updated_at.clone(),
        };
        write_json_atomic(&task_dir.join("task.json"), &manifest)?;
        write_events_jsonl(&task_dir.join("events.jsonl"), &manifest.events)?;
        if let Some(plan) = plan {
            write_json_atomic(&task_dir.join("plan").join("plan.json"), &plan)?;
        }
        write_json_atomic(
            &task_dir.join("artifacts").join("manifest.json"),
            &ArtifactManifest {
                artifact_manifest_version: 1,
                task_id,
                artifacts: &manifest.artifacts,
            },
        )?;

        Ok(())
    }

    pub(crate) fn delete_task(&self, task_id: &str) -> io::Result<()> {
        let task_dir = self.task_dir(task_id)?;
        if task_dir.exists() {
            fs::remove_dir_all(task_dir)?;
        }

        Ok(())
    }

    fn tasks_root(&self) -> PathBuf {
        self.root
            .join("projects")
            .join(DEFAULT_PROJECT_ID)
            .join("tasks")
    }

    fn load_settings(&self, default_settings: Value) -> io::Result<Value> {
        let path = self.runtime_settings_path();
        if !path.is_file() {
            return Ok(default_settings);
        }

        let manifest: RuntimeSettingsManifest = read_json(&path)?;
        if manifest.runtime_settings_version != RUNTIME_SETTINGS_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Unsupported runtime settings version {} in {}",
                    manifest.runtime_settings_version,
                    path.display()
                ),
            ));
        }

        Ok(merge_missing_settings(default_settings, manifest.settings))
    }

    fn runtime_settings_path(&self) -> PathBuf {
        self.root.join("runtime").join("settings.json")
    }

    fn task_dir(&self, task_id: &str) -> io::Result<PathBuf> {
        validate_task_id(task_id)?;
        Ok(self.tasks_root().join(task_id))
    }
}

fn merge_missing_settings(default_settings: Value, persisted_settings: Value) -> Value {
    match (default_settings, persisted_settings) {
        (Value::Object(mut defaults), Value::Object(persisted)) => {
            merge_missing_object_fields(&mut defaults, persisted);
            Value::Object(defaults)
        }
        (_, persisted) => persisted,
    }
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

fn merge_missing_object_fields(defaults: &mut Map<String, Value>, persisted: Map<String, Value>) {
    for (key, persisted_value) in persisted {
        match (defaults.get_mut(&key), persisted_value) {
            (Some(Value::Object(default_child)), Value::Object(persisted_child)) => {
                merge_missing_object_fields(default_child, persisted_child);
            }
            (_, value) => {
                defaults.insert(key, value);
            }
        }
    }
}

fn validate_task_id(task_id: &str) -> io::Result<()> {
    if task_id.is_empty()
        || task_id.contains('/')
        || task_id.contains('\\')
        || task_id.contains("..")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Invalid task id for workspace path: {task_id}"),
        ));
    }

    Ok(())
}

fn read_json<T>(path: &Path) -> io::Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn write_json_atomic<T>(path: &Path, value: &T) -> io::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_path = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&temp_path, bytes)?;
    replace_file(&temp_path, path)
}

fn write_events_jsonl(path: &Path, events: &[VideoCutProgressEvent]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_path = path.with_extension("tmp");
    let mut content = String::new();
    for event in events {
        let line = serde_json::to_string(event)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        content.push_str(&line);
        content.push('\n');
    }
    fs::write(&temp_path, content)?;
    replace_file(&temp_path, path)
}

fn replace_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    if target_path.exists() {
        fs::remove_file(target_path)?;
    }
    fs::rename(temp_path, target_path)
}
