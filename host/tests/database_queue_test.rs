use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use sdkwork_video_cut_host::database_queue::{
    QueueClaimRequest, QueueTaskInput, SqliteTaskQueue, TaskQueuePort,
};

fn temp_database_url(name: &str) -> (String, PathBuf) {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_millis();
    let path = std::env::temp_dir().join(format!("sdkwork-video-cut-{name}-{millis}.sqlite"));
    if path.exists() {
        fs::remove_file(&path).expect("remove old sqlite db");
    }

    let normalized_path = path.to_string_lossy().replace('\\', "/");
    (
        format!("sqlite:///{}", normalized_path.trim_start_matches('/')),
        path,
    )
}

fn task_input(task_uuid: &str) -> QueueTaskInput {
    tenant_task_input("default", task_uuid)
}

fn tenant_task_input(tenant_id: &str, task_uuid: &str) -> QueueTaskInput {
    QueueTaskInput {
        task_uuid: task_uuid.to_string(),
        project_uuid: "project-default".to_string(),
        tenant_id: tenant_id.to_string(),
        owner_type: "local-user".to_string(),
        owner_id: "default-user".to_string(),
        idempotency_key: format!("idem-{task_uuid}"),
        title: format!("Task {task_uuid}"),
        status: "sourceReady".to_string(),
        current_stage: "queued".to_string(),
        priority: 10,
        run_after_at: "2026-04-27T00:00:00Z".to_string(),
        metadata_json: "{}".to_string(),
        created_at: "2026-04-27T00:00:00Z".to_string(),
    }
}

fn claim_request(worker_id: &str) -> QueueClaimRequest {
    tenant_claim_request("default", worker_id)
}

fn tenant_claim_request(tenant_id: &str, worker_id: &str) -> QueueClaimRequest {
    QueueClaimRequest {
        tenant_id: tenant_id.to_string(),
        worker_id: worker_id.to_string(),
        lease_token: format!("lease-{worker_id}"),
        now: "2026-04-27T00:00:01Z".to_string(),
        lease_expires_at: "2026-04-27T00:05:01Z".to_string(),
    }
}

#[tokio::test]
async fn sqlite_database_queue_applies_baseline_and_allows_single_worker_claim() {
    let (database_url, database_path) = temp_database_url("queue-claim");
    let queue = SqliteTaskQueue::connect(&database_url)
        .await
        .expect("connect sqlite queue");
    queue
        .initialize_schema()
        .await
        .expect("initialize baseline schema");
    queue
        .enqueue_task(task_input("task-claim-1"))
        .await
        .expect("enqueue task");

    let worker_a = queue.clone();
    let worker_b = queue.clone();
    let (claim_a, claim_b) = tokio::join!(
        worker_a.claim_next(claim_request("worker-a")),
        worker_b.claim_next(claim_request("worker-b")),
    );

    let claims = [claim_a.expect("claim a"), claim_b.expect("claim b")];
    assert_eq!(claims.iter().filter(|claim| claim.is_some()).count(), 1);
    let claim = claims.into_iter().flatten().next().expect("one claim");
    assert_eq!(claim.task_uuid, "task-claim-1");
    assert_eq!(claim.queue_status, "claimed");
    assert!(claim.claimed_by == "worker-a" || claim.claimed_by == "worker-b");

    let claimed_task = queue
        .get_task_queue_state("task-claim-1")
        .await
        .expect("read task")
        .expect("task row");
    assert_eq!(claimed_task.queue_status, "claimed");
    assert_eq!(claimed_task.attempt_count, 1);
    assert_eq!(claimed_task.claimed_by, Some(claim.claimed_by));

    let _ = fs::remove_file(database_path);
}

#[tokio::test]
async fn sqlite_database_queue_claims_only_within_the_requested_tenant() {
    let (database_url, database_path) = temp_database_url("queue-tenant");
    let queue = SqliteTaskQueue::connect(&database_url)
        .await
        .expect("connect sqlite queue");
    queue
        .initialize_schema()
        .await
        .expect("initialize baseline schema");
    queue
        .enqueue_task(tenant_task_input("tenant-a", "task-tenant-a"))
        .await
        .expect("enqueue tenant a task");
    queue
        .enqueue_task(tenant_task_input("tenant-b", "task-tenant-b"))
        .await
        .expect("enqueue tenant b task");

    let claim = queue
        .claim_next(tenant_claim_request("tenant-b", "worker-b"))
        .await
        .expect("claim tenant b")
        .expect("tenant b claim");

    assert_eq!(claim.task_uuid, "task-tenant-b");
    let tenant_a_task = queue
        .get_task_queue_state("task-tenant-a")
        .await
        .expect("read tenant a task")
        .expect("tenant a task");
    assert_eq!(tenant_a_task.queue_status, "queued");

    let _ = fs::remove_file(database_path);
}
