import type { SmartCutArtifactKind } from './domain.ts';
import { SMART_CUT_STANDARD_VERSION } from './domain.ts';
import type { SmartCutRenderContract } from './render-contract.ts';

export interface SmartCutRenderedArtifactProbe {
  durationMs?: number;
  width?: number;
  height?: number;
  frameRateFps?: number | 'source';
  format?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  cueCount?: number;
  schemaVersion?: string;
  ready?: boolean;
  metricCount?: number;
}

export interface SmartCutRenderArtifact {
  id: string;
  candidateId: string;
  kind: SmartCutArtifactKind;
  path: string;
  byteSize: number;
  checksum: string;
  probe: SmartCutRenderedArtifactProbe;
}

export interface SmartCutRenderArtifactValidationInput {
  renderContract: SmartCutRenderContract;
  artifacts: readonly SmartCutRenderArtifact[];
}

export type SmartCutRenderArtifactBlockerCode =
  | 'RENDER_ARTIFACTS_WITHOUT_CONTRACT_CANDIDATES'
  | 'ARTIFACT_ID_MISSING'
  | 'ARTIFACT_CANDIDATE_ID_MISSING'
  | 'DUPLICATE_RENDER_ARTIFACT_ID'
  | 'DUPLICATE_RENDER_ARTIFACT_KIND_FOR_CANDIDATE'
  | 'ARTIFACT_KIND_NOT_REQUIRED'
  | 'ARTIFACT_FOR_UNKNOWN_CANDIDATE'
  | 'MISSING_REQUIRED_ARTIFACT_KIND'
  | 'ARTIFACT_EMPTY_FILE'
  | 'ARTIFACT_MISSING_CHECKSUM'
  | 'ARTIFACT_MISSING_PATH'
  | 'VIDEO_PROBE_MISSING'
  | 'VIDEO_DURATION_INVALID'
  | 'VIDEO_DURATION_BELOW_PRESET_MINIMUM'
  | 'VIDEO_DURATION_ABOVE_PRESET_MAXIMUM'
  | 'VIDEO_RESOLUTION_MISMATCH'
  | 'VIDEO_FRAME_RATE_MISMATCH'
  | 'VIDEO_FORMAT_MISMATCH'
  | 'VIDEO_AUDIO_STREAM_MISSING'
  | 'VIDEO_STREAM_MISSING'
  | 'SUBTITLE_PROBE_INVALID'
  | 'COVER_PROBE_INVALID'
  | 'QUALITY_REPORT_PROBE_INVALID';

export interface SmartCutRenderArtifactBlocker {
  code: SmartCutRenderArtifactBlockerCode;
  message: string;
  candidateId?: string;
  artifactId?: string;
  artifactKind?: SmartCutArtifactKind;
  remediation: string;
}

export interface SmartCutRenderArtifactCandidateReport {
  candidateId: string;
  artifactKinds: readonly SmartCutArtifactKind[];
  missingArtifactKinds: readonly SmartCutArtifactKind[];
  blockerCodes: readonly SmartCutRenderArtifactBlockerCode[];
}

export interface SmartCutRenderArtifactValidationReport {
  ready: boolean;
  artifacts: readonly SmartCutRenderArtifact[];
  blockers: readonly SmartCutRenderArtifactBlocker[];
  candidateReports: readonly SmartCutRenderArtifactCandidateReport[];
  requiredArtifactKinds: readonly SmartCutArtifactKind[];
  artifactCount: number;
  candidateCount: number;
}

export function validateSmartCutRenderArtifacts(
  input: SmartCutRenderArtifactValidationInput,
): SmartCutRenderArtifactValidationReport {
  const blockers: SmartCutRenderArtifactBlocker[] = [];

  if (input.renderContract.candidateIds.length === 0) {
    blockers.push({
      code: 'RENDER_ARTIFACTS_WITHOUT_CONTRACT_CANDIDATES',
      message: `Render contract ${input.renderContract.id} has no candidate ids.`,
      remediation: 'Validate render artifacts only against a render contract created from approved candidates.',
    });
  }

  validateArtifactSet(input.artifacts, input.renderContract, blockers);

  for (const artifact of input.artifacts) {
    validateArtifactBase(artifact, input.renderContract, blockers);
    validateArtifactProbe(artifact, input.renderContract, blockers);
  }

  const candidateReports = input.renderContract.candidateIds.map((candidateId) =>
    createCandidateReport(candidateId, input.renderContract.requiredArtifactKinds, input.artifacts, blockers)
  );

  for (const report of candidateReports) {
    for (const missingKind of report.missingArtifactKinds) {
      blockers.push({
        code: 'MISSING_REQUIRED_ARTIFACT_KIND',
        message: `Candidate ${report.candidateId} is missing required render artifact ${missingKind}.`,
        candidateId: report.candidateId,
        artifactKind: missingKind,
        remediation: 'Render and probe every artifact kind required by the render contract before publish.',
      });
    }
  }

  const finalCandidateReports = input.renderContract.candidateIds.map((candidateId) =>
    createCandidateReport(candidateId, input.renderContract.requiredArtifactKinds, input.artifacts, blockers)
  );

  return {
    ready: blockers.length === 0,
    artifacts: input.artifacts.map(cloneArtifact),
    blockers,
    candidateReports: finalCandidateReports,
    requiredArtifactKinds: [...input.renderContract.requiredArtifactKinds],
    artifactCount: input.artifacts.length,
    candidateCount: input.renderContract.candidateIds.length,
  };
}

function validateArtifactSet(
  artifacts: readonly SmartCutRenderArtifact[],
  renderContract: SmartCutRenderContract,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  const seenArtifactIds = new Set<string>();
  const reportedArtifactIds = new Set<string>();
  const seenCandidateKinds = new Set<string>();
  const reportedCandidateKinds = new Set<string>();

  for (const artifact of artifacts) {
    if (artifact.id.trim().length === 0) {
      blockers.push({
        code: 'ARTIFACT_ID_MISSING',
        message: 'Render artifact has no artifact id.',
        candidateId: artifact.candidateId,
        artifactKind: artifact.kind,
        remediation: 'Persist a stable unique artifact id for every native output.',
      });
    } else if (seenArtifactIds.has(artifact.id)) {
      if (!reportedArtifactIds.has(artifact.id)) {
        blockers.push({
          code: 'DUPLICATE_RENDER_ARTIFACT_ID',
          message: `Render artifact id ${artifact.id} is duplicated.`,
          candidateId: artifact.candidateId,
          artifactId: artifact.id,
          artifactKind: artifact.kind,
          remediation: 'Reject native render outputs unless every artifact id is unique.',
        });
        reportedArtifactIds.add(artifact.id);
      }
    } else {
      seenArtifactIds.add(artifact.id);
    }

    if (artifact.candidateId.trim().length === 0) {
      blockers.push({
        code: 'ARTIFACT_CANDIDATE_ID_MISSING',
        message: `Render artifact ${artifact.id} has no candidate id.`,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        remediation: 'Tie every rendered artifact to a selected render contract candidate id.',
      });
    }

    if (!renderContract.requiredArtifactKinds.includes(artifact.kind)) {
      blockers.push({
        code: 'ARTIFACT_KIND_NOT_REQUIRED',
        message: `Render artifact ${artifact.id} kind ${artifact.kind} is not required by render contract ${renderContract.id}.`,
        candidateId: artifact.candidateId,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        remediation: 'Publish only artifact kinds declared by the render contract.',
      });
    }

    const candidateKindKey = `${artifact.candidateId}\u0000${artifact.kind}`;
    if (seenCandidateKinds.has(candidateKindKey)) {
      if (!reportedCandidateKinds.has(candidateKindKey)) {
        blockers.push({
          code: 'DUPLICATE_RENDER_ARTIFACT_KIND_FOR_CANDIDATE',
          message: `Candidate ${artifact.candidateId} has duplicate render artifact kind ${artifact.kind}.`,
          candidateId: artifact.candidateId,
          artifactId: artifact.id,
          artifactKind: artifact.kind,
          remediation: 'Each candidate must have at most one artifact for each required artifact kind.',
        });
        reportedCandidateKinds.add(candidateKindKey);
      }
    } else {
      seenCandidateKinds.add(candidateKindKey);
    }
  }
}

function validateArtifactBase(
  artifact: SmartCutRenderArtifact,
  renderContract: SmartCutRenderContract,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  if (!renderContract.candidateIds.includes(artifact.candidateId)) {
    blockers.push({
      code: 'ARTIFACT_FOR_UNKNOWN_CANDIDATE',
      message: `Artifact ${artifact.id} references candidate ${artifact.candidateId}, which is not in render contract ${renderContract.id}.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Discard artifacts that are not tied to the render contract candidate ids.',
    });
  }

  if (artifact.path.trim().length === 0) {
    blockers.push({
      code: 'ARTIFACT_MISSING_PATH',
      message: `Artifact ${artifact.id} has no filesystem path.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Persist render artifact paths from native output before publication.',
    });
  }

  if (!Number.isInteger(artifact.byteSize) || artifact.byteSize <= 0) {
    blockers.push({
      code: 'ARTIFACT_EMPTY_FILE',
      message: `Artifact ${artifact.id} byte size ${artifact.byteSize} is invalid.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Probe rendered files and reject empty or missing artifacts.',
    });
  }

  if (artifact.checksum.trim().length === 0) {
    blockers.push({
      code: 'ARTIFACT_MISSING_CHECKSUM',
      message: `Artifact ${artifact.id} has no checksum.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Compute checksums for every rendered artifact for reproducible audit and delivery.',
    });
  }
}

function validateArtifactProbe(
  artifact: SmartCutRenderArtifact,
  renderContract: SmartCutRenderContract,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  if (artifact.kind === 'rendered-video') {
    validateRenderedVideoProbe(artifact, renderContract, blockers);
    return;
  }

  if (artifact.kind === 'subtitle') {
    validateSubtitleProbe(artifact, blockers);
    return;
  }

  if (artifact.kind === 'cover') {
    validateCoverProbe(artifact, renderContract, blockers);
    return;
  }

  if (artifact.kind === 'quality-report') {
    validateQualityReportProbe(artifact, blockers);
  }
}

function validateRenderedVideoProbe(
  artifact: SmartCutRenderArtifact,
  renderContract: SmartCutRenderContract,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  const probe = artifact.probe;
  const durationMs = probe.durationMs;
  const width = probe.width;
  const height = probe.height;
  const format = probe.format;
  if (
    !isIntegerNumber(durationMs) ||
    !isIntegerNumber(width) ||
    !isIntegerNumber(height) ||
    format === undefined
  ) {
    blockers.push({
      code: 'VIDEO_PROBE_MISSING',
      message: `Rendered video artifact ${artifact.id} has incomplete probe metadata.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Probe rendered video with the native engine before publish validation.',
    });
    return;
  }

  if (durationMs <= 0) {
    blockers.push({
      code: 'VIDEO_DURATION_INVALID',
      message: `Rendered video artifact ${artifact.id} has invalid duration ${durationMs}.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Reject rendered videos with invalid probed duration.',
    });
  }

  const minDurationMs = renderContract.outputProfile.minDurationMs;
  if (minDurationMs !== undefined && durationMs < minDurationMs) {
    blockers.push({
      code: 'VIDEO_DURATION_BELOW_PRESET_MINIMUM',
      message: `Rendered video artifact ${artifact.id} duration ${durationMs}ms is below preset minimum ${minDurationMs}ms.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Do not publish rendered outputs that violate the product duration contract.',
    });
  }

  const maxDurationMs = renderContract.outputProfile.maxDurationMs;
  if (maxDurationMs !== undefined && durationMs > maxDurationMs) {
    blockers.push({
      code: 'VIDEO_DURATION_ABOVE_PRESET_MAXIMUM',
      message: `Rendered video artifact ${artifact.id} duration ${durationMs}ms exceeds preset maximum ${maxDurationMs}ms.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Do not publish rendered outputs that exceed the product duration contract.',
    });
  }

  validateRenderedVideoOutputProfile(artifact, renderContract, blockers);
  validateRenderedVideoStreams(artifact, blockers);
}

function validateRenderedVideoOutputProfile(
  artifact: SmartCutRenderArtifact,
  renderContract: SmartCutRenderContract,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  const probe = artifact.probe;
  const expectedResolution = renderContract.outputProfile.resolution;
  if (expectedResolution !== 'source') {
    const [expectedWidth, expectedHeight] = expectedResolution.split('x').map((value) => Number.parseInt(value, 10));
    if (probe.width !== expectedWidth || probe.height !== expectedHeight) {
      blockers.push({
        code: 'VIDEO_RESOLUTION_MISMATCH',
        message: `Rendered video artifact ${artifact.id} resolution ${probe.width}x${probe.height} does not match ${expectedResolution}.`,
        candidateId: artifact.candidateId,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        remediation: 'Render with the exact output resolution required by the product preset.',
      });
    }
  }

  const expectedFrameRate = renderContract.outputProfile.frameRateFps;
  if (expectedFrameRate !== 'source' && probe.frameRateFps !== expectedFrameRate) {
    blockers.push({
      code: 'VIDEO_FRAME_RATE_MISMATCH',
      message: `Rendered video artifact ${artifact.id} frame rate ${probe.frameRateFps} does not match ${expectedFrameRate}.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Render with the frame rate required by the product preset.',
    });
  }

  if (probe.format !== renderContract.outputProfile.format) {
    blockers.push({
      code: 'VIDEO_FORMAT_MISMATCH',
      message: `Rendered video artifact ${artifact.id} format ${probe.format} does not match ${renderContract.outputProfile.format}.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Render using the container format required by the product preset.',
    });
  }
}

function validateRenderedVideoStreams(
  artifact: SmartCutRenderArtifact,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  if (artifact.probe.hasVideo !== true) {
    blockers.push({
      code: 'VIDEO_STREAM_MISSING',
      message: `Rendered video artifact ${artifact.id} has no video stream.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Reject outputs that do not contain a video stream.',
    });
  }

  if (artifact.probe.hasAudio !== true) {
    blockers.push({
      code: 'VIDEO_AUDIO_STREAM_MISSING',
      message: `Rendered video artifact ${artifact.id} has no audio stream.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Render publishable clips with the validated audio stream unless the preset explicitly becomes asset-only.',
    });
  }
}

function validateSubtitleProbe(
  artifact: SmartCutRenderArtifact,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  const cueCount = artifact.probe.cueCount;
  if (!isIntegerNumber(cueCount) || cueCount <= 0) {
    blockers.push({
      code: 'SUBTITLE_PROBE_INVALID',
      message: `Subtitle artifact ${artifact.id} has invalid cue count ${cueCount}.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Generate subtitle cues from validated transcript evidence before publish.',
    });
  }
}

function validateCoverProbe(
  artifact: SmartCutRenderArtifact,
  renderContract: SmartCutRenderContract,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  const expectedResolution = renderContract.outputProfile.resolution;
  const width = artifact.probe.width;
  const height = artifact.probe.height;
  if (
    !isIntegerNumber(width) ||
    !isIntegerNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    blockers.push({
      code: 'COVER_PROBE_INVALID',
      message: `Cover artifact ${artifact.id} has invalid dimensions.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Probe generated covers and reject invalid image files.',
    });
    return;
  }

  if (expectedResolution !== 'source') {
    const [expectedWidth, expectedHeight] = expectedResolution.split('x').map((value) => Number.parseInt(value, 10));
    if (width !== expectedWidth || height !== expectedHeight) {
      blockers.push({
        code: 'COVER_PROBE_INVALID',
        message: `Cover artifact ${artifact.id} dimensions ${width}x${height} do not match ${expectedResolution}.`,
        candidateId: artifact.candidateId,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        remediation: 'Generate covers at the output resolution required by the render contract.',
      });
    }
  }
}

function validateQualityReportProbe(
  artifact: SmartCutRenderArtifact,
  blockers: SmartCutRenderArtifactBlocker[],
) {
  const metricCount = artifact.probe.metricCount;
  if (
    artifact.probe.schemaVersion !== SMART_CUT_STANDARD_VERSION ||
    artifact.probe.ready !== true ||
    !isIntegerNumber(metricCount) ||
    metricCount <= 0
  ) {
    blockers.push({
      code: 'QUALITY_REPORT_PROBE_INVALID',
      message: `Quality report artifact ${artifact.id} is not a ready smart cut quality report.`,
      candidateId: artifact.candidateId,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      remediation: 'Write a versioned quality report with publishability and artifact metrics for every candidate.',
    });
  }
}

function createCandidateReport(
  candidateId: string,
  requiredArtifactKinds: readonly SmartCutArtifactKind[],
  artifacts: readonly SmartCutRenderArtifact[],
  blockers: readonly SmartCutRenderArtifactBlocker[],
): SmartCutRenderArtifactCandidateReport {
  const candidateArtifacts = artifacts.filter((artifact) => artifact.candidateId === candidateId);
  const artifactKinds = uniqueValues(candidateArtifacts.map((artifact) => artifact.kind));
  const missingArtifactKinds = requiredArtifactKinds.filter((kind) => !artifactKinds.includes(kind));
  const blockerCodes = blockers
    .filter((blocker) => blocker.candidateId === candidateId)
    .map((blocker) => blocker.code);

  return {
    candidateId,
    artifactKinds,
    missingArtifactKinds,
    blockerCodes,
  };
}

function cloneArtifact(artifact: SmartCutRenderArtifact): SmartCutRenderArtifact {
  return {
    ...artifact,
    probe: { ...artifact.probe },
  };
}

function uniqueValues<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function isIntegerNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
