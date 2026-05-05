import type { AppTool } from '@sdkwork/autocut-types';
import { randomDelay } from './timing';
import { INITIAL_TOOLS } from './tools.mock';

export async function getTools(): Promise<AppTool[]> {
  await randomDelay(50, 100);
  return INITIAL_TOOLS;
}
