import { reportAutoCutDiagnostic } from './diagnostics.service';
import { getAutoCutRuntimeEnvironment } from './runtime-environment.service';

export const AUTO_CUT_STORAGE_NAMESPACE = 'autocut';

export const AUTO_CUT_STORAGE_KEYS = {
  assets: 'assets',
  tasks: 'tasks',
  dismissedNativeTasks: 'dismissed_native_tasks',
  messages: 'messages',
  settings: 'settings',
  videoDedupFingerprints: 'video_dedup_fingerprints',
  videoDedupVisualEvidence: 'video_dedup_visual_evidence',
  workflowPreferences: 'workflow_preferences',
} as const;

export type AutoCutStorageKey = keyof typeof AUTO_CUT_STORAGE_KEYS;

export function createAutoCutStorageKey(key: AutoCutStorageKey): string {
  return `${AUTO_CUT_STORAGE_NAMESPACE}_${getAutoCutRuntimeEnvironment()}_${AUTO_CUT_STORAGE_KEYS[key]}`;
}

export function readAutoCutStorage<T>(key: AutoCutStorageKey, defaultValue: T): T {
  try {
    const value = localStorage.getItem(createAutoCutStorageKey(key));
    if (!value) return defaultValue;
    const parsed = JSON.parse(value);
    if (typeof parsed === 'undefined' || parsed === null) return defaultValue;
    return parsed as T;
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
    throw error;
  }
}

export function removeAutoCutStorage(key: AutoCutStorageKey): void {
  try {
    localStorage.removeItem(createAutoCutStorageKey(key));
  } catch (error) {
    reportAutoCutDiagnostic('warning', 'storage', `localStorage remove failed for ${key}`, error);
  }
}
