export function normalizeCliArgs(argv) {
  return [...argv].filter((arg) => arg !== '--');
}
