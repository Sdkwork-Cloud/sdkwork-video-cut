export const AUTO_CUT_MEDIA_FIXTURES = {
  sampleAudioUrl: null,
  sampleGifUrl: null,
  thumbnailBaseUrl: null,
} as const;

export function getAutoCutSampleAudioUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.sampleAudioUrl;
}

export function getAutoCutSampleGifUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.sampleGifUrl;
}

export function getAutoCutSampleThumbnailUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.thumbnailBaseUrl;
}

export function getAutoCutSampleSliceThumbnailUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.thumbnailBaseUrl;
}
