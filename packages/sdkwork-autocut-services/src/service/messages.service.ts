import type { AppMessage } from '@sdkwork/autocut-types';
import { sortAutoCutRecordsByCreatedAtDesc } from './datetime.service';
import { dispatchAutoCutEvent } from './events.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';

const EMPTY_MESSAGES: AppMessage[] = [];

export async function getMessages(): Promise<AppMessage[]> {
  await randomDelay(20, 50);
  return sortAutoCutRecordsByCreatedAtDesc(readLocalMessages());
}

export async function updateMessageRead(messageId: string, read: boolean): Promise<void> {
  await randomDelay(100, 200);
  const messages = readLocalMessages();
  writeAutoCutStorage(
    'messages',
    messages.map((message) => (message.id === messageId ? { ...message, read } : message)),
  );
  dispatchAutoCutEvent('messagesUpdated', undefined);
}

export async function markAllMessagesRead(): Promise<void> {
  await randomDelay(200, 400);
  const messages = readLocalMessages();
  writeAutoCutStorage(
    'messages',
    messages.map((message) => ({ ...message, read: true })),
  );
  dispatchAutoCutEvent('messagesUpdated', undefined);
}

export async function clearReadMessages(): Promise<void> {
  await randomDelay(200, 400);
  const messages = readLocalMessages();
  writeAutoCutStorage(
    'messages',
    messages.filter((message) => !message.read),
  );
  dispatchAutoCutEvent('messagesUpdated', undefined);
}

export async function addMessage(message: AppMessage): Promise<void> {
  const messages = readLocalMessages();
  writeAutoCutStorage('messages', [message, ...messages]);
  dispatchAutoCutEvent('messageAdded', message);
}

function readLocalMessages() {
  return readAutoCutStorage<AppMessage[]>('messages', EMPTY_MESSAGES);
}
