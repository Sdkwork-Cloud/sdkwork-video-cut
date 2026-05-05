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
    ],
};

pub fn autocut_database_contract() -> &'static AutoCutDatabaseContract {
    &AUTOCUT_DATABASE_CONTRACT
}
