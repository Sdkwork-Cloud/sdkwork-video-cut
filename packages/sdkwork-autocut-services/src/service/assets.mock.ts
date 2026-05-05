import type { AppAsset } from '@sdkwork/autocut-types';
import { getAutoCutSampleAudioUrl, getAutoCutSampleThumbnailUrl, getAutoCutSampleVideoUrl } from './media-fixtures.service';

export const INITIAL_ASSETS: AppAsset[] = [
  {
    id: 'a1',
    name: '2023_产品发布会.mp4',
    type: 'video',
    size: 1200 * 1024 * 1024,
    createdAt: '2023-11-20 14:00',
    updatedAt: '2023-11-20 14:00',
    thumbnailUrl: getAutoCutSampleThumbnailUrl('a1'),
    url: getAutoCutSampleVideoUrl(),
  },
  {
    id: 'a2',
    name: '访谈录音_第二期.wav',
    type: 'audio',
    size: 450 * 1024 * 1024,
    createdAt: '2023-11-18 09:30',
    updatedAt: '2023-11-18 09:30',
    url: getAutoCutSampleAudioUrl(),
  },
  {
    id: 'a3',
    name: '宣传片_文案提取.txt',
    type: 'doc',
    size: 12 * 1024,
    createdAt: '2023-11-15 16:45',
    updatedAt: '2023-11-15 16:45',
    url: 'data:text/plain;charset=utf-8,SDKWork%20AutoCut%20sample%20text%20asset',
  },
  {
    id: 'a4',
    name: '双十一特惠商品讲解.mp4',
    type: 'video',
    size: 890 * 1024 * 1024,
    createdAt: '2023-11-10 20:10',
    updatedAt: '2023-11-10 20:10',
    thumbnailUrl: getAutoCutSampleThumbnailUrl('a4'),
    url: getAutoCutSampleVideoUrl(),
  },
  {
    id: 'a8',
    name: '李佳琦直播精华片段.mp4',
    type: 'video',
    size: 3100 * 1024 * 1024,
    createdAt: '2023-10-24 22:00',
    updatedAt: '2023-10-24 22:00',
    thumbnailUrl: getAutoCutSampleThumbnailUrl('a8'),
    url: getAutoCutSampleVideoUrl(),
  },
];
