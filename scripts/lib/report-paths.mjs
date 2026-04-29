import { relative, resolve } from 'node:path';

export function createReportPath(projectRoot, reportDir, fileName) {
  const absolutePath = resolve(projectRoot, reportDir, fileName);
  return {
    absolutePath,
    reportPath: serializeProjectPath(projectRoot, absolutePath),
  };
}

export function serializeProjectPath(projectRoot, absolutePath) {
  const projectRelativePath = relative(projectRoot, absolutePath).replaceAll('\\', '/');
  if (
    projectRelativePath &&
    projectRelativePath !== '..' &&
    !projectRelativePath.startsWith('../') &&
    !/^[A-Za-z]:\//.test(projectRelativePath) &&
    !projectRelativePath.startsWith('//')
  ) {
    return projectRelativePath;
  }

  return absolutePath;
}
