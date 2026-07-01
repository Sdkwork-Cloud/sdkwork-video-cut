export interface AutoCutTrustedFileSourceDescriptor {
  sourcePath: string;
  name: string;
  byteSize: number;
  mediaType: string;
  mimeType: string;
  hasAudioStream: boolean;
  hasVideoStream: boolean;
}

export interface AutoCutTrustedLocalFile extends File {
  readonly sourcePath: string;
  readonly path: string;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly hasAudioStream: boolean;
  readonly hasVideoStream: boolean;
}

export interface AutoCutRequiredMediaStreams {
  audio?: boolean;
  video?: boolean;
}

export interface AutoCutTrustedFileSourceDrop {
  files: AutoCutTrustedFileSourceDescriptor[];
}

type AutoCutTrustedFileSourceDropHandler = (detail: AutoCutTrustedFileSourceDrop) => void;

interface AutoCutFilePathCandidate {
  sourcePath?: unknown;
  path?: unknown;
}

const trustedFileSourceDropHandlers = new Set<AutoCutTrustedFileSourceDropHandler>();
const trustedLocalFiles = new WeakSet<File>();

export function createAutoCutTrustedLocalFile(
  descriptor: AutoCutTrustedFileSourceDescriptor,
): AutoCutTrustedLocalFile {
  const sourcePath = descriptor.sourcePath.trim();
  const name = descriptor.name.trim();
  const byteSize = descriptor.byteSize;
  const mimeType = descriptor.mimeType.trim() || 'application/octet-stream';
  const mediaType = descriptor.mediaType.trim() || 'binary';
  const hasAudioStream = descriptor.hasAudioStream;
  const hasVideoStream = descriptor.hasVideoStream;

  if (!sourcePath) {
    throw new Error('AutoCut trusted file source requires a sourcePath.');
  }
  if (!name) {
    throw new Error('AutoCut trusted file source requires a file name.');
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error('AutoCut trusted file source byteSize must be a safe non-negative integer.');
  }
  if (typeof hasAudioStream !== 'boolean' || typeof hasVideoStream !== 'boolean') {
    throw new Error('AutoCut trusted file source requires native audio/video stream evidence.');
  }

  const trustedFile = new File([], name, { type: mimeType }) as AutoCutTrustedLocalFile;
  Object.defineProperties(trustedFile, {
    sourcePath: {
      configurable: false,
      enumerable: true,
      value: sourcePath,
    },
    path: {
      configurable: false,
      enumerable: true,
      value: sourcePath,
    },
    byteSize: {
      configurable: false,
      enumerable: true,
      value: byteSize,
    },
    mediaType: {
      configurable: false,
      enumerable: true,
      value: mediaType,
    },
    hasAudioStream: {
      configurable: false,
      enumerable: true,
      value: hasAudioStream,
    },
    hasVideoStream: {
      configurable: false,
      enumerable: true,
      value: hasVideoStream,
    },
    size: {
      configurable: true,
      enumerable: true,
      value: byteSize,
    },
  });
  trustedLocalFiles.add(trustedFile);

  return trustedFile;
}

export function resolveAutoCutTrustedSourcePath(file: File | null | undefined) {
  if (!file) {
    return null;
  }
  if (!trustedLocalFiles.has(file)) {
    return null;
  }

  const candidate = file as File & AutoCutFilePathCandidate;
  const sourcePath = candidate.sourcePath;
  if (typeof sourcePath === 'string' && sourcePath.trim()) {
    return sourcePath.trim();
  }

  const path = candidate.path;
  if (typeof path === 'string' && path.trim()) {
    return path.trim();
  }

  return null;
}

export function hasAutoCutTrustedSourcePath(file: File | null | undefined): file is AutoCutTrustedLocalFile {
  return Boolean(resolveAutoCutTrustedSourcePath(file));
}

export function validateAutoCutTrustedFileRequiredStreams(
  file: File,
  requiredStreams: AutoCutRequiredMediaStreams | undefined,
) {
  if (!requiredStreams || !resolveAutoCutTrustedSourcePath(file)) {
    return null;
  }

  const trustedFile = file as File & {
    hasAudioStream?: unknown;
    hasVideoStream?: unknown;
  };

  if (requiredStreams.audio === true && trustedFile.hasAudioStream !== true) {
    return 'AutoCut selected media requires an audio stream.';
  }
  if (requiredStreams.video === true && trustedFile.hasVideoStream !== true) {
    return 'AutoCut selected media requires a video stream.';
  }

  return null;
}

export function dispatchAutoCutTrustedFileSourceDrop(detail: AutoCutTrustedFileSourceDrop) {
  if (detail.files.length === 0) {
    return;
  }

  for (const handler of [...trustedFileSourceDropHandlers]) {
    handler(detail);
  }
}

export function listenAutoCutTrustedFileSourceDrop(handler: AutoCutTrustedFileSourceDropHandler) {
  trustedFileSourceDropHandlers.add(handler);
  return () => {
    trustedFileSourceDropHandlers.delete(handler);
  };
}
