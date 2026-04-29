import type {
  TranscriptDocument,
  VideoSplitPlan,
} from '../domain/mediaContracts';
import type {
  ArtifactDownloadDescriptor,
  AssetCatalog,
  AttachTaskSourceInput,
  CapabilityReport,
  CreateTaskInput,
  DeleteTaskResult,
  DeploymentDoctorReport,
  DiagnosticBundle,
  DiagnosticSupportBundleRequest,
  ManualTranscriptInput,
  ProviderConformanceReport,
  ProviderConformanceTarget,
  SubtitleExportOutput,
  SubtitleFormat,
  SubtitleImportInput,
  ValidationResult,
  VideoCutArtifact,
  VideoCutProgressEvent,
  VideoCutSettingsSavePayload,
  VideoCutSettings,
  VideoCutTask,
} from '../domain/videoCutTypes';

export interface VideoCutHostClient {
  getHealth(): Promise<{ status: 'ok' }>;
  getCapabilities(): Promise<CapabilityReport>;
  getDoctorReport(): Promise<DeploymentDoctorReport>;
  getDiagnosticBundle(): Promise<DiagnosticBundle>;
  getDiagnosticSupportBundle(input: DiagnosticSupportBundleRequest): Promise<DiagnosticBundle>;
  getAssetCatalog(): Promise<AssetCatalog>;
  runProviderConformance(target: ProviderConformanceTarget): Promise<ProviderConformanceReport>;
  getSettings(): Promise<VideoCutSettings>;
  updateSettings(settings: VideoCutSettingsSavePayload): Promise<ValidationResult>;
  listTasks(): Promise<VideoCutTask[]>;
  createTask(input: CreateTaskInput): Promise<VideoCutTask>;
  getTask(taskId: string): Promise<VideoCutTask>;
  deleteTask(taskId: string): Promise<DeleteTaskResult>;
  attachTaskSource(taskId: string, input: AttachTaskSourceInput): Promise<VideoCutArtifact>;
  uploadTaskSourceFile(taskId: string, file: File): Promise<VideoCutArtifact>;
  analyzeTask(taskId: string): Promise<VideoCutTask>;
  getTaskPlan(taskId: string): Promise<VideoSplitPlan>;
  updateTaskPlan(taskId: string, plan: VideoSplitPlan): Promise<VideoSplitPlan>;
  updateTaskTranscript(taskId: string, input: ManualTranscriptInput): Promise<TranscriptDocument>;
  importTaskSubtitles(taskId: string, input: SubtitleImportInput): Promise<TranscriptDocument>;
  exportTaskSubtitles(taskId: string, format: SubtitleFormat): Promise<SubtitleExportOutput>;
  renderTask(taskId: string): Promise<VideoCutTask>;
  renderTaskBatch(taskId: string): Promise<VideoCutTask>;
  cancelTask(taskId: string): Promise<VideoCutTask>;
  getTaskEvents(taskId: string): Promise<VideoCutProgressEvent[]>;
  getTaskArtifacts(taskId: string): Promise<VideoCutArtifact[]>;
  getArtifactDownload(taskId: string, artifactId: string): Promise<ArtifactDownloadDescriptor>;
  getArtifactContent(taskId: string, artifactId: string): Promise<Blob>;
  getArtifactText(taskId: string, artifactId: string): Promise<string>;
}
