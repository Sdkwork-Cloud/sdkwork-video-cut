import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {configureDesktopNativeHostClient} from './native-host';
import {
  configureAutoCutRuntimeEnvironment,
  configureAutoCutVercelAiSdkBridge,
  initializeAutoCutDefaultLlmSettingsFromEnvironment,
  initializeAutoCutI18n,
} from '@sdkwork/autocut-services';

configureAutoCutRuntimeEnvironment(import.meta.env.DEV ? 'dev' : 'release');
configureDesktopNativeHostClient();
configureAutoCutVercelAiSdkBridge();
initializeAutoCutI18n();
void initializeAutoCutDefaultLlmSettingsFromEnvironment().catch(() => undefined);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('AutoCut desktop root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
