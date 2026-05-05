import type { AppMessage } from '@sdkwork/autocut-types';
import { createAutoCutTimestamp, createRelativeAutoCutTimestamp } from './identity.service';

export const INITIAL_MESSAGES: AppMessage[] = [
  {
    id: 'm1',
    type: 'success',
    title: '系统初始化成功',
    description: '欢迎使用 SDKWORK AutoCut 智能引擎系统。',
    createdAt: createAutoCutTimestamp(),
    read: false,
  },
  {
    id: 'm4',
    type: 'info',
    title: '系统更新公告',
    description: '自动切片引擎将于本周六凌晨 2:00 进行例行维护，届时将暂停服务约 1 小时。',
    createdAt: createRelativeAutoCutTimestamp(-86400000),
    read: true,
  },
];
