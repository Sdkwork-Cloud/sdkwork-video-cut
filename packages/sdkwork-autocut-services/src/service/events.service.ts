import type { AppAsset, AppMessage, AppSettings, AppTask } from '@sdkwork/autocut-types';

export const AUTOCUT_EVENTS = {
  taskAdded: 'autocut-task-added',
  taskUpdated: 'autocut-task-updated',
  taskDeleted: 'autocut-task-deleted',
  assetAdded: 'autocut-asset-added',
  assetDeleted: 'autocut-asset-deleted',
  messageAdded: 'autocut-message-added',
  messagesUpdated: 'autocut-messages-updated',
  settingsUpdated: 'autocut-settings-updated',
} as const;

export type AutoCutEventName = keyof typeof AUTOCUT_EVENTS;

export interface AutoCutEventPayloadMap {
  taskAdded: AppTask;
  taskUpdated: AppTask;
  taskDeleted: { id: string };
  assetAdded: AppAsset;
  assetDeleted: { id: string };
  messageAdded: AppMessage;
  messagesUpdated: undefined;
  settingsUpdated: AppSettings;
}

type AutoCutEventHandler<TName extends AutoCutEventName> = (
  detail: AutoCutEventPayloadMap[TName],
  event: CustomEvent<AutoCutEventPayloadMap[TName]>,
) => void;

export function dispatchAutoCutEvent<TName extends AutoCutEventName>(
  name: TName,
  detail: AutoCutEventPayloadMap[TName],
) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTOCUT_EVENTS[name], { detail }));
}

export function listenAutoCutEvent<TName extends AutoCutEventName>(
  name: TName,
  handler: AutoCutEventHandler<TName>,
) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<AutoCutEventPayloadMap[TName]>;
    handler(customEvent.detail, customEvent);
  };

  window.addEventListener(AUTOCUT_EVENTS[name], listener);
  return () => window.removeEventListener(AUTOCUT_EVENTS[name], listener);
}
