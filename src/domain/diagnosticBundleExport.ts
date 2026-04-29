import type { DiagnosticBundle } from './videoCutTypes';

export const DIAGNOSTIC_BUNDLE_MEDIA_TYPE = 'application/vnd.sdkwork.video-cut.diagnostics+json' as const;

export interface DiagnosticBundleRedactionEvidence {
  safe: boolean;
  forbiddenMatches: string[];
  checkedPatterns: string[];
}

export interface DiagnosticBundleDownloadDescriptor {
  body: string;
  fileName: string;
  href: string;
  mediaType: typeof DIAGNOSTIC_BUNDLE_MEDIA_TYPE;
  redaction: DiagnosticBundleRedactionEvidence;
  sizeBytes: number;
}

export class DiagnosticBundleExportError extends Error {
  readonly forbiddenMatches: string[];

  constructor(forbiddenMatches: string[]) {
    super(`Unsafe diagnostics bundle: ${forbiddenMatches.join(', ')}`);
    this.name = 'DiagnosticBundleExportError';
    this.forbiddenMatches = forbiddenMatches;
  }
}

const unsafePatterns: Array<{ id: string; pattern: RegExp }> = [
  { id: 'apiKey-field', pattern: /"apiKey"\s*:/i },
  { id: 'authorization-header', pattern: /"authorization"\s*:/i },
  { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/i },
  { id: 'openai-secret-key', pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{8,}/ },
  { id: 'password-field', pattern: /"password"\s*:/i },
  { id: 'token-field', pattern: /"(?:accessToken|refreshToken|token)"\s*:/i },
  { id: 'local-absolute-path', pattern: /"(?:workspaceRoot|artifactRoot|tempRoot|path|contentRef)"\s*:\s*"(?:[A-Za-z]:\\\\|\\\\\\\\|\/(?!api\/video-cut\/v1\/))/i },
];

function toFileTimestamp(value: string): string {
  const parsed = new Date(value);
  const iso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();

  return iso.replace(/[-:.]/g, '');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function inspectDiagnosticBundleRedaction(body: string): DiagnosticBundleRedactionEvidence {
  const forbiddenMatches = unsafePatterns.filter(({ pattern }) => pattern.test(body)).map(({ id }) => id);

  return {
    safe: forbiddenMatches.length === 0,
    forbiddenMatches,
    checkedPatterns: unsafePatterns.map(({ id }) => id),
  };
}

export function createDiagnosticBundleDownloadDescriptor(bundle: DiagnosticBundle): DiagnosticBundleDownloadDescriptor {
  const body = `${JSON.stringify(bundle, null, 2)}\n`;
  const redaction = inspectDiagnosticBundleRedaction(body);

  if (!redaction.safe) {
    throw new DiagnosticBundleExportError(redaction.forbiddenMatches);
  }

  const fileName = `sdkwork-video-cut-diagnostics-${bundle.deploymentMode}-${toFileTimestamp(bundle.generatedAt)}.json`;

  return {
    body,
    fileName,
    href: `data:${DIAGNOSTIC_BUNDLE_MEDIA_TYPE};charset=utf-8,${encodeURIComponent(body)}`,
    mediaType: DIAGNOSTIC_BUNDLE_MEDIA_TYPE,
    redaction,
    sizeBytes: byteLength(body),
  };
}
