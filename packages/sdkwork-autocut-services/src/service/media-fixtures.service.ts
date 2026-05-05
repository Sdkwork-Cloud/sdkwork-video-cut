export const AUTO_CUT_MEDIA_FIXTURES = {
  sampleVideoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  sampleLegacyVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  sampleAudioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  sampleGifUrl: 'https://media.giphy.com/media/3o7aD2saalEvW6vWgA/giphy.gif',
  thumbnailBaseUrl: 'https://picsum.photos/seed',
} as const;

export function getAutoCutSampleVideoUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.sampleVideoUrl;
}

export function getAutoCutLegacySampleVideoUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.sampleLegacyVideoUrl;
}

export function getAutoCutSampleAudioUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.sampleAudioUrl;
}

export function getAutoCutSampleGifUrl() {
  return AUTO_CUT_MEDIA_FIXTURES.sampleGifUrl;
}

export function getAutoCutSampleThumbnailUrl(seed: string | number) {
  return `${AUTO_CUT_MEDIA_FIXTURES.thumbnailBaseUrl}/${seed}/320/180`;
}

export function getAutoCutSampleSliceThumbnailUrl(taskId: string, index: number) {
  return getAutoCutSampleThumbnailUrl(`${taskId}${index}`);
}
