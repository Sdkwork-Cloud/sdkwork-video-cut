use serde::Serialize;

pub const AUTOCUT_DATABASE_CONTRACT_VERSION: &str = "2026-05-05.native-host-baseline.v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutDatabaseColumnContract {
    pub name: &'static str,
    pub logical_type: &'static str,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutDatabaseTableContract {
    pub name: &'static str,
    pub domain_prefix: &'static str,
    pub profile: &'static str,
    pub owner: &'static str,
    pub columns: &'static [AutoCutDatabaseColumnContract],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutDatabaseContract {
    pub version: &'static str,
    pub target_dialect: &'static str,
    pub schema_registry_path: &'static str,
    pub sqlite_baseline_path: &'static str,
    pub tables: &'static [AutoCutDatabaseTableContract],
}

const STANDARD_IDENTITY_COLUMNS: &[AutoCutDatabaseColumnContract] = &[
    AutoCutDatabaseColumnContract {
        name: "id",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "uuid",
        logical_type: "string",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "created_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "updated_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "version",
        logical_type: "int64",
        required: true,
    },
];

const STUDIO_CLIP_COLUMNS: &[AutoCutDatabaseColumnContract] = &[
    AutoCutDatabaseColumnContract {
        name: "id",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "uuid",
        logical_type: "string",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "created_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "updated_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "version",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "boundary_version",
        logical_type: "int64",
        required: true,
    },
];

const STUDIO_CLIP_PROCESSING_OPERATION_COLUMNS: &[AutoCutDatabaseColumnContract] = &[
    AutoCutDatabaseColumnContract {
        name: "id",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "uuid",
        logical_type: "string",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "created_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "updated_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "version",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "status_key",
        logical_type: "string",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "execution_stage",
        logical_type: "string",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "dependency_operation_keys_json",
        logical_type: "json",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "blocked_by_operation_keys_json",
        logical_type: "json",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "blocking_reason",
        logical_type: "string",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "attempt_no",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "max_attempts",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "started_at",
        logical_type: "instant",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "completed_at",
        logical_type: "instant",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "duration_ms",
        logical_type: "int64",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "worker_id",
        logical_type: "string",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "clip_boundary_version",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "source_start_ms",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "source_end_ms",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "source_duration_ms",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "invalidated_by_event_uuid",
        logical_type: "string",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "invalidated_at",
        logical_type: "instant",
        required: false,
    },
];

const STUDIO_CLIP_EVENT_COLUMNS: &[AutoCutDatabaseColumnContract] = &[
    AutoCutDatabaseColumnContract {
        name: "id",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "uuid",
        logical_type: "string",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "created_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "updated_at",
        logical_type: "instant",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "version",
        logical_type: "int64",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "clip_uuid",
        logical_type: "string",
        required: false,
    },
    AutoCutDatabaseColumnContract {
        name: "invalidated_step_keys_json",
        logical_type: "json",
        required: true,
    },
    AutoCutDatabaseColumnContract {
        name: "invalidated_operation_keys_json",
        logical_type: "json",
        required: true,
    },
];

pub const AUTOCUT_DATABASE_CONTRACT: AutoCutDatabaseContract = AutoCutDatabaseContract {
    version: AUTOCUT_DATABASE_CONTRACT_VERSION,
    target_dialect: "sqlite",
    schema_registry_path: "database/schema-registry/autocut_host_baseline.yaml",
    sqlite_baseline_path: "database/schema/sqlite/001_baseline.sql",
    tables: &[
        AutoCutDatabaseTableContract {
            name: "ops_schema_migration",
            domain_prefix: "ops",
            profile: "migration_history",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "media_asset",
            domain_prefix: "media",
            profile: "owner_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "media_artifact",
            domain_prefix: "media",
            profile: "core_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_task",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_task_event",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_stage_run",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_worker_lease",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_workflow_run",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_step_run",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "ops_step_item_run",
            domain_prefix: "ops",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "media_text_track",
            domain_prefix: "media",
            profile: "core_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "media_text_segment",
            domain_prefix: "media",
            profile: "core_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "media_content_unit",
            domain_prefix: "media",
            profile: "core_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "studio_timeline",
            domain_prefix: "studio",
            profile: "owner_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "studio_clip",
            domain_prefix: "studio",
            profile: "core_entity",
            owner: "sdkwork-video-cut-host",
            columns: STUDIO_CLIP_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "studio_clip_source_ref",
            domain_prefix: "studio",
            profile: "core_entity",
            owner: "sdkwork-video-cut-host",
            columns: STANDARD_IDENTITY_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "studio_clip_processing_operation",
            domain_prefix: "studio",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STUDIO_CLIP_PROCESSING_OPERATION_COLUMNS,
        },
        AutoCutDatabaseTableContract {
            name: "studio_clip_event",
            domain_prefix: "studio",
            profile: "event_log",
            owner: "sdkwork-video-cut-host",
            columns: STUDIO_CLIP_EVENT_COLUMNS,
        },
    ],
};

pub fn autocut_database_contract() -> &'static AutoCutDatabaseContract {
    &AUTOCUT_DATABASE_CONTRACT
}
