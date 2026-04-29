export function titleFromSourceName(sourceName: string): string {
  const dotIndex = sourceName.lastIndexOf('.');
  return dotIndex > 0 ? sourceName.slice(0, dotIndex) : sourceName;
}
