import { Suspense, lazy, type ComponentType } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@sdkwork/autocut-commons';
import { AppLayout } from '@sdkwork/autocut-core';
import { getAutoCutI18n } from '@sdkwork/autocut-services';

type AutoCutRoute = {
  path: string;
  Component: ComponentType;
};

function lazyPage<TModule, TKey extends keyof TModule & string>(
  importer: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => {
    const module = await importer();
    return { default: module[exportName] as ComponentType };
  });
}

const AUTOCUT_ROUTES: AutoCutRoute[] = [
  {
    path: '/',
    Component: lazyPage(() => import('@sdkwork/autocut-home'), 'HomePage'),
  },
  {
    path: '/tools',
    Component: lazyPage(() => import('@sdkwork/autocut-tools'), 'ToolsPage'),
  },
  {
    path: '/assets',
    Component: lazyPage(() => import('@sdkwork/autocut-assets'), 'AssetsPage'),
  },
  {
    path: '/tasks',
    Component: lazyPage(() => import('@sdkwork/autocut-tasks'), 'TasksPage'),
  },
  {
    path: '/tasks/:taskId',
    Component: lazyPage(() => import('@sdkwork/autocut-tasks'), 'TaskDetailPage'),
  },
  {
    path: '/messages',
    Component: lazyPage(() => import('@sdkwork/autocut-messages'), 'MessagesPage'),
  },
  {
    path: '/slicer',
    Component: lazyPage(() => import('@sdkwork/autocut-slicer'), 'SlicerPage'),
  },
  {
    path: '/extractor-text',
    Component: lazyPage(() => import('@sdkwork/autocut-extractor-text'), 'ExtractorTextPage'),
  },
  {
    path: '/extractor-audio',
    Component: lazyPage(() => import('@sdkwork/autocut-extractor-audio'), 'AudioExtractorPage'),
  },
  {
    path: '/video-gif',
    Component: lazyPage(() => import('@sdkwork/autocut-video-gif'), 'VideoGifPage'),
  },
  {
    path: '/video-compress',
    Component: lazyPage(() => import('@sdkwork/autocut-video-compress'), 'VideoCompressPage'),
  },
  {
    path: '/video-convert',
    Component: lazyPage(() => import('@sdkwork/autocut-video-convert'), 'VideoConvertPage'),
  },
  {
    path: '/video-enhance',
    Component: lazyPage(() => import('@sdkwork/autocut-video-enhance'), 'VideoEnhancePage'),
  },
  {
    path: '/video-dedup',
    Component: lazyPage(() => import('@sdkwork/autocut-video-dedup'), 'VideoDedupPage'),
  },
  {
    path: '/subtitle-translate',
    Component: lazyPage(() => import('@sdkwork/autocut-subtitle-translate'), 'SubtitleTranslatePage'),
  },
  {
    path: '/voice-translate',
    Component: lazyPage(() => import('@sdkwork/autocut-voice-translate'), 'VoiceTranslatePage'),
  },
  {
    path: '/settings',
    Component: lazyPage(() => import('@sdkwork/autocut-settings'), 'SettingsPage'),
  },
];

function RouteLoadingFallback() {
  return (
    <div className="flex h-full min-h-[240px] w-full items-center justify-center bg-[#111] text-gray-400">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
    </div>
  );
}

export default function App() {
  return (
    <I18nextProvider i18n={getAutoCutI18n()}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route element={<AppLayout />}>
                {AUTOCUT_ROUTES.map(({ path, Component }) => (
                  <Route key={path} path={path} element={<Component />} />
                ))}
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </I18nextProvider>
  );
}
