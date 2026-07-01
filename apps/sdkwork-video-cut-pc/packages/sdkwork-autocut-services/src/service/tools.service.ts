import type { AppTool } from '@sdkwork/autocut-types';
import { randomDelay } from './timing';
import { getAutoCutI18nText } from './i18n.service';
import { AUTOCUT_TOOL_DEFINITIONS } from './tools.registry';

export async function getTools(): Promise<AppTool[]> {
  await randomDelay(50, 100);
  return AUTOCUT_TOOL_DEFINITIONS.map((tool) => ({
    id: tool.id,
    name: getAutoCutI18nText(tool.nameKey, undefined, tool.defaultName),
    nameKey: tool.nameKey,
    icon: tool.icon,
    category: tool.category,
    description: getAutoCutI18nText(tool.descriptionKey, undefined, tool.defaultDescription),
    descriptionKey: tool.descriptionKey,
    ...(tool.route ? { route: tool.route } : {}),
  }));
}
