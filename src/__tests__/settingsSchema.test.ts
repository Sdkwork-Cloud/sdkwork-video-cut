import { describe, expect, it } from 'vitest';

import { getSettingsSection, settingsSections } from '../domain/settingsSchema';

describe('settingsSchema', () => {
  it('defines every required settings center section in product order', () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      'overview',
      'ai',
      'speechToText',
      'subtitle',
      'mediaTools',
      'outputPresets',
      'assets',
      'storage',
      'runtime',
      'security',
      'diagnostics',
      'about',
    ]);
  });

  it('marks model credentials as secret and records operational metadata', () => {
    const aiSection = getSettingsSection('ai');
    const sttSection = getSettingsSection('speechToText');

    expect(aiSection.fields).toContainEqual(
      expect.objectContaining({
        key: 'ai.apiKey',
        kind: 'secret',
        secret: true,
        requiresRestart: false,
        affects: 'new-tasks',
      }),
    );
    expect(sttSection.fields).toContainEqual(
      expect.objectContaining({
        key: 'speechToText.apiKey',
        kind: 'secret',
        secret: true,
        requiresRestart: false,
        affects: 'new-tasks',
      }),
    );
  });

  it('ensures every field declares deployment support and impact scope', () => {
    const allFields = settingsSections.flatMap((section) => section.fields);

    expect(allFields.length).toBeGreaterThan(30);
    expect(allFields.every((field) => field.deploymentModes.length > 0)).toBe(true);
    expect(allFields.every((field) => field.affects)).toBe(true);
  });
});
