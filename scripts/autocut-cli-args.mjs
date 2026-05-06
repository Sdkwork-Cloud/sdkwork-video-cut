export function normalizeAutoCutCliArgs(argv) {
  return argv.filter((arg) => arg !== '--');
}

export function readAutoCutCliOptionValue(argv, index, {
  optionName,
  commandName,
}) {
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`Missing value for ${commandName} argument ${optionName}.`);
  }

  return {
    value,
    nextIndex: index + 1,
  };
}
