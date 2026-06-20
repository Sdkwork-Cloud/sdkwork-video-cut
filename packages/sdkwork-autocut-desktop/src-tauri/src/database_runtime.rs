use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::database_contract::autocut_database_contract;

pub const LEGACY_SQLITE_BASELINE_MIGRATION_ID: &str = "2026-05-05.001_baseline";
pub const AUTOCUT_SQLITE_BASELINE_MIGRATION_ID: &str =
    env!("VIDEOCUT_FRAMEWORK_BASELINE_MIGRATION_ID");
pub const VIDEOCUT_FRAMEWORK_CONTRACT_VERSION: &str = env!("VIDEOCUT_FRAMEWORK_CONTRACT_VERSION");
pub const VIDEOCUT_FRAMEWORK_MODULE_ID: &str = env!("VIDEOCUT_FRAMEWORK_MODULE_ID");
pub const AUTOCUT_SQLITE_BASELINE_SQL: &str =
    include_str!("../database/schema/sqlite/001_baseline.sql");

const AUTOCUT_SQLITE_FILE_NAME: &str = "sdkwork-autocut.sqlite3";

const REQUIRED_IDENTITY_COLUMNS: &[&str] = &["id", "uuid", "created_at", "updated_at", "version"];
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutDatabaseHealth {
    pub ready: bool,
    pub database_path: String,
    pub applied_migrations: Vec<String>,
    pub verified_tables: Vec<String>,
    pub missing_tables: Vec<String>,
    pub diagnostics: Vec<String>,
}

pub fn run_autocut_database_migrations(app: &AppHandle) -> Result<AutoCutDatabaseHealth, String> {
    let database_path = autocut_database_path(app)?;
    let connection = Connection::open(&database_path)
        .map_err(|error| format!("open AutoCut sqlite database failed: {error}"))?;

    run_autocut_database_migrations_on_connection(&connection, &database_path)
}

pub(crate) fn open_autocut_database_connection(app: &AppHandle) -> Result<Connection, String> {
    let database_path = autocut_database_path(app)?;
    let connection = Connection::open(&database_path)
        .map_err(|error| format!("open AutoCut sqlite database failed: {error}"))?;
    run_autocut_database_migrations_on_connection(&connection, &database_path)?;
    Ok(connection)
}

fn autocut_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let configured_path = std::env::var_os("SDKWORK_AUTOCUT_SQLITE_FILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty());

    let database_path = if let Some(path) = configured_path {
        path
    } else {
        let mut app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("resolve AutoCut app data directory failed: {error}"))?;
        app_data_dir.push(AUTOCUT_SQLITE_FILE_NAME);
        app_data_dir
    };

    let parent_directory = database_path.parent().ok_or_else(|| {
        format!(
            "resolve AutoCut sqlite database parent directory failed: {}",
            database_path.display()
        )
    })?;
    fs::create_dir_all(parent_directory)
        .map_err(|error| format!("create AutoCut sqlite database directory failed: {error}"))?;

    Ok(database_path)
}

pub(crate) fn run_autocut_database_migrations_on_connection(
    connection: &Connection,
    database_path: &Path,
) -> Result<AutoCutDatabaseHealth, String> {
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("enable AutoCut sqlite foreign keys failed: {error}"))?;

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("start AutoCut sqlite migration transaction failed: {error}"))?;
    transaction
        .execute_batch(AUTOCUT_SQLITE_BASELINE_SQL)
        .map_err(|error| format!("apply AutoCut sqlite baseline migration failed: {error}"))?;
    record_baseline_migration(&transaction)?;
    transaction
        .commit()
        .map_err(|error| format!("commit AutoCut sqlite baseline migration failed: {error}"))?;

    verify_autocut_database_schema(connection, database_path)
}

fn record_baseline_migration(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO ops_schema_migration (
                id,
                uuid,
                provider_id,
                migration_id,
                contract_version,
                status,
                applied_at,
                checksum,
                diagnostics_json,
                created_at,
                updated_at,
                version
            )
            VALUES (
                1,
                ?1,
                'sqlite',
                ?2,
                ?3,
                'applied',
                datetime('now'),
                ?4,
                ?5,
                datetime('now'),
                datetime('now'),
                0
            )
            ON CONFLICT(provider_id, migration_id) DO NOTHING
            "#,
            params![
                baseline_migration_uuid(),
                AUTOCUT_SQLITE_BASELINE_MIGRATION_ID,
                VIDEOCUT_FRAMEWORK_CONTRACT_VERSION,
                baseline_sql_checksum(),
                baseline_migration_diagnostics_json(),
            ],
        )
        .map_err(|error| format!("record AutoCut sqlite baseline migration failed: {error}"))?;

    Ok(())
}

pub fn verify_autocut_database_schema(
    connection: &Connection,
    database_path: &Path,
) -> Result<AutoCutDatabaseHealth, String> {
    let mut verified_tables = Vec::new();
    let mut missing_tables = Vec::new();
    let mut diagnostics = Vec::new();

    for table in autocut_database_contract().tables {
        if !sqlite_table_exists(connection, table.name)? {
            missing_tables.push(table.name.to_string());
            diagnostics.push(format!("missing table {}", table.name));
            continue;
        }

        for column in table.columns {
            if !sqlite_column_exists(connection, table.name, column.name)? {
                diagnostics.push(format!("missing column {}.{}", table.name, column.name));
            }
        }

        // Verify every table carries the standard identity columns regardless of its contract definition
        for column_name in REQUIRED_IDENTITY_COLUMNS {
            if !sqlite_column_exists(connection, table.name, column_name)? {
                diagnostics.push(format!("missing required identity column {}.{}", table.name, column_name));
            }
        }

        verified_tables.push(table.name.to_string());
    }

    let applied_migrations = read_applied_migrations(connection)?;
    if !baseline_migration_recorded(&applied_migrations) {
        diagnostics.push(format!(
            "missing migration history {}",
            AUTOCUT_SQLITE_BASELINE_MIGRATION_ID
        ));
    }

    let ready = missing_tables.is_empty() && diagnostics.is_empty();

    Ok(AutoCutDatabaseHealth {
        ready,
        database_path: database_path.display().to_string(),
        applied_migrations,
        verified_tables,
        missing_tables,
        diagnostics,
    })
}

fn sqlite_table_exists(connection: &Connection, table_name: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
        .map_err(|error| format!("prepare sqlite table probe for {table_name} failed: {error}"))?;
    let mut rows = statement
        .query([table_name])
        .map_err(|error| format!("query sqlite table probe for {table_name} failed: {error}"))?;

    rows.next()
        .map(|row| row.is_some())
        .map_err(|error| format!("read sqlite table probe for {table_name} failed: {error}"))
}

fn sqlite_column_exists(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&pragma)
        .map_err(|error| format!("prepare sqlite table info for {table_name} failed: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("query sqlite table info for {table_name} failed: {error}"))?;

    for row in rows {
        let existing_column_name = row
            .map_err(|error| format!("read sqlite table info for {table_name} failed: {error}"))?;
        if existing_column_name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn read_applied_migrations(connection: &Connection) -> Result<Vec<String>, String> {
    if !sqlite_table_exists(connection, "ops_schema_migration")? {
        return Ok(Vec::new());
    }

    let mut statement = connection
        .prepare(
            r#"
            SELECT migration_id
            FROM ops_schema_migration
            WHERE provider_id = 'sqlite'
              AND status = 'applied'
            ORDER BY applied_at ASC, id ASC
            "#,
        )
        .map_err(|error| format!("prepare AutoCut migration history read failed: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query AutoCut migration history failed: {error}"))?;

    let mut migration_ids = Vec::new();
    for row in rows {
        migration_ids
            .push(row.map_err(|error| format!("read AutoCut migration row failed: {error}"))?);
    }

    Ok(migration_ids)
}

fn baseline_migration_recorded(applied_migrations: &[String]) -> bool {
    applied_migrations.iter().any(|migration_id| {
        migration_id == AUTOCUT_SQLITE_BASELINE_MIGRATION_ID
            || migration_id == LEGACY_SQLITE_BASELINE_MIGRATION_ID
    })
}

fn baseline_migration_diagnostics_json() -> String {
    format!(
        r#"{{"frameworkModuleId":"{}","frameworkContractVersion":"{}"}}"#,
        VIDEOCUT_FRAMEWORK_MODULE_ID, VIDEOCUT_FRAMEWORK_CONTRACT_VERSION
    )
}

fn baseline_migration_uuid() -> &'static str {
    "00000000-0000-7000-8000-000000000001"
}

fn baseline_sql_checksum() -> String {
    let mut checksum = 0u64;
    for byte in AUTOCUT_SQLITE_BASELINE_SQL.as_bytes() {
        checksum = checksum.wrapping_mul(31).wrapping_add(u64::from(*byte));
    }
    format!("{checksum:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_exists(connection: &Connection, table_name: &str) -> bool {
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
            .expect("prepare table probe");
        let mut rows = statement.query([table_name]).expect("query table probe");
        rows.next().expect("read table probe").is_some()
    }

    fn column_exists(connection: &Connection, table_name: &str, column_name: &str) -> bool {
        let pragma = format!("PRAGMA table_info({table_name})");
        let mut statement = connection.prepare(&pragma).expect("prepare table info");
        let rows = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query table info");

        for row in rows {
            if row.expect("read table info") == column_name {
                return true;
            }
        }

        false
    }

    #[test]
    fn baseline_migration_creates_schema_and_records_history() {
        let connection = Connection::open_in_memory().expect("open in-memory sqlite");
        let database_path = PathBuf::from("memory");

        let health = run_autocut_database_migrations_on_connection(&connection, &database_path)
            .expect("run baseline migration");

        assert!(
            health.ready,
            "baseline migration should produce a ready database"
        );
        assert_eq!(
            health.applied_migrations,
            vec![AUTOCUT_SQLITE_BASELINE_MIGRATION_ID.to_string()]
        );
        assert_eq!(VIDEOCUT_FRAMEWORK_MODULE_ID, "videocut");
        assert_eq!(VIDEOCUT_FRAMEWORK_CONTRACT_VERSION, "1.0.0");

        for table_name in [
            "media_asset",
            "media_artifact",
            "media_text_track",
            "media_text_segment",
            "media_content_unit",
            "ops_task",
            "ops_task_event",
            "ops_stage_run",
            "ops_worker_lease",
            "ops_workflow_run",
            "ops_step_run",
            "ops_step_item_run",
            "studio_timeline",
            "studio_clip",
            "studio_clip_source_ref",
            "studio_clip_processing_operation",
            "studio_clip_event",
            "ops_schema_migration",
        ] {
            assert!(
                table_exists(&connection, table_name),
                "missing {table_name}"
            );
            assert!(
                column_exists(&connection, table_name, "id"),
                "missing {table_name}.id"
            );
            assert!(
                column_exists(&connection, table_name, "uuid"),
                "missing {table_name}.uuid"
            );
        }
        for column_name in [
            "worker_id",
            "task_uuid",
            "lease_status",
            "lease_token",
            "acquired_at",
            "heartbeat_at",
            "expires_at",
            "released_at",
            "diagnostics_json",
        ] {
            assert!(
                column_exists(&connection, "ops_worker_lease", column_name),
                "missing ops_worker_lease.{column_name}"
            );
        }
        for column_name in [
            "boundary_version",
        ] {
            assert!(
                column_exists(&connection, "studio_clip", column_name),
                "missing studio_clip.{column_name}"
            );
        }
        for column_name in [
            "status_key",
            "execution_stage",
            "dependency_operation_keys_json",
            "blocked_by_operation_keys_json",
            "blocking_reason",
            "attempt_no",
            "max_attempts",
            "started_at",
            "completed_at",
            "duration_ms",
            "worker_id",
            "clip_boundary_version",
            "source_start_ms",
            "source_end_ms",
            "source_duration_ms",
            "invalidated_by_event_uuid",
            "invalidated_at",
        ] {
            assert!(
                column_exists(
                    &connection,
                    "studio_clip_processing_operation",
                    column_name
                ),
                "missing studio_clip_processing_operation.{column_name}"
            );
        }
        for column_name in [
            "invalidated_step_keys_json",
            "invalidated_operation_keys_json",
        ] {
            assert!(
                column_exists(&connection, "studio_clip_event", column_name),
                "missing studio_clip_event.{column_name}"
            );
        }

        connection
            .execute(
                r#"
                INSERT INTO studio_clip (
                    id,
                    uuid,
                    timeline_uuid,
                    task_uuid,
                    engine_id,
                    clip_type,
                    clip_order,
                    status,
                    start_ms,
                    end_ms,
                    duration_ms,
                    boundary_version,
                    created_at,
                    updated_at
                )
                VALUES (
                    1,
                    'test-clip-invalid-boundary-version',
                    'timeline-1',
                    'task-1',
                    'transcript-semantic-v2',
                    'speech',
                    1,
                    20,
                    1000,
                    2000,
                    1000,
                    0,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("clip boundary versions below one should be rejected");

        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    1,
                    'test-operation-invalid-status-key',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    20,
                    'invalidated',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("mismatched operation status and status_key should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    2,
                    'test-operation-invalid-source-range',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    20,
                    'pending',
                    1,
                    2000,
                    1000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("invalid operation source ranges should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    3,
                    'test-operation-invalid-key',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'custom-operation',
                    1,
                    'audio-foundation',
                    '[]',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("unknown processing operation keys should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    4,
                    'test-operation-invalid-order',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'select-cover-frame',
                    1,
                    'publishing-assets',
                    '["check-duplicate-content"]',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("mismatched processing operation key and order should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    5,
                    'test-operation-invalid-boundary-version',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    20,
                    'pending',
                    0,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("operation clip boundary versions below one should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    attempt_no,
                    max_attempts,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    6,
                    'test-operation-invalid-attempt-count',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    20,
                    'pending',
                    4,
                    3,
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("operation attempts beyond max attempts should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    attempt_no,
                    max_attempts,
                    started_at,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    7,
                    'test-operation-pending-with-started-at',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    20,
                    'pending',
                    1,
                    3,
                    datetime('now'),
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("pending operation lifecycle should not claim a started attempt");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    attempt_no,
                    max_attempts,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    8,
                    'test-operation-running-without-started-at',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    30,
                    'running',
                    1,
                    3,
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("running operation lifecycle should require started_at");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    attempt_no,
                    max_attempts,
                    started_at,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    9,
                    'test-operation-succeeded-without-completed-at',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    40,
                    'succeeded',
                    1,
                    3,
                    datetime('now'),
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("terminal operation lifecycle should require completed_at");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    attempt_no,
                    max_attempts,
                    started_at,
                    completed_at,
                    duration_ms,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    10,
                    'test-operation-negative-duration',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    'audio-foundation',
                    '[]',
                    40,
                    'succeeded',
                    1,
                    3,
                    datetime('now'),
                    datetime('now'),
                    -1,
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("operation lifecycle duration should not be negative");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    11,
                    'test-operation-invalid-execution-stage',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'denoise-audio',
                    1,
                    '',
                    '[]',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("empty operation execution stage should be rejected");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    12,
                    'test-operation-mismatched-stage',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'select-cover-frame',
                    8,
                    'audio-foundation',
                    '["check-duplicate-content"]',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("operation key and execution stage must match the canonical DAG");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    13,
                    'test-operation-mismatched-dependencies',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'normalize-loudness',
                    2,
                    'audio-foundation',
                    '[]',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("operation dependency JSON must match the canonical DAG");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    blocked_by_operation_keys_json,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    14,
                    'test-operation-blocked-without-reason',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'normalize-loudness',
                    2,
                    'audio-foundation',
                    '["denoise-audio"]',
                    '["denoise-audio"]',
                    10,
                    'blocked',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("blocked operations must persist an explicit blocking reason");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    blocked_by_operation_keys_json,
                    blocking_reason,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    15,
                    'test-operation-pending-with-blocked-by',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'normalize-loudness',
                    2,
                    'audio-foundation',
                    '["denoise-audio"]',
                    '["denoise-audio"]',
                    'waiting-for-dependencies',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("pending operations must not persist blocked dependency keys");
        connection
            .execute(
                r#"
                INSERT INTO studio_clip_processing_operation (
                    id,
                    uuid,
                    timeline_uuid,
                    clip_uuid,
                    task_uuid,
                    operation_key,
                    operation_order,
                    execution_stage,
                    dependency_operation_keys_json,
                    blocking_reason,
                    status,
                    status_key,
                    clip_boundary_version,
                    source_start_ms,
                    source_end_ms,
                    source_duration_ms,
                    created_at,
                    updated_at
                )
                VALUES (
                    16,
                    'test-operation-pending-with-blocking-reason',
                    'timeline-1',
                    'clip-1',
                    'task-1',
                    'normalize-loudness',
                    2,
                    'audio-foundation',
                    '["denoise-audio"]',
                    'waiting-for-dependencies',
                    20,
                    'pending',
                    1,
                    1000,
                    2000,
                    1000,
                    datetime('now'),
                    datetime('now')
                )
                "#,
                [],
            )
            .expect_err("pending operations must not persist a blocking reason");

        let applied_count = connection
            .query_row(
                "SELECT COUNT(*) FROM ops_schema_migration WHERE provider_id = 'sqlite' AND migration_id = ?1",
                [AUTOCUT_SQLITE_BASELINE_MIGRATION_ID],
                |row| row.get::<_, i64>(0),
            )
            .expect("query migration history");
        assert_eq!(applied_count, 1);
    }

    #[test]
    fn baseline_migration_is_idempotent_for_repeated_desktop_startup() {
        let connection = Connection::open_in_memory().expect("open in-memory sqlite");
        let database_path = PathBuf::from("memory");

        run_autocut_database_migrations_on_connection(&connection, &database_path)
            .expect("run baseline migration first time");
        let health = run_autocut_database_migrations_on_connection(&connection, &database_path)
            .expect("run baseline migration second time");

        assert!(
            health.ready,
            "repeated migration should keep database ready"
        );
        let (applied_count, migration_version) = connection
            .query_row(
                "SELECT COUNT(*), MAX(version) FROM ops_schema_migration WHERE provider_id = 'sqlite' AND migration_id = ?1",
                [AUTOCUT_SQLITE_BASELINE_MIGRATION_ID],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("query repeated migration history");
        assert_eq!(applied_count, 1);
        assert_eq!(migration_version, 0);
    }

    #[test]
    fn schema_verification_reports_missing_identity_columns() {
        let connection = Connection::open_in_memory().expect("open in-memory sqlite");
        connection
            .execute_batch(
                r#"
                CREATE TABLE media_asset (
                    id INTEGER NOT NULL,
                    PRIMARY KEY (id)
                );
                "#,
            )
            .expect("seed incomplete table");
        let health = verify_autocut_database_schema(&connection, Path::new("memory"))
            .expect("verify incomplete schema");

        assert!(!health.ready, "incomplete schema must not be ready");
        assert!(
            health
                .diagnostics
                .iter()
                .any(|message| message.contains("media_asset.uuid")),
            "diagnostics should identify the missing uuid column: {:?}",
            health.diagnostics
        );
    }
}
