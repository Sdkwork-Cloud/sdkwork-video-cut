import {
  configureAutoCutNativeHostClient,
  createAutoCutNativeHostClient,
  type AutoCutNativeInvoke,
} from '@sdkwork/autocut-services';
import { dispatchAutoCutTrustedFileSourceDrop } from '@sdkwork/autocut-commons';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: AutoCutNativeInvoke;
      };
    };
  }
}

export function configureDesktopNativeHostClient() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') {
    return;
  }

  const nativeHostClient = createAutoCutNativeHostClient(invoke, {
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
}

function registerDesktopTrustedFileSourceDropBridge(
  nativeHostClient: ReturnType<typeof createAutoCutNativeHostClient>,
) {
  void getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type !== 'drop') {
      return;
    }

    const descriptions = await Promise.all(
      event.payload.paths.map((sourcePath) =>
        nativeHostClient.describeLocalMediaFile({
          sourcePath,
        }),
      ),
    );
    dispatchAutoCutTrustedFileSourceDrop({
      files: descriptions,
    });
  });
}
