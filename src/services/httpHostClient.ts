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
  VideoCutSettings,
  VideoCutSettingsSavePayload,
  VideoCutTask,
} from '../domain/videoCutTypes';
import { VideoCutHostApiError } from '../domain/hostApiErrors';
import type { VideoCutHostClient } from '../ports/videoCutHostClient';

export { VideoCutHostApiError } from '../domain/hostApiErrors';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CreateHttpHostClientOptions {
  authToken?: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}

interface HostErrorBody {
  code?: string;
  message?: string;
  traceId?: string;
}

interface VideoCutApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: HostErrorBody;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function taskPath(taskId: string, suffix: string): string {
  return `/tasks/${encodeURIComponent(taskId)}${suffix}`;
}

function artifactPath(taskId: string, artifactId: string, suffix: string): string {
  return `${taskPath(taskId, '/artifacts')}/${encodeURIComponent(artifactId)}${suffix}`;
}

function authHeaders(authToken: string | undefined): Record<string, string> {
  const token = authToken?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  return parseJsonTextSafely(text);
}

function parseJsonTextSafely(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toHostApiError({
  body,
  endpoint,
  response,
}: {
  body?: VideoCutApiEnvelope<unknown>;
  endpoint: string;
  response: Response;
}): VideoCutHostApiError {
  const envelopeError = body?.error;
  return new VideoCutHostApiError({
    status: response.status,
    code: envelopeError?.code ?? `HTTP_${response.status}`,
    message: envelopeError?.message ?? `Video cut host request failed with HTTP ${response.status}.`,
    traceId: envelopeError?.traceId,
    endpoint,
  });
}

function isErrorEnvelope(body: unknown): body is VideoCutApiEnvelope<unknown> {
  return Boolean(body && typeof body === 'object' && (body as VideoCutApiEnvelope<unknown>).ok === false);
}

function isSuccessEnvelope<T>(body: unknown): body is VideoCutApiEnvelope<T> & { data: T; ok: true } {
  return Boolean(body && typeof body === 'object' && (body as VideoCutApiEnvelope<T>).ok === true && 'data' in body);
}

function invalidSuccessEnvelopeError(response: Response, endpoint: string): VideoCutHostApiError {
  return new VideoCutHostApiError({
    status: response.status,
    code: 'RESPONSE_ENVELOPE_INVALID',
    message: 'Video cut host response must use the standard success envelope.',
    endpoint,
  });
}

export function createHttpHostClient({
  authToken,
  baseUrl,
  fetchImpl = fetch,
}: CreateHttpHostClientOptions): VideoCutHostClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const authorizationHeaders = authHeaders(authToken);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const endpoint = `${normalizedBaseUrl}${path}`;
    const hasBody = init.body !== undefined;
    const isFormDataBody = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const response = await fetchImpl(endpoint, {
      ...init,
      headers: {
        accept: 'application/json',
        ...authorizationHeaders,
        ...(hasBody && !isFormDataBody ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      method: init.method ?? 'GET',
    });
    const body = (await parseJsonSafely(response)) as VideoCutApiEnvelope<T> | undefined;

    if (!response.ok || body?.ok === false) {
      throw toHostApiError({ body, endpoint, response });
    }

    if (!isSuccessEnvelope<T>(body)) {
      throw invalidSuccessEnvelopeError(response, endpoint);
    }

    return body.data;
  }

  async function requestText(path: string): Promise<string> {
    const endpoint = `${normalizedBaseUrl}${path}`;
    const response = await fetchImpl(endpoint, {
      headers: {
        accept: 'text/plain, application/json;q=0.9, */*;q=0.8',
        ...authorizationHeaders,
      },
      method: 'GET',
    });
    const text = await response.text();
    const body = parseJsonTextSafely(text) as VideoCutApiEnvelope<unknown> | undefined;

    if (!response.ok || isErrorEnvelope(body)) {
      throw toHostApiError({ body, endpoint, response });
    }

    return text;
  }

  async function requestBlob(path: string): Promise<Blob> {
    const endpoint = `${normalizedBaseUrl}${path}`;
    const response = await fetchImpl(endpoint, {
      headers: {
        accept: '*/*',
        ...authorizationHeaders,
      },
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      const body = parseJsonTextSafely(text) as VideoCutApiEnvelope<unknown> | undefined;
      throw toHostApiError({ body, endpoint, response });
    }

    if (response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      const bytes = await response.arrayBuffer();
      const text = new TextDecoder().decode(bytes);
      const body = parseJsonTextSafely(text) as VideoCutApiEnvelope<unknown> | undefined;
      if (isErrorEnvelope(body)) {
        throw toHostApiError({ body, endpoint, response });
      }
      return new Blob([bytes], {
        type: response.headers.get('content-type') ?? '',
      });
    }

    return new Blob([await response.arrayBuffer()], {
      type: response.headers.get('content-type') ?? '',
    });
  }

  return {
    getHealth() {
      return request('/health');
    },

    getCapabilities() {
      return request<CapabilityReport>('/capabilities');
    },

    getDoctorReport() {
      return request<DeploymentDoctorReport>('/doctor');
    },

    getDiagnosticBundle() {
      return request<DiagnosticBundle>('/diagnostics/bundle');
    },

    getDiagnosticSupportBundle(input: DiagnosticSupportBundleRequest) {
      return request<DiagnosticBundle>('/diagnostics/support-bundle', {
        body: JSON.stringify(input),
        method: 'POST',
      });
    },

    getAssetCatalog() {
      return request<AssetCatalog>('/assets/catalog');
    },

    runProviderConformance(target: ProviderConformanceTarget) {
      return request<ProviderConformanceReport>('/providers/openai-compatible/conformance', {
        body: JSON.stringify({ target }),
        method: 'POST',
      });
    },

    getSettings() {
      return request<VideoCutSettings>('/settings');
    },

    updateSettings(settings: VideoCutSettingsSavePayload) {
      return request<ValidationResult>('/settings', {
        body: JSON.stringify(settings),
        method: 'PUT',
      });
    },

    listTasks() {
      return request<VideoCutTask[]>('/tasks');
    },

    createTask(input: CreateTaskInput) {
      return request<VideoCutTask>('/tasks', {
        body: JSON.stringify(input),
        method: 'POST',
      });
    },

    getTask(taskId: string) {
      return request<VideoCutTask>(taskPath(taskId, ''));
    },

    deleteTask(taskId: string) {
      return request<DeleteTaskResult>(taskPath(taskId, ''), {
        method: 'DELETE',
      });
    },

    attachTaskSource(taskId: string, input: AttachTaskSourceInput) {
      return request<VideoCutArtifact>(taskPath(taskId, '/source'), {
        body: JSON.stringify(input),
        method: 'POST',
      });
    },

    uploadTaskSourceFile(taskId: string, file: File) {
      const body = new FormData();
      body.append('file', file, file.name);
      return request<VideoCutArtifact>(taskPath(taskId, '/source/file'), {
        body,
        method: 'POST',
      });
    },

    analyzeTask(taskId: string) {
      return request<VideoCutTask>(taskPath(taskId, '/analyze'), {
        method: 'POST',
      });
    },

    getTaskPlan(taskId: string) {
      return request<VideoSplitPlan>(taskPath(taskId, '/plan'));
    },

    updateTaskPlan(taskId: string, plan: VideoSplitPlan) {
      return request<VideoSplitPlan>(taskPath(taskId, '/plan'), {
        body: JSON.stringify(plan),
        method: 'PUT',
      });
    },

    updateTaskTranscript(taskId: string, input: ManualTranscriptInput) {
      return request<TranscriptDocument>(taskPath(taskId, '/transcript'), {
        body: JSON.stringify(input),
        method: 'PUT',
      });
    },

    importTaskSubtitles(taskId: string, input: SubtitleImportInput) {
      return request<TranscriptDocument>(taskPath(taskId, '/subtitles/import'), {
        body: JSON.stringify(input),
        method: 'PUT',
      });
    },

    exportTaskSubtitles(taskId: string, format: SubtitleFormat) {
      return request<SubtitleExportOutput>(`${taskPath(taskId, '/subtitles/export')}?format=${encodeURIComponent(format)}`);
    },

    renderTask(taskId: string) {
      return request<VideoCutTask>(taskPath(taskId, '/render'), {
        method: 'POST',
      });
    },

    renderTaskBatch(taskId: string) {
      return request<VideoCutTask>(taskPath(taskId, '/render/batch'), {
        method: 'POST',
      });
    },

    cancelTask(taskId: string) {
      return request<VideoCutTask>(taskPath(taskId, '/cancel'), {
        method: 'POST',
      });
    },

    getTaskEvents(taskId: string) {
      return request<VideoCutProgressEvent[]>(taskPath(taskId, '/events'));
    },

    getTaskArtifacts(taskId: string) {
      return request<VideoCutArtifact[]>(taskPath(taskId, '/artifacts'));
    },

    getArtifactDownload(taskId: string, artifactId: string) {
      return request<ArtifactDownloadDescriptor>(artifactPath(taskId, artifactId, '/download'));
    },

    getArtifactContent(taskId: string, artifactId: string) {
      return requestBlob(artifactPath(taskId, artifactId, '/content'));
    },

    getArtifactText(taskId: string, artifactId: string) {
      return requestText(artifactPath(taskId, artifactId, '/content'));
    },
  };
}
