import { AUTOCUT_TASK_STATUS, type AppTask, type TaskSliceResult } from '@sdkwork/autocut-types';
import { createRelativeAutoCutTimestamp } from './identity.service';
import { getAutoCutLegacySampleVideoUrl, getAutoCutSampleThumbnailUrl } from './media-fixtures.service';

const t4Slices: TaskSliceResult[] = Array.from({ length: 8 }).map((_, index) => ({
  id: `t4-s${index}`,
  name: `公司总结_精彩时刻_${index + 1}.mp4`,
  duration: 15 + index * 5,
  size: (12 + index) * 1024 * 1024,
  resolution: '1080P',
  thumbnailUrl: getAutoCutSampleThumbnailUrl(`t4s${index}`),
  url: getAutoCutLegacySampleVideoUrl(),
}));

export const INITIAL_TASKS: AppTask[] = [
  {
    id: 't4',
    type: '视频切片',
    name: '公司年度总结大会.mp4',
    status: AUTOCUT_TASK_STATUS.completed,
    progress: 100,
    createdAt: createRelativeAutoCutTimestamp(-3600000),
    completedAt: createRelativeAutoCutTimestamp(-3500000),
    resultCount: 8,
    sliceResults: t4Slices,
  },
];
