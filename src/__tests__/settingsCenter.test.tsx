import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import App from '../App';
import type { VideoCutSettingsSavePayload } from '../domain/videoCutTypes';
import { createMockHostClient } from '../services/mockHostClient';

const settingsNavButton = '设置';

function renderApp() {
  return render(<App client={createMockHostClient()} />);
}

describe('Settings center', () => {
  it('exposes the required configuration groups and fields', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: settingsNavButton }));

    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com');
    expect(screen.getByLabelText('Chat model')).toHaveValue('gpt-4.1-mini');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.getByLabelText('API key status')).toHaveValue('Not configured');

    await user.click(screen.getByRole('button', { name: 'Speech To Text' }));
    expect(screen.getByLabelText('Provider profile')).toHaveValue('openai-audio-transcriptions');
    expect(screen.getByLabelText('Transcription model')).toHaveValue('gpt-4o-mini-transcribe');
    expect(screen.getByLabelText('Resource ID')).toHaveValue('volc.bigasr.auc');
    expect(screen.getByLabelText('Language')).toHaveValue('zh');
    await user.selectOptions(screen.getByLabelText('Provider profile'), 'volcengine-bigasr-flash');
    expect(screen.getByLabelText('Provider profile')).toHaveValue('volcengine-bigasr-flash');

    await user.click(screen.getByRole('button', { name: 'Subtitle And Caption' }));
    expect(screen.getByLabelText('Font')).toHaveValue('极宋');
    expect(screen.getByLabelText('Highlight')).toHaveValue('#ffd84d');

    await user.click(screen.getByRole('button', { name: 'Media Tools' }));
    expect(screen.getByLabelText('FFmpeg path')).toHaveValue('ffmpeg');
    expect(screen.getByLabelText('ffprobe path')).toHaveValue('ffprobe');
    expect(screen.getByLabelText('Worker concurrency')).toHaveValue(2);

    await user.click(screen.getByRole('button', { name: 'Output Presets' }));
    expect(screen.getByLabelText('Resolution')).toHaveValue('1080x1920');
    expect(screen.getByLabelText('BGM volume')).toHaveValue('20%');

    await user.click(screen.getByRole('button', { name: 'Assets' }));
    expect(screen.getByLabelText('BGM assets')).toHaveValue('assets/bgm');
    expect(screen.getByLabelText('SFX assets')).toHaveValue('assets/sfx');
    expect(await screen.findByText('Asset pack catalog')).toBeInTheDocument();
    expect(screen.getByText('video-cut.asset-catalog.schema.v1')).toBeInTheDocument();
    expect(screen.getByText('bgm')).toBeInTheDocument();
    expect(screen.getAllByText('not-configured').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Storage' }));
    expect(screen.getByLabelText('Workspace root')).toHaveValue('./workspace');
    expect(screen.getByLabelText('Artifact root')).toHaveValue('./workspace/artifacts');

    await user.click(screen.getByRole('button', { name: 'Runtime' }));
    expect(screen.getByLabelText('Bind host')).toHaveValue('127.0.0.1');
    expect(screen.getByLabelText('Auth mode')).toHaveValue('none');

    await user.click(screen.getByRole('button', { name: 'Security' }));
    expect(screen.getByLabelText('Secret provider')).toHaveValue('local-secure-store');
    expect(screen.getByLabelText('CORS origins')).toHaveValue('http://127.0.0.1:5173, http://localhost:5173');
    expect(screen.getByLabelText('Redaction')).toHaveValue('Enabled');

    await user.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(screen.getByRole('button', { name: /Run doctor/ })).toBeInTheDocument();
  });

  it('runs doctor from the settings diagnostics panel and shows the latest checks', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: settingsNavButton }));
    await user.click(screen.getByRole('button', { name: 'Diagnostics' }));
    await user.click(screen.getByRole('button', { name: /Run doctor/ }));

    expect(await screen.findByText('video-cut.doctor.v1')).toBeInTheDocument();
    expect(screen.getByText('Host health')).toBeInTheDocument();
    expect(screen.getByText('Workspace writable')).toBeInTheDocument();
    expect(screen.getByText('OpenAI-compatible provider policy active')).toBeInTheDocument();
  });

  it('derives artifact and temp roots from the workspace root instead of exposing inert storage fields', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const inconsistentSettings = await baseClient.getSettings();
    inconsistentSettings.storage = {
      ...inconsistentSettings.storage,
      workspaceRoot: 'D:/actual-workspace',
      artifactRoot: 'Z:/stale-artifacts',
      tempRoot: 'Z:/stale-tmp',
    };
    const client = {
      ...baseClient,
      async getSettings() {
        return inconsistentSettings;
      },
    };
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: settingsNavButton }));
    await user.click(screen.getByRole('button', { name: 'Storage' }));

    expect(screen.getByLabelText('Artifact root')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Temp root')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Artifact root')).toHaveValue('D:/actual-workspace/artifacts');
    expect(screen.getByLabelText('Temp root')).toHaveValue('D:/actual-workspace/tmp');
    await user.clear(screen.getByLabelText('Workspace root'));
    expect(screen.getByLabelText('Artifact root')).toHaveValue('');
    expect(screen.getByLabelText('Temp root')).toHaveValue('');

    await user.type(screen.getByLabelText('Workspace root'), '/');
    expect(screen.getByLabelText('Artifact root')).toHaveValue('/artifacts');
    expect(screen.getByLabelText('Temp root')).toHaveValue('/tmp');

    await user.clear(screen.getByLabelText('Workspace root'));
    await user.type(screen.getByLabelText('Workspace root'), 'D:/video-cut-workspace');

    expect(screen.getByLabelText('Artifact root')).toHaveValue('D:/video-cut-workspace/artifacts');
    expect(screen.getByLabelText('Temp root')).toHaveValue('D:/video-cut-workspace/tmp');
  });

  it('runs provider conformance from the AI provider panel', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: settingsNavButton }));
    await user.click(screen.getByRole('button', { name: /Test structured output/ }));

    expect(await screen.findByText('video-cut.provider-conformance.v1')).toBeInTheDocument();
    expect(screen.getByText('LLM structured output request contract')).toBeInTheDocument();
  });

  it('exports a redacted diagnostics bundle from the settings diagnostics panel', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: settingsNavButton }));
    await user.click(screen.getByRole('button', { name: 'Diagnostics' }));
    await user.click(screen.getByRole('button', { name: /Export diagnostics/ }));

    expect(await screen.findByText('video-cut.diagnostics-bundle.v1')).toBeInTheDocument();
    expect(screen.getByText('sourceMedia: false')).toBeInTheDocument();
    expect(screen.getByText('transcript: false')).toBeInTheDocument();
    const downloadLink = screen.getByRole('link', { name: 'Download diagnostics JSON' });
    expect(downloadLink.getAttribute('download')).toMatch(/^sdkwork-video-cut-diagnostics-desktop-local-.*\.json$/);
    expect(downloadLink.getAttribute('href')).toMatch(/^data:application\/vnd\.sdkwork\.video-cut\.diagnostics\+json;charset=utf-8,/);
    expect(screen.getByText(/redaction verified/i)).toBeInTheDocument();
  });

  it('validates and saves AI provider settings', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: settingsNavButton }));
    await user.click(screen.getByLabelText('Enable AI provider'));
    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'bad-url');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('OpenAI-compatible base URL must be a valid HTTP(S) URL.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
    await user.type(screen.getByLabelText('API key'), 'sk-test');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(await screen.findByText('LLM ready')).toBeInTheDocument();
  });

  it('sends entered provider secrets as write-only settings fields and clears them after save', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const updateSettings = vi.fn(async (settings: VideoCutSettingsSavePayload) => baseClient.updateSettings(settings));
    const client = {
      ...baseClient,
      updateSettings,
    };
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: settingsNavButton }));
    await user.click(screen.getByLabelText('Enable AI provider'));
    await user.type(screen.getByLabelText('API key'), 'sk-ui-ai-secret');
    await user.click(screen.getByRole('button', { name: 'Speech To Text' }));
    await user.click(screen.getByLabelText('Enable STT provider'));
    await user.type(screen.getByLabelText('API key'), 'sk-ui-stt-secret');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          apiKey: 'sk-ui-ai-secret',
          apiKeyConfigured: true,
        }),
        speechToText: expect.objectContaining({
          apiKey: 'sk-ui-stt-secret',
          apiKeyConfigured: true,
        }),
      }),
    );
    expect(JSON.stringify(await baseClient.getSettings())).not.toContain('sk-ui-ai-secret');
    expect(JSON.stringify(await baseClient.getSettings())).not.toContain('sk-ui-stt-secret');
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });
});
