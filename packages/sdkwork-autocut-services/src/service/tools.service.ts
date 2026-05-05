import type { AppTool } from '@sdkwork/autocut-types';
import { randomDelay } from './timing';
import { AUTOCUT_TOOLS } from './tools.registry';

export async function getTools(): Promise<AppTool[]> {
  await randomDelay(50, 100);
  return AUTOCUT_TOOLS;
}
