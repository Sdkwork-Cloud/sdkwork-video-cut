import { AUTOCUT_TASK_STATUS, type AppTask } from '@sdkwork/autocut-types';
import { createAutoCutTimestamp } from './identity.service';
import { updateTask } from './tasks.service';

export interface ProgressStep {
  progress: number;
  message: string;
  durationMs: number;
}

export async function simulateTaskProgress(
  taskId: string,
  steps: ProgressStep[],
  onComplete: () => Promise<Partial<AppTask>>,
) {
  let accumulatedTime = 0;
  for (const step of steps) {
    accumulatedTime += step.durationMs;
    setTimeout(async () => {
      await updateTask(taskId, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: step.progress,
        progressMessage: step.message,
      });
    }, accumulatedTime);
  }

  setTimeout(async () => {
    try {
      const completedData = await onComplete();
      await updateTask(taskId, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: '任务完成',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      await updateTask(taskId, {
        status: AUTOCUT_TASK_STATUS.failed,
        progressMessage: '任务失败',
        errorMessage: String(error),
      });
    }
  }, accumulatedTime + 1000);
}
