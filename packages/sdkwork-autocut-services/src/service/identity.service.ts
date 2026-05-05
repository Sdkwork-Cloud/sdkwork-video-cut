let autoCutIdSequence = 0;

export function createAutoCutTimestamp() {
  return new Date().toISOString();
}

export function createRelativeAutoCutTimestamp(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function createAutoCutId(prefix: string) {
  autoCutIdSequence = (autoCutIdSequence + 1) % 100000;
  const sequence = autoCutIdSequence.toString().padStart(5, '0');
  return `${prefix}-${Date.now()}-${sequence}`;
}
