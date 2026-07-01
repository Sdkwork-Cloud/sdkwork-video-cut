let autoCutIdSequence = 0;
let autoCutUuidV7Sequence = 0;

const UUID_V7_RANDOM_BYTES = 8;

export function createAutoCutTimestamp() {
  return new Date().toISOString();
}

export function createRelativeAutoCutTimestamp(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function createAutoCutRelativeTimestampMs() {
  return Date.now();
}

export function createAutoCutTaskId(taskType: string) {
  return `task-${normalizeAutoCutTaskIdType(taskType)}-${createAutoCutUuidV7()}`;
}

export function createAutoCutId(prefix: string) {
  autoCutIdSequence = (autoCutIdSequence + 1) % 100000;
  const sequence = autoCutIdSequence.toString().padStart(5, '0');
  return `${prefix}-${Date.now()}-${sequence}`;
}

export function createAutoCutUuidV7() {
  const timestampMs = Date.now();
  const randomBytes = createAutoCutRandomBytes(UUID_V7_RANDOM_BYTES);
  autoCutUuidV7Sequence = (autoCutUuidV7Sequence + 1) & 0x0fff;

  const bytes = new Uint8Array(16);
  bytes[0] = (timestampMs / 0x10000000000) & 0xff;
  bytes[1] = (timestampMs / 0x100000000) & 0xff;
  bytes[2] = (timestampMs / 0x1000000) & 0xff;
  bytes[3] = (timestampMs / 0x10000) & 0xff;
  bytes[4] = (timestampMs / 0x100) & 0xff;
  bytes[5] = timestampMs & 0xff;
  bytes[6] = 0x70 | ((autoCutUuidV7Sequence >> 8) & 0x0f);
  bytes[7] = autoCutUuidV7Sequence & 0xff;
  if (randomBytes[0] === undefined) {
    throw new Error('AutoCut UUIDv7 generation requires random bytes.');
  }
  bytes[8] = 0x80 | (randomBytes[0] & 0x3f);
  bytes.set(randomBytes.slice(1), 9);

  return formatAutoCutUuidBytes(bytes);
}

function normalizeAutoCutTaskIdType(taskType: string) {
  const normalizedType = taskType
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  return normalizedType || 'task';
}

function createAutoCutRandomBytes(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider && typeof cryptoProvider.getRandomValues === 'function') {
    cryptoProvider.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function formatAutoCutUuidBytes(bytes: Uint8Array) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
