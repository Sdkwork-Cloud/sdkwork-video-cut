# 15 Database Queue Baseline Implementation

Date: 2026-04-27

## Purpose

This document records the implemented database-backed queue baseline for `sdkwork-video-cut`.
The local default remains the filesystem workspace manifest. Database queue support is an explicit adapter path for server/container/kubernetes rollout, not a replacement for the local MVP source of truth.

## Implemented Artifacts

- Contract source: `docs/database/prefix-registry.yaml`
- Table registry: `docs/database/schema-registry/*.yaml`
- SQLite baseline: `host/database/schema/sqlite/001_baseline.sql`
- PostgreSQL baseline: `host/database/schema/postgres/001_baseline.sql`
- Queue port with SQLite and PostgreSQL adapters: `host/src/database_queue.rs`
- Queue semantic test: `host/tests/database_queue_test.rs`
- Governance check: `scripts/check-video-cut-database-contracts.mjs`

## Runtime Boundary

`TaskQueuePort` owns queue semantics. Use cases must not import SQLx, compose SQL strings, or depend on database row structs. SQLx is limited to adapter code, currently `SqliteTaskQueue` and `PostgresTaskQueue`.

The queue contract provides:

- baseline schema initialization through explicit `initialize_schema`;
- idempotent task enqueue by `(tenant_id, idempotency_key)`;
- atomic `claim_next` with worker lease upsert; PostgreSQL uses `FOR UPDATE SKIP LOCKED` for multi-worker claims;
- one successful claim per queued task under concurrent workers;
- queryable task queue state for diagnostics and conformance tests.

## Baseline And Migration Policy

This is a new-project baseline. `host/migrations/` must stay absent until a released database version needs an upgrade path. Future schema changes after release must use migration files only after updating `docs/database/schema-registry/*.yaml` and passing `pnpm check:database-contracts`.

## Fast Gates

```bash
pnpm check:database-contracts
cargo test --manifest-path host/Cargo.toml --test database_queue_test -- --nocapture
pnpm check:feature-readiness -- --json
```

These checks verify prefix governance, schema registry coverage, SQLite/PostgreSQL baseline alignment, absence of new-project migrations, and the core multi-worker claim invariant.
