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

CREATE TABLE IF NOT EXISTS ops_workflow_run (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    task_uuid TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    workflow_version INTEGER NOT NULL,
    engine_id TEXT NOT NULL,
    engine_version INTEGER NOT NULL,
    status INTEGER NOT NULL,
    current_step_key TEXT,
    template_snapshot_json TEXT NOT NULL DEFAULT '{}',
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_workflow_run_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_ops_workflow_run_task_status
    ON ops_workflow_run (tenant_id, organization_id, task_uuid, status, updated_at, id);

CREATE TABLE IF NOT EXISTS ops_step_run (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    workflow_run_uuid TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    step_key TEXT NOT NULL,
    step_phase TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    status INTEGER NOT NULL,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    progress INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_step_run_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_ops_step_run_workflow_order
    ON ops_step_run (tenant_id, organization_id, workflow_run_uuid, step_order, id);

CREATE INDEX IF NOT EXISTS idx_ops_step_run_task_status
    ON ops_step_run (tenant_id, organization_id, task_uuid, status, updated_at, id);

CREATE TABLE IF NOT EXISTS ops_step_item_run (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    workflow_run_uuid TEXT NOT NULL,
    step_run_uuid TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_uuid TEXT NOT NULL,
    item_key TEXT NOT NULL,
    status INTEGER NOT NULL,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    worker_id TEXT,
    started_at TEXT,
    finished_at TEXT,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    evidence_artifact_uuid TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_ops_step_item_run_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_ops_step_item_run_step_status
    ON ops_step_item_run (tenant_id, organization_id, step_run_uuid, status, updated_at, id);

CREATE TABLE IF NOT EXISTS media_text_track (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    source_asset_uuid TEXT NOT NULL,
    task_uuid TEXT,
    clip_uuid TEXT,
    scope_type TEXT NOT NULL,
    track_role TEXT NOT NULL,
    provider_id TEXT,
    engine_id TEXT,
    model_id TEXT,
    language TEXT,
    segment_count INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    evidence_artifact_uuid TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_media_text_track_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_media_text_track_source_role
    ON media_text_track (tenant_id, organization_id, source_asset_uuid, track_role, created_at, id);

CREATE TABLE IF NOT EXISTS media_text_segment (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    text_track_uuid TEXT NOT NULL,
    source_asset_uuid TEXT NOT NULL,
    clip_uuid TEXT,
    segment_index INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    speaker_label TEXT,
    confidence REAL,
    tokens_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_media_text_segment_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_media_text_segment_track_time
    ON media_text_segment (tenant_id, organization_id, text_track_uuid, start_ms, end_ms, id);

CREATE TABLE IF NOT EXISTS media_content_unit (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    source_asset_uuid TEXT NOT NULL,
    text_track_uuid TEXT,
    task_uuid TEXT,
    engine_id TEXT NOT NULL,
    segmentation_agent_id TEXT,
    unit_index INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    title TEXT,
    summary TEXT,
    topic_json TEXT NOT NULL DEFAULT '{}',
    arc_json TEXT NOT NULL DEFAULT '[]',
    score_json TEXT NOT NULL DEFAULT '{}',
    transcript_segment_refs_json TEXT NOT NULL DEFAULT '[]',
    evidence_artifact_uuid TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_media_content_unit_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_media_content_unit_source_time
    ON media_content_unit (tenant_id, organization_id, source_asset_uuid, start_ms, end_ms, id);

CREATE TABLE IF NOT EXISTS studio_timeline (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    task_uuid TEXT NOT NULL,
    workflow_run_uuid TEXT,
    source_asset_uuid TEXT,
    timeline_type TEXT NOT NULL,
    status INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    schema_version TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_studio_timeline_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_studio_timeline_task_status
    ON studio_timeline (tenant_id, organization_id, task_uuid, status, updated_at, id);

CREATE TABLE IF NOT EXISTS studio_clip (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    timeline_uuid TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    workflow_run_uuid TEXT,
    source_asset_uuid TEXT,
    engine_id TEXT NOT NULL,
    clip_type TEXT NOT NULL,
    clip_order INTEGER NOT NULL,
    status INTEGER NOT NULL,
    selected INTEGER NOT NULL DEFAULT 0,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    boundary_version INTEGER NOT NULL DEFAULT 1,
    speech_start_ms INTEGER,
    speech_end_ms INTEGER,
    title TEXT,
    summary TEXT,
    transcript_text_snapshot TEXT,
    processing_plan_json TEXT NOT NULL DEFAULT '{}',
    quality_json TEXT NOT NULL DEFAULT '{}',
    risk_json TEXT NOT NULL DEFAULT '[]',
    preview_json TEXT NOT NULL DEFAULT '{}',
    render_artifact_uuid TEXT,
    thumbnail_artifact_uuid TEXT,
    subtitle_artifact_uuid TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_studio_clip_uuid UNIQUE (uuid),
    CONSTRAINT ck_studio_clip_boundary_version
        CHECK (boundary_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_studio_clip_timeline_order
    ON studio_clip (tenant_id, organization_id, timeline_uuid, clip_order, id);

CREATE INDEX IF NOT EXISTS idx_studio_clip_task_status
    ON studio_clip (tenant_id, organization_id, task_uuid, status, updated_at, id);

CREATE TABLE IF NOT EXISTS studio_clip_source_ref (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    clip_uuid TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_uuid TEXT NOT NULL,
    source_index INTEGER,
    start_ms INTEGER,
    end_ms INTEGER,
    coverage_ratio REAL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_studio_clip_source_ref_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_studio_clip_source_ref_clip
    ON studio_clip_source_ref (tenant_id, organization_id, clip_uuid, source_type, source_index, id);

CREATE TABLE IF NOT EXISTS studio_clip_processing_operation (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    timeline_uuid TEXT NOT NULL,
    clip_uuid TEXT NOT NULL,
    task_uuid TEXT NOT NULL,
    workflow_run_uuid TEXT,
    step_run_uuid TEXT,
    operation_key TEXT NOT NULL,
    operation_order INTEGER NOT NULL,
    execution_stage TEXT NOT NULL,
    dependency_operation_keys_json TEXT NOT NULL DEFAULT '[]',
    blocked_by_operation_keys_json TEXT NOT NULL DEFAULT '[]',
    blocking_reason TEXT,
    status INTEGER NOT NULL,
    status_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    attempt_no INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    worker_id TEXT,
    clip_boundary_version INTEGER NOT NULL DEFAULT 1,
    source_start_ms INTEGER NOT NULL,
    source_end_ms INTEGER NOT NULL,
    source_duration_ms INTEGER NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    evidence_artifact_uuid TEXT,
    error_code TEXT,
    error_message TEXT,
    invalidated_by_event_uuid TEXT,
    invalidated_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_studio_clip_processing_operation_uuid UNIQUE (uuid),
    CONSTRAINT ck_studio_clip_processing_operation_key
        CHECK (operation_key IN ('denoise-audio', 'normalize-loudness', 'remove-cough-and-breath-noise', 'trim-silence', 'filter-repeated-content', 'check-duplicate-content', 'refine-subtitle-cues', 'select-cover-frame')),
    CONSTRAINT ck_studio_clip_processing_operation_order
        CHECK ((operation_order = 1 AND operation_key = 'denoise-audio')
            OR (operation_order = 2 AND operation_key = 'normalize-loudness')
            OR (operation_order = 3 AND operation_key = 'remove-cough-and-breath-noise')
            OR (operation_order = 4 AND operation_key = 'trim-silence')
            OR (operation_order = 5 AND operation_key = 'filter-repeated-content')
            OR (operation_order = 6 AND operation_key = 'check-duplicate-content')
            OR (operation_order = 7 AND operation_key = 'refine-subtitle-cues')
            OR (operation_order = 8 AND operation_key = 'select-cover-frame')),
    CONSTRAINT ck_studio_clip_processing_operation_execution_stage
        CHECK (execution_stage IN ('audio-foundation', 'speech-cleanup', 'content-cleanup', 'publishing-assets')),
    CONSTRAINT ck_studio_clip_processing_operation_stage_by_key
        CHECK ((operation_key = 'denoise-audio' AND execution_stage = 'audio-foundation')
            OR (operation_key = 'normalize-loudness' AND execution_stage = 'audio-foundation')
            OR (operation_key = 'remove-cough-and-breath-noise' AND execution_stage = 'speech-cleanup')
            OR (operation_key = 'trim-silence' AND execution_stage = 'speech-cleanup')
            OR (operation_key = 'filter-repeated-content' AND execution_stage = 'content-cleanup')
            OR (operation_key = 'check-duplicate-content' AND execution_stage = 'content-cleanup')
            OR (operation_key = 'refine-subtitle-cues' AND execution_stage = 'publishing-assets')
            OR (operation_key = 'select-cover-frame' AND execution_stage = 'publishing-assets')),
    CONSTRAINT ck_studio_clip_processing_operation_dependency_dag
        CHECK ((operation_key = 'denoise-audio' AND dependency_operation_keys_json = '[]')
            OR (operation_key = 'normalize-loudness' AND dependency_operation_keys_json = '["denoise-audio"]')
            OR (operation_key = 'remove-cough-and-breath-noise' AND dependency_operation_keys_json = '["denoise-audio"]')
            OR (operation_key = 'trim-silence' AND dependency_operation_keys_json = '["remove-cough-and-breath-noise"]')
            OR (operation_key = 'filter-repeated-content' AND dependency_operation_keys_json = '["trim-silence"]')
            OR (operation_key = 'check-duplicate-content' AND dependency_operation_keys_json = '["filter-repeated-content"]')
            OR (operation_key = 'refine-subtitle-cues' AND dependency_operation_keys_json = '["trim-silence","filter-repeated-content"]')
            OR (operation_key = 'select-cover-frame' AND dependency_operation_keys_json = '["check-duplicate-content"]')),
    CONSTRAINT ck_studio_clip_processing_operation_blocking_reason
        CHECK (blocking_reason IS NULL OR blocking_reason IN ('waiting-for-dependencies', 'timeline-not-ready', 'clip-not-selected')),
    CONSTRAINT ck_studio_clip_processing_operation_blocked_reason
        CHECK (status <> 10 OR (blocking_reason IS NOT NULL AND blocked_by_operation_keys_json IS NOT NULL)),
    CONSTRAINT ck_studio_clip_processing_operation_unblocked_empty_blockers
        CHECK (status = 10 OR blocked_by_operation_keys_json = '[]'),
    CONSTRAINT ck_studio_clip_processing_operation_unblocked_empty_reason
        CHECK (status = 10 OR blocking_reason IS NULL),
    CONSTRAINT ck_studio_clip_processing_operation_status_code
        CHECK (status IN (10, 20, 30, 40, 50, 60, 70)),
    CONSTRAINT ck_studio_clip_processing_operation_status_key
        CHECK ((status = 10 AND status_key = 'blocked')
            OR (status = 20 AND status_key = 'pending')
            OR (status = 30 AND status_key = 'running')
            OR (status = 40 AND status_key = 'succeeded')
            OR (status = 50 AND status_key = 'skipped')
            OR (status = 60 AND status_key = 'failed')
            OR (status = 70 AND status_key = 'invalidated')),
    CONSTRAINT ck_studio_clip_processing_operation_source_range
        CHECK (source_end_ms > source_start_ms),
    CONSTRAINT ck_studio_clip_processing_operation_source_duration
        CHECK (source_duration_ms = source_end_ms - source_start_ms),
    CONSTRAINT ck_studio_clip_processing_operation_attempts
        CHECK (attempt_no >= 0 AND max_attempts >= 1 AND attempt_no <= max_attempts),
    CONSTRAINT ck_studio_clip_processing_operation_running_lifecycle
        CHECK (status <> 30 OR (attempt_no >= 1 AND started_at IS NOT NULL AND completed_at IS NULL)),
    CONSTRAINT ck_studio_clip_processing_operation_terminal_lifecycle
        CHECK (status NOT IN (40, 50, 60, 70) OR completed_at IS NOT NULL),
    CONSTRAINT ck_studio_clip_processing_operation_waiting_lifecycle
        CHECK (status NOT IN (10, 20) OR (attempt_no = 0 AND started_at IS NULL AND completed_at IS NULL AND duration_ms IS NULL)),
    CONSTRAINT ck_studio_clip_processing_operation_duration
        CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT ck_studio_clip_processing_operation_clip_boundary_version
        CHECK (clip_boundary_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_studio_clip_processing_operation_clip_status
    ON studio_clip_processing_operation (tenant_id, organization_id, clip_uuid, status, operation_order, id);

CREATE INDEX IF NOT EXISTS idx_studio_clip_processing_operation_task_key
    ON studio_clip_processing_operation (tenant_id, organization_id, task_uuid, operation_key, status, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_studio_clip_processing_operation_clip_range
    ON studio_clip_processing_operation (tenant_id, organization_id, clip_uuid, clip_boundary_version, source_start_ms, source_end_ms, operation_order, id);

CREATE INDEX IF NOT EXISTS idx_studio_clip_processing_operation_invalidated_event
    ON studio_clip_processing_operation (tenant_id, organization_id, invalidated_by_event_uuid, clip_uuid, operation_order, id);

CREATE TABLE IF NOT EXISTS studio_clip_event (
    id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 0,
    organization_id INTEGER NOT NULL DEFAULT 0,
    timeline_uuid TEXT NOT NULL,
    clip_uuid TEXT,
    task_uuid TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    invalidated_step_keys_json TEXT NOT NULL DEFAULT '[]',
    invalidated_operation_keys_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_studio_clip_event_uuid UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_studio_clip_event_timeline_created
    ON studio_clip_event (tenant_id, organization_id, timeline_uuid, created_at, id);
