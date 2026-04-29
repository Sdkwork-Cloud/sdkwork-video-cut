-- sdkwork-video-cut database baseline schema v1.
-- New-project baseline only. Do not place initial schema under host/migrations.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ops_database_contract (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    baseline_name TEXT NOT NULL,
    applied_by TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_ops_database_contract_uuid UNIQUE (uuid),
    CONSTRAINT uq_ops_database_contract_version UNIQUE (contract_version)
);

CREATE TABLE IF NOT EXISTS ops_task (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    project_uuid TEXT NOT NULL,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    current_stage TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    queue_status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_after_at TEXT NOT NULL,
    claimed_by TEXT,
    claimed_at TEXT,
    lease_expires_at TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    CONSTRAINT uq_ops_task_uuid UNIQUE (uuid),
    CONSTRAINT uq_ops_task_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT ck_ops_task_status CHECK (status IN ('unknown', 'source_ready', 'analyzing', 'plan_ready', 'rendering', 'succeeded', 'failed', 'cancelled', 'interrupted')),
    CONSTRAINT ck_ops_task_queue_status CHECK (queue_status IN ('queued', 'claimed', 'completed', 'failed', 'cancelled')),
    CONSTRAINT ck_ops_task_progress CHECK (progress >= 0 AND progress <= 100),
    CONSTRAINT ck_ops_task_attempts CHECK (attempt_count >= 0 AND max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_ops_task_owner_status_updated
    ON ops_task (tenant_id, owner_type, owner_id, status, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_ops_task_queue_claim
    ON ops_task (queue_status, run_after_at, lease_expires_at, priority, created_at, id);

CREATE TABLE IF NOT EXISTS ops_stage_run (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    stage TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_artifact_uuid TEXT,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_ops_stage_run_uuid UNIQUE (uuid),
    CONSTRAINT uq_ops_stage_run_attempt UNIQUE (tenant_id, task_uuid, stage, attempt_no),
    CONSTRAINT fk_ops_stage_run_task FOREIGN KEY (task_uuid) REFERENCES ops_task(uuid),
    CONSTRAINT ck_ops_stage_run_status CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'interrupted'))
);

CREATE INDEX IF NOT EXISTS idx_ops_stage_run_task_stage_created
    ON ops_stage_run (tenant_id, task_uuid, stage, created_at, id);

CREATE TABLE IF NOT EXISTS ops_task_event (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    stage TEXT NOT NULL,
    progress INTEGER NOT NULL,
    message TEXT NOT NULL,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_ops_task_event_uuid UNIQUE (uuid),
    CONSTRAINT fk_ops_task_event_task FOREIGN KEY (task_uuid) REFERENCES ops_task(uuid),
    CONSTRAINT ck_ops_task_event_progress CHECK (progress >= 0 AND progress <= 100)
);

CREATE INDEX IF NOT EXISTS idx_ops_task_event_task_created
    ON ops_task_event (tenant_id, task_uuid, created_at, id);

CREATE TABLE IF NOT EXISTS ops_worker_lease (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    lease_token TEXT NOT NULL,
    status TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_ops_worker_lease_uuid UNIQUE (uuid),
    CONSTRAINT uq_ops_worker_lease_worker UNIQUE (tenant_id, worker_id),
    CONSTRAINT uq_ops_worker_lease_token UNIQUE (lease_token),
    CONSTRAINT ck_ops_worker_lease_status CHECK (status IN ('active', 'expired', 'released'))
);

CREATE INDEX IF NOT EXISTS idx_ops_worker_lease_expiry
    ON ops_worker_lease (tenant_id, status, lease_expires_at, id);

CREATE TABLE IF NOT EXISTS media_artifact (
    id INTEGER NOT NULL PRIMARY KEY,
    uuid TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    render_uuid TEXT,
    kind TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    object_key TEXT,
    storage_provider TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    CONSTRAINT uq_media_artifact_uuid UNIQUE (uuid),
    CONSTRAINT fk_media_artifact_task FOREIGN KEY (task_uuid) REFERENCES ops_task(uuid),
    CONSTRAINT ck_media_artifact_kind CHECK (kind IN ('source', 'audio', 'analysis', 'plan', 'render', 'subtitle', 'cover', 'render_manifest', 'log')),
    CONSTRAINT ck_media_artifact_storage_provider CHECK (storage_provider IN ('filesystem', 's3_compatible')),
    CONSTRAINT ck_media_artifact_size CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_media_artifact_task_kind_created
    ON media_artifact (tenant_id, task_uuid, kind, created_at, id);

CREATE INDEX IF NOT EXISTS idx_media_artifact_render_kind_created
    ON media_artifact (tenant_id, render_uuid, kind, created_at, id);

INSERT OR IGNORE INTO ops_database_contract (
    id,
    uuid,
    tenant_id,
    contract_version,
    baseline_name,
    applied_by,
    applied_at,
    created_at,
    updated_at,
    version
) VALUES (
    1,
    'video-cut-database-contract-v1',
    'default',
    '1',
    '001_baseline.sql',
    'baseline-schema',
    '2026-04-27T00:00:00Z',
    '2026-04-27T00:00:00Z',
    '2026-04-27T00:00:00Z',
    1
);
