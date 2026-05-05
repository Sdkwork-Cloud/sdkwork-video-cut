export function getAutoCutTimestampMs(timestamp: string) {
  const value = Date.parse(timestamp);
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
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return timestamp;
  }
  return new Date(value).toLocaleString();
}
