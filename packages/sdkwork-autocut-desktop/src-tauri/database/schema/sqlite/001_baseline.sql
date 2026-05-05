CREATE TABLE IF NOT EXISTS ops_schema_migration (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    migration_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    status TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_schema_migration_uuid UNIQUE (uuid),
    CONSTRAINT uk_ops_schema_migration_provider_migration UNIQUE (provider_id, migration_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_schema_migration_status_applied
    ON ops_schema_migration (provider_id, status, applied_at, id);

CREATE TABLE IF NOT EXISTS media_asset (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    owner_type TEXT NOT NULL DEFAULT 'local_user',
    owner_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    asset_type INTEGER NOT NULL,
    source_uri TEXT,
    mime_type TEXT,
    byte_size INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_media_asset_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_media_asset_owner_status_updated
    ON media_asset (tenant_id, organization_id, owner_type, owner_id, status, updated_at, id);

CREATE TABLE IF NOT EXISTS media_artifact (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    task_uuid TEXT,
    source_asset_uuid TEXT,
    name TEXT NOT NULL,
    artifact_type INTEGER NOT NULL,
    uri TEXT NOT NULL,
    mime_type TEXT,
    byte_size INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_media_artifact_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_media_artifact_task_created
    ON media_artifact (tenant_id, organization_id, task_uuid, created_at, id);

CREATE TABLE IF NOT EXISTS ops_task (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    task_type INTEGER NOT NULL,
    status INTEGER NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    source_asset_uuid TEXT,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_task_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_ops_task_status_updated
    ON ops_task (tenant_id, organization_id, status, updated_at, id);

CREATE TABLE IF NOT EXISTS ops_task_event (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    task_uuid TEXT NOT NULL,
    event_type INTEGER NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_task_event_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_ops_task_event_task_created
    ON ops_task_event (tenant_id, organization_id, task_uuid, created_at, id);

CREATE TABLE IF NOT EXISTS ops_stage_run (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    task_uuid TEXT NOT NULL,
    stage_type INTEGER NOT NULL,
    status INTEGER NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_stage_run_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_ops_stage_run_task_stage
    ON ops_stage_run (tenant_id, organization_id, task_uuid, stage_type, id);

CREATE TABLE IF NOT EXISTS ops_worker_lease (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    worker_id TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    lease_status INTEGER NOT NULL,
    lease_token TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    released_at TEXT,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_worker_lease_uuid UNIQUE (uuid)
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_ops_worker_lease_task_active
    ON ops_worker_lease (task_uuid)
    WHERE lease_status = 1;

CREATE INDEX IF NOT EXISTS idx_ops_worker_lease_status_expires
    ON ops_worker_lease (tenant_id, organization_id, lease_status, expires_at, id);

CREATE INDEX IF NOT EXISTS idx_ops_worker_lease_task_updated
    ON ops_worker_lease (tenant_id, organization_id, task_uuid, updated_at, id);
