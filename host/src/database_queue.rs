use std::sync::atomic::{AtomicI64, Ordering};

use async_trait::async_trait;
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{PgPool, Row, SqlitePool};
use uuid::Uuid;

const SQLITE_BASELINE_SCHEMA: &str = include_str!("../database/schema/sqlite/001_baseline.sql");
const POSTGRES_BASELINE_SCHEMA: &str = include_str!("../database/schema/postgres/001_baseline.sql");
const DEFAULT_MAX_ATTEMPTS: i32 = 3;
static NEXT_ID: AtomicI64 = AtomicI64::new(10_000);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueueTaskInput {
    pub task_uuid: String,
    pub project_uuid: String,
    pub tenant_id: String,
    pub owner_type: String,
    pub owner_id: String,
    pub idempotency_key: String,
    pub title: String,
    pub status: String,
    pub current_stage: String,
    pub priority: i32,
    pub run_after_at: String,
    pub metadata_json: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueueClaimRequest {
    pub tenant_id: String,
    pub worker_id: String,
    pub lease_token: String,
    pub now: String,
    pub lease_expires_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueueClaim {
    pub task_uuid: String,
    pub queue_status: String,
    pub claimed_by: String,
    pub lease_expires_at: String,
    pub attempt_count: i32,
    pub version: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskQueueState {
    pub task_uuid: String,
    pub queue_status: String,
    pub claimed_by: Option<String>,
    pub attempt_count: i32,
    pub version: i64,
}

#[derive(Debug)]
pub enum DatabaseQueueError {
    InvalidInput(String),
    Sqlx(sqlx::Error),
}

impl std::fmt::Display for DatabaseQueueError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(formatter, "{message}"),
            Self::Sqlx(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for DatabaseQueueError {}

impl From<sqlx::Error> for DatabaseQueueError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
}

#[async_trait]
pub trait TaskQueuePort: Send + Sync {
    async fn initialize_schema(&self) -> Result<(), DatabaseQueueError>;

    async fn enqueue_task(&self, input: QueueTaskInput) -> Result<(), DatabaseQueueError>;

    async fn claim_next(
        &self,
        request: QueueClaimRequest,
    ) -> Result<Option<QueueClaim>, DatabaseQueueError>;

    async fn get_task_queue_state(
        &self,
        task_uuid: &str,
    ) -> Result<Option<TaskQueueState>, DatabaseQueueError>;
}

#[derive(Clone)]
pub struct SqliteTaskQueue {
    pool: SqlitePool,
}

#[derive(Clone)]
pub struct PostgresTaskQueue {
    pool: PgPool,
}

impl SqliteTaskQueue {
    pub async fn connect(database_url: &str) -> Result<Self, DatabaseQueueError> {
        let options = database_url
            .parse::<SqliteConnectOptions>()
            .map_err(|error| DatabaseQueueError::InvalidInput(error.to_string()))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        sqlx::query("PRAGMA busy_timeout = 5000")
            .execute(&pool)
            .await?;

        Ok(Self { pool })
    }

    pub fn from_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

impl PostgresTaskQueue {
    pub async fn connect(database_url: &str) -> Result<Self, DatabaseQueueError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await?;

        Ok(Self { pool })
    }

    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TaskQueuePort for SqliteTaskQueue {
    async fn initialize_schema(&self) -> Result<(), DatabaseQueueError> {
        for statement in split_sqlite_statements(SQLITE_BASELINE_SCHEMA) {
            sqlx::query(&statement).execute(&self.pool).await?;
        }

        Ok(())
    }

    async fn enqueue_task(&self, input: QueueTaskInput) -> Result<(), DatabaseQueueError> {
        validate_queue_task_input(&input)?;
        let now = input.created_at.clone();

        sqlx::query(
            r#"
            INSERT INTO ops_task (
                id,
                uuid,
                tenant_id,
                project_uuid,
                owner_type,
                owner_id,
                idempotency_key,
                title,
                status,
                current_stage,
                progress,
                priority,
                queue_status,
                attempt_count,
                max_attempts,
                run_after_at,
                metadata_json,
                created_at,
                updated_at,
                version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'queued', 0, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(tenant_id, idempotency_key) DO UPDATE SET
                updated_at = excluded.updated_at,
                version = ops_task.version + 1
            "#,
        )
        .bind(next_id())
        .bind(input.task_uuid)
        .bind(input.tenant_id)
        .bind(input.project_uuid)
        .bind(input.owner_type)
        .bind(input.owner_id)
        .bind(input.idempotency_key)
        .bind(input.title)
        .bind(map_api_status_to_db_status(&input.status))
        .bind(input.current_stage)
        .bind(input.priority)
        .bind(DEFAULT_MAX_ATTEMPTS)
        .bind(input.run_after_at)
        .bind(input.metadata_json)
        .bind(now.clone())
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn claim_next(
        &self,
        request: QueueClaimRequest,
    ) -> Result<Option<QueueClaim>, DatabaseQueueError> {
        validate_claim_request(&request)?;
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO ops_worker_lease (
                id,
                uuid,
                tenant_id,
                worker_id,
                lease_token,
                status,
                heartbeat_at,
                lease_expires_at,
                created_at,
                updated_at,
                version
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1)
            ON CONFLICT(tenant_id, worker_id) DO UPDATE SET
                lease_token = excluded.lease_token,
                status = 'active',
                heartbeat_at = excluded.heartbeat_at,
                lease_expires_at = excluded.lease_expires_at,
                updated_at = excluded.updated_at,
                version = ops_worker_lease.version + 1
            "#,
        )
        .bind(next_id())
        .bind(Uuid::new_v4().to_string())
        .bind(&request.tenant_id)
        .bind(&request.worker_id)
        .bind(&request.lease_token)
        .bind(&request.now)
        .bind(&request.lease_expires_at)
        .bind(&request.now)
        .bind(&request.now)
        .execute(&mut *transaction)
        .await?;

        let row = sqlx::query(
            r#"
            UPDATE ops_task
            SET
                queue_status = 'claimed',
                claimed_by = ?,
                claimed_at = ?,
                lease_expires_at = ?,
                attempt_count = attempt_count + 1,
                updated_at = ?,
                version = version + 1
            WHERE uuid = (
                SELECT uuid
                FROM ops_task
                WHERE tenant_id = ?
                    AND queue_status = 'queued'
                    AND deleted_at IS NULL
                    AND run_after_at <= ?
                    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
                    AND attempt_count < max_attempts
                ORDER BY priority DESC, created_at ASC, id ASC
                LIMIT 1
            )
            RETURNING uuid, queue_status, claimed_by, lease_expires_at, attempt_count, version
            "#,
        )
        .bind(&request.worker_id)
        .bind(&request.now)
        .bind(&request.lease_expires_at)
        .bind(&request.now)
        .bind(&request.tenant_id)
        .bind(&request.now)
        .bind(&request.now)
        .fetch_optional(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(row.map(|row| QueueClaim {
            task_uuid: row.get("uuid"),
            queue_status: row.get("queue_status"),
            claimed_by: row.get("claimed_by"),
            lease_expires_at: row.get("lease_expires_at"),
            attempt_count: row.get("attempt_count"),
            version: row.get("version"),
        }))
    }

    async fn get_task_queue_state(
        &self,
        task_uuid: &str,
    ) -> Result<Option<TaskQueueState>, DatabaseQueueError> {
        let row = sqlx::query(
            r#"
            SELECT uuid, queue_status, claimed_by, attempt_count, version
            FROM ops_task
            WHERE uuid = ?
            "#,
        )
        .bind(task_uuid)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| TaskQueueState {
            task_uuid: row.get("uuid"),
            queue_status: row.get("queue_status"),
            claimed_by: row.get("claimed_by"),
            attempt_count: row.get("attempt_count"),
            version: row.get("version"),
        }))
    }
}

#[async_trait]
impl TaskQueuePort for PostgresTaskQueue {
    async fn initialize_schema(&self) -> Result<(), DatabaseQueueError> {
        for statement in split_sql_statements(POSTGRES_BASELINE_SCHEMA) {
            sqlx::query(&statement).execute(&self.pool).await?;
        }

        Ok(())
    }

    async fn enqueue_task(&self, input: QueueTaskInput) -> Result<(), DatabaseQueueError> {
        validate_queue_task_input(&input)?;
        let now = input.created_at.clone();

        sqlx::query(
            r#"
            INSERT INTO ops_task (
                id,
                uuid,
                tenant_id,
                project_uuid,
                owner_type,
                owner_id,
                idempotency_key,
                title,
                status,
                current_stage,
                progress,
                priority,
                queue_status,
                attempt_count,
                max_attempts,
                run_after_at,
                metadata_json,
                created_at,
                updated_at,
                version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, 'queued', 0, $12, $13::timestamptz, $14::jsonb, $15::timestamptz, $16::timestamptz, 1)
            ON CONFLICT(tenant_id, idempotency_key) DO UPDATE SET
                updated_at = excluded.updated_at,
                version = ops_task.version + 1
            "#,
        )
        .bind(next_id())
        .bind(input.task_uuid)
        .bind(input.tenant_id)
        .bind(input.project_uuid)
        .bind(input.owner_type)
        .bind(input.owner_id)
        .bind(input.idempotency_key)
        .bind(input.title)
        .bind(map_api_status_to_db_status(&input.status))
        .bind(input.current_stage)
        .bind(input.priority)
        .bind(DEFAULT_MAX_ATTEMPTS)
        .bind(input.run_after_at)
        .bind(input.metadata_json)
        .bind(now.clone())
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn claim_next(
        &self,
        request: QueueClaimRequest,
    ) -> Result<Option<QueueClaim>, DatabaseQueueError> {
        validate_claim_request(&request)?;
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO ops_worker_lease (
                id,
                uuid,
                tenant_id,
                worker_id,
                lease_token,
                status,
                heartbeat_at,
                lease_expires_at,
                created_at,
                updated_at,
                version
            ) VALUES ($1, $2, $3, $4, $5, 'active', $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz, 1)
            ON CONFLICT(tenant_id, worker_id) DO UPDATE SET
                lease_token = excluded.lease_token,
                status = 'active',
                heartbeat_at = excluded.heartbeat_at,
                lease_expires_at = excluded.lease_expires_at,
                updated_at = excluded.updated_at,
                version = ops_worker_lease.version + 1
            "#,
        )
        .bind(next_id())
        .bind(Uuid::new_v4().to_string())
        .bind(&request.tenant_id)
        .bind(&request.worker_id)
        .bind(&request.lease_token)
        .bind(&request.now)
        .bind(&request.lease_expires_at)
        .bind(&request.now)
        .bind(&request.now)
        .execute(&mut *transaction)
        .await?;

        let row = sqlx::query(postgres_claim_next_sql())
            .bind(&request.worker_id)
            .bind(&request.now)
            .bind(&request.lease_expires_at)
            .bind(&request.now)
            .bind(&request.tenant_id)
            .bind(&request.now)
            .bind(&request.now)
            .fetch_optional(&mut *transaction)
            .await?;

        transaction.commit().await?;

        Ok(row.map(|row| QueueClaim {
            task_uuid: row.get("uuid"),
            queue_status: row.get("queue_status"),
            claimed_by: row.get("claimed_by"),
            lease_expires_at: row.get("lease_expires_at"),
            attempt_count: row.get("attempt_count"),
            version: row.get("version"),
        }))
    }

    async fn get_task_queue_state(
        &self,
        task_uuid: &str,
    ) -> Result<Option<TaskQueueState>, DatabaseQueueError> {
        let row = sqlx::query(
            r#"
            SELECT uuid, queue_status, claimed_by, attempt_count, version
            FROM ops_task
            WHERE uuid = $1
            "#,
        )
        .bind(task_uuid)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| TaskQueueState {
            task_uuid: row.get("uuid"),
            queue_status: row.get("queue_status"),
            claimed_by: row.get("claimed_by"),
            attempt_count: row.get("attempt_count"),
            version: row.get("version"),
        }))
    }
}

fn postgres_claim_next_sql() -> &'static str {
    r#"
    WITH candidate AS (
        SELECT uuid
        FROM ops_task
        WHERE tenant_id = $5
            AND queue_status = 'queued'
            AND deleted_at IS NULL
            AND run_after_at <= $6::timestamptz
            AND (lease_expires_at IS NULL OR lease_expires_at <= $7::timestamptz)
            AND attempt_count < max_attempts
        ORDER BY priority DESC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    UPDATE ops_task
    SET
        queue_status = 'claimed',
        claimed_by = $1,
        claimed_at = $2::timestamptz,
        lease_expires_at = $3::timestamptz,
        attempt_count = attempt_count + 1,
        updated_at = $4::timestamptz,
        version = version + 1
    FROM candidate
    WHERE ops_task.uuid = candidate.uuid
    RETURNING ops_task.uuid, ops_task.queue_status, ops_task.claimed_by, ops_task.lease_expires_at, ops_task.attempt_count, ops_task.version
    "#
}

fn validate_queue_task_input(input: &QueueTaskInput) -> Result<(), DatabaseQueueError> {
    for (field, value) in [
        ("task_uuid", input.task_uuid.as_str()),
        ("project_uuid", input.project_uuid.as_str()),
        ("tenant_id", input.tenant_id.as_str()),
        ("owner_type", input.owner_type.as_str()),
        ("owner_id", input.owner_id.as_str()),
        ("idempotency_key", input.idempotency_key.as_str()),
        ("title", input.title.as_str()),
        ("created_at", input.created_at.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(DatabaseQueueError::InvalidInput(format!(
                "{field} is required"
            )));
        }
    }

    Ok(())
}

fn validate_claim_request(request: &QueueClaimRequest) -> Result<(), DatabaseQueueError> {
    for (field, value) in [
        ("worker_id", request.worker_id.as_str()),
        ("tenant_id", request.tenant_id.as_str()),
        ("lease_token", request.lease_token.as_str()),
        ("now", request.now.as_str()),
        ("lease_expires_at", request.lease_expires_at.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(DatabaseQueueError::InvalidInput(format!(
                "{field} is required"
            )));
        }
    }

    Ok(())
}

fn map_api_status_to_db_status(status: &str) -> &str {
    match status {
        "sourceReady" => "source_ready",
        "planReady" => "plan_ready",
        "analyzing" | "rendering" | "succeeded" | "failed" | "cancelled" | "interrupted" => status,
        _ => "unknown",
    }
}

fn next_id() -> i64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

fn split_sqlite_statements(sql: &str) -> Vec<String> {
    split_sql_statements(sql)
}

fn split_sql_statements(sql: &str) -> Vec<String> {
    sql.lines()
        .map(|line| line.split("--").next().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n")
        .split(';')
        .map(str::trim)
        .filter(|statement| !statement.is_empty())
        .map(ToString::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postgres_claim_statement_uses_tenant_scope_and_skip_locked() {
        let sql = postgres_claim_next_sql();

        assert!(sql.contains("tenant_id = $5"));
        assert!(sql.contains("FOR UPDATE SKIP LOCKED"));
        assert!(sql.contains("RETURNING ops_task.uuid"));
    }
}
