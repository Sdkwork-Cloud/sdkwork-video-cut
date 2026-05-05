import type { AppTask } from '@sdkwork/autocut-types';

export type ExtractedTextSegment = NonNullable<AppTask['extractedText']>[number];

export function createAutoCutObjectUrl(source: Blob | MediaSource) {
  return URL.createObjectURL(source);
}

export function revokeAutoCutObjectUrl(url: string) {
  URL.revokeObjectURL(url);
}

export function createAutoCutTextObjectUrl(text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  return {
    size: blob.size,
    url: createAutoCutObjectUrl(blob),
  };
}

export function downloadAutoCutUrl(url: string | undefined, filename: string) {
  if (!url) {
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function formatExtractedText(extractedText: readonly ExtractedTextSegment[] | undefined) {
  return extractedText?.map((item) => `[${item.time}] ${item.speaker}: ${item.text}`).join('\n') ?? '';
}

export function downloadExtractedTextFile(extractedText: readonly ExtractedTextSegment[] | undefined, filename: string) {
  const { url } = createAutoCutTextObjectUrl(formatExtractedText(extractedText));
  try {
    downloadAutoCutUrl(url, filename);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
}
