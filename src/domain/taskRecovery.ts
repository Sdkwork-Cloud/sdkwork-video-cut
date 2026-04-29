import type { TaskRecoveryHint, VideoCutProgressEvent } from './videoCutTypes';

export function latestTaskRecoveryHint(events: VideoCutProgressEvent[], taskId?: string): TaskRecoveryHint | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (taskId && event.taskId !== taskId) {
      continue;
    }

    const hint = event.metadata?.recoveryHint;
    if (hint) {
      return hint;
    }
  }

  return undefined;
}
