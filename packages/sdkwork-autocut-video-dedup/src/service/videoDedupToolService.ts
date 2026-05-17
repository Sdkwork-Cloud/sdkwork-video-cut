import {
  analyzeAutoCutVideoDedup,
  createDefaultAutoCutVideoDedupParams,
} from '@sdkwork/autocut-services';
import type { VideoDedupParams } from '@sdkwork/autocut-types';

export function createVideoDedupToolDefaultParams(overrides: Partial<VideoDedupParams> = {}) {
  return createDefaultAutoCutVideoDedupParams(overrides);
}

export async function analyzeVideoDedupTool(params: VideoDedupParams) {
  return analyzeAutoCutVideoDedup(params);
}
