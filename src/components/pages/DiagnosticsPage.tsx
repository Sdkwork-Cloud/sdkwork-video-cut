import { AlertTriangle, CheckCircle2, FileDown, RefreshCw } from 'lucide-react';

import { DiagnosticBundleDownloadCard } from '../DiagnosticBundleDownloadCard';
import { DiagnosticSupportBundleCard } from '../DiagnosticSupportBundleCard';
import type { DiagnosticBundleDownloadDescriptor } from '../../domain/diagnosticBundleExport';
import type {
  CapabilityReport,
  DeploymentDoctorCheck,
  DeploymentDoctorReport,
  DiagnosticBundle,
  DiagnosticSupportBundleRequest,
  VideoCutTask,
} from '../../domain/videoCutTypes';

export function DiagnosticsPage({
  capability,
  diagnosticBundle,
  diagnosticBundleDownload,
  doctorReport,
  onExportDiagnosticBundle,
  onExportDiagnosticSupportBundle,
  onRunDoctor,
  selectedTask,
}: {
  capability?: CapabilityReport;
  diagnosticBundle?: DiagnosticBundle;
  diagnosticBundleDownload?: DiagnosticBundleDownloadDescriptor;
  doctorReport?: DeploymentDoctorReport;
  onExportDiagnosticBundle: () => Promise<DiagnosticBundle | undefined>;
  onExportDiagnosticSupportBundle: (input: DiagnosticSupportBundleRequest) => Promise<DiagnosticBundle | undefined>;
  onRunDoctor: () => Promise<DeploymentDoctorReport | undefined>;
  selectedTask?: VideoCutTask;
}) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Diagnostics</span>
          <h2>诊断中心</h2>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" type="button" onClick={() => void onRunDoctor()}>
            <RefreshCw size={16} aria-hidden="true" />
            Run doctor
          </button>
          <button className="secondary-button" type="button" onClick={() => void onExportDiagnosticBundle()}>
            <FileDown size={16} aria-hidden="true" />
            Export diagnostics
          </button>
        </div>
      </div>
      <div className="diagnostic-grid">
        <h3>Capability Report</h3>
        {capability &&
          Object.entries({
            AI: capability.ai,
            STT: capability.speechToText,
            Media: capability.media,
            Storage: capability.storage,
            Security: capability.security,
          }).map(([name, item]) => (
            <article className="diagnostic-row" key={name}>
              <CheckCircle2 size={18} aria-hidden="true" />
              <strong>{name}</strong>
              <span>{item.label}</span>
              {item.actionHint && <small>{item.actionHint}</small>}
            </article>
          ))}
      </div>
      <div className="diagnostic-grid">
        <h3>Deployment Doctor</h3>
        {doctorReport && (
          <div className="doctor-summary">
            <span className={`status-badge status-badge--${doctorReport.health === 'ok' ? 'ok' : 'warn'}`}>
              {doctorReport.health}
            </span>
            <span>{doctorReport.deploymentMode}</span>
            <span>{doctorReport.generatedAt}</span>
          </div>
        )}
        {doctorReport?.checks.map((check) => (
          <DoctorCheckRow check={check} key={check.checkId} />
        ))}
      </div>
      <div className="diagnostic-grid">
        <h3>Diagnostics Bundle</h3>
        <p className="muted">Exports the host-generated redacted support bundle through the standard diagnostics contract.</p>
        <DiagnosticSupportBundleCard
          selectedTask={selectedTask}
          onExportSupportBundle={onExportDiagnosticSupportBundle}
        />
        <DiagnosticBundleDownloadCard bundle={diagnosticBundle} download={diagnosticBundleDownload} />
      </div>
    </section>
  );
}

function DoctorCheckRow({ check }: { check: DeploymentDoctorCheck }) {
  const Icon = check.status === 'ok' ? CheckCircle2 : AlertTriangle;

  return (
    <article className="diagnostic-row diagnostic-row--doctor">
      <Icon size={18} aria-hidden="true" />
      <strong>{check.checkId}</strong>
      <span>{check.label}</span>
      {check.actionHint && <small>{check.actionHint}</small>}
    </article>
  );
}
