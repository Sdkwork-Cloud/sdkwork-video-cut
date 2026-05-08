const AUTO_CUT_SQLITE_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u;

export function getAutoCutTimestampMs(timestamp: string) {
  const value = Date.parse(normalizeAutoCutTimestampForParsing(timestamp));
  return Number.isNaN(value) ? 0 : value;
}

export function compareAutoCutTimestampDesc(leftTimestamp: string, rightTimestamp: string) {
  return getAutoCutTimestampMs(rightTimestamp) - getAutoCutTimestampMs(leftTimestamp);
}

export function sortAutoCutRecordsByCreatedAtDesc<TRecord extends { createdAt: string }>(records: TRecord[]) {
  return [...records].sort((leftRecord, rightRecord) =>
    compareAutoCutTimestampDesc(leftRecord.createdAt, rightRecord.createdAt),
  );
}

export function formatAutoCutDateTime(timestamp: string) {
  const normalizedTimestamp = normalizeAutoCutTimestampForParsing(timestamp);
  const value = Date.parse(normalizedTimestamp);
  if (Number.isNaN(value)) {
    return timestamp;
  }
  return formatAutoCutLocalDateTimeSecondTimestamp(value);
}

export function formatAutoCutTimeOfDay(timestamp: AutoCutTimestampInput) {
  const date = new Date(resolveAutoCutTimestampMs(timestamp));
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

export type AutoCutTimestampInput = string | number | Date;

export function normalizeAutoCutTimestampForParsing(timestamp: string) {
  const normalizedTimestamp = timestamp.trim();
  if (AUTO_CUT_SQLITE_UTC_TIMESTAMP_PATTERN.test(normalizedTimestamp)) {
    return `${normalizedTimestamp.replace(' ', 'T')}Z`;
  }

  return timestamp;
}

export function resolveAutoCutTimestampMs(timestamp: AutoCutTimestampInput) {
  if (timestamp instanceof Date) {
    const value = timestamp.getTime();
    return Number.isNaN(value) ? 0 : value;
  }

  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  if (typeof timestamp === 'string' && timestamp.trim()) {
    const value = Date.parse(normalizeAutoCutTimestampForParsing(timestamp));
    return Number.isNaN(value) ? 0 : value;
  }

  return 0;
}

export function formatAutoCutLocalDateTimeSecondTimestamp(timestamp: AutoCutTimestampInput) {
  const date = new Date(resolveAutoCutTimestampMs(timestamp));
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatAutoCutLocalSecondTimestamp(timestamp: AutoCutTimestampInput) {
  const date = new Date(resolveAutoCutTimestampMs(timestamp));
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}
