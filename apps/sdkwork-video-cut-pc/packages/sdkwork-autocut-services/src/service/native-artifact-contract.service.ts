export interface AutoCutNativeArtifactPathContract {
  artifactPath: string;
  taskOutputDir: string;
}

export const AUTOCUT_NATIVE_TASK_COVER_DIR = 'cover';

export function assertAutoCutNativeArtifactInsideTaskOutputDir(
  artifact: AutoCutNativeArtifactPathContract,
  context: string,
) {
  const artifactPath = assertAutoCutNativeArtifactText(artifact.artifactPath, context, 'artifactPath');
  const taskOutputDir = assertAutoCutNativeArtifactText(artifact.taskOutputDir, context, 'taskOutputDir');
  const normalizedArtifactPath = normalizeAutoCutNativePathForContainment(artifactPath);
  const normalizedTaskOutputDir = normalizeAutoCutNativePathForContainment(taskOutputDir);
  if (
    normalizedArtifactPath === normalizedTaskOutputDir ||
    !normalizedArtifactPath.startsWith(`${normalizedTaskOutputDir}/`)
  ) {
    throw new Error(`AutoCut native artifact ${context} artifactPath is outside its task output directory.`);
  }
}

export function assertAutoCutNativeVideoCoverInsideTaskCoverDir(
  artifact: AutoCutNativeArtifactPathContract,
  context: string,
) {
  assertAutoCutNativeArtifactInsideTaskOutputDir(artifact, context);
  const artifactPath = assertAutoCutNativeArtifactText(artifact.artifactPath, context, 'artifactPath');
  const taskOutputDir = assertAutoCutNativeArtifactText(artifact.taskOutputDir, context, 'taskOutputDir');
  const normalizedArtifactPath = normalizeAutoCutNativePathForContainment(artifactPath);
  const normalizedTaskCoverDir = `${normalizeAutoCutNativePathForContainment(taskOutputDir)}/${AUTOCUT_NATIVE_TASK_COVER_DIR}`;
  if (
    normalizedArtifactPath === normalizedTaskCoverDir ||
    !normalizedArtifactPath.startsWith(`${normalizedTaskCoverDir}/`)
  ) {
    throw new Error(`AutoCut native artifact ${context} artifactPath is outside its task cover directory.`);
  }
}

function assertAutoCutNativeArtifactText(value: unknown, context: string, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AutoCut native artifact ${context} is missing ${fieldName}.`);
  }
  return value;
}

export function normalizeAutoCutNativePathForContainment(filePath: string) {
  const normalizedPathText = filePath
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\/+/gu, '/');
  const prefixMatch = /^(?<prefix>[a-zA-Z]:|\/)?(?<rest>.*)$/u.exec(normalizedPathText);
  const prefix = prefixMatch?.groups?.prefix ?? '';
  const rest = prefixMatch?.groups?.rest ?? normalizedPathText;
  const segments: string[] = [];

  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop();
        continue;
      }
      if (!prefix) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  const normalizedPrefix = prefix ? prefix.toLowerCase() : '';
  const normalizedRest = segments.join('/');
  if (!normalizedPrefix) {
    return normalizedRest;
  }
  if (normalizedPrefix === '/') {
    return normalizedRest ? `/${normalizedRest}` : '/';
  }
  return normalizedRest ? `${normalizedPrefix}/${normalizedRest}` : normalizedPrefix;
}
