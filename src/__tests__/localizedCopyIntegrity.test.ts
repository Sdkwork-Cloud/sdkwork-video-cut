import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const localizedCopyFiles = [
  'src/components/AppShell.tsx',
  'src/components/pages/HomePage.tsx',
  'src/components/pages/WorkbenchPage.tsx',
  'src/components/pages/QueuePage.tsx',
  'src/components/pages/DiagnosticsPage.tsx',
  'src/components/pages/ResultsPage.tsx',
  'src/components/settings/SettingsCenter.tsx',
  'src/components/settings/SettingsPanels.tsx',
  'src/__tests__/appShell.test.tsx',
  'src/__tests__/settingsCenter.test.tsx',
];

const mojibakeMarkers = [
  '宸ヤ綔',
  '璁剧疆',
  '缁撴灉',
  '鐠佸墽',
  '瑙嗛',
  '瀵煎',
  '浠诲',
  '闃熷',
  '鐘舵',
  '鎵归',
  '鏋佸畫',
  '鍓',
];

describe('localized copy integrity', () => {
  it('does not keep mojibake fallbacks in product UI or UI tests', () => {
    const offenders = localizedCopyFiles.flatMap((filePath) => {
      const content = readFileSync(resolve(process.cwd(), filePath), 'utf8');

      return mojibakeMarkers
        .filter((marker) => content.includes(marker))
        .map((marker) => `${filePath}: ${marker}`);
    });

    expect(offenders).toEqual([]);
  });
});
