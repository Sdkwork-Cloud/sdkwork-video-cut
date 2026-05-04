import { sanitizeErrorMessage } from './report-safety.mjs';

export function createRemediationSummary(...sources) {
  const actions = [];
  const seen = new Set();

  for (const source of sources) {
    for (const action of collectRemediationActions(source)) {
      const evidence = toRemediationActionEvidence(action);
      if (!evidence.id) {
        continue;
      }
      const key = `${evidence.id}|${evidence.code}|${evidence.category}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      actions.push(evidence);
    }
  }

  return {
    total: actions.length,
    actions,
  };
}

export function createRemediationActions(environmentBlockers) {
  return toRemediationActionsFromBlockers(environmentBlockers).map(toRemediationActionEvidence);
}

function collectRemediationActions(source) {
  if (!source) {
    return [];
  }

  if (Array.isArray(source)) {
    return source.flatMap((item) => collectRemediationActions(item));
  }

  if (typeof source !== 'object') {
    return [];
  }

  const directActions = Array.isArray(source.remediationActions) ? source.remediationActions : [];
  const summaryActions = Array.isArray(source.remediationSummary?.actions) ? source.remediationSummary.actions : [];
  const blockerActions = directActions.length === 0 && summaryActions.length === 0
    ? toRemediationActionsFromBlockers(source.environmentBlockers)
    : [];
  return [...directActions, ...summaryActions, ...blockerActions];
}

function toRemediationActionEvidence(action) {
  return {
    id: sanitizeEvidenceString(action?.id ?? ''),
    code: sanitizeEvidenceString(action?.code ?? 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED'),
    category: sanitizeEvidenceString(action?.category ?? 'preflight'),
    envVar: sanitizeEvidenceString(action?.envVar ?? 'SDKWORK_VIDEO_CUT_RELEASE_ENVIRONMENT'),
    commandHint: sanitizeEvidenceString(action?.commandHint ?? 'pnpm release:smoke:preflight -- --json'),
    action: sanitizeEvidenceString(
      action?.action ??
        'Inspect the preflight evidence and rerun release:smoke:preflight after correcting the release runner environment.',
    ),
  };
}

function toRemediationActionsFromBlockers(environmentBlockers) {
  return Array.isArray(environmentBlockers)
    ? environmentBlockers.map((blocker) => ({
        id: blocker?.id ?? '',
        code: blocker?.code ?? 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
        category: blocker?.category ?? 'preflight',
        envVar: remediationEnvVar(blocker),
        commandHint: remediationCommandHint(blocker),
        action: remediationAction(blocker),
      }))
    : [];
}

function remediationEnvVar(blocker) {
  if (blocker?.id === 'release-smoke-preflight-ffmpeg-spawn') {
    return 'SDKWORK_VIDEO_CUT_FFMPEG_PATH';
  }
  if (blocker?.id === 'release-smoke-preflight-cargo-spawn') {
    return 'SDKWORK_VIDEO_CUT_CARGO_PATH';
  }
  if (blocker?.id === 'release-smoke-preflight-browser-executable') {
    return 'SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH';
  }
  if (blocker?.id === 'release-smoke-preflight-local-ports') {
    return 'SDKWORK_VIDEO_CUT_BIND_HOST';
  }
  if (blocker?.id === 'release-smoke-preflight-writable-directories') {
    return 'SDKWORK_VIDEO_CUT_RELEASE_ARTIFACTS_DIR';
  }
  return 'SDKWORK_VIDEO_CUT_RELEASE_ENVIRONMENT';
}

function remediationCommandHint(blocker) {
  if (blocker?.id === 'release-smoke-preflight-ffmpeg-spawn') {
    return 'pnpm release:smoke:preflight -- --ffmpeg-path <project-relative-or-PATH-command> --json';
  }
  if (blocker?.id === 'release-smoke-preflight-cargo-spawn') {
    return 'pnpm release:smoke:preflight -- --cargo-path <project-relative-or-PATH-command> --json';
  }
  if (blocker?.id === 'release-smoke-preflight-browser-executable') {
    return 'pnpm release:smoke:preflight -- --chrome-executable-path <project-relative-browser-path> --json';
  }
  if (blocker?.id === 'release-smoke-preflight-local-ports') {
    return 'pnpm release:smoke:preflight -- --bind-host 127.0.0.1 --json';
  }
  if (blocker?.id === 'release-smoke-preflight-writable-directories') {
    return 'pnpm release:smoke:preflight -- --release-assets-dir artifacts/release-smoke-matrix --report-dir artifacts/governance --json';
  }
  if (blocker?.id === 'release-smoke-preflight-host-cargo-manifest') {
    return 'git restore host/Cargo.toml && pnpm release:smoke:preflight -- --json';
  }
  if (blocker?.id === 'release-smoke-preflight-vite-bin') {
    return 'pnpm install --frozen-lockfile && pnpm release:smoke:preflight -- --json';
  }
  return 'pnpm release:smoke:preflight -- --json';
}

function remediationAction(blocker) {
  if (blocker?.category === 'tool-spawn') {
    return 'Install the required tool on the release runner or pass its command/path through the matching CLI flag or SDKWORK_VIDEO_CUT_* environment variable.';
  }
  if (blocker?.category === 'browser') {
    return 'Install a Chromium-compatible browser on the runner or pass a project-relative browser executable path.';
  }
  if (blocker?.category === 'network') {
    return 'Allow loopback ephemeral port allocation for the configured bind host before running release smoke.';
  }
  if (blocker?.category === 'filesystem') {
    return 'Grant write access to release, smoke report, governance, and runtime artifact directories.';
  }
  if (blocker?.category === 'required-file') {
    return 'Restore required repository files or install dependencies before running release smoke.';
  }
  return 'Inspect the preflight evidence and rerun release:smoke:preflight after correcting the release runner environment.';
}

function sanitizeEvidenceString(value) {
  return sanitizeErrorMessage(value).trim();
}
