import {
  configureAutoCutNativeHostClient,
  createAutoCutNativeHostClient,
  dispatchAutoCutEvent,
  dispatchAutoCutSpeechTranscriptionModelDownloadProgress,
  AUTOCUT_EVENTS,
  projectNativeTaskProgressEventToTask,
  reportAutoCutDiagnostic,
  type AutoCutLocalMediaFileDescription,
  type AutoCutNativeInvoke,
} from '@sdkwork/autocut-services';
import type {
  AutoCutNativeTaskProgressEvent,
  AutoCutSpeechTranscriptionModelDownloadProgressEvent,
} from '@sdkwork/autocut-types';
import { dispatchAutoCutTrustedFileSourceDrop } from '@sdkwork/autocut-commons';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export function configureDesktopNativeHostClient() {
  if (!isTauri()) {
    return;
  }

  const nativeHostClient = createAutoCutNativeHostClient(invoke as AutoCutNativeInvoke, {
    createAssetUrl: convertFileSrc,
  });
  configureAutoCutNativeHostClient(
    nativeHostClient,
  );
  void nativeHostClient
    .recoverNativeTasks({
      limit: 100,
    })
    .catch(() => undefined);
  registerDesktopTrustedFileSourceDropBridge(nativeHostClient);
  registerDesktopNativeTaskProgressBridge();
  registerDesktopSpeechTranscriptionModelDownloadProgressBridge();
}

function registerDesktopTrustedFileSourceDropBridge(
  nativeHostClient: ReturnType<typeof createAutoCutNativeHostClient>,
) {
  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== 'drop') {
      return;
    }

    void dispatchTrustedDesktopDropFiles(nativeHostClient, event.payload.paths);
  });
}

async function dispatchTrustedDesktopDropFiles(
  nativeHostClient: ReturnType<typeof createAutoCutNativeHostClient>,
  sourcePaths: string[],
) {
  try {
    const descriptions: (AutoCutLocalMediaFileDescription | null)[] = [];
    for (const sourcePath of sourcePaths) {
      descriptions.push(await describeTrustedDesktopDropFile(nativeHostClient, sourcePath));
    }

    const files = descriptions.filter(
      (description): description is NonNullable<(typeof descriptions)[number]> => Boolean(description),
    );
    if (files.length === 0) {
      return;
    }

    dispatchAutoCutTrustedFileSourceDrop({
      files,
    });
  } catch (error) {
    reportAutoCutDiagnostic(
      'warning',
      'desktop.trusted-file-drop',
      'Trusted desktop file drop failed before dispatch.',
      error,
    );
  }
}

async function describeTrustedDesktopDropFile(
  nativeHostClient: ReturnType<typeof createAutoCutNativeHostClient>,
  sourcePath: string,
): Promise<AutoCutLocalMediaFileDescription | null> {
  try {
    await nativeHostClient.allowLocalMediaPreviewDirectory({
      directoryPath: getDesktopPathParentDirectory(sourcePath),
    });
    return await nativeHostClient.describeLocalMediaFile({
      sourcePath,
    });
  } catch (error) {
    reportAutoCutDiagnostic(
      'warning',
      'desktop.trusted-file-drop',
      'Dropped desktop file could not be described and was skipped.',
      error,
    );
    return null;
  }
}

function getDesktopPathParentDirectory(sourcePath: string) {
  const normalizedPath = sourcePath.replace(/\\/gu, '/');
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  if (lastSeparatorIndex < 0) {
    return sourcePath;
  }
  if (lastSeparatorIndex === 0) {
    return sourcePath.slice(0, 1);
  }

  return sourcePath.slice(0, lastSeparatorIndex);
}

function registerDesktopSpeechTranscriptionModelDownloadProgressBridge() {
  void listen<AutoCutSpeechTranscriptionModelDownloadProgressEvent>(
    AUTOCUT_EVENTS.speechTranscriptionModelDownloadProgress,
    (event) => {
      dispatchAutoCutSpeechTranscriptionModelDownloadProgress(event.payload);
    },
  ).catch((error) => {
    reportAutoCutDiagnostic(
      'warning',
      'desktop.speech-model-download-progress',
      'Local speech-to-text model download progress bridge could not be registered.',
      error,
    );
  });
}

function registerDesktopNativeTaskProgressBridge() {
  void listen<AutoCutNativeTaskProgressEvent>(
    AUTOCUT_EVENTS.nativeTaskProgress,
    (event) => {
      const progress = event.payload;
      void projectNativeTaskProgressEventToTask(progress)
        .catch((error) => {
          reportAutoCutDiagnostic(
            'warning',
            'desktop.native-task-progress-projection',
            'Native task progress could not be projected onto the workflow task.',
            error,
          );
        })
        .finally(() => {
          dispatchAutoCutEvent('nativeTaskProgress', progress);
        });
    },
  ).catch((error) => {
    reportAutoCutDiagnostic(
      'warning',
      'desktop.native-task-progress',
      'Native task progress bridge could not be registered.',
      error,
    );
  });
}
