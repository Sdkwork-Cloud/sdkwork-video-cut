export interface AutoCutProcessingSourceInput {
  file?: File | null;
  fileId?: string;
  url?: string;
  allowExternalUrl?: boolean;
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

export function validateAutoCutProcessingSource(input: AutoCutProcessingSourceInput) {
  if (input.file || hasText(input.fileId)) {
    return;
  }

  const sourceUrl = input.url?.trim();
  if (!sourceUrl) {
    throw new Error('AutoCut processing requires a source media file, asset, or URL.');
  }

  if (!input.allowExternalUrl) {
    throw new Error('AutoCut processing source media URL is not supported for this workflow.');
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('AutoCut processing source media URL is invalid.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AutoCut processing source media URL must use http or https.');
  }
}
