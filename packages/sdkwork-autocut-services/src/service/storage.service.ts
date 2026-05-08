import { reportAutoCutDiagnostic } from './diagnostics.service';
import { getAutoCutRuntimeEnvironment } from './runtime-environment.service';

export const AUTO_CUT_STORAGE_NAMESPACE = 'autocut';

export const AUTO_CUT_STORAGE_KEYS = {
  assets: 'assets',
  tasks: 'tasks',
  dismissedNativeTasks: 'dismissed_native_tasks',
  messages: 'messages',
  settings: 'settings',
  workflowPreferences: 'workflow_preferences',
} as const;

export type AutoCutStorageKey = keyof typeof AUTO_CUT_STORAGE_KEYS;

export function createAutoCutStorageKey(key: AutoCutStorageKey): string {
  return `${AUTO_CUT_STORAGE_NAMESPACE}_${getAutoCutRuntimeEnvironment()}_${AUTO_CUT_STORAGE_KEYS[key]}`;
}

export function readAutoCutStorage<T>(key: AutoCutStorageKey, defaultValue: T): T {
  try {
    const value = localStorage.getItem(createAutoCutStorageKey(key));
    return value ? (JSON.parse(value) as T) : defaultValue;
  } catch (error) {
    reportAutoCutDiagnostic('warning', 'storage', `localStorage get failed for ${key}`, error);
    return defaultValue;
  }
}

export function writeAutoCutStorage<T>(key: AutoCutStorageKey, value: T): void {
  try {
    localStorage.setItem(createAutoCutStorageKey(key), JSON.stringify(value));
  } catch (error) {
    reportAutoCutDiagnostic('warning', 'storage', `localStorage set failed for ${key}`, error);
  }
}

export function removeAutoCutStorage(key: AutoCutStorageKey): void {
  try {
    localStorage.removeItem(createAutoCutStorageKey(key));
  } catch (error) {
    reportAutoCutDiagnostic('warning', 'storage', `localStorage remove failed for ${key}`, error);
  }
}
