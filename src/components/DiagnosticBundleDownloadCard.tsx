import { FileDown } from 'lucide-react';

import type { DiagnosticBundleDownloadDescriptor } from '../domain/diagnosticBundleExport';
import type { DiagnosticBundle } from '../domain/videoCutTypes';

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function DiagnosticBundleDownloadCard({
  bundle,
  download,
}: {
  bundle?: DiagnosticBundle;
  download?: DiagnosticBundleDownloadDescriptor;
}) {
  if (!bundle) {
    return null;
  }

  return (
    <div className="settings-doctor-report diagnostics-export-card">
      <div className="doctor-summary">
        <span className="status-badge status-badge--ok">{bundle.bundleVersion}</span>
        <span>sourceMedia: {String(bundle.includes.sourceMedia)}</span>
        <span>transcript: {String(bundle.includes.transcript)}</span>
      </div>
      {bundle.artifacts.length > 0 && (
        <div className="diagnostics-artifact-list" aria-label="Diagnostics support attachments">
          {bundle.artifacts.map((artifact, index) => (
            <div className="diagnostics-artifact-row" key={`${artifact.kind}-${artifact.artifactId ?? index}`}>
              <strong>{artifact.kind}</strong>
              <span>{artifact.artifactId ?? artifact.reason ?? 'redacted'}</span>
              <span>{artifact.included ? 'included' : 'redacted'}</span>
            </div>
          ))}
        </div>
      )}
      {download && (
        <div className="diagnostics-download-row">
          <a
            aria-label="Download diagnostics JSON"
            className="secondary-button"
            download={download.fileName}
            href={download.href}
          >
            <FileDown size={18} aria-hidden="true" />
            Download diagnostics JSON
          </a>
          <span>{download.fileName}</span>
          <span>{formatBytes(download.sizeBytes)}</span>
          <span>redaction verified</span>
        </div>
      )}
    </div>
  );
}
