# VIDEO_CUT Database Module

Canonical lifecycle assets for `sdkwork-video-cut` per `DATABASE_FRAMEWORK_SPEC.md`.

- moduleId: `videocut`
- serviceCode: `VIDEO_CUT`
- tablePrefix: `videocut_` (logical); physical prefixes: `media_`, `ops_`, `studio_`

## Commands

```bash
pnpm run db:validate
pnpm run db:materialize:contract
pnpm run db:plan
pnpm run db:init
pnpm run db:migrate
pnpm run db:seed
pnpm run db:status
pnpm run db:drift:check
pnpm run db:bootstrap
```

`db:materialize:contract` materializes L2 contract files and syncs the framework SQLite baseline into the Tauri package-local runtime path.

## Baseline

- Framework: `database/ddl/baseline/sqlite/0001_videocut_legacy_baseline.sql`
- Tauri runtime mirror: `packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql`

`tools/check-videocut-baseline-sync.mjs` enforces byte-identical baselines during `db:validate`.

## Runtime surfaces

### CLI / CI (sqlx + sdkwork-database-lifecycle)

Set SQLite URL and engine, then run lifecycle commands:

```bash
export SDKWORK_VIDEO_CUT_DATABASE_URL="sqlite:///absolute/path/to/videocut.sqlite3"
export SDKWORK_VIDEO_CUT_DATABASE_ENGINE=sqlite
pnpm run db:bootstrap
```

### Desktop Tauri (rusqlite)

The desktop host applies the synced baseline through `database_runtime.rs` on startup. Build-time constants are generated from `database/database.manifest.json` in `src-tauri/build.rs`.

Optional overrides:

- `SDKWORK_AUTOCUT_SQLITE_FILE` — absolute sqlite file path
- Default: app data dir `sdkwork-autocut.sqlite3`

Native host contract tables remain validated through `database_contract.rs`; framework contract version is recorded in `ops_schema_migration.contract_version`.
