export function confirmAutoCutAction(message: string) {
  return window.confirm(message);
}

export async function writeAutoCutClipboardText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function openAutoCutPreviewUrl(url: string | undefined) {
  if (!url) {
    return;
  }

  window.open(url, '_blank');
}
