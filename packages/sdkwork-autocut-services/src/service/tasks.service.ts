import type { AppTask } from '@sdkwork/autocut-types';
import { sortAutoCutRecordsByCreatedAtDesc } from './datetime.service';
import { dispatchAutoCutEvent } from './events.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';
import { INITIAL_TASKS } from './tasks.mock';

export async function getTasks(): Promise<AppTask[]> {
  await randomDelay(20, 50);
  return sortAutoCutRecordsByCreatedAtDesc(readAutoCutStorage<AppTask[]>('tasks', INITIAL_TASKS));
}

export async function addTask(task: AppTask): Promise<void> {
  await randomDelay();
  const tasks = readAutoCutStorage<AppTask[]>('tasks', INITIAL_TASKS);
  writeAutoCutStorage('tasks', [task, ...tasks]);
  dispatchAutoCutEvent('taskAdded', task);
}

export async function updateTask(taskId: string, updates: Partial<AppTask>): Promise<void> {
  const tasks = readAutoCutStorage<AppTask[]>('tasks', INITIAL_TASKS);
  let updatedTask: AppTask | null = null;
  writeAutoCutStorage(
    'tasks',
    tasks.map((task) => {
      if (task.id === taskId) {
        updatedTask = { ...task, ...updates };
        return updatedTask;
      }
      return task;
    }),
  );

  if (updatedTask) {
    dispatchAutoCutEvent('taskUpdated', updatedTask);
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const tasks = readAutoCutStorage<AppTask[]>('tasks', INITIAL_TASKS);
  writeAutoCutStorage(
    'tasks',
    tasks.filter((task) => task.id !== taskId),
  );
  dispatchAutoCutEvent('taskDeleted', { id: taskId });
}
