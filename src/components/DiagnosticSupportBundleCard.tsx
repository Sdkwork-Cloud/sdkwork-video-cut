import { FileDown, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { DiagnosticSupportBundleRequest, VideoCutTask } from '../domain/videoCutTypes';

export function DiagnosticSupportBundleCard({
  selectedTask,
  onExportSupportBundle,
}: {
  selectedTask?: VideoCutTask;
  onExportSupportBundle: (input: DiagnosticSupportBundleRequest) => Promise<unknown>;
}) {
  const [includeSourceMedia, setIncludeSourceMedia] = useState(false);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const hasSensitiveAttachment = includeSourceMedia || includeTranscript;
  const exportDisabled = !selectedTask || !hasSensitiveAttachment || !consentAccepted;

  return (
    <div className="settings-doctor-report diagnostics-export-card">
      <div className="doctor-summary">
        <span className="status-badge status-badge--warn">support attachments</span>
        <span>{selectedTask?.taskId ?? 'No selected task'}</span>
        {selectedTask?.sourceName && <span>{selectedTask.sourceName}</span>}
      </div>
      <div className="support-bundle-controls" aria-label="Diagnostics support bundle attachments">
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeSourceMedia}
            onChange={(event) => setIncludeSourceMedia(event.target.checked)}
          />
          Include source media attachment
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeTranscript}
            onChange={(event) => setIncludeTranscript(event.target.checked)}
          />
          Include transcript attachment
        </label>
        <label className="check-row check-row--consent">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(event) => setConsentAccepted(event.target.checked)}
          />
          I understand this support bundle may include task media or transcript data
        </label>
      </div>
      <button
        className="secondary-button"
        type="button"
        disabled={exportDisabled}
        onClick={() =>
          selectedTask &&
          void onExportSupportBundle({
            taskId: selectedTask.taskId,
            includeSourceMedia,
            includeTranscript,
            consentAccepted,
          })
        }
      >
        <FileDown size={18} aria-hidden="true" />
        Export support bundle
      </button>
      <div className="diagnostics-consent-evidence">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>explicit consent required</span>
      </div>
    </div>
  );
}
