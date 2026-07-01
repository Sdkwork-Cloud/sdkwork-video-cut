const AUTOCUT_TASK_DETAIL_CP1252_UNICODE_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const AUTOCUT_TASK_DETAIL_UTF8_MOJIBAKE_SIGNAL_PATTERN =
  /(?:Ã.|Â.|â[\u0080-\u00bf\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2122]|ð.|å.|ä.|ç.|ê.|ë.|ì.|í.|î.|ï.|€|™|œ|ž|Ÿ)/iu;
const AUTOCUT_TASK_DETAIL_REPLACEMENT_CHARACTER_PATTERN = /\uFFFD/u;
const autocutTaskDetailUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function tryDecodeEscapedAutoCutTaskDetailText(value: string) {
  if (!/\\u[0-9a-fA-F]{4}|\\n|\\r/u.test(value)) {
    return value;
  }

  try {
    const escapedForJson = value
      .replace(/\\/gu, '\\\\')
      .replace(/\\\\u([0-9a-fA-F]{4})/gu, '\\u$1')
      .replace(/\\\\n/gu, '\\n')
      .replace(/\\\\r/gu, '\\r')
      .replace(/"/gu, '\\"');
    return JSON.parse(`"${escapedForJson}"`) as string;
  } catch {
    return value;
  }
}

function scoreAutoCutTaskDetailMojibake(value: string) {
  const signalMatches = value.match(AUTOCUT_TASK_DETAIL_UTF8_MOJIBAKE_SIGNAL_PATTERN);
  const replacementPenalty = AUTOCUT_TASK_DETAIL_REPLACEMENT_CHARACTER_PATTERN.test(value) ? 4 : 0;
  return (signalMatches?.length ?? 0) + replacementPenalty;
}

function encodeAutoCutTaskDetailCp1252Bytes(value: string) {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return null;
    }

    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const mappedByte = AUTOCUT_TASK_DETAIL_CP1252_UNICODE_TO_BYTE.get(codePoint);
    if (mappedByte === undefined) {
      return null;
    }

    bytes.push(mappedByte);
  }

  return new Uint8Array(bytes);
}

export function tryRepairUtf8MojibakeAutoCutTaskDetailText(value: string) {
  if (!AUTOCUT_TASK_DETAIL_UTF8_MOJIBAKE_SIGNAL_PATTERN.test(value) && !AUTOCUT_TASK_DETAIL_REPLACEMENT_CHARACTER_PATTERN.test(value)) {
    return value;
  }

  const encodedBytes = encodeAutoCutTaskDetailCp1252Bytes(value);
  if (!encodedBytes || encodedBytes.length === 0) {
    return value;
  }

  try {
    const repaired = autocutTaskDetailUtf8Decoder.decode(encodedBytes);
    if (!repaired.trim()) {
      return value;
    }

    return scoreAutoCutTaskDetailMojibake(repaired) < scoreAutoCutTaskDetailMojibake(value)
      ? repaired
      : value;
  } catch {
    return value;
  }
}

export function normalizeAutoCutTaskDetailDisplayText(value: string | undefined | null) {
  if (typeof value !== 'string') {
    return '';
  }

  return tryRepairUtf8MojibakeAutoCutTaskDetailText(tryDecodeEscapedAutoCutTaskDetailText(value))
    .replace(/\r\n/gu, '\n')
    .trim();
}
